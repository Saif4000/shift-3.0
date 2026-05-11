// SHIFT 2.0 — Regional Intelligence Terminal
// No mock data. All endpoints are real, free, and key-less.

'use strict';

/* ============================================================
 * CORS PROXIES (fallback chain). Used for endpoints that lack
 * CORS headers (RSS feeds, Stooq CSV).
 * ============================================================ */
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
];

/**
 * Plain fetch with hard timeout — replaces every direct fetch() call so
 * a single slow endpoint can never hang the app indefinitely.
 */
async function fetchTimeout(url, opts = {}, timeoutMs = 8000) {
  const c = new AbortController();
  const tid = setTimeout(() => c.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: c.signal });
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Race all proxies in parallel; resolve with the first that returns 2xx.
 * Each individual attempt has its own timeout — if every proxy stalls,
 * we abandon them all instead of waiting forever.
 */
async function proxyFetch(url, opts = {}, timeoutMs = 8000) {
  const controllers = PROXIES.map(() => new AbortController());
  const timers = controllers.map((c) => setTimeout(() => c.abort(), timeoutMs));
  let winnerIdx = -1;
  const tries = PROXIES.map((wrap, i) =>
    fetch(wrap(url), { ...opts, cache: 'no-store', signal: controllers[i].signal })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (winnerIdx === -1) {
          winnerIdx = i;
          controllers.forEach((c, j) => {
            if (j !== i) { try { c.abort(); } catch {} clearTimeout(timers[j]); }
          });
        }
        return r;
      })
  );
  try {
    const winner = await Promise.any(tries);
    if (winnerIdx >= 0) clearTimeout(timers[winnerIdx]);
    return winner;
  } catch {
    timers.forEach((t) => clearTimeout(t));
    throw new Error('all proxies failed for ' + url);
  }
}

/* ============================================================
 * LOCAL CACHE — stale-while-revalidate for perceived speed.
 * ============================================================ */
const CACHE_PREFIX = 'shift:cache:';
function cacheGet(key, ttlMs) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (ttlMs != null && Date.now() - t > ttlMs) return { stale: true, value: v, age: Date.now() - t };
    return { stale: false, value: v, age: Date.now() - t };
  } catch { return null; }
}
function cacheSet(key, value) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value })); } catch {}
}

/* ============================================================
 * NEWS SOURCES — credible regional outlets, RSS feeds.
 * Arabic GCC sources are headline-translated to English.
 * ============================================================ */
