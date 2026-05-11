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
 * Race all proxies in parallel; resolve with the first that returns 2xx.
 * Dramatically faster than sequential fallback when one proxy is slow.
 */
async function proxyFetch(url, opts = {}) {
  const controllers = PROXIES.map(() => new AbortController());
  let winnerIdx = -1;
  const tries = PROXIES.map((wrap, i) =>
    fetch(wrap(url), { ...opts, cache: 'no-store', signal: controllers[i].signal })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (winnerIdx === -1) {
          winnerIdx = i;
          controllers.forEach((c, j) => { if (j !== i) try { c.abort(); } catch {} });
        }
        return r;
      })
  );
  try {
    return await Promise.any(tries);
  } catch {
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
  { id: 'aje',  name: 'Al Jazeera EN',     url: 'https://www.aljazeera.com/xml/rss/all.xml',                region: 'QA',  lang: 'en' },
  { id: 'toi',  name: 'Times of Israel',   url: 'https://www.timesofisrael.com/feed/',                      region: 'IL',  lang: 'en' },
  { id: 'jp',   name: 'Jerusalem Post',    url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx',         region: 'IL',  lang: 'en' },
  { id: 'tn',   name: 'The National (UAE)',url: 'https://www.thenationalnews.com/rss/uae',                  region: 'AE',  lang: 'en' },
  { id: 'tnmena', name: 'The National MENA', url: 'https://www.thenationalnews.com/rss/mena',               region: 'AE',  lang: 'en' },
  { id: 'an',   name: 'Arab News',         url: 'https://www.arabnews.com/rss.xml',                         region: 'SA',  lang: 'en' },
  { id: 'kt',   name: 'Khaleej Times',     url: 'https://www.khaleejtimes.com/rss',                         region: 'AE',  lang: 'en' },
  { id: 'mee',  name: 'Middle East Eye',   url: 'https://www.middleeasteye.net/rss',                        region: 'REG', lang: 'en' },
  { id: 'rt-me', name: 'Reuters MENA',     url: 'https://news.google.com/rss/search?q=site:reuters.com+(Israel+OR+Iran+OR+Gulf+OR+Saudi+OR+UAE+OR+Gaza)+when:1d&hl=en-US&gl=US&ceid=US:en', region: 'WIRE', lang: 'en' },
  { id: 'bbc-me', name: 'BBC Middle East', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',  region: 'REG', lang: 'en' },
  // Arabic GCC source — auto-translated headlines (MyMemory free tier)
  { id: 'alar', name: 'Al Arabiya (AR)',   url: 'https://www.alarabiya.net/.mrss/ar.xml',                   region: 'SA',  lang: 'ar' },
];

/* ============================================================
 * MARKET TICKERS
 *   Stooq CSV (commodities, indices, DXY)
 *   Frankfurter (FX vs USD)
 *   CoinGecko (crypto)
 * ============================================================ */
const STOOQ_TICKERS = [
  { sym: 'cl.f',  label: 'WTI',    unit: '$', group: 'energy' },
  { sym: 'b.f',   label: 'BRENT',  unit: '$', group: 'energy' },
  { sym: 'ng.f',  label: 'NATGAS', unit: '$', group: 'energy' },
  { sym: 'gc.f',  label: 'GOLD',   unit: '$', group: 'metals' },
  { sym: 'si.f',  label: 'SILVER', unit: '$', group: 'metals' },
  { sym: '^spx',  label: 'S&P 500',unit: '',  group: 'index'  },
  { sym: '^dji',  label: 'DOW',    unit: '',  group: 'index'  },
  { sym: '^ndq',  label: 'NDQ',    unit: '',  group: 'index'  },
  { sym: '^ta35', label: 'TA-35',  unit: '',  group: 'index'  },
  { sym: 'dx.f',  label: 'DXY',    unit: '',  group: 'fx'     },
];

const FX_PAIRS  = ['ILS','AED','SAR','EGP','QAR','EUR','GBP','TRY','JPY'];
const CRYPTO_IDS = ['bitcoin','ethereum'];

/* ============================================================
 * AIRCRAFT / NOTAMs
 *   OpenSky Network — bounded query (1 credit/call, ~400/day anon)
 *   AviationAPI    — free FAA NOTAM proxy, no key
 * ============================================================ */
const MENA_BBOX = { lamin: 10, lamax: 45, lomin: 20, lomax: 70 };
const NOTAM_AIRPORTS = ['KJFK','KLAX','KIAD','KORD','KMIA','KATL','KDFW','KBOS','KSFO'];

/* Map presets — center, zoom, OpenSky bounding box */
const MAP_PRESETS = {
  mena:   { center: [27.0,   42.0],  zoom: 4, bbox: { lamin: 10, lamax: 45, lomin: 20, lomax: 70 } },
  hormuz: { center: [26.566, 56.25], zoom: 7, bbox: { lamin: 22, lamax: 30, lomin: 50, lomax: 62 } },
  redsea: { center: [20.0,   38.0],  zoom: 5, bbox: { lamin: 10, lamax: 30, lomin: 30, lomax: 46 } },
  med:    { center: [37.0,   18.0],  zoom: 5, bbox: { lamin: 30, lamax: 45, lomin: -5, lomax: 36 } },
  global: { center: [25.0,   30.0],  zoom: 3, bbox: { lamin: -10, lamax: 60, lomin: -20, lomax: 90 } },
};
let activePreset = 'mena';

/* Maritime chokepoints — mil-style markers w/ range rings (nautical miles) */
const CHOKEPOINTS = [
  { code: 'HRMZ', name: 'STRAIT OF HORMUZ', lat: 26.566, lon: 56.250, rings_nm: [50, 100, 200] },
  { code: 'BAB',  name: 'BAB EL-MANDEB',    lat: 12.583, lon: 43.333, rings_nm: [50, 100] },
  { code: 'SUEZ', name: 'SUEZ CANAL',       lat: 30.583, lon: 32.275, rings_nm: [50] },
  { code: 'BOSP', name: 'BOSPHORUS',        lat: 41.117, lon: 29.067, rings_nm: [50] },
  { code: 'GIB',  name: 'GIBRALTAR',        lat: 35.967, lon: -5.483, rings_nm: [50] },
];

/* YouTube live channels — embed via /embed/live_stream?channel=ID */
const LIVE_CHANNELS = [
  { id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', name: 'AL JAZEERA EN',  desk: 'DOHA · QA'      },
  { id: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', name: 'FRANCE 24 EN',   desk: 'PARIS · FR'     },
  { id: 'UCoMdktPbSTixAyNGwb-UYkQ', name: 'SKY NEWS',       desk: 'LONDON · UK'    },
  { id: 'UCknLrEdhRCp1aegoMqRaCZg', name: 'DW NEWS',        desk: 'BERLIN · DE'    },
  { id: 'UCIALMKvObZNtJ6AmdCLP7Lg', name: 'BLOOMBERG TV',   desk: 'NEW YORK · US'  },
  { id: 'UC7fWeaHhqgM4Ry-RMpM2YYw', name: 'TRT WORLD',      desk: 'ISTANBUL · TR'  },
  { id: 'UCWAPpM5sn5BAhf-9TaIYBkw', name: 'AL ARABIYA',     desk: 'RIYADH · SA (AR)' },
  { id: 'UChqUTb7kYRX8-EiaN3XdGSQ', name: 'REUTERS',        desk: 'WIRE · GLOBAL'  },
];

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
  economy:  /\b(oil|gas|OPEC|GDP|inflation|budget|bank|stock|market|exchange|trade|tariff|IMF|currency|fund|invest|deal|merger|acquisition|earnings|revenue|profit|loss|barrel|crude|brent|WTI|gold|dirham|riyal|shekel|aramco|adnoc|tadawul|DFM|TASI|TA[- ]?35|interest rate|hike|cut|bond|yield|recession|growth|export|import|IPO|sovereign wealth|PIF|mubadala|ADQ)/i,
};

function classify(title, summary = '') {
  const text = title + ' ' + summary;
  const tags = [];
  if (KW.security.test(text)) tags.push('security');
  if (KW.politics.test(text)) tags.push('politics');
  if (KW.economy.test(text))  tags.push('economy');
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
    const r = await proxyFetch(src.url);
    const text = await r.text();
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
  const tasks = SOURCES.map((src) =>
    fetchSource(src).then((items) => {
      if (!items.length) return;
      buf.push(...items);
      state.items = mergeAndDedupe(buf.concat(state.items));
      // Re-render only news-list tabs (skip map/live to avoid disrupting them)
      if (!['map','live','markets','tensions','sources'].includes(activeTab) && !state.searchActive) {
        renderContent();
      }
      renderBanner();
      updateFooter();
    })
  );
  await Promise.allSettled(tasks);
  cacheSet('news', state.items.slice(0, 200));
}

/* ============================================================
 * MARKETS — STOOQ CSV
 * ============================================================ */
async function fetchStooq(sym) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcvpn&h&e=csv`;
  try {
    const r = await proxyFetch(url);
    const text = await r.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = lines[1].split(',');
    // header: Symbol,Date,Time,Open,High,Low,Close,Volume,Percent,Name
    const open  = parseFloat(cols[3]);
    const close = parseFloat(cols[6]);
    const pctRaw = cols[8];
    if (isNaN(close) || close === 0) return null;
    let pct = null;
    if (pctRaw && pctRaw !== 'N/D' && pctRaw !== 'N/A') {
      const cleaned = String(pctRaw).replace(/[%\s]/g, '');
      const n = parseFloat(cleaned);
      if (!isNaN(n)) pct = n;
    }
    // fallback: derive intraday move from open->close when % missing
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

async function fetchMarkets() {
  // fire all stooq calls in parallel, render as each lands
  const partial = { ...state.markets };
  await Promise.allSettled(
    STOOQ_TICKERS.map(async (t) => {
      const m = await fetchStooq(t.sym);
      if (!m) return;
      partial[t.sym] = { ...m, label: t.label, unit: t.unit, group: t.group };
      state.markets = { ...partial };
      renderTicker();
      if (activeTab === 'markets') renderContent();
    })
  );
  cacheSet('markets', state.markets);
}

/* ============================================================
 * FX — Frankfurter (native CORS, no key)
 * ============================================================ */
async function fetchFX() {
  try {
    const r = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${FX_PAIRS.join(',')}`);
    const j = await r.json();
    state.fx = j?.rates || {};
    cacheSet('fx', state.fx);
  } catch (e) {
    console.warn('[fx]', e.message);
  }
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
async function fetchTensions() {
  const q = '(Iran OR Gaza OR Houthi OR Hezbollah OR Hamas OR Israel OR UAE OR "Red Sea" OR "Saudi Arabia" OR Lebanon OR Syria OR Yemen) (strike OR attack OR missile OR drone OR clash OR military OR raid OR rocket)';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=40&format=json&sort=DateDesc&timespan=24h`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('GDELT ' + r.status);
    const j = await r.json();
    state.tensions = (j.articles || []).map((a) => ({
      title: a.title,
      url: a.url,
      domain: a.domain,
      date: parseGdeltDate(a.seendate),
      country: a.sourcecountry,
      language: a.language,
    }));
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
  const { lamin, lamax, lomin, lomax } = (MAP_PRESETS[activePreset] || MAP_PRESETS.mena).bbox;
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
  let j;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('OpenSky ' + r.status);
    j = await r.json();
  } catch (e1) {
    try {
      const r = await proxyFetch(url);
      j = await r.json();
    } catch (e2) {
      console.warn('[opensky]', e1.message, '|', e2.message);
      return;
    }
  }
  state.aircraft = (j?.states || []).filter((s) => s[5] != null && s[6] != null);
  state.aircraftFetchedAt = Date.now();
  cacheSet('aircraft', { at: Date.now(), preset: activePreset, states: state.aircraft });
}

/* ============================================================
 * NOTAMs — AviationAPI (free, no key, FAA source data)
 * Response shape: { ICAO: [ { ... }, ... ], ... }
 * ============================================================ */
async function fetchNotams() {
  const url = `https://api.aviationapi.com/v1/notams?apt=${NOTAM_AIRPORTS.join(',')}`;
  let j;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('AviationAPI ' + r.status);
    j = await r.json();
  } catch (e1) {
    try {
      const r = await proxyFetch(url);
      j = await r.json();
    } catch (e2) {
      console.warn('[notam]', e1.message, '|', e2.message);
      state.notams = [];
      return;
    }
  }
  const out = [];
  Object.entries(j || {}).forEach(([apt, list]) => {
    if (!Array.isArray(list)) return;
    list.slice(0, 8).forEach((n) => {
      const msg =
        n.notam?.text ||
        n.text ||
        n.message ||
        n.notam_text ||
        (typeof n === 'string' ? n : JSON.stringify(n));
      const id =
        n.notam_number || n.notamNumber || n.notam?.number || n.id || '';
      const issued =
        n.issue_date || n.effective_date || n.issued || n.notam?.issued || '';
      out.push({
        apt,
        id: String(id).slice(0, 40),
        msg: String(msg).replace(/\s+/g, ' ').trim().slice(0, 360),
        issued: String(issued).slice(0, 24),
      });
    });
  });
  state.notams = out;
  cacheSet('notams', state.notams);
}

