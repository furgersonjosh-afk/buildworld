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

function envCap(name, fallback){
  const n = parseInt(process.env[name] || String(fallback), 10);
  return (Number.isFinite(n) && n > 0) ? n : fallback;
}
// High abuse backstops only — Jax can chat, draw, and send homework freely.
function imageDailyCap(){ return envCap("IMAGE_DAILY_CAP", 200); }
function photoDailyCap(){ return envCap("PHOTO_DAILY_CAP", 200); }
function messageDailyCap(){ return envCap("MESSAGE_DAILY_CAP", 500); }
function speakDailyCap(){ return envCap("SPEAK_DAILY_CAP", 300); }
function transcribeDailyCap(){ return envCap("TRANSCRIBE_DAILY_CAP", 300); }
const SPEAK_MAX_CHARS = 400;
const TTS_VOICE = process.env.TTS_VOICE || "coral";
const TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
const TTS_INSTRUCTIONS = "Speak like a warm, friendly older cousin or buddy talking to an 11-year-old named Jax. Casual, upbeat, and natural. Not a teacher, not a news announcer, and not robotic. Relaxed pace, clear words, a little smile in your voice.";

function openaiTextCredentials(){
  if(!process.env.OPENAI_API_KEY) return null;
  return {
    kind: "openai",
    key: process.env.OPENAI_API_KEY,
    base: "https://api.openai.com/v1",
    textModel: process.env.OPENAI_TEXT_MODEL || "gpt-5-nano"
  };
}

function gatewayCredentials(){
  if(!process.env.AI_GATEWAY_API_KEY) return null;
  const imageModel = process.env.IMAGE_MODEL || process.env.AI_IMAGE_MODEL;
  const imageFallback = process.env.IMAGE_MODEL_FALLBACK || DEFAULT_IMAGE_FALLBACK;
  return {
    kind: "gateway",
    key: process.env.AI_GATEWAY_API_KEY,
    base: "https://ai-gateway.vercel.sh/v1",
    textModel: process.env.AI_TEXT_MODEL || "openai/gpt-5-nano",
    imageModel: imageModel || DEFAULT_IMAGE_MODEL,
    imageFallback
  };
}

function xaiCredentials(){
  if(!process.env.XAI_API_KEY) return null;
  const imageModel = process.env.IMAGE_MODEL || process.env.AI_IMAGE_MODEL;
  return {
    kind: "xai",
    key: process.env.XAI_API_KEY,
    base: "https://api.x.ai/v1",
    textModel: process.env.AI_TEXT_MODEL || "grok-4-fast",
    imageModel: imageModel || "grok-imagine-image",
    imageFallback: process.env.IMAGE_MODEL_FALLBACK || "grok-imagine-image"
  };
}

// Pictures stay on AI Gateway (Seedream / Grok Imagine). Text prefers OpenAI.
function imageCredentials(){
  return gatewayCredentials();
}

function textProviders(){
  const list = [];
  const openai = openaiTextCredentials();
  const gateway = gatewayCredentials();
  if(openai) list.push(openai);
  if(gateway) list.push(gateway);
  if(!list.length){
    const xai = xaiCredentials();
    if(xai) list.push(xai);
  }
  return list;
}

function credentials(){
  // Backward-compatible setup check: true if any provider is configured.
  return textProviders()[0] || imageCredentials() || xaiCredentials() || null;
}

function applyTextModelOptions(payload, creds){
  if(/gpt-5/i.test(creds.textModel)){
    // Official OpenAI Chat Completions uses reasoning_effort.
    // The AI Gateway previously accepted the reasoning object.
    // "low" gives sturdier general-knowledge answers than "minimal" without jumping to a costlier model.
    const effort = process.env.REASONING_EFFORT || "low";
    if(creds.kind === "openai") payload.reasoning_effort = effort;
    else payload.reasoning = { effort };
  }else{
    payload.temperature = 0.6;
  }
  return payload;
}

