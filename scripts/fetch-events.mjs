#!/usr/bin/env node
/**
 * Aggregates upcoming events in Hilo, Hawaiʻi into site/events.json and
 * site/events.ics. Runs in CI (see .github/workflows/events.yml) and locally
 * for preview. The pipeline is lqa-events' (scripts/*.mjs are its files,
 * byte for byte); only the sources below and site/city.js are Hilo's.
 *
 * Each source returns [{ venue, title, date, time, url }]. Ticketmaster needs
 * a free Discovery API key in env TICKETMASTER_API_KEY (repo secret of the
 * same name); with no key it's skipped. Every room is read by its Ticketmaster
 * venue id (city.js `tm`); there is no city sweep, as in Chicago — the rooms
 * are read one by one, a second apart (the key is shared with the sister
 * cities' builds). Ticketmaster lists almost nothing here: the rooms' own
 * calendars come through scripts/feeds.mjs (The Events Calendar, Squarespace,
 * the NPS events API, the Vulcans' season iCal, Honokaʻa's Eventbrite links),
 * and four are parsed below — the UH Hilo Performing Arts Center's eight-month
 * outlook, the Merrie Monarch Festival's programme page, the Volcano Art
 * Center's EventPrime month pages and the Hawaii Concert Society's season
 * page. The Rainbow Warriors' seasons come from ESPN (scripts/schedules.mjs).
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { buildIcs } from './ics.mjs';
import { isChurch } from './sources.mjs';
import { mergeWithArchive, unionArchives, eventKey } from './merge.mjs';
import { fixLinks } from './links.mjs';
import { calmTitle, isNotice } from './titles.mjs';
import { applySchedules } from './schedules.mjs';
import { slugify, BADGE_FEEDS, TEAMS, CITY } from './badges.mjs';
import { feedSources, emptyListGate, cardDates } from './feeds.mjs';

const JSON_OUT = new URL('../site/events.json', import.meta.url);
const ICS_OUT = new URL('../site/events.ics', import.meta.url);
// A full year each way: venues announce whole seasons ahead, and past events
// are kept for a year (carried forward from the previously published feed —
// see mergeWithArchive).
const WINDOW_DAYS = 365;
// The live feed is read from the site's own domain (a build that reads
// neither copy of the archive refuses to publish — see mergeWithArchive;
// ALLOW_NO_ARCHIVE=1 lets the very first build through).
const FEED_URL = process.env.FEED_URL || 'https://hilo.here.events/events.json';
// the second copy of the archive: every past event ever published, kept on
// the orphan `archive` branch by the workflow after each successful build
const ARCHIVE_URL = process.env.ARCHIVE_URL || 'https://raw.githubusercontent.com/sfosdal/hilo-events/archive/events-archive.json';
const ARCHIVE_OUT = new URL('../events-archive.json', import.meta.url); // repo root, ignored; the workflow commits it to the branch
const MAX_EVENTS = 4000; // sanity cap, not a display cap

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Local runs: when the environment doesn't provide TICKETMASTER_API_KEY (CI
// passes it as a repo secret), pick it up from an untracked repo-root .env so
// the localhost preview gets the arena listings too.
if (!process.env.TICKETMASTER_API_KEY) {
  try {
    const m = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .match(/^TICKETMASTER_API_KEY=(.+)$/m);
    if (m) process.env.TICKETMASTER_API_KEY = m[1].trim();
  } catch { /* no .env — Ticketmaster sources warn and skip */ }
}

