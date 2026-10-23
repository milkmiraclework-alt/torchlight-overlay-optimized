/* Tartarus Simulator: following the game as it's played (beta).
 * Reads Torchlight: Infinite's log (UE_game.log), which the player picks
 * once, and grabs frames from the game window, which the player shares once.
 * When log lines match a trigger (a move, a new screen), it waits for the
 * animations to settle, then hands the page one frame of the game. Chrome
 * and Edge only: other browsers can't re-read a file on disk. Nothing leaves
 * the browser here; the page decides what to do with each frame (follow.html
 * hands it to the board analyzer, in another tab of the same browser).
 *
 * The log is followed in a background worker where the browser allows it,
 * so a hidden tab keeps up; otherwise on the page.
 *
 *   TartarusCapture.on('status' | 'hit' | 'seen' | 'frame', fn)
 *   connectLog() / resumeLog(click) / stopLog()
 *   connectWindow() / useStream(stream) / stopWindow()
 *   setRules([{ kind, pattern, settle, rank }]) / setWatch(pattern)
 *   captureNow(kind) / useHandle(handle) (tests: any object with getFile()) */
(function () {
  'use strict';

  const DEFAULT_RULES = [
    '# kind | pattern | settle ms  (one trigger a line; # starts a note)',
    '# Tartarus Prison is S16 in the log. A run\'s objective, when it shows one:',
    'objective | S16BoardTaskPop Run | 1500',
    '# The pick of 3 instruments, and after a re-roll:',
    'instruments | S16BoardRelicPop Run | 1500',
    'instruments | Btn_S16Board_RelicPop_Reroll | 2000',
    '# Each day, once its banner closes, and after a move, once its cards come up:',
    'board | \\[S16LastDay\\] check cur=\\d+ max=[1-9] | 1500',
    'board | UI_S16_Card_Up | 1500',
    '# After an action in the cell, and after each bite of a consume chain',
    '# (the next meal to pick, or the board after the chain), once it plays',
    "# out; unless the day ends, as a new day's banner drops a picture still",
    '# waiting (skip):',
    'board | Btn_S16Board_ActionCell | 2000',
    'board | UI_S16_Click_Eat | 2500',
    'skip | S16BoardNewDayPop Run | 0',
    "# The Warden's Treasure, which a Chromatic prisoner opens, and the board",
    '# once it closes, with the gift taken (a consume can open two in a row):',
    'treasure | S16BoardColoredPop Run | 1500',
    'board | S16BoardColoredPop Destory | 600',
    "# The game's Speed-up button: no picture, it flips 'Speed-up is on' here:",
    'speed | Btn_S16Board_Top_Speed | 0',
    '# A Cancel (a consume chain stopped), once the board settles:',
    'board | UI_S16_Click_Cancel | 1500',
    "# After an event's Confirm (the Sewer Ratway's cell pick, or the board after it):",
    'board | Btn_S16Board_EventPop_Confirm | 1500',
  ].join('\n');
  const POLL_MS = 1000;
  const IDB = 'tartarus-sim-capture';
  const listeners = { status: [], hit: [], seen: [], frame: [] };
  // detail: whether the game writes the detail lines the triggers come from
  // ('on', 'off', or '' while it isn't clear yet).
  // lang: the game's language code from its log ("ru", "zh"), '' until seen.
  // shared: 'window', or 'screen' for the desktop app's fallback (useCrop).
  const state = { log: 'off', file: '', window: 'off', windowSize: '', shared: '', lines: 0, hits: 0, frames: 0, note: '', error: '', detail: '', lang: '' };
  let rules = []; // [{ kind, re, settle, rank }]
  let watch = null; // log lines worth showing while finding triggers
  let burst = null; // matched lines waiting for the animations to settle
  let pace = 1; // settle times are scaled by this: the game's Speed-up runs its animations faster
  let tail = null; // { post(message), stop() }
  let track = null;
  let windowGeneration = 0;
  let imageCapture = null;
  let surface = ''; // what's shared: 'window', or 'monitor' only with the app's crop
  let video = null;
  let readinessProbe = null, burstEpoch = 0;
  let crop = null, lastWhy = '';
  function dropBurst() {
    burstEpoch++;
    if (burst) { clearTimeout(burst.timer); clearTimeout(burst.probeTimer); }
    burst = null;
  }

  const emit = (name, data) => listeners[name].forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error(e);
    }
  });
  const setState = (patch) => {
    Object.assign(state, patch);
    emit('status', Object.assign({}, state));
  };

  // ---------- Following the log ----------

  // #region read-log
  // The log follower, shared by the worker and the page. It reads only what
  // was added since the last look, decodes it as UTF-8, and reports the lines
  // that match a trigger or the watch pattern. However the log changes
  // (deleted, cleared, or swapped for a big one), one look reads at most
  // MAX_READ bytes and reports at most MAX_HITS lines, so the page always
  // keeps up. If the log is deleted, it waits for the game to write a new one.
  function follower(post) {
    const MAX_READ = 1024 * 1024; // bytes per look: anything older is skipped
    const MAX_LINE = 8192; // characters of one line that are checked
    const MAX_HITS = 200; // lines reported per look: the newest
    // The game's own lines, which every trigger is: with the game's Enable
    // Log off, it writes almost none (a player's log: 42 in all).
    const DETAIL = /\b(TLLua|TLGame):/;
    // The game's language, which it writes every few minutes ("sdkLang=en_US"):
    // only its two letters are kept, and the line is dropped like any other.
    const LANG = /\bsdkLang=([A-Za-z]{2})[_-]/;
    let handle = null;
    let offset = 0;
    let decoder = null;
    let rest = '';
    let busy = false;
    let again = false;
    let generation = 0;
    let gone = false; // the log isn't there (deleted, or between two logs)
    let failed = ''; // the last error reported, so each is reported once
    let triggers = [];
    let watching = null;
    const compile = (list) => list.map((s) => {
      try {
        return new RegExp(s, 'i');
      } catch (e) {
        return null;
      }
    });
    const readFrom = (at) => {
      offset = at;
      decoder = new TextDecoder('utf-8');
      rest = '';
    };
    const fail = (e) => {
      const missing = !!e && e.name === 'NotFoundError';
      const message = missing ? '' : String((e && e.message) || e);
      if (missing && !gone) post({ type: 'gone' });
      else if (!missing && message !== failed) post({ type: 'error', message });
      gone = missing;
      failed = message;
    };
    let begun = false; // whether the log has been found since start
    let fromFirst = false;
    async function tick() {
      if (!handle) return;
      if (busy) { again = true; return; }
      busy = true;
      const ticket = generation;
      try {
        const file = await handle.getFile();
        if (ticket !== generation) return;
        if (!begun) {
          // The first look starts at the end of the log, unless it was
          // missing until now: then the game wrote all of it since.
          begun = true;
          readFrom(fromFirst || gone ? 0 : file.size);
          post({ type: 'started', name: file.name || handle.name || 'UE_game.log', size: file.size });
        } else if (gone || file.size < offset) {
          // The game started a new log, or the deleted one is back.
          readFrom(0);
          post({ type: 'rotated' });
        }
        gone = false;
        failed = '';
        // Over a look's worth is new (a big log in place of the old one, or
        // the PC slept): only the newest part is read.
        if (file.size - offset > MAX_READ) readFrom(file.size - MAX_READ);
        if (file.size > offset) {
          const buf = await file.slice(offset, file.size).arrayBuffer();
          if (ticket !== generation) return;
          offset = file.size;
          const lines = (rest + decoder.decode(buf, { stream: true })).split(/\r?\n/);
          rest = lines.pop().slice(-MAX_LINE);
          const hits = [];
          let detail = 0;
          let lang = '';
          for (const whole of lines) {
            // A line can only be this long if the log was cleared while the
            // game wrote on: its text is at the end.
            const line = whole.length > MAX_LINE ? whole.slice(-MAX_LINE) : whole;
            if (DETAIL.test(line)) detail += 1;
            const said = LANG.exec(line);
            if (said) lang = said[1].toLowerCase();
            const rule = triggers.findIndex((re) => re && re.test(line));
            if (rule >= 0) hits.push({ rule, line: line.slice(0, 400) });
            else if (watching && watching.test(line)) hits.push({ rule: -1, line: line.slice(0, 400) });
          }
          post({ type: 'lines', count: lines.length, detail, lang, hits: hits.slice(-MAX_HITS) });
        }
      } catch (e) {
        if (ticket === generation) fail(e);
      } finally {
        busy = false;
        if (again) { again = false; queueMicrotask(tick); }
      }
    }
    return {
      start(h, fromStart) {
        generation++;
        handle = h;
        begun = false;
        fromFirst = !!fromStart;
        return tick();
      },
      stop() {
        generation++;
        handle = null;
      },
      rules(list, watchSource) {
        triggers = compile(list);
        watching = watchSource ? compile([watchSource])[0] : null;
      },
      tick,
    };
  }

  // #endregion

  // Whether the game writes its own lines, from the last few thousand read
  // (only lines written since the player connected, as follow.html says):
  // with its Enable Log on, a fifth to a half of them are (the user's logs);
  // with it off, almost none. Recent lines decide, so turning it on clears
  // the warning without a new log.
  let recent = []; // [lines, detail lines] for each look, newest last
  function noteDetail(count, detail) {
    if (!count) return;
    recent.push([count, detail]);
    let lines = recent.reduce((a, r) => a + r[0], 0);
    while (recent.length > 1 && lines - recent[0][0] >= 3000) lines -= recent.shift()[0];
    const shown = recent.reduce((a, r) => a + r[1], 0);
    const verdict = shown >= 50 && shown >= 0.05 * lines ? 'on' : lines >= 2000 && shown < 0.02 * lines ? 'off' : state.detail;
    if (verdict !== state.detail) setState({ detail: verdict });
  }

  // The follower in a worker: a hidden tab throttles the page's timers, but
  // not a worker's. File handles can be sent to a worker; test objects can't,
  // and those are followed on the page.
  function startFollower(handle) {
    if (tail) tail.stop();
    const onMessage = (m) => {
      if (stopIfOff()) return;
      if (m.type === 'started') setState({ log: 'on', file: m.name, error: '', note: '' });
      else if (m.type === 'rotated') {
        recent = [];
        setState({ log: 'on', error: '', note: 'The game started a new log.', detail: '' });
      } else if (m.type === 'gone') setState({ log: 'gone', error: '' });
      else if (m.type === 'error') setState({ log: 'error', error: m.message });
      else if (m.type === 'lines') {
        const patch = { lines: state.lines + m.count };
        if (m.lang && m.lang !== state.lang) patch.lang = m.lang;
        if (state.log === 'error') Object.assign(patch, { log: 'on', error: '' });
        setState(patch);
        noteDetail(m.count, m.detail || 0);
        for (const h of m.hits) onLine(h);
      }
    };
    const message = { rules: rules.map((r) => r.re.source), watch: watch ? watch.source : null };
    const real = typeof FileSystemFileHandle !== 'undefined' && handle instanceof FileSystemFileHandle;
    if (real && typeof Worker === 'function') {
      try {
        const source = `const follow = (${follower.toString()})((m) => postMessage(m));
          onmessage = (e) => {
            const m = e.data;
            if (m.type === 'start') follow.start(m.handle, false);
            else if (m.type === 'rules') follow.rules(m.rules, m.watch);
            else if (m.type === 'stop') follow.stop();
          };
          setInterval(() => follow.tick(), ${POLL_MS});`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = (e) => onMessage(e.data);
        worker.postMessage(Object.assign({ type: 'rules' }, message));
        worker.postMessage({ type: 'start', handle });
        tail = {
          post: (m) => worker.postMessage(m),
          stop: () => worker.terminate(),
        };
        return;
      } catch (e) {
        // Fall back to the page.
      }
    }
    const follow = follower(onMessage);
    follow.rules(message.rules, message.watch);
    const timer = setInterval(() => follow.tick(), POLL_MS);
    const unwatch = typeof handle.watch === 'function' ? handle.watch(() => follow.tick()) : null;
    follow.start(handle, false).catch((e) => onMessage({ type: 'error', message: String(e.message || e) }));
    tail = {
      post: (m) => {
        if (m.type === 'rules') follow.rules(m.rules, m.watch);
      },
      stop: () => {
        clearInterval(timer);
        if (typeof unwatch === 'function') unwatch();
        follow.stop();
      },
    };
  }

  function sendRules() {
    if (tail) tail.post({ type: 'rules', rules: rules.map((r) => r.re.source), watch: watch ? watch.source : null });
  }

  const stampOf = (line) => {
    const m = /^\[([^\]]+)\]/.exec(line);
    return m ? m[1] : '';
  };

  // #region triggers
  function onLine(h) {
    const at = stampOf(h.line);
    if (h.rule < 0) {
      emit('seen', { at, line: h.line });
      return;
    }
    const rule = rules[h.rule];
    if (!rule) return;
    const m = rule.re.exec(h.line);
    // The first card-arrival sound after an explicit action belongs to that
    // action. Later sounds without a matching action still start a new epoch.
    const continuation = !!(window.TartarusDesktop && window.TartarusDesktop.fast && rule.kind === 'board'
      && burst && burst.kind === 'board' && burst.expectedPresentation && /UI_S16_Card_Up\b/.test(h.line));
    const hit = { kind: rule.kind, at, text: m ? (m[1] || m[0]).slice(0, 120) : '', line: h.line, continuation };
    setState({ hits: state.hits + 1 });
    emit('hit', hit);
    emit('seen', { at, line: h.line, kind: rule.kind });
    // A "skip" line (a new day's banner) drops a picture still waiting to be
    // taken, as the screen is changing: the next screen's own line follows.
    if (rule.kind === 'skip') {
      dropBurst();
      return;
    }
    // A "speed" line (the game's Speed-up button) takes no picture: the page
    // hears it as a hit, and sets the pace.
    if (rule.kind === 'speed') return;
    // View Prison Status may close a Treasure before its settling timer.
    // Treasure advice needs no bitmap; flush it now so the following board
    // receives its own capture instead of inheriting the popup's priority.
    if (burst && burst.kind === 'treasure' && rule.kind === 'board') {
      const previous = burst;
      dropBurst();
      emit('frame', { kind: 'treasure', hits: previous.hits, frame: null, why: '', time: new Date(),
        settle: { mode: 'deadline', waitedMs: Math.round(performance.now() - previous.started), savedMs: 0 } });
    }
    // Keep each event's full fallback deadline. Verified screen readiness
    // may release it early; later short events do not stack another wait.
    if (!burst) burst = { kind: rule.kind, rank: rule.rank, settle: 0, deadline: 0, hits: [], timer: 0, probeTimer: 0, started: performance.now() };
    if (!continuation) burst.epoch = ++burstEpoch;
    burst.expectedPresentation = !continuation && /Btn_S16Board_ActionCell|UI_S16_Click_(?:Eat|Cancel)\b|Btn_S16Board_EventPop_Confirm/.test(h.line);
    if (rule.rank > burst.rank) {
      burst.kind = rule.kind;
      burst.rank = rule.rank;
    }
    const wait = Math.max(250, rule.settle * pace);
    burst.settle = Math.max(burst.settle, wait);
    const now = performance.now();
    if (!continuation) burst.lastEventAt = now;
    burst.probeUnavailable = false;
    burst.deadline = Math.max(burst.deadline, now + wait);
    if (burst.hits.length < 40) burst.hits.push({ kind: hit.kind, at: hit.at, text: hit.text });
    clearTimeout(burst.timer);
    const delay = window.TartarusDesktop && window.TartarusDesktop.fast ? Math.max(0, burst.deadline - now) : burst.settle;
    const b = burst;
    burst.timer = setTimeout(() => fire(b), delay);
    if (!continuation) { clearTimeout(burst.probeTimer); b.probeTimer = 0; }
    const firstProbe = Math.max(75, 150 * pace);
    if (readinessProbe && b.kind === 'board' && delay >= firstProbe + 200 && !b.probeTimer && !b.probing) {
      b.probeTimer = setTimeout(() => probe(b), firstProbe);
    }
  }

  async function probe(b) {
    b.probeTimer = 0;
    if (burst !== b || !readinessProbe || b.probing || !mayCapture()) return;
    b.probing = true;
    const epoch = b.epoch;
    const probeStarted = performance.now();
    let frame;
    try {
      frame = await grab();
      if (frame && burst === b && epoch === b.epoch) {
        const check = readinessProbe;
        if (!check) return;
        const ready = await check(frame, { epoch, kind: b.kind, hits: b.hits });
        if (ready === null && epoch === b.epoch) b.probeUnavailable = true;
        if (ready && readinessProbe === check && burst === b && epoch === b.epoch && performance.now() < b.deadline && mayCapture()) {
          const captured = frame; frame = null;
          await fire(b, captured);
        }
      }
    } catch { /* The original deadline remains armed if a probe fails. */ }
    finally {
      if (frame) frame.close();
      b.probing = false;
      if (burst === b && readinessProbe && !b.probeUnavailable && performance.now() + 100 < b.deadline) {
        clearTimeout(b.probeTimer);
        const now = performance.now();
        b.probeTimer = setTimeout(() => probe(b), Math.max(0, 100 - (now - probeStarted), b.lastEventAt + Math.max(75, 150 * pace) - now));
      }
    }
  }

  async function fire(b, earlyFrame) {
    if (!b || burst !== b) { if (earlyFrame) earlyFrame.close(); return; }
    clearTimeout(b.timer); clearTimeout(b.probeTimer);
    const epoch = b.epoch;
    burst = null;
    const frame = earlyFrame || await grab();
    if (epoch !== burstEpoch || !agreed()) { if (frame) frame.close(); return; }
    if (frame) setState({ frames: state.frames + 1 });
    emit('frame', { kind: b.kind, hits: b.hits, frame, why: frame ? '' : whyNot(), time: new Date(), settle: { mode: earlyFrame ? 'ready' : 'deadline', epoch, waitedMs: Math.round(performance.now() - b.started), savedMs: earlyFrame ? Math.max(0, Math.round(b.deadline - performance.now())) : 0 } });
  }

  // #endregion

  // ---------- Remembering the log between visits ----------

  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function remember(handle) {
    try {
      const d = await db();
      d.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'log');
    } catch (e) {
      // Without IndexedDB the log is picked again next visit.
    }
  }

  async function recall() {
    try {
      const d = await db();
      return await new Promise((resolve) => {
        const q = d.transaction('handles', 'readonly').objectStore('handles').get('log');
        q.onsuccess = () => resolve(q.result || null);
        q.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  // ---------- When pictures may be taken ----------

  // #region guard
  // What follow.html saves when the player agrees (shared with js/follow.js
  // and js/auto.js), and the version of that page they agreed to.
  const SETTINGS = 'tartarus-sim:auto:v1';
  const CONSENT_VERSION = window.TartarusDesktop && window.TartarusDesktop.fast ? 4 : 5;

  // Whether the player agreed to this version of follow.html. It's read
  // again every time it's needed, so turning Auto Screenshot Mode off on that
  // page stops it here at once, even in a tab that's already open.
  function agreed() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS) || 'null');
      return !!s && s.enabled === true && s.consent === CONSENT_VERSION;
    } catch (e) {
      return false;
    }
  }

  // Agreed to an earlier version of follow.html, and not turned off: Auto
  // Screenshot Mode waits until the player reads what changed and agrees
  // again (the analyzer says so, rather than going quiet).
  function agreedBefore() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS) || 'null');
      return !!s && s.enabled === true && Number(s.consent) > 0 && s.consent < CONSENT_VERSION;
    } catch (e) {
      return false;
    }
  }

  function mustAgree() {
    if (!agreed()) throw new Error('Read and agree on the Auto Screenshot Mode page first.');
  }

  // A picture may be taken only when all of these hold, checked right
  // before each one: the player agreed, a game log is connected and being
  // read, and what's shared is a single window that's still live. A whole
  // screen or a browser tab is never accepted (see useStream), except the
  // desktop app's screen, cut to the game window (useCrop).
  function mayCapture() {
    return agreed() && state.log === 'on' && !!track && track.readyState === 'live' && (surface === 'window' || (surface === 'monitor' && !!crop));
  }

  // Why a picture can't be taken right now, for the page to say.
  function whyNot() {
    if (!agreed()) return 'Auto Screenshot Mode is off.';
    if (lastWhy) return lastWhy;
    if (state.log === 'gone') return 'the game log isn’t there right now.';
    if (state.log !== 'on') return 'connect the game log first.';
    return 'share the game window first.';
  }

  // Turning Auto Screenshot Mode off on follow.html, in any tab, stops everything
  // here at once: the log stops being read and the window share ends.
  function stopIfOff() {
    if (agreed()) return false;
    if (tail || track) {
      stopLog();
      stopWindow();
      setState({ note: 'Auto Screenshot Mode was turned off.' });
    }
    return true;
  }
  window.addEventListener('storage', (e) => {
    if (e.key === SETTINGS) stopIfOff();
  });
  // #endregion

  // ---------- The log: picking it ----------

  // #region pick-log
  async function connectLog() {
    mustAgree();
    if (typeof window.showOpenFilePicker !== 'function') throw new Error('This browser can’t follow a file on your PC. Use Chrome or Edge.');
    const [handle] = await window.showOpenFilePicker({ id: 'torchlight-log', multiple: false, types: [{ description: 'Torchlight: Infinite log', accept: { 'text/plain': ['.log'] } }] });
    useHandle(handle);
    remember(handle);
  }

  // The log dragged onto the page from File Explorer. Chrome and Edge refuse
  // files under Program Files in the picker above, but not ones dragged in,
  // so this works wherever the game is installed. Only one file is taken,
  // and only a .log file; a folder or anything else is turned away. It's
  // called from the drop itself: the browser hands over the file only then.
  async function dropLog(dataTransfer) {
    mustAgree();
    const items = [...((dataTransfer && dataTransfer.items) || [])].filter((i) => i.kind === 'file');
    const one = items.length === 1 && typeof items[0].getAsFileSystemHandle === 'function' ? items[0].getAsFileSystemHandle() : null;
    if (items.length !== 1) throw new Error('Drop one file: UE_game.log.');
    if (!one) throw new Error('This browser can’t follow a dropped file. Use Chrome or Edge.');
    let handle;
    try {
      handle = await one;
    } catch (e) {
      // A folder in a place the browser keeps from websites, for one.
      throw new Error('The browser didn’t hand that over. Drag UE_game.log itself, from inside its folder.');
    }
    if (!handle || handle.kind !== 'file') throw new Error('That’s a folder. Open it and drag UE_game.log from inside it.');
    if (!/\.log$/i.test(handle.name)) throw new Error(`That’s ${handle.name}. Drag UE_game.log, the game’s log.`);
    useHandle(handle);
    remember(handle);
  }

  // The log picked on an earlier visit. The browser asks again for leave to
  // read it, and that takes a click: without one this returns 'ask'. If the
  // browser can't use it any more, this returns 'none', to pick it again.
  async function resumeLog(click) {
    if (!agreed()) return 'none';
    const handle = await recall();
    if (!handle || typeof handle.queryPermission !== 'function') return 'none';
    let p;
    try {
      p = await handle.queryPermission({ mode: 'read' });
      if (p !== 'granted' && click) p = await handle.requestPermission({ mode: 'read' });
    } catch (e) {
      return 'none';
    }
    if (p !== 'granted') {
      setState({ file: handle.name });
      return 'ask';
    }
    useHandle(handle);
    return 'on';
  }

  // #endregion

  function useHandle(handle) {
    mustAgree();
    recent = [];
    setState({ log: 'starting', file: handle.name || '', error: '', lines: 0, hits: 0, detail: '' });
    startFollower(handle);
  }

  function stopLog() {
    if (tail) tail.stop();
    tail = null;
    dropBurst();
    setState({ log: 'off' });
  }

  // ---------- The window ----------

  // #region share-window
  // opts.screen: the desktop app's fallback (see useCrop), the screen the
  // game is on, which the app picks.
  async function connectWindow(opts) {
    mustAgree();
    const generation = ++windowGeneration;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') throw new Error('This browser can’t share a window.');
    const screen = !!(opts && opts.screen && crop);
    // The browser's picker lists the open windows; the player picks the
    // game. Whole screens and this tab aren't offered, and the share can't
    // be switched to something else while it runs.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window', frameRate: window.TartarusDesktop && window.TartarusDesktop.fast ? { ideal: 30, max: 30 } : { ideal: 5, max: 10 } },
      audio: false,
      monitorTypeSurfaces: 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    });
    // Closing the board/withdrawing consent can happen while Chromium is
    // still opening the capture. Never attach that obsolete stream later.
    if (generation !== windowGeneration || !agreed()) {
      stream.getTracks().forEach((x) => x.stop());
      return false;
    }
    useStream(stream);
    return true;
  }

  function useStream(stream, screen) {
    mustAgree();
    stopWindow(true);
    const t = stream.getVideoTracks()[0];
    const kind = t && t.getSettings ? t.getSettings().displaySurface : '';
    // Only a single window is accepted: a whole screen or a browser tab is
    // turned away, and its share stopped at once. The one exception is the
    // desktop app's screen, asked for as such, with its crop set.
    if (kind !== 'window' && !(kind === 'monitor' && screen && crop)) {
      stream.getTracks().forEach((x) => x.stop());
      throw new Error('Share the Torchlight: Infinite window itself, not a whole screen or a browser tab.');
    }
    track = t;
    surface = kind;
    track.addEventListener('ended', () => {
      if (track !== t) return;
      track = null;
      surface = '';
      imageCapture = null;
      setState({ window: 'off', windowSize: '', shared: '', note: 'Window sharing stopped.' });
    });
    // Chrome and Edge take a still frame only when a picture is due, and
    // nothing plays the window as video in between. Other browsers need a
    // hidden video element to take a frame from.
    if (typeof ImageCapture === 'function') imageCapture = new ImageCapture(track);
    else {
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    const s = track.getSettings();
    setState({ window: 'on', windowSize: s.width ? `${s.width}×${s.height}` : '', shared: kind === 'monitor' ? 'screen' : 'window', note: '' });
  }

  // The desktop app's crop for a shared screen (see crop above): set by the
  // app only, never by this site's pages.
  function useCrop(fn) {
    crop = typeof fn === 'function' ? fn : null;
    return !!crop;
  }

  function stopWindow(keepPending = false) {
    windowGeneration++;
    if (!keepPending) dropBurst();
    if (track) track.stop();
    track = null;
    surface = '';
    imageCapture = null;
    if (video) video.srcObject = null;
    video = null;
    setState({ window: 'off', windowSize: '', shared: '' });
  }

  // One frame of the shared window, as an ImageBitmap, or null when a
  // picture isn't allowed right now (see mayCapture). On the desktop app's
  // shared screen, the frame is cut to the game window's area here, before
  // it leaves this function, and none is taken unless the game is the window
  // in front: nothing else on the screen is ever read, kept or sent.
  async function grab() {
    lastWhy = '';
    if (!mayCapture()) {
      stopIfOff();
      return null;
    }
    let area = null;
    if (surface === 'monitor') {
      try {
        area = await crop();
      } catch (e) {
        area = null;
      }
      if (!area || !area.front || !(area.width > 0) || !(area.height > 0)) {
        lastWhy = area && !area.front ? 'the game isn’t the window in front.' : 'the game window wasn’t found on the shared screen.';
        return null;
      }
    }
    let frame = null;
    try {
      if (imageCapture) frame = await imageCapture.grabFrame();
    } catch (e) {
      // Fall back to the video element.
    }
    try {
      if (!frame && video && video.readyState >= 2) frame = await createImageBitmap(video);
    } catch (e) {
      // No frame this time.
    }
    if (!frame || !area) return frame;
    try {
      const sx = frame.width / (area.screenWidth || frame.width);
      const sy = frame.height / (area.screenHeight || frame.height);
      const x = Math.max(0, Math.round(area.x * sx));
      const y = Math.max(0, Math.round(area.y * sy));
      const w = Math.min(frame.width - x, Math.round((area.x * sx < 0 ? area.width + area.x : area.width) * sx));
      const h = Math.min(frame.height - y, Math.round((area.y * sy < 0 ? area.height + area.y : area.height) * sy));
      if (w < 64 || h < 64) {
        lastWhy = 'the game window wasn’t found on the shared screen.';
        return null;
      }
      return await createImageBitmap(frame, x, y, w, h);
    } catch (e) {
      return null;
    } finally {
      frame.close();
    }
  }

  // A frame that's all but black: a window share that started but shows
  // nothing of the window (a game run as administrator, reports 361 and
  // 362). Looked at shrunk to 16×16; nothing of it is kept.
  function isBlank(frame) {
    if (!frame) return false;
    try {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(frame, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 12 || d[i + 1] > 12 || d[i + 2] > 12) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // #endregion

  async function captureNow(kind, retry = null) {
    const epoch = burstEpoch;
    const frame = await grab();
    if (epoch !== burstEpoch || !agreed()) { if (frame) frame.close(); return false; }
    if (frame) setState({ frames: state.frames + 1 });
    emit('frame', { kind: kind || 'manual', hits: retry?.hits || [], retryAttempt: retry?.attempt || 0, frame, blank: isBlank(frame), why: frame ? '' : whyNot(), time: new Date() });
    return !!frame;
  }

  // ---------- Triggers ----------

  // [{ kind, pattern, settle, rank }]. Patterns that aren't valid are skipped.
  function setRules(list) {
    rules = [];
    for (const r of list || []) {
      try {
        rules.push({ kind: r.kind || 'board', re: new RegExp(r.pattern, 'i'), settle: Math.max(100, Number(r.settle) || 900), rank: Number(r.rank) || 0 });
      } catch (e) {
        // A bad pattern is left out.
      }
    }
    sendRules();
    return rules.length;
  }

  // The game's Speed-up: its animations take about 0.4 of the time, so the
  // waits before pictures shrink to match.
  function setPace(factor) {
    pace = Math.min(1, Math.max(0.2, Number(factor) || 1));
    return pace;
  }

  function setWatch(pattern) {
    try {
      watch = pattern ? new RegExp(pattern, 'i') : null;
    } catch (e) {
      watch = null;
    }
    sendRules();
    return !!watch || !pattern;
  }

  window.TartarusCapture = {
    // follow.html explains this code. When what it does changes, this goes
    // up, and players are asked to read and agree again.
    CONSENT_VERSION,
    agreed,
    agreedBefore,
    supported: {
      log: typeof window.showOpenFilePicker === 'function',
      drop: typeof DataTransferItem === 'function' && typeof DataTransferItem.prototype.getAsFileSystemHandle === 'function',
      window: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'),
    },
    get state() {
      return Object.assign({}, state);
    },
    on(name, fn) {
      if (listeners[name]) listeners[name].push(fn);
    },
    connectLog,
    useCrop,
    dropLog,
    resumeLog,
    stopLog,
    useHandle,
    connectWindow,
    useStream,
    stopWindow,
    setRules,
    setWatch,
    setPace,
    setReadinessProbe: (probe) => { readinessProbe = typeof probe === 'function' ? probe : null; if (!readinessProbe && burst) clearTimeout(burst.probeTimer); },
    DEFAULT_RULES,
    captureNow,
    grab,
  };
})();
