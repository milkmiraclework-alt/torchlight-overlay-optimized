/* Tartarus Simulator: solver worker.
 * Runs the Monte Carlo solver off the page's main thread and streams partial
 * results back, so the board stays responsive while it plays options out.
 * A newer request replaces the one in progress. Background checks use short
 * slices with idle gaps. Pause retains the job; promotion resumes its exact
 * sample stream at full speed under the foreground request's ID.
 *
 * With `raw`, it sends each round's values instead of a result, so the page
 * can run several of these at once, each on its own `stream` of dice, and
 * merge their rows (TartarusSolver.summarize). */
'use strict';

importScripts(`engine.js${self.location.search}`, `tool-combos.js${self.location.search}`, `solver.js${self.location.search}`, `solver-forecast.js${self.location.search}`, `rust-solver.js${self.location.search}`);
// Workers are created on board entry. Compile Rust while capture/recognition
// is settling, rather than adding its cold load to the first calculation.
self.TartarusRust.load().catch(() => {});
let current = null;
let generation = 0;
function tick(task) {
  task.timer = 0;
  if (current !== task || !task.job || task.paused || task.done) return;
  const result = task.job.step(task.background ? 8 : 60, task.raw);
  task.done = result.done;
  if (task.raw) {
    self.postMessage({
      id: task.id, stream: task.stream, rounds: result.rounds, done: result.done, goal: result.goal, backend: task.job.backend || 'javascript',
      meta: task.sent === 0 ? task.job.rows.map((r) => ({ label: r.label, action: r.action, kind: r.kind, extra: r.extra, policy: r.policy })) : null,
      rows: task.job.rows.map((r) => ({ vals: r.vals.slice(task.sent), pass: r.pass, points: r.points, best: r.best })),
    });
    task.sent = result.rounds;
  } else self.postMessage({ id: task.id, result });
  if (!task.done) task.timer = setTimeout(() => tick(task), task.background ? 24 : 0);
}
async function handleMessage({ data }) {
  if (data.predict) {
    try {
      let core;
      try { core = await self.TartarusRust.load(); } catch {}
      self.postMessage({ id: data.id, predictions: core ? self.TartarusRust.predict(core, data.state, data.action, data.options) : self.TartarusForecast.predict(data.state, data.action, data.options) });
    }
    catch { self.postMessage({ id: data.id, predictions: [] }); }
    return;
  }
  if (data.pause || data.promote) {
    if (!current || current.id !== (data.from === undefined ? data.id : data.from)) return;
    clearTimeout(current.timer); current.timer = 0;
    current.paused = !!data.pause;
    if (data.promote) {
      if (data.indices) {
        if (!current.job) current.indices = data.indices;
        else if (current.job.select) current.job.select(data.indices);
        else {
          const rows = data.indices.map((i) => current.job.rows[i]);
          current.job.rows.splice(0, current.job.rows.length, ...rows);
        }
      }
      current.id = data.id; current.background = false;
    }
    if (!current.paused && !current.done) {
      const task = current;
      task.timer = setTimeout(() => tick(task), 0);
    }
    return;
  }
  const token = ++generation;
  if (current) { clearTimeout(current.timer); current.job?.cancel?.(); }
  current = null;
  if (data.cancel) return;
  const { id, state, rollouts, params, extra, stream, raw, background, seed } = data;
  const options = { rollouts, params, extra, stream: stream || 0, seed: seed === undefined ? (id * 7919 + 1) >>> 0 : seed };
  const task = { id, stream, raw, background: !!background, paused: false, done: false, sent: 0, timer: 0, job: null };
  current = task;
  let core = null;
  try { core = await self.TartarusRust.load(); }
  catch (error) { console.warn('Rust solver unavailable; using reference solver:', error.message); }
  if (token !== generation) return;
  if (core) {
    try { task.job = self.TartarusRust.solve(core, state, options); }
    catch (error) { console.warn('Rust job rejected; using full-budget reference solver:', error.message); }
  }
  if (!task.job) task.job = self.TartarusSolver.solve(state, options);
  if (task.indices) {
    if (task.job.select) task.job.select(task.indices);
    else { const rows = task.indices.map((i) => task.job.rows[i]); task.job.rows.splice(0, task.job.rows.length, ...rows); }
  }
  tick(task);
}
// Async initialization errors must reach Worker.onerror, just like errors
// thrown by later timer slices, so the renderer can recover rather than wait.
self.onmessage = (event) => { handleMessage(event).catch((error) => setTimeout(() => { throw error; }, 0)); };
