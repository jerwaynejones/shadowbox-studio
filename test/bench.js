/* ============================================================================
 * Shadowbox Studio — test/bench.js
 * ----------------------------------------------------------------------------
 * Stage benchmarks (Node). Loads the same modules as the test suite.
 *
 *     node test/bench.js geom [--runs 15] [--json out.json] [--no-fail] [--quick]
 *     node test/bench.js large [--only id,id] [--large-runs N] [--record] [--no-fail] [--quick]
 *     node test/bench.js large-assemble --logs f.log=log,g.log=live [--env run.json] [--loads l.txt=label,…] [--record]
 *     node test/bench.js large --only b4,b9,r25 --caps desktop [--simplify busy] [--bonded-only] [--record]
 *     node test/bench.js caps [--large-runs N] [--record] [--quick]
 *
 * G2.7b (complexity caps, SRS §12.3; PO-LASER-9): `large` with --caps <desktop|mobile> runs SBConstruct.complexityGate
 * (pre-trace parts cap; --simplify busy applies the explicit busy-art simplification first at the plywood thresholds
 * 1.5 mm / 25 mm²) and SBConstruct.vertexGate (after fromMasks) inside the timed pass; a row over a cap is recorded with
 * status COMPLEXITY_LIMIT and its time to reject. --bonded-only skips connected mode (reported, never gating). These
 * variant rows never enter docs/perf/large-image.json; --record merges them (by id + variant) into
 * docs/perf/complexity.json. Every row records vertex counts (shape.verticesBonded, maxVerticesPerLayer).
 * Stage "caps" sets the desktop caps: busy-family rows at the desktop budget (5774×4330, 25 Mpx) with larger noise cells
 * (CAPS.cells: fewer, larger parts) plus the realistic r25 row, bonded only; decideCaps picks the largest parts/layer at
 * which every busy row with as many or fewer parts meets the 10 s bonded target and 512 MiB (live set: gc() before each
 * stage-boundary sample, recorded next to the G2.2b peak that includes garbage), and vertex caps that admit
 * every admitted row that met the target and the realistic art (rounded up to 1,000). --record writes docs/perf/complexity.json (decision.*);
 * SBSchema.limits("desktop") carries the result. Mobile caps are the SRS §12.3 values; the r1 row is checked against them.
 *
 * Stage "large" (plan G2.2b; PO-LASER-4/9, NFR-03/04): the LARGE_WORKLOADS rows (SRS §12.3 calibration, 2–25 Mpx
 * realistic and busy height maps, the 470 mm-high page at 0.1 mm/px), stages 1–5 per row, final + validation per
 * mode, working set from one gc'd instrumented pass (re-execs itself with --expose-gc). --record applies the G2.2b
 * decision rule and writes docs/perf/large-image.json; without it the rows are gated against the recorded targets.
 * Product-owner decision 2026-10-08 (G2.2b stop condition, option (a)): budgets and NFR-03 gating use BONDED mode (the
 * plywood/laser default); connected mode is measured and reported, never gating, as tracked item KI-CONN-PERF
 * (TRACKED_LARGE). Mobile candidates include 1, 1.25 and 1.5 Mpx; if none qualifies, mobile fabrication is recorded as
 * "draft-only" (FAB_DEVICE_DRAFT_ONLY) instead of escalating. Machine: the measured budgets are conservative for the
 * owner's MacBook Air M5; Safari/JavaScriptCore coverage is G4.8.
 *
 * Stage "large-assemble" (G2.2b shortened run, product-owner decision 2026-10-08): builds docs/perf/large-image.json
 * from preserved "[large] …" summary lines instead of re-running rows. Each --logs entry is file=provenance ("log":
 * a row preserved from an earlier, stopped run; "live": a row measured in the current shortened run); later files win
 * for the same row id. A summary line carries only bonded/connected p95, working set, max parts per layer and wall
 * time, so per-stage p50/max, vertex counts and per-row load are null and the row is marked detail "summary-line".
 * Run counts are the LARGE_WORKLOADS defaults (each row's wall time matches them). --env takes the run's --json
 * output (node, CPU, load at start/end); --loads takes load-average sample files (time 1m 5m 15m per line) and records
 * their ranges. The rows then go through the same decideLarge rule; --record writes the JSON (method "shortened").
 * A later `large --only …` run keeps the assembled rows and marks its own rows source "live".
 *
 * Stage "geom" (spike S1, decision D2) — page 1536×1024 px at 200 µm/px:
 *   B1   8 layers × ~50k vertices, difference of every ADJACENT layer pair in
 *        both directions (7 pairs × 2 = 14 differences per run)  budget p95 < 2 s
 *   B2   offset −1500 µm and +300 µm (miter) on all 8 B1 layers     reported only
 *   B3   SBSupport.validate on randomNestedStack(lcg(1), 1536, 1024, 8)  budget p95 < 3 s
 *        (that stack has material only in layers 0–2, so B3 is light)
 *   B3b  the same support pass on the dense B1 stack (3,407 pairs)          budget p95 < 3 s
 *        (provisional 6 s until G2.7; the B3 budget since 2026-10-08)
 * Support pass (G2.7, SBSupport.validate, bonded-relief, 1.5 / 2.0 mm): one layer-level
 * boolean per adjacent pair (never per part pair), each piece classified on its D3
 * contact width (SBGeom.insetStatus) and attributed to its parts by a bbox sweep. B3b
 * reuses the B1 differences (L_k − L_(k−1)); B3b_full, without reuse, is reported.
 *
 *     node test/bench.js support [--runs N] [--json out.json] [--no-fail] [--quick]
 * runs B3 and B3b only (G2.7 Step 3).
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
const STAGES = { geom: benchGeom, support: benchSupport, large: benchLarge, "large-assemble": benchLargeAssemble, caps: benchCaps };
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

/**
 * G2.7 support pass (SBSupport.validate, bonded-relief, plywood thresholds 1.5 / 2.0 mm) — B3 on
 * randomNestedStack(lcg(1), W, H, 8) and B3b on the dense B1 stack. Layers are MaterialLayers from
 * SBMaterial.fromMasks (parts given, as in the product). B3 runs the full validation (containment differences
 * included); B3b reuses the B1 differences (cfg.unsupported, computed once outside the timing, as the engine
 * will hand them over) — the gated B3b figure. B3b_full (no reuse) is reported.
 */
