#!/usr/bin/env python3
"""v28: unlocked vehicles persist and are selectable/drivable after reload (iPhone viewport)."""
import os
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import threading, time, sys, json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("V28_OUT", str(Path(__file__).resolve().parents[1] / "tests" / "out")))
PORT = 8788

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a):
        pass

TYPES = ["car", "truck", "moto", "dirtbike", "sportbike", "chopper", "atv", "monster", "lmp1"]

SETUP = """() => {
  if(navigator.serviceWorker){
    return navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r=>r.unregister())));
  }
}"""

GRANT = """() => {
  if(typeof closeModal === 'function') closeModal();
  state.level = 8;
  state.coins = 5000;
  state.xp = 0;
  const types = %s;
  types.forEach(k => { if(typeof grantVehicle === 'function') grantVehicle(k); });
  if(typeof normalizeOwnedVehicles === 'function') normalizeOwnedVehicles();
  save();
  if(typeof render === 'function') render();
  return { owned: state.owned.slice(), current: state.current, level: state.level };
}""" % json.dumps(TYPES)

def open_game(page, origin):
    page.goto(origin + "/index.html?v=28mock", wait_until="networkidle", timeout=60000)
    page.evaluate(SETUP)
    page.evaluate("()=>{ if(typeof closeModal==='function') closeModal(); }")
    page.wait_for_timeout(200)
    if page.locator("#nav_garage, [data-screen='garage']").count():
        try:
            page.click("#nav_garage", timeout=2000)
        except Exception:
            page.evaluate("()=>{ if(typeof setScreen==='function') setScreen('garage'); }")
    page.wait_for_timeout(300)

