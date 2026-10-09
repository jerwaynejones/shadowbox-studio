# Changelog

## v2.0.0-alpha.4 — 2026-10-09, speed round (worker pool)

A speed round before G3 (plan Appendix F), asked for by the product owner after the alpha.3 test: the fabrication
preview of the user's 12 Mpx bonded colour illustration took about 28 s and froze the page. The G4.1 worker pool is
pulled forward, the hot kernels are faster on one thread, and the draft no longer blocks on a fabrication-only
sampling rule. Every change is **bit-identical** to the serial engine (whole response minus timing, including
`geometryHash`, `layerHashes` and the diagnostics order) for every pool size and completion order, except the
intentional S4 diagnostic change below. The engine version (`1.0.0-dev`) is unchanged; the release label is
`2.0.0-alpha.4` (`APP_VERSION`, `sw.js` `VERSION`, `WORKER_APP_VERSION`). It is still not SRS-compliant (plan R9).

- **PO-PERF-1, the engine runs off the main thread (F9–F16).** `SBEngine.generate` is a generator (`runSteps`) that
  yields a batch at every parallel point and folds the results in item order; the sync driver (`SBEngine.generate`,
  unchanged signature) and the async driver (`SBEngine.generateAsync`) call the same kernels from the frozen
  `SBEngine.TASKS` table. In the page, `SBPool` runs one coordinator worker plus up to 8 helper workers (4 on mobile):
  construct, trace and conversion, support pairs, feature checks, guides, layer hashes and the row-band area resample
  and Kuwahara kernels run in parallel, in a fixed merge order. Helpers are admitted only after a `hello` with the
  same engine version, app version and build-time `modulesHash`. Results are accepted by `runId` (`SBDiag.acceptResult`),
  so a stale draft is never shown. The page shows a progress bar and stage label; the fabrication preview has a Cancel
  button, and an edit restarts an in-flight fabrication ("fabrication restarted"). `dist/` runs the pool from a Blob
  worker built from the inlined module texts; when no worker can start (`index.html` from `file://`, a refused Blob
  worker) the app runs the serial fallback with the notice "Background processing is unavailable; the preview runs on
  the page (reduced responsiveness).", at the 720 px draft cap.
- **PO-PERF-2, the 12 Mpx fabrication preview.** Serial (the fallback): 25.3 s → 12.0 s p50 on the i7 in Node after
  the single-thread work (F3–F8). Pooled with 8 helpers: 8.8 s in one Node run after F11 (12.9 s serial in the same
  session), 8.5 s p50 on the realistic bench art at 12 Mpx (19.6 s with the sync driver, F17); the page's longest
  main-thread block during a pooled 12 Mpx run was 13.5 ms in Node. The final `bench large --only user12 --pool 0,1,8`
  record and the Chromium figure (`?bench=fab`) are pending (`docs/perf/speed-round.json` `final`).
- **PO-PERF-3, the draft budget re-measured with the pool (F17).** No candidate in {1280, 1536, 1792, 2000} reaches
  warm p95 ≤ 2.5 s in both Chromium and Firefox on the i7 (Chromium realistic 1280: 2657 ms), so the desktop draft
  stays at **720 px** for both presets. The pooled 720 px draft is 1548 ms warm p95 in Chromium (alpha.3: 3.8 s serial in
  Node). Mobile and the fallback keep 720 through the explicit request field `draftCapPx` (F-D5). The fabrication
  estimate uses 720 ms/Mpx pooled and 1640 ms/Mpx in the fallback. A project at 720 px would be offered a raised
  default once, applied only on the user's click; the offer is inert while the decision is 720.
- **PO-PERF-4, sampling judged at the fabrication pitch (F1, F-D1).** `SAMPLING_LOW` is judged on the fabrication
  raster plan at both qualities, so a plywood draft no longer blocks on a draft-only shortfall; it reports the new info
  `DRAFT_COARSER` ("Draft sampling is below 3 samples per minimum feature"; the minimum feature is checked at the
  fabrication pitch). A coarse
  fabrication pitch still blocks. Draft diagnostics and their acknowledgements change; no hash changes.
- **PO-PERF-5, measured stages and faster kernels (F2–F8).** The bench reports every stage, the guide stage (stage 14)
  split into build and validate, at draft and fabrication. Single-thread kernels, each with a verbatim oracle and a
  byte-equality test: streaming exact area resample in row bands (no 393 MB `rows` buffer at 12 Mpx), branch-free
  `windowAny` with fused erode/dilate and fused dilations, run-based hole filling and speck removal, a Kuwahara interior
  fast path and a band kernel that rebuilds SAT rows byte-equal to the global SAT from a seed row, a typed corner table in
  `T.trace`, and draft change overlays cropped to the change box. KI-B1 (B1 p95 1990 ms against 2 s, 2026-10-09) and
  KI-CONN-PERF stay tracked.
- **Updates (F10, F-D3).** The service worker no longer activates a new version on its own: the status bar offers
  "Update available — reload" when nothing is unsaved and no export or fabrication run is in flight. `js/worker.js` and
  `js/pool.js` are precached.
- **Deviations.** F-D1 (sampling at the fabrication pitch), F-D2 (cooperative cancel first, `terminate()` after 300 ms),
  F-D3 (only the minimal G4.0 lands), F-D4 (packaging stays on the main thread), F-D5 (the draft cap depends on the
  runtime through `draftCapPx`), F-D6 (the NFR-04 working set is measured and recorded, not yet inside 512 MiB).
