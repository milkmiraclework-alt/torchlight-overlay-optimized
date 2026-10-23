#!/usr/bin/env node
/* Actual solver-worker script + actual WASM, without Electron/game input. */
'use strict';
const assert = require('node:assert/strict'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const { setTimeout: pause } = require('node:timers/promises');
const T = require('../js/engine'), S = require('../js/solver');
const worker = new Worker(`
  const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  globalThis.self=globalThis;self.location={search:'',href:'http://localhost/js/solver-worker.js'};
  self.postMessage=(m)=>parentPort.postMessage(m);
  globalThis.fetch=async(url)=>{await new Promise(r=>setTimeout(r,100));return new Response(fs.readFileSync(path.join(workerData,path.basename(new URL(url).pathname))),{status:200})};
  self.importScripts=(...names)=>{for(const name of names)vm.runInThisContext(fs.readFileSync(path.join(workerData,name.split('?')[0]),'utf8'),{filename:name})};
  importScripts('solver-worker.js');parentPort.on('message',data=>{if(data.breakRust){self.TartarusRust.load=async()=>({request(){throw new Error('Injected Rust initialization rejection')}});return}self.onmessage({data})});
`, { eval: true, workerData: path.resolve(__dirname, '../js') });
const messages = [];
let failure = null;
worker.on('message', (m) => messages.push(m)); worker.on('error', (error) => { failure = error; });
async function complete(id) {
  for (let i = 0; i < 3000; i++) { if (failure) throw failure; if (messages.some((m) => m.id === id && m.done)) return messages.filter((m) => m.id === id); await pause(10); }
  throw new Error('Rust worker timed out: ' + id);
}
function compare(chunks, st, rollouts, seed, stream = 0, backend = 'rust') {
  assert.ok(chunks.every((m) => m.backend === backend), 'Worker used an unexpected backend');
  const rows = chunks[0].meta.map((m) => ({ ...m, vals: [], pass: 0, points: 0, best: 0 }));
  for (const chunk of chunks) chunk.rows.forEach((row, i) => { rows[i].vals.push(...row.vals); rows[i].best = row.best; });
  const job = S.solve(st, { rollouts, seed, stream }); let result; do { result = job.step(60, true); } while (!result.done);
  assert.deepEqual(rows, job.rows);
}
(async () => {
  const st = T.newGame({ seed: 'COLD-RUST-PAUSE', params: { rewards: false } }); st.pending = [];
  worker.postMessage({ id: 101, state: st, rollouts: 24, raw: true, background: true });
  worker.postMessage({ id: 101, pause: true });
  await pause(300); assert.equal(messages.length, 0, 'Cold initialization ignored pause');
  worker.postMessage({ from: 101, id: 102, promote: true });
  compare(await complete(102), st, 24, (101 * 7919 + 1) >>> 0);
  console.log('PASS: actual Rust worker, cold-start pause/promotion, exact full-budget raw samples and unchanged original seed.');
  worker.postMessage({ id: 201, state: st, rollouts: 10000, raw: true });
  worker.postMessage({ id: 202, state: st, rollouts: 24, stream: 3, raw: true });
  const done = await complete(202);
  compare(done, st, 24, (202 * 7919 + 1) >>> 0, 3);
  const before = messages.filter((m) => m.id === 201).length;
  await pause(100); assert.equal(messages.filter((m) => m.id === 201).length, before, 'Replaced job continued sending samples');
  worker.postMessage({ id: 202, cancel: true });
  console.log('PASS: replacement/cancellation, independent worker stream, no leaked results from the obsolete job.');
  worker.postMessage({ breakRust: true });
  const fallback = S.clone(st); fallback.maxDays = 2;
  worker.postMessage({ id: 301, state: fallback, rollouts: 8, stream: 1, raw: true });
  compare(await complete(301), fallback, 8, (301 * 7919 + 1) >>> 0, 1, 'javascript');
  console.log('PASS: injected Rust initialization failure recovers with the exact JS stream and complete requested budget.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => worker.terminate());
