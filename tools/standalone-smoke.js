#!/usr/bin/env node
/* Run a distributed portable EXE with an isolated profile, no real game,
 * missing original-install paths and all external HTTP requests blocked. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const ROOT = path.resolve(__dirname, '..'), version = require('../desktop/package.json').version;
const versioned = path.join(ROOT, `desktop/dist/builds/${version}/Torchlight-Overlay-Portable-${version}-x64.exe`);
const exe = path.resolve(process.argv[2] || (fs.existsSync(versioned) ? versioned : path.join(ROOT, `desktop/dist/Torchlight-Overlay-Portable-${version}-x64.exe`)));
const profile = path.join(ROOT, 'sandbox', `standalone-smoke-${process.pid}-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ consent: { withdrawn: true }, record: false }));
fs.writeFileSync(path.join(profile, 'UE_game.log'), '');
async function connect(url) {
  const ws = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); const task = pending.get(m.id); if (task) { pending.delete(m.id); task(m); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id, timer = setTimeout(() => { pending.delete(request); reject(new Error(method + ' timed out')); }, 30000);
    pending.set(request, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async (expression) => {
    const m = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.error || m.result.exceptionDetails) throw new Error(JSON.stringify(m.error || m.result.exceptionDetails));
    return m.result.result.value;
  };
  return { ws, call, evaluate };
}
(async () => {
  // Keep an unrelated listener on the same port. The app must serve its
  // bundle internally and leave this process completely untouched.
  const probe = require('node:http').createServer((req, res) => res.end('EXTERNAL SENTINEL'));
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const sitePort = probe.address().port;
  const env = { ...process.env, TARTARUS_INSTALLED_ASAR: path.join(profile, 'absent', 'app.asar'),
    TARTARUS_OVERLAY_EXE: path.join(profile, 'absent', 'original.exe'),
    APPDATA: path.join(profile, 'empty-roaming'), LOCALAPPDATA: path.join(profile, 'empty-local') };
  fs.mkdirSync(env.APPDATA, { recursive: true }); fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  delete env.ELECTRON_RUN_AS_NODE;
  const started = performance.now(); let output = '', browser, page;
  const child = spawn(exe, ['--test', '--offscreen', '--offline-check', `--site-port=${sitePort}`, `--user-data=${profile}`,
    '--game-title=^StandaloneSmokeNoGame$', `--log=${path.join(profile, 'UE_game.log')}`, '--remote-debugging-port=0'],
  { cwd: profile, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { output += b; }); child.stderr.on('data', (b) => { output += b; });
  child.on('error', (e) => { output += e.message; });
  try {
    const devtools = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(devtools) && i < 600; i++) {
      if (child.exitCode !== null) throw new Error('Portable launcher exited before startup: ' + output);
      await pause(100);
    }
    assert.ok(fs.existsSync(devtools), 'Portable app did not create its isolated DevTools endpoint: ' + output);
    const [port, endpoint] = fs.readFileSync(devtools, 'utf8').trim().split('\n');
    browser = await connect(`ws://127.0.0.1:${port}${endpoint}`);
    let targets;
    for (let i = 0; i < 200; i++) {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((t) => t.url.endsWith('/analyze.html'))) break;
      await pause(50);
    }
    const target = targets.find((t) => t.url === `http://localhost:${sitePort}/analyze.html`);
    assert.ok(target, 'Portable app did not use its own bundled site');
    page = await connect(target.webSocketDebuggerUrl);
    for (let i = 0; i < 300 && !await page.evaluate('!!window.__tartarusFastRuntime'); i++) await pause(50);
    const bootMs = Math.round(performance.now() - started);
    const result = await page.evaluate(`(async()=>{
      const c=window.TARTARUS_BUNDLED_OCR;if(!c)throw new Error('Bundled OCR missing');
      const start=performance.now(),worker=await TartarusAnalyzer.prepareOCR();if(!worker)throw new Error('Offline OCR failed');
      const canvas=document.createElement('canvas');canvas.width=680;canvas.height=110;const ctx=canvas.getContext('2d');
      ctx.fillStyle='white';ctx.fillRect(0,0,680,110);ctx.fillStyle='black';ctx.font='42px Arial';ctx.fillText('TARTARUS 12345',20,68);
      const text=(await worker.recognize(canvas)).data.text.trim();
      const ocrMs=Math.round(performance.now()-start);
      new Function('module',await(await fetch('/js/rust-solver.js')).text())(undefined);
      const bytes=await(await fetch('/js/solver-core.wasm')).arrayBuffer(),core=await TartarusRust.fromBytes(bytes);
      const state=Tartarus.newGame({seed:'PORTABLE-RUST',params:{rewards:false,startTools:0}}),options={rollouts:8,seed:7,stream:1};
      const native=TartarusRust.solve(core,state,options),reference=TartarusSolver.solve(state,options);
      for(const job of [native,reference]){let result;do{result=job.step(60,true)}while(!result.done);if(result.rounds!==8)throw new Error('Portable rollout budget mismatch');}
      const values=job=>JSON.stringify(job.rows.map(r=>[r.action,r.vals,r.best,r.policy]));
      if(values(native)!==values(reference))throw new Error('Portable Rust samples differ from JavaScript');
      return {text,ocrMs,version:(await(await fetch('/bundle.json')).json()).version,agreed:TartarusCapture.agreed(),rustSampleParity:true,rustRollouts:8};
    })()`);
    assert.match(result.text, /TARTARUS\s+12345/i); assert.equal(result.version, version); assert.equal(result.agreed, false);
    const log = fs.readFileSync(path.join(profile, 'logs/overlay.log'), 'utf8');
    assert.ok(log.includes('foreground check on'), 'Portable native Koffi did not load');
    assert.ok(!/console error|runtime error|adapter error/.test(log), log);
    const report = { version, executable: path.basename(exe), sha256: createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),
      checkedAt: new Date().toISOString(), bootMs, ...result, externalHttpBlocked: true, originalInstallUnavailable: true,
      occupiedPortIndependent: true, gameInput: false };
    fs.writeFileSync(path.join(ROOT, 'desktop/dist/portable-smoke.json'), JSON.stringify(report, null, 2) + '\n');
    assert.equal(await (await fetch(`http://127.0.0.1:${sitePort}/bundle.json`)).text(), 'EXTERNAL SENTINEL');
    console.log('PASS: actual portable EXE launches from an unrelated directory without original-install paths; Rust samples/rankings match, native libraries and offline OCR work, an unrelated listener on the same port is untouched, capture stays disabled: ' + JSON.stringify(report));
  } finally {
    if (browser?.ws.readyState === WebSocket.OPEN) browser.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
    page?.ws.close(); browser?.ws.close();
    for (let i = 0; child.exitCode === null && i < 100; i++) await pause(100);
    if (child.exitCode === null) child.kill();
    probe.closeAllConnections(); await new Promise((resolve) => probe.close(resolve));
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