const SOURCES = [
  // ---- Regional MENA / GCC ----
  { id: 'aje',     name: 'Al Jazeera EN',     url: 'https://www.aljazeera.com/xml/rss/all.xml',                region: 'QA',   lang: 'en' },
  { id: 'toi',     name: 'Times of Israel',   url: 'https://www.timesofisrael.com/feed/',                      region: 'IL',   lang: 'en' },
  { id: 'jp',      name: 'Jerusalem Post',    url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx',         region: 'IL',   lang: 'en' },
  { id: 'ynet',    name: 'Ynetnews',          url: 'https://www.ynetnews.com/Integration/StoryRss3082.xml',    region: 'IL',   lang: 'en' },
  { id: 'haaretz', name: 'Haaretz EN',        url: 'https://www.haaretz.com/srv/htz-rss-eng',                  region: 'IL',   lang: 'en' },
  { id: 'i24-rss', name: 'i24NEWS',           url: 'https://news.google.com/rss/search?q=site:i24news.tv&when:1d&hl=en-US&gl=US&ceid=US:en', region: 'IL', lang: 'en' },
  { id: 'ihayom',  name: 'Israel Hayom',      url: 'https://www.israelhayom.com/feed/',                        region: 'IL',   lang: 'en' },
  { id: 'globes',  name: 'Globes (biz)',      url: 'https://news.google.com/rss/search?q=site:globes.co.il&when:1d&hl=en-US&gl=US&ceid=US:en', region: 'IL', lang: 'en' },
  { id: 'arutz',   name: 'Israel Nat. News',  url: 'https://www.israelnationalnews.com/Rss.aspx',              region: 'IL',   lang: 'en' },
  { id: 'tn',      name: 'The National UAE',  url: 'https://www.thenationalnews.com/rss/uae',                  region: 'AE',   lang: 'en' },
  { id: 'tnmena',  name: 'The National MENA', url: 'https://www.thenationalnews.com/rss/mena',                 region: 'AE',   lang: 'en' },
  { id: 'an',      name: 'Arab News',         url: 'https://www.arabnews.com/rss.xml',                         region: 'SA',   lang: 'en' },
  { id: 'kt',      name: 'Khaleej Times',     url: 'https://www.khaleejtimes.com/rss',                         region: 'AE',   lang: 'en' },
  // Middle East Eye removed — known editorial bias (Qatar-linked funding allegations).

  // ---- UAE official / state channels ----
  { id: 'wam',      name: 'WAM (Emirates News)', url: 'https://news.google.com/rss/search?q=site:wam.ae&when:2d&hl=en-US&gl=US&ceid=US:en', region: 'AE-GOV', lang: 'en' },
  { id: 'modgovae', name: 'UAE MoD',             url: 'https://rsshub.app/instagram/user/modgovae',                    region: 'AE-MOD', lang: 'en' },
  { id: 'moiuae',   name: 'UAE MoI',             url: 'https://rsshub.app/instagram/user/moiuae',                      region: 'AE-MOI', lang: 'en' },
  { id: 'barq',     name: 'UAE Barq',            url: 'https://rsshub.app/instagram/user/uae_barq_en',                 region: 'AE',    lang: 'en' },
  { id: 'mofa-ae',  name: 'UAE MoFA',            url: 'https://news.google.com/rss/search?q=%22UAE+Ministry+of+Foreign+Affairs%22+OR+site:mofaic.gov.ae&when:3d&hl=en-US&gl=US&ceid=US:en', region: 'AE-GOV', lang: 'en' },
  { id: 'uaegov',   name: 'UAE Government',      url: 'https://news.google.com/rss/search?q=site:u.ae+OR+%22UAE+Government+Media+Office%22&when:3d&hl=en-US&gl=US&ceid=US:en', region: 'AE-GOV', lang: 'en' },
  { id: 'ncema',    name: 'NCEMA UAE',           url: 'https://news.google.com/rss/search?q=NCEMA+OR+%22National+Emergency+Crisis%22+UAE&when:3d&hl=en-US&gl=US&ceid=US:en', region: 'AE-GOV', lang: 'en' },
  { id: 'adpolice', name: 'Abu Dhabi Police',    url: 'https://news.google.com/rss/search?q=%22Abu+Dhabi+Police%22+OR+ADPoliceHQ&when:3d&hl=en-US&gl=US&ceid=US:en', region: 'AE-POL', lang: 'en' },
  { id: 'dubaipol', name: 'Dubai Police',        url: 'https://news.google.com/rss/search?q=%22Dubai+Police%22+OR+DubaiPoliceHQ&when:3d&hl=en-US&gl=US&ceid=US:en', region: 'AE-POL', lang: 'en' },
  { id: 'forsan',   name: 'Forsan UAE',           url: 'https://rsshub.app/instagram/user/forsan_emirates',                                                                                       region: 'AE-MOD', lang: 'en' },
  { id: 'forsan-gn',name: 'Forsan via news',      url: 'https://news.google.com/rss/search?q=%22Forsan%22+(UAE+OR+Emirates+OR+military)&when:3d&hl=en-US&gl=US&ceid=US:en',                       region: 'AE-MOD', lang: 'en' },
  { id: 'rt-me',   name: 'Reuters MENA',      url: 'https://news.google.com/rss/search?q=site:reuters.com+(Israel+OR+Iran+OR+Gulf+OR+Saudi+OR+UAE+OR+Gaza)+when:1d&hl=en-US&gl=US&ceid=US:en', region: 'WIRE', lang: 'en' },
  { id: 'bbc-me',  name: 'BBC Middle East',   url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',  region: 'REG',  lang: 'en' },
  { id: 'alar',    name: 'Al Arabiya (AR)',   url: 'https://www.alarabiya.net/.mrss/ar.xml',                   region: 'SA',   lang: 'ar' },

  // ---- US wires / American press ----
  { id: 'nyt-world', name: 'NYT World',       url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',   region: 'US',   lang: 'en' },
  { id: 'nyt-bus',   name: 'NYT Business',    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',region: 'US',   lang: 'en' },
  { id: 'wsj-mkt',   name: 'WSJ Markets',     url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',            region: 'US',   lang: 'en' },
  { id: 'wsj-world', name: 'WSJ World',       url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',              region: 'US',   lang: 'en' },
  { id: 'cnn-top',   name: 'CNN Top',         url: 'http://rss.cnn.com/rss/cnn_topstories.rss',                region: 'US',   lang: 'en' },
  { id: 'cnn-world', name: 'CNN World',       url: 'http://rss.cnn.com/rss/cnn_world.rss',                     region: 'US',   lang: 'en' },
  { id: 'bbg',       name: 'Bloomberg',       url: 'https://news.google.com/rss/search?q=site:bloomberg.com&when:1d&hl=en-US&gl=US&ceid=US:en', region: 'US', lang: 'en' },
  { id: 'reuters-us',name: 'Reuters US',      url: 'https://news.google.com/rss/search?q=site:reuters.com+(US+OR+Fed+OR+%22White+House%22+OR+Congress)&when:1d&hl=en-US&gl=US&ceid=US:en', region: 'US', lang: 'en' },
  { id: 'ap',        name: 'AP News',         url: 'https://news.google.com/rss/search?q=site:apnews.com&when:1d&hl=en-US&gl=US&ceid=US:en', region: 'US', lang: 'en' },
  { id: 'sp500',     name: 'S&P 500 / Fed',   url: 'https://news.google.com/rss/search?q=%22S%26P+500%22+OR+%22Federal+Reserve%22+OR+%22Treasury+yield%22&when:1d&hl=en-US&gl=US&ceid=US:en', region: 'MKT',  lang: 'en' },

  // ---- Multilateral / Global health ----
  { id: 'who',       name: 'WHO',             url: 'https://www.who.int/rss-feeds/news-english.xml',            region: 'UN',   lang: 'en' },
  { id: 'un',        name: 'UN News',         url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',    region: 'UN',   lang: 'en' },

  // ---- Defense / geopolitics analysis ----
  { id: 'dod',       name: 'DOD News',        url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=20', region: 'US',  lang: 'en' },
  { id: 'state',     name: 'State Dept',      url: 'https://news.google.com/rss/search?q=site:state.gov&when:1d&hl=en-US&gl=US&ceid=US:en', region: 'US',  lang: 'en' },
  { id: 'diplomat',  name: 'The Diplomat',    url: 'https://thediplomat.com/feed/',                              region: 'ANALYSIS', lang: 'en' },
  { id: 'stratfor',  name: 'Stratfor',        url: 'https://news.google.com/rss/search?q=site:stratfor.com&when:2d&hl=en-US&gl=US&ceid=US:en', region: 'ANALYSIS', lang: 'en' },

  // ---- Aggregators (alternative to GDELT) ----
  { id: 'r-world',   name: 'Reddit Worldnews', url: 'https://www.reddit.com/r/worldnews/.rss?limit=25',           region: 'AGG',  lang: 'en' },
  { id: 'r-mena',    name: 'Reddit MENA',      url: 'https://www.reddit.com/r/MiddleEastNews/.rss?limit=25',      region: 'AGG',  lang: 'en' },
  { id: 'r-geo',     name: 'Reddit Geopol',    url: 'https://www.reddit.com/r/geopolitics/.rss?limit=25',         region: 'AGG',  lang: 'en' },
  { id: 'r-syria',   name: 'Reddit Syria',     url: 'https://www.reddit.com/r/syriancivilwar/.rss?limit=25',      region: 'AGG',  lang: 'en' },

  // ---- AI / tech ----
  { id: 'tc-ai',     name: 'TechCrunch AI',   url: 'https://techcrunch.com/category/artificial-intelligence/feed/', region: 'TECH', lang: 'en' },
  { id: 'verge-ai',  name: 'The Verge AI',    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', region: 'TECH', lang: 'en' },
  { id: 'mit-tr',    name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/',                    region: 'TECH', lang: 'en' },
  { id: 'ai-news',   name: 'AI News',         url: 'https://news.google.com/rss/search?q=%22OpenAI%22+OR+%22Anthropic%22+OR+%22DeepMind%22+OR+(AI+model)&when:1d&hl=en-US&gl=US&ceid=US:en', region: 'TECH', lang: 'en' },
];

/* User-added sources (persisted in localStorage). Combined with SOURCES at fetch time. */
let CUSTOM_SOURCES = [];
function loadCustomSources() {
  try { CUSTOM_SOURCES = JSON.parse(localStorage.getItem('shift:custom:sources') || '[]'); } catch { CUSTOM_SOURCES = []; }
}
function saveCustomSources() {
  try { localStorage.setItem('shift:custom:sources', JSON.stringify(CUSTOM_SOURCES)); } catch {}
}
function getAllSources() { return [...SOURCES, ...CUSTOM_SOURCES]; }
loadCustomSources();

/* ============================================================
 * MARKET TICKERS
 *   Stooq CSV (commodities, indices, DXY)
 *   Frankfurter (FX vs USD)
 *   CoinGecko (crypto)
 * ============================================================ */
/**
 * Market tickers — each tries Yahoo Finance first (proxy-friendly JSON),
 * then falls back to Stooq CSV. Internal key (`sym`) is preserved so the
 * UI doesn't care which provider answered.
 */
const STOOQ_TICKERS = [
  { sym: 'cl.f',  yahoo: 'CL=F',   label: 'WTI',    unit: '$', group: 'energy' },
  { sym: 'b.f',   yahoo: 'BZ=F',   label: 'BRENT',  unit: '$', group: 'energy' },
  { sym: 'ng.f',  yahoo: 'NG=F',   label: 'NATGAS', unit: '$', group: 'energy' },
  { sym: 'gc.f',  yahoo: 'GC=F',   label: 'GOLD',   unit: '$', group: 'metals' },
  { sym: 'si.f',  yahoo: 'SI=F',   label: 'SILVER', unit: '$', group: 'metals' },
  { sym: '^spx',  yahoo: '^GSPC',  label: 'S&P 500',unit: '',  group: 'index'  },
  { sym: '^dji',  yahoo: '^DJI',   label: 'DOW',    unit: '',  group: 'index'  },
  { sym: '^ndq',  yahoo: '^IXIC',  label: 'NDQ',    unit: '',  group: 'index'  },
  { sym: '^ta35', yahoo: '^TA125.TA', label: 'TA-125', unit: '', group: 'index' },
  { sym: 'dx.f',  yahoo: 'DX-Y.NYB', label: 'DXY',  unit: '',  group: 'fx'     },
];

const FX_PAIRS  = ['ILS','AED','SAR','EGP','QAR','EUR','GBP','TRY','JPY'];
const CRYPTO_IDS = ['bitcoin','ethereum'];

/* ============================================================
 * AIRCRAFT / NOTAMs
 *   OpenSky Network — bounded query (1 credit/call, ~400/day anon)
 *   AviationAPI    — free FAA NOTAM proxy, no key
 * ============================================================ */
const MENA_BBOX = { lamin: 10, lamax: 45, lomin: 20, lomax: 70 };
/* GCC airports — ICAO codes
 * UAE: Dubai (OMDB), Abu Dhabi (OMAA), Sharjah (OMSJ)
 * QA:  Doha Hamad (OTHH)
 * SA:  Riyadh (OERK), Jeddah (OEJN), Dammam (OEDF)
 * BH:  Bahrain (OBBI) · KW: Kuwait (OKBK) · OM: Muscat (OOMS)
 */
const NOTAM_AIRPORTS = ['OMDB','OMAA','OMSJ','OTHH','OERK','OEJN','OEDF','OBBI','OKBK','OOMS'];
const NOTAM_AIRPORT_NAMES = {
  OMDB:'Dubai', OMAA:'Abu Dhabi', OMSJ:'Sharjah',
  OTHH:'Doha', OERK:'Riyadh', OEJN:'Jeddah', OEDF:'Dammam',
  OBBI:'Bahrain', OKBK:'Kuwait', OOMS:'Muscat',
};

/* Map presets — center, zoom, OpenSky bounding box */
const MAP_PRESETS = {
  // Widened from 22-27N/51-57E so the OpenSky query covers the busy DXB/AUH
  // approach corridors + Hormuz transit — narrow box returned zero hits.
  uae:    { center: [24.5,   54.4],  zoom: 7, bbox: { lamin: 20, lamax: 28, lomin: 49, lomax: 60 } },
  hormuz: { center: [26.566, 56.25], zoom: 7, bbox: { lamin: 22, lamax: 30, lomin: 50, lomax: 62 } },
  mena:   { center: [27.0,   42.0],  zoom: 4, bbox: { lamin: 10, lamax: 45, lomin: 20, lomax: 70 } },
  redsea: { center: [20.0,   38.0],  zoom: 5, bbox: { lamin: 10, lamax: 30, lomin: 30, lomax: 46 } },
  med:    { center: [37.0,   18.0],  zoom: 5, bbox: { lamin: 30, lamax: 45, lomin: -5, lomax: 36 } },
  global: { center: [25.0,   30.0],  zoom: 3, bbox: { lamin: -10, lamax: 60, lomin: -20, lomax: 90 } },
};
let activePreset = 'uae';

/* Maritime chokepoints — mil-style markers w/ range rings (nautical miles) */
const CHOKEPOINTS = [
  { code: 'HRMZ', name: 'STRAIT OF HORMUZ', lat: 26.566, lon: 56.250, rings_nm: [50, 100, 200] },
  { code: 'BAB',  name: 'BAB EL-MANDEB',    lat: 12.583, lon: 43.333, rings_nm: [50, 100] },
  { code: 'SUEZ', name: 'SUEZ CANAL',       lat: 30.583, lon: 32.275, rings_nm: [50] },
  { code: 'BOSP', name: 'BOSPHORUS',        lat: 41.117, lon: 29.067, rings_nm: [50] },
  { code: 'GIB',  name: 'GIBRALTAR',        lat: 35.967, lon: -5.483, rings_nm: [50] },
];

/* YouTube live channels — embed via /embed/live_stream?channel=ID
 * Each channel's live stream is embedded directly; if it isn't live at a
 * given moment YouTube returns its standard "no current live stream" tile. */
/**
 * LIVE roster — user-curated. Uses channel-live-stream embed URLs (not
 * hardcoded video IDs) because the IDs rotate every few months and break the
 * embed. The channel URL always picks up whatever the channel is currently
 * streaming live.
 */
const LIVE_CHANNELS = [
  { channelId: 'UCIALMKvObZNtJ6AmdCLP7Lg', name: 'BLOOMBERG TV',     desk: 'NEW YORK · US' },
  { channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', name: 'AL JAZEERA EN',    desk: 'DOHA · QA' },
  { channelId: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', name: 'FRANCE 24 EN',     desk: 'PARIS · FR' },
  { channelId: 'UCknLrEdhRCp1aegoMqRaCZg', name: 'DW NEWS',          desk: 'BERLIN · DE' },
  { channelId: 'UC7fWeaHhqgM4Ry-RMpM2YYw', name: 'TRT WORLD',        desk: 'ISTANBUL · TR' },
  { channelId: 'UCeY0bbntWzzVIaj2z3QigXg', name: 'NBC NEWS NOW',     desk: 'NEW YORK · US' },
  { channelId: 'UCpVm7bg6pXKo1Pr6k5kxG9A', name: 'NAT GEO',          desk: 'WASHINGTON · US' },
];

const LIVE_AUTO_LOAD = 4;

/* ============================================================
 * STATE
 * ============================================================ */
const state = {
  items: [],
  markets: {},
  fx: {},
  crypto: {},
  tensions: [],
  aircraft: [],
  aircraftFetchedAt: 0,
  notams: [],
  sourceStatus: {},
  lastUpdate: null,
  searchActive: false,
  searchQuery: '',
  searchGdelt: [],
  focusedIdx: -1,
  modalItem: null,
  modalList: [],
  modalIdx: 0,
};

/* ===== Hydrate from localStorage immediately so first paint shows data ===== */
(function hydrate() {
  const news    = cacheGet('news',    null);
  const markets = cacheGet('markets', null);
  const fx      = cacheGet('fx',      null);
  const crypto  = cacheGet('crypto',  null);
  const tens    = cacheGet('tensions',null);
  const not     = cacheGet('notams',  null);
  if (news?.value)    state.items   = (news.value || []).map((it) => ({ ...it, date: new Date(it.date) }));
  if (markets?.value) state.markets = markets.value;
  if (fx?.value)      state.fx      = fx.value;
  if (crypto?.value)  state.crypto  = crypto.value;
  if (tens?.value)    state.tensions = (tens.value || []).map((t) => ({ ...t, date: new Date(t.date) }));
  if (not?.value)     state.notams   = not.value;
})();

/* ============================================================
 * UTIL
 * ============================================================ */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );

function fmtTimeUTC(d) {
  if (!(d instanceof Date) || isNaN(d)) return '--:--';
  return d.toISOString().slice(11, 16) + 'Z';
}
function fmtAgo(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) return 'now';
  if (s < 60)    return Math.floor(s) + 's';
  if (s < 3600)  return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function fmtNum(n, dec) {
  if (n == null || isNaN(n)) return '—';
  if (dec == null) {
    const abs = Math.abs(n);
    dec = abs >= 1000 ? 2 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
  }
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ============================================================
 * TOPIC CLASSIFIER (keyword based — deterministic, no AI)
 * ============================================================ */
const KW = {
  security: /\b(missile|strike|airstrike|attack|drone|UAV|IDF|IRGC|Houth(i|is)|Hezbollah|Hamas|terror(ist)?|war|combat|raid|killed|casualt|hostage|militant|rocket|cross[- ]?border|cease[- ]?fire|truce|gun(fire|men)?|assault|insurg|jihad|ISIS|al[- ]?Qaeda|kidnap|nuclear|enrich|warhead|battalion|brigade|skirmish|ambush|sabotag|cyber[- ]?attack|spyware)/i,
  politics: /\b(minister|president|parliament|election|summit|talks|negotiat|diplomat|embassy|sanction|treaty|accord|agreement|coalition|cabinet|envoy|relations|alliance|visit|condemn|statement|policy|government|knesset|majlis|premier|chancellor|ambassador|resolution|veto|UN|Security Council|G7|G20|OPEC\+?)/i,
  economy:  /\b(oil|gas|OPEC|GDP|inflation|budget|bank|stock|market|exchange|trade|tariff|IMF|currency|fund|invest|deal|merger|acquisition|earnings|revenue|profit|loss|barrel|crude|brent|WTI|gold|dirham|riyal|shekel|aramco|adnoc|tadawul|DFM|TASI|TA[- ]?35|interest rate|hike|cut|bond|yield|recession|growth|export|import|IPO|sovereign wealth|PIF|mubadala|ADQ|Fed|Treasury|S&P|Dow|Nasdaq)/i,
  ai:       /\b(artificial intelligence|machine learning|\bAI\b|\bLLM\b|\bGPT-?\d?|ChatGPT|Claude|OpenAI|Anthropic|DeepMind|Gemini|Llama|Mistral|neural network|generative AI|foundation model|RLHF|fine[- ]?tun|inference|copilot|stable diffusion|midjourney|nvidia|H100|H200|B200|tensor|datacenter|chatbot|prompt|hallucinat|AGI|deepfake|frontier model)/,
  health:   /\b(WHO|outbreak|epidemic|pandemic|vaccin|disease|virus|cholera|measles|ebola|polio|HIV|malaria|TB|tuberculosis|cancer|maternal|public health|UNICEF|FDA|CDC)/i,
};

function classify(title, summary = '') {
  const text = title + ' ' + summary;
  const tags = [];
  if (KW.security.test(text)) tags.push('security');
  if (KW.politics.test(text)) tags.push('politics');
  if (KW.economy.test(text))  tags.push('economy');
  if (KW.ai.test(text))       tags.push('ai');
  if (KW.health.test(text))   tags.push('health');
  if (tags.length === 0)      tags.push('politics');
  return tags;
}

/* ============================================================
 * RSS / ATOM PARSER
 * ============================================================ */
function parseRSS(xmlText, source) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  } catch {
    return [];
  }
  // Detect parse errors
  if (doc.querySelector('parsererror')) {
    doc = new DOMParser().parseFromString(xmlText, 'text/html');
  }
  const items = [];
  const nodes = doc.querySelectorAll('item, entry');
  nodes.forEach((el) => {
    const titleEl = el.querySelector('title');
    if (!titleEl) return;
    const title = (titleEl.textContent || '').trim();
    if (!title) return;

    // link extraction handles both RSS <link>TEXT</link> and Atom <link href="..."/>
    let link = '';
    const linkAlt = el.querySelector('link[rel="alternate"]');
    if (linkAlt) link = linkAlt.getAttribute('href') || '';
    if (!link) {
      const l = el.querySelector('link');
      if (l) link = l.textContent?.trim() || l.getAttribute('href') || '';
    }
    if (!link) {
      const guid = el.querySelector('guid');
      if (guid && /^https?:/i.test(guid.textContent || '')) link = guid.textContent.trim();
    }

    const dateRaw =
      el.querySelector('pubDate')?.textContent ||
      el.querySelector('published')?.textContent ||
      el.querySelector('updated')?.textContent ||
      el.getElementsByTagName('dc:date')[0]?.textContent ||
      null;

    const descRaw =
      el.querySelector('description')?.textContent ||
      el.querySelector('summary')?.textContent ||
      el.querySelector('content')?.textContent ||
      '';
    const desc = descRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);

    const date = dateRaw ? new Date(dateRaw) : new Date();

    items.push({
      id: source.id + ':' + (link || title),
      title,
      link,
      summary: desc,
      date: isNaN(date.getTime()) ? new Date() : date,
      source: source.name,
      sourceId: source.id,
      region: source.region,
      lang: source.lang,
      tags: classify(title, desc),
    });
  });
  return items;
}

/* ============================================================
 * TRANSLATION (MyMemory — free, no key, CORS-friendly)
 * Cached in localStorage to respect 5000-char/day anon limit.
 * ============================================================ */
const TR_PREFIX = 'shift:tr:';
const tCache = {};

async function translate(text, from = 'ar', to = 'en') {
  if (!text || /^[\x00-\x7F]+$/.test(text)) return text; // already ASCII
  if (tCache[text]) return tCache[text];
  try {
    const ls = localStorage.getItem(TR_PREFIX + text);
    if (ls) { tCache[text] = ls; return ls; }
  } catch {}
  try {
    const r = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`
    );
    const j = await r.json();
    const out = j?.responseData?.translatedText;
    if (out && typeof out === 'string' && !/MYMEMORY WARNING/i.test(out)) {
      tCache[text] = out;
      try { localStorage.setItem(TR_PREFIX + text, out); } catch {}
      return out;
    }
  } catch {}
  return text;
}

/* ============================================================
 * NEWS FETCH
 * ============================================================ */
async function fetchSource(src) {
  state.sourceStatus[src.id] = { status: 'wait', count: 0, name: src.name };
  try {
    // 1) Server-side /api/news (browser UA, edge-cached) — most reliable
    let text = '';
    try {
      const r = await fetchTimeout(`/api/news?url=${encodeURIComponent(src.url)}`, {}, 9000);
      if (r.ok) text = await r.text();
    } catch {}
    // 2) Public-proxy fallback (only if server-side returned nothing)
    if (!text || text.length < 80) {
      const r = await proxyFetch(src.url);
      text = await r.text();
    }
    let items = parseRSS(text, src).slice(0, 15);

    if (src.lang === 'ar') {
      // Translate first 6 headlines per source — stays well under daily limit
      const toTr = items.slice(0, 6);
      await Promise.all(
        toTr.map(async (it) => {
          const en = await translate(it.title, 'ar', 'en');
          if (en && en !== it.title) {
            it.originalTitle = it.title;
            it.title = en;
            it.tags = classify(it.title, it.summary);
          }
        })
      );
      items = toTr; // only show translated ones
    }

    state.sourceStatus[src.id] = { status: 'ok', count: items.length, name: src.name };
    return items;
  } catch (e) {
    console.warn('[source]', src.id, 'failed:', e.message);
    state.sourceStatus[src.id] = { status: 'err', count: 0, name: src.name, error: e.message };
    return [];
  }
}

function mergeAndDedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  out.sort((a, b) => b.date - a.date);
  return out.slice(0, 250);
}

/**
 * Fire every source in parallel. Render incrementally as each completes so
 * the deck populates progressively rather than waiting for the slowest feed.
 */
async function fetchAllNews() {
  const buf = [];
  const tasks = getAllSources().map((src) =>
    tracked(() => fetchSource(src).then((items) => {
      if (!items.length) return;
      buf.push(...items);
      state.items = mergeAndDedupe(buf.concat(state.items));
      if (!['map','live','markets','tensions','sources'].includes(activeTab) && !state.searchActive) {
        renderContent();
      }
      renderBanner();
      renderThreatWatch();
      updateFooter();
    }))
  );
  await Promise.allSettled(tasks);
  cacheSet('news', state.items.slice(0, 200));
  renderThreatWatch();
}

/* ============================================================
 * MARKETS — STOOQ CSV
 * ============================================================ */
async function fetchYahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
  try {
    const r = await proxyFetch(url, {}, 8000);
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    const prev  = meta.chartPreviousClose ?? meta.previousClose;
    if (price == null || isNaN(price)) return null;
    let pct = null, change = null;
    if (prev != null && !isNaN(prev) && prev !== 0) {
      change = price - prev;
      pct = (change / prev) * 100;
    }
    return { price, pct, change };
  } catch (e) {
    console.warn('[yahoo]', sym, e.message);
    return null;
  }
}

async function fetchStooq(sym) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcvpn&h&e=csv`;
  try {
    const r = await proxyFetch(url, {}, 8000);
    const text = (await r.text()).trim();
    // Stooq sometimes returns N/D for off-hours; guard against that and against
    // proxies that return HTML error pages.
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return null;
    if (!/^Symbol[, ]/i.test(lines[0])) return null;
    const cols = lines[1].split(',');
    const open   = parseFloat(cols[3]);
    const close  = parseFloat(cols[6]);
    const pctRaw = cols[8];
    if (isNaN(close) || close === 0) return null;
    let pct = null;
    if (pctRaw && pctRaw !== 'N/D' && pctRaw !== 'N/A') {
      const cleaned = String(pctRaw).replace(/[%\s]/g, '');
      const n = parseFloat(cleaned);
      if (!isNaN(n)) pct = n;
    }
    if (pct == null && !isNaN(open) && open !== 0) {
      pct = ((close - open) / open) * 100;
    }
    const change = pct != null ? (close * pct) / 100 : null;
    return { price: close, pct, change };
  } catch (e) {
    console.warn('[stooq]', sym, e.message);
    return null;
  }
}

/** Try Yahoo first; if that returns nothing, try Stooq. */
async function fetchOneTicker(t) {
  if (t.yahoo) {
    const y = await fetchYahoo(t.yahoo);
    if (y) return y;
  }
  if (t.sym) {
    const s = await fetchStooq(t.sym);
    if (s) return s;
  }
  return null;
}

async function fetchMarkets() {
  // Primary path: our /api/markets edge function. It hits Yahoo Finance
  // server-side (no CORS, no bot detection on public proxies) with a Stooq
  // fallback, and caches at the edge for 60s.
  try {
    const r = await fetchTimeout('/api/markets', {}, 10000);
    if (r.ok) {
      const j = await r.json();
      if (j.ok && Array.isArray(j.results)) {
        const partial = { ...state.markets };
        j.results.forEach((t) => {
          if (t.price == null || isNaN(t.price)) return;
          partial[t.sym] = {
            price: t.price, pct: t.pct, change: t.change,
            label: t.label, unit: t.unit, group: t.group,
            source: t.source,
          };
        });
        state.markets = partial;
        renderTicker();
        if (activeTab === 'markets' && !state.searchActive) renderContent();
        cacheSet('markets', state.markets);
        return;
      }
    }
  } catch (e) {
    console.warn('[markets-api]', e.message);
  }

  // Last-resort fallback: original client-side CORS-proxy path
  const partial = { ...state.markets };
  await Promise.allSettled(
    STOOQ_TICKERS.map(async (t) => {
      const m = await fetchOneTicker(t);
      if (!m) return;
      partial[t.sym] = { ...m, label: t.label, unit: t.unit, group: t.group };
      state.markets = { ...partial };
      renderTicker();
      if (activeTab === 'markets' && !state.searchActive) renderContent();
    })
  );
  cacheSet('markets', state.markets);
}

/**
 * Pull live oil spot prices from our /api/oil edge function (which proxies
 * OilPriceAPI server-side so the API key never reaches the browser). Overlays
 * the spot price on top of whatever Yahoo/Stooq already returned — keeps
 * Yahoo's % change. Silently no-ops if the env var isn't set (503).
 */
async function fetchOilPriceAPI() {
  try {
    const r = await fetchTimeout('/api/oil', {}, 9000);
    if (!r.ok) {
      state.oilApiStatus = r.status === 503 ? 'no-key' : 'err';
      return;
    }
    const j = await r.json();
    if (!j.ok || !Array.isArray(j.results)) { state.oilApiStatus = 'err'; return; }
    let applied = 0;
    j.results.forEach((entry) => {
      if (entry.price == null || isNaN(entry.price)) return;
      const k = entry.localKey;
      const existing = state.markets[k] || {};
      state.markets[k] = {
        ...existing,
        price: entry.price,
        label: existing.label || entry.label,
        unit:  existing.unit  || entry.unit,
        group: 'energy',
        opa: true,
      };
      applied++;
    });
    state.oilApiStatus = applied > 0 ? 'ok' : 'empty';
    renderTicker();
    if (activeTab === 'markets' && !state.searchActive) renderContent();
    cacheSet('markets', state.markets);
  } catch (e) {
    state.oilApiStatus = 'err';
    console.warn('[oil-api]', e.message);
  }
}

/* ============================================================
 * FX — Frankfurter (native CORS, no key)
 * ============================================================ */
async function fetchFX() {
  // Primary: server-side /api/fx (Frankfurter .dev primary, .app fallback,
  // exchangerate.host last-resort). Avoids client-side CORS quirks.
  try {
    const r = await fetchTimeout('/api/fx', {}, 8000);
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.rates) {
        state.fx = j.rates;
        cacheSet('fx', state.fx);
        return;
      }
    }
  } catch (e) { console.warn('[fx-api]', e.message); }

  // Fallback: direct (may work; both Frankfurter domains support CORS)
  try {
    const r = await fetchTimeout(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${FX_PAIRS.join(',')}`, {}, 6000);
    const j = await r.json();
    if (j?.rates) { state.fx = j.rates; cacheSet('fx', state.fx); }
  } catch (e) { console.warn('[fx-direct]', e.message); }
}

/* ============================================================
 * CRYPTO — CoinGecko (native CORS, no key)
 * ============================================================ */
async function fetchCrypto() {
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO_IDS.join(',')}&vs_currencies=usd&include_24hr_change=true`
    );
    const j = await r.json();
    state.crypto = j || {};
    cacheSet('crypto', state.crypto);
  } catch (e) {
    console.warn('[crypto]', e.message);
  }
}

/* ============================================================
 * GDELT TENSIONS — native CORS, no key
 * ============================================================ */
/** GDELT 'language' field comes back as a name or 3-letter code — both map here. */
const LANG_TO_CODE = {
  arabic:'ar',  ara:'ar',
  hebrew:'he',  heb:'he',
  russian:'ru', rus:'ru',
  persian:'fa', farsi:'fa', per:'fa', fas:'fa',
  turkish:'tr', tur:'tr',
  french:'fr',  fra:'fr', fre:'fr',
  german:'de',  deu:'de', ger:'de',
  spanish:'es', spa:'es',
  italian:'it', ita:'it',
  portuguese:'pt', por:'pt',
  chinese:'zh', zho:'zh', chi:'zh',
  japanese:'ja', jpn:'ja',
  korean:'ko',  kor:'ko',
  urdu:'ur',    urd:'ur',
  hindi:'hi',   hin:'hi',
};
function langToCode(lang) {
  if (!lang) return null;
  return LANG_TO_CODE[String(lang).toLowerCase().trim()] || null;
}

async function fetchTensions() {
  const q = '(Iran OR Gaza OR Houthi OR Hezbollah OR Hamas OR Israel OR UAE OR "Red Sea" OR "Saudi Arabia" OR Lebanon OR Syria OR Yemen) (strike OR attack OR missile OR drone OR clash OR military OR raid OR rocket)';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=40&format=json&sort=DateDesc&timespan=24h`;
  try {
    const r = await fetchTimeout(url, {}, 9000);
    if (!r.ok) throw new Error('GDELT ' + r.status);
    const j = await r.json();
    const articles = (j.articles || []).map((a) => ({
      title: a.title,
      url: a.url,
      domain: a.domain,
      date: parseGdeltDate(a.seendate),
      country: a.sourcecountry,
      language: a.language,
    }));

    // Translate non-English headlines via MyMemory (cached). Capped at first
    // ~20 to stay inside the free 5000-char/day quota.
    const candidates = articles.slice(0, 20)
      .map((it, i) => ({ it, i, code: langToCode(it.language) }))
      .filter((x) => x.code && x.code !== 'en');
    await Promise.all(candidates.map(async ({ it, code }) => {
      try {
        const en = await translate(it.title, code, 'en');
        if (en && en !== it.title) {
          it.originalTitle = it.title;
          it.title = en;
        }
      } catch {}
    }));

    state.tensions = articles;
    cacheSet('tensions', state.tensions);
  } catch (e) {
    console.warn('[gdelt]', e.message);
  }
}
function parseGdeltDate(s) {
  // GDELT: YYYYMMDDTHHMMSSZ
  if (!s) return new Date();
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(s);
  if (!m) return new Date(s);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/* ============================================================
 * AIRCRAFT — OpenSky Network (bounded query)
 * State vector layout (index → field):
 *   0:icao24  1:callsign  2:origin_country  3:time_pos  4:last_contact
 *   5:lon     6:lat       7:baro_alt        8:on_ground 9:velocity
 *   10:hdg    11:vert_rate
 * ============================================================ */
async function fetchAircraft() {
  // Primary: server-side /api/aircraft (shared edge cache + optional auth =
  // way more reliable than client-side anon OpenSky which kept exhausting).
  try {
    const r = await fetchTimeout(`/api/aircraft?preset=${encodeURIComponent(activePreset)}`, {}, 12000);
    if (r.ok) {
      const j = await r.json();
      if (j.ok && Array.isArray(j.states)) {
        state.aircraft = j.states.filter((s) => s[5] != null && s[6] != null);
        state.aircraftFetchedAt = Date.now();
        cacheSet('aircraft', { at: Date.now(), preset: activePreset, states: state.aircraft });
        return;
      }
    }
  } catch (e) { console.warn('[aircraft-api]', e.message); }

  // Last-resort direct fallback
  const { lamin, lamax, lomin, lomax } = (MAP_PRESETS[activePreset] || MAP_PRESETS.uae).bbox;
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
  try {
    const r = await fetchTimeout(url, { cache: 'no-store' }, 9000);
    if (r.ok) {
      const j = await r.json();
      state.aircraft = (j?.states || []).filter((s) => s[5] != null && s[6] != null);
      state.aircraftFetchedAt = Date.now();
      cacheSet('aircraft', { at: Date.now(), preset: activePreset, states: state.aircraft });
    }
  } catch (e) { console.warn('[opensky-direct]', e.message); }
}

/* ============================================================
 * NOTAMs — AviationAPI (free, no key, FAA source data)
 * Response shape: { ICAO: [ { ... }, ... ], ... }
 * ============================================================ */
async function fetchNotams() {
  const out = [];

  // Pass 1: AviationAPI with ICAO codes (FAA data — may not carry international NOTAMs,
  // but worth trying; if FAA proxies an ICAO entry it'll show up here).
  const url = `https://api.aviationapi.com/v1/notams?apt=${NOTAM_AIRPORTS.join(',')}`;
  let j;
  try {
    const r = await fetchTimeout(url, {}, 8000);
    if (r.ok) j = await r.json();
  } catch {}
  if (!j) {
    try { const r = await proxyFetch(url); j = await r.json(); } catch {}
  }
  Object.entries(j || {}).forEach(([apt, list]) => {
    if (!Array.isArray(list)) return;
    list.slice(0, 8).forEach((n) => {
      const msg = n.notam?.text || n.text || n.message || n.notam_text ||
                  (typeof n === 'string' ? n : JSON.stringify(n));
      const id  = n.notam_number || n.notamNumber || n.notam?.number || n.id || '';
      const issued = n.issue_date || n.effective_date || n.issued || n.notam?.issued || '';
      out.push({
        apt,
        id: String(id).slice(0, 40),
        msg: String(msg).replace(/\s+/g, ' ').trim().slice(0, 360),
        issued: String(issued).slice(0, 24),
        src: 'FAA via AviationAPI',
        url: '',
      });
    });
  });

  // Pass 2 (fallback): Google News query for airspace / NOTAM / overflight news in GCC.
  // Triggered any time we don't yet have at least 5 items — gives the user useful
  // operational context even when the FAA international NOTAM proxy is empty.
  if (out.length < 5) {
    const gnUrl = 'https://news.google.com/rss/search?q=' +
      encodeURIComponent('(NOTAM OR airspace OR "flight restriction" OR "no-fly" OR "overflight" OR diversion) (Dubai OR "Abu Dhabi" OR Doha OR Riyadh OR Jeddah OR Bahrain OR Kuwait OR Muscat OR Sharjah OR Dammam OR UAE OR Qatar OR Oman OR GCC OR Hormuz)') +
      '&when:7d&hl=en-US&gl=US&ceid=US:en';
    try {
      const r = await proxyFetch(gnUrl);
      const text = await r.text();
      const items = parseRSS(text, { id: 'gcc-airspace', name: 'GCC AIRSPACE NEWS', region: 'GCC', lang: 'en' });
      items.slice(0, 25).forEach((it) => {
        // Guess airport tag from headline
        let apt = 'GCC';
        for (const [code, name] of Object.entries(NOTAM_AIRPORT_NAMES)) {
          if (new RegExp('\\b' + name + '\\b', 'i').test(it.title)) { apt = code; break; }
        }
        out.push({
          apt,
          id: '',
          msg: it.title,
          issued: it.date.toISOString().slice(0, 10),
          src: it.source || 'Wire',
          url: it.link,
        });
      });
    } catch {}
  }

  state.notams = out;
  cacheSet('notams', state.notams);
}

/* ============================================================
 * RENDER — TICKER
 * ============================================================ */
function tkChip(label, unit, price, pct) {
  const has = price != null && !isNaN(price);
  const cls = (pct ?? 0) >= 0 ? 'up' : 'down';
  const arr = (pct ?? 0) >= 0 ? '▲' : '▼';
  const pctTxt = pct != null ? `${arr}${fmtNum(Math.abs(pct), 2)}%` : '';
  return `<span class="tk"><b>${label}</b>${unit}${has ? fmtNum(price) : '—'}<span class="${cls}">${pctTxt}</span></span>`;
}

/**
 * Fill a ticker lane with N copies of the content, where N is computed from
 * the lane's actual viewport width. Guarantees the -50% marquee animation
 * always has content extending past the right edge, so when the loop
 * restarts the next copy is already there — no gap, just repeat.
 * Animation duration is set on the element so perceived scroll speed stays
 * constant regardless of how many copies were needed.
 */
function fillLane(elId, parts, fallback) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!parts || !parts.length) {
    el.innerHTML = `<span class="tk">${escapeHtml(fallback)}</span>`;
    el.style.animationDuration = '60s';
    return;
  }
  const segment = parts.join('<span class="sep">·</span>') + '<span class="sep">·</span>';
  // Pass 1 — measure a single segment's natural width
  el.innerHTML = segment;
  // Read scrollWidth (forces a synchronous layout pass)
  const oneWidth = el.scrollWidth || 200;
  const lane = el.parentElement;
  const viewWidth = ((lane && lane.clientWidth) || window.innerWidth || 1200) - 50; // minus label
  // Want total content ≥ ~2.2× viewport so the loop is seamless even if
  // the lane is on a wide desktop monitor.
  const copies = Math.max(2, Math.ceil((viewWidth * 2.2) / oneWidth));
  el.innerHTML = segment.repeat(copies);
  // Keep scroll speed roughly constant — ~55 px/sec across all configurations
  const totalScrollPx = (copies * oneWidth) * 0.5; // matches CSS translateX(-50%)
  const dur = Math.max(20, Math.round(totalScrollPx / 55));
  el.style.animationDuration = `${dur}s`;
}

function renderTicker() {
  // ---- LANE 1 · OIL & ENERGY (RTL) ----
  const oilSyms = ['cl.f','b.f','ng.f','gc.f','si.f'];
  const oilParts = oilSyms.map((sym) => {
    const m = state.markets[sym]; if (!m) return null;
    return tkChip(m.label, m.unit, m.price, m.pct);
  }).filter(Boolean);
  fillLane('ticker-oil', oilParts, 'ENERGY · LOADING');

  // ---- LANE 2 · CRYPTO + FX + INDICES ----
  const cryptoParts = Object.entries(state.crypto).map(([id, v]) => {
    const lbl = id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : id.toUpperCase();
    const pct = v.usd_24h_change ?? 0;
    return tkChip(lbl, '$', v.usd, pct);
  });
  const idxSyms = ['^spx','^dji','^ndq','^ta35','dx.f'];
  const idxParts = idxSyms.map((sym) => {
    const m = state.markets[sym]; if (!m) return null;
    return tkChip(m.label, m.unit, m.price, m.pct);
  }).filter(Boolean);
  const fxOrder = ['AED','SAR','ILS','QAR','OMR','BHD','EUR','GBP','JPY','TRY','EGP'];
  const fxParts = fxOrder
    .filter((c) => state.fx[c] != null)
    .map((cur) => `<span class="tk"><b>USD/${cur}</b>${fmtNum(state.fx[cur], 4)}</span>`);
  const combined = [...cryptoParts, ...idxParts, ...fxParts];
  fillLane('ticker-fx', combined, 'CRYPTO · FX · LOADING');
}

/* ============================================================
 * RENDER — STATUS STRIP (FX pinned under the ticker)
 * ============================================================ */
function renderStatusStrip() {
  // Strip removed — info now lives in the 2-lane ticker stack at the top.
  return;
  // eslint-disable-next-line no-unreachable
  const fxOrder = ['ILS','AED','SAR','EGP','QAR','EUR','GBP','TRY'];
  const cells = fxOrder
    .filter((c) => state.fx[c] != null)
    .map((c) => `
      <div class="cell">
        <span class="lbl">USD/${c}</span>
        <span class="val">${fmtNum(state.fx[c], 4)}</span>
      </div>
    `).join('');
  // BTC pinned
  const btc = state.crypto.bitcoin;
  const btcCell = btc ? `
    <div class="cell">
      <span class="lbl">BTC</span>
      <span class="val">$${fmtNum(btc.usd, 0)}</span>
      <span class="chg ${(btc.usd_24h_change||0) >= 0 ? 'up' : 'down'}">
        ${(btc.usd_24h_change||0) >= 0 ? '▲' : '▼'}${fmtNum(Math.abs(btc.usd_24h_change||0),2)}%
      </span>
    </div>` : '';

  $('#status-strip').innerHTML = `<div class="strip-row">${cells}${btcCell}</div>`;
}

/* ============================================================
 * RENDER — BREAKING BANNER (rotates security headlines)
 * ============================================================ */
let bannerIdx = 0;
let bannerTimer = null;
function renderBanner() {
  const sec  = state.items.filter((i) => i.tags.includes('security')).slice(0, 8);
  const pool = sec.length ? sec : state.items.slice(0, 8);
  if (!pool.length) {
    $('#breaking-text').textContent = 'Awaiting feed…';
    return;
  }
  clearInterval(bannerTimer);
  const tick = () => {
    const it = pool[bannerIdx % pool.length];
    $('#breaking-text').innerHTML =
      `<a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>` +
      `<span class="banner-src"> — ${escapeHtml(it.source)}</span>`;
    bannerIdx++;
  };
  tick();
  bannerTimer = setInterval(tick, 6500);
}

/* ============================================================
 * MAP — Leaflet + CartoDB Dark Matter tiles
 * ============================================================ */
let leafletMap = null;
let mapReady = false;
const planeMarkers = new Map(); // icao24 -> L.Marker
let aircraftTimer = null;

/**
 * Mil-tactical chevron track icon.
 *   color band: HI alt (>30k ft) amber  / MID (10–30k) cyan  / LOW (<10k) red
 *   on-ground: dim grey square
 */
function planeIcon(heading, altMeters, onGround) {
  if (onGround) {
    return L.divIcon({
      className: 'plane-icon',
      html: `<svg viewBox="0 0 10 10" width="8" height="8"><rect x="1" y="1" width="8" height="8" fill="#555" stroke="#000" stroke-width="0.6"/></svg>`,
      iconSize: [8, 8], iconAnchor: [4, 4],
    });
  }
  let color = '#ffaa00';
  if (altMeters == null)        color = '#5fc7ff';
  else if (altMeters > 9144)    color = '#ffaa00'; // > ~30k ft
  else if (altMeters > 3048)    color = '#5fc7ff'; // > ~10k ft
  else                          color = '#ff3344';
  return L.divIcon({
    className: 'plane-icon',
    html:
      `<svg viewBox="0 0 16 16" width="13" height="13" style="transform: rotate(${heading || 0}deg); display:block;">` +
        `<path d="M8 0 L12.5 12 L8 9.5 L3.5 12 Z" fill="${color}" stroke="#000" stroke-width="0.7" stroke-linejoin="miter"/>` +
        `<circle cx="8" cy="8.5" r="0.9" fill="#000"/>` +
      `</svg>`,
    iconSize: [13, 13], iconAnchor: [6.5, 6.5],
  });
}

function initMapOnce() {
  if (mapReady) {
    setTimeout(() => leafletMap.invalidateSize(), 30);
    if (Date.now() - state.aircraftFetchedAt > 60_000) refreshMapData();
    return;
  }
  if (typeof L === 'undefined') {
    $('#world-map').innerHTML = '<div class="empty">Leaflet failed to load.</div>';
    return;
  }
  mapReady = true;

  const p0 = MAP_PRESETS[activePreset];
  leafletMap = L.map('world-map', {
    center: p0.center,
    zoom: p0.zoom,
    minZoom: 2,
    maxZoom: 11,
    worldCopyJump: true,
    attributionControl: true,
    zoomControl: true,
  });

  // Tactical base: dark, no labels for clean substrate, then labels-only overlay
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd', attribution: '© OSM · © CARTO',
  }).addTo(leafletMap);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd', opacity: 0.65,
  }).addTo(leafletMap);

  // OpenSeaMap maritime overlay — adds ports, navigation marks and shipping
  // lane annotations. Free, no key, tiles only.
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 18, opacity: 0.85, attribution: '© OpenSeaMap',
  }).addTo(leafletMap);

  // ---- Graticule (lat/lon lines every 10°, faint) ----
  const gratStyle = { color: '#252525', weight: 0.6, opacity: 0.8, interactive: false };
  for (let lat = -60; lat <= 80; lat += 10) L.polyline([[lat, -180], [lat, 180]], gratStyle).addTo(leafletMap);
  for (let lon = -180; lon <= 180; lon += 10) L.polyline([[-60, lon], [80, lon]], gratStyle).addTo(leafletMap);

  // ---- OpenSky engagement box ----
  drawEngagementBox();

  // ---- Chokepoints w/ range rings ----
  CHOKEPOINTS.forEach((c) => {
    c.rings_nm.forEach((nm) => {
      L.circle([c.lat, c.lon], {
        radius: nm * 1852,
        color: '#ff6ad5',
        weight: 1,
        opacity: 0.35,
        fillOpacity: 0,
        dashArray: '4 5',
        interactive: false,
      }).addTo(leafletMap);
    });
    L.marker([c.lat, c.lon], {
      icon: L.divIcon({
        className: 'choke-marker',
        html:
          `<svg width="16" height="16" viewBox="0 0 16 16" style="overflow:visible">` +
          `<path d="M8 1 L15 8 L8 15 L1 8 Z" fill="rgba(0,0,0,0.85)" stroke="#ff6ad5" stroke-width="1.5"/>` +
          `<circle cx="8" cy="8" r="1.2" fill="#ff6ad5"/>` +
          `</svg>`,
        iconSize: [16, 16], iconAnchor: [8, 8],
      }),
    })
      .bindTooltip(c.code, { permanent: true, direction: 'right', offset: [10, 0], className: 'choke-label' })
      .bindPopup(`<b>${c.name}</b><br>${c.lat.toFixed(3)}°N · ${c.lon.toFixed(3)}°E<br>Range rings: ${c.rings_nm.join(', ')} nm`)
      .addTo(leafletMap);
  });

  // ---- Preset switcher ----
  $$('.preset').forEach((b) => {
    b.addEventListener('click', () => {
      switchPreset(b.dataset.preset);
    });
  });

  // ---- AIR/SEA mode toggle ----
  bindMapMode();

  // ---- Mouse position → HUD DTG ----
  leafletMap.on('mousemove', (e) => {
    const lat = e.latlng.lat.toFixed(2);
    const lon = e.latlng.lng.toFixed(2);
    const dtg = $('#hud-dtg'); if (dtg) dtg.textContent = `${lat}° · ${lon}°`;
  });

  // ---- Periodic refresh, only while MAP tab visible ----
  // Render whatever we already have cached from preload first, so the map
  // shows planes immediately on first open.
  if (state.aircraft && state.aircraft.length) renderAircraft();
  refreshMapData();
  if (aircraftTimer) clearInterval(aircraftTimer);
  aircraftTimer = setInterval(() => {
    if (activeTab === 'map') refreshMapData();
  }, 90_000);

  setTimeout(() => leafletMap.invalidateSize(), 60);
}

