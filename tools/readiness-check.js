#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setTimeout: pause } = require('node:timers/promises');
const R = require('../js/frame-readiness.js');
const tracker = require('../js/scan-tracker.js');
const baseline = new Uint8Array(1536).fill(50), changed = new Uint8Array(1536).fill(100);
const detector = R.create();
const observation = (time, extra = {}) => ({ epoch: 1, time, sample: changed, controls: 'doors:1,3,4', valid: true, ...extra });
assert.equal(detector.observe(observation(0)), false);
detector.calibrate({ sample: baseline, controls: 'previous' });
for (const time of [0, 100, 300]) assert.equal(detector.observe(observation(time, { controls: 'previous' })), false, 'hover/glow changes on the old board became ready');
for (const time of [0, 100, 300, 500]) assert.equal(detector.observe(observation(time, { sample: baseline })), false, 'old unchanged board became ready');
for (const time of [0, 100, 300]) assert.equal(detector.observe(observation(time, { controls: '' })), false, 'stable animation without controls became ready');
assert.equal(detector.observe(observation(0)), false);
assert.equal(detector.observe(observation(100)), false);
assert.equal(detector.observe(observation(200)), true);
assert.equal(detector.observe(observation(300, { epoch: 2 })), false, 'new action reused earlier stability');
assert.equal(detector.observe(observation(400, { epoch: 2, controls: 'decision' })), false);
assert.equal(detector.observe(observation(500, { epoch: 2, controls: 'decision' })), false);
assert.equal(detector.observe(observation(600, { epoch: 2, controls: 'decision' })), true);
assert.equal(detector.observe(observation(700, { epoch: 2, controls: 'decision', fresh: false })), false);
assert.equal(detector.observe(observation(800, { epoch: 2, controls: 'decision' })), false);
const board = { warden: { cell: 1, conf: 1 }, cells: [{ kind: 'inmate', beast: 'rat', tier: 1, conf: 1 }], decision: { title: true, consume: true, red: 0.01 } };
assert.equal(R.controlsFor(board), R.controlsFor({ ...board, decision: { ...board.decision, red: 0.2 } }), 'hover color changed the semantic signature');
assert.notEqual(R.controlsFor(board), R.controlsFor({ ...board, warden: { cell: 2, conf: 1 } }));
assert.equal(R.controlsFor({ ...board, cells: [{ ...board.cells[0], ghost: true }] }), '');
const inOffice = { ...board, warden: { cell: 0, conf: 1 } };
assert.equal(R.controlsFor(inOffice), R.controlsFor({ ...inOffice, decision: { title: true, office: true, consume: false } }), 'office normalization differs between full and readiness readers');
const pixels = { width: 10, height: 10, data: new Uint8Array(400) }, other = { ...pixels, data: pixels.data.slice() };
assert.ok(tracker.sameRegion(pixels, other, [2, 2, 5, 5]));
other.data[0] = 1; assert.ok(tracker.sameRegion(pixels, other, [2, 2, 5, 5]));
other.data[(3 * 10 + 3) * 4] = 1; assert.ok(!tracker.sameRegion(pixels, other, [2, 2, 5, 5]));
const savedNow = Date.now;
let visionClock = 1000;
try {
  Date.now = () => visionClock;
  const tracking = tracker.create({ scoreBoardAt: () => ({ score: 0.95, quarters: [0.95, 0.95, 0.95, 0.95] }) });
  const result = { ok: true, loc: { s: 1, tx: 0, ty: 0 }, warden: { cell: 0 } };
  tracking.remember(pixels, result);
  for (let i = 0; i < 15; i++) assert.ok(tracking.locate({}, pixels));
  assert.equal(tracking.locate({}, pixels), null, 'calibration was never refreshed');
  tracking.remember(pixels, result); visionClock += 30000;
  assert.equal(tracking.locate({}, pixels), null, 'old calibration did not expire');
  tracking.remember(pixels, result);
  assert.equal(tracking.locate({}, { ...pixels, width: 9 }), null, 'size change retained calibration');
} finally { Date.now = savedNow; }
console.log('PASS: unchanged screens, missing controls, consecutive stability, action epochs, stale frames and exact panel regions.');
const visual = R.create({ visualOnly: true });
visual.calibrate({ sample: baseline, controls: 'old board' });
for (const time of [0, 100, 300]) assert.equal(visual.observe({ epoch: 1, time, sample: baseline, valid: true }), false);
assert.equal(visual.observe({ epoch: 1, time: 400, sample: changed, valid: true }), false);
assert.equal(visual.observe({ epoch: 1, time: 500, sample: changed, valid: true }), false);
assert.equal(visual.observe({ epoch: 1, time: 600, sample: changed, valid: true }), true);
assert.equal(visual.observe({ epoch: 2, time: 700, sample: changed, valid: true }), false);
assert.equal(visual.observe({ epoch: 2, time: 800, sample: changed, valid: true, fresh: false }), false);
const semantic = R.create({ semanticOnly: true });
semantic.calibrate({ controls: 'old board' });
for (const time of [0,100,300]) assert.equal(semantic.observe({ epoch: 1, time, valid: true, controls: 'old board' }), false);
assert.equal(semantic.observe({ epoch: 1, time: 400, valid: true, controls: 'new board' }), false);
assert.equal(semantic.observe({ epoch: 1, time: 500, valid: true, controls: 'new board' }), false);
assert.equal(semantic.observe({ epoch: 1, time: 600, valid: true, controls: 'new board' }), true);
assert.equal(semantic.observe({ epoch: 2, time: 700, valid: true, controls: 'new board' }), false);
assert.equal(semantic.observe({ epoch: 2, time: 800, valid: false, controls: '' }), false);
assert.equal(semantic.observe({ epoch: 2, time: 900, valid: true, controls: 'new board' }), false);
assert.equal(semantic.observe({ epoch: 2, time: 1000, valid: true, controls: 'different menu' }), false);
assert.equal(semantic.observe({ epoch: 2, time: 1100, valid: true, controls: 'different menu' }), false);
assert.equal(semantic.observe({ epoch: 2, time: 1200, valid: true, controls: 'different menu' }), true);

