/* Runs inside the isolated Electron check. The game window and reader
 * observations are controlled; the analyzer, solver workers and cache are real. */
'use strict';
module.exports = async function checkForecast() {
  const T = window.Tartarus, S = window.TartarusSolver, A = window.TartarusAnalyzer;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  async function until(test) {
    for (let i = 0; i < 1500; i++) { if (test()) return; await pause(10); }
    throw new Error('Forecast condition timed out: ' + JSON.stringify(A.forecastInfo()));
  }
  const trace = { jobs: new Map(), done: new Map(), plans: [], metadata: new Map(), rolling: false, raw: [], foreground: 0, hold: true, reading: null, messages: 0 };
  const living = new Set();
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(url, ...args) {
      super(url, ...args);
      living.add(this);
      this.isSolver = String(url).includes('solver-worker.js');
      const reader = String(url).includes('scan-worker.js');
      this.addEventListener('message', ({ data }) => {
        trace.messages++;
        if (reader && trace.reading && data.result && !data.kind) { data.result = trace.reading; data.calibration = null; }
        if (this.isSolver && data.rows) {
          if (data.meta) trace.metadata.set(data.id, data.meta);
          if (trace.rolling) {
            // Fix the ranking only in this scheduling fixture. Monte Carlo
            // may otherwise prefer Cancel, introducing random next-day doors
            // instead of the intended deterministic chain. Earlier cases
            // exercise the untouched real samples and full calculation budget.
            const metadata = trace.metadata.get(data.id);
            if (metadata) data.rows.forEach((row, i) => { row.vals = row.vals.map((v) => Number.isNaN(v) ? v : metadata[i].action.type === 'chain' ? 100 : 0); });
          }
          trace.raw.push(data);
          if (data.done) trace.done.set(data.id, (trace.done.get(data.id) || 0) + 1);
          else if (trace.hold && String(data.id).startsWith('forecast-job:')) this.postMessage({ id: data.id, pause: true });
        }
      });
    }
    terminate() { living.delete(this); return super.terminate(); }
    postMessage(message, ...args) {
      if (this.isSolver && message.predict) trace.plans.push(structuredClone(message));
      if (this.isSolver && message.background && !trace.jobs.has(message.id)) trace.jobs.set(message.id, structuredClone(message.state));
      if (this.isSolver && message.state && message.raw && !message.background) trace.foreground++;
      return super.postMessage(message, ...args);
    }
  };
  try {
    window.TartarusDesktop.setConsent({ version: 4, at: new Date().toISOString() });
    await until(() => window.TartarusCapture.agreed());
    // Controlled simulator observations stand in for an active board here.
    // Outside that context the real runtime deliberately disables forecasts.
    A.setForecastEnabled(true);
    A.prepare();
    function root(day, rolling = false, menu = false) {
      trace.rolling = rolling;
      trace.jobs.clear(); trace.done.clear(); trace.raw = []; trace.reading = null;
      const st = T.newGame({ seed: 'FORECAST-ELECTRON', startEvent: rolling ? 'cagefight' : null, params: { rewards: false, drillDays: 20, eventStartChance: 0, eventWalkChance: 0, eventMorningChance: 0, eventActionChance: 0 } });
      st.pending = []; st.day = day; st.position = 1; st.phase = 'patrol'; st.destinations = [2];
      st.objective = { id: 'other', progress: 0 };
      for (let n = 1; n < 16; n++) {
        T.editCell(st, n, { kind: 'open', beast: T.BEASTS[(n + 1) % 4], tier: (n / 4 | 0) % 3 });
        st.cells[n].event = null;
      }
      T.editCell(st, 2, { kind: 'open', beast: 'wolf', tier: 0 });
      T.editCell(st, 3, { kind: 'open', beast: 'rat', tier: 0 });
      if (rolling) {
        for (let n = 1; n < 16; n++) T.editCell(st, n, { kind: 'locked' });
        T.editCell(st, 2, { kind: 'open', beast: 'wolf', tier: 0 });
        for (let tier = 0; tier < 5; tier++) T.editCell(st, 3 + tier, { kind: 'open', beast: 'rat', tier });
        // Start inside a deterministic Cage Fight chain: no Replace or
        // random beast roll can select a different sampled branch.
        st.position = 2; st.phase = 'manage'; st.destinations = [];
        check(T.devour(st, 2, 3).ok && st.chaining, 'Could not construct a valid saved consume chain');
      } else for (const id of ['saw', 'whip', 'collar']) T.addTool(st, id);
      if (menu) { st.phase = 'manage'; st.destinations = []; st.used.devour = 1; }
      localStorage.setItem('tartarus-sim:save:v2', T.serialize(st));
      document.getElementById('az-load-run').click();
      A.ask();
      if (!rolling) check(A.desktopSnapshot().move, 'The forced root move was not immediate');
    }
    function reading(st) {
      const moves = S.candidates(st);
      return { ok: true, ms: 0, notes: [], loc: { s: 1, tx: 0, ty: 0, score: 1 },
        cells: st.cells.map((c) => ({ n: c.n, kind: c.n === 0 ? 'office' : c.sealed ? 'locked' : c.inmate ? 'inmate' : 'empty',
          beast: c.inmate?.beast, tier: c.inmate?.tier, conf: 1, nest: !!c.nest, event: c.seen !== false && !!c.event,
          jaws: !!c.inmate && T.devourOptions(st, c.n).length > 0, x: 0, y: 0, k: 1 })),
        warden: { cell: st.position, conf: 1 }, days: { days: st.maxDays - st.day },
        doors: st.phase === 'patrol' ? { cells: st.destinations, conf: 1 } : null,
        tools: { tools: st.tools.map((id) => ({ id, sim: id, name: T.toolName(id), conf: 1 })) },
        chromatic: { count: st.vault.length }, chain: st.chaining ? { targets: T.chainOptions(st).map((o) => o.cell) } : null,
        decision: st.chaining || st.phase === 'patrol' ? null : { title: true, end: true, replace: moves.some((m) => m.action.type === 'swap'), consume: moves.some((m) => m.action.type === 'devour'), hunt: moves.some((m) => m.action.type === 'hunt') } };
    }
    async function observe(st) {
      A.invalidate({ forecast: 'keep' });
      check(!A.desktopSnapshot().move && A.desktopSnapshot().stale, 'A prediction leaked into displayed advice before confirmation');
      A.invalidate({ forecast: 'pause' });
      check(A.forecastInfo().paused, 'Reading did not suspend background calculation');
      trace.reading = reading(st);
      const canvas = new OffscreenCanvas(160, 100);
      canvas.getContext('2d').fillRect(0, 0, 160, 100);
      const result = await A.readFrameDirect(await createImageBitmap(canvas));
      check(result.ok, 'Controlled observation did not reach the real reader/analyzer bridge');
      A.useReading();
      const start = performance.now(); A.askCached();
      const snapshot = { ...A.desktopSnapshot(), elapsed: performance.now() - start };
      trace.reading = null;
      return snapshot;
    }
    root(2);
    await until(() => trace.jobs.size && A.forecastInfo().rounds > 0 && A.forecastInfo().running);
    const [jobId, next] = trace.jobs.entries().next().value;
    const before = trace.foreground;
    const resumed = await observe(next);
    check(resumed.forecastResumed && !resumed.cacheHit, 'An unfinished matching forecast was discarded: ' + JSON.stringify(resumed));
    check(trace.foreground === before, 'Promotion started a new Monte Carlo calculation');
    await until(() => !!A.desktopSnapshot().move);
    check(Number(A.desktopSnapshot().status.replace(/\D/g, '')) === 1600, 'Promotion reduced the calculation budget: ' + JSON.stringify(A.desktopSnapshot()));
    const resumedRows = trace.raw.filter((m) => m.id === jobId || typeof m.id === 'number');
    const byStream = new Map();
    for (const m of resumedRows) {
      const last = byStream.get(m.stream) || 0;
      check(m.rows.every((r) => r.vals.length === m.rounds - last), 'The analyzer lost/doubled streamed samples on promotion');
      byStream.set(m.stream, m.rounds);
    }
    check([...byStream.values()].reduce((a, b) => a + b, 0) === 1600, 'The promoted streams did not retain the full budget');
    trace.hold = false;
    root(6);
    await until(() => trace.jobs.size > 0);
    const [readyId, readyState] = trace.jobs.entries().next().value;
    await until(() => trace.done.get(readyId) === Math.max(1, navigator.hardwareConcurrency - 1));
    await until(() => trace.jobs.size >= 2);
    const [deepId, deepState] = [...trace.jobs.entries()][1];
    await until(() => trace.done.get(deepId) === Math.max(1, navigator.hardwareConcurrency - 1));
    const ready = await observe(readyState);
    check(ready.forecastHit && ready.cacheHit && !ready.working && ready.move, 'A completed prediction was not reused: ' + JSON.stringify(ready));
    const expected = ready.move;
    const coldStart = performance.now(); A.ask();
    await until(() => !!A.desktopSnapshot().move);
    const coldMs = performance.now() - coldStart;
    check(!A.desktopSnapshot().cacheHit, 'Manual recheck did not bypass the forecast');
    const deep = await observe(deepState);
    check(deep.forecastHit && deep.cacheHit && !deep.working && deep.move, 'The second prepared action was not reusable: ' + JSON.stringify(deep));
    // Prepare B/C from A, confirm only B, then require D to be prepared
    // through the cached C without observing or clicking C first.
    root(10, true);
    await until(() => trace.jobs.size >= 2);
    const [[firstId, firstState], [secondId, secondState]] = [...trace.jobs.entries()];
    await until(() => trace.done.get(firstId) === Math.max(1, navigator.hardwareConcurrency - 1) && trace.done.get(secondId) === Math.max(1, navigator.hardwareConcurrency - 1));
    const plansBefore = trace.plans.length, jobsBefore = trace.jobs.size, reuseBefore = A.forecastInfo().reused;
    const first = await observe(firstState);
    check(first.forecastHit && !first.working, 'The rolling-horizon test did not start with a prepared first move');
    const visible = (st) => JSON.stringify([st.day, st.position, st.phase, !!st.chaining, st.cells.map((c) => [c.sealed, c.inmate?.beast, c.inmate?.tier])]);
    await until(() => trace.plans.slice(plansBefore).some((p) => visible(p.state) === visible(secondState)));
    check(A.forecastInfo().reused > reuseBefore, 'Cached intermediate advice did not advance the horizon');
    check(A.desktopSnapshot().step === 'chain' && A.day() === 10, 'The next horizon was extended only after another observed move');
    await until(() => trace.jobs.size > jobsBefore);
    const [thirdId, thirdState] = [...trace.jobs.entries()][jobsBefore];
    await until(() => trace.done.get(thirdId) === Math.max(1, navigator.hardwareConcurrency - 1));
    const second = await observe(secondState), third = await observe(thirdState);
    check(second.cacheHit && third.cacheHit && !second.working && !third.working, 'The extended horizon did not retain the next two prepared recommendations');
    trace.rolling = false;
    root(12, false, true);
    await until(() => trace.jobs.size > 0);
    const [menuId, menuState] = trace.jobs.entries().next().value;
    check(menuState.phase === 'patrol' && menuState.destinations.length === 6, 'Random next-day menus were not combined');
    await until(() => trace.done.get(menuId) === Math.max(1, navigator.hardwareConcurrency - 1));
    const familyBefore = A.forecastInfo().familyHits, foregroundBefore = trace.foreground;
    for (const indices of [[0, 2, 4], [1, 3, 5]]) {
      const actual = structuredClone(menuState); actual.destinations = indices.map((i) => menuState.destinations[i]);
      const hit = await observe(actual);
      check(hit.forecastHit && hit.cacheHit && !hit.working && hit.move, 'A different real door menu discarded the complete shared table');
    }
    check(A.forecastInfo().familyHits === familyBefore + 2 && trace.foreground === foregroundBefore, 'Door-menu reuse started extra playouts');
    const changedMenu = structuredClone(menuState);
    changedMenu.destinations = [menuState.destinations[0], menuState.destinations[2], menuState.destinations[4]];
    changedMenu.cells[7].inmate.tier = (changedMenu.cells[7].inmate.tier + 1) % 4;
    const rejected = await observe(changedMenu);
    check(!rejected.cacheHit && !rejected.forecastHit, 'Patrol reuse ignored a changed inmate');
    await until(() => !!A.desktopSnapshot().move);
    trace.hold = true;
    root(14, false, true);
    await until(() => trace.jobs.size && A.forecastInfo().rounds > 0);
    const partialMenu = structuredClone(trace.jobs.values().next().value);
    partialMenu.destinations = [partialMenu.destinations[0], partialMenu.destinations[2], partialMenu.destinations[4]];
    const partialBefore = A.forecastInfo().familyResumed, ordinaryBefore = trace.foreground;
    const promotedMenu = await observe(partialMenu);
    check(promotedMenu.forecastResumed && !promotedMenu.cacheHit && A.forecastInfo().familyResumed === partialBefore + 1,
      'An unfinished patrol table was not reduced to the real door menu');
    check(trace.foreground === ordinaryBefore, 'Patrol promotion started a replacement calculation');
    await until(() => !!A.desktopSnapshot().move);
    check(Number(A.desktopSnapshot().status.replace(/\D/g, '')) === 1600, 'Patrol promotion reduced the budget');
    trace.hold = true;
    root(8);
    await until(() => trace.jobs.size && A.forecastInfo().rounds > 0);
    const different = structuredClone(trace.jobs.values().next().value);
    different.cells[7].inmate.tier = (different.cells[7].inmate.tier + 1) % 4;
    const mismatch = await observe(different);
    check(!mismatch.forecastHit && !mismatch.forecastResumed && !mismatch.cacheHit, 'A different observed board used speculative advice');
    await until(() => !!A.desktopSnapshot().move);
    root(18);
    await until(() => A.forecastInfo().rounds > 0 && A.forecastInfo().running);
    A.suspend();
    check(living.size === 0, 'Suspending the board retained real workers');
    check(!A.forecastInfo().enabled && !A.forecastInfo().running && !A.forecastInfo().planning && !A.forecastInfo().families,
      'Suspending retained speculative work or raw Monte Carlo tables');
    await pause(100);
    const messages = trace.messages;
    await pause(150);
    check(trace.messages === messages, 'Terminated background calculations kept sending results');
    window.TartarusDesktop.setConsent({ withdrawn: true });
    await until(() => !window.TartarusCapture.agreed());
    check(!A.forecastInfo().running && !A.forecastInfo().planning, 'Disabling capture left speculative work running');
    check(trace.raw.length > 0 && trace.raw.every((m) => m.backend === 'rust'), 'Forecast integration silently used JavaScript instead of Rust');
    return { readyMs: Math.round(ready.elapsed), secondReadyMs: Math.round(deep.elapsed), coldMs: Math.round(coldMs), readyMove: expected, resumedRounds: 1600, rollingHorizon: true, sharedMenus: 2, suspendedWorkers: living.size, info: A.forecastInfo() };
  } finally { trace.reading = null; window.Worker = OriginalWorker; }
};
