// spikes/S4/fuzz.js — mutation fuzz (AT-22 robustness): every outcome must be success or an Error with a known .code;
// never an uncoded exception, hang or out-of-range read. node spikes/S4/fuzz.js [iterations]
"use strict";
require("./load.js");
const F = require("../../test/fixtures.js"), E = require("./enc.js");
const KNOWN = new Set(["PNG_16BIT", "PNG_APNG", "PNG_CRC", "PNG_TRUNCATED", "PNG_UNEQUAL_RGB", "PNG_PALETTE", "PNG_SIGNATURE", "PNG_BITDEPTH", "PNG_HEADER", "PNG_INFLATE", "PNG_TOO_LARGE"]);
const rng = F.lcg(2026), R = (n) => (rng() * n) | 0, ITER = +process.argv[2] || 3000;
const g = Uint8Array.from({ length: 31 * 17 * 4 }, () => R(256));
const seeds = [E.encode({ w: 31, h: 17, colorType: 0, data: g.subarray(0, 527), filter: (y) => y % 5 }),
  E.encode({ w: 31, h: 17, colorType: 6, data: g, interlace: 1, filter: (y) => y % 5 }),
  E.encode({ w: 31, h: 17, colorType: 3, bitDepth: 4, data: g.subarray(0, 527).map((v) => v & 15), plte: Array.from({ length: 48 }, (_, i) => (i / 3) * 17 | 0), trns: [1, 2, 3] })];
(async () => {
  const tally = {}; let uncoded = 0; const t0 = performance.now();
  for (let it = 0; it < ITER; it++) {
    const b = Uint8Array.from(seeds[it % seeds.length]); const kind = it % 4;
    if (kind === 0) for (let k = 0; k <= R(4); k++) b[8 + R(b.length - 8)] ^= 1 << R(8);           // bit flips anywhere after signature
    else if (kind === 1) { const cut = 8 + R(b.length - 8); tally.trunc = (tally.trunc || 0) + 1; await run(b.subarray(0, cut)); continue; }
    else if (kind === 2) b[16 + R(13)] = R(256);                                                      // IHDR field garbage
    else for (let k = 0; k <= R(8); k++) b[33 + R(b.length - 45)] = R(256);                            // IDAT/body bytes
    await run(b);
  }
  async function run(b) {
    for (const verifyCrc of [true, false]) {
      try { await SBPng.decode(b, { mode: "tonal", verifyCrc }); tally.ok = (tally.ok || 0) + 1; }
      catch (e) { if (KNOWN.has(e.code)) tally[e.code] = (tally[e.code] || 0) + 1; else { uncoded++; if (uncoded < 5) console.error("UNCODED:", e && e.stack); } }
    }
  }
  console.log(JSON.stringify({ iterations: ITER, decodesAttempted: ITER * 2, uncoded, ms: Math.round(performance.now() - t0), tally }));
  process.exitCode = uncoded ? 1 : 0;
})();
