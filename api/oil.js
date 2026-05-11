/**
 * /api/oil — Vercel Edge Function.
 * Server-side proxy to OilPriceAPI (https://oilpriceapi.com).
 * The API key never leaves the server. Response is cached at the edge for
 * 15 minutes to stay well under the free-tier 300 req/month limit.
 *
 * Required env var: OILPRICE_API_KEY  (set via `vercel env add` or dashboard)
 */

export const config = { runtime: 'edge' };

const CODES = [
  { code: 'BRENT_CRUDE_USD', label: 'BRENT',  unit: '$', localKey: 'b.f'  },
  { code: 'WTI_USD',         label: 'WTI',    unit: '$', localKey: 'cl.f' },
  { code: 'NATURAL_GAS_USD', label: 'NATGAS', unit: '$', localKey: 'ng.f' },
];

export default async function handler(request) {
  const key = process.env.OILPRICE_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'OILPRICE_API_KEY not set on server. Set it via `vercel env add OILPRICE_API_KEY production`.',
    }), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  try {
    const fetches = CODES.map(async (c) => {
      const r = await fetch(
        `https://api.oilpriceapi.com/v1/prices/latest?by_code=${c.code}`,
        {
          headers: {
            'Authorization': `Token ${key}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!r.ok) return { ...c, error: `HTTP ${r.status}` };
      const j = await r.json();
      const d = j?.data || null;
      return {
        ...c,
        price: d?.price != null ? Number(d.price) : null,
        formatted: d?.formatted || null,
        created_at: d?.created_at || null,
      };
    });

    const results = await Promise.all(fetches);

    return new Response(JSON.stringify({
      ok: true,
      results,
      at: Date.now(),
      source: 'oilpriceapi.com',
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Edge cache: 15 min fresh, 30 min stale-while-revalidate.
        // 4 cache fills/hour max per region, ≈100/day worst case.
        'cache-control': 'public, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(e?.message || e),
    }), {
      status: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }
}
