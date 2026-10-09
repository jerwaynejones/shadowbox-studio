#!/usr/bin/env node
/**
 * alpha.3 end-to-end browser verification (real headless Chromium, the way tools/capture_baseline.mjs drives it).
 *
 * No npm: Node built-ins, python3 http.server on a free 127.0.0.1 port (killed afterwards), a locally installed
 * Chromium over the DevTools protocol, `unzip` and ImageMagick `magick` (crops only).
 *
 * Scenario A (alpha.3, HEAD): the deterministic 3600 × 2700 colour scene (tools/alpha3_scene.js), xTool S1 profile,
 *   Plywood preset, Bonded relief, size by height 300 mm, pitch 0.1 mm/px, 8 sheets. Screenshots of Proof, Section,
 *   Layers and Tilt at draft quality and after "Preview at fabrication resolution", the load-time source notes, the
 *   diagnostics panel and the Fabrication review; then the ZIP is exported through the real Download button.
 *   SBEngine.generate and SBEngine.fabricationFiles are wrapped (observation only, results passed through) so the
 *   snapshots the views showed can be compared with the files.
 * Scenario B (alpha.2, commit a7d4ee1 via `git archive`): the same scene and settings in the alpha.2 app, whose
 *   draft is the 720 px legacy pipeline, for the edge-resolution and bridge comparison.
 * Scenario C (alpha.3, clip re-review): BOND_UNSUPPORTED cannot occur on a real bonded run (bonded layers are raw
 *   lattice contours of nested masks, D1/D-4.5), so the clip path is driven on the AT-09 fixture with the engine's
 *   test hook (SBEngine.TEST_HOOKS + req.debug.smoothBonded, both sides of the run) and three cleanup values set
 *   through the DevTools debugger (cornerStyle smooth, minFeatureMM 0, holeMM2 0, as in the AT-09 test). Everything
 *   after that is the real UI: "Clip to lower layer…", Accept clip, Preview at fabrication resolution, the
 *   REPAIR_REVIEW_FAB item's Show / Keep, Download.
 *
 * Usage: node tools/verify_alpha3.mjs [--out docs/baseline/alpha3] [--work <scratch dir>] [chromium-binary]
 * Writes screenshots, crops and report.json into --out; the scene PNG, alpha.2 tree, downloads and unpacked ZIPs
 * into --work (default: a temp dir, removed at the end unless --keep).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const W = 1440, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function parseArgs(argv) {
  const o = { out: join(ROOT, "docs", "baseline", "alpha3"), work: null, chrome: "chromium", keep: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") o.out = resolve(argv[++i]);
    else if (argv[i] === "--work") o.work = resolve(argv[++i]);
    else if (argv[i] === "--keep") o.keep = true;
    else o.chrome = argv[i];
  }
  return o;
}

function waitForLine(stream, re, ms) {
  return new Promise((res, rej) => {
    let buf = "";
    const onData = (d) => { buf += d.toString(); const m = buf.match(re); if (m) { clearTimeout(t); stream.off("data", onData); res(m); } };
    const t = setTimeout(() => { stream.off("data", onData); rej(new Error("timeout waiting for " + re + "; got: " + buf.trim())); }, ms);
    stream.on("data", onData);
  });
}

async function startServer(dir) {
  // port 0: the OS picks a free port; readiness and the port come from the server's own banner
  const server = spawn("python3", ["-u", "-m", "http.server", "0", "--bind", "127.0.0.1", "--directory", dir], { stdio: ["ignore", "pipe", "pipe"] });
  const m = await waitForLine(server.stdout, /Serving HTTP on \S+ port (\d+)/, 10000);
  return { server, port: +m[1] };
}

// ------------------------------------------------------------------ CDP
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map(), listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) listeners.forEach((f) => f(msg));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const m = { id: ++id, method, params }; if (sessionId) m.sessionId = sessionId;
    pending.set(m.id, { res, rej }); ws.send(JSON.stringify(m));
  });
  return { ws, send, listeners };
}

async function openPage(cdp, url, dl) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable"); await S("DOM.enable");
  await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl, eventsEnabled: true });
  const exceptions = [];
  cdp.listeners.add((m) => {
    if (m.sessionId === sessionId && m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails; exceptions.push((d.exception && d.exception.description) || d.text);
    }
  });
  await S("Page.navigate", { url });
  const ev = async (expr, timeout = 600000) => {
    const r = await S("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error("page eval failed: " + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text) + "\n  in: " + expr.slice(0, 200));
    return r.result.value;
  };
  for (let i = 0; i < 200; i++) { await sleep(100); if (await ev(`document.readyState === "complete" && !!document.getElementById("statusline")`)) break; }
  await sleep(500);
  return { S, ev, sessionId, targetId, exceptions };
}

async function shot(page, file) {
  const r = await page.S("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
}
async function canvasPng(page, file) {
  const b64 = await page.ev(`new Promise(r => document.getElementById("stackcanvas").toBlob(b => {
    const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(b); }, "image/png"))`);
  writeFileSync(file, Buffer.from(b64, "base64"));
  return file;
}
async function setFile(page, selector, path) {
  const { root } = await page.S("DOM.getDocument", { depth: 1 });
  const { nodeId } = await page.S("DOM.querySelector", { nodeId: root.nodeId, selector });
  await page.S("DOM.setFileInputFiles", { nodeId, files: [path] });
}
const status = (page) => page.ev(`(document.getElementById("statusline")||{}).textContent||""`);
async function waitFor(page, expr, ms, what) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < ms) { v = await page.ev(expr); if (v) return v; await sleep(250); }
  throw new Error("timeout (" + ms + " ms) waiting for " + (what || expr) + "; status: " + (await status(page)));
}
/** Change a control the way the user does: set the value, then fire input and change. */
const setCtl = (page, id, value) => page.ev(`(() => { const el = document.getElementById(${JSON.stringify(id)});
  el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event("input", {bubbles: true})); el.dispatchEvent(new Event("change", {bubbles: true}));
  return el.value; })()`);
