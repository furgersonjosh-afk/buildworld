// Shared helpers for the Build World AI proxy.
// Keys stay on the server. Never import this file from the client.

const ALLOWED_ORIGINS = [
  "https://furgersonjosh-afk.github.io",
  "https://build-world.vercel.app",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:8780",
  "http://127.0.0.1:8780"
];

function credentials(){
  if(process.env.AI_GATEWAY_API_KEY){
    return {
      kind: "gateway",
      key: process.env.AI_GATEWAY_API_KEY,
      base: "https://ai-gateway.vercel.sh/v1",
      textModel: process.env.AI_TEXT_MODEL || "openai/gpt-5-nano",
      imageModel: process.env.AI_IMAGE_MODEL || "bfl/flux-3-image-klein"
    };
  }
  if(process.env.OPENAI_API_KEY){
    return {
      kind: "openai",
      key: process.env.OPENAI_API_KEY,
      base: "https://api.openai.com/v1",
      textModel: process.env.AI_TEXT_MODEL || "gpt-5-nano",
      imageModel: process.env.AI_IMAGE_MODEL || "gpt-image-1-mini"
    };
  }
  if(process.env.XAI_API_KEY){
    return {
      kind: "xai",
      key: process.env.XAI_API_KEY,
      base: "https://api.x.ai/v1",
      textModel: process.env.AI_TEXT_MODEL || "grok-4-fast",
      imageModel: process.env.AI_IMAGE_MODEL || "grok-imagine-image"
    };
  }
  return null;
}

function corsHeaders(req){
  const origin = String((req.headers && (req.headers.origin || req.headers.Origin)) || "");
  const allow = ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o))
    ? origin
    : (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function send(res, status, body, req){
  const headers = Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(req));
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readJson(req){
  return new Promise((resolve, reject)=>{
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", ()=>{
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      try{ resolve(JSON.parse(raw)); }
      catch(e){ reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}

const SYSTEM_PROMPT = `You are Jax's friendly helper inside his racing-and-building game, Build World.
Jax is 11 years old. Follow these rules every time:
- Be kind, upbeat, and clear. Use short sentences and simple words.
- Keep replies short: about 1-4 short sentences, unless he asks you to explain a math or spelling problem.
- Help with spelling, reading, and math when he asks. Show your work in easy steps for math.
- You may talk about the game: cars, trucks, racing, chapters, the car wash, building, and jobs.
- Never ask for or repeat personal information (full name, address, school, phone, email, passwords, or where he lives).
- If he mentions being hurt, scared, or unsafe in real life, tell him to talk to a parent or trusted adult right away, and keep the reply short and caring.
- Refuse anything sexual, romantic, violent-for-real, self-harm, weapons, crime, drugs, hate, or adult topics. If asked, say you can only chat about fun, school, and the game, and offer a safer idea.
- Do not pretend to be a real person or agree to meet anyone.
- Do not make medical, legal, or financial advice.
- If he asks you to draw or render a picture, say you will make a fun kid-safe picture (the app handles the image).`;

const UNSAFE_RE = /\b(porn|porno|xxx|nude|nudes|naked photo|sex tape|onlyfans|suicide|kill myself|self[- ]?harm|how to make a bomb|build a bomb|cocaine|heroin|fentanyl|child porn|csam)\b/i;

function isUnsafeText(text){
  return UNSAFE_RE.test(String(text || ""));
}

function looksLikeDraw(text){
  const t = String(text || "").toLowerCase();
  return /^(please\s+)?(draw|render|paint|sketch|generate|make|create)\b/.test(t.trim())
    || /\b(draw|render|paint|sketch)\s+(me|us|a|an|the|my)\b/.test(t)
    || /\b(picture|image|illustration)\s+of\b/.test(t)
    || /\bmake\s+(me\s+)?(a|an)\s+(picture|image|drawing|painting)\b/.test(t);
}

function kidSafeImagePrompt(userText){
  const cleaned = String(userText || "")
    .replace(/^(please\s+)?((can you|could you|will you)\s+)?(draw|render|paint|sketch|generate|make|create)(\s+me)?(\s+a|\s+an|\s+the)?\s*/i, "")
    .replace(/\b(picture|image|drawing|painting|illustration)\s+(of|with)?\s*/i, "")
    .slice(0, 400);
  return "Child-friendly colorful cartoon illustration, suitable for an 11-year-old, cheerful and non-violent, no gore, no sexual content, no realistic depictions of real people, no text watermark. Scene: " + (cleaned || "a fun off-road truck on a dirt track");
}

async function postJson(url, key, body){
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let data = null;
  try{ data = JSON.parse(text); }catch(e){ data = { raw: text.slice(0, 400) }; }
  if(!r.ok){
    const err = new Error("upstream " + r.status);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

module.exports = {
  credentials, corsHeaders, send, readJson,
  SYSTEM_PROMPT, isUnsafeText, looksLikeDraw, kidSafeImagePrompt, postJson
};
