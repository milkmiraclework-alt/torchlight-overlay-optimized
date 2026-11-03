'use strict';
// Authorised unmodified Timer strategy. The worker uses the same pinned
// Electron/V8 as the supplied core; no other application or capture starts.
const E=require('./engine'),W=require('./world-sampler'),Mods=require('./field-mods');
const colours=['','green','blue','purple','orange','red','rainbow'];
let loaded=null;
function core(){
 if(!loaded){require('./timer-solver/jsc-loader');loaded={R:require('./timer-solver/core/engine.jsc'),S:require('./timer-solver/core/solver.jsc')};}
 return loaded;
}
function card(id){
 if(id>=1&&id<=6)return {type:'move',n:id};
 if(id>=11&&id<=16)return {type:'back',n:id-10};
 if(id>=201&&id<=224&&id%10>=1&&id%10<=4)return {type:'upgrade',from:colours[id%10+1],count:Math.floor((id-200)/10)+1};
 const type={21:'move_odd',22:'move_even',23:'back_any',24:'move_any'}[id];return type?{type}:null;
}
function tile(t,i){
 let out;
 if(!i)out={type:'start'};
 else if(t.kind==='unknown'||t.used&&t.kind==='empty'&&t.look)out=t.look==='chest'?{type:'chest',rarity:null}:{type:'hidden',...(t.look?{hint:t.look}:{})};
 else if(t.kind==='chest')out={type:'chest',rarity:colours[t.tier]};
 else if(t.kind==='trap'&&t.amount===1)out={type:'trap'};
 else if(t.kind==='heal')out={type:'life',fixedN:t.amount};
 else if(t.kind==='random')out={type:'question'};
 else if(t.kind==='draw')out={type:'movement',cardCount:t.amount};
 else if(t.kind==='grant'&&t.id>=1&&t.id<=6)out={type:'movement',fixedN:t.id};
 else if(t.kind==='effect'&&t.id>=1021&&t.id<=1023)out={type:'movement',cardCount:t.id-1020};
 else if(t.kind==='effect'&&t.id>=1101&&t.id<=1104)out={type:'upgrade',fixedFrom:colours[t.id-1099]};
 else if(t.kind==='empty'||t.kind==='copy'&&t.used||t.kind==='end')out={type:'empty'};
 else return null;
 return t.used?{...out,used:true}:out;
}
function state(s){
 const hand=s.hand.map(card),tiles=s.path.map(tile);if(hand.some(c=>!c)||tiles.some(t=>!t))return null;
 const lastKnown=Math.max(s.position,...s.path.flatMap((t,i)=>t.kind!=='unknown'&&!t.used?[i]:[]));
 return {tiles,total:tiles.length,pos:s.position,currentMove:s.die,hand,life:s.life,collected:s.chests.map(t=>colours[t]),dead:s.life<=0,done:false,futureUpgrade:0,steps:s.turns||0,maxPos:s.maxPosition??Math.max(s.position,Math.floor(lastKnown/4)*4-16),boardType:s.pathMode.type,mods:Mods.normalize(s.fieldMods,tiles.length)};
}
function action(a,s){
 if(a.kind==='end')return {kind:'end'};
 if(a.kind==='current')return a.cycle?{kind:'reroll'}:{kind:'die',delta:s.die};
 if(a.kind==='discard')return {kind:'discard',index:a.idx,id:s.hand[a.idx]};
 if(a.kind==='upgrade')return {kind:'card',index:a.idx,id:s.hand[a.idx]};
 if(a.kind==='hand'){
  const id=s.hand[a.idx],selected=a.dir<0?10+a.n:a.n;
  return {kind:'card',index:a.idx,id,...(E.CARDS.get(id)?.choices.length?{selected}:{})};
 }
 throw Error('Unsupported action from the Arcana strategy core');
}
function createJob(s,{seed=0x41524341,allowReroll=true,rerollBudget=3}={},helpers={}){
 if(process.versions.electron!=='44.5.1'||s.pending||!Number.isInteger(s.maxPosition)||!W.available(s)||!['normal','special4'].includes(s.pathMode.type))return null;
 const observed=state(s);if(!observed)return null;
 const {S}=core(),legal=E.actions(s),key=a=>JSON.stringify([a.kind,a.id,a.selected]);let result=null;
 return {step(){
  if(result)return true;
  const native=S.evaluate(observed,{objective:'rarity',points:{green:1,blue:1,purple:3,orange:5,red:10,rainbow:25},target:10,rollouts:150,deathLosesLoot:false,search:'halving',verify:3,verifyTimes:1.5,seed,weights:{...S.weightsFor('rarity'),upgrade_gate:1}});
  const options=native.filter(o=>!(o.action.kind==='current'&&o.action.cycle&&(!allowReroll||rerollBudget<=0))).map(o=>{
   const local=action(o.action,s),indexed=['card','discard'].includes(local.kind);
   if(indexed&&(!Number.isInteger(local.index)||s.hand[local.index]!==local.id)||!legal.some(a=>key(a)===key(local)))throw Error('The Arcana strategy core proposed an action inconsistent with the observed hand: '+JSON.stringify({action:o.action,mapped:local,hand:s.hand}));
   // Timer ranks rarity points with a 0.001 heuristic tie-break. Keep that
   // rank, but report only the actual rarity estimate. avgGold counts gold+
   // chests; it must never be presented as a rainbow expectation.
   return {action:local,label:E.label(local,s),mean:o.mean-o.avgValue*.001,rankValue:o.mean,rainbows:null,deathRisk:o.deadRate,se:null,frontierRate:0,samples:o.samples,verified:true,verificationSamples:0};
  });
  if(!options.length)throw Error('The Arcana strategy core returned no legal action');
  if(options.some(o=>![o.mean,o.rankValue,o.deathRisk].every(Number.isFinite)))throw Error('The Arcana strategy core returned invalid estimates');
  helpers.protectExit?.(s,options);
  const best=options[0];result={options,best,target:helpers.target?.(s,best.action)??null,samples:150,totalRollouts:native.reduce((n,o)=>n+o.samples,0),verifiedCandidates:Math.min(3,native.length),authorCore:true,hiddenModel:'route-layout',estimatedHidden:s.path.some(t=>t.kind==='unknown'&&!t.used),unknownEvents:s.path.some(t=>t.kind==='random'&&!t.used),model:s};return true;
 },result:()=>result};
}
module.exports={createJob,state,action,card,tile};