async function tab(page, name) {
  await page.ev(`document.querySelector('.tab[data-tab="${name}"]').click(), true`);
  await sleep(700);
}
function download(cdp, ms = 120000) {
  let on, suggested = null;
  const p = new Promise((res, rej) => {
    const t = setTimeout(() => { cdp.listeners.delete(on); rej(new Error("download timeout")); }, ms);
    on = (m) => {
      if (m.method === "Browser.downloadWillBegin") suggested = m.params.suggestedFilename;
      if (m.method !== "Browser.downloadProgress") return;
      if (m.params.state === "completed") { clearTimeout(t); cdp.listeners.delete(on); res(suggested); }
      if (m.params.state === "canceled") { clearTimeout(t); cdp.listeners.delete(on); rej(new Error("download canceled")); }
    };
    cdp.listeners.add(on);
  });
  return p;
}

/**
 * The Proof canvas at device scale 2 in the alpha.2 colouring (Palette proof, Midnight), for the edge crops; the
 * appearance is a view setting (no revision change, no regeneration) and is set back to uniform stock afterwards.
 */
async function hiResProof(page, file, palette = true) {
  await tab(page, "proof");
  if (palette) { await setCtl(page, "in-appearance", "palette"); await setCtl(page, "in-palette", "Midnight (Starry Night)"); }
  await page.S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await page.ev(`window.dispatchEvent(new Event("resize")), true`); await sleep(1500);
  await canvasPng(page, file);
  await page.S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await page.ev(`window.dispatchEvent(new Event("resize")), true`); await sleep(800);
  if (palette) await setCtl(page, "in-appearance", "uniform");
  return file;
}

/** Side-by-side crops (mm regions of the 400 × 300 mm page): alpha.2 720 px draft | alpha.3 draft | alpha.3 fabrication. */
function makeCrops(canvases, out) {
  const box = (f) => { const m = spawnSync("magick", [f, "-format", "%@", "info:"], { encoding: "utf8" }).stdout.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/); return m.slice(1).map(Number); };
  const REG = { moon: [35, 15, 95, 65], city: [235, 150, 325, 222], tree_wires: [15, 150, 135, 240], fence: [215, 250, 335, 285] };
  const made = {};
  for (const [name, [x0, y0, x1, y1]] of Object.entries(REG)) {
    const parts = [];
    for (const [label, f] of [["alpha.2 draft (720 px legacy)", canvases[0]], ["alpha.3 draft", canvases[1]], ["alpha.3 fabrication preview", canvases[2]]]) {
      const [bw, bh, bx, by] = box(f), sx = bw / 400, sy = bh / 300;
      const g = `${Math.round((x1 - x0) * sx)}x${Math.round((y1 - y0) * sy)}+${Math.round(bx + x0 * sx)}+${Math.round(by + y0 * sy)}`;
      const t = join(dirname(f), `crop_${name}_${parts.length}.png`);
      spawnSync("magick", [f, "-crop", g, "+repage", "-background", "white", "-flatten", "-filter", "point", "-resize", "200%",
        "-gravity", "north", "-background", "white", "-splice", "0x34", "-pointsize", "24", "-annotate", "+0+4", label, t]);
      parts.push(t);
    }
    const o = join(out, `crop_${name}.png`);
    spawnSync("magick", [...parts, "-bordercolor", "white", "-border", "6", "+append", o]);
    made[name] = o;
  }
  return made;
}

