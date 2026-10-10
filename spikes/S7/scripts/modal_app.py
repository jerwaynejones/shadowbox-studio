"""Spike S7 part C: larger depth models on Modal (rented GPU).

One app, scale-to-zero everywhere (no min_containers), scaledown_window=60 s, timeouts <= 15 min.
Weights are cached in the Volume "s7-weights":
  /w/assets/checkpoints/Qwen-Image-Edit-2509/{transformer,vae}   (Marigold V2 backbone, text encoder NOT needed)
  /w/assets/checkpoints/Marigold-V2/{depth/Log-stage2,qwen_text_embeddings/...}
  /w/hf                                                           (HF cache for prs-eth Marigold v1-1 / HR)
Driven by scripts/modal_run.py (local entrypoint); this module only defines functions.
"""
import os, time, json, io, subprocess, threading
import modal

_T_IMPORT = time.time()  # container start proxy (module import time inside the container)

APP = modal.App("s7-depth-cloud")
VOL = modal.Volume.from_name("s7-weights", create_if_missing=True)

MV2_COMMIT = "9926d93b0780de5f64bee20895b25a56a98ffbf8"
QWEN_REPO, QWEN_REV = "Qwen/Qwen-Image-Edit-2509", "d3968ef930e841f4c73640fb8afa3b306a78167e"
MV2_REPO, MV2_REV = "huawei-bayerlab/marigold-v2-0", "cdf9810fb690886391a63aec012b5f501064fb0d"
MV2_FILES = ["depth/Log-stage2/trainables.safetensors",
             "qwen_text_embeddings/qwen_edit_2509_qwen_depth_realimg512_prompt_embeds.pt",
             "qwen_text_embeddings/qwen_edit_2509_qwen_depth_realimg512_prompt_mask.pt",
             "README.md", "LICENSE", "manifest.json"]
QWEN_FILES = ["model_index.json", "transformer/config.json", "transformer/diffusion_pytorch_model.safetensors.index.json",
              "vae/config.json", "vae/diffusion_pytorch_model.safetensors"] + \
             [f"transformer/diffusion_pytorch_model-0000{i}-of-00005.safetensors" for i in range(1, 6)]
ASSETS = "/w/assets"

img_dl = modal.Image.debian_slim(python_version="3.11").pip_install("huggingface_hub[hf_xet]>=1.0")

img_mv2 = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.10.0", "torchvision==0.25.0", index_url="https://download.pytorch.org/whl/cu128")
    .run_commands(f"git clone https://github.com/huawei-bayerlab/marigold-v2 /opt/mv2 && cd /opt/mv2 && git checkout {MV2_COMMIT}",
                  "pip install -e /opt/mv2")
    .env({"DEPTH_ASSETS_DIR": ASSETS, "HF_HUB_OFFLINE": "1", "WANDB_MODE": "disabled"})
)

img_mg = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install("torch==2.6.0", "torchvision==0.21.0", "diffusers==0.41.0", "transformers==5.19.0",
                 "accelerate", "safetensors", "huggingface_hub[hf_xet]", "numpy", "pillow", "scipy", "tqdm")
    .env({"HF_HOME": "/w/hf"})
)


# ----------------------------------------------------------------------------------------------
# Weight download (CPU only, one container per file so each fits in the 15 min timeout)
# ----------------------------------------------------------------------------------------------
@APP.function(image=img_dl, volumes={"/w": VOL}, timeout=900, cpu=2, memory=4096, scaledown_window=60)
def fetch_file(repo, rev, path, dest_root):
    import hashlib
    from huggingface_hub import hf_hub_download
    t = time.time()
    dst = os.path.join(dest_root, path)
    if not os.path.exists(dst):
        hf_hub_download(repo, path, revision=rev, local_dir=dest_root)
    h = hashlib.sha256()
    with open(dst, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 24), b""):
            h.update(chunk)
    VOL.commit()
    return dict(repo=repo, revision=rev, path=path, bytes=os.path.getsize(dst), sha256=h.hexdigest(), seconds=round(time.time() - t, 1))


