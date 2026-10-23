/* Tartarus Simulator: screenshot reader worker.
 * Reads a screenshot off the page's thread with js/scan.js and its reference
 * data, so the page stays responsive while it works. A message with
 * kind 'pick' is the instrument pick at the start of a run, not a board. */
'use strict';

importScripts(`scan.js${self.location.search}`, `scan-data.js${self.location.search}`, `pick-data.js${self.location.search}`, `scan-tracker.js${self.location.search}`, `frame-readiness.js${self.location.search}`);
importScripts(`scan-accelerator.js${self.location.search}`);
const accelerationReady = self.TartarusScanAccelerator.load(`scan-kernels.wasm${self.location.search}`);
let trackingEnabled = false;
const tracker = self.TartarusScanTracker.create(self.TartarusScan);

let searchPool = null, searchFailed = false, searchEnabled = false, nextSearch = 0;
const pendingSearches = new Map();
function stopSearchPool(error) {
  searchFailed = true;
  if (searchPool) for (const worker of searchPool) worker.terminate();
  searchPool = null;
  for (const task of pendingSearches.values()) { clearTimeout(task.timer); task.reject(error); }
  pendingSearches.clear();
}
function prepareSearchPool() {
  if (searchFailed || !searchEnabled) return null;
  if (searchPool) return searchPool;
  const lanes = Math.min(4, Math.max(0, (self.navigator.hardwareConcurrency || 2) - 2));
  if (lanes < 2) return null;
  searchPool = [];
  try {
    for (let i = 0; i < lanes; i++) {
      const worker = new Worker(`scan-search-worker.js${self.location.search}`);
      searchPool.push(worker);
      worker.onmessage = ({ data }) => {
        const task = pendingSearches.get(data.id);
        if (!task) return;
        pendingSearches.delete(data.id);
        clearTimeout(task.timer);
        if (data.error) task.reject(new Error(data.error));
        else task.resolve(data.top || data.result);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        stopSearchPool(new Error('Parallel board search stopped.'));
      };
    }
  } catch (error) { stopSearchPool(error); }
  return searchPool;
}
function searchTask(worker, message) {
  return new Promise((resolve, reject) => {
    const id = ++nextSearch;
    const timer = setTimeout(() => stopSearchPool(new Error('Parallel board search timed out.')), 15000);
    pendingSearches.set(id, { resolve, reject, timer });
    try { worker.postMessage({ id, ...message }); }
    catch (error) { stopSearchPool(error); }
  });
}
async function scanBoard(img, ref, force = false, lang = 'en', fromProbe = null, detail = {}) {
  const pool = prepareSearchPool();
  const S = self.TartarusScan;
  if (!pool && !trackingEnabled) return S.scan(img, ref, { lang });
  const started = Date.now();
  const gray = S.grayOf(img), sharp = S.blur(gray, img.width, img.height, 1);
  let prepared = S.prepareBoardSearch(img, gray, ref, sharp, 1);
  let loc = trackingEnabled && !force ? tracker.locate(prepared, img) : null;
  // Only the exact accepted bitmap gets a handoff from the analyzer's
  // WeakMap. Different captures, 4K downscales and other languages reread.
  if (!force && lang === 'en' && fromProbe?.width === img.width && fromProbe?.height === img.height
      && fromProbe.board?.cells?.length === 16 && fromProbe.board.warden && fromProbe.loc?.score >= 0.82) {
    if (!loc) loc = fromProbe.loc;
    if (['s', 'tx', 'ty'].some((key) => loc[key] !== fromProbe.loc[key])) fromProbe = null;
  } else fromProbe = null;
  detail.fromProbe = !!fromProbe;
  if (!loc) {
    prepared = S.prepareBoardSearch(img, gray, ref, sharp);
    const sMin = Math.max(0.12, Math.min((0.3 * prepared.W) / prepared.bw, (0.35 * prepared.H) / prepared.bh));
    let minLevel = 0;
    while (minLevel + 1 < prepared.levels.length && sMin / prepared.levels[minLevel + 1].f >= 0.2) minLevel++;
    const compact = { ...prepared, levels: prepared.levels.map((level, i) => i < minLevel ? { ...level, g: null } : level) };
    let top;
    try {
      top = pool ? (await Promise.all(pool.map((worker, part) => searchTask(worker, { prepared: compact, part, parts: pool.length })))).flat() : S.coarseBoardSearch(prepared);
    } catch (error) {
      stopSearchPool(error);
      top = S.coarseBoardSearch(prepared);
    }
    loc = S.refineBoardSearch(prepared, top);
  }
  if (!loc || loc.score < 0.65) {
    const result = S.scanLocated(img, ref, gray, sharp, loc, started, null, { lang });
    if (trackingEnabled) tracker.remember(img, result);
    return result;
  }
  // Reuse the idle search workers for independent panels. Only doors/days
  // need grayscale; the tools and vault readers use the original RGBA.
  const reused = trackingEnabled && !force ? tracker.panels(img, loc) : {};
  if (fromProbe) { reused.doors = fromProbe.doors; reused.days = fromProbe.days; }
  if (lang !== 'en' || reused.doors?.hidden?.length) delete reused.doors;
  const board = lang !== 'en' ? S.readBoardCells(img, sharp, loc, ref) : null;
  const jobs = [0, 1, 2].filter((panel) => !Object.prototype.hasOwnProperty.call(reused, panel === 0 ? 'doors' : panel === 1 ? 'tools' : 'chromatic'));
  const readPanel = (panel) => panel === 0 ? { doors: S.readDoors(img, sharp, loc, ref, lang !== 'en', board?.cells), days: S.readDays(img, sharp, loc, ref) }
    : panel === 1 ? { tools: S.readTools(img, loc, ref) } : { chromatic: S.readChromatic(img, loc) };
  const panelsTask = Promise.all(jobs.map((panel) => searchPool ? searchTask(pool[panel % pool.length], { panel, img, loc, ...(panel === 0 ? { sharp, lang, cells: board?.cells } : {}) }) : readPanel(panel)))
    .then((results) => Object.assign({}, reused, ...results), (error) => { stopSearchPool(error); return null; });
  const actualBoard = board || fromProbe?.board || S.readBoardCells(img, sharp, loc, ref);
  const panels = await panelsTask;
  // Hidden English card numbers now depend on which board cells are lit.
  // Keep the common panel work parallel; retry only the occluded-door case
  // against this frame's freshly read cells, never cached board lighting.
  if (lang === 'en' && panels?.doors?.hidden?.length) panels.doors = S.readDoors(img, sharp, loc, ref, false, actualBoard.cells);
  const result = S.scanLocated(img, ref, gray, sharp, loc, started, { board: actualBoard, panels, ...(fromProbe ? { decision: fromProbe.decision } : {}) }, { lang });
  if (trackingEnabled && !force && tracker.info().mode === 'tracked' && (!result.ok || !result.warden || result.cells.some((cell) => cell.conf < 0.2))) {
    tracker.reset();
    return scanBoard(img, ref, true, lang, null, detail);
  }
  if (trackingEnabled) tracker.remember(img, result);
  return result;
}

