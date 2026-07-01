// Generates BUILD WORLD app icons as real PNGs (no deps, built-in zlib).
const fs = require("fs");
const zlib = require("zlib");
const OUT = process.argv[2] || ".";

function draw(S){
  const buf = Buffer.alloc(S*S*4); // RGBA, starts transparent
  function px(x,y,r,g,b,a){
    x|=0; y|=0; if(x<0||y<0||x>=S||y>=S) return;
    const A = a===undefined?255:a, i=(y*S+x)*4, ia=255-A;
    buf[i]  = (r*A+buf[i]*ia)/255|0;
    buf[i+1]= (g*A+buf[i+1]*ia)/255|0;
    buf[i+2]= (b*A+buf[i+2]*ia)/255|0;
    buf[i+3]= Math.min(255, buf[i+3]+A);
  }
  function rrect(x0,y0,w,h,rad,c){
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const cx = x<rad?rad:(x>=w-rad?w-rad-1:x);
      const cy = y<rad?rad:(y>=h-rad?h-rad-1:y);
      const dx=x-cx, dy=y-cy;
      if(dx*dx+dy*dy<=rad*rad) px(x0+x,y0+y,c[0],c[1],c[2],c[3]);
    }
  }
  function circle(cx,cy,rad,c){
    for(let y=cy-rad;y<=cy+rad;y++) for(let x=cx-rad;x<=cx+rad;x++){
      const dx=x-cx, dy=y-cy; if(dx*dx+dy*dy<=rad*rad) px(x,y,c[0],c[1],c[2],c[3]);
    }
  }
  // full-bleed gradient background (top blue -> bottom purple)
  for(let y=0;y<S;y++){
    const t=y/S;
    const r=Math.round(59+(91-59)*t), g=Math.round(123+(59-123)*t), b=Math.round(255+(214-255)*t);
    for(let x=0;x<S;x++) px(x,y,r,g,b,255);
  }
  const u=S/512, T=(v)=>v*u;   // off-road truck, authored at 512
  circle((T(256))|0,(T(434))|0,(T(150))|0,[0,0,0,45]);        // ground shadow
  function wheel(cx,cy){
    cx|=0; cy|=0;
    circle(cx,cy,(T(80))|0,[18,18,22,255]);                   // tire
    for(let i=0;i<12;i++){ const a=i/12*Math.PI*2;
      circle((cx+Math.cos(a)*T(80))|0,(cy+Math.sin(a)*T(80))|0,(T(9))|0,[8,8,10,255]); } // tread
    circle(cx,cy,(T(45))|0,[208,212,222,255]);                // rim
    circle(cx,cy,(T(19))|0,[110,114,124,255]);                // hub
  }
  wheel(T(158),T(360)); wheel(T(366),T(360));                 // big lifted wheels
  rrect(T(94),T(230),T(186),T(80),T(14),[216,94,16,255]);     // bed (deep orange)
  rrect(T(248),T(176),T(174),T(134),T(22),[255,122,31,255]);  // cab (bright orange)
  rrect(T(274),T(198),T(122),T(60),T(12),[196,232,255,255]);  // window
  rrect(T(96),T(300),T(326),T(16),T(8),[168,66,8,255]);       // rocker line
  rrect(T(406),T(250),T(20),T(60),T(8),[38,38,44,255]);       // front bumper/grille
  rrect(T(398),T(214),T(22),T(22),T(6),[255,243,176,255]);    // headlight
  rrect(T(286),T(160),T(112),T(16),T(6),[28,28,34,255]);      // roof light bar
  for(let k=0;k<4;k++) rrect(T(298)+k*T(27),T(162),T(15),T(12),T(4),[255,240,150,255]);
  return buf;
}

// --- minimal PNG encoder ---
const crcTable = (()=>{ const t=[]; for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320 ^ (c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
function crc32(b){ let c=0xFFFFFFFF; for(let i=0;i<b.length;i++) c = crcTable[(c^b[i])&0xFF] ^ (c>>>8); return (c^0xFFFFFFFF)>>>0; }
function chunk(type,data){
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
  const t=Buffer.from(type,"ascii");
  const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data])),0);
  return Buffer.concat([len,t,data,crc]);
}
function encodePNG(buf,S){
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(S,0); ihdr.writeUInt32BE(S,4); ihdr[8]=8; ihdr[9]=6;
  const raw=Buffer.alloc((S*4+1)*S);
  for(let y=0;y<S;y++){ raw[y*(S*4+1)]=0; buf.copy(raw,y*(S*4+1)+1,y*S*4,y*S*4+S*4); }
  const idat=zlib.deflateSync(raw,{level:9});
  return Buffer.concat([sig, chunk("IHDR",ihdr), chunk("IDAT",idat), chunk("IEND",Buffer.alloc(0))]);
}

[[512,"icon-512.png"],[192,"icon-192.png"],[180,"apple-touch-icon.png"]].forEach(([S,name])=>{
  const png=encodePNG(draw(S),S);
  fs.writeFileSync(OUT+"/"+name, png);
  console.log(name, png.length, "bytes");
});
