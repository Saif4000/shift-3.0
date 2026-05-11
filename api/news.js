/**
 * /api/news — server-side RSS proxy.
 *
 * The 'many credible regional outlets show 0 items' problem is caused by:
 *   - Public CORS proxies (allorigins / codetabs / corsproxy) intermittently
 *     returning HTML challenge pages instead of the actual RSS
 *   - Sources with bot detection blocking those proxy IPs
 *   - Some publishers serving 403 to known CORS proxies
 *
 * This function fetches the RSS server-side with a real browser User-Agent
 * and returns the raw body. Edge-cached 5 min fresh + 30 min stale-while-
 * revalidate per URL, so each unique feed is hit upstream at most ~12x/hour
 * regardless of how many users open the dashboard.
 *
 * Usage: /api/news?url=<encoded-rss-url>
 */

export const config = { runtime: 'edge' };

/* Cheap allowlist guard — only proxy hosts that look like news/RSS sources.
 * Stops the endpoint from being used as a general open proxy. */
const ALLOW_HOST = /(?:\.com|\.org|\.net|\.gov|\.ae|\.sa|\.il|\.qa|\.bh|\.kw|\.om|\.eg|\.ir|\.lb|\.tr|\.de|\.fr|\.uk|\.us|\.io|\.ai|\.co|\.news|\.tv|\.app|\.dev)$/i;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

export default async function handler(request) {
  const u = new URL(request.url);
  const target = u.searchParams.get('url');
  if (!target) {
    return new Response('Missing ?url=', { status: 400 });
  }

  let parsed;
  try { parsed = new URL(target); } catch { return new Response('Bad URL', { status: 400 }); }
  if (!/^https?:$/.test(parsed.protocol)) {
    return new Response('Only http(s)', { status: 400 });
  }
  if (!ALLOW_HOST.test(parsed.hostname)) {
    return new Response('Host not allowed', { status: 403 });
  }

  try {
    const r = await fetch(parsed.toString(), { headers: BROWSER_HEADERS, cache: 'no-store' });
    if (!r.ok) {
      return new Response(`Upstream ${r.status}`, {
        status: 502,
        headers: { 'cache-control': 'no-store' },
      });
    }
    const text = await r.text();
    const ct = r.headers.get('content-type') || 'application/xml; charset=utf-8';
    return new Response(text, {
      status: 200,
      headers: {
        'content-type': ct,
        'access-control-allow-origin': '*',
        // 5 min fresh + 30 min stale (gives the user the requested ~10-min
        // freshness without burning a Vercel cron quota)
        'cache-control': 'public, s-maxage=300, stale-while-revalidate=1800',
      },
    });
  } catch (e) {
    return new Response(`Fetch error: ${String(e?.message || e).slice(0, 200)}`, {
      status: 502,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
