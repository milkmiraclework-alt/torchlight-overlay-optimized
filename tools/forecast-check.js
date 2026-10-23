#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { setTimeout: pause } = require('node:timers/promises');
const T = require('../js/engine.js'), S = require('../js/solver.js'), F = require('../js/solver-forecast.js');
const st = T.newGame({ seed: 'FORECAST', params: { rewards: false, eventStartChance: 0, eventWalkChance: 0, eventMorningChance: 0, eventActionChance: 0 } });
st.pending = []; st.position = 1; st.phase = 'patrol'; st.destinations = [2];
T.editCell(st, 2, { kind: 'open', beast: 'wolf', tier: 1 });
st.cells[2].event = null;
const saved = JSON.stringify(st), options = { samples: 48, limit: 4, seed: 71 };
const certain = F.predict(st, { type: 'patrol', cell: 2 }, options);
assert.equal(certain.length, 1); assert.equal(certain[0].count, 48);
assert.equal(certain[0].state.position, 2);
assert.equal(certain[0].state.phase, 'manage');
assert.equal(JSON.stringify(st), saved);
assert.deepEqual(F.predict(st, { type: 'patrol', cell: 2 }, options), certain);
const unknown = S.clone(st); unknown.destinations = [3];
const branches = F.predict(unknown, { type: 'patrol', cell: 3 }, options);
assert.ok(branches.length > 1 && branches.length <= 4);
assert.ok(branches.every((b, i) => !i || b.count <= branches[i - 1].count));
assert.equal(new Set(branches.map((b) => F.visibleKey(b.state))).size, branches.length);
assert.deepEqual(F.predict(st, { type: 'patrol', cell: 15 }, options), []);
assert.equal(F.visibleKey(st), F.visibleKey({ ...st, rng: 471, log: [{ ignored: true }] }));
assert.notEqual(F.visibleKey(st), F.visibleKey({ ...st, position: 3 }));
console.log('PASS: deterministic and random next-state branches, frequency ordering, limits, source isolation and invalid moves.');

