const {
  imageCredentials, corsHeaders, send, readJson, isUnsafeText, kidSafeImagePrompt,
  generateImage, imageDailyCap, parsePicCookie, picCookieHeader
} = require("./_lib");

module.exports = async function handler(req, res){
  if(req.method === "OPTIONS"){
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  const creds = imageCredentials();
  const cap = imageDailyCap();
  if(req.method === "GET"){
    const used = parsePicCookie(req).count;
    return send(res, 200, { ok: true, setup: !!creds, pictures: true, imageDailyCap: cap, remaining: Math.max(0, cap - used) }, req);
  }
  if(req.method !== "POST") return send(res, 405, { error: "method not allowed" }, req);
  if(!creds) return send(res, 503, { setup: false, error: "AI is not set up yet." }, req);

  let body;
  try{ body = await readJson(req); }
  catch(e){ return send(res, 400, { error: "bad request" }, req); }

  const prompt = String(body.prompt || "").slice(0, 500);
  if(!prompt.trim()) return send(res, 400, { error: "Please tell me what to draw." }, req);
  if(isUnsafeText(prompt)){
    return send(res, 200, { error: "I can only draw fun, kid-safe pictures. Try a truck, a dinosaur, or a racetrack!" }, req);
  }

  const used = parsePicCookie(req);
  if(used.count >= cap){
    return send(res, 429, {
      error: "You've used all " + cap + " pictures for today. You can try a new picture tomorrow!",
      imageDailyCap: cap,
      remaining: 0
    }, req);
  }

  const safePrompt = kidSafeImagePrompt(prompt);
  const models = [creds.imageModel];
  if(creds.imageFallback && creds.imageFallback !== creds.imageModel) models.push(creds.imageFallback);

  let lastErr = null;
  for(const model of models){
    try{
      const hit = await generateImage({
        key: creds.key,
        base: creds.base,
        kind: creds.kind,
        model,
        prompt: safePrompt
      });
      const next = used.count + 1;
      return send(res, 200, {
        image: hit.image,
        imageDailyCap: cap,
        remaining: Math.max(0, cap - next)
      }, req, { "Set-Cookie": picCookieHeader(req, next) });
    }catch(e){
      lastErr = e;
    }
  }
  return send(res, 502, { error: "I couldn't make that picture right now. Try again in a little bit!" }, req);
};