const SUPPORT_CFG = { minFeatureMM: 1.5, advisoryFeatureMM: 2 };
function supportStage(W, H, SX, denseMasks, denseL) {
  const G = SBGeom, M = SBMaterial, out = {};
  const page = { artWMM: (W * SX) / 1000, artHMM: (H * SX) / 1000, frameMM: 0 };
  const sub = Math.max(QUICK ? 1 : 5, Math.floor(RUNS / 2)), b3bRuns = QUICK ? 1 : Math.max(5, Math.floor(RUNS / 2));
  const summary = (r) => ({ pairs: r.supportGraph.edges.reduce((a, e) => a + e.supports.length, 0), reachesBase: r.supportGraph.reachesBase,
    contained: !r.diagnostics.some((d) => d.code === "BOND_UNSUPPORTED"),
    diagnostics: r.diagnostics.reduce((a, d) => ((a[d.code] = (a[d.code] || 0) + (d.count || 1)), a), {}) });
  const S = M.fromMasks(F.randomNestedStack(F.lcg(1), W, H, 8), W, H, page, {});
  out.inputB3 = { generator: `randomNestedStack(lcg(1), ${W}, ${H}, 8)`, vertices: S.map((l) => l.stats.vertices), parts: S.map((l) => l.parts.length) };
  let r = null;
  out.B3_supportPass = Object.assign(timeRuns(() => { r = SBSupport.validate(S, "bonded-relief", SUPPORT_CFG); }, sub, QUICK ? 0 : 1), summary(r));
  const D = M.fromMasks(denseMasks, W, H, page, {});
  const sameAsB1 = !denseL || D.every((l, k) => JSON.stringify(l.material) === JSON.stringify(denseL[k]));
  const diffs = D.map((l, k) => (k ? G.difference(l.material, D[k - 1].material) : null)); // B1 shape, reused
  out.inputB3b = { generator: "the B1 noise stack as MaterialLayers", parts: D.map((l) => l.parts.length), sameMaterialAsB1: sameAsB1, cfg: SUPPORT_CFG };
  out.B3b_supportPass_dense = Object.assign(timeRuns(() => { r = SBSupport.validate(D, "bonded-relief", Object.assign({ unsupported: diffs }, SUPPORT_CFG)); }, b3bRuns, QUICK ? 0 : 1),
    summary(r), { reuse: "B1 differences (cfg.unsupported)" });
  out.B3b_supportPass_dense_full = Object.assign(timeRuns(() => { r = SBSupport.validate(D, "bonded-relief", SUPPORT_CFG); }, QUICK ? 1 : 3, 0),
    summary(r), { reuse: "none (containment differences inside)", gated: false });
  return out;
}

/** Stage "support" (G2.7): B3 and B3b only, on the geom page (1536×1024 px at 200 µm/px; --quick 192×128). */
function benchSupport() {
  const W = QUICK ? 192 : 1536, H = QUICK ? 128 : 1024, SX = 200, CELL = QUICK ? 9 : 27, BUDGET = { B3: 3000, B3b: 3000 };
  const report = { stage: "support", backend: SBGeom.backend, node: process.version, quick: QUICK, runs: RUNS, page: { w: W, h: H, sxUm: SX, syUm: SX },
    budgetsMs: BUDGET, loadAvgStart: require("os").loadavg().map((x) => +x.toFixed(2)) };
  Object.assign(report, supportStage(W, H, SX, noiseStack(11, W, H, 8, CELL), null));
  report.loadAvgEnd = require("os").loadavg().map((x) => +x.toFixed(2));
  report.overBudget = QUICK ? [] : [["B3", report.B3_supportPass], ["B3b", report.B3b_supportPass_dense]].filter(([k, x]) => x.p95Ms >= BUDGET[k]).map(([k]) => k);
  return report;
}

function benchGeom() {
  const G = SBGeom, T = SBTrace;
  const W = QUICK ? 192 : 1536, H = QUICK ? 128 : 1024, SX = 200, SY = 200, CELL = QUICK ? 9 : 27;
  const BUDGET = { B1: 2000, B3: 3000, B3b: 3000 }; // B3b provisional 6 s until G2.7 (2026-10-08: under the B3 budget)
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

  // ------------------------------------------------------------------ support pass (B3 / B3b, G2.7)
  Object.assign(report, supportStage(W, H, SX, masks, L));
  report.fingerprintB1 = require("crypto").createHash("sha256").update(JSON.stringify([G.difference(L[0], L[1]), G.offset(L[2], -1500, "miter")])).digest("hex");
  const over = [], known = [];
  if (!QUICK) {
    for (const [k, r] of [["B1", report.B1_difference], ["B3", report.B3_supportPass], ["B3b", report.B3b_supportPass_dense]]) {
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
 * candidates 1/1.25/1.5/2/4/6/8 Mpx), "exploration" (9/12 Mpx, the busy family, the 470 mm-high page). runs/warm per the plan:
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
  for (const [mp, w, h] of [[1, 1155, 866], [1.25, 1291, 968], [1.5, 1414, 1061], [2, 1633, 1225], [6, 2828, 2121], [8, 3266, 2449]]) add("r" + mp, w, h, "realistic", "mobile");
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
  seeds: { realistic: 2022, busy: 11 }, busyCellPx: 27, pitchUm: 100, tolUm: 50, minFeatureUm: 1500, advisoryFeatureUm: 2000, minPartMM2: 25,
  source16: [4618, 3464],
  desktop: { candidates: [16, 20, 25], wsMiB: 512, targetMs: 10000, relaxStepMs: 5000, relaxMaxMs: 60000 },
  mobile: { candidates: [1, 1.25, 1.5, 2, 4, 6, 8], wsMiB: 192, targetMs: 8000, k: 4, kProvisional: true },
  gatingMode: "bonded",
  perfJson: path.join(__dirname, "..", "docs", "perf", "large-image.json"),
};

function stats(t) {
  const s = t.slice().sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, p50Ms: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), maxMs: +s[s.length - 1].toFixed(1) };
}