async function checkRuntime() {
  const events = {}, invalidations = [], transitions = [], pictures = [];
  let configure, command, onGame, tick, now = 1000, connects = 0, suspended = 0, prepared = 0, reads = 0;
  const C = { DEFAULT_RULES: '', CONSENT_VERSION: 4, state: { log: 'off', window: 'off' }, setRules() {}, setWatch() {}, setPace() {},
    on: (kind, fn) => { events[kind] = fn; }, agreed: () => true, stopLog() {}, stopWindow() { this.state.window = 'off'; }, setReadinessProbe() {},
    useHandle() { this.state.log = 'on'; }, async connectWindow() { connects++; this.state.window = 'on'; }, captureNow: () => { reads++; } };
  const A = { invalidate: (options) => invalidations.push(options), setReadStatus() {}, prepare() { prepared++; }, prepareOCR() {}, onDesktopChange() {},
    suspend() { suspended++; invalidations.push(undefined); }, setForecastEnabled: (enabled) => transitions.push(enabled) };
  const D = { fast: true, follow() {}, trigger() {}, record() {},
    fastSettings: async () => ({ consent: { version: 4 } }), game: async () => ({ running: true, window: 11, log: { path: 'test.log' } }),
    onCommand: (fn) => { command = fn; }, onGame: (fn) => { onGame = fn; }, riot() {}, run() {},
    onFastSettings: (fn) => { configure = fn; } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../desktop/lib/fast-runtime.js'), 'utf8'), {
    window: { TartarusDesktop: D, TartarusCapture: C, TartarusAnalyzer: A, TartarusAuto: { cancel() {}, receive: async (m) => { pictures.push(m); } }, addEventListener() {} },
    localStorage: { getItem: () => '{}', setItem() {} }, performance, setInterval(fn) { tick = fn; }, Date: { now: () => now, UTC: Date.UTC }, console,
  });
  await pause(0);
  tick(); await pause(0);
  assert.equal(connects, 0); assert.equal(prepared, 0);
  assert.equal(C.state.log, 'on', 'Entry detection must keep following the log while asleep');
  events.seen({ line: 'S16GamePlayEntry Run' });
  assert.equal(connects, 0, 'The entry menu started game-window capture');
  events.seen({ line: 'S16BoardMain Run' }); await pause(0);
  assert.equal(connects, 1); assert.equal(prepared, 1); assert.equal(transitions.at(-1), true);
  onGame({ running: true, window: 22, log: { path: 'test.log' } }); await pause(0);
  assert.equal(connects, 2, 'Changing the game HWND did not reconnect the active capture');
  onGame({ running: true, window: 22, log: { path: 'test.log' } }); await pause(0);
  assert.equal(connects, 2, 'An unchanged HWND reconnected capture');
  function seen(line, ms) { events.seen({ line, at: `2026.10.18-13.00.${String(Math.floor(ms / 1000)).padStart(2, '0')}:${String(ms % 1000).padStart(3, '0')}` }); }
  const countGifts = async () => {
    await events.frame({ kind: 'board', frame: { close() {} }, hits: [] });
    return pictures.at(-1).gifts;
  };
  seen('UI_S16_Premium_Quality_Fly', 10); seen('UI_S16_Premium_Quality_Fly', 20); seen('Anim_Archive_LightUp, Id = A', 30);
  assert.equal((await countGifts()).rainbows, 1, 'One Rainbow was counted twice');
  seen('Anim_Archive_LightUp, Id = B', 40); seen('UI_S16_Premium_Quality_Fly', 50); seen('UI_S16_Premium_Quality_Fly', 60); seen('Anim_Archive_LightUp, Id = B', 70);
  assert.equal((await countGifts()).rainbows, 2, 'Two Rainbows or a duplicate light were counted incorrectly');
  seen('S16BoardColoredPop Run', 80); seen('ColoredPop_Confirm', 90); seen('ColoredPop_Confirm', 100);
  assert.equal((await countGifts()).taken, 1, 'A double Confirm consumed two gifts');
  seen('UI_S16_Premium_Quality_Fly', 4000); seen('UI_S16_Premium_Quality_Fly', 4010);
  assert.equal((await countGifts()).rainbows, 3, 'A sound-only Rainbow was lost');
  seen('Btn_S16GamePlay_Start', 5000);
  const freshGifts = await countGifts(); assert.equal(freshGifts.rainbows, 0); assert.equal(freshGifts.taken, 0);
  console.log('PASS: active HWND changes reconnect once; Rainbow sound/light bursts, sound-only fallback, double Confirm and new-run reset count exactly.');
  for (const kind of ['board', 'skip']) {
    events.hit({ kind });
    assert.equal(invalidations.at(-1).forecast, 'keep', 'An animation/new-day banner discarded a useful prediction');
  }
  events.hit({ kind: 'instruments' });
  assert.equal(invalidations.at(-1).forecast, 'stop');
  await events.frame({ kind: 'board', frame: { close() {} }, hits: [] });
  assert.equal(invalidations.at(-1).forecast, 'pause', 'Frame recognition did not take priority over background work');
  for (const line of ['S16GamePlayCheckOut Run', 'S16BoardMain Destory', 'S16BoardMain Hide', 'S16GamePlayEntry Run', 'LogLoad: LoadMap: /Game/Art/Maps/Outside']) {
    events.seen({ line });
    assert.equal(C.state.window, 'off');
    const was = connects; tick(); tick(); await pause(0);
    assert.equal(connects, was, 'Polling reconnected outside the board');
    let closed = false;
    await events.frame({ kind: 'board', frame: { close() { closed = true; } } });
    assert.ok(closed, 'A stale frame survived leaving the board');
    events.hit({ kind: 'board' }); await pause(0);
    assert.equal(C.state.window, 'on', 'A real move did not wake capture');
  }
  assert.ok(suspended >= 5);
  now += 30000; tick();
  assert.equal(C.state.window, 'off', 'Missing exit events left capture running indefinitely');
  command('capture'); await pause(0);
  assert.equal(reads, 1, 'Manual capture did not wait for reconnection');
  onGame({ running: false }); await pause(0);
  const closedConnects = connects; command('capture'); tick(); await pause(0);
  assert.equal(connects, closedConnects); assert.equal(C.state.window, 'off');
  onGame({ running: true }); tick(); await pause(0);
  assert.equal(connects, closedConnects, 'Restarting the game started capture outside the mode');
  configure({ consent: { withdrawn: true } });
  assert.equal(invalidations.at(-1), undefined, 'Disabling capture did not request full cancellation');
  console.log('PASS: idle/menu/combat/map/game-close suspend capture and work, polling stays asleep, real moves/manual capture wake it, stale frames close; board forecasts retain/pause correctly.');
}

