// test/capture_golden.js — T0.4 (stage 1) and T0.7 (stage 2). Run ONCE at v1.1.0 (before G2.4).
// Writes literal SHA-256 hashes into test/golden/; tests only ever read them, never regenerate.
// Each stage is guarded: it is skipped when its golden already exists (never overwritten).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const GOLDEN = path.join(__dirname, "golden", "sheetmasks.json");
const LEGACY_SVG = path.join(__dirname, "golden", "legacy_svg.json");
const rel = (p) => path.relative(process.cwd(), p);
// ---- speed round F0 (plan Appendix F, NFR-05): the pool-equality golden. Handled before the legacy guard below.
//   node test/capture_golden.js --pool-equality                      write test/golden/pool-equality.json (refuses to overwrite)
//   node test/capture_golden.js --pool-equality --recapture id1,id2  rewrite only the named fixtures' entries
//     [--task F1]  label the recapture; the record keeps each re-captured id's previous digest under `previous`, so a
//                  test can assert what changed (speed round F1: only diagSha/wholeSha).
if (process.argv.includes("--pool-equality")) {
  const POOL = path.join(__dirname, "golden", "pool-equality.json");
  const ri = process.argv.indexOf("--recapture"), recapture = ri > 0 ? String(process.argv[ri + 1] || "").split(",").filter(Boolean) : null;
  const exists = fs.existsSync(POOL);
  if (exists && !recapture) { console.error("capture_golden: " + rel(POOL) + " already exists; name the fixtures to replace with --recapture id1,id2,…"); process.exit(1); }
  if (!exists && recapture) { console.error("capture_golden: --recapture needs an existing " + rel(POOL)); process.exit(1); }
  globalThis.crypto ??= crypto.webcrypto;
  for (const f of require("./modules.js").NODE_MODULES) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
  const C = require("./pool_corpus.js"), all = C.corpus(), ids = all.map((fx) => fx.id);
  const unknown = (recapture || []).filter((id) => !ids.includes(id));
  if (unknown.length) { console.error("capture_golden: unknown fixture ids: " + unknown.join(", ")); process.exit(1); }
  const out = exists ? JSON.parse(fs.readFileSync(POOL, "utf8")) : { capturedFrom: null, engineVersion: SBEngine.VERSION, fixtures: {} };
  const ti = process.argv.indexOf("--task"), task = ti > 0 ? String(process.argv[ti + 1] || "") : null, previous = {};
  if (recapture) for (const id of recapture) if (out.fixtures[id]) previous[id] = out.fixtures[id];
  if (!exists) {
    try { out.capturedFrom = require("child_process").execSync("git rev-parse --short HEAD", { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch (e) { out.capturedFrom = "unknown"; }
  }
  for (const fx of all) {
    if (recapture && !recapture.includes(fx.id)) continue;
    const t = Date.now(), r = C.run(fx);
    out.fixtures[fx.id] = Object.assign({ slow: fx.slow }, C.digest(r));
    console.log("  " + fx.id + " " + r.status + " (" + (Date.now() - t) + " ms)");
  }
  if (recapture) out.recaptured = (out.recaptured || []).concat([Object.assign(task ? { task } : {}, { ids: recapture, engineVersion: SBEngine.VERSION, previous })]);
  fs.mkdirSync(path.dirname(POOL), { recursive: true });
  fs.writeFileSync(POOL, JSON.stringify(out, null, 1) + "\n");
  console.log("capture_golden: " + (recapture ? "re-captured " + recapture.length + " fixture(s) in " : "wrote ") + rel(POOL) + " (" + Object.keys(out.fixtures).length + " fixtures)");
  process.exit(0);
}
if (fs.existsSync(GOLDEN) && fs.existsSync(LEGACY_SVG)) {
  console.error("capture_golden: " + rel(GOLDEN) + " and " + rel(LEGACY_SVG) + " already exist; refusing to overwrite persisted goldens.");
  process.exit(1);
}
for (const f of require("./modules.js").NODE_MODULES) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
// ---- stage 1 (T0.4): sheetMasks/thresholds and oldRun goldens
if (fs.existsSync(GOLDEN)) console.log("capture_golden: stage 1 skipped (" + rel(GOLDEN) + " exists)");
else {
  const H = (u8) => crypto.createHash("sha256").update(Buffer.from(u8)).digest("hex");
  const L = new Float32Array(37 * 11); for (let i = 0; i < L.length; i++) L[i] = (i * 97) % 256;
  const sheetmasks = [];
  for (let N = 3; N <= 8; N++) for (const df of [true, false]) for (const mode of ["balanced", "linear"]) {
    const th = SBRaster.thresholds(L, N, mode);
    const ms = SBRaster.sheetMasks(SBRaster.bands(L, th), N, 37, 11, df);
    sheetmasks.push({ N, darkFront: df, mode, thresholds: Array.from(th), masks: ms.map(H) });
  }
  fs.mkdirSync(path.join(__dirname, "golden"), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify({ capturedFrom: "f0552c7", sheetmasks }, null, 1));
  const { oldRun } = require("./legacy_oldrun.js");
  const w = 40, h = 30, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = ((i % w) * 6 + Math.floor(i / w) * 3) % 256; rgba.set([v, v, v, 255], i * 4); }
  const cfg = { smoothRadius: 2, smoothPasses: 1, nSheets: 5, thresholdMode: "balanced", darkFront: true, widthMM: 120,
    minFeatureMM: 1.5, bridgeMM: 1.5, cullBelowMM2: 9, maxBridgeMM: 30, marginMM: 12, cornerStyle: "faceted", detailEps: 0.6 };
  const r = oldRun(rgba, w, h, cfg);
  fs.writeFileSync(path.join(__dirname, "golden/oldrun.json"), JSON.stringify({ capturedFrom: "f0552c7", cfg,
    sheets: r.sheets.map((s) => ({ mask: H(s.mask), loops: H(Buffer.from(JSON.stringify(s.loops))), bridges: s.bridges ? H(s.bridges) : null })) }, null, 1));
  console.log("capture_golden: wrote test/golden/sheetmasks.json (" + sheetmasks.length + " configs) and test/golden/oldrun.json (" + r.sheets.length + " sheets)");
}
// ---- stage 2 (T0.7): freeze the legacy SBSvg.sheetSVG/proofSVG shims (3 fixtures)
if (fs.existsSync(LEGACY_SVG)) console.log("capture_golden: stage 2 skipped (" + rel(LEGACY_SVG) + " exists)");
else {
  const cases = require("./legacy_svg_cases.js").legacySvgCases();
  fs.writeFileSync(LEGACY_SVG, JSON.stringify({ capturedFrom: "f0552c7", cases }, null, 1));
  console.log("capture_golden: wrote " + rel(LEGACY_SVG) + " (" + cases.length + " fixtures)");
}
