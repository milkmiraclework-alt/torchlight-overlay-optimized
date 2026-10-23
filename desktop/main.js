/* Torchlight Overlay: one local application, shared controls and automatic
 * Tartarus/Vorax routing. Reads the game; the player makes every move. */
'use strict';

const { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, screen, session, shell, webContents } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ---------- Options ----------

const arg = (name) => {
  const p = `--${name}=`;
  const a = process.argv.find((x) => x.startsWith(p));
  return a ? a.slice(p.length) : null;
};
const flag = (name) => process.argv.includes(`--${name}`);
const BUNDLED_ROOT = path.join(process.resourcesPath, 'site');
const STANDALONE = app.isPackaged && fs.existsSync(path.join(BUNDLED_ROOT, 'bundle.json'));
const OPTIMIZED = true;
const FAST = true;
let suite = null;
app.on('web-contents-created', (_, contents) => contents.setAudioMuted(true));
const localDependency = (name) => {
  return require(name);
};

const LIVE_SITE = 'https://blahdot3h.github.io/tartarus-simulator/';
let SITE = STANDALONE ? 'http://localhost:8090/' : arg('site') || process.env.TARTARUS_SITE || (OPTIMIZED ? 'http://localhost:8090/' : LIVE_SITE);
if (!SITE.endsWith('/')) SITE += '/';
let SITE_URL = new URL(SITE);
// #region game-title
const GAME_TITLE = new RegExp(arg('game-title') || '^Torchlight: Infinite\\s*$');
// #endregion
const LOG_OVERRIDE = arg('log');
const TEST = flag('test');
// Tests that need windows shown put them off every screen.
const OFFSCREEN = TEST && flag('offscreen');
const DEV = flag('dev') || TEST;
// The maintainer's debug build (--dev) keeps 1 GB of recorded runs; the
// normal build keeps the last few.
const BIG_RECORD = flag('dev');
const STEAM_APP = '1974050'; // Torchlight: Infinite on Steam
const HOTKEYS = { overlay: 'Control+Alt+O', analyzer: 'Control+Alt+A', instruments: 'Control+Alt+I', capture: 'Control+Alt+P' };
const ICON = path.join(__dirname, 'build', 'icon.png');

if (TEST && arg('app-data')) app.setPath('appData', path.resolve(arg('app-data')));
if (arg('user-data')) app.setPath('userData', path.resolve(arg('user-data')));
else app.setPath('userData', path.join(app.getPath('appData'), 'Torchlight Overlay'));
// The app's windows sit behind a full-screen game, hidden or not. Chromium
// treats a covered window as not drawn, and a window shown again could show
// an old, narrow picture of its page: every window draws as if in front.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.setAppUserModelId(OPTIMIZED ? 'io.github.milkmiraclework-alt.torchlight-overlay-optimized' : 'io.github.blahdot3h.tartarus-overlay');
// Acquire the unified profile before importing/writing anything. Installer
// relaunches must not write defaults over a running instance's settings.
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
const profileImport = arg('user-data') ? null : require('./lib/profile-import').importProfile({
  legacy: path.join(app.getPath('appData'), 'Tartarus Overlay'), target: app.getPath('userData')
});

// ---------- Settings ----------

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); // a byte-order mark (Notepad, PowerShell) is fine
  } catch (e) {
    return {};
  }
};
const settings = Object.assign({
  overlayOn: true, // the player can hide it (Ctrl+Alt+O)
  overlay: null, // { x, y }, where the player dragged it
  overlayWidth: 360,
  hideFromCaptures: true, // kept out of screenshots, recordings and the shared window
  hideBehind: false, // hidden while another window is in front of the game
  collapsed: false, // the overlay folded to a thin bar ("–" on it)
  record: !OPTIMIZED, // optional diagnostics; optimized play does not record every board
  recordLimitMB: 1024, // debug build (--dev): the record's room on disk, pictures included
  recordRuns: 5, // normal build: the runs the record keeps
  consent: null, // { version, at }: the player agreed on follow.html in the app, to that version
  logPath: '', // a log the player chose, when the app didn't find it
  analyzer: null, // the analyzer window's bounds
}, readJson(SETTINGS_FILE));
settings.record = false;
if (!['auto','tartarus','vorax'].includes(settings.mode)) settings.mode='auto';
const previousVorax=readJson(path.join(app.getPath('appData'),'VoraxRs','settings.json'));
if (!Number.isInteger(settings.shelley)) settings.shelley=previousVorax.shelley || 6;
delete settings.onlyWithGame; // 0.1.1 hid the overlay behind other windows by default
delete settings.locked; // before 0.2.5 the overlay could be locked (clicks went through)
// Before 0.1.7 the overlay's "–" hid it for good, and that was kept; now it
// folds the card. Anyone it hid gets the overlay back once.
if (!(settings.v >= 2)) {
  settings.overlayOn = true;
  settings.v = 2;
}
let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 300);
}
function flushSettings() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    // Remains in memory when the settings file cannot be written.
  }
}

// Older profiles inherited the author's record=true default. Disable that
// background work once on upgrade; a later explicit user opt-in is retained.
// Test/debug profiles can still request recording for their controlled checks.
if (OPTIMIZED && !TEST && !DEV && settings.optimizedRecordPolicy !== 1) {
  settings.record = false;
  settings.optimizedRecordPolicy = 1;
  saveSettings();
}

// ---------- The debug log ----------

// What the app did, for working out what went wrong in a test: the game
// starting and stopping, the log and window, each picture and the advice,
// errors. With --dev, the pages' own errors and warnings too. Never the
// game log's lines or a picture. At most 2 MB, then it starts over.
const LOG_FILE = path.join(app.getPath('userData'), 'logs', 'overlay.log');
function note(...parts) {
  const text = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  if (TEST) console.log(`[overlay] ${text}`);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE.replace(/\.log$/, '.old.log'));
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${text}\n`);
  } catch (e) {
    // No log this time.
  }
}
process.on('uncaughtException', (e) => note('error', String(e && e.stack || e)));
if (profileImport) note('legacy profile import:', profileImport);

// ---------- The site's pages ----------

// The site page a URL is, like 'analyze.html', or null for anything else.
function pageOf(url) {
  try {
    const u = new URL(url);
    if (u.origin !== SITE_URL.origin || !u.pathname.startsWith(SITE_URL.pathname)) return null;
    return u.pathname.slice(SITE_URL.pathname.length) || 'index.html';
  } catch (e) {
    return null;
  }
}
const PAGES = { follow: FAST ? 'desktop/lib/settings.html' : 'follow.html', analyzer: 'analyze.html' };
const ADAPTERS = { analyzer: 'analyzer-adapter.js' };

// ---------- Finding the game's log ----------

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, out) => {
      const m = !err && new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`).exec(out);
      resolve(m ? m[1].trim() : null);
    });
  });
}
const statOf = (p) => {
  try {
    return fs.statSync(p);
  } catch (e) {
    return null;
  }
};

