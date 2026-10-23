/* Exact parity with the former sorted-coordinate quantiles, including UI scales. */
'use strict';
const assert = require('node:assert/strict'), S = require('../js/scan.js');
function sortedBox(img, k, u = img.height / 1080) {
  const top = img.height / 2 - 540 * u, c = img.width / 2 + k * 480 * u;
  const x0 = Math.max(0, Math.round(c - 85 * u)), x1 = Math.min(img.width - 1, Math.round(c + 85 * u));
  const y0 = Math.max(0, Math.round(top + 270 * u)), y1 = Math.min(img.height - 1, Math.round(top + 480 * u));
  const xs = [], ys = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const pixel = (y * img.width + x) * 4, [h, sat, v] = S.hsv(img.data[pixel], img.data[pixel + 1], img.data[pixel + 2]);
    if (v > 0.32 || (sat > 0.45 && v > 0.18 && !(h >= 15 && h <= 50))) { xs.push(x); ys.push(y); }
  }
  if (xs.length < 400 * u * u) return null;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (a, f) => a[Math.round(f * (a.length - 1))];
  return [q(xs, .01), q(ys, .01), q(xs, .99), q(ys, .99)];
}
let cases = 0, beforeMs = 0, afterMs = 0;
for (const [width, height] of [[1920,1080], [2560,1440], [3840,2160], [720,1280]]) {
  const img = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  let seed = 104;
  for (let i = 0; i < img.data.length; i += 4) { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; img.data[i]=seed & 255; img.data[i+1]=seed >>> 8 & 255; img.data[i+2]=seed >>> 16 & 255; img.data[i+3]=255; }
  for (const scale of [1, .98, .76, .64, .5]) for (const k of [-1,0,1]) {
    const u = height / 1080 * scale, start = performance.now(), expected = sortedBox(img,k,u), middle = performance.now(), actual = S.pickArtBox(img,k,u), end = performance.now();
    assert.deepEqual(actual, expected, `${width}x${height} k=${k} scale=${scale}`);
    beforeMs += middle-start; afterMs += end-middle; cases++;
  }
  img.data.fill(0);
  for (const k of [-1,0,1]) { assert.equal(S.pickArtBox(img,k), null); cases++; }
}
console.log(`PASS: ${cases} exact art boxes at 1080p/1440p/4K/portrait, five UI scales, empty/partially off-screen cards. Synthetic box benchmark: sorted=${Math.round(beforeMs)}ms histogram=${Math.round(afterMs)}ms (${(beforeMs/afterMs).toFixed(2)}x); not a whole-offer latency measurement.`);