async function harness(callback, pace = 1) {
  let now = 0, next = 0, wake, text = '';
  const timers = [], frames = [], events = [];
  const window = { addEventListener() {}, TartarusDesktop: { fast: true } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/capture.js'), 'utf8'), {
    window, localStorage: { getItem: () => JSON.stringify({ enabled: true, consent: 4 }) }, navigator: {}, console, TextDecoder, DOMException, queueMicrotask,
    performance: { now: () => now }, setInterval: () => 1, clearInterval() {},
    setTimeout(fn, delay) { const timer = { fn, at: now + delay, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.active = false; },
    ImageCapture: class { async grabFrame() { const frame = { width: 160, height: 100, id: ++next, closed: false, close() { this.closed = true; } }; frames.push(frame); return frame; } },
  });
  const C = window.TartarusCapture;
  const flush = async () => { await pause(0); };
  C.setRules([{ kind: 'board', pattern: 'S16Act|Btn_S16Board_ActionCell', settle: 2500 }, { kind: 'board', pattern: 'UI_S16_Card_Up', settle: 1500 }, { kind: 'skip', pattern: 'S16Skip', settle: 0 }]);
  C.setPace(pace);
  C.useHandle({ name: 'UE_game.log', watch(fn) { wake = fn; return () => {}; }, async getFile() {
    return { size: Buffer.byteLength(text), slice(start, end) { return { async arrayBuffer() { const b = Buffer.from(text).subarray(start, end); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } }; } };
  } });
  await flush();
  C.useStream({ getVideoTracks: () => [{ readyState: 'live', getSettings: () => ({ displaySurface: 'window', width: 160, height: 100 }), addEventListener() {}, stop() {} }] });
  C.on('frame', (event) => events.push({ ...event, at: now }));
  C.setReadinessProbe(callback);
  async function hit(line = 'S16Act') { text += `TLLua: ${line}\n`; wake(); await flush(); }
  async function advance(target) {
    for (let guard = 0; guard < 200; guard++) {
      const due = timers.filter((timer) => timer.active && timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at; due.active = false; due.fn(); await flush();
      assert.ok(guard < 199, 'timer loop');
    }
    now = target; await flush();
  }
  return { C, hit, advance, frames, events, flush,
    delay: ms => new Promise(resolve => timers.push({ fn: resolve, at: now + ms, active: true })) };
}
(async () => {
  let calls = 0;
  let h = await harness(async () => ++calls >= 3);
  await h.hit(); await h.advance(149); assert.equal(h.frames.length, 0);
  await h.advance(500); assert.equal(h.events.length, 1); assert.equal(h.events[0].settle.mode, 'ready');
  assert.equal(h.events[0].at, 350);
  assert.ok(h.events[0].at < 2500); assert.ok(h.frames.slice(0, -1).every((frame) => frame.closed)); assert.ok(!h.events[0].frame.closed);
  await h.advance(3000); assert.equal(h.events.length, 1); h.C.stopLog(); h.C.stopWindow();
  calls = 0; h = await harness(async () => { calls++; await h.delay(180); return calls >= 3; });
  await h.hit(); await h.advance(689); assert.equal(h.events.length, 0);
  await h.advance(690); assert.equal(h.events.length, 1);
  assert.equal(h.events[0].at, 690, 'the probe duration stacked another 100ms wait after every recognition');
  h.C.stopLog(); h.C.stopWindow();
  h = await harness(async () => { throw new Error('Probe failed'); });
  await h.hit(); await h.advance(2499); assert.equal(h.events.length, 0); await h.advance(2500);
  assert.equal(h.events.length, 1); assert.equal(h.events[0].settle.mode, 'deadline'); h.C.stopLog(); h.C.stopWindow();
  calls = 0; h = await harness(async () => { calls++; return null; });
  await h.hit(); await h.advance(2500); assert.equal(calls, 1); assert.equal(h.events[0].settle.mode, 'deadline'); h.C.stopLog(); h.C.stopWindow();
  let resolve;
  h = await harness(() => new Promise((done) => { resolve = done; }));
  await h.hit(); await h.advance(450); await h.advance(2500); assert.equal(h.events.length, 1);
  resolve(true); await h.flush(); assert.equal(h.events.length, 1); assert.ok(h.frames[0].closed); h.C.stopLog(); h.C.stopWindow();
  h = await harness(() => new Promise((done) => { resolve = done; }));
  await h.hit(); await h.advance(450); await h.hit('S16Skip'); resolve(true); await h.flush(); await h.advance(3000);
  assert.equal(h.events.length, 0); assert.ok(h.frames[0].closed); h.C.stopLog(); h.C.stopWindow();
  h = await harness(() => new Promise((done) => { resolve = done; }));
  await h.hit(); await h.advance(450); h.C.stopLog(); resolve(true); await h.flush(); await h.advance(3000);
  assert.equal(h.events.length, 0); assert.ok(h.frames[0].closed); h.C.stopWindow();
  h = await harness(() => new Promise((done) => { resolve = done; }));
  await h.hit(); await h.advance(450); h.C.setReadinessProbe(null); resolve(true); await h.flush();
  assert.equal(h.events.length, 0); assert.ok(h.frames[0].closed);
  await h.advance(2500); assert.equal(h.events[0].settle.mode, 'deadline'); h.C.stopLog(); h.C.stopWindow();
  h = await harness(() => new Promise((done) => { resolve = done; }));
  await h.hit(); await h.advance(450); await h.advance(500); await h.hit(); resolve(true); await h.flush();
  assert.equal(h.events.length, 0); assert.ok(h.frames[0].closed);
  h.C.setReadinessProbe(async () => true); await h.advance(649); assert.equal(h.events.length, 0);
  await h.advance(650); assert.equal(h.events.length, 1); assert.equal(h.events[0].at, 650); h.C.stopLog(); h.C.stopWindow();
  calls = 0; h = await harness(async () => ++calls >= 3, 0.45);
  await h.hit('UI_S16_Card_Up'); await h.advance(74); assert.equal(h.frames.length, 0);
  await h.advance(275); assert.equal(h.events.length, 1); assert.equal(h.events[0].settle.mode, 'ready');
  assert.equal(h.events[0].at, 275, 'short Speed-up rule must use readiness instead of waiting 675 ms');
  h.C.stopLog(); h.C.stopWindow();
  const epochs = [], hits = [];
  h = await harness(async (_, meta) => { epochs.push(meta.epoch); return epochs.length >= 3; });
  h.C.on('hit', e => hits.push(e));
  await h.hit('Btn_S16Board_ActionCell'); await h.advance(200); await h.hit('UI_S16_Card_Up');
  await h.advance(350); assert.equal(h.events.length, 1);
  assert.equal(h.events[0].at, 350, 'presentation sound reset a pending action');
  assert.ok(epochs.every(epoch => epoch === epochs[0]));
  assert.equal(hits[1].continuation, true);
  await h.hit('UI_S16_Card_Up'); assert.equal(hits[2].continuation, false, 'next move without an explicit action was merged');
  h.C.stopLog(); h.C.stopWindow();
  console.log('PASS: early capture, deadline fallback, unavailable/failed probes, late replies, skip/stop cancellation and bitmap ownership.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
