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
   * backing, the last the front, the others mid.
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

  global.SBProof = P;
})(typeof window !== "undefined" ? window : globalThis);
