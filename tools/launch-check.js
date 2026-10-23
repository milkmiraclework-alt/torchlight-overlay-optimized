'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(url){const ws=new WebSocket(url),pending=new Map();let id=0;await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=({data})=>{const m=JSON.parse(data),fn=pending.get(m.id);if(fn){pending.delete(m.id);fn(m)}};return {ws,evaluate(expression){return new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(new Error('CDP timeout')),15000);pending.set(n,m=>{clearTimeout(t);if(m.error||m.result.exceptionDetails)j(new Error(JSON.stringify(m.error||m.result.exceptionDetails)));else r(m.result.result.value)});ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});}};
}
(async()=>{
 const root=path.resolve(__dirname,'..'),version=require('../desktop/package.json').version,dir=path.join(root,'desktop/dist/builds',version),profile=path.join(root,'sandbox/launch-'+Date.now());fs.mkdirSync(profile,{recursive:true});
 const unpack=path.join(dir,'win-unpacked/Torchlight Overlay.exe'),extracted=path.join(profile,'installer');
 const zipAt=process.argv.indexOf('--7zip'),zip=zipAt>=0?process.argv[zipAt+1]:path.join(root,'desktop/node_modules/electron-winstaller/vendor/7z-x64.exe');
 cp.execFileSync(zip,['x',path.join(dir,`Torchlight-Overlay-Setup-${version}-x64.exe`),'-o'+extracted,'-y'],{windowsHide:true,stdio:'ignore'});
 const installed=path.join(extracted,'Torchlight Overlay.exe');assert.ok(fs.existsSync(installed));
 const hash=p=>require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 assert.equal(hash(path.join(extracted,'resources/app.asar')),hash(path.join(dir,'win-unpacked/resources/app.asar')),'Installer contains different app code');
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({consent:{withdrawn:true},record:false}));fs.writeFileSync(path.join(profile,'UE_game.log'),'');
 const args=['--test','--offscreen','--remote-debugging-port=0','--game-title=^LaunchTestNeverARealGame$',`--user-data=${profile}`,`--log=${path.join(profile,'UE_game.log')}`];
 const first=cp.spawn(unpack,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',page,second;first.stdout.on('data',b=>output+=b);first.stderr.on('data',b=>output+=b);
 const wait=async fn=>{for(let i=0;i<300;i++){const v=await fn();if(v)return v;if(first.exitCode!==null)throw new Error(output);await pause(50);}throw new Error('Timed out: '+output)};
 try{
  const endpoint=path.join(profile,'DevToolsActivePort');const port=await wait(()=>{try{const p=fs.readFileSync(endpoint,'utf8').split('\n')[0];return /^\d+$/.test(p)?p:null;}catch{return null;}});
  const target=await wait(async()=>{const ts=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();return ts.find(t=>t.url.endsWith('/analyze.html'))});page=await connect(target.webSocketDebuggerUrl);await wait(()=>page.evaluate('!!window.__tartarusFastRuntime'));
  assert.equal((await page.evaluate('TartarusDesktop.suiteInfo()')).windows.board,false);
  second=cp.spawn(installed,args,{windowsHide:true,stdio:'ignore'});await wait(()=>second.exitCode!==null);assert.equal(second.exitCode,0);
  const state=await wait(()=>page.evaluate('TartarusDesktop.suiteInfo().then(s=>s.windows.settings?s:null)'));assert.equal(state.windows.board,false,'Repeated installer launch opened the board');
  assert.ok(output.includes('additional launch: opening common settings'));
  const report={version,checkedAt:new Date().toISOString(),installerPayloadMatches:true,secondInstanceOpensSettings:true,boardRemainsHidden:true,singlePrimaryInstance:true,gameCapture:false,gameInput:false};
  fs.writeFileSync(path.join(root,'tools/results/launch-check.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: actual installer payload matches, repeat launch exits and opens common settings in the existing instance; board stays hidden.');
 }finally{first.stdin.write('quit\n');page?.ws.close();for(let i=0;first.exitCode===null&&i<100;i++)await pause(50);if(first.exitCode===null)first.kill();if(second&&second.exitCode===null)second.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
