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
 *     node test/bench.js draft [--record] [--runs N] [--warm N] [--only a,b,c] [--all] [--quick]   (alpha.3 E4, see benchDraft)
 *     node test/bench.js draft --only a --candidates 720 --no-fab --guides none|inset-outline|interior-mark [--record-speed warm720]
 *     node test/bench.js draft --draft-sweep 720,1280,1536,1792,2000 --pool 8 [--record]   (speed round F17, see benchDraftSweep)
 *     node test/bench.js draft-decide   (F17: the F.7 rule over docs/perf/draft-budget.json f17 → decision)
 *     node test/bench.js large --only user12 [--guides …] [--runs N] [--rows draft720,fab3600,fab4096] [--record] [--quick]
 *     node test/bench.js large --only user12 --pool 0,1,8 [--rows draft720,fab3600,fab4096,fab25] [--runs N] [--record]   (speed round F18, see benchUser12Final)
 *
 * Speed round F2 (S5, PO-PERF-5): every engine-driven row (draft, fabrication, user12) carries a per-stage table
 * derived from the SBEngine.generate onProgress marks (stageDurations: a stage lasts until the next different mark,
 * re-entered stages are summed, "setup" is the time before the first mark), including stage 14 "guides" ("guides" →
 * "accounting") split into "guides.build" and "guides.validate" (SBGuides.build / validate, timed through a probe).
 * --guides sets construction.guides.mode on the bonded workloads (default: the preset's). `large --only user12` is the
 * S2 workload (4096 × 3084 RGBA alpha.3 scene, draftProject("a") settings + applyFabPitch(0.1), inset-outline): rows
 * draft720 (cold, 4096 source), fab3600 (3600 × 2700 scene) and fab4096, serial, USER12.runs no-cache runs each;
 * --record merges them into docs/perf/speed-round.json under `baseline` (or --speed-key). `draft --record-speed warm720`
 * merges the draft rows (with their guides mode) into speed-round.json `warm720`.
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
 * B4 (G2.8, reported only): SBSupport.featureChecks on the dense stack (1.5 / 2.0 mm, 25 mm², uncalibrated).
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
const QUICK = argv.includes("--quick"), QUICK_ARG = QUICK;
const RUNS = QUICK ? 1 : +arg("--runs", 15);
const STAGES = { geom: benchGeom, support: benchSupport, large: benchLarge, "large-assemble": benchLargeAssemble, caps: benchCaps, draft: benchDraft, "draft-decide": () => benchDraftDecide() };
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
  // G2.8 feature checks (SBSupport.featureChecks, plywood 1.5 / 2.0 mm, 25 mm²) on the dense stack: one miter erosion per
  // layer and width on the parts that still need it (Appendix C). Reported only (no budget in the plan).
  let fcr = null;
  const fcCfg = { minFeatureMM: 1.5, advisoryFeatureMM: 2, minPartMM2: 25, mmPerPxMax: SX / 1000, calibrated: false };
  out.B4_featureChecks_dense = Object.assign(timeRuns(() => { fcr = SBSupport.featureChecks(D, fcCfg); }, b3bRuns, QUICK ? 0 : 1),
    { cfg: fcCfg, gated: false, diagnostics: fcr.reduce((a, d) => ((a[d.code + (d.detail ? ":" + d.detail.kind : "")] = (a[d.code + (d.detail ? ":" + d.detail.kind : "")] || 0) + (d.count || 1)), a), {}) });
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

/**
 * Speed round S2 workload (F2): the user's bonded colour case. Rows: draft720 (4096 × 3084 source, draft at 720 px),
 * fab3600 (3600 × 2700 scene) and fab4096 (4096 × 3084), fabrication at fabPitchMM 0.1 (12 Mpx raster for 4096).
 * Every run is a fresh generate without the E3 cache (as the profile in plan F.0 and the app's fabrication review).
 */
const USER12 = {
  src: [4096, 3084], fabPitchMM: 0.1, guides: "inset-outline", runs: 3,
  rows: { draft720: { quality: "draft", draftPx: 720, w: 4096, h: 3084 }, fab3600: { quality: "fabrication", w: 3600, h: 2700 }, fab4096: { quality: "fabrication", w: 4096, h: 3084 } },
  // Speed round F18 (F-D6): the 25 Mpx memory row, run only when named in --rows. 5770 × 4330 stays under the desktop
  // maxSourcePx (25 MP); 433 mm high at 0.1 mm gives a 5770 × 4330 fabrication raster (≈ 24.98 Mpx, the fabPxBudget).
  extraRows: { fab25: { quality: "fabrication", w: 5770, h: 4330, targetMM: 433 } },
  // F18 Step 1 (S2, S5): `large --only user12 --pool 0,1,8` → benchUser12Final; 1 warm-up + 3 measured runs per row and pool size.
  final: { pools: [0, 1, 8], rows: ["draft720", "fab3600", "fab4096"], warm: 1, runs: 3, sampleMs: 25 },
};

/** A user12 row spec by id (USER12.rows, then USER12.extraRows). */
function user12Spec(id) {
  const spec = USER12.rows[id] || USER12.extraRows[id];
  if (!spec) throw new Error("unknown user12 row " + id);
  return spec;
}

/** "0,1,8" → [0, 1, 8]: non-negative integers, no repeats (the --pool list of `large --only user12`). */
function poolList(s) {
  const out = String(s === undefined ? "" : s).split(",").map((x) => (/^\d+$/.test(x.trim()) ? +x.trim() : NaN));
  if (!out.length || out.some((n) => !Number.isInteger(n) || n < 0) || new Set(out).size !== out.length)
    throw new Error("--pool takes a list of distinct non-negative integers, e.g. 0,1,8 (got " + JSON.stringify(s) + ")");
  return out;
}

/** The user12 project on source px: draftProject("a") settings, applyFabPitch(USER12.fabPitchMM), guides (default inset-outline). */
function user12Project(px, guides) {
  const hash = require("crypto").createHash("sha256").update(SBEngine.sampleBytes(px)).digest("hex");
  const p = SBSchema.applyFabPitch(draftProject("a", px, hash, guides || USER12.guides), USER12.fabPitchMM);
  const v = SBSchema.validate(p);
  if (!v.ok) throw new Error("user12 project invalid: " + JSON.stringify(v.errors.slice(0, 3)));
  return p;
}

/** The alpha.3 scene (tools/alpha3_scene.js) as RGBA. */
function alpha3Rgba(w, h) {
  const rgb = require("../tools/alpha3_scene.js").scene(w, h), o = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { o[4 * i] = rgb[3 * i]; o[4 * i + 1] = rgb[3 * i + 1]; o[4 * i + 2] = rgb[3 * i + 2]; o[4 * i + 3] = 255; }
  return { pixels: o, channels: 4, w, h, alpha: null };
}

function benchUser12() {
  const os = require("os"), E = SBEngine, div = QUICK ? 8 : 1, runsN = QUICK ? 1 : +arg("--runs", USER12.runs);
  const guides = arg("--guides", USER12.guides), ids = arg("--rows") ? arg("--rows").split(",") : Object.keys(USER12.rows);
  if (!["none", "inset-outline", "interior-mark"].includes(guides)) throw new Error("--guides must be none|inset-outline|interior-mark");
  const report = { stage: "large", workload: "user12", quick: QUICK, node: process.version, v8: process.versions.v8, cpu: os.cpus()[0].model, threads: os.cpus().length,
    memGiB: +(os.totalmem() / 2 ** 30).toFixed(1), loadAvgStart: os.loadavg().map((x) => +x.toFixed(2)), rows: {} };
  const probe = { overlayMs: 0, guidesBuild: 0, guidesValidate: 0 }, unprobe = installGuideProbe(probe);
  try {
    for (const id of ids) {
      const spec = user12Spec(id);
      const w = Math.round(spec.w / div), h = Math.round(spec.h / div), px = alpha3Rgba(w, h), p = user12Project(px, guides), t0 = performance.now();
      if (spec.targetMM) p.geometry.targetMM = spec.targetMM;
      if (spec.draftPx) p.geometry.draftPx = QUICK ? Math.round(spec.draftPx / div) : spec.draftPx;
      const runs = [];
      for (let i = 0; i < runsN; i++) runs.push(draftPass(p, px, spec.quality, null, probe));
      const g = runs[0].geometry || E.rasterPlan(p, { w, h }, spec.quality, "desktop").geometry, st = stats(runs.map((r) => r.ms));
      const row = { source: w + "×" + h, quality: spec.quality, raster: g.rasterW + "×" + g.rasterH, mpx: +(g.rasterW * g.rasterH / 1e6).toFixed(2), guides,
        status: runs[0].status, code: runs[0].code, runs: st.n, p50Ms: st.p50Ms, maxMs: st.maxMs, runsMs: runs.map((r) => +r.ms.toFixed(1)),
        stagesP50Ms: stageP50(runs.map((r) => r.stages)), maxPartsPerLayer: runs[0].parts, rssMB: +(process.memoryUsage().rss / 1048576).toFixed(0),
        wallS: +((performance.now() - t0) / 1000).toFixed(1), loadAvg: os.loadavg().map((x) => +x.toFixed(2)) };
      report.rows[id] = row;
      console.error(`[user12] ${id} ${row.source} ${row.quality} ${row.raster} ${row.status}${row.code ? " " + row.code : ""}: p50 ${row.p50Ms} ms (n ${row.runs}), guides ${row.stagesP50Ms.guides ?? "-"} ms, ${row.wallS} s wall`);
    }
  } finally { unprobe(); }
  report.loadAvgEnd = os.loadavg().map((x) => +x.toFixed(2));
  if (!QUICK && argv.includes("--record")) {
    const key = arg("--speed-key", "baseline");
    updateSpeedRound((j) => {
      j.workload = "user12: " + USER12.src.join(" × ") + " RGBA alpha.3 scene (tools/alpha3_scene.js), draftProject(\"a\") settings (plywood auto-tonal, light-front, smoothing 1.65 mm × 2, " +
        "bonded, 8 sheets, 300 mm high) + applyFabPitch(" + USER12.fabPitchMM + "), guides " + guides + "; draft720 on the 4096 source, fab3600 on a 3600 × 2700 scene, fab4096 on the 4096 source";
      j[key] = Object.assign({}, j[key] || {}, { machine: report.cpu + " (" + report.threads + " threads, " + report.memGiB + " GiB), node " + report.node,
        method: "serial SBEngine.generate, " + runsN + " no-cache runs per row (no warm-up), per-stage p50 from the onProgress marks (stageDurations), guides.build / guides.validate via the SBGuides probe",
        loadAvgStart: report.loadAvgStart, loadAvgEnd: report.loadAvgEnd }, report.rows);
    });
  }
  return report;
}

/**
 * One timed user12 run for benchUser12Final: through `pool` (SBPool) or, when null, the sync driver (SBEngine.generate,
 * no cache). `id` is the run's source identity (sampleHash): a fresh one per run keeps every run cold in the pool's K1/K2
 * cache, and the same id sequence for every pool size keeps the geometryHash comparable. Memory is sampled at every
 * progress mark and every USER12.final.sampleMs (the event loop is free only while the pool runs): process RSS (the
 * whole process, worker threads included) and arrayBuffers/heapUsed (the main isolate).
 */
async function user12FinalPass(pool, p0, px, id, quality, probe) {
  const E = SBEngine, seq = [], q = JSON.parse(JSON.stringify(p0));
  q.source.sampleHash = id;
  const mem = { rss: 0, ab: 0, heap: 0, samples: 0 }, sample = () => { const m = process.memoryUsage();
    mem.rss = Math.max(mem.rss, m.rss); mem.ab = Math.max(mem.ab, m.arrayBuffers); mem.heap = Math.max(mem.heap, m.heapUsed); mem.samples++; };
  const onProgress = (st) => { seq.push([typeof st === "string" ? st : st.stage, performance.now()]); sample(); };
  if (typeof global.gc === "function") global.gc();
  probe.guidesBuild = 0; probe.guidesValidate = 0;
  const req = E.request(q, px, { quality, requestId: quality + "-" + q.revision, deviceClass: "desktop" });
  sample();
  const timer = setInterval(sample, USER12.final.sampleMs), t0 = performance.now();
  let res;
  try {
    if (pool) {
      pool.setSource(Object.assign({ sampleHash: id }, px));
      const r = await pool.submit(req, { sampleHash: id, gen: 1, overlays: true, onProgress }).done;
      res = r.response || { status: r.status };
    } else res = E.generate(req, { onProgress });
  } finally { clearInterval(timer); }
  const ms = performance.now() - t0;
  sample();
  if (res.status !== "done") throw new Error("user12 " + quality + " run: " + res.status + " " + (res.error ? res.error.code + " " + res.error.message : ""));
  const stages = stageDurations(seq, t0, t0 + ms);
  if (!pool && "guides" in stages) { stages["guides.build"] = probe.guidesBuild; stages["guides.validate"] = probe.guidesValidate; }
  const g = res.snapshot.geometry;
  return { ms, stages, geometryHash: res.geometryHash, raster: g.rasterW + "×" + g.rasterH, mpx: +(g.rasterW * g.rasterH / 1e6).toFixed(2),
    maxPartsPerLayer: Math.max(0, ...res.snapshot.layers.map((L) => L.parts.length)), mem };
}

/**
 * Speed round F18 Step 1/1a (S2, S5, F-D6): `node test/bench.js large --only user12 --pool 0,1,8 [--rows …,fab25]
 * [--runs N] [--record]`. Per row and pool size: a fresh pool (pool 0 = the sync driver), USER12.final.warm warm-ups
 * plus `runs` measured runs, each with a fresh source identity (no cache), p50/p95/max, stage p50s (guides.build/
 * validate only for the sync driver: helper realms are not probed), geometryHash (equal across pool sizes, `equal`),
 * memory peaks and, pooled, the coordinator stats (estBytes ledger peak and budget, items run on helpers/inline).
 * --record writes docs/perf/speed-round.json `final` (status "measured"). o overrides the flags for the test:
 * {quick, pools, rows, runs, warm, guides, record}.
 */
async function benchUser12Final(o = {}) {
  const os = require("os"), quick = o.quick !== undefined ? !!o.quick : QUICK, div = quick ? 8 : 1;
  const pools = o.pools || poolList(arg("--pool")), ids = o.rows || (arg("--rows") ? arg("--rows").split(",") : USER12.final.rows);
  const runsN = quick ? 1 : (o.runs !== undefined ? o.runs : +arg("--runs", USER12.final.runs)), warmN = quick ? 0 : (o.warm !== undefined ? o.warm : USER12.final.warm);
  const guides = o.guides || arg("--guides", USER12.guides), MB = (b) => +(b / 1048576).toFixed(1);
  const report = { stage: "large", workload: "user12", mode: "final", quick, pools, node: process.version, v8: process.versions.v8, cpu: os.cpus()[0].model,
    threads: os.cpus().length, memGiB: +(os.totalmem() / 2 ** 30).toFixed(1), loadAvgStart: os.loadavg().map((x) => +x.toFixed(2)), rows: {}, equal: {} };
  const probe = { overlayMs: 0, guidesBuild: 0, guidesValidate: 0 }, unprobe = installGuideProbe(probe);
  try {
    for (const id of ids) {
      const spec = user12Spec(id), w = Math.round(spec.w / div), h = Math.round(spec.h / div), px = alpha3Rgba(w, h), p = user12Project(px, guides);
      if (spec.targetMM || quick) p.geometry.targetMM = (spec.targetMM || p.geometry.targetMM) / div;   // quick: a small fabrication raster too
      if (spec.draftPx) p.geometry.draftPx = quick ? Math.round(spec.draftPx / div) : spec.draftPx;
      const base = p.source.sampleHash.slice(0, 56);
      report.rows[id] = {};
      for (const P of pools) {
        const t0 = performance.now(), pool = P ? await sweepPool(P) : null, runs = [];
        let cs = null;
        try {
          for (let i = 0; i < warmN + runsN; i++) {
            const r = await user12FinalPass(pool, p, px, base + (0xf1800000 + i).toString(16), spec.quality, probe);
            if (i >= warmN) runs.push(r);
          }
          if (pool) cs = await pool.stats();
        } finally { if (pool) pool.terminate(); }
        const st = stats(runs.map((r) => r.ms)), r0 = runs[0], peak = (k) => Math.max(...runs.map((r) => r.mem[k]));
        const row = { pool: P, driver: P ? "SBPool (coordinator + " + P + " helpers, worker threads)" : "sync driver (SBEngine.generate)",
          source: w + "×" + h, quality: spec.quality, raster: r0.raster, mpx: r0.mpx, guides, status: "done", code: null,
          runs: st.n, warmUps: warmN, p50Ms: st.p50Ms, p95Ms: st.p95Ms, maxMs: st.maxMs, runsMs: runs.map((r) => +r.ms.toFixed(1)),
          stagesP50Ms: stageP50(runs.map((r) => r.stages)), geometryHash: r0.geometryHash, maxPartsPerLayer: r0.maxPartsPerLayer,
          memory: { rssPeakMB: MB(peak("rss")), arrayBuffersPeakMB: MB(peak("ab")), heapUsedPeakMB: MB(peak("heap")), samples: runs.reduce((a, r) => a + r.mem.samples, 0) },
          ledger: cs ? { peakLedgerMB: MB(cs.peakLedger), budgetMB: MB(cs.budgetBytes), maxInFlight: cs.maxInFlight, bands: cs.bands,
            itemsHelper: cs.itemsHelper, itemsInline: cs.itemsInline } : null,
          wallS: +((performance.now() - t0) / 1000).toFixed(1), loadAvg: os.loadavg().map((x) => +x.toFixed(2)) };
        if (runs.some((r) => r.geometryHash !== r0.geometryHash)) throw new Error("user12 " + id + " pool " + P + ": geometryHash differs between runs");
        report.rows[id]["pool" + P] = row;
        console.error(`[user12 final] ${id} pool ${P} ${row.raster}: p50 ${row.p50Ms} p95 ${row.p95Ms} ms (n ${row.runs}), rss ≤${row.memory.rssPeakMB} MB, ` +
          `arrayBuffers ≤${row.memory.arrayBuffersPeakMB} MB${row.ledger ? ", ledger peak " + row.ledger.peakLedgerMB + " MB" : ""}, ${row.wallS} s wall`);
      }
      report.equal[id] = new Set(pools.map((P) => report.rows[id]["pool" + P].geometryHash)).size === 1;
    }
  } finally { unprobe(); }
  report.loadAvgEnd = os.loadavg().map((x) => +x.toFixed(2));
  if (!quick && (o.record !== undefined ? o.record : argv.includes("--record"))) {
    updateSpeedRound((j) => {
      const prev = j.final || {};
      j.final = { task: "F18", status: "measured", machine: report.cpu + " (" + report.threads + " threads, " + report.memGiB + " GiB), node " + report.node,
        method: "node test/bench.js large --only user12 --pool " + pools.join(",") + ": per row and pool size a fresh pool (0 = the sync driver), " + warmN +
          " warm-up + " + runsN + " runs, each with a fresh source identity (no cache); stage p50 from the onProgress marks; memory = process RSS (worker threads " +
          "included) and arrayBuffers (main isolate) peaks sampled every " + USER12.final.sampleMs + " ms and at every mark; ledger = coordinator stats (estBytes " +
          "ledger peak, admission budget)", pools, loadAvgStart: report.loadAvgStart, loadAvgEnd: report.loadAvgEnd,
        rows: Object.assign({}, prev.status === "measured" ? prev.rows : {}, report.rows), equal: Object.assign({}, prev.status === "measured" ? prev.equal : {}, report.equal),
        kiB1: prev.kiB1, kiConnPerf: prev.kiConnPerf, browser: prev.browser };
    });
  }
  return report;
}

async function benchLarge() {
  const only = arg("--only") ? arg("--only").split(",") : null;
  if (only && only.includes("user12")) {
    if (only.length > 1) throw new Error("--only user12 runs alone (it is an SBEngine.generate workload, not a LARGE_WORKLOADS row)");
    return arg("--pool") !== undefined ? benchUser12Final() : benchUser12();
  }
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

// =========================================================================== stage "draft" (alpha.3 E4)
/**
 * Draft budget (plan Appendix E, task E4; PO-PREVIEW-1, amends PO-LASER-4). The draft preview runs SBEngine.generate at
 * quality "draft" with the caller-owned stage cache (E3). Source: DRAFT.src (4096 × 3084, the user's colour image size)
 * RGBA built from the bench's art generators, realistic (F.heightMap) and busy (F.busyHeightMap) families, with the
 * colour channels of the E3 suite (R = g, G = 3g mod 256, B = 255 − g). Workloads (DRAFT.workloads): (a) plywood
 * auto-tonal (bonded, light-front, smoothing 1.65 mm × 2, 8 sheets, 300 mm high), (b) plywood height (reported), (c)
 * acrylic connected (smooth corners, KI-CONN-PERF). Per draftPx candidate and family: 1 cold run (empty cache), DRAFT.warm
 * warm-ups and DRAFT.runs warm runs, each with a changed `sheets` value (8 ↔ 7) so construct reruns while the K1/K2 cache
 * stays warm; cold, warm p50 and warm p95 per row, plus the share of construct spent in the draft change-overlay
 * polygons (SBEngine.changePolygons for e.added/e.removed; bridge polygons excluded). Candidates run in ascending order and
 * a workload/family stops at the first candidate whose warm p95 exceeds the target (larger rasters are never faster;
 * --all disables this). Fabrication rows: workload (a) per family at the fabrication raster, no cache (as the app),
 * DRAFT.fabCold + DRAFT.fabRuns runs; fabMsPerMpx = the larger p50 ÷ raster Mpx of the families that finished.
 * The bench measures above the shipped device cap: SBSchema.limits is wrapped for the run so draftPxCap does not clamp.
 * --record writes docs/perf/draft-budget.json `e4` (history since F17); decideDraft reproduces its decision (test "alpha.3 E4").
 *
 *     node test/bench.js draft [--record] [--runs N] [--warm N] [--fab-runs N] [--only a,c] [--families realistic,busy]
 *                              [--candidates 720,1024] [--all] [--no-fab] [--quick]
 */
/**
 * stageDurations(seq, t0, tEnd) → {stage: ms}. seq: the onProgress marks in order, [[stage, time], …]. A stage lasts
 * from its mark to the next mark; repeated and re-entered stages are summed ("construct" per layer, the two
 * "complexity" gates); "setup" is t0 → first mark; "done" is not a stage. Pure (speed round F2).
 */
function stageDurations(seq, t0, tEnd) {
  const d = {}, add = (k, v) => { d[k] = (d[k] || 0) + v; };
  add("setup", (seq.length ? seq[0][1] : tEnd) - t0);
  for (let i = 0; i < seq.length; i++) if (seq[i][0] !== "done") add(seq[i][0], (i + 1 < seq.length ? seq[i + 1][1] : tEnd) - seq[i][1]);
  return d;
}

/** p50 per stage over a list of stage tables (a stage missing from a run counts in the runs that have it). */
function stageP50(list) {
  const out = {};
  for (const k of [...new Set(list.flatMap((t) => Object.keys(t)))]) out[k] = stats(list.map((t) => t[k]).filter((v) => v !== undefined)).p50Ms;
  return out;
}

/**
 * Wraps globalThis.SBGuides so build/validate time lands in probe.guidesBuild/guidesValidate; returns the restore.
 * Speed round F9: the engine runs guides as buildPair items + buildFold (build) and validatePair items (validate), so
 * those are timed; build/validate stay wrapped for direct callers.
 */
function installGuideProbe(probe) {
  const real = globalThis.SBGuides, timed = (fn, key) => function () {
    const t0 = performance.now(); try { return fn.apply(this, arguments); } finally { probe[key] += performance.now() - t0; } };
  globalThis.SBGuides = Object.freeze(Object.assign({}, real, { build: timed(real.build, "guidesBuild"), validate: timed(real.validate, "guidesValidate"),
    buildPair: timed(real.buildPair, "guidesBuild"), buildFold: timed(real.buildFold, "guidesBuild"), validatePair: timed(real.validatePair, "guidesValidate") }));
  return () => { globalThis.SBGuides = real; };
}

/** Reads docs/perf/speed-round.json (or {}), applies fn to it and writes it back. */
function updateSpeedRound(fn) {
  const f = path.join(__dirname, "..", "docs", "perf", "speed-round.json");
  let j = {}; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { j = {}; }
  fn(j);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(j, null, 1) + "\n");
}

const DRAFT = {
  src: [4096, 3084], seeds: { realistic: 2022, busy: 11 }, busyCellPx: 27,
  candidates: [720, 1024, 1280, 1536, 2000], targetP95Ms: 3000, g44P95Ms: 1500,
  warm: 3, runs: 15, fabCold: 1, fabRuns: 5, mobileDraftPx: 720, mobileK: 4,
  families: ["realistic", "busy"],
  workloads: {
    a: { preset: "plywood", gates: "plywood", label: "plywood auto-tonal (tonal, light-front, smoothing 1.65 mm × 2 passes, bonded, 8 sheets, 300 mm high)" },
    b: { preset: "plywood", gates: null, label: "plywood height (white-high, bonded, 8 sheets, 300 mm high; reported, not gating)" },
    c: { preset: "acrylic", gates: "acrylic", label: "acrylic connected (tonal dark-front, smoothing 1.65 mm × 2, smooth corners, 5 sheets, 300 mm wide; KI-CONN-PERF)" },
  },
  perfJson: path.join(__dirname, "..", "docs", "perf", "draft-budget.json"),
};
DRAFT.rule = "per preset, draftPx = the largest candidate in {" + DRAFT.candidates.join(", ") + "} whose warm-cache p95 (≥ 15 warm runs, E3 cache " +
  "filled, sheets changed between runs) is ≤ 3.0 s on BOTH the realistic and the busy art family for the preset's workload " +
  "(plywood: (a) auto-tonal; acrylic: (c) connected) on the reference machine; 720 when none qualifies (recorded as a known gap, G4.1). " +
  "Desktop draftPxCap = the larger of the two preset values; mobile draftPxCap = 720 (mobile ≈ 4× slower, k provisional as in D.8). " +
  "Deviation: 3.0 s p95 is twice the G4.4 desktop draft target (p95 ≤ 1.5 s, which needs the G4.1 worker pool); G4.4 re-measures against 1.5 s. " +
  "fabMsPerMpx = the larger p50 of the (a) fabrication rows that finished ÷ fabrication raster Mpx (rounded up to 10 ms); mobile = 4 × desktop.";

/** The draft workload project (a|b|c) on an installed source record for px (sampleHash set, so the E3 cache is used). */
function draftProject(id, px, sampleHash, guides) {
  const S = SBSchema, E = SBEngine, wl = DRAFT.workloads[id];
  let p = S.withSource(S.defaults(wl.preset), Object.assign(E.sourceRecord(px, { format: "png", decode: "canvas-tonal" }), { sampleHash }));
  if (id === "a") {
    p = S.applyModeChange(p, { interpretation: { mode: "tonal" } }, true);
    p.interpretation.polarity = "light-front"; p.interpretation.smoothing = { radiusMM: 1.65, passes: 2 };
    p.construction.sheets = 8; p.geometry.sizeBy = "height"; p.geometry.targetMM = 300;
  }
  if (guides && p.construction.mode === "bonded-relief") p.construction.guides.mode = guides;
  const v = S.validate(p);
  if (!v.ok) throw new Error("draft workload " + id + " invalid: " + JSON.stringify(v.errors.slice(0, 3)));
  return p;
}

/** RGBA source of one art family at DRAFT.src (colour channels as in the E3 suite). */
function draftSource(family, w, h) {
  const g = family === "busy" ? F.busyHeightMap(DRAFT.seeds.busy, w, h, DRAFT.busyCellPx) : F.heightMap(DRAFT.seeds.realistic, w, h);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = g[i]; rgba[4 * i + 1] = (g[i] * 3) & 255; rgba[4 * i + 2] = 255 - g[i]; rgba[4 * i + 3] = 255; }
  return { pixels: rgba, channels: 4, w, h, alpha: null };
}

