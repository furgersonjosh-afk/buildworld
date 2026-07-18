# BUILD WORLD 🚜🏗️🛻

A growable building & customizing game for kids (~11). One self-contained web
page — no install, no accounts, no internet required to play. Runs on a phone,
tablet, or laptop. Saves automatically on the device.

Built to **start small and grow**: every bit of content lives in plain config
tables, and player progress already serializes into a shareable "world code" —
which is the foundation for real play-together later.

---

## What's in v1

- **🔧 Build Shop** (the heart of the app) — *build a car from parts*, step by
  step. The body roster covers the real car *types* kids want — Hot Hatch,
  **Apex GT supercar** (Lamborghini-style wedge), **Brawler V8 muscle car**,
  **Pickup HD truck**, Tractor, Motorcycle, Big Rig — as ORIGINAL designs (no
  real brand names/logos, so it's safe to share & grow). Steps:
  ① Body/chassis → ② Engine (Stock → V6 → V8 → Electric → Turbo V8) →
  ③ Wheels & tires (rim style sport/steel/off-road + rim color) → ④ Paint &
  style (colors, lift kit, window tint) → ⑤ Add-ons (spoilers, plows, tanks,
  cranes, light bars…). Detailed, shaded vehicles. A live **stats panel**
  (Power / Top Speed / Grip / Style) updates as you bolt on parts — and those
  stats actually change how the car performs in Test Drive. A **🏁 Test Drive**
  button drops your build straight into the off-road course.
- **🏁 Drive** — take your customized ride OFF-ROAD. Hill-climb physics over
  rolling terrain with **jump ramps**; do **flips** in the air (▶ leans back,
  ◀ leans forward) for bonus coins, grab coins on the track, and **land on your
  wheels** or you crash. Distance + flips + coins all pay into your wallet.
  (Inspired by Off Road Outlaws + Stunt Car Extreme.)
- **🏗️ Build** — design your own farm/town on a grid: roads, fences, trees,
  crops, houses, barns, silos, ponds, windmills, factories. Expand your land.
- **💼 Jobs** — plow fields, deliver hay, win races, mail runs, haul cargo.
  Earn 🪙 coins + ⭐ XP.
- **⭐ Level up** — leveling unlocks new vehicles, parts, and buildings. A
  celebration fires every level-up.
- **📤 Share** — copy your **world code** and send it to a friend; they paste it
  in to load your world. Each kid builds their own world on their own device.

---

## How to play it on vacation

Pick whichever is easiest for you:

### A) Quickest — straight off a laptop (no internet)
1. Double-click `index.html`. It opens in the browser and just works.
2. That's it. Progress saves on that laptop.

### B) On his tablet/phone — put it online (free, ~5 min)
A single static file hosts anywhere. Easiest options:
- **Netlify Drop**: go to https://app.netlify.com/drop and drag the
  `buildworld` folder onto the page. You get a link instantly.
- **Vercel** (you already use it for BioMap): `vercel` in this folder, or drag
  it into the dashboard. Same idea.
- Then open the link on his tablet and **"Add to Home Screen"** so it opens like
  an app. Works offline after the first load.

### C) Share with friends (today)
- Send them the **link** (option B) — each friend gets their own world.
- Or, inside the app → **Share** tab → **Copy my code**, and text it to a
  friend. They paste it under "Load a friend's world" to see what he built.

---

## How it grows (the fun part)

Everything is config. To add content, just add a row — no new code:

- **New vehicle** → add to the `VEHICLES` table in `index.html` (name, emoji,
  unlock level, cost, which parts it allows) + a drawing block in `vehicleSVG()`.
- **New add-on part** → add to `PARTS` + a small SVG snippet in the vehicle.
- **New building** → add to `BUILD_ITEMS` (name, emoji, level, cost, value).
- **New job** → add to `JOBS` (reward, XP, which vehicle it needs).
- **Tune difficulty** → `xpForLevel()` controls how fast levels come.

### Roadmap (in rough order)
1. ~~**2-player bonk battle** on one device (Drive Ahead style)~~ ✅ **DONE** —
   ⚔️ Bump Battle lives on the Drive screen: two kids, one tablet, bonk the
   other driver's head, first to 3 wins. (P1: left buttons / A-D keys.
   P2: right buttons / arrow keys.)
2. More Drive content: multiple tracks/biomes ✅ (4 tracks + laps + boost
   pads), fuel or time-trial modes, obstacles, a speedometer.
3. More vehicles (police ✅, fire ✅, dirt bike ✅, monster truck ✅,
   harvester) + more customization (decals/livery, exhaust, body kits).
4. **Fishing mini-game** (Fishing Clash style) — *parked in the queue.*
5. Sound effects ✅ + a daily reward ✅ (streak gift, grows to day 7) /
   quests to keep them coming back.
6. **Live online play-together** — the big one. The `serialize()` /
   `deserialize()` world model is already the data contract a server (or
   peer-to-peer) would sync. This needs accounts and child-privacy handling
   (COPPA), so it's a deliberate later phase, not a quick patch.

---

## Files
- `index.html` — the game (HTML + CSS + JS in one file).
- `lib/` — three.js + addons (the 3D engine), kept **local so it works
  offline**. KEEP THIS FOLDER NEXT TO index.html — if you move or send the game,
  send the whole `buildworld` folder, not just index.html.
- `README.md` — this file.

The Build Shop shows a **real 3D car** you can spin and zoom, with shiny
customizable paint, rims, and lift. If 3D/WebGL ever can't load, it
automatically falls back to a 2D car so the app never breaks.

No build step, no npm. Just open `index.html`.
