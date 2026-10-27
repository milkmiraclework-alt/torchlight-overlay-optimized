#!/usr/bin/env node
/* Assemble the standalone analyzer and offline OCR, using locked npm packages.
 * Never copy raw screenshots, machine profiles or the full source workspace. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'desktop/dist/bundled-site');
const DEPS = path.join(ROOT, 'desktop/node_modules');
const metadata = require('../desktop/package.json');
const rust = require('./rust-solver-manifest.js');
const reader = require('./scan-kernel-manifest.js');
const vorax = require('./vorax-manifest.js');
const nativeReader = require('./native-reader-manifest.js');
const assets = new Map();
function put(name, bytes) {
  if (name.includes('..') || path.isAbsolute(name)) throw new Error('Invalid bundled asset');
  assets.set(name, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
}
function file(from, to) { put(to, fs.readFileSync(from)); }
function tree(from, to, include = () => true) {
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    const name = path.join(from, item.name), target = `${to}/${item.name}`;
    if (item.isDirectory()) tree(name, target, include);
    else if (include(item.name)) file(name, target);
  }
}
const ocr = { script: '/vendor/ocr/tesseract.min.js', worker: '/vendor/ocr/worker.min.js',
  core: '/vendor/ocr/core', language: '/vendor/ocr/data' };
let html = fs.readFileSync(path.join(ROOT, 'analyze.html'), 'utf8');
html = html.replace(/<link[^>]+https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/g, '');
html = html.replace('</head>', `<script>window.TARTARUS_BUNDLED_OCR=${JSON.stringify(ocr)};</script>\n</head>`);
html = html.replace('</head>', '<style>#az-next,#az-do,#az-open-sim,.az-foot-links{display:none!important}</style>\n</head>');
// Navigation to optional web guides opens the author's public pages. The
// overlay, correction UI and simulation itself always stay in the bundle.
html = html.replace(/<nav class="az-nav"[\s\S]*?<\/nav>/, '')
  .replace(/<script src="js\/(?:live|report|update)\.js[^\"]*"><\/script>\s*/g, '')
  .replace(/<button\b[^>]*\bdata-report="[^\"]*"[^>]*>[\s\S]*?<\/button>/g, '');
put('analyze.html', html);
file(path.join(ROOT, 'css/style.css'), 'css/style.css');
// Only the overlay/correction dependencies; no web simulator, training UI,
// guide data, telemetry/report uploader or web update polling.
const scripts = ['engine.js', 'board.js', 'tool-combos.js', 'assessment-data.js', 'assessment.js', 'solver.js', 'capture.js', 'solver-cache.js',
  'solver-forecast.js', 'tips.js', 'analyze.js', 'auto.js', 'frame-readiness.js', 'ready-worker.js',
  'scan-data.js', 'pick-data.js', 'scan.js', 'scan-worker.js', 'scan-search-worker.js', 'scan-tracker.js',
  'scan-accelerator.js', 'scan-kernels.wasm', 'solver-worker.js', 'rust-solver.js', 'solver-core.wasm'];
for (const name of scripts) file(path.join(ROOT, 'js', name), `js/${name}`);
tree(path.join(ROOT, 'img'), 'img');
for (const name of ['settings.html', 'settings.js']) file(path.join(ROOT, 'desktop/lib', name), `desktop/lib/${name}`);
for (const name of ['tesseract.min.js', 'worker.min.js', 'tesseract.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt']) {
  file(path.join(DEPS, 'tesseract.js/dist', name), `vendor/ocr/${name}`);
}
// Keep both SIMD and scalar LSTM cores; these are the same OEM=1 models
// used by the existing Tesseract 5.1.1 reader, with no network fetch.
tree(path.join(DEPS, 'tesseract.js-core'), 'vendor/ocr/core', (name) => /^tesseract-core-(?:simd-)?lstm\.(?:wasm|wasm\.js)$/.test(name));
file(path.join(DEPS, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), 'vendor/ocr/data/eng.traineddata.gz');
file(path.join(DEPS, 'tesseract.js-core/LICENSE'), 'vendor/ocr/core/LICENSE.txt');
file(path.join(DEPS, 'tesseract.js/LICENSE.md'), 'vendor/ocr/LICENSE.txt');
file(path.join(DEPS, 'tesseract.js-core/LICENSE'), 'vendor/ocr/data/LICENSE.txt');
const packages = ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng'];
put('vendor/ocr/NOTICE.txt', packages.map((name) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(DEPS, name, 'package.json')));
  return `${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\nRepository: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url}\n`;
}).join('\n') + '\nTesseract English language data: https://github.com/naptha/tessdata\n' +
  'The embedded English LSTM model is distributed with the Tesseract data package.\n');
const sourceFiles = {};
function source(name) { sourceFiles[name] = createHash('sha256').update(fs.readFileSync(path.join(ROOT, name))).digest('hex'); }
for (const name of ['desktop/main.js', 'desktop/preload.js', 'desktop/package.json', 'desktop/package-lock.json',
  'desktop/build/icon.png', 'analyze.html', 'css/style.css', 'tools/stage-overlay.js']) source(name);
for (const name of Object.keys(rust.sources)) source(name);
for (const name of Object.keys(reader.sources)) source(name);
for (const name of Object.keys(vorax.sources)) source(name);
for (const name of Object.keys(nativeReader.sources)) source(name);
for (const name of ['desktop/native/tartarus-reader.dll', 'desktop/native/tartarus-reader.build.json']) source(name);
for (const name of ['desktop/native/vorax-backend.exe','desktop/native/vorax-build.json','desktop/native/VORAX-LICENSE.txt']) source(name);
source('js/solver-core.build.json');
for (const directory of ['js', 'img', 'desktop/lib']) {
  const visit = (folder) => { for (const entry of fs.readdirSync(path.join(ROOT, folder), { withFileTypes: true })) {
    const name = `${folder}/${entry.name}`; if (entry.isDirectory()) visit(name); else source(name);
  } }; visit(directory);
}
const manifest = { version: metadata.version, ocr, sourceFiles, files: Object.fromEntries([...assets].sort(([a], [b]) => a.localeCompare(b))
  .map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])) };
// A fresh staging directory prevents removed assets from leaking into a
// later installer. Resolve and check the fixed target before deleting it.
if (path.resolve(OUT) !== path.join(ROOT, 'desktop', 'dist', 'bundled-site')) throw new Error('Unsafe staging target');
fs.rmSync(OUT, { recursive: true, force: true });
for (const [name, bytes] of assets) {
  const dest = path.join(OUT, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
}
fs.writeFileSync(path.join(OUT, 'bundle.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Staged ${assets.size} analyzer/OCR assets (${[...assets.values()].reduce((sum, b) => sum + b.length, 0)} bytes), ${metadata.version}.`);