/** One timed generate; returns {ms, status, constructMs, overlayMs, raster, parts}. */
function draftPass(p, px, quality, cache, probe) {
  const E = SBEngine, marks = {}, seq = [];
  probe.overlayMs = 0; probe.guidesBuild = 0; probe.guidesValidate = 0;
  const t0 = performance.now();
  const res = E.generate(E.request(p, px, { quality }), { cache: cache || undefined,
    onProgress: (st) => { const t = performance.now(); seq.push([st, t]); if (!(st in marks)) marks[st] = t; } });
  const ms = performance.now() - t0;
  const stages = stageDurations(seq, t0, t0 + ms);
  if ("guides" in stages) { stages["guides.build"] = probe.guidesBuild; stages["guides.validate"] = probe.guidesValidate; }
  const constructMs = marks.construct !== undefined && marks.complexity !== undefined ? marks.complexity - marks.construct : null;
  const g = res.snapshot ? res.snapshot.geometry || null : null;
  return { ms, status: res.status, code: res.error ? res.error.code : null, constructMs, overlayMs: probe.overlayMs,
    parts: res.snapshot ? Math.max(...res.snapshot.layers.map((L) => L.parts.length)) : null, geometry: g, stages };
}

/** The largest candidate on which workload `id` meets the target on both families (720 when none does). */
function draftPick(rows, id) {
  const ok = (c) => DRAFT.families.every((f) => rows.some((r) => r.mode === id && r.family === f && r.draftPx === c && r.warmP95Ms !== null && r.warmP95Ms <= DRAFT.targetP95Ms));
  return DRAFT.candidates.filter(ok).reduce((a, c) => Math.max(a, c), DRAFT.candidates[0]);
}

