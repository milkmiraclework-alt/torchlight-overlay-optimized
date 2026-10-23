'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: pause } = require('node:timers/promises');
const { verified, version, newer } = require('./app-updates');
function kind(executable, portable) {
  if (portable && path.isAbsolute(portable) && /\.exe$/i.test(portable) && fs.existsSync(portable)) return 'portable';
  return fs.existsSync(path.join(path.dirname(executable), 'Uninstall Torchlight Overlay.exe')) ? 'setup' : 'unpacked';
}
async function prepare(update, options) {
  if (!['setup', 'portable'].includes(update.kind) || !version(update.version) || !await verified(update.file, update)) throw new Error('The downloaded update is not verified.');
  const directory = path.resolve(options.directory), id = crypto.randomUUID();
  await fs.promises.mkdir(directory, { recursive: true });
  if (path.dirname(path.resolve(update.file)) !== directory) throw new Error('Unexpected update cache path.');
  const plan = { mode: update.kind, version: update.version, sha256: update.sha256, size: update.size,
    source: path.resolve(update.file), pid: options.pid || process.pid, id,
    ready: path.join(directory, id + '.ready'), outcome: path.join(directory, id + '.outcome.json'), cancel: path.join(directory, id + '.cancel') };
  if (update.kind === 'portable') {
    const target = options.portable;
    if (!target || !path.isAbsolute(target) || !/\.exe$/i.test(target) || !fs.statSync(target).isFile()) throw new Error('The original Portable EXE was not found.');
    plan.target = path.resolve(target); plan.stage = plan.target + '.update-' + id + '.exe'; plan.backup = plan.target + '.update-' + id + '.bak';
    await fs.promises.copyFile(update.file, plan.stage, fs.constants.COPYFILE_EXCL);
    if (!await verified(plan.stage, update)) { await fs.promises.rm(plan.stage, { force: true }); throw new Error('Portable staging verification failed.'); }
  }
  const helper = path.join(directory, id + '.ps1'), file = path.join(directory, 'pending.json');
  try {
    await fs.promises.writeFile(helper, await fs.promises.readFile(path.join(__dirname, 'update-install.ps1')), { flag: 'wx' });
    plan.helper = helper;
    await fs.promises.writeFile(file, JSON.stringify(plan), { encoding: 'utf8' });
  } catch (error) { if (plan.stage) await fs.promises.rm(plan.stage, { force: true }); throw error; }
  return { file, helper, plan };
}
async function launch(prepared) {
  // Start-Process creates an independent Windows helper. A directly spawned
  // PowerShell can lose its console/job when the Electron host exits.
  // Paths are JSON data, never interpolated as executable PowerShell text.
  const data = Buffer.from(JSON.stringify({ helper: prepared.helper, file: prepared.file }), 'utf8').toString('base64');
  const bootstrap = `$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json; $arguments=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$data.helper+'"'),'-Plan',('"'+$data.file+'"')); Start-Process -FilePath ([IO.Path]::Combine([Environment]::SystemDirectory,'WindowsPowerShell\\v1.0\\powershell.exe')) -ArgumentList $arguments -WindowStyle Hidden`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let failure, stderr = ''; child.stderr.on('data', (bytes) => { stderr = (stderr + bytes.toString()).slice(-1500); });
  child.once('error', (error) => { failure = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failure) throw failure;
    if (fs.existsSync(prepared.plan.ready)) { child.stderr.destroy(); child.unref(); return; }
    if (child.exitCode !== null && child.exitCode !== 0 || fs.existsSync(prepared.plan.outcome)) {
      let detail = stderr;
      try { detail = JSON.parse(fs.readFileSync(prepared.plan.outcome, 'utf8').replace(/^\uFEFF/, '')).error || detail; } catch {}
      throw new Error('The update helper did not start. ' + detail);
    }
    await pause(100);
  }
  await fs.promises.writeFile(prepared.plan.cancel, 'cancel');
  child.kill(); throw new Error('The update helper did not become ready.');
}
async function cleanup(directory, current, portable) {
  // Only our exact artifact names inside the update cache; never profiles.
  for (const name of await fs.promises.readdir(directory).catch(() => [])) {
    const match = /^Torchlight-Overlay-(?:Portable|Setup)-(\d+\.\d+\.\d+)-x64\.exe(?:\.partial)?$/.exec(name);
    if (match && version(match[1]) && !newer(match[1], current)) await fs.promises.rm(path.join(directory, name), { force: true }).catch(() => {});
  }
  const file = path.join(directory, 'pending.json');
  let plan; try { plan = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { return; }
  if (plan.version !== current || !/^[0-9a-f-]{36}$/.test(plan.id || '')) return;
  const update = { size: plan.size, sha256: plan.sha256 };
  if (plan.mode === 'portable') {
    if (!portable || path.resolve(portable).toLowerCase() !== path.resolve(plan.target || '.').toLowerCase() || !await verified(portable, update)) return;
    const backup = path.resolve(portable) + '.update-' + plan.id + '.bak';
    if (plan.backup !== backup) return;
    await fs.promises.rm(backup, { force: true }).catch(() => {});
  } else if (plan.mode !== 'setup') return;
  const names = [plan.id + '.ps1', plan.id + '.ready', plan.id + '.outcome.json', plan.id + '.cancel'];
  const source = path.basename(plan.source || '');
  if (/^Torchlight-Overlay-(?:Portable|Setup)-\d+\.\d+\.\d+-x64\.exe$/.test(source) && path.resolve(plan.source) === path.join(path.resolve(directory), source)) names.push(source);
  for (const name of names) await fs.promises.rm(path.join(directory, name), { force: true }).catch(() => {});
  await fs.promises.rm(file, { force: true }).catch(() => {});
}
module.exports = { kind, prepare, launch, cleanup };
