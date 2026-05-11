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
  // Widened — at 300nm we were typically returning only 4-5 airborne aircraft
  // for the Gulf. 500nm covers GCC + southern Iran + most of Arabian Sea.
  uae:    { lat: 24.5, lon: 54.4, radius: 500 },
  hormuz: { lat: 26.6, lon: 56.3, radius: 300 },
  mena:   { lat: 27.0, lon: 42.0, radius: 1200 },
  redsea: { lat: 20.0, lon: 38.0, radius: 600 },
  med:    { lat: 37.0, lon: 18.0, radius: 1000 },
  global: { lat: 25.0, lon: 30.0, radius: 1500 },
};

/* maxAgeSec controls the edge cache. Community ADS-B feeds are free so we
 * keep them tight (20s). AirLabs free tier is 1000 calls/month total, so the
 * AirLabs path gets a 10-minute cache — worst case ~144 upstream/day. */
const json = (status, payload, maxAgeSec = 20) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200
        ? `public, s-maxage=${maxAgeSec}, stale-while-revalidate=${maxAgeSec * 3}`
        : 'no-store',
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

  // Try AirLabs first IF an API key is configured — commercial coverage,
  // bbox-native (one call returns the whole Gulf). 1000 calls/month free.
  const airlabsKey = process.env.AIRLABS_API_KEY;
  if (airlabsKey) {
    try {
      // Convert radius to a bbox: rough degrees per nm
      const dLat = p.radius / 60; // 60 nm per latitude degree
      const dLon = p.radius / (60 * Math.cos((p.lat * Math.PI) / 180));
      const bbox = `${(p.lat - dLat).toFixed(2)},${(p.lon - dLon).toFixed(2)},${(p.lat + dLat).toFixed(2)},${(p.lon + dLon).toFixed(2)}`;
      const r = await fetch(
        `https://airlabs.co/api/v9/flights?api_key=${encodeURIComponent(airlabsKey)}&bbox=${bbox}`,
        { headers: { 'Accept': 'application/json' }, cache: 'no-store' }
      );
      if (r.ok) {
        const j = await r.json();
        const arr = j?.response || [];
        if (Array.isArray(arr) && arr.length) {
          const states = arr.map(airlabsToOpenSky).filter(Boolean);
          // 10-minute edge cache for AirLabs to stay under the 1000/month
          // free quota (worst case ~144 upstream calls/day).
          return json(200, {
            ok: true, preset,
            center: { lat: p.lat, lon: p.lon, radius_nm: p.radius },
            source: 'airlabs',
            airborne: states.filter((s) => !s[8]).length,
            time: Math.floor(Date.now() / 1000),
            states,
          }, 600);
        }
      }
    } catch (e) { /* fall through */ }
  }

  // Community ADS-B feeders — tried in order. ADSB One is a separate
  // feeder pool from adsb.lol so often has different coverage.
  const endpoints = [
    { url: `https://api.adsb.one/v2/point/${p.lat}/${p.lon}/${p.radius}`,     name: 'adsb.one' },
    { url: `https://api.adsb.lol/v2/point/${p.lat}/${p.lon}/${p.radius}`,     name: 'adsb.lol' },
    { url: `https://opendata.adsb.fi/api/v3/lat/${p.lat}/lon/${p.lon}/dist/${p.radius}`, name: 'adsb.fi' },
    { url: `https://api.airplanes.live/v2/point/${p.lat}/${p.lon}/${p.radius}`, name: 'airplanes.live' },
  ];

  let lastErr = null, best = null;
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep.url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'flight-map/1.0 (contact@shift-2-0.vercel.app)',
        },
        cache: 'no-store',
      });
      if (!r.ok) { lastErr = `${ep.name} HTTP ${r.status}`; continue; }
      const j = await r.json();
      const list = j?.ac || j?.aircraft || [];
      if (!Array.isArray(list)) { lastErr = `${ep.name}: unexpected shape`; continue; }
      const states = list.map(toOpenSkyVector).filter(Boolean);
      const airborne = states.filter((s) => !s[8]).length;
      // Keep the source with the most airborne tracks — feeder pools vary
      if (!best || airborne > best.airborne) {
        best = { name: ep.name, states, airborne };
      }
      // If we have >40 airborne, that's enough — return early
      if (airborne >= 40) break;
    } catch (e) {
      lastErr = `${ep.name}: ${e?.message || e}`;
    }
  }
  if (best) {
    return json(200, {
      ok: true,
      preset,
      center: { lat: p.lat, lon: p.lon, radius_nm: p.radius },
      source: best.name,
      airborne: best.airborne,
      time: Math.floor(Date.now() / 1000),
      states: best.states,
    });
  }
  return json(200, { ok: false, error: 'all ADS-B feeds failed', detail: lastErr, preset });
}

/* AirLabs response → OpenSky-shape state vector
 *   { hex, flight_number, flag, lat, lng, alt(m), speed(kt), v_speed(m/s),
 *     dir, status } */
function airlabsToOpenSky(a) {
  if (a.lat == null || a.lng == null) return null;
  const onGround = a.status === 'ground' || a.alt === 0;
  return [
    a.hex || '',
    (a.flight_number || a.flight_iata || '').trim(),
    a.flag || '',
    null, null,
    a.lng, a.lat,
    typeof a.alt === 'number' ? a.alt : null,
    onGround,
    typeof a.speed === 'number' ? a.speed * 0.514444 : null,
    a.dir ?? 0,
    typeof a.v_speed === 'number' ? a.v_speed : null,
  ];
}
