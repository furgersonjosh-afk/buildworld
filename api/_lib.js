// Shared helpers for the Build World AI proxy.
// Keys stay on the server. Never import this file from the client.

const ALLOWED_ORIGINS = [
  "https://furgersonjosh-afk.github.io",
  "https://build-world.vercel.app",
  "https://jax-buildworld-ai.vercel.app",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:8780",
  "http://127.0.0.1:8780"
];

// Default: Seedream 5.0 Pro ($0.035 / image) — works on AI Gateway free tier and is strong on detailed vehicles.
// Fallback: Grok Imagine ($0.02). FLUX 3 / Nano Banana 2.1 need paid Gateway credits. Override with IMAGE_MODEL / IMAGE_MODEL_FALLBACK.
const DEFAULT_IMAGE_MODEL = "bytedance/seedream-5.0-pro";
const DEFAULT_IMAGE_FALLBACK = "spacexai/grok-imagine-image";

function imageDailyCap(){
  const n = parseInt(process.env.IMAGE_DAILY_CAP || "8", 10);
  return (Number.isFinite(n) && n > 0) ? n : 8;
}
function photoDailyCap(){
  const n = parseInt(process.env.PHOTO_DAILY_CAP || "20", 10);
  return (Number.isFinite(n) && n > 0) ? n : 20;
}

function credentials(){
  const imageModel = process.env.IMAGE_MODEL || process.env.AI_IMAGE_MODEL;
  const imageFallback = process.env.IMAGE_MODEL_FALLBACK || DEFAULT_IMAGE_FALLBACK;
  if(process.env.AI_GATEWAY_API_KEY){
    return {
      kind: "gateway",
      key: process.env.AI_GATEWAY_API_KEY,
      base: "https://ai-gateway.vercel.sh/v1",
      textModel: process.env.AI_TEXT_MODEL || "openai/gpt-5-nano",
      imageModel: imageModel || DEFAULT_IMAGE_MODEL,
      imageFallback
    };
  }
  if(process.env.OPENAI_API_KEY){
    return {
      kind: "openai",
      key: process.env.OPENAI_API_KEY,
      base: "https://api.openai.com/v1",
      textModel: process.env.AI_TEXT_MODEL || "gpt-5-nano",
      imageModel: imageModel || "gpt-image-1-mini",
      imageFallback: process.env.IMAGE_MODEL_FALLBACK || "gpt-image-1-mini"
    };
  }
  if(process.env.XAI_API_KEY){
    return {
      kind: "xai",
      key: process.env.XAI_API_KEY,
      base: "https://api.x.ai/v1",
      textModel: process.env.AI_TEXT_MODEL || "grok-4-fast",
      imageModel: imageModel || "grok-imagine-image",
      imageFallback: process.env.IMAGE_MODEL_FALLBACK || "grok-imagine-image"
    };
  }
  return null;
}

