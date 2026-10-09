/* ============================================================================
 * Shadowbox Studio — js/worker.js
 * ----------------------------------------------------------------------------
 * The coordinator / helper Web Worker (speed round, Appendix F, F11). One file,
 * two roles, chosen by the worker's name (SBPool spawns "sb-coord" and
 * "sb-helper-<id>"):
 *
 *   coord   owns the stored source, the draft stage cache (K1/K2) and the one
 *           run in flight; runs SBEngine.generateAsync, posting every batch
 *           item to an admitted helper, or running it inline (P = 0, no helper
 *           admitted, a helper lost, a DataCloneError). Folds stay in the
 *           engine's generator, so the response equals SBEngine.generate's.
 *   helper  runs SBEngine.TASKS[kind](...args) for the items the coordinator
 *           posts on its MessagePort.
 *
 * Protocol (plan F11):
 *   main → coord   source {sampleHash, pixels, alpha, w, h, channels} (a transferred copy, once per sampleHash)
 *                  generate {runId, gen, sampleHash, w, h, channels, overlays, deviceClass, draftCapPx, budgetBytes, mainBytes, req}
 *                    (req without pixels; pixels inline in req.normalizedSource when sampleHash is null)
 *                  cancel {runId}; ports {helperId, port}; helperDown {helperId}; stats {}; cancelFlag {flag} (F14)
 *   coord → main   hello {role, engineVersion, appVersion, modulesHash, modules}; ack {runId} (start of work);
 *                  progress {runId, stage, frac, sub} (≤ 10 Hz, frac monotone); result {runId, gen, sampleHash,
 *                  overlays, deviceClass, response}; canceled {runId}; error {runId, code, message};
 *                  killHelper {helperId, reason}; stats {…}
 *   main → helper  port {helperId, port}
 *   helper → coord hello {modulesHash, …} before any item; itemResult {runId, batchId, index, ok, value | error, infra?}
 *   coord → helper item {runId, batchId, index, kind, args}
 * Rules (F.3): one run at a time (a new generate cancels the current run and every queued one); source identity
 * (SOURCE_MISMATCH unless sampleHash, w, h and channels equal the stored source; normalizedSource is rebuilt from the
 * stored source only after that check); a canceled or failed run never writes K1/K2 (the run works on a scratch copy of
 * the cache slots, committed on "done"); a helper is admitted only when its hello carries the coordinator's
 * modulesHash; pool-infrastructure failures re-run the item inline and are never surfaced; errors cross postMessage as
 * {code, message, phase} and are rebuilt with .code. Workers never set SBEngine.TEST_HOOKS.
 * Scheduling (F13): a batch's items are dispatched largest cost first (SBEngine.lptOrder; dispatch order only, results
 * fold in item order) and admitted by one estBytes ledger (SBEngine.memoryLedger: the coordinator's resident set at the
 * yield + mainBytes + in-flight items ≤ budgetBytes, at least one item always admitted); raster kernels run as one row
 * band per admitted helper; helper results transfer their buffers back (the helper keeps nothing). Stats add
 * helperKinds (helper-run items per kind), maxInFlight, peakLedger, budgetBytes, bands and lastOrder (per kind).
 * Cancellation (F14, F-D2): a run is canceled by cancel {runId}, a superseding generate or the shared cancel flag
 * (cancelFlag: Int32Array slot 0 = runs below it superseded, slot 1 = a canceled runId; read with Atomics.load, so the
 * serial kernels' poll sees it where no message can arrive). The flag is checked at every step(), before every dispatch
 * and every few rows of masks, the Kuwahara SAT scan and the complexity gate; a cancel aborts the batch at once
 * (SBEngine.Canceled): pending inline items are skipped, helper items in flight are abandoned — their late itemResult
 * (old runId) is dropped (staleDropped) and a helper still busy after stuckMs (generate.stuckMs, 300 ms) is reported
 * with killHelper {reason: "stuck"} (stuckKilled). Stats add stage (the current step), sampleHash, k1Key, k2Key,
 * staleDropped, stuckKilled and sharedCancel.
 *
 * Not a page script (not in index.html); precached in sw.js SHELL so page and
 * worker always come from the same cache version (R7, F-D3).
 * ==========================================================================*/
