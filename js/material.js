/* ============================================================================
 * Shadowbox Studio — material.js  (SBMaterial, plan G1.1)
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
 *   SBMaterial.smoothStack(loopsByLayer, {tolUm, sxUm, syUm, mode, w?, h?})
 *       → {loopsByLayer, levels, fallbacks} (G1.2, D1): bonded = identity; connected =
 *       per-loop deviation-bounded fallback chaikin → rdp → raw (Chaikin(2)∘RDP(ε),
 *       ε = tolUm / max pitch) with lone-ring and layer topology checks. No
 *       containment fixpoint, no conform, no automatic clip.
 *   SBMaterial.diagnosticsFor(material, layer, {revision, quality}) → Diagnostic[]
 *       SBGeom.validate codes as blocking diagnostics; region = bbox in mm.
 *
 * zBottomMM/zTopMM are null until the Z model (G2.10b); scorePaths and holes are
 * empty until G3; carriers is always [] in v1.0 (GEO-01).
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
  function layerTopology(G, loops, sx, sy) { return G.ringTopology(G.normalize(G.union(G.fromPixelLoops(loops, sx, sy, 0, 0), []))); }
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
   * opts = {tolUm, sxUm, syUm, mode, w?, h?}: with w, h the art-rectangle boundary (x = 0|w, y = 0|h) is pinned.
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
    const W = o.w, H = o.h, pinned = Number.isFinite(W) && Number.isFinite(H) ? (p) => p[0] === 0 || p[1] === 0 || p[0] === W || p[1] === H : () => false;
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
        const rawTopo = layerTopology(G, loops, sx, sy);
        for (let guard = 0; guard < 2 * loops.length + 2 && layerTopology(G, sm, sx, sy) !== rawTopo; guard++) {
          const smUm = sm.map((s, i) => (lv[i] === "raw" ? rawUm[i] : ringUm(s, sx, sy)));
          let culprits = [];
          for (let i = 0; i < sm.length; i++) if (lv[i] !== "raw")
            for (let j = 0; j < sm.length; j++) if (j !== i && ringsTouch(smUm[i], smUm[j])) { culprits.push(i); break; }
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

  M.fromMasks = function (final, w, h, page, opts) {
    opts = opts || {};
    const G = global.SBGeom, T = global.SBTrace;
    if (!page || !finitePos(page.artWMM) || !finitePos(page.artHMM) || !(Number.isFinite(page.frameMM) && page.frameMM >= 0))
      throw new Error("SBMaterial.fromMasks: NONFINITE — page needs finite artWMM, artHMM > 0 and frameMM ≥ 0");
    const { sxUm, syUm } = M.scale({ w, h, artWMM: page.artWMM, artHMM: page.artHMM });
    const fUm = Math.round(page.frameMM * 1000), aw = Math.round(page.artWMM * 1000), ah = Math.round(page.artHMM * 1000);
    if (2 * fUm + Math.max(aw, ah) > G.COORD_LIMIT)
      throw new Error("SBMaterial.fromMasks: COORD_LIMIT — page exceeds ±2^25 µm (" + G.COORD_LIMIT / 1000 + " mm); geometry is never truncated");
    const smooth = opts.smooth || null;
    if (smooth && smooth.mode !== "bonded" && smooth.mode !== "connected")
      throw new Error("SBMaterial.fromMasks: smooth.mode must be connected|bonded (got " + smooth.mode + ")");
    const dOpts = { revision: opts.revision === undefined ? 0 : opts.revision, quality: opts.quality || "draft" };

    // 1–2: classify and trace every layer (null loops = empty layer or the exact full base rectangle)
    const traced = final.map((mask, k) => {
      if (!mask || mask.length !== w * h) throw new Error("SBMaterial.fromMasks: layer " + k + " mask length is not w·h");
      let full = true, any = false;
      for (let i = 0; i < mask.length; i++) { if (mask[i]) any = true; else full = false; if (any && !full) break; }
      return { any, base: any && k === 0 && full, loops: any && !(k === 0 && full) ? T.trace(mask, w, h) : null };
    });
    // 3: smoothing on the pixel loops, never after conversion. D1: bonded is the identity (raw contours).
    let smoothDiags = new Map();
    if (smooth && smooth.mode === "connected") {
      const S = M.smoothStack(traced.map((t) => t.loops || []), { tolUm: smooth.tolUm, sxUm, syUm, mode: "connected", w, h });
      traced.forEach((t, k) => { if (t.loops) t.loops = S.loopsByLayer[k]; });
      smoothDiags = smoothDiagnostics(S.fallbacks, smooth.tolUm, dOpts);
    } else if (smooth && !(Number.isFinite(smooth.tolUm) && smooth.tolUm >= 0)) {
      throw new Error("SBMaterial.fromMasks: NONFINITE — smooth.tolUm must be finite and ≥ 0");
    }

    const layers = traced.map((t, k) => {
      let material;
      if (!t.any) material = [];
      else if (t.base) material = [{ outer: [fUm, fUm, fUm + aw, fUm, fUm + aw, fUm + ah, fUm, fUm + ah], holes: [] }];
      else material = G.normalize(G.union(G.fromPixelLoops(t.loops, sxUm, syUm, fUm, fUm), []));
      const diagnostics = M.diagnosticsFor(material, k, dOpts);
      if (smoothDiags.has(k)) diagnostics.push(smoothDiags.get(k));
      const parts = [], cutPaths = [];
      let area = 0, cut = 0, vertices = 0;
      for (const p of material) {
        const a = polyAreaUm2(p);
        area += a;
        for (const r of ringsOf(p)) { cutPaths.push(r); cut += ringLength(r); vertices += r.length >> 1; }
        parts.push({ id: null, layer: k, polygon: p, bbox: G.bbox(p), areaMM2: a / 1e6, supports: [], guideRefs: [], warnings: [] });
      }
      const L = {
        index: k, zBottomMM: null, zTopMM: null, status: material.length ? "ok" : "empty",
        material, carriers: [], parts, cutPaths, scorePaths: [], holes: [],
        stats: { areaMM2: area / 1e6, cutMM: cut / 1000, vertices }, diagnostics, canonicalHash: null,
      };
      L.canonicalHash = G.materialHash(L);
      return L;
    });
    return M.assignParts(layers);
  };

  global.SBMaterial = M;
})(typeof window !== "undefined" ? window : globalThis);
