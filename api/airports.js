/**
 * /api/airports — server-side OpenAIP airports proxy.
 *
 * Spatial filter is pos+dist (no bbox). Returns airports + their runways +
 * frequencies + elevation + ICAO/IATA codes.
 *
 * Airport type codes (OpenAIP v1.1):
 *   0 Airfield Civil · 1 Glider Site · 2 Light Aircraft / ULM ·
 *   3 International Airport · 4 Heliport Military · 5 Military Aerodrome ·
 *   6 Ultra-light flying field · 7 Heliport Civil · 8 Aerodrome Closed ·
 *   9 IFR Airport · 10 Landing Strip · 11 Agricultural Landing Strip ·
 *   12 Altiport · 13 Water Airport
 *
 * Default request pulls 3 (International), 4 (Heliport Mil), 5 (Mil Aerodrome),
 * 9 (IFR) — the militarily / commercially relevant ones.
 */

export const config = { runtime: 'edge' };

const FIELDS = 'name,icaoCode,iataCode,type,geometry,elevation,runways,frequencies,country';
const MAX_PAGES = 6;

const json = (status, payload, maxAgeSec = 0) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': maxAgeSec
      ? `public, s-maxage=${maxAgeSec}, stale-while-revalidate=${maxAgeSec * 4}`
      : 'no-store',
  },
});

export default async function handler(request) {
  const key = process.env.OPENAIP_API_KEY;
  if (!key) return json(503, { ok: false, error: 'OPENAIP_API_KEY not set' });

  const u = new URL(request.url);
  const pos  = u.searchParams.get('pos')  || '27,55';
  const dist = u.searchParams.get('dist') || '2400000';
  const types = u.searchParams.get('types') || '3,4,5,9';
  const limit = u.searchParams.get('limit') || '1000';

  const buildUrl = (page) => {
    const p = new URLSearchParams();
    p.set('pos', pos);
    p.set('dist', dist);
    p.set('limit', limit);
    p.set('page', String(page));
    p.set('fields', FIELDS);
    types.split(',').forEach((t) => p.append('type', t.trim()));
    return `https://api.core.openaip.net/api/airports?${p.toString()}`;
  };

  try {
    const collected = [];
    let page = 1, totalPages = 1;
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
    return json(200, { ok: true, pos, dist: Number(dist), count: collected.length, items: collected }, 86_400);
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}
