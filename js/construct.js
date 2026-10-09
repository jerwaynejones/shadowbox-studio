/* ============================================================================
 * Shadowbox Studio — js/construct.js
 * ----------------------------------------------------------------------------
 * SBConstruct: the two construction strategies on raster masks (plan G2.6).
 *
 *   connected(masks, w, h, px)  connected-sheet mode: the v1.1.0 per-sheet chain
 *                               open → close → removeSpecks → fillHoles → SBIslands.resolve
 *                               (bridge or cull every loose part; SUP-06, one part per layer).
 *   bonded(masks, w, h, px)     bonded-relief mode: the same open → close → fillHoles chain,
 *                               removeSpecks only when px.cullEnabled (SUP-01: culling is explicit),
 *                               NEVER SBIslands.resolve and no clip. The chain is monotone, so nested
 *                               input stays nested (D-4.5): bonded morphology never creates an overhang.
 *
 * Both return {final: Uint8Array[], bridges: (Uint8Array|null)[], report: [{layer, addedPx, removedPx,
 * filledHoles, removedParts}]} with one entry per layer. Layer 0 (the base) passes through as a copy with an
 * all-zero report. The report counts pixels against the input mask; the engine converts it to mm² with
 * sxUm·syUm (GEO-08). Connected report entries also carry the islands counts {bridged, culled}
 * (removedParts = specks + culled). Inputs are never mutated.
 *
 * px = {featR, bridgeR, cullPx, maxBridgePx, speckPx, holePx, frameAnchored, cullEnabled}:
 *   featR        opening radius (px); the closing radius is max(1, featR − 1) as in v1.1.0, and featR 0
 *                disables both (no morphology);
 *   speckPx      removeSpecks area limit (px²); holePx fillHoles area limit (px²);
 *   bridgeR, cullPx, maxBridgePx, frameAnchored  SBIslands.resolve options (connected only);
 *   cullEnabled  bonded only: run removeSpecks (connected always runs it, as v1.1.0 did).
 *
 * G2.7b — complexity caps and busy-art simplification (SRS §12.3, NFR-03/04/05, PO-LASER-9):
 *   estimateComplexity(masks, w, h)  → {partsPerLayer[], maxPartsPerLayer}: 4-connected components per layer
 *                               (nonzero = material), equal to the SBMaterial.fromMasks part count (frame and holes
 *                               aside). Run-length union-find, O(w·h) time and O(runs) memory; runs before trace.
 *   simplifyBusy(masks, w, h, {minFeatureMM, minPartMM2, sxUm, syUm})
 *                               → {masks, before[], after[], closeR, minPartUm2}. Explicit "busy" simplification:
 *                               per layer ≥ 1, a closing of radius closeR = ⌊(⌈minFeatureUm / min(sx, sy)⌉ − 1) / 2⌋ px
 *                               (merges parts whose gap is below the minimum feature at this pitch; the mask is
 *                               padded so the closing is extensive at the border), then drop every component with
 *                               area·sx·sy < minPartUm2 = round(minPartMM2·10⁶) µm². Both steps are monotone, so a
 *                               nested stack stays nested (D-4.5). Layer 0 (the base) is copied unchanged. Draft and
 *                               fabrication apply the same rule at their own pitch (LYR-06). Input not mutated.
 *   complexityGate(masks, w, h, {deviceClass, simplify: "off"|"busy", minFeatureMM, minPartMM2, sxUm, syUm,
 *                  quality, revision})
 *                               → {status: "ok"|"error", masks|null, estimate, simplified|null, diagnostics}.
 *                               simplify "busy" runs simplifyBusy first and reports BUSY_SIMPLIFIED (info) with the
 *                               before/after part counts per layer; then the parts cap of SBSchema.limits(deviceClass)
 *                               is checked: any layer over maxPartsPerLayer gives COMPLEXITY_LIMIT (blocking; measured,
 *                               limit, layer, deviceClass) and masks null — never truncated geometry (SRS:L564).
 *   vertexGate(layers, deviceClass, {quality, revision})
 *                               → {status, layers ([] on error), vertices: {perLayer[], total}, diagnostics}: the vertex
 *                               caps (maxVerticesPerLayer, maxVerticesTotal) on MaterialLayer.stats.vertices, checked
 *                               after fromMasks and before validation. G2.10a stage 11 consumes both gates unchanged.
 *                               On mobile the message adds that mobile is limited to simpler art (PO 2026-10-08: the
 *                               SRS 20,000-vertex mobile cap is kept).
 * ==========================================================================*/
