/* ============================================================================
 * Shadowbox Studio — material.js  (SBMaterial, plan G1.1–G1.3)
 * ----------------------------------------------------------------------------
 * Final layer masks → canonical MaterialLayer[] (plan §3, SRS §9.2): integer µm
 * polygons with holes, one polygon per part, deterministic part IDs.
 *
 *   SBMaterial.scale({w, h, artWMM, artHMM}) → {sxUm, syUm, mmPerPxMax}
 *       D-4.2: separate X/Y scales (the art size is first quantized to the
 *       1 µm grid, so w·sxUm and h·syUm land exactly on it); mmPerPxMax is the
 *       GEO-06 sampling input (larger physical pixel dimension).
 *   SBMaterial.fromMasks(final, w, h, page, opts) → MaterialLayer[]
 *       page = {artWMM, artHMM, frameMM}; art is offset by frameMM on both axes.
 *       opts = {revision = 0, quality = "draft", smooth?}. Per layer:
 *         1. k = 0 with a full mask → the exact 4-vertex art rectangle B;
 *         2. trace (SBTrace.trace already merges collinear lattice runs);
 *         3. opts.smooth = {tolUm, mode}: smoothing on the PIXEL loops, never after
 *            conversion (G1.2). D1: mode "bonded" is UNSMOOTHED (raw lattice
 *            contours, identity); mode "connected" runs smoothStack with the art
 *            rectangle pinned and adds one SMOOTH_FALLBACK warning per layer that
 *            had fallbacks. The exact full base rectangle is never smoothed;
 *         4. fromPixelLoops (reverses the trace winding) → union(·, []) (NonZero)
 *            → normalize (D3: T-contacts noded, re-pair, split saddles) → validate;
 *         5. parts = the normalized polygons: after D3 every polygon is exactly one
 *            4-connected part (interiorConnected; equal to SBGeom.components, which
 *            would only repeat the union);
 *         6. stats {areaMM2, cutMM, vertices}; canonicalHash = SBGeom.materialHash
 *            (D4 amendment B); validation errors → blocking SBDiag diagnostics.
 *   SBMaterial.assignParts(layers) → layers
 *       Parts sorted by (layer, bbox minY, minX, −area, ring sequence) and labelled
 *       L{kk}-P{nnn}. The ring sequence is a total order on the normalized
 *       coordinates (it plays the plan's "ringHash" role with no collisions), so
 *       IDs depend only on the material: equal materialHash ⇒ equal IDs (SUP-05).
 *       fromMasks already calls it; it is idempotent and does not mutate input.
 *   SBMaterial.smoothStack(loopsByLayer, {tolUm, sxUm, syUm, mode, w?, h?, frameUm?})
 *       → {loopsByLayer, levels, fallbacks} (G1.2, D1): bonded = identity; connected =
 *       per-loop deviation-bounded fallback chaikin → rdp → raw (Chaikin(2)∘RDP(ε),
 *       ε = tolUm / max pitch) with lone-ring and layer topology checks. No
 *       containment fixpoint, no conform, no automatic clip.
 *   SBMaterial.page(cfg) → {wMM, hMM, artWMM, artHMM, frameMM}   (G1.3)
 *       cfg = {artWMM, artHMM, frameMM} or {artWMM, artHMM, frame: {enabled, widthMM}}; finished size =
 *       art + 2·frame on the 1 µm grid; one page shared by every layer and the proof. A disabled frame is
 *       frameMM 0 (LYR-04: bonded default has no frame).
 *   SBMaterial.applyFrame(layer, page, opts?) → layer'   (G1.3, GEO-02, LYR-04) [UP]
 *       Unions the exact ring rect(page) − rect(art) into the material, after smoothing (art loops only,
 *       art rectangle pinned) and before holes and validation; edge-touching art becomes one polygon with
 *       the frame. frameMM 0 → unchanged. Recomputes parts/IDs, stats, cutPaths, geometry diagnostics and
 *       canonicalHash; keeps other diagnostics (SMOOTH_FALLBACK).
 *   SBMaterial.subtractHoles(layer, holes: {cxUm, cyUm, rUm}[], opts?) → layer'   (G1.3, ASM-04)
 *       Subtracts SBGeom.circle polygons after the frame union, before validation; records the holes in
 *       layer.holes (sorted cy, cx, r), so they enter canonicalHash even where they miss material (D4-A).
 *   fromMasks opts.frame (bool) and opts.holes / opts.holeLayers ("all" | number[]) run the GEO-02 order
 *       in one pass: smoothing → frame union → hole subtraction → normalize → validate → parts. With
 *       opts.frame the connected-mode layer-topology check sees the frame ring (smoothStack frameUm), so
 *       smoothing never merges frame-edge holes or leaves frame-edge slivers (S5 F3).
 *   SBMaterial.withMaterial(layer, material, opts?) → layer'   (G2.9)
 *       The layer rebuilt around new material (clip repair): parts/IDs, stats, cutPaths, geometry
 *       diagnostics and canonicalHash recomputed; holes, Z, carriers, score paths and other diagnostics kept.
 *   SBMaterial.diagnosticsFor(material, layer, {revision, quality}) → Diagnostic[]
 *       SBGeom.validate codes as blocking diagnostics; region = bbox in mm.
 *
 * zBottomMM/zTopMM are null until the Z model (G2.10b); scorePaths are empty until G3; holes
 * are empty unless subtractHoles / opts.holes ran; carriers is always [] in v1.0 (GEO-01).
 * Looks up SBTrace, SBGeom and SBDiag at call time.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const M = {};

  function finitePos(v) { return typeof v === "number" && Number.isFinite(v) && v > 0; }

  M.scale = function ({ w, h, artWMM, artHMM }) {
    if (!finitePos(artWMM) || !finitePos(artHMM) || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1)
      throw new Error("SBMaterial.scale: NONFINITE — art size must be finite and > 0 mm, raster size a positive integer");
    return {
      sxUm: Math.round(artWMM * 1000) / w,
      syUm: Math.round(artHMM * 1000) / h,
      mmPerPxMax: Math.max(artWMM / w, artHMM / h),
    };
  };

  function ringLength(r) {
    let s = 0;
    for (let i = 0, n = r.length; i < n; i += 2) {
      const j = (i + 2) % n, dx = r[j] - r[i], dy = r[j + 1] - r[i + 1];
      s += Math.sqrt(dx * dx + dy * dy);
    }
    return s;
  }
  const ringsOf = (p) => [p.outer].concat(p.holes || []);
  const polyAreaUm2 = (p) => global.SBGeom.area([p]);

  M.diagnosticsFor = function (material, layer, opts) {
    opts = opts || {};
    const G = global.SBGeom, D = global.SBDiag;
    const v = G.validate(material);
    return v.errors.map((e) => {
      const p = material[e.ring.poly];
      let region = null;
      if (p && Array.isArray(p.outer) && p.outer.length >= 2 && p.outer.every(Number.isFinite)) region = G.bbox(p).map((x) => x / 1000);
      return D.make(e.code, { revision: opts.revision === undefined ? 0 : opts.revision, quality: opts.quality || "draft", layer, region });
    });
  };

  function partKey(p) {
    const k = [];
    for (const r of ringsOf(p.polygon)) { k.push(r.length); for (const v of r) k.push(v); }
    return k;
  }
  function cmpSeq(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  }

  M.assignParts = function (layers) {
    return layers.map((L) => {
      const kk = String(L.index).padStart(2, "0");
      const keyed = (L.parts || []).map((p) => ({ p, a: polyAreaUm2(p.polygon), k: partKey(p) }));
      keyed.sort((x, y) => (x.p.layer - y.p.layer) || (x.p.bbox[1] - y.p.bbox[1]) || (x.p.bbox[0] - y.p.bbox[0]) || (y.a - x.a) || cmpSeq(x.k, y.k));
      const parts = keyed.map(({ p }, i) => Object.assign({}, p, { id: "L" + kk + "-P" + String(i + 1).padStart(3, "0") }));
      return Object.assign({}, L, { parts });
    });
  };

  // ------------------------------------------------- bounded smoothing (G1.2, D1)
  const ringUm = (loop, sx, sy) => { const r = new Array(loop.length * 2); for (let i = 0; i < loop.length; i++) { r[2 * i] = Math.round(loop[i][0] * sx); r[2 * i + 1] = Math.round(loop[i][1] * sy); } return r; };
  const sameLoop = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false; return true; };
  /** Topology of one ring on its own (role-free: forced positive): a self-crossing or collapsed ring changes it. */
  function loneTopology(G, r) { return G.ringTopology(G.normalize(G.union([{ outer: r, holes: [] }], []))); }
  /** Layer topology of the art loops; with a frame (fr = {f, aw, ah} µm) the exact frame ring is unioned first (G1.3). */
  function layerTopology(G, loops, sx, sy, fr) {
    if (!fr) return G.ringTopology(G.normalize(G.union(G.fromPixelLoops(loops, sx, sy, 0, 0), [])));
    const f = fr.f, W = fr.aw + 2 * f, H = fr.ah + 2 * f;
    const ring = { outer: [0, 0, W, 0, W, H, 0, H], holes: [[f, f, f, f + fr.ah, f + fr.aw, f + fr.ah, f + fr.aw, f]] };
    return G.ringTopology(G.normalize(G.union(G.fromPixelLoops(loops, sx, sy, f, f), [ring])));
  }
  /** Exact segment contact (crossing or touching) between two flat integer rings, bbox-filtered. */
  function ringsTouch(A, B) {
    const bA = global.SBGeom.bbox({ outer: A }), bB = global.SBGeom.bbox({ outer: B });
    if (bA[0] > bB[2] || bB[0] > bA[2] || bA[1] > bB[3] || bB[1] > bA[3]) return false;
    const x0 = Math.max(bA[0], bB[0]), y0 = Math.max(bA[1], bB[1]), x1 = Math.min(bA[2], bB[2]), y1 = Math.min(bA[3], bB[3]);
    const segs = (R) => { const o = []; for (let i = 0; i < R.length; i += 2) { const j = (i + 2) % R.length;
      if (Math.max(R[i], R[j]) < x0 || Math.min(R[i], R[j]) > x1 || Math.max(R[i + 1], R[j + 1]) < y0 || Math.min(R[i + 1], R[j + 1]) > y1) continue; o.push(i); } return o; };
    const sa = segs(A), sb = segs(B);
    const orient = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    const on = (ax, ay, bx, by, cx, cy) => cx >= Math.min(ax, bx) && cx <= Math.max(ax, bx) && cy >= Math.min(ay, by) && cy <= Math.max(ay, by);
    for (const i of sa) { const j = (i + 2) % A.length, ax = A[i], ay = A[i + 1], bx = A[j], by = A[j + 1];
      for (const k of sb) { const l = (k + 2) % B.length, cx = B[k], cy = B[k + 1], dx = B[l], dy = B[l + 1];
        const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy), o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
        if (o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0 && (o1 || o2 || o3 || o4)) return true;
        if ((o1 === 0 && on(ax, ay, bx, by, cx, cy)) || (o2 === 0 && on(ax, ay, bx, by, dx, dy)) || (o3 === 0 && on(cx, cy, dx, dy, ax, ay)) || (o4 === 0 && on(cx, cy, dx, dy, bx, by))) return true;
      } }
    return false;
  }

  /**
   * D1 smoothing of traced pixel loops, before conversion to µm (plan G1.2):
   *   mode "bonded"    → identity: raw lattice contours, every level "raw", no fallbacks (D1 option (b));
   *   mode "connected" → per loop, the highest level in chaikin → rdp → raw whose densified deviation
   *                      (SBGeom.maxDeviationUm, µm, as rounded for output) is ≤ tolUm and whose lone-ring
   *                      topology is unchanged; then per layer, while the layer topology differs from the raw
   *                      layer's, loops whose smoothed rings touch another loop's ring drop one level (all
   *                      smoothed loops when none touch). All-raw reproduces the raw layer, so this terminates.
   * opts = {tolUm, sxUm, syUm, mode, w?, h?, frameUm?}: with w, h the art-rectangle boundary (x = 0|w, y = 0|h) is pinned.
   * With frameUm > 0 (and w, h) the layer topology is compared with the frame ring unioned in (G1.3, S5 F3): smoothing a
   * corner that met the art boundary at a point must not merge frame-edge holes after the frame union; loops that touch
   * the art rectangle count as culprits for the demotion.
   * ε = tolUm / max(sxUm, syUm) px. No containment fixpoint, no conform, no clip (Appendix C, S2 → D1).
   * Returns {loopsByLayer, levels, fallbacks: [{layer, loopIndex, from, to, reason, devUm}]}; one record per
   * demotion step (devUm is the measured deviation of the level left, null when it was not measured).
   */
  M.smoothStack = function (loopsByLayer, opts) {
    const o = opts || {};
    if (o.mode !== "bonded" && o.mode !== "connected") throw new Error("SBMaterial.smoothStack: mode must be connected|bonded (got " + o.mode + ")");
    if (!(Number.isFinite(o.tolUm) && o.tolUm >= 0)) throw new Error("SBMaterial.smoothStack: NONFINITE — tolUm must be finite and ≥ 0");
    if (!finitePos(o.sxUm) || !finitePos(o.syUm)) throw new Error("SBMaterial.smoothStack: NONFINITE — sxUm and syUm must be finite and > 0");
    if (o.mode === "bonded") // D1 option (b): raw lattice contours; nesting holds by construction
      return { loopsByLayer: loopsByLayer.map((ls) => ls.slice()), levels: loopsByLayer.map((ls) => ls.map(() => "raw")), fallbacks: [] };
    const G = global.SBGeom, T = global.SBTrace, sx = o.sxUm, sy = o.syUm, tol = o.tolUm;
    const eps = tol / Math.max(sx, sy);
    const W = o.w, H = o.h, hasWH = Number.isFinite(W) && Number.isFinite(H), pinned = hasWH ? (p) => p[0] === 0 || p[1] === 0 || p[0] === W || p[1] === H : () => false;
    if (o.frameUm !== undefined && !(Number.isInteger(o.frameUm) && o.frameUm >= 0)) throw new Error("SBMaterial.smoothStack: frameUm must be an integer µm ≥ 0");
    const fr = hasWH && o.frameUm > 0 ? { f: o.frameUm, aw: Math.round(W * sx), ah: Math.round(H * sy) } : null;
    const artRect = fr ? [0, 0, fr.aw, 0, fr.aw, fr.ah, 0, fr.ah] : null;
    const ORDER = ["chaikin", "rdp", "raw"], fallbacks = [], levels = [], out = [];
    loopsByLayer.forEach((loops, k) => {
      const lv = [], sm = [], rawUm = loops.map((lp) => ringUm(lp, sx, sy));
      loops.forEach((lp, i) => {
        let rawTopo = null;
        for (let t = 0; t < ORDER.length; t++) {
          const level = ORDER[t];
          if (level === "raw") { lv.push("raw"); sm.push(lp); break; }
          const s = T.smoothLevel(lp, level, pinned, eps);
          if (sameLoop(s, lp)) { lv.push(level); sm.push(s); break; } // unchanged: deviation 0, topology unchanged
          const su = ringUm(s, sx, sy), d = G.maxDeviationUm(rawUm[i], su);
          let reason = d > tol ? "deviation" : null;
          if (!reason) { if (rawTopo === null) rawTopo = loneTopology(G, rawUm[i]); if (loneTopology(G, su) !== rawTopo) reason = "topology"; }
          if (!reason) { lv.push(level); sm.push(s); break; }
          fallbacks.push({ layer: k, loopIndex: i, from: level, to: ORDER[t + 1], reason, devUm: d });
        }
      });
      // layer-level topology: smoothing must not weld, split or re-nest rings (GEO-04)
      if (lv.some((l) => l !== "raw")) {
        const rawTopo = layerTopology(G, loops, sx, sy, fr);
        for (let guard = 0; guard < 2 * loops.length + 2 && layerTopology(G, sm, sx, sy, fr) !== rawTopo; guard++) {
          const smUm = sm.map((s, i) => (lv[i] === "raw" ? rawUm[i] : ringUm(s, sx, sy)));
          let culprits = [];
          for (let i = 0; i < sm.length; i++) if (lv[i] !== "raw")
            for (let j = -1; j < sm.length; j++) if (j !== i && (j < 0 ? artRect && ringsTouch(smUm[i], artRect) : ringsTouch(smUm[i], smUm[j]))) { culprits.push(i); break; }
          if (!culprits.length) culprits = lv.map((l, i) => (l !== "raw" ? i : -1)).filter((i) => i >= 0);
          for (const i of culprits) {
            const to = ORDER[ORDER.indexOf(lv[i]) + 1];
            fallbacks.push({ layer: k, loopIndex: i, from: lv[i], to, reason: "topology", devUm: null });
            lv[i] = to; sm[i] = to === "raw" ? loops[i] : T.smoothLevel(loops[i], to, pinned, eps);
          }
        }
      }
      levels.push(lv); out.push(sm);
    });
    return { loopsByLayer: out, levels, fallbacks };
  };

  /** SMOOTH_FALLBACK (warning, connected mode only): one per layer, counting the loops that fell back. */
  function smoothDiagnostics(fallbacks, tolUm, dOpts) {
    const byLayer = new Map();
    for (const f of fallbacks) { let g = byLayer.get(f.layer); if (!g) byLayer.set(f.layer, (g = { loops: new Set(), dev: 0, reasons: new Set() })); g.loops.add(f.loopIndex); g.reasons.add(f.reason); if (f.devUm > g.dev) g.dev = f.devUm; }
    const out = new Map();
    for (const [layer, g] of byLayer) out.set(layer, global.SBDiag.make("SMOOTH_FALLBACK", Object.assign({}, dOpts, {
      layer, count: g.loops.size, measured: g.dev > 0 ? { value: g.dev / 1000, unit: "mm" } : null, limit: { value: tolUm / 1000, unit: "mm" },
      detail: g.loops.size + " outline" + (g.loops.size === 1 ? "" : "s") + " kept less smooth (" + Array.from(g.reasons).sort().join(", ") + ")" })));
    return out;
  }

  /**
   * Speed round F9 (S1): fromMasks split into per-layer kernels (the pool's trace/convert items), code moved unchanged.
   *   layerContext(w, h, page, opts) → ctx: plain data shared by every layer (scale, frame ring, sorted holes,
   *     holeLayers, smooth, dOpts); throws the fromMasks argument errors (page, holes, holeLayers, smooth.mode).
   *   traceLayer(mask, k, w, h) → {any, base, loops}: classify (empty / exact full base rectangle) and trace one layer.
   *   smoothTraced(traced, ctx) → traced': step 3, the connected smoothStack barrier (serial, across all layers); layer k's
   *     smoothing fallbacks travel in traced'[k].fallbacks (convertLayer makes its SMOOTH_FALLBACK); the identity
   *     without connected smoothing.
   *   convertLayer(t, k, ctx) → MaterialLayer: µm polygons, frame union, hole subtraction, normalize, buildLayer (parts
   *     not yet numbered: fromMasks ends with assignParts over the whole stack).
   * Pure: no argument is written and no result aliases an argument.
   */
  M.layerContext = function (w, h, page, opts) {
    opts = opts || {};
    const P = pageUm(page, "fromMasks");
    const { sxUm, syUm } = M.scale({ w, h, artWMM: P.page.artWMM, artHMM: P.page.artHMM });
    const holes = holeList(opts.holes || [], "fromMasks"), holeLayers = opts.holeLayers === undefined ? "all" : opts.holeLayers;
    if (holeLayers !== "all" && !(Array.isArray(holeLayers) && holeLayers.every((k) => Number.isInteger(k) && k >= 0)))
      throw new Error("SBMaterial.fromMasks: holeLayers must be \"all\" or an array of layer indices");
    const smooth = opts.smooth || null;
    if (smooth && smooth.mode !== "bonded" && smooth.mode !== "connected")
      throw new Error("SBMaterial.fromMasks: smooth.mode must be connected|bonded (got " + smooth.mode + ")");
    const dOpts = { revision: opts.revision === undefined ? 0 : opts.revision, quality: opts.quality || "draft" };
    return { w, h, sxUm, syUm, fUm: P.fUm, aw: P.aw, ah: P.ah, frameOn: !!opts.frame, frame: opts.frame && P.fUm > 0 ? frameRing(P) : null,
      holes, holeLayers, smooth, dOpts };
  };

  M.traceLayer = function (mask, k, w, h) {
    if (!mask || mask.length !== w * h) throw new Error("SBMaterial.fromMasks: layer " + k + " mask length is not w·h");
    let full = true, any = false;
    for (let i = 0; i < mask.length; i++) { if (mask[i]) any = true; else full = false; if (any && !full) break; }
    return { any, base: any && k === 0 && full, loops: any && !(k === 0 && full) ? global.SBTrace.trace(mask, w, h) : null };
  };

  M.smoothTraced = function (traced, ctx) {
    const smooth = ctx.smooth;
    // 3: smoothing on the pixel loops, never after conversion. D1: bonded is the identity (raw contours).
    if (smooth && smooth.mode === "connected") {
      const S = M.smoothStack(traced.map((t) => t.loops || []), { tolUm: smooth.tolUm, sxUm: ctx.sxUm, syUm: ctx.syUm, mode: "connected", w: ctx.w, h: ctx.h, frameUm: ctx.frameOn ? ctx.fUm : 0 });
      return traced.map((t, k) => {
        const o = Object.assign({}, t), fb = S.fallbacks.filter((f) => f.layer === k);
        if (t.loops) o.loops = S.loopsByLayer[k];
        if (fb.length) o.fallbacks = fb;   // convertLayer builds layer k's SMOOTH_FALLBACK from them
        return o;
      });
    } else if (smooth && !(Number.isFinite(smooth.tolUm) && smooth.tolUm >= 0)) {
      throw new Error("SBMaterial.fromMasks: NONFINITE — smooth.tolUm must be finite and ≥ 0");
    }
    return traced;
  };

  M.convertLayer = function (t, k, ctx) {
    const G = global.SBGeom, fUm = ctx.fUm, aw = ctx.aw, ah = ctx.ah, holes = ctx.holes, holeLayers = ctx.holeLayers;
    // 4–6: µm polygons; then (GEO-02 order) frame union → hole subtraction → normalize → validate → parts
    let material;
    if (!t.any) material = [];
    else if (t.base) material = [{ outer: [fUm, fUm, fUm + aw, fUm, fUm + aw, fUm + ah, fUm, fUm + ah], holes: [] }];
    else material = G.normalize(G.union(G.fromPixelLoops(t.loops, ctx.sxUm, ctx.syUm, fUm, fUm), []));
    if (ctx.frame) material = G.normalize(G.union(material, [ctx.frame]));
    const lh = holeLayers === "all" || holeLayers.includes(k) ? holes : [];
    if (lh.length) material = G.normalize(G.difference(material, lh.map(circleOf)));
    const extra = t.fallbacks && t.fallbacks.length ? [smoothDiagnostics(t.fallbacks, ctx.smooth.tolUm, ctx.dOpts).get(k)] : [];
    return buildLayer(k, material, lh, ctx.dOpts, extra);
  };

  M.fromMasks = function (final, w, h, page, opts) {
    const ctx = M.layerContext(w, h, page, opts);
    // 1–2: classify and trace every layer (null loops = empty layer or the exact full base rectangle)
    const traced = M.smoothTraced(final.map((mask, k) => M.traceLayer(mask, k, w, h)), ctx);
    return M.assignParts(traced.map((t, k) => M.convertLayer(t, k, ctx)));
  };

  // ------------------------------------------- the page model, frame and holes (G1.3, GEO-02, LYR-04)
  /** Validated page in integer µm: {page, fUm, aw, ah, W, H}. Accepts {frameMM} or the construction.frame shape. */
  function pageUm(cfg, who) {
    const G = global.SBGeom;
    if (!cfg || typeof cfg !== "object") throw new Error("SBMaterial." + who + ": NONFINITE — page config required");
    let frameMM = cfg.frameMM;
    if (frameMM === undefined && cfg.frame && typeof cfg.frame === "object") frameMM = cfg.frame.enabled ? cfg.frame.widthMM : 0;
    if (!finitePos(cfg.artWMM) || !finitePos(cfg.artHMM) || !(Number.isFinite(frameMM) && frameMM >= 0))
      throw new Error("SBMaterial." + who + ": NONFINITE — page needs finite artWMM, artHMM > 0 and frameMM ≥ 0");
    const fUm = Math.round(frameMM * 1000), aw = Math.round(cfg.artWMM * 1000), ah = Math.round(cfg.artHMM * 1000);
    if (aw < 1 || ah < 1) throw new Error("SBMaterial." + who + ": NONFINITE — art size rounds to 0 µm");
    const W = aw + 2 * fUm, H = ah + 2 * fUm;
    if (Math.max(W, H) > G.COORD_LIMIT)
      throw new Error("SBMaterial." + who + ": COORD_LIMIT — page exceeds ±2^25 µm (" + G.COORD_LIMIT / 1000 + " mm); geometry is never truncated");
    return { page: { wMM: W / 1000, hMM: H / 1000, artWMM: aw / 1000, artHMM: ah / 1000, frameMM: fUm / 1000 }, fUm, aw, ah, W, H };
  }

  /**
   * SBMaterial.page(cfg) → {wMM, hMM, artWMM, artHMM, frameMM}. cfg = {artWMM, artHMM, frameMM} or
   * {artWMM, artHMM, frame: {enabled, widthMM}} (a disabled frame is frameMM 0: LYR-04 bonded default).
   * Finished size = art + 2·frame, every dimension on the 1 µm grid. One page is shared by every layer and the proof.
   */
  M.page = (cfg) => pageUm(cfg, "page").page;

  /** The exact frame ring rect(page) − rect(art), as one polygon with one hole. */
  function frameRing(P) {
    const f = P.fUm;
    return { outer: [0, 0, P.W, 0, P.W, P.H, 0, P.H], holes: [[f, f, f, f + P.ah, f + P.aw, f + P.ah, f + P.aw, f]] };
  }

  /** Validated, canonically sorted (cy, cx, r) copy of {cxUm, cyUm, rUm}[] (D4 amendment A order). */
  function holeList(holes, who) {
    if (!Array.isArray(holes)) throw new Error("SBMaterial." + who + ": holes must be an array of {cxUm, cyUm, rUm}");
    const out = holes.map((h) => {
      if (!h || !Number.isInteger(h.cxUm) || !Number.isInteger(h.cyUm) || !Number.isInteger(h.rUm) || h.rUm < 1)
        throw new Error("SBMaterial." + who + ": REG_HOLE_INVALID — hole centre and radius must be integer µm, r ≥ 1");
      return { cxUm: h.cxUm, cyUm: h.cyUm, rUm: h.rUm };
    });
    return out.sort((a, b) => (a.cyUm - b.cyUm) || (a.cxUm - b.cxUm) || (a.rUm - b.rUm));
  }
  const circleOf = (h) => global.SBGeom.circle(h.cxUm, h.cyUm, h.rUm);

  const VALIDATE_CODES = new Set(["GEO_SELF_INTERSECT", "GEO_ZERO_AREA", "GEO_DUPLICATE", "GEO_OPEN", "GEO_MULTIPART"]);
  /** Rebuild options for a derived layer: geometry diagnostics are recomputed, all others carried over. */
  function rebuildOpts(layer, opts) {
    opts = opts || {};
    const prev = layer.diagnostics || [], first = prev[0] || {};
    return {
      dOpts: { revision: opts.revision !== undefined ? opts.revision : first.revision !== undefined ? first.revision : 0, quality: opts.quality || first.quality || "draft" },
      keep: prev.filter((d) => !VALIDATE_CODES.has(d.code)),
    };
  }

  /**
   * applyFrame(layer, page, opts?) → new MaterialLayer with the exact frame ring unioned into its material
   * (GEO-02, LYR-04). Runs after bounded smoothing (which only touched art loops, art rectangle pinned) and
   * before hole subtraction and validation. frameMM 0 → the layer is returned unchanged. Idempotent; the input
   * is not mutated. Parts, stats, cutPaths, geometry diagnostics and canonicalHash are recomputed.
   */
  M.applyFrame = function (layer, page, opts) {
    const P = pageUm(page, "applyFrame");
    if (P.fUm === 0) return layer;
    const G = global.SBGeom, r = rebuildOpts(layer, opts);
    const material = G.normalize(G.union(layer.material || [], [frameRing(P)]));
    return M.assignParts([buildLayer(layer.index, material, layer.holes || [], r.dOpts, r.keep, layer)])[0];
  };

  /**
   * subtractHoles(layer, holes: {cxUm, cyUm, rUm}[], opts?) → new MaterialLayer with SBGeom.circle polygons
   * subtracted (after the frame union, before validation: GEO-02 order). The holes are recorded in layer.holes
   * (sorted by cy, cx, r) and so enter canonicalHash even where they miss material (D4 amendment A).
   */
  M.subtractHoles = function (layer, holes, opts) {
    const hs = holeList(holes, "subtractHoles");
    if (!hs.length) return layer;
    const G = global.SBGeom, r = rebuildOpts(layer, opts);
    const material = G.normalize(G.difference(layer.material || [], hs.map(circleOf)));
    const all = holeList((layer.holes || []).concat(hs), "subtractHoles");
    return M.assignParts([buildLayer(layer.index, material, all, r.dOpts, r.keep, layer)])[0];
  };

  /**
   * withMaterial(layer, material, opts?) → new MaterialLayer with `material` (normalized here) in place of the layer's
   * (G2.9 clip repair). Holes, Z, carriers and score paths are carried over; parts/IDs, stats, cutPaths, geometry
   * diagnostics and canonicalHash are recomputed; other diagnostics are kept. The input is not mutated.
   */
  M.withMaterial = function (layer, material, opts) {
    if (!layer || !Array.isArray(material)) throw new Error("SBMaterial.withMaterial: needs a layer and a PolygonWithHoles[]");
    const r = rebuildOpts(layer, opts);
    return M.assignParts([buildLayer(layer.index, global.SBGeom.normalize(material), layer.holes || [], r.dOpts, r.keep, layer)])[0];
  };

  /** MaterialLayer from normalized material (§3, §9.2); `from` carries zBottomMM/zTopMM/carriers/scorePaths over. */
  function buildLayer(k, material, holes, dOpts, extraDiags, from) {
    const G = global.SBGeom;
    const diagnostics = M.diagnosticsFor(material, k, dOpts).concat(extraDiags || []);
    const parts = [], cutPaths = [];
    let area = 0, cut = 0, vertices = 0;
    for (const p of material) {
      const a = polyAreaUm2(p);
      area += a;
      for (const r of ringsOf(p)) { cutPaths.push(r); cut += ringLength(r); vertices += r.length >> 1; }
      parts.push({ id: null, layer: k, polygon: p, bbox: G.bbox(p), areaMM2: a / 1e6, supports: [], guideRefs: [], warnings: [] });
    }
    const L = {
      index: k, zBottomMM: from ? from.zBottomMM : null, zTopMM: from ? from.zTopMM : null, status: material.length ? "ok" : "empty",
      material, carriers: from && from.carriers ? from.carriers : [], parts, cutPaths, scorePaths: from && from.scorePaths ? from.scorePaths : [],
      holes: holes.map((h) => ({ cxUm: h.cxUm, cyUm: h.cyUm, rUm: h.rUm })),
      stats: { areaMM2: area / 1e6, cutMM: cut / 1000, vertices }, diagnostics, canonicalHash: null,
    };
    L.canonicalHash = G.materialHash(L);
    return L;
  }

  global.SBMaterial = M;
})(typeof window !== "undefined" ? window : globalThis);
