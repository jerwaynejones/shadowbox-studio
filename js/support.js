/* ============================================================================
 * Shadowbox Studio — js/support.js
 * ----------------------------------------------------------------------------
 * SBSupport: validation of the FINAL polygons (plan G2.7; D-4.5, D-4.7, SUP-02/03,
 * GEO-02, GEO-07, LYR-05, PO-LASER-6). Masks are never trusted: everything here is
 * computed on MaterialLayer.material (integer µm, D3-normalized).
 *
 *   validate(layers, mode, cfg) → {diagnostics, supportGraph: {edges: [{layer, part,
 *       supports: [{layer, part, areaUm2}]}], reachesBase}}
 *     mode "bonded-relief":
 *       · BOND_EMPTY_UNDER (blocking): an empty layer j with a non-empty layer above it
 *         (reported on j; trailing empty layers are not reported, D-4.7).
 *       · BOND_UNSUPPORTED (blocking): unsupported(k) = difference(Final[k], Final[k−1])
 *         non-empty; areaMM2, region (bbox, mm), measured = area, limit = 0 mm² (SUP-02).
 *         A part with no support although containment held (sub-µm contact only) is
 *         reported the same way, per part.
 *       · Support graph (SUP-03): ONE layer-level boolean per adjacent pair (Appendix C: never
 *         per part pair): intersection(Final[k], Final[k−1]), or, when the containment
 *         difference U = Final[k] − Final[k−1] is at hand (computed for SUP-02 or reused from
 *         the caller's B1 differences), Final[k] − U, i.e. Final[k] itself when U is empty
 *         (no boolean at all in the normal bonded case). Each piece is classified on
 *         the D3 contact width w = 2·r* (certified by SBGeom.insetStatus, the function
 *         behind survivesInset / classifyContact; undecided = not surviving, never
 *         SBGeom.offset) and, unless it blocks, attributed to its upper and lower part by
 *         a bbox sort-and-sweep, ties broken by an even–odd test at the piece's certified
 *         witness (≥ 0.25 µm from every boundary, so a float test is exact enough).
 *         Lower part q supports upper part p iff some piece of p ∩ q has w ≥ 0.5 µm.
 *         Per (p, q) the widest piece decides:
 *           w < 0.5 µm               no support (block)
 *           w < minFeatureUm         SUPPORT_NARROW (warning)
 *           w < advisoryFeatureUm    FEATURE_MARGINAL (warning, detail.kind "contact")
 *         minFeatureUm = Math.round(minFeatureMM·1000), likewise the advisory width, both
 *         rounded BEFORE halving (dyadic insets). The widest test runs first: a piece that
 *         survives the advisory inset is "ok" without the narrower checks. A bbox / area
 *         pre-filter (an inscribed disk of radius d needs a bbox ≥ 2d and an area > 3d²)
 *         skips insets that cannot survive.
 *       · reachesBase: every part's support path reaches layer 0.
 *       · IDENTICAL_LAYERS (info): consecutive non-empty layers with equal material.
 *     mode "connected-sheet": CONNECTED_SPLIT (blocking) for each non-empty layer with
 *       more than one part (measured = parts, limit = 1). Sheets are aligned, not
 *       stacked on each other, so the support graph is empty and reachesBase is true.
 *     cfg = {minFeatureMM (bonded: required, > 0), advisoryFeatureMM? (≥ minFeatureMM;
 *       absent = no advisory tier), revision = 0, quality = "draft",
 *       unsupported?: (PolygonWithHoles[]|null)[] precomputed differences per layer
 *       (index 0 unused; reuse of the B1 differences), graphOnly?: skip containment and
 *       empty-layer checks (support graph and contact diagnostics only)}.
 *     Diagnostics are in layer order and pass through SBDiag.aggregate.
 *   annotate(layers, supportGraph) → layers' with Part.supports[] rewritten to part IDs (§3).
 *   featureChecks(layers, cfg) → Diagnostic[] (plan G2.8; GEO-05/06, MAT-03, AT-10, PO-LASER-6), aggregated per
 *     (code, layer[, kind]) through SBDiag.aggregate:
 *       · SAMPLING_LOW (blocking) when minFeatureMM / mmPerPxMax < 3 (measured = samples across the feature, limit 3;
 *         the ratio is taken on values rounded to 1e-9 mm and rounded to 1e-9, so 0.3 mm at 0.1 mm/px is 3 samples).
 *       · Per part, the miter erosion by the INTEGER halfUm = Math.floor(minFeatureUm / 2), minFeatureUm =
 *         Math.round(minFeatureMM·1000) (D3: SBGeom.offset refuses non-integer deltas; on integer-µm geometry a width
 *         w ≤ 2·halfUm vanishes): empty → PART_THIN, more than one component → NECK_NARROW (warnings).
 *       · Advisory tier (PO-LASER-6): a part that passes both at minFeatureMM but vanishes or splits under the same
 *         erosion at advisoryFeatureMM → FEATURE_MARGINAL (warning, detail.kind "part" | "neck").
 *       · PART_SMALL (warning) when a part's area < minPartMM2; MAT_UNCALIBRATED (warning) when !calibrated.
 *     Appendix C (offsets are the slowest primitive): ONE offset per layer and width, on the union of the parts that
 *     still need it (never per part); a part whose bbox is ≤ 2·halfUm in some direction vanishes without an offset.
 *     On orthogonal layers (bonded, unsmoothed, D1) the advisory erosion is the first residual eroded by the
 *     difference of the half-widths (square erosions compose exactly); other layers are eroded directly.
 *     The residual components are attributed to their parts by the same bbox sweep as the support graph (witness: a
 *     residual vertex, halfUm inside its part). The GEO-05 messages carry SBDiag's conservative-warning note.
 *     cfg = {minFeatureMM > 0, advisoryFeatureMM? (≥ minFeatureMM; absent = no advisory tier), minPartMM2 ≥ 0 (absent
 *       = 0), mmPerPxMax > 0 (the coarser real axis pitch), calibrated: boolean, revision = 0, quality = "draft"}.
 *
 * Bad arguments throw SUPPORT_ARG. Inputs are never mutated. Looks up SBGeom and SBDiag at
 * call time.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const S = {};
  const MODES = ["bonded-relief", "connected-sheet"];
  const LEVEL = { block: 0, warn: 1, marginal: 2, ok: 3 };

  function sfail(msg) { const e = new Error("SUPPORT_ARG: " + msg); e.code = "SUPPORT_ARG"; return e; }
  const posNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

  function checkArgs(layers, mode, cfg) {
    if (!Array.isArray(layers)) throw sfail("layers must be a MaterialLayer array");
    layers.forEach((L, k) => {
      if (!L || !Array.isArray(L.material) || !Array.isArray(L.parts)) throw sfail("layer " + k + " must carry material[] and parts[]");
    });
    if (!MODES.includes(mode)) throw sfail("mode must be " + MODES.join("|") + " (got " + mode + ")");
    if (!cfg || typeof cfg !== "object") throw sfail("cfg must be an object");
    if (mode !== "bonded-relief") return;
    if (!posNum(cfg.minFeatureMM)) throw sfail("minFeatureMM must be a finite number > 0 (got " + cfg.minFeatureMM + ")");
    if (cfg.advisoryFeatureMM !== undefined && cfg.advisoryFeatureMM !== null &&
        !(posNum(cfg.advisoryFeatureMM) && cfg.advisoryFeatureMM >= cfg.minFeatureMM))
      throw sfail("advisoryFeatureMM must be finite and ≥ minFeatureMM (got " + cfg.advisoryFeatureMM + ")");
    if (cfg.unsupported !== undefined && cfg.unsupported !== null &&
        !(Array.isArray(cfg.unsupported) && cfg.unsupported.length === layers.length && cfg.unsupported.every((u, k) => k === 0 || Array.isArray(u))))
      throw sfail("unsupported must hold one difference per layer (index 0 unused)");
  }

  const mm = (v) => v / 1000;
  function bboxOf(polys) {
    const G = global.SBGeom;
    let b = null;
    for (const p of polys) {
      const q = G.bbox(p);
      if (!b) b = q.slice(); else { if (q[0] < b[0]) b[0] = q[0]; if (q[1] < b[1]) b[1] = q[1]; if (q[2] > b[2]) b[2] = q[2]; if (q[3] > b[3]) b[3] = q[3]; }
    }
    return b;
  }
  const regionMM = (b) => (b ? b.map(mm) : null);

  /**
   * Classify one contact piece: {level, witness} with level block|warn|marginal|ok (see header).
   * mfUm / advUm are integer µm (advUm 0 = no advisory tier). The witness {x, y} (float µm) is set
   * for every non-blocking level.
   */
  function classify(piece, mfUm, advUm) {
    const G = global.SBGeom, polys = [piece], b = G.bbox(piece), bw = b[2] - b[0], bh = b[3] - b[1], a = G.area(polys);
    const status = (d) => (bw >= 2 * d && bh >= 2 * d && a > 3 * d * d ? G.insetStatus(polys, d) : { status: "fails" });
    const hit = (level, s) => ({ level, witness: { x: s.witness.X / s.witness.q, y: s.witness.Y / s.witness.q } });
    let s;
    if (advUm > mfUm) { s = status(advUm / 2); if (s.status === "survives") return hit("ok", s); }
    if (mfUm >= 1) { s = status(mfUm / 2); if (s.status === "survives") return hit(advUm > mfUm ? "marginal" : "ok", s); }
    s = status(0.25);
    if (s.status === "survives") return hit(mfUm >= 1 ? "warn" : "ok", s);
    return { level: "block", witness: null };
  }

  /** Even–odd point test on all rings of a polygon (float; the witness has ≥ 0.25 µm clearance). */
  function insidePoly(x, y, poly) {
    let inside = false;
    for (const r of [poly.outer].concat(poly.holes || [])) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = r[2 * j], ay = r[2 * j + 1], bx = r[2 * i], by = r[2 * i + 1];
        if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Bbox sort-and-sweep attribution: for each item (bbox + witness) the index of the part whose bbox contains
   * the item's bbox and, when several do, whose polygon contains the witness. null if none.
   */
  function attribute(items, parts) {
    const pb = parts.map((p, i) => ({ i, b: p.bbox || global.SBGeom.bbox(p.polygon) })).sort((u, v) => u.b[0] - v.b[0] || u.i - v.i);
    const order = items.map((it, j) => j).sort((u, v) => items[u].b[0] - items[v].b[0] || u - v);
    const out = new Array(items.length).fill(null);
    let active = [], next = 0;
    for (const j of order) {
      const ib = items[j].b;
      while (next < pb.length && pb[next].b[0] <= ib[0]) active.push(pb[next++]);
      active = active.filter((e) => e.b[2] >= ib[0]);
      const cand = active.filter((e) => e.b[1] <= ib[1] && e.b[2] >= ib[2] && e.b[3] >= ib[3]);
      if (cand.length === 1) out[j] = cand[0].i;
      else if (cand.length > 1) { // smallest bbox first; the last candidate needs no test (the piece lies in exactly one part)
        const ar = (e) => (e.b[2] - e.b[0]) * (e.b[3] - e.b[1]);
        cand.sort((u, v) => ar(u) - ar(v) || u.i - v.i);
        const w = items[j].witness, hit = cand.slice(0, -1).find((e) => insidePoly(w.x, w.y, parts[e.i].polygon));
        out[j] = hit ? hit.i : cand[cand.length - 1].i;
      }
    }
    return out;
  }

  function sameMaterial(a, b) {
    if (a.length !== b.length) return false;
    const eq = (r, s) => r.length === s.length && r.every((v, i) => v === s[i]);
    return a.every((p, i) => eq(p.outer, b[i].outer) && (p.holes || []).length === (b[i].holes || []).length && (p.holes || []).every((h, j) => eq(h, b[i].holes[j])));
  }

  function validateBonded(layers, cfg, dOpts) {
    const G = global.SBGeom, D = global.SBDiag;
    const make = (code, f) => D.make(code, Object.assign({}, dOpts, f));
    const n = layers.length, nonEmpty = layers.map((L) => L.material.length > 0);
    const mfUm = Math.round(cfg.minFeatureMM * 1000);
    const advUm = cfg.advisoryFeatureMM === undefined || cfg.advisoryFeatureMM === null ? mfUm : Math.round(cfg.advisoryFeatureMM * 1000);
    const checks = !cfg.graphOnly;
    const perLayer = layers.map(() => []), edges = [], reach = layers.map((L, k) => (k === 0 ? L.parts.map(() => true) : []));
    const unsupportedLayer = new Array(n).fill(false);

    // D-4.7: an empty layer under a non-empty one
    if (checks) {
      let above = false;
      for (let j = n - 1; j >= 0; j--) {
        if (nonEmpty[j]) { above = true; continue; }
        if (above) perLayer[j].push(make("BOND_EMPTY_UNDER", { layer: j, detail: "layer " + j + " is empty under non-empty layers" }));
      }
    }
    for (let k = 1; k < n; k++) {
      const up = layers[k], lo = layers[k - 1];
      // SUP-02: exact containment on polygons (GEO-07)
      const U = cfg.unsupported ? cfg.unsupported[k] || [] : !checks ? null : nonEmpty[k] ? G.difference(up.material, lo.material) : [];
      if (checks) {
        if (!G.isEmpty(U)) {
          const areaMM2 = G.area(U) / 1e6;
          unsupportedLayer[k] = true;
          perLayer[k].push(make("BOND_UNSUPPORTED", { layer: k, areaMM2, region: regionMM(bboxOf(U)),
            measured: { value: areaMM2, unit: "mm2" }, limit: { value: 0, unit: "mm2" } }));
        }
      }
      if (!nonEmpty[k]) continue;
      // SUP-03: one layer-level boolean; classify, then attribute the non-blocking pieces. With the containment
      // difference U at hand (computed above or reused from the caller), Final[k] ∩ Final[k−1] = Final[k] − U, which is
      // Final[k] itself when U is empty (the normal bonded case: no boolean at all).
      const pieces = !nonEmpty[k - 1] ? [] : U === null ? G.intersection(up.material, lo.material) : G.isEmpty(U) ? up.material : G.difference(up.material, U);
      const items = [];
      for (const piece of pieces) {
        const c = classify(piece, mfUm, advUm);
        if (c.level !== "block") items.push({ piece, b: G.bbox(piece), witness: c.witness, level: c.level });
      }
      const ua = attribute(items, up.parts), la = attribute(items, lo.parts);
      const pairs = new Map(); // upper index → Map(lower index → {area, level, boxes})
      items.forEach((it, j) => {
        if (ua[j] === null || la[j] === null) return;
        let m = pairs.get(ua[j]); if (!m) pairs.set(ua[j], (m = new Map()));
        let e = m.get(la[j]); if (!e) m.set(la[j], (e = { area: 0, level: "block", pieces: [] }));
        e.area += G.area([it.piece]); e.pieces.push(it.piece);
        if (LEVEL[it.level] > LEVEL[e.level]) e.level = it.level;
      });
      reach[k] = up.parts.map(() => false);
      up.parts.forEach((p, i) => {
        const m = pairs.get(i), lows = m ? [...m.keys()].sort((a, b) => a - b) : [];
        edges.push({ layer: k, part: p.id, supports: lows.map((q) => ({ layer: k - 1, part: lo.parts[q].id, areaUm2: m.get(q).area })) });
        reach[k][i] = lows.some((q) => reach[k - 1][q]);
        for (const q of lows) {
          const e = m.get(q);
          if (e.level !== "warn" && e.level !== "marginal") continue;
          const areaMM2 = e.area / 1e6, region = regionMM(bboxOf(e.pieces));
          if (e.level === "warn") perLayer[k].push(make("SUPPORT_NARROW", { layer: k, part: p.id, areaMM2, region,
            limit: { value: mfUm / 1000, unit: "mm" }, detail: "rests on " + lo.parts[q].id + " along a contact narrower than " + mfUm / 1000 + " mm" }));
          else perLayer[k].push(make("FEATURE_MARGINAL", { layer: k, part: p.id, areaMM2, region,
            limit: { value: advUm / 1000, unit: "mm" }, detail: { kind: "contact", text: "rests on " + lo.parts[q].id + " along a contact narrower than " + advUm / 1000 + " mm" } }));
        }
        // a part with no support although containment held (sub-µm contact only)
        if (checks && !lows.length && !unsupportedLayer[k]) {
          const areaMM2 = G.area([p.polygon]) / 1e6;
          perLayer[k].push(make("BOND_UNSUPPORTED", { layer: k, part: p.id, areaMM2, region: regionMM(G.bbox(p.polygon)),
            measured: { value: areaMM2, unit: "mm2" }, limit: { value: 0, unit: "mm2" }, detail: "no support path to the layer below" }));
        }
      });
      // LYR-05: identical consecutive layers are kept and reported
      if (nonEmpty[k - 1] && sameMaterial(up.material, lo.material))
        perLayer[k].push(make("IDENTICAL_LAYERS", { layer: k, detail: "layer " + k + " is identical to layer " + (k - 1) }));
    }
    const reachesBase = reach.every((r, k) => k === 0 || layers[k].parts.length === 0 || r.every(Boolean)) &&
      (layers[0].parts.length > 0 || layers.every((L) => L.parts.length === 0));
    return { diagnostics: D.aggregate([].concat(...perLayer)), supportGraph: { edges, reachesBase } };
  }

  function validateConnected(layers, dOpts) {
    const D = global.SBDiag, diags = [];
    layers.forEach((L, k) => {
      const c = L.parts.length;
      if (L.material.length && c > 1) diags.push(D.make("CONNECTED_SPLIT", Object.assign({}, dOpts, { layer: k,
        measured: { value: c, unit: "parts" }, limit: { value: 1, unit: "parts" }, detail: "layer " + k + " has " + c + " separate pieces" })));
    });
    return { diagnostics: D.aggregate(diags), supportGraph: { edges: [], reachesBase: true } };
  }

  S.validate = function (layers, mode, cfg) {
    checkArgs(layers, mode, cfg);
    const dOpts = { revision: cfg.revision === undefined ? 0 : cfg.revision, quality: cfg.quality || "draft" };
    return mode === "bonded-relief" ? validateBonded(layers, cfg, dOpts) : validateConnected(layers, dOpts);
  };

  /**
   * Miter erosion by halfUm (integer µm) of src(i) for each part i in idx: {count: Map(i → residual components),
   * residual: Map(i → PolygonWithHoles[])}. src(i) is the part polygon, or (composition, orthogonal layers) its earlier
   * residual. One offset on the union of every src that can survive (Appendix C); a src whose bbox is ≤ 2·halfUm in
   * some direction vanishes without it. Residual components are attributed to their parts by the bbox sweep.
   */
  function erode(parts, idx, halfUm, src) {
    const G = global.SBGeom, count = new Map(), residual = new Map(), need = [];
    for (const i of idx) {
      const polys = src(i);
      count.set(i, 0); residual.set(i, []);
      if (halfUm <= 0) { count.set(i, polys.length); residual.set(i, polys); continue; }
      const b = bboxOf(polys);
      if (b && b[2] - b[0] > 2 * halfUm && b[3] - b[1] > 2 * halfUm) need.push(i);
    }
    if (!need.length) return { count, residual };
    const comps = G.components(G.offset([].concat(...need.map(src)), -halfUm, "miter"));
    const items = comps.map((c) => ({ b: G.bbox(c[0]), witness: { x: c[0].outer[0], y: c[0].outer[1] } }));
    const owner = attribute(items, need.map((i) => parts[i]));
    owner.forEach((j, c) => { if (j === null) return; const i = need[j]; count.set(i, count.get(i) + 1); residual.get(i).push(comps[c][0]); });
    return { count, residual };
  }

  /** True when every edge of every part is axis-parallel (bonded, unsmoothed D1 geometry). */
  function orthogonal(parts) {
    const ringOk = (r) => { const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) if (r[2 * i] !== r[2 * j] && r[2 * i + 1] !== r[2 * j + 1]) return false;
      return true; };
    return parts.every((p) => ringOk(p.polygon.outer) && (p.polygon.holes || []).every(ringOk));
  }

  S.featureChecks = function (layers, cfg) {
    if (!Array.isArray(layers)) throw sfail("layers must be a MaterialLayer array");
    layers.forEach((L, k) => { if (!L || !Array.isArray(L.parts)) throw sfail("layer " + k + " must carry parts[]"); });
    if (!cfg || typeof cfg !== "object") throw sfail("cfg must be an object");
    if (!posNum(cfg.minFeatureMM)) throw sfail("minFeatureMM must be a finite number > 0 (got " + cfg.minFeatureMM + ")");
    const hasAdv = cfg.advisoryFeatureMM !== undefined && cfg.advisoryFeatureMM !== null;
    if (hasAdv && !(posNum(cfg.advisoryFeatureMM) && cfg.advisoryFeatureMM >= cfg.minFeatureMM))
      throw sfail("advisoryFeatureMM must be finite and ≥ minFeatureMM (got " + cfg.advisoryFeatureMM + ")");
    const minPart = cfg.minPartMM2 === undefined || cfg.minPartMM2 === null ? 0 : cfg.minPartMM2;
    if (typeof minPart !== "number" || !Number.isFinite(minPart) || minPart < 0) throw sfail("minPartMM2 must be a finite number ≥ 0 (got " + cfg.minPartMM2 + ")");
    if (!posNum(cfg.mmPerPxMax)) throw sfail("mmPerPxMax must be a finite number > 0 (got " + cfg.mmPerPxMax + ")");
    if (typeof cfg.calibrated !== "boolean") throw sfail("calibrated must be a boolean");
    const G = global.SBGeom, D = global.SBDiag;
    const dOpts = { revision: cfg.revision === undefined ? 0 : cfg.revision, quality: cfg.quality || "draft" };
    const make = (code, f) => D.make(code, Object.assign({}, dOpts, f));
    const diags = [];
    if (!cfg.calibrated) diags.push(make("MAT_UNCALIBRATED", { detail: "the minimum feature and part area are provisional" }));
    // in µm, rounded to 1e-9 so that binary-float noise (0.3 / 0.1 = 2.9999999999999996) never creates a shortfall
    const samples = Math.round((Math.round(cfg.minFeatureMM * 1e9) / Math.round(cfg.mmPerPxMax * 1e9)) * 1e9) / 1e9;
    if (samples < 3) diags.push(make("SAMPLING_LOW", { measured: { value: samples, unit: "samples" }, limit: { value: 3, unit: "samples" },
      detail: cfg.mmPerPxMax + " mm/px gives " + Math.round(samples * 100) / 100 + " samples across the " + cfg.minFeatureMM + " mm minimum feature (3 needed)" }));
    const mfUm = Math.round(cfg.minFeatureMM * 1000), halfMin = Math.floor(mfUm / 2);
    const advUm = hasAdv ? Math.round(cfg.advisoryFeatureMM * 1000) : mfUm, halfAdv = Math.floor(advUm / 2);
    layers.forEach((L, k) => {
      const parts = L.parts, all = parts.map((p, i) => i);
      const e1 = erode(parts, all, halfMin, (i) => [parts[i].polygon]), c1 = e1.count;
      const pass = all.filter((i) => c1.get(i) === 1);
      // Square (miter) erosions compose exactly on orthogonal lattice geometry: erode the first residual by the
      // difference (smaller input, Appendix C). Any other geometry is eroded directly.
      const c2 = halfAdv <= halfMin ? null : orthogonal(parts) ? erode(parts, pass, halfAdv - halfMin, (i) => e1.residual.get(i)).count
        : erode(parts, pass, halfAdv, (i) => [parts[i].polygon]).count;
      parts.forEach((p, i) => {
        const region = regionMM(p.bbox || G.bbox(p.polygon)), areaMM2 = G.area([p.polygon]) / 1e6, base = { layer: k, part: p.id, areaMM2, region };
        if (areaMM2 < minPart) diags.push(make("PART_SMALL", Object.assign({}, base, { measured: { value: areaMM2, unit: "mm2" }, limit: { value: minPart, unit: "mm2" },
          detail: "area " + Math.round(areaMM2 * 100) / 100 + " mm² is below " + minPart + " mm²" })));
        const lim = { value: mfUm / 1000, unit: "mm" }, n1 = c1.get(i);
        if (n1 === 0) diags.push(make("PART_THIN", Object.assign({}, base, { limit: lim, detail: "the part disappears when eroded by half of " + mfUm / 1000 + " mm" })));
        else if (n1 > 1) diags.push(make("NECK_NARROW", Object.assign({}, base, { limit: lim, detail: "the part splits into " + n1 + " pieces when eroded by half of " + mfUm / 1000 + " mm" })));
        else if (c2) {
          const n2 = c2.get(i), alim = { value: advUm / 1000, unit: "mm" };
          if (n2 === 0) diags.push(make("FEATURE_MARGINAL", Object.assign({}, base, { limit: alim, detail: { kind: "part", text: "the part is narrower than the advisory " + advUm / 1000 + " mm" } })));
          else if (n2 > 1) diags.push(make("FEATURE_MARGINAL", Object.assign({}, base, { limit: alim, detail: { kind: "neck", text: "a neck is narrower than the advisory " + advUm / 1000 + " mm" } })));
        }
      });
    });
    return D.aggregate(diags);
  };

  S.annotate = function (layers, graph) {
    if (!Array.isArray(layers) || !graph || !Array.isArray(graph.edges)) throw sfail("annotate needs layers and a supportGraph");
    const by = new Map(graph.edges.map((e) => [e.layer + "|" + e.part, e.supports.map((s) => s.part)]));
    return layers.map((L) => Object.assign({}, L, { parts: L.parts.map((p) => Object.assign({}, p, { supports: (by.get(L.index + "|" + p.id) || []).slice() })) }));
  };

  global.SBSupport = S;
})(typeof window !== "undefined" ? window : globalThis);