function corsHeaders(req){
  const origin = String((req.headers && (req.headers.origin || req.headers.Origin)) || "");
  const allowOwn = /^https:\/\/jax-buildworld-ai([.-][a-z0-9-]+)*\.vercel\.app$/.test(origin);
  const allow = ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o)) || allowOwn || (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    ? (origin || ALLOWED_ORIGINS[0])
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function send(res, status, body, req, extraHeaders){
  const headers = Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(req), extraHeaders || {});
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
- If he asks you to draw or render a picture, say you will make a fun kid-safe picture (the app handles the image).
- Homework photos: when Jax sends a picture of schoolwork, read the problem carefully. Explain what kind of problem it is in simple words. Help step by step with hints. Do not give the final answer immediately. Ask Jax to try each step and type his answer in his own words (this also helps his spelling and English). After he tries, check his work and be encouraging. If he is wrong, give a hint and let him try again. Give the final answer only after he has tried, or if he clearly asks you to tell him the answer. If the photo is not homework, stay kid-safe and do not treat it as homework. Never ask to keep or re-upload the photo — you only see it for this chat.`;

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

const BRAND_RE = /\b(ford|chevrolet|chevy|gmc|dodge|toyota|honda|nissan|bmw|mercedes(?:-benz)?|ferrari|lamborghini|porsche|jeep|tesla|hyundai|kia|subaru|volkswagen|vw|audi|lexus|cadillac|buick|chrysler|lincoln|mazda|mitsubishi|volvo|jaguar|land rover|range rover|mini cooper|mustang|camaro|corvette|f-?150|raptor|bronco|wrangler|hummer|cybertruck|monster energy|hot wheels|matchbox)\b/gi;

function stripRealBrands(text){
  return String(text || "").replace(BRAND_RE, "custom");
}

function chicagoDay(){
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function kidSafeImagePrompt(userText){
  const cleaned = stripRealBrands(String(userText || ""))
    .replace(/^(please\s+)?((can you|could you|will you)\s+)?(draw|render|paint|sketch|generate|make|create)(\s+me)?(\s+a|\s+an|\s+the)?\s*/i, "")
    .replace(/\b(picture|image|drawing|painting|illustration)\s+(of|with)?\s*/i, "")
    .slice(0, 400)
    .trim();
  const scene = cleaned || "a giant custom monster truck kicking up dirt on a sunny track";
  return [
    "Create a vivid, highly detailed, colorful, high-quality image of the scene below.",
    "Use sharp focus, dramatic cinematic lighting, rich textures, and intricate mechanical detail for any vehicles (tires, suspension, body panels, chrome, mud, reflections).",
    "Style: high-quality digital art or a realistic cinematic render, whichever best fits the scene. Not a simple cartoon or clip-art.",
    "Child-friendly and suitable for an 11-year-old: cheerful, non-violent, no gore, no blood, no sexual content, no realistic depictions of real people.",
    "No text, no captions, no watermark, no brand logos, and no real brand names or trademarks.",
    "Scene: " + scene
  ].join(" ");
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

function usesChatImage(model){
  return /gemini|nano-banana/i.test(String(model || ""));
}

function extractImage(data){
  if(!data) return null;
  const from = (obj)=>{
    if(!obj) return null;
    if(obj.b64_json || obj.b64) return { image: "data:image/png;base64," + (obj.b64_json || obj.b64) };
    if(obj.url) return { image: obj.url };
    if(obj.image_url && obj.image_url.url) return { image: obj.image_url.url };
    if(typeof obj.image_url === "string" && obj.image_url.indexOf("data:") === 0) return { image: obj.image_url };
    return null;
  };
  const d0 = (data.data && data.data[0]) || null;
  let hit = from(d0);
  if(hit) return hit;
  const imgs = data.images || ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.images) || []);
  if(imgs && imgs[0]){ hit = from(imgs[0]); if(hit) return hit; }
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if(Array.isArray(content)){
    for(const part of content){
      hit = from(part) || (part && part.type === "image_url" ? from(part) : null);
      if(hit) return hit;
      if(part && part.inline_data && part.inline_data.data){
        const mime = part.inline_data.mime_type || "image/png";
        return { image: "data:" + mime + ";base64," + part.inline_data.data };
      }
    }
  }
  return null;
}

async function generateImage({ key, base, kind, model, prompt }){
  if(usesChatImage(model)){
    const data = await postJson(base + "/chat/completions", key, {
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["text", "image"]
    });
    const hit = extractImage(data);
    if(!hit) throw Object.assign(new Error("no image in chat response"), { status: 502, data });
    return hit;
  }
  const payload = {
    model,
    prompt,
    n: 1,
    size: "1024x1024",
    response_format: "b64_json"
  };
  if(kind === "gateway" && /^bfl\//.test(model)){
    payload.providerOptions = { blackForestLabs: { safetyTolerance: 1, outputFormat: "jpeg", resolution: "1k" } };
  }
  const data = await postJson(base + "/images/generations", key, payload);
  const hit = extractImage(data);
  if(!hit) throw Object.assign(new Error("no image in response"), { status: 502, data });
  // Prefer jpeg data URLs when we asked for jpeg
  if(hit.image && hit.image.indexOf("data:image/png;") === 0 && payload.providerOptions){
    hit.image = hit.image.replace("data:image/png;", "data:image/jpeg;");
  }
  return hit;
}

function readCookie(req, name){
  const raw = String((req.headers && (req.headers.cookie || req.headers.Cookie)) || "");
  const parts = raw.split(/;\s*/);
  for(const p of parts){
    const i = p.indexOf("=");
    if(i > 0 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1));
  }
  return "";
}

function parseCountCookie(req, name){
  const raw = readCookie(req, name);
  const day = chicagoDay();
  const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(raw);
  if(m && m[1] === day) return { day, count: parseInt(m[2], 10) || 0 };
  return { day, count: 0 };
}
function countCookieHeader(req, name, count){
  const origin = String((req.headers && (req.headers.origin || req.headers.Origin)) || "");
  const https = origin.startsWith("https://") || (req.headers && (req.headers["x-forwarded-proto"] === "https"));
  const attrs = https
    ? "; Path=/; Max-Age=172800; HttpOnly; SameSite=None; Secure"
    : "; Path=/; Max-Age=172800; HttpOnly; SameSite=Lax";
  return name + "=" + encodeURIComponent(chicagoDay() + "." + count) + attrs;
}
function parsePicCookie(req){ return parseCountCookie(req, "bw_img_cap"); }
function picCookieHeader(req, count){ return countCookieHeader(req, "bw_img_cap", count); }
function parsePhotoCookie(req){ return parseCountCookie(req, "bw_photo_cap"); }
function photoCookieHeader(req, count){ return countCookieHeader(req, "bw_photo_cap", count); }

module.exports = {
  credentials, corsHeaders, send, readJson,
  SYSTEM_PROMPT, isUnsafeText, looksLikeDraw, kidSafeImagePrompt, postJson,
  imageDailyCap, photoDailyCap, generateImage, usesChatImage, chicagoDay,
  parsePicCookie, picCookieHeader, parsePhotoCookie, photoCookieHeader,
  DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_FALLBACK
};
