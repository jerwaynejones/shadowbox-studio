import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import torch
from huggingface_hub import hf_hub_download, HfApi
from moge.model.v2 import MoGeModel

REPO = "Ruicheng/moge-2-vitl-normal"
info = HfApi().model_info(REPO)
path = hf_hub_download(REPO, "model.pt")
model = MoGeModel.from_pretrained(path).cuda().eval()
model.half()  # fp16 weights
img = torch.tensor(load_rgb() / 255.0, dtype=torch.float32).permute(2, 0, 1).cuda().half()
results = []
for tokens in [int(t) for t in sys.argv[1:]] or [3600]:
    try:
        with torch.inference_mode(), Timer() as t:
            out = model.infer(img, num_tokens=tokens, use_fp16=True)
        depth = out["depth"].float().cpu().numpy()
        meta = save_outputs(f"moge2_tok{tokens}", depth, "depth", dict(
            method="MoGe-2 ViT-L normal", repo=REPO, revision=info.sha, num_tokens=tokens,
            seconds=t.seconds, peak_vram_mb=t.peak_mb, weights=path, fp16=True))
        print(tokens, t.seconds, t.peak_mb, meta["probe"]["cross_separated"], meta["probe"]["ring_hist_peaks"])
    except torch.cuda.OutOfMemoryError as e:
        print(tokens, "OOM"); torch.cuda.empty_cache()
