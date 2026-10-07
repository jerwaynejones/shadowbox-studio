# Shadowbox Studio

Turn a photograph into laser-ready files for a **layered acrylic shadowbox** —
the kind where each sheet carries one tonal band, stacked with spacers so the
image reads in physical depth.

The hard part of that craft isn't the posterizing — it's that any piece of
material not connected to the rest of a sheet **falls out on the laser bed**
(the moon in a night sky, a lit window, the counter of a letter "O").
Shadowbox Studio finds every one of those islands and automatically **bridges**
it to the mainland with a corridor of material at your chosen width, or
**culls** it if it's below your size threshold — then shows you every fix it
made, in amber, before you cut anything.

## Quick start

1. Open `index.html` in any modern browser (or the single-file build in
   `dist/`). No server, no build step, works offline.
2. Click **Demo scene** to see the whole pipeline instantly, or **Load photo**.
3. Drag the stack preview to tilt it. Use **Explode** to inspect the layers.
4. Tune layers and fabrication settings (everything physical is in real mm).
5. **Download cut files (.zip)** — one SVG per sheet plus proof, assembly
   guide, preview render, and your settings.

## Install as an app (PWA)

Served over HTTPS, Shadowbox Studio installs to your home screen and runs
offline. Deploy the **repository root** (the multi-file version — the service
worker and manifest must be real files, so the single-file `dist/` bundle is
not itself installable).

- **iPhone / iPad:** open the URL in Safari → Share → **Add to Home Screen**.
- **Android:** open in Chrome → **Install app** (or menu → Add to Home screen).
- **Desktop:** Chrome / Edge show an install icon at the end of the address bar.

**Shipping an update:** bump `APP_VERSION` in `js/app.js` and the matching
`VERSION` in `sw.js` together (both are `1.1.0` as of this release), deploy,
then fully close and reopen the installed app — the new service worker takes
over on the next launch, so it can take two opens. The version in the title
block tells you which build is live.

### Exporting on mobile

On an installed PWA or iOS Safari, **Download cut files** routes the ZIP to the
native **share sheet** — choose **Save to Files** (or AirDrop it to a Mac) to
keep it. On desktop it downloads normally. The status bar under the preview
confirms what happened after every export.

## What the export contains

| File | Purpose |
|------|---------|
| `sheet_01.svg` … `sheet_NN.svg` | One per sheet, back → front. Real mm units. RED 0.1 mm = cut, BLUE = score label. |
| `proof.svg` | All layers stacked and filled in palette colors — the intended look. |
| `ASSEMBLY.md` | Stack order, color map, spacer and dowel guidance. |
| `preview.png` | Snapshot of the tilted 3-D preview. |
| `settings.json` | Every parameter, so a result can be reproduced or shared. |

## The pipeline

```
photo ▶ scale ▶ luminance ▶ Kuwahara cartoon filter ▶ tone thresholds
      ▶ nested sheet masks (sheet k ⊇ sheet k+1)
      ▶ per sheet: min-feature opening ▶ speck/hole cleanup
      ▶ ISLAND RESOLUTION (bridge or cull)          ← the point of the tool
      ▶ contour tracing ▶ simplify ▶ corner smoothing ▶ SVG (mm)
```

Full algorithm write-ups are in [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md);
parameter-by-parameter guidance is in [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

## Project layout

```
index.html          UI shell (title block, process rail, laser-bed viewport)
css/style.css       design system — laser color conventions as UI language
js/util.js          shared helpers
js/raster.js        luminance, SAT-accelerated Kuwahara, threshold banding
js/morph.js         binary morphology, connected components, specks/holes
js/islands.js       island detection + BFS bridging / culling   ★ core
js/trace.js         directed-edge contour tracing, RDP, Chaikin
js/svgout.js        mm-unit SVG export, frame ring, registration holes
js/zip.js           dependency-free ZIP writer (offline-friendly export)
js/preview.js       tilting stacked preview with explode + bridge audit
js/app.js           state, pipeline orchestration, UI wiring, demo scene
test/run_tests.js   algorithm test suite (run it to see the current count) — `node test/run_tests.js`
build.js            single-file build — `node build.js` → dist/
docs/               user guide, algorithm notes, changelog
```

No dependencies, no build step required, no network access needed. The same
files run in the browser and in Node (for tests).

## Fabrication notes

- Import SVGs at **1:1** — they carry real millimetre units.
- Registration holes in the frame corners let the stack self-align on dowels
  or bolts; spacer rings between sheets create the shadowbox depth.
- Kerf: cut a test square and set kerf compensation in your laser software
  (LightBurn etc.) — the geometry here is nominal.

## License

MIT — see `LICENSE`.
