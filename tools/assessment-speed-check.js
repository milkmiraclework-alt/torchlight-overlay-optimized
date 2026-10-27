/* Paired native CPU timing on fixed synthetic states; excludes capture/UI. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),readline=require('node:readline'),os=require('node:os'),assert=require('node:assert/strict');
const S=require('../js/solver'),fixtures=require('./assessment-reference.json');
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const binary=arg('core'),repeats=Number(arg('repeats',3)),version=require('../desktop/package.json').version;assert(binary&&fs.existsSync(binary),'Pass --core EXE');assert(Number.isInteger(repeats)&&repeats>0&&repeats<=9);
const child=cp.spawn(path.resolve(binary),[],{windowsHide:true,stdio:['pipe','pipe','pipe']}),pending=[];
try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
readline.createInterface({input:child.stdout}).on('line',line=>{const p=pending.shift();try{const v=JSON.parse(line);if(v.error)throw Error(v.error);p.resolve(v);}catch(e){p.reject(e);}});
child.stderr.on('data',b=>process.stderr.write(b));child.on('error',e=>{for(const p of pending.splice(0))p.reject(e)});child.on('exit',code=>{for(const p of pending.splice(0))p.reject(Error('Core exited '+code))});
const ask=v=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(JSON.stringify(v)+'\n')});
const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
(async()=>{const selected=[0,4,8,12,23,29,42,55,80,85,88].map(i=>fixtures.cases[i]).filter(c=>S.candidates(c.state).length>1),rows=[];
try{for(const c of selected){const state=c.state,quota=['gift','tool'].includes(state.pending[0]?.kind)?8000:2000,moves=S.candidates(state).length;
 const times={before:[],after:[]};for(const assessment of [false,true])await ask({op:'solve',state,seed:1031,rollouts:32,assessment});
 for(let rep=0;rep<repeats;rep++)for(const assessment of rep%2?[true,false]:[false,true]){const t=process.hrtime.bigint(),r=await ask({op:'solve',state,seed:1031,rollouts:quota,assessment});assert.equal(r.rounds,quota);times[assessment?'after':'before'].push(Number(process.hrtime.bigint()-t)/1e6);}
 const row={name:c.name,day:state.day,phase:state.phase,moves,perAction:quota,beforeMs:median(times.before),afterMs:median(times.after),samples:times};row.ratio=row.beforeMs/row.afterMs;rows.push(row);console.log(JSON.stringify({...row,samples:undefined}));}
 const report={version,checkedAt:new Date().toISOString(),cpu:os.cpus()[0]?.model,arch:process.arch,repeats,cases:rows,medianRatio:median(rows.map(r=>r.ratio)),before:'Full terminal Monte Carlo, same 2000/8000 per-action quotas',after:'Four-day continuation and Giboork value model, same 2000/8000 per-action quotas',scope:'Single native core process, warmed fixed synthetic states, paired execution order. Includes JSON transport. Capture, game animations, Electron/UI and forecasts excluded; this is not whole-application latency.',gameCapture:false,gameInput:false};
 const file=path.resolve(arg('out','tools/results/assessment-speed-'+version+'.json'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log('Median paired speed ratio',report.medianRatio);
}finally{child.stdin.end();if(child.exitCode===null)await new Promise(r=>child.once('exit',r));}})().catch(e=>{console.error(e);process.exitCode=1});
