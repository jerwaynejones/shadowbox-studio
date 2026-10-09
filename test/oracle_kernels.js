// test/oracle_kernels.js — speed round (plan Appendix F, F.3): the pre-round kernels, moved VERBATIM from js/
// so every optimised kernel ships with a byte-equality test against the code it replaced. Never edit these
// bodies; only add kernels (F3 resample, F4 morphology; later F5–F7).
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

// ---- F4: windowAny, M.dilate, M.erode, M.open, M.close (js/morph.js before F4) and construct.js `morph`, verbatim.
// `morph` reads SBMorph from its global; here open/close are the oracle ones and removeSpecks/fillHoles come from the
// module passed as `live` (the F5 suite passes oracleComponents).
const oracleMorph = (() => {
  const M = {};
  function windowAny(ind, w, h, r) {
    const mid = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0, o = 0; y < h; y++, o += w) {
      let c = 0;
      const e0 = Math.min(w - 1, r);
      for (let x = 0; x <= e0; x++) c += ind[o + x];
      mid[o] = c > 0 ? 1 : 0;
      for (let x = 1; x < w; x++) {
        if (x + r < w) c += ind[o + x + r];
        if (x - r - 1 >= 0) c -= ind[o + x - r - 1];
        mid[o + x] = c > 0 ? 1 : 0;
      }
    }
    const cnt = new Int32Array(w);
    for (let y = 0; y <= Math.min(h - 1, r); y++) { const o = y * w; for (let x = 0; x < w; x++) cnt[x] += mid[o + x]; }
    for (let y = 0, o = 0; y < h; y++, o += w) {
      if (y > 0) {
        if (y + r < h) { const a = (y + r) * w; for (let x = 0; x < w; x++) cnt[x] += mid[a + x]; }
        if (y - r - 1 >= 0) { const b = (y - r - 1) * w; for (let x = 0; x < w; x++) cnt[x] -= mid[b + x]; }
      }
      for (let x = 0; x < w; x++) out[o + x] = cnt[x] > 0 ? 1 : 0;
    }
    return out;
  }

  M.dilate = function (mask, w, h, r) {
    if (r < 1) return mask.slice();
    const ind = new Uint8Array(w * h);
    for (let i = 0; i < ind.length; i++) ind[i] = mask[i] !== 0 ? 1 : 0;
    return windowAny(ind, w, h, r);
  };

  M.erode = function (mask, w, h, r) {
    const out = mask.slice();
    if (r < 1 || w < 3 || h < 3) return out;
    const ind = new Uint8Array(w * h);
    for (let i = 0; i < ind.length; i++) ind[i] = mask[i] === 0 ? 1 : 0;
    const hole = windowAny(ind, w, h, r);
    for (let y = 1; y < h - 1; y++) for (let x = 1, o = y * w + 1; x < w - 1; x++, o++) if (hole[o]) out[o] = 0;
    return out;
  };

  /** Opening = erode then dilate. Removes features thinner than ~2r px. */
  M.open = (mask, w, h, r) => (r < 1 ? mask.slice() : M.dilate(M.erode(mask, w, h, r), w, h, r));

  /** Closing = dilate then erode. Seals gaps/holes thinner than ~2r px. */
  M.close = (mask, w, h, r) => (r < 1 ? mask.slice() : M.erode(M.dilate(mask, w, h, r), w, h, r));

  /** The shared per-layer morphology: open → close (→ removeSpecks when cull) → fillHoles. Returns {m, specks, holes}. */
  function morph(live, mask, w, h, px, cull) {
    const r = px.featR;
    let m = r > 0 ? M.open(mask, w, h, r) : mask.slice();
    if (r > 0) m = M.close(m, w, h, Math.max(1, r - 1));
    const specks = cull ? live.removeSpecks(m, w, h, px.speckPx) : 0;
    const holes = live.fillHoles(m, w, h, px.holePx);
    return { m, specks, holes };
  }
  return { windowAny, dilate: M.dilate, erode: M.erode, open: M.open, close: M.close, morph };
})();

