#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const T = require('../js/engine.js'), S = require('../js/solver.js'), R = require('../js/rust-solver.js');
const window = { Tartarus: T, TartarusSolver: S, TartarusSolverCache: require('../js/solver-cache.js') };
const source = fs.readFileSync(require.resolve('../js/analyze.js'), 'utf8').replace(/\r\n/g, '\n');
const init = '  buildBoard();\n  bind();\n  render();'; assert.ok(source.includes(init));
vm.runInNewContext(source.replace(init, '  window.qualityCheck = { blankModel, buildState, resultKey };'), {
  window, document: { currentScript: null }, navigator: { hardwareConcurrency: 4 }, localStorage: { getItem: () => null },
});
const A = window.qualityCheck;
const model = A.blankModel(); Object.assign(model, { runStart: true, step: 'choice', choice: { kind: 'tool', options: ['coin', 'rope', 'trap'] } });
const state = A.buildState(model).st;
assert.equal(state.initialInmatesPending, true);
const known = JSON.parse(JSON.stringify(model)); known.cells[2] = { kind: 'inmate', beast: 'wolf', tier: 1 };
assert.equal(A.buildState(known).st.initialInmatesPending, undefined);
assert.equal(A.buildState({ ...model, day: 2 }).st.initialInmatesPending, undefined);
assert.notEqual(A.resultKey(model, 400), A.resultKey({ ...model, runStart: false }, 400));
const mark = (fight, tier = 1, tools = [], preyEats = false) => {
  const st = T.newGame({ seed: 'PREY-SURVIVAL', startEvent: fight ? 'cagefight' : null,
    params: { startInmates: 0, eventStartChance: 0, eventFollowChance: 0, eventMorningChance: 0, eventWalkChance: 0, eventActionChance: 0 } });
  st.pending = []; st.phase = 'manage'; st.position = 1; st.day = 3;
  T.editCell(st, 1, { kind: 'open', beast: 'lion', tier });
  T.editCell(st, 2, { kind: 'open', beast: 'wolf', tier });
  T.editCell(st, 3, { kind: 'open', beast: 'rat', tier: fight ? 0 : tier });
  for (const id of ['trap', ...tools]) assert.ok(T.addTool(st, id).ok);
  assert.ok(T.markPrey(st, 1, 2).ok);
  if (preyEats) st.position = 2;
  return st;
};
function delta(st, target) {
  const score = enabled => S.devourScores(st, S.context(st, { ...S.paramsFor(st), preySurvival: enabled })).find(x => x.cell === target).score;
  return score(true) - score(false);
}
const tests = [];
const cage = mark(true); const value = 2 * (3 ** 4 - 3);
assert.equal(delta(cage, 3), value * 0.75, 'Cage Fight keeps both inmates on a non-vaulting bite'); tests.push(cage);
const prey = mark(true, 1, [], true);
assert.equal(delta(prey, 3), value, 'the prey also preserves its mark when its beast is kept'); tests.push(prey);
const vault = mark(true, 2, ['crown']); const promised = 2 * (3 ** 5 * 1.5 - 3 ** 2);
assert.equal(delta(vault, 3), -promised * 0.25, 'vaulting the Lion ends the link with certainty'); tests.push(vault);
const saw = mark(true, 3, ['saw']); const promise3 = 2 * (3 ** 5 * 1.5 - 3 ** 3);
assert.equal(delta(saw, 3), promise3 * 0.5, 'Saw makes the Cage Fight Lion vault with 25% probability'); tests.push(saw);
const capped = mark(true, 2, ['crown']); capped.vault = Array.from({ length: 10 }, (_, id) => ({ id: 100 + id, beast: 'rat', day: 1 }));
assert.ok(delta(capped, 3) > 0, 'full vault caps the tier without removing or rerolling the Lion'); tests.push(capped);
const ordinary = mark(false); ordinary.params.beastWeights = [10, 70, 10, 10];
assert.ok(delta(ordinary, 3) > 0, 'weighted beast survival replaces the fixed 25% assumption'); tests.push(ordinary);
(async () => {
  const core = await R.fromBytes(fs.readFileSync('js/solver-core.wasm'));
  const raw = job => { let result; do { result = job.step(1000, true); } while (!result.done); return job.rows.map(r => ({ action: r.action, vals: r.vals.map(v => Number.isNaN(v) ? null : v), best: r.best, policy: r.policy })); };
  const snapshots = [state, ...tests];
  for (let seed = 1; seed <= 24; seed++) {
    const st = S.clone(state); S.hideFuture(st, seed);
    const opened = st.cells.filter(c => c.inmate && !c.sealed).length;
    assert.ok(opened === 3 || opened === 4); assert.equal(st.day, 1); assert.equal(st.phase, 'patrol');
    assert.equal(st.stats.opened, 0); assert.equal(st.initialInmatesPending, undefined);
    const cells = JSON.stringify(st.cells); S.hideFuture(st, seed + 1000); assert.equal(JSON.stringify(st.cells), cells, 'already sampled starting board was redrawn');
  }
  for (const [i, st] of snapshots.entries()) for (const giftAdaptive of [false, true]) {
    const params = { ...S.paramsFor(st), giftAdaptive }, seed = 101 + i;
    const expected = raw(S.solve(st, { rollouts: 12, seed, params }));
    const got = core.request({ op: 'solve', state: st, rollouts: 12, seed, params });
    assert.deepEqual(got.rows, expected, 'Rust/JS initial-world, prey and gift trials differ');
  }
  console.log('PASS: unknown starting offers sample 3–4 inmates and day-1 patrols; known boards stay intact; Cage Fight/prey/weighted beasts/vault/Saw regressions and Rust/JS raw-sample parity.');
})().catch(e => { console.error(e); process.exitCode = 1; });
