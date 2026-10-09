# Stacked Relief v1.0 (Opaque / Bonded Layers): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to work through this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the SRS v1.0 "opaque layer" scope in the ShadowBox-Stacked fork. That scope covers:
- bonded, zero-gap plywood relief with supported loose parts;
- raw height-map interpretation;
- canonical material polygons;
- final support validation;
- an opaque proof and stack section;
- assembly guides;
- versioned, reproducible projects and packages.

Existing tonal/connected-sheet behaviour must keep working. Every intentional change to it is listed in the CHANGELOG (DEP-04).

**Architecture:** One pure, DOM-free engine (`SBEngine.generate`) turns a request into a frozen `Snapshot` of `MaterialLayer[]` on an integer micrometre grid. The engine chain covers everything §11.1 lists: interpretation, construction, bounded smoothing, frame and holes, validation, part IDs and guides. Everything else is a thin consumer: the preview, the SVG/ZIP exporters, the manifest, the worker and the tests. No consumer ever re-derives retained material (SRS §11.1).

Interpretation, construction and appearance are independent schema fields:
- Tonal and height interpretation both produce a single `added` field, which feeds one cumulative-mask builder.
- Construction is a strategy (connected / bonded).
- Validation always runs on the final polygons.

**Tech Stack:**
- Plain ES2020 classic-script IIFE modules, each attaching one `SB*` global. Modules look up other `SB*` globals **at call time**, never at load time.
- No npm. A single geometry dependency is vendored and pinned under `js/vendor/`. It must be a UMD/IIFE build, or be wrapped by an in-repo shim.
- Built-in `DecompressionStream` handles inflate.
- Hashing has two paths:
  - `SBHash.sha256` is pure-JS and synchronous, with hard-coded constants. It is used for small canonical payloads.
  - `SBHash.digest` is async and backed by `crypto.subtle`. It is used for source bytes, samples and package files.
- Tests use the existing `node test/run_tests.js` `vm` harness on Node ≥ 18 (verified on v26.7.0). An in-repo browser harness (`test/browser.html`) is driven by headless Chrome, with no npm (G4.8).
- `node build.js` produces the single-file `dist/` bundle.

**Spec:** `docs/SRS_Stacked_Relief.md` (v1.0, 677 lines). This plan argues from it, so read both. SRS line numbers are cited as `SRS:L###`.

**Revision:** rev 2 (2026-10-07). It applies the coverage, code-accuracy and execution reviews. Rejected or modified critiques are listed in Appendix A, "Review notes".

**Amendment (2026-10-07, laser target):** product-owner requirements for the xTool S1 with conveyor feeder (40 W diode, 1/4" basswood or poplar plywood) are in **Appendix D** and decision **D6** (`docs/ARCHITECTURE.md`). They add a machine profile, size-by-height, a physical fabrication pitch with a per-device pixel budget, and 6 mm ply feature defaults, and they fix the G2 execution order (Appendix D.4). Requirements the SRS does not state carry `PO-LASER-n` IDs.

**Amendment (2026-10-08, G2.2b result):** the large-image benchmark finished as a **shortened run** (product-owner decision; G2.2b "Method"), set the pixel budgets to **desktop 25 Mpx, mobile 1 Mpx** (bonded mode), and showed that busy-art cost follows part count, not pixels. The complexity caps and busy-art simplification therefore move from G4.3 into G2 as the new task **G2.7b**, right after G2.7 (Appendix D.4, D.9).

**Repo state (verified 2026-10-07):**
- `/run/media/geekuser/Storage/WebstormProjects/ShadowBox-Stacked` holds one commit, `f0552c7 Init commit`.
- `origin` is `jerwaynejones/shadowbox-studio` (the fork already exists); `upstream` is `strondcode/shadowbox-studio`.
- `docs/SRS_Stacked_Relief.md` is untracked.
- The baseline is v1.1.0 (`js/app.js:23`, `sw.js:19`). `node test/run_tests.js` reports 29 passing checks.

---

## 0. Summary

### What "opaque layers" means

The SRS has no per-layer opacity toggle. SRS:L46 forbids a single "opaque" switch that bundles interpretation, construction and material together. So the "opaque layer features" are the whole v1.0 bonded-relief scope.

The current preview is **not** an authoritative opaque proof:
- `maskToCanvas` writes alpha 255 or 0 (`preview.js:78`);
- but `draw()` scales with `imageSmoothingEnabled = true` (`preview.js:131`), adds per-layer shadows (`:127-130`) and offsets layers for parallax.

The result on screen is anti-aliased and misaligned. G2.12 adds a proof mode that turns all three off explicitly.

This plan delivers the scope gate by gate, in the order SRS §13.1 requires:

| Gate | What it delivers |
|---|---|
| G0 | Baseline report, characterization and persisted goldens |
| G1 | Canonical geometry |
| G2 | Bonded engine plus the opaque review UI |
| G3 | Assembly and reproducibility |
| G4 | Hardening |
| G5 | Fabrication release |

### Approach

- **Backbone: the risk-first draft.** Known unknowns get time-boxed spikes that end in executable `check()`s. Each current defect is pinned by a `KNOWN-DEFECT` check. The commit that fixes the defect retargets that check to the **new** function and inverts it. Fixes that upstream could also take are tagged **[UP]**, and each ships as its own minimal patch against `f0552c7` (see open question 15).
- **Grafted from the architecture draft:**
  - the canonical data model and module map;
  - the proven `tonal band → added` mapping, which is bit-identical to `R.sheetMasks` (verified while writing this plan);
  - a synchronous SHA-256 (verified against NIST vectors);
  - the legacy-settings adapter table;
  - the backward-compatibility matrix;
  - the engine extraction seam.
- **Grafted from the MVP draft:**
  - an early **experimental bonded release checkpoint** at the end of the G2 core (v2.0.0-alpha.2);
  - disabling controls that do not apply, with a stated reason;
  - a pure file-plan function;
  - a seeded property test;
  - the open questions about fork, upstream and default preset.

### Plan depth

This is a master plan.
- **G0, the spikes, G1 and G2** are written step by step, with code wherever a contract is defined.
- **G3, G4 and G5** are written as fully specified tasks: files, interfaces, named checks and exit criteria. Each is expanded into its own step-level plan when G2 exits, because the chosen geometry backend (spike S1) changes their code.

### Scoring of the three drafts

Each criterion is scored 1–5.

| Draft | SRS coverage | Accuracy vs code | Sequencing / incremental shipping | Testability | Risk handling | Total | Role in synthesis |
|---|---|---|---|---|---|---|---|
| **Risk-first** | 5: full traceability, including NFR, DEP and §9 | 5: corrected the mapper's wrong line numbers | 3: nine spikes before G1; the first user-visible bonded output comes late | 5: TDD everywhere, KNOWN-DEFECT inversion, seeded property test | 5: ranked register with kill/fallback per unknown | **23** | **Backbone** |
| Architecture-first | 5: full data model plus §9.1–9.5 | 4: a few off-by-one refs | 4: follows the gates; legacy shim allows small PRs | 5: every module is Node-tested; four-list consistency test | 3: enabling `constrainToLower` cleanup by default conflicts with §4.6 | 21 | Data model, module map, adapters |
| MVP-first | 3: defers GEO-01/03/04/09; auto-clip contradicts §4.6 | 3: cites lines that do not exist | 5: a demoable bonded slice in 3–4 days | 4 | 3: raster support → polygon rework is double work | 18 | Early release checkpoint, UI-disable pattern, file plan |

### Corrections and code facts (verified against the repo)

- **`js/morph.js` (145 lines):** `M.erode` :59, `M.open` :66, `M.close` :69, `M.components` :77, `M.removeSpecks` :113, `M.fillHoles` :131.
- **`js/trace.js` (188 lines):**
  - `T.trace` :32, `T.simplify` :117, `T.chaikin` :170.
  - `T.trace` returns outer rings with **negative** shoelace area in Y-down (measured: square −9; donut outer −49, hole +25). The canonical convention (§3) is the opposite, so `SBGeom.fromPixelLoops` reverses traced rings.
- **`js/preview.js` (158 lines):** `P.create` :22, `setSheets` :58, `maskToCanvas` :69 (alpha write :78), `draw` :102 (shadows :127-130, smoothing :131).
- **`js/raster.js`:** `R.luminance` :24, `R.kuwahara` :42, `R.thresholds` :100 (flat guard `lo + nBands` :116), `R.bands` :128, `R.sheetMasks` :150.
- **`js/svgout.js`:**
  - `S.sheetSVG` :34. The always-cut rectangle is at :43. Fixed registration-hole corners are at :54-61.
  - The score `<text>` push is at :65-68 (:64 is `if (p.label)`).
  - The cut group at :76 has no `id`. `xmlns="http://www.w3.org/2000/svg"` appears at :74 and :100.
  - `S.proofSVG` :86 has no margin offset. `pathD` :108 emits `M 10 10 L 10 30 …`, with a space after the command letter.
- **`js/islands.js`:** `I.resolve` :49; load-time `const` lookup of another global at :33. **`js/zip.js`:** `Z.build` :54.
- **`js/app.js`:**
  - `runPipeline` :70 resizes on a canvas, using `k = procRes / max(iw, ih)`, `w = max(32, round(iw*k))` and a smoothed `drawImage` (:75-83). It **upscales** small sources.
  - `pxPerMM = w / state.widthMM` :95 is the x scale only. The per-sheet loop is :106-136, with `SBIslands.resolve` at :115 and per-layer `simplify`/`chaikin` at :122-124.
  - `sheetColors` :168, `renderSheetGrid` :186, `renderPaletteChips` :226, `buildAssemblyMD` :311.
  - Kerf text :339-340; spacer text :349-351.
  - `settingsJSON` :364-374 exports `projectName, sourceName, procRes, smoothRadius, smoothPasses, nSheets, thresholdMode, darkFront, palette, widthMM, marginMM, minFeatureMM, bridgeMM, cullBelowMM2, maxBridgeMM, holes, holeDiaMM, cornerStyle, detailEps`.
  - `exportBundle` :376, `buildAndDeliver` :399 (ZIP name `_shadowbox.zip` :425), `deliverFile` :449.
  - `bindRange` / `bindSelect` / `bindCheck` :492 / :503 / :513, with bindings through about :640 (`btn-export` :638).
  - `loadFile` :519, `downscaleIfHuge` :556-566 (cap 2000), `switchTab` :573, `init` :581.
  - The palette handler is the appearance-only path, calling `renderAll()` (:614).
  - **Auto-demo at init: `$("btn-demo").click()` :652-653** (conflicts with PRJ-01).
  - `registerServiceWorker` :664. `requestPersistentStorage` :679 is **already called** in `init` (:656).
- **`index.html`:** `#in-res` range `min=360 max=1280` :62; `#in-sheets` range `min=3 max=8` :71-72; script tags :145-153.
- **`sw.js`:** `VERSION` :19, `SHELL` :24-43. The install handler calls `skipWaiting()` (:46-48) and activate calls `clients.claim()` (:66). Cache-first means stale code in development.
- **`build.js:37`:** the script-inlining regex `/<script src="js\/([\w.]+)"><\/script>/g` does **not** match `/` or `-`, so `js/vendor/*.js` would stay external. `build.js:22-28` strips the PWA plumbing from `dist/`.
- **`test/run_tests.js`:** module load list :14; `check` :19; `section` :23; `art` :26; report :225-227.
- **`README.md`:** :18 says "No server"; :86 hard-codes "29 checks".
- **`docs/CHANGELOG.md`:** headings `## v1.1.0 — 2026-07-09` and `## v1.0 — 2026-07-08`; there is no `## Unreleased`.
- **Morphology preserves nesting.** The per-layer chain `open → close → removeSpecks → fillHoles` uses the same radii on every layer, and every step is increasing. So nested input masks stay nested. Measured: 0 violations over 200 seeds × featR ∈ {1, 3, 8}. The raster-level GEO-07 sources are islands bridges (`islands.resolve`) and per-layer polygon smoothing (`app.js:122-124`).

---

## 1. Requirement traceability matrix

Every opaque-layer requirement in the SRS maps to the task IDs defined in §5–§10 below. "AT" lists the SRS acceptance scenarios that verify it. Manual acceptance tests (AT-18, AT-19, AT-23, AT-25, and the visual parts of AT-11, AT-20 and AT-24) are recorded as evidence in `docs/ACCEPTANCE.md` (task G5.2). Browser-behaviour tests run in the G4.8 harness.

| Req | Summary | Tasks | AT |
|---|---|---|---|
| D-4.2 | mm, Y-down, no mirroring, two-axis scale, 0.001 mm grid, separate uncertainty reporting | S1, G1.1, G1.4, G3.9 | AT-05, AT-12 |
| D-4.3 | Nearest-layer quantization, N 1–16, midpoint goes up, no stretch, gap g; no interpolation in height mode | G2.0, G2.3, G2.10b | AT-03, AT-04 |
| D-4.4 | Tonal balanced/linear/manual, light/dark front, palette is not geometry | G2.4, G2.11c | AT-04, AT-21 |
| D-4.5 | Bonded containment and support graph to base; connected one part per layer | G2.6, G2.7 | AT-08, AT-09 |
| D-4.6 | Repairs visible and reversible; clip-to-lower only; no auto bridge or delete in bonded | S2, G1.2, G2.6, G2.9 | AT-09, AT-15 |
| D-4.7 | No dedup; trailing empties omitted with indices kept; empty-under-nonempty blocks | G2.7, G2.10b, G3.9 | AT-04, AT-08 |
| PRJ-01 | Explicit project fields; plywood preset; source required (no auto-demo) | G2.1, G2.11a, G2.11b | AT-01, AT-03 |
| PRJ-02 | Independent axes; appearance leaves geometry hash unchanged; mode change reviewed before acceptance | T0.6, G2.1, G2.11e, G2.12 | AT-01, AT-21 |
| PRJ-03 | Self-contained `.sbrproj` that reopens without re-upload | G3.8 | AT-17 |
| PRJ-04 | Monotonic revisions; ≥20 undo/redo; traceable repairs (source and resulting revisions) | G2.9, G3.6 | AT-15, AT-21 |
| PRJ-05 | Autosave and recovery; unsaved indicator; manual download | G3.11 | AT-17, AT-22 |
| PRJ-06 | Validate before replacing; explicit migration; reject newer major | G3.8 | AT-17, AT-22 |
| IMG-01 | PNG/JPEG for tonal; 8-bit gray or equal-RGB PNG for height; reject 16-bit, APNG, corrupt in **both** modes | S4, S4b, G2.14 | AT-02, AT-22 |
| IMG-02 | Raw samples with no color management; record resample policy and sample hash | S4, G2.0, G2.14 | AT-02, AT-03 |
| IMG-03 | Tonal smoothing/polarity controls; height mode has no default filter; explicit recorded height filter | G2.4, G2.5b, G2.10a | AT-02, AT-04 |
| IMG-04 | Alpha domain A (threshold 0.5) or full image; out-of-domain samples never influence thresholds/filters; base stays | G2.4, G2.5 | AT-05 |
| IMG-05 | EXIF applied exactly once; aspect locked; explicit rotate/mirror applied consistently | S4, S4b, G2.5 | AT-05, AT-12 |
| IMG-06 | Flat input: no divide-by-zero; duplicate thresholds and empty bands surfaced | G2.4 | AT-04 |
| IMG-07 | Header pre-inspection (PNG and JPEG) before decode; desktop 25 MiB / 25 MP (product-owner deviation from the SRS 16 MP, 2026-10-08; Appendix D.6 item 4), mobile 10 MiB / 8 MP; no silent downscale | S4, S4b, G2.14, G4.3 | AT-22, AT-24 |
| LYR-01 | 1–16 sheets; requested vs exported count, max elevation, base, relief | G2.10b, G2.11c | AT-03, AT-04 |
| LYR-02 | Nearest-layer rule; thresholds shown normalized and in mm | G2.3, G2.4, G2.11c | AT-03 |
| LYR-03 | Balanced, linear and manual thresholds; reject bad order; legacy tonal kept | G2.4, G2.4b | AT-04, AT-21 |
| LYR-04 | Bonded: rect base, no frame by default; frame is canonical material | G1.3 | AT-06, AT-07 |
| LYR-05 | Identical masks kept; trailing empties; empty predecessor blocks | G2.7, G2.10b | AT-04, AT-08 |
| LYR-06 | Draft vs fabrication resolution; export regenerates; diagnostics and acks never reused across quality. Fabrication resolution is a physical pitch (PO-LASER-4) instead of the SRS "1536, up to 4096" long side | G2.0, G2.1b, G2.2, G2.10b, G3.10, G4.2 | AT-10, AT-15, AT-24 |
| MAT-01 | One thickness, nominal vs measured; adhesive and finishes excluded (stated) | G2.1, G2.10b, G2.11c | AT-01, AT-03 |
| MAT-02 | 1–2000 mm per axis, 0.1–25 mm thickness; lossless units; size by height (default) or width (PO-LASER-3) | G2.1, G2.11c | AT-01, AT-12 |
| MAT-03 | Plywood profile uncalibrated; 25 mm² part, provisional; feature default **1.5 mm with a 2.0 mm advisory tier** (PO-LASER-6; SRS starting value 3 mm) | G2.1, G2.7, G2.8 | AT-10, AT-19 |
| MAT-04 | Uniform opaque color and palette proofs; disclaimer; no geometry effect | G2.11c, G2.12, G3.5 | AT-01, AT-11 |
| MAT-05 | `kerfMode=external` stated in manifest and guide; the machine kerf (0.15 mm) is recorded, never applied (PO-LASER-7) | G2.1, G3.5, G3.9 | AT-12, AT-19 |
| MAT-06 | Optional calibration coupon (holes, narrow webs, score marks) with no laser settings; calibration record | G2.1, G5.1 | AT-19, AT-25 |
| GEO-01 | Polygons with holes are the single source for every consumer; carrier boundaries representable | S1, G1.1, G1.6, G2.12 | AT-06, AT-07, AT-11 |
| GEO-02 | Bounded smoothing, then frame union, then hole subtraction, before checks; finite-width attachment | S5, G1.3, G2.7, G2.10a | AT-06, AT-09 |
| GEO-03 | Closed, simple, hierarchical rings; saddles split; degenerate loops block export | S1, G1.1 | AT-07, AT-09, AT-13 |
| GEO-04 | 0.05 mm measured (densified Hausdorff) smoothing tolerance; topology fallback; bonded unsmoothed (D1) | S2, G1.2 | AT-09, AT-10 |
| GEO-05 | Small-part and narrow-neck warnings via erosion by half the width (disappear or split) | G2.8 | AT-10 |
| GEO-06 | ≥3 samples across the minimum feature, from real (not upsampled) samples; show mm/px; refuse export; source shortfall reported in px (PO-LASER-5) | G1.1, G2.0, G2.1b, G2.8, G2.14 | AT-10, AT-24 |
| GEO-07 | Final-polygon validation (support, holes, guides) after every change | G2.7, G2.9, G3.1 | AT-08, AT-09, AT-14 |
| GEO-08 | Cleanup report (mm²) with overlays, kept in `validation.json` | G1.2, G2.6, G2.13b, G3.9 | AT-10, AT-15 |
| GEO-09 | 0.001 mm grid, documented winding, round trip ≤ 0.005 mm | T0.6, S1, S6, G1.4, G1.5 | AT-11, AT-12, AT-13 |
| GEO-10 | Footprint inside page; bed check (w × h) against the machine profile, on by default (PO-LASER-2); never rescale | G2.1, G2.10a, G3.10 | AT-12, AT-22 |
| SUP-01 | Bonded keeps disconnected parts; no bridge resolver | G2.6 | AT-08, AT-21 |
| SUP-02 | Exact containment; unsupported area reported; blocking with no bypass | G2.7 | AT-08, AT-09 |
| SUP-03 | Support graph to base; lower holes absent; in the manifest | G2.7, G3.9 | AT-08, AT-14 |
| SUP-04 | Reviewed clip repair; prior revision kept; stale repairs never replayed silently; checks rerun incl. guides | G2.9, G3.1, G3.6 | AT-09, AT-15 |
| SUP-05 | Deterministic layer and part IDs; stale guides invalidated | G1.1, G3.3 | AT-14, AT-16, AT-17 |
| SUP-06 | Connected keeps bridge/cull and verifies one part per layer | G2.6 | AT-06, AT-21 |
| ASM-01 | Guide modes none / inset / interior mark; printable map always | G3.3, G3.5 | AT-14 |
| ASM-02 | Marks inside upper ∩ lower with concealment inset 0.5 mm plus calibrated footprint and allowance; else omit and explain | G3.3 | AT-14 |
| ASM-03 | Valid interior point (not centroid); vector-stroke text | G3.2 | AT-13, AT-14 |
| ASM-04 | Registration holes off in bonded; hole plus edge clearance must fit every selected layer | G1.3, G3.4 | AT-06, AT-14 |
| ASM-05 | Instructions: face, order, IDs, support, keep/discard, omitted, guides per layer, zero gap, nominal/measured | G3.5 | AT-14, AT-16, AT-25 |
| UI-01 | Source → Interpretation → Construction → Review → Export; disabled options explained | G2.11b, G2.11d | AT-01, AT-22 |
| UI-02 | Opaque proof, retained/waste view, dimensioned section; tilt marked illustrative | G1.6, G2.12, G2.13a | AT-11, AT-20 |
| UI-03 | Section uses real t and g; explode is display-only | G2.10b, G2.12 | AT-03, AT-11 |
| UI-04 | Diagnostics navigate, highlight, explain and fix; not color-only | G1.0, G2.13c, G4.5 | AT-08, AT-20 |
| UI-05 | Before/after overlays; draft / stale / processing / validated states | G2.13b, G4.1 | AT-10, AT-15 |
| UI-06 | Cancel; drop obsolete results; export disabled while stale | G4.1 | AT-15, AT-24 |
| EXP-01 | One SVG per non-empty layer; mm units; shared viewBox; no page rect on bonded uppers | G1.3, G1.4, G3.9 | AT-07, AT-12, AT-16 |
| EXP-02 | `CUT` / `SCORE` groups; no fills on cuts | G1.4 | AT-13, AT-18 |
| EXP-03 | Pure vector; no raster, filters, clip paths, CSS or text | G1.4, G3.2 | AT-13, AT-18 |
| EXP-04 | §9.4 package inventory and ZIP name; sanitized names | G3.9 | AT-16, AT-22 |
| EXP-05 | Immutable revision snapshot plus geometry hash | G3.6, G3.9 | AT-15, AT-16 |
| EXP-06 | Manifest provenance (every SRS:L330 field) | G3.9 | AT-16, AT-17 |
| EXP-07 | Blocking disables export; warnings acked on the fab snapshot; diagnostic-only package has no cut files | G2.2, G3.10 | AT-08, AT-10, AT-15 |
| EXP-08 | Truthful delivery states | G3.10 | AT-16, AT-22 |
| EXP-09 | Machine checklist; downstream-edit warning | G3.5 | AT-18, AT-19, AT-25 |
| §9.1 | Entity schema incl. Diagnostic/Part/Geometry/Material fields; strict geometry keys | G2.1 | AT-17, AT-22 |
| §9.2 | `MaterialLayer` contract; deterministic part order | G1.1, G2.10b | AT-14, AT-16 |
| §9.3 | Worker request/response (`engineVersion`, `sourceHash`, `status`, `progress`); cancel | G2.10a, G4.1 | AT-15, AT-24 |
| §9.4 | Package layout; safe import limits | G3.7, G3.8, G3.9 | AT-16, AT-22 |
| §9.5 | Severity policy; acks invalidated; no downgrade; full code list | G1.0, G2.2 | AT-08, AT-15 |
| §12.3 | Complexity caps fail explicitly; per-device part/vertex caps and explicit busy-art simplification (G2.7b, moved from G4.3) | G2.7, G2.7b, G2.10a | AT-24 |
| NFR-01 | Fully local; no remote URLs (XML namespaces allow-listed) | G4.7 | AT-23 |
| NFR-02 | Off the main thread; 100 ms acknowledgement; 500 ms cancel | G4.1 | AT-24 |
| NFR-03 | Desktop p95: 1.5 s draft, 10 s final, 5 s package on the SRS §12.3 workload (1536², 8 layers); mobile 768² × 6 final ≤ 8 s. Laser-detail workloads at the pixel budget have their own recorded targets (PO-LASER-9) | G2.2b, G2.7, G4.4 | AT-24 |
| NFR-04 | Memory budget; estimate first; never silently lower resolution; per-device pixel budget, cap reported (PO-LASER-4) | G2.1b, G2.2b, G2.7b, G2.14, G4.3 | AT-22, AT-24 |
| NFR-05 | Deterministic across engines; no unseeded randomness; no transcendental math in hashed paths | T0.6, S1, S4, S6, G2.10b, G4.8 | AT-16, AT-17, AT-23 |
| NFR-06 | Escape user strings; safe imports | G3.7, G3.8, G3.9 | AT-22 |
| NFR-07 | WCAG 2.2 AA target; keyboard; 200% zoom; documented audit | G2.13c, G4.5 | AT-20 |
| NFR-08 | Browser matrix | G4.5, G4.8, G5.2 | AT-18, AT-20, AT-23 |
| NFR-09 | Failures keep the last revision; no partial "complete" bundle | G3.10, G4.1 | AT-15, AT-22 |
| NFR-10 | Core runs without the DOM; unit, property, fixture, serialization, migration **and browser integration** tests | T0.2, T0.5, G2.10a, G4.8 | AT-26 |
| NFR-11 | Pinned, licensed dependencies with inventory | T0.1, T0.7, S1, G4.7 | AT-26 |
| NFR-12 | Honest guidance; no universal laser settings | G3.5 | AT-19, AT-25 |
| DEP-01 | Static HTTPS plus a documented local server path | G4.6, G5.2 | AT-23 |
| DEP-02 | Offline install; visible update status; no mid-edit update | G4.0 | AT-23 |
| DEP-03 | Reproducible build | G4.7 | AT-26 |
| DEP-04 | Legacy adapter keeps tonal/connected semantics; fixes documented | T0.4, G2.4, G2.4b, G3.8, G5.3 | AT-21, AT-26 |
| DEP-05 | Rollback without silent schema downgrade | G3.8, G5.3 | AT-17, AT-23 |
| PO-LASER-1 | Machine profile persisted in the project, editable; default "xTool S1 + feeder" (470 / 3000 / 545 / 14 mm, kerf 0.15 mm) | G2.1, G2.11c, G3.5, G3.9 | Appendix D |
| PO-LASER-2 | Every layer sheet incl. frame fits the machine processing area; stock within max thickness; blocking otherwise (extends GEO-10) | G2.10a, G3.10 | AT-12, AT-22 |
| PO-LASER-3 | Size by height (art + frame to a target height) is the default; width mode stays available (extends MAT-02) | G2.1, G2.11c | AT-01 |
| PO-LASER-4 | Fabrication pitch from physical size, target 0.1 mm/px, capped by a per-device pixel budget; cap reported as info with actual mm/px; draft 720 px (amends LYR-06) | G2.0, G2.1, G2.1b, G2.2b, G2.11b, G2.11c, G2.14, G4.3 | AT-24 |
| PO-LASER-5 | Never upsample; warn with the pixel shortfall when source pixels < target fabrication pixels (extends GEO-06) | G2.0, G2.1b, G2.14 | AT-10, AT-24 |
| PO-LASER-6 | 6 mm ply defaults: min feature 1.5 mm (D3 rules), advisory warning below 2.0 mm (amends MAT-03 starting value) | G2.1, G2.7, G2.8, G5.1 | AT-10 |
| PO-LASER-7 | Kerf 0.15 mm recorded in the profile and package; export stays nominal, `kerfMode=external` (MAT-05) | G2.1, G3.5, G3.9, G5.1 | AT-19 |
| PO-LASER-8 | Layer thickness 6.35 mm nominal, editable; UI hints that 1/4" ply is often 5.5–6 mm actual (with PRJ-01, MAT-02) | G2.1, G2.11c | AT-03 |
| PO-LASER-9 | Large-image benchmark sets the pixel budgets and the recorded laser-detail performance targets (with NFR-03/04) | G2.2b, G2.7, G2.7b, G4.4 | AT-24 |
| PO-LASER-10 | G2 execution order: G2.0 → G2.1 → G2.1b → G2.2b → rest of G2 in plan order, with G2.7b right after G2.7 | Appendix D.4 | — |

---

## 2. Open questions for the user

Questions marked ● block the task named in brackets. Each has a proposed default, which the plan assumes unless you say otherwise.

1. ● **Geometry backend [S1 → G1].** The SRS (§2.3) prefers a small bundled library but names none. Candidates:
   - (a) a Clipper2 JavaScript port (BSL-1.0, integer coordinates, has offsetting). It must be available as UMD/IIFE or wrapped in an in-repo shim.
   - (b) `polygon-clipping` (MIT, float coordinates). It is eligible **only** together with an in-repo integer offset routine, because the plan needs `offset` for D3, GEO-05 and guides.
   - (c) in-house exact orthogonal booleans on the shared pixel lattice, with offset as exact lattice Minkowski erosion/dilation (square join).

   *Default:* (a) if it passes the S1 battery and the load checks; otherwise (c). Option (c) costs smooth corners in bonded mode.
2. ● **Smoothing vs exact containment [S2 → G1.2].** *Default (changed in rev 2):* **no automatic conformance.** Bounded smoothing is containment-aware: for each loop it falls back Chaikin → RDP → raw until the layer is contained in the smoothed layer below. Raw nested masks are always contained, so this fixpoint terminates (see G1.2). Clip-to-lower is offered **only** as a reviewed repair (SRS:L180, SUP-04).

   *Question:* is that acceptable, or do you prefer bonded mode to be unsmoothed only?

   **Decided 2026-10-07 (D1, Appendix B.2):** bonded mode is **unsmoothed** (raw lattice contours, S2 option (b)); connected mode keeps the bounded smoothing of G1.2. Per-vertex lazy pinning (S2 option (c)) is a deferred, performance-gated enhancement, not in G1 scope.
3. ● **"Finite-width connection" (GEO-02) [G2.7].** The SRS gives no number. *Decided 2026-10-07 (D3, Appendix B.3; spike S5):* the contact **width** is w = 2·r\*, r\* the radius of the largest disk inside the support intersection. Blocking if **w < 0.5 µm**, i.e. the intersection does not survive an inward offset of **0.25 µm** (line and point contact have an empty intersection and are covered). A warning (`SUPPORT_NARROW`) if **w < `minFeatureUm`**, i.e. it does not survive an inward offset of `minFeatureUm/2`, with `minFeatureUm` rounded to an integer µm before halving. "Survives" is certified by an exact witness (`SBGeom.survivesInset`); an undecided result counts as not surviving; never computed with `SBGeom.offset`.
4. **Tonal + bonded mapping.** *Default:* `added = N-1-b'`, where `b'` is the darkness-oriented band. This reproduces today's `R.sheetMasks` exactly (verified), and light-front/dark-front replaces the `darkFront` checkbox wording.
5. **Bonded frame when enabled.** *Default:* frame material on **every** layer (a solid border stack), so containment holds trivially.
6. **Base cut outline.** *Default:* the base is always B (the full rectangle) even when the alpha domain A is smaller. A affects only layers ≥ 1.
7. **Guide defaults (ASM-02).** *Default:*
   - concealment inset 0.5 mm (SRS);
   - mark footprint = score-line burn width, 0.2 mm, calibratable;
   - placement allowance 0.5 mm;
   - ID label height 3 mm (ID labels use their own region test).

   All of these are stored in `construction.guides`.
8. **Stroke font (ASM-03).** *Default:* an in-repo hand-authored single-stroke font for `0-9 A-Z - . /`, which avoids any licence question. Alternative: a public-domain Hershey simplex subset.
9. **Undo history persistence (PRJ-04).** *Default:* the repair log and current revision persist in `.sbrproj`; the undo stack is session-only.
10. **`file://` support.** *Default:* keep a chunked main-thread fallback with a visible "reduced responsiveness" notice. SRS §3.4 no longer guarantees `file://`.
11. **Mobile envelope detection (IMG-07, NFR-04, §9.4).** *Default:* `navigator.deviceMemory` plus a `(pointer: coarse)` media query, which the user can override.
12. **Draft and fabrication resolution [G2.0].** *Defaults:*
    - draft long side 720 px; fabrication 1536 px, up to 4096.
    - Fabrication never exceeds the source resolution, so the engine never upsamples. A request above it is capped and shown as a warning.
    - Height mode samples nearest-neighbour, which picks existing values only. An area-average downsample is an explicit, history-recorded filter.
    - Tonal mode uses a pure integer area-average.
    - The `#in-res` slider (`index.html:62`, max 1280) becomes the fabrication setting (`min=360 max=4096`).

    **Superseded 2026-10-07 (Appendix D, PO-LASER-4):** fabrication resolution is a physical pitch (target 0.1 mm/px) capped by a per-device pixel budget; the 1536/4096 long-side caps are dropped and `#in-res` becomes a pitch control (G2.11b). The draft long side (720 px), the never-upsample rule and the resampling methods are unchanged.
13. **Default preset for new projects.** *Default:* a preset picker with **Plywood relief (bonded)** preselected, as PRJ-01 suggests, and Acrylic shadowbox (connected, today's defaults) one click away. The app opens with no source; Demo is an explicit source choice. Alternative: keep connected as the default until v2.0.0 final.
14. **JPEG in tonal mode.** *Default:*
    - `SBJpeg.inspect` reads the header first: SOF dimensions, EXIF orientation, and corrupt or truncated markers.
    - Decoding then uses the browser, recording `decode: "canvas-tonal"`.
    - Normalized samples are stored in `.sbrproj`, so reopening never re-decodes (NFR-05).
    - Bundling a JPEG decoder is out of scope.
15. **Fork and upstream workflow.** *Default:* [UP] fixes are offered to `strondcode/shadowbox-studio` as **separate minimal patches written against `f0552c7`**, not cherry-picks, because the fork's versions depend on `SBGeom`. The patches are:
    - frame union: pad the mask by `marginPx` before `SBTrace.trace` and drop the rect at `svgout.js:43`;
    - proof extent: offset by the margin in `proofSVG`;
    - groups: add `id="CUT"` and `id="SCORE"` at `svgout.js:76-77`.
16. **Version numbering.** *Default:* v2.0.0, because the schema major and export layout change, with pre-releases `v2.0.0-alpha.N` per gate.
17. **Test-suite layout.** *Default:* keep `test/run_tests.js` as the entry point and add `test/fixtures.js` (generators) plus `test/golden/*.json` (persisted hashes). Split into `test/suites/*.js` once the file passes about 1500 lines.
18. ● **Browser integration tests (NFR-10) [G4.8].** NFR-10 requires them in the release pipeline, but the repo has no npm. *Default:* an in-repo `test/browser.html` that loads the real modules and runs integration checks against real browser APIs (canvas decode, EXIF, `DecompressionStream`, worker, service worker), driven by `chromium --headless=new --dump-dom` (no npm) plus a manual Firefox/Safari run. *Alternative:* a tracked NFR-10 waiver approved by the product owner.
19. **EXIF policy (IMG-05).** *Default:*
    - The browser decode path (tonal PNG/JPEG) lets the browser apply EXIF, which it does by default. It records `orientation.exif = N` and `exifAppliedBy: "browser"`.
    - The raw PNG path parses `eXIf` and applies it in `SBEngine.orient`.
    - User rotate/mirror is always applied by `orient`, exactly once.
    - `createImageBitmap(…, {imageOrientation: "none"})` is not relied on, because current browsers treat it as `from-image`.

---

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

## Review Focus

These are inputs the SRS implies but no acceptance test exercises directly. Each one is pinned by a test in the task named.

1. **A non-square image whose integer resize rounds differently on X and Y.** Expected: mm coordinates use separate `sx`/`sy`; a 304.8 × 200 mm artwork exports exactly that size. *Pinned in G1.1:* `"D-4.2 non-square px scales both axes"`.
2. **N changed from 8 to 3 and back while warnings are acknowledged.** Expected: the acknowledgements and part IDs from the 8-layer revision do not carry over to the 3-layer revision. *Pinned in G2.2:* `"§9.5 ack invalid after geometryHash change"`.
3. **A height PNG with full-white or full-black content at N=16.** Expected: no NaN; 16 identical full-domain layers or the base only; identical layers flagged `IDENTICAL_LAYERS` (info), not deduplicated. *Pinned in G2.3:* `"AT-04 white N=16 → 16 identical layers, no NaN"`.
4. **A project title containing `</svg><script>`, `../`, or Windows-reserved characters.** Expected: escaped in SVG, MD and JSON; filenames sanitized. *Pinned in G3.9:* `"NFR-06 hostile title escaped in SVG/MD/JSON/filenames"`.
5. **The user changes a setting while an export is being packaged.** Expected: the package is built from the frozen snapshot of the revision that was current when export started, or is aborted. It never mixes revisions. *Pinned in G3.6:* `"EXP-05 snapshot immutable after later edits"`.
6. **The user reviews a clip at draft resolution, then edits a setting or exports at fabrication resolution.** Expected: an unchanged-config clip is re-shown at fab resolution for review in the export panel; a changed-config clip is marked `REPAIR_STALE` and not applied. *Pinned in G2.9.*
7. **A tiny 200 × 150 px source sized to 300 mm high, no frame, at the 0.1 mm/px target (4000 × 3000 px).** Expected: no upsampling; the raster is 200 × 150 and mm/px (2.0) is reported from the real samples; `FAB_EXCEEDS_SOURCE` warns with the shortfall (3800 × 2850 px). *Pinned in G2.0.*

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

## 5. Phase G0: baseline, harness and seams (no behaviour change)

**G0 exit (SRS §13.1, SRS:L596):** the upstream revision is frozen, the existing tests run, the frame edge cases are reproduced, and the current SVG and preview behaviour are captured as persisted goldens. Licenses are confirmed, and `docs/BASELINE.md` records the defects and per-module reuse decisions.

### Task T0.1: Commit the SRS, create the branch and the decision docs

**Files:**
- Add: `docs/SRS_Stacked_Relief.md` (already present, untracked)
- Create: `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`
- This plan: `docs/plans/opaque-layers-dev-plan.md`

**Interfaces:**
- Produces: a branch `feature/stacked-relief`; `docs/ARCHITECTURE.md` holds §3–§4 of this plan plus spike decisions D1–D4 as they land.

- [ ] **Step 1: Create the branch and commit the spec and plan**

```bash
cd /run/media/geekuser/Storage/WebstormProjects/ShadowBox-Stacked
git checkout -b feature/stacked-relief
git add docs/SRS_Stacked_Relief.md docs/plans/opaque-layers-dev-plan.md
git commit -m "docs: add Stacked Relief SRS v1.0 and implementation plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write `docs/COMPONENTS.md`**

```markdown
# Third-party components (NFR-11)
| Name | Version | License | File | SHA-256 | Obtained from | Build form (UMD/IIFE/shim) | Scope (runtime/dev-only) |
|---|---|---|---|---|---|---|---|
| (none yet — geometry backend added by spike S1) | | | | | | | |
```

- [ ] **Step 3: Write `docs/ARCHITECTURE.md`**

Copy §3 (data model), §4 (module map and backward-compatibility matrix), the Global Constraints and the determinism rules from this plan. Add an empty `## Decisions` heading with these entries:
- D1, smoothing rule;
- D2, geometry backend;
- D3, finite-width contact and saddle splitting;
- D4, hash scope.

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md docs/COMPONENTS.md
git commit -m "docs: architecture contract and component inventory skeleton

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task T0.2: Runner (`suite`, async, `--only`), module list, build and SW hygiene

**Files:**
- Create: `test/modules.js`
- Modify:
  - `test/run_tests.js:14-23` (load loop, helpers) and the report (:225-227);
  - `build.js:37` (regex);
  - `js/app.js:664` (`registerServiceWorker`: skip on local dev hosts);
  - `js/islands.js:33` (call-time `SBMorph` lookup);
  - `README.md:86`.

**Interfaces:**
- Produces:
  - `test/modules.js`, which exports `{ NODE_MODULES: string[] }`, the ordered list of `js/` paths loaded in Node;
  - `suite(name, fn)`, which skips the whole body when filtered, awaits async bodies sequentially, catches throws (recorded as one failing check) and continues;
  - `checkAsync(name, promise)`, awaited by the enclosing suite;
  - `--only <substring>`.

- [ ] **Step 1: Write the failing hygiene suite**

```js
suite("build — hygiene (four-list rule, inline bundle, versions)", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const tags = [...html.matchAll(/<script src="js\/([\w./-]+\.js)"><\/script>/g)].map((m) => m[1]);
  const shell = [...sw.matchAll(/"\.\/js\/([\w./-]+\.js)"/g)].map((m) => m[1]);
  const { NODE_MODULES } = require("./modules.js");
  const domOnly = new Set(["preview.js", "app.js"]);
  check("build: index.html scripts == sw.js SHELL (same order)", JSON.stringify(tags) === JSON.stringify(shell));
  check("build: Node list == index.html scripts minus DOM modules",
    JSON.stringify(NODE_MODULES) === JSON.stringify(tags.filter((t) => !domOnly.has(t))));
  require("child_process").execFileSync(process.execPath, [path.join(root, "build.js")], { stdio: "ignore" });
  const dist = fs.readFileSync(path.join(root, "dist/shadowbox-studio.html"), "utf8");
  check("build: dist has no external <script src=", !/<script src=/.test(dist));
  check("DEP-02 sw.js VERSION == APP_VERSION",
    sw.match(/VERSION\s*=\s*"([^"]+)"/)[1] === app.match(/APP_VERSION\s*=\s*"([^"]+)"/)[1]);
  check("dev: service worker skipped on localhost", /localhost|127\.0\.0\.1/.test(app.slice(app.indexOf("function registerServiceWorker"))));
});
```

Before you run it, check the exact `VERSION`/`APP_VERSION` declarations in `sw.js:19` and `js/app.js:23`, and adjust the two regexes to match them.

- [ ] **Step 2: Run it and confirm it fails**

Run: `node test/run_tests.js`
Expected: FAIL with `suite is not defined` (and, once that exists, `Cannot find module './modules.js'`).

- [ ] **Step 3: Create `test/modules.js` and convert the runner**

```js
// test/modules.js — the ONE ordered list of pure modules loaded in Node (§4 order).
module.exports = {
  NODE_MODULES: ["util.js", "raster.js", "morph.js", "islands.js", "trace.js", "svgout.js", "zip.js"],
};
```

In `test/run_tests.js`:
- Replace line 14's literal array with `require("./modules.js").NODE_MODULES`.
- Add `globalThis.crypto ??= require("crypto").webcrypto;` so `crypto.subtle` exists on Node 18.
- Replace the helpers with:

```js
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1] : null; })();
let skipping = false, pending = [];
const queue = [];
function section(name) { skipping = !!ONLY && !name.includes(ONLY); if (!skipping) console.log("\n" + name); } // legacy blocks
function check(name, cond) {
  if (skipping) return;
  if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.error("  ✗ " + name); }
}
function checkAsync(name, p) {
  if (skipping) return;
  pending.push(Promise.resolve(p).then((v) => check(name, !!v), (e) => check(name + " (threw " + e.message + ")", false)));
}
function suite(name, fn) { queue.push([name, fn]); }
```

Change the report block to:

```js
(async () => {
  for (const [name, fn] of queue) {
    if (ONLY && !name.includes(ONLY)) continue;
    skipping = false; console.log("\n" + name); pending = [];
    try { await fn(); await Promise.all(pending); } catch (e) { check(name + " (suite threw: " + e.message + ")", false); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
```

In `build.js:37`, change `([\w.]+)` to `([\w./-]+)` and read `path.join(root, "js", name)` (it already handles subpaths).

In `js/app.js` `registerServiceWorker`, return early when `["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)`.

In `js/islands.js:33`, replace `const M = global.SBMorph;` with a call-time lookup (`const M = () => global.SBMorph;` and `M().…` at the use sites).

Change `README.md:86` from `(29 checks)` to `(run it to see the current count)`.

- [ ] **Step 4: Run and confirm it passes**

Run: `node test/run_tests.js`. Expected: the 29 original checks plus the 5 hygiene checks pass, with 0 failures. Then run `node test/run_tests.js --only hygiene`, which should print only that suite.

- [ ] **Step 5: Commit**

```bash
git add test/modules.js test/run_tests.js build.js js/app.js js/islands.js README.md dist/shadowbox-studio.html
git commit -m "test: suite runner, --only, module list; build inlines subpaths; no SW on localhost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task T0.3: Golden fixture generators, seeded PRNG, PNG and JPEG-header encoders

**Files:**
- Create: `test/fixtures.js`
- Test: `test/run_tests.js`, new suite `fixtures — determinism`

**Interfaces:**
- Produces, from `require("./fixtures.js")`:
  - `art(rows) → {m,w,h}`, moved here from `run_tests.js:26` and re-exported;
  - `lcg(seed) → () => number in [0,1)`;
  - `ramp(w,h) → Uint8Array`;
  - `flat(w,h,v) → Uint8Array`;
  - `MASKS: {donutIsland, crescent, crescentInterior, borderTouch, narrowBridge(px), lowerHoleUnderPart, emptyIntermediate, orientationF, diagonalTouch, looseBridge}`, each a `{layers: Uint8Array[], w, h}` stack from base to front. `crescentInterior` is padded so the shape does not touch the border. `looseBridge` has identical layers 1 and 2 holding a frame plus a loose square;
  - `pngEncode({w,h,colorType,bitDepth,data,extraChunks?,corruptCrc?,apng?,filter?,truncate?})`, built on Node `zlib.deflateSync`. It applies the forward filter for filter types 1–4;
  - `jpegHeader({w, h, exif?, truncate?, sofLen?})`, a byte sequence holding SOI, an optional APP1 EXIF with an orientation tag, and SOF0. It has no scan data and is used by `SBJpeg.inspect` tests only;
  - `randomNestedStack(rng, w, h, N) → Uint8Array[]`.

- [ ] **Step 1: Write the failing determinism suite**

```js
suite("fixtures — determinism", () => {
  const F = require("./fixtures.js");
  const a = F.randomNestedStack(F.lcg(42), 24, 16, 5), b = F.randomNestedStack(F.lcg(42), 24, 16, 5);
  check("fixtures: seeded stack identical across calls", a.every((m, k) => m.every((v, i) => v === b[k][i])));
  check("fixtures: random stack is nested", a.every((m, k) => k === 0 || m.every((v, i) => !v || a[k - 1][i])));
  const png = F.pngEncode({ w: 5, h: 1, colorType: 0, bitDepth: 8, data: Uint8Array.from([0, 64, 128, 191, 255]) });
  check("fixtures: PNG signature", png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47);
  const j = F.jpegHeader({ w: 640, h: 480, exif: 6 });
  check("fixtures: JPEG SOI", j[0] === 0xff && j[1] === 0xd8);
  check("fixtures: all named masks present",
    ["donutIsland","crescent","crescentInterior","borderTouch","lowerHoleUnderPart","emptyIntermediate","orientationF","diagonalTouch","looseBridge"]
      .every((k) => F.MASKS[k] && F.MASKS[k].layers.length >= 2));
  const ci = F.MASKS.crescentInterior;
  check("fixtures: crescentInterior does not touch the border", [0, ci.w - 1].every((x) => [...Array(ci.h).keys()].every((y) => !ci.layers[1][y * ci.w + x])));
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `node test/run_tests.js --only fixtures` → FAIL (`Cannot find module './fixtures.js'`).

- [ ] **Step 3: Implement `test/fixtures.js`**

```js
"use strict";
const zlib = require("zlib");
function art(rows) {
  const h = rows.length, w = rows[0].length, m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = rows[y][x] === "#" ? 1 : 0;
  return { m, w, h };
}
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function ramp(w, h) { const a = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.round((255 * x) / (w - 1)); return a; }
function flat(w, h, v) { return new Uint8Array(w * h).fill(v); }
function stack(...grids) { const g = grids.map(art); return { w: g[0].w, h: g[0].h, layers: g.map((x) => x.m) }; }
const FULL = (w, h) => Array.from({ length: h }, () => "#".repeat(w));
const pad = (rows) => [".".repeat(rows[0].length + 2), ...rows.map((r) => "." + r + "."), ".".repeat(rows[0].length + 2)];
const CRESC = ["..####...", ".##......", "##.......", "##.......", "##.......", ".##......", "..####..."];
const LOOSE = ["##########", "#........#", "#..##....#", "#........#", "##########"];
const MASKS = {
  donutIsland: stack(FULL(9, 9), [".........", ".#######.", ".#.....#.", ".#.....#.", ".#..#..#.", ".#.....#.", ".#.....#.", ".#######.", "........."]),
  crescent: stack(FULL(9, 7), CRESC),
  crescentInterior: stack(FULL(11, 9), pad(CRESC)),
  borderTouch: stack(FULL(8, 5), ["#####...", "#####...", "........", "........", "........"]),
  lowerHoleUnderPart: stack(FULL(7, 7), ["#######", "#######", "##...##", "##...##", "##...##", "#######", "#######"], [".......", ".......", ".......", "...#...", ".......", ".......", "......."]),
  emptyIntermediate: stack(FULL(5, 5), [".....", ".....", ".....", ".....", "....."], [".....", ".###.", ".###.", ".###.", "....."]),
  orientationF: stack(FULL(7, 7), ["#####..", "#......", "####...", "#......", "#......", "#......", "......."]),
  diagonalTouch: stack(FULL(6, 6), ["###...", "###...", "###...", "...###", "...###", "...###"]),
  looseBridge: stack(FULL(10, 5), LOOSE, LOOSE),
};
MASKS.narrowBridge = (px) => { const rows = ["#####" + ".".repeat(5) + "#####"]; for (let i = 0; i < 4; i++) rows.push("#####" + ".".repeat(5) + "#####");
  for (let i = 0; i < px; i++) rows[1 + i] = "#".repeat(15); return stack(FULL(15, 5), rows); };
function randomNestedStack(rng, w, h, N) {
  const out = [new Uint8Array(w * h).fill(1)];
  for (let k = 1; k < N; k++) { const m = new Uint8Array(w * h);
    for (let b = 0; b < 3; b++) { const cx = rng() * w, cy = rng() * h, r = 1 + rng() * Math.min(w, h) / 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1; }
    for (let i = 0; i < m.length; i++) m[i] &= out[k - 1][i]; out.push(m); }
  return out;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data, corrupt) { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, "latin1");
  Buffer.from(data).copy(b, 8); b.writeUInt32BE((crc32(b.subarray(4, 8 + data.length)) ^ (corrupt ? 1 : 0)) >>> 0, 8 + data.length); return b; }
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
function filterRow(f, cur, prev, bpp) { const o = Buffer.alloc(cur.length);
  for (let i = 0; i < cur.length; i++) { const a = i >= bpp ? cur[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
    o[i] = (cur[i] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 0xff; } return o; }
function pngEncode({ w, h, colorType, bitDepth, data, extraChunks = [], corruptCrc = false, apng = false, filter = 0, truncate = 0 }) {
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType], bpp = Math.max(1, ch * (bitDepth / 8)), stride = w * ch * (bitDepth / 8);
  const raw = Buffer.alloc((stride + 1) * h); let prev = null;
  for (let y = 0; y < h; y++) { const cur = Buffer.from(data.buffer, data.byteOffset + y * stride, stride);
    raw[y * (stride + 1)] = filter; filterRow(filter, cur, prev, bpp).copy(raw, y * (stride + 1) + 1); prev = cur; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bitDepth; ihdr[9] = colorType;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (apng) parts.push(chunk("acTL", Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])));
  for (const [t, d] of extraChunks) parts.push(chunk(t, Buffer.from(d)));
  parts.push(chunk("IDAT", zlib.deflateSync(raw), corruptCrc), chunk("IEND", Buffer.alloc(0)));
  const out = Buffer.concat(parts); return new Uint8Array(truncate ? out.subarray(0, out.length - truncate) : out);
}
function jpegHeader({ w, h, exif = 0, truncate = 0, sofLen = 17 }) {
  const seg = (m, body) => { const b = Buffer.alloc(4 + body.length); b[0] = 0xff; b[1] = m; b.writeUInt16BE(body.length + 2, 2); Buffer.from(body).copy(b, 4); return b; };
  const parts = [Buffer.from([0xff, 0xd8])];
  if (exif) { const t = Buffer.alloc(26); t.write("Exif\0\0", 0, "latin1"); t.write("MM", 6, "latin1"); t.writeUInt16BE(42, 8); t.writeUInt32BE(8, 10);
    t.writeUInt16BE(1, 14); t.writeUInt16BE(0x0112, 16); t.writeUInt16BE(3, 18); t.writeUInt32BE(1, 20); t.writeUInt16BE(exif, 24); parts.push(seg(0xe1, t)); }
  const sof = Buffer.alloc(sofLen - 2); sof[0] = 8; sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3); sof[5] = 3;
  parts.push(seg(0xc0, sof), Buffer.from([0xff, 0xd9]));
  const out = Buffer.concat(parts); return new Uint8Array(truncate ? out.subarray(0, out.length - truncate) : out);
}
module.exports = { art, lcg, ramp, flat, MASKS, randomNestedStack, pngEncode, jpegHeader, crc32 };
```

In `run_tests.js`, replace the local `art` with `const { art } = require("./fixtures.js");`.

- [ ] **Step 4: Run** `node test/run_tests.js` → all pass.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures.js test/run_tests.js
git commit -m "test: §12 golden fixture generators, seeded LCG, PNG and JPEG-header encoders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task T0.4: Characterization checks (KNOWN-DEFECT) and persisted goldens

**Files:**
- Create:
  - `test/capture_golden.js`, a one-shot script run **only at v1.1.0**;
  - `test/golden/sheetmasks.json`;
  - `test/golden/oldrun.json`;
  - `test/legacy_oldrun.js`, a verbatim copy of `app.js:85-136` wrapped as `oldRun(rgba, w, h, state)`.
- Test: `test/run_tests.js`, new suite `baseline — characterization`

**Interfaces:**
- Produces check names that later tasks retarget and invert in the same commit as their fix:

| Check | Inverted by | Retargeted to |
|---|---|---|
| `KNOWN-DEFECT GEO-02` | G1.3 | `SBMaterial` polygons (no ring edge on x = frame between art rows 0..1) |
| `KNOWN-DEFECT EXP-01` | G1.4 | `SBSvg.layerSVG` |
| `KNOWN-DEFECT EXP-02` | G1.4 | `SBSvg.layerSVG` |
| `KNOWN-DEFECT EXP-03` | G3.2 | `SBSvg.layerSVG` with vector labels |
| `KNOWN-DEFECT GEO-01 proof extent` | G1.6 | `SBSvg.assemblySVG` |
| `KNOWN-DEFECT GEO-07 (bridge)` | G2.6 | `SBConstruct.bonded` |
| `KNOWN-DEFECT SUP-01` | G2.6 | `SBConstruct.bonded` / `connected` |

  When a check is inverted, the original check against the legacy shim is **deleted**; the T0.7 goldens freeze the shims.
- Golden files hold literal SHA-256 hex computed with `node:crypto` from v1.1.0 code. No test ever regenerates them.

- [ ] **Step 1: Write the characterization suite**

These checks pass against current code.

```js
suite("baseline — characterization (KNOWN-DEFECT checks invert when fixed)", () => {
  const F = require("./fixtures.js");
  const base = { pxW: 8, pxH: 5, widthMM: 80, marginMM: 10, holes: false, holeDiaMM: 3, label: "t 1/2" };
  const svgUp = SBSvg.sheetSVG({ ...base, loops: SBTrace.trace(F.MASKS.borderTouch.layers[1], 8, 5), isBacking: false });
  const svgBack = SBSvg.sheetSVG({ ...base, loops: [], isBacking: true });
  check("KNOWN-DEFECT EXP-01: sheetSVG always emits the page <rect>", /<rect /.test(svgUp));
  // 10 mm/px, margin 10: art rows 0..1 are y 10..30; the left art edge x=10 is cut although it touches the frame.
  check("KNOWN-DEFECT GEO-02: edge art cut separately from frame (segment x=10, y 10→30)", svgUp.includes("M 10 10 L 10 30"));
  check("KNOWN-DEFECT EXP-02: cut group has no id", !/<g id="CUT"/.test(svgUp));
  check("KNOWN-DEFECT EXP-03: label is live <text>", /<text /.test(svgUp));
  check("G0 backing sheet emits only rect (+label), no paths", !/<path /.test(svgBack) && /<rect /.test(svgBack));
  const proof = SBSvg.proofSVG([{ loops: [] }, { loops: [] }], 8, 5, 80, ["#fff", "#000"]);
  check("KNOWN-DEFECT GEO-01 proof extent: proof viewBox != sheet viewBox when margin>0",
    proof.match(/viewBox="([^"]+)"/)[1] !== svgUp.match(/viewBox="([^"]+)"/)[1]);
  // GEO-07 raster source: islands.resolve adds bridge material where layer k-1 is void.
  const lb = F.MASKS.looseBridge, lower = lb.layers[1], m = lb.layers[2].slice();
  SBIslands.resolve(m, lb.w, lb.h, { frameAnchored: true, bridgeRadius: 0.6, cullBelowPx: 0, maxBridgePx: 10 });
  check("KNOWN-DEFECT GEO-07 (bridge): islands.resolve adds material outside layer k-1", m.some((v, i) => v && !lower[i]));
  check("KNOWN-DEFECT SUP-01: islands.resolve bridges a loose part", m.some((v, i) => v !== lb.layers[2][i]));
  // Characterization (not a defect): the per-layer morphology chain keeps nested masks nested.
  let viol = 0;
  for (let s = 1; s <= 200; s++) { const st = F.randomNestedStack(F.lcg(s), 40, 30, 5);
    for (const r of [1, 3]) { const P = st.map((q, k) => { if (!k) return q; let x = SBMorph.open(q, 40, 30, r);
      x = SBMorph.close(x, 40, 30, Math.max(1, r - 1)); SBMorph.removeSpecks(x, 40, 30, 4); SBMorph.fillHoles(x, 40, 30, 4 * r * r * 2); return x; });
      for (let k = 2; k < P.length; k++) for (let i = 0; i < P[k].length; i++) if (P[k][i] && !P[k - 1][i]) viol++; } }
  check("G0 morphology chain preserves nesting (200 seeds)", viol === 0);
});
```

- [ ] **Step 2: Capture the persisted goldens from v1.1.0**

Write `test/legacy_oldrun.js` by copying `app.js:85-136` verbatim into `function oldRun(rgba, w, h, state)`, returning `{sheets}` exactly as the loop builds them.

Write `test/capture_golden.js`:

```js
// Run ONCE at v1.1.0 (before G2.4). Writes literal hashes; tests only read them.
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
for (const f of require("./modules.js").NODE_MODULES) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"));
const H = (u8) => crypto.createHash("sha256").update(Buffer.from(u8)).digest("hex");
const L = new Float32Array(37 * 11); for (let i = 0; i < L.length; i++) L[i] = (i * 97) % 256;
const sheetmasks = [];
for (let N = 3; N <= 8; N++) for (const df of [true, false]) for (const mode of ["balanced", "linear"]) {
  const th = SBRaster.thresholds(L, N, mode);
  const ms = SBRaster.sheetMasks(SBRaster.bands(L, th), N, 37, 11, df);
  sheetmasks.push({ N, darkFront: df, mode, thresholds: Array.from(th), masks: ms.map(H) });
}
fs.mkdirSync(path.join(__dirname, "golden"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "golden/sheetmasks.json"), JSON.stringify({ capturedFrom: "f0552c7", sheetmasks }, null, 1));
const { oldRun } = require("./legacy_oldrun.js");
const w = 40, h = 30, rgba = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < w * h; i++) { const v = ((i % w) * 6 + Math.floor(i / w) * 3) % 256; rgba.set([v, v, v, 255], i * 4); }
const cfg = { smoothRadius: 2, smoothPasses: 1, nSheets: 5, thresholdMode: "balanced", darkFront: true, widthMM: 120,
  minFeatureMM: 1.5, bridgeMM: 1.5, cullBelowMM2: 9, maxBridgeMM: 30, marginMM: 12, cornerStyle: "faceted", detailEps: 0.6 };
const r = oldRun(rgba, w, h, cfg);
fs.writeFileSync(path.join(__dirname, "golden/oldrun.json"), JSON.stringify({ capturedFrom: "f0552c7", cfg,
  sheets: r.sheets.map((s) => ({ mask: H(s.mask), loops: H(Buffer.from(JSON.stringify(s.loops))), bridges: s.bridges ? H(s.bridges) : null })) }, null, 1));
```

Add these checks to the suite. They read the files and compare against live **v1.1.0** code now, and against the new code later:

```js
  const G = require("./golden/sheetmasks.json"), H = (u8) => require("crypto").createHash("sha256").update(Buffer.from(u8)).digest("hex");
  const L = new Float32Array(37 * 11); for (let i = 0; i < L.length; i++) L[i] = (i * 97) % 256;
  check("G0/DEP-04 golden file has 24 configs", G.sheetmasks.length === 24);
  check("DEP-04/AT-21 thresholds + sheetMasks match persisted v1.1.0 golden (24 configs)", G.sheetmasks.every((g) => {
    const th = SBRaster.thresholds(L, g.N, g.mode);
    return JSON.stringify(Array.from(th)) === JSON.stringify(g.thresholds) &&
      SBRaster.sheetMasks(SBRaster.bands(L, th), g.N, 37, 11, g.darkFront).every((m, k) => H(m) === g.masks[k]); }));
```

Run `node test/capture_golden.js` **once**, then commit the JSON files. The script refuses to run if `test/golden/sheetmasks.json` already exists.

- [ ] **Step 3: Run** `node test/run_tests.js --only baseline`. Every check must pass against current code.

- [ ] **Step 4: Commit**

```bash
git add test/run_tests.js test/capture_golden.js test/legacy_oldrun.js test/golden/
git commit -m "test: G0 characterization and persisted v1.1.0 goldens (sheetMasks, thresholds, oldRun)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task T0.5: Extract the DOM-free engine seam (`SBEngine.legacyRun`)

**Files:**
- Create: `js/engine.js`
- Modify: `js/app.js:84-136` (the body after `getImageData` moves out)
- Register: `engine` at the end of the §4 order, in `index.html`, the `sw.js` SHELL and `test/modules.js`

**Interfaces:**
- Produces: `SBEngine.legacyRun(rgba: Uint8ClampedArray, w, h, cfg) → { sheets: [{mask, bridges, loops, stats}], totals: {bridged, culled, cutMM} }`. `cfg` holds exactly the `state` keys read today: `smoothRadius, smoothPasses, nSheets, thresholdMode, darkFront, widthMM, minFeatureMM, bridgeMM, cullBelowMM2, maxBridgeMM, marginMM, cornerStyle, detailEps`.

- [ ] **Step 1: Write the failing equivalence test**

```js
suite("engine.js — legacyRun seam (NFR-10, DEP-04)", () => {
  const G = require("./golden/oldrun.json"), H = (u8) => require("crypto").createHash("sha256").update(Buffer.from(u8)).digest("hex");
  const w = 40, h = 30, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = ((i % w) * 6 + Math.floor(i / w) * 3) % 256; rgba.set([v, v, v, 255], i * 4); }
  const r = SBEngine.legacyRun(rgba, w, h, G.cfg);
  check("NFR-10 legacyRun returns nSheets sheets", r.sheets.length === 5);
  check("DEP-04 legacyRun == pre-refactor runPipeline body (masks, loops, bridges)", r.sheets.every((s, k) =>
    H(s.mask) === G.sheets[k].mask && H(Buffer.from(JSON.stringify(s.loops))) === G.sheets[k].loops &&
    (s.bridges ? H(s.bridges) : null) === G.sheets[k].bridges));
});
```

- [ ] **Step 2: Run it** and confirm it fails with `SBEngine is not defined`.

- [ ] **Step 3: Create `js/engine.js` by moving `app.js:84-136` verbatim**

```js
(function (global) {
  "use strict";
  const E = {};
  E.legacyRun = function (rgba, w, h, cfg) {
    let L = SBRaster.luminance(rgba, w, h);
    L = SBRaster.kuwahara(L, w, h, cfg.smoothRadius, cfg.smoothPasses);
    const th = SBRaster.thresholds(L, cfg.nSheets, cfg.thresholdMode);
    const masks = SBRaster.sheetMasks(SBRaster.bands(L, th), cfg.nSheets, w, h, cfg.darkFront);
    const pxPerMM = w / cfg.widthMM;
    const featR = Math.max(1, Math.round((cfg.minFeatureMM * pxPerMM) / 2));
    const bridgeR = Math.max(featR, (cfg.bridgeMM * pxPerMM) / 2);
    const cullPx = cfg.cullBelowMM2 * pxPerMM * pxPerMM;
    const maxBridgePx = Math.round(cfg.maxBridgeMM * pxPerMM);
    const speckPx = Math.max(4, cullPx * 0.5);
    const holePx = Math.max(4, (cfg.minFeatureMM * pxPerMM) ** 2 * 2);
    const chaikinIters = cfg.cornerStyle === "smooth" ? 2 : 0;
    const totals = { bridged: 0, culled: 0, cutMM: 0 };
    const sheets = masks.map((mask, s) => {
      if (s === 0) return { mask, bridges: null, loops: [], stats: { cutMM: 0, bridged: 0, culled: 0, loops: 0 } };
      let m = SBMorph.open(mask, w, h, featR);
      m = SBMorph.close(m, w, h, Math.max(1, featR - 1));
      SBMorph.removeSpecks(m, w, h, speckPx);
      SBMorph.fillHoles(m, w, h, holePx);
      const isl = SBIslands.resolve(m, w, h, { frameAnchored: cfg.marginMM > 0, bridgeRadius: bridgeR, cullBelowPx: cullPx, maxBridgePx });
      let loops = SBTrace.trace(m, w, h).map((lp) => SBTrace.simplify(lp, cfg.detailEps))
        .map((lp) => (chaikinIters ? SBTrace.chaikin(lp, chaikinIters) : lp)).filter((lp) => lp.length >= 3);
      const cutMM = loops.reduce((a, lp) => a + SBUtil.loopLength(lp), 0) / pxPerMM;
      totals.bridged += isl.bridged; totals.culled += isl.culled; totals.cutMM += cutMM;
      return { mask: m, bridges: isl.bridges, loops, stats: { cutMM, bridged: isl.bridged, culled: isl.culled, loops: loops.length } };
    });
    return { sheets, totals };
  };
  global.SBEngine = E;
})(typeof window !== "undefined" ? window : globalThis);
```

Before committing, diff this function body against `test/legacy_oldrun.js`. Differences are allowed only in variable plumbing (`state` → `cfg`).

In `app.js` `runPipeline`, replace lines 84-136 with:

```js
    const { sheets, totals } = SBEngine.legacyRun(rgba, w, h, state);
    state.sheets = sheets;
    let totalBridged = totals.bridged, totalCulled = totals.culled, totalCutMM = totals.cutMM;
```

Keep the existing report code after it.

- [ ] **Step 4: Register and run**

Register `engine.js` in the four lists, then run `node test/run_tests.js` → all pass. Equivalence is proven by the golden. No manual byte comparison is needed, and none could be trusted while the service worker cached the old shell.

- [ ] **Step 5: Commit**

```bash
git add js/engine.js js/app.js index.html sw.js test/modules.js test/run_tests.js dist/shadowbox-studio.html
git commit -m "refactor: extract DOM-free SBEngine.legacyRun seam (golden-equivalent)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task T0.6: SHA-256 (`SBHash`) and `SBUtil.stableStringify`

**Files:**
- Create: `js/hash.js`
- Modify: `js/util.js`
- Register: after `util.js` in all lists

**Interfaces:**
- Produces:
  - `SBHash.sha256(bytes: Uint8Array) → string` (64 hex chars, synchronous). This is for canonical payloads of a few MB at most; it was measured at about 1.4 s per 16 MiB on desktop Node;
  - `await SBHash.digest(bytes) → string`, using `crypto.subtle.digest("SHA-256")` (for source bytes, samples and package files);
  - `SBHash.hashJSON(obj) → string`, which is `sha256(utf8(stableStringify(obj)))`;
  - `SBUtil.stableStringify(obj) → string`. Keys are sorted recursively and `undefined` object keys are dropped. It **throws** on non-finite numbers, on `undefined` or function array elements, and on typed arrays (use `SBHash.digest` for those).

- [ ] **Step 1: Write the failing tests**

```js
suite("hash.js — SHA-256 (GEO-09, EXP-06, NFR-05)", async () => {
  const enc = (s) => new TextEncoder().encode(s), node = (s) => require("crypto").createHash("sha256").update(s).digest("hex");
  check("hash: NIST empty", SBHash.sha256(enc("")) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  check("hash: NIST abc", SBHash.sha256(enc("abc")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  check("hash: 1e6 x 'a' matches node:crypto", SBHash.sha256(enc("a".repeat(1e6))) === node("a".repeat(1e6)));
  check("hash: 55/56/64-byte padding boundaries", [55, 56, 64].every((n) => SBHash.sha256(enc("x".repeat(n))) === node("x".repeat(n))));
  check("NFR-05 hash.js uses no Math.cbrt/sin/cos", !/Math\.(cbrt|sin|cos|exp|log)/.test(require("fs").readFileSync(require("path").join(__dirname, "../js/hash.js"), "utf8")));
  check("hash: digest == sha256", (await SBHash.digest(enc("abc"))) === SBHash.sha256(enc("abc")));
  check("util: stableStringify sorts keys", SBUtil.stableStringify({ b: 1, a: { d: 2, c: 3 } }) === '{"a":{"c":3,"d":2},"b":1}');
  const throws = (v) => { try { SBUtil.stableStringify(v); return false; } catch (e) { return true; } };
  check("NFR-05 stableStringify rejects non-finite", throws({ x: NaN }));
  check("NFR-05 stableStringify rejects undefined array element", throws([undefined]));
  check("NFR-05 stableStringify rejects typed arrays", throws({ s: new Uint8Array(3) }));
});
```

- [ ] **Step 2: Run it** and confirm it fails with `SBHash is not defined`.

- [ ] **Step 3: Implement `js/hash.js`**

The constants are the FIPS 180-4 values, hard-coded. Do not derive them at load time: `Math.cbrt` is not guaranteed to be correctly rounded.

```js
(function (global) {
  "use strict";
  const K = Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const H0 = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const hex = (u32) => Array.from(u32, (v) => v.toString(16).padStart(8, "0")).join("");
  const H = {};
  H.sha256 = function (bytes) {
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total); buf.set(bytes); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len << 3) >>> 0);
    const h = H0.slice(), w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + 4 * i);
      for (let i = 16; i < 64; i++) { const x = w[i - 15], y = w[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    return hex(h);
  };
  H.digest = async function (bytes) {
    const buf = await global.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  };
  H.hashJSON = (obj) => H.sha256(new TextEncoder().encode(global.SBUtil.stableStringify(obj)));
  global.SBHash = H;
})(typeof window !== "undefined" ? window : globalThis);
```

In `js/util.js`, add the following before the export:

```js
  U.stableStringify = function (v) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("stableStringify: non-finite number"); return JSON.stringify(v); }
    if (v === undefined || typeof v === "function") throw new Error("stableStringify: undefined/function value");
    if (ArrayBuffer.isView(v)) throw new Error("stableStringify: typed array — hash bytes with SBHash.digest");
    if (Array.isArray(v)) return "[" + v.map(U.stableStringify).join(",") + "]";
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + U.stableStringify(v[k])).join(",") + "}";
  };
```

(`U` is the namespace object used in `util.js`; match its local name.)

- [ ] **Step 4: Register `hash.js` after `util.js` in all lists, then run the tests (all pass).**

- [ ] **Step 5: Commit**

Use `feat: SHA-256 (hard-coded constants, sync + subtle) and strict stable JSON` with the Co-Authored-By line.

### Task T0.7: Baseline report, legacy SVG goldens and license check

**Files:**
- Create: `docs/BASELINE.md`, `test/golden/legacy_svg.json` (captured by `test/capture_golden.js`, extended)
- Create: `docs/CHANGELOG.md` heading `## Unreleased` (it does not exist yet)

- [ ] **Step 1: Freeze the legacy shims**

Extend `test/capture_golden.js` with a guarded second stage that writes `legacy_svg.json`. It records the SHA-256 of `SBSvg.sheetSVG` and `SBSvg.proofSVG` output for 3 fixtures (`borderTouch` with margin 10, `donutIsland` with holes on, and the T0.5 RGBA fixture through `legacyRun`). Add the check `G0 legacy sheetSVG/proofSVG byte-identical to goldens (3 fixtures)`.
- [ ] **Step 2: Manual preview capture**

Load the demo in a browser on `localhost` (SW now skipped), save one preview PNG and the exported ZIP to `docs/baseline/`, and record the browser and version.
- [ ] **Step 3: Write `docs/BASELINE.md`**

It records:
- the frozen upstream revision `f0552c7`;
- the `node test/run_tests.js` result (29 original checks plus the G0 additions);
- the KNOWN-DEFECT list, with fixtures;
- the observed frame edge-case topology (GEO-02);
- the license check: upstream `LICENSE` is MIT, "Copyright (c) 2026 Shadowbox Studio contributors", and must be kept in `dist/` and the fork;
- the per-module **reuse decisions**:

| Module | Decision |
|---|---|
| `morph` | reuse unchanged |
| `islands` | connected mode only |
| `trace` | reuse, plus `smoothBounded` |
| `raster` | wrap; add `resample` |
| `svgout` | legacy shims frozen; `layerSVG` new |
| `zip` | reuse build; add read |
| `preview` | rework for proof mode |
| `app` | controller rework |

- [ ] **Step 4:** Add a `## Unreleased` heading to `docs/CHANGELOG.md`, with a "Baseline (G0)" note that links to `docs/BASELINE.md`. **Commit.**

---

## 6. Phase S: time-boxed spikes (each ends in merged checks)

**Gate rule:** G1 does not start until S1, S2, S5 and S6 are merged and their decisions are recorded in `docs/ARCHITECTURE.md`. S4 and S4b may run in parallel with G1.

### Task S1: Geometry backend behind the `SBGeom` adapter (2.5 days, decision D2)

**Files:**
- Create: `js/vendor/<lib>.js` (pinned, UMD/IIFE or wrapped by an in-repo shim) with `js/vendor/LICENSE-<lib>.txt`, and `js/geom.js`
- Modify: `docs/COMPONENTS.md`, `docs/ARCHITECTURE.md`
- Register: `vendor/<lib>.js` and `geom.js` after `hash.js`
- Create: `test/bench.js`

**Interfaces:**

- Produces `SBGeom`, which is engine-agnostic. All coordinates are integer µm.

| Function | Returns / behaviour |
|---|---|
| `fromPixelLoops(loops, sxUm, syUm, oxUm, oyUm)` | `PolygonWithHoles[]`; rounds `x*sx+ox` to integers; **reverses traced rings** to the §3 winding |
| `union(a, b)`, `difference(a, b)`, `intersection(a, b)` | `PolygonWithHoles[]` (normalized, NonZero fill) |
| `offset(polys, deltaUm, join)` | `PolygonWithHoles[]`; `join` is `"miter"` or `"square"` (`"round"` is refused: not deterministic across engines); negative `deltaUm` insets |
| `area(polys)` | `number` (µm², exact integer) |
| `isEmpty(polys)` | `boolean` |
| `containsPoint(polys, [x, y])` | `boolean`; points on the boundary count as inside |
| `components(polys)` | `PolygonWithHoles[][]`; point contact counts as separate |
| `normalize(polys)` | winding and start-vertex rule from §3; collinear points removed; vertex-touching rings split into simple rings (D3); sorted by `(minY, minX)` |
| `validate(polys)` | `{ok, errors: [{code: "GEO_SELF_INTERSECT"|"GEO_ZERO_AREA"|"GEO_DUPLICATE"|"GEO_OPEN", ring}]}` |
| `bbox(poly)` | `[x0, y0, x1, y1]` |
| `circle(cxUm, cyUm, rUm)` | 64-vertex polygon from a hard-coded integer unit table (×1e6), with `Math.round(cx + r*t/1e6)` per vertex; no trig at run time |

- [ ] **Step 1: Write the battery**

It must pass identically on each candidate.

```js
suite("spike S1 — SBGeom battery (GEO-01/03/09)", () => {
  const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] });
  const G = SBGeom, shoe = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; };
  check("S1 union of two edge-adjacent squares is one polygon", G.union([sq(0,0,10,10)], [sq(10,0,20,10)]).length === 1);
  check("S1 point-touching squares stay two components", G.components(G.union([sq(0,0,10,10)], [sq(10,10,20,20)])).length === 2);
  const donut = G.difference([sq(0,0,30,30)], [sq(10,10,20,20)]);
  check("S1 donut area exact", G.area(donut) === 900 - 100);
  check("S1 donut has one hole", donut.length === 1 && donut[0].holes.length === 1);
  check("S1 difference of identical sets is empty", G.isEmpty(G.difference([sq(0,0,10,10)], [sq(0,0,10,10)])));
  check("S1 coincident partial edge difference is empty", G.isEmpty(G.difference([sq(0,0,10,5)], [sq(0,0,10,10)])));
  check("S1 offset -500µm of 800µm strip is empty", G.isEmpty(G.offset([sq(0,0,800,10000)], -500, "miter")));
  let threw = false; try { G.offset([sq(0,0,10,10)], 1, "round"); } catch (e) { threw = true; }
  check("NFR-05 round join refused", threw);
  check("S1 bowtie rejected", !G.validate([{ outer: [0,0,10,10,10,0,0,10], holes: [] }]).ok);
  check("S1 zero-area ring rejected", !G.validate([{ outer: [0,0,10,0,20,0], holes: [] }]).ok);
  const n = G.normalize(donut);
  check("S1 normalize idempotent", JSON.stringify(G.normalize(n)) === JSON.stringify(n));
  check("S1 outer positive / hole negative area in Y-down", shoe(n[0].outer) > 0 && shoe(n[0].holes[0]) < 0);
  const traced = G.fromPixelLoops(SBTrace.trace(require("./fixtures.js").art(["###", "#.#", "###"]).m, 3, 3), 1000, 1000, 0, 0);
  check("S1 fromPixelLoops reverses trace winding (outer positive)", shoe(G.normalize(traced)[0].outer) > 0);
  const saddle = G.normalize(G.union([sq(0,0,10,10)], [sq(10,10,20,20)]));
  check("GEO-03/D3 saddle → 2 simple rings, validate ok", saddle.length === 2 && G.validate(saddle).ok);
  check("NFR-05 circle has no trig and is symmetric", G.circle(0, 0, 1500).outer.length === 128 && G.area([G.circle(0,0,1500)]) > 0);
  check("S1 results identical across two runs", JSON.stringify(G.union([sq(0,0,7,9)], [sq(3,3,13,13)])) === JSON.stringify(G.union([sq(0,0,7,9)], [sq(3,3,13,13)])));
});
suite("spike S1 — vendor load forms", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../js/vendor", require("./modules.js").NODE_MODULES.find((m) => m.startsWith("vendor/")).slice(7)), "utf8");
  check("NFR-11 vendor loads as a classic script in a fresh vm context", (() => { const c = require("vm").createContext({}); c.globalThis = c; require("vm").runInContext(src, c); return Object.keys(c).length > 1; })());
  check("NFR-11 vendor has no import/export statements", !/^\s*(import|export)\s/m.test(src));
});
```

The worker `importScripts` load is verified in the G4.8 browser harness. Inlining into `dist/` is covered by the T0.2 hygiene check.

- [ ] **Step 2: Implement `js/geom.js` as a thin adapter over candidate (a)**

Run the battery and the load-form checks. Repeat them for (c), and for (b) only if it is paired with an in-repo offset. Record a table in `docs/ARCHITECTURE.md` under D2 with these columns:
- battery pass count;
- load forms;
- vendored size;
- licence;
- offset support;
- `test/bench.js geom` p95 for 8 layers × 50k vertices pairwise difference (target under 2 s on Node);
- `offset` p95 at the same size;
- `SBSupport`-style support pairs on `randomNestedStack(lcg(1), 1536, 1024, 8)` traced (target under 3 s).

- [ ] **Step 3: Decide**

Keep the candidate that passes every check and load form, is offset-capable and is within budget. If none passes, implement fallback (c) behind the same API: exact orthogonal booleans on the shared lattice, with offset as lattice Minkowski erosion/dilation (square join). Record D2.

- [ ] **Step 4: Inventory and commit**

Add the vendored file, its LICENSE, its SHA-256 (`sha256sum js/vendor/<lib>.js`), its build form and its scope (runtime) to `docs/COMPONENTS.md`. Register it in the four lists. Commit with `feat(geom): SBGeom adapter over <lib> (decision D2)`.

### Task S2: Smoothing vs containment experiment (2 days, decision D1)

**Files:**
- Create: `test/spikes/s2_smoothing.js` (rerunnable; prints a table)
- Modify: `docs/ARCHITECTURE.md` (D1)

**Interfaces:**
- Consumes: `SBGeom`, `SBTrace.simplify` / `SBTrace.chaikin`, `test/fixtures.js`.
- Produces: decision D1, plus the checks in G1.2 that encode it.

- [ ] **Step 1: Write the script**

For each fixture stack, and for `randomNestedStack(lcg(s), 120, 90, 6)` with s = 1..20:
1. Trace each layer.
2. Smooth with `simplify(eps=0.6)` plus `chaikin(2)`.
3. Convert to µm with `fromPixelLoops` at 0.25 mm/px.
4. Compute `difference(L[k], L[k-1])` per layer.

Print these columns per layer:
- the overhang area;
- the maximum sliver thickness, found by binary search over `offset(diff, -d, "miter")` becoming empty;
- the number of loops that must fall back (Chaikin → RDP → raw) before containment holds, with the fixpoint below;
- the number of fixpoint iterations.

- [ ] **Step 2: Run** `node test/spikes/s2_smoothing.js` and paste the table into `docs/ARCHITECTURE.md`.
- [ ] **Step 3: Record D1**

Rule (default): **containment-aware bounded smoothing; no automatic conformance.**
1. Each art loop is smoothed at the highest level, Chaikin, whose densified Hausdorff deviation ≤ `toleranceMM` and whose ring hierarchy matches the raw loop. Otherwise it drops to RDP within tolerance, then to raw.
2. Layers are processed from the base upward, and `difference(L[k], L[k-1])` is computed against the already smoothed `L[k-1]`.
3. Any upper loop that intersects the overhang drops one level. If it is already raw, the lower loops it overlaps drop one level instead.
4. The process repeats until there is no overhang.

Levels only decrease, and the all-raw stack is nested (G2.7 property). So the fixpoint terminates in at most `3 × loops` steps. Every fallback is reported as `SMOOTH_FALLBACK` (warning) with the loop's layer and region.

Clip-to-lower stays a reviewed repair only (G2.9). If the product owner rejects smoothing in bonded mode (open question 2), bonded forces `cornerStyle: "sharp"` with collinear-only simplification. **Outcome (2026-10-07):** the product owner chose exactly that (D1 option (b)); the containment-aware rule above is not implemented in G1 (see G1.2 and Appendix C, S2 bullets).
- [ ] **Step 4: Commit** with `spike(S2): smoothing vs containment measurement and rule D1`.

### Task S4: Raw PNG decode and header inspection (`SBPng`) (1.5 days; parallel with G1)

**Files:**
- Create: `js/png.js`
- Modify: `js/util.js` (move CRC-32 here as `SBUtil.crc32`), `js/zip.js` (call `SBUtil.crc32` at call time)
- Register: in the §4 position (after `schema`, before `jpeg`). Until those exist, append after `geom`.

**Interfaces:**
- Produces:
  - `SBPng.inspect(bytes) → {w, h, bitDepth, colorType, interlace, animated, exif: 1..8|null}`. It reads headers only and walks the chunks without inflating. It is used by the IMG-07 preflight in **both** modes;
  - `SBPng.check(info, mode) → code|null`, which applies the IMG-01 rules to `inspect` output. **Both modes** reject `acTL` (`PNG_APNG`) and bit depth 16 (`PNG_16BIT`), so the canvas can never silently truncate;
  - `await SBPng.decode(bytes, {mode: "height"|"tonal"}) → {w, h, samples: Uint8Array, alpha: Uint8Array|null, policy: "raw-gray8"|"raw-rgb-equal", exif, sampleHash}`. `sampleHash` comes from `await SBHash.digest`;
  - it throws `Error` with `.code` set to one of `PNG_16BIT`, `PNG_APNG`, `PNG_CRC`, `PNG_TRUNCATED`, `PNG_UNEQUAL_RGB`, `PNG_PALETTE`, `PNG_SIGNATURE`.

- [ ] **Step 1: Write the failing tests** (async)

```js
suite("png.js — raw decode and inspection (IMG-01/02/05/07, AT-02/22)", () => {
  const F = require("./fixtures.js");
  const g = (opts) => F.pngEncode({ w: 5, h: 1, colorType: 0, bitDepth: 8, data: Uint8Array.from([0, 64, 128, 191, 255]), ...opts });
  const rej = (bytes, code, mode = "height") => SBPng.decode(bytes, { mode }).then(() => false, (e) => e.code === code);
  checkAsync("AT-02 raw samples 0,64,128,191,255 exact", SBPng.decode(g({}), { mode: "height" }).then((r) => r.samples.join() === "0,64,128,191,255"));
  checkAsync("AT-02 iCCP/gAMA ignored, samples unchanged",
    SBPng.decode(g({ extraChunks: [["gAMA", [0, 0, 0xb1, 0x8f]], ["sRGB", [0]]] }), { mode: "height" }).then((r) => r.samples.join() === "0,64,128,191,255"));
  checkAsync("IMG-01 16-bit rejected", rej(F.pngEncode({ w: 1, h: 1, colorType: 0, bitDepth: 16, data: Uint8Array.from([1, 2]) }), "PNG_16BIT"));
  checkAsync("IMG-01 APNG rejected", rej(g({ apng: true }), "PNG_APNG"));
  checkAsync("IMG-01 corrupt CRC rejected", rej(g({ corruptCrc: true }), "PNG_CRC"));
  checkAsync("AT-22 truncated PNG rejected", rej(g({ truncate: 10 }), "PNG_TRUNCATED"));
  checkAsync("IMG-01 unequal RGB rejected in height mode",
    rej(F.pngEncode({ w: 1, h: 1, colorType: 2, bitDepth: 8, data: Uint8Array.from([10, 20, 30]) }), "PNG_UNEQUAL_RGB"));
  checkAsync("IMG-01 filter types 1-4 round-trip exactly", Promise.all([1, 2, 3, 4].map((f) => SBPng.decode(g({ filter: f }), { mode: "height" })))
    .then((rs) => rs.every((r) => r.samples.join() === "0,64,128,191,255")));
  check("IMG-07 inspect reads w/h without inflating", SBPng.inspect(g({})).w === 5 && SBPng.inspect(g({})).h === 1);
  check("IMG-01 tonal APNG rejected at inspection", SBPng.check(SBPng.inspect(g({ apng: true })), "tonal") === "PNG_APNG");
  check("IMG-01 tonal 16-bit rejected at inspection",
    SBPng.check(SBPng.inspect(F.pngEncode({ w: 1, h: 1, colorType: 0, bitDepth: 16, data: Uint8Array.from([1, 2]) })), "tonal") === "PNG_16BIT");
  check("IMG-05 eXIf orientation parsed", SBPng.inspect(g({ extraChunks: [["eXIf", [0x4d,0x4d,0,42,0,0,0,8,0,1,1,0x12,0,3,0,0,0,1,0,6,0,0]]] })).exif === 6);
});
```

- [ ] **Step 2: Run** and confirm the tests fail.
- [ ] **Step 3: Implement the decoder**

1. Validate the signature.
2. Walk the chunks, verifying each CRC with `SBUtil.crc32`.
3. Read IHDR and reject bit depth ≠ 8 and colour type 3 with a non-gray palette.
4. Reject `acTL`. Parse `eXIf` orientation (tag 0x0112, either byte order). Ignore `iCCP`, `gAMA`, `sRGB` and `cHRM`.
5. Concatenate the IDAT chunks and inflate them through `new Response(new Blob([idat]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer()`.
6. Unfilter scanlines (types 0–4, Paeth).
7. Handle Adam7 interlace with the standard 7-pass offsets.
8. Collapse RGB(A) to gray only if R == G == B for every pixel, otherwise throw `PNG_UNEQUAL_RGB` in height mode.
9. Split out alpha.
10. Set `sampleHash = await SBHash.digest(samples)`.

- [ ] **Step 4: Run** and confirm the tests pass. **Commit** with `feat(png): raw 8-bit PNG decoder and header inspection (IMG-01/02/05/07)`.

### Task S4b: JPEG header inspection (`SBJpeg`) (0.5 day; parallel with G1)

**Files:**
- Create: `js/jpeg.js` (after `png` in the §4 order)

**Interfaces:**
- Produces `SBJpeg.inspect(bytes) → {w, h, components, progressive, exif: 1..8|null}`. It walks markers from SOI to the first SOFn and parses the APP1 Exif orientation. It never decodes scan data.
- It throws with `.code` set to `JPEG_SIGNATURE`, `JPEG_TRUNCATED`, `JPEG_BAD_SEGMENT` (a segment length past EOF or a SOF length that does not match its component count) or `JPEG_NO_SOF`.

- [ ] **Tests:**
  - `IMG-07 JPEG SOF dimensions read before decode` (`jpegHeader({w: 6000, h: 4000})` → 6000 × 4000);
  - `IMG-05 JPEG EXIF orientation 6 parsed`;
  - `AT-22 corrupt JPEG (bad SOI) rejected`;
  - `AT-22 truncated JPEG rejected`;
  - `AT-22 oversized SOF segment length rejected` (`sofLen: 4000`).
- **Commit.**

### Task S5: Frame union and saddle connectivity characterization (1 day)

**Files:**
- Test: `test/run_tests.js`, suite `spike S5`

- [ ] **Step 1: Write the checks**

```js
suite("spike S5 — trace saddles & frame contact (GEO-02/03, AT-06)", () => {
  const F = require("./fixtures.js");
  const d = F.MASKS.diagonalTouch;
  check("S5 trace of diagonal-only contact yields two outer loops", SBTrace.trace(d.layers[1], d.w, d.h).length === 2);
  const polys = SBGeom.normalize(SBGeom.union(SBGeom.fromPixelLoops(SBTrace.trace(d.layers[1], d.w, d.h), 1000, 1000, 0, 0), []));
  check("AT-06 diagonal-only contact = 2 components", SBGeom.components(polys).length === 2);
  check("GEO-03 diagonal-only contact validates (simple rings)", SBGeom.validate(polys).ok);
});
```

- [ ] **Step 2: Run**

If the saddle check fails, so that `T.trace` merges diagonal neighbours, record that in D3. `SBMaterial` (G1.1) then splits at saddles by checking 4-connectivity with `SBMorph.components` (`morph.js:77`) before tracing.
- [ ] **Step 3: Commit.**

### Task S6: Canonical normalization and geometry hash scope (0.5 day, decision D4)

**Files:**
- Modify: `js/geom.js` (`canonicalBytes`), `docs/ARCHITECTURE.md` D4

**Interfaces:**
- Produces:
  - `SBGeom.canonicalBytes(layers: {index, material, holes?, scorePaths?}[]) → Uint8Array`, a little-endian int32 stream over normalized polygons. The structure is `[layerCount, (index, partCount, (ringCount, (vertexCount, x, y …)…)…, scoreCount, (vertexCount, x, y …)…)…]`;
  - `layerHash = SBHash.sha256(canonicalBytes([layer]))`;
  - `geometryHash` as defined in §3 (wired up in G2.1/G2.10b).

- [ ] **Step 1: Write the checks**
  - `S6/GEO-09 hash invariant to start vertex` (rotate the ring array by 2 vertices);
  - `S6 hash invariant to input winding` (reverse the ring);
  - `S6 hash invariant to part order` (shuffle the array);
  - `S6 1µm move changes hash`;
  - `S6 score path change changes hash`.
- [ ] **Step 2: Implement** `canonicalBytes` on top of `normalize`. Run, record D4, and commit.

---

## 7. Phase G1: canonical geometry

### Task G1.0: `SBDiag` registry and `make()` (moved forward from G2.2)

G1.1 already emits blocking diagnostics, so the registry must exist first.

**Files:**
- Create: `js/diag.js` (after `geom` in the §4 order)

**Interfaces:**
- Produces:
  - `SBDiag.CODES`, a frozen map from code to `{severity, title, fix, kind}`. `kind` is `"geometry"|"fabrication"|"process"`. The codes are:
    - **Blocking:**
      - `BOND_UNSUPPORTED`, `BOND_EMPTY_UNDER`;
      - `GEO_SELF_INTERSECT`, `GEO_ZERO_AREA`, `GEO_DUPLICATE`, `GEO_OPEN`;
      - `SAMPLING_LOW`, `NONFINITE`, `REG_HOLE_INVALID`, `PAGE_OVERFLOW`, `CONNECTED_SPLIT`, `STALE`;
      - `REPAIR_STALE`, `COMPLEXITY_LIMIT`, `LEGACY_NEEDS_SOURCE`, `GUIDE_UNCONTAINED`.
    - **Warning:**
      - `MAT_UNCALIBRATED`, `PART_SMALL`, `PART_THIN`, `NECK_NARROW`, `SUPPORT_NARROW`;
      - `GUIDE_OMITTED`, `CLEANUP_ALTERED`, `SMOOTH_FALLBACK`, `TRAILING_OMITTED`;
      - `ALIGN_CLEARANCE_ZERO`, `REPAIR_REVIEW_FAB`, `FAB_EXCEEDS_SOURCE`.
    - **Info:**
      - `KERF_EXTERNAL`, `PALETTE_ONLY`, `IDENTICAL_LAYERS`, `EMPTY_BAND`;
      - `DISPLAY_ONLY_IGNORED`, `HEIGHT_FILTERED`, `RESAMPLED`.
  - `SBDiag.make(code, {revision, quality, layer, part, parts, count, areaMM2, region, measured, limit, detail}) → Diagnostic`. It fills every §9.1 field (SRS:L354). The severity always comes from `CODES` and cannot be passed in. `ackState` is `"n/a"` for blocking and info, and `"unacked"` for warnings.
  - `SBDiag.aggregate(diags) → Diagnostic[]`. It merges `PART_SMALL`, `PART_THIN` and `NECK_NARROW` per `(code, layer)` into one diagnostic with `count`, `parts[]` and a region list. This prevents thousands of acks on noisy inputs.

- [ ] **Tests:**
  - `§9.5 make() ignores attempted severity override` (passing `{severity:"warning"}` for `BOND_UNSUPPORTED` stays blocking)
  - `§9.1 diagnostic carries revision, quality, measured, limit, ackState`
  - `UI-04 every code has non-empty title and fix text`
  - `§9.5 aggregate: 500 PART_SMALL on one layer → 1 diagnostic, count 500`
  - `§9.5 information codes include palette-only, identical layers and display-only` (SRS:L419)
- **Commit.**

### Task G1.1: `SBMaterial.fromMasks` with deterministic part IDs (absorbs former G3.1)

**Files:**
- Create: `js/material.js` (§4 position, after `construct`; until `construct` exists, append after `trace`)
- Test: suite `material.js — canonical polygons`

**Interfaces:**
- Consumes: `SBTrace.trace`, `SBGeom.fromPixelLoops`, `normalize`, `validate`, `components`, `bbox`, `area`; `SBDiag.make`.
- Produces:
  - `SBMaterial.scale({w, h, artWMM, artHMM}) → {sxUm, syUm, mmPerPxMax}` (D-4.2: separate axes; `mmPerPxMax` is the GEO-06 sampling input);
  - `SBMaterial.fromMasks(final: Uint8Array[], w, h, page, opts) → MaterialLayer[]`. `page = {artWMM, artHMM, frameMM}`. Art is offset by `frameMM`. Layers contain `material`, `carriers: []`, `parts`, `stats` and `diagnostics`; geometry validation errors become blocking diagnostics using the `SBGeom.validate` codes.
  - `SBMaterial.assignParts(layers) → layers`. Parts are sorted by `(layer, bbox.minY, bbox.minX, −area, ringHash)` and labelled `L{kk}-P{nnn}`. `supports[]` and `guideRefs[]` are rewritten to IDs later (G2.7, G3.3). It is used from G1 on, so IDs never churn.

- [ ] **Step 1: Write the failing tests**

```js
suite("material.js — canonical polygons (GEO-01/03, D-4.2, SUP-05)", () => {
  const F = require("./fixtures.js"); const d = F.MASKS.donutIsland;
  const L = SBMaterial.assignParts(SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, {}));
  const parts = L[1].parts;
  check("GEO-01 donut+island → 2 parts", parts.length === 2);
  check("GEO-01 ring part has exactly 1 hole", parts.some((p) => p.polygon.holes.length === 1));
  check("GEO-01 island is its own part, no hole", parts.some((p) => p.polygon.holes.length === 0));
  check("GEO-01 carriers representable and empty in v1.0", Array.isArray(L[1].carriers) && L[1].carriers.length === 0);
  check("GEO-03 no validation diagnostics on clean fixture", L[1].diagnostics.length === 0);
  check("SUP-05 ID format L01-P001", /^L01-P00[12]$/.test(parts[0].id));
  const shuffled = SBMaterial.assignParts(SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, {}).map((l) => ({ ...l, parts: l.parts.slice().reverse() })));
  check("SUP-05 part order stable across runs and shuffled input", JSON.stringify(shuffled[1].parts.map((p) => p.id + p.areaMM2)) === JSON.stringify(parts.map((p) => p.id + p.areaMM2)));
  const s = SBMaterial.scale({ w: 300, h: 197, artWMM: 304.8, artHMM: 200 });
  check("D-4.2 non-square px scales both axes", s.sxUm === 1016 && Math.abs(s.syUm - 200000 / 197) < 1e-9);
  check("GEO-06 sampling uses larger pixel dimension", s.mmPerPxMax === Math.max(304.8 / 300, 200 / 197));
});
```

- [ ] **Step 2: Run** and confirm it fails.
- [ ] **Step 3: Implement**

`scale` returns `sxUm = artWMM*1000/w`, `syUm = artHMM*1000/h` and `mmPerPxMax`. `fromMasks` does the following per layer:
1. For k = 0 with a full mask, emit the rectangle B directly as an exact 4-vertex ring.
2. Trace.
3. Collinear-dedupe (equivalent to `T.simplify` with eps 0).
4. If `opts.smooth` is set, apply bounded smoothing on the **pixel loops** (G1.2). Smoothing never runs after conversion.
5. Run `fromPixelLoops(loops, sx, sy, frameUm, frameUm)`, which reverses the winding.
6. Run `union(polys, [])` (NonZero), which resolves the hierarchy, then `normalize` (saddles are split, D3), then `validate`.
7. `components` gives the parts.
8. Compute `stats.areaMM2 = area/1e6`, `cutMM` from the ring perimeters, and `vertices`.

**Commit.**

### Task G1.2: Bounded smoothing on pixel loops, connected mode only; bonded unsmoothed (GEO-04, D1)

D1 (decided 2026-10-07, `docs/ARCHITECTURE.md`): **bonded mode is unsmoothed** — its layers keep the raw lattice contours, so nesting holds by construction and there is no containment fixpoint. **Connected mode** keeps per-loop, deviation-bounded smoothing. Per-vertex lazy pinning (S2 option (c)) is deferred and perf-gated (Appendix C, S2 bullets); it is not part of this task.

**Files:**
- Modify:
  - `js/trace.js` (add `T.smoothLevel`);
  - `js/geom.js` (add `maxDeviationUm`, `ringTopology`);
  - `js/material.js` (add `smoothStack`, used by `fromMasks` when `opts.smooth`).

**Interfaces:**
- Produces:
  - `SBGeom.maxDeviationUm(ringA, ringB, stepUm = 10) → number`. This is the symmetric Hausdorff distance with **both rings densified** at `stepUm` (point to segment, with `Math.sqrt` only), so peaks inside segments are measured.
  - `SBGeom.ringTopology(polys) → string`, a canonical signature of the ring count and outer/hole nesting.
  - `SBTrace.smoothLevel(loopPx, level: "chaikin"|"rdp"|"raw", pinned: (pt) => boolean, epsPx) → loopPx'`. `"chaikin"` is **Chaikin(2)∘RDP(ε)** (RDP before Chaikin, S1 amendment), `"rdp"` is RDP(ε) alone, with ε = `tolUm / pitchUm` in pixels. Vertices on the art-rectangle boundary are **pinned**, so the frame union stays exact.
  - `SBMaterial.smoothStack(loopsByLayer, {tolUm, sxUm, syUm, mode: "connected"|"bonded"}) → {loopsByLayer, levels, fallbacks: [{layer, loopIndex, from, to, reason: "deviation"|"topology", devUm}]}`. It implements D1:
    1. `mode: "bonded"` returns the loops unchanged: every level is `"raw"` and there are no fallbacks (D1 option (b)).
    2. `mode: "connected"`: each loop independently starts at the highest level whose deviation is ≤ `tolUm` and whose layer topology is unchanged; the tolerance loop runs per loop, not per layer.
  - It reports `SMOOTH_FALLBACK` diagnostics (connected mode). **There is no `conform` function, no containment fixpoint and no automatic clip.**

- [ ] **Step 1: Tests**

```js
suite("smoothing — bounded, connected mode; bonded unsmoothed (GEO-04, D1, AT-09)", () => {
  const F = require("./fixtures.js"), G = SBGeom;
  const stair = [[0,0],[1,0],[1,1],[2,1],[2,2],[3,2],[3,3],[0,3]];
  const toUm = (lp, s) => lp.flatMap(([x, y]) => [Math.round(x * s), Math.round(y * s)]);
  const dev = G.maxDeviationUm(toUm(stair, 1000), toUm(SBTrace.smoothLevel(stair, "chaikin", () => false, 0), 1000));
  check("GEO-04 deviation of chaikin(staircase) at 1 mm/px within 1 µm of 176.78", Math.abs(dev - 176.78) <= 1);
  const r = SBMaterial.smoothStack([[], [stair]], { tolUm: 1, sxUm: 250, syUm: 250, mode: "connected" });
  check("GEO-04 tolerance exceeded (1 µm @ 250 µm/px) → fallback recorded", r.levels[1][0] !== "chaikin" && r.fallbacks.length > 0);
  // densified measurement is never below a brute-force sampled distance
  const rng = F.lcg(3); let okDense = true;
  for (let t = 0; t < 20; t++) { const A = [0,0,1000,0,1000,1000,0,1000], B = A.map((v) => v + Math.round((rng() - 0.5) * 200));
    const brute = (P, Q) => { let m = 0; for (let i = 0; i < P.length; i += 2) { const j = (i + 2) % P.length;
      for (let s = 0; s <= 100; s++) { const x = P[i] + (P[j] - P[i]) * s / 100, y = P[i + 1] + (P[j + 1] - P[i + 1]) * s / 100;
        let best = Infinity; for (let k = 0; k < Q.length; k += 2) { const l = (k + 2) % Q.length, dx = Q[l] - Q[k], dy = Q[l + 1] - Q[k + 1];
          const u = Math.max(0, Math.min(1, ((x - Q[k]) * dx + (y - Q[k + 1]) * dy) / (dx * dx + dy * dy || 1)));
          best = Math.min(best, Math.hypot(x - Q[k] - u * dx, y - Q[k + 1] - u * dy)); } m = Math.max(m, best); } } return m; };
    if (G.maxDeviationUm(A, B) + 1 < Math.max(brute(A, B), brute(B, A))) okDense = false; }
  check("GEO-04 deviation measured at segment interiors (densified ≥ sampled)", okDense);
  const ci = F.MASKS.crescentInterior, page = { artWMM: ci.w * 0.25, artHMM: ci.h * 0.25, frameMM: 0 };
  const Lb = SBMaterial.fromMasks(ci.layers, ci.w, ci.h, page, { smooth: { tolUm: 50, mode: "bonded" } });
  const Lraw = SBMaterial.fromMasks(ci.layers, ci.w, ci.h, page, {});
  check("D1 bonded mode is unsmoothed: material equals the raw lattice contours", JSON.stringify(Lb.map((l) => l.material)) === JSON.stringify(Lraw.map((l) => l.material)));
  check("D1/SUP-02 bonded (unsmoothed) leaves no overhang", G.isEmpty(G.difference(Lb[1].material, Lb[0].material)));
  check("D1 bonded smoothStack reports no SMOOTH_FALLBACK", SBMaterial.smoothStack([[], [stair]], { tolUm: 50, sxUm: 250, syUm: 250, mode: "bonded" }).fallbacks.length === 0);
  const bt = F.MASKS.borderTouch;
  const Lc = SBMaterial.fromMasks(bt.layers, bt.w, bt.h, { artWMM: 8, artHMM: 5, frameMM: 0 }, { smooth: { tolUm: 50, mode: "connected" } });
  check("GEO-02 art-boundary vertices pinned (x=0 edge kept exact)", Lc[1].material[0].outer.some((v, i) => i % 2 === 0 && v === 0));
  check("GEO-04 topology unchanged after smoothing (donut keeps its hole)", (() => { const d = F.MASKS.donutIsland;
    const a = SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, {});
    const b = SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, { smooth: { tolUm: 50, mode: "connected" } });
    return G.ringTopology(a[1].material) === G.ringTopology(b[1].material); })());
});
```

S5 F3 (frame-edge slivers from unpinned per-loop smoothing) applies to connected mode: G1.3 adds `GEO-02 connected smoothing leaves no frame-edge hole below 1 px²`.

For the staircase analytic value: a 2-iteration Chaikin on a unit stair at 1 mm/px has a maximum corner deviation of 0.25·√2/2 mm ≈ 176.8 µm (measured 176.78 by the code-accuracy review). Confirm it with the S2 script before committing.

- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit.**

### Task G1.3: Frame and holes as canonical material; the page model [UP]

**Files:**
- Modify: `js/material.js` (add `page()`, `applyFrame()`, `subtractHoles()`)
- Test: retarget and invert `KNOWN-DEFECT GEO-02`

**Interfaces:**
- Produces:
  - `SBMaterial.page(cfg) → {wMM, hMM, artWMM, artHMM, frameMM}`. Finished size = art + 2·frame. This page is shared by every layer and by the proof.
  - `applyFrame(layer, page)` unions the exact rectangle ring `rect(page) − rect(art)` into the layer material. It runs **after** bounded smoothing, which only touched art loops. It applies to every layer when the frame is enabled (open question 5), and in connected mode to every layer when `frameMM > 0`.
  - `subtractHoles(layer, holes: {cxUm, cyUm, rUm}[])` subtracts `SBGeom.circle` polygons, after the frame union and before validation (GEO-02 order).

- [ ] **Step 1: Tests**
  - `LYR-04 frame ring ∪ edge-touching art is one material polygon`
  - `GEO-02 FIXED: no material ring has consecutive vertices with x = frame edge (10000 µm) and y within art rows 0..1 (10000..30000 µm)`. This replaces `KNOWN-DEFECT GEO-02`; delete the old sheetSVG check, since T0.7 freezes the shim.
  - `LYR-04 bonded default has no frame`
  - `AT-07 base = exactly outer rect (4 vertices, page corners) + explicit holes`
  - `AT-12 frame outer ring is an exact rectangle with page dimensions`
  - `ASM-04 subtractHoles leaves hole rings equal to SBGeom.circle`
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit**

Commit on its own with `fix(geom)[UP]: frame is unioned material, edge art stays attached (GEO-02)`. The upstream version is the separate minimal patch from open question 15.

### Task G1.4: SVG writer v2, `SBSvg.layerSVG` [UP for groups]

**Files:**
- Modify: `js/svgout.js` (add `S.layerSVG`; keep `sheetSVG`/`proofSVG` as frozen legacy shims)
- Test: retarget `KNOWN-DEFECT EXP-01` and `KNOWN-DEFECT EXP-02` to `layerSVG` and invert them

**Interfaces:**
- Produces `SBSvg.layerSVG(layer: MaterialLayer, page, {construction, scorePaths, frontNote, legacyTextLabel?}) → string`.
- The output is `<svg xmlns="http://www.w3.org/2000/svg" width="{wMM}mm" height="{hMM}mm" viewBox="0 0 {wMM} {hMM}">` and contains:
  - `<desc>` with front face, orientation (Y-down, not mirrored) and `kerfMode=external`;
  - `<g id="CUT" fill="none" stroke="#FF0000" stroke-width="0.1">`, with one `<path d="M… L… Z">` per ring;
  - `<g id="SCORE" fill="none" stroke="#0000FF" stroke-width="0.1">`, with polylines only.
- Coordinates are formatted as `fmtUm(u) = (u/1000).toFixed(3).replace(/\.?0+$/, "")`. This is exact from integers.
- There is never a page `<rect>`. The base gets its outline from the material ring.
- `legacyTextLabel` exists **only** for the connected export between G1.7 and G3.2. It emits the v1.1.0 `<text>` label inside `SCORE` and is deleted in G3.2.

- [ ] **Step 1: Tests**
  - `EXP-01 FIXED: bonded upper layer emits no <rect>` (on `layerSVG`)
  - `EXP-01 shared viewBox across layers and proof`
  - `EXP-02 FIXED: groups id=CUT #FF0000 and id=SCORE #0000FF, no fill on cuts` (on `layerSVG`)
  - `EXP-03 no transform|clipPath|filter|style|image|text`, checked with the regex `/<(text|image|style|clipPath|filter)|transform=/`, without `legacyTextLabel`
  - `AT-12 100mm square → width="100mm" and coords 0..100`
  - Delete the two original `KNOWN-DEFECT` shim checks.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit.**

### Task G1.5: `SBSvgRead` parser and round trip (GEO-09, AT-11/12/13)

**Files:**
- Create: `js/svgread.js` (register after `svgout.js`)

**Interfaces:**
- Produces `SBSvgRead.parse(svgText) → {widthMM, heightMM, viewBox: [x, y, w, h], cut: number[][] /* rings µm */, score: number[][], unsupported: string[]}`.
- It accepts only absolute `M`, `L` and `Z`. Any other command, any `<text>`, `transform`, etc. is pushed to `unsupported`.

- [ ] **Step 1: Tests**
  - `GEO-09/AT-11 parse(layerSVG(L)) rebuilt via SBGeom.union equals L.material within 5µm (maxDeviationUm) and same ringTopology`, for every fixture
  - `AT-13 relative/curve commands reported unsupported`
  - `AT-13 open path (no Z) flagged`
  - `AT-12 304.8mm asymmetric artwork dims exact`
  - `AT-05 orientationF top-left corner preserved (no mirror)`
- [ ] **Step 2–5:** fail, implement, pass, commit.

### Task G1.6: Opaque proof drawn from material in the shared page frame [UP]

**Files:**
- Modify: `js/svgout.js` (add `S.assemblySVG(layers, page, colors)`)
- Test: retarget `KNOWN-DEFECT GEO-01 proof extent` to `assemblySVG` and invert it

**Interfaces:**
- Produces `SBSvg.assemblySVG(layers, page, colors, {edgeStroke}) → string`. Layers are painted back to front as filled `<path fill-rule="evenodd">` from `layer.material` rings, in the same viewBox as `layerSVG`. With uniform appearance, each layer edge gets a thin darker stroke so the layers stay readable. The SVG carries the comment `<!-- proof: not for cutting -->`.

- [ ] **Step 1: Tests**
  - `GEO-01 FIXED: assemblySVG viewBox == layerSVG viewBox` (delete the shim check)
  - `GEO-01 proof path rings == material rings`
  - `MAT-04 proof colors do not change any layer canonicalHash`
  - `MAT-04 uniform proof strokes layer edges`
- [ ] **Step 2–5:** fail, implement, pass, commit.

### Task G1.7: Connected export through the canonical path; G1 release

**Files:**
- Modify:
  - `js/app.js:399-428` (`buildAndDeliver`). It builds layers from the `SBEngine.legacyRun` masks via `SBMaterial.fromMasks` (bounded smoothing, no containment), `applyFrame`, and `subtractHoles` with the **v1.1.0 corner positions** (`margin/2` inset, `svgout.js:54-61`) when `holes` is on. It then writes `layerSVG({legacyTextLabel})` and `assemblySVG`. Filenames stay legacy for now (`sheet_NN.svg`, `proof.svg`); the §9.4 layout arrives in G3.9.
  - `js/app.js`, preview badge: until G2.12 the raster preview shows a "Draft preview: cut files come from polygons" badge.
  - `docs/CHANGELOG.md`, `js/app.js:23`, `sw.js:19` → `2.0.0-alpha.1`.

- [ ] **Step 1: Add end-to-end Node checks**
  - `G1 E2E connected: legacyRun → fromMasks → layerSVG → parse → union equals material`
  - `DEP-04 connected export keeps 4 corner holes at v1.1.0 positions when holes on`
  - `DEP-04 connected export keeps the sheet label`

- [ ] **Step 2: Manual check**

Run on `localhost`, where the SW is not registered. Export the demo, then:
- open each SVG in a browser and confirm the frame is attached;
- confirm `proof.svg` aligns with the cuts.

- [ ] **Step 3: CHANGELOG entry**

Under `## v2.0.0-alpha.1`, list the intentional connected-mode changes (DEP-04):
- the frame is now unioned with edge art;
- `CUT`/`SCORE` group ids;
- the proof uses the page frame;
- smoothing is bounded to 0.05 mm, with pinned frame-edge vertices.

Holes and labels are unchanged.

- [ ] **Step 4:** run `node build.js` and commit.

**G1 exit (SRS §13.1):** AT-06, AT-07, AT-11 (round trip), AT-12 and AT-13 sections are green on the core fixtures. The AT-09 geometry part is green via G1.2's checks (bonded unsmoothed and nested; connected topology and tolerance).

---

## 8. Phase G2: bonded relief engine and opaque review UI

**Execution order (PO-LASER-10, Appendix D.4):** G2.0 → G2.1 → **G2.1b** → **G2.2b** → G2.2 → G2.3 → … → G2.7 → **G2.7b** → G2.8 → … → G2.14 → checkpoint. Tasks keep their IDs; the list in Appendix D.4 is binding where it differs from the section order below.

### Task G2.0: Deterministic resampling and the raster contract (IMG-02/03, GEO-06, NFR-05, PO-LASER-4/5)

**Files:**
- Modify: `js/raster.js` (add `resample`, `rasterSize`, `fabRaster`)

**Interfaces:**
- Produces:
  - `SBRaster.rasterSize(srcW, srcH, targetLong) → {W, H, capped: boolean}`. The size is never larger than the source. `capped` is true when `targetLong` exceeded the source's long side. **Draft quality only** (720 px long side).
  - `SBRaster.fabRaster({artWUm, artHUm, srcW, srcH, targetPitchUm, pxBudget}) → {W, H, pitchUm, capped: "none"|"budget"|"source"|"budget+source", shortPx: [shortW, shortH] | null}` (PO-LASER-4/5; replaces the fixed `fabPx` long side). Integer-only:
    1. `W0 = ceil(artWUm / p)`, `H0 = ceil(artHUm / p)` with `p = targetPitchUm` (100 by default).
    2. **Budget:** if `W0·H0 > pxBudget`, `p` becomes the smallest integer ≥ `targetPitchUm` with `ceil(artWUm/p)·ceil(artHUm/p) ≤ pxBudget` (start from `floor(sqrt(artWUm·artHUm/pxBudget))`, then step by 1 µm; `Math.sqrt` is allowed by the determinism rules), and `capped` includes `"budget"`.
    3. **Source:** `W = min(W1, srcW)`, `H = min(H1, srcH)` per axis (never upsample). If either axis is clamped, `capped` includes `"source"` and `shortPx = [max(0, W1 − srcW), max(0, H1 − srcH)]`, where `W1 × H1` is the raster after step 2.
    The real per-axis scales stay `sxUm = artWUm / W` and `syUm = artHUm / H` (G1.1), and mm/px is always reported from them.
  - `SBRaster.resample(pixels, channels, w, h, W, H, method: "none"|"nearest"|"area") → Uint8Array`. It is pure and integer-only, with no floats in the index math.
    - `nearest` uses `sx = floor((2x+1)*w / (2W))`.
    - `area` is an exact integer box average with half-up rounding.
    - `W > w` or `H > h` throws `RESAMPLE_UPSAMPLE`.
- Policy, which the engine reads from `geometry.resample`:
  - **Height mode:** `none` when the source fits; otherwise `nearest`, which only picks existing values. `area` is available only as an explicit, history-recorded filter (`HEIGHT_FILTERED` info).
  - **Tonal mode:** `area`.
  - The method is recorded in `Snapshot.geometry.resample` and in the manifest.
  - `FAB_EXCEEDS_SOURCE` (warning, PO-LASER-5) is raised when the source has fewer pixels than the target fabrication raster on either axis. `measured` and `limit` are the source and target px on the **most-short axis** (largest target/source ratio, ties → width), so `measured < limit` whenever it warns (review fix 2026-10-08; `shortPx` carries both axes); the message names that axis and states the shortfall (for example "3800 × 2850 px short of the 0.1 mm/px target") and that source detail cannot be recovered (GEO-06). mm/px always comes from the real raster.
  - `FAB_PITCH_CAPPED` (info, PO-LASER-4; registered in `SBDiag.CODES` with this task) is raised when the budget coarsened the pitch. `measured` is the mm/px of the budget-limited raster (before the source clamp; equal to the real mm/px when only the budget capped), `limit` the target mm/px, and the message names the device class and budget. When the source then limits the raster further (`budget+source`), the message attributes that extra coarsening to the source and gives the real mm/px, never blaming the budget for it (review fix 2026-10-08). It is never silent: the dimbar (G2.11c) shows it before generation.

- [x] **Tests:**
  - `IMG-03 height nearest: output values ⊆ input values` (on a ramp)
  - `IMG-02 none is the identity`
  - `NFR-05 area on gray is integer-exact and repeatable`
  - `GEO-06/PO-LASER-5 never upsamples: 200×150 source, 400×300 mm at 0.1 mm/px → 200×150, capped "source", shortPx [3800, 2850]`
  - `GEO-06 mmPerPx uses the real raster after capping` (2.0 mm/px in the case above)
  - `PO-LASER-4 300×225 mm art at 0.1 mm/px, budget 16e6 → 3000×2250, pitch 100 µm, capped "none"`
  - `PO-LASER-4 470×470 mm art, budget 16e6 → pitch 118 µm (first integer pitch with W·H ≤ budget), capped "budget"`
  - `PO-LASER-4 budget and source caps combine: capped "budget+source"`
  - `NFR-05 fabRaster is integer-only and repeatable` (same inputs ×3, every output an integer)
  - `RESAMPLE_UPSAMPLE thrown for W > w`
- **Commit.**

**Result (2026-10-08):** `SBRaster.resample`, `rasterSize`, `fabRaster`, plus `scaleUm`, `resamplePolicy`, `cacheKey` (Appendix C, S4) and `fabDiagnostics`; `FAB_PITCH_CAPPED` registered (commit `ebf11ca`). The G2.0/G2.1 review (`2dbb03d`) moved `FAB_EXCEEDS_SOURCE` `measured`/`limit` to the most-short axis and attributes the `budget+source` coarsening to the source (the rules above). The suite has 37 checks.

### Task G2.1: `SBSchema`, project v1, presets, machine profile, strict keys and lossless units (extended, PO-LASER-1/3/4/6/7/8)

**Files:**
- Create: `js/schema.js`

**Interfaces:**
- Produces:
  - `SBSchema.defaults(preset: "plywood"|"acrylic") → Project`.
  - `SBSchema.validate(p) → {ok, errors: [{path, code}]}`. It checks:
    - **strict key sets** per section; unknown keys in geometry sections give `UNKNOWN_KEY`;
    - enums and finite numbers;
    - the ranges N 1..16, axis 1..2000 mm, t 0.1..25, g 0..25;
    - manual thresholds strictly ascending within (0, 1);
    - `geometry.sizeBy ∈ {"height", "width"}`, `targetMM` 1..2000, `fabPitchMM` 0.01..2 (quantized to 0.001 mm), `draftPx` 64..2000;
    - `machine` null or a `MachineProfile` (§3) with strict keys, finite positive limits, `maxProcessingHeightMM ≤ maxMaterialWidthMM`, `maxThicknessMM` 0.1..25 and `kerfMM` 0..2;
    - `material.advisoryFeatureMM ≥ minFeatureMM`;
    - `registration.layers` is `"all"` or a sorted unique index list.
  - `SBSchema.importLoose(obj) → {project, movedToExtras: string[]}`. Unknown **top-level** keys go to `extras`; unknown keys inside geometry sections are still rejected.
  - `SBSchema.geometryKey(p) → object`, scoped as in §3 (`machine` is included: a profile change re-runs validation and invalidates acks).
  - `SBSchema.MACHINES` (frozen): `{"xtool-s1-feeder": {id, name: "xTool S1 + feeder", maxProcessingHeightMM: 470, maxLengthMM: 3000, maxMaterialWidthMM: 545, maxThicknessMM: 14, kerfMM: 0.15}}` (PO-LASER-1). `defaults()` copies it into `project.machine` for both presets; every field stays editable and is saved with the project.
  - `SBSchema.resolveSize(project, srcW, srcH) → {artWMM, artHMM, pageWMM, pageHMM}` (PO-LASER-3), on the oriented source size, integer µm: with `sizeBy: "height"`, `pageH = targetMM`, `artH = pageH − 2·frame`, `artW = round(artH·srcW/srcH)`; with `"width"` the same on the other axis. With `lockAspect: false` both `widthMM`/`heightMM` are used as entered.
  - `SBSchema.limits(deviceClass) → {fabPxBudget, …}`. G2.1 introduces it with the **provisional** budgets desktop 16,000,000 px and mobile 4,000,000 px; G2.2b replaces them with the measured values (done 2026-10-08: desktop 25,000,000 px, mobile 1,000,000 px); G2.7b adds the complexity caps (done 2026-10-08: desktop 258 parts/layer, 132,000 vertices/layer, 356,000 vertices; mobile 100 / 20,000 / 20,000); G2.14 and G4.3 add the other limits.
  - Plywood preset additions: `geometry.sizeBy = "height"`, `targetMM = 300`, `fabPitchMM = 0.1`, `material.minFeatureMM = 1.5`, `advisoryFeatureMM = 2.0`; `thicknessMM = 6.35` nominal stays (PRJ-01), and the thickness control carries the hint "1/4\" ply often measures 5.5–6 mm: measure and enter it" (PO-LASER-8, G2.11c).
  - `SBSchema.toMM(v, unit)` / `fromMM(mm, unit)` for `unit ∈ {"mm","in"}`. Both quantize: `toMM(v,"in") = Math.round(v*25400)/1000`.
  - `SBSchema.modeChangeDiff(p, patch) → [{path, from, to, reason}]`. It lists the settings that a change of `interpretation.mode` or `construction.mode` affects or makes inapplicable. G2.11e uses it.

- [x] **Step 1: Tests**

```js
suite("schema.js — project v1 (PRJ-01/02, MAT-02/03, §9.1)", () => {
  const p = SBSchema.defaults("plywood");
  check("PRJ-01 plywood preset fields", p.construction.mode === "bonded-relief" && p.interpretation.polarity === "white-high" &&
    p.construction.sheets === 8 && p.construction.gapMM === 0 && p.material.thicknessMM === 6.35 && p.material.calibrated === false);
  check("MAT-03/PO-LASER-6 provisional feature/part", p.material.minFeatureMM === 1.5 && p.material.advisoryFeatureMM === 2 && p.material.minPartMM2 === 25);
  check("PO-LASER-1 default machine xTool S1 + feeder", p.machine.id === "xtool-s1-feeder" && p.machine.maxProcessingHeightMM === 470 &&
    p.machine.maxLengthMM === 3000 && p.machine.maxMaterialWidthMM === 545 && p.machine.maxThicknessMM === 14 && p.machine.kerfMM === 0.15);
  check("PO-LASER-1 machine profile is editable and survives validate", SBSchema.validate({ ...p, machine: { ...p.machine, maxLengthMM: 1000 } }).ok);
  check("PO-LASER-1 unknown machine key rejected", !SBSchema.validate({ ...p, machine: { ...p.machine, power: 40 } }).ok);
  check("PO-LASER-3 default sizes by height", p.geometry.sizeBy === "height" && p.geometry.targetMM === 300);
  const sz = SBSchema.resolveSize({ ...p, construction: { ...p.construction, frame: { enabled: true, widthMM: 10 } } }, 4000, 3000);
  check("PO-LASER-3 height mode: page 300 high, art 280 × 373.333", sz.pageHMM === 300 && sz.artHMM === 280 && sz.artWMM === 373.333 && sz.pageWMM === 393.333);
  check("PO-LASER-4 fab pitch 0.1 mm, draft 720", p.geometry.fabPitchMM === 0.1 && p.geometry.draftPx === 720 && !("fabPx" in p.geometry));
  check("PO-LASER-4 provisional pixel budgets", SBSchema.limits("desktop").fabPxBudget === 16e6 && SBSchema.limits("mobile").fabPxBudget === 4e6);
  check("PO-LASER-6 advisory below minFeature rejected", !SBSchema.validate({ ...p, material: { ...p.material, advisoryFeatureMM: 1 } }).ok);
  check("PO-LASER-8 thickness 6.35 nominal, editable", p.material.thicknessMM === 6.35 && p.material.thicknessState === "nominal" &&
    SBSchema.validate({ ...p, material: { ...p.material, thicknessMM: 5.7, thicknessState: "measured" } }).ok);
  check("AT-01 12 in → 304.8 mm exactly (quantized)", SBSchema.toMM(12, "in") === 304.8);
  check("AT-01 304.8 mm → 12 in → 304.8 mm", SBSchema.toMM(SBSchema.fromMM(304.8, "in"), "in") === 304.8);
  const q = JSON.parse(JSON.stringify(p)); q.appearance.color = "#000000"; q.view.explodeMM = 40; q.app.version = "9.9.9"; q.id = "other";
  check("PRJ-02/AT-01 appearance/view/app/id change → same geometryKey hash", SBHash.hashJSON(SBSchema.geometryKey(p)) === SBHash.hashJSON(SBSchema.geometryKey(q)));
  check("MAT-02 width 2001 rejected", !SBSchema.validate({ ...p, geometry: { ...p.geometry, widthMM: 2001 } }).ok);
  check("LYR-03 unordered manual thresholds rejected", !SBSchema.validate({ ...p, interpretation: { ...p.interpretation, mode: "tonal", thresholdRule: "manual", manual: [0.6, 0.3] } }).ok);
  check("AT-22 NaN thickness rejected", !SBSchema.validate({ ...p, material: { ...p.material, thicknessMM: NaN } }).ok);
  check("AT-22 unknown enum rejected", !SBSchema.validate({ ...p, construction: { ...p.construction, mode: "glued" } }).ok);
  check("§9.1/AT-22 unknown key in construction rejected", !SBSchema.validate({ ...p, construction: { ...p.construction, autoPillars: true } }).ok);
  check("§9.1 unknown top-level metadata moved to extras", SBSchema.importLoose({ ...p, colorNotes: "x" }).project.extras.colorNotes === "x");
  check("GEO-10 machine null is allowed (no envelope check)", SBSchema.validate({ ...p, machine: null }).ok);
  check("GEO-10 machine with processing height above material width rejected", !SBSchema.validate({ ...p, machine: { ...p.machine, maxProcessingHeightMM: 600 } }).ok);
  check("PRJ-02 mode change lists affected settings",
    SBSchema.modeChangeDiff(p, { construction: { mode: "connected-sheet" } }).some((d) => d.path === "construction.gapMM"));
});
```

- [x] **Step 2–5:** fail, implement, pass, commit.

**Result (2026-10-08):** as specified (commit `70de9e7`): strict `validate` with `{path, code}` errors that never throws, `MACHINES`, `resolveSize`, `limits`, lossless `toMM`/`fromMM`, `importLoose`, `geometryKey` (D4 scope) and `modeChangeDiff`. The G2.0/G2.1 review (`2dbb03d`) range-checks both art axes, entered or derived, in `resolveSize` (MAT-02, `SCHEMA_SIZE`). The test `PO-LASER-4 provisional pixel budgets` above was retargeted when G2.2b measured the budgets (`PO-LASER-4 measured pixel budgets (G2.2b): desktop 25 Mpx, mobile 1 Mpx`). 23 plan checks plus a 72-check extended suite.

### Task G2.1b: Draft/fabrication raster snapshot (`SBEngine.rasterPlan`) (LYR-06, GEO-06, NFR-04, PO-LASER-4/5)

Runs third in G2 (Appendix D.4). It pulls the quality-dependent raster part of the G2.10b draft/fabrication rule forward, so the pixel budget benchmark (G2.2b), the dimbar (G2.11c) and preflight (G2.14) all use one rule.

**Files:**
- Modify: `js/engine.js` (add `rasterPlan`, `qualityPair`)

**Interfaces:**
- Consumes: `SBSchema.resolveSize`, `SBSchema.limits` (G2.1); `SBRaster.rasterSize`, `SBRaster.fabRaster` (G2.0); `SBDiag.make`.
- Produces:
  - `SBEngine.rasterPlan(project, source: {w, h}, quality: "draft"|"fabrication", deviceClass) → {geometry: GeometryConfig, diagnostics: Diagnostic[]}`, deep-frozen. It takes dimensions only, so it runs before any decode (NFR-04).
    - Sizes come from `resolveSize` on the oriented source (`rotate` 90/270 swaps `w` and `h`).
    - **Draft:** `rasterSize(w, h, project.geometry.draftPx)` (720 px long side); no pitch diagnostics.
    - **Fabrication:** `fabRaster({artWUm, artHUm, srcW: w, srcH: h, targetPitchUm: Math.round(fabPitchMM·1000), pxBudget: limits(deviceClass).fabPxBudget})`, plus `FAB_EXCEEDS_SOURCE` (with `shortPx`) and `FAB_PITCH_CAPPED` (with actual and target mm/px) as G2.0 defines them, made with `quality: "fabrication"`.
    - Fills every `GeometryConfig` field of §3, including `resample` (G2.0 policy per mode), `targetPitchUm`, `pitchUm`, `pxBudget`, `deviceClass`, `capped` and `shortPx`.
  - `SBEngine.qualityPair(project, source, deviceClass) → {draft, fabrication}`: both plans, for display before generation.
- Rule (LYR-06): `generate` (G2.10a) takes its raster only from `rasterPlan` for the requested quality. Export always recomputes the fabrication plan for the current revision and device class; a draft plan or its diagnostics never stand in for it.

- [x] **Tests:**
  - `LYR-06 6000×4000 source, sizeBy height 300 mm, no frame → draft 720×480, fabrication 4500×3000 at 100 µm`
  - `LYR-06 draft and fabrication plans differ in quality and raster; both deep-frozen`
  - `PO-LASER-4 same project on mobile (budget 1e6, G2.2b) → 1223×816 at 368 µm, FAB_PITCH_CAPPED info with measured 0.368 / limit 0.1 mm/px` (written against the provisional 4e6 budget as 2446×1631 at 184 µm; retargeted when G2.2b measured 1e6)
  - `PO-LASER-5 800×600 source, 300 mm high → raster 800×600, FAB_EXCEEDS_SOURCE shortPx [3200, 2400]; the draft plan carries no pitch diagnostics`
  - `IMG-05 rotate 90 swaps the sizing axes`
  - `NFR-04 rasterPlan needs only {w, h}` (no pixel buffer is passed or read)
  - `NFR-05 rasterPlan repeatable ×3 and every size field an integer`
- **Commit.**

### Task G2.2b: Large-image benchmark and per-device pixel budgets (PO-LASER-4/9, NFR-03/04, AT-24)

Runs fourth in G2 (Appendix D.4), **before** the rest of the engine, so that every later task is built against a measured pixel budget and not against the provisional one of G2.1.

**Files:**
- Modify: `test/bench.js` (add the `large` stage), `test/fixtures.js` (seeded scalable height fixtures if the existing generators are too small), `js/schema.js` (`limits(deviceClass).fabPxBudget` set to the measured values), `docs/ARCHITECTURE.md` (D6 performance table)
- Create: `docs/perf/large-image.json` (raw results), `docs/perf/LARGE_IMAGE.md` (machine, method, table, decision)

**Workloads** (seeded, 8 layers, 4:3 unless noted; the stages are those that exist after G2.1b):
- pixel counts 4, 9, 12, 16, 20 and 25 Mpx (2309×1732, 3464×2598, 4000×3000, 4618×3464, 5164×3873, 5774×4330);
- the concrete laser case: a 470 mm-high, 3:4 portrait page (352.5 mm wide) at 0.1 mm/px (3525×4700, 16.6 Mpx; the provisional 16 Mpx budget caps it to 102 µm);
- two content families per size: a **realistic** height map (smooth ramps and blobs, tens to hundreds of parts per layer) and the **busy** worst case (`randomNestedStack`-style noise);
- the SRS §12.3 workloads (1536², 8 layers; 768², 6 layers) as calibration rows, so every large result is also expressed as a multiple of the NFR-03 reference.

**Stages measured** (p50/p95/max, plus parts, vertices and peak memory as `process.memoryUsage()` `arrayBuffers + heapUsed` delta, labelled algorithm-owned per SRS §12.3):
1. resample (`area` and `nearest`) from a 16 MP source (G2.0);
2. masks (the existing tonal path `R.sheetMasks`, and a height threshold inline in the bench until G2.3);
3. trace + `SBMaterial.fromMasks` (G1.1), connected smoothing (G1.2);
4. adjacent-pair `difference` (B1 shape) and the support pass (B3b shape: one layer-level `intersection` per adjacent pair, `survivesInset` per piece);
5. `SBSvg.layerSVG` and layer hashing (packaging proxy).

Runs: 5 warm-ups and 30 runs at the candidate budget points (16 Mpx desktop; the chosen mobile point), 1 + 5 runs at the exploration points.

**Method as run — shortened (product owner, 2026-10-08):** the full run was stopped after about 6.5 h as overly thorough. The rows it had completed count as measured data and are taken from their `[large]` summary lines (provenance `log`: `srs-desktop`, `srs-mobile`, `r1`–`r20`, `b4`, `b9`, `b12`, `b16`, each at its default run count). Only the rows still needed were then run live (provenance `live`): realistic 25 Mpx (`r25`) and the realistic 470 mm page (`laser470`), 1 warm-up + 5 runs each. The remaining busy rows (`b20`, `b25`, `laser470-busy`) were skipped. `node test/bench.js large-assemble` builds `docs/perf/large-image.json` from the summary lines and applies the same decision rule. The JSON records `method: "shortened"`, per-row `source` and run counts, the skipped rows and the load samples (background ≈ 3–4 from desktop processes; every p95 includes it). Summary lines carry no per-stage p50/max or vertex counts, so those are `null`. Raw evidence is in `docs/perf/raw/`, and the method is written up in `docs/perf/LARGE_IMAGE.md`.

**Result (2026-10-08):** desktop budget **25 Mpx** at the **10 s** target, not relaxed (`r16` 7.20 s; `r25` 9.75 s, 404 MiB). Mobile budget **1 Mpx**, fabrication enabled (`r1` 1.82 s × k 4 = 7.28 s, 62.6 MiB; k provisional). The SRS desktop reference measures 2.73 s. No escalation, the gate passes, and `FAB_DEVICE_DRAFT_ONLY` is not needed. The busy rows are evidence that cost follows part count, not pixels: 2k–8k parts/layer give 35–163 s bonded at 4–16 Mpx, while realistic art stays near 120 parts/layer. That moves the complexity caps and busy-art simplification forward to **G2.7b**.

**Decision rule** (recorded in `docs/perf/LARGE_IMAGE.md` and D6):
- **Desktop budget** = the largest candidate in {16, 20, 25} Mpx whose estimated working set is ≤ 512 MiB (NFR-04) and whose final-plus-validation p95 (stages 3–4, realistic family) is ≤ the laser-detail target. The target is **10 s** (the NFR-03 final budget) when 16 Mpx meets it. If 16 Mpx does not, the budget stays at 16 Mpx and a **relaxed laser-detail target** is recorded: the measured p95 rounded up to the next 5 s, applying only to fabrication generation of workloads larger than the SRS §12.3 reference (draft stays 1.5 s and the SRS workload keeps 10 s). The busy family is reported, not gated: it is bounded by `COMPLEXITY_LIMIT` (G2.7b, moved from G4.3).
- **Gating mode (product owner, 2026-10-08, option (a)):** every p95 in this rule is the **bonded**-mode final plus validation (the plywood/laser default, D1 unsmoothed). Connected mode is measured and reported per row (`stages.finalConnected`) but never gates: its cost (≈18 s p95 on the SRS desktop reference, dominated by `maxDeviationUm` `segDist`/`distToGrid` and the T-junction split) is the tracked known item **KI-CONN-PERF** (Appendix D.8), resolved in G4 by the G4.1 worker pool and/or smoothing optimisation.
- **Mobile budget** = the largest candidate in {1, 1.25, 1.5, 2, 4, 6, 8} Mpx (rows `r1`, `r1.25`, `r1.5` are 1155×866, 1291×968, 1414×1061) with working set ≤ 192 MiB and p95 ≤ 8 s after scaling by the desktop-to-mobile factor k measured on the SRS mobile workload. Until the recorded ≥ 4 GB device is available (G4.4, AT-24), k = 4 is used and marked provisional. **If no candidate qualifies, mobile fabrication is draft-only** (decided 2026-10-08): the decision records `mobile.fabrication: "draft-only"` and fabrication export is disabled on mobile with a clear diagnostic (`FAB_DEVICE_DRAFT_ONLY`, Appendix D.8); this is recorded, not a stop.
- **Stop and ask the product owner** if 16 Mpx exceeds 512 MiB or if the relaxed desktop target would exceed 60 s. (The former stop on "no mobile candidate ≥ 2 Mpx qualifies" is replaced by the draft-only outcome above.)
- **Machines:** benchmarks run on the Linux development machine (i7-11800H, 16 threads); budgets measured there are conservative for the owner's MacBook Air M5. Safari / JavaScriptCore coverage stays in G4.8.
- The measured part and vertex counts at each budget are recorded as the starting point for the G2.7b complexity caps (moved from G4.3).
- Note (D6): the engine never upsamples, so the IMG-07 source cap bounds the fabrication raster. **Resolved (product owner, 2026-10-08):** the desktop source cap is raised from 16 MP to the measured 25 Mpx desktop budget (`SBSchema.limits("desktop").maxSourcePx === fabPxBudget`); mobile stays 8 MP (Appendix D.6 item 4).

- [x] **Tests (fast, in `node test/run_tests.js`):**
  - `PO-LASER-4 SBSchema.limits budgets equal docs/perf/large-image.json`
  - `PO-LASER-9 bench workload list covers 4–25 Mpx and the 470 mm-high page`
  - `PO-LASER-9 large-image targets recorded for desktop and mobile` (the JSON has a target and a p95 for both)
  - `NFR-03 G2.2b decision gates on bonded mode …` and `NFR-03 G2.2b no mobile candidate qualifies → mobile fabrication recorded as draft-only …` (synthetic rows through `decideLarge` / `gateLarge`)
- [x] **Run** `node test/bench.js large` and record the results (done as the shortened run above; `large-assemble` recorded it); the stage exits 0 only when every gated (bonded) row is within its recorded target; connected overruns are listed as `KNOWN-OVER (tracked)` KI-CONN-PERF.
- **Commit** (budgets, results and the D6 table in one commit).

### Task G2.2: Acknowledgements and the export gate (`SBDiag`, part 2)

**Files:**
- Modify: `js/diag.js`

**Interfaces:**
- Produces:
  - `SBDiag.ackKey(diag, geometryHash) → string`, which is `code|layer|part-or-aggregate|geometryHash`. `geometryHash` includes `quality` and raster size (§3), so acks taken on a draft snapshot never satisfy a fabrication snapshot (LYR-06).
  - `SBDiag.exportGate(diags, acks: Set<string>, snapshot, expectedQuality = "fabrication") → {allowed, reason, blocking: Diagnostic[], unacked: Diagnostic[]}`. A snapshot whose `quality` is not `expectedQuality` is denied with reason `QUALITY_MISMATCH`.
  - `SBDiag.withAckState(diags, acks, geometryHash) → Diagnostic[]` fills `ackState` for display and for `validation.json`.

- [x] **Step 1: Tests**
  - `§9.5 blocking cannot be acknowledged` (`exportGate` still denies)
  - `EXP-07 unacked warning → not allowed`
  - `§9.5 ack invalid after geometryHash change`
  - `EXP-07/LYR-06 draft acks do not satisfy fab gate`
  - `LYR-06 draft snapshot rejected by fabrication gate`
  - `§9.5 one ack covers an aggregated PART_SMALL diagnostic`
- [x] **Step 2–5:** fail, implement, pass, commit.

**Result (2026-10-08):** as specified (commit `1eabaaf`). Aggregated diagnostics (`parts[]`) use `*` in the key, so one ack covers them. `exportGate` reasons are `NO_SNAPSHOT`, `QUALITY_MISMATCH` (the snapshot or any diagnostic off quality), `BLOCKING` and `UNACKED`; severity always comes from the registry, and a stored `ackState` is ignored. 26 checks (the six plan checks plus edge cases).

### Task G2.3: `SBHeight`, nearest-layer quantization and cumulative masks

**Files:**
- Create: `js/height.js` (§4 position: after `jpeg`, before `raster`)

**Interfaces:**
- Produces:
  - `SBHeight.addedFromSamples(samples: Uint8Array, N, polarity: "white-high"|"black-high") → Uint8Array`;
  - `SBHeight.addedFromNorm(h: number, N) → int` (for the AT-03 normalized-boundary vectors);
  - `SBHeight.cumulativeMasks(added, domain: Uint8Array|null, N, w, h) → Uint8Array[]`, where `[0]` is all ones (B) and `[k] = domain ∧ added ≥ k`;
  - `SBHeight.boundaries(N, tMM) → [{k, norm: (k-0.5)/(N-1), mm: k*tMM}]`;
  - `SBHeight.tonalAdded(bandMap, N, darkFront) → Uint8Array` (`N-1-b'`; used by G2.4).

- [x] **Step 1: Tests**

```js
suite("height.js — quantization (D-4.3, AT-03/04)", () => {
  check("AT-03 N=5 h∈{0,.25,.5,.75,1} → added {0..4}", [0, .25, .5, .75, 1].map((h) => SBHeight.addedFromNorm(h, 5)).join() === "0,1,2,3,4");
  check("AT-03 ties .125/.375/.625/.875 go to the higher layer", [.125, .375, .625, .875].map((h) => SBHeight.addedFromNorm(h, 5)).join() === "1,2,3,4");
  check("AT-03 N=1 base only", SBHeight.addedFromNorm(1, 1) === 0);
  check("D-4.3 boundaries exposed", SBHeight.boundaries(5, 6.35).map((b) => b.norm).join() === "0.125,0.375,0.625,0.875");
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  let ok = true; for (let N = 1; N <= 16; N++) { const a = SBHeight.addedFromSamples(s, N, "white-high");
    for (let i = 0; i < 256; i++) if (a[i] !== (N === 1 ? 0 : Math.min(N - 1, Math.floor((N - 1) * (i / 255) + 0.5)))) ok = false; }
  check("D-4.3 integer formula == float definition for all N, all samples", ok);
  check("D-4.3 black-high inverts", SBHeight.addedFromSamples(Uint8Array.of(0), 5, "black-high")[0] === 4);
  const w16 = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(new Uint8Array(12).fill(255), 16, "white-high"), null, 16, 4, 3);
  check("AT-04 white N=16 → 16 identical layers, no NaN", w16.length === 16 && w16.every((m) => m.every((v) => v === 1)));
  const b = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(new Uint8Array(12), 5, "white-high"), null, 5, 4, 3);
  check("AT-04 black → base only", b[0].every((v) => v) && b.slice(1).every((m) => m.every((v) => !v)));
  const mid = SBHeight.addedFromSamples(new Uint8Array(12).fill(128), 5, "white-high");
  check("AT-04 constant midpoint map stays constant", mid.every((v) => v === mid[0]));
  const dom = Uint8Array.from([1, 0, 1, 0]);
  const dm = SBHeight.cumulativeMasks(Uint8Array.from([4, 4, 4, 4]), dom, 5, 4, 1);
  check("IMG-04/AT-05 outside A only base", dm[0].every((v) => v) && dm[4].join() === "1,0,1,0");
});
```

- [x] **Step 2: Run** and confirm it fails.
- [x] **Step 3: Implement**

The integer rule was verified against the float definition for every N in 1..16 and every s in 0..255 while writing this plan.

```js
(function (global) {
  "use strict";
  const Hh = {};
  Hh.addedFromNorm = (h, N) => (N <= 1 ? 0 : Math.min(N - 1, Math.floor((N - 1) * h + 0.5)));
  Hh.addedFromSamples = function (samples, N, polarity) {
    const out = new Uint8Array(samples.length); if (N <= 1) return out;
    const inv = polarity === "black-high";
    for (let i = 0; i < samples.length; i++) {
      const s = inv ? 255 - samples[i] : samples[i];
      out[i] = Math.min(N - 1, Math.floor((2 * (N - 1) * s + 255) / 510)); // == floor((N-1)*s/255 + 0.5), exact
    }
    return out;
  };
  Hh.tonalAdded = function (bandMap, N, darkFront) {
    const out = new Uint8Array(bandMap.length);
    for (let i = 0; i < bandMap.length; i++) { const b = darkFront ? bandMap[i] : N - 1 - bandMap[i]; out[i] = N - 1 - b; }
    return out;
  };
  Hh.cumulativeMasks = function (added, domain, N, w, h) {
    const ms = [new Uint8Array(w * h).fill(1)];
    for (let k = 1; k < N; k++) { const m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) m[i] = (!domain || domain[i]) && added[i] >= k ? 1 : 0; ms.push(m); }
    return ms;
  };
  Hh.boundaries = (N, tMM) => Array.from({ length: Math.max(0, N - 1) }, (_, i) => ({ k: i + 1, norm: (i + 0.5) / (N - 1), mm: (i + 1) * tMM }));
  global.SBHeight = Hh;
})(typeof window !== "undefined" ? window : globalThis);
```

- [x] **Step 4: Run** and confirm the tests pass. **Commit.**

**Result (2026-10-08):** as specified (commit `35316a1`); `js/height.js` sits after `jpeg.js`, before `raster.js` in all four module lists. `tonalAdded` + `cumulativeMasks` reproduce `SBRaster.sheetMasks` byte for byte (N 1..16, both fronts), and `test/bench.js large` takes its height masks from `SBHeight` (identical masks). 10 plan checks plus 12 extended.

### Task G2.4: Tonal path behind the same interface; manual thresholds; domain-aware statistics

**Files:**
- Modify: `js/raster.js:24-164`

**Interfaces:**
- Produces:
  - `SBRaster.thresholds(L, N, mode, {manual?, domain?})`. `mode` now also accepts `"manual"`: manual values are normalized 0..1 and multiplied by 255. The histogram and percentiles use **only pixels in `domain`** when it is given (IMG-04). The result carries `emptyBands: number[]`, the band indices with no in-domain pixels.
  - `SBRaster.kuwahara(L, w, h, r, passes, domain?)`. With `domain` given, it samples only in-domain neighbours and leaves out-of-domain pixels unchanged.
  - `SBRaster.sheetMasks` is reimplemented as `SBHeight.cumulativeMasks(SBHeight.tonalAdded(bandMap, N, darkFront), null, N, w, h)`.
  - With `domain` null, every output is identical to v1.1.0, as the persisted golden pins.

- [x] **Step 1: Tests**
  - `DEP-04/AT-21 thresholds + sheetMasks match persisted v1.1.0 golden (24 configs)`. This is the T0.4 check; it now exercises the new code against the literal hashes in `test/golden/sheetmasks.json`.
  - `LYR-03 manual thresholds honored`
  - `IMG-06 flat 128 image N=5 balanced: thresholds finite and emptyBands.length === 4`. This fails before the change, because `emptyBands` is undefined.
  - `AT-04 duplicate tonal thresholds → emptyBands non-empty`
  - `IMG-04 tonal thresholds unchanged when out-of-domain pixels are altered`
  - `IMG-04 kuwahara: in-domain output unchanged when out-of-domain pixels are altered`
- [x] **Step 2–5:** fail, implement, pass, commit.

**Result (2026-10-08):** as specified (commit `b7f8c64`). Manual thresholds take N−1 non-decreasing values in [0, 1] (`THRESHOLD_ORDER`, `THRESHOLD_ARG`); an unrecognised mode keeps the v1.1.0 balanced fallback. With `domain` null, thresholds and `sheetMasks` match the persisted v1.1.0 golden (24 configs) and the `legacyRun` golden. 20 checks.

### Task G2.4b: Legacy settings adapter (pure) (DEP-04, AT-21; pulled forward from G3.8)

**Files:**
- Modify: `js/schema.js` (add `fromLegacySettings`, `resolveLegacy`)

**Interfaces:**
- Produces:
  - `SBSchema.fromLegacySettings(json) → {project, diagnostics}`. Mapping:

| Legacy key | Project field |
|---|---|
| `projectName` | `title` |
| `sourceName` | `extras.legacy.sourceName` |
| `procRes` | `extras.legacy.procRes`; `geometry.fabPitchMM` set by `resolveLegacy` |
| `smoothRadius` / `smoothPasses` | `interpretation.smoothing.{radius, passes}` |
| `nSheets` | `construction.sheets` |
| `thresholdMode` | `interpretation.thresholdRule` |
| `darkFront` | `polarity`: dark-front or light-front |
| `palette` | `appearance.palette`, with `appearance.mode = "palette"` |
| `widthMM` | `geometry.widthMM`, with `sizeBy: "width"` and `targetMM` = page width |
| `marginMM` | `frame: {enabled: > 0, widthMM}` |
| `minFeatureMM` / `bridgeMM` / `cullBelowMM2` / `maxBridgeMM` | `cleanup` / `bridge` |
| `holes` / `holeDiaMM` | `registration` |
| `cornerStyle` | `cleanup.cornerStyle` (`faceted` → `sharp`) |
| `detailEps` (px) | `extras.legacy.detailEps`; resolved later |

    In addition, `interpretation.mode = "tonal"` and `construction.mode = "connected-sheet"`. `geometry.heightMM` is `null`, which raises `LEGACY_NEEDS_SOURCE` (blocking). The whole original JSON is kept in `extras.legacy`. `machine` gets the app default profile (`SBSchema.MACHINES["xtool-s1-feeder"]`), so an oversized legacy piece is reported by the envelope check, never rescaled.
  - `SBSchema.resolveLegacy(project, srcW, srcH) → project`. It sets `heightMM` from the source aspect, `fabPitchMM` = the legacy pitch `longSideMM / procRes` quantized to 0.001 mm (so a v1.1.0 project keeps its resolution instead of jumping to 0.1 mm/px), and `toleranceMM = max(0.05, detailEps × widthMM / round(srcW·procRes/max(srcW, srcH)))`, which uses the real working width for portrait sources too.
- The AT-21 guarantee is **same bands, polarity and connected semantics**. It is not byte-identical masks end to end, because v1.1.0 resampled twice on a canvas (the 2000 px pre-cap, then `procRes`). The CHANGELOG records this.

- [x] **Tests:**
  - `DEP-04 every settingsJSON key (app.js:364-374) is mapped or kept in extras`
  - `AT-21 legacy settings + fixed luminance input → masks equal the persisted golden` (via the engine tonal path with `resample: "none"`)
  - `DEP-04 heightMM null → LEGACY_NEEDS_SOURCE until resolveLegacy`
  - `DEP-04 portrait source: toleranceMM uses real working width`
  - `DEP-04/PO-LASER-4 legacy procRes 720, 300 × 200 mm → sizeBy width, fabPitchMM 0.417`
  - `DEP-04 legacy JSON preserved in extras`
- [x] **Commit.**

**Result (2026-10-08):** as specified (commit `8fffc44`). The whole legacy JSON is kept in `extras.legacy`; missing keys take the v1.1.0 defaults; the default machine profile is applied and nothing is rescaled; a non-object input throws `SCHEMA_LEGACY`. `LEGACY_NEEDS_SOURCE` comes from `SBSchema.legacyDiagnostics`. `resolveLegacy` sets `toleranceMM = max(0.05, detailEps × width / real working width)`. 21 checks.

### Task G2.5: Domain mask and orientation (IMG-04/05)

**Files:**
- Modify: `js/height.js` (add `domainMask`), `js/engine.js` (add `orient`)

**Interfaces:**
- Produces:
  - `SBHeight.domainMask(alpha: Uint8Array|null, mode, t=0.5) → Uint8Array|null`, where `alpha ≥ round(t*255)` means the pixel is inside A;
  - `SBEngine.orient({samples, alpha, w, h}, {exif, exifAppliedBy, rotate, mirror}) → {samples, alpha, w, h}`. It applies the EXIF orientation only when `exifAppliedBy === "engine"` (the raw PNG path), then the user rotate and mirror. It runs exactly once, before interpretation.

- [x] **Tests:**
  - `IMG-04 alpha 0.5 threshold defines A`
  - `AT-05 rotate 90 + mirror: orientationF corner lands at the expected corner in material, proof and parsed SVG`, run through the G1.4/G1.5 helpers
  - `IMG-05 EXIF 6 applied once on the engine path` (orientationF with `exif: 6` equals `rotate: 90`)
  - `IMG-05 browser-applied EXIF is not applied again` (`exifAppliedBy: "browser"` → identity)
  - `IMG-05 rotate applied once` (identity is idempotent)
  - Browser harness (G4.8): an EXIF=6 JPEG decodes with swapped dimensions and is not rotated again. *(Open; lands with G4.8.)*
- [x] **Commit.**

**Result (2026-10-08):** as specified (commit `19bf426`). `orient` composes EXIF (engine route only), clockwise rotate and left-right mirror into one integer pixel map, moves alpha with the samples, and marks the result oriented; a second `orient` is refused (`ORIENT_TWICE`). `rasterPlan`'s oriented size uses the same transform. 25 checks; the browser-harness case stays open for G4.8.

### Task G2.5b: Explicit height filter/remap (IMG-03, AT-02)

**Files:**
- Modify: `js/height.js` (add `applyFilter`)

**Interfaces:**
- Produces `SBHeight.applyFilter(samples, w, h, filter: {op: "median"|"box"|"remap", radius?, lut?}) → Uint8Array`. It is integer-only and deterministic.
- `interpretation.heightFilter` is `null` by default. Setting it is a geometry change: it is an undo-history entry (G3.6), it is in `geometryKey`, it is recorded in the manifest, and it emits `HEIGHT_FILTERED` (info).

- Implementation notes (as built):
  - `applyFilter` takes an optional fifth argument `domain` (IMG-04, same rule as the domain-aware Kuwahara of G2.4): only in-domain neighbours are sampled and out-of-domain pixels are copied unchanged. Windows are clipped to the image (no edge replication). `median` is the lower median, `(n−1)>>1`-th order statistic; `box` is `floor((2·sum + n) / 2n)` (half up). Bad arguments throw `FILTER_ARG`.
  - The height interpretation stage is `SBEngine.interpretHeight(samples, w, h, interpretation, N, domain, {quality, revision}) → {added, diagnostics}`: `applyFilter` only when `heightFilter` is set (then `HEIGHT_FILTERED`), then `addedFromSamples` with the polarity. G2.10a stage 4 (height) calls it. Undo history (G3.6) and the manifest record (G3.9) land with those tasks; `geometryKey` already carries `interpretation.heightFilter`.
- [x] **Tests:**
  - `IMG-03 height mode does not smooth unless heightFilter is set` (spy: no kuwahara, thresholds or applyFilter call when null)
  - `AT-02 smoothing enabled is recorded as an explicit change` (`geometryKey` hash changes, and `HEIGHT_FILTERED` is present)
  - `IMG-03 remap LUT applied exactly`
  - plus oracle checks for median/box (r = 1..4 and clamped r = 50), the domain rule, determinism and `FILTER_ARG`.
- [x] **Commit.**

**Result (2026-10-08):** as specified, see the implementation notes above (commit `0609d4e`). 22 checks.

### Task G2.6: Construction strategies (`SBConstruct`)

**Files:**
- Create: `js/construct.js` (§4 position)
- Modify: `js/engine.js` (`legacyRun` delegates to `SBConstruct.connected`)

**Interfaces:**
- Produces `SBConstruct.connected(masks, w, h, px)` and `SBConstruct.bonded(masks, w, h, px)`. Both return `{final: Uint8Array[], bridges: (Uint8Array|null)[], report: [{layer, addedPx, removedPx, filledHoles, removedParts}]}`. The engine converts the report to mm² using `sxUm·syUm` (GEO-08).
- `px = {featR, bridgeR, cullPx, maxBridgePx, speckPx, holePx, frameAnchored, cullEnabled}`.
- **Bonded never calls `SBIslands.resolve`.** It runs the same per-layer `open → close → fillHoles` chain as connected; `removeSpecks` runs only when `cullEnabled` is set (SUP-01: culling is explicit). That chain preserves nesting (verified in T0.4), so bonded morphology never creates an overhang. Bonded applies **no** clip.

- Implementation notes (as built):
  - `featR` 0 disables both opening and closing; for `featR ≥ 1` the closing radius is `max(1, featR − 1)` (the v1.1.0 rule), so `connected` with `legacyRun`'s parameters is byte-identical to the v1.1.0 chain (`test/golden/oldrun.json` stays green). `connected` always runs `removeSpecks` (as v1.1.0 did); `cullEnabled` gates it only in bonded mode.
  - Layer 0 (the base) is passed through as a copy with an all-zero report entry; `bridges[0]` is `null` in both strategies and every bonded `bridges[k]` is `null`.
  - Connected report entries also carry `bridged` and `culled` (the islands counts; `removedParts` = specks + culled), which `legacyRun` reads for its totals. Inputs are never mutated. Bad arguments throw `CONSTRUCT_ARG`.
  - `construct.js` is registered in the four lists between `trace` and `material` (§4).
- [x] **Step 1: Tests**

```js
suite("construct.js — strategies (SUP-01/06, GEO-07, GEO-08)", () => {
  const F = require("./fixtures.js"), lb = F.MASKS.looseBridge;
  const px = { featR: 0, bridgeR: 0.6, cullPx: 0, maxBridgePx: 10, speckPx: 0, holePx: 0, frameAnchored: true, cullEnabled: false };
  const orig = SBIslands.resolve; let called = 0; SBIslands.resolve = (...a) => (called++, orig(...a));
  const b = SBConstruct.bonded(lb.layers, lb.w, lb.h, px);
  check("SUP-01 islands.resolve not called in bonded", called === 0);
  check("SUP-01 bonded keeps disconnected loose part", SBMorph.components(b.final[2], lb.w, lb.h).count === 2);
  check("GEO-07 (bridge) FIXED: bonded adds no material outside layer k-1", b.final[2].every((v, i) => !v || b.final[1][i]));
  const c = SBConstruct.connected(lb.layers, lb.w, lb.h, px);
  SBIslands.resolve = orig;
  check("SUP-01 FIXED: only connected mode bridges", called > 0 && c.report[2].addedPx > 0);
  check("GEO-08 cleanup report sums match mask diff", b.report.every((r, k) => k === 0 ||
    r.addedPx - r.removedPx === b.final[k].reduce((a, v) => a + v, 0) - lb.layers[k].reduce((a, v) => a + v, 0)));
  let nested = true;
  for (let s = 1; s <= 200; s++) { const st = F.randomNestedStack(F.lcg(s), 40, 30, 5);
    for (const featR of [1, 3]) { const r = SBConstruct.bonded(st, 40, 30, { ...px, featR, holePx: 8 * featR * featR });
      for (let k = 2; k < r.final.length; k++) if (r.final[k].some((v, i) => v && !r.final[k - 1][i])) nested = false; } }
  check("D-4.5 property: bonded morphology keeps nesting (200 seeds, featR 1 and 3)", nested);
});
```

Delete the T0.4 `KNOWN-DEFECT SUP-01` and `KNOWN-DEFECT GEO-07 (bridge)` checks; they are replaced by the FIXED variants above.

- [x] **Step 2–5:** fail, implement, pass, commit. Plus an extended suite: shape and purity, explicit bonded culling, hole-fill report, connected == the v1.1.0 chain (40 seeds × featR 1, 3) and `CONSTRUCT_ARG`.

**Result (2026-10-08):** as specified (commit `28c403e`). `connected` is the v1.1.0 per-sheet chain, byte-identical, and `legacyRun` delegates to it (oldrun golden unchanged). `bonded` runs open → close → fillHoles, `removeSpecks` only with `cullEnabled`, and never calls `SBIslands.resolve` or clips (SUP-01, GEO-07). Both return `{final, bridges, report}` with a per-layer pixel cleanup report for GEO-08. The T0.4 `KNOWN-DEFECT` checks are replaced by FIXED checks. 6 plan checks plus 14 extended.

### Task G2.7: `SBSupport.validate`: containment, support graph and empty-layer rules on final polygons

**Files:**
- Create: `js/support.js`

**Interfaces:**
- Consumes: `SBGeom.difference`, `intersection`, `classifyContact` / `survivesInset` (D3), `area`, `isEmpty`, `bbox`; `SBDiag.make`, `aggregate`.
- Produces:
  - `SBSupport.validate(layers: MaterialLayer[], mode, cfg) → {diagnostics, supportGraph: {edges: [{layer, part, supports: [{layer, part, areaUm2}]}], reachesBase: boolean}}`.
  - Bonded rules:
    - `unsupported(k) = difference(Final[k], Final[k−1])`; a non-empty result gives `BOND_UNSUPPORTED` (blocking), with `areaMM2`, `region`, `measured` (area) and `limit` (0).
    - Candidate support pairs are found by a **bbox sort-and-sweep**; only overlapping pairs are intersected.
    - Lower part q supports upper part p iff the contact `I = intersection(p, q)` has width w = 2·r\* **≥ 0.5 µm**, i.e. `SBGeom.survivesInset(I, 0.25)` (D3; empty, line and point contact do not count). `SUPPORT_NARROW` (warning) if w < `minFeatureUm`, i.e. `!SBGeom.survivesInset(I, minFeatureUm/2)` with `minFeatureUm = Math.round(minFeatureMM·1000)` rounded **before** halving. Use `SBGeom.classifyContact(I, minFeatureUm)` (`block | warn | ok`). "Survives" is certified by an exact witness; `undecided` counts as not surviving. **Never** test this with `SBGeom.offset`, which refuses sub-µm deltas (S5 F4).
    - **Advisory tier (PO-LASER-6):** a contact that passes `SUPPORT_NARROW` but has w < `advisoryFeatureUm` (`!SBGeom.survivesInset(I, advisoryFeatureUm/2)`, same rounding rule; default 2.0 mm) gives `FEATURE_MARGINAL` (warning, `detail.kind: "contact"`). With the plywood defaults this is: block below 0.5 µm, `SUPPORT_NARROW` below 1.5 mm, `FEATURE_MARGINAL` below 2.0 mm.
    - Every part's support path must reach layer 0.
    - An empty layer under a non-empty one gives `BOND_EMPTY_UNDER`.
    - Identical consecutive layers give `IDENTICAL_LAYERS` (info).
  - Connected rules: each non-empty layer with more than one component gives `CONNECTED_SPLIT` (blocking).

- Implementation notes (as built, 2026-10-08):
  - `cfg = {minFeatureMM (bonded: required), advisoryFeatureMM? (≥ minFeatureMM; absent = no advisory tier), revision, quality, unsupported?, graphOnly?}`. `unsupported[k]` hands over precomputed `Final[k] − Final[k−1]` (the B1 differences); `graphOnly` skips containment and empty-layer checks. Bad arguments throw `SUPPORT_ARG`. Inputs are never mutated; diagnostics come in layer order through `SBDiag.aggregate`.
  - The one boolean per adjacent pair is `intersection(Final[k], Final[k−1])`, or `Final[k] − U` when the containment difference U is at hand. That is `Final[k]` itself when U is empty, so the normal bonded case needs no boolean at all.
  - Pieces are classified widest-first through `SBGeom.insetStatus`: advisory inset, then `minFeatureUm/2`, then 0.25 µm. The thresholds and certification are those of `classifyContact` / `survivesInset`, and a bbox/area pre-filter skips insets that cannot survive. The certified witness also breaks bbox-sweep ties in attribution. Per (upper, lower) pair the widest piece decides; `SUPPORT_NARROW` and `FEATURE_MARGINAL` are emitted per pair on the upper part, with the lower part named in the message.
  - `BOND_UNSUPPORTED` is per layer (area, bbox region, measured area, limit 0 mm²). A part with no support although containment held is reported per part. `BOND_EMPTY_UNDER` is reported on each empty layer that has a non-empty layer above it. `IDENTICAL_LAYERS` compares normalized material (bonded only). In connected mode the graph is empty and `reachesBase` is true.
  - `SBDiag`: `FEATURE_MARGINAL` is registered (warning, fabrication) and aggregated like `PART_THIN`. `make()` accepts `detail: {kind, text?}`, which sets `d.detail = {kind}`, enters the id, and splits aggregation groups per kind.
  - `SBSupport.annotate(layers, supportGraph)` rewrites `Part.supports[]` to part IDs (§3).
  - B3b performance required amendments to `SBGeom.insetStatus` (ARCHITECTURE D3, "G2.7 amendments"): a scale-free quick witness, an erosion failure certificate (no trig) that leaves no undecided L- and plus-shapes, failure certificates before the witness insets, a float filter in the exact witness check, and an early stop in `refine`. Verdict semantics are unchanged.
  - Test deviations: `mk` takes the pitch from `st.mmPerPx` (default 1), because `stripOnBase` is drawn at 0.1 mm/px. The GEO-07 check repeats the crescent as layer 2 and grows that layer. The plan's version grows layer 1 of the 2-layer `crescentInterior`, which stays inside the full base, so it would pass only through stale part data. The aggregated `FEATURE_MARGINAL` carries `parts[]` rather than `part`.
  - `node test/bench.js support` runs B3 and B3b. Results (loaded machine, 1-min load 8–9): **B3b p95 1.32 s** (3,407 pairs), B3 2.9 ms; `docs/perf/SUPPORT.md`, `docs/perf/support.json`. The B3b budget in `bench geom` is 3 s, and the provisional entry is removed. `bench large` times `SBSupport.validate` in its support slot. The G2.2b large rows were not re-run here, because the long benchmark was out of scope; G2.7b records their support p95.

- [x] **Step 1: Tests**

```js
suite("support.js — final validation (D-4.5, SUP-02/03, GEO-07, AT-08/09)", () => {
  const F = require("./fixtures.js");
  const mk = (st) => SBMaterial.assignParts(SBMaterial.fromMasks(st.layers, st.w, st.h, { artWMM: st.w, artHMM: st.h, frameMM: 0 }, {}));
  const codes = (r) => r.diagnostics.map((d) => d.code);
  const hole = SBSupport.validate(mk(F.MASKS.lowerHoleUnderPart), "bonded-relief", { minFeatureMM: 3 });
  check("AT-08 part over lower hole → BOND_UNSUPPORTED blocking", codes(hole).includes("BOND_UNSUPPORTED"));
  const d0 = hole.diagnostics.find((d) => d.code === "BOND_UNSUPPORTED");
  check("AT-08 measured unsupported area (1 mm² ±1%) with measured/limit fields", Math.abs(d0.areaMM2 - 1) <= 0.01 && d0.measured && d0.limit);
  const empty = SBSupport.validate(mk(F.MASKS.emptyIntermediate), "bonded-relief", { minFeatureMM: 3 });
  check("D-4.7 empty under non-empty blocks", codes(empty).includes("BOND_EMPTY_UNDER"));
  const donut = SBSupport.validate(mk(F.MASKS.donutIsland), "bonded-relief", { minFeatureMM: 0.5 });
  check("AT-08 fully supported loose island accepted without bridge", !codes(donut).includes("BOND_UNSUPPORTED") && donut.supportGraph.reachesBase);
  // GEO-07: masks nested but polygons are not (interior fixture; miter offset is deterministic)
  const nested = mk(F.MASKS.crescentInterior); const grown = JSON.parse(JSON.stringify(nested));
  grown[1].material = SBGeom.offset(grown[1].material, 300, "miter");
  check("GEO-07 interior overhang caught on polygons although masks nested", codes(SBSupport.validate(grown, "bonded-relief", { minFeatureMM: 0.5 })).includes("BOND_UNSUPPORTED"));
  const diag = SBSupport.validate(mk({ ...F.MASKS.diagonalTouch, layers: [F.MASKS.diagonalTouch.layers[0], F.MASKS.diagonalTouch.layers[1]] }), "connected-sheet", {});
  check("GEO-02 diagonal-only contact → CONNECTED_SPLIT in connected mode", codes(diag).includes("CONNECTED_SPLIT"));
  // D3 width thresholds on the contact itself (exactly as pinned in suite "spike S5 — finite-width contact")
  const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] }), lo = [sq(0, 0, 10000, 10000)];
  check("D3 1 µm axis overlap is support (w ≥ 0.5 µm) but SUPPORT_NARROW for minFeature 3 mm", SBGeom.classifyContact(SBGeom.intersection([sq(9999, 0, 20000, 10000)], lo), 3000).level === "warn");
  check("D3 3000 µm overlap with minFeature 3 mm → no SUPPORT_NARROW (tie passes)", SBGeom.classifyContact(SBGeom.intersection([sq(7000, 0, 20000, 10000)], lo), 3000).level === "ok");
  // PO-LASER-6 plywood defaults: 1.5 mm minimum, 2.0 mm advisory. New fixture F.MASKS.stripOnBase(widthMM): a 2-layer stack at 0.1 mm/px
  // whose upper part overlaps the lower one by a strip of the given width (added to test/fixtures.js in this task).
  const strip = (w) => SBSupport.validate(mk(F.MASKS.stripOnBase(w)), "bonded-relief", { minFeatureMM: 1.5, advisoryFeatureMM: 2 });
  check("PO-LASER-6 1.4 mm contact → SUPPORT_NARROW", codes(strip(1.4)).includes("SUPPORT_NARROW"));
  check("PO-LASER-6 1.8 mm contact → FEATURE_MARGINAL, no SUPPORT_NARROW", codes(strip(1.8)).includes("FEATURE_MARGINAL") && !codes(strip(1.8)).includes("SUPPORT_NARROW"));
  check("PO-LASER-6 2.0 mm contact → neither (tie passes)", !codes(strip(2.0)).some((c) => c === "SUPPORT_NARROW" || c === "FEATURE_MARGINAL"));
});
```

The end-to-end AT-09 smoothing case runs through `SBEngine.generate` in G2.10a.

- [x] **Step 2: Property tests** (seeded)

```js
  const rng = F.lcg(7); let allClean = true;
  for (let t = 0; t < 50; t++) { const st = F.randomNestedStack(rng, 24, 18, 5);
    const fin = SBConstruct.bonded(st, 24, 18, { featR: 1, bridgeR: 0, cullPx: 0, maxBridgePx: 0, speckPx: 0, holePx: 8, frameAnchored: false, cullEnabled: false }).final;
    if (SBSupport.validate(SBMaterial.fromMasks(fin, 24, 18, { artWMM: 24, artHMM: 18, frameMM: 0 }, {}), "bonded-relief", { minFeatureMM: 0.01 })
      .diagnostics.some((d) => d.code === "BOND_UNSUPPORTED")) allClean = false; }
  check("D-4.5 property: bonded(nested stack, featR 1) never reports unsupported (50 seeds)", allClean);
```

- [x] **Step 3: Benchmark hook**

Add `test/bench.js support`, which runs on `randomNestedStack(lcg(1), 1536, 1024, 8)`. Record p95 in `docs/perf/` now; do not wait for G4.4.

**B3b budget (required for G2.7 exit; D2, Appendix C):** `test/bench.js geom` B3b, the support pass on the dense B1 stack (3,407 pairs), must reach **p95 < 3 s** (the B3 budget; provisional < 6 s until now). The pass computes **one layer-level `intersection` per adjacent layer pair**, attributes the pieces to parts by bbox sweep, and classifies each piece with `SBGeom.survivesInset` / `classifyContact` (never per part pair: 39 s; never `SBGeom.offset`). It skips the containment `difference` when only the graph is needed and reuses the B1 differences. When B3b passes, remove its provisional entry. The support stage is also run on the G2.2b large workloads and its p95 is recorded next to the PO-LASER-9 targets.
- [x] **Step 4–5:** run (fail), implement, run (pass), commit. Plus an extended suite: support graph and the per-part-pair oracle, the advisory tier and rounding, reuse and graphOnly, determinism, annotate, `SUPPORT_ARG`, and the `bench support` smoke test.

**Result (2026-10-08):** as specified, see the implementation notes above (commit `8172d1a`): B3b p95 **1.32 s** (3,407 pairs, under the 3 s budget), B3 2.9 ms; `SBGeom.insetStatus` amended (ARCHITECTURE D3). 12 plan checks plus 22 extended and the bench smoke check.

### Task G2.7b: Complexity caps and busy-art simplification (§12.3, NFR-03/04, PO-LASER-9; moved from G4.3, 2026-10-08)

Runs right after G2.7 (Appendix D.4, D.9). **Why:** G2.2b showed that the pixel budget bounds realistic art but not busy art. At the same pixel count, busy art costs 10.7× (4 Mpx) to 22.7× (16 Mpx) the realistic row: 2k–8k parts/layer give 35–163 s bonded, and `b9` reaches 706 MiB. Realistic art stays near 120 parts/layer and under 10 s up to 25 Mpx. Part count, not pixels, has to be bounded, and it has to be bounded before G2.10a builds the pipeline that enforces it.

**Files:**
- Modify: `js/schema.js` (`limits(deviceClass)` gains the caps; the simplification setting in `material.cleanup`), `js/construct.js` (the pre-trace estimate and the simplification pass on masks), `js/diag.js` (the `COMPLEXITY_LIMIT` payload; one info code for applied simplification), `test/bench.js` (`large` records vertex counts and runs the busy rows with simplification), `docs/perf/LARGE_IMAGE.md`, D6 table
- Test: `test/run_tests.js`

**Interfaces:**
- `SBSchema.limits(deviceClass)` → adds `maxPartsPerLayer`, `maxVerticesPerLayer`, `maxVerticesTotal`. Mobile starts at the SRS §12.3 values (100 parts/layer, 20,000 vertices; SRS:L562). Desktop is set by measurement in this task: the largest caps at which the capped busy workload at the desktop budget meets the 10 s bonded target and 512 MiB. The G2.2b starting point (`decision.complexityStart`): realistic art at the budgets peaks at 120 parts/layer, and busy art at 1,991 parts/layer already takes 35 s, so the desktop cap lies well below 2k parts/layer. Vertex counts were not recorded by the shortened G2.2b run, and this task measures them.
- `SBConstruct.estimateComplexity(masks, w, h) → {partsPerLayer[], maxPartsPerLayer}`: a connected-component count per layer on the masks, O(w·h). It runs before trace, so a cap fails before the expensive boolean stages. Vertex caps are checked after `fromMasks`, before validation.
- **Simplification (explicit, never silent; NFR-04, R5):** `material.cleanup.simplify: "off" | "busy"` (default `"off"`; in `geometryKey`). `"busy"` drops parts below the minimum part area (`minPartMM2`) and merges parts closer than the minimum feature width (mask closing at `minFeatureUm/2`), then re-estimates. The result is reported as an info diagnostic with the before/after part counts per layer. Draft and fabrication apply the same rule at their own pitch, and the diagnostics carry the quality (LYR-06).
- **Diagnostics:** over a cap → `COMPLEXITY_LIMIT` (blocking, process) with `measured` (parts or vertices), `limit`, the layer and the device class. Its fix text offers "Simplify busy art" and the existing cleanup controls. No truncated geometry is ever returned (§12.3, SRS:L564). G2.10a stage 11 consumes these caps unchanged.

- [x] **Tests (fast):**
  - `§12.3 mobile caps 100 parts / 20k vertices` (moved from G4.3)
  - `§12.3 estimateComplexity counts components per layer before trace (equals fromMasks part count on fixtures)`
  - `§12.3 busy fixture over the desktop cap → COMPLEXITY_LIMIT (blocking, measured/limit/layer/device class), no layers`
  - `NFR-04 simplify "busy" is explicit: off by default, in geometryKey, reported with before/after counts`
  - `NFR-05 simplify "busy" is deterministic (hashes ×3)`
- [x] **Bench:** `node test/bench.js large --only b4,b9,r25 …` with the caps and with `simplify: "busy"`. Record vertex counts and the capped busy p95 next to the PO-LASER-9 targets. The G4.1 worker pool remains the other mitigation and is not required here.
- [x] **Commit** (caps, simplification, results).

**Result (2026-10-08; `docs/perf/LARGE_IMAGE.md` "G2.7b", `docs/perf/complexity.json`, ARCHITECTURE D6 item 13):**
- **Caps.** Desktop **258 parts/layer, 132,000 vertices/layer, 356,000 vertices** were measured by the new stage `node test/bench.js caps`. It runs busy art at the 25 Mpx budget with larger noise cells, plus realistic `r25`, bonded only, 1 + 5 runs, with the pre-trace estimate in the timed pass. `c208` (258 parts) measures 9.64 s; `c192` (309 parts) misses with 10.21 s. The vertex caps admit every passing row and `r25` (182,556). Mobile uses the SRS values **100 / 20,000 / 20,000**. `decideCaps` reproduces the recorded decision, and a test keeps `SBSchema.limits` equal to it.
- **API.** `SBConstruct.estimateComplexity` (run-length union-find: 0.15 s on realistic and 0.6 s on busy masks at 25 Mpx × 8), `SBConstruct.simplifyBusy`, `SBConstruct.complexityGate` (simplify, then the parts cap) and `SBConstruct.vertexGate` (after `fromMasks`). Both gates return `status: "error"` with no masks or layers. `SBDiag.make` accepts `deviceClass` and `counts`. `BUSY_SIMPLIFIED` (info, process) is new, and the `COMPLEXITY_LIMIT` fix text offers "Simplify busy art".
- **Bench.** With `--caps desktop`, `b4` and `b9` fail with `COMPLEXITY_LIMIT` in 113 ms and 321 ms, and `r25` passes in 7.61 s. With `--simplify busy`, `b4` goes from 1,991 to 85 parts/layer and runs in 3.70 s, `b9` goes from 4,603 to 211 and runs in 8.08 s, and `r25` goes from 120 to 64 and runs in 14.18 s. Simplification costs about 5.5 s at 25 Mpx (reported, not gated; G4.1). Support p95 on the large rows is 87–107 ms (`r25`) and 0.4–0.95 s (busy at 176–340 parts).
- **Deviations.** (1) The setting lives in `construction.cleanup.simplify`; the plan text said `material.cleanup`, which does not exist (`cleanup` is under `construction`). Plan §3 and ARCHITECTURE §3 are updated. (2) The 512 MiB rule for the caps is applied to a **live-set** pass (`gc()` before each stage-boundary sample). The G2.2b peak with uncollected garbage is recorded beside it, but it varies by up to 250 MiB between rows, independent of part count. (3) The desktop caps come from 1 + 5 runs per row on a loaded machine (load 6–9), not 5 + 30. (4) `large` variant rows (`--caps`, `--simplify`, `--bonded-only`) are written to `complexity.json` `variantRows` and never to `large-image.json`, so the G2.2b decision stays reproducible. (5) The closing in `simplifyBusy` is a separable O(w·h) square closing on a padded copy, tested equal to `SBMorph.close`; iterating SBMorph's 3×3 passes would take about 100 s at 25 Mpx.
- **Mobile vertex cap — decided (product owner, 2026-10-08):** the SRS mobile vertex cap (20,000) is **kept**, and mobile is limited to simpler art. Realistic art at the 1 Mpx mobile budget has 31,944 vertices after bonded construction (the SRS 768² size has 25,588), because bonded contours are unsmoothed staircases (D1), so once G2.10a enforces the caps a mobile user with typical art sees `COMPLEXITY_LIMIT`. On mobile its message adds "mobile is limited to simpler art, so simplify it or open the project on a desktop" (`SBConstruct.complexityGate` / `vertexGate`; test `§12.3 mobile COMPLEXITY_LIMIT message says mobile is limited to simpler art and points to desktop`). No new feature; G4.3/G4.4 re-check the caps on the reference device. See ARCHITECTURE D6 item 13.

### Task G2.8: Feature and sampling checks (GEO-05/06, MAT-03, AT-10)

**Files:**
- Modify: `js/support.js` (add `featureChecks`)

**Interfaces:**
- Produces `SBSupport.featureChecks(layers, {minFeatureMM, advisoryFeatureMM, minPartMM2, mmPerPxMax, calibrated}) → Diagnostic[]` (aggregated per layer):
  - `SAMPLING_LOW` (blocking) when `minFeatureMM / mmPerPxMax < 3`, with measured = samples across the feature and limit = 3;
  - per part, `e = offset(part, −halfUm, "miter")` with **integer** `halfUm = Math.floor(minFeatureUm / 2)` and `minFeatureUm = Math.round(minFeatureMM·1000)` (D3: `SBGeom.offset` refuses non-integer deltas, so an odd `minFeatureUm` must not be halved to x.5; on integer-µm geometry the floor is exact: a width w ≤ 2·halfUm vanishes, so w < `minFeatureUm` warns and w ≥ `minFeatureUm` survives for odd `minFeatureUm`):
    - if `isEmpty(e)`, emit `PART_THIN` (warning; the part disappears);
    - if `components(e).length > 1`, emit `NECK_NARROW` (warning; separated residual regions);
  - **advisory tier (PO-LASER-6):** a part that passes both checks at `minFeatureMM` but would vanish or split at `advisoryFeatureMM` (the same erosion with `halfUm = Math.floor(advisoryFeatureUm / 2)`) gives `FEATURE_MARGINAL` (warning, `detail.kind: "part"|"neck"`; registered in `SBDiag.CODES` with G2.7 and aggregated per `(code, layer)` like `PART_THIN`). Only parts whose bbox is narrower than the advisory width in some direction, or that the first erosion changed, need the second offset (Appendix C: offsets are the slowest primitive);
  - `PART_SMALL` (warning) when a part's area is below `minPartMM2`;
  - `MAT_UNCALIBRATED` (warning) when `!calibrated`.
- With the plywood defaults (1.5 mm), `SAMPLING_LOW` needs mm/px ≤ 0.5. The 0.1 mm/px target gives 15 samples; a budget-capped pitch still passes unless it is coarser than 0.5 mm/px, and then export is refused as GEO-06 requires.
- Every GEO-05 message contains the text "Conservative fabrication warning — not a structural simulation".

- [x] **Tests:** these run on vectorized geometry from `fromMasks` at 0.1 mm/px.
  - `AT-10 1mm feature @0.4mm/px → SAMPLING_LOW`
  - `AT-10 1mm feature @0.25mm/px → no SAMPLING_LOW` (1/0.25 = 4 ≥ 3)
  - `AT-10/GEO-05 neck 2.9 mm with min 3 mm → NECK_NARROW` (narrowBridge, 29 px)
  - `AT-10/GEO-05 neck 3.1 mm with min 3 mm → none` (31 px)
  - `D3 featureChecks with minFeatureMM 2.999 (odd µm) uses integer halfUm 1499 and does not throw`
  - `GEO-05 2.9 mm-wide isolated strip → PART_THIN`
  - `AT-10 part 24.9 mm² → PART_SMALL; 25.1 mm² → none`
  - `PO-LASER-6 neck 1.4 mm with min 1.5 mm → NECK_NARROW` (14 px)
  - `PO-LASER-6 neck 1.8 mm with min 1.5 / advisory 2.0 → FEATURE_MARGINAL only` (18 px)
  - `PO-LASER-6 neck 2.1 mm → none` (21 px)
  - `PO-LASER-6/GEO-06 1.5 mm feature at 0.5 mm/px → no SAMPLING_LOW; at 0.6 mm/px → SAMPLING_LOW`
  - `GEO-05 message labelled conservative, not structural`
  - `MAT-03 uncalibrated warning present`
- [x] **Commit.**

**Result (2026-10-08):**
- **API.** As specified. `cfg` also takes `revision` and `quality`; `minPartMM2` defaults to 0 when absent, and with no `advisoryFeatureMM` there is no advisory tier. Bad arguments throw `SUPPORT_ARG`.
- **Appendix C.** Each layer gets ONE miter erosion per width, on the union of the parts that still need it. Residual components are attributed to their parts by the G2.7 bbox sweep. A part whose bbox is ≤ 2·halfUm in some direction disappears without an offset. On orthogonal (bonded, D1) layers, the advisory erosion is the first residual eroded by `halfAdv − halfMin`, because square erosions compose exactly on the lattice. Other layers are eroded directly. A 10-seed test checks the result against a per-part offset oracle. B4 (`bench support`, dense stress stack, about 3,500 parts): p95 **2.95 s**, reported only (3.26 s without the composition; `docs/perf/SUPPORT.md`).
- **Deviations.** (1) The plan's test neck (`narrowBridge`, 29 px) does not fit that 5-row fixture. New 0.1 mm/px fixtures replace it: `F.MASKS.dumbbell(neckPx)`, `isolatedStrip(widthPx)` and `areaPart(n)`. (2) `SBDiag.aggregate` replaces the per-part detail text. So the GEO-05 note is appended by `SBDiag.make` for `PART_SMALL`, `PART_THIN`, `NECK_NARROW`, and `FEATURE_MARGINAL` of kind part or neck, never kind contact (`js/diag.js`). (3) The sample count is taken on values rounded to 1e-9, so 0.3 mm at 0.1 mm/px counts as 3 samples, not 2.9999999999999996. (4) The tie is conservative, as the erosion rule states: with an even `minFeatureUm`, a width exactly equal to the minimum feature disappears (w ≤ 2·halfUm). D3 contacts pass at the tie.

### Task G2.9: Reviewed clip repair with stale detection (SUP-04, D-4.6, PRJ-04)

**Files:**
- Modify: `js/support.js` (add `proposeClip`, `applyClip`, `removeRepair`, `replayRepairs`)

**Interfaces:**
- Produces:
  - `SBSupport.proposeClip(snapshot, k) → {layer: k, removed: PolygonWithHoles[], removedAreaMM2, partCountBefore, partCountAfter, beforeHash, afterHash, quality}`. It is pure and mutates nothing.
  - `SBSupport.applyClip(project, proposal) → Project`. It returns a **new** project with `revision + 1` and appends `{op:"clip-to-lower", layer, sourceRevision, resultRevision, keyHash, reviewed: {quality, beforeHash, afterHash, removedAreaMM2, partCountBefore, partCountAfter}}`. `keyHash` is the `geometryKey` hash with `repairs` truncated before this entry.
  - `SBSupport.removeRepair(project, i) → Project`. It returns a new revision without entry i and later entries. It backs the "Revert" button (D-4.6: reversible before G3.6 undo exists).
  - `SBSupport.replayRepairs(layers, repairs, ctx) → {layers, diagnostics}`. The engine calls it after the frame union and before holes and validation. For each entry, in order:
    1. If `keyHash` does not equal the current truncated-key hash, the settings changed. Raise `REPAIR_STALE` (blocking) with a "review the clip again" fix, and **skip** the entry.
    2. Else, if `ctx.quality === reviewed.quality` and the current pre-repair layer hash equals `reviewed.beforeHash`, apply `Final[k] = intersection(Final[k], Final[k−1])`.
    3. Else (the same settings at the other quality, for example fab after a draft review), apply it, and raise `REPAIR_REVIEW_FAB` (warning) with the removed area and part counts **at this resolution**. The user must acknowledge it in the fabrication review panel (G3.10) before export.
    4. Otherwise, raise `REPAIR_STALE` and skip.

- [x] **Tests:**
  - `SUP-04 proposeClip reports removed area and part counts before apply`
  - `SUP-04 apply → new revision, original project object unchanged`
  - `PRJ-04 repair records source and resulting revisions and afterHash`
  - `AT-09 removed polygons == difference(Final[k], Final[k-1])`
  - `SUP-04 after replay, validate() reports no BOND_UNSUPPORTED on k`
  - `D-4.6 no clip without a repairs[] entry`: the engine output still reports `BOND_UNSUPPORTED` when `repairs` is empty
  - `SUP-04 settings change → REPAIR_STALE, clip not applied`
  - `LYR-06 draft-reviewed clip at fab quality → applied + REPAIR_REVIEW_FAB with fab-resolution area`
  - `D-4.6 removeRepair restores the pre-repair layer hash`
- [x] **Commit.**

**Result (2026-10-08):**
- **API.** As specified. `proposeClip` also returns `revision` (the snapshot's), and `applyClip` refuses a proposal from another revision (`SUPPORT_ARG`), so a stale review is never applied silently. `replayRepairs` takes `ctx = {project, quality, revision?}`. It computes each entry's truncated key from `ctx.project` with `repairs.slice(0, i)`, and it also returns `applied` (entry indices). Each clip is one layer-level difference (the removed area) plus one intersection, and only the difference when nothing is removed. The clip runs on the already-replayed lower layer. Bad arguments throw `SUPPORT_ARG`.
- **Layer rebuild.** New `SBMaterial.withMaterial(layer, material, opts)` (`js/material.js`) rebuilds a layer around clipped material: parts and IDs, stats, cutPaths, geometry diagnostics and `canonicalHash` (materialHash, D4-B) are recomputed, and holes, Z and other diagnostics are kept. `beforeHash` and `afterHash` are materialHashes.
- **Deviations.** (1) Step 3 is applied as written for a draft review replayed at fabrication (`REPAIR_REVIEW_FAB` with the removed mm² as `areaMM2` and `measured`, and part counts "before → after" in the message, all at this resolution). For the reverse case, a fabrication-reviewed entry shown in a draft preview, the clip is applied with **no** diagnostic: draft never exports, and a "review at fabrication" warning would be false there. (2) The `D-4.6 no clip without a repairs[] entry` test runs on `replayRepairs` + `validate` instead of engine output, because `SBEngine.generate` lands in G2.10a. G2.10a's stage 9 must call `replayRepairs` and keep this pin end to end. (3) Fixture: a 10 × 8 mm bonded stack at 1 mm/px (draft) and 0.5 mm/px (fab). The upper part spans a 2 mm gap in the base, so the clip removes 8 mm² (draft) or 9 mm² (fab) and splits one part into two.

### Task G2.10a: `SBEngine.generate`, the §11.1 pipeline through validation

**Files:**
- Modify: `js/engine.js`

**Interfaces:**
- Produces `SBEngine.generate(req: GenerateRequest, {isCanceled?, onProgress?}) → GenerateResponse` (§3 names). `req.engineVersion` must equal `SBEngine.VERSION`, otherwise the response is `status: "error"`, `ENGINE_MISMATCH`. Stages, in order:
  1. orient (EXIF only if engine-applied, then user rotate/mirror)
  2. resample to the raster of `SBEngine.rasterPlan(project, source, quality, deviceClass)` (G2.1b: draft 720 px long side, fabrication from the physical pitch and pixel budget; G2.0 policy; never upsample), emitting its `FAB_EXCEEDS_SOURCE` / `FAB_PITCH_CAPPED`
  3. domain mask A
  4. interpret:
     - height: `heightFilter` if set, then `addedFromSamples`;
     - tonal: `R.luminance`, then Kuwahara (domain-aware), then `R.thresholds` (domain-aware) and `R.bands`, then `tonalAdded`.
  5. `cumulativeMasks`
  6. construct strategy (cleanup report in mm²; bridge polygons kept for the overlay)
  7. per layer: trace, then bounded smoothing **on pixel loops, art only** (G1.2; connected mode only — bonded layers stay raw, D1), then `fromPixelLoops` to µm, then normalize
  8. frame union (exact rectangle ring)
  9. replay `repairs[]` (G2.9)
  10. registration holes are proposed from the pre-hole material, then subtracted (G3.1 inserts this; until then, the legacy connected corners from G1.7)
  11. complexity caps (G2.7b: `SBSchema.limits(deviceClass)` caps, `SBConstruct.estimateComplexity` before trace). If parts per layer or total vertices exceed the device-class cap, return `status: "error"` with blocking `COMPLEXITY_LIMIT` and **no** layers.
  12. `SBGeom.validate`, `SBSupport.validate` and `featureChecks`, then `SBSupport.checkEnvelope(page, machine, material)` (moved forward from G3.10; GEO-10, PO-LASER-2): when `machine` is set, the shared page (artwork plus frame, the extent of every layer sheet) must satisfy `(pageW ≤ maxLengthMM ∧ pageH ≤ maxProcessingHeightMM) ∨ (pageW ≤ maxProcessingHeightMM ∧ pageH ≤ maxLengthMM)`, compared in µm, else `PAGE_OVERFLOW` (blocking, measured page vs limit, fix: "reduce the target size or edit the machine profile"); `material.thicknessMM > maxThicknessMM` gives `MACHINE_THICKNESS` (blocking; registered with this task). Never rescales
  13. `assignParts`
  14. guides plus guide-containment validation (G3.1 inserts this)

  `isCanceled()` is checked between stages and inside per-layer loops; it gives `status: "canceled"`. `onProgress(stage, frac)` maps to `status: "progress"` messages in the worker (G4.1).
- **Test-only hook:** `req.debug = {smoothBonded: true}` (applies connected-mode smoothing to bonded layers, which D1 never does) is accepted only when `SBEngine.TEST_HOOKS` is set. The Node runner sets it; it is never set in the browser and never persisted. AT-09 uses it to show that final validation catches a smoothing overhang end to end.

- [x] **Tests:**
  - `NFR-10 generate runs in Node from PNG bytes (via SBPng) to Snapshot`
  - `§9.3 engineVersion mismatch → status error ENGINE_MISMATCH`
  - `GEO-02 stage order: frame and base rings are exact rectangles after smoothing (cornerStyle smooth)`
  - `AT-09 crescentInterior, bonded, cornerStyle smooth, smoothBonded hook → final validation reports BOND_UNSUPPORTED although masks nested`
  - `AT-09/D1 same without the hook → bonded layers are raw lattice contours, no BOND_UNSUPPORTED, no SMOOTH_FALLBACK`
  - `AT-09 proposeClip on the hooked result removes exactly the overhang, then rerun reports none`
  - `IMG-03 height mode does not smooth unless heightFilter is set` (spy on kuwahara, thresholds and applyFilter)
  - `§12.3 30k-part noise input → COMPLEXITY_LIMIT, no layers returned`
  - `§9.3 isCanceled → status canceled`
  - `PO-LASER-2/GEO-10 page 480 × 300 mm on xTool S1 + feeder → fits (rotated: 300 ≤ 470, 480 ≤ 3000)`
  - `PO-LASER-2/GEO-10 page 480 × 480 mm → PAGE_OVERFLOW blocking, geometry not rescaled`
  - `PO-LASER-2 frame counts: art 460 × 460 fits, the same art with a 10 mm frame (page 480 × 480) → PAGE_OVERFLOW`
  - `PO-LASER-2 thickness 15 mm → MACHINE_THICKNESS`
  - `GEO-10 machine null → no envelope diagnostics`
- [x] **Commit.**

**Result (2026-10-08):**
- **API.** `SBEngine.generate(req, {isCanceled, onProgress})` is synchronous and never throws: failures are `status: "error"` with `error: {code, message}` (`ENGINE_MISMATCH`, `ENGINE_DEBUG_DISABLED`, `NO_SOURCE`, `PROJECT_INVALID` from `SBSchema.validate`, `REVISION_MISMATCH` when `req.revision` ≠ `config.revision`, `ENGINE_ARG`, `COMPLEXITY_LIMIT`, or a thrown module code). `SBEngine.VERSION` is `SBSchema.ENGINE.version` (looked up at call time); `SBEngine.TEST_HOOKS` is false unless the Node runner sets it. `status: "done"` carries `validatedLayers`, `snapshot` and `diagnostics` (every stage's diagnostics, including each layer's geometry diagnostics). `snapshot.geometryHash`, `snapshot.stats` and `zBottomMM`/`zTopMM` stayed null until G2.10b (now filled); `snapshot.guides` is null until G3.1. Cancellation is checked between stages and in the engine's own per-layer loops (cleanup report, holes); `onProgress(stage, frac)` is non-decreasing and ends at 1.
- **Stages as built.** As listed, with three placements made explicit: the parts cap (`SBConstruct.complexityGate`, simplify "busy" first) runs on the constructed masks right after stage 6 and before trace; the vertex caps (`vertexGate`) run right after `fromMasks` (stages 7–8), before repairs and validation; frame union happens inside `fromMasks` after smoothing, and the holes are subtracted after `replayRepairs`. Construction px come from `construction.cleanup`/`bridge` at the real scales: `featR = max(1, round(minFeatureUm / (2·max(sx, sy))))` (0 when the cleanup minimum is 0), areas by `sx·sy`; bonded culling (only with `cullEnabled`) uses `bridge.cullBelowMM2`, connected specks use `cleanup.speckMM2`. Connected bridges are returned in `cleanupReport[k].bridges` as µm polygons. `RESAMPLED` (info) is emitted when the raster is resampled, `EMPTY_BAND` (info) per empty tonal band.
- **Envelope.** `SBSupport.checkEnvelope(page, machine, material, {revision, quality})`; `PAGE_OVERFLOW` measures the side that fails (the short side against the processing height, else the long side against the length), and its title and fix now name the machine profile. `MACHINE_THICKNESS` (blocking, fabrication) is registered.
- **Performance (bonded-gated).** At the fabrication pitch the cleanup opening radius is 8 px, and `SBMorph`'s iterated 3×3 passes made bonded construction cost 5.3 s at 1 Mpx × 8 layers. `SBMorph.dilate`/`erode` are now one separable (2r+1)² pass, O(w·h) for any r and identical to the iterated form, borders included (test against the kept `_dilateIter`/`_erodeIter`; `test/golden/oldrun.json` unchanged): 1.1 s at 1 Mpx. Quick end-to-end runs (bonded, fabrication, `heightMap`, loaded machine ≈ 6): 1 Mpx 2.2 s, 4 Mpx 7.0 s, of which construction is 1.1 s and 4.1 s. **Open for G4.4/G4.1:** construction is outside the G2.2b `stages.final` gate, so the 25 Mpx budget was set without it; extrapolated it adds ≈ 25 s at 25 Mpx. The worker pool (per-layer construction) or bit-packed morphology is the fix; the long benchmark was not run here.
- **Deviations.** (1) `req.deviceClass` (default `"desktop"`) is added to `GenerateRequest`: `rasterPlan` and the caps need it. (2) AT-09 fixture: the 2-layer `crescentInterior` cannot overhang under smoothing (the full base is never smoothed; S2 recorded no overhang). The test uses a 3-sheet derivative (sheet 1 = the crescent plus one pixel below its lower arm, sheet 2 = the crescent) at 25 µm/px in a 40 × 40 px canvas, with cleanup minimum feature 0 so the masks reach the trace unchanged; the hooked run reports exactly one `BOND_UNSUPPORTED` on layer 2, the clip removes exactly that area, and the rerun reports none. (3) The GEO-02 check runs in connected mode (acrylic) at 33 µm/px so that some loops actually round within 0.05 mm; at 1 mm/px every loop falls back to raw. (4) `CLEANUP_ALTERED` is not emitted yet: the cleanup report carries the mm² for the overlay (G2.13b decides the warning).

### Task G2.10b: Z model, accounting, hashes, freeze and the draft/fab rule

**Files:**
- Modify: `js/engine.js`

**Interfaces:**
- Completes `generate` with:
  1. the Z model: `zBottom = k*(t+g)`, with `g = 0` in bonded mode;
  2. trailing-empty accounting: status `omitted-trailing` plus a `TRAILING_OMITTED` warning; `stats.requested`, `exported` and `omitted[]`; `maxZMM` uses exported layers only;
  3. `stats.stockMM` and `stats.reliefMM`, compared as µm integers;
  4. layer hashes, `guideHash` and `geometryHash` (§3, including `quality` and raster size);
  5. `Object.freeze`, deep.
- **Draft/fabrication rule (LYR-06):** interaction uses `quality: "draft"`. **Every** export, starting with alpha.2, runs `generate` at `quality: "fabrication"`, opens the review panel on that snapshot's diagnostics, and gates on `exportGate(…, "fabrication")`. Draft diagnostics and acks are never reused. The quality-dependent raster comes from `SBEngine.rasterPlan` (G2.1b); this task wires it into hashes and freezing and adds nothing to the raster rule.

- [x] **Tests:**
  - `§9.2 each layer has index,zBottomMM,zTopMM,material,carriers,parts,cutPaths,scorePaths,diagnostics,canonicalHash`
  - `AT-03 N=8 t=6.35 → stats.stockMM 50.8, reliefMM 44.45`
  - `MAT-01 stockMM excludes adhesive/finish (no such input affects it)`
  - `UI-03 connected g=3: zBottom(2) = 2*(6.35+3)`
  - `D-4.7/AT-04 trailing empty omitted with index preserved; requested 8, exported 6; maxZMM uses exported`
  - `LYR-05 identical layers kept`
  - `NFR-05 same request → same geometryHash ×3`
  - `PRJ-02 appearance-only change → same geometryHash`
  - `AT-11/UI-03 view.explodeMM 0 vs max → same geometryHash`
  - `LYR-06 draft and fab geometryHash differ; diagnostics carry their quality`
- [x] **Commit.**

**Result (2026-10-08):**
- **Z model.** In µm integers: `t = round(thicknessMM·1000)`, `g = round(gapMM·1000)` in connected mode and 0 in bonded mode (D1), `zBottomMM(k) = k·(t + g)/1000`, `zTopMM = zBottomMM + t`. `view.explodeMM` never enters (display only, UI-03).
- **Accounting.** Every layer above the highest non-empty layer gets status `omitted-trailing` and stays in `layers[]` with its index and Z (D-4.7). One `TRAILING_OMITTED` warning (project-level, names the omitted indices and "exported of requested"). Interior empties keep status `empty` and G2.7's `BOND_EMPTY_UNDER`. `stats = {requested: N, exported: N − |omitted|, omitted[], stockMM, reliefMM, maxZMM}`.
- **Stock and relief: interpretation.** `stockMM = N·t` and `reliefMM = (N − 1)·t` are the **nominal** stock-only height and above-base relief of the requested count (SRS §4.3: "nominal maximum stock height is N times t; maximum relief above the base is (N−1) times t"; AT-03). They exclude gaps, adhesive and finishes (MAT-01: there is no such input). The actual height is `maxZMM`, the top of the highest exported layer: `N_e·t + (N_e − 1)·g`, so it is the assembled envelope in connected mode. With every layer occupied in bonded mode, `stockMM = maxZMM`. The dimbar (G2.11c) derives the actual relief above the base as `maxZMM − t`.
- **Hashes.** `geometryHash = hashJSON({key: geometryKey(config), engine: VERSION, quality, raster: [rasterW, rasterH], layers, guides})`. `layers` holds `SBGeom.layerHashes(L).layerHash` for every index 0..N−1, omitted layers included. The hash is in `snapshot.geometryHash` and in the response. New `SBEngine.guideHash(guides)` hashes `{labels, omitted, map}` and hashes null guides (until G3.1) as `hashJSON(null)`. `canonicalHash` stays the materialHash from `SBMaterial` (equal to `layerHashes(L).materialHash`).
- **Freeze.** Every response, error and canceled ones included, is deep-frozen. The freeze is an iterative walk that visits each object once and skips typed arrays, because `Object.freeze` throws on a non-empty view.
- **Draft/fab (LYR-06).** Nothing is added to the raster rule. `quality` and the raster size are in the hash, so `SBDiag.ackKey` never matches across qualities (tested).
- **Cost.** 1 Mpx bonded fabrication (`heightMap`, 8 layers, about 9.4k vertices): accounting plus hashes 21–39 ms, freeze about 2 ms, of a 1.6–2.1 s generate. These are quick runs; the long benchmark was not run.
- **Deviation.** None in behaviour. The `stockMM`/`reliefMM` reading above is the one recorded interpretation.

### Task G2.11a: Controller state adapter; no auto-demo (PRJ-01)

**Files:**
- Modify: `js/app.js:34-62` (`state` → `project`), `js/app.js:70` (`runPipeline` → `regenerate()`), `js/app.js:652-653` (remove the auto-demo click)
- Create: `SBSchema.legacyState(project)` in `schema.js` (pure)

- [x] **Tests (Node):**
  - `PRJ-01 legacyState(defaults("acrylic")) reproduces v1.1.0 state keys`
  - `PRJ-01 regenerate is not callable without a source` (pure guard `SBSchema.canGenerate(project, source)`)
- **QA checklist** (`docs/QA_CHECKLIST.md`): the app opens empty; Demo is an explicit source button; Generate and Export are disabled with a "Choose a source" reason.
- [x] **Commit.**

**Result (2026-10-08):**
- **API.** `SBSchema.legacyState(project, srcW?, srcH?)` returns the 19 v1.1.0 settings keys (the `settingsJSON` keep list). `widthMM` is the art width (`targetMM − 2·frame` in width sizing; derived from the source size in height sizing, null without one); `procRes` is `geometry.draftPx`; `sourceName` and `detailEps` come from `extras.legacy`, else their v1.1.0 defaults. It round-trips `fromLegacySettings`. Added (beyond the plan) the controller's write path `SBSchema.applyLegacy(project, key, value)`: pure, mirrors the G2.4b derivations, keeps the frame or art width when width or margin changes, maps `darkFront` by interpretation mode, bumps `revision` exactly when `geometryKey` changes, and throws `SCHEMA_LEGACY` for `sourceName`, `detailEps` or unknown keys. `SBSchema.canGenerate(project, source)` → `{ok, reason}`: "Choose a source" without a source, else the failing validation paths.
- **App.** `state` is replaced by `let project = SBSchema.defaults("acrylic")` (connected tonal behaviour unchanged until G2.11b–e) plus a runtime-only `run` record (source, sheets, raster size, report). `runPipeline` is `regenerate()`, guarded by `canGenerate`. The auto-demo click is removed; Export starts disabled with a `#why-export` "Choose a source" reason (`aria-describedby`). There is no separate Generate button yet (generation runs on change); G2.11b adds it under the same guard. Headless smoke check: opens empty with the reason shown; Demo generates and enables Export; a slider edit regenerates.

### Task G2.11b: Stage markup and slider ranges (UI-01)

**Files:**
- Modify:
  - `index.html:51-117`: rail stages Source / Interpretation / Construction / Review / Export;
  - `index.html:62`: `#in-res` becomes "Fabrication pitch (mm/px)", a number input `min=0.05 max=2 step=0.01`, default 0.1 (PO-LASER-4; replaces the 1536/4096 long-side range). The draft resolution is not a user control (720 px);
  - `index.html:71-72`: `#in-sheets` `min=1 max=16`;
  - `css/style.css`.
- **QA:** stages are reachable by keyboard in order. **Commit.**

**Result (2026-10-08):**
- **Markup.** The rail is five `section.step` regions `#stage-source`, `#stage-interpretation`, `#stage-construction`, `#stage-review`, `#stage-export` (each `tabindex="-1"`, `aria-labelledby` its heading), preceded by a `nav.stagenav` of in-page links in the same order (keyboard reachability). Source holds Load photo and Demo; Interpretation holds sheets, tone split, dark front and smoothing; Construction holds size, frame, the pitch and the feature/bridge/hole controls; Review holds the Generate button and the palette (appearance); Export is unchanged.
- **Pitch.** `#in-res` is "Fabrication pitch (mm/px)", `type=number min=0.05 max=2 step=0.01 value=0.1`. Added the pure write path `SBSchema.applyFabPitch(project, value)` and the frozen bounds `SBSchema.FAB_PITCH` (clamp to 0.05–2, 0.001 mm grid, revision + 1 iff it changes, non-numeric → unchanged). The draft raster (720 px, `geometry.draftPx`) is no longer bound to a control. The app path is still the legacy connected pipeline, so the pitch is recorded on the project but does not change the draft preview until the engine path is wired (G2.11c dimbar, G2.14).
- **Ranges.** `#in-sheets` is 1–16 (the legacy pipeline and the preview were checked at 1 and 16 sheets).
- **Generate.** The staged `#btn-generate` (Review) shares `SBSchema.canGenerate` with Export (`#why-generate` "Choose a source"); generation still also runs on change. Headless smoke check (Chromium on `dist`): opens with Generate and Export disabled; Demo enables both; pitch 0.25 reads "0.25 mm/px" and a blank entry restores it; 16 sheets gives 16 layer cards.

### Task G2.11c: Control groups, dimension bar and disclaimers

**Files:**
- Modify: `index.html`, `js/app.js` bindings (:492-640), `css/style.css` (`.dimbar`)

**Interfaces:**
- Selects: `#in-interp`, `#in-polarity`, `#in-construction`, `#in-thickness`, `#in-thickstate`, `#in-gap`, `#in-manual-th`, `#in-units`, `#in-appearance`, `#in-color`, `#in-explode`.
- Size and machine (PO-LASER-1/3/8): `#in-sizeby` (Height / Width, default Height), `#in-target` (finished size in the chosen unit, art plus frame), and a **Machine** group: `#in-machine` (profile select, "xTool S1 + feeder" preselected, plus "None") with editable `#in-m-height`, `#in-m-length`, `#in-m-matwidth`, `#in-m-thick`, `#in-m-kerf`. Edits change `project.machine` (a geometry change: revision + 1, regenerate). `#in-thickness` shows the PO-LASER-8 hint.
- Appearance and view changes call `renderAll()` only, following the pattern at `app.js:614`. Geometry changes bump the revision and call `regenerate()`.
- The persistent `.dimbar` shows:
  - requested and exported count;
  - max Z, base t and relief;
  - mm/px of the real raster, next to the target pitch, the fabrication raster W × H and Mpx, and the cap reason (budget with device class, or source with the px shortfall) **before** generation (PO-LASER-4/5, NFR-04: never silent);
  - the page size against the machine processing area ("fits" / "too large by … mm", PO-LASER-2);
  - a thresholds popover listing every boundary as **normalized and mm**, from `SBHeight.boundaries` (LYR-02).
- Disclaimer copy, from pure strings in `SBDocs.COPY`:
  - MAT-01: "Stock height excludes adhesive films and surface finishes."
  - MAT-04: "Palette shading is a proof aid; it is not necessarily the appearance of unpainted stock."

- [x] **Tests (Node, on `SBDocs.COPY` and a pure `dimbarModel(snapshot)`):**
  - `LYR-02 dimbar thresholds in normalized and mm`
  - `LYR-01 dimbar shows requested vs exported`
  - `MAT-01 adhesive/finish exclusion text present`
  - `MAT-04 palette disclaimer text present`
  - `PO-LASER-4 dimbar shows target and actual mm/px and the cap reason`
  - `PO-LASER-5 dimbar shows the source shortfall in px`
  - `PO-LASER-2 dimbar shows page vs machine area`
- [x] **Commit.**

**Result (2026-10-08):**
- **Pure parts.** `js/docs.js` (SBDocs) is created now rather than in G3.5: `SBDocs.COPY` (MAT01, MAT04, THICKNESS_HINT), `SBDocs.pageFit(w, h, machine)` (the `checkEnvelope` rule in µm, plus the smallest excess over both orientations; a grid test keeps it in step with `PAGE_OVERFLOW`) and `SBDocs.dimbarModel({project, plan, stats})`. It is loaded between `zip.js` and `engine.js` (§4 order) in all four lists. The model takes the fabrication `SBEngine.rasterPlan` (computed from the source size before generation) and the run's stats, so the pitch, the raster W × H and Mpx, and the cap reason (device-class budget and/or the source shortfall in px) show before any generation (NFR-04). Z: `maxZMM` from the stats, else `N_e·t + (N_e − 1)·g` (estimated, "if every layer is occupied", until the exported count is known); relief = `maxZMM − t`. Thresholds: `SBHeight.boundaries(N, t)`, each "normalized → mm". Lengths follow `project.units`; the pitch is always mm/px.
- **Write path.** `SBSchema.applyControl(project, id, value, ctx?)` is the one write path for the new controls (`interp`, `polarity`, `construction`, `thmode`, `manual-th`, `thickness`, `thickstate`, `gap`, `units`, `sizeby`, `target`, `machine`, `m-*`, `appearance`, `color`, `explode`). Lengths are entered in `project.units` and clamped to the schema ranges; an invalid entry or a result that fails `validate` leaves the project unchanged; revision + 1 exactly when `geometryKey` changes. A `sizeby` switch with a known source keeps the finished page size. Machine edits keep the profile id and mark the name "(edited)"; reselecting the profile restores it. `SBSchema.controlValues(project)` and `SBSchema.polaritiesFor(mode)` feed the controls. `applyLegacy("nSheets")` re-seeds a mismatched manual threshold list (N − 1 even values).
- **App.** Construction has Size / Material / Fabrication / Machine fieldsets; `#in-width` (art width slider) is replaced by `#in-sizeby` + `#in-target`, and `#in-darkfront` by `#in-polarity`. `#in-explode` is now 0–60 mm (`view.explodeMM`). Geometry controls regenerate; units, appearance, colour and explode call `renderAll()` only. The `.dimbar` sits above the status bar with a `<details>` thresholds popover; uniform appearance colours every layer with the stock colour. Headless Chromium smoke check on `dist`: empty → estimated bar and "choose a source"; Demo → 5 exported, 0.333 mm/px vs 0.1 target, 900 × 680 px, "2100 × 1587 px short"; inches, a 600 mm budget-capped page, machine None (limit fields disabled), height mode polarities, no page errors.
- **Deviations.** (1) `dimbarModel` takes `{project, plan, stats}` instead of a bare snapshot, because the dimbar must show the plan before generation. (2) The mode selects apply `modeChangeDiff`'s targets directly; G2.11e puts the review dialog in front of them. (3) The app preview still runs the legacy connected tonal pipeline (as recorded in G2.11b), so height/bonded, thickness, gap and manual thresholds are recorded on the project and shown in the dimbar but do not change the draft preview until the engine path is wired (G2.14). The legacy path exports every sheet, so its stats are `exported = N`, no omissions.

### Task G2.11d: Applicability and disabled-with-reason controls

**Files:**
- Modify: `js/schema.js` (`applicability`), `js/app.js`, `css/style.css` (`.row.disabled`, `.why`)

**Interfaces:**
- `SBSchema.applicability(project) → {controlId: reason|null}`.
  - In bonded mode, `#in-bridge`, `#in-maxbridge` and `#in-gap` are disabled, `#in-cull` is enabled as opt-in, and `#in-margin` defaults to 0.
  - Each disabled row shows `.why` text and an `aria-describedby` reason.
  - A settings import that sets an inapplicable display-only value raises `DISPLAY_ONLY_IGNORED` (info).

- [x] **Tests:**
  - `UI-01 bonded disables bridge controls with reason`
  - `UI-01 connected enables gap`
  - `§9.5 inapplicable imported setting → DISPLAY_ONLY_IGNORED info`
- [x] **Commit.**

**Result (2026-10-08):**
- **Pure parts.** `SBSchema.applicability(project)` returns `{"in-…": reason | null}` over one fixed key set (bridge, maxbridge, gap, corner, cull, cullon, margin, holes, holedia, thmode, manual-th, smooth, passes, m-height/length/matwidth/thick/kerf), from one rule table shared with `SBSchema.ignoredSettings(project)`. Bonded: bridge, max bridge and gap disabled with reasons; corner style disabled too (D1 unsmoothed, the same note `modeChangeDiff` gives); `#in-cull` stays enabled and the opt-in is the new `#in-cullon` checkbox (`construction.bridge.cullEnabled`, applyControl `cullon`, bonded only; disabled in connected, which always culls); `#in-margin` stays enabled. Height mode disables tone split, manual thresholds and smoothing; manual thresholds otherwise need the Manual split; machine None disables the limits; holes off disables the diameter (the latter three replace ad-hoc `disabled` lines in app.js).
- **Frame default.** `modeChangeDiff` to bonded now adds `construction.frame → {enabled: false, widthMM: 0}` when a frame is set ("#in-margin defaults to 0"); `targetMM` is kept, so the finished size is unchanged. G2.11e shows it in the review dialog.
- **§9.5.** `importLoose` now also returns `diagnostics`: for a valid import, one `DISPLAY_ONLY_IGNORED` (info) per setting the project's modes do not use whose value differs from the neutral value of the preset with that mode (bonded: bridge 1.8, max bridge 40, corner sharp, tolerance 0.05; connected: cull opt-in false; height: balanced, no manual list, smoothing 0/0; tonal: height filter null). The value is kept, not rewritten. An invalid import gets none (validate reports it). There is no import UI yet; G3.6/G3.9 surface these.
- **App.** `applyApplicability()` runs in `syncControls`: disabled control, `.row.disabled`, a `.why` reason (`id="why-in-…"`, created on demand) appended to the control's `aria-describedby` and removed when it applies. The v1.1.0 `setLegacy` controls are now re-shown on sync, so the margin slider follows a mode change. Headless Chromium smoke check on `dist`: acrylic → cull opt-in disabled; Demo + bonded → bridge/max bridge/gap/corner disabled with reasons, margin 0; height → smoothing and thresholds disabled; back to connected → gap and bridges enabled, reasons hidden; no page errors.
- **Deviation.** The plan lists only bridge, maxbridge and gap as bonded-disabled; corner style is also disabled (D1) and the cull opt-in is a separate checkbox rather than the slider, so the threshold stays editable as the spec asks.

### Task G2.11e: Mode-change review (PRJ-02, AT-21)

**Files:**
- Modify: `js/app.js` (confirm dialog), `index.html` (a `<dialog>`)

**Interfaces:**
- Changing `#in-interp` or `#in-construction` does not apply the change at once. It opens a dialog listing `SBSchema.modeChangeDiff(project, patch)`. **Accept** applies the patch (revision + 1); **Cancel** leaves the project untouched.

- [x] **Tests:** `PRJ-02 cancel leaves project revision unchanged`, run on a pure `SBProject`-free helper `applyModeChange(project, patch, accepted)`.
- [x] **QA:** the dialog is keyboard-operable, and focus returns to the select. **Commit.**

**Result (2026-10-08):**
- **Pure part.** `SBSchema.applyModeChange(project, patch, accepted)` (in `js/schema.js`, next to `modeChangeDiff`): Cancel returns an unchanged copy (same revision); Accept applies every `modeChangeDiff` target, revision + 1 exactly when `geometryKey` changes (a patch that keeps the modes changes nothing); an unknown mode throws `SCHEMA_MODE` either way; a result that fails `validate` leaves the project unchanged; the input is never mutated. `applyControl("interp" | "construction")` now delegates to it (one write path).
- **App.** `index.html` has a modal `<dialog id="dlg-mode">` (`aria-labelledby`/`aria-describedby`, `<form method="dialog">`, Cancel with `autofocus`, Accept). `#in-interp` and `#in-construction` left `CONTROLS` (`MODE_CONTROLS`): a change lists `modeChangeDiff` (changed values "from → to", kept settings as usage notes, each with its reason) and calls `showModal()`. On `close`, `returnValue === "accept"` commits `applyModeChange(…, true)` through the shared `commitProject` (regenerate on revision + 1); Cancel or Escape restores the select. Focus returns to the select either way. A browser without `showModal` falls back to `confirm()`. `.modal`/`.modelist` styles in `css/style.css`.
- **QA.** Headless Chromium on `dist` (CDP keyboard events): Demo → construction to bonded opens the dialog with 9 entries and focus on Cancel; Escape closes it, the select shows connected again and has focus, gap stays enabled; reopen, Tab → Accept, Enter → bonded applied (gap disabled), focus on the select; interpretation to height, Enter on Cancel → tonal kept, focus on `#in-interp`; no page errors.
- **Deviation.** None in scope. The helper is `SBSchema.applyModeChange` (the plan names only the function); `commitProject` is factored out of `onControl` so both paths share the regenerate/render rule.

### Task G2.12: Opaque proof, stack section and tilt modes (`SBProof` plus the preview)

**Files:**
- Create: `js/proof.js` (pure)
- Modify:
  - `js/preview.js:22-154`:
    - add `setSnapshot(snap, colors)` and `setMode("proof"|"section"|"tilt")`;
    - each layer's `Path2D` (from µm rings) is rasterized **once per snapshot** into an offscreen canvas, following the `maskToCanvas` pattern. Tilt frames only composite;
    - `proof` mode sets `imageSmoothingEnabled = false`, draws no shadows (:127-130) and no parallax offsets;
  - `index.html:120-142`: tabs Proof, Section, Layers, Tilt (illustrative);
  - `js/app.js:573 switchTab`.

**Interfaces:**
- Produces:
  - `SBProof.model(layers, colors, {edgeStroke}) → [{layerIndex, fill, stroke, rings}]` (back to front);
  - `SBProof.section(layers, yMM, {tMM, gMM}) → [{layerIndex, z0, z1, intervals: [[x0MM, x1MM]]}]`, a scanline across the polygon rings;
  - `SBProof.drawParams(mode) → {smoothing, shadows, parallax}` (pure; `proof` gives all false);
  - `SBProof.modelHash(model)`.

- [x] **Tests:**
  - `UI-03 section of donutIsland at the island row has 3 intervals on layer 1` (ring left, island, ring right)
  - `UI-03 bonded z = k*t; connected z = k*(t+g)`
  - `UI-02 proof drawParams: no smoothing, no shadows, no parallax`
  - `UI-02 retained/waste model per layer equals material polygons`
  - `MAT-04 uniform proof strokes layer edges`
- [x] **Manual:** the AT-11 visual comparison of the proof against `assemblySVG`; the tilt tab label reads "Illustrative"; the explode slider moves layers without changing `geometryHash` (AT-11 hash part is in G2.10b). **Commit.**

**Result (2026-10-08):**
- **Pure part.** `js/proof.js` (`SBProof`, loaded after `svgread.js` in `index.html`, `sw.js` SHELL and `test/modules.js`): `model` (non-empty layers back to front; `rings` = material outer + holes in µm; fill and edge-stroke rules identical to `assemblySVG`, `COLOR` refusal), `section` (half-open even-odd scanline per layer, µm-exact crossings, abutting spans merged; `z0 = index·(t + g)`, `z1 = z0 + t` on the µm grid; empty layers listed with no intervals; `NONFINITE` on bad y/t/g), `drawParams` (frozen; proof and section all false, tilt all true plus `illustrative`; `MODE` refusal), `modelHash = SBHash.hashJSON(model)`.
- **Preview.** `SBPreview` gains `setSnapshot(snap, colors, {bridges})`, `setMode`, `getMode`, `setSectionY`. Each non-empty layer's `Path2D` (even-odd, plus the 0.2 mm edge stroke when uniform) is rasterized once per snapshot into a page-sized offscreen canvas (long side 1600 px); frames only composite. Proof: page on the bed colour, `imageSmoothingEnabled = false`, no shadows, no parallax or explode offsets. Section: one bar per interval at real Z, Z ticks and a t / g / height / width callout; vertical drag moves the line. Tilt: the v1.1.0 parallax, shadows and explode, with the amber bridge highlight (tilt only). `setSheets` (legacy raster) stays.
- **App.** Tabs Proof, Section, Layers, Tilt (illustrative); Proof is the default. `renderAll` feeds `setSnapshot` from `SBEngine.connectedLayers` (the export path's polygons), built once per run (`run.view`) and re-tinted on appearance changes; t is `material.thicknessMM`, g is `construction.gapMM` (0 when bonded). The "Draft preview" badge is retired (the G1.7 check is retargeted); the tilt view shows "Illustrative: not to scale" and the explode/bridges tools only there.
- **Tests.** 28 checks in the G2.12 suite, including a recording-2D-context run of `preview.js` (no DOM): one rasterization per layer, none on tilt frames, proof draws with no smoothing/shadow/offset, section draws one bar per interval. Full suite 1259 passed.
- **QA.** Headless Chromium on `dist`: Demo → four tabs in order, Proof active; Proof matches the polygon proof (frame, holes, layers aligned); Section at y = 125.3 mm shows 5 bands at 3 mm + 3 mm gap (27 mm); Tilt shows the Illustrative note and explode/bridges; a palette change re-renders in about 180 ms; no page errors. Explode not changing `geometryHash` is covered by the G2.10b check (explode is a view setting only).
- **Deviations.** The app still runs the legacy connected pipeline, so the "snapshot" is `{page, layers}` from `SBEngine.connectedLayers` plus t and g, not an `SBEngine.generate` snapshot; `setSnapshot` takes the same shape a generate snapshot provides (`layers`, page) and switches over when the app adopts `generate`. `drawParams` also returns `illustrative`. Bridges show only in Tilt so the Proof stays the material alone (overlays are G2.13b).
- **Review fixes (2026-10-08).** (1) *Pipeline-run cost, undisclosed in the first report:* building the views runs `SBEngine.connectedLayers` after every geometry change (before G2.12 it ran only at export). Measured by the review in Node at 720 px: simple image `legacyRun` ≈ 0.8 s + views ≈ 1.8 s smooth / 0.2 s sharp; busy image ≈ 1.0 s + ≈ 10.8 s smooth / 1.0 s sharp. Mitigated, not fixed: `renderAll` paints the Layers grid, chips, status and a raster composite (`preview.setSheets`, which now drops the polygon snapshot) first, then builds the polygons after one frame plus one task; `run.viewToken` drops a build superseded by a newer run or re-render; the status line gains `proof N ms`. Recorded under KI-CONN-PERF (Appendix D.8, D6 item 11) for G4.1; needs explicit product-owner acceptance. (2) A failure in `connectedLayers` or `SBProof.model` (geometry, or a colour refused with `COLOR`) is caught: the status line reads `proof unavailable: …`, the views keep the raster, and the Layers grid and chips still update. (3) The fill/stroke rule is one helper, `SBSvg.paint(layers, colors, opts, who)`, used by both `assemblySVG` and `SBProof.model`; `model` now refuses a non-integer `layer.index` (`NONINTEGER`). (4) Section: width and height dimension lines with Z ticks, and a page gauge at the right edge (full canvas height = page height) with an amber mark at the section line, so the vertical drag maps geometrically onto the gauge. (5) `preview.snapshot(mode)` draws the given view for the capture and restores the active one; the export bundle's `preview.png` is always the proof. (6) Noted, not changed: Proof rasterizes each layer once at 1600 px long side and scales with smoothing off, so on large or HiDPI viewports the upscale is nearest-neighbour (blocky rather than blurred); acceptable for UI-02, revisit with a viewport-sized raster if needed. Tests: section draws exactly `nInt + 1` rects; the dimension lines and gauge; bridge highlight in Tilt only; `snapshot("proof")` from the Section tab; `setSheets` replaces the snapshot; the shared paint rule and `NONINTEGER`; explode keeps `geometryKey`; `renderAll` deferral and failure handling. Full suite 1268 passed.

### Task G2.13a: Retained/waste layer cards

**Files:**
- Modify: `js/app.js:186-236` (`renderSheetGrid`, `renderPaletteChips`), `css/style.css` (`.sheetcard`)

**Interfaces:**
- Per-layer cards are drawn from `layer.material`, using the per-snapshot offscreen cache, with a waste hatch.
- [x] **QA:** the cards match the proof. **Commit.**

**Result (2026-10-08):**
- **Pure part.** `SBProof.cards(layers, page) → [{layerIndex, role, empty, retainedMM2, wasteMM2, retainedPct}]`, one per layer (empty ones too), back to front; retained = `SBGeom.area(layer.material)`, waste = page area − retained (frame included); roles backing / mid / front; `NONFINITE` on a bad page, `NONINTEGER` on a bad index; layers are not mutated.
- **Preview.** `SBPreview.drawWasteHatch(ctx, w, h)` (bed colour plus 45° strokes, so waste is not colour-only); the controller gains `drawCard(canvas, layerIndex, {maxPx})` (page aspect, long side 480 px by default) that draws the hatch and then the layer's image from the per-snapshot offscreen cache with the proof draw parameters (no smoothing, no re-rasterization; a layer with no material is hatch only; `false` without a snapshot) and `hasSnapshot()`.
- **App.** `renderSheetGrid` draws each card through `preview.drawCard` once the polygon snapshot is set and labels it with retained / waste cm² and % (a legend swatch for each; `role="img"` with an `aria-label`); `showView` re-renders the cards after `setSnapshot`. Before the polygons are built (KI-CONN-PERF interim) or when the proof is unavailable, `rasterCard` draws the masks over the same waste hatch. `.sheetcard .sw`/`.sw-waste` in `css/style.css`.
- **Tests.** 17 checks in the G2.13a suite (card areas and roles, drawCard from the cache with no new rasterization, hatch under material, no smoothing, empty layer hatch only, setSheets drops the snapshot, wiring and CSS). The G2.12 KI-CONN-PERF check's slice anchor moved to `function renderSheetGrid(`. Full suite 1285 passed.
- **QA.** Headless Chromium on `dist`: Demo → five raster cards at once, then polygon cards after the proof build (480 × 371 px, page aspect 324 × 250.7 mm); each card shows the frame, the four mounting holes and the same layer outlines as the Proof, waste hatched; labels 100 / 83 / 67 / 55 / 30 % retained; no page errors.
- **Deviations.** None in scope. The cards are drawn from the snapshot built by `SBEngine.connectedLayers` (as for G2.12), not an `SBEngine.generate` snapshot.

### Task G2.13b: Overlays and state badges (GEO-08, UI-05)

**Files:**
- Modify: `js/preview.js`, `js/diag.js` (`nextState`), `index.html` (`#in-bridgesvis` is fed from `cleanupReport[].bridges`)

**Interfaces:**
- Overlays: cleanup added in green, removed with a dashed outline (mm² labels), unsupported in red with a "!" icon, bridges in amber (connected mode).
- State badges: draft / stale / processing / validated / failed.

- [x] **Tests:** `UI-05 nextState transitions draft→processing→validated|failed and any edit → stale`.
- **Commit.**

**Result (2026-10-08):**
- **States (UI-05).** `SBDiag.STATES` (frozen: draft, stale, processing, validated, failed), `SBDiag.nextState(state, event)` and `SBDiag.stateBadge(state) → {state, label, text}`. Events: `edit` → stale from any state; `start` → processing; `done {quality, diagnostics}` and `fail` act only from processing (a result superseded by an edit leaves the state stale): draft quality → draft, fabrication → validated with no blocking diagnostic (warnings allowed) else failed, `fail` → failed. Unknown state or event throws `STATE`.
- **Overlay data (GEO-08).** At **draft quality only**, `SBEngine.generate` adds `added` (final ∧ ¬input) and `removed` (input ∧ ¬final) change polygons (µm, page frame) to each `cleanupReport` entry that changed; fabrication keeps mm² only, so the fabrication budgets (D6) are untouched. Shared helper `SBEngine.maskPolygons(w, h, sxUm, syUm, fUm, pred)` (also used for the bridges). Neither enters any hash. `legacyRun` sheets 1.. now carry `pre` (the pre-cleanup mask) and `cleanup` counts; `SBEngine.legacyCleanupReport(sheets, w, h, cfg)` returns the same cleanupReport shape in the `connectedLayers` page frame (the app's interim source until it adopts `generate`).
- **Model and preview.** `SBProof.overlays({cleanupReport, diagnostics, mode}) → [{layerIndex, addedMM2, removedMM2, holesFilled, partsRemoved, label, added, removed, bridges, unsupported}]` (bridges only in connected-sheet mode; unsupported from `BOND_UNSUPPORTED` region and mm²; `MODE` on a bad mode). `SBPreview` gains `setOverlays` and `setShowOverlays` (off by default, so the Proof stays the material alone): added in green, removed as a dashed outline, unsupported as a red rectangle with a "!" icon, bridges in amber (hidden by `#in-bridgesvis`), and a per-layer "+a mm² / −r mm² / h holes filled / p parts removed" text legend (changed area and part count, zero terms omitted). Overlay bridges are rasterized once per `setOverlays` and also feed the Tilt bridge highlight; the Section draws no overlay.
- **App.** `#state-badge` (`role="status"`, text label, `data-state` border style) driven by `setRunState` → `SBDiag.nextState`: every geometry edit (`recompute`) marks the shown result stale before the debounce; `regenerate` goes processing → draft, or failed when `legacyRun` throws. `#in-overlays` ("Show changes", Proof tab only) toggles the overlay; `#in-bridgesvis` shows in Tilt and, with the overlay on, in Proof (connected-sheet only) and is fed from `cleanupReport[].bridges` (`legacyCleanupReport`), no longer from the masks.
- **Tests.** 28 checks in the G2.13b suite (state machine, badges, draft/fabrication cleanupReport polygons vs mm², determinism, legacy report vs pixel counts and bridges, overlay model, recording-context preview draws, wiring). Full suite 1313 passed.
- **Cost (quick measure, Node, not the large benchmark).** Draft `generate` on a 720 × 540 synthetic 8-level height map: plywood (bonded) 941 ms total, of which 188 ms is overlay tracing; acrylic (connected) 1950 ms, of which 103 ms. The app's deferred proof build (KI-CONN-PERF) gains the `legacyCleanupReport` traces at 720 px (same order).
- **Deviations.** (1) `CLEANUP_ALTERED` is still not emitted: cleanup alters almost every real image, so a warning would demand an acknowledgement on nearly every export; the overlay plus the mm² report (and later `validation.json`, G3.9) is the GEO-08 disclosure. Revisit with G2.13c if the product owner wants a warning. (2) The app still runs the legacy draft pipeline, so its badge reaches draft, stale, processing and failed; validated arrives when the app adopts `SBEngine.generate` at fabrication quality, and unsupported overlays appear only from `generate` diagnostics (the legacy run has none). (3) The pipeline runs synchronously, so "processing" is rarely painted until G4.1 moves it to a worker. (4) Overlays at draft quality only (see above).

### Task G2.13c: Diagnostics panel (UI-04, NFR-07)

**Files:**
- Modify: `js/app.js`, `index.html`, `css/style.css` (`.diag-list`, `.badge`)

**Interfaces:**
- The list is grouped by severity, with an icon plus text. Each item shows its measured value against the limit. Clicking or pressing Enter on an item focuses its layer and part and highlights the region. Warnings have an "Acknowledge" checkbox scoped to the current snapshot.
- Pure helper: `SBDiag.summarize(diags) → [{severity, label, count}]`.

- [x] **Tests:**
  - `UI-04 summarize labels are text, not color names`
  - `UI-04 item text includes measured vs limit`
- **Manual:** AT-08, AT-10 and the keyboard path of AT-20. **Commit.**

**Result (2026-10-08):**
- **Pure part.** `SBDiag.summarize(diags) → [{severity, label, icon, count}]` (blocking, warning, info; empty groups omitted; severity from the registry, §9.5; labels "Blocking" / "Warning" / "Info" with glyph icons ✖ ▲ ℹ, never colour names; an aggregated diagnostic counts once). `SBDiag.describe(d) → {severity, severityLabel, icon, code, title, message, where, measure, fix, text, focus, navigable}`: `measure` is "measured X unit vs limit Y unit" (mm2 shown as mm²; either half alone when only one is set), `where` is "Layer k+1[, part ID | , n parts]", `focus` is `{layer, parts, regions}` (a single bbox or an aggregated region list both become a list of mm bboxes in the page frame) or null without a layer.
- **Engine (interim source).** The app still runs the legacy draft pipeline, which has no diagnostics, so `SBEngine.legacyDiagnostics(view, w, h, project)` runs generate's step-12 checks on the view's final polygons at draft quality and the project revision: layer geometry diagnostics, `SBSupport.validate` in the project's construction mode (bonded: containment and the support graph, layer-level per adjacent pair; connected: `CONNECTED_SPLIT`), `featureChecks` at the legacy pitch (coarser axis of page / w × h) and `checkEnvelope`. `SBEngine.legacySnapshotHash(view, w, h)` = hashJSON(engine, draft, raster, page, D4 layerHash per layer) scopes the acknowledgements.
- **Preview.** `setFocus({layer, parts, regions, label} | null)`: in the Proof only, a veil over the stack, the focused layer redrawn on top, its listed parts and the regions outlined with a dark-and-light double stroke, and a text tag; cleared by `setFocus(null)`, `setSnapshot` and `setSheets`; `FOCUS` on a layer not in the snapshot.
- **App and markup.** `#diag-panel` (`role="region"`, heading `#h-diag`) in the Review stage: `#diag-summary` (`role="status"`, e.g. "1 blocking, 5 warnings (1 acknowledged) in this draft result."), `ul#diag-list.diag-list` grouped by severity (badge = aria-hidden icon + text label), and `#diag-clear`. Each item shows where, the message, measured vs limit and "Fix: …". An item with a layer is a `<button>` (click, Enter, Space): it switches to the Proof, calls `preview.setFocus`, marks the item `aria-current` and writes "Showing Layer k: title (measured vs limit)" to the status line; Escape in the list or Clear highlight clears it; the focus is re-applied after an appearance re-render and dropped by a new run. Warnings carry an "Acknowledge for this result" checkbox keyed by `SBDiag.ackKey(d, run.geometryHash)`; a new snapshot hash clears the set; blocking items have none. The diagnostics are computed in the deferred `buildView` after `connectedLayers` (with `SBMaterial.assignParts` for part IDs) and also feed `SBProof.overlays` (unsupported regions). A diagnostics failure is reported in the panel and never stops the proof. `.diag-list`, `.badge` (solid / dashed / dotted border per severity, text on the panel ink) and a `:focus-visible` outline in `css/style.css`.
- **Tests.** 27 checks in the G2.13c suite (summarize, describe, legacyDiagnostics / legacySnapshotHash, recording-context focus draws, wiring and CSS). Full suite 1345 passed.
- **QA.** Headless Chromium on `dist`: Demo → "1 blocking, 5 warnings in this draft result." (SAMPLING_LOW 2.88 vs 3 samples at the 720 px legacy pitch; SMOOTH_FALLBACK on layers 2–5 measured vs 0.05 mm; MAT_UNCALIBRATED); keyboard path: focus the first layer item, Enter → Proof tab, layer 2 focused with its tag, item `aria-current`, status names it; Acknowledge → "(1 acknowledged)", keyboard focus kept on the checkbox; Appearance → palette keeps the focus; Escape clears; an edit (sheets − 1) reruns and resets the acks; the layout holds at 200 % zoom (700 px at DPR 2); no page errors.
- **Cost (quick measure, Node, not the large benchmark).** `legacyDiagnostics` on a 720 × 540 synthetic image: acrylic (connected) 0.1 s simple / 0.56 s busy (featureChecks; validate ≈ 0); plywood (bonded) 0.09 s / 0.67 s (validate 0.21 s). Small next to the view build (KI-CONN-PERF), which it joins in the deferred step.
- **Deviations.** (1) The panel reads `SBEngine.legacyDiagnostics` on the legacy view, not `generate` diagnostics; it switches when the app adopts `generate`. Because the legacy draft runs at 720 px, `SAMPLING_LOW` is reported as blocking for typical settings: honest for what the app exports today (the legacy draft sheets), and the export is not gated on it until G3.10 adds the export gate. (2) Acknowledgements are runtime only (scoped by the snapshot hash), not written to `project.acks`; persistence arrives with the export gate and `validation.json` (G3.9/G3.10). (3) `CLEANUP_ALTERED` is still not emitted (G2.13b deviation 1 stands; no product-owner decision to add it). (4) Diagnostics with a layer but no region (e.g. `SMOOTH_FALLBACK`) focus the whole layer. (5) The AT-20 audit (contrast, 200 % zoom, screen reader) is G4.5; here the keyboard path and the text-plus-icon rule are covered.

### Task G2.13d: Clip dialog and revert (SUP-04)

**Files:**
- Modify: `js/app.js`, `index.html`

**Interfaces:**
- "Clip to lower layer" opens the `proposeClip` result: removed area overlay, removed mm², and part count before/after. Accept calls `applyClip`. Each `construction.repairs` entry has a **Revert** button (`removeRepair`). `REPAIR_STALE` and `REPAIR_REVIEW_FAB` items link back to this dialog.
- [x] **QA:** AT-09 and AT-15 flows. **Commit.**

**Result (2026-10-08):**
- **Engine (interim source).** `SBEngine.legacyView(sheets, w, h, cfg, project) → {page, layers, diagnostics, applied}` = `connectedLayers` plus `SBSupport.replayRepairs` of `project.construction.repairs` at draft quality and the project revision (no repairs: exactly `connectedLayers`). `legacyDiagnostics` now includes `view.diagnostics` (`REPAIR_STALE`, blocking), and `connectedFiles(…, colors, project)` cuts the replayed layers, so the proof, the diagnostics, the cards and the exported `sheet_NN.svg` / `proof.svg` agree on an accepted clip.
- **Pure dialog model** (`js/proof.js`). `SBProof.clipReview(proposal) → {layer, title, removedMM2, partCountBefore, partCountAfter, empty, summary, rings}` ("Clip Layer k+1 to Layer k", "Removes X mm² … parts a → b", or "nothing to clip"); `SBProof.repairRows(repairs, {applied}) → [{index, layer, status: applied | stale | pending, laterCount, text}]` (the reviewed record with source → result revision, quality, mm² and parts; `pending` while no current result, never claimed applied); `SBProof.repairForDiagnostic(d, repairs, applied)` (REPAIR_STALE → the skipped entry on that layer, REPAIR_REVIEW_FAB → the replayed one).
- **Preview.** `drawClipCard(canvas, k, removed, {maxPx})`: waste hatch, Layer k dimmed for context, Layer k+1 from the per-snapshot cache, the removed area filled translucent red with a dark-and-light dashed outline (not colour only); `false` without a polygon snapshot.
- **App and markup.** `#dlg-clip` (modal: title, `#dlg-clip-canvas` with an `aria-label`, `#dlg-clip-summary`, note, Cancel / Accept clip / Revert this repair). BOND_UNSUPPORTED items (bonded, layer ≥ 1) carry "Clip to lower layer…"; REPAIR_STALE and REPAIR_REVIEW_FAB items carry "Review clip N…" (via `repairForDiagnostic`). The dialog proposes on the shown view only while it is the current revision's (otherwise the status line says to wait). Accept → `SBSupport.applyClip` → `commitProject` (revision + 1, rerun replays it); Cancel / Escape changes nothing; focus returns to the opener. A Repairs list (`#repair-list`, Review stage) shows every entry with Revert (`removeRepair`; "Revert (and the N later)" when later entries go with it) and, when stale, "Review clip…". From a stale entry, Accept reads "Replace with this clip" and is allowed only when it is the last entry (the shown view is then exactly the geometry without it): `removeRepair` then `applyClip` on that revision; otherwise the dialog says to revert first. `.clipcard`, `.repair-list` and `.diag-actions` in `css/style.css`.
- **Tests.** 18 checks in the G2.13d suite (legacyView = connectedLayers without repairs; accepted clip replayed with the reviewed afterHash and no BOND_UNSUPPORTED; settings change → REPAIR_STALE in legacyDiagnostics, not applied; Revert restores the beforeHash; export cuts the clipped layer only; determinism and no mutation; clipReview, repairRows incl. pending and laterCount, repairForDiagnostic; recording-context drawClipCard; wiring). The G2.12 checks anchored on `SBEngine.connectedLayers(` in `app.js` now accept `legacyView(` (it wraps `connectedLayers`). Full suite 1363 passed.
- **QA.** Headless Chromium on `dist`. The demo scene has no overhang in bonded mode (its tonal masks nest), so the AT-09 flow was driven with a page-level QA patch of `SBEngine.connectedLayers` that adds an 8 mm square to Layer 3 where Layer 2 has no material (deterministic, so the review hashes hold across reruns): BOND_UNSUPPORTED on Layer 3 with "Clip to lower layer…" → dialog "Clip Layer 3 to Layer 2", 480 × 363 card with the square outlined, "Removes 64 mm² … parts 2 → 1"; Accept → revision 2, rerun, BOND_UNSUPPORTED gone, Repairs "1. … revision 1 → 2 … Applied." AT-15 flow: minimum feature 1.2 → 1.5 mm → REPAIR_STALE (blocking) with "Review clip 1…", the BOND_UNSUPPORTED back, the row "Not applied …"; the dialog shows the note and "Replace with this clip" → revision 5 (remove at 4, apply at 5), applied, no blocking; Revert → the repair gone and BOND_UNSUPPORTED back; no page errors.
- **Deviations.** (1) Interim legacy path: the app has not adopted `SBEngine.generate`, so the clip is replayed by `legacyView` on the legacy polygons, which already carry their corner holes; the clip runs after the holes (generate replays before them, stage 9). A repair's hashes therefore belong to the legacy path and fail closed as REPAIR_STALE once the app adopts `generate` (the user reviews again). (2) Accepting or reverting bumps the revision and reruns `legacyRun` although the masks are unchanged (the controller has one regenerate path); the extra ≈ 1 s joins KI-CONN-PERF until G4.1. (3) REPAIR_REVIEW_FAB never appears in the app yet (the legacy run is draft only); its link to the dialog is wired and tested through `repairForDiagnostic`, and its acknowledgement belongs to the fabrication review (G3.10). (4) With a stale entry that is not the last, the dialog offers Revert only (the later entries are reverted with it), because the shown view is then not the geometry the replacement would apply to. (5) Export is not yet gated on a blocking REPAIR_STALE (G3.10 export gate), as for every other blocking item.

### Task G2.14: Source intake: header inspection, raw PNG wiring and explicit preflight (no silent downscale)

**Files:**
- Modify: `js/app.js:519-566` (`loadFile`; delete `downscaleIfHuge`), `js/schema.js` (`limits`, `preflight`)

**Interfaces:**
- Produces: `SBSchema.preflight({bytes, info, deviceClass, project}) → {ok, code?, reason?, suggestDownsamplePx?, rasterPlan, warnings: []}`. `info` comes from `SBPng.inspect` or `SBJpeg.inspect`, so the dimensions are known **before** decoding. `rasterPlan` is the G2.1b fabrication plan for those dimensions, so the pitch, cap and shortfall are shown before decoding (PO-LASER-4/5).
- Intake order:
  1. sniff the signature;
  2. run `inspect` and `check` (both modes);
  3. run `preflight`;
  4. decode. Height PNGs go through `SBPng.decode`; tonal PNG/JPEG use the browser decode (`decode: "canvas-tonal"`, `exifAppliedBy: "browser"`).
- Downsampling happens only through an explicit button. It records a coarser `geometry.fabPitchMM` and a history entry.
- mm/px comes from `rasterPlan` (G2.0 `fabRaster`), never from an assumed long side.

- [x] **Tests:**
  - `IMG-07 desktop 26MiB rejected`
  - `IMG-07 desktop 26.5MP rejected with downsample suggestion` (dimensions from the PNG header; was 17 MP before the desktop cap was raised to 25 MP, 2026-10-08)
  - `IMG-07 JPEG 7000×4000 (28 MP) rejected from SOF before decode` (was 6000×4000 / 24 MP, now accepted on desktop)
  - `IMG-07 mobile 9MP rejected`
  - `IMG-01 tonal APNG and tonal 16-bit PNG rejected at intake`
  - `GEO-06/PO-LASER-5 target raster above source → FAB_EXCEEDS_SOURCE with px shortfall, mm/px from source`
  - `PO-LASER-4 preflight returns the capped pitch for a 470 mm-high page on mobile`
  - `NFR-04 no code path lowers resolution without explicit flag`: a grep check that `downscaleIfHuge` is absent from `js/app.js`
- **Commit.**

**Result (2026-10-08):**
- **Schema.** `SBSchema.limits(deviceClass)` gains the IMG-07 envelope `maxSourceBytes` / `maxSourcePx` (desktop 25 MiB / 16,000,000 px, mobile 10 MiB / 8,000,000 px; inclusive). **Amended 2026-10-08 (product owner, laser target):** desktop `maxSourcePx` = the measured desktop `fabPxBudget`, **25,000,000 px**, a documented deviation from SRS IMG-07 (Appendix D.6 item 4); mobile unchanged. Tests retargeted: `IMG-07 desktop 26.5MP rejected …`, `IMG-07 JPEG 7000×4000 (28 MP) rejected …`, `exactly 25 MP … accepted (limit inclusive)`, the EXIF downsample-target sources (6000 × 4400); new: `IMG-07/PO-LASER-4 desktop source cap equals the measured desktop fabPxBudget …` and `IMG-07 JPEG 6000×4000 (24 MP) accepted on desktop …, still rejected on mobile`. Decode of a 25 MP RGBA source is estimated at ≈ 167 MiB by scaling the S4 16 MP figure (107 MiB), inside the 512 MiB desktop budget. `SBSchema.sniff(bytes)` (PNG/JPEG signature). `SBSchema.preflight({bytes, info, deviceClass, project}) → {ok, code?, reason?, suggestDownsamplePx?: {w, h}, rasterPlan, warnings, intake}` runs before any decode: bytes over the envelope → `SOURCE_TOO_LARGE`; IMG-01 through `SBPng.check` in both modes, a JPEG in height mode → `HEIGHT_NEEDS_PNG`, `SBJpeg.unsupported` → `JPEG_UNSUPPORTED`, `SBJpeg.scanEnd(…).eoi === null` → `JPEG_TRUNCATED` (trailing bytes after EOI stay accepted); `w·h` over the envelope → `SOURCE_TOO_MANY_PIXELS` with the largest same-aspect size inside it. `rasterPlan` is `SBEngine.rasterPlan(…, "fabrication", deviceClass)` on the decoded size with the orientation the decode route implies (browser-applied EXIF 5–8 swaps the size), and `warnings` are its `FAB_PITCH_CAPPED` / `FAB_EXCEEDS_SOURCE`. `intake.decode` is `"raw"` (height PNG, `exifAppliedBy: "engine"`) or `"canvas-tonal"` (`exifAppliedBy: "browser"`). `SBSchema.intake(bytes, {project, deviceClass})` = steps 1–3 (sniff, inspect + check, preflight; an oversized file is refused before inspection; inspect faults return their `PNG_*` / `JPEG_*` code). `SBSchema.applyDownsample(p, {fromW, fromH, toW, toH})` is the explicit downsample: `fabPitchMM` becomes the coarser of the project pitch and `ceil(art/px)` µm of the downsampled source (never finer), `extras.history` gains `{op: "downsample", from, to, fabPitchMM: {from, to}, revision}`, revision + 1 iff the pitch changed.
- **Diagnostics.** `SOURCE_TOO_LARGE`, `SOURCE_TOO_MANY_PIXELS`, `SOURCE_FORMAT`, `HEIGHT_NEEDS_PNG` registered (blocking, process). `EXIF_AMBIGUOUS` (warning, process; Appendix C, S4b) is registered, and preflight adds it to `warnings` when `info.exifAmbiguous` is set on a browser-decoded source. It never rejects the file.
- **App.** `loadFile` refuses a file over `maxSourceBytes` from `File.size` before reading it, then `SBSchema.intake`, then decodes: height PNG via `SBPng.decode` + `SBEngine.orient` (engine EXIF) into a canvas; tonal PNG/JPEG via `createImageBitmap(file)`, never `<img>` (Appendix C, S4b). `downscaleIfHuge` is deleted; the source is kept at its own size. A refusal shows in `#why-source` (persistent) and the status line, and keeps the previous source (NFR-09); `SOURCE_TOO_MANY_PIXELS` shows `#btn-downsample` ("Downsample to W × H px"). The refusal text also shows the plan from preflight, before decoding: the pitch and raster the downsample would give, and `EXIF_AMBIGUOUS` when it is set. An accepted ambiguous file shows the warning in `#why-source`. The button re-runs intake against the current project, because the mode, and with it the decode route, may have changed since the refusal. It then decodes, resamples once and calls `applyDownsample`. Height maps resample with `SBRaster.resample` (nearest, or area when `geometry.resample.height` is `"area"`). On the tonal route, when the browser did not orient the bitmap the way the parsed EXIF says (an ambiguous file), the target follows the decoded orientation instead of refusing. Loads, downsamples and the demo take a generation token (`sourceGen`), so a slower earlier decode never replaces a newer source. `#filein` is reset after each choice, so choosing the same file again fires `change`. A replaced `ImageBitmap` is closed.
- **Tests.** 27 checks in the G2.14 suite (all plan tests plus 11 MiB mobile, inclusive 16 MP, non-image, corrupt PNG, JPEG height map, AT-22 truncated-in-scan and Motion Photo trailing bytes, registry, decode route, EXIF-6 plan size, plan on a rejected source, no mutation, downsample never finer, wiring). After the review fixes the suite has 43 checks: EXIF_AMBIGUOUS registry and preflight, `createImageBitmap` route, `SBRaster.resample` height downsample, generation token, intake re-run, refusal plan text and `#filein` reset. The app.js checks are source checks, not DOM tests; G4.8's browser suite covers the behaviour. Full suite 1406 passed.
- **QA.** Headless Chromium on `dist` (scripted CDP): an 800 × 600 PNG loads at full size (dimbar "800 × 600 px … 2200 × 1650 px short"); a real 4200 × 4100 PNG is refused ("17.2 MP; the desktop limit is 16 MP") with "Downsample to 4048 × 3952 px", which loads 4048 × 3952 at 0.1 mm/px (acrylic 300 mm wide needs no coarser pitch); a GIF → "File is not a PNG or JPEG image"; in height mode a gray PNG goes through the raw path and a JPEG → `HEIGHT_NEEDS_PNG`; no page errors.
- **Deviations.** (1) `suggestDownsamplePx` is `{w, h}` (in the file's stored orientation), not a single number. (2) The history entry lives in `extras.history` because the strict schema has no history section. (3) Four new codes (`SOURCE_TOO_LARGE`, `SOURCE_TOO_MANY_PIXELS`, `SOURCE_FORMAT`, `HEIGHT_NEEDS_PNG`); the plan named none. (4) The app still runs the interim legacy pipeline, so `project.source` (byteHash, sampleHash, decode, orientation) is not yet filled from intake; the browser path's EXIF is applied by the browser as before. (5) `deviceClass()` is still the G2.11c heuristic (coarse pointer and small screen); the `deviceMemory` input and user override remain G4.3. (6) The explicit downsample of a **tonal** source still resamples with the browser's `drawImage` (bilinear), not `SBRaster.resample` "area". The reason is memory: `resample` keeps a `Float64Array` of h·W·c, about 630 MiB for a 24 MP RGBA source (more past 16 MP), on the main thread. The interim legacy pipeline reads tonal sources through `drawImage` anyway, so tonal samples already depend on the browser until the engine path is wired. G4.1 (worker) makes the tonal downsample deterministic with a streamed area resample. Height maps use `SBRaster.resample`. (7) Appendix C's `EXIF_AMBIGUOUS` is a preflight warning that is shown at intake. Recording `orientation.exif` from what the browser did, rather than the parsed value, needs `project.source` to be filled from intake, so it stays with deviation 4 (G2.5).

### Checkpoint: v2.0.0-alpha.2, "experimental bonded relief" (MVP graft)

- [x] Bump `APP_VERSION`/`VERSION` to `2.0.0-alpha.2` (the T0.2 check enforces equality), rebuild `dist/`, and add a CHANGELOG entry with a **known-gaps table**. Until G3 there are no guides, no `.sbrproj` and no manifest, and export keeps the legacy flat layout. Export always regenerates at fabrication quality and requires the fab review (G2.10b rule). Fabrication export stays disabled by `SBDiag.exportGate` whenever any blocking diagnostic exists.
- [x] Add the end-to-end Node check `E2E height plywood preset → 8 layers validated, 0 blocking on ramp fixture`.

**Result (2026-10-08):**
- **Release.** `APP_VERSION` (`js/app.js`) and `VERSION` (`sw.js`) are `2.0.0-alpha.2`; `dist/` rebuilt. `docs/CHANGELOG.md` has `## v2.0.0-alpha.2` (the G2 entries since alpha.1 sit under it) with a **known-gaps table**: guides, `.sbrproj`, manifest/`validation.json`, the legacy flat layout, the minimal fabrication review (no two-phase freeze, no diagnostic-only package), the legacy draft preview, `preview.png` from the draft, main-thread performance (connected mode without a budget, KI-CONN-PERF), tonal determinism, the unfilled source record and calibration.
- **Export rule (G2.10b, LYR-06, EXP-07).** Until this checkpoint the app exported the legacy draft run (`connectedFiles`) ungated, so the checkpoint wires the minimal fabrication path. New pure `SBEngine.fabricationRequest(project, {pixels, channels, w, h, alpha}, {requestId, deviceClass, format, decode})` (quality `fabrication`; the source record names the decoded, already oriented pixels, `exifAppliedBy: "none"`) and `SBEngine.fabricationFiles(snapshot, project, colors)` (`sheet_NN.svg` per exported layer, NN = index + 1, `omitted-trailing` layers get no file and keep the gap; `proof.svg`; connected sheets keep the v1.1.0 text label until G3.2; a non-fabrication snapshot is refused with `QUALITY`). In the app, Download reads the source at its own size, runs `SBEngine.generate` at fabrication on the main thread, shows the run in the new `#fab-review` (Export stage) with warning acks keyed on the fab `geometryHash` (draft acks never reused), and builds the ZIP only if `SBDiag.exportGate(…, "fabrication")` allows it. Blocking items or a failed run (e.g. `COMPLEXITY_LIMIT`) disable Export with the reason; unacknowledged warnings stop the download until acknowledged. The run is reused while the revision, source and device class are unchanged; any geometry edit hides the review.
- **Tests.** Checkpoint suite (14 checks): the E2E check above (400 × 100 px ramp, plywood preset at 0.1 mm/px: 8 layers, 0 blocking, `MAT_UNCALIBRATED` only), the gate before and after acks, the flat layout, the trailing-empty gap, the draft refusal, the connected label, app wiring and the CHANGELOG table. Retargeted: `DEP-02 release 2.0.0-alpha.2`, G1.7 `buildAndDeliver` → `fabricationFiles`, G2.13d SUP-04 "the export passes the project" → `fabricationRequest(project, …)`. Full suite 1420 passed.
- **QA.** Headless Chromium on `dist` (scripted CDP): Demo (acrylic, connected) → Download runs fabrication at 900 × 680 px in 4.2 s, lists 6 warnings and 1 info, refuses until all 6 are acknowledged, then delivers `sheet_01..05.svg`, `proof.svg`, `ASSEMBLY.md`, `settings.json`, `preview.png`. Switching to bonded relief (mode review accepted) hides the review; the next Download regenerates (1.1 s, 2 warnings). No page errors. B3b (`bench support`, quick): p95 1.27 s (< 3 s).
- **Deviations.** (1) The plan's export rule is wired here as a minimal subset of G3.10 (no freeze or cancel during the run, no diagnostic-only package, no delivery states); the draft preview stays on the legacy pipeline. (2) Every mode exports through `generate`, connected too; connected mode with smooth corners has no performance budget (KI-CONN-PERF, known gap). (3) Fabrication review items do not focus the Proof, which shows the draft geometry. (4) Clip repairs reviewed on the legacy draft fail closed as `REPAIR_STALE` in the fabrication run (G2.13d deviation 1), so they block until reviewed again.

**G2 exit (SRS §13.1):** green on:
- height fixtures (AT-02 to AT-05), including the AT-02 explicit-filter check;
- loose-part support (AT-08);
- repair, including stale and fab re-review (AT-09);
- feature checks (AT-10);
- proof agreement (AT-11, Node part);
- legacy regression (AT-21, via G2.4/G2.4b).

Then expand G3–G5 into step-level plans (`docs/plans/g3-…md`, `g4-…md`, `g5-…md`) using the task specs below.

---

## 9. Phase G3: assembly and reproducibility

Each task below is fully specified. It is expanded into step-level TDD before execution, as described at the end of G2.

| Task | Work | Files / interfaces | Named checks | Reqs |
|---|---|---|---|---|
| **G3.1** Holes and guides inside the engine chain (former G3.1 part IDs moved to G1.1) | Fill the G2.10a placeholders. **Stage 10:** `SBGuides.registration(preHoleLayers, cfg)` proposes holes from the pre-hole material, then `subtractHoles`. **Stage 14:** `SBGuides.build(layers, cfg)` and then `SBGuides.validate`. A guide that fails validation gives `GUIDE_UNCONTAINED` (blocking, a bug guard). Guides and holes enter `canonicalBytes`/`guideHash`. Every replayed repair is followed by guide regeneration (SUP-04). | `js/engine.js`; `SBGuides.validate(layers, guides) → Diagnostic[]` | `GEO-07 guides and holes validated in every generate`; `SUP-04 clip → guides rebuilt, guideHash changes`; `NFR-05 guides in geometryHash` | GEO-07, SUP-04, §11.1 |
| **G3.2** Vector labels and interior point [UP] | Single-stroke font; pole-of-inaccessibility interior point. Delete `legacyTextLabel` from `layerSVG`. | `js/strokefont.js` `SBFont.strokes(text, heightMM) → polylines (µm)`; `SBGeom.interiorPoint(poly, clearanceUm) → [x,y]\|null` (grid refinement, integer, deterministic) | `EXP-03 FIXED: layerSVG never emits <text>` (retargeted; delete the shim check); `AT-13 small part ID exported as paths only`; `ASM-03 crescent interior point inside with clearance`; `ASM-03 donut point not in hole`; `DEP-04 connected sheet label now vector strokes` | ASM-03, EXP-03 |
| **G3.3** Guides | Modes `none`, `inset-outline`, `interior-mark`. Guides for layer k+1 are scored on layer k. **Centreline region** `Rc = offset(upper, −(concealInset + allowance + footprint/2)) ∩ offset(lower, −footprint/2)`. **Burn region** `Rb = offset(upper, −(concealInset + allowance)) ∩ lower`. ID labels use a label box of `labelHeightMM` in the same test. An empty region omits the mark, raises `GUIDE_OMITTED` with a reason, and falls back to the map. `allowanceMM == 0` raises `ALIGN_CLEARANCE_ZERO` (warning). Guides carry the `canonicalHash` of both layers, are invalidated when either changes, and are written to `part.guideRefs`. All offsets use miter joins. | `js/guides.js` `SBGuides.build(layers, cfg) → {scoreByLayer, labelsByLayer, omitted, byPart}` | `AT-14 crescent/donut/small part: difference(buffer(polyline, footprint/2, square), Rb) empty` (segment-level, not vertex-only); `ASM-02 concealment inset default 0.5 mm, separate from footprint`; `ASM-02 too-small part → omitted + reason`; `SUP-05 stale guide invalidated on hash change`; `§4.5 zero allowance → ALIGN_CLEARANCE_ZERO`; `AT-14 no hidden mirror` | ASM-01, ASM-02, SUP-05 |
| **G3.4** Registration holes | Off by default in bonded mode. Opt-in hole positions must fit **with `edgeClearanceMM`**, as `offset(circle, clearance)` inside material, on every selected layer; otherwise `REG_HOLE_INVALID` (blocking). Holes are subtracted **before** validation, so a hole set that leaves upper material over a drilled lower layer is reported as `BOND_UNSUPPORTED` by the normal checks. The UI recommends `"all"`. Replaces the G1.7 legacy corners (from `svgout.js:54-61`). | `SBGuides.registration(layers, cfg) → {holes, diagnostics}`; consumed by `SBMaterial.subtractHoles` | `ASM-04 bonded default no holes`; `ASM-04 hole over void rejected`; `ASM-04 hole within edge clearance of a boundary rejected`; `ASM-04 partial-stack holes under upper material → BOND_UNSUPPORTED`; `AT-06 hole in frame accepted (connected)` | ASM-04 |
| **G3.5** Placement map and instructions | Printable map of every part ID; pure `ASSEMBLY.md` generator with separate bonded and connected texts. The kerf text (`app.js:339-340`) and spacer text (`app.js:349-351`) are rewritten. The guide names the machine profile (processing area, stock width, max thickness) and states the recorded kerf (0.15 mm by default) as information for the operator's laser software; no offset is applied (MAT-05, PO-LASER-1/7). | `SBSvg.placementMapSVG(snapshot, guides)`; `js/docs.js` `SBDocs.assembly(project, snapshot) → string` (replaces `app.js:311 buildAssemblyMD`) and `SBDocs.COPY` | `ASM-01 map lists every part ID`; `ASM-05 contains front face, base-to-front order, every part ID with support refs, keep/discard, omitted layers, which guides belong to which layer, zero gap, nominal vs measured`; `MAT-05 "no kerf offset applied (kerfMode=external)"`; `NFR-12/EXP-09 no speed/power values` (regex `/\b\d+(\.\d+)?\s*(%\|mm\/s\|mm\/min\|k?W)(?!\w)/i` absent); `EXP-09 downstream-edit warning present`; `ASM-05 bonded text contains no "spacer"`; `MAT-01/MAT-04 disclaimers present in ASSEMBLY.md` | ASM-01, ASM-05, MAT-01, MAT-04, MAT-05, EXP-09, NFR-12 |
| **G3.6** Revisions, undo/redo and frozen snapshots | Monotonic revisions; command stack of config patches, filter changes and repair ops, depth ≥ 20; deep-frozen snapshot; export reads only the snapshot whose revision equals the revision current when export started | `js/project.js` `SBProject.create(p)`, `.apply(patch)`, `.undo()`, `.redo()`, `.freeze(snapshot)` | `PRJ-04 25 undos restore config`; `PRJ-04 revisions monotonic`; `PRJ-04 repair op in history with source/result revisions`; `SUP-04 undo of repair restores prior hash`; `IMG-03 heightFilter change is an undoable entry`; `EXP-05 snapshot immutable after later edits` (Review Focus 5) | PRJ-04, EXP-05, SUP-04 |
| **G3.7** Safe ZIP reader | Central-directory parser; stored entries plus deflate-raw through `DecompressionStream("deflate-raw")`; running byte budget | `SBZip.read(bytes, {maxEntries: 1024, maxBytes}) → Promise<Map<name, Uint8Array>>` | `§9.4 ../ traversal rejected`; `absolute/backslash path rejected`; `duplicate entry rejected`; `>1024 entries rejected`; `declared vs actual size mismatch rejected`; `expanded > limit aborts`; `nested .zip/.sbrproj rejected`; `round trip with SBZip.build` | §9.4, NFR-06, PRJ-03 |
| **G3.8** `.sbrproj`, migration and legacy import | The container holds `project.json`, `source/samples.bin`, `source/meta.json` and optionally `source/original.*`. Validate **before** replacing the open project. Explicit `migrate(from → to)`. An unknown newer major is rejected and the current project kept. Legacy import uses `SBSchema.fromLegacySettings` (G2.4b) and `resolveLegacy` when a source is attached. | `SBProject.pack(project, samples) → Uint8Array`; `SBProject.unpack(bytes) → Promise<{project, samples}>`; `SBSchema.migrate(obj)` | `AT-17 save→load without original → identical geometryHash`; `AT-17 app-version bump → identical geometryHash`; `IMG-02 sample hash verified on load (SBHash.digest)`; `PRJ-06 newer major rejected, current untouched`; `DEP-05 no silent downgrade`; `AT-21/DEP-04 v1.1.0 settings + source → tonal+connected, same bands and polarity`; `AT-22 unknown geometry key in project.json rejected` | PRJ-03, PRJ-06, DEP-04, DEP-05 |
| **G3.9** Fabrication package and manifest | Exact §9.4 layout through a pure `filePlan` (MVP graft); ZIP name `<sanitized-title>_fabrication.zip`. **Manifest (EXP-06, every SRS:L330 field):** schema, app and engine versions, **upstream baseline `f0552c7`**, `sourceHash`, `sampleHash`, units, **dimensions (artwork and finished page)**, **interpretation mode, polarity and threshold rule**, thresholds used (normalized and mm), **material settings (thickness, state, calibrated, calibration record)**, **resolution (quality, raster w×h, mm/px, resample method)**, tolerances, inventory including omitted indices, Z per layer, conventions (mm, Y-down, front face, no mirroring), `kerfMode:"external"`, **machine profile with its kerf (informational, PO-LASER-1/7)**, **target and actual pitch, pixel budget, device class, cap reason and source shortfall (PO-LASER-4/5)**, support graph, per-file SHA-256 (`SBHash.digest`), and separate uncertainty fields (D-4.2). **`validation.json`:** every diagnostic with `ackState`, plus the **cleanup report in mm²** (added and removed area, holes filled, parts removed) (GEO-08). The tilt PNG is optional: if present it is `proof/illustrative-tilt.png` with an "illustrative" label, and it is outside the exact-inventory check. | `js/package.js` `SBPackage.filePlan(snapshot, opts) → [{path, kind}]`; `SBPackage.buildFabrication(snapshot, project, opts) → files[]`; `app.js:399 buildAndDeliver` becomes a thin call | `EXP-04 inventory exact` (`cuts/layer_00_base.svg`, `cuts/layer_01.svg`…, `proof/assembly.svg`, `proof/placement-map.svg`, `ASSEMBLY.md`, `manifest.json`, `validation.json`, `settings.json`, `project.sbrproj`; tilt PNG optional); `EXP-04 zip name <title>_fabrication.zip`; `EXP-01 trailing-empty layer has no file, index gap kept`; `EXP-06 manifest has every SRS:L330 key`; `EXP-06 manifest hashes match file bytes`; `GEO-08 validation.json cleanupReport in mm²`; `AT-16 generate twice → byte-identical SVGs and manifest except timestamp`; `NFR-06 hostile title escaped in SVG/MD/JSON/filenames` (Review Focus 4); `SUP-03 support graph in manifest` | EXP-01, EXP-04, EXP-05, EXP-06, SUP-03, MAT-05, GEO-08, NFR-06 |
| **G3.10** Two-phase export, delivery states and bed check | **Phase 1:** freeze the current revision and generate at fabrication quality (worker). **Phase 2:** open the review panel scoped to that fab snapshot's `geometryHash`. It lists blocking items, unacknowledged warnings and any `REPAIR_REVIEW_FAB`, and the user acknowledges the warnings there. **Phase 3:** package only if `exportGate(fabDiags, acks, fabSnapshot, "fabrication").allowed`. Any edit during phases 1–2 marks the result stale and cancels. Export is disabled while stale, processing or blocked. **Diagnostic-only package:** `<title>_NOT-READY-TO-CUT_diagnostic.zip` contains `project.sbrproj`, `validation.json`, `manifest.json` and `proof/` but **no `cuts/`**; its README states it is not for cutting. `deliverFile` (`app.js:449`) returns `"generated"`, `"handed-off"`, `"canceled"` or `"failed"`. The machine envelope check (`PAGE_OVERFLOW`, `MACHINE_THICKNESS`; G2.10a, from `project.machine`, either orientation) is blocking, so the gate refuses the cut package and offers only the diagnostic package; nothing is rescaled. | `SBDiag.exportGate` (G2.2); `SBPackage.buildDiagnostic(...)`; `SBPackage.deliveryState(event)`; `SBSupport.checkEnvelope(page, machine, material)` (G2.10a) | `EXP-07 blocking → disabled`; `EXP-07 draft acks do not satisfy fab gate`; `EXP-07 fab warnings acked in fab review → allowed`; `AT-15 diagnostic-only package has no cuts/ entries and is labelled NOT READY TO CUT`; `EXP-08 share AbortError → canceled, project intact`; `GEO-10/PO-LASER-2 page > machine area (w or h) blocks export, no rescale` | EXP-07, EXP-08, GEO-10, LYR-06, NFR-09 |
| **G3.11** Autosave and recovery | Debounced `.sbrproj` written to IndexedDB through an injectable storage adapter, with a recovery prompt. On quota or private-mode failure, show a persistent "Unsaved" badge and a "Download project" button. Wire the result of the existing `navigator.storage.persist()` call (`app.js:656`, `:679`) into the autosave status ("storage may be cleared"). | `SBProject.autosave(store, project)`, where `store` is `{put, get}` | `PRJ-05 quota error → unsaved flag + download offered` (fake store throws `QuotaExceededError`); `PRJ-05 persist() false → status shows non-persistent storage` | PRJ-05 |

**G3 exit:** AT-14 to AT-17 and the AT-22 import subset are green. A sample package is checked into `docs/samples/` for review. Release `2.0.0-beta.1`.

## 10. Phases G4 (hardening) and G5 (fabrication release)

| Task | Work | Files / interfaces | Named checks / evidence | Reqs |
|---|---|---|---|---|
| **G4.0** Service-worker update gating (**before G4.1**) | Remove the unconditional `skipWaiting()` (`sw.js:46-48`). A waiting worker shows "Update available"; `skipWaiting` runs only on user action and never while the project is unsaved or an export is in progress. One cache per version; visible cache/update status. Because a dedicated worker's `importScripts` goes through the controlling SW, the worker must never mix versions (G4.1 handshake). | `sw.js:19-66`, `app.js:664` | `DEP-02 sw.js has no unconditional skipWaiting in install`; `DEP-02 VERSION == APP_VERSION` (T0.2); AT-23 evidence | DEP-02 |
| **G4.1** Worker pool, cancel and stale handling (§9.3; expanded 2026-10-08, KI-CONN-PERF) | **Worker pool:** a pool of Web Workers sized `min(navigator.hardwareConcurrency − 1, cap)` (at least 1; cap recorded per device class, e.g. 8 desktop / 4 mobile) parallelises the per-layer and per-adjacent-pair stages — trace / `SBMaterial.fromMasks`, connected smoothing, the adjacent-pair differences, the support pass, `layerSVG` and the layer hashes — and merges results in a **deterministic order** (layer index, then pair index), so `materialHash`, `layerHash` and `geometryHash` are unchanged by pool size or scheduling (test: hashes equal for pool sizes 1, 2 and N). Every pool worker passes the engine-version handshake. The pool may be pulled earlier than G4 if performance blocks progress. `js/worker.js` `importScripts`s the pure modules in §4 order and runs `SBEngine.generate`. Messages follow §3 `GenerateRequest`/`GenerateResponse`: `engineVersion` is checked both ways (a mismatch rejects and reloads the worker), `status: "progress"` messages are posted per stage, and the response carries `validatedLayers`, `diagnostics` and `geometryHash`. The controller accepts a response only if `requestId` and `revision` match. It **transfers a copy** of `normalizedSource.pixels`, so the project keeps its own copy. Cancel = `worker.terminate()` plus respawn (< 500 ms). Packaging runs in the worker. `build.js` **changes**: it emits the worker modules as `<script type="text/sb-worker">` and starts a Blob worker in `dist/`. On `file://` failure it falls back to chunked main-thread execution with a notice. | `SBDiag.acceptResult(active, response) → boolean` (pure) | `AT-15 stale response discarded`; `§9.3 engineVersion mismatch rejected`; `AT-15 cancel during export keeps last revision and source`; `§9.3 progress messages precede done`; `NFR-05 worker pool hashes equal for pool sizes 1, 2, N`; `§9.3 every pool worker passes the engine-version handshake`; four-list consistency extended to `worker.js` | NFR-02, UI-06, §9.3, NFR-09, KI-CONN-PERF |
| **G4.2** Draft vs fabrication pipelining | The G2.10b rule is already enforced. This task makes the fab generation run in the worker while the UI stays responsive, caches the last fab snapshot per revision, and shows "Preparing fabrication geometry…" in the export flow. | `js/app.js`, `js/worker.js` | `LYR-06 export regenerates at the fabrication rasterPlan (G2.1b) in worker`; `LYR-06 cached fab snapshot reused only for the same revision` | LYR-06 |
| **G4.3** Resource envelope (complexity caps moved to G2.7b, 2026-10-08) | `deviceClass()` uses `deviceMemory` plus coarse pointer, with a user override. `SBSchema.limits(deviceClass).fabPxBudget` carries the G2.2b budgets (PO-LASER-4: desktop 25 Mpx, mobile 1 Mpx). The working-set estimate is `w·h·bytesPerStage` on the `rasterPlan` raster; over budget means reject or offer an explicit downsample. The per-device complexity caps and busy-art simplification are **G2.7b** (moved forward after G2.2b); G4.3 re-checks them on the reference devices with the G4.4 numbers. Also applies the mobile `.sbrproj` 64 MiB limit. | `SBSchema.estimateWorkingSet(w, h, N)`, `SBSchema.limits(deviceClass)` | `NFR-04 estimate > 192 MiB on mobile → reject code`; `§9.4 mobile maxBytes 64 MiB` | IMG-07, NFR-04 |
| **G4.4** Benchmarks | `test/bench.js <stage>`: 5 warmups then 30 runs, reporting p50/p95/max as JSON in `docs/perf/`, plus an in-app `?bench`. Workloads: the SRS §12.3 desktop reference (1536 × 1536 samples, 8 layers; the NFR-03 acceptance workload, unchanged), the **mobile reference (768 × 768 samples, 6 layers, ≤100 parts/layer, ≤20,000 vertices)**, and the **laser-detail workloads of G2.2b** (desktop and mobile at their pixel budgets, PO-LASER-9), re-measured on the reference machines against the targets recorded in D6. Cancellation latency is measured in both. **KI-B1 (tracked):** B1 keeps its 2 s budget; G4.4 resolves the ≈2.14 s p95 overrun from the S6 T-split by optimizing `SBGeom` normalize (numeric vertex keys, skip noding when no collinear contact exists, normalize once per boolean; S5 F5 measured worst-case union + normalize 19 s vs 5.9 s for the union alone), then removes the `TRACKED.B1` entry from `test/bench.js`. | — | Desktop p95: draft ≤ 1.5 s, final plus validation ≤ 10 s, package ≤ 5 s. **Mobile p95: final plus validation ≤ 8 s**, measured on the recorded ≥4 GB device. Cancel ≤ 500 ms on both. **Laser-detail p95 within the D6 targets** (10 s unless G2.2b recorded a relaxed one). | NFR-02, NFR-03, AT-24, PO-LASER-9 |
| **G4.5** Accessibility | Keyboard path through stages, tabs, diagnostics and dialogs; `aria-live` status; focus styles; `prefers-reduced-motion` disables the tilt animation; **200% zoom** layout check; audit in `docs/A11Y_AUDIT.md`; browser matrix in `docs/ACCEPTANCE.md` | `index.html`, `css/style.css`, `app.js` | AT-20 evidence, including 200% zoom and reduced motion, and proof/section available without tilt | NFR-07, NFR-08, UI-04 |
| **G4.6** Local server path and deployment docs | README (replacing "No server" at `README.md:18`): serve locally with `python3 -m http.server 8000` (or any static server) and open `http://localhost:8000`. Production needs HTTPS for the service worker and workers. `file://` gives reduced responsiveness (open question 10). The T0.2 four-list test stays the only `SHELL` guard; there is no generated `SHELL`. | `README.md`, `docs/DEPLOY.md` | `DEP-01 README documents local server and HTTPS`; AT-23 evidence | DEP-01 |
| **G4.7** Locality and reproducible build | A test checks that no remote URL appears in `index.html` or `dist/` in a **loading context** (`src=`, `href=`, `url(`, `fetch(`, `importScripts(`, `import(`), plus any literal `https?://` outside an allow-list of XML namespace URIs (`http://www.w3.org/2000/svg`, `http://www.w3.org/1999/xlink`) and comments. `build.js` writes `dist/BUILD.json` with a **source-tree content hash** (SHA-256 over the inlined inputs in order), the per-file hashes and the component list. It records no git commit. | `build.js`, `run_tests.js` | `NFR-01 no remote URLs in bundle (namespaces allow-listed)`; `DEP-03 build twice → identical dist and BUILD.json`; `NFR-11 every vendor file listed in COMPONENTS.md with matching SHA-256` | NFR-01, NFR-11, DEP-03 |
| **G4.8** Browser integration harness and cross-browser determinism | `test/browser.html` loads the real modules (and `dist/`) and runs integration suites. It covers: canvas decode plus EXIF=6 JPEG (applied once), the PNG intake path, `DecompressionStream`, the worker round trip and cancel, SW registration and update gating, and `geometryHash` of 5 fixture projects. Results are written to the DOM as JSON. Driven by `chromium --headless=new --dump-dom file://…/test/browser.html?run` (no npm) in `test/run_browser.sh`. Firefox and Safari run manually and record the same JSON. A dev-only component entry goes in `COMPONENTS.md` if any helper is vendored. | `test/browser.html`, `test/run_browser.sh` | `NFR-10 browser integration suites pass in Chromium headless`; `NFR-05/AT-23 geometryHash identical across Chromium, Firefox, Safari and Node for 5 fixtures`; `IMG-05 EXIF 6 JPEG oriented once` | NFR-05, NFR-08, NFR-10, AT-23 |
| **G5.1** Calibration coupon and calibration record | Optional `calibration/coupon.svg`: 100 mm square outer dimension, kerf comb, a feature ladder of 1.0–3.0 mm narrow webs that includes the 1.5 mm minimum and the 2.0 mm advisory width (PO-LASER-6), **representative holes (3 mm, 5 mm, 8 mm via `SBGeom.circle`)**, sample score marks, no laser settings. A form records `material.calibration` (date, machine, material, measured kerf, smallest successful feature, score result, notes), which goes into the manifest (MAT-06, AT-19). | `SBSvg.couponSVG()`; `SBPackage` option; `js/app.js` form | `MAT-06 coupon only when requested`; `MAT-06 coupon contains holes, narrow webs, score marks`; `AT-18 100 mm square exact in µm`; `MAT-06 calibration record stored and exported` | MAT-06, PO-LASER-6/7 |
| **G5.2** Acceptance evidence | LightBurn import within 0.1 mm (AT-18); calibration workflow (AT-19); three plywood projects cut and glued (AT-25); browser and offline matrix (AT-23); mobile benchmark (AT-24) | `docs/ACCEPTANCE.md`, `docs/RELEASE_RECORD.md` | AT-18, AT-19, AT-23, AT-24, AT-25 signed off | EXP-09, NFR-08, NFR-12, DEP-01 |
| **G5.3** Release v2.0.0 | Bump `APP_VERSION` and `VERSION`; CHANGELOG with the intentional legacy fixes (frame union, proof extent, groups, bounded smoothing, resampling change, no auto-demo, ZIP layout and name); rollback notes (an older build refuses schema v2+ projects); `COMPONENTS.md`; rebuilt `dist/` | docs, `sw.js`, `app.js:23` | AT-26 evidence | DEP-03, DEP-04, DEP-05, NFR-11 |

---

## 11. Risk register (ranked)

| # | Risk | Impact | Mitigation | Kill / fallback |
|---|---|---|---|---|
| R1 | Geometry backend is not robust, too slow, too large, or not loadable as a classic script | Blocks G1 and every GEO/SUP/ASM requirement | S1 battery, load-form checks and benchmarks (difference, offset, support pairs); all calls go through the `SBGeom` adapter; the battery becomes the regression suite | Exact orthogonal booleans and lattice offsets (bonded edges stay faceted) |
| R2 | Containment-aware smoothing falls back to raw so often that smoothing is useless in bonded mode | Faceted bonded edges | **Realized and decided (S2, D1, 2026-10-07):** whole-loop fallback rounds 2.8 % of bonded corners on real images. Bonded ships unsmoothed; connected keeps G1.2 smoothing. Per-vertex lazy pinning (S2 option (c), 70–84 % rounded) is a deferred enhancement gated on NFR-03 (final + validation p95 ≤ 10 s desktop, ≤ 8 s mobile at fabrication pitch; prototype 13.4 s on busy-1536) | **Active:** bonded is unsmoothed (option (b)); nesting holds by construction |
| R3 | Cross-browser non-determinism (decode, transcendental math, joins) | AT-16/17/23 fail; NFR-05 broken | Raw PNG decoder; hard-coded hash constants; miter/square joins only; integer circle table; integer resampler; `.sbrproj` stores samples; G4.8 cross-browser hash comparison | Store canonical geometry in `.sbrproj` and treat it as authoritative on reopen |
| R4 | Engine extraction or resampling changes connected-mode output | AT-21 regression | Persisted goldens (sheetMasks, thresholds, oldRun, legacy SVG); the resample change is documented; DEP-04 table | Revert to `legacyRun` for connected mode |
| R5 | Fabrication resolution plus booleans exceed 10 s (desktop) or 8 s (mobile) p95, or the memory budget; **sharpened by the 0.1 mm/px target (PO-LASER-4): 16 Mpx is about 7× the SRS 1536² workload** | NFR-03 and NFR-04 fail | Large-image benchmark G2.2b sets the per-device pixel budget **before** the engine work; support benchmark from G2.7 (B3b < 3 s); bbox sweep; diagnostic aggregation; worker (G4.1 pool); per-device complexity caps with `COMPLEXITY_LIMIT` and explicit busy-art simplification (G2.7b; G2.2b showed busy cost follows part count, not pixels) | Coarsen the target pitch or lower the pixel budget only through an explicit UI choice or a recorded D6 change, never silently |
| R6 | Two-phase export and fab re-review of repairs feel heavy to users | Friction, ignored warnings | Aggregated diagnostics; review panel shows only fab-new or changed items prominently; the fab snapshot is cached per revision (G4.2) | Pre-generate the fab snapshot in the background after edits settle |
| R7 | Four-list, `dist/` or SW drift breaks offline use or serves mixed versions | Broken PWA, wrong hashes | T0.2 hygiene checks; SW off on localhost; G4.0 before G4.1; engine-version handshake | — |
| R8 | `DecompressionStream` missing on old Safari (< 16.4) | PNG and ZIP read fail | Feature-detect and block with an explanation; NFR-08 only targets current and previous browser versions | — |
| R9 | MUST-everywhere SRS means non-compliance until G3 | Pressure to ship partial work | Experimental alpha.2 checkpoint with a known-gaps table; the export gate stays strict | — |
| R10 | Vendored library goes unmaintained | Long-term burden | Thin adapter; pinned SHA; licence in `COMPONENTS.md` | Swap the backend behind `SBGeom` |
| R12 | Typical sources have fewer pixels than the 0.1 mm/px target at laser sizes (e.g. 4700 px for a 470 mm-high piece) | Frequent `FAB_EXCEEDS_SOURCE` warnings; users may expect detail the source does not hold | Warning states the px shortfall and that detail cannot be recovered (GEO-06); dimbar shows it before generation; never upsample | Product owner may relax the target pitch in the profile |
| R11 | NFR-10 browser integration tests need tooling the repo forbids | Release blocked or waiver needed | Headless Chrome `--dump-dom` harness with no npm (G4.8) | Tracked NFR-10 waiver with product-owner approval (open question 18) |

## 12. Self-review notes

- **Coverage:** every ID in SRS §4–§12.3 appears in §1 with at least one task. Manual-only acceptance tests are routed to G5.2 and `docs/QA_CHECKLIST.md`; browser behaviour goes to G4.8.
- **Type consistency:** these names are used identically everywhere:
  - `SBHeight.cumulativeMasks`, `tonalAdded`, `applyFilter`;
  - `SBRaster.resample`, `rasterSize`;
  - `SBMaterial.fromMasks`, `smoothStack`, `assignParts`, `applyFrame`, `subtractHoles`;
  - `SBSupport.validate`, `featureChecks`, `proposeClip`, `applyClip`, `removeRepair`, `replayRepairs`;
  - `SBDiag.make`, `aggregate`, `ackKey`, `exportGate`;
  - `SBEngine.generate`, `legacyRun`, `orient`;
  - `SBSvg.layerSVG`, `assemblySVG`;
  - `SBSvgRead.parse`;
  - `SBPng.inspect`/`check`/`decode`, `SBJpeg.inspect`.

  There is no `SBMaterial.conform` (removed in rev 2). Diagnostic codes are defined once, in G1.0.
- **Verified while writing:**
  - the `SBHash.sha256` code (NIST vectors and padding boundaries, against `node:crypto`), with the hard-coded constants printed from the same derivation;
  - the integer quantization formula (all N in 1..16, all s in 0..255);
  - `tonalAdded` + `cumulativeMasks` ≡ `R.sheetMasks` (N 3..8, both polarities, balanced and linear);
  - `sheetSVG(borderTouch)` emits `M 10 10 L 10 30 L 60 30 L 60 10 Z`;
  - the per-layer morphology chain preserves nesting (0 violations, 200 seeds, featR 1/3/8).
- **Known approximation:** the analytic Chaikin deviation constant in G1.2 is confirmed by the S2 script before commit (measured 176.78 µm by the review).
- **Placeholder scan:** `<lib>` in S1 is intentional and is resolved by decision D2. G2.10a stages 10 and 14 are explicit placeholders that G3.1 fills.
- **Task count:** 69 tasks:

| Phase | Tasks |
|---|---|
| G0 | 7 |
| Spikes | 6 |
| G1 | 8 |
| G2 | 25 |
| G3 | 11 |
| G4 | 9 |
| G5 | 3 |

---

## Appendix A. Review notes (rev 2)

Three reviews (coverage, code-accuracy, execution) were checked against the SRS and the code. Most critiques were applied as written. Some were applied in a different form, and one was rejected outright. Those are listed below.

| Critique | Disposition | Reason |
|---|---|---|
| Code-accuracy #3: per-layer bonded morphology creates whole-pixel overhangs, so `BOND_UNSUPPORTED` would block most images | **Rejected** (the property test it proposed is kept, G2.6) | `open`, `close`, `removeSpecks` and `fillHoles` with equal radii are increasing, so nesting is preserved. Re-measured: 0 violations over 200 seeds at featR 1/3/8, matching the execution review's own measurement. The old `KNOWN-DEFECT GEO-07` compared `close(upper)` with a raw `lower`, which never happens in the pipeline. GEO-07 is recharacterized as islands bridges plus per-layer polygon smoothing. |
| Coverage #1: keep `conform` as an opt-in reviewed repair | **Modified** | `conform` is removed entirely. Containment-aware smoothing (GEO-04 fallback) prevents smoothing overhangs, and `proposeClip` is the single reviewed repair. A second repair path would duplicate SUP-04 review logic. |
| Coverage #8: decode with `createImageBitmap(…, {imageOrientation: "none"})` and apply EXIF in the engine | **Modified** | Current browsers treat `"none"` as `"from-image"`, so EXIF cannot be reliably suppressed. The browser path records `exifAppliedBy: "browser"`; the raw PNG path applies `eXIf` in `orient`. Single application is tested in Node and in the G4.8 browser harness (EXIF=6 JPEG). |
| Coverage #33: require registration layers to be a contiguous run starting at the base | **Rejected** (`edgeClearanceMM` and coupon holes accepted) | A run starting at the base leaves upper material over the drilled holes, which is exactly what makes it unsupported. Holes are subtracted before validation, so any unsupported result is caught by `BOND_UNSUPPORTED`; the UI recommends `"all"`. |
| Execution #4: key acks by `(code, layer, geometryKeyHash)` | **Not adopted**; coverage #19's two-phase export was used instead | LYR-06 says diagnostics are never reused across resolutions, and fab diagnostics can differ (areas, part counts, new parts). Acks are scoped to the fab snapshot. Repair replay *is* made resolution-independent (`keyHash`) with a `REPAIR_REVIEW_FAB` re-review, as execution #4 suggested. |
| Coverage #25: vendor a pinned Playwright | **Not adopted**; open question 18 added | Playwright needs npm and downloaded browser binaries, which repo policy forbids. G4.8 uses headless Chrome `--dump-dom` with an in-repo harness, with a tracked waiver as the alternative. |
| Coverage #14: integer-only offsets | **Modified** | Miter/square joins are allowed: they need only `Math.sqrt` and arithmetic, which ECMAScript requires to be correctly rounded. Round joins and trig are banned in hashed paths. |
| Execution #3: pin legacy tonal equality on a full RGBA→masks golden | **Modified** | Byte equality is pinned on fixed luminance input (sheetMasks golden) and on `legacyRun` (oldRun golden). End to end from an image, the guarantee is "same bands and polarity", because v1.1.0 resampled twice on a browser canvas (execution #11 makes the same point). |
| Execution #6: keep `sheetSVG` for connected export until G3.2/G3.4 | **Modified** | Connected export moves to the canonical path in G1.7. The v1.1.0 corner holes are ported via `SBGeom.circle`, and the label via a temporary `legacyTextLabel`, so nothing is lost in alpha.1. |
| Code-accuracy #9 / execution (G4.6): `build.js` generates `SHELL` | **Dropped** | `build.js` strips the PWA plumbing from `dist/` and `sw.js` is a hand-written source. The T0.2 four-list test remains the guard. |
| Execution #12: move G2.2 and G3.1 earlier | **Applied with renumbering** | The registry became G1.0 and acks stayed in G2.2. Part IDs moved into G1.1, and the G3.1 slot now holds the engine integration of holes and guides (coverage #10). |
| Coverage #9(b): 4 mm footprint confuses label size with burn width | **Applied** | The footprint is now 0.2 mm (burn width), and `labelHeightMM` is separate. |
| All other critiques | **Applied** | See the tasks named in §1 and the "Corrections and code facts" list in §0. |

## Appendix B — Decisions (accepted 2026-10-07)

The product owner accepted all proposed defaults for the blocking open questions:

1. Geometry library: Clipper2 JS port (UMD/IIFE or wrapped); fallback in-house exact orthogonal booleans + square-join offsets.
2. Bonded smoothing: containment-aware per-loop fallback (Chaikin → RDP → raw); clip-to-lower only as a reviewed repair. **Superseded for bonded mode by D1 (2026-10-07, below).**
3. GEO-02 finite-width contact: < 0.5 µm overlap blocks export; warns when the contact does not survive `offset(−minFeatureUm/2)`, i.e. contact width below the full minimum feature width. **Made precise by D3 (2026-10-07, below):** both clauses are contact *widths* w = 2·r\*. Block if w < 0.5 µm (the contact does not survive an inset of 0.25 µm); warn `SUPPORT_NARROW` if w < `minFeatureUm` (inset `minFeatureUm/2`, `minFeatureUm` rounded to an integer µm before halving). Survival is certified by an exact BigInt witness, an undecided result counts as not surviving, and it is never computed with `SBGeom.offset`.
4. NFR-10 browser integration: in-repo headless-Chrome harness, no npm.

All non-blocking defaults (guide dimensions, resolutions, Plywood preset, EXIF handling, upstream patches) are accepted as proposed.

### Spike decisions (accepted 2026-10-07)

After spikes S2 and S5 the product owner decided (full text and evidence in `docs/ARCHITECTURE.md`, Decisions):

- **D1 (S2) — option (b).** Bonded mode is **unsmoothed** (raw lattice contours); connected mode keeps smoothing per G1.2, with the RDP-before-Chaikin amendment. Per-vertex lazy pinning (S2 option (c)) is a **deferred**, performance-gated enhancement: it may land only when it fits the NFR-03 totals at fabrication pitch (final + validation p95 ≤ 10 s desktop, ≤ 8 s mobile). Not in G1 scope. Evidence: `docs/spikes/S2.md`.
- **D3 (S5 revision 2, passed adversarial review).** Global normalize: node T-contacts; re-pair shared vertices by the material-separating turn with exact tests; then split repeated vertices; drop collinear; orient, rotate, nest, sort; never trust Clipper2's ring pairing. `components()` asserts `interiorConnected`; `validate()` reports `GEO_MULTIPART`. Finite width as in B.3 above. `SBGeom.offset` refuses non-integer and sub-µm deltas. Evidence: `docs/spikes/S5.md`.
- **KI-B1 (B1 budget).** B1 keeps its 2 s budget; the ≈2.14 s p95 overrun from the S6 T-split is a tracked known item resolved in G4.4 by optimizing normalize. `test/bench.js` reports it as `KNOWN-OVER (tracked)`.
- **Gate:** with D1 and D3 recorded, G1 is open.

## Appendix C — Spike amendments

Plan changes implied by the spike results. Each bullet names the affected tasks; the evidence is in `docs/spikes/` and `docs/ARCHITECTURE.md` (Decisions).

- **S1 → D2, G1–G5:** `<lib>` resolves to `clipper2-ts` 2.0.1-18, vendored as `js/vendor/clipper2.js` (global `Clipper2`) with `js/vendor/LICENSE-clipper2.txt`; module order is `… hash → vendor/clipper2 → geom …`. `SBGeom.backend` (string) is added to the S1 interface table.
- **S1 → S1 battery, G4.8:** the plan's load-form regex `/^\s*(import|export)\s/m` misses minified mid-line `export{…}`. The regression suite also runs the stricter `/\bimport\s*[{*"'(]|import\.meta|\bexport\s*[{*]|\bexport\s+(default|const|let|var|function|class)\b/`, plus strict-IIFE, worker-global (`self`) and SHA-256 pin checks.
- **S1 → T0.2, G4.7 (NFR-11):** `build.js` now embeds every `js/vendor/LICENSE-*.txt` verbatim in a leading comment of `dist/shadowbox-studio.html`, because the bundle ships third-party code as source text; T0.2 hygiene checks it.
- **S1 → G4.1:** `js/worker.js` must `importScripts("vendor/clipper2.js", "geom.js")` in that order after `hash.js` (fourth list of the four-list rule); the vendor file already loads in a worker-like global.
- **S1 → AT-23, G4.8:** the geometry backend requires ES2020 `BigInt` at runtime; add it to the browser matrix prerequisites.
- **S1 → D3, S5, S6 (D4):** `SBGeom.normalize` (and every boolean result) re-chains boundary edges canonically at shared vertices (sharpest left turn) before splitting saddles, so canonical bytes depend only on the edge set. S5/S6 must keep this inside normalization and keep the 240-case `components` property check. T-contacts (a vertex on another ring's edge interior) are not re-chained; S5 confirms whether they occur. *(Resolved: S6 nodes T-contacts; D3 confirms that the "sharpest left turn" in the math frame is S5's right-most, material-separating turn in Y-down — one rule, pinned by suite "spike S5 — D3 turn rule".)*
- **S1 → GEO-05, D3, G2.7, G2.8, G3.3 (guides):** `"miter"` (limit 2.0) is the join with exact lattice semantics; `"square"` is Clipper2's chamfered corner (not Chebyshev). Every lattice-exact offset (GEO-02 contact survival, feature checks, guide insets) uses `"miter"`.
- **S1 → S1 interface, G1.7, G3.4, G5.1 (`SBGeom.circle`):** the vertex rule changes from `Math.round(cx + r*t/1e6)` to `cx + roundHalfAwayFromZero(r*t/1e6)` in exact integer arithmetic (keeps 8-fold symmetry on .5 ties); centre and radius must be integers; the ring is cleaned, so radii < 232 µm yield fewer than 64 vertices. `ASM-04 subtractHoles leaves hole rings equal to SBGeom.circle` compares against this normalized ring.
- **S1 → S1 Step 2, G4.4 (benchmarks):** "8 layers × 50k vertices pairwise difference" is defined as the 7 adjacent layer pairs in both directions (14 differences per run). B1 passed narrowly (p95 1.58 s in the spike; 2.16 s on a heavily loaded re-run), so G4.4 re-measures it on the reference machines and G4.1 moves it off the main thread.
- **S1 → G2.7, G4.4 (support benchmark):** `test/bench.js geom` adds **B3b**, the support pass on the dense B1 noise stack (3,407 pairs), with a provisional budget p95 < 6 s (measured 4.55 s). The G2.7 support pass must use one layer-level `intersection` per adjacent pair with piece-to-part attribution (never per part pair: 39 s), and must bring B3b under the 3 s B3 budget (worker, skip containment `difference` when only the graph is needed, reuse B1 differences). `test/bench.js support` (G2.7) runs B3 and B3b.
- **S1 → G1.2 (smoothing):** Chaikin ×2 roughly triples vertex counts and B1 on smoothed layers takes 5.3 s; apply RDP before Chaikin and re-run the tolerance loop per loop, not per layer. Under D1 this applies to **connected-mode** smoothing (bonded is unsmoothed).
- **S2 → D1, G1.2, G2.10a (decided 2026-10-07):** bonded mode ships **unsmoothed** (option (b)): `smoothStack(…, {mode: "bonded"})` is the identity, there is no containment fixpoint, and bonded never reports `SMOOTH_FALLBACK`. Connected mode keeps per-loop deviation-bounded smoothing (Chaikin(2)∘RDP → RDP → raw, art rectangle pinned). G2.10a's AT-09 hook becomes `req.debug = {smoothBonded: true}`.
- **S2 F2 → G1.2 (stair check, implemented):** the plan check "deviation of chaikin(staircase) … 176.78" is wrong as written — the `stair` fixture has 3-unit corners and measures 530.33 µm (= 3 × 176.78). The shipped suite asserts 530.33 for `stair` and 176.78 for the unit square (the 0.125·√2 px constant). `smoothStack` also takes optional `w, h` (art size in px) to pin the art rectangle, and the layer topology check demotes loops whose smoothed rings touch another ring (all smoothed loops when none touch) until the layer topology equals the raw layer's.
- **S5 F3 → G1.3 (frame-edge check, implemented):** the literal "no frame-edge hole below 1 px²" fails on legitimate input: pinned smoothing rounds the free corners of a raw 1-px notch at the art edge (S5 itself measured pinned holes down to 57,299 µm² at 62,500 µm²/px). The shipped suite asserts that every frame-edge hole is a smoothed raw notch (same count as the raw framed layer) with area ≥ 1 px² − perimeter·tol (the GEO-04 bound; unpinned slivers measured 2,480 µm²). It also found that art-only smoothing can merge frame-edge holes once the frame is unioned (a corner meeting the art line at a point is rounded off it): with `fromMasks({frame: true})`, connected-mode `smoothStack` takes `frameUm` and checks the layer topology with the frame ring unioned, so the framed layer's topology and part count are unchanged by smoothing (GEO-04).
- **S2 F3 → resolved by D6 (2026-10-07):** the faceted-corner finding (no corner rounds at 417 µm/px with tol 50 µm) is resolved by finer resolution, not by a looser tolerance: the fabrication pitch target is 0.1 mm/px (Appendix D), at the unchanged 0.05 mm tolerance (S2 §6 F3: 0 % of corners round at 417 µm/px in every variant, 62–99 % across the variants at 100 µm/px; for the shipped connected-mode rule the D1 table gives 14.4 % on real images to 80.2 % on random input at 100 µm/px — the remaining gap is the R2 whole-loop fallback granularity, tracked separately as deferred option (c), not F3). Bonded mode stays unsmoothed (D1).
- **S2 → deferred enhancement (not G1):** per-vertex lazy pinning (S2 option (c); `docs/spikes/S2.md` §3.2, §7) may replace whole-loop fallback in both modes only after it fits NFR-03 at fabrication pitch: final + validation p95 ≤ 10 s desktop and ≤ 8 s mobile on the G4.4 workloads (prototype: 13.4 s on busy-1536 bonded). It would change the Appendix B.2 fallback unit to a vertex and report `SMOOTH_FALLBACK` as "n of m corners kept sharp". The F3 pitch/tolerance question (no corner rounds at 417 µm/px with tol 50 µm) was a separate product decision; **resolved by D6** (0.1 mm/px pitch, tolerance unchanged).
- **S5 → D3, §3, S1 interface (decided 2026-10-07; implemented in `js/geom.js`):** the §3 normalization bullet is replaced by the global re-pair-then-split rule. `SBGeom` adds `interiorConnected(poly)`, `insetStatus(I, d)`, `survivesInset(I, d)` and `classifyContact(I, minFeatureUm)`, and exposes `rechain`/`splitTJunctions` for the turn-rule check. `components()` throws `GEO_MULTIPART_POLYGON` if a normalized polygon is not one part; `validate()` reports `GEO_MULTIPART`. `offset` throws `GEO_OFFSET_NONINTEGER` for any non-integer delta. S5's Round-join failure certificate is not shipped (NFR-05); undecided counts as not surviving, so the boolean is unchanged.
- **S5 → G2.7, G2.8 (thresholds):** G2.7's support predicate is `survivesInset(I, 0.25)` (width ≥ 0.5 µm) and `SUPPORT_NARROW` is `!survivesInset(I, minFeatureUm/2)` with `minFeatureUm` rounded to an integer µm first; never `SBGeom.offset`. G2.8 `featureChecks` offsets by the integer `Math.floor(minFeatureUm/2)`.
- **S5 → G1.1, G1.3, S1 battery (ported checks):** suites "spike S5 — …" in `test/run_tests.js` carry the cyclic-saddle case, the pixel-exact bijection with BFS 4-components (independent oracle `test/oracle_raster.js`), T-contact `interiorConnected` cases, the frame-union checks (G1.3), the B.3 classification and exact-oracle families (G2.7) and the sub-µm offset refusal (S1). Sweeps run reduced by default; `--s5-full` runs the spike sizes. G1.3 adds the frame-edge micro-hole check for connected-mode smoothing (no frame-edge hole below 1 px², S5 F3).
- **S1 → G2.8 (feature checks):** offsets are the slowest primitive (−1500 µm on 8 dense layers: 2.7 s); offset only parts whose bbox can be affected, or run in the worker.
- **S1 → R1 fallback:** the lattice backend (c) is exact and byte-identical to (a) on orthogonal input but cannot represent circles or smoothed contours (blocks G1.2, G1.3, G5.1); it remains the documented design in `spikes/S1/geom_lattice.js`, not shipped code.
- **S4 → S4 interface, G1.0 (error codes):** `SBPng` throws five codes beyond the plan's seven: `PNG_HEADER` (missing/invalid IHDR, illegal depth/type pair, non-consecutive IDAT, unknown filter type, palette index out of range), `PNG_INFLATE` (zlib stream rejected: bad Adler-32, trailing junk), `PNG_BITDEPTH`, `PNG_TOO_LARGE` and `PNG_NO_INFLATE` (R8). All twelve are exported as the frozen `SBPng.CODES`; G1.0 registers each one with title and fix text. `inspect` throws on structural faults rather than returning partial info.
- **S4 → S4 interface, G2.14 (allocation ceiling):** `decode(bytes, {maxPixels})` rejects `w·h > maxPixels` (default `SBPng.MAX_PIXELS` = 2^26) with `PNG_TOO_LARGE` before allocating, because a garbage IHDR otherwise aborts the V8 process (not a catchable error). This is a safety floor independent of, and above, the IMG-07 preflight. Pinned by `S4-A2 FUZZ REGRESSION: IHDR 2^31-1 x 2^31-1 → PNG_TOO_LARGE, no process abort`.
- **S4 → S4 Step 3.3, G2.1, G2.3, G2.14 (sub-8-bit gray, decision D5):** Step 3.3's "reject bit depth ≠ 8" is replaced: 1-, 2- and 4-bit gray decode in both modes by exact integer scaling 255/(2^N − 1) and record `policy`/`source.decode` = `"raw-gray{1,2,4}-scaled8"`; gray palettes at any depth record `"raw-palette-gray8"`. The §3 `source.decode` enum (and G2.1's strict schema) gains these four values. `{lowBitDepth: "reject"}` restores `PNG_BITDEPTH` if the product owner overrides D5.
- **S4 → S4 interface (result shape):** `decode` also returns `channels` (1, or 3 for tonal `policy: "raw-rgb"`: unequal RGB or a colour palette in tonal mode) and `warnings` (e.g. `PNG_EXTRA_IDAT_DATA:n` for inflated bytes beyond what IHDR implies, accepted like libpng). `inspect` additionally returns `paletteGray`, `hasTRNS`, `idatBytes`, `idatCount`, `chunks` and accepts `{verifyCrc}` (default true).
- **S4 → G2.14, G4.8 (intake CRC):** intake must call `SBPng.inspect` with CRC verification on (the default) and `check` in **both** modes, because Chromium's `createImageBitmap` silently accepts APNG (first frame), 16-bit (truncated) and ancillary-chunk CRC corruption; these calls are the only IMG-01 guard on the tonal path (≈7 ms/MiB, 173 ms at 25 MiB). G4.8's browser suite adds a **valid** APNG fixture (with `fcTL`; the shared `pngEncode({apng: true})` writes `acTL` only, which Chromium rejects anyway and so hides the gap) and a 16-bit fixture.
- **S4 → S4 Step 3.5 (inflate):** IDAT parts are streamed into the `DecompressionStream` writer and the output is written into one buffer preallocated to the size IHDR implies, then non-interlaced rows are unfiltered in place (replaces `Blob → Response.arrayBuffer()`; saves ≈65 MiB peak at 16 MP RGBA). Step 3.2's CRC uses `SBUtil.crc32(bytes, start, end)` (range form, no copy); `SBUtil.crc32Update` is the incremental form; `SBZip.crc32` delegates to it.
- **S4 → G2.0, G3.6 (`sampleHash` scope):** `sampleHash = SBHash.digest(samples)` covers the samples only (a 5×1 and a 1×5 image with the same bytes collide; gray, RGB-equal, RGBA-equal and Adam7 encodings of one image share it). It is valid only together with `source.w`/`h`; any cache or dedup key (G2.0 raster cache, `.sbrproj` in G3.6) must key on `(w, h, policy, sampleHash)`, never `sampleHash` alone.
- **S4 → G4.1, G4.4 (performance):** worst desktop decode (16 MP RGBA-equal) is ≈1.5 s on a throttled core (≈0.9 s normalized) and ≈107 MiB peak; decode is a one-time intake cost but must run in the worker (G4.1) so the NFR-02 100 ms acknowledgement holds. G4.4 should re-measure the mobile envelope (8 MP RGBA) memory, estimated ≈54 MiB. Module order: `png.js` sits after `geom.js` until `diag`/`schema` exist; G4.1's `importScripts` list includes it after `geom.js`.
- **S4 → AT-22 (fuzzing):** `spikes/S4/fuzz.js` (20,000 mutations, 0 uncoded errors) stays an occasional run; `test/run_tests.js` carries a 400-mutation mini-fuzz asserting every rejection has a code in `SBPng.CODES`.
- **S4b → S4b interface, G1.0 (error codes, extra fields):** `js/jpeg.js` keeps the frozen contract and exports its four codes as the frozen `SBJpeg.CODES` (G1.0 registers each). `inspect` additionally returns `exifAmbiguous`, `sof`, `precision`, `arithmetic`, `lossless`, `hierarchical` and `headerBytes`; two functions are added: `SBJpeg.unsupported(info) → reason|null` and `SBJpeg.scanEnd(bytes, from) → {eoi, trailing, scans}` (structural walk to EOI; never decodes, never throws). Module order: `jpeg.js` sits directly after `png.js` (before `height` once it exists); G4.1's `importScripts` list includes it there.
- **S4b → S4b interface (code boundary):** the plan's "segment length past EOF → `JPEG_BAD_SEGMENT`" is replaced: `JPEG_BAD_SEGMENT` means a self-inconsistent segment (L < 2, SOF L ≠ 8 + 3·Nc, Nc = 0, a non-marker byte where a marker must be, FF00 or a second SOI before SOF); `JPEG_TRUNCATED` means the data ends inside an otherwise consistent marker, length or segment. The SOF consistency check runs first, so `sofLen: 4000` stays `JPEG_BAD_SEGMENT`.
- **S4b → G2.14, G1.0 (preflight `JPEG_UNSUPPORTED`):** after `SBJpeg.inspect`, `SBSchema.preflight` rejects `SBJpeg.unsupported(info) !== null` with the new code `JPEG_UNSUPPORTED` (reason in `reason`): 12-bit precision, arithmetic coding, lossless, hierarchical, a zero dimension (DNL) and component counts other than 1, 3 or 4, because Chromium 152 and Firefox 155 disagree on or fail these. Lossless may be relaxed after a manual Safari check. G2.14 adds `IMG-01 unsupported JPEG variant (12-bit/arithmetic) rejected before decode`.
- **S4b → G2.14, AT-22 (preflight `JPEG_TRUNCATED`):** header inspection alone does not catch real truncation (it cuts scan data, after SOF), and Firefox decodes such files silently with a white fill. Preflight therefore also rejects `SBJpeg.scanEnd(bytes, info.headerBytes).eoi === null` with `JPEG_TRUNCATED` (≈31 ms at the 25 MiB cap). Trailing bytes after EOI (Motion Photos) must stay accepted, so a "last two bytes are FF D9" check is not a substitute. G2.14 adds `AT-22 truncated-in-scan JPEG rejected before decode`.
- **S4b → G2.14, G2.5 (decode path, `EXIF_AMBIGUOUS`):** tonal JPEGs are decoded with `createImageBitmap(blob)`, never `<img>` (Chromium's `<img>.decode()` resolves for 12-bit and truncated files that `createImageBitmap` rejects; `imageOrientation: "none"` is ignored by both browsers). Record `orientation.exif` from `inspect`; when `info.exifAmbiguous` is set, add the warning `EXIF_AMBIGUOUS` ("browsers disagree on this file's orientation — check the preview"). When `exif ∈ 5..8` and the decoded bitmap is not w/h-swapped relative to SOF, record what the browser did rather than the parsed value.
- **S4b → T0.3 (fixture):** `jpegHeader` in `test/fixtures.js` now allocates a 28-byte TIFF buffer (was 26, leaving the single IFD entry 2 bytes short, which Chromium ignores and Firefox applies), so `IMG-05 JPEG EXIF orientation 6 parsed` exercises an Exif every browser honours. No golden depends on the fixture bytes.
- **S4b → G4.8 (browser matrix):** the EXIF and decode checks include an XMP-then-Exif file, a truncated-in-scan file and an arithmetic-coded file, the cases where browsers diverge; `spikes/S4b/` (corpus via `make_corpus.sh`, CDP/BiDi probes) is the dev-only starting point. `test/run_tests.js` carries a 1,200-mutation mini-fuzz asserting every `inspect` rejection has a code in `SBJpeg.CODES` and `scanEnd` never throws.
- **S6 → S6 interface, G2.10b, G3.1 (`canonicalBytes` hole section, D4 amendment A):** the byte stream gains a trailing per-layer section `holeCount, (cx, cy, r)…` (registration holes `{cxUm, cyUm, rUm}`, sorted by (cy, cx, r)): `[layerCount, (index, partCount, (ringCount, (vertexCount, x, y…)…)…, scoreCount, (vertexCount, x, y…)…, holeCount, (cx, cy, r)…)…]`. G3.1's "holes enter `canonicalBytes`" is satisfied by passing `holes` on each layer; an empty layer hashes the words `[1, k, 0, 0, 0]`.
- **S6 → §3, G2.1, G1.1, G2.9, G3.3, G1.6 (two layer hashes, D4 amendment B):** `MaterialLayer.canonicalHash` is `SBGeom.materialHash(layer)` = `sha256(canonicalBytes([{index, material, holes}]))` (score section empty); only `SBGeom.layerHash(layer)` (score paths included) feeds `geometryHash.layers`. Guides (G3.3, SUP-05 `part.guideRefs`), `proposeClip`/`Repair.reviewed.beforeHash`/`afterHash` (G2.9), part-ID stability (G1.1) and `MAT-04 proof colors do not change any layer canonicalHash` (G1.6) use `materialHash`, which breaks the cycle "guides carry the layer hash, the layer hash contains the guides". §3's `MaterialLayer` comment and G2.1's schema note this when they land.
- **S6 → G2.10b (hash wiring):** use `SBGeom.layerHashes(layer) → {materialHash, layerHash}` (one normalization for both); `geometryHash.layers` holds one `layerHash` per index 0..N−1, including empty and omitted-trailing layers; `guideHash` covers only labels, omissions with reasons and the map (score polylines are already in `layerHash`); the full multi-layer `canonicalBytes` is not hashed for `geometryHash`. Excluded from every geometry hash: `parts`/IDs, `cutPaths`, `stats`, `diagnostics`, `zBottomMM`/`zTopMM` (via `geometryKey`), `appearance`, `view`, `acks`, `extras`, `title`, `units`; populating `carriers` needs a new section and an `engine.version` bump.
- **S6 → S6 interface, G2.10b, G4.1 (determinism guard, D4 amendment C):** `canonicalBytes` and the hash functions throw on a non-integer coordinate, layer index or hole field and on |v| > 2^25 µm (`SBGeom.COORD_LIMIT`, 33.5 m; int32 alone does not keep cross products exact). The engine must keep page geometry inside that bound and surface the throw as a coded error, never truncate. Any change to normalization or byte layout bumps `engine.version`; stale persisted `materialHash` values then fail closed as `REPAIR_STALE` (G2.9).
- **S6 → D2/D3, S5, G1.1, G2.7 (T-contacts):** S1's known limit is closed: Clipper2 `difference` does emit vertex-on-edge (T) contacts, so `SBGeom` inserts every T-contact vertex into the edge it touches (whole layer, own ring included) before re-chaining. Every boolean result, `fromPixelLoops` and `normalize` are therefore canonical for vertex and T contacts, and a T-contact never connects material (same D3 rule as a saddle). S5 no longer needs to confirm whether T-contacts occur; its contact-width work is unaffected.
- **S6 → G4.4 (B1 budget) — DECIDED 2026-10-07 as tracked known item KI-B1:** B1 keeps the 2 s budget; the overrun is tracked and G4.4 resolves it by optimizing normalize (see the G4.4 row; S5 F5: worst-case union + normalize 19 s vs 5.9 s for the union alone). `node test/bench.js geom` reports B1 over budget as `KNOWN-OVER (tracked)` (`knownOver`, id `KI-B1`) instead of failing; untracked overruns still exit 1. Measured after the D3 commits: p95 2126.6 ms at load 5–6, fingerprint unchanged. Original record: the T-split adds 12–18 % to B1 (A/B in one process: median 1.61–1.88 s → 1.88–2.16 s under load 6–8; ≈17 ms per 50k-vertex layer). The repo's own gate now fails under load: `node test/bench.js geom --runs 5` gave B1 p95 2032.6 ms (median 1953.9 ms) at load 5–7, `overBudget: ["B1"]`, exit 1 without `--no-fail` (fingerprint `27fa97ef…` unchanged). Options for the owner: (a) accept and raise or re-scope the B1 budget, (b) require a faster T-split (or a proven-safe skip) before G4.4, (c) keep the 2 s budget and treat a reference-machine re-measure in G4.4 as the gate. Until decided, G4.4 re-measures B1 on the reference machines with the T-split in place, and G4.1 keeps booleans off the main thread.
- **S6 → G4.8 (cross-engine fixture):** add `spikes/S6/fixture_draft.json` (draft 8-layer project, 1,660 parts, 70 of them on the contact path; project hash `ee31340d…694a` under the spike reference) to the browser harness. Recompute its expected hashes with the shipped `SBGeom` before pinning, because the backend differs from the spike's dev-only `clipper2-js` 1.2.4.
- **S6 → G1.1, G2.10b (engine input):** `normalize` does not merge overlapping or edge-sharing parts; it canonicalizes representation only. Material handed to `canonicalBytes` must be boolean-resolved (a `union`/`difference` result or `fromPixelLoops` of one mask), which the §11.1 chain already guarantees.

## Appendix D — Laser target (xTool S1)

Product-owner requirements of **2026-10-07**. Target: **xTool S1 with the conveyor feeder, 40 W diode**, cutting **1/4" basswood or poplar plywood**. The decision and its rationale are recorded as **D6** in `docs/ARCHITECTURE.md`. Requirements the SRS already states keep their SRS IDs; requirements the SRS does not state are `PO-LASER-n`. Every row is also in the §1 traceability matrix.

### D.1 Requirements

| ID | Requirement | Relation to the SRS | Tasks |
|---|---|---|---|
| PO-LASER-1 | **Machine profile**, persisted in the project, editable. Default **"xTool S1 + feeder"**: max processing height 470 mm, max length 3000 mm, max material width 545 mm, max thickness 14 mm, kerf 0.15 mm. | New (SRS §9.1 has no machine entity; GEO-10 has only "user-entered laser-bed dimensions") | G2.1, G2.11c, G3.5, G3.9 |
| PO-LASER-2 | **Machine fit:** every layer sheet, frame included, must fit the processing area (either orientation); stock thickness ≤ max thickness. Blocking diagnostic otherwise; never rescale. | Extends GEO-10 (bed check on by default, plus thickness) | G2.10a, G3.10 |
| PO-LASER-3 | **Size by height:** the default sizing mode fits the art plus frame to a target height in mm; width follows the source aspect. Width mode stays available. | Extends MAT-02 (dimension entry) | G2.1, G2.11c |
| PO-LASER-4 | **Physical pitch:** fabrication resolution is derived from the physical size at a target of **0.1 mm/px**, capped by a per-device total pixel budget (desktop roughly 16–25 Mpx, mobile lower; final numbers from G2.2b). A cap uses a coarser pitch and reports the actual mm/px (info), never silently. Draft stays about 720 px on the long side. Replaces the fixed `fabPx` 1536/4096 long-side caps. | Amends LYR-06 ("normally 1536 … up to 4096"); consistent with NFR-04 (not silent) and GEO-06 | G2.0, G2.1, G2.1b, G2.2b, G2.11b, G2.11c, G2.14, G4.3 |
| PO-LASER-5 | **Source pixel check:** the engine never upsamples; when the source has fewer pixels than the target fabrication raster, warn with how many px short. | Extends GEO-06 / IMG-02 | G2.0, G2.1b, G2.14 |
| PO-LASER-6 | **6 mm ply feature defaults:** min feature **1.5 mm** with the D3 rules (block below 0.5 µm contact, `SUPPORT_NARROW` below min feature), plus an **advisory warning below 2.0 mm** for contacts, parts and necks. | Amends the MAT-03 starting value (3 mm; still editable and provisional) | G2.1, G2.7, G2.8, G5.1 |
| PO-LASER-7 | **Kerf:** 0.15 mm in the machine profile, recorded in the guide and manifest. Kerf compensation applies in export only where the plan has it: the plan has none in v1.0, so export stays nominal with `kerfMode=external`. | Within MAT-05 (a recorded value never moves toolpaths); internal compensation stays deferred (SRS L613) | G2.1, G3.5, G3.9, G5.1 |
| PO-LASER-8 | **Layer thickness** 6.35 mm nominal, editable; the UI notes that 1/4" ply often measures 5.5–6 mm and invites a measured value (`thicknessState: "measured"`). | Within PRJ-01 / MAT-02 (adds the hint) | G2.1, G2.11c |
| PO-LASER-9 | **Large-image performance:** a benchmark at the pixel budgets sets the budgets and records performance targets for large workloads; the time budget for laser-detail exports may be relaxed if the benchmark requires it, and the relaxation is documented. | Extends NFR-03 / NFR-04 / AT-24 (the SRS §12.3 workloads and budgets are unchanged) | G2.2b, G2.7, G4.4 |
| PO-LASER-10 | **G2 execution order** as in D.4. | Plan sequencing (SRS §13.1 gates unchanged) | §8 |

### D.2 Rules

- **Sizing (PO-LASER-3).** `geometry.sizeBy` is `"height"` (default) or `"width"`; `geometry.targetMM` is the finished page along that axis (artwork plus 2 × frame). `SBSchema.resolveSize` derives the other axis from the oriented source aspect on the 1 µm grid. Default `targetMM` is **300 mm** (the v1.1.0 default size, now applied to the height); it is a proposed value, editable per project.
- **Pitch (PO-LASER-4/5).** `geometry.fabPitchMM = 0.1`. `SBRaster.fabRaster` computes `ceil(art / pitch)` per axis, coarsens the pitch in 1 µm steps until `W·H ≤ fabPxBudget`, then clamps each axis to the source (never upsample) and reports `shortPx`. mm/px always comes from the real raster (`sxUm`, `syUm`). Diagnostics: `FAB_PITCH_CAPPED` (info: actual vs target mm/px, device class, budget) and `FAB_EXCEEDS_SOURCE` (warning: source vs target px and the shortfall). Both are shown in the dimbar before generation and written to the manifest. Budgets are per device class in `SBSchema.limits`: measured by G2.2b (2026-10-08) as **desktop 25 Mpx, mobile 1 Mpx** (provisional 16 / 4 Mpx before that).
- **Envelope (PO-LASER-1/2).** With `machine` set, the page (the shared extent of every layer sheet, frame included) fits iff `(W ≤ L ∧ H ≤ P) ∨ (W ≤ P ∧ H ≤ L)` with `P = maxProcessingHeightMM`, `L = maxLengthMM`, compared in µm; otherwise `PAGE_OVERFLOW` (blocking). `thicknessMM > maxThicknessMM` gives `MACHINE_THICKNESS` (blocking). `maxMaterialWidthMM` (545) is validated to be ≥ the processing height and stated in the assembly guide as the stock width limit. `machine: null` disables the check (GEO-10's "optional" bed).
- **Features (PO-LASER-6).** `material.minFeatureMM = 1.5`, `material.advisoryFeatureMM = 2.0`. Support contacts: block if w < 0.5 µm, `SUPPORT_NARROW` if w < 1.5 mm, `FEATURE_MARGINAL` if w < 2.0 mm (D3 width, `survivesInset`, integer-µm rounding before halving). Parts and necks: `PART_THIN` / `NECK_NARROW` at 1.5 mm, `FEATURE_MARGINAL` at 2.0 mm (G2.8 erosion rule). `SAMPLING_LOW` then needs mm/px ≤ 0.5.
- **Kerf (PO-LASER-7).** `machine.kerfMM = 0.15` is informational: the guide and manifest state it and that no offset was applied (MAT-05). The calibration coupon (G5.1) carries the kerf comb and a 1.0–3.0 mm web ladder. Internal compensation remains out of scope until the SRS L613 fixtures exist.

### D.3 Diagnostic codes

| Code | Severity | Added in | Notes |
|---|---|---|---|
| `FAB_PITCH_CAPPED` | info | G2.0 (registered), G2.1b (emitted) | New |
| `FAB_EXCEEDS_SOURCE` | warning | G1.0 (exists) | Now carries `shortPx` and the shortfall text |
| `FEATURE_MARGINAL` | warning | G2.7 (registered), G2.7/G2.8 (emitted) | New; aggregated per `(code, layer)` like `PART_THIN` |
| `PAGE_OVERFLOW` | blocking | G1.0 (exists) | Now from the machine profile, emitted by the engine (G2.10a) |
| `MACHINE_THICKNESS` | blocking | G2.10a | New |

### D.4 G2 execution order (binding)

1. **G2.0** Deterministic resampling and the raster contract, with `fabRaster` (physical pitch, budget, source cap).
2. **G2.1** `SBSchema` extended: machine profile, sizing, pitch, feature defaults, provisional `limits().fabPxBudget`.
3. **G2.1b** Draft/fabrication raster snapshot (`SBEngine.rasterPlan`, `qualityPair`).
4. **G2.2b** Large-image benchmark and per-device pixel budgets (new).
5. **G2.2** Acknowledgements and the export gate.
6. **G2.3** `SBHeight`.
7. **G2.4** Tonal path.
8. **G2.4b** Legacy settings adapter.
9. **G2.5** Domain mask and orientation.
10. **G2.5b** Explicit height filter/remap.
11. **G2.6** Construction strategies.
12. **G2.7** `SBSupport.validate`, including the advisory tier and **B3b p95 < 3 s** (layer-level intersection per adjacent pair with `survivesInset`).
13. **G2.7b** Complexity caps and busy-art simplification (new 2026-10-08, moved from G4.3; D.9): per-device part/vertex caps in `SBSchema.limits`, a pre-trace estimate, explicit merging/dropping of tiny parts, `COMPLEXITY_LIMIT` with clear diagnostics.
14. **G2.8** Feature and sampling checks, including the advisory tier.
15. **G2.9** Reviewed clip repair.
16. **G2.10a** `SBEngine.generate` through validation, with the envelope check.
17. **G2.10b** Z model, accounting, hashes, freeze.
18. **G2.11a–e** Controller, stages, control groups (size, pitch, machine), applicability, mode-change review.
19. **G2.12** Opaque proof, section and tilt.
20. **G2.13a–d** Layer cards, overlays, diagnostics panel, clip dialog.
21. **G2.14** Source intake and preflight (with `rasterPlan`).
22. **Checkpoint** v2.0.0-alpha.2.

### D.5 Affected tasks (summary)

- **Data model (§3, ARCHITECTURE §3):** `geometry.{sizeBy, targetMM, fabPitchMM}` replace `fabPx`; `geometry.bedMM` is replaced by the top-level `machine` profile (in `geometryKey`); `material.minFeatureMM` 1.5 and new `advisoryFeatureMM` 2.0; `GeometryConfig` gains the pitch and cap fields.
- **G2:** G2.0 (fabRaster, diagnostics, tests), G2.1 (schema fields, `MACHINES`, `resolveSize`, `limits`), G2.1b and G2.2b (new), G2.4b (`procRes` → legacy pitch, `sizeBy: "width"`), G2.7 (advisory tier, B3b budget), G2.7b (new: complexity caps and busy-art simplification, moved from G4.3), G2.8 (advisory tier, sampling at 1.5 mm), G2.10a (raster from `rasterPlan`; envelope check moved here from G3.10), G2.10b (consumes `rasterPlan`), G2.11b (`#in-res` becomes a pitch input), G2.11c (size, pitch and machine controls; dimbar), G2.14 (preflight returns the raster plan; explicit downsample records a coarser pitch).
- **G3:** G3.5 (guide names the machine and the external kerf), G3.9 (manifest: machine profile, pitch, budget, cap, shortfall), G3.10 (export gating on the engine's envelope diagnostics; `bedMM` removed).
- **G4:** G4.1 (worker pool, the other busy-art mitigation), G4.3 (`fabPxBudget` from G2.2b; working set on the planned raster; complexity caps moved to G2.7b), G4.4 (NFR-03 workloads: SRS reference unchanged, laser-detail workloads added with the D6 targets).
- **G5:** G5.1 (coupon ladder 1.0–3.0 mm with 1.5 and 2.0 mm).
- **Risks:** R5 sharpened; R12 added.

### D.6 SRS deviations to record

These are product-owner amendments; the SRS text should be updated to match when it is next revised. None blocks G2.

1. **LYR-06** names "normally 1536 pixels on the long side and configurable up to 4096". Replaced by the physical pitch with a pixel budget (PO-LASER-4). A 470 mm-high page at 0.1 mm/px is 4700 px on the long side.
2. **MAT-03** gives 3 mm as the plywood starting feature width. The default becomes 1.5 mm with a 2.0 mm advisory tier (PO-LASER-6); still provisional, editable and labelled as a design filter, not a cutting guarantee.
3. **NFR-03 / §12.3** workloads are unchanged and remain the acceptance workloads. Laser-detail workloads get their own recorded targets (PO-LASER-9), possibly relaxed.
4. **IMG-07** caps sources at 16 MP (desktop) and 8 MP (mobile). Because the engine never upsamples, fabrication rasters cannot exceed those sizes, so the measured 25 Mpx desktop budget had no effect while IMG-07 stood. **Resolved (product owner, 2026-10-08, laser target):** the desktop source cap is raised to **25 MP**, equal to the measured desktop `fabPxBudget` (`docs/perf/large-image.json`; `SBSchema.limits("desktop").maxSourcePx`); the 25 MiB desktop byte cap and the mobile envelope (10 MiB / 8 MP) are unchanged. This is a documented deviation from SRS IMG-07 until the SRS is revised.
5. **§12.3 mobile vertex cap** (20,000) is **kept** (product owner, 2026-10-08): mobile is limited to simpler art. Realistic art at the 1 Mpx mobile budget (≈ 31,944 vertices) exceeds it, so mobile users see `COMPLEXITY_LIMIT`, whose mobile message says so (G2.7b). Not a deviation; recorded so the SRS revision can state the consequence.

### D.7 Resolved

- **IMG-07 desktop source cap** (D.6 item 4) is **resolved 2026-10-08**: raised to 25 MP to match the desktop pixel budget (product-owner decision, laser target).
- **Mobile vertex cap** (G2.7b open question) is **resolved 2026-10-08**: the SRS 20,000-vertex cap is kept and mobile is limited to simpler art (D.6 item 5).
- **G2.2b stop condition** (no mobile candidate ≥ 2 Mpx qualified in the exploratory run) is **resolved 2026-10-08 by option (a)**; see D.8.
- **S2 F3** (faceted corners at the default pitch: no corner rounds at 417 µm/px with the 50 µm tolerance) is **resolved by finer resolution, not tolerance**: the fabrication pitch target is 0.1 mm/px and the 0.05 mm tolerance is unchanged (S2 §6 F3: 0 % of corners round at 417 µm/px in every variant, 62–99 % across the variants at 100 µm/px; for the shipped connected-mode rule the D1 table gives 14.4 % on real images to 80.2 % on random input at 100 µm/px — the remaining gap is the R2 whole-loop fallback granularity, tracked separately as deferred option (c), not F3). Bonded mode stays unsmoothed (D1). Recorded in D6, Appendix C and the CHANGELOG (Unreleased).

### D.8 G2.2b stop-condition decision (product owner, 2026-10-08): option (a)

Recorded as D6 item 11 in `docs/ARCHITECTURE.md`.

- **Bonded mode gates.** Pixel budgets and NFR-03 gating use **bonded** mode (the plywood/laser default). `test/bench.js large` gates `stages.final` = bonded final plus validation and reports `stages.finalConnected` per row.
- **KI-CONN-PERF (tracked known item).** Connected-mode cost — ≈18 s p95 on the SRS §12.3 desktop reference against the 10 s NFR-03 budget, dominated by the `maxDeviationUm` checks (`segDist` / `distToGrid`) and the T-junction split — is tracked, reported by the bench as `KNOWN-OVER (tracked)` (`TRACKED_LARGE.connected`), and resolved in G4 by the G4.1 worker pool and/or smoothing optimisation (G4.4 re-measures). Connected mode stays functional; its measured times are documented in `docs/perf/large-image.json` and the D6 table. Remove the tracked entry when connected mode meets the NFR-03 budgets. **Draft review views (G2.12, 2026-10-08):** since G2.12 the Proof, Section and Tilt views are built from `SBEngine.connectedLayers` on the main thread after every pipeline run, not only at export. With smooth corners (the acrylic default) the G2.12 review measured it, in Node at the 720 px draft, at about 1.8 s on a simple image and about 10.8 s on a busy one (sharp corners: 0.2 s and 1.0 s), on top of about 0.8–1.0 s of `legacyRun`. Mitigation until G4.1: `renderAll` shows the Layers grid, chips, status line and a raster composite of the new masks first and defers the polygon build by one frame plus one task (a newer run supersedes a pending build); the status line reports `proof N ms` when it lands. The build itself still blocks the page for its duration; G4.1 moves it to the worker pool. **Needs explicit product-owner acceptance.**
- **Mobile candidates below 2 Mpx:** 1.0, 1.25 and 1.5 Mpx are added (G2.2b decision rule). If none qualifies in bonded mode, **mobile fabrication is draft-only**: fabrication export is disabled on mobile with a clear diagnostic, proposed code `FAB_DEVICE_DRAFT_ONLY` (blocking at fabrication quality: "Fabrication export is not available on this device; open the project on a desktop to export cut files"), registered and emitted when G2.2b part 2 records that outcome, honoured by G2.14 preflight and the G2.2 export gate; `SBSchema.limits("mobile").fabPxBudget` is then `null`. Draft generation stays available. This outcome is recorded, not a stop.
- **Worker pool:** G4.1 is expanded from a single worker to a pool of Web Workers (size from `navigator.hardwareConcurrency`, capped) that parallelises the per-layer and per-adjacent-pair stages (trace / `fromMasks`, smoothing, differences, support pass, `layerSVG` / hashes) with a deterministic merge order so hashes are unchanged; the engine-version handshake stays. It may be pulled earlier if performance blocks progress.
- **Machines:** benchmarks run on the Linux development machine (i7-11800H, 16 threads); budgets measured there are conservative for the owner's MacBook Air M5. Safari / JavaScriptCore coverage stays in G4.8.

### D.9 G2.2b result and plan change (product owner, 2026-10-08)

Recorded as D6 item 12 in `docs/ARCHITECTURE.md`; results in `docs/perf/LARGE_IMAGE.md` and `docs/perf/large-image.json`.

- **Shortened run.** The full G2.2b run (5 + 30 runs at the gated points) was stopped after about 6.5 h as overly thorough. Its completed rows count as measured data (provenance `log`, from the preserved summary lines). Only `r25` and `laser470` were run live (1 warm-up + 5 runs). The busy rows `b20`, `b25` and `laser470-busy` were skipped. The JSON records `method: "shortened"`, per-row provenance and run counts, and the load baseline (≈ 3–4 from desktop processes).
- **Budgets** come from the realistic-family bonded rows by the G2.2b rule: desktop **25 Mpx** at **10 s** (not relaxed), mobile **1 Mpx** (fabrication enabled, k = 4 provisional). `SBSchema.limits` carries them, and the test `PO-LASER-4 SBSchema.limits budgets equal docs/perf/large-image.json` keeps them in step. The desktop margin is thin (`r25` 9.75 s under load ≈ 5); G4.4 re-measures, and the fallback is 20 Mpx.
- **Busy rows are evidence, not gates:** 2k–8k parts/layer → 35–163 s bonded at 4–16 Mpx, so cost is driven by part count, not pixels.
- **G2.7b done (2026-10-08):** the caps are desktop 258 parts/layer, 132,000 vertices/layer and 356,000 vertices (measured), and mobile 100 / 20,000 / 20,000 (SRS). Simplification is explicit (`construction.cleanup.simplify`), and busy rows now fail explicitly or run simplified within the target. See the G2.7b result; the mobile vertex cap is kept (decided 2026-10-08, mobile limited to simpler art).
- **Plan change:** the complexity caps and busy-art simplification (formerly G4.3: per-device part/vertex caps, merging or dropping tiny parts, clear diagnostics) move into G2 as **G2.7b**, scheduled right after the support task G2.7 (D.4). The **G4.1 worker pool** is the other mitigation and may still be pulled earlier if performance blocks progress.
