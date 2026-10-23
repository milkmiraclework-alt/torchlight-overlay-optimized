#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/analyze.js'), 'utf8').replace(/\r\n/g, '\n');
const init = '  buildBoard();\n  bind();\n  render();', stop = source.match(/      suspend: (\(\) => \{[\s\S]*?\n      \}),\n      desktopSnapshot,/);
assert.ok(source.includes(init) && stop);
const window = { Tartarus: require('../js/engine.js'), TartarusSolver: require('../js/solver.js'), TartarusDesktop: { fast: true }, TartarusAnalyzer: { invalidate() {} } };
const workers = [];
class Worker {
  constructor(url) { this.url = url; this.messages = []; workers.push(this); }
  postMessage(m) { this.messages.push(m); }
  terminate() { this.terminated = true; }
}
vm.runInNewContext(source.replace(init, `  window.lifecycle = { readerWorker, prepareSolverWorkers, prepareReadyWorker, reader, solver, suspend: ${stop[1]} };`), {
  window, document: { currentScript: null }, navigator: { hardwareConcurrency: 4 }, localStorage: { getItem: () => null },
  Worker, clearTimeout() {}, setTimeout() {},
});
const A = window.lifecycle, error = () => ({ preventDefault() {} });
const scan1 = A.readerWorker(), pool1 = A.prepareSolverWorkers(), ready1 = A.prepareReadyWorker();
// Reproduce a real current worker failing while its dependencies load.
scan1.onerror(error()); assert.equal(A.reader.failed, true); assert.equal(scan1.terminated, true);
pool1[0].onerror(error()); assert.equal(A.solver.failed, true); assert.ok(pool1.every(w => w.terminated));
assert.equal(A.readerWorker(), null, 'no runaway restart inside the failed entry');
A.suspend(); assert.equal(A.reader.failed, false); assert.equal(A.solver.failed, false);
const scan2 = A.readerWorker(), pool2 = A.prepareSolverWorkers(), ready2 = A.prepareReadyWorker();
assert.notEqual(scan1, scan2); assert.notEqual(pool1, pool2); assert.notEqual(ready1, ready2);
// Cancellation can report the old import failure after a new pool has started.
scan1.onerror(error()); pool1[0].onerror(error()); ready1.onerror(error());
let closed = 0; scan1.onmessage({ data: { preview: { close() { closed++; } } } });
assert.equal(closed, 1, 'stale transferred preview was leaked');
assert.equal(A.readerWorker(), scan2); assert.equal(A.prepareSolverWorkers(), pool2); assert.equal(A.prepareReadyWorker(), ready2);
assert.ok(!scan2.terminated && !ready2.terminated && pool2.every(w => !w.terminated));
assert.equal(A.reader.failed, false); assert.equal(A.solver.failed, false);
// Now exit during import, then enter again without waiting for stale events.
A.suspend(); const scan3 = A.readerWorker(), pool3 = A.prepareSolverWorkers(), ready3 = A.prepareReadyWorker();
scan2.onerror(error()); pool2[1].onerror(error()); ready2.onerror(error());
assert.equal(A.readerWorker(), scan3); assert.equal(A.prepareSolverWorkers(), pool3); assert.equal(A.prepareReadyWorker(), ready3);
A.suspend(); const count = workers.length;
scan3.onerror(error()); pool3[0].onerror(error()); ready3.onerror(error());
assert.equal(workers.length, count); assert.ok(workers.every(w => w.terminated));
assert.equal(A.reader.failed, false); assert.equal(A.solver.failed, false);
console.log('PASS: current import failure stays bounded; re-entry recovers reader/solver/readiness; late errors cannot kill replacements or poison the idle state; stale bitmaps and every old worker are released.');