// ---- F5: M.components, M.removeSpecks, M.fillHoles (js/morph.js before F5) and construct.js `runComponents`, `dropSmall`,
// the body of `C.simplifyBusy` (before F5), verbatim apart from the simplifyBusy wrapper noted below.
const oracleComponents = (() => {
  const M = {};
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

  return M;
})();
const oracleConstruct = (() => {
  const C = {};
  /**
   * 4-connected components of the nonzero pixels by row runs and union-find. Returns {count, root(i), runs} where runs is
   * {y, x0, x1} as parallel Int32Arrays (half-open [x0, x1)) and root maps a run index to its component representative.
   */
  function runComponents(mask, w, h) {
    let cap = 1024, Y = new Int32Array(cap), X0 = new Int32Array(cap), X1 = new Int32Array(cap), P = new Int32Array(cap), n = 0, unions = 0;
    const grow = () => { cap *= 2; const g = (a) => { const b = new Int32Array(cap); b.set(a); return b; }; Y = g(Y); X0 = g(X0); X1 = g(X1); P = g(P); };
    const find = (i) => { while (P[i] !== i) { P[i] = P[P[i]]; i = P[i]; } return i; };
    // zero bytes are skipped a 32-bit word at a time when the buffer is aligned; a run of 1s ends at the native indexOf(0)
    const words = mask.byteOffset % 4 === 0 ? new Uint32Array(mask.buffer, mask.byteOffset, mask.length >> 2) : null;
    const ones = (o, x, end) => { let e = x; if (mask[o + x] === 1 && end - x > 16) { const z = mask.subarray(o + x, o + end).indexOf(0); e = z < 0 ? end : x + z; }
      while (e < end && mask[o + e]) e++; return e; };
    let prevStart = 0, prevEnd = 0;
    for (let y = 0; y < h; y++) {
      const rowStart = n, o = y * w;
      let j = prevStart;
      for (let x = 0; x < w;) {
        if (!mask[o + x]) {
          x++;
          if (words) { let i = o + x; while (i & 3 && i < o + w && !mask[i]) i++;
            if (!(i & 3)) { let q = i >> 2; const qe = (o + w) >> 2; while (q < qe && words[q] === 0) q++; i = Math.max(i, Math.min(q << 2, o + w)); }
            x = i - o; }
          continue;
        }
        const x0 = x; x = ones(o, x, w);
        if (n === cap) grow();
        Y[n] = y; X0[n] = x0; X1[n] = x; P[n] = n;
        // runs of the previous row that overlap [x0, x) (4-connectivity: shared column)
        while (j < prevEnd && X1[j] <= x0) j++;
        for (let q = j; q < prevEnd && X0[q] < x; q++) { const a = find(q), b = find(n); if (a !== b) { if (a < b) P[b] = a; else P[a] = b; unions++; } }
        n++;
      }
      prevStart = rowStart; prevEnd = n;
    }
    return { count: n - unions, n, find, Y, X0, X1 };
  }

  /** Zero every 4-connected component whose area·pxUm2 is below minPartUm2 (in place); returns the components kept. */
  function dropSmall(m, w, h, minPartUm2, pxUm2) {
    const rc = runComponents(m, w, h), area = new Float64Array(rc.n);
    for (let i = 0; i < rc.n; i++) area[rc.find(i)] += rc.X1[i] - rc.X0[i];
    let kept = 0;
    for (let i = 0; i < rc.n; i++) if (rc.find(i) === i && area[i] * pxUm2 >= minPartUm2) kept++;
    for (let i = 0; i < rc.n; i++) if (area[rc.find(i)] * pxUm2 < minPartUm2) m.fill(0, rc.Y[i] * w + rc.X0[i], rc.Y[i] * w + rc.X1[i]);
    return kept;
  }

  C.runComponents = runComponents;
  C.dropSmall = dropSmall;
  /** C.simplifyBusy's body as before F5 after validation; closeR/minPartUm2/pxUm2 and the (unchanged) live paddedClose are
   *  passed in, so only the component labelling and dropSmall are the oracle's. */
  C.simplifyBusyBody = function (paddedClose, masks, w, h, closeR, minPartUm2, pxUm2) {
    const before = [], after = [];
    const out = masks.map((mask, k) => {
      const n0 = runComponents(mask, w, h).count;
      before.push(n0);
      if (k === 0) { after.push(n0); return mask.slice(); }
      const m = paddedClose(mask, w, h, closeR);
      after.push(dropSmall(m, w, h, minPartUm2, pxUm2));
      return m;
    });
    return { masks: out, before, after, closeR, minPartUm2 };
  };

  return C;
})();

module.exports = { oracleResample, oracleMorph, oracleComponents, oracleConstruct };
