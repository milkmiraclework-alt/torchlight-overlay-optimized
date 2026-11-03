'use strict';
const {createParser,RE}=require('./timer-reader/arcana-events');
const Reference=require('./timer-reader/route-engine');
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
function create(){
 let epoch=0,dirty=false,popup=null,worldRevision=0,revision=0,pendingFresh=false,fresh=false,listing=false,listed=0,recovered=false,chestSequence=0,chestEvents=[],animating=false;
 const parser=createParser(event=>{
  if(event.kind==='board-open'){epoch++;popup=null;worldRevision=0;fresh=pendingFresh;pendingFresh=false;listing=!event.unseen;listed=0;recovered=false;chestSequence=0;chestEvents=[];}
  if(event.kind==='board-close')popup=null;
  if(event.kind==='tiles-seen'&&listing)listed=Math.max(listed,event.count||0);
  if(event.kind==='move'&&Number.isInteger(event.readerPos))recovered=true;
  if(event.kind==='chest-collected'){const tier=['','green','blue','purple','orange','red','rainbow'].indexOf(event.engineRarity);chestEvents.push({sequence:++chestSequence,kind:'collect',tier,time:event.time});}
  if(event.kind==='chest-upgraded')chestEvents.push({sequence:++chestSequence,kind:'upgrade',count:event.count,time:event.time});
  if(event.kind==='chest-skipped'&&event.correction)chestEvents.push({sequence:++chestSequence,kind:'correction',time:event.time});
  if(chestEvents.length>128)chestEvents=chestEvents.slice(-128);
  if(event.kind==='tiles-changed'||event.kind==='map-chests-changed')worldRevision++;dirty=true;
 });
 function snapshot(){const b=parser.board(),initial=listing?Math.max(listed,b.total):listed,positionKnown=fresh||recovered||initial===16;return {epoch,revision,anchored:b.anchored&&positionKnown&&Number.isInteger(b.pos)&&b.pos>=1&&b.pos<=400,position:b.pos,total:b.total,looks:[...b.looks].slice(0,400),used:[...b.used].slice(0,400),moves:b.moves,popup,worldRevision,initialListed:initial,positionSource:fresh?'new-run':recovered?'landed-icon':initial===16?'initial-first-row':'unanchored-open',chestSequence,chestEvents,animating};}
 return {feed(lines){
  const before=JSON.stringify(snapshot());dirty=false;
  for(const line of lines){
   if(typeof line!=='string')continue;
   if(/\bS9CardPlayStart\b|ProtoId = 5551\b/.test(line))pendingFresh=true;
   if(!(line.includes('S9')||line.includes('TaroView')||line.includes('CloseTraoView')||line.includes('MsgMgr@:Show MsgValue')))continue;
   if(RE.step.test(line)){if(listing)listed=Math.max(listed,parser.board().total);listing=false;animating=true;}
   parser.feed(line);
   if(RE.done.test(line)||RE.timeout.test(line)||RE.close.test(line))animating=false;
   if(RE.step.test(line))listing=false;
   if(line.includes('S9ChooseCard'))for(const event of require('./events').parse([line]))if(event.kind==='choice'||event.kind==='choice-close')popup=event.kind==='choice'?'choose':null;
  }
  const changed=before!==JSON.stringify(snapshot());if(changed)revision++;return changed;
 },snapshot};
}
module.exports={create,infer,lengths};