/** decideDraft(rows, fabRows) → decision (the recorded rule; pure, also used by the test). */
function decideDraft(rows, fabRows) {
  const presets = { plywood: draftPick(rows, "a"), acrylic: draftPick(rows, "c") };
  const done = (fabRows || []).filter((r) => r.status === "done");
  const fab = done.length ? Math.ceil(Math.max(...done.map((r) => r.ms / r.mpx)) / 10) * 10 : null;
  return { presets, desktopDraftPx: Math.max(presets.plywood, presets.acrylic), mobileDraftPx: DRAFT.mobileDraftPx, fabMsPerMpx: fab };
}

/**
 * benchDraft(o?) — the CLI stage; o (when required, speed round F2) overrides the flags: {quick, src: [w, h],
 * candidates (used as given), only, families, guides, warm, runs, fabRuns, noFab, all}.
 */
function benchDraft(o = {}) {
  const os = require("os"), S = SBSchema, E = SBEngine;
  const QUICK = o.quick !== undefined ? !!o.quick : QUICK_ARG, flag = (k, name) => (o[k] !== undefined ? !!o[k] : argv.includes(name));
  const list = (k, name) => (o[k] !== undefined ? o[k] : arg(name) ? arg(name).split(",") : null);
  const num = (k, name, d) => (o[k] !== undefined ? +o[k] : +arg(name, d));
  const div = QUICK ? 8 : 1, [SW, SH] = o.src || [Math.round(DRAFT.src[0] / div), Math.round(DRAFT.src[1] / div)];
  const warmN = o.warm !== undefined ? +o.warm : QUICK ? 1 : num("warm", "--warm", DRAFT.warm), runsN = o.runs !== undefined ? +o.runs : QUICK ? 2 : num("runs", "--runs", DRAFT.runs);
  const fabN = o.fabRuns !== undefined ? +o.fabRuns : QUICK ? 1 : num("fabRuns", "--fab-runs", DRAFT.fabRuns);
  const ids = list("only", "--only") || Object.keys(DRAFT.workloads);
  const fams = list("families", "--families") || DRAFT.families;
  const guides = o.guides !== undefined ? o.guides : arg("--guides", null);
  if (guides !== null && !["none", "inset-outline", "interior-mark"].includes(guides)) throw new Error("--guides must be none|inset-outline|interior-mark");
  const cands = o.candidates ? o.candidates.map(Number) : (arg("--candidates") ? arg("--candidates").split(",").map(Number) : DRAFT.candidates).map((c) => QUICK ? Math.max(64, Math.round(c / div)) : c);
  const all = flag("all", "--all");
  // measure above the shipped device cap (the cap is what this stage decides)
  const limits = S.limits;
  S.limits = (dc) => Object.assign({}, limits(dc), { draftPxCap: 100000 });
  // overlay probe: time the draft change-overlay polygons (bridges excluded)
  // (speed round F8: run() builds them with SBEngine.changePolygons(a, b, …); added/removed pass b, bridges pass null)
  const mp = E.changePolygons, probe = { overlayMs: 0, guidesBuild: 0, guidesValidate: 0 }, unprobe = installGuideProbe(probe);
  E.changePolygons = function (a, b) {
    if (!b) return mp.apply(this, arguments);
    const t0 = performance.now(); try { return mp.apply(this, arguments); } finally { probe.overlayMs += performance.now() - t0; }
  };
  const report = { stage: "draft", quick: QUICK, node: process.version, v8: process.versions.v8, cpu: os.cpus()[0].model, threads: os.cpus().length,
    memGiB: +(os.totalmem() / 2 ** 30).toFixed(1), loadAvgStart: os.loadavg().map((x) => +x.toFixed(2)), rows: [], fabRows: [], skipped: [] };
  const sources = {};
  try {
    for (const fam of fams) {
      const px = sources[fam] = draftSource(fam, SW, SH);
      const hash = require("crypto").createHash("sha256").update(E.sampleBytes(px)).digest("hex");
      for (const id of ids) {
        let over = false;
        for (const c of cands) {
          if (over && !all) { report.skipped.push({ draftPx: c, mode: id, family: fam, reason: "a smaller candidate already exceeds the target" }); continue; }
          const p0 = draftProject(id, px, hash, guides); p0.geometry.draftPx = c;
          const gmode = p0.construction.mode === "bonded-relief" ? p0.construction.guides.mode : "none";
          const cache = { quality: "draft" }, t0 = performance.now();
          let rev = p0.revision;
          const edit = (i) => { const q = JSON.parse(JSON.stringify(p0)); q.construction.sheets = p0.construction.sheets - (i % 2); q.revision = ++rev; return q; };
          const cold = draftPass(p0, px, "draft", cache, probe);
          for (let i = 0; i < warmN; i++) draftPass(edit(i + 1), px, "draft", cache, probe);
          const warm = [];
          for (let i = 0; i < runsN; i++) warm.push(draftPass(edit(i), px, "draft", cache, probe));
          const st = stats(warm.map((r) => r.ms));
          const cons = warm.map((r) => r.constructMs).filter((v) => v !== null), ovl = warm.map((r) => r.overlayMs);
          const share = cons.length ? +(ovl.reduce((a, b) => a + b, 0) / cons.reduce((a, b) => a + b, 0)).toFixed(3) : null;
          const g = cold.geometry || E.rasterPlan(p0, { w: px.w, h: px.h }, "draft", "desktop").geometry;   // an error run has no snapshot
          const row = { draftPx: c, raster: g.rasterW + "×" + g.rasterH, mode: id, family: fam, status: cold.status, code: cold.code,
            coldMs: +cold.ms.toFixed(1), warmP50Ms: st.p50Ms, warmP95Ms: st.p95Ms, warmMaxMs: st.maxMs, warmRuns: st.n, warmUps: warmN,
            constructP50Ms: cons.length ? stats(cons).p50Ms : null, overlayShare: share, maxPartsPerLayer: cold.parts, wallS: +((performance.now() - t0) / 1000).toFixed(1),
            loadAvg: os.loadavg().map((x) => +x.toFixed(2)), guides: gmode, coldStagesMs: stageP50([cold.stages]), stagesP50Ms: stageP50(warm.map((r) => r.stages)) };
          report.rows.push(row);
          console.error(`[draft] (${id}) ${fam} draftPx ${c} ${row.raster} ${row.status}${row.code ? " " + row.code : ""}: cold ${row.coldMs} ms, warm p50 ${row.warmP50Ms} ms, p95 ${row.warmP95Ms} ms (n ${st.n}), overlay share ${share}, parts ≤${cold.parts}, ${row.wallS} s wall`);
          if (st.p95Ms > DRAFT.targetP95Ms) over = true;
        }
      }
      if (!flag("noFab", "--no-fab") && ids.includes("a")) {
        const hash = require("crypto").createHash("sha256").update(E.sampleBytes(px)).digest("hex");
        const p = draftProject("a", px, hash, guides), t0 = performance.now();
        for (let i = 0; i < DRAFT.fabCold; i++) draftPass(p, px, "fabrication", null, probe);
        const runs = [];
        for (let i = 0; i < fabN; i++) runs.push(draftPass(p, px, "fabrication", null, probe));
        const g = runs[0].geometry, plan = E.rasterPlan(p, { w: px.w, h: px.h }, "fabrication", "desktop").geometry;
        const W = g ? g.rasterW : plan.rasterW, H = g ? g.rasterH : plan.rasterH, st = stats(runs.map((r) => r.ms));
        const row = { family: fam, mode: "a", raster: W + "×" + H, mpx: +(W * H / 1e6).toFixed(2), ms: st.p50Ms, maxMs: st.maxMs, runs: st.n, cold: DRAFT.fabCold,
          status: runs[0].status, code: runs[0].code, maxPartsPerLayer: runs[0].parts, wallS: +((performance.now() - t0) / 1000).toFixed(1),
          guides: p.construction.guides.mode, stages: stageP50(runs.map((r) => r.stages)) };
        report.fabRows.push(row);
        console.error(`[draft fab] (a) ${fam} ${row.raster} (${row.mpx} Mpx) ${row.status}${row.code ? " " + row.code : ""}: p50 ${row.ms} ms (${(row.ms / row.mpx).toFixed(0)} ms/Mpx), parts ≤${row.maxPartsPerLayer}, ${row.wallS} s wall`);
      }
      delete sources[fam];
    }
  } finally { S.limits = limits; E.changePolygons = mp; unprobe(); }
  report.loadAvgEnd = os.loadavg().map((x) => +x.toFixed(2));
  report.decision = decideDraft(report.rows, report.fabRows);
  report.overBudget = [];
  const speedKey = o.recordSpeed !== undefined ? o.recordSpeed : arg("--record-speed", null);
  if (!QUICK && speedKey) updateSpeedRound((j) => {
    const prev = (j[speedKey] && j[speedKey].rows) || [], key = (r) => [r.mode, r.family, r.draftPx, r.guides].join("|"), mine = new Set(report.rows.map(key));
    j[speedKey] = { machine: report.cpu + " (" + report.threads + " threads, " + report.memGiB + " GiB), node " + report.node,
      method: "bench draft (E4/E11 method): 1 cold + " + warmN + " warm-ups + " + runsN + " warm runs, E3 cache filled, sheets 8 ↔ 7 with the revision changing; " +
        "stagesP50Ms = p50 per stage over the warm runs (stageDurations of the onProgress marks; guides.build / guides.validate via the SBGuides probe)",
      rows: prev.filter((r) => !mine.has(key(r))).concat(report.rows.map((r) => ({ mode: r.mode, family: r.family, draftPx: r.draftPx, raster: r.raster, guides: r.guides,
        status: r.status, coldMs: r.coldMs, warmP50Ms: r.warmP50Ms, warmP95Ms: r.warmP95Ms, warmRuns: r.warmRuns, coldStagesMs: r.coldStagesMs, stagesP50Ms: r.stagesP50Ms, loadAvg: r.loadAvg }))) };
  });
  if (!QUICK && flag("record", "--record")) {
    const shortened = runsN < 15 || warmN < DRAFT.warm || fabN < DRAFT.fabRuns || fams.length < DRAFT.families.length || ids.length < 3;
    const out = {
      task: "E4", machine: report.cpu + " (" + report.threads + " threads, " + report.memGiB + " GiB), node " + report.node,
      workload: SW + " × " + SH + " RGBA (" + (SW * SH / 1e6).toFixed(1) + " Mpx), realistic (F.heightMap seed " + DRAFT.seeds.realistic + ") and busy (F.busyHeightMap seed " +
        DRAFT.seeds.busy + ", " + DRAFT.busyCellPx + " px cells) art families, colour channels R = g, G = 3g mod 256, B = 255 − g; modes: " +
        Object.entries(DRAFT.workloads).map(([k, v]) => "(" + k + ") " + v.label).join("; "),
      rule: DRAFT.rule,
      method: { candidates: DRAFT.candidates, cold: 1, warmUps: warmN, warmRuns: runsN, fabCold: DRAFT.fabCold, fabRuns: fabN, earlyStop: !all, shortened,
        warm: "E3 cache filled; construction.sheets alternates 8 ↔ 7 (5 ↔ 4 for acrylic) and the revision changes between runs, so construct reruns",
        overlayShare: "Σ draft change-overlay polygon time (SBEngine.changePolygons for e.added/e.removed) ÷ Σ construct-stage time over the warm runs" },
      loadAvgStart: report.loadAvgStart, loadAvgEnd: report.loadAvgEnd,
      rows: report.rows, fabRows: report.fabRows, skipped: report.skipped, decision: report.decision,
      informational: { plywoodHeightDraftPx: draftPick(report.rows, "b"), note: "workload (b) under the same rule; reported, not gating (the plywood preset follows (a), the auto-tonal colour route)" },
    };
    // speed round F17: the E4 record is history under `e4`; the F17 record (decision, rule, f17) stays as it is
    let whole = {};
    try { whole = JSON.parse(fs.readFileSync(DRAFT.perfJson, "utf8")); } catch (e) { whole = {}; }
    whole.e4 = out;
    fs.mkdirSync(path.dirname(DRAFT.perfJson), { recursive: true });
    fs.writeFileSync(DRAFT.perfJson, JSON.stringify(whole, null, 1) + "\n");
  }
  report.rows = report.rows.map((r) => ({ mode: r.mode, family: r.family, draftPx: r.draftPx, status: r.status, coldMs: r.coldMs, warmP95Ms: r.warmP95Ms, overlayShare: r.overlayShare,
    guides: r.guides, stages: r.stagesP50Ms }));
  return report;
}

