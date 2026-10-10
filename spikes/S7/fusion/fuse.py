"""Spike S7 part B: deterministic depth + luminance fusion -> 8-layer shadowbox height map.

Pipeline (see ../results/fusion/README.md for the long version):
  1. base     Marigold v1-1 nearness (1024) -> cubic up to 4096 -> guided filter on the Real-ESRGAN colour upscale
  2. glow     luminous mask = warm & bright (Lab) x far-in-Marigold, feathered
  3. bands    k-means (Lab L,a,b + local texture) inside the mask, ranked BRIGHTER = DEEPER (rank 0 = back)
  4. compose  outside the glow: base re-mapped onto the front layers; inside: fixed band terraces; feathered blend
  5. snap     SLICO superpixels on the upscale -> per-superpixel majority layer; speck removal (< MIN_SPECK_PX)
  6. override JSON rules (polygon / circle / colour-seed flood) -> pin to layer or +/- offset
  7. quantise 8 layers (0 = back), export 8-bit L (near = white) + 16-bit continuous

Deterministic: fixed RNG seed for k-means, no GPU nondeterminism (all CPU, cv2 threads capped).
Run:  .venv/bin/python fusion/fuse.py [--overrides fusion/overrides.json] [--no-overrides]
"""
import argparse, json, os, sys, time
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "4")
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

cv2.setNumThreads(4)
S7 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(S7 / "scripts"))
import common  # noqa: E402  (probe + region masks from part A; read-only use)

# ---------------------------------------------------------------- parameters
P = dict(
    input=str(S7 / "input/cross.png"),
    upscale=str(S7 / "results/upscaled/cross_realesrgan_x4.png"),
    marigold_dir=str(S7 / "results/marigold11_r768_e5_s4"),
    n_layers=8,
    # 1. base upsampling (guided filter, in output px)
    gf_radius=16, gf_eps=1e-3,
    # 2. luminous mask (Lab L 0..100, b 0..~95; nearness 0..1). Feature blur sigma is in OUTPUT px.
    feat_sigma=16,                 # = 4 px at 1024 input
    feat_valid_b=25.0,             # normalised-convolution: pixels with b* below this (dark/neutral cut paper,
                                   # e.g. the cross) do not contribute to the luminous features
    warm_b=(10.0, 40.0),           # b* ramp: 10 -> 0, 40 -> 1
    warm_L=(30.0, 55.0),           # L* ramp
    far_near=(0.22, 0.12),         # Marigold nearness ramp: >=0.22 -> 0 (near), <=0.12 -> 1 (far)
    mask_feather_sigma=8,          # px, then smoothstep over [0.35, 0.65]
    # 3. banding
    n_bands=3,                     # disc / swirl ring / rays (+ glow) -> layers 0..n_bands-1
    band_weights=(1.5, 1.0, 1.0, 1.5, 1.0),  # feature weights L, a, b, local std, radial dist (after z-scoring)
    radial_feature=True,           # add distance from the luminous centre (centroid of the brightest core)
    band_prob_sigma=12,            # majority smoothing of one-hot band labels (px)
    kmeans_sample=250_000, seed=0,
    # 4. compose: non-luminous base -> layers [n_bands .. n_layers-1]; mix of histogram-equalised and linear
    base_eq_mix=0.5,
    # 5. snapping / cleanup
    slic_region=24, slic_iters=5,
    min_speck_px=225,              # ~15x15 px = 1.5 mm at 0.1 mm/px (300 mm tall print, 3084 px)
    cont_smooth_radius=8, cont_smooth_eps=1e-3,
)


def log(*a):
    print(f"[{time.perf_counter() - T0:6.1f}s]", *a, flush=True)


def ramp(x, a, b):
    """0 at a, 1 at b (a may be > b)."""
    return np.clip((x - a) / (b - a), 0, 1).astype(np.float32)


def smoothstep(x, a, b):
    t = ramp(x, a, b)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- stages
def load_inputs():
    up = np.array(Image.open(P["upscale"]).convert("RGB"))
    H, W = up.shape[:2]
    md = Path(P["marigold_dir"])
    if (md / "nearness_1024.npy").exists():
        near = np.load(md / "nearness_1024.npy").astype(np.float32)
        src = "nearness_1024.npy"
    elif (md / "raw.npy").exists():
        near = common.to_nearness(np.load(md / "raw.npy"), "affine_depth").astype(np.float32)
        src = "raw.npy"
    else:
        near = np.array(Image.open(md / "height.png").convert("L"), np.float32) / 255
        src = "height.png"
    return up, near, src, (H, W)


