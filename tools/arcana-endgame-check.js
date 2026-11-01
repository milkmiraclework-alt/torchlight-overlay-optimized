'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),E=require('../desktop/lib/arcana/engine'),S=require('../desktop/lib/arcana/solver'),Exact=require('../desktop/lib/arcana/endgame'),Oracle=require('./arcana-endgame-oracle');
const base=()=>({...E.blank(8),position:5,life:3,die:2,hand:[11,24,204],chests:[4],confirmed:true,lengthConfirmed:true,path:Array.from({length:8},()=>({kind:'empty'}))});
function run(job){while(!job.step(4)){}return job.result();}
const r=E.rng(0x651242),pool=[1,3,11,12,21,22,23,24,31,204,213];let completed=0,limited=0,maxStates=0,maxMs=0;
for(let n=0;n<128;n++){
 const s=base();s.position=4+Math.floor(r()*4);s.life=1+Math.floor(r()*3);s.die=1+Math.floor(r()*6);s.hand=Array.from({length:2+n%2},()=>E.pick(pool,r));s.chests=[1+Math.floor(r()*6),1+Math.floor(r()*6)];
 s.path=s.path.map((_,i)=>{const p=r();return {used:i===s.position,...(p<.3?{kind:'chest',tier:1+Math.floor(r()*6)}:p<.5?{kind:'trap',amount:1}:p<.65?{kind:'heal',amount:1}:{kind:'empty'})};});
 const before=JSON.stringify(s),oracle=Oracle.solve(s),job=Exact.createJob(s),started=performance.now(),actual=run(job);maxMs=Math.max(maxMs,performance.now()-started);maxStates=Math.max(maxStates,job.info().states);
 if(!actual){limited++;continue;}completed++;
 assert(Math.abs(actual.best.mean-oracle.best.value)<1e-9,'Exact final-region value differs from independent oracle');
 for(const row of actual.options){const expected=oracle.options.find(o=>JSON.stringify(o.action)===JSON.stringify(row.action));assert(expected);assert(Math.abs(row.mean-expected.value)<1e-9);}
 assert.equal(JSON.stringify(s),before,'Exact planning modified input');
}
const safe=base();safe.hand=[11,24];safe.path[4]={kind:'chest',tier:6};const exact=run(S.createJob(safe));assert(exact.exactEndgame);assert.equal(exact.best.mean,30);
const global={...safe,path:Array.from({length:72},()=>({kind:'unknown'})).concat(safe.path),position:77};const shifted=run(S.createJob(global));assert(shifted.exactEndgame);assert.equal(shifted.best.mean,exact.best.mean);assert.deepEqual(shifted.best.action,exact.best.action);assert.equal(shifted.target,76);
const unknown=base();unknown.path[4]={kind:'unknown'};assert.equal(Exact.createJob(unknown),null,'Unknown reachable tile entered exact search');
const draw=base();draw.path[6]={kind:'draw',amount:1};assert.equal(Exact.createJob(draw),null,'Random card draw entered exact search');
const fallback=run(S.createJob(safe,{limit:1,samples:16}));assert.notEqual(fallback.exactEndgame,true,'Exhausted exact budget was labelled exact');assert(fallback.totalRollouts>0);
const improvements=require('./arcana-endgame-cases.json').cases;
for(const c of improvements){const result=run(S.createJob(c.state)),oracle=Oracle.solve(c.state);assert(result.exactEndgame);assert(Math.abs(result.best.mean-oracle.best.value)<1e-9);const old=oracle.options.find(o=>JSON.stringify(o.action)===JSON.stringify(c.baseline));assert(old);assert(Math.abs(old.value-c.baselineExactValue)<1e-9);assert(result.best.mean>old.value+.05);}
assert(completed>=100);fs.writeFileSync('tools/results/arcana-endgame.json',JSON.stringify({checkedAt:new Date().toISOString(),version:require('../desktop/package.json').version,scope:'Fully observed bounded final region with deterministic held cards and six uniform refill outcomes',fixtures:128,completed,limited,maxStates,maxMs,independentOracleAgreement:true,improvedCounterexamples:improvements.map(c=>({before:c.baselineExactValue,after:c.candidateExactValue})),croppedAbsoluteTarget:true,unknownAndRandomDrawRejected:true,budgetFallback:true,inputUnchanged:true,gameCapture:false,gameInput:false},null,2)+'\n');
console.log('PASS: exact final-region planning versus independent exhaustive oracle on '+completed+' inventories, all six refill outcomes, absolute tile mapping, unknown/draw guards, bounded fallback and immutable input. '+JSON.stringify({maxStates,maxMs}));
