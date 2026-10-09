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
 *   SBPool.create({spawn?, workerUrl?, helpers?, deviceClass?, appVersion, engineVersion?, loadText?, moduleBase?,
 *                  modulesHash?, helloTimeoutMs?, onState?}) → pool
 *     pool.ready      Promise<boolean>: true once a coordinator's hello matched; false when the pool fell back
 *     pool.helpersReady  Promise: settles once every first-spawn helper said hello or failed (until then, and for a
 *                     refused helper, the coordinator runs items inline — same results)
 *     pool.mode       "starting" | "pool" | "fallback" | "closed";  pool.notice: the fallback's user-facing text
 *     pool.setSource({sampleHash, pixels, alpha, w, h, channels})  posts a transferred COPY, once per sampleHash
 *     pool.submit(req, {sampleHash, gen, overlays, onAck, onStart, onProgress}) → {runId, done}
 *        req is SBEngine.request(…); with a sampleHash its pixels stay on main and the coordinator uses the stored
 *        source (SOURCE_MISMATCH otherwise); sampleHash null sends the pixels inline. runId is a unique monotonic
 *        counter. onAck({runId}) fires on main in a microtask (NFR-02 ≤ 100 ms; the coordinator cannot answer while
 *        inside a serial segment); onStart({runId}) on the coordinator's ack; onProgress({runId, stage, frac, sub}).
 *        done → {runId, gen, sampleHash, overlays, deviceClass, status, response} (response deep-frozen again on
 *        receipt; status "canceled" without a response); rejects with an Error carrying .code for a coordinator
 *        error (SOURCE_MISMATCH, …), POOL_UNAVAILABLE (fallback / closed) or POOL_DOWN (the coordinator died).
 *        Whether to show a result is SBDiag.acceptResult(active, result).
 *     pool.cancel(runId); pool.stats() → Promise<coordinator stats>; pool.terminate()
 * Handshake (§9.3, F.3, R7): the coordinator's hello must carry this page's engineVersion and appVersion and the
 * modulesHash of the module texts the page loads (loadText; skipped only when they cannot be read). A mismatch, a boot
 * error or no hello within helloTimeoutMs terminates it and respawns once (same URL, no ?v=); a second failure is the
 * fallback (the caller runs the sync driver; version skew says "Reload to update"). Helpers are admitted by the
 * coordinator (same modulesHash); killHelper terminates a refused one and respawns a crashed one.
 * ==========================================================================*/
"use strict";