// =========================================================================== draft sweep (speed round F17, S3)
/**
 * Speed round F17 (S3, PO-PERF-3): the draft budget re-measured with the worker pool.
 *
 *     node test/bench.js draft --draft-sweep 720,1280,1536,1792,2000 --pool 8 [--record] [--families realistic,busy]
 *                              [--warm N] [--runs N] [--k2-runs N] [--colds N] [--no-scene] [--no-fab] [--fab-runs N] [--quick]
 *
 * Workload (a) (draftProject("a"), guides as the plywood preset: inset-outline) on the E4 sources (DRAFT.src, both art
 * families). --pool N runs SBPool (js/pool.js) with N helpers on worker threads (test/node_worker_shim.js), as the page
 * does; --pool 0 the sync driver. Each size is passed as the request's explicit draftCapPx (F-D5), so the shipped cap
 * never clamps it. Per family and size: `colds` cold-after-source runs (a new source identity each: nothing cached),
 * then DRAFT.warm warm-ups and `runs` warm runs with the E4 warm edit (sheets 8 ↔ 7, revision changing; K1/K2 hit), then
 * `k2Runs` K2-miss runs (smoothing radius 1.65 ↔ 1.70 mm: K1 hit, K2 miss). Stages are the onProgress marks
 * (stageDurations). Every run records status/code, max parts and vertices per layer, total vertices and the
 * cap diagnostics (COMPLEXITY_LIMIT, FAB_COMPLEXITY_LIKELY). Scene rows: one cold draft of the alpha.3 scene
 * (tools/alpha3_scene.js, 4096 × 3084, the user12 project) per size, for the F.4 #5 cap rule. Fabrication rows
 * (fabMsPerMpx, pooled and serial): workload (a) realistic at the fabrication raster, 1 cold + fabRuns.
 * --record merges the rows into docs/perf/draft-budget.json under `f17.node` (pool size as the key) — the browser
 * rows (`f17.browser`, ?bench=draft) are added by tools; decideDraftF17 applies the F.7 rule to the record.
 */
