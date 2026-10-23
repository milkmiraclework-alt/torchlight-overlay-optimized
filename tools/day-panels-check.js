/* Labelled saved countdown pixels and the real packaged analyzer/Auto bridge. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function readSamples(manifest) {
  return JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '')).map(row => {
    const bytes = fs.readFileSync(row.file);
    return { name: path.basename(row.file), left: row.left, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      url: `data:image/${path.extname(row.file).slice(1)};base64,${bytes.toString('base64')}` };
  });
}
async function browserDays(labels, ocrOnly = false) {
  for (const file of ['scan.js', 'scan-data.js', 'pick-data.js']) if (!window[{ 'scan.js': 'TartarusScan', 'scan-data.js': 'TARTARUS_SCAN', 'pick-data.js': 'TARTARUS_PICK' }[file]]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'js/' + file;
      script.onload = resolve; script.onerror = reject; document.head.append(script);
    });
  }
  const S = window.TartarusScan, ref = S.withPanelIcons(window.TARTARUS_SCAN, window.TARTARUS_PICK), results = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  for (const label of labels) {
    const bitmap = await createImageBitmap(await (await fetch(label.url)).blob());
    for (const width of [1920, 2560, 3840]) {
      const canvas = new OffscreenCanvas(width, Math.round(bitmap.height * width / bitmap.width)), ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height), start = performance.now();
      const gray = S.grayOf(img), loc = S.locateBoard(img, gray, ref);
      check(loc && loc.score >= 0.8, 'No confident saved board: ' + label.name + ' at ' + width);
      const read = S.readDays(img, S.blur(gray, img.width, img.height, 1), loc, ref);
      check(read?.days === label.left, 'Wrong saved countdown: ' + JSON.stringify({ name: label.name, width, expected: label.left, read, found: S.dayNumber(img, loc) }));
      results.push({ name: label.name, sha256: label.sha256, width, height: canvas.height, expectedLeft: label.left, actual: read, ms: Math.round(performance.now() - start) });
    }
    bitmap.close();
  }
  if (ocrOnly) return { pixels: results, logContext: false };
  const A = window.TartarusAnalyzer, Auto = window.TartarusAuto, OriginalWorker = window.Worker;
  let injectedDay = null;
  window.Worker = class extends OriginalWorker {
    constructor(url, ...args) {
      super(url, ...args);
      if (String(url).includes('scan-worker.js')) this.addEventListener('message', ({ data }) => {
        if (!data.kind && data.result?.ok && injectedDay !== null) data.result.days = injectedDay === 'missing' ? null : { days: injectedDay, conf: 1 };
      });
    }
  };
  const saved = () => JSON.parse(localStorage.getItem('tartarus-sim:analyzer:v1')).model;
  const contexts = [];
  try {
    A.suspend(); // Recreate the actual reader with the controlled OCR hook.
    for (const [day, maxDays, wrongLeft] of [[10, 20, 2], [11, 20, 2], [1, 30, 19], [30, 30, 38], [20, 20, 'missing']]) {
      A.beginRun('day-check-' + day + '-' + maxDays); A.prepare(); injectedDay = wrongLeft;
      const bitmap = await createImageBitmap(await (await fetch(labels[0].url)).blob());
      let seen;
      // Real Auto -> readFrameDirect -> worker -> scanToModel -> useReading.
      // Disable calculation here: this checks day inputs rather than spends
      // simulations on a deliberately mismatched, synthetic log/frame pair.
      const ask = A.askCached; A.askCached = () => false;
      try { await Auto.receive({ kind: 'board', bitmap, dayClock: { day, maxDays } }, patch => { if (patch.read) seen = patch.read; }); }
      finally { A.askCached = ask; }
      check(seen?.ok && seen.day === day, 'Auto lost the frame-bound log day: ' + JSON.stringify(seen));
      const m = saved();
      check(m.day === day && m.maxDays === maxDays && !m.dayProbe, 'Wrong day reached packaged model: ' + JSON.stringify(m));
      check(A.readingSummary().includes('verified by the game log'), 'Missing independent day evidence in diagnostics');
      contexts.push({ day, maxDays, injectedCountdown: wrongLeft, actualDay: m.day });
    }
  } finally { window.Worker = OriginalWorker; A.suspend(); }
  return { pixels: results, logContext: contexts };
}
module.exports = { readSamples, browserDays };
