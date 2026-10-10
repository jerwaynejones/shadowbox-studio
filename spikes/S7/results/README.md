# Spike S7 part A — local depth models on the cross shadowbox image

Input: `input/cross.png` (1024x771, Midjourney layered paper-cut). GPU: RTX 3050 Ti Laptop, 4 GB.
All runs are sequential on the GPU. Exact repo ids, revisions, licences and weight SHA-256 are in `manifest.json`.
Scripts are in `../scripts/` (`run_moge.py`, `run_da3.py`, `run_marigold.py`, `run_da2.py`, `run_esrgan.py`, probe and contact-sheet helpers in `common.py` and `contact_sheet.py`).

Each `results/<run>/` folder holds:
- `raw.npy` (model-native float output: depth for MoGe/DA3, affine depth with 0 = near for Marigold, disparity for DA2) and `raw16.png` (the same values min-max scaled to 16 bits; min and max are in `meta.json`).
- `height.png`, an 8-bit 1024x771 height map with near = white. MoGe and DA3 depth is converted to 1/depth, Marigold uses 1 - d, and DA2 is used as-is. Each map is stretched between its 0.5th and 99.5th percentiles. `height16_native.png` is added when the native resolution differs.
- `nearness_1024.npy` and `color.png` (turbo colour map).
- `meta.json` (runtime, peak VRAM, settings, probe results).

Contact sheets:
- `contact_sheet.png`: the input plus every run's global height map.
- `contact_sheet_centre_local.png`: a centre crop, re-normalised to the sun zone, so you can see whether any structure exists there regardless of the global mapping.
- `probe_masks.png`: the regions used by the probe.

Git-ignored, so they exist only locally: `.venv/`, `models/` (5.4 GB of weights), `src/` (the upstream clones; their commits are in `manifest.json`), `*.npy`, `raw16.png`, `height16_native.png`, and `upscaled/`. That last one holds the 4096x3084 PNG, about 17 MB.

## Probe definitions
Regions (see `probe_masks.png`):
- cross: dark silhouette inside the bbox x440–535, y320–450
- inner bright disc: r<56 px around (492,356)
- swirl band: r 66–168, upper half
- ray band: r 186–250
- foliage: blue paper

Values are in global 0–1 nearness.

- **Cross separated?** The cross must be nearer than the disc by more than 0.03, with Cohen's d > 1, and nearer than a 7 px ring just outside it by more than 0.02.
- **Ring levels.** A smooth funnel and a terraced paper stack can have the same region means, so I don't use the means for this. Instead I test for a sharp step in a 1-px radial profile at the disc edge (r≈57) and at the outer swirl edge (r≈176). A step must be larger than the local slope predicts. The count is 1 + the number of such edges, reported as strict / including weak steps. The paper art has at least 3 levels here (disc, swirl ring, ray ring), and probably more.

## Results

Time is the GPU wall time for inference only, warm. The first run in each process includes CUDA warm-up; for example, MoGe tok3600 at 2.1 s came first. VRAM is `torch.cuda.max_memory_allocated`.