// #region find-log
// Where the game writes UE_game.log. While the game runs, beside the game
// itself: Windows says where its program is (UE_game\Binaries\Win64), and
// the log is in UE_game\TorchLight\Saved\Logs. Otherwise under each Steam
// library that has the game, and under the launcher's default folder; the
// newest log there wins. A game under Program Files that can't write there
// has its log in Windows' VirtualStore copy, which is looked at too. Without
// a log yet, a folder of an installed game, where it appears once the game
// starts.
const virtualStore = (p) => (/^[a-z]:\\program files/i.test(p) && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'VirtualStore', p.slice(3)) : null);
// The game writes its log all the time while it runs: one that hasn't
// changed for 2 minutes then isn't the one it writes (reports 357, 365: a
// log left from another install, or Unreal's UE_game_2.log when the first
// was held open).
let logLookedAt = 0;
const STALE_MS = 120000;
function logStale() {
  if (!game.running || !logPath || Date.now() - gameSince < STALE_MS) return false;
  const st = statOf(logPath);
  return !st || Date.now() - st.mtimeMs > STALE_MS;
}
// The newest UE_game*.log in these folders, and when it last changed.
function newestLog(dirs) {
  let best = null;
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => /^UE_game(_\d+)?\.log$/i.test(n));
    } catch (e) {
      continue;
    }
    for (const n of names) {
      const p = path.join(dir, n);
      const st = statOf(p);
      if (st && st.isFile() && (!best || st.mtimeMs > best.st.mtimeMs)) best = { p, st };
    }
  }
  return best;
}
// The Logs folders beside the running game (and their VirtualStore copies).
function besideGame() {
  const program = game.running && game.hwnd && win32 ? win32.programOf(game.hwnd) : null;
  if (!program || !/torchlight/i.test(program)) return [];
  const own = path.resolve(path.dirname(program), '..', '..', 'TorchLight', 'Saved', 'Logs');
  return [own, virtualStore(own)].filter(Boolean);
}
async function findLog() {
  if (LOG_OVERRIDE) {
    logFoundBy = 'given';
    return path.resolve(LOG_OVERRIDE);
  }
  if (settings.logPath && statOf(path.dirname(settings.logPath))) {
    // A hand-picked log, unless the game stopped writing it and writes
    // another, beside it or beside the running game.
    const chosen = statOf(settings.logPath);
    const idle = game.running && Date.now() - gameSince > STALE_MS && (!chosen || Date.now() - chosen.mtimeMs > STALE_MS);
    const other = idle ? newestLog([path.dirname(settings.logPath), ...besideGame()]) : null;
    if (other && path.resolve(other.p) !== path.resolve(settings.logPath) && Date.now() - other.st.mtimeMs < STALE_MS) {
      logFoundBy = 'being written (the chosen one isn’t)';
      return other.p;
    }
    logFoundBy = 'chosen by the player';
    return settings.logPath;
  }
  const own = newestLog(besideGame());
  if (own) {
    logFoundBy = 'beside the running game';
    return own.p;
  }
  logFoundBy = 'in the game folders';
  const roots = new Map();
  const addRoot = (p) => p && roots.set(path.resolve(p).toLowerCase(), path.resolve(p));
  for (const [key, value] of [['HKCU\\Software\\Valve\\Steam', 'SteamPath'], ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'], ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']]) addRoot(await regQuery(key, value));
  addRoot('C:\\Program Files (x86)\\Steam');
  const libraries = new Map(roots);
  for (const root of roots.values()) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
        const lib = path.resolve(m[1].replace(/\\\\/g, '\\'));
        libraries.set(lib.toLowerCase(), lib);
      }
    } catch (e) {
      // Not a Steam folder.
    }
  }
  const logs = [];
  for (const lib of libraries.values()) {
    try {
      const acf = fs.readFileSync(path.join(lib, 'steamapps', `appmanifest_${STEAM_APP}.acf`), 'utf8');
      const m = /"installdir"\s+"([^"]+)"/.exec(acf);
      if (m) logs.push(path.join(lib, 'steamapps', 'common', m[1], 'UE_game', 'TorchLight', 'Saved', 'Logs', 'UE_game.log'));
    } catch (e) {
      // The game isn't in this library.
    }
  }
  for (const base of ['C:\\Program Files (x86)\\Torchlight Infinite', 'C:\\Program Files\\Torchlight Infinite']) {
    logs.push(path.join(base, 'Game', 'UE_game', 'Torchlight', 'Saved', 'Logs', 'UE_game.log'));
  }
  for (const p of [...logs]) if (virtualStore(p)) logs.push(virtualStore(p));
  const there = newestLog([...new Set(logs.map((p) => path.dirname(p)))]);
  if (there) return there.p;
  // UE_game\TorchLight is there: the game is installed, and writes its log on start.
  return logs.find((p) => statOf(path.resolve(p, '..', '..', '..'))) || null;
}

// #endregion
let logPath = null;
let stopLogWatch = null;
app.on('will-quit', () => { if (saveTimer) flushSettings(); if (stopLogWatch) stopLogWatch(); });
let logFoundBy = '';
let logNoted = '';
async function refreshLog() {
  const found = await findLog();
  if (`${found}|${logFoundBy}` !== logNoted) {
    logNoted = `${found}|${logFoundBy}`;
    note(`log file (${logFoundBy}):`, found || 'not found');
  }
  if (found !== logPath) {
    logPath = found;
    if (FAST) {
      if (stopLogWatch) stopLogWatch();
      suite?.setLog(found);
      stopLogWatch = found ? require('./lib/log-watch.js').watchLog(found, () => { suite?.poll(); send('analyzer', 'log:changed'); }) : null;
    }
    pushGame();
    rebuildMenu();
  }
}

