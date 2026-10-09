#!/usr/bin/env node
/**
 * Speed round end-to-end browser verification (S2 fabrication preview, S3 draft budget) in real headless Chromium,
 * driven the way tools/verify_alpha3.mjs drives it: the user's controls, a real file input, the real buttons.
 *
 * No npm: Node built-ins, python3 http.server on a free 127.0.0.1 port (killed afterwards), a locally installed
 * Chromium over the DevTools protocol (one fresh browser per run, killed afterwards), ImageMagick `magick` (crops only).
 *
 * Fixture: tools/alpha3_scene.js at 4096 × 3084 (deterministic colour scene). Settings: xTool S1 (feeder), Plywood,
 * Bonded relief, size by height 300 mm and 470 mm, pitch 0.1 mm/px, 8 sheets.
 *
 * Pages (all the built bundle dist/shadowbox-studio.html over http, Blob-worker rung):
 *   shipped      the bundle as built (DRAFT_BUDGET.desktopDraftPx as shipped)
 *   draft<N>     the bundle with DRAFT_BUDGET.desktopDraftPx raised to N (measurement only, never shipped): the presets'
 *                draftPx follow it, so a new project drafts at N px exactly as if N were shipped
 *   serial       the shipped bundle with the Worker constructor disabled before load (the pool's serial fallback)
 * Per run: cold draft (file input → painted draft), warm edits (sheets 8 ↔ 7, edit dispatch → painted draft, the 300 ms
 * debounce included; the run's own submit → done time also recorded), fabrication preview (click → painted
 * "Fabrication ·" status), export (acknowledge, Download click → download completed), the main thread's long tasks per
 * phase (PerformanceObserver "longtask", buffered), workers spawned (Worker constructor wrapped, observation only), and
 * geometryHash + per-layer layerHashes of every draft / fabrication snapshot (computed after the timed phases).
 *
 * Usage: node tools/verify_speed.mjs [--out docs/baseline/speed] [--sizes 1536,2000] [--edits 8] [--heights 300,470]
 *          [--chrome chromium] [--keep]
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir, cpus, totalmem, loadavg, uptime } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(arg("--out", join(ROOT, "docs", "baseline", "speed")));
const SIZES = arg("--sizes", "1536,2000").split(",").map(Number);
const HEIGHTS = arg("--heights", "300,470").split(",").map(Number);
const EDITS = +arg("--edits", "8"), WARMUP = 2, CHROME = arg("--chrome", "chromium");
const W = 1440, H = 900, FIX_W = 4096, FIX_H = 3084;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[speed]", ...a);

function waitForLine(stream, re, ms) {
  return new Promise((res, rej) => {
    let buf = "";
    const onData = (d) => { buf += d.toString(); const m = buf.match(re); if (m) { clearTimeout(t); stream.off("data", onData); res(m); } };
    const t = setTimeout(() => { stream.off("data", onData); rej(new Error("timeout waiting for " + re + "; got: " + buf.trim())); }, ms);
    stream.on("data", onData);
  });
}
function stats(t) {
  const s = t.slice().sort((a, b) => a - b), q = (p) => (s.length ? s[Math.max(0, Math.ceil(p * s.length) - 1)] : null);
  return { n: s.length, p50Ms: q(0.5), p95Ms: q(0.95), maxMs: s.length ? s[s.length - 1] : null, minMs: s.length ? s[0] : null };
}

// ------------------------------------------------------------------ pages
function buildPages(dir) {
  const html = readFileSync(join(ROOT, "dist", "shadowbox-studio.html"), "utf8");
  const re = /const DRAFT_BUDGET = \{ desktopDraftPx: (\d+),/;
  const m = html.match(re);
  if (!m) throw new Error("DRAFT_BUDGET not found in dist/shadowbox-studio.html (run node build.js)");
  writeFileSync(join(dir, "shipped.html"), html);
  for (const n of SIZES) writeFileSync(join(dir, `draft${n}.html`), html.replace(re, `const DRAFT_BUDGET = { desktopDraftPx: ${n},`));
  return { shippedDraftPx: +m[1] };
}

/** Injected before any page script: observation only (results pass through unchanged). */
const PRELUDE = (serial) => `(() => {
  window.__lt = []; window.__runs = []; window.__workers = []; window.__marks = {};
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); })
    .observe({ type: "longtask", buffered: true }); } catch (_) {}
  const RW = window.Worker;
  window.Worker = ${serial ? `function () { throw new Error("Worker disabled (serial fallback measurement)"); }` :
    `function (url, opts) { window.__workers.push({ name: (opts && opts.name) || null, t: performance.now() }); return new RW(url, opts); }`};
  if (!${serial}) window.Worker.prototype = RW.prototype;
  const rec = (quality, via, t0, rev) => { const r = { quality, via, t0, rev, t1: null, status: null, resp: null }; window.__runs.push(r); return r; };
  let pool;
  Object.defineProperty(window, "SBPool", { configurable: true, get() { return pool; }, set(v) {
    const create = v.create;
    pool = Object.assign({}, v, { create(o) {
      const p = create.call(v, o), submit = p.submit.bind(p);
      window.__pool = p;
      p.submit = function (req, opts) {
        const r = rec(req.quality, "pool", performance.now(), req.revision), sub = submit(req, opts);
        sub.done.then((x) => { r.t1 = performance.now(); r.status = x.status; r.resp = x.response || null; }, (e) => { r.t1 = performance.now(); r.status = "error:" + (e && e.code); });
        return sub;
      };
      return p;
    } });
  } });
  let eng;
  Object.defineProperty(window, "SBEngine", { configurable: true, get() { return eng; }, set(v) {
    const gen = v.generate;
    v.generate = function (req) { const r = rec(req.quality, "sync", performance.now(), req.revision), out = gen.apply(this, arguments);
      r.t1 = performance.now(); r.status = out.status; r.resp = out; return out; };
    eng = v;
  } });
  window.__mark = (k) => { (window.__marks[k] = window.__marks[k] || []).push(performance.now()); return performance.now(); };
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const st = () => (document.getElementById("statusline") || {}).textContent || "";
  const busy = () => { const c = document.getElementById("stackcanvas"); return c && c.getAttribute("aria-busy") === "true"; };
  /** Wait until a run of quality newer than index n0 has finished and the page shows the result (re matched, veil off). */
  window.__settle = async (n0, quality, re, ms) => {
    const T = performance.now() + ms;
    for (;;) {
      const runs = window.__runs.slice(n0).filter((r) => r.quality === quality);
      const last = runs[runs.length - 1];
      if (last && last.t1 !== null && new RegExp(re).test(st()) && !busy() && (last.status === "done" || last.status === "failed" || /^error/.test(last.status))) {
        await paint(); return { t: performance.now(), run: { t0: last.t0, t1: last.t1, status: last.status, via: last.via } };
      }
      if (performance.now() > T) throw new Error("settle timeout: " + st());
      await new Promise((r) => setTimeout(r, 4));
    }
  };
  /** A user edit of a control (input + change), timed to the painted draft. */
  window.__edit = async (id, value) => {
    const n0 = window.__runs.length, t0 = performance.now(), el = document.getElementById(id);
    el.value = String(value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    const s = await window.__settle(n0, "draft", "^Draft \\\\(approximate", 600000);
    return { ms: s.t - t0, runMs: s.run.t1 - s.run.t0, via: s.run.via, status: s.run.status };
  };
  window.__ltIn = (a, b) => { let max = 0, n = 0, sum = 0; for (const [s, d] of window.__lt) if (s >= a && s < b) { n++; sum += d; if (d > max) max = d; } return { max: Math.round(max), count: n, totalMs: Math.round(sum) }; };
})();`;

