/* ============================================================================
 * Shadowbox Studio — js/pool.js
 * ----------------------------------------------------------------------------
 * SBPool (main thread, speed round F11): spawns the coordinator worker
 * (js/worker.js, name "sb-coord") and P helper workers ("sb-helper-<id>"),
 * brokers one MessageChannel per helper (no nested workers), checks the
 * handshake and offers submit / cancel / setSource. DOM module (loaded before
 * app.js, not in the Node list); it touches no DOM at load, so the Node tests
 * run it with test/node_worker_shim.js as the spawn function.
 *
 *   SBPool.helperCount(hardwareConcurrency, deviceClass) → P = clamp(hc − 1, 1, cap), cap 8 desktop / 4 mobile (PO-PERF-1)
 *   SBPool.longTasks() → {supported, start(), stop() → {supported, max, count}}: PerformanceObserver("longtask")
 *     recorder (F11 Phase B gate, reused by the F16a bench modes); unsupported (zeros) where longtask is not observable.
 *   SBPool.memoryBudget(deviceMemory, deviceClass) → bytes (F13): min(1 GiB, deviceMemory·128 MiB) desktop when
 *     deviceMemory is finite, else 512 MiB; mobile 192 MiB.
 *   SBPool.create({spawn?, workerUrl?, helpers?, deviceClass?, appVersion, engineVersion?, loadText?, moduleBase?,
 *                  modulesHash?, helloTimeoutMs?, onState?, memoryBudget?, watchdogMs?, helperStuckMs?, spares?}) → pool
 *     pool.ready      Promise<boolean>: true once a coordinator's hello matched; false when the pool fell back
 *     pool.helpersReady  Promise: settles once every first-spawn helper said hello or failed (until then, and for a
 *                     refused helper, the coordinator runs items inline — same results)
 *     pool.mode       "starting" | "pool" | "fallback" | "closed";  pool.notice: the fallback's user-facing text
 *     pool.setSource({sampleHash, pixels, alpha, w, h, channels})  posts a transferred COPY, once per sampleHash
 *     pool.submit(req, {sampleHash, gen, overlays, mainBytes, onAck, onStart, onProgress}) → {runId, done}
 *        F13: the generate message carries budgetBytes (the create option memoryBudget, else
 *        SBPool.memoryBudget(navigator.deviceMemory, deviceClass)) and mainBytes (the caller's estimate of the result it
 *        holds on main, default 0): the coordinator's estBytes ledger admits batch items within that budget.
 *        req is SBEngine.request(…); with a sampleHash its pixels stay on main and the coordinator uses the stored
 *        source (SOURCE_MISMATCH otherwise); sampleHash null sends the pixels inline. runId is a unique monotonic
 *        counter. onAck({runId}) fires on main in a microtask (NFR-02 ≤ 100 ms; the coordinator cannot answer while
 *        inside a serial segment); onStart({runId}) on the coordinator's ack; onProgress({runId, stage, frac, sub}).
 *        done → {runId, gen, sampleHash, overlays, deviceClass, status, response} (response deep-frozen again on
 *        receipt; status "canceled" without a response, plus watchdog: true when the watchdog settled it); rejects
 *        with an Error carrying .code for a coordinator error (SOURCE_MISMATCH, …), POOL_UNAVAILABLE (fallback /
 *        closed) or POOL_DOWN (the coordinator died three times running this request).
 *        Whether to show a result is SBDiag.acceptResult(active, result). A submit supersedes every earlier run.
 *     pool.cancel(runId); pool.stats() → Promise<coordinator stats>; pool.health() → {coordSpawns, watchdogKills,
 *        crashes, resubmits, lastRespawnMs, spareCoordUsed, spareHelperUsed, sharedCancel, spareCoordReady,
 *        spareHelperReady} (synchronous); pool.terminate()
 * Cancellation (F14, F-D2; AT-15, NFR-02): cooperative first. A cancel (or a superseding submit) sets the shared cancel
 * flag (an Int32Array on a SharedArrayBuffer where the page can share memory: the coordinator's long serial kernels poll
 * it every few rows) and posts cancel; the coordinator aborts the batch at once (helper items in flight are abandoned,
 * their late results dropped by runId) and answers canceled, waiting for nothing. If no answer comes within watchdogMs
 * (300 ms), the main-thread watchdog terminates the coordinator: the run settles canceled, the warm spare coordinator
 * (else a cold spawn) is promoted, the source is re-posted, the ports are re-brokered to the same helpers and the other
 * runs are resubmitted; the next draft is cold (the cache went with the coordinator). A coordinator that crashes is
 * handled the same way (its runs resubmitted, never shown as an error; a third crash is the fallback). A helper stuck in an
 * abandoned item for helperStuckMs (300 ms) is reported by the coordinator with killHelper {reason: "stuck"} and replaced
 * from the warm spare helper (new hello, modulesHash checked by the coordinator). spares: false skips both spares.
 * Handshake (§9.3, F.3, R7): the coordinator's hello must carry this page's engineVersion and appVersion and the
 * modulesHash of the module texts the page loads (loadText; skipped only when they cannot be read). A mismatch, a boot
 * error or no hello within helloTimeoutMs terminates it and respawns once (same URL, no ?v=); a second failure is the
 * fallback (the caller runs the sync driver; version skew says "Reload to update"). Helpers are admitted by the
 * coordinator (same modulesHash); killHelper terminates a refused one and respawns a crashed one.
 * ==========================================================================*/
