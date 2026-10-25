// The city — every fact that makes this calendar Hilo's rather than
// another town's, in one place (2026-10-25: built on the Kona site's
// pattern, the other side of the same island). The browser (filter.js, app.js) and the build (scripts/*.mjs)
// both read it; nothing else names a venue or a team. The shared files
// (app.js, filter.js, styles.css bar its --v-* hues, scripts/*.mjs bar
// fetch-events.mjs and sources.mjs) are lqa-events' own, byte for byte —
// see README "Sister sites".
//
// Loaded before filter.js (a plain script, so the tests can share it): it
// sets globalThis.LQACity (the name is the shared code's, not the city's).
(function (global) {
  'use strict';

  // The home teams, matched on the event title whatever the venue. Order =
  // the Teams strip, left to right. Hilo's own club is UH Hilo's Vulcans
  // (NCAA Division II, the PacWest) — no league feed carries them, so their
  // home dates come in as listings from the athletics department's season
  // calendar (FEEDS below) rather than as a Teams-view club. These are the
  // state's programs — the University of Hawaiʻi at Mānoa, two hundred miles
  // away on Oʻahu — as a Teams-view-only list, as on the Kona site: their
  // grounds are not venues here and there is no `inject`. Per team:
  //   re        the title match; venue the home building; sport keys the
  //             strip icon and the game clock; colors [primary, accent];
  //   espn      ESPN's sport/league/team id — the university is id 62 in
  //             every college league, so the season, the form block and news
  //             all come from there (schedules.mjs)
  //   club      the program's name on Ticketmaster; wiki the article; opens
  //             when the season usually starts
  var UH_LOGO = 'https://a.espncdn.com/i/teamlogos/ncaa/500/62.png';
  var TEAMS = [
    { slug: 'football', label: 'Warriors Football', name: 'Hawaii Rainbow Warriors', abbr: 'HAW', re: /rainbow warriors football|hawai.i (rainbow warriors )?football/i, sport: 'football', venue: 'Ching Athletics Complex', colors: ['#024731', '#a7a9ac'],
      espn: { sport: 'football', league: 'college-football', id: '62' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: UH_LOGO, schedule: 'https://hawaiiathletics.com/sports/football/schedule',
      club: 'Hawaii Rainbow Warriors Football', opens: 'late August', wiki: { title: 'Hawaii Rainbow Warriors football', startYear: true } },
    { slug: 'basketball', label: 'Warriors Basketball', name: 'Hawaii Rainbow Warriors', abbr: 'HAW', re: /rainbow warriors men'?s basketball|rainbow warriors basketball/i, sport: 'basketball', venue: 'Stan Sheriff Center', colors: ['#024731', '#000000'],
      espn: { sport: 'basketball', league: 'mens-college-basketball', id: '62' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: UH_LOGO, schedule: 'https://hawaiiathletics.com/sports/mens-basketball/schedule',
      club: 'Hawaii Rainbow Warriors Mens Basketball', opens: 'early November', wiki: { title: "Hawaii Rainbow Warriors men's basketball", startYear: true } },
    { slug: 'volleyball', label: 'Wahine Volleyball', name: 'Hawaii Rainbow Wahine', abbr: 'HAW', re: /women'?s volleyball|rainbow wahine volleyball/i, sport: 'volleyball', venue: 'Stan Sheriff Center', colors: ['#024731', '#ffffff'],
      espn: { sport: 'volleyball', league: 'womens-college-volleyball', id: '62' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: UH_LOGO, schedule: 'https://hawaiiathletics.com/sports/womens-volleyball/schedule',
      club: 'Hawaii Rainbow Warriors Womens Volleyball', opens: 'late August', wiki: { title: 'Hawaii Rainbow Wahine volleyball', startYear: true } },
  ];

  // The venues, one record each, by size. Per venue:
  //   capacity how many people the place holds
  //   area     absent = Hilo proper (downtown, the bayfront, Waiākea and the
  //            university); 'town' = Volcano, Puna and Hāmākua, the panel's
  //            second group — the national park and the art center up in
  //            Volcano, the People's Theatre in Honokaʻa
  //   type     the event type when the title decides nothing
  //   cssVar   the hue styles.css sets for it (dark block --v-*); color
  //            the same hue as a value, for the series graph
  //   url      the venue's own events listing — not a ticket vendor
  //   icon     a mark for listings without a team crest
  //   tm       its Ticketmaster Discovery listing (fetch-events.mjs reads
  //            the venue by id — every page; several ids comma-joined read as
  //            one). exclude drops the parking, suites, tours and bundles;
  //            secondary: true makes the listing a second source behind the
  //            room's own calendar (the Eugene pattern)
  //   alias    the other spellings the feeds use for it, folded to this name
  //   feed     the room's own calendar, read by scripts/feeds.mjs; the UH
  //            Hilo Performing Arts Center's eight-month outlook, the Merrie
  //            Monarch Festival's programme, the Volcano Art Center's month
  //            pages and the Hawaii Concert Society's season are parsed in
  //            fetch-events.mjs
  //   festival a festival's days are one series (the shared filter puts the
  //            room in the panel's Festivals group)
  // Scouted and left out (README "Sources scouted"): the Lyman Museum and
  // the county's own calendar (both refuse every fetch), the East Hawaiʻi
  // Cultural Center (an exhibitions page only), Hilo Town Tavern (site
  // gone), the Akebono in Pāhoa (burned in 2017; its successor publishes no
  // calendar), the Hoʻolulu Complex beyond the Civic and the stadium, and
  // Kona's rooms — the Kahilu in Waimea and the Waikoloa resorts are the
  // Kona site's, ninety minutes across the saddle.
  var TM_EXCLUDE = /season tickets?|parking|suite|\btours?\b|ticket packages?|vip (upgrade|package|tailgate)|club (level|seating)|^half price:|\b\d+[- ]day pass|grounds pass|all[- ]session|mini[- ]plan|lawn chair|cabana/i;
  var VENUES = { // geo: [lat, lon] puts the room on the Map view (site/local-map.js); Nominatim once at build time (2026-10-25), four placed by hand
    // --- Hilo: downtown, the bayfront, the Hoʻolulu grounds, the university ---
    'Palace Theater': { // the 1925 movie palace on Haili Street, 500 seats — films, concerts, hula and the Hawaiʻi International Film Festival's Hilo week (The Events Calendar REST; Ticketmaster second)
      geo: [19.72458, -155.08651],
      capacity: 500,
      type: 'arts',
      cssVar: '--v-palace',
      color: '#ea8686',
      url: 'https://hilopalace.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=hilopalace.com&sz=128',
      tm: { id: 'KovZ917AVu-', match: '', fallbackUrl: 'https://hilopalace.com/events/', exclude: TM_EXCLUDE, secondary: true },
      feed: { kind: 'tribe', url: 'https://hilopalace.com/wp-json/tribe/events/v1/events', maxRepeat: 60, drop: /\bclass(es)?\b|workshop|rental|membership|volunteer|holiday$|^closed\b/i }, // the calendar's holiday-closure rows are notices, not shows
      alias: /palace theat|hilo palace/i,
    },
    'UH Hilo Performing Arts Center': { // the university's 600-seat hall on Kāwili Street — its eight-month outlook page (fetch-events.mjs parsePacOutlook), Ticketmaster second; closes for renovation in January 2027
      geo: [19.7031, -155.0846], // the hall at the campus's west edge (by hand — the campus does not geocode by building)
      capacity: 600,
      type: 'arts',
      cssVar: '--v-pac',
      color: '#c886ea',
      url: 'https://artscenter.uhh.hawaii.edu/future.php',
      icon: 'https://www.google.com/s2/favicons?domain=hilo.hawaii.edu&sz=128',
      tm: { id: 'Z7r9jZaAM4,KovZpZAJ6dtA', match: '', fallbackUrl: 'https://artscenter.uhh.hawaii.edu/future.php', exclude: TM_EXCLUDE, secondary: true },
      alias: /u\.? ?h\.? ?hilo performing arts|uhh performing arts|performing arts cent(er|re)|\bpac\b/i,
    },
    'Afook-Chinen Civic Auditorium': { // the county's 1950s arena on Manono Street at the Hoʻolulu Complex — the Vulcans' volleyball and basketball, the Merrie Monarch arts fair, the touring shows (Ticketmaster's id watched; the Vulcans' dates from FEEDS)
      geo: [19.71811, -155.06953],
      capacity: 3500,
      type: 'sports',
      cssVar: '--v-civic',
      color: '#8696ea',
      url: 'https://www.hawaiicounty.gov/departments/parks-and-recreation',
      icon: 'https://www.google.com/s2/favicons?domain=www.hawaiicounty.gov&sz=128',
      tm: { id: 'KovZpZAaEv1A', match: '', fallbackUrl: 'https://www.hawaiicounty.gov/departments/parks-and-recreation', exclude: TM_EXCLUDE },
      alias: /afook|civic auditorium/i,
    },
    'Merrie Monarch Festival': { // the week after Easter: the hōʻike night, Miss Aloha Hula, the group kahiko and ʻauana nights at the Edith Kanakaʻole Stadium, the hoʻolauleʻa and arts fair at the Civic, the Royal Parade downtown — its programme page (fetch-events.mjs parseMerrieMonarch), each event a row
      geo: [19.7172, -155.0668], // the Edith Kanakaʻole Stadium, Kalanikoa Street (by hand)
      capacity: 4500,
      festival: true,
      type: 'community',
      cssVar: '--v-merrie',
      color: '#eac886',
      url: 'https://www.merriemonarch.com/',
      icon: 'https://www.google.com/s2/favicons?domain=www.merriemonarch.com&sz=128',
      alias: /merrie monarch|edith kanaka.ole/i,
    },
    'Crown Room at the Grand Naniloa': { // the Banyan Drive hotel's 400-seat showroom — the Hawaii Concert Society's winter concerts (fetch-events.mjs parseConcertSociety); the hotel's own event page is drawn by script, so its local-music nights are not read
      geo: [19.72957, -155.06493],
      capacity: 400,
      type: 'concert',
      cssVar: '--v-crown',
      color: '#ea86d9',
      url: 'https://grandnaniloahilo.com/onsite-events.htm',
      icon: 'https://www.google.com/s2/favicons?domain=grandnaniloahilo.com&sz=128',
      alias: /crown room|grand naniloa|naniloa hotel/i,
    },
    'ʻImiloa Astronomy Center': { // the university's astronomy and Hawaiian-culture center above the campus — its lectures, Maunakea Skies talks and festivals (a Squarespace collection; the planetarium's daily shows are left out)
      geo: [19.70082, -155.08895],
      capacity: 300,
      type: 'community',
      cssVar: '--v-imiloa',
      color: '#86c8ea',
      url: 'https://imiloahawaii.org/event-calendar',
      icon: 'https://www.google.com/s2/favicons?domain=imiloahawaii.org&sz=128',
      feed: { kind: 'squarespace', url: 'https://imiloahawaii.org/event-calendar', drop: /workshop|\bPD\b|educator|teacher/i },
      alias: /imiloa/i,
    },
    'Vulcan Gym & Fields': { // UH Hilo's own grounds — the Vulcan Gymnasium, the soccer field and the ball park — read from the athletics department's season calendar (FEEDS, `icsfile`); the Civic's games fold to that row
      geo: [19.7005, -155.0825], // the gym and fields on the campus's lower side (by hand)
      capacity: 2000,
      type: 'sports',
      cssVar: '--v-vulcans',
      color: '#eaa786',
      url: 'https://hiloathletics.com/calendar',
      icon: 'https://www.google.com/s2/favicons?domain=hiloathletics.com&sz=128',
      alias: /vulcan (gym|soccer|softball|field)|hall stadium|wong stadium/i,
    },
    // --- Volcano, Puna and Hāmākua ---
    'Hawaiʻi Volcanoes National Park': { // Kīlauea's summit, forty minutes up the highway — the ranger programmes, concerts and cultural festival at the visitor center (the NPS events API; the daily walks and the weekly restoration mornings left out)
      geo: [19.4295, -155.2573], // the Kīlauea Visitor Center (by hand)
      capacity: 500,
      type: 'community',
      area: 'town',
      cssVar: '--v-volcanoes',
      color: '#eae186',
      url: 'https://www.nps.gov/havo/planyourvisit/calendar.htm',
      icon: 'https://www.google.com/s2/favicons?domain=www.nps.gov&sz=128',
      feed: { kind: 'nps', url: 'https://developer.nps.gov/api/v1/events?parkCode=havo', drop: /stewardship at the summit|fee[- ]free day|^explore the summit|^life on the edge/i },
      alias: /volcanoes national park|k[iī]lauea visitor|\bhavo\b/i,
    },
    'Volcano Art Center': { // the gallery in the park and the Niaulani campus in Volcano village — Hula Kahiko in the Park, concerts and talks (its EventPrime month pages, fetch-events.mjs parseVacMonth; the classes, workshops, tours and exhibition runs left out)
      geo: [19.44417, -155.20725],
      capacity: 150,
      type: 'arts',
      area: 'town',
      cssVar: '--v-vac',
      color: '#86eac8',
      url: 'https://volcanoartcenter.org/ep-events/',
      icon: 'https://www.google.com/s2/favicons?domain=volcanoartcenter.org&sz=128',
      alias: /volcano art cent|niaulani/i,
    },
    'Honokaʻa People’s Theatre': { // the 1930 plantation-town movie house on Māmane Street, 525 seats, an hour up the Hāmākua coast — its shows link to Eventbrite (`linked`; the Kona site lists it too)
      geo: [20.0787, -155.4665], // Mamane Street, Honokaʻa town (by hand)
      capacity: 525,
      type: 'concert',
      area: 'town',
      cssVar: '--v-honokaa',
      color: '#eab386',
      url: 'https://www.honokaapeople.com/now-playing',
      icon: 'https://www.google.com/s2/favicons?domain=www.honokaapeople.com&sz=128',
      feed: { kind: 'linked', url: 'https://www.honokaapeople.com/now-playing', match: /\/event-details\//, at: /honoka/i },
      alias: /honoka.a people|people.?s theat/i,
    },
  };

  // City-wide feeds (scripts/feeds.mjs): the UH Hilo Vulcans' season calendar (Sidearm's iCal file,
  // every sport, home and away) — the Hilo rows keep their LOCATION, which the aliases above fold to
  // the Civic or the campus row; the away games, the golf course and the cross-country meets go.
  var FEEDS = [
    { kind: 'icsfile', label: 'UH Hilo Vulcans', url: 'https://hiloathletics.com/calendar.ics', type: 'sports',
      rooms: /^Hilo\b/, drop: /cancel+ed|intrasquad|scrimmage|golf|cross country|exhibition/i,
      rename: [[/^\[\w\]\s*/, ''], [/^UHH\s+/, 'Vulcans ']] }, // "[W] UHH Women's Volleyball vs Dominican Penguins" → "Vulcans Women's Volleyball vs Dominican Penguins"
  ];

  // The usual view: every room on
  var DEFAULT_ON = ['Palace Theater', 'UH Hilo Performing Arts Center', 'Afook-Chinen Civic Auditorium', 'Merrie Monarch Festival', 'Crown Room at the Grand Naniloa', 'ʻImiloa Astronomy Center', 'Vulcan Gym & Fields', 'Hawaiʻi Volcanoes National Park', 'Volcano Art Center', 'Honokaʻa People’s Theatre'];
  var DEFAULT_OFF = [];
  var PREFS_KNOWN_FROM = null; // no default-off venue yet, so nothing for saved prefs to be told about

  // Event types: every event lands in exactly one, from its flags, title,
  // then venue. The rows the panel shows, in order.
  var TYPES = [
    { key: 'concert', label: 'Concerts', title: 'Live music — the Palace, the Crown Room at the Naniloa, the People’s Theatre in Honokaʻa' },
    { key: 'sports', label: 'Sports', title: 'The Vulcans at the Civic and on campus; the Rainbow Warriors and Wahine in the Teams view' },
    { key: 'arts', label: 'Arts & Theater', title: 'The Palace Theater, the Performing Arts Center and the Volcano Art Center — plays, dance, film, the touring shows' },
    { key: 'community', label: 'Community', title: 'The Merrie Monarch Festival, ʻImiloa’s talks and festivals, the national park’s programmes' },
  ];
  var MOVIE_VENUE = null; // no cinema here

  // Share codes (?f=CODE): REGISTRY is every filterable key in a fixed
  // order and a code is a bitmask over it, so the list is APPEND-ONLY —
  // adding an entry adds a bit and every existing code keeps meaning what
  // it meant; removing or reordering one changes every link out there.
  // 21 slots from the first build: 5 base-36 digits.
  var CODE_LENGTH = 5;
  var REGISTRY = [
    ['venue', 'Palace Theater'], ['venue', 'UH Hilo Performing Arts Center'], ['venue', 'Afook-Chinen Civic Auditorium'], ['venue', 'Merrie Monarch Festival'], ['venue', 'Crown Room at the Grand Naniloa'], ['venue', 'ʻImiloa Astronomy Center'], ['venue', 'Vulcan Gym & Fields'], ['venue', 'Hawaiʻi Volcanoes National Park'], ['venue', 'Volcano Art Center'], ['venue', 'Honokaʻa People’s Theatre'],
    ['badge', 'concert'], ['badge', 'sports'], ['badge', 'arts'], ['badge', 'community'],
    ['team', 'football'], ['team', 'basketball'], ['team', 'volleyball'],
    ['cap', 'stadium'], ['cap', 'arena'], ['cap', 'hall'], ['cap', 'room'],
  ];

  // The words the page uses for the place
  var WORDS = {
    teamCity: 'Hawaii', // the board drops it from the clubs' names
    presetDefault: 'Every room — the Palace, the Performing Arts Center, the Civic, the Merrie Monarch Festival, the Crown Room, ʻImiloa and the Vulcans’ grounds, the national park and the art center in Volcano, the People’s Theatre in Honokaʻa — every team and type',
    presetNeighborhood: 'Hilo proper only — the Palace Theater, the Performing Arts Center, the Civic, the Merrie Monarch Festival, the Crown Room, ʻImiloa and the Vulcans’ grounds',
    presetBig: 'Only the places that hold 2,000 or more — the Civic, the Merrie Monarch Festival at the stadium and the Vulcans’ grounds',
    phrases: { all: 'Showing everything.', none: 'Showing nothing yet — open Filter and pick some venues.', neighborhood: 'Showing Hilo proper only.', big: 'Showing the big rooms only — the Civic, the Merrie Monarch Festival and the Vulcans’ grounds.' },
  };

  // Hawaiʻi's public holidays (app.js holidaysFor reads this instead of its
  // Seattle list): the federal set without Columbus Day and Juneteenth, which
  // the state does not observe, plus its own three — Prince Kūhiō Day, King
  // Kamehameha I Day and Statehood Day — and Good Friday.
  function nthWeekday(y, month, weekday, n) { var d = new Date(y, month, 1); while (d.getDay() !== weekday) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + (n - 1) * 7); return d; }
  function lastMonday(y, month) { var d = new Date(y, month + 1, 0); while (d.getDay() !== 1) d.setDate(d.getDate() - 1); return d; }
  function easter(y) { // Gregorian computus (Meeus/Jones/Butcher)
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  var HOLIDAYS = function (y) {
    var gf = easter(y); gf.setDate(gf.getDate() - 2);
    return [
      [new Date(y, 0, 1), "New Year's Day"],
      [nthWeekday(y, 0, 1, 3), 'Martin Luther King Jr. Day'],
      [nthWeekday(y, 1, 1, 3), "Presidents' Day"],
      [new Date(y, 2, 26), 'Prince Kūhiō Day'],
      [gf, 'Good Friday'],
      [lastMonday(y, 4), 'Memorial Day'],
      [new Date(y, 5, 11), 'King Kamehameha I Day'],
      [new Date(y, 6, 4), 'Independence Day'],
      [nthWeekday(y, 7, 5, 3), 'Statehood Day'],
      [nthWeekday(y, 8, 1, 1), 'Labor Day'],
      [new Date(y, 10, 11), 'Veterans Day'],
      [nthWeekday(y, 10, 4, 4), 'Thanksgiving'],
      [new Date(y, 11, 25), 'Christmas Day'],
    ];
  };

  global.LQACity = {
    key: 'hilo',
    name: 'Hilo',
    site: 'https://hilo.here.events/',
    userAgent: 'Mozilla/5.0 (compatible; hilo-events/1.0; +https://hilo.here.events/)',
    tz: 'Pacific/Honolulu', tzName: 'Hawaii', // the city's time zone (no daylight time): the ICS feed's TZID, the game clocks, the poster's footer
    state: 'Hawaii', stateOutline: null, // no state drawing (the masthead's state strip went away 2026-10-13)
    // the calendar feed's header; the UID domain never changes (changing it
    // re-creates every event in subscribers' calendars)
    ics: { name: 'Hilo Events', short: 'Hilo Events', teams: 'Hawaiʻi teams — every season', prodid: '-//here.events//hilo-events//EN', uidDomain: 'fosdal.net', // the UID domain the whole family issues (the shared ics test pins it)
      desc: 'Upcoming events in Hilo\, HI — the Palace Theater\, UH Hilo\'s Performing Arts Center\, the Afook-Chinen Civic Auditorium\, the Merrie Monarch Festival\, the Crown Room\, ʻImiloa\, the Vulcans\, Hawaiʻi Volcanoes National Park\, the Volcano Art Center and the People\'s Theatre in Honokaʻa' },
    teams: TEAMS,
    // the Map view (site/local-map.js, the Map stop): the ground scripts/build-local-map.mjs draws into site/local-map.json
    // — the island's outline from Natural Earth (public domain), Maui and Kahoʻolawe faint beside it — with a pin on every
    // room above that carries geo: [lat, lon]. The Kona site's frame (the whole island), the labels a Hilo visitor steers by.
    map: {
      kind: 'island',
      country: 'USA',
      land: [[19.6, -155.5]], // a point on each ring to draw as land
      far: [[20.8, -156.3], [20.55, -156.6]], // the neighbours, faint
      labels: [ // the places a visitor steers by; anchor: which side of the dot the name sits
        { name: 'Hilo', lat: 19.724, lon: -155.087, anchor: 'end', dy: -8 },
        { name: 'Hilo Airport (ITO)', lat: 19.72, lon: -155.048, anchor: 'start', dy: 14 },
        { name: 'Keaʻau', lat: 19.623, lon: -155.037, anchor: 'start' },
        { name: 'Pāhoa', lat: 19.494, lon: -154.944, anchor: 'start' },
        { name: 'Volcano', lat: 19.44, lon: -155.233, anchor: 'start', dy: 12 },
        { name: 'Honokaʻa', lat: 20.08, lon: -155.467, anchor: 'start', dy: -6 },
        { name: 'Waimea', lat: 20.023, lon: -155.668, anchor: 'end' },
        { name: 'Kailua-Kona', lat: 19.64, lon: -155.996, anchor: 'end' },
        { name: 'Nāʻālehu', lat: 19.065, lon: -155.586, anchor: 'start' },
        { name: 'Mauna Kea', lat: 19.821, lon: -155.468, kind: 'peak' },
        { name: 'Mauna Loa', lat: 19.475, lon: -155.608, kind: 'peak' },
        { name: 'Kīlauea', lat: 19.421, lon: -155.287, kind: 'peak' },
      ],
    },
    venues: VENUES,
    feeds: FEEDS,
    defaultOn: DEFAULT_ON,
    defaultOff: DEFAULT_OFF,
    prefsKnownFrom: PREFS_KNOWN_FROM,
    types: TYPES,
    movieVenue: MOVIE_VENUE,
    groundsVenue: null, // every listing is read by room (or pinned to one) or folds by alias (the Vulcans' rows); fetch-events.mjs drops anything that arrives under a name city.js lacks
    codeLength: CODE_LENGTH,
    registry: REGISTRY,
    words: WORDS,
    holidays: HOLIDAYS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