| method (run dir) | licence | proc. resolution | time | peak VRAM | cross separated? (Δ vs disc, d) | ring levels strict/weak | notes |
|---|---|---|---|---|---|---|---|
| MoGe-2 ViT-L normal, 1200 tok (`moge2_tok1200`) | MIT | ~40x30 tokens, 1024 out | 0.26 s | 0.90 GB | no (0.036, 1.4) | 1/1 | foliage good; centre is one far blob |
| MoGe-2, 3600 tok = "Ultra" (`moge2_tok3600`) | MIT | ~69x52 tok | 0.8–2.1 s | 1.33 GB | no (0.015, 0.5) | 1/1 | reproduces the HF-space result: cross lost, rings collapsed |
| MoGe-2, 6000 tok (`moge2_tok6000`) | MIT | above training range | 0.76 s | 1.80 GB | no (0.010, 0.2) | 1/1 | no gain |
| MoGe-2, 9000 tok (`moge2_tok9000`) | MIT | ~110x82 tok | 1.26 s | 2.36 GB | no (0.024, 0.6) | 1/1 | highest that fits comfortably; still no cross |
| DA3 Mono-Large 518 (`da3mono_518`) | Apache-2.0 | 518x392 | 0.17 s | 2.12 GB (fp32 weights) | no (0.001, 0.2) | 1/1 | smooth bowl/funnel, cross invisible |
| DA3 Mono-Large 1036 (`da3mono_1036`) | Apache-2.0 | 1036x784 | 0.54 s | 2.90 GB (fp32) | no (0.011, 1.1) | 1/1 | |
| DA3 Mono-Large 1540 (`da3mono_1540_bf16w`) | Apache-2.0 | 1540x1162 | 1.58 s | 2.91 GB | no (0.018, 0.9) | 1/1 | needs bf16 backbone weights (fp32 OOMs); head kept fp32 |
| DA3 Mono-Large 1764 (`da3mono_1764_bf16w`) | Apache-2.0 | 1764x1330 | 2.17 s | 3.29 GB | no (0.026, 1.2) | 1/1 | max feasible (2016 OOM); faint cross stem visible locally only |
| DA3 3x3 tiled + global fusion (`da3mono_tile1540-1036`) | Apache-2.0 | 1540 global + 9 tiles at 1036 | 7.7 s | 2.91 GB | no (0.016, 0.9) | 1/1 | tiling adds texture, not layers |
| Marigold depth v1-1, 768, 1 sample, 4 steps (`marigold11_r768_e1_s4`) | OpenRAIL++-M | 768 | 1.7 s | 2.88 GB | **yes** (0.122, 7.1) | 1/1 | cross clean and crisp; hill and clouds layered |
| Marigold v1-1 768, ensemble 5 (`marigold11_r768_e5_s4`) | OpenRAIL++-M | 768 | 7.4 s | 2.88 GB | **yes** (0.130, 10.3) | 1/1 | cleaner |
| Marigold v1-1 768, ensemble 10, 10 steps (`marigold11_r768_e10_s10`) | OpenRAIL++-M | 768 | 28 s | 2.89 GB | **yes** (0.132, 11.6) | 1/2 | visible step ring at the disc edge |
| Marigold v1-1 1024, 1 sample (`marigold11_r1024_e1_s4`) | OpenRAIL++-M | 1024 | 3.0 s | 2.99 GB | **yes** (0.177, 8.7) | 1/1 | |
| Marigold v1-1 1024, ensemble 5, 10 steps (`marigold11_r1024_e5_s10`) | OpenRAIL++-M | 1024 | 34 s | 3.11 GB | **yes** (0.092, 8.7) | 1/**3** | the only run with weak steps at both ring edges; swirl texture shows as relief |
| Marigold v1-1 1536 (`marigold11_r1536_e1_s4`) | OpenRAIL++-M | 1536 (out of training range) | 7.5 s | 3.21 GB | yes, overshoots (0.68) | 1/2 | cross pushed almost to the foreground plane; foliage noisy |
| DA2-Small 518 (`da2small_518`) | Apache-2.0 | 686x518 | 0.03 s | 0.17 GB | yes (0.092, 4.5) | 1/1 | browser-class baseline: cross kept, centre is a smooth bowl |
| DA2-Small 770 (`da2small_770`) | Apache-2.0 | 1022x770 | 0.15 s | 0.31 GB | yes, weak (0.059, 2.8) | 1/1 | |
| DA2-Small 1036 (`da2small_1036`) | Apache-2.0 | 1372x1036 | 0.21 s | 0.51 GB | no (0.027, 1.0) | 1/1 | higher resolution hurts DA2 here |
| Real-ESRGAN x4plus (`upscaled/`) | BSD-3-Clause (code + release weights) | 1024x771 to 4096x3084 | 7.1 s | 0.72 GB | n/a | n/a | clean, sharp swirl and gear edge |
| ...ESRGAN x4 input fed to MoGe 3600, DA3 1540, Marigold 768e5 and 1536, DA2 518 (`*_esrx4`) | | | similar | similar | same verdicts as without upscaling | 1/1 to 1/2 | upscaling changes nothing material |

Not run: **Marigold HR v1-1** (`prs-eth/marigold-depth-hr-v1-1`). Its Apache-2.0 licence is better than v1-1's, but its fp16 weights are about 4.3 GB: its own unet, a boosting unet, the text encoder and the VAE. The unet is not byte-identical to v1-1's (the SHA-256 values differ). This spike already downloaded 5.4 GB, so adding HR would have reached about 9.7 GB, well past the ~3–5 GB that was approved. VRAM is probably fine: v1-1 ran at 1536 in 3.2 GB.

## Assessment

1. **The "luminous centre collapses" problem comes from the models, not from resolution.** MoGe-2 (1200–9000 tokens) and DA3 Mono-Large (518–1764, plus tiling) produce a smooth far funnel in the sun area. More pixels do not create layers. MoGe-2 loses the cross at every token count. DA3 shows only a faint cross stem at 1764. DA3's sky-clamp post-processing was not the cause: the sky probability stays at or below 0.07 everywhere, and disabling the clamp gave identical output.
2. **Marigold v1-1 is the only model that separates the cross robustly.** It does so at every setting, with effect sizes of 7–15 against about 1 for the others. It also layers the hill, the clouds and the foliage much more like discrete paper sheets. With ensembling at 768 or 1024 it starts to show the disc edge and the outer swirl edge as small steps. These are weak: about 0.01 in global height, against a cross step of about 0.1. Ensemble 5 at 768 (7 s) is the best quality/time point. At 1536 the result is out of distribution and over-exaggerates the cross.
3. **No model produces true terraces for the concentric rings.** Every run, including Marigold, puts the disc, swirl ring and rays on one continuous slope. If the shadowbox needs 3 or more ring layers, depth estimation alone won't deliver them. The likely fix is a segmentation or colour-ring prior: radial bands from the luminance/hue structure, snapped onto Marigold's base depth.
4. **DA2-Small at 518 is a decent browser baseline.** It keeps the cross with globally small contrast, but it has no ring structure at all. Pushing it to higher resolution makes it worse.
5. **Licences.**
   - MoGe-2 (MIT), DA3 Mono-Large (Apache-2.0), DA2-Small (Apache-2.0) and Real-ESRGAN (BSD-3) are commercial-friendly.
   - Marigold v1-1 is OpenRAIL++-M: commercial use is allowed, but with use-based restrictions that must pass downstream.
   - Marigold HR v1-1 is Apache-2.0, which is a reason to test it next.
   - Real-ESRGAN caveat: the weights have no separate licence file and are distributed in the BSD-3 repo's release. They were trained on DF2K and OST, and DIV2K's terms are research-oriented. Get legal sign-off before shipping the weights.
6. Real-ESRGAN gives a clean 4096x3084 image in 7 s and 0.7 GB, but feeding it to the depth models did not change any verdict.

## Failures / limits
- DA3 at 1540 and above with fp32 weights ran out of memory (OOM). Casting the backbone to bf16 fixed it, with the DPT head kept fp32 as upstream does; an all-bf16 head produced visible depth banding. DA3 at 2016 runs out of memory even so. With the ESRGAN 4096 input, 1764 also runs out of memory because the bigger preprocessing buffers stay on the GPU.
- Marigold at 1536 or 2048 initially ran out of memory with diffusers' `set_attention_slice`. It worked once I used default SDPA attention and moved the CLIP text encoder to the CPU after caching the empty-prompt embedding. 2048 was not retried.
- The probe thresholds are heuristic and were tuned against what the images visibly show. Treat the numbers as a ranking aid; the contact sheets are the ground truth.
