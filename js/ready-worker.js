/* A separate cheap screen probe never blocks a full board read. */
'use strict';
importScripts(`scan.js${self.location.search}`, `scan-data.js${self.location.search}`, `frame-readiness.js${self.location.search}`, `scan-tracker.js${self.location.search}`);
importScripts(`scan-accelerator.js${self.location.search}`);
const accelerationReady = self.TartarusScanAccelerator.load(`scan-kernels.wasm${self.location.search}`);
const detector = self.TartarusFrameReadiness.create({ visualOnly: true });
const semanticDetector = self.TartarusFrameReadiness.create({ semanticOnly: true });
let canvas = null, context = null, checkedEpoch = null, retryAt = 0, lastSample = null, semanticMode = false, menuCache = null;
// Keep this tiny target accelerated: a software target can read the entire
// GPU-backed game bitmap back for each individual source pixel.
const samples = new OffscreenCanvas(32, 48), sampleContext = samples.getContext('2d', { willReadFrequently: false });
self.onmessage = async ({ data }) => {
  if ('calibrate' in data) {
    const c = data.calibrate;
    detector.calibrate(c ? { ...c, sample: c.fastSample || c.sample } : null);
    semanticDetector.calibrate(c || null);
    checkedEpoch = null; retryAt = 0; lastSample = null; semanticMode = false; menuCache = null; return;
  }
  const { id, bitmap, epoch } = data;
  const started = performance.now();
  try {
    const S = self.TartarusScan, C = detector.calibration;
    if (!C || !C.controls || bitmap.width !== C.width || bitmap.height !== C.height) {
      self.postMessage({ id, ready: false, probe: { stage: 'unavailable', reason: !C ? 'uncalibrated' : !C.controls ? 'no-reference-controls' : 'size-changed' } }); return;
    }
    let img;
    const pixels = () => {
      if (!img) {
        if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          context = canvas.getContext('2d', { willReadFrequently: true });
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);
        img = context.getImageData(0, 0, canvas.width, canvas.height);
      }
      return img;
    };
    const sample = C.fastSample ? (self.TartarusFrameReadiness.sampleBitmap(bitmap, C.loc, S, sampleContext)
      || self.TartarusFrameReadiness.sampleFast(pixels(), C.loc, S)) : self.TartarusFrameReadiness.sample(pixels(), C.loc, S);
    const R = self.TartarusFrameReadiness;
    const stable = detector.observe({ epoch, time: performance.now(), valid: true, sample });
    if (checkedEpoch !== epoch) { checkedEpoch = epoch; retryAt = 0; lastSample = null; semanticMode = false; }
    const motion = lastSample && R.difference(lastSample, sample);
    const changed = R.difference(C.sample, sample).changed >= 0.01;
    // Ambient torches, fog and portrait glows need not stop moving. If a new
    // screen moves between probes, validate the actual game state repeatedly
    // instead of waiting forever for its background pixels to freeze.
    if (changed && motion && (motion.changed > 0.004 || motion.mean > 1)) semanticMode = true;
    lastSample = sample;
    if ((!stable && !semanticMode) || performance.now() < retryAt) {
      self.postMessage({ id, ready: false, probe: { stage: 'visual', reason: performance.now() < retryAt ? 'retry-controls' : changed ? 'collecting' : 'unchanged', ms: performance.now() - started } }); return;
    }
    // The unchanged/static path retains its two cheap observations. A moving
    // new screen needs three confident, identical semantic readings over 200ms.
    await accelerationReady;
    if (detector.calibration !== C) { self.postMessage({ id, ready: false }); return; }
    pixels();
    const gray = S.grayOf(img), sharp = S.blur(gray, img.width, img.height, 1);
    const prepared = S.prepareBoardSearch(img, gray, self.TARTARUS_SCAN, sharp, 1);
    const fit = S.scoreBoardAt(prepared, C.loc);
    let controls = '', board = null, doors = null, decision = null, reusedMenu = false;
    const valid = fit.score >= 0.82 && fit.quarters.every((score) => score >= 0.68);
    if (valid) {
      // Exact pixels, not a perceptual hash: reuse only the expensive menu
      // parsing when every byte that affected it is unchanged. Board, warden
      // and fit are read again on every semantic observation.
      if (menuCache && self.TartarusScanTracker.sameRegion(img, menuCache.img, menuCache.box)) {
        ({ doors, decision } = menuCache); reusedMenu = true;
      } else {
        const bottom = Math.max(S.at(C.loc, 0, 3)[1], S.at(C.loc, 5, 3)[1]) + 30 * C.loc.s;
        const bounds = { top: Math.floor(bottom) };
        doors = S.readDoors(img, sharp, C.loc, self.TARTARUS_SCAN);
        decision = doors && doors.conf >= 0.85 ? null : S.readDecision(img, C.loc, bounds);
        menuCache = { img, doors, decision, box: [0, Math.min(bottom, bounds.top) - 4, img.width - 1, img.height - 1] };
      }
      if (doors && doors.conf >= 0.85 || decision && decision.title) {
        board = S.readBoardCells(img, sharp, C.loc, self.TARTARUS_SCAN);
        controls = self.TartarusFrameReadiness.controlsFor({ ...board, doors, decision });
      }
    }
    const candidate = valid && !!controls && controls !== C.controls;
    const semanticStable = semanticDetector.observe({ epoch, time: performance.now(), valid: candidate, controls });
    const ready = candidate && (stable || semanticStable);
    if (!candidate) retryAt = performance.now() + 250;
    // The accepted bitmap is immutable. Hand its already-read controls
    // and cells to the final reader, rather than recognise them twice.
    const handoff = ready ? { width: img.width, height: img.height, loc: { ...C.loc, score: fit.score }, board, doors,
      days: S.readDays(img, sharp, C.loc, self.TARTARUS_SCAN), decision } : null;
    self.postMessage({ id, ready, prepared: handoff, probe: { stage: 'semantic', reason: ready ? stable ? 'ready-pixels' : 'ready-state' : !valid ? 'weak-fit' : !controls ? 'missing-controls' : !candidate ? 'same-controls' : 'state-consensus', reusedMenu, ms: performance.now() - started } });
  } catch (error) { self.postMessage({ id, ready: false, probe: { stage: 'error', error: String(error?.message || error) } }); }
  finally { bitmap.close(); }
};
