# Spike S7 part C — larger depth models on Modal

Input: `input/cross.png` (1024x771). Some runs instead use the Real-ESRGAN x4 upscale `results/upscaled/cross_realesrgan_x4.png` (marked `_esrx4`).

The artefacts and probes match part A: each run directory has `height.png` (near = white), `color.png`, `nearness_1024.npy`, `raw.npy`/`raw16.png` and `meta.json` (the probe plus a `cloud` timing/cost block). The probe definitions are in `../README.md`.

Sheets:
- `contact_sheet.png`: global height maps.
- `contact_sheet_centre_local.png`: centre crop re-normalised to the sun zone.

Both sheets show the two best local runs, `marigold11_r768_e5_s4` and `marigold11_r1024_e5_s10`, next to the cloud runs.

The exact repos, revisions and weight SHA-256 are in `../manifest.json` → `cloud`. Every remote call is logged in `runs.json`.

Code:
- `scripts/modal_app.py`: Modal functions.
- `scripts/modal_run.py`: driver; `python scripts/modal_run.py download mv2 hr_x2 hr_esr_x2 hr_esr_x4 v11_2048_e10_s4 v11_2048_e10_s10 hash`.
- `scripts/modal_contact_sheet.py` and `scripts/modal_manifest.py`.

## Setup
- **Marigold V2.**
  - Code: huawei-bayerlab/marigold-v2 @ `9926d93b`, run through the official `scripts/infer.py`.
  - Checkpoint: `depth/Log-stage2`, the paper model, from HF `huawei-bayerlab/marigold-v2-0` @ `cdf9810f`.
  - Backbone: Qwen-Image-Edit-2509 @ `d3968ef9`, transformer and VAE only. The text encoder is replaced by the repo's precomputed embeddings.
  - The DiT is quantised to 4-bit NF4 at load, as upstream does, and inference is single-step.
  - Environment: torch 2.10/cu128 with the repo's pinned dependencies.
  - All images went through one model load, in `infer.py`'s native mode. To process at 2048, the input was Lanczos-resized to 2048x1542 first; it is rounded up to 2048x1552 internally. The result is equivalent to `--width 2048 --height 1552`.
  - The model outputs affine-invariant **log** depth; height is taken as −raw.
- **Marigold HR v1-1.**
  - Uses `prs-eth/marigold-depth-hr-v1-1` @ `902ff7c7` with its own `pipeline.py` (diffusers custom pipeline), in fp16.
  - Settings are the native defaults:
    - base pass: v1-1 at 768, ensemble 10, 10 DDIM steps;
    - boosted pass: patches at 768, ensemble 5, 10 steps, upscale x2.
  - The x4 run is on the 4096 ESRGAN input only. It works out to about 7 MP, above the 4 MP the card says the model supports.
- **Marigold v1-1** `prs-eth/marigold-depth-v1-1` @ `9571e712`, with diffusers 0.41 and fp16: processing resolution 2048, ensemble 10, run with 4 steps and with 10 steps.

## Results

**Time** is warm GPU inference for one image, excluding model load.

**VRAM:**
- L4 runs: `torch.cuda.max_memory_allocated`.
- Marigold V2: `nvidia-smi` used memory sampled during that image. This counts the whole process, including the allocator cache.

**$ per image** is warm inference time × the Modal rate:
- GPU, plus 4 vCPU and 32 GiB (L40S) or 16 GiB (L4).
- The per-call cost including load is listed under the table.

| method (run dir) | licence | GPU | resolution | time | VRAM | $ / image (warm) | cross? (Δ vs disc, d) | ring levels strict/weak | notes |
|---|---|---|---|---|---|---|---|---|---|
| Marigold V2 Log-stage2 (`mv2_log_r1024`) | Apache-2.0 (code, weights, Qwen backbone) | L40S 48 GB | 1024x784 | 1.2 s | 19.5 GB | $0.0008 | **no** (0.002, 0.6) | 1/1 | Best foliage and paper-layer silhouettes of any model. The whole sun area collapses to one flat far void; the cross disappears. |
| Marigold V2 (`mv2_log_r2048`) | Apache-2.0 | L40S | 2048x1552 | 5.4 s | 30.3 GB | $0.0036 | yes, weak (0.039, 4.1) | **3/3** | The only run with *sharp* steps at both the disc edge and the outer swirl edge (excess 0.024 / 0.025). The swirl band is rendered as embossed per-curl relief, not a plateau; rays show as streaks. Amplitude is small (~0.03 of global range). |
| Marigold V2 on ESRGAN x4 (`mv2_log_r2048_esrx4`) | Apache-2.0 | L40S | 2048x1552 | 5.7 s | 30.3 GB | $0.0038 | no (0.026, 1.4; cross reads as a dark recess locally) | 1/2 | Same resolution, sharper input, opposite ordering: the disc goes *farther* than the swirl (−0.070). Not stable. |
| Marigold HR v1-1 x2 (`marigoldhr_r768_x2`) | Apache-2.0 | L4 24 GB | 768 base → 1536 boosted | 40.2 s | 7.6 GB | $0.0125 | **yes** (0.101, 10.4) | 1/2 | Like local v1-1: robust cross, weak disc-edge step only, smooth funnel. Warns that x2 exceeds the 1024 input. |
| Marigold HR v1-1 x2 on ESRGAN (`marigoldhr_r768_x2_esrx4`) | Apache-2.0 | L4 | 768 → 1536 (of 4096 input) | 38.7 s | 7.6 GB | $0.0120 | **yes** (0.076, 11.4) | 1/2 | A faint disc ring appears in the local crop; no outer step. |
| Marigold HR v1-1 x4 on ESRGAN (`marigoldhr_r768_x4_esrx4`) | Apache-2.0 | L4 | 768 → 3072 (≈7 MP, above the 4 MP spec) | 202 s | 7.9 GB | $0.063 | **yes** (0.052, 9.1) | 1/2 | 5x the cost for no gain. The global map is softer, and edge artefacts appear in the ray band. |
| Marigold v1-1 2048 e10 s4 (`marigold11_r2048_e10_s4`) | OpenRAIL++-M | L4 | 2048 | 40.3 s | 9.6 GB | $0.0125 | yes, **overshoots** (0.85, 18.4) | 2/2 | Out of distribution: the cross is pulled to the foreground plane, as at 1536 locally. The sharp disc-edge "step" is the cross's halo, not a paper ring. Swirl and rays are flat. |
| Marigold v1-1 2048 e10 s10 (`marigold11_r2048_e10_s10`) | OpenRAIL++-M | L4 | 2048 | 77.3 s | 9.6 GB | $0.024 | yes, overshoots (0.84, 20.1) | 2/2 | Same as s4; the extra steps change nothing. |
| *local ref:* v1-1 768 e5 s4 | OpenRAIL++-M | RTX 3050 Ti 4 GB | 768 | 7.4 s | 2.9 GB | — | yes (0.130, 10.3) | 1/1 | best quality/time locally |
| *local ref:* v1-1 1024 e5 s10 | OpenRAIL++-M | RTX 3050 Ti | 1024 | 34 s | 3.1 GB | — | yes (0.092, 8.7) | 1/3 | weak steps at both edges |

