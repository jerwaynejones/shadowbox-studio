/* ============================================================================
 * Shadowbox Studio — test/bench.js
 * ----------------------------------------------------------------------------
 * Stage benchmarks (Node). Loads the same modules as the test suite.
 *
 *     node test/bench.js geom [--runs 15] [--json out.json] [--no-fail] [--quick]
 *
 * Stage "geom" (spike S1, decision D2) — page 1536×1024 px at 200 µm/px:
 *   B1   8 layers × ~50k vertices, difference of every ADJACENT layer pair in
 *        both directions (7 pairs × 2 = 14 differences per run)  budget p95 < 2 s
 *   B2   offset −1500 µm and +300 µm (miter) on all 8 B1 layers     reported only
 *   B3   support pairs on randomNestedStack(lcg(1), 1536, 1024, 8)  budget p95 < 3 s
 *        (that stack has material only in layers 0–2, so B3 is light)
 *   B3b  the same support pass on the dense B1 stack (~3.4k pairs)   provisional
 *        budget p95 < 6 s; G2.7 must bring it under the B3 budget
 * Support pass (layer level, never per part pair): containment
 * isEmpty(L_k − L_(k−1)), then one intersection(L_k, L_(k−1)) per adjacent
 * pair, each piece attributed to its smallest containing part on both layers.
 *
 * --quick shrinks the page to 192×128 px and runs once (smoke test only; its
 * timings are not comparable and budgets are not enforced). Without --no-fail
 * the process exits 1 when a budget is exceeded.
 * ==========================================================================*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");

globalThis.crypto ??= require("crypto").webcrypto;
for (const f of require("./modules.js").NODE_MODULES) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
}
const F = require("./fixtures.js");

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const stage = argv[0];
const QUICK = argv.includes("--quick");
const RUNS = QUICK ? 1 : +arg("--runs", 15);
const STAGES = { geom: benchGeom };
if (!STAGES[stage]) { console.error("usage: node test/bench.js " + Object.keys(STAGES).join("|") + " [--runs N] [--json out.json] [--no-fail] [--quick]"); process.exit(2); }

function timeRuns(fn, runs, warm) {
  for (let i = 0; i < warm; i++) fn();
  const t = [];
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); }
  const s = t.slice().sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { runs, minMs: +s[0].toFixed(1), medianMs: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), maxMs: +s[s.length - 1].toFixed(1) };
}

/** Seeded 3-octave value noise, quantile-thresholded into N nested masks (a quantized height map). */
function noiseStack(seed, w, h, N, cell) {
  const rng = F.lcg(seed), f = new Float64Array(w * h);
  for (const [sp, amp] of [[cell, 1], [cell / 2.5, 0.45], [cell / 6, 0.2]]) {
    const gw = Math.ceil(w / sp) + 2, gh = Math.ceil(h / sp) + 2, g = new Float64Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = x / sp, gy = y / sp, ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy;
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      f[y * w + x] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
    }
  }
  const sorted = Float64Array.from(f).sort(), out = [];
  for (let k = 0; k < N; k++) {
    const t = sorted[Math.floor(((k + 1) / (N + 2)) * f.length)], m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = f[i] >= t ? 1 : 0;
    out.push(m);
  }
  return out;
}

/** Exact point-in-ring: -1 outside, 0 on boundary, 1 inside. */
function pointInRing(px, py, r) {
  const n = r.length; let wn = 0;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n, ax = r[i], ay = r[i + 1], bx = r[j], by = r[j + 1];
    const cr = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
    if (cr === 0 && px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)) return 0;
    if (ay <= py) { if (by > py && cr > 0) wn++; } else if (by <= py && cr < 0) wn--;
  }
  return wn !== 0 ? 1 : -1;
}