let engagementBoxLayer = null;
function drawEngagementBox() {
  if (!leafletMap) return;
  if (engagementBoxLayer) leafletMap.removeLayer(engagementBoxLayer);
  const b = (MAP_PRESETS[activePreset] || MAP_PRESETS.mena).bbox;
  engagementBoxLayer = L.rectangle(
    [[b.lamin, b.lomin], [b.lamax, b.lomax]],
    { color: '#5fc7ff', weight: 1, opacity: 0.45, fillOpacity: 0, dashArray: '8 6', interactive: false }
  ).addTo(leafletMap);
  const bb = $('#hud-bbox'); if (bb) bb.textContent = `${b.lamin}/${b.lamax}N · ${b.lomin}/${b.lomax}E`;
}

function switchPreset(key) {
  if (!MAP_PRESETS[key]) return;
  activePreset = key;
  $$('.preset').forEach((x) => x.classList.toggle('active', x.dataset.preset === key));
  const p = MAP_PRESETS[key];
  if (leafletMap) {
    leafletMap.setView(p.center, p.zoom, { animate: true });
    drawEngagementBox();
  }
  const v = $('#hud-view'); if (v) v.textContent = key.toUpperCase();
  // refetch aircraft for the new bbox
  refreshMapData();
}

/* AIR / SEA / FR24 mode toggle on the map view */
function setMapMode(mode) {
  const sea = document.getElementById('marine-overlay');
  const fr  = document.getElementById('fr24-overlay');
  if (!sea || !fr) return;

  if (mode === 'sea') {
    if (!sea.dataset.loaded) {
      sea.src = 'https://www.marinetraffic.com/en/ais/embed/zoom:7/centery:25.5/centerx:55.5/maptype:1/shownames:false/mmsi:0/shipid:0/fleet:/fleet_id:0/vtypes:/showmenu:false/remember:false';
      sea.dataset.loaded = '1';
    }
    sea.hidden = false;
    fr.hidden = true;
  } else if (mode === 'fr24') {
    if (!fr.dataset.loaded) {
      // Flightradar24 simple embed — no key, no auth, commercial coverage
      fr.src = 'https://www.flightradar24.com/simple?lat=25.0&lon=55.0&z=7';
      fr.dataset.loaded = '1';
    }
    fr.hidden = false;
    sea.hidden = true;
  } else {
    sea.hidden = true;
    fr.hidden = true;
  }
  document.querySelectorAll('.mode-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
}
function bindMapMode() {
  const wrap = document.getElementById('map-mode');
  if (!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound = '1';
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.mode-btn');
    if (!b) return;
    setMapMode(b.dataset.mode);
  });
}

