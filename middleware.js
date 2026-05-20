/**
 * Vercel Edge Middleware — server-side password gate.
 * Runs on every request. Validates a SHA-256 hash of the passphrase
 * stored in an HttpOnly cookie. Free on Vercel Hobby plan.
 */

export const config = {
  // /api/cron/* is hit by Vercel Pro cron with its own Bearer secret, not
  // a user session — skip the password gate for those paths.
  matcher: '/((?!_vercel|_next|favicon\\.ico|robots\\.txt|api/cron).*)',
};

/* Hash sourced from Vercel env var SHIFT_PASSWORD_HASH (set via dashboard
 * or `vercel env add`). The fallback is the kill-bell1@ hash
 * to keep the gate working even if the env var is missing. */
const HASH = (typeof process !== 'undefined' && process.env && process.env.SHIFT_PASSWORD_HASH) ||
             '8b761177bd23775372562cdde2e0486fcad0d0238b6820f2a6c40b27756d42e8';
const COOKIE = 'shift_auth';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(/;\s*/).forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i)] = p.slice(i + 1);
  });
  return out;
}

const GATE = (msg = '') => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SHIFT 2.0 // RESTRICTED</title>
<style>
  :root { --amber:#ffaa00; --green:#00e676; --red:#ff3344; --bg:#000; --bg2:#0e0e0e; --border:#2a2a2a; --dim:#aaa; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#000; color:var(--amber); font-family:'JetBrains Mono','IBM Plex Mono','Menlo',monospace; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; overflow:hidden; }
  body::before { content:''; position:fixed; inset:0; background:repeating-linear-gradient(0deg,transparent 0 39px,rgba(255,170,0,0.025) 39px 40px), repeating-linear-gradient(90deg,transparent 0 39px,rgba(255,170,0,0.025) 39px 40px); pointer-events:none; }
  .gate { width:100%; max-width:420px; border:1px solid var(--amber); background:var(--bg2); position:relative; padding:0; box-shadow:0 0 40px rgba(255,170,0,.18), 0 0 4px rgba(255,170,0,.35); }
  .gate::before,.gate::after,.gate .c1,.gate .c2 { content:''; position:absolute; width:12px; height:12px; border:2px solid var(--amber); }
  .gate::before { top:-1px; left:-1px; border-right:none; border-bottom:none; }
  .gate::after  { top:-1px; right:-1px; border-left:none; border-bottom:none; }
  .gate .c1     { bottom:-1px; left:-1px; border-right:none; border-top:none; }
  .gate .c2     { bottom:-1px; right:-1px; border-left:none; border-top:none; }
  h1 { color:var(--amber); font-size:22px; letter-spacing:3px; font-weight:700; padding:18px 18px 4px; }
  .v { color:var(--dim); font-size:11px; padding:0 18px 14px; letter-spacing:0.6px; }
  .v b { color:var(--green); }
  .sub { background:var(--amber); color:#000; padding:6px 18px; font-size:10px; font-weight:700; letter-spacing:1.5px; }
  form { padding:18px; display:flex; flex-direction:column; gap:10px; }
  label { color:var(--dim); font-size:10px; letter-spacing:1px; font-weight:700; }
  input[type=password] { background:#000; color:#fff; border:1px solid var(--border); font-family:inherit; font-size:14px; padding:9px 11px; letter-spacing:2px; outline:none; }
  input[type=password]:focus { border-color:var(--amber); box-shadow:0 0 0 1px rgba(255,170,0,.4); }
  button { background:var(--amber); color:#000; border:none; font-family:inherit; font-size:11px; font-weight:700; letter-spacing:1.5px; padding:10px 14px; cursor:pointer; }
  button:hover { background:var(--green); }
  .err { color:var(--red); font-size:11px; padding:0 18px; }
  .foot { color:#666; font-size:9px; padding:10px 18px 14px; border-top:1px solid var(--border); letter-spacing:0.4px; }
  .foot b { color:var(--amber); }
</style>
</head><body>
  <main class="gate">
    <span class="c1"></span><span class="c2"></span>
    <h1>▮ SHIFT 2.0</h1>
    <div class="v">REGIONAL INTEL TERMINAL · <b>RESTRICTED</b></div>
    <div class="sub">// AUTHENTICATION REQUIRED</div>
    <form method="POST" action="/auth" autocomplete="off">
      <label for="pw">PASSPHRASE</label>
      <input id="pw" type="password" name="pw" autocomplete="current-password" autofocus required />
      ${msg ? `<div class="err">▸ ${msg}</div>` : ''}
      <button type="submit">AUTHORIZE ▸</button>
    </form>
    <div class="foot">▮ session cookie · 30 day TTL · <b>SHA-256</b> hash check</div>
  </main>
</body></html>`;

export default async function middleware(request) {
  const url = new URL(request.url);

  // Auth submission
  if (url.pathname === '/auth' && request.method === 'POST') {
    let pw = '';
    try {
      const form = await request.formData();
      pw = String(form.get('pw') || '');
    } catch {}
    if (!pw) {
      return new Response(GATE('Empty passphrase.'), {
        status: 400, headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    const hash = await sha256Hex(pw);
    if (hash === HASH) {
      const h = new Headers();
      h.set('Location', '/');
      h.append('Set-Cookie', `${COOKIE}=${hash}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
      return new Response('', { status: 303, headers: h });
    }
    return new Response(GATE('ACCESS DENIED · INVALID PASSPHRASE.'), {
      status: 401, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // Check cookie
  const cookies = parseCookies(request.headers.get('cookie'));
  if (cookies[COOKIE] === HASH) return; // authorized — pass through

  // Unauthorized — show gate
  return new Response(GATE(), {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
