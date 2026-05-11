/**
 * /api/fx — server-side FX proxy.
 * Tries Frankfurter (.dev primary, .app fallback) then ExchangeRate.host.
 * Cached at the edge for 5 minutes.
 */

export const config = { runtime: 'edge' };

const PAIRS = ['ILS','AED','SAR','EGP','QAR','EUR','GBP','TRY','JPY','OMR','BHD','KWD'];

async function tryFrankfurter(host) {
  try {
    const r = await fetch(`https://${host}/latest?base=USD&symbols=${PAIRS.join(',')}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.rates || null;
  } catch { return null; }
}
async function tryFrankfurterV1() {
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${PAIRS.join(',')}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.rates || null;
  } catch { return null; }
}
async function tryExchangeHost() {
  try {
    // exchangerate.host returns rates relative to USD
    const r = await fetch(`https://api.exchangerate.host/latest?base=USD&symbols=${PAIRS.join(',')}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.rates || null;
  } catch { return null; }
}

export default async function handler() {
  let rates = await tryFrankfurterV1();
  if (!rates) rates = await tryFrankfurter('api.frankfurter.app');
  if (!rates) rates = await tryExchangeHost();
  if (!rates) {
    return new Response(JSON.stringify({ ok: false, error: 'all FX upstreams failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ ok: true, base: 'USD', rates, at: Date.now() }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
