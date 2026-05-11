/**
 * /api/aircraft — server-side OpenSky proxy.
 * Browser-side anonymous OpenSky was burning the 400-credit/day daily budget
 * on rate-limit reasons and returning empty. Server-side bypasses that:
 *   - Same IP for all visitors (shared edge cache 30s) → far fewer upstream calls
 *   - If OPENSKY_USER and OPENSKY_PASS are set in Vercel env, we authenticate
 *     for the higher 4000-credit/day quota; otherwise anonymous.
 *
 * Query: ?preset=uae|hormuz|mena|redsea|med|global  (default uae)
 */

export const config = { runtime: 'edge' };

const PRESETS = {
  uae:    { lamin: 20, lamax: 28, lomin: 49, lomax: 60 },
  hormuz: { lamin: 22, lamax: 30, lomin: 50, lomax: 62 },
  mena:   { lamin: 10, lamax: 45, lomin: 20, lomax: 70 },
  redsea: { lamin: 10, lamax: 30, lomin: 30, lomax: 46 },
  med:    { lamin: 30, lamax: 45, lomin: -5, lomax: 36 },
  global: { lamin: -10, lamax: 60, lomin: -20, lomax: 90 },
};

export default async function handler(request) {
  const url = new URL(request.url);
  const preset = url.searchParams.get('preset') || 'uae';
  const bbox = PRESETS[preset] || PRESETS.uae;

  const user = process.env.OPENSKY_USER;
  const pass = process.env.OPENSKY_PASS;
  const headers = { 'User-Agent': 'shift-2.0 (edge)' };
  if (user && pass) {
    headers['Authorization'] = 'Basic ' + btoa(`${user}:${pass}`);
  }

  try {
    const r = await fetch(
      `https://opensky-network.org/api/states/all?lamin=${bbox.lamin}&lamax=${bbox.lamax}&lomin=${bbox.lomin}&lomax=${bbox.lomax}`,
      { headers, cache: 'no-store' }
    );
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'OpenSky HTTP ' + r.status, authed: !!user }), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    const j = await r.json();
    return new Response(JSON.stringify({
      ok: true,
      authed: !!user,
      preset,
      bbox,
      time: j.time,
      states: j.states || [],
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Short edge cache so multiple visitors don't all spend OpenSky credits
        'cache-control': 'public, s-maxage=30, stale-while-revalidate=120',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