### Per-call timing and cost
Figures come from `runs.json`; the totals at the end are from the Modal billing report.

- **Marigold V2 (one call, 3 images plus a warm-up).**
  - Cold start: 259 s, the first pull of a ~10 GB image.
  - Model load and 4-bit quantisation: 69 s. Reading the 41 GB of Qwen shards from the Volume took about 37 s.
  - Inference for all images: about 14 s.
  - Billed by Modal: **$0.070** (L40S $0.056, CPU $0.005, memory $0.007).
  - So a warm Marigold V2 call costs about $0.05, almost all of it model load. Amortised over a warm container, the per-image cost is under $0.004.
- **HR x2, first call:**
  - cold start: 5 s;
  - load: 89 s, including the first HF download into the Volume;
  - billed for the app: **$0.057**.
- **The other five L4 calls (HR esr x2, HR esr x4, v1-1 s4, v1-1 s10, hash), in one session:**
  - cold starts: 0.4–8 s;
  - loads: 1–23 s;
  - billed: **$0.180** (L4 $0.120).
- **Weight download** (CPU only, about 43 GB, 16 parallel containers, under 2 min): **$0.097**, of which $0.046 is network.

### Total spend
`modal billing summary` gives a metered total of **$0.477** for this month. Credits ($0.41) and the network-egress allowance ($0.07) covered it, so the billed cost is **$0.00**.

The driver's own upper-bound estimates sum to about $0.6. They count the 60 s idle window and image pulls on every call.

The `s7-weights` Volume (43 GB) was **deleted** after the runs, so there are no storage charges. All four `s7-depth-cloud` apps are `stopped`.

## Verdict: do larger models separate the concentric rings?

**Not reliably.** Marigold V2 at 2048 comes closest, but the result is fragile and low-amplitude.

- **Marigold V2 @ 2048** is the first run of either spike where the probe finds *sharp* steps at both ring edges (strict 3 levels). In the centre crop you can see a ring at the disc edge and a change of level at the outer swirl edge.
  - The swirl band is not a flat paper ring: the model embosses every swirl curl as its own relief.
  - The whole ring stack spans only about 0.03 of global height, so in the global map the sun zone still sits in the far, near-black region.
  - It does not hold up:
    - at 1024 the same model makes the centre a flat void and loses the cross completely;
    - at the same 2048 resolution but with the sharper ESRGAN input, the disc goes *behind* the swirl and the cross is lost.
  - A result that flips with a small input change can't be used as a ring prior.
- **Marigold HR v1-1** behaves like local v1-1: the cross is robust (d≈9–11), the funnel smooth, and there is only a weak disc-edge step. Going x4 to about 7 MP costs 5x more and adds nothing.
- **Marigold v1-1 @ 2048 with ensemble 10** is out of distribution: the cross overshoots to the foreground (Δ≈0.85). Its "disc step" is the cross halo; the swirl and rays are flat. Larger ensembles or more steps don't change this.

**Recommendation:** the part-A conclusion stands. Depth estimation alone does not deliver the disc / swirl / ray terraces. Use a segmentation or colour-ring prior, snapped onto a Marigold base depth.

Marigold V2 has the cleanest foliage and paper-sheet layering of anything tested, and is fully Apache-2.0. That makes it a candidate *base* depth for a server-side pipeline. It needs at least 20 GB (1024) to 31 GB (2048) of GPU memory and about 70 s of model load per cold container, so it is cloud-only. For the cross and centre, HR v1-1 or v1-1 at 768–1024 remain more dependable.
