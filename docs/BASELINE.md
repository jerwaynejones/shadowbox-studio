# Baseline (G0)

This file records the state of Shadowbox Studio at the start of the opaque-layers work
(plan task T0.7). Everything after it is measured against this baseline.

## Frozen upstream revision

- Upstream revision: **`f0552c7`** (v1.1.0, "Init commit" on `feat/opaque-layers`).
- `js/svgout.js` and `js/trace.js` are byte-identical to `f0552c7`. The engine changes
  since then (T0.5 `SBEngine.legacyRun` seam, T0.6 `SBHash`/`SBUtil.stableStringify`) are
  pinned golden-equivalent by `test/golden/oldrun.json`.

## Test suite result

`node test/run_tests.js` at `f0552c7`: **29 passed, 0 failed**.

`node test/run_tests.js` at the end of G0 (T0.7): **70 passed, 0 failed** — the 29 original
checks plus 41 G0 additions.

After the G0 license-gap fix: **71 passed, 0 failed** (adds the dist license-notice check).

| Section | Checks | Origin |
|---|---|---|
| `zip.js` — CRC-32 and archive structure | 4 | original |
| `morph.js` — components, specks, holes | 4 | original |
| `islands.js` — bridge and cull | 7 | original |
| `trace.js` — contours, simplify, smooth | 6 | original |
| `raster.js` — filter and banding invariants | 4 | original |
| `svgout.js` — document sanity | 4 | original |
| docs — architecture contract and component inventory | 6 | T0.1 |
| build — hygiene | 6 | T0.2 (5), G0 license fix (1) |
| fixtures — determinism | 6 | T0.3 |
| baseline — characterization (KNOWN-DEFECT) | 11 | T0.4 |
| `engine.js` — legacyRun seam | 2 | T0.5 |
| `hash.js` — SHA-256 and stable JSON | 10 | T0.6 |
| baseline — legacy sheetSVG/proofSVG goldens | 1 | T0.7 |

Persisted goldens (written once by `test/capture_golden.js`; tests never regenerate them):

| File | Content | Stage |
|---|---|---|
| `test/golden/sheetmasks.json` | `thresholds` + `sheetMasks` hashes, 24 configs | 1 (T0.4) |
| `test/golden/oldrun.json` | v1.1.0 `runPipeline` masks/loops/bridges hashes | 1 (T0.4) |
| `test/golden/legacy_svg.json` | SHA-256 of `SBSvg.sheetSVG` (every sheet) and `SBSvg.proofSVG` output, 3 fixtures | 2 (T0.7) |

The three legacy-SVG fixtures (built by `test/legacy_svg_cases.js`) are:
`borderTouch` (8×5 px, 80 mm, margin 10 mm, holes off), `donutIsland` (9×9 px, 90 mm,
margin 10 mm, registration holes on, Ø3 mm), and the T0.5 40×30 RGBA ramp run through
`SBEngine.legacyRun` with the `oldrun.json` config (120 mm, margin 12 mm, holes on, 5 sheets).
Check: `G0 legacy sheetSVG/proofSVG byte-identical to goldens (3 fixtures)`. These goldens
freeze the legacy shims; checks that later move to `layerSVG`/`assemblySVG` delete their
shim versions rather than editing them.

## KNOWN-DEFECT list

Each defect is pinned by a passing `KNOWN-DEFECT` check in the T0.4 suite. The commit that
fixes it retargets the check to the new function and inverts it.

| Check | Fixture | Observed | Inverted by |
|---|---|---|---|
| `KNOWN-DEFECT EXP-01` | `borderTouch` layer 1, `sheetSVG` | page `<rect>` always emitted in the cut group | G1.4 (`layerSVG`) |
| `KNOWN-DEFECT GEO-02` | `borderTouch` layer 1, 10 mm/px, margin 10 | art edge cut separately from frame: segment `M 10 10 L 10 30` | G1.3 (`SBMaterial`) |
| `KNOWN-DEFECT EXP-02` | `borderTouch` layer 1, `sheetSVG` | cut group has no `id` | G1.4 (`layerSVG`) |
| `KNOWN-DEFECT EXP-03` | `borderTouch` layer 1, `sheetSVG` | label is live `<text>` | G3.2 (vector labels) |
| `KNOWN-DEFECT GEO-01 proof extent` | `proofSVG` of 2 empty layers vs `borderTouch` sheet | proof viewBox excludes the frame margin | G1.6 (`assemblySVG`) |
| `KNOWN-DEFECT GEO-07 (bridge)` | `looseBridge`, `islands.resolve` | bridge material added where layer k−1 is void | G2.6 (`SBConstruct.bonded`) |
| `KNOWN-DEFECT SUP-01` | `looseBridge`, `islands.resolve` | a loose part is bridged instead of reported | G2.6 (`SBConstruct.bonded`/`connected`) |

Characterization that is **not** a defect: the per-layer morphology chain
(`open`/`close`/`removeSpecks`/`fillHoles`) preserves nesting — 0 violations over 200 seeds
(`G0 morphology chain preserves nesting (200 seeds)`).

## Observed frame edge-case topology (GEO-02)

Fixture `borderTouch` (8×5 px, layer 1 = a 5×2 px block in the top-left corner), 80 mm wide
(10 mm/px), margin 10 mm. `sheetSVG` for layer 1 emits:

```
<rect x="0" y="0" width="100" height="70"/>
<path d="M 10 10 L 10 30 L 60 30 L 60 10 Z"/>
```

- The art is traced as one closed ring; its left edge (x = 10, y 10→30) and top edge
  (y = 10, x 10→60) lie exactly on the inner edge of the frame ring.
- The frame's inner boundary is never constructed, so no union with the frame happens: the
  cut line runs along the art/frame contact, and art that touches the image border is cut
  free of the frame. Contact is a zero-width cut line, never a finite-width bond.
- GEO-02 requires frame union (and hole subtraction) before boundary extraction. Per
  Appendix B decision 3, after the fix a finite-width overlap < 0.5 µm blocks export and a
  contact that does not survive `offset(−minFeatureUm/2)` (narrower than the full minimum
  feature width) warns.

## License check

- Upstream `LICENSE` is **MIT**, "Copyright (c) 2026 Shadowbox Studio contributors"
  (SHA-256 `c64fefe12f7c70a7a597f3c1cc9852dbd26c6eda702d16310a1c3da95711a89b`, unchanged
  from `f0552c7`). `README.md` points to it.
- The notice **must be kept in `dist/` and in the fork.** It is kept in the fork (`LICENSE`
  at the repository root).
- **Finding (resolved):** the single-file bundle `dist/shadowbox-studio.html` produced by
  `build.js` originally did **not** carry the MIT copyright and permission notice. Fixed:
  `build.js` now embeds the `LICENSE` text verbatim as a comment immediately after the
  doctype, and the build-hygiene check `build: dist carries the upstream MIT license notice
  verbatim in a leading comment` fails the suite if it is missing (NFR-11).
- No third-party runtime dependencies exist at the baseline; `docs/COMPONENTS.md` holds the
  inventory table (NFR-11).

## Reuse decisions (per module)

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

## Manual preview capture

**Pending (manual step).** Load the demo on `localhost` (the service worker is skipped
there since T0.2), then save one preview PNG and the exported ZIP to `docs/baseline/`.
Record here:

- Browser and version: _to be recorded_
- Preview PNG: `docs/baseline/` _to be added_
- Exported ZIP: `docs/baseline/` _to be added_
