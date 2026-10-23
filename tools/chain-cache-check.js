#!/usr/bin/env node
/* Exact shared chain math versus isolated per-decision chain math. */
'use strict';
const assert = require('node:assert/strict');
const T = require('../js/engine.js');
const S = require('../js/solver.js');
function board(tools, fight, chainStop = true) {
  const st = T.newGame({ seed: 'CHAIN-SHARING', startEvent: fight ? 'cagefight' : null, params: { rewards: false, chainStop } });
  st.pending = []; st.phase = 'manage'; st.position = 2; st.maxDays = 2;
  for (let n = 1; n <= 12; n++) T.editCell(st, n, { kind: 'open', beast: T.BEASTS[(n - 1) % 4], tier: (n - 1) / 4 | 0 });
  for (const tool of tools) T.addTool(st, tool);
  return st;
}
function finish(job) { let result; do { result = job.step(4); } while (!result.done); return { result, rows: job.rows }; }
function oneRound(job) {
  const saved = Date.now; let calls = 0;
  try { Date.now = () => calls++ <= 1 ? 0 : 2; return job.step(1, true); }
  finally { Date.now = saved; }
}
const sets = [[], ['maul'], ['crown', 'skewer'], ['saw', 'whip'], ['muzzle', 'collar'], ['revenge'], ['saw', 'whip', 'revenge', 'muzzle', 'maul', 'crown', 'skewer', 'collar']];
let hits = 0;
for (const fight of [false, true]) for (const chainStop of [false, true]) for (const tools of sets) {
  const st = board(tools, fight, chainStop), saved = JSON.stringify(st);
  const cached = S.solve(st, { rollouts: 12, seed: 101 });
  const expected = finish(S.solve(st, { rollouts: 12, seed: 101, chainCache: false }));
  assert.deepEqual(finish(cached), expected, `shared chain result differs: ${tools}, fight=${fight}, stop=${chainStop}`);
  const info = cached.chainInfo();
  assert.ok(info.entries <= 8192 && info.partitions <= 256);
  hits += info.hits;
  assert.equal(JSON.stringify(st), saved, 'a private trial changed the caller state');
}
assert.ok(hits > 0, 'shared chain math was never reused');
console.log(`PASS: exact samples/rankings for 28 tool/rule combinations, both chain-stop modes; ${hits} chain cache hits.`);

const params = { tierBase: 2.75, stopMargin: 0, rainbowMult: 1.5 };
const st = board(sets.at(-1), true);
const shared = S.solve(st, { rollouts: 270, seed: 31337, params });
const isolated = S.solve(st, { rollouts: 270, seed: 31337, params, chainCache: false });
for (let round = 0; round < 270; round++) {
  if (round === 255) params.stopMargin = 2;
  if (round === 260) params.tierBase = 3;
  // First exercise the partition bound, then hold Rainbow value constant
  // while changing tier/stop weights, so stale tables cannot hide behind R.
  params.rainbowMult = round < 250 ? 1 + round / 100 : 243 / params.tierBase ** 5;
  assert.deepEqual(oneRound(shared), oneRound(isolated));
  assert.deepEqual(shared.rows, isolated.rows);
  const info = shared.chainInfo();
  assert.ok(info.entries <= 8192 && info.partitions <= 256, 'shared cache grew beyond its bound');
}
assert.ok(shared.chainInfo().clears > 2, 'partition eviction or strategy invalidation was not exercised');
console.log(`PASS: bounded cache, partition eviction and changing strategy/Rainbow values over 270 slices: ${JSON.stringify(shared.chainInfo())}.`);
if (process.argv.includes('--bench')) {
  const { performance } = require('node:perf_hooks');
  const empty = T.newGame({ seed: 'CHAIN-TIMING', params: { rewards: false } });
  for (const [name, state] of [['empty', empty], ['populated', board([], false)], ['instruments', board(sets.at(-1), false)], ['Cage Fight', board(sets.at(-1), true)]]) {
    const times = { shared: [], isolated: [] };
    for (let repeat = 0; repeat < 6; repeat++) for (const useCache of repeat % 2 ? [false, true] : [true, false]) {
      const start = performance.now();
      finish(S.solve(state, { rollouts: 48, seed: 101, chainCache: useCache }));
      if (repeat) times[useCache ? 'shared' : 'isolated'].push(performance.now() - start);
    }
    const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
    console.log(`${name}: shared ${median(times.shared).toFixed(1)} ms; isolated ${median(times.isolated).toFixed(1)} ms.`);
  }
}