const SWEEP = {
  warm: 3, runs: 15, k2Runs: 7, colds: 3, fabRuns: 3, smoothing: [1.65, 1.7],
  capCodes: ["COMPLEXITY_LIMIT", "FAB_COMPLEXITY_LIKELY"],
};

/** The draft result summary of one response (status, code, parts/vertices, cap diagnostics). */
function sweepShape(res) {
  const L = res && res.snapshot ? res.snapshot.layers : null, diags = (res && res.diagnostics) || [];
  const codes = [...new Set(diags.map((d) => d.code))].sort();
  return { status: res ? res.status : "none", code: res && res.error ? res.error.code : null,
    maxParts: L ? Math.max(0, ...L.map((x) => x.parts.length)) : null,
    maxVertices: L ? Math.max(0, ...L.map((x) => (x.stats && x.stats.vertices) || 0)) : null,
    totalVertices: L ? L.reduce((a, x) => a + ((x.stats && x.stats.vertices) || 0), 0) : null,
    capHits: SWEEP.capCodes.filter((c) => (res && res.error && res.error.code === c) || codes.includes(c)),
    raster: res && res.snapshot ? res.snapshot.geometry.rasterW + "×" + res.snapshot.geometry.rasterH : null };
}

/** A Node pool of `helpers` helpers (worker threads through the shim), or null for the sync driver. */
async function sweepPool(helpers) {
  if (!helpers) return null;
  const JS = path.join(__dirname, "..", "js"), text = (n) => fs.readFileSync(path.join(JS, n), "utf8");
  const shim = require("./node_worker_shim.js");
  if (typeof globalThis.SBPool === "undefined") vm.runInThisContext(text("pool.js"), { filename: "pool.js" });
  const appVersion = (text("app.js").match(/const APP_VERSION = "([^"]+)"/) || [])[1];
  const pool = SBPool.create({ appVersion, helpers, helloTimeoutMs: 30000, deviceClass: "desktop",
    loadText: async (n) => text(n), spawn: (name) => shim.spawn(path.join(JS, "worker.js"), { name }) });
  if (!(await pool.ready)) throw new Error("the Node pool did not come up (" + pool.mode + ")");
  await pool.helpersReady;
  return pool;
}

