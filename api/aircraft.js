/**
 * /api/aircraft — server-side OpenSky proxy.
 * Minimal version while debugging the 500 error.
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

const json = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, s-maxage=30, stale-while-revalidate=120' : 'no-store',
    },
  });

export default async function handler(request) {
  let preset = 'uae';
  try {
    preset = new URL(request.url).searchParams.get('preset') || 'uae';
  } catch {}
  const bbox = PRESETS[preset] || PRESETS.uae;

  const url = `https://opensky-network.org/api/states/all?lamin=${bbox.lamin}&lamax=${bbox.lamax}&lomin=${bbox.lomin}&lomax=${bbox.lomax}`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      return json(200, { ok: false, error: 'OpenSky HTTP ' + r.status, preset });
    }
    const j = await r.json();
    return json(200, {
      ok: true,
      preset,
      bbox,
      time: j?.time || null,
      states: j?.states || [],
    });
  } catch (e) {
    return json(200, {
      ok: false,
      error: String(e?.message || e),
      stack: String(e?.stack || '').slice(0, 400),
      preset,
    });
  }
}
