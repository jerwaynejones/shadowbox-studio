// test/oracle_kernels.js — speed round (plan Appendix F, F.3): the pre-round kernels, moved VERBATIM from js/
// so every optimised kernel ships with a byte-equality test against the code it replaced. Never edit these
// bodies; only add kernels (F3 resample, F4 morphology, F5 components, F6 Kuwahara, F7 trace, F8 overlays).
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

// ---- F6: R.kuwahara / kuwaharaOnce / kuwaharaDomainOnce as of alpha.3 (js/raster.js before F6), verbatim.
const oracleKuwahara = (() => {
  const R = {};
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
  R.kuwaharaOnce = kuwaharaOnce;
  R.kuwaharaDomainOnce = kuwaharaDomainOnce;
  return R;
})();

// ---- F7: T.trace as of alpha.3 (js/trace.js before F7), with consumeEdge and dedupeCollinear, verbatim.
const oracleTrace = (() => {
  const T = {};

  // Direction encoding for chaining: 0=+x, 1=+y, 2=-x, 3=-y
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];

  /**
   * Trace all boundary loops of a 0/1 mask.
   * @returns {Array<Array<[x,y]>>} closed loops in pixel-corner coordinates
   */
  T.trace = function (mask, w, h) {
    // outgoing[cornerIndex] = list of directions with an unused edge leaving
    // that corner. Corner grid is (w+1) x (h+1).
    const CW = w + 1;
    const outgoing = new Map(); // cornerIdx -> Uint8 bitmask of dirs

    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
    const addEdge = (x, y, dir) => {
      const idx = y * CW + x;
      outgoing.set(idx, (outgoing.get(idx) || 0) | (1 << dir));
    };

    // Emit directed edges: material on the LEFT of travel (screen coords, y down).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (!at(x, y - 1)) addEdge(x + 1, y, 2);       // top edge, travel -x
        if (!at(x, y + 1)) addEdge(x, y + 1, 0);       // bottom edge, travel +x
        if (!at(x - 1, y)) addEdge(x, y, 1);           // left edge, travel +y
        if (!at(x + 1, y)) addEdge(x + 1, y + 1, 3);   // right edge, travel -y
      }
    }

    const loops = [];
    // Deterministic iteration: sort corner indices.
    const starts = Array.from(outgoing.keys()).sort((a, b) => a - b);

    for (const start of starts) {
      let bits = outgoing.get(start);
      while (bits) {
        // take lowest set direction as loop start
        const startDir = 31 - Math.clz32(bits & -bits);
        const loop = [];
        let cx = start % CW, cy = (start / CW) | 0, dir = startDir;
        // consume the starting edge
        consumeEdge(outgoing, start, startDir);
        loop.push([cx, cy]);
        cx += DX[dir]; cy += DY[dir];

        // Walk until we return to the start corner via a closed chain.
        let guard = (w + 2) * (h + 2) * 4;
        while (!(cx === start % CW && cy === ((start / CW) | 0)) && guard-- > 0) {
          loop.push([cx, cy]);
          const idx = cy * CW + cx;
          const avail = outgoing.get(idx) || 0;
          // Prefer the left-most turn relative to current direction:
          // left, straight, right (never reverse).
          const prefs = [(dir + 3) & 3, dir, (dir + 1) & 3];
          let next = -1;
          for (const d of prefs) if (avail & (1 << d)) { next = d; break; }
          if (next < 0) break; // broken chain — abandon defensively
          consumeEdge(outgoing, idx, next);
          dir = next;
          cx += DX[dir]; cy += DY[dir];
        }
        if (loop.length >= 4) loops.push(dedupeCollinear(loop));
        bits = outgoing.get(start) || 0;
      }
      outgoing.delete(start);
    }
    return loops;
  };

  function consumeEdge(outgoing, idx, dir) {
    const bits = (outgoing.get(idx) || 0) & ~(1 << dir);
    if (bits) outgoing.set(idx, bits); else outgoing.delete(idx);
  }

  /** Merge runs of collinear rectilinear points to shrink loop size early. */
  function dedupeCollinear(loop) {
    const out = [];
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const p = loop[(i + n - 1) % n], c = loop[i], q = loop[(i + 1) % n];
      const straight =
        (p[0] === c[0] && c[0] === q[0]) || (p[1] === c[1] && c[1] === q[1]);
      if (!straight) out.push(c);
    }
    return out.length >= 3 ? out : loop;
  }

  return T.trace;
})();

// ---- F8: E.maskPolygons as of alpha.3 (js/engine.js before F8), verbatim; the uncropped overlay path. It calls the
// live SBGeom and SBTrace (T.trace itself is oracle-gated by F7), so it is the reference for the cropped path.
const oracleMaskPolygons = ((global) => {
  const E = {};
  E.maskPolygons = function (w, h, sxUm, syUm, fUm, pred) {
    const m = new Uint8Array(w * h);
    let any = 0;
    for (let i = 0; i < m.length; i++) if (pred(i)) { m[i] = 1; any = 1; }
    if (!any) return null;
    const G = global.SBGeom;
    return G.normalize(G.union(G.fromPixelLoops(global.SBTrace.trace(m, w, h), sxUm, syUm, fUm, fUm), []));
  };
  return E.maskPolygons;
})(globalThis);

module.exports = { oracleResample, oracleMorph, oracleComponents, oracleConstruct, oracleKuwahara, oracleTrace, oracleMaskPolygons };
