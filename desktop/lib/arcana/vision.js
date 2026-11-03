'use strict';
const RAW=require('./templates.json');
const DATA=require('./game-data.json');
const Digits=require('./digits');
const Captions=require('./captions');
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
// Most chest pixels are the same bronze shell. Compare the rarity stripe
// independently; its rainbow variant otherwise has a small full-image margin
// even with a nearly perfect (> .96) match.
const chestRarityTemplates=(()=>{
 const raw=RAW.signatures.filter(t=>t.kind==='chest'&&/0[1-6]$/.test(t.name)),points=[];
 if(raw.length!==6)return [];
 const pixels=raw.map(t=>Buffer.from(t.pixels,'base64')),w=raw[0].width,h=raw[0].height,rank=[];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=(y*w+x)*4;if(pixels.some(p=>p[i+3]<215))continue;
  let variance=0;for(let c=0;c<3;c++){const values=pixels.map(p=>p[i+c]),mean=values.reduce((a,b)=>a+b,0)/6;variance+=values.reduce((n,v)=>n+(v-mean)**2,0);}rank.push({x,y,variance});
 }
 rank.sort((a,b)=>b.variance-a.variance);for(const p of rank){if(p.variance<1500||points.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<1.6))continue;points.push(p);if(points.length===48)break;}
 return raw.map((t,j)=>{let sum=0,square=0;const vector=new Float64Array(points.length*5);points.forEach((p,k)=>{const i=(p.y*w+p.x)*4,rgb=[pixels[j][i],pixels[j][i+1],pixels[j][i+2]];vector.set([(p.x+.5)/w,(p.y+.5)/h,...rgb],k*5);for(const v of rgb){sum+=v;square+=v*v;}});const n=points.length*3;return {name:t.name,vector,n,mean:sum/n,norm:Math.sqrt(Math.max(1,square-sum*sum/n))};});
})();
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
const tileCardIds=new Map();
for(const [id,t]of Object.entries(DATA.tiles))if(t.type===1&&/^UI_S9Gameplay_Card_/.test(t.icon)){const ids=tileCardIds.get(t.icon)||[];ids.push(Number(id));tileCardIds.set(t.icon,ids);}
const tileCardTemplates=RAW.signatures.filter(t=>tileCardIds.has(t.name)).flatMap(t=>{
 const base=features({...t,fullFace:true});return [-18,-9,0,9,18].map(angle=>{
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),vector=base.vector.slice();for(let i=0;i<vector.length;i+=5){const x=vector[i]-.5,y=vector[i+1]-.5;vector[i]=.5+c*x-s*y/base.aspect;vector[i+1]=.5+s*x*base.aspect+c*y;}return {...base,vector,angle};
 });
});
function refineTile(img,match){
 const group=tileGroups.find(g=>g.some(t=>t.name===match?.name));if(!group)return match;
 const ranks=group.map(t=>{let score=-1,box=null;for(const scale of [.90,.95,1,1.05,1.10])for(const dx of [-3,0,3])for(const dy of [-3,0,3]){const b={x:match.box.x+dx,y:match.box.y+dy,w:match.box.w*scale,h:match.box.h*scale},s=fit(img,t,b);if(s>score){score=s;box=b;}}return {name:t.name,score,box};}).sort((a,b)=>b.score-a.score);
 return {...ranks[0],margin:ranks[0].score-ranks[1].score,shapeScore:match.score,digitScore:ranks[0].score};
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
  if(best.kind==='card'){
   for(let pass=0;pass<2;pass++){let improved=best;for(const dw of [.99,1,1.01])for(const dx of [-1,0,1])for(const dy of [-1,0,1]){const box={x:best.box.x+dx,y:best.box.y+dy,w:best.box.w*dw,h:best.box.w*dw/best.t.aspect},score=fit(img,best.t,box);if(score>improved.score)improved={...best,box,score};}best=improved;}
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
 let candidateDie=refill.filter(x=>x.score>.88).sort((a,b)=>b.box.x-a.box.x)[0];
 const region=ratio(img,.12,.76,.68,.16);if(candidateDie)region.w=Math.min(region.w,candidateDie.box.x-img.width*.12-candidateDie.box.w*.3);
 let hand=topMatches(img,ts,region,widths,{stride:Math.max(4,Math.round(H/110)),coarseThreshold:.64,threshold:.88,limit:22}).map(m=>refinePips(img,m));
 let fallbackCounter=null,fallbackCount=null;
 // At some capture-border phases both coarse face searches miss their narrow
 // peaks. The independent x/10 counter still anchors the row: retry this small
 // band at a fine stride rather than waiting forever for a coarse face anchor.
 if(!hand.length&&!candidateDie){
  fallbackCounter=topMatches(img,byKind('hand-count'),ratio(img,.38,.80,.24,.075),[.010,.013,.016,.020,.024].map(v=>v*H),{stride:2,threshold:.88,coarseThreshold:.5,limit:3}).sort((a,b)=>b.score-a.score)[0]||null;
  fallbackCount=fallbackCounter?Digits.handCount(img,{x:fallbackCounter.box.x+fallbackCounter.box.w*.95,y:fallbackCounter.box.y-fallbackCounter.box.h*.5,w:fallbackCounter.box.w*5,h:fallbackCounter.box.h*2}):null;
  if(fallbackCounter&&fallbackCount){
   const w=fallbackCounter.box.w,anchor=H*.1035,center=fallbackCounter.box.x+w*2.2,half=anchor*(.9+Math.max(0,fallbackCount.value-1)*.4),y=fallbackCounter.box.y+H*.030;
   const fine=widths,band={x:Math.max(img.width*.12,center-half),y,w:Math.min(img.width*.68,half*2),h:H*.035};
   if(fallbackCount.value>0)hand=topMatches(img,ts,band,fine,{stride:3,coarseThreshold:.64,threshold:.89,limit:22}).map(m=>refinePips(img,m));
   const dice=topMatches(img,refillTemplates,{x:img.width*.60,y,w:img.width*.37,h:band.h},fine,{stride:3,coarseThreshold:.64,threshold:.89,limit:6});
   candidateDie=dice.filter(m=>m.margin>=.025).sort((a,b)=>b.box.x-a.box.x)[0]||null;
  }
 }
 // A coarse stride can miss the narrow correlation peak of small card faces.
 // Retry only their already located row, keeping the confidence thresholds.
 if((hand.length||candidateDie)&&(!candidateDie||!hand.length||hand.some(m=>m.score<.89||m.margin<.025))){
  const anchors=hand.length?hand:[candidateDie],y=Math.min(...anchors.map(m=>m.box.y)),band={...region,y:y-H*.006,h:Math.max(...anchors.map(m=>m.box.y))-y+H*.018};
  const anchor=anchors.slice().sort((a,b)=>b.score-a.score)[0].box.w,fine=[.94,.97,1,1.03].map(v=>v*anchor);
  const detailed=topMatches(img,ts,band,fine,{stride:3,coarseThreshold:.64,threshold:.89,limit:22}).map(m=>refinePips(img,m));
  for(const old of hand){const index=detailed.findIndex(m=>Math.abs(m.box.x-old.box.x)<Math.max(m.box.w,old.box.w)*.5);if(index<0)detailed.push(old);else if(old.score>detailed[index].score&&old.margin>=.025)detailed[index]=old;}
  hand=detailed.sort((a,b)=>a.box.x-b.box.x);
  const dice=topMatches(img,refillTemplates,{x:img.width*.60,y:band.y,w:img.width*.37,h:band.h},fine,{stride:3,coarseThreshold:.64,threshold:.89,limit:6});
  candidateDie=dice.filter(m=>m.margin>=.025).sort((a,b)=>b.box.x-a.box.x)[0]||candidateDie;
 }
 // Odd-pip refill cards have a narrower full-face correlation peak. At some
 // pixel phases the coarse full-face pass misses them even though the visible
 // face and all distinguishing pips were read confidently in the hand pass.
 // Recover only a separate right-hand slot: a normal last hand card must not
 // become a refill merely because its icon is also a movement card.
 if(!candidateDie&&hand.length>=2){
  const right=hand.at(-1),previous=hand.at(-2);
  if(/^UI_S9Gameplay_Card_2[0-5]$/.test(right.name)&&right.score>=.89&&right.margin>=.025&&right.pipScore>=.90&&
   right.box.x>img.width*.68&&right.box.x-previous.box.x>Math.max(right.box.w,previous.box.w)*1.8&&
   Math.abs(right.box.y-previous.box.y)<right.box.w*.12&&Math.abs(right.box.w/previous.box.w-1)<.2)candidateDie=right;
 }
 if(candidateDie)hand=hand.filter(m=>m.box.x<candidateDie.box.x-candidateDie.box.w*.3);
 const ids=[];let confident=true;
 for(const got of hand){
  const choices=DATA.cards.filter(c=>c.icon===got.name&&c.tag!==99&&c.selection>0);
  if(choices.length===1&&got.score>=.89&&got.margin>=.025)ids.push(choices[0].id);else confident=false;
 }
 const die=refinePips(img,candidateDie),top=hand.length?Math.min(...hand.map(m=>m.box.y)):H*.9,center=hand.length?(hand[0].box.x+hand.at(-1).box.x+hand.at(-1).box.w)/2:img.width*.5;
 const countIcon=topMatches(img,byKind('hand-count'),{x:center-img.width*.1,y:top-H*.1,w:img.width*.2,h:H*.075},[.010,.013,.016,.020,.024].map(v=>v*H),{stride:2,threshold:.88,coarseThreshold:.5,limit:3}).sort((a,b)=>b.score-a.score)[0]||fallbackCounter;
 const count=countIcon?Digits.handCount(img,{x:countIcon.box.x+countIcon.box.w*.95,y:countIcon.box.y-countIcon.box.h*.5,w:countIcon.box.w*5,h:countIcon.box.h*2}):null;
 const gaps=hand.slice(1).map((m,i)=>m.box.x-hand[i].box.x),regular=gaps.length<2||Math.max(...gaps)<=Math.min(...gaps)*1.45;
 const centered=!countIcon||!hand.length||Math.abs(center-countIcon.box.x-countIcon.box.w*2.2)<=Math.max(...hand.map(m=>m.box.w))*.35;
 return {hand:ids,handMatches:hand,handConfident:confident&&(hand.length>0||count?.value===0)&&hand.length<=10&&regular&&centered&&(!count||count.value===ids.length),handCount:count?.value??null,counterMatch:countIcon||null,rowRegular:regular,rowCentered:centered,die:die&&die.score>=.88&&die.margin>=.025?Number(die.name.slice(-2))-19:null,dieMatch:die||null};
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
 const other=ranks.find(candidate=>candidate.name!==best.name);
 return {name:best.name,score:best.score,margin:best.score-(other?.score||0),box:best.box};
}
function tileAt(img,p,width){
 const chest=matchAt(img,byKind('chest'),p.x,p.y-width*.28,[.62,.74,.86].map(n=>n*width));
 if(chest&&chest.score>.84&&chest.margin>.04){const tier=Number(chest.name.slice(-2));if(tier>0&&tier<=6)return {tile:{kind:'chest',tier},confidence:chest.score};}
 const effect=refineTile(img,matchAt(img,byKind('tile').filter(t=>/Dikuai/.test(t.name)),p.x,p.y-width*.43,[.55,.61,.67,.73,.79,.85,.91,.97,1.03].map(n=>n*width)));
 // Shape correlation and the small number-only signature use different pixel
 // sets. A good +1 shape must not fail merely because the digit's independent
 // correlation is below the full-shape threshold. Require both tests instead.
 if(effect&&(effect.digitScore===undefined?effect.score>.88:effect.shapeScore>.88&&effect.digitScore>.80&&effect.margin>.04)){
  let tile=null;const hp=/Dikuaihp0([1-3])$/.exec(effect.name),movement=/DikuaiCard00([1-3])$/.exec(effect.name),upgrade=/DikuaiCard0([1-4])$/.exec(effect.name);
  if(hp)tile={kind:'heal',amount:Number(hp[1])};
  else if(movement)tile={kind:'effect',id:1020+Number(movement[1])};
  else if(upgrade)tile={kind:'effect',id:1100+Number(upgrade[1])};
  // Heal textures share their glow: require the winning number too, rather
  // than accepting a high score from the common halo alone.
  if(tile&&effect.margin>.02)return {tile,confidence:effect.score};
 }
 const question=matchAt(img,byKind('tile').filter(t=>/SHIJIAN0[12]$/.test(t.name)),p.x,p.y-width*.45,[.20,.28,.36,.44,.52,.62].map(n=>n*width));
 if(question?.name.endsWith('SHIJIAN01')&&question.score>.80&&question.margin>.04)return {tile:{kind:'random'},confidence:question.score};
 let note=null;for(const offset of [.30,.45]){const got=matchAt(img,tileCardTemplates,p.x,p.y-width*offset,[.24,.32,.40,.48,.56].map(n=>n*width));if(!note||got.score>note.score)note=got;}
 if(note?.score>.88&&note.margin>.035){
  const ids=tileCardIds.get(note.name)||[];
  if(ids.length===1)return {tile:{kind:'effect',id:ids[0]},confidence:note.score};
  const amount=/Card_35$/.test(note.name)?1:/Card_08$/.test(note.name)?2:3;
  return {tile:{kind:'note',amount,icon:note.name,candidates:ids},confidence:note.score,uncertainOutcome:true};
 }
 return {tile:null,confidence:0,unclear:question?.score>.52||effect?.score>.80||note?.score>.72};
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
function findLife(img,bases){
 if(bases?.length>=8){
  const candidates=[];
  for(const base of bases){const b=base.box,p={x:b.x+b.w/2,y:b.y+b.h/2},w=b.w;
   candidates.push(...topMatches(img,byKind('life'),{x:p.x-w*.22,y:p.y-w*1.08,w:w*.36,h:w*.36},[.12,.14,.16,.18,.20].map(n=>n*w),{stride:Math.max(2,Math.round(w/40)),coarseThreshold:.60,threshold:.88,limit:1}));
  }
  candidates.sort((a,b)=>b.score-a.score);const first=candidates[0],other=candidates.find(m=>Math.hypot(m.box.x-first.box.x,m.box.y-first.box.y)>first.box.w*2);
  if(first&&first.score-(other?.score||0)>.04)return first;
 }
 return topMatches(img,byKind('life'),ratio(img,.12,.08,.67,.68),[.014,.016,.019,.021,.024,.027].map(v=>v*img.height),{stride:Math.max(3,Math.round(img.height/210)),coarseThreshold:.60,threshold:.86,limit:8}).sort((a,b)=>b.score-a.score)[0]||null;
}
function chestLevel(img,box){
 const rect={x:box.x+box.w*.5,y:box.y+box.h,w:box.w*.36,h:box.w*.35};
 // LV.6 is orange, unlike the blue/white life count. Its high saturation is
 // valid text, not a reason to erase the entire rainbow inventory entry.
 const values=[300,350,400,450,500].map(brightness=>Digits.read(img,rect,{brightness,saturation:255,lastDigit:true,minMargin:.025})).filter(r=>r&&r.value>=1&&r.value<=6);
 if(values.length>=2&&values.every(v=>v.value===values[0].value))return {value:values[0].value,confidence:Math.min(...values.map(v=>v.confidence))};
 return null;
}
function collected(img){
 const scale=img.height/2250;
 const slots=Array.from({length:7},(_,i)=>({x:(i%2?286.08:113.28)*scale,y:img.height/2+(-167.04+[0,105.6,209.28,314.88,420.48,526.08,629.76][i])*scale}));
 // The reward chain has fixed UMG slots. Search each slot's small pose band,
 // retaining the original shape, stripe and level checks below.
 const width=img.height*.075,aspect=byKind('chest')[0].aspect,matches=[];
 for(const p of slots)matches.push(...topMatches(img,byKind('chest'),{x:p.x-width*.65,y:p.y-width/aspect*.5-width*.15,w:width*.30,h:width*.30},[.07,.075,.08].map(v=>v*img.height),{stride:2,coarseThreshold:.52,threshold:.82,limit:3}));
 const aligned=[];
 for(const m of matches){
  const b=m.box,cx=b.x+b.w/2,cy=b.y+b.h/2;
  const near=slots.map((p,i)=>({i,d:Math.hypot((p.x-cx)/b.w,(p.y-cy)/b.w)})).sort((a,b)=>a.d-b.d)[0];
  if(near.d>.5)continue;
  const level=chestLevel(img,b);
  const stripe=chestRarityTemplates.map(t=>({name:t.name,score:fit(img,t,b)})).sort((a,b)=>b.score-a.score),a=stripe[0],second=stripe[1];
  const iconTier=Number(m.name.slice(-2)),stripeTier=a?Number(a.name.slice(-2)):0;
  const stripeSure=a?.score>.86&&a.score-(second?.score||0)>.055;
  const levelSure=level&&level.value>=1&&level.value<=6&&(level.value===iconTier||stripeSure&&level.value===stripeTier);
  // The level can update before the chest art finishes its upgrade animation.
  // A clear contradictory digit is evidence to wait, not permission to report
  // the old rarity just because its shell still matches strongly.
  const conflict=!!level&&level.confidence>=.8&&level.value!==iconTier&&(!stripeSure||level.value!==stripeTier);
  const sure=!conflict&&m.score>.82&&(m.margin>.05||levelSure||stripeSure&&stripeTier===iconTier);
  const got={...m,slot:near.i,tier:levelSure?level.value:iconTier,sure,conflict,level:level||null,stripe:a?{tier:stripeTier,score:a.score,margin:a.score-(second?.score||0),sure:stripeSure}:null};
  const previous=aligned.findIndex(v=>v.slot===near.i);if(previous<0)aligned.push(got);else if(got.score>aligned[previous].score)aligned[previous]=got;
 }
 aligned.sort((a,b)=>a.slot-b.slot);
 const found=aligned.filter(m=>m.sure&&m.tier>=1&&m.tier<=6),contiguous=found.every((m,i)=>m.slot===i);
 const caption=found.length===0?Captions.read(img):null,emptyEvidence=aligned.length===0&&caption?.text==='Abandon Contest'?{kind:'game_give_up_caption',...caption}:null;
 return {tiers:found.map(m=>m.tier),confident:!!emptyEvidence||aligned.length===found.length&&found.length>0&&found.length<=7&&contiguous,conflicting:aligned.some(m=>m.conflict),matches:aligned,rawMatches:matches,emptyEvidence};
}
const offerTemplates=RAW.signatures.filter(t=>t.kind==='card'&&activeIcons.has(t.name)).map(t=>features({...t,fullFace:true}));
function offers(img){
 // The normal 3-note offer and the 6-note horizontal list have fixed poses.
 // Search those small bands first; retain full-frame search for other layouts.
 let matches=[];const H=img.height,W=img.width;
 for(const offsets of [[-.312,-.012,.288],[-.43,-.13,.17,.47]]){
  const found=[];for(const offset of offsets){const x=W/2+offset*H,w=H*.225;found.push(...topMatches(img,offerTemplates,{x:x-w/2-H*.016,y:H*.278,w:H*.032,h:H*.044},[.215,.225,.235].map(n=>n*H),{stride:3,coarseThreshold:.65,threshold:.91,limit:2}));}
  if(found.length>=3){matches=found;break;}
 }
 if(matches.length<3)matches=topMatches(img,offerTemplates,ratio(img,.12,.15,.76,.48),[.12,.16,.20,.225,.24,.28].map(v=>v*img.height),{stride:Math.max(5,Math.round(img.height/110)),coarseThreshold:.65,threshold:.91,limit:12});
 matches=matches.map(m=>refinePips(img,m));
 let group=[];
 for(const m of matches){const row=matches.filter(n=>Math.abs(n.box.y-m.box.y)<img.height*.035&&Math.abs(n.box.w/m.box.w-1)<.15);if(row.length>group.length)group=row;}
 group.sort((a,b)=>a.box.x-b.box.x);const ids=[];let confident=group.length>=1;
 for(const m of group){const choices=DATA.cards.filter(c=>c.tag!==99&&c.selection>0&&c.icon===m.name);if(choices.length!==1||m.score<.92||m.margin<.025)confident=false;else ids.push(choices[0].id);}
 return {cards:ids,confident:confident&&ids.length===group.length&&ids.length<=10,matches:group};
}
module.exports={templates,features,sample,fit,topMatches,cards,chestAt,matchAt,tileAt,refineTile,refinePips,findBases,findTileCenters,findLife,collected,offers,ratio};
