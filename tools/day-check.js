/* Game-log day authority, countdown conversion and frame-bound context. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const T = require('../js/engine.js'), S = require('../js/solver.js');
const window = { Tartarus: T, TartarusSolver: S };
let source = fs.readFileSync(require.resolve('../js/analyze.js'), 'utf8').replace(/\r\n/g, '\n');
const init = '  buildBoard();\n  bind();\n  render();';
assert.ok(source.includes(init));
source = source.replace(init, '  window.checkDays = { blankModel, scanToModel, buildState, confirmTools };');
vm.runInNewContext(source, { window, document: { currentScript: null }, navigator: { hardwareConcurrency: 4 }, localStorage: { getItem: () => null } });
const A = window.checkDays;
function board(left) {
  return { days: left === null ? null : { days: left, conf: 1 },
    cells: Array.from({ length: 16 }, (_, n) => ({ n, kind: 'locked', conf: 1 })), warden: { cell: 0, conf: 1 },
    tools: { tools: [] }, vault: { beasts: [] }, doors: { cells: [] } };
}
let cases = 0;
for (const maxDays of [20, 30]) for (let day = 1; day <= maxDays; day++) {
  const base = A.blankModel(); base.maxDays = maxDays; base.day = day; base.boardSeen = true;
  base.tools = ['coin', 'blacklist']; A.confirmTools(base);
  const normal = A.scanToModel(board(maxDays - day), base).model;
  assert.equal(normal.day, day); assert.equal(normal.maxDays, maxDays); assert.equal(normal.dayProbe, null);
  for (const left of [0, 2, 10, 19, 29, 38, null]) {
    // Including a model left behind in a different run length, and repeated
    // identical bad OCR: a second wrong picture never outvotes a live log.
    let next = { ...base, day: 18, maxDays: maxDays === 20 ? 30 : 20, dayProbe: { day: 18, maxDays: 20 } };
    for (let repeat = 0; repeat < 2; repeat++) next = A.scanToModel(board(left), next, { day, maxDays }).model;
    assert.equal(next.day, day); assert.equal(next.maxDays, maxDays); assert.equal(next.dayProbe, null);
    assert.equal(next.tools.join(), 'coin,blacklist'); assert.equal(next.toolsConfirmed.tools, 'blacklist,coin');
    const state = A.buildState(next).st;
    assert.equal(state.day, day); assert.equal(state.maxDays, maxDays); cases++;
  }
}
const invalid = A.scanToModel(board(14), A.blankModel(), { day: 31, maxDays: 30 }).model;
assert.equal(invalid.day, 6); assert.equal(invalid.maxDays, 20);
const initialIronLaw = A.scanToModel(board(29), A.blankModel()).model;
assert.equal(initialIronLaw.day, 1); assert.equal(initialIronLaw.maxDays, 30);
for (const left of [null, -1, 30, 38, 1.5]) {
  const bad = A.scanToModel(board(left), A.blankModel()).model;
  assert.ok(bad.dayProbe && A.buildState(bad).problems.some(p => p.includes('Riot')), 'Unread/invalid countdown silently used day one');
  assert.equal(bad.day, 1); assert.equal(bad.maxDays, 20);
}
console.log(`PASS: all 50 days of 20/30-day runs, ${cases} missing/wrong/repeated countdown cases; game-log day and maxDays reach the solver, confirmation survives, countdown has no off-by-one.`);

async function checkRuntime() {
  const events = {}, frames = [], starts = [];
  let now = Date.UTC(2026, 9, 23, 13, 47, 0), onGame, configure;
  const C = { DEFAULT_RULES: '', CONSENT_VERSION: 4, state: { log: 'off', window: 'off' },
    setRules() {}, setWatch() {}, setPace() {}, on(kind, fn) { events[kind] = fn; }, agreed: () => true,
    useHandle() { this.state.log = 'on'; }, stopLog() {}, stopWindow() { this.state.window = 'off'; },
    async connectWindow() { this.state.window = 'on'; } };
  const analyzer = { invalidate() {}, setReadStatus() {}, prepare() {}, setForecastEnabled() {}, suspend() {}, beginRun: t => starts.push(t) };
  const D = { fast: true, follow() {}, trigger() {}, riot() {}, run() {}, onCommand() {},
    onGame(fn) { onGame = fn; }, onFastSettings(fn) { configure = fn; },
    fastSettings: async () => ({ consent: { version: 4 }, activeMode: 'tartarus' }),
    game: async () => ({ running: true, window: 1, log: { path: 'fake.log' } }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/lib/fast-runtime.js'), 'utf8'), {
    window: { TartarusDesktop: D, TartarusCapture: C, TartarusAnalyzer: analyzer,
      TartarusAuto: { cancel() {}, async receive(m) { frames.push(m); } }, addEventListener() {} },
    localStorage: { getItem: () => '{}', setItem() {} }, Date: { now: () => now, UTC: Date.UTC }, performance, setInterval() {}, console,
  });
  await new Promise(resolve => setImmediate(resolve));
  function seen(line, at = now) {
    const stamp = new Date(at).toISOString().replace(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)\.(\d+)Z$/, '$1.$2.$3-$4.$5.$6:$7');
    events.seen({ line, at: stamp });
  }
  function clock(day, max = 20, at) { seen(`[S16LastDay] check cur=${day} max=${max} played=false`, at); }
  async function frame(kind = 'board') {
    events.hit({ kind });
    await events.frame({ kind, frame: { close() {} }, hits: [] });
    return frames.at(-1).dayClock;
  }
  clock(10); const ten = await frame(); assert.equal(ten.day, 10);
  now += 1000; clock(11); assert.equal((await frame('manual')).day, 11); assert.equal(ten.day, 10, 'Later logs mutated an older frame');
  clock(18, 20, now - 500); assert.equal((await frame()).day, 11, 'Out-of-order log changed the day');
  clock(18, 20, now + 3000); assert.equal((await frame()).day, 11, 'Future timestamp changed the day');
  clock(18, 20, now - 20000); assert.equal((await frame()).day, 11, 'Historical replay changed the day');
  clock(999); clock(10, 99); assert.equal((await frame()).day, 11);
  now += 1000; clock(0); assert.equal(await frame(), null, 'Instrument selection day zero became a playable day');
  now += 1000; clock(1, 30); assert.equal((await frame()).maxDays, 30);
  seen('S16BoardNewDayPop Run'); assert.equal(await frame(), null, 'A new-day animation kept the previous day');
  now += 1000; clock(30, 30); assert.equal((await frame()).day, 30);
  seen('Btn_S16GamePlay_Start'); assert.equal(starts.length, 1); assert.equal(await frame(), null);
  clock(1); seen('LogLoad: LoadMap: /Fake'); assert.equal(await frame(), null);
  clock(2); onGame({ running: false });
  onGame({ running: true, window: 1, log: { path: 'fake.log' } });
  assert.equal(await frame(), null, 'A restarted game kept the previous process day');
  clock(3); now += 120001; assert.equal(await frame(), null, 'An expired log overrode a manual screenshot');
  clock(4); configure({ activeMode: 'vorax', consent: { version: 4 } });
  configure({ activeMode: 'tartarus', consent: { version: 4 } }); assert.equal(await frame(), null);
  clock(5); onGame({ running: true, window: 1, log: { path: 'rotated.log' } }); assert.equal(await frame(), null);
  console.log('PASS: captured-frame context, manual reads, day-zero/new-run/banner/map/game/mode/log changes, expiry, future/historical/out-of-order/invalid log records.');
}
checkRuntime().catch(error => { console.error(error); process.exitCode = 1; });
