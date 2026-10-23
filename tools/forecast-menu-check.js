#!/usr/bin/env node
/* Exact playout equivalence when one patrol table serves different menus. */
'use strict';
const assert = require('node:assert/strict');
const T = require('../js/engine.js'), S = require('../js/solver.js'), F = require('../js/solver-forecast.js');
const finish = (state, seed, stream) => {
  const job = S.solve(state, { rollouts: 16, seed, stream });
  let result; do { result = job.step(50); } while (!result.done);
  return { result, rows: job.rows };
};
let checked = 0;
for (const [index, tools] of [[], ['forged', 'blacklist', 'claws'], ['saw', 'revenge', 'muzzle'], ['fire', 'scales', 'axe']].entries()) {
  const state = T.newGame({ seed: 'PATROL-TABLE', startEvent: index === 2 ? 'cagefight' : null, params: { rewards: index % 2 === 1 } });
  state.pending = []; state.day = 2; state.maxDays = 5; state.phase = 'patrol'; state.position = 10;
  state.destinations = [11, 12, 13, 14, 15, 0];
  for (const n of [1, 3, 5, 7, 11, 13]) T.editCell(state, n, { kind: 'open', beast: T.BEASTS[n % 4], tier: n % 3 });
  for (const id of tools) T.addTool(state, id);
  const seed = 101 + index, stream = index + 1, saved = JSON.stringify(state);
  const all = finish(state, seed, stream);
  const menus = [];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 6; c++) menus.push([a, b, c]);
  menus.push([0, 4], [0, 1, 3, 5], [0, 1, 2, 3, 4, 5]);
  for (const indexes of menus) {
    const subset = S.clone(state); subset.destinations = indexes.map((i) => state.destinations[i]);
    const exact = finish(subset, seed, stream);
    const projected = F.patrolResult(S, subset, all.rows, 16, seed);
    assert.deepEqual(projected, exact.result, `Menu changed samples/rankings: ${index} ${indexes}`);
    for (const row of exact.rows) {
      const shared = all.rows.find((r) => S.sameAction(r.action, row.action));
      assert.deepEqual(shared.vals, row.vals);
      for (const key of ['pass', 'points', 'best']) assert.equal(shared[key], row[key]);
    }
    checked++;
  }
  assert.equal(JSON.stringify(state), saved);
  assert.equal(F.patrolResult(S, { ...state, mode: 'challenge' }, all.rows, 16, seed), null);
  assert.equal(F.patrolResult(S, state, all.rows, 17, seed), null);
}
const before = T.newGame({ seed: 'AUTO-DAY', params: { rewards: false } });
before.pending = []; before.phase = 'manage'; before.position = 1;
before.used.devour = 1;
const sampled = F.predict(before, { type: 'end' }, { autoDay: true, patrolFamilies: true, samples: 48 });
assert.equal(sampled.length, 1, 'Random door menus fragmented one unchanged board');
assert.equal(sampled[0].state.destinations.length, 6);
assert.equal(sampled[0].patrolFamily, true);
console.log(`PASS: ${checked} menus preserve every sample, counter, paired margin and ranking across instruments/rewards/Cage Fight; random menus share one table.`);