// ------------------------------------------------------------------ CDP
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map(), listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    else if (msg.method) listeners.forEach((f) => f(msg));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const m = { id: ++id, method, params }; if (sessionId) m.sessionId = sessionId;
    pending.set(m.id, { res, rej }); ws.send(JSON.stringify(m));
  });
  return { ws, send, listeners };
}

async function launch(procs) {
  const profile = mkdtempSync(join(tmpdir(), "sb-speed-chr-"));
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", `--window-size=${W},${H}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  procs.push(chrome);
  const [, wsUrl] = await waitForLine(chrome.stderr, /DevTools listening on (ws:\/\/\S+)/, 30000);
  const cdp = await connect(wsUrl);
  const version = (await cdp.send("Browser.getVersion")).product;
  const close = async () => { try { cdp.ws.close(); } catch (_) {} chrome.kill("SIGKILL"); await sleep(500); rmSync(profile, { recursive: true, force: true }); };
  return { cdp, version, close };
}

async function openPage(cdp, url, dl, serial) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable"); await S("DOM.enable");
  await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl, eventsEnabled: true });
  await S("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDE(serial) });
  const exceptions = [];
  cdp.listeners.add((m) => { if (m.sessionId === sessionId && m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; exceptions.push((d.exception && d.exception.description) || d.text); } });
  await S("Page.navigate", { url });
  const ev = async (expr, timeout = 900000) => {
    const r = await S("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error("page eval failed: " + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text) + "\n  in: " + expr.slice(0, 200));
    return r.result.value;
  };
  for (let i = 0; i < 300; i++) { await sleep(100); if (await ev(`document.readyState === "complete" && !!document.getElementById("statusline")`)) break; }
  await sleep(800);
  return { S, ev, targetId, exceptions };
}

const status = (page) => page.ev(`(document.getElementById("statusline")||{}).textContent||""`);
const setCtl = (page, id, value) => page.ev(`(() => { const el = document.getElementById(${JSON.stringify(id)});
  el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event("input", {bubbles: true})); el.dispatchEvent(new Event("change", {bubbles: true})); return el.value; })()`);
async function shot(page, file) { const r = await page.S("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.data, "base64")); return file; }
async function tab(page, name) { await page.ev(`document.querySelector('.tab[data-tab="${name}"]').click(), true`); await sleep(700); }
async function setFile(page, selector, path) {
  const { root } = await page.S("DOM.getDocument", { depth: 1 });
  const { nodeId } = await page.S("DOM.querySelector", { nodeId: root.nodeId, selector });
  await page.S("DOM.setFileInputFiles", { nodeId, files: [path] });
}
/** The Proof canvas at device scale 2 in the palette colouring (a view setting; set back to uniform afterwards). */
async function hiResProof(page, file) {
  await tab(page, "proof");
  await setCtl(page, "in-appearance", "palette"); await setCtl(page, "in-palette", "Midnight (Starry Night)");
  await page.S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await page.ev(`window.dispatchEvent(new Event("resize")), true`); await sleep(1500);
  const b64 = await page.ev(`new Promise(r => document.getElementById("stackcanvas").toBlob(b => {
    const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(b); }, "image/png"))`);
  writeFileSync(file, Buffer.from(b64, "base64"));
  await page.S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await page.ev(`window.dispatchEvent(new Event("resize")), true`); await sleep(800);
  await setCtl(page, "in-appearance", "uniform");
  return file;
}
function download(cdp, ms = 600000) {
  let on;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { cdp.listeners.delete(on); rej(new Error("download timeout")); }, ms);
    let name = null;
    on = (m) => {
      if (m.method === "Browser.downloadWillBegin") name = m.params.suggestedFilename;
      if (m.method !== "Browser.downloadProgress") return;
      if (m.params.state === "completed") { clearTimeout(t); cdp.listeners.delete(on); res({ name, t: Date.now() }); }
      if (m.params.state === "canceled") { clearTimeout(t); cdp.listeners.delete(on); rej(new Error("download canceled")); }
    };
    cdp.listeners.add(on);
  });
}
async function ackAll(page, listId) {
  for (let i = 0; i < 400; i++) {
    const left = await page.ev(`(() => { const b = Array.from(document.querySelectorAll("#${listId} .diag-ack input")).find((x) => !x.checked);
      if (!b) return 0; b.click(); return 1; })()`);
    if (!left) return i;
    await sleep(30);
  }
  throw new Error("could not acknowledge every warning in #" + listId);
}
/** Hashes and diagnostics of every recorded snapshot (computed after the timed phases). */
const RUN_SUMMARY = `window.__runs.map((r) => { const s = r.resp && r.resp.snapshot; const o = { quality: r.quality, via: r.via, rev: r.rev, status: r.status,
  ms: r.t1 !== null ? Math.round(r.t1 - r.t0) : null };
  if (s) Object.assign(o, { geometryHash: s.geometryHash, raster: [s.geometry.rasterW, s.geometry.rasterH], mmPerPx: s.geometry.mmPerPxMax,
    page: s.page, nLayers: s.layers.length, layerHashes: s.layers.map((L) => SBGeom.layerHashes(L).layerHash),
    diagnostics: s.diagnostics.map((d) => ({ code: d.code, severity: d.severity || (SBDiag.CODES[d.code] || {}).severity || null })) });
  return o; })`;

