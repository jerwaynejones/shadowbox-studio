"""Local driver for spike S7 part C. Usage: python scripts/modal_run.py download|mv2|hr|v11 [...]
Outputs go to results/cloud/<run>/ (same artefacts + probes as part A, via common.save_outputs).
Every remote call is appended to results/cloud/runs.json with GPU, timings and a cost estimate."""
import sys, os, io, json, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from PIL import Image
import modal
import common
from modal_app import APP, hash_hf_cache, fetch_file, mv2_infer, marigold_run, QWEN_REPO, QWEN_REV, MV2_REPO, MV2_REV, QWEN_FILES, MV2_FILES, ASSETS

CLOUD = common.ROOT / "results" / "cloud"
CLOUD.mkdir(parents=True, exist_ok=True)
common.RESULTS = CLOUD
UPS = common.ROOT / "results" / "upscaled" / "cross_realesrgan_x4.png"
RATE = {"L4": 0.000222, "A10": 0.000306, "L40S": 0.000542, "A100-80GB": 0.000694}
CPU_RATE, MEM_RATE = 0.0000131, 0.00000222
SCALEDOWN = 60


def png_bytes(im):
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


def log_run(rec):
    p = CLOUD / "runs.json"
    runs = json.loads(p.read_text()) if p.exists() else []
    runs.append(rec); p.write_text(json.dumps(runs, indent=2))


def cost(gpu, cpu, mem_gib, seconds):
    return round(seconds * (RATE[gpu] + cpu * CPU_RATE + mem_gib * MEM_RATE), 4)


def timing(r, t_call, t_ret, gpu, cpu, mem):
    cold = round(r["t_enter"] - t_call, 1)  # schedule + image pull + container boot + imports
    run = round(r["t_exit"] - r["t_enter"], 1)
    billed = round(t_ret - t_call + SCALEDOWN, 1)  # upper-bound estimate: whole call + idle scaledown window
    return dict(gpu_type=gpu, gpu_reported=r.get("gpu"), wall_seconds_client=round(t_ret - t_call, 1), cold_start_seconds=cold,
                function_seconds=run, billed_seconds_est=billed, cost_usd_est=cost(gpu, cpu, mem, billed), cpu=cpu, mem_gib=mem)


def download():
    jobs = [(QWEN_REPO, QWEN_REV, f, f"{ASSETS}/checkpoints/Qwen-Image-Edit-2509") for f in QWEN_FILES] + \
           [(MV2_REPO, MV2_REV, f, f"{ASSETS}/checkpoints/Marigold-V2") for f in MV2_FILES]
    t = time.time()
    out = list(fetch_file.starmap(jobs))
    sec = time.time() - t
    (CLOUD / "weights_downloaded.json").write_text(json.dumps(out, indent=2))
    tot = sum(o["seconds"] for o in out)
    log_run(dict(stage="download", wall_seconds_client=round(sec, 1), sum_container_seconds=round(tot, 1),
                 cost_usd_est=round((tot + SCALEDOWN * len(out)) * (2 * CPU_RATE + 4 * MEM_RATE), 4), files=len(out)))
    for o in out: print(o["path"], o["bytes"], o["seconds"])


def mv2():
    src = Image.open(common.ORIG).convert("RGB"); up = Image.open(UPS).convert("RGB")
    imgs = {"a_warmup": src.resize((512, 386), Image.LANCZOS),
            "b_cross_1024": src,                                   # native 1024x771 -> processed at 1024x784
            "c_cross_2048": src.resize((2048, 1542), Image.LANCZOS),  # -> processed at 2048x1552
            "d_esrx4_2048": up.resize((2048, 1542), Image.LANCZOS)}   # ESRGAN 4096 downsampled to the 2048 working res
    t = time.time(); r = mv2_infer.remote({k: png_bytes(v) for k, v in imgs.items()}); t_ret = time.time()
    (CLOUD / "mv2_log.txt").write_text("\n".join(r.get("log", [])))
    if not r["ok"]:
        print("\n".join(r["log"])); raise SystemExit("mv2 failed")
    tm = timing(r, t, t_ret, "L40S", 4, 32)
    tm.update(model_load_seconds=r["load_seconds"], peak_vram_mb_smi_total=r["peak_vram_mb_smi_total"])
    names = {"b_cross_1024": ("mv2_log_r1024", 1024, "input/cross.png", "1024x784"),
             "c_cross_2048": ("mv2_log_r2048", 2048, "input/cross.png", "2048x1552"),
             "d_esrx4_2048": ("mv2_log_r2048_esrx4", 2048, "results/upscaled/cross_realesrgan_x4.png", "2048x1552")}
    per = {}
    for k, (name, res, inp, proc) in names.items():
        o = r["results"][k]
        raw = np.load(io.BytesIO(o["npy"]))
        common.INPUT = common.ROOT / inp
        m = common.save_outputs(name, raw, "affine_depth", dict(
            method="Marigold V2 depth/Log-stage2 (official scripts/infer.py, native mode)", repo=MV2_REPO, revision=MV2_REV,
            backbone=f"{QWEN_REPO}@{QWEN_REV} (DiT 4-bit NF4 at load, VAE bf16)", code="huawei-bayerlab/marigold-v2@9926d93b",
            processing_resolution=res, processed_shape=proc, steps=1, ensemble_size=1, seed=2025,
            raw_note="affine-invariant LOG depth (larger = farther); nearness = -raw", gpu="L40S 48GB",
            seconds=o["seconds"], peak_vram_mb=o["peak_vram_mb_smi"], vram_source="nvidia-smi memory.used (process-wide, incl. allocator cache)",
            cloud=tm))
        per[name] = dict(seconds=o["seconds"], peak_vram_mb_smi=o["peak_vram_mb_smi"], cross=m["probe"]["cross_separated"],
                         rings=m["probe"]["ring_levels_incl_weak"])
        print(name, per[name])
    tm["warmup_seconds"] = r["results"]["a_warmup"]["seconds"]
    log_run(dict(stage="mv2", **tm, per_image=per))
    print(json.dumps(tm, indent=1))


