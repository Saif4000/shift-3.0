/**
 * /api/aircraft — server-side aircraft proxy.
 *
 * OpenSky was either:
 *   - returning "Too Many Requests" through every CORS proxy, or
 *   - unreachable from Vercel's edge IPs directly.
 *
 * Switched to airplanes.live (community ADS-B feed, no key, supports
 * point+radius queries). Same OpenSky-shape state vector returned so the
 * client-side renderer doesn't need to change.
 */

export const config = { runtime: 'edge' };

const PRESETS = {
  uae:    { lat: 24.5, lon: 54.4, radius: 300 },
  hormuz: { lat: 26.6, lon: 56.3, radius: 200 },
  mena:   { lat: 27.0, lon: 42.0, radius: 1200 },
  redsea: { lat: 20.0, lon: 38.0, radius: 600 },
  med:    { lat: 37.0, lon: 18.0, radius: 1000 },
  global: { lat: 25.0, lon: 30.0, radius: 1500 },
};

const json = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, s-maxage=20, stale-while-revalidate=60' : 'no-store',
    },
  });

/* Convert airplanes.live's record shape into OpenSky's state-vector array so
 * the client-side renderer keeps working without changes:
 *   [icao24, callsign, origin_country, time_pos, last_contact, lon, lat,
 *    baro_alt(m), on_ground, velocity(m/s), true_track, vert_rate(m/s)]
 */
function toOpenSkyVector(a) {
  if (a.lat == null || a.lon == null) return null;
  const altFt = a.alt_baro === 'ground' ? 0 : (a.alt_baro ?? a.alt_geom);
  const altM = typeof altFt === 'number' ? altFt * 0.3048 : null;
  const velKt = a.gs ?? a.tas ?? a.ias;
  const velMs = typeof velKt === 'number' ? velKt * 0.514444 : null;
  const vrFpm = a.baro_rate ?? a.geom_rate;
  const vrMs  = typeof vrFpm === 'number' ? vrFpm * 0.00508 : null;
  return [
    a.hex || '',
    (a.flight || '').trim(),
    a.r || a.t || '',
    null,
    null,
    a.lon,
    a.lat,
    altM,
    a.alt_baro === 'ground',
    velMs,
    a.track ?? a.true_heading ?? 0,
    vrMs,
  ];
}

export default async function handler(request) {
  let preset = 'uae';
  try { preset = new URL(request.url).searchParams.get('preset') || 'uae'; } catch {}
  const p = PRESETS[preset] || PRESETS.uae;
  const url = `https://api.airplanes.live/v2/point/${p.lat}/${p.lon}/${p.radius}`;

  try {
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'shift-2.0 (edge)',
      },
      cache: 'no-store',
    });
    if (!r.ok) {
      return json(200, { ok: false, error: 'airplanes.live HTTP ' + r.status, preset });
    }
    const j = await r.json();
    const list = j?.ac || [];
    const states = list.map(toOpenSkyVector).filter(Boolean);
    return json(200, {
      ok: true,
      preset,
      center: { lat: p.lat, lon: p.lon, radius_nm: p.radius },
      source: 'airplanes.live',
      time: Math.floor(Date.now() / 1000),
      states,
    });
  } catch (e) {
    return json(200, {
      ok: false,
      error: String(e?.message || e),
      preset,
    });
  }
}