// ------------------------------------------------------------------ one run
async function runOnce(port, opt, fixture, work, procs) {
  const { page: pageName, height, fab, exportZip, shots, canvas, serial } = opt;
  const label = `${pageName}@${height}`;
  log("run", label);
  const b = await launch(procs);
  const dl = join(work, "dl-" + label.replace(/[^a-z0-9]/gi, "_")); mkdirSync(dl, { recursive: true });
  const R = { label, page: pageName, heightMM: height, serial: !!serial, browser: b.version };
  try {
    const page = await openPage(b.cdp, `http://127.0.0.1:${port}/${pageName === "serial" ? "shipped" : pageName}.html`, dl, !!serial);
    R.version = await page.ev(`document.getElementById("meta-version").textContent`);
    await setCtl(page, "in-machine", "xtool-s1-feeder");
    await setCtl(page, "in-res", "0.1");
    await setCtl(page, "in-sheets", "8");
    await setCtl(page, "in-sizeby", "height");
    await setCtl(page, "in-target", String(height));
    R.controls = await page.ev(`({preset: document.getElementById("in-preset").value, construction: document.getElementById("in-construction").value,
      machine: document.getElementById("in-machine").value, pitch: document.getElementById("in-res").value, sheets: document.getElementById("in-sheets").value,
      sizeby: document.getElementById("in-sizeby").value, target: document.getElementById("in-target").value})`);
    if (R.controls.preset !== "plywood" || R.controls.construction !== "bonded-relief") throw new Error("unexpected start preset " + JSON.stringify(R.controls));
    await sleep(500);

    // cold draft: file input → painted draft
    const n0 = await page.ev(`window.__runs.length`);
    const t0 = await page.ev(`window.__mark("load")`);
    await setFile(page, "#filein", fixture);
    const cold = await page.ev(`window.__settle(${n0}, "draft", "^Draft \\\\(approximate", 600000)`);
    R.coldDraftMs = Math.round(cold.t - t0);
    R.coldDraftRunMs = Math.round(cold.run.t1 - cold.run.t0);
    R.coldVia = cold.run.via;
    R.longTask = { coldDraft: await page.ev(`window.__ltIn(${t0}, ${cold.t})`) };
    await sleep(800);
    R.draftStatus = await status(page);
    R.pool = await page.ev(`(() => { const p = window.__pool; return { mode: p ? p.mode : "fallback", rung: p ? p.rung || null : null,
      hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory || null,
      helperCount: SBPool.helperCount(navigator.hardwareConcurrency, "desktop"),
      workersSpawned: window.__workers.length, workerNames: window.__workers.map((w) => w.name) }; })()`);
    R.draftOfferShown = await page.ev(`!document.getElementById("draft-offer").hidden`);
    if (shots) { await tab(page, "proof"); await shot(page, join(OUT, `${pageName}_${height}_draft_proof.png`)); }

    // warm edits: sheets 8 ↔ 7 (WARMUP not counted)
    const edits = [];
    const tw0 = await page.ev(`performance.now()`);
    for (let i = 0; i < WARMUP + EDITS; i++) {
      const v = i % 2 === 0 ? 7 : 8;
      const e = await page.ev(`window.__edit("in-sheets", ${v})`);
      if (i >= WARMUP) edits.push(e);
      await sleep(150);
    }
    if (+(await page.ev(`document.getElementById("in-sheets").value`)) !== 8) {
      await page.ev(`window.__edit("in-sheets", 8)`);
    }
    const tw1 = await page.ev(`performance.now()`);
    R.warm = Object.assign(stats(edits.map((e) => e.ms)), { runMs: stats(edits.map((e) => e.runMs)), via: [...new Set(edits.map((e) => e.via))],
      rows: edits.map((e) => ({ ms: Math.round(e.ms), runMs: Math.round(e.runMs), status: e.status })) });
    for (const k of ["p50Ms", "p95Ms", "maxMs", "minMs"]) { R.warm[k] = Math.round(R.warm[k]); R.warm.runMs[k] = Math.round(R.warm.runMs[k]); }
    R.longTask.warmEdits = await page.ev(`window.__ltIn(${tw0}, ${tw1})`);
    // K2-miss edits: smoothing radius +0.05 mm ↔ back (the resampled source stays cached, smoothing and later stages rerun)
    const s0 = +(await page.ev(`document.getElementById("in-smooth").value`)), k2 = [];
    const tk0 = await page.ev(`performance.now()`);
    for (let i = 0; i < EDITS + 1; i++) {
      const e = await page.ev(`window.__edit("in-smooth", ${i % 2 === 0 ? (s0 + 0.05).toFixed(2) : s0.toFixed(2)})`);
      if (i >= 1) k2.push(e);
      await sleep(150);
    }
    if (+(await page.ev(`document.getElementById("in-smooth").value`)) !== s0) await page.ev(`window.__edit("in-smooth", ${s0.toFixed(2)})`);
    const tk1 = await page.ev(`performance.now()`);
    R.warmK2 = Object.assign(stats(k2.map((e) => Math.round(e.ms))), { smoothingMM: [s0, +(s0 + 0.05).toFixed(2)], runMs: stats(k2.map((e) => Math.round(e.runMs))) });
    R.longTask.k2Edits = await page.ev(`window.__ltIn(${tk0}, ${tk1})`);
    await sleep(800);
    if (canvas) R.draftCanvas = await hiResProof(page, join(work, `${pageName}_${height}_draft_canvas.png`));

    if (fab) {
      const nf = await page.ev(`window.__runs.length`);
      const tf0 = await page.ev(`(() => { const t = window.__mark("fab"); document.getElementById("btn-fabpreview").click(); return t; })()`);
      const f = await page.ev(`window.__settle(${nf}, "fabrication", "^Fabrication ·", 1800000)`);
      R.fabMs = Math.round(f.t - tf0);
      R.fabRunMs = Math.round(f.run.t1 - f.run.t0);
      R.fabVia = f.run.via;
      R.fabStatus = await status(page);
      R.longTask.fab = await page.ev(`window.__ltIn(${tf0}, ${f.t})`);
      // responsiveness probe during the run is the long-task max above; the pool's own acks are not measured here
      R.pool.workersSpawnedAfterFab = await page.ev(`window.__workers.length`);
      await sleep(1000);
      if (shots) {
        await tab(page, "proof"); await shot(page, join(OUT, `${pageName}_${height}_fab_proof.png`));
        await tab(page, "sheets"); await shot(page, join(OUT, `${pageName}_${height}_fab_layers.png`));
        await page.ev(`document.getElementById("fab-review").scrollIntoView({block: "start"}), true`);
        await shot(page, join(OUT, `${pageName}_${height}_fab_review.png`));
        await tab(page, "proof");
      }
      if (canvas) R.fabCanvas = await hiResProof(page, join(work, `${pageName}_${height}_fab_canvas.png`));
      if (exportZip) {
        R.acked = await ackAll(page, "fab-list");
        R.exportDisabled = await page.ev(`document.getElementById("btn-export").disabled`);
        R.whyExport = await page.ev(`document.getElementById("why-export").textContent`);
        if (!R.exportDisabled) {
          const nb = await page.ev(`window.__runs.length`);
          const d = download(b.cdp);
          const te = Date.now();
          const tp0 = await page.ev(`(() => { const t = performance.now(); document.getElementById("btn-export").click(); return t; })()`);
          const got = await d;
          R.exportMs = got.t - te;
          R.longTask.export = await page.ev(`window.__ltIn(${tp0}, performance.now())`);
          R.exportZip = { name: got.name, bytes: statSync(join(dl, got.name)).size };
          R.generateCallsDuringExport = (await page.ev(`window.__runs.length`)) - nb;
          await sleep(500);
          R.exportStatus = await status(page);
        }
      }
    }
    R.runs = await page.ev(RUN_SUMMARY);
    const lastDraft = R.runs.filter((r) => r.quality === "draft" && r.geometryHash).pop();
    R.draft = lastDraft ? { raster: lastDraft.raster, geometryHash: lastDraft.geometryHash, diagnostics: lastDraft.diagnostics,
      samplingLow: lastDraft.diagnostics.filter((d) => d.code === "SAMPLING_LOW"),
      blocking: lastDraft.diagnostics.filter((d) => d.severity === "blocking").map((d) => d.code) } : null;
    const lastFab = R.runs.filter((r) => r.quality === "fabrication" && r.geometryHash).pop();
    if (lastFab) R.fabSnapshot = { raster: lastFab.raster, geometryHash: lastFab.geometryHash, layerHashes: lastFab.layerHashes, page: lastFab.page,
      blocking: lastFab.diagnostics.filter((d) => d.severity === "blocking").map((d) => d.code) };
    R.exceptions = page.exceptions;
  } finally { await b.close(); }
  log(label, JSON.stringify({ cold: R.coldDraftMs, warmP50: R.warm && R.warm.p50Ms, warmP95: R.warm && R.warm.p95Ms, fab: R.fabMs, exp: R.exportMs, lt: R.longTask }));
  return R;
}

