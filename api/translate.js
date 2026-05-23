/**
 * /api/translate — Microsoft Translator proxy
 *
 * POST { texts: string[], to?: 'ar' (default), from?: 'en' (optional) }
 * → { translations: string[] }   // 1:1 with input array
 *
 * Required env vars (set via `vercel env add`):
 *   MS_TRANSLATOR_KEY     — Azure resource key
 *   MS_TRANSLATOR_REGION  — Azure region, e.g. "uaenorth", "global"
 *
 * Edge runtime so cold starts stay cheap. We batch up to 100 strings per call
 * (Microsoft's hard limit) and cap each string at 50k chars (their other limit).
 * Caller is expected to batch sensibly — we don't auto-shard.
 */
export const config = { runtime: 'edge' };

const MAX_BATCH = 100;
const MAX_CHARS = 50_000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Allow same-origin XHR; everything else is firewalled by Vercel anyway.
      'cache-control': 'no-store',
    },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const key = process.env.MS_TRANSLATOR_KEY;
  const region = process.env.MS_TRANSLATOR_REGION;
  if (!key || !region) {
    return json(503, {
      ok: false,
      error: 'MS_TRANSLATOR_KEY / MS_TRANSLATOR_REGION not set on server',
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid JSON body' });
  }

  const texts = Array.isArray(body?.texts) ? body.texts : null;
  if (!texts || !texts.length) return json(400, { ok: false, error: 'texts[] required' });
  if (texts.length > MAX_BATCH) {
    return json(400, { ok: false, error: `max ${MAX_BATCH} strings per call` });
  }
  for (const t of texts) {
    if (typeof t !== 'string') return json(400, { ok: false, error: 'all entries must be strings' });
    if (t.length > MAX_CHARS) return json(400, { ok: false, error: `string exceeds ${MAX_CHARS} chars` });
  }

  const to = encodeURIComponent(body?.to || 'ar');
  const from = body?.from ? `&from=${encodeURIComponent(body.from)}` : '';
  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${to}${from}`;

  const payload = texts.map((t) => ({ Text: t }));

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Ocp-Apim-Subscription-Region': region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json(502, { ok: false, error: 'upstream fetch failed: ' + (e?.message || e) });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return json(upstream.status, {
      ok: false,
      error: `Microsoft Translator returned ${upstream.status}`,
      detail: text.slice(0, 500),
    });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return json(502, { ok: false, error: 'upstream returned non-JSON' });
  }

  // Microsoft returns: [{ translations: [{ text, to }] }, ...] in input order.
  const translations = (data || []).map((row) => row?.translations?.[0]?.text || '');
  return json(200, { ok: true, translations });
}