/** Observation wrappers (results are passed through unchanged): every generate and fabricationFiles call is recorded. */
const INSTRUMENT = `(() => {
  if (window.__gen) return true;
  window.__gen = []; window.__files = [];
  const E = window.SBEngine, gen = E.generate, ff = E.fabricationFiles;
  E.generate = function (req, opts) {
    const t0 = performance.now(), r = gen.apply(this, arguments), s = r.snapshot;
    const rec = { quality: req.quality, status: r.status, ms: Math.round(performance.now() - t0), revision: req.revision,
      error: r.error || null, snapshot: s || null };
    if (s) Object.assign(rec, { geometryHash: s.geometryHash, raster: [s.geometry.rasterW, s.geometry.rasterH], mmPerPx: s.geometry.mmPerPxMax,
      mode: s.construction.mode, interp: req.config.interpretation.mode, page: s.page, nLayers: s.layers.length, exported: s.stats.exported,
      layerHashes: s.layers.map((L) => SBGeom.layerHashes(L).layerHash), status2: s.layers.map((L) => L.status),
      bridged: s.cleanupReport.reduce((a, c) => a + (c.bridged || 0), 0), culled: s.cleanupReport.reduce((a, c) => a + (c.culled || 0), 0),
      codes: s.diagnostics.reduce((m, d) => (m[d.code] = (m[d.code] || 0) + 1, m), {}),
      scoreCounts: s.layers.map((L) => (L.scorePaths || []).length),
      labels: s.guides ? s.guides.labels.map((l) => l.text) : null, omitted: s.guides ? s.guides.omitted.length : null,
      guidesMode: s.guides ? s.guides.mode : null, vertices: s.layers.reduce((a, L) => a + (L.stats ? L.stats.vertices || 0 : 0), 0) });
    window.__gen.push(rec);
    return r;
  };
  E.fabricationFiles = function (snapshot) {
    const out = ff.apply(this, arguments);
    const fabs = window.__gen.filter((g) => g.quality === "fabrication" && g.snapshot);
    window.__files.push({ sameSnapshotAsLastFab: fabs.length > 0 && fabs[fabs.length - 1].snapshot === snapshot,
      fabRunsBefore: fabs.length, geometryHash: snapshot.geometryHash, names: out.map((f) => f.name) });
    return out;
  };
  return true;
})()`;
const genRecs = (page) => page.ev(`window.__gen.map((g) => { const o = Object.assign({}, g); delete o.snapshot; return o; })`);

/** Tick every unchecked acknowledgement in a diagnostics list (each change re-renders the list). */
async function ackAll(page, listId) {
  for (let i = 0; i < 400; i++) {
    const left = await page.ev(`(() => { const b = Array.from(document.querySelectorAll("#${listId} .diag-ack input")).find((x) => !x.checked);
      if (!b) return 0; b.click(); return 1; })()`);
    if (!left) return i;
    await sleep(30);
  }
  throw new Error("could not acknowledge every warning in #" + listId);
}

// ------------------------------------------------------------------ Node-side checks on the exported files
function loadModules() {
  const g = globalThis;
  if (!g.SBSvgRead) for (const f of require(join(ROOT, "test", "modules.js")).NODE_MODULES)
    vm.runInThisContext(readFileSync(join(ROOT, "js", f), "utf8"), { filename: f });
  return g;
}
function unzip(zip, dir) {
  rmSync(dir, { recursive: true, force: true });
  const u = spawnSync("unzip", ["-q", "-o", zip, "-d", dir], { stdio: "inherit" });
  if (u.status !== 0) throw new Error("unzip failed");
  return readdirSync(dir).sort();
}

