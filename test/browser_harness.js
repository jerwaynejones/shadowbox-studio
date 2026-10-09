/* ============================================================================
 * Shadowbox Studio — test/browser_harness.js
 * ----------------------------------------------------------------------------
 * Speed round F16a (S1, F.4 #4, G4.8 subset): the browser harness behind
 * test/browser.html?run. It runs the 5 F16 fixtures of test/pool_corpus.js
 * through the serial engine (SBEngine.generate on the page) and through an
 * SBPool on the Blob rung (the dist/ worker: SB_INLINED + worker.js, built here
 * from the module texts read relative to test/), compares pooled = serial
 * (deepEqualStrict) and serial = the Node golden (test/golden/pool-equality.json),
 * times both (p50/p95), records the longest main-thread task during the pooled
 * runs (SBPool.longTasks) and a cancel round trip, and prints the digests.
 *
 *   SBHarness.FIXTURES                   the 5 F16 fixture ids
 *   SBHarness.readInlined(fetchText)     → {modules: {name: text}, worker: text} (WORKER_MODULES from worker.js)
 *   SBHarness.loadCorpus(fetchText)      → test/pool_corpus.js's exports, evaluated by a minimal CommonJS loader
 *                                          (fixtures.js, tools/alpha3_scene.js without its #! line; zlib/fs/path stubbed, never called)
 *   SBHarness.run({fetchText, inlined?, helpers?, rungs?}) → record (JSON): {harness, at, env, rung, fixtures:
 *                                          [{id, quality, serial: digest, pool: digest, poolEqualsSerial,
 *                                          serialEqualsGolden, serialMs, poolMs}], timing: {serial, pool: {n, p50Ms,
 *                                          p95Ms, maxMs}}, longTaskMaxMs, longTasks, cancel: {status, latencyMs}, pass}
 *   SBHarness.format(record)             → the text table printed into #harness-result
 *   SBHarness.main(document)             browser entry: XHR reads (file:// needs Chromium --allow-file-access-from-files,
 *                                          or Firefox security.fileuri.strict_origin_policy=false; any browser over
 *                                          http from the repo root), result into #harness-result, <html data-harness=
 *                                          "running|pass|fail|error">, window.SB_HARNESS_RESULT.
 *
 * Browser-vs-Node equality (serialEqualsGolden) is claimed for every digest: F16 showed that Math.hypot and trig never
 * feed a generate hash (F.4 #4). Test-only; never shipped. Loaded by Node (run_tests.js, F16a suite) with an injected
 * fetchText and a node_worker_shim Blob rung.
 * ==========================================================================*/
"use strict";