async function pickLog() {
  const res = await dialog.showOpenDialog({
    title: 'Choose UE_game.log',
    defaultPath: logPath || undefined,
    properties: ['openFile'],
    filters: [{ name: 'Torchlight: Infinite log', extensions: ['log'] }],
  });
  if (res.canceled || !res.filePaths[0]) return;
  settings.logPath = res.filePaths[0];
  saveSettings();
  await refreshLog();
}

// ---------- The game window ----------

// #region game-window
// What a browser can't see: which program a window is. The game window is
// found by its title, every few seconds.
let game = { running: false, title: '', hwnd: 0 };
let gameSince = 0; // when the game was last found running
// The game counts as closed only after its window has been missing for
// three looks in a row: a failed look, or a moment between two windows
// (loading screens), doesn't hide the overlay or end the share.
let missing = 0;
async function lookForGame() {
  let source = null;
  let looked = false;
  try {
    if (win32) {
      const found = win32.findWindow(GAME_TITLE, game.hwnd);
      source = found ? { name: found.title, id: `window:${found.hwnd}:0` } : null;
    } else {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      source = sources.find((s) => GAME_TITLE.test(s.name)) || null;
    }
    looked = true;
  } catch (e) {
    // Try again next time.
  }
  missing = source ? 0 : missing + (looked ? 1 : 0);
  if (!source && (!looked || (game.running && missing < 3))) {
    setTimeout(lookForGame, 2000);
    return;
  }
  const was = game.running;
  const wasHwnd = game.hwnd;
  game = { running: !!source, title: source ? source.name.trim() : '', hwnd: source ? Number(source.id.split(':')[1]) || 0 : 0 };
  if (was && game.running && wasHwnd && game.hwnd !== wasHwnd) {
    note('game window changed');
    pushGame();
  }
  if (!was && game.running) gameSince = Date.now();
  // A log the game stopped writing gives way to one it's writing.
  if (game.running && Date.now() - logLookedAt > 30000) {
    logLookedAt = Date.now();
    if (logStale()) refreshLog();
  }
  if (game.running !== was) {
    note(game.running ? `game running: "${game.title}"` : 'game closed');
    recordEvent({ type: game.running ? 'game' : 'game-closed' });
    if (game.running) await refreshLog();
    if (game.running && !overlayPlaced) placeOverlay();

    pushGame();
    rebuildMenu();
  }
  setTimeout(lookForGame, 2000);
}

// #endregion
// The window in front, and window rectangles, from Windows itself. Without
// them, the overlay shows whenever the game runs.
const win32 = (() => {
  try {
    const koffi = localDependency('koffi');
    const user32 = koffi.load('user32.dll');
    const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const foreground = user32.func('__stdcall', 'GetForegroundWindow', 'intptr', []);
    const rect = user32.func('__stdcall', 'GetWindowRect', 'bool', ['intptr', koffi.out(koffi.pointer(RECT))]);
    const iconic = user32.func('__stdcall', 'IsIconic', 'bool', ['intptr']);
    const kernel32 = koffi.load('kernel32.dll');
    const windowPid = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['intptr', koffi.out(koffi.pointer('uint32'))]);
    const openProcess = kernel32.func('__stdcall', 'OpenProcess', 'intptr', ['uint32', 'bool', 'uint32']);
    const imageName = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'bool', ['intptr', 'uint32', 'void *', koffi.inout(koffi.pointer('uint32'))]);
    const closeHandle = kernel32.func('__stdcall', 'CloseHandle', 'bool', ['intptr']);
    const nextWindow = user32.func('__stdcall', 'FindWindowExW', 'intptr', ['intptr', 'intptr', 'void *', 'void *']);
    const windowText = user32.func('__stdcall', 'GetWindowTextW', 'int', ['intptr', 'void *', 'int']);
    const visible = user32.func('__stdcall', 'IsWindowVisible', 'bool', ['intptr']);
    return {
      // Native title lookup avoids Chromium's costly window-capture
      // enumeration every two seconds, including while outside the mode.
      findWindow(re, known) {
        const buf = Buffer.alloc(1024);
        const fits = (hwnd) => {
          if (!visible(hwnd)) return null;
          const n = windowText(hwnd, buf, 512);
          const title = n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
          if (!re.test(title)) return null;
          const pid = [0]; windowPid(hwnd, pid);
          return pid[0] === process.pid && !TEST ? null : { title, hwnd: Number(hwnd) };
        };
        // The largest that fits: a launcher can share the game's title
        // (reports 371, 372, 379), and the game's own window is the big one.
        // A minimized one keeps its place.
        if (known && iconic(known)) {
          const again = fits(known);
          if (again) return again;
        }
        let best = null;
        for (let h = Number(nextWindow(0, 0, null, null)), guard = 0; h && guard < 4096; h = Number(nextWindow(0, h, null, null)), guard++) {
          const found = fits(h);
          if (!found) continue;
          const r = {};
          const area = rect(h, r) ? (r.right - r.left) * (r.bottom - r.top) : 0;
          if (!best || area > best.area || (area === best.area && h === known)) best = { title: found.title, hwnd: h, area };
        }
        return best ? { title: best.title, hwnd: best.hwnd } : null;
      },
      // Where the program behind a window is: only its file's name
      // (PROCESS_QUERY_LIMITED_INFORMATION reads nothing else of it).
      programOf(hwnd) {
        const pid = [0];
        windowPid(hwnd, pid);
        if (!pid[0]) return null;
        const h = openProcess(0x1000, false, pid[0]);
        if (!h) return null;
        try {
          const buf = Buffer.alloc(4096);
          const size = [2048];
          return imageName(h, 0, buf, size) ? buf.toString('utf16le', 0, size[0] * 2) : null;
        } finally {
          closeHandle(h);
        }
      },
      foreground: () => Number(foreground()),
      rect(hwnd) {
        const r = {};
        return rect(hwnd, r) ? { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } : null;
      },
      minimized: (hwnd) => !!iconic(hwnd),
    };
  } catch (e) {
    return null;
  }
})();
const hwndOf = (win) => {
  if (!win || win.isDestroyed()) return 0;
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
};

