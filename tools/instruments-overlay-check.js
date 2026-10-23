/* Real analyzer/worker/click/persistence flow with controlled panel readings. */
'use strict';
module.exports = async function checkInstruments(resume = false, throughOverlay = false) {
  const A = window.TartarusAnalyzer, T = window.Tartarus;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  async function settled() {
    for (let i = 0; i < 1000; i++) { if (A.desktopSnapshot().move) return; await pause(10); }
    throw new Error('Instrument advice timed out: ' + JSON.stringify(A.desktopSnapshot()));
  }
  const state = T.newGame({ seed: 'INSTRUMENT-CONFIRMATION', params: { drillDays: 20, rewards: false } });
  state.pending = []; state.phase = 'patrol'; state.day = 19; state.position = 1; state.destinations = [2];
  T.addTool(state, 'crown');
  for (let n = 1; n < 16; n++) { T.editCell(state, n, { kind: 'open', beast: T.BEASTS[n % 4], tier: n % 3 }); state.cells[n].event = null; }
  let panel;
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(url, ...args) {
      super(url, ...args);
      if (String(url).includes('scan-worker.js')) this.addEventListener('message', ({ data }) => {
        if (!data.kind && data.result && panel) { data.result = panel; data.calibration = null; }
      });
    }
  };
  const saved = () => JSON.parse(localStorage.getItem('tartarus-sim:analyzer:v1'));
  try {
    if (!resume) {
      localStorage.setItem('tartarus-sim:save:v2', T.serialize(state));
      document.getElementById('az-load-run').click();
    }
    async function observe(ids) {
      panel = { ok: true, cells: state.cells.map((c) => ({ n: c.n, kind: c.n === 0 ? 'office' : 'inmate', beast: c.inmate?.beast, tier: c.inmate?.tier, conf: 1 })),
        warden: { cell: 1, conf: 1 }, days: { days: 1 }, doors: { cells: [2], conf: 1 }, chromatic: { count: 0 },
        tools: { tools: ids.map((sim) => ({ sim, id: sim, name: T.toolName(sim), conf: 1 })) } };
      const canvas = new OffscreenCanvas(2, 2); canvas.getContext('2d').fillRect(0, 0, 2, 2);
      const bitmap = await createImageBitmap(canvas);
      const read = await A.readFrameDirect(bitmap);
      check(read.ok, 'Controlled panel did not reach the actual reader callback');
      A.useReading(); A.askCached(); await settled();
      return A.desktopSnapshot();
    }
    if (!resume) {
      const before = await observe(['skewer', 'cage']);
      check(before.toolsConfirm.includes('panel shows'), 'Fixture failed to reproduce the extra-icon warning');
      if (throughOverlay) {
        await new Promise((resolve) => { window.__instrumentConfirmation = { resolve }; });
        delete window.__instrumentConfirmation;
      } else document.getElementById('az-tools-ok').click();
      check(!A.desktopSnapshot().toolsConfirm, 'These are right did not clear the warning');
      check(A.desktopSnapshot().cacheHit, 'Confirmation recomputed identical Monte Carlo inputs');
    }
    for (const ids of [['skewer'], ['cage'], [], ['skewer', 'cage'], ['skewer', 'cage', 'claws', 'maul', 'saw']]) check(!(await observe(ids)).toolsConfirm, 'A later frame forgot confirmation after noisy slot growth');
    const data = saved();
    check(data.model.tools.join() === 'crown' && data.model.toolsConfirmed.tools === 'crown', 'Confirmed instruments were not saved correctly');
    return { resume, frames: 5, tools: data.model.tools, confirmation: data.model.toolsConfirmed, cacheHit: A.desktopSnapshot().cacheHit };
  } finally { panel = null; window.Worker = OriginalWorker; }
};
