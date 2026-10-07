# Changelog

## Unreleased

- Baseline (G0): upstream `f0552c7` frozen, characterization checks and persisted
  goldens (including the legacy `sheetSVG`/`proofSVG` shims), license check and per-module
  reuse decisions. See [docs/BASELINE.md](BASELINE.md).

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