// Screenshot/session recording is excluded from this application.
const recordEvent = () => {};

// ---------- Windows ----------

const wins = { follow: null, analyzer: null, overlay: null, review: null };
let analyzerAdapterReady = false, pendingAnalyzerCommand = null;
let testStandIn = null;
let quitting = false;
let tray = null;

function sitePreferences() {
  return { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: true, spellcheck: false, additionalArguments: FAST ? ['--tartarus-fast'] : [] };
}

function loadPage(name) {
  const win = wins[name];
  win.loadURL(SITE + PAGES[name], { extraHeaders: 'pragma: no-cache\n' }).catch(() => {
    // did-fail-load retries.
  });
}

function makeSiteWindow(name, opts) {
  const win = new BrowserWindow(Object.assign({
    show: false,
    width: 1100,
    height: 860,
    backgroundColor: '#0f1216',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: sitePreferences(),
  }, opts));
  win.removeMenu();
  wins[name] = win;
  const wc = win.webContents;
  if (name === 'analyzer') wc.on('did-start-loading', () => { analyzerAdapterReady = false; });
  if (FAST) {
    win.on('show', () => wc.send('desktop:visible', true));
    win.on('hide', () => wc.send('desktop:visible', false));
  }
  // The adapter goes in once the page's own scripts have run.
  wc.on('dom-ready', () => {
    if (pageOf(wc.getURL()) !== PAGES[name]) return;
    if (FAST && name === 'follow') return;
    const code = fs.readFileSync(path.join(__dirname, 'lib', ADAPTERS[name]), 'utf8');
    note(`${name} page loaded:`, wc.getURL());
    wc.executeJavaScript(code, true).then(() => {
      if (name !== 'analyzer') return;
      analyzerAdapterReady = true;
      if (pendingAnalyzerCommand) { send('analyzer', 'command', pendingAnalyzerCommand); pendingAnalyzerCommand = null; }
    }).catch((e) => note(`${name} adapter error:`, String((e && e.message) || e)));
    if (FAST && name === 'analyzer') wc.executeJavaScript(fs.readFileSync(path.join(__dirname, 'lib', 'fast-runtime.js'), 'utf8'), true).catch((e) => note('runtime error:', String(e.stack || e)));
  });
  // The page's own errors (and with --dev, its warnings), for the debug log.
  wc.on('console-message', (e, ...old) => {
    const level = e.level !== undefined ? e.level : old[0];
    const message = e.message !== undefined ? e.message : old[1];
    const where = `${e.sourceId !== undefined ? e.sourceId : old[3]}:${e.lineNumber !== undefined ? e.lineNumber : old[2]}`;
    if (/Electron Security Warning/.test(String(message))) return; // shown only when run from source
    if (level === 'error' || level === 3 || (DEV && (level === 'warning' || level === 2))) note(`${name} console ${level}:`, String(message).slice(0, 600), where);
  });
  // Offline, or the site is down: try again.
  wc.on('did-fail-load', (e, code, text, url, mainFrame) => {
    if (!mainFrame || code === -3) return; // -3: a load replaced by another
    note(`${name} page failed to load:`, code, text);
    pushShell({ offline: `${PAGES[name]}: ${text}` });
    setTimeout(() => !win.isDestroyed() && loadPage(name), 15000);
  });
  wc.on('did-finish-load', () => pushShell({ offline: '' }));
  wc.on('render-process-gone', (e, details) => {
    note(`${name} page crashed:`, details && details.reason);
    setTimeout(() => !win.isDestroyed() && loadPage(name), 1000);
  });
  // Only this window's own page loads in it. Links to the other app page
  // show that window; anything else opens in the player's browser.
  wc.on('will-navigate', (e, url) => {
    if (pageOf(url) === PAGES[name]) return;
    e.preventDefault();
    if (!route(url) && /^https?:/i.test(url)) shell.openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (route(url)) return { action: 'deny' };
    // A picture's preview on follow.html.
    if (url.startsWith('blob:')) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, webPreferences: { preload: undefined, sandbox: true, contextIsolation: true } } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (DEV) {
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') wc.toggleDevTools();
    });
  }
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  loadPage(name);
  return win;
}

// A link to another app page shows that window.
function route(url) {
  const page = pageOf(url);
  const name = Object.keys(PAGES).find((k) => PAGES[k] === page);
  if (!name) return false;
  show(name);
  return true;
}

function show(name) {
  if (FAST && name === 'follow' && !wins.follow) makeSiteWindow('follow', { width: 620, height: 740, title: 'Torchlight Overlay settings' });
  const win = wins[name];
  if (!win || win.isDestroyed()) return;
  if (OFFSCREEN) win.setPosition(Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - win.getSize()[0] - 400, 0);
  if (win.isMinimized()) win.restore();
  if (OFFSCREEN) win.showInactive();
  else { win.show(); win.focus(); }
  redraw(win);
}

// A window shown after being hidden can show an old, narrow picture of its
// page until something makes it draw again: a size nudge lays the page out
// at its real size, and it's drawn again in full twice over.
function redraw(win) {
  const paint = () => !win.isDestroyed() && win.webContents.invalidate();
  if (!win.isMaximized() && !win.isFullScreen()) {
    const [w, h] = win.getSize();
    setTimeout(() => !win.isDestroyed() && win.setSize(w + 1, h + 1), 50);
    setTimeout(() => !win.isDestroyed() && win.setSize(w, h), 150);
  }
  setTimeout(paint, 300);
  setTimeout(paint, 1000);
}

function toggle(name) {
  const win = wins[name];
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else show(name);
}

function showInstruments() {
  const win = wins.analyzer;
  if (!win || win.isDestroyed()) return;
  if (!OFFSCREEN) {
    const rect = game.hwnd && win32 ? win32.rect(game.hwnd) : null;
    const display = rect ? screen.getDisplayMatching(rect) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (win.isMinimized()) win.restore();
    if (win.isMaximized()) win.unmaximize();
    win.setBounds(require('./lib/window-position.js').centered(win.getBounds(), display.workArea));
  }
  show('analyzer');
  if (analyzerAdapterReady) send('analyzer', 'command', 'tools');
  else pendingAnalyzerCommand = 'tools';
}

