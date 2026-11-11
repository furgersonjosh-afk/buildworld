#!/usr/bin/env node
/**
 * Generate side-by-side sample pictures from Vercel AI Gateway candidate models.
 *
 * Usage (from repo root):
 *   AI_GATEWAY_API_KEY=... node scripts/image_samples_v21.mjs
 *
 * Writes PNGs to /workspace/chapters/ai_samples/<model>_<n>.png and a contact sheet.
 * Does not print the API key. Spends real money — only run when you intend to.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const OUT_DIR = process.env.AI_SAMPLE_DIR || "/workspace/chapters/ai_samples";
const BASE = "https://ai-gateway.vercel.sh/v1";

const PROMPTS = [
  "a giant monster truck jumping over a mud pit",
  "a lifted off-road truck crawling over red rocks at sunset",
  "a cartoon dragon racing a sports car"
];

// High-quality candidates in or near the $0.02–$0.05 / 1024px band (Gateway list 2026-11-10).
const MODELS = [
  { id: "bfl/flux-3-image", price: 0.048, note: "FLUX 3 Image (proposed default)" },
  { id: "bytedance/seedream-5.0-pro", price: 0.035, note: "Seedream 5.0 Pro" },
  { id: "google/gemini-nano-banana-2.1", price: 0.0336, note: "Nano Banana 2.1 (1K)" },
  { id: "spacexai/grok-imagine-image", price: 0.02, note: "Grok Imagine Image" }
];

const QUALITY_PREFIX = [
  "Create a vivid, highly detailed, colorful, high-quality image of the scene below.",
  "Use sharp focus, dramatic cinematic lighting, rich textures, and intricate mechanical detail for any vehicles.",
  "Style: high-quality digital art or a realistic cinematic render, whichever best fits the scene. Not a simple cartoon or clip-art, unless the scene itself is a cartoon.",
  "Child-friendly and suitable for an 11-year-old: cheerful, non-violent, no gore, no blood, no sexual content, no realistic depictions of real people.",
  "No text, no captions, no watermark, no brand logos, and no real brand names or trademarks.",
  "Scene: "
].join(" ");

function slug(model){
  return String(model).replace(/\//g, "-");
}

function usesChatImage(model){
  return /gemini|nano-banana/i.test(model);
}

async function postJson(path, key, body){
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let data;
  try{ data = JSON.parse(text); }catch(e){ data = { raw: text.slice(0, 500) }; }
  if(!r.ok){
    const err = new Error("HTTP " + r.status);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

function extractB64(data){
  const pull = (obj)=>{
    if(!obj) return null;
    if(obj.b64_json) return obj.b64_json;
    if(obj.b64) return obj.b64;
    if(typeof obj.url === "string" && obj.url.startsWith("data:")){
      const i = obj.url.indexOf("base64,");
      return i >= 0 ? obj.url.slice(i + 7) : null;
    }
    if(obj.image_url && typeof obj.image_url.url === "string" && obj.image_url.url.startsWith("data:")){
      const i = obj.image_url.url.indexOf("base64,");
      return i >= 0 ? obj.image_url.url.slice(i + 7) : null;
    }
    if(obj.inline_data && obj.inline_data.data) return obj.inline_data.data;
    return null;
  };
  let b64 = pull(data.data && data.data[0]);
  if(b64) return b64;
  const imgs = data.images || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.images) || [];
  b64 = pull(imgs[0]);
  if(b64) return b64;
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if(Array.isArray(content)){
    for(const part of content){
      b64 = pull(part);
      if(b64) return b64;
    }
  }
  return null;
}

async function maybeFetchUrl(data){
  const url = (data.data && data.data[0] && data.data[0].url)
    || (data.images && data.images[0] && data.images[0].url);
  if(url && /^https?:/.test(url)){
    const r = await fetch(url);
    if(!r.ok) throw new Error("image url " + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  return null;
}

async function generateOne(key, model, prompt){
  const full = QUALITY_PREFIX + prompt;
  let data;
  if(usesChatImage(model)){
    data = await postJson("/chat/completions", key, {
      model,
      messages: [{ role: "user", content: full }],
      modalities: ["text", "image"]
    });
  }else{
    const payload = {
      model,
      prompt: full,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json"
    };
    if(model.startsWith("bfl/")){
      payload.providerOptions = { blackForestLabs: { safetyTolerance: 1, outputFormat: "png", resolution: "1k" } };
    }
    data = await postJson("/images/generations", key, payload);
  }
  const b64 = extractB64(data);
  if(b64) return Buffer.from(b64, "base64");
  const fromUrl = await maybeFetchUrl(data);
  if(fromUrl) return fromUrl;
  throw new Error("no image bytes in response");
}

function contactSheet(files, dest){
  const py = `
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
files = ${JSON.stringify(files)}
cols, rows = 3, 4
tile = 320
pad, label_h = 12, 36
W = cols * tile + (cols + 1) * pad
H = rows * (tile + label_h) + (rows + 1) * pad
im = Image.new("RGB", (W, H), (16, 22, 48))
draw = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
except Exception:
    font = ImageFont.load_default()
for i, path in enumerate(files):
    r, c = divmod(i, cols)
    x = pad + c * (tile + pad)
    y = pad + r * (tile + label_h + pad)
    name = Path(path).stem if path else ""
    if path and Path(path).exists():
        src = Image.open(path).convert("RGB")
        src.thumbnail((tile, tile))
        ox = x + (tile - src.width)//2
        oy = y + (tile - src.height)//2
        im.paste(src, (ox, oy))
    else:
        draw.rectangle((x, y, x+tile, y+tile), outline=(80, 90, 120), width=2)
        draw.text((x+8, y+tile//2), "missing", fill=(180, 180, 200), font=font)
    draw.text((x, y + tile + 8), name[:42], fill=(230, 235, 245), font=font)
im.save(${JSON.stringify(dest)})
print("sheet", ${JSON.stringify(dest)})
`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  if(r.status !== 0){
    console.error("contact sheet failed:", (r.stderr || r.stdout || "").slice(0, 400));
    return false;
  }
  if(r.stdout) process.stdout.write(r.stdout);
  return true;
}

async function main(){
  const key = process.env.AI_GATEWAY_API_KEY;
  if(!key){
    console.error("AI_GATEWAY_API_KEY is not set. Nothing was generated.");
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  let estimated = 0;
  for(const model of MODELS){
    for(let i = 0; i < PROMPTS.length; i++){
      const n = i + 1;
      const file = resolve(OUT_DIR, slug(model.id) + "_" + n + ".png");
      const label = model.id + " #" + n + " — " + PROMPTS[i];
      process.stdout.write("Generating " + label + " ... ");
      try{
        const buf = await generateOne(key, model.id, PROMPTS[i]);
        writeFileSync(file, buf);
        estimated += model.price;
        console.log("ok (" + buf.length + " bytes, est $" + model.price.toFixed(4) + ")");
        results.push({ model: model.id, n, prompt: PROMPTS[i], file, ok: true, price: model.price });
      }catch(e){
        const detail = e.data ? JSON.stringify(e.data).slice(0, 240) : (e.message || String(e));
        console.log("FAIL " + detail);
        results.push({ model: model.id, n, prompt: PROMPTS[i], file, ok: false, error: String(e.message || e) });
      }
    }
  }
  const files = [];
  for(const model of MODELS){
    for(let n = 1; n <= PROMPTS.length; n++){
      const f = resolve(OUT_DIR, slug(model.id) + "_" + n + ".png");
      files.push(existsSync(f) ? f : "");
    }
  }
  const sheet = resolve(OUT_DIR, "contact_sheet_v21.png");
  contactSheet(files, sheet);
  console.log("---");
  console.log("Estimated cost (list prices, successful gens only): $" + estimated.toFixed(4));
  console.log("Output dir: " + OUT_DIR);
  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log("Succeeded: " + ok + "  Failed: " + fail);
}

main().catch(err => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