/* ============================================================
 * RENDER — TICKER
 * ============================================================ */
function renderTicker() {
  const parts = [];

  STOOQ_TICKERS.forEach((t) => {
    const m = state.markets[t.sym];
    if (!m) return;
    const cls = (m.pct ?? 0) >= 0 ? 'up' : 'down';
    const arr = (m.pct ?? 0) >= 0 ? '▲' : '▼';
    const pctTxt = m.pct != null ? `${arr}${fmtNum(Math.abs(m.pct), 2)}%` : '';
    parts.push(
      `<span class="tk"><b>${t.label}</b>${t.unit}${fmtNum(m.price)} <span class="${cls}">${pctTxt}</span></span>`
    );
  });

  Object.entries(state.fx).forEach(([cur, rate]) => {
    parts.push(`<span class="tk"><b>USD/${cur}</b>${fmtNum(rate, 4)}</span>`);
  });

  Object.entries(state.crypto).forEach(([id, v]) => {
    const lbl = id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : id.toUpperCase();
    const pct = v.usd_24h_change ?? 0;
    const cls = pct >= 0 ? 'up' : 'down';
    const arr = pct >= 0 ? '▲' : '▼';
    parts.push(
      `<span class="tk"><b>${lbl}</b>$${fmtNum(v.usd)} <span class="${cls}">${arr}${fmtNum(Math.abs(pct), 2)}%</span></span>`
    );
  });

  if (!parts.length) {
    $('#ticker-track').innerHTML = '<span class="tk">LIVE MARKET FEED INITIALISING…</span>';
    return;
  }
  const joined = parts.join('<span class="sep">·</span>');
  // duplicate for seamless marquee loop
  $('#ticker-track').innerHTML = joined + '<span class="sep">·</span>' + joined;
}

