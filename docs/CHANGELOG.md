# Changelog

## Unreleased

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
