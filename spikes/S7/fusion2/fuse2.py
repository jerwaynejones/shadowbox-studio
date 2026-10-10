"""Spike S7 fusion round 2: V2 + v1-1 base fusion, colour foreground shapes, fine edges, cuttability, engrave layers.

  cd spikes/S7 && .venv/bin/python fusion2/fuse2.py [--overrides fusion2/overrides.json] [--out results/fusion2]

Stages (details + parameters in results/fusion2/README.md):
  1 load      Real-ESRGAN x4 colour -> INTER_AREA to the fabrication grid 3985x3000 (0.1 mm/px, 300 mm tall)
  2 bases     Marigold V2 Log-stage2 @2048 (orig input, + hflip TTA if present) and Marigold v1-1 768/e5 (part A);
              both -> grid, guided filter on colour, rank-equalised; fused = V2 outside the centre, v1-1 inside
  3 glow      part B luminous mask + k-means ring bands (disc/swirl/rays, brighter = deeper) -> layers 0..2
  4 compose   part B compose on the fused base (non-glow -> front layers 3..7)
  5 colour    foreground classes from the upscale (petal = pale grey-blue, leaf = saturated navy, dark gap);
              each petal component becomes ONE flat shape on (surrounding leaf layer + 1) where V2 agrees it is in front;
              dark gaps go one layer back where V2 agrees
  6 edges     SLICO ~10 px majority, then guided-filter label refinement on the colour upscale (pixel-level edges)
  7 override  part B overrides.json format (coords "input" scaled by 3985/1024)
  8 cut       per cumulative sheet S_k = layer>=k (k=1..7), back to front: close/open with a 15 px disc
              (1.5 mm min feature), intersect with S_{k-1} (bonded nesting), drop islands < 1000 px (10 mm^2),
              fill holes < 1000 px; alternating filter repeated until stable
  9 export    8-bit L, exactly 3985x3000, grey round(k*255/7), near = white; engrave rasters + SVG per layer; previews; probes
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
sys.path.insert(0, str(S7 / "fusion"))
import common  # noqa: E402  part A probe (read-only)
import fuse    # noqa: E402  part B stages (read-only; we only set fuse.P values in memory)

P = dict(
    grid=(3985, 3000),             # W, H: app fabrication raster for 300 mm tall at 0.1 mm/px
    n_layers=8,
    upscale=str(S7 / "results/upscaled/cross_realesrgan_x4.png"),
    input=str(S7 / "input/cross.png"),
    v11_dir=str(S7 / "results/marigold11_r768_e5_s4"),
    v2_dirs=[str(S7 / "results/fusion2/mv2/mv2_log_r2048"), str(S7 / "results/fusion2/mv2/mv2_log_r2048_hflip")],
    v2_fallback=str(S7 / "results/cloud/mv2_log_r2048"),
    partB=str(S7 / "results/fusion/height_8layer.png"),
    # bases
    gf_v11=(16, 1e-3), gf_v2=(8, 1e-4),
    centre_radius_in=200, centre_feather_in=25,   # v1-1 zone around the luminous centre, in INPUT px (x3.89 on grid)
    # colour classes (cv2 float Lab: L 0..100). Measured: petals L 24-33, chroma 8-14, a*~0; leaves L 10-22, a* 2-6
    vein_close_px=9,               # closing on L* removes dark veins/curl lines before classing
    blue_b=-4.0, blue_a=10.0,
    petal_L=23.5, petal_a=2.5,
    dark_L=8.5,
    class_sigma=3,
    petal_open_px=7, petal_min_px=1500, petal_ring_px=25, depth_agree_tol=0.02,
    # edges
    slic_region=10, slic_iters=5, refine_r=6, refine_eps=1e-3,
    # cuttability (0.1 mm/px)
    min_feature_px=15, min_island_px=1000, cut_iters=3,
    # engrave
    engrave_kernel=21, engrave_margin_px=10, engrave_min_px=80, engrave_abs=7.0, engrave_pct=78,
    svg_stroke_mm=0.3, svg_min_len_px=20, svg_simplify_px=1.0,
)
N = P["n_layers"]


def log(*a):
    print(f"[{time.perf_counter() - T0:6.1f}s]", *a, flush=True)


def disk(d):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))


def rank01(x, mask=None):
    v = x[mask] if mask is not None else x.ravel()
    qs = np.percentile(v, np.linspace(0, 100, 513))
    qs = np.maximum.accumulate(qs + np.arange(qs.size) * 1e-9)
    return np.interp(x, qs, np.linspace(0, 1, 513)).astype(np.float32)


# ------------------------------------------------------------------ bases
def load_v2():
    dirs = [Path(d) for d in P["v2_dirs"] if (Path(d) / "raw.npy").exists()]
    used = [str(d.relative_to(S7)) for d in dirs]
    if not dirs:
        dirs = [Path(P["v2_fallback"])]; used = [str(dirs[0].relative_to(S7)) + " (part C, fallback)"]
    ns = [common.to_nearness(np.load(d / "raw.npy"), "affine_depth").astype(np.float32) for d in dirs]
    return np.mean(ns, 0), used


def to_grid(x, up, gf):
    W, H = P["grid"]
    b = cv2.resize(x.astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    b = cv2.ximgproc.guidedFilter(up.astype(np.float32) / 255, b, gf[0], gf[1])
    return np.clip(b, 0, 1).astype(np.float32)


# ------------------------------------------------------------------ colour classes
def colour_classes(lab):
    L, a, b = (lab[..., i] for i in range(3))
    Lc = cv2.morphologyEx(L, cv2.MORPH_CLOSE, disk(P["vein_close_px"]))
    a_s, b_s = (cv2.GaussianBlur(x, (0, 0), 2) for x in (a, b))
    blue = (b_s < P["blue_b"]) & (a_s < P["blue_a"])
    cls = np.zeros(L.shape, np.uint8)                     # 0 other, 1 dark gap, 2 leaf, 3 petal
    cls[blue] = 2
    cls[blue & (Lc > P["petal_L"]) & (a_s < P["petal_a"])] = 3
    cls[blue & (Lc < P["dark_L"])] = 1
    s = P["class_sigma"]
    prob = np.stack([cv2.GaussianBlur((cls == k).astype(np.float32), (0, 0), s) for k in range(4)])
    return prob.argmax(0).astype(np.uint8)


def ring_of(mask_u8, r):
    return cv2.dilate(mask_u8, disk(2 * r + 1)).astype(bool) & ~mask_u8.astype(bool)


def colour_layers(layer, cls, v2, glow):
    """Petal components -> one flat shape one layer above the surrounding leaves (if V2 agrees);
    dark gaps -> one layer back (if V2 agrees). Returns new layer map + report."""
    out = layer.copy()
    fg = (glow < 0.5)
    petal = ((cls == 3) & fg).astype(np.uint8)
    petal = cv2.morphologyEx(petal, cv2.MORPH_OPEN, disk(P["petal_open_px"]))
    n, cc, st, _ = cv2.connectedComponentsWithStats(petal, connectivity=8)
    rep = dict(petal_components=0, petal_raised=0, petal_flat_no_raise=0, petal_px=0)
    leafish = (cls == 2) & fg
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < P["petal_min_px"]:
            continue
        x, y, w, h = st[i, :4]; pad = P["petal_ring_px"] + 2
        y0, y1, x0, x1 = max(y - pad, 0), min(y + h + pad, cc.shape[0]), max(x - pad, 0), min(x + w + pad, cc.shape[1])
        comp = (cc[y0:y1, x0:x1] == i)
        ring = ring_of(comp.astype(np.uint8), P["petal_ring_px"]) & leafish[y0:y1, x0:x1]
        rep["petal_components"] += 1; rep["petal_px"] += int(comp.sum())
        inside_lay = layer[y0:y1, x0:x1][comp]
        if ring.sum() < 50:
            new = int(np.median(inside_lay)); rep["petal_flat_no_raise"] += 1
        else:
            agree = v2[y0:y1, x0:x1][comp].mean() >= v2[y0:y1, x0:x1][ring].mean() - P["depth_agree_tol"]
            ring_lay = int(np.round(np.median(layer[y0:y1, x0:x1][ring])))
            if agree:
                new = max(ring_lay + 1, int(np.median(inside_lay))); rep["petal_raised"] += 1
            else:
                new = int(np.median(inside_lay)); rep["petal_flat_no_raise"] += 1
        sub = out[y0:y1, x0:x1]; sub[comp] = min(new, N - 1)
    # dark gaps
    dark = ((cls == 1) & fg).astype(np.uint8)
    n, cc, st, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    rep.update(dark_components=0, dark_pushed=0)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 400:
            continue
        x, y, w, h = st[i, :4]; pad = 12
        y0, y1, x0, x1 = max(y - pad, 0), min(y + h + pad, cc.shape[0]), max(x - pad, 0), min(x + w + pad, cc.shape[1])
        comp = cc[y0:y1, x0:x1] == i
        ring = ring_of(comp.astype(np.uint8), 10) & fg[y0:y1, x0:x1] & (cls[y0:y1, x0:x1] >= 2)
        rep["dark_components"] += 1
        if ring.sum() < 30:
            continue
        if v2[y0:y1, x0:x1][comp].mean() <= v2[y0:y1, x0:x1][ring].mean() + P["depth_agree_tol"]:
            ring_lay = int(np.round(np.median(layer[y0:y1, x0:x1][ring])))
            sub = out[y0:y1, x0:x1]
            sub[comp] = np.minimum(sub[comp], max(ring_lay - 1, N - 5))   # never into the glow terraces (0..2)
            rep["dark_pushed"] += 1
    return out, rep


# ------------------------------------------------------------------ edges
def refine_labels(layer, up):
    g = up.astype(np.float32) / 255
    best = None; arg = np.zeros(layer.shape, np.uint8)
    for k in range(N):
        m = (layer == k)
        if not m.any():
            continue
        p = cv2.ximgproc.guidedFilter(g, m.astype(np.float32), P["refine_r"], P["refine_eps"])
        if best is None:
            best = p; arg[:] = k
        else:
            upd = p > best; best[upd] = p[upd]; arg[upd] = k
    return arg


# ------------------------------------------------------------------ cuttability
def remove_small(mask, min_px, holes=True):
    m = mask.astype(np.uint8)
    n, cc, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = st[:, cv2.CC_STAT_AREA] >= min_px; keep[0] = False
    m = keep[cc]
    if holes:
        inv = (~m).astype(np.uint8)
        n, cc, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
        small = st[:, cv2.CC_STAT_AREA] < min_px; small[0] = False
        # never fill the outside background component touching the border
        border = np.unique(np.r_[cc[0], cc[-1], cc[:, 0], cc[:, -1]])
        small[border] = False
        m = m | small[cc]
    return m


def cut_clean(layer):
    """Sheets S_k = layer >= k, cleaned back to front; S_k subset of S_{k-1} enforced. Returns layer map + report."""
    D = disk(P["min_feature_px"])
    prev = np.ones(layer.shape, bool)
    sheets = [prev]
    for k in range(1, N):
        x = (layer >= k) & prev
        for _ in range(P["cut_iters"]):
            x0 = x
            x = cv2.morphologyEx(x.astype(np.uint8), cv2.MORPH_CLOSE, D).astype(bool) & prev
            x = cv2.morphologyEx(x.astype(np.uint8), cv2.MORPH_OPEN, D).astype(bool)
            x = remove_small(x, P["min_island_px"]) & prev
            if np.array_equal(x, x0):
                break
        sheets.append(x); prev = x
    out = np.sum(np.stack(sheets[1:]), 0).astype(np.uint8)
    return out


def sheet_report(layer):
    D = disk(P["min_feature_px"])
    rep = []
    for k in range(1, N):
        s = (layer >= k).astype(np.uint8)
        n, cc, st, _ = cv2.connectedComponentsWithStats(s, connectivity=8)
        areas = st[1:, cv2.CC_STAT_AREA]
        thin = int((s.astype(bool) & ~cv2.morphologyEx(s, cv2.MORPH_OPEN, D).astype(bool)).sum())
        narrow_gap = int((cv2.morphologyEx(s, cv2.MORPH_CLOSE, D).astype(bool) & ~s.astype(bool)).sum())
        inv = (1 - s).astype(np.uint8)
        nh, cch, sth, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
        hole_areas = sth[1:, cv2.CC_STAT_AREA]
        # min feature estimate: 2 x the smallest per-part maximum inscribed radius (distance transform)
        dt = cv2.distanceTransform(s, cv2.DIST_L2, 5)
        part_w = ndi.maximum(dt, cc, np.arange(1, n)) * 2 if n > 1 else np.array([0.0])
        rep.append(dict(sheet=k, parts=int(n - 1), min_part_area_px=int(areas.min()) if areas.size else 0,
                        min_part_area_mm2=round(float(areas.min()) / 100, 1) if areas.size else 0,
                        islands_lt_10mm2=int((areas < P["min_island_px"]).sum()),
                        holes=int(nh - 1), min_hole_area_mm2=round(float(hole_areas.min()) / 100, 1) if hole_areas.size else None,
                        thin_px_below_1_5mm=thin, narrow_gap_px_below_1_5mm=narrow_gap,
                        narrowest_part_max_width_mm=round(float(np.min(part_w)) / 10, 2),
                        coverage=round(float(s.mean()), 4)))
    nested = all(((layer >= k) <= (layer >= k - 1)).all() for k in range(1, N))
    return rep, nested


# ------------------------------------------------------------------ engrave
def engrave(layer, lab, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    L = lab[..., 0]
    bh = cv2.morphologyEx(L, cv2.MORPH_BLACKHAT, disk(P["engrave_kernel"]))
    bh = cv2.GaussianBlur(bh, (0, 0), 0.8)
    rep = []
    allm = np.zeros(layer.shape, bool)
    from skimage.morphology import skeletonize
    for k in range(N):
        vis = (layer == k).astype(np.uint8)
        vis_in = cv2.erode(vis, disk(2 * P["engrave_margin_px"] + 1)).astype(bool)
        if vis_in.sum() < 1000:
            rep.append(dict(layer=k, engrave_px=0)); continue
        thr = max(P["engrave_abs"], float(np.percentile(bh[vis_in], P["engrave_pct"])))
        m = (bh > thr) & vis_in
        m = remove_small(m, P["engrave_min_px"], holes=False)
        allm |= m
        Image.fromarray(np.where(m, 0, 255).astype(np.uint8), mode="L").save(out_dir / f"engrave_layer{k}.png")
        sk = skeletonize(m)
        polys = trace(sk)
        polys = [cv2.approxPolyDP(np.array(p, np.float32).reshape(-1, 1, 2), P["svg_simplify_px"], False).reshape(-1, 2)
                 for p in polys if len(p) >= P["svg_min_len_px"]]
        write_svg(out_dir / f"engrave_layer{k}.svg", polys, k)
        rep.append(dict(layer=k, threshold_blackhat_L=round(thr, 2), engrave_px=int(m.sum()),
                        engrave_frac_of_visible=round(float(m.sum()) / max(int(vis.sum()), 1), 3),
                        svg_polylines=len(polys), svg_vertices=int(sum(len(p) for p in polys))))
    return rep, allm


NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def trace(sk):
    """Skeleton -> list of polylines [(x,y),...]. Walk from endpoints/junctions, then leftover cycles."""
    ys, xs = np.nonzero(sk)
    if ys.size == 0:
        return []
    H, W = sk.shape
    pad = np.pad(sk.astype(np.uint8), 1)
    deg = sum(np.roll(np.roll(pad, -dy, 0), -dx, 1) for dy, dx in NB)[1:-1, 1:-1] * sk
    pts = set(zip(ys.tolist(), xs.tolist()))
    visited_edges = set()
    polys = []

    def nbrs(p):
        y, x = p
        return [(y + dy, x + dx) for dy, dx in NB if (y + dy, x + dx) in pts]

    def walk(a, b):
        line = [a, b]; visited_edges.add((a, b)); visited_edges.add((b, a))
        prev, cur = a, b
        while deg[cur] == 2:
            nxt = [q for q in nbrs(cur) if q != prev and (cur, q) not in visited_edges]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            visited_edges.add((prev, cur)); visited_edges.add((cur, prev))
            line.append(cur)
        return line

    nodes = [p for p in pts if deg[p] != 2]
    for p in nodes:
        for q in nbrs(p):
            if (p, q) not in visited_edges:
                polys.append(walk(p, q))
    for p in pts:  # pure cycles
        for q in nbrs(p):
            if (p, q) not in visited_edges:
                polys.append(walk(p, q))
    return [[(x, y) for y, x in pl] for pl in polys]


def write_svg(path, polys, k):
    W, H = P["grid"]
    sw = P["svg_stroke_mm"] * 10
    with open(path, "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W / 10}mm" height="{H / 10}mm" viewBox="0 0 {W} {H}">\n')
        f.write(f'<!-- S7 fusion2 engrave strokes, layer {k} (0 = back). 1 unit = 0.1 mm. Stroke = engrave line. -->\n')
        f.write(f'<g fill="none" stroke="#000" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">\n')
        for p in polys:
            d = "M" + " L".join(f"{x:.0f} {y:.0f}" for x, y in p)
            f.write(f'<path d="{d}"/>\n')
        f.write("</g>\n</svg>\n")


# ------------------------------------------------------------------ previews
def side_by_side3(inp, partB, r2, out):
    W0, H0 = 1024, 771
    tiles = [cv2.resize(inp, (W0, H0), interpolation=cv2.INTER_AREA)]
    for g in (partB, r2):
        g = cv2.resize(g, (W0, H0), interpolation=cv2.INTER_NEAREST)
        tiles.append(np.repeat(g[..., None], 3, -1))
    names = ["input", "part B fusion (+overrides)", "round 2 (+overrides, cut-clean)"]
    row = []
    for t, nme in zip(tiles, names):
        bar = np.full((40, W0, 3), 255, np.uint8)
        cv2.putText(bar, nme, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2, cv2.LINE_AA)
        row.append(np.vstack([bar, t]))
    sep = np.full((H0 + 40, 8, 3), 255, np.uint8)
    Image.fromarray(np.hstack([row[0], sep, row[1], sep, row[2]])).save(out)


def detail_crops(inp_up, partB, r2, engr, out):
    """Full-res crops: colour | part B | round 2 (+engrave) for lily, top-right flower and swirl/cross."""
    W, H = P["grid"]
    pb = cv2.resize(partB, (W, H), interpolation=cv2.INTER_NEAREST)
    rows = []
    for (x, y) in ((300, 1950), (3250, 180), (1550, 1000)):
        w, h = 700, 560
        c = inp_up[y:y + h, x:x + w]
        a = np.repeat(pb[y:y + h, x:x + w, None], 3, -1)
        b = np.repeat(r2[y:y + h, x:x + w, None], 3, -1).copy()
        b2 = b.copy(); b2[engr[y:y + h, x:x + w]] = (220, 30, 30)
        rows.append(np.hstack([c, a, b, b2]))
    Image.fromarray(np.vstack(rows)).resize((1400, int(1400 * 3 * 560 / 2800))).save(out)


# ------------------------------------------------------------------ main
def main():
    global T0
    T0 = time.perf_counter()
    ap = argparse.ArgumentParser()
    ap.add_argument("--overrides", default=str(Path(__file__).with_name("overrides.json")))
    ap.add_argument("--out", default=str(S7 / "results/fusion2"))
    ap.add_argument("--no-engrave", action="store_true")
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    timings = {}
    last = [None]

    def tick(name):
        now = time.perf_counter()
        if last[0]:
            timings[last[0][0]] = round(now - last[0][1], 2)
        last[0] = (name, now) if name else None
        if name:
            log(name)

    W, H = P["grid"]; HW = (H, W)
    tick("load")
    up = cv2.resize(np.array(Image.open(P["upscale"]).convert("RGB")), (W, H), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(up.astype(np.float32) / 255, cv2.COLOR_RGB2LAB)
    v11_1024 = np.load(Path(P["v11_dir"]) / "nearness_1024.npy").astype(np.float32)
    v2_native, v2_used = load_v2()

    tick("bases")
    v11 = to_grid(v11_1024, up, P["gf_v11"])
    v2 = to_grid(v2_native, up, P["gf_v2"])

    tick("glow_bands")
    # part B stages with its own parameters (in output px; grid is 0.973x part B's 4096 -> left as is)
    lab_, Lf, af, bf, sd, Lg, bg = fuse.lab_features(up)
    score, w = fuse.luminous_mask(Lg, bg, v11)          # 'far' test uses v1-1 exactly as part B
    core = (score > 0.5) & (Lf >= np.percentile(Lf[score > 0.5], 97))
    ys, xs = np.nonzero(core); cy, cx = float(np.median(ys)), float(np.median(xs))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rad = np.hypot(xx - cx, yy - cy); del yy, xx
    band, centres = fuse.bands([Lf, af, bf, sd, rad], score)
    del Lf, af, bf, sd, Lg, bg, lab_

    tick("base_fusion")
    s = W / 1024
    R0, F0 = P["centre_radius_in"] * s, P["centre_feather_in"] * s
    c_centre = np.clip((R0 + F0 - rad) / (2 * F0), 0, 1)
    c = np.maximum(c_centre, w).astype(np.float32)       # v1-1 weight: centre disc + glow
    fused = (1 - c) * rank01(v2) + c * rank01(v11)
    del rad

    tick("compose")
    fuse.P["n_layers"] = N
    cont = fuse.compose(fused, w, band, HW)
    layer_px = np.clip(np.floor(cont * N), 0, N - 1).astype(np.uint8)

    tick("colour_classes")
    cls = colour_classes(lab)
    layer_c, colour_rep = colour_layers(layer_px, cls, v2, w)

    tick("superpixels_refine")
    fuse.P["slic_region"], fuse.P["slic_iters"] = P["slic_region"], P["slic_iters"]
    seg, nseg = fuse.superpixels(up)
    layer_s = fuse.majority(seg, nseg, layer_c)
    layer_r = refine_labels(layer_s, up)

    tick("overrides")
    ov_report = []
    layer_ov = layer_r.copy()
    if args.overrides and Path(args.overrides).exists():
        rules = json.loads(Path(args.overrides).read_text())
        lab_s = cv2.GaussianBlur(lab, (0, 0), 2)
        layer_ov, _, ov_report = fuse.apply_overrides(layer_ov, cont.copy(), rules, HW, lab_s, seg, nseg)

    tick("cut_clean")
    final_auto = cut_clean(layer_r)
    final = cut_clean(layer_ov)
    rep_pre, _ = sheet_report(layer_ov)
    rep_post, nested = sheet_report(final)

    tick("write")
    u8 = lambda l: np.round(l.astype(np.float32) * 255 / (N - 1)).astype(np.uint8)
    for nm, l in (("height_8layer.png", final), ("height_8layer_auto.png", final_auto), ("height_8layer_precut.png", layer_ov)):
        Image.fromarray(u8(l), mode="L").save(out / nm)
    cls_vis = np.array([[60, 60, 60], [10, 10, 30], [40, 70, 160], [190, 205, 230]], np.uint8)[cls]
    Image.fromarray(cv2.resize(cls_vis, (1024, 771), interpolation=cv2.INTER_NEAREST)).save(out / "debug_colour_classes.png")
    dbg = np.hstack([(cv2.resize(x, (1024, 771), interpolation=cv2.INTER_AREA) * 255).astype(np.uint8)
                     for x in (rank01(v2), rank01(v11), c, fused)])
    Image.fromarray(dbg, mode="L").save(out / "debug_bases_v2_v11_weight_fused.png")

    eng_rep, eng_all = [], np.zeros(HW, bool)
    if not args.no_engrave:
        tick("engrave")
        eng_rep, eng_all = engrave(final, lab, out / "engrave")

    tick("previews")
    fuse.P["n_layers"] = N
    fuse.layers_preview(final, up, out / "layers_preview.png")
    inp = np.array(Image.open(P["input"]).convert("RGB"))
    pb = np.array(Image.open(P["partB"]).convert("L"))
    side_by_side3(inp, pb, u8(final), out / "side_by_side.png")
    detail_crops(up, pb, u8(final), eng_all, out / "detail_crops.png")
    if eng_all.any():
        prev = (0.55 * fuse.PALETTE[final] + 0.45 * up).astype(np.uint8)
        prev[eng_all] = (0, 0, 0)
        Image.fromarray(cv2.resize(prev, (1992, 1500), interpolation=cv2.INTER_AREA)).save(out / "engrave_preview.png")

    tick("probe")
    probes = dict(
        v2_base_tta=fuse.probe(rank01(v2), HW),
        fused_base=fuse.probe(fused, HW),
        round2_auto=fuse.probe(final_auto.astype(np.float32) / (N - 1), HW),
        round2_overrides=fuse.probe(final.astype(np.float32) / (N - 1), HW),
    )
    m = common.masks()
    sm = cv2.resize(final, (1024, 771), interpolation=cv2.INTER_NEAREST)
    region_hist = {k: np.bincount(sm[m[k]], minlength=N).tolist() for k in ("cross", "disc", "swirl", "rays", "foliage")}
    tick(None)
    hist = np.bincount(final.ravel(), minlength=N)
    meta = dict(params=P, v2_sources=v2_used, v11_source=str(Path(P["v11_dir"]).relative_to(S7)) + "/nearness_1024.npy",
                output_shape=[H, W], luminous_centre_px=[round(cx, 1), round(cy, 1)], n_superpixels=int(nseg),
                band_centres_Lab_sd_r=[[round(float(v), 2) for v in cc_] for cc_ in centres],
                colour_layers=colour_rep, overrides=ov_report,
                sheets_before_cut_clean=rep_pre, sheets_after_cut_clean=rep_post, bonded_nesting_ok=bool(nested),
                layer_pixel_fraction=[round(float(h / hist.sum()), 4) for h in hist],
                probe_region_layer_hist_1024=region_hist, engrave=eng_rep,
                grey_values=sorted(np.unique(u8(final)).tolist()),
                timings_s=timings, total_s=round(sum(timings.values()), 2), probe=probes)
    (out / "fusion2_meta.json").write_text(json.dumps(meta, indent=2))
    (out / "probe.json").write_text(json.dumps(probes, indent=2))
    log("done", json.dumps(timings))
    for k, v in probes.items():
        e = v["terrace_edges"]
        print(f"{k:18s} cross_sep={v['cross_separated']} d={v['cross_vs_disc_effect_size']} Δdisc={v['cross_minus_disc']} "
              f"ring_levels={v['ring_levels']}/{v['ring_levels_incl_weak']} region_levels={v['region_levels']} "
              f"disc {e['disc_edge']['jump']:+.3f} swirl {e['swirl_outer_edge']['jump']:+.3f}")
    for r in rep_post:
        print(r)
    print("nested", nested, "colour", colour_rep)


if __name__ == "__main__":
    main()