// --- Ticketmaster Discovery API ---
// Ticketmaster's resale marketplace (source "tmr": an id starting "Z7r9j", a
// ticketmaster.com/event/ link) lists shows whose box office is elsewhere, a
// second listing beside the primary, titled differently so the duplicate
// guard can't fold them. A resale listing is kept only when no primary one
// shares its date, and it links to the box office the listing names or the
// venue's own page, never to the resale offer.
const isResale = (e) => /^Z7r9j/.test(e.id || '');
function tmEvent(e, venue, fallbackUrl) {
  const boxOffice = (e.outlets || []).find((o) => o.type === 'venueBoxOffice')?.url;
  const ev = {
    venue,
    title: e.name,
    date: e.dates?.start?.localDate || '',
    time: e.dates?.start?.localTime || '',
    url: isResale(e) ? (boxOffice || fallbackUrl) : (e.url || fallbackUrl),
  };
  if (e.ageRestrictions?.legalAgeEnforced) ev.age21 = true;
  const seg = e.classifications?.[0]?.segment?.name || '';
  const type = /sports/i.test(seg) ? 'sports' : /music/i.test(seg) ? 'concert' : /arts|theat/i.test(seg) ? 'arts' : /film/i.test(seg) ? 'movie' : null;
  if (type) ev.type = type;
  if (e.dates?.start?.dateTBD || e.dates?.start?.dateTBA) ev.dateTbd = true; // a placeholder date the promoter may still move
  // a cancelled or postponed show stays in Ticketmaster's listing for a
  // while, marked in dates.status — pass that on rather than list it as if
  // it were still happening (the merge step drops it once it vanishes)
  const code = e.dates?.status?.code;
  if (code === 'cancelled' || code === 'postponed') ev.status = code;
  return ev;
}
function keepPrimary(rows) {
  const primaryDates = new Set(rows.filter((e) => !isResale(e)).map((e) => e.dates?.start?.localDate));
  return rows.filter((e) => !isResale(e) || !primaryDates.has(e.dates?.start?.localDate));
}
// One Ticketmaster call at a time, a second apart, and a wait of eight
// seconds on a 429 (the key is shared with the sister cities' builds).
let tmLast = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmQueue = Promise.resolve();
function tmFetch(url) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = tmLast + 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      tmLast = Date.now();
      const res = await fetch(url);
      if (res.status !== 429 || attempt >= 5) return res;
      await sleep(8000);
    }
  };
  const p = tmQueue.then(run, run);
  tmQueue = p.catch(() => {});
  return p;
}
async function tmPages(params, label) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) { console.warn('No TICKETMASTER_API_KEY set — skipping Ticketmaster.'); return []; }
  const all = [];
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ apikey: key, sort: 'date,asc', size: '200', page: String(page), ...params });
    const res = await tmFetch(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`);
    if (!res.ok) { console.error(`Ticketmaster ${label} page ${page} HTTP ${res.status}`); break; }
    const data = await res.json();
    all.push(...(data?._embedded?.events || []));
    if (page + 1 >= (data?.page?.totalPages || 1)) break;
  }
  console.log(`Ticketmaster ${label}: ${all.length} events`);
  return all;
}
// by venue id (every page), for the rooms city.js names
async function ticketmasterVenue({ venueId, venueMatch, label, fallbackUrl, exclude }) {
  const rows = (await tmPages({ venueId }, label))
    .filter((e) => (e._embedded?.venues?.[0]?.name || '').toLowerCase().includes(venueMatch))
    .filter((e) => !exclude || !exclude.test(e.name || ''));
  return keepPrimary(rows).map((e) => tmEvent(e, label, fallbackUrl));
}
const tmRoom = ([label, v]) => () => ticketmasterVenue({ venueId: v.tm.id, venueMatch: v.tm.match, label, fallbackUrl: v.tm.fallbackUrl, exclude: v.tm.exclude });
const ticketmasterRooms = Object.entries(CITY.venues).filter(([, v]) => v.tm && !v.tm.secondary).map(tmRoom);
// Rooms whose own calendar is the voice of record (city.js tm.secondary: the Palace, the Performing
// Arts Center): Ticketmaster fills only the dates that calendar lacks
const ticketmasterSecond = Object.entries(CITY.venues).filter(([, v]) => v.tm && v.tm.secondary).map(tmRoom);

// Rooms with their own calendar (city.js `feed`: the Palace's Events Calendar, ʻImiloa's Squarespace
// collection, the park's NPS listing, Honokaʻa's Eventbrite links) and the Vulcans' season iCal (city.js
// `feeds`) come through feeds.mjs. Four more are parsed here.

const unent = (t) => String(t || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#?039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// "9 am to 1 pm" → 09:00; "5:30-8:30pm" → 17:30 (a first clock with no am/pm borrows the next one's)
export function firstClock(text) {
  const t = String(text || '');
  if (/^\s*noon\b/i.test(t)) return '12:00';
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(t);
  if (!m) return '';
  const mer = m[3] ? m[3][0].toLowerCase() : (/(am|pm|a\.m\.|p\.m\.)/i.exec(t.slice(m.index + m[0].length)) || [''])[0][0]?.toLowerCase();
  let h = Number(m[1]); if (h > 23) return '';
  if (mer === 'p' && h < 12) h += 12; else if (mer === 'a' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
}

const MONTH_NUM = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const WEEKDAYS = 'Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday';
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const pad2 = (n) => String(n).padStart(2, '0');
const plainText = (html) => unent(String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// --- UH Hilo Performing Arts Center: its eight-month outlook ---
// artscenter.uhh.hawaii.edu/future.php prints eight monthly tables (class caltable, the month in a
// colspan-7 header) of <td> day cells — <p class="day">8</p> (the month's first day "Oct 1"; the
// grey days of the months either side carry class="off") — each event a <div class="ev"> with a
// <span class="time">7p</span> and a link to the university's news page for it.
const PAC_URL = 'https://artscenter.uhh.hawaii.edu/future.php';
const pacClock = (t) => { const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])/i.exec(t || ''); if (!m) return ''; let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'p') h += 12; return `${pad2(h)}:${m[2] || '00'}`; };
export function parsePacOutlook(html) {
  const out = [];
  for (const table of String(html || '').split(/<table\b/).slice(1)) {
    const h = /<th colspan="7" class="large">\s*([A-Za-z]+)\s+(\d{4})\s*</.exec(table); if (!h) continue;
    const mo = MONTH_NUM[h[1].toLowerCase()]; if (!mo) continue;
    for (const cell of table.split(/<td\b/).slice(1)) {
      if (/^[^>]*class="off"/.test(cell)) continue;
      const dn = /<p class="day">(?:[A-Za-z]{3}\s+)?(\d{1,2})<\/p>/.exec(cell); if (!dn) continue;
      const date = `${h[2]}-${pad2(mo)}-${pad2(dn[1])}`;
      for (const ev of cell.matchAll(/<div class="ev[^"]*">([\s\S]*?)<\/div>/g)) {
        const clock = /<span class="time">([^<]*)<\/span>/.exec(ev[1]);
        const a = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(ev[1]); if (!a) continue;
        const title = unent(a[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); if (!title) continue;
        out.push({ venue: 'UH Hilo Performing Arts Center', title, date, time: pacClock(clock && clock[1]), url: unent(a[1]).replace(/^http:/, 'https:'), type: 'arts' });
      }
    }
  }
  return out;
}
async function pacOutlook() {
  const res = await fetch(PAC_URL, { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`UH Hilo Performing Arts Center HTTP ${res.status}`);
  const evs = parsePacOutlook(await res.text());
  console.log(`UH Hilo Performing Arts Center: ${evs.length} events`);
  return evs;
}

// --- The Merrie Monarch Festival: its programme page ---
// merriemonarch.com/<year>-merrie_monarch_festival/ lists the week's events as prose — "Hōʻike
// Performances 6:00 pm, Wednesday, March 31st at the Edith Kanakaʻole Stadium", "Merrie Monarch
// Invitational Hawaiian Arts Fair 9:00 a.m. to 5:00 p.m., Wednesday, March 31st through Friday,
// April 2nd …". Each clock-weekday-date mention is an event; the title is the sentence fragment
// before the clock, the place the "at the …" that follows, a "through" range one row a day. The
// year is the page's. This year's page and next year's are both read (the next appears in autumn).
const MM_BASE = 'https://www.merriemonarch.com/';
export function parseMerrieMonarch(html, year) {
  const text = plainText(html);
  const re = new RegExp(`(\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?))(?:\\s*(?:to|-|–)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?))?\\s*,?\\s*(?:${WEEKDAYS})\\s*,?\\s*(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+through\\s+(?:${WEEKDAYS})\\s*,?\\s*(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?)?`, 'gi');
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const before = text.slice(last, m.index);
    last = m.index + m[0].length;
    // the title: after the last sentence end or year in the text since the previous mention
    let title = before.split(/(?<=[.!?])\s+|(?<=\b\d{4})\s+/).pop().trim().replace(/^[^A-Za-zʻŌĀĪŪĒōāīūē]+/, '').replace(/\s*\(celebration\)/i, '');
    if (!title || title.length < 4 || new RegExp(`\\b(${WEEKDAYS}|${MONTHS})\\b`, 'i').test(title) || !/^[A-ZʻŌĀĪŪĒ]/.test(title)) continue;
    const after = text.slice(last, last + 160);
    const at = /^\s*(?:\.|,)?\s*at the ([A-ZʻŌĀĪŪĒ][^.]*?(?:Stadium|Auditorium|Hotel|Center|Park|Hilo|Bayfront|Avenue))/.exec(after);
    const place = at ? at[1].trim() : '';
    const start = Date.UTC(year, MONTH_NUM[m[2].toLowerCase()] - 1, Number(m[3]));
    const end = m[4] ? Date.UTC(year, MONTH_NUM[m[4].toLowerCase()] - 1, Number(m[5])) : start;
    const time = firstClock(m[1]);
    for (let d = start; d <= end && d < start + 7 * 86400e3; d += 86400e3) {
      out.push({ venue: 'Merrie Monarch Festival', title: place && !title.toLowerCase().includes(place.toLowerCase()) ? `${title} — ${place}` : title, date: new Date(d).toISOString().slice(0, 10), time, url: `${MM_BASE}${year}-merrie_monarch_festival/`, type: 'community' });
    }
  }
  return out;
}
async function merrieMonarch() {
  const y = new Date().getFullYear();
  const out = [];
  for (const year of [y, y + 1]) {
    const res = await fetch(`${MM_BASE}${year}-merrie_monarch_festival/`, { headers: { 'User-Agent': BROWSER_UA } });
    if (!res.ok) { if (res.status !== 404) console.error(`Merrie Monarch ${year} HTTP ${res.status}`); continue; }
    out.push(...parseMerrieMonarch(await res.text(), year));
  }
  console.log(`Merrie Monarch Festival: ${out.length} events`);
  return out;
}

// --- Volcano Art Center: its EventPrime month pages ---
// volcanoartcenter.org/ep-events/?epc_month=YYYY-MM draws the month as a grid whose every item is an
// <a data-epc-peek> carrying the card as attributes: data-peek-title, data-peek-when ("28 Sep",
// "6 Sep – 25 Oct"), data-peek-time ("9:30 AM"), data-peek-venue, data-peek-type (Exhibits,
// Workshops …). A multi-day item sits in every day it spans, so items are read once by link; a run
// longer than three days is a class or an exhibition, not an event, and goes with the workshops,
// tours and classes. Four months are read.
const VAC_URL = 'https://volcanoartcenter.org/ep-events/';
const VAC_DROP = /workshop|\bclass(es)?\b|forest tours?|exhibition|\bexhibit\b|open studio|print lab|yoga|zumba|tai chi|meditation|lessons?\b|handbuilding|exploration in clay|with [A-Z][a-z]+ [A-Z][a-z]+ \(/i;
export function parseVacMonth(html, monthFirst) {
  const out = [];
  const seen = new Set();
  for (const tag of String(html || '').matchAll(/<a\s[^>]*data-epc-peek[^>]*>/g)) {
    const attr = (k) => { const m = new RegExp(`data-peek-${k}="([^"]*)"`).exec(tag[0]); return m ? unent(m[1]).trim() : ''; };
    const href = /href="([^"]+)"/.exec(tag[0]); if (!href || seen.has(href[1])) continue;
    seen.add(href[1]);
    const when = attr('when'), type = attr('type');
    const title = attr('title').replace(/^(almost )?sold out!?\s*(call [^a-z]*for tickets)?\s*/i, '').replace(/,?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*[ap]m)?\s*$/i, '').trim(); // "Almost Sold Out! Call … for tickets Concert: …", "VAC Voices, October 8th at 5PM"
    if (!title || !when || /^(Exhibits|Workshops|Classes)$/i.test(type) || VAC_DROP.test(title)) continue;
    const days = cardDates(when, monthFirst);
    if (!days.length || days.length > 3) continue;
    const time = firstClock(attr('time'));
    const where = attr('venue');
    for (const { date } of days) out.push({ venue: 'Volcano Art Center', title: where && /gallery/i.test(where) ? `${title} — ${where.replace(/^Volcano Art Center\s*/i, '')}` : title, date, time, url: unent(href[1]), type: 'arts' });
  }
  return out;
}
async function volcanoArtCenter() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 4; i++) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const ym = first.toISOString().slice(0, 7);
    const res = await fetch(`${VAC_URL}?epc_month=${ym}`, { headers: { 'User-Agent': BROWSER_UA } });
    if (!res.ok) { console.error(`Volcano Art Center ${ym} HTTP ${res.status}`); continue; }
    out.push(...parseVacMonth(await res.text(), first));
  }
  console.log(`Volcano Art Center: ${out.length} events over four months`);
  return out;
}

