#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['tools/scan-kernels.rs', 'tools/build-scan-kernels.ps1', 'js/scan-accelerator.js'];
const current = { wasmSha256: sha(fs.readFileSync(path.join(ROOT, 'js/scan-kernels.wasm'))),
  sources: Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'))])) };
const file = path.join(ROOT, 'js/scan-kernels.build.json');
if (process.argv.includes('--write')) fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
else require('node:assert/strict').deepEqual(JSON.parse(fs.readFileSync(file)), current, 'Reader kernel sources changed; rebuild with tools/build-scan-kernels.ps1');
module.exports = current;
