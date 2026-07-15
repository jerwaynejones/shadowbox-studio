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
  R.kuwahara = function (src, w, h, r, passes = 1) {
    if (r < 1 || passes < 1) return src.slice();
    let cur = src;
    for (let p = 0; p < passes; p++) cur = kuwaharaOnce(cur, w, h, r);
    return cur;
  };

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
   * @param {"balanced"|"linear"} mode
   *   balanced — percentile split: every band covers ~equal pixel area
   *   linear   — equal luminance spacing between the 2nd/98th percentiles
   */
  R.thresholds = function (L, nBands, mode) {
    const hist = new Float64Array(256);
    for (let i = 0; i < L.length; i++) hist[Math.round(SBUtilClampI(L[i], 0, 255))]++;
    const total = L.length;
    // cumulative
    const cum = new Float64Array(257);
    for (let i = 0; i < 256; i++) cum[i + 1] = cum[i] + hist[i];

    const pct = (p) => { // value at percentile p (0..1)
      const target = p * total;
      for (let i = 0; i < 256; i++) if (cum[i + 1] >= target) return i;
      return 255;
    };

    const t = [];
    if (mode === "linear") {
      const lo = pct(0.02), hi = Math.max(pct(0.98), lo + nBands);
      for (let k = 1; k < nBands; k++) t.push(lo + ((hi - lo) * k) / nBands);
    } else {
      for (let k = 1; k < nBands; k++) t.push(pct(k / nBands) + 0.5);
    }
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
    const masks = [];
    const full = new Uint8Array(w * h).fill(1);
    masks.push(full); // backing sheet
    for (let s = 1; s < nBands; s++) {
      const m = new Uint8Array(w * h);
      const cutoff = nBands - 1 - s; // include bands 0..cutoff (dark side)
      for (let i = 0; i < bandMap.length; i++) {
        const b = darkFront ? bandMap[i] : nBands - 1 - bandMap[i];
        m[i] = b <= cutoff ? 1 : 0;
      }
      masks.push(m);
    }
    return masks;
  };

  global.SBRaster = R;
})(typeof window !== "undefined" ? window : globalThis);
