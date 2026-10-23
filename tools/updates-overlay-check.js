/* Actual packaged update UI and streaming, using a loopback fake release only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {setTimeout:pause}=require('node:timers/promises');
const root=path.resolve(__dirname,'..'),version=require('../desktop/package.json').version,profile=path.join(root,'sandbox/update-ui-'+Date.now());fs.mkdirSync(profile,{recursive:true});
const U=require('../desktop/lib/app-updates'),parts=version.split('.').map(Number),next=[parts[0],parts[1],parts[2]+1].join('.');
const name=`Torchlight-Overlay-Portable-${next}-x64.exe`,bytes=Buffer.from('MZ-isolated-update-fixture-not-executed'),digest=crypto.createHash('sha256').update(bytes).digest('hex');
const record={tag_name:'v'+next,published_at:'2026-10-23',draft:false,prerelease:false,assets:[{name,state:'uploaded',size:bytes.length,digest:'sha256:'+digest,browser_download_url:`https://github.com/${U.REPO}/releases/download/v${next}/${name}`}]};
let corrupt=true,requests=[];
const server=http.createServer((req,res)=>{requests.push({method:req.method,url:req.url});if(req.url==='/release'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(record));}else{const payload=Buffer.from(bytes);if(corrupt)payload[3]^=1;res.setHeader('Content-Length',payload.length);res.end(payload);}});
async function connect(url){const ws=new WebSocket(url),pending=new Map();let id=0;await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=({data})=>{const m=JSON.parse(data),f=pending.get(m.id);if(f){pending.delete(m.id);f(m);}};return {ws,call(method,params={}){return new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(new Error('CDP timeout')),20000);pending.set(n,m=>{clearTimeout(t);if(m.error||m.result?.exceptionDetails)j(new Error(JSON.stringify(m.error||m.result.exceptionDetails)));else r(m.result);});ws.send(JSON.stringify({id:n,method,params}));});},async evaluate(expression){return (await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;}};}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({autoUpdates:false,consent:{withdrawn:true},record:false}));
 fs.writeFileSync(path.join(profile,'UE_game.log'),'');fs.writeFileSync(path.join(profile,'keep-cache-marker.txt'),'keep');
 const exe=path.resolve(process.argv[2]||path.join(root,'desktop/dist/builds',version,'win-unpacked/Torchlight Overlay.exe'));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=cp.spawn(exe,['--test','--offscreen','--remote-debugging-port=0','--game-title=^UpdateCheckNeverRealGame$',`--user-data=${profile}`,`--log=${path.join(profile,'UE_game.log')}`,`--updates-test-origin=http://127.0.0.1:${server.address().port}/`],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',browser;const sockets=[];child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const until=async fn=>{for(let i=0;i<500;i++){if(child.exitCode!==null)throw new Error(output);const v=await fn();if(v)return v;await pause(50);}throw new Error('Update UI timeout: '+output);};
 try{
  const endpoint=path.join(profile,'DevToolsActivePort');const lines=await until(()=>{try{const s=fs.readFileSync(endpoint,'utf8').trim().split('\n');return /^\d+$/.test(s[0])&&s[1]?s:null;}catch{return null;}});
  browser=await connect(`ws://127.0.0.1:${lines[0]}${lines[1]}`);sockets.push(browser.ws);
  const targets=()=>fetch(`http://127.0.0.1:${lines[0]}/json/list`).then(r=>r.json());
  const analyzer=await until(async()=>(await targets()).find(t=>t.url.endsWith('/analyze.html')));const a=await connect(analyzer.webSocketDebuggerUrl);sockets.push(a.ws);
  await until(()=>a.evaluate('!!window.__tartarusFastRuntime'));assert.equal(requests.length,0);
  const overlay=(await targets()).find(t=>t.url.endsWith('/overlay.html'));const o=await connect(overlay.webSocketDebuggerUrl);sockets.push(o.ws);
  await o.evaluate('Overlay.command("follow");true');
  const target=await until(async()=>(await targets()).find(t=>t.url.endsWith('/desktop/lib/settings.html')));const s=await connect(target.webSocketDebuggerUrl);sockets.push(s.ws);
  await until(()=>s.evaluate('!!document.getElementById("update-check")&&document.getElementById("update-status").textContent.includes("Version")'));
  assert.equal(await s.evaluate('document.getElementById("auto-updates").checked'),false);
  await s.evaluate('document.getElementById("update-check").click();true');
  await until(()=>s.evaluate('TartarusDesktop.updates().then(s=>s.phase==="available")'));
  await s.evaluate('document.getElementById("update-download").click();true');
  await until(()=>s.evaluate('TartarusDesktop.updates().then(s=>s.phase==="error"&&s.error.includes("checksum"))'));
  assert.equal(fs.existsSync(path.join(profile,'updates',name)),false);
  corrupt=false;await s.evaluate('document.getElementById("update-download").click();true');
  await until(()=>s.evaluate('TartarusDesktop.updates().then(s=>s.phase==="ready")'));
  assert.equal(await U.fileHash(path.join(profile,'updates',name)),digest);
  await until(()=>s.evaluate('document.getElementById("update-install").hidden===false'));
  await until(()=>o.evaluate('!!document.querySelector("[data-cmd=update-install]")'));
  assert.equal(fs.readFileSync(path.join(profile,'keep-cache-marker.txt'),'utf8'),'keep');
  assert.ok(requests.every(r=>r.method==='GET'&&['/release','/asset'].includes(r.url)));
  await s.evaluate('document.getElementById("auto-updates").checked=true;document.getElementById("auto-updates").dispatchEvent(new Event("change"));true');
  await until(()=>s.evaluate('TartarusDesktop.updates().then(s=>s.enabled)'));
  const report={version,checkedAt:new Date().toISOString(),settingsAndOverlay:true,manualCheck:true,corruptDownloadRejected:true,verifiedDownloadReady:true,automaticPreferenceSaved:true,profilePreserved:true,testOnlyLoopback:true,realInstallerExecuted:false,gameCapture:false,gameInput:false};
  fs.writeFileSync(path.join(root,'tools/results/updates-e2e.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: actual packaged settings/overlay check, rejected corrupt stream, verified ready state and install button, saved automatic preference; only loopback GETs, profile preserved.');
 }finally{
  if(browser)await browser.call('Browser.close').catch(()=>{});for(const ws of sockets)ws.close();
  for(let i=0;child.exitCode===null&&i<100;i++)await pause(50);if(child.exitCode===null)child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));
 }
})().catch(error=>{console.error(error);process.exitCode=1;server.closeAllConnections();server.close();});
