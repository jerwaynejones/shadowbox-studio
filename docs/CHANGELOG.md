# Changelog

## Unreleased

Planning only; no change to the application yet.

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