/** One full pipeline pass over a workload; returns per-stage ms and (when mem) the peak algorithm-owned bytes. */
function largePass(wl, samples, src, mem, opt = {}) {
  const G = SBGeom, M = SBMaterial, R = SBRaster, N = wl.layers, w = wl.w, h = wl.h;
  const page = { artWMM: wl.artWMM || (w * LARGE.pitchUm) / 1000, artHMM: wl.artHMM || (h * LARGE.pitchUm) / 1000, frameMM: 0 };
  const t = {}, now = () => performance.now();
  const used = () => { const u = process.memoryUsage(); return u.arrayBuffers + u.heapUsed; };
  let base = 0, peak = 0;
  // mem true: peak sampled after every stage (G2.2b method; includes garbage not yet collected). mem "live" (G2.7b):
  // gc() before every sample, so the peak is the live set retained at the stage boundaries.
  const gcFull = () => { for (let i = 0; i < 3; i++) global.gc(); };   // repeated: array buffers of the previous pass are released lazily
  const sample = () => { if (mem) { if (mem === "live") gcFull(); peak = Math.max(peak, used() - base); } };
  if (mem) { gcFull(); base = used(); }
  let t0;
  // 1. resample from the 16 MP source (realistic family only; content-independent)
  if (src && w * h < src.w * src.h) {
    t0 = now(); R.resample(src.px, 1, src.w, src.h, w, h, "area"); t.resampleArea = now() - t0; sample();
    t0 = now(); R.resample(src.px, 1, src.w, src.h, w, h, "nearest"); t.resampleNearest = now() - t0; sample();
  }
  // 2. masks: the existing tonal path, and the height path (SBHeight, G2.3)
  t0 = now();
  const bandMap = R.bands(samples, R.thresholds(samples, N, "balanced"));
  const tonal = R.sheetMasks(bandMap, N, w, h, false);
  t.masksTonal = now() - t0; sample();
  t0 = now();
  let masks = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(samples, N, "white-high"), null, N, w, h);
  t.masksHeight = now() - t0; sample();
  void tonal;
  // 2b. G2.7b complexity gate (pre-trace parts cap, optional busy-art simplification); part of the timed final pass
  const sxUm = Math.round(page.artWMM * 1000 / w), syUm = Math.round(page.artHMM * 1000 / h);
  const physical = { minFeatureMM: LARGE.minFeatureUm / 1000, minPartMM2: LARGE.minPartMM2, sxUm, syUm };
  let gate = null;
  t.complexity = 0;
  if (opt.caps || opt.simplify === "busy") {
    t0 = now();
    if (opt.caps) gate = SBConstruct.complexityGate(masks, w, h, Object.assign({ deviceClass: opt.caps, simplify: opt.simplify || "off", quality: "fabrication" }, physical));
    else { const sb = SBConstruct.simplifyBusy(masks, w, h, physical); gate = { status: "ok", masks: sb.masks, simplified: sb, estimate: SBConstruct.estimateComplexity(sb.masks, w, h), diagnostics: [] }; }
    t.complexity = now() - t0; sample();
    const simplified = gate.simplified ? { before: gate.simplified.before, after: gate.simplified.after, closeR: gate.simplified.closeR } : null;
    if (gate.status === "error") {
      t.final = t.finalBonded = t.complexity;
      return { t, status: "COMPLEXITY_LIMIT", shape: { partsPerLayer: gate.estimate.partsPerLayer, maxPartsPerLayer: gate.estimate.maxPartsPerLayer, simplified,
        rejected: gate.diagnostics.filter((d) => d.code === "COMPLEXITY_LIMIT").map((d) => ({ layer: d.layer, measured: d.measured, limit: d.limit })) }, peakBytes: mem ? peak : null };
    }
    masks = gate.masks; gate.simplifiedShape = simplified;
  } else if (opt.estimate) { // caps calibration: the pre-trace estimate is part of the capped workload, without gating
    t0 = now(); SBConstruct.estimateComplexity(masks, w, h); t.complexity = now() - t0; sample();
  }
  // 3. trace + fromMasks: bonded (D1: unsmoothed) and connected (G1.2 smoothing)
  t0 = now(); const bonded = M.fromMasks(masks, w, h, page, { quality: "fabrication", smooth: { mode: "bonded", tolUm: LARGE.tolUm } }); t.materialBonded = now() - t0; sample();
  const verts = (L) => L.reduce((s, l) => s + l.stats.vertices, 0);
  if (opt.caps) { // G2.7b vertex caps after fromMasks, before validation
    t0 = now(); const vg = SBConstruct.vertexGate(bonded, opt.caps, { quality: "fabrication" }); t.complexity += now() - t0;
    if (vg.status === "error") {
      t.final = t.finalBonded = t.complexity + t.materialBonded;
      return { t, status: "COMPLEXITY_LIMIT", shape: { partsPerLayer: bonded.map((l) => l.parts.length), maxPartsPerLayer: Math.max(...bonded.map((l) => l.parts.length)),
        verticesBonded: verts(bonded), maxVerticesPerLayer: Math.max(...vg.vertices.perLayer), simplified: gate.simplifiedShape || null,
        rejected: vg.diagnostics.map((d) => ({ layer: d.layer, measured: d.measured, limit: d.limit })) }, peakBytes: mem ? peak : null };
    }
  }
  let connected = null;
  if (!opt.bondedOnly) { t0 = now(); connected = M.fromMasks(masks, w, h, page, { quality: "fabrication", smooth: { mode: "connected", tolUm: LARGE.tolUm } }); t.materialConnected = now() - t0; sample(); }
  // 4. validation: adjacent-pair difference both directions (B1 shape) and the support pass (G2.7 SBSupport.validate,
  //    bonded-relief at the plywood thresholds; the upward differences are reused, B3b shape)
  const validate = (layers) => {
    const d0 = now(), up = [null];
    for (let k = 1; k < layers.length; k++) { G.difference(layers[k - 1].material, layers[k].material); up.push(G.difference(layers[k].material, layers[k - 1].material)); }
    const d1 = now();
    const r = SBSupport.validate(layers, "bonded-relief", { minFeatureMM: LARGE.minFeatureUm / 1000, advisoryFeatureMM: LARGE.advisoryFeatureUm / 1000, unsupported: up, quality: "fabrication" });
    const n = (c) => r.diagnostics.filter((d) => d.code === c).reduce((a, d) => a + (d.count || 1), 0);
    sample();
    return { diffMs: d1 - d0, supportMs: now() - d1, pieces: r.supportGraph.edges.reduce((a, e) => a + e.supports.length, 0),
      blocked: n("BOND_UNSUPPORTED"), narrow: n("SUPPORT_NARROW"), marginal: n("FEATURE_MARGINAL") };
  };
  const vb = validate(bonded); t.diffBonded = vb.diffMs; t.supportBonded = vb.supportMs;
  if (connected) { const vc = validate(connected); t.diffConnected = vc.diffMs; t.supportConnected = vc.supportMs; }
  // 5. packaging proxy: layerSVG + layer hashing (bonded)
  t0 = now();
  const pg = M.page(page);
  let bytes = 0; for (const l of bonded) bytes += SBSvg.layerSVG(l, pg).length;
  for (const l of bonded) G.layerHashes(l);
  t.package = now() - t0; sample();
  t.finalBonded = t.complexity + t.materialBonded + t.diffBonded + t.supportBonded;   // t.complexity is 0 without --caps/--simplify
  if (connected) t.finalConnected = t.materialConnected + t.diffConnected + t.supportConnected;
  t.final = t.finalBonded; // gated value: bonded mode (PO decision 2026-10-08); connected is reported (KI-CONN-PERF)
  const shape = {
    partsPerLayer: bonded.map((l) => l.parts.length), verticesBonded: verts(bonded), verticesConnected: connected ? verts(connected) : null,
    verticesPerLayer: bonded.map((l) => l.stats.vertices), simplified: gate ? gate.simplifiedShape || null : null,
    maxPartsPerLayer: Math.max(...bonded.map((l) => l.parts.length)), maxVerticesPerLayer: Math.max(...bonded.map((l) => l.stats.vertices)),
    supportPieces: vb.pieces, contacts: { blocked: vb.blocked, narrow: vb.narrow, marginal: vb.marginal }, svgBytes: bytes,
  };
  return { t, status: "ok", shape, peakBytes: mem ? peak : null };
}