function makeAnalyzer() {
  const b = settings.analyzer && onScreen(settings.analyzer) ? settings.analyzer : null;
  const win = makeSiteWindow('analyzer', Object.assign({ width: 1280, height: 900, title: 'Tartarus board correction · Torchlight Overlay' }, b || {}));
  const keep = () => {
    if (win.isMaximized() || win.isMinimized()) return;
    settings.analyzer = win.getBounds();
    saveSettings();
  };
  win.on('moved', keep);
  win.on('resized', keep);
  return win;
}

// ---------- The overlay ----------

let overlayPlaced = false;

const onScreen = (b) => screen.getAllDisplays().some((d) => {
  const a = d.workArea;
  return b.x + 60 > a.x && b.x < a.x + a.width - 60 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
});

// Where the player left it; at first, the game window's top right corner,
// or the main screen's.
function placeOverlay() {
  const win = wins.overlay;
  if (!win) return;
  const w = settings.overlayWidth;
  let at = settings.overlay && onScreen(settings.overlay) ? settings.overlay : null;
  if (at) overlayPlaced = true;
  else {
    let area = screen.getPrimaryDisplay().workArea;
    const r = game.running && win32 ? win32.rect(game.hwnd) : null;
    if (r && r.width > 200) {
      area = screen.screenToDipRect(null, r);
      overlayPlaced = true;
    }
    at = { x: Math.round(area.x + area.width - w - 24), y: Math.round(area.y + Math.min(140, area.height / 8)) };
  }
  const b = win.getBounds();
  win.setBounds({ x: at.x, y: at.y, width: w, height: b.height });
}

