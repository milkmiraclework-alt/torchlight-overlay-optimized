#!/usr/bin/env node
/* Preserve real partial Monte Carlo state across duplicate reads and UI
 * confirmations; apply asynchronous objective reads before starting advice. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const T = require('../js/engine.js'), S = require('../js/solver.js'), K = require('../js/solver-cache.js');
const taskWindow = { Tartarus: T, TartarusSolver: S, TartarusSolverCache: { ...K, create(options) {
  assert.equal(options.version, 'mc-v2:rules=308b947:?v=20261023rust31:budget=9600', 'Wrong cache revision for the imported rules/strategy');
  return K.create(options);
} }, TartarusDesktop: { fast: true } };
const writes = new Map(), messages = [];
let source = fs.readFileSync(require.resolve('../js/analyze.js'), 'utf8').replace(/\r\n/g, '\n');
const init = '  buildBoard();\n  bind();\n  render();';
assert.ok(source.includes(init));
source = source.replace(init, '  window.checkCalculation = { blankModel, ask, solver, reader, useScan, invalidate, confirmTools, cornerObjective, setModel: (m) => { model = m; }, getModel: () => model };');
vm.runInNewContext(source, {
  window: taskWindow, document: { currentScript: { src: 'http://localhost/js/analyze.js?v=ui-only-check' }, getElementById: () => ({ classList: { toggle() {}, add() {}, remove() {} }, replaceChildren() {} }), createElement: () => ({ getContext: () => ({ drawImage() {} }) }) }, navigator: { hardwareConcurrency: 2 },
  localStorage: { getItem: (key) => writes.get(key) || null, setItem: (key, value) => writes.set(key, value) },
  setTimeout, clearTimeout, queueMicrotask, console,
  Worker: class { postMessage(m) { messages.push(m); } terminate() {} }
});
const A = taskWindow.checkCalculation, m = A.blankModel();
m.day = 19; m.dest = [1, 2, 3]; m.tools = ['crown'];
A.setModel(m); assert.ok(A.ask(true, false, true));
const first = messages.find(x => x.state), id = A.solver.id, shares = A.solver.shares;
const job = S.solve(first.state, { rollouts: first.rollouts, stream: 0, seed: (id * 7919 + 1) >>> 0 });
let clockCalls = 0, partial;
const savedNow = Date.now;
try { Date.now = () => clockCalls++ <= 8 ? 0 : 2; partial = job.step(1, true); }
finally { Date.now = savedNow; }
assert.ok(!partial.done && partial.rounds > 0, 'Fixture must contain partial rounds');
shares[0].rounds = partial.rounds;
shares[0].rows = job.rows;
A.solver.result = { ...S.summarize(job.rows, partial.rounds, first.rollouts, partial.goal), done: false };
const before = JSON.stringify(job.rows);
A.invalidate({ preserve: true, forecast: 'keep' });
A.invalidate({ preserve: true, forecast: 'pause' });
assert.equal(A.solver.id, id);
assert.ok(messages.some(x => x.pause));
// A duplicate read changes UI panel metadata but none of the simulation inputs.
A.reader.result = { ok: true, tools: { tools: [{ sim: 'skewer', conf: 1 }] } };
A.reader.reading = { model: JSON.parse(JSON.stringify(m)), tools: [], notes: [], checks: new Set() };
A.useScan(); assert.ok(A.solver.st, 'Duplicate picture discarded the active state');
assert.ok(A.ask(true, false, true));
assert.equal(A.solver.id, id); assert.equal(A.solver.shares, shares);
assert.equal(messages.filter(x => x.state).length, 1, 'Duplicate read started a new Monte Carlo job');
assert.equal(JSON.stringify(job.rows), before, 'Duplicate read changed existing samples');
assert.ok(messages.some(x => x.id === id && x.promote));
// A confirmation racing a prepared reading must survive applying that reading.
A.confirmTools(A.getModel());
A.reader.reading = { model: JSON.parse(JSON.stringify(m)), tools: [], notes: [], checks: new Set() };
A.useScan(); assert.equal(A.getModel().toolsConfirmed.tools, 'crown');
assert.equal(A.getModel().toolsToConfirm, '');
A.ask(true, false, true);
assert.equal(messages.filter(x => x.state).length, 1, 'Confirmation restarted unchanged Monte Carlo');
A.getModel().dest = [1, 3]; A.ask(true, false, true);
assert.equal(messages.filter(x => x.state).length, 2, 'Actual changed options did not replace the job');
A.ask(true); assert.equal(messages.filter(x => x.state).length, 3, 'Manual Recheck reused a partial job');
console.log('PASS: duplicate frames and racing instrument confirmations retain job ID, shares and every existing sample; real changes and manual Recheck start fresh.');

async function checkObjectiveOrder(cancelled) {
  let finish, asks = 0, applied = false, closed = 0, readReported = false;
  const api = {
    readFrameDirect: async () => ({ ok: true, controls: true }), useReading() { applied = true; },
    completeReading: () => new Promise(resolve => { finish = resolve; }),
    askCached() { assert.ok(applied); asks++; return true; }
  };
  const context = { TartarusCapture: { agreed: () => true }, TartarusAnalyzer: api, TartarusDesktop: { fast: true }, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/auto.js'), 'utf8'), {
    window: context, BroadcastChannel: class { postMessage() {} }, document: { hasFocus: () => false, getElementById: () => null }, setInterval() {}, Date, console
  });
  const pending = context.TartarusAuto.receive({ kind: 'board', bitmap: { close() { closed++; } } }, patch => { if (patch.read) readReported = true; });
  for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
  assert.ok(applied); assert.equal(asks, 0); assert.equal(readReported, false);
  if (cancelled === 'auto') context.TartarusAuto.cancel();
  finish(cancelled !== 'reader'); await pending;
  assert.equal(asks, cancelled ? 0 : 1); assert.equal(closed, 1);
}
async function checkCorner() {
  let finish;
  taskWindow.Tesseract = { createWorker: async () => ({ recognize: () => new Promise(resolve => { finish = resolve; }) }) };
  const current = A.getModel(); current.objective = 'doors'; current.walkTiles = 0; current.milestone = false;
  A.ask(true, false, true);
  const count = messages.filter(x => x.state).length;
  const pending = A.cornerObjective({}, [0, 0, 120, 40], current.day, true);
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  assert.ok(finish, 'Corner reader did not reach OCR');
  const need = T.OBJECTIVES.doors.need;
  finish({ data: { text: `Objective: ${T.OBJECTIVES.doors.name}\n6/${need}` } });
  await pending;
  assert.equal(A.getModel().walkTiles, 6);
  assert.equal(messages.filter(x => x.state).length, count, 'Deferred corner callback independently restarted advice');
  A.ask(true, false, true);
  assert.equal(messages.filter(x => x.state).length, count + 1, 'Final objective inputs did not reach the solver');
}
checkObjectiveOrder(false).then(() => checkObjectiveOrder('auto')).then(() => checkObjectiveOrder('reader')).then(checkCorner).then(() => {
  console.log('PASS: objective/count reading finishes before the single advice request; cancellation cannot revive calculation and releases its bitmap.');
}).catch(error => { console.error(error); process.exitCode = 1; });
