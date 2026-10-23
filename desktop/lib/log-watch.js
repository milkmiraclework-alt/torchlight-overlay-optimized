'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Watch the directory so a rotated/recreated log is still noticed. The
// reader retains its bounded reads, partial-line decoder and polling backup.
function watchLog(file, changed) {
  let watcher;
  let queued = false;
  let stopped = false;
  const open = () => {
    if (stopped || watcher) return;
    try {
      watcher = fs.watch(path.dirname(file), { persistent: false }, (_, name) => {
        if (name && String(name).toLowerCase() !== path.basename(file).toLowerCase()) return;
        if (queued) return;
        queued = true;
        setImmediate(() => { queued = false; if (!stopped) changed(); });
      });
      watcher.on('error', () => { watcher.close(); watcher = null; });
    } catch { /* The game may not have created its log directory yet. */ }
  };
  open();
  const retry = setInterval(open, 1000);
  retry.unref();
  return () => { stopped = true; clearInterval(retry); if (watcher) watcher.close(); };
}
module.exports = { watchLog };