// --- The Hawaii Concert Society: its season page ---
// hawaiiconcertsociety.org/<yyyy>-<yy>-season is a Wix page whose concerts read, line by line,
// "WEDNESDAY, SEPTEMBER 23, 2026" / "U. H. HILO PERFORMING ARTS CENTER" / "NEAVE TRIO" / the blurb.
// Concerts begin at 7:00 PM (the page says so once). The hall line names the room — the Performing
// Arts Center or the Crown Room; a concert in a church is left to the shared church filter.
const HCS_BASE = 'https://www.hawaiiconcertsociety.org/';
const HCS_ROOMS = [[/performing arts/i, 'UH Hilo Performing Arts Center'], [/crown room|naniloa/i, 'Crown Room at the Grand Naniloa']];
export function parseConcertSociety(html, url) {
  const lines = unent(String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n')).replace(/[​ ]/g, ' ').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const re = new RegExp(`^(?:${WEEKDAYS}),?\\s+(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i');
  const out = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const m = re.exec(lines[i]); if (!m) continue;
    const hall = lines[i + 1], title = lines[i + 2];
    const room = HCS_ROOMS.find(([r]) => r.test(hall));
    out.push({ venue: room ? room[1] : hall, title, date: `${m[3]}-${pad2(MONTH_NUM[m[1].toLowerCase()])}-${pad2(m[2])}`, time: '19:00', url, type: 'concert' });
  }
  return out;
}
async function concertSociety() {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1; // the season opens in September
  const out = [];
  for (const start of [y, y + 1]) {
    const url = `${HCS_BASE}${start}-${String(start + 1).slice(2)}-season`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
    if (!res.ok) { if (res.status !== 404) console.error(`Hawaii Concert Society ${start} HTTP ${res.status}`); continue; }
    out.push(...parseConcertSociety(await res.text(), url));
  }
  console.log(`Hawaii Concert Society: ${out.length} concerts`);
  return out;
}

