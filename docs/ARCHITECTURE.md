# Stacked Relief — Architecture Contract

This document is the binding architecture contract for the Stacked Relief work
(`docs/SRS_Stacked_Relief.md`). It is copied from `docs/plans/opaque-layers-dev-plan.md`
(§3, §4, Global Constraints and the determinism rules) and records the spike decisions
D1–D4 as they land. When this file and the plan disagree, update both in the same commit.

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
- Smoothing tolerance is **0.05 mm**. SVG round trip within **0.005 mm** with the same topology. Plywood preset: bonded, white-high, 8 sheets, gap 0, **6.35 mm**, min feature **3 mm**, min part **25 mm²**, uncalibrated.
- Limits:
  - image input: desktop **25 MiB / 16 MP**, mobile **10 MiB / 8 MP**;
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
            cleanup: { minFeatureMM, speckMM2, holeMM2, cornerStyle: "sharp"|"smooth", toleranceMM: 0.05 },
            bridge: { bridgeMM, cullBelowMM2, maxBridgeMM, cullEnabled },    // cullEnabled used in bonded only
            registration: { enabled: false, diaMM: 3, edgeClearanceMM: 1, layers: "all" | number[] },
            guides: { mode: "none"|"inset-outline"|"interior-mark", concealInsetMM: 0.5,
                      markFootprintMM: 0.2, allowanceMM: 0.5, labelHeightMM: 3 },
            repairs: [] /* Repair, see below */ },
  material: { name, thicknessMM: 6.35, thicknessState: "nominal"|"measured", calibrated: false,
            minFeatureMM: 3, minPartMM2: 25, kerfMode: "external",
            calibration: null /* | {date, machine, material, kerfMM, minFeatureOkMM, scoreOk, notes} user-recorded */ },
  appearance: { mode: "uniform"|"palette", color: "#C8A26B", palette: "dusk" },  // never in geometryKey
  view: { explodeMM: 0 },                                                          // never in geometryKey
  geometry: { widthMM, heightMM, lockAspect: true, draftPx: 720, fabPx: 1536,
              resample: { height: "nearest", tonal: "area" },
              bedMM: null /* | {w, h} */ },
  acks: [] /* {key, revision} */, extras: {}
}

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
               rasterW, rasterH, sxUm, syUm, mmPerPxMax, resample: "none"|"nearest"|"area", grid: "1um" }
Snapshot = { revision, engineVersion, geometryHash, quality: "draft"|"fabrication", layers, diagnostics,
             cleanupReport: [{layer, addedMM2, removedMM2, holesFilled, partsRemoved, bridges?: PolygonWithHoles[]}],
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

`geometryHash = hashJSON({ key: geometryKey(p), engine: engine.version, quality, raster: [rasterW, rasterH], layers: layerHashes, guides: guideHash })`. `engine.version` enters only here, so an app-only release does not invalidate saved hashes.

**Winding convention** (documented once in `js/geom.js`):
- In Y-down coordinates the outer ring has **positive** shoelace area and holes have **negative** area. `SBTrace.trace` emits the opposite, so `fromPixelLoops` reverses its rings.
- Each ring starts at its lexicographically smallest `(x, y)` vertex.
- Collinear vertices are removed.
- Booleans use the **NonZero** fill rule on normalized input. `fromPixelLoops` output (outer positive, holes negative) is NonZero-safe.
- Rings that touch at a single vertex (pixel saddles) are **split into separate simple rings** during normalization (D3), so `validate()` never reports `GEO_SELF_INTERSECT` for ordinary checkerboard art.

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
| `js/docs.js` | SBDocs | new | G3.5 |
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

---

## Decisions

Each decision is recorded here by the spike that owns it, with its measurement table.
Product-owner direction accepted on 2026-10-07 (plan Appendix B) is noted; the final
decision text is filled in when the spike lands.

### D1 — Smoothing rule

- Owner: spike S2 (recorded in G1.2 checks).
- Accepted direction (Appendix B.2): containment-aware per-loop fallback Chaikin → RDP → raw; clip-to-lower only as a reviewed repair.
- Decision: _pending S2._

### D2 — Geometry backend

- Owner: spike S1.
- Accepted direction (Appendix B.1): Clipper2 JS port (UMD/IIFE or wrapped); fallback in-house exact orthogonal booleans with square-join offsets.
- Decision: _pending S1._

### D3 — Finite-width contact and saddle splitting

- Owner: spikes S1 and S5; GEO-02 thresholds used by G2.7.
- Accepted direction (Appendix B.3): support overlap that does not survive a 0.5 µm inward offset blocks export; one that does not survive `minFeatureMM/2` warns. Vertex-touching rings (pixel saddles) are split into simple rings during normalization.
- Decision: _pending S1/S5._

### D4 — Hash scope

- Owner: spike S6 (`SBGeom.canonicalBytes`).
- Decision: _pending S6._
