/* ============================================================================
 * Shadowbox Studio — test/bench.js
 * ----------------------------------------------------------------------------
 * Stage benchmarks (Node). Loads the same modules as the test suite.
 *
 *     node test/bench.js geom [--runs 15] [--json out.json] [--no-fail] [--quick]
 *     node test/bench.js large [--only id,id] [--large-runs N] [--record] [--no-fail] [--quick]
 *
 * Stage "large" (plan G2.2b; PO-LASER-4/9, NFR-03/04): the LARGE_WORKLOADS rows (SRS §12.3 calibration, 2–25 Mpx
 * realistic and busy height maps, the 470 mm-high page at 0.1 mm/px), stages 1–5 per row, final + validation per
 * mode, working set from one gc'd instrumented pass (re-execs itself with --expose-gc). --record applies the G2.2b
 * decision rule and writes docs/perf/large-image.json; without it the rows are gated against the recorded targets.
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
 *
 * Known, tracked overruns (TRACKED below) keep their budget but are reported as
 * "KNOWN-OVER (tracked)" in `knownOver` instead of `overBudget`, so they do not
 * fail the gate. KI-B1 (product-owner decision 2026-10-07): B1 keeps its 2 s
 * budget; the S6 T-split pushed p95 to ≈2.14 s, and G4.4 resolves it by
 * optimizing SBGeom normalize. Remove the entry when B1 is back under budget.
 * ==========================================================================*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");

const F = require("./fixtures.js");
const MAIN = require.main === module;
if (MAIN) {
  globalThis.crypto ??= require("crypto").webcrypto;
  for (const f of require("./modules.js").NODE_MODULES) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
  }
}

const argv = MAIN ? process.argv.slice(2) : [];
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const stage = argv[0];
const QUICK = argv.includes("--quick");
const RUNS = QUICK ? 1 : +arg("--runs", 15);
const STAGES = { geom: benchGeom, large: benchLarge };
if (MAIN && !STAGES[stage]) { console.error("usage: node test/bench.js " + Object.keys(STAGES).join("|") + " [--runs N] [--json out.json] [--no-fail] [--quick]"); process.exit(2); }

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

/**
 * Known, tracked budget overruns: the budget stays, the overrun is reported as KNOWN-OVER (tracked) with its
 * tracking reference and does not fail the gate. Remove an entry once the metric is back under budget.
 */
const TRACKED = {
  B1: {
    id: "KI-B1",
    decided: "2026-10-07 (product owner)",
    cause: "S6 T-split in SBGeom normalize (+12–18 % on B1; p95 ≈2.14 s measured)",
    resolution: "G4.4 optimizes SBGeom normalize (numeric vertex keys, skip noding without collinear contacts, normalize once per boolean)",
    ref: "docs/plans/opaque-layers-dev-plan.md Appendix C (S6 → G4.4, KI-B1) and G4.4; docs/ARCHITECTURE.md D2/D4",
  },
};

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
  const over = [], known = [];
  if (!QUICK) {
    for (const [k, r] of [["B1", report.B1_difference], ["B3", report.B3_supportPairs], ["B3b", report.B3b_supportPairs_dense]]) {
      if (r.p95Ms < BUDGET[k]) continue;
      if (TRACKED[k]) known.push({ metric: k, p95Ms: r.p95Ms, budgetMs: BUDGET[k], status: "KNOWN-OVER (tracked)", id: TRACKED[k].id, ref: TRACKED[k].ref });
      else over.push(k);
    }
  }
  report.tracked = TRACKED;
  report.knownOver = known;
  report.overBudget = over;
  return report;
}

// =========================================================================== stage "large" (G2.2b)
/**
 * Large-image benchmark (plan G2.2b; PO-LASER-4/9, NFR-03/04, AT-24). Workloads are seeded and 4:3 unless noted.
 * role: "calibration" (SRS §12.3 reference rows), "desktop" (budget candidates 16/20/25 Mpx), "mobile" (budget
 * candidates 2/4/6/8 Mpx), "exploration" (9/12 Mpx, the busy family, the 470 mm-high page). runs/warm per the plan:
 * 5 + 30 at the gated candidate points, 1 + 5 elsewhere.
 */
