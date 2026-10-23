'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {setTimeout:pause}=require('node:timers/promises');
const I=require('../desktop/lib/update-install'),U=require('../desktop/lib/app-updates');
const base=path.resolve(__dirname,'../sandbox/update-install-'+Date.now());fs.mkdirSync(base,{recursive:true});
const root=path.join(base,'[тест] $ &');fs.mkdirSync(root,{recursive:true});
const probe=path.join(base,'probe.exe');
cp.execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'update-probe.ps1'),'-Output',probe],{windowsHide:true,stdio:'pipe'});
const bytes=fs.readFileSync(probe);
async function until(fn){for(let i=0;i<300;i++){const value=await fn();if(value)return value;await pause(100);}throw new Error('Update helper timed out');}
async function scenario(mode,corrupt=false){
 const dir=path.join(root,mode+(corrupt?'-corrupt':'')),cache=path.join(dir,'cache');fs.mkdirSync(cache,{recursive:true});
 const target=path.join(dir,'My overlay.exe'),marker=path.join(dir,'launched.txt');
 fs.writeFileSync(target,Buffer.concat([bytes,Buffer.from('OLD')]));const oldHash=await U.fileHash(target);
 const source=path.join(cache,`Torchlight-Overlay-${mode==='setup'?'Setup':'Portable'}-1.0.4-x64.exe`);fs.writeFileSync(source,bytes);
 const update={kind:mode,version:'1.0.4',size:bytes.length,sha256:await U.fileHash(source),file:source};
 const holder=cp.spawn(target,['hold'],{windowsHide:true,env:{...process.env,TORCHLIGHT_UPDATE_TEST_MARKER:marker},stdio:'ignore'});
 await until(()=>{if(holder.exitCode!==null)throw new Error('Test holder exited before readiness: '+holder.exitCode);return fs.existsSync(marker+'.holding');});
 // The helper's restarted process inherits only this test marker.
 const original=process.env.TORCHLIGHT_UPDATE_TEST_MARKER;process.env.TORCHLIGHT_UPDATE_TEST_MARKER=marker;
 let prepared;
 try{
  prepared=await I.prepare(update,{directory:cache,portable:target,pid:holder.pid});
  await I.launch(prepared);
 }finally{if(original===undefined)delete process.env.TORCHLIGHT_UPDATE_TEST_MARKER;else process.env.TORCHLIGHT_UPDATE_TEST_MARKER=original;}
 assert.equal(await U.fileHash(target),oldHash,'The running old executable was replaced before exit');
 assert.equal(fs.existsSync(marker),false);
 if(corrupt)fs.appendFileSync(prepared.plan.stage,'CORRUPT');
 holder.kill(); // Only this owned, harmless probe represents closing the app.
 const outcome=await until(()=>{try{return JSON.parse(fs.readFileSync(prepared.plan.outcome,'utf8').replace(/^\uFEFF/,''));}catch{return null;}});
 if(!corrupt)assert.equal(outcome.ok,true,JSON.stringify(outcome));
 await until(()=>fs.existsSync(marker));const launched=fs.readFileSync(marker,'utf8');
 if(corrupt){assert.equal(outcome.ok,false);assert.equal(await U.fileHash(target),oldHash);assert.ok(launched.startsWith(oldHash),'A failed update did not restart the intact old executable');}
 else if(mode==='portable'){
  assert.equal(outcome.ok,true);assert.equal(await U.fileHash(target),update.sha256);assert.ok(launched.startsWith(update.sha256));
  assert.equal(await U.fileHash(prepared.plan.backup),oldHash);
  await I.cleanup(cache,'1.0.4',target);assert.equal(fs.existsSync(prepared.plan.backup),false);assert.equal(fs.existsSync(prepared.file),false);
 }else{
  assert.equal(outcome.ok,true);assert.equal(await U.fileHash(target),oldHash);assert.ok(launched.includes('/S|--updated|--force-run'));
 }
 await until(()=>holder.exitCode!==null||holder.signalCode!==null);
 return {mode,corrupt,verified:true};
}
(async()=>{
 const results=[];results.push(await scenario('portable'));results.push(await scenario('portable',true));results.push(await scenario('setup'));
 const dir=path.join(root,'parent-exit'),cache=path.join(dir,'cache');fs.mkdirSync(cache,{recursive:true});
 const target=path.join(dir,'Portable.exe'),source=path.join(cache,'Torchlight-Overlay-Portable-1.0.4-x64.exe'),marker=path.join(dir,'launched.txt');
 fs.writeFileSync(target,Buffer.concat([bytes,Buffer.from('OLD')]));fs.writeFileSync(source,bytes);
 const host=cp.fork(path.join(__dirname,'update-host-probe.js'),[],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,TORCHLIGHT_UPDATE_TEST_MARKER:marker}});
 const plan=await I.prepare({kind:'portable',version:'1.0.4',size:bytes.length,sha256:await U.fileHash(source),file:source},{directory:cache,portable:target,pid:host.pid});
 const started=new Promise((resolve,reject)=>{host.on('message',value=>value==='ready'?resolve():reject(new Error(JSON.stringify(value))));host.once('error',reject);});
 host.send(plan);await started;assert.equal(fs.existsSync(marker),false);host.send('quit');
 await until(()=>fs.existsSync(marker));assert.equal((await U.fileHash(target)),plan.plan.sha256);
 results.push({mode:'portable',parentExited:true,verified:true});
 const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),results,realInstallerExecuted:false,realGameInput:false};
 fs.mkdirSync(path.join(__dirname,'results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'results/update-install.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PASS: real Windows helper waits for its owned test process, replaces/restarts Portable, preserves a backup until verified startup, rejects changed staging and restarts the old EXE, passes Setup flags to a harmless probe; Unicode/special-path quoting.');
})().catch(error=>{console.error(error);process.exitCode=1;});
