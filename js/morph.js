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
 *
 * Speed round F5 (NFR-05): fillHoles/removeSpecks label row runs with union-find (SBMorph.runComponents, shared with
 * construct.js) instead of a per-pixel BFS with Int32 label and queue planes; outputs byte-identical (oracle kept).
 *
 * Appendix G G1 (PO-FIX-1, G-D1): exact digital-disc morphology for bonded construction. discErode/discDilate(mask,
 * w, h, R2) use the disc {d : |d|² ≤ R2} (R2 an integer squared radius): a pixel survives erosion iff no background
 * pixel lies within R2 of it, and dilation sets a pixel iff some material pixel lies within R2. Pixels OUTSIDE the
 * image are neither material nor background: erosion never erodes from outside and dilation never adds from outside.
 * Unlike the square kernels above (which never touch the 1-px border ring), the disc erodes a border pixel when
 * interior background lies within R2 of it, so art touching the image edge is cleaned like interior art.
 * discOpenClose(mask, w, h, R2o, R2c) = erode_c(dilate_c(dilate_o(erode_o(mask)))): four windows, no fusion (a digital
 * disc ⊕ disc is not a disc). Each window: vertical distance to the nearest indicator per column (down and up sweeps,
 * capped at ⌊√R2⌋ + 1), then per row a left and a right "reach" sweep with hw[t] = ⌊√(R2 − t²)⌋. O(w·h) for any R2,
 * integer arithmetic only (NFR-05); 4-byte word sweeps for R2 < 15876, a byte/Uint16 plane beyond. Both are increasing,
 * so open/close keep nested masks nested (D-4.5). Output 0/1, input never mutated; R2 0 is the identity.
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
   * Appendix G G1 (PO-FIX-1, G-D1): exact digital-disc window. hit[p] = 1 iff some indicator pixel q (src[q] !== 0, or
   * src[q] === 0 when invert) has |p − q|² ≤ R2 (integer); pixels outside the image are never indicators. g = vertical
   * distance to the nearest indicator in p's column, capped at C = A + 1 (A = ⌊√R2⌋), from a down and an up row-major
   * sweep; hw[t] = max{a : a² ≤ R2 − t²} for t ≤ A, −1 beyond; per row, hit[x] iff ∃ q: |x − q| ≤ hw[g[q]], from a left
   * and a right "reach" sweep. O(w·h) for any R2; integer arithmetic only (NFR-05). Without erodeOf: returns out (0/1).
   * With erodeOf (a copy of the mask): sets erodeOf[p] = 0 where hit and returns it.
   */
  function discWindow(src, w, h, R2, invert, erodeOf) {
    let A = Math.floor(Math.sqrt(R2)); while (A * A > R2) A--; while ((A + 1) * (A + 1) <= R2) A++;
    const C = A + 1, n = w * h, g = C > 255 ? new Uint16Array(n) : new Uint8Array(n), hw = new Int32Array(C + 1).fill(-1);
    for (let t = 0; t <= A; t++) { const v = R2 - t * t; let a = Math.floor(Math.sqrt(v)); while (a * a > v) a--; while ((a + 1) * (a + 1) <= v) a++; hw[t] = a; }
    if (invert) {
      for (let i = 0; i < w && i < n; i++) g[i] = src[i] === 0 ? 0 : C;
      for (let i = w; i < n; i++) { if (src[i] === 0) g[i] = 0; else { const d = g[i - w] + 1; g[i] = d < C ? d : C; } }
    } else {
      for (let i = 0; i < w && i < n; i++) g[i] = src[i] !== 0 ? 0 : C;
      for (let i = w; i < n; i++) { if (src[i] !== 0) g[i] = 0; else { const d = g[i - w] + 1; g[i] = d < C ? d : C; } }
    }
    for (let i = n - w - 1; i >= 0; i--) { const d = g[i + w] + 1; if (d < g[i]) g[i] = d; }
    const out = erodeOf || new Uint8Array(n), reach = new Int32Array(w);
    for (let y = 0, o = 0; y < h; y++, o += w) {
      let r = -1;
      for (let x = 0; x < w; x++) { const v = hw[g[o + x]]; r = r - 1 > v ? r - 1 : v; reach[x] = r; }
      r = -1;
      if (!erodeOf) for (let x = w - 1; x >= 0; x--) { const v = hw[g[o + x]]; r = r - 1 > v ? r - 1 : v; out[o + x] = r >= 0 || reach[x] >= 0 ? 1 : 0; }
      else for (let x = w - 1; x >= 0; x--) { const v = hw[g[o + x]]; r = r - 1 > v ? r - 1 : v; if (r >= 0 || reach[x] >= 0) out[o + x] = 0; }
    }
    return out;
  }
  /** ⌊√v⌋ for a non-negative integer v, corrected so that a² ≤ v < (a + 1)² holds exactly. */
  function isqrt(v) { let a = Math.floor(Math.sqrt(v)); while (a * a > v) a--; while ((a + 1) * (a + 1) <= v) a++; return a; }

  /**
   * The same window as discWindow, for C = A + 1 ≤ 126 (R2 < 15876; the production radius is R2 = 64), with every plane in
   * 4-byte words (SWAR: all byte values stay ≤ 127, so no carry or borrow crosses a byte). g lives on a padded stride
   * wp = 4·⌈w/4⌉ whose padding columns are never indicators (g = C there, so they add nothing); each src row is copied
   * into an aligned row buffer first. Down sweep: g = indicator ? 0 : min(g_above + 1, C); up sweep: g = min(g, g_below + 1);
   * per row, the left and right reach sweeps skip words that are all C (no reach) or all 0 (indicators). The result is
   * written as 0/1 (dilation: hit; erosion: ¬hit, since every background pixel is its own hit). s: reusable scratch.
   */
  function discWindowSwar(src, w, h, A, hw, invert, out, s) {
    const C = A + 1, wp = (w + 3) & ~3, nw = wp >> 2, n = wp * h;
    if (!s.g || s.g.length < n) { s.g = new Uint8Array(n); s.g32 = new Uint32Array(s.g.buffer, 0, n >> 2); }
    if (!s.row || s.row.length < wp) { s.row = new Uint8Array(wp); s.row32 = new Uint32Array(s.row.buffer); s.hit = new Uint8Array(wp); s.hit32 = new Uint32Array(s.hit.buffer); }
    const g = s.g, g32 = s.g32, row = s.row, row32 = s.row32, hit = s.hit, hit32 = s.hit32;
    row.fill(invert ? 1 : 0, w, wp);                           // padding columns: never indicators
    const ONES = 0x01010101, HI = 0x80808080, LO7 = 0x7f7f7f7f, Cw = (C * ONES) >>> 0, C1w = ((C + 1) * ONES) | 0;
    // down sweep (row −1 counts as all C)
    for (let y = 0, o = 0, b = 0; y < h; y++, o += w, b += nw) {
      row.set(src.subarray(o, o + w));
      for (let j = 0; j < nw; j++) {
        const v = row32[j], nz = (((v & LO7) + LO7) | v) & HI;          // high bit of every nonzero byte
        const ind = invert ? ~nz & HI : nz;
        let t = (y ? g32[b - nw + j] : Cw) + ONES;                       // bytes ≤ C + 1 ≤ 127
        const x = t ^ C1w, eq = ~((((x & LO7) + LO7) | x) & HI) & HI;    // high bit where the byte is C + 1
        t -= eq >>> 7;                                                   // saturate at C
        g32[b + j] = t & ~((ind >>> 7) * 0xff);
      }
    }
    // up sweep: g = min(g, g_below + 1)
    for (let b = (h - 2) * nw; b >= 0; b -= nw) {
      for (let j = 0; j < nw; j++) {
        const a = g32[b + j], c = g32[b + nw + j] + ONES;
        if (a === Cw && c === Cw + ONES) continue;
        const m = ((((a | HI) - c) & HI) >>> 7) * 0xff;                  // 0xff where a ≥ c
        g32[b + j] = (c & m) | (a & ~m);
      }
    }
    // per row: hit[x] iff ∃ q: |x − q| ≤ hw[g[q]] (left and right reach sweeps)
    for (let y = 0, o = 0, b = 0; y < h; y++, o += w, b += nw) {
      const go = b << 2;
      let r = -1;
      for (let j = 0; j < nw; j++) {
        const v = g32[b + j];
        if (v === 0) { hit32[j] = ONES; r = A; continue; }
        if (v === Cw && r <= 0) { hit32[j] = 0; r = -1; continue; }
        for (let x = j << 2, e = x + 4; x < e; x++) { const q = hw[g[go + x]]; r = r - 1 > q ? r - 1 : q; hit[x] = r >= 0 ? 1 : 0; }
      }
      r = -1;
      for (let j = nw - 1; j >= 0; j--) {
        const v = g32[b + j];
        if (v === 0) { r = A; continue; }
        if (v === Cw && r <= 0) { r = -1; continue; }
        for (let x = (j << 2) + 3, e = j << 2; x >= e; x--) { const q = hw[g[go + x]]; r = r - 1 > q ? r - 1 : q; if (r >= 0) hit[x] = 1; }
      }
      if (invert) for (let j = 0; j < nw; j++) hit32[j] ^= ONES;
      out.set(hit.subarray(0, w), o);
    }
    return out;
  }

  /** One disc window for erosion (invert) or dilation, R2 ≥ 1; s: scratch reused across calls (discOpenClose). */
  function discOp(mask, w, h, R2, invert, s) {
    const A = isqrt(R2);
    if (A + 1 > 126) return discWindow(mask, w, h, R2, invert, invert ? mask.slice() : null);
    const hw = new Int32Array(A + 2).fill(-1);
    for (let t = 0; t <= A; t++) hw[t] = isqrt(R2 - t * t);
    return discWindowSwar(mask, w, h, A, hw, invert, new Uint8Array(w * h), s);
  }

  M.discErode = (mask, w, h, R2) => (R2 < 1 ? mask.slice() : discOp(mask, w, h, R2, true, {}));
  M.discDilate = (mask, w, h, R2) => (R2 < 1 ? Uint8Array.from(mask, (v) => (v ? 1 : 0)) : discOp(mask, w, h, R2, false, {}));
  M.discOpenClose = function (mask, w, h, R2o, R2c) {
    if (!(R2o >= 1 && R2c >= 1)) return M.discErode(M.discDilate(M.discDilate(M.discErode(mask, w, h, R2o), w, h, R2o), w, h, R2c), w, h, R2c);
    const s = {};   // one scratch (g plane, row buffers) for the four windows
    return discOp(discOp(discOp(discOp(mask, w, h, R2o, true, s), w, h, R2o, false, s), w, h, R2c, false, s), w, h, R2c, true, s);
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
   * 4-connected components of the `value` pixels by row runs and union-find (speed round F5; moved from construct.js).
   * value 0: pixels === 0; value 1: nonzero pixels (construct's contract). Returns {count, n, find, Y, X0, X1}: n runs as
   * parallel Int32Arrays (row y, half-open [x0, x1)), find(run) → the component's representative run (the lowest run
   * index of the component), count = number of components. Runs are found with the word-skipping scanTo.
   */
  M.runComponents = function (mask, w, h, value) {
    const nz = value !== 0;
    let cap = 1024, Y = new Int32Array(cap), X0 = new Int32Array(cap), X1 = new Int32Array(cap), P = new Int32Array(cap), n = 0, unions = 0;
    const grow = () => { cap *= 2; const g = (a) => { const b = new Int32Array(cap); b.set(a); return b; }; Y = g(Y); X0 = g(X0); X1 = g(X1); P = g(P); };
    const find = (i) => { while (P[i] !== i) { P[i] = P[P[i]]; i = P[i]; } return i; };
    const w32 = mask.byteOffset % 4 === 0 ? new Uint32Array(mask.buffer, mask.byteOffset, mask.length >> 2) : null;
    let prevStart = 0, prevEnd = 0;
    for (let y = 0, o = 0; y < h; y++, o += w) {
      const rowStart = n, end = o + w;
      let j = prevStart, i = o;
      while (i < end) {
        i = scanTo(mask, w32, i, end, nz);                   // start of a run
        if (i >= end) break;
        const x0 = i - o;
        i = scanTo(mask, w32, i, end, !nz);                  // its end
        const x1 = i - o;
        if (n === cap) grow();
        Y[n] = y; X0[n] = x0; X1[n] = x1; P[n] = n;
        // runs of the previous row that overlap [x0, x1) (4-connectivity: shared column)
        while (j < prevEnd && X1[j] <= x0) j++;
        for (let q = j; q < prevEnd && X0[q] < x1; q++) { const a = find(q), b = find(n); if (a !== b) { if (a < b) P[b] = a; else P[a] = b; unions++; } }
        n++;
      }
      prevStart = rowStart; prevEnd = n;
    }
    return { count: n - unions, n, find, Y, X0, X1 };
  };

  // true iff every byte is 0 or 1 (whole aligned words tested at once)
  function isBinary(mask) {
    let i = 0;
    const n = mask.length;
    if (mask.byteOffset % 4 === 0) {
      const w32 = new Uint32Array(mask.buffer, mask.byteOffset, n >> 2);
      for (let q = 0; q < w32.length; q++) if (w32[q] & 0xfefefefe) return false;
      i = w32.length << 2;
    }
    for (; i < n; i++) if (mask[i] > 1) return false;
    return true;
  }

  /**
   * Per component of rc: area (Σ run lengths, at the root run) and whether a run touches the image border (row 0 or
   * h − 1, x0 = 0 or x1 = w). Each component with pick(area, touch) is selected; its runs are filled
   * with `fillValue`. Returns the number of selected components.
   */
  function selectRuns(mask, w, h, rc, pick, fillValue) {
    const { n, find, Y, X0, X1 } = rc, area = new Float64Array(n), touch = new Uint8Array(n), root = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const r = find(i);
      root[i] = r; area[r] += X1[i] - X0[i];
      if (Y[i] === 0 || Y[i] === h - 1 || X0[i] === 0 || X1[i] === w) touch[r] = 1;
    }
    const sel = new Uint8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) if (root[i] === i && pick(area[i], touch[i])) { sel[i] = 1; count++; }
    if (count) for (let i = 0; i < n; i++) if (sel[root[i]]) mask.fill(fillValue, Y[i] * w + X0[i], Y[i] * w + X1[i]);
    return count;
  }

  /**
   * Remove filled components with area < minArea px². Returns removed count.
   * Mutates the mask in place. Speed round F5: by row runs (SBMorph.runComponents), no per-pixel label plane. The
   * labelled pixels are those === 1; a mask holding other nonzero bytes takes the pixel-labelling path (M.components).
   */
  M.removeSpecks = function (mask, w, h, minArea) {
    if (minArea <= 1) return 0;
    if (!isBinary(mask)) {
      const { labels, count, areas } = M.components(mask, w, h, 1);
      const kill = new Uint8Array(count + 1);
      let removed = 0;
      for (let c = 1; c <= count; c++)
        if (areas[c - 1] < minArea) { kill[c] = 1; removed++; }
      if (removed)
        for (let i = 0; i < mask.length; i++)
          if (mask[i] && kill[labels[i]]) mask[i] = 0;
      return removed;
    }
    return selectRuns(mask, w, h, M.runComponents(mask, w, h, 1), (area) => area < minArea, 0);
  };

  /**
   * Fill enclosed empty regions (holes) with area < minArea px².
   * Holes are empty components that do NOT touch the image border.
   * Mutates in place. Returns filled count. Speed round F5: by row runs of 0 (SBMorph.runComponents).
   */
  M.fillHoles = function (mask, w, h, minArea) {
    if (minArea <= 1) return 0;
    return selectRuns(mask, w, h, M.runComponents(mask, w, h, 0), (area, touch) => !touch && area < minArea, 1);
  };

  global.SBMorph = M;
})(typeof window !== "undefined" ? window : globalThis);