/** One timed draft/fabrication through the pool or the sync driver → {ms, stages, shape}. */
async function sweepPass(pool, p, px, sampleHash, quality, capPx, cache) {
  const E = SBEngine, seq = [], onProgress = (st) => seq.push([typeof st === "string" ? st : st.stage, performance.now()]);
  const req = E.request(p, px, { quality, requestId: quality + "-" + p.revision, deviceClass: "desktop", draftCapPx: capPx });
  const t0 = performance.now();
  let res;
  if (pool) {
    pool.setSource(Object.assign({ sampleHash }, px));
    const r = await pool.submit(req, { sampleHash, gen: 1, overlays: true, onProgress }).done;
    res = r.response || { status: r.status };
    if (process.env.SWEEP_DEBUG) console.error("pass", quality, sampleHash.slice(-8), r.status, res.status, res.error && res.error.code);
  } else res = E.generate(req, { cache: cache || undefined, onProgress });
  const ms = performance.now() - t0;
  if (res.status !== "done" && !(res.error && res.error.code === "COMPLEXITY_LIMIT"))   // a bench error is never a timing
    throw new Error("sweep run " + quality + " " + (capPx || "") + ": " + res.status + " " + (res.error ? res.error.code + " " + res.error.message : ""));
  const shape = sweepShape(res);
  if (!shape.raster) { const g = E.rasterPlan(p, { w: px.w, h: px.h }, quality, "desktop", quality === "draft" ? capPx : undefined).geometry; shape.raster = g.rasterW + "×" + g.rasterH; }
  return { ms, stages: stageDurations(seq, t0, t0 + ms), shape };
}

