'use strict';
// Freeze all five strata before evaluating any of them. Synthetic layouts
// are authorised reference-model samples, not independent server evidence.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),sources=require('./arcana-policy-sources');
const arg=(n,d)=>{const i=process.argv.indexOf(n);return i<0?d:process.argv[i+1];};
const reference=arg('--reference'),boards=Number(arg('--boards-per-mode',64)),shards=Number(arg('--shards',4)),offset=Number(arg('--offset',200000)),samples=128;
const counts={normal:Number(arg('--normal-boards',boards)),special4:Number(arg('--special4-boards',boards))};
const scratch=path.resolve(arg('--scratch','sandbox/arcana-modes-heldout')),output=path.resolve(arg('--output','tools/results/arcana-modes-comparison.json'));
if(!reference||!Number.isInteger(boards)||boards<2||!Number.isInteger(shards)||shards<1||boards%shards||!Number.isInteger(offset))throw Error('Supply a reference and >=2 boards per mode divisible by the shard count');
if(Object.values(counts).some(n=>!Number.isInteger(n)||n<boards||n%shards))throw Error('Additional stratum counts must be >= the base count and divisible by shards');
const frozen=sources(),version=require('../desktop/package.json').version,modes=['normal','special1','special2','special3','special4'];
const stride=Math.max(1000,boards,...Object.values(counts));
const plan={version,declaredAt:new Date().toISOString(),candidateSources:frozen,samples,environmentRng:'cell',environmentVersion:2,productionSeed:true,boardsPerMode:boards,strata:modes.map((mode,i)=>({mode,boards:counts[mode]||boards,offset:offset+i*stride,output:path.join(scratch,mode+'.json')})),criterion:{aggregateMeanAtLeastReference:true,eachModeMeanLossAtMost:.05,eachModeApprox95LowerBoundLossAtMost:.05,zeroCutoffs:true},scope:'Author-fitted layout generator and unmodified reference simulator only. No measured server or live-reader quality parity.'};
fs.mkdirSync(scratch,{recursive:true});fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(path.join(scratch,'plan.json'),JSON.stringify(plan,null,2)+'\n');
(async()=>{
 const reports=[];
 for(const spec of plan.strata){
  assert.deepEqual(sources(),frozen,'Policy changed after the five-mode plan was declared');
  const code=await new Promise((resolve,reject)=>{const child=cp.spawn(process.execPath,[path.join(__dirname,'arcana-quality-check.js'),'--reference',reference,'--board-mode',spec.mode,'--boards',String(spec.boards),'--shards',String(shards),'--samples',String(samples),'--offset',String(spec.offset),'--rng-mode','cell','--production-seed','--scratch',path.join(scratch,spec.mode),'--output',spec.output],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>process.stdout.write(spec.mode+': '+b));child.stderr.on('data',b=>process.stderr.write(spec.mode+': '+b));child.once('error',reject);child.once('exit',resolve);});
  if(![0,2].includes(code))throw Error(spec.mode+' did not complete: '+code);
  const r=JSON.parse(fs.readFileSync(spec.output));assert.equal(r.version,version);assert.deepEqual(r.candidateSources,frozen);assert.equal(r.boards,spec.boards);assert.equal(r.boardOffset,spec.offset);assert.equal(r.boardMode,spec.mode);assert.equal(r.ownSamples,samples);assert.equal(r.environmentRng,'cell');assert.equal(r.ownDecisionSeed,'production default');reports.push(r);
 }
 assert.deepEqual(sources(),frozen,'Policy changed while the comparison was running');
 assert(reports.every(r=>r.referenceSha256===reports[0].referenceSha256&&r.referenceEngineSha256===reports[0].referenceEngineSha256),'Different reference binaries');
 const pairs=reports.flatMap(r=>r.pairs.map(p=>({...p,mode:r.boardMode}))),mean=xs=>xs.reduce((n,x)=>n+x,0)/xs.length;
 assert.equal(new Set(pairs.map(p=>p.seed)).size,pairs.length,'Overlapping stratum seeds');
 const summary=key=>Object.fromEntries(['points','rainbows','chests','steps','calculationMs'].map(field=>[field,mean(pairs.map(p=>p[key][field]))]).concat([['cutoffs',pairs.filter(p=>p[key].cutoff).length]]));
 const ours=summary('ours'),original=summary('reference'),modeChecks=reports.map(r=>{const margin=r.reference.points*.05;return {mode:r.boardMode,boards:r.boards,ours:r.ours,reference:r.reference,pairedPointDifference:r.pairedPointDifference,maximumLossPoints:margin,passed:r.ours.points>=r.reference.points-margin&&r.pairedPointDifference.approx95CI[0]>-margin&&r.ours.cutoffs===0&&r.reference.cutoffs===0};});
 const passed=ours.points>=original.points&&modeChecks.every(m=>m.passed)&&ours.cutoffs===0&&original.cutoffs===0;
 const report={...plan,checkedAt:new Date().toISOString(),boards:pairs.length,referenceVersion:reports[0].referenceVersion,referenceSha256:reports[0].referenceSha256,referenceEngineSha256:reports[0].referenceEngineSha256,ours,reference:original,qualityGate:{...plan.criterion,passed},modeChecks,pairs,gameCapture:false,gameInput:false,timingScope:'Concurrent process shards; calculation time is not an isolated latency benchmark.'};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({boards:report.boards,ours,reference:original,modeChecks:modeChecks.map(({mode,passed,pairedPointDifference})=>({mode,passed,pairedPointDifference})),passed}));if(!passed)process.exitCode=2;
})().catch(e=>{console.error(e);process.exitCode=1;});