"use strict";

(function (global) {
  const P = {};

  /** F13 (NFR-04, F.3): the estBytes admission budget in bytes; SBEngine.memoryBudget (512 MiB without deviceMemory). */
  P.memoryBudget = function (deviceMemory, deviceClass) { return global.SBEngine.memoryBudget(deviceMemory, deviceClass); };

  P.helperCount = function (hc, deviceClass) {
    const cap = deviceClass === "mobile" ? 4 : 8, n = Number.isFinite(hc) ? Math.floor(hc) - 1 : 1;
    return Math.max(1, Math.min(cap, n));
  };

  /** Deep Object.freeze, typed arrays skipped (as SBEngine's): responses are re-frozen after structured clone. */
  function deepFreeze(root) {
    const stack = [root];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== "object" || Object.isFrozen(o) || ArrayBuffer.isView(o)) continue;
      Object.freeze(o);
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const v = o[i]; if (v && typeof v === "object") stack.push(v); } }
      else for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
    }
    return root;
  }
  const coded = (code, message) => { const e = new Error(message === undefined ? code : message); e.code = code; return e; };

  P.longTasks = function () {
    const PO = global.PerformanceObserver;
    const supported = typeof PO === "function" && Array.isArray(PO.supportedEntryTypes) && PO.supportedEntryTypes.includes("longtask");
    const s = { obs: null, max: 0, count: 0 };
    const take = (list) => { for (const e of list) { s.count++; if (e.duration > s.max) s.max = e.duration; } };
    return {
      supported,
      start() {
        s.max = 0; s.count = 0;
        if (supported && !s.obs) { s.obs = new PO((l) => take(l.getEntries())); s.obs.observe({ entryTypes: ["longtask"] }); }
      },
      stop() {
        if (s.obs) { try { take(s.obs.takeRecords()); } catch (_) { /* older engines */ } s.obs.disconnect(); s.obs = null; }
        return { supported, max: s.max, count: s.count };
      },
    };
  };

  /**
   * F14: the shared cancel flag, an Int32Array(2) on a SharedArrayBuffer (slot 0: every runId below it is superseded,
   * slot 1: an explicitly canceled runId), or null where the page cannot share memory (no cross-origin isolation): then
   * a coordinator inside a long serial kernel only stops at the watchdog.
   */
  function makeFlag() {
    if (typeof global.SharedArrayBuffer !== "function" || typeof global.Atomics !== "object" || global.crossOriginIsolated === false) return null;
    try { return new Int32Array(new global.SharedArrayBuffer(8)); } catch (_) { return null; }
  }

  P.create = function (o) {
    o = o || {};
    const E = global.SBEngine, H = global.SBHash;
    const spawn = typeof o.spawn === "function" ? o.spawn : (name) => new global.Worker(o.workerUrl || "js/worker.js", { name });
    const nHelpers = Number.isInteger(o.helpers) && o.helpers >= 0 ? o.helpers
      : P.helperCount(global.navigator && global.navigator.hardwareConcurrency, o.deviceClass || "desktop");
    const expect = { engineVersion: o.engineVersion || E.VERSION, appVersion: o.appVersion };
    const loadText = typeof o.loadText === "function" ? o.loadText : (n) => global.fetch((o.moduleBase || "js/") + n).then((r) => {
      if (!r.ok) throw new Error("cannot read " + n);
      return r.text();
    });
    const timeoutMs = o.helloTimeoutMs > 0 ? o.helloTimeoutMs : 10000;
    const onState = typeof o.onState === "function" ? o.onState : () => {};
    // F14 (F-D2): cooperative cancel first; a coordinator that has not answered a cancel after watchdogMs is terminated
    const watchdogMs = o.watchdogMs > 0 ? o.watchdogMs : 300;
    const stuckMs = o.helperStuckMs > 0 ? o.helperStuckMs : 300;
    const spares = o.spares !== false;
    const now = () => (global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now());

    const st = { coord: null, spawns: 0, crashes: 0, runSeq: 0, outbox: [], runs: new Map(), helpers: new Map(), helperCrashes: new Map(),
      statsWaiters: [], lastSource: null, postedHash: undefined, hashMemo: null,
      spareCoord: null, spareCoordBooting: null, spareHelper: null, respawnAt: null, flag: makeFlag(),
      health: { coordSpawns: 0, watchdogKills: 0, crashes: 0, resubmits: 0, lastRespawnMs: null, spareCoordUsed: 0, spareHelperUsed: 0 } };
    const pool = { mode: "starting", notice: null, ready: null, helpersReady: null };
    let readyResolve, helpersResolve;
    pool.ready = new Promise((r) => { readyResolve = r; });
    pool.helpersReady = new Promise((r) => { helpersResolve = r; });
    const greeted = new Set(), settledHelper = (id) => { greeted.add(id); if (greeted.size >= nHelpers) helpersResolve(nHelpers); };

    const setMode = (mode, notice) => { pool.mode = mode; pool.notice = notice || null; onState({ mode, notice: pool.notice }); };
    const finish = (runId, r, value) => { st.runs.delete(runId); clearTimeout(r.timer); r.resolve(value); };
    const canceledResult = (r, watchdog) => Object.assign({}, r.echo, { status: "canceled", response: null }, watchdog ? { watchdog: true } : {});
    const rejectAll = (code, message) => {
      for (const r of st.runs.values()) { clearTimeout(r.timer); r.reject(coded(code, message)); }
      st.runs.clear();
      for (const w of st.statsWaiters.splice(0)) w(null);
    };
    const postCoord = (msg, transfer) => {
      if (pool.mode === "pool") st.coord.postMessage(msg, transfer || []);
      else if (pool.mode === "starting") st.outbox.push([msg, transfer || []]);
    };
    const postSource = (src) => {
      st.postedHash = src.sampleHash;
      const px = src.pixels.slice(), al = src.alpha == null ? null : src.alpha.slice();
      postCoord({ type: "source", sampleHash: src.sampleHash, pixels: px, alpha: al, w: src.w, h: src.h, channels: src.channels }, al ? [px.buffer, al.buffer] : [px.buffer]);
    };
    const expectedHash = (modules) => {
      if (typeof o.modulesHash === "string") return Promise.resolve(o.modulesHash);
      const key = JSON.stringify(modules || []);
      if (!st.hashMemo || st.hashMemo.key !== key)
        st.hashMemo = { key, p: Promise.all((modules || []).map((n) => loadText(n))).then((t) => H.modulesHash(modules.map((n, i) => [n, t[i]])), () => null) };
      return st.hashMemo.p;
    };
    const killHelpers = () => { for (const w of st.helpers.values()) w.terminate(); st.helpers.clear(); };
    const killSpares = () => {
      for (const k of ["spareCoord", "spareCoordBooting", "spareHelper"]) { const w = st[k]; st[k] = null; if (w) w.terminate(); }
    };

    function fallback(reason) {
      if (st.coord) st.coord.terminate();
      st.coord = null;
      killHelpers();
      killSpares();
      st.outbox.length = 0;
      setMode("fallback", reason === "version" ? "A newer version of Shadowbox Studio is installed. Reload to update."
        : "Background processing is unavailable; the preview runs on the page (reduced responsiveness).");
      rejectAll("POOL_UNAVAILABLE", "the worker pool is unavailable (" + reason + ")");
      readyResolve(false);
      helpersResolve(0);
    }
    function refuse(w, reason) {
      w.terminate();
      if (st.coord !== w) return;
      st.coord = null;
      if (st.spawns < 2) startCoord(); else fallback(reason);
    }
    /** The coordinator (or a spare) is admitted: the cancel flag, ports re-brokered to the live helpers, the outbox. */
    function up() {
      setMode("pool");
      if (st.flag) { try { st.coord.postMessage({ type: "cancelFlag", flag: st.flag }); } catch (_) { st.flag = null; } }
      for (let id = 1; id <= nHelpers; id++) { const w = st.helpers.get(id); if (w) broker(id, w); else spawnHelper(id); }
      for (const [m, t] of st.outbox.splice(0)) st.coord.postMessage(m, t);
      if (st.respawnAt !== null) { st.health.lastRespawnMs = now() - st.respawnAt; st.respawnAt = null; }
      if (nHelpers === 0) helpersResolve(0);
      readyResolve(true);
      pool.helpersReady.then(() => { spawnSpareCoord(); spawnSpareHelper(); });
    }
    /**
     * F14: the coordinator died (crash) or did not answer a cancel (watchdog). It is terminated; runs being canceled settle
     * as canceled, the others are resubmitted (never shown as an error; at most twice each). The warm spare coordinator is
     * promoted when there is one (else a cold spawn); the source is re-posted and the ports re-brokered to the same
     * helpers. Its draft cache is gone, so the next draft is cold, by design.
     */
    function respawn(reason) {
      const old = st.coord;
      st.coord = null;
      if (old) old.terminate();
      st.respawnAt = now();
      st.outbox.length = 0;
      setMode("starting");
      for (const w of st.statsWaiters.splice(0)) w(null);
      if (st.lastSource) postSource(st.lastSource);
      for (const [id, r] of [...st.runs.entries()].sort((a, b) => a[0] - b[0])) {
        if (r.canceling) { finish(id, r, canceledResult(r, reason === "watchdog")); continue; }
        if (++r.resubmits > 2) { st.runs.delete(id); clearTimeout(r.timer); r.reject(coded("POOL_DOWN", "the coordinator worker stopped while running this request")); continue; }
        st.health.resubmits++;
        st.outbox.push([r.msg, []]);
      }
      const spare = st.spareCoord;
      if (spare) {
        st.spareCoord = null;
        st.health.spareCoordUsed++;
        st.coord = spare;
        st.spawns = 1;
        up();
      } else {
        st.spawns = 0;
        startCoord();
      }
    }
    function crashed(w) {
      w.terminate();
      if (st.coord !== w) return;
      st.health.crashes++;
      if (++st.crashes > 2) { st.coord = null; fallback("crash"); return; }
      respawn("crash");
    }

    /** Hello within the timeout, versions and modulesHash checked; cb(ok, reason) once. After that, messages go to onCoord. */
    function watchBoot(w, cb) {
      const seen = { hello: false, ok: false, done: false };
      const once = (ok, reason) => { if (seen.done) return; seen.done = true; seen.ok = ok; cb(ok, reason); };
      const timer = setTimeout(() => { if (!seen.hello) once(false, "timeout"); }, timeoutMs);
      w.onmessage = (ev) => {
        const m = ev.data;
        if (!m || typeof m !== "object") return;
        if (!seen.hello) {
          if (m.type !== "hello") { if (m.type === "error") { clearTimeout(timer); once(false, "boot"); } return; }
          seen.hello = true;
          clearTimeout(timer);
          const versionsOk = m.engineVersion === expect.engineVersion && m.appVersion === expect.appVersion;
          (versionsOk ? expectedHash(m.modules) : Promise.resolve(false)).then((h) => once(versionsOk && (h === null || h === m.modulesHash), "version"));
          return;
        }
        if (st.coord === w) onCoord(m);
      };
      const bad = () => {
        clearTimeout(timer);
        if (!seen.done) { once(false, "error"); return; }
        if (st.coord === w) crashed(w);
        else if (st.spareCoord === w) { st.spareCoord = null; w.terminate(); }
      };
      w.onerror = bad;
      w.onmessageerror = bad;
    }

    function startCoord() {
      st.spawns++;
      let w;
      try { w = spawn("sb-coord"); } catch (e) { fallback("spawn"); return; }
      st.health.coordSpawns++;
      st.coord = w;
      watchBoot(w, (ok, reason) => {
        if (st.coord !== w) { if (!ok) w.terminate(); return; }
        if (ok) up(); else refuse(w, reason);
      });
    }
    /** F14: a warm spare coordinator (booted, hello checked), promoted by respawn. */
    function spawnSpareCoord() {
      if (!spares || st.spareCoord || st.spareCoordBooting || pool.mode !== "pool") return;
      let w;
      try { w = spawn("sb-coord"); } catch (e) { return; }
      st.health.coordSpawns++;
      st.spareCoordBooting = w;
      watchBoot(w, (ok) => {
        if (st.spareCoordBooting !== w) { w.terminate(); return; }
        st.spareCoordBooting = null;
        if (ok && (pool.mode === "pool" || pool.mode === "starting")) st.spareCoord = w; else w.terminate();
      });
    }
    /** F14: a warm spare helper (spawned, modules loading); it says hello only once it gets its port. */
    function spawnSpareHelper() {
      if (!spares || nHelpers === 0 || st.spareHelper || pool.mode !== "pool") return;
      let w;
      try { w = spawn("sb-helper-spare"); } catch (e) { return; }
      st.spareHelper = w;
      w.onerror = () => { if (st.spareHelper === w) { st.spareHelper = null; w.terminate(); } };
    }

    function broker(id, w) {
      const ch = new MessageChannel();
      w.postMessage({ type: "port", helperId: id, port: ch.port1 }, [ch.port1]);
      st.coord.postMessage({ type: "ports", helperId: id, port: ch.port2 }, [ch.port2]);
    }
    function attachHelper(id, w) {
      st.helpers.set(id, w);
      w.onmessage = (ev) => { if (ev.data && ev.data.type === "hello") settledHelper(id); };   // alive; items travel on the brokered port
      w.onerror = () => {
        if (st.helpers.get(id) !== w) return;
        settledHelper(id);
        w.terminate();
        st.helpers.delete(id);
        postCoord({ type: "helperDown", helperId: id });
        const n = st.helperCrashes.get(id) || 0;
        if (n < 2 && pool.mode === "pool") { st.helperCrashes.set(id, n + 1); replaceHelper(id); }
      };
    }
    function spawnHelper(id) {
      let w;
      try { w = spawn("sb-helper-" + id); } catch (e) { settledHelper(id); return; }   // the coordinator runs the items inline
      attachHelper(id, w);
      broker(id, w);
    }
    /** F14: a helper replaced from the warm spare when there is one; the coordinator admits it on its own hello (modulesHash). */
    function replaceHelper(id) {
      const w = st.spareHelper;
      if (!w) { spawnHelper(id); return; }
      st.spareHelper = null;
      st.health.spareHelperUsed++;
      attachHelper(id, w);
      broker(id, w);
      spawnSpareHelper();
    }

    /** F14: a run being canceled (explicitly or superseded) — the watchdog terminates the coordinator if it does not answer. */
    function cancelRun(runId, r) {
      if (r.canceling) return;
      r.canceling = true;
      if (pool.mode !== "pool") {   // no coordinator has it yet: drop its generate from the outbox
        const i = st.outbox.findIndex(([m]) => m.type === "generate" && m.runId === runId);
        if (i >= 0) st.outbox.splice(i, 1);
        finish(runId, r, canceledResult(r, false));
        return;
      }
      r.timer = setTimeout(() => {
        if (st.runs.get(runId) !== r || pool.mode !== "pool") return;
        st.health.watchdogKills++;
        respawn("watchdog");
      }, watchdogMs);
    }

    function onCoord(m) {
      const r = m.runId !== undefined && m.runId !== null ? st.runs.get(m.runId) : null;
      switch (m.type) {
        case "ack": if (r && r.onStart) r.onStart({ runId: m.runId }); break;
        case "progress": if (r && r.onProgress) r.onProgress({ runId: m.runId, stage: m.stage, frac: m.frac, sub: m.sub }); break;
        case "result":
          if (!r) break;
          deepFreeze(m.response);
          finish(m.runId, r, { runId: m.runId, gen: m.gen, sampleHash: m.sampleHash, overlays: m.overlays, deviceClass: m.deviceClass, status: m.response.status, response: m.response });
          break;
        case "canceled":
          if (!r) break;
          finish(m.runId, r, canceledResult(r, false));
          break;
        case "error":
          if (!r) break;
          st.runs.delete(m.runId);
          clearTimeout(r.timer);
          r.reject(coded(m.code || "ENGINE_INTERNAL", m.message));
          break;
        case "killHelper": {   // refused (modulesHash: not replaced), stuck in an abandoned item (F14) or broken
          const id = m.helperId, w = st.helpers.get(id);
          if (w) { w.terminate(); st.helpers.delete(id); }
          if (m.reason === "modulesHash") break;
          if (m.reason !== "stuck") {
            const n = st.helperCrashes.get(id) || 0;
            if (n >= 2) break;
            st.helperCrashes.set(id, n + 1);
          }
          replaceHelper(id);
          break;
        }
        case "stats": { const w = st.statsWaiters.shift(); if (w) w(m); break; }
        default: break;
      }
    }

    pool.setSource = function (src) {
      if (!src || typeof src.sampleHash !== "string" || !src.pixels) throw coded("ENGINE_ARG", "setSource needs {sampleHash, pixels, alpha, w, h, channels}");
      st.lastSource = src;
      if (src.sampleHash !== st.postedHash) postSource(src);
    };

    pool.submit = function (req, so) {
      so = so || {};
      const runId = ++st.runSeq, ns = (req && req.normalizedSource) || {};
      const sampleHash = so.sampleHash === undefined ? null : so.sampleHash;
      const echo = { runId, gen: so.gen === undefined ? null : so.gen, sampleHash, overlays: so.overlays !== false,
        deviceClass: req && req.deviceClass !== undefined ? req.deviceClass : "desktop" };
      const msg = Object.assign({ type: "generate", w: ns.w, h: ns.h, channels: ns.channels, draftCapPx: req.draftCapPx,
        budgetBytes: o.memoryBudget > 0 ? o.memoryBudget : P.memoryBudget(global.navigator && global.navigator.deviceMemory, echo.deviceClass),
        mainBytes: so.mainBytes > 0 ? so.mainBytes : 0, stuckMs,
        req: sampleHash === null ? req : Object.assign({}, req, { normalizedSource: null }) }, echo);
      const done = new Promise((resolve, reject) => {
        if (pool.mode === "fallback" || pool.mode === "closed") { reject(coded("POOL_UNAVAILABLE", "the worker pool is unavailable")); return; }
        st.runs.set(runId, { resolve, reject, echo, onStart: so.onStart, onProgress: so.onProgress, msg, canceling: false, timer: null, resubmits: 0 });
      });
      if (typeof so.onAck === "function") queueMicrotask(() => so.onAck({ runId }));
      if (st.runs.has(runId)) {
        // one run at a time (F.3): this run supersedes every earlier one (shared flag first, then the watchdog per run)
        if (st.flag) Atomics.store(st.flag, 0, runId);
        for (const [id, r] of [...st.runs.entries()]) if (id !== runId) cancelRun(id, r);
        postCoord(msg);
      }
      return { runId, done };
    };

    pool.cancel = function (runId) {
      const r = st.runs.get(runId);
      if (!r) return;
      if (st.flag) Atomics.store(st.flag, 1, runId);
      if (pool.mode === "pool") postCoord({ type: "cancel", runId });
      cancelRun(runId, r);
    };

    pool.stats = function () {
      if (pool.mode !== "pool" && pool.mode !== "starting") return Promise.resolve(null);
      return new Promise((resolve) => { st.statsWaiters.push(resolve); postCoord({ type: "stats" }); });
    };

    /** F14: main-side pool health (synchronous): spawns, watchdog kills, crashes, resubmits, last respawn time, spares. */
    pool.health = function () {
      return Object.assign({}, st.health, { sharedCancel: !!st.flag, spareCoordReady: !!st.spareCoord, spareHelperReady: !!st.spareHelper });
    };

    pool.terminate = function () {
      if (st.coord) st.coord.terminate();
      st.coord = null;
      killHelpers();
      killSpares();
      st.outbox.length = 0;
      rejectAll("POOL_UNAVAILABLE", "the worker pool was closed");
      setMode("closed");
      readyResolve(false);
      helpersResolve(0);
    };

    startCoord();
    return pool;
  };

  global.SBPool = Object.freeze(P);
})(typeof window !== "undefined" ? window : globalThis);
