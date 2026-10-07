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
| IMG-07 | Header pre-inspection (PNG and JPEG) before decode; desktop 25 MiB / 16 MP, mobile 10 MiB / 8 MP; no silent downscale | S4, S4b, G2.14, G4.3 | AT-22, AT-24 |
| LYR-01 | 1–16 sheets; requested vs exported count, max elevation, base, relief | G2.10b, G2.11c | AT-03, AT-04 |
| LYR-02 | Nearest-layer rule; thresholds shown normalized and in mm | G2.3, G2.4, G2.11c | AT-03 |
| LYR-03 | Balanced, linear and manual thresholds; reject bad order; legacy tonal kept | G2.4, G2.4b | AT-04, AT-21 |
| LYR-04 | Bonded: rect base, no frame by default; frame is canonical material | G1.3 | AT-06, AT-07 |
| LYR-05 | Identical masks kept; trailing empties; empty predecessor blocks | G2.7, G2.10b | AT-04, AT-08 |
| LYR-06 | Draft vs fabrication resolution; export regenerates; diagnostics and acks never reused across quality | G2.2, G2.10b, G3.10, G4.2 | AT-10, AT-15, AT-24 |
| MAT-01 | One thickness, nominal vs measured; adhesive and finishes excluded (stated) | G2.1, G2.10b, G2.11c | AT-01, AT-03 |
| MAT-02 | 1–2000 mm per axis, 0.1–25 mm thickness; lossless units | G2.1 | AT-01, AT-12 |
| MAT-03 | Plywood profile uncalibrated; 3 mm feature and 25 mm² part, provisional | G2.1, G2.8 | AT-10, AT-19 |
| MAT-04 | Uniform opaque color and palette proofs; disclaimer; no geometry effect | G2.11c, G2.12, G3.5 | AT-01, AT-11 |
| MAT-05 | `kerfMode=external` stated in manifest and guide | G3.5, G3.9 | AT-12, AT-19 |
| MAT-06 | Optional calibration coupon (holes, narrow webs, score marks) with no laser settings; calibration record | G2.1, G5.1 | AT-19, AT-25 |
| GEO-01 | Polygons with holes are the single source for every consumer; carrier boundaries representable | S1, G1.1, G1.6, G2.12 | AT-06, AT-07, AT-11 |
| GEO-02 | Bounded smoothing, then frame union, then hole subtraction, before checks; finite-width attachment | S5, G1.3, G2.7, G2.10a | AT-06, AT-09 |
| GEO-03 | Closed, simple, hierarchical rings; saddles split; degenerate loops block export | S1, G1.1 | AT-07, AT-09, AT-13 |
| GEO-04 | 0.05 mm measured (densified Hausdorff) smoothing tolerance; topology and containment fallback | S2, G1.2 | AT-09, AT-10 |
| GEO-05 | Small-part and narrow-neck warnings via erosion by half the width (disappear or split) | G2.8 | AT-10 |
| GEO-06 | ≥3 samples across the minimum feature, from real (not upsampled) samples; show mm/px; refuse export | G1.1, G2.8, G2.14 | AT-10, AT-24 |
| GEO-07 | Final-polygon validation (support, holes, guides) after every change | G2.7, G2.9, G3.1 | AT-08, AT-09, AT-14 |
| GEO-08 | Cleanup report (mm²) with overlays, kept in `validation.json` | G1.2, G2.6, G2.13b, G3.9 | AT-10, AT-15 |
| GEO-09 | 0.001 mm grid, documented winding, round trip ≤ 0.005 mm | T0.6, S1, S6, G1.4, G1.5 | AT-11, AT-12, AT-13 |
| GEO-10 | Footprint inside page; optional bed check (w × h); never rescale | G3.10 | AT-12, AT-22 |
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
| §12.3 | Complexity caps fail explicitly | G2.7, G2.10a | AT-24 |
| NFR-01 | Fully local; no remote URLs (XML namespaces allow-listed) | G4.7 | AT-23 |
| NFR-02 | Off the main thread; 100 ms acknowledgement; 500 ms cancel | G4.1 | AT-24 |
| NFR-03 | Desktop p95: 1.5 s draft, 10 s final, 5 s package; mobile 768² × 6 final ≤ 8 s | G4.4 | AT-24 |
| NFR-04 | Memory budget; estimate first; never silently lower resolution | G2.14, G4.3 | AT-22, AT-24 |
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
3. ● **"Finite-width connection" (GEO-02) [G2.7].** The SRS gives no number. *Default:* blocking if the support intersection does not survive an inward offset of 0.5 µm (it is a line or point contact). A warning if it does not survive an inward offset of `minFeatureMM/2`.
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

## Review Focus

These are inputs the SRS implies but no acceptance test exercises directly. Each one is pinned by a test in the task named.

1. **A non-square image whose integer resize rounds differently on X and Y.** Expected: mm coordinates use separate `sx`/`sy`; a 304.8 × 200 mm artwork exports exactly that size. *Pinned in G1.1:* `"D-4.2 non-square px scales both axes"`.
2. **N changed from 8 to 3 and back while warnings are acknowledged.** Expected: the acknowledgements and part IDs from the 8-layer revision do not carry over to the 3-layer revision. *Pinned in G2.2:* `"§9.5 ack invalid after geometryHash change"`.
3. **A height PNG with full-white or full-black content at N=16.** Expected: no NaN; 16 identical full-domain layers or the base only; identical layers flagged `IDENTICAL_LAYERS` (info), not deduplicated. *Pinned in G2.3:* `"AT-04 white N=16 → 16 identical layers, no NaN"`.
4. **A project title containing `</svg><script>`, `../`, or Windows-reserved characters.** Expected: escaped in SVG, MD and JSON; filenames sanitized. *Pinned in G3.9:* `"NFR-06 hostile title escaped in SVG/MD/JSON/filenames"`.
5. **The user changes a setting while an export is being packaged.** Expected: the package is built from the frozen snapshot of the revision that was current when export started, or is aborted. It never mixes revisions. *Pinned in G3.6:* `"EXP-05 snapshot immutable after later edits"`.
6. **The user reviews a clip at draft resolution, then edits a setting or exports at fabrication resolution.** Expected: an unchanged-config clip is re-shown at fab resolution for review in the export panel; a changed-config clip is marked `REPAIR_STALE` and not applied. *Pinned in G2.9.*
7. **A tiny 200 × 150 px source with fabrication set to 1536 px.** Expected: no upsampling; mm/px is reported from the real samples; `FAB_EXCEEDS_SOURCE` warns. *Pinned in G2.0.*

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

Clip-to-lower stays a reviewed repair only (G2.9). If the product owner rejects smoothing in bonded mode (open question 2), bonded forces `cornerStyle: "sharp"` with collinear-only simplification.
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

### Task G1.2: Containment-aware bounded smoothing on pixel loops (GEO-04, D1)

**Files:**
- Modify:
  - `js/trace.js` (add `T.smoothLevel`);
  - `js/geom.js` (add `maxDeviationUm`, `ringTopology`);
  - `js/material.js` (add `smoothStack`, used by `fromMasks` when `opts.smooth`).

**Interfaces:**
- Produces:
  - `SBGeom.maxDeviationUm(ringA, ringB, stepUm = 10) → number`. This is the symmetric Hausdorff distance with **both rings densified** at `stepUm` (point to segment, with `Math.sqrt` only), so peaks inside segments are measured.
  - `SBGeom.ringTopology(polys) → string`, a canonical signature of the ring count and outer/hole nesting.
  - `SBTrace.smoothLevel(loopPx, level: "chaikin"|"rdp"|"raw", pinned: (pt) => boolean) → loopPx'`. Vertices on the art-rectangle boundary are **pinned**, so the frame union stays exact.
  - `SBMaterial.smoothStack(loopsByLayer, {tolUm, sxUm, syUm, containment: boolean}) → {loopsByLayer, levels, fallbacks: [{layer, loopIndex, from, to, reason: "deviation"|"topology"|"containment", devUm}]}`. It implements D1:
    1. Each loop starts at the highest level whose deviation is ≤ `tolUm` and whose layer topology is unchanged.
    2. With `containment` set (bonded), the layers are walked from the base upward to a fixpoint, as specified in S2.
  - It reports `SMOOTH_FALLBACK` diagnostics. **There is no `conform` function and no automatic clip.**