def upsample_base(near, up, HW):
    H, W = HW
    b = cv2.resize(near, (W, H), interpolation=cv2.INTER_CUBIC)
    guide = up.astype(np.float32) / 255
    b = cv2.ximgproc.guidedFilter(guide, b, P["gf_radius"], P["gf_eps"])
    return np.clip(b, 0, 1)


def lab_features(up):
    lab = cv2.cvtColor(up.astype(np.float32) / 255, cv2.COLOR_RGB2LAB)
    s = P["feat_sigma"]
    valid = (lab[..., 2] > P["feat_valid_b"]).astype(np.float32)
    den = cv2.GaussianBlur(valid, (0, 0), s) + 1e-4
    nc = lambda x: cv2.GaussianBlur(x * valid, (0, 0), s) / den
    L, a, b = (nc(lab[..., i]) for i in range(3))
    sd = np.sqrt(np.maximum(nc(lab[..., 0] ** 2) - L ** 2, 0))
    # plain (unmasked) blur for the luminous-mask test so dark paper stays out of the mask
    Lg, bg = (cv2.GaussianBlur(lab[..., i], (0, 0), s) for i in (0, 2))
    return lab, L, a, b, sd, Lg, bg


def luminous_mask(L, b, base):
    warm = ramp(b, *P["warm_b"]) * ramp(L, *P["warm_L"])
    far = ramp(base, *P["far_near"])
    score = warm * far
    w = smoothstep(cv2.GaussianBlur(score, (0, 0), P["mask_feather_sigma"]), 0.35, 0.65)
    return score, w


def bands(feats, score):
    """k-means in weighted, z-scored feature space; returns rank map (0 = brightest = deepest)."""
    F = np.stack(feats, -1).reshape(-1, len(feats))
    sel = np.flatnonzero(score.ravel() > 0.5)
    rng = np.random.default_rng(P["seed"])
    samp = F[rng.choice(sel, min(P["kmeans_sample"], sel.size), replace=False)]
    mu, sig = samp.mean(0), samp.std(0) + 1e-6
    wts = np.array(P["band_weights"][:len(feats)], np.float32)
    Z = ((samp - mu) / sig * wts).astype(np.float32)
    K = P["n_bands"]
    cv2.setRNGSeed(P["seed"])
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 200, 1e-5)
    _, _, C = cv2.kmeans(Z, K, None, crit, 8, cv2.KMEANS_PP_CENTERS)
    Craw = C / wts * sig + mu
    order = np.argsort(-Craw[:, 0])          # brightest first
    C = C[order]; Craw = Craw[order]
    # assign every pixel (chunked), then majority-smooth via blurred one-hot probabilities
    H, W = score.shape
    lbl = np.empty(H * W, np.uint8)
    for i in range(0, H * W, 2_000_000):
        z = ((F[i:i + 2_000_000] - mu) / sig * wts).astype(np.float32)
        d = ((z[:, None, :] - C[None]) ** 2).sum(-1)
        lbl[i:i + 2_000_000] = d.argmin(1)
    lbl = lbl.reshape(H, W)
    prob = np.stack([cv2.GaussianBlur((lbl == k).astype(np.float32), (0, 0), P["band_prob_sigma"]) for k in range(K)])
    return prob.argmax(0).astype(np.uint8), Craw


def compose(base, w, band, HW):
    N, K = P["n_layers"], P["n_bands"]
    outside = w < 0.5
    v = base[outside]
    lo, hi = np.percentile(v, [1, 99])
    lin = np.clip((base - lo) / (hi - lo), 0, 1)
    qs = np.percentile(v, np.linspace(0, 100, 257))
    eq = np.interp(base, qs, np.linspace(0, 1, 257)).astype(np.float32)
    m = P["base_eq_mix"]
    b01 = m * eq + (1 - m) * lin
    front = (K + b01 * (N - K)) / N              # [K/N, 1]
    terr = (band.astype(np.float32) + 0.5) / N   # band k -> centre of layer k
    return np.clip((1 - w) * front + w * terr, 0, 1).astype(np.float32)


def superpixels(up):
    lab = cv2.cvtColor(up, cv2.COLOR_RGB2LAB)
    s = cv2.ximgproc.createSuperpixelSLIC(lab, cv2.ximgproc.SLICO, P["slic_region"])
    s.iterate(P["slic_iters"])
    s.enforceLabelConnectivity(50)
    return s.getLabels().astype(np.int32), s.getNumberOfSuperpixels()


