# Spike S7 part B: local depth + luminance fusion (8-layer height map)

Code: `../../fusion/fuse.py` (single file, CPU only, deterministic), example rules: `../../fusion/overrides.json`.

```
cd spikes/S7
.venv/bin/python fusion/fuse.py                                   # uses fusion/overrides.json, writes results/fusion/
.venv/bin/python fusion/fuse.py --overrides none --out /some/dir  # auto only (any non-existent path = no overrides)
```

Extra dependencies, installed into `.venv`: `opencv-contrib-python-headless` 5.0 (for `cv2.ximgproc`: guided filter and SLICO) and `scikit-image` 0.26. scikit-image ended up unused.

## Outputs

| file | what |
|---|---|
| `height_8layer.png` | **The deliverable.** 4096x3084, 8-bit single-channel (mode `L`), near = white. Exactly 8 grey values `round(k*255/7)` = 0, 36, 73, 109, 146, 182, 219, 255 for layers k = 0 (back) … 7 (front). Overrides are applied. |
| `height_8layer_auto.png` | The same pipeline without overrides. |
| `height_continuous.png` | 16-bit grayscale, the continuous fused height before quantisation (guided-filter smoothed). Override regions are set to their layer centre. `_auto` is the variant without overrides. |
| `layers_preview.png` | Top: each layer coloured over the image, with black layer boundaries and a legend. Bottom: an oblique "stacked sheets" render where sheet k = (layer ≥ k), drawn back to front with drop shadows. |
| `side_by_side.png` | input / Marigold alone / fusion auto / fusion + overrides. |
| `probe.json` | Part A's probe (`scripts/common.run_probe`) on Marigold alone, fusion auto, fusion + overrides, and continuous. |
| `fusion_meta.json` | All parameters, the detected luminous centre, the k-means band centres, the per-layer pixel fractions, the override report and per-stage timings. |
| `debug_luminous_mask.png`, `debug_bands.png` | The feathered luminous mask, and the band labels inside it (band 0 = yellow … ; outside the mask = green). |

## Pipeline

All sizes are in output pixels (4096x3084, about 0.097 mm/px at 300 mm tall). The 1024-px equivalent is ÷4.

