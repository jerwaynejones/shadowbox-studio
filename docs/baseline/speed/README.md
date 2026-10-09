# Speed round: end-to-end browser verification (S2, S3)

`node tools/verify_speed.mjs` (2026-10-09, HEAD 2bbb3f8, v2.0.0-alpha.4). The script uses headless Chromium 
over the DevTools protocol and runs the built bundle `dist/shadowbox-studio.html` over http on a free
127.0.0.1 port (Blob-worker rung). It starts one fresh browser per run and kills the server and browsers
afterwards. Raw data is in `report.json`. `report_lowload.json` holds an earlier, smaller run made at
lower load.

> **Machine load: the numbers are noisy.** The i7-11800H (16 threads, 62.5 GiB) was shared with unrelated
> workloads during the main run: `lean`, `npm exec mocha` and several `node` processes from other projects.
> The 1/5/15-min load average was 11.3/15.6/12.1 at the start and 20.7/28.9/23.5 at the end.
> When the task started it was 5.62/7.38/6.61; the top processes then were `npm` 123 %, `fuser` 100 % and
> DisplayLinkManager 68 %. The low-load smoke run started at a 1-min load of 5.56 (`report_lowload.json`;
> 300 mm only, 1536 px candidate only, 5 sheet edits, no K2-miss edits). Treat the main-run times as
> pessimistic, especially the serial runs (they are single-threaded on the page and the most load-sensitive)
> and the 470 mm drafts.

## Setup

- Fixture: `tools/alpha3_scene.js` at 4096 × 3084. It is deterministic (fixed-seed LCG) and written as an
  8-bit RGB PNG; its sha256 is in `report.json`.
- Settings, applied through the controls: xTool S1 (feeder), Plywood, Bonded relief, size by height
  300 mm and 470 mm, pitch 0.1 mm/px, 8 sheets.
- Pages:
  - `shipped`: the bundle as built. `DRAFT_BUDGET.desktopDraftPx` = **720**, because F17 kept 720.
  - `draft1536` / `draft2000`: the bundle with `desktopDraftPx` raised to that value, for measurement
    only. The presets follow it, so a new project drafts at N px as if N were shipped.
  - `serial`: the shipped bundle with the `Worker` constructor disabled before load, which forces the
    pool's serial fallback.
- Measurements:
  - Cold draft: from setting the file input to the first painted draft.
  - Warm draft: sheets 8 ↔ 7, 2 warm-ups and then 8 timed edits. Each edit is timed from the input/change
    dispatch to the painted draft, so the app's 300 ms edit debounce is included. `runMs` is the pool's
    submit → done time.
  - K2-miss edits: smoothing radius +0.05 mm and back, 8 edits.
  - Fabrication preview: from the button click to the painted `Fabrication ·` status.
  - Export: from acknowledging all warnings and clicking Download to the completed download.
  - Long tasks: PerformanceObserver `longtask` (buffered), the maximum within each phase window.
  - Hashes: geometryHash and the per-layer layerHash of every snapshot, computed after the timed phases.

## Results (main run, loaded machine)

| run | draft raster | cold draft | warm p50 / p95 (sheets) | K2-miss p50 / p95 | fab preview | export | longest task (warm / fab) |
|---|---|---|---|---|---|---|---|
| shipped @300 (pool) | 720 × 542 | 4.0 s | 0.87 / 1.04 s | 1.05 / 1.23 s | **7.5 s** | 0.68 s | 129 / 177 ms |
| draft1536 @300 (pool) | 1536 × 1157 | 5.0 s | 1.30 / **1.75 s** | 1.66 / 1.76 s | — | — | 140 ms |
| draft2000 @300 (pool) | 2000 × 1506 | 5.0 s | 1.83 / **2.28 s** | 2.07 / 2.35 s | — | — | 157 ms |
| serial @300 (fallback) | 720 × 542 | 3.0 s | 2.41 / 5.10 s | 6.1 / 9.3 s | 64.5 s | 3.3 s | 4.4 s / 63.5 s |
| shipped @470 (pool) | 720 × 542 | 18.9 s | 3.53 / 4.26 s | 1.78 / 3.47 s | **6.4 s** | 0.83 s | 732 / 218 ms |
| draft1536 @470 (pool) | 1536 × 1157 | 4.7 s | 4.52 / 6.99 s | 2.38 / 4.18 s | — | — | 761 ms |
| draft2000 @470 (pool) | 2000 × 1506 | 6.3 s | 2.37 / 3.15 s | 2.50 / 2.75 s | — | — | 241 ms |
| serial @470 (fallback) | 720 × 542 | 3.6 s | 1.41 / 1.96 s | 1.78 / 2.09 s | 18.1 s | 1.1 s | 1.5 s / 18.0 s |