async function checkAutoCancellation() {
  let release, boards = 0, treasures = 0, closes = 0;
  const A = {
    readPick: () => new Promise((resolve) => { release = resolve; }),
    readFrameDirect: () => { boards++; return new Promise((resolve) => { release = resolve; }); },
    readTreasure: () => { treasures++; return { ok: false }; },
  };
  const window = { TartarusCapture: { agreed: () => true }, TartarusAnalyzer: A, TartarusDesktop: { fast: true }, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../js/auto.js'), 'utf8'), {
    window, BroadcastChannel: class { postMessage() {} }, document: { hasFocus: () => false, getElementById: () => null }, Date, console, setInterval() {},
  });
  const bitmap = () => ({ close() { closes++; } });
  const manual = window.TartarusAuto.receive({ kind: 'manual', bitmap: bitmap() }, () => {});
  window.TartarusAuto.cancel(); release({ ok: false }); await manual;
  assert.equal(boards, 0, 'An obsolete manual frame started another reader after cancellation');
  const board = window.TartarusAuto.receive({ kind: 'board', bitmap: bitmap() }, () => {});
  window.TartarusAuto.cancel(); release({ ok: false }); await board;
  assert.equal(treasures, 0, 'A cancelled board read restarted OCR outside the mode');
  assert.equal(closes, 2);
  console.log('PASS: cancelled asynchronous reads cannot restart board recognition/OCR; both bitmaps are released.');
}

