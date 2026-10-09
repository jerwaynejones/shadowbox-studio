/* ============================================================================
 * Shadowbox Studio — proof.js  (SBProof, G2.12)
 * ----------------------------------------------------------------------------
 * Pure models behind the opaque review views (UI-02, UI-03, MAT-04, GEO-01):
 *
 *   model(layers, colors, {edgeStroke})  → [{layerIndex, fill, stroke, rings}]   back to front
 *   section(layers, yMM, {tMM, gMM})     → [{layerIndex, z0, z1, intervals: [[x0MM, x1MM]]}]
 *   drawParams(mode)                     → {smoothing, shadows, parallax, illustrative}
 *   modelHash(model)                     → sha256 hex of the model
 *   cards(layers, page)                  → [{layerIndex, role, empty, retainedMM2, wasteMM2, retainedPct}]  (G2.13a)
 *   overlays({cleanupReport, diagnostics, mode}) → [{layerIndex, label, holesFilled, partsRemoved, added, removed, bridges, unsupported}]  (G2.13b)
 *   predictFabComplexity(draftSnapshot, {rasterW, rasterH}, limits) → {scale, verticesPerLayerMax, verticesTotal,
 *                                        partsPerLayerMax, over: string[], ...}  (alpha.3 E8, §12.3)
 *   panelModel(shown, fabPlanDiagnostics, prediction?) → {groups: [{title, items, ackable, note?}]}  (alpha.3 E8, NFR-04)
 *
 * Everything is read from layer.material (the canonical polygons that also feed layerSVG and assemblySVG),
 * so the on-screen proof, the section and the cut files share one source. Fill and edge-stroke rules come from
 * SBSvg.paint, the helper assemblySVG uses, so the proof and proof.svg cannot drift. Appearance never touches
 * geometry: nothing here mutates a layer or enters a geometry hash. No DOM.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const P = {};
  const MODES = Object.freeze({
    proof: Object.freeze({ smoothing: false, shadows: false, parallax: false, illustrative: false }),
    section: Object.freeze({ smoothing: false, shadows: false, parallax: false, illustrative: false }),
    tilt: Object.freeze({ smoothing: true, shadows: true, parallax: true, illustrative: true }),
  });
  P.MODES = Object.freeze(Object.keys(MODES));

  /** Draw parameters per preview mode. proof and section are exact (no smoothing, shadows or parallax); tilt is illustrative. */
  P.drawParams = function (mode) {
    if (!Object.prototype.hasOwnProperty.call(MODES, mode)) throw new Error("SBProof.drawParams: MODE — unknown mode " + JSON.stringify(mode));
    return MODES[mode];
  };

  /**
   * Retained/waste proof model: one entry per non-empty layer, back to front by index. rings are the layer's
   * material rings (outer, then its holes, per polygon) in µm, painted even-odd; everything else on the page is
   * waste. colors is one hex (uniform) or a palette indexed by layer.index. edgeStroke defaults to true when the
   * appearance is uniform, as in assemblySVG.
   */
  P.model = function (layers, colors, opts) {
    const { layers: L, fills, strokes } = global.SBSvg.paint(layers, colors, opts, "SBProof.model");   // the assemblySVG rule
    return L.map((l, j) => {
      const rings = [];
      for (const p of l.material) { rings.push(p.outer.slice()); for (const h of p.holes || []) rings.push(h.slice()); }
      return { layerIndex: l.index, fill: fills[j], stroke: strokes[j], rings };
    });
  };

  /** Deterministic fingerprint of a proof model (appearance included; never part of geometryHash). */
  P.modelHash = (model) => global.SBHash.hashJSON(model);

  const um = (mm) => Math.round(mm * 1000);

  /**
   * Stack section along the horizontal line y = yMM (page frame, Y-down). Every layer (empty ones too) gets its
   * real Z band from the material thickness t and the gap g: z0 = index·(t + g), z1 = z0 + t (bonded g = 0), on
   * the 1 µm grid. intervals are the even-odd material spans on the scanline in mm, sorted, with abutting spans
   * merged. Crossings use the half-open rule (an edge counts when y lies in [min(y0,y1), max(y0,y1))), so a
   * scanline through a vertex row is never double counted.
   */
  P.section = function (layers, yMM, opts) {
    const o = opts || {};
    if (!Number.isFinite(yMM)) throw new Error("SBProof.section: NONFINITE — yMM must be finite");
    if (!(Number.isFinite(o.tMM) && o.tMM > 0)) throw new Error("SBProof.section: NONFINITE — tMM must be finite and > 0");
    if (!(Number.isFinite(o.gMM) && o.gMM >= 0)) throw new Error("SBProof.section: NONFINITE — gMM must be finite and >= 0");
    const y = um(yMM), tU = um(o.tMM), pitch = tU + um(o.gMM);
    const L = (layers || []).filter((l) => l && Number.isInteger(l.index)).slice().sort((a, b) => a.index - b.index);
    return L.map((l) => {
      const xs = [];
      for (const p of l.material || []) for (const r of [p.outer, ...(p.holes || [])]) {
        const n = r.length >> 1;
        for (let i = 0; i < n; i++) {
          const x0 = r[2 * i], y0 = r[2 * i + 1], j = (i + 1) % n, x1 = r[2 * j], y1 = r[2 * j + 1];
          if ((y0 <= y) !== (y1 <= y)) xs.push(Math.round(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)));
        }
      }
      xs.sort((a, b) => a - b);
      const iv = [];
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i] === xs[i + 1]) continue;
        const last = iv[iv.length - 1];
        if (last && last[1] === xs[i]) last[1] = xs[i + 1]; else iv.push([xs[i], xs[i + 1]]);
      }
      const z0 = l.index * pitch;
      return { layerIndex: l.index, z0: z0 / 1000, z1: (z0 + tU) / 1000, intervals: iv.map(([a, b]) => [a / 1000, b / 1000]) };
    });
  };

  /**
   * Retained/waste figures for the Layers cards (G2.13a), one per layer (empty ones too), back to front by index.
   * retainedMM2 is SBGeom.area(layer.material) (the same polygons the proof and the cut files draw); wasteMM2 is
   * the rest of the shared page (frame included), so retained + waste = page area. role: the first card is the
   * backing, the last the front, the others mid. omitted (alpha.3 E2, LYR-01): layer.status is "omitted-trailing".
   * Cut length is not computed here; cards read layer.stats.cutMM (SBMaterial).
   */
  P.cards = function (layers, page) {
    const pg = page || {};
    if (!(Number.isFinite(pg.wMM) && pg.wMM > 0 && Number.isFinite(pg.hMM) && pg.hMM > 0))
      throw new Error("SBProof.cards: NONFINITE — page wMM and hMM must be finite and > 0");
    const L = (layers || []).filter(Boolean).slice();
    for (const l of L) if (!Number.isInteger(l.index)) throw new Error("SBProof.cards: NONINTEGER — layer.index must be an integer");
    L.sort((a, b) => a.index - b.index);
    const pageMM2 = pg.wMM * pg.hMM, n = L.length;
    return L.map((l, k) => {
      const mat = l.material || [];
      const retainedMM2 = Math.min(pageMM2, global.SBGeom.area(mat) / 1e6);
      return {
        layerIndex: l.index,
        role: k === 0 ? "backing" : k === n - 1 ? "front" : "mid",
        empty: retainedMM2 === 0,
        retainedMM2,
        wasteMM2: pageMM2 - retainedMM2,
        retainedPct: (100 * retainedMM2) / pageMM2,
        omitted: l.status === "omitted-trailing",   // alpha.3 E2 (LYR-01)
      };
    });
  };

  const fmtMM2 = (v) => String(Math.round(v * 100) / 100);
  const OVERLAY_MODES = ["connected-sheet", "bonded-relief"];

  /**
   * G2.13b (GEO-08, UI-05): the change-overlay model, one entry per cleanupReport layer:
   *   {layerIndex, addedMM2, removedMM2, holesFilled, partsRemoved, label, added, removed, bridges,
   *    unsupported: [{areaMM2, region}]}
   * added/removed are the report's change polygons (µm; null when absent — a fabrication report carries mm²
   * only), label "+a mm² / −r mm² / h holes filled / p parts removed" (zero terms omitted; "" when nothing
   * changed), bridges only in connected-sheet mode, unsupported
   * from BOND_UNSUPPORTED diagnostics (region = bbox in mm). The report is not copied or mutated.
   */
  P.overlays = function (input) {
    const mode = input && input.mode;
    if (!OVERLAY_MODES.includes(mode)) throw new Error("SBProof.overlays: MODE — construction mode must be connected-sheet|bonded-relief (got " + JSON.stringify(mode) + ")");
    const diags = input.diagnostics || [];
    return (input.cleanupReport || []).map((c) => {
      const parts = [];
      if (c.addedMM2 > 0) parts.push("+" + fmtMM2(c.addedMM2) + " mm²");
      if (c.removedMM2 > 0) parts.push("−" + fmtMM2(c.removedMM2) + " mm²");
      const holesFilled = c.holesFilled || 0, partsRemoved = c.partsRemoved || 0;
      if (holesFilled > 0) parts.push(holesFilled + (holesFilled === 1 ? " hole" : " holes") + " filled");
      if (partsRemoved > 0) parts.push(partsRemoved + (partsRemoved === 1 ? " part" : " parts") + " removed");
      return {
        layerIndex: c.layer, addedMM2: c.addedMM2, removedMM2: c.removedMM2, holesFilled, partsRemoved, label: parts.join(" / "),
        added: c.added || null, removed: c.removed || null,
        bridges: mode === "connected-sheet" && c.bridges ? c.bridges : null,
        unsupported: diags.filter((d) => d.code === "BOND_UNSUPPORTED" && d.layer === c.layer).map((d) => ({ areaMM2: d.areaMM2, region: d.region })),
      };
    });
  };

  // ------------------------------------------------------------ clip dialog model (G2.13d; SUP-04, D-4.6, PRJ-04)
  const layerName = (k) => "Layer " + (k + 1);
  const ringsOfPolys = (polys) => { const r = []; for (const p of polys || []) { r.push(p.outer); for (const h of p.holes || []) r.push(h); } return r; };

  /**
   * clipReview(proposal) → {layer, title, removedMM2, partCountBefore, partCountAfter, empty, summary, rings}: the clip
   * dialog's text for one SBSupport.proposeClip result (1-based layer names; rings = the removed polygons' rings in µm,
   * page frame, for the overlay). empty = nothing would be removed. The proposal is not copied or mutated.
   */
  P.clipReview = function (pr) {
    if (!pr || !Number.isInteger(pr.layer) || pr.layer < 1 || !Number.isFinite(pr.removedAreaMM2))
      throw new Error("SBProof.clipReview: needs a proposal from SBSupport.proposeClip");
    const k = pr.layer, empty = !(pr.removedAreaMM2 > 0);
    const summary = empty
      ? layerName(k) + " lies entirely on " + layerName(k - 1) + ": there is nothing to clip."
      : "Removes " + fmtMM2(pr.removedAreaMM2) + " mm² of " + layerName(k) + " that has no material of " + layerName(k - 1) +
        " under it; parts " + pr.partCountBefore + " → " + pr.partCountAfter + ". Reviewed at " + pr.quality + " quality.";
    return { layer: k, title: "Clip " + layerName(k) + " to " + layerName(k - 1), removedMM2: pr.removedAreaMM2,
      partCountBefore: pr.partCountBefore, partCountAfter: pr.partCountAfter, empty, summary, rings: ringsOfPolys(pr.removed) };
  };

  /**
   * repairRows(repairs, {applied}) → [{index, layer, status: "applied" | "stale" | "pending", laterCount, text}]: one
   * row per construction.repairs entry for the Repairs list (each with a Revert button). status "stale" = not replayed
   * on the shown result (REPAIR_STALE); "pending" = no current result (applied not given); laterCount = the later entries a Revert of this one also removes (removeRepair).
   */
  P.repairRows = function (repairs, ctx) {
    const applied = ctx && Array.isArray(ctx.applied) ? ctx.applied : null;
    const n = (repairs || []).length;
    return (repairs || []).map((r, i) => {
      const rv = (r && r.reviewed) || {}, k = r && r.layer;
      const status = !applied ? "pending" : applied.includes(i) ? "applied" : "stale";
      const text = "Clip " + layerName(k) + " to " + layerName(k - 1) + " (revision " + r.sourceRevision + " → " + r.resultRevision +
        "; reviewed at " + rv.quality + ": −" + fmtMM2(rv.removedAreaMM2 || 0) + " mm², parts " + rv.partCountBefore + " → " + rv.partCountAfter + "). " +
        (status === "pending" ? "Checked when the result is built." : status === "applied" ? "Applied." : "Not applied: the settings or the layer changed since the review; review the clip again or revert it.");
      return { index: i, layer: k, status, laterCount: n - 1 - i, text };
    });
  };

  /**
   * repairForDiagnostic(d, repairs, applied) → the construction.repairs index a repair diagnostic refers to, or −1:
   * REPAIR_STALE → the first entry on d.layer that was not replayed; REPAIR_REVIEW_FAB → the first replayed one.
   */
  P.repairForDiagnostic = function (d, repairs, applied) {
    if (!d || (d.code !== "REPAIR_STALE" && d.code !== "REPAIR_REVIEW_FAB")) return -1;
    const done = applied || [], want = d.code === "REPAIR_REVIEW_FAB";
    return (repairs || []).findIndex((r, i) => r && r.layer === d.layer && done.includes(i) === want);
  };

  // ------------------------------------------------------------ fabrication outlook (alpha.3 E8; PO-PREVIEW-4, §12.3, NFR-04)
  const CAPS = ["maxVerticesPerLayer", "maxVerticesTotal", "maxPartsPerLayer"];

  /**
   * predictFabComplexity(draftSnapshot, fabGeometry, limits) → {scale, verticesPerLayerMax, verticesLayer, verticesTotal,
   * partsPerLayerMax, partsLayer, limits: {maxVerticesPerLayer, maxVerticesTotal, maxPartsPerLayer}, over: string[]}.
   * The complexity caps are absolute counts enforced per run, and traced vertices grow about linearly with the raster's
   * long side, so scale = max(fabW, fabH) / max(draftW, draftH); predicted vertices = round(draft stats.vertices × scale)
   * per layer and in total; predicted parts = the draft's parts (a lower bound: a finer raster only adds parts). over
   * names each cap (SBSchema.limits key) the prediction exceeds, in the order vertices/layer, vertices total, parts/layer.
   * verticesLayer / partsLayer: the 0-based index of the layer with the most (−1 with no layers). Pure; no hashing.
   */
  P.predictFabComplexity = function (snap, fab, limits) {
    const g = snap && snap.geometry;
    if (!g || !(g.rasterW > 0) || !(g.rasterH > 0) || !fab || !(fab.rasterW > 0) || !(fab.rasterH > 0) || !limits)
      throw new Error("SBProof.predictFabComplexity: needs a draft snapshot with geometry, the fabrication raster and the limits");
    const scale = Math.max(fab.rasterW, fab.rasterH) / Math.max(g.rasterW, g.rasterH);
    let vMax = 0, vLayer = -1, pMax = 0, pLayer = -1, total = 0;
    (snap.layers || []).forEach((L, k) => {
      const v = Math.round(((L && L.stats && L.stats.vertices) || 0) * scale), n = L && Array.isArray(L.parts) ? L.parts.length : 0;
      total += v;
      if (vLayer < 0 || v > vMax) { vMax = v; vLayer = k; }
      if (pLayer < 0 || n > pMax) { pMax = n; pLayer = k; }
    });
    const lim = { maxVerticesPerLayer: limits.maxVerticesPerLayer, maxVerticesTotal: limits.maxVerticesTotal, maxPartsPerLayer: limits.maxPartsPerLayer };
    const value = { maxVerticesPerLayer: vMax, maxVerticesTotal: total, maxPartsPerLayer: pMax };
    const over = CAPS.filter((c) => Number.isFinite(lim[c]) && value[c] > lim[c]);
    return { scale, verticesPerLayerMax: vMax, verticesLayer: vLayer, verticesTotal: total, partsPerLayerMax: pMax, partsLayer: pLayer, limits: lim, over };
  };

  /** One FAB_COMPLEXITY_LIKELY diagnostic per exceeded cap of a prediction. */
  function complexityItems(pr, revision) {
    const D = global.SBDiag, x = pr.scale === 1 ? "" : " (predicted from the draft at " + String(Number(pr.scale.toFixed(2))) + "\u00D7 its raster)";
    const tail = "; simplify, use fewer sheets or a smaller artwork";
    return (pr.over || []).map((cap) => {
      const lim = pr.limits[cap];
      let layer = null, n, what;
      if (cap === "maxVerticesPerLayer") { layer = pr.verticesLayer; n = pr.verticesPerLayerMax; what = "vertices on layer " + (layer + 1); }
      else if (cap === "maxVerticesTotal") { n = pr.verticesTotal; what = "vertices in total"; }
      else { layer = pr.partsLayer; n = pr.partsPerLayerMax; what = "parts on layer " + (layer + 1) + " (at least)"; }
      const unit = cap === "maxPartsPerLayer" ? "parts" : "vertices";
      return D.make("FAB_COMPLEXITY_LIKELY", { quality: "fabrication", revision: revision === undefined ? null : revision, layer,
        measured: { value: n, unit }, limit: { value: lim, unit },
        detail: "likely exceeds the fabrication cap: about " + n + " " + what + " vs " + lim + x + tail });
    });
  }

  /**
   * panelModel(shown, fabPlanDiagnostics, prediction?) → {groups: [{title, items: Diagnostic[], ackable, note?}]}: the
   * diagnostics panel's groups for the shown result. For a draft result only, a "Fabrication resolution" group
   * (ackable false, note "Acknowledged in the Fabrication review") comes first with the fabrication raster plan's
   * diagnostics (SBEngine.rasterPlan(project, source, "fabrication", dc).diagnostics: FAB_EXCEEDS_SOURCE,
   * FAB_PITCH_CAPPED) and one FAB_COMPLEXITY_LIKELY per cap the prediction exceeds; it is omitted when it would be
   * empty. These never enter the snapshot, its hash or its acks. A fabrication result raises the plan diagnostics
   * itself, so it has no plan group. Then the result's own group: "This <quality> result" (its snapshot diagnostics,
   * ackable) or, for a failed run, "No layers" (r.diagnostics, not ackable).
   */
  P.panelModel = function (shown, planDiags, prediction) {
    if (!shown || typeof shown !== "object") throw new Error("SBProof.panelModel: needs the shown result");
    const snap = shown.snapshot || null, quality = (snap && snap.quality) || shown.quality, groups = [];
    if (quality === "draft") {
      const items = (planDiags || []).slice();
      if (prediction && prediction.over && prediction.over.length) items.push(...complexityItems(prediction, snap ? snap.revision : shown.revision));
      if (items.length) groups.push({ title: "Fabrication resolution", items, ackable: false, note: "Acknowledged in the Fabrication review" });
    }
    const failed = shown.status === "error" || !snap;
    groups.push(failed ? { title: "No layers", items: (shown.diagnostics || []).slice(), ackable: false }
      : { title: "This " + quality + " result", items: (snap.diagnostics || []).slice(), ackable: true });
    return { groups };
  };

  global.SBProof = P;
})(typeof window !== "undefined" ? window : globalThis);