/** G2.7b: the variant of a `large` run (--caps / --simplify / --bonded-only), "" for the plain G2.2b pass. */
function largeVariant() {
  const caps = arg("--caps"), simplify = arg("--simplify", "off"), bondedOnly = argv.includes("--bonded-only");
  if (caps && !["desktop", "mobile"].includes(caps)) throw new Error("--caps must be desktop|mobile");
  if (!["off", "busy"].includes(simplify)) throw new Error("--simplify must be off|busy");
  const parts = [caps ? "caps=" + caps : null, simplify !== "off" ? "simplify=" + simplify : null, bondedOnly ? "bonded-only" : null].filter(Boolean);
  return { caps: caps || null, simplify, bondedOnly, key: parts.join(",") };
}

/** Runs one workload (memory pass, warm-up, timed runs) and returns its row; shared by `large` and `caps`. */
function largeRow(wl, samples, src, opt) {
  const os = require("os"), t0 = performance.now();
  const memPass = largePass(wl, samples, src, true, opt);
  const livePass = opt.liveSet ? largePass(wl, samples, src, "live", opt) : null;
  const runs = [];
  if (memPass.status === "ok" || memPass.status === "COMPLEXITY_LIMIT") {
    for (let i = 0; i < wl.warm; i++) largePass(wl, samples, src, false, opt);
    for (let i = 0; i < wl.runs; i++) runs.push(largePass(wl, samples, src, false, opt).t);
  }
  const st = {};
  for (const k of Object.keys(runs[0])) st[k] = stats(runs.map((r) => r[k]).filter((v) => v !== undefined));
  return Object.assign({}, wl, { source: "live", detail: "full", status: memPass.status, stages: st, shape: memPass.shape, workingSetMiB: +(memPass.peakBytes / 2 ** 20).toFixed(1),
    liveSetMiB: livePass ? +(livePass.peakBytes / 2 ** 20).toFixed(1) : undefined,
    wallS: +((performance.now() - t0) / 1000).toFixed(1), loadAvg: os.loadavg().map((x) => +x.toFixed(2)) });
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
  const variant = largeVariant();
  if (variant.key) report.variant = variant.key;
  for (const wl of list) {
    const samples = wl.family === "busy" ? F.busyHeightMap(LARGE.seeds.busy, wl.w, wl.h, wl.cellPx || LARGE.busyCellPx) : F.heightMap(LARGE.seeds.realistic, wl.w, wl.h);
    const row = largeRow(wl, samples, wl.family === "realistic" ? src : null, variant);
    if (variant.key) row.variant = variant.key;
    report.rows.push(row);
    const st = row.stages, conn = st.finalConnected ? st.finalConnected.p95Ms + " ms (reported, KI-CONN-PERF)" : "not run (--bonded-only)";
    if (!variant.key) console.error(`[large] ${wl.id} ${wl.w}×${wl.h} ${wl.family}: final (bonded, gated) p95 ${st.final.p95Ms} ms, connected ${conn}, ws ${row.workingSetMiB} MiB, parts ≤${row.shape.maxPartsPerLayer}/layer, ${row.wallS} s wall`);
    else console.error(`[large ${variant.key}] ${wl.id} ${wl.w}×${wl.h} ${wl.family}: ${row.status}, final (bonded) p95 ${st.final.p95Ms} ms, connected ${conn}, ws ${row.workingSetMiB} MiB, parts ≤${row.shape.maxPartsPerLayer}/layer` +
      (row.shape.simplified ? ` (simplified from ≤${Math.max(...row.shape.simplified.before)})` : "") + `, vertices ${row.shape.verticesBonded ?? "-"}, ${row.wallS} s wall`);
  }
  report.loadAvgEnd = os.loadavg().map((x) => +x.toFixed(2));
  if (QUICK) { report.overBudget = []; return report; }
  if (variant.key) { // G2.7b variant rows: never merged into large-image.json; --record merges them into complexity.json
    if (argv.includes("--record")) {
      const prev = fs.existsSync(CAPS.perfJson) ? JSON.parse(fs.readFileSync(CAPS.perfJson, "utf8")) : {};
      const key = (r) => r.id + "|" + r.variant, byKey = new Map((prev.variantRows || []).map((r) => [key(r), r]));
      for (const r of report.rows) byKey.set(key(r), r);
      fs.writeFileSync(CAPS.perfJson, JSON.stringify(Object.assign({}, prev, { variantRows: [...byKey.values()] }), null, 1) + "\n");
    }
    report.overBudget = [];
    report.rows = report.rows.map((r) => ({ id: r.id, variant: r.variant, status: r.status, finalP95Ms: r.stages.final.p95Ms, workingSetMiB: r.workingSetMiB,
      maxPartsPerLayer: r.shape.maxPartsPerLayer, vertices: r.shape.verticesBonded ?? null, simplifiedFrom: r.shape.simplified ? r.shape.simplified.before : null }));
    return report;
  }

  // Merge with the recorded rows (an --only run updates just its rows), then decide or gate.
  const prev = fs.existsSync(LARGE.perfJson) ? JSON.parse(fs.readFileSync(LARGE.perfJson, "utf8")) : null;
  const byId = new Map((prev ? prev.rows : []).map((r) => [r.id, r]));
  for (const r of report.rows) byId.set(r.id, r);
  const rows = LARGE_WORKLOADS.map((wl) => byId.get(wl.id)).filter(Boolean);
  const ref = byId.get("srs-desktop");
  for (const r of rows) r.xRef = ref ? +(r.stages.final.p95Ms / ref.stages.final.p95Ms).toFixed(2) : null;
  const record = argv.includes("--record");
  const decision = record ? decideLarge(byId) : prev && prev.decision;
  const merged = Object.assign({}, prev || {}, report, { rows, decision, method: largeMethodKind(rows), methodDetail: LARGE_METHOD });
  if (merged.method === "full") delete merged.shortened;
  if (record) { fs.mkdirSync(path.dirname(LARGE.perfJson), { recursive: true }); fs.writeFileSync(LARGE.perfJson, JSON.stringify(merged, null, 1) + "\n"); }
  report.decision = decision;
  report.overBudget = gateLarge(byId, decision);
  report.tracked = TRACKED_LARGE;
  report.knownOver = knownOverLarge(byId, decision);
  report.rows = report.rows.map((r) => ({ id: r.id, finalP95Ms: r.stages.final.p95Ms, connectedP95Ms: r.stages.finalConnected.p95Ms, workingSetMiB: r.workingSetMiB, xRef: r.xRef }));
  return report;
}

