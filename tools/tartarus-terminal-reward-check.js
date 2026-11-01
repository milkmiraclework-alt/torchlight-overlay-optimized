'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),T=require('../js/engine'),S=require('../js/solver'),A=require('../js/assessment'),R=require('../js/rust-solver');
function fixture(){
 const s=T.newGame({seed:'TERMINAL-REWARD-20261102',params:{startInmates:0,startTools:0,rewards:false,eventStartChance:0,eventMorningChance:0,eventFollowChance:0,eventWalkChance:0,eventActionChance:0}});
 s.pending=[];s.phase='manage';s.day=s.maxDays;
 for(let n=1;n<16;n++)T.editCell(s,n,{kind:'empty'});
 for(const [n,beast,tier]of [[3,'mammoth',4],[4,'rat',2],[5,'wolf',2],[6,'rat',1],[8,'mammoth',4],[10,'wolf',1],[11,'rat',3],[12,'mammoth',1],[15,'lion',4]])assert(T.editCell(s,n,{kind:'open',beast,tier}).ok);
 for(const tool of ['collar','tongs'])assert(T.addTool(s,tool).ok);
 s.position=6;s.pending=[{kind:'gift',options:['ring','wine','horn','brand']}];return s;
}
async function main(){
 const core=await R.fromBytes(fs.readFileSync('js/solver-core.wasm')),s=fixture(),before=JSON.stringify(s);
 const active=A.score(s,0);assert.equal(active,A.rainbows(s)+.25*A.reds(s),'Active continuation model changed');
 const ended=S.clone(s);ended.phase='ended';ended.pending=[];assert(A.reds(ended)>0);assert.equal(A.score(ended,0),0,'Ended red inmates retained future value');
 assert.equal(core.request({op:'assessment',state:ended,initialVault:0}).score,0);
 const seeds=[117,937,8819],rows=[];
 for(const seed of seeds){
  const r=core.request({op:'solve',state:s,assessment:true,rollouts:8000,seed}),values=r.rows.map(row=>({id:row.action.id,mean:row.vals.reduce((a,b)=>a+b,0)/r.rounds,rainbows:row.rainbow.sum/r.rounds})).sort((a,b)=>b.mean-a.mean);
  assert.equal(values[0].id,'horn');assert.equal(values[0].rainbows,1);assert(values.find(r=>r.id==='wine').rainbows<.8);rows.push({seed,options:values});
  if(seed===117){const j=S.solve(s,{assessment:true,rollouts:8000,seed});let result;do{result=j.step(100);}while(!result.done);assert.equal(result.options[0].action.id,'horn');for(const row of result.options){const rust=values.find(v=>v.id===row.action.id);assert(Math.abs(row.mean-rust.mean)<1e-9);assert(Math.abs(row.rainbows-rust.rainbows)<1e-9);}}
 }
 assert.equal(JSON.stringify(s),before,'Solving modified the input board');
 let baseline=null;const file='sandbox/tartarus-brain-baseline-20261102/js/solver-core.wasm';
 if(fs.existsSync(file)){const old=await R.fromBytes(fs.readFileSync(file)),r=old.request({op:'solve',state:s,assessment:true,rollouts:8000,seed:117});baseline=r.rows.map(row=>({id:row.action.id,mean:row.vals.reduce((a,b)=>a+b,0)/r.rounds,rainbows:row.rainbow.sum/r.rounds})).sort((a,b)=>b.mean-a.mean);assert.equal(baseline[0].id,'wine','Frozen counterexample no longer reproduced');}
 fs.writeFileSync('tools/results/tartarus-terminal-reward.json',JSON.stringify({checkedAt:new Date().toISOString(),version:require('../desktop/package.json').version,scope:'Constructed final-day gift position, fixed 8000 rollout budget; not a full-run profit measurement',gameCapture:false,gameInput:false,activeAssessmentUnchanged:true,endedRedBonusRemoved:true,baseline,corrected:rows},null,2)+'\n');
 console.log('PASS: ended red inmates have no continuation value; 8000-sample final-day choice selects guaranteed Rainbow over ~0.68 Rainbow Wine, three seeds, exact Rust/JS parity and immutable input.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture};
