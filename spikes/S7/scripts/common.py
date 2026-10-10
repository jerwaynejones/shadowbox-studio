"""Shared helpers for spike S7: saving outputs, region masks, quantitative probes."""
import json, time, hashlib, os
from pathlib import Path
import numpy as np
from PIL import Image
import cv2

ROOT = Path(__file__).resolve().parents[1]
ORIG = ROOT / "input" / "cross.png"
INPUT = Path(os.environ.get("S7_INPUT", ORIG))  # override to feed e.g. the Real-ESRGAN x4 image
TAG = os.environ.get("S7_TAG", "")
RESULTS = ROOT / "results"
W, H = 1024, 771
# Geometry measured on the 1024x771 input (sun/disc centre, radii in px)
CX, CY = 492, 356
R_DISC = 56          # bright inner disc around the cross
R_SWIRL = (66, 168)  # concentric swirl-textured ring band
R_RAYS = (186, 250)  # radial ray band


def load_rgb(path=None):
    return np.array(Image.open(path or INPUT).convert("RGB"))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def masks(rgb=None):
    rgb = load_rgb(ORIG) if rgb is None else rgb
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    yy, xx = np.mgrid[0:H, 0:W]
    rad = np.hypot(xx - CX, yy - CY)
    blue = (b > r + 5) & (b > 40)              # blue paper foliage
    frame = (xx < 22) | (xx > W - 22) | (yy < 22) | (yy > H - 22)
    bbox = (xx >= 440) & (xx <= 535) & (yy >= 320) & (yy <= 450)
    cross = bbox & (lum < 110) & (r < 150)       # dark silhouette inside bbox
    cross = cv2.morphologyEx(cross.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
    above_hill = yy < 440
    upper = yy < CY + 10
    disc = (rad < R_DISC) & ~cross & above_hill & (lum > 150)
    swirl = (rad >= R_SWIRL[0]) & (rad <= R_SWIRL[1]) & upper & ~blue
    rays = (rad >= R_RAYS[0]) & (rad <= R_RAYS[1]) & (yy < CY - 30) & ~blue & (lum > 90)
    foliage = blue & ~frame & ((yy > 560) | (xx < 200) | (xx > 830))
    return dict(cross=cross, disc=disc, swirl=swirl, rays=rays, foliage=foliage,
                rad=rad, blue=blue, frame=frame, yy=yy, xx=xx)


def to_nearness(arr, kind):
    """Return float map where larger = nearer. kind: 'disparity' | 'depth' | 'affine_depth'."""
    a = arr.astype(np.float64)
    if kind == "disparity":
        n = a
    elif kind == "depth":
        a = np.where(np.isfinite(a) & (a > 0), a, np.nan)
        n = 1.0 / a
    elif kind == "affine_depth":
        n = -a
    else:
        raise ValueError(kind)
    n = np.where(np.isfinite(n), n, np.nanmin(n))
    lo, hi = np.percentile(n, 0.5), np.percentile(n, 99.5)
    return np.clip((n - lo) / max(hi - lo, 1e-12), 0, 1)


def resize_to_input(arr):
    if arr.shape[:2] == (H, W):
        return arr.astype(np.float32)
    return cv2.resize(arr.astype(np.float32), (W, H), interpolation=cv2.INTER_AREA if arr.shape[1] > W else cv2.INTER_CUBIC)


def save_outputs(name, raw, kind, meta):
    """raw: model-native map (any resolution). Saves raw .npy/16-bit, height map, colour vis, probe json."""
    name = name + TAG
    out = RESULTS / name
    out.mkdir(parents=True, exist_ok=True)
    raw = np.asarray(raw, dtype=np.float32)
    np.save(out / "raw.npy", raw)
    fin = np.isfinite(raw)
    lo, hi = float(np.nanmin(raw[fin])), float(np.nanmax(raw[fin]))
    r16 = np.where(fin, (raw - lo) / max(hi - lo, 1e-12), 0)
    Image.fromarray((r16 * 65535).round().astype(np.uint16)).save(out / "raw16.png")
    near_native = to_nearness(raw, kind)
    near = np.clip(resize_to_input(near_native), 0, 1)
    np.save(out / "nearness_1024.npy", near.astype(np.float32))
    Image.fromarray((near * 255).round().astype(np.uint8)).save(out / "height.png")
    if near_native.shape != near.shape:
        Image.fromarray((near_native * 65535).round().astype(np.uint16)).save(out / "height16_native.png")
    import matplotlib
    cm = matplotlib.colormaps["turbo"]
    Image.fromarray((cm(near)[..., :3] * 255).astype(np.uint8)).save(out / "color.png")
    probe = run_probe(near)
    meta = dict(meta); meta["input"] = str(INPUT.relative_to(ROOT))
    meta.update(raw_kind=kind, raw_min=lo, raw_max=hi, native_shape=list(raw.shape), probe=probe)
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    return meta


def run_probe(near):
    from scipy.signal import find_peaks
    m = masks()
    stats = {}
    for k in ("cross", "disc", "swirl", "rays", "foliage"):
        v = near[m[k]]
        stats[k] = dict(mean=round(float(v.mean()), 4), std=round(float(v.std()), 4), n=int(v.size))
    c, d = stats["cross"], stats["disc"]
    pooled = np.sqrt((c["std"] ** 2 + d["std"] ** 2) / 2) + 1e-6
    # local ring just outside the cross silhouette (dilated - cross), restricted to above-hill
    cm = m["cross"].astype(np.uint8)
    ring = cv2.dilate(cm, np.ones((15, 15), np.uint8)).astype(bool) & ~m["cross"] & (m["yy"] < 440)
    local = near[ring]
    delta_disc = c["mean"] - d["mean"]
    delta_local = float(near[m["cross"]].mean() - local.mean())
    effect = delta_disc / pooled
    separated = bool(delta_disc > 0.03 and effect > 1.0 and delta_local > 0.02)
    # Radial profile (upper half, non-foliage), median per 3-px annulus
    sel = (m["yy"] < CY) & ~m["blue"] & ~m["cross"]
    radii = np.arange(0, 270, 3)
    prof = []
    for r0 in radii:
        a = sel & (m["rad"] >= r0) & (m["rad"] < r0 + 3)
        prof.append(float(np.median(near[a])) if a.any() else np.nan)
    prof = np.array(prof)
    # Distinct levels across ring structure: histogram peaks of nearness over disc+swirl+rays
    zone = sel & (m["rad"] >= 20) & (m["rad"] <= R_RAYS[1])
    vals = near[zone]
    hist, edges = np.histogram(vals, bins=64, range=(0, 1))
    hs = np.convolve(hist, np.ones(3) / 3, mode="same")
    peaks, _ = find_peaks(hs, prominence=0.05 * hs.max(), distance=2)
    # Steps in the radial profile: plateaus separated by jumps > 0.02 over <= 9px
    sm = np.convolve(np.nan_to_num(prof, nan=np.nanmean(prof)), np.ones(3) / 3, mode="same")
    jumps = np.abs(sm[3:] - sm[:-3])
    step_idx, _ = find_peaks(jumps, height=0.02, distance=4)
    zone_range = float(np.percentile(vals, 95) - np.percentile(vals, 5))
    # Local (centre-zone) renormalisation: is the structure there at all, regardless of global mapping?
    lo, hi = np.percentile(vals, 1), np.percentile(vals, 99)
    loc = np.clip((near - lo) / max(hi - lo, 1e-9), 0, 1)
    lh, le = np.histogram(loc[zone], bins=64, range=(0, 1))
    lhs = np.convolve(lh, np.ones(3) / 3, mode="same")
    lpeaks, _ = find_peaks(lhs, prominence=0.05 * lhs.max(), distance=2)
    lprof = np.array([np.nan if np.isnan(x) else (x - lo) / max(hi - lo, 1e-9) for x in prof])
    lsm = np.convolve(np.nan_to_num(lprof, nan=np.nanmean(lprof)), np.ones(3) / 3, mode="same")
    lsteps, _ = find_peaks(np.abs(lsm[3:] - lsm[:-3]), height=0.08, distance=4)
    lx = loc[m["cross"]].mean() - loc[m["disc"]].mean()
    # Region-level count: disc -> swirl band -> ray band, a new level when the step is both
    # visible in the global height map (>0.02) and statistically clear (Cohen's d > 0.8)
    order = ["disc", "swirl", "rays"]; levels = 1; steps_desc = []
    for a_, b_ in zip(order, order[1:]):
        dlt = stats[b_]["mean"] - stats[a_]["mean"]
        dd = abs(dlt) / (np.sqrt((stats[a_]["std"] ** 2 + stats[b_]["std"] ** 2) / 2) + 1e-6)
        ok = abs(dlt) > 0.02 and dd > 0.8
        levels += int(ok); steps_desc.append(f"{a_}->{b_}: {dlt:+.3f} (d={dd:.1f}){'*' if ok else ''}")
    # Terrace-edge test on a fine radial profile (1px annuli, upper half, non-foliage): is there a
    # sharp step at the disc edge (r~57) / outer swirl edge (r~176), beyond what the local slope predicts?
    r1 = np.arange(0, 260)
    p1 = np.array([np.median(near[sel & (m["rad"] >= r) & (m["rad"] < r + 1)]) if (sel & (m["rad"] >= r) & (m["rad"] < r + 1)).any() else np.nan for r in r1])
    edges_found = {}
    for nm, R in (("disc_edge", 57), ("swirl_outer_edge", 176)):
        best = None
        for Rc in range(R - 6, R + 7):  # allow small radius error
            inner = np.nanmedian(p1[Rc - 8:Rc - 2]); outer = np.nanmedian(p1[Rc + 2:Rc + 8])
            jump = outer - inner
            xs = np.r_[np.arange(Rc - 30, Rc - 10), np.arange(Rc + 10, Rc + 30)]
            ys = p1[xs]; ok = np.isfinite(ys)
            slope = np.polyfit(xs[ok], ys[ok], 1)[0] if ok.sum() > 5 else 0.0
            resid = np.nanstd(ys[ok] - np.polyval(np.polyfit(xs[ok], ys[ok], 1), xs[ok])) if ok.sum() > 5 else 0.0
            excess = abs(jump - slope * 10)
            if best is None or excess > best[0]:
                best = (excess, Rc, jump, slope * 10, resid)
        ex, Rc, jump, expect, resid = best
        edges_found[nm] = dict(radius=int(Rc), jump=round(float(jump), 4), expected_from_slope=round(float(expect), 4),
                               excess=round(float(ex), 4), sharp_step=bool(ex > 0.015 and ex > 3 * resid),
                               weak_step=bool(ex > 0.005 and ex > 2 * resid and abs(jump) > 1.5 * abs(expect)))
    terrace_levels = 1 + sum(e["sharp_step"] for e in edges_found.values())
    terrace_levels_incl_weak = 1 + sum(e["sharp_step"] or e["weak_step"] for e in edges_found.values())
    return dict(regions=stats, ring_levels=terrace_levels, ring_levels_incl_weak=terrace_levels_incl_weak, terrace_edges=edges_found,
                region_levels=levels, region_level_steps=steps_desc,
                cross_minus_disc=round(delta_disc, 4),
                cross_minus_local_ring=round(delta_local, 4),
                cross_vs_disc_effect_size=round(float(effect), 2),
                cross_separated=separated,
                ring_hist_peaks=int(len(peaks)),
                ring_hist_peak_positions=[round(float((edges[p] + edges[p + 1]) / 2), 3) for p in peaks],
                radial_profile_steps=int(len(step_idx)),
                radial_step_radii_px=[int(radii[i + 1]) for i in step_idx],
                ring_zone_p5_p95_range=round(zone_range, 4),
                local_cross_minus_disc=round(float(lx), 3),
                local_ring_hist_peaks=int(len(lpeaks)),
                local_radial_steps=int(len(lsteps)),
                local_radial_step_radii_px=[int(radii[i + 1]) for i in lsteps],
                swirl_minus_disc=round(stats["swirl"]["mean"] - d["mean"], 4),
                rays_minus_swirl=round(stats["rays"]["mean"] - stats["swirl"]["mean"], 4),
                radial_profile=[None if np.isnan(x) else round(float(x), 4) for x in prof])


class Timer:
    def __enter__(self):
        import torch
        torch.cuda.synchronize(); torch.cuda.reset_peak_memory_stats(); torch.cuda.empty_cache()
        self.t = time.perf_counter(); return self

    def __exit__(self, *a):
        import torch
        torch.cuda.synchronize()
        self.seconds = round(time.perf_counter() - self.t, 2)
        self.peak_mb = round(torch.cuda.max_memory_allocated() / 2**20, 1)
