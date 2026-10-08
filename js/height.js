/* ============================================================================
 * Shadowbox Studio — height.js
 * ----------------------------------------------------------------------------
 * Height-map quantization into N stacked sheets (D-4.3, LYR-02, AT-03/04).
 * A sheet index ("added" layers above the base) per sample, and the
 * cumulative masks every downstream consumer traces. Integer-only and
 * deterministic; no interpolation, no stretch, no dedup.
 *
 *   SBHeight.addedFromNorm(h, N) -> int          nearest layer for h in [0,1];
 *                             ties (the midpoints (k-0.5)/(N-1)) go UP
 *   SBHeight.addedFromSamples(samples, N, polarity) -> Uint8Array
 *                             polarity "white-high" | "black-high"; the exact
 *                             integer form of addedFromNorm(s/255, N)
 *   SBHeight.cumulativeMasks(added, domain, N, w, h) -> Uint8Array[N]
 *                             [0] all ones (base B); [k] = domain ∧ added ≥ k
 *                             (domain null = whole image). Masks nest by
 *                             construction; identical masks are kept (D-4.7).
 *   SBHeight.boundaries(N, tMM) -> [{k, norm: (k-0.5)/(N-1), mm: k*tMM}]
 *   SBHeight.tonalAdded(bandMap, N, darkFront) -> Uint8Array
 *                             N-1-b' for the tonal path, so that
 *                             cumulativeMasks(tonalAdded(...)) equals
 *                             SBRaster.sheetMasks byte for byte (G2.4).
 *   SBHeight.domainMask(alpha, mode, t=0.5) -> Uint8Array|null   (G2.5, IMG-04)
 *                             the alpha domain A: 1 where alpha ≥ round(t·255);
 *                             null (whole image) for mode "full" or no alpha.
 *   SBHeight.applyFilter(samples, w, h, filter, domain?) -> Uint8Array   (G2.5b, IMG-03)
 *                             the explicit, recorded height filter; never a default.
 *                             filter {op:"median", radius} lower median of the in-bounds
 *                             (2r+1)² window; {op:"box", radius} its integer mean, half up;
 *                             {op:"remap", lut: int[256]} out = lut[s]. With a domain, only
 *                             in-domain neighbours are sampled and out-of-domain pixels are
 *                             copied unchanged (IMG-04). Integer-only, deterministic, pure.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const Hh = {};

  Hh.addedFromNorm = (h, N) => (N <= 1 ? 0 : Math.min(N - 1, Math.floor((N - 1) * h + 0.5)));

  Hh.addedFromSamples = function (samples, N, polarity) {
    const out = new Uint8Array(samples.length);
    if (N <= 1) return out;
    const inv = polarity === "black-high";
    for (let i = 0; i < samples.length; i++) {
      const s = inv ? 255 - samples[i] : samples[i];
      out[i] = Math.min(N - 1, Math.floor((2 * (N - 1) * s + 255) / 510)); // == floor((N-1)*s/255 + 0.5), exact
    }
    return out;
  };

  Hh.tonalAdded = function (bandMap, N, darkFront) {
    const out = new Uint8Array(bandMap.length);
    for (let i = 0; i < bandMap.length; i++) {
      const b = darkFront ? bandMap[i] : N - 1 - bandMap[i];
      out[i] = N - 1 - b;
    }
    return out;
  };

  Hh.cumulativeMasks = function (added, domain, N, w, h) {
    const ms = [new Uint8Array(w * h).fill(1)];
    for (let k = 1; k < N; k++) {
      const m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) m[i] = (!domain || domain[i]) && added[i] >= k ? 1 : 0;
      ms.push(m);
    }
    return ms;
  };

  Hh.domainMask = function (alpha, mode, t = 0.5) {
    const fail = (msg) => { const e = new Error("DOMAIN_ARG: " + msg); e.code = "DOMAIN_ARG"; return e; };
    if (mode !== "threshold" && mode !== "full") throw fail("mode must be threshold|full (got " + mode + ")");
    if (typeof t !== "number" || !(t >= 0 && t <= 1)) throw fail("t must be in [0, 1] (got " + t + ")");
    if (mode === "full" || alpha == null) return null;
    const cut = Math.round(t * 255), out = new Uint8Array(alpha.length);
    for (let i = 0; i < alpha.length; i++) out[i] = alpha[i] >= cut ? 1 : 0;
    return out;
  };

  const FILTER_OPS = ["median", "box", "remap"], FILTER_MAX_R = 50;
  Hh.applyFilter = function (samples, w, h, filter, domain) {
    const fail = (msg) => { const e = new Error("FILTER_ARG: " + msg); e.code = "FILTER_ARG"; return e; };
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw fail("w, h must be positive integers");
    if (!samples || samples.length !== w * h) throw fail("samples must have w·h = " + w * h + " entries");
    if (domain != null && domain.length !== w * h) throw fail("domain must have w·h = " + w * h + " entries");
    if (!filter || typeof filter !== "object" || !FILTER_OPS.includes(filter.op)) throw fail("op must be median|box|remap");
    const out = Uint8Array.from(samples), d = domain || null;
    if (filter.op === "remap") {
      const lut = filter.lut;
      if (!Array.isArray(lut) && !ArrayBuffer.isView(lut)) throw fail("remap needs a lut");
      if (lut.length !== 256 || !Array.prototype.every.call(lut, (v) => Number.isInteger(v) && v >= 0 && v <= 255)) throw fail("lut must be 256 integers in 0..255");
      for (let i = 0; i < out.length; i++) if (!d || d[i]) out[i] = lut[samples[i]];
      return out;
    }
    const r = filter.radius;
    if (!Number.isInteger(r) || r < 1 || r > FILTER_MAX_R) throw fail("radius must be an integer in 1.." + FILTER_MAX_R);
    return filter.op === "box" ? boxFilter(samples, out, w, h, r, d) : medianFilter(samples, out, w, h, r, d);
  };

  // Integer mean over the in-bounds, in-domain (2r+1)² window, rounded half up. Running column sums: O(w) memory.
  function boxFilter(s, out, w, h, r, d) {
    const colS = new Float64Array(w), colN = new Int32Array(w);
    const addRow = (y, sg) => { const o = y * w; for (let x = 0; x < w; x++) if (!d || d[o + x]) { colS[x] += sg * s[o + x]; colN[x] += sg; } };
    for (let y = 0; y <= Math.min(h - 1, r); y++) addRow(y, 1);
    for (let y = 0; y < h; y++) {
      if (y > 0) { if (y - r - 1 >= 0) addRow(y - r - 1, -1); if (y + r < h) addRow(y + r, 1); }
      let S = 0, n = 0;
      for (let x = 0; x <= Math.min(w - 1, r); x++) { S += colS[x]; n += colN[x]; }
      for (let x = 0, o = y * w; x < w; x++) {
        if (x > 0) { if (x - r - 1 >= 0) { S -= colS[x - r - 1]; n -= colN[x - r - 1]; } if (x + r < w) { S += colS[x + r]; n += colN[x + r]; } }
        if (!d || d[o + x]) out[o + x] = Math.floor((2 * S + n) / (2 * n));   // n ≥ 1: the pixel itself is in the window
      }
    }
    return out;
  }

  // Lower median ((n−1)>>1-th order statistic) over the in-bounds, in-domain window. Sliding two-level histogram (Huang).
  function medianFilter(s, out, w, h, r, d) {
    const fine = new Int32Array(256), coarse = new Int32Array(16);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      fine.fill(0); coarse.fill(0); let n = 0;
      const col = (x, sg) => { for (let yy = y0; yy <= y1; yy++) { const i = yy * w + x; if (!d || d[i]) { const v = s[i]; fine[v] += sg; coarse[v >> 4] += sg; n += sg; } } };
      for (let x = 0; x <= Math.min(w - 1, r); x++) col(x, 1);
      for (let x = 0, o = y * w; x < w; x++) {
        if (x > 0) { if (x - r - 1 >= 0) col(x - r - 1, -1); if (x + r < w) col(x + r, 1); }
        if (d && !d[o + x]) continue;
        let k = (n - 1) >> 1, c = 0;
        while (k >= coarse[c]) k -= coarse[c++];
        let v = c << 4;
        while (k >= fine[v]) k -= fine[v++];
        out[o + x] = v;
      }
    }
    return out;
  }

  Hh.boundaries = (N, tMM) =>
    Array.from({ length: Math.max(0, N - 1) }, (_, i) => ({ k: i + 1, norm: (i + 0.5) / (N - 1), mm: (i + 1) * tMM }));

  global.SBHeight = Hh;
})(typeof window !== "undefined" ? window : globalThis);
