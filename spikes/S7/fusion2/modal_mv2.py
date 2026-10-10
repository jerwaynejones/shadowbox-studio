"""Spike S7 fusion round 2: re-run Marigold V2 Log-stage2 on Modal (reuses scripts/modal_app.py unchanged).

  .venv/bin/python fusion2/modal_mv2.py download mv2

download: re-fetch the Qwen backbone + MV2 checkpoint into the (re-created) s7-weights Volume (CPU only).
mv2:      one L40S call, one model load, images (all from the ORIGINAL input, Lanczos-resized):
            a_warmup        512x386   (discarded)
            c_cross_2048    2048x1542 (same as part C mv2_log_r2048 -> reproducibility check)
            e_cross_2048_hf 2048x1542 horizontally flipped (TTA; un-flipped on return)
            f_cross_1792    1792x1349 (scale-stability check)
Outputs: results/fusion2/mv2/<run>/ via common.save_outputs (raw.npy, nearness_1024.npy, height.png, meta.json + probe)
and results/fusion2/mv2/runs.json. Delete the Volume afterwards: `modal volume delete s7-weights`.
"""
import sys, os, io, json, time
from pathlib import Path

S7 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(S7 / "scripts"))
import numpy as np
from PIL import Image
import modal
import common
from modal_app import APP, fetch_file, mv2_infer, QWEN_REPO, QWEN_REV, MV2_REPO, MV2_REV, QWEN_FILES, MV2_FILES, ASSETS

OUT = S7 / "results" / "fusion2" / "mv2"
OUT.mkdir(parents=True, exist_ok=True)
common.RESULTS = OUT
L40S, CPU_RATE, MEM_RATE, SCALEDOWN = 0.000542, 0.0000131, 0.00000222, 60


def png_bytes(im):
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


def log_run(rec):
    p = OUT / "runs.json"
    runs = json.loads(p.read_text()) if p.exists() else []
    runs.append(rec); p.write_text(json.dumps(runs, indent=2))


def download():
    jobs = [(QWEN_REPO, QWEN_REV, f, f"{ASSETS}/checkpoints/Qwen-Image-Edit-2509") for f in QWEN_FILES] + \
           [(MV2_REPO, MV2_REV, f, f"{ASSETS}/checkpoints/Marigold-V2") for f in MV2_FILES]
    t = time.time()
    out = list(fetch_file.starmap(jobs))
    sec = time.time() - t
    (OUT / "weights_downloaded.json").write_text(json.dumps(out, indent=2))
    tot = sum(o["seconds"] for o in out)
    log_run(dict(stage="download", wall_seconds_client=round(sec, 1), sum_container_seconds=round(tot, 1), files=len(out),
                 cost_usd_est=round((tot + SCALEDOWN * len(out)) * (2 * CPU_RATE + 4 * MEM_RATE), 4)))
    print("downloaded", len(out), "files in", round(sec, 1), "s")


def mv2():
    src = Image.open(common.ORIG).convert("RGB")
    s2048 = src.resize((2048, 1542), Image.LANCZOS)
    imgs = {"a_warmup": src.resize((512, 386), Image.LANCZOS),
            "c_cross_2048": s2048,
            "e_cross_2048_hf": s2048.transpose(Image.FLIP_LEFT_RIGHT),
            "f_cross_1792": src.resize((1792, 1349), Image.LANCZOS)}
    t = time.time(); r = mv2_infer.remote({k: png_bytes(v) for k, v in imgs.items()}); t_ret = time.time()
    (OUT / "mv2_log.txt").write_text("\n".join(r.get("log", [])))
    if not r["ok"]:
        print("\n".join(r["log"])); raise SystemExit("mv2 failed")
    billed = round(t_ret - t + SCALEDOWN, 1)
    tm = dict(gpu_reported=r.get("gpu"), wall_seconds_client=round(t_ret - t, 1), cold_start_seconds=round(r["t_enter"] - t, 1),
              function_seconds=round(r["t_exit"] - r["t_enter"], 1), model_load_seconds=r["load_seconds"],
              billed_seconds_est=billed, cost_usd_est=round(billed * (L40S + 4 * CPU_RATE + 32 * MEM_RATE), 4),
              peak_vram_mb_smi_total=r["peak_vram_mb_smi_total"])
    names = {"c_cross_2048": ("mv2_log_r2048", 2048, False), "e_cross_2048_hf": ("mv2_log_r2048_hflip", 2048, True),
             "f_cross_1792": ("mv2_log_r1792", 1792, False)}
    per = {}
    for k, (name, res, flip) in names.items():
        o = r["results"][k]
        raw = np.load(io.BytesIO(o["npy"]))
        if flip:
            raw = raw[:, ::-1].copy()
        common.INPUT = common.ORIG
        m = common.save_outputs(name, raw, "affine_depth", dict(
            method="Marigold V2 depth/Log-stage2 (official scripts/infer.py, native mode)", repo=MV2_REPO, revision=MV2_REV,
            backbone=f"{QWEN_REPO}@{QWEN_REV} (DiT 4-bit NF4 at load, VAE bf16)", code="huawei-bayerlab/marigold-v2@9926d93b",
            processing_resolution=res, hflip_tta=flip, steps=1, ensemble_size=1, gpu="L40S 48GB",
            seconds=o["seconds"], peak_vram_mb=o["peak_vram_mb_smi"], cloud=tm))
        per[name] = dict(seconds=o["seconds"], cross=m["probe"]["cross_separated"], d=m["probe"]["cross_vs_disc_effect_size"],
                         rings=[m["probe"]["ring_levels"], m["probe"]["ring_levels_incl_weak"]])
        print(name, per[name])
    log_run(dict(stage="mv2", **tm, per_image=per))
    print(json.dumps(tm, indent=1))


if __name__ == "__main__":
    with modal.enable_output(), APP.run():
        for a in sys.argv[1:]:
            {"download": download, "mv2": mv2}[a]()
