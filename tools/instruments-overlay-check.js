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
    async function observe(ids, blocked = false, day = state.day) {
      panel = { ok: true, cells: state.cells.map((c) => ({ n: c.n, kind: c.n === 0 ? 'office' : 'inmate', beast: c.inmate?.beast, tier: c.inmate?.tier, conf: 1 })),
        warden: { cell: 1, conf: 1 }, days: { days: state.maxDays - day }, doors: { cells: [2], conf: 1 }, chromatic: { count: 0 },
        tools: { tools: ids.map((item) => typeof item === 'string' ? { sim: item, id: item, name: T.toolName(item), conf: 1 } : item) } };
      const canvas = new OffscreenCanvas(2, 2); canvas.getContext('2d').fillRect(0, 0, 2, 2);
      const bitmap = await createImageBitmap(canvas);
      const read = await A.readFrameDirect(bitmap);
      check(read.ok, 'Controlled panel did not reach the actual reader callback');
      A.useReading(); A.askCached();
      if (blocked) {
        const snapshot = A.desktopSnapshot();
        check(!snapshot.move && !snapshot.working && !snapshot.has && snapshot.problems.length, 'Unknown inputs produced advice: ' + JSON.stringify(snapshot));
      } else await settled();
      return A.desktopSnapshot();
    }
    if (!resume) {
      await observe(['crown']);
      const before = await observe(['skewer', 'cage'], true);
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
    const cached = A.desktopSnapshot().cacheHit;
    if (resume) {
      A.invalidate(); A.expectInstrumentOffer();
      await observe(['crown'], true);
      document.getElementById('az-tools-ok').click();
      check(saved().model.toolsOffer?.unread && !saved().model.toolsConfirmed && !A.desktopSnapshot().move, 'A failed offer was blindly confirmed or forgotten');
      const offered = ['fire', 'collar', 'shackles'];
      A.usePick({ ok: true, cards: offered.map((sim) => ({ sim, conf: 1, name: T.toolName(sim) })), names: offered.map((id) => T.toolName(id)), byName: 3 }, false, true);
      await settled();
      await observe(['crown', { sim: 'collar', conf: 0.25 }], true);
      check(saved().model.tools.join() === 'crown', 'An unread pick was replaced with the recommendation');
      await observe(['crown', { sim: 'collar', conf: 1, alts: [{ sim: 'collar', score: 0.99 }, { sim: 'shackles', score: 0.98 }] }], true);
      await observe(['crown', 'collar', 'shackles'], true);
      await observe(['crown', 'collar']);
      check(saved().model.tools.join() === 'crown,collar' && !saved().model.toolsOffer && !saved().model.toolsUncertain,
        'A unique actual choice failed to recover: ' + JSON.stringify(saved().model));
      A.expectInstrumentOffer();
      document.querySelector('#az-tools [data-tool="claws"]').click();
      document.getElementById('az-tools-ok').click();
      await settled();
      check(saved().model.toolsConfirmed.tools === 'claws,collar,crown' && !saved().model.toolsOffer, 'Explicit correction did not unblock the calculation');
      state.day = 10; state.tools = ['coin', 'blacklist'];
      localStorage.setItem('tartarus-sim:save:v2', T.serialize(state));
      document.getElementById('az-load-run').click();
      await observe(['coin', 'blacklist']); document.getElementById('az-tools-ok').click(); await settled();
      await observe(['coin'], true, 18);
      check(A.day() === 10 && saved().model.dayProbe.day === 18 && saved().model.toolsConfirmed.tools === 'blacklist,coin', 'The bad day changed advice or removed the Book');
      await observe(['coin'], false, 11);
      check(A.day() === 11 && !saved().model.dayProbe && saved().model.tools.join() === 'coin,blacklist' && saved().model.toolsConfirmed.tools === 'blacklist,coin', 'Correcting the day erased the confirmed Book');
      A.beginRun('new-run-fixture');
      check(saved().model.tools.length === 0 && !saved().model.toolsConfirmed && A.day() === 1, 'A real new-run boundary did not reset old instruments');
      document.querySelector('#az-tools [data-tool="claws"]').click(); document.getElementById('az-tools-ok').click();
      A.beginRun('new-run-fixture');
      check(saved().model.toolsConfirmed.tools === 'claws', 'A duplicate start event erased the new run again');
      A.openTools();
      const divider = document.getElementById('az-tools-rest'), firstOther = divider.nextElementSibling;
      check(firstOther?.dataset.tool, 'Fixture has no first item under Others');
      firstOther.click();
      check(divider.previousElementSibling === firstOther && firstOther.getAttribute('aria-pressed') === 'true', 'Selecting the first Other left it below the divider');
      firstOther.click();
      check(divider.nextElementSibling === firstOther && firstOther.getAttribute('aria-pressed') === 'false', 'Removing the last held item left it above the divider');
      firstOther.click();
      check(document.getElementById('az-tools-close').textContent === 'Confirm instruments', 'Header silently closes unconfirmed edits');
      document.getElementById('az-tools-close').click();
      check(!document.getElementById('az-tools-dialog').open && saved().model.toolsConfirmed.tools === [firstOther.dataset.tool, 'claws'].sort().join(','), 'Header did not save/confirm the actual selected set');
    }
    return { resume, frames: 5, tools: data.model.tools, confirmation: data.model.toolsConfirmed, cacheHit: cached, selectionGuards: resume, dayRegression: resume };
  } finally { panel = null; window.Worker = OriginalWorker; }
};
