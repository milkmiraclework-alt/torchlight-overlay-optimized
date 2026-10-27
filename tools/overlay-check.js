#!/usr/bin/env node
/* End-to-end checks against the real local Electron overlay, with an
 * isolated profile and a fake game title/log. No game input is sent.
 * node tools/overlay-check.js
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: pause } = require('node:timers/promises');
const { prepareRuntime, sourceExecutable } = require('./overlay-runtime.js');
const ROOT = path.resolve(__dirname, '..');
const standaloneAt = process.argv.indexOf('--standalone');
const standalone = standaloneAt >= 0 ? path.resolve(process.argv[standaloneAt + 1]) : null;
const installed = sourceExecutable();
const profile = path.join(ROOT, 'sandbox', `overlay-check-${process.pid}-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ consent: { withdrawn: true }, record: true }));
const log = path.join(profile, 'UE_game.log');
fs.writeFileSync(log, '');
const standIn = path.join(profile, 'game.html');
fs.writeFileSync(standIn, '<!doctype html><title>TartarusOverlayCheckOnly</title><body style="background:#17372b;color:white"><h1>Overlay capture test</h1><canvas width="640" height="360"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="#9db760";c.fillRect(0,0,640,360);</script>');
const fallbackPictureAt=process.argv.indexOf('--fallback-picture');
if(fallbackPictureAt>=0){
  const bytes=fs.readFileSync(path.resolve(process.argv[fallbackPictureAt+1]));
  fs.writeFileSync(standIn,'<!doctype html><title>TartarusOverlayCheckOnly</title><style>html,body{margin:0;width:100%;height:100%;background:black}img{width:100%;height:100%;object-fit:contain}</style><img src="data:image/webp;base64,'+bytes.toString('base64')+'">');
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (!pending.has(m.id)) return;
    pending.get(m.id)(m); pending.delete(m.id);
  };
  const call = (method, params = {}) => new Promise((resolve) => {
    const request = ++id;
    const timeout = method === 'Runtime.evaluate' && (process.argv.includes('--frames') || process.argv.includes('--day-panels') || process.argv.includes('--offer-panels')) ? 120000 : 45000;
    const timer = setTimeout(() => { pending.delete(request); resolve({ error: { message: `${method} timed out` } }); }, timeout);
    pending.set(request, (message) => { clearTimeout(timer); resolve(message); });
    ws.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async (expression) => {
    const m = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.error || m.result.exceptionDetails) throw new Error(JSON.stringify(m.error || m.result.exceptionDetails));
    return m.result.result.value;
  };
  return { ws, call, evaluate };
}

async function checkBrowserSolver(previousBase) {
  const T = window.Tartarus, current = window.TartarusSolver;
  const holder = { Tartarus: T, TARTARUS_COMBOS: window.TARTARUS_COMBOS }, module = { exports: {} };
  const response = await fetch(new URL(previousBase + 'solver.js', location.href));
  if (!response.ok) throw new Error('Solver baseline could not be loaded');
  new Function('window', 'module', await response.text())(holder, module);
  const previous = module.exports;
  const empty = T.newGame({ seed: 'CHAIN-TIMING', params: { rewards: false } });
  function populated(fight) {
    const st = T.newGame({ seed: 'CHAIN-TIMING', startEvent: fight ? 'cagefight' : null, params: { rewards: false } });
    st.pending = []; st.phase = 'manage'; st.position = 2; st.maxDays = 2;
    for (let n = 1; n <= 12; n++) T.editCell(st, n, { kind: 'open', beast: T.BEASTS[(n - 1) % 4], tier: (n - 1) / 4 | 0 });
    for (const tool of ['saw', 'whip', 'revenge', 'muzzle', 'maul', 'crown', 'skewer', 'collar']) T.addTool(st, tool);
    return st;
  }
  function finish(solver, state) {
    const job = solver.solve(state, { rollouts: 48, seed: 101 }); let result;
    do { result = job.step(50); } while (!result.done);
    // Upstream retired contracts and omits these unused zero counters.
    // Keep every actual sample/value/ranking in the comparison.
    return JSON.stringify({ result, rows: job.rows }, (key, value) =>
      (key === 'pass' || key === 'points') && value === 0 ? undefined : value);
  }
  const stats = [];
  for (const [name, state] of [['empty', empty], ['instruments', populated(false)], ['Cage Fight', populated(true)]]) {
    const saved = JSON.stringify(state), expected = finish(previous, state);
    if (finish(current, state) !== expected) throw new Error('Browser Monte Carlo result changed: ' + name);
    const times = { current: [], previous: [] };
    for (let repeat = 0; repeat < 5; repeat++) {
      const order = [['current', current], ['previous', previous]]; if (repeat % 2) order.reverse();
      for (const [label, solver] of order) {
        const start = performance.now(), result = finish(solver, state);
        times[label].push(performance.now() - start);
        if (result !== expected || JSON.stringify(state) !== saved) throw new Error('Browser calculation changed samples or source: ' + name);
      }
    }
    const median = (values) => Math.round(values.sort((a, b) => a - b)[values.length >> 1]);
    stats.push({ name, currentMs: median(times.current), previousMs: median(times.previous) });
  }
  return stats;
}

// Executed inside Electron. Trace nested worker creation/errors without
// adding test hooks or diagnostics to the application's reader protocol.
async function checkBrowserSearchPool(frames, previousBase, compareProbe = false) {
  const base = new URL('/js/', location.href).href;
  for (const [globalName, file] of [['TartarusFrameReadiness', 'frame-readiness.js'], ['TartarusScan', 'scan.js']]) {
    if (!window[globalName]) await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = new URL(file, base).href;
      script.onload = resolve; script.onerror = () => reject(new Error('Could not load ' + file)); document.head.append(script);
    });
  }
  const urls = [];
  const makeURL = (base) => {
  const code = `const base=${JSON.stringify(base)};
    const originalImport=importScripts;
    self.importScripts=(...files)=>originalImport.apply(self,files.map(file=>new URL(file,base).href));
    const originalFetch=fetch;
    self.fetch=(file,...args)=>originalFetch(new URL(file,base).href,...args);
    const OriginalWorker=Worker;
    self.Worker=class extends OriginalWorker {
      constructor(file,options){super(new URL(file,base).href,options);self.postMessage({trace:'created'});
        this.addEventListener('error',()=>self.postMessage({trace:'failed'}));}
    };
    importScripts('scan-worker.js');`;
  const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  urls.push(url); return url;
  };
  const url = makeURL(base);
  function start(parallel, urlOverride = url, tracking = false) {
    const worker = new Worker(urlOverride), pending = new Map();
    let created = 0, failed = 0, id = 0, lastTracking = null, calibration = null;
    worker.onmessage = ({ data }) => {
      if (data.trace) { if (data.trace === 'created') created++; else failed++; return; }
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id); clearTimeout(task.timer);
      lastTracking = data.tracking || null; calibration = data.calibration || null;
      if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
    };
    worker.onerror = (error) => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(error.message)); } pending.clear(); };
    worker.postMessage({ configure: { parallel, tracking } });
    return {
      worker, counts: () => ({ created, failed }),
      info: () => lastTracking, calibration: () => calibration,
      scan: (img, prepared) => new Promise((resolve, reject) => {
        const current = ++id;
        const timer = setTimeout(() => { pending.delete(current); reject(new Error('Browser reader timed out')); }, 30000);
        pending.set(current, { resolve, reject, timer });
        worker.postMessage({ id: current, width: img.width, height: img.height, buffer: img.data.buffer, prepared });
      }),
    };
  }
  const serial = start(false), parallel = start(true);
  const tracked = start(true, url, true);
  const previous = previousBase ? start(true, makeURL(new URL(previousBase, location.href).href)) : null;
  const previousTracked = previousBase ? start(true, makeURL(new URL(previousBase, location.href).href), true) : null;
  const stats = [];
  let firstFrame = null, lastFrame = null;
  try {
    if (!frames.length) frames = [{ name: 'non-board' }];
    for (const frame of frames) {
      let img;
      if (frame.url) {
        const bitmap = await createImageBitmap(await (await fetch(frame.url)).blob());
        const scale = Math.min(1, 2600 / bitmap.width);
        const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
        img = context.getImageData(0, 0, canvas.width, canvas.height);
      } else img = { width: 160, height: 100, data: new Uint8ClampedArray(160 * 100 * 4).fill(73) };
      let expected;
      let transition = null;
      const times = { serial: [], parallel: [], previous: [], tracked: [], previousTracked: [] };
      const rounds = frame.url ? 4 : 1;
      const measure = async (order, i) => {
        if (i % 2) order.reverse();
        for (const [name, reader] of order) {
          const start = performance.now(), result = await reader.scan(img), elapsed = performance.now() - start;
          delete result.ms;
          const json = JSON.stringify(result);
          if (!expected) expected = json;
          else if (json !== expected) throw new Error(`Browser reader output changed: ${frame.name}`);
          if (!i && name === 'tracked') transition = { ms: Math.round(elapsed), ...tracked.info() };
          if (!frame.url || i) times[name].push(elapsed);
        }
      };
      // Compare full searches and calibrated reads separately. Interleaving
      // five pipelines can legitimately expire the 30s calibration deadline
      // between tracked samples on a busy PC.
      for (let i = 0; i < rounds; i++) {
        await measure(previous ? [['parallel', parallel], ['previous', previous]] : [['serial', serial], ['parallel', parallel]], i);
      }
      for (let i = 0; i < rounds; i++) {
        await measure([['tracked', tracked], ...(previous ? [['previousTracked', previousTracked]] : [])], i);
      }
      const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
      if (frame.url) {
        if (!firstFrame) firstFrame = { img, calibration: tracked.calibration() };
        lastFrame = { img, calibration: tracked.calibration() };
        if (tracked.info().mode !== 'tracked' || tracked.info().panels !== 3) throw new Error('Layout/panel reuse did not run');
        if (!tracked.info().accelerated) throw new Error('WASM reader did not load in Electron');
      }
      stats.push({ name: frame.name, width: img.width, height: img.height, serialMs: times.serial.length ? Math.round(median(times.serial)) : null, parallelMs: Math.round(median(times.parallel)), trackedMs: Math.round(median(times.tracked)), transition, ...(previous ? { previousMs: Math.round(median(times.previous)), previousTrackedMs: Math.round(median(times.previousTracked)) } : {}) });
    }
    const count = parallel.counts(), expected = Math.min(4, Math.max(0, navigator.hardwareConcurrency - 2));
    if (count.created !== (expected >= 2 ? expected : 0) || count.failed || serial.counts().created) throw new Error(`Browser search pool failed: ${JSON.stringify(count)}`);
    let readiness = false;
    const readinessTimings = {};
    if (firstFrame && lastFrame && firstFrame.img !== lastFrame.img && firstFrame.calibration) {
      for (const [label, probeBase] of [['current', base], ...(compareProbe ? [['previous', new URL(previousBase, location.href).href]] : [])]) {
        const probe = new Worker(new URL('ready-worker.js', probeBase));
        let id = 0, accepted = null, lastProbe = null;
        async function check(img) {
          const canvas = new OffscreenCanvas(img.width, img.height);
          canvas.getContext('2d').putImageData(img, 0, 0);
          const bitmap = canvas.transferToImageBitmap(), current = ++id;
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Readiness worker timed out')), 5000);
            probe.onmessage = ({ data }) => { if (data.id === current) { clearTimeout(timer); lastProbe = data.probe || null; if (data.ready) accepted = data.prepared; resolve(data.ready); } };
            probe.onerror = (error) => { clearTimeout(timer); reject(new Error(error.message)); };
            probe.postMessage({ id: current, epoch: 1, bitmap }, [bitmap]);
          });
        }
        try {
          probe.postMessage({ calibrate: firstFrame.calibration });
          if (label === 'current') {
            const surface = new OffscreenCanvas(32, 48), context = surface.getContext('2d', { willReadFrequently: false });
            for (const frame of [firstFrame, lastFrame]) {
              const full = new OffscreenCanvas(frame.img.width, frame.img.height);
              full.getContext('2d').putImageData(frame.img, 0, 0);
              const bitmap = full.transferToImageBitmap();
              try {
                const exact = TartarusFrameReadiness.sampleFast(frame.img, firstFrame.calibration.loc, TartarusScan);
                const small = TartarusFrameReadiness.sampleBitmap(bitmap, firstFrame.calibration.loc, TartarusScan, context) || exact;
                if (exact.some((value, i) => value !== small[i])) throw new Error('Tiny readiness surface changed sampled pixels');
              } finally { bitmap.close(); }
            }
          }
          for (let i = 0; i < 3; i++) if (await check(firstFrame.img)) throw new Error('An unchanged old screen became ready');
          if (label === 'current') {
            const hiddenMenu = new ImageData(lastFrame.img.data.slice(), lastFrame.img.width, lastFrame.img.height);
            const loc = firstFrame.calibration.loc;
            const bottom = Math.max(TartarusScan.at(loc, 0, 3)[1], TartarusScan.at(loc, 5, 3)[1]) + 30 * loc.s;
            for (let y = Math.max(0, Math.floor(bottom)); y < hiddenMenu.height; y++) for (let x = 0; x < hiddenMenu.width; x++) {
              const offset = (y * hiddenMenu.width + x) * 4;
              hiddenMenu.data[offset] = hiddenMenu.data[offset + 1] = hiddenMenu.data[offset + 2] = 0;
            }
            for (let i = 0; i < 4; i++) {
              if (await check(hiddenMenu)) throw new Error('Stable screen without decision controls became ready');
              await new Promise(resolve => setTimeout(resolve, 110));
            }
            probe.postMessage({ calibrate: firstFrame.calibration });
          }
          const times = [], stages = [];
          for (let i = 0; i < 5; i++) {
            const start = performance.now();
            const ready = await check(lastFrame.img);
            times.push(performance.now() - start);
            stages.push(lastProbe && lastProbe.stage);
            if (ready !== (i >= 2)) throw new Error('Ready-screen recognition did not require 3 stable changed frames');
            await new Promise((resolve) => setTimeout(resolve, 110));
          }
          readinessTimings[label + 'CycleMs'] = Math.round(times.slice(0, 3).reduce((a, b) => a + b, 0));
          readinessTimings[label + 'Stages'] = stages;
          if (label === 'current') {
            if (stages[0] !== 'visual' || stages[1] !== 'visual' || stages[2] !== 'semantic') throw new Error('Stable-frame gate did not defer semantic work');
          }
          readinessTimings[label] = Math.round(times.slice().sort((a, b) => a - b)[times.length >> 1]);
          if (label === 'current') {
            if (!accepted) throw new Error('Accepted readiness frame did not include its readings');
            const start = performance.now(), result = await tracked.scan(lastFrame.img, accepted);
            readinessTimings.handoffMs = Math.round(performance.now() - start);
            delete result.ms;
            const oracle = await parallel.scan(lastFrame.img); delete oracle.ms;
            if (JSON.stringify(result) !== JSON.stringify(oracle)) throw new Error('Readiness handoff changed the final reading');
            if (!tracked.info().fromProbe) throw new Error('Accepted frame was read twice');
          }
          readiness = true;
        } finally { probe.terminate(); }
      }
    }
    return { workers: count.created, frames: stats, readiness, readinessTimings };
  } finally { serial.worker.terminate(); parallel.worker.terminate(); tracked.worker.terminate(); if (previous) previous.worker.terminate(); if (previousTracked) previousTracked.worker.terminate(); for (const url of urls) URL.revokeObjectURL(url); }
}

(async () => {
  // Preparing explicitly also checks that the runtime is built without
  // changing any file in the installed application.
  if (!standalone) prepareRuntime(installed);
  const env = { ...process.env };
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  let output = '';
  let sitePort = 0;
  if (standalone) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    sitePort = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    delete env.ELECTRON_RUN_AS_NODE;
    env.TARTARUS_INSTALLED_ASAR = path.join(profile, 'missing-original', 'app.asar');
    env.TARTARUS_OVERLAY_EXE = path.join(profile, 'missing-original', 'Tartarus Overlay.exe');
    env.LOCALAPPDATA = path.join(profile, 'missing-original-localappdata');
  }
  const launchArgs = [...(standalone ? [`--site-port=${sitePort}`, '--offline-check'] : [path.join(__dirname, 'local-overlay.js')]), '--test', '--offscreen', `--user-data=${profile}`, '--game-title=TartarusOverlayCheckOnly', `--log=${log}`, `--test-window=${standIn}`, '--remote-debugging-port=0'];
  const nativeFixtureAt=process.argv.indexOf('--native-fixture');
  if(nativeFixtureAt>=0)launchArgs.push('--native-fixture='+path.resolve(process.argv[nativeFixtureAt+1]));
  if(fallbackPictureAt>=0)launchArgs.push('--test-window-frameless');
  const launch = () => {
    const child = spawn(standalone || process.execPath, launchArgs, { cwd: standalone ? path.dirname(standalone) : ROOT, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.on('data', (s) => { output += s; });
    child.stderr.on('data', (s) => { output += s; });
    return child;
  };
  let launcher = launch();
  let fakeActivity = null;
  const sockets = [];
  let browser;
  try {
    for (let i = 0; !output.includes('analyzer page loaded:') && i < 200; i++) {
      if (launcher.exitCode !== null) throw new Error(output);
      await pause(100);
    }
    assert.ok(output.includes('analyzer page loaded:'), output);
    const [port, browserPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    browser = await connect(`ws://127.0.0.1:${port}${browserPath}`); sockets.push(browser.ws);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    assert.ok(!targets.some((t) => t.url.endsWith('/follow.html')), 'full follow page was created');
    const target = targets.find((t) => t.url.endsWith('/analyze.html'));
    const page = await connect(target.webSocketDebuggerUrl); sockets.push(page.ws);
    const evaluate = page.evaluate;
    // A cold isolated renderer can exceed the old five-second startup wait.
    // Keep initialization bounded and include dependency state on a slow start.
    for (let i = 0; i < 600 && !await evaluate('!!window.__tartarusFastRuntime'); i++) {
      if (i === 100) console.log('WAIT: cold renderer startup: ' + JSON.stringify(await evaluate('({ready:document.readyState,auto:!!window.TartarusAuto,capture:!!window.TartarusCapture,analyzer:!!window.TartarusAnalyzer})')));
      await pause(50);
    }
    assert.deepEqual(await evaluate('({fast:TartarusDesktop.fast,runtime:!!window.__tartarusFastRuntime,hidden:TartarusAnalyzer.desktopSnapshot().background})'), { fast: true, runtime: true, hidden: true }, output);
    console.log('PASS: local source runtime, native dependencies and a single hidden backend.');
    if (standalone) {
      assert.ok(output.includes('bundled analyzer: '), 'Packaged app did not serve its own analyzer');
      assert.ok(output.includes('win32=true'), 'Packaged native libraries did not load');
      const offlineOCR = await evaluate(`(async()=>{
        if(!window.TARTARUS_BUNDLED_OCR)throw new Error('Offline OCR configuration missing');
        const start=performance.now(),worker=await TartarusAnalyzer.prepareOCR();
        if(!worker)throw new Error('Bundled OCR did not initialize');
        const canvas=document.createElement('canvas');canvas.width=680;canvas.height=110;
        const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,680,110);ctx.fillStyle='black';ctx.font='42px Arial';ctx.fillText('TARTARUS 12345',20,68);
        const result=await worker.recognize(canvas),text=result.data.text.trim();
        if(!/TARTARUS\\s+12345/i.test(text))throw new Error('Offline OCR text mismatch: '+text);
        return {text,ms:Math.round(performance.now()-start),version:(await(await fetch('/bundle.json')).json()).version};
      })()`);
      console.log('PASS: standalone native libraries and bundled OCR work with missing original-install paths and all external HTTP requests blocked: '+JSON.stringify(offlineOCR));
    }
    if (process.argv.includes('--rust-bench')) {
      const checkRust = require('./rust-solver-browser-check.js');
      const timing = await evaluate(`(${checkRust.toString()})()`);
      const report = { electron: require('../desktop/node_modules/electron/package.json').version,
        cpu: require('node:os').cpus()[0].model, ...timing };
      const dir = path.join(ROOT, 'sandbox/rust-solver-bench'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'electron-report.json'), JSON.stringify(report, null, 2) + '\n');
      console.log('PASS: actual Electron Rust/WASM samples, rankings, promotion and alternating benchmark: ' + JSON.stringify(report));
      return;
    }
    if (process.argv.includes('--contracts-only')) {
      const overlayTarget = targets.find(t => t.url.endsWith('/overlay.html'));
      assert.ok(overlayTarget, 'Overlay renderer was not created');
      const overlayPage = await connect(overlayTarget.webSocketDebuggerUrl); sockets.push(overlayPage.ws);
      const cards = { cagefight: 'Cage Fight', tyranny: 'Tyranny', opulence: 'Opulence', none: '' };
      await evaluate('TartarusDesktop.follow({active:true,agreed:false,log:"on",window:"on",hits:1});true');
      for (const [id, name] of Object.entries(cards)) {
        const snapshot = await evaluate(`(()=>{const sel=document.getElementById('az-start-event');sel.value=${JSON.stringify(id)};sel.dispatchEvent(new Event('change'));return TartarusAnalyzer.desktopSnapshot();})()`);
        assert.equal(snapshot.contract, name, 'Hidden fast backend lost the selected contract');
        for (let i = 0; i < 100; i++) {
          const header = await overlayPage.evaluate('document.getElementById("day").textContent');
          if (Object.values(cards).filter(Boolean).every(card => header.includes(card) === (card === name))) break;
          if (i === 99) assert.fail('Overlay header did not follow the selected contract: ' + header);
          await pause(20);
        }
      }
      console.log('PASS: hidden fast backend and actual overlay header show Cage Fight, Tyranny, Opulence and no contract correctly.');
      await overlayPage.evaluate('Overlay.command("board");true');
      for (let i = 0; i < 100 && await evaluate('TartarusAnalyzer.desktopSnapshot().background'); i++) await pause(20);
      assert.equal(await evaluate('TartarusAnalyzer.desktopSnapshot().background'), false);
      const checkDialog = require('./contracts-overlay-check.js');
      console.log(`PASS: actual instrument dialog: ${JSON.stringify(await evaluate(`(${checkDialog.toString()})()`))}`);
      return;
    }
    if (process.argv.includes('--instruments-only')) {
      const checkInstruments = require('./instruments-overlay-check.js');
      const overlayTarget = targets.find((t) => t.url.endsWith('/overlay.html'));
      assert.ok(overlayTarget, 'Overlay renderer was not created');
      const overlayPage = await connect(overlayTarget.webSocketDebuggerUrl); sockets.push(overlayPage.ws);
      // The combined app hides Tartarus while no mode is active. This
      // fixture edits a Tartarus board directly instead of entering by log.
      await evaluate('TartarusDesktop.setFastSettings({mode:"tartarus"});true');
      for (let i=0;i<100&&!await evaluate('TartarusDesktop.fastSettings().then(s=>s.activeMode==="tartarus")');i++) await pause(10);
      await evaluate('TartarusDesktop.follow({active:true,agreed:false,log:"on",window:"on",hits:1});true');
      const beforePending = evaluate(`(${checkInstruments.toString()})(false,true)`);
      for (let i = 0; i < 500 && !await evaluate('!!window.__instrumentConfirmation'); i++) await pause(20);
      assert.ok(await evaluate('!!window.__instrumentConfirmation'), 'Confirmation fixture did not become ready');
      assert.equal(await evaluate('document.getElementById("az-tools-dialog").open'), false, 'A hidden confirmation opened a background instrument dialog');
      await overlayPage.evaluate('Overlay.command("board");true');
      for (let i = 0; i < 100 && !await evaluate('document.getElementById("az-tools-dialog").open'); i++) await pause(20);
      assert.ok(await evaluate('document.getElementById("az-tools-dialog").contains(document.getElementById("az-tools-ok"))'), 'Opening the board did not show the instrument confirmation dialog');
      let point;
      for (let i = 0; i < 100; i++) {
        point = await overlayPage.evaluate(`(()=>{const b=document.querySelector('[data-cmd="tools-ok"]');if(!b)return null;window.__pressedConfirm=b;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        if (point) break;
        await pause(20);
      }
      assert.ok(point, 'Overlay confirmation button was not shown');
      await overlayPage.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      for (const progress of [20, 35, 55]) {
        await evaluate(`TartarusDesktop.advice({...TartarusAnalyzer.desktopSnapshot(),working:true,progress:${progress}});true`);
        await pause(50);
        assert.ok(await overlayPage.evaluate('window.__pressedConfirm.isConnected'), 'Progress update detached the pressed confirmation button');
      }
      await overlayPage.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      for (let i = 0; i < 100 && !await evaluate('!!JSON.parse(localStorage.getItem("tartarus-sim:analyzer:v1")).model.toolsConfirmed'); i++) await pause(20);
      assert.ok(await evaluate('!!JSON.parse(localStorage.getItem("tartarus-sim:analyzer:v1")).model.toolsConfirmed'), 'Physical overlay click did not confirm instruments');
      assert.equal(await evaluate('document.getElementById("az-tools-dialog").open'), false, 'Overlay confirmation did not close the instrument dialog');
      await evaluate('window.__instrumentConfirmation.resolve();true');
      const before = await beforePending;
      for (let attempt = 0; attempt < 2; attempt++) {
        await evaluate('document.getElementById("az-tools-close").click();true');
        assert.equal(await evaluate('document.getElementById("az-tools-dialog").open'), false);
        const toolsPoint = await overlayPage.evaluate(`(()=>{const b=document.querySelector('#foot [data-cmd="tools"]'),r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await overlayPage.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...toolsPoint, button: 'left', clickCount: 1 });
        await overlayPage.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...toolsPoint, button: 'left', clickCount: 1 });
        let opened;
        for (let i = 0; i < 200; i++) {
          opened = await evaluate(`(()=>{const d=document.getElementById('az-tools-dialog'),s=document.getElementById('az-tools-search'),r=d.getBoundingClientRect(),p=s.getBoundingClientRect();return {open:d.open,modal:d.matches(':modal'),onscreen:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,clickable:document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)===s};})()`);
          if (opened.open && opened.modal && opened.onscreen && opened.clickable) break;
          await pause(10);
        }
        assert.deepEqual(opened, { open: true, modal: true, onscreen: true, clickable: true }, 'Instruments failed to reopen visibly: ' + JSON.stringify(opened));
      }
      await page.call('Page.reload', { ignoreCache: true });
      for (let i = 0; i < 200; i++) {
        try { if (await evaluate('!!window.__tartarusFastRuntime')) break; } catch {}
        await pause(25);
      }
      const after = await evaluate(`(${checkInstruments.toString()})(true)`);
      console.log(`PASS: direct instrument button reopens a visible, clickable modal twice; physical confirmation across 3 progress updates; 10 conflicting/missing/growing-slot frames across reload; pending/ambiguous picks block advice and unique/manual choices recover: ${JSON.stringify({ before, after })}`);
      return;
    }
    if (process.argv.includes('--offer-panels')) {
      const check = require('./offer-panels-check.js'), labels = check.readSamples(process.argv[process.argv.indexOf('--offer-panels') + 1]);
      const boardAt=process.argv.indexOf('--acquisition-board'),packaged=boardAt>=0;
      const boardURL=packaged?'data:image/webp;base64,'+fs.readFileSync(path.resolve(process.argv[boardAt+1])).toString('base64'):null;
      const results = packaged?await evaluate(`(${check.browserPackagedOffers.toString()})(${JSON.stringify(labels)},${JSON.stringify(boardURL)})`):await evaluate(`(()=>{const T=window.Tartarus; ${check.sourceHelpers()}; return (${check.browserOffers.toString()})(${JSON.stringify(labels)},ocrPixels,nameFromText);})()`);
      const runtimeVersion=await evaluate('(async()=> (await(await fetch("/bundle.json")).json()).version)()');
      fs.writeFileSync(path.join(ROOT, 'tools/results',packaged?'offers-packaged.json':'offer-panels.json'), JSON.stringify({version:require('../desktop/package.json').version,runtimeVersion,checkedAt:new Date().toISOString(),packaged,results,gameCapture:false,gameInput:false}, null, 2) + '\n');
      console.log('PASS: saved instrument offer diagnostic: ' + JSON.stringify(results)); return;
    }
    if (process.argv.includes('--day-panels')) {
      const check = require('./day-panels-check.js');
      const sourceAt = process.argv.indexOf('--reader-source');
      if (sourceAt >= 0) await evaluate(fs.readFileSync(path.resolve(process.argv[sourceAt + 1]), 'utf8') + '\ntrue');
      const labels = check.readSamples(process.argv[process.argv.indexOf('--day-panels') + 1]);
      const results = await evaluate(`(${check.browserDays.toString()})(${JSON.stringify(labels)},${process.argv.includes('--days-ocr-only')})`);
      fs.mkdirSync(path.join(ROOT, 'tools/results'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'tools/results/day-panels.json'), JSON.stringify({ version: require('../desktop/package.json').version, checkedAt: new Date().toISOString(), readerSourceOverride: sourceAt >= 0, results, gameCapture: false, gameInput: false }, null, 2) + '\n');
      console.log('PASS: labelled saved countdowns and packaged day context: ' + JSON.stringify(results));
      return;
    }
    if (process.argv.includes('--instrument-panels')) {
      const check = require('./instrument-panels-check.js');
      const sourceAt=process.argv.indexOf('--panel-data-source');
      if(sourceAt>=0)await evaluate(fs.readFileSync(path.resolve(process.argv[sourceAt+1]),'utf8')+'\ntrue');
      const readerAt=process.argv.indexOf('--reader-source');
      if(readerAt>=0)await evaluate(fs.readFileSync(path.resolve(process.argv[readerAt+1]),'utf8')+'\ntrue');
      const labels = check.readSamples(process.argv[process.argv.indexOf('--instrument-panels') + 1]);
      const audit=process.argv.includes('--audit-panels');
      const results = await evaluate(`(${check.browserPanels.toString()})(${JSON.stringify(labels)},${audit},${process.argv.includes('--negative-panels')})`);
      fs.mkdirSync(path.join(ROOT, 'tools/results'), { recursive: true });
      const runtimeVersion=await evaluate('(async()=> (await(await fetch("/bundle.json")).json()).version)()');
      fs.writeFileSync(path.join(ROOT, 'tools/results',audit?'instrument-audit.json':'instrument-panels.json'), JSON.stringify({ version: require('../desktop/package.json').version, runtimeVersion, sourceOverrides: sourceAt>=0 || readerAt>=0, checkedAt: new Date().toISOString(), audit, results, gameCapture: false, gameInput: false }, null, 2) + '\n');
      console.log((audit?'AUDIT:':'PASS:')+' labelled saved instrument panels, actual packaged reader: ' + JSON.stringify(results));
      return;
    }
    if (process.argv.includes('--panel-manifest')) {
      const learner = require('./panel-learn.js'), check = process.argv.includes('--check-panels');
      const labels = learner.readSamples(process.argv[process.argv.indexOf('--panel-manifest') + 1]);
      const result = await evaluate(`(${learner.browserPanels.toString()})(${JSON.stringify(labels)},${check})`);
      if (!check) learner.save(result);
      console.log(JSON.stringify(result.results));
      return;
    }
    if (process.argv.includes('--forecast-only')) {
      const checkForecast = require('./forecast-overlay-check.js');
      console.log(`PASS: isolated forecast integration: ${JSON.stringify(await evaluate(`(${checkForecast.toString()})()`))}`);
      return;
    }
    if (process.argv.includes('--native-fallback-only')) {
      assert(nativeFixtureAt>=0&&fallbackPictureAt>=0);
      await evaluate('window.fallbackReads=[];const old=TartarusAnalyzer.readPick;TartarusAnalyzer.readPick=async frame=>{const r=await old(frame);fallbackReads.push({native:!!frame.native,ok:r.ok,unreadable:!!frame.unreadable,cards:r.cards?.map(c=>c.sim)});return r;};TartarusDesktop.setConsent({version:4,at:new Date().toISOString()});TartarusDesktop.setFastSettings({mode:"tartarus"});true');
      for(let i=0;i<200&&!await evaluate('TartarusCapture.state.log==="on"');i++)await pause(25);
      fs.appendFileSync(log,'[2026.10.27-12.00.00:000] TLLua: S16BoardRelicPop Run\n');
      for(let i=0;i<300&&!await evaluate('fallbackReads.some(r=>!r.native&&r.ok)');i++)await pause(50);
      const result=await evaluate('(async()=>({reads:fallbackReads,status:TartarusCapture.state,nativeReader:(await TartarusDesktop.suiteInfo()).nativeReader}))()');
      assert(result.reads.some(r=>r.native&&!r.ok&&r.unreadable),JSON.stringify(result));
      const good=result.reads.find(r=>!r.native&&r.ok);assert(good,JSON.stringify(result));
      const expectedAt=process.argv.indexOf('--expected-tools');if(expectedAt>=0)assert.deepEqual(good.cards,process.argv[expectedAt+1].split(','));
      assert.equal(result.nativeReader.running,false,'Incompatible native capture was retained');
      assert.equal(result.reads.filter(r=>r.native).length,1,'The bad GDI image was retried');
      fs.writeFileSync(path.join(ROOT,'tools/results/native-fallback-e2e.json'),JSON.stringify({version:require('../desktop/package.json').version,reads:result.reads,nativeStopped:true,automatic:true,gameCapture:false,gameInput:false},null,2)+'\n');
      console.log('PASS: first-move non-black native capture fails, closes and automatically retries through actual compatible Windows capture; all three offered tools recovered: '+JSON.stringify(result.reads));
      return;
    }
    if (process.argv.includes('--native-offer-only')) {
      assert(nativeFixtureAt>=0);
      const fixture=path.resolve(process.argv[nativeFixtureAt+1]),url='data:image/webp;base64,'+fs.readFileSync(fixture).toString('base64');
      await evaluate('TartarusDesktop.setConsent({version:4,at:new Date().toISOString()});TartarusDesktop.setFastSettings({mode:"tartarus"});true');
      for(let i=0;i<200&&!await evaluate('(async()=>{const s=await TartarusDesktop.suiteInfo();return s.enabled&&s.mode==="tartarus";})()');i++)await pause(25);
      const result=await evaluate(`(async()=>{
        const D=TartarusDesktop,A=TartarusAnalyzer,c=await D.nativeReader('connect'),frame=await D.nativeReader('grab',{session:c.session});
        const native=await A.readPick(frame),bitmap=await createImageBitmap(await(await fetch(${JSON.stringify(url)})).blob());
        const compatible=await A.readPick(bitmap);bitmap.close();
        await D.nativeReader('release',{token:frame.token,session:frame.session});await D.nativeReader('stop');A.suspend();
        return {native:{ok:native.ok,cards:native.cards?.map(c=>c.sim),byName:native.byName},compatible:{ok:compatible.ok,cards:compatible.cards?.map(c=>c.sim),byName:compatible.byName}};
      })()`);
      assert(result.native.ok,JSON.stringify(result));assert.deepEqual(result.native,result.compatible);
      const expectedAt=process.argv.indexOf('--expected-tools');if(expectedAt>=0)assert.deepEqual(result.native.cards,process.argv[expectedAt+1].split(','));
      console.log('PASS: packaged native-frame materialization and OCR preserve actual offered instrument identities: '+JSON.stringify(result));
      return;
    }
    if (process.argv.includes('--native-reader-only')) {
      assert(nativeFixtureAt>=0,'Native integration needs a saved RGBA fixture');
      const fixture=path.resolve(process.argv[nativeFixtureAt+1]);
      const url='data:image/webp;base64,'+fs.readFileSync(fixture).toString('base64');
      await evaluate('TartarusDesktop.setConsent({version:4,at:new Date().toISOString()});TartarusDesktop.setFastSettings({mode:"tartarus"});true');
      for(let i=0;i<200&&!await evaluate('(async()=>{const s=await TartarusDesktop.suiteInfo();return s.enabled&&s.mode==="tartarus";})()');i++)await pause(25);
      const report=await evaluate(`(async()=>{
        const D=TartarusDesktop,A=TartarusAnalyzer,times={native:[],compatible:[]};
        A.setForecastEnabled(false);A.prepare();
        const connected=await D.nativeReader('connect');
        let oracle=null;
        for(let i=0;i<6;i++)for(const mode of i%2?['native','compatible']:['compatible','native']){
          let source;
          if(mode==='native')source=await D.nativeReader('grab',{session:connected.session});
          else source=await createImageBitmap(await(await fetch(${JSON.stringify(url)})).blob());
          const start=performance.now(),read=await A.readFrameDirect(source),ms=performance.now()-start;
          const shape={ok:read.ok,day:read.day,unsure:read.unsure,controls:read.controls,statusView:read.statusView,instrumentPanel:read.instrumentPanel};
          if(!read.ok)throw Error('Saved-frame native integration failed: '+JSON.stringify(read));
          if(oracle&&JSON.stringify(shape)!==JSON.stringify(oracle))throw Error('Native/compatible model conversion differs: '+JSON.stringify({oracle,shape}));
          oracle=shape;if(i)times[mode].push(ms);
          if(mode==='native'){
            if(!A.readerInfo().native)throw Error('Native path was bypassed');
            const probe=await A.probeFrame(source,{epoch:987});if(probe!==false)throw Error('An unchanged picture was accepted');
            await D.nativeReader('release',{token:source.token,session:source.session});
          }else source.close();
        }
        await D.nativeReader('stop');A.suspend();
        const info=await D.suiteInfo();if(info.nativeReader.running)throw Error('Native reader survived stop');
        let stale=false;try{await D.nativeReader('read',{token:1,session:connected.session});}catch{stale=true;}
        if(!stale)throw Error('Old capture session accepted');
        return {times,shape:oracle,staleRejected:stale,nativeStopped:!info.nativeReader.running};
      })()`);
      fs.mkdirSync(path.join(ROOT,'tools/results'),{recursive:true});
      fs.writeFileSync(path.join(ROOT,'tools/results/native-reader-e2e.json'),JSON.stringify({version:require('../desktop/package.json').version,...report,gameCapture:false,gameInput:false,limitations:'Two reader paths on one saved frame; excludes animation waiting, actual game capture, OCR names and simulation. One machine.'},null,2)+'\n');
      console.log('PASS: packaged native Rust DLL, structured IPC/model parity, repeated fresh frames, unchanged-frame rejection, stale-session rejection and native thread cleanup: '+JSON.stringify(report));
      return;
    }
    if (process.argv.includes('--worker-lifecycle-only')) {
      const framesAt = process.argv.indexOf('--frames');
      assert.ok(framesAt >= 0, 'Lifecycle check needs a saved frame directory');
      const folder = path.resolve(process.argv[framesAt + 1]), file = fs.readdirSync(folder).find(n => n.endsWith('.webp'));
      assert.ok(file);
      const url = 'data:image/webp;base64,' + fs.readFileSync(path.join(folder, file)).toString('base64');
      const lifecycle = await evaluate(`(async()=>{
        const A=TartarusAnalyzer,Original=Worker,created=[];let suspended=0;
        window.Worker=class extends Original{constructor(url,...rest){super(url,...rest);this.checkUrl=String(url);created.push(this);}terminate(){this.checkTerminated=true;return super.terminate();}};
        try{
          for(let i=0;i<4;i++){A.prepare();A.suspend();suspended++;}
          A.prepare();
          const failed=created.find(w=>w.checkUrl.includes('scan-worker.js')&&!w.checkTerminated);
          failed.onerror(new Event('error',{cancelable:true}));
          A.suspend();suspended++;
          const old=created.slice();A.prepare();
          for(const worker of old)if(worker.onerror)worker.onerror(new Event('error',{cancelable:true}));
          await new Promise(r=>setTimeout(r,100));
          const bitmap=await createImageBitmap(await(await fetch(${JSON.stringify(url)})).blob());
          const start=performance.now(),read=await A.readFrameDirect(bitmap),ms=Math.round(performance.now()-start);
          const info=A.readerInfo(),pool=A.workerInfo();
          if(!read.ok||!info?.accelerated||pool.allocated!==pool.limit)throw new Error('Reader fell back after cancelled imports: '+JSON.stringify({read,info,pool}));
          A.suspend();
          for(let i=0;i<100&&created.some(w=>!w.checkTerminated);i++)await new Promise(r=>setTimeout(r,10));
          if(created.some(w=>!w.checkTerminated))throw new Error('Lifecycle left a worker allocated: '+JSON.stringify(created.filter(w=>!w.checkTerminated).map(w=>w.checkUrl)));
          return {suspended,workers:created.length,readMs:ms,accelerated:info.accelerated,poolRecovered:pool.allocated===pool.limit,idleWorkers:0};
        }finally{A.suspend();window.Worker=Original;}
      })()`);
      console.log('PASS: real Electron import cancellation, injected current-reader failure and late errors from old generations retain the accelerated reader and solver pool: '+JSON.stringify(lifecycle));
      return;
    }

    await evaluate(`(()=>{window.solverWarmCount=0;window.liveCheckWorkers=new Set();const OriginalWorker=Worker;window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);window.liveCheckWorkers.add(this);if(String(url).includes('solver-worker.js'))window.solverWarmCount++;}terminate(){window.liveCheckWorkers.delete(this);return super.terminate();}};})();TartarusDesktop.setConsent({version:4,at:new Date().toISOString()});true`);
    for (let i = 0; i < 100 && !await evaluate('TartarusCapture.state.log === "on"'); i++) await pause(25);
    assert.equal(await evaluate('TartarusCapture.state.log'), 'on');
    assert.equal(await evaluate('window.solverWarmCount'),0,'Enabling the log started calculation workers outside the mode');
    assert.equal(await evaluate('TartarusCapture.state.window'),'off','Enabling the log started capture outside the mode');
    await evaluate('window.wakeAt=0;TartarusDesktop.onLogChanged(()=>{window.wakeAt=Date.now();});true');
    const writtenAt = Date.now();
    fs.appendFileSync(log, '[2026.10.17-01.00.00:000] TLLua: S16OverlayWakeCheck\n');
    for (let i = 0; i < 100 && !await evaluate('TartarusCapture.state.lines > 0'); i++) await pause(10);
    const wake = await evaluate('({at:window.wakeAt,lines:TartarusCapture.state.lines})');
    assert.ok(wake.at && wake.lines > 0, 'native log event was not delivered');
    console.log(`PASS: native log wakeup and bounded reader; event latency ${wake.at - writtenAt} ms.`);
    fs.appendFileSync(log, '[2026.10.17-01.00.00:100] TLLua: S16BoardMain Run\n');
    for (let i = 0; i < 200 && !await evaluate('TartarusCapture.state.window === "on"'); i++) await pause(25);
    assert.equal(await evaluate('TartarusCapture.state.window'), 'on', output + JSON.stringify(await evaluate('TartarusDesktop.game()')) + JSON.stringify(targets.filter(t=>t.url.endsWith('/game.html')).map(t=>({title:t.title,url:t.url}))));
    const workerInfo = await evaluate('TartarusAnalyzer.workerInfo()');
    assert.equal(workerInfo.limit, await evaluate('Math.max(1,Math.min(16,navigator.hardwareConcurrency-1))'));
    assert.equal(await evaluate('window.solverWarmCount'), workerInfo.limit, 'Auto-sized solver workers were not prepared on entry before the first picture');
    assert.equal(workerInfo.allocated, workerInfo.limit);
    console.log('PASS: capture and warm workers start on board entry; enabling log detection alone stays idle.');
    await evaluate(`(async()=>{TartarusAnalyzer.readTreasure=async()=>({ok:false});for(let i=0;i<3;i++){if(await TartarusCapture.captureNow('board'))return true;await new Promise(r=>setTimeout(r,100));}throw new Error('Fake-window stream did not produce a frame: '+JSON.stringify(TartarusCapture.state));})()`);
    for (let i = 0; i < 200 && !await evaluate('!!TartarusAnalyzer.desktopSnapshot().lastRead'); i++) await pause(25);
    assert.ok(await evaluate('TartarusCapture.state.frames > 0 && !!TartarusAnalyzer.image()'));
    console.log('PASS: actual Windows window capture through the direct bitmap/reader pipeline.');
    for (let cycle = 0; cycle < 3; cycle++) {
      fs.appendFileSync(log, '[2026.10.17-01.00.00:200] TLLua: S16BoardMain Destory\n');
      for (let i = 0; i < 200 && !await evaluate('TartarusCapture.state.window === "off" && window.liveCheckWorkers.size === 0'); i++) await pause(10);
      assert.deepEqual(await evaluate('({window:TartarusCapture.state.window,workers:window.liveCheckWorkers.size,forecast:TartarusAnalyzer.forecastInfo().enabled,image:!!TartarusAnalyzer.image(),log:TartarusCapture.state.log})'),
        { window: 'off', workers: 0, forecast: false, image: false, log: 'on' }, 'Exit retained capture, workers or image memory');
      assert.equal((await evaluate('TartarusDesktop.suiteInfo()')).nativeReader.running, false, 'Exit retained native reader thread');
      const warm = await evaluate('window.solverWarmCount');
      await pause(1100);
      assert.equal(await evaluate('window.solverWarmCount'), warm, 'The one-second watchdog recreated workers outside the mode');
      assert.equal(await evaluate('TartarusCapture.state.window'), 'off');
      fs.appendFileSync(log, '[2026.10.17-01.00.00:300] TLLua: S16BoardMain Run\n');
      for (let i = 0; i < 200 && !await evaluate('TartarusCapture.state.window === "on"'); i++) await pause(10);
      assert.equal(await evaluate('TartarusCapture.state.window'), 'on');
    }
    console.log('PASS: three real capture entry/exit cycles release every reader/solver/readiness worker and screenshot, keep log detection alive and stay asleep between entries.');
    const frameCount=await evaluate('TartarusCapture.state.frames');
    await evaluate('TartarusCapture.setRules([{kind:"board",pattern:"S16FullPathCheck",settle:500}]);true');
    const eventAt=Date.now();
    fs.appendFileSync(log,'[2026.10.17-01.00.01:000] TLLua: S16FullPathCheck\n');
    let settling = false;
    for (let i = 0; i < 50 && !settling; i++) {
      settling = await evaluate('TartarusAnalyzer.desktopSnapshot().reading?.phase === "settling"');
      if (!settling) await pause(5);
    }
    assert.ok(settling, 'Game trigger did not publish the settling status');
    for(let i=0;i<200&&await evaluate('TartarusCapture.state.frames')===frameCount;i++)await pause(10);
    assert.ok(await evaluate('TartarusCapture.state.frames')>frameCount,'log event did not capture a frame');
    const captureMs=Date.now()-eventAt;
    assert.ok(captureMs>=495,'capture skipped the animation settling wait');
    for(let i=0;i<200&&await evaluate('TartarusAnalyzer.desktopSnapshot().reading !== null');i++)await pause(25);
    console.log(`PASS: automatic log-to-frame path (${captureMs} ms including the 500 ms settling wait).`);
    const recordings = path.join(profile, 'records');
    const hasPicture = () => fs.existsSync(recordings) && fs.readdirSync(recordings, { recursive: true }).some((file) => file.endsWith('.webp'));
    assert.equal(hasPicture(), false, 'Screenshot recording must be excluded from the unified app');
    console.log('PASS: screenshot/session recording is excluded from the unified app.');
    // Offline benchmarks can last longer than the production idle timeout.
    // Keep the isolated fake game active using its log, without capture hits:
    // only S16FullPathCheck is a screenshot trigger at this point.
    fakeActivity = setInterval(() => fs.appendFileSync(log, '[2026.10.17-01.00.02:000] TLLua: S16BoardMain Run\n'), 5000);

    const pixels = await evaluate(`(async()=>{
      const stats=[];
      for(const [name,file] of [['TartarusFrameReadiness','frame-readiness.js'],['TartarusScan','scan.js']]){
        if(!window[name])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/js/'+file;script.onload=resolve;script.onerror=reject;document.head.append(script);});
      }
      for(const width of [1920,3840]){
        const height=width*9/16;
        const source=new OffscreenCanvas(width,height),ctx=source.getContext('2d');
        const gradient=ctx.createLinearGradient(0,0,width,height);
        gradient.addColorStop(0,'#183427');gradient.addColorStop(1,'#c7ac82');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
        const bitmapCheck=await createImageBitmap(source),full=ctx.getImageData(0,0,width,height);
        const tiny=new OffscreenCanvas(32,48).getContext('2d',{willReadFrequently:false});
        for(const s of [0.63,0.675,0.81]){
          const loc={s,tx:200.123,ty:150.456};
          const wanted=TartarusFrameReadiness.sampleFast(full,loc,TartarusScan);
          const got=TartarusFrameReadiness.sampleBitmap(bitmapCheck,loc,TartarusScan,tiny);
          if(!got||wanted.some((value,i)=>value!==got[i]))throw new Error('GPU readiness sample differs at '+width+' scale '+s);
        }
        bitmapCheck.close();
        const scale=Math.min(1,2600/width),w=Math.round(width*scale),h=Math.round(height*scale);
        let expected;
        let oldSync=0,newSync=0;
        for(const direct of [false,true]){
          const bitmap=await createImageBitmap(source),start=performance.now();
          const task=direct?TartarusAnalyzer.readFrameDirect(bitmap):TartarusAnalyzer.readFrame(bitmap);
          const sync=performance.now()-start;
          await task;
          if(direct)newSync=sync;else{oldSync=sync;bitmap.close();}
          const check=new OffscreenCanvas(w,h),cc=check.getContext('2d',{willReadFrequently:true});cc.drawImage(TartarusAnalyzer.image(),0,0);
          const actual=cc.getImageData(0,0,w,h).data;
          if(!direct)expected=actual;
          else for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])throw new Error('Reader pixels changed at '+i+' for '+width+' actual='+actual[i]+' expected='+expected[i]);
        }
        stats.push({width,oldMainThreadMs:+oldSync.toFixed(2),directMainThreadMs:+newSync.toFixed(2)});
      }
      const a=new OffscreenCanvas(400,300),b=new OffscreenCanvas(400,300),c=new OffscreenCanvas(400,300);
      for(const canvas of [a,b,c])canvas.getContext('2d').fillRect(0,0,400,300);
      const first=TartarusAnalyzer.readFrameDirect(await createImageBitmap(a));
      const second=TartarusAnalyzer.readFrameDirect(await createImageBitmap(b));
      const third=TartarusAnalyzer.readFrameDirect(await createImageBitmap(c));
      const results=await Promise.all([first,second,third]);
      if(!results[0].skipped||!results[1].skipped)throw new Error('An older reading was not cancelled');
      return stats;
    })()`);
    console.log(`PASS: exact reader pixels at 1080p/4K, worker bitmap ownership and superseded frames: ${JSON.stringify(pixels)}`);

    const frameOption = process.argv.indexOf('--frames');
    const frames = frameOption < 0 ? [] : fs.readdirSync(path.resolve(process.argv[frameOption + 1])).filter((name) => /\.(webp|png|jpe?g)$/i.test(name)).map((name) => ({ name, url: `data:image/${/\.webp$/i.test(name) ? 'webp' : /\.png$/i.test(name) ? 'png' : 'jpeg'};base64,${fs.readFileSync(path.resolve(process.argv[frameOption + 1], name)).toString('base64')}` }));
    const readerBaselineAt = process.argv.indexOf('--reader-baseline');
    const previousBase = readerBaselineAt < 0 ? null : '/' + path.relative(ROOT, path.resolve(process.argv[readerBaselineAt + 1])).replace(/\\/g, '/') + '/';
    if (previousBase && previousBase.includes('/../')) throw new Error('Reader baseline must be inside this checkout.');
    const compareProbe = readerBaselineAt >= 0 && fs.existsSync(path.resolve(process.argv[readerBaselineAt + 1], 'ready-worker.js'));
    const pool = await evaluate(`(${checkBrowserSearchPool.toString()})(${JSON.stringify(frames)},${JSON.stringify(previousBase)},${compareProbe})`);
    console.log(`PASS: real Electron nested search workers, exact reader results and reuse: ${JSON.stringify(pool)}`);
    let appReadiness = null;
    if (frames.length >= 2) {
      const readiness = await evaluate(`(async()=>{
        const replies=[],originalPost=Worker.prototype.postMessage;
        Worker.prototype.postMessage=function(data,...args){
          if(data&&'calibrate' in data&&!this._readinessCheck){this._readinessCheck=true;this.addEventListener('message',e=>{if('ready' in e.data)replies.push(e.data);});}
          return originalPost.call(this,data,...args);
        };
        const urls=${JSON.stringify(frames.slice(0, 2).map((frame) => frame.url))};
        const load=async(url)=>createImageBitmap(await(await fetch(url)).blob());
        const first=await load(urls[0]);
        const result=await TartarusAnalyzer.readFrameDirect(first);
        if(!result.ok)throw new Error('Could not calibrate the application reader');
        const old=await load(urls[0]),next=await load(urls[1]);
        const values=[]; let reused = false, differentBitmap = false, handoffMs = 0;
        try{
          for(let i=0;i<3;i++)if(await TartarusAnalyzer.probeFrame(old,{epoch:98765}))throw new Error('Application accepted an unchanged old frame');
          for(let i=0;i<3;i++){
            const ready=await TartarusAnalyzer.probeFrame(next,{epoch:98765});values.push(ready);
            if(ready!==(i===2))throw new Error('Application readiness bridge returned '+JSON.stringify({values,replies}));
            await new Promise(resolve=>setTimeout(resolve,110));
          }
          const start=performance.now(),result=await TartarusAnalyzer.readFrameDirect(next);handoffMs=Math.round(performance.now()-start);
          if(!result.ok||!TartarusAnalyzer.readerInfo().fromProbe)throw new Error('Analyzer lost its exact-bitmap readiness handoff');
          reused=true;
          const another=await load(urls[1]);
          const normal=await TartarusAnalyzer.readFrameDirect(another);
          if(!normal.ok||TartarusAnalyzer.readerInfo().fromProbe)throw new Error('Analyzer reused readings for a different bitmap');
          differentBitmap=true;
        }finally{old.close();next.close();Worker.prototype.postMessage=originalPost;}
        return {values,reused,differentBitmap,handoffMs};
      })()`);
      assert.deepEqual(readiness.values,[false,false,true]);
      appReadiness = readiness;
      console.log('PASS: the real analyzer readiness bridge rejects old screens, requires 3 stable changed frames and hands off only the exact accepted bitmap: '+JSON.stringify(readiness));
    }
    if (process.argv.includes('--reader-only')) {
      const reportAt = process.argv.indexOf('--reader-report');
      if (reportAt >= 0) {
        const { createHash } = require('node:crypto');
        const sources = ['js/scan.js', 'js/scan-worker.js', 'js/scan-search-worker.js', 'js/frame-readiness.js', 'js/ready-worker.js', 'js/analyze.js', 'js/scan-accelerator.js', 'tools/scan-kernels.rs'];
        const sha = (file) => createHash('sha256').update(fs.readFileSync(path.resolve(ROOT, file))).digest('hex');
        const report = { build: require('../desktop/package.json').version, measuredAt: new Date().toISOString(), cpu: require('node:os').cpus()[0].model,
          environment: await evaluate('({electron:navigator.userAgent,logicalCpus:navigator.hardwareConcurrency})'),
          baseline: previousBase, measurement: 'Alternating reader implementations, one warmup plus three timed repeats per saved frame. Full searches and calibrated reads measured in separate groups. Whole-frame results must match exactly.',
          limitations: 'Stage timings only. Identical-frame tracked timings do not measure a whole game move; exclude capture, settling, simulation and actual profit. Concurrent user activity is uncontrolled.',
          sourceSha256: Object.fromEntries(sources.map((file) => [file, sha(file)])), wasmSha256: sha('js/scan-kernels.wasm'),
          reader: pool, applicationHandoff: appReadiness };
        fs.writeFileSync(path.resolve(process.argv[reportAt + 1]), JSON.stringify(report, null, 2) + '\n');
      }
      return;
    }

    const solverBaselineAt = process.argv.indexOf('--solver-baseline');
    if (solverBaselineAt >= 0) {
      const solverBase = '/' + path.relative(ROOT, path.resolve(process.argv[solverBaselineAt + 1])).replace(/\\/g, '/') + '/';
      if (solverBase.includes('/../')) throw new Error('Solver baseline must be inside this checkout.');
      const timing = await evaluate(`(${checkBrowserSolver.toString()})(${JSON.stringify(solverBase)})`);
      console.log(`PASS: exact full Monte Carlo samples/rankings and alternating median solver timings in Electron: ${JSON.stringify(timing)}`);
    }
    // Long offline reader benchmarks can correctly expire the 30s game-log
    // watchdog. The remaining checks exercise manual advice/overlay UI,
    // so mark only the isolated test's UI active without waking capture.
    await evaluate(`TartarusDesktop.follow({...TartarusCapture.state,active:true,agreed:true});document.getElementById('az-example').click();const r=document.getElementById('az-riot');r.value='1';r.dispatchEvent(new Event('change'));TartarusAnalyzer.ask();true`);
    let snapshot;
    for (let i = 0; i < 600; i++) { snapshot = await evaluate('TartarusAnalyzer.desktopSnapshot()'); if (snapshot.move) break; await pause(50); }
    assert.ok(snapshot.move, JSON.stringify(snapshot));
    assert.equal(Number(snapshot.status.replace(/\D/g,'')),2000,'ordinary moves must retain all 2000 playouts');
    assert.equal(await evaluate('TartarusAnalyzer.desktopSnapshot().background'), true);
    assert.notEqual(await evaluate('document.getElementById("az-res-move").textContent'), snapshot.move, 'hidden backend still renders advice');
    await evaluate('TartarusAnalyzer.invalidate();true');
    const stale = await evaluate('TartarusAnalyzer.desktopSnapshot()');
    assert.equal(stale.stale, true); assert.equal(stale.move, '');
    await evaluate('TartarusAnalyzer.ask();true');
    for (let i = 0; i < 600; i++) { snapshot = await evaluate('TartarusAnalyzer.desktopSnapshot()'); if (snapshot.move) break; await pause(50); }
    const overlayTarget = targets.find((t) => t.url.endsWith('/overlay.html'));
    const overlay = await connect(overlayTarget.webSocketDebuggerUrl); sockets.push(overlay.ws);
    // Analyzer completion precedes IPC delivery/rendering in the overlay.
    let adviceBody = '';
    for (let i = 0; i < 100; i++) {
      adviceBody = await overlay.evaluate('document.body.textContent');
      if (adviceBody.includes(snapshot.move)) break;
      await pause(25);
    }
    assert.ok(adviceBody.includes(snapshot.move), 'advice never reached overlay: ' + adviceBody);
    for (const phase of ['settling', 'reading']) {
      await evaluate(`TartarusAnalyzer.invalidate();TartarusAnalyzer.setReadStatus({at:Date.now(),kind:'board',phase:${JSON.stringify(phase)}});true`);
      const message = phase === 'settling' ? 'Waiting for the game screen' : 'Reading the picture';
      let body = '';
      for (let i = 0; i < 50; i++) {
        body = await overlay.evaluate('document.body.textContent');
        if (body.includes(message)) break;
        await pause(10);
      }
      assert.ok(body.includes(message), `Missing ${phase} status`);
      assert.ok(!body.includes('The board changed since the last advice.'), `False manual recheck warning during ${phase}`);
      assert.ok(!body.includes(snapshot.move), 'Old advice remained visible during capture');
    }
    await evaluate('TartarusAnalyzer.setReadStatus(null);true');
    let manualWarning = false;
    for (let i = 0; i < 50 && !manualWarning; i++) {
      manualWarning = (await overlay.evaluate('document.body.textContent')).includes('The board changed since the last advice.');
      if (!manualWarning) await pause(10);
    }
    assert.ok(manualWarning, 'A truly stale manual board lost its recheck warning');
    await evaluate('TartarusAnalyzer.askCached();true');
    for (let i = 0; i < 50; i++) {
      const body = await overlay.evaluate('document.body.textContent');
      if (body.includes(snapshot.move) && !body.includes('The board changed since the last advice.')) break;
      if (i === 49) assert.fail('New advice did not clear the capture status');
      await pause(10);
    }
    console.log('PASS: waiting/reading status replaces the stale warning, hides old advice, and clears after a new result.');
    await overlay.evaluate('Overlay.command("board");true');
    for(let i=0;i<50 && await evaluate('TartarusAnalyzer.desktopSnapshot().background');i++)await pause(25);
    assert.equal(await evaluate('document.getElementById("az-res-move").textContent'), snapshot.move);
    if (standalone) assert.equal(await evaluate('TartarusAnalyzer.desktopSnapshot().simulationBackend'), 'rust', 'Packaged advice silently used the reference JavaScript backend');
    console.log('PASS: full rollout budget, Rust backend, direct overlay advice, stale-advice clearing and on-demand board correction.');
    const previousOptions=snapshot.options;
    await evaluate('TartarusAnalyzer.invalidate();TartarusAnalyzer.askCached();true');
    const cached=await evaluate('TartarusAnalyzer.desktopSnapshot()');
    assert.equal(cached.working,false);
    assert.equal(cached.move,snapshot.move);
    assert.deepEqual(cached.options,previousOptions);
    console.log('PASS: an unchanged automatic board reuses its completed full-budget result.');
    const changed=await evaluate('const days=document.getElementById("az-riot");days.value="2";days.dispatchEvent(new Event("change"));TartarusAnalyzer.askCached();TartarusAnalyzer.desktopSnapshot()');
    assert.equal(changed.working,true,'changed input reused a stale result');
    for(let i=0;i<600&&await evaluate('TartarusAnalyzer.desktopSnapshot().working');i++)await pause(25);
    console.log('PASS: changed board inputs invalidate the completed-result cache.');
    const history = await evaluate(`(()=>{const days=document.getElementById('az-riot');days.value='1';days.dispatchEvent(new Event('change'));const start=performance.now();TartarusAnalyzer.askCached();return {...TartarusAnalyzer.desktopSnapshot(),elapsed:performance.now()-start};})()`);
    assert.equal(history.working,false,'Returning to an earlier board recomputed Monte Carlo');
    assert.equal(history.cacheHit,true);
    assert.equal(history.move,snapshot.move);
    assert.deepEqual(history.options,previousOptions);
    assert.ok((await evaluate('TartarusAnalyzer.cacheInfo().entries'))>=2);
    console.log(`PASS: returning A → B → A reuses the exact earlier full-budget summary (${Math.round(history.elapsed)} ms).`);
    const recheck = await evaluate('TartarusAnalyzer.ask();TartarusAnalyzer.desktopSnapshot()');
    assert.equal(recheck.cacheHit,false,'Manual Recheck reused the cache');
    assert.equal(recheck.working,true);
    for(let i=0;i<600&&await evaluate('TartarusAnalyzer.desktopSnapshot().working');i++)await pause(25);
    const refreshed = await evaluate('TartarusAnalyzer.desktopSnapshot()');
    assert.equal(Number(refreshed.status.replace(/\D/g,'')),2000);
    console.log('PASS: manual Recheck bypasses the history cache and completes the original rollout budget.');
    let cacheInfo;
    for(let i=0;i<150;i++){
      cacheInfo=await evaluate('TartarusAnalyzer.cacheInfo()');
      if(cacheInfo.persistent&&cacheInfo.loaded&&!cacheInfo.pending&&!cacheInfo.writing)break;
      await pause(20);
    }
    assert.ok(cacheInfo.persistent&&cacheInfo.loaded&&!cacheInfo.pending&&!cacheInfo.writing,JSON.stringify(cacheInfo));
    await page.call('Page.reload',{ignoreCache:true});
    for(let i=0;i<200;i++){
      try{if(await evaluate('!!window.__tartarusFastRuntime && TartarusAnalyzer.cacheInfo().loaded'))break;}catch{}
      await pause(25);
    }
    const restored = await evaluate(`(()=>{const start=performance.now();TartarusAnalyzer.askCached();return {...TartarusAnalyzer.desktopSnapshot(),elapsed:performance.now()-start,cache:TartarusAnalyzer.cacheInfo()};})()`);
    assert.equal(restored.working,false,'Reload lost the persistent Monte Carlo summary');
    assert.equal(restored.cacheHit,true);
    assert.ok(restored.cache.diskEntries>=2);
    assert.equal(restored.move,refreshed.move);
    assert.deepEqual(restored.options,refreshed.options);
    console.log(`PASS: page reload restores the exact persisted result without Monte Carlo (${Math.round(restored.elapsed)} ms).`);
    const single = await evaluate(`(()=>{
      const active=[...document.querySelectorAll('#az-doors [data-door][aria-pressed="true"]')].map(b=>b.dataset.door);
      for(const door of active.slice(1))document.querySelector('#az-doors [data-door="'+door+'"]').click();
      const start=performance.now();TartarusAnalyzer.ask();
      return {...TartarusAnalyzer.desktopSnapshot(),elapsed:performance.now()-start};
    })()`);
    assert.equal(single.options.length,1,JSON.stringify(single));
    assert.equal(single.working,false,'A forced move still waits for worker replies');
    assert.equal(single.move,single.options[0].label);
    assert.equal(single.status,'Only one move here.');
    console.log(`PASS: the single legal move is final synchronously (${Math.round(single.elapsed)} ms), with no worker round trip.`);
    await overlay.evaluate('Overlay.command("follow");true');
    let settingsTarget;
    for(let i=0;i<50&&!settingsTarget;i++){
      const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      settingsTarget=list.find(t=>t.url.endsWith('/desktop/lib/settings.html'));
      if(!settingsTarget)await pause(25);
    }
    assert.ok(settingsTarget,'compact settings did not open');
    const controls=await connect(settingsTarget.webSocketDebuggerUrl);sockets.push(controls.ws);
    await controls.evaluate('document.getElementById("disable").click();true');
    for(let i=0;i<50&&await evaluate('TartarusCapture.agreed()');i++)await pause(25);
    assert.equal(await evaluate('TartarusCapture.agreed()'),false);
    assert.equal(await evaluate('TartarusCapture.state.log'),'off');
    assert.equal(await evaluate('TartarusCapture.state.window'),'off');
    console.log('PASS: compact settings stop capture and detach the native log listener.');
    assert.ok(!/runtime error:|adapter error:|console error/.test(output), output);
    for(let i=0;i<150;i++){
      const info=await evaluate('TartarusAnalyzer.cacheInfo()');
      if(info.persistent&&info.loaded&&!info.pending&&!info.writing)break;
      await pause(20);
    }
    browser.ws.send(JSON.stringify({id:999998,method:'Browser.close'}));
    for(let i=0;i<100&&launcher.exitCode===null;i++)await pause(50);
    assert.equal(launcher.exitCode,0,'The first app did not close cleanly');
    for(const socket of sockets)socket.close();sockets.length=0;browser=null;
    await pause(100);
    output='';launcher=launch();
    for(let i=0;i<200&&!output.includes('analyzer page loaded:');i++){
      if(launcher.exitCode!==null)throw new Error(output);
      await pause(50);
    }
    assert.ok(output.includes('analyzer page loaded:'),output);
    const [nextPort,nextBrowserPath]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split('\n');
    browser=await connect(`ws://127.0.0.1:${nextPort}${nextBrowserPath}`);sockets.push(browser.ws);
    const nextTargets=await(await fetch(`http://127.0.0.1:${nextPort}/json/list`)).json();
    const nextPage=await connect(nextTargets.find(t=>t.url.endsWith('/analyze.html')).webSocketDebuggerUrl);sockets.push(nextPage.ws);
    for(let i=0;i<200;i++){
      try{if(await nextPage.evaluate('!!window.__tartarusFastRuntime && TartarusAnalyzer.cacheInfo().loaded'))break;}catch{}
      await pause(25);
    }
    const relaunched=await nextPage.evaluate(`(()=>{const start=performance.now();TartarusAnalyzer.askCached();return {...TartarusAnalyzer.desktopSnapshot(),cache:TartarusAnalyzer.cacheInfo(),agreed:TartarusCapture.agreed(),elapsed:performance.now()-start};})()`);
    assert.equal(relaunched.agreed,false,'Restoring the cache re-enabled capture');
    assert.equal(relaunched.cacheHit,true,'A real app restart lost the cache');
    assert.ok(relaunched.cache.diskEntries>=2);
    assert.equal(relaunched.move,single.move);
    assert.deepEqual(relaunched.options,single.options);
    console.log(`PASS: a full Electron app restart restores cached advice (${Math.round(relaunched.elapsed)} ms) and keeps capture disabled.`);
    const offer = async (ids, id) => nextPage.evaluate(`(async()=>{
      const old=TartarusAnalyzer.readPick;
      TartarusAnalyzer.readPick=async()=>({ok:true,cards:${JSON.stringify(ids)}.map(sim=>({sim,name:Tartarus.toolName(sim),conf:1})),names:${JSON.stringify(ids)}.map(sim=>Tartarus.toolName(sim)),reroll:false});
      const canvas=new OffscreenCanvas(2,2);canvas.getContext('2d').fillRect(0,0,2,2);
      try{await TartarusAuto.receive({id:${id},kind:'instruments',fresh:false,bitmap:await createImageBitmap(canvas)},()=>{});return TartarusAnalyzer.desktopSnapshot();}
      finally{TartarusAnalyzer.readPick=old;}
    })()`);
    const waitAdvice = async () => {
      for(let i=0;i<600;i++){
        const snapshot=await nextPage.evaluate('TartarusAnalyzer.desktopSnapshot()');
        if(!snapshot.working)return snapshot;
        await pause(25);
      }
      throw new Error('Instrument/gift Monte Carlo did not finish');
    };
    await offer(['crown','maiden','keys'],1001);
    const offerA=await waitAdvice();assert.ok(offerA.move);
    assert.equal(Number(offerA.status.replace(/\D/g,'')),8000,'Instrument choice lost its 8000 per-option playouts');
    await offer(['crown','maiden','revenge'],1002);await waitAdvice();
    const offerCached=await offer(['crown','maiden','keys'],1003);
    assert.equal(offerCached.cacheHit,true,'Native instrument offers bypassed the history cache');
    assert.equal(offerCached.working,false);
    assert.deepEqual(offerCached.options,offerA.options);
    await nextPage.evaluate('TartarusAuto.receive({id:1004,kind:"treasure",after:"view"},()=>{})');
    const gift=await waitAdvice();assert.ok(gift.move);
    assert.equal(Number(gift.status.replace(/\D/g,'')),8000,'Gift choice lost its 8000 per-option playouts');
    const giftCached=await nextPage.evaluate('TartarusAnalyzer.invalidate();TartarusAuto.receive({id:1005,kind:"treasure"},()=>{}).then(()=>TartarusAnalyzer.desktopSnapshot())');
    assert.equal(giftCached.cacheHit,true,'Native treasure advice bypassed the history cache');
    assert.equal(giftCached.working,false);
    assert.equal(giftCached.stale,false,'Returning from the board left treasure advice stale');
    assert.deepEqual(giftCached.options,gift.options);
    console.log('PASS: native instrument and treasure paths reuse exact full-budget cached summaries.');
    if (process.argv.includes('--forecast')) {
      await nextPage.call('Page.reload', { ignoreCache: true });
      for (let i = 0; i < 200; i++) {
        try { if (await nextPage.evaluate('!!window.__tartarusFastRuntime')) break; } catch {}
        await pause(25);
      }
      const checkForecast = require('./forecast-overlay-check.js');
      const result = await nextPage.evaluate(`(${checkForecast.toString()})()`);
      console.log(`PASS: confirmed next-state forecast, partial promotion with all samples, mismatch fallback, manual bypass and disabled-capture cleanup: ${JSON.stringify(result)}`);
    }
    assert.ok(!/runtime error:|adapter error:|console error/.test(output),output);
  } finally {
    if (fakeActivity) clearInterval(fakeActivity);
    if (browser && browser.ws.readyState === WebSocket.OPEN) browser.ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
    for (const ws of sockets) ws.close();
    for (let i = 0; launcher.exitCode === null && i < 50; i++) await pause(100);
    if (launcher.exitCode === null) launcher.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