The 470 mm drafts are slower than the 300 mm drafts and their order is inconsistent: the 2000 px run beat
the 1536 px run, and the shipped 720 px cold draft took 18.9 s. That pattern tracks the load peak
(5-min load ~29), not the draft size. The draft raster is the same at both heights.

Low-load reference (`report_lowload.json`, 1-min load ~5.6, 300 mm):

| run | cold | warm p50 / p95 | fab preview | export |
|---|---|---|---|---|
| shipped (720) | 3.2 s | 0.93 / 1.09 s | **6.6 s** | 0.58 s |
| draft1536 | 4.0 s | 1.40 / **1.86 s** | — | — |
| serial | 2.8 s | 1.35 / 1.48 s | 13.1 s | 0.75 s |

Fabrication raster: 3985 × 3000 (12.0 Mpx) at 300 mm and 4096 × 3084 (12.6 Mpx) at 470 mm. At 470 mm the
raster is capped at the source resolution, because 624 mm / 0.1 would be 6242 px. That is why the 470 mm
fab time is close to the 300 mm one.

## Checks

- **Workers:** the pool ran on the `blob` rung with P = 8 helpers (`helperCount(16, desktop)`). 11 Worker
  constructions were made: `sb-coord`, `sb-helper-1…8`, a spare `sb-coord` and `sb-helper-spare`.
  The serial page made 0 (`mode: "fallback"`).
- **Pool vs serial equality:** at both heights the fabrication geometryHash and all 8 layerHashes are
  identical (300 mm `0cb9e9fd…`, 470 mm `4238a9e5…`). The 720 px draft geometryHash and layerHashes are
  also identical between pool and serial.
- **SAMPLING_LOW:** none on any draft (720, 1536 or 2000 px) or fabrication snapshot. The 720 px draft
  carries `DRAFT_COARSER` (info) only, and no draft has a blocking code.
- **Export:** the 300 mm ZIP is 3.19 MB and the 470 mm ZIP is 4.37 MB. Export reused the fabrication
  snapshot: there were 0 generate/submit calls during export.
- **Page exceptions:** none in any run.

## Screenshots and crops

- `crop_*.png`: edge crops at device scale 2 in the Palette proof (Midnight) colouring. Each crop shows,
  left to right, the 720 px draft (the alpha.3 size, still shipped), the 1536 px candidate draft and the
  fabrication preview, at 300 mm.
- `shipped_{300,470}_{draft_proof,fab_proof,fab_layers,fab_review}.png` and
  `draft1536_{300,470}_draft_proof.png`: full-page screenshots.

## Against the targets

| target | measured | verdict |
|---|---|---|
| S2: fabrication preview ≤ 10 s (stretch 5 s), pooled | 7.5 s / 6.4 s (loaded); 6.6 s (low load) | **met**; stretch not met |
| S2: serial fallback | 64.5 s / 18.1 s (loaded); 13.1 s (low load) | fallback only (expected to be slower) |
| S3: draft ≈ 1536–2048 px within 3.0 s warm | shipped draft is **720 px** (F17 decision). The 1536 px candidate measured 1.75 s p95 (low load 1.86 s); 2000 px measured 2.28 s p95 at 300 mm. At 470 mm the 1536 px candidate measured 6.99 s / 4.18 s under load peak | **not met as shipped** (720 px). The candidates fit 3.0 s at 300 mm on this workload, but not reliably under load at 470 mm |

S3 at HEAD: the size target is not met, because the shipped draft is still 720 px. The sheet-count and
smoothing edits here are lighter than F17's "realistic" bench family, which set the 2.5 s rule and
rejected 1280+. These results therefore do not overturn the F17 decision by themselves. They show that
on the user's own scene, a 1536–2000 px draft meets 3.0 s warm at 300 mm. A re-measurement on an idle
machine is needed before any decision changes.
