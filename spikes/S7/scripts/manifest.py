import sys, os, json, glob, subprocess, platform
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import torch, diffusers, transformers
LIC = {
 "Ruicheng/moge-2-vitl-normal": ("MIT", "MoGe-2 ViT-L (normal head)"),
 "depth-anything/DA3MONO-LARGE": ("Apache-2.0", "Depth Anything 3 Mono-Large"),
 "prs-eth/marigold-depth-v1-1": ("OpenRAIL++-M (HF card: openrail++)", "Marigold depth v1-1"),
 "depth-anything/Depth-Anything-V2-Small-hf": ("Apache-2.0", "Depth Anything V2 Small"),
}
models = []
for snap in glob.glob(str(ROOT / "models/hf/hub/models--*/snapshots/*")):
    repo = snap.split("models--")[1].split("/snapshots")[0].replace("--", "/")
    files = [dict(path=os.path.relpath(f, snap), bytes=os.path.getsize(f), sha256=sha256(f))
             for f in sorted(glob.glob(snap + "/**/*", recursive=True)) if os.path.isfile(f) and os.path.getsize(f) > 5e6]
    if not files: continue
    models.append(dict(repo=repo, revision=os.path.basename(snap), source=f"https://huggingface.co/{repo}",
                       licence=LIC.get(repo, ("?",))[0], name=LIC.get(repo, ("?", repo))[1], weight_files=files))
e = ROOT / "models/esrgan/RealESRGAN_x4plus.pth"
models.append(dict(repo="xinntao/Real-ESRGAN (GitHub release v0.1.0)", revision="v0.1.0",
    source="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
    licence="BSD-3-Clause (repo LICENSE; weights published in the same repo's release, no separate weights licence). Training data DF2K/OST: see caveat in README.",
    weight_files=[dict(path=e.name, bytes=e.stat().st_size, sha256=sha256(e))]))
code = {d: subprocess.run(["git", "-C", str(ROOT / "src" / d), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        for d in ("MoGe", "Depth-Anything-3", "Real-ESRGAN")}
total = sum(f["bytes"] for m in models for f in m["weight_files"])
man = dict(spike="S7 part A", input=dict(path="input/cross.png", sha256=sha256(ORIG), size=[W, H]),
           models=models, total_weight_bytes_downloaded=total,
           code_repos={"microsoft/MoGe (MIT)": code["MoGe"], "ByteDance-Seed/Depth-Anything-3 (Apache-2.0)": code["Depth-Anything-3"],
                       "xinntao/Real-ESRGAN (BSD-3-Clause)": code["Real-ESRGAN"]},
           env=dict(python=platform.python_version(), torch=torch.__version__, cuda=torch.version.cuda, diffusers=diffusers.__version__,
                    transformers=transformers.__version__, gpu=torch.cuda.get_device_name(0)),
           not_downloaded=dict(repo="prs-eth/marigold-depth-hr-v1-1", licence="Apache-2.0", revision="902ff7c71d69caec27a5953f50c9195cb8bfa3e3",
                               reason="fp16 weights ~4.3 GB (own unet + boosting_unet + text encoder + vae); would push total to ~9.7 GB, beyond the ~3-5 GB approved. Only README.md/model_index.json fetched."))
(RESULTS / "manifest.json").write_text(json.dumps(man, indent=2)); print(total / 1e9)
