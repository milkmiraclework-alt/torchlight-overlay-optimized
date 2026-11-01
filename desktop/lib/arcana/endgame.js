'use strict';
const E=require('./engine');
const allowed=new Set([1,2,3,4,5,6,11,12,13,14,15,16,21,22,23,24,31,32,33,201,202,203,204,211,212,213,214,221,222,223,224]);
const delta=id=>{const c=E.CARDS.get(id),moves=(c.choices.length?c.choices:[id]).map(id=>E.DATA.events[E.CARDS.get(id).events[0]]).filter(e=>e.fn===100);return Math.min(0,...moves.map(e=>e.a[0]));};
const reward=s=>({mean:E.score(s),rainbows:s.chests.filter(t=>t===6).length,deathRisk:+(s.life<=0),steps:0});
const order=(a,b)=>Math.abs(a.mean-b.mean)>1e-10?b.mean-a.mean:Math.abs(a.rainbows-b.rainbows)>1e-10?b.rainbows-a.rainbows:a.steps-b.steps;
const better=(a,b)=>order(a,b)<0;
function createJob(input,{allowReroll=true,rerollBudget=3,limit=5000}={}){
 const original=E.normalize(input);
 if(original.pending||original.life<=0||original.hand.length>4||original.hand.some(id=>!allowed.has(id)))return null;
 const first=Math.max(0,original.position+original.hand.reduce((n,id)=>n+delta(id),0));
 if(original.path.length-first>16||original.path.slice(first).some(t=>!t.used&&!['empty','chest','trap','heal'].includes(t.kind)))return null;
 const s={...original,position:original.position-first,path:original.path.slice(first).map(t=>t.used?{kind:'empty',used:true}:t),rerollBudget:Math.min(original.rerollBudget,allowReroll?rerollBudget:0)},memo=new Map();let states=0,done=false,result=null,aborted=false;
 const key=s=>[s.position,s.life,s.die,s.rerollBudget,s.hand.slice().sort((a,b)=>a-b).join(','),s.chests.slice().sort().join(','),s.path.reduce((n,t,i)=>n|(t.used?1<<i:0),0)].join('|');
 function* value(s){
  if(s.ended||s.life<=0)return reward(s);const k=key(s);if(memo.has(k))return memo.get(k);if(++states>limit)throw Error('Exact endgame limit');yield;
  let best={...reward(s),steps:1};for(const a of E.actions(s)){const candidate=yield* evaluate(s,a);if(better(candidate,best))best=candidate;}memo.set(k,best);return best;
 }
 function* evaluate(s,a){
  const next=E.clone(s);E.apply(next,a,()=>0);
  if(a.kind!=='die'&&a.kind!=='reroll'){const q=yield* value(next);return {...q,steps:q.steps+1};}
  const total={mean:0,rainbows:0,deathRisk:0,steps:1};for(let die=1;die<=6;die++){const q=yield* value({...next,die});for(const k of Object.keys(total))total[k]+=q[k]/6;}return total;
 }
 function* search(){
  const options=[];for(const action of E.actions(s)){const q=yield* evaluate(s,action);options.push({action,label:E.label(action,original),...q,se:0,frontierRate:0,samples:0,verified:true,verificationSamples:0});}
  options.sort(order);
  return {options,best:options[0],samples:0,totalRollouts:0,learningRollouts:0,screenSamples:0,continuationStates:states,verifiedCandidates:options.length,exact:true,exactEndgame:true,exactStates:states,estimatedHidden:false,unknownEvents:false,model:original};
 }
 const iterator=search();
 return {
  step(batch=4){if(done)return true;try{for(let n=0;n<Math.max(1,batch)*32;n++){const next=iterator.next();if(next.done){result=next.value;done=true;break;}}}catch(error){if(error.message!=='Exact endgame limit')throw error;aborted=true;done=true;memo.clear();}return done;},
  result:()=>result,info:()=>({states,done,aborted})
 };
}
module.exports={createJob};
