'use strict';
const glyphs=require('./digits.json').glyphs;
const rankings=new Map();
function read(img,rect,{minScore=.70,minMargin=.055,brightness=510,saturation=130,lastDigit=false}={}){
 const x0=Math.max(0,Math.floor(rect.x)),y0=Math.max(0,Math.floor(rect.y)),w=Math.min(img.width-x0,Math.ceil(rect.w)),h=Math.min(img.height-y0,Math.ceil(rect.h));
 if(w<2||h<3)return null;
 const mask=new Uint8Array(w*h),{data,width}=img;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=((y+y0)*width+x+x0)*4,r=data[p],g=data[p+1],b=data[p+2];if(r+g+b>brightness&&Math.max(r,g,b)-Math.min(r,g,b)<saturation)mask[y*w+x]=1;}
 const cols=[];for(let x=0;x<w;x++){let count=0;for(let y=0;y<h;y++)count+=mask[y*w+x];cols[x]=count;}
 const boxes=[];for(let x=0;x<w;){if(!cols[x]){x++;continue;}const l=x;while(x<w&&cols[x])x++;const r=x-1;let t=h,b=0,n=0;for(let yy=0;yy<h;yy++)for(let xx=l;xx<=r;xx++)if(mask[yy*w+xx]){t=Math.min(t,yy);b=Math.max(b,yy);n++;}if(n>=4&&b-t>=4)boxes.push({l,r,t,b});}
 if(!boxes.length||boxes.length>2)return null;
 let text='',confidence=1;
 for(const box of lastDigit?boxes.slice(-1):boxes){
  const bits=[];for(let y=0;y<18;y++)for(let x=0;x<12;x++){const a=Math.min(box.r,Math.floor(box.l+(x+.5)*(box.r-box.l+1)/12)),b=Math.min(box.b,Math.floor(box.t+(y+.5)*(box.b-box.t+1)/18));bits.push(mask[b*w+a]);}
  const aspect=(box.r-box.l+1)/(box.b-box.t+1),key=bits.join('')+'|'+aspect;
  let rank=rankings.get(key);
  if(!rank){
   const best=new Map();for(const g of glyphs){let hit=0,union=0;for(let i=0;i<bits.length;i++){const ref=g.bits.charCodeAt(i)===49;if(ref||bits[i])union++;if(ref&&bits[i])hit++;}const score=hit/Math.max(1,union)-Math.abs(Math.log(aspect/g.aspect))*.10;if(score>(best.get(g.digit)??-Infinity))best.set(g.digit,score);}
   rank=[...best].map(([digit,score])=>({digit,score})).sort((a,b)=>b.score-a.score);if(rankings.size>=1024)rankings.delete(rankings.keys().next().value);rankings.set(key,rank);
  }
  const first=rank[0],second=rank[1];
  if(first.score<minScore||first.score-(second?.score||0)<minMargin)return null;
  text+=first.digit;confidence=Math.min(confidence,first.score);
 }
 const value=Number(text);return value>=0&&value<=30?{value,confidence}:null;
}
function life(img,rect){
 const votes=new Map();
 for(const brightness of [350,400,450,510]){
  // Life is one digit (0–6). A little of the adjacent diamond icon can fall
  // inside the crop when its best scale changes; it is not a leading '1'.
  const r=read(img,rect,{brightness,saturation:90,minMargin:.025,lastDigit:true});if(!r||r.value>6)continue;
  const v=votes.get(r.value)||{value:r.value,count:0,confidence:0};v.count++;v.confidence+=r.confidence;votes.set(r.value,v);
 }
 const ranked=[...votes.values()].sort((a,b)=>b.count-a.count||b.confidence-a.confidence),a=ranked[0],b=ranked[1];
 if(a&&a.count>=2&&a.count>(b?.count||0))return {value:a.value,confidence:a.confidence/a.count};
 // Blue-tinted life digits lose neutral-colour strokes. At smaller pixel
 // sizes a fixed brightest mask can also erase the digit. Require at least
 // two confident tinted masks, with unanimous values among readable masks.
 const bright=[450,510,550,600].map(brightness=>read(img,rect,{brightness,saturation:130,minMargin:.025,lastDigit:true})).filter(v=>v&&v.value<=6);
 return bright.length>=2&&bright.every(v=>v.value===bright[0].value)?{value:bright[0].value,confidence:Math.min(...bright.map(v=>v.confidence))}:null;
}
function handCount(img,rect){
 // Read the complete numerator / 10 layout. This excludes cropped strokes
 // that otherwise look like a confident '1'. Require agreeing thresholds.
 const votes=[];
 for(const brightness of [500,510,520,530,540,550,560,570]){
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
module.exports={read,life,handCount};
