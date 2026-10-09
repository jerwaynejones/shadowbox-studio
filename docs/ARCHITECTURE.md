# Stacked Relief — Architecture Contract

This document is the binding architecture contract for the Stacked Relief work
(`docs/SRS_Stacked_Relief.md`). It is copied from `docs/plans/opaque-layers-dev-plan.md`
(§3, §4, Global Constraints and the determinism rules) and records the spike decisions
D1–D4 as they land.

## Global Constraints

These come from the SRS and repo conventions. Every task implicitly includes them.

**SRS physical and quantization rules**
- All persisted physical values are in **millimetres**; 1 inch = 25.4 mm. The canonical grid is **0.001 mm**, stored as integer µm. Unit conversion quantizes: `toMM(v, "in") = Math.round(v*25400)/1000`. (SRS:L141-145)
- Origin is top-left, X right, Y down, Z toward the viewer. **No automatic mirroring.** One shared page extent for all layers. **A page rectangle is not a cut rectangle.** (SRS:L141-143)
- Raster to mm uses **both axis scales**. The sampling check uses the larger physical pixel dimension of the **real** samples (never upsampled). (SRS:L145, L264)
- `addedLayers = min(N-1, floor((N-1)*h + 0.5))`, `M[0] = B`, `M[k] = A ∩ {added ≥ k}`. Midpoint ties go to the **higher** layer. N is 1..16. **No histogram stretch, gamma, clip or interpolation in height mode** unless an explicit, recorded `heightFilter` or downsample is set. (SRS:L149-162, IMG-03)
- Bonded gap is 0. Connected gap g is 0–25 mm (default 3), with `zBottom(k) = k*(t+g)` and `zTop = zBottom + t`. (SRS:L162)

