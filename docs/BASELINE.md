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
| `KNOWN-DEFECT EXP-01` | `borderTouch` layer 1, `sheetSVG` | page `<rect>` always emitted in the cut group | G1.4 (`layerSVG`) — **fixed**: `SBSvg.layerSVG` emits no `<rect>`, shared page viewBox; shim check deleted |
| `KNOWN-DEFECT GEO-02` | `borderTouch` layer 1, 10 mm/px, margin 10 | art edge cut separately from frame: segment `M 10 10 L 10 30` | G1.3 (`SBMaterial`) — **fixed**: `SBMaterial.applyFrame`; shim check deleted |
| `KNOWN-DEFECT EXP-02` | `borderTouch` layer 1, `sheetSVG` | cut group has no `id` | G1.4 (`layerSVG`) — **fixed**: `SBSvg.layerSVG` groups `id="CUT"` `#FF0000` / `id="SCORE"` `#0000FF`, no fill on cuts; shim check deleted |
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

## Preview capture (T0.7 Step 2)

**Done, automated** (no manual browser session needed). Captured on 2026-10-07 at the
working tree of `9a883f3` (app `v1.1.0`) by `node tools/capture_baseline.mjs`.

- Browser and version: **Chromium 152.0.7977.82 (Arch Linux)**, headless (`--headless=new`),
  DevTools product `Chrome/152.0.7977.82`, V8 `15.2.124.21`, user agent
  `HeadlessChrome/152.0.0.0` on X11 Linux x86_64. Viewport 1440×900, device scale factor 1.
  Full record: `docs/baseline/browser.json`. (Firefox 155.0.1 is also installed; not used.)
- Host: `http://127.0.0.1:<random port>/index.html` served by `python3 -m http.server`
  from the repo root. Service-worker registrations after load: **0** (the T0.2 local-host
  skip works). Page exceptions: none.
- Scene: the built-in demo the app opens on (`night-over-the-valley`, default settings —
  see `docs/baseline/export/settings.json`). Status line after the pipeline:
  `720×544px · 5 sheets · 0 bridged · 5 culled · 7.94 m of cuts` (timing omitted).

Steps the script performs (`node tools/capture_baseline.mjs [--out <dir>] [chromium-binary]`;
without `--out` it writes over the committed `docs/baseline/`):

1. Serve the repo on `127.0.0.1` (`python3 -m http.server`, ready once it prints its
   `Serving HTTP` line; retried on another random port if it fails to bind); launch
   `chromium --headless=new --remote-debugging-port=0` with a throw-away profile and drive it
   over the DevTools protocol (Node's built-in `WebSocket`, no npm packages).
2. Navigate to `index.html`; wait (at most 60 s) until `#statusline` stops ending in `…`;
   wait 1.5 s.
3. Save the `#stackcanvas` pixels (`canvas.toBlob("image/png")`, same call as the app's
   `preview.snapshot()`) as `preview_stack.png`, and a viewport screenshot as
   `app_screenshot.png`.
4. Click `#btn-export` ("Download cut files (.zip)") and capture the browser download
   (`Browser.setDownloadBehavior`).
5. Unpack the ZIP into `export/` with `unzip`, and delete `export/preview.png` when it is
   byte-identical to `preview_stack.png` (it is: the app's export embeds the same
   `preview.snapshot()` PNG), so the 176,686-byte PNG is stored once outside the ZIP.

The script exits non-zero and writes nothing if the pipeline does not finish, the status
line (timing removed) is not `720×544px · 5 sheets · 0 bridged · 5 culled · 7.94 m of cuts`,
any page exception is thrown, or a service worker is registered on the local host.

The committed artifacts come from the first run (at `9a883f3`). Steps 1 to 4 were done by
the script; the unpacking was done by hand with `unzip -d export`, before the script gained
step 5. `export/preview.png` was then removed as a duplicate, as step 5 now does.
`browser.json` is from that run, so it has no `exportPreviewIdenticalToPreviewStack` field.

Scope: plan Step 2 asks only for one preview PNG, the exported ZIP, and the browser and
version (`browser.json`). The screenshot (whole-app context) and the unpacked `export/`
tree (so the SVGs can be diffed and hashed without unzipping) are extras kept on purpose.
Together they add about 0.5 MB.

Artifacts (`docs/baseline/`):

| File | SHA-256 |
|---|---|
| `preview_stack.png` (= `preview.png` inside the ZIP) | `39e2eadfc4b612ce271ef908eeaaecbd4c1e5e89e13317e71522a963e1e4a655` |
| `app_screenshot.png` | `c4d3c839f23746b01f5f56eafc20370b6039c2760e82832bd3f4a25a72b15608` |
| `night-over-the-valley_shadowbox.zip` | `39de248f8418111632105add46648b3ea64071e9af35a06d81e1fdff24c07cd9` |
| `export/sheet_01.svg` | `26389cd5533585defcfc44824dff929c9ba0d74425d65f433a7c90b2786b6279` |
| `export/sheet_02.svg` | `36af244259815a49272deeac47762d064d639c694d8735b7051c88adf710cf4c` |
| `export/sheet_03.svg` | `d6c417cc7c6e54dce9f4e037bcb0a7c36ce249993631c7aeeb4ae322b54a17fd` |
| `export/sheet_04.svg` | `93218c5bac095a010984d558ba8ce6668d2b9890e8f488766c32588613eba10c` |
| `export/sheet_05.svg` | `94dd0c6624d9e5909ad7f0ad24ecd1b8bef2da611db7d3ee8cecc76226ca28ea` |
| `export/proof.svg` | `aa6be2fe62f107193f4e5b0a6906fb3ed747ed910da8a4ce30b837397dbff8d9` |
| `export/ASSEMBLY.md` | `911df0eda33fa51cd90e6f716f1fde308c0e92723b5e561dccf97045001a7e95` |
| `export/settings.json` | `301d52f0f83d1417e6daa12b966674a51d43ad7d639b974c75ece8ff187177e8` |

Reproducibility: a second run (`--out` to a scratch directory) produced a byte-identical
`preview_stack.png` and byte-identical extracted files. These are the only reproducible
artifacts. The ZIP container differs on every run (entry modification timestamps).
`app_screenshot.png` differs as well, even between runs on the same day: it shows the date in
the title block and the pipeline timing in the status bar (`… 7.94 m of cuts · 883 ms` in
the committed shot; 951 ms and 981 ms on later runs). These are visual/reference baselines, not test
goldens; the hashed regression goldens remain `test/golden/*.json`.