function benchGeom() {
  const G = SBGeom, T = SBTrace;
  const W = QUICK ? 192 : 1536, H = QUICK ? 128 : 1024, SX = 200, SY = 200, CELL = QUICK ? 9 : 27;
  const BUDGET = { B1: 2000, B3: 3000, B3b: 6000 };
  const verts = (polys) => polys.reduce((s, p) => s + p.outer.length / 2 + p.holes.reduce((t, h) => t + h.length / 2, 0), 0);
  const layersOf = (masks) => masks.map((m) => G.union(G.fromPixelLoops(T.trace(m, W, H), SX, SY, 0, 0), []));
  const report = { stage: "geom", backend: G.backend, node: process.version, quick: QUICK, runs: RUNS, page: { w: W, h: H, sxUm: SX, syUm: SY }, budgetsMs: BUDGET };

  // ------------------------------------------------------------------ B1 / B2
  const masks = noiseStack(11, W, H, 8, CELL);
  let t0 = performance.now();
  const L = layersOf(masks);
  report.inputB1 = { generator: `noiseStack(seed 11, ${W}×${H}, 8 layers, cell ${CELL})`, vertices: L.map(verts), parts: L.map((l) => l.length),
    traceAndNormalizeMs: +(performance.now() - t0).toFixed(0) };
  report.sanityB1 = { contained: L.every((l, k) => k === 0 || G.isEmpty(G.difference(l, L[k - 1]))),
    areasExact: L.every((l, k) => G.area(l) === masks[k].reduce((a, b) => a + b, 0) * SX * SY) };
  let resVerts = 0;
  report.B1_difference = timeRuns(() => {
    resVerts = 0;
    for (let k = 1; k < L.length; k++) { resVerts += verts(G.difference(L[k - 1], L[k])); G.difference(L[k], L[k - 1]); }
  }, RUNS, QUICK ? 0 : 2);
  report.B1_difference.ops = "7 adjacent layer pairs × 2 directions = 14 differences per run";
  report.B1_difference.resultVertices = resVerts;
  const sub = Math.max(QUICK ? 1 : 5, Math.floor(RUNS / 2));
  report.B2_offset_inset1500 = timeRuns(() => { for (const l of L) G.offset(l, -1500, "miter"); }, sub, QUICK ? 0 : 1);
  report.B2_offset_grow300 = timeRuns(() => { for (const l of L) G.offset(l, 300, "miter"); }, sub, QUICK ? 0 : 1);

  // ------------------------------------------------------------------ support pass (B3 / B3b)
  const partsOf = (S) => S.map((l) => G.components(l).map((c) => ({ poly: c[0], bb: G.bbox(c[0]), a: G.area([c[0]]) })));
  function owner(piece, parts) {
    const r = piece.outer, bb = G.bbox(piece); let best = null, bestA = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.bb[0] > bb[0] || p.bb[1] > bb[1] || p.bb[2] < bb[2] || p.bb[3] < bb[3] || p.a >= bestA) continue;
      const o2 = p.o2 || (p.o2 = p.poly.outer.map((v) => v * 2));
      let inside = true;
      for (let j = 0; j < r.length; j += 2) { // doubled vertices / edge midpoints until one is off the boundary
        const t = (j + 2) % r.length;
        const s = pointInRing(r[j] + r[t], r[j + 1] + r[t + 1], o2); if (s !== 0) { inside = s > 0; break; }
      }
      if (inside) { best = i; bestA = p.a; }
    }
    return best;
  }
  let pairs = 0, contained = true;
  function supportPairs(S, given) {
    pairs = 0; contained = true;
    const parts = given || partsOf(S);
    for (let k = 1; k < S.length; k++) {
      if (!G.isEmpty(G.difference(S[k], S[k - 1]))) contained = false;
      const seen = new Set();
      for (const piece of G.intersection(S[k], S[k - 1])) {
        const a = owner(piece, parts[k]), b = owner(piece, parts[k - 1]);
        if (a !== null && b !== null) seen.add(a + ":" + b);
      }
      pairs += seen.size;
    }
  }
  const S = layersOf(F.randomNestedStack(F.lcg(1), W, H, 8));
  report.inputB3 = { generator: `randomNestedStack(lcg(1), ${W}, ${H}, 8)`, vertices: S.map(verts) };
  report.B3_supportPairs = timeRuns(() => supportPairs(S), sub, QUICK ? 0 : 1);
  Object.assign(report.B3_supportPairs, { pairs, contained });
  const b3bRuns = QUICK ? 1 : Math.max(3, Math.floor(RUNS / 3));
  report.B3b_supportPairs_dense = timeRuns(() => supportPairs(L), b3bRuns, QUICK ? 0 : 1);
  Object.assign(report.B3b_supportPairs_dense, { pairs, contained });
  const P = partsOf(L); // parts exist as MaterialLayer.parts in the product (G1.1)
  report.B3b_supportPairs_dense_partsGiven = timeRuns(() => supportPairs(L, P), b3bRuns, QUICK ? 0 : 1);
  report.B3b_supportPairs_dense_partsGiven.pairs = pairs;

  report.fingerprintB1 = require("crypto").createHash("sha256").update(JSON.stringify([G.difference(L[0], L[1]), G.offset(L[2], -1500, "miter")])).digest("hex");
  const over = [];
  if (!QUICK) {
    if (report.B1_difference.p95Ms >= BUDGET.B1) over.push("B1");
    if (report.B3_supportPairs.p95Ms >= BUDGET.B3) over.push("B3");
    if (report.B3b_supportPairs_dense.p95Ms >= BUDGET.B3b) over.push("B3b");
  }
  report.overBudget = over;
  return report;
}

const report = STAGES[stage]();
report.heapUsedMB = +(process.memoryUsage().heapUsed / 1048576).toFixed(0);
report.rssMB = +(process.memoryUsage().rss / 1048576).toFixed(0);
for (const [k, v] of Object.entries(report)) console.log(k + ":", JSON.stringify(v));
const out = arg("--json");
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
if (report.overBudget && report.overBudget.length && !argv.includes("--no-fail")) {
  console.error("over budget: " + report.overBudget.join(", "));
  process.exit(1);
}