async function refreshMapData() {
  toast('Polling OpenSky + NOTAMs…');
  await Promise.allSettled([
    fetchAircraft().then(renderAircraft),
    fetchNotams().then(renderNotams),
  ]);
}

function renderAircraft() {
  if (!leafletMap) return;
  const seen = new Set();
  let airborne = 0;

  for (const s of state.aircraft) {
    const icao = s[0];
    if (!icao) continue;
    const lon = s[5], lat = s[6];
    const onGround = s[8];
    const heading = s[10] ?? 0;
    if (onGround) continue;
    airborne++;
    seen.add(icao);

    let m = planeMarkers.get(icao);
    if (!m) {
      m = L.marker([lat, lon], { icon: planeIcon(heading, s[7], onGround) });
      m.bindPopup(buildPlanePopup(s));
      m.addTo(leafletMap);
      planeMarkers.set(icao, m);
    } else {
      m.setLatLng([lat, lon]);
      m.setIcon(planeIcon(heading, s[7], onGround));
      m.setPopupContent(buildPlanePopup(s));
    }
  }

  for (const [icao, m] of planeMarkers) {
    if (!seen.has(icao)) {
      leafletMap.removeLayer(m);
      planeMarkers.delete(icao);
    }
  }

  const el = $('#plane-count');
  if (el) el.textContent = `${airborne} airborne · ${state.aircraft.length} total · ${activePreset.toUpperCase()} box`;
  const hud = $('#hud-airborne');
  if (hud) hud.textContent = `${airborne} airborne / ${state.aircraft.length} states`;
}