(function (global) {
  "use strict";
  /* global SBMorph, SBIslands, SBSchema, SBDiag */
  const C = {};

  function cfail(msg) { const e = new Error("CONSTRUCT_ARG: " + msg); e.code = "CONSTRUCT_ARG"; return e; }
  const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

  function checkArgs(masks, w, h, px) {
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw cfail("size must be positive integers (got " + w + " × " + h + ")");
    if (!Array.isArray(masks) || masks.length === 0) throw cfail("masks must be a non-empty array");
    masks.forEach((m, k) => { if (!(m instanceof Uint8Array) || m.length !== w * h) throw cfail("mask " + k + " must be a Uint8Array of length w·h"); });
    if (!px || typeof px !== "object") throw cfail("px must be {featR, bridgeR, cullPx, maxBridgePx, speckPx, holePx, frameAnchored, cullEnabled}");
    if (!Number.isInteger(px.featR) || px.featR < 0) throw cfail("featR must be a non-negative integer (got " + px.featR + ")");
    for (const f of ["bridgeR", "cullPx", "maxBridgePx", "speckPx", "holePx"]) if (!isNum(px[f])) throw cfail(f + " must be a non-negative number (got " + px[f] + ")");
  }

  /** The shared per-layer morphology: open → close (→ removeSpecks when cull) → fillHoles. Returns {m, specks, holes}. */
  function morph(mask, w, h, px, cull) {
    const M = global.SBMorph, r = px.featR;
    let m = r > 0 ? M.open(mask, w, h, r) : mask.slice();
    if (r > 0) m = M.close(m, w, h, Math.max(1, r - 1));
    const specks = cull ? M.removeSpecks(m, w, h, px.speckPx) : 0;
    const holes = M.fillHoles(m, w, h, px.holePx);
    return { m, specks, holes };
  }

  function diff(before, after) {
    let added = 0, removed = 0;
    for (let i = 0; i < before.length; i++) if (after[i] && !before[i]) added++; else if (before[i] && !after[i]) removed++;
    return { addedPx: added, removedPx: removed };
  }

  const baseEntry = () => ({ layer: 0, addedPx: 0, removedPx: 0, filledHoles: 0, removedParts: 0 });

  /** Connected-sheet strategy (SUP-06): the v1.1.0 chain, byte-identical, including SBIslands.resolve. */
  C.connected = function (masks, w, h, px) {
    checkArgs(masks, w, h, px);
    const final = [], bridges = [], report = [];
    masks.forEach((mask, k) => {
      if (k === 0) { final.push(mask.slice()); bridges.push(null); report.push({ ...baseEntry(), bridged: 0, culled: 0 }); return; }
      const { m, specks, holes } = morph(mask, w, h, px, true);
      const isl = global.SBIslands.resolve(m, w, h, {
        frameAnchored: !!px.frameAnchored, bridgeRadius: px.bridgeR, cullBelowPx: px.cullPx, maxBridgePx: px.maxBridgePx,
      });
      final.push(m); bridges.push(isl.bridges);
      report.push({ layer: k, ...diff(mask, m), filledHoles: holes, removedParts: specks + isl.culled, bridged: isl.bridged, culled: isl.culled });
    });
    return { final, bridges, report };
  };

  /** Bonded-relief strategy (SUP-01, D-4.5/4.6): no islands, no bridges, no clip; culling only when cullEnabled. */
  C.bonded = function (masks, w, h, px) {
    checkArgs(masks, w, h, px);
    const final = [], bridges = [], report = [];
    masks.forEach((mask, k) => {
      bridges.push(null);
      if (k === 0) { final.push(mask.slice()); report.push(baseEntry()); return; }
      const { m, specks, holes } = morph(mask, w, h, px, !!px.cullEnabled);
      final.push(m);
      report.push({ layer: k, ...diff(mask, m), filledHoles: holes, removedParts: specks });
    });
    return { final, bridges, report };
  };

  // ------------------------------------------------------------------ G2.7b complexity caps and simplification

  function checkMasks(masks, w, h) {
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw cfail("size must be positive integers (got " + w + " × " + h + ")");
    if (!Array.isArray(masks) || masks.length === 0) throw cfail("masks must be a non-empty array");
    masks.forEach((m, k) => { if (!(m instanceof Uint8Array) || m.length !== w * h) throw cfail("mask " + k + " must be a Uint8Array of length w·h"); });
  }

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

  C.estimateComplexity = function (masks, w, h) {
    checkMasks(masks, w, h);
    const partsPerLayer = masks.map((m) => runComponents(m, w, h).count);
    return { partsPerLayer, maxPartsPerLayer: Math.max(...partsPerLayer) };
  };

  const posNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
  function simplifyParams(o) {
    if (!o || typeof o !== "object") throw cfail("simplify options must be {minFeatureMM, minPartMM2, sxUm, syUm}");
    if (!isNum(o.minFeatureMM)) throw cfail("minFeatureMM must be a non-negative number (got " + o.minFeatureMM + ")");
    if (!isNum(o.minPartMM2)) throw cfail("minPartMM2 must be a non-negative number (got " + o.minPartMM2 + ")");
    if (!posNum(o.sxUm) || !posNum(o.syUm)) throw cfail("sxUm and syUm must be positive numbers (got " + o.sxUm + ", " + o.syUm + ")");
    const featUm = Math.round(o.minFeatureMM * 1000), pMin = Math.min(o.sxUm, o.syUm);
    const closeR = featUm > 0 ? Math.max(0, Math.floor((Math.ceil(featUm / pMin) - 1) / 2)) : 0;
    return { closeR, minPartUm2: Math.round(o.minPartMM2 * 1e6), pxUm2: o.sxUm * o.syUm };
  }

  /**
   * Square (Chebyshev radius r) dilation and erosion, separable and O(w·h) independent of r: horizontally per run of
   * set pixels (dilation fills [x0 − r, x1 + r), erosion keeps [x0 + r, x1 − r)), vertically by a sliding per-column count
   * over the 2r + 1 window (dilation: count > 0; erosion: count = 2r + 1). Identical to r iterations of SBMorph's 3×3
   * passes away from the border; pixels beyond the border count as empty. Input nonzero = set; returns a new 0/1 mask.
   */
  function sqMorph(src, W, H, r, erode) {
    const mid = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let y = 0, o = 0; y < H; y++, o += W) {
      for (let x = 0; x < W;) {
        if (!src[o + x]) { x++; continue; }
        const x0 = x; while (x < W && src[o + x]) x++;
        if (erode) { if (x0 + r < x - r) mid.fill(1, o + x0 + r, o + x - r); }
        else mid.fill(1, o + Math.max(0, x0 - r), o + Math.min(W, x + r));
      }
    }
    // one sweep per row: the window gains row y + r and loses row y − r − 1 (an all-zero row stands in beyond the border)
    const cnt = new Int32Array(W), full = 2 * r + 1, zero = new Uint8Array(W);
    for (let y = 0; y < Math.min(r, H); y++) { const o = y * W; for (let x = 0; x < W; x++) cnt[x] += mid[o + x]; }
    for (let y = 0, o = 0; y < H; y++, o += W) {
      const ia = y + r < H ? mid.subarray((y + r) * W, (y + r + 1) * W) : zero, ib = y - r - 1 >= 0 ? mid.subarray((y - r - 1) * W, (y - r) * W) : zero;
      if (erode) for (let x = 0; x < W; x++) { const c = cnt[x] + ia[x] - ib[x]; cnt[x] = c; out[o + x] = c === full ? 1 : 0; }
      else for (let x = 0; x < W; x++) { const c = cnt[x] + ia[x] - ib[x]; cnt[x] = c; out[o + x] = c > 0 ? 1 : 0; }
    }
    return out;
  }

  /** Closing of radius r on a copy padded by r + 1 (so it is extensive at the image border), cropped back to w × h. */
  function paddedClose(mask, w, h, r) {
    if (r < 1) { const out = new Uint8Array(w * h); for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 1 : 0; return out; }
    const p = r + 1, W = w + 2 * p, H = h + 2 * p, big = new Uint8Array(W * H);
    for (let y = 0; y < h; y++) big.set(mask.subarray(y * w, (y + 1) * w), (y + p) * W + p);   // nonzero = set (sqMorph)
    const c = sqMorph(sqMorph(big, W, H, r, false), W, H, r, true), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) out.set(c.subarray((y + p) * W + p, (y + p) * W + p + w), y * w);
    return out;
  }
  C._paddedClose = paddedClose;   // test hook: compared against SBMorph.close on the padded mask

  /** Zero every 4-connected component whose area·pxUm2 is below minPartUm2 (in place); returns the components kept. */
  function dropSmall(m, w, h, minPartUm2, pxUm2) {
    const rc = runComponents(m, w, h), area = new Float64Array(rc.n);
    for (let i = 0; i < rc.n; i++) area[rc.find(i)] += rc.X1[i] - rc.X0[i];
    let kept = 0;
    for (let i = 0; i < rc.n; i++) if (rc.find(i) === i && area[i] * pxUm2 >= minPartUm2) kept++;
    for (let i = 0; i < rc.n; i++) if (area[rc.find(i)] * pxUm2 < minPartUm2) m.fill(0, rc.Y[i] * w + rc.X0[i], rc.Y[i] * w + rc.X1[i]);
    return kept;
  }

  C.simplifyBusy = function (masks, w, h, opts) {
    checkMasks(masks, w, h);
    const { closeR, minPartUm2, pxUm2 } = simplifyParams(opts);
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

  const DEVICES = ["desktop", "mobile"];
  function deviceLimits(deviceClass) {
    if (!DEVICES.includes(deviceClass)) throw cfail("deviceClass must be desktop|mobile (got " + deviceClass + ")");
    return global.SBSchema.limits(deviceClass);
  }
  // Product-owner decision 2026-10-08: the SRS §12.3 mobile caps are kept, so mobile is limited to simpler art (realistic
  // art at the 1 Mpx mobile budget has about 31,944 vertices after bonded construction, over the 20,000 cap).
  const capNote = (lim) => (lim.deviceClass === "mobile" ? "; mobile is limited to simpler art, so simplify it or open the project on a desktop" : "");
  const diagBase = (o) => ({ quality: o.quality === undefined ? "draft" : o.quality, revision: o.revision === undefined ? null : o.revision });

  C.complexityGate = function (masks, w, h, opts) {
    checkMasks(masks, w, h);
    if (!opts || typeof opts !== "object") throw cfail("complexityGate options required");
    const lim = deviceLimits(opts.deviceClass), simplify = opts.simplify === undefined ? "off" : opts.simplify;
    if (simplify !== "off" && simplify !== "busy") throw cfail("simplify must be off|busy (got " + simplify + ")");
    const base = diagBase(opts), diagnostics = [];
    let cur = masks, simplified = null;
    if (simplify === "busy") {
      const s = C.simplifyBusy(masks, w, h, opts);
      cur = s.masks; simplified = { before: s.before, after: s.after, closeR: s.closeR, minPartUm2: s.minPartUm2 };
      const changed = s.after.filter((n, k) => n !== s.before[k]).length;
      diagnostics.push(global.SBDiag.make("BUSY_SIMPLIFIED", Object.assign({}, base, { counts: { before: s.before, after: s.after },
        detail: changed + " layer(s) changed; parts per layer " + s.before.join("/") + " → " + s.after.join("/") })));
    }
    const estimate = C.estimateComplexity(cur, w, h);
    estimate.partsPerLayer.forEach((n, k) => {
      if (n > lim.maxPartsPerLayer) diagnostics.push(global.SBDiag.make("COMPLEXITY_LIMIT", Object.assign({}, base, { layer: k, deviceClass: lim.deviceClass,
        measured: { value: n, unit: "parts" }, limit: { value: lim.maxPartsPerLayer, unit: "parts" },
        detail: "layer " + k + " has " + n + " parts (limit " + lim.maxPartsPerLayer + " on " + lim.deviceClass + ")" + capNote(lim) })));
    });
    const error = diagnostics.some((d) => d.code === "COMPLEXITY_LIMIT");
    return { status: error ? "error" : "ok", masks: error ? null : (cur === masks ? masks.slice() : cur), estimate, simplified, diagnostics };
  };

  C.vertexGate = function (layers, deviceClass, opts) {
    if (!Array.isArray(layers)) throw cfail("layers must be an array of MaterialLayer");
    const lim = deviceLimits(deviceClass), base = diagBase(opts || {}), diagnostics = [];
    const perLayer = layers.map((l, k) => { const v = l && l.stats ? l.stats.vertices : NaN;
      if (!Number.isSafeInteger(v) || v < 0) throw cfail("layer " + k + " has no integer stats.vertices"); return v; });
    const total = perLayer.reduce((a, v) => a + v, 0);
    const mk = (layer, value, limit, what) => global.SBDiag.make("COMPLEXITY_LIMIT", Object.assign({}, base, { layer, deviceClass: lim.deviceClass,
      measured: { value, unit: "vertices" }, limit: { value: limit, unit: "vertices" }, detail: what + " has " + value + " vertices (limit " + limit + " on " + lim.deviceClass + ")" + capNote(lim) }));
    perLayer.forEach((v, k) => { if (v > lim.maxVerticesPerLayer) diagnostics.push(mk(k, v, lim.maxVerticesPerLayer, "layer " + k)); });
    if (total > lim.maxVerticesTotal) diagnostics.push(mk(null, total, lim.maxVerticesTotal, "the stack"));
    const error = diagnostics.length > 0;
    return { status: error ? "error" : "ok", layers: error ? [] : layers, vertices: { perLayer, total }, diagnostics };
  };

  global.SBConstruct = C;
})(typeof window !== "undefined" ? window : globalThis);
