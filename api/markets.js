/**
 * /api/markets — Vercel Edge Function.
 * Server-side proxy to Yahoo Finance v8/chart for every ticker we care about.
 * Eliminates the public-CORS-proxy roulette that was returning HTML error
 * pages and leaving the markets tab empty. Cached at the edge for 60s.
 *
 * Stooq is kept as a fallback inside the same function so the client only
 * makes one round trip.
 */

export const config = { runtime: 'edge' };

const TICKERS = [
  { sym: 'cl.f',  yahoo: 'CL=F',     stooq: 'cl.f',  label: 'WTI',     unit: '$', group: 'energy' },
  { sym: 'b.f',   yahoo: 'BZ=F',     stooq: 'b.f',   label: 'BRENT',   unit: '$', group: 'energy' },
  { sym: 'ng.f',  yahoo: 'NG=F',     stooq: 'ng.f',  label: 'NATGAS',  unit: '$', group: 'energy' },
  { sym: 'gc.f',  yahoo: 'GC=F',     stooq: 'gc.f',  label: 'GOLD',    unit: '$', group: 'metals' },
  { sym: 'si.f',  yahoo: 'SI=F',     stooq: 'si.f',  label: 'SILVER',  unit: '$', group: 'metals' },
  { sym: '^spx',  yahoo: '^GSPC',    stooq: '^spx',  label: 'S&P 500', unit: '',  group: 'index'  },
  { sym: '^dji',  yahoo: '^DJI',     stooq: '^dji',  label: 'DOW',     unit: '',  group: 'index'  },
  { sym: '^ndq',  yahoo: '^IXIC',    stooq: '^ndq',  label: 'NDQ',     unit: '',  group: 'index'  },
  { sym: '^ta35', yahoo: '^TA125.TA',stooq: '^ta35', label: 'TA-125',  unit: '',  group: 'index'  },
  { sym: 'dx.f',  yahoo: 'DX-Y.NYB', stooq: 'dx.f',  label: 'DXY',     unit: '',  group: 'fx'     },
];

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
};

async function fromYahoo(yahooSym) {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=5d`,
      { headers: YAHOO_HEADERS, cache: 'no-store' }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null) return null;
    const price = Number(meta.regularMarketPrice);
    const prev  = meta.chartPreviousClose ?? meta.previousClose;
    let pct = null, change = null;
    if (prev != null && !isNaN(prev) && prev !== 0) {
      change = price - prev;
      pct = (change / prev) * 100;
    }
    return { price, change, pct, source: 'yahoo' };
  } catch { return null; }
}

async function fromStooq(stooqSym) {
  try {
    const r = await fetch(
      `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSym)}&f=sd2t2ohlcvpn&h&e=csv`,
      { cache: 'no-store' }
    );
    if (!r.ok) return null;
    const text = (await r.text()).trim();
    const lines = text.split(/\r?\n/);
    if (lines.length < 2 || !/^Symbol[, ]/i.test(lines[0])) return null;
    const cols = lines[1].split(',');
    const open  = parseFloat(cols[3]);
    const close = parseFloat(cols[6]);
    const pctRaw = cols[8];
    if (isNaN(close) || close === 0) return null;
    let pct = null;
    if (pctRaw && pctRaw !== 'N/D' && pctRaw !== 'N/A') {
      const n = parseFloat(String(pctRaw).replace(/[%\s]/g, ''));
      if (!isNaN(n)) pct = n;
    }
    if (pct == null && !isNaN(open) && open !== 0) {
      pct = ((close - open) / open) * 100;
    }
    const change = pct != null ? (close * pct) / 100 : null;
    return { price: close, change, pct, source: 'stooq' };
  } catch { return null; }
}

export default async function handler(request) {
  try {
    const results = await Promise.all(TICKERS.map(async (t) => {
      let m = await fromYahoo(t.yahoo);
      if (!m && t.stooq) m = await fromStooq(t.stooq);
      if (!m) return { ...t, error: 'no data' };
      return { ...t, ...m };
    }));
    return new Response(JSON.stringify({ ok: true, results, at: Date.now() }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, s-maxage=60, stale-while-revalidate=180',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
