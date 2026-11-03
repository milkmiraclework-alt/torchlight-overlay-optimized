'use strict';
// Decisions from visible relative cells. Array padding is a calculation window,
// never an asserted total path length. Exact terminal solvers are not used.
const E=require('./engine');
const questionEvents=Object.keys(E.DATA.events).map(Number).filter(id=>id>=9201&&id<=9225);
function createJob(model,{samples=128,seed=0x4c4f4341,helpers}={}){
 if(!model.confirmed)throw Error('Check the visible Arcana reading.');
 const s=E.normalize({...model,lengthConfirmed:true});
 const terminal=s.life<=0||E.score(s)>=175;
 const knownLanding=a=>{
  const p=helpers.target(s,a);
  if(p!==null)return p===s.position||s.path[p]?.kind!=='unknown';
  // Variable movement notes have no single target. Every possible landing
  // must be read before recommending one, just as for a fixed movement note.
  if(a.kind!=='card')return true;
  let positions=[s.position];
  for(const id of E.CARDS.get(a.selected??a.id).events){const e=E.DATA.events[id];if(e.fn!==100)continue;
   const deltas=e.a.length===2?E.range(e.a[0],e.a[1]):e.a;
   positions=[...new Set(positions.flatMap(pos=>deltas.map(delta=>Math.max(0,Math.min(s.path.length-1,pos+delta)))))];
   if(positions.some(pos=>pos!==s.position&&s.path[pos]?.kind==='unknown'))return false;
  }
  return true;
 };
 const actions=terminal?[{kind:'end'}]:helpers.usefulActions(s).filter(a=>knownLanding(a)&&a.kind!=='reroll'&&a.kind!=='end');
 if(!actions.length)throw Error('No current landing is recognised. Read the screen again.');
 const rows=actions.map(action=>({action,sum:0,square:0,rainbows:0,deaths:0,n:0,frontiers:0}));let done=0;
 const label=a=>{const p=helpers.target(s,a);if(a.kind==='die')return `Use refill die ${s.die} → +${s.die} cells`;const text=E.label(a,s);return p===null?text:`${text} → ${p-s.position>=0?'+':''}${p-s.position} cells`;};
 function one(row,k){
  const r=E.rng((seed+Math.imul(k+1,0x9e3779b9))>>>0),world=E.clone(s);
  for(let i=0;i<world.path.length;i++)if(world.path[i].kind==='random'&&!world.path[i].used)world.path[i]={...world.path[i],kind:'scenario-event',event:E.pick(questionEvents,r)};
  E.apply(world,row.action,r);
  // Hold the model's real rules and local card strategy, but do not pretend
  // that a planning-window boundary is a finish cell. Stop at unseen terrain.
  for(let depth=0;depth<3&&!world.ended&&world.life>0&&!world.frontier;depth++){
   const a=helpers.policy(world,r);if(!a)break;E.apply(world,a,r);
  }
  const value=world.life>0?helpers.potential(world):E.score(world);
  row.sum+=value;row.square+=value*value;row.rainbows+=world.chests.filter(x=>x===6).length;row.deaths+=+(world.life<=0);row.frontiers+=+!!world.frontier;row.n++;
 }
 return {
  step(batch=4){for(let n=0;n<batch&&done<samples;n++,done++)for(const row of rows)one(row,done);return done>=samples;},
  result(){const options=rows.map(row=>({action:row.action,label:label(row.action),mean:row.sum/row.n,se:Math.sqrt(Math.max(0,row.square/row.n-(row.sum/row.n)**2)/row.n),rainbows:row.rainbows/row.n,deathRisk:row.deaths/row.n,frontierRate:row.frontiers/row.n,samples:row.n,verified:false,verificationSamples:0}));
   options.sort((a,b)=>b.mean-a.mean||b.rainbows-a.rainbows||a.deathRisk-b.deathRisk||(a.action.kind==='die'?0:1)-(b.action.kind==='die'?0:1));
   helpers.protectExit?.(s,options);
   return {options,best:options[0],target:helpers.target(s,options[0].action),samples,totalRollouts:done*rows.length,localHorizon:true,estimatedHidden:false,unknownEvents:s.path.some(t=>t.kind==='random'||t.kind==='note'),exact:false,exactEndgame:false,verifiedCandidates:0,continuationStates:0};
  }
 };
}
module.exports={createJob};
