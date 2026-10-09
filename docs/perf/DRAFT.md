# Draft budget (alpha.3 E4)

Plan Appendix E, task E4 (`PO-PREVIEW-1`, `PO-PREVIEW-2`; amends PO-LASER-4, which said "draft stays about
720 px on the long side"). Raw data and the decision: `draft-budget.json`, written by
`node test/bench.js draft --record`. The test suite `schema.js/engine.js — alpha.3 E4 draft budget` keeps
`SBSchema.limits().draftPxCap`, `limits().fabMsPerMpx` and the preset `draftPx` values equal to the recorded
decision, and checks that `decideDraft` reproduces that decision from the recorded rows.

## Decision

| | Value |
|---|---|
| Plywood preset `geometry.draftPx` | **720** |
| Acrylic preset `geometry.draftPx` | **720** |
| Desktop `draftPxCap` | **720** (the larger of the two preset values) |
| Mobile `draftPxCap` | **720** (mobile is about 4× slower; k is provisional, as in D.8) |
| Desktop `fabMsPerMpx` | **2410** ms/Mpx (mobile: 4 × 2410 = 9640) |
| Plywood height mode (workload b, reported) | 1024 would qualify; not used, because the preset follows the auto-tonal route (a) |

`rasterPlan(project, source, "draft", deviceClass)` sizes the draft at `min(geometry.draftPx, limits(deviceClass).draftPxCap)`
on the long side. The cap is not a project field, so the project key, and with it every `geometryHash` and repair
`keyHash`, is the same on every device.

This matches the plan's expected outcome: 720 px, not the 2–4 Mpx the user asked for. The way to see exact
detail is "Preview at fabrication resolution" (E6).

## Rule

For each preset, `draftPx` is the largest candidate in {720, 1024, 1280, 1536, 2000} whose **warm-cache p95** is
**≤ 3.0 s on both the realistic and the busy art family** for the preset's workload: plywood uses (a) auto-tonal,
acrylic uses (c) connected. The reference machine is the i7-11800H. When no candidate qualifies, the value is 720
and the miss is recorded as a known gap that points at G4.1. The desktop cap is the larger of the two preset values,
and the mobile cap is 720.

**Deviation from G4.4.** 3.0 s p95 is twice G4.4's desktop draft target (p95 ≤ 1.5 s). That target needs the G4.1
worker pool. G4.4 re-measures against 1.5 s.

**Re-run after E11.** Stage-14 guides run in every draft. E11 re-runs `node test/bench.js draft --record` and may
lower the decision. The E4 test keeps the schema in step with the file.

## Method

- **Source.** 4096 × 3084 RGBA (12.6 Mpx, the size of the user's colour illustration). It is built from the bench's
  art generators: realistic (`F.heightMap`, seed 2022) and busy (`F.busyHeightMap`, seed 11, 27 px cells). The colour
  channels follow the E3 suite: R = g, G = 3g mod 256, B = 255 − g.
- **Workloads.**
  - (a) plywood auto-tonal: tonal, light-front, smoothing 1.65 mm × 2 passes (E3b), bonded (D1, unsmoothed),
    8 sheets, 300 mm high.
  - (b) plywood height: white-high, bonded, 8 sheets. Reported only.
  - (c) acrylic connected: tonal dark-front, smoothing 1.65 mm × 2, smooth corners, 5 sheets, 300 mm wide
    (KI-CONN-PERF).
- **Runs per row.** `SBEngine.generate` at quality `"draft"` with a caller-owned draft cache (E3). Each row has
  1 cold run (empty cache), 3 warm-ups and 15 warm runs. Between warm runs, `construction.sheets` alternates
  (8 ↔ 7, or 5 ↔ 4 for acrylic) and the revision changes, so construct reruns while K1/K2 stay warm.
- **Early stop.** Candidates run in ascending order. A mode/family pair stops at the first candidate whose warm p95
  is over 3.0 s, because larger rasters are never faster. `--all` turns this off. The skipped candidates are listed
  in the JSON.
- **Overlay share.** The time spent in the draft change-overlay polygons (`SBEngine.maskPolygons` for
  `e.added`/`e.removed`, bridges excluded) divided by the construct-stage time, summed over the warm runs.
- **Fabrication rows.** Workload (a) at the fabrication raster (3985 × 3000, 11.96 Mpx at 0.1 mm/px), with no
  cache (as in the app). Each family gets 1 cold run and 5 timed runs. `fabMsPerMpx` is the larger p50 ÷ Mpx among
  the rows that finished, rounded up to 10 ms.
- **Device cap during the bench.** The bench wraps `SBSchema.limits` for its own run so that the shipped cap does not
  clamp the candidates it measures.

## Results (2026-10-08, i7-11800H, Node v26.7.0, single thread)

Times are in ms. "Limit" means the run ended with `COMPLEXITY_LIMIT`: busy art exceeds the desktop parts cap of
258 parts/layer (G2.7b) in bonded mode. Those rows time the rejection, which is what the user waits for.

| Mode | Family | draftPx | Raster | Status | Cold | Warm p50 | **Warm p95** | Overlay share |
|---|---|---|---|---|---|---|---|---|
| (a) | realistic | 720 | 720×542 | done | 3604 | 1764 | **1974** | 0.44 |
| (a) | realistic | 1024 | 1024×771 | done | 4769 | 2752 | **3216** | 0.39 |
| (a) | busy | 720 | 720×542 | limit | 3299 | 1938 | **2180** | 0.77 |
| (a) | busy | 1024 | 1024×771 | limit | 4953 | 3424 | **3767** | 0.75 |
| (b) | realistic | 720 | 720×542 | done | 1137 | 1001 | 1054 | 0.29 |
| (b) | realistic | 1024 | 1024×771 | done | 2222 | 1728 | 1812 | 0.29 |
| (b) | realistic | 1280 | 1280×964 | done | 3113 | 2517 | 3350 | 0.29 |
| (b) | busy | 720 | 720×542 | limit | 1980 | 1511 | 1732 | 0.74 |
| (b) | busy | 1024 | 1024×771 | limit | 2946 | 2597 | 2910 | 0.71 |
| (b) | busy | 1280 | 1280×964 | limit | 3901 | 3530 | 3884 | 0.66 |
| (c) | realistic | 720 | 720×542 | done | 10192 | 8574 | **8903** | 0.23 |
| (c) | busy | 720 | 720×542 | done | 27229 | 26073 | **28511** | 0.35 |

| Fabrication (a) | Raster | Status | p50 | ms/Mpx |
|---|---|---|---|---|
| realistic | 3985×3000 (11.96 Mpx) | done | 28818 | **2410** |
| busy | 3985×3000 (11.96 Mpx) | limit | 58138 | (rejected after construct; not used) |

**Reading the results.**

- **Plywood (a): 720.** At 720 px the warm p95 is 1.97 s (realistic) and 2.18 s (busy). At 1024 px both families
  miss: 3.22 s and 3.77 s. The realistic 1024 row overlapped a test-suite run on the same machine, but the busy row
  misses by a wider margin, so the decision does not depend on it.
- **Acrylic (c): 720 is a known gap.** Even at 720 px the warm p95 is 8.9 s (realistic) and 28.5 s (busy), far
  over 3.0 s. The rule keeps 720 and records the miss (KI-CONN-PERF). The cost is connected smoothing and the
  T-junction split after construct, not the raster size, so a smaller raster would not fix it. G4.1, the worker
  pool and/or smoothing optimisation, is the fix.
- **Height mode (b)** qualifies at 1024 on both families (1.81 s and 2.91 s). It is recorded as information only.
  A per-mode draft size is not part of alpha.3.
- **Cold runs** (new source, smoothing change) cost 3.6 s at 720 px for (a). Orient, resample and Kuwahara on the
  12.6 Mpx source dominate, and E3 caches them for warm edits.

## Draft overlay polygons: `opts.overlays:false` ships

The change-overlay polygons take **44 %** of construct on the gating row ((a) realistic at 720) and 39–77 % on
the others, which is above the 15 % threshold (E.5). `SBEngine.generate(req, {overlays: false})` therefore skips
`cleanupReport[k].added/.removed`. The mm² figures stay. The overlays are display data outside the hash input,
so `geometryHash` is unchanged (check `G2.13b overlays:false omits added/removed, geometryHash unchanged`).
Whether and when the app passes `overlays: false` (for example, only while the overlay toggle is off) is decided in
E5. The budget above was measured with overlays **on**, so it is conservative.

## Why 2–4 Mpx is not interactive on the main thread

A 2–4 Mpx draft is about 1600–2300 px on the long side of a 4:3 image. Warm construct grows about in
proportion to the pixel count: (a) goes from 0.65 s at 720 px to 1.23 s at 1024 px (×1.9 for ×2.0 pixels), and
the busy family goes from 1.9 s to 3.3 s. A linear fit of the (a) realistic warm p50 (1.76 s at 0.39 Mpx,
2.75 s at 0.79 Mpx) gives about 0.8 s + 2.5 s/Mpx: about 5.7 s per warm edit at 2 Mpx and 10.7 s at 4 Mpx. Cold
runs and the busy family take longer, and the page is frozen the whole time because there is no worker before G4.1. That is the multi-second freeze per edit that alpha.3 is
meant to remove. The fabrication preview (E6) shows exact detail on request instead. A user "draft detail" choice
(for example 2.5 Mpx Fine) is deferred until the G4.1 worker exists (Appendix E.8, question 2).

## Known gaps (for the E14 table)

- The acrylic/connected draft misses 3.0 s even at 720 px (8.9 s realistic, 28.5 s busy): KI-CONN-PERF, G4.1.
- The plywood draft meets 3.0 s, not G4.4's 1.5 s: G4.1, then G4.4 re-measures.
- In bonded mode, busy art is rejected by the parts cap at draft quality after about 2 s warm. At fabrication the
  rejection takes about 58 s, because construct runs before the complexity gate (G2.10a stage order). That is
  reported here, not changed.
- Changing a preset's `draftPx` changes the fabrication `geometryHash` (E.5, `draftPx` is in `geometryKey`). E4
  keeps 720, so nothing resets now. A later change (E11 re-run, G4.4) resets fabrication acknowledgements and makes
  clips `REPAIR_STALE` once.
- Background load during the run: the 1-minute load average was 4.3–7.0 during the draft rows (desktop processes,
  16 threads) and rose to 38 during the busy fabrication row, so that row and the late (c) busy row are loaded figures.