- [ ] **Step 1: Tests**

```js
suite("smoothing — bounded and containment-aware (GEO-04, D1, AT-09)", () => {
  const F = require("./fixtures.js"), G = SBGeom;
  const stair = [[0,0],[1,0],[1,1],[2,1],[2,2],[3,2],[3,3],[0,3]];
  const toUm = (lp, s) => lp.flatMap(([x, y]) => [Math.round(x * s), Math.round(y * s)]);
  const dev = G.maxDeviationUm(toUm(stair, 1000), toUm(SBTrace.smoothLevel(stair, "chaikin", () => false), 1000));
  check("GEO-04 deviation of chaikin(staircase) at 1 mm/px within 1 µm of 176.78", Math.abs(dev - 176.78) <= 1);
  const r = SBMaterial.smoothStack([[], [stair]], { tolUm: 1, sxUm: 250, syUm: 250, containment: false });
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
  const ci = F.MASKS.crescentInterior;
  const L = SBMaterial.fromMasks(ci.layers, ci.w, ci.h, { artWMM: ci.w * 0.25, artHMM: ci.h * 0.25, frameMM: 0 },
    { smooth: { tolUm: 50, containment: true } });
  check("D1/SUP-02 containment-aware smoothing leaves no overhang", G.isEmpty(G.difference(L[1].material, L[0].material)));
  const bt = F.MASKS.borderTouch;
  const Lb = SBMaterial.fromMasks(bt.layers, bt.w, bt.h, { artWMM: 8, artHMM: 5, frameMM: 0 }, { smooth: { tolUm: 50, containment: true } });
  check("GEO-02 art-boundary vertices pinned (x=0 edge kept exact)", Lb[1].material[0].outer.some((v, i) => i % 2 === 0 && v === 0));
  check("GEO-04 topology unchanged after smoothing (donut keeps its hole)", (() => { const d = F.MASKS.donutIsland;
    const a = SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, {});
    const b = SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, { smooth: { tolUm: 50, containment: true } });
    return G.ringTopology(a[1].material) === G.ringTopology(b[1].material); })());
});
```

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

**G1 exit (SRS §13.1):** AT-06, AT-07, AT-11 (round trip), AT-12 and AT-13 sections are green on the core fixtures. The AT-09 geometry part is green via G1.2's containment and topology checks.

---

## 8. Phase G2: bonded relief engine and opaque review UI

### Task G2.0: Deterministic resampling and the raster contract (IMG-02/03, GEO-06, NFR-05)

**Files:**
- Modify: `js/raster.js` (add `resample`, `rasterSize`)

**Interfaces:**
- Produces:
  - `SBRaster.rasterSize(srcW, srcH, targetLong) → {W, H, capped: boolean}`. The size is never larger than the source. `capped` is true when `targetLong` exceeded the source's long side.
  - `SBRaster.resample(pixels, channels, w, h, W, H, method: "none"|"nearest"|"area") → Uint8Array`. It is pure and integer-only, with no floats in the index math.
    - `nearest` uses `sx = floor((2x+1)*w / (2W))`.
    - `area` is an exact integer box average with half-up rounding.
    - `W > w` or `H > h` throws `RESAMPLE_UPSAMPLE`.
- Policy, which the engine reads from `geometry.resample`:
  - **Height mode:** `none` when the source fits; otherwise `nearest`, which only picks existing values. `area` is available only as an explicit, history-recorded filter (`HEIGHT_FILTERED` info).
  - **Tonal mode:** `area`.
  - The method is recorded in `Snapshot.geometry.resample` and in the manifest.
  - `FAB_EXCEEDS_SOURCE` (warning) is raised when `fabPx` is above the source's long side. mm/px always comes from the real raster.

- [ ] **Tests:**
  - `IMG-03 height nearest: output values ⊆ input values` (on a ramp)
  - `IMG-02 none is the identity`
  - `NFR-05 area on gray is integer-exact and repeatable`
  - `GEO-06 never upsamples: 200×150 source at fab 1536 → 200×150, capped`
  - `GEO-06 mmPerPx uses the real raster after capping`
  - `RESAMPLE_UPSAMPLE thrown for W > w`
- **Commit.**

### Task G2.1: `SBSchema`, project v1, presets, strict keys and lossless units

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
    - `bedMM` null or `{w, h}`;
    - `registration.layers` is `"all"` or a sorted unique index list.
  - `SBSchema.importLoose(obj) → {project, movedToExtras: string[]}`. Unknown **top-level** keys go to `extras`; unknown keys inside geometry sections are still rejected.
  - `SBSchema.geometryKey(p) → object`, scoped as in §3.
  - `SBSchema.toMM(v, unit)` / `fromMM(mm, unit)` for `unit ∈ {"mm","in"}`. Both quantize: `toMM(v,"in") = Math.round(v*25400)/1000`.
  - `SBSchema.modeChangeDiff(p, patch) → [{path, from, to, reason}]`. It lists the settings that a change of `interpretation.mode` or `construction.mode` affects or makes inapplicable. G2.11e uses it.

- [ ] **Step 1: Tests**

```js
suite("schema.js — project v1 (PRJ-01/02, MAT-02/03, §9.1)", () => {
  const p = SBSchema.defaults("plywood");
  check("PRJ-01 plywood preset fields", p.construction.mode === "bonded-relief" && p.interpretation.polarity === "white-high" &&
    p.construction.sheets === 8 && p.construction.gapMM === 0 && p.material.thicknessMM === 6.35 && p.material.calibrated === false);
  check("MAT-03 provisional feature/part", p.material.minFeatureMM === 3 && p.material.minPartMM2 === 25);
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
  check("GEO-10 bedMM has w and h", SBSchema.validate({ ...p, geometry: { ...p.geometry, bedMM: { w: 600, h: 400 } } }).ok);
  check("PRJ-02 mode change lists affected settings",
    SBSchema.modeChangeDiff(p, { construction: { mode: "connected-sheet" } }).some((d) => d.path === "construction.gapMM"));
});
```

- [ ] **Step 2–5:** fail, implement, pass, commit.

### Task G2.2: Acknowledgements and the export gate (`SBDiag`, part 2)

**Files:**
- Modify: `js/diag.js`

**Interfaces:**
- Produces:
  - `SBDiag.ackKey(diag, geometryHash) → string`, which is `code|layer|part-or-aggregate|geometryHash`. `geometryHash` includes `quality` and raster size (§3), so acks taken on a draft snapshot never satisfy a fabrication snapshot (LYR-06).
  - `SBDiag.exportGate(diags, acks: Set<string>, snapshot, expectedQuality = "fabrication") → {allowed, reason, blocking: Diagnostic[], unacked: Diagnostic[]}`. A snapshot whose `quality` is not `expectedQuality` is denied with reason `QUALITY_MISMATCH`.
  - `SBDiag.withAckState(diags, acks, geometryHash) → Diagnostic[]` fills `ackState` for display and for `validation.json`.

- [ ] **Step 1: Tests**
  - `§9.5 blocking cannot be acknowledged` (`exportGate` still denies)
  - `EXP-07 unacked warning → not allowed`
  - `§9.5 ack invalid after geometryHash change`
  - `EXP-07/LYR-06 draft acks do not satisfy fab gate`
  - `LYR-06 draft snapshot rejected by fabrication gate`
  - `§9.5 one ack covers an aggregated PART_SMALL diagnostic`
- [ ] **Step 2–5:** fail, implement, pass, commit.

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

- [ ] **Step 1: Tests**

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

- [ ] **Step 2: Run** and confirm it fails.
- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run** and confirm the tests pass. **Commit.**

### Task G2.4: Tonal path behind the same interface; manual thresholds; domain-aware statistics

**Files:**
- Modify: `js/raster.js:24-164`

**Interfaces:**
- Produces:
  - `SBRaster.thresholds(L, N, mode, {manual?, domain?})`. `mode` now also accepts `"manual"`: manual values are normalized 0..1 and multiplied by 255. The histogram and percentiles use **only pixels in `domain`** when it is given (IMG-04). The result carries `emptyBands: number[]`, the band indices with no in-domain pixels.
  - `SBRaster.kuwahara(L, w, h, r, passes, domain?)`. With `domain` given, it samples only in-domain neighbours and leaves out-of-domain pixels unchanged.
  - `SBRaster.sheetMasks` is reimplemented as `SBHeight.cumulativeMasks(SBHeight.tonalAdded(bandMap, N, darkFront), null, N, w, h)`.
  - With `domain` null, every output is identical to v1.1.0, as the persisted golden pins.

