'use strict';
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),jobs=[
 ['routing',['tools/unified-runtime-check.js']],['picture-retry',['tools/picture-retry-check.js']],
 ['rust-wasm',['tools/rust-solver-check.js','--wasm']],['strategy28',['tools/strategy-28-check.js']],
 ['terminal-gifts',['tools/strategy-31-check.js']],['calculation',['tools/calculation-check.js']],
 ['rust-workers',['tools/rust-worker-check.js']],['instruments',['tools/instruments-check.js']],
 ['forecast',['tools/forecast-check.js']],['forecast-menu',['tools/forecast-menu-check.js']],
 ['solver-cache',['tools/solver-cache-check.js']],['chain-cache',['tools/chain-cache-check.js']],
 ['worker-budget',['tools/worker-budget-check.js']],['readiness',['tools/readiness-check.js']],
 ['capture',['tools/capture-check.js']],['worker-recovery',['tools/ready-worker-recovery-check.js']],
 ['worker-lifecycle',['tools/worker-lifecycle-check.js']],['bundled-site',['tools/bundled-site-check.js']],
];
fs.mkdirSync(path.join(root,'sandbox/checks'),{recursive:true});
for(const [name,args]of jobs){const r=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true});fs.writeFileSync(path.join(root,'sandbox/checks',name+'.log'),(r.stdout||'')+(r.stderr||''));console.log(name,r.status);if(r.status!==0){console.error(r.stdout,r.stderr);process.exit(1);}}
fs.mkdirSync(path.join(root,'tools/results'),{recursive:true});fs.writeFileSync(path.join(root,'tools/results/checks.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),checks:jobs.map(([name])=>name),gameCapture:false,gameInput:false},null,2)+'\n');