const sources = [...ticketmasterRooms, ...feedSources(CITY, BROWSER_UA), pacOutlook, merrieMonarch, volcanoArtCenter];
// Secondary sources re-list shows the primaries carry under other titles — Ticketmaster's rows for
// the Palace and the Performing Arts Center, and the Concert Society's season, whose concerts the
// Performing Arts Center's own outlook may already print. Clocks differ between listings, so the
// secondary rows are dropped by venue and date rather than by the shared dropTimeClashes.
const secondary = [...ticketmasterSecond, concertSociety];
const dropDateClashes = (rows, all) => { const taken = new Set(all.map((e) => `${e.venue}|${e.date}`)); return rows.filter((e) => !taken.has(`${e.venue}|${e.date}`)); };

// Venue names as city.js spells them: a venue listed under other spellings
// (`alias` — "Hilo, Hawai‘i, Afook-Chinen Civic Auditorium", "Vulcan Soccer
// Field") folds to its one name; Hilo sets no `groundsVenue`, so a row that
// still arrives under a name city.js lacks is dropped (and counted) rather
// than listed under a stray name.
const CANONICAL_VENUES = new Set(Object.keys(CITY.venues));
const ALIASES = Object.entries(CITY.venues).filter(([, v]) => v.alias).map(([label, v]) => [label, v.alias]);
const aliasHit = (s) => { const hit = ALIASES.find(([, re]) => re.test(s || '')); return hit ? hit[0] : null; };
const aliasVenue = (name) => aliasHit(name) || name;
// A listing whose venue field is just the city names its room at the end of
// the title ("X live at The Vic").
const roomInTitle = (title) => { const m = /\b(?:at|@)\s+(.+)$/i.exec(title || ''); return m ? aliasHit(m[1]) : null; };
const normalizeVenue = (e) => {
  const byName = aliasVenue(e.venue);
  const venue = CANONICAL_VENUES.has(byName) ? byName : (roomInTitle(e.title) || byName);
  if (CITY.groundsVenue && !CANONICAL_VENUES.has(venue)) return { ...e, venue: CITY.groundsVenue };
  return venue === e.venue ? e : { ...e, venue };
};
const strays = new Map();
const knownVenue = (e) => { if (CANONICAL_VENUES.has(e.venue)) return true; strays.set(e.venue, (strays.get(e.venue) || 0) + 1); return false; };

