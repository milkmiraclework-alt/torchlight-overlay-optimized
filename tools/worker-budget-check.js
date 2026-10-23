#!/usr/bin/env node
/* Real pool creation and full rollout quotas for different reported CPUs. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const T = require('../js/engine.js'), S = require('../js/solver.js');
const source = fs.readFileSync(require.resolve('../js/analyze.js'), 'utf8').replace(/\r\n/g, '\n');
const init = '  buildBoard();\n  bind();\n  render();';
assert.ok(source.includes(init));
const cases = [[undefined, 1], [null, 1], [NaN, 1], [Infinity, 1], [-2, 1], [0, 1], [1, 1], [2, 1], [4, 3], [8, 7], [12, 11], [16, 15], [24, 16], [32, 16], [64, 16], [128, 16]];
for (const [logical, expected] of cases) {
  const taskWindow = { Tartarus: T, TartarusSolver: S }, workers = [];
  vm.runInNewContext(source.replace(init, '  window.checkWorkers = { solverWorkerCount, prepareSolverWorkers, makeShares };'), {
    window: taskWindow, document: { currentScript: null }, navigator: { hardwareConcurrency: logical }, localStorage: { getItem: () => null },
    Worker: class { constructor(url) { assert.ok(url.startsWith('js/solver-worker.js')); workers.push(this); } postMessage() {} terminate() {} }
  });
  const A = taskWindow.checkWorkers;
  assert.equal(workers.length, 0, 'Loading the analyzer created idle solver workers');
  const pool = A.prepareSolverWorkers();
  assert.equal(pool.length, expected, 'Wrong pool for ' + logical);
  assert.equal(A.prepareSolverWorkers(), pool, 'Preparing twice replaced the active pool');
  assert.equal(workers.length, expected, 'Preparing twice created duplicate workers');
  for (const target of [400, 1600]) {
    const shares = A.makeShares(target);
    assert.equal(shares.reduce((sum, share) => sum + share.target, 0), target, 'Changing CPUs changed total rollouts');
    assert.ok(shares.every(share => share.target > 0));
    assert.ok(Math.max(...shares.map(share => share.target)) - Math.min(...shares.map(share => share.target)) <= 1);
  }
}
console.log('PASS: unknown/invalid and 1–128 logical CPUs create bounded lazy pools, reuse existing workers and preserve every rollout in the production quota.');