/**
 * Known, tracked large-stage items: measured and reported, not gating (PO decision 2026-10-08, option (a)).
 */
const TRACKED_LARGE = {
  connected: {
    id: "KI-CONN-PERF",
    decided: "2026-10-08 (product owner, G2.2b stop condition option (a))",
    cause: "connected-mode smoothing (G1.2): maxDeviationUm segDist/distToGrid and the T-junction split dominate (≈18 s on the SRS desktop reference)",
    resolution: "G4.1 worker pool (per-layer / per-adjacent-pair stages in parallel, deterministic merge) and/or smoothing optimisation in G4; connected mode stays functional with its measured times documented",
    ref: "docs/plans/opaque-layers-dev-plan.md Appendix D.8 and G4.1; docs/ARCHITECTURE.md D6 (KI-CONN-PERF)",
  },
};

/** Connected-mode p95 on the gated rows, reported against the gated target as KNOWN-OVER (tracked), never failing. */
function knownOverLarge(byId, d) {
  if (!d) return [];
  const out = [], T = TRACKED_LARGE.connected;
  const chk = (id, scale, target) => { const r = byId.get(id); if (!r || !r.stages.finalConnected) return;
    const v = +(r.stages.finalConnected.p95Ms * scale).toFixed(1);
    if (v > target) out.push({ metric: "connected " + id, p95Ms: v, budgetMs: target, status: "KNOWN-OVER (tracked)", id: T.id, ref: T.ref }); };
  chk("srs-desktop", 1, d.srsDesktop.targetMs);
  chk(d.desktop.row, 1, d.desktop.targetMs);
  if (d.mobile && d.mobile.fabrication === "enabled") chk(d.mobile.row, d.mobile.k, d.mobile.targetMs);
  return out;
}

const LARGE_METHOD = {
  final: "final + validation = stage 3 (trace + SBMaterial.fromMasks, fabrication quality) + stage 4 (adjacent-pair difference ×2 directions, support pass: SBSupport.validate (G2.7; until G2.7: one layer-level intersection per adjacent pair, classifyContact(piece, minFeature) then survivesInset(advisory/2) per piece)), timed per run for bonded (D1 unsmoothed) and connected (G1.2 smoothing); the gated value (stages.final) is BONDED mode (PO decision 2026-10-08); connected (stages.finalConnected) is reported as KI-CONN-PERF, not gating",
  workingSet: "one instrumented pass per row after gc(): peak of process.memoryUsage() arrayBuffers + heapUsed minus the pre-pipeline baseline, sampled after every stage (algorithm-owned, SRS §12.3); the input samples are outside it",
  desktopRule: "largest of 16/20/25 Mpx (realistic) with working set ≤ 512 MiB and bonded final p95 ≤ target; target 10 s if 16 Mpx meets it, else 16 Mpx p95 rounded up to 5 s (≤ 60 s, else escalate)",
  mobileRule: "largest of 1/1.25/1.5/2/4/6/8 Mpx (realistic) with working set ≤ 192 MiB and desktop bonded final p95 × k ≤ 8 s; k = 4 provisional until the ≥ 4 GB reference device (G4.4); if none qualifies, mobile fabrication is draft-only (FAB_DEVICE_DRAFT_ONLY), recorded, not escalated",
  machine: "budgets are measured on the Linux i7-11800H (16 threads) development machine and are conservative for the owner's MacBook Air M5; Safari/JavaScriptCore coverage is G4.8",
  stages: "1 resample area/nearest from a 16 MP source (realistic rows smaller than it); 2 masks tonal (R.thresholds/bands/sheetMasks) and height (SBHeight.addedFromSamples/cumulativeMasks); 3 material bonded/connected; 4 difference + support; 5 layerSVG + layerHashes",
};

function decideLarge(byId) {
  const p95 = (id) => byId.get(id).stages.final.p95Ms, ws = (id) => byId.get(id).workingSetMiB;   // final = bonded (gated)
  const conn = (id) => { const r = byId.get(id); return r && r.stages.finalConnected ? r.stages.finalConnected.p95Ms : null; };
  const D = LARGE.desktop, Mo = LARGE.mobile, escalate = [];
  if (ws("r16") > D.wsMiB) escalate.push(`16 Mpx working set ${ws("r16")} MiB > ${D.wsMiB} MiB`);
  let target = D.targetMs, relaxed = false;
  if (p95("r16") > D.targetMs) { relaxed = true; target = Math.ceil(p95("r16") / D.relaxStepMs) * D.relaxStepMs; }
  if (target > D.relaxMaxMs) escalate.push(`relaxed desktop target ${target} ms > ${D.relaxMaxMs} ms`);
  let dMp = 16;
  for (const mp of D.candidates) if (byId.has("r" + mp) && ws("r" + mp) <= D.wsMiB && p95("r" + mp) <= target) dMp = Math.max(dMp, mp);
  let mMp = null;
  for (const mp of Mo.candidates) if (byId.has("r" + mp) && ws("r" + mp) <= Mo.wsMiB && p95("r" + mp) * Mo.k <= Mo.targetMs) mMp = mp;
  const measured = Mo.candidates.filter((mp) => byId.has("r" + mp));
  const cx = (id) => { const r = byId.get(id); return r ? { maxPartsPerLayer: r.shape.maxPartsPerLayer, maxVerticesPerLayer: r.shape.maxVerticesPerLayer ?? null, vertices: r.shape.verticesBonded ?? null } : null; };
  return {
    gatingMode: LARGE.gatingMode,
    knownItems: [Object.assign({ mode: "connected", gating: false }, TRACKED_LARGE.connected)],
    desktop: { fabPxBudget: dMp * 1e6, row: "r" + dMp, targetMs: target, relaxed, relaxedAppliesTo: relaxed ? "fabrication generation of workloads larger than the SRS §12.3 reference" : null,
      p95Ms: p95("r" + dMp), workingSetMiB: ws("r" + dMp), r16P95Ms: p95("r16"), connectedP95Ms: conn("r" + dMp) },
    mobile: mMp === null
      ? { fabrication: "draft-only", fabPxBudget: null, row: null, targetMs: Mo.targetMs, k: Mo.k, kProvisional: Mo.kProvisional, diagnostic: "FAB_DEVICE_DRAFT_ONLY",
          reason: `no mobile candidate qualifies in bonded mode (measured ${measured.map((mp) => mp + " Mpx").join(", ") || "none"}; working set ≤ ${Mo.wsMiB} MiB and desktop p95 × ${Mo.k} ≤ ${Mo.targetMs} ms): fabrication export is disabled on mobile with a diagnostic, draft stays available` }
      : { fabrication: "enabled", fabPxBudget: mMp * 1e6, row: "r" + mMp, targetMs: Mo.targetMs, k: Mo.k, kProvisional: Mo.kProvisional,
          desktopP95Ms: p95("r" + mMp), p95Ms: +(p95("r" + mMp) * Mo.k).toFixed(1), workingSetMiB: ws("r" + mMp), connectedDesktopP95Ms: conn("r" + mMp) },
    srsDesktop: { targetMs: 10000, p95Ms: p95("srs-desktop"), connectedP95Ms: conn("srs-desktop") },
    complexityStart: { desktop: cx("r" + dMp), desktopBusy: cx("b" + dMp), mobile: mMp !== null ? cx("r" + mMp) : null, mobileBusy: mMp !== null ? cx("b" + mMp) : null },
    escalate,
  };
}

