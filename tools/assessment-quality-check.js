/* Reproducible old/new Tartarus assessment comparison on synthetic worlds.
 * The native core is our own read-only simulator; no game window/input is used.
 * Frozen baseline: git show v1.1.1:js/analyze.js (save as UTF-8).
 * --after-assessment compares the ported continuation evaluator against a
 * frozen analyzer. The actual outcome is still the integer Rainbow vault. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),cp=require('node:child_process'),readline=require('node:readline'),assert=require('node:assert/strict');
if(process.argv.includes('--help')){console.log('node tools/assessment-quality-check.js --baseline-analyzer FILE --core EXE [--before-version 1.1.1|1.2.0] [--after-assessment] [--games 16] [--jobs 4] [--out DIR]');process.exit(0);}
const arg=(name,fallback)=>{const at=process.argv.indexOf('--'+name);return at<0?fallback:process.argv[at+1];};
const baseline=arg('baseline-analyzer'),coreBinary=arg('core');
const beforeVersion=arg('before-version','1.1.1'),afterAssessment=process.argv.includes('--after-assessment');
assert(baseline&&fs.existsSync(baseline),'Pass the frozen UTF-8 v1.1.1 analyzer source');assert(coreBinary&&fs.existsSync(coreBinary),'Pass a native tartarus-core executable built from current sources');
assert(['1.1.1','1.2.0'].includes(beforeVersion));
assert(fs.readFileSync(baseline,'utf8').includes(beforeVersion==='1.1.1'?'const PLAYOUT_BUDGET = 9600':'const MOVE_PLAYOUTS = 2000'),'The frozen baseline does not match the selected version');
const output=path.resolve(arg('out','sandbox/assessment-quality')),jobs=Number(arg('jobs',4));assert(Number.isInteger(jobs)&&jobs>0&&jobs<=32);
const root=path.resolve(__dirname,'..'),T=require(root+'/js/engine'),S=require(root+'/js/solver');
function analyzer(file){const window={Tartarus:T,TartarusSolver:S},source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),init='  buildBoard();\n  bind();\n  render();';assert(source.includes(init));vm.runInNewContext(source.replace(init,'  window.audit={modelFrom,buildState,rankRecommendation,rolloutTarget};'),{window,document:{currentScript:null},navigator:{hardwareConcurrency:4},localStorage:{getItem:()=>null}});return window.audit;}
const old=analyzer(baseline),next=analyzer(root+'/js/analyze.js');
class Core{
 constructor(){this.queue=[];this.p=cp.spawn(coreBinary,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.p.stderr.on('data',b=>process.stderr.write(b));readline.createInterface({input:this.p.stdout}).on('line',s=>{const q=this.queue.shift();try{const v=JSON.parse(s);if(v.error)throw Error(v.error);q.resolve(v);}catch(e){q.reject(e);}});this.p.on('exit',code=>{for(const q of this.queue)q.reject(Error('Core exited '+code));});}
 ask(v){return new Promise((resolve,reject)=>{this.queue.push({resolve,reject});this.p.stdin.write(JSON.stringify(v)+'\n');});}
 async close(){this.p.stdin.end();if(this.p.exitCode===null)await new Promise(r=>this.p.once('exit',r));}
}
function observed(st){const m=next.modelFrom(st);if(st.phase==='office'&&!st.pending.length)m.step='office';if(st.pending[0]?.start&&st.day===1&&!st.tools.length){m.runStart=true;m.cells=m.cells.map((_,n)=>n?{kind:'sealed',event:null}:{kind:'office'});}return next.buildState(m);}
function summary(st,raw,target){const legal=S.candidates(st),rows=raw.rows.map(r=>({...legal.find(c=>S.sameAction(c.action,r.action)),...r,vals:r.vals.map(x=>x===null?NaN:x)}));return {result:S.summarize(rows,raw.rounds,target,raw.goal),pick:S.instant(st)};}
const action=(A,st,raw,target)=>{const {result,pick}=summary(st,raw,target),r=A.rankRecommendation(st,pick,result);assert(r&&S.candidates(st).some(c=>S.sameAction(c.action,r.action)));return r;};
function legacyTarget(st){return beforeVersion==='1.2.0'?old.rolloutTarget(st):Math.max(400,Math.min(1600,Math.round(9600/Math.max(1,S.candidates(st).length))));}
async function both(core,st,seed){
 if(afterAssessment){const a=legacyTarget(st),b=next.rolloutTarget(st),rawBefore=await core.ask({op:'solve',state:st,seed,rollouts:a}),rawAfter=await core.ask({op:'solve',state:st,seed,rollouts:b,assessment:true}),before=action(old,st,rawBefore,a);return {before,selectionOnly:before,after:action(next,st,rawAfter,b),oldTarget:a,newTarget:b};}
 const a=legacyTarget(st),b=next.rolloutTarget(st);await core.ask({op:'init',state:st,seed,rollouts:b});
 const prefix=await core.ask({op:'step',rounds:a});
 const tail=await core.ask({op:'step',rounds:b-a});
 const raw={...tail,rows:tail.rows.map((r,i)=>({...r,action:undefined,policy:undefined,vals:prefix.rows[i].vals.concat(r.vals)}))};
 // Streaming replies intentionally omit immutable action/policy metadata.
 const meta=S.candidates(st),instant=S.instant(st);
 for(let i=0;i<raw.rows.length;i++){raw.rows[i].action=meta[i].action;raw.rows[i].policy=S.sameAction(meta[i].action,instant.action);prefix.rows[i].action=meta[i].action;prefix.rows[i].policy=raw.rows[i].policy;}
 return {before:action(old,st,prefix,a),selectionOnly:action(next,st,prefix,a),after:action(next,st,raw,b),oldTarget:a,newTarget:b};
}
const count=Number(arg('games',16)),dir=path.join(output,'games');assert(Number.isInteger(count)&&count>0&&count<=4096);fs.mkdirSync(dir,{recursive:true});
let cursor=0,failed=false;
(async()=>{
 const cores=Array.from({length:jobs},()=>new Core());
 try{
  const outcomes=await Promise.allSettled(cores.map(async core=>{
   while(!failed){const index=cursor++;if(index>=count)return;const seed='ASSESSMENT-HOLDOUT-20261027-'+String(index+1).padStart(3,'0'),file=path.join(dir,seed+'.json');if(fs.existsSync(file))continue;
    const world={before:T.newGame({seed,params:{rewards:true,drillDays:20}}),after:T.newGame({seed,params:{rewards:true,drillDays:20}})},events={before:[],after:[]},offers={before:new WeakSet(),after:new WeakSet()},blocked={};let shared=0,selectionChanges=0;
    const start=Date.now();
    for(let turn=0;turn<600;turn++){
     const active={};
     for(const who of ['before','after']){
      const st=world[who];if(blocked[who]||st.phase==='ended'||st.vault.length>=10)continue;
      const p=st.pending[0];if(p?.kind==='tool'&&!offers[who].has(p)){p.rerolls=1;offers[who].add(p);}
      const input=observed(st);if(input.problems.length){blocked[who]=[...input.problems];continue;}active[who]=input.st;
     }
     const who=Object.keys(active);if(!who.length)break;
     const seedMC=(0x12001027^Math.imul(index+1,104729)^Math.imul(turn+1,7919))>>>0,chosen={};
     if(who.length===2&&JSON.stringify(active.before)===JSON.stringify(active.after)){
      const r=await both(core,active.after,seedMC);chosen.before=r.before;chosen.after=r.after;shared++;
      if(!S.sameAction(r.before.action,r.selectionOnly.action))selectionChanges++;
     }else for(const w of who){const A=w==='before'?old:next,target=w==='before'?legacyTarget(active[w]):next.rolloutTarget(active[w]);const raw=await core.ask({op:'solve',state:active[w],seed:seedMC,rollouts:target,assessment:afterAssessment&&w==='after'});chosen[w]=action(A,active[w],raw,target);}
     for(const w of who){const st=world[w],a=chosen[w].action;events[w].push({day:st.day,phase:st.phase,action:a});assert(S.apply(st,a).ok,'Illegal action '+JSON.stringify(a));st.log=[];}
     if(turn===599)throw Error('Game exceeded action cap');
    }
    const result={seed,index,shared,selectionChanges,milliseconds:Date.now()-start,gameCapture:false,gameInput:false};
    for(const who of ['before','after'])result[who]={rainbow:Math.min(10,world[who].vault.length),day:world[who].day,ended:world[who].phase==='ended'||world[who].vault.length===10,blocked:blocked[who]||null,moves:events[who].length,events:events[who]};
    fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({index,before:result.before.rainbow,after:result.after.rainbow,blocked:!!result.before.blocked||!!result.after.blocked,seconds:Math.round(result.milliseconds/1000),selectionChanges}));
   }
  }).map(p=>p.catch(error=>{failed=true;throw error;})));
  for(const r of outcomes)if(r.status==='rejected')throw r.reason;
  const rows=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));
  const complete=rows.filter(r=>!r.before.blocked&&!r.after.blocked),mean=who=>complete.reduce((s,r)=>s+r[who].rainbow,0)/complete.length,d=complete.map(r=>r.after.rainbow-r.before.rainbow),m=d.reduce((s,x)=>s+x,0)/d.length,se=d.length>1?Math.sqrt(d.reduce((s,x)=>s+(x-m)**2,0)/(d.length-1)/d.length):null;
  const report={version:require(root+'/desktop/package.json').version,beforeVersion,checkedAt:new Date().toISOString(),planned:count,completed:complete.length,blocked:rows.filter(r=>r.before.blocked||r.after.blocked).map(r=>({seed:r.seed,before:r.before.blocked,after:r.after.blocked})),beforeMean:mean('before'),afterMean:mean('after'),difference:m,normal95:se===null?null:[m-1.96*se,m+1.96*se],beforeFull:complete.filter(r=>r.before.rainbow===10).length,afterFull:complete.filter(r=>r.after.rainbow===10).length,
   goal:'Actual vaulted Rainbow capped at 10',setup:`${count} independent synthetic 20-day seeds, rewards on, one reroll per instrument offer; both advisers play every action independently using the same unchanged game rules. Hidden future information is withheld. Single native MC stream per adviser; matching controller/quota semantics, not identical browser worker RNG streams.`,
   before:beforeVersion==='1.1.1'?'Production heuristic veto and clamp(round(9600/options),400,1600)':'Completed full-run Monte Carlo leader, 2000/8000 per action',after:afterAssessment?'Four-day continuation plus pinned Giboork value model, reference score bonuses and gift continuation policy; 2000/8000 per action. Local game rules retained.':'Completed simulation leader; 2000 per ordinary action and 8000 per instrument/gift choice. Same rollout continuation policy.',
   limitations:'Small paired experiment, not a guarantee of improved Rainbow or actual user profit; this compares our old/new applications. Native evaluation parity is checked separately; this is not a full run of the closed Giboork app.',gameCapture:false,gameInput:false};
  fs.writeFileSync(path.join(output,'quality.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await Promise.all(cores.map(c=>c.close()));}
})().catch(e=>{console.error(e);process.exitCode=1;});
