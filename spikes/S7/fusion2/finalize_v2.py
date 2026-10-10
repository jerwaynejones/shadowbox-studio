"""Post-step for height_8layer_v2.png: min material/gap widths (medial axis, up to 4 mm), probe, engrave + previews on v2.
  .venv/bin/python fusion2/finalize_v2.py"""
import json, sys, os
os.environ.setdefault("OMP_NUM_THREADS", "4")
from pathlib import Path
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
import cutclean2 as cc2
import fuse2
fuse = fuse2.fuse
OUT = cc2.OUT
rep = json.loads((OUT / "cutclean_v2_report.json").read_text())
widths = {}
for name in ("height_8layer.png", "height_8layer_v2.png"):
    L = cc2.load_layer(OUT / name)
    rows = []
    for k in range(1, 8):
        X = cc2.padr(L >= k)
        rows.append(dict(app_sheet=f"S{k + 1:02d}", material=cc2.medial_check(X, thr=40.0, necks_only=True), gap=cc2.medial_check(~X, thr=40.0, necks_only=True)))
    widths[name] = rows
    for r in rows:
        print(name, r, flush=True)
rep["min_neck_widths_medial_axis_upto_4mm"] = widths
(OUT / "cutclean_v2_report.json").write_text(json.dumps(rep, indent=2))
# probe + engrave + previews on v2
fuse2.T0 = 0
v2 = cc2.load_layer(OUT / "height_8layer_v2.png")
W, H = fuse2.P["grid"]
up = cv2.resize(np.array(Image.open(fuse2.P["upscale"]).convert("RGB")), (W, H), interpolation=cv2.INTER_AREA)
lab = cv2.cvtColor(up.astype(np.float32) / 255, cv2.COLOR_RGB2LAB)
pr = json.loads((OUT / "probe.json").read_text())
pr["round2_v2_cutclean2"] = fuse.probe(v2.astype(np.float32) / 7, (H, W))
(OUT / "probe.json").write_text(json.dumps(pr, indent=2))
e = pr["round2_v2_cutclean2"]
print("probe v2", e["cross_separated"], e["cross_minus_disc"], e["cross_vs_disc_effect_size"], e["ring_levels"], e["ring_levels_incl_weak"],
      e["terrace_edges"]["disc_edge"]["jump"], e["terrace_edges"]["swirl_outer_edge"]["jump"])
eng_rep, eng_all = fuse2.engrave(v2, lab, OUT / "engrave")
print("engrave", [(r["layer"], r.get("engrave_px"), r.get("svg_polylines")) for r in eng_rep])
fuse.P["n_layers"] = 8
fuse.layers_preview(v2, up, OUT / "layers_preview.png")
inp = np.array(Image.open(fuse2.P["input"]).convert("RGB"))
pb = np.array(Image.open(fuse2.P["partB"]).convert("L"))
fuse2.side_by_side3(inp, pb, cc2.u8(v2), OUT / "side_by_side.png")
fuse2.detail_crops(up, pb, cc2.u8(v2), eng_all, OUT / "detail_crops.png")
prev = (0.55 * fuse.PALETTE[v2] + 0.45 * up).astype(np.uint8); prev[eng_all] = (0, 0, 0)
Image.fromarray(cv2.resize(prev, (1992, 1500), interpolation=cv2.INTER_AREA)).save(OUT / "engrave_preview.png")
m = json.loads((OUT / "fusion2_meta.json").read_text())
m["v2_cutclean2"] = dict(file="height_8layer_v2.png", engrave=eng_rep, probe=pr["round2_v2_cutclean2"],
                         report="cutclean_v2_report.json")
(OUT / "fusion2_meta.json").write_text(json.dumps(m, indent=2))
a = np.array(Image.open(OUT / "height_8layer_v2.png"))
print("v2 file", Image.open(OUT / "height_8layer_v2.png").mode, a.shape, np.unique(a).tolist())