function makeOverlay() {
  const win = new BrowserWindow({
    width: settings.overlayWidth,
    height: 150,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // clicks on it don't take the game out of focus
    hasShadow: false,
    title: 'Tartarus Overlay',
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'lib', 'overlay-preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  wins.overlay = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(!!settings.hideFromCaptures);
  win.loadFile(path.join(__dirname, 'lib', 'overlay.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-finish-load', () => {
    pushShell();
    pushGame();
    if (lastAdvice) send('overlay', 'advice', lastAdvice);
    if (lastFollow) send('overlay', 'follow', lastFollow);
  });
  win.on('moved', () => {
    const b = win.getBounds();
    settings.overlay = { x: b.x, y: b.y };
    saveSettings();
  });
  win.on('close', (e) => {
    if (!quitting) e.preventDefault();
  });
  placeOverlay();
  return win;
}

// Shown while the game runs, whatever is in front. With hideBehind (the
// tray menu), only while the game itself is in front.
let overlayShown = false;
function overlayWanted() {
  if (!settings.overlayOn || !game.running || (suite && suite.mode !== 'tartarus')) return false;
  if (!settings.hideBehind || !win32) return true;
  const front = win32.foreground();
  if (front === game.hwnd) return !win32.minimized(game.hwnd);
  return front === hwndOf(wins.overlay);
}
function updateOverlay() {
  const win = wins.overlay;
  if (!win || win.isDestroyed()) return;
  const want = overlayWanted();
  if (want === overlayShown) return;
  overlayShown = want;
  if (want) {
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  } else win.hide();
}

function setOverlayOn(on) {
  settings.overlayOn = !!on;
  suite?.sync();
  saveSettings();
  updateOverlay();
  rebuildMenu();
}

// ---------- Between the pages and the overlay ----------

const send = (name, channel, data) => {
  const win = wins[FAST && name === 'follow' ? 'analyzer' : name];
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
};
const sender = (e, name) => !!wins[name] && !wins[name].isDestroyed() && e.sender === wins[name].webContents;
const fromPage = (e, name) => {
  if (FAST && name === 'follow' && sender(e, 'analyzer')) name = 'analyzer';
  return sender(e, name) && !!e.senderFrame && pageOf(e.senderFrame.url) === PAGES[name];
};

function gameInfo() {
  return { running: game.running, title: game.title, window: game.hwnd || 0, log: logPath ? { path: logPath, name: path.basename(logPath), there: !!statOf(logPath) } : null };
}
function pushGame() {
  suite?.sync();
  const g = gameInfo();
  send('follow', 'game', g);
  send('overlay', 'game', g);
}

let siteUpdate = false;
let appUpdate = '';
let upstreamUpdate = null;
let shellExtra = { offline: '' };
let agreed = null; // whether the player agreed on follow.html, once it says
function pushShell(patch) {
  if (patch) Object.assign(shellExtra, patch);
  send('overlay', 'shell', Object.assign({
    collapsed: settings.collapsed,
    riot,
    runOver,
    agreed,
    siteUpdate,
    appUpdate,
    upstreamUpdate,
    hotkeys: HOTKEYS,
    local: /^(localhost|127\.0\.0\.1)$/.test(SITE_URL.hostname),
    version: app.getVersion(),
  }, shellExtra));
}

let lastAdvice = null;
let lastFollow = null;
const small = (data) => {
  try {
    return JSON.stringify(data).length < 50000;
  } catch (e) {
    return false;
  }
};

// #region consent
// The agreement on follow.html belongs to the app: given once, a copy of
// the page from another address (the local test site) or a new install
// doesn't ask again, while the page's agreement version is the same. Turning
// it off on the page clears it here too.
ipcMain.handle('consent:get', (e) => (fromPage(e, 'follow') ? settings.consent : null));
const fastConfig = () => ({ consent: settings.consent, speed: !!settings.speed, record: false, mode: settings.mode || 'auto', activeMode: suite?.mode || 'idle', shelley: settings.shelley || 6, threads: settings.threads || 0, suite: suite?.info() || null });
function publishFastConfig() {
  send('analyzer', 'fast:settings', fastConfig());
  if (wins.follow && !wins.follow.isDestroyed()) wins.follow.webContents.send('fast:settings', fastConfig());
}
ipcMain.handle('fast:settings', (e) => fromPage(e, 'follow') ? fastConfig() : null);
ipcMain.handle('desktop:visible', (e) => fromPage(e, 'analyzer') && wins.analyzer.isVisible());
ipcMain.on('fast:set-settings', (e, patch) => {
  if (!fromPage(e, 'follow') || !patch || typeof patch !== 'object') return;
  const restart = ['shelley', 'threads'].some(key => key in patch && patch[key] !== settings[key]);
  if (typeof patch.speed === 'boolean') settings.speed = patch.speed;
  if (['auto', 'tartarus', 'vorax'].includes(patch.mode)) settings.mode = patch.mode;
  if (Number.isInteger(patch.shelley) && patch.shelley >= 1 && patch.shelley <= 6) settings.shelley = patch.shelley;
  if (Number.isInteger(patch.threads) && patch.threads >= 0 && patch.threads <= 128) settings.threads = patch.threads;
  settings.record = false; saveSettings();
  if (restart) suite?.reconfigure(); else suite?.sync();
  publishFastConfig(); rebuildMenu();
});
ipcMain.handle('suite:info', e => (TEST || DEV) && fromPage(e, 'analyzer') ? {
  ...suite?.info(), profile: app.getPath('userData'),
  windows: { settings: !!wins.follow?.isVisible(), board: !!wins.analyzer?.isVisible() }
} : null);
ipcMain.on('suite:read', e => { if (fromPage(e, 'follow')) command('capture'); });
ipcMain.on('consent:set', (e, value) => {
  if (!fromPage(e, 'follow')) return;
  const at = value && typeof value.at === 'string' ? value.at.slice(0, 40) : new Date().toISOString();
  const next = value && value.withdrawn === true ? { withdrawn: true, at }
    : value && Number.isInteger(value.version) && value.version > 0 ? { version: value.version, at } : null;
  if (JSON.stringify(next) === JSON.stringify(settings.consent)) return;
  settings.consent = next;
  suite?.sync();
  if (FAST) publishFastConfig();
  saveSettings();
  note(!next ? 'agreement cleared' : next.withdrawn ? 'agreement withdrawn: off for the app' : `agreement remembered for the app (version ${next.version})`);
});

// An agreement given on the live site before the app remembered agreements:
// read once from that page, so the test copy doesn't ask again.
// #endregion
ipcMain.handle('game:get', (e) => (sender(e, 'follow') || sender(e, 'overlay') || (FAST && fromPage(e, 'analyzer')) ? gameInfo() : null));

// #region read-log
// The log, for follow.html only: its size, and the bytes it asks for.
ipcMain.handle('log:stat', async (e) => {
  if (!fromPage(e, 'follow') || !logPath) return null;
  try {
    const st = await fs.promises.stat(logPath);
    return st.isFile() ? { name: path.basename(logPath), size: st.size } : null;
  } catch (err) {
    return null;
  }
});
// A log dropped on follow.html (its path, from the app) or chosen in the
// app's own file window: the app reads it, wherever it is.
ipcMain.on('log:use', async (e, file) => {
  if (!fromPage(e, 'follow') || typeof file !== 'string' || !/\.log$/i.test(file)) return;
  const st = statOf(file);
  if (!st || !st.isFile()) return;
  settings.logPath = file;
  saveSettings();
  note('log chosen by the player:', file);
  await refreshLog();
});
ipcMain.on('log:pick', (e) => {
  if (fromPage(e, 'follow')) pickLog();
});

ipcMain.handle('log:read', async (e, start, end) => {
  if (!fromPage(e, 'follow') || !logPath) throw new Error('No log.');
  const from = Math.max(0, Math.floor(Number(start) || 0));
  const length = Math.min(Math.max(0, Math.floor(Number(end) || 0) - from), 4 * 1024 * 1024);
  const fh = await fs.promises.open(logPath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, from);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
});

// #endregion
// What follow.html is doing, and the analyzer's advice, for the overlay.
ipcMain.on('site:follow', (e, data) => {
  if (!fromPage(e, 'follow') || !data || !small(data)) return;
  const was = lastFollow || {};
  lastFollow = data;
  if (data.log !== was.log || data.window !== was.window || data.agreed !== was.agreed) note(`follow: agreed=${data.agreed} log=${data.log}${data.error ? ` (${data.error})` : ''} window=${data.window}`);
  const f = data.lastFrame;
  if (f && (!was.lastFrame || f.at !== was.lastFrame.at)) note(`picture: ${f.kind}${f.ok ? '' : ` (none taken: ${f.why})`}${f.settle ? `; settle=${f.settle.mode}, waited=${f.settle.waitedMs}ms, probe=${f.settle.readiness?.reason || 'none'}, probes=${f.settle.readiness?.probes || 0}` : ''}`);
  if (typeof data.agreed === 'boolean' && data.agreed !== agreed) {
    agreed = data.agreed;
    // Before anything runs, the player reads follow.html and agrees there.
    if (!agreed && (!TEST || OFFSCREEN)) show('follow');
    pushShell();
  }
  send('overlay', 'follow', data);
});
// The Riot folds the overlay until the fight is over, unless the player
// had it folded already; it unfolds only what it folded, and a fold or
// unfold by the player during the fight is theirs.
let riot = false;
let riotFolded = false;
ipcMain.on('site:riot', (e, on) => {
  if (!fromPage(e, 'follow') || !!on === riot) return;
  riot = !!on;
  note(riot ? 'Riot: the fight is on' : 'back in the prison');
  recordEvent({ type: riot ? 'riot' : 'riot-over' });
  if (riot && !settings.collapsed) {
    settings.collapsed = true;
    riotFolded = true;
  } else if (!riot && riotFolded) {
    settings.collapsed = false;
    riotFolded = false;
  }
  pushShell();
});

// Ignore on the Riot screen ends the run: its record is closed (the next
// picture starts a new run's folder), the analyzer clears its board (which
// also ends its shared run), and the overlay says the run is over until the
// next one begins.
let runOver = false;
ipcMain.on('site:run', (e, what) => {
  if (!fromPage(e, 'follow')) return;
  if (what === 'over' && !runOver) {
    runOver = true;
    note('run over: its record is closed, the analyzer cleared');
    recordEvent({ type: 'run-over' });
    send('analyzer', 'command', 'run-over');
    pushShell();
  } else if (what === 'new' && runOver) {
    runOver = false;
    pushShell();
  }
});

// Each trigger the log matched (its kind), and once a minute while the game
// runs, how Auto Screenshot Mode is doing in numbers: for the debug log,
// to find out why pictures don't come. Never the game log's lines.
ipcMain.on('site:trigger', (e, kind) => {
  if (fromPage(e, 'follow')) note('trigger:', String(kind));
});
let checked = null; // the counts at the last minute's note
setInterval(() => {
  const f = lastFollow;
  if (!f || !game.running) return;
  const d = f.diag || {};
  const was = checked || { lines: 0, hits: 0, frames: 0, failed: 0 };
  const still = d.growingAt ? Math.round((Date.now() - d.growingAt) / 1000) : null;
  note(`check: log=${f.log} window=${f.window}${f.windowSize ? ` (${f.windowSize})` : ''} game log detail=${f.detail || '?'}; log file ${d.logSize || '?'} bytes, ${still === null ? 'not measured' : still < 15 ? 'growing' : `unchanged for ${still} s`}; this minute: ${(f.lines || 0) - was.lines} lines read, ${(f.hits || 0) - was.hits} triggers, ${(f.frames || 0) - was.frames} pictures, ${(d.failed || 0) - was.failed} failed${d.lastNote ? `; last picture: ${d.lastNote}` : ''}`);
  checked = { lines: f.lines || 0, hits: f.hits || 0, frames: f.frames || 0, failed: d.failed || 0 };
}, 60000);

ipcMain.on('site:advice', (e, data) => {
  if (!fromPage(e, 'analyzer') || !data || !small(data)) return;
  const was = lastAdvice || {};
  const r = data.lastRead;
  if (r && (!was.lastRead || r.at !== was.lastRead.at)) {
    const what = r.pick ? `instrument offer: ${(r.names || []).join(', ')}` : r.objective ? `objective: ${r.name}` : r.treasure ? "Warden's Treasure" : `day ${r.day}`;
    note(`read: ${r.ok ? what + (r.unsure ? `, ${r.unsure} to check` : '') : `failed (${r.reason})`}`);
  }
  const sum = (a) => (a.problems && a.problems.length ? `board problem: ${a.problems[0]}` : a.working ? 'working' : a.stale ? 'board changed' : a.move ? `advice: ${a.move}` : a.nothing ? 'nothing to decide' : '');
  if (sum(data) !== sum(was) && sum(data) && sum(data) !== 'working') note(sum(data));
  if (data.toolsConfirm && data.toolsConfirm !== was.toolsConfirm) note('instruments to confirm:', data.toolsConfirm);
  lastAdvice = data;
  send('overlay', 'advice', data);
});

// The overlay's buttons.
ipcMain.on('overlay:command', (e, cmd) => {
  if (sender(e, 'overlay')) command(cmd);
});
ipcMain.on('overlay:size', (e, height) => {
  if (!sender(e, 'overlay')) return;
  const b = wins.overlay.getBounds();
  const h = Math.max(36, Math.min(900, Math.ceil(Number(height) || 0)));
  if (h !== b.height) wins.overlay.setBounds({ x: b.x, y: b.y, width: settings.overlayWidth, height: h });
});

function command(cmd) {
  note('command:', cmd);
  recordEvent({ type: 'command', cmd: String(cmd) });
  switch (cmd) {
    case 'board': return lastAdvice?.toolsConfirm ? showInstruments() : toggle('analyzer');
    case 'tools': return showInstruments();
    case 'follow': return show('follow');
    case 'capture':
      // Auto Screenshot Mode is off: its page, to turn it on (report 380).
      if (!settings.consent || settings.consent.withdrawn) return show('follow');
      if (suite?.manual() === 'vorax') return;
      return send('follow', 'command', 'capture');
    case 'fix':
      show('analyzer');
      return send('analyzer', 'command', 'fix');
    case 'recheck':
    case 'tools-ok':
    case 'treasure-now':
      return send('analyzer', 'command', cmd);
    case 'debug-report': return shell.openPath(LOG_FILE);
    case 'enable-log':
      // The Auto Screenshot Mode page's box on turning on the game's log.
      show('follow');
      if (wins.follow) wins.follow.webContents.executeJavaScript("(() => { const box = document.getElementById('follow-enable-log'); if (box) box.scrollIntoView({ block: 'start' }); return true; })()").catch(() => {});
      return undefined;
    case 'report':
    case 'report-new':
      show('analyzer');
      return send('analyzer', 'command', cmd);
    case 'hide':
      setOverlayOn(false);
      if (tray && !TEST) tray.displayBalloon({ title: 'Overlay hidden', content: `Press ${HOTKEYS.overlay.replace(/Control/, 'Ctrl')} to show it again, or use the tray icon.`, iconType: 'info' });
      return undefined;
    case 'collapse':
      riotFolded = false;
      settings.collapsed = !settings.collapsed;
      saveSettings();
      return pushShell();
    case 'review': return show('follow');
    case 'pick-log': return pickLog();
    case 'reload': return wins.analyzer?.webContents.reloadIgnoringCache();
    case 'restart': app.relaunch(); return app.quit();
    case 'upstream-update': if (upstreamUpdate) shell.openExternal(upstreamUpdate.url); return;
    default: return undefined;
  }
}

// #region share-game
// Only follow.html may share a window, and the only window it gets is the
// game's, found by its title. A whole screen or another window never is.
function allowCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const captureName = FAST ? 'analyzer' : 'follow';
    const wc = wins[captureName] && !wins[captureName].isDestroyed() ? wins[captureName].webContents : null;
    let mine = !!wc && !!request.frame && pageOf(request.frame.url) === PAGES[captureName];
    if (mine && typeof webContents.fromFrame === 'function') mine = webContents.fromFrame(request.frame) === wc;
    if (!mine) {
      note('window share refused: not asked by follow.html');
      return callback({});
    }
    desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      .then((sources) => {
        // The game's window by its handle, then by its title (a launcher
        // can share the title, reports 371 and 372).
        let s = game.hwnd ? sources.find((x) => x.id.startsWith(`window:${game.hwnd}:`)) : sources.find((x) => GAME_TITLE.test(x.name));
        if (s) note(`window share: "${s.name.trim()}"`);
        else if (game.running && game.hwnd) {
          // Windows has the game's window, but the capture's list left it out
          // (reports 175 and 180): it's asked for by its handle.
          s = { id: `window:${game.hwnd}:0`, name: game.title };
          note(`window share: "${game.title}" by its handle`);
        } else note('window share refused: no game window');
        callback(s ? { video: s } : {});
      })
      .catch((e) => {
        note('window share failed:', String((e && e.message) || e));
        callback({});
      });
  });
  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen']);
  const ok = (url) => !!pageOf(url || '');
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(allowed.has(permission) && ok(details.requestingUrl || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && origin === SITE_URL.origin);
}

// #endregion
// ---------- Tray and hotkeys ----------

const keyName = (k) => k.replace('Control', 'Ctrl');

function rebuildMenu() {
  if (!tray) return;
  tray.setToolTip('Torchlight Overlay - ' + (suite?.mode || 'idle'));
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Mode: '+(suite?.mode || 'idle'),enabled:false},
    {label:'Settings',click:()=>show('follow')},
    {label:'Show overlay',type:'checkbox',checked:settings.overlayOn,click:i=>setOverlayOn(i.checked)},
    {label:'Read screen now',accelerator:HOTKEYS.capture,click:()=>command('capture')},
    {label:'Correct Tartarus board',click:()=>show('analyzer')},
    {label:'Check Tartarus instruments',accelerator:HOTKEYS.instruments,click:()=>showInstruments()},
    {type:'separator'},
    {label:'Choose game log',click:()=>pickLog()},
    {label:'Open diagnostic log',click:()=>shell.openPath(LOG_FILE)},
    {label:'Version '+app.getVersion(),enabled:false},
    {type:'separator'},
    {label:'Quit',click:()=>{quitting=true;app.quit();}}
  ]));
}

