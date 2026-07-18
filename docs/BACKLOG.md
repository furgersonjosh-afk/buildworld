# BUILD WORLD — Backlog (jobs, split by phase)

Rough estimates. "Evening" = one focused work session.

## ✅ Done
- Build Shop: build-from-parts (body → engine → wheels → paint → add-ons) + live stats
- 3D showroom (rotate/zoom, studio HDRI lighting, clearcoat paint)
- Built-in 3D car shapes (extruded profiles + flares) — cartoon-realistic
- Off-road Test Drive (ramps, flips, coins; stats affect performance)
- Build mode (farm/town grid), Jobs, level-up unlocks, save, share-code
- Installable app (PWA) + offline + free hosting
- **3D model loader wired** — real `.glb` cars can now be dropped in
- Multiplayer racing (room codes), 4 tracks, laps, best times, boost pads
- Music + sound, Quad ATV, 3 more motorcycles
- **⚔️ Bump Battle** — Drive-Ahead-style 2-players-1-device mode (bonk the
  other driver's head, first to 3; heavier trucks shove harder)
- **🎁 Daily reward** — streak-based login gift (grows to day 7)
- **🚓 Police Cruiser + 🚒 Fire Truck** (light bar / roof ladder) + 2 new jobs

## 🎯 Now: realistic cars (AI-render / bought models)
- **Josh:** generate a car on Meshy.ai (free) or buy a `.glb` on Sketchfab
  ($0–20), put it in `assets/models/`, tell Claude the filename + which body.
- **Claude:** register it in `CAR_MODELS`, tune scale/orientation, hook up paint
  recolor. ~30–60 min per model once the file exists.
- Repeat per car. **First realistic car: one evening (gated on the model).**

## 🔜 Next: online multiplayer (each kid on their own device)
The big one. Phased:
1. **Peer-to-peer plumbing** (WebRTC / free signaling) — connect two devices. ~1 evening
2. **Shared world** — see each other's cars move in real time. ~1–2 evenings
3. **Rooms / invite code** — friends join a game by code. ~1 evening
4. **Polish** — names, more players, smoothing. ~ongoing
- Est: **rough playable ~2–4 evenings; solid ~1–2 weeks.** Cost: ~free.
- Privacy: keep it a closed friends group, no personal data beyond a nickname.

## 💡 Later
- More content (harvester, decals/livery, body kits), quests
- Bump Battle polish: pick different vehicles per player, arena variety, power-ups
- Fishing mini-game (parked)
- Split `index.html` into `src/*.js` modules once it gets big

## 🏠 Separate project (NOT quick)
- **House / interior design app** — own repo, reuses this 3D + deploy stack.
  Realism comes from TEXTURES (Josh's ComfyUI/render setup shines here). Do it
  right, not rushed.
