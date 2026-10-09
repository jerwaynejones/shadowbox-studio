/* ============================================================================
 * Shadowbox Studio — morph.js
 * ----------------------------------------------------------------------------
 * Binary morphology on Uint8Array masks (0/1). This is the "make it cuttable"
 * stage: a laser can draw arbitrarily fine lines, but acrylic can't survive
 * arbitrarily fine features. Opening removes slivers thinner than the minimum
 * feature width; closing seals pinhole gaps; speck/hole filters drop debris
 * below a physical area threshold.
 *
 * All ops use a 3×3 structuring element iterated r times, which approximates
 * a disc of radius r well enough for fabrication purposes and keeps the code
 * dependency-free and fast.
 *
 * G2.10a (bonded-gated performance, NFR-03): dilate/erode compute the r-fold
 * iteration directly as one separable (2r+1)² square pass, O(w·h) for any r
 * (the iterated form cost 5.3 s at featR 8 on 1 Mpx × 8 layers). The result
 * is identical, borders included: dilation takes the window clipped to the
 * image; erosion keeps border pixels as they are (the iterated pass never
 * erodes them) and erodes an interior pixel iff its clipped window has an
 * empty pixel. The iterated forms stay as _dilateIter/_erodeIter (test
 * reference; test/golden/oldrun.json pins the v1.1.0 chain byte for byte).
 *
 * Speed round F4 (NFR-05): the window test reads the mask directly (run fill in
 * the row pass, word-skipping scan; fused column sweep), and SBMorph.openClose
 * fuses the dilations of open(r) → close(r2) into one dilate_{r+r2}; outputs
 * are byte-identical (test/oracle_kernels.js keeps the pre-F4 kernels).
 * ==========================================================================*/