self.onmessage = async (e) => {
  if (e.data.configure) {
    searchEnabled = !!e.data.configure.parallel;
    trackingEnabled = !!e.data.configure.tracking;
    tracker.reset();
    prepareSearchPool();
    return;
  }
  const { id, kind, width, height, buffer, bitmap, lang = 'en' } = e.data;
  try {
    await accelerationReady;
    let canvas;
    let img;
    if (bitmap) {
      const scale = Math.min(1, 2600 / bitmap.width);
      canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      try { ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); }
      finally { bitmap.close(); }
      img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else img = { width, height, data: new Uint8ClampedArray(buffer) };
    if (kind === 'objective') {
      self.postMessage({ id, kind, result: self.TartarusScan.readObjectiveTitle(img) });
      return;
    }
    if (kind === 'pick') {
      self.postMessage({ id, kind, result: self.TartarusScan.scanPick(img, self.TARTARUS_SCAN, self.TARTARUS_PICK) });
      return;
    }
    // Instruments' panel icons from labeled live screenshots ride along.
    const ref = self.TartarusScan.withPanelIcons(self.TARTARUS_SCAN, self.TARTARUS_PICK);
    const detail = {};
    const result = await scanBoard(img, ref, false, lang, e.data.prepared, detail);
    // The instruments' names and their simulator tools ride along.
    if (result.tools && result.tools.tools) {
      for (const t of result.tools.tools) {
        Object.assign(t, ref.toolNames[t.id] || {});
        for (const alt of t.alts || []) alt.sim = ref.toolNames[alt.id]?.sim;
      }
      result.tools.sims = [...new Set(ref.tools.map((r) => ref.toolNames[r.id]?.sim).filter(Boolean))];
    }
    // Transfer the original preview back for manual correction/reporting.
    // No RGBA copy or PNG encode is needed on the page's main thread.
    const preview = canvas ? canvas.transferToImageBitmap() : null;
    const calibration = trackingEnabled && result.ok && result.warden && !result.loc.byLabels
      ? { loc: result.loc, width: img.width, height: img.height, sample: self.TartarusFrameReadiness.sample(img, result.loc, self.TartarusScan), fastSample: self.TartarusFrameReadiness.sampleFast(img, result.loc, self.TartarusScan), controls: self.TartarusFrameReadiness.controlsFor(result) } : null;
    self.postMessage({ id, result, preview, calibration, tracking: trackingEnabled ? { ...tracker.info(), accelerated: self.TartarusScan.kernelsReady(), ...detail } : null }, preview ? [preview] : []);
  } catch (err) {
    self.postMessage({ id, kind, error: String((err && err.message) || err) });
  }
};
