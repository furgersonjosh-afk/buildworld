const {
  corsHeaders, send, readJson, isUnsafeText, textProviders,
  transcribeDailyCap, parseTranscribeCookie, transcribeCookieHeader
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

const MAX_BYTES = 1000000;

module.exports = async function handler(req, res){
  if(req.method === "OPTIONS"){
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  const cap = transcribeDailyCap();
  const used = parseTranscribeCookie(req);
  const remaining = Math.max(0, cap - used.count);
  if(req.method === "GET"){
    return send(res, 200, { ok: true, setup: !!openaiKey(), transcribeDailyCap: cap, remaining }, req);
  }
  if(req.method !== "POST") return send(res, 405, { error: "method not allowed" }, req);
  const creds = openaiKey();
  if(!creds) return send(res, 503, { setup: false, error: "Voice typing is not set up yet." }, req);
  if(used.count >= cap){
    return send(res, 429, {
      error: "That's all the voice typing for today. You can still type your message!",
      transcribeDailyCap: cap,
      remaining: 0
    }, req);
  }

  let body;
  try{ body = await readJson(req); }
  catch(e){ return send(res, 400, { error: "bad request" }, req); }

  const dataUrl = String(body.audio || "");
  const m = /^data:audio\/([a-z0-9.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if(!m) return send(res, 400, { error: "I couldn't read that recording." }, req);
  let buf;
  try{ buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64"); }
  catch(e){ return send(res, 400, { error: "I couldn't read that recording." }, req); }
  if(!buf.length || buf.length > MAX_BYTES){
    return send(res, 400, { error: "That recording is a little too long. Try a shorter one!" }, req);
  }
  const ext = (m[1] || "webm").toLowerCase().replace("mpeg", "mp3").replace("mp4", "mp4").replace("x-m4a", "m4a").replace("wav", "wav").replace("webm", "webm");
  const mime = "audio/" + (ext === "mp3" ? "mpeg" : ext);
  const filename = "clip." + (ext === "mpeg" ? "mp3" : ext);

  try{
    const form = new FormData();
    form.append("file", new Blob([buf], { type: mime }), filename);
    form.append("model", process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
    form.append("language", "en");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + creds.key },
      body: form
    });
    const data = await r.json().catch(()=>({}));
    if(!r.ok){
      const err = new Error("upstream " + r.status);
      err.status = r.status;
      throw err;
    }
    const text = String((data && (data.text || data.transcript)) || "").trim();
    if(!text){
      return send(res, 200, { text: "", transcribeDailyCap: cap, remaining }, req);
    }
    if(isUnsafeText(text)){
      return send(res, 200, {
        text: "",
        blocked: true,
        error: "I couldn't use that. Try saying something else!"
      }, req);
    }
    const next = used.count + 1;
    console.log("bw-transcribe chars=" + text.length);
    return send(res, 200, {
      text,
      transcribeDailyCap: cap,
      remaining: Math.max(0, cap - next)
    }, req, {
      "Set-Cookie": transcribeCookieHeader(req, next),
      "X-BW-Transcribe-Remaining": String(Math.max(0, cap - next))
    });
  }catch(e){
    return send(res, 502, { error: "I couldn't hear that clearly. You can type instead!" }, req);
  }
};