(function (global) {
  const P = {};

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

    const st = { coord: null, spawns: 0, crashes: 0, runSeq: 0, outbox: [], runs: new Map(), helpers: new Map(), helperRespawns: new Map(),
      statsWaiters: [], lastSource: null, postedHash: undefined, hashMemo: null };
    const pool = { mode: "starting", notice: null, ready: null, helpersReady: null };
    let readyResolve, helpersResolve;
    pool.ready = new Promise((r) => { readyResolve = r; });
    pool.helpersReady = new Promise((r) => { helpersResolve = r; });
    const greeted = new Set(), settledHelper = (id) => { greeted.add(id); if (greeted.size >= nHelpers) helpersResolve(nHelpers); };

    const setMode = (mode, notice) => { pool.mode = mode; pool.notice = notice || null; onState({ mode, notice: pool.notice }); };
    const rejectAll = (code, message) => {
      for (const r of st.runs.values()) r.reject(coded(code, message));
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

    function fallback(reason) {
      if (st.coord) st.coord.terminate();
      st.coord = null;
      killHelpers();
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
    function up() {
      setMode("pool");
      for (let id = 1; id <= nHelpers; id++) spawnHelper(id);
      for (const [m, t] of st.outbox.splice(0)) st.coord.postMessage(m, t);
      if (nHelpers === 0) helpersResolve(0);
      readyResolve(true);
    }
    function crashed(w) {   // the coordinator died after hello: its runs fail (F14 resubmits), a fresh one is started
      w.terminate();
      if (st.coord !== w) return;
      st.coord = null;
      killHelpers();
      rejectAll("POOL_DOWN", "the coordinator worker stopped");
      if (++st.crashes > 2) { fallback("crash"); return; }
      st.spawns = 0;
      setMode("starting");
      if (st.lastSource) postSource(st.lastSource);
      startCoord();
    }

    function startCoord() {
      st.spawns++;
      let w;
      try { w = spawn("sb-coord"); } catch (e) { fallback("spawn"); return; }
      st.coord = w;
      const seen = { hello: false };
      const timer = setTimeout(() => { if (!seen.hello && st.coord === w) refuse(w, "timeout"); }, timeoutMs);
      w.onmessage = (ev) => {
        if (st.coord !== w) return;
        const m = ev.data;
        if (!m || typeof m !== "object") return;
        if (!seen.hello) {
          if (m.type !== "hello") { if (m.type === "error") { clearTimeout(timer); refuse(w, "boot"); } return; }
          seen.hello = true;
          clearTimeout(timer);
          const versionsOk = m.engineVersion === expect.engineVersion && m.appVersion === expect.appVersion;
          (versionsOk ? expectedHash(m.modules) : Promise.resolve(false)).then((h) => {
            if (st.coord !== w) return;
            if (versionsOk && (h === null || h === m.modulesHash)) up(); else refuse(w, "version");
          });
          return;
        }
        onCoord(m);
      };
      const bad = () => { if (st.coord !== w) return; clearTimeout(timer); if (!seen.hello) refuse(w, "error"); else crashed(w); };
      w.onerror = bad;
      w.onmessageerror = bad;
    }

    function spawnHelper(id) {
      let w;
      try { w = spawn("sb-helper-" + id); } catch (e) { return; }   // the coordinator runs the items inline
      st.helpers.set(id, w);
      const ch = new MessageChannel();
      w.onmessage = (ev) => { if (ev.data && ev.data.type === "hello") settledHelper(id); };   // alive; items travel on the brokered port
      w.onerror = () => {
        if (st.helpers.get(id) !== w) return;
        settledHelper(id);
        w.terminate();
        st.helpers.delete(id);
        postCoord({ type: "helperDown", helperId: id });
        const n = st.helperRespawns.get(id) || 0;
        if (n < 2 && pool.mode === "pool") { st.helperRespawns.set(id, n + 1); spawnHelper(id); }
      };
      w.postMessage({ type: "port", helperId: id, port: ch.port1 }, [ch.port1]);
      st.coord.postMessage({ type: "ports", helperId: id, port: ch.port2 }, [ch.port2]);
    }

    function onCoord(m) {
      const r = m.runId !== undefined && m.runId !== null ? st.runs.get(m.runId) : null;
      switch (m.type) {
        case "ack": if (r && r.onStart) r.onStart({ runId: m.runId }); break;
        case "progress": if (r && r.onProgress) r.onProgress({ runId: m.runId, stage: m.stage, frac: m.frac, sub: m.sub }); break;
        case "result":
          if (!r) break;
          st.runs.delete(m.runId);
          deepFreeze(m.response);
          r.resolve({ runId: m.runId, gen: m.gen, sampleHash: m.sampleHash, overlays: m.overlays, deviceClass: m.deviceClass, status: m.response.status, response: m.response });
          break;
        case "canceled":
          if (!r) break;
          st.runs.delete(m.runId);
          r.resolve(Object.assign({}, r.echo, { status: "canceled", response: null }));
          break;
        case "error":
          if (!r) break;
          st.runs.delete(m.runId);
          r.reject(coded(m.code || "ENGINE_INTERNAL", m.message));
          break;
        case "killHelper": {
          const w = st.helpers.get(m.helperId);
          if (w) { w.terminate(); st.helpers.delete(m.helperId); }
          if (m.reason !== "modulesHash") {
            const n = st.helperRespawns.get(m.helperId) || 0;
            if (n < 2) { st.helperRespawns.set(m.helperId, n + 1); spawnHelper(m.helperId); }
          }
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
      const done = new Promise((resolve, reject) => {
        if (pool.mode === "fallback" || pool.mode === "closed") { reject(coded("POOL_UNAVAILABLE", "the worker pool is unavailable")); return; }
        st.runs.set(runId, { resolve, reject, echo, onStart: so.onStart, onProgress: so.onProgress });
      });
      if (typeof so.onAck === "function") queueMicrotask(() => so.onAck({ runId }));
      if (st.runs.has(runId))
        postCoord(Object.assign({ type: "generate", w: ns.w, h: ns.h, channels: ns.channels, draftCapPx: req.draftCapPx,
          req: sampleHash === null ? req : Object.assign({}, req, { normalizedSource: null }) }, echo));
      return { runId, done };
    };

    pool.cancel = function (runId) { postCoord({ type: "cancel", runId }); };

    pool.stats = function () {
      if (pool.mode !== "pool" && pool.mode !== "starting") return Promise.resolve(null);
      return new Promise((resolve) => { st.statsWaiters.push(resolve); postCoord({ type: "stats" }); });
    };

    pool.terminate = function () {
      if (st.coord) st.coord.terminate();
      st.coord = null;
      killHelpers();
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
