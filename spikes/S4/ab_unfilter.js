// spikes/S4/ab_unfilter.js — A/B the unfilter variants (naive v1, split-loop v2, per-row kernels = current png.js), interleaved.
"use strict";
require("./load.js");
const fs = require("fs"), path = require("path"), vm = require("vm");
const variants = { v1_naive: "out/png_v1_naive.js", v2_split: "out/png_v2_split.js", current_kernels: "png.js" };
const impl = {};
for (const [k, f] of Object.entries(variants)) { vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8")); impl[k] = globalThis.SBPng; }
const files = process.argv.slice(2).length ? process.argv.slice(2) : ["16mp_gray8.png", "16mp_rgba_eq.png", "8mp_gray8_adam7.png"];
(async () => {
  const res = {};
  for (let rep = 0; rep < 3; rep++) for (const f of files) {
    const b = new Uint8Array(fs.readFileSync(path.join(__dirname, "out/bench", f)));
    for (const [k, P] of Object.entries(impl)) { const t = performance.now(); await P.decode(b, { mode: "height" }); (res[f] ??= {})[k] = [...(res[f][k] || []), performance.now() - t]; }
  }
  const med = (a) => a.sort((x, y) => x - y)[1].toFixed(0);
  const t0 = performance.now(); let s = 0; for (let i = 0; i < 1e8; i++) s += i & 7; const calib = (performance.now() - t0).toFixed(0);
  console.table(Object.fromEntries(Object.entries(res).map(([f, r]) => [f, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +med(v)]))])));
  console.log("calibration: 1e8-iteration int loop =", calib, "ms (a typical unthrottled desktop core: ~100 ms)");
})();
