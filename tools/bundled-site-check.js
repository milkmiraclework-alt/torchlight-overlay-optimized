#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { create } = require('../desktop/lib/bundled-site.js');
(async () => {
  const root = path.resolve(__dirname, '../desktop/dist/bundled-site');
  const sentinel = require('node:http').createServer((req, res) => res.end('UNRELATED SERVER'));
  await new Promise((resolve) => sentinel.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${sentinel.address().port}`;
  const site = create(root, origin), url = origin + '/';
  const request = (name, options) => site.handle(new Request(url + name, options));
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  try {
    const html = await (await request('analyze.html')).text();
    assert.ok(html.includes('TARTARUS_BUNDLED_OCR'));
    assert.ok(!html.includes('fonts.googleapis.com'));
    for (const name of ['js/scan-kernels.wasm', 'js/solver-core.wasm', 'vendor/ocr/data/eng.traineddata.gz', 'desktop/lib/settings.js']) {
      const response = await request(name);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha(bytes), site.manifest.files[name]);
      if (name.endsWith('.wasm')) assert.equal(response.headers.get('content-type'), 'application/wasm');
    }
    const head = await request('analyze.html', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await request('', { method: 'POST' })).status, 405);
    for (const name of ['desktop/main.js', 'tools/stage-overlay.js', '.env', 'local/settings.json', '..%5cpackage.json', '%2e%2e%2fpackage.json']) {
      assert.equal((await request(name)).status, 404, name + ' was served');
    }
    assert.equal((await site.handle(new Request('http://other.example/analyze.html'))).status, 404);
    assert.equal(await (await fetch(url)).text(), 'UNRELATED SERVER', 'The unrelated listener was changed');
    assert.equal((await request('analyze.html')).status, 200, 'An occupied port prevented internal asset reads');
    for (const name of ['js/live.js', 'js/report.js', 'js/update.js', 'js/canvas-ui.js', 'js/ui.js', 'js/guide-data.js']) {
      assert.equal((await request(name)).status, 404, 'Unused web feature still bundled: ' + name);
    }
    console.log('PASS: bundled analyzer/OCR/WASM hashes and MIME types; only packaged assets served, HEAD/POST handling, traversal/origin rejection, and independence from an occupied port.');
  } finally { sentinel.closeAllConnections(); await new Promise((resolve) => sentinel.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
