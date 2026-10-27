'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const T=require('../js/engine'),S=require('../js/solver'),A=require('../js/assessment'),reference=require('./assessment-reference.json');
const close=(a,b,label)=>assert(Math.abs(a-b)<1e-9,`${label}: ${a} != ${b}`);
(async()=>{
 cp.execFileSync(process.execPath,[require.resolve('./build-assessment-data'),'--check']);
 const core=await require('../js/rust-solver').fromBytes(fs.readFileSync(require.resolve('../js/solver-core.wasm')));
 let maxError=0;
 for(const c of reference.cases){
  const js=A.features(c.state),rust=core.request({op:'assessment',state:c.state,initialVault:c.initialVault});
  for(let i=0;i<229;i++){close(js[i],c.features[i],`${c.name} JS feature ${i}`);close(rust.features[i],c.features[i],`${c.name} Rust feature ${i}`);maxError=Math.max(maxError,Math.abs(rust.features[i]-c.features[i]));}
  for(const [key,value]of [['rainbows',A.rainbows(c.state)],['score',A.score(c.state,c.initialVault)]]){close(value,c[key],`${c.name} JS ${key}`);close(rust[key],c[key],`${c.name} Rust ${key}`);maxError=Math.max(maxError,Math.abs(rust[key]-c[key]));}
 }
 let rows=0;
 for(const index of [0,4,12,18,29,42,55,88]){
  const st=reference.cases[index].state,opts={rollouts:8,seed:1234,assessment:true};
  const expected=S.solve(st,opts);let result;do{result=expected.step(100);}while(!result.done);
  const actual=core.request({op:'solve',state:st,...opts});assert.equal(actual.rounds,result.rounds);assert.equal(actual.rows.length,expected.rows.length);
  for(let i=0;i<actual.rows.length;i++){const a=actual.rows[i],b=expected.rows[i];assert(S.sameAction(a.action,b.action));assert.equal(a.vals.length,b.vals.length);for(let j=0;j<a.vals.length;j++)close(a.vals[j],b.vals[j],`MC ${index}/${i}/${j}`);close(a.rainbow.sum,b.rainbow.sum,'Rainbow total');close(a.rainbow.square,b.rainbow.square,'Rainbow variance');rows++;}
 }
 const probe=S.clone(reference.cases[0].state);probe.phase='ended';probe.vault=Array.from({length:10},(_,i)=>({id:i,beast:T.BEASTS[i%4],day:20}));close(A.rainbows(probe),10,'Ended/capped Rainbow');close(core.request({op:'assessment',state:probe}).rainbows,10,'Rust ended/capped Rainbow');
 console.log(`PASS: ${reference.cases.length} native Giboork reference states, 229 features and both numeric evaluations; max error ${maxError}. Rust/JS MC parity on ${rows} action rows, capped terminal reward, fresh generated data.`);
})().catch(e=>{console.error(e);process.exitCode=1});
