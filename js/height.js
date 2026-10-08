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

  Hh.boundaries = (N, tMM) =>
    Array.from({ length: Math.max(0, N - 1) }, (_, i) => ({ k: i + 1, norm: (i + 0.5) / (N - 1), mm: (i + 1) * tMM }));

  global.SBHeight = Hh;
})(typeof window !== "undefined" ? window : globalThis);
