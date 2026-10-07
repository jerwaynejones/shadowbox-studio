/* ============================================================================
 * test/legacy_oldrun.js — frozen copy of the v1.1.0 pipeline (T0.4)
 * ----------------------------------------------------------------------------
 * The body below is a VERBATIM copy of js/app.js:85-136 at v1.1.0 (f0552c7),
 * the part of runPipeline() after getImageData. It is wrapped as
 * oldRun(rgba, w, h, state) and returns { sheets } exactly as the loop builds
 * them. Do not edit the copied lines; this is the reference for oldrun.json.
 * Requires the SB* globals (test/modules.js NODE_MODULES) to be loaded first.
 * ==========================================================================*/
"use strict";
function oldRun(rgba, w, h, state) {
  state = Object.assign({}, state);
  /* global SBRaster, SBMorph, SBIslands, SBTrace, SBUtil */
  // ---- BEGIN verbatim js/app.js:85-136 (v1.1.0) ----
    // 2. Cartoonize.
    let L = SBRaster.luminance(rgba, w, h);
    L = SBRaster.kuwahara(L, w, h, state.smoothRadius, state.smoothPasses);

    // 3. Band and build nested sheet masks.
    const th = SBRaster.thresholds(L, state.nSheets, state.thresholdMode);
    const bandMap = SBRaster.bands(L, th);
    const masks = SBRaster.sheetMasks(bandMap, state.nSheets, w, h, state.darkFront);

    // 4. Physical px conversions.
    const pxPerMM = w / state.widthMM;
    const featR = Math.max(1, Math.round((state.minFeatureMM * pxPerMM) / 2));
    const bridgeR = Math.max(featR, (state.bridgeMM * pxPerMM) / 2);
    const cullPx = state.cullBelowMM2 * pxPerMM * pxPerMM;
    const maxBridgePx = Math.round(state.maxBridgeMM * pxPerMM);
    const speckPx = Math.max(4, cullPx * 0.5);
    const holePx = Math.max(4, (state.minFeatureMM * pxPerMM) ** 2 * 2);

    // 5. Per-sheet fabrication pass.
    const chaikinIters = state.cornerStyle === "smooth" ? 2 : 0;
    let totalBridged = 0, totalCulled = 0, totalCutMM = 0;
    state.sheets = masks.map((mask, s) => {
      if (s === 0) {
        return { mask, bridges: null, loops: [], stats: { cutMM: 0, bridged: 0, culled: 0, loops: 0 } };
      }
      let m = SBMorph.open(mask, w, h, featR);
      m = SBMorph.close(m, w, h, Math.max(1, featR - 1));
      SBMorph.removeSpecks(m, w, h, speckPx);
      SBMorph.fillHoles(m, w, h, holePx);

      const isl = SBIslands.resolve(m, w, h, {
        frameAnchored: state.marginMM > 0,
        bridgeRadius: bridgeR,
        cullBelowPx: cullPx,
        maxBridgePx,
      });

      let loops = SBTrace.trace(m, w, h)
        .map((lp) => SBTrace.simplify(lp, state.detailEps))
        .map((lp) => (chaikinIters ? SBTrace.chaikin(lp, chaikinIters) : lp));
      // drop degenerate micro-loops that survived
      loops = loops.filter((lp) => lp.length >= 3);

      const cutMM = loops.reduce((a, lp) => a + SBUtil.loopLength(lp), 0) / pxPerMM;
      totalBridged += isl.bridged; totalCulled += isl.culled; totalCutMM += cutMM;
      return {
        mask: m,
        bridges: isl.bridges,
        loops,
        stats: { cutMM, bridged: isl.bridged, culled: isl.culled, loops: loops.length },
      };
    });
  // ---- END verbatim ----
  void totalBridged; void totalCulled; void totalCutMM;
  return { sheets: state.sheets };
}
module.exports = { oldRun };
