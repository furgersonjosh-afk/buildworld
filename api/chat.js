const {
  textProviders, imageCredentials, applyTextModelOptions, moderateInput,
  corsHeaders, send, readJson, SYSTEM_PROMPT, HOMEWORK_TUTOR_PROMPT, isUnsafeText,
  looksLikeDraw, looksLikeHomework, autocorrectKidText, stripWantPictureFlag, postJson, imageDailyCap, photoDailyCap, messageDailyCap, speakDailyCap, transcribeDailyCap,
  parsePhotoCookie, photoCookieHeader, parseMsgCookie, msgCookieHeader
} = require("./_lib");

const PICTURE_TOOL = [{
  type: "function",
  function: {
    name: "request_picture",
    description: "Call this when the user wants a picture, drawing, or render of something, even if they misspelled words like reneder, drow, pitcher, or genarate. Do not call it for jokes, facts, or ordinary chat.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "A short kid-safe description of the picture to make." } },
      required: ["prompt"]
    }
  }
}];

function messageWantsPicture(data){
  const msg = (((data.choices || [])[0] || {}).message) || {};
  const calls = msg.tool_calls || [];
  for(const tc of calls){
    const name = (tc && tc.function && tc.function.name) || (tc && tc.name) || "";
    if(name === "request_picture") return true;
  }
  return false;
}

function extractText(content){
  if(typeof content === "string") return content;
  if(Array.isArray(content)){
    return content.map(p => {
      if(typeof p === "string") return p;
      if(p && p.type === "text") return String(p.text || "");
      return "";
    }).join(" ").trim();
  }
  return "";
}

function extractImageUrl(content){
  if(!Array.isArray(content)) return null;
  for(const p of content){
    if(!p) continue;
    const url = (p.image_url && p.image_url.url) || (p.type === "image_url" && p.url) || p.image_url;
    if(typeof url === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url)) return url;
  }
  return null;
}

function sanitizeVisionMessage(msg){
  if(!msg || (msg.role !== "user" && msg.role !== "assistant")) return null;
  const text = extractText(msg.content).slice(0, 800);
  const img = (msg.role === "user") ? extractImageUrl(msg.content) : null;
  if(img){
    if(img.length > 1800000) return { role: "user", content: text || "Please help me with this homework.", tooBig: true };
    const content = [];
    content.push({ type: "text", text: text || "Please help me with this homework. Read the problem in the photo. Coach me one step at a time and ask me to try that step. Do not tell me the final answer or any last-step result until I have typed my own attempt, or I ask for the answer a second time." });
    content.push({ type: "image_url", image_url: { url: img } });
    return { role: "user", content, hasPhoto: true };
  }
  if(!text) return null;
  return { role: msg.role, content: text };
}

function extractReply(data){
  const msg = (((data.choices || [])[0] || {}).message) || {};
  let t = msg.content;
  if(Array.isArray(t)) t = t.map(p => (p && (p.text || p.content)) || "").join(" ").trim();
  return String(t || "").trim();
}

