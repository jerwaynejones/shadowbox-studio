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


**Pulled forward into the alpha.3 patch round (Appendix E, product owner 2026-10-08).** Parts of four G3 tasks land before G3 starts; G3 completes them and keeps its named checks. Where the G3.1, G3.2, G3.3 and G3.5 rows above name a different signature or a stale line reference, **Appendix E.10 is authoritative** (interfaces reconciled in review, 2026-10-08):
- **G3.1** — stage 14 only: `SBGuides.build`/`validate` inside `generate`, score paths in `layerHash`, labels and omissions in `guideHash`, `GUIDE_UNCONTAINED` as a bug guard (E10, E11). Stage 10 registration holes stay with G3.4.
- **G3.2** — `SBGeom.interiorPoint` and `js/strokefont.js` with the digits `0-9` only (E9). The full charset, deleting `legacyTextLabel` and the connected-sheet stroke label stay in G3.2.
- **G3.3** — `inset-outline` and a position-only `interior-mark` cross for bonded mode, the scored sheet number, `GUIDE_OMITTED`/`ALIGN_CLEARANCE_ZERO`, the Appendix B defaults (E10). Part-ID labels, the rotation tick, `part.guideRefs` and SUP-05 invalidation stay in G3.3 (alpha.3 rebuilds guides on every generate).
- **G3.5** — `SBSvg.placementMapSVG` as `placement_map.svg` in the flat layout, and the bonded `SBDocs.assembly` text (E11, E13). The printable map layout under §9.4 stays with G3.5/G3.9.
- G3.4 (registration holes), G3.6–G3.11 are not pulled forward.

**G3 exit:** AT-14 to AT-17 and the AT-22 import subset are green. A sample package is checked into `docs/samples/` for review. Release `2.0.0-beta.1`.

## 10. Phases G4 (hardening) and G5 (fabrication release)

| Task | Work | Files / interfaces | Named checks / evidence | Reqs |
|---|---|---|---|---|
| **G4.0** Service-worker update gating (**before G4.1**) | **Speed round (2026-10-09): the minimal gating (no unconditional `skipWaiting`, user-gated update, `worker.js`/`pool.js` in `SHELL`) moved to Appendix F task F10; the cache/update status UI stays here (F-D3).** Remove the unconditional `skipWaiting()` (`sw.js:46-48`; now `sw.js:64`). A waiting worker shows "Update available"; `skipWaiting` runs only on user action and never while the project is unsaved or an export is in progress. One cache per version; visible cache/update status. Because a dedicated worker's `importScripts` goes through the controlling SW, the worker must never mix versions (G4.1 handshake). | `sw.js:19-66`, `app.js:664` | `DEP-02 sw.js has no unconditional skipWaiting in install`; `DEP-02 VERSION == APP_VERSION` (T0.2); AT-23 evidence | DEP-02 |
| **G4.1** Worker pool, cancel and stale handling (§9.3; expanded 2026-10-08, KI-CONN-PERF) | **Pulled forward 2026-10-09 into Appendix F (speed round, PO-PERF-1): the coordinator worker, helper pool, deterministic merge, handshake, progress, `SBDiag.acceptResult`, cancel, `dist/` Blob worker and fallback move to tasks F9–F16, together with this row's tests. Changes recorded there: cooperative cancel before `terminate()` (F-D2), the module list follows `test/modules.js` rather than §4, raster kernels (area resample, Kuwahara) are also banded. Still here after the round: packaging in the worker (F-D4) and tonal decode in the worker.** **Worker pool:** a pool of Web Workers sized `min(navigator.hardwareConcurrency − 1, cap)` (at least 1; cap recorded per device class, e.g. 8 desktop / 4 mobile) parallelises the per-layer and per-adjacent-pair stages — trace / `SBMaterial.fromMasks`, connected smoothing, the adjacent-pair differences, the support pass, `layerSVG` and the layer hashes — and merges results in a **deterministic order** (layer index, then pair index), so `materialHash`, `layerHash` and `geometryHash` are unchanged by pool size or scheduling (test: hashes equal for pool sizes 1, 2 and N). Every pool worker passes the engine-version handshake. The pool may be pulled earlier than G4 if performance blocks progress. `js/worker.js` `importScripts`s the pure modules in §4 order and runs `SBEngine.generate`. Messages follow §3 `GenerateRequest`/`GenerateResponse`: `engineVersion` is checked both ways (a mismatch rejects and reloads the worker), `status: "progress"` messages are posted per stage, and the response carries `validatedLayers`, `diagnostics` and `geometryHash`. The controller accepts a response only if `requestId` and `revision` match. It **transfers a copy** of `normalizedSource.pixels`, so the project keeps its own copy. Cancel = `worker.terminate()` plus respawn (< 500 ms). Packaging runs in the worker. `build.js` **changes**: it emits the worker modules as `<script type="text/sb-worker">` and starts a Blob worker in `dist/`. On `file://` failure it falls back to chunked main-thread execution with a notice. | `SBDiag.acceptResult(active, response) → boolean` (pure) | `AT-15 stale response discarded`; `§9.3 engineVersion mismatch rejected`; `AT-15 cancel during export keeps last revision and source`; `§9.3 progress messages precede done`; `NFR-05 worker pool hashes equal for pool sizes 1, 2, N`; `§9.3 every pool worker passes the engine-version handshake`; four-list consistency extended to `worker.js` | NFR-02, UI-06, §9.3, NFR-09, KI-CONN-PERF |
| **G4.2** Draft vs fabrication pipelining | The G2.10b rule is already enforced. This task makes the fab generation run in the worker while the UI stays responsive, caches the last fab snapshot per revision, and shows "Preparing fabrication geometry…" in the export flow. | `js/app.js`, `js/worker.js` | `LYR-06 export regenerates at the fabrication rasterPlan (G2.1b) in worker`; `LYR-06 cached fab snapshot reused only for the same revision` | LYR-06 |
| **G4.3** Resource envelope (complexity caps moved to G2.7b, 2026-10-08) | `deviceClass()` uses `deviceMemory` plus coarse pointer, with a user override. `SBSchema.limits(deviceClass).fabPxBudget` carries the G2.2b budgets (PO-LASER-4: desktop 25 Mpx, mobile 1 Mpx). The working-set estimate is `w·h·bytesPerStage` on the `rasterPlan` raster; over budget means reject or offer an explicit downsample. The per-device complexity caps and busy-art simplification are **G2.7b** (moved forward after G2.2b); G4.3 re-checks them on the reference devices with the G4.4 numbers. Also applies the mobile `.sbrproj` 64 MiB limit. | `SBSchema.estimateWorkingSet(w, h, N)`, `SBSchema.limits(deviceClass)` | `NFR-04 estimate > 192 MiB on mobile → reject code`; `§9.4 mobile maxBytes 64 MiB` | IMG-07, NFR-04 |
| **G4.4** Benchmarks | **Speed round 2026-10-09 (Appendix F):** per-stage and guide-stage columns, `--pool N`, the `user12` fabrication workload and the draft-budget sweep move to tasks F2, F17 and F18 (`docs/perf/speed-round.json`); the single-thread hotspot work of S5 (F3–F8) lands there, and KI-B1 normalize work moves there only if it stays on the critical path (F18). Reference-machine re-measurement, mobile, cancel latency and the 1.5 s draft target stay here. `test/bench.js <stage>`: 5 warmups then 30 runs, reporting p50/p95/max as JSON in `docs/perf/`, plus an in-app `?bench`. Workloads: the SRS §12.3 desktop reference (1536 × 1536 samples, 8 layers; the NFR-03 acceptance workload, unchanged), the **mobile reference (768 × 768 samples, 6 layers, ≤100 parts/layer, ≤20,000 vertices)**, and the **laser-detail workloads of G2.2b** (desktop and mobile at their pixel budgets, PO-LASER-9), re-measured on the reference machines against the targets recorded in D6. Cancellation latency is measured in both. **KI-B1 (tracked):** B1 keeps its 2 s budget; G4.4 resolves the ≈2.14 s p95 overrun from the S6 T-split by optimizing `SBGeom` normalize (numeric vertex keys, skip noding when no collinear contact exists, normalize once per boolean; S5 F5 measured worst-case union + normalize 19 s vs 5.9 s for the union alone), then removes the `TRACKED.B1` entry from `test/bench.js`. | — | Desktop p95: draft ≤ 1.5 s, final plus validation ≤ 10 s, package ≤ 5 s. **Mobile p95: final plus validation ≤ 8 s**, measured on the recorded ≥4 GB device. Cancel ≤ 500 ms on both. **Laser-detail p95 within the D6 targets** (10 s unless G2.2b recorded a relaxed one). | NFR-02, NFR-03, AT-24, PO-LASER-9 |
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

### D.10 alpha.3 patch round (product owner, 2026-10-08)

The alpha.2 user test on the target setup (xTool S1 40 W diode + feeder, 1/4" basswood/poplar ply, colour illustrations, bonded relief) triggered an alpha.3 patch round **before G3**; the plan is **Appendix E**. It adds `PO-PREVIEW-1` to `PO-PREVIEW-7` and amends **PO-LASER-4**: the draft is no longer "about 720 px on the long side" but the measured `draftPx` of `docs/perf/draft-budget.json` with a per-device `draftPxCap` (E4). G3 tasks pulled forward into alpha.3: **G3.1** (stage 14 only), **G3.2** (interior point and digits), **G3.3** (inset-outline, position-only interior-mark, sheet numbers) and **G3.5** (placement map file and bonded assembly text); details in the note under the §9 G3 table. G3.4 and G3.6–G3.11 are unchanged. The G4.1 worker pool is not pulled forward; main-thread blocking during draft and fabrication preview is an accepted alpha.3 gap.

## Appendix E — alpha.3 patch round

**v2.0.0-alpha.3 (real-engine preview, bonded alignment) Implementation Plan**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every on-screen preview come from `SBEngine.generate` in the selected mode at draft quality, add an explicit fabrication-resolution preview, a preset selector that accepts colour illustrations under Plywood, early source-resolution diagnostics, concealed alignment guides and sheet labels for bonded relief, re-reviewable draft repairs at fabrication, and bonded-aware export extras. Release as `2.0.0-alpha.3`.

**Architecture:** One request builder (`SBEngine.request`) makes the draft and the fabrication request from the same project, whose `source` record is installed once at intake, so the two requests differ only in `quality` and the `rasterPlan` raster. Every raster-dependent filter radius is stored in mm and converted per raster (E3b), so draft and fabrication apply the same physical smoothing; the remaining difference is rasterization, which an engine check bounds (E3b) and the UI labels ("Draft (approximate)", E5; predicted fabrication complexity, E8). The app keeps the full-size source pixels once per load (`run.src`) and a caller-owned draft stage cache (`run.draftCache`) so a warm draft skips orient, resample and Kuwahara; fabrication runs are uncached (E-R7). Everything the user sees (Proof, Section, Layers cards, Tilt, overlays, diagnostics, state badge, clip dialog, preview.png) reads one shown result, `run.shown`, which is either the draft run or the fabrication run, and reads it only through `run.shown.snapshot` (which carries its own construction mode, thickness and gap). Files are delivered only from a fabrication result that is on screen (E6). Guides and sheet labels are built inside `generate` (stage 14), so draft and fabrication show the same guides through the same code.

**Tech Stack:** Plain ES2020 classic-script IIFEs, no npm; Node built-ins for tests (`node test/run_tests.js`) and build (`node build.js`); Clipper2 through `SBGeom`.

**Spec:** `docs/SRS_Stacked_Relief.md`, this plan (§3, §9 G3, Appendices B–D), and the product-owner request of 2026-10-08 recorded in E.1 below.

### E.0 Why this round exists (findings verified against the code, 2026-10-08)

The alpha.2 user test (xTool S1 40 W diode + feeder, 1/4" basswood/poplar ply, colour Midjourney illustrations upscaled to about 4096 × 3084, bonded relief) found the preview "terrible". Read-only audits confirmed the causes. Every reference below was re-checked against the tree at `94de073`:

1. **The draft is the v1.1 pipeline.** `regenerate` (`js/app.js:127-189`) scales the source on a canvas to `draftPx` (`js/app.js:139-147`) and calls `SBEngine.legacyRun` (`js/app.js:154`), which always uses `SBConstruct.connected` (`js/engine.js:50`) on the 19-key `SBSchema.legacyState` view (`js/app.js:67`, `js/schema.js:684`). Bonded projects are previewed with connected construction (bridges, Kuwahara, ≈0.55 mm/px at 720 px). The deferred view (`buildView`, `js/app.js:241-275`) adds `legacyView`, `legacyDiagnostics`, `legacySnapshotHash` and `legacyCleanupReport`. Only export calls `SBEngine.generate` (`fabReview`, `js/app.js:818-842`).
2. **Draft-accepted clips block export.** The app never assigns `project.source` (it stays `null`, `js/schema.js:354`; `acceptSource` at `js/app.js:1319-1329` records only `run.sourceRoute/sourceW/sourceH`). `SBSupport.applyClip` stores `keyHash = hashJSON(geometryKey(project))` with `source: null` (`js/support.js:414-417, 447`). `SBEngine.fabricationRequest` installs a full source record into `config` (`js/engine.js:674-685`), and `replayRepairs` compares `keyHash` against `ctx.project` = that config (`js/support.js:476`). The keys differ, so every draft clip becomes `REPAIR_STALE` (blocking, `js/diag.js:98`) instead of the intended `REPAIR_REVIEW_FAB` warning (`js/support.js:487-495`). The existing repair tests (`test/run_tests.js` G2.9/G2.13d suites) start from projects that already carry a source, so they miss it.
3. **`generate` is uncached and synchronous.** Each call re-orients and re-resamples the full source (`js/engine.js:523-536`); `SBRaster.cacheKey` (`js/raster.js:392-397`) is never called. Measured on the i7-11800H (12.6 Mpx bonded tonal, r4 p2): 720 px ≈ 2.6–3.6 s, 1536 px ≈ 6–7 s, 2048 px ≈ 8.8–10.2 s (2048 is outside the schema range `draftPx` 64–2000, `js/schema.js:531`). At 720 px, orient + resample are ≈1.6 s (45 %); construct grows fastest with raster size.
4. **Plywood refuses colour sources.** The plywood preset is height mode (`js/schema.js:364-380`, PRJ-01). JPEG is refused at preflight (`HEIGHT_NEEDS_PNG`, `js/schema.js:261`); a colour palette PNG at `SBPng.check` (`PNG_PALETTE`); a truecolour PNG only at decode (`PNG_UNEQUAL_RGB`, `js/png.js:313-317`, surfaced at `js/app.js:1251`). The app still starts on Acrylic (`js/app.js:38`) although plan Q13 asks for Plywood.
5. **Source-resolution diagnostics exist but are hidden.** Preflight already computes `FAB_EXCEEDS_SOURCE`/`FAB_PITCH_CAPPED` (`js/schema.js:236-246`), but `loadFile` shows only `EXIF_AMBIGUOUS` (`js/app.js:1256`).
6. **Bonded sheets carry no alignment.** Stage 14 is `const guides = null` (`js/engine.js:631`); stage 10 holes are `legacyHoles`, `[]` in bonded (`js/engine.js:422-430`); bonded fabrication SVGs have no label. `layerSVG` already writes `layer.scorePaths` into the SCORE group (`js/svgout.js:140`), and `SBGeom.layerHashes` already hashes score paths into `layerHash` only (`js/geom.js:771-807`). All guide diagnostics are registered (`GUIDE_UNCONTAINED` `js/diag.js:104`, `GUIDE_OMITTED` `:163`, `ALIGN_CLEARANCE_ZERO` `:171`).
7. **ASSEMBLY.md and preview.png use the draft.** `buildAssemblyMD` (`js/app.js:700-752`) reads `run.sheets` and `cfg()` with connected wording ("backing (solid)", `:720`); `preview.snapshot("proof")` (`js/app.js:910`) captures whatever draft is on screen while the cut files come from `run.fab.snapshot` (`:906`). `settingsJSON` (`:754-764`) exports only the 19 v1.1 keys.
8. **No persisted geometry-hash goldens exist.** `test/golden/` holds `legacy_svg.json`, `oldrun.json` and `sheetmasks.json` only. Adding score paths or changing `draftPx` breaks no pinned hash; the drafts' "golden hashes change" risk reduces to the in-suite checks that compute hashes on the fly. The preset check `PO-LASER-4 fab pitch 0.1 mm, draft 720` (`test/run_tests.js:2918`) is the one literal that must be retargeted.

Baseline before this round: `node test/run_tests.js` → **1423 passed, 0 failed** (2026-10-08).

### E.1 Goals and traceability

Requirements the SRS already states keep their SRS IDs; product-owner requirements of 2026-10-08 that the SRS does not state are `PO-PREVIEW-n`. This table extends the §1 traceability matrix for alpha.3.

| Goal | ID | Requirement | SRS / PO links | Tasks |
|---|---|---|---|---|
| P1 | **PO-PREVIEW-1** | Proof, Section, Layers cards, Tilt, overlays, draft diagnostics and the state badge come from `SBEngine.generate` at quality `"draft"` in the selected interpretation and construction. The bonded preview never shows bridges. The legacy pipeline is removed from the app; it stays in `js/engine.js` only as the DEP-04 test oracle. Draft resolution is the largest that keeps a warm edit interactive, chosen by measurement and recorded. Filter radii are physical (mm), so the draft approximates the cut geometry within a tested tolerance, and the draft is labelled approximate. | LYR-06, UI-05, GEO-08, NFR-05; **amends PO-LASER-4** ("Draft stays about 720 px on the long side") | E1, E2, E3, E3b, E4, E5 |
| P2 | **PO-PREVIEW-2** | "Preview at fabrication resolution" runs the exact fabrication `generate` (same request and hash as export) and shows it in every view; export reuses it while inputs are unchanged and never delivers a fabrication result the user has not had on screen. Main-thread freezing is accepted until G4.1 but a busy state is shown first. | LYR-06, UI-05, UI-06 (partial), EXP-05, EXP-07; NFR-02 deviation until G4.1 | E6 |
| P3 | **PO-PREVIEW-3** | Preset selector (Plywood (bonded), Acrylic (connected)); the app starts on Plywood. A colour source under a height preset switches to Tonal automatically with a visible notice and one-click undo; Height stays for grayscale height maps; no hard refusal for the common case. | PRJ-01, PRJ-02, IMG-01; plan Q13 | E7 |
| P4 | **PO-PREVIEW-4** | `FAB_EXCEEDS_SOURCE`, `FAB_PITCH_CAPPED` (and every other preflight warning) are shown at load and in the draft diagnostics panel, not only at export, together with a predicted fabrication complexity check against the device caps. | GEO-06, NFR-04, UI-04; PO-LASER-4/5 | E8 |
| P5 | **PO-PREVIEW-5** | Bonded relief gets concealed alignment: score guides of layer k+1 on layer k inside the ASM-02 region (Appendix B defaults: inset 0.5 mm, footprint 0.2 mm, allowance 0.5 mm, label height 3 mm), a scored sheet number in a concealed area, an omission diagnostic with the placement map as fallback, and guides in the preview cards. Pulls G3.1 (stage 14 only), G3.2 (digits + interior point), G3.3 (inset-outline, interior-mark) and part of G3.5 (placement map) forward. | ASM-01, ASM-02, ASM-03, ASM-05, EXP-03, GEO-07, AT-13 (sheet labels), AT-14 | E9, E10, E11 |
| P6 | **PO-PREVIEW-6** | A clip accepted on the draft never hard-blocks export: it replays at fabrication as `REPAIR_REVIEW_FAB` and is re-reviewed in the Fabrication review with Keep (acknowledge, with the fabrication mm² and part counts and the region shown on the fabrication result) or Revert. | SUP-04, LYR-06, EXP-07, UI-04 | E1 (root cause), E12 |
| P7 | **PO-PREVIEW-7** | Bonded-aware ASSEMBLY.md (glue-up order, thickness, guide and label explanation, placement map, machine and external kerf) built from the fabrication snapshot; settings.json keeps the v1.1 keys and adds a `project` block (modes, thickness, pitch, raster, hash); preview.png renders the exported fabrication result. | ASM-05, EXP-05, EXP-06 (partial), PO-LASER-7 | E6 (preview.png), E13 |
| C3 | — | Version `2.0.0-alpha.3`, CHANGELOG with a known-gaps table. | DEP-02, R9 | E14 |

### E.2 File structure

| File | Change | Responsibility after this round |
|---|---|---|
| `js/engine.js` | Modify | `E.sourceRecord`, `E.sampleBytes`, `E.request` (draft/fab; `SOURCE_MISMATCH`), `fabricationRequest` as a wrapper (null-source projects only, not called by the app); `opts.cache` stage memo with a quality tag; identity fast path in `E.orient`; filter radii from mm per raster (E3b); `snapshot.construction`; `snapshot.repairsApplied`; `cleanupReport[k].bridged/culled`; `snapshot.page.{frameMM, artWMM, artHMM}`; stage 14 calls `SBGuides.build`; `fabricationFiles` adds `placement_map.svg` for bonded. `legacy*` kept as test oracles only. |
| `js/schema.js` | Modify | `S.withSource(project, record)`; `interpretation.smoothing.radiusMM` and `heightFilter.radiusMM` (E3b, with legacy mapping); `LIMITS.*.draftPxCap`, `LIMITS.*.fabMsPerMpx`; preset `draftPx` from E4 (per preset); plywood `guides.mode` `inset-outline`; `S.colourSourceSwitch` (auto-tonal patch); `modeChangeDiff` sets `guides.mode` on a switch to bonded; `S.presetDiff`/`S.applyPreset`. |
| `js/raster.js` | No change | `cacheKey` is reused by E3. |
| `js/diag.js` | Modify | New codes `SOURCE_COLOR_TONAL` (info), `FAB_COMPLEXITY_LIKELY` (warning, panel-only), `LEGACY_PROJECT_BLOCK` (info); `GUIDE_OMITTED` joins the `AGGREGATED` set (`js/diag.js:205`) with `detail.kind` `part`/`label`. |
| `js/strokefont.js` | **Create** | `SBFont.strokes(text, heightUm) → {paths: number[][], wUm, hUm}`; digits `0-9` only in alpha.3 (G3.2 completes the charset). |
| `js/geom.js` | Modify | `SBGeom.placeBox(polys, hxUm, hyUm) → [x, y] | null`, `SBGeom.interiorPoint(polys, clearanceUm)` (= `placeBox(polys, c, c)`), `SBGeom.bufferPolylines(paths, halfUm) → Polygon[]`. |
| `js/guides.js` | **Create** | `SBGuides.build(layers, cfg, ctx) → {scorePaths[], guides, diagnostics}` and `SBGuides.validate(...)`. |
| `js/proof.js` | Modify | `cards` marks `omitted`; `SBProof.panelModel`; `SBProof.predictFabComplexity`. Cut length comes from the existing `MaterialLayer.stats.cutMM` (`js/material.js:388`). |
| `js/svgout.js` | Modify | `SBSvg.placementMapSVG(snapshot, opts)`. |
| `js/docs.js` | Modify | `SBDocs.assembly(project, fabSnapshot, opts)`; `SBDocs.sourceNotes(warnings)`. |
| `js/preview.js` | Modify | Draw `layer.scorePaths` on Layers cards (`drawCard` option `scores`); `setSheets`, `setSnapshot`'s `opts.bridges` branch and `maskToCanvas` removed. |
| `js/app.js` | Modify | `run.src`, `run.draftCache`, `run.shown`; `regenerate` on `generate`; fabrication preview; preset select; auto-tonal intake; load-time notes; guide controls; Fabrication review re-review; `buildAndDeliver` uses the fab snapshot for ASSEMBLY.md and preview.png. |
| `index.html` | Modify | `#in-preset`, `#btn-fabpreview`, guide controls, two new `<script>` tags. |
| `sw.js`, `test/modules.js` | Modify | Four-list registration of `strokefont.js` and `guides.js`, inserted directly after `support.js` (real order: `… support → strokefont → guides → svgout → svgread → proof …`, `test/modules.js`). |
| `test/bench.js` | Modify | New stage `draft` (draft p95 on the realistic and busy families, plus a fabrication ms/Mpx row). |
| `docs/perf/draft-budget.json`, `docs/perf/DRAFT.md` | **Create** | Measured draft budget and rationale. |
| `test/run_tests.js` | Modify | New alpha.3 suites; retargeted static wiring checks. |
| `docs/CHANGELOG.md`, `docs/USER_GUIDE.md`, `docs/QA_CHECKLIST.md`, `docs/ARCHITECTURE.md` | Modify | Release notes, user steps, manual checks, deprecated legacy seams (the legacy-seam table at `docs/ARCHITECTURE.md:196-208`; `docs/COMPONENTS.md` is the NFR-11 third-party table and is not touched). |

### E.3 Global Constraints

All of the plan's **Global Constraints** section applies. In addition, verbatim for this round:

- No npm, no `package.json`; Node built-ins only. New modules are classic-script IIFEs registered in the four lists directly after `support.js`: `… support → strokefont → guides → svgout → svgread → proof …`.
- Hashed geometry: integer µm, `"miter"` offsets only (Appendix C), no `Math.sin/cos/exp/log/pow/cbrt`; `Math.sqrt`, `Math.hypot` only outside hashed paths (display values such as cut length).
- Draft and fabrication requests for one project revision must have byte-identical `config` and `normalizedSource`; only `quality` differs (LYR-06). Every raster-dependent radius is stored in mm and converted per raster (E3b); no new setting may be stored in pixels.
- Nothing that renders a result reads `project.*`: views, overlays, cards, section, files and preview.png read `run.shown.snapshot` / `run.fab.snapshot` only (E5, E6).
- Blocking diagnostics are never downgraded; acknowledgements stay scoped to `geometryHash` (§9.5). `REPAIR_REVIEW_FAB` stays a warning.
- Bonded never adds bridges (SUP-06); guides are scored, never cut; no live text in any cut file (EXP-03). The placement map is not a cut file.
- After every task: `node test/run_tests.js` all green; when shipped code (`js/`, `index.html`, `css/`, `sw.js`) changes, `node build.js` and commit `dist/shadowbox-studio.html` with the task. Commit only the task's files. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push, no tags.
- No copy states laser speed or power, or "ready to cut" while a blocking diagnostic exists.

### E.4 Review Focus

The five inputs most likely to bite the user that no single task's happy-path tests would exercise. Each line has its test added to the owning task.

1. **A colour PNG whose RGB channels are all equal (gray-looking illustration or an RGB-saved height map).** Expected: it stays on the raw Height route under Plywood (it is a valid height map, IMG-01), with no auto-switch notice. Test in E7 (`IMG-01 RGB-equal truecolour PNG under plywood stays height`).
2. **A clip accepted on the draft, then the source reloaded or a setting changed, then export.** Expected: after a settings change the clip is `REPAIR_STALE` (correct, SUP-04); without one it is `REPAIR_REVIEW_FAB`; reloading the identical file re-installs an identical record (same `sampleHash`, no revision bump) and the clip stays valid; a different file makes it stale. Tests in E1 (`PRJ-02 re-installing an identical source record changes nothing`, `SUP-04 loading a different source makes an earlier clip stale`).
3. **Tiny or crescent upper parts (narrower than 2·(inset+allowance)+footprint ≈ 2.2 mm).** Expected: no score line on visible material; one aggregated `GUIDE_OMITTED` warning per layer with a count, and the part on the placement map. Test in E10 (`AT-14 crescent/donut/small part`).
4. **An edit while a draft is generating, or a "Preview at fabrication resolution" click followed by an edit.** Expected: the stale result stays visible and marked Stale, a superseded run never overwrites a newer revision, and the next export regenerates (UI-06). Test in E6 (`UI-06 fab preview of revision r is not shown for r+1`).
5. **A source smaller than the fabrication raster (the user's 4096 × 3084 on a 470 mm-high page: the desktop budget first coarsens the pitch to 0.109 mm, target 5727 × 4312 px, so the source is 1631 × 1228 px short and the raster stays 4096 × 3084 at 0.152 mm/px; verified with `rasterPlan`).** Expected: `FAB_EXCEEDS_SOURCE` visible at load and in the draft panel with the px shortfall, not ackable in the draft panel, ackable in the Fabrication review. Test in E8 (`PO-LASER-5 4096×3084 at 470 mm shows FAB_EXCEEDS_SOURCE at load`).

### E.5 Decisions taken while merging the drafts

Two drafts (fidelity-first, interactivity-first) were judged. The **fidelity draft is the backbone** (one request builder, one shown result, guides inside `generate`, no legacy in the app). Grafted from the interactivity draft: the two-slot stage cache (K1 orient/resample, K2 Kuwahara) for the draft (the separate fabrication cache was dropped in review: about 100–200 MB at fabrication rasters, E-R7); the paint-before-block veil; range sliders that commit on release; the Fabrication-plan diagnostics group that is not ackable in the draft panel; score paths drawn on Layers cards only (never on the Proof, which shows the visible face); `placement_map.svg` always included for bonded; the bench-recorded rationale with a test pinning the budget. Rejected or deferred:

- **Removing `draftPx` from `geometryKey`** (interactivity P1b): rejected for alpha.3. The device cap goes into `rasterPlan` instead (`min(draftPx, limits(dc).draftPxCap)`), so the project key is the same on every device and repairs do not go stale across devices; nothing else needs the key change. Known cost (review, 2026-10-08): a change of a preset's `draftPx` (E4, or later tuning) changes the fabrication `geometryHash` and every clip `keyHash` although the fabrication geometry is identical, so fabrication acks reset and clips go `REPAIR_STALE` once. Accepted for alpha.3 (runtime-only state, no saved projects) and listed in the E14 known-gaps table; the fix (drop `geometry.draftPx` from the key used by the fabrication hash and `keyHashAt`) belongs with G3.6/G3.8, when projects are saved.
- **User "Draft detail" select with a 2.5 Mpx "Fine" option:** deferred (Open question Q2). The fabrication preview is the way to see exact detail; a multi-second freeze per edit is the problem being fixed.
- **`opts.overlays:false` to skip draft overlay polygons:** kept only as a measurement in E4; it ships only if the overlay polygons are ≥ 15 % of construct time.
- **Replacing a draft review entry with a fabrication-quality review** (fidelity P6b): deferred. `keyHash` of every later entry covers the earlier entries, so replacing entry i would silently re-key entries i+1…; Keep = acknowledge the `REPAIR_REVIEW_FAB` warning on the fabrication snapshot, which the gate already supports.
- **Part-ID labels on parts:** deferred to G3.3 (ASM-01 says "optional"); alpha.3 scores the sheet number and the guides, and the placement map carries the part IDs.
- **Interior-mark rotation tick:** deferred; alpha.3 interior-mark is a position-only cross, inset-outline gives position and rotation.

### E.6 Tasks

Order is binding: E1 → E2 → E3 → E3b → E4 → E5 → E6, then E7, E8 (independent of each other, after E5), E9 → E10 → E11, E12 (after E6 and E1), E13 (after E11), E14 last. Each task ends with the full suite green and a commit.

---

#### Task E1: One request builder; the source record is installed at intake (fixes the P6 root cause)

**Files:**
- Modify: `js/engine.js:666-689` (`fabricationRequest` and its doc comment)
- Modify: `js/schema.js` (add `S.withSource` after `S.sourceTemplate`, `:406`)
- Modify: `js/app.js:1286-1329` (`decodeRaw`, `decodeSource`, `acceptSource`), `:818-835` (`fabReview` source read)
- Test: `test/run_tests.js` — new suite `engine.js/schema.js/app.js — alpha.3 E1 shared request and installed source (LYR-06, SUP-04)` before the report block; retarget the static checks that require `SBEngine.fabricationRequest(project,` in `app.js`: `test/run_tests.js:5037-5039` (SUP-04 export passes the project → `SBEngine.request(project, run.src, {quality: "fabrication"`) and `:5250-5251` (LYR-06 export regenerates → `SBEngine.request(` + `SBEngine.generate(` + `fabReview(` in `exportBundle`)

**Interfaces:**
- Produces: `SBEngine.sourceRecord(px: {w, h, channels}, route: {format, decode}, base?: SourceRecord) → SourceRecord` (orientation `{exif: 1, exifAppliedBy: "none", rotate: 0, mirror: false}`; every other field of `base`, including the user's `alpha` policy, is kept); `SBEngine.sampleBytes(px) → Uint8Array`, the canonical sample stream `u32le(w) u32le(h) u32le(channels) u8(alpha ? 1 : 0) pixels [alpha]`, so `sampleHash = SHA-256(sampleBytes(px))` covers the alpha plane of the raw gray+alpha route (`decodeRaw`, `js/app.js:1286-1290`); `SBEngine.request(project, px: {pixels, channels: 1|4, w, h, alpha}, {quality, requestId?, deviceClass?}) → GenerateRequest` (uses `project.source` as-is; `config === project` contents, never rewritten; throws `SOURCE_MISMATCH` when `project.source` is set and its `w`, `h` or `channels` differ from `px`); `SBEngine.fabricationRequest(project, px, o)` unchanged signature: installs a record only when `project.source === null` (the alpha.2 callers and checks), otherwise it is exactly `E.request(project, px, {quality: "fabrication", …})` and so also throws `SOURCE_MISMATCH`; the app never calls it after E1; `SBSchema.withSource(project, record) → project` (clone, `revision + 1` iff `geometryKey` changes).
- App produces: `run.src = {pixels, channels, w, h, alpha, gen, sampleHash}` (read once per `sourceGen`); `project.source.byteHash`/`sampleHash` are real SHA-256 values (`SBHash.digest`), and `req.sourceHash` = `sampleHash`. `regenerate` and `fabReview` refuse to run unless `run.src.sampleHash === project.source.sampleHash` (the pixels and the record they run under always belong together).

- [x] **Step 1: Write the failing tests**

```js
suite("engine.js/schema.js/app.js — alpha.3 E1 shared request and installed source (LYR-06, SUP-04)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema, SP = SBSupport;
  check("alpha.3 API present (SBEngine.request, SBEngine.sourceRecord, SBSchema.withSource)",
    typeof E.request === "function" && typeof E.sourceRecord === "function" && typeof S.withSource === "function");
  if (typeof E.request !== "function") return;
  const w = 400, h = 100, px = { pixels: F.ramp(w, h), channels: 1, w, h, alpha: null };
  const p0 = S.defaults("plywood"); p0.geometry.targetMM = 10;
  const p = S.withSource(p0, E.sourceRecord(px, { format: "png", decode: "raw-gray8" }));
  check("PRJ-02 withSource installs the record and bumps the revision", p.source && p.source.w === w && p.revision === p0.revision + 1 && p0.source === null);
  const d = E.request(p, px, { quality: "draft" }), f = E.request(p, px, { quality: "fabrication" });
  check("LYR-06 draft and fabrication requests differ only in quality (config and normalizedSource identical)",
    d.quality === "draft" && f.quality === "fabrication" && JSON.stringify(d.config) === JSON.stringify(f.config) &&
    d.normalizedSource.pixels === f.normalizedSource.pixels && JSON.stringify(d.config) === JSON.stringify(p));
  check("LYR-06 fabricationRequest on an installed source does not rewrite config.source",
    JSON.stringify(E.fabricationRequest(p, px, { format: "png", decode: "raw-gray8" }).config.source) === JSON.stringify(p.source));
  // The app flow that alpha.2 got wrong: review a clip on a draft generate of the installed project, export at fabrication.
  const tall = S.defaults("plywood"); tall.geometry.targetMM = 10;
  const hm = F.heightMap(7, 200, 200), pxh = { pixels: hm, channels: 1, w: 200, h: 200, alpha: null };
  let q = S.withSource(tall, E.sourceRecord(pxh, { format: "png", decode: "raw-gray8" }));
  const dr = E.generate(E.request(q, pxh, { quality: "draft" })).snapshot;
  q = SP.applyClip(q, SP.proposeClip(dr, 1));   // replay raises REPAIR_REVIEW_FAB for any draft review, even an empty clip
  const fr = E.generate(E.request(q, pxh, { quality: "fabrication" })).snapshot;
  check("SUP-04 a draft-reviewed clip replays at fabrication as REPAIR_REVIEW_FAB, never REPAIR_STALE",
    fr.diagnostics.some((x) => x.code === "REPAIR_REVIEW_FAB") && !fr.diagnostics.some((x) => x.code === "REPAIR_STALE"));
  const warn = fr.diagnostics.filter((x) => SBDiag.CODES[x.code].severity === "warning");
  const blocking = fr.diagnostics.filter((x) => SBDiag.CODES[x.code].severity === "blocking");
  check("EXP-07 the clip alone never blocks: no blocking item, and acknowledging the warnings on the fab snapshot allows export",
    blocking.length === 0 && SBDiag.exportGate(fr.diagnostics, warn.map((x) => SBDiag.ackKey(x, fr.geometryHash)), fr, "fabrication").allowed);
  const q2 = S.withSource(q, E.sourceRecord({ w: 200, h: 200, channels: 1 }, { format: "png", decode: "raw-gray8" }, Object.assign({}, q.source, { sampleHash: "f".repeat(64) })));
  check("PRJ-02 re-installing an identical source record changes nothing (same revision)", S.withSource(q, q.source).revision === q.revision);
  check("SUP-04 loading a different source makes an earlier clip stale, not silently applied",
    E.generate(E.request(q2, pxh, { quality: "fabrication" })).snapshot.diagnostics.some((x) => x.code === "REPAIR_STALE"));
  const pol = JSON.parse(JSON.stringify(q)); pol.source.alpha = { mode: "threshold", t: 0.3 };
  const re = S.withSource(pol, E.sourceRecord(pxh, { format: "png", decode: "raw-gray8" }, Object.assign({}, pol.source, { byteHash: pol.source.byteHash, sampleHash: pol.source.sampleHash })));
  check("PRJ-02 reloading the same file keeps the user's source policy (source.alpha) and the revision", re.revision === pol.revision && JSON.stringify(re.source.alpha) === JSON.stringify(pol.source.alpha));
  check("LYR-06 request refuses a source record that does not match the pixels (SOURCE_MISMATCH)",
    (() => { try { E.request(q, { pixels: new Uint8Array(100 * 100), channels: 1, w: 100, h: 100, alpha: null }, { quality: "draft" }); return false; } catch (e) { return /SOURCE_MISMATCH/.test(e.message); } })());
  const a1 = new Uint8Array(200 * 200).fill(255), a2 = new Uint8Array(200 * 200).fill(255); a2[0] = 0;
  const sb1 = E.sampleBytes(Object.assign({}, pxh, { alpha: a1 })), sb2 = E.sampleBytes(Object.assign({}, pxh, { alpha: a2 }));
  check("SUP-04 sampleBytes covers alpha: same gray samples, different alpha → different streams (so different sampleHash)",
    sb1.length === sb2.length && sb1.some((v, i) => v !== sb2[i]) && E.sampleBytes(pxh).length < sb1.length);
  checkAsync("SUP-04 sampleHash differs for the same samples with different alpha", Promise.all([SBHash.digest(sb1), SBHash.digest(sb2)]).then(([h1, h2]) => h1 !== h2));
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  const acc = fn("acceptSource");
  check("alpha.3 app.js installs the source record on the project at intake (SBSchema.withSource in acceptSource)", /SBSchema\.withSource\(/.test(acc));
  check("alpha.3 acceptSource assigns run.src only after the hashes resolve (no await between run.src = and the project install)",
    acc.lastIndexOf("await ") < acc.indexOf("run.src =") && acc.indexOf("run.src =") < acc.indexOf("SBSchema.withSource("));
  check("alpha.3 acceptSource installs the project without recompute() (one draft per load)", !/commitProject\(/.test(acc) && (acc.match(/regenerate\(\)/g) || []).length === 1);
  check("LYR-06 app.js never calls fabricationRequest; regenerate and fabReview check the sample hash",
    !/fabricationRequest\(/.test(appSrc) && /sampleHash/.test(fn("regenerate")) && /sampleHash/.test(fn("fabReview")));
});
```

- [x] **Step 2: Run to verify it fails**

Run: `node test/run_tests.js --only "alpha.3 E1 "` (trailing space: the runner matches substrings, `test/run_tests.js:5269`, and `"alpha.3 E1"` would also run E10–E14)
Expected: FAIL at "alpha.3 API present" (suite returns early).

- [x] **Step 3: Implement**

`js/engine.js` (replace `fabricationRequest` body; keep its doc comment, add the two new docs):

```js
  E.sourceRecord = function (px, route, base) {
    const src = Object.assign(global.SBSchema.sourceTemplate(), base ? JSON.parse(JSON.stringify(base)) : {});
    if (route && route.format) src.format = route.format;
    if (route && route.decode) src.decode = route.decode;
    src.w = px.w; src.h = px.h; src.channels = px.channels;
    src.orientation = { exif: 1, exifAppliedBy: "none", rotate: 0, mirror: false };
    return src;
  };
  E.sampleBytes = function (px) {
    const n = px.pixels.length, a = px.alpha || null, out = new Uint8Array(13 + n + (a ? a.length : 0)), dv = new DataView(out.buffer);
    dv.setUint32(0, px.w, true); dv.setUint32(4, px.h, true); dv.setUint32(8, px.channels, true); out[12] = a ? 1 : 0;
    out.set(px.pixels, 13); if (a) out.set(a, 13 + n);
    return out;
  };
  E.request = function (project, px, o) {
    o = o || {};
    const s = project.source;
    if (s && (s.w !== px.w || s.h !== px.h || s.channels !== px.channels))
      throw efail("SOURCE_MISMATCH", "project.source is " + s.w + " × " + s.h + " × " + s.channels + " but the pixels are " + px.w + " × " + px.h + " × " + px.channels);
    return { requestId: o.requestId === undefined ? o.quality : o.requestId, revision: project.revision, engineVersion: E.VERSION,
      quality: o.quality, normalizedSource: { pixels: px.pixels, channels: px.channels, w: px.w, h: px.h, alpha: px.alpha == null ? null : px.alpha },
      sourceHash: project.source ? (project.source.sampleHash || project.source.byteHash) : null, config: project,
      deviceClass: o.deviceClass === undefined ? "desktop" : o.deviceClass };
  };
  E.fabricationRequest = function (project, px, o) {
    o = o || {};
    const config = project.source ? project : Object.assign({}, project, { source: E.sourceRecord(px, o, null) });
    return E.request(config, px, { quality: "fabrication", requestId: o.requestId === undefined ? "export" : o.requestId, deviceClass: o.deviceClass });
  };
```

`js/schema.js`:

```js
  S.withSource = function (project, record) {
    const q = clone(project);
    q.source = clone(record);
    if (JSON.stringify(S.geometryKey(q)) !== JSON.stringify(S.geometryKey(project))) q.revision = project.revision + 1;
    return q;
  };
```

`js/app.js`:
- `decodeSource` returns `{ bitmap, raw }` where `raw` is `decodeRaw`'s result for the raw route (keep 1-channel samples; the canvas `samplesToCanvas` copy is kept only for the source thumbnail/preview background).
- New `sourcePixels(src)` builds `run.src` once: raw route → `{pixels: raw.samples, channels: raw.channels === 1 ? 1 : 4 …}` (a 3-channel raw RGB is expanded to RGBA once, alpha null when opaque); browser route → the `fabReview` canvas read moved here verbatim (`js/app.js:826-833`).
- `acceptSource` is race-free: it builds the pixels in a local `px`, computes `byteHash = await SBHash.digest(bytes)` and `sampleHash = await SBHash.digest(SBEngine.sampleBytes(px))` (WebCrypto, `js/hash.js:59`; the schema requires 64-hex values, `js/schema.js:434, 471`), then re-checks its `gen` against `sourceGen` (a newer load wins; drop this one), and only then, in **one synchronous block** with no `await`: `run.src = Object.assign(px, {gen, sampleHash})`, `run.draftCache = {}`, `project = SBSchema.withSource(project, SBEngine.sourceRecord(px, run.sourceRoute, Object.assign({}, project.source, {byteHash, sampleHash})))` (the base keeps the user's `source.alpha` policy), `syncControls()`, `updateDimbar()`, then exactly one `regenerate()`. It does **not** go through `commitProject` (whose `recompute()` would schedule a second debounced draft, `js/app.js:1051-1057`). Until that block runs, `run.src`, `project.source` and `project.revision` are all still the old load's, so a debounced `regenerate` or an Export click in the await window runs consistently on the old source. Reloading the identical file yields the identical record: no revision bump, earlier clips stay valid.
- `fabReview` uses `run.src` and `SBEngine.request(project, run.src, {quality: "fabrication", requestId: "export-" + rev, deviceClass: dc})`; `regenerate` and `fabReview` return early unless `run.src && project.source && run.src.sampleHash === project.source.sampleHash`.
- The explicit downsample and the Demo source go through `acceptSource` too, so they install their own records.

- [x] **Step 4: Run to verify it passes**

Run: `node test/run_tests.js --only "alpha.3 E1 "` → all ✓; then `node test/run_tests.js` → 0 failed (the alpha.2 check "fabricationRequest … p.source === null" still holds because `fabricationRequest` does not mutate its input and still installs a record for a null source).

- [x] **Step 5: Commit**

```bash
node build.js
git add js/engine.js js/schema.js js/app.js test/run_tests.js dist/shadowbox-studio.html
git commit -m "fix(engine,schema,app): one request builder; install the source record at intake so draft clips replay as REPAIR_REVIEW_FAB (alpha.3 E1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Result (2026-10-08):** as specified (commit `020df04`): `SBEngine.request`, `sourceRecord`, `sampleBytes` (alpha-covering), `SBSchema.withSource` (revision + 1 only when the key changes); `acceptSource` installs `run.src`, the bitmap and `project.source` in one synchronous block and runs one draft; `fabricationRequest` is a wrapper for null-source projects only.

---

#### Task E2: Engine payload the UI needs (no hash change)

**Files:**
- Modify: `js/engine.js:571-580` (cleanupReport), `:604-608` (repairs), `:657-660` (snapshot)
- Modify: `js/proof.js:96` (`cards`)
- Test: `test/run_tests.js` — suite `engine.js/proof.js — alpha.3 E2 snapshot payload (UI-05, G2.13d)`

**Interfaces:**
- Produces: `cleanupReport[k].bridged`, `.culled` (numbers from `built.report[k]`, `js/construct.js:99`); `snapshot.repairsApplied: number[]` (`rp.applied`, `[]` without repairs); `snapshot.page = {wMM, hMM, frameMM, artWMM, artHMM}`; `snapshot.construction = {mode, tMM, gMM}` (`project.construction.mode`, `material.thicknessMM`, `gapMM` in connected and `0` in bonded; display data, not hashed), so a stale result is always drawn with the settings it was generated with; `SBProof.cards(layers, page)[k].omitted: boolean` (`L.status === "omitted-trailing"`). Cut length is not reimplemented: the cards read the existing `MaterialLayer.stats.cutMM` (`js/material.js:81-85, 388`).

- [x] **Step 1: Write the failing tests**

```js
suite("engine.js/proof.js — alpha.3 E2 snapshot payload (UI-05, G2.13d)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema;
  const px = { pixels: F.heightMap(7, 200, 200), channels: 1, w: 200, h: 200, alpha: null };
  const p = S.withSource(Object.assign(S.defaults("acrylic"), {}), E.sourceRecord(px, { format: "png", decode: "raw-gray8" }));
  p.interpretation.mode = "height"; p.interpretation.polarity = "white-high"; p.geometry.widthMM = 60; p.geometry.targetMM = 84;
  const r = E.generate(E.request(p, px, { quality: "draft" })), s = r.snapshot;
  check("UI-05 cleanupReport carries bridged and culled per layer", r.status === "done" && s.cleanupReport.every((c) => Number.isFinite(c.bridged) && Number.isFinite(c.culled)));
  check("G2.13d snapshot.repairsApplied is [] without repairs", Array.isArray(s.repairsApplied) && s.repairsApplied.length === 0);
  check("§3 snapshot.page carries frameMM and the art size", s.page.frameMM === 12 && s.page.artWMM === s.geometry.artWMM && s.page.artHMM === s.geometry.artHMM);
  check("NFR-05 the payload additions do not change geometryHash (hash recomputed from its inputs)",
    s.geometryHash === SBHash.hashJSON({ key: S.geometryKey(p), engine: E.VERSION, quality: "draft", raster: [s.geometry.rasterW, s.geometry.rasterH],
      layers: s.layers.map((L) => SBGeom.layerHashes(L).layerHash), guides: E.guideHash(s.guides) }));
  const sq = [{ outer: [0, 0, 10000, 0, 10000, 10000, 0, 10000], holes: [] }];
  check("UI-05 snapshot.construction carries mode, thickness and gap (bonded: gap 0)", s.construction.mode === "connected-sheet" && s.construction.tMM === p.material.thicknessMM && s.construction.gMM === p.construction.gapMM);
  check("UI-05 cards read MaterialLayer.stats.cutMM (no second cut-length routine)", typeof SBProof.cutLengthMM === "undefined" && s.layers.every((L) => Number.isFinite(L.stats.cutMM)));
  const cards = SBProof.cards([{ index: 0, material: sq, status: "ok" }, { index: 1, material: [], status: "omitted-trailing" }], { wMM: 10, hMM: 10 });
  check("LYR-01 cards mark omitted-trailing layers", cards[1].omitted === true && cards[0].omitted === false);
});
```

- [x] **Step 2: Run to verify it fails** — `node test/run_tests.js --only "alpha.3 E2"` → ✗ on `bridged`.

- [x] **Step 3: Implement**

In the `cleanupReport` map add `bridged: r.bridged || 0, culled: r.culled || 0` (use the construct report's field names; read `js/construct.js:99` and map them exactly). Keep `rp` in scope: `let applied = []; if (con.repairs.length) { …; applied = rp.applied; }` and add `repairsApplied: applied` to the snapshot. Snapshot page: `page: { wMM: page.wMM, hMM: page.hMM, frameMM: page.frameMM, artWMM: geo.artWMM, artHMM: geo.artHMM }`; snapshot `construction: { mode: con.mode, tMM: p.material.thicknessMM, gMM: bonded ? 0 : con.gapMM }` (outside the `hashJSON` input). In `P.cards` set `omitted: L.status === "omitted-trailing"` on each card.

- [x] **Step 4: Run** — the E2 suite ✓ and the full suite 0 failed.
- [x] **Step 5: Commit** — `node build.js`; `git add js/engine.js js/proof.js test/run_tests.js dist/shadowbox-studio.html`; message `feat(engine,proof): repairsApplied, bridged/culled, page art size, snapshot construction, omitted cards (alpha.3 E2)` + trailer.

**Result (2026-10-08):** as specified (commit `2a6f7f7`): `cleanupReport[k].bridged/culled`, `snapshot.repairsApplied`, `snapshot.page.{frameMM, artWMM, artHMM}`, `snapshot.construction`, omitted cards; `geometryHash` unchanged.

---

#### Task E3: Caller-owned stage cache in `generate`

**Files:**
- Modify: `js/engine.js:475-492` (`E.generate` passes `opts.cache` to `run`), `:523-558` (stages 1–4), `:298-316` (`E.orient` identity fast path)
- Test: `test/run_tests.js` — suite `engine.js — alpha.3 E3 stage cache (NFR-05)`

**Interfaces:**
- Consumes: `req.sourceHash` (= `project.source.sampleHash`, E1), `SBRaster.cacheKey`.
- Produces: `generate(req, {cache})` where `cache` is a plain object the caller owns; slots `cache.k1 = {key, o, samples, alpha, ch}` (orient + resample) and `cache.k2 = {key, L}` (tonal luminance after Kuwahara). A cache carries its quality: the app creates `run.draftCache = {quality: "draft"}`, and `generate` throws `CACHE_QUALITY` when `cache.quality !== req.quality` (a draft cache can never feed a fabrication run, or the reverse). The app passes **no** cache to fabrication runs in alpha.3 (memory, E-R7); the engine supports `{quality: "fabrication"}` caches and tests them. `E.orient` with the identity orientation returns `{samples, alpha, w, h, oriented: true}` on the input arrays instead of copying (about 0.45 s per cold run on 12.6 Mpx); that is safe only because no later stage writes into its input, which Step 3 confirms.

Keys (strings): `k1 = SBRaster.cacheKey({w: ns.w, h: ns.h, channels: ch, W, H, method: geo.resample, sampleHash: req.sourceHash}) + "|" + JSON.stringify(p.source.orientation) + "|" + interp.mode + "|" + (ns.alpha ? "a" : "-")`; `k2 = k1 + "|" + JSON.stringify(interp.smoothing) + "|" + JSON.stringify(p.source.alpha)`. Without `req.sourceHash` the cache is bypassed (never keyed on pixels identity alone).

- [x] **Step 1: Write the failing tests**

```js
suite("engine.js — alpha.3 E3 stage cache (NFR-05)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema;
  const w = 300, h = 200, rgba = new Uint8Array(w * h * 4); const g = F.heightMap(3, w, h);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = g[i]; rgba[4 * i + 1] = (g[i] * 3) & 255; rgba[4 * i + 2] = 255 - g[i]; rgba[4 * i + 3] = 255; }
  const px = { pixels: rgba, channels: 4, w, h, alpha: null };
  const p = S.withSource(S.defaults("plywood"), Object.assign(E.sourceRecord(px, { format: "png", decode: "canvas-tonal" }), { sampleHash: "a".repeat(64) }));
  const q = S.applyModeChange(p, { interpretation: { mode: "tonal" } }, true); q.geometry.targetMM = 40;
  const req = E.request(q, px, { quality: "draft" });
  const plain = E.generate(req), cache = {}, c1 = E.generate(req, { cache }), marks = [];
  const c2 = E.generate(req, { cache, onProgress: (st) => marks.push(st) });
  check("NFR-05 generate with a cold and a warm cache equals generate without (geometryHash)",
    plain.status === "done" && c1.geometryHash === plain.geometryHash && c2.geometryHash === plain.geometryHash);
  check("cache: a warm run reports the cached stages (resample-cached, interpret-cached)", marks.includes("resample-cached") && marks.includes("interpret-cached"));
  const q2 = JSON.parse(JSON.stringify(q)); q2.construction.sheets = 6; q2.revision++;
  const m2 = []; E.generate(E.request(q2, px, { quality: "draft" }), { cache, onProgress: (st) => m2.push(st) });
  check("cache: changing sheets reuses K1 and K2", m2.includes("resample-cached") && m2.includes("interpret-cached"));
  const q3 = JSON.parse(JSON.stringify(q)); q3.interpretation.smoothing = { radius: 2, passes: 1 }; q3.revision++;
  const m3 = []; E.generate(E.request(q3, px, { quality: "draft" }), { cache, onProgress: (st) => m3.push(st) });
  check("cache: changing smoothing reuses K1 only", m3.includes("resample-cached") && !m3.includes("interpret-cached"));
  check("NFR-05 a cached run never mutates the cached arrays (third run equal)", E.generate(req, { cache }).geometryHash === plain.geometryHash);
  check("LYR-06 a cache tagged draft is refused by a fabrication request (CACHE_QUALITY)",
    (() => { try { E.generate(E.request(q, px, { quality: "fabrication" }), { cache: { quality: "draft" } }); return false; } catch (e) { return /CACHE_QUALITY/.test(e.message); } })());
  const fq = E.request(q, px, { quality: "fabrication" }), fc = { quality: "fabrication" }, fcold = E.generate(fq, { cache: fc });
  const fq2 = E.request(q2, px, { quality: "fabrication" });
  check("LYR-06 a warm fabrication cache after a sheets edit equals an uncached fabrication run (geometryHash)",
    fcold.status === "done" && E.generate(fq2, { cache: fc }).geometryHash === E.generate(fq2).geometryHash);
  const id = { exif: 1, exifAppliedBy: "none", rotate: 0, mirror: false }, sm = new Uint8Array([1, 2, 3, 4, 5, 6]);
  check("NFR-05 E.orient at identity returns the input samples without copying", E.orient({ samples: sm, alpha: null, w: 3, h: 2 }, id).samples === sm);
});
```

- [x] **Step 2: Run** — `node test/run_tests.js --only "alpha.3 E3"` → ✗ (no `-cached` marks).
- [x] **Step 3: Implement** — In `run`, compute `plan` before stage 1 (it only reads sizes), build `k1`; if `cache && cache.k1 && cache.k1.key === k1` reuse `{o-size, samples, alpha, ch}` and call `onProgress("resample-cached", 0.1)` via `step`; otherwise run stages 1–2 as today and store them. Same for K2 around `R.luminance`+`R.kuwahara` with `"interpret-cached"`. Before storing, confirm by reading `R.resample`, `R.luminance`, `R.kuwahara`, `R.thresholds`, `R.bands`, `Hh.domainMask`, `E.interpretHeight` and `H.applyFilter` that none writes into its input; if one does, store a copy (`slice()`) and drop the `E.orient` fast path. Throw `CACHE_QUALITY` at the top of `generate` when `opts.cache && opts.cache.quality !== req.quality`. Retarget any existing `E.orient` check that asserts a fresh output array at identity (the ORIENT_TWICE check keeps passing: the fast path returns `oriented: true`). `E.generate` passes `opts.cache` through to `run(req, head, step, fail, opts.cache)`. Results stay deep-frozen; cached typed arrays are skipped by `deepFreeze` and are never returned in the snapshot.
- [x] **Step 4: Run** — E3 ✓, full suite 0 failed.
- [x] **Step 5: Commit** — `node build.js`; add `js/engine.js test/run_tests.js dist/shadowbox-studio.html`; `perf(engine): caller-owned stage cache for orient/resample and Kuwahara (alpha.3 E3)` + trailer.

**Result (2026-10-08):** as specified (commit `c98cad4`): K1/K2 caller-owned cache keyed on `SBRaster.cacheKey` + `sourceHash`, `resample-cached`/`interpret-cached` marks, `CACHE_QUALITY`; an untagged cache adopts its first request's quality. The identity `E.orient` fast path ships (no later stage writes into its input; verified).

---

#### Task E3b: Physical-unit filter radii and a draft-vs-fabrication fidelity check

**Why (review 2026-10-08):** the Kuwahara radius (`interpretation.smoothing.radius`, `js/schema.js:484`, used at `js/engine.js:552`) and the height-filter radius (`heightFilter.radius`, `js/engine.js:333`) are in raster pixels. On the user's source r4 smooths about 1.5–2.2 mm on a draft raster and about 0.6 mm on the 4096 px fabrication raster (0.152 mm/px), so band thresholds are computed on different luminance fields and the draft shows smoother, larger and fewer parts than the cut file. Kuwahara uses summed-area tables (`js/raster.js:61-97`), so its cost does not grow with the radius and a physical radius is affordable at fabrication.

**Files:**
- Modify: `js/schema.js` (`interpretation.smoothing = {radiusMM, passes}` replacing `radius`; `heightFilter = {op, radiusMM}` for the radius ops; validation `radiusMM` 0–5 in 0.05 steps, heightFilter 0.05–25; presets: acrylic `radiusMM: 1.65` (= r4 at 720 px on its 300 mm default width), plywood `0`; `fromLegacySettings`/`applyLegacy`: `radiusMM = round20(smoothRadius × artLongMM / procRes)` with the art long side from `S.resolveSize` when the source size is known, else `geometry.targetMM`; `legacyState` maps back with the same pitch; `applyControl("smooth")` takes mm), `js/engine.js:333, :552` (convert per raster), `index.html` + `js/app.js` (the smoothing control shows mm), `docs/USER_GUIDE.md`
- Test: `test/run_tests.js` — new suite `schema.js/engine.js — alpha.3 E3b physical filter radii and draft fidelity (LYR-06, IMG-04)`; retarget every existing check that reads `smoothing.radius` or `heightFilter.radius` (about 50 references; `grep -n "smoothing\|heightFilter" test/run_tests.js`), keeping each check's intent and SRS ID. The DEP-04 legacy oracles keep their pixel semantics through `legacyState`.

**Interfaces:**
- Produces: `SBEngine.radiusPx(radiusMM, geometry) → integer` = `max(0, round(radiusMM·1000 / pMaxUm))` with `pMaxUm` the coarser axis pitch of the run's raster (the `constructPx` convention, `js/engine.js:405`), at least 1 when `radiusMM > 0` for the height filter. Stage 4 calls `R.kuwahara(L, W, H, radiusPx(smoothing.radiusMM, geo), passes, domain)` and `E.interpretHeight` converts `heightFilter.radiusMM` the same way. The `HEIGHT_FILTERED` detail states mm and px.
- `geometryKey` changes (a new field); no persisted goldens exist (E.0 item 8).

- [x] **Step 1: Write the failing tests**

```js
suite("schema.js/engine.js — alpha.3 E3b physical filter radii and draft fidelity (LYR-06, IMG-04)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema;
  check("E3b API present (SBEngine.radiusPx, smoothing.radiusMM)", typeof E.radiusPx === "function" && "radiusMM" in S.defaults("acrylic").interpretation.smoothing);
  if (typeof E.radiusPx !== "function") return;
  check("IMG-04 radiusPx converts mm by the coarser axis pitch", E.radiusPx(1.65, { mmPerPxMax: 0.4125 }) === 4 && E.radiusPx(1.65, { mmPerPxMax: 0.1 }) === 17 && E.radiusPx(0, { mmPerPxMax: 0.1 }) === 0);
  const leg = S.fromLegacySettings({ procRes: 720, smoothRadius: 4, smoothPasses: 2, nSheets: 5, widthMM: 300 }).project;
  check("DEP-04 legacy smoothRadius 4 at 720 px on 300 mm maps to radiusMM 1.65 and back", leg.interpretation.smoothing.radiusMM === 1.65 && S.legacyState(leg).smoothRadius === 4);
  // fidelity: a smooth colour fixture, tonal bonded, draft at a quarter of the fabrication raster
  const w = 640, h = 480, g = F.heightMap(7, w, h), rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = g[i]; rgba[4 * i + 1] = 255 - g[i]; rgba[4 * i + 2] = (g[i] >> 1) + 64; rgba[4 * i + 3] = 255; }
  const px = { pixels: rgba, channels: 4, w, h, alpha: null };
  let p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "canvas-tonal" }));
  p = S.applyModeChange(p, { interpretation: { mode: "tonal" } }, true); p.interpretation.smoothing = { radiusMM: 1.65, passes: 2 };
  p.geometry.targetMM = 120; p.geometry.draftPx = 160; p.geometry.fabPitchMM = 0.25;
  const d = E.generate(E.request(p, px, { quality: "draft" })).snapshot, f = E.generate(E.request(p, px, { quality: "fabrication" })).snapshot;
  const pageMM2 = f.page.wMM * f.page.hMM, TOL = 0.08, PARTS = 2;   // recorded tolerance; never loosened without a plan note
  const big = f.layers.map((L, k) => k).filter((k) => f.layers[k].stats.areaMM2 > 0.05 * pageMM2);
  check("LYR-06 draft vs fabrication: per-layer area within 8 % on every layer above 5 % of the page", big.length > 0 &&
    big.every((k) => Math.abs(d.layers[k].stats.areaMM2 - f.layers[k].stats.areaMM2) <= TOL * f.layers[k].stats.areaMM2));
  check("LYR-06 draft vs fabrication: part counts within a factor of 2 per layer",
    f.layers.every((L, k) => { const a = d.layers[k].parts.length, b = L.parts.length; return Math.max(a, b) <= PARTS * Math.max(1, Math.min(a, b)); }));
});
```

(Read `fromLegacySettings`' required keys, `js/schema.js:622-655`, and the geometry field that holds the coarser pitch before Step 2; adjust the fixture names, not the tolerances. If the fixture fails the tolerance only because of `constructPx` whole-pixel rounding, `js/engine.js:405-417`, record the measured worst case in the check comment and in `docs/perf/DRAFT.md` and keep the tolerance; do not loosen it silently.)

- [x] **Step 2: Run** — `node test/run_tests.js --only "alpha.3 E3b"` → ✗ (no `radiusPx`).
- [x] **Step 3: Implement** — schema field, validation, presets, legacy mapping both ways, `applyControl`, the control's unit in `index.html`/`app.js`, `E.radiusPx` and the two call sites; the E3 K2 key uses `JSON.stringify(interp.smoothing)` plus the converted `rPx` (so a raster change re-keys K2). Retarget the existing checks. `docs/USER_GUIDE.md`: "Smoothing is in millimetres; draft and fabrication smooth the same physical size."
- [x] **Step 4: Run** — E3b ✓, full suite 0 failed.
- [x] **Step 5: Commit** — `node build.js`; add `js/schema.js js/engine.js js/app.js index.html test/run_tests.js docs/USER_GUIDE.md dist/shadowbox-studio.html`; `fix(schema,engine): filter radii in mm, converted per raster; draft-vs-fabrication fidelity check (alpha.3 E3b)` + trailer.

**Result (2026-10-08):** as specified (commit `14cb9dc`): `smoothing.radiusMM` (0–5 mm) and `heightFilter.radiusMM`; acrylic 1.65 mm, plywood 0 (D1); `SBEngine.radiusPx` by the coarser axis pitch. Fidelity check: per-layer area within 8 %, part counts within 2× (measured 2.28 % and 1.75×; pixel radii gave 7.68 % and 11×).

---

#### Task E4: Measure and record the draft budget

**Files:**
- Modify: `test/bench.js` (add `draft` to `STAGES`, `:92`)
- Create: `docs/perf/draft-budget.json`, `docs/perf/DRAFT.md`
- Modify: `js/schema.js:150-153` (`LIMITS.*.draftPxCap`, `LIMITS.*.fabMsPerMpx`), `:378, :396` (preset `draftPx`)
- Modify: `js/engine.js:361-363` (draft branch of `rasterPlan`)
- Test: `test/run_tests.js:2918` retarget; new suite `schema.js/engine.js — alpha.3 E4 draft budget (PO-PREVIEW-1)`

**Interfaces:**
- Produces: `SBSchema.limits(dc).draftPxCap` (desktop: the larger of the two preset decisions, mobile: 720); `SBSchema.limits(dc).fabMsPerMpx` (desktop: measured; mobile: desktop × 4, k provisional as in D.8), read by the E6 busy text (the offline app cannot read `docs/` at runtime); `rasterPlan(…, "draft", dc)` uses `SBRaster.rasterSize(srcW, srcH, Math.min(g.draftPx, lim.draftPxCap))`; each preset's `draftPx` = its own decision.

Bench workload: 4096 × 3084 RGBA from the bench's own art generators, the **realistic and the busy families** (`test/bench.js:251-263`; construct, trace and validate scale with art complexity, so the smooth `F.heightMap` would underestimate), with colour channels as in E3; projects: (a) plywood auto-tonal (E7's patch: tonal, light-front, smoothing `radiusMM` 1.65 p2 after E3b, bonded, 8 sheets, targetMM 300), (b) plywood height, (c) acrylic connected (smooth corners, KI-CONN-PERF). Candidates `draftPx ∈ {720, 1024, 1280, 1536, 2000}`; per candidate and family 1 cold run, 3 warm-ups and **≥ 15 warm runs** (warm = E3 cache filled, a changed `sheets` value between runs so construct reruns), reporting cold, warm p50 and **warm p95**; also the share of construct spent in the draft overlay polygons. A fabrication row per family: (a) at the fabrication raster, 1 cold + 5 runs, `fabMsPerMpx` = p50 ms ÷ raster Mpx.

**Decision rule (recorded in the JSON):** for each preset, `draftPx` = the largest candidate whose **warm p95 ≤ 3.0 s on both families** for its workload (plywood: (a); acrylic: (c)) on the reference machine (i7-11800H); desktop `draftPxCap` = the larger of the two; mobile cap 720 (mobile = 4× slower, k provisional as in D.8). **Deviation recorded:** 3.0 s p95 is twice G4.4's desktop draft target (p95 ≤ 1.5 s, which needs the G4.1 worker); `docs/perf/DRAFT.md` states the deviation and that G4.4 re-measures against 1.5 s. **Expected outcome** (review timings on the reference machine, 12.6 Mpx tonal bonded r4 p2: 720 px ≈ 1.5–2.2 s warm, 1024 px ≈ 3.5 s, 1280 px ≈ 4.5 s): **720 px for plywood auto-tonal, possibly 1024 px for height mode**, which (b) records; acrylic stays 720 unless (c) qualifies higher (it is the slowest, KI-CONN-PERF). Not the 2–4 Mpx asked for. If (a) exceeds 3.0 s even at 720, keep 720 and record it as a known gap pointing at G4.1. **Re-run after E11:** stage-14 guides run in every draft, so E11 re-runs `node test/bench.js draft --record` and may lower the decision (E11 Step 4).

- [x] **Step 1: Write the failing tests**

```js
suite("schema.js/engine.js — alpha.3 E4 draft budget (PO-PREVIEW-1)", () => {
  const rec = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs/perf/draft-budget.json"), "utf8"));
  const L = SBSchema.limits;
  check("PO-PREVIEW-1 draft budget equals docs/perf/draft-budget.json (desktop cap, mobile cap, preset draftPx)",
    L("desktop").draftPxCap === rec.decision.desktopDraftPx && L("mobile").draftPxCap === rec.decision.mobileDraftPx &&
    rec.decision.desktopDraftPx === Math.max(rec.decision.presets.plywood, rec.decision.presets.acrylic) &&
    SBSchema.defaults("plywood").geometry.draftPx === rec.decision.presets.plywood && SBSchema.defaults("acrylic").geometry.draftPx === rec.decision.presets.acrylic);
  check("PO-PREVIEW-2 limits().fabMsPerMpx equals the recorded fabrication row (desktop) and × 4 (mobile)",
    L("desktop").fabMsPerMpx === rec.decision.fabMsPerMpx && L("mobile").fabMsPerMpx === 4 * rec.decision.fabMsPerMpx);
  const p = SBSchema.defaults("plywood"); p.source = SBSchema.sourceTemplate();
  const m = SBEngine.rasterPlan(p, { w: 4096, h: 3084 }, "draft", "mobile").geometry, d = SBEngine.rasterPlan(p, { w: 4096, h: 3084 }, "draft", "desktop").geometry;
  check("PO-PREVIEW-1 rasterPlan applies the mobile draftPxCap without changing the project key",
    Math.max(m.rasterW, m.rasterH) === Math.min(p.geometry.draftPx, 720) && Math.max(d.rasterW, d.rasterH) === Math.min(p.geometry.draftPx, rec.decision.desktopDraftPx));
  check("PO-PREVIEW-1 the rationale names the rule (p95, both families, G4.4 deviation), machine and workload",
    /3\.0 s/.test(rec.rule) && /p95/.test(rec.rule) && /1\.5 s/.test(rec.rule) && /11800H/.test(rec.machine) && /4096/.test(rec.workload) && /busy/.test(rec.workload) && /realistic/.test(rec.workload));
});
```

and change `test/run_tests.js:2918` to `p.geometry.draftPx === JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs/perf/draft-budget.json"), "utf8")).decision.presets.plywood` (the preset that check builds; read it first and use the matching preset), renaming the check `PO-LASER-4/PO-PREVIEW-1 fab pitch 0.1 mm, draft from docs/perf/draft-budget.json`.

- [x] **Step 2: Run** — ✗ (file missing).
- [x] **Step 3: Implement** — write `benchDraft()` in `test/bench.js` (`node test/bench.js draft [--record]`, `--record` writes the JSON `{machine, workload, rule, rows: [{draftPx, raster, mode, family, coldMs, warmP50Ms, warmP95Ms, overlayShare}], fabRows: [{family, raster, mpx, ms}], decision: {presets: {plywood, acrylic}, desktopDraftPx, mobileDraftPx, fabMsPerMpx}}`), run it with `--record`, write `docs/perf/DRAFT.md` (table + rule + the G4.4 deviation + why 2–4 Mpx is not interactive on the main thread + pointer to G4.1), then add `draftPxCap` and `fabMsPerMpx` to both `LIMITS` entries and the `rasterPlan` draft branch, and set each preset's `draftPx` from its own decision. If `overlayShare ≥ 0.15`, add `opts.overlays === false` skipping `e.added/e.removed` (`js/engine.js:575-579`) with the check `G2.13b overlays:false omits added/removed, geometryHash unchanged`; otherwise record "not worth it" in DRAFT.md.
- [x] **Step 4: Run** — full suite 0 failed (fixtures are small, so a higher `draftPx` never upsamples them).
- [x] **Step 5: Commit** — `node build.js`; add `test/bench.js docs/perf/draft-budget.json docs/perf/DRAFT.md js/schema.js js/engine.js test/run_tests.js dist/shadowbox-studio.html`; `perf(schema,engine): measured draft budget with device cap (alpha.3 E4)` + trailer.

**Result (2026-10-08):** measured (commit `186169f`, `docs/perf/DRAFT.md`): plywood 720 px (warm p95 1.97 s realistic, 2.18 s busy; 1024 missed at 3.22/3.77 s); acrylic 720 recorded as a known gap (8.9 s / 28.5 s, KI-CONN-PERF); `draftPxCap` 720 on desktop and mobile; `fabMsPerMpx` 2410 (mobile ×4). Overlay polygons measured at 44 % of construct, so `opts.overlays:false` ships.

---

#### Task E5: The draft preview runs `SBEngine.generate`; the legacy draft path leaves the app

**Files:**
- Modify: `js/app.js` — `regenerate` (`:127-189`), delete `buildView` (`:241-275`), `showRaster` (`:552`), `rasterCard` (`:601`), the KI-CONN-PERF deferral (`:216-240`, which **is** `renderAll`, `:227`); `renderSheetGrid` (`:563-598`); `renderDiagnostics` (`:306`); `setRunState` wiring (`:91`); `viewCurrent` (`:422`); `openClipDialog` (`:501-505`); `updateDimbar` (`:1177-1184`); every `run.sheets.length` (`:114, :157, :228, :312, :767, :1183`); `bindControls` (`:1146-1163`, range inputs commit on `change`)
- Modify: `js/preview.js` — remove `setSheets`, `setSnapshot`'s `opts.bridges` branch (`:142-157`) and `maskToCanvas` (`:124, :368`); keep `snapshot()`
- Test: `test/run_tests.js` — new suite `app.js — alpha.3 E5 real-engine draft (PO-PREVIEW-1, LYR-06, UI-05)`; retarget the static checks that name the legacy draft path: `:4539-4557` (G2.12), `:4629-4639` (G2.13a), `:4792-4793` (G2.13b), `:4910` (G2.13c), `:5036` (G2.13d); and the checks that pin the shape of `regenerate`/`renderAll`: `:4071-4074` (`regenerate` calls `SBSchema.canGenerate` within 400 chars), `:4289-4290` (PRJ-02 appearance change → `renderAll()`; retarget to the renderer that replaces it, e.g. `showResult(run.shown)`), `:5181` (`function regenerate() {\s*syncControls()`). The new `regenerate` keeps `syncControls()` as its first statement and the `canGenerate` guard right after it, so `:4071-4074` and `:5181` keep passing unchanged. Engine-level legacy oracles (`:691-700`, `:2535-2600`, `:4648-4858`) stay unchanged.

**Interfaces:**
- Consumes: E1 `SBEngine.request`, `run.src`; E2 payload; E3 `{cache}`; E4 caps.
- Produces: `run.draft = {status, snapshot, diagnostics, error, revision, gen, ms, acks}`; `run.shown` (points at `run.draft` or, after E6, `run.fab`); `showResult(r)` renders every view from `r.snapshot` only (`preview.setSnapshot({page, layers, tMM, gMM} from r.snapshot.page/.layers/.construction)`, `SBProof.overlays({cleanupReport, diagnostics, mode: r.snapshot.construction.mode})`, `renderSheetGrid`, `renderDiagnostics(r)`, `renderRepairs`, `updateDimbar`, status line). A stale result kept on screen after an edit is therefore drawn with its own mode, thickness and gap, never the edited project's. The clip dialog proposes on `run.shown.snapshot` with `quality = snapshot.quality`; `run.applied` is replaced by `run.shown.snapshot.repairsApplied`.

- [x] **Step 1: Write the failing tests**

```js
suite("app.js — alpha.3 E5 real-engine draft (PO-PREVIEW-1, LYR-06, UI-05)", () => {
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  check("PO-PREVIEW-1 app.js calls no SBEngine.legacy* (legacyRun, legacyView, legacyDiagnostics, legacySnapshotHash, legacyCleanupReport)", !/SBEngine\.legacy\w*\(/.test(appSrc));
  check("PO-PREVIEW-1 regenerate calls SBEngine.generate on SBEngine.request(…, {quality: \"draft\"}) with the draft cache",
    /SBEngine\.generate\(\s*SBEngine\.request\([^)]*quality:\s*"draft"/.test(fn("regenerate")) && /run\.draftCache/.test(fn("regenerate")));
  check("LYR-06 regenerate no longer downsamples on a canvas (no drawImage)", !/drawImage\(/.test(fn("regenerate")));
  check("UI-05 regenerate paints the Stale state before the blocking run (rAF + task)", /requestAnimationFrame\(/.test(fn("regenerate")) || /paintThen\(/.test(fn("regenerate")));
  check("UI-04 the diagnostics panel lists res.diagnostics when generate fails with no layers (COMPLEXITY_LIMIT)", /\.status === "error"/.test(appSrc) && /renderDiagnostics\(/.test(fn("regenerate") + fn("showResult")));
  // buildAssemblyMD (js/app.js:700-752) still reads run.sheets/procW until E13 deletes it; it is excluded here and E13 drops the exclusion
  check("alpha.3 no run.sheets / procW / viewToken left in app.js (outside buildAssemblyMD until E13)", !/run\.sheets\b|run\.procW|run\.viewToken/.test(appSrc.replace(fn("buildAssemblyMD"), "")));
  check("UI-05 showResult reads only the result's snapshot (no project.* reference)", fn("showResult").length > 0 && !/\bproject\./.test(fn("showResult")));
  check("SUP-06 app.js never passes bridges to preview.setSnapshot; preview.js has no opts.bridges branch",
    !/setSnapshot\([^;]*bridges/.test(appSrc) && !/o\.bridges|opts\.bridges/.test(fs.readFileSync(path.join(__dirname, "..", "js", "preview.js"), "utf8")));
  check("PO-PREVIEW-1 the draft status line says the draft is approximate", /Draft \(approximate/.test(appSrc));
  // bonded never shows bridges, by construction (engine-level)
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema, w = 200, h = 150, rgba = new Uint8Array(w * h * 4), g = F.heightMap(5, w, h);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = g[i]; rgba[4 * i + 1] = 255 - g[i]; rgba[4 * i + 2] = (g[i] * 7) & 255; rgba[4 * i + 3] = 255; }
  const px = { pixels: rgba, channels: 4, w, h, alpha: null };
  let p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "canvas-tonal" }));
  p = S.applyModeChange(p, { interpretation: { mode: "tonal" } }, true); p.geometry.targetMM = 60;
  const s = E.generate(E.request(p, px, { quality: "draft" })).snapshot;
  check("PO-PREVIEW-1 bonded colour draft: no cleanupReport bridges and every SBProof.overlays(bonded) entry has bridges null",
    s.cleanupReport.every((c) => !c.bridges && !c.bridged) && SBProof.overlays({ cleanupReport: s.cleanupReport, diagnostics: s.diagnostics, mode: "bonded-relief" }).every((o) => o.bridges === null));
});
```

(`SBProof.overlays` returns one entry per layer, `js/proof.js:134-147`; `bridges` is `null` outside connected mode.)

- [x] **Step 2: Run** — `--only "alpha.3 E5"` → ✗ on the static checks.
- [x] **Step 3: Implement** — In this order, running the suite after each bullet:
  1. Add `run.draftCache = {quality: "draft"}` (reset in `acceptSource`'s install block). Fabrication runs get no cache (E-R7).
  2. Rewrite `regenerate`: keep `syncControls()` first and the `SBSchema.canGenerate` guard right after it; return when `!run.src` or `run.src.sampleHash !== project.source.sampleHash` (E1); `setRunState({type: "start"})`; paint the veil ("Updating draft…") over the still-visible previous result and wait `requestAnimationFrame(() => setTimeout(…, 0))`; drop the run if `gen`/`rev` changed meanwhile; `const t0 = performance.now(); const res = SBEngine.generate(SBEngine.request(project, run.src, {quality: "draft", deviceClass: deviceClass()}), {cache: run.draftCache});` map `done` → `setRunState({type: "done", quality: "draft", diagnostics: res.snapshot.diagnostics})`, `error` → `setRunState({type: "fail"})` with `run.draft.diagnostics = res.diagnostics`, `canceled` → leave the previous result. Draft acks are kept only when the new `geometryHash` equals the old one (same rule as `fabReview`, `js/app.js:837`).
  3. `showResult(run.shown)`; delete `buildView`, `showRaster`, `rasterCard`, the deferral comment block and the `run.sheets/procW/procH/view/applied/viewToken/diagnostics/geometryHash/overlays` fields; replace the length checks with `!!(run.shown && run.shown.snapshot)`.
  4. `renderSheetGrid` iterates `snap.layers` with `SBProof.cards(snap.layers, snap.page)`; per card: contours = ring count, cut = `L.stats.cutMM`, `bridged/culled` from `snap.cleanupReport[k]` (connected only), an "omitted" badge for `card.omitted`; roles: bonded → "base" (k = 0), "layer k+1", "top"; connected keeps "backing/mid/front" and "solid panel — frame + holes only".
  5. Status line: `Draft (approximate; Preview at fabrication resolution for the exact cut) · ${geometry.rasterW} × ${geometry.rasterH} px · ${geometry.mmPerPxMax.toFixed(2)} mm/px · ${n} sheets · ${(ms/1000).toFixed(1)} s` (+ bridged/culled/cut totals in connected); a fabrication result shows `Fabrication · … · ${geometryHash.slice(0, 12)}` instead.
  6. `updateDimbar` uses `snap.stats`.
  7. `renderDiagnostics(r)` takes the shown result; a branch for `r.status === "error"` lists `r.diagnostics` with "No layers: …" in the summary.
  8. Clip dialog/repairs: `viewCurrent = () => !!run.shown && run.shown.revision === project.revision`; `applied = run.shown.snapshot.repairsApplied`.
  9. `bindControls`: geometry range inputs update their number on `input` and commit on `change`; debounce 160 → 300 ms (`js/app.js:83`).
  10. Remove `preview.setSheets`, `setSnapshot`'s `opts.bridges` branch (`js/preview.js:142-157`; connected bridges reach Tilt and the Proof only through `setOverlays` from `cleanupReport[].bridges`) and `maskToCanvas`, with their two preview checks (`:4539-4540`, `:4629-4630`); `grep -n "setSheets\|maskToCanvas\|opts.bridges" js/` must come back empty, so no raster bridge path survives.
  11. Retarget the listed static checks to the new names (`showResult`, `SBEngine.request`, `snapshot.cleanupReport`, `snapshot.repairsApplied`), keeping each check's intent and SRS ID.
  12. `docs/ARCHITECTURE.md` (the legacy-seam table, `:196-208`): add rows marking `SBEngine.legacyRun/legacyView/legacyDiagnostics/legacySnapshotHash/legacyCleanupReport/connectedLayers/connectedFiles` as "test oracle only (DEP-04), not called by the app since alpha.3". `docs/COMPONENTS.md` is the NFR-11 third-party table and is not touched.
  13. `docs/QA_CHECKLIST.md`: add "Bonded preview on a colour 4096 × 3084 PNG shows no amber/dark bridge lines; Layers cards say base/top; a slider drag regenerates once on release".
- [x] **Step 4: Run** — E5 ✓, full suite 0 failed; manual: `python3 -m http.server 8000`, load a colour PNG under Plywood (after E7) or Acrylic, check Proof/Section/Layers/Tilt.
- [x] **Step 5: Commit** — `node build.js`; add `js/app.js js/preview.js test/run_tests.js docs/ARCHITECTURE.md docs/QA_CHECKLIST.md dist/shadowbox-studio.html`; `feat(app,preview): draft preview from SBEngine.generate in the selected mode; legacy draft path removed (alpha.3 E5)` + trailer.

**Result (2026-10-08):** as specified (commits `d91382c`, `70de2b2` on 2026-10-09): `regenerate` runs `SBEngine.generate` on `SBEngine.request(..., {quality: "draft"})` with `run.draftCache`; `showResult(run.shown)` renders every view from the snapshot; `buildView`, `showRaster`, `rasterCard`, `renderAll` and `preview.setSheets`/`maskToCanvas` removed; the app calls no `SBEngine.legacy*`. The review fix passes the layer count to `sheetColors` in `buildAndDeliver`.

---

#### Task E6: "Preview at fabrication resolution"; export delivers only the shown fabrication result

**Files:**
- Modify: `index.html` (review stage: `<button id="btn-fabpreview" class="btn">Preview at fabrication resolution</button>` and a `<p id="fabpreview-note" class="hint">`), `js/app.js` (`fabReview` `:818-842`, `renderFabReview` `:849`, `exportBundle` `:766-797`, `buildAndDeliver` `:901-915`, `setRunState`)
- Test: `test/run_tests.js` — suite `index.html/app.js — alpha.3 E6 fabrication preview (PO-PREVIEW-2, LYR-06, UI-06)`

**Interfaces:**
- Consumes: E5 `showResult`, `run.shown`; E1 `SBEngine.request`.
- Produces: `run.fab` gains `{kind: "fabrication"}` and is shown by `showFab()` = `run.shown = run.fab; showResult(run.fab)`; any geometry edit sets `run.shown = run.draft` (Stale badge) and the next draft run replaces it; `renderFabReview` is `renderDiagnostics(run.fab, {scope: "fabrication"})` (one renderer, "Acknowledge for this fabrication result" wording kept), and its items are navigable when `run.shown === run.fab`. The review header prints `geometryHash.slice(0, 12)`; the same short hash is in `settings.json` and ASSEMBLY.md (E13), so the user can match the files to the screen.
- **Delivery rule (PO-PREVIEW-2):** files are built only when, at the click, `run.shown === run.fab && fabCurrent()` and the gate allows. Otherwise `exportBundle` runs `fabReview()` (generating if needed), calls `showFab()`, opens the Fabrication review with "Review the fabrication result, then Download" and **stops**; the user's next Download click delivers what is on screen. After delivery the fabrication result stays shown (no restore to the draft). So the downloaded geometry, its guides and its diagnostics are always the ones the user saw, including when the draft's guide omissions differ from the fabrication run's (E11).
- **preview.png:** `buildAndDeliver` captures `preview.snapshot("proof")` from `run.fab` with the Changes overlay off and the diagnostic focus cleared (`preview.setOverlays(null)`, `preview.setFocus(null)`), then restores both; the capture never contains UI state (amber bridges, `BOND_UNSUPPORTED` regions, a focus ring).

Busy state before the blocking run: the button is disabled with the text `Generating ${W} × ${H} px at ${pitch} mm/px (about ${est} s; the page will not respond until it finishes)…`, the badge shows Processing, `#status` (aria-live) gets the same text, then the two-hop paint wait. `est` = `W·H/1e6 × SBSchema.limits(dc).fabMsPerMpx / 1000` (E4 puts the measured value into the schema; the offline app cannot read `docs/` at runtime).

- [x] **Step 1: Write the failing tests**

```js
suite("index.html/app.js — alpha.3 E6 fabrication preview (PO-PREVIEW-2, LYR-06, UI-06)", () => {
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  check("PO-PREVIEW-2 index.html has #btn-fabpreview", /id="btn-fabpreview"/.test(html));
  check("PO-PREVIEW-2 the button runs fabReview and shows run.fab in every view", /btn-fabpreview/.test(appSrc) && /run\.shown = run\.fab/.test(appSrc));
  check("NFR-02 (deviation) the busy text is painted before the blocking fabrication run", /will not respond/.test(appSrc) && /requestAnimationFrame\(/.test(fn("fabReview")));
  check("LYR-06 exportBundle does not regenerate while fabCurrent()", /fabCurrent\(\)/.test(fn("fabReview")) && fn("exportBundle").indexOf("SBEngine.generate(") < 0);
  check("UI-06 fab preview of revision r is not shown for r+1 (fabCurrent checks the revision; an edit shows the draft)",
    /run\.fab\.revision === project\.revision/.test(fn("fabCurrent")) && /run\.shown = run\.draft/.test(appSrc));
  const bd = fn("buildAndDeliver"), ex = fn("exportBundle");
  check("PO-PREVIEW-2 delivery requires the shown, current fabrication result; otherwise export shows it and stops",
    /run\.shown === run\.fab/.test(ex) && /fabCurrent\(\)/.test(ex) && /showFab\(\)/.test(ex) && ex.indexOf("showFab()") < ex.indexOf("buildAndDeliver("));
  check("PO-PREVIEW-7 buildAndDeliver builds files, settings and preview.png from run.fab.snapshot and never restores the draft",
    /SBEngine\.fabricationFiles\(run\.fab\.snapshot/.test(bd) && /run\.fab\.snapshot/.test(fn("settingsJSON")) && !/run\.shown = (back|run\.draft)/.test(bd) && !/showResult\(back\)/.test(bd));
  check("PO-PREVIEW-7 preview.png is captured with overlays off and focus cleared",
    /setOverlays\(null\)/.test(bd) && /setFocus\(null\)/.test(bd) && bd.indexOf("setOverlays(null)") < bd.indexOf("preview.snapshot("));
  check("LYR-06 fabReview passes no stage cache (E-R7) and checks the sample hash", !/cache:/.test(fn("fabReview")) && /sampleHash/.test(fn("fabReview")));
  const E = SBEngine, F = require("./fixtures.js"), px = { pixels: F.heightMap(9, 160, 120), channels: 1, w: 160, h: 120, alpha: null };
  const p = SBSchema.withSource(SBSchema.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); p.geometry.targetMM = 12;
  check("LYR-06 two fabrication requests on unchanged inputs give the same geometryHash (the previewed snapshot is the exported one)",
    E.generate(E.request(p, px, { quality: "fabrication" })).geometryHash === E.generate(E.request(p, px, { quality: "fabrication" })).geometryHash);
});
```

- [x] **Step 2: Run** — ✗.
- [x] **Step 3: Implement** — add the button and `showFab()`; `fabReview` shows the busy text and passes no cache; `exportBundle`: `const ready = run.shown === run.fab && fabCurrent(); if (!(await fabReview())) return; if (!ready) { showFab(); openFabReview("Review the fabrication result, then Download"); return; }` then the gate and `buildAndDeliver()`; `buildAndDeliver`: `const ov = preview.overlays(), fo = run.focus; preview.setOverlays(null); preview.setFocus(null); const snap = await preview.snapshot("proof"); preview.setOverlays(ov); if (fo) preview.setFocus(fo);` (use the preview's real getters; add them if missing), with the cut files and `settingsJSON()` read from `run.fab.snapshot`. Retarget the alpha.2 export-flow checks that assume a single click delivers after a regenerate. Retarget the G2.13c check that says fabrication items are not navigable, and the comment at `js/app.js:845-848`.
- [x] **Step 4: Run** — E6 ✓, full suite 0 failed; manual: click the button on the user's 4096 × 3084 source and check Proof/Section/Layers/Tilt and the panel switch to fabrication, then an edit returns to a Stale draft; with a stale draft on screen click Download and check that the fabrication result appears and nothing downloads until the second click; turn the Changes overlay on and check preview.png has no overlay.
- [x] **Step 5: Commit** — `node build.js`; add `index.html js/app.js test/run_tests.js dist/shadowbox-studio.html`; `feat(app): preview at fabrication resolution; export delivers only the shown fabrication result (alpha.3 E6)` + trailer.

**Result (2026-10-09):** as specified (commit `b5c00b9`): `#btn-fabpreview`, `showFab`/`showDraft`, busy note from `rasterPlan` and `fabMsPerMpx`, two-click delivery (`run.shown === run.fab && fabCurrent()`), `preview.png` from `run.fab` without overlay or focus, one diagnostics renderer with the short hash in the review header.

---

#### Task E7: Preset selector, Plywood default, colour sources switch to Tonal

**Files:**
- Modify: `js/schema.js` (`S.presetDiff`, `S.applyPreset`, `S.colourSourceSwitch`, `modeChangeDiff` `:1039-1050`, plywood preset `construction.guides.mode` `:372` `interior-mark` → `inset-outline` per Q4), `js/diag.js` (register `SOURCE_COLOR_TONAL`, info, P), `index.html` (`<select id="in-preset">` above `#in-interp`), `js/app.js:38` (default), `loadFile` (`:1232-1258`), `reviewModeChange` (`:1117`)
- Test: `test/run_tests.js` — suite `schema.js/app.js — alpha.3 E7 presets and colour sources (PRJ-01, IMG-01, PO-PREVIEW-3)`

**Interfaces:**
- Produces:
  - `SBSchema.presetDiff(project, name) → [{path, from, to, reason}]` and `SBSchema.applyPreset(project, name, accepted) → project` — keeps `title`, `source`, `units`, `machine`, `extras`; everything else from `defaults(name)`; `revision + 1` iff `geometryKey` changes. Shown through the existing `#dlg-mode` review.
  - `SBSchema.colourSourceSwitch(project) → {patch, project}`: `applyModeChange(project, {interpretation: {mode: "tonal"}}, true)` then `smoothing = {radiusMM: 1.65, passes: 2}` (the acrylic tonal default after E3b, the plan's only tonal default) and an `extras.history` entry `{op: "auto-tonal", reason: "colour source", revision}`. Polarity follows the existing map (`white-high → light-front`, `js/schema.js:347`).
  - `modeChangeDiff` to bonded also adds `construction.guides.mode: "none" → "inset-outline"` (E10 default, Q4) when it is `"none"`.
  - New diagnostic `SOURCE_COLOR_TONAL` (info): "Colour image: using Tonal (light/dark → layers). Height mode needs a grayscale height map."
- App intake rule (in `loadFile`, project in height mode only):
  1. preflight refuses with `HEIGHT_NEEDS_PNG` (JPEG) or `PNG_PALETTE` (colour palette) → apply `colourSourceSwitch`, re-run `SBSchema.intake` (now tonal → browser decode), continue.
  2. raw decode throws `PNG_UNEQUAL_RGB` → same switch, decode on the tonal route.
  3. RGB-equal truecolour or gray PNG → stays on the raw height route (IMG-01; Review Focus 1).
  4. Notice in `#why-source`: the `SOURCE_COLOR_TONAL` text and a pointer to the Interpretation control. No "Use as height map instead" button: the switch only happens for sources height mode refuses (JPEG, colour palette PNG, unequal-RGB PNG), so the button could never succeed (review 2026-10-08).
  5. A user who explicitly picks Height on a loaded colour source keeps today's refusal text.

- [x] **Step 1: Write the failing tests**

```js
suite("schema.js/app.js — alpha.3 E7 presets and colour sources (PRJ-01, IMG-01, PO-PREVIEW-3)", () => {
  const S = SBSchema, F = require("./fixtures.js");
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("PRJ-01 app default preset is plywood", /let project = SBSchema\.defaults\("plywood"\)/.test(appSrc));
  check("PO-PREVIEW-3 #in-preset offers Plywood (bonded) and Acrylic (connected)", /id="in-preset"/.test(html) && /value="plywood"[^>]*>Plywood/.test(html) && /value="acrylic"/.test(html));
  const ply = S.defaults("plywood"); ply.title = "keep"; ply.source = S.sourceTemplate();
  const acr = S.applyPreset(ply, "acrylic", true);
  check("PRJ-02 applyPreset keeps title and source, takes the rest from the preset, bumps the revision",
    acr.title === "keep" && JSON.stringify(acr.source) === JSON.stringify(ply.source) && acr.construction.mode === "connected-sheet" && acr.revision === ply.revision + 1 &&
    S.presetDiff(ply, "acrylic").some((d) => d.path === "construction.mode"));
  const sw = S.colourSourceSwitch(ply).project;
  check("IMG-01/PO-PREVIEW-3 colour source under plywood → tonal, light-front, smoothing r4 p2, bonded kept, history recorded",
    sw.interpretation.mode === "tonal" && sw.interpretation.polarity === "light-front" && sw.interpretation.smoothing.radiusMM === 1.65 &&
    sw.construction.mode === "bonded-relief" && sw.extras.history.some((h) => h.op === "auto-tonal") && S.validate(sw).ok);
  const jpg = F.jpegHeader({ w: 64, h: 48 });
  const pre = S.intake(jpg, { project: ply, deviceClass: "desktop" });
  check("IMG-01 plywood + JPEG: preflight still names HEIGHT_NEEDS_PNG (the app switches on it); tonal accepts it",
    pre.code === "HEIGHT_NEEDS_PNG" && S.intake(jpg, { project: sw, deviceClass: "desktop" }).code !== "HEIGHT_NEEDS_PNG");
  const eq = new Uint8Array(32 * 32 * 3); for (let i = 0; i < eq.length; i++) eq[i] = (i / 3) & 255;
  const pngEq = F.pngEncode({ w: 32, h: 32, colorType: 2, bitDepth: 8, data: eq });
  checkAsync("IMG-01 RGB-equal truecolour PNG under plywood stays height (raw decode succeeds)", SBPng.decode(new Uint8Array(pngEq), { mode: "height" }).then((d) => d.channels === 1));
  check("SOURCE_COLOR_TONAL is a registered info code", SBDiag.CODES.SOURCE_COLOR_TONAL && SBDiag.CODES.SOURCE_COLOR_TONAL.severity === "info");
  check("PO-PREVIEW-3 loadFile switches to tonal on HEIGHT_NEEDS_PNG, PNG_PALETTE and PNG_UNEQUAL_RGB",
    /HEIGHT_NEEDS_PNG/.test(appSrc) && /PNG_PALETTE/.test(appSrc) && /PNG_UNEQUAL_RGB/.test(appSrc) && /SBSchema\.colourSourceSwitch\(/.test(appSrc));
  const b = S.applyModeChange(S.defaults("acrylic"), { construction: { mode: "bonded-relief" } }, true);
  check("ASM-01 a switch to bonded sets guides.mode from none to inset-outline", b.construction.guides.mode === "inset-outline");
  check("ASM-01/Q4 the plywood preset uses inset-outline guides", S.defaults("plywood").construction.guides.mode === "inset-outline");
  check("PO-PREVIEW-3 no 'Use as height map instead' button (it could never succeed)", !/Use as height map instead/.test(appSrc) && !/Use as height map instead/.test(html));
});
```

(Check `F.jpegHeader` / `F.pngEncode` export names in `test/fixtures.js` before running.)

- [x] **Step 2: Run** — ✗.
- [x] **Step 3: Implement** — schema helpers, the plywood preset guide mode (`js/schema.js:372`; retarget any check that pins `interior-mark` on the plywood defaults), diag code, `modeChangeDiff` line `if (c.guides.mode === "none") add("construction.guides.mode", "none", "inset-outline", "Bonded layers are aligned by concealed scored guides (ASM-01).");`, `index.html` select, `app.js` default + `#in-preset` change → `#dlg-mode` with `presetDiff`, and the intake rule. `docs/USER_GUIDE.md`: a "Presets and colour images" paragraph.
- [x] **Step 4: Run** — E7 ✓, full suite 0 failed (retarget any G2.11e check that pins the bonded diff list length).
- [x] **Step 5: Commit** — `node build.js`; add `js/schema.js js/diag.js js/app.js index.html test/run_tests.js docs/USER_GUIDE.md dist/shadowbox-studio.html`; `feat(schema,app): preset selector, plywood default, colour sources switch to tonal with a notice (alpha.3 E7)` + trailer.

**Result (2026-10-09):** as specified (commit `f6d7523`): `presetDiff`/`applyPreset`, `colourSourceSwitch` (light-front, 1.65 mm, p2), `SOURCE_COLOR_TONAL`, plywood `inset-outline` (Q4), Plywood start; only `HEIGHT_NEEDS_PNG`, `PNG_PALETTE` and `PNG_UNEQUAL_RGB` switch to Tonal.

---

#### Task E8: Source-resolution diagnostics at load and in the draft panel

**Files:**
- Modify: `js/docs.js` (`D.sourceNotes`), `js/app.js` (`loadFile` `:1256-1257`, `refuseSource` `:1280`, `renderDiagnostics`, the state badge), `js/proof.js` (`P.panelModel`, `P.predictFabComplexity`), `js/diag.js` (register `FAB_COMPLEXITY_LIKELY`, warning)
- Test: suite `docs.js/proof.js/app.js — alpha.3 E8 source diagnostics up front (PO-PREVIEW-4, GEO-06, NFR-04)`

**Interfaces:**
- Produces: `SBDocs.sourceNotes(warnings: Diagnostic[]) → string[]` (one line per warning: `SBDiag.describe` title + detail, the px shortfall for `FAB_EXCEEDS_SOURCE`); `SBProof.panelModel(shown, fabPlanDiagnostics, prediction?) → {groups: [{title, items, ackable}]}` with a "Fabrication resolution" group (`ackable: false`, note "Acknowledged in the Fabrication review") prepended for draft results only. The plan diagnostics are `SBEngine.rasterPlan(project, {w, h}, "fabrication", dc).diagnostics`, computed in the app (shared with `updateDimbar`, `js/app.js:1179-1182`); they never enter `snapshot.diagnostics`, the draft hash or the draft acks.
- **Predicted fabrication complexity (review 2026-10-08):** the complexity caps are absolute counts (`js/schema.js:148-153`) enforced per run (`js/engine.js:582-603`), and traced vertices grow roughly linearly with the raster's long side, so a draft well under the cap can fail at export with `COMPLEXITY_LIMIT` and no layers. `SBProof.predictFabComplexity(draftSnapshot, fabGeometry, limits) → {scale, verticesPerLayerMax, verticesTotal, partsPerLayerMax, over: string[]}` with `scale = max(fabRasterW, fabRasterH) / max(draftRasterW, draftRasterH)`, predicted vertices = draft `stats.vertices` × `scale` (per layer and total), predicted parts = draft parts (a lower bound; finer rasters only add parts); `over` names each cap the prediction exceeds. Each exceeded cap adds a `FAB_COMPLEXITY_LIKELY` warning item to the non-ackable "Fabrication resolution" group ("likely exceeds the fabrication cap: about N vertices on layer k vs C; simplify, use fewer sheets or a smaller artwork"). The state badge never shows Ready while `over` is non-empty.

- [x] **Step 1: Write the failing tests**

```js
suite("docs.js/proof.js/app.js — alpha.3 E8 source diagnostics up front (PO-PREVIEW-4, GEO-06, NFR-04)", () => {
  const p = SBSchema.defaults("plywood"); p.geometry.targetMM = 470; p.source = SBSchema.sourceTemplate();
  const plan = SBEngine.rasterPlan(p, { w: 4096, h: 3084 }, "fabrication", "desktop");
  const notes = SBDocs.sourceNotes(plan.diagnostics);
  check("PO-LASER-5 4096×3084 at 470 mm shows FAB_EXCEEDS_SOURCE at load with the px shortfall",
    plan.diagnostics.some((d) => d.code === "FAB_EXCEEDS_SOURCE") && notes.some((l) => /px/.test(l) && /source/i.test(l)));
  const shown = { quality: "draft", snapshot: { quality: "draft", diagnostics: [] }, diagnostics: [] };
  const m = SBProof.panelModel(shown, plan.diagnostics);
  check("NFR-04 draft panel model has a non-ackable Fabrication resolution group", m.groups[0].title === "Fabrication resolution" && m.groups[0].ackable === false && m.groups[0].items.length === plan.diagnostics.length);
  check("LYR-06 a fabrication result's panel has no separate plan group (the fab run raises them itself)",
    !SBProof.panelModel({ quality: "fabrication", snapshot: { quality: "fabrication", diagnostics: [] }, diagnostics: [] }, plan.diagnostics).groups.some((g) => g.title === "Fabrication resolution"));
  const lim = SBSchema.limits("desktop"), lay = (v, n) => ({ stats: { vertices: v }, parts: new Array(n) });
  const near = { geometry: { rasterW: 1024, rasterH: 771 }, layers: [lay(40000, 10), lay(30000, 10)] };
  const pr = SBProof.predictFabComplexity(near, { rasterW: 4096, rasterH: 3084 }, lim);
  check("§12.3 a draft at 40k vertices/layer at 1024 px predicts ≈160k at 4096 px and flags the per-layer cap",
    pr.scale === 4 && pr.verticesPerLayerMax === 160000 && pr.over.includes("maxVerticesPerLayer"));
  check("§12.3 a draft well under the caps predicts no overflow", SBProof.predictFabComplexity({ geometry: near.geometry, layers: [lay(5000, 10)] }, { rasterW: 4096, rasterH: 3084 }, lim).over.length === 0);
  const mp = SBProof.panelModel(shown, plan.diagnostics, pr);
  check("NFR-04 the predicted overflow is a non-ackable FAB_COMPLEXITY_LIKELY item in the Fabrication resolution group",
    SBDiag.CODES.FAB_COMPLEXITY_LIKELY && SBDiag.CODES.FAB_COMPLEXITY_LIKELY.severity === "warning" && mp.groups[0].ackable === false && mp.groups[0].items.some((d) => d.code === "FAB_COMPLEXITY_LIKELY"));
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  check("UI-05 the badge is never Ready while the fabrication complexity prediction is over a cap", /predictFabComplexity\(/.test(appSrc) && /\.over\.length/.test(appSrc));
  check("PO-PREVIEW-4 loadFile shows every preflight warning (SBDocs.sourceNotes), not only EXIF_AMBIGUOUS",
    /SBDocs\.sourceNotes\(pre\.warnings\)/.test(appSrc) && !/filter\(\(d\) => d\.code === "EXIF_AMBIGUOUS"\)/.test(appSrc));
});
```

- [x] **Step 2: Run** — ✗.  - [x] **Step 3: Implement** as specified.  - [x] **Step 4: Run** — 0 failed.
- [x] **Step 5: Commit** — `node build.js`; add `js/docs.js js/proof.js js/diag.js js/app.js test/run_tests.js dist/shadowbox-studio.html`; `feat(docs,proof,app): source-resolution diagnostics and predicted fabrication complexity at load and in the draft panel (alpha.3 E8)` + trailer.

**Result (2026-10-09):** as specified (commit `4f2a4a5`): `SBDocs.sourceNotes` at load; `SBProof.panelModel` non-ackable "Fabrication resolution" group; `predictFabComplexity` (vertices scaled by the long-side ratio, parts as a lower bound); the Draft badge says "over cap".

---

#### Task E9: Stroke digits, box placement and polyline buffers (G3.2 subset)

**Files:**
- Create: `js/strokefont.js`
- Modify: `js/geom.js` (define `G.placeBox`, `G.interiorPoint` and `G.bufferPolylines` on `G` next to `G.offset`, `:852-861`; the core name list at `:1100-1102` only re-exports `C` functions and is not touched), `index.html`, `sw.js` SHELL, `test/modules.js` (insert `strokefont.js` directly after `support.js`: `… support.js, strokefont.js, svgout.js, svgread.js, proof.js …`)
- Test: suite `strokefont.js/geom.js — alpha.3 E9 stroke digits, box placement and buffers (ASM-03, EXP-03, AT-14)`

**Interfaces:**
- Produces: `SBFont.strokes(text: string, heightUm: integer) → {paths: number[][], wUm, hUm}` — open polylines (flat `[x0, y0, …]`, integer µm, origin top-left, Y down); alpha.3 charset `0123456789`; any other character throws `FONT_CHAR`. `SBGeom.placeBox(polys: Polygon[], hxUm: integer, hyUm: integer) → [x, y] | null` — the centre of an axis-aligned box of half-extents `hx × hy` that lies inside `polys`, found by offsets, not a grid: `Er = normalize(intersection of the four integer translates of polys by (∓hx, ∓hy))` (a superset of the exact box erosion); candidates = the vertices of `Er` sorted by y, then x, at most 64; the first candidate whose box satisfies `isEmpty(difference(box, polys))` is returned; `null` when `Er` is empty or no candidate passes. Cost: 4 translates, 3 intersections and at most 64 four-vertex differences, independent of the vertex count beyond the booleans themselves. `SBGeom.interiorPoint(polys, clearanceUm) = placeBox(polys, c, c)` (a square of half-side c contains the disk of radius c, so the Euclidean clearance is at least c). `SBGeom.bufferPolylines(paths: number[][], halfUm: integer) → Polygon[]` — Clipper2 `inflatePaths(…, halfUm, JoinType.Miter, …, 2.0)` with `EndType.Square` for open paths and `EndType.Joined` for paths whose last vertex equals the first (the closed guide rings, so no square cap pokes past an acute corner), unioned (`SBGeom.offset` only offsets closed polygons, `EndType.Polygon`, `js/geom.js:860`), normalized; integer `halfUm` only. (Review 2026-10-08: the earlier 64 × 64 grid search cost about 4.2k × edges point-segment tests per call, ≈5×10⁸ at the desktop vertex cap, and missed strips narrower than a grid cell on large pages.)

Glyphs on a 4 × 6 unit grid, advance 6 units, `u = heightUm / 6` and every coordinate `Math.round(v * heightUm / 6)`:

```js
  const GLYPHS = {
    "0": [[0,0, 4,0, 4,6, 0,6, 0,0]],
    "1": [[1,1, 2,0, 2,6]],
    "2": [[0,0, 4,0, 4,3, 0,3, 0,6, 4,6]],
    "3": [[0,0, 4,0, 4,6, 0,6], [0,3, 4,3]],
    "4": [[0,0, 0,3, 4,3], [4,0, 4,6]],
    "5": [[4,0, 0,0, 0,3, 4,3, 4,6, 0,6]],
    "6": [[4,0, 0,0, 0,6, 4,6, 4,3, 0,3]],
    "7": [[0,0, 4,0, 4,6]],
    "8": [[0,0, 4,0, 4,6, 0,6, 0,0], [0,3, 4,3]],
    "9": [[4,3, 0,3, 0,0, 4,0, 4,6, 0,6]],
  };
```

- [x] **Step 1: Write the failing tests**

```js
suite("strokefont.js/geom.js — alpha.3 E9 stroke digits and interior point (ASM-03, EXP-03)", () => {
  check("E9 API present", typeof globalThis.SBFont === "object" && typeof SBGeom.interiorPoint === "function");
  if (typeof globalThis.SBFont !== "object") return;
  const s = SBFont.strokes("12", 3000);
  check("EXP-03 digits are open integer polylines inside their box (no text)", s.hUm === 3000 && s.wUm === Math.round(10 * 3000 / 6) &&
    s.paths.every((p) => p.length >= 4 && p.every(Number.isInteger) && p.every((v, i) => i % 2 ? v >= 0 && v <= 3000 : v >= 0 && v <= s.wUm)));
  check("FONT_CHAR for a character outside the alpha.3 charset", (() => { try { SBFont.strokes("A", 3000); return false; } catch (e) { return /FONT_CHAR/.test(e.message); } })());
  const sq = (x, y, s2) => [x, y, x + s2, y, x + s2, y + s2, x, y + s2];
  const donut = [{ outer: sq(0, 0, 10000), holes: [[2000, 2000, 2000, 8000, 8000, 8000, 8000, 2000]] }];   // hole: negative shoelace area
  const pt = SBGeom.interiorPoint(donut, 800);
  check("ASM-03 donut point is in the ring, not in the hole, with clearance", pt && !(pt[0] > 2000 && pt[0] < 8000 && pt[1] > 2000 && pt[1] < 8000));
  const crescent = SBGeom.normalize(SBGeom.difference([{ outer: sq(0, 0, 10000), holes: [] }], [{ outer: sq(3000, -1000, 9000), holes: [] }]));
  const pc = SBGeom.interiorPoint(crescent, 1000);
  check("ASM-03 crescent interior point is inside with clearance, not the bbox centre", pc && pc[0] < 3000 - 1000 + 1 && SBGeom.interiorPoint(crescent, 1000).join() === pc.join());
  check("ASM-03 too-thin region gives null", SBGeom.interiorPoint([{ outer: sq(0, 0, 1000), holes: [] }], 600) === null);
  const strip = [{ outer: [0, 0, 3200, 0, 3200, 17800, 0, 17800], holes: [] }];
  const bx = SBGeom.placeBox(strip, 1100, 1600);
  check("ASM-03 placeBox fits a 2.2 × 3.2 mm box in a 3.2 mm strip (an axis-aligned box, not the circumscribed circle)",
    bx && bx[0] - 1100 >= 0 && bx[0] + 1100 <= 3200 && bx[1] - 1600 >= 0 && bx[1] + 1600 <= 17800 && SBGeom.placeBox(strip, 1700, 1700) === null);
  const buf = SBGeom.bufferPolylines([[0, 0, 10000, 0]], 100);
  check("AT-14 bufferPolylines makes a square-capped band around an open path", Math.abs(SBGeom.area(buf) - 10200 * 200) <= 4 &&
    SBGeom.isEmpty(SBGeom.difference(buf, [{ outer: [-100, -100, 10100, -100, 10100, 100, -100, 100], holes: [] }])));
  const order = require("./modules.js").NODE_MODULES;
  check("T0.2 strokefont.js sits directly after support.js", order.indexOf("strokefont.js") === order.indexOf("support.js") + 1);
});
```

- [x] **Step 2: Run** — ✗.  - [x] **Step 3: Implement** the module (IIFE, `global.SBFont = Object.freeze({strokes, CHARSET: "0123456789"})`), `placeBox`, `interiorPoint` and `bufferPolylines`; register `strokefont.js` in the four lists directly after `support.js`.  - [x] **Step 4: Run** — 0 failed (the build hygiene suite checks the lists).
- [x] **Step 5: Commit** — `node build.js`; add `js/strokefont.js js/geom.js index.html sw.js test/modules.js test/run_tests.js dist/shadowbox-studio.html`; `feat(strokefont,geom): stroke digits, deterministic box placement and polyline buffers (alpha.3 E9, G3.2 subset)` + trailer.

**Result (2026-10-09):** as specified (commit `f552272`): digits on a 4 × 6 grid (`FONT_CHAR` otherwise), `placeBox` by four corner translates and ≤ 64 candidates, `interiorPoint`, `bufferPolylines`; `strokefont.js` registered after `support.js`.

---

#### Task E10: `SBGuides.build` and `validate` (G3.3 subset)

**Files:**
- Create: `js/guides.js`
- Modify: `js/diag.js:205` (`GUIDE_OMITTED` into `AGGREGATED`), `index.html`, `sw.js`, `test/modules.js` (after `strokefont.js`)
- Test: suite `guides.js — alpha.3 E10 concealed guides and sheet labels (ASM-01/02/03, AT-14, GEO-07)`

**Interfaces:**
- Consumes: `SBGeom.offset(polys, deltaUm, "miter")`, `intersection`, `difference`, `normalize`, `isEmpty`, `survivesInset`, `placeBox`, `bufferPolylines` (E9); `SBFont.strokes`; `SBDiag.make`.
- Produces: `SBGuides.build(layers: MaterialLayer[], cfg: construction.guides, ctx: {revision, quality}) → {scorePaths: number[][][] (per layer index), guides: {mode, labels: [{layer, text, atUm: [x, y], heightUm}], omitted: [{layer, part, reason}], map: null}, diagnostics: Diagnostic[]}`; `SBGuides.validate(layers, built, cfg, ctx) → Diagnostic[]` (`GUIDE_UNCONTAINED` only).

Rules (all distances integer µm: `c = round(concealInsetMM·1000)`, `a = round(allowanceMM·1000)`, `fp = round(markFootprintMM·1000)`, `fh = floor(fp/2)`, `lh = round(labelHeightMM·1000)`):
- For k = 0 … N−2 with upper = layer k+1 non-empty: `Rc_k = intersection(offset(upper.material, −(c + a + fh), "miter"), offset(lower.material, −fh, "miter"))` (normalized); `Rb_k = intersection(offset(upper.material, −(c + a), "miter"), lower.material)`. Layer-level, never per part (Appendix C, S1 cost note).
- **Attribution:** each polygon of `Rc_k` lies inside exactly one part of k+1; attribute it by the part whose bbox contains its first outer vertex and whose polygon contains that point (even-odd). A part of k+1 with no attributed Rc polygon → `omitted.push({layer: k+1, part: id, reason: "no concealed area ≥ footprint"})` and one `GUIDE_OMITTED` diagnostic per such part with `layer: k+1, parts: [id], detail: {kind: "part", reason}` (aggregated per layer by `SBDiag.aggregate`, whose key is `code|layer|detail.kind`, `js/diag.js:279-280`).
- **`inset-outline`:** score paths on layer k = every ring of `Rc_k`, closed by repeating its first vertex.
- **`interior-mark`:** per attributed Rc polygon, try arms `r` = 1500, 1000, 600, 300 µm in that order and take the first `q = placeBox([poly], r, r)` that is non-null (the cross's centreline then lies inside `Rc`, so its burn lies inside `offset(Rc, fh)`); a cross `[qx−r, qy, qx+r, qy]`, `[qx, qy−r, qx, qy+r]`; no fit → omitted as above.
- **Sheet label** (every k ≤ N−2 with a non-empty `Rc_k`): text `String(k + 1)` (= the sheet file number), `SBFont.strokes(text, lh)`; label region = `Rc_k` shrunk so strokes clear the guide burns: `region = offset(Rc_k, −(fp + fh), "miter")`, minus, in interior-mark mode, the square of half-side `r + fp` around each cross; centre = `placeBox(region, ceil(wUm/2) + fh, ceil(hUm/2) + fh)` (the label's own axis-aligned box plus its burn, not the circumscribed circle); strokes translated so the box centre is at the point. No fit → `GUIDE_OMITTED` with `parts: []`, `detail: {kind: "label", sheet: k + 1, text: "sheet " + (k+1) + " label did not fit; see the placement map"}` (an object with its own `kind`, so aggregation never merges it into the part count and its guidance text survives). The top sheet (N−1) has no concealed area and gets no label (Q5).
- `allowanceMM === 0` → one `ALIGN_CLEARANCE_ZERO` warning.
- `cfg.mode === "none"` or construction ≠ bonded → `build` is not called (E11).
- **validate (GEO-07, bug guard; the G3.3 AT-14 segment-level rule):** validate checks the **emitted** strokes, never the regions they were built from: per layer k, `D = difference(bufferPolylines(built.scorePaths[k], fh), Rb_k)` over every score path on layer k (guide rings, crosses and label strokes alike), with `Rb_k` recomputed from the layers (not taken from `build`); uncontained iff `SBGeom.survivesInset(D, 1)` (width ≥ 2 µm, so µm rounding slivers never block). A score path on a layer with no `Rb_k` (the top sheet) is uncontained. This is independent of the placement routine, so it is not circular. Any failure → `GUIDE_UNCONTAINED` (blocking).

- [x] **Step 1: Write the failing tests**

```js
suite("guides.js — alpha.3 E10 concealed guides and sheet labels (ASM-01/02/03, AT-14, GEO-07)", () => {
  check("E10 API present", typeof globalThis.SBGuides === "object");
  if (typeof globalThis.SBGuides !== "object") return;
  const sq = (x, y, w, h) => [{ outer: [x, y, x + w, y, x + w, y + h, x, y + h], holes: [] }];
  const page = { wMM: 60, hMM: 40, frameMM: 0 };
  const mk = (index, material) => SBMaterial.assignParts([SBMaterial.withMaterial({ index, material: [], parts: [], diagnostics: [], scorePaths: [] }, SBGeom.normalize(material), { revision: 0, quality: "draft" })])[0];
  // base, a 20×20 mm block, a crescent, a 1.5 mm sliver
  const L0 = mk(0, sq(0, 0, 60000, 40000));
  const L1 = mk(1, sq(5000, 5000, 20000, 20000).concat(sq(40000, 5000, 1500, 20000)));
  const cres = SBGeom.normalize(SBGeom.difference(sq(5000, 5000, 20000, 20000), sq(11000, 4000, 20000, 22000)));
  const L2 = mk(2, cres);
  const cfg = SBSchema.defaults("plywood").construction.guides;
  const b = SBGuides.build([L0, L1, L2], Object.assign({}, cfg, { mode: "inset-outline" }), { revision: 0, quality: "draft" });
  check("ASM-01 inset-outline scores guides of layer k+1 on layer k (sheet 1 and 2), none on the top sheet",
    b.scorePaths[0].length > 0 && b.scorePaths[1].length > 0 && b.scorePaths[2].length === 0);
  check("AT-14 the 1.5 mm sliver and nothing else on layer 1 is omitted with GUIDE_OMITTED (warning)",
    b.guides.omitted.filter((o) => o.layer === 1).length === 1 && b.diagnostics.some((d) => d.code === "GUIDE_OMITTED" && d.layer === 1));
  // L2 is a 6 mm strip: Rc_1 is 6.0 − 2·1.1 = 3.8 mm wide, the label region 3.8 − 2·0.3 = 3.2 mm; the box for "2" at 3 mm
  // needs 2·(1000 + 100) = 2.2 mm, so it fits (the circumscribed circle would need 3.806 mm and would not)
  check("AT-13 sheet labels are vector strokes with the sheet number, placed on sheets 1 and 2 only",
    b.guides.labels.map((l) => l.text).join() === "1,2" && b.scorePaths[0].length === 1 + SBFont.strokes("1", 3000).paths.length &&
    b.scorePaths[1].length === 1 + SBFont.strokes("2", 3000).paths.length);
  check("ASM-02/GEO-07 validate finds every score inside Rb (no GUIDE_UNCONTAINED)", SBGuides.validate([L0, L1, L2], b, cfg, { revision: 0, quality: "draft" }).length === 0);
  const tamper = JSON.parse(JSON.stringify(b)); tamper.scorePaths[0].push([0, 0, 60000, 0]);
  check("GEO-07 validate catches a score on visible material (GUIDE_UNCONTAINED, blocking)",
    SBGuides.validate([L0, L1, L2], tamper, cfg, { revision: 0, quality: "draft" }).some((d) => d.code === "GUIDE_UNCONTAINED"));
  const im = SBGuides.build([L0, L1, L2], Object.assign({}, cfg, { mode: "interior-mark" }), { revision: 0, quality: "draft" });
  check("ASM-03 interior-mark crosses sit on a checked interior point (crescent included), deterministic",
    im.scorePaths[1].length >= 2 && JSON.stringify(im) === JSON.stringify(SBGuides.build([L0, L1, L2], Object.assign({}, cfg, { mode: "interior-mark" }), { revision: 0, quality: "draft" })));
  const z = SBGuides.build([L0, L1], Object.assign({}, cfg, { allowanceMM: 0 }), { revision: 0, quality: "draft" });
  check("ASM-02 allowance 0 raises ALIGN_CLEARANCE_ZERO", z.diagnostics.some((d) => d.code === "ALIGN_CLEARANCE_ZERO"));
  check("UI-04 GUIDE_OMITTED aggregates per layer", SBDiag.aggregate([0, 1, 2].map((i) => SBDiag.make("GUIDE_OMITTED", { revision: 0, quality: "draft", layer: 1, parts: ["L01-P00" + i], detail: { kind: "part", reason: "x" } }))).length === 1);
  check("UI-04 a sheet-label omission is not merged into the part omissions (detail.kind label)",
    SBDiag.aggregate([SBDiag.make("GUIDE_OMITTED", { revision: 0, quality: "draft", layer: 1, parts: ["L01-P001"], detail: { kind: "part", reason: "x" } }),
      SBDiag.make("GUIDE_OMITTED", { revision: 0, quality: "draft", layer: 1, parts: [], detail: { kind: "label", sheet: 2, text: "sheet 2 label did not fit; see the placement map" } })]).length === 2);
  const top = JSON.parse(JSON.stringify(b)); top.scorePaths[2].push([5000, 5000, 6000, 5000]);
  check("GEO-07 a score path on the top sheet (no concealed area) is uncontained", SBGuides.validate([L0, L1, L2], top, cfg, { revision: 0, quality: "draft" }).some((d) => d.code === "GUIDE_UNCONTAINED"));
});
```

(Check `SBDiag.make` accepts an object `detail` and that `describe` renders `detail.text`; extend it in this task if not. Use the real `SBMaterial` constructor the existing material suites use — read `test/run_tests.js:1917-1960` and replace `mk` with it if `withMaterial`'s signature differs.)

- [x] **Step 2: Run** — ✗.  - [x] **Step 3: Implement** `js/guides.js` per the rules; register in the four lists; add `GUIDE_OMITTED` to `AGGREGATED`.  - [x] **Step 4: Run** — 0 failed.
- [x] **Step 5: Commit** — `node build.js`; add `js/guides.js js/diag.js index.html sw.js test/modules.js test/run_tests.js dist/shadowbox-studio.html`; `feat(guides): concealed inset-outline and interior-mark guides, scored sheet numbers, containment check (alpha.3 E10, G3.3 subset)` + trailer.

**Result (2026-10-09):** as specified (commit `d021eca`), with one deviation: the `validate` rounding tolerance is an inset of 2 µm (plan: 1 µm), because three integer offsets left a 2.09 µm residue at an acute corner. `GUIDE_OMITTED` aggregated with `detail.kind` `part`/`label`.

---

#### Task E11: Guides in `generate` (stage 14), in the preview, the UI and the placement map

**Files:**
- Modify: `js/engine.js:629-632` (stage 14), `:691-708` (`fabricationFiles` adds `placement_map.svg` for bonded)
- Modify: `js/svgout.js` (`S.placementMapSVG`), `js/preview.js` (`drawCard(..., {scores: true})` draws `layer.scorePaths` as 1 px blue lines; Proof/Section/Tilt never draw them; on a draft result the cards' guide legend reads "Guides (approximate at draft; exact in the fabrication preview)"), `index.html` + `js/app.js` (`applyApplicability` `:1087`, guide controls: `#in-guides` select none / inset-outline / interior-mark, `#in-gconceal`, `#in-gallow`, `#in-gfoot`, `#in-glabel` in mm, bonded only; a Layers-card toggle `#in-guidesvis`, checked)
- Test: suite `engine.js/svgout.js/app.js — alpha.3 E11 guides in generate (G3.1 stage 14, ASM-01/05, SUP-04, NFR-05)`

**Interfaces:**
- Consumes: E10 `SBGuides.build/validate`.
- Produces: in bonded mode with `guides.mode !== "none"`, after `annotate` and before accounting: `const gb = SBGuides.build(layers, con.guides, dOpts); layers = layers.map((L, k) => Object.assign({}, L, {scorePaths: gb.scorePaths[k]})); diagnostics.push(...gb.diagnostics, ...SBGuides.validate(layers, gb, con.guides, dOpts)); guides = gb.guides;` — so score paths enter `layerHash`, labels/omissions enter `guideHash` (`js/engine.js:498-502`), both qualities get the same code path, and guides are rebuilt after every repair replay (SUP-04/SUP-05: no `guideRefs` invalidation needed while every generate rebuilds; `part.guideRefs` stays `[]` until G3.3). `SBSvg.placementMapSVG(snapshot, {title}) → string`: one panel per glue step k = 1…exported−1, stacked vertically in the page frame scaled to fit A4 width: layer k−1 filled light gray, layer k outlined, each part of layer k with its part ID as SVG text (not a cut file), omitted-guide parts outlined red, a heading "Step k: place sheet k+1 on sheet k". `fabricationFiles` appends it as `placement_map.svg` for bonded only.

- [x] **Step 1: Write the failing tests**

```js
suite("engine.js/svgout.js/app.js — alpha.3 E11 guides in generate (G3.1 stage 14, ASM-01/05, SUP-04, NFR-05)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema, px = { pixels: F.heightMap(7, 200, 200), channels: 1, w: 200, h: 200, alpha: null };
  let p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); p.geometry.targetMM = 120;
  p.construction.guides.mode = "inset-outline";
  const d = E.generate(E.request(p, px, { quality: "draft" })).snapshot, f = E.generate(E.request(p, px, { quality: "fabrication" })).snapshot;
  check("G3.1 bonded generate fills scorePaths on k for k+1 parts at draft and fabrication", d.layers[0].scorePaths.length > 0 && f.layers[0].scorePaths.length > 0 && d.guides && f.guides);
  // construction.guides is already in geometryKey (js/schema.js:968-972), so comparing modes would pass without stage 14; check the hash inputs themselves
  check("NFR-05 guides are deterministic; labels/omissions enter guideHash and score paths enter layerHash",
    E.generate(E.request(p, px, { quality: "draft" })).geometryHash === d.geometryHash && E.guideHash(d.guides) !== E.guideHash(null) &&
    SBGeom.layerHashes(d.layers[0]).layerHash !== d.layers[0].canonicalHash);
  check("LYR-06 draft and fabrication agree on guide omissions and labels for a fixture well clear of the thresholds",
    JSON.stringify(d.guides.omitted.map((o) => o.layer)) === JSON.stringify(f.guides.omitted.map((o) => o.layer)) &&
    d.guides.labels.map((l) => l.text).join() === f.guides.labels.map((l) => l.text).join());
  check("GEO-07 no GUIDE_UNCONTAINED on the fixture", !f.diagnostics.some((x) => x.code === "GUIDE_UNCONTAINED"));
  const files = E.fabricationFiles(f, p, "#c8a26b");
  check("ASM-01 bonded bundle contains placement_map.svg; sheet SVGs carry the scores in SCORE and no <text>",
    files.some((x) => x.name === "placement_map.svg") && /<g id="SCORE"[^>]*>\s*<path/.test(files[0].data) && files.filter((x) => /^sheet_/.test(x.name)).every((x) => !/<text/.test(x.data)));
  const c = S.defaults("acrylic"); c.interpretation.mode = "height"; c.interpretation.polarity = "white-high";
  const cs = E.generate(E.request(S.withSource(c, E.sourceRecord(px, { format: "png", decode: "raw-gray8" })), px, { quality: "draft" })).snapshot;
  check("DEP-04 connected mode gets no guides (guides null, no scores)", cs.guides === null && cs.layers.every((L) => L.scorePaths.length === 0));
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("ASM-01 guide controls exist and are bonded-only", /id="in-guides"/.test(html) && /id="in-gallow"/.test(html) && /in-guides/.test(appSrc));
});
```

- [x] **Step 2: Run** — ✗.  - [x] **Step 3: Implement** stage 14, `placementMapSVG`, `fabricationFiles`, preview cards, controls (wired through the existing `SBSchema.applyControl`/`applicability` pattern; add `guides`, `gconceal`, `gallow`, `gfoot`, `glabel` to `S.applyControl` (`js/schema.js:816`) and bonded-only reasons to `S.applicability` (`:943`)). Retarget the alpha.2 check "alpha.2 export keeps the legacy flat layout: sheet_01..08.svg and proof.svg" (`test/run_tests.js:5222`) to allow `placement_map.svg` for bonded, and `EXP-01 bonded sheets are pure vector` keeps passing (scores are paths). Add `GUIDE_OMITTED` text to `docs/USER_GUIDE.md` ("place that part by the placement map").
- [x] **Step 4: Run** — 0 failed; manual: cards show blue concealed outlines with the "approximate at draft" legend; the Proof does not. Then re-run `node test/bench.js draft --record` (stage 14 now runs in every draft): if the E4 decision changes, commit the new `docs/perf/draft-budget.json`, the preset `draftPx`/`draftPxCap` values and the DRAFT.md note with this task (the E4 check keeps them in step); also record the guide share of the fabrication run against E-R4.
- [x] **Step 5: Commit** — `node build.js`; add `js/engine.js js/svgout.js js/preview.js js/app.js js/schema.js index.html test/run_tests.js docs/USER_GUIDE.md dist/shadowbox-studio.html` (plus `docs/perf/draft-budget.json docs/perf/DRAFT.md` if the re-run changed them); `feat(engine,svgout,preview,app): bonded guides and sheet labels in every generate, placement map, guide controls (alpha.3 E11)` + trailer.

**Result (2026-10-09):** as specified (commit `1ebc1cf`): stage 14 in every bonded generate, `placementMapSVG`, `placement_map.svg` in bonded bundles, blue score paths on cards only, guide controls. Label placement one concealed polygon at a time (≈0.7 s → 0.2 s per draft). Draft re-run: realistic warm p95 3.76 s at 720 px with guides (above the 3.0 s target; 720 is the floor, decision unchanged, gap recorded in DRAFT.md and the alpha.3 CHANGELOG). The fabrication share of stage 14 (`bench large`) was not measured.

---

#### Task E12: Re-review draft repairs in the Fabrication review

**Files:**
- Modify: `js/app.js` (`clipAction` `:428`, `renderFabReview`, `renderRepairs` `:451`, `openClipDialog` `:501`)
- Test: suite `app.js/support.js — alpha.3 E12 repair re-review at fabrication (SUP-04, PO-PREVIEW-6, EXP-07)`

**Interfaces:**
- Consumes: E1 (no `REPAIR_STALE` for unchanged settings), E2 `repairsApplied`, E6 `showFab`, shared renderer.
- Produces: in the Fabrication review each `REPAIR_REVIEW_FAB` item shows its detail (fabrication mm² and part counts, `js/support.js:491-495`) and three actions: **Show** (`showFab()` then `focusDiagnostic(d)` on the fabrication layers, region highlighted), **Keep** (the item's acknowledge checkbox, labelled "Keep this clip at fabrication resolution"), **Revert** (`SBSupport.removeRepair(project, ri)` via `commitProject`, which makes the fab run stale and returns the view to the draft). `REPAIR_STALE` keeps its "Review clip N…" link to the draft clip dialog.

- [x] **Step 1: Write the failing tests**

```js
suite("app.js/support.js — alpha.3 E12 repair re-review at fabrication (SUP-04, PO-PREVIEW-6, EXP-07)", () => {
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  check("PO-PREVIEW-6 REPAIR_REVIEW_FAB items offer Show, Keep and Revert in the Fabrication review",
    /REPAIR_REVIEW_FAB/.test(appSrc) && /Keep this clip at fabrication resolution/.test(appSrc) && /SBSupport\.removeRepair\(/.test(appSrc) && /showFab\(\)/.test(appSrc));
  check("UI-04 Show focuses the diagnostic on the fabrication result", /focusDiagnostic\(/.test(appSrc) && /run\.shown === run\.fab/.test(appSrc));
  const S = SBSchema, P = SBSupport, p = S.defaults("plywood"); p.source = S.sourceTemplate();
  const q = Object.assign(JSON.parse(JSON.stringify(p)), { revision: 3 }); q.construction.repairs = [{ op: "clip-to-lower", layer: 1, sourceRevision: 2, resultRevision: 3, keyHash: "0".repeat(64),
    reviewed: { quality: "draft", beforeHash: "0".repeat(64), afterHash: "0".repeat(64), removedAreaMM2: 1, partCountBefore: 1, partCountAfter: 1 } }];
  const r = P.removeRepair(q, 0);
  check("SUP-04 Revert in the fabrication review bumps the revision (the fab result becomes stale)", r.revision === 4 && r.construction.repairs.length === 0);
});
```

- [x] **Step 2: Run** — ✗.  - [x] **Step 3: Implement**.  - [x] **Step 4: Run** — 0 failed; manual: accept a clip on the draft, click Preview at fabrication resolution, Keep, Download.
- [x] **Step 5: Commit** — `node build.js`; add `js/app.js test/run_tests.js dist/shadowbox-studio.html`; `feat(app): re-review draft clips in the Fabrication review (show, keep, revert) (alpha.3 E12)` + trailer.

**Result (2026-10-09):** as specified (commit `af10e9d`): `REPAIR_REVIEW_FAB` items offer Show (`showFab` + focus), Keep (ack on the fab `geometryHash`, Q10) and Revert; `REPAIR_STALE` keeps its link to the draft clip dialog.

---

#### Task E13: Bonded-aware ASSEMBLY.md and settings.json from the fabrication snapshot

**Files:**
- Modify: `js/docs.js` (`D.assembly`), `js/app.js` (`buildAssemblyMD` `:700-752` removed; `settingsJSON` `:754-764`; `buildAndDeliver` `:907-908`), `js/schema.js` (`fromLegacySettings` `:622-655` raises `LEGACY_PROJECT_BLOCK`), `js/diag.js` (register `LEGACY_PROJECT_BLOCK`, info), `docs/USER_GUIDE.md`
- Test: suite `docs.js/app.js — alpha.3 E13 assembly and settings (ASM-05, EXP-06, PO-PREVIEW-7)`

**Interfaces:**
- Produces: `SBDocs.assembly(project, fabSnapshot, {colors, sourceName}) → string` (Markdown). Bonded: title, art and page size from `snapshot.page`, nominal/measured thickness and stack height from `stats.stockMM`/`reliefMM`, a table of **exported** sheets only (`sheet_NN.svg`, layer, parts, role base/layer/top) and a line listing omitted-trailing layers, the **glue-up order** (sheet 1 face up, then each next sheet onto the scored outlines of the previous, front face up, no mirroring), the guide explanation (mode, concealment inset, allowance, footprint; the scored outlines on a sheet show where the next sheet's parts go and are hidden once it is glued; the scored number on a sheet is that sheet's own number), omitted guides and the pointer to `placement_map.svg`, machine profile name and processing area, the kerf line in G3.5's named wording `no kerf offset applied (kerfMode=external)` followed by the recorded `machine.kerfMM` as information for the laser software (MAT-05, PO-LASER-7), the EXP-09 downstream-edit warning, the MAT-01/MAT-04 disclaimers, no speed or power value (NFR-12), the short `geometryHash` (first 12 hex) of the exported result, and no bridge/dowel/spacer text. E13 adopts G3.5's named checks now, so G3.5 only adds the part-ID and support-reference content. Connected: today's wording rebuilt from the fab snapshot (frame, holes, bridges, spacers `gapMM`). `settingsJSON()` keeps the 19-key `keep` list unchanged (the DEP-04 regex at `test/run_tests.js:3116-3134` reads it) and adds `o.project = {geometryKey: SBSchema.geometryKey(project), constructionMode, interpretationMode, thicknessMM, fabPitchMM, raster: [rasterW, rasterH], geometryHash, engineVersion}` from `run.fab.snapshot`. Re-import is **lossy and says so**: `fromLegacySettings` always builds an acrylic connected-sheet project from the v1.1 keys (`js/schema.js:622-655`), so a bonded project's `settings.json` re-imports as connected; when a `project` block is present it is kept in `extras.legacy` and an info `LEGACY_PROJECT_BLOCK` ("This settings.json came from a v2 project (bonded relief, …); only the v1.1 settings were imported. Open the .sbrproj (G3.8) for a full round trip.") is raised. `docs/USER_GUIDE.md` states the same.

- [x] **Step 1: Write the failing tests**

```js
suite("docs.js/app.js — alpha.3 E13 assembly and settings (ASM-05, EXP-06, PO-PREVIEW-7)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema, w = 400, h = 100;
  const px = { pixels: new Uint8Array(w * h).fill(100), channels: 1, w, h, alpha: null };
  const p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); p.geometry.targetMM = 10; p.title = "t";
  const s = E.generate(E.request(p, px, { quality: "fabrication" })).snapshot, md = SBDocs.assembly(p, s, { colors: "#c8a26b" });
  check("ASM-05 bonded ASSEMBLY names the glue-up order, thickness, guides and the placement map; no bridge or spacer text",
    /glue/i.test(md) && /6\.35/.test(md) && /placement_map\.svg/.test(md) && /concealment/i.test(md) && !/bridge|dowel|spacer/i.test(md));
  check("D-4.7 ASSEMBLY rows are the exported sheets only; omitted layers are listed",
    (md.match(/^\| sheet_\d\d\.svg/gm) || []).length === s.stats.exported && /omitted/i.test(md));
  check("PO-LASER-7/MAT-05 ASSEMBLY states the machine and the external kerf in the G3.5 wording", /xTool S1/.test(md) && /0\.15/.test(md) && md.includes("no kerf offset applied (kerfMode=external)"));
  check("NFR-12/EXP-09 no speed/power values; the downstream-edit warning is present",
    !/\b\d+(\.\d+)?\s*(%|mm\/s|mm\/min|k?W)(?!\w)/i.test(md) && /edit/i.test(md) && /laser software/i.test(md));
  check("PO-PREVIEW-2 ASSEMBLY names the short geometryHash of the exported result", md.includes(s.geometryHash.slice(0, 12)));
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  check("PO-PREVIEW-7 buildAndDeliver writes SBDocs.assembly from run.fab.snapshot; buildAssemblyMD is gone",
    /SBDocs\.assembly\(project, run\.fab\.snapshot/.test(appSrc) && !/function buildAssemblyMD\(/.test(appSrc) && !/run\.sheets\b|run\.procW/.test(appSrc));
  check("EXP-06 settings.json keeps the 19 v1.1 keys and adds a project block with mode, thickness, pitch and hash",
    /o\.project = /.test(appSrc) && /run\.fab\.snapshot\.geometryHash/.test(appSrc.slice(appSrc.indexOf("function settingsJSON("), appSrc.indexOf("function settingsJSON(") + 1500)));
  const back = S.fromLegacySettings(Object.assign({ procRes: 720, nSheets: 5 }, { project: { constructionMode: "bonded-relief" } }));
  check("DEP-04 a settings.json with a project block re-imports as the documented lossy v1.1 mapping and says so",
    back && back.project && S.validate(back.project).ok === true && back.project.construction.mode === "connected-sheet" &&
    back.project.extras.legacy && back.project.extras.legacy.project && back.diagnostics.some((d) => d.code === "LEGACY_PROJECT_BLOCK" && SBDiag.CODES.LEGACY_PROJECT_BLOCK.severity === "info"));
});
```

(Read `S.fromLegacySettings`'s minimum input at `js/schema.js:622` and adjust the fixture to its required keys.)

- [x] **Step 2: Run** — ✗.  - [x] **Step 3: Implement**; drop the E5 `buildAssemblyMD` exclusion from the E5 `run.sheets` check.  - [x] **Step 4: Run** — 0 failed.
- [x] **Step 5: Commit** — `node build.js`; add `js/docs.js js/app.js js/schema.js js/diag.js docs/USER_GUIDE.md test/run_tests.js dist/shadowbox-studio.html`; `feat(docs,app): bonded ASSEMBLY.md and settings.json project block from the fabrication snapshot (alpha.3 E13)` + trailer.

**Result (2026-10-09):** as specified (commits `ae98ca0`, `df8f80f`): `SBDocs.assembly(project, fabSnapshot, opts)` replaces `buildAssemblyMD`; `settings.json` `project` block; `LEGACY_PROJECT_BLOCK` (info) on re-import. The review fix corrects the connected stack-height line and makes the glue-up step follow the guide mode.

---

#### Task E14: Checkpoint v2.0.0-alpha.3

**Files:** `js/app.js:23`, `sw.js:19`, `docs/CHANGELOG.md`, `docs/USER_GUIDE.md`, `docs/QA_CHECKLIST.md`, `test/run_tests.js` (`:2636` DEP-02 retarget, new checkpoint suite), `dist/shadowbox-studio.html`, this plan (tick E1–E14, Result notes).

- [x] **Step 1: Write the failing tests** — retarget `test/run_tests.js:2636` to `/const APP_VERSION\s*=\s*"2\.0\.0-alpha\.3"/` (`DEP-02 release 2.0.0-alpha.3 (APP_VERSION)`) and add:

```js
suite("CHANGELOG — checkpoint v2.0.0-alpha.3 (R9, PO-PREVIEW-1..7)", () => {
  const cl = fs.readFileSync(path.join(__dirname, "..", "docs/CHANGELOG.md"), "utf8"), sec = (cl.split(/^## v2\.0\.0-alpha\.3\b.*$/m)[1] || "").split(/^## /m)[0];
  check("R9 CHANGELOG v2.0.0-alpha.3 has a known-gaps table (worker, draft budget, part IDs, holes, .sbrproj, manifest, layout, legacy repairs, draftPx in the key, draft approximation, lossy settings re-import)",
    /known gaps/i.test(sec) && /^\|.*\|\s*$/m.test(sec) && /G4\.1/.test(sec) && /draft/i.test(sec) && /part ID/i.test(sec) && /registration holes/i.test(sec) &&
    /\.sbrproj/.test(sec) && /manifest/i.test(sec) && /layout/i.test(sec) && /REPAIR_STALE/.test(sec) && /draftPx/.test(sec) && /approximat/i.test(sec) && /LEGACY_PROJECT_BLOCK/.test(sec));
});
```

- [x] **Step 2: Run** — ✗.
- [x] **Step 3: Implement** — bump both versions; move "Unreleased" items into `## v2.0.0-alpha.3 — <date>, real-engine preview and bonded alignment` with a summary per PO-PREVIEW-n and a **Known gaps (alpha.3)** table: no worker (G4.1) so drafts and the fabrication preview block the page; draft below the requested 2–4 Mpx (value and rationale from `docs/perf/DRAFT.md`); connected-mode drafts slower (KI-CONN-PERF); part-ID labels, the full stroke charset and the connected `<text>` label (G3.2/G3.3); interior-mark has no rotation tick; registration holes for bonded (G3.4); `.sbrproj` and undo (G3.6/G3.8); manifest and §9.4 layout (G3.9; `placement_map.svg` is in the flat layout); repairs reviewed under alpha.2 go `REPAIR_STALE` once (runtime-only, no saved projects); fabrication preview raster capped at 1600 px on screen; the draft approximates the cut geometry (same physical filter radii, E3b tolerance; exact only in the fabrication preview); `geometry.draftPx` is in `geometryKey`, so a draft-budget change resets fabrication acks and makes clips `REPAIR_STALE` once (E.5); a v2 `settings.json` re-imports as a v1.1 connected project (`LEGACY_PROJECT_BLOCK`, E13); smoothing radii in older settings are converted from pixels at the v1.1 720 px pitch. Update USER_GUIDE (presets, colour images, Preview at fabrication resolution, guides and labels, glue-up) and QA_CHECKLIST (the E5/E6/E11/E12 manual checks on a 4096 × 3084 colour PNG). Tick the plan.
- [x] **Step 4: Run** — `node test/run_tests.js` 0 failed; `node build.js`.
- [x] **Step 5: Commit** — add the files above; `release(app,docs): v2.0.0-alpha.3 real-engine preview and bonded alignment (checkpoint)` + trailer. No tag, no push.

**Result (2026-10-09):** `APP_VERSION` and the `sw.js` cache are `2.0.0-alpha.3`; CHANGELOG `v2.0.0-alpha.3` with a summary per PO-PREVIEW-n and the known-gaps table (the Unreleased items moved into the release); USER_GUIDE (fabrication pitch replaces the stale working-resolution text, fabrication preview, clips at fabrication, two-click download, glue-up) and QA_CHECKLIST (E6, E7, E8, E11, E12 manual checks). Suite 1661 passed, 0 failed. No tag, no push.

### E.7 Risks

| # | Risk | Impact | Mitigation | Fallback |
|---|---|---|---|---|
| E-R1 | Warm draft on the user's colour source still takes about 1.5–2.2 s per edit at 720 px on the main thread (review timings; ≈3.5 s at 1024, ≈4.5 s at 1280); a cold one (new source, smoothing change) about 3–4 s; stage-14 guides add to both | Feels sluggish; NFR-02 not met; G4.4's 1.5 s p95 is not met | E3 cache, identity-orient fast path, commit-on-release sliders, 300 ms debounce, Stale veil over the previous result, E4 measured budget (p95, both art families, re-run after E11) | Keep 720 px and record; G4.1 worker pool is the real fix (pull it forward next if the PO finds it unusable) |
| E-R2 | The 2–4 Mpx draft the PO asked for cannot be interactive (measured 6–10 s at 1.8–3.1 Mpx tonal) | Expectation gap | `docs/perf/DRAFT.md` explains; the fabrication preview shows exact detail on demand | Q2 "Fine" option |
| E-R3 | Removing the raster interim leaves the first load blank for 2–4 s | Looks frozen | Source image shown dimmed with "Generating…" until the first snapshot | — |
| E-R4 | Guide offsets and placement add seconds at fabrication pitch (S1: −1500 µm offsets on 8 dense layers 2.7 s) and land in every draft too | Fab run nearer the 10 s target; draft budget drops | Layer-level offsets (2 per pair) and one intersection; labels and crosses placed by `placeBox` (4 translates, 3 intersections, ≤ 64 tiny differences per call), not by a grid search; validate buffers the emitted strokes once per layer; E11 re-runs `test/bench.js draft` and measures the fabrication share with `test/bench.js large` | Guides at fabrication only on `node test/bench.js` evidence, never silently skipped |
| E-R5 | A guide bug raises `GUIDE_UNCONTAINED` (blocking) on every bonded export | Export blocked | Construction keeps scores inside `Rc`; validate tolerates sub-2 µm slivers (`survivesInset(D, 1)`); E10 tamper test | Set guides to None (explicit user action), never auto-downgrade |
| E-R6 | Auto-switch to Tonal surprises a user with an RGB-saved height map | Wrong interpretation | RGB-equal and gray PNGs stay Height (only sources Height refuses are switched); the notice names the switch and points at the Interpretation control | — |
| E-R7 | Memory: `run.src` (≈50 MiB RGBA at 4096 × 3084, ≈100 MiB at 25 Mpx) plus the source bitmap, the draft K1/K2, and a fabrication cache would add RGBA K1 (W·H·4) plus Float32 K2 (W·H·4): ≈100 MB at 12.6 Mpx, ≈200 MB at 25 Mpx | Desktop and mobile pressure | No stage cache on fabrication runs on any device class (E6); the draft cache is bounded by `draftPxCap` | G4.3 working-set check |
| E-R8 | Static wiring checks that name legacy functions fail after E5 | Red suite mid-wave | E5 lists every check line to retarget; engine oracles untouched | — |
| E-R9 | Tonal + Kuwahara on illustrations produces many parts (complexity caps), and vertices grow about linearly with the raster's long side, so a passing draft can fail at fabrication | `COMPLEXITY_LIMIT` with no layers, possibly only at export | E5 shows the diagnostics and the "Simplify" advice; E8 predicts the fabrication counts from the draft and shows a non-ackable `FAB_COMPLEXITY_LIKELY` (no Ready badge) | Lower sheets or enable `cleanup.simplify` |
| E-R10 | Draft and fabrication geometry differ (rasterization, whole-pixel cleanup radii, guide omissions near thresholds) | The user judges the work on a picture that is not the cut | Physical filter radii and the E3b fidelity check; "Draft (approximate)" status; "approximate at draft" guides on cards; E11 agreement check; export delivers only a shown fabrication result (E6) | — |

### E.8 Open questions (each with the default implementers apply unless it is truly unsafe)

1. **Draft budget rule.** *Default:* per preset, the largest `draftPx` in {720, 1024, 1280, 1536, 2000} whose warm-cache **p95** (≥ 15 runs) for its workload is ≤ 3.0 s on both the realistic and the busy art families on the i7-11800H (a recorded deviation from G4.4's 1.5 s); mobile capped at 720; the device cap lives in `SBSchema.limits`, not in the project key; re-measured after E11. Expected **720 px** for plywood auto-tonal (possibly 1024 for height mode), far below the 2–4 Mpx example; recorded in `docs/perf/DRAFT.md`. The fabrication preview is the way to see exact detail.
2. **User "draft detail" choice (e.g. a 2.5 Mpx Fine option).** *Default:* not in alpha.3; the fabrication preview covers exact detail. Revisit with the G4.1 worker.
3. **Paper/card preset.** Neither the plan nor the schema defines one (`SBSchema.defaults` accepts plywood|acrylic only, `js/schema.js:401-404`). *Default:* ship Plywood (bonded) and Acrylic (connected); list Paper/card as a known gap. Adding it needs thickness, minimum feature and kerf values from the PO.
4. **Plywood guide mode.** The plan's preset says `interior-mark` (`js/schema.js:372`); an interior cross fixes position but not rotation, and `inset-outline` (the scored, concealed footprint of each upper part) fixes both. *Default:* the plywood preset (`js/schema.js:372`, changed in E7) and the switch to bonded use **`inset-outline`**; `interior-mark` stays selectable (position-only cross in alpha.3).
5. **Sheet labels.** *Default:* each sheet k < N−1 gets its own sheet number (the `sheet_NN` number) scored at 3 mm in a concealed area; the top sheet has no concealed area and gets none (it is the only unlabelled sheet and is named on the placement map); if the label does not fit, `GUIDE_OMITTED` (warning) with "see the placement map".
6. **Part-ID labels (ASM-01 "optional part ID").** *Default:* not scored in alpha.3; part IDs appear on `placement_map.svg`. No schema flag is added now; G3.3 adds `guides.partIds` with its default.
7. **Polarity for a colour source auto-switched from Plywood.** *Default:* the existing mapping `white-high → light-front` (light areas stand forward, the tonal analogue of white-high, `js/schema.js:347`), smoothing r4 p2 (the plan's only tonal default). The user can flip to dark-front in one click.
8. **Placement map name and format before the §9.4 layout.** *Default:* `placement_map.svg` at the ZIP root (flat layout), non-cut, with SVG text part IDs; renamed/moved in G3.9.
9. **Fabrication-preview sharpness.** *Default:* keep the 1600 px on-screen raster (`RASTER_MAX_PX`, `js/preview.js:37`); the value of the button is exact geometry and diagnostics, not a sharper picture.
10. **Fabrication re-review of a clip.** *Default:* Keep = acknowledge `REPAIR_REVIEW_FAB` on the fabrication snapshot (scoped to its `geometryHash`); no promotion of the stored review to fabrication quality in alpha.3 (it would re-key later entries).
11. **Registration holes for bonded (G3.4).** *Default:* stay deferred; bonded defaults to holes off (ASM-04) and the guides are the alignment method.
12. **Connected sheet text label (EXP-03).** *Default:* unchanged in alpha.3 (DEP-04 output stable); moves to strokes with the full charset in G3.2.
13. **Ack reset on upgrade.** *Default:* draft acks are rescoped from `legacySnapshotHash` to `geometryHash` and reset once; alpha.2 clips go `REPAIR_STALE` once. Both are runtime-only (no `.sbrproj` yet), so no saved data is affected; recorded in the CHANGELOG.

### E.9 Self-review

- **Coverage:** P1 → E1–E5 (with E3b); P2 → E6; P3 → E7; P4 → E8; P5 → E9–E11; P6 → E1 (root cause) + E12; P7 → E6 (preview.png) + E13; checkpoint → E14. Every PO-PREVIEW-n row in E.1 names its tasks.
- **Name consistency:** `SBEngine.request`, `SBEngine.sourceRecord`, `SBSchema.withSource`, `run.src`, `run.draft`, `run.fab`, `run.shown`, `showResult`, `showFab`, `run.draftCache` (no fabrication cache in the app), `snapshot.repairsApplied`, `snapshot.construction`, `SBEngine.sampleBytes`, `SBEngine.radiusPx`, `smoothing.radiusMM`, `SBProof.panelModel`, `SBProof.predictFabComplexity`, `SBDocs.sourceNotes`, `SBDocs.assembly`, `SBSchema.colourSourceSwitch`/`presetDiff`/`applyPreset`, `SBFont.strokes`, `SBGeom.placeBox`/`interiorPoint`/`bufferPolylines`, `SBGuides.build`/`validate`, `SBSvg.placementMapSVG`, `limits().draftPxCap`/`fabMsPerMpx` are used identically in every task.
- **Review Focus:** each of the five lines in E.4 has its named check in the owning task (E7, E1, E10, E6, E8).
- **Known approximations:** test snippets name fixture helpers (`F.ramp`, `F.heightMap`, `F.pngEncode`, `F.jpegHeader`) and one shape (`SBMaterial.withMaterial`) that the implementer confirms against the code before Step 2, as each task notes. `SBProof.overlays` was confirmed in review to return a per-layer array (`js/proof.js:134`).

### E.10 G3 interface reconciliation (review, 2026-10-08)

The G3 table rows predate Appendix E. After the pull-forward the E9–E13 signatures below are the ones G3 builds on; the G3 rows are read with these substitutions, and G3 keeps every named check except where retargeted here.

| G3 row | Row says | Authoritative after alpha.3 |
|---|---|---|
| G3.1 | `SBGuides.validate(layers, guides)`; stage 10 `SBGuides.registration` | `SBGuides.validate(layers, built, cfg, ctx)` (E10, validates the emitted strokes with `bufferPolylines`). Stage 10 (registration holes) moves into **G3.4**, which already owns `SBGuides.registration`; G3.1's remaining work is the `part.guideRefs`/SUP-05 invalidation only. |
| G3.1 check | `SUP-04 clip → guides rebuilt, guideHash changes` | `SUP-04 clip → guides rebuilt, layerHash[k−1] or guideHash changes` (score paths hash into `layerHash`, only labels and omissions into `guideHash`, E11). |
| G3.2 | `SBFont.strokes(text, heightMM) → polylines (µm)`; `SBGeom.interiorPoint(poly, clearanceUm)` by grid refinement / pole of inaccessibility | `SBFont.strokes(text, heightUm) → {paths, wUm, hUm}`; `SBGeom.placeBox(polys, hxUm, hyUm)`, `SBGeom.interiorPoint(polys, clearanceUm)` (= square box), both by offsets, no grid (E9). |
| G3.3 | `SBGuides.build(layers, cfg) → {scoreByLayer, labelsByLayer, omitted, byPart}`; AT-14 segment-level buffer check | `SBGuides.build(layers, cfg, ctx) → {scorePaths, guides: {mode, labels, omitted, map}, diagnostics}` (E10). The AT-14 check is already the E10 `validate` rule through `SBGeom.bufferPolylines` (E9), so G3.3 does not rewrite `validate`; part-ID labels use `placeBox` with their own box. |
| G3.5 | `SBSvg.placementMapSVG(snapshot, guides)`; `SBDocs.assembly(project, snapshot)` replacing "`app.js:311` buildAssemblyMD"; kerf/spacer text at `app.js:339-340/349-351` | `SBSvg.placementMapSVG(snapshot, {title})` (E11); `SBDocs.assembly(project, fabSnapshot, opts)` (E13). The `app.js` line references are stale: `buildAssemblyMD` was at `js/app.js:700-752` and E13 deletes it. E13 already carries the MAT-05, NFR-12 and EXP-09 checks, so G3.5 adds the part-ID map listing and the support references. |
| G3.11 | `navigator.storage.persist()` at `app.js:656`, `:679` | Stale after alpha.3; G3.11 locates the call by name. |

### E.11 Review notes (adversarial reviews of 2026-10-08: preview/export fidelity, feasibility)

Every point was checked against the tree at `c165e04`. Accepted points are applied in the task named; partial acceptances and rejections say why.

**Fidelity review.**
1. Pixel-unit filter radii make draft and cut differ — **accepted**: new Task E3b (radii in mm, converted per raster; fidelity check with a recorded tolerance). The interim "approximate" note is kept permanently as the draft status line (E5), since rasterization still differs.
2. Draft passes the caps, export fails `COMPLEXITY_LIMIT` — **accepted**: E8 `predictFabComplexity`, `FAB_COMPLEXITY_LIKELY`, no Ready badge; tested with a synthetic snapshot rather than an image fixture tuned to sit just under the cap (more stable, same rule).
3. Guides from coarse draft outlines — **accepted**: "approximate at draft" card legend and the E11 agreement check. The third fix (require the fabrication result to have been shown when guide diagnostics differ) is **subsumed** by the stricter E6 delivery rule (files only from a shown fabrication result, always).
4. Source-install race — **accepted**: E1 race-free install block and the `sampleHash` guard in `regenerate`/`fabReview`.
5. `sampleHash` ignores alpha — **accepted**: `SBEngine.sampleBytes` and the alpha test (E1).
6. Stale result drawn with current settings — **accepted**: `snapshot.construction` (E2) and the `showResult` no-`project.` check (E5).
7. Export can deliver unseen geometry — **accepted** in the second form offered (deliver only when `run.shown === run.fab && fabCurrent()`, otherwise show it and stop; no restore afterwards); short `geometryHash` in the review header, ASSEMBLY.md and `settings.json` (E6, E13).
8. No test ties exported to previewed snapshot — **accepted**: cache quality tag and `CACHE_QUALITY` (E3), warm-vs-uncached fabrication check (E3), static checks that files, settings and preview.png read `run.fab.snapshot` (E6), and the settings hash check (E13). The `run.fabCache` part became moot: the app passes no fabrication cache (E-R7).
9. `fabricationRequest` rewrites the source record — **accepted with a narrowing**: it now passes through `E.request` (and its `SOURCE_MISMATCH`) whenever `project.source` is set, and installs a record only for a null source, which the alpha.2 checks and the DEP-04 path still use; the app never calls it (static check, E1).
10. Reload resets the source policy — **accepted**: the base merges `project.source` (E1 test).
11. Overlay test would throw; raster bridge path alive — **accepted** (E5).
12. preview.png captures UI state — **accepted** (E6).
13. `draftPx` in the key moves the fabrication hash — **accepted as a known gap** (E.5, E14); dropping it from the key is deferred to G3.6/G3.8 where saved projects make it matter.

**Feasibility review.**
1. E4 expected outcome and rule — **accepted**: p95 over ≥ 15 runs on the realistic and busy families, recorded G4.4 deviation, expected 720 (maybe 1024 for height), identity-orient fast path (E3), re-run after E11. The reviewer's timings were not re-measured here; E4 measures them.
2. Guide placement cost and grid misses — **accepted** with a change: placement is by offsets as proposed, but via `placeBox` (box candidates from the translate intersection, each checked by a box difference) rather than "lowest vertex of the largest offset polygon", so labels use their real box (item 4) and non-convex regions are checked.
3. `validate` cannot catch a stray score — **accepted**: `SBGeom.bufferPolylines` (E9) and the emitted-stroke rule (E10).
4. Two E10 checks fail on the fixture — **accepted**: box-based label rule (verified: 2.2 mm box in the 3.2 mm region fits; the circle needed 3.806 mm) and the exact `scorePaths` length assertions.
5. E5 `run.sheets` check fails until E13 — **accepted**: scoped out of `buildAssemblyMD` until E13, which drops the exclusion.
6. Incomplete retarget lists — **accepted** (E1: `:5037-5039`, `:5250-5251`; E5: `:4071-4074`, `:4289-4290`, `:5181`).
7. G3 interface conflicts — **accepted**: E.10 above, with a pointer in the G3 note.
8. Acrylic `draftPx` set from the bonded measurement — **accepted**: per-preset decision from workload (c) (E4).
9. Overlay check throws — **accepted** (same as fidelity 11).
10. SCORE regex — **accepted** (E11; `js/svgout.js:161`).
11. Guides-in-hash check passes for the wrong reason — **accepted** (E11; `construction.guides` is in `geometryKey`, `js/schema.js:968-972`).
12. Two drafts per load — **accepted** (E1 installs without `commitProject`).
13. Plywood preset guide mode — **accepted** (E7, `js/schema.js:372`).
14. No runtime source for the fab estimate — **accepted**: `limits().fabMsPerMpx` (E4, E6).
15. Label omission merged by aggregation — **accepted**: `detail.kind` `part`/`label` (E10).
16. E13 vs G3.5 wording — **accepted**: E13 uses the G3.5 phrases and checks.
17. DEP-04 round-trip check proves nothing — **accepted**: asserts the lossy mapping plus `LEGACY_PROJECT_BLOCK` (E13).
18. Memory underestimated — **accepted**: E-R7 restated; no fabrication cache on any device class.
19. Stale references — **accepted**: `js/engine.js:50`; geom name list `:1100-1102` (and the new functions are defined on `G`, not added to it); module order "directly after `support.js`"; legacy seams in `docs/ARCHITECTURE.md`, not `COMPONENTS.md`.
20. `--only "alpha.3 E1"` matches E10–E14 — **accepted** (trailing space).
21. "Use as height map instead" can never succeed — **accepted**: button dropped (E7, E-R6).
22. Review Focus 5 pixel need — **accepted**: 5727 × 4312 at 0.109 mm, shortfall 1631 × 1228 (re-run of `rasterPlan`).
23. `cutLengthMM` duplicates `stats.cutMM` — **accepted**: removed from E2; cards read `L.stats.cutMM`.
24. Circular point recheck — **accepted**: replaced by the independent buffer test (item 3).

Rejected outright: none.

## Appendix F — speed round (G4.1 worker pool pulled forward)

**v2.0.0-alpha.3 → speed round (before G3) Implementation Plan**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fabrication preview of the user's ~12 Mpx bonded colour illustration finish in ≤ 10 s (stretch ~5 s) with the page responsive throughout, and make the draft about 2000 px on the long side (≈ 0.2 mm/px) within the 3.0 s warm-draft rule, by (a) speeding up the hot kernels on one thread with bit-identical outputs, (b) running `SBEngine.generate` in a coordinator Web Worker, and (c) fanning the per-layer and per-adjacent-pair stages out to a pool of helper workers with a fixed merge order. Draft-only sampling shortfall stops blocking (S4), and the guide stage is measured and benched (S5).

**Architecture:** `run()` (`js/engine.js:553-750`) becomes a generator, `runSteps`, that `yield`s a batch `{kind, items}` at every parallel point and folds the results in item order in its own body. Two drivers resume it: the **sync driver** (`SBEngine.generate`, unchanged signature, used by Node tests, bench and the no-worker fallback) runs each item inline in index order; the **async driver** (in the coordinator worker) posts items to helpers and resumes with the results sorted by item index, whatever order they completed in. Both call the same kernel functions from a frozen `SBEngine.TASKS` table, so the **folds** are identical by construction. Bit-identity of the whole run additionally rests on the F.3 pool rules (explicit runtime inputs, source identity, buffer-transfer ownership, error precedence, one run at a time, version-checked helpers, immutable kernel arguments); F0, F12, F14 and F16 test each of them. The main thread only posts requests, receives `ack`/`progress`/`result`, and paints.

**Tech Stack:** Plain ES2020 classic-script IIFEs, no npm; Node built-ins for tests (`node test/run_tests.js`), bench (`node test/bench.js`) and build (`node build.js`); `worker_threads` only inside a test/bench shim; Web Workers + `MessageChannel` in browsers; Clipper2 through `SBGeom`.

**Spec:** `docs/SRS_Stacked_Relief.md`; this plan's G4.0/G4.1/G4.4 rows (§10), Global Constraints, Appendices C–E; the product-owner request of 2026-10-09 recorded in F.0.

### F.0 Why this round exists (measured on alpha.3, 2026-10-09)

Machine: i7-11800H (8 cores / 16 threads), Linux, Node v26.7.0, Chromium and Firefox; second machine MacBook Air M5 (Safari later). User: xTool S1, bonded plywood relief from colour illustrations ~4096 × 3084.

1. **Fabrication preview freezes the page.** 9.7 Mpx: ~23.4 s in the browser (Node: 19.4–19.7 s); the user's 4096 source (3985 × 3000, 12 Mpx at 0.1 mm): 28.1 s in Node. Everything runs on the main thread (`fabReview`, `js/app.js:959-994`, sync call at `:978`).
2. **The draft stayed at 720 px.** Warm draft p95 3.76 s at 720 px with guides, measured in **Node** (`node test/bench.js draft`, `docs/perf/DRAFT.md:40-47`; not a browser figure), over the 3.0 s E4 rule (`docs/perf/draft-budget.json`), so `DRAFT_BUDGET.desktopDraftPx` is 720 (`js/schema.js:163`) and both presets carry `draftPx: 720` (`js/schema.js:395`, `:413`). At 300 mm high the 4096 × 3084 art is ≈ 398 mm wide, so 720 px is ≈ 0.55 mm/px (staircase edges).
3. **A blocking `SAMPLING_LOW` that only applies to the draft.** `SBSupport.featureChecks` judges `minFeatureMM / mmPerPxMax` of the raster it was given (`js/support.js:336-339`), and `run()` passes the draft raster's pitch (`js/engine.js:697-698`). Plywood's 1.5 mm minimum feature at 0.55 mm/px is 2.7 samples → blocking at draft, while fabrication (0.1 mm/px, 15 samples) passes.
4. **Guide stage cost was unmeasured.** Profile: 311–542 ms at draft, ~1.47 s at fabrication (7 pairs), the third-largest fabrication stage. **Resolved by F2 (2026-10-09, `docs/perf/speed-round.json` `baseline`, `warm720`; per-stage from the `onProgress` marks, Node, 1-min load ≈ 7–9):** both figures were right, for different art. Stage 14 scales with the parts and vertices of the art, not with cold vs warm. On the **alpha.3 scene** (user12, 4096 source → 720 × 542) guides take **398 ms** (build 187 + validate 211) of a 3.29 s cold draft; at fabrication 1.31 s (fab3600) and 1.30 s (fab4096; build 547 + validate 750). On the **E4/E11 bench art** (`F.heightMap` realistic family, ≤ 126 parts/layer) the warm 720 draft is p50 **3533** / p95 3792 ms with inset-outline vs 1925 / 2299 ms with guides `none`: guides **1540 ms** warm p50 (build 650 + validate 893; cold 1885), i.e. 44 % of the warm draft and the largest warm stage, ahead of construct (670), trace (487), features (428) and hashes (125). The busy family stops at `COMPLEXITY_LIMIT` before stage 14 with and without guides (warm p95 2274 / 2571 ms). The E11 delta (+1.5–1.8 s) is therefore the guide stage on the bench art; S3 is decided on that art (E4 rule), so the guide stage is the main S3 cost.

Profile of `generate` (scratchpad `prof.js`, cold, no E3 cache; per-stage wall ms):

| stage | draft 720 | fab 3600 (9.7 Mpx) | fab 4096 (12 Mpx) | where |
|---|---|---|---|---|
| resample | 690–2035 | 10 (method none) | **4967** | `js/raster.js:278`; the area path allocates `rows` = h·W·c Float64 (`:303`), ≈ 393 MB at 4096 |
| interpret (Kuwahara dominant) | 213–306 | **4022–4246** | 4833 | `kuwaharaOnce` `js/raster.js:97`, `boxSum` closure `:113`, `SBUtilClampI` `:140` |
| masks | 23–27 | 480–548 | 616 | `Hh.cumulativeMasks` `js/height.js:60` |
| construct | 561–842 | **10200–10714** | **13058** | `morph`/`diff` `js/construct.js:71-84`; `windowAny` `js/morph.js:79` 29.8 % self; `M.components` `:133` 10.2 %; draft overlays `E.maskPolygons` `js/engine.js:121` (401 ms / 14 calls) |
| trace | 145–241 | 2042–2100 | 2252 | `M.fromMasks` `js/material.js:234`; `T.trace` Map corner table `js/trace.js:35-45` |
| validate + features | 110–250 | 610–670 | 646 | `js/support.js:211-262`, `:319-360` |
| guides | 311–542 | 1464–1481 | 1465 | `SBGuides.build`/`validate` `js/guides.js:73`, `:148` |
| **total** | 2532–3449 | **19426–19660** | **28129** | |

Parallel structure (verified against the code): bonded construct is independent per layer (`C.bonded`, `js/construct.js:105-116`; slowest layer ≈ 2.1 s of 10.2 s); trace and polygon conversion are per layer (`js/material.js:249-275`) except the connected-mode `smoothStack` barrier (`:256-260`); support is per adjacent pair except the `reach`/`pairs` fold (`js/support.js:211-262`); feature checks are per layer after a header (`js/support.js:334-342`); guides are per pair with an ordered append (`js/guides.js:73-142`, `:152-165`); layer hashes are per layer (`js/engine.js:738`).

Baseline before this round: `node test/run_tests.js` → **1661 passed, 0 failed** (2026-10-09, alpha.3 + `b7f1a30`).

### F.1 Goals and traceability

Product-owner requirements of 2026-10-09 that the SRS does not state are `PO-PERF-n`. This table extends the §1 traceability matrix.

| Goal | ID | Requirement | SRS / PO links | Tasks |
|---|---|---|---|---|
| S1 | **PO-PERF-1** | `SBEngine.generate` runs off the main thread: one coordinator worker plus a helper pool of **P = `clamp(hardwareConcurrency − 1, 1, cap)` helpers** (cap 8 desktop, 4 mobile; the coordinator is not counted in P; with 8 sheets only 7 construct items exist, so P > 7 adds nothing to construct). P = 0 (coordinator runs every item inline) is a supported, tested configuration. Per-layer and per-adjacent-pair stages (construct incl. draft overlays, trace/`fromMasks` conversion, support pairs, feature checks, guides build/validate, layer hashes) and row-band raster kernels (area resample, Kuwahara) are parallel. **Bit-identical** to the serial engine (whole response minus timing equal, incl. `geometryHash`, `layerHashes`, diagnostics order) for every pool size and completion order. Engine-version and build-time module-hash handshake for the coordinator **and every helper spawn/respawn**; superseded drafts cancelled; serial fallback (file:// index.html, a refused Blob worker; the sync driver, F15); `dist/` runs a Blob worker built from the inlined module texts; progress/busy UI without freezing. | NFR-02, NFR-05, NFR-09, UI-05, UI-06, §9.3, AT-15, AT-24; plan G4.0, G4.1; R7 | F9–F16 |
| S2 | **PO-PERF-2** | Fabrication preview of the user's bonded 12 Mpx case (4096 × 3084 tonal, plywood, 8 sheets, 300 mm, 0.1 mm pitch, inset-outline guides) ≤ **10 s** on the i7-11800H in Chromium (stretch ≈ 5 s); no main-thread task > 100 ms while it runs; peak memory inside the F.3 budget. | NFR-03 (laser-detail row, PO-LASER-9), NFR-04, NFR-02 | F3–F8, F13, F18 |
| S3 | **PO-PERF-3** | Desktop draft long side raised to the largest of {1280, 1536, 1792, 2000} whose **warm p95 ≤ 2.5 s** in Chromium and Firefox on the i7 (0.5 s headroom under the 3.0 s E4 rule) and ≤ 3.0 s on the M5 Air in Chromium; debounced (300 ms, `js/app.js:90`); mobile and the no-worker fallback keep 720 through the explicit request field `draftCapPx` (F-D5). Rule: the E4 rule unchanged in method — **both** the realistic and the busy family must pass, warm edit = sheets 8 ↔ 7 with the revision changing (`docs/perf/draft-budget.json` `rule`/`method`). Decision recorded in `docs/perf/draft-budget.json` and `DRAFT.md`. | NFR-03 (draft), PO-PREVIEW-1, GEO-06 | F17 |
| S4 | **PO-PERF-4** | `SAMPLING_LOW` is judged against the **fabrication** raster predicted by `E.rasterPlan(…, "fabrication", deviceClass)`, at both qualities. A draft-only shortfall is at most the new info `DRAFT_COARSER` ("draft is coarser than fabrication"). Recorded as deviation F-D1. | GEO-06, PO-LASER-4, PO-LASER-6, UI-04 | F1 |
| S5 | **PO-PERF-5** | Guide stage (stage 14) timed at draft and fabrication in `bench large` and `bench draft`; profile-led single-thread hotspots (resample, `windowAny`/erode, `components`/`fillHoles`, Kuwahara, `T.trace`, draft overlays; KI-B1 normalize/T-split if still on the critical path) optimised **without changing outputs** (oracle tests). KI-CONN-PERF re-measured with the pool and reported (non-goal: fixing it). | NFR-03, NFR-05, KI-B1, KI-CONN-PERF | F2–F8, F18 |

Non-goals: any G3 feature; connected-mode KI-CONN-PERF work beyond what the pool gives for free (numbers reported only); packaging (`buildAndDeliver`) in the worker (stays on main, `preview.snapshot("proof")` needs the DOM); tonal decode in the worker (`createImageBitmap`/canvas stays on main, `js/app.js:1544-1573`).

### F.2 Draft scoring and merge decisions

Three drafts were scored 1–5 (5 = best) by expected speedup, risk (5 = lowest), determinism (5 = strongest guarantee) and effort (5 = least).

| draft | speedup | risk | determinism | effort | notes |
|---|---|---|---|---|---|
| layer-pool (one lead worker, per-layer/pair/tile units) | 5 | 2 | 4 | 2 | Best test matrix (golden corpus first, hidden-state audit, adversarial order, lowest-index error). Two defects: per-tile Kuwahara rebuilds SAT rows `0..y1+r` (exact but O(h²/tiles) redundant), and the trace rewrite keeps an "insertion-order" table although `T.trace` iterates **sorted** corners (`js/trace.js:59`). |
| stage-pipeline (coordinator + sub-workers, `SBTasks`, `SBPack`) | 5 | 3 | 5 | 2 | Correct Kuwahara tiling (ship slices of the **global** SAT; a band-local SAT changes Float64 operands). LPT ordering, `estBytes` memory gate, 100 ms ack, main-thread watchdog, Blob built from the already-inlined module texts, the schema `draftPx` ≤ 2000 limit and that both preset and `DRAFT_BUDGET` must rise. New module and codec add surface. |
| optimise-first (serial kernels, then coordinator, then helpers) | 4 | 5 | 5 | 4 | Each phase ships value on its own: Phase A speeds up the serial fallback too, Phase B alone fixes the freeze. Kernel oracles; correct trace argument; dilation fusion; reuses `runComponents` (`js/construct.js:130`). Defers Kuwahara tiling. |

**Backbone: optimise-first** (phases A → B → C, kernels as exports of their own modules, `E.TASKS`). **Grafted:** from layer-pool, the golden equality corpus before any refactor (F0), the hidden-state audit (F0), the adversarial completion-order executor (F12), the lowest-unit-index error rule (F9), and the exact row-band resample (F3); from stage-pipeline, Kuwahara bands whose SAT rows equal the **global** SAT (F6, F13, used for the S2 stretch; shipped as seeded SAT rows instead of copied global slices, F.11 review), LPT + `estBytes` memory gate (F13), the ≤ 100 ms `ack` and main-thread watchdog (F11, F14), Blob from inlined texts (F16), the 2000 px schema ceiling and preset + `DRAFT_BUDGET` change (F17), polygon packing only if measured (F11).

Decisions taken while merging (verified against the tree):
- **Trace table:** `T.trace` sorts corner keys ascending (`js/trace.js:59`) and corners only lose bits; a typed `Uint8Array` scanned ascending is equivalent. No insertion-order array (layer-pool F20d rejected).
- **`runComponents`** (`js/construct.js:130`) labels runs of non-zero pixels only; `fillHoles` needs components of 0. F5 adds a `value` parameter when moving it to `SBMorph`.
- **Dilation fusion** (optimise-first F2d): `M.dilate` is a clipped Chebyshev window (`js/morph.js:104-109`), and clipped box dilations compose on a rectangle (`dilate_a ∘ dilate_b = dilate_{a+b}`), so `open(r)` then `close(r')` = `erode_r → dilate_{r+r'} → erode_{r'}`. `M.erode` never erodes the 1-px border and is unaffected. Shipped only behind the exhaustive small-mask test.
- **`SBDiag.acceptResult` does not exist yet** (it is a G4.1 interface, `js/diag.js` has no such function); F11 creates it.
- **Worker module list** follows `test/modules.js` (24 modules, = `index.html` minus `preview.js`/`app.js`), not the §4 text, which has drifted.
- **Cancel:** cooperative first (keeps the draft cache), `terminate()` + respawn after 300 ms without a `canceled` reply (deviation F-D2 from G4.1's terminate-only).
- **One module list, no `modulelist.js`:** `js/worker.js` holds `WORKER_MODULES`; the hygiene test parses it (fewer files than layer-pool F13).
- **Packing codec:** not built up front; F11 measures the structured-clone cost of the largest fabrication response and builds the `Int32Array` codec only if it exceeds 50 ms on the main thread.

### F.2a Deviations recorded by this round

- **F-D1 (S4, GEO-06 semantics).** `SAMPLING_LOW` at draft quality is judged on the fabrication raster plan, not the evaluated draft raster; the doc comments at `js/support.js:51` and `js/engine.js:180` (legacy pitch) are updated. Diagnostics are not hash input (`js/engine.js:739-740`), so no hash changes; draft diagnostics and their acks change. New info code `DRAFT_COARSER`.
- **F-D2 (G4.1 cancel).** Cooperative cancel at every yield, hard `terminate()` only after 300 ms; NFR-02's 500 ms cancel still holds.
- **F-D3 (G4.0 scope).** Only the minimal G4.0 lands here (no unconditional `skipWaiting`, user-gated update, `worker.js`/`pool.js` in `SHELL`); the cache/update status UI stays in G4.0 proper.
- **F-D4 (G4.1 scope).** Packaging stays on the main thread; G4.1's "packaging runs in the worker" remains in G4.1.
- **F-D5 (draft budget depends on runtime).** The desktop draft cap is the pooled decision only when the pool is up; in the no-worker fallback it is 720. **Mechanism (no hidden state):** `E.request` accepts an explicit, validated option `draftCapPx` (integer 64–2000; default `Sch.limits(deviceClass).draftPxCap`), copied onto the request; `E.rasterPlan(project, source, quality, deviceClass, draftCapPx)` uses `min(g.draftPx, draftCapPx)`. `SBPool` sets it to the pooled cap, the fallback branch to `limits.draftPxFallback` (720); no global flag or realm-dependent value reaches `rasterPlan`. The raster is in `geometryHash`, so draft acks do not carry across those modes (fabrication is unaffected). Every equality test (F0, F12, F14, F16) pins the same `draftCapPx` in both drivers; F16 additionally asserts that 720 and the pooled cap give the expected, different draft `geometryHash`.
- **F-D6 (NFR-04 working set).** NFR-04 caps the *estimated* working set at 512 MiB desktop (`docs/SRS_Stacked_Relief.md:433`). Alpha.3 already exceeds it serially at fabrication scale (the area resample's `rows` alone ≈ 393 MB at 12 Mpx), and the coordinator's resident set during interpret is ≈ 30–50 B/px before this round (source copy 4, fab RGBA 4, alpha + domain 2, L 4, SAT + SAT2 16, domain `cnt` +8, Kuwahara output 4), i.e. ≈ 0.4–0.6 GB at 12 Mpx and ≈ 0.8–1.25 GB at the 25 Mpx `fabPxBudget`, plus 8–12 B/px on main. This round (a) keeps **one** `estBytes` ledger covering the coordinator's resident set, in-flight helper work and the result on main (not helper work alone); (b) removes the largest terms (F3 streaming resample; F6 seeded SAT — the coordinator never allocates a full SAT and bands receive ≈ 4 B/px instead of 16–24); (c) F18 records the measured ledger peak at 12 Mpx and at 25 Mpx. Where the total still exceeds 512 MiB, the measured number is recorded here and handed to G4.4; fabrication resolution is never lowered silently (NFR-04). *Status (F18):* not yet measured at scale — the measurement (`bench large --only user12 --pool 0,8 --rows fab4096,fab25`, `?bench=fab`) is pending (`speed-round.json` `final.memory`); interim: serial user12 12 Mpx Node process RSS 588 MB (Phase A).

### F.3 Global Constraints

All of the plan's **Global Constraints** and E.3 apply. In addition, for this round:

- **Bit-identity is the gate.** Every kernel change ships with an oracle (the old function moved verbatim into `test/oracle_kernels.js`) and a byte-equality test; every refactor leaves `test/golden/pool-equality.json` (F0) unchanged. No change to `SBSchema.ENGINE.version` in this round.
- **Merge order** is item order (layer index, then pair index) in the generator body; scheduling, completion order and pool size never reach a fold. Map/Set insertion and diagnostics concatenation stay where they are today.
- Kuwahara bands use SAT rows **byte-equal to the global SAT**, never a band-local SAT with different operands. Shipped form (rolling seeded SAT): the coordinator scans the source once with a rolling `(w+1)` row (`sat[i] = sat[i−W] + row`, `js/raster.js:105-110`) and keeps only the global SAT/SAT2(/cnt) row at each band seed `s = max(0, y0−r)`; the helper receives that seed row plus source rows `[s, min(h, y1+r))` as Float32 copies and rebuilds SAT rows `s+1 … min(h, y1+r)` with the same operations in the same order. Test (F6): seeded rows byte-equal the global rows.
- **Runtime inputs are explicit request fields** (`draftCapPx`, `deviceClass`, `overlays`), identical between drivers; nothing in a kernel or `rasterPlan` reads which runtime it is in (F-D5).
- **Source identity.** Every `generate` names its source (`sampleHash`, `w`, `h`, `channels`); the coordinator refuses with `SOURCE_MISMATCH` unless they equal the stored source exactly; a request whose `sampleHash` is null carries its pixels inline (never matched against the stored source). The serial path keeps using the pixels passed with the call (`js/app.js:220-221`).
- **Transfer ownership.** Only buffers allocated by the yielding step and referenced by no cache, no later fold and no other item may be listed in `transfer`. Never transferable: the stored source (and `E.orient`'s identity result, `js/engine.js:309-310`), `cache.k1.samples`/`alpha`, `cache.k2.L`, `masks[k]` while overlays still read it (`:644-650`), `built.final` before `complexityGate` (`:657`). Bands and slices are made with `.slice()`, never `subarray`; `exec` asserts `byteOffset === 0 && byteLength === buffer.byteLength` for every transferred buffer and throws otherwise.
- **Error precedence.** A batch completes only when every item has settled (no first-rejection `Promise.all`); the driver then raises the error of the lowest `(phase, item index)`, where phase orders the serial sub-steps of a fused item (bonded trace before convert, `js/material.js:249-277`), and the error is `codedError(e)` verbatim (`js/engine.js:462`). Pool-infrastructure failures (helper OOM `RangeError` attributable to the helper, worker `onerror`/crash, `DataCloneError`, `messageerror`, a helper killed mid-item) are never surfaced: the item re-runs inline in the coordinator.
- **One run at a time** in the coordinator. A new `generate` cancels the current run and waits for its `canceled` (or the watchdog) before starting; a canceled or failed run never writes K1/K2.
- **Kernel arguments are immutable.** Kernels never write into, or return aliases of, their arguments (the sync driver passes `layers[k]` to two pairs by reference, `js/guides.js:80`, `js/support.js:212`; helpers get clones). Enforced in a sync-driver test mode (F9/F12) that deep-freezes plain inputs and checksums typed-array inputs before and after every item.
- **Version-checked helpers.** `E.VERSION` cannot tell kernel revisions apart while the engine version is frozen, so `build.js`/the worker loader compute a per-module content hash (`modulesHash`); the coordinator admits a helper only after its `hello` carries the same hash, on every spawn and respawn; a refused helper is terminated and its items run inline.
- **Result acceptance** is by a unique monotonic `runId` plus `gen`, `sampleHash`, `overlays` and `deviceClass` (not by `requestId`, which is `"draft-"+rev` and repeats across overlay toggles and same-revision resubmits, `js/app.js:220`, `:247-250`).
- Workers never set `SBEngine.TEST_HOOKS` (`req.debug` stays refused, `js/engine.js:526`). Errors cross `postMessage` as `{code, message}` and are rebuilt with `.code`; responses are re-`deepFreeze`d on receipt.
- **Memory budget (NFR-04, F-D6):** one `estBytes` ledger (coordinator resident set + in-flight helper work + result on main) with admission budget `Number.isFinite(navigator.deviceMemory) ? min(1 GiB, deviceMemory·128 MiB) : 512 MiB` desktop (Firefox/Safari have no `deviceMemory`; Chromium caps it at 8, so the formula is 1 GiB there), 192 MiB mobile; at least one item is always admitted even when it alone exceeds the budget (no deadlock). Enforced in F13; both cases tested.
- After every task: `node test/run_tests.js` all green; when shipped code (`js/`, `index.html`, `css/`, `sw.js`) changes, `node build.js` and commit `dist/shadowbox-studio.html` with the task. Commit only the task's files; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push, no tags.

### F.4 Review Focus

1. **A fold that depends on completion order** (diagnostics, `assignParts` ids, `supportGraph` edge order). Test: F12 adversarial executor over the F0 corpus, 20 seeds.
2. **Kuwahara pass 2 on Float32 non-integer input.** Banding must give byte-equal `Float32Array`s for passes 1–3, all radii, band counts 1–9 and `r` larger than the band. Test in F6.
3. **Edit during a fabrication run / two drafts in flight.** The stale result is never shown (`acceptResult` by `runId`), the next draft still hits K1/K2 after a **cooperative** cancel (long serial coordinator kernels — masks, SAT scan, complexity gate — poll the cancel flag every few rows so cooperative cancel normally lands < 300 ms); after a `terminate()` the next draft is cold, by design. Test in F14.
4. **`dist/` opened from file:// in Firefox and Chromium.** Blob worker boots (rung advances only on `hello`) or the serial fallback runs with the notice; pooled and serial digests are equal in the same browser. Browser-vs-Node equality is claimed only for hashes whose inputs avoid implementation-approximated maths (trig is already excluded, `js/geom.js:850`, `:929`; F16 confirms `Math.hypot` at `js/trace.js:162-166`, `js/util.js:82` never feeds a hash, or limits the claim). Test in F16 (G4.8 subset).
5. **A finer draft trips complexity caps or new diagnostics** that 720 did not. F17 records cap hits per candidate size and rejects sizes that hit a cap on the alpha.3 scene.

### F.5 File structure

| File | Change | Responsibility after this round |
|---|---|---|
| `js/raster.js` | Modify | Streaming exact area resample; `R.resampleRows`; Kuwahara interior fast path; `R.kuwaharaSeeds` (rolling SAT scan → seed rows), `R.kuwaharaRows` (band kernel rebuilding global-equal SAT rows from a seed). |
| `js/morph.js` | Modify | Branch-free `windowAny`; fused erode/dilate indicator loops; `M.runComponents(mask, w, h, value)`; run-based `fillHoles`/`removeSpecks`; `M.components` kept for other callers. |
| `js/construct.js` | Modify | `C.constructLayer(k, …)` kernel; `morph` with fused dilations; `C.bonded`/`C.connected` as maps over it; uses `SBMorph.runComponents`. |
| `js/trace.js` | Modify | Typed corner table in `T.trace`. |
| `js/material.js` | Modify | `M.traceLayer`, `M.convertLayer`; `fromMasks` as a sync wrapper. |
| `js/support.js` | Modify | `S.supportPair` + serial fold; `S.featureLayer`; `featureChecks` head with `samplingMmPerPx`. |
| `js/guides.js` | Modify | `buildPair`, `validatePair` on the frozen export; `build`/`validate` as ordered folds (split, not changed). |
| `js/engine.js` | Modify | `runSteps` generator, sync driver, `E.generateAsync`, `E.TASKS`; request option `draftCapPx` and `rasterPlan(…, draftCapPx)` (F-D5); bbox-cropped overlays; S4 fabrication-plan sampling. |
| `js/diag.js` | Modify | `DRAFT_COARSER` (info); `SBDiag.acceptResult(active, msg)` keyed by `runId`, `gen`, `sampleHash`, `overlays`, `deviceClass`. |
| `js/schema.js` | Modify | `DRAFT_BUDGET.desktopDraftPx`, preset `draftPx` (F17); `draftPxFallback`. |
| `js/worker.js` | **Create** | `WORKER_MODULES`; roles `coord`/`helper`; protocol; handshake. Not in `index.html`; in `SHELL`. |
| `js/pool.js` | **Create** | `SBPool` (main thread): spawn, broker ports, mode ladder, watchdog, `submit`/`cancel`/`setSource`. In `index.html` before `app.js` and in `SHELL`; not in `test/modules.js`. |
| `js/app.js` | Modify | `regenerate`/`fabReview` on `SBPool`; progress UI; fab Cancel; fallback branch keeps today's shape. |
| `sw.js` | Modify | No unconditional `skipWaiting`; user-gated update; `worker.js`, `pool.js` in `SHELL`; `VERSION`; worker URLs carry no `?v=` (or `caches.match(req, {ignoreSearch: true})` for them). |
| `build.js` | Modify | `data-sbmod` on inlined modules; `worker.js` as `<script type="text/sb-worker">`; per-module content hash `modulesHash`. |
| `test/browser.html`, `js/app.js` `?bench=` | **Create**/Modify (F16a) | Browser harness (`?run`) and in-app `?bench=fab|draft|cancel` with a long-task recorder, p95 and JSON download. |
| `test/oracle_kernels.js` | **Create** | Verbatim pre-change kernels (resample, windowAny/erode/dilate, components/fillHoles/removeSpecks, kuwaharaOnce/kuwaharaDomainOnce, T.trace, maskPolygons). |
| `test/pool_corpus.js`, `test/golden/pool-equality.json` | **Create** | Fixture matrix (each fixture pins `geometry.draftPx` and `draftCapPx`) and response digests captured on unmodified alpha.3; `test/capture_golden.js --pool-equality [--recapture id,…]`. |
| `test/node_worker_shim.js` | **Create** | `worker_threads` adapter (`self`, `importScripts` via `vm.runInThisContext`, `postMessage`, ports). |
| `test/bench.js` | Modify | Guide columns, all stage times, `--pool N`, `--draft-sweep`; writes `docs/perf/speed-round.json`. |
| `test/run_tests.js` | Modify | New F suites; hygiene extended to worker lists; retargeted app.js source checks. |
| `docs/perf/speed-round.json`, `docs/perf/draft-budget.json`, `docs/perf/DRAFT.md`, `docs/perf/large-image.json` | Create/Modify | Measurements and decisions. |
| `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/QA_CHECKLIST.md` | Modify | Release notes, worker architecture, manual checks. |

### F.6 Tasks

Order is binding: F0 → F1 → F2 → (F3–F8 in any order, each oracle-gated) → F9 → F10 → F11 → F12 → F13 → F14 → F15 → F16 → F16a → F17 → F18. F0 → F1 is strict (F1 re-captures the F0 golden). F15 must include the serial fallback branch, because between F11 and F16 `dist/` from `file://` depends on it. Phase gates: after F8 the serial fab-12 Mpx run is re-profiled (expect ≈ 11–13 s); after F11 the page is responsive with any pool size; after F13 S2 is measured.

---

#### Task F0: Pool-equality golden corpus and hidden-state audit (no behaviour change)

**Files:** Create `test/pool_corpus.js`, `test/golden/pool-equality.json`; Modify `test/run_tests.js` (suite `engine — speed round F0 golden corpus (NFR-05)`), `test/capture_golden.js` (`--pool-equality`).

**Interfaces:** `corpus() → [{id, project, source, quality, overlays, draftCapPx}]`; `digest(response) → {status, code, geometryHash, layerHashes, diagSha, cleanupSha, supportSha, guidesSha, statsSha, wholeSha}`, where `wholeSha = sha256(stableStringify(response minus requestId/timing))`. Because `stableStringify` drops undefined-valued keys and ignores key order and extra array properties (`js/util.js:93-99`), the corpus also exports `deepEqualStrict(a, b)` (`Object.is` on leaves, typed-array constructor plus bytes, exact own-key sets, array length and extra properties) used by F9/F12/F16 for live pool-vs-serial comparisons.

- [ ] **Step 1:** Write `corpus()`: alpha.3 scene (`tools/alpha3_scene.js`) at 900 × 675 and 1800 × 1350, draft and fabrication; height mode; tonal light-front and dark-front; bonded and connected (connected smoothing exercises the `smoothStack` barrier); frame on/off with registration holes; replayed repairs (one clip); guides `none`/`inset-outline`/`interior-mark`; alpha domain (`kuwaharaDomainOnce`); N = 2, 3, 8, 12; trailing-empty layers; `EMPTY_BAND`; a `COMPLEXITY_LIMIT` error; `simplify: "busy"`; mobile `deviceClass`; odd rasters (1 × N, 3 × 2); a **non-slow fine-pitch fixture** (small tonal source, fine `fabPitchMM`, smoothing 1.65 mm) whose Kuwahara `radiusPx` ≥ 16. Every fixture pins `geometry.draftPx` and `draftCapPx` explicitly, so F17's preset change cannot move the golden. Fixtures above 2 Mpx are tagged `slow` and run only with `--slow`.
- [ ] **Step 2:** Add `--pool-equality` to `test/capture_golden.js`, handled **before** its legacy refuse-to-overwrite guard (`test/capture_golden.js:9-12`); it refuses to overwrite `pool-equality.json` unless `--recapture id1,id2,…` names the fixtures to replace, and then rewrites only those entries. Capture on the unmodified tree; commit it.
- [ ] **Step 3:** Add the check `NFR-05 F0 every corpus response digest equals test/golden/pool-equality.json` (sync driver). Run: PASS.
- [ ] **Step 4 (audit):** grep `js/geom.js`, `js/vendor/clipper2.js` (incl. static scratch objects such as `_intResult`), `js/trace.js`, `js/morph.js`, `js/support.js`, `js/guides.js`, `js/strokefont.js`, `js/construct.js`, `js/material.js`, `js/islands.js`, `js/raster.js`, `js/height.js`, `js/diag.js`, `js/util.js`, `js/engine.js` for module-level `let`/memo/counter/scratch state that can depend on call history. Record each in `docs/ARCHITECTURE.md` (speed-round section) as "pure" or "per-call reset required"; any history-dependent state is made per-call in this task (golden unchanged).
- [ ] **Step 5:** `node test/run_tests.js` green; commit `test(speed): F0 pool-equality golden corpus and module-state audit`.

#### Task F1 (S4): Judge `SAMPLING_LOW` on the fabrication raster

**Files:** Modify `js/support.js:319-339` (`featureChecks` head), `js/engine.js:697-698`, `js/diag.js` (code table near `:87`), `test/run_tests.js` (PLAN code list near `:1763-1767`; new suite `support/engine — speed round F1 sampling on the fabrication plan (GEO-06, PO-PERF-4)`); doc comments `js/support.js:51`, `js/engine.js:178-180`.

**Interfaces:** `featureChecks(layers, cfg)` accepts optional `cfg.samplingMmPerPx` (finite > 0); `SAMPLING_LOW` uses `samplingMmPerPx ?? mmPerPxMax`. `DRAFT_COARSER` (info, no ack): emitted at draft when the draft pitch alone gives < 3 samples but the fabrication plan gives ≥ 3; `measured` = draft samples, `limit` = 3, detail "draft is coarser than fabrication; detail is checked at the fabrication pitch (X mm/px, Y samples)".

- [ ] **Step 1: failing tests**

```js
suite("support/engine — speed round F1 sampling on the fabrication plan (GEO-06, PO-PERF-4)", () => {
  const S = SBSchema, E = SBEngine, F = require("./fixtures.js");
  const base = { minFeatureMM: 1.5, mmPerPxMax: 0.55, calibrated: true };
  const codes = (ds) => ds.map((d) => d.code);
  check("F1 featureChecks without samplingMmPerPx is unchanged (0.55 mm/px → SAMPLING_LOW)",
    codes(SBSupport.featureChecks([], base)).includes("SAMPLING_LOW"));
  check("F1 samplingMmPerPx 0.1 judges the fabrication pitch (no SAMPLING_LOW)",
    !codes(SBSupport.featureChecks([], { ...base, samplingMmPerPx: 0.1 })).includes("SAMPLING_LOW"));
  const w = 1024, h = 771, px = { pixels: F.heightMap(2022, w, h), channels: 1, w, h, alpha: null };
  let p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" }));
  p.geometry.sizeBy = "height"; p.geometry.targetMM = 300;
  const d = E.generate(E.request(p, px, { quality: "draft" }));
  check("PO-PERF-4 default plywood draft: no blocking SAMPLING_LOW, DRAFT_COARSER info present",
    !codes(d.diagnostics).includes("SAMPLING_LOW") && d.diagnostics.some((x) => x.code === "DRAFT_COARSER" && x.severity === "info"));
  const q = JSON.parse(JSON.stringify(p)); q.geometry.fabPitchMM = 0.6;
  check("GEO-06 a coarse fabrication pitch still blocks at draft and at fabrication",
    ["draft", "fabrication"].every((qq) => codes(E.generate(E.request(q, px, { quality: qq })).diagnostics).includes("SAMPLING_LOW")));
  // geometryHash/layerHashes unchanged: checked against the F0 golden corpus in Step 4 (diagnostics are not hash input).
});
```

- [ ] **Step 2:** Run `node test/run_tests.js --only "speed round F1"`: FAIL (no `DRAFT_COARSER`).
- [ ] **Step 3:** Implement: in `run()` compute `fabGeo = quality === "fabrication" ? geo : E.rasterPlan(p, {w: ns.w, h: ns.h}, "fabrication", deviceClass).geometry` (sizes only, `js/engine.js:379`) and pass `samplingMmPerPx: fabGeo.mmPerPxMax`; in `featureChecks` emit `DRAFT_COARSER` when `cfg.quality === "draft"` and the draft samples < 3 ≤ fabrication samples. Register `DRAFT_COARSER` in `js/diag.js` and the PLAN info list. Update the two doc comments (F-D1).
- [ ] **Step 4:** Full suite green (the F0 golden changes **only** in `diagSha`/`wholeSha` of draft fixtures that had a draft-only `SAMPLING_LOW`; re-capture with `node test/capture_golden.js --pool-equality --recapture <ids>` and a commit note listing those ids; a test compares the old and new golden files and asserts that only the listed ids differ and only in `diagSha`/`wholeSha`; `geometryHash`/`layerHashes` unchanged). `node build.js`; commit `fix(engine,support,diag): S4 judge SAMPLING_LOW on the fabrication raster (PO-PERF-4, F-D1)` with `dist/`.

#### Task F2 (S5): Guide stage and per-stage times in the bench

**Files:** Modify `test/bench.js` (`benchLarge` `:401`, `benchDraft` `:784`, `draftPass`), create `docs/perf/speed-round.json`.

- [ ] **Step 1:** Derive per-stage durations from `onProgress` marks (stage name → next mark), including `guides` (`"guides"` → `"accounting"`, `js/engine.js:711-719`) and `resample`/`resample-cached`/`interpret`/`interpret-cached`. Add `--guides none|inset-outline|interior-mark` (default from the preset).
- [ ] **Step 2:** Add `bench large --only user12` (the S2 workload: 4096 × 3084 RGBA alpha.3 scene, `draftProject("a")` settings + `applyFabPitch(0.1)`, inset-outline) and record the alpha.3 baseline (serial, 3 runs) into `docs/perf/speed-round.json` `{baseline: {draft720, fab3600, fab4096}}` with stage tables.
- [ ] **Step 2a:** Re-profile **warm** 720 with guides (E11 method, per stage, `build` and `validate` separately) and correct F.0 #4 and the F.7 S3 estimate from it.
- [ ] **Step 3:** Test `S5 bench reports a guides stage column for bonded guide workloads` (runs `benchDraft` in `--quick` on a 200 px fixture via `require`). Suite green; commit `bench(speed): F2 guide stage and per-stage times (PO-PERF-5)`.

#### Task F3 (S5): Streaming exact area resample and row bands

**Files:** Modify `js/raster.js:278-325`; create `test/oracle_kernels.js` (move today's `R.resample` verbatim as `oracleResample`); `test/run_tests.js` suite `raster — speed round F3 streaming resample (NFR-05)`.

**Interfaces:** `R.resampleRows(pixels, channels, w, h, W, H, method, Y0, Y1) → Uint8Array` of rows `[Y0, Y1)`; `R.resample` = `resampleRows(…, 0, H)`.

- [ ] **Step 1: failing test** — random sizes 1–97 × 1–83, channels 1–4, W/H including identity on one axis and prime ratios; upsampling throws `RESAMPLE_UPSAMPLE` in both (`js/raster.js:283`); `Buffer.compare(R.resample(...), oracleResample(...)) === 0`; band split at 1..9 bands concatenated equals whole. Also `R.resampleRows` exists.
- [ ] **Step 2:** Implement: for each output row Y, accumulate the horizontal sums of only its `vy` source rows into a W·c Float64 accumulator with a small LRU of horizontal-sum rows (each source row feeds ≤ 2 output rows — true only because upsampling is rejected, `js/raster.js:283`); specialise c = 4 and c = 1. Exactness: every term is an integer ≤ 255·w·h < 2^53 (`js/raster.js:300` comment), so the sum order cannot change a bit; `halfUp` unchanged.
- [ ] **Step 3:** Suite and F0 golden green; bench `user12` resample (expect 4.97 s → ≈ 0.4–0.6 s; peak allocation −393 MB). `node build.js`; commit with `dist/`.

#### Task F4 (S5): Faster `windowAny`, fused erode/dilate, fused dilations in `morph`

**Files:** Modify `js/morph.js:79-125`, `js/construct.js:71-78`; oracle copies of `windowAny`, `M.dilate`, `M.erode`, `M.open`, `M.close`, `morph`.

- [ ] **Step 1: failing tests** — exhaustive over all 4 × 4 and 5 × 3 masks, r = 0..4; random 64 × 48 masks with r ≥ w, w < 3, h < 3; `morph` (open → close → fillHoles) byte-equal to the oracle chain for featR 0..9.
- [ ] **Step 2:** Row pass: scan 1-runs and `fill(1, max(0, a−r), min(w, b+r))`. Column pass: head/body/tail loops without per-pixel bounds tests. `M.erode`/`M.dilate`: build the indicator inside the row pass (an `invert` flag), no extra full plane. `morph`: `erode_r → dilate_{r+r'} → erode_{r'}` with `r' = max(1, r−1)` (F.2 proof), scratch buffers reused.
- [ ] **Step 3:** Suite, golden green; bench construct at fab 3600 (expect `windowAny` 6.2 s → ≈ 2 s). Commit with `dist/`.

#### Task F5 (S5): Run-based hole filling and speck removal

**Files:** Modify `js/morph.js:133-200` (add `M.runComponents(mask, w, h, value)`; rewrite `fillHoles`/`removeSpecks`), `js/construct.js:130` (delegate to `SBMorph.runComponents(mask, w, h, 1)`); oracle copies.

- [ ] **Step 1: failing tests** — 200 seeded random masks (sizes 1 × 1 to 120 × 90, densities 0.05–0.95, all-0/all-1): returned counts and mutated masks byte-equal to the oracle; `C.complexityGate` outputs unchanged.
- [ ] **Step 2:** Implement: area = Σ run lengths per root; border touch = run on row 0 or h−1, or `x0 === 0`, or `x1 === w`; fill/kill pass over runs. `M.components` stays (grep callers first).
- [ ] **Step 3:** Suite, golden green; bench (expect components + fillHoles + erode copies 3.6 s → ≈ 0.6 s at fab 3600, −80 MB per call). Commit with `dist/`.

#### Task F6 (S5, S2 stretch): Kuwahara fast path and band kernel

**Files:** Modify `js/raster.js:49-140`; oracle copies of `kuwaharaOnce`/`kuwaharaDomainOnce`.

**Interfaces:** `R.kuwaharaSeeds(src, w, h, bands, r, domain?) → [{s, sat, sat2, cnt?}]` (rolling scan with today's per-row operations; returns the global SAT row at each seed `s = max(0, y0−r)`, all-zero for `s = 0`); `R.kuwaharaRows(srcRows, w, h, r, seed, y0, y1, domain?) → Float32Array` where `srcRows` are source rows `[s, min(h, y1+r))` (`.slice()` copies, with the domain rows and the `cnt` input, `js/raster.js:62`) and the kernel rebuilds SAT rows `s+1 … min(h, y1+r)` from the seed exactly as `kuwaharaOnce` does; `kuwaharaOnce` = one band `[0, h)` with seed 0.

- [ ] **Step 1: failing tests** — random Float32 inputs (integer and non-integer), ties (constant regions), domain masks with holes and edge strips; r = 1..12 plus {16, 17, 25, 50} (the tonal preset's 1.65 mm is ≈ 16–17 px at 0.1 mm, `js/schema.js:402`; the schema allows 5 mm ≈ 50 px, `:515`); passes 1–3; band counts 1..9, bands thinner than r and one-row tail bands: concatenated bands byte-equal the oracle; seeded SAT rows byte-equal the global SAT rows (`sat`, `sat2`, `cnt`).
- [ ] **Step 2:** Implement: inline `boxSum`; interior block (`r ≤ x < w−r`, `r ≤ y < h−r`) with constant `n = (r+1)²` and no clamps; border strips keep the clamped path; same operand order `T[a]−T[b]−T[c]+T[d]`, `s/n`, `s2/n − mean*mean`, strict `<`, quadrants q = 0..3.
- [ ] **Step 3:** Suite, golden green; bench interpret (expect 4.0–4.8 s → ≈ 1.6–2.0 s serial). Commit with `dist/`.

#### Task F7 (S5): Typed corner table in `T.trace`

**Files:** Modify `js/trace.js:35-100`; oracle copy.

- [ ] **Step 1: failing test** — random masks (incl. 1 × 1, checkerboards, full, empty, holes touching the border): loops deep-equal the oracle.
- [ ] **Step 2:** Replace the `outgoing` Map with `Uint8Array((w+1)(h+1))`; scan corners ascending (equivalent to the sorted key snapshot at `:59`, since corners only lose bits); inline `at`.
- [ ] **Step 3:** Suite, golden green; bench trace (expect 2.1 s → ≈ 1.1 s at fab). Commit with `dist/`.

#### Task F8 (S5, S3): Cheaper draft overlays

**Files:** Modify `js/engine.js:121` (`E.maskPolygonsCrop(mask, x0, y0, x1, y1, …)`), `js/engine.js:641-651`. The crop is implemented in `run()` now; F9 moves the change-mask emission into `C.constructLayer`.

- [ ] **Step 1: failing test** — `cleanupReport` (`added`/`removed`/`bridges`) deep-equal the oracle path on the F0 draft fixtures.
- [ ] **Step 1a: failing property test** — random masks and random crops with non-integer `sxUm`/`syUm` (`js/raster.js:372`): cropped polygons deep-equal the uncropped path.
- [ ] **Step 2:** Compute the change mask's bbox in the `diff` pass; trace only the crop and add `(x0, y0)` to the loop points **in pixel space before scaling**, so `fromPixelLoops` still rounds `Math.round(p·sx + ox)` on the same `p` (`js/geom.js:471`); never fold `x0·sx` into `ox` in µm (different rounding). Row-major corner order is preserved inside a crop.
- [ ] **Step 3:** Suite, golden green; bench draft overlays (expect 0.57 s → ≈ 0.15 s at 720). Commit with `dist/`. **Phase A gate:** re-profile `user12` serial; record in `speed-round.json` `phaseA` (expect ≈ 11–13 s).

#### Task F9 (S1): Generator pipeline, kernels and the sync driver

**Files:** Modify `js/engine.js:517-752`, `js/construct.js:91-117`, `js/material.js:234-275`, `js/support.js:193-262`, `:319-360`, `js/guides.js:73-168`.

**Interfaces (all pure, plain data or typed arrays in and out):**
- `C.constructLayer(k, {mask, W, H, px, bonded, wantChange}) → {final, report, bridges?, change?}` (connected runs `SBIslands.resolve` inside, per layer).
- `M.traceLayer(mask, k, W, H) → {any, base, loops}`; `M.convertLayer(t, k, ctx) → MaterialLayer` (`fromPixelLoops`, `union`, `normalize`, frame, holes, `buildLayer`); bonded uses one fused kernel; connected keeps `smoothStack` as a serial step between the two batches.
- `S.supportPair(lo, up, k, cfg) → {U, items, pairs: [[i, j, area]…] (ordered), identical, diagnostics}` where `diagnostics` is the pair's raw, un-aggregated per-part list in today's order (`SUPPORT_NARROW`, `FEATURE_MARGINAL`, `BOND_UNSUPPORTED`, `IDENTICAL_LAYERS`, `js/support.js:240-265`); the serial fold keeps `BOND_EMPTY_UNDER` before the pair loop (`:203-208`), computes `reach[k]`, `edges`, `perLayer`, concatenates and calls `D.aggregate` **once** over the whole list (`:269`).
- `S.featureLayer(L, k, cfg) → diagnostics[]` (raw, un-aggregated); `featureChecks` = head + `flatMap` + one aggregate (`:364`).
- `SBGuides.buildPair(k, lower, upper, P, dOpts) → {paths, labels, omitted, diagnostics}`, `SBGuides.validatePair(k, lower, upper, paths, P, dOpts) → diagnostics[]` (added to the frozen export; `build`/`validate` become folds).
- `E.TASKS` (frozen name → kernel), `function* runSteps(req, head, step, fail, cache, overlays)`, `E.generate` (sync driver), `E.generateAsync(req, {exec, …})` where `exec.map(kind, items, {transfer, estBytes}) → Promise<results[]>` in item order, settling **all** items before resolving or rejecting.
- `E.request(…, {draftCapPx})` and `E.rasterPlan(…, draftCapPx)` (F-D5; default = today's cap, so no output changes here).
- Errors: when several items throw, the driver raises the lowest `(phase, item index)` error as `codedError(e)` verbatim (F.3); a fused bonded trace+convert item tags its error with phase `trace` or `convert`, so a trace error in layer 5 still beats a convert error in layer 2, as in `fromMasks` today.

- [ ] **Step 1: failing tests** — `E.TASKS` names; each split function deep-equals its pre-split wrapper on the F0 fixtures; an in-process `exec` that runs items in reverse order (and `structuredClone(args, {transfer})`, so transferred buffers are really detached on the caller side) gives the golden digests; injected faults in items 5 and 2 raise item 2's code; a trace fault in layer 5 and a convert fault in layer 2 raise layer 5's trace code; the sync-driver **immutability mode** (deep-freeze plain inputs, checksum typed-array inputs before/after each item) passes on the whole corpus.
- [ ] **Step 2:** Implement the split (move code, never rewrite maths); old exported names stay as sync wrappers.
- [ ] **Step 3:** Full suite + F0 golden green (whole-response equal). Commit with `dist/`.

#### Task F10 (S1): Minimal G4.0 and worker-list hygiene

**Files:** Modify `sw.js:24-64`, `js/app.js:1820-1830` (update prompt), `index.html` (`js/pool.js` before `js/app.js`), `test/run_tests.js:267-299`; create **stub** `js/worker.js` (only `WORKER_MODULES`) and `js/pool.js` (empty `SBPool` IIFE), because `build.js:37-39` reads every `<script src>` and `sw.js:69` `cache.addAll(SHELL)` rejects on a 404; F11 fills them in.

- [ ] **Step 1: failing tests** — `DEP-02 sw.js has no unconditional skipWaiting in install`; `build: SHELL == index.html scripts + js/worker.js`; `build: worker WORKER_MODULES == test/modules.js`; `build: pool.js is a DOM module (not in the Node list)`.
- [ ] **Step 2:** Remove `self.skipWaiting()` from install; `message {type: "skipWaiting"}` handler; app shows "Update available — reload" only when nothing is unsaved and no export or fabrication is in flight (F-D3). Add the files to `SHELL`.
- [ ] **Step 3:** Suite green; `node build.js`; commit with `dist/`.

#### Task F11 (S1): Coordinator worker, `SBPool`, handshake, progress, `acceptResult`

**Files:** Create `js/worker.js`, `js/pool.js`, `test/node_worker_shim.js`; Modify `js/diag.js` (`SBDiag.acceptResult`).

**Protocol:** main → coord: `source {sampleHash, pixels, alpha, w, h, channels}` (a transferred **copy**, once per `sampleHash`), `generate {req minus pixels, sampleHash, w, h, channels, overlays, draftCapPx, runId}` (pixels inline when `sampleHash` is null), `cancel {runId}`, `ports {helperId, port}` (re-brokers helper ports after any respawn); coord → main: `hello {engineVersion, appVersion, modulesHash}`, `ack {runId}` (start of work), `progress {runId, stage, frac, sub}` (≤ 10 Hz), `result {runId, response}`, `canceled {runId}`, `error {runId, code, message}`, `killHelper {helperId}` (main terminates and respawns a stuck helper); helper → coord: `hello {modulesHash}` before any item. `runId` is a unique monotonic counter on main. `SBPool` itself acknowledges a submit to the UI on main within 100 ms (NFR-02), since the coordinator cannot answer while inside a serial segment. The coordinator owns K1/K2 (`run.draftCache` moves into it), runs one job at a time (F.3), and rebuilds `normalizedSource` from the stored source only after the `SOURCE_MISMATCH` check (F.3).

- [ ] **Step 1: failing tests** (Node, through the shim) — round trip equals the sync digest on the F0 non-slow fixtures; `§9.3 engineVersion mismatch rejected` (both directions); helper with a different `modulesHash` refused and its items run inline; `§9.3 progress messages precede done` and are monotone; `NFR-02 ack before work`; `SOURCE_MISMATCH` when a `generate` names another `sampleHash`/size, and a `setSource` racing a queued `generate` never pairs it with the new pixels; null `sampleHash` → inline pixels; `acceptResult` drops a different `runId`, `gen`, `sampleHash`, `overlays` or `deviceClass`; `.code` survives; response frozen after receipt; after each pooled run the stored source, `cache.k1` and `cache.k2` have non-zero `byteLength` and the next cache-hit run equals the serial digest.
- [ ] **Step 2:** Implement; mismatch → terminate, one respawn (same URL, no `?v=` — page and worker already come from one cache version after F10; `sw.js:98` `caches.match` has no `ignoreSearch`), then fallback (F16) plus "Reload to update". Measure the **whole receipt path** of the largest fabrication response on main (deserialise + `deepFreeze` + `setSnapshot`, and separately the preview render, which counts toward the F.7 long-task rule); build the `Int32Array` polygon codec only if the receipt path exceeds 50 ms (decision recorded). The codec, if built, is used for the main hop only and decodes to plain Arrays (`js/guides.js:151` filters with `Array.isArray`; `js/util.js:97` throws on typed arrays) and restores `validatedLayers === snapshot.layers` (`js/engine.js:744-751`).
- [ ] **Step 3:** Suite green; commit with `dist/`. **Phase B gate:** fabrication runs in the coordinator; record main-thread longest task with the long-task recorder (`PerformanceObserver('longtask')`) that this task adds to `js/pool.js`/`js/app.js` and F16a reuses.

#### Task F12 (S1): Adversarial executor and pool-size equality

**Files:** Modify `test/run_tests.js` (suite `engine — speed round F12 pool equality (NFR-05)`).

- [ ] **Step 1:** In-process `exec` that calls `structuredClone(args, {transfer})` on the declared transferables (so the coordinator's copies are detached, as in a real post), clones results, and completes items in seeded random order with random delays; 20 seeds over the F0 corpus; digests equal golden and `deepEqualStrict` equals the sync response. A test-only `bandRows` override forces many bands in every run (bands thinner than r, one-row tail bands, domain `cnt` rows), and the driver asserts every Kuwahara slice is exactly `[max(0, y0−r), min(h, y1+r)+1]` SAT rows.
- [ ] **Step 2:** Real pool (shim) helper counts P = 0, 1, 2, 3, 8: `NFR-05 worker pool hashes equal for pool sizes 1, 2, N` plus whole-response equality. Through real workers: a delayed low-index item with a fast-failing high-index item raises the low index's error; a helper killed mid-item yields the serial result (item re-run inline, no error surfaced).
- [ ] **Step 3:** Commit.

*Landed note (F12):* the `bandRows` override and the Kuwahara slice assertion of Step 1 need the resample/Kuwahara band yield points, which F13 creates (until then Kuwahara runs serially inside `runSteps`, and F12 ships no engine change). They move to F13 Step 1; F13 runs them through F12's `makeAdvExec` (seeded order, transfers, cloned results), and the F6 seeded-row byte-equality test keeps covering the band kernel meanwhile.

#### Task F13 (S1, S2): Helper pool, scheduling, memory gate, band kernels

**Files:** Modify `js/worker.js`, `js/pool.js`, `js/engine.js` (yield points).

- [ ] **Step 1: failing tests** — (carried from F12 Step 1) a test-only `bandRows` override forces many bands in every run of the F12 adversarial executor (bands thinner than r, one-row tail bands, domain `cnt` rows) and the driver asserts every Kuwahara slice is exactly `[max(0, y0−r), min(h, y1+r)+1]` SAT rows; memory gate at 64 MiB serialises and stays identical; an item larger than the budget is still admitted alone; budget with `deviceMemory` absent = 512 MiB; LPT order changes dispatch only (digests equal); Kuwahara and resample bands through the pool byte-equal serial; transferring a `subarray` or a cache-owned buffer throws in `exec`.
- [ ] **Step 2:** Main creates **P** helpers (F.1) and a `MessageChannel` per helper (no nested workers). Yield points in order: resample bands (fab only; each band receives a `.slice()` of its source rows, counted in `estBytes`), Kuwahara bands per pass (seed rows from the coordinator's rolling scan, F.3), `constructLayer` k = 1..N−1 (only the per-item copies the coordinator does not read again are transferred; `masks[k]` stays with the coordinator while overlays need it), overlays, `traceLayer`/`convertLayer`, `featureLayer`, `supportPair`, `buildPair` then `validatePair`, layer hashes. Serial: thresholds/bands, `assignParts`, `annotate`, accounting, `geometryHash`. Dispatch largest first (cost = `addedPx`); admission by the F.3 `estBytes` ledger (bonded layer ≈ 5·W·H after F4/F5).
- [ ] **Step 3:** Suite green; bench `user12 --pool 8` and record in `speed-round.json` `phaseC`. Commit with `dist/`.

*Landed note (F13):* helpers, ports and the per-helper `modulesHash` admission already landed in F11; F13 adds the raster yield points (`resampleRows` at fabrication, per band and plane, from `R.resampleSpan`/`R.resampleBand`; `kuwaharaRows` per pass from the rolling seed scan), one row band per admitted helper (`generateAsync` option `bands`; the sync driver keeps the whole-image kernels; test-only `bandRows` override, `TEST_HOOKS`), LPT dispatch (`SBEngine.lptOrder`; construct/trace cost = the layer's mask pixel count from one histogram pass over `added`, layer 0 = 0; band cost = rows), and the `estBytes` ledger (`SBEngine.memoryLedger`, `SBEngine.memoryBudget` = `SBPool.memoryBudget`; base = the coordinator's resident typed arrays at the yield + `mainBytes` sent with `generate`; every item counts ≥ 64 KiB; one item always admitted). Transfers are checked by `SBEngine.checkTransfers` in `generateAsync` and again in the coordinator's `exec.map`; the coordinator still **clones** item arguments to helpers (a lost helper's item must re-run inline on the coordinator's copy, F.3) and helpers **transfer** their result buffers back. The F12 adversarial executor now runs every seed with a seeded `bandRows` (1–9) and asserts each Kuwahara slice is SAT rows `[max(0, y0−r), min(h, y1+r)+1]`. The F0 corpus fabricates at source size, so the banded resample is covered by three downsampling variants (`fabPitchMM` raised) in the F13 suite. **Phase gate (S2) not measured in this task:** the `user12 --pool 8` bench is the long large-image run and was not executed here; `speed-round.json` `phaseC` is left for F18 (or a separate measurement run).

#### Task F14 (S1): Cancellation (AT-15) and watchdog

- [ ] **Step 1: failing tests** — `AT-15 stale response discarded`; overlay toggle and a same-revision double submit never show the older run; superseded draft returns `canceled` (the coordinator waits for it before starting the next run) and the next draft reports `resample-cached`; a canceled run leaves K1/K2 unchanged; stuck coordinator is terminated after 300 ms and respawned in < 500 ms (module parse, source re-post and `ports` re-brokering included), next draft correct (cold); the coordinator killed at each yield index → the run is resubmitted (never shown as an error) and the final response equals the sync digest; helper results with an old `runId` dropped; `AT-15 cancel during export keeps last revision and source`.
- [ ] **Step 2:** Cancel flag checked at every `step()`, before every dispatch and every few rows inside the long serial coordinator kernels (masks, SAT scan, complexity gate); stuck helpers reported with `killHelper` and respawned from a warm spare (new `hello` + `modulesHash` check, F.3); watchdog on main.
- [ ] **Step 3:** Commit with `dist/`.

*Landed note (F14):* `SBEngine.Canceled` is exported; both drivers poll `isCanceled` at every `step()` and, through a `poll` argument, every 64 rows of `SBHeight.cumulativeMasks`, `SBRaster.kuwahara`/`kuwaharaSeeds` and per layer in `SBConstruct.complexityGate` (`opts.poll`) — outputs unchanged (byte-equality tests); `generateAsync` also checks before every dispatch. A coordinator in a serial kernel cannot receive messages, so the cancel also travels on a **shared flag** (`Int32Array` on a `SharedArrayBuffer`, slot 0 = runs below it superseded, slot 1 = the canceled runId, `Atomics.load`), posted as `cancelFlag` where the page can share memory (Node; a cross-origin-isolated page). Without it (ordinary `file://`/http pages) a non-yielding kernel is stopped by the watchdog only. A cancel aborts the coordinator's batch at once: pending inline items are skipped, helper items in flight are abandoned (their late `itemResult`, carrying the old `runId`, is dropped) and a helper still busy after `helperStuckMs` (300 ms) is reported with `killHelper {reason: "stuck"}` and replaced from a **warm spare helper**. Main's watchdog (`watchdogMs` 300) terminates a coordinator that has not answered a cancel or a supersede; the run settles `canceled` (`watchdog: true`), a **warm spare coordinator** (booted, hello checked) is promoted (else a cold spawn, ≈ 300 ms in Node), the source is re-posted, the ports re-brokered to the **same** helpers and the other runs resubmitted. A crashed coordinator is handled the same way (runs resubmitted, at most twice each; a third crash is the fallback) instead of rejecting with `POOL_DOWN`. `pool.health()` reports spawns, watchdog kills, crashes, resubmits, the last respawn time and the spares; coordinator stats add `stage`, `sampleHash`, `k1Key`, `k2Key`, `staleDropped`, `stuckKilled`, `sharedCancel`. The `?bench=cancel` browser measurement stays with F16a.

#### Task F15 (S1): App wiring and progress UI

**Files:** Modify `js/app.js:192-245`, `:925-994`; `css/`; `test/run_tests.js:4559-4563`, `:5045`, `:5260`, `:5331`, `:5587`.

- [ ] **Step 1: failing tests** — `regenerate`/`fabReview` call `SBPool.submit(` and gate on `SBDiag.acceptResult`; the literal `SBEngine.generate(` (the sync driver, the **only** fallback driver — no cooperative third driver), rAF + `setTimeout` and "will not respond" text exist **only** in the fallback branch, which passes `draftCapPx: limits.draftPxFallback`; an edit cancels an in-flight fabrication ("fabrication restarted"); fab Cancel button.
- [ ] **Step 2:** Implement; progress bar + stage label from `progress` (throttled per rAF); `fabMsPerMpx` kept as ETA, re-measured separately for pool and fallback (F17).
- [ ] **Step 3:** Commit with `dist/`.

*Landed note (F15):* `app.js` creates one pool at `init` (`SBPool.create({deviceClass, appVersion: APP_VERSION, onState})`; no `Worker`/`SBPool` or a throwing create is the fallback). `regenerate` and `fabReview` call `pool.submit(SBEngine.request(…))` on the instance (the plan's `SBPool.submit(` is the instance method; the test pins `pool.submit(`), post the source with `pool.setSource(run.src)` (once per `sampleHash`) and take a result only through `SBDiag.acceptResult` plus the revision/source check; the pooled requests keep the default `draftCapPx`. The fallback branch is two functions, `regenerateFallback` and `fabFallback`: the only `SBEngine.generate(` calls, the only `requestAnimationFrame(() => setTimeout(` and the only "will not respond" text, each request with `draftCapPx: SBSchema.limits(dc).draftPxFallback` (new limit, 720 on both device classes; F17 keeps it). A pooled run that rejects with `POOL_UNAVAILABLE` re-runs there. Both drivers share `applyDraft`/`storeFab`. Progress: `#run-progress` (`<progress>` + stage label) painted once per rAF from the pool's `progress`; `#btn-fabcancel` (pooled fabrication only) → "fabrication run canceled"; an edit (`recompute`) or a new draft cancels an in-flight fabrication → "fabrication restarted", re-run by `previewFabrication()` once the edited revision's draft is in; a draft superseded by a fabrication submit re-runs after it. `#pool-notice` and the fabrication note carry the pool's fallback notice. Checked in headless Chromium: pooled draft/fabrication with progress, Cancel and restart over http; `index.html` and `dist/` from `file://` run the fallback with the notice; the demo fabrication `geometryHash` is equal in both modes.

#### Task F16 (S1): `dist/` Blob worker and fallback ladder

**Files:** Modify `build.js:36-39`, `js/pool.js`; uses `test/browser.html` (F16a, G4.8 subset). F16a is done before F16 Step 2's browser checks.

- [ ] **Step 1: failing tests** — `dist` has no `<script src=`; each module text appears once (`data-sbmod`) and one `text/sb-worker` block; forced `Worker` failure, both a constructor throw **and** an async `error`/`messageerror` event or a missing `hello` within the timeout → the F15 serial fallback with the "reduced responsiveness" notice and identical digests at the same pinned `draftCapPx`; at the mode's own caps, 720 vs the pooled cap give the expected different draft `geometryHash` (F-D5).
- [ ] **Step 2:** Ladder: URL worker (http(s)) → Blob from inlined texts + `worker.js` (`importScripts` guarded by `typeof SB_INLINED`) → serial fallback; a rung counts as up only after `hello` within the timeout. `chromium --headless=new --dump-dom file://…test/browser.html?run` (the harness from F16a) and Firefox: round trip, cancel, pooled = serial digests in the same browser on 5 fixtures; equality with Node only for hashes confirmed free of `Math.hypot`/trig inputs (F.4 #4).
- [ ] **Step 3:** Commit with `dist/`.

*Landed note (F16):* `build.js` inlines every page module once as `<script data-sbmod="<name>">` (name as `WORKER_MODULES` spells it, framed by one newline each side) and `js/worker.js` once as an inert `<script type="text/sb-worker">`; it refuses a module text containing `<script`/`</script`. `SBPool.ladder({protocol, inlined})` gives the rungs: `["url"]` for index.html over http(s), `["blob"]` for the bundle on any scheme (the URL rung is skipped there: the bundle has no `js/` beside it and the page's `modulesHash` comes from the inlined texts), `[]` for file:// index.html (straight to the F15 fallback). `SBPool.inlinedSources(document)` reads the texts back; `SBPool.blobSource(inlined)` defines `self.SB_INLINED` and evaluates worker.js as its own script; worker.js then `importScripts` each module from a `blob:` URL it makes (so every module keeps its own `"use strict"` prologue and global bindings, as with the files). One Blob URL per pool serves the coordinator, helpers and spares. A rung is retried once after an error/messageerror/missing hello and left at once on a constructor throw; it counts as up only after `hello`; `pool.rung` names it. Node runs the Blob rung through `test/node_worker_shim.js` `spawnSource` (blob: URLs resolved in the thread). Browser checks (ad hoc file:// page = the built bundle plus a probe; the committed 5-fixture harness `test/browser.html?run` is F16a's): Chromium 152 headless and Firefox 155 headless both boot the Blob rung from file://, pooled = serial whole response on 5 synthetic fixtures (draft and fabrication), cancel settles `canceled` in ≈ 50 ms without the watchdog; the five `geometryHash`es are equal in Chromium, Firefox and Node. F.4 #4: `Math.hypot` (`js/trace.js` `pointSegDist`, `js/util.js` `loopLength`) is reached only from `SBEngine.legacyRun`, which nothing in `js/` calls, so no generate hash takes it as input (pinned by a test). index.html over http still comes up on the URL rung; file:// index.html shows the fallback notice. F-D5: at today's caps the pooled cap equals 720, so the "different hash" half is asserted with a pinned raised cap (1024) until F17 raises `draftPxCap`; the test switches to the real pooled cap automatically once it differs.

#### Task F16a (S1–S3): Browser harness and in-app bench modes

**Files:** Create `test/browser.html`; Modify `js/app.js` (`?bench=` modes, inert unless the query is present), `test/run_tests.js`.

- [ ] **Step 1: failing tests** — source checks that `?bench=fab|draft|cancel` and `test/browser.html?run` exist and emit a JSON record with p50/p95 and the long-task maximum.
- [ ] **Step 2:** Implement `?bench=fab` (S2 workload, 1 warm + 5), `?bench=draft` (E4 method: both families, sheets 8 ↔ 7, ≥ 15 warm), `?bench=cancel` (20 cancels, latency to `canceled`/respawn), each with the F11 long-task recorder, p95 and a JSON download; `test/browser.html?run` loads the modules, runs the 5 F16 fixtures through pool and serial and prints the digests into the DOM.
- [ ] **Step 3:** Suite green; `node build.js`; commit with `dist/`.

*Landed note (F16a):* `js/app.js` reads `?bench=` once (`BENCH`, only `fab|draft|cancel`; anything else leaves the app untouched) and, after `startPool()`, `startBench` adds a panel (`#bench-panel`: Run, Download JSON, `#bench-status`, `#bench-result`; `<html data-bench="running|done|error">`; `&download` saves on completion). The drivers use the app's own paths: `benchFab` = `previewFabrication()` timed from the click to the painted result (1 warm + 5), `benchDraft` = the sheets edit (`setLegacy("nSheets")`, 8 ↔ 7, revision changing) + `regenerate()` without the 300 ms debounce, timed to the painted draft through a hook at the end of `applyDraft` (`benchDraftHook`; 3 warm-up + 15 per family, realistic and busy; `families.<f>.p95Ms` is the S3 rule's number), `benchCancel` = 20 × (`previewFabrication()`, wait 50/150/300/600/1000 ms, `cancelFab("user")`), latency to the settled run plus watchdog and respawn from `pool.health()` (no pool: recorded `unsupported`). Every record: environment (versions, UA, cores, `deviceMemory`, pool mode/rung/helpers, `draftCapPx`), nearest-rank p50/p95/max of the measured runs, per-run rows, `longTaskMaxMs` from `SBPool.longTasks()` (Chromium only; `longTasks.supported`), pool health and (fab) coordinator stats. Sources: the seeded synthetic art (`&src=realistic|busy`, a byte-equal copy of `F.heightMap`/`F.busyHeightMap` as `bench.js draftSource` RGBA, 4096 × 3084 unless `&w=&h=`; tested equal) or `&src=loaded` (the S2 photo or `tools/alpha3_scene.js` PNG, after Run); the bench project equals `bench.js user12Project` (fab, cancel) or `draftProject("a")` (draft) (tested). The pure helpers sit in one marked block that the suite evaluates alone. `test/browser.html?run` loads the 24 modules and `pool.js` by `<script src>` and `test/browser_harness.js` (`SBHarness`), which reads the module texts and the corpus by XHR (file:// needs Chromium `--allow-file-access-from-files` / Firefox `security.fileuri.strict_origin_policy=false`, or http from the repo root), evaluates `test/pool_corpus.js` with a minimal CommonJS loader, runs the 5 F16 fixtures serially and on the Blob rung, and prints digests, pool = serial (`deepEqualStrict`), serial = Node golden, p50/p95, the long-task maximum of the pooled runs and a cancel round trip (`<html data-harness="pass|fail|error">`, `window.SB_HARNESS_RESULT`). The suite runs `SBHarness.run` in Node on a shim Blob rung. `--dump-dom` returns before the async run ends; drive it over the DevTools protocol and poll `data-harness`. Smoke (Chromium 152 headless, file://, i7 16 threads; not measurements): harness PASS (5/5 equal to serial and golden, cancel ≈ 11 ms); dist `?bench=fab|draft|cancel` on the Blob rung and index.html `?bench=fab` on the fallback complete; index.html `?bench=cancel` records unsupported. The real measurements stay with F17 (draft) and F18 (fab).

#### Task F17 (S3): Draft budget re-measured and raised

**Files:** Modify `js/schema.js:163`, `:395`, `:413`; `docs/perf/draft-budget.json`, `docs/perf/DRAFT.md`; `test/run_tests.js:5471` (PO-PREVIEW-1 check).

- [ ] **Step 1:** `node test/bench.js draft --draft-sweep 1280,1536,1792,2000 --pool 8 --record` plus the in-app `?bench` in Chromium and Firefox on the i7 and Chromium on the M5: warm p95 (≥ 15 warm runs, K1/K2 hit, the E4 warm edit: sheets 8 ↔ 7 with the revision changing, realistic **and** busy families), K2-miss p95 (smoothing edit), cold-after-source, preview render time (`preview.js`), parts/vertices and cap hits per size.
- [ ] **Step 2:** Apply the F.7 rule; set `DRAFT_BUDGET.desktopDraftPx` and both preset `draftPx` (schema ceiling 2000, `js/schema.js:562`); `limits.draftPxFallback: 720`, passed by the fallback branch as `draftCapPx` (F-D5); mobile 720. Saved projects are **not** migrated silently (`draftPx` is user-visible as legacy `procRes`, `js/schema.js:748-749`, `:773-774`): a project whose `draftPx` is 720 shows a one-time info offering the new default, applied only on the user's click (Q2). The F0 corpus pins `draftPx`, so its golden is unchanged.
- [ ] **Step 3:** Update the PO-PREVIEW-1 test (`test/run_tests.js:5471`) keeping the E4 rule (both families); suite green; `node build.js`; commit with `dist/`.

#### Task F18 (S2, S5): Final measurement, records and checkpoint docs

- [ ] **Step 1:** `bench large --only user12 --pool 0,1,8` (3 runs each), fab 3600 and draft 720/decided size; KI-CONN-PERF connected rows with the pool; KI-B1 B1 re-run; guide stage at draft and fabrication. Write `docs/perf/speed-round.json` `final` and the `large-image.json` rows.
- [ ] **Step 1a:** Record the F.3 `estBytes` ledger peak (browser) and process RSS + `arrayBuffers` (Node) at 12 Mpx and 25 Mpx; update F-D6 with the numbers.
- [ ] **Step 2:** If `user12` pooled p95 > 10 s or a single serial stage > 1 s remains on the critical path, profile and fix it in this task (output-identical, oracle-gated) before closing; otherwise record the stretch status. Candidates already identified: all N cumulative masks in one pass over `added` (616 ms serial, `js/height.js:60-68`); per-layer complexity estimation; one item per guide pair (`buildPair` + `validatePair`, diagnostics concatenated per pair); helper-side layer caches with affinity or the `Int32Array` codec on internal hops (MaterialLayer clone cost coordinator ↔ helper).
- [ ] **Step 3:** `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md` (worker architecture), `docs/QA_CHECKLIST.md` (manual: page responsive during fab, cancel, file:// dist). Suite green; commit.

*Landed note (F18):* the release is `v2.0.0-alpha.4` (`APP_VERSION`, `sw.js` `VERSION`, `WORKER_APP_VERSION`; engine version unchanged, Q10). `docs/CHANGELOG.md` has the alpha.4 section with a known-gaps table, `docs/ARCHITECTURE.md` the worker architecture, `docs/QA_CHECKLIST.md` the manual pool checks. Step 1 tooling: `node test/bench.js large --only user12 --pool 0,1,8 [--rows …,fab25] [--record]` (`benchUser12Final`): per row and pool size a fresh pool (0 = the sync driver), 1 warm-up + 3 runs with a fresh source identity each (no cache), p50/p95, stage p50s, `geometryHash` (`equal` across pool sizes, a run that differs throws), Node process RSS / `arrayBuffers` / heap peaks sampled every 25 ms and at every mark, and, pooled, the coordinator stats (`estBytes` ledger peak, budget, items on helpers/inline); `fab25` (5770 × 4330 alpha.3 scene at 433 mm → 24.98 Mpx) is the Step 1a memory row; `--record` writes `speed-round.json` `final`. **Not run in this commit** (the run instructions excluded the long large-image benchmark): `final.status` is `"pending"` with the command, the interim evidence (Phase A serial 12.0 s p50 / RSS 588 MB; Phase B pooled 8.8 s single run; F17 realistic 12 Mpx pool 8 8.5 s vs pool 0 19.6 s p50) and the S2 rule; F-D6's numbers, the Chromium `?bench=fab` figure and Step 2 (applied only if the measured pooled p95 > 10 s or a serial stage > 1 s is on the critical path) follow that run. KI-B1 re-run (`bench geom`, 15 runs, load ≈ 3–6): B1 p95 1990 ms against 2 s — inside run-to-run variance, no normalize change in this round, so `TRACKED.B1` stays (G4.4). KI-CONN-PERF: reported only, not re-run (long large-image rows).

### F.7 Measurement plan

| what | command / where | metric | runs | pass rule |
|---|---|---|---|---|
| S2 fabrication, user case | `node test/bench.js large --only user12 --pool 8` (Node) and `?bench=fab` in Chromium on the i7 | wall p50/p95, per-stage, memory: Node process RSS + `arrayBuffers`, browser `estBytes` ledger peak (per-worker RSS is not measurable: Chromium workers share the renderer, `measureUserAgentSpecificMemory` needs cross-origin isolation) | 1 warm + 5 | p95 ≤ 10 s Chromium (stretch ≈ 5 s); memory inside F.3 budget |
| S2 responsiveness | Chromium Performance panel / `PerformanceObserver('longtask')` in `?bench=fab` (F16a) | longest main-thread task during a fab run, incl. result receipt, freeze, `setSnapshot` and the preview render | 5 | ≤ 100 ms; `SBPool` ack ≤ 100 ms |
| S1 equality | F0, F12, F16 tests | digests | every commit | identical |
| S1 cancel | F14 tests + `?bench=cancel` | cancel → `canceled`/respawn | 20 | ≤ 500 ms (NFR-02) |
| S3 draft | `bench draft --draft-sweep … --pool 8` + `?bench=draft` (Chromium, Firefox on i7; Chromium on M5) | warm p95, K2-miss p95, cold p95, preview render ms | ≥ 15 warm | largest size with warm p95 ≤ 2.5 s (i7, both browsers) and ≤ 3.0 s (M5) on **both** the realistic and busy families with the E4 warm edit; smaller decision wins; reject a size that hits a complexity cap on the alpha.3 scene |
| S5 guides and stages | `bench large`/`bench draft` stage columns | ms per stage incl. `guides` | as above | recorded at draft and fab, serial and pooled |
| Phase deltas | `speed-round.json` `baseline`, `phaseA`, `phaseC`, `final` | stage tables | 3 | recorded |
| KI-CONN-PERF, KI-B1 | `bench large --caps desktop` connected rows; `bench geom` | p95 | as today | reported only |

Expected (from the profile; to be replaced by measurements): fab 12 Mpx ≈ 28.1 s → ≈ 11–13 s after Phase A (serial) → pooled ≈ **4.5–6.5 s in Node, ≈ 5.5–8 s in Chromium** (Chromium ran ≈ 1.2× Node, F.0 #1). Parallel parts: resample ≈ 0.2–0.5, interpret ≈ 0.8–2.2 depending on Kuwahara banding, construct ≈ 0.9–1.2, trace ≈ 0.35, validate + features ≈ 0.2–0.3, guides ≈ 0.35 (sum 2.8–4.95); plus serial coordinator stages not in that sum — masks ≈ 0.6, complexity gate, holes/repairs/parts, luminance/thresholds/bands, the seed SAT scans — and MaterialLayer structured-clone hops coordinator ↔ helper. ≤ 10 s is realistic; the 5 s stretch is unlikely without the F18 candidates. **S3 estimate, derived from the F2 warm-720 profile** (bench realistic art, Node, warm p50 per stage: guides 1540, construct 670, trace 487, features 428, hashes 125, validate 93, masks + interpret-cached 40, the rest < 20 ms; total 3533 ms). Scaling: pixel-bound stages (construct incl. overlays, masks, interpret) × the pixel ratio; vertex-bound stages (trace, validate, features, guides, hashes) × the edge ratio (√ pixels: 1280 ≈ 1.78×, 1536 ≈ 2.13×, 2000 ≈ 2.78×). Serial: 1280 ≈ 2.3 + 4.7 ≈ 7 s, 1536 ≈ 3.2 + 5.7 ≈ 9 s, 2000 ≈ 5.5 + 7.4 ≈ 13 s. Pooled (P = 7 per-layer/per-pair items, imbalance ≈ 1.5×, the largest guide pair as the floor, ≈ 0.3 s serial coordinator work and clone hops): **1280 ≈ 1.8–2.2 s, 1536 ≈ 2.2–2.8 s, 2000 ≈ 3.1–4 s** in Node, ×≈ 1.2 in Chromium. The likely decision is therefore **1280**, 1536 only if F3–F8 cut guides/features/trace (the guide stage alone is ≈ 44 % of the warm draft), and 2000 does not meet the 2.5 s rule without further guide work (F18 candidate: one item per guide pair). F17 measures; this estimate does not decide.

### F.8 Risks

| # | Risk | Mitigation |
|---|---|---|
| F-R1 | A faster kernel changes a bit | Oracle per kernel (F3–F8), F0 golden, each kernel its own commit; Kuwahara keeps operand order and global SAT slices |
| F-R2 | Hidden module state or completion-order folds break equality in some orders only | F0 audit; folds in the generator body; F12 adversarial executor, 20 seeds |
| F-R3 | Memory multiplies with workers (7 × 12 Mpx layers; source copies) | `estBytes` gate (F13), F5 removes 8 B/px `components` buffers, only coordinator-unreferenced buffers transferred (F.3), seeded SAT instead of copied slices, source posted once per `sampleHash` |
| F-R4 | Version skew page/coordinator/helpers via the SW cache (R7) | F10 before F11; `hello` with `engineVersion` + `appVersion` + build-time `modulesHash`, checked for the coordinator and for every helper spawn/respawn |
| F-R5 | Blob worker refused on file:// or by CSP | Ladder to the serial fallback (F15/F16), rung up only on `hello`; headless check in Chromium and Firefox |
| F-R6 | Cancel latency inside a long serial kernel in the coordinator | Cancel polled every few rows inside masks, SAT scan and complexity gate; everything else > 300 ms is banded; watchdog terminate as last resort (next draft cold) |
| F-R12 | Pool-only divergence paths (runtime-dependent draft cap, stale source, detached buffers, completion-order errors, concurrent runs, mutated arguments) | F.3 pool rules, each with a test in F9/F11–F14/F16 |
| F-R13 | Working set above NFR-04 at fabrication scale | One `estBytes` ledger; F3 and seeded SAT remove the largest terms; F-D6 records the measured peak |
| F-R7 | Structured-clone cost of 356k-vertex responses on main | Measured in F11; `Int32Array` codec if > 50 ms |
| F-R8 | Finer draft trips caps or slows preview rendering | F17 records cap hits and render ms; rule counts them |
| F-R9 | app.js source-pinning tests churn | Fallback branch keeps the pinned shape; tests extended, not loosened |
| F-R10 | Refactoring the frozen `SBGuides` and multi-layer APIs | Move code only; old names kept as sync wrappers; F0 golden |
| F-R11 | M5 E-cores slow the critical layer | LPT ordering; M5 measured in F17/F18 before claiming S2/S3 there |

### F.9 Open questions (defaults apply unless unsafe)

1. **Pull minimal G4.0 into this round?** Default **yes** (R7 prerequisite; F-D3).
2. **Draft ceiling and saved projects.** Default: top out at **2000** (schema `draftPx` 64–2000, no schema change); saved projects are not migrated silently — a project with `draftPx` 720 gets a one-time info offering the new default, applied on click.
3. **Pool cap and memory budget.** Default: cap 8 desktop / 4 mobile; admission budget `min(1 GiB, deviceMemory·128 MiB)` when `deviceMemory` is finite, else 512 MiB, desktop; 192 MiB mobile; one ledger for coordinator + helpers + main (F-D6).
4. **Cancel semantics.** Default: cooperative first, `terminate()` after 300 ms (F-D2).
5. **`DRAFT_COARSER` placement.** Default: details list only, with a one-line hint on the draft badge; wording "Draft is coarser than fabrication; detail is checked at the fabrication pitch".
6. **An edit during fabrication.** Default: cancels it and shows "fabrication restarted"; Export waits for an in-flight fabrication.
7. **Packaging in the worker.** Default **later** (F-D4).
8. **Kuwahara banding across workers.** Default: implemented (F6/F13) because interpret is the post-pool critical path; switch off by config if F12 ever disagrees.
9. **Draft budget dependent on runtime pool.** Default **yes** (F-D5), through the explicit `draftCapPx` request field.
10. **Version label.** Default: ship as `v2.0.0-alpha.4` in F18 (APP_VERSION + sw `VERSION`), engine version unchanged.

### F.10 Self-review

- Every S-goal maps to tasks (F.1) and to measured pass rules (F.7). S1 → F9–F16; S2 → F3–F8, F13, F18; S3 → F17; S4 → F1; S5 → F2–F8, F18.
- References re-checked on 2026-10-09 against `b7f1a30`: `js/engine.js:121, 517-545, 553-750, 576-623, 637-654, 697-698, 711-719, 738-740`; `js/morph.js:79, 104-125, 133, 170, 187`; `js/raster.js:49, 61, 97, 113, 140, 157, 212, 278, 300-303`; `js/construct.js:71-84, 91-117, 130, 253, 267`; `js/material.js:234, 249-275`; `js/support.js:51, 211-262, 319-342`; `js/guides.js:52, 73, 148-168`; `js/trace.js:35-59`; `js/height.js:60`; `js/schema.js:156, 163, 395, 413, 562`; `js/diag.js:87`; `js/app.js:90, 192-245, 959-994, 1544, 1820-1830`; `sw.js:19, 24, 64`; `build.js:37-39`; `test/run_tests.js:267-299, 1763-1767, 4559, 5045, 5260, 5331, 5471, 5587`; `test/bench.js:401, 736, 784`. Corrections versus the drafts: `SBDiag.acceptResult` is new; `T.trace` order is sorted, not insertion; `runComponents` needs a `value` parameter; the plan's G4.0 cites `sw.js:46-48`, the line is now `sw.js:64`.
- No placeholder steps: each task names files, interfaces, failing tests, the implementation rule and the gate.

### F.11 Review notes (determinism and feasibility review, 2026-10-09)

Two reviews of this appendix were checked against the tree at `3cc0ede`. Accepted and applied: determinism 1–14 and 15 (narrowed), feasibility 1–18, with the choices below. Rejected or replaced parts:

- **Feasibility 11, "run fabrication on its own coordinator instance":** rejected. A second coordinator duplicates the stored source and the resident set (F-D6) and the helper ports. Replaced by cancel polling inside the long serial coordinator kernels, so cooperative cancel normally lands and keeps K1/K2; after a `terminate()` the next draft is cold by design (F.4 #3 now says so). The other parts of feasibility 11 are applied: `SBPool` acknowledges on main, and the `ports`/`killHelper` messages are added.
- **Determinism 1 / feasibility 14, "re-capture the golden in F17":** not taken. Instead the F0 corpus pins `draftPx` and `draftCapPx` per fixture, so F17 cannot move the golden. "Migrate only projects with no `procRes` edit history" is replaced by an opt-in notice, because edit history is not stored.
- **Determinism 9, "cooperative driver as the fallback":** not taken. The fallback is the sync driver (`SBEngine.generate(` in rAF + `setTimeout`, today's pinned shape, F-R9), which is already in the F12 matrix. The cooperative third driver is removed from F16.
- **Determinism 15:** applied as a narrower claim. Pooled equals serial in the same browser. Browser-vs-Node equality is claimed only for hashes that F16 shows are free of `Math.hypot`/trig inputs. This is not a pool-vs-serial risk.
- **Feasibility 1, "bring the total down to 512 MiB":** not promised. Alpha.3 already exceeds it serially at 12 Mpx. The round shrinks the largest terms, keeps one ledger, and F-D6 records the measured peak.
- **Feasibility 7 fixes** (single-pass masks, per-layer complexity, merged guide items, helper-side caches or codec): kept as F18 candidates, applied only if profiling shows them on the critical path, not mandated up front. The revised estimates are applied to F.7.
- **Feasibility 2** (rolling seeded SAT): accepted. It supersedes stage-pipeline's "copy slices of the global SAT". It is byte-equal by the recurrence `sat[i] = sat[i−W] + row` (`js/raster.js:105-110`), so the band-local-SAT objection does not apply.
- **Verified correct by the reviewers and unchanged:** dilation fusion, typed corner table, resample exactness, no guide cross-pair state, separate cumulative-mask buffers, DOM-free worker modules.


## Appendix G — app fix round (bonded morphology & export hygiene)

**v2.0.0-alpha.4 → v2.0.0-alpha.5 Implementation Plan**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop bonded construction from chopping diagonal necks into corner-touching blocks and from filling diagonal waste, make sub-kerf necks and point contacts blocking, point the neck diagnostics at the neck, remove guide-score stubs, make the review panels workable on art with hundreds of warnings, offer a pitch that avoids a near-1:1 resample, and commit the S7 spike material — then cut v2.0.0-alpha.5.

**Architecture:** Bonded mode gets its own exact Euclidean-disc open/close in `SBMorph` (two vertical-distance sweeps plus two row "reach" sweeps per operation, all integer arithmetic). `SBConstruct.constructLayer` uses it for `bonded` only, so the connected chain and `test/golden/oldrun.json` do not move. The feature checks (`SBSupport.featureLayer`) switch from a square (miter) to an octagonal (Clipper2 `"square"` join) erosion. They gain a kerf-neck erosion and an inter-part point-contact scan (both blocking, the D3 extension), plus a neck locator for regions. `SBGuides.buildPair` drops Rc polygons and rings below a 2 mm extent or the footprint inset. The UI work is pure view-model functions in `SBProof` that `js/app.js` renders. The pitch match is a pure `SBRaster`/`SBEngine` function with one diagnostic rule change.

**Tech Stack:** Plain ES2020 classic-script IIFEs, no npm; `node test/run_tests.js` (vm harness), `node test/bench.js`, `node build.js`; Clipper2 through `SBGeom` (miter/square joins only, no trig, NFR-05).

**Spec:** `docs/SRS_Stacked_Relief.md`; this plan's Global Constraints, Appendices C–F; `docs/ARCHITECTURE.md` D3 (with the G2 extension of 2026-10-09); the product-owner approval of 2026-10-09 recorded in G.0; the root-cause evidence in the session scratchpad `neckrepro/` (paths in G.0).

### G.0 Why this round exists (root-cause investigation, approved by the product owner 2026-10-09)

The user cut the fusion2 deliverable (`spikes/S7/results/fusion2/height_8layer_v2.png`, 8 layers, plywood, 0.1 mm/px fabrication) and reported pinches, filled waste, guide stubs and an unworkable review. The investigation evidence is in the session scratchpad `/tmp/claude-1000/-run-media-geekuser-Storage-WebstormProjects-ShadowBox-Stacked/2e8a9c5f-d6c0-49c6-b1a7-a129d1b164e1/scratchpad/neckrepro/`:
- `t1.js`: the end-to-end reproduction (fabrication generate + files, `out/`).
- `t2.js` / `crops.txt`: stage bisection (open | open+close | final), which shows the chop happens in `openClose`.
- `t3.js`: saddle and 1-px counts.
- `disc.js`: the EDT prototype; `tdisc_unit.js` checks it against brute force.
- `t4.js` / `crops_square_vs_disc.txt`: square vs disc on the six spots.
- `neck_test.js`: the failing tests.
- `fixtures/*.png`: six real 12 × 12 mm crops (120 × 120 px, 8-level gray).
- `tguide.js`: score-ring extents.
- `tperf.js`: EDT 4.0 s vs square 0.35 s per layer.

All references below were re-checked against `43f2c88` (after the speed round).

1. **Square min-feature morphology (G1).**
   - `js/construct.js:79-86` (`morph`) calls `SBMorph.openClose(mask, w, h, r, max(1, r − 1))` (`js/morph.js:178-182`). That is erode → dilate → erode over the clipped (2r+1)² **square** window (`windowAny`, `js/morph.js:108-154`; header `:10-21`).
   - The radius is `featR = max(1, round(minFeatureUm / (2·pMax)))` (`constructPx`, `js/engine.js:471-486`). At 1.5 mm and 0.1 mm/px that gives `featR` = 8 and a close radius of 7.
   - **What the square removes and fills:**
     - It erodes a 45° neck of perpendicular width w whenever w < 2·8·√2 px ≈ 2.3 mm. Opening then rebuilds the two sides as blocks that touch only at corners, leaving 0.1–0.6 mm pinches on the six crops.
     - The close fills diagonal waste narrower than about 2.1 mm.
     - Even axis-aligned, strips narrower than 17 px (1.7 mm) are removed, not 15 px.
   - `neck_test.js` (current tree): **10 failing** of 15. With the exact disc at R² = 49 for both open and close: **all pass** (re-run 2026-10-09). The review of 2026-10-09 moved the production radius to R² = 64 (G-D1, tie rule); the six fixture expectations and the diagonal cases still hold at 64 (re-measured: a 1.9 and a 2.2 mm diagonal neck keep their centre line, a 1.9 and a 2.2 mm diagonal waste channel stay open).
2. **No rule for sub-kerf necks or point contacts (G2).**
   - Same-layer parts that touch only at a vertex are split into separate rings by `rechain` (`js/geom.js:303-366`, D3 step 2). Nothing measures that contact.
   - `featureLayer` (`js/support.js:403-433`) only warns (`NECK_NARROW`), even for a neck the kerf cuts through. The machine kerf is `machine.kerfMM` (xTool S1 0.15 mm, `js/schema.js:140`); `project.machine` is `null` for "none".
3. **Neck diagnostics point at the part (G3).**
   - Every `NECK_NARROW` / `PART_THIN` / `FEATURE_MARGINAL` has `region = regionMM(p.bbox)` (`js/support.js:420`).
   - The erosion is `G.offset(…, −halfUm, "miter")` (`js/support.js:350`, `erode` `:340-353`), a square structuring element. It over-flags 1.5–2.1 mm diagonal necks: a 45° neck survives a square erosion of half h only if w > 2h·√2.
   - The advisory tier composes square erosions on orthogonal layers (`:417-418`).
4. **Guide stubs (G4).** `buildPair` emits every ring of every Rc polygon (`js/guides.js:98-99`), including slivers far smaller than any useful guide (`tguide.js`: rings with extent < 2 mm on most layers).
5. **Review UI (G5).**
   - The panel (`renderDiagnostics`, `js/app.js:521-570`; `diagItem` `:609-660`) lists one row per diagnostic with one checkbox each. On the fusion2 art that is hundreds of rows to tick. `SBDiag.aggregate` only merges five codes (`js/diag.js:225`, `:296-327`).
   - When the fabrication result is shown (`run.shown === run.fab`), its diagnostics are listed twice: in `#diag-list` and in `#fab-list` (`renderFabReview`, `js/app.js:1263-1270`).
6. **Near-1:1 resample (G6).**
   - The 4096 × 3084 source at 300 mm high is ≈ 398.4 mm wide. At 0.1 mm/px the fabrication raster is 3985 × 3000 (`SBRaster.fabRaster`, `js/raster.js:636-657`), so the source is area-resampled by 0.973.
   - Tonal mode always resamples (`resamplePolicy`, `js/raster.js:670-676`), and the info `RESAMPLED` (`js/engine.js:917-918`) only says "use a matching source size". No match is offered.
7. **Housekeeping (G7).**
   - `spikes/S7/` is untracked: 195 files, 71 MB not ignored by `spikes/S7/.gitignore`.
   - Of that, 20.5 MB is 34 `color.png` turbo visualisations (`scripts/common.py:97`), 15.8 MB is two `results/fusion/height_continuous*.png`, and 11.6 MB is five large preview PNGs. There are also `__pycache__/*.pyc`.

**Version.** The approval text asks for a checkpoint "bumping the version to 2.0.0-alpha.4". That label already shipped in speed round F18:
- `js/app.js:24`, `sw.js:23` and `js/worker.js:57` are `2.0.0-alpha.4`;
- `docs/CHANGELOG.md` has a `## v2.0.0-alpha.4` section;
- the release was commit `2bbb3f8`.

This round's checkpoint (G8) therefore ships **2.0.0-alpha.5**. Re-using alpha.4 would give two different builds the same service-worker cache name and the same worker `appVersion` handshake. The engine version stays `1.0.0-dev` (Q10 precedent; geometry changes are carried by `geometryHash`).

**Baseline:** `node test/run_tests.js` → **1971 passed, 0 failed** (2026-10-09, `43f2c88`, wall 10 min 25 s at load ≈ 12–19).

### G.1 Goals and traceability

| Goal | ID | Requirement (product owner, 2026-10-09) | SRS / plan links | Task |
|---|---|---|---|---|
| G1 | **PO-FIX-1** | Bonded min-feature morphology is an exact Euclidean-disc open/close (G-D1); connected unchanged (`oldrun.json` byte-identical); nesting preserved; production speed within the G.7 budgets | GEO-05, D-4.5, SUP-01/06, DEP-04, NFR-03, NFR-05 | G1 |
| G2 | **PO-FIX-2** | In-layer necks narrower than max(kerf, 0.5 µm) and same-layer point contacts are BLOCKING (D3 extension, G-D2) | GEO-02, GEO-05, D3, EXP-07 | G2 |
| G3 | **PO-FIX-3** | Neck diagnostics locate the neck; feature erosion is octagonal (G-D3) | GEO-05, UI-04, PO-LASER-6 | G3 |
| G4 | **PO-FIX-4** | No guide score ring below 2 mm extent or the footprint inset (G-D4) | ASM-01/02, AT-13 | G4 |
| G5 | **PO-FIX-5** | "Acknowledge all <type>" with confirm in both panels; duplicate rows merged per (code, layer) with a focus list; fabrication diagnostics listed once | UI-04, UI-05, §9.5, EXP-07, LYR-06 | G5 |
| G6 | **PO-FIX-6** | "Match pitch to source" when the source is close to the fabrication raster; `RESAMPLED` keeps its suggestion (G-D5) | IMG-02/03, PO-LASER-4/5, GEO-06 | G6 |
| G7 | **PO-FIX-7** | `spikes/S7/` committed within ≲ 30 MB, `.gitignore` respected, plus fusion2 `height_8layer_v2.png` and `engrave/` | NFR-11 (records), R9 | G7 |
| — | R9 | Checkpoint 2.0.0-alpha.5 with CHANGELOG known gaps | R9, DEP-02 | G8 |

### G.2 Decisions taken for this round

- **G-D1 (G1) Bonded disc morphology.**
  - **Pitch and radius.** p = pMax (the coarser axis pitch, as `constructPx`) and F = minFeatureUm / p, the minimum feature in px.
    - A pixel survives erosion iff its squared distance to the nearest background pixel is **> R²**.
    - A pixel is set by dilation iff some material pixel lies at squared distance ≤ R².
    - Squared distances are integers, so both tests use an integer **R²**, computed once in `constructPx` as `discR2` (IEEE `+ − * /` and `Math.floor` only; deterministic, NFR-05).
  - **Tie rule (review 2026-10-09, G.9 #6).** The feature checks treat a width **at or below** the minimum feature as too narrow (`featureLayer`: "w ≤ 2·halfUm vanishes"), so cleanup must not keep a width the checks flag.
    - A strip of w px has centre-line distance ⌊(w + 1)/2⌋ to the background, so the digital disc **cannot tell 2m − 1 from 2m px**: a strip of 2m − 1 or 2m px survives erosion iff m² > R².
    - The first draft's R² = ⌊(F/2 − ½)²⌋ = 49 kept exactly 15 px at F = 15, which `featureLayer` immediately flags (measured on the current tree: a 15 px axis neck is `NECK_NARROW`, a whole 15 px strip `PART_THIN`, 16 px `FEATURE_MARGINAL`). Every minimum-width neck would have become a warning, which defeats the G5 goal.
    - **Rule:** m = ⌊(⌊F⌋ + 1)/2⌋ and **R² = m²** when F ≥ 3, else 0 (draft fallback below). F is rounded to 1e-9 before `⌊·⌋` so binary noise cannot move a tie. At 1.5 mm and 0.1 mm/px: F = 15, m = 8, **R² = 64**. Strips and necks of ≤ 16 px (1.6 mm) are removed, 17 px (1.7 mm) survive; waste channels of ≤ 16 px are closed, 17 px stay open. On axis this is the width the square window had (17 px), now with exact diagonals.
    - Measured on the current tree (axis neck, diagonal neck of perpendicular width, whole strip; the diagonal case is judged with the G3 octagon): R² 49 keeps 15 / 13 / 15 px, R² 63 keeps 15 / 16 / 15 px (still flagged on axis), R² 64 keeps 17 / 16 / 17 px. 16 px diagonal necks pass the octagon check (≥ 16 px survive an octagon erosion of 750 µm, G3), 17 px axis necks pass the current check.
    - Self-consistency is a test (G1 Step 1 for axis and strip, G3 for the diagonal): construct, then `featureChecks`, on the smallest kept width gives no `NECK_NARROW` and no `PART_THIN`.
  - **Closing.** The closing uses the **same** R². A disc closing of radius m fills the waste of ≤ 2m px, the same rule as for material. v1.1's "close = featR − 1" compensated the square window's over-reach and is not carried over. On axis the closing fills ≤ 16 px waste; on the diagonal it fills far less than the square's ≈ 2.1 mm.
  - **Order and fusion.** The chain is open → close → (removeSpecks when `cullEnabled`) → fillHoles, as today. Disc dilations do not compose exactly (a digital disc ⊕ disc ≠ disc), so there is **no fusion**: four window passes.
  - **Image border.** Pixels outside the image are neither material nor background: erosion never erodes from outside, and dilation never adds from outside.
    - **Behaviour change versus the square kernels (review 2026-10-09).** `SBMorph.erode` never touches the 1-px border ring (`morph.js` header, `windowAny` emit skips row 0, row h − 1, column 0 and column w − 1), so a thin strip along the image edge kept its border pixels. The disc erodes a border pixel when interior background lies within ρ of it, so **art touching the image edge is cleaned like art in the interior**: an edge strip of ≤ 16 px disappears completely, one of ≥ 17 px keeps its edge pixels. This is intended and documented in ALGORITHMS §3 and the CHANGELOG; G1 has a test for both strips.
  - **Nesting.** Erosion and dilation with one structuring element and this border rule are increasing, so open/close are increasing and nesting holds (D-4.5; the 200-seed property test is extended).
  - **R² = 0** (F < 3) keeps the square `featR` open/close of today for that raster only (`featR` = 1: a 3 × 3 window).
    - At fabrication, F < 3 is exactly the blocking `SAMPLING_LOW` condition (`js/support.js` `featureHead`, 3 samples), so this fallback is reached only by drafts (or by an already blocked fabrication run).
    - It keeps the E3b draft fidelity check (`test/run_tests.js:5472-5492`) meaningful.
    - **Monotonicity across the switch.** Below F = 3 the 3 × 3 window removes strips of ≤ 2 px. At F = 3 the rule gives m = 2, R² = 4 and removes ≤ 4 px, so the strength never drops as F grows (the first draft's R² = 1 at 3 ≤ F < 3.8, a 4-neighbour cross, was weaker than the square it replaced).
    - **Draft fidelity (review 2026-10-09).** The rule moves the draft radius too: fabrication 0.25 mm/px (F = 6) goes from the square r = 3 to the disc R² = 9, and a 0.75 mm/px draft (F = 2) stays on the square r = 1. The E3b fidelity check carries recorded margins of 2.28 % against 8 % (area) and a part ratio of 1.75 against 2, and the plan never loosens a threshold without a note. G1 Step 6b re-runs the check, records the new margins in the G1 Result note and, if one fails, stops for a plan note instead of loosening it.
  - **Px contract.** `constructPx` adds the integer `discR2` (≥ 0) to the px object. A direct caller that omits it gets `discR2 = featR²` (for F ≥ 3 the rule gives m = `featR`, e.g. 8 at F = 15 and 16, 9 at F = 17), so `featR`-only test fixtures keep working. **Connected mode ignores `discR2`.**
- **G-D2 (G2, D3 extension, product owner 2026-10-09).** Two new **blocking** diagnostics, both evaluated by `featureLayer` at both qualities.
  - **`NECK_KERF`.** A part that splits under an octagonal erosion of half the neck limit T = max(kerfUm, 0.5 µm).
    - `kerfUm = round(machine.kerfMM·1000)`, with 0 when `machine` is `null` or `kerfMM` is 0.
    - **No kerf, no pass (review 2026-10-09).** When `kerfUm` is 0 the 0.5 µm floor is only the documented lower bound of the limit: the erosion is **skipped**. Pixel-lattice geometry has no neck narrower than one pixel inside a single part (a point contact is split into two parts by `rechain`, D3 2), so the pass could not fire and would only cost a third offset of every layer.
    - **Scale.** T is an integer µm. The erosion halves it, so it runs at scale 1 (delta −T/2 µm) when T is even and on the layer scaled ×2 (delta −T in half-µm units) when T is odd. There is no ×4 scale. For the 0.15 mm kerf: scale 1, delta −75.
    - A neck **at or below** T counts as narrow, the same tie convention as `NECK_NARROW` ("w ≤ 2·halfUm vanishes").
    - A part with `NECK_KERF` gets no `NECK_NARROW` and no neck `FEATURE_MARGINAL`.
    - **A part that vanishes entirely under the kerf erosion** (narrower than the kerf everywhere) gets `PART_THIN` from the minimum-feature erosion and **no** `NECK_KERF`; `PART_THIN` is a warning. A part thinner than the kerf is lost at the laser, so this may be less strict than the product owner intends (G.9 #7).
    - **No repair action (review 2026-10-09).** `NECK_KERF` and `PART_POINT_CONTACT` are blocking at draft too and no clip action exists for them: the user widens the art, raises the minimum feature size or accepts that the export stays blocked. The USER_GUIDE says so (G8).
  - **`PART_POINT_CONTACT`.** Two distinct parts of one layer share a vertex (after `normalize`, every inter-part point contact, T-contacts included, is a shared vertex: D3 2.1–2.3). It is checked in **bonded** mode only; connected mode already blocks multi-part layers with `CONNECTED_SPLIT`.
    - **What it can see after bonded construction (review 2026-10-09, measured).** The disc closing turns a corner contact into a thin neck instead of removing it: two 6 mm squares touching at a corner, through the disc open/close at R² 49 or 64 and `fillHoles`, give **one part** with a neck of about 3 px (0.3 mm) along the anti-diagonal. That is flagged `NECK_NARROW` (a warning: above the 0.15 mm kerf, so not `NECK_KERF`). `PART_POINT_CONTACT` therefore almost never survives bonded construction. It remains as a guard for geometry the closing does not produce (clip repairs, future inputs).
    - **The guarantee is for waste, not material.** The disc closing guarantees that no waste channel narrower than the minimum feature survives. It does **not** guarantee that no material pinch of 0.1–0.6 mm survives at a saddle: such a pinch is reported as `NECK_NARROW` (warning, located by G3), and as `NECK_KERF` only when it is at or below the kerf. This is stated in the USER_GUIDE and needs the product owner's confirmation that it satisfies "pinches 0.1–0.6 mm" (G.9 #8). G2 has an end-to-end test (saddle fixture through `C.bonded`, then `featureChecks`) that records the real behaviour.
  - **Not in scope:** a part touching its own hole at a point (outer–hole or hole–hole ring contact). It stays legal, as in D3 4 (open question G.9 #2).
  - `NECK_KERF` is aggregated per (code, layer) like `NECK_NARROW`. `PART_POINT_CONTACT` stays one diagnostic per contact: it carries two parts and one box, which `SBDiag.aggregate` would flatten. G5 merges its rows in the panel.
  - The export gate blocks on both like any blocking code (`SBDiag.exportGate`, `js/diag.js:357`).
- **G-D3 (G3) Octagonal feature erosion.**
  - `featureLayer` erodes with the `"square"` join, the chamfered corner. On lattice geometry this is erosion by the octagon whose support distance is δ in all 8 lattice and diagonal directions, so a 45° neck of width w survives iff w > 2δ, as on the axis. `"round"` stays refused (NFR-05).
  - The orthogonal composition shortcut (`js/support.js:417-418`) is **removed**: chamfered residuals are not orthogonal, and rounded octagons do not compose exactly. The advisory erosion runs on the part polygons directly.
  - The neck locator is `S.neckRegions`, described in G3. It is called only for parts that split, filters lost components by bbox before any Clipper call, and is bounded in work as well as in output (review 2026-10-09).
  - The advisory erosion is no longer composed, so the features stage gains a full offset. Cost is controlled by cumulative gates against the pre-round baseline (G.7), not by task-to-task ratios.
- **G-D4 (G4).** `GUIDE_MIN_EXTENT_UM = 2000`. **In inset-outline mode only** (the PO complaint is about score rings), an Rc polygon is used for attribution and rings only if its bbox extent max(w, h) ≥ 2000 µm **and** `offset([poly], −fp, "miter")` is non-empty (when fp > 0). A ring (outer or hole) of a kept polygon is emitted only if its own extent is ≥ 2000 µm.
  - **Interior-mark mode is unchanged (review 2026-10-09).** Its smallest cross arm is 300 µm (0.6 mm, `ARMS` in `js/guides.js`), so a 2 mm extent rule would drop valid crosses and add `GUIDE_OMITTED` warnings. The filter is not applied there, and a test asserts the interior-mark output is byte-identical to before.
  - **Cost.** The extent test is a bbox comparison and runs first; the footprint-inset offset runs only for polygons that pass it. The filter adds one offset per surviving Rc polygon, so it is not "work removed": the guides stage gate in G.7 allows for it.
  - **Reasons.**
    - A part with Rc polygons of which none is kept gets `GUIDE_OMITTED` with the reason "no concealed guide area ≥ 2 mm" (new text).
    - A part with no Rc polygon at all keeps today's reason "no concealed area ≥ footprint" (`js/guides.js:98`).
    - Interior-mark reasons ("no concealed area ≥ footprint", "no concealed area for the smallest mark", `js/guides.js:103` and below) are unchanged.
  - The label placement keeps using the full Rc list (unchanged).
- **G-D5 (G6).** `SBRaster.matchSourcePitch` returns the largest integer pitch p (µm) whose uncapped raster covers the source on both axes, i.e. ⌈A/p⌉ ≥ S per axis, so `fabRaster` clamps to exactly the source. Two rule changes follow:
  - **`FAB_EXCEEDS_SOURCE` → `FAB_MATCHES_SOURCE`.** When the raster is clamped to exactly the source and the next coarser 1 µm pitch would not exceed it on either axis (⌈A/(p+1)⌉ ≤ S for both), `SBRaster.fabDiagnostics` emits the new **info** `FAB_MATCHES_SOURCE` ("the raster equals the source; real pitch x mm/px") instead of the `FAB_EXCEEDS_SOURCE` warning. That is the 1 µm pitch grid, not lost detail.
  - **Equal-size tonal skips the resample.** `resamplePolicy` returns `"none"` for tonal when W = srcW and H = srcH. This is shipped only if the area resample at equal size is byte-identical to the input (G6 Step 1), so the geometry is unchanged and only the stage and `RESAMPLED` disappear.
  - The offer is made only when the match pitch is within ±15 % of the target pitch, inside `SBSchema.FAB_PITCH` (0.05–2 mm) and inside the pixel budget.
  - **Tolerance of the info rule (review 2026-10-09).** "One 1 µm step" is a different number of pixels at each pitch: the uncapped raster exceeds the source by up to about S/p px per axis (S the source axis in px, p the pitch in µm), i.e. a fraction 1/p of the axis. That is ≈ 42 px (1.0 %) for 4096 px at 97 µm and ≈ 82 px (2.0 %) at the 50 µm minimum pitch. The rule states this tolerance explicitly: `FAB_MATCHES_SOURCE` when the shortfall on each axis is at most one 1 µm step **and** at most 2 % of the source axis (the cap never binds inside `FAB_PITCH`, it is there so a future pitch range cannot widen the silent zone). A larger shortfall keeps the `FAB_EXCEEDS_SOURCE` warning. The info detail states the shortfall in px and %.
  - **Side effects.** The `FAB_PITCH_CAPPED` detail ends "(see FAB_EXCEEDS_SOURCE)" only when that warning is emitted, else "(see FAB_MATCHES_SOURCE)". Equal-size tonal fixtures lose `RESAMPLED` as well as the resample stage, so their `diagSha` changes; their `geometryHash` and `layerHashes` do not (`resampleCore` already copies at equal size and `geometryHash` excludes the resample method).
- **G-D6 Golden policy.**
  - G1 (all bonded fixtures), G2/G3 (diagnostics), G4 (guide fixtures) and G6 (equal-size tonal fixtures, if any) re-capture `test/golden/pool-equality.json` only through `node test/capture_golden.js --pool-equality --recapture <ids> --task Gn`. Each task's test asserts which digest fields may differ for its ids.
  - The F1 recapture check (`test/run_tests.js:6186-6192`) compares F1's `previous` with the **current** fixture, so the first later recapture of an F1 id would fail it. G1 makes it chain-aware: compare with the digest that F1 produced, i.e. the `previous[id]` of the first later record that re-captured the id, else the current fixture.
  - **Connected fixtures (review 2026-10-09).** Connected mode still calls the square morphology, so its `geometryHash` and `layerHashes` never change in this round. Its **diagnostics** do change: `NECK_KERF` is evaluated in connected mode too, and the G3 octagon changes `NECK_NARROW` and `FEATURE_MARGINAL` in every mode. The connected F0 fixtures (`h-connected-*`, `t-connected-*`, `n3-*`) can therefore change `diagSha`/`wholeSha` in the G2 and G3 recaptures. The assertions are scoped per task: the **G1** record contains no connected id; the **G2** and **G3** records may contain connected ids, but only with `diagSha`/`wholeSha` differing, `geometryHash` and `layerHashes` unchanged.
  - `test/golden/oldrun.json`, `sheetmasks.json` and `legacy_svg.json` never change in this round.

### G.3 Global Constraints

All of the plan's **Global Constraints**, E.3 and F.3 apply. In addition, for this round:

- **Connected mode is frozen.** `SBConstruct.connected` stays the v1.1.0 chain byte for byte (`test/run_tests.js` "SUP-06/DEP-04 connected == the v1.1.0 chain incl. islands.resolve", suite at `:416-430`). `test/golden/oldrun.json` (`:715`) stays unchanged. The connected F0 fixtures (`h-connected-*`, `t-connected-*`, `n3-*`) keep `geometryHash`/`layerHashes`; their diagnostics (`diagSha`/`wholeSha`) may change in G2/G3 (G-D6).
- **Pool equality holds.** The disc kernel runs inside `constructLayer` (the pool's construct item, `js/engine.js:548-549`). Pooled = serial over the F0 corpus after every recapture (F12 tests).
- **No trig, no `Math.hypot`, no randomness** in new engine code (NFR-05). The disc uses integer squared distances. The neck locator and point-contact scan use exact integer coordinates and Clipper2 miter/square joins only.
- **Blocking codes never fire on clean art.** The new blocking codes must not appear on the F0 corpus fixtures that had no point contact or sub-kerf neck. Each task lists the fixtures whose diagnostics changed in its recapture record.
- After every task: `node test/run_tests.js` all green. When shipped code (`js/`, `index.html`, `css/`, `sw.js`) changes, run `node build.js` and commit `dist/shadowbox-studio.html` with the task. Commit only the task's files; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the plan's convention; if the executing session's own attribution instruction names another model, that instruction governs). No push, no tags.
- **Existing tests this round changes are scheduled in the task that changes them** (review 2026-10-09): G3 (`test/run_tests.js` ~606-626 and the diagonal-layer delta test after it, plus the G2 delta effect), G4 (~5900-5911), G8 (`:2659`, `:8047-8049`, `:8262`). A task that leaves one of them red has not finished.
- **Budgets are cumulative against the pre-round baseline** (G.7), not task to task: the original `docs/perf/speed-round.json` `phaseB.fab4096` (pooled 8794 ms, serial 12879 ms) and `final.s2` (pooled p95 ≤ 10 s in Chromium, still pending) are the references.

### G.4 Review Focus

1. **Bonded layer touching the image border** (frame off, art to the edge). A reasonable person expects no erosion from outside and no material created from outside. Test in G1 (`G1 border: a full-width strip at the image edge keeps its edge row; dilation never sets a pixel with no material within R²`).
2. **Very coarse and very fine pitches.**
   - R² = 0 (draft at 0.55 mm/px, F < 3) must keep today's draft cleanup.
   - R² > 65025 (minFeature 50 mm at 0.05 mm/px: F = 1000, m = 500, R² = 250000) must not overflow the distance plane.

   Test in G1 (`G1 R2 0 falls back to the square chain` and `G1 R2 > 65025 uses a Uint16 distance plane and equals brute force`).
3. **Machine "none" or kerf 0.** The neck limit falls back to the 0.5 µm floor, and a 0.1 mm neck is not blocking (it is still `NECK_NARROW`). Test in G2.
4. **A part with two necks, or a neck the locator cannot isolate.** Each neck gets its own region. A failed locator falls back to the part bbox with detail "neck location approximate" instead of throwing. Test in G3.
5. **"Acknowledge all" while a new fabrication result replaces the shown one.** The confirm acks only keys of the hash shown when the button was pressed, and a stale confirm acks nothing. Test in G5 (`SBProof.ackAllPlan` carries `hash`; the app re-checks `r.snapshot.geometryHash === plan.hash` before adding).

### G.5 File structure

| File | Change | Responsibility after this round |
|---|---|---|
| `js/morph.js` | Modify | `discWindow` (exact digital-disc window), `M.discErode`, `M.discDilate`, `M.discOpenClose`; header documents the disc semantics (including the border behaviour) next to the square ones. |
| `js/construct.js` | Modify | `morphDisc` (bonded chain), `C._morphDisc` hook; px contract gains `discR2`; bonded `constructLayer` uses `morphDisc`; connected untouched. |
| `js/engine.js` | Modify | `constructPx` adds `discR2`; `fcfg` and `E.legacyDiagnostics` pass `kerfMM`, `pointContacts`; `E.matchSourcePitch`. |
| `js/support.js` | Modify | `erode(…, {join, scale})`; octagonal feature erosion; `NECK_KERF`, `PART_POINT_CONTACT`; `S.neckRegions`; header doc. |
| `js/diag.js` | Modify | Codes `NECK_KERF`, `PART_POINT_CONTACT` (blocking), `FAB_MATCHES_SOURCE` (info); `AGGREGATED` gains `NECK_KERF`. |
| `js/guides.js` | Modify | `GUIDE_MIN_EXTENT_UM`, `keepGuidePoly`; `buildPair` filters Rc for rings/attribution in inset-outline mode only; both exports go into the `Object.freeze({...})` literal (`:192`, there is no `G` alias). |
| `js/raster.js` | Modify | `R.matchSourcePitch`; `fabDiagnostics` one-step rule; `resamplePolicy` tonal equal size → `"none"`. |
| `js/proof.js` | Modify | `P.diagRows`, `P.ackAllPlan`, `P.fabListedIn` (pure view models). |
| `js/app.js`, `index.html`, `css/app.css` | Modify | Rows with focus lists, "Acknowledge all" + inline confirm, single listing, "Match pitch to source" (pitch row and `RESAMPLED` item). |
| `js/app.js:24`, `sw.js:23`, `js/worker.js:57` | Modify (G8) | `2.0.0-alpha.5`. |
| `test/neck_fixtures/*.png` | **Create** | The six 120 × 120 crops from `neckrepro/fixtures/` (≈ 3 KB total). |
| `test/oracle_kernels.js` | Modify | Add `oracleDisc` (brute-force disc erode/dilate; existing bodies untouched). |
| `test/run_tests.js` | Modify | Suites G1–G6, G8; chain-aware F1 check; PLAN code list; updates to the existing tests that G3 (Appendix C oracle and delta tests), G4 (AT-14 / ASM-03 guide fixtures) and G8 (`:2659`, `:8047-8049`, `:8262`) invalidate. |
| `test/capture_golden.js` | Unchanged | `--recapture … --task Gn` already exists. |
| `test/golden/pool-equality.json` | Modify | Re-captures G1–G6 (records with `task`). |
| `test/bench.js` | Modify | `bench morph` (square vs disc per layer at 12 Mpx); records `docs/perf/speed-round.json` `appendixG`. |
| `spikes/S7/.gitignore`, `spikes/S7/**` | Modify/Add (G7) | Spike code, READMEs, results within ≲ 30 MB. |
| `docs/ARCHITECTURE.md` | Modify | D3 extension (G2, this commit); bonded morphology note (G1); feature-check erosion (G3). |
| `docs/ALGORITHMS.md` §3 | Modify (G1) | Bonded disc morphology. |
| `docs/CHANGELOG.md`, `docs/QA_CHECKLIST.md`, `docs/USER_GUIDE.md` | Modify (G8) | alpha.5 notes, known gaps, manual checks. |

### G.6 Tasks

Order is binding: G1 → G2 → G3 → G4 → G5 → G6 → G7 → G8. G2 introduces the `erode` options that G3 uses, and G5 renders the codes G2 adds. G7 touches no shipped code and may run at any point before G8.

---

#### Task G1 (PO-FIX-1): Exact Euclidean-disc open/close for bonded construction

**Files:**
- Modify: `js/morph.js` (header `:1-30`, new kernel after `M.openClose` `:178-182`)
- Modify: `js/construct.js` (header px contract `:22-27`, `morph` `:79-86`, `constructLayer` bonded branch `:144-146`, `checkPx` `:72-76`)
- Modify: `js/engine.js` (`constructPx` `:464-486`)
- Modify: `docs/ALGORITHMS.md` §3; `docs/ARCHITECTURE.md` (one paragraph under "Decisions" → D3 neighbourhood: "Bonded min-feature morphology (Appendix G, G-D1)")
- Create: `test/neck_fixtures/` (copy of the six `neckrepro/fixtures/*.png`, file names unchanged)
- Modify: `test/oracle_kernels.js` (`oracleDisc`), `test/run_tests.js` (suite `morph/construct — Appendix G G1 bonded disc morphology (PO-FIX-1, GEO-05, D-4.5, NFR-05)`; chain-aware F1 check `:6186-6192`)
- Modify: `test/bench.js` (`bench morph`)
- Modify: `test/golden/pool-equality.json` (recapture, task G1)

**Interfaces:**
- Produces:
  - `SBMorph.discErode(mask: Uint8Array, w, h, R2: int ≥ 0) → Uint8Array` (fresh): the mask, with each pixel whose disc of squared radius R2 holds a background pixel set to 0. Outside the image counts as no pixel.
  - `SBMorph.discDilate(mask, w, h, R2) → Uint8Array` (fresh 0/1).
  - `SBMorph.discOpenClose(mask, w, h, R2o, R2c) → Uint8Array`: `discErode(discDilate(discDilate(discErode(m, R2o), R2o), R2c), R2c)`.
  - `SBConstruct._morphDisc(mask, w, h, px, cull) → {m, specks, holes}`.
  - px gains `discR2` (integer ≥ 0, optional; default `featR²`, G-D1).
- Consumes: `SBMorph.removeSpecks`, `SBMorph.fillHoles`, `SBMorph.openClose` (fallback when `discR2 === 0`).

- [x] **Step 1: Write the failing tests.**
  1. Copy the fixtures:

     ```bash
     mkdir -p test/neck_fixtures && cp /tmp/claude-1000/-run-media-geekuser-Storage-WebstormProjects-ShadowBox-Stacked/2e8a9c5f-d6c0-49c6-b1a7-a129d1b164e1/scratchpad/neckrepro/fixtures/*.png test/neck_fixtures/
     ```

     If the scratchpad is gone, regenerate the crops from `spikes/S7/results/fusion2/height_8layer_v2.png` with the `mkfix.js` rule: 120 × 120 px at the spot centres in G.0. The spots in mm are (274.2, 21.6), (353.7, 161.9), (169.4, 267.9), (299.7, 276.2), (124.8, 35.4), (28.3, 193.9), with x0 = round(10·x) − 60 and y0 = round(10·y) − 60, written raw gray8 with `test/png_enc.js`.
  2. Add `oracleDisc` to `test/oracle_kernels.js`, a new kernel (never edit existing bodies), and export it:

```js
// ---- Appendix G G1: brute-force exact digital-disc erode/dilate (the definition, O(w·h·R2)); outside the image: no pixel.
const oracleDisc = (() => {
  function any(m, w, h, x, y, R2, want) {
    const A = Math.floor(Math.sqrt(R2)) + 1;   // over-cover; the dx² + dy² ≤ R2 test decides
    for (let dy = Math.max(-A, -y); dy <= Math.min(A, h - 1 - y); dy++) for (let dx = Math.max(-A, -x); dx <= Math.min(A, w - 1 - x); dx++) {
      if (dx * dx + dy * dy > R2) continue;
      if ((m[(y + dy) * w + x + dx] !== 0) === want) return true;
    }
    return false;
  }
  const erode = (m, w, h, R2) => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = m[i] && !any(m, w, h, x, y, R2, false) ? 1 : 0; } return o; };
  const dilate = (m, w, h, R2) => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = any(m, w, h, x, y, R2, true) ? 1 : 0; return o; };
  return { erode, dilate, openClose: (m, w, h, a, b) => erode(dilate(dilate(erode(m, w, h, a), w, h, a), w, h, b), w, h, b) };
})();
```

  3. Add the suite. Its fixture helpers come from `neck_test.js`:

```js
suite("morph/construct — Appendix G G1 bonded disc morphology (PO-FIX-1, GEO-05, D-4.5, NFR-05)", () => {
  const F = require("./fixtures.js"), O = require("./oracle_kernels.js").oracleDisc, M = SBMorph, C = SBConstruct;
  const has = typeof M.discErode === "function" && typeof M.discDilate === "function" && typeof M.discOpenClose === "function";
  check("G1 SBMorph.discErode/discDilate/discOpenClose exist", has);
  if (!has) return;
  // exactness against the brute-force definition: random masks, sizes 1–41, R2 in {0, 1, 2, 4, 5, 8, 13, 49, 52, 56}
  { const rng = F.lcg(4711); let bad = 0, n = 0;
    for (let t = 0; t < 160; t++) { const w = 1 + Math.floor(rng() * 41), h = 1 + Math.floor(rng() * 41), R2 = [0, 1, 2, 4, 5, 8, 13, 49, 52, 56][t % 10], dens = 0.2 + 0.6 * rng();
      const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = rng() < dens ? 1 : 0;
      const e = M.discErode(m, w, h, R2), d = M.discDilate(m, w, h, R2); n++;
      if (e.join() !== O.erode(m, w, h, R2).join() || d.join() !== O.dilate(m, w, h, R2).join() || e === m || d === m) bad++; }
    check(`G1 disc erode/dilate equal the brute-force definition (${n - bad}/${n})`, bad === 0); }
  { const w = 7, h = 5, m = new Uint8Array(w * h).fill(1); m[17] = 0;
    check("G1 R2 = 0: erode and dilate are the identity", M.discErode(m, w, h, 0).join() === m.join() && M.discDilate(m, w, h, 0).join() === m.join()); }
  { const w = 300, h = 3, m = new Uint8Array(w * h); m.fill(1, w, w + 1); const R2 = 70000;   // ρ ≈ 264.6: distance plane must be Uint16
    check("G1 R2 > 65025 uses a wide distance plane and equals brute force on a long strip",
      M.discDilate(m, w, h, R2).join() === O.dilate(m, w, h, R2).join()); }
  // border (G.4 #1): outside the image is no pixel
  { const w = 40, h = 30, m = new Uint8Array(w * h); m.fill(1, 0, 20 * w);   // material rows 0..19 at the top edge
    const e = M.discErode(m, w, h, 49);
    check("G1 border: material at the image edge is not eroded from outside (row 0 kept, rows ≥ 13 removed)",
      e.subarray(0, w).every((v) => v === 1) && e.subarray(13 * w, 20 * w).every((v) => v === 0)); }
  // thresholds at 1.5 mm, 0.1 mm/px: F = 15, m = 8, R2 = 64 (G-D1 tie rule: widths ≤ 16 px are removed, 17 px survive)
  const PX = { featR: 8, discR2: 64, bridgeR: 9, cullPx: 1000, maxBridgePx: 400, speckPx: 1000, holePx: 450, frameAnchored: false, cullEnabled: false };
  const full = (w, h) => new Uint8Array(w * h).fill(1), comps = (m, w, h) => M.runComponents(m, w, h, 1).count;
  const bonded1 = (m, w, h, px) => C.bonded([full(w, h), m], w, h, px || PX).final[1];
  const axisNeck = (wd) => { const w = 220, h = 100, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x < 80 && y > 20 && y < 80) || (x >= 140 && y > 20 && y < 80) || (y >= 40 && y < 40 + wd) ? 1 : 0;
    return { m, w, h }; };
  for (const [wd, keep] of [[14, false], [15, false], [16, false], [17, true], [19, true]]) { const { m, w, h } = axisNeck(wd), f = bonded1(m, w, h);
    check(`G1 axis neck ${wd / 10} mm (min 1.5, tie: ≤ 1.6 removed) ${keep ? "kept (one part)" : "removed (two parts)"}`, comps(f, w, h) === (keep ? 1 : 2)); }
  const waste = (c) => { const w = 220, h = 60, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = x < 100 || x >= 100 + c ? 1 : 0; return { m, w, h }; };
  for (const [c, filled] of [[14, true], [15, true], [16, true], [17, false]]) { const { m, w, h } = waste(c), f = bonded1(m, w, h);
    check(`G1 axis waste channel ${c / 10} mm ${filled ? "is closed" : "stays open"}`, (comps(f, w, h) === 1) === filled); }
  // tie rule / self-consistency (review 2026-10-09): what construction keeps, the feature checks do not flag as too narrow
  const feat = (m, w, h) => SBSupport.featureChecks(SBMaterial.assignParts(SBMaterial.fromMasks([full(w, h), m], w, h, { artWMM: w * 0.1, artHMM: h * 0.1, frameMM: 0 }, {})),
    { minFeatureMM: 1.5, advisoryFeatureMM: 2, minPartMM2: 0, mmPerPxMax: 0.1, calibrated: true }).map((d) => d.code);
  { const { m, w, h } = axisNeck(17), c = feat(bonded1(m, w, h), w, h);
    check("G1 tie rule: the smallest kept axis neck (1.7 mm) is not NECK_NARROW or PART_THIN", !c.includes("NECK_NARROW") && !c.includes("PART_THIN")); }
  { const w = 200, h = 60, m = new Uint8Array(w * h); for (let y = 20; y < 37; y++) m.fill(1, y * w, y * w + w);   // a 17 px strip across the image
    const f = bonded1(m, w, h), c = feat(f, w, h);
    check("G1 tie rule: the smallest kept whole strip (1.7 mm) survives construction and is not PART_THIN", f.some((v) => v) && !c.includes("PART_THIN") && !c.includes("NECK_NARROW")); }
  { const w = 200, h = 60, m = new Uint8Array(w * h); for (let y = 20; y < 36; y++) m.fill(1, y * w, y * w + w);   // 16 px: removed
    check("G1 tie rule: a 1.6 mm strip is removed entirely", !bonded1(m, w, h).some((v) => v)); }
  // border semantics (review 2026-10-09): art touching the image edge is cleaned like interior art (the square kernels kept the 1-px ring)
  { const w = 100, h = 60, thin = new Uint8Array(w * h), wide = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { thin.fill(1, y * w, y * w + 6); wide.fill(1, y * w, y * w + 17); }
    check("G1 border: a 0.6 mm strip along the image edge is removed completely; a 1.7 mm strip keeps its edge column",
      !bonded1(thin, w, h).some((v) => v) && (() => { const f = bonded1(wide, w, h); for (let y = 0; y < h; y++) if (!f[y * w]) return false; return true; })()); }
  // diagonal neck and waste (neck_test.js): 45° strip of perpendicular width wpx between two 6 mm blocks
  const diag = (wpx, inv) => { const w = 220, h = 220, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const A = x >= 20 && x < 80 && y >= 20 && y < 80, B = x >= 140 && x < 200 && y >= 140 && y < 200,
      S = Math.abs(x - y) / Math.SQRT2 <= wpx / 2 && x >= 50 && x <= 170; m[y * w + x] = A || B || S ? 1 : 0; }
    if (inv) { for (let i = 0; i < m.length; i++) m[i] = m[i] ? 0 : 1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 4 || y < 4 || x >= w - 4 || y >= h - 4) m[y * w + x] = 1; }
    return { m, w, h }; };
  for (const wpx of [19, 22]) {
    { const { m, w, h } = diag(wpx, false), f = bonded1(m, w, h); let cut = 0; for (let t = 60; t <= 160; t++) if (!f[t * w + t]) cut++;
      check(`G1 diagonal material neck ${wpx / 10} mm keeps its centre line (was chopped by the square window)`, cut === 0); }
    { const { m, w, h } = diag(wpx, true), f = bonded1(m, w, h); let fill = 0; for (let t = 60; t <= 160; t++) if (f[t * w + t]) fill++;
      check(`G1 diagonal waste channel ${wpx / 10} mm is not filled`, fill === 0); }
  }
  // the six real 12 × 12 mm crops of height_8layer_v2.png: construct creates no new neck or waste neck < 1.3 mm
  const dir = path.join(__dirname, "neck_fixtures"), files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".png")).sort() : [];
  check("G1 six neck fixtures present (test/neck_fixtures)", files.length === 6);
  for (const f of files) checkAsync(`G1 ${f}: no new material or waste neck < 1.3 mm`, SBPng.decode(new Uint8Array(fs.readFileSync(path.join(dir, f))), { mode: "height" }).then((d) => {
    const w = d.w, h = d.h, k = +f.slice(1, 3) - 1, masks = [];
    for (let j = 0; j < 8; j++) masks.push(d.samples.map((v) => (v >= Math.round((j * 255) / 7) ? 1 : 0)));
    const fin = C.bonded(masks, w, h, Object.assign({}, PX, { cullEnabled: false })).final[k];
    const inv = (m) => m.map((v) => (v ? 0 : 1)), open36 = (m) => O.dilate(O.erode(m, w, h, 36), w, h, 36);
    const thinNew = (src, out) => { const os = open36(src), oo = open36(out), deep = O.erode(src, w, h, 15); let n = 0;   // deep: d² ≥ 16, ≥ 0.4 mm from background
      for (let y = 15; y < h - 15; y++) for (let x = 15; x < w - 15; x++) { const i = y * w + x; if (os[i] && !oo[i] && deep[i]) n++; } return n; };
    return thinNew(masks[k], fin) === 0 && thinNew(inv(masks[k]), inv(fin)) === 0; }));
  // nesting (D-4.5) with the disc (review 2026-10-09: the 40 × 30 stacks at R2 up to 49 erase most content, so they proved little).
  // Small stacks keep the cheap R2 2/8. The strong test uses structured 120 × 90 stacks (F.busyHeightMap thresholded at five levels, so they are nested by
  // construction and keep ~50-58 % of the pixels on layers 1-4 after cleanup; F.randomNestedStack leaves layers 2-4 nearly empty even at 120 × 90),
  // R2 in {4, 9, 64}, with and without cullEnabled (removeSpecks), at constructLayer level. Measured 2026-10-09 with the prototype chain: 0 violations in 60 seeds.
  { let ok = true; for (let s = 1; s <= 200 && ok; s++) { const st = F.randomNestedStack(F.lcg(s), 40, 30, 5);
      for (const discR2 of [2, 8]) { const r = C.bonded(st, 40, 30, { ...PX, featR: 3, discR2, holePx: 30 });
        for (let k = 2; k < r.final.length; k++) if (r.final[k].some((v, i) => v && !r.final[k - 1][i])) ok = false; } }
    check("D-4.5 property: bonded disc morphology keeps nesting (200 seeds, 40 × 30, R2 2/8)", ok); }
  { const bad = { cull: 0, nocull: 0 }, kept = [];
    for (let s = 1; s <= 60; s++) { const hm = F.busyHeightMap(1000 + s, 120, 90, 14), st = [0, 1, 2, 3, 4].map((k) => hm.map((v) => (v >= k * 45 ? 1 : 0)));
      for (const discR2 of [4, 9, 64]) for (const cull of [false, true]) {
        const px = { ...PX, featR: Math.round(Math.sqrt(discR2)), discR2, holePx: 30, speckPx: 150, cullEnabled: cull };
        const fin = st.map((mask, k) => C.constructLayer(k, { mask, W: 120, H: 90, px, bonded: true }).final);   // constructLayer level, as the pool runs it
        kept.push(fin.slice(1).reduce((a, m) => a + m.reduce((x, v) => x + v, 0), 0));
        for (let k = 2; k < fin.length; k++) if (fin[k].some((v, i) => v && !fin[k - 1][i])) bad[cull ? "cull" : "nocull"]++; } }
    check("D-4.5 property: nesting at constructLayer level on 120 × 90 stacks, R2 4/9/64, cullEnabled false", bad.nocull === 0);
    check("D-4.5 property: nesting at constructLayer level on 120 × 90 stacks, R2 4/9/64, cullEnabled true (removeSpecks)", bad.cull === 0);
    check("G1 the nesting stacks keep material (not vacuous: layers 1-4 keep > 30 % of the pixels on average)", kept.reduce((a, b) => a + b, 0) / kept.length > 0.3 * 120 * 90 * 4); }
  // fallback and contract
  { const st = F.randomNestedStack(F.lcg(9), 40, 30, 4), sq = { ...PX, featR: 1, holePx: 8 };
    const a = C.bonded(st, 40, 30, { ...sq, discR2: 0 }).final, b = st.map((m, k) => (k ? C._morph(m, 40, 30, sq, false).m : m));
    check("G1 R2 0 (minFeature < 3 px, draft only) falls back to the square featR chain", a.every((m, k) => m.join() === b[k].join())); }
  check("G1 px without discR2 uses featR²", (() => { const st = F.randomNestedStack(F.lcg(3), 40, 30, 4);
    const a = C.bonded(st, 40, 30, { ...PX, discR2: undefined, featR: 3 }).final, b = C.bonded(st, 40, 30, { ...PX, featR: 3, discR2: 9 }).final;
    return a.every((m, k) => m.join() === b[k].join()); })());
  check("G1 discR2 must be a non-negative integer when given (CONSTRUCT_ARG)", (() => { try { C.bonded([full(4, 4)], 4, 4, { ...PX, discR2: 1.5 }); return false; } catch (e) { return e.code === "CONSTRUCT_ARG"; } })());
  { const p = SBSchema.defaults("plywood"), cp = SBEngine._constructPx || null;
    check("G1 constructPx gives discR2 = 64 at 1.5 mm and 0.1 mm/px (tie rule), 9 at 0.25 mm/px, 0 at 0.55 and 0.75 mm/px (square fallback), monotone in F",
      !!cp && cp(p.construction, true, 100, 100).discR2 === 64 && cp(p.construction, true, 250, 250).discR2 === 9 &&
      cp(p.construction, true, 550, 550).discR2 === 0 && cp(p.construction, true, 750, 750).discR2 === 0 &&
      [10, 14, 16, 20, 25, 30, 40, 50, 60, 75, 100].map((u) => cp(p.construction, true, u, u).discR2).every((v, i, a) => !i || v <= a[i - 1]));   // finer pitch (smaller µm) → larger R2
    check("G1 constructPx R2 sizes the distance plane: 50 mm minimum feature at 0.05 mm/px gives R2 = 250000 (> 65025)", (() => { const q = SBSchema.defaults("plywood").construction; q.cleanup.minFeatureMM = 50;
      return cp(q, true, 50, 50).discR2 === 250000; })()); }
  // connected is untouched: the v1.1.0 chain test and oldrun.json stay as they are (suites "construct.js — G2.6 extended", "golden oldrun")
  { const st = F.randomNestedStack(F.lcg(5), 40, 30, 5), q = { ...PX, featR: 3, discR2: 6, frameAnchored: true, speckPx: 4, holePx: 30 };
    const a = C.connected(st, 40, 30, q).final, b = C.connected(st, 40, 30, { ...q, discR2: 0 }).final;
    check("SUP-06 connected ignores discR2", a.every((m, k) => m.join() === b[k].join())); }
});
```

     `SBEngine._constructPx` is a new **test hook**: `E._constructPx = constructPx`, the same pattern as `C._morph`.
- [x] **Step 2: Run the new suite and confirm it fails.** Run `node test/run_tests.js --only "Appendix G G1"`. Expected FAIL: "G1 SBMorph.discErode/discDilate/discOpenClose exist" fails and the suite returns early.
- [x] **Step 3: Implement the kernel** in `js/morph.js` after `M.openClose`. This is the measured prototype (G.7), exact against brute force:

```js
  /**
   * Appendix G G1 (PO-FIX-1, G-D1): exact digital-disc window. hit[p] = 1 iff some indicator pixel q (src[q] !== 0, or
   * src[q] === 0 when invert) has |p − q|² ≤ R2 (integer); pixels outside the image are never indicators. g = vertical
   * distance to the nearest indicator in p's column, capped at C = A + 1 (A = ⌊√R2⌋), from a down and an up row-major
   * sweep; hw[t] = max{a : a² ≤ R2 − t²} for t ≤ A, −1 beyond; per row, hit[x] iff ∃ q: |x − q| ≤ hw[g[q]], from a left
   * and a right "reach" sweep. O(w·h) for any R2; integer arithmetic only (NFR-05). Without erodeOf: returns out (0/1).
   * With erodeOf (a copy of the mask): sets erodeOf[p] = 0 where hit and returns it.
   */
  function discWindow(src, w, h, R2, invert, erodeOf) {
    let A = Math.floor(Math.sqrt(R2)); while (A * A > R2) A--; while ((A + 1) * (A + 1) <= R2) A++;
    const C = A + 1, n = w * h, g = C > 255 ? new Uint16Array(n) : new Uint8Array(n), hw = new Int32Array(C + 1).fill(-1);
    for (let t = 0; t <= A; t++) { const v = R2 - t * t; let a = Math.floor(Math.sqrt(v)); while (a * a > v) a--; while ((a + 1) * (a + 1) <= v) a++; hw[t] = a; }
    if (invert) {
      for (let i = 0; i < w && i < n; i++) g[i] = src[i] === 0 ? 0 : C;
      for (let i = w; i < n; i++) { if (src[i] === 0) g[i] = 0; else { const d = g[i - w] + 1; g[i] = d < C ? d : C; } }
    } else {
      for (let i = 0; i < w && i < n; i++) g[i] = src[i] !== 0 ? 0 : C;
      for (let i = w; i < n; i++) { if (src[i] !== 0) g[i] = 0; else { const d = g[i - w] + 1; g[i] = d < C ? d : C; } }
    }
    for (let i = n - w - 1; i >= 0; i--) { const d = g[i + w] + 1; if (d < g[i]) g[i] = d; }
    const out = erodeOf || new Uint8Array(n), reach = new Int32Array(w);
    for (let y = 0, o = 0; y < h; y++, o += w) {
      let r = -1;
      for (let x = 0; x < w; x++) { const v = hw[g[o + x]]; r = r - 1 > v ? r - 1 : v; reach[x] = r; }
      r = -1;
      if (!erodeOf) for (let x = w - 1; x >= 0; x--) { const v = hw[g[o + x]]; r = r - 1 > v ? r - 1 : v; out[o + x] = r >= 0 || reach[x] >= 0 ? 1 : 0; }
      else for (let x = w - 1; x >= 0; x--) { const v = hw[g[o + x]]; r = r - 1 > v ? r - 1 : v; if (r >= 0 || reach[x] >= 0) out[o + x] = 0; }
    }
    return out;
  }
  M.discErode = (mask, w, h, R2) => (R2 < 1 ? mask.slice() : discWindow(mask, w, h, R2, true, mask.slice()));
  M.discDilate = (mask, w, h, R2) => (R2 < 1 ? Uint8Array.from(mask, (v) => (v ? 1 : 0)) : discWindow(mask, w, h, R2, false, null));
  M.discOpenClose = (mask, w, h, R2o, R2c) =>
    M.discErode(M.discDilate(M.discDilate(M.discErode(mask, w, h, R2o), w, h, R2o), w, h, R2c), w, h, R2c);
```

  **The kernel above is exact but not fast enough (review 2026-10-09, re-measured on 3985 × 3000 blobby masks).** `SBMorph.openClose(8, 7)` takes 264-373 ms and `discOpenClose(49, 49)` 814-1124 ms: a ratio of 3.1-3.4 ×, already at or over the 3.0 × hard limit. A sparse mask gives 270 vs 805 ms. The previously planned "skip empty rows, word-skip all-zero runs" gain nothing on dense art, and the former "≤ 2 ×" expectation is unsupported. The optimisation work is therefore a measured loop, not a checklist:
  1. **Bench first.** Land `bench morph` (Step 7) with a dense blobby mask, a sparse mask and the real fusion2 layers before touching the kernel, and record the unoptimised ratio.
  2. **Candidates, in this order; each is kept only if it lowers the dense-mask p50 and keeps the brute-force test green** (the exactness suite covers the Uint8/Uint16 boundary at R² = 65024/65025/65026 and passes today):
     - *Fewer passes.* Erosion and dilation each cost a down sweep, an up sweep and two reach sweeps. Share the `g` and `reach` scratch planes across the four calls of one `discOpenClose` (no per-call allocation of 12 MB planes), and fuse the up sweep with the first reach sweep of the same row band.
     - *Row bands.* Process the reach sweeps in bands of ~64 rows so `g` rows, `reach` and the output stay in L2, and keep the vertical sweeps streaming.
     - *Run-length rows.* Build, per row, the list of `g ≤ A` runs and emit `out` run by run (the reach of a run of equal `g` is one fill), which helps blobby art whose rows are long runs; it does nothing for noisy art, so keep it only if the dense and the real-layer rows both gain.
     - *Branch-free reach.* Replace the `r - 1 > v ? ...` pair by integer `Math.max`-free arithmetic only if the profile shows branch mispredictions (the real layers are run-heavy, so they may not).
  3. **Decision rule (binding).** After at most two optimisation rounds measure the dense, sparse and real-layer ratios (p50, interleaved, 5 runs, load noted):
     - ratio ≤ 2.0 × on the real fusion2 layers and ≤ 3.0 × on the dense mask: ship, budgets as in G.7;
     - between those and 3.0 × on the real layers: ship, and the **absolute cumulative gates** of G.7 (S2 p95, construct +1.0 s) decide;
     - above 3.0 × on the real layers: **stop**, do not ship. Take the fallback in G.9 #1 to the product owner; the 4 s EDT prototype is never shipped.
- [x] **Step 4: Wire the disc into construct and engine.**
  - **`js/construct.js`:**
    - `checkPx` accepts `discR2` (`undefined`, or a non-negative safe integer, otherwise `CONSTRUCT_ARG`).
    - Add:

```js
  /** Appendix G G1 (G-D1): the bonded chain — disc open/close at R2 = discR2 (same R2 both), or the square chain when R2 is 0. */
  function morphDisc(mask, w, h, px, cull) {
    const M = global.SBMorph, r = px.featR;
    const R2 = px.discR2 === undefined ? r * r - r : px.discR2;
    if (r === 0 || R2 === 0) return morph(mask, w, h, px, cull);   // featR 0: no morphology; R2 0: draft-only square fallback
    const m = M.discOpenClose(mask, w, h, R2, R2);
    const specks = cull ? M.removeSpecks(m, w, h, px.speckPx) : 0;
    const holes = M.fillHoles(m, w, h, px.holePx);
    return { m, specks, holes };
  }
  C._morphDisc = morphDisc;
```

    - The bonded branch of `constructLayer` calls `morphDisc(mask, w, h, px, !!px.cullEnabled)`.
    - The header px contract documents `discR2`.
  - **`js/engine.js` `constructPx`:**

```js
    // Appendix G G-D1 tie rule: F = minimum feature in px (rounded to 1e-9 so binary noise cannot move a tie), m = ⌊(⌊F⌋ + 1)/2⌋, R² = m² for F ≥ 3, else 0
    const F = featUm > 0 ? Math.round((featUm / pMax) * 1e9) / 1e9 : 0, mHalf = F >= 3 ? Math.floor((Math.floor(F) + 1) / 2) : 0;
    // … in the returned object:
      discR2: mHalf * mHalf,   // bonded disc R² (integer); connected ignores it
```

    and `E._constructPx = constructPx;` next to the other test hooks. `featR` itself is unchanged (connected mode and the R² = 0 fallback use it).
  - **Docs:** update the `js/morph.js` header (the disc section and the border behaviour), `docs/ALGORITHMS.md` §3 (bonded: exact digital disc with R² = m², m = ⌊(⌊F⌋ + 1)/2⌋, the tie rule and why 2m − 1 and 2m px are indistinguishable; **the image-border behaviour change for art touching the edge**; connected: the v1.1 square chain), and `docs/ARCHITECTURE.md` (the G-D1 paragraph).
- [x] **Step 5: Run the new suite.** Run `node test/run_tests.js --only "Appendix G G1"`. Expected: PASS (all checks).
- [x] **Step 6: Re-capture the golden and make the F1 check chain-aware.**
  1. Make the F1 check chain-aware (`test/run_tests.js:6186-6192`):

```js
  // Appendix G G-D6: F1's ids may be re-captured again later; compare F1's previous digest with what F1 produced
  const after = (task, id) => { const recs = gold.recaptured || [], i = recs.findIndex((r) => r.task === task);
    const later = recs.slice(i + 1).find((r) => r.ids.includes(id)); return later ? later.previous[id] : gold.fixtures[id]; };
  const off = f1 ? f1.ids.filter((id) => !f1.previous || !f1.previous[id] || keep.some((k) => JSON.stringify(f1.previous[id][k]) !== JSON.stringify(after("F1", id)[k])) ||
    f1.previous[id].diagSha === after("F1", id).diagSha) : ["(no F1 recapture record)"];
```

  2. Re-capture. The ids are every bonded corpus fixture:

```bash
IDS=$(node -e 'const fs=require("fs"),path=require("path"),vm=require("vm");globalThis.crypto??=require("crypto").webcrypto;
for (const f of require("./test/modules.js").NODE_MODULES) vm.runInThisContext(fs.readFileSync(path.join("js",f),"utf8"),{filename:f});
console.log(require("./test/pool_corpus.js").corpus().filter((f)=>f.project.construction.mode==="bonded-relief").map((f)=>f.id).join(","))')
node test/capture_golden.js --pool-equality --recapture "$IDS" --task G1
```

     `capture_golden.js` captures every named fixture, slow ones included, and keeps their `slow` tags.
  3. Add a check: `G-D6 G1 re-captured exactly the bonded fixtures; every connected fixture's digest is unchanged`. It asserts that the `G1` record's ids equal the bonded corpus ids and that no connected id appears **in the G1 record** (review 2026-10-09). It must **not** assert this for later G records: `NECK_KERF` is evaluated in connected mode too and the G3 octagon changes `NECK_NARROW`/`FEATURE_MARGINAL` in every mode, so the G2 and G3 recaptures can legitimately include connected ids, with only `diagSha`/`wholeSha` changed (G-D6; each of those tasks asserts `geometryHash` and `layerHashes` unchanged for connected ids).
- [x] **Step 6b: Re-run and record the E3b draft fidelity check (review 2026-10-09).** The radius rule changes the draft cleanup (fabrication 0.25 mm/px: square r = 3 becomes the disc R² = 9; the 0.75 mm/px draft stays on the square r = 1). Run `node test/run_tests.js --only "E3b"` (the check at `test/run_tests.js:5472-5492`), record the new margins next to the old ones (area 2.28 % against 8 %, part ratio 1.75 against 2) in the G1 Result note, and add a plan note if a margin moves toward its limit. **Never loosen the thresholds**: a failing margin stops G1 and goes to the product owner.
- [x] **Step 7: Run the perf gate (G.7).**
  1. Add `bench morph` to `test/bench.js`: 3985 × 3000, the alpha.3 scene's layer masks at 0.1 mm/px (`stages` as in `neckrepro/stages.js`, or the user12 scene). Per layer, `SBMorph.openClose(m, 8, 7)` vs `discOpenClose(m, 49, 49)`, interleaved, 5 runs, p50. `--record` writes `docs/perf/speed-round.json` `appendixG.morph`.
  2. Gates (G.7 has the table; the absolute cumulative gate is the binding one):
     - disc / square on the real fusion2 layers and on the dense mask, p50, as the decision rule of Step 3 (target ≤ 2.0 ×, ≤ 3.0 × allowed only with the absolute gates passing; above 3.0 × on the real layers G1 does not ship);
     - "NFR-03 bonded construction at fabrication radius" (`test/run_tests.js:3911-3913`) stays < 2.5 s;
     - `node test/bench.js large --only user12 --pool 8 --rows fab4096 --runs 5`: **p95** ≤ 10 s (the S2 rule) **and** ≤ `phaseB.fab4096.pooledWallMs` (8794 ms) + 1.2 s cumulative; the construct stage within +1.0 s of the same record;
     - the same bench with `--pool 0` (serial fallback): **record** the serial total (phaseB: 12879 ms; the disc adds roughly 4-5 s over eight layers) in the G1 Result note;
     - `node test/bench.js draft --only a --candidates 720` warm p95 ≤ 3.0 s (E4 rule).
  3. Record the numbers in the plan's G1 Result note.
- [x] **Step 8: Run the full suite, build and commit.**
  1. Run `node test/run_tests.js`: 0 failed.
  2. `node build.js`
  3. Commit:

```bash
git add js/morph.js js/construct.js js/engine.js test/oracle_kernels.js test/run_tests.js test/bench.js test/neck_fixtures test/golden/pool-equality.json docs/ALGORITHMS.md docs/ARCHITECTURE.md docs/perf/speed-round.json dist/shadowbox-studio.html
git commit -m "fix(morph,construct,engine): G1 exact Euclidean-disc open/close for bonded construction (PO-FIX-1, GEO-05, D-4.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Result (2026-10-09):**
- **Kernel.** `SBMorph.discErode`/`discDilate`/`discOpenClose` as specified, exact against `oracleDisc`. The Step 3 sweep kernel was 3.2 × the square chain on the real layers (re-measured: dense 3.24 ×, sparse 2.92 ×, fusion2 3.21 ×), so one optimisation round was taken: all four sweeps run on 4-byte words (SWAR; every byte stays ≤ 127, so no carry crosses a byte) on a 4-aligned padded stride, the reach sweeps skip words that are all-cap (no reach) or all-zero (indicators), and `discOpenClose` shares one scratch (distance plane and row buffers) across its four windows. The word path is used while ⌊√R²⌋ + 1 ≤ 126 (R² < 15876); above that the Step 3 byte/Uint16 kernel runs unchanged (tests at the word/scalar boundary R² 15624/15875/15876 and the Uint8/Uint16 boundary 65024/65025/65026 against brute force). Output is always 0/1.
- **`bench morph`** (`node test/bench.js morph --runs 5 --record`, R² 64 = the production radius at 1.5 mm and 0.1 mm/px; `docs/perf/speed-round.json` `appendixG.morph`; load 2.7–4.8): dense 302 → 514 ms (**1.70 ×**), sparse 278 → 337 ms (1.21 ×), user12 layers Σ 1785 → 2357 ms (**1.32 ×**, max layer 1.43 ×), fusion2 layers Σ 1749 → 2417 ms (**1.38 ×**, max layer 1.43 ×). Decision rule: ≤ 2.0 × on the real layers and ≤ 3.0 × dense → **ship**, budgets as in G.7.
- **Gates** (`appendixG.g1`): user12 fab4096 pool 8 p50 6050 / **p95 6997 ms** (≤ 10 s and ≤ 8794 + 1200 ms: pass); the pre-round tree back to back: p95 6054 ms; construct stage p50 1245 ms vs 1297 ms pre-round (within +1.0 s). Serial fallback (pool 0, recorded): p50 11998 / p95 12195 ms (phaseB serial 12879 ms). Warm draft 720 (plywood a, realistic): **p95 2958 ms** (≤ 3.0 s: pass, but with only 42 ms of headroom; the draft at 720 px has F < 3, so it runs the square fallback and the disc is not the cause). "NFR-03 bonded construction at fabrication radius" 310 ms (< 2.5 s).
- **Bench fix.** `benchUser12Final` (F18) compared `geometryHash` across runs, but each run has its own `sampleHash`, which is part of `geometryHash`; every multi-run row threw "geometryHash differs between runs", on the pre-round tree too (F18 never ran it, `final` is still pending). Runs are now compared on the hash of their layer hashes.
- **Golden.** `pool-equality.json` re-captured with `--task G1` for the 39 bonded ids. Geometry changed on 7 (a3-900/1800-fabrication, t-bonded-frame-draft/-fabrication, alpha-domain-draft/-fabrication, fine-pitch-fabrication); the other 32 are byte-identical (small rasters or F < 3, the square fallback). No connected id is in the record; `oldrun.json` unchanged. The F1 check is chain-aware.
- **E3b draft fidelity (Step 6b)**, same fixture, measured on this tree vs the pre-round tree: worst area deviation **3.03 %** (layer 7) vs 2.28 % against the 8 % limit; worst part-count ratio **1.70** (10 vs 17, layer 5) vs 1.80 (10 vs 18) against 2. **Plan note:** the area margin moved toward its limit by 0.75 points (fabrication 0.25 mm/px now runs the disc R² 9 while the 160 px draft stays on the square r = 1); still 4.97 points inside, threshold not loosened.
- Full suite: 2014 passed, 0 failed (1971 at the round baseline plus the G1 suite and checks added since).


---

#### Task G2 (PO-FIX-2): Sub-kerf necks and point contacts are blocking (D3 extension)

**Files:**
- Modify: `js/support.js`:
  - `erode` `:340-353`: options `{join, scale}`;
  - `featureHead` `:369-401`: validate `kerfMM`, `pointContacts`;
  - `featureLayer` `:403-433`: kerf erosion, point-contact scan;
  - header `:51-70`.
- Modify: `js/diag.js`:
  - `TABLE` (blocking block): `NECK_KERF`, `PART_POINT_CONTACT`;
  - `AGGREGATED` `:225` (`NECK_KERF` only).
- Modify: `js/engine.js`:
  - `fcfg` `:1081-1082`;
  - `E.legacyDiagnostics` `:226-227`.
- Modify: `test/run_tests.js`:
  - PLAN code list `:1785-1793`;
  - new suite `support.js — Appendix G G2 kerf necks and point contacts (PO-FIX-2, D3, GEO-02/05)`.
- Modify: `test/golden/pool-equality.json` (recapture, task G2: `diagSha`/`wholeSha` only; connected ids may be included, G-D6).
- Modify: `docs/ARCHITECTURE.md` (D3 extension; this round's docs commit already adds the decision text, and G2 adds "Implemented in `js/support.js` (G2)").

**Interfaces:**
- Consumes: `SBGeom.offset(polys, delta, "square")`, `SBGeom.components`, `SBMaterial` part objects `{id, polygon, bbox}`.
- Produces:
  - `featureChecks`/`featureLayer` cfg gains `kerfMM` (finite ≥ 0, or `null`/absent = no machine) and `pointContacts` (boolean, default `false`; the engine passes `true` in bonded mode).
  - New diagnostics:
    - `NECK_KERF` (blocking): `{layer, part, region, measured: null, limit: {value: T/1000, unit: "mm"}, detail}`;
    - `PART_POINT_CONTACT` (blocking): `{layer, parts: [a, b], region: [x−0.5, y−0.5, x+0.5, y+0.5] mm, detail}`, one per contact point.
  - `erode(parts, idx, halfUnits, src, {join = "miter", scale = 1})`: `src(i)` returns polygons at the given scale (1 or 2).

- [ ] **Step 1: Write the failing tests.**

```js
suite("support.js — Appendix G G2 kerf necks and point contacts (PO-FIX-2, D3, GEO-02/05)", () => {
  const mk = (layers, w, h) => SBMaterial.assignParts(SBMaterial.fromMasks(layers.length === w * h ? [new Uint8Array(w * h).fill(1), layers] : layers, w, h, { artWMM: w * 0.1, artHMM: h * 0.1, frameMM: 0 }, {}));   // a single mask = the upper layer over a full base
  const codes = (ds) => ds.map((d) => d.code), base = { minFeatureMM: 1.5, advisoryFeatureMM: 2, minPartMM2: 0, mmPerPxMax: 0.1, calibrated: true };
  check("G2 codes registered as blocking", ["NECK_KERF", "PART_POINT_CONTACT"].every((c) => SBDiag.CODES[c] && SBDiag.CODES[c].severity === "blocking"));
  // two 6 mm blocks joined by an axis neck of n px (0.1 mm/px)
  const neck = (n) => { const w = 160, h = 80, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x >= 10 && x < 70 && y >= 10 && y < 70) || (x >= 90 && x < 150 && y >= 10 && y < 70) || (x >= 70 && x < 90 && y >= 40 && y < 40 + n) ? 1 : 0;
    return mk([new Uint8Array(w * h).fill(1), m], w, h); };
  const run = (L, cfg) => SBSupport.featureChecks(L, Object.assign({}, base, cfg));
  check("PO-FIX-2 a 0.1 mm neck with the 0.15 mm kerf → NECK_KERF (blocking), no NECK_NARROW for that part",
    codes(run(neck(1), { kerfMM: 0.15 })).includes("NECK_KERF") && !codes(run(neck(1), { kerfMM: 0.15 })).includes("NECK_NARROW"));
  check("PO-FIX-2 a 0.2 mm neck with the 0.15 mm kerf → NECK_NARROW (warning) only", (() => { const c = codes(run(neck(2), { kerfMM: 0.15 })); return c.includes("NECK_NARROW") && !c.includes("NECK_KERF"); })());
  check("G.4 #3 no machine (kerfMM null): 0.5 µm floor, a 0.1 mm neck is not NECK_KERF", !codes(run(neck(1), { kerfMM: null })).includes("NECK_KERF"));
  check("G.4 #3 kerf 0 behaves as the floor", !codes(run(neck(1), { kerfMM: 0 })).includes("NECK_KERF"));
  const nk = run(neck(1), { kerfMM: 0.15 }).find((d) => d.code === "NECK_KERF");
  check("PO-FIX-2 NECK_KERF carries the limit in mm and the layer", !!nk && nk.layer === 1 && nk.limit.value === 0.15 && nk.limit.unit === "mm");
  check("G-D2 an odd kerf (0.151 mm, scale 2) still flags a 0.1 mm neck and not a 0.2 mm one", codes(run(neck(1), { kerfMM: 0.151 })).includes("NECK_KERF") && !codes(run(neck(2), { kerfMM: 0.151 })).includes("NECK_KERF"));
  { // cost control (review 2026-10-09): no kerf, no pass; a kerf adds exactly one extra offset per layer, at scale 1 for an even T
    const calls = (cfg) => { const o = SBGeom.offset, seen = []; SBGeom.offset = (p, d, j) => (seen.push(d + ":" + j), o(p, d, j));
      try { run(neck(2), cfg); } finally { SBGeom.offset = o; } return seen; };
    check("G-D2 kerfMM null/0: the kerf erosion pass is skipped (no −75 offset)", !calls({ kerfMM: null }).some((c) => /^-75:/.test(c)) && !calls({ kerfMM: 0 }).some((c) => /^-75:/.test(c)));
    check("G-D2 kerfMM 0.15: one square-join offset of −75 µm at scale 1", calls({ kerfMM: 0.15 }).filter((c) => c === "-75:square").length === 1); }
  // point contact: two 3 mm squares touching at one corner (pixel saddle)
  const saddle = (() => { const w = 80, h = 80, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x >= 10 && x < 40 && y >= 10 && y < 40) || (x >= 40 && x < 70 && y >= 40 && y < 70) ? 1 : 0;
    return mk([new Uint8Array(w * h).fill(1), m], w, h); })();
  const pc = run(saddle, { kerfMM: 0.15, pointContacts: true }).filter((d) => d.code === "PART_POINT_CONTACT");
  // end-to-end (review 2026-10-09): the same saddle through bonded construction. The disc closing turns the contact into a thin neck: one part,
  // NECK_NARROW (a warning, above the kerf), no PART_POINT_CONTACT. The guarantee is for waste, not material (G-D2, G.9 #8).
  { const w = 80, h = 80, m = new Uint8Array(w * h), px = { featR: 8, discR2: 64, bridgeR: 9, cullPx: 1000, maxBridgePx: 400, speckPx: 1000, holePx: 450, frameAnchored: false, cullEnabled: false };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x >= 10 && x < 40 && y >= 10 && y < 40) || (x >= 40 && x < 70 && y >= 40 && y < 70) ? 1 : 0;
    const fin = SBConstruct.bonded([new Uint8Array(w * h).fill(1), m], w, h, px).final, L = mk(fin, w, h), c = codes(run(L, { kerfMM: 0.15, pointContacts: true }));
    check("PO-FIX-2/G.9 #8 saddle after bonded construction: one part, NECK_NARROW (warning), no PART_POINT_CONTACT, no NECK_KERF",
      L[1].parts.length === 1 && c.includes("NECK_NARROW") && !c.includes("PART_POINT_CONTACT") && !c.includes("NECK_KERF")); }
  check("PO-FIX-2 two parts touching at a vertex → one PART_POINT_CONTACT naming both parts, region around (4 mm, 4 mm)",
    pc.length === 1 && (pc[0].parts || []).length === 2 && Array.isArray(pc[0].region) && pc[0].region.every((v, i) => Math.abs(v - [3.5, 3.5, 4.5, 4.5][i]) < 1e-9));
  check("PO-FIX-2 pointContacts false (connected): no PART_POINT_CONTACT", !codes(run(saddle, { kerfMM: 0.15 })).includes("PART_POINT_CONTACT"));
  check("D3 4 a part touching its own hole at a point is not a point contact (G.9 #2)", (() => { const w = 60, h = 60, m = new Uint8Array(w * h).fill(0);
    for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) m[y * w + x] = 1; for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) m[y * w + x] = 0;
    for (let y = 30; y < 40; y++) for (let x = 30; x < 40; x++) m[y * w + x] = 0;   // two holes touching at (30, 30)
    return !codes(run(mk([new Uint8Array(w * h).fill(1), m], w, h), { kerfMM: 0.15, pointContacts: true })).includes("PART_POINT_CONTACT"); })());
  check("G2 featureHead refuses a negative or non-finite kerfMM", ["x", -1, NaN].every((k) => { try { run(neck(2), { kerfMM: k }); return false; } catch (e) { return /kerfMM/.test(e.message); } }));
  check("EXP-07 NECK_KERF blocks the export gate", SBDiag.exportGate([nk], new Set(), { quality: "draft", geometryHash: "x" }, "draft").reason === "BLOCKING");   // cfg quality defaults to draft
  // engine wiring: bonded plywood request passes the machine kerf and pointContacts
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8");
  check("G2 engine passes kerfMM and pointContacts to both featureChecks calls", /kerfMM:\s*[^,]*machine/.test(src) && (src.match(/pointContacts:/g) || []).length >= 2);
});
```

  Add `"NECK_KERF", "PART_POINT_CONTACT"` to `PLAN.blocking` (`test/run_tests.js:1786-1788`).
- [ ] **Step 2: Run the new suite and confirm it fails.** Run `node test/run_tests.js --only "Appendix G G2"`. Expected FAIL ("G2 codes registered as blocking").
- [ ] **Step 3: Implement the two checks and the engine wiring.**
  - **`js/diag.js`:** add to the blocking geometry block:

```js
    ["NECK_KERF", B, F, "Neck is narrower than the laser kerf",
      "The kerf cuts through it and the part falls apart: widen the neck, raise the minimum feature size so cleanup removes it, or clip it."],
    ["PART_POINT_CONTACT", B, F, "Parts touch only at a point",
      "The laser separates parts that touch at a point; widen the contact to at least the minimum feature, or move them apart by more than the kerf."],
```

    Add `NECK_KERF` to `AGGREGATED`, but not to `GEO05` (it is not a conservative warning). Do not aggregate `PART_POINT_CONTACT` (G-D2).
  - **`js/support.js` `erode`:**
    - It takes `opts = {join: "miter", scale: 1}`.
    - It offsets with `opts.join`.
    - It compares bboxes in scaled units: `src(i)` returns polygons at `opts.scale`, and the attribution uses part bboxes × scale.
    - A helper `scaled(polys, s)` multiplies every ring coordinate by s; `s === 1` returns `polys` itself.
  - **`featureLayer` kerf step,** before `e1` (G-D2: no kerf, no pass; scale 1 for an even T, 2 for an odd one; no ×4):

```js
    const kerfUm = cfg.kerfMM === undefined || cfg.kerfMM === null ? 0 : Math.round(cfg.kerfMM * 1000);
    let ek = null, kerfNeck = new Set();
    if (kerfUm > 0) { const T = kerfUm, S = T % 2 ? 2 : 1;   // half of T µm as an integer delta: −T/2 at scale 1, −T at scale 2 (half-µm units)
      ek = erode(parts, all, (T * S) / 2, (i) => scaled([parts[i].polygon], S), { join: "square", scale: S });
      kerfNeck = new Set(all.filter((i) => ek.count.get(i) > 1)); }
```

    Per part with `kerfNeck.has(i)`, push `NECK_KERF` with `limit {value: kerfUm / 1000, unit: "mm"}`, detail `"the part splits into n pieces at the " + kerfUm / 1000 + " mm kerf"` and region = the part bbox (G3 replaces it with the neck). Then skip `NECK_NARROW` and neck-`FEATURE_MARGINAL` for that part. The bboxes `erode` uses to skip parts that cannot survive are compared in the same scale (`2·half` in scaled units).
  - **Point-contact scan** (only when `cfg.pointContacts`). A `Map` over every ring vertex of a fusion2-scale layer is wasteful (tens of thousands of vertices, almost none shared), so a bbox sweep first selects the parts whose bbox touches another part's bbox (inclusive); only their vertices enter the map:

```js
    // G-D2: every inter-part point contact is a vertex shared by two parts' rings after normalize (D3 2.1–2.3)
    const owner = new Map(), seen = new Set(), cand = new Set(), bb = (p) => p.bbox || G.bbox(p.polygon);
    if (cfg.pointContacts && parts.length > 1) {
      const order = all.slice().sort((a, b) => bb(parts[a])[0] - bb(parts[b])[0] || a - b);
      for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
        const A = bb(parts[order[a]]), B = bb(parts[order[b]]);
        if (B[0] > A[2]) break;                                          // sorted by x0: no later part can touch A
        if (B[1] <= A[3] && B[3] >= A[1]) { cand.add(order[a]); cand.add(order[b]); } } }
    parts.forEach((p, i) => { if (!cand.has(i)) return; for (const r of [p.polygon.outer].concat(p.polygon.holes || [])) for (let j = 0; j < r.length; j += 2) {
      const key = (r[j] + 33554432) * 67108864 + (r[j + 1] + 33554432);   // exact for |x|, |y| < 2^25 µm (D4 range)
      const o = owner.get(key);
      if (o === undefined) owner.set(key, i);
      else if (o !== i && !seen.has(key)) { seen.add(key); const x = r[j] / 1000, y = r[j + 1] / 1000;
        diags.push(make("PART_POINT_CONTACT", { layer: k, part: null, parts: [parts[o].id, p.id], region: [x - 0.5, y - 0.5, x + 0.5, y + 0.5],
          detail: "parts " + parts[o].id + " and " + p.id + " touch only at (" + x + ", " + y + ") mm" })); } } });
```

    Ordering: contacts appear in part order, then ring order, then vertex order, which is deterministic (`cand` only filters). `featureHead` validates `kerfMM` (absent/`null`, or finite ≥ 0) and `pointContacts` (absent or boolean).
  - **`js/engine.js`:** add `kerfMM: p.machine ? p.machine.kerfMM : null, pointContacts: bonded` to `fcfg` (`:1081`), and `kerfMM: project.machine ? project.machine.kerfMM : null, pointContacts: project.construction.mode === "bonded-relief"` in `E.legacyDiagnostics` (`:226`).
  - Update the `js/support.js` header (the `featureChecks` bullet list). In `docs/ARCHITECTURE.md` D3, mark the G2 extension "Implemented (G2)".
- [ ] **Step 4: Run the new suite.** Run `node test/run_tests.js --only "Appendix G G2"`. Expected: PASS. Also confirm the existing Appendix C delta tests (`test/run_tests.js` ~624-640, cfg without `kerfMM`) stay green: with no kerf the pass is skipped, so their recorded `SBGeom.offset` deltas do not move in G2 (G3 rewrites them). If a fixture passes `kerfMM`, filter the kerf offset out of `deltas` there.
- [ ] **Step 5: Re-capture the diagnostics-only golden.**
  1. Run the full suite. Expected failures: F0 digest mismatches limited to `diagSha`/`wholeSha` of fixtures whose diagnostics gained `NECK_KERF`/`PART_POINT_CONTACT`. Connected fixtures (`h-connected-*`, `t-connected-*`, `n3-*`) can appear (`NECK_KERF` runs in connected mode too).
  2. List them from the failure message and re-capture with `--task G2`.
  3. Add the check `G-D6 G2 re-captured ids differ from their previous digests only in diagSha/wholeSha` (same shape as F1's, through `after("G2", id)`); for ids of connected fixtures it asserts the same and additionally `geometryHash` and `layerHashes` unchanged. It must not assert that the record has no connected ids.
  4. Record in the commit message which fixtures now block and why. Each must be a real point contact or sub-kerf neck: check the first one by hand with `SBDiag.describe`.
- [ ] **Step 6: Run the perf gate (cumulative, G.7).** Run `node test/bench.js large --only user12 --pool 8 --rows fab4096 --runs 5`. Compare with the **pre-round** record, not with G1: the `features` stage p50 ≤ 1.3 × its original `speed-round.json` value, and the pooled total p95 ≤ 10 s and ≤ `phaseB.fab4096.pooledWallMs` + 1.2 s. The mitigations are already in the design (no kerf, no pass; scale 1; bbox-gated point-contact scan); if the gate still fails, report the stage table to the product owner instead of loosening it. Record the numbers (and the serial `--pool 0` total) in the G2 Result note.
- [ ] **Step 7: Run the full suite, build and commit.**
  1. Run `node test/run_tests.js`: 0 failed.
  2. `node build.js`
  3. Commit `js/support.js js/diag.js js/engine.js test/run_tests.js test/golden/pool-equality.json docs/ARCHITECTURE.md dist/shadowbox-studio.html`: `feat(support,diag,engine): G2 sub-kerf necks and point contacts are blocking (PO-FIX-2, D3 extension)` + trailer.

---

#### Task G3 (PO-FIX-3): Octagonal feature erosion and neck regions

**Files:**
- Modify: `js/support.js`:
  - `featureLayer` `:403-433`;
  - remove `orthogonal` use at `:417-418` (keep the function only if another caller exists: grep first);
  - new `S.neckRegions`;
  - header.
- Modify: `test/run_tests.js`:
  - new suite `support.js — Appendix G G3 octagonal erosion and neck regions (PO-FIX-3, GEO-05, UI-04)`;
  - existing PO-LASER-6 strip checks (`:464-469`, `:581`) must stay green;
  - **existing Appendix C tests this task invalidates** (review 2026-10-09), updated here: (a) `'Appendix C layer-level erosion == per-part offset oracle (10 seeds)'` (~606-620) builds its oracle with `SBGeom.offset(..., "miter")`; it becomes a `"square"`-join oracle, direct on the part polygon; (b) `'Appendix C orthogonal layer: advisory erosion composed from the first residual (−750 then −250 µm)'` (~624) encodes the composition G3 removes: it becomes "orthogonal layer: both erosions direct (−750 and −1000 µm, square join), no composition"; (c) the diagonal-layer delta test after it (~636, `-750,-1000`) keeps its deltas but its `deltas` helper must record the join and ignore scale-2 kerf calls; (d) the `deltas` helper is extended to record `d + ":" + join` so the tests assert `"square"`.
- Modify: `test/golden/pool-equality.json` (task G3: `diagSha`/`wholeSha` only).
- Modify: `docs/ARCHITECTURE.md` (feature-check erosion sentence under D3 / GEO-05).

**Interfaces:**
- Produces: `SBSupport.neckRegions(poly, residual, halfUnits, scale) → [[x0, y0, x1, y1] mm, …]`. One bbox per lost component of `poly − offset(residual, +halfUnits, "square")` that touches at least two residual pieces (each piece offset by `halfUnits + 2·scale`). The list is sorted by (y0, x0) and capped at 8; it is `[]` when none is isolated.
- Each `NECK_NARROW`, `NECK_KERF` and neck-`FEATURE_MARGINAL` becomes **one raw diagnostic per neck region**: `part` is the part id and `region` is the neck bbox. `SBDiag.aggregate` then merges per (code, layer, kind), as today.
  - **Counts change meaning (review 2026-10-09).** A part with two necks appears twice in the aggregate's `parts[]`, so `SBDiag.describe(...).where` reads "n parts" for n necks and the aggregate `count` is per neck, not per part. The G5 row header therefore reads "n necks (m parts)" with m the number of distinct part ids; G5 tests it.
  - When `neckRegions` returns `[]`, one diagnostic gets the part bbox with detail suffix "(neck location approximate)".
  - `PART_THIN` and part-`FEATURE_MARGINAL` keep the part bbox.
  - **Cost bound (review 2026-10-09).** `lost = poly − offset(residual)` contains every chamfered convex corner and stair tooth of the part (octagon opening smooths the 0.1 mm staircase), so on a big fusion2 part `lost` has thousands of components. The locator is bounded in work, not only in output: lost components are first filtered by bbox against the pad bboxes (a component touching fewer than two pad bboxes is dropped without a Clipper call), and `G.intersection` runs only for the pads whose bbox overlaps the component (corner chips and stair teeth overlap at most one pad and never reach it). A test counts the Clipper calls. Measured 2026-10-09 on a chip-heavy prototype part (19 lost components, 2 pads): 2 intersection calls, one neck region.

- [ ] **Step 1: Write the failing tests.**

```js
suite("support.js — Appendix G G3 octagonal erosion and neck regions (PO-FIX-3, GEO-05, UI-04)", () => {
  const mk = (m, w, h) => SBMaterial.assignParts(SBMaterial.fromMasks([new Uint8Array(w * h).fill(1), m], w, h, { artWMM: w * 0.1, artHMM: h * 0.1, frameMM: 0 }, {}));
  const cfg = { minFeatureMM: 1.5, advisoryFeatureMM: 2, minPartMM2: 0, mmPerPxMax: 0.1, calibrated: true, kerfMM: 0.15 };
  const diag = (wpx) => { const w = 220, h = 220, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const A = x >= 20 && x < 80 && y >= 20 && y < 80, B = x >= 140 && x < 200 && y >= 140 && y < 200,
      S = Math.abs(x - y) / Math.SQRT2 <= wpx / 2 && x >= 50 && x <= 170; m[y * w + x] = A || B || S ? 1 : 0; } return mk(m, w, h); };
  const ds = (L) => SBSupport.featureChecks(L, cfg), has = (L, c) => ds(L).some((d) => d.code === c);
  check("PO-FIX-3 a 1.8 mm 45° neck is not NECK_NARROW at 1.5 mm (square erosion flagged anything < 2.12 mm)", !has(diag(18), "NECK_NARROW"));
  check("PO-FIX-3 a 1.8 mm 45° neck is FEATURE_MARGINAL (neck) at the 2.0 mm advisory", ds(diag(18)).some((d) => d.code === "FEATURE_MARGINAL" && d.detail && d.detail.kind === "neck"));
  const nn = ds(diag(10)).find((d) => d.code === "NECK_NARROW");
  const reg = nn && (Array.isArray(nn.region[0]) ? nn.region : [nn.region]);
  check("PO-FIX-3 a 1.0 mm 45° neck → NECK_NARROW whose region is the neck (inside x, y ∈ [5, 17] mm, < 8 mm wide), not the part bbox (2–20 mm)",
    !!reg && reg.length >= 1 && reg.every((b) => b[0] >= 5 && b[2] <= 17 && b[1] >= 5 && b[3] <= 17 && b[2] - b[0] < 8));
  // two necks in one part → two regions (G.4 #4)
  { const w = 300, h = 100, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x < 80 && y > 20 && y < 80) || (x >= 110 && x < 190 && y > 20 && y < 80) || (x >= 220 && y > 20 && y < 80) || (y >= 45 && y < 55) ? 1 : 0;
    const n = ds(mk(m, w, h)).filter((d) => d.code === "NECK_NARROW"), regs = n.flatMap((d) => (Array.isArray(d.region[0]) ? d.region : [d.region]));
    check("G.4 #4 a part with two 1.0 mm necks gets two neck regions, one per neck", regs.length === 2 && regs[0][2] <= 12 && regs[1][0] >= 18); }
  check("G3 neckRegions returns [] (no throw) when nothing is isolated", Array.isArray(SBSupport.neckRegions({ outer: [0, 0, 1000, 0, 1000, 1000, 0, 1000], holes: [] }, [], 100, 1)));
  // self-consistency with construction (review 2026-10-09, G-D1 tie rule): what the disc cleanup keeps is not flagged as too narrow
  { const C = SBConstruct, PX = { featR: 8, discR2: 64, bridgeR: 9, cullPx: 1000, maxBridgePx: 400, speckPx: 1000, holePx: 450, frameAnchored: false, cullEnabled: false };
    const kept = (wpx) => { const w = 220, h = 220, m = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const A = x >= 20 && x < 80 && y >= 20 && y < 80, B = x >= 140 && x < 200 && y >= 140 && y < 200,
        S = Math.abs(x - y) / Math.SQRT2 <= wpx / 2 && x >= 50 && x <= 170; m[y * w + x] = A || B || S ? 1 : 0; }
      return mk(C.bonded([new Uint8Array(w * h).fill(1), m], w, h, PX).final[1], w, h); };
    for (const wpx of [16, 17, 18, 22]) { const L = kept(wpx), c = ds(L).map((d) => d.code);
      check(`G1/G3 tie rule: a ${wpx / 10} mm 45° neck that construction keeps (one part) is not NECK_NARROW or PART_THIN`, L[1].parts.length === 1 && !c.includes("NECK_NARROW") && !c.includes("PART_THIN")); } }   // measured: 16 px and wider keep one part and pass the octagon
  // cost bound: a part with many lost chips but one real neck calls Clipper O(candidates), not O(lost × pads)
  { const w = 600, h = 200, m = new Uint8Array(w * h);   // two blocks, a 1.0 mm neck, and a staircase edge that makes the octagon opening chip every step
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x < 250 && y > 20 && y < 180 && (x < 200 || ((x + y) >> 2) % 2 === 0)) || (x >= 350 && y > 20 && y < 180) || (y >= 95 && y < 105) ? 1 : 0;
    const G = SBGeom, o = G.intersection; let n = 0; G.intersection = (a, b) => (n++, o(a, b));
    let regs; try { regs = ds(mk(m, w, h)).filter((d) => d.code === "NECK_NARROW"); } finally { G.intersection = o; }
    check("G3 neckRegions finds the neck and bounds its Clipper work (intersection calls ≤ 64 on a chip-heavy part)", regs.length >= 1 && n <= 64); }
});
```

- [ ] **Step 2: Run the new suite and confirm it fails.** Run `node test/run_tests.js --only "Appendix G G3"`. Expected FAIL: the 1.8 mm neck is flagged and the region is the part bbox.
- [ ] **Step 3: Implement the octagonal erosion and the neck locator.**
  - **`featureLayer`:**
    - `e1 = erode(parts, all, halfMin, (i) => [parts[i].polygon], {join: "square"})`;
    - `c2 = halfAdv <= halfMin ? null : erode(parts, pass, halfAdv, (i) => [parts[i].polygon], {join: "square"})` (keep `e2` for its residuals);
    - the G2 kerf erosion already uses `"square"`.
  - **`S.neckRegions`** (work-bounded; bbox prefilters before any Clipper call):

```js
  S.neckRegions = function (poly, residual, half, s) {
    const G = global.SBGeom, ov = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    if (!residual || residual.length < 2) return [];
    const P = s === 1 ? [poly] : scaled([poly], s);
    const opened = G.offset(residual, half, "square");
    const lost = G.components(G.normalize(G.difference(P, opened)));
    const pads = residual.map((r) => G.offset([r], half + 2 * s, "square")), padBox = pads.map((pd) => G.bbox(pd[0]));
    const out = [];
    for (const c of lost) {
      const cb = G.bbox(c[0]), cand = [];
      for (let i = 0; i < pads.length; i++) if (ov(cb, padBox[i])) cand.push(i);
      if (cand.length < 2) continue;                    // a corner chip or stair tooth touches at most one pad: no Clipper call
      let touch = 0;
      for (const i of cand) { const I = G.intersection(c, pads[i]); if (I.length && !G.isEmpty(I)) touch++; if (touch >= 2) break; }
      if (touch >= 2) out.push(cb.map((v) => v / s / 1000));
    }
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, 8);
  };
```

  - Call `neckRegions` with the residuals of the erosion that split the part: `e1.residual` (scale 1) for `NECK_NARROW`, `ek.residual` (scale 1 or 2, the kerf pass's scale, with `half = (T·S)/2`) for `NECK_KERF`, and the advisory erosion's residual for neck `FEATURE_MARGINAL`. Emit one diagnostic per region.
  - **`SBDiag.aggregate`** is unchanged. A part with two necks appears twice in `parts` with two regions, so `parts`/`region` stay index-aligned. G5 relies on this.
- [ ] **Step 4: Run the new suite and update the existing tests.** Run `node test/run_tests.js --only "Appendix G G3"` and `--only "support.js"`. Update the Appendix C oracle and delta tests as listed under Files, then expect PASS, with the PO-LASER-6 strip checks still passing.
- [ ] **Step 5: Re-capture the golden and run the perf gate.**
  - Re-capture with `--task G3` (diagnostics only; same check shape as G2, connected ids allowed with `geometryHash`/`layerHashes` unchanged).
  - Perf (cumulative, G.7): the features stage now runs the minimum-feature erosion, the advisory erosion (no longer composed from a cheap residual: a full-polygon offset), the kerf erosion, a point-contact scan and the neck locator, roughly three full offsets instead of about 1.3. Against the **original** `speed-round.json` value the `features` stage p50 must stay ≤ 1.7 × (the compounded G2 × G3 allowance, stated once), and the pooled total p95 ≤ 10 s and ≤ `phaseB.fab4096.pooledWallMs` + 1.2 s. If the stage exceeds 1.7 ×, measure which of the added passes dominates (kerf erosion, full-polygon advisory erosion, point-contact scan, locator) and report the stage table to the product owner with the candidate mitigations (for example restricting the advisory pass to parts that passed the minimum-feature erosion, which it already does, or sharing one offset between the kerf and minimum-feature passes when T and the minimum feature coincide); do not loosen the gate.
- [ ] **Step 6: Run the full suite, build and commit.**
  1. Run `node test/run_tests.js`: 0 failed.
  2. `node build.js`
  3. Commit `js/support.js test/run_tests.js test/golden/pool-equality.json docs/ARCHITECTURE.md dist/shadowbox-studio.html`: `fix(support): G3 octagonal feature erosion and neck regions (PO-FIX-3, GEO-05, UI-04)` + trailer.

---

#### Task G4 (PO-FIX-4): No guide score stubs

**Files:**
- Modify: `js/guides.js`: constants after `:37`, `buildPair` `:79-99`, header `:20-28`, and the `Object.freeze({ build, validate, params, buildPair, buildFold, validatePair })` literal at `:192` (it has no `G` alias, so the two new exports go into the literal).
- Modify: `test/run_tests.js`: new suite `guides.js — Appendix G G4 no score stubs (PO-FIX-4, ASM-01/02)`, and **one existing test**: `'ASM-03 a label that does not fit is GUIDE_OMITTED kind label on that sheet ...'` (~5908-5911) builds `Lsmall = mk(1, sq(10000, 10000, 3500, 3500))` (Rc 1.3 mm) and expects the guide to stay (`scorePaths[0].length === 1`, `omitted.length === 0`); that contradicts the 2 mm rule. Change the fixture to a 5.0 mm square (Rc 2.8 mm: the ring stays, and the 2.2 × 3.2 mm label box still does not fit). Verified 2026-10-09 by applying the filter to a scratch copy: with that one change all 24 `guides.js` checks pass; `'AT-14 crescent/donut/small part ...'` (~5900) stays green unchanged because its 1.5 mm square already has no Rc polygon.
- Modify: `test/golden/pool-equality.json` (task G4).

**Interfaces:**
- Produces:
  - `SBGuides.GUIDE_MIN_EXTENT_UM === 2000`;
  - `SBGuides._keepGuidePoly(poly, P) → boolean` (test hook);
  - `buildPair` output shape unchanged.

- [ ] **Step 1: Write the failing tests.**

```js
suite("guides.js — Appendix G G4 no score stubs (PO-FIX-4, ASM-01/02)", () => {
  // 0.1 mm/px; lower: full 40 × 40 mm; upper: a 20 mm, a 4.4 mm and a 3.4 mm square (Rc inset 1.1 mm → 17.8, 2.2, 1.2 mm)
  const w = 400, h = 400, up = new Uint8Array(w * h), sq = (x0, y0, s) => { for (let y = y0; y < y0 + s; y++) up.fill(1, y * w + x0, y * w + x0 + s); };
  sq(20, 20, 200); sq(260, 40, 44); sq(260, 200, 34);
  const L = SBMaterial.assignParts(SBMaterial.fromMasks([new Uint8Array(w * h).fill(1), up], w, h, { artWMM: 40, artHMM: 40, frameMM: 0 }, {}));
  const cfg = { mode: "inset-outline", concealInsetMM: 0.5, markFootprintMM: 0.2, allowanceMM: 0.5, labelHeightMM: 50 };   // no label fits: every path is a guide ring
  const b = SBGuides.build(L, cfg, { revision: 0, quality: "fabrication" });
  const ext = (f) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); y0 = Math.min(y0, f[i + 1]); y1 = Math.max(y1, f[i + 1]); } return Math.max(x1 - x0, y1 - y0); };
  check("G4 GUIDE_MIN_EXTENT_UM is 2000", SBGuides.GUIDE_MIN_EXTENT_UM === 2000);
  check("PO-FIX-4 no score ring has extent < 2 mm", b.scorePaths[0].length > 0 && b.scorePaths[0].every((f) => ext(f) >= 2000));
  check("PO-FIX-4 the 4.4 mm part keeps its guide ring (Rc 2.2 mm)", b.scorePaths[0].some((f) => ext(f) >= 2000 && ext(f) < 3000));
  const small = L[1].parts.find((p) => p.bbox[2] - p.bbox[0] === 3400);
  check("PO-FIX-4 the 3.4 mm part (Rc 1.2 mm) is GUIDE_OMITTED with the 2 mm reason", !!small && b.guides.omitted.some((o) => o.part === small.id && /2 mm/.test(o.reason)));
  check("ASM-02 validate still passes (no GUIDE_UNCONTAINED)", SBGuides.validate(L, b, cfg, { revision: 0, quality: "fabrication" }).length === 0);
  // interior-mark is out of scope (review 2026-10-09): the smallest cross arm is 0.6 mm, so the 2 mm rule must not touch it. Baseline measured before the change:
  // crosses of 3.0, 2.0 and 0.6 mm (two paths each), nothing omitted.
  const im = SBGuides.build(L, Object.assign({}, cfg, { mode: "interior-mark" }), { revision: 0, quality: "fabrication" });
  check("G4 interior-mark is unchanged: the 3.4 mm part still gets its 0.6 mm cross, nothing is omitted",
    im.scorePaths[0].map(ext).sort((a, c) => c - a).join() === "3000,3000,2000,2000,600,600" && im.guides.omitted.length === 0);
  check("G4 inset-outline emits exactly the 17.8 and 2.2 mm rings of the three parts (the 1.2 mm Rc ring is dropped)", b.scorePaths[0].map(ext).sort((a, c) => c - a).join() === "17800,2200");
});
```

- [ ] **Step 2: Run the new suite and confirm it fails.** Run `node test/run_tests.js --only "Appendix G G4"`. Expected FAIL: a 1.2 mm ring is emitted, and `GUIDE_MIN_EXTENT_UM` is undefined.
- [ ] **Step 3: Implement the filter.**

```js
  const GUIDE_MIN_EXTENT_UM = 2000;   // Appendix G G-D4: a score ring shorter than this is a stub, not a guide
  const extentOf = (r) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) { if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i]; if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1]; }
    return Math.max(x1 - x0, y1 - y0); };
  function keepGuidePoly(poly, P) {
    if (extentOf(poly.outer) < GUIDE_MIN_EXTENT_UM) return false;
    return P.fp <= 0 || off([poly], -P.fp).length > 0;
  }
```

  - In `buildPair`, compute `const RcG = interior ? Rc : Rc.filter((poly) => keepGuidePoly(poly, P))` and use `RcG` for attribution (`byPart`) and for the ring loop (`:99`). Interior-mark mode keeps `Rc` (G-D4). Skip any ring whose `extentOf(r) < GUIDE_MIN_EXTENT_UM` (inset-outline only).
  - In inset-outline mode a part without a kept polygon is omitted with `"no concealed guide area ≥ 2 mm"` when it had Rc polygons and with the existing `"no concealed area ≥ footprint"` when it had none (`js/guides.js:98`); interior-mark reasons are unchanged. Keep the extent test before the footprint-inset offset (`keepGuidePoly` already does).
  - The label placement keeps `Rc`.
  - Export `GUIDE_MIN_EXTENT_UM` and `_keepGuidePoly` **inside the `Object.freeze({...})` literal** (`:192`); there is no mutable `G` alias, and an assignment after the freeze would throw in strict mode. Update the header.
- [ ] **Step 4: Run the new suite.** Run `node test/run_tests.js --only "Appendix G G4"`. Expected: PASS.
- [ ] **Step 5: Re-capture the golden and run the perf check.**
  - Re-capture with `--task G4` for the guide fixtures that changed (`guidesSha`, `layerHashes`, `geometryHash`, `diagSha`, `wholeSha` may differ; others not; check shape as G2 with that field list).
  - Perf: the `guides` stage p50 at fab4096 must not exceed its G3 value by more than 10 % (the filter drops rings, but it adds one footprint-inset offset per Rc polygon that passes the extent test; the extent test runs first), and the pooled total p95 stays ≤ 10 s (G.7).
- [ ] **Step 6: Run the full suite, build and commit.**
  1. Run `node test/run_tests.js`: 0 failed.
  2. `node build.js`
  3. Commit `js/guides.js test/run_tests.js test/golden/pool-equality.json dist/shadowbox-studio.html`: `fix(guides): G4 drop guide score stubs below 2 mm or the footprint inset (PO-FIX-4)` + trailer.

---

#### Task G5 (PO-FIX-5): Review UI — merged rows, "Acknowledge all", one listing

**Files:**
- Modify: `js/proof.js` (after `P.panelModel` `:261-273`): `P.diagRows`, `P.ackAllPlan`, `P.fabListedIn`.
- Modify: `js/app.js`:
  - `renderDiagnostics` `:521-570`;
  - `diagItem` `:609-660`;
  - new `diagRow`, `ackAllControl`;
  - `refreshDiagnostics` `:590-593`;
  - `renderFabReview` `:1263-1270`.
- Modify: `css/app.css`: `.diag-row-focus`, `.diag-ackall`, `.diag-confirm`.
- Modify: `test/run_tests.js`: new suite `proof.js/app.js — Appendix G G5 review rows and acknowledge all (PO-FIX-5, UI-04/05, §9.5)`.

**Interfaces:**
- Produces:
  - `SBProof.diagRows(diags) → [{key, code, layer, severity, title, members: Diagnostic[], count, partCount, focus: [{label, layer, parts: string[], regions: number[][]}]}]`:
    - rows group the diagnostics with the same (code, layer) (layer `null` groups by code), in the order of first occurrence;
    - `count` = Σ (`member.count || 1`) (after G3 this counts **necks** for the neck codes: one part with two necks is two items); `partCount` = the number of distinct part ids over the focus entries, which the row header shows as "n necks (m parts)" when they differ;
    - `focus` has one entry per (part, region) pair: an aggregated member with index-aligned `parts`/`region` arrays gives one entry per index, and otherwise one entry per member from `SBDiag.describe(member).focus`;
    - `label` is `"part " + id` (`"part 3 (2)"` for the second entry of the same part).
  - `SBProof.ackAllPlan(diags, code, hash, acks) → {code, hash, keys: string[], count}`: the `SBDiag.ackKey(d, hash)` of every **warning** of that code not in `acks`; `[]` for blocking/info codes.
  - `SBProof.fabListedIn({shownIsFab: boolean, fabReviewVisible: boolean}) → "fab-review" | "panel"`: `"fab-review"` iff both are true.

- [ ] **Step 1: Write the failing tests.**

```js
suite("proof.js/app.js — Appendix G G5 review rows and acknowledge all (PO-FIX-5, UI-04/05, §9.5)", () => {
  const P = SBProof, D = SBDiag, mk = (code, f) => D.make(code, Object.assign({ revision: 0, quality: "fabrication" }, f));
  const ds = [mk("SUPPORT_NARROW", { layer: 2, part: "2-1", region: [0, 0, 1, 1] }), mk("SUPPORT_NARROW", { layer: 2, part: "2-4", region: [5, 5, 6, 6] }),
    mk("SUPPORT_NARROW", { layer: 3, part: "3-1", region: [1, 1, 2, 2] }), mk("BOND_UNSUPPORTED", { layer: 2, part: "2-2", areaMM2: 1, region: [2, 2, 3, 3] }),
    ...D.aggregate([mk("NECK_NARROW", { layer: 4, part: "4-1", region: [0, 0, 1, 1] }), mk("NECK_NARROW", { layer: 4, part: "4-1", region: [3, 3, 4, 4] })])];
  check("G5 API present", ["diagRows", "ackAllPlan", "fabListedIn"].every((f) => typeof P[f] === "function"));
  if (typeof P.diagRows !== "function") return;
  const rows = P.diagRows(ds);
  check("PO-FIX-5 same code + layer → one row with count and members (first-occurrence order)",
    rows.map((r) => r.key).join() === "SUPPORT_NARROW|2,SUPPORT_NARROW|3,BOND_UNSUPPORTED|2,NECK_NARROW|4" && rows[0].count === 2 && rows[0].members.length === 2);
  check("PO-FIX-5 the row's focus list has one entry per part with its own region", rows[0].focus.length === 2 && rows[0].focus[1].parts[0] === "2-4" &&
    rows[0].focus[1].regions[0].join() === "5,5,6,6" && rows[0].focus.every((f) => f.layer === 2));
  check("G3/G5 an aggregated member with two necks of one part gives two focus entries (part 4-1, part 4-1 (2))",
    rows[3].focus.length === 2 && rows[3].focus[1].label === "part 4-1 (2)" && rows[3].focus[1].regions[0].join() === "3,3,4,4");
  check("G3/G5 the neck row counts necks and parts separately (2 items, 1 part)", rows[3].count === 2 && rows[3].partCount === 1 && rows[0].partCount === 2);
  const acks = new Set([D.ackKey(ds[0], "h1")]), plan = P.ackAllPlan(ds, "SUPPORT_NARROW", "h1", acks);
  check("PO-FIX-5 ackAllPlan lists the unacked warnings of the code across layers, bound to the hash", plan.hash === "h1" && plan.count === 2 &&
    plan.keys.join() === [D.ackKey(ds[1], "h1"), D.ackKey(ds[2], "h1")].join());
  check("§9.5 ackAllPlan never lists blocking codes", P.ackAllPlan(ds, "BOND_UNSUPPORTED", "h1", new Set()).keys.length === 0);
  check("PO-FIX-5 fabrication diagnostics are listed once: in the review when it is visible and the fab result is shown",
    P.fabListedIn({ shownIsFab: true, fabReviewVisible: true }) === "fab-review" && P.fabListedIn({ shownIsFab: true, fabReviewVisible: false }) === "panel" &&
    P.fabListedIn({ shownIsFab: false, fabReviewVisible: true }) === "panel");
  const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const ackAll = (app.match(/function ackAllControl\([\s\S]*?\n  }\n/) || [""])[0];   // app.js keeps window.confirm only as dialog fallbacks elsewhere
  check("UI-04 renderDiagnostics renders SBProof.diagRows and an Acknowledge all control with an inline confirm (no window.confirm)",
    /SBProof\.diagRows\(/.test(app) && /SBProof\.ackAllPlan\(/.test(ackAll) && /Acknowledge all/.test(ackAll) && /"Confirm"/.test(ackAll) && !/confirm\(/.test(ackAll));
  check("G.4 #5 the confirm re-checks the hash before adding keys", /plan\.hash\s*===\s*r\.snapshot\.geometryHash|r\.snapshot\.geometryHash\s*===\s*plan\.hash/.test(ackAll));
  check("PO-FIX-5 the panel defers to the Fabrication review via SBProof.fabListedIn", /SBProof\.fabListedIn\(/.test(app));
  check("UI-04 the deferring panel keeps a way there: counts of blocking issues and warnings plus a jump control to #fab-review", /id="btn-goto-fab"|"btn-goto-fab"/.test(app) && /scrollIntoView/.test(app));
});
```

- [ ] **Step 2: Run the new suite and confirm it fails.** Run `node test/run_tests.js --only "Appendix G G5"`. Expected FAIL ("G5 API present").
- [ ] **Step 3: Implement the pure functions in `js/proof.js`:**

```js
  P.diagRows = function (diags) {
    const D = global.SBDiag, rows = [], byKey = new Map();
    for (const d of diags || []) {
      const layer = Number.isInteger(d.layer) ? d.layer : null, key = d.code + "|" + (layer === null ? "-" : layer);
      let r = byKey.get(key);
      if (!r) { const it = D.describe(d); r = { key, code: d.code, layer, severity: it.severity, title: it.title, members: [], count: 0, focus: [] }; byKey.set(key, r); rows.push(r); }
      r.members.push(d); r.count += d.count || 1;
      const seen = (id) => r.focus.filter((f) => f.parts[0] === id).length;
      const add = (id, region) => { const n = seen(id); r.focus.push({ label: "part " + id + (n ? " (" + (n + 1) + ")" : ""), layer, parts: [id], regions: region ? [region] : [] }); };
      if (Array.isArray(d.parts) && Array.isArray(d.region) && d.region.every(Array.isArray) && d.parts.length === d.region.length && layer !== null) d.parts.forEach((id, i) => add(id, d.region[i]));
      else if (d.part !== null && d.part !== undefined && layer !== null) add(d.part, d.region || null);
      else { const f = D.describe(d).focus; if (f) r.focus.push({ label: D.describe(d).where, layer: f.layer, parts: f.parts, regions: f.regions }); }
    }
    for (const r of rows) r.partCount = new Set([].concat(...r.focus.map((f) => f.parts))).size;
    return rows;
  };
  P.ackAllPlan = function (diags, code, hash, acks) {
    const D = global.SBDiag, keys = [];
    for (const d of diags || []) if (d.code === code && D.describe(d).severity === "warning") { const k = D.ackKey(d, hash); if (!acks.has(k)) keys.push(k); }
    return { code, hash, keys, count: keys.length };
  };
  P.fabListedIn = (o) => (o && o.shownIsFab && o.fabReviewVisible ? "fab-review" : "panel");
```

- [ ] **Step 4: Wire the rows, "Acknowledge all" and the single listing into `js/app.js`.**
  - **`renderDiagnostics`, in each severity group:**
    - iterate `SBProof.diagRows(diags)` filtered by severity instead of `diags.forEach`;
    - a row with one member renders through `diagItem` exactly as today;
    - a row with more members renders through `diagRow(row, r, onScreen)`.
  - **`diagRow`:**
    - the header shows badge, title, `"layer " + (layer + 1)` and `row.count + " items"`, plus the first member's fix line;
    - a `<ul class="diag-row-focus">` holds one `<button>` per `row.focus` entry, which calls `focusDiagnostic(member, Object.assign({}, it, {focus: entry}), li)` while on screen;
    - for warnings, one checkbox acks or unacks every member key (`SBDiag.ackKey(m, hash)`). It is checked iff all are acked and indeterminate when some are.
  - **`ackAllControl(g, r, diags, hash)`,** in the warning group header:
    - for each warning code with ≥ 2 unacked members, a button `"Acknowledge all " + n + " " + title`;
    - a click replaces it with `<span class="diag-confirm">Acknowledge n warnings for this <quality> result? <button>Confirm</button> <button>Cancel</button></span>`;
    - Confirm: `if (r.snapshot && r.snapshot.geometryHash === plan.hash) plan.keys.forEach((k) => r.acks.add(k)); refreshDiagnostics(r);`, then focus returns to the group header;
    - Cancel restores the button.
    - It appears in both panels (same renderer).
  - **Single listing:**
    - in `renderDiagnostics` (not fab scope), when `SBProof.fabListedIn({shownIsFab: r === run.fab, fabReviewVisible: fabCurrent()}) === "fab-review"`, set the summary to `"This fabrication result is listed in the Fabrication review in the Export step: " + blockingCount + " blocking, " + warningCount + " warning(s)."`, add a `<button id="btn-goto-fab" class="btn">Go to the Fabrication review</button>` that calls `$("fab-review").scrollIntoView({block: "start"})` and focuses `#h-fab` (review 2026-10-09: the Proof panel and the review sit in different sections, `index.html:263` is the review in step 5, so without a control the user must scroll; blocking issues and clip actions would otherwise be invisible in the Proof step), list no items, and return after `renderRepairs()`;
    - a compact blocking list in the panel (one line per blocking row) is a possible follow-up; it would list those rows twice, so the default is the counts plus the jump control (G.9 #9);
    - `renderFabReview` calls `renderDiagnostics(run.shown)` after rendering the review, so the panel updates when the review appears or hides.
  - **CSS:** `.diag-row-focus` is an inline wrap list of small buttons, and `.diag-confirm` uses the warning tokens, in both themes.
- [ ] **Step 5: Run the new suite.** Run `node test/run_tests.js --only "Appendix G G5"`. Expected: PASS.
- [ ] **Step 6: Check the UI by hand** in the dev page (`index.html` from a local server; `run` skill if available):
  1. Load the fusion2 PNG and run Preview at fabrication resolution.
  2. In both panels: merged rows show counts, focus buttons switch the Proof to each part, "Acknowledge all" asks to confirm, and the export gate count drops accordingly.
  3. The fabrication diagnostics appear once.
- [ ] **Step 7: Run the full suite, build and commit.**
  1. Run `node test/run_tests.js`: 0 failed.
  2. `node build.js`
  3. Commit `js/proof.js js/app.js css/app.css test/run_tests.js dist/shadowbox-studio.html`: `feat(proof,app): G5 merged review rows, acknowledge all with confirm, single fabrication listing (PO-FIX-5)` + trailer.

---

#### Task G6 (PO-FIX-6): "Match pitch to source"

**Files:**
- Modify: `js/raster.js`:
  - `R.matchSourcePitch` (new, after `fabRaster` `:636-657`);
  - `fabDiagnostics` `:706-735`;
  - `resamplePolicy` `:670-676`.
- Modify: `js/engine.js`: `E.matchSourcePitch` (next to `E.qualityPair`).
- Modify: `js/diag.js`: `FAB_MATCHES_SOURCE` (info).
- Modify: `js/app.js`:
  - `bindPitch`/`syncPitch` `:1398-1425`: button next to `#in-res`;
  - `diagItem`: `pitchMatchAction` on `RESAMPLED`.
- Modify: `index.html` (`:149-150`, the button) and `css/app.css`.
- Modify: `test/run_tests.js`: new suite `raster/engine/app — Appendix G G6 match pitch to source (PO-FIX-6, IMG-02, PO-LASER-4/5)`; PLAN info list.
- Modify: `test/golden/pool-equality.json` (task G6, only if an equal-size tonal fixture changes its digest).

**Interfaces:**
- Produces:
  - `SBRaster.matchSourcePitch({artWUm, artHUm, srcW, srcH, pxBudget, targetPitchUm, minPitchUm, maxPitchUm}) → {pitchUm, W, H} | null` (G-D5). It returns `null` when:
    - the target raster already equals the source;
    - no p in [minPitchUm, maxPitchUm] gives W = srcW and H = srcH;
    - the budget would cap it;
    - |p − target| > 0.15·target.
  - `SBEngine.matchSourcePitch(project, {w, h}, deviceClass) → {fabPitchMM, W, H} | null`. It takes the oriented size and `SBSchema.resolveSize`, as `rasterPlan` does, with `FAB_PITCH` limits in µm.
  - New info code `FAB_MATCHES_SOURCE`.

- [ ] **Step 1: Write the failing tests.**

```js
suite("raster/engine/app — Appendix G G6 match pitch to source (PO-FIX-6, IMG-02, PO-LASER-4/5)", () => {
  const R = SBRaster, E = SBEngine, S = SBSchema;
  check("G6 API present", typeof R.matchSourcePitch === "function" && typeof E.matchSourcePitch === "function" && !!SBDiag.CODES.FAB_MATCHES_SOURCE);
  if (typeof E.matchSourcePitch !== "function") return;
  // identity first: an area resample at equal size returns the input bytes (G-D5 precondition for policy "none")
  { const w = 37, h = 23, px = new Uint8Array(w * h * 4); for (let i = 0; i < px.length; i++) px[i] = (i * 131) % 256;
    check("G-D5 area resample at equal size is byte-identical to the input", R.resample(px, 4, w, h, w, h, "area").join() === px.join()); }
  const p = S.defaults("plywood"); p.geometry.sizeBy = "height"; p.geometry.targetMM = 300; p.source = S.sourceTemplate();
  const m = E.matchSourcePitch(p, { w: 4096, h: 3084 }, "desktop");
  check("PO-FIX-6 4096 × 3084 at 300 mm (raster 3985 × 3000 at 0.1) → a match near 0.097 mm/px", !!m && m.fabPitchMM > 0.09 && m.fabPitchMM < 0.1 && m.W === 4096 && m.H === 3084);
  const q = S.applyFabPitch(p, m.fabPitchMM), plan = E.rasterPlan(q, { w: 4096, h: 3084 }, "fabrication", "desktop");
  check("PO-FIX-6 at the matched pitch the fabrication raster equals the source", plan.geometry.rasterW === 4096 && plan.geometry.rasterH === 3084);
  check("G-D5 no FAB_EXCEEDS_SOURCE warning; FAB_MATCHES_SOURCE info instead", !plan.diagnostics.some((d) => d.code === "FAB_EXCEEDS_SOURCE") &&
    plan.diagnostics.some((d) => d.code === "FAB_MATCHES_SOURCE" && d.severity === "info"));
  const qt = S.applyModeChange(q, { interpretation: { mode: "tonal" } }, true);
  check("G-D5 tonal at the matched pitch does not resample (policy none)", E.rasterPlan(qt, { w: 4096, h: 3084 }, "fabrication", "desktop").geometry.resample === "none");
  check("PO-FIX-6 a source far from the raster (8000 px vs 3985) gets no offer", E.matchSourcePitch(p, { w: 8000, h: 6023 }, "desktop") === null);
  check("PO-FIX-6 a source already equal to the raster gets no offer", E.matchSourcePitch(S.applyFabPitch(p, 0.1), { w: 3985, h: 3000 }, "desktop") === null);
  check("PO-LASER-5 a real shortfall still warns (2000 px source at 0.1 mm/px)",
    E.rasterPlan(p, { w: 2000, h: 1506 }, "fabrication", "desktop").diagnostics.some((d) => d.code === "FAB_EXCEEDS_SOURCE"));
  check("IMG-02 RESAMPLED keeps its suggestion", /matching source size/.test(SBDiag.CODES.RESAMPLED.fix));
  check("G-D5 FAB_MATCHES_SOURCE states the shortfall in px (tolerance: one 1 µm step, ≤ 2 % per axis)",
    plan.diagnostics.find((d) => d.code === "FAB_MATCHES_SOURCE").detail.includes("shortfall") && /\d+ × \d+ px, within one 1 µm pitch step/.test(plan.diagnostics.find((d) => d.code === "FAB_MATCHES_SOURCE").detail));
  { const rs = fs.readFileSync(path.join(__dirname, "..", "js", "raster.js"), "utf8");
    check("G-D5 the FAB_PITCH_CAPPED detail names FAB_MATCHES_SOURCE in the match case (no dangling FAB_EXCEEDS_SOURCE pointer)", /see FAB_MATCHES_SOURCE/.test(rs)); }
  const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("PO-FIX-6 the pitch row and the RESAMPLED item offer Match pitch to source through SBEngine.matchSourcePitch + applyFabPitch",
    /id="btn-match-pitch"/.test(html) && /SBEngine\.matchSourcePitch\(/.test(app) && /applyFabPitch\(project,\s*m\.fabPitchMM\)/.test(app) && /"RESAMPLED"/.test(app));
});
```

  Add `"FAB_MATCHES_SOURCE"` to `PLAN.info`.
- [ ] **Step 2: Run the new suite and confirm it fails.** Run `node test/run_tests.js --only "Appendix G G6"`. Expected FAIL ("G6 API present"). If "area resample at equal size is byte-identical" also fails, **do not** change `resamplePolicy`: drop that one G-D5 item, keep the rest, and record it in the G6 Result note.
- [ ] **Step 3: Implement the match and the diagnostic rule** in `js/raster.js`.

```js
  /** Appendix G G-D5: the largest integer pitch p (µm) whose uncapped raster covers the source on both axes, so fabRaster clamps to it exactly. */
  R.matchSourcePitch = function (o) {
    const { artWUm, artHUm, srcW, srcH, pxBudget, targetPitchUm, minPitchUm, maxPitchUm } = o || {};
    for (const v of [artWUm, artHUm, srcW, srcH, pxBudget, targetPitchUm, minPitchUm, maxPitchUm]) if (!isPosInt(v)) throw rfail("RASTER_ARG", "matchSourcePitch: positive integers required");
    const here = R.fabRaster({ artWUm, artHUm, srcW, srcH, targetPitchUm, pxBudget });
    if (here.W === srcW && here.H === srcH && here.pitchUm === targetPitchUm) return null;   // already equal
    const top = (A, S) => (S <= 1 ? maxPitchUm : cdiv(A, S - 1) - 1);                          // largest p with ⌈A/p⌉ ≥ S
    const p = Math.min(top(artWUm, srcW), top(artHUm, srcH), maxPitchUm);
    if (p < minPitchUm || Math.abs(p - targetPitchUm) > 0.15 * targetPitchUm) return null;
    const f = R.fabRaster({ artWUm, artHUm, srcW, srcH, targetPitchUm: p, pxBudget });
    if (f.pitchUm !== p || f.W !== srcW || f.H !== srcH) return null;                           // budget-capped or not exact
    return { pitchUm: p, W: f.W, H: f.H };
  };
```

  - **`fabDiagnostics`:** the source branch becomes (tolerance: one 1 µm step and at most 2 % per axis, G-D5):

```js
    const shortW = cdiv(ctx.artWUm, fab.pitchUm) - ctx.srcW, shortH = cdiv(ctx.artHUm, fab.pitchUm) - ctx.srcH;   // px the uncapped raster exceeds the source by
    const oneStep = source && fab.W === ctx.srcW && fab.H === ctx.srcH &&
      cdiv(ctx.artWUm, fab.pitchUm + 1) <= ctx.srcW && cdiv(ctx.artHUm, fab.pitchUm + 1) <= ctx.srcH &&
      shortW * 50 <= ctx.srcW && shortH * 50 <= ctx.srcH;
    if (oneStep) out.push(global.SBDiag.make("FAB_MATCHES_SOURCE", Object.assign({}, base, {
      detail: "the raster equals the source (" + ctx.srcW + " × " + ctx.srcH + " px) at " + umText(realUm) + " mm/px; requested pitch " + umText(fab.pitchUm) +
        " mm/px (shortfall " + shortW + " × " + shortH + " px, within one 1 µm pitch step)" })));
    else if (source) { /* the existing FAB_EXCEEDS_SOURCE push, unchanged */ }
```

  - **`FAB_PITCH_CAPPED` detail:** the trailing "(see FAB_EXCEEDS_SOURCE)" (`js/raster.js:718`) is emitted only when the warning is emitted; in the match case it reads "(see FAB_MATCHES_SOURCE)".
  - **`resamplePolicy`:** `if (mode === "tonal") return W === srcW && H === srcH ? "none" : "area";`. Ship this only if the Step 1 identity check passed.
  - **`js/diag.js`:** add `["FAB_MATCHES_SOURCE", I, P, "Fabrication raster equals the source", "No action needed; the source is used 1:1 without resampling."]`.
  - **`js/engine.js`:**

```js
  E.matchSourcePitch = function (project, source, deviceClass) {
    const Sch = global.SBSchema, [srcW, srcH] = orientedSize(project, source.w, source.h), sz = Sch.resolveSize(project, srcW, srcH);
    const m = global.SBRaster.matchSourcePitch({ artWUm: sz.artWUm, artHUm: sz.artHUm, srcW, srcH, pxBudget: Sch.limits(deviceClass).fabPxBudget,
      targetPitchUm: Math.round(project.geometry.fabPitchMM * 1000), minPitchUm: Math.round(Sch.FAB_PITCH.min * 1000), maxPitchUm: Math.round(Sch.FAB_PITCH.max * 1000) });
    return m ? Object.freeze({ fabPitchMM: m.pitchUm / 1000, W: m.W, H: m.H }) : null;
  };
```

- [ ] **Step 4: Add the UI.**
  - **`index.html`:** after `#in-res`, add `<button id="btn-match-pitch" type="button" class="btn" hidden></button>`.
  - **`js/app.js`:** `syncPitch()` computes `const m = run.sourceImage ? SBEngine.matchSourcePitch(project, {w: srcW, h: srcH}, deviceClass()) : null`, using the source size `updateDimbar` already uses (`js/app.js:1605`).
    - If `m` is null, the button stays hidden.
    - Otherwise it reads `"Match pitch to source (" + SBUtil.fmt(m.fabPitchMM, 3) + " mm/px, " + m.W + " × " + m.H + " px, no resampling)"`.
    - A click runs `project = SBSchema.applyFabPitch(project, m.fabPitchMM); syncControls(); recompute();`.
  - **`diagItem`:** for `d.code === "RESAMPLED"`, `pitchMatchAction(d)` adds the same button (same handler) when `m` is non-null. The item's fix text is unchanged.
- [ ] **Step 5: Run the new suite.** Run `node test/run_tests.js --only "Appendix G G6"`. Expected: PASS.
- [ ] **Step 6: Re-capture if needed.** Run the full suite. If an equal-size tonal F0 fixture's digest changed (resample `"none"` instead of `"area"`, geometry bytes equal by Step 1), re-capture it with `--task G6` and assert that its `geometryHash` **and** `layerHashes` are unchanged (review 2026-10-09: `geometryHash` excludes the resample method, but `diagSha`/`wholeSha` change because `RESAMPLED` disappears from equal-size draft fixtures too, so the record is expected to touch `diagSha`/`wholeSha` of every equal-size tonal fixture, draft ones included).
- [ ] **Step 7: Build and commit.** Run `node build.js` and commit `js/raster.js js/engine.js js/diag.js js/app.js index.html css/app.css test/run_tests.js test/golden/pool-equality.json dist/shadowbox-studio.html`: `feat(raster,engine,app): G6 match pitch to source, one-step FAB_MATCHES_SOURCE (PO-FIX-6)` + trailer.

---

#### Task G7 (PO-FIX-7): Commit the S7 spike (≲ 30 MB)

**Files:** Modify `spikes/S7/.gitignore`; add `spikes/S7/**` that the ignore file does not exclude. Leave the `.venv/`, `models/`, `.cache/`, `src/`, `*.npy` and the large rasters excluded. No shipped code changes, so no `dist/` rebuild.

- [ ] **Step 1: Extend `spikes/S7/.gitignore`** with these lines appended:

```gitignore
__pycache__/
*.pyc
# Appendix G G7: derived or oversized rasters (regenerable from the scripts; contact sheets keep the overview)
results/**/color.png
results/fusion/height_continuous*.png
results/fusion/side_by_side.png
results/fusion/layers_preview.png
results/fusion2/engrave_preview.png
results/fusion2/layers_preview.png
results/fusion2/side_by_side.png
```

  `color.png` is the turbo colour map of the run's nearness (`scripts/common.py:97`). The run's `height.png` and the contact sheets carry the same information.
- [ ] **Step 2: Check the size and contents before staging.**

```bash
git ls-files --others --exclude-standard spikes/S7 > /tmp/s7.txt
wc -l < /tmp/s7.txt
tr '\n' '\0' < /tmp/s7.txt | du -cb --files0-from=- | tail -1          # must be ≤ 31457280 (30 MiB); expected ≈ 25.6 MB
tr '\n' '\0' < /tmp/s7.txt | du -b --files0-from=- | sort -rn | head    # no single file > 5 MB
grep -E 'fusion2/height_8layer_v2\.png|fusion2/engrave/' /tmp/s7.txt | wc -l   # 1 + 16 (engrave_layer0–7 .png/.svg)
grep -lE 'ak-[A-Za-z0-9]{8,}|as-[A-Za-z0-9]{8,}|token_secret|token_id|MODAL_TOKEN|hf_[A-Za-z0-9]{20,}' $(cat /tmp/s7.txt | grep -vE '\.(png|npy)$') || echo "no secrets"
# account identifiers (review 2026-10-09: the secrets grep above does not catch them)
grep -nE 'modal\.com/apps|jeremy-1756|\bap-[A-Za-z0-9]{16,}' $(cat /tmp/s7.txt | grep -vE '\.(png|npy)$') || echo "no account identifiers"
```

  - If the total exceeds 30 MiB, add the next-largest non-contact-sheet previews to the ignore list (never the contact sheets, READMEs, scripts, `height.png` or `meta.json`) and re-check.
  - If the secrets grep matches, stop and report the file. **Do not commit it.**
  - **Account identifiers (review 2026-10-09, verified):** `results/fusion2/mv2_driver.log` lines 2 and 35 carry a `modal.com/apps/<workspace>/main/ap-…` URL with the workspace name and an app id; `results/manifest.json:114` and `results/fusion2/README.md:237` name the workspace. They are not credentials, but they identify the account. Default: **scrub** them in the committed copies (`<workspace>` and `<app-id>`) with a `sed` that is recorded in the commit message, since the logs are provenance and the text around the identifiers matters; the alternative is to ignore `results/fusion2/mv2_driver.log` and scrub the two text lines (G.9 #10). Re-run the identifier grep: no match.
  - **`spikes/S7/input/cross.png` (1.5 MB source image) would be committed.** Confirm its ownership and licence under NFR-11 (the spike README names the source, or the product owner confirms it is theirs) before committing it. If that cannot be confirmed, add `input/cross.png` to `spikes/S7/.gitignore` and note in the commit message that the scripts need it supplied (G.9 #10).
  - `results/fusion2/billing_*.txt` hold only Modal cost totals. Keep them, unless the grep flags them.
- [ ] **Step 3: Confirm the suite is unaffected.** Run `node test/run_tests.js`: 0 failed. The hygiene suites must not scan `spikes/S7`; if one does, scope it.
- [ ] **Step 4: Commit.**

```bash
git add spikes/S7
git commit -m "chore(spikes): G7 commit the S7 depth-model spike — code, READMEs, results, contact sheets and fusion2 deliverables (PO-FIX-7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git show --stat HEAD | tail -1     # record the file count and size in the G7 Result note
```

---

#### Task G8: Checkpoint v2.0.0-alpha.5

**Files:**
- Version strings: `js/app.js:24`, `sw.js:23`, `js/worker.js:57`.
- `test/run_tests.js`:
  - DEP-02 retargets `:2659`, `:8262` **and the F18 check at `:8047-8049`** (it asserts `APP_VERSION`, `sw.js` `VERSION` and `WORKER_APP_VERSION` all equal `2.0.0-alpha.4` and would fail after the bump; review 2026-10-09). Its label becomes "F18 release 2.0.0-alpha.4 → 2.0.0-alpha.5 since Appendix G G8: ... agree";
  - the alpha.4 CHANGELOG suite `:8054-8063` keeps its alpha.4 checks (they read the `## v2.0.0-alpha.4` section, which stays) and gains an alpha.5 suite.
- Docs: `docs/CHANGELOG.md`, `docs/QA_CHECKLIST.md`, `docs/USER_GUIDE.md`.
- Records: `docs/perf/speed-round.json` (`appendixG`).
- `dist/shadowbox-studio.html`.
- This plan: tick G1–G8 and add Result notes.

- [ ] **Step 1: Write the failing tests.**
  - Retarget the DEP-02 checks (`:2659`, `:8262`) to `/const APP_VERSION\s*=\s*"2\.0\.0-alpha\.5"/` and `/const VERSION\s*=\s*"2\.0\.0-alpha\.5"/`, and the F18 check (`:8047-8049`) to `"2.0.0-alpha.5"` for all three of `APP_VERSION`, `VERSION` and `WORKER_APP_VERSION`. The labels read `(2.0.0-alpha.5 since Appendix G G8)`.
  - Add:

```js
suite("CHANGELOG — checkpoint v2.0.0-alpha.5 (R9, PO-FIX-1..7)", () => {
  const cl = fs.readFileSync(path.join(__dirname, "..", "docs/CHANGELOG.md"), "utf8"), sec = (cl.split(/^## v2\.0\.0-alpha\.5\b.*$/m)[1] || "").split(/^## /m)[0];
  check("R9 v2.0.0-alpha.5 section sits above alpha.4", cl.search(/^## v2\.0\.0-alpha\.5\b/m) >= 0 && cl.search(/^## v2\.0\.0-alpha\.5\b/m) < cl.search(/^## v2\.0\.0-alpha\.4\b/m));
  check("R9 alpha.5 names every PO-FIX item and the D3 extension", [1, 2, 3, 4, 5, 6, 7].every((n) => new RegExp("PO-FIX-" + n).test(sec)) && /NECK_KERF/.test(sec) && /PART_POINT_CONTACT/.test(sec) && /D3/.test(sec));
  check("R9 alpha.5 has a known-gaps table (draft square fallback, own-hole point contact, guide threshold not a setting, match tolerance, S2 record, connected square chain, material pinches at saddles, no repair for NECK_KERF/PART_POINT_CONTACT, image-edge cleanup)",
    /known gaps/i.test(sec) && /^\|.*\|\s*$/m.test(sec) && /fallback/i.test(sec) && /own hole|outer.hole/i.test(sec) && /2 mm/.test(sec) && /15 ?%/.test(sec) && /S2/.test(sec) && /connected/i.test(sec) &&
      /pinch/i.test(sec) && /no repair/i.test(sec) && /edge/i.test(sec));
  const sr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs/perf/speed-round.json"), "utf8"));
  check("NFR-03 appendixG.morph records the disc vs square per-layer p50 and the real-layer ratio ≤ 3.0 (a recorded figure, not a timing the test takes)", !!sr.appendixG && !!sr.appendixG.morph && sr.appendixG.morph.ratio <= 3.0);
  check("S2 appendixG.fab4096 records the cumulative pooled p95 (≤ 10000 ms), the serial total and the pre-round reference",
    !!sr.appendixG.fab4096 && sr.appendixG.fab4096.pooledP95Ms <= 10000 && Number.isFinite(sr.appendixG.fab4096.serialMs) && sr.appendixG.fab4096.phaseBPooledMs === 8794);
});
```

- [ ] **Step 2: Run the new suite and confirm it fails.** Run `node test/run_tests.js --only "alpha.5"`. Expected: ✗.
- [ ] **Step 3: Bump the versions and write the release docs.**
  1. Bump the three version strings.
  2. Add a CHANGELOG `## v2.0.0-alpha.5 — <date>, app fix round (bonded morphology & export hygiene)` section with one bullet per PO-FIX-n:
     - the geometry change for bonded (every bonded `geometryHash` changes, so acks and clips of bonded projects are redone once);
     - the two new blocking codes and the D3 extension;
     - the octagonal erosion and neck regions;
     - guide stubs;
     - the review UI;
     - match pitch;
     - the S7 spike.
  3. Add a **Known gaps (alpha.5)** table:

     | Area | Gap in alpha.5 | Arrives in |
     |---|---|---|
     | Draft morphology | At draft pitches where the minimum feature is < 3 px (R² = 0), bonded drafts keep the square fallback; the disc applies at fabrication | by design (G-D1) |
     | Own-hole point contact | A part touching its own hole at a point is not blocking | G.9 #2 |
     | Guide threshold | 2 mm minimum guide extent is a constant, not a setting | G3.3 proper |
     | Match pitch | Offered only within 15 % of the target pitch | — |
     | S2 record | The alpha.4 S2 measurement row is still pending unless G1 Step 7 measured it | measurement run |
     | Connected mode | Connected keeps the v1.1 square chain (golden) | — |
     | Neck regions | Necks are located by bbox; more than 8 per part are folded | G4.4 |
     | Material pinches | Cleanup guarantees no waste channel below the minimum feature; a material pinch at a saddle can survive as a thin neck and is reported `NECK_NARROW` (`NECK_KERF` at or below the kerf), not removed | G.9 #8 |
     | No repair action | `NECK_KERF` and `PART_POINT_CONTACT` are blocking at draft and fabrication and have no clip action; widen the art or raise the minimum feature | — |
     | Part thinner than the kerf | A part that vanishes under the kerf erosion gets `PART_THIN` (a warning), not `NECK_KERF` | G.9 #7 |
     | Image edge | Art touching the image edge is now cleaned like interior art (the square kernels kept the border ring) | by design (G-D1) |
     | Stale repairs | The engine version stays `1.0.0-dev` while bonded output changes; `replayRepairs` applies cross-quality clips without a hash check, so only same-quality clips go `REPAIR_STALE` | — |

  4. QA_CHECKLIST: the fusion2 art cut check (no corner-touching blocks at the six spots; compare `crops_square_vs_disc.txt`), "Acknowledge all" in both panels, one listing, match pitch on a 4096 × 3084 source at 300 mm.
  5. USER_GUIDE: blocking point contacts and kerf necks, "Acknowledge all", match pitch.
  6. Tick this appendix and add the Result notes.
- [ ] **Step 4: Run the full suite and build.** Run `node test/run_tests.js`: 0 failed. Then `node build.js`.
- [ ] **Step 5: Commit.** Add the files above and commit `release(app,docs): v2.0.0-alpha.5 app fix round — bonded disc morphology, kerf/point-contact blocking, review UI (checkpoint)` + trailer. No tag, no push.

### G.7 Measurement plan and performance budgets

| Check | Command | Budget | Owner |
|---|---|---|---|
| Disc vs square per layer, 12 Mpx | `node test/bench.js morph --runs 5 --record` (dense blobby mask, sparse mask, real fusion2 layers) | target ≤ 2.0 × on the real layers; ≤ 3.0 × allowed only while the absolute gates below pass; **above 3.0 × on the real layers G1 does not ship** (G.9 #1) | G1 |
| Bonded construction 1 Mpx × 8 | suite check `:3911-3913` | < 2.5 s | G1 |
| **User12 fabrication, pool 8, cumulative** | `node test/bench.js large --only user12 --pool 8 --rows fab4096 --runs 5` | **p95** ≤ 10 s (the S2 rule in `speed-round.json` `final.s2`: pooled fab4096 p95 ≤ 10 s in Chromium; Node figure first, Chromium `?bench=fab` when run) **and** ≤ `phaseB.fab4096.pooledWallMs` (8794 ms) + 1.2 s, checked after **every** task G1, G2, G3 and G8, not task to task. The relative gates below can all pass while the sum fails, so this absolute gate decides. | G1, G2, G3, G8 |
| Serial fallback (record) | same bench with `--pool 0` | **record** the total (phaseB: 12879 ms; the disc adds roughly 4-5 s over eight layers, f17 pool0 p50 was already 19.6 s); no gate, but report it | G1, G8 |
| Per-stage allowances (cumulative vs the pre-round record) | the row's stage table | construct ≤ +1.0 s (the slowest layer's disc cost is about +0.7-1.0 s in the pool); features ≤ 1.3 × after G2 and ≤ 1.7 × after G3 (the compounded allowance stated once, not 1.3 × 1.3 by accident); guides ≤ +10 % after G4 | G1-G4 |
| Warm draft 720 | `node test/bench.js draft --only a --candidates 720` | warm p95 ≤ 3.0 s (E4 rule) | G1, G8 |

**Prototype figures (2026-10-09, i7-11800H, Node 26.7, 3985 × 3000 masks, `openClose(8, 7)` vs the Step 3 kernel at R² 49/49, interleaved):**
- First measurement (load ≈ 19, synthetic mask): square 459–823 ms, disc 1624–1996 ms, ≈ 3.5 ×.
- Review re-measurement on a blobby mask: square 264–373 ms, disc 814–1124 ms, ratio **3.1–3.4 ×**; a sparse mask 270 vs 805 ms (≈ 3.0 ×). The kernel equals brute force (including the Uint8/Uint16 boundary at R² = 65024/65025/65026, 0 mismatches), so correctness is not the issue; speed is.
- The former expectation that skipping empty rows, one scratch per call and word-skipping bring the disc to ≤ 2 × is **unsupported**: those help sparse art only, and the sparse mask is already at 3.0 ×. G1 Step 3 therefore plans a measured optimisation loop with a binding decision rule, and G.9 #1 names the fallbacks.
- The investigation's EDT prototype took 4.0 s vs 0.35 s per layer and is never shipped.
- In the pool, construct is per layer (one item per sheet), so the fabrication critical path grows by the slowest layer's difference (≈ 0.7–1.0 s); the serial fallback grows by the sum (≈ +4–5 s). The S2 rule (pooled p95 ≤ 10 s) has about 1.2 s of headroom over `phaseB` (8794 ms), shared by construct, features, guides and everything else in this round. That is why the gates above are absolute and cumulative.

### G.8 Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Disc kernel misses the budget (already measured at 3.1–3.4 × on dense art, so this risk is live, not hypothetical) | Measured optimisation loop and binding decision rule in G1 Step 3; absolute cumulative S2 gate (G.7); fallbacks in G.9 #1 (re-budget with product-owner approval, or the octagon compromise); never ship the 4 s EDT prototype. The earlier "union of staircase rectangles through `windowAny`" fallback is **withdrawn**: it needs A + 1 = 8 rectangle passes per window at R² = 49 against one pass for the square, roughly 8 × per window, slower than the sweep kernel it was meant to rescue |
| 2 | New blocking codes block common bonded art, or fail to catch what the PO sees | G2 Step 5 lists every F0 fixture that gains a blocking code and checks one by hand; `NECK_KERF` uses the real kerf, not the minimum feature. **The disc closing turns point contacts into thin necks rather than removing them** (measured: two 6 mm squares at a corner become one part with a ≈ 0.3 mm neck, `NECK_NARROW`, not `NECK_KERF` and not `PART_POINT_CONTACT`), so `PART_POINT_CONTACT` almost never fires on bonded output and 0.3–0.6 mm material pinches at saddles are reported, not removed: the minimum-feature guarantee holds for waste only. G2 has the end-to-end test; the PO confirms this reading (G.9 #8) |
| 3 | Bonded hash change resets acks and makes clips `REPAIR_STALE` once | Documented in the CHANGELOG (alpha.3 precedent for `draftPx`); no silent migration. The engine version stays `1.0.0-dev` and `replayRepairs` applies cross-quality clips without a hash check, so only same-quality clips go `REPAIR_STALE`; the CHANGELOG says so |
| 4 | Neck locator and feature-stage cost on art with thousands of necks or chips | Only parts that split call the locator; bbox prefilters before any Clipper call; cap 8 regions per part; no-kerf-no-pass; bbox-gated point-contact scan; cumulative features gate 1.3 × (G2) and 1.7 × (G3) |
| 5 | The F1 golden check breaks on the first recapture | Chain-aware check in G1 Step 6 (G-D6) |
| 6 | Tonal equal-size `"none"` changes geometry | Shipped only after the identity check (G6 Step 1); `geometryHash` and `layerHashes` asserted unchanged in the recapture |
| 7 | S7 commit carries secrets, account identifiers, an unlicensed image or exceeds 30 MB | G7 Step 2 size, secrets and account-identifier checks gate the commit; `cross.png` ownership/licence confirmed or ignored (G.9 #10) |
| 8 | Construction keeps what the checks flag (boundary inconsistency) | G-D1 tie rule (R² = m², 17 px at 1.5 mm and 0.1 mm/px) and the self-consistency tests in G1 and G3 |

### G.9 Open questions (defaults apply unless unsafe)

1. **Disc kernel fallback if the optimised sweeps stay > 3 × on the real layers.** The first-draft default (a union of staircase rectangles through `windowAny`) is withdrawn: at R² = 49 it needs A + 1 = 8 rectangle passes per window against one for the square. Candidates, in order, all needing a **product-owner decision** before use because each changes what G-D1 promised:
   1. *Re-budget.* Accept a higher kernel ratio (up to 4 ×) if, and only if, the absolute cumulative gates of G.7 pass (pooled p95 ≤ 10 s, construct +1.0 s). This costs nothing in geometry; it is the default when the real-layer ratio is between 3.0 and 4.0 × and the absolute gates pass.
   2. *Octagon cleanup.* Replace the Euclidean disc by the octagon (square window ∩ diamond window): a diamond erosion/dilation is a two-pass integer chamfer sweep, so the cost is a few streaming passes plus the existing square window. It also matches the G3 octagonal feature checks exactly (tie rule and diagonals become consistent by construction). Diagonal necks are judged by the octagon, not the Euclidean disc, so the PO must approve the changed meaning of "exact Euclidean disc".
   3. *Integer EDT with row bands.* Exact, but the 4.0 s per-layer prototype is far too slow; only a banded, cache-aware version measured under budget would be shipped.
   If none passes, G1 stops and the round is re-planned with the product owner.
2. **A part touching its own hole at a point** (D3 4 allows it). Default: **not blocking** in this round; listed as a known gap. Promote to `PART_POINT_CONTACT` only on a new product-owner decision.
3. **Draft cleanup at R² = 0.** Default: the square `featR` fallback (G-D1); it never reaches a fabrication result that is not already blocked by `SAMPLING_LOW`.
4. **Guide minimum extent as a setting.** Default: a constant of 2 mm (G-D4); a schema field waits for G3.3.
5. **Match tolerance.** Default ±15 % of the target pitch; the button never appears when the budget would cap the pitch.
6. **Tie rule and kept width (review 2026-10-09).** Default: R² = m² with m = ⌊(⌊F⌋ + 1)/2⌋ (17 px = 1.7 mm kept at 1.5 mm and 0.1 mm/px, the width the square window had), so cleanup never keeps a width the checks flag. Alternative: keep R² = 49 (15 px kept) and make the checks tolerant by one pixel (a neck at exactly the minimum feature passes). The default is chosen because the digital disc cannot distinguish 15 from 16 px, so any rule "keep exactly the minimum feature" leaves checks and cleanup off by one pixel on one parity.
7. **A part thinner than the kerf** gets `PART_THIN` (a warning), not `NECK_KERF` (blocking). Default: keep, as implemented; promote to blocking only on a product-owner decision.
8. **Do the pinch guarantees match the PO's wording ("pinches 0.1–0.6 mm")?** Default: waste channels below the minimum feature are guaranteed closed; material pinches at saddles survive as thin necks and are reported (`NECK_NARROW`, located by G3; `NECK_KERF` at or below the kerf). The product owner confirms this satisfies the request, or asks for a material-side measure (for example opening the saddle pixels) as a follow-up.
9. **Compact blocking list** in the Proof panel while the fabrication review is shown elsewhere. Default: counts plus a jump control (G5); no duplicate listing.
10. **S7 identifiers and `cross.png`.** Default: scrub the Modal workspace and app id in the committed copies; commit `input/cross.png` only after ownership/licence is confirmed (NFR-11), else ignore it.

### G.10 Self-review

- Every PO item has a task with failing-first tests:
  - G1 → PO-FIX-1;
  - G2 → PO-FIX-2;
  - G3 → PO-FIX-3;
  - G4 → PO-FIX-4;
  - G5 → PO-FIX-5;
  - G6 → PO-FIX-6;
  - G7 → PO-FIX-7;
  - G8 → R9.

  Each code task has a perf gate (G.7), and the checkpoint records `appendixG.morph`.
- **Review round 2026-10-09 (post-review amendments).** The plan was reviewed against the code and amended; each amendment was verified, not just accepted:
  - tie rule: measured on the current tree (axis 15 px neck `NECK_NARROW`, 15 px strip `PART_THIN`, 16 px `FEATURE_MARGINAL`); the proposed "R² = 63" does not fix it (63 keeps 15 px), R² = 64 does (G-D1);
  - disc speed: re-measured at 3.1–3.4 × on dense masks (G.7);
  - the staircase-rectangle fallback is withdrawn (8 passes per window); the point-contact and saddle behaviour was measured (G-D2);
  - existing tests: G4 breaks exactly one existing test (ASM-03 `Lsmall`; AT-14 stays green) — verified by running the filter on a scratch copy; G3 breaks the Appendix C oracle and delta tests; G8 adds `:8047-8049`; G2 does not break the delta tests once the kerf pass is skipped without a kerf;
  - stale line references corrected (`connected == the v1.1.0 chain` is at `:416-430`; the PO-LASER-6 strips are at `:464-469` and `:581`).
- References re-checked on 2026-10-09 against `43f2c88`. The approval text's line numbers moved in the speed round:
  - `js/engine.js:486` is now `constructPx` `:471-486`;
  - `js/support.js:308` (miter) is now `:350`;
  - `js/support.js:365` (region) is now `:420`;
  - `js/geom.js:305-312` is the `rechain` comment at `:303-314` (function `:315-366`);
  - `js/guides.js:98` is `:98-99`;
  - `js/morph.js:10-21`, `:108-178` match (`windowAny` `:108-154`, `openClose` `:178-182`).
- Corrections versus the approval text:
  - the checkpoint is **2.0.0-alpha.5**, not alpha.4 (alpha.4 shipped in F18, `2bbb3f8`);
  - the "closing radius analog" is the same R² (G-D1, with the rationale);
  - R² = 0 keeps the square chain (draft only, G-D1).
- Type consistency:
  - `discR2` (px, integer) is used in G1 Steps 3–4 and the tests;
  - `kerfMM`/`pointContacts` (cfg) are used in G2 and the engine wiring;
  - `neckRegions(poly, residual, half, scale)` is used in G3;
  - `diagRows`/`ackAllPlan`/`fabListedIn` are used in G5;
  - `matchSourcePitch` (raster: µm object; engine: `{fabPitchMM, W, H}`) is used in G6.
- No placeholder steps: each task names files, interfaces, failing tests, the implementation and the gate.
