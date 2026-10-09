# Draft budget (alpha.3 E4, re-measured in speed round F17)

Plan Appendix E, task E4 (`PO-PREVIEW-1`, `PO-PREVIEW-2`; amends PO-LASER-4), re-measured in plan Appendix F, task F17
(S3, `PO-PERF-3`) once the worker pool (F9–F16) ran the draft off the page. Raw data and the decision:
`draft-budget.json` (`decision`, `rule`, `f17`; the E4 record is kept under `e4`). The suite
`schema.js/engine.js — alpha.3 E4 draft budget (PO-PREVIEW-1)` keeps `SBSchema.limits()` (`draftPxCap`,
`draftPxFallback`, `fabMsPerMpx`, `fabMsPerMpxFallback`) and both presets' `draftPx` equal to the recorded decision,
and checks that `decideDraftF17` (`test/bench.js`) reproduces that decision from the recorded rows.

## F17 decision (2026-10-09): 720 px stays; no candidate meets the 2.5 s rule

| | Value |
|---|---|
| Plywood and Acrylic preset `geometry.draftPx` | **720** (unchanged) |
| Desktop `draftPxCap` (pooled draft) | **720** (unchanged) |
| Mobile `draftPxCap`, `draftPxFallback` (no-worker fallback, both device classes) | **720** |
| Desktop `fabMsPerMpx` (pooled fabrication, the busy text's estimate) | **720** ms/Mpx (was 2410; mobile 4 × = 2880) |
| Desktop `fabMsPerMpxFallback` (sync driver on the page, `fabBusyText(dc, true)`) | **1640** ms/Mpx (mobile 4 × = 6560) |
| M5 Air (Chromium, ≤ 3.0 s) | **not measured** (the machine was not available to this run; `decision.m5: "pending"`) |

**Rule (F.7, PO-PERF-3).** The desktop draft is the largest of {1280, 1536, 1792, 2000} whose warm p95 is
**≤ 2.5 s in Chromium and in Firefox on the i7-11800H** (0.5 s under the E4 3.0 s rule) and ≤ 3.0 s in Chromium on
the M5 Air, on **both** the realistic and the busy art family, with the E4 warm edit (sheets 8 ↔ 7, the revision
changing, K1/K2 hit); a size whose draft of the alpha.3 scene hits a complexity cap that the 720 draft does not hit is
rejected (F.4 #5); the smaller decision wins; 720 when none qualifies. Both presets take the decision; mobile and the
fallback keep 720 through the request's `draftCapPx` (F-D5). The browser rows decide; the Node rows support them.

**Result.** Chromium misses 2.5 s already at 1280 px on the realistic family (warm p95 **2657 ms**; p50 2434 ms), and
Firefox misses by more (3314 ms). Every candidate is therefore rejected (`decision.rejected`), and the rule keeps
720. The busy family passes everywhere (it is rejected by the parts cap before stage 14, as in E4), and the alpha.3
scene hits no cap at any size (parts ≤ 59, vertices ≤ 4386 per layer), so neither of those decides. **Known gap
(PO-PERF-3 not met):** the realistic draft at 1280 needs about 0.2 s (Chromium) to 0.8 s (Firefox) more. The serial
profile shows where: at 720 the guide stage is 1414 ms of a 2964 ms warm draft (48 %); the pool runs it as two batches
(`buildPair` items, the build fold, then `validatePair` items), so the slowest pair is waited for twice. F18's
candidates "one item per guide pair" (build + validate fused) and per-layer complexity estimation are the next step; F18 or G4.4 re-runs this sweep (`tools/bench_draft_browser.mjs`, then `node test/bench.js draft-decide`).
Nothing reset: no preset `draftPx` changed, so no fabrication `geometryHash`, acknowledgement or repair `keyHash` moved.

**Saved projects (Q2).** `draftPx` is user-visible (legacy `procRes`), so a raised default is never applied
silently: `SBSchema.draftPxOffer(project, deviceClass)` offers it once to a project still at 720 on a device whose
cap allows it (`#draft-offer`, "Use the finer draft" / "Keep 720 px"), and `SBSchema.applyDraftOffer` applies it only
on that click (revision + 1, `extras.history` `draft-default`) or records the refusal (`extras.draftOffer`). With the
decision at 720 the offer never shows; it is live for the next re-measurement.

### Browser rows (the rule's numbers; ms, edit → painted draft)

`tools/bench_draft_browser.mjs --browser chromium|firefox --sizes 720,1280,1536,1792,2000 --record`: the built
bundle over http (Blob-worker pool, P = 8 helpers on 16 threads), desktop cap raised to 2000 for the measurement only,
`?bench=draft&draftPx=N`. Per family: the cold draft after the source install, 3 warm-ups + 15 warm edits, 7 K2-miss
edits (smoothing 1.65 ↔ 1.70 mm). "Render" is the result's receipt → painted frame (`applyDraft`, `preview.setSnapshot`,
overlays, paint), p95. Busy rows end in `COMPLEXITY_LIMIT` (they time the rejection, as in E4).

| Browser | draftPx | Raster | realistic warm p50 / **p95** | K2-miss p95 | cold | render p95 | busy warm **p95** |
|---|---|---|---|---|---|---|---|
| Chromium 152 | 720 | 720×542 | 1406 / **1548** | 1767 | 3693 | 81 | **572** |
| Chromium 152 | 1280 | 1280×964 | 2434 / **2657** | 2849 | 5230 | 147 | **943** |
| Chromium 152 | 1536 | 1536×1157 | 2546 / **2950** | 2978 | 5836 | 89 | **1093** |
| Chromium 152 | 1792 | 1792×1349 | 3119 / **3452** | 3631 | 6655 | 117 | **1450** |
| Chromium 152 | 2000 | 2000×1506 | 3295 / **3516** | 4005 | 7113 | 102 | **1641** |
| Firefox 155 | 720 | 720×542 | 1827 / **2116** | 2148 | 2808 | 46 | **619** |
| Firefox 155 | 1280 | 1280×964 | 3049 / **3314** | 3518 | 3989 | 55 | **1020** |
| Firefox 155 | 1536 | 1536×1157 | 3440 / **3692** | 4137 | 4765 | 54 | **1078** |
| Firefox 155 | 1792 | 1792×1349 | 3899 / **4224** | 4471 | 5710 | 96 | **1342** |
| Firefox 155 | 2000 | 2000×1506 | 3994 / **4447** | 4842 | 5693 | 50 | **1604** |

The pooled 720 draft is **1.55 s** p95 in Chromium (E11 serial, Node: 3.76 s). The bench's `longTaskMaxMs` (≈ 2.0 s,
Chromium) is the bench building the 4096 × 3084 synthetic art on the page before the run, not the draft path.