async function moderateInput(text, imageUrl){
  const openai = openaiTextCredentials();
  if(!openai) return { flagged: isUnsafeText(text), source: "regex" };
  try{
    const trimmed = String(text || "").slice(0, 2000);
    let input;
    if(imageUrl){
      input = [
        { type: "text", text: trimmed || "homework photo" },
        { type: "image_url", image_url: { url: imageUrl } }
      ];
    }else{
      input = trimmed;
    }
    const data = await postJson(openai.base + "/moderations", openai.key, {
      model: "omni-moderation-latest",
      input
    });
    const result = ((data && data.results) || [])[0] || {};
    return { flagged: !!result.flagged, source: "openai" };
  }catch(e){
    return { flagged: isUnsafeText(text), source: "regex" };
  }
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
    "Access-Control-Expose-Headers": "X-BW-Text-Provider, X-BW-Speak-Remaining, X-BW-Transcribe-Remaining",
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

const SYSTEM_PROMPT = `You are Jax's fun, natural, friendly conversation buddy inside his racing-and-building game, Build World.
Jax is 11 years old. Talk like a warm older cousin or buddy hanging out — not a teacher, not a tutor, and not a quiz host.

Default mode — normal conversation:
- Carry a normal, easygoing chat about whatever Jax brings up: games, trucks, animals, jokes, his day, sports, space, how things work, the Build World game, or just messing around.
- Be warm, enthusiastic, and genuinely interested in him. Remember what he said earlier and refer back to it when it helps.
- Be knowledgeable and accurate at a 5th-6th grade level when he asks a curious question. Give a real answer with a clear fact or two, not a thin one-liner. Keep everyday replies to about 3-7 short sentences.
- Use short sentences and simple words, because reading and spelling are still hard for him. If he misspells a word, model the correct spelling naturally. Do not point it out or nag.
- Do NOT steer the chat toward homework, school, spelling practice, quizzes, or "learning time." Do not turn a normal chat into a lesson. Do not quiz him.
- Follow-up questions should feel natural, like a friend. Do not end every message with a question or a "want to know something cool?" hook. Sometimes just riff, laugh, or share a thought.
- If he wants a picture, say you will make a fun kid-safe picture (the app handles the image).

Homework mode — only when he clearly asks for homework help or sends a homework photo:
- Switch into a patient tutor for that problem only. Do not stay in tutor mode after the homework chat naturally ends.
- Read the problem carefully and say what kind of problem it is in simple words. Then coach ONE step at a time.
- In each homework reply, talk about only the current step — do not list, preview, or work Step 2 or later until he has typed his work for the current step. Tell him only what this step is trying to do, give a small hint if needed, and ask him to do THAT step and type his work. Stop there and wait.
- After he tries, check his work, be encouraging, and only then give the next single step. If he is wrong, give a hint and let him try that same step again.
- NEVER state the final answer, the finished result, or a last-step result (for example, do not write the completed fraction, the boxed number, the finished sum or product, or a multiple-choice letter) until either (1) Jax has typed his own attempt at the answer, or (2) he has clearly asked you to tell him the answer a second time in this chat. The first time he asks you to just tell him, do not give it; encourage him to try the current step. Only if he asks again may you tell him the final answer.
- Do not sneak the answer into an example, a "so then...", a worked equation, or by finishing the last calculation for him. Do not work the whole problem in one reply.
- On homework, the follow-up should be asking him to try the current step, not a fun-fact hook.
- If the photo is not homework, stay kid-safe and do not treat it as homework. Never ask to keep or re-upload the photo — you only see it for this chat.

Safety (every time):
- Never ask for or repeat personal information (full name, address, school, phone, email, passwords, or where he lives).
- If he mentions being hurt, scared, or unsafe in real life, tell him to talk to a parent or trusted adult right away, and keep the reply short and caring.
- Refuse anything sexual, romantic, violent-for-real, self-harm, weapons, crime, drugs, hate, or adult topics. If asked, say you can only chat about fun things and the game, and offer a safer idea.
- Do not pretend to be a real person or agree to meet anyone.
- Do not make medical, legal, or financial advice.`;

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
function parseMsgCookie(req){ return parseCountCookie(req, "bw_msg_cap"); }
function msgCookieHeader(req, count){ return countCookieHeader(req, "bw_msg_cap", count); }
function parseSpeakCookie(req){ return parseCountCookie(req, "bw_speak_cap"); }
function speakCookieHeader(req, count){ return countCookieHeader(req, "bw_speak_cap", count); }
function parseTranscribeCookie(req){ return parseCountCookie(req, "bw_stt_cap"); }
function transcribeCookieHeader(req, count){ return countCookieHeader(req, "bw_stt_cap", count); }

module.exports = {
  credentials, textProviders, imageCredentials, applyTextModelOptions, moderateInput,
  corsHeaders, send, readJson,
  SYSTEM_PROMPT, isUnsafeText, looksLikeDraw, kidSafeImagePrompt, postJson,
  imageDailyCap, photoDailyCap, messageDailyCap, speakDailyCap, transcribeDailyCap,
  SPEAK_MAX_CHARS, TTS_VOICE, TTS_MODEL, TTS_INSTRUCTIONS,
  generateImage, usesChatImage, chicagoDay,
  parsePicCookie, picCookieHeader, parsePhotoCookie, photoCookieHeader,
  parseMsgCookie, msgCookieHeader, parseSpeakCookie, speakCookieHeader,
  parseTranscribeCookie, transcribeCookieHeader,
  DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_FALLBACK
};