// ------------------------------------------------------------------ scenarios
async function scenarioA(cdp, port, scene, work, out, rep) {
  const dl = join(work, "dl-a"); mkdirSync(dl, { recursive: true });
  const page = await openPage(cdp, `http://127.0.0.1:${port}/index.html`, dl);
  await page.ev(INSTRUMENT);
  const A = rep.a = { url: `http://127.0.0.1:${port}/index.html`, screenshots: {} };
  A.initial = await page.ev(`({preset: document.getElementById("in-preset").value, construction: document.getElementById("in-construction").value,
    machine: document.getElementById("in-machine").value, pitch: document.getElementById("in-res").value, sizeby: document.getElementById("in-sizeby").value,
    version: document.getElementById("meta-version").textContent})`);
  // The requested settings, through the controls (preset and construction are already Plywood / Bonded relief at start)
  if (A.initial.preset !== "plywood") throw new Error("app did not start on the Plywood preset");
  if (A.initial.construction !== "bonded-relief") throw new Error("app did not start on Bonded relief");
  await setCtl(page, "in-machine", "xtool-s1-feeder");
  await setCtl(page, "in-res", "0.1");
  await setCtl(page, "in-sheets", "8");
  await setCtl(page, "in-sizeby", "height");
  await setCtl(page, "in-target", "300");
  A.controls = await page.ev(`({preset: document.getElementById("in-preset").value, construction: document.getElementById("in-construction").value,
    machine: document.getElementById("in-machine").value, pitch: document.getElementById("in-res").value, sheets: document.getElementById("in-sheets").value,
    sizeby: document.getElementById("in-sizeby").value, target: document.getElementById("in-target").value})`);

  // Load the colour scene (real file input), wait for the first draft
  const tLoad = Date.now();
  await setFile(page, "#filein", scene);
  await waitFor(page, `window.__gen.some((g) => g.quality === "draft" && g.status === "done") && /^Draft \\(approximate/.test(document.getElementById("statusline").textContent)`, 240000, "first draft");
  await sleep(1500);
  A.loadToDraftMs = Date.now() - tLoad;
  A.sourceNote = await page.ev(`(() => { const w = document.getElementById("why-source"); return w.hidden ? null : w.textContent; })()`);
  A.interpAfterLoad = await page.ev(`document.getElementById("in-interp").value`);
  A.draftStatus = await status(page);
  A.draftBadge = await page.ev(`document.getElementById("state-badge").textContent`);
  A.dimbar = await page.ev(`Array.from(document.querySelectorAll("#dimbar > .dim")).filter((e) => !e.hidden).map((e) => e.textContent.trim()).filter(Boolean)`);
  A.draftDiagSummary = await page.ev(`document.getElementById("diag-summary").textContent`);
  A.draftPlanGroup = await page.ev(`Array.from(document.querySelectorAll("#diag-list .diag-plan .diag-item")).map((li) => li.textContent.replace(/\\s+/g, " ").trim())`);
  A.bridgesToolHidden = await page.ev(`document.getElementById("tool-bridges").hidden`);
  await page.ev(`document.getElementById("stage-source").scrollIntoView({block: "start"}), true`);
  A.screenshots.load = await shot(page, join(out, "a3_load_source_notes.png"));
  await page.ev(`document.getElementById("diag-panel").scrollIntoView({block: "start"}), true`);
  A.screenshots.draftDiag = await shot(page, join(out, "a3_draft_diagnostics.png"));

  // Draft views
  for (const t of ["proof", "section", "sheets", "tilt"]) {
    await tab(page, t);
    A.screenshots["draft_" + t] = await shot(page, join(out, `a3_draft_${t === "sheets" ? "layers" : t}.png`));
  }
  A.draftCards = await (async () => { await tab(page, "sheets"); return page.ev(`({legend: document.getElementById("guides-legend").textContent,
    labels: Array.from(document.querySelectorAll(".sheetlabel")).map((e) => e.textContent.replace(/\\s+/g, " ").trim())})`); })();
  A.draftCanvas = await hiResProof(page, join(work, "a3_draft_proof_canvas.png"));

  // Preview at fabrication resolution
  const nFab0 = (await genRecs(page)).filter((g) => g.quality === "fabrication").length;
  A.fabButtonBefore = await page.ev(`document.getElementById("btn-fabpreview").textContent`);
  const tFab = Date.now();
  page.ev(`document.getElementById("btn-fabpreview").click(), true`).catch(() => {});
  await sleep(300);
  await waitFor(page, `window.__gen.filter((g) => g.quality === "fabrication").length > ${nFab0} && /^Fabrication ·/.test(document.getElementById("statusline").textContent)`, 900000, "fabrication preview");
  await sleep(1500);
  A.fabWallMs = Date.now() - tFab;
  A.fabStatus = await status(page);
  A.fabBadge = await page.ev(`document.getElementById("state-badge").textContent`);
  A.fabButtonAfter = await page.ev(`document.getElementById("btn-fabpreview").textContent`);
  A.fabReviewSummary = await page.ev(`document.getElementById("fab-summary").textContent`);
  A.whyExportAtFab = await page.ev(`document.getElementById("why-export").textContent`);
  A.fabBridgesToolHidden = await page.ev(`document.getElementById("tool-bridges").hidden`);
  for (const t of ["proof", "section", "sheets", "tilt"]) {
    await tab(page, t);
    A.screenshots["fab_" + t] = await shot(page, join(out, `a3_fab_${t === "sheets" ? "layers" : t}.png`));
  }
  A.fabCards = await (async () => { await tab(page, "sheets"); return page.ev(`({legend: document.getElementById("guides-legend").textContent,
    labels: Array.from(document.querySelectorAll(".sheetlabel")).map((e) => e.textContent.replace(/\\s+/g, " ").trim())})`); })();
  A.fabCanvas = await hiResProof(page, join(work, "a3_fab_proof_canvas.png"));
  await page.ev(`document.getElementById("fab-review").scrollIntoView({block: "start"}), true`);
  A.screenshots.fabReview = await shot(page, join(out, "a3_fab_review.png"));

  // Export: acknowledge the fabrication warnings, then the real Download button
  A.acked = await ackAll(page, "fab-list");
  A.whyExportAfterAck = await page.ev(`document.getElementById("why-export").textContent`);
  A.exportDisabled = await page.ev(`document.getElementById("btn-export").disabled`);
  const nGenBeforeExport = (await genRecs(page)).length;
  const dlDone = download(cdp);
  await page.ev(`document.getElementById("btn-export").click(), true`);
  const zipName = await dlDone;
  await sleep(500);
  A.exportStatus = await status(page);
  A.files = await page.ev(`window.__files`);
  const recs = await genRecs(page);
  A.generateCallsDuringExport = recs.length - nGenBeforeExport;
  A.runs = recs;
  A.zip = { name: zipName, path: join(dl, zipName) };
  A.exceptions = page.exceptions;
  await cdp.send("Target.closeTarget", { targetId: page.targetId });
  return A;
}

