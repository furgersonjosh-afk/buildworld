const {
  corsHeaders, send, readJson, isUnsafeText, textProviders,
  speakDailyCap, SPEAK_MAX_CHARS, TTS_MODEL,
  parseSpeakCookie, speakCookieHeader, getVoicePreset, publicVoicePresets, DEFAULT_VOICE_PRESET
} = require("./_lib");

function openaiKey(){
  const list = textProviders();
  const o = list.find(p => p.kind === "openai") || null;
  if(o) return o;
  if(process.env.OPENAI_API_KEY){
    return { kind: "openai", key: process.env.OPENAI_API_KEY, base: "https://api.openai.com/v1" };
  }
  return null;
}

module.exports = async function handler(req, res){
  if(req.method === "OPTIONS"){
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  const cap = speakDailyCap();
  const used = parseSpeakCookie(req);
  const remaining = Math.max(0, cap - used.count);
  if(req.method === "GET"){
    return send(res, 200, {
      ok: true,
      setup: !!openaiKey(),
      speakDailyCap: cap,
      remaining,
      defaultPreset: DEFAULT_VOICE_PRESET,
      presets: publicVoicePresets()
    }, req);
  }
  if(req.method !== "POST") return send(res, 405, { error: "method not allowed" }, req);
  const creds = openaiKey();
  if(!creds) return send(res, 503, { setup: false, error: "Voice is not set up yet." }, req);

  let body;
  try{ body = await readJson(req); }
  catch(e){ return send(res, 400, { error: "bad request" }, req); }

  const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, SPEAK_MAX_CHARS);
  if(!text) return send(res, 400, { error: "Nothing to say." }, req);
  if(isUnsafeText(text)) return send(res, 400, { error: "I can only say kid-safe things." }, req);
  if(used.count >= cap){
    return send(res, 429, {
      error: "That's all the voice clips for today. You can still read the chat, or try voice again tomorrow!",
      speakDailyCap: cap,
      remaining: 0
    }, req);
  }

  const preset = getVoicePreset(body.preset || body.voice || DEFAULT_VOICE_PRESET);

  try{
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + creds.key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: preset.voice,
        input: text,
        instructions: preset.instructions,
        response_format: "mp3"
      })
    });
    if(!r.ok){
      const err = new Error("upstream " + r.status);
      err.status = r.status;
      throw err;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const next = used.count + 1;
    const headers = Object.assign({
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "X-BW-Speak-Remaining": String(Math.max(0, cap - next)),
      "X-BW-Voice-Preset": preset.id,
      "Set-Cookie": speakCookieHeader(req, next)
    }, corsHeaders(req));
    console.log("bw-speak preset=" + preset.id + " voice=" + preset.voice + " bytes=" + buf.length);
    res.writeHead(200, headers);
    res.end(buf);
  }catch(e){
    return send(res, 502, { error: "I couldn't use the voice right now." }, req);
  }
};
