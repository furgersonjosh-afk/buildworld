const { credentials, corsHeaders, send, readJson, isUnsafeText, kidSafeImagePrompt, postJson } = require("./_lib");

module.exports = async function handler(req, res){
  if(req.method === "OPTIONS"){
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if(req.method !== "POST") return send(res, 405, { error: "method not allowed" }, req);
  const creds = credentials();
  if(!creds) return send(res, 503, { setup: false, error: "AI is not set up yet." }, req);

  let body;
  try{ body = await readJson(req); }
  catch(e){ return send(res, 400, { error: "bad request" }, req); }

  const prompt = String(body.prompt || "").slice(0, 500);
  if(!prompt.trim()) return send(res, 400, { error: "Please tell me what to draw." }, req);
  if(isUnsafeText(prompt)){
    return send(res, 200, { error: "I can only draw fun, kid-safe pictures. Try a truck, a dinosaur, or a racetrack!" }, req);
  }

  const safePrompt = kidSafeImagePrompt(prompt);
  const payload = {
    model: creds.imageModel,
    prompt: safePrompt,
    n: 1,
    size: "1024x1024",
    response_format: "b64_json"
  };
  if(creds.kind === "gateway"){
    payload.providerOptions = { blackForestLabs: { safetyTolerance: 1, outputFormat: "jpeg" } };
  }

  try{
    const data = await postJson(creds.base + "/images/generations", creds.key, payload);
    const img = (data.data && data.data[0]) || {};
    const b64 = img.b64_json || img.b64 || "";
    const url = img.url || "";
    if(b64) return send(res, 200, { image: "data:image/jpeg;base64," + b64 }, req);
    if(url) return send(res, 200, { image: url }, req);
    return send(res, 502, { error: "I couldn't make that picture. Try another idea!" }, req);
  }catch(e){
    return send(res, 502, { error: "I couldn't make that picture right now. Try again in a little bit!" }, req);
  }
};