async function scenarioB(cdp, port, scene, work, out, rep) {
  const dl = join(work, "dl-b"); mkdirSync(dl, { recursive: true });
  const page = await openPage(cdp, `http://127.0.0.1:${port}/index.html`, dl);
  const B = rep.b = { screenshots: {} };
  B.version = await page.ev(`document.getElementById("meta-version").textContent`);
  // construction → Bonded relief through the alpha.2 mode-change review dialog
  await page.ev(`(() => { const el = document.getElementById("in-construction"); el.value = "bonded-relief"; el.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await sleep(300);
  await page.ev(`document.querySelector('#dlg-mode button[value="accept"]').click(), true`);
  await sleep(300);
  await setCtl(page, "in-machine", "xtool-s1-feeder");
  await setCtl(page, "in-res", "0.1");
  await setCtl(page, "in-sheets", "8");
  await setCtl(page, "in-sizeby", "height");
  await setCtl(page, "in-target", "300");
  await setCtl(page, "in-polarity", "light-front");   // as the alpha.3 Plywood auto-tonal route
  B.controls = await page.ev(`({construction: document.getElementById("in-construction").value, machine: document.getElementById("in-machine").value,
    pitch: document.getElementById("in-res").value, sheets: document.getElementById("in-sheets").value, sizeby: document.getElementById("in-sizeby").value,
    target: document.getElementById("in-target").value, interp: document.getElementById("in-interp").value,
    polarity: document.getElementById("in-polarity").value, palette: document.getElementById("in-palette").value})`);
  await setFile(page, "#filein", scene);
  await waitFor(page, `(() => { const s = document.getElementById("statusline").textContent; return s && !/…$/.test(s) && /sheets/.test(s); })()`, 240000, "alpha.2 draft");
  await sleep(4000);   // the deferred view build
  B.status = await status(page);
  B.sourceNote = await page.ev(`(() => { const w = document.getElementById("why-source"); return w.hidden ? null : w.textContent; })()`);
  B.bridgesToolHidden = await page.ev(`document.getElementById("tool-bridges").hidden`);
  await tab(page, "proof");
  B.screenshots.proof = await shot(page, join(out, "a2_draft_proof.png"));
  await tab(page, "sheets");
  B.screenshots.layers = await shot(page, join(out, "a2_draft_layers.png"));
  B.cards = await page.ev(`Array.from(document.querySelectorAll(".sheetlabel")).map((e) => e.textContent.replace(/\\s+/g, " ").trim())`);
  B.canvas = await hiResProof(page, join(work, "a2_draft_proof_canvas.png"), false);
  B.exceptions = page.exceptions;
  await cdp.send("Target.closeTarget", { targetId: page.targetId });
  return B;
}

async function scenarioC(cdp, port, fixture, work, out, rep) {
  const dl = join(work, "dl-c"); mkdirSync(dl, { recursive: true });
  const page = await openPage(cdp, `http://127.0.0.1:${port}/index.html`, dl);
  const C = rep.c = { screenshots: {}, instrumentation: [] };
  await page.ev(INSTRUMENT);
  // Test hook (AT-09): admit req.debug and add {smoothBonded: true} to every request (draft and fabrication alike)
  await page.ev(`(() => { SBEngine.TEST_HOOKS = true; const rq = SBEngine.request;
    SBEngine.request = function () { const r = rq.apply(this, arguments); r.debug = { smoothBonded: true }; return r; }; return true; })()`);
  C.instrumentation.push("SBEngine.TEST_HOOKS = true; SBEngine.request adds req.debug = {smoothBonded: true} to draft and fabrication requests");
  await setCtl(page, "in-sheets", "3");
  await setCtl(page, "in-target", "2");
  await setCtl(page, "in-res", "0.05");
  // The AT-09 cleanup values are not reachable from the controls (min feature ≥ 0.6 mm; corner style is neutral in
  // bonded): set them on the app's project through the debugger, paused inside app.js (showRangeValue).
  await page.S("Debugger.enable");
  const appUrl = `http://127.0.0.1:${port}/js/app.js`;
  const src = readFileSync(join(ROOT, "js", "app.js"), "utf8").split("\n");
  const line = src.findIndex((l) => /function showRangeValue\(id, value\)/.test(l)) + 1;   // 0-based line of the body
  const { breakpointId } = await page.S("Debugger.setBreakpointByUrl", { url: appUrl, lineNumber: line });
  const paused = new Promise((res) => { const f = (m) => { if (m.method === "Debugger.paused") { cdp.listeners.delete(f); res(m.params); } }; cdp.listeners.add(f); });
  const trig = page.S("Runtime.evaluate", { expression: `document.getElementById("in-smooth").dispatchEvent(new Event("input")), true` });
  const pp = await paused;
  const setExpr = `project = (() => { const q = JSON.parse(JSON.stringify(project)); q.construction.cleanup.cornerStyle = "smooth";
    q.construction.cleanup.minFeatureMM = 0; q.construction.cleanup.holeMM2 = 0; q.revision += 1; return q; })(), JSON.stringify(project.construction.cleanup)`;
  const r = await page.S("Debugger.evaluateOnCallFrame", { callFrameId: pp.callFrames[0].callFrameId, expression: setExpr, returnByValue: true });
  C.instrumentation.push("debugger: project.construction.cleanup = " + (r.result && r.result.value));
  await page.S("Debugger.removeBreakpoint", { breakpointId });
  await page.S("Debugger.resume");
  await trig;
  await page.S("Debugger.disable");

  await setFile(page, "#filein", fixture);
  await waitFor(page, `window.__gen.some((g) => g.quality === "draft" && g.status === "done") && /^Draft \\(approximate/.test(document.getElementById("statusline").textContent)`, 60000, "fixture draft");
  await sleep(800);
  C.draft = (await genRecs(page)).filter((g) => g.quality === "draft").pop();
  C.clipButtons = await page.ev(`Array.from(document.querySelectorAll("#diag-list .diag-actions button")).map((b) => b.textContent)`);
  await page.ev(`document.getElementById("diag-panel").scrollIntoView({block: "start"}), true`);
  C.screenshots.draftDiag = await shot(page, join(out, "c_draft_bond_unsupported.png"));
  const has = await page.ev(`(() => { const b = Array.from(document.querySelectorAll("#diag-list .diag-actions button")).find((x) => /Clip to lower layer/.test(x.textContent));
    if (!b) return false; b.click(); return true; })()`);
  if (!has) throw new Error("no \"Clip to lower layer…\" action on the draft");
  await sleep(500);
  C.dialog = await page.ev(`({open: document.getElementById("dlg-clip").open, title: document.getElementById("dlg-clip-title").textContent,
    summary: document.getElementById("dlg-clip-summary").textContent, acceptDisabled: document.getElementById("dlg-clip-accept").disabled})`);
  C.screenshots.dialog = await shot(page, join(out, "c_clip_dialog.png"));
  const nDraft = (await genRecs(page)).filter((g) => g.quality === "draft").length;
  await page.ev(`document.getElementById("dlg-clip-accept").click(), true`);
  await waitFor(page, `window.__gen.filter((g) => g.quality === "draft").length > ${nDraft} && /^Draft \\(approximate/.test(document.getElementById("statusline").textContent)`, 60000, "draft after clip");
  await sleep(800);
  C.draftAfterClip = (await genRecs(page)).filter((g) => g.quality === "draft").pop();
  C.repairs = await page.ev(`document.getElementById("repair-summary").textContent + " | " + Array.from(document.querySelectorAll("#repair-list .diag-item")).map((e) => e.textContent.replace(/\\s+/g, " ").trim()).join(" | ")`);
  page.ev(`document.getElementById("btn-fabpreview").click(), true`).catch(() => {});
  await waitFor(page, `window.__gen.some((g) => g.quality === "fabrication") && /^Fabrication ·/.test(document.getElementById("statusline").textContent)`, 120000, "fixture fabrication preview");
  await sleep(800);
  C.fab = (await genRecs(page)).filter((g) => g.quality === "fabrication").pop();
  C.fabItem = await page.ev(`(() => { const li = Array.from(document.querySelectorAll("#fab-list .diag-item")).find((x) => /Keep this clip at fabrication resolution/.test(x.textContent));
    return li ? { text: li.textContent.replace(/\\s+/g, " ").trim(), buttons: Array.from(li.querySelectorAll(".diag-actions button")).map((b) => b.textContent) } : null; })()`);
  C.whyExportAtFab = await page.ev(`document.getElementById("why-export").textContent`);
  C.exportDisabledAtFab = await page.ev(`document.getElementById("btn-export").disabled`);
  await page.ev(`document.getElementById("fab-review").scrollIntoView({block: "start"}), true`);
  C.screenshots.fabReview = await shot(page, join(out, "c_fab_review_repair.png"));
  // Show: the views switch to the fabrication result and focus the clipped layer and region
  await page.ev(`(() => { const li = Array.from(document.querySelectorAll("#fab-list .diag-item")).find((x) => /Keep this clip/.test(x.textContent));
    Array.from(li.querySelectorAll(".diag-actions button")).find((b) => b.textContent === "Show").click(); return true; })()`);
  await sleep(800);
  C.afterShowStatus = await status(page);
  C.screenshots.show = await shot(page, join(out, "c_fab_show_clip.png"));
  // Keep (the item's acknowledgement), then every other warning, then Download
  C.acked = await ackAll(page, "fab-list");
  C.whyExportAfterAck = await page.ev(`document.getElementById("why-export").textContent`);
  C.exportDisabledAfterAck = await page.ev(`document.getElementById("btn-export").disabled`);
  const dlDone = download(cdp, 60000);
  await page.ev(`document.getElementById("btn-export").click(), true`);
  C.zip = await dlDone.then((n) => ({ name: n, path: join(dl, n) }), (e) => ({ error: e.message }));
  await sleep(300);
  C.exportStatus = await status(page);
  C.exceptions = page.exceptions;
  await cdp.send("Target.closeTarget", { targetId: page.targetId });
  return C;
}

// ------------------------------------------------------------------ main
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const work = o.work || mkdtempSync(join(tmpdir(), "sb-alpha3-"));
  mkdirSync(work, { recursive: true }); mkdirSync(o.out, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "sb-alpha3-prof-"));
  const procs = [];
  const rep = { date: new Date().toISOString(), checks: {} };
  try {
    // inputs: the colour scene, the AT-09 fixture PNG, the alpha.2 tree
    const scene = join(work, "alpha3_scene_3600x2700.png");
    spawnSync(process.execPath, [join(ROOT, "tools", "alpha3_scene.js"), scene, "3600", "2700"], { stdio: "inherit" });
    rep.scene = { path: basename(scene), w: 3600, h: 2700, sha256: sha256(readFileSync(scene)), generator: "tools/alpha3_scene.js" };
    spawnSync("magick", [scene, "-resize", "900x", join(o.out, "scene_thumb.png")]);
    const F = require(join(ROOT, "test", "fixtures.js"));
    const ci = F.MASKS.crescentInterior, CW = 40, CH = 40, hs = new Uint8Array(CW * CH);
    for (let y = 0; y < ci.h; y++) for (let x = 0; x < ci.w; x++) if (ci.layers[1][y * ci.w + x]) hs[(y + 15) * CW + x + 14] = 255;
    hs[(8 + 15) * CW + 4 + 14] = 128;
    const fixture = join(work, "at09_crescent.png");
    writeFileSync(fixture, F.pngEncode({ w: CW, h: CH, colorType: 0, bitDepth: 8, data: hs }));
    const a2 = join(work, "alpha2");
    rmSync(a2, { recursive: true, force: true }); mkdirSync(a2);
    const ga = spawnSync("bash", ["-c", `git -C "${ROOT}" archive a7d4ee1 | tar -x -C "${a2}"`], { stdio: "inherit" });
    if (ga.status !== 0) throw new Error("git archive of alpha.2 failed");

    const s3 = await startServer(ROOT); procs.push(s3.server);
    const s2 = await startServer(a2); procs.push(s2.server);
    const chrome = spawn(o.chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
      "--no-default-browser-check", "--disable-extensions", `--window-size=${W},${H}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
    procs.push(chrome);
    const [, wsUrl] = await waitForLine(chrome.stderr, /DevTools listening on (ws:\/\/\S+)/, 20000);
    const cdp = await connect(wsUrl);
    rep.browser = await cdp.send("Browser.getVersion");
    rep.ports = { alpha3: s3.port, alpha2: s2.port };

    const A = await scenarioA(cdp, s3.port, scene, work, o.out, rep);
    console.error("scenario A done");
    const B = await scenarioB(cdp, s2.port, scene, work, o.out, rep);
    console.error("scenario B done");
    rep.crops = makeCrops([B.canvas, A.draftCanvas, A.fabCanvas], o.out);
    const C = await scenarioC(cdp, s3.port, fixture, work, o.out, rep);
    console.error("scenario C done");
    cdp.ws.close();

    // ---- exported ZIP of scenario A: names, hashes, round trip
    const G = loadModules();
    const zdir = join(work, "zip-a"), names = unzip(A.zip.path, zdir);
    const fabRun = A.runs.filter((g) => g.quality === "fabrication").pop();
    const settings = JSON.parse(readFileSync(join(zdir, "settings.json"), "utf8"));
    const assembly = readFileSync(join(zdir, "ASSEMBLY.md"), "utf8");
    const sheets = names.filter((n) => /^sheet_\d+\.svg$/.test(n));
    const rebuilt = sheets.map((n) => {
      const k = parseInt(n.slice(6, 8), 10) - 1, text = readFileSync(join(zdir, n), "utf8"), p = G.SBSvgRead.parse(text);
      const L = { index: k, material: G.SBSvgRead.toMaterial(p.cut), scorePaths: p.score, holes: [] };
      return { name: n, k, L, score: p.score.length, cutRings: p.cut.length, unsupported: p.unsupported, hasText: /<text/.test(text),
        layerHash: G.SBGeom.layerHashes(L).layerHash, bytes: text.length };
    });
    const pr = G.SBSchema.defaults("plywood").construction.guides;
    const allLayers = fabRun.layerHashes.map((_, k) => (rebuilt.find((r) => r.k === k) || { L: { index: k, material: [], scorePaths: [], holes: [] } }).L);
    const independentGuideCheck = G.SBGuides.validate(allLayers, { scorePaths: allLayers.map((L) => L.scorePaths) }, pr, { revision: 0, quality: "fabrication" });
    rep.export = {
      zip: A.zip.name, zipSha256: sha256(readFileSync(A.zip.path)), files: names,
      settingsGeometryHash: settings.geometryHash, settingsProject: settings.project,
      assemblyHashLine: (assembly.match(/fabrication result [0-9a-f]{12}/) || [null])[0],
      sheets: rebuilt.map((r) => ({ name: r.name, layer: r.k, scorePaths: r.score, cutRings: r.cutRings, hasText: r.hasText, unsupported: r.unsupported.length,
        layerHashFromSvg: r.layerHash, layerHashFabPreview: fabRun.layerHashes[r.k], equal: r.layerHash === fabRun.layerHashes[r.k] })),
      independentGuideValidate: independentGuideCheck.map((d) => d.code),
    };

    // ---- checks
    const drafts = A.runs.filter((g) => g.quality === "draft" && g.status === "done");
    const fabs = A.runs.filter((g) => g.quality === "fabrication");
    const ck = rep.checks;
    ck.c1_noBridges = {
      pass: A.runs.every((g) => g.mode === "bonded-relief" && g.bridged === 0) && A.bridgesToolHidden && A.fabBridgesToolHidden &&
        !/bridged/.test(A.draftStatus) && !/bridged/.test(A.fabStatus) && A.draftCards.labels.concat(A.fabCards.labels).every((t) => !/bridged/.test(t)),
      evidence: { runs: A.runs.map((g) => ({ quality: g.quality, mode: g.mode, bridged: g.bridged, culled: g.culled })), draftStatus: A.draftStatus, fabStatus: A.fabStatus,
        alpha2Status: B.status, alpha2BridgedCards: B.cards.filter((t) => /bridged/.test(t)).length },
    };
    const f = A.files[A.files.length - 1] || {};
    ck.c2_hashes = {
      pass: fabs.length === 1 && A.generateCallsDuringExport === 0 && f.sameSnapshotAsLastFab === true && f.geometryHash === fabRun.geometryHash &&
        settings.project.geometryHash === fabRun.geometryHash && settings.geometryHash === fabRun.geometryHash.slice(0, 12) &&
        rep.export.sheets.length === fabRun.exported && rep.export.sheets.every((s) => s.equal) && A.fabStatus.includes(fabRun.geometryHash.slice(0, 12)),
      evidence: { fabRunsTotal: fabs.length, generateCallsDuringExport: A.generateCallsDuringExport, exportUsedSameSnapshotObject: f.sameSnapshotAsLastFab,
        fabPreviewGeometryHash: fabRun.geometryHash, exportGeometryHash: f.geometryHash, settingsJson: settings.project.geometryHash,
        statusLine: A.fabStatus, layerHashesEqual: rep.export.sheets.filter((s) => s.equal).length + "/" + rep.export.sheets.length },
    };
    ck.c4_sourceWarnings = {
      pass: !!A.sourceNote && /tonal/i.test(A.sourceNote) && A.draftPlanGroup.length > 0,
      evidence: { whySource: A.sourceNote, interpretationAfterLoad: A.interpAfterLoad, draftPanelFabricationGroup: A.draftPlanGroup },
    };
    const lastDraft = drafts[drafts.length - 1];
    const nonTop = rep.export.sheets.filter((s) => s.layer < fabRun.exported - 1), top = rep.export.sheets.find((s) => s.layer === fabRun.exported - 1);
    ck.c5_guidesLabels = {
      pass: names.includes("placement_map.svg") && nonTop.every((s) => s.scorePaths > 0) && !!top && top.scorePaths === 0 &&
        rep.export.sheets.every((s) => !s.hasText && s.unsupported === 0) && !fabRun.codes.GUIDE_UNCONTAINED && independentGuideCheck.length === 0 &&
        fabRun.guidesMode === "inset-outline" && lastDraft.guidesMode === "inset-outline" && /approximate at draft/.test(A.draftCards.legend) && /scored/.test(A.fabCards.legend),
      evidence: { guidesMode: fabRun.guidesMode, labelsFab: fabRun.labels, labelsDraft: lastDraft.labels, omittedFab: fabRun.omitted, guideOmittedDiagnostics: fabRun.codes.GUIDE_OMITTED || 0,
        labelOmissions: (fabRun.labels || []).length < fabRun.exported - 1 ? "some sheet numbers did not fit (GUIDE_OMITTED kind label)" : "none",
        scorePathsPerSheet: rep.export.sheets.map((s) => s.scorePaths), placementMap: names.includes("placement_map.svg"),
        draftLegend: A.draftCards.legend, fabLegend: A.fabCards.legend, independentValidateOnExportedSvgs: independentGuideCheck.map((d) => d.code) },
    };
    ck.c6_clip = {
      pass: !!C.draft && (C.draft.codes.BOND_UNSUPPORTED || 0) > 0 && C.dialog.open && !C.dialog.acceptDisabled && !C.draftAfterClip.codes.BOND_UNSUPPORTED &&
        !!C.fab && (C.fab.codes.REPAIR_REVIEW_FAB || 0) > 0 && !C.fab.codes.REPAIR_STALE && !!C.fabItem && C.fabItem.buttons.includes("Show") &&
        C.fabItem.buttons.some((b) => /^Revert/.test(b)) && !/blocking/.test(C.whyExportAtFab) && !C.exportDisabledAfterAck && !!C.zip.name,
      evidence: { draftCodes: C.draft && C.draft.codes, dialog: C.dialog, draftAfterClipCodes: C.draftAfterClip && C.draftAfterClip.codes, repairs: C.repairs,
        fabCodes: C.fab && C.fab.codes, fabItem: C.fabItem, whyExportAtFab: C.whyExportAtFab, whyExportAfterAck: C.whyExportAfterAck, download: C.zip.name || C.zip.error,
        mainSceneBondUnsupported: A.runs.map((g) => g.codes && (g.codes.BOND_UNSUPPORTED || 0)), instrumentation: C.instrumentation },
    };
    ck.c3_draftEdges = { pass: null, note: "visual: see crops; set by the report author", evidence: { alpha2Status: B.status, alpha3DraftStatus: A.draftStatus,
      alpha3DraftRaster: lastDraft.raster, alpha3DraftMmPerPx: lastDraft.mmPerPx, alpha3FabRaster: fabRun.raster, alpha3FabMmPerPx: fabRun.mmPerPx,
      alpha3DraftVertices: lastDraft.vertices, alpha3FabVertices: fabRun.vertices } };
    rep.exceptions = { a: A.exceptions, b: B.exceptions, c: C.exceptions };
    rep.canvases = { a2Draft: B.canvas, a3Draft: A.draftCanvas, a3Fab: A.fabCanvas };
    writeFileSync(join(o.out, "report.json"), JSON.stringify(rep, (k, v) => (typeof v === "string" && v.startsWith(work) ? basename(v) : v), 2) + "\n");
    console.log(JSON.stringify(rep.checks, null, 2));
    console.error("work dir: " + work);
  } finally {
    for (const p of procs) { try { p.kill(); } catch (_) {} }
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
    if (!o.keep && !o.work) rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