const LARGE_WORKLOADS = (() => {
  const W = [];
  const add = (id, w, h, family, role, layers = 8, extra = {}) => {
    const full = role === "calibration" || (family === "realistic" && (role === "mobile" || (role === "desktop" && w * h < 17e6)));
    W.push(Object.assign({ id, w, h, mpx: +(w * h / 1e6).toFixed(2), family, role, layers, warm: full ? 5 : 1, runs: full ? 30 : 5 }, extra));
  };
  add("srs-desktop", 1536, 1536, "realistic", "calibration", 8, { calibration: "SRS §12.3 desktop reference (NFR-03 10 s)" });
  add("srs-mobile", 768, 768, "realistic", "calibration", 6, { calibration: "SRS §12.3 mobile reference (8 s on device)" });
  for (const [mp, w, h] of [[2, 1633, 1225], [6, 2828, 2121], [8, 3266, 2449]]) add("r" + mp, w, h, "realistic", "mobile");
  for (const [mp, w, h] of [[4, 2309, 1732], [9, 3464, 2598], [12, 4000, 3000], [16, 4618, 3464], [20, 5164, 3873], [25, 5774, 4330]]) {
    const role = mp === 4 ? "mobile" : mp >= 16 ? "desktop" : "exploration";
    add("r" + mp, w, h, "realistic", role);
    add("b" + mp, w, h, "busy", "exploration");
  }
  const laser = { page: "470 mm high, 3:4 portrait (352.5 × 470 mm) at 0.1 mm/px, no frame", artWMM: 352.5, artHMM: 470 };
  add("laser470", 3525, 4700, "realistic", "exploration", 8, laser);
  add("laser470-busy", 3525, 4700, "busy", "exploration", 8, laser);
  return W;
})();
const LARGE = {
  seeds: { realistic: 2022, busy: 11 }, busyCellPx: 27, pitchUm: 100, tolUm: 50, minFeatureUm: 1500, advisoryFeatureUm: 2000,
  source16: [4618, 3464],
  desktop: { candidates: [16, 20, 25], wsMiB: 512, targetMs: 10000, relaxStepMs: 5000, relaxMaxMs: 60000 },
  mobile: { candidates: [2, 4, 6, 8], wsMiB: 192, targetMs: 8000, k: 4, kProvisional: true },
  perfJson: path.join(__dirname, "..", "docs", "perf", "large-image.json"),
};

function stats(t) {
  const s = t.slice().sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, p50Ms: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), maxMs: +s[s.length - 1].toFixed(1) };
}

