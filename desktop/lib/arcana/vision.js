'use strict';
const RAW=require('./templates.json');
const DATA=require('./game-data.json');
const Digits=require('./digits');
function features(template){
 const rgba=Buffer.from(template.pixels,'base64'),points=[],{width:w,height:h}=template;
 const card=template.kind==='card';
 // Adjacent hand cards overlap the right quarter. Their visible left/centre
 // face carries the die pips/arrows; sampling the covered edge misreads them.
 for(let y=card?6:1;y<(card?22:h-1);y+=2)for(let x=card?3:1;x<(card&&!template.fullFace?16:w-1);x+=2){
  const p=(y*w+x)*4;if(rgba[p+3]<215)continue;
  points.push({x:(x+.5)/w,y:(y+.5)/h,r:rgba[p],g:rgba[p+1],b:rgba[p+2]});
 }
 let sum=0,square=0;for(const p of points)for(const c of ['r','g','b']){sum+=p[c];square+=p[c]*p[c];}
 const n=points.length*3,mean=sum/n,norm=Math.sqrt(Math.max(1,square-sum*sum/n));
 const vector=new Float64Array(points.length*5);points.forEach((p,i)=>{vector.set([p.x,p.y,p.r,p.g,p.b],i*5);});
 let coarse=null;
 if(points.length>20){
  const ps=points.filter((p,i)=>i%Math.ceil(points.length/16)===0),v=new Float64Array(ps.length*5);let sum=0,square=0;
  ps.forEach((p,i)=>{v.set([p.x,p.y,p.r,p.g,p.b],i*5);for(const c of [p.r,p.g,p.b]){sum+=c;square+=c*c;}});
  const n=ps.length*3;coarse={vector:v,mean:sum/n,norm:Math.sqrt(Math.max(1,square-sum*sum/n)),n};
 }
 return {...template,points,vector,mean,norm,n,coarse};
}
const templates=RAW.signatures.map(features),byKind=kind=>templates.filter(t=>t.kind===kind);
const refillTemplates=RAW.signatures.filter(t=>t.kind==='card'&&/Card_2[0-5]$/.test(t.name)).map(t=>features({...t,fullFace:true}));
const activeIcons=new Set(DATA.cards.filter(c=>c.tag!==99&&c.selection>0).map(c=>c.icon));
const pipTemplates=(RAW.pipGroups||[]).flatMap(group=>group.templates.map(t=>{
 const points=group.points.map(([x,y],i)=>({x,y,r:t.rgb[i*3],g:t.rgb[i*3+1],b:t.rgb[i*3+2]})),sum=t.rgb.reduce((a,b)=>a+b,0),n=t.rgb.length,mean=sum/n,norm=Math.sqrt(Math.max(1,t.rgb.reduce((a,b)=>a+b*b,0)-sum*sum/n)),vector=new Float64Array(points.length*5);
 points.forEach((p,i)=>vector.set([p.x,p.y,p.r,p.g,p.b],i*5));return {...t,points,vector,mean,norm,n};
}));
const tileGroups=(RAW.tileGroups||[]).map(group=>group.templates.map(t=>{
 const points=group.points.map(([x,y],i)=>({x,y,r:t.rgb[i*3],g:t.rgb[i*3+1],b:t.rgb[i*3+2]})),sum=t.rgb.reduce((a,b)=>a+b,0),n=t.rgb.length,mean=sum/n,norm=Math.sqrt(Math.max(1,t.rgb.reduce((a,b)=>a+b*b,0)-sum*sum/n)),vector=new Float64Array(points.length*5);
 points.forEach((p,i)=>vector.set([p.x,p.y,p.r,p.g,p.b],i*5));return {...t,points,vector,mean,norm,n};
}));
function refineTile(img,match){
 const group=tileGroups.find(g=>g.some(t=>t.name===match?.name));if(!group)return match;
 const ranks=group.map(t=>{let score=-1,box=null;for(const scale of [.90,.95,1,1.05,1.10])for(const dx of [-3,0,3])for(const dy of [-3,0,3]){const b={x:match.box.x+dx,y:match.box.y+dy,w:match.box.w*scale,h:match.box.h*scale},s=fit(img,t,b);if(s>score){score=s;box=b;}}return {name:t.name,score,box};}).sort((a,b)=>b.score-a.score);
 return {...ranks[0],margin:ranks[0].score-ranks[1].score};
}
function refinePips(img,match){
 if(!match||!/Card_(?:1[1-6]|2[0-5])$/.test(match.name)||!pipTemplates.length)return match;
 const ranks=[];
 for(const t of pipTemplates){let best=-1,box=null;
  for(const scale of [.98,1,1.02])for(const dx of [-2,0,2])for(const dy of [-2,0,2]){const b={x:match.box.x+dx,y:match.box.y+dy,w:match.box.w*scale,h:match.box.w*scale/t.aspect},s=fit(img,t,b);if(s>best){best=s;box=b;}}
  ranks.push({t,score:best,box});
 }
 ranks.sort((a,b)=>b.score-a.score);const [a,b]=ranks;
 return a.score>.8?{...match,name:a.t.name,pipScore:a.score,margin:a.score-b.score,box:a.box}:match;
}
function sample(img,x,y){
 const {width:w,height:h,data}=img;if(x<0||y<0||x>w-1||y>h-1)return null;
 const a=Math.floor(x),b=Math.floor(y),dx=x-a,dy=y-b,ix=(b*w+a)*4,jx=(b*w+Math.min(w-1,a+1))*4,kx=(Math.min(h-1,b+1)*w+a)*4,lx=(Math.min(h-1,b+1)*w+Math.min(w-1,a+1))*4;
 return [0,1,2].map(c=>(data[ix+c]*(1-dx)+data[jx+c]*dx)*(1-dy)+(data[kx+c]*(1-dx)+data[lx+c]*dx)*dy);
}
function fit(img,t,box){
 let sum=0,square=0,cross=0;const w=box.w,h=box.h,W=img.width,H=img.height,d=img.data,p=t.vector;
 for(let i=0;i<p.length;i+=5){
  const x=box.x+p[i]*w-.5,y=box.y+p[i+1]*h-.5;
  if(x<0||y<0||x>W-1||y>H-1)return -1;
  const a=Math.floor(x),b=Math.floor(y),dx=x-a,dy=y-b,ix=(b*W+a)*4,jx=(b*W+Math.min(W-1,a+1))*4,kx=(Math.min(H-1,b+1)*W+a)*4,lx=(Math.min(H-1,b+1)*W+Math.min(W-1,a+1))*4;
  for(let c=0;c<3;c++){const v=(d[ix+c]*(1-dx)+d[jx+c]*dx)*(1-dy)+(d[kx+c]*(1-dx)+d[lx+c]*dx)*dy;sum+=v;square+=v*v;cross+=v*(p[i+2+c]-t.mean);}
 }
 const norm=Math.sqrt(Math.max(1,square-sum*sum/t.n));return cross/(norm*t.norm);
}
function topMatches(img,ts,region,widths,{stride=8,threshold=.74,coarseThreshold=threshold,limit=24}={}){
 const matches=[];
 for(const w of widths){
  const step=Math.max(2,stride),local=[];
  for(let y=region.y;y<region.y+region.h;y+=step)for(let x=region.x;x<region.x+region.w;x+=step){
   let best=null;
   for(const t of ts){const box={x,y,w,h:w/t.aspect};if(t.coarse&&fit(img,t.coarse,box)<coarseThreshold-.22)continue;const score=fit(img,t,box);if(score>=coarseThreshold&&(!best||score>best.score))best={name:t.name,kind:t.kind,score,box,t};}
   if(best)local.push(best);
  }
  local.sort((a,b)=>b.score-a.score);
  const kept=[];
  for(const m of local){if(kept.some(o=>Math.abs(o.box.x-m.box.x)<w*.5&&Math.abs(o.box.y-m.box.y)<w*.55))continue;kept.push(m);if(kept.length>=limit)break;}
  // Do not suppress another scale before its pose is refined. A slightly
  // misplaced small card can beat the true card at coarse resolution.
  matches.push(...kept);
 }
 matches.sort((a,b)=>b.score-a.score);
 const refined=[];
 for(const m of matches){
  let best=m;
  for(const dw of [-.06,0,.06])for(let dy=-stride;dy<=stride;dy+=2)for(let dx=-stride;dx<=stride;dx+=2){
   const box={x:m.box.x+dx,y:m.box.y+dy,w:m.box.w*(1+dw),h:m.box.w*(1+dw)/m.t.aspect},score=fit(img,m.t,box);
   if(score>best.score)best={...m,box,score};
  }
  const ranking=ts.map(t=>({t,score:fit(img,t,{...best.box,h:best.box.w/t.aspect})})).sort((a,b)=>b.score-a.score);
  const first=ranking[0],second=ranking[1];
  if(first.score<threshold)continue;
  const got={name:first.t.name,kind:first.t.kind,score:first.score,margin:first.score-(second?.score??0),box:{...best.box,h:best.box.w/first.t.aspect}};
  const overlap=refined.findIndex(o=>Math.abs(o.box.x+o.box.w/2-got.box.x-got.box.w/2)<Math.max(o.box.w,got.box.w)*.6&&Math.abs(o.box.y-got.box.y)<Math.max(o.box.w,got.box.w)*.6);
  if(overlap<0)refined.push(got);else if(got.score>refined[overlap].score)refined[overlap]=got;
 }
 return refined.sort((a,b)=>a.box.x-b.box.x);
}
const ratio=(img,x,y,w,h)=>({x:x*img.width,y:y*img.height,w:w*img.width,h:h*img.height});
function cards(img){
 const H=img.height,ts=byKind('card').filter(t=>activeIcons.has(t.name)),widths=[.083,.1035,.133,.154].map(v=>v*H);
 const refill=topMatches(img,refillTemplates,ratio(img,.60,.76,.37,.17),[.083,.1035,.11,.133,.136,.143,.154].map(v=>v*H),{stride:Math.max(4,Math.round(H/110)),threshold:.82,limit:6});
 const candidateDie=refill.filter(x=>x.score>.88).sort((a,b)=>b.box.x-a.box.x)[0];
 const region=ratio(img,.12,.76,.68,.16);if(candidateDie)region.w=Math.min(region.w,candidateDie.box.x-img.width*.12-candidateDie.box.w*.3);
 const hand=topMatches(img,ts,region,widths,{stride:Math.max(4,Math.round(H/110)),coarseThreshold:.64,threshold:.88,limit:22}).map(m=>refinePips(img,m));
 const ids=[];let confident=true;
 for(const got of hand){
  const choices=DATA.cards.filter(c=>c.icon===got.name&&c.tag!==99&&c.selection>0);
  if(choices.length===1&&got.score>=.89&&got.margin>=.025)ids.push(choices[0].id);else confident=false;
 }
 const die=refinePips(img,candidateDie),top=hand.length?Math.min(...hand.map(m=>m.box.y)):H*.9,center=hand.length?(hand[0].box.x+hand.at(-1).box.x+hand.at(-1).box.w)/2:img.width*.5;
 const countIcon=topMatches(img,byKind('hand-count'),{x:center-img.width*.1,y:top-H*.1,w:img.width*.2,h:H*.075},[.010,.013,.016,.020,.024].map(v=>v*H),{stride:2,threshold:.88,coarseThreshold:.5,limit:3}).sort((a,b)=>b.score-a.score)[0];
 const count=countIcon?Digits.read(img,{x:countIcon.box.x+countIcon.box.w*1.4,y:countIcon.box.y,w:countIcon.box.w*1.05,h:countIcon.box.h*1.1}):null;
 return {hand:ids,handMatches:hand,handConfident:confident&&hand.length>0&&hand.length<=10&&(!count||count.value===ids.length),handCount:count?.value??null,die:die&&die.score>=.88&&die.margin>=.025?Number(die.name.slice(-2))-19:null,dieMatch:die||null};
}
function chestAt(img,x,y,width){
 const ts=byKind('chest'),rank=[];
 for(const w of [width*.88,width,width*1.12])for(const dx of [-.12,0,.12])for(const dy of [-.1,0,.1])for(const t of ts){
  const box={x:x-w/2+width*dx,y:y-w/t.aspect/2+width*dy,w,h:w/t.aspect},score=fit(img,t,box);rank.push({name:t.name,score,box});
 }
 rank.sort((a,b)=>b.score-a.score);const first=rank[0],other=rank.find(x=>x.name!==first.name);
 if(!first||first.score<.78||first.score-(other?.score||0)<.025)return null;
 const tier=Number(first.name.slice(-2));return tier>=1&&tier<=6?{kind:'chest',tier,conf:first.score,box:first.box}:null;
}
function matchAt(img,ts,x,y,widths){
 const ranks=[];
 for(const t of ts){let best={score:-1};for(const w of widths)for(const dx of [-.10,0,.10])for(const dy of [-.12,0,.12]){const box={x:x-w/2+w*dx,y:y-w/t.aspect/2+w*dy,w,h:w/t.aspect},score=fit(img,t,box);if(score>best.score)best={name:t.name,score,box,t};}ranks.push(best);}
 ranks.sort((a,b)=>b.score-a.score);if(!ranks.length)return null;
 const first=ranks[0];let best=first;
 for(const scale of [.97,1,1.03])for(let dx=-3;dx<=3;dx++)for(let dy=-3;dy<=3;dy++){
  const box={x:first.box.x+dx,y:first.box.y+dy,w:first.box.w*scale,h:first.box.h*scale},score=fit(img,first.t,box);if(score>best.score)best={...first,score,box};
 }
 return {name:best.name,score:best.score,margin:best.score-(ranks[1]?.score||0),box:best.box};
}
function tileAt(img,p,width){
 const chest=matchAt(img,byKind('chest'),p.x,p.y-width*.28,[.62,.74,.86].map(n=>n*width));
 if(chest&&chest.score>.84&&chest.margin>.04){const tier=Number(chest.name.slice(-2));if(tier>0&&tier<=6)return {tile:{kind:'chest',tier},confidence:chest.score};}
 const effect=refineTile(img,matchAt(img,byKind('tile').filter(t=>/Dikuai/.test(t.name)),p.x,p.y-width*.43,[.65,.83,1].map(n=>n*width)));
 if(effect?.score>.88){
  let tile=null;const hp=/Dikuaihp0([1-3])$/.exec(effect.name),movement=/DikuaiCard00([1-3])$/.exec(effect.name),upgrade=/DikuaiCard0([1-4])$/.exec(effect.name);
  if(hp)tile={kind:'heal',amount:Number(hp[1])};
  else if(movement)tile={kind:'effect',id:1020+Number(movement[1])};
  else if(upgrade)tile={kind:'effect',id:1100+Number(upgrade[1])};
  // Heal textures share their glow: require the winning number too, rather
  // than accepting a high score from the common halo alone.
  if(tile&&effect.margin>.02)return {tile,confidence:effect.score};
 }
 const question=matchAt(img,byKind('tile').filter(t=>/SHIJIAN01$/.test(t.name)),p.x,p.y-width*.45,[.20,.24,.30,.36].map(n=>n*width));
 if(question?.score>.80)return {tile:{kind:'random'},confidence:question.score};
 return {tile:null,confidence:0,unclear:question?.score>.52||effect?.score>.80};
}
function findBases(img){
 const holes=findTileCenters(img);
 if(holes.length>=8)return holes;
 return topMatches(img,byKind('base'),ratio(img,.14,.07,.67,.70),[.075,.09,.105,.12,.135].map(v=>v*img.height),{stride:Math.max(4,Math.round(img.height/140)),threshold:.84,coarseThreshold:.64,limit:40});
}
function findTileCenters(img){
 // The black centre of a tile survives active/inactive colours, particle
 // effects and outline overlays. Connected components avoid a costly full
 // screen multi-scale search for every decoration/state of the tile base.
 const step=Math.max(2,Math.floor(img.height/430)),w=Math.ceil(img.width/step),h=Math.ceil(img.height/step),mask=new Uint8Array(w*h),queue=new Int32Array(w*h),out=[];
 for(let y=Math.floor(h*.07);y<h*.75;y++)for(let x=Math.floor(w*.12);x<w*.88;x++){
  const i=(y*step*img.width+x*step)*4,r=img.data[i],g=img.data[i+1],b=img.data[i+2];if(r<42&&g<36&&b<48&&b<2*r+16)mask[y*w+x]=1;
 }
 for(let i=0;i<mask.length;i++)if(mask[i]){
  let n=1,k=0,x0=w,y0=h,x1=0,y1=0,sx=0,sy=0;queue[0]=i;mask[i]=0;
  while(k<n){const j=queue[k++],x=j%w,y=Math.floor(j/w);sx+=x;sy+=y;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
   for(const a of [j-1,j+1,j-w,j+w])if(a>=0&&a<mask.length&&mask[a]){mask[a]=0;queue[n++]=a;}
  }
  const bw=(x1-x0+1)*step,bh=(y1-y0+1)*step,fill=n/((x1-x0+1)*(y1-y0+1));
  if(bw<img.height*.027||bw>img.height*.055||bh<img.height*.012||bh>img.height*.035||bw/bh<1.45||bw/bh>2.5||fill<.53)continue;
  const width=bw/.31,height=width/1.3667,cx=sx/n*step,cy=sy/n*step;
  out.push({name:'tile-centre',kind:'base',score:.95,box:{x:cx-width/2,y:cy-height/2,w:width,h:height}});
 }
 return out;
}
function findLife(img){
 return topMatches(img,byKind('life'),ratio(img,.12,.08,.67,.68),[.014,.016,.019,.021,.024,.027].map(v=>v*img.height),{stride:Math.max(3,Math.round(img.height/210)),coarseThreshold:.60,threshold:.86,limit:8}).sort((a,b)=>b.score-a.score)[0]||null;
}
function collected(img){
 const matches=topMatches(img,byKind('chest'),ratio(img,0,.27,.16,.56),[.045,.06,.075,.09,.105].map(v=>v*img.height),{stride:Math.max(3,Math.round(img.height/215)),coarseThreshold:.52,threshold:.82,limit:14});
 const found=matches.filter(m=>m.score>.82&&m.margin>.05&&Number(m.name.slice(-2))>=1);
 found.sort((a,b)=>a.box.y-b.box.y);return {tiers:found.map(m=>Number(m.name.slice(-2))),confident:matches.length===found.length&&found.length>0&&found.length<=7,matches};
}
const offerTemplates=RAW.signatures.filter(t=>t.kind==='card'&&activeIcons.has(t.name)).map(t=>features({...t,fullFace:true}));
function offers(img){
 const matches=topMatches(img,offerTemplates,ratio(img,.12,.15,.76,.48),[.12,.16,.20,.24,.28].map(v=>v*img.height),{stride:Math.max(5,Math.round(img.height/110)),coarseThreshold:.65,threshold:.91,limit:12}).map(m=>refinePips(img,m));
 let group=[];
 for(const m of matches){const row=matches.filter(n=>Math.abs(n.box.y-m.box.y)<img.height*.035&&Math.abs(n.box.w/m.box.w-1)<.15);if(row.length>group.length)group=row;}
 group.sort((a,b)=>a.box.x-b.box.x);const ids=[];let confident=group.length>=1;
 for(const m of group){const choices=DATA.cards.filter(c=>c.tag!==99&&c.selection>0&&c.icon===m.name);if(choices.length!==1||m.score<.92||m.margin<.025)confident=false;else ids.push(choices[0].id);}
 return {cards:ids,confident:confident&&ids.length===group.length&&ids.length<=10,matches:group};
}
module.exports={templates,features,sample,fit,topMatches,cards,chestAt,matchAt,tileAt,refineTile,findBases,findTileCenters,findLife,collected,offers,ratio};
