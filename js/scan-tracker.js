/* Cross-frame layout calibration and exact-pixel panel reuse. */
(function (root) {
  'use strict';
  function sameRegion(a, b, box) {
    if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
    const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(a.width - 1, Math.ceil(box[2])), y1 = Math.min(a.height - 1, Math.ceil(box[3]));
    if (x0 > x1 || y0 > y1) return false;
    for (let y = y0; y <= y1; y++) {
      const end = (y * a.width + x1 + 1) * 4;
      for (let i = (y * a.width + x0) * 4; i < end; i++) if (a.data[i] !== b.data[i]) return false;
    }
    return true;
  }
  function create(S) {
    let last = null, age = 0;
    const stats = { mode: 'full', panels: 0 };
    function locate(prepared, img) {
      stats.mode = 'full'; stats.panels = 0;
      if (!last || ++age >= 16 || Date.now() - last.calibratedAt >= 30000 || img.width !== last.img.width || img.height !== last.img.height) return null;
      const loc = last.result.loc, fit = S.scoreBoardAt(prepared, loc);
      if (fit.score < 0.82 || fit.quarters.some((score) => score < 0.68)) return null;
      // Even a small movement must trigger reacquisition if a neighbour
      // explains the new image better. Never propagate gradual drift.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (S.scoreBoardAt(prepared, { ...loc, tx: loc.tx + dx, ty: loc.ty + dy }).score > fit.score + 0.004) return null;
      }
      stats.mode = 'tracked';
      return { s: loc.s, tx: loc.tx, ty: loc.ty, score: fit.score };
    }
    function panels(img, loc) {
      const out = {};
      if (!last || ['s', 'tx', 'ty'].some((key) => loc[key] !== last.result.loc[key])) return out;
      const left = Math.min(S.at(loc, 0, 0)[0], S.at(loc, 0, 3)[0]) - 70 * loc.s;
      const right = Math.max(S.at(loc, 5, 0)[0], S.at(loc, 5, 3)[0]) + 60 * loc.s;
      const bottom = Math.max(S.at(loc, 0, 3)[1], S.at(loc, 5, 3)[1]) + 30 * loc.s;
      const top = Math.min(S.at(loc, 0, 0)[1], S.at(loc, 5, 0)[1]) - 95 * loc.s;
      if (!last.result.doors?.hidden?.length && sameRegion(img, last.img, [0, bottom - 4, img.width - 1, img.height - 1]) && sameRegion(img, last.img, [img.width * 0.2 - 4, 0, img.width * 0.8 + 4, top + 4])) {
        out.doors = last.result.doors; out.days = last.result.days; stats.panels++;
      }
      if (sameRegion(img, last.img, [0, 0, left + 4, img.height - 1])) { out.tools = last.result.tools; stats.panels++; }
      if (sameRegion(img, last.img, [right - 4, 0, img.width - 1, img.height - 1])) { out.chromatic = last.result.chromatic; stats.panels++; }
      return out;
    }
    function remember(img, result) {
      if (!result.ok || !result.loc || result.loc.byLabels || !result.warden) { last = null; age = 0; return; }
      const calibratedAt = stats.mode === 'tracked' && last ? last.calibratedAt : Date.now();
      if (stats.mode !== 'tracked') age = 0;
      last = { img, result, calibratedAt };
    }
    return { locate, panels, remember, reset: () => { last = null; age = 0; stats.mode = 'full'; stats.panels = 0; }, info: () => ({ ...stats }) };
  }
  const api = { create, sameRegion };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusScanTracker = api;
})(typeof self !== 'undefined' ? self : globalThis);
