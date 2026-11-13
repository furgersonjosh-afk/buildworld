const {
  imageCredentials, imageProviderChain, editProviderChain, corsHeaders, send, readJson, isUnsafeText,
  kidSafeImagePrompt, kidSafeEditPrompt, generateImage, editImage, parseDataUrl, moderateInput,
  imageDailyCap, parsePicCookie, picCookieHeader
} = require("./_lib");

module.exports = async function handler(req, res){
  if(req.method === "OPTIONS"){
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  const genChain = imageProviderChain();
  const editChain = editProviderChain();
  const cap = imageDailyCap();
  if(req.method === "GET"){
    const used = parsePicCookie(req).count;
    return send(res, 200, {
      ok: true,
      setup: genChain.length > 0,
      pictures: genChain.length > 0,
      edits: editChain.length > 0,
      imageDailyCap: cap,
      remaining: Math.max(0, cap - used)
    }, req);
  }
  if(req.method !== "POST") return send(res, 405, { error: "method not allowed" }, req);
  if(!genChain.length && !editChain.length) return send(res, 503, { setup: false, error: "AI is not set up yet." }, req);

  let body;
  try{ body = await readJson(req); }
  catch(e){ return send(res, 400, { error: "bad request" }, req); }

  const prompt = String(body.prompt || "").slice(0, 500);
  if(!prompt.trim()) return send(res, 400, { error: "Please tell me what to draw." }, req);
  if(isUnsafeText(prompt)){
    return send(res, 200, { error: "I can only draw fun, kid-safe pictures. Try a truck, a dinosaur, or a racetrack!" }, req);
  }

  const sourceImage = typeof body.image === "string" ? body.image : "";
  const isEdit = !!sourceImage;
  if(isEdit){
    if(!editChain.length) return send(res, 503, { setup: false, error: "AI is not set up yet." }, req);
    if(!parseDataUrl(sourceImage)){
      return send(res, 400, { error: "I couldn't read that photo. Try taking it again?" }, req);
    }
  }else if(!genChain.length){
    return send(res, 503, { setup: false, error: "AI is not set up yet." }, req);
  }

  const used = parsePicCookie(req);
  if(used.count >= cap){
    return send(res, 429, {
      error: "You've used all " + cap + " pictures for today. You can try a new picture tomorrow!",
      imageDailyCap: cap,
      remaining: 0
    }, req);
  }

  const mod = await moderateInput(prompt, isEdit ? sourceImage : null);
  if(mod.flagged){
    return send(res, 200, { error: "I can only make fun, kid-safe pictures. Try a different idea!" }, req);
  }

  // Photoreal photograph by default; illustrated only if the user asked for cartoon/drawing/anime/coloring page.
  const safePrompt = isEdit ? kidSafeEditPrompt(prompt) : kidSafeImagePrompt(prompt);
  const chain = isEdit ? editChain : genChain;
  let lastErr = null;
  for(let s = 0; s < chain.length; s++){
    const step = chain[s];
    const attempts = (s === 0) ? 2 : 1; // retry the first provider once, then fall through
    for(let attempt = 1; attempt <= attempts; attempt++){
      try{
        const hit = isEdit
          ? await editImage({
              key: step.creds.key,
              base: step.creds.base,
              kind: step.creds.kind,
              model: step.model,
              quality: step.quality,
              prompt: safePrompt,
              imageDataUrl: sourceImage
            })
          : await generateImage({
              key: step.creds.key,
              base: step.creds.base,
              kind: step.creds.kind,
              model: step.model,
              quality: step.quality,
              prompt: safePrompt
            });
        if(isEdit){
          const outMod = await moderateInput("edited picture", hit.image);
          if(outMod.flagged){
            console.log("bw-image blocked output provider=" + step.creds.kind + " model=" + step.model + " edit=1");
            return send(res, 200, { error: "I can't show that picture. Try a different idea!" }, req);
          }
        }
        const next = used.count + 1;
        console.log("bw-image ok provider=" + step.creds.kind + " model=" + step.model + (isEdit ? " edit=1" : "") + (attempt > 1 ? " retry" : ""));
        return send(res, 200, {
          image: hit.image,
          edited: isEdit,
          imageDailyCap: cap,
          remaining: Math.max(0, cap - next),
          provider: step.creds.kind
        }, req, { "Set-Cookie": picCookieHeader(req, next) });
      }catch(e){
        lastErr = e;
        const status = e && e.status;
        const msg = String((e && e.message) || "fail").slice(0, 80);
        console.log("bw-image fail provider=" + step.creds.kind + " model=" + step.model + (isEdit ? " edit=1" : "") + " attempt=" + attempt + " status=" + status + " msg=" + msg);
      }
    }
  }
  return send(res, 502, { error: isEdit ? "I couldn't edit that picture right now. Try again in a little bit!" : "I couldn't make that picture right now. Try again in a little bit!" }, req);
};
