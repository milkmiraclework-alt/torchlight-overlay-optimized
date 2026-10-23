'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Development runtime: prefer the project's own Electron. Older source
// checkouts can still explicitly use an existing installation as a fallback.
function sourceExecutable() {
  if (process.env.TARTARUS_OVERLAY_EXE) return process.env.TARTARUS_OVERLAY_EXE;
  const own = path.resolve(__dirname, '../desktop/node_modules/electron/dist/electron.exe');
  if (!fs.existsSync(own)) throw new Error('Install project dependencies and Electron before running development checks.');
  return own;
}
function prepareRuntime(installedExe) {
  const source = path.dirname(installedExe);
  const target = path.resolve(__dirname, path.basename(installedExe).toLowerCase() === 'electron.exe' ? '../desktop/dist/source-runtime' : '../desktop/dist/local-runtime');
  const executable = path.join(target, path.basename(installedExe));
  const stamp = `${fs.statSync(installedExe).size}:${fs.statSync(installedExe).mtimeMs}`;
  fs.mkdirSync(target, { recursive: true });
  const stampFile = path.join(target, 'runtime-version');
  if (!fs.existsSync(stampFile) || fs.readFileSync(stampFile, 'utf8') !== stamp) {
    console.log('Preparing the local overlay runtime (once per Electron update)...');
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
      if (item.name === 'resources' || /^Uninstall /i.test(item.name)) continue;
      fs.cpSync(path.join(source, item.name), path.join(target, item.name), { recursive: true });
    }
    fs.writeFileSync(stampFile, stamp);
  }
  const resources = path.join(target, 'resources');
  fs.mkdirSync(resources, { recursive: true });
  const metadata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../desktop/package.json'), 'utf8'));
  const files = {
    'package.json': JSON.stringify({ name: metadata.name, productName: metadata.productName, version: metadata.version, main: 'index.js' }),
    'index.js': `require(${JSON.stringify(path.resolve(__dirname, '../desktop/main.js'))});`,
  };
  const header = { files: {} };
  const data = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.from(text);
    header.files[name] = { size: bytes.length, offset: String(offset) };
    data.push(bytes);
    offset += bytes.length;
  }
  // ASAR's two Chromium Pickles: header size, then a UTF-8 JSON string.
  const json = Buffer.from(JSON.stringify(header));
  const pickle = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  pickle.writeUInt32LE(pickle.length - 4, 0);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(pickle.length, 4);
  const noAsar = process.noAsar;
  try {
    process.noAsar = true;
    fs.writeFileSync(path.join(resources, 'app.asar'), Buffer.concat([size, pickle, ...data]));
  } finally { process.noAsar = noAsar; }
  return { executable, installedAsar: path.join(source, 'resources/app.asar') };
}
module.exports = { prepareRuntime, sourceExecutable };