def majority(seg, nseg, layer):
    N = P["n_layers"]
    cnt = np.bincount(seg.ravel() * N + layer.ravel(), minlength=nseg * N).reshape(nseg, N)
    return cnt.argmax(1).astype(np.uint8)[seg]


def remove_specks(layer, min_px, iters=3):
    N = P["n_layers"]
    for _ in range(iters):
        bad = np.zeros(layer.shape, bool)
        for k in range(N):
            m = (layer == k).astype(np.uint8)
            if not m.any():
                continue
            n, cc, st, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
            small = np.flatnonzero(st[:, cv2.CC_STAT_AREA] < min_px)
            small = small[small > 0]
            if small.size:
                bad |= np.isin(cc, small)
        if not bad.any():
            break
        _, (iy, ix) = ndi.distance_transform_edt(bad, return_indices=True)
        layer = layer[iy, ix]
    return layer


# ---------------------------------------------------------------- overrides
def _region(spec, HW, scale, lab_s):
    H, W = HW
    if "polygon" in spec:
        m = np.zeros(HW, np.uint8)
        cv2.fillPoly(m, [np.round(np.array(spec["polygon"], np.float64) * scale).astype(np.int32)], 1)
        return m.astype(bool)
    if "circle" in spec:
        c = spec["circle"]; m = np.zeros(HW, np.uint8)
        cv2.circle(m, tuple(int(round(v * scale)) for v in c["center"]), int(round(c["radius"] * scale)), 1, -1)
        return m.astype(bool)
    if "rect" in spec:
        x0, y0, x1, y1 = (int(round(v * scale)) for v in spec["rect"])
        m = np.zeros(HW, bool); m[max(y0, 0):y1, max(x0, 0):x1] = True
        return m
    if "seed" in spec:
        x, y = (int(round(v * scale)) for v in spec["seed"])
        within = _region(spec["within"], HW, scale, lab_s) if "within" in spec else np.ones(HW, bool)
        ys, xs = np.nonzero(within)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        crop = lab_s[y0:y1, x0:x1]
        ref = lab_s[y, x]
        dE = np.sqrt(((crop - ref) ** 2).sum(-1))
        cand = ((dE <= spec.get("tolerance", 15)) & within[y0:y1, x0:x1]).astype(np.uint8)
        _, cc = cv2.connectedComponents(cand, connectivity=8)
        lab_id = cc[y - y0, x - x0]
        m = np.zeros(HW, bool)
        if lab_id:
            sub = cc == lab_id
            if spec.get("fill_holes", True):
                sub = ndi.binary_fill_holes(sub)
            r = int(spec.get("grow_px", 0))
            if r:
                sub = cv2.dilate(sub.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))).astype(bool) & within[y0:y1, x0:x1]
            m[y0:y1, x0:x1] = sub
        return m
    raise ValueError(f"unknown selector {spec}")


def apply_overrides(layer, cont, rules, HW, lab_s, seg=None, nseg=0):
    N = P["n_layers"]
    scale = HW[1] / 1024 if rules.get("coords", "input") == "input" else 1.0
    report = []
    for r in rules["rules"]:
        sel = _region(r["select"], HW, scale, lab_s)
        for ex in r.get("exclude", []):
            sel &= ~_region(ex, HW, scale, lab_s)
        if r.get("snap_superpixels") and seg is not None:
            frac = np.bincount(seg.ravel(), sel.ravel().astype(np.float64), nseg) / np.maximum(np.bincount(seg.ravel(), minlength=nseg), 1)
            sel = frac[seg] >= 0.5
        before = np.bincount(layer[sel], minlength=N)
        if "layer" in r:
            new = np.full(int(sel.sum()), int(r["layer"]), np.int16)
        else:
            new = layer[sel].astype(np.int16) + int(r["offset"])
        new = np.clip(new, 0, N - 1).astype(np.uint8)
        changed = int((layer[sel] != new).sum())
        layer[sel] = new
        cont[sel] = (new.astype(np.float32) + 0.5) / N
        report.append(dict(name=r.get("name", ""), selected_px=int(sel.sum()), changed_px=changed,
                           layers_before=before.tolist()))
    return layer, cont, report


# ---------------------------------------------------------------- outputs
PALETTE = np.array([  # layer 0 (back) .. 7 (front); colour-blind-friendly-ish sequential + accents
    [253, 231, 37], [254, 178, 76], [240, 101, 67], [190, 50, 100],
    [120, 40, 130], [60, 80, 160], [40, 140, 140], [70, 190, 90]], np.uint8)


def to_u8_height(layer):
    N = P["n_layers"]
    return np.round(layer.astype(np.float32) * 255 / (N - 1)).astype(np.uint8)


