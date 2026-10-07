// test/legacy_svg_cases.js — T0.7. The 3 fixtures that freeze the legacy SBSvg.sheetSVG /
// proofSVG shims. Shared by test/capture_golden.js (writes golden/legacy_svg.json once)
// and test/run_tests.js (compares). Expects the NODE_MODULES globals to be loaded.
"use strict";
const crypto = require("crypto");
const F = require("./fixtures.js");
const H = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const COLORS = ["#f4efe6", "#d9c7a7", "#b08a5a", "#7a5634", "#4a3220", "#2a1a10", "#150c06", "#000000"];

function render(name, layers, o) {
  const n = layers.length;
  const sheets = layers.map((loops, k) => SBSvg.sheetSVG({
    loops, pxW: o.pxW, pxH: o.pxH, widthMM: o.widthMM, marginMM: o.marginMM,
    holes: o.holes, holeDiaMM: o.holeDiaMM, label: `${o.label} ${k + 1}/${n}`, isBacking: k === 0 }));
  const proof = SBSvg.proofSVG(layers.map((loops) => ({ loops })), o.pxW, o.pxH, o.widthMM, COLORS.slice(0, n));
  return { name, params: o, sheets: sheets.map(H), proof: H(proof) };
}

function legacySvgCases() {
  const traced = (fx) => fx.layers.map((m, k) => (k === 0 ? [] : SBTrace.trace(m.slice(), fx.w, fx.h)));
  const bt = F.MASKS.borderTouch, di = F.MASKS.donutIsland;
  const oldrun = require("./golden/oldrun.json");
  const w = 40, h = 30, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = ((i % w) * 6 + Math.floor(i / w) * 3) % 256; rgba.set([v, v, v, 255], i * 4); }
  const run = SBEngine.legacyRun(rgba, w, h, oldrun.cfg);
  return [
    render("borderTouch", traced(bt), { pxW: bt.w, pxH: bt.h, widthMM: 80, marginMM: 10, holes: false, holeDiaMM: 3, label: "t" }),
    render("donutIsland", traced(di), { pxW: di.w, pxH: di.h, widthMM: 90, marginMM: 10, holes: true, holeDiaMM: 3, label: "donut" }),
    render("legacyRunRGBA", run.sheets.map((s) => s.loops), { pxW: w, pxH: h, widthMM: oldrun.cfg.widthMM,
      marginMM: oldrun.cfg.marginMM, holes: true, holeDiaMM: 3, label: "baseline" }),
  ];
}
module.exports = { legacySvgCases };
