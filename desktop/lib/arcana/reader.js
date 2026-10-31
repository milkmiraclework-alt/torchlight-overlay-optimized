'use strict';
const E=require('./engine'),V=require('./vision'),G=require('./geometry'),Digits=require('./digits');
const crypto=require('node:crypto');
const clone=v=>JSON.parse(JSON.stringify(v));
function imageKey(img){
 return `${img.width}x${img.height}:`+crypto.createHash('sha256').update(img.data).digest('hex');
}
function stats(img,box){
 let n=0,red=0,bright=0,purple=0,dimRed=0;for(let y=Math.max(0,Math.floor(box.y));y<Math.min(img.height,box.y+box.h);y+=2)for(let x=Math.max(0,Math.floor(box.x));x<Math.min(img.width,box.x+box.w);x+=2){const p=(y*img.width+x)*4,r=img.data[p],g=img.data[p+1],b=img.data[p+2];n++;if(r>g*1.5&&r>b*1.18&&r>160)red++;if(r>g*1.45&&r>b*.95&&r>55)dimRed++;if(r+g+b>550)bright++;if(b>r*1.3&&b>g*1.5&&b>180)purple++;}return {n,red:red/Math.max(1,n),dimRed:dimRed/Math.max(1,n),bright:bright/Math.max(1,n),purple:purple/Math.max(1,n)};
}
function patch(img,point,width){
 const vector=[];for(let y=0;y<16;y++)for(let x=0;x<12;x++){const rgb=V.sample(img,point.x+(x+.5-6)*width/12,point.y-width*1.04+(y+.5)*width*.83/16)||[0,0,0];const sum=rgb[0]+rgb[1]+rgb[2]+30;vector.push(rgb[0]/sum,rgb[1]/sum,rgb[2]/sum,Math.max(...rgb)/255);}return vector;
}
function patchScore(a,b){let err=0;for(let i=0;i<a.length;i++)err+=Math.abs(a[i]-b[i]);return 1-err/a.length;}
function scaleGrid(g,old,img){if(!g||!old)return g;const x=img.width/old.width,y=img.height/old.height;return {...g,origin:{x:g.origin.x*x,y:g.origin.y*y},u:{x:g.u.x*x,y:g.u.y*y},v:{x:g.v.x*x,y:g.v.y*y},width:g.width*x};}
function observation(img,p,width,corrections){
 const sign=patch(img,p,width),ranking=corrections.map(c=>({...c,score:patchScore(sign,c.vector)})).sort((a,b)=>b.score-a.score),best=ranking[0],other=ranking.find(c=>JSON.stringify(c.tile)!==JSON.stringify(best?.tile));
 if(best?.score>.96&&best.score-(other?.score||0)>.025)return {p,tile:clone(best.tile)};
 const visual=V.tileAt(img,p,width);if(visual.tile)return {p,tile:visual.tile};
 const s=stats(img,{x:p.x-width*.4,y:p.y-width*.95,w:width*.8,h:width*.6});
 if(s.red>.018&&s.bright>.035)return {p,tile:{kind:'trap',amount:1}};
 if(!visual.unclear&&s.bright<.006&&s.red<.003&&s.dimRed<.003)return {p,tile:{kind:'empty'}};
 return {p,tile:null};
}
const sameTile=(a,b)=>a?.used&&b?.kind==='empty'||a?.kind===b?.kind&&(a.kind!=='chest'||a.tier===b.tier)&&(a.kind!=='effect'||a.id===b.id)&&(!a.amount||!b.amount||a.amount===b.amount);
const semanticKey=s=>JSON.stringify([s.position,s.life,s.die,s.hand,s.chests,s.pending]);
function create(){
 let model=E.blank(),grid=null,previousSize=null,key=null,confirmedKey=null,corrections=[],lastFrame=null,newBoard=false,expectedKey=null,expectedState=null,currentPoint=null,observations=[],provisional=[],established=false,popup=null,alignmentNeedsRead=false;
 let settledCycle=false;
 function reset(fresh=false){model=E.blank();grid=null;key=null;confirmedKey=null;lastFrame=null;newBoard=fresh;expectedKey=null;expectedState=null;currentPoint=null;observations=[];provisional=[];established=false;popup=null;alignmentNeedsRead=false;settledCycle=false;}
 function read(img){
  const started=performance.now(),nextKey=imageKey(img);lastFrame=img;
  if(expectedKey&&nextKey===expectedKey){
   if(settledCycle){expectedKey=null;expectedState=null;settledCycle=false;model.confirmed=true;confirmedKey=key;return {model:clone(model),issues:[],unchanged:true,ms:performance.now()-started,grid};}
   return {model:clone(model),issues:['Waiting for the move to appear in the picture.'],waiting:true,ms:performance.now()-started};
  }
  expectedKey=null;
  if(!expectedState&&nextKey===confirmedKey)return {model:clone(model),issues:[],unchanged:true,ms:performance.now()-started,grid};
  const card=V.cards(img),bases=V.findBases(img),life=V.findLife(img),auto=G.grid(bases),issues=[];
  observations=[];
  if(auto){
   const lastRow=Math.min(5,Math.max(...bases.map(b=>G.cell(auto,G.center(b))).filter(i=>i!==null).map(i=>Math.floor(i/4))));
   for(let i=0;i<(lastRow+1)*4;i++){
    let p=G.at(auto,i);const nearest=bases.map(b=>G.center(b)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
    if(nearest&&Math.hypot(nearest.x-p.x,nearest.y-p.y)<auto.width*.15)p=nearest;
    if(p.x>img.width*.12&&p.x<img.width*.88&&p.y>img.height*.07&&p.y<img.height*.76)observations.push(observation(img,p,auto.width,corrections));
   }
  }
  grid=scaleGrid(grid,previousSize,img);previousSize={width:img.width,height:img.height};
  if(auto){
   if(grid){
    // Only translation is allowed between readings. A dragged/scrolled board
    // must retain several already known cells before its absolute row can be
    // trusted. Never copy a relative grid origin into an absolute board index.
    const candidates=[];
    for(let row=-6;row<=6;row++){
     const candidate={...auto,first:Math.max(0,grid.first+row*4),trusted:grid.trusted};let matches=0,compared=0;
     for(const o of observations){const i=G.cell(candidate,o.p);if(!o.tile||i===null||!model.path[i]||model.path[i].kind==='unknown')continue;compared++;if(sameTile(model.path[i],o.tile))matches++;}
     candidates.push({candidate,score:matches*2-(compared-matches)*3,matches,compared});
    }
    candidates.sort((a,b)=>b.score-a.score);const [best,second]=candidates;
    if(best.matches>=5&&best.compared-best.matches<=2&&best.score-(second?.score??0)>=3)grid=best.candidate;
    else if(Math.hypot(auto.origin.x-grid.origin.x,auto.origin.y-grid.origin.y)<grid.width*.25)grid={...auto,first:grid.first,trusted:grid.trusted};
    else{grid.trusted=false;issues.push('The path moved. Check the alignment and position.');}
   }else grid={...auto,trusted:newBoard};
  }
  const next=clone(model);next.confirmed=false;
  next.hand=card.hand;next.die=card.die;
  if(!card.handConfident)issues.push('Check the hand: one or more card faces are unclear.');
  if(card.die===null)issues.push('Check the refill die.');
  if(life){
   const number=Digits.life(img,{x:life.box.x+life.box.w*1.04,y:life.box.y-life.box.h*.1,w:life.box.w*1.7,h:life.box.h*1.2});
   next.life=number?.value??null;if(next.life===null)issues.push('Check remaining life.');
  }else{next.life=null;issues.push('The current tile / life marker is not clear.');}
  currentPoint=null;
  if(grid&&life){
   const badge=G.center(life),candidates=observations.filter(({p})=>Math.abs(p.x-badge.x)<grid.width*.5&&p.y-badge.y>grid.width*.55&&p.y-badge.y<grid.width*1.6).sort((a,b)=>(Math.abs(a.p.x-badge.x)+Math.abs(a.p.y-badge.y-grid.width*.85)*.3)-(Math.abs(b.p.x-badge.x)+Math.abs(b.p.y-badge.y-grid.width*.85)*.3));
   currentPoint=candidates[0]?.p||null;const position=currentPoint?G.cell(grid,currentPoint):null;
   if(position!==null&&position<next.path.length&&grid.trusted)next.position=position;else issues.push('Check the current tile / path alignment.');
  }else issues.push('Check the current tile / path alignment.');
  provisional=[];
  if(grid){
   for(const o of observations){const i=G.cell(grid,o.p);if(i===null||i>=next.path.length)continue;
    const isCurrent=currentPoint&&Math.hypot(currentPoint.x-o.p.x,currentPoint.y-o.p.y)<grid.width*.1;
    let tile=isCurrent?{kind:'empty',used:true}:o.tile||{kind:'unknown'};
    if(tile.kind==='empty'&&next.path[i]?.kind!=='unknown'&&next.path[i]?.kind!=='empty')tile={...next.path[i],used:true};
    next.path[i]=clone(tile);provisional.push({index:i,p:o.p,tile:clone(tile)});
   }
  }else issues.push('Align the visible path in Check board.');
  // The left reward chain uses fixed screen anchors. Read each of seven
  // slots independently; unrecognised decoration is not a green chest.
  const collected=V.collected(img),chests=collected.tiers,chestConfidence=collected.confident;
  next.chests=chests;if(!chestConfidence&&!(established&&model.chests.length===0&&chests.length===0))issues.push('Check collected chests.');
  if(chests.length<model.chests.length)issues.push('A collected chest disappeared from the reading. Check the reward chain.');
  if(grid?.trusted&&next.position!==model.position&&model.path[next.position]?.kind==='chest'&&!model.path[next.position].used&&model.chests.length<7&&chests.length<=model.chests.length)issues.push('A chest landing is not reflected in the reward chain.');
  if(!next.lengthConfirmed)issues.push('Confirm the total path length in Check board.');
  if(popup){
   const offered=V.offers(img);
   if(!offered.confident)issues.push('Check the offered cards in Board.');
   else{
    const sorted=xs=>xs.slice().sort((a,b)=>a-b).join(','),landed=model.path[next.position],copy=landed?.kind==='copy'&&!landed.used&&next.position!==model.position||model.pending?.kind==='copy'||sorted(offered.cards)===sorted(next.hand);
    next.pending={kind:copy?'copy':'choose',cards:copy?next.hand.slice():offered.cards};
    if(!copy){
     if(![3,6].includes(offered.cards.length))issues.push('The card offer looks incomplete. Check all offered notes in Board.');
     const sources=next.hand.flatMap((id,i)=>{const choices=E.CARDS.get(id).choices;return choices.length&&offered.cards.every(id=>choices.includes(id))?[i]:[];});
     if(sources.length){next.pending.source=sources[0];issues.push('Confirm which choice note is still in the hand, or select Already spent in Board.');}
    }
   }
  }else if(next.pending&&semanticKey({...next,pending:null})!==semanticKey({...model,pending:null}))next.pending=null;
  if(grid?.trusted&&next.life!==null&&next.die!==null){
   for(const a of E.actions(next)){
    let target=null;if(a.kind==='die')target=Math.min(next.path.length-1,next.position+next.die);
    else if(a.kind==='card'){const c=E.CARDS.get(a.selected??a.id),e=c.events.map(id=>E.DATA.events[id]).find(e=>e.fn===100&&e.a[0]===e.a[1]);if(e)target=Math.max(0,Math.min(next.path.length-1,next.position+e.a[0]));}
    if(target!==null&&target!==next.position&&next.path[target].kind==='unknown')issues.push(`Check tile ${target+1}: a current move can land there.`);
   }
  }
  const waiting=!!expectedState&&semanticKey(next)===expectedState&&!settledCycle;
  if(waiting)issues.push('Waiting for the move to finish. If it gave the same result, confirm the new picture.');
  else if(!issues.length){expectedState=null;settledCycle=false;}
  next.confirmed=issues.length===0;newBoard=false;
  model=next;key=nextKey;alignmentNeedsRead=false;
  return {model:clone(model),issues:[...new Set(issues)],waiting,ms:performance.now()-started,grid,cardMatches:card.handMatches,refill:card.dieMatch,bases:bases.length};
 }
 function correct(value){
  if(alignmentNeedsRead)throw Error('Read the screen after aligning the path, then check the new reading.');
  if(expectedKey)throw Error('The last picture still precedes the move. Read a new picture first.');
  if(lastFrame&&value.frameKey!==key)throw Error('The picture changed while you were editing. Read the new picture before confirming.');
  if(grid&&!grid.trusted&&!currentPoint)throw Error('The current marker was not read. Align the path and read the screen before confirming its tiles.');
  const next=E.normalize(value);
  if(!next.confirmed)throw Error('Check the confirmation box after correcting the reading.');
  const edited=next.path.flatMap((tile,i)=>tile.kind!=='unknown'&&JSON.stringify(tile)!==JSON.stringify(model.path[i])?[i]:[]);
  if(grid&&currentPoint){
   const local=G.cell({...grid,first:0},currentPoint),first=local===null?null:(Math.floor(next.position/4)-Math.floor(local/4))*4;
   if(first===null||first<0)throw Error('The position does not match the current marker. Check the tile number or align the path.');
   {
    const corrected={...grid,first,trusted:true};
    if(G.cell(corrected,currentPoint)!==next.position)throw Error('The position does not match the current marker. Check the tile number or align the path.');
    if(first!==grid.first){
     for(const o of provisional)if(!edited.includes(o.index)&&o.index<next.path.length)next.path[o.index]={kind:'unknown'};
     grid=corrected;
     for(const o of provisional){const i=G.cell(grid,o.p);if(i!==null&&i<next.path.length&&!edited.includes(i))next.path[i]=clone(o.tile);}
    }else grid=corrected;
   }
  }
  if(lastFrame&&grid){
   for(const i of edited){
    const local=i-grid.first;if(local<0)continue;const pt=G.at(grid,local);if(pt.x<0||pt.y<0||pt.x>lastFrame.width||pt.y>lastFrame.height)continue;
    corrections.push({tile:clone(next.path[i]),vector:patch(lastFrame,pt,grid.width)});
   }
   corrections=corrections.slice(-128);
  }
  model=next;established=true;confirmedKey=key;expectedState=null;settledCycle=false;return clone(model);
 }
 return {read,correct,reset,
  expectChange(){expectedKey=key;expectedState=semanticKey(model);model.confirmed=false;settledCycle=false;},
  settleCycle(){if(expectedState&&model.position===model.path.length-1)settledCycle=true;},
  setPopup(value){popup=value||null;confirmedKey=null;model.confirmed=false;settledCycle=false;if(!popup)model.pending=null;},
  calibrate(value){
   if(!lastFrame)throw Error('Read a picture before aligning the path.');
   const aligned=G.calibration(value,lastFrame);
   if(grid&&!grid.trusted)for(const o of provisional)if(JSON.stringify(model.path[o.index])===JSON.stringify(o.tile))model.path[o.index]={kind:'unknown'};
   grid=aligned;confirmedKey=null;model.confirmed=false;currentPoint=null;provisional=[];alignmentNeedsRead=true;settledCycle=false;return true;
  },
  state:()=>({...clone(model),frameKey:key}),grid:()=>grid,frame:()=>lastFrame,
  checkpoint:()=>({model:clone(model),grid,previousSize,key,confirmedKey,corrections,established,expectedState,expectedKey,popup,alignmentNeedsRead}),
  restore(value){if(!value)return;model=clone(value.model);grid=value.grid;previousSize=value.previousSize;key=value.key;confirmedKey=value.confirmedKey;corrections=value.corrections||[];established=!!value.established;expectedState=value.expectedState||null;expectedKey=value.expectedKey||null;popup=value.popup||null;alignmentNeedsRead=!!value.alignmentNeedsRead;},
  info:()=>({confirmed:!!model.confirmed,learned:corrections.length,key})
 };
}
module.exports={create,imageKey,patch,patchScore,stats};