// Church events never make the listing (Steve, 2026-10-11, for Everett;
// the same here), judged on the
// source's own venue name and title before anything folds into the
// Elsewhere row; the count is logged so a new church booking is visible.
let churchDropped = 0;
const noChurch = (rows) => rows.filter((e) => { if (isChurch(e)) { churchDropped++; return false; } return true; });

let all = [];
for (const src of sources) {
  try { all = all.concat(noChurch(await src()).map(normalizeVenue).filter(knownVenue)); }
  catch (err) { console.error('Source failed:', err.message); }
}
for (const src of secondary) {
  try { all = all.concat(dropDateClashes(noChurch(await src()).map(normalizeVenue).filter(knownVenue), all)); }
  catch (err) { console.error('Source failed:', err.message); }
}
if (churchDropped) console.log(`Church events dropped: ${churchDropped}`);
// A listing that prints a show twice — once with a clock, once without (the Palace's all-day film
// rows beside its timed ones): when a timed row shares a venue, link and date with an untimed one,
// the untimed one goes
{ const timed = new Set(all.filter((e) => e.time).map((e) => `${e.venue}|${e.url}|${e.date}`)); all = all.filter((e) => e.time || !timed.has(`${e.venue}|${e.url}|${e.date}`)); }
if (strays.size) console.log(`Rows under venues city.js lacks, dropped: ${[...strays].map(([v, n]) => `${v} (${n})`).join(', ')}`);

