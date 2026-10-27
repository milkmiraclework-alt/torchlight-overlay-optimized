'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../js/engine'),S=require('../js/solver'),source=fs.readFileSync(require.resolve('../js/analyze.js'),'utf8').replace(/\r\n/g,'\n');
const init='  buildBoard();\n  bind();\n  render();';assert(source.includes(init));
let cacheVersion;
const window={Tartarus:T,TartarusSolver:S,TartarusDesktop:{fast:true},TartarusSolverCache:{create(options){cacheVersion=options.version;return {};}}};
vm.runInNewContext(source.replace(init,'  window.assessment={rankRecommendation,rolloutTarget,makeShares,prepareSolverWorkers};'),{window,document:{currentScript:null},navigator:{hardwareConcurrency:12},localStorage:{getItem:()=>null},Worker:class{postMessage(){}terminate(){}}});
const A=window.assessment,st=T.newGame({seed:'ASSESSMENT-112'});
for(const phase of ['patrol','manage','chain','office','event']){st.phase=phase;st.pending=[];assert.equal(A.rolloutTarget(st),2000);}
for(const kind of ['tool','gift'])for(const rerolls of [0,1,3]){st.pending=[{kind,options:['rope','muzzle'],rerolls}];assert.equal(A.rolloutTarget(st),8000);}
assert(cacheVersion.includes('mc-v3:')&&cacheVersion.includes('move=2000:choice=8000'));
A.prepareSolverWorkers();
for(const target of [2000,8000])assert.equal(A.makeShares(target).reduce((sum,p)=>sum+p.target,0),target);
const end={type:'end'},swap={type:'swap'},pick={action:end,label:'Heuristic',why:'Heuristic rationale'};
for(const gap of [.001,.02,.5])for(const gapSe of [0,.1,1]){
 const leader={action:swap,label:'Simulation leader',mean:5+gap,n:2000,se:.1,gapSe:0};
 const second={action:end,label:'Heuristic',mean:5,n:2000,se:.1,gapSe};
 const result={done:true,rounds:2000,goal:'rainbows',options:[leader,second]};
 const rec=A.rankRecommendation(st,pick,result);
 assert.equal(rec.action,swap,'Heuristic vetoed the completed simulation leader');assert.equal(rec.option,leader);assert(rec.live);
 if(gap<Math.max(1.96*gapSe,.05))assert(rec.close&&rec.why.includes('uncertain'),'A noisy lead was described as certain');
 assert.equal(A.rankRecommendation(st,pick,{...result,done:false}).live,false);
 assert.equal(A.rankRecommendation(st,pick,{...result,early:true}).live,false);
 assert.equal(A.rankRecommendation(st,null,result).action,swap);
 assert.equal(A.rankRecommendation(st,pick,{...result,options:[leader]}).action,swap,'Single legal move used a different heuristic action');
}
assert.equal(A.rankRecommendation(null,pick,null),null);
console.log('PASS: completed Monte Carlo leader wins without heuristic veto; close choices disclose uncertainty, incomplete/capped checks do not lead, forced moves remain legal, 2000/8000 per-option quotas and separate cache namespace.');