- **Tests and tools.** A pool-equality golden corpus (F0, `test/golden/pool-equality.json`), an adversarial
  completion-order executor over 20 seeds (F12), a Node worker shim (`test/node_worker_shim.js`), a browser harness
  (`test/browser.html?run`), in-app `?bench=fab|draft|cancel`, `bench draft --draft-sweep … --pool N` and
  `bench large --only user12 --pool 0,1,8` (per pool size: p50/p95, geometryHash equality, Node RSS/arrayBuffers and the
  coordinator's `estBytes` ledger peak).

### Known gaps (alpha.4)

| Area | Gap in alpha.4 | Arrives in |
|---|---|---|
| S2 record | The final `bench large --only user12 --pool 0,1,8` run, the 25 Mpx memory row and the Chromium `?bench=fab` p95 and long-task maximum are not yet recorded; the 10 s target is supported by single-run and realistic-art figures only | measurement run (F18), G4.4 |
| MacBook Air M5 | Neither the draft decision nor the fabrication figures have been measured on the M5 (`draft-budget.json` `decision.m5` pending) | G4.4 |
| Draft size | Still 720 px: guides are about half of the warm draft, and the per-pair guide item and other F18 candidates are not applied | G4.4 |
| Working set (NFR-04) | The estimated working set at 12–25 Mpx exceeds 512 MiB (serial 12 Mpx Node RSS 588 MB); the pool admits work through one `estBytes` ledger but fabrication resolution is never lowered (F-D6) | G4.4 |
| Cancel without shared memory | On ordinary `file://`/http pages (no cross-origin isolation) a coordinator inside a long serial kernel is stopped by the 300 ms watchdog, so the next draft after such a cancel is cold | — (by design, F-D2) |
| Packaging | ZIP and SVG packaging still run on the main thread (F-D4) | G4.1 |
| KI-B1 | The B1 geometry benchmark sits at the 2 s budget (p95 1990 ms in one run); `SBGeom` normalize work is not done | G4.4 |
| KI-CONN-PERF | Connected mode with smooth corners is still slow; the pool helps the per-layer stages only, and the `smoothStack` barrier stays serial | G4.1/G4 |
| Update UI | Only the user-gated update offer; the cache and update status UI of G4.0 is not built | G4.0 |
| Everything listed for alpha.3 | Labels, registration holes, `.sbrproj`, manifest and layout, settings re-import, presets, calibration are unchanged from alpha.3 | see alpha.3 |

## v2.0.0-alpha.3 — 2026-10-09, real-engine preview and bonded alignment

A patch round before G3 (plan Appendix E), triggered by the alpha.2 user test on the target setup (xTool S1 40 W
diode with feeder, 1/4" basswood/poplar ply, colour illustrations about 4096 × 3084, bonded relief). It is still not
SRS-compliant (plan R9); the known-gaps table below lists what is missing. G3.1 (stage 14 only), G3.2 (digits and the
interior point), G3.3 (inset-outline, position-only interior-mark, sheet numbers) and G3.5 (placement map file,
bonded assembly text) are pulled forward in part.

- **PO-PREVIEW-1, the preview is the real engine (E1–E5).** Proof, Section, Layers cards, Tilt, overlays, the draft
  diagnostics and the state badge come from `SBEngine.generate` at quality `draft` in the selected interpretation and
  construction, so a bonded preview never shows bridges. One request builder (`SBEngine.request`) makes the draft and
  the fabrication request from the same project; they differ only in `quality` and the raster. The source record is
  installed on the project at intake (`SBSchema.withSource`). Smoothing and the height filter are stored in mm
  (`radiusMM`) and converted per raster, so draft and fabrication smooth the same physical size (E3b fidelity check:
  per-layer area within 8 %, part counts within 2×). A caller-owned draft stage cache skips orient, resample and
  Kuwahara on a warm edit (E3). The draft size is measured, not assumed (`docs/perf/DRAFT.md`): 720 px on the long
  side for both presets, with a per-device `draftPxCap` in `SBSchema.limits` (amends PO-LASER-4). Sliders commit on
  release, the previous result stays visible under "Updating draft…", and the status line reads "Draft
  (approximate; …)". The legacy v1.1 pipeline has left the app; it stays in `js/engine.js` as the DEP-04 test oracle.
- **PO-PREVIEW-2, Preview at fabrication resolution (E6).** A Review-stage button runs the exact fabrication
  `generate` (same request and `geometryHash` as the export) and shows it in every view, with a busy note and an
  estimate before the page blocks. Download delivers files only from a fabrication result that is on screen: with
  the draft shown, the first click shows the fabrication result and opens the review, the second downloads.
  `preview.png` renders the exported fabrication result without overlays or focus. The review header, `settings.json`
  and `ASSEMBLY.md` carry the short geometry hash.
- **PO-PREVIEW-3, presets and colour images (E7).** A Preset select (Plywood (bonded), Acrylic (connected)) with a
  review dialog of every replaced value; the app starts on Plywood, whose guides are `inset-outline`. A colour source
  under a height preset (JPEG, colour palette PNG, colour truecolour PNG) switches to Tonal (light-front, 1.65 mm
  smoothing) with the `SOURCE_COLOR_TONAL` notice; gray and RGB-equal PNGs stay Height.
- **PO-PREVIEW-4, source diagnostics up front (E8).** Every preflight warning (`FAB_EXCEEDS_SOURCE` with its px
  shortfall, `FAB_PITCH_CAPPED`, `EXIF_AMBIGUOUS`) is shown at load and in a non-ackable "Fabrication resolution"
  group of the draft panel, with `FAB_COMPLEXITY_LIKELY` when the draft predicts the fabrication run will exceed a
  device cap.
- **PO-PREVIEW-5, concealed alignment for bonded relief (E9–E11).** Stage 14 of every bonded `generate` scores the
  guides of layer k+1 on layer k inside the concealed region (Appendix B defaults: conceal inset 0.5 mm, score width
  0.2 mm, allowance 0.5 mm, sheet number 3 mm) and a stroke-font sheet number in a hidden area of every sheet but the
  top one (`SBFont`, `SBGeom.placeBox`, `SBGuides.build`/`validate` with `GUIDE_UNCONTAINED`). Parts without a hidden
  area get one aggregated `GUIDE_OMITTED` warning per layer. Guides draw in blue on the Layers cards ("approximate at
  draft") and never on the Proof; guide controls sit under Construction. Bonded bundles add `placement_map.svg` (not a
  cut file) at the ZIP root with part IDs.
- **PO-PREVIEW-6, draft clips re-reviewed at fabrication (E1, E12).** A clip accepted on the draft now replays at
  fabrication as the `REPAIR_REVIEW_FAB` warning instead of hard-blocking as `REPAIR_STALE` (the root cause was the
  missing source record, E1). The Fabrication review offers Show, Keep (acknowledge for that fabrication result) and
  Revert.
- **PO-PREVIEW-7, bonded-aware export extras (E6, E13).** `SBDocs.assembly` writes ASSEMBLY.md from the fabrication
  snapshot: exported sheets and omitted layers, stack height, glue-up order (front face up, never mirrored), guides
  and sheet numbers, `placement_map.svg`, machine and the external kerf note, no speed or power. `settings.json` keeps
  the 19 v1.1 keys and adds a `project` block (modes, thickness, pitch, raster, hash, engine version).
- **Version** `2.0.0-alpha.3` (`APP_VERSION`, service-worker cache). Also in this release:

- **Desktop source images up to 25 megapixels (IMG-07, product-owner decision 2026-10-08).** The desktop
  source cap is raised from 16 MP to 25 MP, the measured desktop fabrication pixel budget, so a large photo or
  height map can be used at full 0.1 mm/px detail instead of being refused or downsampled. A 24 MP camera
  image (6000 × 4000) now loads on desktop. The desktop file-size cap (25 MiB) and the mobile limits (10 MiB,
  8 MP) are unchanged; larger sources are still refused before decoding with the explicit Downsample offer.
  This is a documented deviation from SRS IMG-07 (16 MP) for the laser target (ARCHITECTURE D6 item 14).
- **Mobile is limited to simpler art (§12.3, product-owner decision 2026-10-08).** The SRS mobile cap of
  20,000 vertices is kept. Typical detailed art at the 1 Mpx mobile budget has about 32,000 vertices, so on
  mobile it stops with "Geometry is too complex to process", and the message now says that mobile is limited
  to simpler art and suggests simplifying it or opening the project on a desktop.
- **Plan bookkeeping:** G2.0, G2.1 and G2.1b checkboxes ticked; Result notes for G2.0–G2.7; G2.2b
  cross-references point at G2.7b; the stale G2.1b mobile test name is corrected (1 Mpx: 1223 × 816 at 368 µm).

### Known gaps (alpha.3)

| Area | Gap in alpha.3 | Arrives in |
|---|---|---|
| Main thread | No worker: every draft and the fabrication preview block the page while they run (the fabrication preview shows a busy note and an estimate first) | G4.1 |
| Draft size | The draft is 720 px on the long side, far below the requested 2–4 Mpx: drafts of 1.8–3.1 Mpx measured 6–10 s per edit on the main thread, and 1024 px already missed the 3.0 s warm p95 (`docs/perf/DRAFT.md`). With stage-14 guides the plywood draft is about 3.8 s warm p95 at 720 px, above that target. Exact detail is in Preview at fabrication resolution | G4.1, G4.4 |
| Connected drafts | Connected mode with smooth corners is slower still (KI-CONN-PERF; acrylic 720 px warm p95 8.9 s realistic, 28.5 s busy) | G4.1 |
| Draft fidelity | The draft approximates the cut geometry: same physical filter radii, within the E3b tolerance, but a coarser raster; guides on draft cards are approximate. Only the fabrication preview is exact | — (by design) |
| Labels | No part-ID labels on parts (they are on `placement_map.svg`); digits only in the stroke font; the connected sheet keeps the v1.1 `<text>` label | G3.2, G3.3 |
| Interior mark | Position-only cross, no rotation tick | G3.3 |
| Registration holes | No registration holes for bonded relief (holes off, the guides align the stack) | G3.4 |
| Project file | No `.sbrproj` save or load and no undo; acknowledgements and repairs are runtime only | G3.6–G3.8 |
| Manifest and layout | No `manifest.json` or `validation.json`; legacy flat layout, not the §9.4 `cuts/` + `proof/` layout (`placement_map.svg` sits at the ZIP root) | G3.9 |
| Repairs from alpha.2 | Clip repairs reviewed under alpha.2 go `REPAIR_STALE` once and draft acknowledgements reset once (rescoped to `geometryHash`); runtime only, no saved projects are affected | — (one-time) |
| `draftPx` in the key | `geometry.draftPx` is part of `geometryKey`, so a draft-budget change resets fabrication acknowledgements and makes clips `REPAIR_STALE` once although the fabrication geometry is identical | G3.6/G3.8 |
| Fabrication preview | The on-screen raster of the fabrication preview is capped at 1600 px; its value is exact geometry and diagnostics, not a sharper picture | — |
| Settings re-import | A v2 `settings.json` re-imports as a v1.1 connected project (lossy; the `project` block raises `LEGACY_PROJECT_BLOCK`); smoothing radii in older settings are converted from pixels at the v1.1 720 px pitch | G3.8 (`.sbrproj`) |
| Presets | No Paper/card preset (needs thickness, minimum feature and kerf values from the product owner) | open |
| Calibration | Plywood profile uncalibrated (`MAT_UNCALIBRATED`); feature widths provisional | G5.1 |
| Fabrication guide cost | The fabrication-run share of stage 14 (E-R4, `node test/bench.js large`) has not been measured | G4.4 |

## v2.0.0-alpha.2 — 2026-10-08, experimental bonded relief

An **experimental** checkpoint at the end of the G2 core (plan "Checkpoint v2.0.0-alpha.2", MVP graft). It is not
SRS-compliant yet (plan R9): the known-gaps table below lists what is missing until G3–G5. The export gate is strict.

- **Every export regenerates at fabrication quality (LYR-06, G2.10b rule).** Download runs `SBEngine.generate` at
  quality `fabrication` on the source at its own size (`SBEngine.fabricationRequest`; the raster comes from
  `SBEngine.rasterPlan`, so the pitch, pixel budget and source cap apply). The draft preview, its diagnostics and its
  acknowledgements are never reused for the export.
- **Fabrication review and export gate (EXP-07).** The fabrication run's diagnostics are listed in the new
  "Fabrication review" in the Export stage, each warning with an "Acknowledge for this fabrication result" checkbox
  keyed on that snapshot's `geometryHash`. The ZIP is built only when
  `SBDiag.exportGate(diagnostics, acks, snapshot, "fabrication")` allows it: any blocking diagnostic (or a failed run,
  for example `COMPLEXITY_LIMIT`) disables Export with the reason; unacknowledged warnings stop the download until they
  are acknowledged, then Download again (the reviewed run is reused while the revision, source and device class are
  unchanged). Any geometry edit hides the review and the next export regenerates.
- **Cut files from the fabrication snapshot.** `SBEngine.fabricationFiles(snapshot, project, colors)` writes the legacy
  flat layout: `sheet_NN.svg` (NN = layer index + 1) for every exported layer and `proof.svg`. Trailing empty layers
  (`omitted-trailing`) get no file and keep their index gap (D-4.7). Bonded sheets are pure vector; connected sheets
  keep the v1.1.0 text label "{title} k/n" until G3.2. A draft snapshot is refused (`QUALITY`).
- **Includes G2.13a–d and G2.14** (layer cards, overlays and state badges, diagnostics panel, clip dialog and Revert,
  source intake with preflight and explicit downsample), shipped on this branch since alpha.1.
- **Checks:** `E2E height plywood preset → 8 layers validated, 0 blocking on ramp fixture` plus the gate, file layout,
  trailing-empty, connected-label and app-wiring checks of the checkpoint suite.

### Known gaps (alpha.2)

| Area | Gap in alpha.2 | Arrives in |
|---|---|---|
| Guides | No placement guides, labels or placement map; bonded sheets carry no layer label | G3.1–G3.3 |
| Project file | No `.sbrproj` save or load; acknowledgements are runtime only | G3.7, G3.8 |
| Manifest | No `manifest.json` or `validation.json`; the cleanup report is not exported | G3.9 |
| Package layout | Legacy flat layout (`sheet_NN.svg`, `proof.svg`, `ASSEMBLY.md`, `settings.json`, `preview.png`), not the §9.4 `cuts/` + `proof/` layout; ZIP name `<title>_shadowbox.zip` | G3.9 |
| Fabrication review | Minimal: one review list in the Export stage; no two-phase freeze, no diagnostic-only `NOT-READY-TO-CUT` package, no delivery states; items do not focus the Proof (it shows the draft) | G3.10 |
| Draft vs export | The on-screen preview, cards, overlays and draft diagnostics still come from the interim legacy draft pipeline (720 px); only the export uses `SBEngine.generate`. Clip repairs reviewed on the legacy draft fail closed as `REPAIR_STALE` in the fabrication run and must be reviewed again | G3 (app adopts `generate` for the draft) |
| `preview.png` | The bundle image is the draft proof, not a render of the fabrication snapshot | G3.9 |
| Performance | The fabrication run is synchronous on the main thread. Bonded runs follow the recorded D6 budgets (25 Mpx desktop, 1 Mpx mobile). Connected mode with smooth corners has no budget (KI-CONN-PERF): about 10 s at 1 Mpx in Node, longer at the 0.1 mm/px pitch of a 300 mm page | G4.1 (worker) |
| Tonal determinism | Tonal sources are read through the browser canvas (decode and the explicit downsample) | G4.1 |
| Source record | `project.source` (byte and sample hashes, EXIF) is not filled from intake; the fabrication request names the decoded, already oriented pixels | G2.5 follow-up / G3.8 |
| Calibration | Plywood profile uncalibrated (`MAT_UNCALIBRATED` warning on every plywood export); feature widths provisional | G5.1 |

- **G2.12, opaque proof, stack section and tilt (UI-02/03, MAT-04, GEO-01):** the preview now has
  four tabs, Proof, Section, Layers and Tilt (illustrative), and is drawn from the same canonical
  polygons as the cut files. Proof paints each layer's material back to front in the page frame
  with no image smoothing, no shadows and no parallax, so it matches `proof.svg`. Section shows the
  material spans along one line across the page at the real layer thickness and gap, with Z
  dimensions (drag up or down to move the line). Tilt keeps the drag-to-tilt, shadows, explode and
  bridge highlight and is labelled "Illustrative: not to scale". The "Draft preview" badge is gone.
  New pure module `js/proof.js` (`SBProof.model`, `section`, `drawParams`, `modelHash`).
  **Known cost (KI-CONN-PERF):** the views are built from `SBEngine.connectedLayers` after every
  geometry change, on the main thread; with smooth corners (the acrylic default) that adds about
  2 s on a simple image and about 11 s on a busy one at the 720 px draft (sharp corners: 0.2–1 s).
  The Layers grid, status line and a raster preview of the new layers now appear first and the
  polygons follow (the status line shows `proof N ms`); a newer change cancels a pending build.
  The page is still busy while the polygons build, until the G4.1 worker pool. A failure while
  building the views shows `proof unavailable: …` in the status line instead of freezing the
  preview. Section now has width and height dimension lines and a page gauge marking the section
  line; the exported `preview.png` is always the proof, whichever tab is open. The proof and
  `proof.svg` share one fill and edge-stroke rule (`SBSvg.paint`).

- **G2.11b, stages and the fabrication pitch input (UI-01, PO-LASER-4, LYR-01):** the control rail
  is now the five UI-01 stages, Source, Interpretation, Construction, Review and Export, in order.
  A stage link list at the top of the rail moves keyboard focus to each stage (each stage is a
  labelled region with `tabindex="-1"`). `#in-res` is no longer the 360–1280 px "Working resolution"
  slider: it is "Fabrication pitch (mm/px)", a number input (0.05–2, step 0.01, default 0.1)
  written through the new pure `SBSchema.applyFabPitch(project, value)` (clamped to the new frozen
  `SBSchema.FAB_PITCH`, on the 0.001 mm grid, revision + 1 when it changes; a blank or non-numeric
  entry leaves the project unchanged). The draft raster (720 px) is no longer a user control.
  `#in-sheets` now ranges 1–16 (was 3–8). Review gains a Generate button under the same
  `SBSchema.canGenerate` guard as Export ("Choose a source" until a source exists); generation still
  also runs on every change. The pitch does not change the draft preview yet (the app path is still
  the legacy connected pipeline); it is recorded on the project for the fabrication raster.

- **G2.11a, controller state adapter; no auto-demo (PRJ-01):** the app keeps one schema v1
  `project` (acrylic preset, today's connected tonal behaviour) instead of the v1.1.0 `state`
  object. The legacy pipeline reads it through the new pure `SBSchema.legacyState(project, w?, h?)`
  (the 19 v1.1.0 settings keys; `legacyState(defaults("acrylic"))` equals the v1.1.0 defaults), and
  every control writes through `SBSchema.applyLegacy(project, key, value)`, which bumps
  `revision` exactly when the geometry key changes (title and palette do not). `runPipeline` is now
  `regenerate()`, guarded by `SBSchema.canGenerate(project, source)`. **Start-up change:** the app
  no longer loads the demo by itself; it opens empty with Export disabled and the reason "Choose a
  source", and the Demo scene stays an explicit source button. `settings.json` export is unchanged.
  New `docs/QA_CHECKLIST.md`.

- **G2.10b: Z model, accounting, hashes and freeze (engine only; the app path is unchanged):**
  `SBEngine.generate` now sets each layer's `zBottomMM`/`zTopMM` (k·(t + g), gap 0 in bonded
  mode) and keeps trailing empty layers in place with status `omitted-trailing` and one
  `TRAILING_OMITTED` warning. It reports `stats` {requested, exported, omitted, stockMM (N·t),
  reliefMM ((N−1)·t), maxZMM (top of the highest exported layer)} and computes the snapshot
  `geometryHash`. That hash covers the geometry key, engine version, quality, raster size, one
  layer hash per index and the guide hash, so appearance and explode changes keep it, and draft
  and fabrication snapshots never share it. Every response is deep-frozen. New
  `SBEngine.guideHash`.

- **G2.10a, `SBEngine.generate` through validation, with the machine-envelope check (engine; the
  app path is unchanged):** `SBEngine.generate(request, {isCanceled, onProgress})` runs the §11.1
  pipeline: orientation, resampling to the draft or fabrication raster plan, the alpha domain,
  height or tonal interpretation, cumulative masks, construction (bonded or connected), the
  complexity caps (before trace for parts, after vectorization for vertices; `COMPLEXITY_LIMIT`
  returns no layers), trace with connected-mode smoothing only (bonded stays raw, D1), the frame
  union, reviewed repairs, the legacy connected corner holes, and validation (geometry, support,
  features). It answers `ENGINE_MISMATCH` to a request for another engine version and `canceled`
  when canceled. New `SBSupport.checkEnvelope`: a page that does not fit the machine's processing
  area in either orientation gives `PAGE_OVERFLOW`, and stock thicker than the machine accepts
  gives the new blocking `MACHINE_THICKNESS`; nothing is rescaled, and `machine: null` turns the
  check off. `SBMorph.dilate`/`erode` now run in O(w·h) for any radius with identical results,
  which makes bonded construction at the fabrication pitch about 5× faster.

- **G2.8, feature and sampling checks (engine; the app path is unchanged):**
  `SBSupport.featureChecks(layers, cfg)` reports `SAMPLING_LOW` (blocking) when the minimum
  feature gets fewer than 3 samples at the coarser real pitch (GEO-06; with the plywood 1.5 mm
  this needs ≤ 0.5 mm/px). It erodes each part by the integer half of the minimum feature (D3) and
  reports `PART_THIN` when the part disappears or `NECK_NARROW` when it splits (GEO-05). A part
  that passes at the minimum but disappears or splits at the advisory width gives
  `FEATURE_MARGINAL` with `detail.kind` `"part"` or `"neck"` (PO-LASER-6). It also reports
  `PART_SMALL` below the minimum part area and `MAT_UNCALIBRATED` (MAT-03). Each layer gets one
  erosion per width. Every GEO-05 message (`PART_SMALL`, `PART_THIN`, `NECK_NARROW`, and
  `FEATURE_MARGINAL` of kind part or neck) now ends with "Conservative fabrication warning — not a
  structural simulation". The text survives aggregation. `test/bench.js support` reports a B4 row,
  p95 2.95 s on the dense stress stack (`docs/perf/SUPPORT.md`).

- **G2.7b, complexity caps and busy-art simplification (engine; the app path is unchanged):**
  `SBSchema.limits(deviceClass)` now returns the SRS §12.3 complexity caps. On desktop these are
  258 parts per layer, 132,000 vertices per layer and 356,000 vertices in total, measured at the
  25 Mpx budget by the new `node test/bench.js caps`. On mobile they are 100 parts per layer and
  20,000 vertices (SRS). `SBConstruct.estimateComplexity` counts the parts on each layer before
  trace. `SBConstruct.complexityGate` and `SBConstruct.vertexGate` fail with `COMPLEXITY_LIMIT`
  (blocking: measured value, limit, layer and device class) and return no geometry, never
  truncated geometry. A new project setting, `construction.cleanup.simplify: "off" | "busy"`
  (default `"off"`, part of the geometry key), turns on explicit busy-art simplification
  (`SBConstruct.simplifyBusy`): parts closer than the minimum feature are merged, parts smaller
  than the minimum part area are dropped, and the new info diagnostic `BUSY_SIMPLIFIED` reports
  the part counts before and after. The busy benchmark rows now fail in 0.1–0.3 s instead of
  running 35–88 s; simplified, they finish in 3.7–8.1 s. `test/bench.js large` gained
  `--caps`, `--simplify` and `--bonded-only`, and records vertex counts
  (`docs/perf/complexity.json`, `docs/perf/LARGE_IMAGE.md`).

- **G2.7, final-polygon validation (engine; the app path is unchanged):** new module `SBSupport`
  (`js/support.js`). `SBSupport.validate(layers, mode, cfg)` checks the final MaterialLayer
  polygons, never the masks. In bonded-relief mode it reports `BOND_UNSUPPORTED` with the
  measured unsupported area (SUP-02, GEO-07) and `BOND_EMPTY_UNDER` (D-4.7). It builds the support
  graph to the base (SUP-03) from one layer-level boolean per adjacent pair, with D3 contact
  widths. A contact narrower than the minimum feature gives `SUPPORT_NARROW`; one below the
  advisory width gives the new warning `FEATURE_MARGINAL` with `detail.kind: "contact"`
  (PO-LASER-6: 1.5 / 2.0 mm on plywood). Identical consecutive layers give `IDENTICAL_LAYERS`.
  In connected-sheet mode it reports `CONNECTED_SPLIT`. `SBSupport.annotate` writes
  `Part.supports[]`. `SBDiag.make` accepts `detail: {kind, text?}`.
  `SBGeom.insetStatus` gained a quick witness search and an exact erosion failure certificate
  (no trig), with verdict semantics unchanged. The dense support benchmark B3b now takes
  p95 1.32 s against the 3 s budget (previously provisional at 6 s); `node test/bench.js support`
  is new.

- **G2.6, construction strategies (engine; the app path is unchanged):** new module `SBConstruct`
  (`js/construct.js`). `SBConstruct.connected(masks, w, h, px)` is the v1.1.0 per-sheet chain
  (open → close → removeSpecks → fillHoles → `SBIslands.resolve`), byte-identical; `legacyRun`
  now delegates to it. `SBConstruct.bonded(masks, w, h, px)` runs the same open → close →
  fillHoles chain, `removeSpecks` only when `cullEnabled` is set, and never bridges, culls islands
  or clips (SUP-01): disconnected parts are kept and no material is added outside the layer
  below (GEO-07). Both return `{final, bridges, report}`, with a per-layer cleanup report
  (`addedPx`, `removedPx`, `filledHoles`, `removedParts`) for GEO-08. The T0.4
  `KNOWN-DEFECT SUP-01` / `GEO-07 (bridge)` checks are replaced by FIXED checks on the strategies.

- **G2.5, domain mask and orientation (engine only; not yet wired into the app):**
  `SBHeight.domainMask(alpha, mode, t = 0.5)` returns the alpha domain A (1 where alpha ≥
  round(t·255), so 128 at t = 0.5), or `null` (whole image) for mode `full` or a source without
  alpha; a bad mode or t is `DOMAIN_ARG` (IMG-04). `SBEngine.orient({samples, alpha, w, h},
  {exif, exifAppliedBy, rotate, mirror})` is the one orientation rule (IMG-05): EXIF only when
  `exifAppliedBy === "engine"` (standard meaning of 1–8), then the user rotation (clockwise),
  then mirror (left-right), as one integer pixel map in a single pass. Alpha moves with the
  samples, interleaved channels keep their order, the array type is kept and the input is not
  mutated. The result is marked `oriented: true` and a second `orient` on it is refused with
  `ORIENT_TWICE`, so orientation runs exactly once. `rasterPlan`'s oriented size now comes from
  the same transform.

- **G2.4b, legacy settings adapter (engine only; import UI lands in G3.8):**
  `SBSchema.fromLegacySettings(json)` maps a v1.1.0 `settings.json` onto the project model as
  tonal + connected-sheet (acrylic preset base): sheets, threshold rule, polarity, smoothing,
  palette, frame from `marginMM`, cleanup/bridge, registration holes, `faceted` → `sharp`,
  `sizeBy: "width"` with `targetMM` = page width (art + 2 × margin), and the default
  `xtool-s1-feeder` machine (an oversized piece is reported by the envelope check, never
  rescaled). Missing keys take the v1.1.0 defaults; an unrecognised `thresholdMode` keeps the
  v1.1.0 balanced fallback. The whole original JSON is kept in `extras.legacy`. Until a source is
  attached `geometry.heightMM` is `null` and `LEGACY_NEEDS_SOURCE` (blocking) is raised
  (`SBSchema.legacyDiagnostics`). `SBSchema.resolveLegacy(project, srcW, srcH)` sets the height
  from the source aspect, `fabPitchMM` = long side / `procRes` on the 0.001 mm grid (so a v1.1.0
  project keeps its resolution: 300 × 200 mm at 720 → 0.417 mm/px) and `toleranceMM` =
  max(0.05, `detailEps` × width / the real v1.1.0 working width, portrait included). The AT-21
  guarantee is **same bands, polarity and connected semantics**, not byte-identical masks end to
  end: v1.1.0 resampled twice on a canvas (the 2000 px pre-cap, then `procRes`), which the new
  single deterministic resample does not reproduce.

- **G2.4, tonal path (engine only; not yet wired into the app):** `SBRaster.thresholds(L, N,
  mode, {manual, domain})` adds `manual` thresholds (N−1 normalized values in [0, 1],
  non-decreasing, × 255; a descending list is rejected with `THRESHOLD_ORDER`, a wrong count or
  out-of-range value with `THRESHOLD_ARG`) and alpha-domain statistics: with `domain` the
  histogram and percentiles use only in-domain pixels (IMG-04). Every result now carries
  `emptyBands`, the bands with no in-domain pixel, so flat images and duplicate thresholds are
  surfaced (IMG-06, AT-04). `SBRaster.kuwahara(…, domain)` samples only in-domain neighbours and
  leaves out-of-domain pixels unchanged. `SBRaster.sheetMasks` is now
  `SBHeight.cumulativeMasks(SBHeight.tonalAdded(…))`. Without a domain every output is unchanged
  from v1.1.0 (persisted golden), including the fallback of an unrecognised mode to balanced.

- **G2.3, height quantization (engine only; not yet wired into the app):** new module
  `js/height.js` (`SBHeight`), loaded after `jpeg.js` and before `raster.js`. Nearest-layer rule
  `addedFromNorm` / exact integer `addedFromSamples` (white-high or black-high; ties at the
  midpoints (k−0.5)/(N−1) go to the higher layer; N = 1 is base only), `cumulativeMasks` (base
  all ones, `[k] = domain ∧ added ≥ k`, identical layers kept), `boundaries` (normalized and mm,
  LYR-02) and `tonalAdded`, which with `cumulativeMasks` reproduces `SBRaster.sheetMasks` byte
  for byte (rewired in G2.4). The large-image benchmark now builds its height masks with
  `SBHeight` instead of an inline rule (same masks).

- **G2.2b, measured pixel budgets (engine only; not yet wired into the app):** the large-image
  benchmark sets `SBSchema.limits` to **25 Mpx on desktop** (was a provisional 16 Mpx) and
  **1 Mpx on mobile** (was 4 Mpx), in bonded mode. Desktop keeps the 10 s target: 25 Mpx
  measured 9.75 s. Mobile fabrication stays available, so there is no draft-only mode. A
  470 mm-high page now plans at the full 0.1 mm/px on desktop (the source still has to provide
  the pixels). On mobile, fabrication is coarser: about 0.35 mm/px for a 300 mm page. By
  product-owner decision this was a shortened run: rows completed by the stopped full run were
  kept, and only 25 Mpx and the 470 mm page were measured afresh. Results and method are in
  [docs/perf/LARGE_IMAGE.md](perf/LARGE_IMAGE.md); `node test/bench.js large-assemble` rebuilds
  `docs/perf/large-image.json` from the preserved logs. Very busy artwork costs far more than
  its pixel count suggests (thousands of parts per layer: 35–163 s), so per-device complexity
  caps and an explicit "simplify busy art" option move forward into G2 as task G2.7b.

- **G2.2b decision (product owner, 2026-10-08), option (a):** pixel budgets and the NFR-03
  performance gate are measured in bonded mode (the plywood/laser default). Connected mode
  stays functional and is still measured and reported, but its cost (about 18 s on the SRS
  desktop reference) is a tracked known item, KI-CONN-PERF, to be fixed in G4 by a pool of
  background workers and/or faster smoothing. Mobile now also tries 1, 1.25 and 1.5 Mpx; if
  none is fast enough, mobile becomes draft-only (fabrication export disabled on mobile with a
  clear message). `node test/bench.js large` gates on bonded mode, reports connected mode as
  `KNOWN-OVER (tracked)`, and records a draft-only mobile outcome instead of failing.
  Benchmarks run on the Linux development machine (i7-11800H); the MacBook Air M5 is expected
  to be faster. Recorded in D6 ([docs/ARCHITECTURE.md](ARCHITECTURE.md)) and Appendix D.8 of
  the [development plan](plans/opaque-layers-dev-plan.md).

- **Fixes (G2.0/G2.1 review):** `FAB_EXCEEDS_SOURCE` now reports the source and target pixels
  on the most-short axis (so the measured value is always below the limit when it warns);
  `FAB_PITCH_CAPPED` reports only the coarsening the pixel budget caused and names the source
  when the source limits the raster further; `SBSchema.resolveSize` enforces MAT-02 (1–2000 mm)
  on both artwork axes, including the one derived from the source aspect, and throws
  `SCHEMA_SIZE` naming the axis.

- **G2.1b, draft/fabrication raster plan (engine only; not yet wired into the app):**
  `SBEngine.rasterPlan(project, {w, h}, quality, deviceClass)` sizes the raster from the
  dimensions alone, before any decode: draft quality keeps the 720 px long side, fabrication
  uses the 0.1 mm/px physical pitch under the device pixel budget, never upsamples, and
  reports `FAB_PITCH_CAPPED` / `FAB_EXCEEDS_SOURCE`. The page size follows the oriented
  source (rotate 90/270, and EXIF 5–8 when the engine applies it). `SBEngine.qualityPair`
  returns both plans for display before generation.

- **G2.1, project schema v1 (engine only; not yet wired into the app):** new `js/schema.js`
  (`SBSchema`) with the Plywood relief (bonded, height, white-high, 8 sheets, gap 0,
  6.35 mm nominal, min feature 1.5 mm with a 2.0 mm advisory tier, 25 mm² parts,
  uncalibrated, unsmoothed) and Acrylic shadowbox (the v1.1.0 connected tonal defaults)
  presets; strict per-section validation with `{path, code}` errors; the editable machine
  profile (default "xTool S1 + feeder", part of the geometry key); size by height (default
  300 mm page) or width on the 1 µm grid; 0.1 mm/px fabrication pitch; provisional pixel
  budgets (desktop 16 Mpx, mobile 4 Mpx) until G2.2b; lossless mm/inch conversion;
  `geometryKey`; and the mode-change diff that G2.11e will show for review.

- **G2.0, raster contract (engine only; not yet wired into the app):** `SBRaster.resample`
  (pure integer `none` / `nearest` / exact `area` box average, never upsamples and throws
  `RESAMPLE_UPSAMPLE`), `SBRaster.rasterSize` (draft 720 px long side) and
  `SBRaster.fabRaster` (physical 0.1 mm/px pitch, coarsened in 1 µm steps to fit the device
  pixel budget, clamped to the source with the px shortfall). New info diagnostic
  `FAB_PITCH_CAPPED`; `FAB_EXCEEDS_SOURCE` now carries `shortPx` and no longer suggests that
  missing detail is interpolated.

- **Laser target (product owner, 2026-10-07):** the plan and architecture now target the
  xTool S1 with the conveyor feeder (40 W diode, 1/4" basswood or poplar plywood). Decision
  D6 in [docs/ARCHITECTURE.md](ARCHITECTURE.md) and Appendix D of the
  [development plan](plans/opaque-layers-dev-plan.md) add: an editable machine profile saved
  in the project (default "xTool S1 + feeder": 470 mm processing height, 3000 mm length,
  545 mm material width, 14 mm thickness, 0.15 mm kerf) with a blocking check that every
  layer sheet, frame included, fits it; sizing by height as the default; a fabrication pitch
  of 0.1 mm per pixel capped by a per-device pixel budget (reported, never silent) in place of
  the fixed 1536/4096 px long side; a warning with the pixel shortfall when the source is
  smaller than the target (never upsampled); 1.5 mm minimum feature with a 2.0 mm advisory
  warning for 6 mm ply; and a large-image benchmark (new task G2.2b) that sets the pixel
  budgets before the rest of G2.
- **Resolved: S2 F3** (faceted "smooth" corners at the default working resolution of about
  0.42 mm per pixel, noted under v2.0.0-alpha.1). Resolved by finer resolution, not by a
  looser tolerance: the 0.1 mm per pixel fabrication pitch, with the 0.05 mm tolerance
  unchanged. Takes effect when the G2 resolution work (G2.0, G2.1b) ships.

## v2.0.0-alpha.1 — 2026-10-07

First alpha of the opaque-layers rework (plan G1). Connected export now runs through the
canonical polygon path: `SBMaterial.fromMasks` → `SBSvg.layerSVG` / `SBSvg.assemblySVG`.
File names (`sheet_NN.svg`, `proof.svg`), the corner registration holes and the sheet
label are unchanged. Intentional connected-mode changes (DEP-04):

- The frame is now unioned with edge art: art touching the image border is one cut part
  with the frame ring instead of a separate outline cut against it (GEO-02).
- Cut files have `<g id="CUT">` (`#FF0000`) and `<g id="SCORE">` (`#0000FF`) groups, no
  fill on cuts and no page `<rect>`; the outline of every sheet comes from its material
  ring, and every coordinate is exact on the 1 µm grid (EXP-01/02, GEO-09).
- The proof is drawn from the same polygons in the page frame (artwork plus frame), so
  `proof.svg` lines up with the cut files (GEO-01).
- Smoothing is bounded to 0.05 mm, on the pixel contours, with pinned frame-edge vertices
  (connected mode, G1.2). Outlines that cannot round within 0.05 mm stay on the raw pixel
  contour, so at the default working resolution (about 0.42 mm per pixel) "smooth" corners
  export as the faceted lattice outline; the legacy Chaikin/RDP outline is no longer used
  for cutting.
- The stack preview carries a "Draft preview: cut files come from polygons" badge until
  the polygon preview lands (G2.12).

Holes and labels are unchanged: four registration holes at `margin/2` from the page
corners when holes are on (now `SBGeom.circle` polygons), and the live `<text>` label
inside `SCORE`.

Also in this release (no change to connected-mode output beyond the list above):
- Baseline (G0): upstream `f0552c7` frozen, characterization checks and persisted
  goldens (including the legacy `sheetSVG`/`proofSVG` shims), license check and per-module
  reuse decisions. See [docs/BASELINE.md](BASELINE.md).
- Canonical geometry (G1.0–G1.6): `SBDiag` registry, `SBMaterial` (integer-µm polygons,
  deterministic part IDs, frame and holes as material), bounded smoothing (bonded mode
  unsmoothed, D1), SVG writer v2, `SBSvgRead` round trip and the opaque proof.

## v1.1.0 — 2026-07-09

Installable PWA and a working export path on mobile.

- Progressive web app: manifest, versioned offline service worker (precached
  app shell), icon set, and iOS standalone meta tags. The app is now
  installable to the home screen and runs fully offline after first load.
- Fixed file export on installed PWAs and iOS Safari. Replaced the
  `<a download>` click — which iOS ignores and, in standalone mode, could
  navigate the app away without saving — with a tiered strategy: native share
  sheet (Web Share with files) where available, classic download on desktop,
  and a new-tab fallback so exported bytes are never silently lost.
- Export now reports its outcome in the status bar and disables the button
  while working, so a tap always produces visible feedback.
- Hardened photo loading: explicit decode-error handling, object-URL cleanup,
  and automatic downscaling of very large camera images to prevent
  out-of-memory stalls on mobile.
- Visible in-app version string in the title block, kept in sync with the
  service-worker cache version.
- The single-file `dist/` bundle remains fully portable: the build step strips
  PWA-only tags, and the service-worker registration self-disables on
  `file://`.

## v1.0 — 2026-07-08

Initial release.

- Full photo → layered shadowbox pipeline: Kuwahara cartoonization,
  balanced/linear tone banding, nested sheet masks.
- Automatic island resolution: BFS shortest-path bridging with configurable
  width, size-based culling, max-reach budget, daisy-chained anchoring,
  amber bridge audit overlay.
- Fabrication controls in real mm: min feature, frame ring, registration
  holes, corner style.
- Vector export: per-sheet SVG (mm units, laser color conventions), color
  proof SVG, generated ASSEMBLY.md, preview.png, settings.json — bundled by
  a dependency-free ZIP writer.
- Interactive tilting stack preview with explode and bridge toggle.
- 29-check algorithm test suite; single-file build script.
