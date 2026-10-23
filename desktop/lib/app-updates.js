/* Public-release updates only. Recognition and calculation remain offline. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: pause } = require('node:timers/promises');
const REPO = 'milkmiraclework-alt/torchlight-overlay-optimized';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
function version(value) {
  if (typeof value !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.replace(/^v/, '').split('.').map(Number);
  return parts.every((n) => Number.isSafeInteger(n) && n <= 2147483647) ? parts : null;
}
function newer(a, b) {
  const x = version(a), y = version(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function selectRelease(release, current, kind) {
  if (!['setup', 'portable'].includes(kind) || !release || release.draft || release.prerelease || !release.published_at || !/^v\d+\.\d+\.\d+$/.test(release.tag_name || '') || !newer(release.tag_name, current)) return null;
  const next = release.tag_name.slice(1), name = `Torchlight-Overlay-${kind === 'setup' ? 'Setup' : 'Portable'}-${next}-x64.exe`;
  const asset = (release.assets || []).find((a) => a.name === name);
  const url = `https://github.com/${REPO}/releases/download/v${next}/${name}`;
  if (!asset || asset.state !== 'uploaded' || asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 512 * 1024 * 1024 || !/^sha256:[0-9a-f]{64}$/.test(asset.digest || '')) throw new Error('The release does not contain a verified update for this EXE.');
  return { version: next, name, url, size: asset.size, sha256: asset.digest.slice(7), kind };
}
async function response(url, signal, testOrigin) {
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(url);
    const trusted = parsed.protocol === 'https:' && ['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port;
    const testing = testOrigin && parsed.origin === testOrigin && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
    if (!trusted && !testing) throw new Error('Untrusted update address.');
    const result = await fetch(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'Torchlight-Overlay-Updater', Accept: parsed.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.get('location'); await result.body?.cancel();
      if (!location) throw new Error('Update redirect has no address.');
      url = new URL(location, url).href; continue;
    }
    if (!result.ok) { await result.body?.cancel(); throw new Error(`Update server returned HTTP ${result.status}.`); }
    return result;
  }
  throw new Error('Too many update redirects.');
}
async function json(result, limit = 2 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of result.body) {
    size += chunk.length;
    if (size > limit) { throw new Error('Update response is too large.'); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function verified(file, release) {
  try { return (await fs.promises.stat(file)).size === release.size && await fileHash(file) === release.sha256; } catch { return false; }
}
function create(options) {
  const { current, kind, directory, onChange = () => {}, enabled = () => true, idle = () => true } = options;
  const request = options.request || response;
  let state = { phase: ['setup', 'portable'].includes(kind) ? 'idle' : 'unsupported', current, version: '', percent: 0, error: '', supported: ['setup', 'portable'].includes(kind) };
  let release = null, cached = '', busy = null, controller = null, closed = false, timers = [];
  const publish = (patch) => { state = { ...state, ...patch }; onChange({ ...state, enabled: enabled() }); };
  async function check() {
    if (!state.supported || closed || busy) return false;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15000); timeout.unref?.();
    const wasReady = state.phase === 'ready';
    publish({ phase: 'checking', error: '' });
    busy = (async () => {
      const next = selectRelease(await json(await request(API, controller.signal)), current, kind);
      if (closed) return false;
      if (!next) { release = null; cached = ''; publish({ phase: 'current', version: '', percent: 0 }); return true; }
      release = next; cached = path.join(directory, next.name);
      publish({ phase: await verified(cached, next) ? 'ready' : 'available', version: next.version, percent: 0 });
      return true;
    })().catch((error) => { if (!closed) publish({ phase: wasReady ? 'ready' : 'error', error: error.message }); return false; }).finally(() => { clearTimeout(timeout); busy = null; controller = null; });
    await busy;
    if (state.phase === 'available' && enabled() && idle()) void download();
    return true;
  }
  async function download() {
    if (!release || !['available', 'error'].includes(state.phase) || closed || busy) return false;
    const selected = release, file = path.join(directory, selected.name), part = file + '.partial';
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15 * 60 * 1000); timeout.unref?.();
    publish({ phase: 'downloading', error: '', percent: 0 });
    busy = (async () => {
      await fs.promises.mkdir(directory, { recursive: true });
      if (await verified(file, selected)) { cached = file; publish({ phase: 'ready', percent: 100 }); return true; }
      await fs.promises.rm(part, { force: true });
      const result = await request(selected.url, controller.signal);
      const announced = Number(result.headers.get('content-length'));
      if (announced && announced !== selected.size) throw new Error('Update size does not match the release.');
      const hash = crypto.createHash('sha256'), stream = fs.createWriteStream(part, { flags: 'wx' });
      let size = 0, reported = -1; const started = Date.now();
      // Attach the error listener before streaming to avoid unhandled I/O errors.
      let writeError; stream.on('error', (error) => { writeError = error; });
      try {
        for await (const bytes of result.body) {
          if (writeError) throw writeError;
          size += bytes.length; if (size > selected.size) throw new Error('Update is larger than the release.');
          hash.update(bytes); if (!stream.write(bytes)) await once(stream, 'drain');
          const percent = Math.floor(100 * size / selected.size);
          if (percent !== reported) { reported = percent; publish({ percent }); }
          // Bound background traffic and memory; no CPU worker or capture loop.
          const wait = size * 1000 / (options.bytesPerSecond || 2 * 1024 * 1024) - (Date.now() - started);
          if (wait > 0) await pause(wait, undefined, { signal: controller.signal });
        }
        stream.end(); await once(stream, 'finish');
        if (writeError) throw writeError;
      } catch (error) { stream.destroy(); await new Promise((resolve) => stream.closed ? resolve() : stream.once('close', resolve)); throw error; }
      if (size !== selected.size || hash.digest('hex') !== selected.sha256) throw new Error('Update checksum does not match the release.');
      await fs.promises.rename(part, file); cached = file;
      if (!closed) publish({ phase: 'ready', percent: 100 }); return true;
    })().catch(async (error) => { await fs.promises.rm(part, { force: true }).catch(() => {}); if (!closed) publish({ phase: 'error', error: error.message, percent: 0 }); return false; })
      .finally(() => { clearTimeout(timeout); busy = null; controller = null; });
    return busy;
  }
  return {
    check, download,
    info: () => ({ ...state, enabled: enabled() }),
    async prepared() { if (state.phase !== 'ready' || !release || !await verified(cached, release)) throw new Error('Download and verify the update first.'); return { ...release, file: cached }; },
    fail(error) { publish({ phase: 'error', error: error.message || String(error) }); },
    start() {
      if (timers.length || !state.supported || closed) return;
      timers = [setTimeout(() => { if (enabled()) void check(); }, 45000),
        setInterval(() => { if (enabled()) void check(); }, 6 * 3600000),
        setInterval(() => { if (enabled() && idle() && state.phase === 'available') void download(); }, 30000)];
      for (const timer of timers) timer.unref?.();
    },
    close() { closed = true; for (const timer of timers) clearTimeout(timer); timers = []; controller?.abort(); },
  };
}
module.exports = { REPO, API, version, newer, selectRelease, response, json, fileHash, verified, create };