async function checkWorker() {
  const worker = new Worker(`
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
    const { parentPort, workerData } = require('node:worker_threads');
    global.self = globalThis; self.location = { search: '' };
    self.postMessage = (m) => parentPort.postMessage(m);
    self.importScripts = (...files) => { for (const file of files) vm.runInThisContext(fs.readFileSync(path.join(workerData, file.split('?')[0]), 'utf8')); };
    importScripts('solver-worker.js'); parentPort.on('message', (data) => self.onmessage({ data }));
  `, { eval: true, workerData: path.resolve(__dirname, '../js') });
  const messages = [], waiters = new Set();
  worker.on('message', (m) => { messages.push(m); for (const notify of [...waiters]) notify(); });
  async function until(predicate) {
    if (predicate()) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(notify); reject(new Error('Forecast worker timed out')); }, 30000);
      const notify = () => { if (predicate()) { clearTimeout(timer); waiters.delete(notify); resolve(); } };
      waiters.add(notify);
    });
  }
  const state = T.newGame({ seed: 'FORECAST-WORKER', params: { rewards: false } });
  state.maxDays = 2;
  try {
    worker.postMessage({ id: 'ahead', state, rollouts: 700, seed: 101, stream: 2, raw: true, background: true });
    await until(() => messages.some((m) => m.id === 'ahead' && m.rounds > 0 && !m.done));
    worker.postMessage({ id: 'ahead', pause: true });
    worker.postMessage({ id: 'barrier', predict: true, state, action: { type: 'invalid' }, options: { samples: 1 } });
    await until(() => messages.some((m) => m.id === 'barrier'));
    const count = messages.length;
    await pause(90);
    assert.equal(messages.length, count, 'Paused calculation continued using CPU');
    worker.postMessage({ from: 'ahead', id: 91, promote: true });
    await until(() => messages.some((m) => m.id === 91 && m.done));
    const samples = messages.filter((m) => m.rows);
    assert.ok(samples.some((m) => m.id === 'ahead') && samples.some((m) => m.id === 91));
    const rows = samples[0].meta.map((m) => ({ ...m, vals: [] }));
    let sent = 0;
    for (const m of samples) {
      for (let i = 0; i < rows.length; i++) {
        assert.equal(m.rows[i].vals.length, m.rounds - sent, 'Lost or duplicated samples during promotion');
        Object.assign(rows[i], { ...m.rows[i], vals: rows[i].vals.concat(m.rows[i].vals) });
      }
      sent = m.rounds;
    }
    assert.equal(sent, 700);
    const job = S.solve(state, { rollouts: 700, seed: 101, stream: 2 });
    let result; do { result = job.step(50); } while (!result.done);
    assert.deepEqual(S.summarize(rows, sent, 700, result.goal), result);
    assert.deepEqual(rows, job.rows);
    const menuState = S.clone(state);
    menuState.pending = [];
    menuState.destinations = [1, 2, 3, 4, 5, 6];
    const indices = [0, 2, 4], menuStart = messages.length;
    worker.postMessage({ id: 'menu-ahead', state: menuState, rollouts: 700, seed: 303, stream: 3, raw: true, background: true });
    await until(() => messages.some((m) => m.id === 'menu-ahead' && m.rounds > 0 && !m.done));
    worker.postMessage({ id: 'menu-ahead', pause: true });
    worker.postMessage({ from: 'menu-ahead', id: 93, promote: true, indices });
    await until(() => messages.some((m) => m.id === 93 && m.done));
    const menuSamples = messages.slice(menuStart).filter((m) => m.rows);
    const menuRows = indices.map((i) => ({ ...menuSamples[0].meta[i], vals: [] }));
    let menuSent = 0;
    for (const m of menuSamples) {
      const incoming = m.id === 'menu-ahead' ? indices.map((i) => m.rows[i]) : m.rows;
      assert.equal(incoming.length, 3);
      incoming.forEach((r, i) => {
        assert.equal(r.vals.length, m.rounds - menuSent);
        Object.assign(menuRows[i], { ...r, vals: menuRows[i].vals.concat(r.vals) });
      });
      menuSent = m.rounds;
    }
    const subset = S.clone(menuState); subset.destinations = indices.map((i) => menuState.destinations[i]);
    const exact = S.solve(subset, { rollouts: 700, seed: 303, stream: 3 });
    let menuResult; do { menuResult = exact.step(50); } while (!menuResult.done);
    assert.deepEqual(F.patrolResult(S, subset, menuRows, 700, 303), menuResult);
    for (let i = 0; i < menuRows.length; i++) {
      assert.deepEqual(menuRows[i].vals, exact.rows[i].vals);
      for (const key of ['pass', 'points', 'best']) assert.equal(menuRows[i][key], exact.rows[i][key]);
    }
    console.log('PASS: unfinished six-direction calculation prunes to three real doors and retains every exact sample/counter/ranking.');
    worker.postMessage({ id: 'cancel-me', state, rollouts: 100000, raw: true, background: true });
    await until(() => messages.some((m) => m.id === 'cancel-me'));
    worker.postMessage({ id: 'cancel-me', pause: true });
    worker.postMessage({ id: 'cancelled', cancel: true });
    worker.postMessage({ id: 92, state, rollouts: 4 });
    await until(() => messages.some((m) => m.id === 92 && m.result.done));
    const end = messages.length; await pause(90);
    assert.equal(messages.length, end, 'A cancelled background task resumed');
    console.log('PASS: real worker pause, promotion with all 700 exact samples/counters/rankings retained, cancellation and replacement.');
  } finally { await worker.terminate(); }
}
checkRuntime().then(checkAutoCancellation).then(checkWorker).catch((error) => { console.error(error); process.exitCode = 1; });
