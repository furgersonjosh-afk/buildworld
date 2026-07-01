# Car models go here

Drop realistic 3D car models in this folder to replace the built-in shapes.

## Rules
- Format: **`.glb`** (or `.gltf`). Not `.fbx`/`.obj` — convert to `.glb` first.
- Use **generic** cars (a "supercar", "pickup") — NOT real brands by name
  (Lamborghini/Ford/etc.) — brand names/logos are a legal problem for a shared app.
- Keep files reasonably small (ideally under ~5 MB each) so the app stays fast.

## Where to get them
- **Meshy.ai** — free trial; type a description ("realistic orange off-road
  pickup truck"), download the `.glb`. Closest to "make it ourselves."
- **Sketchfab.com** — filter Downloadable + format glTF; many $0–20.
- **CGTrader / TurboSquid** — bigger selection, paid.

## How to turn it on
1. Put the file here, e.g. `assets/models/apex-gt.glb`.
2. Tell Claude the filename and which body it replaces (e.g. "supercar").
   Claude adds it to `CAR_MODELS` in `index.html` and tunes size/orientation.

The loader auto-scales the model to car size, sits it on the ground, and tries
to recolor its paint to the chosen color. Odd-looking scale/rotation is normal
for a new model — Claude adjusts per model.
