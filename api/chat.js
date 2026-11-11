const { credentials, corsHeaders, send, readJson, SYSTEM_PROMPT, isUnsafeText, looksLikeDraw, postJson } = require("./_lib");

module.exports = async function handler(req, res){
  if(req.method === "OPTIONS"){
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  const creds = credentials();
  if(req.method === "GET"){
    return send(res, 200, { ok: true, setup: !!creds, pictures: true }, req);
  }
  if(req.method !== "POST") return send(res, 405, { error: "method not allowed" }, req);
  if(!creds) return send(res, 503, { setup: false, error: "AI is not set up yet." }, req);

  let body;
  try{ body = await readJson(req); }
  catch(e){ return send(res, 400, { error: "bad request" }, req); }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...incoming].reverse().find(m => m && m.role === "user");
  const lastText = String((lastUser && lastUser.content) || "").slice(0, 800);
  if(!lastText.trim()) return send(res, 400, { error: "Please type a message." }, req);
  if(isUnsafeText(lastText)){
    return send(res, 200, { text: "I can't help with that. Let's talk about the game, a drawing, spelling, or a math problem instead!" }, req);
  }

  const history = incoming
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 800) }));

  try{
    const data = await postJson(creds.base + "/chat/completions", creds.key, {
      model: creds.textModel,
      temperature: 0.6,
      max_tokens: 280,
      messages: [{ role: "system", content: SYSTEM_PROMPT }].concat(history)
    });
    const text = (((data.choices || [])[0] || {}).message || {}).content || "Sorry, I got a little stuck. Try asking me again!";
    return send(res, 200, { text: String(text).trim(), draw: looksLikeDraw(lastText) }, req);
  }catch(e){
    const status = e.status === 401 || e.status === 403 ? 502 : 502;
    return send(res, status, { error: "I couldn't reach the AI right now. Please try again in a little bit." }, req);
  }
};
