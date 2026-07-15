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

  M.dilate = function (mask, w, h, r) {
    let a = mask.slice(), b = new Uint8Array(w * h);
    for (let i = 0; i < r; i++) { dilateOnce(a, b, w, h); [a, b] = [b, a]; }
    return a;
  };

  M.erode = function (mask, w, h, r) {
    let a = mask.slice(), b = new Uint8Array(w * h);
    for (let i = 0; i < r; i++) { erodeOnce(a, b, w, h); [a, b] = [b, a]; }
    return a;
  };

  /** Opening = erode then dilate. Removes features thinner than ~2r px. */
  M.open = (mask, w, h, r) => (r < 1 ? mask.slice() : M.dilate(M.erode(mask, w, h, r), w, h, r));

  /** Closing = dilate then erode. Seals gaps/holes thinner than ~2r px. */
  M.close = (mask, w, h, r) => (r < 1 ? mask.slice() : M.erode(M.dilate(mask, w, h, r), w, h, r));

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