module.exports = async function handler(req, res){
  if(req.method === "OPTIONS"){
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  const providers = textProviders();
  const imageReady = !!imageCredentials();
  if(req.method === "GET"){
    const usedPhotos = parsePhotoCookie(req).count;
    const usedMsgs = parseMsgCookie(req).count;
    const photoCap = photoDailyCap();
    const msgCap = messageDailyCap();
    return send(res, 200, {
      ok: true,
      setup: providers.length > 0,
      pictures: imageReady,
      preferredTextProvider: (providers[0] && providers[0].kind) || null,
      imageDailyCap: imageDailyCap(),
      photoDailyCap: photoCap,
      photosRemaining: Math.max(0, photoCap - usedPhotos),
      messageDailyCap: msgCap,
      messagesRemaining: Math.max(0, msgCap - usedMsgs),
      speakDailyCap: speakDailyCap(),
      transcribeDailyCap: transcribeDailyCap()
    }, req);
  }
  if(req.method !== "POST") return send(res, 405, { error: "method not allowed" }, req);
  if(!providers.length) return send(res, 503, { setup: false, error: "AI is not set up yet." }, req);

  let body;
  try{ body = await readJson(req); }
  catch(e){ return send(res, 400, { error: "bad request" }, req); }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const normalized = incoming.map(sanitizeVisionMessage).filter(Boolean);
  const lastUser = [...normalized].reverse().find(m => m && m.role === "user");
  if(!lastUser) return send(res, 400, { error: "Please type a message or send a homework photo." }, req);
  if(lastUser.tooBig) return send(res, 400, { error: "That photo is a little too big. Try taking it again?" }, req);

  const lastText = extractText(lastUser.content);
  const lastImage = lastUser.hasPhoto ? extractImageUrl(lastUser.content) : null;
  if(isUnsafeText(lastText)){
    return send(res, 200, { text: "I can't help with that. Let's talk about the game, a drawing, spelling, or a math problem instead!" }, req);
  }
  const mod = await moderateInput(lastText, lastImage);
  if(mod.flagged){
    return send(res, 200, { text: "I can't help with that. Let's talk about the game, a drawing, spelling, or a math problem instead!" }, req);
  }

  const hasPhoto = !!lastUser.hasPhoto;
  const photoCap = photoDailyCap();
  const usedPhotos = parsePhotoCookie(req);
  const msgCap = messageDailyCap();
  const usedMsgs = parseMsgCookie(req);
  if(usedMsgs.count >= msgCap){
    return send(res, 429, {
      error: "That's all the chat messages for today. You can try again tomorrow!",
      messageDailyCap: msgCap,
      remaining: 0
    }, req);
  }
  let setPhotoCookie = null;
  if(hasPhoto){
    if(usedPhotos.count >= photoCap){
      return send(res, 429, {
        error: "You've used all " + photoCap + " homework photos for today. You can type your question, or try a new photo tomorrow!",
        photoDailyCap: photoCap,
        remaining: 0
      }, req);
    }
    setPhotoCookie = photoCookieHeader(req, usedPhotos.count + 1);
  }

  // Keep text history; only the latest user turn may include a photo (never stored).
  const history = normalized.slice(-20).map(m => {
    if(m === lastUser) return { role: m.role, content: m.content };
    return { role: m.role, content: extractText(m.content).slice(0, 800) };
  });

  const homework = looksLikeHomework(lastText, hasPhoto, !!body.homework);
  const alreadyDraw = !hasPhoto && looksLikeDraw(lastText);
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if(homework) messages.push({ role: "system", content: HOMEWORK_TUTOR_PROMPT });
  messages.push(...history);
  let lastErr = null;
  for(const creds of providers){
    try{
      const payload = {
        model: creds.textModel,
        max_completion_tokens: hasPhoto ? 1100 : 900,
        messages
      };
      // When the typo-tolerant detector already knows this is a picture request,
      // skip tools so the model just writes a short friendly line.
      if(!hasPhoto && !alreadyDraw && !homework){
        payload.tools = PICTURE_TOOL;
        payload.tool_choice = "auto";
      }
      applyTextModelOptions(payload, creds);
      let data = await postJson(creds.base + "/chat/completions", creds.key, payload);
      let text = extractReply(data);
      let toolDraw = messageWantsPicture(data);
      if(!text && !toolDraw && /gpt-5/i.test(creds.textModel)){
        payload.max_completion_tokens = hasPhoto ? 1600 : 1400;
        data = await postJson(creds.base + "/chat/completions", creds.key, payload);
        text = extractReply(data);
        toolDraw = messageWantsPicture(data);
      }
      const flagged = stripWantPictureFlag(text || "");
      text = flagged.text;
      if(!text && (toolDraw || flagged.draw || alreadyDraw)){
        text = "Awesome — I'll make a fun kid-safe picture for you!";
      }
      if(!text){
        lastErr = new Error("empty reply");
        continue;
      }
      // Provider name only — never log keys, prompts, or photos.
      console.log("bw-chat provider=" + creds.kind + (alreadyDraw || toolDraw || flagged.draw ? " draw=1" : ""));
      const cookies = [msgCookieHeader(req, usedMsgs.count + 1)];
      if(setPhotoCookie) cookies.push(setPhotoCookie);
      const extra = { "X-BW-Text-Provider": creds.kind, "Set-Cookie": cookies };
      return send(res, 200, {
        text: String(text).trim(),
        provider: creds.kind,
        draw: !hasPhoto && (alreadyDraw || toolDraw || flagged.draw),
        photoDailyCap: photoCap,
        photosRemaining: hasPhoto ? Math.max(0, photoCap - (usedPhotos.count + 1)) : Math.max(0, photoCap - usedPhotos.count),
        messageDailyCap: msgCap,
        messagesRemaining: Math.max(0, msgCap - (usedMsgs.count + 1))
      }, req, extra);
    }catch(e){
      lastErr = e;
    }
  }
  return send(res, 502, { error: "I couldn't reach the AI right now. Please try again in a little bit." }, req);
};
