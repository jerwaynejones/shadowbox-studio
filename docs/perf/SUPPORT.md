# Support pass benchmark (G2.7)

Plan task G2.7, Step 3 and the B3b exit condition (D2, Appendix C). Raw output: `support.json`
(`node test/bench.js support --json docs/perf/support.json`). The same B3/B3b figures are produced by
`node test/bench.js geom`.

**Machine and load.** Linux, i7-11800H (8C/16T), Node v26.7.0 (V8 14.6), single thread, no worker.
The 1-minute load average was 8–9 during both runs (other processes on the machine), so these are
loaded figures.

**What is timed.** `SBSupport.validate(layers, "bonded-relief", {minFeatureMM: 1.5, advisoryFeatureMM: 2})`
on MaterialLayers from `SBMaterial.fromMasks` (page 1536 × 1024 px at 200 µm/px, parts given). The pass:

- one layer-level boolean per adjacent pair, never per part pair. With the containment difference
  `U = Final[k] − Final[k−1]` at hand, `Final[k] ∩ Final[k−1] = Final[k] − U`, which is `Final[k]` itself
  when `U` is empty;
- each piece classified on its D3 contact width through `SBGeom.insetStatus` (advisory inset first, then
  `minFeature/2`, then 0.25 µm; a bbox/area pre-filter skips insets that cannot survive);
- non-blocking pieces attributed to their upper and lower parts by a bbox sort-and-sweep, with ties broken
  at the piece's certified witness.

B3b (gated) reuses the B1 differences through `cfg.unsupported`, which the engine will hand over in the
same way. B3b_full runs the containment differences inside validate and is reported only.

| Metric | Input | Runs | p50 ms | p95 ms | Budget | Pairs | Diagnostics |
|---|---|---|---|---|---|---|---|
| B3 | `randomNestedStack(lcg(1), 1536, 1024, 8)` | 7 | 2.5 | **2.9** | < 3 s | 4 | none |
| **B3b** | dense B1 noise stack, B1 differences reused | 7 | 1283.3 | **1318.7** | **< 3 s** (was provisional < 6 s) | 3,407 | 2,624 `SUPPORT_NARROW`, 160 `FEATURE_MARGINAL` |
| B3b_full | same, without reuse | 3 | 1516.7 | 1551.8 | reported | 3,407 | same |

These are the `bench geom` figures. In the `bench support` run, B3b p95 was 1361.5 ms and B3b_full
1572.0 ms. Before G2.7 the spike measured 4.55 s for the pair search alone (no width classification),
and the first G2.7 prototype, which used the shipped `insetStatus` unchanged, measured 13.9 s. The
changes that brought it under budget are recorded in `docs/ARCHITECTURE.md` D3 ("G2.7 amendments to
`SBGeom.insetStatus`") and in the `js/support.js` header.

**Large workloads.** `test/bench.js large` now runs `SBSupport.validate` in its support slot. The G2.2b
rows in `large-image.json` predate that change and were not re-run in G2.7: the long large-image benchmark
was out of scope, and only `large --quick` was run as a smoke check. The support p95 at the PO-LASER-9
workloads is recorded with the G2.7b `large --only b4,b9,r25 …` run.

## G2.8 feature checks (B4, reported only)

`SBSupport.featureChecks` (plywood 1.5 / 2.0 mm, 25 mm², uncalibrated) on the same dense B1 stack
(`node test/bench.js support`, 2026-10-08, 5 runs, 1-minute load 8–9 from other processes): p50 2867 ms,
**p95 2948 ms**; 2,795 `PART_THIN`, 279 `NECK_NARROW`, 3,100 `PART_SMALL`, 118 `FEATURE_MARGINAL` (part)
and 49 (neck). The plan gives no budget for this check. It uses one miter erosion per layer and width
(Appendix C), skips parts whose bbox cannot survive, and on orthogonal (bonded, D1) layers composes the
advisory erosion from the first residual. Without the composition the p95 was 3258 ms. The first erosion
(−750 µm on about 50k vertices per layer) is most of the time. This stress stack has about 3,500 parts,
which is above the G2.7b desktop cap of 258 parts per layer, so realistic art costs much less. Moving the
work to the G4.1 worker is the planned mitigation.