**SRS behavioural rules**
- Bonded: `Final[k] − Final[k−1] = ∅` on the grid, and the support graph reaches the base. **No partial overhangs.** (SRS:L172-176)
- **No automatic bridging, clipping or deletion in bonded mode.** Culling is explicit opt-in. Smoothing falls back toward raw contours rather than altering material outside the tolerance. Clip-to-lower is the only repair; it is shown (removed area, part-count change) before it is applied, it is reversible, and it is never replayed against geometry the user did not review. (SRS:L180-182, SUP-04)
- No deduplication of identical layers. Trailing empties may be omitted, but their indices are kept. **An empty layer under a non-empty one blocks in bonded mode.** (SRS:L186)
- Blocking diagnostics are **never** downgraded. Acknowledgements are scoped to the exact snapshot (`geometryHash`, which includes quality) and are invalidated by any relevant change. (SRS §9.5)
- Smoothing tolerance is **0.05 mm**. SVG round trip within **0.005 mm** with the same topology. Plywood preset: bonded, white-high, 8 sheets, gap 0, **6.35 mm** nominal (editable; 1/4" ply often measures 5.5–6 mm), min feature **1.5 mm** with a **2.0 mm** advisory tier (PO-LASER-6; the SRS MAT-03 starting value is 3 mm), min part **25 mm²**, uncalibrated.
- **Machine envelope (GEO-10, PO-LASER-1/2):** the project carries an editable machine profile, default **xTool S1 + feeder** (processing height 470 mm, length 3000 mm, material width 545 mm, thickness 14 mm, kerf 0.15 mm). Every layer sheet, frame included, must fit its processing area (either orientation) and the stock must not exceed its thickness, otherwise a blocking diagnostic. Nothing is ever rescaled to fit. Kerf stays external (MAT-05).
- **Fabrication pitch (PO-LASER-4/5):** fabrication resolution is derived from physical size at a target of **0.1 mm/px**, capped by a per-device total pixel budget; a cap is reported (info, actual mm/px), never silent. The engine never upsamples; a source with fewer pixels than the target warns with the shortfall. Draft stays 720 px on the long side.
- Limits:
  - image input: desktop **25 MiB / 25 MP** (25 MP = the desktop `fabPxBudget`; product-owner deviation from SRS IMG-07's 16 MP, D6 item 14), mobile **10 MiB / 8 MP**;
  - `.sbrproj`: **≤1024 entries**, **≤256 MiB** expanded on desktop, **≤64 MiB** on mobile;
  - working set: **≤512 MiB** desktop, **≤192 MiB** mobile;
  - complexity caps (parts per layer, total vertices; per device class) fail with blocking `COMPLEXITY_LIMIT`, never with truncated geometry. (SRS:L564)

**Determinism rules (NFR-05)**
- Nothing that feeds a hash may use `Math.cbrt`, `Math.sin`, `Math.cos`, `Math.exp`, `Math.log` or `Math.pow` with non-integer exponents. ECMAScript does not require these to be correctly rounded. `Math.sqrt`, `+ − × ÷` and `Math.round`/`floor` are allowed.
- Offsets that reach hashed geometry use `"miter"` or `"square"` joins only. Circles (registration holes, coupon holes) come from a hard-coded integer unit-circle table (`SBGeom.circle`).
- `hashJSON` inputs must not contain typed arrays. Large byte payloads use `SBHash.digest`.

**Repo conventions**
- No npm dependencies and no `package.json`. Only Node built-ins in tests and build. Vendored libraries go under `js/vendor/`, each with LICENSE text and a SHA-256 in `docs/COMPONENTS.md`.
- Every pure module is a classic-script IIFE: `(function (global) { "use strict"; … global.SBXxx = X; })(typeof window !== "undefined" ? window : globalThis);`. **No DOM access outside `js/app.js` and `js/preview.js`.** Other `SB*` globals are referenced inside functions, never captured at load time.
- A new module is registered in the **four lists**, in the one shared load order of §4:
  - an `index.html` `<script>` tag;
  - the `sw.js` `SHELL`;
  - `test/modules.js` (created in T0.2);
  - the `js/worker.js` `importScripts` call (from G4.1 onward).

  `build.js` inlines any `js/…` path once T0.2 fixes its regex. The T0.2 check `dist has no <script src=` guards it.
- New tests use `suite(name, fn)` (T0.2), which skips filtered suites and catches throws, plus `check(name, bool)` / `checkAsync`. Check names start with the SRS ID they prove, for example `"AT-03/LYR-02 …"`. A test step that says "confirm it fails" must fail on the assertion, not pass vacuously.
- After every task:
  - run `node test/run_tests.js` (all green);
  - run `node build.js`, then commit `dist/shadowbox-studio.html`;
  - commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Release: bump `APP_VERSION` (`js/app.js:23`) and `VERSION` (`sw.js:19`) together (a test enforces equality), and add a `docs/CHANGELOG.md` entry in the `## vX.Y.Z — YYYY-MM-DD` format.
- Development: the service worker is not registered on `localhost`/`127.0.0.1`/`[::1]` (T0.2), so manual checks never run against a cached older shell.
- No copy anywhere may state laser speed or power, or claim the output is "ready to cut" while any blocking diagnostic exists.

---

## 3. Data model and contracts (schema v1)

This is grafted from the architecture draft and extended for SRS §9.1. Field names are binding for every task. `SBSchema.validate` enforces **strict key sets** per section. Unknown keys are rejected in every geometry-affecting section (`source`, `interpretation`, `construction`, `material`, `geometry`). Unknown top-level metadata is moved to `extras` on import, never into geometry sections.

```js
// js/schema.js — SBSchema.defaults("plywood") returns this shape
Project = {
  schema: { major: 1, minor: 0 }, id, revision, title, units: "mm"|"in", createdAt, modifiedAt,
  app: { version }, engine: { id: "sbr-engine", version },
  source: { format: "png"|"jpeg", byteHash, sampleHash, w, h, channels,
            decode: "raw-gray8"|"raw-rgb-equal"|"canvas-tonal",
            orientation: { exif: 1, exifAppliedBy: "browser"|"engine"|"none", rotate: 0|90|180|270, mirror: false },
            alpha: { mode: "threshold"|"full", t: 0.5 } },
  interpretation: { mode: "tonal"|"height",
            polarity: "white-high"|"black-high"|"light-front"|"dark-front",
            thresholdRule: "balanced"|"linear"|"manual", manual: [],      // tonal only, normalized 0..1 ascending
            smoothing: { radius: 0, passes: 0 },                           // tonal only
            heightFilter: null /* | {op:"median"|"box"|"remap", radius?, lut?: number[256]} explicit, recorded */ },
  construction: { mode: "connected-sheet"|"bonded-relief", sheets: 1..16,
            frame: { enabled: false, widthMM: 0 }, gapMM: 0..25,
            cleanup: { minFeatureMM, speckMM2, holeMM2, cornerStyle: "sharp"|"smooth", toleranceMM: 0.05, simplify: "off"|"busy" },
            bridge: { bridgeMM, cullBelowMM2, maxBridgeMM, cullEnabled },    // cullEnabled used in bonded only
            registration: { enabled: false, diaMM: 3, edgeClearanceMM: 1, layers: "all" | number[] },
            guides: { mode: "none"|"inset-outline"|"interior-mark", concealInsetMM: 0.5,
                      markFootprintMM: 0.2, allowanceMM: 0.5, labelHeightMM: 3 },
            repairs: [] /* Repair, see below */ },
  material: { name, thicknessMM: 6.35, thicknessState: "nominal"|"measured", calibrated: false,
            minFeatureMM: 1.5, advisoryFeatureMM: 2.0,   // PO-LASER-6 (SRS MAT-03 starting value: 3)
            minPartMM2: 25, kerfMode: "external",
            calibration: null /* | {date, machine, material, kerfMM, minFeatureOkMM, scoreOk, notes} user-recorded */ },
  appearance: { mode: "uniform"|"palette", color: "#C8A26B", palette: "dusk" },  // never in geometryKey
  view: { explodeMM: 0 },                                                          // never in geometryKey
  geometry: { sizeBy: "height"|"width", targetMM: 300,  // PO-LASER-3: finished page (art + 2·frame) along sizeBy
              widthMM, heightMM, lockAspect: true,       // artwork; SBSchema.resolveSize derives the free axis from the aspect
              draftPx: 720,                              // draft long side (unchanged)
              fabPitchMM: 0.1,                           // PO-LASER-4: target fabrication pitch; budget-capped, never upsampled
              resample: { height: "nearest", tonal: "area" } },
  machine: MachineProfile | null,                        // PO-LASER-1; null = no envelope check; in geometryKey
  acks: [] /* {key, revision} */, extras: {}
}

MachineProfile = { id: "xtool-s1-feeder", name: "xTool S1 + feeder",          // SBSchema.MACHINES default; every field editable
                   maxProcessingHeightMM: 470, maxLengthMM: 3000,               // processing area, either orientation
                   maxMaterialWidthMM: 545, maxThicknessMM: 14,
                   kerfMM: 0.15 }                                               // informational only (MAT-05, kerfMode external)

Repair = { op: "clip-to-lower", layer, sourceRevision, resultRevision,
           keyHash,          // hashJSON(geometryKey(project with repairs truncated before this entry))
           reviewed: { quality, beforeHash, afterHash, removedAreaMM2, partCountBefore, partCountAfter } }

MaterialLayer = { index, zBottomMM, zTopMM, status: "ok"|"empty"|"omitted-trailing",
  material: PolygonWithHoles[],            // µm integers, normalized (SBGeom.normalize)
  carriers: PolygonWithHoles[],            // GEO-01 optional carrier boundaries; always [] in v1.0
  parts: Part[], cutPaths: Ring[], scorePaths: Polyline[], holes: Circle[],
  stats: { areaMM2, cutMM, vertices }, diagnostics: Diagnostic[], canonicalHash }

PolygonWithHoles = { outer: number[] /* [x0,y0,x1,y1,…] µm */, holes: number[][] }
Part = { id: "L03-P002", layer, polygon: PolygonWithHoles, bbox: [x0,y0,x1,y1], areaMM2,
         supports: string[], guideRefs: string[], warnings: string[] /* diagnostic ids */ }
Diagnostic = { id, code, severity: "blocking"|"warning"|"info", revision, quality: "draft"|"fabrication",
               layer, part, parts?: string[], count?: number, areaMM2, region,
               measured: {value, unit}|null, limit: {value, unit}|null,
               message, fix, ackState: "n/a"|"unacked"|"acked" }
GeometryConfig (Snapshot.geometry) = { artWMM, artHMM, pageWMM, pageHMM, srcW, srcH,
               rasterW, rasterH, sxUm, syUm, mmPerPxMax, resample: "none"|"nearest"|"area", grid: "1um",
               // PO-LASER-4/5 (G2.0, G2.1b); draft quality uses the 720 px long side instead of the pitch
               targetPitchUm, pitchUm, pxBudget, deviceClass: "desktop"|"mobile",
               capped: "none"|"budget"|"source"|"budget+source", shortPx: [shortW, shortH] | null }
Snapshot = { revision, engineVersion, geometryHash, quality: "draft"|"fabrication", layers, diagnostics,
             cleanupReport: [{layer, addedMM2, removedMM2, holesFilled, partsRemoved, bridges?: PolygonWithHoles[],
                              added?: PolygonWithHoles[], removed?: PolygonWithHoles[]}],   // added/removed: draft quality only (G2.13b overlays)
             supportGraph, guides, geometry: GeometryConfig, page: { wMM, hMM },
             stats: { requested, exported, omitted: number[], stockMM, reliefMM, maxZMM } }

// §9.3 — names follow SRS:L380-388
GenerateRequest  = { requestId, revision, engineVersion, quality: "draft"|"fabrication",
                     normalizedSource: { pixels: Uint8Array /* copy, transferable */, channels: 1|4, w, h,
                                         alpha: Uint8Array|null },
                     sourceHash, config: Project }
GenerateResponse = { requestId, revision, engineVersion,
                     status: "progress"|"done"|"error"|"canceled",
                     progress?: {stage, frac}, validatedLayers?: MaterialLayer[], snapshot?: Snapshot,
                     diagnostics?: Diagnostic[], geometryHash?, error?: {code, message} }
```

`geometryKey(p)` is everything except `appearance`, `view`, `acks`, `extras`, `title`, `units`, `id`, `app`, `createdAt`, `modifiedAt`, `revision` and `source.byteHash`.

`geometryHash = hashJSON({ key: geometryKey(p), engine: engine.version, quality, raster: [rasterW, rasterH], layers: layerHashes, guides: guideHash })`. `engine.version` enters only here, so an app-only release does not invalidate saved hashes. The device pixel budget (PO-LASER-4) reaches the hash only through the raster size: the same project gives the same `geometryHash` on any device that does not cap it, and a capped device reports `FAB_PITCH_CAPPED` with the pitch it used.

**Winding convention** (documented once in `js/geom.js`):
- In Y-down coordinates the outer ring has **positive** shoelace area and holes have **negative** area. `SBTrace.trace` emits the opposite, so `fromPixelLoops` reverses its rings.
- Each ring starts at its lexicographically smallest `(x, y)` vertex.
- Collinear vertices are removed.
- Booleans use the **NonZero** fill rule on normalized input. `fromPixelLoops` output (outer positive, holes negative) is NonZero-safe.
- Normalization (D3) runs globally on the ring set of every boolean or offset result: T-contacts are noded, every shared vertex is **re-paired with the material-separating turn** (Clipper2's ring pairing is never trusted), only then are rings that still repeat a vertex (pixel saddles) **split into simple rings**, and rings are cleaned, oriented, rotated, nested and sorted. Point contact never connects material: each polygon is exactly one part (`SBGeom.interiorConnected`), so `validate()` never reports `GEO_SELF_INTERSECT` for ordinary checkerboard art and reports `GEO_MULTIPART` for a polygon whose interior is disconnected.

## 4. Module map and load order

This is the **final** order, frozen in T0.2. All four lists use it; modules that do not exist yet are appended in this relative order when they are created. Load order only matters for top-level code, because modules look each other up at call time. Only `preview.js`, `app.js` and `worker.js` are absent from the Node test load.

```
util → hash → vendor/<geomlib> → geom → diag → schema → png → jpeg → height → raster → morph
→ islands → trace → construct → material → support → strokefont → guides → proof → svgout
→ svgread → zip → project → package → docs → engine → [preview → app]   (+ worker.js via importScripts)
```

`util.js` owns `SBUtil.crc32`, which is moved out of `zip.js` in S4; `zip.js` and `png.js` both call it.

| File | Global | New/Changed | Created in |
|---|---|---|---|
| `js/hash.js` | SBHash | new | T0.6 |
| `js/engine.js` | SBEngine | new | T0.5 (seam); full in G2.10a/b |
| `js/vendor/*.js` | per lib | new | S1 |
| `js/geom.js` | SBGeom | new | S1 |
| `js/diag.js` | SBDiag | new | G1.0 (registry); G2.2 (acks, gate) |
| `js/png.js` | SBPng | new | S4 |
| `js/jpeg.js` | SBJpeg | new | S4b |
| `js/material.js` | SBMaterial | new | G1.1 |
| `js/svgread.js` | SBSvgRead | new | G1.5 |
| `js/schema.js` | SBSchema | new | G2.1 |
| `js/height.js` | SBHeight | new | G2.3 |
| `js/construct.js` | SBConstruct | new | G2.6 |
| `js/support.js` | SBSupport | new | G2.7 |
| `js/proof.js` | SBProof | new | G2.12 |
| `js/strokefont.js` | SBFont | new | G3.2 |
| `js/guides.js` | SBGuides | new | G3.3 |
| `js/project.js` | SBProject | new | G3.6 |
| `js/package.js` | SBPackage | new | G3.9 |
| `js/docs.js` | SBDocs | new | G2.11c (`COPY`, `dimbarModel`, `pageFit`); G3.5 (`assembly`) |
| `js/worker.js` | — | new | G4.1 |
| `js/raster.js`, `trace.js`, `svgout.js`, `zip.js`, `util.js`, `islands.js`, `preview.js`, `app.js` | existing | changed | various (`islands.js:33` changed to a call-time lookup in T0.2) |
| `js/morph.js` | existing | unchanged API | — |

### Backward-compatibility matrix

| Surface | Today | After | Guarantee | Pinned by |
|---|---|---|---|---|
| `SBRaster.sheetMasks` | direct | wrapper over `SBHeight.tonalAdded` + `cumulativeMasks` | byte-identical on fixed luminance input | `test/golden/sheetmasks.json` (T0.4), G2.4 |
| `SBRaster.thresholds` (balanced/linear) | direct | adds `manual`, `domain`, `emptyBands` | identical values when `domain` is null | `test/golden/sheetmasks.json` thresholds, G2.4 |
| `SBIslands.resolve` | always runs (`app.js:115`) | connected strategy only | identical output in connected mode | G2.6 |
| `SBSvg.sheetSVG` / `proofSVG` | export path | legacy shims, frozen by hashed goldens; no longer on any export path after G1.7; removed in v2.1 | byte-identical to the T0.7 goldens | T0.7 |
| Source resize | canvas `drawImage`, upscales, 2000 px pre-cap | pure `SBRaster.resample`; never upsamples | same bands and polarity; pixels may differ (documented) | G2.0, CHANGELOG |
| `settings.json` v1.1.0 | export only | importable through `SBSchema.fromLegacySettings` | tonal and connected semantics kept; dimensions resolved when a source is attached | G2.4b, G3.8 |
| ZIP layout | flat `sheet_NN.svg`, `proof.svg`, `preview.png`; `_shadowbox.zip` | §9.4 `cuts/layer_NN.svg` …; `<name>_fabrication.zip` | documented in CHANGELOG | G3.9 |
| Frame | separate rectangle that detaches edge art | unioned material | intentional fix [UP] | G1.3 |
| Proof extent | art only, no margin | shared page frame | intentional fix [UP] | G1.6 |
| Registration holes (connected) | four fixed corners at `margin/2` | same four corners via `SBGeom.circle` + `subtractHoles` until G3.4; then validated positions | same positions until G3.4 | G1.7 |
| Sheet label (connected) | live `<text>` | kept via `layerSVG({legacyTextLabel})` until G3.2; then vector strokes | present in every release | G1.7, G3.2 |
| Start-up | auto-loads the demo | opens empty; Demo is a button | intentional fix (PRJ-01) | G2.11a |

---

## Decisions

Each decision is recorded here by the spike that owns it, with its measurement table.
Product-owner direction accepted on 2026-10-07 (plan Appendix B) is noted; the final
decision text is filled in when the spike lands.

**Gate status (2026-10-07): G1 open.** The plan's gate rule requires S1, S2, S5 and S6
merged with their decisions recorded before G1 starts. All four are recorded: D2 (S1),
D4 (S6), and — by the product-owner decisions of 2026-10-07 — D1 (S2, option (b)) and
D3 (S5 revision 2, which passed adversarial review; implemented in `js/geom.js`).
Product-owner laser target (2026-10-07): **D6** (machine profile, size by height, physical
fabrication pitch, 6 mm ply feature defaults; G2 order G2.0 → G2.1 → G2.1b → G2.2b → rest).
Tracked known item carried into G1–G4: **KI-B1**, the B1 benchmark overrun (D2, D4;
plan Appendix C), resolved in G4.4. Tracked since 2026-10-08: **KI-CONN-PERF**, the
connected-mode large-image cost (D6 item 11; plan Appendix D.8), resolved in G4 by the
G4.1 worker pool and/or smoothing optimisation.

### D1 — Smoothing rule

- Owner: spike S2 (recorded in G1.2 checks).
- Accepted direction (Appendix B.2, superseded for bonded mode by this decision): containment-aware per-loop fallback Chaikin → RDP → raw; clip-to-lower only as a reviewed repair.
- **Decision (product owner, 2026-10-07): option (b).**
  - **Bonded mode is unsmoothed:** layers keep the raw lattice contours of `SBTrace.trace` (no RDP, no Chaikin). Nesting then holds by construction (raw nested masks are always contained), so bonded mode has no containment fixpoint, no `SMOOTH_FALLBACK` and no smoothing cost.
  - **Connected mode keeps smoothing per plan (G1.2):** per-loop deviation-bounded fallback Chaikin(2) → RDP → raw against `toleranceMM`, art-rectangle vertices pinned, topology unchanged, fallbacks reported as `SMOOTH_FALLBACK`. Per the S1 amendment, **RDP runs before Chaikin** (Chaikin(2)∘RDP(ε), ε derived from the tolerance) and the tolerance loop runs per loop, not per layer.
  - Clip-to-lower stays a reviewed repair only (SUP-04).
  - **Deferred (not in G1 scope): option (c), per-vertex lazy pinning.** It is a later, performance-gated enhancement for both modes. It may be adopted only when it fits the NFR-03 totals at fabrication pitch — final plus validation p95 ≤ 10 s desktop and ≤ 8 s mobile (G4.4 workloads) — and it changes the Appendix B.2 fallback unit to a vertex, with `SMOOTH_FALLBACK` reported as "n of m corners kept sharp". Tracked in plan Appendix C (S2 → deferred) and risk R2.
- **Rationale:** S2 confirmed risk R2 for D1 as written: whole-loop fallback granularity (one over-tolerance corner demotes a loop of hundreds) leaves bonded corners almost unrounded (2.8 % on real images), and shared-boundary pinning (a) is dominated and hurts connected mode. Option (c) rounds 70–84 % of bonded corners but measured 13.4 s on busy-1536 against the 10 s NFR-03 budget. Option (b) is exact, free and deterministic, and connected mode is unaffected. Separately (F3), at the shipped default pitch (417 µm/px) and tolerance (50 µm) no option rounds any corner in either mode; procRes ≥ 1200 for 300 mm, or a looser tolerance, remained a separate product question that did not block G1. **F3 resolved 2026-10-07 by D6:** finer resolution, not tolerance — the fabrication pitch target is 0.1 mm/px with the unchanged 50 µm tolerance (S2 §6 F3: 0 % of corners round at 417 µm/px in every variant, 62–99 % across the variants at 100 µm/px; for the shipped connected-mode rule the D1 table gives 14.4 % on real images to 80.2 % on random input at 100 µm/px — the remaining gap is the R2 whole-loop fallback granularity, tracked separately as deferred option (c), not F3); bonded mode stays unsmoothed.
- Evidence: `docs/spikes/S2.md` (§0 verdict, §4.1 corners rounded, §4.3 cost, §6 F3, §7 proposed text); artifacts in `spikes/S2/`.

Corners rounded, layers ≥ 1, 100 µm/px, tol 50 µm; columns are random / busy-768 / busy-1536 / real images. Node prototype timings, spike machine under contention.

| Option | Bonded corners rounded | Connected, same rule | Bonded cost | Plan impact |
|---|---|---|---|---|
| (a′) D1 as written (whole-loop fallback) | 28.1 / 8.4 / 6.8 / 2.8 % | 80.2 / 59.0 / 43.2 / 14.4 % | 2.0–3.2 s per image; 4.5 s busy-1536 | none |
| (a) D1 + shared-boundary pinning | 42.2 / 22.5 / 22.9 / 7.8 % | 51.0 / 29.8 / 25.6 / 9.8 % with pins (hurts connected) | 1.5–2.9 s; 2.7 s | as v1 proposed |
| **(b) bonded mode unsmoothed — chosen** | 0 % | unchanged | 0 | kill switch |
| (c) per-vertex lazy pinning — deferred, perf-gated | 84.4 / 74.0 / 69.8 / 73.8 % | 96.2 / 98.9 / 99.2 / 79.0 % | 3.1–8.3 s per image; 13.4 s busy-1536 (NFR-03 budget 10 s) | changes Appendix B.2 fallback unit to a vertex; `SMOOTH_FALLBACK` reported as pinned-corner count |

All options end nested within 50 µm with topology unchanged and deterministic outputs.

### D2 — Geometry backend

- Owner: spike S1.
- Accepted direction (Appendix B.1): Clipper2 JS port (UMD/IIFE or wrapped); fallback in-house exact orthogonal booleans with square-join offsets.
- **Decision (S1, 2026-10-07): (a) Clipper2 through `clipper2-ts` 2.0.1-18**, vendored as `js/vendor/clipper2.js` (ESM bundle wrapped into a classic-script IIFE by the in-repo shim `spikes/S1/tools/wrap_clipper2.js`; SHA-256 and licence in `docs/COMPONENTS.md`). All callers go through `SBGeom` (`js/geom.js`); normalization (§3 winding, start vertex, collinear removal, canonical re-chaining, saddle split, hole hierarchy, sorting), measures, `validate` and `circle` are in-repo, so only `union`/`difference`/`intersection`/`offset` touch the library. `SBGeom.backend` names the pinned library. Fallback (c), the exact orthogonal lattice, stays documented in `spikes/S1/geom_lattice.js` and is not shipped. Full record: `docs/spikes/S1.md`.
- **Exit criteria:** (a) passes the 16-check plan battery, both plan load forms plus four stricter ones, is offset-capable (miter and square; round refused) and is within both plan budgets. (c) fails the B1 budget and cannot represent `SBGeom.circle` or any smoothed (non-orthogonal) contour. (b) `polygon-clipping` was not built: Appendix B.1 allows it only with an in-repo offset.
- **B1 is a narrow pass.** "Pairwise difference" is interpreted as **adjacent layer pairs only, in both directions**: 7 pairs × 2 = 14 differences per run (not all 28 layer pairs). On that reading the spike measured p95 **1.58 s** (median 1.49 s) against the 2 s target, with a 1-minute load average of 2.7–6.6 from concurrent work. The integration re-run of `node test/bench.js geom` (same code path; output fingerprint identical to the spike) at a load average of 6.2–7.5 measured p95 **2.16 s** (median 1.95 s), i.e. **over** budget under heavy contention. The margin is about 20 % on an idle i7-11800H and none on a loaded one; G4.1 (worker) and G4.4 must re-measure on the reference machines. With the S6 T-split B1 is now over budget (≈2.14 s p95): tracked as **KI-B1** (see D4, "Cost of the T-split").
- **B3 as specified is light** (`randomNestedStack(lcg(1),1536,1024,8)` has material only in layers 0–2), so `test/bench.js geom` also runs **B3b**, the same support pass on the dense B1 stack (3,407 support pairs), with its own provisional budget **p95 < 6 s** (measured 4.55 s in the spike; 5.64 s in the loaded integration re-run). G2.7 must bring it under the 3 s B3 budget (layer-level intersection only, worker, reuse of the B1 differences).
- **B3b under the B3 budget (G2.7, 2026-10-08); provisional 6 s budget removed.** `SBSupport.validate` (bonded-relief, 1.5 / 2.0 mm, contacts classified by `SBGeom.insetStatus`, bbox-sweep attribution, one layer-level boolean per adjacent pair; with the B1 differences reused, `Final[k] ∩ Final[k−1] = Final[k] − U` is `Final[k]` itself when contained): **B3b p95 1.32 s** (`bench geom`; 1.36 s in `bench support`), 3,407 pairs, 2,624 `SUPPORT_NARROW` and 160 `FEATURE_MARGINAL`; without reuse 1.55 s; B3 2.9 ms. Single thread, no worker, 1-minute load 8–9 from other processes; `docs/perf/SUPPORT.md`.

Measured on Node v26.7.0 (V8 14.6), i7-11800H (8C/16T), 62 GB RAM; page 1536×1024 px at 200 µm/px (307.2 × 204.8 mm); p95 over 15 runs (B1) or 7 runs (B2/B3) after warm-up. Spike runs; concurrent load 2.7–6.6.

| Candidate | Battery pass | Load forms | Vendored size | Licence | Offset | **B1** 8 × ~50k, adjacent-pair difference ×2 directions, p95 (target < 2 s) | **B2** offset p95, same size | **B3** support pairs p95 (target < 3 s) |
|---|---|---|---|---|---|---|---|---|
| (a) Clipper2 (`clipper2-ts` 2.0.1-18) + in-repo shim | 16/16 (+22/22 extended) | classic script ✔, no import/export ✔, Firefox `<script src>` ✔ | 125.5 kB (34.2 kB gz) + adapter (`js/geom.js`) | BSL-1.0 | miter, square (round refused) | **1.58 s** ✔ narrow (median 1.49 s; 2.16 s under load 6–7) | −1500 µm ×8: 2.67 s; +300 µm ×8: 1.68 s | **0.010 s** ✔ (0.110 s incl. trace + normalize) |
| (c) in-house exact orthogonal lattice | 16/16 (+20/22 extended) | in-house only | 8.8 kB + shared core | repo licence | Chebyshev (square = miter) | 3.17 s ✘ (median 2.87 s) | −1500 ×8: 1.43 s; +300 ×8: 1.49 s | 0.050 s ✔ |

Supplementary (no plan target): single 50k × 58k difference p95 0.24 s (a) / 0.34 s (c); **B3b** dense support pass p95 4.55 s (a) / 6.95 s (c), naive per-part-pair loop 39 s (a); B4 (B1 on smoothed, non-orthogonal layers, 97k–192k vertices) p95 5.32 s (a only). Determinism: byte-identical output across Node, Deno and Firefox (SpiderMonkey).

Contract notes recorded with this decision:

1. **Canonical re-chaining (feeds D3, D4).** Raw Clipper2 chaining at vertex contacts is not canonical (seed 23: two diagonally touching pieces came back as one outer with a vertex-touching hole, so `components` said 1 instead of 2). `SBGeom` re-chains every result: at each vertex shared by several boundary edges, the arriving edge continues on the sharpest left turn read in the math frame (exact integer cross/dot products), which is the right-most, material-separating turn in the Y-down frame that D3 specifies (one rule; see D3 item 3), then splits saddles. The normalized output — and therefore any geometry hash — depends only on the edge set, not on the backend. Pinned by the 240-case property check `components(L_(k−1) − L_k) = 4-connected pixel components` in suite "spike S1". Known limit at S1: a vertex touching the interior of another ring's edge (T-contact) was not re-chained. Closed by spike S6: `SBGeom` now inserts T-contact vertices before re-chaining (see D4, "T-contacts").
2. **Offset joins (GEO-05).** `"miter"` (limit 2.0) is exact on the pixel lattice: every 90° corner stays square. It is the join for exact lattice semantics. `"square"` is Clipper2's squared (chamfered) corner, not a Chebyshev square: +200 µm on a 1000² square gives 1,932,622 µm², against 1,960,000 for miter. `"round"` is refused (NFR-05).
3. **Circles (NFR-05, ASM-04).** `SBGeom.circle` rounds each offset `r·t/1e6` half away from zero in exact integer arithmetic, so the ring is 8-fold symmetric about the centre even on exact .5 ties (plain `Math.round(cx + r·t/1e6)` is not: r = 500,000 µm breaks it). The ring is cleaned like any output, so it has 64 vertices for every radius ≥ 232 µm (checked to 200 mm); below that, rounding makes some vertices coincide or fall collinear and they are removed. It validates at every radius checked (1 µm–20 mm). Centre and radius must be integers.

### D3 — Finite-width contact and saddle splitting

- Owner: spikes S1 and S5; GEO-02 thresholds used by G2.7.
- Accepted direction (Appendix B.3, now made precise by this decision): support overlap below 0.5 µm blocks export; contact width below the full minimum feature width warns. Vertex-touching rings (pixel saddles) are split into simple rings during normalization.
- **Decision (product owner, 2026-10-07): adopt the amended D3 of spike S5 revision 2**, which passed adversarial review (`docs/spikes/S5.md`, "Recommendation"; artifacts in `spikes/S5/`). Implemented in `js/geom.js`.
  1. **Connectivity.** Material parts are 4-connected; contact at a single point (vertex or T) never joins two parts. `SBTrace.trace` already keeps diagonal contact separate, so G1.1 needs no `SBMorph` pre-split.
  2. **Global normalize** (`SBGeom.normalize` and every boolean/offset result; `assemble` in `js/geom.js`), across all rings of the result:
     1. node T-contacts — a vertex strictly inside another edge (own ring included) is inserted into it (exact integer collinearity), so every contact is a shared vertex;
     2. re-pair every shared vertex with the **material-separating turn** using exact half-plane and cross-product tests — **Clipper2's ring pairing is never trusted** (S5 F1: it mixes separating and joining continuations, and splitting before re-pairing flips the pairing at each split vertex);
     3. only then split rings that still repeat a vertex (an outer becomes an outer plus a touching hole, a hole becomes two holes; never two outers);
     4. drop collinear vertices, orient (outer positive, holes negative), rotate to the minimum vertex, nest holes in the smallest containing outer, sort.
  3. **Turn rule, reconciled.** The shipped re-chaining picks the "sharpest left turn" when the integer coordinates are read in the math frame (Y up, material on the left); S5 states the "right-most turn" in the Y-down frame (material on the right of travel). They are one rule: both select the outgoing edge that bounds the same material wedge. The D2 note 1 wording and the `rechain` comment now say so, and suite "spike S5 — D3 turn rule" checks every successor of the shipped `SBGeom.rechain` against S5's exact comparator (60 raw Clipper2 unions, 24,290 directed edges, 10,468 at shared vertices, plus T-contact/diagonal cases: 0 differ).
  4. **Postcondition: one polygon per part.** Rings of one polygon may touch at isolated points without crossing (outer–hole, hole–hole). `SBGeom.interiorConnected(poly)` is the exact test: the bipartite ring–contact-point graph (T-contacts included) must be a forest (interior components = 1 + cycle rank). **`components()` asserts it** (throws `GEO_MULTIPART_POLYGON`) and **`validate()` reports `GEO_MULTIPART`** for an otherwise valid polygon that fails it. Cost: ≈7 % of the union time on worst-case 1536 × 1024 noise (0.6 s vs 9.1 s for 104k parts).
  5. **Finite-width contact.** For a support intersection I, width w = 2·r\*, r\* the radius of the largest disk inside I; "I survives an inset of d" ⇔ r\* ≥ d.
     - **BLOCK if w < 0.5 µm** — a contact *width*, i.e. I does not survive an inset of **0.25 µm** (empty, point and line contact included).
     - **WARN `SUPPORT_NARROW` if w < `minFeatureUm`**, i.e. I does not survive an inset of `minFeatureUm/2`; a width exactly at the limit passes. **`minFeatureUm` is rounded to an integer µm before halving**, so the inset is dyadic.
     - "Survives" means **certified by an exact BigInt witness** (`SBGeom.insetStatus` → `"survives"`): a rational point strictly inside I with every edge at distance ≥ d. `"fails"` is certified by an empty bevel inset at d − m through Clipper2; anything else is `"undecided"`, which **counts as not surviving** (`survivesInset` is true only for `"survives"`), so the test never reports a contact wider than it is. `SBGeom.classifyContact(I, minFeatureUm)` returns `block | warn | ok`.
     - **Never implemented with `SBGeom.offset`.** Clipper2 `Paths64` offsets are meaningless below the 1 µm grid (S5 F4: `|delta| < 0.5` is a no-op; −0.5 gives `[]`, a wrong half-area polygon or a correct shrink depending on orientation and shape). **`SBGeom.offset` refuses non-integer, hence any sub-µm, deltas** (`GEO_OFFSET_NONINTEGER`).
     - With integer-µm vertices every axis-aligned non-empty overlap is ≥ 1 µm wide, so it warns rather than blocks; only empty intersections and sub-0.5 µm slivers from non-axis geometry block. This follows B.3's text (product-owner note in S5 Recommendation 2, accepted).
- **Rationale:** S5 F1 showed the plan's split-only rule is order-dependent and fails the raster oracle on whole families of masks (562 of 1,000 noise masks), while the re-pair rule passed every sweep; the width reading makes B.3's two clauses consistent and the certified test is exact where the old miter-at-scale test was wrong on 16–125 of 2,398 near-threshold cases.
- **Differences from the spike adapter** (recorded, not behavioural for the boolean):
  - S5's Round-join failure certificate is not shipped (it uses trig inside Clipper2; NFR-05). It only turned `undecided` into `fails`, so reflex-bound shapes that are certified `fails` in S5 are `undecided` here (full sweep: 28 of 84 L-shapes, 44 of 84 plus-shapes; all truly failing) and the `survivesInset` boolean is unchanged. The pattern-search direction table is built from the in-repo `COS64` table (no trig).
  - **G2.7 amendments to `SBGeom.insetStatus` (2026-10-08; verdict semantics unchanged: a certificate is still exact, `undecided` still counts as not surviving).** (a) Step 0 "quick": a scale-free float search (8×8 grid of cell centres, then ≤ 48 pattern-search steps from the three deepest) snapped to 1/4096 µm and verified by the same exact witness check, before any Clipper2 inset; it carries the large pieces of B3b. (b) An **erosion failure certificate** (no trig): I minus a strip of half-width D − m − 1 along every edge and two inscribed pie slices (COS64 arcs, truncated towards the centre) at every reflex vertex, in one Clipper2 difference; empty ⇒ fails by the bevel margin argument. It closes the reflex-vertex band the Round join covered in S5: the L- and plus-shape families are now certified at default with **0 undecided** (full sweep 0 of 84 / 0 of 84; was 28 / 44). (c) The two failure certificates run before the Clipper2 witness insets (sound, so they never pre-empt a witness). (d) `verifyWitness` decides each edge in floating point when it is clearly farther than d + 1e-5 µm and unambiguous for the parity ray (power-of-two q, |coordinates| ≤ 2^25 µm, so the inputs are exact doubles), and falls back to BigInt otherwise. (e) `refine` stops once the depth exceeds d + 0.001 µm. Pinned by the S5 suites (no wrong certified verdict, no cross-scale contradiction, every witness re-checks; `--s5-full` clean).
  - Orphan holes are dropped by `normalize` as before (D4 amendment C makes `canonicalBytes` throw on them); `GEO_RING_TOUCH`/`GEO_SELF_TOUCH` are not added to `validate()`.
- **Evidence:** `docs/spikes/S5.md` (F1 mechanism and sweeps, F2 frame union, F4 Clipper2 sub-µm offsets, F6 certified test, Recommendation); ported checks in `test/run_tests.js`, suites "spike S5 — …" (oracle `test/oracle_raster.js`; reduced sweeps by default, spike sizes with `node test/run_tests.js --only "spike S5" --s5-full`: 7 sweeps, 148,791 multi-part saddle cycles, 0 oracle failures; split-only rule fails 983 masks, all caught by `interiorConnected`; finite-width families 0 wrong certified verdicts, 2,398 parallelograms with 196 undecided, all truly failing).
- Unchanged: `SBTrace.trace` keeps diagonal-only contact as separate loops (suite "spike S5 — trace saddles & frame contact (GEO-02/03, AT-06)").

### D4 — Hash scope

- Owner: spike S6 (`SBGeom.canonicalBytes`).
- **Decision (S6, 2026-10-07): accept the spike proposal (`docs/spikes/S6.md` §5) with amendments A, B and C.** Implemented in `js/geom.js`; pinned by the suites "spike S6" in `test/run_tests.js`.
- **Canonical form (`SBGeom.normalize`):** integer µm, Y-down; outer rings positive, holes negative; every ring starts at its smallest (x, y); no duplicate, collinear or spike vertices; vertex **and T** contacts resolved into simple rings, so point contact never connects material (D3); holes and parts sorted by (bbox minY, minX), then by the full coordinate sequence (a total order). Input must be boolean-resolved: `normalize` does not merge overlapping or edge-sharing parts.
- **T-contacts.** A vertex lying strictly inside another edge (of any ring of the layer, its own included) is inserted into that edge before the S1 re-chaining, so the sharpest-left-turn rule separates it like any shared vertex. This closes the "known limit" in D2 note 1: S6 showed Clipper2 `difference` does emit T-contacts (a square minus a diamond whose corners sit on the square's edge midpoints). It runs inside `assemble`, so every boolean result, `fromPixelLoops` and `normalize` get it. Axis-parallel edges are matched by binary search among the vertices of the same row or column; other edges use a uniform grid whose only division sizes the cells.
- **Byte stream (`SBGeom.canonicalBytes(layers)` → `Uint8Array`, little-endian int32):** `[layerCount, (index, partCount, (ringCount, (vertexCount, x, y…)…)…, scoreCount, (vertexCount, x, y…)…, holeCount, (cx, cy, r)…)…]`, layers in ascending index order. `canonicalBytes` always normalizes, so the bytes never depend on the caller having done it.
  - **Amendment A — hole section.** Registration holes `{cxUm, cyUm, rUm}` are appended, sorted by (cy, cx, r). A hole that misses material, or moves by less than its effect on the cut, still changes the hash (G3.1).
  - Score paths: consecutive duplicates removed and pass-through collinear points dropped; reversals and spikes are **always kept**, because every vertex where the line turns back bounds a segment that is burned. An open path is oriented so the smaller endpoint comes first. A closed path (first point repeated last) is cleaned *cyclically* by the same rule (it does **not** go through `cleanRing`, which removes spikes: a ring with a 100 µm out-and-back tail must not hash like the plain ring), then written as the lexicographically smallest rotation starting at its smallest (x, y) vertex, in the positive direction when its signed area is non-zero and in either direction when it is zero (out-and-back, zero-area loops, self-cancelling bowties); the closing point is repeated. Every score path is therefore start- and direction-invariant, degenerate ones included, and none that has a segment is ever dropped (dropping one would remove a burned line from `layerHash` without a diagnostic). The only paths dropped are those with fewer than two distinct points after deduplication (`[]`, `[x, y]`, `[x, y, x, y]`): they have no segment, burn nothing, and hash like an absent path. Then sorted.
  - Guards: a layer index must be ≥ 0 and a registration hole radius > 0 (both throw otherwise); rings and score paths must be plain `Array`s (a typed array throws, naming its type).
  - Layer indices must be distinct: `canonicalBytes` throws on a duplicate index, because two layers with the same index would be emitted in input order.
- **Amendment B — two layer hashes** (breaks the guide/hash cycle of G3.3):
  - `SBGeom.materialHash(L) = sha256(canonicalBytes([{index, material, holes}]))`, i.e. `scoreCount = 0`. It is `MaterialLayer.canonicalHash` and is what guide invalidation (SUP-05, `part.guideRefs`), `Repair.reviewed.beforeHash`/`afterHash`, MAT-04 and part-ID stability use.
  - `SBGeom.layerHash(L) = sha256(canonicalBytes([L]))`. Only this one enters `geometryHash.layers`.
  - `SBGeom.layerHashes(L) → {materialHash, layerHash}` derives both from one normalization (the engine should use this).
- **`geometryHash`** stays as in §3: `hashJSON({key, engine, quality, raster, layers: layerHashes, guides: guideHash})`, with one `layerHash` per index 0..N−1 (an empty layer hashes the words `[1, k, 0, 0, 0]`). Score polylines are already inside `layerHash`, so `guideHash` covers only labels, omissions with reasons, and the map. The multi-layer `canonicalBytes(allLayers)` is not hashed for `geometryHash` (hashing the layer hashes is equivalent and half the cost); it stays available for packaging.
- **Excluded from every geometry hash:** derived data (`parts` and IDs, `cutPaths`, `stats`, `diagnostics`; `zBottomMM`/`zTopMM` come in through `geometryKey`), and `appearance`, `view`, `acks`, `extras`, `title`, `units`. `carriers` is `[]` in v1.0; populating it means a new section and an `engine.version` bump.
- **Amendment C — determinism guards.** `canonicalBytes` (and the hash functions) throw on a non-integer coordinate, index or hole field, and on |v| > 2^25 µm (`SBGeom.COORD_LIMIT`, 33.5 m), which keeps every cross product an exact double; nothing is ever truncated. No transcendental math in `geom.js` (static check in the suite). Any change to normalization or to the byte layout requires an `engine.version` bump; persisted `materialHash` values then mismatch and repairs fail closed (`REPAIR_STALE`).

Differences between the shipped code and the spike reference (`spikes/S6/canon.js`), all deliberate:

1. Normalization reuses the S1 pipeline (`cleanRing` → T-split → `rechain` → `splitRing` → classify → smallest containing outer) rather than the spike's per-polygon `faceTrace`; both apply the same left-most-turn rule. T-splitting runs over all rings of the layer at once, so a T-contact *between* parts is resolved too.
2. Ring roles in `normalize` come from position (outer forced positive, holes forced negative), the S1 contract, not from orientation relative to the outer. The spike check "a hole wound like its outer is material" is therefore not ported. On boolean-resolved input, the only input D4 admits, the two agree.
3. Orphan holes (no containing outer) are dropped by `normalize`, as in S1, instead of throwing. `canonicalBytes` and the hash functions do **not** accept them: under amendment C an orphan hole would vanish from the hash, so they throw (it cannot happen on boolean-resolved input).
4. The spike's dev-only `clipper2-js` 1.2.4 is not used; the property checks run through the shipped backend (`clipper2-ts`, D2).

Measured on the spike reference (`spikes/S6/canon.js` and its dev-only `clipper2-js`, not the shipped code; Node 26, i7-11800H; hash stage = `canonicalBytes` + `sha256` per layer + project stream, 5 warm-ups, 30 runs):

| Workload | Vertices | Canonical bytes | p50 / p95 |
|---|---|---|---|
| Desktop final 1536², 8 layers | 16,288 | 131 KB | 72 / 92 ms |
| Desktop draft 720², 8 layers | 7,512 | 61 KB | 34 / 55 ms |
| Mobile final 768², 6 layers | 4,498 | 36 KB | 18 / 21 ms |
| Desktop final, raw staircase (no RDP), 8 layers | 39,962 | 321 KB | 254 / 311 ms |

Measured on the **shipped** `SBGeom` (`js/geom.js` with the T-split; `spikes/S6/bench_shipped.mjs` → `bench_shipped_results.json`; same workloads, same method; material = `SBGeom.union(fromPixelLoops(trace))`; Node 26, i7-11800H, load average 4–6). Vertex and byte counts match the spike rows exactly. Column A is the spike's method; column B is the G2.10b wiring (`layerHashes` per layer, both D4 hashes, no project stream):

| Workload | Vertices | Canonical bytes | A: `canonicalBytes` + `sha256` + project, p50 / p95 | B: `layerHashes`, p50 / p95 |
|---|---|---|---|---|
| Desktop final 1536², 8 layers | 16,288 | 131 KB | 55 / 76 ms | 37 / 42 ms |
| Desktop draft 720², 8 layers | 7,512 | 61 KB | 28 / 46 ms | 19 / 31 ms |
| Mobile final 768², 6 layers | 4,498 | 36 KB | 15 / 17 ms | 12 / 13 ms |
| Desktop final, raw staircase (no RDP), 8 layers | 39,962 | 321 KB | 113 / 138 ms | 95 / 124 ms |

The shipped hash stage is within the spike's numbers on every row (at most 1.4 % of the 10 s final budget and about 3 % of the 1.5 s draft budget at p95). G4 re-measures on the reference machines.

Cross-engine (spike): all 8 layer hashes and the project hash of the 1,660-part draft fixture (`spikes/S6/fixture_draft.json`) are byte-identical in Node 26, headless Chromium 152 and headless Firefox 155.

**Cost of the T-split on the S1 B1 workload** (integration, A/B interleaved in one process, 10 runs each, load average 6–8): B1 (14 differences on 8 × 30k–60k-vertex layers) median 1.61–1.88 s without, 1.88–2.16 s with, a ratio of **1.12–1.18**. The split itself costs about 17 ms per 50k-vertex layer (≈40 % of `assemble`). Output is unchanged on lattice input (B1 fingerprint `27fa97ef…` identical). B1 was already a narrow pass (D2). **Open — needs a plan-owner decision:** with the T-split, `node test/bench.js geom` now puts B1 over its 2 s budget under load (review run at load 5–7: p95 2032.6 ms, median 1953.9 ms, `overBudget: ["B1"]`, exit 1 without `--no-fail`). This is a permanent +12–18 % on a gate metric, not only a G4.4 re-measure item; see plan Appendix C, S6 → G4.4.

**Decided (product owner, 2026-10-07): KI-B1.** B1 keeps its 2 s budget. The current ≈2.14 s p95 overrun, caused by the S6 T-split, is a tracked known item resolved in G4.4 by optimizing normalize (S5 F5 also measured worst-case union + normalize at 19 s against 5.9 s for the Clipper2 union alone: numeric vertex keys, skipping noding when no collinear contact exists, one normalize per boolean). `node test/bench.js geom` reports B1 as `KNOWN-OVER (tracked)` in `knownOver` with the reference `KI-B1` instead of failing the gate; any untracked overrun still exits 1. After the D3 commits (load 5–6): B1 p95 2126.6 ms (median 2025.5 ms), fingerprint `27fa97ef…` unchanged.

### D5 — Sub-8-bit gray PNG in height mode

- Owner: spike S4 (`SBPng`, `js/png.js`); product-owner decision requested in `docs/spikes/S4.md` §6.3.
- **Decision (S4 integration, 2026-10-07): accept, by exact integer scaling — the spike recommendation (`raw-grayN-scaled8`).** 1-, 2- and 4-bit grayscale PNGs (colour type 0) decode in both modes with every raw sample multiplied by 255/(2^N − 1), i.e. ×255, ×85 and ×17. The result is recorded as `policy` / `source.decode` `"raw-gray1-scaled8"`, `"raw-gray2-scaled8"` or `"raw-gray4-scaled8"`. §3 mirrors plan §3 verbatim, so the `source.decode` enum gains these values and `"raw-palette-gray8"` when G2.1 lands (plan Appendix C, S4 bullets). A tRNS gray key is matched against the raw (unscaled) samples. Gray palettes (colour type 3) at any depth are unaffected (`"raw-palette-gray8"`, entries are 8-bit by definition).
- **Why:** ImageMagick's default PNG writer stores a 4-level gray heightmap as 2-bit gray, so terraced or posterized heightmaps arrive in this form. The scaling is not a precision change: the output matches libpng/ImageMagick byte for byte (0 differing pixels on the spike corpus), and it is deterministic integer arithmetic (NFR-05).
- **Rejection stays available:** `SBPng.check/decode(…, {lowBitDepth: "reject"})` returns/throws `PNG_BITDEPTH` in height mode. The product owner may switch the intake default to it without a code change in `png.js`; the code remains in `SBPng.CODES` and the G1.0 registry.
- Pinned by suite "spike S4 — amendments" (`S4-A3 …` checks).
- Related S4 contract notes: `sampleHash` covers the samples only (identical bytes in a 5×1 and a 1×5 image collide), so it identifies a source only together with `w` and `h`, which `source` always stores next to it; never use it alone as a cache or dedup key. `decode` refuses `w·h > maxPixels` (default `SBPng.MAX_PIXELS` = 2^26) before allocating, independent of the IMG-07 preflight.

### D6 — Laser target: machine profile, size by height, physical fabrication pitch

- Owner: product owner (requirements of 2026-10-07); plan Appendix D; tasks G2.0, G2.1, G2.1b, G2.2b, G2.7, G2.7b, G2.8, G2.10a, G2.11b/c, G2.14, G3.5, G3.9, G3.10, G4.1, G4.3, G4.4, G5.1.
- Target: **xTool S1 with the conveyor feeder, 40 W diode, 1/4" basswood or poplar plywood.** Requirement IDs: SRS IDs where the SRS states the rule, otherwise `PO-LASER-1`…`PO-LASER-10` (plan Appendix D.1 and §1).
- **Decision (product owner, 2026-10-07):**
  1. **Machine profile (PO-LASER-1).** A top-level, editable `machine` section is persisted in the project (§3 `MachineProfile`) and is part of `geometryKey`. Default `SBSchema.MACHINES["xtool-s1-feeder"]`, "xTool S1 + feeder": `maxProcessingHeightMM` 470, `maxLengthMM` 3000, `maxMaterialWidthMM` 545, `maxThicknessMM` 14, `kerfMM` 0.15. `machine: null` turns the envelope check off. It replaces the plan's `geometry.bedMM`.
  2. **Machine fit (PO-LASER-2, GEO-10).** The engine (G2.10a, stage 12) checks the shared page — the extent of every layer sheet, frame included — against the processing area in either orientation, in µm: `(W ≤ L ∧ H ≤ P) ∨ (W ≤ P ∧ H ≤ L)`. Failure is `PAGE_OVERFLOW` (blocking); stock thicker than `maxThicknessMM` is `MACHINE_THICKNESS` (blocking). Nothing is rescaled.
  3. **Size by height (PO-LASER-3).** `geometry.sizeBy: "height"` is the default (width mode kept); `geometry.targetMM` (default 300 mm, proposed) is the finished page along that axis, art plus 2 × frame; the other axis follows the oriented source aspect on the 1 µm grid (`SBSchema.resolveSize`).
  4. **Physical pitch (PO-LASER-4, amends LYR-06).** `geometry.fabPitchMM = 0.1` replaces `geometry.fabPx` (1536, up to 4096). `SBRaster.fabRaster` derives the fabrication raster from the artwork size, coarsens the pitch in integer 1 µm steps until it fits the device pixel budget `SBSchema.limits(deviceClass).fabPxBudget`, and clamps each axis to the source. A cap emits `FAB_PITCH_CAPPED` (info: actual vs target mm/px, device class, budget), shown in the dimbar before generation and in the manifest — the "never silently" of NFR-04. Budgets measured by G2.2b (2026-10-08, `docs/perf/LARGE_IMAGE.md`): **desktop 25 Mpx, mobile 1 Mpx** (bonded mode; mobile k = 4 provisional until G4.4); the provisional 16 / 4 Mpx are retired. The draft raster stays 720 px on the long side. `SBEngine.rasterPlan` (G2.1b) is the single rule for both qualities.
  5. **Source pixel check (PO-LASER-5, GEO-06).** The engine never upsamples. A source with fewer pixels than the target raster gives `FAB_EXCEEDS_SOURCE` (warning) with the shortfall in px; mm/px always comes from the real raster.
  6. **6 mm ply feature defaults (PO-LASER-6, amends the MAT-03 starting value).** `material.minFeatureMM = 1.5` with D3 unchanged (contact width < 0.5 µm blocks; `SUPPORT_NARROW` below `minFeatureMM`), plus `material.advisoryFeatureMM = 2.0`: contacts, parts and necks below it give `FEATURE_MARGINAL` (warning). Both stay provisional and editable (MAT-03 wording). `SAMPLING_LOW` then requires mm/px ≤ 0.5.
  7. **Kerf (PO-LASER-7, MAT-05).** `kerfMM` 0.15 is recorded in the profile, the assembly guide and the manifest. The plan has no internal kerf compensation in v1.0 (SRS L54, L613), so export stays nominal with `kerfMode=external` and the operator applies the kerf in the laser software.
  8. **Thickness (PO-LASER-8).** 6.35 mm nominal stays (PRJ-01), editable, with a hint that 1/4" ply is often 5.5–6 mm and a measured value should be entered.
  9. **Performance (PO-LASER-9, NFR-03/04).** The SRS §12.3 workloads and NFR-03 budgets are unchanged and remain the acceptance workloads. G2.2b adds laser-detail workloads (4–25 Mpx, and a 470 mm-high page at 0.1 mm/px) and sets the budgets by the rule in plan G2.2b: the desktop budget is the largest of 16/20/25 Mpx within 512 MiB and the laser-detail target; the target is 10 s unless 16 Mpx cannot meet it, in which case a relaxed target (measured p95 rounded up to 5 s, at most 60 s, else escalate) is recorded in the table below and applies only to fabrication generation above the SRS workload size. G2.7 must bring B3b (dense support pass) under the 3 s B3 budget with one layer-level intersection per adjacent pair and `survivesInset`.
  10. **G2 order (PO-LASER-10):** G2.0 → G2.1 → G2.1b → G2.2b → G2.2 … G2.7 → **G2.7b** → G2.8 … G2.14 in plan order (plan Appendix D.4; G2.7b added 2026-10-08, item 12).
  11. **G2.2b stop condition — decided (product owner, 2026-10-08): option (a).** The exploratory run hit the G2.2b stop rule (no mobile candidate ≥ 2 Mpx qualified), driven by connected-mode cost. Decision:
      - **Bonded mode gates.** The pixel budgets and NFR-03 gating are measured in **bonded mode** (the plywood/laser default, D1 unsmoothed). Connected mode is still measured and reported by `node test/bench.js large` (`stages.finalConnected`, `knownOver`), but never gates.
      - **KI-CONN-PERF (tracked known item).** Connected-mode final + validation costs about **18 s** p95 on the SRS §12.3 desktop reference (NFR-03: 10 s), dominated by `maxDeviationUm` (`segDist` / `distToGrid`) and the T-junction split. It is resolved in G4 by the worker pool (G4.1) and/or smoothing optimisation; until then connected mode stays functional and its measured times are documented (`docs/perf/large-image.json`, the table below). Reported as `KNOWN-OVER (tracked)` with id `KI-CONN-PERF` (`TRACKED_LARGE` in `test/bench.js`). **Draft review views (G2.12, 2026-10-08):** since G2.12 the Proof, Section and Tilt views are built from `SBEngine.connectedLayers` on the main thread after every pipeline run, not only at export. With smooth corners (the acrylic default) the G2.12 review measured it, in Node at the 720 px draft, at about 1.8 s on a simple image and about 10.8 s on a busy one (sharp corners: 0.2 s and 1.0 s), on top of about 0.8–1.0 s of `legacyRun`. Mitigation until G4.1: `renderAll` shows the Layers grid, chips, status line and a raster composite of the new masks first and defers the polygon build by one frame plus one task (a newer run supersedes a pending build); the status line reports `proof N ms` when it lands. The build itself still blocks the page for its duration; G4.1 moves it to the worker pool. **Needs explicit product-owner acceptance.**
      - **Mobile.** Candidates below 2 Mpx are added: **1.0, 1.25 and 1.5 Mpx** (rows `r1`, `r1.25`, `r1.5`) next to 2/4/6/8 Mpx, under the unchanged mobile rule (working set ≤ 192 MiB, desktop p95 × k ≤ 8 s, k = 4 provisional). If none qualifies in bonded mode, **mobile fabrication is draft-only**: fabrication export is disabled on mobile with a clear diagnostic (`FAB_DEVICE_DRAFT_ONLY`, registered and emitted when the outcome is recorded — G2.2b part 2, enforced by G2.14 preflight and the G2.2 export gate), draft stays available. The outcome is recorded; it does not stop G2. **Recorded outcome (G2.2b part 2, 2026-10-08): `r1` qualifies (1820.3 ms × 4 = 7.3 s, 62.6 MiB), so mobile fabrication is enabled at 1 Mpx and `FAB_DEVICE_DRAFT_ONLY` is not registered.** It returns only if a later re-measure (G4.4, measured k) leaves no mobile candidate.
      - **Worker pool (G4.1, expanded).** A pool of Web Workers sized from `navigator.hardwareConcurrency` (capped) parallelises the per-layer and per-adjacent-pair stages (trace / `fromMasks`, smoothing, differences, support pass, `layerSVG` / hashes) with a deterministic merge order, so every hash is unchanged; the engine-version handshake stays. It may be pulled earlier if performance blocks progress.
      - **Machines.** Benchmarks run on the Linux development machine (i7-11800H, 16 threads); budgets measured there are conservative for the owner's other machine (MacBook Air M5). Safari / JavaScriptCore coverage stays in G4.8.
  12. **G2.2b shortened run and busy art — decided (product owner, 2026-10-08).**
      - **Shortened method.** The full run (5 + 30 runs at the gated points) was stopped after about 6.5 h as overly thorough. The rows it had completed are kept as measured data (from their `[large]` summary lines, provenance `log`); only `r25` and `laser470` were then run live (1 + 5); the busy rows `b20`, `b25` and `laser470-busy` were skipped. `docs/perf/large-image.json` records `method: "shortened"`, each row's provenance and run counts, and the load (background ≈ 3–4 from desktop processes). Built with `node test/bench.js large-assemble`; see `docs/perf/LARGE_IMAGE.md`.
      - **Budgets** derive from the realistic-family bonded rows by the item 9 rule: desktop **25 Mpx** at the 10 s target (not relaxed; `r25` 9.75 s, 404 MiB — a 2.5 % margin measured under load, re-checked in G4.4, fallback 20 Mpx), mobile **1 Mpx** (enabled).
      - **Busy art is bounded by part count, not pixels.** The busy rows are reported as evidence: 2k–8k parts/layer give 35–163 s bonded at 4–16 Mpx (10.7× to 22.7× the realistic row of the same size), while realistic art stays near 120 parts/layer and under 10 s up to 25 Mpx. So the **complexity caps and busy-art simplification** (per-device part/vertex caps, merging or dropping tiny parts, clear diagnostics; formerly part of G4.3) move forward into G2 as **G2.7b**, right after the support task G2.7 (plan Appendix D.4, D.9). The G4.1 worker pool is the other mitigation.
  13. **G2.7b complexity caps — recorded (2026-10-08, `docs/perf/LARGE_IMAGE.md` "G2.7b", `docs/perf/complexity.json`).** `SBSchema.limits(deviceClass)` gains `maxPartsPerLayer`, `maxVerticesPerLayer` and `maxVerticesTotal`. **Desktop 258 / 132,000 / 356,000** are measured by `node test/bench.js caps`: busy art at the 25 Mpx budget with growing part counts, bonded; 258 parts/layer is the largest count at which every busy row with as many or fewer parts meets 10 s, `c208` 9.64 s, and `c192` at 309 parts misses with 10.21 s. The vertex caps admit every passing row and the realistic `r25`, which has 182,556 vertices. **Mobile 100 / 20,000 / 20,000** are the SRS §12.3 values. Over a cap, the result is `COMPLEXITY_LIMIT` (blocking, process) with `measured`, `limit`, the layer (null for the total) and `deviceClass`, and **no** masks or layers are returned. The parts check runs before trace (`SBConstruct.complexityGate`, from `estimateComplexity`); the vertex check runs after `fromMasks` and before validation (`SBConstruct.vertexGate`). G2.10a stage 11 consumes both unchanged. **Busy-art simplification is explicit:** `construction.cleanup.simplify: "off" | "busy"`, default `"off"`, in `geometryKey`. `"busy"` closes each layer at radius ⌊(⌈minFeatureUm / pitch⌉ − 1) / 2⌋ px, which merges parts closer than the minimum feature, then drops parts below `material.minPartMM2`. Both steps are monotone, so nesting is kept (D-4.5). Each quality applies the rule at its own pitch, and the result is reported as `BUSY_SIMPLIFIED` (info) with the before and after part counts per layer. With the caps, `b4` and `b9` fail in 0.1–0.3 s; with simplification they run in 3.7 s and 8.1 s. Simplification costs about 5.5 s at 25 Mpx (reported, not gated; G4.1).
      - **Working set.** The 512 MiB rule for the caps is applied to the **live set** (`gc()` before each stage-boundary sample). The G2.2b peak, which includes uncollected garbage, is recorded beside it but is too noisy in bonded-only runs to rank rows (it ranges from 488 to 714 MiB, independent of part count).
      - **Mobile vertex cap — decided (product owner, 2026-10-08): kept.** The SRS mobile vertex cap (20,000 total) does not admit the realistic art at the 1 Mpx mobile budget: it has 31,944 vertices after bonded construction, and the SRS 768² workload has 25,588, because bonded contours are unsmoothed staircases (D1). The cap stays at the SRS value and **mobile is limited to simpler art**: once G2.10a enforces the caps, a mobile user with typical art sees `COMPLEXITY_LIMIT`, and on mobile its message adds "mobile is limited to simpler art, so simplify it or open the project on a desktop". No other feature; G4.3/G4.4 re-check the caps on the reference device.
  14. **IMG-07 desktop source cap — decided (product owner, 2026-10-08, laser target).** The engine never upsamples, so the IMG-07 source cap bounds the fabrication raster, and with the SRS 16 MP cap the measured 25 Mpx desktop budget had no effect. The desktop source cap (`SBSchema.limits("desktop").maxSourcePx`) is raised to **25,000,000 px**, defined as the desktop `fabPxBudget` (`docs/perf/large-image.json` `decision.desktop.fabPxBudget`; the test `IMG-07/PO-LASER-4 desktop source cap equals the measured desktop fabPxBudget` keeps them in step). The desktop byte cap (25 MiB) and the mobile envelope (10 MiB / 8 MP) are unchanged. Intake still rejects over-limit sources before decode with `SOURCE_TOO_MANY_PIXELS` and the explicit downsample offer (no silent reduction). A 25 MP RGBA decode is estimated at ≈ 167 MiB (S4's 16 MP figure, 107 MiB, scaled), inside 512 MiB. **Documented deviation from SRS IMG-07** (16 MP) until the SRS is revised (plan Appendix D.6 item 4).
- **Rationale:** the S1 with the feeder cuts pieces far larger than the 300 mm the long-side caps were sized for; a 470 mm-high piece at 1536 px is about 0.31 mm/px, too coarse for 1.5 mm features to round well and close to the 0.5 mm/px sampling limit. A physical pitch keeps detail constant in millimetres; the pixel budget keeps the working set and time bounded per device, and reporting the cap keeps NFR-04 honest. Sizing by height matches how the feeder constrains the piece (processing height 470 mm, length up to 3000 mm).
- **Resolves S2 F3** (D1): no corner rounded at the shipped 417 µm/px with the 50 µm tolerance. Resolved by finer resolution, not tolerance: the 0.1 mm/px target is where S2 measured 62–99 % of corners rounded across the variants (0 % at 417 µm/px). For the shipped connected-mode rule (whole-loop fallback) the D1 table gives 14.4 % on real images to 80.2 % on random input at 100 µm/px; that remaining gap is the R2 granularity question (deferred option (c)), not F3. The tolerance stays 0.05 mm; bonded mode stays unsmoothed.
- **SRS deviations to carry into the next SRS revision (not blocking):** LYR-06 "1536 … up to 4096" wording; MAT-03 3 mm starting value; laser-detail targets next to NFR-03; IMG-07's desktop source limit raised from 16 MP to 25 MP (item 14); the §12.3 mobile vertex cap kept, so mobile is limited to simpler art (item 13).
- **New diagnostic codes:** `FAB_PITCH_CAPPED` (info), `FEATURE_MARGINAL` (warning), `MACHINE_THICKNESS` (blocking), `BUSY_SIMPLIFIED` (info, G2.7b); `PAGE_OVERFLOW` and `FAB_EXCEEDS_SOURCE` are reused with the payloads above.

Laser-detail performance targets (PO-LASER-9). Measured columns filled by G2.2b on 2026-10-08 (shortened run, item 12; Linux i7-11800H, Node 26, background load ≈ 3–4; `docs/perf/large-image.json`, `docs/perf/LARGE_IMAGE.md`); G4.4 re-measures on the reference machines. All targets gate on **bonded** mode (item 11); connected-mode p95 is reported next to each row as KI-CONN-PERF.

| Workload | Pixels | Budget source | Final + validation p95 target | Measured p95 (bonded, gated) | Measured connected p95 (reported) | Measured working set | Working set limit |
|---|---|---|---|---|---|---|---|
| SRS desktop reference (§12.3) | 1536 × 1536, 8 layers | SRS | 10 s (NFR-03, unchanged) | **2.73 s** (`srs-desktop`, 5 + 30) | 16.5 s | 107.5 MiB | 512 MiB |
| SRS mobile reference (§12.3) | 768 × 768, 6 layers | SRS | 8 s (unchanged) | 1.26 s desktop (× k 4 = 5.0 s); device: G4.4 | 6.7 s desktop | 38.2 MiB | 192 MiB |
| Laser-detail desktop | ≤ `fabPxBudget` = **25 Mpx** (5774 × 4330) | G2.2b | **10 s** (not relaxed: 16 Mpx 7.20 s) | **9.75 s** (`r25`, 1 + 5) | 47.3 s | 404.4 MiB | 512 MiB |
| Laser-detail 470 mm page | 3525 × 4700 (16.6 Mpx, 0.1 mm/px, uncapped at 25 Mpx) | G2.2b | 10 s | **6.81 s** (`laser470`, 1 + 5) | 36.6 s | 269.2 MiB | 512 MiB |
| Laser-detail mobile | ≤ `fabPxBudget` = **1 Mpx** (1155 × 866); fabrication **enabled** (not draft-only) | G2.2b | **8 s** (desktop p95 × k, k = 4 provisional) | **7.28 s** scaled (`r1` 1.82 s × 4, 5 + 30); device: G4.4 | 11.5 s desktop (× 4 = 45.9 s) | 62.6 MiB | 192 MiB |
| Busy art (reported, not gated) | 4–16 Mpx, 2k–8k parts/layer | G2.2b | bounded by the G2.7b complexity caps, not the pixel budget | 35.4 s (4 Mpx) – 163.2 s (16 Mpx) | 98.4 – 462.3 s | 204.9 – 706.2 MiB | per device |
| Busy art at the desktop caps (G2.7b) | 25 Mpx, ≤ 258 parts/layer, ≤ 356,000 vertices | G2.7b (`caps`) | 10 s | **9.64 s** (`c208`, 258 parts; 1 + 5, bonded only, estimate included) | not run | live 429.0 MiB (G2.2b method 577.9 MiB) | 512 MiB |
| Busy art over the caps (G2.7b) | `b4` / `b9` (1,991 / 4,603 parts/layer) | G2.7b | fail explicitly, no geometry | `COMPLEXITY_LIMIT` in 113 / 321 ms; with `simplify: "busy"` 3.70 / 8.08 s | not run | 73 / 168 MiB; simplified 140 / 262 MiB | per device |
| Connected mode (KI-CONN-PERF) | SRS desktop reference and the budget rows | G2.2b (reported) | not gating; resolved in G4 (G4.1 pool, smoothing) | — | 16.5 s (SRS), 47.3 s (`r25`), 11.5 s (`r1`) | — | — |

Support stage (G2.7, 2026-10-08): the rows above were timed with the pre-G2.7 support pass (one layer-level intersection per pair, `classifyContact` then `survivesInset` per piece). `test/bench.js large` now times `SBSupport.validate` (bonded-relief, 1.5 / 2.0 mm, upward differences reused) in that slot; its p95 on the dense geom page is **1.32 s** (B3b, under the 3 s B3 budget; `docs/perf/SUPPORT.md`). The large rows were **not** re-run in G2.7 (the long large-image benchmark was out of scope for this task; only `large --quick` was run as a smoke check). Their support p95 is recorded with the G2.7b runs: **87–107 ms** on realistic `r25`, and 0.4–0.95 s on busy art at 176–340 parts/layer (`docs/perf/LARGE_IMAGE.md` "G2.7b"). With the complexity gate, `r25` measures 7.61 s bonded (estimate 256 ms).
