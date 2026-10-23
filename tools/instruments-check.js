#!/usr/bin/env node
/* Instrument confirmation, incomplete panel reads and exact solver inputs. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const T = require('../js/engine.js'), S = require('../js/solver.js'), K = require('../js/solver-cache.js');
const window = { Tartarus: T, TartarusSolver: S, TartarusSolverCache: K };
let source = fs.readFileSync(require.resolve('../js/analyze.js'), 'utf8').replace(/\r\n/g, '\n');
const init = '  buildBoard();\n  bind();\n  render();';
assert.ok(source.includes(init));
source = source.replace(init, '  window.checkInstruments = { blankModel, normalize, runTools, confirmTools, buildState, resultKey, scanToModel, modelFrom };');
vm.runInNewContext(source, { window, document: { currentScript: null }, navigator: { hardwareConcurrency: 4 }, localStorage: { getItem: () => null } });
const A = window.checkInstruments;
const icon = (sim, conf = 1) => ({ sim, conf, name: T.toolName(sim) });
function scan(base, read, patch = {}) {
  const next = { ...JSON.parse(JSON.stringify(base)), ...patch }, notes = [];
  next.tools = A.runTools(read, base, next, notes).map((t) => t.sim);
  return next;
}
let base = A.blankModel(); base.day = 2; base.tools = ['crown'];
let next = scan(base, [icon('skewer')]);
assert.match(next.toolsToConfirm, /An icon/); assert.equal(next.tools.join(), 'crown');
A.confirmTools(next);
for (let i = 0; i < 80; i++) {
  next = scan(A.normalize(JSON.parse(JSON.stringify(next))), i % 4 ? [icon(i % 2 ? 'skewer' : 'cage')] : []);
  assert.equal(next.toolsToConfirm, '', 'The same confirmed panel asked again');
  assert.equal(next.tools.join(), 'crown');
}
const engine = A.buildState(next).st;
assert.equal(engine.tools.join(), 'crown', 'An erroneous icon reached the solver');
assert.equal(A.modelFrom(engine, next).toolsConfirmed.tools, 'crown', 'A simulated move forgot confirmation');
for (let slots = 0; slots <= 12; slots++) {
  const noisy = scan(next, Array.from({ length: slots }, (_, n) => icon(n % 2 ? 'skewer' : 'cage')));
  assert.equal(noisy.toolsToConfirm, '', 'Noisy slot segmentation cancelled manual confirmation');
  assert.equal(A.buildState(noisy).st.tools.join(), 'crown', 'Noisy slots changed simulation instruments');
}
assert.equal(scan(next, [icon('skewer')], { day: 1 }).toolsConfirmed, null, 'A new run reused confirmation');
const changed = { ...next, tools: ['claws'] };
assert.ok(scan(changed, [icon('skewer')]).toolsToConfirm, 'Changing instruments kept an unrelated confirmation');
assert.equal(A.resultKey(next, 1600), A.resultKey({ ...next, toolsConfirmed: null, toolsPanelSlots: 6, toolsToConfirm: 'different notice', toolsOffer: { options: ['maiden'] } }, 1600));
assert.notEqual(A.resultKey(next, 1600), A.resultKey(changed, 1600));
console.log('PASS: 80 conflicting/missing panels and 0..12 noisy slots retain confirmed instruments across reload; solver receives Crown; new runs/changed instruments invalidate confirmation; UI metadata cannot fragment the solver cache.');
base = A.blankModel(); base.tools = ['coin']; base.step = 'choice'; base.choice = { kind: 'tool', options: ['fire', 'collar', 'shackles'] };
base.toolsOffer = { options: base.choice.options.slice(), advised: 'shackles' };
next = scan(base, [icon('coin')]); next.step = 'manage';
assert.ok(next.toolsOffer && next.toolsToConfirm, 'The offer disappeared with an incomplete first panel');
next = scan(next, [icon('coin'), icon('shackles')]);
assert.equal(next.tools.join(), 'coin,shackles'); assert.equal(next.toolsOffer, null);
assert.equal(A.buildState(next).st.tools.includes('shackles'), true);
base.toolsOffer.advised = null;
next = scan(base, [icon('coin'), icon('collar', 0.25)]);
assert.equal(next.tools.join(), 'coin', 'A weak icon was treated as the chosen instrument');
assert.ok(next.toolsToConfirm && next.toolsOffer);
base.toolsOffer.advised = 'shackles';
next = scan(base, [icon('coin'), icon('collar', 0.25)]);
assert.equal(next.tools.join(), 'coin,shackles'); assert.match(next.toolsToConfirm, /assumed/);
A.confirmTools(next);
assert.equal(scan(next, [icon('coin'), icon('skewer')]).toolsToConfirm, '');
console.log('PASS: an incomplete panel retains the offer until the extra instrument appears; low confidence cannot silently select another item; an advised fallback explicitly asks for confirmation.');
