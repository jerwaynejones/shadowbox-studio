/* spikes/S1/bench.js — S1 benchmarks (plan Task S1 Step 2), one candidate per process.
 *   node spikes/S1/bench.js clipper|lattice [--runs 15] [--json out.json]
 * B1  8 layers × ~50k vertices: pairwise (adjacent) difference, both directions   target p95 < 2 s
 * B2  offset at the same size (−1500 µm and +300 µm, miter) on all 8 layers         (reported; no target)
 * B3  SBSupport-style support pairs on randomNestedStack(lcg(1), 1536, 1024, 8)     target p95 < 3 s
 * B4  (clipper only) B1 on smoothed (RDP 0.5 px + Chaikin ×2) non-orthogonal layers (bonded smoothing)
 * Lattice 1536×1024 px at 200 µm/px (307.2 × 204.8 mm page).
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { performance } = require("perf_hooks");
const ROOT = path.join(__dirname, "..", "..");
const F = require(path.join(ROOT, "test", "fixtures.js"));
const FILES = {
  clipper: ["spikes/S1/vendor/clipper2.js", "spikes/S1/geom_core.js", "spikes/S1/geom_clipper.js"],
  lattice: ["spikes/S1/geom_core.js", "spikes/S1/geom_lattice.js"],
};
const name = process.argv[2]; if (!FILES[name]) { console.error("usage: bench.js clipper|lattice"); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = +arg("--runs", 15);
for (const f of ["js/util.js", "js/trace.js"].concat(FILES[name])) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
const G = globalThis.SBGeom, T = globalThis.SBTrace;
const W = 1536, H = 1024, SX = 200, SY = 200;

// ---------------------------------------------------------------- inputs
/** Seeded two-octave value noise, quantile-thresholded into 8 nested masks (a quantized height map). */
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
    for (let i = 0; i < m.length; i++) m[i] = f[i] >= t ? 1 : 0; out.push(m);
  }
  return out;
}
const verts = (polys) => polys.reduce((s, p) => s + p.outer.length / 2 + p.holes.reduce((t, h) => t + h.length / 2, 0), 0);
function layersFrom(masks, smooth) {
  return masks.map((m) => {
    let loops = T.trace(m, W, H);
    if (smooth) loops = loops.map((L) => T.chaikin(T.simplify(L, 0.5), 2));
    return G.union(G.fromPixelLoops(loops, SX, SY, 0, 0), []);
  });
}
function timeRuns(fn, runs, warm = 2) {
  for (let i = 0; i < warm; i++) fn();
  const t = [];
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); t.push(performance.now() - t0); }
  const s = t.slice().sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { runs, minMs: +s[0].toFixed(1), medianMs: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), maxMs: +s[s.length - 1].toFixed(1) };
}

const report = { candidate: name, backend: G.backend, node: process.version, runs: RUNS, page: { w: W, h: H, sxUm: SX, syUm: SY } };
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- B1 / B2
let t0 = performance.now();
const masks = noiseStack(11, W, H, 8, 27);
const tGen = performance.now() - t0; t0 = performance.now();
const L = layersFrom(masks, false);
const tPrep = performance.now() - t0;
report.inputB1 = { generator: "noiseStack(seed 11, 1536×1024, 8 layers, cell 27)", vertices: L.map(verts), parts: L.map((l) => l.length), holes: L.map((l) => l.reduce((s, p) => s + p.holes.length, 0)), genMs: +tGen.toFixed(0), traceAndNormalizeMs: +tPrep.toFixed(0) };
log("B1 input vertices per layer:", report.inputB1.vertices.join(", "), " trace+fromPixelLoops+union:", tPrep.toFixed(0), "ms");

// sanity: nested → L_k − L_(k−1) must be empty and areas must equal pixel counts
report.sanityB1 = { contained: L.every((l, k) => k === 0 || G.isEmpty(G.difference(l, L[k - 1]))),
  areasExact: L.every((l, k) => G.area(l) === masks[k].reduce((a, b) => a + b, 0) * SX * SY) };
