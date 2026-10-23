#!/usr/bin/env node
/* Check exact IEEE results, clipping, SIMD lane order and failure fallback.
 * Optional --frames DIR compares complete readings on private RGBA fixtures. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../js/scan.js');
const A = require('../js/scan-accelerator.js');
const ref = S.withPanelIcons(require('../js/scan-data.js'), require('../js/pick-data.js'));
const clean = (r) => { const copy = structuredClone(r); delete copy.ms; return copy; };
const median = (list) => list.sort((a, b) => a - b)[list.length >> 1];
(async () => {
  const kernel = A.create((await WebAssembly.instantiate(fs.readFileSync(path.join(__dirname, '../js/scan-kernels.wasm')))).instance);
  for (const [w, h] of [[1, 1], [2, 3], [73, 51], [97, 75], [640, 360]]) {
    const g = Float32Array.from({ length: w * h }, (_, i) => Math.sin(i * 17) * 130 + 120);
    for (const r of [0, 1, 3, 9, 70]) {
      S.setKernels(null); const expected = S.blur(g, w, h, r);
      S.setKernels(kernel); const actual = S.blur(g, w, h, r);
      assert.deepEqual(actual, expected, `blur ${w}x${h} radius ${r}`);
      const preserved = actual.slice();
      S.blur(g, w, h, 2);
      assert.deepEqual(actual, preserved, 'Kernel scratch memory changed a retained result');
    }
  }
  console.log('PASS: exact blur at 5 sizes/5 radii, clipped edges and retained output ownership.');
  for (const [w, h] of [[160, 100], [640, 360]]) for (const uniform of [false, true]) {
    const img = { width: w, height: h, data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => uniform ? 73 : i * 17 % 251) };
    S.setKernels(null);
    const gray = S.grayOf(img), prepared = S.prepareBoardSearch(img, gray, ref);
    const expected = S.coarseBoardSearch(prepared);
    S.setKernels(kernel);
    assert.deepEqual(S.coarseBoardSearch(prepared), expected, 'SIMD changed candidate scores/order');
    const shards = [];
    for (let part = 0; part < 4; part++) shards.push(...S.coarseBoardSearch(prepared, part, 4));
    assert.deepEqual(shards.sort((a, b) => a.order - b.order), expected, 'Sharding changed candidates');
  }
  console.log('PASS: every search candidate/score, clipped samples, tied winners and 4 shard results match JavaScript.');
  const input = Float32Array.of(1, 2, 3, 4);
  S.setKernels(null); const expected = S.blur(input, 2, 2, 1);
  S.setKernels({ blur() { throw new RangeError('Simulated memory limit'); } });
  assert.deepEqual(S.blur(input, 2, 2, 1), expected);
  assert.equal(S.kernelsReady(), false);
  for (const fetch of [async () => ({ ok: false }), async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })]) {
    const context = { fetch, AbortController, setTimeout, clearTimeout, WebAssembly, TartarusScan: { setKernels() { throw new Error('Invalid kernel installed'); } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/scan-accelerator.js'), 'utf8'), context);
    assert.equal(await context.TartarusScanAccelerator.load('scan-kernels.wasm'), false);
  }
  console.log('PASS: missing/corrupt WASM and memory-limit fallback keep JavaScript reading available.');
  const at = process.argv.indexOf('--frames');
  if (at >= 0) {
    const folder = path.resolve(process.argv[at + 1]);
    for (const file of fs.readdirSync(folder).filter((n) => n.endsWith('.rgba'))) {
      const img = { ...JSON.parse(fs.readFileSync(path.join(folder, file.replace(/\.rgba$/, '.json')))), data: new Uint8ClampedArray(fs.readFileSync(path.join(folder, file))) };
      const times = { js: [], wasm: [] }; let oracle;
      for (let i = 0; i < 4; i++) for (const label of i % 2 ? ['js', 'wasm'] : ['wasm', 'js']) {
        S.setKernels(label === 'js' ? null : kernel);
        const start = performance.now(), actual = S.scan(img, ref), elapsed = performance.now() - start;
        if (!oracle) oracle = clean(actual);
        else assert.deepEqual(clean(actual), oracle, `Complete reading changed for ${file}`);
        if (i) times[label].push(elapsed);
      }
      console.log(`PASS: exact full reading ${file}: JS ${median(times.js).toFixed(0)} ms; WASM ${median(times.wasm).toFixed(0)} ms.`);
    }
  }
  S.setKernels(null);
})().catch((error) => { console.error(error); process.exitCode = 1; });
