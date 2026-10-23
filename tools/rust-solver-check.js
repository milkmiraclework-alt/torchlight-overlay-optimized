#!/usr/bin/env node
/* Differential checks against the frozen JavaScript rules and strategy. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const source = path.resolve(arg('--reference', path.join(ROOT, 'js')));
const T = require(path.join(source, 'engine.js'));
const S = require(path.join(source, 'solver.js'));
const binary = path.resolve(arg('--binary', path.join(ROOT, 'native/tartarus/target/release/tartarus-core.exe')));
const useWasm = args.includes('--wasm');
const child = useWasm ? null : spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
const core = useWasm ? require('../js/rust-solver.js').fromBytes(fs.readFileSync(path.join(ROOT, 'js/solver-core.wasm'))) : null;
let pending = null;
const lines = child && readline.createInterface({ input: child.stdout });
lines?.on('line', (text) => { const task = pending; pending = null; try { const value = JSON.parse(text); if (value.error) throw new Error(value.error); task.resolve(value); } catch (error) { task.reject(error); } });
child?.on('error', (error) => pending?.reject(error));
child?.on('exit', (code) => { if (pending) { pending.reject(new Error(`Rust exited: ${code}`)); pending = null; } });
const request = useWasm ? async (value) => (await core).request(value) : (value) => new Promise((resolve, reject) => { assert.equal(pending, null); pending = { resolve, reject }; child.stdin.write(JSON.stringify(value) + '\n'); });
const normalized = (st) => ({
  rng: st.rng, day: st.day, maxDays: st.maxDays, startEvent: st.startEvent || null, phase: st.phase,
  position: st.position, destinations: st.destinations, chain: !!st.chain, event: st.event,
  cells: st.cells.map((c) => ({ n: c.n, sealed: c.sealed, inmate: c.inmate && { id: c.inmate.id, beast: c.inmate.beast, tier: c.inmate.tier, marked: !!c.inmate.marked },
    hidden: c.hidden && { id: c.hidden.id, beast: c.hidden.beast, tier: c.hidden.tier, marked: !!c.hidden.marked }, known: c.known, atLeast: c.atLeast || 0,
    scratch: !!c.scratch, nest: c.nest, event: c.event, ivory: !!c.ivory, seen: !!c.seen, eventKnown: c.eventKnown !== false })),
  vault: st.vault, cache: st.cache, tools: st.tools, pending: st.pending.map((p) => ({ kind: p.kind, options: p.options, rerolls: p.rerolls || 0, start: !!p.start })),
  objective: st.objective, milestone: !!st.milestone,
  used: { swap: st.used.swap, devour: st.used.devour, hunt: st.used.hunt || 0, noDevour: !!st.used.noDevour, noSwap: !!st.used.noSwap, noHunt: !!st.used.noHunt,
    devourAfterSwap: !!st.used.devourAfterSwap, huntOnly: st.used.huntOnly || null, mealOnly: st.used.mealOnly || null, officeOnly: st.used.officeOnly || null },
  chaining: st.chaining && { eater: st.chaining.eater }, eventPool: st.eventPool, prey: st.prey, nextId: st.nextId,
  stats: st.stats, ratway: !!st.ratway, destBase: st.destBase || 0,
});
const fixtures = [
  ...Object.keys(T.SCENARIOS).map((scenario) => ({ scenario })), { params: { rewards: false } },
  ...Object.keys(T.START_EVENTS).map((startEvent) => ({ startEvent })), ...T.TOOL_IDS.map((tool) => ({ tool })),
  { tools: ['saw', 'whip', 'collar', 'revenge'] }, { tools: ['maul', 'crown', 'skewer'], startEvent: 'cagefight' },
];
function analyzerStates() {
  const make = () => {
    const s = T.newGame({ seed: 'ANALYZER-RUST-CARDS', params: { rewards: true } });
    s.pending = []; s.phase = 'manage'; s.position = 2; s.day = 7;
    for (let n = 1; n <= 8; n++) T.editCell(s, n, { kind: 'open', beast: T.BEASTS[n % 4], tier: n % 3 });
    return s;
  };
  const result = [];
  for (const kind of T.EVENT_IDS) { const s = make(); s.phase = 'event'; s.event = { kind, cell: 2 }; result.push(s); }
  for (const patch of [{ noDevour: true }, { noSwap: true }, { swap: 1, devourAfterSwap: true }, { noDevour: true, noSwap: true, noHunt: true }, { mealOnly: [3] }]) {
    const s = make(); Object.assign(s.used, patch); result.push(s);
  }
  for (const choice of ['bestow', 'instigate']) { const s = make(); s.position = 0; s.phase = 'office'; s.used.officeOnly = choice; result.push(s); }
  const offer = make(); offer.pending = [{ kind: 'tool', options: ['rope', 'muzzle', 'claws'], rerolls: 2 }]; result.push(offer);
  const unknown = make(); unknown.phase = 'patrol'; unknown.destinations = [9, 10, 11];
  Object.assign(unknown.cells[9], { event: 'chain', eventKnown: false, seen: true, hidden: { id: 1001, beast: 'wolf', tier: 2 }, known: 1 });
  Object.assign(unknown.cells[10], { hidden: { id: 1002, beast: 'lion', tier: 3 }, known: 2 });
  Object.assign(unknown.cells[11], { hidden: null, atLeast: 2 }); result.push(unknown);
  const prey = make(); prey.position = 1; T.editCell(prey, 1, { kind: 'open', beast: 'lion', tier: 2 });
  T.editCell(prey, 2, { kind: 'open', beast: 'rat', tier: 2 }); assert.ok(T.addTool(prey, 'trap').ok); assert.ok(T.markPrey(prey, 1, 2).ok); result.push(prey);
  return result;
}
(async () => {
  let moves = 0, runs = 0, engineActions = 0;
  const snapshots = [], begin = performance.now();
  for (const [i, fixture] of (args.includes('--quick') ? fixtures.filter((_, i) => i % 8 === 0) : fixtures).entries()) {
    for (let seed = 0; seed < (args.includes('--quick') ? 1 : 6); seed++) {
      const st = T.newGame({ ...fixture, seed: `RUST-PARITY-${i}-${seed}` });
      const held = fixture.tools || (fixture.tool ? [fixture.tool] : []);
      if (held.length) st.pending = [];
      for (const tool of held) assert.ok(T.addTool(st, tool).ok, 'Parity fixture failed to add ' + tool);
      const random = S.rng32(seed + 1);
      const native = await request({ op: 'trajectory', state: st, seed: seed + 1 });
      for (const [step, row] of native.steps.entries()) {
        const action = S.decide(st, null, random);
        try {
          assert.deepEqual(row.action, action, `policy: fixture ${i}, seed ${seed}, step ${step}, day ${st.day}`);
          if (seed === 0 && step % 23 === 0 && snapshots.length < (i + 1) * 3) snapshots.push(S.clone(st));
          const result = S.apply(st, action);
          assert.equal(row.ok, result.ok, 'action legality');
          assert.deepEqual(normalized(row.state), normalized(st), `engine: fixture ${i}, seed ${seed}, step ${step}`);
        } catch (error) {
          const dir = path.join(ROOT, 'sandbox/rust-parity-failure'); fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'position.json'), JSON.stringify({ fixture, seed, step, state: st, native: row }, null, 2));
          throw error;
        }
        moves++;
      }
      assert.equal(st.phase, 'ended', 'trajectory stopped early'); runs++;
    }
  }
  console.log(`PASS: ${runs} whole seeded runs, ${moves} decisions/actions, engine state and RNG match JavaScript.`);
  // Also exercise actions the policy didn't choose, and analyzer-only cards.
  const special = analyzerStates();
  for (const [i, st] of [...snapshots, ...special].entries()) {
    if (i < snapshots.length && i % 4) continue;
    const candidates = S.candidates(st).map((x) => x.action);
    assert.deepEqual(await request({ op: 'candidates', state: st }), candidates);
    for (const action of candidates) {
      const js = S.clone(st), reference = S.apply(js, action);
      const native = await request({ op: 'apply', state: st, action });
      assert.equal(native.ok, reference.ok); assert.deepEqual(normalized(native.state), normalized(js)); engineActions++;
    }
  }
  const mcBoards = [...snapshots.filter((_, i) => i % 7 === 0).slice(0, args.includes('--quick') ? 3 : 20), ...special];
  for (const [i, st] of mcBoards.entries()) {
    const rollouts = 12, seed = 7919 + i, stream = i % 3;
    const job = S.solve(st, { rollouts, seed, stream }); let progress;
    do { progress = job.step(60, true); } while (!progress.done);
    const native = await request({ op: 'solve', state: st, rollouts, seed, stream });
    assert.equal(native.rounds, progress.rounds);
    assert.deepEqual(native.rows, job.rows.map((r) => ({ action: r.action, vals: r.vals.map((v) => Number.isNaN(v) ? null : v), best: r.best, policy: r.policy })), `MC raw samples: board ${i}`);
  }
  console.log(`PASS: ${engineActions} alternative actions; ${mcBoards.length} full-horizon Monte Carlo positions, raw samples, tie metrics and policy flags match.`);
  const report = { checkedAt: new Date().toISOString(), runs, moves, alternativeActions: engineActions, monteCarloPositions: mcBoards.length,
    analyzerCardStates: special.length, elapsedMs: Math.round(performance.now() - begin), reference: path.relative(ROOT, source), binary: useWasm ? 'js/solver-core.wasm' : path.relative(ROOT, binary), gameInput: false };
  fs.mkdirSync(path.join(ROOT, 'sandbox/rust-solver-check'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, `sandbox/rust-solver-check/${useWasm ? 'wasm' : 'native'}-report.json`), JSON.stringify(report, null, 2) + '\n');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { child?.stdin.end(); });