// ------------------------------------------------------------------ crops
function makeCrops(entries, out) {
  const box = (f) => { const m = spawnSync("magick", [f, "-format", "%@", "info:"], { encoding: "utf8" }).stdout.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/); return m.slice(1).map(Number); };
  // regions as fractions of the art box (the scene's moon, city, tree/wires, fence)
  const REG = { moon: [35, 15, 95, 65], city: [235, 150, 325, 222], tree_wires: [15, 150, 135, 240], fence: [215, 250, 335, 285] };
  const made = {};
  for (const [name, [x0, y0, x1, y1]] of Object.entries(REG)) {
    const parts = [];
    for (const [label, f] of entries) {
      const [bw, bh, bx, by] = box(f), sx = bw / 400, sy = bh / 300;
      const g = `${Math.round((x1 - x0) * sx)}x${Math.round((y1 - y0) * sy)}+${Math.round(bx + x0 * sx)}+${Math.round(by + y0 * sy)}`;
      const t = join(dirname(f), `crop_${name}_${parts.length}.png`);
      spawnSync("magick", [f, "-crop", g, "+repage", "-background", "white", "-flatten", "-filter", "point", "-resize", "200%",
        "-gravity", "north", "-background", "white", "-splice", "0x34", "-pointsize", "22", "-annotate", "+0+4", label, t]);
      parts.push(t);
    }
    const o = join(out, `crop_${name}.png`);
    spawnSync("magick", [...parts, "-bordercolor", "white", "-border", "6", "+append", o]);
    made[name] = o.slice(ROOT.length + 1);
  }
  return made;
}

