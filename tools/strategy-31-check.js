#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const T = require('../js/engine'), S = require('../js/solver'), R = require('../js/rust-solver');
function fixture(tier = 3, gifts = 1) {
  const st = T.newGame({ seed: 'TERMINAL31', params: { startInmates: 0, startTools: 0, rewards: false, eventStartChance: 0, eventMorningChance: 0, eventFollowChance: 0, eventWalkChance: 0, eventActionChance: 0 } });
  st.pending = []; st.phase = 'manage';
  for (let n = 1; n < 16; n++) assert.ok(T.editCell(st, n, { kind: 'empty' }).ok);
  assert.ok(T.editCell(st, 1, { kind: 'open', beast: 'mammoth', tier }).ok);
  assert.ok(T.editCell(st, 2, { kind: 'open', beast: 'lion', tier }).ok);
  assert.ok(T.addTool(st, 'saw').ok);
  st.day = st.maxDays; st.used.devour = 1;
  st.pending = Array.from({ length: gifts }, () => ({ kind: 'gift', options: ['ring', 'wine', 'horn', 'brand'] }));
  return st;
}
async function main() {
  const core = await R.fromBytes(fs.readFileSync('js/solver-core.wasm'));
  const baseline = 'sandbox/tartarus-before-31/js/solver-core.wasm';
  const previous = fs.existsSync(baseline) ? await R.fromBytes(fs.readFileSync(baseline)) : null;
  const counts = [{}, {}], single = fixture();
  let parity = 0;
  for (let seed = 1; seed <= 1000; seed++) for (const enabled of [false, true]) {
    const params = { ...S.paramsFor(single), terminalGifts: enabled };
    const action = S.decide(single, params, S.rng32(seed));
    assert.deepEqual(core.request({ op: 'decide', state: single, seed, params }).action, action); parity++;
    counts[+enabled][action.id] = (counts[+enabled][action.id] || 0) + 1;
    if (enabled) assert.equal(action.id, 'horn');
    else if (previous) assert.deepEqual(previous.request({ op: 'decide', state: single, seed }).action, action);
  }
  assert.ok(counts[0].ring > 0);
  const queued = fixture(2, 2), queueValues = [[], []], queueChoices = [{}, {}];
  for (let seed = 1; seed <= 4000; seed++) for (const enabled of [false, true]) {
    const params = { ...S.paramsFor(queued), terminalGifts: enabled };
    const action = core.request({ op: 'decide', state: queued, seed, params }).action;
    queueChoices[+enabled][action.id] = (queueChoices[+enabled][action.id] || 0) + 1;
    if (seed <= 100) { assert.deepEqual(action, S.decide(queued, params, S.rng32(seed))); parity++; }
    if (enabled) assert.equal(action.id, 'wine');
    else assert.equal(action.id, 'ring');
    const state = S.clone(queued); state.rng = seed;
    const result = core.request({ op: 'playout', state, seed: seed + 10000, params });
    assert.ok(result.ok); assert.equal(result.state.phase, 'ended');
    queueValues[+enabled].push(result.state.vault.length);
  }
  assert.ok(queueValues[1].some(v => v > 0)); assert.ok(queueValues[0].every(v => v === 0));
  // A waiting event/office decision, a remaining daily move and another
  // gift must never be swallowed by the final-single-gift shortcut.
  const guards = [];
  for (const change of [
    s => { s.day--; }, s => { s.used.devour = 0; s.used.swap = 0; },
    s => { s.phase = 'event'; s.event = { kind: 'trickster', cell: 1 }; },
    s => { s.phase = 'office'; }, s => { s.cells[5].sealed = true; },
    s => { s.pending.push({ kind: 'gift', options: ['ring', 'wine', 'horn', 'brand'] }); },
    s => { s.pending[0].options = ['ring', 'wine', 'brand']; },
  ]) {
    const st = fixture(2); change(st);
    for (let seed = 1; seed <= 32; seed++) {
      assert.deepEqual(core.request({ op: 'decide', state: st, seed }).action, S.decide(st, null, S.rng32(seed))); parity++;
    }
    guards.push(true);
  }
  assert.equal(S.decide(single, { giftRank: ['ring', 'horn'] }, S.rng32(1)).id, 'ring');
  const summarize = xs => ({ n: xs.length, mean: xs.reduce((a,b)=>a+b,0)/xs.length });
  const report = { checkedAt: new Date().toISOString(), version: require('../desktop/package.json').version,
    singleGiftChoices: { before: counts[0], corrected: counts[1] }, queuedGiftChoices: { before: queueChoices[0], corrected: queueChoices[1] },
    queuedGiftFinalRainbows: { before: summarize(queueValues[0]), corrected: summarize(queueValues[1]) },
    exactSingleGiftExpectation: { horn: .25, otherGifts: 0 }, jsRustDecisions: parity, guardFamilies: guards.length,
    limitations: 'Constructed terminal positions; these frequencies are not the frequency of bad live advice. Full root Monte Carlo already selected Horn in the single-gift fixture.', gameInput: false };
  fs.writeFileSync('tools/results/tartarus-strategy-31-targeted-20261023.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { fixture };
