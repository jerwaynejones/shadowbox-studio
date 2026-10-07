/* ============================================================================
 * Shadowbox Studio — js/engine.js
 * ----------------------------------------------------------------------------
 * SBEngine: the DOM-free engine. T0.5 seam: legacyRun is the v1.1.0
 * runPipeline() body after getImageData, moved verbatim (state -> cfg).
 * The full SBEngine.generate lands in G2.10a/b.
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

  global.SBEngine = E;
})(typeof window !== "undefined" ? window : globalThis);
