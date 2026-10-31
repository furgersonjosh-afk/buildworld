# v20 heading check: drive every vehicle straight and assert the body's nose points along travel (<5 deg),
# in landscape (844x390), portrait (390x844) and desktop (1280x720), plus the garage showroom model axis.
# Usage: python scripts/heading_check_v20.py [landscape,portrait,desktop]   (needs playwright + chrome)
# Env: BW_DIR (repo dir, default = this repo), BW_TYPES (comma list), BW_CHROME (chrome path)
import os, subprocess, time, json, sys, math
from playwright.sync_api import sync_playwright
VIEWS=[("landscape",844,390),("portrait",390,844),("desktop",1280,720)]
if len(sys.argv)>1: VIEWS=[v for v in VIEWS if v[0] in sys.argv[1].split(",")]
srv=subprocess.Popen(["python3","-m","http.server","8804"], cwd=os.environ.get("BW_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
AX="""(root, frameInv)=>{
  // PCA long axis of visible body vertices (x,z) + sign from nose markers
  const v=new THREE.Vector3(); let n=0,sx=0,sz=0,sxx=0,szz=0,sxz=0; const pts=[]; const front=[];
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!o.isMesh) return; let vis=true, q=o; while(q){ if(q.visible===false){vis=false;break;} if(q===root) break; q=q.parent; } if(!vis) return;
    const pos=o.geometry&&o.geometry.attributes.position; if(!pos) return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    const nm=mats.map(m=>(m&&m.name)||'').join(',')+'|'+(o.name||'')+'|'+((o.parent&&o.parent.name)||'');
    const isFront=/Headlight|Wheel_F/.test(nm);
    const step=Math.max(1,Math.floor(pos.count/300));
    for(let i=0;i<pos.count;i+=step){ v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld); if(frameInv) v.applyMatrix4(frameInv); pts.push([v.x,v.z]); if(isFront) front.push([v.x,v.z]); }
  });
  for(const p of pts){ sx+=p[0]; sz+=p[1]; } n=pts.length; const mx=sx/n, mz=sz/n;
  for(const p of pts){ const dx=p[0]-mx, dz=p[1]-mz; sxx+=dx*dx; szz+=dz*dz; sxz+=dx*dz; }
  const ang=0.5*Math.atan2(2*sxz, sxx-szz); let ax=[Math.cos(ang), Math.sin(ang)];
  let ext=[0,0]; for(const p of pts){ const t=(p[0]-mx)*ax[0]+(p[1]-mz)*ax[1]; ext[0]=Math.min(ext[0],t); ext[1]=Math.max(ext[1],t); }
  let side=0; for(const p of pts){ const t=-(p[0]-mx)*ax[1]+(p[1]-mz)*ax[0]; side=Math.max(side,Math.abs(t)); }
  let fsign=null; if(front.length){ let f=0; for(const p of front) f+=(p[0]-mx)*ax[0]+(p[1]-mz)*ax[1]; fsign=f/front.length; }
  return {ax, len:ext[1]-ext[0], wid:2*side, fsign, nFront:front.length};
}"""
SETUP="""(k)=>{ if(typeof closeModal==='function') closeModal(); if(CH3D) stop3DChapterMode(); if(!state.owned.includes(k)) state.owned.push(k); state.current=k; cfg(k).mudLevel=0; save(); setScreen('drive'); start3DChapterMode(); return CH3D.vType; }"""
def ang_between(ax, vel, signed_ok):
  a=math.degrees(math.atan2(ax[1],ax[0])-math.atan2(vel[1],vel[0]))
  a=(a+180)%360-180
  return a
fails=[]; rows=[]
with sync_playwright() as p:
  b=p.chromium.launch(executable_path=os.environ.get("BW_CHROME","/usr/bin/google-chrome"), headless=True, args=["--use-gl=angle","--use-angle=swiftshader"])
  for (vn,W,H) in VIEWS:
    pg=b.new_context(viewport={"width":W,"height":H}, has_touch=True, is_mobile=(vn!="desktop")).new_page()
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8804/index.html", wait_until="networkidle"); pg.wait_for_timeout(900)
    pg.evaluate("()=>{ window.__AX="+AX+"; }")
    keys=pg.evaluate("()=>[...new Set(DEALERSHIP_CATALOG.map(x=>x.vKey).concat(Object.keys(VEHICLES)))]")
    if os.environ.get("BW_TYPES"): keys=os.environ["BW_TYPES"].split(",")
    for k in keys:
      vt=pg.evaluate(SETUP,k); pg.wait_for_timeout(1700)
      pg.evaluate("()=>{ CH3D.input.left=false; CH3D.input.right=false; CH3D.steer=0; CH3D.heading=0.35; CH3D.speed=0; window.__p0=[CH3D.x,CH3D.z]; CH3D.input.gas=true; }")
      for _ in range(12):
        pg.wait_for_timeout(300)
        if pg.evaluate("()=>Math.hypot(CH3D.x-__p0[0],CH3D.z-__p0[1])")>1.0: break
      r=pg.evaluate("""()=>{ const p1=[CH3D.x,CH3D.z]; CH3D.input.gas=false; const a=__AX(CH3D.carHolder,null);
        return {vel:[p1[0]-__p0[0], p1[1]-__p0[1]], heading:CH3D.heading, speed:CH3D.speed, a}; }""")
      vel=r["vel"]; mv=math.hypot(*vel); hd=[math.cos(r["heading"]), -math.sin(r["heading"])]
      a=r["a"]; ax=a["ax"]
      if a["fsign"] is not None and a["fsign"]<0: ax=[-ax[0],-ax[1]]
      # body axis vs travel, folded to [0,90] when no nose marker exists (sign unknown)
      d=abs(ang_between(ax, vel if mv>0.3 else hd, True))
      if a["fsign"] is None: d=min(d,180-d)
      dh=abs(ang_between(hd, vel, True)) if mv>0.3 else 0.0
      ok = mv>0.3 and d<5 and dh<5
      rows.append((vn,k,vt,round(mv,2),round(d,2),round(dh,2),a["nFront"],round(a["len"],2),round(a["wid"],2),ok))
      print(vn,k,"->",vt,"moved=%.1f nose_vs_vel=%.2f° heading_vs_vel=%.2f° front=%d L=%.2f W=%.2f %s"%(mv,d,dh,a["nFront"],a["len"],a["wid"],"OK" if ok else "FAIL"), flush=True)
      if not ok: fails.append((vn,k))
    # garage showroom: model long axis vs group +X
    if vn=="landscape":
      for k in keys:
        g=pg.evaluate("""async(k)=>{ if(CH3D) stop3DChapterMode(); state.current=k; save(); setScreen('garage'); await new Promise(r=>setTimeout(r,900));
          if(!SR||!SR.carGroup) return null; const inv=new THREE.Matrix4().copy(SR.carGroup.matrixWorld).invert(); const a=__AX(SR.carGroup,inv); return a; }""",k)
        if not g: print("garage",k,"no SR"); fails.append(("garage",k)); continue
        ax=g["ax"]; d=abs(math.degrees(math.atan2(ax[1],ax[0]))); d=min(d%180,180-d%180)
        sgn_ok = g["fsign"] is None or (g["fsign"]*ax[0])>0
        ok=d<5 and sgn_ok
        print("garage",k,"axis_vs_+X=%.2f° noseFwd=%s %s"%(d,sgn_ok,"OK" if ok else "FAIL"), flush=True)
        if not ok: fails.append(("garage",k))
    print(vn,"pageerrors",errs[:3]); pg.context.close()
  b.close()
srv.terminate()
json.dump(rows, open(os.environ.get("BW_ROWS","heading_rows.json"),"w"))
print("HEADING_ALL_OK", not fails, fails)
sys.exit(0 if not fails else 1)