- [ ] **Step 1: Tests**
  - `DEP-04/AT-21 thresholds + sheetMasks match persisted v1.1.0 golden (24 configs)`. This is the T0.4 check; it now exercises the new code against the literal hashes in `test/golden/sheetmasks.json`.
  - `LYR-03 manual thresholds honored`
  - `IMG-06 flat 128 image N=5 balanced: thresholds finite and emptyBands.length === 4`. This fails before the change, because `emptyBands` is undefined.
  - `AT-04 duplicate tonal thresholds → emptyBands non-empty`
  - `IMG-04 tonal thresholds unchanged when out-of-domain pixels are altered`
  - `IMG-04 kuwahara: in-domain output unchanged when out-of-domain pixels are altered`
- [ ] **Step 2–5:** fail, implement, pass, commit.

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
| `procRes` | `geometry.fabPx` |
| `smoothRadius` / `smoothPasses` | `interpretation.smoothing.{radius, passes}` |
| `nSheets` | `construction.sheets` |
| `thresholdMode` | `interpretation.thresholdRule` |
| `darkFront` | `polarity`: dark-front or light-front |
| `palette` | `appearance.palette`, with `appearance.mode = "palette"` |
| `widthMM` | `geometry.widthMM` |
| `marginMM` | `frame: {enabled: > 0, widthMM}` |
| `minFeatureMM` / `bridgeMM` / `cullBelowMM2` / `maxBridgeMM` | `cleanup` / `bridge` |
| `holes` / `holeDiaMM` | `registration` |
| `cornerStyle` | `cleanup.cornerStyle` (`faceted` → `sharp`) |
| `detailEps` (px) | `extras.legacy.detailEps`; resolved later |

    In addition, `interpretation.mode = "tonal"` and `construction.mode = "connected-sheet"`. `geometry.heightMM` is `null`, which raises `LEGACY_NEEDS_SOURCE` (blocking). The whole original JSON is kept in `extras.legacy`.
  - `SBSchema.resolveLegacy(project, srcW, srcH) → project`. It sets `heightMM` from the source aspect, and `toleranceMM = max(0.05, detailEps × widthMM / round(srcW·procRes/max(srcW, srcH)))`, which uses the real working width for portrait sources too.
- The AT-21 guarantee is **same bands, polarity and connected semantics**. It is not byte-identical masks end to end, because v1.1.0 resampled twice on a canvas (the 2000 px pre-cap, then `procRes`). The CHANGELOG records this.

- [ ] **Tests:**
  - `DEP-04 every settingsJSON key (app.js:364-374) is mapped or kept in extras`
  - `AT-21 legacy settings + fixed luminance input → masks equal the persisted golden` (via the engine tonal path with `resample: "none"`)
  - `DEP-04 heightMM null → LEGACY_NEEDS_SOURCE until resolveLegacy`
  - `DEP-04 portrait source: toleranceMM uses real working width`
  - `DEP-04 legacy JSON preserved in extras`
- **Commit.**

### Task G2.5: Domain mask and orientation (IMG-04/05)

**Files:**
- Modify: `js/height.js` (add `domainMask`), `js/engine.js` (add `orient`)

**Interfaces:**
- Produces:
  - `SBHeight.domainMask(alpha: Uint8Array|null, mode, t=0.5) → Uint8Array|null`, where `alpha ≥ round(t*255)` means the pixel is inside A;
  - `SBEngine.orient({samples, alpha, w, h}, {exif, exifAppliedBy, rotate, mirror}) → {samples, alpha, w, h}`. It applies the EXIF orientation only when `exifAppliedBy === "engine"` (the raw PNG path), then the user rotate and mirror. It runs exactly once, before interpretation.

- [ ] **Tests:**
  - `IMG-04 alpha 0.5 threshold defines A`
  - `AT-05 rotate 90 + mirror: orientationF corner lands at the expected corner in material, proof and parsed SVG`, run through the G1.4/G1.5 helpers
  - `IMG-05 EXIF 6 applied once on the engine path` (orientationF with `exif: 6` equals `rotate: 90`)
  - `IMG-05 browser-applied EXIF is not applied again` (`exifAppliedBy: "browser"` → identity)
  - `IMG-05 rotate applied once` (identity is idempotent)
  - Browser harness (G4.8): an EXIF=6 JPEG decodes with swapped dimensions and is not rotated again.
- **Commit.**

### Task G2.5b: Explicit height filter/remap (IMG-03, AT-02)

**Files:**
- Modify: `js/height.js` (add `applyFilter`)

**Interfaces:**
- Produces `SBHeight.applyFilter(samples, w, h, filter: {op: "median"|"box"|"remap", radius?, lut?}) → Uint8Array`. It is integer-only and deterministic.
- `interpretation.heightFilter` is `null` by default. Setting it is a geometry change: it is an undo-history entry (G3.6), it is in `geometryKey`, it is recorded in the manifest, and it emits `HEIGHT_FILTERED` (info).

- [ ] **Tests:**
  - `IMG-03 height mode does not smooth unless heightFilter is set` (spy: no kuwahara, thresholds or applyFilter call when null)
  - `AT-02 smoothing enabled is recorded as an explicit change` (`geometryKey` hash changes, and `HEIGHT_FILTERED` is present)
  - `IMG-03 remap LUT applied exactly`
- **Commit.**

### Task G2.6: Construction strategies (`SBConstruct`)

**Files:**
- Create: `js/construct.js` (§4 position)
- Modify: `js/engine.js` (`legacyRun` delegates to `SBConstruct.connected`)

**Interfaces:**
- Produces `SBConstruct.connected(masks, w, h, px)` and `SBConstruct.bonded(masks, w, h, px)`. Both return `{final: Uint8Array[], bridges: (Uint8Array|null)[], report: [{layer, addedPx, removedPx, filledHoles, removedParts}]}`. The engine converts the report to mm² using `sxUm·syUm` (GEO-08).
- `px = {featR, bridgeR, cullPx, maxBridgePx, speckPx, holePx, frameAnchored, cullEnabled}`.
- **Bonded never calls `SBIslands.resolve`.** It runs the same per-layer `open → close → fillHoles` chain as connected; `removeSpecks` runs only when `cullEnabled` is set (SUP-01: culling is explicit). That chain preserves nesting (verified in T0.4), so bonded morphology never creates an overhang. Bonded applies **no** clip.

- [ ] **Step 1: Tests**

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

- [ ] **Step 2–5:** fail, implement, pass, commit.

### Task G2.7: `SBSupport.validate`: containment, support graph and empty-layer rules on final polygons

**Files:**
- Create: `js/support.js`

**Interfaces:**
- Consumes: `SBGeom.difference`, `intersection`, `offset` (miter), `area`, `isEmpty`, `bbox`; `SBDiag.make`, `aggregate`.
- Produces:
  - `SBSupport.validate(layers: MaterialLayer[], mode, cfg) → {diagnostics, supportGraph: {edges: [{layer, part, supports: [{layer, part, areaUm2}]}], reachesBase: boolean}}`.
  - Bonded rules:
    - `unsupported(k) = difference(Final[k], Final[k−1])`; a non-empty result gives `BOND_UNSUPPORTED` (blocking), with `areaMM2`, `region`, `measured` (area) and `limit` (0).
    - Candidate support pairs are found by a **bbox sort-and-sweep**; only overlapping pairs are intersected.
    - Lower part q supports upper part p iff `intersection(p, q)` survives `offset(−0.5 µm)` (D3; line and point contact do not count). `SUPPORT_NARROW` (warning) if it does not survive `offset(−minFeatureUm/2)`.
    - Every part's support path must reach layer 0.
    - An empty layer under a non-empty one gives `BOND_EMPTY_UNDER`.
    - Identical consecutive layers give `IDENTICAL_LAYERS` (info).
  - Connected rules: each non-empty layer with more than one component gives `CONNECTED_SPLIT` (blocking).