/** Rows of one series → {n, p50Ms, p95Ms, maxMs}; stats of the ms values. */
const sweepStats = (runs) => (runs.length ? stats(runs.map((r) => r.ms)) : { n: 0, p50Ms: null, p95Ms: null, maxMs: null });

/**
 * F.7 S3 rule (PO-PERF-3), applied to docs/perf/draft-budget.json f17 by decideDraftF17 (pure; the test reproduces the
 * recorded decision with it). Browser keys: f17.browser["chromium-i7"|"firefox-i7"] are required; "chromium-m5" is
 * applied when recorded (until then the decision is marked m5: "pending").
 */
const F17 = {
  candidates: [1280, 1536, 1792, 2000], baseline: 720, families: ["realistic", "busy"],
  targets: { "chromium-i7": 2500, "firefox-i7": 2500, "chromium-m5": 3000 }, required: ["chromium-i7", "firefox-i7"], optional: ["chromium-m5"],
};
F17.rule = "desktop draftPx = the largest of {" + F17.candidates.join(", ") + "} whose warm p95 (in-app ?bench=draft, the E4 warm edit: sheets 8 ↔ 7 " +
  "with the revision changing, K1/K2 hit, 3 warm-ups + 15 warm runs, edit → painted draft, worker pool up) is ≤ 2.5 s in Chromium AND Firefox " +
  "on the i7-11800H and ≤ 3.0 s in Chromium on the MacBook Air M5, on BOTH the realistic and the busy art family (E4 workload (a)); " +
  "a size whose draft of the alpha.3 scene (4096 × 3084, the user12 project) hits a complexity cap (COMPLEXITY_LIMIT, FAB_COMPLEXITY_LIKELY) " +
  "that the 720 draft does not hit is rejected (F.4 #5); the smaller " +
  "decision wins; 720 when none qualifies. Both presets take the decision; mobile and the no-worker fallback keep 720 (draftPxFallback, " +
  "passed as the request's draftCapPx, F-D5). The 0.5 s headroom under the E4 3.0 s rule covers browser variance. " +
  "fabMsPerMpx (pool) and fabMsPerMpxFallback (sync driver) = the realistic (a) fabrication p50 ÷ Mpx in Node with --pool 8 and " +
  "--pool 0, rounded up to 10 ms; mobile = 4 × desktop. Node --pool 8 rows are supporting evidence, not the rule.";

/** decideDraftF17(f17) → the F17 decision (pure). */
function decideDraftF17(f17) {
  const b = f17.browser || {}, rejected = [], keys = F17.required.concat(F17.optional.filter((k) => b[k]));
  const scene = (f17.node && f17.node.pool8 && f17.node.pool8.sceneRows) || [];
  const ok = (c) => {
    for (const k of keys) {
      const row = b[k] && b[k].rows.find((r) => r.draftPx === c);
      if (!row) { rejected.push({ draftPx: c, reason: k + " not measured" }); return false; }
      for (const f of F17.families) {
        const v = row.families[f];
        if (!v || v.warmP95Ms === null || v.warmP95Ms === undefined) { rejected.push({ draftPx: c, reason: k + " " + f + " not measured" }); return false; }
        if (v.warmP95Ms > F17.targets[k]) { rejected.push({ draftPx: c, reason: k + " " + f + " warm p95 " + v.warmP95Ms + " ms > " + F17.targets[k] + " ms" }); return false; }
      }
    }
    const sc = scene.find((r) => r.draftPx === c), base = scene.find((r) => r.draftPx === F17.baseline);
    if (!sc || !base) { rejected.push({ draftPx: c, reason: "alpha.3 scene not measured at " + (sc ? F17.baseline : c) }); return false; }
    const fresh = sc.capHits.filter((h) => !base.capHits.includes(h));
    if (fresh.length) { rejected.push({ draftPx: c, reason: "alpha.3 scene hits " + fresh.join(", ") + " (not hit at " + F17.baseline + ")" }); return false; }
    return true;
  };
  const pass = F17.candidates.filter(ok), d = pass.length ? Math.max(...pass) : F17.baseline;
  const fab = (k) => { const r = f17.node && f17.node[k] && (f17.node[k].fabRows || []).find((x) => x.family === "realistic" && x.status === "done");
    return r ? Math.ceil(r.p50Ms / r.mpx / 10) * 10 : null; };
  return { presets: { plywood: d, acrylic: d }, desktopDraftPx: d, mobileDraftPx: F17.baseline, fallbackDraftPx: F17.baseline,
    fabMsPerMpx: fab("pool8"), fabMsPerMpxFallback: fab("pool0"), passing: pass, rejected, m5: b["chromium-m5"] ? "measured" : "pending" };
}

/**
 * node test/bench.js draft-decide — applies decideDraftF17 to docs/perf/draft-budget.json f17 and writes the F17 record
 * (task, machine, workload, rule, method, decision); a top-level E4 record found there is moved under `e4` first.
 */
function benchDraftDecide() {
  const rec = JSON.parse(fs.readFileSync(DRAFT.perfJson, "utf8"));
  if (rec.task === "E4") {
    const e4 = {};
    for (const k of Object.keys(rec)) if (k !== "f17") { e4[k] = rec[k]; delete rec[k]; }
    rec.e4 = e4;
  }
  const f17 = rec.f17, n8 = f17.node.pool8, out = {
    task: "F17", machine: n8.machine.replace(/, node .*$/, "") + "; browsers: " + Object.values(f17.browser || {}).map((b) => b.key + " = " + b.browser).join(", "),
    workload: "E4 workload (a) (plywood auto-tonal, light-front, smoothing 1.65 mm × 2, bonded, 8 sheets, 300 mm high, inset-outline guides) on the E4 sources: " +
      DRAFT.src.join(" × ") + " RGBA, realistic (F.heightMap seed " + DRAFT.seeds.realistic + ") and busy (F.busyHeightMap seed " + DRAFT.seeds.busy + ", " + DRAFT.busyCellPx +
      " px cells) art families; cap check on the alpha.3 scene (tools/alpha3_scene.js 4096 × 3084, user12 project)",
    rule: F17.rule,
    method: { candidates: F17.candidates, browser: "tools/bench_draft_browser.mjs: ?bench=draft in the built bundle (Blob-worker pool, P = 8 helpers on 16 threads), cap raised to 2000 for the measurement, " +
      "&draftPx per size; per family the cold draft after the source install, 3 warm-ups + 15 warm edits (sheets 8 ↔ 7) and 7 K2-miss edits (smoothing 1.65 ↔ 1.70 mm), edit → painted draft",
      node: "node test/bench.js draft --draft-sweep 720,1280,1536,1792,2000 --pool 8 --record (and --draft-sweep 720 --pool 0 --no-scene for the sync driver)" },
    decision: decideDraftF17(f17), e4: rec.e4, f17,
  };
  fs.writeFileSync(DRAFT.perfJson, JSON.stringify(out, null, 1) + "\n");
  return { stage: "draft-decide", decision: out.decision };
}

