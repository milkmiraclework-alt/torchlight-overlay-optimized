/* Rust Monte Carlo backend. The JSON boundary is outside the playout loop:
 * a worker retains its Rust job/RNG and sends only new samples per slice. */
(function (root) {
  'use strict';
  let loading = null;
  async function fromBytes(bytes) {
    const { instance } = await WebAssembly.instantiate(bytes, { env: { now: () => performance.now() } });
    const wasm = instance.exports, encoder = new TextEncoder(), decoder = new TextDecoder();
    return {
      request(input) {
        const bytes = encoder.encode(JSON.stringify(input));
        const pointer = wasm.alloc(bytes.length);
        try {
          new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
          const length = wasm.request(pointer, bytes.length);
          const result = JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.response(), length)));
          if (result.error) throw new Error('Rust solver: ' + result.error);
          return result;
        } finally { wasm.dealloc(pointer, bytes.length); }
      },
      memoryBytes: () => wasm.memory.buffer.byteLength,
    };
  }
  function load() {
    if (!loading) loading = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
      try {
        const url = new URL('solver-core.wasm' + (root.location.search || ''), root.location.href);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Rust solver download: ' + response.status);
        return await fromBytes(await response.arrayBuffer());
      } finally { clearTimeout(timer); }
    })();
    return loading;
  }
  function solve(core, state, options) {
    const S = root.TartarusSolver;
    const list = S.candidates(state);
    const first = core.request({ op: 'init', state, ...options });
    const rows = first.rows.map((row) => {
      const meta = list.find((candidate) => S.sameAction(candidate.action, row.action));
      if (!meta) throw new Error('Rust solver candidate mismatch');
      return { ...meta, kind: meta.kind || null, extra: meta.extra, vals: [], best: 0, pass: 0, points: 0, policy: row.policy };
    });
    let cancelled = false;
    return {
      backend: 'rust', rows,
      select(indices) {
        core.request({ op: 'select', indices });
        const selected = indices.map((i) => rows[i]); rows.splice(0, rows.length, ...selected);
      },
      cancel() { if (!cancelled) { cancelled = true; core.request({ op: 'cancel' }); } },
      step(ms, progressOnly = false) {
        const progress = core.request({ op: 'step', ms });
        for (let i = 0; i < rows.length; i++) {
          const next = progress.rows[i];
          rows[i].vals.push(...next.vals.map((v) => v === null ? NaN : v)); rows[i].best = next.best;
        }
        return progressOnly ? { done: progress.done, rounds: progress.rounds, goal: progress.goal }
          : S.summarize(rows, progress.rounds, options.rollouts, progress.goal);
      },
    };
  }
  function predict(core, state, action, options = {}) {
    const samples = core.request({ op: 'predict', state, action, options }), groups = new Map();
    for (const sample of samples) {
      const next = { ...state, ...sample.state, log: [], mode: 'drill' };
      if (next.chaining) next.chaining = { ...next.chaining, at: 0, bites: [] };
      const key = root.TartarusForecast.visibleKey(next), found = groups.get(key);
      if (found) found.count++;
      else groups.set(key, { state: next, count: 1, patrolFamily: sample.patrolFamily });
    }
    return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, Math.max(1, Math.min(6, options.limit || 4)));
  }
  const api = { load, fromBytes, solve, predict };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusRust = api;
})(typeof self !== 'undefined' ? self : globalThis);