// ------------------------------------------------------------------ main
const procs = [], work = mkdtempSync(join(tmpdir(), "sb-speed-"));
mkdirSync(OUT, { recursive: true });
const report = { task: "speed round end-to-end browser verification (S2, S3)", at: new Date().toISOString(),
  machine: { cpu: cpus()[0].model, threads: cpus().length, memGiB: +(totalmem() / 2 ** 30).toFixed(1), loadavgStart: loadavg().map((x) => +x.toFixed(2)), uptimeH: +(uptime() / 3600).toFixed(1) },
  fixture: { generator: "tools/alpha3_scene.js", w: FIX_W, h: FIX_H },
  settings: { machine: "xtool-s1-feeder", preset: "plywood", construction: "bonded-relief", sizeBy: "height", heightsMM: HEIGHTS, pitchMM: 0.1, sheets: 8 },
  method: { warmEdits: EDITS, warmup: WARMUP, edit: "warm = sheets 8 ↔ 7, warmK2 = smoothing radius +0.05 mm ↔ back; dispatch → painted draft (includes the app's 300 ms edit debounce); runMs = pool submit → done (or sync generate)",
    cold: "file input set → first painted draft (decode, source install, draft)", fab: "Preview at fabrication resolution click → painted Fabrication status",
    export: "Download click → Browser.downloadProgress completed", longTask: "PerformanceObserver longtask (buffered) max per phase window" },
  runs: [] };
