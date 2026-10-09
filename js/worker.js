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
 *                  generate {runId, gen, sampleHash, w, h, channels, overlays, deviceClass, draftCapPx, req}
 *                    (req without pixels; pixels inline in req.normalizedSource when sampleHash is null)
 *                  cancel {runId}; ports {helperId, port}; helperDown {helperId}; stats {}
 *   coord → main   hello {role, engineVersion, appVersion, modulesHash, modules}; ack {runId} (start of work);
 *                  progress {runId, stage, frac, sub} (≤ 10 Hz, frac monotone); result {runId, gen, sampleHash,
 *                  overlays, deviceClass, response}; canceled {runId}; error {runId, code, message};
 *                  killHelper {helperId, reason}; stats {…}
 *   main → helper  port {helperId, port}
 *   helper → coord hello {modulesHash, …} before any item; itemResult {batchId, index, ok, value | error, infra?}
 *   coord → helper item {batchId, index, kind, args}
 * Rules (F.3): one run at a time (a new generate cancels the current run and every queued one); source identity
 * (SOURCE_MISMATCH unless sampleHash, w, h and channels equal the stored source; normalizedSource is rebuilt from the
 * stored source only after that check); a canceled or failed run never writes K1/K2 (the run works on a scratch copy of
 * the cache slots, committed on "done"); a helper is admitted only when its hello carries the coordinator's
 * modulesHash; pool-infrastructure failures re-run the item inline and are never surfaced; errors cross postMessage as
 * {code, message, phase} and are rebuilt with .code. Workers never set SBEngine.TEST_HOOKS.
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
  function helper(modulesHash) {
    const E = self.SBEngine, box = { port: null };
    function onItem(m) {
      let out;
      try {
        const fn = E.TASKS[m.kind];
        if (typeof fn !== "function") throw Object.assign(new Error("no kernel " + m.kind), { code: "ENGINE_INTERNAL" });
        out = { type: "itemResult", batchId: m.batchId, index: m.index, ok: true, value: fn.apply(null, m.args) };
      } catch (e) {
        out = { type: "itemResult", batchId: m.batchId, index: m.index, ok: false, error: errOut(e) };
      }
      try { box.port.postMessage(out); } catch (e) {   // DataCloneError: infrastructure, the coordinator re-runs it inline
        box.port.postMessage({ type: "itemResult", batchId: m.batchId, index: m.index, ok: false, infra: true, error: errOut(e) });
      }
    }
    return (d) => {
      if (!d || d.type !== "port" || !d.port) return;
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
      batchSeq: 0, batch: null };
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
        const it = h.item;
        h.item = null;
        if (it && it.batchId === m.batchId && it.index === m.index) it.done(m);
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

    // ---- exec.map for generateAsync: admitted helpers first, else inline; results by item index
    const makeExec = () => ({
      map: (kind, items, o) => new Promise((resolve, reject) => {
        const fn = E.TASKS[kind];
        if (typeof fn !== "function") { reject(Object.assign(new Error("no kernel " + kind), { code: "ENGINE_INTERNAL" })); return; }
        // F.3 transfer ownership: only whole buffers may be declared transferable
        for (const list of (o && o.transfer) || []) for (const v of list || [])
          if (!ArrayBuffer.isView(v) || v.byteOffset !== 0 || v.byteLength !== v.buffer.byteLength) {
            reject(Object.assign(new Error("exec: " + kind + " declares a transfer of a non-whole buffer"), { code: "ENGINE_INTERNAL" }));
            return;
          }
        const n = items.length, out = new Array(n), errs = [], todo = items.map((_, i) => i), batchId = ++st.batchSeq;
        if (n === 0) { resolve(out); return; }
        let left = n;
        const b = {};
        const settle = (i, ok, v, phase) => {
          if (ok) out[i] = v; else errs.push(phase === undefined ? { index: i, error: v } : { index: i, error: v, phase });
          if (--left === 0) {
            if (st.batch === b) st.batch = null;
            if (errs.length) reject(new E.BatchError(errs)); else resolve(out);
          }
        };
        const inline = (i) => {
          st.itemsInline++;
          yieldTask().then(() => {
            let v;
            try { v = fn.apply(null, items[i]); } catch (e) { settle(i, false, e); return; }
            settle(i, true, v);
          });
        };
        b.pump = () => {
          while (todo.length) {
            const ready = [...st.helpers.values()].filter((h) => h.ok);
            if (!ready.length) { inline(todo.shift()); continue; }
            const h = ready.find((x) => !x.item);
            if (!h) return;   // every admitted helper is busy: resumed by the next itemResult
            const i = todo.shift();
            h.item = { batchId, index: i,
              done: (m) => { if (m.ok) { st.itemsHelper++; settle(i, true, m.value); } else if (m.infra) inline(i); else settle(i, false, errIn(m.error), m.error.phase); },
              lost: () => inline(i) };
            // Arguments are cloned, not transferred: a lost helper's item re-runs inline on the coordinator's copy (F.3).
            try { h.port.postMessage({ type: "item", batchId, index: i, kind, args: items[i] }); } catch (e) { h.item = null; inline(i); }
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
        const t = now();
        if (t - lastT < 100) return;   // ≤ 10 Hz
        lastT = t;
        lastF = Math.max(lastF, frac);
        post({ type: "progress", runId: m.runId, stage, frac: lastF, sub: null });
      };
      let res;
      try {
        res = await E.generateAsync(req, { exec: makeExec(), isCanceled: () => job.canceled, onProgress, cache: scratch, overlays: m.overlays !== false });
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
      const m = st.queue.shift(), job = { runId: m.runId, canceled: false };
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
          if (st.cur) st.cur.canceled = true;   // a new generate supersedes the current run and every queued one
          for (const q of st.queue.splice(0)) post({ type: "canceled", runId: q.runId });
          st.queue.push(d);
          pump();
          break;
        case "cancel":
          if (st.cur && st.cur.runId === d.runId) st.cur.canceled = true;
          else {
            const i = st.queue.findIndex((q) => q.runId === d.runId);
            if (i >= 0) { st.queue.splice(i, 1); post({ type: "canceled", runId: d.runId }); }
          }
          break;
        case "ports":
          if (d.port) addHelper(d.helperId, d.port);
          break;
        case "helperDown":
          helperDown(d.helperId);
          break;
        case "stats": {
          const s = st.source, c = st.cache, len = (a) => (a && a.byteLength) || 0;
          post({ type: "stats", sourceBytes: s ? len(s.pixels) + len(s.alpha) : 0, k1Bytes: c.k1 ? len(c.k1.samples) + len(c.k1.alpha) : 0, k2Bytes: c.k2 ? len(c.k2.L) : 0,
            helpersAdmitted: [...st.helpers.values()].filter((h) => h.ok).map((h) => h.id), helpersRefused: st.refused.slice(),
            itemsInline: st.itemsInline, itemsHelper: st.itemsHelper, running: st.cur ? st.cur.runId : null, queued: st.queue.map((q) => q.runId) });
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
