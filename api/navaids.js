/**
 * /api/navaids — server-side OpenAIP navaids proxy.
 *
 * Returns VOR / DME / TACAN / NDB points — the navigation spine of regional
 * airways. Useful overlay for understanding why aircraft fly the tracks
 * they do across the Gulf.
 *
 * Type codes (OpenAIP v1.1):
 *   0 DME · 1 TACAN · 2 NDB · 3 VOR · 4 VOR-DME · 5 VORTAC ·
 *   6 DVOR · 7 DVOR-DME · 8 DVORTAC
 *
 * Default request: 1, 3, 4, 5 (TACAN + VOR family — military + civil
 * primary nav). Skipping NDB (legacy, dense) and DME alone (paired with VOR).
 */

export const config = { runtime: 'edge' };

const FIELDS = 'name,identifier,type,geometry,frequency,channel,elevation,country';
const MAX_PAGES = 5;

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
  const types = u.searchParams.get('types') || '1,3,4,5';
  const limit = u.searchParams.get('limit') || '1000';

  const buildUrl = (page) => {
    const p = new URLSearchParams();
    p.set('pos', pos);
    p.set('dist', dist);
    p.set('limit', limit);
    p.set('page', String(page));
    p.set('fields', FIELDS);
    types.split(',').forEach((t) => p.append('type', t.trim()));
    return `https://api.core.openaip.net/api/navaids?${p.toString()}`;
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
