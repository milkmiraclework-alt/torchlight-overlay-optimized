/* Bounded next-state sampling. Predictions are never treated as observations. */
(function (root) {
  'use strict';
  function visibleKey(st) {
    return JSON.stringify({
      day: st.day, phase: st.phase, position: st.position, destinations: st.destinations,
      chain: st.chain, chaining: !!st.chaining, ratway: !!st.ratway, used: st.used,
      cells: st.cells.map((c) => [c.sealed, c.inmate && [c.inmate.beast, c.inmate.tier, !!c.inmate.marked],
        c.known, c.known && c.hidden && [c.known >= 2 ? c.hidden.beast : null, c.hidden.tier],
        c.seen !== false && !!c.event, c.nest, c.scratch, c.ivory, c.atLeast]),
      tools: st.tools, vault: st.vault.map((v) => v.beast), prey: st.prey,
      event: st.event, pending: st.pending, objective: st.objective, milestone: st.milestone,
      challenge: st.challenge && { window: st.challenge.window, deliveries: st.challenge.deliveries, vouchers: st.challenge.vouchers },
    });
  }
  function predict(st, action, options = {}) {
    const S = root.TartarusSolver || require('./solver.js');
    const T = root.Tartarus || require('./engine.js');
    const samples = Math.max(1, Math.min(96, options.samples || 48));
    const limit = Math.max(1, Math.min(6, options.limit || 4));
    const roll = S.rng32(options.seed || 1), groups = new Map();
    for (let i = 0; i < samples; i++) {
      const next = S.clone(st);
      S.hideFuture(next, (roll() * 4294967296) >>> 0);
      const result = S.apply(next, action);
      if (!result || !result.ok || next.phase === 'ended') continue;
      if (options.autoDay && next.phase === 'manage' && !next.chaining && !next.pending.length &&
          !(next.challenge && next.challenge.window) && (next.used.devour > 0 || !T.devourOptions(next, next.position).length)) {
        const moves = S.candidates(next);
        if (moves.length === 1 && moves[0].action.type === 'end') S.apply(next, moves[0].action);
      }
      if (next.phase === 'ended') continue;
      const patrolFamily = !!options.patrolFamilies && next.mode === 'drill' && next.phase === 'patrol' && !next.ratway && !next.pending.length;
      if (patrolFamily) next.destinations = Array.from({ length: next.params.patrolRange }, (_, n) => (next.position + n + 1) % T.CELL_COUNT);
      const key = visibleKey(next), found = groups.get(key);
      if (found) found.count++;
      else groups.set(key, { state: next, count: 1, patrolFamily });
    }
    return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }
  function patrolResult(S, st, rows, target, seed) {
    if (st.mode !== 'drill' || st.phase !== 'patrol' || st.ratway || st.pending.length) return null;
    const options = S.candidates(st);
    if (options.length < 2) return null;
    const pick = S.decide(S.clone(st), null, S.rng32(seed ^ 0x5bd1e995));
    const selected = [];
    for (const option of options) {
      const row = rows.find((row) => S.sameAction(row.action, option.action));
      if (!row || row.vals.length !== target) return null;
      selected.push({ ...row, ...option, policy: S.sameAction(option.action, pick) });
    }
    return S.summarize(selected, target, target, 'rainbows');
  }
  const api = { predict, visibleKey, patrolResult };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusForecast = api;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
