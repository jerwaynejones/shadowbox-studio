/* ============================================================================
 * spikes/S2/s2_smoothing.js — Spike S2 (rework): smoothing vs exact containment (D1)
 * ----------------------------------------------------------------------------
 *   node spikes/S2/s2_smoothing.js [--configs A,B,...] [--sets random,busy768,busy1536,images]
 *                                  [--json out.json] [--checks]
 * Full run: spikes/S2/run_all.sh (one process per config, in parallel), then report.js.
 *
 * For every config × stack it runs:
 *   bonded     — containment fixpoint (D1) on
 *   connected  — no containment; for configs with blanket shared-boundary pinning (E, F)
 *                it is run twice: "connected+SP" (pins on) and "connected" (pins off)
 * and measures the CORRECTED metric (lib.js metrics): share of raw corners and of raw
 * boundary length that the final geometry actually rounds (> 1 µm away). The v1 metric
 * (perimeter of loops whose level is "chaikin") is kept only for comparison.
 * ==========================================================================*/
"use strict";
const fs = require("fs");
const S = require("./lib.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CFG_IDS = arg("--configs", "A,B,C,D,E,F,G,H").split(",");
const SETS = arg("--sets", "random,busy768,busy1536,images").split(",");
const JSON_OUT = arg("--json", null);
const pct = (v) => (v * 100).toFixed(1) + "%";

const results = { generated: new Date().toISOString(), node: process.version, configs: {}, checks: [], images: S.IMAGES };
if (CFG_IDS[0] !== "none") {
  const data = S.datasets(SETS);
  for (const st of data) if (st.nestingViolationsFixed !== undefined) console.log(`[input] ${st.name}: ${st.w}x${st.h}, ${st.layers.length} sheets, nesting violations after morphology: ${st.nestingViolationsFixed}`);
  for (const id of CFG_IDS) {
    const cfg = S.CONFIGS[id];
    console.log(`\n=== Config ${id} — ${cfg.label} ===`);
    const modes = [["bonded", { containment: true }], ["connected", { containment: false, sharePin: false }]];
    if (cfg.sharePin) modes.push(["connected+SP", { containment: false, sharePin: true }]);
    const per = [];
    for (const st of data) {
      const rec = { set: st.set, name: st.name, w: st.w, h: st.h, modes: {} };
      for (const [mode, over] of modes) {
        const run = S.runStack(st.layers, st.w, st.h, { ...cfg, ...over });
        const m = S.metrics(run);
        if (mode === "bonded") { m.overhang = S.overhangRows(run, st.set === "random"); m.hash = S.outputHash(run); }
        rec.modes[mode] = m;
        console.log(`  ${st.name.padEnd(22)} ${mode.padEnd(13)} loops ${String(m.loops).padStart(5)}  corners rounded ${pct(m.cornerShare).padStart(6)}  length rounded ${pct(m.lengthShare).padStart(6)}  (v1 metric ${pct(m.v1PerimShare).padStart(6)})  ` +
          `C/R/raw ${m.chaikin}/${m.rdp}/${m.raw}  dev/topo/cont ${m.counts.deviation}/${m.counts.topology}/${m.counts.containment}  sweeps ${m.sweeps} steps ${m.steps} unres ${m.unresolved}  ` +
          `maxDev ${m.maxDevUm.toFixed(1)}  topoOK ${m.topoOK}  nested ${m.nestedOK}  ${m.ms.toFixed(0)} ms`);
      }
      per.push(rec);
    }
    // pooled aggregates per input set and mode
    const agg = {};
    for (const set of SETS) for (const [mode] of modes) {
      const ms = per.filter((p) => p.set === set).map((p) => p.modes[mode]); if (!ms.length) continue;
      const sum = (f) => ms.reduce((s, m) => s + f(m), 0);
      agg[set + "|" + mode] = {
        stacks: ms.length, loops: sum((m) => m.loops), corners: sum((m) => m.corners),
        cornerShare: sum((m) => m.cornersRounded) / sum((m) => m.corners),
        lengthShare: sum((m) => m.lengthShare * m.corners) / sum((m) => m.corners), // corner-weighted mean of per-stack length share
        lengthShareMean: sum((m) => m.lengthShare) / ms.length, cornerShareMean: sum((m) => m.cornerShare) / ms.length,
        v1PerimShare: sum((m) => m.v1PerimShare) / ms.length,
        deviation: sum((m) => m.counts.deviation), topology: sum((m) => m.counts.topology), containment: sum((m) => m.counts.containment),
        maxDevUm: Math.max(...ms.map((m) => m.maxDevUm)), allNested: ms.every((m) => m.nestedOK), allTopoOK: ms.every((m) => m.topoOK),
        maxSweeps: Math.max(...ms.map((m) => m.sweeps)), maxSteps: Math.max(...ms.map((m) => m.steps)), unresolved: sum((m) => m.unresolved),
        msTotal: sum((m) => m.ms), msMax: Math.max(...ms.map((m) => m.ms)),
        stacksWithUncondOverhang: mode === "bonded" ? ms.filter((m) => m.overhang.some((r) => r.overUncondMM2 > 0)).length : undefined,
        uncondOverhangMM2: mode === "bonded" ? sum((m) => m.overhang.reduce((s, r) => s + r.overUncondMM2, 0)) : undefined,
      };
      const a = agg[set + "|" + mode];
      console.log(`  [${set} | ${mode}] corners rounded ${pct(a.cornerShare)}  length rounded ${pct(a.lengthShareMean)} (mean)  v1 ${pct(a.v1PerimShare)}  dev/topo/cont ${a.deviation}/${a.topology}/${a.containment}  maxDev ${a.maxDevUm.toFixed(1)}  nested ${a.allNested}  topo ${a.allTopoOK}  max sweeps ${a.maxSweeps} steps ${a.maxSteps} unres ${a.unresolved}  ${a.msTotal.toFixed(0)} ms`);
    }
    results.configs[id] = { cfg, agg, per };
  }
}

// ---------------------------------------------------- G1.2 prototype checks
if (process.argv.includes("--checks")) {
  const { F, T, diff, inter, area, isEmpty, union, P, ringTopology, segGrid, distToRing, maxDeviationUm } = S;
  const check = (name, cond, detail) => { results.checks.push({ name, pass: !!cond, detail }); console.log((cond ? "  PASS " : "  FAIL ") + name + (detail !== undefined ? "  [" + detail + "]" : "")); };
  console.log("\n=== G1.2 prototype checks ===");
  const s1 = (lp) => lp.map(([x, y]) => [Math.round(x * 1000), Math.round(y * 1000)]);
  const stair = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [0, 3]];
  const devPlain = maxDeviationUm(s1(stair), s1(T.chaikin(stair, 2)), 10, 250);
  check("G1.2 'stair' fixture: whole-ring chaikin(2) deviation is 530.33 µm (3-unit corners), not 176.78", Math.abs(devPlain - 530.33) <= 1, devPlain.toFixed(2) + " µm");
  const longStair = []; for (let i = 0; i < 6; i++) longStair.push([i, i], [i + 1, i]); longStair.push([6, 6], [0, 6]);
  const G = segGrid(s1(T.chaikin(longStair, 2)), 250); let mUnit = 0;
  for (let i = 1; i < 11; i++) { const [x, y] = longStair[i]; mUnit = Math.max(mUnit, distToRing(x * 1000, y * 1000, G)); }
  check("unit-step corner deviation of chaikin(2) = 176.78 µm at 1 mm/px", Math.abs(mUnit - 176.78) <= 1, mUnit.toFixed(2) + " µm");
  const tiny = [new Uint8Array(16).fill(1), F.art(["....", ".##.", ".###", "...."]).m];
  const L1 = S.metrics(S.runStack(tiny, 4, 4, { pxUm: 250, tolUm: 1, epsPx: 0.004, pin: true, containment: false }));
  check("tolerance 1 µm @250 µm/px → deviation fallback recorded, nothing rounded", L1.counts.deviation > 0 && L1.cornersRounded === 0, L1.counts.deviation + " fallbacks");
  for (const id of ["C", "E", "G"]) {
    const ci = F.MASKS.crescentInterior, r = S.runStack(ci.layers, ci.w, ci.h, { ...S.CONFIGS[id], containment: true });
    check(`crescentInterior bonded (${id}): no overhang after fixpoint`, isEmpty(diff(r.layers[1].S, r.layers[0].S)));
  }
  const bt = F.MASKS.borderTouch, rb = S.runStack(bt.layers, bt.w, bt.h, { pxUm: 1000, tolUm: 250, epsPx: 0.25, pin: true, local: true, containment: true });
  check("art-boundary vertices pinned (x=0 edge kept exact, local variant)", rb.layers[1].S.some((p) => p.filter((v) => Number(v.x) === 0).length >= 2));
  const d = F.MASKS.donutIsland, rd = S.runStack(d.layers, d.w, d.h, { pxUm: 1000, tolUm: 250, epsPx: 0.25, pin: true, local: true, containment: true });
  check("topology unchanged (donut keeps its hole, local variant)", ringTopology(rd.layers[1].R) === ringTopology(rd.layers[1].S), ringTopology(rd.layers[1].S));
  const rng = F.lcg(3); let okDense = true;
  for (let t = 0; t < 20; t++) {
    const A = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], B = A.map(([x, y]) => [x + Math.round((rng() - 0.5) * 200), y + Math.round((rng() - 0.5) * 200)]);
    const brute = (Pp, Q) => { let m = 0; for (let i = 0; i < Pp.length; i++) { const a = Pp[i], b = Pp[(i + 1) % Pp.length]; for (let s = 0; s <= 100; s++) { const x = a[0] + ((b[0] - a[0]) * s) / 100, y = a[1] + ((b[1] - a[1]) * s) / 100; let best = Infinity; for (let k = 0; k < Q.length; k++) { const c = Q[k], e = Q[(k + 1) % Q.length], dx = e[0] - c[0], dy = e[1] - c[1]; const u = Math.max(0, Math.min(1, ((x - c[0]) * dx + (y - c[1]) * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(x - c[0] - u * dx, y - c[1] - u * dy)); } m = Math.max(m, best); } } return m; };
    if (maxDeviationUm(A, B) + 1 < Math.max(brute(A, B), brute(B, A))) okDense = false;
  }
  check("densified deviation ≥ brute-force sampled (20 random quads)", okDense);
  const rs = F.randomNestedStack(F.lcg(7), 120, 90, 6), pr = S.runStack(rs, 120, 90, { ...S.CONFIGS.G, containment: false }); let okArea = true;
  for (let k = 1; k < 6; k++) { const a = pr.layers[k].S, b = pr.layers[k - 1].S; if (Math.abs(area(diff(a, b)) - (area(a) - area(inter(a, b)))) > 1) okArea = false; }
  check("backend identity area(A\\B) = area(A) − area(A∩B) on smoothed layers (seed 7)", okArea);
  // metric sanity: a fully pinned loop must score 0 rounded corners even though its level is "chaikin"
  const allPin = S.metrics(S.runStack(tiny, 4, 4, { pxUm: 250, tolUm: 1000, epsPx: 0.2, pin: true, sharePin: false, containment: false }));
  const everyPinned = S.runStack(tiny, 4, 4, { pxUm: 250, tolUm: 1000, epsPx: 0.2, pin: true, containment: false });
  everyPinned.layers[1].loops[0].forEach(([x, y]) => everyPinned.layers[1].pins.add(x * 65536 + y)); everyPinned.layers[1].ver[0]++;
  const mp = S.metrics(everyPinned);
  check("metric: an all-pinned loop at level 'chaikin' counts 0 % rounded (v1 metric said 100 %)", mp.cornersRounded === 0 && mp.v1PerimShare === 1 && allPin.cornersRounded > 0, `unpinned ${allPin.cornersRounded}/${allPin.corners} rounded; all-pinned ${mp.cornersRounded}/${mp.corners}, v1 ${mp.v1PerimShare}`);
}
const failed = results.checks.filter((c) => !c.pass).length;
if (results.checks.length) console.log(`\n${results.checks.length - failed} / ${results.checks.length} prototype checks passed`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, (k, v) => (v === Infinity ? "inf" : v), 1));