def hf_run(stage, kind, name, inp, cfg, meta):
    data = open(inp, "rb").read()
    t = time.time(); r = marigold_run.remote(kind, data, cfg); t_ret = time.time()
    tm = timing(r, t, t_ret, "L4", 4, 16)
    tm.update(model_load_seconds=r["load_seconds"])
    raw = np.load(io.BytesIO(r["npy"]))
    common.INPUT = inp
    m = common.save_outputs(name, raw, "affine_depth", dict(meta, **cfg, gpu="L4 24GB", seconds=r["seconds"], peak_vram_mb=r["peak_vram_mb"],
                            peak_reserved_mb=r["peak_reserved_mb"], vram_source="torch.cuda.max_memory_allocated",
                            torch=r["torch"], diffusers=r["diffusers"], seed=0, cloud=tm))
    if r.get("base_npy"):
        np.save(CLOUD / name / "base_depth.npy", np.load(io.BytesIO(r["base_npy"])))
    log_run(dict(stage=stage, run=name, **tm, seconds=r["seconds"], peak_vram_mb=r["peak_vram_mb"],
                 cross=m["probe"]["cross_separated"], rings=m["probe"]["ring_levels_incl_weak"]))
    print(name, r["seconds"], r["peak_vram_mb"], tm, m["probe"]["cross_separated"], m["probe"]["ring_levels_incl_weak"])


HR_META = dict(method="Marigold HR v1-1 (prs-eth custom diffusers pipeline.py from the HF repo)", repo="prs-eth/marigold-depth-hr-v1-1",
               revision="902ff7c71d69caec27a5953f50c9195cb8bfa3e3", base_model="prs-eth/marigold-depth-v1-1 (main, loaded by pipeline)", fp16=True)
V11_META = dict(method="Marigold depth v1-1 (diffusers MarigoldDepthPipeline)", repo="prs-eth/marigold-depth-v1-1",
                revision="9571e7123e258cf052b4e54241f17971c290e9a8", fp16=True)

RUNS = {
    # HR defaults: base 768 ens 10 x 10 steps, then boosted x2 (patches at 768) ens 5 x 10 steps
    "hr_x2": ("hr", "hr", "marigoldhr_r768_x2", common.ORIG, dict(res=768, up=2, ens=10, bens=5)),
    "hr_esr_x2": ("hr", "hr", "marigoldhr_r768_x2_esrx4", UPS, dict(res=768, up=2, ens=10, bens=5)),
    "hr_esr_x4": ("hr", "hr", "marigoldhr_r768_x4_esrx4", UPS, dict(res=768, up=4, ens=10, bens=5)),
    "v11_2048_e10_s4": ("v11", "v11", "marigold11_r2048_e10_s4", common.ORIG, dict(res=2048, ens=10, steps=4)),
    "v11_2048_e10_s10": ("v11", "v11", "marigold11_r2048_e10_s10", common.ORIG, dict(res=2048, ens=10, steps=10)),
}

if __name__ == "__main__":
    with modal.enable_output(), APP.run():
        for a in sys.argv[1:]:
            if a == "download": download()
            elif a == "mv2": mv2()
            elif a == "hash":
                h = hash_hf_cache.remote(); (CLOUD / "hf_cache_weights.json").write_text(json.dumps(h, indent=2)); print(len(h), "files hashed")
            else:
                st, kind, name, inp, cfg = RUNS[a]
                hf_run(st, kind, name, inp, cfg, HR_META if kind == "hr" else V11_META)
