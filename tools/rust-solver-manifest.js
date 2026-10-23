#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = ['js/engine.js', 'js/solver.js', 'js/tool-combos.js',
  'native/tartarus/Cargo.toml', 'native/tartarus/Cargo.lock', 'native/tartarus/data/policy.json',
  ...fs.readdirSync(path.join(ROOT, 'native/tartarus/src')).filter((x) => x.endsWith('.rs')).map((x) => 'native/tartarus/src/' + x)];
const current = { wasmSha256: sha(fs.readFileSync(path.join(ROOT, 'js/solver-core.wasm'))),
  sources: Object.fromEntries(files.map((file) => [file, sha(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'))])) };
const file = path.join(ROOT, 'js/solver-core.build.json');
if (process.argv.includes('--write')) fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
else require('node:assert/strict').deepEqual(JSON.parse(fs.readFileSync(file)), current, 'Rust solver sources changed; rebuild with tools/build-rust-solver.ps1');
module.exports = current;
