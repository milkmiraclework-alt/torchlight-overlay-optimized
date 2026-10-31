'use strict';
const glyphs=require('./digits.json').glyphs;
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
  const aspect=(box.r-box.l+1)/(box.b-box.t+1),rank=[];
  for(const g of glyphs){let hit=0,union=0;for(let i=0;i<bits.length;i++){const ref=g.bits.charCodeAt(i)===49;if(ref||bits[i])union++;if(ref&&bits[i])hit++;}const score=hit/Math.max(1,union)-Math.abs(Math.log(aspect/g.aspect))*.10;rank.push({digit:g.digit,score});}
  rank.sort((a,b)=>b.score-a.score);const first=rank[0],second=rank.find(g=>g.digit!==first.digit);
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
 return a&&a.count>=2&&a.count>(b?.count||0)?{value:a.value,confidence:a.confidence/a.count}:null;
}
module.exports={read,life};
