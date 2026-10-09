// test/oracle_kernels.js — speed round (plan Appendix F, F.3): the pre-round kernels, moved VERBATIM from js/
// so every optimised kernel ships with a byte-equality test against the code it replaced. Never edit these
// bodies; only add kernels (F3 resample; later F4–F7).
"use strict";

// ---- F3: R.resample as of alpha.3 (js/raster.js before F3), with its helpers, verbatim.
const oracleResample = (() => {
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

  const oracleResample = function (pixels, channels, w, h, W, H, method) {
    if (!METHODS.includes(method)) throw rfail("RESAMPLE_METHOD", "method must be none|nearest|area (got " + method + ")");
    if (![1, 2, 3, 4].includes(channels)) throw rfail("RESAMPLE_SIZE", "channels must be 1..4");
    if (![w, h, W, H].every(isPosInt)) throw rfail("RESAMPLE_SIZE", "sizes must be positive integers");
    if (!pixels || pixels.length < w * h * channels) throw rfail("RESAMPLE_SIZE", "pixel buffer shorter than w·h·channels");
    if (W > w || H > h) throw rfail("RESAMPLE_UPSAMPLE", W + "×" + H + " is larger than the " + w + "×" + h + " source");
    const c = channels;
    if (method === "none" || (W === w && H === h)) {
      if (W !== w || H !== h) throw rfail("RESAMPLE_SIZE", "method none requires the source size");
      return Uint8Array.from(pixels.subarray ? pixels.subarray(0, w * h * c) : pixels.slice(0, w * h * c));
    }
    const out = new Uint8Array(W * H * c);
    if (method === "nearest") {
      const sx = new Int32Array(W), sy = new Int32Array(H);
      for (let x = 0; x < W; x++) sx[x] = idiv((2 * x + 1) * w, 2 * W);
      for (let y = 0; y < H; y++) sy[y] = idiv((2 * y + 1) * h, 2 * H);
      for (let y = 0, o = 0; y < H; y++) {
        const row = sy[y] * w;
        for (let x = 0; x < W; x++) { const s = (row + sx[x]) * c; for (let k = 0; k < c; k++) out[o++] = pixels[s + k]; }
      }
      return out;
    }
    // area: horizontal integer sums (≤ 255·w), then vertical (≤ 255·w·h); all exact doubles.
    const hx = areaSpans(w, W), vy = areaSpans(h, H), D = w * h;
    const rows = new Float64Array(h * W * c);
    for (let y = 0; y < h; y++) {
      const src = y * w * c, dst = y * W * c;
      for (let X = 0; X < W; X++) {
        const s0 = hx.start[X], n = hx.count[X];
        for (let k = 0; k < c; k++) {
          let acc = 0;
          for (let j = 0; j < n; j++) acc += pixels[src + hx.idx[s0 + j] * c + k] * hx.wt[s0 + j];
          rows[dst + X * c + k] = acc;
        }
      }
    }
    for (let Y = 0; Y < H; Y++) {
      const s0 = vy.start[Y], n = vy.count[Y];
      for (let i = 0; i < W * c; i++) {
        let acc = 0;
        for (let j = 0; j < n; j++) acc += rows[vy.idx[s0 + j] * W * c + i] * vy.wt[s0 + j];
        out[Y * W * c + i] = halfUp(acc, D);
      }
    }
    return out;
  };
  return oracleResample;
})();

module.exports = { oracleResample };