(function (global) {
  "use strict";

  const M = {};

  /** One 3×3 dilation pass (8-connected). */
  function dilateOnce(src, dst, w, h) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        if (src[y * w + x]) { dst[y * w + x] = 1; continue; }
        let v = 0;
        const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
        for (let yy = y0; yy <= y1 && !v; yy++)
          for (let xx = x0; xx <= x1; xx++)
            if (src[yy * w + xx]) { v = 1; break; }
        dst[y * w + x] = v;
      }
    }
  }

  /** One 3×3 erosion pass (8-connected). Pixels beyond the border count as empty. */
  function erodeOnce(src, dst, w, h) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = src[y * w + x];
        if (v) {
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) v = 1; // keep border pixels stable
          else {
            outer: for (let yy = y - 1; yy <= y + 1; yy++)
              for (let xx = x - 1; xx <= x + 1; xx++)
                if (!src[yy * w + xx]) { v = 0; break outer; }
          }
        }
        dst[y * w + x] = v;
      }
    }
  }

  M._dilateIter = function (mask, w, h, r) {
    let a = mask.slice(), b = new Uint8Array(w * h);
    for (let i = 0; i < r; i++) { dilateOnce(a, b, w, h); [a, b] = [b, a]; }
    return a;
  };

  M._erodeIter = function (mask, w, h, r) {
    let a = mask.slice(), b = new Uint8Array(w * h);
    for (let i = 0; i < r; i++) { erodeOnce(a, b, w, h); [a, b] = [b, a]; }
    return a;
  };

  /**
   * Clipped (2r+1)² window test, separable, O(w·h) for any r. The indicator is `src[i] !== 0` (or `src[i] === 0` when
   * `invert`), read directly in the row pass (no indicator plane). Row pass (speed round F4): each indicator run [a, b)
   * marks [a − r, b + r) ∩ [0, w) in `mid` (a 0/1 plane, zeroed here), each byte written at most once per row. Column
   * pass: a sliding per-column count over rows [y − r, y + r] ∩ [0, h), split into head/body/tail row ranges so the
   * inner loops have no bounds tests. Without `erodeOf`: returns a 0/1 Uint8Array, 1 where the window holds ≥ 1
   * indicator pixel. With `erodeOf` (a copy of the mask, written in place and returned): interior pixels (not on the
   * 1-px border) whose window holds ≥ 1 indicator pixel are set to 0; the border keeps its values.
   */
  // First index i in [i, end) with src[i] !== 0 (nz) or src[i] === 0 (!nz), else end. When src is 4-byte aligned, whole
  // words are skipped: all-zero words when looking for a nonzero byte, zero-free words (no byte b with (b − 1) & ~b
  // & 0x80) when looking for a zero byte.
  function scanTo(src, w32, i, end, nz) {
    if (nz) {
      if (w32) { while (i < end && (i & 3)) { if (src[i] !== 0) return i; i++; } while (i + 4 <= end && w32[i >> 2] === 0) i += 4; }
      while (i < end && src[i] === 0) i++;
    } else {
      if (w32) {
        while (i < end && (i & 3)) { if (src[i] === 0) return i; i++; }
        while (i + 4 <= end) { const v = w32[i >> 2]; if (((v - 0x01010101) & ~v & 0x80808080) !== 0) break; i += 4; }
      }
      while (i < end && src[i] !== 0) i++;
    }
    return i;
  }

  function windowAny(src, w, h, r, invert, mid, erodeOf) {
    mid.fill(0);
    const w32 = src.byteOffset % 4 === 0 ? new Uint32Array(src.buffer, src.byteOffset, src.length >> 2) : null;
    for (let y = 0, o = 0; y < h; y++, o += w) {
      const end = o + w;
      let i = o, hi = o;                                      // mid[o .. hi) of this row is already marked
      while (i < end) {
        i = scanTo(src, w32, i, end, !invert);                // start of an indicator run
        if (i >= end) break;
        const a = i;
        i = scanTo(src, w32, i, end, invert);                 // its end
        const lo = a - r > hi ? a - r : hi, e = i + r < end ? i + r : end;
        if (e > lo) { mid.fill(1, lo, e); hi = e; }
      }
    }
    const out = erodeOf || new Uint8Array(w * h), cnt = new Int32Array(w);
    // cnt holds Σ mid over rows [y − r, y + r] ∩ [0, h) when row y is emitted
    const r0 = Math.min(h - 1, r);
    for (let y = 0; y <= r0; y++) { const a = y * w; for (let x = 0; x < w; x++) cnt[x] += mid[a + x]; }
    const emit = (y) => {
      const o = y * w;
      if (!erodeOf) { for (let x = 0; x < w; x++) out[o + x] = cnt[x] > 0 ? 1 : 0; return; }
      if (y === 0 || y === h - 1) return;
      for (let x = 1; x < w - 1; x++) if (cnt[x] > 0) out[o + x] = 0;
    };
    emit(0);
    // y in [1, h): adds row y + r while y + r < h, subtracts row y − r − 1 while y − r − 1 ≥ 0
    const addEnd = Math.max(1, h - r), subStart = r + 1;      // add for y < addEnd, subtract for y ≥ subStart
    const bothStart = Math.max(1, subStart), bothEnd = addEnd;
    let y = 1;
    for (; y < h && y < addEnd && y < subStart; y++) { const a = (y + r) * w; for (let x = 0; x < w; x++) cnt[x] += mid[a + x]; emit(y); }
    for (; y < bothEnd && y >= bothStart; y++) {                // body: add, subtract and emit in one sweep
      const a = (y + r) * w, b = (y - r - 1) * w, o = y * w;
      if (!erodeOf) for (let x = 0; x < w; x++) { const c = cnt[x] + mid[a + x] - mid[b + x]; cnt[x] = c; out[o + x] = c > 0 ? 1 : 0; }
      else {
        cnt[0] += mid[a] - mid[b];
        for (let x = 1; x < w - 1; x++) { const c = cnt[x] + mid[a + x] - mid[b + x]; cnt[x] = c; if (c > 0) out[o + x] = 0; }
        if (w > 1) cnt[w - 1] += mid[a + w - 1] - mid[b + w - 1];
      }
    }
    for (; y < h; y++) {
      if (y < addEnd) { const a = (y + r) * w; for (let x = 0; x < w; x++) cnt[x] += mid[a + x]; }
      else if (y >= subStart) { const b = (y - r - 1) * w; for (let x = 0; x < w; x++) cnt[x] -= mid[b + x]; }
      emit(y);
    }
    return out;
  }

  function dilateInto(mask, w, h, r, mid) { return r < 1 ? mask.slice() : windowAny(mask, w, h, r, false, mid, null); }
  function erodeInto(mask, w, h, r, mid) {
    const out = mask.slice();
    if (r < 1 || w < 3 || h < 3) return out;
    return windowAny(mask, w, h, r, true, mid, out);
  }

  M.dilate = (mask, w, h, r) => dilateInto(mask, w, h, r, r < 1 ? null : new Uint8Array(w * h));
  M.erode = (mask, w, h, r) => erodeInto(mask, w, h, r, r < 1 || w < 3 || h < 3 ? null : new Uint8Array(w * h));

  /** Opening = erode then dilate. Removes features thinner than ~2r px. */
  M.open = (mask, w, h, r) => (r < 1 ? mask.slice() : M.dilate(M.erode(mask, w, h, r), w, h, r));

  /** Closing = dilate then erode. Seals gaps/holes thinner than ~2r px. */
  M.close = (mask, w, h, r) => (r < 1 ? mask.slice() : M.erode(M.dilate(mask, w, h, r), w, h, r));

  /**
   * open(r) then close(r2), r, r2 ≥ 1, as erode_r → dilate_{r+r2} → erode_{r2} (speed round F4, one scratch plane).
   * Exact: the dilation is the clipped Chebyshev window, and for p, s in the rectangle with |p − s|∞ ≤ a + b a point q
   * of the rectangle with |p − q|∞ ≤ a and |q − s|∞ ≤ b exists per axis (between p and s), so dilate_a ∘ dilate_b =
   * dilate_{a+b}. Erosion is untouched (it never erodes the 1-px border either way).
   */
  M.openClose = function (mask, w, h, r, r2) {
    if (!(r >= 1 && r2 >= 1)) return M.close(M.open(mask, w, h, r), w, h, r2);
    const mid = new Uint8Array(w * h);
    return erodeInto(dilateInto(erodeInto(mask, w, h, r, mid), w, h, r + r2, mid), w, h, r2, mid);
  };

  /**
   * Label 4-connected components of `value` pixels.
   * @returns {{labels: Int32Array, count: number, areas: Int32Array,
   *            touchesBorder: Uint8Array}}
   *   labels: 0 = not part of any component, 1..count = component id
   */
  M.components = function (mask, w, h, value = 1) {
    const labels = new Int32Array(w * h);
    const queue = new Int32Array(w * h);
    const areas = [];
    const touches = [];
    let count = 0;
    for (let start = 0; start < mask.length; start++) {
      if (mask[start] !== value || labels[start]) continue;
      count++;
      let area = 0, touch = 0;
      let qh = 0, qt = 0;
      queue[qt++] = start; labels[start] = count;
      while (qh < qt) {
        const i = queue[qh++];
        area++;
        const x = i % w, y = (i / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch = 1;
        // 4-neighbours
        if (x > 0 && mask[i - 1] === value && !labels[i - 1]) { labels[i - 1] = count; queue[qt++] = i - 1; }
        if (x < w - 1 && mask[i + 1] === value && !labels[i + 1]) { labels[i + 1] = count; queue[qt++] = i + 1; }
        if (y > 0 && mask[i - w] === value && !labels[i - w]) { labels[i - w] = count; queue[qt++] = i - w; }
        if (y < h - 1 && mask[i + w] === value && !labels[i + w]) { labels[i + w] = count; queue[qt++] = i + w; }
      }
      areas.push(area); touches.push(touch);
    }
    return {
      labels, count,
      areas: Int32Array.from(areas),
      touchesBorder: Uint8Array.from(touches),
    };
  };

  /**
   * Remove filled components with area < minArea px². Returns removed count.
   * Mutates the mask in place.
   */
  M.removeSpecks = function (mask, w, h, minArea) {
    if (minArea <= 1) return 0;
    const { labels, count, areas } = M.components(mask, w, h, 1);
    const kill = new Uint8Array(count + 1);
    let removed = 0;
    for (let c = 1; c <= count; c++)
      if (areas[c - 1] < minArea) { kill[c] = 1; removed++; }
    if (removed)
      for (let i = 0; i < mask.length; i++)
        if (mask[i] && kill[labels[i]]) mask[i] = 0;
    return removed;
  };

  /**
   * Fill enclosed empty regions (holes) with area < minArea px².
   * Holes are empty components that do NOT touch the image border.
   * Mutates in place. Returns filled count.
   */
  M.fillHoles = function (mask, w, h, minArea) {
    if (minArea <= 1) return 0;
    const { labels, count, areas, touchesBorder } = M.components(mask, w, h, 0);
    const fill = new Uint8Array(count + 1);
    let filled = 0;
    for (let c = 1; c <= count; c++)
      if (!touchesBorder[c - 1] && areas[c - 1] < minArea) { fill[c] = 1; filled++; }
    if (filled)
      for (let i = 0; i < mask.length; i++)
        if (!mask[i] && fill[labels[i]]) mask[i] = 1;
    return filled;
  };

  global.SBMorph = M;
})(typeof window !== "undefined" ? window : globalThis);
