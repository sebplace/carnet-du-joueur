import {deflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// ---- PNG plumbing (zero-dependency, 8-bit truecolour) --------------------
function crc32(bytes){
  let crc=0xffffffff;
  for(const b of bytes){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data){
  const t=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);
  length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));
  return Buffer.concat([length,t,data,crc]);
}
function writePng(name,size,rgb){
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  writeFileSync(fileURLToPath(new URL(`../${name}`,import.meta.url)),Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header),
    chunk('IDAT',deflateSync(rgb)),
    chunk('IEND',Buffer.alloc(0))
  ]));
}

// ---- geometry helpers ----------------------------------------------------
function segDist(x,y,x1,y1,x2,y2){
  const t=Math.max(0,Math.min(1,((x-x1)*(x2-x1)+(y-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2)));
  return Math.hypot(x-x1-t*(x2-x1),y-y1-t*(y2-y1));
}
function inPoly(px,py,pts){ // convex polygon, consistent winding
  let s=0;
  for(let i=0;i<pts.length;i++){
    const [ax,ay]=pts[i],[bx,by]=pts[(i+1)%pts.length];
    const cross=(bx-ax)*(py-ay)-(by-ay)*(px-ax);
    if(cross!==0){const sg=cross>0?1:-1;if(s===0)s=sg;else if(s!==sg)return false;}
  }
  return true;
}

// ---- the mark : "Le Sceau de l'Heure Gardee" -----------------------------
// All coordinates live in a 192 unit square, centre (96,96), so the raster
// mark matches icon.svg / logo.svg exactly.
const INK=[41,41,41];      // #292929 plate
const BRASS=[184,147,90];  // #b8935a hour ring
const ACCENT=[253,142,161];// #fd8ea1 the kept hour
const IVORY=[240,230,210]; // #f0e6d2 keyhole / parchment
const STEM=[[89,86],[103,86],[109,126],[83,126]];

// Return the mark colour at a 192-space point, or null for "background".
function markAt(xx,yy,flat){
  // keyhole (drawn last / on top)
  if(Math.hypot(xx-96,yy-82)<17 || inPoly(xx,yy,STEM)) return IVORY;
  // hour ring
  if(Math.abs(Math.hypot(xx-96,yy-96)-64)<4.5) return flat?IVORY:BRASS;
  // faint inner ring (letterpress hairline)
  if(Math.abs(Math.hypot(xx-96,yy-96)-55)<0.9) return flat?IVORY:BRASS;
  // hour ticks 12/3/6/9 (12 o'clock is the accent "kept hour")
  const ticks=[[96,38,96,48,true],[154,96,144,96,false],[96,154,96,144,false],[38,96,48,96,false]];
  for(const [x1,y1,x2,y2,accent] of ticks){
    if(segDist(xx,yy,x1,y1,x2,y2)<3.5) return flat?IVORY:(accent?ACCENT:BRASS);
  }
  return null;
}

// Render one icon with 2x supersampling for clean edges.
function render(size,{scale=1,flat=false}={}){
  const rgb=Buffer.alloc((size*3+1)*size);
  const SS=2; // samples per axis
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      let r=0,g=0,b=0;
      for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++){
        const fx=(x+(sx+0.5)/SS)/size, fy=(y+(sy+0.5)/SS)/size;
        // map to 192 space, honouring the maskable safe-zone scale
        const xx=(fx*192-96)/scale+96, yy=(fy*192-96)/scale+96;
        const c=markAt(xx,yy,flat)||INK;
        r+=c[0];g+=c[1];b+=c[2];
      }
      const n=SS*SS,off=y*(size*3+1)+1+x*3;
      rgb[off]=Math.round(r/n);rgb[off+1]=Math.round(g/n);rgb[off+2]=Math.round(b/n);
    }
  }
  return rgb;
}

// Two-tone "any purpose" icons.
for(const size of [192,512]) writePng(`icon-${size}.png`,size,render(size));

// Maskable icon: flat single-colour mark, drawn at 60% inside the safe zone.
writePng('icon-maskable.png',512,render(512,{scale:0.6,flat:true}));
