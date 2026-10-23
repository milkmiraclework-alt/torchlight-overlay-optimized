'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const T=require('../js/engine'),S=require('../js/solver'),R=require('../js/rust-solver');
const at=process.argv.indexOf('--baseline');assert.ok(at>=0&&process.argv[at+1],'Pass --baseline <frozen-local30.wasm>');
const source=fs.readFileSync('js/analyze.js','utf8').replace(/\r\n/g,'\n'),window={Tartarus:T,TartarusSolver:S};
const init='  buildBoard();\n  bind();\n  render();';assert.ok(source.includes(init));
vm.runInNewContext(source.replace(init,'  window.rankForAudit = rankRecommendation;'),{window,document:{currentScript:null},navigator:{hardwareConcurrency:4},localStorage:{getItem:()=>null}});
(async()=>{
 const old=await R.fromBytes(fs.readFileSync(process.argv[at+1])),current=await R.fromBytes(fs.readFileSync('js/solver-core.wasm'));
 const states=[];
 const sets=[[],['trap'],['saw','whip','trap'],['maiden','rope'],['guillotine','crown','skewer']];
 for(let set=0;set<sets.length;set++)for(let i=0;i<2;i++){
  const st=T.newGame({seed:`CONSUME31-INDEPENDENT-${set}-${i}`,startEvent:set===3?'opulence':null});st.pending=[];for(const tool of sets[set])assert.ok(T.addTool(st,tool).ok);
  const seen=new Set();
  S.playout(st,{...S.paramsFor(st),terminalGifts:false},S.rng32(310002+i),(_a,_r,s)=>{
   if(s.phase==='manage'&&!s.pending.length&&!s.chaining&&[2,5,9,13,17,20].includes(s.day)&&!seen.has(s.day)&&S.candidates(s).length>1&&s.vault.length<10){seen.add(s.day);states.push({set,i,state:S.clone(s)});}
  });
 }
 const counts=[{},{}],differences=[];let index=0;
 for(const {set,i,state}of states){
  const actions=[];
  for(const [v,core]of [old,current].entries()){
   const raw=core.request({op:'solve',state,rollouts:400,seed:0x313131+index});
   const rows=raw.rows.map(r=>({...r,label:JSON.stringify(r.action),vals:r.vals.map(v=>v===null?NaN:v)}));
   const p=rows.find(r=>r.policy),summary=S.summarize(rows,raw.rounds,400,raw.goal);
   const result=window.rankForAudit(state,p?{action:p.action,label:p.label,why:''}:null,summary);assert.ok(result);
   actions.push(result.action);counts[v][result.action.type]=(counts[v][result.action.type]||0)+1;
  }
  if(!S.sameAction(actions[0],actions[1]))differences.push({set,i,day:state.day,before:actions[0],after:actions[1]});
  index++;if(index%10===0)console.log('positions',index,'changed',differences.length);
 }
 const report={checkedAt:new Date().toISOString(),baseline:'Frozen local.30 WASM',current:'local.31 WASM, same core used by unified 1.0.0',rolloutsPerAction:400,positions:states.length,before:counts[0],after:counts[1],changed: differences.length,differences,
  limitations:'Independent synthetic observed manage positions, identical states and shared rollout seeds, production recommendation threshold. Not the distribution of user boards and not a global guarantee of strategy quality. No changes to the ordinary Consume score were made by local.31.',gameCapture:false,gameInput:false};
 fs.writeFileSync('tools/results/consume-local31-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