- [ ] **Step 1: Tests**

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
});
```

The end-to-end AT-09 smoothing case runs through `SBEngine.generate` in G2.10a.

- [ ] **Step 2: Property tests** (seeded)

```js
  const rng = F.lcg(7); let allClean = true;
  for (let t = 0; t < 50; t++) { const st = F.randomNestedStack(rng, 24, 18, 5);
    const fin = SBConstruct.bonded(st, 24, 18, { featR: 1, bridgeR: 0, cullPx: 0, maxBridgePx: 0, speckPx: 0, holePx: 8, frameAnchored: false, cullEnabled: false }).final;
    if (SBSupport.validate(SBMaterial.fromMasks(fin, 24, 18, { artWMM: 24, artHMM: 18, frameMM: 0 }, {}), "bonded-relief", { minFeatureMM: 0.01 })
      .diagnostics.some((d) => d.code === "BOND_UNSUPPORTED")) allClean = false; }
  check("D-4.5 property: bonded(nested stack, featR 1) never reports unsupported (50 seeds)", allClean);
```

- [ ] **Step 3: Benchmark hook**

Add `test/bench.js support`, which runs on `randomNestedStack(lcg(1), 1536, 1024, 8)`. Record p95 in `docs/perf/` now; do not wait for G4.4.
- [ ] **Step 4–5:** run (fail), implement, run (pass), commit.

### Task G2.8: Feature and sampling checks (GEO-05/06, MAT-03, AT-10)

**Files:**
- Modify: `js/support.js` (add `featureChecks`)

**Interfaces:**
- Produces `SBSupport.featureChecks(layers, {minFeatureMM, minPartMM2, mmPerPxMax, calibrated}) → Diagnostic[]` (aggregated per layer):
  - `SAMPLING_LOW` (blocking) when `minFeatureMM / mmPerPxMax < 3`, with measured = samples across the feature and limit = 3;
  - per part, `e = offset(part, −minFeatureUm/2, "miter")`:
    - if `isEmpty(e)`, emit `PART_THIN` (warning; the part disappears);
    - if `components(e).length > 1`, emit `NECK_NARROW` (warning; separated residual regions);
  - `PART_SMALL` (warning) when a part's area is below `minPartMM2`;
  - `MAT_UNCALIBRATED` (warning) when `!calibrated`.
- Every GEO-05 message contains the text "Conservative fabrication warning — not a structural simulation".

- [ ] **Tests:** these run on vectorized geometry from `fromMasks` at 0.1 mm/px.
  - `AT-10 1mm feature @0.4mm/px → SAMPLING_LOW`
  - `AT-10 1mm feature @0.25mm/px → no SAMPLING_LOW` (1/0.25 = 4 ≥ 3)
  - `AT-10/GEO-05 neck 2.9 mm with min 3 mm → NECK_NARROW` (narrowBridge, 29 px)
  - `AT-10/GEO-05 neck 3.1 mm with min 3 mm → none` (31 px)
  - `GEO-05 2.9 mm-wide isolated strip → PART_THIN`
  - `AT-10 part 24.9 mm² → PART_SMALL; 25.1 mm² → none`
  - `GEO-05 message labelled conservative, not structural`
  - `MAT-03 uncalibrated warning present`
- **Commit.**

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

- [ ] **Tests:**
  - `SUP-04 proposeClip reports removed area and part counts before apply`
  - `SUP-04 apply → new revision, original project object unchanged`
  - `PRJ-04 repair records source and resulting revisions and afterHash`
  - `AT-09 removed polygons == difference(Final[k], Final[k-1])`
  - `SUP-04 after replay, validate() reports no BOND_UNSUPPORTED on k`
  - `D-4.6 no clip without a repairs[] entry`: the engine output still reports `BOND_UNSUPPORTED` when `repairs` is empty
  - `SUP-04 settings change → REPAIR_STALE, clip not applied`
  - `LYR-06 draft-reviewed clip at fab quality → applied + REPAIR_REVIEW_FAB with fab-resolution area`
  - `D-4.6 removeRepair restores the pre-repair layer hash`
- **Commit.**

### Task G2.10a: `SBEngine.generate`, the §11.1 pipeline through validation

**Files:**
- Modify: `js/engine.js`

**Interfaces:**
- Produces `SBEngine.generate(req: GenerateRequest, {isCanceled?, onProgress?}) → GenerateResponse` (§3 names). `req.engineVersion` must equal `SBEngine.VERSION`, otherwise the response is `status: "error"`, `ENGINE_MISMATCH`. Stages, in order:
  1. orient (EXIF only if engine-applied, then user rotate/mirror)
  2. resample to the requested quality's raster (G2.0 policy; never upsample)
  3. domain mask A
  4. interpret:
     - height: `heightFilter` if set, then `addedFromSamples`;
     - tonal: `R.luminance`, then Kuwahara (domain-aware), then `R.thresholds` (domain-aware) and `R.bands`, then `tonalAdded`.
  5. `cumulativeMasks`
  6. construct strategy (cleanup report in mm²; bridge polygons kept for the overlay)
  7. per layer: trace, then bounded smoothing **on pixel loops, art only** (G1.2; containment-aware in bonded mode), then `fromPixelLoops` to µm, then normalize
  8. frame union (exact rectangle ring)
  9. replay `repairs[]` (G2.9)
  10. registration holes are proposed from the pre-hole material, then subtracted (G3.1 inserts this; until then, the legacy connected corners from G1.7)
  11. complexity caps. If parts per layer or total vertices exceed the device-class cap, return `status: "error"` with blocking `COMPLEXITY_LIMIT` and **no** layers.
  12. `SBGeom.validate`, `SBSupport.validate` and `featureChecks`
  13. `assignParts`
  14. guides plus guide-containment validation (G3.1 inserts this)

  `isCanceled()` is checked between stages and inside per-layer loops; it gives `status: "canceled"`. `onProgress(stage, frac)` maps to `status: "progress"` messages in the worker (G4.1).
- **Test-only hook:** `req.debug = {disableContainmentFallback: true}` is accepted only when `SBEngine.TEST_HOOKS` is set. The Node runner sets it; it is never set in the browser and never persisted. AT-09 uses it to show that final validation catches a smoothing overhang end to end.

- [ ] **Tests:**
  - `NFR-10 generate runs in Node from PNG bytes (via SBPng) to Snapshot`
  - `§9.3 engineVersion mismatch → status error ENGINE_MISMATCH`
  - `GEO-02 stage order: frame and base rings are exact rectangles after smoothing (cornerStyle smooth)`
  - `AT-09 crescentInterior, cornerStyle smooth, containment fallback disabled → final validation reports BOND_UNSUPPORTED although masks nested`
  - `AT-09 same with fallback enabled → no BOND_UNSUPPORTED, SMOOTH_FALLBACK reported`
  - `AT-09 proposeClip on the disabled-fallback result removes exactly the overhang, then rerun reports none`
  - `IMG-03 height mode does not smooth unless heightFilter is set` (spy on kuwahara, thresholds and applyFilter)
  - `§12.3 30k-part noise input → COMPLEXITY_LIMIT, no layers returned`
  - `§9.3 isCanceled → status canceled`
- **Commit.**

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
- **Draft/fabrication rule (LYR-06):** interaction uses `quality: "draft"`. **Every** export, starting with alpha.2, runs `generate` at `quality: "fabrication"`, opens the review panel on that snapshot's diagnostics, and gates on `exportGate(…, "fabrication")`. Draft diagnostics and acks are never reused.

- [ ] **Tests:**
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
- **Commit.**

### Task G2.11a: Controller state adapter; no auto-demo (PRJ-01)

**Files:**
- Modify: `js/app.js:34-62` (`state` → `project`), `js/app.js:70` (`runPipeline` → `regenerate()`), `js/app.js:652-653` (remove the auto-demo click)
- Create: `SBSchema.legacyState(project)` in `schema.js` (pure)

- [ ] **Tests (Node):**
  - `PRJ-01 legacyState(defaults("acrylic")) reproduces v1.1.0 state keys`
  - `PRJ-01 regenerate is not callable without a source` (pure guard `SBSchema.canGenerate(project, source)`)
- **QA checklist** (`docs/QA_CHECKLIST.md`): the app opens empty; Demo is an explicit source button; Generate and Export are disabled with a "Choose a source" reason.
- **Commit.**

### Task G2.11b: Stage markup and slider ranges (UI-01)

**Files:**
- Modify:
  - `index.html:51-117`: rail stages Source / Interpretation / Construction / Review / Export;
  - `index.html:62`: `#in-res` becomes "Fabrication resolution", `min=360 max=4096 step=4`;
  - `index.html:71-72`: `#in-sheets` `min=1 max=16`;
  - `css/style.css`.
