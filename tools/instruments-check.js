#!/usr/bin/env node
/* Instrument confirmation, incomplete panel reads and exact solver inputs. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const T = require('../js/engine.js'), S = require('../js/solver.js'), K = require('../js/solver-cache.js'), Scan = require('../js/scan.js');
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
assert.equal(scan(next, [icon('skewer')], { day: 1 }).toolsConfirmed.tools, 'crown', 'A backwards countdown erased confirmed instruments');
assert.equal(scan(next, [icon('skewer')], { day: 1, runToken: 'new-run' }).toolsConfirmed, null, 'An explicit new run reused confirmation');
const changed = { ...next, tools: ['claws'] };
assert.ok(scan(changed, [icon('skewer')]).toolsToConfirm, 'Changing instruments kept an unrelated confirmation');
assert.equal(A.resultKey(next, 1600), A.resultKey({ ...next, toolsConfirmed: null, toolsPanelSlots: 6, toolsToConfirm: 'different notice', toolsOffer: { options: ['maiden'] } }, 1600));
assert.notEqual(A.resultKey(next, 1600), A.resultKey(changed, 1600));
console.log('PASS: 80 conflicting/missing panels and 0..12 noisy slots retain confirmed instruments across reload; solver receives Crown; new runs/changed instruments invalidate confirmation; UI metadata cannot fragment the solver cache.');
base = A.blankModel(); base.tools = ['coin']; base.step = 'choice'; base.choice = { kind: 'tool', options: ['fire', 'collar', 'shackles'] };
base.toolsOffer = { options: base.choice.options.slice(), advised: 'shackles' };
next = scan(base, [icon('coin')]); next.step = 'manage';
assert.ok(next.toolsOffer && next.toolsToConfirm, 'The offer disappeared with an incomplete first panel');
assert.ok(A.buildState(next).problems.some((p) => p.includes('instruments')), 'Unresolved instruments reached the calculator');
next = scan(next, [icon('coin'), icon('shackles')]);
assert.equal(next.tools.join(), 'coin,shackles'); assert.equal(next.toolsOffer, null);
assert.equal(A.buildState(next).st.tools.includes('shackles'), true);
assert.equal(A.buildState(next).problems.filter((p) => p.includes('instruments')).length, 0, 'A reliable later reading remained blocked');
base.toolsOffer.advised = null;
next = scan(base, [icon('coin'), icon('collar', 0.25)]);
assert.equal(next.tools.join(), 'coin', 'A weak icon was treated as the chosen instrument');
assert.ok(next.toolsToConfirm && next.toolsOffer);
base.toolsOffer.advised = 'shackles';
next = scan(base, [icon('coin'), icon('collar', 0.25)]);
assert.equal(next.tools.join(), 'coin', 'The recommended item was substituted for the actual choice');
assert.ok(next.toolsToConfirm && next.toolsOffer);
assert.equal(A.confirmTools(next), false, 'An unread selection could be acknowledged without choosing an instrument');
assert.equal(next.toolsConfirmed, null);
for (let i = 0; i < 5; i++) {
  next = scan(A.normalize(JSON.parse(JSON.stringify(next))), [icon('coin')]);
  assert.ok(next.toolsOffer && next.toolsUncertain && next.toolsToConfirm, 'A repeated incomplete frame forgot the unresolved choice');
}
next = scan(next, [icon('coin'), icon('collar')]);
assert.equal(next.tools.join(), 'coin,collar', 'The actual choice did not override the recommendation');
assert.equal(next.toolsOffer, null); assert.equal(next.toolsUncertain, false);
assert.equal(A.confirmTools(next), true);
assert.equal(scan(next, [icon('coin'), icon('skewer')]).toolsToConfirm, '');
const tie = { ...icon('collar'), alts: [{ sim: 'collar', score: 0.99 }, { sim: 'shackles', score: 0.98 }] };
assert.equal(scan(base, [icon('coin'), tie]).tools.join(), 'coin', 'A high-confidence near tie was accepted');
assert.ok(scan(base, [icon('coin'), icon('collar'), icon('shackles')]).toolsOffer, 'Two different offered candidates became one definite selection');
const unreadOffer = { ...base, toolsOffer: { options: [], unread: true } };
const afterMissedOffer = scan(unreadOffer, [icon('coin'), icon('collar')]);
assert.equal(afterMissedOffer.tools.join(), 'coin', 'An unread new offer reused candidates from the previous offer');
assert.ok(afterMissedOffer.toolsOffer.unread && A.buildState(afterMissedOffer).problems.some((p) => p.includes('instruments')));
const legacy = A.normalize({ ...base, step: 'manage', tools: ['coin', 'shackles'], toolsOffer: null,
  toolsToConfirm: 'The selected instrument was not recognized. The analyzer assumed shackles, as advised.' });
assert.equal(legacy.tools.join(), 'coin'); assert.ok(legacy.toolsOffer && legacy.toolsUncertain);
const first = scan(A.blankModel(), [tie]);
assert.equal(first.tools.length, 0); assert.ok(first.toolsUncertain);
assert.ok(scan(first, []).toolsUncertain, 'A later missing panel silently cleared an unknown initial set');
assert.ok(scan(first, []).toolsToConfirm, 'An unresolved initial set lost its correction prompt');
for (const found of [false, true]) {
  const missing = A.blankModel();
  A.runTools([], A.blankModel(), missing, [], { found, tools: [] });
  assert.ok(missing.toolsUncertain && missing.toolsToConfirm, 'A missing first panel was silently interpreted as no instruments');
  assert.equal(A.confirmTools(missing), true, 'An explicitly checked empty set could not be confirmed');
}
console.log('PASS: unread picks never assume the recommendation; later actual picks recover; near ties/multiple candidates wait; unresolved choices survive reload and cannot be blindly confirmed; legacy guesses reopen.');
const oldMissing = A.blankModel();oldMissing.day=4;oldMissing.tools=['ravenous'];oldMissing.toolsOffer={options:['forged','shackles','rope']};
const nooseOnly=scan(oldMissing,[icon('rope')]);
assert.equal(nooseOnly.tools.join(),'ravenous,rope','A clear newly selected Noose required every old icon to be visible');
assert.equal(nooseOnly.toolsOffer,null);
const nooseWeak=scan(oldMissing,[icon('rope',.3)]);
assert.equal(nooseWeak.tools.join(),'ravenous');assert.ok(nooseWeak.toolsOffer,'A weak Noose guess became the selected item');

const feature = { grid: Array.from({ length: 192 }, (_, i) => 1 + i % 17), hist: Array.from({ length: 32 }, (_, i) => (1 + i) / 528) };
const reference = (id, w = 20) => ({ id, w, feat: feature });
assert.equal(Scan.matchToolFeature(feature, 5, { tools: [reference('large', 100)] }).id, null);
assert.equal(Scan.matchToolFeature(feature, 20, { tools: [] }).conf, 0);
const tied = Scan.matchToolFeature(feature, 20, { tools: [reference('collar'), reference('shackles')] });
assert.ok(tied.conf < 0.9, 'Identical art for different instruments was reported as certain');
const aliases = Scan.matchToolFeature(feature, 20, { tools: [reference('a'), reference('b')], toolNames: { a: { sim: 'collar' }, b: { sim: 'collar' } } });
assert.equal(aliases.alts.length, 1); assert.ok(aliases.conf >= 0.9, 'Two references for one tool created false ambiguity');
console.log('PASS: small icons without usable references do not throw; visual ties lower confidence; duplicate references share one semantic candidate.');

const held = A.blankModel(); held.day = 10; held.warden = 1; held.dest = [2]; held.tools = ['coin', 'blacklist']; held.boardSeen = true;
held.cells = held.cells.map((c, n) => n ? { kind: 'inmate', beast: 'wolf', tier: 0 } : c);
A.confirmTools(held);
function board(day) {
  return { ok: true, cells: held.cells.map((c, n) => ({ n, kind: n ? 'inmate' : 'office', beast: c.beast, tier: c.tier || 0, conf: 1, jaws: null })),
    warden: { cell: 1, conf: 1 }, doors: { cells: [2], conf: 1 }, days: { days: 20 - day }, tools: { tools: [icon('coin')] }, chromatic: { count: 0 } };
}
const weakPicture = board(18); weakPicture.cells[1].beast = 'lion'; weakPicture.cells[1].tier = 4; weakPicture.chromatic.count = 9;
const jumped = A.scanToModel(weakPicture, held).model;
assert.equal(jumped.day, 10); assert.equal(jumped.dayProbe.day, 18);
assert.equal(jumped.cells[1].beast, held.cells[1].beast); assert.equal(jumped.cells[1].tier, held.cells[1].tier);
assert.equal(jumped.vault.length, held.vault.length, 'A suspect-day picture poisoned the prior board/vault');
assert.ok(A.buildState(jumped).problems.some(p => p.includes('day')));
assert.equal(jumped.tools.join(), 'coin,blacklist'); assert.equal(jumped.toolsConfirmed.tools, 'blacklist,coin');
const corrected = A.scanToModel(board(11), JSON.parse(JSON.stringify(jumped))).model;
assert.equal(corrected.day, 11); assert.equal(corrected.dayProbe, null); assert.equal(corrected.tools.join(), 'coin,blacklist');
assert.equal(corrected.toolsConfirmed.tools, 'blacklist,coin'); assert.equal(corrected.toolsToConfirm, '');
const repeated = A.scanToModel(board(18), jumped).model;
assert.equal(repeated.day, 18); assert.equal(repeated.dayProbe, null, 'Two consistent independent readings could not confirm a real jump');
const legacyBadDay = { ...held, day: 18 };
const back = A.scanToModel(board(11), legacyBadDay).model;
assert.equal(back.day, 18); assert.ok(back.dayProbe);
const backConfirmed = A.scanToModel(board(11), back).model;
assert.equal(backConfirmed.day, 11); assert.equal(backConfirmed.toolsConfirmed.tools, 'blacklist,coin');
assert.equal(A.resultKey(held, 1600), A.resultKey({ ...held, dayProbe: { day: 18, maxDays: 20 }, boardSeen: false, runToken: 'another-token' }, 1600), 'Read-verification metadata fragmented exact Monte Carlo inputs');
const engineBack = A.buildState(backConfirmed).st;
assert.equal(A.modelFrom(engineBack, legacyBadDay).toolsConfirmed.tools, 'blacklist,coin', 'Rebuilding a corrected day forgot confirmation');
console.log('PASS: the actual 10→18→11 incident preserves the confirmed Blacklist; suspect days block advice, repeated readings recover forwards/backwards, epoch resets remain explicit and verification metadata cannot change cache keys.');
