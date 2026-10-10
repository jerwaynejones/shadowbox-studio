"""Spike S7 fusion round 2, cut-clean v2: neck-aware cleanup + width verification for bonded sheets.

  cd spikes/S7 && .venv/bin/python fusion2/cutclean2.py            # precut -> height_8layer_v2.png (+ _auto_v2), reports

Why v1 failed: open/close with a 15 px disc leaves a union of discs; two discs that barely overlap (or touch
diagonally) form a waist of ANY width, and the same holds for gaps. v1 checked only the opening residue.

Neck detector (material; gaps use the same on the complement), all on the sheet mask S_k = layer >= k:
  cores   C = erode(X, disc 15)  -> every pixel where a 1.5 mm disc fits; label C (8-connected)
  necks   X pixels on the Voronoi boundary between DIFFERENT cores (nearest-core label changes between 4-neighbours
          that are both in X). If two thick parts were joined by a >= 15 px wide passage the disc could slide through,
          their cores would be one component, so every such boundary inside X is a neck < 1.5 mm (incl. diagonal joins).
  thin    X pixels farther than 7 px from every core (not covered by the opening: tails, strips)
  width   per spot, 2 * max(distance-to-background) - 1 over the spot pixels (the neck's centre-line width)
Independent cross-check: skimage medial axis, spurs pruned, skeleton pixels with 2*dist < 14 px.
Connectivity: component counts of X and ~X with 4- and 8-connectivity must agree (no diagonal-only contacts).

Cleanup per sheet, back to front (prev = cleaned S_{k-1}, X subset of prev always):
  repeat until stable (max 25):
    close/open with disc 15 (close ∩ prev)
    material necks: per spot either BRIDGE (add dilate(spot, disc 15) ∩ prev) or CUT (remove dilate(spot, disc 15) ∩ X),
                    whichever changes fewer pixels; bridge only if it fits inside prev
    gap necks:      per spot either FILL (add dilate(spot, disc 15) if inside prev) or WIDEN (remove dilate(spot) ∩ X)
    diagonal-only contacts: fill the missing pixel (if in prev) else remove the pair's pixel
    islands < 1000 px removed, holes < 1000 px filled (4/8 consistent), ∩ prev
"""
import json, os, sys, time
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "4")
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

cv2.setNumThreads(4)
S7 = Path(__file__).resolve().parents[1]
OUT = S7 / "results/fusion2"
N = 8
DPX = 15          # 1.5 mm at 0.1 mm/px
R = DPX // 2      # 7
ISL = 1000        # 10 mm^2
PAD = 24


def disk(d):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))


DK = disk(DPX)
CLEAN_D = 17      # cleanup disc: 2 px margin so diagonal passages (discrete ellipse) still measure >= 15 px Euclidean
DKC = disk(CLEAN_D)


def padr(x):
    return np.pad(x, PAD, mode="edge")


def unpad(x):
    return x[PAD:-PAD, PAD:-PAD]


# ------------------------------------------------------------------ detection
def neck_map(X, dk=None, r=None):
    """X bool (already padded). Returns (neck_px, thin_px, dt) bool maps + distance-to-background."""
    dk = DK if dk is None else dk
    r = R if r is None else r
    Xu = X.astype(np.uint8)
    C = cv2.erode(Xu, dk)
    n, lab = cv2.connectedComponents(C, connectivity=8)
    dt = cv2.distanceTransform(Xu, cv2.DIST_L2, 5)
    if n <= 1:
        return np.zeros_like(X), X.copy(), dt
    dist, (iy, ix) = ndi.distance_transform_edt(C == 0, return_indices=True)
    near = lab[iy, ix]
    nb = np.zeros_like(X)
    for dy, dx in ((0, 1), (1, 0)):
        a = near[:near.shape[0] - dy, :near.shape[1] - dx]; b = near[dy:, dx:]
        xa = X[:X.shape[0] - dy, :X.shape[1] - dx]; xb = X[dy:, dx:]
        diff = (a != b) & xa & xb
        nb[:nb.shape[0] - dy, :nb.shape[1] - dx] |= diff
        nb[dy:, dx:] |= diff
    # diagonal joins: X pixels touching only diagonally across different cores
    for dy, dx in ((1, 1), (1, -1)):
        sl_a = (slice(0, -1), slice(0, -1)) if dx == 1 else (slice(0, -1), slice(1, None))
        sl_b = (slice(1, None), slice(1, None)) if dx == 1 else (slice(1, None), slice(0, -1))
        diff = (near[sl_a] != near[sl_b]) & X[sl_a] & X[sl_b]
        nb[sl_a] |= diff; nb[sl_b] |= diff
    thin = X & (dist > r + 0.5)
    return nb, thin, dt