- **QA:** stages are reachable by keyboard in order. **Commit.**

### Task G2.11c: Control groups, dimension bar and disclaimers

**Files:**
- Modify: `index.html`, `js/app.js` bindings (:492-640), `css/style.css` (`.dimbar`)

**Interfaces:**
- Selects: `#in-interp`, `#in-polarity`, `#in-construction`, `#in-thickness`, `#in-thickstate`, `#in-gap`, `#in-manual-th`, `#in-units`, `#in-appearance`, `#in-color`, `#in-explode`.
- Appearance and view changes call `renderAll()` only, following the pattern at `app.js:614`. Geometry changes bump the revision and call `regenerate()`.
- The persistent `.dimbar` shows:
  - requested and exported count;
  - max Z, base t and relief;
  - mm/px of the real raster;
  - a thresholds popover listing every boundary as **normalized and mm**, from `SBHeight.boundaries` (LYR-02).
- Disclaimer copy, from pure strings in `SBDocs.COPY`:
  - MAT-01: "Stock height excludes adhesive films and surface finishes."
  - MAT-04: "Palette shading is a proof aid; it is not necessarily the appearance of unpainted stock."

- [ ] **Tests (Node, on `SBDocs.COPY` and a pure `dimbarModel(snapshot)`):**
  - `LYR-02 dimbar thresholds in normalized and mm`
  - `LYR-01 dimbar shows requested vs exported`
  - `MAT-01 adhesive/finish exclusion text present`
  - `MAT-04 palette disclaimer text present`
- **Commit.**

### Task G2.11d: Applicability and disabled-with-reason controls

**Files:**
- Modify: `js/schema.js` (`applicability`), `js/app.js`, `css/style.css` (`.row.disabled`, `.why`)

**Interfaces:**
- `SBSchema.applicability(project) → {controlId: reason|null}`.
  - In bonded mode, `#in-bridge`, `#in-maxbridge` and `#in-gap` are disabled, `#in-cull` is enabled as opt-in, and `#in-margin` defaults to 0.
  - Each disabled row shows `.why` text and an `aria-describedby` reason.
  - A settings import that sets an inapplicable display-only value raises `DISPLAY_ONLY_IGNORED` (info).

- [ ] **Tests:**
  - `UI-01 bonded disables bridge controls with reason`
  - `UI-01 connected enables gap`
  - `§9.5 inapplicable imported setting → DISPLAY_ONLY_IGNORED info`
- **Commit.**

### Task G2.11e: Mode-change review (PRJ-02, AT-21)

**Files:**
- Modify: `js/app.js` (confirm dialog), `index.html` (a `<dialog>`)

**Interfaces:**
- Changing `#in-interp` or `#in-construction` does not apply the change at once. It opens a dialog listing `SBSchema.modeChangeDiff(project, patch)`. **Accept** applies the patch (revision + 1); **Cancel** leaves the project untouched.

- [ ] **Tests:** `PRJ-02 cancel leaves project revision unchanged`, run on a pure `SBProject`-free helper `applyModeChange(project, patch, accepted)`.
- **QA:** the dialog is keyboard-operable, and focus returns to the select. **Commit.**

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

- [ ] **Tests:**
  - `UI-03 section of donutIsland at the island row has 3 intervals on layer 1` (ring left, island, ring right)
  - `UI-03 bonded z = k*t; connected z = k*(t+g)`
  - `UI-02 proof drawParams: no smoothing, no shadows, no parallax`
  - `UI-02 retained/waste model per layer equals material polygons`
  - `MAT-04 uniform proof strokes layer edges`
- **Manual:** the AT-11 visual comparison of the proof against `assemblySVG`; the tilt tab label reads "Illustrative"; the explode slider moves layers without changing `geometryHash` (AT-11 hash part is in G2.10b). **Commit.**

### Task G2.13a: Retained/waste layer cards

**Files:**
- Modify: `js/app.js:186-236` (`renderSheetGrid`, `renderPaletteChips`), `css/style.css` (`.sheetcard`)

**Interfaces:**
- Per-layer cards are drawn from `layer.material`, using the per-snapshot offscreen cache, with a waste hatch.
- **QA:** the cards match the proof. **Commit.**

### Task G2.13b: Overlays and state badges (GEO-08, UI-05)

**Files:**
- Modify: `js/preview.js`, `js/diag.js` (`nextState`), `index.html` (`#in-bridgesvis` is fed from `cleanupReport[].bridges`)

**Interfaces:**
- Overlays: cleanup added in green, removed with a dashed outline (mm² labels), unsupported in red with a "!" icon, bridges in amber (connected mode).
- State badges: draft / stale / processing / validated / failed.

- [ ] **Tests:** `UI-05 nextState transitions draft→processing→validated|failed and any edit → stale`.
- **Commit.**

### Task G2.13c: Diagnostics panel (UI-04, NFR-07)

**Files:**
- Modify: `js/app.js`, `index.html`, `css/style.css` (`.diag-list`, `.badge`)

**Interfaces:**
- The list is grouped by severity, with an icon plus text. Each item shows its measured value against the limit. Clicking or pressing Enter on an item focuses its layer and part and highlights the region. Warnings have an "Acknowledge" checkbox scoped to the current snapshot.
- Pure helper: `SBDiag.summarize(diags) → [{severity, label, count}]`.

- [ ] **Tests:**
  - `UI-04 summarize labels are text, not color names`
  - `UI-04 item text includes measured vs limit`
- **Manual:** AT-08, AT-10 and the keyboard path of AT-20. **Commit.**

### Task G2.13d: Clip dialog and revert (SUP-04)

**Files:**
- Modify: `js/app.js`, `index.html`

**Interfaces:**
- "Clip to lower layer" opens the `proposeClip` result: removed area overlay, removed mm², and part count before/after. Accept calls `applyClip`. Each `construction.repairs` entry has a **Revert** button (`removeRepair`). `REPAIR_STALE` and `REPAIR_REVIEW_FAB` items link back to this dialog.
- **QA:** AT-09 and AT-15 flows. **Commit.**

### Task G2.14: Source intake: header inspection, raw PNG wiring and explicit preflight (no silent downscale)

**Files:**
- Modify: `js/app.js:519-566` (`loadFile`; delete `downscaleIfHuge`), `js/schema.js` (`limits`, `preflight`)

**Interfaces:**
- Produces: `SBSchema.preflight({bytes, info, deviceClass, fabPx}) → {ok, code?, reason?, suggestDownsamplePx?, warnings: []}`. `info` comes from `SBPng.inspect` or `SBJpeg.inspect`, so the dimensions are known **before** decoding.
- Intake order:
  1. sniff the signature;
  2. run `inspect` and `check` (both modes);
  3. run `preflight`;
  4. decode. Height PNGs go through `SBPng.decode`; tonal PNG/JPEG use the browser decode (`decode: "canvas-tonal"`, `exifAppliedBy: "browser"`).
- Downsampling happens only through an explicit button. It records `geometry.fabPx` and a history entry.
- mm/px is computed from `min(source long side, fabPx)`, which matches G2.0.

- [ ] **Tests:**
  - `IMG-07 desktop 26MiB rejected`
  - `IMG-07 desktop 17MP rejected with downsample suggestion` (dimensions from the PNG header)
  - `IMG-07 JPEG 6000×4000 (24 MP) rejected from SOF before decode`
  - `IMG-07 mobile 9MP rejected`
  - `IMG-01 tonal APNG and tonal 16-bit PNG rejected at intake`
  - `GEO-06 fabPx above source → FAB_EXCEEDS_SOURCE, mm/px from source`
  - `NFR-04 no code path lowers resolution without explicit flag`: a grep check that `downscaleIfHuge` is absent from `js/app.js`
- **Commit.**

### Checkpoint: v2.0.0-alpha.2, "experimental bonded relief" (MVP graft)

