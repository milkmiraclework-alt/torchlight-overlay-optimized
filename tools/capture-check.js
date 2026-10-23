#!/usr/bin/env node
/* Log-reader races, partial lines, bounded reads and watcher cleanup. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setTimeout: pause } = require('node:timers/promises');
const window = { addEventListener() {}, TartarusDesktop: { fast: true } };
let clock = 0, fakeTimers = false;
const timers = [];
const storage = { getItem: () => JSON.stringify({ enabled: true, consent: 4 }) };
let displayResolve;
vm.runInNewContext(fs.readFileSync(require.resolve('../js/capture.js'), 'utf8'), {
  window, localStorage: storage, navigator: { mediaDevices: { getDisplayMedia: () => new Promise((resolve) => { displayResolve = resolve; }) } }, console, TextDecoder, DOMException,
  ImageCapture: class { constructor(track) { this.track = track; } },
  setInterval: () => 1, clearInterval() {},
  setTimeout(fn, delay) { if (!fakeTimers) return setTimeout(fn, delay); const timer = { fake: true, fn, delay }; timers.push(timer); return timer; },
  clearTimeout(timer) { if (timer && timer.fake) timer.cleared = true; else clearTimeout(timer); },
  performance: { now: () => clock }, queueMicrotask,
});
const C = window.TartarusCapture;
let text = '', wake, stopped = false, release;
let blockRead = false;
const reads = [];
const handle = {
  name: 'UE_game.log',
  watch(fn) { wake = fn; return () => { stopped = true; }; },
  async getFile() {
    const size = Buffer.byteLength(text);
    return { name: this.name, size, slice(start, end) { return { async arrayBuffer() {
      reads.push(end - start);
      if (blockRead) { blockRead = false; await new Promise((resolve) => { release = resolve; }); }
      const bytes = Buffer.from(text).subarray(start, end);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    } }; } };
  },
};
async function until(test) { for (let i = 0; i < 100 && !test(); i++) await pause(5); assert.ok(test()); }
(async () => {
  C.setWatch('S16');
  C.useHandle(handle);
  await until(() => C.state.log === 'on');
  text = 'TLLua: S16First'; blockRead = true; wake();
  await until(() => !!release);
  text += '\nTLLua: S16Second\n'; wake(); release();
  await until(() => C.state.lines === 2);
  console.log('PASS: wakeup during an active read is drained immediately; partial lines survive.');
  text += 'x'.repeat(2 * 1024 * 1024) + '\nTLLua: S16Newest\n'; wake();
  await until(() => reads.length >= 3);
  assert.ok(reads.every((size) => size <= 1024 * 1024));
  await pause(10);
  text = 'TLLua: S16Rotated\n'; wake();
  await until(() => C.state.lines >= 5);
  const linesBeforeStop = C.state.lines;
  text += 'TLLua: S16Delayed\n'; blockRead = true; release = null; wake();
  await until(() => !!release);
  C.stopLog();
  release(); await pause(20);
  assert.ok(stopped);
  assert.equal(C.state.log, 'off');
  assert.equal(C.state.lines, linesBeforeStop, 'a stopped reader published stale data');
  console.log('PASS: bounded catchup, rotated logs and native-listener cleanup.');
  fakeTimers = true; text = ''; C.useHandle(handle);
  await until(() => C.state.log === 'on');
  C.setRules([{kind:'board',pattern:'S16Long',settle:2500},{kind:'board',pattern:'S16Short',settle:1500}]);
  text += 'TLLua: S16Long\n'; wake(); await until(() => timers.length === 1);
  clock = 1000; text += 'TLLua: S16Short\n'; wake(); await until(() => timers.length === 2);
  assert.equal(timers[0].delay,2500);
  assert.equal(timers[1].delay,1500); // deadline 2500, rather than 3500
  assert.ok(timers[0].cleared);
  C.stopLog(); assert.ok(timers[1].cleared);
  console.log('PASS: overlapping events keep every animation wait but avoid stacking delays; stop cancels pending capture.');
  function stream() {
    const track = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ displaySurface: 'window' }), addEventListener(kind, fn) { this.ended = fn; } };
    return { track, getVideoTracks: () => [track], getTracks: () => [track] };
  }
  const late = stream(), pending = C.connectWindow();
  C.stopWindow(); displayResolve(late); await pending;
  assert.ok(late.track.stopped); assert.equal(C.state.window, 'off', 'An obsolete async connection resumed capture after leaving');
  const first = stream(), second = stream();
  C.useStream(first); C.useStream(second); first.track.ended();
  assert.equal(C.state.window, 'on', 'An old track ended the replacement stream');
  C.stopWindow(); assert.ok(first.track.stopped && second.track.stopped);
  // A board event can connect a previously suspended stream. Attaching it
  // during settling must preserve the very screenshot that woke capture.
  clock = 0; text = ''; C.useHandle(handle); await until(() => C.state.log === 'on');
  text += 'TLLua: S16Long\n'; wake(); await until(() => timers.length === 3);
  const waking = stream(), connecting = C.connectWindow(); displayResolve(waking); await connecting;
  assert.ok(!timers[2].cleared, 'First board event was dropped while opening capture');
  C.stopWindow(); C.stopLog(); assert.ok(timers[2].cleared && waking.track.stopped);
  console.log('PASS: late async streams stop, obsolete track events are ignored, reconnect preserves the waking screenshot and stop releases capture.');
  const frames = []; C.on('frame', (frame) => frames.push(frame));
  clock = 0; text = ''; C.useHandle(handle); await until(() => C.state.log === 'on');
  C.setRules([{ kind: 'treasure', pattern: 'S16GiftOpen', settle: 1500, rank: 3 }, { kind: 'board', pattern: 'S16GiftBoard', settle: 600, rank: 1 }]);
  text += 'TLLua: S16GiftOpen\n'; wake(); await until(() => C.state.hits === 1);
  const giftTimer = timers.at(-1);
  text += 'TLLua: S16GiftBoard\n'; wake(); await until(() => frames.length === 1);
  assert.equal(frames[0].kind, 'treasure'); assert.equal(frames[0].frame, null);
  assert.ok(giftTimer.cleared); assert.notEqual(timers.at(-1), giftTimer);
  assert.equal(timers.at(-1).delay, 600, 'The fast status view inherited the Treasure deadline');
  C.stopLog();
  console.log('PASS: a fast View Prison Status flushes the image-free Treasure and schedules its own board capture.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
