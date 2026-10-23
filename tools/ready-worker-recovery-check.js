#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const timers = new Map(); let next = 0, created = 0, worker;
class Worker {
  constructor() { created++; worker = this; this.messages = []; }
  postMessage(m) { this.messages.push(m); }
  terminate() { this.terminated = true; }
}
const window = { Tartarus: require('../js/engine.js'), TartarusSolver: require('../js/solver.js'), TartarusDesktop: { fast: true } };
const source = fs.readFileSync(require.resolve('../js/analyze.js'), 'utf8').replace(/\r\n/g, '\n');
const init = '  buildBoard();\n  bind();\n  render();'; assert.ok(source.includes(init));
vm.runInNewContext(source.replace(init, '  window.testReady = { calibrateReadyWorker, prepareReadyWorker, probeFrame, calibration: () => readyCalibration };'), {
  window, document: { currentScript: null }, navigator: { hardwareConcurrency: 4 }, localStorage: { getItem: () => null },
  Worker, setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id),
  createImageBitmap: async b => ({ width: b.width, height: b.height, close() {} }),
});
(async () => {
  const A = window.testReady, calibration = { width: 100, height: 100, controls: 'patrol' };
  A.calibrateReadyWorker(calibration);
  A.calibrateReadyWorker(null, { ok: true, chain: { targets: [1,2] } });
  assert.equal(A.calibration(), calibration, 'meal-pick screen discarded the last valid ordinary-board reference');
  A.calibrateReadyWorker({ width: 200, height: 100, controls: '' }, { ok: true, chain: { targets: [1,2] } });
  assert.equal(A.calibration().width, 200, 'known size change retained an incompatible reference');
  A.calibrateReadyWorker(calibration);
  const stalled = A.probeFrame({ width: 100, height: 100 }, { epoch: 1 });
  await new Promise(setImmediate); assert.equal(timers.size, 1);
  for (const fn of [...timers.values()]) fn();
  assert.equal(await stalled, false); assert.equal(worker.terminated, true);
  assert.equal(A.prepareReadyWorker(), null, 'one failure must not start an unbounded retry loop');
  A.calibrateReadyWorker(null); assert.equal(A.prepareReadyWorker(), null);
  A.calibrateReadyWorker(calibration);
  const recovered = A.probeFrame({ width: 100, height: 100 }, { epoch: 2 });
  await new Promise(setImmediate); assert.equal(created, 2);
  assert.equal(worker.messages[0].calibrate, calibration, 'recovered worker needs the fresh calibration');
  const id = worker.messages[1].id; worker.onmessage({ data: { id, ready: true } });
  assert.equal(await recovered, true); assert.equal(timers.size, 0);
  console.log('PASS: a stalled probe releases its worker/pending frame, uses bounded fallback and recovers only after a fresh successful board calibration.');
})().catch(error => { console.error(error); process.exitCode = 1; });