- [ ] Bump `APP_VERSION`/`VERSION` to `2.0.0-alpha.2` (the T0.2 check enforces equality), rebuild `dist/`, and add a CHANGELOG entry with a **known-gaps table**. Until G3 there are no guides, no `.sbrproj` and no manifest, and export keeps the legacy flat layout. Export always regenerates at fabrication quality and requires the fab review (G2.10b rule). Fabrication export stays disabled by `SBDiag.exportGate` whenever any blocking diagnostic exists.
- [ ] Add the end-to-end Node check `E2E height plywood preset → 8 layers validated, 0 blocking on ramp fixture`.

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
| **G3.5** Placement map and instructions | Printable map of every part ID; pure `ASSEMBLY.md` generator with separate bonded and connected texts. The kerf text (`app.js:339-340`) and spacer text (`app.js:349-351`) are rewritten. | `SBSvg.placementMapSVG(snapshot, guides)`; `js/docs.js` `SBDocs.assembly(project, snapshot) → string` (replaces `app.js:311 buildAssemblyMD`) and `SBDocs.COPY` | `ASM-01 map lists every part ID`; `ASM-05 contains front face, base-to-front order, every part ID with support refs, keep/discard, omitted layers, which guides belong to which layer, zero gap, nominal vs measured`; `MAT-05 "no kerf offset applied (kerfMode=external)"`; `NFR-12/EXP-09 no speed/power values` (regex `/\b\d+(\.\d+)?\s*(%\|mm\/s\|mm\/min\|k?W)(?!\w)/i` absent); `EXP-09 downstream-edit warning present`; `ASM-05 bonded text contains no "spacer"`; `MAT-01/MAT-04 disclaimers present in ASSEMBLY.md` | ASM-01, ASM-05, MAT-01, MAT-04, MAT-05, EXP-09, NFR-12 |
| **G3.6** Revisions, undo/redo and frozen snapshots | Monotonic revisions; command stack of config patches, filter changes and repair ops, depth ≥ 20; deep-frozen snapshot; export reads only the snapshot whose revision equals the revision current when export started | `js/project.js` `SBProject.create(p)`, `.apply(patch)`, `.undo()`, `.redo()`, `.freeze(snapshot)` | `PRJ-04 25 undos restore config`; `PRJ-04 revisions monotonic`; `PRJ-04 repair op in history with source/result revisions`; `SUP-04 undo of repair restores prior hash`; `IMG-03 heightFilter change is an undoable entry`; `EXP-05 snapshot immutable after later edits` (Review Focus 5) | PRJ-04, EXP-05, SUP-04 |
| **G3.7** Safe ZIP reader | Central-directory parser; stored entries plus deflate-raw through `DecompressionStream("deflate-raw")`; running byte budget | `SBZip.read(bytes, {maxEntries: 1024, maxBytes}) → Promise<Map<name, Uint8Array>>` | `§9.4 ../ traversal rejected`; `absolute/backslash path rejected`; `duplicate entry rejected`; `>1024 entries rejected`; `declared vs actual size mismatch rejected`; `expanded > limit aborts`; `nested .zip/.sbrproj rejected`; `round trip with SBZip.build` | §9.4, NFR-06, PRJ-03 |
| **G3.8** `.sbrproj`, migration and legacy import | The container holds `project.json`, `source/samples.bin`, `source/meta.json` and optionally `source/original.*`. Validate **before** replacing the open project. Explicit `migrate(from → to)`. An unknown newer major is rejected and the current project kept. Legacy import uses `SBSchema.fromLegacySettings` (G2.4b) and `resolveLegacy` when a source is attached. | `SBProject.pack(project, samples) → Uint8Array`; `SBProject.unpack(bytes) → Promise<{project, samples}>`; `SBSchema.migrate(obj)` | `AT-17 save→load without original → identical geometryHash`; `AT-17 app-version bump → identical geometryHash`; `IMG-02 sample hash verified on load (SBHash.digest)`; `PRJ-06 newer major rejected, current untouched`; `DEP-05 no silent downgrade`; `AT-21/DEP-04 v1.1.0 settings + source → tonal+connected, same bands and polarity`; `AT-22 unknown geometry key in project.json rejected` | PRJ-03, PRJ-06, DEP-04, DEP-05 |
| **G3.9** Fabrication package and manifest | Exact §9.4 layout through a pure `filePlan` (MVP graft); ZIP name `<sanitized-title>_fabrication.zip`. **Manifest (EXP-06, every SRS:L330 field):** schema, app and engine versions, **upstream baseline `f0552c7`**, `sourceHash`, `sampleHash`, units, **dimensions (artwork and finished page)**, **interpretation mode, polarity and threshold rule**, thresholds used (normalized and mm), **material settings (thickness, state, calibrated, calibration record)**, **resolution (quality, raster w×h, mm/px, resample method)**, tolerances, inventory including omitted indices, Z per layer, conventions (mm, Y-down, front face, no mirroring), `kerfMode:"external"`, support graph, per-file SHA-256 (`SBHash.digest`), and separate uncertainty fields (D-4.2). **`validation.json`:** every diagnostic with `ackState`, plus the **cleanup report in mm²** (added and removed area, holes filled, parts removed) (GEO-08). The tilt PNG is optional: if present it is `proof/illustrative-tilt.png` with an "illustrative" label, and it is outside the exact-inventory check. | `js/package.js` `SBPackage.filePlan(snapshot, opts) → [{path, kind}]`; `SBPackage.buildFabrication(snapshot, project, opts) → files[]`; `app.js:399 buildAndDeliver` becomes a thin call | `EXP-04 inventory exact` (`cuts/layer_00_base.svg`, `cuts/layer_01.svg`…, `proof/assembly.svg`, `proof/placement-map.svg`, `ASSEMBLY.md`, `manifest.json`, `validation.json`, `settings.json`, `project.sbrproj`; tilt PNG optional); `EXP-04 zip name <title>_fabrication.zip`; `EXP-01 trailing-empty layer has no file, index gap kept`; `EXP-06 manifest has every SRS:L330 key`; `EXP-06 manifest hashes match file bytes`; `GEO-08 validation.json cleanupReport in mm²`; `AT-16 generate twice → byte-identical SVGs and manifest except timestamp`; `NFR-06 hostile title escaped in SVG/MD/JSON/filenames` (Review Focus 4); `SUP-03 support graph in manifest` | EXP-01, EXP-04, EXP-05, EXP-06, SUP-03, MAT-05, GEO-08, NFR-06 |
| **G3.10** Two-phase export, delivery states and bed check | **Phase 1:** freeze the current revision and generate at fabrication quality (worker). **Phase 2:** open the review panel scoped to that fab snapshot's `geometryHash`. It lists blocking items, unacknowledged warnings and any `REPAIR_REVIEW_FAB`, and the user acknowledges the warnings there. **Phase 3:** package only if `exportGate(fabDiags, acks, fabSnapshot, "fabrication").allowed`. Any edit during phases 1–2 marks the result stale and cancels. Export is disabled while stale, processing or blocked. **Diagnostic-only package:** `<title>_NOT-READY-TO-CUT_diagnostic.zip` contains `project.sbrproj`, `validation.json`, `manifest.json` and `proof/` but **no `cuts/`**; its README states it is not for cutting. `deliverFile` (`app.js:449`) returns `"generated"`, `"handed-off"`, `"canceled"` or `"failed"`. Optional `geometry.bedMM {w, h}` raises `PAGE_OVERFLOW` (either axis, either orientation) and never rescales. | `SBDiag.exportGate` (G2.2); `SBPackage.buildDiagnostic(...)`; `SBPackage.deliveryState(event)`; `SBSupport.checkEnvelope(page, bedMM)` | `EXP-07 blocking → disabled`; `EXP-07 draft acks do not satisfy fab gate`; `EXP-07 fab warnings acked in fab review → allowed`; `AT-15 diagnostic-only package has no cuts/ entries and is labelled NOT READY TO CUT`; `EXP-08 share AbortError → canceled, project intact`; `GEO-10 page > bed (w or h) blocks, no rescale` | EXP-07, EXP-08, GEO-10, LYR-06, NFR-09 |
| **G3.11** Autosave and recovery | Debounced `.sbrproj` written to IndexedDB through an injectable storage adapter, with a recovery prompt. On quota or private-mode failure, show a persistent "Unsaved" badge and a "Download project" button. Wire the result of the existing `navigator.storage.persist()` call (`app.js:656`, `:679`) into the autosave status ("storage may be cleared"). | `SBProject.autosave(store, project)`, where `store` is `{put, get}` | `PRJ-05 quota error → unsaved flag + download offered` (fake store throws `QuotaExceededError`); `PRJ-05 persist() false → status shows non-persistent storage` | PRJ-05 |