log("B1 sanity:", JSON.stringify(report.sanityB1));

let resVerts = 0;
report.B1_difference = timeRuns(() => { resVerts = 0; for (let k = 1; k < 8; k++) { resVerts += verts(G.difference(L[k - 1], L[k])); G.difference(L[k], L[k - 1]); } }, RUNS);
report.B1_difference.ops = "7 adjacent pairs × 2 directions = 14 differences per run"; report.B1_difference.resultVertices = resVerts;
log("B1 difference:", JSON.stringify(report.B1_difference));

const one = timeRuns(() => G.difference(L[3], L[4]), RUNS);
report.B1_singleDifference = one; log("B1 single difference L3−L4:", JSON.stringify(one));

report.B2_offset_inset1500 = timeRuns(() => { for (const l of L) G.offset(l, -1500, "miter"); }, Math.max(5, Math.floor(RUNS / 2)));
log("B2 offset −1500 miter ×8:", JSON.stringify(report.B2_offset_inset1500));
report.B2_offset_grow300 = timeRuns(() => { for (const l of L) G.offset(l, 300, "miter"); }, Math.max(5, Math.floor(RUNS / 2)));
log("B2 offset +300 miter ×8:", JSON.stringify(report.B2_offset_grow300));

t0 = performance.now(); const v = G.validate(L[3]); report.validate50k = { ms: +(performance.now() - t0).toFixed(0), ok: v.ok, vertices: verts(L[3]) };
log("validate one layer:", JSON.stringify(report.validate50k));

// determinism fingerprint (compared across runtimes in det.js)
const crypto = require("crypto");
report.fingerprintB1 = crypto.createHash("sha256").update(JSON.stringify([G.difference(L[0], L[1]), G.offset(L[2], -1500, "miter")])).digest("hex");

// ---------------------------------------------------------------- B3 support pairs
t0 = performance.now();
const st = F.randomNestedStack(F.lcg(1), W, H, 8);
const tGen3 = performance.now() - t0; t0 = performance.now();
const S = st.map((m) => G.union(G.fromPixelLoops(T.trace(m, W, H), SX, SY, 0, 0), []));
const tPrep3 = performance.now() - t0;
report.inputB3 = { generator: "randomNestedStack(lcg(1), 1536, 1024, 8)", vertices: S.map(verts), parts: S.map((l) => l.length), genMs: +tGen3.toFixed(0), traceAndNormalizeMs: +tPrep3.toFixed(0) };
log("B3 input vertices per layer:", report.inputB3.vertices.join(", "), " trace+normalize:", tPrep3.toFixed(0), "ms");
let pairs = 0, contained = true;
/** naive: one intersection per bbox-overlapping part pair (what a literal "SBSupport-style" loop does). */
function supportPairsNaive(S) {
  pairs = 0; contained = true;
  const parts = S.map((l) => G.components(l).map((c) => ({ poly: c[0], bb: G.bbox(c[0]) })));
  for (let k = 1; k < S.length; k++) {
    if (!G.isEmpty(G.difference(S[k], S[k - 1]))) contained = false;           // SUP: containment
    for (const p of parts[k]) for (const q of parts[k - 1]) {                     // support graph edges
      if (p.bb[2] <= q.bb[0] || q.bb[2] <= p.bb[0] || p.bb[3] <= q.bb[1] || q.bb[3] <= p.bb[1]) continue;
      if (G.area(G.intersection([p.poly], [q.poly])) > 0) pairs++;
    }
  }
}
/** layer-level: one intersection per adjacent layer pair, pieces attributed to parts by smallest containing outer. */
function owner(piece, parts) {
  const C = globalThis.SBGeomCore, r = piece.outer, bb = G.bbox(piece); let best = null, bestA = Infinity;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.bb[0] > bb[0] || p.bb[1] > bb[1] || p.bb[2] < bb[2] || p.bb[3] < bb[3] || p.a >= bestA) continue;
    const o2 = p.o2 || (p.o2 = p.poly.outer.map((v) => v * 2));
    let inside = true;
    for (let j = 0; j < r.length; j += 2) { const t = (j + 2) % r.length;
      let s = C.pointInRing(r[j] + r[t], r[j + 1] + r[t + 1], o2); if (s !== 0) { inside = s > 0; break; } }
    if (inside) { best = i; bestA = p.a; }
  }
  return best;
}
const partsOf = (S) => S.map((l) => G.components(l).map((c) => ({ poly: c[0], bb: G.bbox(c[0]), a: G.area([c[0]]) })));
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
report.B3_supportPairs = timeRuns(() => supportPairs(S), Math.max(5, Math.floor(RUNS / 2)), 1);
report.B3_supportPairs.pairs = pairs; report.B3_supportPairs.contained = contained;
report.B3_supportPairs.includingTraceMsP95 = +(report.B3_supportPairs.p95Ms + tPrep3).toFixed(1);
report.B3_supportPairs.algorithm = "layer-level intersection + piece→part attribution";
report.B3_supportPairs_naive = timeRuns(() => supportPairsNaive(S), Math.max(5, Math.floor(RUNS / 2)), 1);
report.B3_supportPairs_naive.pairs = pairs;
log("B3 support pairs (naive per-part-pair):", JSON.stringify(report.B3_supportPairs_naive));
log("B3 support pairs:", JSON.stringify(report.B3_supportPairs));