/**
 * Gated rows (bonded mode): the desktop and mobile budget rows (realistic) and the SRS desktop reference. A draft-only
 * mobile outcome has no mobile row to gate. Returns the failures.
 */
function gateLarge(byId, d) {
  if (!d) return ["no recorded decision (run with --record)"];
  const over = [...(d.escalate || [])];
  const chk = (id, scale, target, label) => { const r = byId.get(id); if (!r) { over.push(label + ": row " + id + " not measured"); return; }
    const v = r.stages.final.p95Ms * scale; if (v > target) over.push(`${label}: ${id} p95 ${v.toFixed(0)} ms > ${target} ms`); };
  chk(d.desktop.row, 1, d.desktop.targetMs, "desktop");
  if (d.mobile && d.mobile.fabrication !== "draft-only" && d.mobile.row) chk(d.mobile.row, d.mobile.k, d.mobile.targetMs, "mobile (scaled)");
  chk("srs-desktop", 1, d.srsDesktop.targetMs, "SRS desktop reference");
  return over;
}

// =========================================================================== stage "caps" (G2.7b)
/**
 * Desktop complexity caps by measurement (plan G2.7b; SRS §12.3, NFR-03/04, PO-LASER-9). Rows at the desktop budget
 * (r25: 5774×4330 = 25 Mpx, 8 layers, 0.1 mm/px): the realistic r25 row and the busy family with larger noise cells
 * (fewer, larger parts per layer), bonded only (the gated mode). The capped busy workload is the busy row whose
 * parts per layer sit at the cap.
 */
const CAPS = {
  w: 5774, h: 4330, cells: [240, 224, 208, 200, 192, 176], warm: 1, runs: 5, targetMs: 10000, wsMiB: 512, round: 1000,
  mobile: { row: "r1", w: 1155, h: 866 },
  perfJson: path.join(__dirname, "..", "docs", "perf", "complexity.json"),
};
const roundUp = (v, q) => Math.ceil(v / q) * q;

/**
 * decideCaps(rows) → decision. rows: [{id, family, status, stages.final.p95Ms, workingSetMiB, shape}]; the realistic row
 * has id "r25". maxPartsPerLayer = the largest busy maxPartsPerLayer such that every busy row with as many or fewer parts
 * meets targetMs and wsMiB; the vertex caps admit every row so admitted that met the target, and the realistic row
 * (max of their vertex counts, rounded up to 1,000).
 * If no busy row qualifies, the parts cap falls back to the realistic row (escalate recorded).
 */
function decideCaps(rows, mobileRow) {
  const mem = (r) => (Number.isFinite(r.liveSetMiB) ? r.liveSetMiB : r.workingSetMiB);
  const ok = (r) => r.status === "ok" && r.stages.final.p95Ms <= CAPS.targetMs && mem(r) <= CAPS.wsMiB;
  const real = rows.find((r) => r.id === "r25"), busy = rows.filter((r) => r.family === "busy").slice().sort((a, b) => a.shape.maxPartsPerLayer - b.shape.maxPartsPerLayer);
  let chosen = null;
  for (const r of busy) { if (!ok(r)) break; chosen = r; }
  const escalate = [];
  if (!real) escalate.push("realistic r25 row missing");
  else if (!ok(real)) escalate.push(`realistic r25 misses the target (p95 ${real.stages.final.p95Ms} ms, ${mem(real)} MiB)`);
  if (!chosen) escalate.push("no busy row meets the target; parts cap falls back to the realistic art");
  // vertex caps: every measured workload admitted by the parts cap that met the target (busy rows up to the chosen one, realistic)
  const admitted = (chosen ? busy.filter((r) => r.shape.maxPartsPerLayer <= chosen.shape.maxPartsPerLayer) : []).concat(real && ok(real) ? [real] : []);
  const basis = chosen || real, pick = (f) => Math.max(0, ...admitted.map((r) => r.shape[f]), basis ? basis.shape[f] : 0);
  const cx = (r) => r ? { id: r.id, cellPx: r.cellPx || null, status: r.status, p95Ms: r.stages.final.p95Ms, workingSetMiB: r.workingSetMiB, liveSetMiB: r.liveSetMiB ?? null,
    maxPartsPerLayer: r.shape.maxPartsPerLayer, maxVerticesPerLayer: r.shape.maxVerticesPerLayer, vertices: r.shape.verticesBonded } : null;
  const desktop = { deviceClass: "desktop", fabPxBudget: CAPS.w * CAPS.h >= 25e6 ? 25e6 : null, targetMs: CAPS.targetMs, wsMiB: CAPS.wsMiB,
    maxPartsPerLayer: basis ? basis.shape.maxPartsPerLayer : null,
    maxVerticesPerLayer: roundUp(pick("maxVerticesPerLayer"), CAPS.round), maxVerticesTotal: roundUp(pick("verticesBonded"), CAPS.round),
    row: cx(chosen || real), realistic: cx(real),
    firstOver: cx(busy.find((r) => !ok(r)) || null) };
  const mob = { deviceClass: "mobile", source: "SRS §12.3 mobile workload (SRS:L562)", maxPartsPerLayer: 100, maxVerticesPerLayer: 20000, maxVerticesTotal: 20000 };
  if (mobileRow) mob.realisticAtBudget = Object.assign(cx(mobileRow), { withinCaps: mobileRow.shape.maxPartsPerLayer <= 100 && mobileRow.shape.verticesBonded <= 20000 &&
    mobileRow.shape.maxVerticesPerLayer <= 20000 });
  return { rule: "largest busy parts/layer at the desktop budget with every busy row of as many or fewer parts at bonded p95 ≤ 10 s and live set ≤ 512 MiB (gc'd at each stage boundary; the G2.2b peak incl. garbage is recorded as workingSetMiB); vertex caps = max over the admitted rows that met the target (busy up to that row, realistic r25), rounded up to 1,000",
    desktop, mobile: mob, escalate };
}

