'use strict';
const E=require('./engine'),V=require('./vision'),G=require('./geometry'),Digits=require('./digits'),FastHand=require('./fast-hand'),Route=require('./route-log');
const crypto=require('node:crypto');
const PopupContext=require('./popup-context');
const clone=v=>JSON.parse(JSON.stringify(v));
function imageKey(img){
 return `${img.width}x${img.height}:`+crypto.createHash('sha256').update(img.data).digest('hex');
}
function stats(img,box){
 let n=0,red=0,bright=0,purple=0,dimRed=0,warm=0;for(let y=Math.max(0,Math.floor(box.y));y<Math.min(img.height,box.y+box.h);y+=2)for(let x=Math.max(0,Math.floor(box.x));x<Math.min(img.width,box.x+box.w);x+=2){const p=(y*img.width+x)*4,r=img.data[p],g=img.data[p+1],b=img.data[p+2];n++;if(r>g*1.5&&r>b*1.18&&r>160)red++;if(r>g*1.45&&r>b*.95&&r>55)dimRed++;if(r+g+b>550)bright++;if(b>r*1.3&&b>g*1.5&&b>180)purple++;if(r>70&&g>45&&r>b*1.3&&g>b*1.3)warm++;}return {n,red:red/Math.max(1,n),dimRed:dimRed/Math.max(1,n),bright:bright/Math.max(1,n),purple:purple/Math.max(1,n),warm:warm/Math.max(1,n)};
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
 return {p,tile:null,emptyEvidence:s.bright<.006&&s.red<.003&&s.dimRed<.003&&s.warm<.002&&s.purple<.02};
}
const sameTile=(a,b)=>a?.used&&b?.kind==='empty'||a?.kind===b?.kind&&(a.kind!=='chest'||a.tier===b.tier)&&(a.kind!=='effect'||a.id===b.id)&&(!a.amount||!b.amount||a.amount===b.amount);
const semanticKey=s=>JSON.stringify([s.position,s.life,s.die,s.hand,s.chests,s.pending]);
function create({automatic=true}={}){
 const fastHand=FastHand.create();
 let model=E.blank(),grid=null,previousSize=null,key=null,confirmedKey=null,corrections=[],lastFrame=null,newBoard=false,expectedKey=null,expectedState=null,currentPoint=null,observations=[],provisional=[],established=false,popup=null,alignmentNeedsRead=false;
 let settledCycle=false;
 let lifeExamples=[],lifeRect=null,lastReliableLife=null,lastReliableChests=null,lastRecognition=null,lastReliableHand=null,lastReliableDie=null,chestAnchor=null;
 let editKey=null,editSignature=null,moveRevision=0;
 let logBoard=null,visualAnchor=null;
 let recentPopup=false;
 let pathHistory=[],historyEpoch=null,historyRevision=0;
 function activeLogBoard(){
  if(!logBoard||logBoard.anchored)return logBoard;
  if(visualAnchor&&logBoard.prefixAnchored&&visualAnchor.epoch===logBoard.epoch&&visualAnchor.moves===(logBoard.moves||0)&&visualAnchor.worldRevision===(logBoard.worldRevision||0))return {...logBoard,anchored:true,position:visualAnchor.position,positionSource:'visual-log-patterns'};
  return logBoard;
 }
 function setPopup(value){value=value||null;if(value===popup)return;recentPopup=!!popup&&!value;popup=value;confirmedKey=null;model.confirmed=false;settledCycle=false;moveRevision++;editKey=null;if(!popup)model.pending=null;}
 const signature=s=>JSON.stringify([moveRevision,s.position,s.life,s.die,s.hand,s.chests,s.path.map(t=>t&&({kind:t.kind,tier:t.tier,amount:t.amount,id:t.id,look:t.look,used:!!t.used,candidates:t.candidates?.slice().sort((a,b)=>a-b)})),s.pending,!!s.localHorizon,!!s.positionConfirmed]);
 function updateEditKey(s){const value=signature(s);if(value!==editSignature||!editKey){editSignature=value;editKey=crypto.createHash('sha256').update(value).digest('hex');}}
 function reset(fresh=false){model=E.blank();grid=null;key=null;confirmedKey=null;lastFrame=null;newBoard=fresh;expectedKey=null;expectedState=null;currentPoint=null;observations=[];provisional=[];established=false;popup=null;recentPopup=false;pathHistory=[];historyEpoch=null;historyRevision=0;alignmentNeedsRead=false;settledCycle=false;lifeRect=null;lastReliableLife=null;lastReliableChests=null;lastReliableHand=null;lastReliableDie=null;chestAnchor=null;lastRecognition=null;editKey=null;editSignature=null;visualAnchor=null;moveRevision++;}
 function read(img){
  const started=performance.now(),nextKey=imageKey(img);lastFrame=img;
  if(logBoard?.animating&&!popup&&!recentPopup){model.confirmed=false;return {model:clone(model),issues:['Waiting for the game animation to finish.'],waiting:true,ms:performance.now()-started};}
  if(expectedKey&&nextKey===expectedKey){
   if(settledCycle){expectedKey=null;expectedState=null;settledCycle=false;model.confirmed=true;confirmedKey=key;updateEditKey(model);return {model:clone(model),issues:[],unchanged:true,ms:performance.now()-started,grid};}
   return {model:clone(model),issues:['Waiting for the move to appear in the picture.'],waiting:true,ms:performance.now()-started};
  }
  expectedKey=null;
  if(!expectedState&&nextKey===key&&nextKey===confirmedKey)return {model:clone(model),issues:[],unchanged:true,ms:performance.now()-started,grid};
  const priorBoard=activeLogBoard();let currentOffer=null;
  if(popup&&priorBoard?.anchored&&model.positionConfirmed&&priorBoard.position!==model.position+1){
   currentOffer=V.offers(img);const advanced=PopupContext.copyAfterHandMove(model,priorBoard,currentOffer);
   if(advanced){model=advanced;lastReliableHand=model.hand.slice();pathHistory[model.position]=clone(model.path[model.position]);}
   else if(currentOffer.confident){model.confirmed=false;key=nextKey;editKey=null;return {model:clone(model),issues:['Waiting for the observed move and card offer to agree.'],waiting:true,popup:true,ms:performance.now()-started,grid};}
  }
  if((popup||recentPopup)&&model.lifeFresh&&model.handFresh&&model.chestsFresh&&model.die!==null&&(!priorBoard?.anchored||!model.positionConfirmed||priorBoard.position===model.position+1)){
   // Choosing a note blurs the board and hand. Read the offer itself while
   // preserving the last observed board; never OCR the blurred background.
   const offered=currentOffer||V.offers(img),next=clone(model),issues=[];
   if(!popup&&recentPopup){
    if(offered.confident){model.confirmed=false;key=nextKey;updateEditKey(model);return {model:clone(model),issues:['Waiting for the closed choice to disappear from the picture.'],waiting:true,ms:performance.now()-started,grid};}
    recentPopup=false;
   }else{
   if(!offered.confident)issues.push('Waiting for all offered notes to become clear.');
   else{
    const sorted=xs=>xs.slice().sort((a,b)=>a-b).join(','),offer=sorted(offered.cards);
    const sources=next.hand.flatMap((id,i)=>{const choices=E.CARDS.get(id).choices;return choices.length&&sorted(choices)===offer?[i]:[];});
    const partial=sources.length?[]:next.hand.flatMap((id,i)=>{const choices=E.CARDS.get(id).choices;return offered.cards.length>=2&&choices.length>offered.cards.length&&offered.cards.every(id=>choices.includes(id))?[i]:[];});
    if(next.pending?.kind==='copy'&&PopupContext.subset(offered.cards,next.hand))next.pending={kind:'copy',cards:next.hand.slice()};
    else if(sources.length)next.pending={kind:'choose',cards:offered.cards,source:sources[0]};
    else if(partial.length===1)next.pending={kind:'choose',cards:E.CARDS.get(next.hand[partial[0]]).choices.slice(),source:partial[0]};
    else if(offer===sorted(next.hand))next.pending={kind:'copy',cards:next.hand.slice()};
    else if([3,6].includes(offered.cards.length))next.pending={kind:'choose',cards:offered.cards};
    else issues.push('Waiting for the complete card offer.');
   }
   next.confirmed=issues.length===0;model=next;key=nextKey;if(next.confirmed){confirmedKey=nextKey;expectedState=null;}
   updateEditKey(next);return {model:clone(next),issues,waiting:issues.length>0,ms:performance.now()-started,grid,popup:true};
   }
  }
  const bases=V.findBases(img),auto=G.grid(bases),card=fastHand.read(img,auto)||V.cards(img),life=V.findLife(img,bases),issues=[];
  if((!card.handConfident||card.die===null||!life)&&(!model.lifeFresh||!model.handFresh||!model.chestsFresh)){
   const offered=V.offers(img);
   if(offered.confident&&(popup||offered.cards.length>=3)){
    model.confirmed=false;model.lifeFresh=false;model.handFresh=false;model.dieFresh=false;model.chestsFresh=false;model.pending={kind:'choose',cards:offered.cards};confirmedKey=null;editKey=null;
    lastRecognition={lifeFresh:false,chestsFresh:false,cardReader:card.source||'templates',popupHidesBoard:true};
    return {model:clone(model),issues:['Waiting for the choice to close: the hand behind it has not been read.'],waiting:true,popup:true,bases:bases.length,ms:performance.now()-started,grid};
   }
  }
  observations=[];
  let localMode=automatic&&(!model.lengthConfirmed||model.pathMode?.source==='game-log-patterns');
  if(auto){
   const lastRow=Math.min(5,Math.max(...bases.map(b=>G.cell(auto,G.center(b))).filter(i=>i!==null).map(i=>Math.floor(i/4))));
   for(let i=0;i<(lastRow+1)*4;i++){
    let p=G.at(auto,i);const nearest=bases.map(b=>G.center(b)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
    if(localMode&&(!nearest||Math.hypot(nearest.x-p.x,nearest.y-p.y)>auto.width*.18)&&!fastHand.hasTile(img,p))continue;
    if(nearest&&Math.hypot(nearest.x-p.x,nearest.y-p.y)<auto.width*.15)p=nearest;
    if(p.x>img.width*.12&&p.x<img.width*.88&&p.y>img.height*.07&&p.y<img.height*.76)observations.push(observation(img,p,auto.width,corrections));
   }
  }
  grid=scaleGrid(grid,previousSize,img);previousSize={width:img.width,height:img.height};
  if(localMode){
   const aligned=G.localGrid(img,auto,bases,V.sample);
   if(aligned)grid=aligned;
   else if(auto&&grid?.relative&&Math.hypot(auto.origin.x-grid.origin.x,auto.origin.y-grid.origin.y)<grid.width*.25)grid={...auto,first:grid.first,trusted:grid.trusted,relative:true};
   else grid=auto?{...auto,first:32,trusted:false,relative:true}:null;
  }else if(auto){
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
  if(localMode){next.path=Array.from({length:96},()=>({kind:'unknown'}));next.localHorizon=true;next.lengthConfirmed=false;next.positionConfirmed=false;}
  else delete next.localHorizon;
  next.handFresh=!!card.handConfident;next.dieFresh=card.die!==null;
  if(next.handFresh)lastReliableHand=card.hand.slice();if(next.dieFresh)lastReliableDie=card.die;
  next.hand=next.handFresh?card.hand:lastReliableHand?.slice()||card.hand;next.die=card.die??lastReliableDie;
  if(!card.handConfident)issues.push('Check the hand: one or more card faces are unclear.');
  if(card.die===null)issues.push('Check the refill die.');
  if(life){
   lifeRect={x:life.box.x+life.box.w*1.04,y:life.box.y-life.box.h*.1,w:life.box.w*1.7,h:life.box.h*1.2};
   const number=Digits.life(img,lifeRect,lifeExamples);
   next.lifeFresh=!!number;next.life=number?.value??lastReliableLife;
   if(number)lastReliableLife=number.value;else issues.push('Check remaining life.');
  }else{lifeRect=null;next.lifeFresh=false;next.life=lastReliableLife;issues.push('The current tile / life marker is not clear.');}
  currentPoint=null;
  let board=activeLogBoard();
  if(grid&&life){
   const badge=G.center(life),candidates=observations.filter(({p})=>Math.abs(p.x-badge.x)<grid.width*.5&&p.y-badge.y>grid.width*.55&&p.y-badge.y<grid.width*1.6).sort((a,b)=>(Math.abs(a.p.x-badge.x)+Math.abs(a.p.y-badge.y-grid.width*.85)*.3)-(Math.abs(b.p.x-badge.x)+Math.abs(b.p.y-badge.y-grid.width*.85)*.3));
   currentPoint=candidates[0]?.p||null;
   if(automatic&&!model.manualPath&&!board?.anchored&&currentPoint&&grid.trusted){
    const recovered=Route.align(logBoard,grid,currentPoint,observations);
    if(recovered){visualAnchor={...recovered,epoch:logBoard.epoch,moves:logBoard.moves||0,worldRevision:logBoard.worldRevision||0};board=activeLogBoard();}
   }
   if(automatic&&!model.manualPath&&board?.anchored&&currentPoint&&grid.trusted){
    const relative=G.cell(grid,currentPoint),target=board.position-1;
    const first=relative===null?null:(Math.floor(target/4)-Math.floor((relative-grid.first)/4))*4;
    const anchored=first===null?null:{...grid,first,relative:false,source:'game-log',trusted:true};
    if(anchored&&first>=0&&G.cell(anchored,currentPoint)===target){
     grid=anchored;next.positionConfirmed=true;next.routeEpoch=board.epoch;next.routeMoves=board.moves;next.positionSource=board.positionSource||'game-log';
     next.maxPosition=Math.max(target,model.routeEpoch===board.epoch?model.maxPosition??model.position:target);
     next.turns=board.orderCount||0;
     if(historyEpoch!==logBoard.epoch){pathHistory=[];historyEpoch=logBoard.epoch;historyRevision=logBoard.worldRevision||0;}
     if(historyRevision!==(logBoard.worldRevision||0)){pathHistory=pathHistory.map((t,i)=>i>target||t?.kind==='chest'&&!t.used?{kind:'unknown'}:t);historyRevision=logBoard.worldRevision||0;}
     const chests=observations.filter(o=>o.tile?.kind==='chest').map(o=>[G.cell(grid,o.p)+1,o.tile.tier]);
     const mode=Route.infer(board,chests);next.pathMode=mode;
     if(mode.confirmed){
      next.path=Array.from({length:mode.length},(_,i)=>clone(pathHistory[i]||{kind:'unknown'}));
      next.lengthConfirmed=true;delete next.localHorizon;localMode=false;
     }else{next.path=Array.from({length:96},(_,i)=>clone(pathHistory[i]||{kind:'unknown'}));next.lengthConfirmed=false;next.localHorizon=true;localMode=true;}
     next.worldRevision=logBoard.worldRevision||0;
     next.fieldMods=clone(board.fieldMods||[]);
    }else{
     // A new log position with the old on-screen column is an animation or
     // stale capture, not a new relative board to advise on.
     model.confirmed=false;model.lifeFresh=false;model.handFresh=false;model.dieFresh=false;model.chestsFresh=false;
     confirmedKey=null;editKey=null;
     return {model:clone(model),issues:['Waiting for the picture to match the current game position.'],waiting:true,ms:performance.now()-started,grid};
    }
   }
   const position=currentPoint?G.cell(grid,currentPoint):null;
   if(position!==null&&position<next.path.length&&grid.trusted)next.position=position;else issues.push('Check the current tile / path alignment.');
  }else issues.push('Check the current tile / path alignment.');
  if(next.positionConfirmed&&board?.anchored){
   for(const [position,look]of board.looks||[]){const i=position-1;if(i>=0&&i<next.path.length&&next.path[i]?.kind==='unknown'&&['plain','icon','chest'].includes(look))next.path[i]={...next.path[i],look};}
   for(const position of board.used||[]){const i=position-1;if(i>=0&&i<next.path.length){const previous=next.path[i],look=previous?.look||board.looks.find(([p])=>p===position)?.[1];next.path[i]=previous?.kind==='unknown'?{kind:'empty',used:true,...(look?{look}:{})}:{...previous,used:true};pathHistory[i]=clone(next.path[i]);}}
  }
  provisional=[];
  if(grid){
   for(const o of observations){const i=G.cell(grid,o.p);if(i===null||i>=next.path.length)continue;
    const isCurrent=currentPoint&&Math.hypot(currentPoint.x-o.p.x,currentPoint.y-o.p.y)<grid.width*.1;
    const consumed=board?.anchored&&grid.source==='game-log'&&board.used?.includes(i+1);
    // Confirmed one-shot activations beat an old visible icon. In particular,
    // a retreat must not make an already collected chest collectible again.
    // Nor does a consumed/current tile need another expensive fallback OCR.
    if(consumed||isCurrent)o.tile={...(next.path[i]?.kind!=='unknown'?next.path[i]:{kind:'empty'}),used:true};
    else if(!o.tile&&board?.anchored&&grid.source==='game-log'){
     const look=logBoard.looks.find(v=>v[0]===i+1)?.[1],hint=fastHand.tileHint(img,o.p,look,o.emptyEvidence);
     if(hint)o.tile=hint.tile;
    }
    let tile=o.tile||next.path[i]||{kind:'unknown'};
    if(tile.kind==='empty'&&next.path[i]?.kind!=='unknown'&&next.path[i]?.kind!=='empty')tile={...next.path[i],...(isCurrent||logBoard?.used?.includes(i+1)?{used:true}:{})};
    next.path[i]=clone(tile);if(next.positionConfirmed&&grid.source==='game-log'&&tile.kind!=='unknown')pathHistory[i]=clone(tile);provisional.push({index:i,p:o.p,tile:clone(tile)});
   }
  }else issues.push('Align the visible path in Check board.');
  // The left reward chain uses fixed screen anchors. Read each of seven
  // slots independently; unrecognised decoration is not a green chest.
  const collected=V.collected(img);let chests=collected.tiers,chestConfidence=collected.confident,rewardPending=!!collected.conflicting,chestsSource='picture';
  const observedChests=chests.slice(),events=logBoard?.chestEvents?.filter(e=>e.sequence>(chestAnchor?.sequence??Infinity))||[];
  const minimumTiers=(logBoard?.rewardMinTiers||[]).slice().sort((a,b)=>b-a);
  if(chestAnchor?.epoch===logBoard?.epoch&&events.length&&events[0].sequence===chestAnchor.sequence+1&&events.at(-1).sequence===logBoard.chestSequence){
   const expected=chestAnchor.chests.slice();let upgrades=0,valid=true;
   for(const event of events){if(event.kind==='collect'&&event.tier>=1&&event.tier<=6){if(expected.length<7)expected.push(event.tier);}else if(event.kind==='upgrade')upgrades+=event.count;else valid=false;}
   if(valid){
    if(!upgrades&&chests.length<expected.length&&chests.every((tier,i)=>tier===expected[i])){chests=expected;chestConfidence=true;rewardPending=false;chestsSource='game-log';}
    else if(chests.length!==expected.length||upgrades&&chests.reduce((a,b)=>a+b,0)<expected.reduce((a,b)=>a+b,0)+upgrades){chestConfidence=false;rewardPending=true;}
   }
  }
  const observedOrder=chests.slice().sort((a,b)=>b-a);
  if(Number.isInteger(logBoard?.rewardCountMin)&&chests.length<logBoard.rewardCountMin||minimumTiers.some((tier,i)=>!observedOrder[i]||observedOrder[i]<tier)){chestConfidence=false;rewardPending=true;}
  if(collected.conflicting){chestConfidence=false;rewardPending=true;}
  const lost=lastReliableChests!==null&&chests.length<lastReliableChests.length;
  // Reward slots never disappear during a run. A temporarily hidden icon
  // needs another automatic read, not a request to rebuild the inventory.
  if(lost){chestConfidence=false;rewardPending=true;}
  next.chestsFresh=!!chestConfidence&&!lost;next.observedChests=observedChests;
  if(next.chestsFresh){next.chests=chests;lastReliableChests=chests.slice();if(logBoard)chestAnchor={epoch:logBoard.epoch,sequence:logBoard.chestSequence||0,chests:chests.slice()};}
  else{next.chests=lastReliableChests?.slice()||model.chests.slice();issues.push(rewardPending?'Waiting for the chest update to finish.':'Check collected chests.');}
  if(lost)issues.push('Waiting for all collected chests to become visible.');
  if(grid?.trusted&&next.position!==model.position&&model.path[next.position]?.kind==='chest'&&!model.path[next.position].used&&model.chests.length<7&&chests.length<=model.chests.length){rewardPending=true;issues.push('Waiting for the new chest to reach the reward chain.');}
  if(!next.lengthConfirmed&&!next.localHorizon)issues.push('Confirm the total path length in Check board.');
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
  if(!next.localHorizon&&!require('./world-sampler').available(next)&&grid?.trusted&&next.life!==null&&next.die!==null){
   for(const a of E.actions(next)){
    let target=null;if(a.kind==='die')target=Math.min(next.path.length-1,next.position+next.die);
    else if(a.kind==='card'){const c=E.CARDS.get(a.selected??a.id),e=c.events.map(id=>E.DATA.events[id]).find(e=>e.fn===100&&e.a[0]===e.a[1]);if(e)target=Math.max(0,Math.min(next.path.length-1,next.position+e.a[0]));}
    if(target!==null&&target!==next.position&&next.path[target].kind==='unknown')issues.push(`Check tile ${target+1}: a current move can land there.`);
   }
  }
  const waiting=rewardPending||!!expectedState&&semanticKey(next)===expectedState&&!settledCycle;
  if(waiting&&!rewardPending)issues.push('Waiting for the game picture to catch up.');
  else if(!issues.length){expectedState=null;settledCycle=false;}
  next.confirmed=issues.length===0;newBoard=false;
  lastRecognition={lifeFresh:next.lifeFresh,chestsFresh:next.chestsFresh,observedChests,chestsSource,relative:!!next.localHorizon,alignmentSource:grid?.source||null,cardReader:card.source||'templates'};
  model=next;key=nextKey;if(next.confirmed)confirmedKey=nextKey;alignmentNeedsRead=false;
  updateEditKey(next);
  return {model:clone(model),issues:[...new Set(issues)],waiting,ms:performance.now()-started,grid,cardMatches:card.handMatches,refill:card.dieMatch,bases:bases.length,handCount:card.handCount,rowRegular:card.rowRegular,rowCentered:card.rowCentered};
 }
 function correct(value){
  if(alignmentNeedsRead)throw Error('Read the screen after aligning the path, then check the new reading.');
  if(expectedKey)throw Error('The last picture still precedes the move. Read a new picture first.');
  if(lastFrame&&(!editKey||value.frameKey!==editKey))throw Error('The board changed while you were editing. Read the new state before confirming.');
  if(grid&&!grid.trusted&&!currentPoint)throw Error('The current marker was not read. Align the path and read the screen before confirming its tiles.');
  const local=!!model.localHorizon&&!value.lengthConfirmed;
  const next=E.normalize(local?{...value,lengthConfirmed:true}:value);
  if(local){next.localHorizon=true;next.lengthConfirmed=false;}
  if(model.positionConfirmed&&next.position===model.position&&next.path.length===model.path.length){next.positionConfirmed=true;next.pathMode=clone(model.pathMode);next.routeEpoch=model.routeEpoch;next.routeMoves=model.routeMoves;next.worldRevision=model.worldRevision||0;next.fieldMods=clone(model.fieldMods||[]);}
  else if(next.lengthConfirmed)next.manualPath=true;
  if(!next.confirmed)throw Error('Check the confirmation box after correcting the reading.');
  const edited=next.path.flatMap((tile,i)=>tile.kind!=='unknown'&&JSON.stringify(tile)!==JSON.stringify(model.path[i])?[i]:[]);
  if(!local&&grid&&currentPoint){
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
  if(lastFrame&&lifeRect){const example=Digits.rememberLife(lastFrame,lifeRect,next.life);if(example)lifeExamples=lifeExamples.concat(example).slice(-24);}
  lastReliableLife=next.life;lastReliableChests=next.chests.slice();lastReliableHand=next.hand.slice();lastReliableDie=next.die;if(logBoard)chestAnchor={epoch:logBoard.epoch,sequence:logBoard.chestSequence||0,chests:next.chests.slice()};next.lifeFresh=true;next.handFresh=true;next.dieFresh=true;next.chestsFresh=true;
  model=next;if(next.positionConfirmed&&next.routeEpoch===historyEpoch)pathHistory=clone(next.path);editSignature=signature(next);editKey=crypto.createHash('sha256').update(editSignature).digest('hex');established=true;confirmedKey=key;expectedState=null;settledCycle=false;return clone(model);
 }
 return {read,correct,reset,
  expectChange(){expectedKey=key;expectedState=semanticKey(model);model.confirmed=false;settledCycle=false;moveRevision++;editKey=null;},
  settleCycle(){if(expectedState&&model.position===model.path.length-1)settledCycle=true;},
  setPopup,
  calibrate(value){
   if(!lastFrame)throw Error('Read a picture before aligning the path.');
   const aligned=G.calibration(value,lastFrame);
   if(grid&&!grid.trusted)for(const o of provisional)if(JSON.stringify(model.path[o.index])===JSON.stringify(o.tile))model.path[o.index]={kind:'unknown'};
   grid=aligned;confirmedKey=null;model.confirmed=false;currentPoint=null;provisional=[];alignmentNeedsRead=true;settledCycle=false;moveRevision++;editKey=null;return true;
  },
  setLogBoard(value){
   if(!value||!Number.isInteger(value.epoch)||!Array.isArray(value.looks)||value.looks.length>400)return false;
   const changed=JSON.stringify(logBoard)!==JSON.stringify(value);
   if(!changed)return false;
   const physical=logBoard&&(logBoard.epoch!==value.epoch||logBoard.moves!==value.moves||logBoard.worldRevision!==value.worldRevision);
   if(logBoard&&logBoard.epoch!==value.epoch)reset(true);
   if(physical)visualAnchor=null;
   confirmedKey=null;
   if(physical&&key){if(!expectedState){expectedState=semanticKey(model);expectedKey=key;}model.confirmed=false;editKey=null;moveRevision++;}
   logBoard=clone(value);
   if(value.popup!==undefined)setPopup(value.popup);
   return true;
  },
  state:()=>({...clone(model),frameKey:editKey}),grid:()=>grid,frame:()=>lastFrame,
  positionAnchor:()=>!logBoard?.anchored&&activeLogBoard()?.anchored?{...clone(visualAnchor),revision:logBoard.revision}:null,
  marks:()=>!lastFrame||popup||recentPopup?[]:provisional.filter(o=>o.p.x>0&&o.p.x<lastFrame.width&&o.p.y>0&&o.p.y<lastFrame.height).map(o=>({index:o.index,label:model.localHorizon&&!model.positionConfirmed?(o.index===model.position?'YOU':`${o.index>model.position?'+':''}${o.index-model.position}`):String(o.index+1),x:o.p.x/lastFrame.width,y:(o.p.y-(grid?.width||0)*.14)/lastFrame.height,unknown:o.tile.kind==='unknown',current:o.index===model.position})),
  recognition:()=>lastRecognition,
  checkpoint:()=>({model:clone(model),grid,previousSize,key,confirmedKey,corrections,established,expectedState,expectedKey,popup,recentPopup,alignmentNeedsRead,lifeExamples,lastReliableLife,lastReliableChests,editKey,editSignature,moveRevision,logBoard,pathHistory,historyEpoch,historyRevision,lastReliableHand,lastReliableDie,chestAnchor,visualAnchor}),
  restore(value){if(!value)return;model=clone(value.model);grid=value.grid;previousSize=value.previousSize;key=value.key;confirmedKey=value.confirmedKey;corrections=value.corrections||[];established=!!value.established;expectedState=value.expectedState||null;expectedKey=value.expectedKey||null;popup=value.popup||null;alignmentNeedsRead=!!value.alignmentNeedsRead;lifeExamples=Array.isArray(value.lifeExamples)?value.lifeExamples.slice(-24):[];lastReliableLife=value.lastReliableLife??model.life??null;lastReliableChests=value.lastReliableChests?.slice()??(model.confirmed?model.chests.slice():null);editKey=value.editKey??null;editSignature=value.editSignature??null;moveRevision=value.moveRevision||0;logBoard=value.logBoard||null;pathHistory=clone(value.pathHistory||[]);historyEpoch=value.historyEpoch??null;historyRevision=value.historyRevision||0;recentPopup=!!value.recentPopup;lastReliableHand=value.lastReliableHand?.slice()??(model.handFresh?model.hand.slice():null);lastReliableDie=value.lastReliableDie??(model.dieFresh?model.die:null);chestAnchor=value.chestAnchor?clone(value.chestAnchor):null;visualAnchor=value.visualAnchor?clone(value.visualAnchor):null;},
  info:()=>({confirmed:!!model.confirmed,learned:corrections.length,key})
 };
}
module.exports={create,imageKey,patch,patchScore,stats};