/** One full pipeline pass over a workload; returns per-stage ms and (when mem) the peak algorithm-owned bytes. */
function largePass(wl, samples, src, mem) {
  const G = SBGeom, M = SBMaterial, R = SBRaster, N = wl.layers, w = wl.w, h = wl.h;
  const page = { artWMM: wl.artWMM || (w * LARGE.pitchUm) / 1000, artHMM: wl.artHMM || (h * LARGE.pitchUm) / 1000, frameMM: 0 };
  const t = {}, now = () => performance.now();
  const used = () => { const u = process.memoryUsage(); return u.arrayBuffers + u.heapUsed; };
  let base = 0, peak = 0;
  const sample = () => { if (mem) peak = Math.max(peak, used() - base); };
  if (mem) { global.gc(); base = used(); }
  let t0;
  // 1. resample from the 16 MP source (realistic family only; content-independent)
  if (src && w * h < src.w * src.h) {
    t0 = now(); R.resample(src.px, 1, src.w, src.h, w, h, "area"); t.resampleArea = now() - t0; sample();
    t0 = now(); R.resample(src.px, 1, src.w, src.h, w, h, "nearest"); t.resampleNearest = now() - t0; sample();
  }
  // 2. masks: the existing tonal path, and the height threshold inline (until G2.3 ships SBHeight)
  t0 = now();
  const bandMap = R.bands(samples, R.thresholds(samples, N, "balanced"));
  const tonal = R.sheetMasks(bandMap, N, w, h, false);
  t.masksTonal = now() - t0; sample();
  t0 = now();
  const masks = [new Uint8Array(w * h).fill(1)];
  for (let k = 1; k < N; k++) masks.push(new Uint8Array(w * h));
  for (let i = 0; i < samples.length; i++) {
    const a = Math.min(N - 1, Math.floor((2 * (N - 1) * samples[i] + 255) / 510));
    for (let k = 1; k <= a; k++) masks[k][i] = 1;
  }
  t.masksHeight = now() - t0; sample();
  void tonal;
  // 3. trace + fromMasks: bonded (D1: unsmoothed) and connected (G1.2 smoothing)
  t0 = now(); const bonded = M.fromMasks(masks, w, h, page, { quality: "fabrication", smooth: { mode: "bonded", tolUm: LARGE.tolUm } }); t.materialBonded = now() - t0; sample();
  t0 = now(); const connected = M.fromMasks(masks, w, h, page, { quality: "fabrication", smooth: { mode: "connected", tolUm: LARGE.tolUm } }); t.materialConnected = now() - t0; sample();
  // 4. validation: adjacent-pair difference both directions (B1 shape) and the support pass (B3b shape)
  const validate = (layers) => {
    const d0 = now();
    for (let k = 1; k < layers.length; k++) { G.difference(layers[k - 1].material, layers[k].material); G.difference(layers[k].material, layers[k - 1].material); }
    const d1 = now(); let pieces = 0, blocked = 0, narrow = 0, marginal = 0;
    for (let k = 1; k < layers.length; k++) {
      for (const piece of G.intersection(layers[k].material, layers[k - 1].material)) {
        pieces++;
        const c = G.classifyContact([piece], LARGE.minFeatureUm);
        if (c.level === "block") blocked++;
        else if (c.level === "warn") narrow++;
        else if (!G.survivesInset([piece], LARGE.advisoryFeatureUm / 2)) marginal++;
      }
    }
    sample();
    return { diffMs: d1 - d0, supportMs: now() - d1, pieces, blocked, narrow, marginal };
  };
  const vb = validate(bonded); t.diffBonded = vb.diffMs; t.supportBonded = vb.supportMs;
  const vc = validate(connected); t.diffConnected = vc.diffMs; t.supportConnected = vc.supportMs;
  // 5. packaging proxy: layerSVG + layer hashing (bonded)
  t0 = now();
  const pg = M.page(page);
  let bytes = 0; for (const l of bonded) bytes += SBSvg.layerSVG(l, pg).length;
  for (const l of bonded) G.layerHashes(l);
  t.package = now() - t0; sample();
  t.finalBonded = t.materialBonded + t.diffBonded + t.supportBonded;
  t.finalConnected = t.materialConnected + t.diffConnected + t.supportConnected;
  t.final = Math.max(t.finalBonded, t.finalConnected);
  const verts = (L) => L.reduce((s, l) => s + l.stats.vertices, 0);
  const shape = {
    partsPerLayer: bonded.map((l) => l.parts.length), verticesBonded: verts(bonded), verticesConnected: verts(connected),
    maxPartsPerLayer: Math.max(...bonded.map((l) => l.parts.length)), maxVerticesPerLayer: Math.max(...bonded.map((l) => l.stats.vertices)),
    supportPieces: vb.pieces, contacts: { blocked: vb.blocked, narrow: vb.narrow, marginal: vb.marginal }, svgBytes: bytes,
  };
  return { t, shape, peakBytes: mem ? peak : null };
}