function benchCaps() {
  const div = QUICK ? 8 : 1, os = require("os");
  const runs = arg("--large-runs") ? +arg("--large-runs") : CAPS.runs;
  const W = Math.max(64, Math.round(CAPS.w / div)), H = Math.max(64, Math.round(CAPS.h / div));
  const base = { w: W, h: H, mpx: +(W * H / 1e6).toFixed(2), layers: 8, warm: QUICK ? 0 : CAPS.warm, runs: QUICK ? 1 : runs, role: "caps",
    artWMM: (W * LARGE.pitchUm) / 1000, artHMM: (H * LARGE.pitchUm) / 1000 };
  const report = { stage: "caps", quick: QUICK, node: process.version, v8: process.versions.v8, cpu: os.cpus()[0].model, threads: os.cpus().length,
    memGiB: +(os.totalmem() / 2 ** 30).toFixed(1), backend: SBGeom.backend, loadAvgStart: os.loadavg().map((x) => +x.toFixed(2)), rows: [] };
  const opt = { bondedOnly: true, caps: null, simplify: "off", key: "bonded-only", liveSet: true, estimate: true };
  const wls = [Object.assign({ id: "r25", family: "realistic" }, base)]
    .concat(CAPS.cells.map((c) => Object.assign({ id: "c" + c, family: "busy", cellPx: Math.max(2, Math.round(c / div)) }, base)));
  for (const wl of wls) {
    const samples = wl.family === "busy" ? F.busyHeightMap(LARGE.seeds.busy, wl.w, wl.h, wl.cellPx) : F.heightMap(LARGE.seeds.realistic, wl.w, wl.h);
    const row = largeRow(wl, samples, null, opt);
    report.rows.push(row);
    console.error(`[caps] ${wl.id} ${wl.w}×${wl.h} ${wl.family}${wl.cellPx ? " cell " + wl.cellPx : ""}: final (bonded) p95 ${row.stages.final.p95Ms} ms, ws ${row.workingSetMiB} MiB (live ${row.liveSetMiB} MiB), parts ≤${row.shape.maxPartsPerLayer}/layer, vertices ${row.shape.verticesBonded} (≤${row.shape.maxVerticesPerLayer}/layer), ${row.wallS} s wall`);
  }
  // mobile: the realistic art at the mobile budget (r1), measured once against the SRS caps (informational)
  const mw = QUICK ? Math.round(CAPS.mobile.w / div) : CAPS.mobile.w, mh = QUICK ? Math.round(CAPS.mobile.h / div) : CAPS.mobile.h;
  const mwl = { id: CAPS.mobile.row, family: "realistic", w: mw, h: mh, layers: 8, warm: 0, runs: 1, role: "caps-mobile", artWMM: mw * LARGE.pitchUm / 1000, artHMM: mh * LARGE.pitchUm / 1000 };
  const mobileRow = largeRow(mwl, F.heightMap(LARGE.seeds.realistic, mw, mh), null, opt);
  report.mobileRow = { id: mobileRow.id, w: mw, h: mh, maxPartsPerLayer: mobileRow.shape.maxPartsPerLayer, vertices: mobileRow.shape.verticesBonded, maxVerticesPerLayer: mobileRow.shape.maxVerticesPerLayer };
  report.loadAvgEnd = os.loadavg().map((x) => +x.toFixed(2));
  const decision = decideCaps(report.rows, mobileRow);
  report.decision = decision;
  report.overBudget = [];
  if (!QUICK && argv.includes("--record")) {
    const prev = fs.existsSync(CAPS.perfJson) ? JSON.parse(fs.readFileSync(CAPS.perfJson, "utf8")) : {};
    const out = Object.assign({}, prev, { stage: "caps", task: "G2.7b", node: report.node, v8: report.v8, cpu: report.cpu, threads: report.threads, memGiB: report.memGiB,
      backend: report.backend, loadAvgStart: report.loadAvgStart, loadAvgEnd: report.loadAvgEnd, method: { runs, warm: CAPS.warm, cells: CAPS.cells, page: CAPS.w + "×" + CAPS.h + " at 0.1 mm/px, 8 layers",
        final: "bonded only: SBConstruct.estimateComplexity (the pre-trace gate's cost, not gating) + SBMaterial.fromMasks (fabrication, D1 unsmoothed) + adjacent-pair differences + SBSupport.validate", workingSet: LARGE_METHOD.workingSet,
        liveSet: "a second instrumented pass with gc() before every stage-boundary sample: the live set retained by the pipeline (garbage excluded); the 512 MiB criterion is applied to it" },
      rows: report.rows, mobileRow, decision });
    fs.mkdirSync(path.dirname(CAPS.perfJson), { recursive: true });
    fs.writeFileSync(CAPS.perfJson, JSON.stringify(out, null, 1) + "\n");
  }
  report.rows = report.rows.map((r) => ({ id: r.id, cellPx: r.cellPx || null, finalP95Ms: r.stages.final.p95Ms, workingSetMiB: r.workingSetMiB, liveSetMiB: r.liveSetMiB, maxPartsPerLayer: r.shape.maxPartsPerLayer,
    vertices: r.shape.verticesBonded, maxVerticesPerLayer: r.shape.maxVerticesPerLayer }));
  return report;
}

