import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import torch
from huggingface_hub import HfApi
import types
for _m in ("pycolmap", "open3d"):
    sys.modules.setdefault(_m, types.ModuleType(_m))  # export-only deps, unused for mono depth
from depth_anything_3.api import DepthAnything3

REPO = "depth-anything/DA3MONO-LARGE"
info = HfApi().model_info(REPO)
model = DepthAnything3.from_pretrained(REPO).to("cuda").eval()
HALF = os.environ.get("DA3_HALF") == "1"
if HALF:
    net = model.model
    net.backbone.to(torch.bfloat16)  # backbone weights bf16; DPT head stays fp32 (as upstream, avoids bf16 depth banding)
    _orig = net._process_depth_head
    def _cast(o, dt):
        if torch.is_tensor(o): return o.to(dt) if o.is_floating_point() else o
        if isinstance(o, (list, tuple)): return type(o)(_cast(i, dt) for i in o)
        if isinstance(o, dict): return type(o)({k: _cast(v, dt) for k, v in o.items()})
        return o
    def _head(feats, H, W, *a, **k):  # DPT head in fp32 (upstream behaviour) on bf16 backbone features
        return _orig(_cast(feats, torch.float32), H, W, *a, **k)
    net._process_depth_head = _head
    _cam = net._process_camera_estimation
    net._process_camera_estimation = lambda feats, H, W, out: _cam(_cast(feats, torch.float32), H, W, out)
rgb = load_rgb()
NOSKY = os.environ.get("DA3_NOSKY") == "1"
SKY = {}
_sky = model.model._process_mono_sky_estimation
def _sky_hook(output):
    if "sky" in output:
        SKY["last"] = output.sky.float().squeeze().cpu().numpy()
    return output if NOSKY else _sky(output)
model.model._process_mono_sky_estimation = _sky_hook

def infer(img, res):
    pred = model.inference([img], process_res=res, process_res_method="upper_bound_resize")
    return np.asarray(pred.depth[0], dtype=np.float32)

for arg in sys.argv[1:]:
    try:
        if arg.startswith("tile"):  # tile<global_res>,<tile_res>: 3x3 half-size overlapping tiles, aligned to global map
            gres, tres = [int(x) for x in arg[4:].split(",")]
            import cv2
            with torch.inference_mode(), Timer() as t:
                g = 1.0 / resize_to_input(infer(rgb, gres))
                acc = np.zeros((H, W)); wacc = np.zeros((H, W))
                th, tw = H // 2, W // 2
                for ty in np.linspace(0, H - th, 3).astype(int):
                    for tx in np.linspace(0, W - tw, 3).astype(int):
                        crop = np.ascontiguousarray(rgb[ty:ty + th, tx:tx + tw])
                        d = 1.0 / infer(crop, tres)
                        d = cv2.resize(d, (tw, th), interpolation=cv2.INTER_AREA)
                        gt = g[ty:ty + th, tx:tx + tw]
                        A = np.stack([d.ravel(), np.ones(d.size)], 1)
                        sc, sh = np.linalg.lstsq(A, gt.ravel(), rcond=None)[0]
                        wy = np.sin(np.linspace(0, np.pi, th))[:, None] ** 2 + 1e-3
                        wx = np.sin(np.linspace(0, np.pi, tw))[None, :] ** 2 + 1e-3
                        acc[ty:ty + th, tx:tx + tw] += (sc * d + sh) * wy * wx; wacc[ty:ty + th, tx:tx + tw] += wy * wx
                tiled = acc / wacc
                blur = lambda a: cv2.GaussianBlur(a, (0, 0), 16)
                fused = blur(g) + (tiled - blur(tiled))  # global low-freq + tiled high-freq
            depth = fused; res = [gres, tres]; name = f"da3mono_tile{gres}-{tres}"
            meta = save_outputs(name, depth, "disparity", dict(method="Depth Anything 3 Mono-Large, 3x3 tiled + global fusion", repo=REPO, revision=info.sha,
                                process_res=res, seconds=t.seconds, peak_vram_mb=t.peak_mb, weights_dtype="backbone bf16, head fp32" if HALF else "fp32"))
            print(name, t.seconds, t.peak_mb, meta["probe"]["cross_separated"]); continue
        if arg.startswith("ms"):  # multi-scale: geometric-mean blend of depth at several resolutions (aligned in log space)
            ress = [int(x) for x in arg[2:].split(",")]
            with torch.inference_mode(), Timer() as t:
                logs = []
                for r in ress:
                    d = resize_to_input(infer(rgb, r)); l = np.log(np.maximum(d, 1e-6))
                    logs.append((l - np.median(l)) / (np.percentile(l, 90) - np.percentile(l, 10)))
                # low-res for global layout, high-res detail: base = lowest res, add high-pass of highest
                import cv2
                base = logs[0]; hi = logs[-1]
                blur = lambda a: cv2.GaussianBlur(a, (0, 0), 12)
                fused = blur(base) + (hi - blur(hi))
            depth = np.exp(fused); name = f"da3mono_ms{'-'.join(map(str,ress))}" + ("_nosky" if NOSKY else ""); res = ress
        else:
            res = int(arg)
            with torch.inference_mode(), Timer() as t:
                depth = infer(rgb, res)
            name = f"da3mono_{res}" + ("_bf16w" if HALF else "") + ("_nosky" if NOSKY else "")
        meta = save_outputs(name, depth, "depth", dict(method="Depth Anything 3 Mono-Large", repo=REPO, revision=info.sha,
                            process_res=res, seconds=t.seconds, peak_vram_mb=t.peak_mb, autocast="bf16 autocast", sky_clamp_disabled=NOSKY, weights_dtype="backbone bf16, head fp32" if HALF else "fp32"))
        if "last" in SKY:
            sk = SKY["last"]; Image.fromarray((np.clip(sk, 0, 1) * 255).astype(np.uint8)).save(RESULTS / name / "sky_prob.png")
        print(name, t.seconds, t.peak_mb, meta["probe"]["cross_separated"], meta["native_shape"])
    except torch.cuda.OutOfMemoryError:
        print(arg, "OOM"); torch.cuda.empty_cache()
