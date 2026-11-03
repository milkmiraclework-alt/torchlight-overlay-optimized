'use strict';
// A chest slot cannot be reclaimed. On the progressively richer special3
// layout, value a slot against future rewards instead of filling all seven
// with the first green chests. No sampled hidden tile is inspected here.
const R=require('./timer-reader/route-engine'),E=require('./engine');
let prior=null;
function layout(){
 if(prior)return prior;prior=Array.from({length:96},()=>({tiers:Array(7).fill(0),notes:0}));
 const samples=128;for(let seed=0;seed<samples;seed++){
  const board=R.makeBoard('special3',R.makeRng(Math.imul(seed+1,0x9e3779b9)>>>0));
  board.forEach((t,i)=>{if(t.type==='chest')prior[i].tiers[['','green','blue','purple','orange','red','rainbow'].indexOf(t.rarity)]+=1/samples;if(t.type==='movement')prior[i].notes+=(t.fixedN?1:t.cardCount||1)/samples;});
 }
 return prior;
}
function tail(mean,count){if(mean<=0)return 0;let term=Math.exp(-mean),sum=term;for(let i=1;i<count;i++){term*=mean/i;sum+=term;}return Math.max(0,Math.min(1,1-sum));}
function cost(s){
 if(s.pathMode?.type!=='special3'||!s.pathMode.confirmed||s.path.length!==96||s.life<=0||s.chests.length>=7)return 0;
 const expected=layout(),counts=Array(7).fill(0);let gifts=0;
 for(let i=s.position+1;i<s.path.length;i++){
  const t=s.path[i];if(t.used)continue;
  const seen=t.kind!=='unknown'&&(!t.sampled||i<=s.revealed);
  if(seen){
   if(t.kind==='trap')return 0; // The observed field no longer fits the risk-free layout.
   if(t.kind==='chest')counts[t.tier]++;
   if(t.kind==='grant'||t.kind==='draw')gifts+=t.amount||1;
   if(t.kind==='effect'&&t.id>=1021&&t.id<=1023)gifts+=t.id-1020;
  }else{for(let tier=1;tier<=6;tier++)counts[tier]+=expected[i].tiers[tier];gifts+=expected[i].notes;}
 }
 // A free1..6 die visits about one tile per3.5 cells. Held movement notes
 // allow targeted pickups; future note gifts are discounted by their own
 // pickup chance. The actual rollout still tests the real note distances.
 const movement=s.hand.filter(id=>{const c=E.CARDS.get(id);return c.choices.length||c.events.some(e=>E.DATA.events[e].fn===100);}).length;
 let targeted=movement*.5+gifts/3.5*.45;
 const reachable=counts.map(n=>n/3.5);for(let tier=6;tier>=1;tier--){const n=Math.min(targeted,Math.max(0,counts[tier]-reachable[tier]));reachable[tier]+=n;targeted-=n;}
 let mean=0,value=0;for(let tier=6;tier>=1;tier--){mean+=reachable[tier];value+=(E.POINTS[tier]-E.POINTS[tier-1])*tail(mean,7-s.chests.length);}
 return value;
}
module.exports={cost};
