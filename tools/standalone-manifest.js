#!/usr/bin/env node
/* Verify packaged files against staged inputs and record distributable hashes. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const distAt = process.argv.indexOf('--dist');
const versioned = path.join(ROOT, 'desktop/dist/builds', require('../desktop/package.json').version);
const DIST = distAt < 0 ? (fs.existsSync(path.join(versioned, 'win-unpacked')) ? versioned : path.join(ROOT, 'desktop/dist')) : path.resolve(process.argv[distAt + 1]);
assert.ok(DIST.startsWith(path.join(ROOT, 'desktop/dist') + path.sep) || DIST === path.join(ROOT, 'desktop/dist'));
const { extractFile, listPackage } = require('../desktop/node_modules/@electron/asar');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const archive = path.join(DIST, 'win-unpacked/resources/app.asar');
const site = path.join(DIST, 'win-unpacked/resources/site');
const manifest = JSON.parse(fs.readFileSync(path.join(site, 'bundle.json')));
for (const [name, hash] of Object.entries(manifest.sourceFiles)) {
  assert.equal(sha(fs.readFileSync(path.join(ROOT, name))), hash, 'Source changed during build: ' + name);
}
for (const [name, hash] of Object.entries(manifest.files)) {
  assert.equal(sha(fs.readFileSync(path.join(site, name))), hash, 'Packaged asset mismatch: ' + name);
}
for (const name of ['main.js', 'preload.js', 'lib/bundled-site.js', 'lib/app-updates.js', 'lib/update-install.js', 'lib/update-install.ps1']) {
  assert.equal(sha(extractFile(archive, name)), manifest.sourceFiles['desktop/' + name], 'Wrong app source in ASAR: ' + name);
}
const pkg = JSON.parse(extractFile(archive, 'package.json'));
assert.equal(pkg.version, manifest.version);
assert.equal(pkg.name, 'torchlight-overlay-optimized');
const backend = JSON.parse(fs.readFileSync(path.join(DIST,'win-unpacked/resources/native/vorax-build.json')));
assert.equal(sha(fs.readFileSync(path.join(DIST,'win-unpacked/resources/native/vorax-backend.exe'))),backend.backendSha256,'Wrong Vorax backend');
assert.equal(backend.backendSha256,sha(fs.readFileSync(path.join(ROOT,'desktop/native/vorax-backend.exe'))));
const nativeReader = JSON.parse(fs.readFileSync(path.join(DIST,'win-unpacked/resources/native/tartarus-reader.build.json')));
assert.equal(sha(fs.readFileSync(path.join(DIST,'win-unpacked/resources/native/tartarus-reader.dll'))), nativeReader.librarySha256, 'Wrong native Tartarus reader');
assert.equal(nativeReader.librarySha256,sha(fs.readFileSync(path.join(ROOT,'desktop/native/tartarus-reader.dll'))));
for (const name of ['lib/native-reader.js','lib/native-reader-worker.js','lib/native-reader-kernels.js'])
  assert.equal(sha(extractFile(archive,name)), manifest.sourceFiles['desktop/'+name], 'Wrong native reader host: '+name);
for (const name of Object.keys(manifest.sourceFiles).filter(name=>name.startsWith('desktop/lib/arcana'))) {
  const packed=path.normalize(name.slice('desktop/'.length));
  assert.equal(sha(extractFile(archive,packed)),manifest.sourceFiles[name],'Wrong Arcana source in ASAR: '+packed);
}
const files = listPackage(archive).map((name) => name.replaceAll('\\', '/'));
assert.ok(files.some((name) => name.endsWith('/koffi/build/koffi/win32_x64/koffi.node')), 'Native Koffi missing');
assert.ok(fs.existsSync(archive + '.unpacked/node_modules/koffi/build/koffi/win32_x64/koffi.node'), 'Koffi native module must be unpacked');
const artifacts = (process.argv.includes('--unpacked-only') ? [] : fs.readdirSync(DIST).filter((name) => name.endsWith(`-${manifest.version}-x64.exe`))).map((file) => {
  const bytes = fs.readFileSync(path.join(DIST, file)); return { file, bytes: bytes.length, sha256: sha(bytes) };
});
const report = { version: manifest.version, architecture: 'x64', builtAt: new Date().toISOString(),
  electron: require('../desktop/node_modules/electron/package.json').version,
  appAsarSha256: sha(fs.readFileSync(archive)), wasmSha256: manifest.files['js/scan-kernels.wasm'],
  solverWasmSha256: manifest.files['js/solver-core.wasm'],
  sourceSha256: manifest.sourceFiles, assets: Object.keys(manifest.files).length, artifacts };
fs.writeFileSync(path.join(DIST, 'standalone-build.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(DIST, 'SHA256SUMS.txt'), artifacts.map((a) => `${a.sha256}  ${a.file}`).join('\n') + '\n');
console.log(`PASS: packaged sources, ${report.assets} assets, native libraries and ${artifacts.length} artifact hashes verified.`);
