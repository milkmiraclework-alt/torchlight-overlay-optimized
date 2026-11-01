'use strict';
// Compare our own frozen adviser with the candidate on the same independent
// local-rule worlds. This is a policy regression check, not server-profit proof.
const E=require('../desktop/lib/arcana/engine'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const baseline=path.resolve(arg('--baseline','sandbox/arcana-brain-baseline-20261102/solver.js')),candidate=path.resolve(arg('--candidate','desktop/lib/arcana/solver.js')),Old=require(baseline),New=require(candidate),N=Number(arg('--boards',32)),offset=Number(arg('--offset',131072)),length=Number(arg('--length',32)),pairs=[];
const output=arg('--output','tools/results/arcana-owned-quality.json');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),fingerprints={baseline:hash(baseline),candidate:hash(candidate)};
function world(seed,stress){
 const r=E.rng(seed),s=E.blank(length);Object.assign(s,{position:0,life:3,die:1+Math.floor(r()*6),hand:stress?[24,11,213,53,222,58]:[1,3,11,24,201,204],chests:stress?[2,3,2,2]:[],confirmed:true,lengthConfirmed:true});
 s.path=s.path.map((_,i)=>{if(!i)return {kind:'empty',used:true};const n=r();return n<.25?{kind:'chest',tier:1+Math.floor(r()*6)}:n<.42?{kind:'trap',amount:1}:n<.50?{kind:'heal',amount:1}:n<.58?{kind:'draw',amount:1}:{kind:'empty'};});return s;
}
function play(S,initial,seed){
 const s=E.clone(initial),started=performance.now();let steps=0;
 for(;steps<160&&!s.ended&&s.life>0;steps++){
  const visible=Math.min(s.path.length-1,(Math.floor(s.position/4)+5)*4-1),model={...E.clone(s),path:s.path.map((t,i)=>i<=visible?{...t}:{kind:'unknown'})};
  const j=S.createJob(model,{samples:128});while(!j.step(16)){}const a=j.result().best.action;
  E.apply(s,a,E.rng((seed^Math.imul(steps+1,0x9e3779b9))>>>0));
 }
 return {points:E.score(s),rainbows:s.chests.filter(t=>t===6).length,steps,cutoff:steps>=160&&!s.ended&&s.life>0,calculationMs:performance.now()-started};
}
for(let n=0;n<N;n++){
 const seed=offset+n,stress=n%2===1,initial=world(seed,stress),a=play(Old,initial,seed),b=play(New,initial,seed);pairs.push({seed,stress,baseline:a,candidate:b});console.log(JSON.stringify({seed,baseline:a.points,candidate:b.points}));
}
if(hash(baseline)!==fingerprints.baseline||hash(candidate)!==fingerprints.candidate)throw Error('Adviser changed during comparison');
const mean=ns=>ns.reduce((s,n)=>s+n,0)/ns.length,ds=pairs.map(p=>p.candidate.points-p.baseline.points),difference=mean(ds),half=1.96*Math.sqrt(ds.reduce((s,n)=>s+(n-difference)**2,0)/(N-1)/N);
const summary={scope:'Our two policies on seeded local-rule worlds, mixed capped and uncapped upgrades, first 20 tiles visible. Not a server-layout or live profit measurement.',checkedAt:new Date().toISOString(),fingerprints,boards:N,offset,length,samples:128,baselinePoints:mean(pairs.map(p=>p.baseline.points)),candidatePoints:mean(pairs.map(p=>p.candidate.points)),pairedDifference:difference,approx95CI:[difference-half,difference+half],cutoffs:pairs.filter(p=>p.baseline.cutoff||p.candidate.cutoff).length,pairs};
fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,pairs:undefined}));