// --------------------------------------------------------------------------- stage "large-assemble" (G2.2b shortened)
/** The product-owner decision behind the shortened G2.2b run; copied into the results file by large-assemble. */
const LARGE_SHORTENED = {
  decided: "2026-10-08 (product owner)",
  reason: "the full G2.2b run (5 warm-up + 30 runs at the gated points, 1 + 5 elsewhere) was stopped after about 6.5 h as overly thorough",
  liveRows: "only the rows still needed were run live: realistic 25 Mpx (r25) and the realistic 470 mm page (laser470, 3525×4700), 1 warm-up + 5 runs each",
  skippedRule: "remaining busy rows (b20, b25, laser470-busy) are not measured; the busy family is reported, never gated, and the measured busy rows already show that cost follows part count, not pixels",
  loadBaseline: "background 1-minute load ≈ 3–4 from desktop processes (DisplayLinkManager ≈ 50 % CPU, Firefox, Hyprland, short-lived fuser /dev/video* probes) during both runs, plus ≈ 1 from the single-threaded benchmark itself (shortened.load has the sampled ranges); every p95 includes that contention",
};

/** Parses one "[large] …" summary line (benchLarge's console line) into a row object with provenance; null if not one. */
function largeRowFromSummary(line, source) {
  const m = /^\[large\] (\S+) (\d+)×(\d+) (\w+): final \(bonded, gated\) p95 ([\d.]+) ms, connected ([\d.]+) ms .*?ws ([\d.]+) MiB, parts ≤(\d+)\/layer, ([\d.]+) s wall/.exec(line.trim());
  if (!m) return null;
  const wl = LARGE_WORKLOADS.find((w) => w.id === m[1]);
  if (!wl || wl.w !== +m[2] || wl.h !== +m[3] || wl.family !== m[4]) throw new Error("summary line does not match LARGE_WORKLOADS: " + line);
  const st = (p95) => ({ n: wl.runs, p50Ms: null, p95Ms: p95, maxMs: null });
  return Object.assign({}, wl, { source, detail: "summary-line",
    stages: { final: st(+m[5]), finalBonded: st(+m[5]), finalConnected: st(+m[6]) },
    shape: { maxPartsPerLayer: +m[8], partsPerLayer: null, verticesBonded: null, verticesConnected: null, maxVerticesPerLayer: null, supportPieces: null, contacts: null, svgBytes: null },
    workingSetMiB: +m[7], wallS: +m[9], loadAvg: null });
}

/** Load-average samples ("<time> <1m> <5m> <15m> …" per line) → range summary. */
function largeLoadSummary(text, label) {
  const s = text.split("\n").map((l) => /^(\S+) ([\d.]+) ([\d.]+) ([\d.]+)/.exec(l)).filter(Boolean).map((m) => ({ t: m[1], l: [+m[2], +m[3], +m[4]] }));
  if (!s.length) return { label, samples: 0 };
  const one = s.map((x) => x.l[0]).sort((a, b) => a - b);
  return { label, samples: s.length, from: s[0].t, to: s[s.length - 1].t, first: s[0].l, last: s[s.length - 1].l,
    oneMin: { min: one[0], median: one[Math.floor(one.length / 2)], max: one[one.length - 1] } };
}

/** "full" only when every row was measured live in the harness at its default run counts; otherwise "shortened". */
function largeMethodKind(rows) {
  return rows.length === LARGE_WORKLOADS.length && rows.every((r) => r.source !== "log" && r.detail !== "summary-line" && !r.runsOverridden) ? "full" : "shortened";
}

function benchLargeAssemble() {
  const logs = (arg("--logs") || "").split(",").filter(Boolean).map((x) => { const [file, prov] = x.split("="); return { file, provenance: prov || "log" }; });
  if (!logs.length) throw new Error("large-assemble needs --logs file=log|live[,…]");
  const byId = new Map(), sources = [];
  for (const { file, provenance } of logs) {
    if (provenance !== "log" && provenance !== "live") throw new Error("provenance must be log|live: " + file);
    const ids = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) { const r = largeRowFromSummary(line, provenance); if (r) { byId.set(r.id, r); ids.push(r.id); } }
    sources.push({ file: path.relative(path.join(__dirname, ".."), path.resolve(file)), provenance, rows: ids });
  }
  const env = arg("--env") ? JSON.parse(fs.readFileSync(arg("--env"), "utf8")) : {};
  const loads = (arg("--loads") || "").split(",").filter(Boolean).map((x) => { const [file, label] = x.split("="); return largeLoadSummary(fs.readFileSync(file, "utf8"), label || file); });
  const rows = LARGE_WORKLOADS.map((wl) => byId.get(wl.id)).filter(Boolean);
  const ref = byId.get("srs-desktop");
  for (const r of rows) r.xRef = ref ? +(r.stages.final.p95Ms / ref.stages.final.p95Ms).toFixed(2) : null;
  const decision = decideLarge(byId);
  const report = { stage: "large", method: largeMethodKind(rows), quick: false, node: env.node || null, v8: env.v8 || null, cpu: env.cpu || null, threads: env.threads || null,
    memGiB: env.memGiB || null, backend: env.backend || null,
    shortened: Object.assign({}, LARGE_SHORTENED, {
      sources, skipped: LARGE_WORKLOADS.filter((wl) => !byId.has(wl.id)).map((wl) => wl.id),
      runCounts: "each row at its LARGE_WORKLOADS default: warm-up + runs = 5 + 30 for the calibration rows, r1/r1.25/r1.5/r2/r4/r6/r8 and r16; 1 + 5 for the rest (rows[].warm, rows[].runs); wall times match",
      liveRun: { loadAvgStart: env.loadAvgStart || null, loadAvgEnd: env.loadAvgEnd || null }, load: loads,
      missingFields: "summary lines carry no per-stage p50/max, vertex counts (shape.maxVerticesPerLayer, verticesBonded), per-row load or contact counts; those are null",
    }),
    rows, decision, methodDetail: LARGE_METHOD, tracked: TRACKED_LARGE };
  if (argv.includes("--record")) { fs.mkdirSync(path.dirname(LARGE.perfJson), { recursive: true }); fs.writeFileSync(LARGE.perfJson, JSON.stringify(report, null, 1) + "\n"); }
  return { stage: "large-assemble", method: report.method, sources, skipped: report.shortened.skipped, decision,
    overBudget: gateLarge(byId, decision), knownOver: knownOverLarge(byId, decision), tracked: TRACKED_LARGE,
    rows: rows.map((r) => ({ id: r.id, source: r.source, finalP95Ms: r.stages.final.p95Ms, connectedP95Ms: r.stages.finalConnected.p95Ms, workingSetMiB: r.workingSetMiB, xRef: r.xRef })) };
}

function main() {
  if ((stage === "large" || stage === "caps") && typeof global.gc !== "function") { // the working-set pass needs gc()
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
module.exports = { LARGE_WORKLOADS, LARGE, TRACKED_LARGE, LARGE_SHORTENED, CAPS, decideLarge, decideCaps, gateLarge, knownOverLarge, largeRowFromSummary, largeMethodKind };
if (MAIN) main();