def main():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.2)
    origin = f"http://127.0.0.1:{PORT}"
    fails = []
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--use-gl=angle","--use-angle=swiftshader"])
        ctx = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        page = ctx.new_page()
        open_game(page, origin)
        granted = page.evaluate(GRANT)
        print("GRANTED", granted)
        for k in TYPES:
            if k not in granted.get("owned", []):
                fails.append(f"grant did not add {k}")

        # garage list shows each as owned
        page.evaluate("()=>{ if(typeof setScreen==='function') setScreen('garage'); if(typeof render==='function') render(); }")
        page.wait_for_timeout(400)
        garage = page.evaluate("""() => {
          const btns = [...document.querySelectorAll('#vehicles [data-vehicle], [data-vehicle]')];
          return btns.map(b => ({k: b.getAttribute('data-vehicle'), cls: b.className, text: b.textContent}));
        }""")
        print("GARAGE_COUNT", len(garage))
        by = {t["k"]: t for t in garage}
        for k in TYPES:
            if k not in by:
                fails.append(f"{k} missing from garage list")
            elif "owned" not in (by[k]["cls"] or "") and "sel" not in (by[k]["cls"] or ""):
                fails.append(f"{k} in garage but not marked owned: {by[k]['cls']}")

        # persist + reload
        page.reload(wait_until="networkidle", timeout=60000)
        page.evaluate(SETUP)
        page.evaluate("()=>{ if(typeof closeModal==='function') closeModal(); }")
        page.wait_for_timeout(400)
        after = page.evaluate("""() => {
          if(typeof normalizeOwnedVehicles === 'function') normalizeOwnedVehicles();
          return { owned: (state.owned||[]).slice(), current: state.current };
        }""")
        print("AFTER_RELOAD", after)
        for k in TYPES:
            if k not in after.get("owned", []):
                fails.append(f"{k} missing from save after reload")

        # select each and confirm, then drive one bike and one truck
        def select_and_check(k):
            page.evaluate("""(k) => {
              if(typeof closeModal==='function') closeModal();
              if(typeof setScreen==='function') setScreen('garage');
              if(typeof selectVehicle==='function') selectVehicle(k);
              if(typeof render==='function') render();
              return state.current;
            }""", k)
            page.wait_for_timeout(150)
            cur = page.evaluate("() => state.current")
            if cur != k:
                fails.append(f"selectVehicle({k}) left current={cur}")
            return cur

        for k in TYPES:
            select_and_check(k)

        # 2D drive dirtbike after reload path
        select_and_check("dirtbike")
        page.evaluate("()=>{ if(typeof setScreen==='function') setScreen('drive'); }")
        page.wait_for_timeout(700)
        moved = page.evaluate("""() => {
          if(typeof car === 'undefined' || !car) return {ok:false, reason:'no car'};
          if(car.type !== 'dirtbike') return {ok:false, reason:'type '+car.type, x:car.x};
          const x0 = car.x;
          if(typeof drive !== 'undefined') drive.gas = true;
          return {ok:true, x0, type: car.type};
        }""")
        print("DRIVE_START", moved)
        if not moved or not moved.get("ok"):
            fails.append("2D drive did not start on dirtbike: "+str(moved))
        else:
            page.wait_for_timeout(1200)
            moved2 = page.evaluate("() => ({x: car && car.x, type: car && car.type, gas: !!(window.drive && drive.gas)})")
            print("DRIVE_AFTER", moved2)
            if not moved2 or moved2.get("type") != "dirtbike":
                fails.append("dirtbike not in 2D drive: "+str(moved2))
            elif abs((moved2.get("x") or 0) - (moved.get("x0") or 0)) < 5:
                fails.append("dirtbike did not move in 2D drive: "+str(moved2))

        # screenshot of garage list showing bikes
        page.evaluate("()=>{ if(typeof stopDrive==='function') stopDrive(); if(typeof setScreen==='function') setScreen('garage'); if(typeof render==='function') render(); if(typeof closeModal==='function') closeModal(); }")
        page.wait_for_timeout(400)
        # scroll bikes into view
        page.evaluate("""() => {
          const b = document.querySelector('[data-vehicle="dirtbike"]') || document.querySelector('[data-vehicle="moto"]');
          if(b) b.scrollIntoView({block:'center'});
        }""")
        page.wait_for_timeout(200)
        shot = OUT / "v28_bikes_in_list_iphone.png"
        page.screenshot(path=str(shot), full_page=False)
        print("SHOT", shot)

        # 3D picker includes bikes (open modal)
        page.evaluate("""() => {
          if(typeof openOwnedVehiclePicker === 'function') openOwnedVehiclePicker();
        }""")
        page.wait_for_timeout(300)
        picker = page.evaluate("""() => [...document.querySelectorAll('[data-pick-vehicle]')].map(b=>b.getAttribute('data-pick-vehicle'))""")
        print("PICKER", picker)
        for k in ("moto", "dirtbike"):
            if k not in (picker or []):
                fails.append(f"{k} missing from owned vehicle picker")
        picker_shot = OUT / "v28_bikes_picker_iphone.png"
        page.screenshot(path=str(picker_shot), full_page=False)
        print("SHOT", picker_shot)

        # repair path: owned missing bikes but configs remain
        page.evaluate("""() => {
          if(typeof closeModal==='function') closeModal();
          state.owned = state.owned.filter(k => k!=='moto' && k!=='dirtbike');
          state.configs = state.configs || {};
          state.configs.moto = state.configs.moto || {paint:'#e23b3b', _earned:1};
          state.configs.dirtbike = state.configs.dirtbike || {paint:'#37c46a'};
          state.current = 'crawler';
          save();
        }""")
        page.reload(wait_until="networkidle", timeout=60000)
        page.evaluate(SETUP)
        page.evaluate("()=>{ if(typeof closeModal==='function') closeModal(); }")
        page.wait_for_timeout(400)
        repaired = page.evaluate("() => ({owned: state.owned.slice()})")
        print("REPAIRED", repaired)
        for k in ("moto", "dirtbike"):
            if k not in repaired.get("owned", []):
                fails.append(f"load repair did not restore {k}")

        ctx.close()
        browser.close()
    httpd.shutdown()
    if fails:
        print("FAILS:")
        for f in fails:
            print(" -", f)
        sys.exit(1)
    print("MOCK_PASS")

if __name__ == "__main__":
    main()
