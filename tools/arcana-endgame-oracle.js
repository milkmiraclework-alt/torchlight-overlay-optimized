'use strict';
// Offline exact oracle for small fully observed endgames. No hidden outcomes.
const E=require('../desktop/lib/arcana/engine');
const allowed=new Set([1,2,3,4,5,6,11,12,13,14,15,16,21,22,23,24,31,32,33,201,202,203,204,211,212,213,214,221,222,223,224]);
function solve(input,{limit=30000}={}){
 const start=performance.now(),s=E.normalize(input),memo=new Map();let states=0;
 if(s.pending||s.hand.some(id=>!allowed.has(id))||s.path.length>16||s.path.some(t=>!['empty','chest','trap','heal'].includes(t.kind)))throw Error('Outside exact endgame domain');
 function key(s){return [s.position,s.life,s.die,s.rerollBudget,s.hand.slice().sort((a,b)=>a-b).join(','),s.chests.slice().sort().join(','),s.path.reduce((n,t,i)=>n|(t.used?1<<i:0),0)].join('|');}
 function value(s){
  if(s.ended||s.life<=0)return E.score(s);const k=key(s);if(memo.has(k))return memo.get(k);if(++states>limit)throw Error('Endgame state limit');
  let best=E.score(s);for(const a of E.actions(s))best=Math.max(best,evaluate(s,a));memo.set(k,best);return best;
 }
 function evaluate(s,a){
  const next=E.clone(s);E.apply(next,a,()=>0);
  if(a.kind!=='die'&&a.kind!=='reroll')return value(next);
  let total=0;for(let die=1;die<=6;die++)total+=value({...next,die});return total/6;
 }
 const options=E.actions(s).map(action=>({action,value:evaluate(s,action)})).sort((a,b)=>b.value-a.value);
 return {best:options[0],options,states,ms:performance.now()-start};
}
module.exports={solve};
