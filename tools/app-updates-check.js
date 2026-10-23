'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const U = require('../desktop/lib/app-updates'), I = require('../desktop/lib/update-install');
const root = path.resolve(__dirname, '../sandbox/update-check-' + process.pid + '-' + Date.now());
fs.mkdirSync(root, { recursive: true });
const payload = Buffer.from('MZ-isolated-test-update'), digest = crypto.createHash('sha256').update(payload).digest('hex');
function release(kind = 'portable', v = '1.0.4') {
  const name = `Torchlight-Overlay-${kind === 'setup' ? 'Setup' : 'Portable'}-${v}-x64.exe`;
  return { tag_name: 'v' + v, draft: false, prerelease: false, published_at: '2026-10-23', assets: [{ name, state: 'uploaded', size: payload.length, digest: 'sha256:' + digest, browser_download_url: `https://github.com/${U.REPO}/releases/download/v${v}/${name}` }] };
}
async function run() {
  assert.ok(U.newer('v1.0.10', '1.0.9')); assert.ok(!U.newer('1.0.3', '1.0.3'));
  for (const value of ['1.0.4-beta', '1.0.4/../../x', '01.0.4', '2147483648.0.0', '', null]) assert.equal(U.version(value), null);
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.0.2' }, { published_at: null }]) assert.equal(U.selectRelease({ ...release(), ...patch }, '1.0.3', 'portable'), null);
  for (const patch of [{ digest: null }, { digest: 'sha256:bad' }, { size: 1e12 }, { browser_download_url: 'https://evil.example/update.exe' }]) {
    const record = release(); Object.assign(record.assets[0], patch); assert.throws(() => U.selectRelease(record, '1.0.3', 'portable'));
  }
  assert.equal(U.selectRelease(release('setup'), '1.0.3', 'setup').kind, 'setup');
  let calls = [], broken = false, enabled = false, idle = false, failNetwork = false;
  const updater = U.create({ current: '1.0.3', kind: 'portable', directory: path.join(root, 'cache'), enabled: () => enabled, idle: () => idle,
    bytesPerSecond: 1e9, request: async (url) => {
      calls.push(url); if (failNetwork) throw new Error('offline');
      return url === U.API ? new Response(JSON.stringify(release())) : new Response(broken ? Buffer.from('wrong!') : payload);
    } });
  assert.equal(await updater.prepared().catch(() => null), null);
  await updater.check(); assert.equal(updater.info().phase, 'available'); assert.equal(calls.length, 1, 'Disabled downloads used the network');
  broken = true; assert.equal(await updater.download(), false); assert.equal(updater.info().phase, 'error');
  assert.ok(!fs.readdirSync(path.join(root, 'cache')).some((n) => /\.exe$|partial$/.test(n)), 'Corrupt update survived');
  broken = false; assert.equal(await updater.download(), true);
  const prepared = await updater.prepared(); assert.equal(prepared.sha256, digest); assert.equal(updater.info().phase, 'ready');
  failNetwork = true; await updater.check(); assert.equal(updater.info().phase, 'ready', 'Network loss discarded a verified cached update');
  const old = path.join(root, 'my old portable.exe'); fs.writeFileSync(old, 'old');
  const plan = await I.prepare(prepared, { directory: path.join(root, 'cache'), portable: old });
  assert.equal(fs.readFileSync(old, 'utf8'), 'old', 'Preparation modified the running EXE');
  assert.equal(await U.fileHash(plan.plan.stage), digest);
  assert.equal(plan.plan.target, old); assert.ok(fs.existsSync(plan.helper));
  fs.writeFileSync(prepared.file, 'corrupt'); await assert.rejects(updater.prepared());
  await assert.rejects(I.prepare({ ...prepared, file: path.join(root, '..', 'outside.exe') }, { directory: path.join(root, 'cache'), portable: old }));
  updater.close();
  let forbidden = 0;
  const source = U.create({ current: '1.0.3', kind: 'unpacked', directory: root, request: async () => { forbidden++; } });
  source.start(); await source.check(); assert.equal(forbidden, 0); source.close();
  let automaticRequests = 0;
  const deferred = U.create({ current: '1.0.3', kind: 'portable', directory: path.join(root, 'deferred'), enabled: () => true, idle: () => false,
    request: async (url) => { automaticRequests++; return new Response(JSON.stringify(release())); } });
  await deferred.check(); assert.equal(automaticRequests, 1); assert.equal(deferred.info().phase, 'available'); deferred.close();
  console.log('PASS: stable versions, pinned release/asset URLs, SHA256/size, corrupt-file cleanup, cached/offline readiness, idle/disabled download guards and preparation without changing the running EXE.');
  const server = http.createServer((req, res) => {
    if (req.url === '/evil') { res.writeHead(302, { Location: 'https://evil.example/binary.exe' }); res.end(); }
    else if (req.url === '/redirect') { res.writeHead(302, { Location: '/payload' }); res.end(); }
    else { res.end(payload); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(U.response(origin + '/payload', new AbortController().signal));
    await assert.rejects(U.response(origin + '/evil', new AbortController().signal, origin), /Untrusted/);
    assert.equal(await (await U.response(origin + '/redirect', new AbortController().signal, origin)).text(), payload.toString());
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  console.log('PASS: actual HTTP streaming/relative redirects work only in explicit loopback tests; untrusted redirects are rejected before connection.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