**G3 exit:** AT-14 to AT-17 and the AT-22 import subset are green. A sample package is checked into `docs/samples/` for review. Release `2.0.0-beta.1`.

## 10. Phases G4 (hardening) and G5 (fabrication release)

| Task | Work | Files / interfaces | Named checks / evidence | Reqs |
|---|---|---|---|---|
| **G4.0** Service-worker update gating (**before G4.1**) | Remove the unconditional `skipWaiting()` (`sw.js:46-48`). A waiting worker shows "Update available"; `skipWaiting` runs only on user action and never while the project is unsaved or an export is in progress. One cache per version; visible cache/update status. Because a dedicated worker's `importScripts` goes through the controlling SW, the worker must never mix versions (G4.1 handshake). | `sw.js:19-66`, `app.js:664` | `DEP-02 sw.js has no unconditional skipWaiting in install`; `DEP-02 VERSION == APP_VERSION` (T0.2); AT-23 evidence | DEP-02 |
| **G4.1** Worker, cancel and stale handling (§9.3) | `js/worker.js` `importScripts`s the pure modules in §4 order and runs `SBEngine.generate`. Messages follow §3 `GenerateRequest`/`GenerateResponse`: `engineVersion` is checked both ways (a mismatch rejects and reloads the worker), `status: "progress"` messages are posted per stage, and the response carries `validatedLayers`, `diagnostics` and `geometryHash`. The controller accepts a response only if `requestId` and `revision` match. It **transfers a copy** of `normalizedSource.pixels`, so the project keeps its own copy. Cancel = `worker.terminate()` plus respawn (< 500 ms). Packaging runs in the worker. `build.js` **changes**: it emits the worker modules as `<script type="text/sb-worker">` and starts a Blob worker in `dist/`. On `file://` failure it falls back to chunked main-thread execution with a notice. | `SBDiag.acceptResult(active, response) → boolean` (pure) | `AT-15 stale response discarded`; `§9.3 engineVersion mismatch rejected`; `AT-15 cancel during export keeps last revision and source`; `§9.3 progress messages precede done`; four-list consistency extended to `worker.js` | NFR-02, UI-06, §9.3, NFR-09 |
| **G4.2** Draft vs fabrication pipelining | The G2.10b rule is already enforced. This task makes the fab generation run in the worker while the UI stays responsive, caches the last fab snapshot per revision, and shows "Preparing fabrication geometry…" in the export flow. | `js/app.js`, `js/worker.js` | `LYR-06 export regenerates at fabPx in worker`; `LYR-06 cached fab snapshot reused only for the same revision` | LYR-06 |
| **G4.3** Resource envelope and complexity caps | `deviceClass()` uses `deviceMemory` plus coarse pointer, with a user override. The working-set estimate is `w·h·bytesPerStage`; over budget means reject or offer an explicit downsample. Complexity caps per device class (parts per layer, total vertices; mobile: 100 parts/layer, 20,000 vertices per SRS:L562) feed `COMPLEXITY_LIMIT`. Also applies the mobile `.sbrproj` 64 MiB limit. | `SBSchema.estimateWorkingSet(w, h, N)`, `SBSchema.limits(deviceClass)` | `NFR-04 estimate > 192 MiB on mobile → reject code`; `§12.3 mobile caps 100 parts / 20k vertices`; `§9.4 mobile maxBytes 64 MiB` | IMG-07, NFR-04, §12.3 |
| **G4.4** Benchmarks | `test/bench.js <stage>`: 5 warmups then 30 runs, reporting p50/p95/max as JSON in `docs/perf/`, plus an in-app `?bench`. Two workloads: the desktop reference, and the **mobile reference (768 × 768 samples, 6 layers, ≤100 parts/layer, ≤20,000 vertices)**. Cancellation latency is measured in both. | — | Desktop p95: draft ≤ 1.5 s, final plus validation ≤ 10 s, package ≤ 5 s. **Mobile p95: final plus validation ≤ 8 s**, measured on the recorded ≥4 GB device. Cancel ≤ 500 ms on both. | NFR-02, NFR-03, AT-24 |
| **G4.5** Accessibility | Keyboard path through stages, tabs, diagnostics and dialogs; `aria-live` status; focus styles; `prefers-reduced-motion` disables the tilt animation; **200% zoom** layout check; audit in `docs/A11Y_AUDIT.md`; browser matrix in `docs/ACCEPTANCE.md` | `index.html`, `css/style.css`, `app.js` | AT-20 evidence, including 200% zoom and reduced motion, and proof/section available without tilt | NFR-07, NFR-08, UI-04 |
| **G4.6** Local server path and deployment docs | README (replacing "No server" at `README.md:18`): serve locally with `python3 -m http.server 8000` (or any static server) and open `http://localhost:8000`. Production needs HTTPS for the service worker and workers. `file://` gives reduced responsiveness (open question 10). The T0.2 four-list test stays the only `SHELL` guard; there is no generated `SHELL`. | `README.md`, `docs/DEPLOY.md` | `DEP-01 README documents local server and HTTPS`; AT-23 evidence | DEP-01 |
| **G4.7** Locality and reproducible build | A test checks that no remote URL appears in `index.html` or `dist/` in a **loading context** (`src=`, `href=`, `url(`, `fetch(`, `importScripts(`, `import(`), plus any literal `https?://` outside an allow-list of XML namespace URIs (`http://www.w3.org/2000/svg`, `http://www.w3.org/1999/xlink`) and comments. `build.js` writes `dist/BUILD.json` with a **source-tree content hash** (SHA-256 over the inlined inputs in order), the per-file hashes and the component list. It records no git commit. | `build.js`, `run_tests.js` | `NFR-01 no remote URLs in bundle (namespaces allow-listed)`; `DEP-03 build twice → identical dist and BUILD.json`; `NFR-11 every vendor file listed in COMPONENTS.md with matching SHA-256` | NFR-01, NFR-11, DEP-03 |
| **G4.8** Browser integration harness and cross-browser determinism | `test/browser.html` loads the real modules (and `dist/`) and runs integration suites. It covers: canvas decode plus EXIF=6 JPEG (applied once), the PNG intake path, `DecompressionStream`, the worker round trip and cancel, SW registration and update gating, and `geometryHash` of 5 fixture projects. Results are written to the DOM as JSON. Driven by `chromium --headless=new --dump-dom file://…/test/browser.html?run` (no npm) in `test/run_browser.sh`. Firefox and Safari run manually and record the same JSON. A dev-only component entry goes in `COMPONENTS.md` if any helper is vendored. | `test/browser.html`, `test/run_browser.sh` | `NFR-10 browser integration suites pass in Chromium headless`; `NFR-05/AT-23 geometryHash identical across Chromium, Firefox, Safari and Node for 5 fixtures`; `IMG-05 EXIF 6 JPEG oriented once` | NFR-05, NFR-08, NFR-10, AT-23 |
| **G5.1** Calibration coupon and calibration record | Optional `calibration/coupon.svg`: 100 mm square outer dimension, kerf comb, 3 mm feature ladder (narrow webs), **representative holes (3 mm, 5 mm, 8 mm via `SBGeom.circle`)**, sample score marks, no laser settings. A form records `material.calibration` (date, machine, material, measured kerf, smallest successful feature, score result, notes), which goes into the manifest (MAT-06, AT-19). | `SBSvg.couponSVG()`; `SBPackage` option; `js/app.js` form | `MAT-06 coupon only when requested`; `MAT-06 coupon contains holes, narrow webs, score marks`; `AT-18 100 mm square exact in µm`; `MAT-06 calibration record stored and exported` | MAT-06 |
| **G5.2** Acceptance evidence | LightBurn import within 0.1 mm (AT-18); calibration workflow (AT-19); three plywood projects cut and glued (AT-25); browser and offline matrix (AT-23); mobile benchmark (AT-24) | `docs/ACCEPTANCE.md`, `docs/RELEASE_RECORD.md` | AT-18, AT-19, AT-23, AT-24, AT-25 signed off | EXP-09, NFR-08, NFR-12, DEP-01 |
| **G5.3** Release v2.0.0 | Bump `APP_VERSION` and `VERSION`; CHANGELOG with the intentional legacy fixes (frame union, proof extent, groups, bounded smoothing, resampling change, no auto-demo, ZIP layout and name); rollback notes (an older build refuses schema v2+ projects); `COMPONENTS.md`; rebuilt `dist/` | docs, `sw.js`, `app.js:23` | AT-26 evidence | DEP-03, DEP-04, DEP-05, NFR-11 |