(function (global) {
  const H = {};
  H.FIXTURES = ["h-bonded-draft", "h-connected-fabrication", "t-connected-frame-draft", "n3-fabrication", "alpha-domain-draft"];
  const FIELDS = ["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"];
  const CANCEL_FIXTURE = "h-connected-fabrication";
  const now = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
  const ms = (v) => (v === null ? null : +v.toFixed(1));

  /** Nearest-rank p50/p95 and max (as test/bench.js stats). */
  H.stats = function (t) {
    const s = t.filter((v) => typeof v === "number").sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
    return s.length ? { n: s.length, p50Ms: ms(q(0.5)), p95Ms: ms(q(0.95)), maxMs: ms(s[s.length - 1]) } : { n: 0, p50Ms: null, p95Ms: null, maxMs: null };
  };

  H.readInlined = async function (fetchText) {
    const worker = await fetchText("../js/worker.js");
    const m = worker.match(/const WORKER_MODULES = (\[[^\]]*\]);/);
    if (!m) throw new Error("WORKER_MODULES not found in js/worker.js");
    const modules = {};
    for (const n of JSON.parse(m[1])) modules[n] = await fetchText("../js/" + n);
    return { modules, worker };
  };

  H.loadCorpus = async function (fetchText) {
    const files = { "fixtures.js": "fixtures.js", "alpha3_scene.js": "../tools/alpha3_scene.js", "pool_corpus.js": "pool_corpus.js" }, texts = {};
    for (const k of Object.keys(files)) texts[k] = await fetchText(files[k]);
    const stubs = { zlib: {}, fs: {}, path: { join: (...a) => a.join("/") } }, cache = {};
    const req = (spec) => {
      if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
      const base = String(spec).split("/").pop();
      if (cache[base]) return cache[base].exports;
      if (!Object.prototype.hasOwnProperty.call(texts, base)) return {};   // test/png_enc.js: only its PNG writer, not used here
      const module = { exports: {} };
      cache[base] = module;
      new Function("require", "module", "exports", "__dirname", texts[base].replace(/^#!.*/, ""))(req, module, module.exports, ".");
      return module.exports;
    };
    return req("pool_corpus.js");
  };

  H.run = async function (o) {
    const E = global.SBEngine, P = global.SBPool, fetchText = o.fetchText;
    const inlined = o.inlined || (await H.readInlined(fetchText));
    const C = await H.loadCorpus(fetchText), golden = JSON.parse(await fetchText("golden/pool-equality.json"));
    const byId = new Map(C.corpus().map((fx) => [fx.id, fx]));
    const nav = global.navigator || {};
    const rec = { harness: "test/browser.html?run (speed round F16a)", at: new Date().toISOString(),
      env: { engine: E.VERSION, userAgent: nav.userAgent || null, hardwareConcurrency: nav.hardwareConcurrency || null, protocol: global.location ? global.location.protocol : null },
      rung: null, poolMode: null, fixtures: [], timing: null, longTaskMaxMs: 0, longTasks: null, cancel: null, pass: false };
    const reqOf = (fx) => E.request(fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: fx.draftCapPx });
    const srcOf = (fx) => Object.assign({ sampleHash: fx.project.source.sampleHash }, fx.source);

    // 1. serial: the sync driver on this page
    const serial = new Map();
    for (const id of H.FIXTURES) {
      const fx = byId.get(id);
      if (!fx) throw new Error("fixture " + id + " is not in test/pool_corpus.js");
      const t0 = now(), r = E.generate(reqOf(fx), { overlays: fx.overlays });
      serial.set(id, { r, ms: now() - t0 });
    }

    // 2. pooled: the Blob rung (dist/'s worker) with the same requests
    const opts = { appVersion: (inlined.worker.match(/const WORKER_APP_VERSION = "([^"]+)"/) || [])[1], inlined };
    if (o.helpers !== undefined) opts.helpers = o.helpers;
    if (o.rungs) opts.rungs = o.rungs;
    const pool = P.create(opts), lt = P.longTasks();
    try {
      const up = await pool.ready;
      rec.rung = pool.rung || null; rec.poolMode = pool.mode;
      if (up) await pool.helpersReady;
      lt.start();
      for (const id of H.FIXTURES) {
        const fx = byId.get(id), s = serial.get(id);
        let pooled = null, poolMs = null, error = null;
        if (up) {
          pool.setSource(srcOf(fx));
          const t0 = now();
          try {
            const res = await pool.submit(reqOf(fx), { sampleHash: fx.project.source.sampleHash, gen: 1, overlays: fx.overlays }).done;
            pooled = res.response || null;
            if (!pooled) error = "status " + res.status;
          } catch (e) { error = (e && e.code) || String(e); }
          poolMs = now() - t0;
        } else error = "no pool (" + (pool.notice || pool.mode) + ")";
        s.pooled = pooled; s.poolMs = poolMs; s.error = error;
      }
      // 3. cancel round trip: a fabrication run canceled as soon as the coordinator acks it
      if (up) {
        const fx = byId.get(CANCEL_FIXTURE), t = { at: null };
        pool.setSource(srcOf(fx));
        let sub = null;
        sub = pool.submit(reqOf(fx), { sampleHash: fx.project.source.sampleHash, gen: 2, overlays: fx.overlays,
          onStart: () => { if (t.at === null && sub) { t.at = now(); pool.cancel(sub.runId); } } });
        const res = await sub.done.catch((e) => ({ status: "error", code: e && e.code }));
        rec.cancel = { fixture: CANCEL_FIXTURE, status: res.status, latencyMs: t.at === null ? null : ms(now() - t.at), watchdog: !!res.watchdog };
      }
    } finally {
      const l = lt.stop();
      rec.longTasks = l; rec.longTaskMaxMs = ms(l.max);
      pool.terminate();
    }
    // 4. digests and comparisons (after the recorder stopped: they run on the main thread)
    for (const id of H.FIXTURES) {
      const fx = byId.get(id), s = serial.get(id), sd = C.digest(s.r), pd = s.pooled ? C.digest(s.pooled) : null, g = golden.fixtures[id];
      rec.fixtures.push({ id, quality: fx.quality, serial: sd, pool: pd, poolEqualsSerial: !!s.pooled && C.deepEqualStrict(s.pooled, s.r),
        serialEqualsGolden: !!g && FIELDS.every((k) => JSON.stringify(sd[k]) === JSON.stringify(g[k])), serialMs: ms(s.ms),
        poolMs: s.poolMs === undefined || s.poolMs === null ? null : ms(s.poolMs), error: s.error || null });
    }
    rec.timing = { serial: H.stats(rec.fixtures.map((f) => f.serialMs)), pool: H.stats(rec.fixtures.map((f) => f.poolMs)) };
    rec.pass = rec.fixtures.length === H.FIXTURES.length && rec.fixtures.every((f) => f.poolEqualsSerial && f.serialEqualsGolden) &&
      !!rec.cancel && rec.cancel.status === "canceled";
    return rec;
  };

  H.format = function (rec) {
    const L = [];
    L.push("Shadowbox Studio browser harness (F16a): " + (rec.pass ? "PASS" : "FAIL") + " — rung " + rec.rung + " (" + rec.poolMode + ")");
    L.push(String(rec.env.userAgent));
    L.push("");
    L.push(["fixture", "quality", "serial ms", "pool ms", "pool=serial", "serial=golden", "geometryHash", "wholeSha"].join("\t"));
    for (const f of rec.fixtures) {
      L.push([f.id, f.quality, f.serialMs, f.poolMs, f.poolEqualsSerial ? "yes" : "NO", f.serialEqualsGolden ? "yes" : "NO",
        f.serial.geometryHash, f.serial.wholeSha].join("\t") + (f.error ? "\t(" + f.error + ")" : ""));
    }
    L.push("");
    L.push("serial p50 " + rec.timing.serial.p50Ms + " / p95 " + rec.timing.serial.p95Ms + " ms; pool p50 " + rec.timing.pool.p50Ms + " / p95 " + rec.timing.pool.p95Ms + " ms");
    L.push("longest main-thread task during the pooled runs: " + rec.longTaskMaxMs + " ms" + (rec.longTasks && rec.longTasks.supported ? "" : " (longtask not observable here)"));
    L.push("cancel: " + (rec.cancel ? rec.cancel.status + " after " + rec.cancel.latencyMs + " ms" + (rec.cancel.watchdog ? " (watchdog)" : "") : "not run"));
    return L.join("\n");
  };

  /** XHR text read (fetch() cannot read file:// URLs; XHR can where the browser allows file access). */
  const xhrText = (rel) => new Promise((resolve, reject) => {
    const x = new global.XMLHttpRequest();
    x.open("GET", rel);
    x.overrideMimeType("text/plain");
    x.onload = () => (x.status === 200 || (x.status === 0 && x.responseText) ? resolve(x.responseText) : reject(new Error(rel + ": status " + x.status)));
    x.onerror = () => reject(new Error("cannot read " + rel));
    x.send();
  });

  H.main = async function (doc) {
    const out = doc.getElementById("harness-result"), html = doc.documentElement;
    html.dataset.harness = "running";
    out.textContent = "running…";
    try {
      const rec = await H.run({ fetchText: xhrText });
      global.SB_HARNESS_RESULT = rec;
      out.textContent = H.format(rec) + "\n\n" + JSON.stringify(rec, null, 2);
      html.dataset.harness = rec.pass ? "pass" : "fail";
    } catch (e) {
      out.textContent = "harness error: " + (e && e.message ? e.message : String(e)) +
        "\n\nThe harness reads the module texts and fixtures relative to test/. From file:// start Chromium with --allow-file-access-from-files" +
        " (Firefox: security.fileuri.strict_origin_policy = false), or serve the repository root over http (python3 -m http.server).";
      html.dataset.harness = "error";
    }
  };

  global.SBHarness = H;
  if (typeof module !== "undefined" && module.exports) module.exports = H;
})(typeof globalThis !== "undefined" ? globalThis : this);