"use strict";

// prettier-ignore
const WORKER_MODULES = ["util.js","hash.js","vendor/clipper2.js","geom.js","diag.js","schema.js","png.js","jpeg.js","height.js","raster.js","morph.js","islands.js","trace.js","construct.js","material.js","support.js","strokefont.js","guides.js","svgout.js","svgread.js","proof.js","zip.js","docs.js","engine.js"];
// The app version this worker ships with: equals APP_VERSION in js/app.js and VERSION in sw.js (hygiene test, §9.3).
const WORKER_APP_VERSION = "2.0.0-alpha.3";

(function (self) {
  if (!self || typeof self.postMessage !== "function" || typeof self.importScripts !== "function") return;   // not a worker
  const role = /^sb-helper/.test(String(self.name || "")) ? "helper" : "coord";
  const post = (m, transfer) => self.postMessage(m, transfer || []);

  /** The module texts (for modulesHash), then the modules themselves, in WORKER_MODULES order. */
  async function loadModules() {
    // F16: a Blob worker built from the bundle's inlined texts sets SB_INLINED and has already evaluated them
    if (typeof SB_INLINED !== "undefined") return WORKER_MODULES.map((n) => SB_INLINED[n]);
    const texts = await Promise.all(WORKER_MODULES.map(async (n) => {
      const r = await fetch(n);
      if (!r.ok) throw new Error("worker: cannot load " + n + " (" + r.status + ")");
      return r.text();
    }));
    self.importScripts.apply(self, WORKER_MODULES);
    return texts;
  }

  /** A macrotask yield, so cancel and helper messages are handled between inline items. */
  const yieldTask = typeof setImmediate === "function" ? () => new Promise((r) => setImmediate(r)) : (() => {
    const ch = new MessageChannel(), q = [];
    ch.port1.onmessage = () => { const r = q.shift(); if (r) r(); };
    return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
  })();

  /** Kernel error → {phase, code, message} (structured-clone safe); phase of a fused item's PhaseError. */
  function errOut(e) {
    const P = self.SBEngine && self.SBEngine.PhaseError, phased = typeof P === "function" && e instanceof P;
    const x = phased ? e.error : e;
    return { phase: phased ? e.phase : undefined, code: x && x.code !== undefined ? x.code : undefined, message: x && x.message !== undefined ? x.message : String(x) };
  }
  /** {code, message} → Error with .code (the engine's codedError reads exactly these). */
  function errIn(o) {
    const e = new Error(o && o.message !== undefined ? o.message : "");
    if (o && o.code !== undefined) e.code = o.code;
    return e;
  }

  // ------------------------------------------------------------------ helper
  /**
   * The ArrayBuffers of the typed arrays inside a helper's result (F13): the helper keeps nothing, so its results'
   * buffers are transferred instead of copied. Walks objects and arrays of objects (arrays of numbers are skipped).
   */
  function resultBuffers(v) {
    const set = new Set(), stack = [v];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      if (ArrayBuffer.isView(o)) { if (o.buffer.byteLength > 0) set.add(o.buffer); continue; }
      if (Array.isArray(o)) { if (o.length && typeof o[0] !== "object") continue; for (const x of o) if (x && typeof x === "object") stack.push(x); }
      else for (const k of Object.keys(o)) { const x = o[k]; if (x && typeof x === "object") stack.push(x); }
    }
    return [...set];
  }

  function helper(modulesHash) {
    const E = self.SBEngine, box = { port: null };
    function onItem(m) {
      let out, tr = [];
      try {
        const fn = E.TASKS[m.kind];
        if (typeof fn !== "function") throw Object.assign(new Error("no kernel " + m.kind), { code: "ENGINE_INTERNAL" });
        out = { type: "itemResult", runId: m.runId, batchId: m.batchId, index: m.index, ok: true, value: fn.apply(null, m.args) };
        tr = resultBuffers(out.value);
      } catch (e) {
        out = { type: "itemResult", runId: m.runId, batchId: m.batchId, index: m.index, ok: false, error: errOut(e) };
      }
      try { box.port.postMessage(out, tr); } catch (e) {   // DataCloneError: infrastructure, the coordinator re-runs it inline
        box.port.postMessage({ type: "itemResult", runId: m.runId, batchId: m.batchId, index: m.index, ok: false, infra: true, error: errOut(e) });
      }
    }
    return (d) => {
      if (!d || d.type !== "port" || !d.port) return;
      // F14: a respawned coordinator re-brokers a port to the same helper; the old coordinator's port is closed
      if (box.port && box.port !== d.port) { try { box.port.close(); } catch (_) { /* already closed */ } }
      box.port = d.port;
      box.port.onmessage = (ev) => { const m = ev.data; if (m && m.type === "item") onItem(m); };
      const hello = { type: "hello", role: "helper", helperId: d.helperId, engineVersion: E.VERSION, appVersion: WORKER_APP_VERSION, modulesHash };
      box.port.postMessage(hello);
      post(hello);
    };
  }

  // ------------------------------------------------------------- coordinator
  function coordinator(modulesHash) {
    const E = self.SBEngine;
    const st = { source: null, cache: { quality: "draft" }, queue: [], cur: null, helpers: new Map(), refused: [], itemsInline: 0, itemsHelper: 0,
      batchSeq: 0, batch: null, kinds: {}, maxInFlight: 0, peakLedger: 0, budgetBytes: null, lastOrder: {}, bands: 1,
      flag: null, stuckMs: 300, staleDropped: 0, stuckKilled: 0 };
    // F14: the shared cancel flag (an Int32Array on a SharedArrayBuffer, when the page can share one): slot 0 = every runId
    // below it is superseded, slot 1 = an explicitly canceled runId. Read with Atomics.load inside the serial kernels'
    // poll, where no message can be received.
    const flagged = (runId) => { const f = st.flag; return !!f && (runId < Atomics.load(f, 0) || runId === Atomics.load(f, 1)); };
    const canceled = (job) => job.canceled || flagged(job.runId);
    post({ type: "hello", role: "coord", engineVersion: E.VERSION, appVersion: WORKER_APP_VERSION, modulesHash, modules: WORKER_MODULES.slice() });

    // ---- helpers (ports brokered by main; admitted on a matching hello)
    function addHelper(id, port) {
      if (st.helpers.has(id)) helperDown(id);
      const h = { id, port, ok: false, item: null };
      st.helpers.set(id, h);
      port.onmessage = (ev) => onHelper(h, ev.data);
      port.onmessageerror = () => { if (st.helpers.get(id) === h) { post({ type: "killHelper", helperId: id, reason: "messageerror" }); helperDown(id); } };
    }
    function onHelper(h, m) {
      if (st.helpers.get(h.id) !== h || !m) return;
      if (m.type === "hello") {
        if (m.modulesHash === modulesHash) { h.ok = true; if (st.batch) st.batch.pump(); return; }
        st.refused.push(h.id);
        st.helpers.delete(h.id);
        try { h.port.close(); } catch (_) { /* already closed */ }
        post({ type: "killHelper", helperId: h.id, reason: "modulesHash" });
      } else if (m.type === "itemResult") {
        // F14: a result is taken only for the item this helper holds (same runId, batch and index); the late result of an
        // item abandoned by a cancel (or of an older run) is dropped and frees the helper.
        const it = h.item;
        if (!it || it.stale || it.runId !== m.runId || it.batchId !== m.batchId || it.index !== m.index) {
          st.staleDropped++;
          if (it && it.stale) { clearTimeout(it.timer); h.item = null; }
        } else {
          h.item = null;
          it.done(m);
        }
        if (st.batch) st.batch.pump();
      }
    }
    function helperDown(id) {
      const h = st.helpers.get(id);
      if (!h) return;
      st.helpers.delete(id);
      try { h.port.close(); } catch (_) { /* already closed */ }
      const it = h.item;
      h.item = null;
      if (it) it.lost();
      if (st.batch) st.batch.pump();
    }

    // ---- exec.map for generateAsync (F13): items dispatched largest cost first (LPT; dispatch order only), each admitted
    // by the batch's estBytes ledger (resident set + result on main + in-flight items ≤ budget; one item always runs),
    // to an admitted helper, else inline; results land by item index, the batch settles after every item.
    // F14: the batch checks the cancel flag before every dispatch; a cancel aborts it at once (rejects with SBEngine.Canceled):
    // inline items not yet run are skipped, helper items in flight are abandoned (stale: their late result is dropped)
    // and a helper still busy with one after stuckMs is reported with killHelper {reason: "stuck"} and replaced by main.
    function abandon(h) {
      const it = h.item;
      it.stale = true;
      it.timer = setTimeout(() => {
        if (st.helpers.get(h.id) !== h || h.item !== it) return;
        st.stuckKilled++;
        post({ type: "killHelper", helperId: h.id, reason: "stuck" });
        helperDown(h.id);
      }, st.stuckMs);
    }
    const makeExec = (job, budget, mainBytes) => ({
      map: (kind, items, o) => new Promise((resolve, reject) => {
        const fn = E.TASKS[kind];
        if (typeof fn !== "function") { reject(Object.assign(new Error("no kernel " + kind), { code: "ENGINE_INTERNAL" })); return; }
        // F.3 transfer ownership: whole buffers only, never the stored source or a K1/K2 array
        try {
          const s = st.source, c = job.cache || {}, owned = s ? [s.pixels, s.alpha] : [];
          if (c.k1) owned.push(c.k1.samples, c.k1.alpha);
          if (c.k2) owned.push(c.k2.L);
          if (st.cache.k1) owned.push(st.cache.k1.samples, st.cache.k1.alpha);
          if (st.cache.k2) owned.push(st.cache.k2.L);
          E.checkTransfers(kind, o && o.transfer, owned.filter((x) => x && ArrayBuffer.isView(x)));
        } catch (e) { reject(e); return; }
        const n = items.length, out = new Array(n), errs = [], batchId = ++st.batchSeq;
        if (canceled(job)) { reject(new E.Canceled()); return; }
        if (n === 0) { resolve(out); return; }
        const todo = E.lptOrder(o && o.cost, n), est = (i) => (o && o.estBytes && Number.isFinite(o.estBytes[i]) ? o.estBytes[i] : 0);
        st.lastOrder[kind] = todo.slice();
        const ledger = E.memoryLedger(budget, mainBytes + ((o && o.resident) || 0));
        let left = n;
        const b = { closed: false };
        b.abort = () => {
          if (b.closed) return;
          b.closed = true;
          if (st.batch === b) st.batch = null;
          for (const h of st.helpers.values()) if (h.item && !h.item.stale && h.item.batchId === batchId) abandon(h);
          reject(new E.Canceled());
        };
        const settle = (i, ok, v, phase) => {
          if (b.closed) return;
          ledger.give(est(i));
          if (ok) out[i] = v; else errs.push(phase === undefined ? { index: i, error: v } : { index: i, error: v, phase });
          if (--left === 0) {
            if (st.batch === b) st.batch = null;
            if (ledger.peak > st.peakLedger) st.peakLedger = ledger.peak;
            if (errs.length) reject(new E.BatchError(errs)); else resolve(out);
          } else b.pump();
        };
        const inline = (i) => {
          st.itemsInline++;
          yieldTask().then(() => {
            if (b.closed) return;
            if (canceled(job)) { b.abort(); return; }
            let v;
            try { v = fn.apply(null, items[i]); } catch (e) { settle(i, false, e); return; }
            settle(i, true, v);
          });
        };
        const take = (i) => {
          ledger.take(est(i));
          if (ledger.inFlight > st.maxInFlight) st.maxInFlight = ledger.inFlight;
        };
        b.pump = () => {
          while (!b.closed && todo.length && ledger.admits(est(todo[0]))) {
            if (canceled(job)) { b.abort(); return; }
            const ready = [...st.helpers.values()].filter((h) => h.ok && !(h.item && h.item.stale));
            if (!ready.length) { const i = todo.shift(); take(i); inline(i); continue; }
            const h = ready.find((x) => !x.item);
            if (!h) return;   // every admitted helper is busy: resumed by the next itemResult
            const i = todo.shift();
            take(i);
            h.item = { runId: job.runId, batchId, index: i,
              done: (m) => { if (m.ok) { st.itemsHelper++; st.kinds[kind] = (st.kinds[kind] || 0) + 1; settle(i, true, m.value); } else if (m.infra) inline(i); else settle(i, false, errIn(m.error), m.error.phase); },
              lost: () => inline(i) };
            // Arguments are cloned, not transferred: a lost helper's item re-runs inline on the coordinator's copy (F.3,
            // pool-infrastructure failures are never surfaced); the clone is counted in the item's estBytes.
            try { h.port.postMessage({ type: "item", runId: job.runId, batchId, index: i, kind, args: items[i] }); } catch (e) { h.item = null; inline(i); }
          }
        };
        st.batch = b;
        b.pump();
      }),
    });

    // ---- one run at a time
    async function runJob(m, job) {
      post({ type: "ack", runId: m.runId });
      const echo = { runId: m.runId, gen: m.gen, sampleHash: m.sampleHash, overlays: m.overlays, deviceClass: m.deviceClass };
      const fail = (code, message) => post(Object.assign({ type: "error", code, message }, echo));
      const req0 = m.req && typeof m.req === "object" ? m.req : {};
      let ns;
      if (m.sampleHash === null || m.sampleHash === undefined) {
        ns = req0.normalizedSource;
        if (!ns) return fail("SOURCE_MISMATCH", "a request without sampleHash must carry its pixels inline");
      } else {
        const s = st.source;
        if (!s || s.sampleHash !== m.sampleHash || s.w !== m.w || s.h !== m.h || s.channels !== m.channels)
          return fail("SOURCE_MISMATCH", "the request names source " + m.sampleHash + " (" + m.w + " × " + m.h + " × " + m.channels + ") but the stored source is " +
            (s ? s.sampleHash + " (" + s.w + " × " + s.h + " × " + s.channels + ")" : "none"));
        ns = { pixels: s.pixels, channels: s.channels, w: s.w, h: s.h, alpha: s.alpha };
      }
      const req = Object.assign({}, req0, { normalizedSource: ns });
      // drafts use the coordinator's stage cache (as the page's run.draftCache); fabrication runs are uncached (E-R7)
      const scratch = req.quality === "draft" ? { quality: st.cache.quality, k1: st.cache.k1, k2: st.cache.k2 } : null;
      const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
      let lastT = -Infinity, lastF = 0;
      const onProgress = (stage, frac) => {
        job.stage = stage;   // F14: unthrottled, for stats
        const t = now();
        if (t - lastT < 100) return;   // ≤ 10 Hz
        lastT = t;
        lastF = Math.max(lastF, frac);
        post({ type: "progress", runId: m.runId, stage, frac: lastF, sub: null });
      };
      // F13: the estBytes budget comes with the request (SBPool: SBEngine.memoryBudget(navigator.deviceMemory,
      // deviceClass) or its memoryBudget option); raster kernels run in one row band per admitted helper (≥ 1).
      const nav = self.navigator || {};
      const budget = Number.isFinite(m.budgetBytes) && m.budgetBytes > 0 ? m.budgetBytes : E.memoryBudget(nav.deviceMemory, m.deviceClass);
      const mainBytes = Number.isFinite(m.mainBytes) && m.mainBytes > 0 ? m.mainBytes : 0;
      st.budgetBytes = budget;
      st.stuckMs = Number.isFinite(m.stuckMs) && m.stuckMs > 0 ? m.stuckMs : 300;
      job.cache = scratch;
      const bands = Math.max(1, [...st.helpers.values()].filter((h) => h.ok).length);
      st.bands = bands;
      let res;
      try {
        res = await E.generateAsync(req, { exec: makeExec(job, budget, mainBytes), isCanceled: () => canceled(job), onProgress, cache: scratch, overlays: m.overlays !== false, bands });
      } catch (e) {   // a caller error (CACHE_QUALITY); generateAsync itself never rejects
        return fail((e && e.code) || "ENGINE_INTERNAL", (e && e.message) || String(e));
      }
      if (res.status === "canceled") return post({ type: "canceled", runId: m.runId });
      if (res.status === "done" && scratch && (m.sampleHash === null || m.sampleHash === undefined || (st.source && st.source.sampleHash === m.sampleHash))) {
        st.cache.k1 = scratch.k1;
        st.cache.k2 = scratch.k2;
      }
      try { post(Object.assign({ type: "result", response: res }, echo)); } catch (e) { fail("DATA_CLONE", (e && e.message) || String(e)); }
    }
    function pump() {
      if (st.cur || !st.queue.length) return;
      const m = st.queue.shift(), job = { runId: m.runId, canceled: false, stage: null };
      st.cur = job;
      runJob(m, job)
        .catch((e) => post({ type: "error", runId: m.runId, gen: m.gen, sampleHash: m.sampleHash, overlays: m.overlays, deviceClass: m.deviceClass,
          code: (e && e.code) || "ENGINE_INTERNAL", message: (e && e.message) || String(e) }))
        .then(() => { st.cur = null; pump(); });
    }

    return (d) => {
      if (!d || typeof d !== "object") return;
      switch (d.type) {
        case "source":
          if (!st.source || st.source.sampleHash !== d.sampleHash) st.cache = { quality: "draft" };   // K1/K2 belong to one source
          st.source = { sampleHash: d.sampleHash, pixels: d.pixels, alpha: d.alpha == null ? null : d.alpha, w: d.w, h: d.h, channels: d.channels };
          break;
        case "generate":
          if (st.cur) { st.cur.canceled = true; if (st.batch) st.batch.abort(); }   // a new generate supersedes the current run and every queued one
          for (const q of st.queue.splice(0)) post({ type: "canceled", runId: q.runId });
          st.queue.push(d);
          pump();
          break;
        case "cancel":
          if (st.cur && st.cur.runId === d.runId) { st.cur.canceled = true; if (st.batch) st.batch.abort(); }
          else {
            const i = st.queue.findIndex((q) => q.runId === d.runId);
            if (i >= 0) { st.queue.splice(i, 1); post({ type: "canceled", runId: d.runId }); }
          }
          break;
        case "ports":
          if (d.port) addHelper(d.helperId, d.port);
          break;
        case "cancelFlag":
          st.flag = d.flag instanceof Int32Array && d.flag.length >= 2 ? d.flag : null;
          break;
        case "helperDown":
          helperDown(d.helperId);
          break;
        case "stats": {
          const s = st.source, c = st.cache, len = (a) => (a && a.byteLength) || 0;
          post({ type: "stats", sourceBytes: s ? len(s.pixels) + len(s.alpha) : 0, k1Bytes: c.k1 ? len(c.k1.samples) + len(c.k1.alpha) : 0, k2Bytes: c.k2 ? len(c.k2.L) : 0,
            helpersAdmitted: [...st.helpers.values()].filter((h) => h.ok).map((h) => h.id), helpersRefused: st.refused.slice(),
            itemsInline: st.itemsInline, itemsHelper: st.itemsHelper, running: st.cur ? st.cur.runId : null, queued: st.queue.map((q) => q.runId),
            helperKinds: Object.assign({}, st.kinds), maxInFlight: st.maxInFlight, peakLedger: st.peakLedger, budgetBytes: st.budgetBytes, bands: st.bands,
            lastOrder: Object.assign({}, st.lastOrder),
            // F14
            stage: st.cur ? st.cur.stage : null, sampleHash: s ? s.sampleHash : null, k1Key: c.k1 ? c.k1.key : null, k2Key: c.k2 ? c.k2.key : null,
            staleDropped: st.staleDropped, stuckKilled: st.stuckKilled, sharedCancel: !!st.flag });
          break;
        }
        default:
          break;
      }
    };
  }

  const boot = loadModules().then((texts) => {
    const modulesHash = self.SBHash.modulesHash(WORKER_MODULES.map((n, i) => [n, texts[i]]));
    return role === "helper" ? helper(modulesHash) : coordinator(modulesHash);
  });
  boot.catch((e) => post({ type: "error", runId: null, code: "WORKER_BOOT", message: (e && e.message) || String(e) }));
  // messages that arrive while the modules load are handled in order once boot resolves
  self.onmessage = (ev) => { const d = ev.data; boot.then((handle) => handle(d), () => {}); };
})(typeof self !== "undefined" ? self : undefined);
