'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),T=require('../js/engine'),S=require('../js/solver');
const window={Tartarus:T,TartarusSolver:S,TartarusDesktop:{fast:true}},init='  buildBoard();\n  bind();\n  render();',source=fs.readFileSync('js/analyze.js','utf8').replace(/\r\n/g,'\n');assert(source.includes(init));
vm.runInNewContext(source.replace(init,'  window.audit={blankModel,buildState,modelFrom,cleanPrey,setModel:v=>model=v};'),{window,document:{currentScript:null},navigator:{hardwareConcurrency:4},localStorage:{getItem:()=>null}});
const A=window.audit;
function make(target='wolf',tools=[]){
 const s=T.newGame({seed:'PREY-REBUILD',params:{startInmates:0,startTools:0,rewards:false,eventStartChance:0,eventMorningChance:0,eventFollowChance:0,eventWalkChance:0,eventActionChance:0}});s.pending=[];s.phase='manage';s.position=1;
 for(let n=1;n<16;n++)T.editCell(s,n,{kind:'empty'});
 T.editCell(s,1,{kind:'open',beast:'lion',tier:1});T.editCell(s,2,{kind:'open',beast:target,tier:1});for(const tool of tools)T.addTool(s,tool);assert(T.markPrey(s,1,2).ok);return s;
}
for(const [target,tools]of [['wolf',[]],['mammoth',['crown']]]){
 const s=make(target,tools);s.phase='event';s.event={kind:'usurp1',cell:1};assert(S.apply(s,{type:'event',accept:true}).ok);assert.equal(s.prey.length,1);assert.notEqual(s.cells[1].inmate.tier,s.cells[2].inmate.tier);
 const m=A.modelFrom(s,A.blankModel()),rebuilt=A.buildState(m);assert.deepEqual([...rebuilt.problems],[],'Legal prey promotion blocked reconstruction');assert.equal(rebuilt.st.prey.length,1);assert.equal(rebuilt.st.prey[0].rounds,s.prey[0].rounds);
 A.setModel(m);A.cleanPrey();assert(m.cells[1].prey,'Cleaning the model erased a valid unequal-tier mark');
 const wrong=JSON.parse(JSON.stringify(m));wrong.cells[2]={kind:'empty'};assert(A.buildState(wrong).problems.some(p=>p.includes('prey mark')));
 const changed=JSON.parse(JSON.stringify(m));changed.cells[2].beast=target==='wolf'?'rat':'wolf';assert(A.buildState(changed).problems.some(p=>p.includes('prey mark')),'A changed prey beast retained the old mark');
 const self=JSON.parse(JSON.stringify(m));self.cells[1].prey.cell=1;assert(A.buildState(self).problems.some(p=>p.includes('prey mark')));
}
const invalid=A.blankModel();invalid.step='manage';invalid.cells[1]={kind:'inmate',beast:'lion',tier:1,prey:{cell:2,rounds:2}};invalid.cells[2]={kind:'inmate',beast:'mammoth',tier:2};assert(A.buildState(invalid).problems.some(p=>p.includes('prey mark')),'Incompatible beast was accepted without Crown');
console.log('PASS: legal Usurpation can separate prey rarities; marks survive rebuild/cleanup, Crown is loaded before validating, and missing/self/incompatible targets remain blocked.');
