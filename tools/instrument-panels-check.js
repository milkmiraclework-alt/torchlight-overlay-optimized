/* Read-only checks against explicitly labelled, saved instrument panels. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
function readSamples(manifest) {
  return JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '')).map((row) => ({
    tools: row.tools, name: path.basename(row.file),
    url: `data:image/${path.extname(row.file).slice(1)};base64,${fs.readFileSync(row.file).toString('base64')}`,
  }));
}
async function browserPanels(labels) {
  for (const file of ['scan.js', 'scan-data.js', 'pick-data.js']) if (!window[{ 'scan.js': 'TartarusScan', 'scan-data.js': 'TARTARUS_SCAN', 'pick-data.js': 'TARTARUS_PICK' }[file]]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'js/' + file;
      script.onload = resolve; script.onerror = reject; document.head.append(script);
    });
  }
  const S = window.TartarusScan, ref = S.withPanelIcons(window.TARTARUS_SCAN, window.TARTARUS_PICK), results = [];
  for (const label of labels) {
    const bitmap = await createImageBitmap(await (await fetch(label.url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), start = performance.now();
    const loc = S.locateBoard(img, S.grayOf(img), ref);
    if (!loc || loc.score < 0.8) throw new Error('No confident prison layout: ' + label.name);
    const panel = S.readTools(img, loc, ref);
    const actual = panel.tools.map((t) => ({ sim: ref.toolNames[t.id]?.sim || t.id, conf: t.conf, margin: t.margin }));
    if (actual.length !== label.tools.length || actual.some((t, i) => t.sim !== label.tools[i] || t.conf < 0.9)) {
      throw new Error('Wrong or uncertain saved panel: ' + JSON.stringify({ name: label.name, expected: label.tools, actual }));
    }
    results.push({ name: label.name, expected: label.tools, actual, ms: Math.round(performance.now() - start) });
  }
  return results;
}
module.exports = { readSamples, browserPanels };
if (require.main === module) {
  const result = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'overlay-check.js'), '--instrument-panels', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status === null ? 1 : result.status;
}