function benchLarge() {
  const only = arg("--only") ? arg("--only").split(",") : null;
  const div = QUICK ? 8 : 1;
  const list = LARGE_WORKLOADS.filter((wl) => !only || only.includes(wl.id))
    .map((wl) => arg("--large-runs") ? Object.assign({}, wl, { warm: 1, runs: +arg("--large-runs"), runsOverridden: true }) : wl)
    .map((wl) => QUICK ? Object.assign({}, wl, { w: Math.max(64, Math.round(wl.w / div)), h: Math.max(64, Math.round(wl.h / div)), warm: 0, runs: 1, artWMM: undefined, artHMM: undefined }) : wl);
  const os = require("os");
  const report = { stage: "large", quick: QUICK, node: process.version, v8: process.versions.v8, cpu: os.cpus()[0].model, threads: os.cpus().length,
    memGiB: +(os.totalmem() / 2 ** 30).toFixed(1), backend: SBGeom.backend, loadAvgStart: os.loadavg().map((x) => +x.toFixed(2)), rows: [] };
  const [sw, sh] = QUICK ? [Math.round(LARGE.source16[0] / div), Math.round(LARGE.source16[1] / div)] : LARGE.source16;
  const src = { w: sw, h: sh, px: F.heightMap(LARGE.seeds.realistic, sw, sh) };
  for (const wl of list) {
    const t0 = performance.now();
    const samples = wl.family === "busy" ? F.busyHeightMap(LARGE.seeds.busy, wl.w, wl.h, LARGE.busyCellPx) : F.heightMap(LARGE.seeds.realistic, wl.w, wl.h);
    const memPass = largePass(wl, samples, wl.family === "realistic" ? src : null, true);
    for (let i = 0; i < wl.warm; i++) largePass(wl, samples, wl.family === "realistic" ? src : null, false);
    const runs = [];
    for (let i = 0; i < wl.runs; i++) runs.push(largePass(wl, samples, wl.family === "realistic" ? src : null, false).t);
    const st = {};
    for (const k of Object.keys(runs[0])) st[k] = stats(runs.map((r) => r[k]));
    const row = Object.assign({}, wl, { stages: st, shape: memPass.shape, workingSetMiB: +(memPass.peakBytes / 2 ** 20).toFixed(1),
      wallS: +((performance.now() - t0) / 1000).toFixed(1), loadAvg: os.loadavg().map((x) => +x.toFixed(2)) });
    report.rows.push(row);
    console.error(`[large] ${wl.id} ${wl.w}×${wl.h} ${wl.family}: final p95 ${st.final.p95Ms} ms (bonded ${st.finalBonded.p95Ms}, connected ${st.finalConnected.p95Ms}), ws ${row.workingSetMiB} MiB, parts ≤${row.shape.maxPartsPerLayer}/layer, ${row.wallS} s wall`);
  }
  report.loadAvgEnd = os.loadavg().map((x) => +x.toFixed(2));
  if (QUICK) { report.overBudget = []; return report; }

  // Merge with the recorded rows (an --only run updates just its rows), then decide or gate.
  const prev = fs.existsSync(LARGE.perfJson) ? JSON.parse(fs.readFileSync(LARGE.perfJson, "utf8")) : null;
  const byId = new Map((prev ? prev.rows : []).map((r) => [r.id, r]));
  for (const r of report.rows) byId.set(r.id, r);
  const rows = LARGE_WORKLOADS.map((wl) => byId.get(wl.id)).filter(Boolean);
  const ref = byId.get("srs-desktop");
  for (const r of rows) r.xRef = ref ? +(r.stages.final.p95Ms / ref.stages.final.p95Ms).toFixed(2) : null;
  const record = argv.includes("--record");
  const decision = record ? decideLarge(byId) : prev && prev.decision;
  const merged = Object.assign({}, prev || {}, report, { rows, decision, method: LARGE_METHOD });
  if (record) { fs.mkdirSync(path.dirname(LARGE.perfJson), { recursive: true }); fs.writeFileSync(LARGE.perfJson, JSON.stringify(merged, null, 1) + "\n"); }
  report.decision = decision;
  report.overBudget = gateLarge(byId, decision);
  report.rows = report.rows.map((r) => ({ id: r.id, finalP95Ms: r.stages.final.p95Ms, workingSetMiB: r.workingSetMiB, xRef: r.xRef }));
  return report;
}

const LARGE_METHOD = {
  final: "final + validation = stage 3 (trace + SBMaterial.fromMasks, fabrication quality) + stage 4 (adjacent-pair difference ×2 directions, support pass: one layer-level intersection per adjacent pair, classifyContact(piece, minFeature) then survivesInset(advisory/2) per piece), timed per run for bonded (D1 unsmoothed) and connected (G1.2 smoothing); the gated value is max(bonded, connected) per run",
  workingSet: "one instrumented pass per row after gc(): peak of process.memoryUsage() arrayBuffers + heapUsed minus the pre-pipeline baseline, sampled after every stage (algorithm-owned, SRS §12.3); the input samples are outside it",
  desktopRule: "largest of 16/20/25 Mpx (realistic) with working set ≤ 512 MiB and final p95 ≤ target; target 10 s if 16 Mpx meets it, else 16 Mpx p95 rounded up to 5 s (≤ 60 s, else escalate)",
  mobileRule: "largest of 2/4/6/8 Mpx (realistic) with working set ≤ 192 MiB and desktop final p95 × k ≤ 8 s; k = 4 provisional until the ≥ 4 GB reference device (G4.4)",
  stages: "1 resample area/nearest from a 16 MP source (realistic rows smaller than it); 2 masks tonal (R.thresholds/bands/sheetMasks) and height (inline nearest-layer rule); 3 material bonded/connected; 4 difference + support; 5 layerSVG + layerHashes",
};

