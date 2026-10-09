/* ============================================================================
 * Shadowbox Studio — raster.js
 * ----------------------------------------------------------------------------
 * Grayscale raster pipeline: the "cartoonize" half of the tool.
 *
 *   photo ─▶ luminance ─▶ Kuwahara filter ─▶ threshold banding ─▶ N bands
 *
 * The Kuwahara filter is the key trick: it is an edge-preserving smoother
 * that flattens texture into paint-like patches while keeping hard edges,
 * which is exactly the look you want before posterizing for laser layers.
 * We implement it with summed-area tables so it runs in O(pixels) regardless
 * of radius — fast enough to be interactive on a phone.
 *
 * G2.0 adds the pure, integer-only raster contract (NFR-05, PO-LASER-4/5):
 *   SBRaster.resample(px, c, w, h, W, H, "none"|"nearest"|"area")  never upsamples
 *   SBRaster.rasterSize(srcW, srcH, targetLong)   draft (720 px long side)
 *   SBRaster.fabRaster({artWUm, artHUm, srcW, srcH, targetPitchUm, pxBudget})
 *   SBRaster.scaleUm, resamplePolicy, cacheKey, fabDiagnostics
 * Errors carry e.code: RESAMPLE_UPSAMPLE, RESAMPLE_SIZE, RESAMPLE_METHOD, RASTER_ARG.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const R = {};

  /**
   * Extract perceptual luminance (Rec.709) from RGBA image data.
   * @param {Uint8ClampedArray} rgba  - source pixels (w*h*4)
   * @returns {Float32Array} luminance 0..255
   */
  R.luminance = function (rgba, w, h) {
    const L = new Float32Array(w * h);
    for (let i = 0, p = 0; i < L.length; i++, p += 4) {
      L[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    }
    return L;
  };

  /**
   * Classic 4-quadrant Kuwahara filter, accelerated with summed-area tables.
   * For each pixel we consider the four (r+1)x(r+1) windows that have the
   * pixel at a corner, and output the mean of the window with the lowest
   * variance. Result: flat painterly regions, crisp edges.
   *
   * @param {Float32Array} src  luminance
   * @param {number} r          window radius in px (>=1)
   * @param {number} passes     number of applications (2 = stronger cartoon)
   */
  R.kuwahara = function (src, w, h, r, passes = 1, domain = null) {
    if (r < 1 || passes < 1) return src.slice();
    let cur = src;
    for (let p = 0; p < passes; p++) cur = domain ? kuwaharaDomainOnce(cur, w, h, r, domain) : kuwaharaOnce(cur, w, h, r);
    return cur;
  };

  // G2.4 (IMG-04): the domain-aware variant. Window statistics use only
  // in-domain samples (count table instead of the window area); out-of-domain
  // pixels are copied unchanged and never influence an in-domain result. An
  // in-domain pixel is in all four of its own windows, so every n ≥ 1. With an
  // all-ones domain the arithmetic is the same as kuwaharaOnce, value for value.
  function kuwaharaDomainOnce(src, w, h, r, domain) {
    const W = w + 1, H = h + 1;
    const sat = new Float64Array(W * H), sat2 = new Float64Array(W * H), cnt = new Float64Array(W * H);
    for (let y = 0; y < h; y++) {
      let row = 0, row2 = 0, rowN = 0;
      for (let x = 0; x < w; x++) {
        if (domain[y * w + x]) { const v = src[y * w + x]; row += v; row2 += v * v; rowN++; }
        const i = (y + 1) * W + (x + 1);
        sat[i] = sat[i - W] + row; sat2[i] = sat2[i - W] + row2; cnt[i] = cnt[i - W] + rowN;
      }
    }
    const boxSum = (T, x0, y0, x1, y1) =>
      T[y1 * W + x1] - T[y0 * W + x1] - T[y1 * W + x0] + T[y0 * W + x0];
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!domain[idx]) { out[idx] = src[idx]; continue; }
        let bestVar = Infinity, bestMean = src[idx];
        for (let q = 0; q < 4; q++) {
          const x0 = SBUtilClampI(q & 1 ? x : x - r, 0, w);
          const x1 = SBUtilClampI((q & 1 ? x + r : x) + 1, 0, w);
          const y0 = SBUtilClampI(q & 2 ? y : y - r, 0, h);
          const y1 = SBUtilClampI((q & 2 ? y + r : y) + 1, 0, h);
          const n = boxSum(cnt, x0, y0, x1, y1);
          if (n <= 0) continue;
          const mean = boxSum(sat, x0, y0, x1, y1) / n;
          const variance = boxSum(sat2, x0, y0, x1, y1) / n - mean * mean;
          if (variance < bestVar) { bestVar = variance; bestMean = mean; }
        }
        out[idx] = bestMean;
      }
    }
    return out;
  }

  function kuwaharaOnce(src, w, h, r) {
    const W = w + 1, H = h + 1;
    // Summed-area tables of value and value² (Float64 to avoid precision drift).
    const sat = new Float64Array(W * H);
    const sat2 = new Float64Array(W * H);
    for (let y = 0; y < h; y++) {
      let row = 0, row2 = 0;
      for (let x = 0; x < w; x++) {
        const v = src[y * w + x];
        row += v; row2 += v * v;
        const i = (y + 1) * W + (x + 1);
        sat[i] = sat[i - W] + row;
        sat2[i] = sat2[i - W] + row2;
      }
    }
    // Window sum in [x0,x1) x [y0,y1) via inclusion–exclusion.
    const boxSum = (T, x0, y0, x1, y1) =>
      T[y1 * W + x1] - T[y0 * W + x1] - T[y1 * W + x0] + T[y0 * W + x0];

    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let bestVar = Infinity, bestMean = src[y * w + x];
        // Four quadrant windows anchored at (x,y).
        for (let q = 0; q < 4; q++) {
          const x0 = SBUtilClampI(q & 1 ? x : x - r, 0, w);
          const x1 = SBUtilClampI((q & 1 ? x + r : x) + 1, 0, w);
          const y0 = SBUtilClampI(q & 2 ? y : y - r, 0, h);
          const y1 = SBUtilClampI((q & 2 ? y + r : y) + 1, 0, h);
          const n = (x1 - x0) * (y1 - y0);
          if (n <= 0) continue;
          const s = boxSum(sat, x0, y0, x1, y1);
          const s2 = boxSum(sat2, x0, y0, x1, y1);
          const mean = s / n;
          const variance = s2 / n - mean * mean;
          if (variance < bestVar) { bestVar = variance; bestMean = mean; }
        }
        out[y * w + x] = bestMean;
      }
    }
    return out;
  }

  function SBUtilClampI(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  /**
   * Compute N-1 ascending thresholds over the luminance histogram.
   * @param {"balanced"|"linear"|"manual"} mode
   *   balanced — percentile split: every band covers ~equal pixel area
   *   linear   — equal luminance spacing between the 2nd/98th percentiles
   *   manual   — opts.manual: N-1 normalized values in [0,1], non-decreasing,
   *              multiplied by 255 (LYR-03; descending → THRESHOLD_ORDER)
   * Any other mode keeps the v1.1.0 fallback to balanced (DEP-04).
   * @param {{manual?: number[], domain?: Uint8Array|null}} [opts]
   *   domain — when given, the histogram and percentiles use only in-domain
   *   pixels (IMG-04); out-of-domain samples never move a threshold.
   * @returns {number[]} thresholds, carrying `emptyBands`: the band indices
   *   (0..N-1, per R.bands) with no in-domain pixel (IMG-06, AT-04).
   * With domain null every threshold is identical to v1.1.0 (golden T0.4).
   */
  R.thresholds = function (L, nBands, mode, opts) {
    const o = opts || {}, domain = o.domain || null;
    if (domain && domain.length !== L.length) throw rfail("THRESHOLD_ARG", "domain length " + domain.length + " != " + L.length);
    const t = [];
    if (mode === "manual") {
      const m = o.manual;
      if (!Array.isArray(m) && !ArrayBuffer.isView(m)) throw rfail("THRESHOLD_ARG", "manual mode needs opts.manual");
      if (m.length !== Math.max(0, nBands - 1)) throw rfail("THRESHOLD_ARG", "manual needs " + (nBands - 1) + " values, got " + m.length);
      for (let k = 0; k < m.length; k++) {
        const v = m[k];
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw rfail("THRESHOLD_ARG", "manual[" + k + "] must be in [0,1]");
        if (k > 0 && v < m[k - 1]) throw rfail("THRESHOLD_ORDER", "manual thresholds must be non-decreasing (index " + k + ")");
        t.push(v * 255);
      }
    } else {
      const hist = new Float64Array(256);
      let total = 0;
      if (domain) { for (let i = 0; i < L.length; i++) if (domain[i]) { hist[Math.round(SBUtilClampI(L[i], 0, 255))]++; total++; } }
      else { for (let i = 0; i < L.length; i++) hist[Math.round(SBUtilClampI(L[i], 0, 255))]++; total = L.length; }
      // cumulative
      const cum = new Float64Array(257);
      for (let i = 0; i < 256; i++) cum[i + 1] = cum[i] + hist[i];

      const pct = (p) => { // value at percentile p (0..1)
        const target = p * total;
        for (let i = 0; i < 256; i++) if (cum[i + 1] >= target) return i;
        return 255;
      };

      if (mode === "linear") {
        const lo = pct(0.02), hi = Math.max(pct(0.98), lo + nBands);
        for (let k = 1; k < nBands; k++) t.push(lo + ((hi - lo) * k) / nBands);
      } else {
        for (let k = 1; k < nBands; k++) t.push(pct(k / nBands) + 0.5);
      }
    }
    // IMG-06 / AT-04: surface bands without in-domain pixels (flat input,
    // duplicate thresholds, empty domain). Uses the same rule as R.bands.
    const counts = new Float64Array(Math.max(1, nBands));
    for (let i = 0; i < L.length; i++) {
      if (domain && !domain[i]) continue;
      const v = L[i];
      let b = 0;
      while (b < t.length && v >= t[b]) b++;
      counts[b]++;
    }
    t.emptyBands = [];
    for (let b = 0; b < Math.max(1, nBands); b++) if (counts[b] === 0) t.emptyBands.push(b);
    return t;
  };

  /**
   * Assign each pixel to a brightness band. Band 0 = darkest.
   * @returns {Uint8Array} band index per pixel (0..nBands-1)
   */
  R.bands = function (L, thresholds) {
    const out = new Uint8Array(L.length);
    for (let i = 0; i < L.length; i++) {
      const v = L[i];
      let b = 0;
      while (b < thresholds.length && v >= thresholds[b]) b++;
      out[i] = b;
    }
    return out;
  };

  /**
   * Build the nested sheet masks from the band map.
   * Sheets are ordered back(0) → front(N-1). Sheet 0 is the solid backing.
   * With darkFront=true (default), the front sheet carries only the darkest
   * band, so dark tones sit closest to the viewer — the classic layered look.
   *
   * Masks are nested by construction (sheet k ⊇ sheet k+1), which is what
   * lets the physical stack read as a continuous image.
   *
   * @returns {Uint8Array[]} one 0/1 mask per sheet
   */
  R.sheetMasks = function (bandMap, nBands, w, h, darkFront) {
    // G2.4: the tonal path behind the height interface (D-4.4). Byte-identical
    // to v1.1.0 (golden test/golden/sheetmasks.json; G2.3 equivalence check).
    return SBHeight.cumulativeMasks(SBHeight.tonalAdded(bandMap, nBands, darkFront), null, nBands, w, h);
  };


  /* --------------------------------------------------------------------------
   * G2.0 — deterministic resampling and the raster contract
   * (IMG-02/03, GEO-06, NFR-05, PO-LASER-4/5)
   *
   * Everything below is pure and integer-only (NFR-05): index math uses exact
   * integer division (a − a mod b) / b, never a float scale; the only
   * transcendental-free helper used is Math.sqrt for a lower bound that is
   * then corrected by stepping. The engine never upsamples: any request for a
   * larger raster than the source throws RESAMPLE_UPSAMPLE.
   * ------------------------------------------------------------------------*/
  function rfail(code, msg) { const e = new Error(code + (msg ? ": " + msg : "")); e.code = code; return e; }
  const isPosInt = (v) => Number.isSafeInteger(v) && v > 0;
  const idiv = (a, b) => (a - (a % b)) / b;                 // floor(a / b), a ≥ 0, b > 0, exact
  const cdiv = (a, b) => idiv(a + b - 1, b);                // ceil(a / b), a ≥ 0, b > 0, exact
  const halfUp = (n, d) => idiv(2 * n + d, 2 * d);          // round(n / d) half up, n ≥ 0, d > 0
  const METHODS = ["none", "nearest", "area"];

  // Per destination index: the source spans and integer overlap weights of the
  // box [X·n, (X+1)·n) on the scaled axis where source i spans [i·N, (i+1)·N).
  // The weights of one destination index sum to n.
  function areaSpans(n, N) {
    const start = new Int32Array(N), count = new Int32Array(N), idx = [], wt = [];
    for (let X = 0; X < N; X++) {
      const a = X * n, b = a + n, i0 = idiv(a, N), i1 = cdiv(b, N);
      start[X] = idx.length; count[X] = i1 - i0;
      for (let i = i0; i < i1; i++) { idx.push(i); wt.push(Math.min(b, (i + 1) * N) - Math.max(a, i * N)); }
    }
    return { start, count, idx: Int32Array.from(idx), wt: Float64Array.from(wt) };
  }

  // F3 area kernels (module-level, so each keeps one optimised call target). The horizontal spans are padded to a
  // fixed width m (the largest span): span X reads source samples i0[X] … i0[X]+m−1 with weights pw[X·m …], the
  // padding weights being 0. Every product and partial sum is a non-negative integer ≤ 255·w < 2^53, so adding the
  // exact zeros and summing in this order gives the same doubles as the pre-F3 loop (a = 0; a += px·wt, j ascending).
  // A fixed trip count (unrolled for m ≤ 3) avoids the per-span branch mispredictions of variable 1–3 term loops.
  function padSpans(sp, n, N) {
    let m = 1;
    for (let X = 0; X < N; X++) if (sp.count[X] > m) m = sp.count[X];
    const i0 = new Int32Array(N), pw = new Float64Array(N * m);
    for (let X = 0; X < N; X++) {
      const s0 = sp.start[X], cnt = sp.count[X], b = Math.min(sp.idx[s0], n - m);
      i0[X] = b;
      for (let j = 0; j < cnt; j++) pw[X * m + sp.idx[s0 + j] - b] = sp.wt[s0 + j];
    }
    return { m, i0, pw };
  }
  // hsumRow*: the horizontal integer sums of one source row starting at sample `src` into dst (W·c).
  function hsumRow1(pixels, src, W, hp, dst) {
    const m = hp.m, i0 = hp.i0, pw = hp.pw;
    if (m === 2) { for (let X = 0, q = 0; X < W; X++, q += 2) { const p = src + i0[X]; dst[X] = pixels[p] * pw[q] + pixels[p + 1] * pw[q + 1]; } return; }
    if (m === 3) { for (let X = 0, q = 0; X < W; X++, q += 3) { const p = src + i0[X]; dst[X] = pixels[p] * pw[q] + pixels[p + 1] * pw[q + 1] + pixels[p + 2] * pw[q + 2]; } return; }
    for (let X = 0, q = 0; X < W; X++, q += m) {
      const p = src + i0[X];
      let a = pixels[p] * pw[q];
      for (let j = 1; j < m; j++) a += pixels[p + j] * pw[q + j];
      dst[X] = a;
    }
  }
  function hsumRow4(pixels, src, W, hp, dst) {
    const m = hp.m, i0 = hp.i0, pw = hp.pw;
    if (m === 2) {
      for (let X = 0, q = 0, d = 0; X < W; X++, q += 2, d += 4) {
        const p = src + i0[X] * 4, f0 = pw[q], f1 = pw[q + 1];
        dst[d] = pixels[p] * f0 + pixels[p + 4] * f1; dst[d + 1] = pixels[p + 1] * f0 + pixels[p + 5] * f1;
        dst[d + 2] = pixels[p + 2] * f0 + pixels[p + 6] * f1; dst[d + 3] = pixels[p + 3] * f0 + pixels[p + 7] * f1;
      }
      return;
    }
    if (m === 3) {
      for (let X = 0, q = 0, d = 0; X < W; X++, q += 3, d += 4) {
        const p = src + i0[X] * 4, f0 = pw[q], f1 = pw[q + 1], f2 = pw[q + 2];
        dst[d] = pixels[p] * f0 + pixels[p + 4] * f1 + pixels[p + 8] * f2;
        dst[d + 1] = pixels[p + 1] * f0 + pixels[p + 5] * f1 + pixels[p + 9] * f2;
        dst[d + 2] = pixels[p + 2] * f0 + pixels[p + 6] * f1 + pixels[p + 10] * f2;
        dst[d + 3] = pixels[p + 3] * f0 + pixels[p + 7] * f1 + pixels[p + 11] * f2;
      }
      return;
    }
    for (let X = 0, q = 0, d = 0; X < W; X++, q += m, d += 4) {
      let p = src + i0[X] * 4, f = pw[q];
      let a0 = pixels[p] * f, a1 = pixels[p + 1] * f, a2 = pixels[p + 2] * f, a3 = pixels[p + 3] * f;
      for (let j = 1; j < m; j++) {
        p += 4; f = pw[q + j];
        a0 += pixels[p] * f; a1 += pixels[p + 1] * f; a2 += pixels[p + 2] * f; a3 += pixels[p + 3] * f;
      }
      dst[d] = a0; dst[d + 1] = a1; dst[d + 2] = a2; dst[d + 3] = a3;
    }
  }
  function hsumRowN(pixels, src, W, hp, dst, c) {
    const m = hp.m, i0 = hp.i0, pw = hp.pw;
    for (let X = 0, q = 0; X < W; X++, q += m) {
      const d = X * c, p0 = src + i0[X] * c;
      for (let k = 0; k < c; k++) {
        let p = p0 + k, a = pixels[p] * pw[q];
        for (let j = 1; j < m; j++) { p += c; a += pixels[p] * pw[q + j]; }
        dst[d + k] = a;
      }
    }
  }
  // One vertical term j of n for an output row: acc = 0; acc += row·f, j ascending (the first term is stored, since
  // 0 + x === x for x ≥ 0), and the last term is rounded half up into out. halfUp(v, D) = floor((2v + D) / 2D) with
  // integer N = 2v + D ≤ 511·D. If N/2D = k − ε is not an integer then ε ≥ 1/2D and k·2D ≤ N + 2D ≤ 512·D, so the
  // relative gap ε/k ≥ 1/(512·D) exceeds the 2^−53 rounding bound while 512·D < 2^53: the correctly rounded double
  // quotient never reaches k and Math.floor of it is the exact integer division (fastRound); otherwise halfUp is used.
  // Returns the next output index.
  function vfold(row, f, j, n, acc, out, o, Wc, D, D2, fastRound) {
    if (j < n - 1) {
      if (j === 0) for (let i = 0; i < Wc; i++) acc[i] = row[i] * f;
      else for (let i = 0; i < Wc; i++) acc[i] += row[i] * f;
      return o;
    }
    if (fastRound) {
      if (j === 0) for (let i = 0; i < Wc; i++) out[o++] = Math.floor((2 * (row[i] * f) + D) / D2);
      else for (let i = 0; i < Wc; i++) out[o++] = Math.floor((2 * (acc[i] + row[i] * f) + D) / D2);
    } else {
      if (j === 0) for (let i = 0; i < Wc; i++) out[o++] = halfUp(row[i] * f, D);
      else for (let i = 0; i < Wc; i++) out[o++] = halfUp(acc[i] + row[i] * f, D);
    }
    return o;
  }

  /**
   * Resample interleaved 8-bit samples from w×h to W×H. Never upsamples.
   *   none    — identity (W×H must equal w×h); returns a copy.
   *   nearest — sx = floor((2x+1)·w / (2W)); picks existing values only (IMG-03).
   *   area    — exact integer box average per channel, rounded half up.
   * resampleRows returns only output rows [Y0, Y1) (a row band, speed round F3); resample = resampleRows(…, 0, H).
   * Bands concatenated in order are byte-equal to the whole.
   * @returns {Uint8Array} (Y1−Y0)·W·channels samples
   */
  R.resampleRows = function (pixels, channels, w, h, W, H, method, Y0, Y1) {
    if (!METHODS.includes(method)) throw rfail("RESAMPLE_METHOD", "method must be none|nearest|area (got " + method + ")");
    if (![1, 2, 3, 4].includes(channels)) throw rfail("RESAMPLE_SIZE", "channels must be 1..4");
    if (![w, h, W, H].every(isPosInt)) throw rfail("RESAMPLE_SIZE", "sizes must be positive integers");
    if (!pixels || pixels.length < w * h * channels) throw rfail("RESAMPLE_SIZE", "pixel buffer shorter than w·h·channels");
    if (W > w || H > h) throw rfail("RESAMPLE_UPSAMPLE", W + "×" + H + " is larger than the " + w + "×" + h + " source");
    if (!Number.isSafeInteger(Y0) || !Number.isSafeInteger(Y1) || Y0 < 0 || Y0 > Y1 || Y1 > H)
      throw rfail("RESAMPLE_SIZE", "row band [" + Y0 + ", " + Y1 + ") must lie within [0, " + H + "]");
    const c = channels, Wc = W * c;
    if (method === "none" || (W === w && H === h)) {
      if (W !== w || H !== h) throw rfail("RESAMPLE_SIZE", "method none requires the source size");
      return Uint8Array.from(pixels.subarray ? pixels.subarray(Y0 * w * c, Y1 * w * c) : pixels.slice(Y0 * w * c, Y1 * w * c));
    }
    const out = new Uint8Array((Y1 - Y0) * Wc);
    if (method === "nearest") {
      const sx = new Int32Array(W);
      for (let x = 0; x < W; x++) sx[x] = idiv((2 * x + 1) * w, 2 * W);
      for (let y = Y0, o = 0; y < Y1; y++) {
        const row = idiv((2 * y + 1) * h, 2 * H) * w;
        for (let x = 0; x < W; x++) { const s = (row + sx[x]) * c; for (let k = 0; k < c; k++) out[o++] = pixels[s + k]; }
      }
      return out;
    }
    // area, streamed: output row Y needs the horizontal integer sums (≤ 255·w) of only its vy source rows, weighted
    // and summed vertically (≤ 255·w·h). Every term is an integer < 2^53, so each double is exact and the summation
    // order cannot change a bit; the per-element operation order (acc = 0; acc += row·wt, j ascending) is also the
    // pre-F3 one. Because upsampling is rejected, consecutive output rows share at most their boundary source row,
    // so a one-row cache (the last source row of the previous output row) is the whole LRU.
    const hp = padSpans(areaSpans(w, W), w, W), vy = areaSpans(h, H), D = w * h;
    const acc = new Float64Array(Wc);
    let keep = new Float64Array(Wc), spare = new Float64Array(Wc), keepIdx = -1;
    const scratch = new Float64Array(Wc);
    const hsum = c === 4 ? hsumRow4 : c === 1 ? hsumRow1 : hsumRowN;
    const D2 = 2 * D, fastRound = 512 * D <= Number.MAX_SAFE_INTEGER;
    let o = 0;
    for (let Y = Y0; Y < Y1; Y++) {
      const s0 = vy.start[Y], n = vy.count[Y];
      for (let j = 0; j < n; j++) {
        const y = vy.idx[s0 + j], f = vy.wt[s0 + j];
        let row;
        if (y === keepIdx) row = keep;
        else if (j === n - 1) { hsum(pixels, y * w * c, W, hp, spare, c); const t = keep; keep = spare; spare = t; keepIdx = y; row = keep; }
        else { hsum(pixels, y * w * c, W, hp, scratch, c); row = scratch; }
        o = vfold(row, f, j, n, acc, out, o, Wc, D, D2, fastRound);
      }
    }
    return out;
  };

  R.resample = function (pixels, channels, w, h, W, H, method) {
    return R.resampleRows(pixels, channels, w, h, W, H, method, 0, isPosInt(H) ? H : 0);
  };

  /**
   * Draft raster size (LYR-06): long side targetLong, never larger than the
   * source; the short side is rounded half up in integers (≥ 1).
   * `capped` is true when targetLong exceeded the source's long side.
   */
  R.rasterSize = function (srcW, srcH, targetLong) {
    if (![srcW, srcH, targetLong].every(isPosInt)) throw rfail("RASTER_ARG", "rasterSize needs positive integers");
    const L = Math.max(srcW, srcH);
    if (targetLong >= L) return { W: srcW, H: srcH, capped: targetLong > L };
    const short = (s) => Math.max(1, halfUp(s * targetLong, L));
    return srcW >= srcH ? { W: targetLong, H: short(srcH), capped: false } : { W: short(srcW), H: targetLong, capped: false };
  };

  /**
   * Fabrication raster from the physical size (PO-LASER-4/5). Integer-only.
   *  1. W0 = ceil(artWUm / p), H0 = ceil(artHUm / p) with p = targetPitchUm.
   *  2. Budget: if W0·H0 > pxBudget, p becomes the smallest integer ≥ target
   *     with ceil(artWUm/p)·ceil(artHUm/p) ≤ pxBudget  → capped ∋ "budget".
   *  3. Source: W = min(W1, srcW), H = min(H1, srcH) (never upsample)
   *     → capped ∋ "source", shortPx = [max(0, W1−srcW), max(0, H1−srcH)].
   * mm/px is always reported from the real raster (SBRaster.scaleUm).
   */
  R.fabRaster = function (o) {
    o = o || {};
    const { artWUm, artHUm, srcW, srcH, targetPitchUm, pxBudget } = o;
    for (const [k, v] of Object.entries({ artWUm, artHUm, srcW, srcH, targetPitchUm, pxBudget }))
      if (!isPosInt(v)) throw rfail("RASTER_ARG", "fabRaster: " + k + " must be a positive integer (got " + v + ")");
    const fits = (p) => cdiv(artWUm, p) * cdiv(artHUm, p) <= pxBudget;
    let p = targetPitchUm, budget = false;
    if (!fits(p)) {
      budget = true;
      // Any feasible p satisfies p² ≥ artW·artH / budget, so this is a lower bound
      // (minus 1 against a sqrt rounded up); stepping makes the result exact.
      p = Math.max(targetPitchUm + 1, Math.floor(Math.sqrt((artWUm * artHUm) / pxBudget)) - 1);
      while (!fits(p)) p++;
    }
    const W1 = cdiv(artWUm, p), H1 = cdiv(artHUm, p);
    const W = Math.min(W1, srcW), H = Math.min(H1, srcH), source = W < W1 || H < H1;
    return {
      W, H, pitchUm: p,
      capped: budget ? (source ? "budget+source" : "budget") : (source ? "source" : "none"),
      shortPx: source ? [Math.max(0, W1 - srcW), Math.max(0, H1 - srcH)] : null,
    };
  };

  /** Real per-axis scales of a raster (G1.1): sxUm = artWUm/W, syUm = artHUm/H; mmPerPxMax = max/1000. */
  R.scaleUm = function (artWUm, artHUm, W, H) {
    const sxUm = artWUm / W, syUm = artHUm / H;
    return { sxUm, syUm, mmPerPxMax: Math.max(sxUm, syUm) / 1000 };
  };

  /**
   * Resampling policy (IMG-02/03): height mode is "none" when the source fits
   * and "nearest" otherwise; "area" only as an explicit, recorded filter
   * (opts.heightArea, HEIGHT_FILTERED). Tonal mode is always "area".
   */
  R.resamplePolicy = function (mode, srcW, srcH, W, H, opts) {
    if (mode === "tonal") return "area";
    if (mode !== "height") throw rfail("RESAMPLE_METHOD", "mode must be height|tonal (got " + mode + ")");
    if (W === srcW && H === srcH) return "none";
    return opts && opts.heightArea ? "area" : "nearest";
  };

  /**
   * Raster cache key (Appendix C, S4): sampleHash is valid only with the
   * source size, so the key is (w, h, channels, W, H, method, sampleHash).
   */
  R.cacheKey = function (k) {
    k = k || {};
    if (![k.w, k.h, k.channels, k.W, k.H].every(isPosInt) || !METHODS.includes(k.method) || typeof k.sampleHash !== "string" || !k.sampleHash)
      throw rfail("RASTER_ARG", "cacheKey needs w, h, channels, W, H, method and sampleHash");
    return [k.w, k.h, k.channels, k.W, k.H, k.method, k.sampleHash].join("|");
  };

  // µm integer → mm text without float formatting artefacts (100 → "0.1", 2000 → "2").
  function umText(um) {
    const n = Math.round(um), whole = idiv(n, 1000), frac = String(n % 1000).padStart(3, "0").replace(/0+$/, "");
    return frac ? whole + "." + frac : String(whole);
  }

  /**
   * Fabrication diagnostics for a fabRaster result (PO-LASER-4/5). Each names only the coarsening it caused:
   *   FAB_PITCH_CAPPED (info)      — the budget coarsened the pitch. measured = mm/px of the budget-limited raster
   *                                  (ceil(art/pitchUm) per axis, before the source clamp), limit = the target.
   *                                  When the source then clamps further (budget+source), the detail says so and
   *                                  gives the real mm/px, attributing that part to the source.
   *   FAB_EXCEEDS_SOURCE (warning) — the source has fewer pixels than the raster at the (possibly budget-capped)
   *                                  pitch. measured/limit are source px / target px on the MOST-SHORT axis (largest
   *                                  target/source ratio; ties → width), so measured < limit whenever it warns;
   *                                  shortPx carries both axes.
   * ctx: {artWUm, artHUm, srcW, srcH, targetPitchUm, pxBudget, deviceClass, quality, revision}.
   */
  R.fabDiagnostics = function (fab, ctx) {
    const out = [], base = { quality: ctx.quality === undefined ? "fabrication" : ctx.quality, revision: ctx.revision };
    const realUm = Math.round(R.scaleUm(ctx.artWUm, ctx.artHUm, fab.W, fab.H).mmPerPxMax * 1000);
    const W1 = cdiv(ctx.artWUm, fab.pitchUm), H1 = cdiv(ctx.artHUm, fab.pitchUm);
    const budget = fab.capped === "budget" || fab.capped === "budget+source", source = !!fab.shortPx;
    if (budget) {
      const budgetUm = Math.round(R.scaleUm(ctx.artWUm, ctx.artHUm, W1, H1).mmPerPxMax * 1000);
      out.push(global.SBDiag.make("FAB_PITCH_CAPPED", Object.assign({}, base, {
        measured: { value: budgetUm / 1000, unit: "mm/px" }, limit: { value: ctx.targetPitchUm / 1000, unit: "mm/px" },
        detail: "the " + (ctx.deviceClass || "device") + " pixel budget of " + ctx.pxBudget + " px coarsened the pitch to " + umText(budgetUm) +
          " mm/px instead of the " + umText(ctx.targetPitchUm) + " mm/px target (pitch " + fab.pitchUm + " µm, " + W1 + " × " + H1 + " px)" +
          (source ? "; the source (" + ctx.srcW + " × " + ctx.srcH + " px) then limits the raster to " + fab.W + " × " + fab.H + " px at " +
            umText(realUm) + " mm/px (see FAB_EXCEEDS_SOURCE)" : ""),
      })));
    }
    if (source) {
      const byH = H1 * ctx.srcW > W1 * ctx.srcH;   // H1/srcH > W1/srcW, exact in integers; ties → width
      const axis = byH ? "height" : "width", sPx = byH ? ctx.srcH : ctx.srcW, tPx = byH ? H1 : W1;
      out.push(global.SBDiag.make("FAB_EXCEEDS_SOURCE", Object.assign({}, base, {
        measured: { value: sPx, unit: "px" }, limit: { value: tPx, unit: "px" }, shortPx: fab.shortPx.slice(),
        detail: "source " + ctx.srcW + " × " + ctx.srcH + " px is " + fab.shortPx[0] + " × " + fab.shortPx[1] + " px short of the " +
          umText(fab.pitchUm) + " mm/px " + (budget ? "budget-capped pitch (target " + umText(ctx.targetPitchUm) + " mm/px)" : "target") +
          " (" + W1 + " × " + H1 + " px), most short on the " + axis + ": " + sPx + " of " + tPx + " px; source detail cannot be recovered, so the raster stays " +
          fab.W + " × " + fab.H + " px at " + umText(realUm) + " mm/px",
      })));
    }
    return out;
  };

  global.SBRaster = R;
})(typeof window !== "undefined" ? window : globalThis);
