import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import torch, transformers
from transformers import AutoImageProcessor, AutoModelForDepthEstimation
from huggingface_hub import HfApi

REPO = "depth-anything/Depth-Anything-V2-Small-hf"
info = HfApi().model_info(REPO)
proc = AutoImageProcessor.from_pretrained(REPO, revision=info.sha)
model = AutoModelForDepthEstimation.from_pretrained(REPO, revision=info.sha, torch_dtype=torch.float16).cuda().eval()
img = Image.open(INPUT).convert("RGB")
for res in [int(a) for a in sys.argv[1:]]:
    # keep aspect: shortest edge = res (multiple of 14), as in the HF processor default (518)
    inputs = proc(images=img, return_tensors="pt", size={"height": res, "width": int(round(res * W / H / 14)) * 14},
                  keep_aspect_ratio=False, do_resize=True)
    with torch.inference_mode(), Timer() as t:
        pred = model(pixel_values=inputs["pixel_values"].cuda().half()).predicted_depth
    disp = pred.float().squeeze().cpu().numpy()  # relative inverse depth (near = high)
    name = f"da2small_{res}"
    meta = save_outputs(name, disp, "disparity", dict(method="Depth Anything V2 Small (transformers)", repo=REPO, revision=info.sha,
                        input_hw=list(inputs["pixel_values"].shape[-2:]), fp16=True, transformers=transformers.__version__,
                        seconds=t.seconds, peak_vram_mb=t.peak_mb))
    print(name, t.seconds, t.peak_mb, meta["probe"]["cross_separated"], meta["native_shape"])
