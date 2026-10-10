# Spike S7 fusion round 2: V2 + v1-1 base, colour-shaped foreground, cuttable sheets, engrave layers

Code:
- `../../fusion2/fuse2.py`: the pipeline. It is CPU only and deterministic. It imports part B's `fusion/fuse.py` and part A's `scripts/common.py` read-only.
- `../../fusion2/modal_mv2.py`: the Modal driver. It reuses the functions in `scripts/modal_app.py` unchanged.
- `../../fusion2/overrides.json`: overrides in part B's format.
- `../../fusion2/cutclean2.py` + `../../fusion2/finalize_v2.py`: cut-clean v2 and its verification. Run `.venv/bin/python fusion2/cutclean2.py && .venv/bin/python fusion2/finalize_v2.py` after `fuse2.py`.

```
cd spikes/S7
.venv/bin/python fusion2/modal_mv2.py download mv2   # optional: re-creates results/fusion2/mv2/ (needs Modal; ~$0.15)
.venv/bin/python fusion2/fuse2.py                    # writes results/fusion2/ (about 105 s, 4 threads)
.venv/bin/python fusion2/fuse2.py --overrides none   # auto only
```

If `results/fusion2/mv2/` is missing, `fuse2.py` falls back to part C's `results/cloud/mv2_log_r2048/raw.npy`.

## Outputs

| file | what |
|---|---|
| `height_8layer_v2.png` | **The deliverable (cut-clean v2, see below).** Same format: exactly **3985x3000**, 8-bit `L`, 8 greys `round(k*255/7)`, near = white, cross pin applied. Every cumulative sheet has no material neck and no gap narrower than 1.5 mm, including diagonal joins; 4- and 8-connectivity agree; no islands or holes under 10 mm²; nested. |
| `cutclean_v2_report.json` | Verification report for v1 (before) and v2 (after): per sheet, the neck/gap spots < 1.5 mm and < 0.5 mm from the core-Voronoi detector, the medial-axis cross-check, min neck widths, 4/8-connectivity, islands, holes and parts. |
| `debug_neck_spots_before_after.png` | v1 vs v2 at the three reported piece-breaking spots (rows S06, S07, S08). |
| `height_8layer.png` | **Superseded (v1).** It contains sub-kerf diagonal necks; see "Cut-clean v2". Exactly **3985x3000**, 8-bit mode `L`, near = white. It holds exactly the 8 grey values `round(k*255/7)` = 0, 36, 73, 109, 146, 182, 219, 255. Cross pin applied; v1 cleanup only (opening residue). |
| `height_8layer_auto.png` | v1 without overrides (v1 cleanup, not re-cleaned). |
| `height_8layer_precut.png` | The same map with overrides but before the cuttability cleanup, for comparison. |
| `engrave/engrave_layer{k}.png` | **Regenerated on v2.** Per layer: a 3985x3000 `L` raster, **black = engrave**. It covers only the uncovered surface of layer k (`layer == k`), kept at least 1 mm inside the cut edges. |
| `engrave/engrave_layer{k}.svg` | The same layer as vector centre-line strokes. Units are 0.1 mm (viewBox 3985x3000, 398.5 x 300 mm) with a 0.3 mm stroke. |
| `layers_preview.png` | Layer colours with boundaries (top) and an oblique stacked-sheet render (bottom). |
| `side_by_side.png` | input / part B fusion / round 2. |
| `detail_crops.png` | Full-resolution crops (lilies, top-right flower, cross/swirl). Columns: colour / part B / round 2 / round 2 + engrave (red). |
| `engrave_preview.png` | All engrave lines (black) over the layer colours. |
| `debug_colour_classes.png` | Foreground classes: petal (pale), leaf (blue), dark gap (near black), other (grey). |
| `debug_bases_v2_v11_weight_fused.png` | The V2 base (rank), the v1-1 base (rank), the v1-1 weight, and the fused base. |
| `fusion2_meta.json` | Parameters, sources, the per-sheet report before and after cleanup, colour-layer stats, the override report, engrave stats, timings and probes. |
| `probe.json` | Part A's probe on the V2 base, the fused base, round 2 auto, round 2 with overrides, and `round2_v2_cutclean2`. The `layers_preview`, `side_by_side`, `detail_crops` and `engrave_preview` images now show v2. |
| `mv2/` | The Marigold V2 runs from this round: `raw.npy`, `height.png`, `meta.json` with probe, and `runs.json`. |
| `billing_before.txt`, `billing_after.txt` | `modal billing summary` before and after. |