try {
  const fixture = join(work, "scene_4096x3084.png");
  const g = spawnSync(process.execPath, [join(ROOT, "tools", "alpha3_scene.js"), fixture, String(FIX_W), String(FIX_H)], { stdio: "inherit" });
  if (g.status !== 0) throw new Error("fixture generation failed");
  report.fixture.bytes = statSync(fixture).size;
  report.fixture.sha256 = spawnSync("sha256sum", [fixture], { encoding: "utf8" }).stdout.split(" ")[0];
  const { shippedDraftPx } = buildPages(work);
  report.shippedDraftPx = shippedDraftPx;
  const server = spawn("python3", ["-u", "-m", "http.server", "0", "--bind", "127.0.0.1", "--directory", work], { stdio: ["ignore", "pipe", "pipe"] });
  procs.push(server);
  const port = +(await waitForLine(server.stdout, /Serving HTTP on \S+ port (\d+)/, 10000))[1];
  report.port = port;

  const plan = [];
  for (const h of HEIGHTS) {
    plan.push({ page: "shipped", height: h, fab: true, exportZip: true, shots: true, canvas: h === HEIGHTS[0] });
    for (const n of SIZES) plan.push({ page: `draft${n}`, height: h, fab: false, shots: n === SIZES[0], canvas: h === HEIGHTS[0] && n === SIZES[0] });
    plan.push({ page: "serial", height: h, fab: true, exportZip: true, shots: false, serial: true });
  }
  for (const p of plan) {
    try { report.runs.push(await runOnce(port, p, fixture, work, procs)); }
    catch (e) { log("run failed", p.page, p.height, e.stack || e); report.runs.push({ label: `${p.page}@${p.height}`, error: String(e && e.message || e) }); }
  }

  // pool vs serial equality (same settings, same height)
  report.equality = {};
  for (const h of HEIGHTS) {
    const P = report.runs.find((r) => r.label === `shipped@${h}`), Q = report.runs.find((r) => r.label === `serial@${h}`);
    if (!P || !Q || !P.fabSnapshot || !Q.fabSnapshot) { report.equality[h] = { error: "missing run" }; continue; }
    const dP = P.draft, dQ = Q.draft;
    report.equality[h] = { fabGeometryHashEqual: P.fabSnapshot.geometryHash === Q.fabSnapshot.geometryHash,
      fabLayerHashesEqual: JSON.stringify(P.fabSnapshot.layerHashes) === JSON.stringify(Q.fabSnapshot.layerHashes),
      fabGeometryHash: P.fabSnapshot.geometryHash, nLayers: P.fabSnapshot.layerHashes.length,
      draftGeometryHashEqual: !!(dP && dQ && dP.geometryHash === dQ.geometryHash), draftGeometryHashPool: dP && dP.geometryHash, draftGeometryHashSerial: dQ && dQ.geometryHash,
      draftLayerHashesEqual: (() => { const a = P.runs.filter((r) => r.quality === "draft" && r.layerHashes).pop(), b2 = Q.runs.filter((r) => r.quality === "draft" && r.layerHashes).pop();
        return !!(a && b2 && JSON.stringify(a.layerHashes) === JSON.stringify(b2.layerHashes)); })() };
  }

  // crops: shipped 720 draft | candidate draft | fabrication (first height)
  const h0 = HEIGHTS[0], sh = report.runs.find((r) => r.label === `shipped@${h0}`), cand = report.runs.find((r) => r.label === `draft${SIZES[0]}@${h0}`);
  if (sh && sh.draftCanvas && cand && cand.draftCanvas && sh.fabCanvas) {
    report.crops = makeCrops([[`${shippedDraftPx} px draft (alpha.3/shipped)`, sh.draftCanvas], [`${SIZES[0]} px draft (candidate)`, cand.draftCanvas],
      ["fabrication preview", sh.fabCanvas]], OUT);
  }
  report.machine.loadavgEnd = loadavg().map((x) => +x.toFixed(2));
  const counts = (ds) => ds.reduce((m, d) => (m[d.code + "/" + d.severity] = (m[d.code + "/" + d.severity] || 0) + 1, m), {});
  for (const r of report.runs) {
    delete r.draftCanvas; delete r.fabCanvas;
    for (const y of r.runs || []) if (y.diagnostics) y.diagnostics = counts(y.diagnostics);
    if (r.draft) r.draft.diagnostics = counts(r.draft.diagnostics);
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1) + "\n");
  console.log(JSON.stringify({ out: OUT, runs: report.runs.map((r) => ({ label: r.label, error: r.error, cold: r.coldDraftMs, warm: r.warm && [r.warm.p50Ms, r.warm.p95Ms], k2: r.warmK2 && [r.warmK2.p50Ms, r.warmK2.p95Ms],
    raster: r.draft && r.draft.raster, fab: r.fabMs, exp: r.exportMs, lt: r.longTask })), equality: report.equality }, null, 1));
} finally {
  for (const p of procs) { try { p.kill("SIGKILL"); } catch (_) { /* gone */ } }
  if (!argv.includes("--keep")) rmSync(work, { recursive: true, force: true });
  else log("work dir kept:", work);
}
