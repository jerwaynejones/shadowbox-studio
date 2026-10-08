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
 *         3. smoothing — D1: bonded mode is UNSMOOTHED (raw lattice contours,
 *            identity); connected-mode smoothing on the pixel loops is G1.2 and
 *            is refused here rather than silently skipped;
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
    if (smooth && smooth.mode !== "bonded")
      throw new Error("SBMaterial.fromMasks: connected-mode smoothing is implemented in G1.2 (smoothStack); not available yet");
    // D1: bonded smoothing is the identity — raw lattice contours, nesting holds by construction.
    const dOpts = { revision: opts.revision === undefined ? 0 : opts.revision, quality: opts.quality || "draft" };

    const layers = final.map((mask, k) => {
      if (!mask || mask.length !== w * h) throw new Error("SBMaterial.fromMasks: layer " + k + " mask length is not w·h");
      let full = true, any = false;
      for (let i = 0; i < mask.length; i++) { if (mask[i]) any = true; else full = false; if (any && !full) break; }
      let material;
      if (!any) material = [];
      else if (k === 0 && full) material = [{ outer: [fUm, fUm, fUm + aw, fUm, fUm + aw, fUm + ah, fUm, fUm + ah], holes: [] }];
      else material = G.normalize(G.union(G.fromPixelLoops(T.trace(mask, w, h), sxUm, syUm, fUm, fUm), []));
      const diagnostics = M.diagnosticsFor(material, k, dOpts);
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