function makeTray() {
  let image = nativeImage.createFromPath(ICON);
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.on('click', () => show('follow'));
  rebuildMenu();
}

function registerHotkeys() {
  if (TEST) return;
  for (const [key,fn] of [['Control+Alt+X',()=>command('capture')],['Control+Alt+V',()=>setOverlayOn(!settings.overlayOn)],['Control+Alt+Q',()=>app.quit()]]) globalShortcut.register(key,fn);
  const actions = {
    overlay: () => setOverlayOn(!settings.overlayOn),
    analyzer: () => command('board'),
    instruments: () => showInstruments(),
    capture: () => command('capture'),
  };
  for (const [name, key] of Object.entries(HOTKEYS)) {
    try {
      if (!globalShortcut.register(key, actions[name])) note(`hotkey ${key} is taken by another program: use the tray menu`);
    } catch (e) {
      // Taken by another program: the tray menu still works.
    }
  }
}

// ---------- Start ----------

{
  let settingsRequested = false;
  app.on('second-instance', () => {
    note('additional launch: opening common settings');
    settingsRequested = true;
    if (wins.analyzer && !wins.analyzer.isDestroyed()) { show('follow'); settingsRequested = false; }
  });
  app.on('window-all-closed', () => {
    // The app lives in the tray.
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); suite?.close(); });

  // Tests stop the app with "quit" on its input, as the tray's Quit does,
  // so the pages' storage is written out.
  if (TEST && process.stdin) {
    process.stdin.on('data', (d) => {
      const text = String(d);
      if (/quit/.test(text)) {
        quitting = true;
        app.quit();
      }
      // "hide follow": as the player closes that window with its X.
      const hide = /hide (w+)/.exec(text);
      if (hide && wins[hide[1]] && !wins[hide[1]].isDestroyed()) wins[hide[1]].hide();
    });
  }

  app.whenReady().then(async () => {
    if (TEST && flag('offline-check')) session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      callback({ cancel: /^https?:$/.test(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname) });
    });
    if (STANDALONE) {
      try {
        const port = arg('site-port') === null ? 8090 : Number(arg('site-port'));
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local analyzer origin port.');
        SITE = `http://localhost:${port}/`; SITE_URL = new URL(SITE);
        const bundled = require('./lib/bundled-site.js').create(BUNDLED_ROOT, SITE_URL.origin);
        // Preserve the old origin/cache while serving only our packaged
        // assets. No listening port and no external local server are used.
        session.defaultSession.protocol.handle('http', bundled.handle);
        app.once('before-quit', () => session.defaultSession.protocol.unhandle('http'));
        note(`bundled analyzer: ${bundled.manifest.version}, assets=${Object.keys(bundled.manifest.files).length}`);
      } catch (error) {
        note('bundled analyzer startup failed:', error.message);
        if (!TEST) dialog.showErrorBox('Torchlight Overlay', error.message);
        app.exit(1); return;
      }
    }
    note(`start: version ${app.getVersion()}, site ${SITE}${DEV ? ', debug' : ''}${TEST ? ', test' : ''}, foreground check ${win32 ? 'on' : 'off'}`);
    suite = require('./lib/unified-runtime').create({
      executable: path.join(STANDALONE ? process.resourcesPath : __dirname, 'native', 'vorax-backend.exe'),
      config: () => settings, game: () => gameInfo(), userData: app.getPath('userData'), test: TEST,
      note, notify: () => { publishFastConfig(); updateOverlay(); rebuildMenu(); }
    });
    allowCapture();
    await refreshLog();
    makeOverlay();
    if (!FAST) makeSiteWindow('follow', { width: 1000, height: 860, title: 'Auto Screenshot Mode · Tartarus Overlay' });
    makeAnalyzer();
    // Integration tests capture their own stand-in, never a real game.
    if (TEST && arg('test-window')) {
      const area = screen.getPrimaryDisplay().bounds;
      // Windows excludes fully off-screen windows from capture enumeration.
      testStandIn = new BrowserWindow({ title: 'TartarusOverlayCheckOnly', width: 1280, height: 800, show: false, x: area.x + area.width - 1, y: area.y + area.height - 1, webPreferences: { sandbox: true, backgroundThrottling: false } });
      await testStandIn.loadFile(path.resolve(arg('test-window')));
      testStandIn.showInactive();
    }
    makeTray();
    registerHotkeys();
    if ((!TEST && !settings.consent) || settingsRequested) { show('follow'); settingsRequested = false; }
    lookForGame();
    setInterval(updateOverlay, 250);
    if (!TEST && !game.running) {
      tray.displayBalloon({ title: 'Torchlight Overlay is running', content: 'The advice shows over Torchlight: Infinite while you play. The tray icon has the board analyzer and settings.', iconType: 'info' });
    }
    if (TEST) console.log(`[overlay] ready site=${SITE} log=${logPath} win32=${!!win32}`);
  });
}