function buildPlanePopup(s) {
  const callsign = (s[1] || '').trim() || s[0];
  const country = s[2] || '';
  const altM = s[7];
  const vel = s[9];
  const hdg = s[10];
  const vr = s[11];
  const ft = altM != null ? Math.round(altM * 3.28084).toLocaleString() + ' ft' : '—';
  const kt = vel != null ? Math.round(vel * 1.94384) + ' kt' : '—';
  const climb = vr != null ? (vr > 0 ? '▲ ' : vr < 0 ? '▼ ' : '— ') + Math.abs(Math.round(vr * 196.85)) + ' fpm' : '—';
  return (
    `<b>${escapeHtml(callsign)}</b><br>` +
    `<span style="color:#5fc7ff">${escapeHtml(country)}</span><br>` +
    `ALT ${ft}<br>SPD ${kt}<br>HDG ${hdg != null ? Math.round(hdg) + '°' : '—'}<br>V/S ${climb}`
  );
}

function renderNotams() {
  const el = $('#notam-list');
  if (!el) return;
  if (!state.notams.length) {
    el.innerHTML = `<div class="empty">No NOTAMs returned (rate-limited or feed empty).</div>`;
    const c = $('#notam-count'); if (c) c.textContent = '';
    return;
  }
  el.innerHTML = state.notams.slice(0, 60).map((n) => {
    const msgHtml = n.url
      ? `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" style="color:var(--white)">${escapeHtml(n.msg)}</a>`
      : escapeHtml(n.msg);
    return `
      <div class="notam-row">
        <div class="notam-head">
          <span class="notam-apt">${escapeHtml(n.apt)}</span>
          ${n.id ? `<span class="notam-id">${escapeHtml(n.id)}</span>` : ''}
          ${n.issued ? `<span class="notam-date">${escapeHtml(n.issued)}</span>` : ''}
          ${n.src ? `<span class="notam-src">${escapeHtml(n.src)}</span>` : ''}
        </div>
        <div class="notam-msg">${msgHtml}</div>
      </div>
    `;
  }).join('');
  const c = $('#notam-count'); if (c) c.textContent = `${state.notams.length} active`;
}

/* ============================================================
 * LIVE BROADCAST GRID — YouTube channel-live embeds (lazy)
 * ============================================================ */
function renderLive() {
  const grid = $('#live-grid');
  if (grid.dataset.rendered) return;
  const origin = encodeURIComponent(location.origin);

  // channel-live-stream URL — auto-picks the channel's CURRENT live broadcast.
  // Avoids stale hardcoded video IDs that rotate every few months.
  const embedUrl = (channelId) =>
    `https://www.youtube-nocookie.com/embed/live_stream?channel=${channelId}` +
    `&autoplay=1&mute=1&playsinline=1&controls=1&enablejsapi=1&rel=0&modestbranding=1&origin=${origin}`;

  grid.innerHTML = LIVE_CHANNELS.map((ch, i) => {
    const liveNow = i < LIVE_AUTO_LOAD;
    const body = liveNow
      ? `<iframe src="${embedUrl(ch.channelId)}"
                 allow="autoplay; encrypted-media; picture-in-picture"
                 allowfullscreen loading="lazy"></iframe>
         <div class="lt-mute-overlay">MUTED · CLICK FOR AUDIO</div>`
      : `<div class="lt-stub">
           <div class="lt-stub-name">${escapeHtml(ch.name)}</div>
           <div class="lt-stub-cta">▶ TAP TO STREAM</div>
         </div>`;
    return `
      <div class="live-tile"
           data-channel="${ch.channelId}"
           data-muted="1"
           data-loaded="${liveNow ? '1' : '0'}">
        <div class="lt-head">
          <span class="lt-name">${escapeHtml(ch.name)}</span>
          <span class="lt-reg"><span class="live-dot"></span>${escapeHtml(ch.desk)}</span>
        </div>
        <div class="lt-frame">${body}</div>
      </div>
    `;
  }).join('');
  grid.dataset.rendered = '1';

  const sendCmd = (iframe, func) => {
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args: [] }),
        'https://www.youtube-nocookie.com'
      );
    } catch (e) { console.warn('[yt-cmd]', e.message); }
  };
  const setMuted = (tile, muted) => {
    const iframe = tile.querySelector('iframe');
    if (!iframe) return;
    if (muted) {
      sendCmd(iframe, 'mute');
      tile.dataset.muted = '1';
      if (!tile.querySelector('.lt-mute-overlay')) {
        const frame = tile.querySelector('.lt-frame');
        const ov = document.createElement('div');
        ov.className = 'lt-mute-overlay';
        ov.textContent = 'MUTED · CLICK FOR AUDIO';
        frame.appendChild(ov);
      }
    } else {
      sendCmd(iframe, 'unMute');
      sendCmd(iframe, 'playVideo');
      tile.dataset.muted = '0';
      tile.querySelector('.lt-mute-overlay')?.remove();
    }
  };
  const loadTile = (tile) => {
    const channelId = tile.dataset.channel;
    const frame = tile.querySelector('.lt-frame');
    frame.innerHTML =
      `<iframe src="${embedUrl(channelId)}"
               allow="autoplay; encrypted-media; picture-in-picture"
               allowfullscreen></iframe>
       <div class="lt-mute-overlay">MUTED · CLICK FOR AUDIO</div>`;
    tile.dataset.loaded = '1';
  };

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.live-tile');
    if (!tile) return;
    if (tile.dataset.loaded === '0') {
      loadTile(tile);
      return;
    }
    const wasMuted = tile.dataset.muted === '1';
    grid.querySelectorAll('.live-tile').forEach((t) => {
      if (t !== tile && t.dataset.muted === '0') setMuted(t, true);
    });
    setMuted(tile, !wasMuted);
  });
}

/* ============================================================
 * SEARCH — Perplexity-style retrieval. Cached news + fresh GDELT.
 * No LLM. Citations only.
 * ============================================================ */
