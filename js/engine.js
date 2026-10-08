/* ============================================================================
 * Shadowbox Studio — js/engine.js
 * ----------------------------------------------------------------------------
 * SBEngine: the DOM-free engine. T0.5 seam: legacyRun is the v1.1.0
 * runPipeline() body after getImageData, moved verbatim (state -> cfg).
 * connectedLayers/connectedFiles (G1.7) carry the connected export on the
 * canonical path. The full SBEngine.generate lands in G2.10a/b.
 * ==========================================================================*/
(function (global) {
  "use strict";
  /* global SBRaster, SBMorph, SBIslands, SBTrace, SBUtil */
  const E = {};

  /**
   * legacyRun(rgba, w, h, cfg) -> { sheets: [{mask, bridges, loops, stats}], totals: {bridged, culled, cutMM} }
   * cfg keys read: smoothRadius, smoothPasses, nSheets, thresholdMode, darkFront, widthMM,
   * minFeatureMM, bridgeMM, cullBelowMM2, maxBridgeMM, marginMM, cornerStyle, detailEps.
   */
  E.legacyRun = function (rgba, w, h, cfg) {
    // 2. Cartoonize.
    let L = SBRaster.luminance(rgba, w, h);
    L = SBRaster.kuwahara(L, w, h, cfg.smoothRadius, cfg.smoothPasses);

    // 3. Band and build nested sheet masks.
    const th = SBRaster.thresholds(L, cfg.nSheets, cfg.thresholdMode);
    const bandMap = SBRaster.bands(L, th);
    const masks = SBRaster.sheetMasks(bandMap, cfg.nSheets, w, h, cfg.darkFront);

    // 4. Physical px conversions.
    const pxPerMM = w / cfg.widthMM;
    const featR = Math.max(1, Math.round((cfg.minFeatureMM * pxPerMM) / 2));
    const bridgeR = Math.max(featR, (cfg.bridgeMM * pxPerMM) / 2);
    const cullPx = cfg.cullBelowMM2 * pxPerMM * pxPerMM;
    const maxBridgePx = Math.round(cfg.maxBridgeMM * pxPerMM);
    const speckPx = Math.max(4, cullPx * 0.5);
    const holePx = Math.max(4, (cfg.minFeatureMM * pxPerMM) ** 2 * 2);

    // 5. Per-sheet fabrication pass.
    const chaikinIters = cfg.cornerStyle === "smooth" ? 2 : 0;
    const totals = { bridged: 0, culled: 0, cutMM: 0 };
    const sheets = masks.map((mask, s) => {
      if (s === 0) {
        return { mask, bridges: null, loops: [], stats: { cutMM: 0, bridged: 0, culled: 0, loops: 0 } };
      }
      let m = SBMorph.open(mask, w, h, featR);
      m = SBMorph.close(m, w, h, Math.max(1, featR - 1));
      SBMorph.removeSpecks(m, w, h, speckPx);
      SBMorph.fillHoles(m, w, h, holePx);

      const isl = SBIslands.resolve(m, w, h, {
        frameAnchored: cfg.marginMM > 0,
        bridgeRadius: bridgeR,
        cullBelowPx: cullPx,
        maxBridgePx,
      });

      let loops = SBTrace.trace(m, w, h)
        .map((lp) => SBTrace.simplify(lp, cfg.detailEps))
        .map((lp) => (chaikinIters ? SBTrace.chaikin(lp, chaikinIters) : lp));
      // drop degenerate micro-loops that survived
      loops = loops.filter((lp) => lp.length >= 3);

      const cutMM = loops.reduce((a, lp) => a + SBUtil.loopLength(lp), 0) / pxPerMM;
      totals.bridged += isl.bridged; totals.culled += isl.culled; totals.cutMM += cutMM;
      return {
        mask: m,
        bridges: isl.bridges,
        loops,
        stats: { cutMM, bridged: isl.bridged, culled: isl.culled, loops: loops.length },
      };
    });
    return { sheets, totals };
  };

  // ------------------------------------------------ connected export, canonical path (plan G1.7)

  /** v1.1.0 smoothing intent → G1.2 connected-mode smoothing: "smooth" is bounded to 0.05 mm, "faceted" stays raw. */
  const CONNECTED_SMOOTH_TOL_UM = 50;

  /**
   * connectedLayers(sheets, w, h, cfg) → {page, layers: MaterialLayer[]}
   *
   * The v1.1.0 connected export rebuilt on canonical material (plan G1.7, DEP-04). Input is the legacyRun
   * result: sheet 0 is the solid backing (as in v1.1.0, whatever its mask), sheets 1.. use their final masks
   * (after morphology and islands). The legacy simplified/Chaikin pixel loops are not used.
   *   - page: art = cfg.widthMM × h·widthMM/w, frame ring = cfg.marginMM (SBMaterial.page, 1 µm grid);
   *   - SBMaterial.fromMasks in one GEO-02 pass: bounded smoothing on the pixel loops (connected mode, D1,
   *     tol 0.05 mm, only for cornerStyle "smooth"; no containment) → frame union (applyFrame order) →
   *     corner holes (subtractHoles order) → normalize → validate → parts;
   *   - holes: the four v1.1.0 corners at margin/2 from each page edge, diameter cfg.holeDiaMM, on every layer,
   *     only when cfg.holes and marginMM > 0 (until G3.4 replaces them with validated positions).
   * cfg keys read: widthMM, marginMM, holes, holeDiaMM, cornerStyle.
   */
  E.connectedLayers = function (sheets, w, h, cfg) {
    const M = global.SBMaterial;
    const page = M.page({ artWMM: cfg.widthMM, artHMM: (h * cfg.widthMM) / w, frameMM: cfg.marginMM > 0 ? cfg.marginMM : 0 });
    const WU = Math.round(page.wMM * 1000), HU = Math.round(page.hMM * 1000), fU = Math.round(page.frameMM * 1000);
    const rU = Math.round((cfg.holeDiaMM || 0) * 500), inset = Math.round(fU / 2);
    const holes = cfg.holes && fU > 0 && rU >= 1
      ? [[inset, inset], [WU - inset, inset], [inset, HU - inset], [WU - inset, HU - inset]].map(([x, y]) => ({ cxUm: x, cyUm: y, rUm: rU }))
      : [];
    const masks = sheets.map((s, k) => (k === 0 ? new Uint8Array(w * h).fill(1) : s.mask));
    const opts = { frame: fU > 0, holes, holeLayers: "all" };
    if (cfg.cornerStyle === "smooth") opts.smooth = { mode: "connected", tolUm: CONNECTED_SMOOTH_TOL_UM };
    return { page, layers: M.fromMasks(masks, w, h, page, opts) };
  };

  /**
   * connectedFiles(sheets, w, h, cfg, colors) → [{name, data}]
   * Legacy file names (the §9.4 layout arrives in G3.9): sheet_NN.svg = SBSvg.layerSVG with the v1.1.0 text
   * label ("{projectName} {k+1}/{n}", legacyTextLabel until G3.2), then proof.svg = SBSvg.assemblySVG in the
   * same page frame. cfg additionally reads projectName.
   */
  E.connectedFiles = function (sheets, w, h, cfg, colors) {
    const S = global.SBSvg, C = E.connectedLayers(sheets, w, h, cfg), n = C.layers.length;
    const files = C.layers.map((l) => ({
      name: "sheet_" + String(l.index + 1).padStart(2, "0") + ".svg",
      data: S.layerSVG(l, C.page, { construction: "connected", legacyTextLabel: cfg.projectName + " " + (l.index + 1) + "/" + n }),
    }));
    files.push({ name: "proof.svg", data: S.assemblySVG(C.layers, C.page, colors) });
    return files;
  };

  global.SBEngine = E;
})(typeof window !== "undefined" ? window : globalThis);
