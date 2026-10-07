// spikes/S4/bench_node.js — node --expose-gc spikes/S4/bench_node.js
"use strict";
require("./load.js"); require("./bench_core.js");
const fs = require("fs"), path = require("path");
const D = path.join(__dirname, "out", "bench");
(async () => {
  const files = fs.readdirSync(D).filter((f) => f.endsWith(".png")).sort().map((name) => ({ name, bytes: new Uint8Array(fs.readFileSync(path.join(D, name))) }));
  const rows = await SBPngBench.run(files, { log: (r) => console.error(r.name, r.decodeMs, "ms") });
  // peak memory of one decode, in isolation
  const mem = [];
  for (const name of ["16mp_gray8.png", "16mp_rgba_eq.png", "25mib_rgba_noise.png"]) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(D, name)));
    global.gc && global.gc(); const base = process.memoryUsage();
    let peakAB = 0, peakRss = 0; const iv = setInterval(() => { const m = process.memoryUsage(); peakAB = Math.max(peakAB, m.arrayBuffers); peakRss = Math.max(peakRss, m.rss); }, 1);
    const r = await SBPng.decode(bytes, { mode: "height" }); clearInterval(iv);
    const m = process.memoryUsage(); peakAB = Math.max(peakAB, m.arrayBuffers); peakRss = Math.max(peakRss, m.rss);
    mem.push({ name, fileMiB: +(bytes.length / 1048576).toFixed(1), resultMiB: +((r.samples.length + (r.alpha ? r.alpha.length : 0)) / 1048576).toFixed(1),
      peakArrayBuffersOverBaseMiB: +((peakAB - base.arrayBuffers) / 1048576).toFixed(1), peakRssOverBaseMiB: +((peakRss - base.rss) / 1048576).toFixed(1) });
  }
  console.table(rows); console.table(mem);
  fs.writeFileSync(path.join(__dirname, "out", "bench_node.json"), JSON.stringify({ node: process.version, rows, mem }, null, 1));
})();