// B3b (extra): the same support-pair pass on the dense B1 noise stack — the plan's B3 stack is nearly empty
// above layer 2 (randomNestedStack ANDs random discs, so layers 3–7 have no material).
report.B3b_supportPairs_dense = timeRuns(() => supportPairs(L), 3, 1);
report.B3b_supportPairs_dense.pairs = pairs; report.B3b_supportPairs_dense.contained = contained;
log("B3b support pairs (dense noise stack):", JSON.stringify(report.B3b_supportPairs_dense));
{ const P = partsOf(L); // parts already exist as MaterialLayer.parts in the product (G1.1), so time only the support pass
  report.B3b_supportPairs_dense_partsGiven = timeRuns(() => supportPairs(L, P), 3, 1);
  report.B3b_supportPairs_dense_partsGiven.pairs = pairs;
  log("B3b support pairs, parts precomputed:", JSON.stringify(report.B3b_supportPairs_dense_partsGiven)); }
if (!process.argv.includes("--skip-naive-dense")) {
  report.B3b_supportPairs_dense_naive = timeRuns(() => supportPairsNaive(L), 1, 0);
  report.B3b_supportPairs_dense_naive.pairs = pairs;
  log("B3b naive (1 run):", JSON.stringify(report.B3b_supportPairs_dense_naive));
}

// ---------------------------------------------------------------- B4 smoothed (clipper only)
if (name === "clipper") {
  t0 = performance.now(); const Ls = layersFrom(masks, true); const tp = performance.now() - t0;
  report.inputB4 = { smoothing: "SBTrace.simplify(0.5 px) + SBTrace.chaikin(2), rounded to µm", vertices: Ls.map(verts), traceSmoothNormalizeMs: +tp.toFixed(0) };
  log("B4 input vertices:", report.inputB4.vertices.join(", "));
  report.B4_difference_smoothed = timeRuns(() => { for (let k = 1; k < 8; k++) { G.difference(Ls[k - 1], Ls[k]); G.difference(Ls[k], Ls[k - 1]); } }, RUNS);
  log("B4 smoothed difference:", JSON.stringify(report.B4_difference_smoothed));
  report.B4_validate = G.validate(G.difference(Ls[2], Ls[3])).ok;
}
report.heapUsedMB = +(process.memoryUsage().heapUsed / 1048576).toFixed(0);
report.rssMB = +(process.memoryUsage().rss / 1048576).toFixed(0);
log("memory:", report.heapUsedMB, "MB heap,", report.rssMB, "MB rss");
const j = arg("--json"); if (j) fs.writeFileSync(j, JSON.stringify(report, null, 1));
