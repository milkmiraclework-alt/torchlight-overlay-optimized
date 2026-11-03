'use strict';
const signatures=require('./captions.json').signatures;
function read(img,debug=false){
 const H=img.height,x0=0,y0=Math.floor(H*.285),w=Math.min(img.width,Math.ceil(H*.20)),h=Math.ceil(H*.105),votes=[],attempts=[];
 for(const brightness of [275,300,325,350,375,400,450,500]){
  const mask=new Uint8Array(w*h),rows=new Uint16Array(h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=((y0+y)*img.width+x0+x)*4,r=img.data[p],g=img.data[p+1],b=img.data[p+2];if(r+g+b>brightness&&Math.max(r,g,b)-Math.min(r,g,b)<130){mask[y*w+x]=1;rows[y]++;}}
  for(let y=0;y<h;){if(rows[y]<3){y++;continue;}const t=y;while(y<h&&rows[y]>=3)y++;const b=y-1;if(b-t<5||b-t>H*.035)continue;let l=w,r=-1,n=0;for(let yy=t;yy<=b;yy++)for(let x=0;x<w;x++)if(mask[yy*w+x]){l=Math.min(l,x);r=Math.max(r,x);n++;}const aspect=(r-l+1)/(b-t+1);if(aspect<5||aspect>13||n<30)continue;
   let bits='';for(let yy=0;yy<14;yy++)for(let x=0;x<80;x++){const a=Math.min(r,Math.floor(l+(x+.5)*(r-l+1)/80)),j=Math.min(b,Math.floor(t+(yy+.5)*(b-t+1)/14));bits+=mask[j*w+a]?'1':'0';}
   const best=new Map();for(const q of signatures){let hit=0,union=0;for(let i=0;i<bits.length;i++){const a=bits.charCodeAt(i)===49,c=q.bits.charCodeAt(i)===49;if(a||c)union++;if(a&&c)hit++;}const score=hit/Math.max(1,union)-Math.abs(Math.log(aspect/q.aspect))*.15;if(score>(best.get(q.text)??-1))best.set(q.text,score);}const rank=[...best].map(([text,score])=>({text,score})).sort((a,b)=>b.score-a.score);if(debug)attempts.push({brightness,rank,box:{x:l,y:y0+t,w:r-l+1,h:b-t+1}});if(rank[0]?.score>.60&&rank[0].score-rank[1].score>.08)votes.push({...rank[0],box:{x:l,y:y0+t,w:r-l+1,h:b-t+1}});
  }
 }
 if(debug)return attempts;
 if(votes.length<2||votes.some(v=>v.text!==votes[0].text))return null;
 return {...votes[0],score:Math.min(...votes.map(v=>v.score)),votes:votes.length};
}
module.exports={read};
