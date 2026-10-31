'use strict';
const E=require('./engine');
// Independent maximum-entropy prior over the 25 question effects in local game
// data. Server odds are unknown; these are not Arcana Helper's fitted weights.
const questionEvents=Object.keys(E.DATA.events).map(Number).filter(id=>id>=9201&&id<=9225);
const deltas=new Map(E.DATA.cards.flatMap(c=>{const e=c.events.map(id=>E.DATA.events[id]).find(e=>e.fn===100);return e?.a.length===2&&e.a[0]===e.a[1]?[[c.id,e.a[0]]]:[];}));
const movementChoices=new Map(E.DATA.cards.map(c=>[c.id,(c.choices.length?c.choices:[c.id]).map(id=>deltas.get(id)).filter(n=>n!==undefined)]));
const movementMasks=new Map([...movementChoices].map(([id,ns])=>[id,ns.reduce((mask,n)=>mask|1<<(n+6),0)]));
const cardEffects=new Map(E.DATA.cards.map(c=>[c.id,c.events.map(id=>E.DATA.events[id])]));
function target(s,a){
 if(a.kind==='die')return Math.min(s.path.length-1,s.position+s.die);
 if(a.kind!=='card')return null;
 const delta=deltas.get(a.selected??a.id);return delta===undefined?null:Math.max(0,Math.min(s.path.length-1,s.position+delta));
}
function valuable(s,a){
 if(a.kind==='end'||a.kind==='die'||a.kind==='reroll'||a.kind==='copy'||a.kind==='choose')return true;
 if(a.kind==='discard')return s.hand.length===10;
 const c=E.CARDS.get(a.id),effects=cardEffects.get(a.id);
 if(c.choices.length)return true;
 if(effects.every(e=>e.fn===130)){
  return effects.some(e=>{const eligible=t=>t<6&&(!e.c.length||e.c.includes(t+1));return e.b.includes(1)&&s.chests.some(eligible)||e.b.includes(2)&&s.path.some((t,i)=>i>s.position&&(!visible(s,i)||t.kind==='unknown'||t.kind==='chest'&&eligible(t.tier)));});
 }
 if(effects.every(e=>e.fn===110)&&s.life===6)return false;
 return true;
}
const upgradeSpecs=new Map(E.DATA.cards.flatMap(c=>{
 if(c.choices.length||c.events.length!==1)return [];const e=E.DATA.events[c.events[0]];
 return e.fn===130&&e.b.length===1&&e.b[0]===1&&e.p[0]>0?[[c.id,{e,n:e.a[0],cap:e.c.length?Math.max(...e.c)-1:6}]]:[];
}));
const upgradeSpec=a=>a.kind==='card'?upgradeSpecs.get(a.id)||null:null;
function upgradeReady(s,spec){
 if(!spec)return true;
 const eligible=s.chests.filter(t=>t<6&&(!spec.e.c.length||spec.e.c.includes(t+1)));
 if(s.position===s.path.length-1||s.life<=1||s.chests.length===7||s.hand.length===10)return true;
 // An upgrade is a reusable opportunity until it is spent. Save its full
 // count and rarity cap; a soft penalty still spent red upgrades on golds
 // simply because the immediate +5 outweighed a walk through an empty tile.
 return eligible.length>=spec.n&&Math.max(0,...eligible)>=spec.cap;
}
function usefulActions(s){
 const list=E.actions(s).filter(a=>valuable(s,a)&&upgradeReady(s,upgradeSpec(a))),upgrades=list.flatMap(a=>{const spec=upgradeSpec(a);if(!spec)return [];const after=s.chests.slice(),temporary={chests:after};E.upgrade(temporary,spec.n,spec.e.p[0],spec.e.c.length?spec.e.c:null);return [{a,...spec,after:after.join(',')}];});
 // Equal immediate chest outcome: spend the card whose count/cap is a
 // subset and keep the strictly more flexible upgrade for later.
 const dominated=new Set(upgrades.filter(a=>upgrades.some(b=>a!==b&&a.after===b.after&&b.cap<=a.cap&&b.n<=a.n&&(b.cap<a.cap||b.n<a.n))).map(a=>a.a));
 const movementGroups=new Map();
 for(const a of list){if(a.kind!=='card')continue;const p=target(s,a);if(p===null)continue;let group=movementGroups.get(p);if(!group){group=[];movementGroups.set(p,group);}group.push(a);}
 for(const group of movementGroups.values())for(const a of group){const choices=movementChoices.get(a.id)||[],mask=movementMasks.get(a.id)||0;if(group.some(b=>b.index!==a.index&&(movementChoices.get(b.id)||[]).length<choices.length&&((movementMasks.get(b.id)||0)&mask)===(movementMasks.get(b.id)||0)))dominated.add(a);}
 return list.filter(a=>!dominated.has(a));
}
const potentialCache=new WeakMap();
const terminalCache=new Map();
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
function potentialEntry(s){
 let entry=potentialCache.get(s);
 if(!entry||entry.position!==s.position||!same(entry.chests,s.chests)||!same(entry.hand,s.hand)){
  // Terminal upgrade value depends only on inventory, not the sampled path.
  // Share this exact calculation across worlds; never cache sampled outcomes.
  const key=s.chests.join(',')+'|'+s.hand.filter(id=>upgradeSpecs.has(id)).join(',');let terminal=terminalCache.get(key);
  if(!terminal){
   const specs=s.hand.map(id=>upgradeSpecs.get(id)).filter(Boolean).sort((a,b)=>a.cap-b.cap||b.n-a.n),values=[];
   const total=chests=>{const v={chests:chests.slice()};for(const q of specs)E.upgrade(v,q.n,q.e.p[0],q.e.c.length?q.e.c:null);return E.score(v);};
   terminal={values,total,specs,losses:new Map(),base:total(s.chests)};
   if(terminalCache.size>=4096)terminalCache.clear();terminalCache.set(key,terminal);
  }
  entry={...terminal,position:s.position,chests:s.chests.slice(),hand:s.hand.slice(),notes:new Map(),effects:new Map()};potentialCache.set(s,entry);
 }
 return entry;
}
function chestPotential(s,tier){
 const entry=potentialEntry(s);
 if(entry.values[tier]===undefined)entry.values[tier]=entry.total(s.chests.concat(tier))-entry.base;
 return entry.values[tier];
}
function notePotential(s,id){
 const spec=upgradeSpecs.get(id);if(!spec)return Math.max(.2,1.8-s.hand.length*.13);
 const entry=potentialEntry(s);if(entry.notes.has(id))return entry.notes.get(id);
 const specs=entry.specs.concat(spec).sort((a,b)=>a.cap-b.cap||b.n-a.n),v={chests:s.chests.slice()};
 for(const q of specs)E.upgrade(v,q.n,q.e.p[0],q.e.c.length?q.e.c:null);
 const immediate=Math.max(0,E.score(v)-entry.base);
 const need=s.chests.filter(t=>t<6&&t<=spec.cap).length+7-s.chests.length,owned=entry.specs.filter(q=>q.cap===spec.cap).reduce((n,q)=>n+q.n,0),room=Math.max(0,need-owned);
 const gain=E.POINTS[Math.min(6,spec.cap+spec.e.p[0])]-E.POINTS[spec.cap];
 const future=gain*.35*Math.min(spec.n,room)*Math.min(1,(s.path.length-1-s.position)/24);
 const value=Math.max(immediate*.75,future);entry.notes.set(id,value);return value;
}
const drawRules=new Map(Object.entries(E.DATA.tiles).map(([id,t])=>[Number(id),t.events.map(id=>{
 const e=E.DATA.events[id];if(e.fn!==140)return null;
 const pool=E.DATA.cards.filter(c=>c.tag!==99&&c.weight>0&&(!e.c.length||e.c.includes(c.id))&&(!e.b.length||e.b.includes(c.tag)));
 return {pool,total:pool.reduce((n,c)=>n+c.weight,0),n:(e.a[0]+(e.a[1]??e.a[0]))/2};
})]));
function effectValue(s,t){
 if(s.hand.length>=10)return 0;
 const entry=potentialEntry(s);if(entry.effects.has(t.id))return entry.effects.get(t.id);
 const rules=drawRules.get(t.id);if(!rules)return 0;let value=0;
 for(const q of rules){
  if(q?.total)value+=q.pool.reduce((n,c)=>n+c.weight*notePotential(s,c.id),0)/q.total*Math.min(10-s.hand.length,q.n);
  else if(q===null)value+=1.5;
 }
 entry.effects.set(t.id,value);
 return value;
}
function visible(s,i){return i<=s.revealed||!s.path[i]?.sampled;}
function valueOf(s,i){
 const t=s.path[i];if(!t||!visible(s,i)||t.used||i===s.justVisited)return 0;
 if(t.kind==='chest'){
  if(s.chests.length>=7)return 0;
  const early=s.position<s.path.length-16&&s.life>1;
  // A weak chest irreversibly occupies a reward slot. Leave room for future
  // red/rainbow chests rather than relying on a nonexistent replacement.
  const potential=chestPotential(s,t.tier),opportunity=early&&potential<=2?[0,.15,.35,.65,1,1.6,2.5][s.chests.length]:0;
  return potential-opportunity;
 }
 if(t.kind==='heal')return Math.min(t.amount||1,Math.max(0,4-s.life))*1.8;
 if(t.kind==='trap')return s.life<2?-35:-2.5/(s.life-0.5);
 if(t.kind==='draw')return s.hand.length<10?1.2*(t.amount||1):0;
 if(t.kind==='copy')return s.hand.length<10?3:0;
 if(t.kind==='random'||t.kind==='scenario-event')return 1.2;
 if(t.kind==='effect')return effectValue(s,t);
 return 0;
}
function immediate(s,a,getValue=valueOf){
 if(a.kind==='end')return -0.05;
 if(a.kind==='reroll'){
  if(s.position!==s.path.length-1)return -Infinity;
  // A reroll is free at the end, but must lead to a productive backward/forward
  // combination. Do not get trapped repeatedly requesting another die.
  let average=0;for(let die=1;die<=6;die++){let best=0;for(const id of s.hand)for(const delta of movementChoices.get(id)||[]){if(delta<0){const p=Math.max(0,s.position+delta);best=Math.max(best,getValue(s,p)+getValue(s,Math.min(s.path.length-1,p+die)));}}average+=best/6;}
  return average>0?average*0.3:-10;
 }
 if(a.kind==='discard'){
  const after={...s,hand:s.hand.filter((_,i)=>i!==a.index)},p=Math.min(s.path.length-1,s.position+s.die),pickup=getValue(after,p)-getValue(s,p);
  return Math.max(0,pickup)*.65-notePotential(after,a.id)*.8-.05;
 }
 if(a.kind==='copy'||a.kind==='choose')return notePotential(s,a.id);
 const p=target(s,a),c=E.CARDS.get(a.selected??a.id);
 if(p!==null){
  if(p===s.position)return -8;
  const pre=a.kind==='card'&&s.hand.length>=8?{...s,hand:s.hand.filter((_,i)=>i!==a.index)}:s,v=getValue(pre,p),t=s.path[p];let after=pre;
  if(t&&!t.used){
   if(t.kind==='chest'&&s.chests.length<7)after={...pre,position:p,chests:s.chests.concat(t.tier)};
   else if(t.kind==='heal')after={...pre,position:p,life:Math.min(6,s.life+(t.amount||1))};
   else if(t.kind==='trap')after={...pre,position:p,life:Math.max(0,s.life-(t.amount||1))};
  }
  let future=0;
  if(after.life>0){
   const next=d=>{const q=Math.min(s.path.length-1,p+d);return q===p?0:Math.max(0,getValue(after,q));};
   if(a.kind==='die'){for(let d=1;d<=6;d++)future+=next(d)/6;}
   else future=next(s.die);
  }
  const cost=a.kind==='die'?0:0.45+(c?.rarity||1)*0.12;
  return v+future*.42-cost+Math.max(0,p-s.position)*0.004;
 }
 if(c?.events.some(id=>E.DATA.events[id].fn===130)){
  const e=E.DATA.events[c.events.find(id=>E.DATA.events[id].fn===130)],eligible=s.chests.filter(t=>t<6&&(!e.c.length||e.c.includes(t+1))),n=Math.min(e.a[0]||1,eligible.length);
  eligible.sort((a,b)=>b-a);
  const gain=eligible.slice(0,n).reduce((sum,t)=>sum+E.POINTS[Math.min(6,t+e.p[0])]-E.POINTS[t],0);
  const cap=e.c.length?Math.max(...e.c)-1:6,nearEnd=s.position>=s.path.length-12||s.life===1||s.chests.length===7;
  // A ×3 card may not repeatedly upgrade the same chest. Hold it for its
  // stated cap/count unless waiting is no longer useful.
  if(gain===0&&eligible.length){
   if(potentialEntry(s).base>E.score(s))return .05;
   if(s.hand.length===10){const after={...s,hand:s.hand.filter((_,i)=>i!==a.index)},p=Math.min(s.path.length-1,s.position+s.die);return Math.max(0,getValue(after,p)-getValue(s,p))*.65-.05;}
  }
  if(nearEnd&&gain>0){
   const entry=potentialEntry(s);let lost=entry.losses.get(a.id);
   if(lost===undefined){
    const after={...s,hand:s.hand.filter((_,i)=>i!==a.index),chests:s.chests.slice()};E.upgrade(after,e.a[0]||1,e.p[0],e.c.length?e.c:null);
    lost=entry.base-potentialEntry(after).base;entry.losses.set(a.id,lost);
   }
   // A high-cap multi-upgrade can consume a blue chest before its cheap
   // blue upgrade is played. Preserve the complete owned-card chain, even
   // when playing the high-cap card first has a larger immediate gain.
   if(lost>0)return gain-32-lost;
  }
  return gain-(nearEnd?0:(n<(e.a[0]||1)?4:0)+Math.max(0,cap-Math.max(0,...eligible))*2)-0.12;
 }
 if(c?.events.some(id=>E.DATA.events[id].fn===110))return s.life<3?4:0.1;
 return -0.8;
}
function policy(s,r,lastRoll=false){
 const actions=usefulActions(s);let best=actions[0],v=-Infinity;
 const cache=new WeakMap(),getValue=(s,i)=>{let values=cache.get(s);if(!values){values=new Map();cache.set(s,values);}if(!values.has(i))values.set(i,valueOf(s,i));return values.get(i);};
 for(const a of actions){const score=immediate(s,a,getValue)+(a.kind==='end'?0:r()*0.002);if(score>v){v=score;best=a;}}
 // Ending keeps the chests, and so does a later death. A negative note
 // opportunity cost must not make a rollout stop in front of a trap when a
 // movement note can safely bypass it and reveal more of the path.
 if(best?.kind==='end'&&s.position<s.path.length-1&&E.score(s)<175){
  let alternative=null,score=-Infinity;
  for(const a of actions){const p=target(s,a);if(p===null||p===s.position)continue;
   const t=s.path[p],fatal=t&&visible(s,p)&&!t.used&&t.kind==='trap'&&(t.amount||1)>=s.life;if(fatal)continue;
   const next=a.kind==='card'?Math.min(s.path.length-1,p+s.die):p;
   if(p<s.position&&next<=s.position)continue;
   const value=immediate(s,a,getValue);if(value>score){score=value;alternative=a;}
  }
  if(alternative)best=alternative;
 }
 return best;
}
function knownDistribution(s){
 // The server's hidden layouts are not in the client configuration. A small
 // independent bootstrap uses this board's observed tile types; it is not a
 // claim to reproduce another helper's fitted server odds.
 const tiles=s.path.filter(t=>t.kind!=='unknown'&&t.kind!=='end'&&!t.sampled).map(t=>({...t,used:false}));
 // Empirical frequencies alone assign a zero probability to any kind not
 // yet seen (notably chests on an unlucky first screen). Smooth with a small
 // independent prior, never another helper's fitted board frequencies.
 // Chest rarity itself uses the game's published/local rarity weights.
 const prior=[{kind:'empty'},{kind:'empty'},{kind:'trap',amount:1},{kind:'heal',amount:1},{kind:'prior-chest'},{kind:'effect',id:1021},{kind:'effect',id:1001},{kind:'prior-upgrade'},{kind:'prior-event'}];
 return tiles.length>=8?tiles.concat(prior):prior;
}
function sampleState(base,r,distribution){
 const s=E.clone(base,true);s.revealed=Math.max(...s.path.flatMap((t,i)=>t.kind!=='unknown'?[i]:[]),0,Math.min(s.path.length-1,(Math.floor(s.position/4)+5)*4-1));
 for(let i=0;i<s.path.length;i++)if(s.path[i].kind==='unknown'&&distribution){let t=E.pick(distribution,r);if(t.kind==='prior-chest'||t.kind==='chest')t=E.tileFromId(2010,r);else if(t.kind==='prior-upgrade')t={kind:'effect',id:1101+Math.floor(r()*4)};else if(t.kind==='prior-event')t={kind:'effect',id:4001+Math.floor(r()*11)};s.path[i]={...t,used:false,sampled:true};}
 // Sample the hidden outcome, while the rollout policy sees only a question.
 for(let i=0;i<s.path.length;i++)if(s.path[i].kind==='random'&&!s.path[i].used)s.path[i]={...s.path[i],kind:'scenario-event',event:E.pick(questionEvents,r)};
 return s;
}
function rollout(base,action,seed,distribution){
 const r=E.rng(seed),world=sampleState(base,r,distribution);return rolloutPrepared(world,action,r.state());
}
function rolloutPrepared(world,action,seed,tree=null,learn=false){
 const r=E.rng(seed),s=E.clone(world,true);E.apply(s,action,r);
 let lastRoll=action.kind==='reroll',search=!!tree;const trace=[];
 for(let n=0;n<160&&!s.ended&&s.life>0&&!s.frontier;n++){
  s.revealed=Math.max(s.revealed,Math.min(s.path.length-1,(Math.floor(s.position/4)+5)*4-1));
  let choice=null;if(search&&n<3)choice=treeAction(tree,s,r,lastRoll,learn);
  if(choice?.fresh)search=false;
  const a=choice?.action||policy(s,r,lastRoll);if(!a)break;
  if(learn&&choice?.edge)trace.push(choice);
  const before=s.position,hand=s.hand.length,score=E.score(s),pending=!!s.pending;E.apply(s,a,r);
  lastRoll=a.kind==='reroll';
  if(a.kind!=='reroll'&&before===s.position&&hand===s.hand.length&&score===E.score(s)&&!s.pending&&!pending)break;
 }
 const value=E.score(s);for(const {node,edge} of trace){node.n++;edge.n++;edge.sum+=value;}
 return {value,rainbows:s.chests.filter(t=>t===6).length,died:s.life<=0,frontier:!!s.frontier};
}
function observationKey(s,lastRoll){
 // Share nearby decisions across particles without conditioning on remote
 // cells. Every one-step landing and its held-die continuation is included.
 const low=Math.max(0,s.position-6),high=Math.min(s.path.length,s.position+13),path=[];
 for(let i=low;i<high;i++){const t=s.path[i];path.push(!visible(s,i)||t.kind==='unknown'?'?':(t.kind==='scenario-event'?'random':t.kind)+':'+(t.used?1:0)+':'+(t.tier||t.amount||t.id||0));}
 return [s.path.length,s.position,s.life,s.die,s.rerollBudget??3,s.hand.join(','),s.chests.join(','),s.pending?JSON.stringify(s.pending):'',path.join(';')].join('|');
}
function treeAction(tree,s,r,lastRoll,learn){
 const key=observationKey(s,lastRoll);let node=tree.get(key),fresh=false;
 if(!node){
  if(!learn||tree.size>=8192)return null;
  const best=policy(s,r,lastRoll),list=usefulActions(s),keyOf=a=>JSON.stringify(a),bestKey=best?keyOf(best):'';
  const cache=new WeakMap(),getValue=(state,i)=>{let values=cache.get(state);if(!values){values=new Map();cache.set(state,values);}if(!values.has(i))values.set(i,valueOf(state,i));return values.get(i);};
  const ranked=list.map(action=>({action,prior:immediate(s,action,getValue)})).sort((a,b)=>b.prior-a.prior);
  const selected=new Map(ranked.slice(0,4).map(v=>[keyOf(v.action),v]));
  for(const v of ranked)if(v.action.kind==='end'||keyOf(v.action)===bestKey)selected.set(keyOf(v.action),v);
  for(const v of ranked.filter(v=>{const p=target(s,v.action);return p!==null&&visible(s,p)&&['random','scenario-event'].includes(s.path[p]?.kind)&&!s.path[p].used;}).slice(0,2))selected.set(keyOf(v.action),v);
  node={n:0,edges:[...selected.values()].map(v=>({...v,n:0,sum:0}))};tree.set(key,node);fresh=true;
  const edge=node.edges.find(e=>keyOf(e.action)===bestKey)||node.edges[0];return {node,edge,action:edge?.action,fresh};
 }
 let edge;
 if(learn)edge=node.edges.find(e=>!e.n);
 if(!edge){let value=-Infinity;for(const candidate of node.edges){if(!candidate.n)continue;const score=candidate.sum/candidate.n+(learn?E.POINTS[6]/2*Math.sqrt(Math.log(node.n+1)/candidate.n):0);if(score>value){edge=candidate;value=score;}}}
 return edge?{node,edge,action:edge.action,fresh}:null;
}
function createPolicyJob(model,{samples=128,seed=0x41524341,verify=3,verifySamples=samples*2,allowReroll=true,rerollBudget=3}={}){
 const s=E.normalize(model);if(!s.confirmed)throw Error('Check the Arcana reading before calculating.');
 if(!s.lengthConfirmed)throw Error('Confirm the total path length.');
 s.rerollBudget=Math.min(s.rerollBudget,allowReroll?rerollBudget:0);
 const actions=usefulActions(s).filter(a=>allowReroll||a.kind!=='reroll'),distribution=knownDistribution(s),rows=actions.map(action=>({action,sum:0,square:0,rainbows:0,deaths:0,frontiers:0,n:0,verified:action.kind==='end'||actions.length===1,extra:0}));
 let round=0,phase='screen',active=[],verifyRound=0,verifiedCandidates=0;
 const tie=a=>a.kind==='end'?0:a.kind==='die'?1:a.kind==='reroll'?3:2,emptyCanContinue=s.chests.length===0&&s.position<s.path.length-1;
 const compare=(a,b)=>b.sum/Math.max(1,b.n)-a.sum/Math.max(1,a.n)||(emptyCanContinue?(a.action.kind==='end')-(b.action.kind==='end'):0)||tie(a.action)-tie(b.action);
 function add(row,v,extra=false){row.sum+=v.value;row.square+=v.value*v.value;row.rainbows+=v.rainbows;row.deaths+=v.died;row.frontiers+=v.frontier;row.n++;if(extra)row.extra++;}
 function evaluate(group,index,verification){
  const drawSeed=((verification?seed^0x7151cafe:seed)+Math.imul(index+1,0x9e3779b9))>>>0;
  const random=E.rng(drawSeed),world=sampleState(s,random,distribution),afterSample=random.state();
  for(const row of group)add(row,row.action.kind==='end'?{value:E.score(s),rainbows:s.chests.filter(t=>t===6).length,died:false,frontier:false}:rolloutPrepared(world,row.action,afterSample),verification);
 }
 return {
  step(batch=4){
   if(phase==='done')return true;
   if(phase==='screen'){
    for(let stop=Math.min(samples,round+batch);round<stop;round++)evaluate(rows,round,false);
    if(round<samples)return false;
    if(verify>0&&verifySamples>0&&rows.length>1){active=rows.slice().sort(compare).slice(0,verify).filter(row=>!row.verified);phase=active.length?'verify':'done';}
    else phase='done';
    return phase==='done';
   }
   for(let stop=Math.min(verifySamples,verifyRound+batch);verifyRound<stop;verifyRound++)evaluate(active,verifyRound,true);
   if(verifyRound<verifySamples)return false;
   for(const row of active){row.verified=true;verifiedCandidates++;}
   // Extra samples can expose another leader. Verify that candidate too;
   // never leave a noisy, unverified screening winner above the finalists.
   const leader=rows.slice().sort(compare)[0];
   if(leader&&!leader.verified){active=[leader];verifyRound=0;return false;}
   phase='done';return true;
  },
  result(){
   const options=rows.map(row=>({action:row.action,label:E.label(row.action,s),mean:row.n?row.sum/row.n:E.score(s),se:row.n>1?Math.sqrt(Math.max(0,(row.square-row.sum*row.sum/row.n)/(row.n-1))/row.n):0,
    rainbows:row.rainbows/Math.max(1,row.n),deathRisk:row.deaths/Math.max(1,row.n),frontierRate:row.frontiers/Math.max(1,row.n),samples:row.n,verified:row.verified,verificationSamples:row.extra}));
   options.sort((a,b)=>b.mean-a.mean||(emptyCanContinue?(a.action.kind==='end')-(b.action.kind==='end'):0)||tie(a.action)-tie(b.action));
   const best=options[0]||{action:{kind:'end'},label:'Start Fateful Contest',mean:E.score(s),rainbows:s.chests.filter(t=>t===6).length};
   return {options,best,target:target(s,best.action),samples:round,totalRollouts:rows.reduce((n,row)=>n+row.n,0),verifiedCandidates,estimatedHidden:!!distribution&&s.path.some(t=>t.kind==='unknown'),unknownEvents:s.path.some(t=>t.kind==='random'),model:s};
  }
 };
}
function createJob(model,{samples=128,seed=0x41524341,verify=3,verifySamples=samples*2,allowReroll=true,rerollBudget=3}={}){
 if(verify<=0)return createPolicyJob(model,{samples,seed,verify,verifySamples,allowReroll,rerollBudget});
 const s=E.normalize(model);if(!s.confirmed)throw Error('Check the Arcana reading before calculating.');if(!s.lengthConfirmed)throw Error('Confirm the total path length.');
 s.rerollBudget=Math.min(s.rerollBudget,allowReroll?rerollBudget:0);
 const exact=terminalJob(s);if(exact)return exact;
 const actions=usefulActions(s).filter(a=>allowReroll||a.kind!=='reroll'),distribution=knownDistribution(s),tree=new Map(),screenSamples=Math.min(32,samples);
 const rows=actions.map(action=>({action,sum:0,square:0,rainbows:0,deaths:0,frontiers:0,n:0,extra:0,verified:action.kind==='end'||actions.length===1}));
 let phase='learn',round=0,screenRound=0,verifyRound=0,active=[],verifiedCandidates=0,learningRollouts=0;
 const emptyCanContinue=s.chests.length===0&&s.position<s.path.length-1,tie=a=>a.kind==='end'?0:a.kind==='die'?1:a.kind==='reroll'?3:2;
 const compare=(a,b)=>b.sum/Math.max(1,b.n)-a.sum/Math.max(1,a.n)||(emptyCanContinue?(a.action.kind==='end')-(b.action.kind==='end'):0)||tie(a.action)-tie(b.action);
 function evaluate(group,index,mode){
  const random=E.rng(((seed^(mode==='learn'?0x4c454152:mode==='screen'?0x5343524e:0x7151cafe))+Math.imul(index+1,0x9e3779b9))>>>0),world=sampleState(s,random,distribution),afterSample=random.state();
  for(const row of group){
   if(mode==='learn'){if(row.action.kind!=='end'){rolloutPrepared(world,row.action,afterSample,tree,true);learningRollouts++;}continue;}
   const v=row.action.kind==='end'?{value:E.score(s),rainbows:s.chests.filter(t=>t===6).length,died:false,frontier:false}:rolloutPrepared(world,row.action,afterSample,tree,false);
   row.sum+=v.value;row.square+=v.value*v.value;row.rainbows+=v.rainbows;row.deaths+=v.died;row.frontiers+=v.frontier;row.n++;if(mode==='verify')row.extra++;
  }
 }
 return {
  step(batch=4){
   if(phase==='done')return true;
   if(phase==='learn'){
    for(let stop=Math.min(samples,round+batch);round<stop;round++)evaluate(rows,round,'learn');
    if(round<samples)return false;phase='screen';return false;
   }
   if(phase==='screen'){
    for(let stop=Math.min(screenSamples,screenRound+batch);screenRound<stop;screenRound++)evaluate(rows,screenRound,'screen');
    if(screenRound<screenSamples)return false;
    active=verifySamples>0?rows.slice().sort(compare).slice(0,verify).filter(row=>!row.verified):[];phase=active.length?'verify':'done';return phase==='done';
   }
   for(let stop=Math.min(verifySamples,verifyRound+batch);verifyRound<stop;verifyRound++)evaluate(active,verifyRound,'verify');
   if(verifyRound<verifySamples)return false;
   for(const row of active){row.verified=true;verifiedCandidates++;}
   const leader=rows.slice().sort(compare)[0];if(leader&&!leader.verified){active=[leader];verifyRound=0;return false;}phase='done';return true;
  },
  result(){
   const options=rows.map(row=>({action:row.action,label:E.label(row.action,s),mean:row.n?row.sum/row.n:E.score(s),se:row.n>1?Math.sqrt(Math.max(0,(row.square-row.sum*row.sum/row.n)/(row.n-1))/row.n):0,rainbows:row.rainbows/Math.max(1,row.n),deathRisk:row.deaths/Math.max(1,row.n),frontierRate:row.frontiers/Math.max(1,row.n),samples:row.n,verified:row.verified,verificationSamples:row.extra}));
   options.sort((a,b)=>b.mean-a.mean||(emptyCanContinue?(a.action.kind==='end')-(b.action.kind==='end'):0)||tie(a.action)-tie(b.action));
   const best=options[0]||{action:{kind:'end'},label:'Start Fateful Contest',mean:E.score(s),rainbows:s.chests.filter(t=>t===6).length};
   return {options,best,target:target(s,best.action),samples:round,totalRollouts:learningRollouts+rows.reduce((n,row)=>n+row.n,0),learningRollouts,screenSamples:screenRound,continuationStates:tree.size,verifiedCandidates,estimatedHidden:s.path.some(t=>t.kind==='unknown'),unknownEvents:s.path.some(t=>t.kind==='random'),model:s};
  }
 };
}
function terminalJob(s){
 if(s.pending||s.position!==s.path.length-1)return null;
 const isUpgrade=id=>{const q=upgradeSpecs.get(id);return q&&q.e.p[2]!==2&&q.e.a[0]===q.e.a[1];};
 const inert=id=>{const c=E.CARDS.get(id);if(c.choices.length)return c.choices.every(note=>(deltas.get(note)??-1)>=0);return c.events.every(e=>E.DATA.events[e].fn===110||E.DATA.events[e].fn===100&&E.DATA.events[e].a[0]>=0);};
 if(!s.hand.every(id=>isUpgrade(id)||inert(id)))return null;
 const memo=new Map();
 function best(chests,hand){
  const key=chests.slice().sort().join(',')+'|'+hand.slice().sort((a,b)=>a-b).join(',');if(memo.has(key))return memo.get(key);
  let value=chests;const seen=new Set();
  for(let i=0;i<hand.length;i++){const id=hand[i];if(seen.has(id))continue;seen.add(id);const q=upgradeSpecs.get(id),v={chests:chests.slice()};E.upgrade(v,q.n,q.e.p[0],q.e.c.length?q.e.c:null);const candidate=best(v.chests,hand.filter((_,j)=>j!==i)),delta=E.score({chests:candidate})-E.score({chests:value});if(delta>0||delta===0&&candidate.filter(t=>t===6).length>value.filter(t=>t===6).length)value=candidate;}
  memo.set(key,value);return value;
 }
 const options=usefulActions(s).filter(a=>a.kind==='end'||a.kind==='card'&&isUpgrade(a.id)).map(action=>{
  const after=E.clone(s);if(action.kind!=='end')E.apply(after,action,E.rng(1));const final=action.kind==='end'?after.chests:best(after.chests,after.hand.filter(isUpgrade));
  return {action,label:E.label(action,s),mean:E.score({chests:final}),se:0,rainbows:final.filter(t=>t===6).length,deathRisk:0,frontierRate:0,samples:0,verified:true,verificationSamples:0};
 });
 options.sort((a,b)=>b.mean-a.mean||b.rainbows-a.rainbows||(a.action.kind==='end'?0:1)-(b.action.kind==='end'?0:1)||(upgradeSpecs.get(a.action.id)?.cap||0)-(upgradeSpecs.get(b.action.id)?.cap||0));
 const winner=options[0],result={options,best:winner,target:null,samples:0,totalRollouts:0,learningRollouts:0,screenSamples:0,continuationStates:0,verifiedCandidates:0,estimatedHidden:false,unknownEvents:false,model:s,exact:true,exactStates:memo.size};
 return {step:()=>true,result:()=>result};
}
module.exports={createJob,rollout,policy,target,immediate,valueOf,knownDistribution,informationKey:observationKey};
