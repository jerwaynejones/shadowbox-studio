import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import torch, diffusers
from huggingface_hub import HfApi

REPO = "prs-eth/marigold-depth-v1-1"
info = HfApi().model_info(REPO)
pipe = diffusers.MarigoldDepthPipeline.from_pretrained(REPO, variant="fp16", torch_dtype=torch.float16, revision=info.sha).to("cuda")
pipe.vae.enable_tiling()
pipe.set_progress_bar_config(disable=True)
img = Image.open(INPUT).convert("RGB")
# warm-up caches the empty-prompt embedding, then the CLIP text encoder can leave the GPU
with torch.inference_mode():
    pipe(img.resize((64, 48)), processing_resolution=64, num_inference_steps=1)
assert pipe.empty_text_embedding is not None
pipe.text_encoder.to("cpu"); torch.cuda.empty_cache()
# attention: default torch SDPA (memory-efficient); diffusers SlicedAttnProcessor was worse
for arg in sys.argv[1:]:
    res, ens, steps = [int(x) for x in arg.split(",")]
    try:
        gen = torch.Generator("cuda").manual_seed(0)
        with torch.inference_mode(), Timer() as t:
            out = pipe(img, processing_resolution=res, ensemble_size=ens, num_inference_steps=steps,
                       match_input_resolution=True, generator=gen, batch_size=1)
        d = np.asarray(out.prediction).squeeze().astype(np.float32)  # affine-invariant depth, 0=near 1=far
        name = f"marigold11_r{res}_e{ens}_s{steps}"
        meta = save_outputs(name, d, "affine_depth", dict(method="Marigold depth v1-1 (diffusers MarigoldDepthPipeline)", repo=REPO,
                            revision=info.sha, processing_resolution=res, ensemble_size=ens, steps=steps, fp16=True, vae_tiling=True, attention='torch SDPA', text_encoder_offloaded=True,
                            diffusers=diffusers.__version__, seconds=t.seconds, peak_vram_mb=t.peak_mb, seed=0))
        print(name, t.seconds, t.peak_mb, meta["probe"]["cross_separated"])
    except torch.cuda.OutOfMemoryError:
        print(arg, "OOM"); torch.cuda.empty_cache()