---

## 11. Risk register (ranked)

| # | Risk | Impact | Mitigation | Kill / fallback |
|---|---|---|---|---|
| R1 | Geometry backend is not robust, too slow, too large, or not loadable as a classic script | Blocks G1 and every GEO/SUP/ASM requirement | S1 battery, load-form checks and benchmarks (difference, offset, support pairs); all calls go through the `SBGeom` adapter; the battery becomes the regression suite | Exact orthogonal booleans and lattice offsets (bonded edges stay faceted) |
| R2 | Containment-aware smoothing falls back to raw so often that smoothing is useless in bonded mode | Faceted bonded edges | S2 measures the fallback rate; fallbacks are reported per loop | Bonded is unsmoothed only (open question 2); nesting holds by construction |
| R3 | Cross-browser non-determinism (decode, transcendental math, joins) | AT-16/17/23 fail; NFR-05 broken | Raw PNG decoder; hard-coded hash constants; miter/square joins only; integer circle table; integer resampler; `.sbrproj` stores samples; G4.8 cross-browser hash comparison | Store canonical geometry in `.sbrproj` and treat it as authoritative on reopen |
| R4 | Engine extraction or resampling changes connected-mode output | AT-21 regression | Persisted goldens (sheetMasks, thresholds, oldRun, legacy SVG); the resample change is documented; DEP-04 table | Revert to `legacyRun` for connected mode |
| R5 | Fabrication resolution plus booleans exceed 10 s (desktop) or 8 s (mobile) p95, or the memory budget | NFR-03 and NFR-04 fail | Support benchmark from G2.7; bbox sweep; diagnostic aggregation; worker; per-device complexity caps with `COMPLEXITY_LIMIT` | Lower the default `fabPx` only through an explicit UI choice |
| R6 | Two-phase export and fab re-review of repairs feel heavy to users | Friction, ignored warnings | Aggregated diagnostics; review panel shows only fab-new or changed items prominently; the fab snapshot is cached per revision (G4.2) | Pre-generate the fab snapshot in the background after edits settle |
| R7 | Four-list, `dist/` or SW drift breaks offline use or serves mixed versions | Broken PWA, wrong hashes | T0.2 hygiene checks; SW off on localhost; G4.0 before G4.1; engine-version handshake | — |
| R8 | `DecompressionStream` missing on old Safari (< 16.4) | PNG and ZIP read fail | Feature-detect and block with an explanation; NFR-08 only targets current and previous browser versions | — |
| R9 | MUST-everywhere SRS means non-compliance until G3 | Pressure to ship partial work | Experimental alpha.2 checkpoint with a known-gaps table; the export gate stays strict | — |
| R10 | Vendored library goes unmaintained | Long-term burden | Thin adapter; pinned SHA; licence in `COMPONENTS.md` | Swap the backend behind `SBGeom` |
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
2. Bonded smoothing: containment-aware per-loop fallback (Chaikin → RDP → raw); clip-to-lower only as a reviewed repair.
3. GEO-02 finite-width contact: < 0.5 µm overlap blocks export; warns when the contact does not survive `offset(−minFeatureUm/2)`, i.e. contact width below the full minimum feature width.
4. NFR-10 browser integration: in-repo headless-Chrome harness, no npm.

All non-blocking defaults (guide dimensions, resolutions, Plywood preset, EXIF handling, upstream patches) are accepted as proposed.

## Appendix C — Spike amendments

Plan changes implied by the spike results. Each bullet names the affected tasks; the evidence is in `docs/spikes/` and `docs/ARCHITECTURE.md` (Decisions).

- **S1 → D2, G1–G5:** `<lib>` resolves to `clipper2-ts` 2.0.1-18, vendored as `js/vendor/clipper2.js` (global `Clipper2`) with `js/vendor/LICENSE-clipper2.txt`; module order is `… hash → vendor/clipper2 → geom …`. `SBGeom.backend` (string) is added to the S1 interface table.
- **S1 → S1 battery, G4.8:** the plan's load-form regex `/^\s*(import|export)\s/m` misses minified mid-line `export{…}`. The regression suite also runs the stricter `/\bimport\s*[{*"'(]|import\.meta|\bexport\s*[{*]|\bexport\s+(default|const|let|var|function|class)\b/`, plus strict-IIFE, worker-global (`self`) and SHA-256 pin checks.
- **S1 → T0.2, G4.7 (NFR-11):** `build.js` now embeds every `js/vendor/LICENSE-*.txt` verbatim in a leading comment of `dist/shadowbox-studio.html`, because the bundle ships third-party code as source text; T0.2 hygiene checks it.
- **S1 → G4.1:** `js/worker.js` must `importScripts("vendor/clipper2.js", "geom.js")` in that order after `hash.js` (fourth list of the four-list rule); the vendor file already loads in a worker-like global.
- **S1 → AT-23, G4.8:** the geometry backend requires ES2020 `BigInt` at runtime; add it to the browser matrix prerequisites.
- **S1 → D3, S5, S6 (D4):** `SBGeom.normalize` (and every boolean result) re-chains boundary edges canonically at shared vertices (sharpest left turn) before splitting saddles, so canonical bytes depend only on the edge set. S5/S6 must keep this inside normalization and keep the 240-case `components` property check. T-contacts (a vertex on another ring's edge interior) are not re-chained; S5 confirms whether they occur.
- **S1 → GEO-05, D3, G2.7, G2.8, G3.3 (guides):** `"miter"` (limit 2.0) is the join with exact lattice semantics; `"square"` is Clipper2's chamfered corner (not Chebyshev). Every lattice-exact offset (GEO-02 contact survival, feature checks, guide insets) uses `"miter"`.
- **S1 → S1 interface, G1.7, G3.4, G5.1 (`SBGeom.circle`):** the vertex rule changes from `Math.round(cx + r*t/1e6)` to `cx + roundHalfAwayFromZero(r*t/1e6)` in exact integer arithmetic (keeps 8-fold symmetry on .5 ties); centre and radius must be integers; the ring is cleaned, so radii < 232 µm yield fewer than 64 vertices. `ASM-04 subtractHoles leaves hole rings equal to SBGeom.circle` compares against this normalized ring.
- **S1 → S1 Step 2, G4.4 (benchmarks):** "8 layers × 50k vertices pairwise difference" is defined as the 7 adjacent layer pairs in both directions (14 differences per run). B1 passed narrowly (p95 1.58 s in the spike; 2.16 s on a heavily loaded re-run), so G4.4 re-measures it on the reference machines and G4.1 moves it off the main thread.
- **S1 → G2.7, G4.4 (support benchmark):** `test/bench.js geom` adds **B3b**, the support pass on the dense B1 noise stack (3,407 pairs), with a provisional budget p95 < 6 s (measured 4.55 s). The G2.7 support pass must use one layer-level `intersection` per adjacent pair with piece-to-part attribution (never per part pair: 39 s), and must bring B3b under the 3 s B3 budget (worker, skip containment `difference` when only the graph is needed, reuse B1 differences). `test/bench.js support` (G2.7) runs B3 and B3b.
- **S1 → G1.2 (smoothing):** Chaikin ×2 roughly triples vertex counts and B1 on smoothed layers takes 5.3 s; apply RDP before Chaikin and re-run the tolerance loop per loop, not per layer.
- **S1 → G2.8 (feature checks):** offsets are the slowest primitive (−1500 µm on 8 dense layers: 2.7 s); offset only parts whose bbox can be affected, or run in the worker.
- **S1 → R1 fallback:** the lattice backend (c) is exact and byte-identical to (a) on orthogonal input but cannot represent circles or smoothed contours (blocks G1.2, G1.3, G5.1); it remains the documented design in `spikes/S1/geom_lattice.js`, not shipped code.
