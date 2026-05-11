/**
 * /api/airspace — server-side OpenAIP proxy.
 * Returns airspace polygons (FIR / CTA / CTR / TMA / RESTRICTED / DANGER /
 * PROHIBITED) for a bbox. The API key never reaches the browser.
 *
 * Required env: OPENAIP_API_KEY  (set via `vercel env add`)
 *
 * Usage:
 *   /api/airspace?bbox=40,20,70,40
 *     → all airspaces inside that bbox (lonMin,latMin,lonMax,latMax)
 *   /api/airspace?bbox=...&types=19,4,8
 *     → only FIR (19), CTR (4), TMA (8)
 *
 * OpenAIP airspace type codes (commonly seen):
 *   0 OTHER · 1 RESTRICTED · 2 DANGER · 3 PROHIBITED · 4 CTR · 5 TMZ ·
 *   6 RMZ · 8 TMA · 12 CTA · 13 SECTOR · 19 FIR / UIR
 */

export const config = { runtime: 'edge' };

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
  if (!key) {
    return json(503, { ok: false, error: 'OPENAIP_API_KEY not set on server' });
  }

  const u = new URL(request.url);
  const bbox = u.searchParams.get('bbox') || '40,20,70,40';
  const types = u.searchParams.get('types') || ''; // empty = all
  // OpenAIP supports paged results — pull up to 200 in one shot for our use
  const limit = u.searchParams.get('limit') || '200';

  const params = new URLSearchParams();
  params.set('bbox', bbox);
  params.set('limit', limit);
  if (types) {
    types.split(',').forEach((t) => params.append('type', t.trim()));
  }

  const url = `https://api.core.openaip.net/api/airspaces?${params.toString()}`;

  try {
    const r = await fetch(url, {
      headers: {
        'x-openaip-api-key': key,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return json(502, {
        ok: false,
        error: `OpenAIP HTTP ${r.status}`,
        preview: body.slice(0, 300),
      });
    }
    const j = await r.json();
    // Normalize: items might be in .items or .data depending on API version
    const items = j?.items || j?.data || [];
    return json(200, {
      ok: true,
      bbox,
      count: items.length,
      items,
    }, 86_400); // 24h cache — airspace boundaries change rarely
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}