## Pipeline (grid = 3985x3000 px, 0.1 mm/px)

1. **Colour.** The Real-ESRGAN x4 image (4096x3084) is resampled with INTER_AREA to the 3985x3000 grid, once. Everything else, including the output, is computed natively on this grid, so the app does not need to resample.
2. **Base depths.**
   - **V2:** Marigold V2 Log-stage2 at 2048x1542, run on the **original** input. It is the mean of the plain pass and a horizontal-flip pass (TTA), using nearness = −log-depth (part A's `to_nearness`). It is then cubic-upsampled and guided-filtered on the colour (r 8, eps 1e-4).
   - **v1-1:** Marigold v1-1 768/e5 from part A's `nearness_1024.npy`. It is cubic-upsampled and guided-filtered (r 16, eps 1e-3, as in part B).
   - **Fusion.** Each base is rank-equalised to [0,1]. The v1-1 weight is `c = max(glow mask, centre disc)`:
     - The centre disc has radius 200 input px (778 grid px) around the detected luminous centre (1929, 1331), with a ±25 input px feather.
     - `fused = (1−c)·V2 + c·v1-1`.
   - The result is that V2 sets the ordering of the foliage, hills, clouds and frame, and v1-1 sets the cross, the centre and everything in the glow.
3. **Glow banding (part B, unchanged).**
   - The Lab warm × bright score is multiplied by "far in **v1-1**" to give the luminous mask.
   - k-means (K = 3) runs on L, a, b, local std and radius.
   - Bands are ranked with **brighter = deeper**: the disc goes to layer 0, the swirl to 1 and the rays to 2.
4. **Compose (part B).** Outside the glow, the fused base is remapped onto layers 3..7 (50 % equalised, 50 % linear). Inside, each band is a terrace, with a feathered blend between the two. Everything outside the glow, including the cross, therefore stays in front of the terraces.
5. **Foreground from colour.**
   - **Classes.** These run on the upscale Lab after a 9 px closing on L*, which removes dark veins and curl lines:
     - blue = `b* < −4 & a* < 10`;
     - **petal** = blue & `L* > 23.5` & `a* < 2.5` (pale grey-blue paper; measured L 24–33, chroma 8–14, a* ≈ 0);
     - **dark gap** = blue & `L* < 8.5`;
     - **leaf** = the rest of blue (saturated navy, L 10–22).
     - The class map is then majority-smoothed (σ 3).
   - **Petals.** Petal pixels outside the glow are opened (7 px), and connected components of 1500 px or more are kept. Each component becomes **one flat shape**:
     - If its mean V2 nearness is ≥ that of the leaf ring around it (25 px wide) minus 0.02, meaning "depth agrees it is in front", it goes on **(median leaf-ring layer + 1)**.
     - Otherwise it keeps its median layer.
     - Result: 12 components, all 12 raised; 0.49 MP.
   - **Dark gaps.** Components of 400 px or more go to `max(ring layer − 1, 3)`, but only where V2 agrees they are no nearer than their surroundings. Result: 195 of 197 moved.
6. **Finer outlines.** This replaces part B's 24 px SLIC majority.
   - SLICO at region **10 px** (≈1 mm; 114,873 superpixels) with a per-superpixel majority.
   - Then a pixel-level **edge-aware label refinement**: each layer's one-hot mask is guided-filtered on the colour (r 6, eps 1e-3), and each pixel takes the argmax. Boundaries snap to the colour edges at pixel resolution and lose the SLIC beading.
7. **Overrides.** Part B's JSON format and its `fuse.apply_overrides` are used unchanged. `"coords": "input"` coordinates are scaled by 3985/1024. `fusion2/overrides.json` contains only the cross pin (seed (492, 410), tolerance 18, grow 3 → **layer 6**). It changed 52,046 px, which had been on layers 1–3.
8. **Cuttability (¼" ply, 0.1 mm/px).**
   - For k = 1..7, sheet `S_k = layer ≥ k` is processed back to front, at most 3 times, until it stops changing:
     - `X = close(X, disc 15) ∩ S_{k−1}`
     - `X = open(X, disc 15)`
     - drop 8-connected islands < 1000 px (10 mm²)
     - fill 4-connected holes < 1000 px
     - `∩ S_{k−1}`
   - Final layer = Σ_k S_k. Intersecting with the previous sheet guarantees **bonded nesting** (S_k ⊆ S_{k−1}, verified true). The 15 px disc is 1.5 mm.
   - This runs twice (with and without overrides) and takes about 39 s.
9. **Export and engrave.**
   - The height map is written as `round(k·255/7)`.
   - Engrave:
     - Texture = black-hat of L* (21 px disc, σ 0.8). This picks out dark lines up to about 2 mm wide: swirl gaps, leaf and petal veins, hill hatching and cloud scallops.
     - Per layer, the threshold is `max(7, 78th percentile within that layer's visible area)`.
     - The mask is restricted to `layer == k` eroded by 10 px, and fragments < 80 px are dropped.
     - The SVG comes from skeleton tracing: endpoint/junction walk, then `approxPolyDP` at 1 px, keeping only strokes ≥ 20 px long.

## Results

### Probe (part A's `run_probe`, downsampled to 1024x771, layer/7)

| map | cross separated (Δ vs disc, d, Δ local ring) | ring levels strict/weak | region levels | disc-edge jump | swirl-outer jump |
|---|---|---|---|---|---|
| part B fusion auto | yes (0.351, 5.2, 0.281) | 2/3 | 3 | +0.143 sharp | +0.143 weak |
| part B fusion + overrides | yes (0.850, 44.3, 0.726) | 2/3 | 3 | +0.143 | +0.143 |
| V2 base alone (2048, orig + hflip TTA) | yes (0.122, 7.0, 0.101) | **3/3** | 3 | +0.066 sharp | +0.058 sharp |
| fused base (V2 + v1-1) | yes (0.109, 7.5, 0.072) | 1/2 | 3 | +0.010 | +0.013 |
| **round 2 auto** | yes (0.368, 5.3, 0.310) | **2/3** | 3 | +0.143 sharp | +0.143 weak |
| **round 2 + overrides** | yes (0.827, 20.7, 0.712) | **2/3** | 3 | +0.143 sharp | +0.143 weak |

- **Glow terraces are unchanged from part B.** Disc/swirl/rays sit on layers 0/1/2, with full one-layer steps at both edges. The probe flags the outer swirl edge as "weak" for the same flank-window reason documented in part B.
- **Cross effect size.** It is lower than part B's (20.7 vs 44.3). The pin is the same, but the finer edges now leave a little more within-region variance in the probe's 1024 cross mask. Specifically, 9 px of the probe's cross mask lie on layer 1 at the arm tips. Δ = 0.83 is the same as part B.
- **Region histograms (1024 px):**
  - cross: 3147 px on layer 6
  - disc: 4526 / 1147 on layers 0 / 1
  - swirl: 34,292 / 5,047 on layers 1 / 2
  - rays: 16,711 / 4,502 on layers 2 / 3
  - **foliage: layers 4–7 only** (7.1 k / 43 k / 99 k / 85 k). In part B it was on 5–6 with blob boundaries.
- **Layer pixel fractions, layers 0–7:** 0.006, 0.068, 0.046, 0.159, 0.193, 0.165, 0.172, 0.191.

**Marigold V2 stability, which part C left open.** On the original input, the new runs give:

| run | cross d | ring levels |
|---|---|---|
| 2048 | 4.07 | 3/3 |
| 2048 hflip | 4.78 | 3/3 |
| 1792 | 4.65 | 3/3 |

The 2048 run reproduces part C's `mv2_log_r2048`: correlation 0.99994, with 4-bit NF4 noise at a few pixels. So on the original input V2 is consistent across flip and scale (1792–2048). Part C's flip was specific to the ESRGAN input.

V2's ring steps are still only about 0.06 of global height and become per-curl relief rather than plateaus. For that reason the terraces still come from the colour bands, and the glow/centre uses v1-1, which keeps part B's tested behaviour.

### Sheets after v1 cuttability cleanup (with overrides; S_k = layer ≥ k). Superseded: see "Cut-clean v2"

| sheet | parts | islands < 10 mm² | smallest part | holes (smallest) | thin px < 1.5 mm (opening residue) | narrow-gap px < 1.5 mm | narrowest part (max inscribed width) |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 118,851 mm² | 1 (699 mm², the disc) | 0 | 0 | — |
| 2 | 1 | 0 | 110,713 mm² | 2 (39 mm²) | 0 | 0 | — |
| 3 | 1 | 0 | 105,227 mm² | 2 (18 mm²) | 0 | 0 | — |
| 4 | 3 | 0 | 143.6 mm² | 19 (10.6 mm²) | 0 | 143 | 6.1 mm |
| 5 | 11 | 0 | 12.0 mm² | 49 (10.8 mm²) | 0 | 862 | 3.3 mm |
| 6 | 16 | 0 | 11.5 mm² | 57 (10.8 mm²) | 0 | 604 | 2.0 mm |
| 7 | 21 | 0 | 10.9 mm² | 13 (10.6 mm²) | 0 | 181 | 2.8 mm |

**Before cleanup**, sheets 4–7 had:

| sheet | parts | islands < 10 mm² | smallest part | thin px | narrow-gap px |
|---|---|---|---|---|---|
| 4 | 4 | 1 | 1.8 mm² | 1,811 | 4,506 |
| 5 | 22 | 13 | 0.3 mm² | 10,616 | 18,319 |
| 6 | 29 | 14 | 0.2 mm² | 10,145 | 14,170 |
| 7 | 23 | 3 | 0.1 mm² | 3,928 | 3,540 |

After cleanup:
- Every positive feature passes a 1.5 mm disc opening (0 residue).
- Every part is at least 10 mm².
- Nesting holds.

A few hundred pixels per sheet remain where two cleaned shapes approach to within 1.5 mm. These are narrow slots or notches between parts; opening and closing are dual, so they can't both be idempotent at once. The app's Min feature check sees them as ≤ 1.5 mm gaps. They are tiny: 0.02 % of a sheet at most.

### Engrave (per visible layer)

| layer | content | engrave px | % of visible | SVG strokes |
|---|---|---|---|---|
| 0 | disc (flat bright paper) | 0 | 0 | 0 |
| 1 | swirl curls | 153,524 | 18.9 | 497 |
| 2 | rays | 93,985 | 17.1 | 118 |
| 3 | clouds and red ground: scallops, hatching | 339,964 | 17.9 | 544 |
| 4 | hills, back foliage | 132,180 | 5.7 | 262 |
| 5 | leaves: veins | 116,676 | 5.9 | 385 |
| 6 | leaves and cross | 263,441 | 12.8 | 1,019 |
| 7 | petals (veins), frame | 245,975 | 10.8 | 1,000 |

The PNG rasters are complete. The SVGs keep only centre-lines of 2 mm or longer, so the short swirl fragments are in the raster but not in the vector file. Treat the SVG as a prototype.

## Cut-clean v2 (`fusion2/cutclean2.py`, `fusion2/finalize_v2.py`)

### Why v1 failed
A pre-cut check of the app export from v1 found sub-kerf necks 0.10–0.45 mm wide on sheets S06–S08, three of which broke off a piece. The cause is that v1 verified only the opening residue. An opening with a 15 px disc returns a union of discs. Two discs that barely overlap, or that touch diagonally at a single pixel, leave a waist of any width, and the same is true of gaps. The app's bonded mode is unsmoothed (D1), so the height map itself must be cut-clean.

### Detector
Applied to material `S_k = layer ≥ k` and, identically, to its complement for gaps. The image border is edge-padded.
- **Cores** = `erode(X, disc 15)`, labelled with 8-connectivity: every place a 1.5 mm disc fits.
- **Necks.** Every X pixel on the Voronoi boundary between *different* cores counts, including across diagonal neighbours. The reasoning: if two thick parts were joined by a passage at least 15 px wide, the disc could slide through it and their cores would be one component. So every such boundary inside X is a neck narrower than 1.5 mm.
- **Thin** = X pixels more than 7 px from every core (tails and strips).
- **Width** per spot = `2·max(distance to background) − 1`.
- **Cross-check:** the skimage medial axis. A thin skeleton run counts as a neck if it touches thicker skeleton at two or more places; free-ended corner spurs are pruned first, so the minimum is the waist. Min neck widths are reported up to 4 mm.
- **Connectivity:** component counts of X and ~X with 4- and with 8-connectivity must agree, which means no diagonal-only contacts.

### Cleanup
Per sheet, back to front, with `X ⊆ S_{k−1}` at every step, repeated until the sheet is stable and no spots are found (2–4 iterations):
1. close/open with a **17 px** disc. The 2 px margin is needed because a discrete 15 px ellipse fits through diagonal passages that are only about 1.4 mm wide in Euclidean terms. The first try at 15 px left two 1.38 mm diagonal spots that the medial check caught.
2. **Material necks:** per spot, either bridge (add `dilate(spot, 17) ∩ S_{k−1}`) or cut (remove `dilate(spot, 17) ∩ X`), whichever changes fewer pixels. A bridge is used only if it fits inside the previous sheet.
3. **Gap necks:** per spot, either fill (only inside `S_{k−1}`) or widen.
4. **Diagonal-only 2x2 checkerboards:** fill the missing pixel (inside `S_{k−1}`), otherwise remove the pixel.
5. Remove islands under 1000 px and fill holes under 1000 px (8-connected, consistent with step 4).

Input is `height_8layer_precut.png`, with the cross pin applied. The output changes 70,284 px (0.59 %) relative to v1. The cleanup takes 6 min CPU under nice with 4 threads, about half of it verification, which runs on both v1 and v2 with the medial axis included.

### Before (v1 `height_8layer.png`) → after (v2 `height_8layer_v2.png`)
Sheet names follow the app: S01 is the base (layer ≥ 0, a full sheet), and S0(k+1) = layer ≥ k.
- **Spot columns** are counts under 1.5 mm / under 0.5 mm from the core detector. The medial-axis check agrees: on v2 it also finds 0.
- **Min neck columns** are material / gap in mm, from the medial axis, considering passages up to 4 mm. "—" means none narrower than 4 mm.

| sheet | v1 material spots | v1 gap spots | v1 min neck | v1 4=8 conn | v2 material spots | v2 gap spots | v2 min neck | v2 4=8 conn | v2 parts | v2 islands/holes < 10 mm² | v2 smallest part mm² |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S02 | 0 / 0 | 0 / 0 | — / 2.86 | yes | 0 / 0 | 0 / 0 | — / 2.86 | yes | 1 | 0/0 | 118,851 |
| S03 | 0 / 0 | 0 / 0 | — / — | yes | 0 / 0 | 0 / 0 | — / — | yes | 1 | 0/0 | 110,713 |
| S04 | 0 / 0 | 0 / 0 | 2.95 / 3.88 | yes | 0 / 0 | 0 / 0 | 2.4 / 3.4 | yes | 1 | 0/0 | 105,228 |
| S05 | 1 / 0 | 8 / 4 | 0.45 / 1.6 | yes | 0 / 0 | 0 / 0 | 1.8 / 3.05 | yes | 3 | 0/0 | 142.5 |
| S06 | 5 / 1 | 40 / 16 | 0.2 / 0.2 | **no** | 0 / 0 | 0 / 0 | 1.61 / 1.52 | yes | 7 | 0/0 | 21.4 |
| S07 | 7 / 0 | 28 / 13 | 0.89 / 0.2 | yes | 0 / 0 | 0 / 0 | 1.61 / 1.79 | yes | 16 | 0/0 | 16.6 |
| S08 | 1 / 0 | 7 / 3 | 1.4 / 0.28 | yes | 0 / 0 | 0 / 0 | 1.65 / 1.7 | yes | 20 | 0/0 | 10.0 |

- Totals for v1, sheets S05–S08: 14 material and 83 gap spots under 1.5 mm, of which 1 material and 36 gap spots were under 0.5 mm.
- Totals for v2: **0 / 0**. Nesting holds.
- The narrowest passage anywhere in v2 is 1.52 mm, on a gap in S06. The medial-axis width `2·dist` is conservative by about 1 px.

### The three reported spots
- **S07 @ (28.3, 158.1) mm** is exactly the 0.1 mm diagonal join the detector found at (28.9, 157.8). In v2 the small piece is cut free with a wide gap and kept, at 16.6 mm² or more (`debug_neck_spots_before_after.png`, middle row).
- **S06 @ (274.2, 21.6) and S08 @ (28.3, 193.9).** In this repo's v1 file, these points show passages about 1.5–2 mm wide rather than sub-kerf necks. The app export may index sheets or position the raster slightly differently. v2 is clean at every location regardless.

### Probe on v2
- Cross separated: Δ 0.827, d 20.7.
- Ring levels: 2/3, with disc-edge and swirl-edge jumps of +0.143. This is unchanged from v1.

## Runtime and Modal cost

**`fuse2.py`:** 105 s wall under `nice` with 4 threads, on a machine shared with a build workload.

| stage | time |
|---|---|
| load | 1.9 s |
| bases | 1.7 s |
| glow / k-means | 10.4 s |
| fusion + compose | 4.0 s |
| colour classes and shapes | 1.4 s |
| SLICO 10 px + guided refinement | 15.7 s |
| overrides | 0.2 s |
| cut cleanup ×2 | 38.8 s |
| write | 4.5 s |
| engrave + SVG | 12.6 s |
| previews | 7.4 s |
| probes | 6.5 s |

**Modal** (workspace <workspace>):

| step | wall time | estimate |
|---|---|---|
| Weight re-download into a re-created `s7-weights` Volume (16 files, about 43 GB, CPU only) | 71 s | $0.04 |
| One L40S `mv2_infer` call: cold start 44 s (image cached), model load 40 s, 4 images (≈5 s each), peak 31 GB | 105 s | $0.11 |

- `modal billing summary` (this month) showed metered **$0.44 before → $0.58 after**, so this round's spend was **≈ $0.14**. Credits covered it, and the billed cost is $0.00. Billing can lag by a few minutes; see `billing_before.txt` / `billing_after.txt`.
- Cleanup: `modal volume delete s7-weights` was run, and `modal volume list` is empty. `modal app list` shows every `s7-depth-cloud` app as `stopped` with 0 tasks; nothing is running or deployed.

## Before / after

See `side_by_side.png` and `detail_crops.png`.

- **Flowers.** The pale lilies and the corner flowers were wobbly blobs on part B's layers 5–6. Each is now a single crisp petal-outline shape, one sheet above its surrounding leaves (layer 7). Their veins are on that sheet's engrave layer.
- **Outlines.** Boundaries now follow colour edges at pixel level instead of the 24 px superpixel beads.
- **Foliage ordering.** Foliage depth now comes from V2, which has clear per-leaf silhouettes. Dark gaps between leaves recede one sheet.
- **Unchanged:** the glow terraces (disc 0 / swirl 1 / rays 2), the cross on 6 in front, and the frame on 7.

## Limitations

- **Petals and frame share layer 7.** The petal shapes are raised to leaf layer + 1, which is the front sheet. The corner flowers therefore share layer 7 with the frame, and a flower touching the frame becomes part of the frame sheet. To keep the frame alone on 7, cap petals at 6 (one parameter).
- **Leaves are still depth-quantised, not shape-segmented.** Within the navy leaf mass, layer boundaries are V2 iso-depth contours snapped to colour edges. They follow leaf edges where V2 has an edge, but some leaves are split across two sheets. Navy leaves have no reliable colour contrast against each other; per-leaf instance segmentation (e.g. SAM) would be the next step.
- **Fine detail removed by the 1.5 mm rule.**
  - The disc's gear-tooth rim (teeth about 1 mm) is smoothed away. It survives as engrave texture only where it falls on a visible surface.
  - Narrow stems and leaf tips are removed by the opening.
  - About 0.02 % of each sheet keeps sub-1.5 mm gaps between parts (see above).
- **Thresholds are tuned to this one image.** The colour-class thresholds (petal L* > 23.5, etc.) were measured on it and assume blue paper foliage over a warm glow.
- **Engraving.** The engrave threshold is a per-layer percentile, so every textured layer gets roughly the same line density. Layer 3 (clouds and red ground) is dense; raise `engrave_pct` there if it reads too busy. The SVGs are centre-lines with a fixed 0.3 mm stroke, not filled outlines.
- **Licences.** Marigold V2 (Apache-2.0) and v1-1 (OpenRAIL++-M) are both inputs, so v1-1's use restrictions still pass through to the output. The Real-ESRGAN weights caveat from part A still applies.

## Loading into the ShadowBox app

1. **1 Source:** `spikes/S7/results/fusion2/height_8layer_v2.png` (3985x3000, single-channel 8-bit). Do not use v1 `height_8layer.png`: it has sub-kerf necks.
2. **2 Interpretation:**
   - **Read the image as** → **Height map**
   - **Polarity** → **White is high** (white = front)
   - **Sheets** → **8**

   The app quantises with `floor(7·s/255+0.5)`, which maps the 8 greys exactly back to layers 0–7.
3. **3 Construction:**
   - **Construction** → **Bonded relief (glued)**
   - Size by **Height**, **300 mm**
   - **Fabrication pitch** → **0.1 mm/px**. 3000 px × 0.1 = 300 mm and 3985 px = 398.5 mm, so the raster is used 1:1 with no resampling.
   - **Machine → Laser profile** → **xTool S1 + feeder**
   - **Min feature** → **1.5 mm**
   - **Cull islands** ≈ **10 mm²**, with **removal ticked**.

   The map is already clean to these settings, so culling should remove little or nothing.
4. **Engraving (prototype, outside the app today):** layer k's file is `engrave/engrave_layer{k}.png` (or `.svg`). It is on the same 3985x3000 / 0.1 mm grid, so align it to sheet k's origin. Layer 0 is the back sheet. `height_8layer_auto.png` (without the cross pin) is v1 only and was not re-cleaned.