/* ============================================================
 * RENDER — STATUS STRIP (FX pinned under the ticker)
 * ============================================================ */
function renderStatusStrip() {
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

  // ---- Mouse position → HUD DTG ----
  leafletMap.on('mousemove', (e) => {
    const lat = e.latlng.lat.toFixed(2);
    const lon = e.latlng.lng.toFixed(2);
    const dtg = $('#hud-dtg'); if (dtg) dtg.textContent = `${lat}° · ${lon}°`;
  });

  // ---- Periodic refresh, only while MAP tab visible ----
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
  el.innerHTML = state.notams.slice(0, 60).map((n) => `
    <div class="notam-row">
      <div class="notam-head">
        <span class="notam-apt">${escapeHtml(n.apt)}</span>
        ${n.id ? `<span class="notam-id">${escapeHtml(n.id)}</span>` : ''}
        ${n.issued ? `<span class="notam-date">${escapeHtml(n.issued)}</span>` : ''}
      </div>
      <div class="notam-msg">${escapeHtml(n.msg)}</div>
    </div>
  `).join('');
  const c = $('#notam-count'); if (c) c.textContent = `${state.notams.length} active`;
}

/* ============================================================
 * LIVE BROADCAST GRID — YouTube channel-live embeds (lazy)
 * ============================================================ */
