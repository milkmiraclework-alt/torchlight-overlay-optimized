/* Bounded cache of completed Monte Carlo summaries. Exact input keys only;
 * persistent writes run asynchronously after advice has been displayed. */
(function (root) {
  'use strict';
  const DB = 'tartarus-sim:monte-carlo:v1', STORE = 'results';
  const key = (model, target) => `${target}:` + JSON.stringify(model, (_, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const ordered = {};
    for (const name of Object.keys(value).sort()) ordered[name] = value[name];
    return ordered;
  });
  const full = (result, target) => !!result && result.done === true &&
    Number.isInteger(target) && target > 0 && Number.isInteger(result.rounds) && result.rounds >= 0 &&
    ['rainbows', 'contract'].includes(result.goal) && Array.isArray(result.options) &&
    (result.options.length <= 1 || result.rounds >= target) &&
    result.options.every((option) => option && typeof option.label === 'string' && option.action && typeof option.action.type === 'string' && Number.isFinite(option.mean));
  const copy = (value) => {
    if (typeof root.structuredClone === 'function') return root.structuredClone(value);
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(copy);
    const out = {};
    for (const key of Object.keys(value)) out[key] = copy(value[key]);
    return out;
  };
  function create(options = {}) {
    const version = String(options.version || '');
    const maxEntries = Math.max(1, Math.floor(options.maxEntries || 256)), maxBytes = Math.max(1, Math.floor(options.maxBytes || 8 * 1024 * 1024));
    const ttl = options.ttl || 7 * 86400000, now = options.now || Date.now;
    const persistent = options.persistent !== false && !!version && !!root.indexedDB;
    const entries = new Map(), pending = new Map();
    let bytes = 0, db = null, timer = 0, writing = 0, loaded = false, diskEntries = 0;
    let hits = 0, misses = 0, saved = 0;
    const idFor = (key) => JSON.stringify([version, key]);
    const sizeOf = (key, result) => 2 * (key.length + JSON.stringify(result).length);
    function schedule() { if (db && loaded && pending.size && !timer) timer = root.setTimeout(flush, 200); }
    function remove(key) {
      const record = entries.get(key);
      if (!record) return;
      entries.delete(key); bytes -= record.bytes;
      if (persistent && (!loaded || db)) { pending.set(record.id, null); schedule(); }
    }
    function trim() {
      while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
    }
    function flush() {
      if (timer) root.clearTimeout(timer);
      timer = 0;
      if (!db || !loaded || !pending.size || writing) return;
      const jobs = [...pending]; pending.clear(); writing++;
      const done = () => { writing--; schedule(); };
      try {
        const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
        for (const [id, record] of jobs) { if (record) store.put(record); else store.delete(id); }
        tx.oncomplete = done;
        tx.onabort = done;
        tx.onerror = () => {}; // Storage failure leaves the in-memory cache usable.
      } catch { done(); }
    }
    const ready = new Promise((resolve) => {
      const finished = () => { loaded = true; if (!db) pending.clear(); resolve(); schedule(); };
      if (!persistent) { finished(); return; }
      try {
        const request = root.indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
        request.onerror = finished;
        request.onblocked = finished;
        request.onsuccess = () => {
          if (loaded) { request.result.close(); return; }
          db = request.result;
          db.onversionchange = () => { db.close(); db = null; pending.clear(); };
          try {
            const read = db.transaction(STORE).objectStore(STORE).getAll();
            read.onerror = finished;
            read.onsuccess = () => {
              for (const record of read.result) {
                try {
                  if (record.version !== version || typeof record.key !== 'string' || record.id !== idFor(record.key) ||
                      !Number.isFinite(record.created) || !Number.isFinite(record.at) || now() - record.created >= ttl || !full(record.result, record.target)) {
                    pending.set(record.id, null); continue;
                  }
                  if (entries.has(record.key)) continue; // A new result beats an older disk entry.
                  record.bytes = sizeOf(record.key, record.result);
                  if (record.bytes > maxBytes) { pending.set(record.id, null); continue; }
                  entries.set(record.key, record); bytes += record.bytes; diskEntries++;
                } catch { if (record && record.id !== undefined) pending.set(record.id, null); }
              }
              const ordered = [...entries.values()].sort((a, b) => a.at - b.at);
              entries.clear();
              for (const record of ordered) entries.set(record.key, record);
              trim(); finished();
            };
          } catch { finished(); }
        };
      } catch { finished(); }
    });
    if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', flush);
    return {
      ready,
      get(key, target) {
        const record = entries.get(key);
        if (!record || record.target !== target || !full(record.result, target) || now() - record.created >= ttl) {
          if (record && now() - record.created >= ttl) remove(key);
          misses++; return null;
        }
        entries.delete(key); record.at = now(); entries.set(key, record);
        if (db) { pending.set(record.id, record); schedule(); }
        hits++; return copy(record.result);
      },
      put(key, result, target) {
        if (typeof key !== 'string' || !full(result, target)) return false;
        let size, cloned;
        try { size = sizeOf(key, result); cloned = copy(result); } catch { return false; }
        if (size > maxBytes) return false;
        const previous = entries.get(key);
        if (previous) { entries.delete(key); bytes -= previous.bytes; }
        const record = { id: idFor(key), key, version, result: cloned, target, bytes: size, created: now(), at: now() };
        entries.set(key, record); bytes += size; saved++;
        if (persistent && (!loaded || db)) pending.set(record.id, record);
        trim(); schedule(); return true;
      },
      info: () => ({ entries: entries.size, bytes, hits, misses, saved, loaded, diskEntries, persistent: !!db, pending: pending.size, writing }),
    };
  }
  const api = { create, key };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusSolverCache = api;
})(typeof window !== 'undefined' ? window : globalThis);