def probe(height01, HW):
    small = cv2.resize(height01.astype(np.float32), (common.W, common.H), interpolation=cv2.INTER_AREA)
    pr = common.run_probe(small)
    pr.pop("radial_profile", None)
    return pr


def layers_preview(layer, up, out):
    N = P["n_layers"]
    W0, H0 = 1024, 771
    lay = cv2.resize(layer, (W0, H0), interpolation=cv2.INTER_NEAREST)
    img = cv2.resize(up, (W0, H0), interpolation=cv2.INTER_AREA).astype(np.float32)
    col = PALETTE[lay].astype(np.float32)
    gray = img.mean(-1, keepdims=True)
    flat = (0.65 * col + 0.35 * gray).astype(np.uint8)
    edges = cv2.morphologyEx(lay, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    flat[edges] = 0
    # oblique stacked render: sheet k = (layer >= k), drawn back to front, offset up-right
    dx, dy, pad = 7, -7, 70
    canvas = np.full((H0 + pad, W0 + pad, 3), 235, np.float32)
    for k in range(N):
        sheet = (lay >= k)
        ox, oy = k * dx, pad + k * dy
        shade = 0.55 + 0.45 * k / (N - 1)
        tex = (0.5 * PALETTE[k] + 0.5 * img) * shade
        # drop shadow
        sh = cv2.GaussianBlur(sheet.astype(np.float32), (0, 0), 3)
        reg = canvas[oy + 3:oy + 3 + H0, ox + 3:ox + 3 + W0]
        reg *= (1 - 0.35 * sh[:reg.shape[0], :reg.shape[1], None])
        reg = canvas[oy:oy + H0, ox:ox + W0]
        reg[sheet] = tex[sheet]
        rim = cv2.morphologyEx(sheet.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((2, 2), np.uint8)) > 0
        reg[rim] = reg[rim] * 0.4
    stack = cv2.resize(canvas.astype(np.uint8), (W0, int((H0 + pad) * W0 / (W0 + pad))), interpolation=cv2.INTER_AREA)
    legend = np.full((40, W0, 3), 255, np.uint8)
    for k in range(N):
        x = 10 + k * 125
        cv2.rectangle(legend, (x, 8), (x + 26, 32), PALETTE[k].tolist(), -1)
        cv2.putText(legend, f"L{k}" + (" back" if k == 0 else " front" if k == N - 1 else ""), (x + 32, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1, cv2.LINE_AA)
    sheet = np.vstack([legend, flat, np.full((10, W0, 3), 255, np.uint8), stack])
    Image.fromarray(sheet).save(out)


def side_by_side(inp, marigold, fused_auto, fused, out):
    W0, H0 = 1024, 771
    tiles = [cv2.resize(inp, (W0, H0), interpolation=cv2.INTER_AREA)]
    for g in (marigold, fused_auto, fused):
        g = cv2.resize(g, (W0, H0), interpolation=cv2.INTER_AREA if g.shape[1] > W0 else cv2.INTER_NEAREST)
        tiles.append(np.repeat(g[..., None], 3, -1))
    names = ["input", "Marigold v1-1 768/e5 (alone)", "fusion, 8 layers (auto)", "fusion + overrides.json"]
    lab_tiles = []
    for t, nme in zip(tiles, names):
        bar = np.full((40, W0, 3), 255, np.uint8)
        cv2.putText(bar, nme, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2, cv2.LINE_AA)
        lab_tiles.append(np.vstack([bar, t]))
    grid = np.vstack([np.hstack(lab_tiles[:2]), np.hstack(lab_tiles[2:])])
    Image.fromarray(grid).save(out)


# ---------------------------------------------------------------- main
def main():
    global T0
    T0 = time.perf_counter()
    ap = argparse.ArgumentParser()
    ap.add_argument("--overrides", default=str(Path(__file__).with_name("overrides.json")))
    ap.add_argument("--out", default=str(S7 / "results/fusion"))
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    timings = {}

    def tick(name, t=[None]):
        now = time.perf_counter()
        if t[0] is not None:
            timings[t[0][0]] = round(now - t[0][1], 2)
        t[0] = (name, now) if name else None
        if name:
            log(name)

    tick("load")
    up, near, near_src, HW = load_inputs()
    tick("base_upsample")
    base = upsample_base(near, up, HW)
    tick("features_mask")
    lab, L, a, b, sd, Lg, bg = lab_features(up)
    score, w = luminous_mask(Lg, bg, base)
    tick("bands_kmeans")
    feats = [L, a, b, sd]
    if P["radial_feature"]:
        core = (score > 0.5) & (L >= np.percentile(L[score > 0.5], 97))
        ys, xs = np.nonzero(core)
        cy, cx = float(np.median(ys)), float(np.median(xs))
        P["luminous_centre_px"] = [round(cx, 1), round(cy, 1)]
        yy, xx = np.mgrid[0:HW[0], 0:HW[1]].astype(np.float32)
        feats.append(np.hypot(xx - cx, yy - cy))
        del yy, xx
    band, centres = bands(feats, score)
    tick("compose")
    cont = compose(base, w, band, HW)
    cont = cv2.ximgproc.guidedFilter(up.astype(np.float32) / 255, cont, P["cont_smooth_radius"], P["cont_smooth_eps"])
    cont = np.clip(cont, 0, 1).astype(np.float32)
    tick("superpixels")
    seg, nseg = superpixels(up)
    tick("quantise_snap_specks")
    N = P["n_layers"]
    layer0 = np.clip(np.floor(cont * N), 0, N - 1).astype(np.uint8)
    layer = majority(seg, nseg, layer0)
    layer = remove_specks(layer, P["min_speck_px"])
    layer_auto = layer.copy()
    cont_auto = cont.copy()
    tick("overrides")
    ov_report = []
    if args.overrides and Path(args.overrides).exists():
        rules = json.loads(Path(args.overrides).read_text())
        lab_s = cv2.GaussianBlur(lab, (0, 0), 2)
        layer, cont, ov_report = apply_overrides(layer, cont, rules, HW, lab_s, seg, nseg)
    tick("write")
    Image.fromarray(to_u8_height(layer), mode="L").save(out / "height_8layer.png")
    Image.fromarray(to_u8_height(layer_auto), mode="L").save(out / "height_8layer_auto.png")
    Image.fromarray(np.round(cont * 65535).astype(np.uint16)).save(out / "height_continuous.png")
    Image.fromarray(np.round(cont_auto * 65535).astype(np.uint16)).save(out / "height_continuous_auto.png")
    sm = (cv2.resize(w, (1024, 771), interpolation=cv2.INTER_AREA) * 255).astype(np.uint8)
    Image.fromarray(sm, mode="L").save(out / "debug_luminous_mask.png")
    bandvis = PALETTE[np.where(w > 0.5, band, 7)]
    Image.fromarray(cv2.resize(bandvis, (1024, 771), interpolation=cv2.INTER_NEAREST)).save(out / "debug_bands.png")
    tick("previews")
    layers_preview(layer, up, out / "layers_preview.png")
    mg = np.array(Image.open(Path(P["marigold_dir"]) / "height.png").convert("L"))
    inp = np.array(Image.open(P["input"]).convert("RGB"))
    side_by_side(inp, mg, to_u8_height(layer_auto), to_u8_height(layer), out / "side_by_side.png")
    tick("probe")
    probes = dict(
        marigold_alone=probe(near, HW),
        fusion_auto_8layer=probe(layer_auto.astype(np.float32) / (N - 1), HW),
        fusion_8layer=probe(layer.astype(np.float32) / (N - 1), HW),
        fusion_continuous=probe(cont, HW),
    )
    tick(None)
    hist = np.bincount(layer.ravel(), minlength=N)
    meta = dict(
        params=P, marigold_source=near_src, output_shape=[HW[0], HW[1]],
        n_superpixels=int(nseg),
        band_centres_Lab_sd=[[round(float(v), 2) for v in c] for c in centres],
        layer_pixel_fraction=[round(float(h / hist.sum()), 4) for h in hist],
        overrides=ov_report, timings_s=timings, total_s=round(sum(timings.values()), 2),
        probe=probes,
    )
    (out / "fusion_meta.json").write_text(json.dumps(meta, indent=2))
    (out / "probe.json").write_text(json.dumps(probes, indent=2))
    log("done", json.dumps(timings))
    for k, v in probes.items():
        e = v["terrace_edges"]
        print(f"{k:22s} cross_sep={v['cross_separated']} d={v['cross_vs_disc_effect_size']} Δdisc={v['cross_minus_disc']} "
              f"Δlocal={v['cross_minus_local_ring']} ring_levels={v['ring_levels']}/{v['ring_levels_incl_weak']} "
              f"region_levels={v['region_levels']} edges: disc {e['disc_edge']['jump']:+.3f}@{e['disc_edge']['radius']} "
              f"swirl {e['swirl_outer_edge']['jump']:+.3f}@{e['swirl_outer_edge']['radius']}")


if __name__ == "__main__":
    main()