// window, de-dupe, sort
const today = new Date().toISOString().slice(0, 10);
const horizon = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const seen = new Set();
const fresh = all
  .filter((e) => e.date && e.date >= cutoff && e.date <= horizon)
  .filter((e) => !isNotice(e.title)) // a closure or construction notice is information, not an event
  .map((e) => ({ ...e, title: calmTitle(unent(e.title)) })) // shouted titles (the Concert Society's season page) come down to Title Case, entities decoded first
  .map((e) => (/\s*[-–—]\s*sold out!?\s*$/i.test(e.title) ? { ...e, title: e.title.replace(/\s*[-–—]\s*sold out!?\s*$/i, ''), soldOut: true } : e)) // a "– Sold Out!" title suffix is the tag, not the words
  .filter((e) => { const k = eventKey(e); if (seen.has(k)) return false; seen.add(k); return true; }); // venue|title|date|clock (merge.mjs): a second showing on one day is kept

// the empty-list gate (feeds.mjs): nothing upcoming in this build's own pull means a room was
// missed in scouting or every source is down — not a fact about the town. ALLOW_EMPTY_LIST=1 overrides.
if (!emptyListGate(fresh, today, sources.length)) process.exit(1);

// carry past events forward. Two copies of the archive: the live feed and
// the `archive` branch's file (every past event ever published; the workflow
// rewrites it after each build). Each is fetched with three tries; the build
// goes on with the union of whatever it got and stops only when it got
// neither. Since the union can only grow, a publish that lost history can no
// longer shrink the record.
const cleanArchive = (d) => (Array.isArray(d) ? d : (d.events || []))
  .filter((e) => !isChurch(e)) // past church events leave the record too
  .map(normalizeVenue).filter(knownVenue) // past events published under other spellings fold onto the one name
  .filter((e) => !isNotice(e.title)).map((e) => ({ ...e, title: calmTitle(e.title) })); // the same title hygiene as fresh events, so the merge keys agree