def spots(mask, dt, min_w=None):
    """Connected spots (8-conn after 1 px dilation) of a flag map -> list of (cy, cx, width_px)."""
    if not mask.any():
        return []
    m = cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8))
    n, cc, st, cen = cv2.connectedComponentsWithStats(m, connectivity=8)
    lab = np.where(mask, cc, 0)
    mx = ndi.maximum(dt, lab, np.arange(1, n))
    w = 2 * np.asarray(mx) - 1
    return [(float(cen[i + 1][1]), float(cen[i + 1][0]), float(max(w[i], 1.0))) for i in range(n - 1)]


def medial_check(X, thr=14.0, tail_len=8, necks_only=False):
    """Independent cross-check on the medial axis (skimage). Skeleton runs with 2*dist < thr are flagged as
    a NECK if they touch the thick skeleton (2*dist >= thr) at >= 2 separate places (a thin passage between
    thick regions, or a thin strip), or as a TAIL if they are free-ended and >= tail_len px long (thin peninsula).
    Short free-ended runs are spur tips at disc-rounded convex corners and are ignored."""
    from skimage.morphology import medial_axis
    sk, dist = medial_axis(X, return_distance=True)
    thin = sk & (2 * dist < thr)
    thick = sk & ~thin
    n, cc, st, _ = cv2.connectedComponentsWithStats(thin.astype(np.uint8), connectivity=8)
    widths = []
    H, W = X.shape
    for i in range(1, n):
        x, y, w, h = st[i, :4]
        if not (PAD <= y + h // 2 < H - PAD and PAD <= x + w // 2 < W - PAD):
            continue
        y0, y1, x0, x1 = max(y - 2, 0), min(y + h + 2, H), max(x - 2, 0), min(x + w + 2, W)
        comp = cc[y0:y1, x0:x1] == i
        ring = cv2.dilate(comp.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & thick[y0:y1, x0:x1]
        contacts = cv2.connectedComponents(ring.astype(np.uint8), connectivity=8)[0] - 1
        if contacts >= 2:
            # prune free-ended branches (spurs into convex corners) so the min is the passage waist
            th = thick[y0:y1, x0:x1]
            k3 = np.ones((3, 3), np.float32)
            for _ in range(200):
                deg = cv2.filter2D((comp | th).astype(np.float32), -1, k3, borderType=cv2.BORDER_CONSTANT) - 1
                near_thick = cv2.dilate(th.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
                ends = comp & (deg <= 1) & ~near_thick
                if not ends.any():
                    break
                comp = comp & ~ends
            if comp.any():
                widths.append(float((2 * dist[y0:y1, x0:x1][comp]).min()))
        elif not necks_only and st[i, cv2.CC_STAT_AREA] >= tail_len:
            widths.append(float((2 * dist[y0:y1, x0:x1][comp]).min()))
    ws = np.array(widths)
    return dict(spots=int(ws.size), lt_0_5mm=int((ws < 5).sum()),
                min_width_mm=round(float(ws.min()) / 10, 2) if ws.size else None)


def verify_sheet(S, with_medial=True):
    X = padr(S)
    rep = {}
    for nm, Y in (("material", X), ("gap", ~X)):
        nb, thin, dt = neck_map(Y)
        sp = spots(nb | thin, dt)
        sp = [(y - PAD, x - PAD, w) for y, x, w in sp if PAD <= y < X.shape[0] - PAD and PAD <= x < X.shape[1] - PAD]
        ws = np.array([w for *_, w in sp]) if sp else np.array([])
        r = dict(spots_lt_1_5mm=int((ws < DPX).sum()), spots_lt_0_5mm=int((ws < 5).sum()),
                 min_width_mm=round(float(ws.min()) / 10, 2) if ws.size else None,
                 worst=[dict(x_mm=round(x / 10, 1), y_mm=round(y / 10, 1), width_mm=round(w / 10, 2))
                        for y, x, w in sorted(sp, key=lambda t: t[2])[:8]])
        if with_medial:
            r["medial_axis_check"] = medial_check(Y)
        # overall min width (no spots): narrowest 'largest inscribed' among parts
        rep[nm] = r
    Su = S.astype(np.uint8)
    c4 = cv2.connectedComponents(Su, connectivity=4)[0] - 1
    c8 = cv2.connectedComponents(Su, connectivity=8)[0] - 1
    g4 = cv2.connectedComponents(1 - Su, connectivity=4)[0] - 1
    g8 = cv2.connectedComponents(1 - Su, connectivity=8)[0] - 1
    n, cc, st, _ = cv2.connectedComponentsWithStats(Su, connectivity=8)
    nh, cch, sth, _ = cv2.connectedComponentsWithStats(1 - Su, connectivity=8)
    rep.update(parts_4conn=int(c4), parts_8conn=int(c8), gap_regions_4conn=int(g4), gap_regions_8conn=int(g8),
               connectivity_agrees=bool(c4 == c8 and g4 == g8),
               islands_lt_10mm2=int((st[1:, cv2.CC_STAT_AREA] < ISL).sum()),
               holes_lt_10mm2=int((sth[1:, cv2.CC_STAT_AREA] < ISL).sum()),
               min_part_area_mm2=round(float(st[1:, cv2.CC_STAT_AREA].min()) / 100, 1) if n > 1 else None,
               min_gap_region_area_mm2=round(float(sth[1:, cv2.CC_STAT_AREA].min()) / 100, 1) if nh > 1 else None)
    return rep


def verify_map(layer, with_medial=True):
    out = []
    for k in range(1, N):
        r = verify_sheet(layer >= k, with_medial)
        r["sheet"] = k; r["app_sheet"] = f"S{k + 1:02d}"
        out.append(r)
    nested = all(((layer >= k) <= (layer >= k - 1)).all() for k in range(1, N))
    return out, nested


# ------------------------------------------------------------------ cleanup
def remove_small(X, prev):
    Xu = X.astype(np.uint8)
    n, cc, st, _ = cv2.connectedComponentsWithStats(Xu, connectivity=8)
    keep = st[:, cv2.CC_STAT_AREA] >= ISL; keep[0] = False
    X = keep[cc]
    inv = (~X).astype(np.uint8)
    n, cc, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=8)
    small = st[:, cv2.CC_STAT_AREA] < ISL; small[0] = False
    border = np.unique(np.r_[cc[0], cc[-1], cc[:, 0], cc[:, -1]]); small[border] = False
    X = X | (small[cc] & prev)   # a hole that is also a hole of prev stays (prev is clean, so it is >= 10 mm^2)
    return X & prev


def fix_diagonals(X, prev):
    """2x2 checkerboards: fill one empty pixel (prefer inside prev) so 4- and 8-connectivity agree."""
    for _ in range(4):
        a, b, c, d = X[:-1, :-1], X[:-1, 1:], X[1:, :-1], X[1:, 1:]
        p1 = a & d & ~b & ~c
        p2 = b & c & ~a & ~d
        if not (p1.any() or p2.any()):
            break
        add = np.zeros_like(X); rem = np.zeros_like(X)
        # p1: fill b (top-right) if in prev else remove a
        ys, xs = np.nonzero(p1)
        ok = prev[ys, xs + 1]
        add[ys[ok], xs[ok] + 1] = True; rem[ys[~ok], xs[~ok]] = True
        ys, xs = np.nonzero(p2)
        ok = prev[ys, xs]
        add[ys[ok], xs[ok]] = True; rem[ys[~ok], xs[~ok] + 1] = True
        X = (X | add) & ~rem & prev
    return X


def resolve(X, prev, gap):
    """One pass of neck resolution for material (gap=False) or gaps (gap=True). Returns X, n_spots."""
    Y = padr(~X if gap else X)
    nb, thin, dt = neck_map(Y, DKC, CLEAN_D // 2)
    flag = unpad(nb | thin)
    if not flag.any():
        return X, 0
    m = cv2.dilate(flag.astype(np.uint8), np.ones((3, 3), np.uint8))
    n, cc, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    add = np.zeros_like(X); rem = np.zeros_like(X)
    for i in range(1, n):
        x, y, w, h = st[i, :4]
        y0, y1, x0, x1 = max(y - CLEAN_D, 0), min(y + h + CLEAN_D, X.shape[0]), max(x - CLEAN_D, 0), min(x + w + CLEAN_D, X.shape[1])
        spot = (cc[y0:y1, x0:x1] == i) & flag[y0:y1, x0:x1]
        zone = cv2.dilate(spot.astype(np.uint8), DKC).astype(bool)
        xs, ps = X[y0:y1, x0:x1], prev[y0:y1, x0:x1]
        grow = zone & ~xs                       # pixels that would be added (bridge / fill)
        shrink = zone & xs                      # pixels that would be removed (cut / widen)
        can_grow = not (grow & ~ps).any()
        if not gap:   # material neck: bridge or cut
            if can_grow and grow.sum() <= shrink.sum():
                add[y0:y1, x0:x1] |= grow
            else:
                rem[y0:y1, x0:x1] |= shrink
        else:         # gap neck: fill or widen
            if can_grow and grow.sum() <= 2 * shrink.sum():
                add[y0:y1, x0:x1] |= grow
            else:
                rem[y0:y1, x0:x1] |= shrink
    return ((X | add) & ~rem) & prev, int(n - 1)


def clean_sheet(X, prev, max_it=25):
    hist = []
    for it in range(max_it):
        X0 = X
        X = cv2.morphologyEx(X.astype(np.uint8), cv2.MORPH_CLOSE, DKC).astype(bool) & prev
        X = cv2.morphologyEx(X.astype(np.uint8), cv2.MORPH_OPEN, DKC).astype(bool)
        X, nm = resolve(X, prev, gap=False)
        X, ng = resolve(X, prev, gap=True)
        X = fix_diagonals(X, prev)
        X = remove_small(X, prev)
        hist.append((nm, ng))
        if nm == 0 and ng == 0 and np.array_equal(X, X0):
            break
    return X, hist


def clean_map(layer):
    prev = np.ones(layer.shape, bool)
    sheets, hists = [], {}
    for k in range(1, N):
        t = time.perf_counter()
        X, h = clean_sheet((layer >= k) & prev, prev)
        sheets.append(X); prev = X
        hists[k] = dict(iterations=len(h), spots_per_iter=h, seconds=round(time.perf_counter() - t, 1))
        print(f"  sheet {k}: {len(h)} iters, spots/iter {h}", flush=True)
    return np.sum(np.stack(sheets), 0).astype(np.uint8), hists


def u8(l):
    return np.round(l.astype(np.float32) * 255 / (N - 1)).astype(np.uint8)


def load_layer(p):
    a = np.array(Image.open(p).convert("L")).astype(np.int32)
    return np.clip(np.floor(7 * a / 255 + 0.5), 0, 7).astype(np.uint8)


def summary_rows(rep):
    return [dict(sheet=r["sheet"], app_sheet=r["app_sheet"],
                 mat_lt15=r["material"]["spots_lt_1_5mm"], mat_lt5=r["material"]["spots_lt_0_5mm"],
                 mat_min_mm=r["material"]["min_width_mm"],
                 gap_lt15=r["gap"]["spots_lt_1_5mm"], gap_lt5=r["gap"]["spots_lt_0_5mm"], gap_min_mm=r["gap"]["min_width_mm"],
                 medial_mat=r["material"].get("medial_axis_check"), medial_gap=r["gap"].get("medial_axis_check"),
                 parts=r["parts_8conn"], conn_ok=r["connectivity_agrees"], islands=r["islands_lt_10mm2"],
                 holes=r["holes_lt_10mm2"], min_part_mm2=r["min_part_area_mm2"]) for r in rep]


def main():
    t0 = time.perf_counter()
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    res = {}
    if mode in ("all", "verify_old"):
        old = load_layer(OUT / "height_8layer.png")
        rep, nested = verify_map(old)
        res["before_v1_height_8layer"] = dict(nested=nested, sheets=rep)
        for r in summary_rows(rep): print("OLD", r, flush=True)
        (OUT / "cutclean_v2_report.json").write_text(json.dumps(res, indent=2))
    if mode in ("all", "clean"):
        for src, dst in (("height_8layer_precut.png", "height_8layer_v2.png"),):
            lay = load_layer(OUT / src)
            print("cleaning", src, flush=True)
            new, hists = clean_map(lay)
            Image.fromarray(u8(new), mode="L").save(OUT / dst)
            rep, nested = verify_map(new)
            res[dst] = dict(source=src, nested=nested, cleanup=hists, sheets=rep,
                            changed_px_vs_v1=int((new != load_layer(OUT / "height_8layer.png")).sum()),
                            changed_px_vs_precut=int((new != lay).sum()))
            for r in summary_rows(rep): print("NEW", r, flush=True)
            print("nested", nested, flush=True)
        res["seconds"] = round(time.perf_counter() - t0, 1)
        (OUT / "cutclean_v2_report.json").write_text(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
