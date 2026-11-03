'use strict';
const E=require('./engine');
function subset(part,whole){const counts=new Map();for(const id of whole)counts.set(id,(counts.get(id)||0)+1);for(const id of part){if(!counts.get(id))return false;counts.set(id,counts.get(id)-1);}return true;}
function context(model,board,offer){
 const t=board?.lastMove;
 if(!board?.anchored||!board.popup||board.animating||!model.positionConfirmed||!model.lifeFresh||!model.handFresh||!model.chestsFresh||!model.dieFresh||!offer?.confident)return null;
 if(!t?.complete||t.epoch!==model.routeEpoch||t.epoch!==board.epoch||t.movesFrom!==model.routeMoves||t.move!==t.movesFrom+1||t.move!==board.moves||t.from!==model.position+1||t.to!==board.position||t.to===t.from||t.lifeDelta||t.cardsGained||t.chestsChanged||t.worldRevisionFrom!==model.worldRevision||t.worldRevision!==board.worldRevision||!Array.isArray(t.plays))return null;
 const target=t.to-1;if(target<0||target>=model.path.length||model.path[target].used||!['unknown','empty','copy'].includes(model.path[target].kind)||['chest','icon'].includes(board.looks.find(([p])=>p===t.to)?.[1]))return null;
 return {t,target};
}
function copied(model,board,target,hand,die=model.die){
 const next=structuredClone(model);next.position=target;next.maxPosition=Math.max(model.maxPosition??model.position,target);next.turns=board.orderCount||0;next.hand=hand;next.die=die;next.dieFresh=true;next.pending={kind:'copy',cards:hand.slice()};next.path[target]={kind:'copy',used:true};next.routeMoves=board.moves;next.confirmed=false;return next;
}
function copyAfterHandMove(model,board,offer){
 const valid=context(model,board,offer);if(!valid)return null;const {t,target}=valid;
 if(t.refill||t.plays.length!==1)return null;
 const play=t.plays[0];if(!Number.isInteger(play.index)||play.index<0||play.index>=model.hand.length||play.count!==model.hand.length-1||t.handCountAfter!==play.count)return null;
 const card=E.CARDS.get(model.hand[play.index]);if(!card)return null;
 const compatible=(card.choices.length?card.choices:[card.id]).some(id=>{
  const events=E.CARDS.get(id).events.map(id=>E.DATA.events[id]);if(events.length!==1||events[0].fn!==100)return false;
  const e=events[0],deltas=e.a.length===2?E.range(e.a[0],e.a[1]):e.a;
  return deltas.some(delta=>Math.max(0,Math.min(model.path.length-1,model.position+delta))===target);
 });
 if(!compatible||['chest','icon'].includes(board.looks.find(([p])=>p===t.to)?.[1]))return null;
 const hand=model.hand.filter((_,i)=>i!==play.index);
 if(!hand.length||!offer.cards.length||!subset(offer.cards,hand)||offer.cards.length<Math.min(2,hand.length))return null;
 // In the local game tables,1002/interaction200 is the only tile interaction;
 // it copies the remaining hand. Held choice notes open their offer before
 // movement. A completed physical move and this exact hand observation are
 // therefore independent evidence of a copy offer, including clipped lists.
 return copied(model,board,target,hand);
}
function copyAfterDieMove(model,board,offer,die){
 const valid=context(model,board,offer);if(!valid)return null;const {t,target}=valid;
 if(!Number.isInteger(die)||die<1||die>6||!t.refill||t.plays.length||t.handCountAfter!==model.hand.length||target!==Math.min(model.path.length-1,model.position+model.die))return null;
 if(!model.hand.length||offer.cards.length<Math.min(2,model.hand.length)||!subset(offer.cards,model.hand))return null;
 return copied(model,board,target,model.hand.slice(),die);
}
module.exports={copyAfterHandMove,copyAfterDieMove,subset};
