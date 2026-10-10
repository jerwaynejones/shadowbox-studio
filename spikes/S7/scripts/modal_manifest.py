"""Append a "cloud" section (part C) to results/manifest.json. Does not touch other sections."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from common import RESULTS
from modal_app import MV2_COMMIT, QWEN_REPO, QWEN_REV, MV2_REPO, MV2_REV, HR_REPO, HR_REV, V11_REPO, V11_REV

C = RESULTS / "cloud"
dl = json.loads((C / "weights_downloaded.json").read_text())
hf = json.loads((C / "hf_cache_weights.json").read_text()) if (C / "hf_cache_weights.json").exists() else []
runs = json.loads((C / "runs.json").read_text())


def files(repo):
    return [dict(path=d["path"], bytes=d["bytes"], sha256=d["sha256"]) for d in dl + hf if d["repo"] == repo and d["bytes"] > 5e6]


man = json.loads((RESULTS / "manifest.json").read_text())
man["cloud"] = dict(
    spike="S7 part C (Modal)",
    platform="Modal, workspace <workspace>, app s7-depth-cloud, volume s7-weights (large weights deleted after the runs)",
    code_repos={"huawei-bayerlab/marigold-v2 (Apache-2.0)": MV2_COMMIT},
    models=[
        dict(name="Marigold V2 depth/Log-stage2", repo=MV2_REPO, revision=MV2_REV, licence="Apache-2.0", weight_files=files(MV2_REPO)),
        dict(name="Qwen-Image-Edit-2509 (Marigold V2 frozen backbone; transformer+vae only)", repo=QWEN_REPO, revision=QWEN_REV,
             licence="Apache-2.0", weight_files=files(QWEN_REPO)),
        dict(name="Marigold HR v1-1", repo=HR_REPO, revision=HR_REV, licence="Apache-2.0", weight_files=files(HR_REPO),
             note="custom pipeline.py from the same repo/revision; base model prs-eth/marigold-depth-v1-1 loaded by the pipeline"),
        dict(name="Marigold depth v1-1", repo=V11_REPO, revision=V11_REV, licence="OpenRAIL++-M", weight_files=files(V11_REPO)),
    ],
    env=dict(mv2="python 3.10, torch 2.10.0+cu128, repo pinned deps (diffusers 0.38.0, transformers 5.4.0, bitsandbytes 0.49.2)",
             marigold="python 3.11, torch 2.6.0 (cu124), diffusers 0.41.0, transformers 5.19.0"),
    runs=runs,
)
(RESULTS / "manifest.json").write_text(json.dumps(man, indent=2))
print("ok", len(runs))
