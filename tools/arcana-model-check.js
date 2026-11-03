'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../desktop/lib/arcana/engine'),Q=require('../desktop/lib/arcana/question-model'),C=require('../desktop/lib/arcana/capacity-plan'),S=require('../desktop/lib/arcana/solver');
const state=()=>E.normalize({...E.blank(96),position:12,life:2,die:2,hand:[3,6,24],chests:[2,3,3],confirmed:true,lengthConfirmed:true,pathMode:{type:'special3',length:96,source:'game-log-patterns',confirmed:true,confidence:1}});
const a=state(),before=JSON.stringify(a),base=C.cost(a);assert(base>0);assert.equal(JSON.stringify(a),before);
const full={...a,chests:Array(7).fill(2)};assert.equal(C.cost(full),0);assert.equal(C.cost({...a,pathMode:null}),0);assert.equal(C.cost({...a,life:0}),0);
const almostFull={...a,chests:Array(6).fill(2)};assert(C.cost(almostFull)>base,'The final free slot lost its opportunity cost');
const hiddenA=E.clone(a),hiddenB=E.clone(a);hiddenA.revealed=hiddenB.revealed=24;
for(let i=25;i<96;i++){hiddenA.path[i]={kind:'chest',tier:6,sampled:true};hiddenB.path[i]={kind:'empty',sampled:true};}
assert.equal(C.cost(hiddenA),C.cost(hiddenB),'Capacity planning peeked at sampled hidden tiles');
const changed=E.clone(a);changed.path[30]={kind:'trap'};assert.equal(C.cost(changed),0,'Reservation trusted a stage model contradicted by an observed trap');
const weak=E.clone(almostFull);weak.path[14]={kind:'chest',tier:2};assert(S.valueOf(weak,14)<0,'The last slot was treated as free for a weak early chest');weak.path[14]={kind:'chest',tier:6};assert(S.valueOf(weak,14)>0,'Slot reservation rejected the highest possible rarity');
const draws=100000,rng=E.rng(0x51554553),counts=new Map();for(let i=0;i<draws;i++){const id=Q.sample(a,rng);assert(E.DATA.events[id]);counts.set(id,(counts.get(id)||0)+1);}
const total=Q.outcomes.reduce((n,o)=>n+o.weight,0);for(const o of Q.outcomes){const expected=draws*o.weight/total,actual=counts.get(o.id)||0;assert(Math.abs(actual-expected)<6*Math.sqrt(expected)+8,'Question prior drifted: '+o.id);}
assert((counts.get(9219)||0)/draws<.004,'Rare all-rainbow mutation retained the uniform 4% probability');
const legacy={...a,pathMode:null},uniform=new Map(),old=E.rng(0x51554553);for(let i=0;i<25000;i++){const id=Q.sample(legacy,old);assert(id>=9201&&id<=9225);uniform.set(id,(uniform.get(id)||0)+1);}assert.equal(uniform.size,25);assert((uniform.get(9219)||0)>800);
const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),questionDraws:draws,fittedWeightsVerified:true,unconfirmedModeKeepsLegacyPrior:true,highestRarityMutationRate:(counts.get(9219)||0)/draws,capacityPlanningIgnoresSampledHiddenCells:true,confirmedStageRequired:true,observedTrapDisablesReservation:true,finalSlotProtected:true,scope:'Prior sampling and rollout heuristic invariants, not a measured strategy improvement or calibrated server odds.',gameCapture:false,gameInput:false};
fs.writeFileSync(path.join(__dirname,'results/arcana-models.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: 100000 fitted question draws, rare-event calibration, legacy fallback and finite chest-slot planning without hidden-world peeking.');