### Node rows (supporting; `node test/bench.js draft --draft-sweep 720,1280,1536,1792,2000 --pool 8 --record`)

Same workload and edits through `SBPool` on worker threads (8 helpers) with overlays on; 3 cold runs (a new source
identity each), 3 + 15 warm, 7 K2-miss. 1-minute load average 3.6–7.4 (desktop processes on the same machine).

| draftPx | realistic warm p50 / **p95** | K2-miss p95 | cold p95 | parts ≤ / vertices ≤ per layer | busy warm p95 (limit) | alpha.3 scene: cold ms, parts ≤, vertices ≤, caps |
|---|---|---|---|---|---|---|
| 720 | 1251 / **1358** | 1434 | 3566 | 126 / 9148 | 904 | 695, 59, 1916, none |
| 1280 | 2058 / **2227** | 2399 | 2841 | 136 / 16410 | 1610 | 1184, 55, 3026, none |
| 1536 | 2371 / **2653** | 2911 | 3056 | 122 / 18170 | 2156 | 1525, 51, 3490, none |
| 1792 | 2811 / **2989** | 3215 | 3680 | 132 / 21756 | 2512 | 1745, 51, 3968, none |
| 2000 | 2965 / **3450** | 3652 | 4105 | 118 / 22496 | 2908 | 2016, 38, 4386, none |

Chromium ran ≈ 1.2× Node at 1280 (2657 / 2227), as F.0 #1 expected. Sync driver (`--pool 0`) at 720: realistic warm
p95 2964 ms (guides 1414 ms p50), busy 1392 ms. The pooled stage columns in the JSON are the coordinator's progress
marks (batch boundaries), so their names do not split the time like the serial ones.

**Fabrication (`fabMsPerMpx`).** Workload (a), realistic, 3985 × 3000 (11.96 Mpx), 1 cold + 3 runs: pooled p50
**8503 ms** (711 ms/Mpx → 720), sync driver p50 **19572 ms** (1637 ms/Mpx → 1640). The busy text's estimate now uses
the pooled figure for a pooled run and the sync figure in the fallback branch.

## E4 decision (2026-10-08, history)

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

### E4: Rule

