'use strict';
// Exercise the actual packaged app. The only captured window is this test's
// own synthetic HTML window; the player's running game/profile are excluded.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(url){
 const ws=new WebSocket(url),pending=new Map();let id=0;await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timeout'));},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 return {ws,async evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}};
}
(async()=>{
 const root=path.resolve(__dirname,'..'),version=require('../desktop/package.json').version,exe=path.resolve(process.argv[2]||path.join(root,'desktop/dist/builds',version,'win-unpacked/Torchlight Overlay.exe'));
 const profile=path.join(root,'sandbox','arcana-e2e-'+Date.now());fs.mkdirSync(profile,{recursive:true});
 const log=path.join(profile,'UE_game.log'),html=path.join(profile,'fake-game.html');fs.writeFileSync(log,'');fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({consent:{version:4},mode:'auto',record:false,autoUpdates:false}));
 fs.writeFileSync(html,'<!doctype html><title>ArcanaOverlayCheckOnly</title><style>html,body{margin:0;background:#201431;color:white}h1{padding:40px}div{width:90px;height:60px;margin:20px;background:#826232}</style><h1>OWNED ARCANA CAPTURE CHECK</h1><div></div><div></div>');
 let output='',page,overlay,arcana;
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const forcedFallback=process.argv.includes('--fallback');
 const child=spawn(exe,['--test','--offscreen','--offline-check','--remote-debugging-port=0','--game-title=^ArcanaOverlayCheckOnly$',`--user-data=${profile}`,`--log=${log}`,`--test-window=${html}`,...(forcedFallback?['--arcana-test-fallback']:[])],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const wait=async(fn,label,limit=400)=>{for(let i=0;i<limit;i++){const result=await fn();if(result)return result;if(child.exitCode!==null)throw Error(output);await pause(50);}throw Error(label+'\n'+output);};
 try{
  const endpoint=path.join(profile,'DevToolsActivePort');await wait(()=>fs.existsSync(endpoint),'No test CDP');const port=fs.readFileSync(endpoint,'utf8').split('\n')[0];
  const targets=()=>fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
  const ts=await wait(async()=>{const t=await targets();return t.some(x=>x.url.endsWith('/analyze.html'))&&t.some(x=>x.url.endsWith('/overlay.html'))?t:null;},'Missing main pages');
  page=await connect(ts.find(t=>t.url.endsWith('/analyze.html')).webSocketDebuggerUrl);overlay=await connect(ts.find(t=>t.url.endsWith('/overlay.html')).webSocketDebuggerUrl);
  await wait(()=>page.evaluate("typeof window.TartarusDesktop!=='undefined'&&TartarusDesktop.game().then(g=>g.running)"),'Owned game window not found');
  await wait(()=>overlay.evaluate("typeof window.Overlay!=='undefined'"),'Overlay preload missing');
  fs.appendFileSync(log,'S9Taro Run\n');
  await wait(()=>page.evaluate("TartarusDesktop.suiteInfo().then(s=>s.mode==='arcana'&&s.arcana?.running&&s.arcana.phase==='check')"),'Arcana did not read the synthetic window');
  if(forcedFallback){await wait(()=>page.evaluate('TartarusDesktop.suiteInfo().then(s=>s.arcana.fallbackReads>=3)'),'Owned fallback captures did not complete');const reads=await page.evaluate('TartarusDesktop.suiteInfo().then(s=>s.arcana.fallbackReads)');assert.equal(reads,3,'Packaged fallback retries did not stop at three captures');await pause(700);assert.equal(await page.evaluate('TartarusDesktop.suiteInfo().then(s=>s.arcana.fallbackReads)'),reads,'Packaged fallback kept capturing an unrecognised screen');}
  assert.equal(await page.evaluate('TartarusCapture.state.window'),'off','Tartarus kept capturing in Arcana mode');
  await overlay.evaluate("Overlay.command('board')");
  const target=await wait(async()=>{const ts=await targets();return ts.find(t=>t.url.endsWith('/desktop/lib/arcana.html'));},'No Arcana correction page');arcana=await connect(target.webSocketDebuggerUrl);
  await wait(()=>arcana.evaluate("typeof window.TartarusDesktop!=='undefined'&&document.readyState==='complete'"),'Arcana page did not finish loading');
  const state=await arcana.evaluate("TartarusDesktop.arcana('get')");assert.equal(state.active,true);assert.equal(state.state.model.confirmed,false);assert.ok(state.state.model.frameKey);
  const model={...state.state.model,position:7,life:3,die:2,chests:[5],hand:[204],path:Array.from({length:8},()=>({kind:'empty'})),confirmed:true,lengthConfirmed:true};
  await arcana.evaluate(`TartarusDesktop.arcana('correct',${JSON.stringify(model)})`);
  await wait(()=>overlay.evaluate("document.getElementById('body').textContent.includes('25.00 rarity points')"),'Packaged Arcana did not show the final rainbow upgrade');
  await overlay.evaluate('setTimeout(()=>location.reload(),10)');await pause(1000);
  await wait(()=>overlay.evaluate("document.getElementById('body')?.textContent.includes('25.00 rarity points')").catch(()=>false),'Reloading the overlay lost the current Arcana advice');
  await wait(()=>arcana.evaluate("document.getElementById('position').value==='8'"),'Arcana position UI must use game tile numbers starting at 1');
  await arcana.evaluate("document.querySelector('#tiles button').click();document.getElementById('tile-kind').value='effect';document.getElementById('tile-kind').dispatchEvent(new Event('change'));document.getElementById('tile-effect').value='1021';document.querySelector('#editor button[type=submit]').click();document.getElementById('confirmed').checked=true;document.getElementById('apply').click()");
  await wait(()=>arcana.evaluate("TartarusDesktop.arcana('get').then(s=>s.state.model.path[0].kind==='effect'&&s.state.model.path[0].id===1021)"),'Note tile correction did not reach the worker');
  await arcana.evaluate(`TartarusDesktop.arcana('correct',${JSON.stringify({...model,hand:[21,204]})})`);
  await wait(()=>arcana.evaluate("document.getElementById('hand').textContent.includes('1/3/5')"),'Choice note was not rendered');
  await arcana.evaluate("document.getElementById('pending-kind').value='choose';document.getElementById('pending-kind').dispatchEvent(new Event('change'));for(const id of [1,3,5]){document.getElementById('card').value=String(id);document.getElementById('add-offer').click();}document.getElementById('pending-source').value='0';document.getElementById('pending-source').dispatchEvent(new Event('change'));document.getElementById('confirmed').checked=true;document.getElementById('apply').click()");
  await wait(()=>overlay.evaluate("document.getElementById('body').textContent.includes('Choose')&&document.getElementById('body').textContent.includes('25.00 rarity points')"),'Offered-card choice was not evaluated');
  assert.equal(await overlay.evaluate("document.querySelector('.brand').textContent"),'Arcana');assert.equal(await overlay.evaluate("document.querySelector('[data-cmd=tools]').hidden"),true);
  const picture=await arcana.evaluate("TartarusDesktop.arcana('picture').then(p=>({width:p.width,height:p.height,n:p.data.length}))");assert.ok(picture.width>200&&picture.height>200);assert.equal(picture.n,picture.width*picture.height*4);
  const rejected=await arcana.evaluate(`TartarusDesktop.arcana('correct',${JSON.stringify({...model,frameKey:'stale'})}).then(()=>false,()=>true)`);assert.equal(rejected,true);
  fs.appendFileSync(log,'S9ChooseCard Run\n');
  await wait(()=>arcana.evaluate("TartarusDesktop.arcana('get').then(s=>s.state.phase==='check'&&s.state.issues?.some(t=>t.includes('offered cards')))"),'A game choice did not invoke the popup reader');
  fs.appendFileSync(log,'S9ChooseCard Hide\n');
  fs.appendFileSync(log,'ProtoId = 5552\n');
  await wait(()=>overlay.evaluate("!document.getElementById('body').textContent.includes('25.00 rarity points')"),'Old advice survived a game move');
  await page.evaluate("TartarusDesktop.setConsent({withdrawn:true,at:new Date().toISOString()})");
  await wait(()=>page.evaluate("TartarusDesktop.suiteInfo().then(s=>!s.arcana.running&&s.arcana.retiring===0&&s.arcana.pending===0&&s.children===0)"),'Capture stop left an Arcana worker');
  const disabled=await arcana.evaluate(`TartarusDesktop.arcana('correct',${JSON.stringify(model)}).then(()=>false,()=>true)`);assert.equal(disabled,true);
  assert.equal(fs.existsSync(path.join(profile,'records')),false);
  assert.ok(!/adapter error|runtime error|ReferenceError|TypeError/.test(output),output);
  const report={version,checkedAt:new Date().toISOString(),gameCapture:false,gameInput:false,ownedWindowCapture:true,forcedOwnedFallback:forcedFallback,boundedFallbackRetries:forcedFallback,automaticArcanaRouting:true,automaticPopupRouting:true,actualWorkerAdvice:true,packagedFinalUpgrade:25,adviceRestoredAfterOverlayReload:true,oneBasedPositionUI:true,noteEffectCorrectionUI:true,offeredCardChoiceUI:true,staleCorrectionRejected:true,sharedCaptureStop:true,zeroInactiveWorkers:true,noScreenshotRecording:true};
  fs.writeFileSync(path.join(root,forcedFallback?'tools/results/arcana-fallback-e2e.json':'tools/results/arcana-e2e.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: packaged Arcana auto-routing, native/fallback capture of owned fake window, actual solver and overlay, final upgrade, current-frame edit guard and shared worker/capture stop.');
 }finally{child.stdin.write('quit\n');for(const c of [page,overlay,arcana])c?.ws.close();for(let i=0;i<100&&child.exitCode===null;i++)await pause(50);if(child.exitCode===null)child.kill();fs.writeFileSync(path.join(profile,'check.log'),output);}
})().catch(e=>{console.error(e);process.exitCode=1;});