function renderLive() {
  const grid = $('#live-grid');
  if (grid.dataset.rendered) return;
  grid.innerHTML = LIVE_CHANNELS.map((ch) => `
    <div class="live-tile" data-channel="${ch.id}">
      <div class="lt-head">
        <span class="lt-name">${escapeHtml(ch.name)}</span>
        <span class="lt-reg"><span class="live-dot"></span>${escapeHtml(ch.desk)}</span>
      </div>
      <div class="lt-frame">
        <div class="lt-placeholder" role="button" tabindex="0">
          ▶ TAP TO STREAM
          <span class="lt-sub">YouTube · channel live</span>
        </div>
      </div>
    </div>
  `).join('');
  grid.dataset.rendered = '1';

  const play = (tile) => {
    const ch = tile.dataset.channel;
    const frame = tile.querySelector('.lt-frame');
    frame.innerHTML =
      `<iframe src="https://www.youtube.com/embed/live_stream?channel=${ch}&autoplay=1" ` +
      `allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  };

  grid.addEventListener('click', (e) => {
    const ph = e.target.closest('.lt-placeholder');
    if (!ph) return;
    play(ph.closest('.live-tile'));
  });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const ph = e.target.closest('.lt-placeholder');
    if (!ph) return;
    e.preventDefault();
    play(ph.closest('.live-tile'));
  });
}

/* ============================================================
 * SEARCH — Perplexity-style retrieval. Cached news + fresh GDELT.
 * No LLM. Citations only.
 * ============================================================ */
async function fetchGdeltSearch(q) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=40&format=json&sort=DateDesc&timespan=2d`;
  try {
    const r = await fetch(url);
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

function localMatch(it, q) {
  return (
    it.title.toLowerCase().includes(q) ||
    (it.summary || '').toLowerCase().includes(q) ||
    (it.source || '').toLowerCase().includes(q) ||
    (it.region || '').toLowerCase().includes(q) ||
    (it.originalTitle || '').toLowerCase().includes(q)
  );
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
      <span class="search-nb">RETRIEVAL ONLY · NO LLM SUMMARY</span>
    </div>
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
  const clearBtn = $('#query-clear');

  const submit = () => {
    const q = input.value.trim();
    if (!q) {
      state.searchActive = false;
      state.searchQuery = '';
      state.searchGdelt = [];
      clearBtn.hidden = true;
      renderContent();
      return;
    }
    state.searchActive = true;
    state.searchQuery = q;
    clearBtn.hidden = false;
    renderSearch();
    fetchGdeltSearch(q).then(renderSearch);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') { input.value = ''; submit(); input.blur(); }
  });
  goBtn.addEventListener('click', submit);
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
const TAB_ORDER = ['all','security','politics','economy','markets','map','live','tensions','sources'];
const TAB_LETTERS = { a: 'all', s: 'security', p: 'politics', e: 'economy', m: 'markets', v: 'map', l: 'live', t: 'tensions' };

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

  if (activeTab === 'map') {
    c.hidden = true; lv.hidden = true; mv.hidden = false;
    initMapOnce();
    return;
  }
  if (activeTab === 'live') {
    c.hidden = true; mv.hidden = true; lv.hidden = false;
    renderLive();
    return;
  }
  mv.hidden = true; lv.hidden = true; c.hidden = false;

  if (state.searchActive) { renderSearch(); return; }

  switch (activeTab) {
    case 'markets':  c.innerHTML = renderMarketsView();  return;
    case 'tensions': c.innerHTML = renderTensionsView(); return;
    case 'sources':  c.innerHTML = renderSourcesView();  return;
  }

  let items = state.items;
  if (activeTab !== 'all') {
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
  const card = (label, value, change, unit, pct) => {
    const has = value != null && !isNaN(value);
    const dir = (pct ?? 0) >= 0 ? 'up' : 'down';
    const arr = (pct ?? 0) >= 0 ? '▲' : '▼';
    const cTxt = (pct != null && change != null)
      ? `${arr} ${fmtNum(Math.abs(change))} (${fmtNum(Math.abs(pct), 2)}%)`
      : (pct != null ? `${arr} ${fmtNum(Math.abs(pct), 2)}%` : '—');
    return `
      <div class="mcard ${has ? dir : ''}">
        <div class="ml">${escapeHtml(label)}</div>
        <div class="mv">${has ? (unit || '') + fmtNum(value) : '—'}</div>
        <div class="mc">${has ? cTxt : ''}</div>
      </div>
    `;
  };

  const energy = STOOQ_TICKERS.filter((t) => t.group === 'energy').map((t) => {
    const m = state.markets[t.sym] || {};
    return card(t.label, m.price, m.change, t.unit, m.pct);
  }).join('');

  const metals = STOOQ_TICKERS.filter((t) => t.group === 'metals').map((t) => {
    const m = state.markets[t.sym] || {};
    return card(t.label, m.price, m.change, t.unit, m.pct);
  }).join('');

  const indices = STOOQ_TICKERS.filter((t) => t.group === 'index' || t.group === 'fx').map((t) => {
    const m = state.markets[t.sym] || {};
    return card(t.label, m.price, m.change, t.unit, m.pct);
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
  const head = `<div class="section-head">GDELT 2.0 TENSION FEED <span class="sub">last 24h · conflict-tagged coverage</span></div>`;
  const body = state.tensions.slice(0, 80).map((t) => `
    <article class="item">
      <div class="meta-row">
        <span class="time">${fmtTimeUTC(t.date)}</span>
        <span class="ago">−${fmtAgo(t.date)}</span>
        <span class="src">${escapeHtml(t.domain || 'gdelt')}</span>
        ${t.country ? `<span class="region">${escapeHtml(t.country.slice(0,3).toUpperCase())}</span>` : ''}
      </div>
      <a class="title" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a>
      <div class="tag-row"><span class="tag tag-tension">TENSION</span></div>
    </article>
  `).join('');
  return head + body;
}

function renderSourcesView() {
  const rows = SOURCES.map((s) => {
    const st = state.sourceStatus[s.id] || { status: 'wait', count: 0 };
    return `
      <div class="src-row">
        <span class="sname">${escapeHtml(s.name)} <span style="color:var(--dim2);font-size:10px">${escapeHtml(s.region)} · ${s.lang}</span></span>
        <span class="scount">${st.count} items</span>
        <span class="sstatus ${st.status}">${st.status.toUpperCase()}</span>
      </div>
    `;
  }).join('');
  return `
    <div class="section-head">NEWS SOURCES <span class="sub">credible regional outlets</span></div>
    <div class="src-grid">${rows}</div>
    <div class="section-head">DATA ENDPOINTS</div>
    <div class="src-grid">
      <div class="src-row"><span class="sname">Stooq CSV (commodities · indices · DXY)</span><span class="scount">${Object.keys(state.markets).length}/${STOOQ_TICKERS.length}</span><span class="sstatus ${Object.keys(state.markets).length ? 'ok' : 'err'}">${Object.keys(state.markets).length ? 'OK' : 'ERR'}</span></div>
      <div class="src-row"><span class="sname">Frankfurter (FX vs USD)</span><span class="scount">${Object.keys(state.fx).length} pairs</span><span class="sstatus ${Object.keys(state.fx).length ? 'ok' : 'err'}">${Object.keys(state.fx).length ? 'OK' : 'ERR'}</span></div>
      <div class="src-row"><span class="sname">CoinGecko (crypto)</span><span class="scount">${Object.keys(state.crypto).length} assets</span><span class="sstatus ${Object.keys(state.crypto).length ? 'ok' : 'err'}">${Object.keys(state.crypto).length ? 'OK' : 'ERR'}</span></div>
      <div class="src-row"><span class="sname">GDELT 2.0 (tension monitor)</span><span class="scount">${state.tensions.length} articles</span><span class="sstatus ${state.tensions.length ? 'ok' : 'wait'}">${state.tensions.length ? 'OK' : 'WAIT'}</span></div>
      <div class="src-row"><span class="sname">OpenSky (live aircraft · MENA box)</span><span class="scount">${state.aircraft.length} states</span><span class="sstatus ${state.aircraft.length ? 'ok' : 'wait'}">${state.aircraft.length ? 'OK' : 'WAIT'}</span></div>
      <div class="src-row"><span class="sname">AviationAPI (FAA NOTAMs · US gateways)</span><span class="scount">${state.notams.length} active</span><span class="sstatus ${state.notams.length ? 'ok' : 'wait'}">${state.notams.length ? 'OK' : 'WAIT'}</span></div>
      <div class="src-row"><span class="sname">MyMemory (AR → EN translate)</span><span class="scount">${Object.keys(tCache).length} cached</span><span class="sstatus ok">OK</span></div>
    </div>
  `;
}

/* ============================================================
 * DRIVER
 * ============================================================ */
function updateFooter() {
  const okSources = Object.values(state.sourceStatus).filter((s) => s.status === 'ok').length;
  $('#source-count').textContent = `${okSources}/${SOURCES.length} feeds`;
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

function tickClock() {
  const d = new Date();
  const utc = d.toISOString().slice(11, 19) + 'Z';
  const cl = $('#clock'); if (cl) cl.textContent = utc;
  const ht = $('#hud-time'); if (ht) ht.textContent = utc;
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
      updateFooter();
    }),
    fetchMarkets().then(renderTicker),
    fetchFX().then(() => { renderTicker(); renderStatusStrip(); }),
    fetchCrypto().then(() => { renderTicker(); renderStatusStrip(); }),
    fetchTensions().then(() => { if (activeTab === 'tensions') renderContent(); }),
  ]).then(() => {
    state.lastUpdate = new Date();
    updateFooter();
  });
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

  preload();
  setInterval(refresh, 180_000); // 3 min full refresh
}

// Run init right away — DOM is parsed by the time this script (placed at body
// end) executes, so no DOMContentLoaded wait is needed.
init();
