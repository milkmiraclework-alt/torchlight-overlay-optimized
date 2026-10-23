/* Actual packaged app + native backend, isolated fake window/log only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(url){const ws=new WebSocket(url),pending=new Map();let id=0;await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);p(m)}};
 const call=(method,params={})=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>{pending.delete(n);j(new Error(method+' timeout'))},30000);pending.set(n,m=>{clearTimeout(t);if(m.error)j(new Error(JSON.stringify(m.error)));else r(m.result)});ws.send(JSON.stringify({id:n,method,params}));});
 return {ws,call,async evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}};
}
(async()=>{
 const root=path.resolve(__dirname,'..'),version=require('../desktop/package.json').version;
 const exe=path.resolve(process.argv[2]||path.join(root,'desktop/dist/builds',version,'win-unpacked/Torchlight Overlay.exe'));
 const profile=path.join(root,'sandbox','suite-e2e-'+Date.now());fs.mkdirSync(profile,{recursive:true});
 const log=path.join(profile,'UE_game.log'),html=path.join(profile,'game.html');fs.writeFileSync(log,'');fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({consent:{version:4},record:false,speed:true,shelley:6,threads:2}));
 const image=require('node:url').pathToFileURL(path.join(root,'vorax/fixtures/live-frames/round9-one-monster.png')).href;
 fs.writeFileSync(html,'<!doctype html><title>TorchlightSuiteCheckOnly</title><style>html,body{margin:0;overflow:hidden;background:black}img{width:100vw;height:100vh;display:block}</style><img src="'+image+'">');
 let output='',browser,page,nativePid=0;
 const child=spawn(exe,['--test','--offscreen','--offline-check','--remote-debugging-port=0','--game-title=^TorchlightSuiteCheckOnly$',`--user-data=${profile}`,`--log=${log}`,`--test-window=${html}`],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const wait=async(fn,message,limit=300)=>{for(let i=0;i<limit;i++){const v=await fn();if(v)return v;if(child.exitCode!==null)throw new Error('App exited: '+output);await pause(100);}throw new Error(message+'\n'+output);};
 try{
  const endpoint=path.join(profile,'DevToolsActivePort');await wait(()=>fs.existsSync(endpoint),'No CDP');const [port,route]=fs.readFileSync(endpoint,'utf8').trim().split('\n');browser=await connect('ws://127.0.0.1:'+port+route);
  const targets=await wait(async()=>{const ts=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();return ts.some(t=>t.url.endsWith('/analyze.html'))&&ts.some(t=>t.title==='TorchlightSuiteCheckOnly')?ts:null},'Missing targets');
  const target=targets.find(t=>t.url.endsWith('/analyze.html')),fake=targets.find(t=>t.title==='TorchlightSuiteCheckOnly');page=await connect(target.webSocketDebuggerUrl);const game=await connect(fake.webSocketDebuggerUrl);
  await game.evaluate('window.resizeTo(outerWidth+1280-innerWidth,outerHeight+720-innerHeight)');await pause(300);game.ws.close();
  await wait(()=>page.evaluate('!!window.__tartarusFastRuntime'),'Runtime missing');
  await page.evaluate(`window.__suiteWorkers=new Set();window.__suiteCreated=0;{const Base=window.Worker;window.Worker=class extends Base{constructor(...a){super(...a);__suiteWorkers.add(this);__suiteCreated++;}terminate(){__suiteWorkers.delete(this);return super.terminate();}}}`);
  let info=await page.evaluate('TartarusDesktop.suiteInfo()');assert.equal(info.mode,'idle');assert.equal(info.voraxPid,0);
  fs.appendFileSync(log,'S13GamePlayMain Run\n');
  info=await wait(()=>page.evaluate(`TartarusDesktop.suiteInfo().then(s=>s.mode==='vorax'&&s.ready&&s.lastStatus?.event==='read'&&s.lastStatus.kind==='advice'?s:null)`),'Vorax did not advise its fake window',600);
  nativePid=info.voraxPid;assert.ok(nativePid>0);assert.equal(info.threads,2);assert.equal(info.lastStatus.unknown,0);
  assert.equal(await page.evaluate('TartarusCapture.state.window'),'off');assert.equal(await page.evaluate('__suiteWorkers.size'),0,'Tartarus workers ran in Vorax mode');
  console.log('PASS: automatic Vorax mode, actual WGC/native OCR/Smart advice on the isolated fixture window, no Tartarus workers.');
  fs.appendFileSync(log,'S16BoardMain Run\n');
  await wait(()=>page.evaluate(`TartarusDesktop.suiteInfo().then(s=>s.mode==='tartarus'&&s.children===0&&s.voraxPid===0)`),'Vorax did not stop on Tartarus entry');
  await wait(()=>page.evaluate(`TartarusCapture.state.window==='on'&&__suiteWorkers.size>0`),'Tartarus did not wake');
  console.log('PASS: switching to Tartarus terminates the native Vorax process and wakes only Tartarus workers.');
  await page.evaluate(`TartarusDesktop.setConsent({withdrawn:true,at:new Date().toISOString()})`);
  await wait(()=>page.evaluate(`TartarusCapture.state.window==='off'&&__suiteWorkers.size===0`),'Capture stop left Tartarus workers');
  await page.evaluate(`TartarusDesktop.setFastSettings({mode:'vorax',threads:2});TartarusDesktop.setConsent({version:4,at:new Date().toISOString()})`);
  info=await wait(()=>page.evaluate(`TartarusDesktop.suiteInfo().then(s=>s.mode==='vorax'&&s.ready?s:null)`),'Manual Vorax did not start');nativePid=info.voraxPid;
  await page.evaluate('TartarusDesktop.readNow()');
  await wait(()=>page.evaluate(`TartarusDesktop.suiteInfo().then(s=>s.lastStatus?.event==='read'&&s.lastStatus.kind==='advice')`),'Manual Vorax capture did not produce advice');
  await page.evaluate(`TartarusDesktop.setConsent({withdrawn:true,at:new Date().toISOString()})`);
  await wait(()=>page.evaluate(`TartarusDesktop.suiteInfo().then(s=>s.children===0&&s.voraxPid===0)`),'Capture stop left Vorax running');
  console.log('PASS: common capture stop releases both backends; manual selection and CPU setting work.');
  assert.ok(!/adapter error|runtime error|ReferenceError|TypeError/.test(output),output);
  assert.equal(fs.existsSync(path.join(profile,'records')),false,'Screenshot history should not exist');
  const report={version,checkedAt:new Date().toISOString(),actualNativeCapture:true,nativeAdvice:true,manualNativeCapture:true,modeSwitching:true,zeroInactiveWorkers:true,sharedCaptureStop:true,automaticCpuBudget:true,recordingExcluded:true,gameCapture:false,gameInput:false};
  fs.mkdirSync(path.join(root,'tools/results'),{recursive:true});fs.writeFileSync(path.join(root,'tools/results/suite-e2e.json'),JSON.stringify(report,null,2)+'\n');
 }finally{
  child.stdin.write('quit\n');page?.ws.close();browser?.ws.close();for(let i=0;child.exitCode===null&&i<100;i++)await pause(100);if(child.exitCode===null)child.kill();
  fs.writeFileSync(path.join(profile,'check.log'),output);
  if(nativePid){await pause(300);let alive=false;try{process.kill(nativePid,0);alive=true}catch{}assert.equal(alive,false,'Native backend survived host shutdown');}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
