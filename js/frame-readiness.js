/* Readiness evidence: a changed board, visible controls and stable fresh frames. */
(function (root) {
  'use strict';
  function sampleBoxes(img, loc, S) {
    const corners = [[0, 0], [5, 0], [0, 3], [5, 3]].map(([u, v]) => S.at(loc, u, v));
    const left = Math.min(...corners.map((p) => p[0])) - 40 * loc.s;
    const right = Math.max(...corners.map((p) => p[0])) + 40 * loc.s;
    const top = Math.min(...corners.map((p) => p[1])) - 80 * loc.s;
    const bottom = Math.max(...corners.map((p) => p[1])) + 30 * loc.s;
    return [[left, top, right, bottom], [left, bottom, right, img.height - 1]];
  }
  function samplePoints(img, loc, S, take) {
    const boxes = sampleBoxes(img, loc, S);
    let i = 0;
    for (const box of boxes) for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
      const px = Math.max(0, Math.min(img.width - 1, Math.round(box[0] + (box[2] - box[0]) * (x + 0.5) / 32)));
      const py = Math.max(0, Math.min(img.height - 1, Math.round(box[1] + (box[3] - box[1]) * (y + 0.5) / 24)));
      take(i++, px, py);
    }
  }
  function sample(img, loc, S) {
    const out = new Uint8Array(1536);
    samplePoints(img, loc, S, (i, x, y) => {
      const offset = (y * img.width + x) * 4;
      out[i] = Math.round(0.299 * img.data[offset] + 0.587 * img.data[offset + 1] + 0.114 * img.data[offset + 2]);
    });
    return out;
  }
  // Odd integer strides put every destination pixel exactly on a source-pixel
  // centre. Two nearest-neighbour GPU draws then match the CPU sampler even
  // at fractional board scales, without thousands of per-pixel draw commands.
  function fastGrid(img, loc, S) {
    return sampleBoxes(img, loc, S).map(([x0, y0, x1, y1]) => {
      const odd = n => { const step = Math.max(1, Math.floor(n)); return step % 2 ? step : step - 1; };
      const dx = odd((x1 - x0) / 32), dy = odd((y1 - y0) / 24);
      return { x: Math.round((x0 + x1 - dx * 32) / 2), y: Math.round((y0 + y1 - dy * 24) / 2), dx, dy };
    });
  }
  function sampleFast(img, loc, S) {
    const out = new Uint8Array(1536); let i = 0;
    for (const grid of fastGrid(img, loc, S)) for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
      const px = Math.max(0, Math.min(img.width - 1, grid.x + x * grid.dx + (grid.dx - 1) / 2));
      const py = Math.max(0, Math.min(img.height - 1, grid.y + y * grid.dy + (grid.dy - 1) / 2));
      const offset = (py * img.width + px) * 4;
      out[i++] = Math.round(0.299 * img.data[offset] + 0.587 * img.data[offset + 1] + 0.114 * img.data[offset + 2]);
    }
    return out;
  }
  // Copy exactly the same source pixels into a tiny surface. The first two
  // stability observations need 6 KiB of RGBA, not the entire game window.
  function sampleBitmap(bitmap, loc, S, context) {
    const grids = fastGrid(bitmap, loc, S);
    if (grids.some(g => g.x < 0 || g.y < 0 || g.x + g.dx * 32 > bitmap.width || g.y + g.dy * 24 > bitmap.height)) return null;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, 32, 48);
    grids.forEach((g, i) => context.drawImage(bitmap, g.x, g.y, g.dx * 32, g.dy * 24, 0, i * 24, 32, 24));
    const pixels = context.getImageData(0, 0, 32, 48).data, out = new Uint8Array(1536);
    for (let i = 0; i < out.length; i++) {
      const offset = i * 4;
      out[i] = Math.round(0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]);
    }
    return out;
  }
  function difference(a, b) {
    if (!a || !b || a.length !== b.length) return { changed: 1, mean: 255 };
    let changed = 0, sum = 0;
    for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); sum += delta; if (delta >= 12) changed++; }
    return { changed: changed / a.length, mean: sum / a.length };
  }
  function controlsFor(result) {
    if (!result.warden || result.warden.conf < 0.8 || !result.cells || result.cells.some((cell) => cell.kind === 'inmate' && (cell.conf < 0.6 || cell.ghost))) return '';
    let menu = '';
    if (result.doors && result.doors.conf >= 0.85) menu = 'doors:' + result.doors.cells.slice().sort((a, b) => a - b).join(',');
    else if (result.decision && result.decision.title && (result.decision.consume || result.decision.replace || result.decision.end || result.decision.office || result.decision.hunt)) {
      const decision = result.warden.cell === 0 && !result.decision.ratway ? { ...result.decision, consume: false, replace: false, end: false, office: true } : result.decision;
      menu = 'decision:' + ['consume', 'replace', 'end', 'office', 'ratway', 'hunt'].map((key) => !!decision[key]).join(',') + '|' + JSON.stringify({ instigate: decision.instigate, bestow: decision.bestow, framed: decision.framed });
    }
    if (!menu) return '';
    return menu + '|' + JSON.stringify({ warden: result.warden.cell, cells: result.cells.map((cell) => [cell.kind, cell.beast, cell.tier, !!cell.nest, !!cell.jaws, !!cell.event, !!cell.prey]) });
  }
  function create({ visualOnly = false, semanticOnly = false } = {}) {
    let calibration = null, generation = null, previous = null, stableAt = 0, count = 0;
    function reset() { previous = null; stableAt = 0; count = 0; }
    return {
      calibrate(value) { calibration = value; generation = null; reset(); },
      get calibration() { return calibration; },
      observe({ epoch, time, sample, controls, valid, fresh = true }) {
        if (generation !== epoch) { generation = epoch; reset(); }
        if (!calibration || !valid || (!visualOnly && (!controls || controls === calibration.controls)) || !fresh || (!semanticOnly && difference(calibration.sample, sample).changed < 0.01)) { reset(); return false; }
        const delta = previous && !semanticOnly && difference(previous.sample, sample);
        if (!previous || (!visualOnly && controls !== previous.controls) || (!semanticOnly && (delta.changed > 0.004 || delta.mean > 1))) { stableAt = time; count = 1; }
        else count++;
        previous = { sample, controls };
        return count >= 3 && time - stableAt >= 200;
      },
    };
  }
  const api = { create, sample, sampleFast, sampleBitmap, difference, controlsFor };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusFrameReadiness = api;
})(typeof self !== 'undefined' ? self : globalThis);
