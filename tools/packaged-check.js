'use strict';
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),version=require('../desktop/package.json').version;
const exe=path.join(root,'desktop/dist/builds',version,'win-unpacked/Torchlight Overlay.exe');
const jobs=[['suite',['tools/suite-overlay-check.js',exe]],['overlay',['tools/overlay-check.js','--standalone',exe,'--forecast']],['lifecycle',['tools/overlay-check.js','--standalone',exe,'--worker-lifecycle-only']],['instruments',['tools/overlay-check.js','--standalone',exe,'--instruments-only']],['updates',['tools/updates-overlay-check.js',exe]],['portable',['tools/standalone-smoke.js']]];
const at=process.argv.indexOf('--frames');if(at>=0)for(const [,args]of jobs)if(args[0]==='tools/overlay-check.js')args.push('--frames',path.resolve(process.argv[at+1]));
fs.mkdirSync(path.join(root,'sandbox/packaged'),{recursive:true});
const selected=process.argv.includes('--finish')?jobs.filter(([name])=>['instruments','updates','portable'].includes(name)):jobs;
for(const [name,args]of selected){const r=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true});fs.writeFileSync(path.join(root,'sandbox/packaged',name+'.log'),(r.stdout||'')+(r.stderr||''));console.log(name,r.status);if(r.status!==0){console.error(r.stdout,r.stderr);process.exit(1);}}
for(const [name]of jobs){const log=fs.readFileSync(path.join(root,'sandbox/packaged',name+'.log'),'utf8');if(!log.includes('PASS')||/AssertionError|ReferenceError|TypeError/.test(log))throw new Error('Failed packaged check: '+name);}
fs.mkdirSync(path.join(root,'tools/results'),{recursive:true});fs.writeFileSync(path.join(root,'tools/results/packaged-checks.json'),JSON.stringify({version,checkedAt:new Date().toISOString(),checks:jobs.map(([name])=>name),gameCapture:false,gameInput:false},null,2)+'\n');
