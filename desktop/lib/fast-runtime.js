/* One background runtime: native log wakeups -> game ImageBitmap -> reader
 * worker -> engine/solver -> structured overlay advice. No follow page,
 * BroadcastChannel pixel copy, PNG encode, or preview generation is needed. */
(function () {
  'use strict';
  const D = window.TartarusDesktop, C = window.TartarusCapture;
  const A = window.TartarusAnalyzer, Auto = window.TartarusAuto;
  if (!D || !D.fast || !C || !A || !Auto || window.__tartarusFastRuntime) return;
  window.__tartarusFastRuntime = true;
  if (C.setReadinessProbe && A.probeFrame) C.setReadinessProbe(A.probeFrame);
  let game = {}, settings = {}, logFor = '', sharing = null, id = 0;
  let lastFrame = null, lastAction = 0, lastEat = 0, lastGift = 0, triggeredAt = 0;
  let latestRead = null;
  let retryTimer = 0, retryRevision = 0;
  function cancelRetry() { if (retryTimer) clearTimeout(retryTimer); retryTimer = 0; retryRevision++; }
  function retryPicture(event, mine, revision, attempt, read) {
    if (attempt >= 2 || read?.skipped || !(['instruments', 'board', 'objective'].includes(event.kind) || ((!read || read.dayReading || read.instrumentReading) && event.kind === 'manual'))) return false;
    A.setReadStatus({ at: Date.now(), kind: event.kind, phase: 'settling' }, read);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(async () => {
      retryTimer = 0;
      if (revision !== retryRevision || mine !== id || !active || !game.running || !C.agreed()) return;
      await sync();
      // An off/not-yet-ready stream emits another missing-frame result,
      // consuming the same bounded retry budget instead of staying stuck.
      if (revision === retryRevision && mine === id && active && C.agreed()) C.captureNow(event.kind, { attempt: attempt + 1, hits: event.hits || [] });
    }, 250);
    return true;
  }

  const gifts = { rainbows: 0, taken: 0 };
  let giftOpen = false;
  const startedAt = Date.now();
  const startSignals = new Set();
  let dayClock = null, dayClockAt = 0;
  function clearDayClock() { dayClock = null; dayClockAt = 0; }
  // One Rainbow logs two sounds and one vault-cell light. Count the burst
  // by unique cells, or half the sounds if cell lines are unavailable.
  const burst = { last: 0, base: 0, sounds: 0, cells: new Set() };
  // Consent permits following the log, not continuous game-window capture.
  // A missed close event also expires, and the next real board event wakes us.
  const IDLE_MS = 30000;
  let active = false, activityAt = 0;
  const diag = { triggers: {}, lastTriggerAt: 0, failed: 0 };
  const stampMs = (at) => {
    const m = /(\d+)\.(\d+)\.(\d+)-(\d+)\.(\d+)\.(\d+):(\d+)/.exec(at || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : 0;
  };
  const rules = C.DEFAULT_RULES.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
    const [kind, pattern, settle] = line.split('|').map((s) => s.trim());
    return { kind, pattern, settle: Number(settle) || 900, rank: ({ board: 1, instruments: 2, objective: 3, treasure: 3 })[kind] || 1 };
  });
  C.setRules(rules);
  C.setWatch('LogLoad: LoadMap:|^(?!.*(LogDataTable|AssetLoad@|PageStack@|PageBase@|PageView@|CardMotion|CardPose|BGM_))(?=.*S16)');
  const handle = {
    name: 'UE_game.log',
    watch: (fn) => D.onLogChanged(fn),
    async getFile() {
      const stat = await D.logStat();
      if (!stat) throw new DOMException('Game log is missing.', 'NotFoundError');
      return { ...stat, slice: (start, end) => ({ arrayBuffer: () => D.logRead(start, end) }) };
    },
  };
  function tell() {
    const st = C.state;
    D.follow({ ...st, active, agreed: C.agreed(), lastFrame, running: !!game.running, logFound: !!game.log, logThere: !!(game.log && game.log.there), diag });
  }
  function suspend(reason, force = false) {
    cancelRetry();
    const wasActive = active;
    active = false;
    C.stopWindow();
    sharing = null;
    if (wasActive || force) {
      id++; latestRead = null; Auto.cancel(); A.suspend(); A.setReadStatus(null);
      diag.sleepReason = reason;
    }
  }
  function activate() {
    if (!C.agreed() || !game.running || (settings.activeMode && settings.activeMode !== 'tartarus')) return false;
    activityAt = Date.now();
    if (!active) {
      active = true; diag.sleepReason = '';
      A.setForecastEnabled(true); A.prepare();
    }
    sync();
    return true;
  }
  async function sync() {
    if (!C.agreed()) { suspend('disabled'); C.stopLog(); logFor = ''; tell(); return; }
    if (game.log && (C.state.log === 'off' || game.log.path !== logFor)) {
      clearDayClock();
      C.useHandle(handle);
      logFor = game.log.path;
    }
    if (!game.running) suspend('game-closed');
    if (active && game.running && C.state.window !== 'on' && !sharing) {
      const pending = C.connectWindow().catch((error) => { diag.lastNote = error.message; }).finally(() => { if (sharing === pending) sharing = null; });
      sharing = pending;
    }
    if (sharing) await sharing;
    tell();
  }
  function configure(next) {
    settings = next || {};
    const consent = settings.consent;
    const enabled = !!consent && !consent.withdrawn && consent.version === C.CONSENT_VERSION;
    if (!enabled) suspend('disabled', true);
    else if (settings.activeMode && settings.activeMode !== 'tartarus') suspend('other-mode', true);
    if (!enabled || (settings.activeMode && settings.activeMode !== 'tartarus')) clearDayClock();
    const previous = JSON.parse(localStorage.getItem('tartarus-sim:auto:v1') || '{}');
    localStorage.setItem('tartarus-sim:auto:v1', JSON.stringify({ ...previous, enabled, consent: enabled ? C.CONSENT_VERSION : 0, consentAt: consent && consent.at }));
    C.setPace(settings.speed ? 0.45 : 1);
    sync();
  }
  C.on('status', () => { if (C.state.lang && A.setGameLang) A.setGameLang(C.state.lang, true); tell(); });
  C.on('seen', (event) => {
    const line = event.line;
    if (/Btn_S16GamePlay_Start\b/.test(line)) {
      const at = stampMs(event.at);
      if (at && at >= startedAt - 2000 && at <= Date.now() + 2000 && !startSignals.has(event.at)) {
        clearDayClock();
        startSignals.add(event.at);
        while (startSignals.size > 16) startSignals.delete(startSignals.values().next().value);
        id++; latestRead = null; Auto.cancel(); A.beginRun?.('start:' + event.at);
      }
      gifts.rainbows = 0; gifts.taken = 0; giftOpen = false;
      Object.assign(burst, { last: 0, base: 0, sounds: 0, cells: new Set() });
      if (A.giftsDone) A.giftsDone();
    }
    if (/S16BoardMain (?:Hide|Destory|Destroy)\b|S16GamePlayEntry (?:Run|Destory|Destroy)\b|S16GamePlayCheckOut Run|UI_S16_Riot_Interface|Btn_S16GamePlay_CheckOut_(?:AbandonChallenge|StartChallenge)|LogLoad: LoadMap:/.test(line)) { clearDayClock(); suspend('left-board'); }
    else if (/S16BoardMain Run|Btn_S16GamePlay_Start|S16BoardTaskPop Run|S16BoardRelicPop Run/.test(line)) activate();
    // This is the game's current day, not its countdown. Keep it with the
    // captured frame, so later log lines cannot change a read in progress.
    if (/S16BoardNewDayPop Run\b/.test(line)) clearDayClock();
    const clock = /\[S16LastDay\] check cur=(\d+) max=(\d+)\b/.exec(line);
    if (clock) {
      const at = stampMs(event.at), day = Number(clock[1]), maxDays = Number(clock[2]);
      if (at && at >= startedAt - 2000 && at >= dayClockAt && at >= Date.now() - 10000 && at <= Date.now() + 2000 && [20, 30].includes(maxDays) && day >= 0 && day <= maxDays) {
        dayClockAt = at;
        dayClock = day ? { day, maxDays, at } : null;
      }
    }
    if (/Btn_S16Board_ActionCell/.test(line)) lastAction = stampMs(event.at);
    if (/Eating_red_screen/.test(line)) lastEat = stampMs(event.at);
    if (/ColoredPop_Confirm/.test(line)) {
      lastGift = stampMs(event.at);
      if (giftOpen) gifts.taken++;
      giftOpen = false;
    }
    if (/S16BoardColoredPop Run\b/.test(line)) giftOpen = true;
    const vault = /Anim_Archive_LightUp, Id = (\S+)/.exec(line);
    if (vault || /UI_S16_Premium_Quality_Fly/.test(line)) {
      const giftTime = stampMs(event.at);
      if (!giftTime || giftTime - burst.last > 3000) Object.assign(burst, { base: gifts.rainbows, sounds: 0, cells: new Set() });
      burst.last = giftTime;
      if (vault) burst.cells.add(vault[1]); else burst.sounds++;
      gifts.rainbows = burst.base + Math.max(burst.cells.size, Math.ceil(burst.sounds / 2));
    }
    if (/S16GamePlayCheckOut Run|UI_S16_Riot_Interface/.test(line)) D.riot(true);
    else if (/S16GamePlayEntry Run|Btn_S16GamePlay_Start|S16BoardTaskPop Run|S16BoardRelicPop Run|S16BoardMain Run/.test(line)) D.riot(false);
    if (/Btn_S16GamePlay_CheckOut_AbandonChallenge/.test(line)) D.run('over');
    else if (/Btn_S16GamePlay_Start|S16BoardTaskPop Run|S16BoardRelicPop Run/.test(line)) D.run('new');
  });
  C.on('hit', (event) => {
    if (!activate()) return;
    diag.triggers[event.kind] = (diag.triggers[event.kind] || 0) + 1;
    diag.lastTriggerAt = Date.now(); diag.lastTriggerKind = event.kind;
    D.trigger(event.kind);
    if (event.kind === 'speed') {
      settings.speed = !settings.speed;
      C.setPace(settings.speed ? 0.45 : 1);
      D.setFastSettings({ speed: settings.speed });
    } else {
      if (event.continuation) return;
      cancelRetry();
      id++; latestRead = null; Auto.cancel();
      triggeredAt = performance.now();
      A.invalidate({ forecast: ['board', 'skip'].includes(event.kind) ? 'keep' : 'stop', preserve: ['board', 'skip'].includes(event.kind) });
      if (event.kind === 'instruments') A.expectInstrumentOffer?.();
      A.setReadStatus({ at: Date.now(), kind: event.kind, phase: 'settling' });
      if (['instruments', 'objective'].includes(event.kind)) A.prepareOCR();
    }
  });
  C.on('frame', async (event) => {
    if (!active || !game.running || !C.agreed()) { if (event.frame) event.frame.close(); return; }
    const mine = ++id, started = performance.now(), revision = retryRevision;
    const attempt = event.retryAttempt || 0;
    A.invalidate({ forecast: 'pause', preserve: true });
    const readiness = event.kind === 'board' && A.readinessInfo ? A.readinessInfo() : null;
    lastFrame = { at: Date.now(), kind: event.kind, ok: !!event.frame, why: event.why || '', settle: event.settle ? { ...event.settle, readiness: readiness?.epoch === event.settle.epoch ? readiness : { reason: 'not-probed', probes: 0 } } : null };
    if (!event.frame && event.kind !== 'treasure') diag.failed++;
    tell();
    if (!event.frame && event.kind !== 'treasure') {
      if (!retryPicture(event, mine, revision, attempt)) A.setReadStatus(null);
      return;
    }
    const hits = event.hits || [];
    const pop = stampMs((hits.find((h) => h.kind === 'treasure') || {}).at);
    const shut = stampMs((hits.find((h) => /ColoredPop Destory/.test(h.text || '')) || {}).at);
    const after = pop && lastAction && pop >= lastAction && pop - lastAction <= 6000 ? lastEat >= lastAction - 500 ? 'consume' : 'swap' : '';
    const treasureView = !!shut && !(lastGift && shut >= lastGift && shut - lastGift < 3000);
    const fresh = hits.some((h) => /check cur=0\b/.test(h.text || ''));
    A.setReadStatus({ at: Date.now(), kind: event.kind });
    try {
      const clock = dayClock && Date.now() - dayClock.at <= 120000 ? { ...dayClock } : null;
      await Auto.receive({ id: mine, kind: event.kind, bitmap: event.frame, dayClock: clock, fresh, after, treasureView, gifts: { ...gifts }, retryOffer: event.kind === 'instruments' }, (patch) => {
        if (mine !== id || !patch.read) return;
        const read = { ...patch.read, at: Date.now() };
        latestRead = { id: mine, readMs: performance.now() - started, trigger: event.kind === 'manual' ? started : triggeredAt || started, readAt: performance.now(), image: event.kind !== 'treasure' };
        if (!read.ok || read.objective) { latestRead = null; }
        if (read.ok || !retryPicture(event, mine, revision, attempt, read)) A.setReadStatus(null, read);
      });
    } catch (error) {
      if (mine === id) A.setReadStatus(null, { ok: false, at: Date.now(), reason: error.message });
    }
  });
  D.onCommand((cmd) => {
    if (cmd === 'capture') cancelRetry();
    if (cmd === 'capture' && activate()) sync().then(() => { if (active && C.state.window === 'on') C.captureNow('manual'); });
    if (cmd === 'run-over') suspend('run-over');
  });
  D.onGame((next) => {
    const moved = game.running && next.running && game.window && next.window && game.window !== next.window;
    if (!next.running || moved) clearDayClock();
    game = next;
    if (moved && C.state.window === 'on') C.stopWindow();
    sync();
  });
  D.onFastSettings(configure);
  Promise.all([D.fastSettings(), D.game()]).then(([next, state]) => { game = state || {}; configure(next); });
  setInterval(() => {
    if (active && Date.now() - activityAt >= IDLE_MS) suspend('idle');
    else if (active && game.running && C.state.window !== 'on') sync();
  }, 1000);
  window.addEventListener('pagehide', () => { suspend('closed'); C.stopLog(); });
})();