async function fetchGdeltSearch(q) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=40&format=json&sort=DateDesc&timespan=2d`;
  try {
    const r = await fetchTimeout(url, {}, 9000);
    const j = await r.json();
    state.searchGdelt = (j.articles || []).map((a) => ({
      title: a.title, url: a.url, domain: a.domain,
      date: parseGdeltDate(a.seendate), country: a.sourcecountry,
    }));
  } catch (e) {
    console.warn('[search]', e.message);
    state.searchGdelt = [];
  }
}

/* ============================================================
 * ASK AI — Puter.js wrapper around Perplexity Sonar (citation model).
 * Free + unlimited via puter.com (user-pays model — first call may pop
 * the Puter sign-in dialog). The API key model means the answer renders
 * the same regardless of whether we have one.
 * ============================================================ */
function extractAIText(r) {
  if (!r) return '';
  if (typeof r === 'string') return r;
  return r?.message?.content ||
         r?.content ||
         r?.text ||
         r?.choices?.[0]?.message?.content ||
         '';
}
function extractCitations(r) {
  if (!r || typeof r === 'string') return [];
  const list = r?.citations ||
               r?.search_results ||
               r?.sources ||
               r?.message?.citations ||
               r?.choices?.[0]?.message?.citations ||
               [];
  return list.map((c) => {
    if (typeof c === 'string') return { url: c, title: c };
    return {
      url: c.url || c.link || '',
      title: c.title || c.url || c.link || 'source',
      snippet: c.snippet || c.text || '',
    };
  });
}
function hostnameOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

async function askAI(q) {
  if (!q) return;
  if (!window.puter?.ai?.chat) {
    state.aiAnswer = { error: 'Puter.js not loaded. Refresh to retry.' };
    state.aiLoading = false;
    renderSearch();
    return;
  }
  state.searchActive = true;
  state.searchQuery = q;
  state.aiLoading = true;
  state.aiAnswer = null;
  $('#query-clear').hidden = false;
  renderSearch();

  // Run cached + GDELT retrieval in parallel — the user gets citations from
  // BOTH our own feed and the AI's own web search.
  fetchGdeltSearch(q).then(renderSearch);

  try {
    const prompt =
      `You are an intelligence analyst. Answer in 4–6 short bullet points with inline citations [1], [2], etc. ` +
      `Focus on facts from the last 7 days. Topic: ${q}`;
    const r = await window.puter.ai.chat(prompt, { model: 'perplexity-sonar' });
    state.aiAnswer = {
      text: extractAIText(r),
      citations: extractCitations(r),
    };
  } catch (e) {
    state.aiAnswer = { error: e?.message || String(e) };
  }
  state.aiLoading = false;
  renderSearch();
}

function localMatch(it, q) {
  return (
    it.title.toLowerCase().includes(q) ||
    (it.summary || '').toLowerCase().includes(q) ||
    (it.source || '').toLowerCase().includes(q) ||
    (it.region || '').toLowerCase().includes(q) ||
    (it.originalTitle || '').toLowerCase().includes(q)
  );
}

function renderAIBlock() {
  if (state.aiLoading) {
    return `
      <div class="ai-block">
        <div class="ai-head"><span class="ai-tag">▸ AI SYNTHESIS · PERPLEXITY SONAR</span><span class="ai-meta">via Puter.js</span></div>
        <div class="ai-loading">Synthesizing answer with citations…</div>
      </div>
    `;
  }
  const a = state.aiAnswer;
  if (!a) return '';
  if (a.error) {
    return `
      <div class="ai-block">
        <div class="ai-head"><span class="ai-tag">▸ AI SYNTHESIS</span><span class="ai-meta">error</span></div>
        <div class="ai-err">${escapeHtml(a.error)} · Click ASK AI again — the first call may need a free Puter sign-in popup.</div>
      </div>
    `;
  }
  // Convert [1] [2] markers into clickable sup links if citations are present
  let textHtml = escapeHtml(a.text || '');
  textHtml = textHtml.replace(/\[(\d+)\]/g, (_, n) => `<sup data-cite="${n}">[${n}]</sup>`);
  const citesHtml = (a.citations || []).map((c, i) => `
    <a class="ai-cite" href="${escapeHtml(c.url)}" target="_blank" rel="noopener" id="ai-cite-${i+1}">
      <span class="ai-cite-n">[${i+1}]</span>
      <span>
        <div>${escapeHtml(c.title || c.url)}</div>
        <div class="ai-cite-host">${escapeHtml(hostnameOf(c.url))}</div>
      </span>
    </a>
  `).join('');
  return `
    <div class="ai-block">
      <div class="ai-head"><span class="ai-tag">▸ AI SYNTHESIS · PERPLEXITY SONAR</span><span class="ai-meta">via Puter.js · free</span></div>
      <div class="ai-body">${textHtml}</div>
      ${citesHtml ? `<div class="ai-cites">${citesHtml}</div>` : ''}
      <div class="ai-disclaimer">▮ AI-SYNTHESIZED · verify all claims against citations · this is the only AI-generated text in the app</div>
    </div>
  `;
}

function renderSearch() {
  const q = state.searchQuery.toLowerCase();
  const local = state.items.filter((it) => localMatch(it, q));
  const sources = new Set();
  local.forEach((it) => sources.add(it.source));
  state.searchGdelt.forEach((t) => sources.add(t.domain));

  $('#content').innerHTML = `
    <div class="search-summary">
      <span class="search-kw">▸ ${escapeHtml(state.searchQuery)}</span>
      <span class="search-counts">${local.length} cached · ${state.searchGdelt.length} GDELT · ${sources.size} sources</span>
      <span class="search-nb">RETRIEVAL + OPTIONAL AI SYNTHESIS</span>
    </div>
    ${renderAIBlock()}
    <div class="section-head">CACHED FEED MATCHES <span class="sub">${local.length}</span></div>
    ${local.length ? local.slice(0, 80).map(renderItem).join('') : '<div class="empty">No cached matches.</div>'}
    <div class="section-head">GDELT 2.0 — LIVE WEB QUERY · 2 DAYS <span class="sub">${state.searchGdelt.length}</span></div>
    ${state.searchGdelt.length ? state.searchGdelt.slice(0, 40).map((t, i) => `
      <article class="item" data-link="${escapeHtml(t.url)}" data-title="${escapeHtml(t.title)}" data-source="${escapeHtml(t.domain || '')}" data-time="${t.date.toISOString()}">
        <div class="meta-row">
          <span class="time">${fmtTimeUTC(t.date)}</span>
          <span class="ago">−${fmtAgo(t.date)}</span>
          <span class="src">${escapeHtml(t.domain || '')}</span>
          ${t.country ? `<span class="region">${escapeHtml(t.country.slice(0,3).toUpperCase())}</span>` : ''}
        </div>
        <a class="title" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a>
        <div class="tag-row"><span class="tag tag-tension">QUERY</span></div>
      </article>
    `).join('') : '<div class="empty">Fetching GDELT…</div>'}
  `;
  buildFocusList();
}

function bindSearch() {
  const input = $('#query');
  const goBtn = $('#query-go');
  const aiBtn = $('#query-ai');
  const clearBtn = $('#query-clear');

  const submit = () => {
    const q = input.value.trim();
    if (!q) {
      state.searchActive = false;
      state.searchQuery = '';
      state.searchGdelt = [];
      state.aiAnswer = null;
      state.aiLoading = false;
      clearBtn.hidden = true;
      renderContent();
      return;
    }
    state.searchActive = true;
    state.searchQuery = q;
    state.aiAnswer = null;
    state.aiLoading = false;
    clearBtn.hidden = false;
    renderSearch();
    fetchGdeltSearch(q).then(renderSearch);
  };

  const submitAI = () => {
    const q = input.value.trim();
    if (!q) { toast('Enter a query first'); input.focus(); return; }
    askAI(q);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { submitAI(); return; }
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') { input.value = ''; submit(); input.blur(); }
  });
  goBtn.addEventListener('click', submit);
  aiBtn.addEventListener('click', submitAI);
  clearBtn.addEventListener('click', () => { input.value = ''; submit(); input.focus(); });
}

/* ============================================================
 * ARTICLE MODAL — mid-screen card, click → card → external
 * ============================================================ */
function showItemModal(it) {
  state.modalItem = it;
  const idx = state.modalList.findIndex((x) => x.link === it.link && x.title === it.title);
  state.modalIdx = idx >= 0 ? idx : 0;

  $('#modal-tag').textContent = (it.tags?.[0] || 'NEWS').toUpperCase();
  $('#modal-meta').innerHTML =
    `${escapeHtml(it.source || it.domain || '')} · ${fmtTimeUTC(it.date)} · −${fmtAgo(it.date)}` +
    (it.region ? ` · <span style="color:var(--white)">${escapeHtml(it.region)}</span>` : '');

  const tagsHtml = (it.tags || []).map((t) => `<span class="tag tag-${t}">${t}</span>`).join(' ');
  $('#modal-body').innerHTML = `
    <div class="m-title">${escapeHtml(it.title)}</div>
    ${it.originalTitle ? `<div class="m-orig">${escapeHtml(it.originalTitle)}</div>` : ''}
    ${it.summary ? `<div class="m-summary">${escapeHtml(it.summary)}</div>` : ''}
    <div style="margin-top:8px">${tagsHtml}</div>
    <div class="m-meta-grid">
      <span class="m-k">SOURCE</span><span class="m-v">${escapeHtml(it.source || it.domain || '—')}</span>
      <span class="m-k">REGION</span><span class="m-v">${escapeHtml(it.region || '—')}</span>
      <span class="m-k">DATE</span><span class="m-v">${escapeHtml(it.date.toISOString())}</span>
      <span class="m-k">URL</span><span class="m-v"><a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.link)}</a></span>
    </div>
  `;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('#modal').hidden = true;
  state.modalItem = null;
  document.body.style.overflow = '';
}

function modalNav(delta) {
  if (!state.modalList.length) return;
  state.modalIdx = (state.modalIdx + delta + state.modalList.length) % state.modalList.length;
  showItemModal(state.modalList[state.modalIdx]);
}

function bindModal() {
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-dismiss').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#modal-open').addEventListener('click', () => {
    if (state.modalItem?.link) window.open(state.modalItem.link, '_blank', 'noopener');
  });
  $('#modal-copy').addEventListener('click', async () => {
    if (!state.modalItem?.link) return;
    try { await navigator.clipboard.writeText(state.modalItem.link); toast('URL copied'); }
    catch { toast('copy failed'); }
  });
  $('#modal-next').addEventListener('click', () => modalNav(1));
  $('#modal-prev').addEventListener('click', () => modalNav(-1));
}

/* ============================================================
 * FOCUS LIST — for keyboard navigation through the visible feed
 * ============================================================ */
function buildFocusList() {
  // Build a list of articles currently rendered in #content
  const arts = $$('#content .item');
  state.modalList = arts.map((a) => {
    return {
      title: a.dataset.title || a.querySelector('.title')?.textContent || '',
      link:  a.dataset.link  || a.querySelector('.title')?.href || '',
      source: a.dataset.source || a.querySelector('.src')?.textContent || '',
      region: a.querySelector('.region')?.textContent || '',
      date: a.dataset.time ? new Date(a.dataset.time) : new Date(),
      summary: '',
      tags: Array.from(a.querySelectorAll('.tag')).map((t) => t.textContent.toLowerCase()),
      originalTitle: a.querySelector('.orig')?.textContent || '',
    };
  });
  state.focusedIdx = -1;
}

function moveFocus(delta) {
  if (!state.modalList.length) buildFocusList();
  if (!state.modalList.length) return;
  state.focusedIdx = Math.max(0, Math.min(state.modalList.length - 1, state.focusedIdx + delta));
  const arts = $$('#content .item');
  arts.forEach((a) => a.classList.remove('focused'));
  const target = arts[state.focusedIdx];
  if (target) {
    target.classList.add('focused');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/* ============================================================
 * KEYBOARD SHORTCUTS
 * ============================================================ */
const TAB_ORDER = ['all','security','politics','economy','ai','markets','tensions','sources','uae-gov','marine','live','map'];
const TAB_LETTERS = { a: 'all', s: 'security', p: 'politics', e: 'economy', i: 'ai', m: 'markets', t: 'tensions', u: 'uae-gov', n: 'marine', l: 'live', v: 'map' };

/* Sources that belong to the UAE GOV tab (also matched by region prefix 'AE-') */
const UAE_GOV_SOURCE_IDS = new Set([
  'wam', 'modgovae', 'moiuae', 'mofa-ae', 'uaegov', 'ncema',
  'adpolice', 'dubaipol', 'barq', 'forsan', 'tn',
]);
function isUaeGovItem(it) {
  if (!it) return false;
  if (UAE_GOV_SOURCE_IDS.has(it.sourceId)) return true;
  if (typeof it.region === 'string' && it.region.startsWith('AE')) return true;
  return false;
}

function bindKeyboard() {
  document.addEventListener('keydown', (ev) => {
    const inField = ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName);

    // Modal open: handle modal-specific keys
    if (!$('#modal').hidden) {
      if (ev.key === 'Escape')  { ev.preventDefault(); closeModal(); return; }
      if (ev.key === 'o' || ev.key === 'O') {
        ev.preventDefault();
        if (state.modalItem?.link) window.open(state.modalItem.link, '_blank', 'noopener');
        return;
      }
      if (ev.key === 'c' || ev.key === 'C') {
        ev.preventDefault();
        if (state.modalItem?.link) navigator.clipboard.writeText(state.modalItem.link).then(() => toast('URL copied'));
        return;
      }
      if (ev.key === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); modalNav(1); return; }
      if (ev.key === 'k' || ev.key === 'ArrowUp')   { ev.preventDefault(); modalNav(-1); return; }
      return;
    }

    // Help overlay
    if (ev.key === '?') {
      ev.preventDefault();
      $('#help').hidden = !$('#help').hidden;
      return;
    }
    if (!$('#help').hidden && ev.key === 'Escape') {
      $('#help').hidden = true; return;
    }

    if (inField) {
      // typing in search: only handle Escape (handled by search)
      return;
    }

    // Global shortcuts
    if (ev.key === '/')  { ev.preventDefault(); $('#query').focus(); return; }
    if (ev.key === '?')  { ev.preventDefault(); $('#help').hidden = false; return; }
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); refresh(); return; }

    if (ev.key >= '1' && ev.key <= '9') {
      const i = parseInt(ev.key, 10) - 1;
      const t = TAB_ORDER[i];
      if (t) { ev.preventDefault(); switchTab(t); }
      return;
    }
    if (TAB_LETTERS[ev.key]) { ev.preventDefault(); switchTab(TAB_LETTERS[ev.key]); return; }

    if (ev.key === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); moveFocus(1);  return; }
    if (ev.key === 'k' || ev.key === 'ArrowUp')   { ev.preventDefault(); moveFocus(-1); return; }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const it = state.modalList[state.focusedIdx];
      if (it) showItemModal(it);
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (state.searchActive) {
        $('#query').value = '';
        state.searchActive = false; state.searchQuery = '';
        $('#query-clear').hidden = true;
        renderContent();
      }
    }
  });
}

function switchTab(name) {
  $$('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  activeTab = name;
  renderContent();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
 * RENDER — CONTENT
 * ============================================================ */
let activeTab = 'all';

function renderContent() {
  const c = $('#content');
  const mv = $('#map-view');
  const lv = $('#live-view');

  const marineView = document.getElementById('marine-view');

  if (activeTab === 'map') {
    c.hidden = true; lv.hidden = true; if (marineView) marineView.hidden = true; mv.hidden = false;
    initMapOnce();
    setTimeout(() => { try { leafletMap?.invalidateSize(true); } catch {} }, 60);
    setTimeout(() => { try { leafletMap?.invalidateSize(true); } catch {} }, 300);
    return;
  }
  if (activeTab === 'live') {
    c.hidden = true; mv.hidden = true; if (marineView) marineView.hidden = true; lv.hidden = false;
    renderLive();
    return;
  }
  if (activeTab === 'marine') {
    c.hidden = true; mv.hidden = true; lv.hidden = true; if (marineView) marineView.hidden = false;
    const frame = document.getElementById('marine-tab-frame');
    if (frame && !frame.dataset.loaded) {
      frame.src = 'https://www.marinetraffic.com/en/ais/embed/zoom:7/centery:25.5/centerx:55.5/maptype:1/shownames:false/mmsi:0/shipid:0/fleet:/fleet_id:0/vtypes:/showmenu:false/remember:false';
      frame.dataset.loaded = '1';
    }
    return;
  }
  mv.hidden = true; lv.hidden = true; if (marineView) marineView.hidden = true; c.hidden = false;

  if (state.searchActive) { renderSearch(); return; }

  switch (activeTab) {
    case 'markets':  c.innerHTML = renderMarketsView();  return;
    case 'tensions': c.innerHTML = renderTensionsView(); return;
    case 'sources':  c.innerHTML = renderSourcesView();  return;
  }

  let items = state.items;
  if (activeTab === 'uae-gov') {
    items = items.filter(isUaeGovItem);
  } else if (activeTab !== 'all') {
    items = items.filter((i) => i.tags.includes(activeTab));
  }

  if (!items.length) {
    c.innerHTML = `<div class="empty">No items yet for <b>${activeTab.toUpperCase()}</b>. Tap ↻ to refresh.</div>`;
    return;
  }

  c.innerHTML = items.slice(0, 150).map(renderItem).join('');
  // Cache the rendered list for keyboard nav + modal next/prev
  state.modalList = items.slice(0, 150);
  state.focusedIdx = -1;
}

function renderItem(it) {
  const tagsHtml = (it.tags || []).map((t) => `<span class="tag tag-${t}">${t}</span>`).join('');
  const region = it.region ? `<span class="region">${escapeHtml(it.region)}</span>` : '';
  const orig = it.originalTitle
    ? `<div class="orig" dir="rtl">${escapeHtml(it.originalTitle)}</div>`
    : '';
  const dateIso = it.date instanceof Date ? it.date.toISOString() : new Date(it.date).toISOString();
  return `
    <article class="item" data-link="${escapeHtml(it.link)}" data-title="${escapeHtml(it.title)}" data-source="${escapeHtml(it.source || '')}" data-time="${dateIso}">
      <div class="meta-row">
        <span class="time">${fmtTimeUTC(it.date)}</span>
        <span class="ago">−${fmtAgo(it.date)}</span>
        <span class="src">${escapeHtml(it.source || '')}</span>
        ${region}
      </div>
      <a class="title" href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
      ${orig}
      <div class="tag-row">${tagsHtml}</div>
    </article>
  `;
}

/**
 * Click delegation: every article opens the modal first; external nav happens
 * only via the OPEN AT SOURCE action inside the card.
 */
function bindContentClicks() {
  const handler = (e) => {
    const art = e.target.closest('article.item');
    if (!art) return;
    // Don't hijack actual tag clicks etc — only the title link / article body
    if (e.target.closest('a.title') || e.target === art || e.target.closest('.meta-row') || e.target.closest('.tag-row') || e.target.closest('.orig')) {
      e.preventDefault();
      const link = art.dataset.link;
      const title = art.dataset.title;
      // Find the matching item object (prefer state.modalList, fall back to building one from DOM)
      let it = state.modalList.find((x) => x.link === link && x.title === title);
      if (!it) {
        it = {
          title,
          link,
          source: art.dataset.source || '',
          region: art.querySelector('.region')?.textContent || '',
          date: art.dataset.time ? new Date(art.dataset.time) : new Date(),
          summary: '',
          tags: Array.from(art.querySelectorAll('.tag')).map((t) => t.textContent.toLowerCase()),
          originalTitle: art.querySelector('.orig')?.textContent || '',
        };
      } else {
        // Ensure date is a Date object after restore from cache
        if (!(it.date instanceof Date)) it.date = new Date(it.date);
      }
      showItemModal(it);
    }
  };
  $('#content').addEventListener('click', handler);
}

function renderMarketsView() {
  const card = (label, value, change, unit, pct, badge) => {
    const has = value != null && !isNaN(value);
    const dir = (pct ?? 0) >= 0 ? 'up' : 'down';
    const arr = (pct ?? 0) >= 0 ? '▲' : '▼';
    const cTxt = (pct != null && change != null)
      ? `${arr} ${fmtNum(Math.abs(change))} (${fmtNum(Math.abs(pct), 2)}%)`
      : (pct != null ? `${arr} ${fmtNum(Math.abs(pct), 2)}%` : '—');
    return `
      <div class="mcard ${has ? dir : ''}">
        <div class="ml">${escapeHtml(label)}${badge ? ` <span class="mbadge">${badge}</span>` : ''}</div>
        <div class="mv">${has ? (unit || '') + fmtNum(value) : '—'}</div>
        <div class="mc">${has ? cTxt : ''}</div>
      </div>
    `;
  };

  const energy = STOOQ_TICKERS.filter((t) => t.group === 'energy').map((t) => {
    const m = state.markets[t.sym] || {};
    return card(t.label, m.price, m.change, t.unit, m.pct, m.opa ? 'OPA' : null);
  }).join('');

  const metals = STOOQ_TICKERS.filter((t) => t.group === 'metals').map((t) => {
    const m = state.markets[t.sym] || {};
    return card(t.label, m.price, m.change, t.unit, m.pct, m.opa ? 'OPA' : null);
  }).join('');

  const indices = STOOQ_TICKERS.filter((t) => t.group === 'index' || t.group === 'fx').map((t) => {
    const m = state.markets[t.sym] || {};
    return card(t.label, m.price, m.change, t.unit, m.pct, m.opa ? 'OPA' : null);
  }).join('');

  const fx = Object.entries(state.fx).map(([c, v]) =>
    card('USD/' + c, v, null, '', null)
  ).join('') || `<div class="mcard"><div class="ml">FX</div><div class="mv">—</div></div>`;

  const crypto = Object.entries(state.crypto).map(([id, v]) => {
    const lbl = id === 'bitcoin' ? 'BTC/USD' : id === 'ethereum' ? 'ETH/USD' : id.toUpperCase();
    return card(lbl, v.usd, null, '$', v.usd_24h_change ?? null);
  }).join('') || `<div class="mcard"><div class="ml">CRYPTO</div><div class="mv">—</div></div>`;

  return `
    <div class="section-head">ENERGY <span class="sub">Stooq · futures</span></div>
    <div class="mgrid">${energy}</div>

    <div class="section-head">METALS <span class="sub">Stooq · futures</span></div>
    <div class="mgrid">${metals}</div>

    <div class="section-head">INDICES &amp; DXY <span class="sub">Stooq</span></div>
    <div class="mgrid">${indices}</div>

    <div class="section-head">FX vs USD <span class="sub">Frankfurter · ECB ref</span></div>
    <div class="mgrid">${fx}</div>

    <div class="section-head">CRYPTO <span class="sub">CoinGecko · 24h</span></div>
    <div class="mgrid">${crypto}</div>
  `;
}

function renderTensionsView() {
  if (!state.tensions.length) {
    return `<div class="empty">GDELT 2.0 returned no rows in last 24h, or rate-limited. Retry shortly.</div>`;
  }
  const head = `<div class="section-head">GDELT 2.0 TENSION FEED <span class="sub">last 24h · auto-translated · conflict-tagged</span></div>`;
  const body = state.tensions.slice(0, 80).map((t) => {
    const code = langToCode(t.language);
    const rtl = ['ar','he','fa','ur'].includes(code || '');
    const langChip = t.language ? `<span class="region">${escapeHtml(String(t.language).slice(0, 3).toUpperCase())}</span>` : '';
    const orig = t.originalTitle
      ? `<div class="orig"${rtl ? ' dir="rtl"' : ''}>${escapeHtml(t.originalTitle)}</div>`
      : '';
    const trTag = t.originalTitle ? '<span class="tag tag-politics">TRANSLATED</span>' : '';
    return `
      <article class="item">
        <div class="meta-row">
          <span class="time">${fmtTimeUTC(t.date)}</span>
          <span class="ago">−${fmtAgo(t.date)}</span>
          <span class="src">${escapeHtml(t.domain || 'gdelt')}</span>
          ${t.country ? `<span class="region">${escapeHtml(t.country.slice(0,3).toUpperCase())}</span>` : ''}
          ${langChip}
        </div>
        <a class="title" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a>
        ${orig}
        <div class="tag-row"><span class="tag tag-tension">TENSION</span>${trTag}</div>
      </article>
    `;
  }).join('');
  return head + body;
}

/* ============================================================
 * CUSTOM SOURCE MANAGEMENT — add any RSS URL; auto-detect feed link
 * inside HTML pages if the URL isn't itself RSS.
 * ============================================================ */
async function tryAddCustomSource(name, rawUrl, region) {
  rawUrl = (rawUrl || '').trim();
  if (!rawUrl) { toast('URL required'); return; }
  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = 'https://' + rawUrl;
  const id = 'usr-' + Date.now();
  const reg = (region || 'USER').slice(0, 4).toUpperCase();
  const displayName = name && name.trim() ? name.trim() : new URL(rawUrl).hostname.replace(/^www\./, '');
  const candidate = { id, name: displayName, url: rawUrl, region: reg, lang: 'en', custom: true };

  toast(`Probing ${displayName}…`);
  try {
    const r = await proxyFetch(rawUrl);
    const text = await r.text();
    let items = parseRSS(text, candidate);

    if (!items.length) {
      // Try auto-detecting an RSS link in the HTML
      const re = /<link[^>]+(?:rel=["']alternate["'][^>]+)?type=["']application\/(?:rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i;
      const m = text.match(re) || text.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/(?:rss|atom)\+xml["']/i);
      if (m) {
        let rssUrl = m[1];
        if (rssUrl.startsWith('//')) rssUrl = 'https:' + rssUrl;
        else if (rssUrl.startsWith('/')) rssUrl = new URL(rawUrl).origin + rssUrl;
        else if (!/^https?:/i.test(rssUrl)) rssUrl = new URL(rssUrl, rawUrl).href;
        candidate.url = rssUrl;
        const r2 = await proxyFetch(rssUrl);
        items = parseRSS(await r2.text(), candidate);
      }
    }

    if (!items.length) { toast(`No RSS at ${displayName}`); return; }

    CUSTOM_SOURCES.push(candidate);
    saveCustomSources();
    state.sourceStatus[id] = { status: 'ok', count: items.length, name: candidate.name };
    state.items = mergeAndDedupe([...items, ...state.items]);
    cacheSet('news', state.items.slice(0, 200));
    renderContent(); renderBanner(); renderSourcesView();
    toast(`+ ${items.length} items from ${displayName}`);
  } catch (e) {
    toast(`Fetch failed: ${e.message}`);
  }
}

function removeCustomSource(id) {
  CUSTOM_SOURCES = CUSTOM_SOURCES.filter((s) => s.id !== id);
  saveCustomSources();
  delete state.sourceStatus[id];
  renderSourcesView();
  toast('Source removed');
}

function bindAddSourceForm() {
  const form = document.getElementById('add-source-form');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.querySelector('input[name=name]').value;
    const url  = form.querySelector('input[name=url]').value;
    const reg  = form.querySelector('input[name=region]')?.value || '';
    tryAddCustomSource(name, url, reg);
    form.querySelector('input[name=name]').value = '';
    form.querySelector('input[name=url]').value = '';
    if (form.querySelector('input[name=region]')) form.querySelector('input[name=region]').value = '';
  });
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('.sremove');
    if (!rm) return;
    removeCustomSource(rm.dataset.id);
  });
}

function renderSourcesView() {
  const builtin = SOURCES.map((s) => {
    const st = state.sourceStatus[s.id] || { status: 'wait', count: 0 };
    return `
      <div class="src-row">
        <span class="sname">${escapeHtml(s.name)} <span style="color:var(--dim2);font-size:10px">${escapeHtml(s.region)} · ${s.lang}</span></span>
        <span class="scount">${st.count} items</span>
        <span class="sstatus ${st.status}">${st.status.toUpperCase()}</span>
      </div>
    `;
  }).join('');
  const custom = CUSTOM_SOURCES.map((s) => {
    const st = state.sourceStatus[s.id] || { status: 'wait', count: 0 };
    return `
      <div class="src-row">
        <span class="sname">${escapeHtml(s.name)} <span style="color:var(--dim2);font-size:10px">${escapeHtml(s.region)} · custom</span></span>
        <span class="scount">${st.count} items</span>
        <span class="sstatus ${st.status}">${st.status.toUpperCase()}</span>
        <button class="sremove" data-id="${escapeHtml(s.id)}" style="margin-left:6px">REMOVE</button>
      </div>
    `;
  }).join('');
  const rows = builtin;
  const html = `
    <form class="add-source" id="add-source-form" autocomplete="off">
      <input type="text" name="name" placeholder="Name (optional)" />
      <input type="url"  name="url"  placeholder="RSS URL — or any site URL, we auto-detect" required />
      <button type="submit">+ ADD &amp; SCRAPE</button>
      <div class="add-hint">▸ Try a regional blog, a Substack RSS, or a news site. We probe the URL, fall back to discovering &lt;link rel="alternate" type="application/rss+xml"&gt; if it's not RSS itself, fetch immediately, and store the source in localStorage.</div>
    </form>
    <div class="section-head">YOUR SOURCES <span class="sub">${CUSTOM_SOURCES.length} custom</span></div>
    <div class="src-grid" id="user-sources">${custom || '<div class="empty">No custom sources yet — add one above.</div>'}</div>
    <div class="section-head">BUILT-IN SOURCES <span class="sub">credible regional outlets</span></div>
    <div class="src-grid">${rows}</div>
    <div class="section-head">DATA ENDPOINTS</div>
    <div class="src-grid">
      <div class="src-row"><span class="sname">Yahoo Finance / Stooq fallback (commodities · indices · DXY)</span><span class="scount">${Object.keys(state.markets).length}/${STOOQ_TICKERS.length}</span><span class="sstatus ${Object.keys(state.markets).length ? 'ok' : 'err'}">${Object.keys(state.markets).length ? 'OK' : 'ERR'}</span></div>
      <div class="src-row"><span class="sname">OilPriceAPI (spot · server-side proxy /api/oil)</span><span class="scount">${state.oilApiStatus === 'ok' ? 'live' : state.oilApiStatus === 'no-key' ? 'no key' : (state.oilApiStatus || 'wait')}</span><span class="sstatus ${state.oilApiStatus === 'ok' ? 'ok' : state.oilApiStatus === 'no-key' ? 'wait' : 'err'}">${state.oilApiStatus === 'ok' ? 'OK' : state.oilApiStatus === 'no-key' ? 'SET ENV' : (state.oilApiStatus || 'WAIT').toUpperCase()}</span></div>
      <div class="src-row"><span class="sname">Frankfurter (FX vs USD)</span><span class="scount">${Object.keys(state.fx).length} pairs</span><span class="sstatus ${Object.keys(state.fx).length ? 'ok' : 'err'}">${Object.keys(state.fx).length ? 'OK' : 'ERR'}</span></div>
      <div class="src-row"><span class="sname">CoinGecko (crypto)</span><span class="scount">${Object.keys(state.crypto).length} assets</span><span class="sstatus ${Object.keys(state.crypto).length ? 'ok' : 'err'}">${Object.keys(state.crypto).length ? 'OK' : 'ERR'}</span></div>
      <div class="src-row"><span class="sname">GDELT 2.0 (tension monitor)</span><span class="scount">${state.tensions.length} articles</span><span class="sstatus ${state.tensions.length ? 'ok' : 'wait'}">${state.tensions.length ? 'OK' : 'WAIT'}</span></div>
      <div class="src-row"><span class="sname">OpenSky (live aircraft · ${activePreset.toUpperCase()} box)</span><span class="scount">${state.aircraft.length} states</span><span class="sstatus ${state.aircraft.length ? 'ok' : 'wait'}">${state.aircraft.length ? 'OK' : 'WAIT'}</span></div>
      <div class="src-row"><span class="sname">AviationAPI (FAA NOTAMs · US gateways)</span><span class="scount">${state.notams.length} active</span><span class="sstatus ${state.notams.length ? 'ok' : 'wait'}">${state.notams.length ? 'OK' : 'WAIT'}</span></div>
      <div class="src-row"><span class="sname">MyMemory (AR → EN translate)</span><span class="scount">${Object.keys(tCache).length} cached</span><span class="sstatus ok">OK</span></div>
    </div>
  `;
  // Bind the add-source form on next paint (innerHTML replacement requires re-bind)
  setTimeout(() => bindAddSourceForm(), 0);
  return html;
}

/* ============================================================
 * DRIVER
 * ============================================================ */
function updateFooter() {
  const total = getAllSources().length;
  const okSources = Object.values(state.sourceStatus).filter((s) => s.status === 'ok').length;
  $('#source-count').textContent = `${okSources}/${total} feeds`;
  $('#last-update').textContent = state.lastUpdate
    ? 'updated ' + fmtTimeUTC(state.lastUpdate)
    : 'never';
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  $('#refresh').classList.add('spin');
  toast('Fetching live data…');

  await Promise.allSettled([
    fetchAllNews().then(() => {
      renderContent();
      renderBanner();
      updateFooter();
    }),
    fetchMarkets().then(renderTicker),
    fetchOilPriceAPI(),
    fetchFX().then(() => {
      renderTicker();
      renderStatusStrip();
    }),
    fetchCrypto().then(() => {
      renderTicker();
      renderStatusStrip();
    }),
    fetchTensions().then(() => {
      if (activeTab === 'tensions') renderContent();
    }),
  ]);

  state.lastUpdate = new Date();
  updateFooter();
  $('#refresh').classList.remove('spin');
  refreshing = false;
}

const CITY_TZ = [
  { id: 'ct-utc', tz: 'UTC' },
  { id: 'ct-dxb', tz: 'Asia/Dubai' },
  { id: 'ct-ruh', tz: 'Asia/Riyadh' },
  { id: 'ct-tlv', tz: 'Asia/Jerusalem' },
  { id: 'ct-lon', tz: 'Europe/London' },
  { id: 'ct-nyc', tz: 'America/New_York' },
  { id: 'ct-sgp', tz: 'Asia/Singapore' },
];

/* Visible world-clock strip — different set than the Zulu tooltip */
const WORLD_CLOCKS = [
  { id: 'wc-auh', tz: 'Asia/Dubai' },
  { id: 'wc-muc', tz: 'Europe/Berlin' },
  { id: 'wc-dca', tz: 'America/New_York' },
  { id: 'wc-lax', tz: 'America/Los_Angeles' },
  { id: 'wc-hkg', tz: 'Asia/Hong_Kong' },
  { id: 'wc-ccs', tz: 'America/Caracas' },
];

function tickClock() {
  const d = new Date();
  const utc = d.toISOString().slice(11, 19) + 'Z';
  const cl = $('#clock'); if (cl) cl.textContent = utc;
  const ht = $('#hud-time'); if (ht) ht.textContent = utc;
  for (const c of CITY_TZ) {
    const el = document.getElementById(c.id);
    if (!el) continue;
    try {
      el.textContent = new Intl.DateTimeFormat('en-GB', {
        timeZone: c.tz, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
    } catch { el.textContent = '—'; }
  }
  for (const c of WORLD_CLOCKS) {
    const el = document.getElementById(c.id);
    if (!el) continue;
    try {
      el.textContent = new Intl.DateTimeFormat('en-GB', {
        timeZone: c.tz, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
    } catch { el.textContent = '—'; }
  }
}

/* ============================================================
 * INFLIGHT INDICATOR — toggles body.fetching while any wrapped
 * network call is in flight, so the cyan ⟳ next to LIVE animates.
 * ============================================================ */
let inflightCount = 0;
function inflightStart() {
  inflightCount++;
  document.body.classList.add('fetching');
}
function inflightEnd() {
  inflightCount = Math.max(0, inflightCount - 1);
  if (inflightCount === 0) document.body.classList.remove('fetching');
}
async function tracked(fn) {
  inflightStart();
  try { return await fn(); }
  finally { inflightEnd(); }
}

/* ============================================================
 * THREAT TRACKER — scans cached items for interception events.
 *   - Drone (UAV / loitering munition / Shahed / Reaper / etc)
 *   - Ballistic missile (SRBM/MRBM/IRBM)
 *   - Cruise missile (Tomahawk / Kalibr / Storm Shadow / etc)
 * Compares last 24h count vs prior 24h count for ▲/▬/▼ delta.
 * ============================================================ */
const INTERCEPT_RE = /\b(intercept(ed|ing)?|shot[- ]?down|shoot[- ]?down|downed|destroyed|neutrali[sz]e[ds]?|engaged and (?:destroyed|kill)|knocked[- ]?down|takedown|brought[- ]?down|hit by [A-Z][A-Z0-9-]+)/i;
const THREAT_RE = {
  drone:     /\b(drone|UAV|unmanned aerial|loitering munition|kamikaze drone|suicide drone|Shahed|quadcopter|hexacopter|Reaper|Predator)\b/i,
  ballistic: /\b(ballistic missile|SRBM|MRBM|IRBM|hypersonic|Iskander|Scud|Fateh|Burkan|Toophan|Qiam)\b/i,
  cruise:    /\b(cruise missile|Tomahawk|Kalibr|Storm Shadow|SCALP|Quds|Paveh|Soumar|Hoveyzeh|land[- ]?attack cruise|anti[- ]?ship missile)\b/i,
};

/* UAE-scoped — item must mention UAE / Emirates / a UAE emirate or be from
 * a UAE-government source before it's counted. */
const UAE_TARGET_RE = /\b(UAE|Emirates|U\.A\.E\.|Abu[ -]?Dhabi|Dubai|Sharjah|Fujairah|Ajman|Umm[ -]?al[- ]?Quwain|Ras[ -]?al[- ]?Khaimah|Al[ -]?Ain|Hormuz|Strait of Hormuz)\b/i;

function computeThreats() {
  const now = Date.now();
  const day = 86_400_000;
  const counts = { drone: [0, 0], ballistic: [0, 0], cruise: [0, 0] };
  for (const it of state.items) {
    const age = now - (it.date instanceof Date ? it.date.getTime() : new Date(it.date).getTime());
    if (isNaN(age)) continue;
    const bucket = age < day ? 0 : age < 2 * day ? 1 : null;
    if (bucket === null) continue;
    const text = it.title + ' ' + (it.summary || '');
    // UAE-scope filter: title/summary must reference UAE, OR the item source
    // is a UAE government channel
    const isUaeSource = typeof it.region === 'string' && it.region.startsWith('AE');
    if (!isUaeSource && !UAE_TARGET_RE.test(text)) continue;
    if (!INTERCEPT_RE.test(text)) continue;
    if (THREAT_RE.drone.test(text))     counts.drone[bucket]++;
    if (THREAT_RE.ballistic.test(text)) counts.ballistic[bucket]++;
    if (THREAT_RE.cruise.test(text))    counts.cruise[bucket]++;
  }
  return counts;
}

function renderThreatWatch() {
  const c = computeThreats();
  const apply = (today, prev, valId, delId) => {
    const valEl = document.getElementById(valId);
    const delEl = document.getElementById(delId);
    if (!valEl || !delEl) return;
    valEl.textContent = String(today);
    let cls = 'same', txt = '▬';
    if (today > prev) { cls = 'up';   txt = '▲' + (today - prev); }
    else if (today < prev) { cls = 'down'; txt = '▼' + (prev - today); }
    delEl.className = 'tw-delta ' + cls;
    delEl.textContent = txt;
  };
  apply(c.drone[0],     c.drone[1],     'tw-drone',     'tw-drone-d');
  apply(c.ballistic[0], c.ballistic[1], 'tw-ballistic', 'tw-ballistic-d');
  apply(c.cruise[0],    c.cruise[1],    'tw-cruise',    'tw-cruise-d');
}

function bindTabs() {
  $$('#tabs .tab').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });
}

function bindHelp() {
  $('#help-close').addEventListener('click', () => { $('#help').hidden = true; });
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').hidden = true; });
}

/* ============================================================
 * PRELOAD — kick off every fetch in parallel ASAP, render incrementally.
 * Cached data has already hydrated state for first paint.
 * ============================================================ */
function preload() {
  // Paint cached data immediately, then kick off live fetches in parallel.
  renderTicker();
  renderStatusStrip();
  renderBanner();
  renderContent();
  updateFooter();

  // All network calls in parallel; each updates its slice as it lands.
  Promise.allSettled([
    fetchAllNews().then(() => {
      renderContent();
      renderBanner();
      renderThreatWatch();
      updateFooter();
    }),
    tracked(() => fetchMarkets().then(renderTicker)),
    tracked(fetchOilPriceAPI),
    tracked(() => fetchFX().then(() => { renderTicker(); renderStatusStrip(); })),
    tracked(() => fetchCrypto().then(() => { renderTicker(); renderStatusStrip(); })),
    tracked(() => fetchTensions().then(() => { if (activeTab === 'tensions') renderContent(); })),
    // Pre-fetch aircraft so the MAP tab is populated the moment the user
    // clicks it — no awkward 5s 'no planes' window.
    tracked(() => fetchAircraft().then(() => {
      if (activeTab === 'map' && leafletMap) renderAircraft();
    })),
  ]).then(() => {
    state.lastUpdate = new Date();
    updateFooter();
  });
}

/**
 * Battlefield-style boot sequence — runs 2.5s in foreground while preload()
 * fires every fetch in the background.
 */
function bootSequence() {
  const overlay = document.getElementById('boot');
  if (!overlay) return;
  const log = document.getElementById('boot-log');
  const bar = document.getElementById('boot-bar');
  const pct = document.getElementById('boot-pct');
  const eta = document.getElementById('boot-eta');

  const phrases = [
    'ESTABLISHING SECURE CHANNEL',
    'AUTHENTICATING SESSION TOKEN',
    'DECRYPTING FEED REGISTRY',
    'SPINNING UP OSINT NODES · 22 SOURCES',
    'INGESTING GDELT 2.0 STREAM',
    'PINGING OPENSKY · MENA / GULF SECTOR',
    'SYNCING TACTICAL OVERLAY · CARTODB',
    'RESOLVING SIGINT CORRELATION',
    'INDEXING CHOKEPOINT TELEMETRY · HRMZ',
    'PARSING REGIONAL WIRE FEEDS',
    'WARMING HOT CACHE · LOCALSTORAGE',
    'CALIBRATING THREAT MATRIX',
    'PRIMING LIVE BROADCAST CHANNELS',
    'TERMINAL READY · STANDBY',
  ];

  const total = 2500;
  const t0 = performance.now();
  const stagger = total / phrases.length;

  phrases.forEach((p, i) => {
    setTimeout(() => {
      const row = document.createElement('div');
      row.className = 'boot-row';
      row.innerHTML =
        `<span class="b-arrow">▸</span>` +
        `<span class="b-msg">${p}</span>` +
        `<span class="b-stat">··</span>`;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
      setTimeout(() => {
        const stat = row.querySelector('.b-stat');
        if (!stat) return;
        stat.textContent = i === phrases.length - 1 ? 'GO' : 'OK';
        stat.className = 'b-stat ok';
      }, Math.min(stagger * 0.7, 220));
    }, i * stagger);
  });

  const tick = () => {
    const dt = performance.now() - t0;
    const p = Math.min(1, dt / total);
    if (bar) bar.style.width = (p * 100).toFixed(2) + '%';
    if (pct) pct.textContent = String(Math.floor(p * 100)).padStart(3, '0') + '%';
    if (eta) eta.textContent = `T+${(dt / 1000).toFixed(2)}s / 2.50s`;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  setTimeout(() => {
    overlay.classList.add('boot-done');
    setTimeout(() => overlay.remove(), 700);
  }, total);
}

function init() {
  bindTabs();
  bindSearch();
  bindModal();
  bindKeyboard();
  bindHelp();
  bindContentClicks();
  $('#refresh').addEventListener('click', refresh);

  tickClock();
  setInterval(tickClock, 1000);

  // re-render relative timestamps every 30s without re-fetching
  setInterval(() => {
    if (['all','security','politics','economy'].includes(activeTab) && !state.searchActive) renderContent();
  }, 30_000);

  // Re-fill ticker lanes on window resize so the copy count adapts to the
  // new viewport width — keeps the loop seamless across breakpoints.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderTicker, 250);
  });

  // Boot animation runs in foreground; preload fetches in background.
  bootSequence();
  preload();

  setInterval(refresh, 180_000); // 3 min full refresh
}

// Run init right away — DOM is parsed by the time this script (placed at body
// end) executes, so no DOMContentLoaded wait is needed.
init();