async function fetchArchive(url, what) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return cleanArchive(await r.json());
    } catch (err) {
      console.error(`${what} fetch (try ${attempt} of 3) failed: ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 20000));
    }
  }
  return null;
}
const [liveArchive, branchArchive] = await Promise.all([
  fetchArchive(FEED_URL, 'Live feed'),
  fetchArchive(ARCHIVE_URL, 'Archive branch'),
]);
if (liveArchive === null && branchArchive === null && !process.env.ALLOW_NO_ARCHIVE) {
  console.error('No archive from either copy — not publishing (ALLOW_NO_ARCHIVE=1 to override for a first build)');
  process.exit(1);
}
if (liveArchive === null) console.error('Live feed unreadable — building on the archive branch copy');
if (branchArchive === null) console.error('Archive branch unreadable — building on the live feed alone');
const archived = unionArchives(liveArchive || [], branchArchive || []);
console.log(`Archive: ${(liveArchive || []).length} events in the live feed, ${(branchArchive || []).length} on the archive branch, ${archived.length} in the union`);

const merged = mergeWithArchive(fresh, archived, today, cutoff).slice(-MAX_EVENTS);

// League schedules flag floating dates Ticketmaster doesn't know yet, and
// the full seasons (home and away) feed the site's Teams view
let seasons = {}, form = {};
try { ({ teams: seasons, form } = await applySchedules(merged)); } catch (err) { console.error('Schedules step failed:', err.message); }
// The clubs whose home games have no ticket feed here (city.js `inject`: the
// none here — the Vulcans' dates come as listings from their season calendar) enter the listing from the league's schedule —
// typed sports, the club's ticket page as the link — unless the feed already
// has that day at that ground
// (city.js teams, not badges' TEAMS, which carries only slug/label/re — the
// loop was a no-op until 2026-10-11; the game takes the club's own ground name)
for (const t of CITY.teams.filter((x) => x.inject)) {
  for (const g of (seasons[t.slug] || []).filter((x) => x.home && x.date >= today)) { // from today: a written row is not a record of a past event (the archive keeps only what was listed)
    const ground = t.inject.venue || t.venue || g.venue;
    const room = CITY.venues[ground];
    if (g.venue && room && room.alias && !room.alias.test(g.venue)) continue; // a neutral-site game ESPN flags as home (Creighton v Michigan at T-Mobile Arena, 2026-11-24) stays off the home ground
    const listed = merged.find((e) => e.date === g.date && (e.venue === ground || e.venue === g.venue));
    if (listed) { if (!listed.time && g.time && !g.tbd) listed.time = g.time; continue; } // the feed's listing stands; the league's first pitch fills a time it lacks
    merged.push({ venue: ground, title: `${t.inject.name || t.name || t.label} vs ${g.opp.name}`, date: g.date, time: g.time, url: t.inject.url, type: 'sports', ...(g.tbd ? { dateTbd: true } : {}), ...(g.watch ? { watch: g.watch } : {}) });
  }
}
// Ticket availability for the Ticketmaster venues, from a local checker
// (scripts/data/soldout.json — empty until one runs for Hilo): counts and
// lowest price, and soldOut when the box office has nothing left.
try {
  const so = JSON.parse(readFileSync(new URL('./data/soldout.json', import.meta.url), 'utf8'));
  let n = 0, s = 0;
  for (const e of merged) {
    const m = (e.url || '').match(/\/event\/([0-9A-F]{16})/i); // Ticketmaster's 16-hex id
    const r = m && (so.events || {})[m[1].toUpperCase()];
    if (!r || !/^(available|soldout)$/.test(r.status)) continue;
    const out = r.status === 'soldout';
    e.tickets = { box: out ? 0 : (r.primary == null ? null : r.primary), resale: r.resale || 0, checked: r.checked };
    const from = out ? r.fromResale : r.fromPrimary;
    if (from != null) e.tickets.from = from;
    if (out) { e.soldOut = true; s++; }
    n++;
  }
  if (n) console.log(`soldout: ${n} events with ticket counts (checked ${so.generated}), ${s} sold out`);
} catch (err) { console.error('soldout.json:', err.message); }
merged.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
if (Object.keys(seasons).length) {
  const postseason = JSON.parse(readFileSync(new URL('./data/postseason.json', import.meta.url), 'utf8')); // each league's playoff rounds (hand-kept), shown until the real games land
  delete postseason._;
  writeFileSync(new URL('../site/teams.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), teams: seasons, form, postseason }, null, 1) + '\n');
} else {
  console.error('teams.json: no season fetched this run, the last one stands');
}

await fixLinks(merged, { venues: CITY.venues, today }); // ticket links that reach a real page: no scheme-less or wrapped links, a 404 goes to the venue's page (scripts/links.mjs)
writeFileSync(JSON_OUT, JSON.stringify({ generated: new Date().toISOString(), events: merged }, null, 2) + '\n');
// the archive record: this build's past events on top of everything already
// recorded, never pruned (the feed keeps a year; the branch keeps it all)
const record = unionArchives(merged.filter((e) => e.date < today), archived.filter((e) => e.date < today));
writeFileSync(ARCHIVE_OUT, JSON.stringify({ events: record }, null, 1) + '\n'); // no timestamp: the branch commits only when the events change
console.log(`Archive record: ${record.length} past events`);
writeFileSync(ICS_OUT, buildIcs(merged));

// Filtered subscribe feeds, one per venue and one per badge, so the site's
// filter chips can offer a matching calendar subscription.
const siteDir = new URL('../site/', import.meta.url);
let nFeeds = 0;
for (const venue of new Set(merged.map((e) => e.venue))) {
  const evs = merged.filter((e) => e.venue === venue);
  writeFileSync(new URL(`events-venue-${slugify(venue)}.ics`, siteDir),
    buildIcs(evs, new Date(), { calname: `${CITY.ics.short} — ${venue}` }));
  nFeeds++;
}
for (const [slug, [label, pred]] of Object.entries(BADGE_FEEDS)) {
  writeFileSync(new URL(`events-${slug}.ics`, siteDir),
    buildIcs(merged.filter(pred), new Date(), { calname: `${CITY.ics.short} — ${label}` }));
  nFeeds++;
}
// Exclusion feeds, one per local team: everything except that team's games.
for (const t of TEAMS) {
  writeFileSync(new URL(`events-no-${t.slug}.ics`, siteDir),
    buildIcs(merged.filter((e) => !t.re.test(e.title || '')), new Date(), { calname: `${CITY.ics.short} — no ${t.label}` }));
  nFeeds++;
}
// Season feeds for the Teams view: each club's whole season, home and away
// (team-<slug>.ics), and every club's in one (teams.ics). Each game links to
// the club's page on the site.
const seasonEvents = (slug, label, games) => games.map((g) => ({
  title: `${label} ${g.home ? 'vs' : 'at'} ${g.opp.name}${g.pre ? ' (preseason)' : g.playoff ? ' (playoff)' : ''}`,
  venue: g.venue || (g.home ? '' : g.opp.name), date: g.date, time: g.tbd ? null : g.time, ...(g.tbd ? { dateTbd: true } : {}),
  url: `${CITY.site}?team=${slug}`,
}));
const allSeasons = [];
for (const t of TEAMS) {
  if (!seasons[t.slug]) continue;
  const evs = seasonEvents(t.slug, t.label, seasons[t.slug]);
  allSeasons.push(...evs);
  writeFileSync(new URL(`team-${t.slug}.ics`, siteDir), buildIcs(evs, new Date(), { calname: `${t.label} season` }));
  nFeeds++;
}
writeFileSync(new URL('teams.ics', siteDir), buildIcs(allSeasons, new Date(), { calname: CITY.ics.teams }));
nFeeds++;

const nPast = merged.filter((e) => e.date < today).length;
console.log(`Wrote ${merged.length} events (${nPast} past, ${merged.length - nPast} upcoming) + ${nFeeds} filtered feeds`);
