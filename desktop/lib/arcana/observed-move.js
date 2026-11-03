'use strict';
// A bounded observation of the last fully completed UI order. It records
// what the game actually did, never the action recommended by the adviser.
const {RE}=require('./timer-reader/arcana-events');
function create(){
 let draft=null,queued=[],last=null;
 const reset=()=>{draft=null;queued=[];last=null;};
 return {reset,before(line){
  if(draft&&RE.done.test(line))draft.complete=true;
  if(draft&&(RE.timeout.test(line)||RE.close.test(line)||RE.step.exec(line)?.[1]==='1'))draft.complete=false;
 },after(line,context){
  if(RE.step.exec(line)?.[1]==='1'){
   draft={epoch:context.epoch,from:context.anchored?context.position:null,movesFrom:context.moves,worldRevisionFrom:context.worldRevision,plays:queued,lifeDelta:0,cardsGained:0,chestsChanged:false,refill:false,complete:false};queued=[];
  }
  if(draft&&/_S9HandCard Anim_Xipai Start\s*$/.test(line))draft.refill=true;
 },event(event,context){
  if(event.kind==='board-open'||event.kind==='board-close'){reset();return;}
  if(event.kind==='hand-card-played'){
   const play={index:event.index,count:event.count};if(draft)draft.plays.push(play);else queued=queued.concat(play).slice(-10);
  }
  if(!draft)return;
  if(event.kind==='move'){draft.to=event.pos;draft.steps=event.steps;draft.direction=event.direction;draft.refill=!!event.refill;}
  if(event.kind==='life')draft.lifeDelta+=event.change;
  if(event.kind==='cards-gained')draft.cardsGained+=event.count;
  if(['chest-collected','chest-upgraded','chest-skipped'].includes(event.kind))draft.chestsChanged=true;
  if(event.kind==='move-done'){
   last={...draft,plays:draft.plays.slice(),move:context.moves,handCountAfter:context.hand,worldRevision:context.worldRevision};draft=null;queued=[];
  }
 },snapshot:()=>last};
}
module.exports={create};
