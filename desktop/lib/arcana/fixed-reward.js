'use strict';
// A payoff bound inside an already sampled world, not an observation used by
// the rollout policy. With seven occupied slots and no way to upgrade them,
// every continuation keeps exactly the same rarity points, even on death.
const E=require('./engine');
const harmless=new Set(E.DATA.cards.filter(c=>!c.choices.length&&c.events.every(id=>[100,110].includes(E.DATA.events[id].fn))).map(c=>c.id));
for(const c of E.DATA.cards)if(c.choices.length&&c.choices.every(id=>harmless.has(id)))harmless.add(c.id);
function fixed(s){
 if(s.chests.length!==7||s.hand.some(id=>!harmless.has(id))||s.pending?.cards.some(id=>!harmless.has(id)))return false;
 return s.path.every(t=>t.used||['empty','chest','trap','heal','end','copy'].includes(t.kind)||t.kind==='grant'&&harmless.has(t.id)||t.kind==='effect'&&t.id>=1021&&t.id<=1023);
}
module.exports={fixed};
