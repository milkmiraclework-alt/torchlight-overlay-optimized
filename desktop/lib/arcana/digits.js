'use strict';
const glyphs=[...require('./digits.json').glyphs,...require('./game-life-glyphs.json').glyphs];
const rankings=new Map();
function raster(img,rect,{brightness=510,saturation=130}={}){
 const x0=Math.max(0,Math.floor(rect.x)),y0=Math.max(0,Math.floor(rect.y)),w=Math.min(img.width-x0,Math.ceil(rect.w)),h=Math.min(img.height-y0,Math.ceil(rect.h));
 if(w<2||h<3)return null;
 const mask=new Uint8Array(w*h),{data,width}=img;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=((y+y0)*width+x+x0)*4,r=data[p],g=data[p+1],b=data[p+2];if(r+g+b>brightness&&Math.max(r,g,b)-Math.min(r,g,b)<saturation)mask[y*w+x]=1;}
 const cols=[];for(let x=0;x<w;x++){let count=0;for(let y=0;y<h;y++)count+=mask[y*w+x];cols[x]=count;}
 const boxes=[];for(let x=0;x<w;){if(!cols[x]){x++;continue;}const l=x;while(x<w&&cols[x])x++;const r=x-1;let t=h,b=0,n=0;for(let yy=0;yy<h;yy++)for(let xx=l;xx<=r;xx++)if(mask[yy*w+xx]){t=Math.min(t,yy);b=Math.max(b,yy);n++;}if(n>=4&&b-t>=4)boxes.push({l,r,t,b});}
 return {mask,w,h,boxes};
}
function lastBox(r){
 // Only a single complete digit in the expected area qualifies. Small sparks
 // and the pill's arc must not count as leading/trailing numeric characters.
 const seen=new Uint8Array(r.mask.length),components=[];
 for(let start=0;start<r.mask.length;start++){if(!r.mask[start]||seen[start])continue;const points=[start];seen[start]=1;let l=r.w,t=r.h,right=0,bottom=0;
  for(let k=0;k<points.length;k++){const p=points[k],x=p%r.w,y=Math.floor(p/r.w);l=Math.min(l,x);right=Math.max(right,x);t=Math.min(t,y);bottom=Math.max(bottom,y);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||x+dx<0||x+dx>=r.w||y+dy<0||y+dy>=r.h)continue;const q=(y+dy)*r.w+x+dx;if(r.mask[q]&&!seen[q]){seen[q]=1;points.push(q);}}}
  if(points.length>=4&&bottom-t>=4)components.push({l,r:right,t,b:bottom,component:new Set(points)});
 }
 const boxes=components.filter(b=>{const w=b.r-b.l+1,h=b.b-b.t+1,aspect=w/h,x=(b.l+b.r)/2/r.w,y=(b.t+b.b)/2/r.h;return b.l>0&&b.r<r.w-1&&b.t>0&&b.b<r.h-1&&h>=r.h*.30&&h<r.h*.95&&w<=r.w*.80&&aspect>=.10&&aspect<=1.05&&x<.80&&y>.15&&y<.85;});
 return boxes.length===1?boxes[0]:null;
}
function shape(r,box){
 const bits=[];for(let y=0;y<18;y++)for(let x=0;x<12;x++){const a=Math.min(box.r,Math.floor(box.l+(x+.5)*(box.r-box.l+1)/12)),b=Math.min(box.b,Math.floor(box.t+(y+.5)*(box.b-box.t+1)/18)),p=b*r.w+a;bits.push(box.component?Number(box.component.has(p)):r.mask[p]);}
 return {bits:bits.join(''),aspect:(box.r-box.l+1)/(box.b-box.t+1)};
}
function read(img,rect,{minScore=.70,minMargin=.055,brightness=510,saturation=130,lastDigit=false}={}){
 const r=raster(img,rect,{brightness,saturation});if(!r||!r.boxes.length||!lastDigit&&r.boxes.length>2)return null;
 const single=lastDigit?lastBox(r):null;if(lastDigit&&!single)return null;
 let text='',confidence=1;
 for(const box of lastDigit?[single]:r.boxes){
  const s=shape(r,box),bits=s.bits,aspect=s.aspect,key=bits+'|'+aspect;
  let rank=rankings.get(key);
  if(!rank){
   const best=new Map();for(const g of glyphs){let hit=0,union=0;for(let i=0;i<bits.length;i++){const ref=g.bits.charCodeAt(i)===49,on=bits.charCodeAt(i)===49;if(ref||on)union++;if(ref&&on)hit++;}const score=hit/Math.max(1,union)-Math.abs(Math.log(aspect/g.aspect))*.10;if(score>(best.get(g.digit)??-Infinity))best.set(g.digit,score);}
   rank=[...best].map(([digit,score])=>({digit,score})).sort((a,b)=>b.score-a.score);if(rankings.size>=1024)rankings.delete(rankings.keys().next().value);rankings.set(key,rank);
  }
  const first=rank[0],second=rank[1];
  if(first.score<minScore||first.score-(second?.score||0)<minMargin)return null;
  text+=first.digit;confidence=Math.min(confidence,first.score);
 }
 const value=Number(text);return value>=0&&value<=30?{value,confidence}:null;
}
// The life digit sits immediately right of its diamond. The far right of the
// old crop includes a decorative arc, not another digit.
const lifeRect=rect=>({x:rect.x,y:rect.y+rect.h*.08,w:rect.w*.68,h:rect.h*.84});
const lifeMasks=[{brightness:350,saturation:90},{brightness:400,saturation:90},{brightness:450,saturation:90},{brightness:510,saturation:90},{brightness:450,saturation:150},{brightness:510,saturation:150},{brightness:550,saturation:150},{brightness:600,saturation:150}];
function similarity(a,b){
 let hit=0,union=0;for(let i=0;i<a.bits.length;i++){const x=a.bits.charCodeAt(i)===49,y=b.bits.charCodeAt(i)===49;if(x||y)union++;if(x&&y)hit++;}
 return hit/Math.max(1,union)-Math.abs(Math.log(a.aspect/b.aspect))*.10;
}
function life(img,rect,learned=[]){
 const crop=lifeRect(rect),votes=[];
 for(const mask of lifeMasks){const r=read(img,crop,{...mask,minMargin:.04,lastDigit:true});if(r&&r.value<=6)votes.push(r);}
 const standard=votes.length>=2&&votes.every(v=>v.value===votes[0].value)?{value:votes[0].value,confidence:Math.min(...votes.map(v=>v.confidence)),source:'glyphs'}:null;
 const prototypes=(Array.isArray(learned)?learned:[]).slice(-32).filter(p=>p?.kind==='arcana_life_digit'&&p.version===1&&p.maskSupport>=2&&Number.isInteger(p.value)&&p.value>=0&&p.value<=6&&Array.isArray(p.samples));
 if(!prototypes.length)return standard;
 const matched=[];
 for(const mask of lifeMasks){
  const r=raster(img,crop,mask),b=r&&lastBox(r);if(!b)continue;const s=shape(r,b),rank=new Map();
  for(const p of prototypes)for(const sample of p.samples.slice(0,8)){if(!sample||typeof sample.bits!=='string'||!/^[01]{216}$/.test(sample.bits)||!Number.isFinite(sample.aspect)||sample.aspect<=0)continue;const score=similarity(s,sample);if(score>(rank.get(p.value)??-Infinity))rank.set(p.value,score);}
  const top=[...rank].sort((a,b)=>b[1]-a[1]);if(top[0]?.[1]>=.94&&top[0][1]-(top[1]?.[1]??0)>=.06)matched.push({value:top[0][0],confidence:top[0][1]});
 }
 const known=matched.length>=2&&matched.every(v=>v.value===matched[0].value)?{value:matched[0].value,confidence:Math.min(...matched.map(v=>v.confidence)),source:'learned_glyph'}:null;
 if(known&&votes.some(v=>v.value!==known.value))return null;
 return standard||known;
}
function rememberLife(img,rect,value){
 if(!Number.isInteger(value)||value<0||value>6)return null;
 const already=life(img,rect);if(already&&already.value!==value&&already.confidence>=.88)return null;
 const crop=lifeRect(rect),samples=[];
 for(const mask of lifeMasks){const r=raster(img,crop,mask),b=r&&lastBox(r);if(b)samples.push(shape(r,b));}
 const groups=samples.map(a=>samples.filter(b=>similarity(a,b)>=.90)).sort((a,b)=>b.length-a.length),stable=groups[0];
 if(!stable||stable.length<2||groups.some(g=>g.length>=2&&similarity(stable[0],g[0])<.75))return null;
 return {kind:'arcana_life_digit',version:1,value,maskSupport:stable.length,samples:[...new Map(stable.map(s=>[s.bits+'|'+s.aspect,s])).values()].slice(0,8)};
}
function handCount(img,rect){
 // Read the complete numerator / 10 layout. This excludes cropped strokes
 // that otherwise look like a confident '1'. Require agreeing thresholds.
 const votes=[];
 for(const brightness of [300,325,335,350,375,400,410,420,425,430,440,450,475,500,510,520,530,540,550,560,570]){
  const x0=Math.max(0,Math.floor(rect.x)),y0=Math.max(0,Math.floor(rect.y)),w=Math.min(img.width-x0,Math.ceil(rect.w)),h=Math.min(img.height-y0,Math.ceil(rect.h)),groups=[];
  let current=null;
  for(let x=0;x<w;x++){
   const points=[];for(let y=0;y<h;y++){const i=((y0+y)*img.width+x0+x)*4;if(img.data[i]+img.data[i+1]+img.data[i+2]>brightness)points.push([x,y]);}
   if(points.length){if(!current)current=[];current.push(...points);}else if(current){groups.push(current);current=null;}
  }
  if(current)groups.push(current);
  const parts=groups.map(points=>{const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),l=Math.min(...xs),r=Math.max(...xs),t=Math.min(...ys),b=Math.max(...ys),mx=xs.reduce((a,b)=>a+b)/points.length,my=ys.reduce((a,b)=>a+b)/points.length;
   let xy=0,xx=0,yy=0;for(const [x,y]of points){xy+=(x-mx)*(y-my);xx+=(x-mx)**2;yy+=(y-my)**2;}return {l,r,t,b,fill:points.length/((r-l+1)*(b-t+1)),corr:xy/Math.sqrt(xx*yy||1)};
  }).filter(p=>p.b-p.t>=4);
  const slash=parts.findIndex(p=>p.fill<.4&&p.corr<-.8);if(slash<1||slash>2||parts.length-slash-1!==2)continue;
  const decode=(ps,numerator=false)=>{const l=Math.min(...ps.map(p=>p.l)),r=Math.max(...ps.map(p=>p.r)),t=Math.min(...ps.map(p=>p.t)),b=Math.max(...ps.map(p=>p.b));return read(img,{x:x0+l,y:y0+t,w:r-l+1,h:b-t+1},{brightness,saturation:255,minScore:numerator ? .6 : .7,minMargin:numerator ? .04 : .055});};
  const digits=parts.slice(0,slash).filter(p=>p.b-p.t>=(parts[slash].b-parts[slash].t)*.65);if(!digits.length||digits[0].l<2||parts.at(-1).r>=w-1)continue;
  const numerator=decode(digits,true),denominator=decode(parts.slice(slash+1));
  if(numerator&&numerator.value<=10&&denominator?.value===10)votes.push(numerator);
 }
 const values=[...new Set(votes.map(v=>v.value))];return votes.length>=2&&values.length===1?{value:values[0],confidence:Math.min(...votes.map(v=>v.confidence))}:null;
}
function glyphSamples(img,rect){const samples=[];for(const mask of lifeMasks){const r=raster(img,lifeRect(rect),mask),box=r&&lastBox(r);if(box)samples.push(shape(r,box));}return [...new Map(samples.map(s=>[s.bits+'|'+s.aspect,s])).values()];}
module.exports={read,life,rememberLife,handCount,glyphSamples};