For each preset, `draftPx` is the largest candidate in {720, 1024, 1280, 1536, 2000} whose **warm-cache p95** is
**≤ 3.0 s on both the realistic and the busy art family** for the preset's workload: plywood uses (a) auto-tonal,
acrylic uses (c) connected. The reference machine is the i7-11800H. When no candidate qualifies, the value is 720
and the miss is recorded as a known gap that points at G4.1. The desktop cap is the larger of the two preset values,
and the mobile cap is 720.

**Deviation from G4.4.** 3.0 s p95 is twice G4.4's desktop draft target (p95 ≤ 1.5 s). That target needs the G4.1
worker pool. G4.4 re-measures against 1.5 s.

**Re-run after E11.** Stage-14 guides run in every draft. E11 re-runs `node test/bench.js draft --record` and may
lower the decision. The E4 test keeps the schema in step with the file.

**Re-run after E11 (2026-10-09): decision unchanged, 720 px; plywood now misses the 3.0 s target.** Stage 14
(`SBGuides.build` + `validate`, inset-outline) runs in every bonded draft. Measured with
`node test/bench.js draft --only a --candidates 720 --no-fab` (same method: 1 cold + 3 warm-ups + 15 warm runs;
1-minute load average 3.6–5.5), i7-11800H:

| (a) plywood auto-tonal, 720 px | E4 (no guides) warm p50 / p95 | E11 (guides) warm p50 / p95 | cold E4 → E11 |
|---|---|---|---|
| realistic | 1763.8 / 1973.9 ms | 3316.3 / 3762.3 ms | 3603.5 → 5486.2 ms |
| busy (COMPLEXITY_LIMIT before stage 14) | 1938.1 / 2180.1 ms | 1921.4 / 2115.3 ms | 3298.7 → 3185.1 ms |

On the realistic family the guides add about 1.6–1.8 s per warm draft (profile of one warm draft: build ≈ 0.8 s,
validate ≈ 0.9 s; Clipper offsets ≈ 0.5 s, polyline buffers ≈ 0.5 s, intersections ≈ 0.35 s, on 4–9 k-vertex
unsmoothed bonded layers). E11 already cut the label placement from ≈ 0.7 s to ≈ 0.2 s by placing each sheet number
in one concealed polygon at a time, largest first. 720 px is the smallest candidate, so the rule keeps it ("720 when
none qualifies") and `draft-budget.json` is not re-recorded (its rows and decision stand; the E4 check reproduces
that decision). **Known gap:** the plywood (bonded) draft now has warm p95 ≈ 3.8 s at 720 px, above the 3.0 s
target; the fixes are the G4.1 worker pool (off the main thread) and, if the product owner chooses, guides at
fabrication only (E-R4: only on this bench evidence, never silently). The busy family is unaffected because it is
rejected by the parts cap before stage 14. The fabrication share of stage 14 (E-R4, `node test/bench.js large`) was
not measured in E11 (the long large-image bench was out of scope for this run); it is still owed.

### E4: Method

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

### E4: Results (2026-10-08, i7-11800H, Node v26.7.0, single thread)

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

### E4: Draft overlay polygons: `opts.overlays:false` ships

The change-overlay polygons take **44 %** of construct on the gating row ((a) realistic at 720) and 39–77 % on
the others, which is above the 15 % threshold (E.5). `SBEngine.generate(req, {overlays: false})` therefore skips
`cleanupReport[k].added/.removed`. The mm² figures stay. The overlays are display data outside the hash input,
so `geometryHash` is unchanged (check `G2.13b overlays:false omits added/removed, geometryHash unchanged`).
Whether and when the app passes `overlays: false` (for example, only while the overlay toggle is off) is decided in
E5. The budget above was measured with overlays **on**, so it is conservative.

### E4: Why 2–4 Mpx is not interactive on the main thread

A 2–4 Mpx draft is about 1600–2300 px on the long side of a 4:3 image. Warm construct grows about in
proportion to the pixel count: (a) goes from 0.65 s at 720 px to 1.23 s at 1024 px (×1.9 for ×2.0 pixels), and
the busy family goes from 1.9 s to 3.3 s. A linear fit of the (a) realistic warm p50 (1.76 s at 0.39 Mpx,
2.75 s at 0.79 Mpx) gives about 0.8 s + 2.5 s/Mpx: about 5.7 s per warm edit at 2 Mpx and 10.7 s at 4 Mpx. Cold
runs and the busy family take longer, and the page is frozen the whole time because there is no worker before G4.1. That is the multi-second freeze per edit that alpha.3 is
meant to remove. The fabrication preview (E6) shows exact detail on request instead. A user "draft detail" choice
(for example 2.5 Mpx Fine) is deferred until the G4.1 worker exists (Appendix E.8, question 2).

### E4: Known gaps (for the E14 table)

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