1. **Base depth.** The pipeline uses Marigold v1-1 768/ensemble 5 nearness from `results/marigold11_r768_e5_s4/`. It loads `nearness_1024.npy` if present, then `raw.npy` (converted with part A's `to_nearness`), then `height.png`. The base is bicubic-upsampled to 4096 and then put through a **guided filter** (r = 16, eps = 1e-3), using the Real-ESRGAN colour upscale as the guide. This snaps depth edges to colour edges.
2. **Luminous region.** The test runs on CIE Lab with a Gaussian σ = 16:
   - `warm = ramp(b*, 10→40) · ramp(L*, 30→55)`
   - `far = ramp(nearness, 0.22→0.12)`, which rewards Marigold's own "far, featureless funnel"
   - `score = warm · far`
   - The mask is `smoothstep(blur(score, σ 8), 0.35, 0.65)`, which gives a feathered edge about 30 px wide.

   The dark cross, the dark red rim around the swirl circle, and the foliage all fall outside the mask. The clouds are mostly outside it too, because Marigold puts them at a nearness of about 0.25.
3. **Ring banding.** Features are computed by normalised convolution, σ = 16. Pixels with b* < 25 (dark or neutral paper, such as the cross) are excluded so they don't drag the disc's brightness down. The features are:
   - L*, a*, b*
   - local L* standard deviation (a texture cue: the swirl is more textured than the rays)
   - distance from the luminous centre, which is the median position of the brightest 3 % of the mask (found automatically at (1984, 1368), about 4x(496, 342))

   The features are z-scored and weighted (1.5, 1, 1, 1.5, 1). k-means runs with K = 3 on 250 k sampled mask pixels (cv2, seed 0, k-means++ with 8 attempts). Clusters are ranked by L*, **brightest = deepest**. Every pixel is assigned, then the labels are majority-smoothed (one-hot blur σ 12, then argmax). Band centres found (L*, a*, b*, sd, radius px):
   - disc: 87 / 2 / 52 / 12 / 162
   - swirl: 67 / 30 / 54 / 20 / 418
   - rays: 62 / 41 / 60 / 11 / 765
4. **Compose.**
   - Outside the mask, the base is remapped to the front layers [3/8, 1]. The remap is 50 % histogram-equalised (quantiles over the non-luminous pixels) and 50 % linear (p1–p99), so the 5 front layers are used evenly and relative depth is still kept.
   - Inside the mask, each band gets a fixed terrace: band k goes to the centre of layer k (disc 0, swirl 1, rays 2).
   - `h = (1−w)·front + w·terrace`, then a light guided filter (r = 8).

   Everything non-luminous, including the cross, therefore sits in front of all glow terraces by construction. The feathered transition produces one or two intermediate steps at the glow's edge, which read as rims.
5. **Snap and clean.**
   - SLICO superpixels on the upscale (region 24 px, about 2.3 mm, 5 iterations, about 20.7 k superpixels).
   - `floor(h·8)` gives the layer, and each superpixel takes its majority layer, so ring edges and the cross follow colour edges.
   - Speck removal: any 4-connected component of any layer smaller than **225 px** (15×15 px, about 1.5 mm at 0.1 mm/px) is refilled from the nearest surviving label (EDT), repeated up to 3 times.
6. **Overrides** (JSON, below) are applied last to the layer map; the continuous map gets the layer centre in those regions.
7. **Export.**
   - Layer k is written as `round(k·255/7)`. The app's height mode quantises with `floor(7·s/255 + 0.5)` (`js/height.js addedFromSamples`), so each grey maps back to exactly layer k.
   - The continuous map is written as 16-bit.

## Overrides format (`fusion/overrides.json`)

```json
{
  "version": 1,
  "coords": "input",
  "rules": [
    { "name": "push the bright disc to the back",
      "select": {"seed": [455, 330], "tolerance": 22,
                 "within": {"circle": {"center": [492, 356], "radius": 58}}},
      "layer": 0, "snap_superpixels": true },
    { "name": "pin the cross to layer 6",
      "select": {"seed": [492, 410], "tolerance": 18, "grow_px": 3,
                 "within": {"rect": [440, 316, 540, 452]}},
      "layer": 6 }
  ]
}
```

- `coords`: `"input"` means coordinates are in the 1024x771 source image and are scaled by 4 automatically. `"output"` means 4096x3084 pixels.
- `rules` are applied in order, and later rules win.
- `select` takes exactly one of the following:
  - `{"polygon": [[x,y], …]}`
  - `{"circle": {"center": [x,y], "radius": r}}`
  - `{"rect": [x0,y0,x1,y1]}`
  - `{"seed": [x,y], "tolerance": ΔE, "within": <polygon|circle|rect>, "fill_holes": true, "grow_px": 0}`. This is a colour-click flood: the 8-connected region around the seed whose Lab colour (σ 2 smoothed upscale) is within ΔE of the seed's colour, limited to `within`. Holes are filled, and the region is optionally dilated by `grow_px` output px.
- `exclude` (optional) is a list of selectors to subtract.
- `snap_superpixels` (optional) expands or shrinks the selection to whole superpixels that are at least 50 % covered.
- Action: `"layer": k` pins the region to layer k, or `"offset": ±n` moves it ±n layers. Results are clamped to 0..7.
- The run's report (pixels selected and changed, layer histogram before) is in `fusion_meta.json → overrides`.

  In this run the disc rule changed 12.8 k of 89.8 k px; auto had already placed 86 % of the disc on layer 0. The cross rule moved 54.9 k px from layers 0–3 (mostly 3) to layer 6.

## Probe results

These are part A's metrics, run on the result downsampled to 1024x771, with layers as k/7.

| map | cross separated (Δ vs disc, d, Δ local ring) | ring levels strict/weak | region levels | disc→swirl→rays means | disc-edge jump | swirl-outer-edge jump |
|---|---|---|---|---|---|---|
| Marigold 768/e5 alone | yes (0.130, 10.3, 0.099) | 1/1 | 3 | 0.007 → 0.038 → 0.122 (smooth funnel) | +0.011 | +0.013 |
| **fusion auto, 8 layers** | yes (0.351, 5.2, 0.281) | **2/3** | 3 | 0.024 → 0.160 → 0.319 | **+0.143 (sharp)** | **+0.143** (flagged weak, see below) |
| **fusion + overrides** | yes (0.850, 44.3, 0.726) | **2/3** | 3 | 0.006 → 0.160 → 0.319 | +0.143 (sharp) | +0.143 (weak) |
| fusion continuous | yes (0.745, 50.4, 0.644) | 2/2 | 3 | 0.067 → 0.203 → 0.344 | +0.125 (sharp) | +0.062 |

Layer histograms per probe region (fusion auto; counts at 1024 px; layers 0–7):

| region | layer counts |
|---|---|
| disc | 4720 / 925 / 33 / 0 … |
| swirl | 0 / 34505 / 4866 / 50 … |
| rays | 0 / 69 / 16964 / 4170 / 601 … |
| cross | 1 / 173 / 841 / 2141 … (layer 3, in front of all three glow terraces) |

So disc, swirl ring and rays land on **3 distinct layers** (0, 1, 2), each with a full one-layer step (1/7 = 0.143) at the disc edge and at the outer swirl edge. Part A had 0.01 smooth slopes there.

The probe's strict "sharp" flag misses the outer swirl edge, even though its jump of 0.143 is a full layer. The test's flank window (r+10…r+30) also contains the next step: the dark red rim and the rays ring sit 1–2 layers forward. That raises the residual above the 3× threshold, so this is a limitation of the probe heuristic rather than a missing step (see `layers_preview.png`).

The auto cross is "separated" with d = 5.2. The value is lower than Marigold's 10.3 only because the absolute steps are now much larger: the auto cross spans layers 2–3 against the disc on 0. With the override it sits alone on layer 6.

Determinism: two runs produced byte-identical `height_8layer.png` and `height_8layer_auto.png`, md5 `7a9ead18…` and `3d5992f7…`.

## Runtime

Total about 49 s wall, CPU only, under `nice` with 4 cv2/OMP threads, on 16 cores shared with another workload. Peak RSS is a few GB, because the 4096x3084 float maps are about 50 MB each. Marigold itself is not re-run; it took 7.4 s on the GPU in part A.

| stage | time |
|---|---|
| load | 1.2 s |
| guided upsample | 0.9 s |
| features + mask | 3.5 s |
| k-means + assignment | 8.9 s |
| compose + guided filter | 2.7 s |
| SLICO | 10.1 s |
| quantise / snap / specks | 0.8 s |
| overrides | 0.8 s |
| writing PNGs | 10.6 s (16-bit continuous PNGs dominate) |
| previews | 3.9 s |
| probe ×4 | 5.6 s |

A production version could do the analysis at 2048 and only the snapping at full resolution, roughly halving this time.

## Loading into the ShadowBox app

1. **1 Source**: load `spikes/S7/results/fusion/height_8layer.png`. It is a single-channel grayscale PNG, so it is accepted as a height map.
2. **2 Interpretation**:
   - **Read the image as** → **Height map**
   - **Polarity** → **White is high** (white = front / nearest sheet)
   - **Sheets** → **8**

   Tone split, thresholds and smoothing are disabled in height mode. The app uses nearest-layer quantisation, `floor(7·s/255+0.5)`, which maps the 8 grey values exactly back to layers 0–7.
3. **3 Construction**:
   - **Construction** → **Bonded relief (glued)**
   - Size by **Height**, **Finished size** e.g. **300** mm. This includes the frame ring, so set **Frame ring** to taste; the image already contains a painted frame, which is on layer 7.
   - **Fabrication pitch** → **0.1** mm/px. At 300 mm the 3084 px source is about 0.097 mm/px, so the source is slightly finer than the pitch and nothing is upscaled.
   - **Machine → Laser profile** → **xTool S1 + feeder**
   - Keep Min feature at or above 1.5 mm, which is consistent with the 225 px speck removal used here.
4. The layer-0 base sheet is the back (the disc). The cross is on the sheet just below the front frame sheet.

If you want the auto result instead, load `height_8layer_auto.png` with the same settings.

## Limitations

- **Tuned on one image.** The thresholds (b* 10–40, L* 30–55, nearness 0.12–0.22, K = 3) and the radial feature assume a single, roughly radial, warm backlit glow. That suits sunbursts, but it is a prior. Cool-toned light (moonlight, blue windows) would need a hue-agnostic "bright and Marigold-far" score. Several separate light sources would need per-component centres. K should probably be chosen per image, for example by silhouette score, or exposed as "glow rings: 2–5".
- **BRIGHTER = DEEPER is applied only inside the glow mask.** Outside it, ordering is purely Marigold, so the foliage and clouds inherit Marigold's soft, blobby layering (`layers_preview` shows wobbly foliage boundaries spanning layers 5–6). Marigold puts the clouds at the same layer as the red glow behind the leaves (layer 3).
- **The swirl/ray split is approximate.** About 12 % of the swirl lands on the ray layer near its outer edge, and about 19 % of the rays are one layer forward (layer 3) at the glow boundary because of the feathering. The probe-region histograms above show both.
- **Superpixel snapping limits edge accuracy** to about a superpixel (24 px, about 2.3 mm) where the colour edge is weak. Boundaries look slightly "beaded" (see the black outlines in `layers_preview`). Fine features under about 1.5 mm are deliberately removed. Thin slivers wider than that but very long are kept.
- **No physical plausibility checks.** Floating islands and unsupported regions are left to the app's construction stage, as bonded relief needs no bridges.
- **Overrides are coordinate-based.** They are tied to this image's geometry; colour-seed tolerance needs tuning per click. A UI would replace the JSON with click-to-select plus a layer picker.
- **Licences.** Marigold v1-1 is OpenRAIL++-M, and its use restrictions pass through to this output. Real-ESRGAN weights carry the caveat from part A.
