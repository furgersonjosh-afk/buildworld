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

function openaiImageCredentials(){
  if(!process.env.OPENAI_API_KEY) return null;
  return {
    kind: "openai",
    key: process.env.OPENAI_API_KEY,
    base: "https://api.openai.com/v1",
    imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
    imageQuality: process.env.OPENAI_IMAGE_QUALITY || "medium"
  };
}

// Pictures: OpenAI first (fast and reliable), then AI Gateway quality models as backup.
function imageCredentials(){
  return openaiImageCredentials() || gatewayCredentials();
}
function imageProviderChain(){
  const list = [];
  const o = openaiImageCredentials();
  const g = gatewayCredentials();
  if(o) list.push({ creds: o, model: o.imageModel, quality: o.imageQuality || "medium" });
  if(g){
    list.push({ creds: g, model: g.imageModel });
    if(g.imageFallback && g.imageFallback !== g.imageModel){
      list.push({ creds: g, model: g.imageFallback });
    }
  }
  return list;
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
    "Access-Control-Expose-Headers": "X-BW-Text-Provider, X-BW-Speak-Remaining, X-BW-Transcribe-Remaining, X-BW-Voice-Preset",
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

- Carry a normal, easygoing chat about whatever Jax brings up: games, trucks, animals, jokes, his day, sports, space, how things work, the Build World game, or just messing around.
- Be warm, enthusiastic, and genuinely interested in him. Remember what he said earlier and refer back to it when it helps.
- Be knowledgeable and accurate at a 5th-6th grade level. When he asks a curious question, give a direct, friendly answer with a clear fact or two. Do not coach him, do not quiz him, and do not ask him to try the answer first.
- Everyday curious questions are NOT homework. Examples that must get a straight answer: "why is the sky blue", "what's 5 times 5" (tell him it's 25), "tell me about sharks", "how big is a blue whale", "how do monster truck shocks work".
- Use short sentences and simple words, because reading and spelling are still hard for him. If he misspells a word, model the correct spelling naturally. Do not point it out or nag.
- Do NOT steer the chat toward homework, school, spelling practice, quizzes, or "learning time." Do not turn a normal chat into a lesson.
- Follow-up questions should feel natural, like a friend. Do not end every message with a question.
- If he wants a picture, say you will make a fun kid-safe picture (the app handles the image). If he is asking you to draw, render, generate, or make a picture — even if he misspells it (reneder, drow, pitcher, genarate, creat) — start your reply with the exact token [[WANT_PICTURE]] then a short friendly line.
- Only use homework-tutor behavior when a later system note says this turn is homework help, or when he clearly asked for homework help or sent a homework photo. If you were helping with homework and he changes the subject, leave tutor mode immediately and chat normally.

Safety (every time):
- Never ask for or repeat personal information (full name, address, school, phone, email, passwords, or where he lives).
- If he mentions being hurt, scared, or unsafe in real life, tell him to talk to a parent or trusted adult right away, and keep the reply short and caring.
- Refuse anything sexual, romantic, violent-for-real, self-harm, weapons, crime, drugs, hate, or adult topics. If asked, say you can only chat about fun things and the game, and offer a safer idea.
- Do not pretend to be a real person or agree to meet anyone.
- Do not make medical, legal, or financial advice.`;

const HOMEWORK_TUTOR_PROMPT = `This turn is homework help (Jax asked for homework help or sent a homework photo). Switch into a patient tutor for this problem only.
- Read the problem carefully and say what kind of problem it is in simple words. Then coach ONE step at a time.
- In each homework reply, talk about only the current step — do not list, preview, or work Step 2 or later until he has typed his work for the current step. Tell him only what this step is trying to do, give a small hint if needed, and ask him to do THAT step and type his work. Stop there and wait.
- After he tries, check his work, be encouraging, and only then give the next single step. If he is wrong, give a hint and let him try that same step again.
- NEVER state the final answer, the finished result, or a last-step result (for example, do not write the completed fraction, the boxed number, the finished sum or product, or a multiple-choice letter) until either (1) Jax has typed his own attempt at the answer, or (2) he has clearly asked you to tell him the answer a second time in this chat. The first time he asks you to just tell him, do not give it; encourage him to try the current step. Only if he asks again may you tell him the final answer.
- Do not sneak the answer into an example, a "so then...", a worked equation, or by finishing the last calculation for him. Do not work the whole problem in one reply.
- On homework, the follow-up should be asking him to try the current step, not a fun-fact hook.
- If the photo is not homework, stay kid-safe and do not treat it as homework. Never ask to keep or re-upload the photo — you only see it for this chat.
- If Jax changes the subject to something that is not this homework problem, leave tutor mode and chat normally.`;


const UNSAFE_RE = /\b(porn|porno|xxx|nude|nudes|naked photo|sex tape|onlyfans|suicide|kill myself|self[- ]?harm|how to make a bomb|build a bomb|cocaine|heroin|fentanyl|child porn|csam)\b/i;

function isUnsafeText(text){
  return UNSAFE_RE.test(String(text || ""));
}

const KID_SPELL_MAP = {
  reneder: "render", rendr: "render", rendor: "render", redner: "render",
  rendar: "render", rendur: "render",
  drow: "draw", droaw: "draw",
  pitcher: "picture", picher: "picture", picure: "picture", pictue: "picture",
  genarate: "generate", genrate: "generate", generat: "generate",
  creat: "create",
  becuase: "because", becaus: "because", becuse: "because",
  wat: "what", wut: "what",
  ur: "your",
  u: "you",
  pls: "please", plz: "please",
  monstor: "monster",
  truk: "truck",
  lamborgini: "lamborghini", lamborghni: "lamborghini"
};
const DRAW_VERBS = ["draw", "render", "paint", "sketch", "generate", "create", "make"];
const DRAW_NOUNS = ["picture", "image", "drawing", "painting", "render", "illustration", "pic", "photo", "sketch"];
const DRAW_LEAD_INS = { please:1, pls:1, plz:1, hey:1, yo:1, can:1, could:1, will:1, would:1, u:1, you:1, ya:1 };
const MAKE_ME_SKIP = { joke:1, jokes:1, story:1, stories:1, song:1, songs:1, poem:1, poems:1, riddle:1, riddles:1, list:1, plan:1, promise:1, sandwich:1, homework:1, question:1, questions:1 };
const WANT_PICTURE_RE = /\[\[\s*WANT_PICTURE\s*\]\]/ig;

function autocorrectKidText(text){
  return String(text || "").replace(/[A-Za-z']+/g, function(word){
    const fix = KID_SPELL_MAP[word.toLowerCase()];
    if(!fix) return word;
    if(word[0] && word[0] === word[0].toUpperCase()) return fix.charAt(0).toUpperCase() + fix.slice(1);
    return fix;
  });
}

function damerau(a, b){
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if(Math.abs(m - n) > 2) return 99;
  const dp = new Array(m + 1);
  for(let i = 0; i <= m; i++){ dp[i] = new Array(n + 1); dp[i][0] = i; }
  for(let j = 0; j <= n; j++) dp[0][j] = j;
  for(let i = 1; i <= m; i++){
    for(let j = 1; j <= n; j++){
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if(i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)){
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}

function fuzzyMatchWord(word, candidates){
  const w = String(word || "").toLowerCase();
  if(!w) return null;
  if(KID_SPELL_MAP[w] && candidates.indexOf(KID_SPELL_MAP[w]) >= 0) return KID_SPELL_MAP[w];
  let best = null, bestD = 99;
  for(let i = 0; i < candidates.length; i++){
    const c = candidates[i];
    if(w === c) return c;
    const maxD = c.length <= 5 ? 1 : 2;
    if(Math.abs(c.length - w.length) > maxD) continue;
    const d = damerau(w, c);
    if(d <= maxD && d < bestD){ bestD = d; best = c; }
  }
  return best;
}

function looksLikeDraw(text){
  const t = autocorrectKidText(text).toLowerCase().trim();
  if(!t) return false;
  if(/\b(pic|picture|image|illustration|drawing|painting|render|photo|sketch)\s+of\b/.test(t)
    || /\b(show|send)\s+(me|us)(\s+a|\s+an|\s+the)?\s*(picture|image|drawing|painting|render|illustration|pic|photo|sketch)\b/.test(t)
    || /\bi want\s+(a|an|you to make\s+a|you to draw)\s+(picture|image|drawing|painting|render)\b/.test(t)
    || /\bdrew\s+(me|us|a|an|the)\b/.test(t)) return true;

  const words = t.replace(/[^a-z0-9'\s]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while(i < words.length && DRAW_LEAD_INS[words[i]]) i++;
  if(i >= words.length) return false;
  const verb = fuzzyMatchWord(words[i], DRAW_VERBS) || (words[i] === "drew" ? "draw" : null);
  const after = words.slice(i + 1);
  const after0 = after[0] || "";
  let nounHit = false;
  for(let k = 0; k < words.length; k++){
    if(fuzzyMatchWord(words[k], DRAW_NOUNS)) { nounHit = true; break; }
  }
  for(let k = 0; k < words.length - 1; k++){
    if(fuzzyMatchWord(words[k], DRAW_NOUNS) && words[k + 1] === "of") return true;
  }
  if(!verb) return false;
  if(verb === "make"){
    if(nounHit) return true;
    if(after0 === "me" || after0 === "us"){
      const rest = (after[1] === "a" || after[1] === "an") ? (after[2] || "") : (after[1] || "");
      return !MAKE_ME_SKIP[rest];
    }
    return false;
  }
  if(["me","us","a","an","the","my","one","this","that","of"].indexOf(after0) >= 0) return true;
  return !!nounHit;
}

function stripWantPictureFlag(text){
  const raw = String(text || "");
  const draw = WANT_PICTURE_RE.test(raw);
  return { draw: draw, text: raw.replace(WANT_PICTURE_RE, "").replace(/^[ \t\r\n]+/, "").trim() };
}

function looksLikeHomework(text, hasPhoto, flag){
  if(flag || hasPhoto) return true;
  const t = String(text || "").toLowerCase();
  return /\b(homework|schoolwork|worksheet|assignment)\b/.test(t)
    || /\bhelp\s+(me\s+)?((with|on)\s+)?((this|my)\s+)?(homework|schoolwork|worksheet|math problem)\b/.test(t)
    || /\bhow\s+do\s+i\s+solve\b/.test(t);
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

async function postJson(url, key, body, opts){
  const ms = (opts && opts.timeout) || 55000;
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(), ms);
  let r;
  try{
    r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
  }catch(e){
    clearTimeout(timer);
    if(e && e.name === "AbortError"){
      const err = new Error("timeout");
      err.status = 504;
      throw err;
    }
    throw e;
  }
  clearTimeout(timer);
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

async function generateImage({ key, base, kind, model, prompt, quality, timeout }){
  const tmo = timeout || (kind === "openai" ? 40000 : 35000);
  if(usesChatImage(model)){
    const data = await postJson(base + "/chat/completions", key, {
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["text", "image"]
    }, { timeout: tmo });
    const hit = extractImage(data);
    if(!hit) throw Object.assign(new Error("no image in chat response"), { status: 502, data });
    return hit;
  }
  const payload = {
    model,
    prompt,
    n: 1,
    size: "1024x1024"
  };
  if(kind === "openai" || /^gpt-image/.test(model)){
    payload.quality = quality || "medium";
  }else{
    payload.response_format = "b64_json";
  }
  if(kind === "gateway" && /^bfl\//.test(model)){
    payload.providerOptions = { blackForestLabs: { safetyTolerance: 1, outputFormat: "jpeg", resolution: "1k" } };
  }
  const data = await postJson(base + "/images/generations", key, payload, { timeout: tmo });
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


const ALLOWED_TTS_VOICES = ["alloy","ash","ballad","coral","echo","fable","nova","onyx","sage","shimmer","verse","marin","cedar"];
const TTS_KID = "Talk to an 11-year-old named Jax. Warm, friendly, clear words, not a teacher, not a news announcer, and not robotic. Relaxed pace, a little smile in your voice. ";
const VOICE_PRESETS = [
  { id: "british-gentleman", voice: "fable", group: "british", label: "British Gentleman", blurb: "A polite British guy, like a friendly gentleman.",
    instructions: TTS_KID + "Speak with a clear, natural British English RP accent, like a friendly gentleman. Polite and easygoing, not stuffy." },
  { id: "british-adventurer", voice: "echo", group: "british", label: "British Adventurer", blurb: "A bold British explorer telling stories.",
    instructions: TTS_KID + "Speak with a natural British English accent, adventurous and bold, like a friendly explorer. Upbeat and clear." },
  { id: "british-mate", voice: "verse", group: "british", label: "Cheeky British Mate", blurb: "A fun British buddy hanging out.",
    instructions: TTS_KID + "Speak with a natural British London accent, like a cheeky, friendly mate hanging out. Casual and fun, not rude." },
  { id: "coral", voice: "coral", group: "friends", label: "Coral Buddy", blurb: "Warm, upbeat, and friendly.",
    instructions: TTS_KID + "Speak in your natural Coral voice, casual and kind." },
  { id: "nova", voice: "nova", group: "friends", label: "Nova Spark", blurb: "Bright and energetic.",
    instructions: TTS_KID + "Speak in a bright, energetic, friendly way." },
  { id: "sage", voice: "sage", group: "friends", label: "Sage Calm", blurb: "Calm, clear, and kind.",
    instructions: TTS_KID + "Speak calmly and clearly, warm and easy." },
  { id: "shimmer", voice: "shimmer", group: "friends", label: "Shimmer", blurb: "Light and cheerful.",
    instructions: TTS_KID + "Speak in a light, cheerful, friendly way." },
  { id: "alloy", voice: "alloy", group: "friends", label: "Alloy", blurb: "A balanced, friendly voice.",
    instructions: TTS_KID + "Speak in a natural, friendly way." },
  { id: "ash", voice: "ash", group: "friends", label: "Ash", blurb: "A clear, steady guy.",
    instructions: TTS_KID + "Speak in a clear, friendly, natural way." },
  { id: "echo", voice: "echo", group: "friends", label: "Echo", blurb: "A strong, clear guy.",
    instructions: TTS_KID + "Speak in a clear, friendly, natural way." },
  { id: "onyx", voice: "onyx", group: "friends", label: "Onyx", blurb: "A deep, calm guy.",
    instructions: TTS_KID + "Speak in a deep, calm, friendly way." },
  { id: "fable", voice: "fable", group: "friends", label: "Fable", blurb: "A storyteller with a British hint.",
    instructions: TTS_KID + "Speak naturally, like a friendly storyteller." },
  { id: "ballad", voice: "ballad", group: "friends", label: "Ballad", blurb: "Warm and a little dramatic.",
    instructions: TTS_KID + "Speak warmly and naturally, with a little expression." },
  { id: "verse", voice: "verse", group: "friends", label: "Verse", blurb: "Expressive and lively.",
    instructions: TTS_KID + "Speak in a lively, friendly, natural way." },
  { id: "marin", voice: "marin", group: "friends", label: "Marin", blurb: "Smooth and clear.",
    instructions: TTS_KID + "Speak smoothly, clearly, and kindly." },
  { id: "cedar", voice: "cedar", group: "friends", label: "Cedar", blurb: "Warm and natural.",
    instructions: TTS_KID + "Speak in a warm, natural, friendly way." }
];
const DEFAULT_VOICE_PRESET = "british-gentleman";

function getVoicePreset(id){
  const raw = String(id || "").toLowerCase().trim();
  return VOICE_PRESETS.find(p => p.id === raw) || VOICE_PRESETS.find(p => p.id === DEFAULT_VOICE_PRESET) || VOICE_PRESETS[0];
}
function publicVoicePresets(){
  return VOICE_PRESETS.map(p => ({ id: p.id, voice: p.voice, group: p.group, label: p.label, blurb: p.blurb }));
}

module.exports = {
  credentials, textProviders, imageCredentials, imageProviderChain, applyTextModelOptions, moderateInput,
  corsHeaders, send, readJson,
  SYSTEM_PROMPT, HOMEWORK_TUTOR_PROMPT, isUnsafeText, looksLikeDraw, looksLikeHomework, autocorrectKidText, stripWantPictureFlag, kidSafeImagePrompt, postJson,
  imageDailyCap, photoDailyCap, messageDailyCap, speakDailyCap, transcribeDailyCap,
  SPEAK_MAX_CHARS, TTS_VOICE, TTS_MODEL, TTS_INSTRUCTIONS,
  getVoicePreset, publicVoicePresets, DEFAULT_VOICE_PRESET, ALLOWED_TTS_VOICES,
  generateImage, usesChatImage, chicagoDay,
  parsePicCookie, picCookieHeader, parsePhotoCookie, photoCookieHeader,
  parseMsgCookie, msgCookieHeader, parseSpeakCookie, speakCookieHeader,
  parseTranscribeCookie, transcribeCookieHeader,
  DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_FALLBACK
};

