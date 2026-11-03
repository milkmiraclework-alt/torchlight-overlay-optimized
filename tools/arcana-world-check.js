'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const E=require('../desktop/lib/arcana/engine'),W=require('../desktop/lib/arcana/world-sampler'),S=require('../desktop/lib/arcana/solver');
const model=type=>({...E.blank(W.lengths[type]),position:8,life:3,die:2,hand:[3,12,204],chests:[3,5],confirmed:true,lengthConfirmed:true,pathMode:{type,length:W.lengths[type],source:'game-log-patterns',confirmed:true,confidence:.999}});
let worlds=0;const stages={},decisions=[];
for(const type of Object.keys(W.lengths)){
 const raw=model(type);raw.path[0]={kind:'empty',used:true};raw.path[2]={kind:'chest',tier:6};raw.path[3]={kind:'heal',amount:3};raw.path[4]={kind:'grant',id:3};raw.path[5]={kind:'unknown',look:'chest',used:true};
 for(let i=10;i<raw.path.length;i++)raw.path[i]={kind:'unknown',look:['plain','icon','chest'][i%3]};
 const s=E.normalize(raw),before=JSON.stringify(s);assert(W.available(s));assert.deepEqual(E.normalize(s).pathMode,s.pathMode,'Normalizing twice lost the route model');
 for(let seed=1;seed<=100;seed++){
  const world=W.sample(s,E.rng(seed));assert(world);assert.equal(JSON.stringify(s),before,'Sampling changed an observed state');
  for(const i of [0,2,3,4,8])assert.deepEqual(world[i],s.path[i]);assert.deepEqual(world[5],{kind:'empty',used:true,sampled:true});
  for(let i=10;i<world.length;i++){
   const t=world[i],look=s.path[i].look;assert(t.sampled);if(look==='chest')assert(t.kind==='chest'&&t.tier>=1&&t.tier<=6);if(look==='plain')assert(['empty','effect','grant'].includes(t.kind),'A plain logged cell sampled as '+t.kind);if(look==='icon')assert(['trap','heal','random','grant'].includes(t.kind)||t.kind==='effect'&&t.id>=1021&&t.id<=1023,'An icon logged cell sampled as '+t.kind);
  }
  const after={...E.clone(s,true),path:world};E.apply(after,{kind:'die'},E.rng(seed));assert.equal(JSON.stringify(s),before,'A rollout changed shared observations');worlds++;
 }
 const unknown=E.normalize(model(type)),early=[],late=[];for(let seed=1;seed<=100;seed++){const sample=W.sample(unknown,E.rng(seed));early.push(...sample.slice(1,20));late.push(...sample.slice(-20));}
 stages[type]={earlyChestTiers:early.filter(t=>t.kind==='chest').map(t=>t.tier),lateChestTiers:late.filter(t=>t.kind==='chest').map(t=>t.tier),lateUpgrades:late.filter(t=>t.kind==='effect'&&t.id===1104).length};
 const job=S.createJob(raw,{samples:8,verifySamples:16});while(!job.step(16)){}const result=job.result();assert(result&&Number.isFinite(result.best.mean));assert.equal(result.hiddenModel,'route-layout');assert.equal(result.model.path[10].kind,'unknown','A sampled tile became a confirmed observation');decisions.push({type,mean:result.best.mean,action:result.best.action,hiddenModel:result.hiddenModel});
}
assert(stages.special1.lateUpgrades>0);assert.equal(stages.special1.lateChestTiers.length,0);assert(stages.special2.lateChestTiers.length>0);assert.equal(stages.special2.lateUpgrades,0);
assert(stages.special3.lateChestTiers.reduce((a,b)=>a+b,0)/stages.special3.lateChestTiers.length>stages.special3.earlyChestTiers.reduce((a,b)=>a+b,0)/stages.special3.earlyChestTiers.length);assert(stages.special4.lateChestTiers.every(t=>t===6));
const bad=model('normal');bad.pathMode.confidence=.9;assert.equal(W.available(bad),false);assert.equal(E.normalize(bad).pathMode,undefined);assert.equal(W.available({...model('normal'),localHorizon:true}),false);assert.equal(W.available({...model('normal'),path:Array(60).fill({kind:'unknown'})}),false);
const grant=E.normalize({...model('normal'),position:1,die:1,hand:[],path:Array.from({length:80},(_,i)=>i===2?{kind:'grant',id:3}:{kind:'empty'})});E.apply(grant,{kind:'die'},E.rng(2));assert.deepEqual(grant.hand,[3]);grant.position=1;E.apply(grant,{kind:'die'},E.rng(2));assert.deepEqual(grant.hand,[3],'A fixed note could be collected twice');
// Condition the route quota on prior rewards, even though those cells can
// never pay out again. Erasing eight observed chests used to invent another
// full route's worth of chests in its remaining hidden part.
const Reference=require('../desktop/lib/arcana/timer-reader/route-engine'),consumed=E.normalize({...model('normal'),position:9,path:Array.from({length:80},(_,i)=>i>=1&&i<=7?{kind:'chest',tier:2,used:true}:i===8?{kind:'unknown',look:'chest',used:true}:{kind:'unknown'})});
let remaining=0;
for(let seed=1;seed<=100;seed++){
 const mixed=Math.imul(seed,0x9e3779b9)>>>0,random=E.rng(mixed),reference={total:80,boardType:'normal',futureUpgrade:0,tiles:Array.from({length:80},(_,i)=>i===0?{type:'start'}:i>=1&&i<=8?{type:'chest',rarity:i===8?null:'blue',used:true}:i===9?{type:'empty',used:true}:{type:'hidden'})};
 Reference.determinize(reference,Reference.makeRng(Math.floor(random()*0x100000000)));const sample=W.sample(consumed,E.rng(mixed)),got=sample.slice(10).filter(t=>t.kind==='chest').length,want=reference.tiles.slice(10).filter(t=>t.type==='chest').length;assert.equal(got,want,'Consumed rewards were forgotten by the layout prior');assert(got<=2);assert(sample.slice(1,9).every(t=>t.used));remaining+=got;
 const cold=E.clone(consumed);for(let i=1;i<=8;i++)cold.path[i]={kind:'empty',used:true,look:'chest'};const normalized=E.normalize(cold);assert.equal(normalized.path[1].look,'chest');assert(W.sample(normalized,E.rng(mixed)).slice(10).filter(t=>t.kind==='chest').length<=2,'A consumed chest appearance lost its quota without a remembered rarity');
}
assert(remaining<200);
const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),worlds,observationsPreserved:true,appearanceConstraintsPreserved:true,consumedUnknownNotRecreated:true,consumedChestsConditionRemainingQuota:true,consumedQuotaTrials:100,consumedAppearanceWithoutRarityPreserved:true,meanRemainingChestsAfterEightConsumed:remaining/100,fixedNoteGrant:true,stageSpecificLayoutsPreserved:true,unconfirmedAndLocalModelsRejected:true,decisions,gameCapture:false,gameInput:false};fs.writeFileSync(path.join(__dirname,'results/arcana-worlds.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: '+worlds+' hidden worlds, all five modes, observed/consumed cells, hard appearance constraints, fixed-note grants, conditioned remaining chest quotas and actual solver decisions.');