async function benchDraftSweep(o = {}) {
  const os = require("os"), E = SBEngine, crypto = require("crypto");
  const QUICK = o.quick !== undefined ? !!o.quick : QUICK_ARG, div = QUICK ? 8 : 1;
  const num = (name, d) => (arg(name) !== undefined ? +arg(name) : d);
  const sizes = (o.sizes || arg("--draft-sweep").split(",").map(Number)).map((c) => (QUICK ? Math.max(64, Math.round(c / div)) : c));
  const helpers = o.pool !== undefined ? +o.pool : num("--pool", 0);
  const fams = o.families || (arg("--families") ? arg("--families").split(",") : DRAFT.families);
  const warmN = QUICK ? 1 : num("--warm", SWEEP.warm), runsN = QUICK ? 2 : num("--runs", SWEEP.runs), k2N = QUICK ? 1 : num("--k2-runs", SWEEP.k2Runs);
  const coldN = QUICK ? 1 : num("--colds", SWEEP.colds), fabN = QUICK ? 1 : num("--fab-runs", SWEEP.fabRuns);
  const [SW, SH] = [Math.round(DRAFT.src[0] / div), Math.round(DRAFT.src[1] / div)];
  const pool = await sweepPool(helpers);
  const report = { stage: "draft-sweep", quick: QUICK, pool: helpers, node: process.version, cpu: os.cpus()[0].model, threads: os.cpus().length,
    memGiB: +(os.totalmem() / 2 ** 30).toFixed(1), loadAvgStart: os.loadavg().map((x) => +x.toFixed(2)), rows: [], sceneRows: [], fabRows: [] };
  const log = (s) => console.error("[sweep pool " + helpers + "] " + s);
  try {
    for (const fam of fams) {
      const px = draftSource(fam, SW, SH), hash = crypto.createHash("sha256").update(E.sampleBytes(px)).digest("hex");
      for (const c of sizes) {
        const t0 = performance.now(), base = draftProject("a", px, hash), cache = { quality: "draft" };
        let rev = base.revision;
        const at = (h, f) => { const q = JSON.parse(JSON.stringify(base)); q.geometry.draftPx = c; q.source.sampleHash = h; q.revision = ++rev; if (f) f(q); return q; };
        const colds = [];
        for (let i = 0; i < coldN; i++) {   // a new source identity each time: K1/K2 miss (the pool keys its cache by sampleHash)
          const h = hash.slice(0, 56) + (0xc01d0000 + i).toString(16);
          colds.push(await sweepPass(pool, at(h), px, h, "draft", c, pool ? null : { quality: "draft" }));
        }
        await sweepPass(pool, at(hash), px, hash, "draft", c, cache);   // fill the cache for this source
        const sheets = (i) => (q) => { q.construction.sheets = base.construction.sheets - (i % 2); };
        for (let i = 0; i < warmN; i++) await sweepPass(pool, at(hash, sheets(i + 1)), px, hash, "draft", c, cache);
        const warm = [];
        for (let i = 0; i < runsN; i++) warm.push(await sweepPass(pool, at(hash, sheets(i)), px, hash, "draft", c, cache));
        const k2 = [];
        for (let i = 0; i < k2N; i++) k2.push(await sweepPass(pool, at(hash, (q) => { q.interpretation.smoothing = { radiusMM: SWEEP.smoothing[(i + 1) % 2], passes: 2 }; }), px, hash, "draft", c, cache));
        const shape = warm.length ? warm[warm.length - 1].shape : colds[0].shape, ws = sweepStats(warm), ks = sweepStats(k2), cs = sweepStats(colds);
        const row = { mode: "a", family: fam, draftPx: c, raster: shape.raster || colds[0].shape.raster, status: shape.status, code: shape.code,
          warmP50Ms: ws.p50Ms, warmP95Ms: ws.p95Ms, warmMaxMs: ws.maxMs, warmRuns: ws.n, warmUps: warmN,
          k2MissP50Ms: ks.p50Ms, k2MissP95Ms: ks.p95Ms, k2MissRuns: ks.n, coldP50Ms: cs.p50Ms, coldP95Ms: cs.p95Ms, coldRuns: cs.n,
          maxParts: shape.maxParts, maxVertices: shape.maxVertices, totalVertices: shape.totalVertices,
          capHits: [...new Set(warm.concat(k2, colds).flatMap((r) => r.shape.capHits))].sort(),
          stagesP50Ms: stageP50(warm.map((r) => r.stages)), wallS: +((performance.now() - t0) / 1000).toFixed(1), loadAvg: os.loadavg().map((x) => +x.toFixed(2)) };
        report.rows.push(row);
        log(`(a) ${fam} ${c} ${row.raster} ${row.status}${row.code ? " " + row.code : ""}: warm p50 ${row.warmP50Ms} p95 ${row.warmP95Ms} ms, K2-miss p95 ${row.k2MissP95Ms}, cold p95 ${row.coldP95Ms}, parts ≤${row.maxParts}, vertices ≤${row.maxVertices}/${row.totalVertices}, caps [${row.capHits}], ${row.wallS} s`);
      }
      if (!argv.includes("--no-fab") && o.fab !== false && fam === "realistic") {
        const p = Object.assign(draftProject("a", px, hash), {}), fr = [];
        for (let i = 0; i <= fabN; i++) fr.push(await sweepPass(pool, p, px, hash, "fabrication", undefined, null));
        const runs = fr.slice(1), st = sweepStats(runs), sh = runs[0].shape, [W, H] = sh.raster ? sh.raster.split("×").map(Number) : [0, 0];
        const row = { family: fam, mode: "a", raster: sh.raster, mpx: +(W * H / 1e6).toFixed(2), status: sh.status, code: sh.code, p50Ms: st.p50Ms, maxMs: st.maxMs, runs: st.n, cold: 1,
          msPerMpx: W ? Math.round(st.p50Ms / (W * H / 1e6)) : null, stagesP50Ms: stageP50(runs.map((r) => r.stages)) };
        report.fabRows.push(row);
        log(`fab (a) ${fam} ${row.raster} ${row.status}: p50 ${row.p50Ms} ms (${row.msPerMpx} ms/Mpx)`);
      }
    }
    if (!argv.includes("--no-scene") && o.scene !== false) {
      const px = alpha3Rgba(SW, SH), p0 = user12Project(px), hash = p0.source.sampleHash;
      for (const c of sizes) {
        const q = JSON.parse(JSON.stringify(p0)); q.geometry.draftPx = c;
        const r = await sweepPass(pool, q, px, hash, "draft", c, null);
        const row = Object.assign({ scene: "alpha.3 (tools/alpha3_scene.js " + SW + " × " + SH + ", user12 project)", draftPx: c, ms: +r.ms.toFixed(1) }, r.shape);
        report.sceneRows.push(row);
        log(`scene ${c} ${row.raster} ${row.status}${row.code ? " " + row.code : ""}: ${row.ms} ms, parts ≤${row.maxParts}, vertices ≤${row.maxVertices}/${row.totalVertices}, caps [${row.capHits}]`);
      }
    }
  } finally { if (pool) pool.terminate(); }
  report.loadAvgEnd = os.loadavg().map((x) => +x.toFixed(2));
  if (!QUICK && (o.record !== undefined ? o.record : argv.includes("--record"))) {
    const rec = JSON.parse(fs.readFileSync(DRAFT.perfJson, "utf8"));
    rec.f17 = rec.f17 || {};
    rec.f17.node = rec.f17.node || {};
    rec.f17.node["pool" + helpers] = { machine: report.cpu + " (" + report.threads + " threads, " + report.memGiB + " GiB), node " + report.node,
      pool: helpers, method: { warmUps: warmN, warmRuns: runsN, k2MissRuns: k2N, coldRuns: coldN, fabRuns: fabN, sizes,
        warm: "E4 warm edit: sheets 8 ↔ 7, revision changing (K1/K2 hit)", k2Miss: "smoothing radius 1.65 ↔ 1.70 mm (K1 hit, K2 miss)",
        cold: "a new source identity per run (nothing cached)", draftCapPx: "each size passed as the request's draftCapPx (F-D5)" },
      loadAvgStart: report.loadAvgStart, loadAvgEnd: report.loadAvgEnd, rows: report.rows, sceneRows: report.sceneRows, fabRows: report.fabRows };
    fs.writeFileSync(DRAFT.perfJson, JSON.stringify(rec, null, 1) + "\n");
  }
  return report;
}

async function main() {
  if ((stage === "large" || stage === "caps") && typeof global.gc !== "function") { // the working-set pass needs gc()
    const r = require("child_process").spawnSync(process.execPath, ["--expose-gc", __filename, ...argv], { stdio: "inherit" });
    process.exit(r.status === null ? 1 : r.status);
  }
  const report = stage === "draft" && arg("--draft-sweep") ? await benchDraftSweep() : await STAGES[stage]();
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
module.exports = { stageDurations, benchDraft, benchDraftSweep, F17, decideDraftF17, USER12, user12Project, user12Spec, poolList, benchUser12Final, DRAFT, decideDraft, LARGE_WORKLOADS, LARGE, TRACKED_LARGE, LARGE_SHORTENED, CAPS, decideLarge, decideCaps, gateLarge, knownOverLarge, largeRowFromSummary, largeMethodKind };
if (MAIN) main().catch((e) => { console.error(e); process.exit(1); });
