'use strict';
const {createParser,RE}=require('./timer-reader/arcana-events');
const Reference=require('./timer-reader/route-engine');
const Geometry=require('./geometry');
const lengths=Object.fromEntries(['normal','special1','special2','special3','special4'].map(type=>[type,Reference.makeBoard(type,Reference.makeRng(1)).length]));
const colours=['','green','blue','purple','orange','red','rainbow'];
function infer(board,chests=[]){
 if(!board?.anchored||!Number.isInteger(board.position)||board.position<1||!Number.isInteger(board.total)||board.total<board.position||board.total>400)return {confirmed:false,source:'unanchored-log',candidates:[]};
 const rarities=new Map(chests.map(([position,tier])=>[position,colours[tier]]));
 const observations=(board.looks||[]).filter(o=>Array.isArray(o)&&Number.isInteger(o[0])&&o[0]>1&&o[0]<=400&&['plain','icon','chest'].includes(o[1])).map(([p,look])=>[p,look,rarities.get(p)||null]);
 if(observations.length<8)return {confirmed:false,source:'game-log-patterns',observations:observations.length,candidates:[]};
 const candidates=Reference.guessBoardType(observations).map(({type,p})=>({type,confidence:p,length:lengths[type]}));
 const best=candidates[0],confirmed=!!best&&best.confidence>=.97&&board.position<=best.length&&board.total<=best.length;
 return {type:best?.type||null,length:confirmed?best.length:null,confidence:best?.confidence||0,confirmed,source:'game-log-patterns',observations:observations.length,candidates};
}
function align(board,grid,point,observations=[]){
 // A real UI open enumerates the complete instantiated prefix. Its count is
 // a bound on visible cells, never a position or the total route length.
 if(board?.anchored||!board?.prefixAnchored||board.animating||!grid?.trusted||!grid.relative||!point||!Number.isInteger(board.total)||board.total%4||board.total<8||board.total>400||observations.length<8)return null;
 const looks=new Map(board.looks),candidates=[];
 const look=t=>t?.kind==='chest'?'chest':['trap','heal','random'].includes(t?.kind)?'icon':['effect','draw','note'].includes(t?.kind)?'plain':null;
 for(let first=0;first<board.total;first+=4){
  if(first%8!==grid.first%8)continue;
  const candidate={...grid,first,relative:false},index=Geometry.cell(candidate,point);if(index===null||index>=board.total)continue;
  let compared=0,matched=0,mismatched=0,distinctive=0,inside=true;
  for(const o of observations){
   const i=Geometry.cell(candidate,o.p);if(i===null||i>=board.total){inside=false;break;}
   // Visited objects disappear. Empty pixels cannot contradict the original
   // logged appearance, including after retreating through an old chest.
   const observed=look(o.tile),logged=looks.get(i+1);if(!observed||!logged)continue;
   compared++;if(observed===logged){matched++;if(observed!=='plain')distinctive++;}else mismatched++;
  }
  if(inside)candidates.push({first,position:index+1,compared,matched,mismatched,distinctive});
 }
 const compatible=candidates.filter(c=>c.mismatched<2);
 if(compatible.length!==1||compatible[0].mismatched)return null;
 const best=compatible[0],bounded=candidates.length===1;
 if(!bounded&&(best.matched<6||best.distinctive<2))return null;
 return {...best,source:bounded?'prefix-bounds':'visual-log-patterns',visible:observations.length,candidates:candidates.length};
}
function create(){
 let epoch=0,dirty=false,popup=null,worldRevision=0,revision=0,pendingFresh=false,fresh=false,listing=false,listed=0,recovered=false,recoveredSource=null,chestSequence=0,chestEvents=[],animating=false,verifiedUsed=new Set(),rewardActors=new Map(),rewardActorsAmbiguous=false;
 const parser=createParser(event=>{
  if(event.kind==='board-open'){epoch++;popup=null;worldRevision=0;fresh=pendingFresh;pendingFresh=false;listing=!event.unseen;listed=0;recovered=false;recoveredSource=null;verifiedUsed.clear();rewardActors.clear();rewardActorsAmbiguous=false;chestSequence=0;chestEvents=[];animating=false;}
  if(event.kind==='board-close')popup=null;
  if(event.kind==='tiles-seen'&&listing)listed=Math.max(listed,event.count||0);
  if(event.kind==='move'&&Number.isInteger(event.readerPos)){recovered=true;recoveredSource='landed-icon';}
  if(event.kind==='landed'&&(fresh||recovered)&&Number.isInteger(event.pos))verifiedUsed.add(event.pos);
  if(event.kind==='chest-collected'){const tier=['','green','blue','purple','orange','red','rainbow'].indexOf(event.engineRarity);chestEvents.push({sequence:++chestSequence,kind:'collect',tier,time:event.time});}
  if(event.kind==='chest-upgraded')chestEvents.push({sequence:++chestSequence,kind:'upgrade',count:event.count,time:event.time});
  if(event.kind==='chest-skipped'&&event.correction)chestEvents.push({sequence:++chestSequence,kind:'correction',time:event.time});
  if(chestEvents.length>128)chestEvents=chestEvents.slice(-128);
  if(event.kind==='tiles-changed'||event.kind==='map-chests-changed')worldRevision++;dirty=true;
 });
 function snapshot(){const b=parser.board(),initial=listing?Math.max(listed,b.total):listed,positionKnown=fresh||recovered;return {epoch,revision,prefixAnchored:b.anchored,anchored:b.anchored&&positionKnown&&Number.isInteger(b.pos)&&b.pos>=1&&b.pos<=400,position:b.pos,total:b.total,looks:[...b.looks].slice(0,400),used:[...verifiedUsed].slice(0,400),moves:b.moves,popup,worldRevision,initialListed:initial,positionSource:fresh?'new-run':recovered?recoveredSource:'unanchored-open',chestSequence,chestEvents,animating,rewardCountMin:rewardActorsAmbiguous?null:rewardActors.size,rewardMinTiers:rewardActorsAmbiguous?[]:[...rewardActors.values()].filter(t=>t>0)};}
 return {feed(lines){
  const before=JSON.stringify(snapshot());dirty=false;
  for(const line of lines){
   if(typeof line!=='string')continue;
   if(/\bS9CardPlayStart\b|ProtoId = 5551\b/.test(line))pendingFresh=true;
   if(!(line.includes('S9')||line.includes('TaroView')||line.includes('CloseTraoView')||line.includes('MsgMgr@:Show MsgValue')))continue;
   if(RE.step.test(line)){if(listing)listed=Math.max(listed,parser.board().total);listing=false;animating=true;}
   parser.feed(line);
   const animation=RE.anim.exec(line);
   if(animation&&animation[2]==='S9Reward'&&animation[4]===' Start'&&parser.board().anchored&&!rewardActorsAmbiguous){
    const id=Number(animation[1]),colour=/^Anim_(Bai|Green|Blue|Zi|Jin|Red|Hong|Cai)$/.exec(animation[3]),tier=colour?({Bai:1,Green:1,Blue:2,Zi:3,Jin:4,Red:5,Hong:5,Cai:6})[colour[1]]:null;
    if(tier)rewardActors.set(id,Math.max(tier,rewardActors.get(id)||0));
    else if(animation[3]==='Anim_Taro_RewardUpgrade')rewardActors.set(id,rewardActors.get(id)?Math.min(6,rewardActors.get(id)+1):0);
    // A rarity-up animation is one chest, not necessarily one rarity level.
    // These are lower bounds, never a replacement for a read upgraded tier.
    if(rewardActors.size>7){rewardActors.clear();rewardActorsAmbiguous=true;}
   }
   if(RE.done.test(line)||RE.timeout.test(line)||RE.close.test(line))animating=false;
   if(RE.step.test(line))listing=false;
   if(line.includes('S9ChooseCard'))for(const event of require('./events').parse([line]))if(event.kind==='choice'||event.kind==='choice-close')popup=event.kind==='choice'?'choose':null;
  }
  const changed=before!==JSON.stringify(snapshot());if(changed)revision++;return changed;
 },snapshot,anchor(value){
  const b=snapshot();if(b.anchored||!b.prefixAnchored||b.animating||value?.epoch!==epoch||value.revision!==revision||!Number.isInteger(value.position)||value.position<1||value.position>b.total)return false;
  parser.pos=value.position;recovered=true;recoveredSource='visual-log-patterns';verifiedUsed.add(value.position);revision++;return true;
 }};
}
module.exports={create,infer,align,lengths};
