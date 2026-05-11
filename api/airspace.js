/**
 * /api/airspace — server-side OpenAIP proxy.
 *
 * CRITICAL: OpenAIP Core API v1 does NOT support a bbox parameter.
 * Spatial filter is `pos=lat,lon&dist=meters` (centred radius).
 * Default Gulf preset: pos=27,55, dist=2,400,000m (≈ 2400km — covers
 * 12°-42°N, 40°-70°E from its centre).
 *
 * Paginates through all `nextPage` results so we get the full set, not
 * just page 1. Requests sparse `fields=` to cut payload ~40%.
 *
 * Auth: x-openaip-api-key header (env var OPENAIP_API_KEY).
 *
 * Query params:
 *   ?pos=lat,lon          (default '27,55')
 *   ?dist=meters          (default 2400000)
 *   ?types=10,12,26,...   (comma-separated airspace type codes)
 *   ?limit=1000           (per-page; total is unlimited via pagination)
 *
 * Airspace type codes (official v1.1 enum, NOT what was previously commented):
 *   0 Other · 1 Restricted · 2 Danger · 3 Prohibited · 4 CTR · 5 TMZ ·
 *   6 RMZ · 7 TMA · 8 TRA · 9 TSA · 10 FIR · 11 UIR · 12 ADIZ · 13 ATZ ·
 *   14 MATZ · 15 Airway · 16 MTR · 17 Alert · 18 Warning ·
 *   19 Protected Area · 20 HTZ · 21 Gliding · 22 TRP · 23 TIZ · 24 TIA ·
 *   25 MTA · 26 CTA · 27 ACC Sector · 28 Aerial Sport · 29 Low-Alt Restr ·
 *   30 MRT · 31 TSA/TRA Feed · 32 VFR Sector · 33 FIS Sector ·
 *   34 LTA · 35 UTA · 36 MCTR
 */

export const config = { runtime: 'edge' };

const FIELDS = 'name,type,icaoClass,activity,geometry,upperLimit,lowerLimit,hoursOfOperation,onDemand,byNotam,country,onRequest,specialAgreement';
const MAX_PAGES = 8; // hard cap to avoid runaway pagination

const json = (status, payload, maxAgeSec = 0) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': maxAgeSec
      ? `public, s-maxage=${maxAgeSec}, stale-while-revalidate=${maxAgeSec * 4}`
      : 'no-store',
  },
});

/** If caller passes a legacy bbox=lonMin,latMin,lonMax,latMax, convert to
 *  pos=centroid + dist=diagonal/2 so OpenAIP gets a parameter it actually uses. */
function bboxToPosDist(bbox) {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  const [lonMin, latMin, lonMax, latMax] = parts;
  const cLat = (latMin + latMax) / 2;
  const cLon = (lonMin + lonMax) / 2;
  // Approx great-circle: 1° lat ≈ 111km, 1° lon ≈ 111·cos(lat) km
  const dLat = (latMax - latMin) * 111_000;
  const dLon = (lonMax - lonMin) * 111_000 * Math.cos((cLat * Math.PI) / 180);
  const diag = Math.sqrt(dLat * dLat + dLon * dLon);
  return { pos: `${cLat.toFixed(4)},${cLon.toFixed(4)}`, dist: Math.ceil(diag / 2) };
}

export default async function handler(request) {
  const key = process.env.OPENAIP_API_KEY;
  if (!key) return json(503, { ok: false, error: 'OPENAIP_API_KEY not set on server' });

  const u = new URL(request.url);
  let pos  = u.searchParams.get('pos');
  let dist = u.searchParams.get('dist');
  const bbox = u.searchParams.get('bbox');
  if ((!pos || !dist) && bbox) {
    const conv = bboxToPosDist(bbox);
    if (conv) { pos = conv.pos; dist = String(conv.dist); }
  }
  if (!pos)  pos  = '27,55';
  if (!dist) dist = '2400000';

  const types = u.searchParams.get('types') || '';
  const limit = u.searchParams.get('limit') || '1000';

  const buildUrl = (page) => {
    const p = new URLSearchParams();
    p.set('pos', pos);
    p.set('dist', dist);
    p.set('limit', limit);
    p.set('page', String(page));
    p.set('fields', FIELDS);
    if (types) types.split(',').forEach((t) => p.append('type', t.trim()));
    return `https://api.core.openaip.net/api/airspaces?${p.toString()}`;
  };

  try {
    const collected = [];
    let page = 1;
    let totalPages = 1;
    while (page <= Math.min(MAX_PAGES, totalPages)) {
      const r = await fetch(buildUrl(page), {
        headers: { 'x-openaip-api-key': key, 'Accept': 'application/json' },
        cache: 'no-store',
      });
      if (!r.ok) {
        if (page === 1) {
          const body = await r.text().catch(() => '');
          return json(502, { ok: false, error: `OpenAIP HTTP ${r.status}`, preview: body.slice(0, 300) });
        }
        break;
      }
      const j = await r.json();
      const items = j?.items || [];
      collected.push(...items);
      totalPages = j?.totalPages || 1;
      if (!j?.nextPage || items.length === 0) break;
      page++;
    }
    return json(200, {
      ok: true,
      pos, dist: Number(dist),
      count: collected.length,
      pages: page,
      items: collected,
    }, 86_400);
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}
