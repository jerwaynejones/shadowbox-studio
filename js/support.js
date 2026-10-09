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
 *     Speed round F9 (S1): bonded validate = supportPair(layers[k − 1], layers[k], k, cfg) per adjacent pair (the pool's
 *     item) folded by supportFold (BOND_EMPTY_UNDER, reach, edges, one aggregate); validateArgs is its argument check.
 *   annotate(layers, supportGraph) → layers' with Part.supports[] rewritten to part IDs (§3).
 *   featureChecks(layers, cfg) → Diagnostic[] (plan G2.8; GEO-05/06, MAT-03, AT-10, PO-LASER-6), aggregated per
 *     (code, layer[, kind]) through SBDiag.aggregate:
 *       · SAMPLING_LOW (blocking) when minFeatureMM / (samplingMmPerPx ?? mmPerPxMax) < 3 (measured = samples across the
 *         feature, limit 3; the ratio is taken on values rounded to 1e-9 mm and rounded to 1e-9, so 0.3 mm at 0.1 mm/px is
 *         3 samples). Speed round F1 (S4, PO-PERF-4, deviation F-D1): generate passes samplingMmPerPx = the mmPerPxMax of
 *         the FABRICATION raster plan at both qualities, so a draft-only shortfall never blocks; it is reported as
 *         DRAFT_COARSER (info, measured = draft samples, limit 3) when quality is "draft" and minFeatureMM / mmPerPxMax < 3
 *         ≤ the fabrication samples. Without samplingMmPerPx the evaluated raster's mmPerPxMax is judged (unchanged).
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
 *     Speed round F9 (S1): featureChecks = featureHead (checks, MAT_UNCALIBRATED, SAMPLING_LOW/DRAFT_COARSER) +
 *     featureLayer(L, k, cfg) per layer (the pool's item; raw diagnostics) + one SBDiag.aggregate.
 *
 *   checkEnvelope(page, machine, material, {revision, quality}) → Diagnostic[] (plan G2.10a, moved forward from G3.10;
 *     GEO-10, PO-LASER-1/2). page = {wMM, hMM}: the shared extent of every layer sheet, frame included. With machine set
 *     (P = maxProcessingHeightMM, L = maxLengthMM) the page fits iff (W ≤ L ∧ H ≤ P) ∨ (W ≤ P ∧ H ≤ L), compared in integer
 *     µm; otherwise PAGE_OVERFLOW (blocking; measured = the page side that does not fit the processing height in the better
 *     orientation, limit = that height, detail names both sides). material.thicknessMM > maxThicknessMM → MACHINE_THICKNESS
 *     (blocking). machine null → [] (GEO-10's optional bed). Never rescales anything.
 *
 *   Reviewed clip repair (plan G2.9; SUP-04, D-4.6, PRJ-04, LYR-06). Clip-to-lower is never automatic: it exists only as a
 *   reviewed construction.repairs[] entry.
 *   proposeClip(snapshot, k) → {layer, removed = difference(Final[k], Final[k−1]), removedAreaMM2, partCountBefore,
 *       partCountAfter, beforeHash, afterHash (materialHash, D4-B), quality, revision?}. Pure.
 *   applyClip(project, proposal) → a NEW project at revision + 1 with {op: "clip-to-lower", layer, sourceRevision,
 *       resultRevision, keyHash, reviewed: {...}} appended; keyHash = hashJSON(geometryKey(project with repairs
 *       truncated before the entry)). A proposal carrying another revision is refused (never applied silently).
 *   removeRepair(project, i) → a NEW project at revision + 1 without entry i and every later entry (Revert).
 *   replayRepairs(layers, repairs, ctx = {project, quality, revision?}) → {layers, diagnostics, applied: number[]}
 *       After the frame union, before holes and validation. Per entry, in order: keyHash ≠ the current truncated key →
 *       REPAIR_STALE (blocking), skipped; same quality and the pre-repair materialHash = reviewed.beforeHash → applied
 *       (Final[k] = Final[k] ∩ Final[k−1], on the already-replayed lower layer); same quality, other layer →
 *       REPAIR_STALE, skipped; other quality → applied, and a fabrication replay of a draft review raises
 *       REPAIR_REVIEW_FAB (warning; removed mm² and part counts at THIS resolution). A fabrication-reviewed entry in a
 *       draft preview is applied with no diagnostic (draft never exports).
 *
 * Bad arguments throw SUPPORT_ARG. Inputs are never mutated. Looks up SBGeom, SBDiag (and, for repairs, SBMaterial, SBSchema, SBHash) at
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

  /**
   * Speed round F9 (S1): supportPair(lo, up, k, cfg) → {pairs, identical, unsupported, diagnostics}, the per-adjacent-pair
   * kernel of bonded validation (the pool's support item; code moved unchanged from the pair loop). cfg is the
   * S.validate cfg. pairs = [[i, q, areaUm2]…] for every upper part i resting on lower part q (i ascending, then q
   * ascending; areas summed in piece order); diagnostics = the pair's raw, un-aggregated list in today's order
   * (BOND_UNSUPPORTED containment, then per upper part SUPPORT_NARROW / FEATURE_MARGINAL / BOND_UNSUPPORTED, then
   * IDENTICAL_LAYERS). supportFold(layers, cfg, results) is the serial fold (BOND_EMPTY_UNDER, reach, edges, one
   * aggregate). Pure.
   */
  S.supportPair = function (lo, up, k, cfg) {
    const G = global.SBGeom, D = global.SBDiag;
    const dOpts = { revision: cfg.revision === undefined ? 0 : cfg.revision, quality: cfg.quality || "draft" };
    const make = (code, f) => D.make(code, Object.assign({}, dOpts, f));
    const mfUm = Math.round(cfg.minFeatureMM * 1000);
    const advUm = cfg.advisoryFeatureMM === undefined || cfg.advisoryFeatureMM === null ? mfUm : Math.round(cfg.advisoryFeatureMM * 1000);
    const checks = !cfg.graphOnly;
    const upNon = up.material.length > 0, loNon = lo.material.length > 0;
    const diagnostics = [], out = [];
    let unsupported = false;
    // SUP-02: exact containment on polygons (GEO-07)
    const U = cfg.unsupported ? cfg.unsupported[k] || [] : !checks ? null : upNon ? G.difference(up.material, lo.material) : [];
    if (checks) {
      if (!G.isEmpty(U)) {
        const areaMM2 = G.area(U) / 1e6;
        unsupported = true;
        diagnostics.push(make("BOND_UNSUPPORTED", { layer: k, areaMM2, region: regionMM(bboxOf(U)),
          measured: { value: areaMM2, unit: "mm2" }, limit: { value: 0, unit: "mm2" } }));
      }
    }
    if (!upNon) return { pairs: out, identical: false, unsupported, diagnostics };
    // SUP-03: one layer-level boolean; classify, then attribute the non-blocking pieces. With the containment
    // difference U at hand (computed above or reused from the caller), Final[k] ∩ Final[k−1] = Final[k] − U, which is
    // Final[k] itself when U is empty (the normal bonded case: no boolean at all).
    const pieces = !loNon ? [] : U === null ? G.intersection(up.material, lo.material) : G.isEmpty(U) ? up.material : G.difference(up.material, U);
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
    up.parts.forEach((p, i) => {
      const m = pairs.get(i), lows = m ? [...m.keys()].sort((a, b) => a - b) : [];
      for (const q of lows) out.push([i, q, m.get(q).area]);
      for (const q of lows) {
        const e = m.get(q);
        if (e.level !== "warn" && e.level !== "marginal") continue;
        const areaMM2 = e.area / 1e6, region = regionMM(bboxOf(e.pieces));
        if (e.level === "warn") diagnostics.push(make("SUPPORT_NARROW", { layer: k, part: p.id, areaMM2, region,
          limit: { value: mfUm / 1000, unit: "mm" }, detail: "rests on " + lo.parts[q].id + " along a contact narrower than " + mfUm / 1000 + " mm" }));
        else diagnostics.push(make("FEATURE_MARGINAL", { layer: k, part: p.id, areaMM2, region,
          limit: { value: advUm / 1000, unit: "mm" }, detail: { kind: "contact", text: "rests on " + lo.parts[q].id + " along a contact narrower than " + advUm / 1000 + " mm" } }));
      }
      // a part with no support although containment held (sub-µm contact only)
      if (checks && !lows.length && !unsupported) {
        const areaMM2 = G.area([p.polygon]) / 1e6;
        diagnostics.push(make("BOND_UNSUPPORTED", { layer: k, part: p.id, areaMM2, region: regionMM(G.bbox(p.polygon)),
          measured: { value: areaMM2, unit: "mm2" }, limit: { value: 0, unit: "mm2" }, detail: "no support path to the layer below" }));
      }
    });
    // LYR-05: identical consecutive layers are kept and reported
    const identical = loNon && sameMaterial(up.material, lo.material);
    if (identical) diagnostics.push(make("IDENTICAL_LAYERS", { layer: k, detail: "layer " + k + " is identical to layer " + (k - 1) }));
    return { pairs: out, identical, unsupported, diagnostics };
  };

  /** supportFold(layers, cfg, results) → {diagnostics, supportGraph}: results[k − 1] = supportPair(layers[k − 1], layers[k], k, cfg). */
  S.supportFold = function (layers, cfg, results) {
    const D = global.SBDiag;
    const dOpts = { revision: cfg.revision === undefined ? 0 : cfg.revision, quality: cfg.quality || "draft" };
    const make = (code, f) => D.make(code, Object.assign({}, dOpts, f));
    const n = layers.length, nonEmpty = layers.map((L) => L.material.length > 0);
    const checks = !cfg.graphOnly;
    const perLayer = layers.map(() => []), edges = [], reach = layers.map((L, k) => (k === 0 ? L.parts.map(() => true) : []));

    // D-4.7: an empty layer under a non-empty one
    if (checks) {
      let above = false;
      for (let j = n - 1; j >= 0; j--) {
        if (nonEmpty[j]) { above = true; continue; }
        if (above) perLayer[j].push(make("BOND_EMPTY_UNDER", { layer: j, detail: "layer " + j + " is empty under non-empty layers" }));
      }
    }
    for (let k = 1; k < n; k++) {
      const up = layers[k], lo = layers[k - 1], r = results[k - 1];
      perLayer[k].push(...r.diagnostics);
      if (!nonEmpty[k]) continue;
      const lowsOf = new Map();
      for (const [i, q, area] of r.pairs) { let a = lowsOf.get(i); if (!a) lowsOf.set(i, (a = [])); a.push([q, area]); }
      reach[k] = up.parts.map(() => false);
      up.parts.forEach((p, i) => {
        const lows = lowsOf.get(i) || [];
        edges.push({ layer: k, part: p.id, supports: lows.map(([q, area]) => ({ layer: k - 1, part: lo.parts[q].id, areaUm2: area })) });
        reach[k][i] = lows.some(([q]) => reach[k - 1][q]);
      });
    }
    const reachesBase = reach.every((r, k) => k === 0 || layers[k].parts.length === 0 || r.every(Boolean)) &&
      (layers[0].parts.length > 0 || layers.every((L) => L.parts.length === 0));
    return { diagnostics: D.aggregate([].concat(...perLayer)), supportGraph: { edges, reachesBase } };
  };

  function validateBonded(layers, cfg) {
    const results = [];
    for (let k = 1; k < layers.length; k++) results.push(S.supportPair(layers[k - 1], layers[k], k, cfg));
    return S.supportFold(layers, cfg, results);
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
    return mode === "bonded-relief" ? validateBonded(layers, cfg) : validateConnected(layers, dOpts);
  };

  /** Speed round F9: the S.validate argument check alone (the pooled bonded path runs supportPair items, then supportFold). */
  S.validateArgs = function (layers, mode, cfg) { checkArgs(layers, mode, cfg); };

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

  /**
   * Speed round F9 (S1): featureChecks = featureHead (argument checks, MAT_UNCALIBRATED, SAMPLING_LOW / DRAFT_COARSER)
   * + featureLayer per layer (the pool's feature item; raw, un-aggregated) + one SBDiag.aggregate. Code moved unchanged.
   */
  S.featureHead = function (layers, cfg) {
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
    const hasSampling = cfg.samplingMmPerPx !== undefined && cfg.samplingMmPerPx !== null;
    if (hasSampling && !posNum(cfg.samplingMmPerPx)) throw sfail("samplingMmPerPx must be a finite number > 0 (got " + cfg.samplingMmPerPx + ")");
    if (typeof cfg.calibrated !== "boolean") throw sfail("calibrated must be a boolean");
    const D = global.SBDiag;
    const dOpts = { revision: cfg.revision === undefined ? 0 : cfg.revision, quality: cfg.quality || "draft" };
    const make = (code, f) => D.make(code, Object.assign({}, dOpts, f));
    const diags = [];
    if (!cfg.calibrated) diags.push(make("MAT_UNCALIBRATED", { detail: "the minimum feature and part area are provisional" }));
    // in µm, rounded to 1e-9 so that binary-float noise (0.3 / 0.1 = 2.9999999999999996) never creates a shortfall
    const samplesAt = (mmPerPx) => Math.round((Math.round(cfg.minFeatureMM * 1e9) / Math.round(mmPerPx * 1e9)) * 1e9) / 1e9;
    // speed round F1 (S4, PO-PERF-4, F-D1): judged at samplingMmPerPx (the fabrication plan) when given
    const sPitch = hasSampling ? cfg.samplingMmPerPx : cfg.mmPerPxMax, samples = samplesAt(sPitch);
    const r2 = (x) => Math.round(x * 100) / 100;
    if (samples < 3) diags.push(make("SAMPLING_LOW", { measured: { value: samples, unit: "samples" }, limit: { value: 3, unit: "samples" },
      detail: sPitch + " mm/px gives " + r2(samples) + " samples across the " + cfg.minFeatureMM + " mm minimum feature (3 needed)" }));
    else if (dOpts.quality === "draft" && hasSampling) {
      const draftSamples = samplesAt(cfg.mmPerPxMax);
      if (draftSamples < 3) diags.push(make("DRAFT_COARSER", { measured: { value: draftSamples, unit: "samples" }, limit: { value: 3, unit: "samples" },
        detail: "draft is coarser than fabrication; detail is checked at the fabrication pitch (" + sPitch + " mm/px, " + r2(samples) + " samples)" }));
    }
    return diags;
  };

  S.featureLayer = function (L, k, cfg) {
    const G = global.SBGeom, D = global.SBDiag;
    const dOpts = { revision: cfg.revision === undefined ? 0 : cfg.revision, quality: cfg.quality || "draft" };
    const make = (code, f) => D.make(code, Object.assign({}, dOpts, f));
    const hasAdv = cfg.advisoryFeatureMM !== undefined && cfg.advisoryFeatureMM !== null;
    const minPart = cfg.minPartMM2 === undefined || cfg.minPartMM2 === null ? 0 : cfg.minPartMM2;
    const diags = [];
    const mfUm = Math.round(cfg.minFeatureMM * 1000), halfMin = Math.floor(mfUm / 2);
    const advUm = hasAdv ? Math.round(cfg.advisoryFeatureMM * 1000) : mfUm, halfAdv = Math.floor(advUm / 2);
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
    return diags;
  };

  S.featureChecks = function (layers, cfg) {
    const head = S.featureHead(layers, cfg);
    return global.SBDiag.aggregate(head.concat(...layers.map((L, k) => S.featureLayer(L, k, cfg))));
  };

  S.annotate = function (layers, graph) {
    if (!Array.isArray(layers) || !graph || !Array.isArray(graph.edges)) throw sfail("annotate needs layers and a supportGraph");
    const by = new Map(graph.edges.map((e) => [e.layer + "|" + e.part, e.supports.map((s) => s.part)]));
    return layers.map((L) => Object.assign({}, L, { parts: L.parts.map((p) => Object.assign({}, p, { supports: (by.get(L.index + "|" + p.id) || []).slice() })) }));
  };

  // ------------------------------------------------------------ machine envelope (G2.10a; GEO-10, PO-LASER-1/2)
  const umOf = (mm) => Math.round(mm * 1000);
  S.checkEnvelope = function (page, machine, material, opts) {
    if (!page || !posNum(page.wMM) || !posNum(page.hMM)) throw sfail("checkEnvelope needs page {wMM, hMM} > 0");
    if (machine === null || machine === undefined) return [];
    if (typeof machine !== "object" || !posNum(machine.maxProcessingHeightMM) || !posNum(machine.maxLengthMM) || !posNum(machine.maxThicknessMM))
      throw sfail("checkEnvelope needs a machine profile {maxProcessingHeightMM, maxLengthMM, maxThicknessMM} or null");
    const o = opts || {}, dOpts = { revision: o.revision === undefined ? 0 : o.revision, quality: o.quality || "draft" };
    const D = global.SBDiag, out = [], name = machine.name || machine.id || "the machine";
    const W = umOf(page.wMM), H = umOf(page.hMM), P = umOf(machine.maxProcessingHeightMM), L = umOf(machine.maxLengthMM);
    if (!((W <= L && H <= P) || (W <= P && H <= L))) {
      // the side that must pass under the processing height: the shorter one (the better orientation); if that already
      // fits, the overflow is the length
      const short = Math.min(W, H), long = Math.max(W, H), byHeight = short > P;
      out.push(D.make("PAGE_OVERFLOW", Object.assign({}, dOpts, {
        measured: { value: (byHeight ? short : long) / 1000, unit: "mm" }, limit: { value: (byHeight ? P : L) / 1000, unit: "mm" },
        detail: "page " + W / 1000 + " × " + H / 1000 + " mm does not fit " + name + " (" + P / 1000 + " mm processing height × " + L / 1000 +
          " mm length, either orientation)" })));
    }
    if (material && Number.isFinite(material.thicknessMM) && umOf(material.thicknessMM) > umOf(machine.maxThicknessMM)) {
      out.push(D.make("MACHINE_THICKNESS", Object.assign({}, dOpts, {
        measured: { value: umOf(material.thicknessMM) / 1000, unit: "mm" }, limit: { value: umOf(machine.maxThicknessMM) / 1000, unit: "mm" },
        detail: "stock " + umOf(material.thicknessMM) / 1000 + " mm is thicker than the " + umOf(machine.maxThicknessMM) / 1000 + " mm " + name + " accepts" })));
    }
    return out;
  };

  // ------------------------------------------------------------ reviewed clip repair (G2.9; SUP-04, D-4.6, PRJ-04)
  const QUALITIES = ["draft", "fabrication"];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const isHash = (h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h);

  /** Final[k] ∩ Final[k−1] as a rebuilt layer, plus the removed difference (one boolean each). */
  function clipLayer(layers, k, opts) {
    const G = global.SBGeom, up = layers[k], lo = layers[k - 1];
    const removed = G.normalize(G.difference(up.material, lo.material));
    const kept = G.isEmpty(removed) ? up.material : G.intersection(up.material, lo.material);
    return { removed, layer: global.SBMaterial.withMaterial(up, kept, opts) };
  }

  /** geometryKey hash with construction.repairs truncated to its first i entries (keyHash, §3 Repair). */
  function keyHashAt(project, repairs, i) {
    const p = Object.assign({}, project, { construction: Object.assign({}, project.construction, { repairs: repairs.slice(0, i) }) });
    return global.SBHash.hashJSON(global.SBSchema.geometryKey(p));
  }

  S.proposeClip = function (snapshot, k) {
    if (!snapshot || !Array.isArray(snapshot.layers)) throw sfail("proposeClip needs a snapshot with layers[]");
    if (!Number.isInteger(k) || k < 1 || k >= snapshot.layers.length) throw sfail("proposeClip layer must be an integer 1.." + (snapshot.layers.length - 1) + " (got " + k + ")");
    const quality = snapshot.quality || "draft";
    if (!QUALITIES.includes(quality)) throw sfail("snapshot quality must be draft|fabrication (got " + quality + ")");
    const up = snapshot.layers[k];
    if (!up || !Array.isArray(up.material) || !snapshot.layers[k - 1] || !Array.isArray(snapshot.layers[k - 1].material)) throw sfail("layers " + (k - 1) + " and " + k + " must carry material[]");
    const c = clipLayer(snapshot.layers, k, { revision: snapshot.revision, quality });
    const out = { layer: k, removed: c.removed, removedAreaMM2: global.SBGeom.area(c.removed) / 1e6,
      partCountBefore: up.parts.length, partCountAfter: c.layer.parts.length,
      beforeHash: up.canonicalHash || global.SBGeom.materialHash(up), afterHash: c.layer.canonicalHash, quality };
    if (Number.isInteger(snapshot.revision)) out.revision = snapshot.revision;
    return out;
  };

  S.applyClip = function (project, proposal) {
    if (!project || typeof project !== "object" || !project.construction || !Array.isArray(project.construction.repairs) || !Number.isInteger(project.revision))
      throw sfail("applyClip needs a project with revision and construction.repairs[]");
    const pr = proposal;
    if (!pr || typeof pr !== "object" || !Number.isInteger(pr.layer) || pr.layer < 1 || !QUALITIES.includes(pr.quality) || !isHash(pr.beforeHash) || !isHash(pr.afterHash) ||
        !(Number.isFinite(pr.removedAreaMM2) && pr.removedAreaMM2 >= 0) || !Number.isInteger(pr.partCountBefore) || !Number.isInteger(pr.partCountAfter))
      throw sfail("applyClip needs a proposal from proposeClip");
    if (pr.layer >= project.construction.sheets) throw sfail("proposal layer " + pr.layer + " is outside the " + project.construction.sheets + " sheets");
    // A proposal reviewed on another revision is never applied silently (SUP-04).
    if (pr.revision !== undefined && pr.revision !== project.revision) throw sfail("proposal was reviewed on revision " + pr.revision + ", the project is at " + project.revision);
    const p = clone(project), repairs = p.construction.repairs;
    p.revision = project.revision + 1;
    repairs.push({ op: "clip-to-lower", layer: pr.layer, sourceRevision: project.revision, resultRevision: p.revision,
      keyHash: keyHashAt(project, project.construction.repairs, repairs.length),
      reviewed: { quality: pr.quality, beforeHash: pr.beforeHash, afterHash: pr.afterHash, removedAreaMM2: pr.removedAreaMM2,
        partCountBefore: pr.partCountBefore, partCountAfter: pr.partCountAfter } });
    return p;
  };

  S.removeRepair = function (project, i) {
    if (!project || !project.construction || !Array.isArray(project.construction.repairs) || !Number.isInteger(project.revision))
      throw sfail("removeRepair needs a project with revision and construction.repairs[]");
    if (!Number.isInteger(i) || i < 0 || i >= project.construction.repairs.length) throw sfail("removeRepair index out of range (got " + i + ")");
    const p = clone(project);
    p.revision = project.revision + 1;
    p.construction.repairs = p.construction.repairs.slice(0, i);
    return p;
  };

  S.replayRepairs = function (layers, repairs, ctx) {
    if (!Array.isArray(layers)) throw sfail("layers must be a MaterialLayer array");
    if (!Array.isArray(repairs)) throw sfail("repairs must be an array");
    if (!ctx || !ctx.project || !ctx.project.construction || !QUALITIES.includes(ctx.quality)) throw sfail("ctx must be {project, quality: draft|fabrication, revision?}");
    const D = global.SBDiag, quality = ctx.quality, revision = ctx.revision !== undefined ? ctx.revision : ctx.project.revision;
    const dOpts = { revision: revision === undefined ? 0 : revision, quality };
    const out = layers.slice(), diagnostics = [], applied = [];
    repairs.forEach((r, i) => {
      const k = r && r.layer, rv = (r && r.reviewed) || {};
      const stale = (why) => diagnostics.push(D.make("REPAIR_STALE", Object.assign({}, dOpts, { layer: Number.isInteger(k) ? k : null,
        detail: "clip-to-lower " + (i + 1) + " on layer " + k + " " + why + "; review the clip again" })));
      if (!r || r.op !== "clip-to-lower" || !Number.isInteger(k) || k < 1 || k >= out.length) return stale("does not match the current layers");
      // 1. settings changed since the review
      if (r.keyHash !== keyHashAt(ctx.project, repairs, i)) return stale("was reviewed under different settings");
      const pre = out[k], preHash = pre.canonicalHash || global.SBGeom.materialHash(pre);
      if (rv.quality === quality) {
        // 2. same settings and quality: the pre-repair layer must be the reviewed one; 4. otherwise stale
        if (preHash !== rv.beforeHash) return stale("no longer matches the reviewed layer");
        out[k] = clipLayer(out, k, dOpts).layer;
        applied.push(i);
        return;
      }
      // 3. same settings at the other quality: apply; a fabrication replay of a draft review needs a fab re-review
      const c = clipLayer(out, k, dOpts);
      out[k] = c.layer;
      applied.push(i);
      if (quality !== "fabrication") return; // a fab-reviewed clip shown in a draft preview: draft never exports
      const areaMM2 = global.SBGeom.area(c.removed) / 1e6, b = bboxOf(c.removed);
      diagnostics.push(D.make("REPAIR_REVIEW_FAB", Object.assign({}, dOpts, { layer: k, areaMM2, region: regionMM(b),
        measured: { value: areaMM2, unit: "mm2" },
        detail: "clip-to-lower " + (i + 1) + " was reviewed at " + rv.quality + " quality; at this resolution it removes " +
          Math.round(areaMM2 * 100) / 100 + " mm² and parts " + pre.parts.length + " → " + c.layer.parts.length })));
    });
    return { layers: out, diagnostics, applied };
  };

  global.SBSupport = S;
})(typeof window !== "undefined" ? window : globalThis);
