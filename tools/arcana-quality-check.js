'use strict';
// Independent process shards, not multiple assistants. Reference code remains
// outside the product. Freeze the policy before launching a held-out sample.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const arg=(n,d)=>{const i=process.argv.indexOf(n);return i<0?d:process.argv[i+1];};
const reference=arg('--reference'),scratch=path.resolve(arg('--scratch','sandbox/arcana-quality')),output=path.resolve(arg('--output','tools/results/arcana-comparison.json'));
const boards=Number(arg('--boards',128)),shards=Number(arg('--shards',4)),offset=Number(arg('--offset',8192)),samples=Number(arg('--samples',256)),length=Number(arg('--length',80));
const questionRate=Number(arg('--question-rate',0)),reuseReference=arg('--reuse-reference',null);
const rngMode=arg('--rng-mode','step');
if(!reference||!Number.isInteger(shards)||shards<1||boards%shards)throw Error('Supply --reference, and a board count divisible by --shards');
const solver=path.resolve(arg('--solver','desktop/lib/arcana/solver.js')),hash=()=>crypto.createHash('sha256').update(fs.readFileSync(solver)).digest('hex'),initialHash=hash();
const criterion={declaredBeforeRun:true,objective:'Final rarity points',meanAtLeastReference:true,maximumNonInferiorityMarginFraction:.05,confidence:'Approximate two-sided 95% paired interval',zeroCutoffs:true};
fs.mkdirSync(scratch,{recursive:true});fs.writeFileSync(path.join(scratch,'plan.json'),JSON.stringify({checkedAt:new Date().toISOString(),boards,offset,samples,length,questionRate,solverSha256:initialHash,criterion},null,2));
(async()=>{
 const files=await Promise.all(Array.from({length:shards},(_,i)=>new Promise((resolve,reject)=>{
  const file=path.join(scratch,`shard-${i}.json`),args=[path.resolve(__dirname,'arcana-compare.js'),'--reference',reference,'--solver',solver,'--boards',String(boards/shards),'--offset',String(offset+i*boards/shards),'--samples',String(samples),'--length',String(length),'--question-rate',String(questionRate),'--quiet','--output',file];
  args.push('--rng-mode',rngMode);if(process.argv.includes('--production-seed'))args.push('--production-seed');if(reuseReference)args.push('--reuse-reference',path.resolve(reuseReference));
  const child=cp.spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),log=fs.createWriteStream(path.join(scratch,`shard-${i}.log`));let errors='';
  child.stdout.on('data',data=>{log.write(data);process.stdout.write(`shard ${i}: ${data}`);});child.stderr.on('data',data=>{errors+=data;log.write(data);});child.on('error',reject);child.on('exit',code=>{log.end();if(code)reject(Error(`Shard ${i} exited ${code}: ${errors.slice(-1000)}`));else resolve(file);});
 })));
 const reports=files.map(f=>JSON.parse(fs.readFileSync(f))),report={...reports[0]},pairs=reports.flatMap(r=>r.pairs);
 if(hash()!==initialHash||reports.some(r=>r.diagnostic.solverSha256!==initialHash))throw Error('Solver changed during the comparison');
 if(new Set(pairs.map(p=>p.seed)).size!==boards)throw Error('Repeated comparison seeds');
 const mean=xs=>xs.reduce((n,x)=>n+x,0)/xs.length,interval=key=>{const deltas=pairs.map(p=>p.ours[key]-p.reference[key]),avg=mean(deltas),variance=deltas.reduce((n,x)=>n+(x-avg)**2,0)/(boards-1),half=1.96*Math.sqrt(variance/boards);return {mean:avg,approx95CI:[avg-half,avg+half]};};
 const summary=which=>Object.fromEntries(['points','rainbows','chests','steps','calculationMs'].map(key=>[key,mean(pairs.map(p=>p[which][key]))]).concat([['deathRate',mean(pairs.map(p=>+p[which].died))],['cutoffs',pairs.filter(p=>p[which].cutoff).length]]));
 Object.assign(report,{checkedAt:new Date().toISOString(),boards,boardOffset:offset,pairs,ours:summary('ours'),reference:summary('reference'),pairedPointDifference:interval('points'),pairedRainbowDifference:interval('rainbows')});
 const margin=report.reference.points*criterion.maximumNonInferiorityMarginFraction;
 report.qualityGate={...criterion,maximumLossPoints:margin,passed:report.ours.points>=report.reference.points&&report.pairedPointDifference.approx95CI[0]>-margin&&report.ours.cutoffs===0&&report.reference.cutoffs===0,scope:'Only this controlled generator and reference settings; not live-game or server-layout parity.'};
 report.timingScope='Concurrent benchmark shards; calculation times are not an isolated latency measurement.';
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ours:report.ours,reference:report.reference,points:report.pairedPointDifference,rainbows:report.pairedRainbowDifference,qualityGate:report.qualityGate}));
 if(!report.qualityGate.passed)process.exitCode=2;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
