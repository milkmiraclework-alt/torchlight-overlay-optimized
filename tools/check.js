'use strict';
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),jobs=[
 ['arcana',['tools/arcana-check.js']],
 ['arcana-terminal',['tools/arcana-terminal-check.js']],
 ['arcana-exit',['tools/arcana-exit-check.js']],
 ['arcana-endgame',['tools/arcana-endgame-check.js']],
 ['arcana-upgrade-value',['tools/arcana-upgrade-value-check.js']],
 ['arcana-runtime',['tools/arcana-runtime-check.js']],
 ['arcana-history',['tools/arcana-history-check.js']],
 ['arcana-position',['tools/arcana-position-check.js']],
 ['arcana-worlds',['tools/arcana-world-check.js']],
 ['arcana-models',['tools/arcana-model-check.js']],
 ['arcana-fixed-reward',['tools/arcana-fixed-reward-check.js']],
 ['arcana-marks',['tools/arcana-marks-check.js']],
 ['native-capture',['tools/native-capture-check.js']],
 ['window-capture',['tools/window-capture-check.js']],
 ['gpu-capture',['tools/wgc-window-check.js']],
 ['native-screen',['tools/native-screen-check.js']],
 ['assessment',['tools/assessment-check.js']],
 ['terminal-reward',['tools/tartarus-terminal-reward-check.js']],
 ['prey-rebuild',['tools/tartarus-prey-rebuild-check.js']],
 ['tartarus-baseline',['tools/tartarus-baseline-check.js']],
 ['usurp-pool',['tools/usurp-pool-check.js']],
 ['assessment-model',['tools/assessment-model-check.js']],
 ['native-reader',['tools/native-reader-check.js']],['routing',['tools/unified-runtime-check.js']],['days',['tools/day-check.js']],['pick-box',['tools/pick-box-check.js']],['picture-retry',['tools/picture-retry-check.js']],['profile-import',['tools/profile-import-check.js']],
 ['vorax-journal',['tools/vorax-journal-check.js']],
 ['window-position',['tools/window-position-check.js']],
 ['instrument-reader',['tools/instrument-reader-check.js']],
 ['app-updates',['tools/app-updates-check.js']],['update-install',['tools/update-install-check.js']],
 ['rust-wasm',['tools/rust-solver-check.js','--wasm']],['pixel-kernels',['tools/scan-kernel-check.js']],['strategy28',['tools/strategy-28-check.js']],
 ['terminal-gifts',['tools/strategy-31-check.js']],['calculation',['tools/calculation-check.js']],
 ['rust-workers',['tools/rust-worker-check.js']],['instruments',['tools/instruments-check.js']],
 ['forecast',['tools/forecast-check.js']],['forecast-menu',['tools/forecast-menu-check.js']],
 ['solver-cache',['tools/solver-cache-check.js']],['chain-cache',['tools/chain-cache-check.js']],
 ['worker-budget',['tools/worker-budget-check.js']],['readiness',['tools/readiness-check.js']],
 ['capture',['tools/capture-check.js']],['worker-recovery',['tools/ready-worker-recovery-check.js']],
 ['worker-lifecycle',['tools/worker-lifecycle-check.js']],['bundled-site',['tools/bundled-site-check.js']],
];
const frameAt=process.argv.indexOf('--arcana-frame');if(frameAt>=0)jobs.push(['arcana-vision',['tools/arcana-vision-check.js','--frame',path.resolve(process.argv[frameAt+1])]]);
if(frameAt>=0)jobs.push(['arcana-consumed',['tools/arcana-consumed-check.js','--frame',path.resolve(process.argv[frameAt+1])]]);
const sessionAt=process.argv.indexOf('--arcana-session');if(sessionAt>=0){
 const session=path.resolve(process.argv[sessionAt+1]);
 jobs.push(['arcana-position-worker',['tools/arcana-position-worker-check.js','--session',session,'--fixture-out','sandbox/arcana-session-first']]);
 jobs.push(['arcana-replay',['tools/arcana-replay-check.js','--session',session,'--verify','--output','tools/results/arcana-replay.json']]);
 jobs.push(['arcana-cold-replay',['tools/arcana-replay-check.js','--session',session,'--cold-open','--verify','--output','tools/results/arcana-cold-replay.json']]);
}
if(frameAt>=0)jobs.push(['arcana-route',['tools/arcana-route-check.js','--frame',path.resolve(process.argv[frameAt+1])]]);
if(frameAt>=0)jobs.push(['arcana-capture-fallback',['tools/arcana-capture-fallback-check.js','--frame',path.resolve(process.argv[frameAt+1])]]);
const handFrames=process.argv.flatMap((arg,i)=>arg==='--arcana-hand-frame'?['--frame',path.resolve(process.argv[i+1])]:[]);if(handFrames.length)jobs.push(['arcana-hand',['tools/arcana-hand-check.js',...handFrames]]);
const textureAt=process.argv.indexOf('--arcana-textures');if(textureAt>=0)jobs.push(['arcana-popup',['tools/arcana-popup-check.js','--textures',path.resolve(process.argv[textureAt+1])]]);
if(textureAt>=0&&handFrames.length)jobs.push(['arcana-refill',['tools/arcana-refill-check.js','--frame',handFrames[1],'--textures',path.resolve(process.argv[textureAt+1])]]);
if(handFrames.length)jobs.push(['arcana-life',['tools/arcana-life-check.js',...handFrames]]);
const singleAt=process.argv.indexOf('--arcana-single-frame');if(singleAt>=0)jobs.push(['arcana-single-hand',['tools/arcana-single-hand-check.js','--frame',path.resolve(process.argv[singleAt+1])]]);
if(singleAt>=0)jobs.push(['arcana-state',['tools/arcana-state-check.js','--frame',path.resolve(process.argv[singleAt+1])]]);
if(singleAt>=0&&handFrames.length)jobs.push(['arcana-fast-hand',['tools/arcana-fast-hand-check.js','--frame',path.resolve(process.argv[singleAt+1]),...handFrames,...(frameAt>=0?['--frame',path.resolve(process.argv[frameAt+1])]:[])]]);
if(textureAt>=0&&singleAt>=0&&frameAt>=0&&handFrames.length)jobs.push(['arcana-visuals',['tools/arcana-visuals-check.js','--textures',path.resolve(process.argv[textureAt+1]),'--empty-frame',handFrames[1],'--frame',path.resolve(process.argv[singleAt+1]),'--reference-frame',path.resolve(process.argv[frameAt+1])]]);
if(frameAt>=0&&handFrames.length)jobs.push(['arcana-local',['tools/arcana-local-check.js','--frame',path.resolve(process.argv[frameAt+1]),'--frame',handFrames[1],...(singleAt>=0?['--frame',path.resolve(process.argv[singleAt+1])]:[])]]);
fs.mkdirSync(path.join(root,'sandbox/checks'),{recursive:true});
for(const [name,args]of jobs){const r=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true});fs.writeFileSync(path.join(root,'sandbox/checks',name+'.log'),(r.stdout||'')+(r.stderr||''));console.log(name,r.status);if(r.status!==0){console.error(r.stdout,r.stderr);process.exit(1);}}
fs.mkdirSync(path.join(root,'tools/results'),{recursive:true});fs.writeFileSync(path.join(root,'tools/results/checks.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),checks:jobs.map(([name])=>name),gameCapture:false,gameInput:false},null,2)+'\n');
