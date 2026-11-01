'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),T=require('../js/engine'),S=require('../js/solver');
const source=fs.readFileSync(require.resolve('../js/analyze.js'),'utf8').replace(/\r\n/g,'\n'),init='  buildBoard();\n  bind();\n  render();';assert(source.includes(init));
const window={Tartarus:T,TartarusSolver:S,TartarusDesktop:{fast:true}};
vm.runInNewContext(source.replace(init,'  window.test={buildState,blankModel,modelFrom};'),{window,document:{currentScript:null},navigator:{hardwareConcurrency:12},localStorage:{getItem:()=>null}});
const A=window.test;
for(const stage of ['usurp1','usurp2','usurp3','usurp4']){
 const m=A.blankModel();m.cells[0].event=stage;
 const {st}=A.buildState(m);assert.equal(st.eventPool.filter(id=>T.USURP[id]).join(),stage);
 const next=T.USURP[stage].next;st.eventPool=st.eventPool.filter(id=>!T.USURP[id]);if(next)st.eventPool.push(next);st.cells[0].event=null;
 const restored=A.buildState(A.modelFrom(st,m)).st;
 assert.equal(restored.eventPool.join(),st.eventPool.join(),'Rebuilding lost incident progression');
}
const defaults=A.buildState(A.blankModel()).st;assert.equal(defaults.eventPool.join(),T.EVENT_POOL.join());
console.log('PASS: confirmed Usurpation stages and incident pool survive analyzer state rebuilds, including completed stage IV.');