function decideLarge(byId) {
  const p95 = (id) => byId.get(id).stages.final.p95Ms, ws = (id) => byId.get(id).workingSetMiB;
  const D = LARGE.desktop, Mo = LARGE.mobile, escalate = [];
  if (ws("r16") > D.wsMiB) escalate.push(`16 Mpx working set ${ws("r16")} MiB > ${D.wsMiB} MiB`);
  let target = D.targetMs, relaxed = false;
  if (p95("r16") > D.targetMs) { relaxed = true; target = Math.ceil(p95("r16") / D.relaxStepMs) * D.relaxStepMs; }
  if (target > D.relaxMaxMs) escalate.push(`relaxed desktop target ${target} ms > ${D.relaxMaxMs} ms`);
  let dMp = 16;
  for (const mp of D.candidates) if (byId.has("r" + mp) && ws("r" + mp) <= D.wsMiB && p95("r" + mp) <= target) dMp = Math.max(dMp, mp);
  let mMp = null;
  for (const mp of Mo.candidates) if (byId.has("r" + mp) && ws("r" + mp) <= Mo.wsMiB && p95("r" + mp) * Mo.k <= Mo.targetMs) mMp = mp;
  if (mMp === null) escalate.push("no mobile candidate ≥ 2 Mpx qualifies");
  const cx = (id) => { const r = byId.get(id); return r ? { maxPartsPerLayer: r.shape.maxPartsPerLayer, maxVerticesPerLayer: r.shape.maxVerticesPerLayer, vertices: r.shape.verticesBonded } : null; };
  return {
    desktop: { fabPxBudget: dMp * 1e6, row: "r" + dMp, targetMs: target, relaxed, relaxedAppliesTo: relaxed ? "fabrication generation of workloads larger than the SRS §12.3 reference" : null,
      p95Ms: p95("r" + dMp), workingSetMiB: ws("r" + dMp), r16P95Ms: p95("r16") },
    mobile: mMp === null ? null : { fabPxBudget: mMp * 1e6, row: "r" + mMp, targetMs: Mo.targetMs, k: Mo.k, kProvisional: Mo.kProvisional,
      desktopP95Ms: p95("r" + mMp), p95Ms: +(p95("r" + mMp) * Mo.k).toFixed(1), workingSetMiB: ws("r" + mMp) },
    srsDesktop: { targetMs: 10000, p95Ms: p95("srs-desktop") },
    complexityStart: { desktop: cx("r" + dMp), desktopBusy: cx("b" + dMp), mobile: mMp ? cx("r" + mMp) : null, mobileBusy: mMp ? cx("b" + mMp) : null },
    escalate,
  };
}

/** Gated rows: the desktop and mobile budget rows (realistic) and the SRS desktop reference. Returns the failures. */
function gateLarge(byId, d) {
  if (!d) return ["no recorded decision (run with --record)"];
  const over = [...(d.escalate || [])];
  const chk = (id, scale, target, label) => { const r = byId.get(id); if (!r) { over.push(label + ": row " + id + " not measured"); return; }
    const v = r.stages.final.p95Ms * scale; if (v > target) over.push(`${label}: ${id} p95 ${v.toFixed(0)} ms > ${target} ms`); };
  chk(d.desktop.row, 1, d.desktop.targetMs, "desktop");
  if (d.mobile) chk(d.mobile.row, d.mobile.k, d.mobile.targetMs, "mobile (scaled)");
  chk("srs-desktop", 1, d.srsDesktop.targetMs, "SRS desktop reference");
  return over;
}

function main() {
  if (stage === "large" && typeof global.gc !== "function") { // the working-set pass needs gc()
    const r = require("child_process").spawnSync(process.execPath, ["--expose-gc", __filename, ...argv], { stdio: "inherit" });
    process.exit(r.status === null ? 1 : r.status);
  }
  const report = STAGES[stage]();
  report.heapUsedMB = +(process.memoryUsage().heapUsed / 1048576).toFixed(0);
  report.rssMB = +(process.memoryUsage().rss / 1048576).toFixed(0);
  for (const [k, v] of Object.entries(report)) console.log(k + ":", JSON.stringify(v));
  for (const k of report.knownOver || []) console.warn(`${k.metric} KNOWN-OVER (tracked ${k.id}): p95 ${k.p95Ms} ms ≥ budget ${k.budgetMs} ms — not failing the gate; see ${k.ref}`);
  const out = arg("--json");
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
  if (report.overBudget && report.overBudget.length && !argv.includes("--no-fail")) {
    console.error("over budget: " + report.overBudget.join(", "));
    process.exit(1);
  }
}
module.exports = { LARGE_WORKLOADS };
if (MAIN) main();
