'use strict';
// Optional black-box comparison. The reference stays outside the product;
// its original modules execute in their matching Electron runtime unchanged.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
try{require('node:os').setPriority(0,10);}catch{}
process.on('uncaughtException',e=>{console.error(e.message);process.exit(1);});
if(!process.versions.electron){const r=cp.spawnSync(path.resolve(__dirname,'../desktop/node_modules/electron/dist/electron.exe'),[__filename,...process.argv.slice(2)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'inherit'});process.exit(r.status??1);}
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const dir=path.resolve(arg('--reference','')),N=Number(arg('--boards',32)),samples=Number(arg('--samples',256)),offset=Number(arg('--offset',0)),stressRarity=process.argv.includes('--stress-rarity'),length=Number(arg('--length',80));
const output=path.resolve(arg('--output','tools/results/arcana-comparison.json'));
const questionRate=Number(arg('--question-rate',0));
const rngMode=arg('--rng-mode','step');if(!['step','cell'].includes(rngMode))throw Error('Unknown environment RNG mode');
const environmentVersion=rngMode==='cell'?2:1;
const productionSeed=process.argv.includes('--production-seed');
if(questionRate<0||questionRate>.36)throw Error('Question rate must be between 0 and 0.36');
if(!Number.isInteger(length)||length<8||length>400||!Number.isInteger(N)||N<1)throw Error('Invalid benchmark length or board count');
if(!fs.existsSync(path.join(dir,'companion/core/solver.jsc')))throw Error('Supply --reference <unmodified Arcana Helper directory>');
require(path.join(dir,'companion/jsc-loader'));const R=require(path.join(dir,'companion/core/engine.jsc')),RS=require(path.join(dir,'companion/core/solver.jsc'));
const E=require('../desktop/lib/arcana/engine'),solverPath=path.resolve(arg('--solver',path.join(__dirname,'../desktop/lib/arcana/solver.js'))),solverSha256=crypto.createHash('sha256').update(fs.readFileSync(solverPath)).digest('hex'),S=require(solverPath),quiet=process.argv.includes('--quiet');
const reuseFile=arg('--reuse-reference',null),reuseReport=reuseFile?JSON.parse(fs.readFileSync(path.resolve(reuseFile),'utf8')):null,reused=reuseReport?new Map(reuseReport.pairs.map(p=>[p.seed,p.reference])):null,observeAll=process.argv.includes('--observe-all'),policyOnly=process.argv.includes('--policy-only');
if(reuseReport&&((reuseReport.pathLength||80)!==length||!!reuseReport.diagnostic?.stressRarity!==stressRarity||(reuseReport.questionRate||0)!==questionRate||(reuseReport.environmentRng||'step')!==rngMode||(reuseReport.environmentVersion||1)!==environmentVersion))throw Error('Saved reference board generator or RNG coupling does not match this benchmark');
const tiers=['','green','blue','purple','orange','red','rainbow'];
const traceAt=arg('--trace',null),trace=[];
function cardId(c){if(c.type==='move')return c.n;if(c.type==='back')return 10+c.n;if(c.type==='upgrade')return 200+['blue','purple','orange','red'].indexOf(c.from)+1+10*((c.count||1)-1);return {move_odd:21,move_even:22,back_any:23,move_any:24}[c.type];}
function tile(t){let out;
 if(t.type==='chest')out={kind:'chest',tier:tiers.indexOf(t.rarity)};
 else if(t.type==='trap')out={kind:'trap',amount:1};
 else if(t.type==='life')out={kind:'heal',amount:t.fixedN||1};
 else if(t.type==='movement')out={kind:'effect',id:1020+(t.cardCount||1)};
 else if(t.type==='upgrade')out={kind:'effect',id:1101+['blue','purple','orange','red'].indexOf(t.fixedFrom)};
 else if(t.type==='unknown')out={kind:'unknown'};
 else if(t.type==='question')out={kind:'random'};
 else if(t.type==='empty'||t.type==='start')out={kind:'empty'};
 else throw Error('Unsupported reference tile in benchmark: '+t.type);
 if(t.used)out.used=true;return out;
}
function model(s){const end=observeAll?s.total-1:Math.min(s.total-1,(Math.floor(s.maxPos/4)+5)*4-1);return {...E.blank(s.total),position:s.pos,life:s.life,die:s.currentMove,hand:s.hand.map(c=>{const id=cardId(c);if(!E.CARDS.has(id))throw Error('Unsupported card: '+JSON.stringify(c));return id;}),chests:s.collected.map(t=>tiers.indexOf(t)),path:s.tiles.map((t,i)=>i<=end?tile(t):{kind:'unknown'}),confirmed:true,lengthConfirmed:true};}
function referenceAction(a,s){const legal=R.actions(s);
 if(a.kind==='end')return legal.find(x=>x.kind==='end');
 if(a.kind==='die')return legal.find(x=>x.kind==='current'&&!x.cycle);
 // A refill requests one genuine random die; the next decision reads its face.
 if(a.kind==='reroll')return legal.find(x=>x.kind==='current'&&x.cycle);
 if(a.kind==='discard')return legal.find(x=>x.kind==='discard'&&x.idx===a.index);
 if(a.kind==='card'){
  const card=E.CARDS.get(a.selected??a.id),event=card.events.map(i=>E.DATA.events[i]).find(e=>e.fn===100),delta=event?.a[0];
  return legal.find(x=>x.idx===a.index&&(x.kind==='upgrade'||x.kind==='hand'&&x.n===Math.abs(delta)&&x.dir===Math.sign(delta)))||legal.find(x=>x.kind==='hand'&&x.idx===a.index&&x.target===Math.max(0,Math.min(s.total-1,s.pos+delta)));
 }
}
function board(seed){const r=E.rng(seed),rarities=[1,1,1,1,2,2,2,3,3,4,5,6];return Array.from({length},(_,i)=>{
 if(i===0)return {type:'start'};const x=r();if(x<.15)return {type:'trap'};if(x<.22)return {type:'life',fixedN:1};if(x<.38)return {type:'chest',rarity:tiers[stressRarity?E.pick(rarities,r):E.tileFromId(2010,r).tier]};if(x<.50)return {type:'movement',cardCount:r()<.8?1:2};if(x<.64)return {type:'upgrade',fixedFrom:E.pick(['blue','purple','orange','red'],r)};if(x<.64+questionRate)return {type:'question'};return {type:'empty'};
});}
function mixSeed(value){let x=value>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return (x^x>>>16)>>>0;}
function environment(seed){
 const activations=new Map();let dice=0;
 return (s,action,step)=>{
  if(rngMode==='step'){R.step(s,action,R.makeRng((seed+Math.imul(step+1,0x9e3779b9))>>>0));return;}
  const target=action.target??s.pos,count=activations.get(target)||0,activate=(action.kind==='hand'||action.kind==='current'&&!action.cycle)&&!s.tiles[target]?.used;
  if(activate)activations.set(target,count+1);
  const eventSeed=mixSeed(seed^Math.imul(target+1,0x85ebca6b)^Math.imul(count+1,0xc2b2ae35));
  if(action.kind!=='current'){R.step(s,action,R.makeRng(eventSeed));return;}
  // The public simulator takes one RNG for tile effects and the final refill.
  // Probe a clone to locate that final call, then give effects a cell stream
  // and refills a separate stream. No reference odds are read or transferred.
  const probe=R.clone(s),calls=[],source=R.makeRng(eventSeed),record=Object.fromEntries(Object.keys(source).map(name=>[name,(...args)=>{calls.push({name,range:name==='randint'?args:null});return source[name](...args);} ]));
  const preserved=JSON.stringify(s);R.step(probe,action,record);if(JSON.stringify(s)!==preserved)throw Error('Reference clone changed the live simulator state');
  const last=calls.at(-1),hasRefill=last?.name==='randint'&&last.range[0]===1&&last.range[1]===7;
  if(!hasRefill&&!probe.dead&&!probe.done)throw Error('Could not identify the final refill RNG call: '+JSON.stringify({action,calls}));
  const events=R.makeRng(eventSeed),refill=hasRefill?R.makeRng(mixSeed(seed^0x44494531^Math.imul(++dice,0x9e3779b9))):null;let index=0;
  const coupled=Object.fromEntries(Object.keys(events).map(name=>[name,(...args)=>{const isRefill=hasRefill&&index++===calls.length-1;return (isRefill?refill:events)[name](...args);} ]));
  R.step(s,action,coupled);
 };
}
function play(initial,seed,which){const s=R.clone(initial),clock=[],decisions=[],stepEnvironment=environment(seed);let cutoff=false,cycles=0,lastCycle=false;
 for(let n=0;n<180&&!s.dead&&!s.done;n++){
  const before=traceAt!==null?{position:s.pos,life:s.life,die:s.currentMove,chests:s.collected.slice(),hand:s.hand.map(cardId),visibleFutureChests:s.tiles.flatMap((t,i)=>i>s.pos&&i<=Math.min(s.total-1,(Math.floor(s.maxPos/4)+5)*4-1)&&t.type==='chest'&&!t.used?[{position:i,tier:t.rarity}]:[])}:null;
  const start=performance.now();let action;
  if(which==='reference'){
   const options=RS.evaluate(R.view(s),{objective:'rarity',points:{green:1,blue:1,purple:3,orange:5,red:10,rainbow:25},target:10,rollouts:150,deathLosesLoot:false,search:'halving',verify:3,verifyTimes:1.5,seed:seed+n,weights:{...RS.weightsFor('rarity'),upgrade_gate:1}});
   action=options[0]?.action;
   // The reference's public UI stops suggesting free final-tile cycles
   // after three retries. Calling only evaluate() misses that UI guard.
   if(s.pos===s.total-1&&action?.cycle){cycles++;if(cycles>3)action=options.find(o=>!o.action.cycle)?.action||action;}else cycles=0;
  }
  else {
   const m=model(s);let chosen;
   if(policyOnly){const visible=E.normalize(m);visible.revealed=Math.max(0,...visible.path.flatMap((t,i)=>t.kind!=='unknown'?[i]:[]));chosen=S.policy(visible,E.rng(seed+n),lastCycle);}
   else{const j=S.createJob(m,{samples,allowReroll:cycles<3,rerollBudget:Math.max(0,3-cycles),...(productionSeed?{}:{seed:seed+n})});while(!j.step(16)){}chosen=j.result().best.action;}
   action=referenceAction(chosen,s);if(!action)throw Error('Our advice is not legal in the reference: '+JSON.stringify({chosen,position:s.pos,hand:s.hand,legal:R.actions(s)}));
   if(s.pos===s.total-1&&action.cycle)cycles++;else cycles=0;
  }
  clock.push(performance.now()-start);if(!action)throw Error('No action');if(decisions.length<5)decisions.push({...action});
  stepEnvironment(s,action,n);lastCycle=!!action.cycle;if(n===179)cutoff=true;
  if(before)trace.push({before,action,after:{position:s.pos,life:s.life,die:s.currentMove,chests:s.collected.slice(),hand:s.hand.map(cardId),question:s.lastQuestion||null}});
 }
 return {points:s.collected.reduce((v,t)=>v+E.POINTS[tiers.indexOf(t)],0),rainbows:s.collected.filter(t=>t==='rainbow').length,chests:s.collected.length,died:s.dead,steps:clock.length,calculationMs:clock.reduce((a,b)=>a+b,0),decisions,cutoff,final:{position:s.pos,life:s.life,die:s.currentMove,hand:s.hand.map(cardId)}};
}
const pairs=[];
if(process.argv.includes('--environment-check')){
 if(rngMode!=='cell')throw Error('Environment check requires --rng-mode cell');
 const assert=require('node:assert/strict'),faces=new Set();
 for(let seed=1;seed<=100;seed++){
  const tiles=Array.from({length:8},(_,i)=>i===3?{type:'movement',cardCount:1}:{type:'empty'}),initial=R.newState(tiles,R.makeRng(seed),{handSize:0});initial.hand=[{type:'move',n:3},{type:'move',n:1},{type:'move',n:2}];
  const a=R.clone(initial),b=R.clone(initial),ea=environment(seed),eb=environment(seed);
  ea(a,R.actions(a).find(x=>x.kind==='hand'&&x.n===3),0);
  eb(b,R.actions(b).find(x=>x.kind==='hand'&&x.n===1),0);eb(b,R.actions(b).find(x=>x.kind==='hand'&&x.n===2),19);
  assert.equal(cardId(a.hand.at(-1)),cardId(b.hand.at(-1)),'Extra movement changed the same cell draw');
  const c=R.clone(initial),d=R.clone(initial);c.currentMove=3;d.currentMove=4;environment(seed)(c,R.actions(c).find(x=>x.kind==='current'),0);environment(seed)(d,R.actions(d).find(x=>x.kind==='current'),12);assert.equal(c.currentMove,d.currentMove,'Tile draws changed the next refill face');faces.add(c.currentMove);
  const e=R.clone(initial),f=R.clone(initial);environment(seed)(e,R.actions(e).find(x=>x.kind==='current'),0);environment(seed)(f,R.actions(f).find(x=>x.kind==='current'),77);assert.deepEqual(e,f,'Decision count changed a cell-coupled transition');
 }
 assert.ok(faces.size>1,'Refill coupling accidentally removed randomness');
 fs.writeFileSync(path.resolve(__dirname,'results/arcana-environment.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),trials:100,checks:300,cellDrawIndependentOfApproach:true,refillIndependentOfTileDraws:true,decisionCounterIndependent:true,referenceCloneIsolation:true,gameCapture:false,gameInput:false},null,2)+'\n');console.log('PASS: 300 cell/refill environment checks, preserving stochastic draws and isolating reference clones.');process.exit(0);
}
if(traceAt!==null){const seed=(0x4f435430+Math.imul(Number(traceAt),7919))>>>0,initial=R.newState(board(seed),R.makeRng(seed),{handSize:4}),outcome=play(initial,seed,'ours');fs.writeFileSync(output,JSON.stringify({seed,outcome,trace},null,2));console.log(JSON.stringify(outcome));process.exit(0);}
if(process.argv.includes('--probe')){
 const i=Number(arg('--probe',33)),seed=(0x4f435430+Math.imul(i,7919))>>>0,s=R.newState(board(seed),R.makeRng(seed),{handSize:4}),m=model(s),j=S.createJob(m,{samples});while(!j.step(16)){}console.log(JSON.stringify({m,result:j.result().options}));
 const r=E.rng(7),p=E.normalize(m),dist=S.knownDistribution(p);for(let k=0;k<p.path.length;k++)if(p.path[k].kind==='unknown')p.path[k]={...E.pick(dist,r),sampled:true};p.revealed=19;
 for(let n=0;n<60&&!p.ended&&p.life>0;n++){const a=S.policy(p,r);console.log(JSON.stringify({pos:p.position,life:p.life,chests:p.chests,hand:p.hand,a}));E.apply(p,a,r);p.revealed=Math.max(p.revealed,(Math.floor(p.position/4)+5)*4-1);}
 process.exit(0);
}
for(let i=0;i<N;i++){const seed=(0x4f435430+Math.imul(i+offset,7919))>>>0,initial=R.newState(board(seed),R.makeRng(seed),{handSize:4}),a=play(initial,seed,'ours'),b=reused?reused.get(seed):play(initial,seed,'reference');if(!b)throw Error('No saved reference outcome for seed '+seed);pairs.push({seed,ours:a,reference:b});fs.writeFileSync(output+'.partial.json',JSON.stringify({incomplete:true,pathLength:length,samples,boardOffset:offset,solverSha256,pairs}));if(!quiet||i%8===7)console.log(JSON.stringify({pair:i+1,ours:a.points,reference:b.points,oursRainbow:a.rainbows,referenceRainbow:b.rainbows,meanDifference:pairs.reduce((n,p)=>n+p.ours.points-p.reference.points,0)/pairs.length,ms:Math.round(a.calculationMs+b.calculationMs)}));}
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
function summary(key){return Object.fromEntries(['points','rainbows','chests','steps','calculationMs'].map(k=>[k,mean(pairs.map(p=>p[key][k]))]).concat([['deathRate',mean(pairs.map(p=>+p[key].died))],['cutoffs',pairs.filter(p=>p[key].cutoff).length]]));}
const delta=pairs.map(p=>p.ours.points-p.reference.points),avg=mean(delta),sd=Math.sqrt(delta.reduce((a,b)=>a+(b-avg)**2,0)/Math.max(1,N-1)),half=1.96*sd/Math.sqrt(N);
const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),method:'Both policies play the same independently generated 80-tile synthetic boards through the unmodified reference simulator, with the same initial hand and per-step RNG seeds. Only current + 4 rows are passed to either policy. Reference uses its public UI Normal/Smart/Save upgrades settings and its UI three-cycle guard. No reference code or odds copied into product.',referenceVersion:require(path.join(dir,'desktop/package.json')).version,referenceSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'companion/core/solver.jsc'))).digest('hex'),boards:N,boardOffset:offset,chestRarity:stressRarity?'Deliberately rich stress-test mixture':'Local game configuration tile 2010 (40/30/20/8/1.6/0.4%)',tileMixture:{trap:.15,life:.07,chest:.16,movementNote:.12,upgradeNote:.14,empty:.36},ownSamples:samples,referenceRequestedRollouts:150,referenceSearch:'halving',referenceVerifyTop:3,referenceVerifyTimes:1.5,referenceSaveUpgrades:true,ours:summary('ours'),reference:summary('reference'),pairedPointDifference:{mean:avg,approx95CI:[avg-half,avg+half]},limitations:['Controlled synthetic tile mixture, not server layouts or real profit.','Question events and special boards excluded.','RNG seeds are paired per decision; differing actions can consume different numbers of random draws.','Finite sample Monte Carlo: matching decisions or superiority are not guaranteed.','This compares solver decisions with public UI defaults, not complete live reader/application behaviour.'],gameCapture:false,gameInput:false,pairs};
report.pathLength=length;report.questionRate=questionRate;report.environmentRng=rngMode;report.environmentVersion=environmentVersion;report.ownDecisionSeed=productionSeed?'production default':'paired seed + decision';report.ownFinalCycleLimit=3;report.tileMixture.question=questionRate;report.tileMixture.empty-=questionRate;report.ownVerification={top:3,additionalSamplesPerFinalist:samples*2,verifyExposedLeader:true};report.diagnostic={solverSha256,observeAll,policyOnly,reusedReference:!!reused,stressRarity};
if(rngMode==='cell'){report.method=report.method.replace('per-step RNG seeds','cell-effect and refill-stream seeds');report.limitations[2]='Cell activation effects and refill streams are paired independently; different paths or conditional effects can still consume different draws.';}
if(questionRate>0){report.limitations[1]='Synthetic question frequency; the unmodified reference simulator resolves its own question outcomes. Our policy has no access to its private event odds. Special server layouts excluded.';}
if(observeAll)report.limitations.push('DIAGNOSTIC ONLY: our policy sees the full board; this is not a fair quality comparison.');
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');fs.unlinkSync(output+'.partial.json');console.log(JSON.stringify({ours:report.ours,reference:report.reference,delta:report.pairedPointDifference}));
