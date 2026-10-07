// test/capture_golden.js — T0.4 (stage 1) and T0.7 (stage 2). Run ONCE at v1.1.0 (before G2.4).
// Writes literal SHA-256 hashes into test/golden/; tests only ever read them, never regenerate.
// Each stage is guarded: it is skipped when its golden already exists (never overwritten).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const GOLDEN = path.join(__dirname, "golden", "sheetmasks.json");
const LEGACY_SVG = path.join(__dirname, "golden", "legacy_svg.json");
const rel = (p) => path.relative(process.cwd(), p);
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