# ----------------------------------------------------------------------------------------------
# GPU helpers
# ----------------------------------------------------------------------------------------------
class SmiPoller:
    """Polls nvidia-smi memory.used (MiB) - needed when inference runs in a subprocess."""
    def __init__(self, dt=0.25):
        self.dt, self.samples, self.stop = dt, [], False
        self.th = threading.Thread(target=self.run, daemon=True); self.th.start()

    def run(self):
        while not self.stop:
            try:
                out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                                     capture_output=True, text=True, timeout=5).stdout.strip().splitlines()[0]
                self.samples.append((time.time(), float(out)))
            except Exception:
                pass
            time.sleep(self.dt)

    def peak(self, t0=0, t1=1e18):
        v = [m for t, m in self.samples if t0 <= t <= t1]
        return max(v) if v else None


def _gpu_name():
    return subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()


# ----------------------------------------------------------------------------------------------
# Marigold V2 (official repo scripts/infer.py, native-resolution mode, one model load for all images)
# ----------------------------------------------------------------------------------------------
@APP.function(image=img_mv2, gpu="L40S", volumes={"/w": VOL}, timeout=900, cpu=4, memory=32768, scaledown_window=60)
def mv2_infer(images: dict, checkpoint_subdir: str = "depth/Log-stage2"):
    """images: {stem: png_bytes}. Each image is processed at its own size rounded up to /16 (infer.py native mode),
    so the 'processing resolution' is set by pre-resizing the input (Lanczos) on the client."""
    t_enter = time.time()
    import numpy as np
    gpu = _gpu_name()
    ind, outd = "/tmp/in", "/tmp/out"
    os.makedirs(ind, exist_ok=True)
    for k, b in images.items():
        open(f"{ind}/{k}.png", "wb").write(b)
    poll = SmiPoller()
    ck = f"{ASSETS}/checkpoints/Marigold-V2/{checkpoint_subdir}"
    p = subprocess.Popen(["python", "scripts/infer.py", "--modality", "depth", "--checkpoint", ck,
                          "--image_dir", ind, "--output_dir", outd], cwd="/opt/mv2",
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    log, appear, t_eval = [], {}, None
    npy_dir = f"{outd}/images/predictions_npy"

    def watch():
        while p.poll() is None:
            if os.path.isdir(npy_dir):
                for f in os.listdir(npy_dir):
                    appear.setdefault(f, time.time())
            time.sleep(0.2)
    w = threading.Thread(target=watch, daemon=True); w.start()
    for line in p.stdout:
        now = time.time()
        log.append(f"{now - t_enter:8.1f} {line.rstrip()}")
        if t_eval is None and "Evaluating on" in line:
            t_eval = now
    p.wait(); w.join(timeout=2)
    if os.path.isdir(npy_dir):
        for f in os.listdir(npy_dir):
            appear.setdefault(f, time.time())
    poll.stop = True
    if p.returncode != 0:
        return dict(ok=False, log=log[-80:], gpu=gpu)
    order = sorted(appear, key=appear.get)
    res, prev = {}, t_eval
    for f in order:
        arr = np.load(f"{npy_dir}/{f}")
        buf = io.BytesIO(); np.save(buf, arr.astype(np.float32))
        res[f[:-4]] = dict(npy=buf.getvalue(), seconds=round(appear[f] - prev, 2),
                           peak_vram_mb_smi=poll.peak(prev, appear[f]))
        prev = appear[f]
    return dict(ok=True, gpu=gpu, results=res, t_import=_T_IMPORT, t_enter=t_enter, t_eval_start=t_eval,
                load_seconds=round(t_eval - t_enter, 1) if t_eval else None, t_exit=time.time(),
                peak_vram_mb_smi_total=poll.peak(), log=log[-60:])


# ----------------------------------------------------------------------------------------------
# Marigold v1-1 / HR v1-1 via diffusers (L4)
# ----------------------------------------------------------------------------------------------
HR_REPO, HR_REV = "prs-eth/marigold-depth-hr-v1-1", "902ff7c71d69caec27a5953f50c9195cb8bfa3e3"
V11_REPO, V11_REV = "prs-eth/marigold-depth-v1-1", "9571e7123e258cf052b4e54241f17971c290e9a8"


@APP.function(image=img_mg, gpu="L4", volumes={"/w": VOL}, timeout=900, cpu=4, memory=16384, scaledown_window=60)
def marigold_run(kind: str, image_png: bytes, cfg: dict):
    """kind: 'hr' (prs-eth HR custom pipeline) or 'v11' (diffusers MarigoldDepthPipeline)."""
    t_enter = time.time()
    import numpy as np, torch, diffusers
    from PIL import Image
    gpu = _gpu_name()
    img = Image.open(io.BytesIO(image_png)).convert("RGB")
    t0 = time.time()
    if kind == "v11":
        pipe = diffusers.MarigoldDepthPipeline.from_pretrained(V11_REPO, revision=V11_REV, variant="fp16", torch_dtype=torch.float16).to("cuda")
    else:
        pipe = diffusers.DiffusionPipeline.from_pretrained(HR_REPO, revision=HR_REV, custom_pipeline=HR_REPO, custom_revision=HR_REV,
                                                           variant="fp16", torch_dtype=torch.float16, trust_remote_code=True).to("cuda")
    pipe.set_progress_bar_config(disable=True)
    VOL.commit()  # persist any newly downloaded weights in the HF cache
    t_load = round(time.time() - t0, 1)
    torch.cuda.synchronize(); torch.cuda.reset_peak_memory_stats()
    t1 = time.time()
    with torch.inference_mode():
        if kind == "v11":
            gen = torch.Generator("cuda").manual_seed(0)
            out = pipe(img, processing_resolution=cfg["res"], ensemble_size=cfg["ens"], num_inference_steps=cfg["steps"],
                       match_input_resolution=True, generator=gen, batch_size=cfg.get("batch", 1))
            d = np.asarray(out.prediction).squeeze().astype(np.float32)
            base = None
        else:
            torch.manual_seed(0)
            out = pipe(img, denoising_steps=cfg.get("steps"), boosted_denoising_steps=cfg.get("bsteps"),
                       ensemble_size=cfg.get("ens", 10), boosted_ensemble_size=cfg.get("bens", 5),
                       processing_res=cfg.get("res", 768), upscale_factor=cfg.get("up", 2), match_input_res=True,
                       show_progress_bar=False)
            d = np.asarray(out.depth_np).squeeze().astype(np.float32)
            base = np.asarray(out.base_depth_np).squeeze().astype(np.float32)
    torch.cuda.synchronize()
    sec = round(time.time() - t1, 2)
    peak = round(torch.cuda.max_memory_allocated() / 2**20, 1)
    peak_res = round(torch.cuda.max_memory_reserved() / 2**20, 1)
    buf = io.BytesIO(); np.save(buf, d)
    bb = None
    if base is not None:
        b2 = io.BytesIO(); np.save(b2, base); bb = b2.getvalue()
    return dict(ok=True, gpu=gpu, npy=buf.getvalue(), base_npy=bb, seconds=sec, load_seconds=t_load, peak_vram_mb=peak,
                peak_reserved_mb=peak_res, t_import=_T_IMPORT, t_enter=t_enter, t_exit=time.time(),
                torch=torch.__version__, diffusers=diffusers.__version__)


@APP.function(image=img_dl, volumes={"/w": VOL}, timeout=900, cpu=2, memory=4096, scaledown_window=60)
def hash_hf_cache():
    """SHA-256 of the weight files the diffusers runs pulled into /w/hf (snapshots resolve symlinks to blobs)."""
    import hashlib, glob
    out = []
    for snap in glob.glob("/w/hf/hub/models--*/snapshots/*"):
        repo = snap.split("models--")[1].split("/snapshots")[0].replace("--", "/")
        for f in sorted(glob.glob(snap + "/**/*", recursive=True)):
            if os.path.isfile(f) and os.path.getsize(f) > 5e6:
                h = hashlib.sha256()
                with open(f, "rb") as fh:
                    for chunk in iter(lambda: fh.read(1 << 24), b""):
                        h.update(chunk)
                out.append(dict(repo=repo, revision=os.path.basename(snap), path=os.path.relpath(f, snap), bytes=os.path.getsize(f), sha256=h.hexdigest()))
    return out
