'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../desktop/lib/arcana/engine'),F=require('../desktop/lib/arcana/fixed-reward'),S=require('../desktop/lib/arcana/solver');
const random=E.rng(0x5041594f),kinds=[{kind:'empty'},{kind:'chest',tier:6},{kind:'trap'},{kind:'heal',amount:2},{kind:'copy'},{kind:'grant',id:3},{kind:'effect',id:1023}];
let transitions=0;
for(let seed=1;seed<=200;seed++){
 const s=E.normalize({...E.blank(40),position:10,life:3,die:2,hand:[3,11,21,24],chests:Array.from({length:7},()=>1+Math.floor(random()*6)),path:Array.from({length:40},()=>({...E.pick(kinds,random)})),confirmed:true,lengthConfirmed:true});
 const value=E.score(s),before=JSON.stringify(s);assert(F.fixed(s));assert.equal(JSON.stringify(s),before);
 for(let n=0;n<200&&!s.ended&&s.life>0;n++){const actions=E.actions(s).filter(a=>a.kind!=='end');if(!actions.length)break;E.apply(s,E.pick(actions,random),random);assert.equal(E.score(s),value,'A fixed-payoff continuation changed the reward');transitions++;}
}
const base=E.normalize({...E.blank(40),position:10,life:2,die:2,hand:[3],chests:Array(7).fill(2),path:Array.from({length:40},()=>({kind:'empty'})),confirmed:true,lengthConfirmed:true});
for(const tile of [{kind:'unknown'},{kind:'random'},{kind:'note',amount:1,candidates:[1041,3001]},{kind:'draw'},{kind:'effect',id:1104},{kind:'effect',id:1041},{kind:'grant',id:204}]){const s=E.clone(base);s.path[20]=tile;assert(!F.fixed(s),'Potential future upgrades were ignored: '+JSON.stringify(tile));}
assert(!F.fixed({...base,chests:Array(6).fill(2)}));assert(!F.fixed({...base,hand:[204]}));assert(!F.fixed({...base,pending:{kind:'copy',cards:[204]}}));
const j=S.createJob(base,{samples:16,verifySamples:32});while(!j.step(16)){}assert(j.result().options.every(row=>row.mean===7&&row.rainbows===0),'A fixed payoff changed between current actions');assert.equal(j.result().best.action.kind,'end');
const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),worlds:200,randomLegalTransitions:transitions,fixedRewardPreserved:true,possibleUpgradeAndUnknownRejected:true,pendingOfferGuarded:true,rootEstimatesUnchanged:true,scope:'Exact payoff bound on completed sampled worlds; no hidden observation is exposed to the rollout policy.',gameCapture:false,gameInput:false};
fs.writeFileSync(path.join(__dirname,'results/arcana-fixed-reward.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: fixed payoff on200 worlds/'+transitions+' arbitrary legal continuations; upgrades, unknowns, pending offers and root estimates guarded.');
