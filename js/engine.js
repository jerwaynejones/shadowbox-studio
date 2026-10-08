/* ============================================================================
 * Shadowbox Studio — js/engine.js
 * ----------------------------------------------------------------------------
 * SBEngine: the DOM-free engine. T0.5 seam: legacyRun is the v1.1.0
 * runPipeline() body after getImageData, moved verbatim (state -> cfg).
 * connectedLayers/connectedFiles (G1.7) carry the connected export on the
 * canonical path. rasterPlan/qualityPair (G2.1b) are the one draft/fabrication
 * raster rule (LYR-06, PO-LASER-4/5). The full SBEngine.generate lands in G2.10a/b.
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

  // ------------------------------------------------------------ raster plan (G2.1b)
  function efail(code, msg) { const e = new Error(code + (msg ? ": " + msg : "")); e.code = code; return e; }
  const isPosInt = (v) => Number.isSafeInteger(v) && v > 0;
  const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

  /**
   * Oriented source size (IMG-05): EXIF 5–8 transpose the axes, but only when the engine applies EXIF
   * (exifAppliedBy "engine"; the browser path is already oriented); then rotate 90/270 swaps them.
   */
  function orientedSize(project, w, h) {
    const o = project.source && project.source.orientation;
    if (!o) return [w, h];
    let swap = o.exifAppliedBy === "engine" && o.exif >= 5 && o.exif <= 8;
    if (o.rotate === 90 || o.rotate === 270) swap = !swap;
    return swap ? [h, w] : [w, h];
  }

  /**
   * rasterPlan(project, {w, h}, "draft"|"fabrication", deviceClass) → {quality, geometry: GeometryConfig, diagnostics}
   * deep-frozen (LYR-06, GEO-06, NFR-04, PO-LASER-4/5). Reads only source.w and source.h, so it runs before any
   * decode. Sizes come from SBSchema.resolveSize on the oriented source.
   *   draft:        SBRaster.rasterSize (geometry.draftPx long side); no pitch, no budget, no pitch diagnostics.
   *   fabrication:  SBRaster.fabRaster at round(fabPitchMM·1000) µm under limits(deviceClass).fabPxBudget, with
   *                 FAB_PITCH_CAPPED / FAB_EXCEEDS_SOURCE (quality "fabrication", the project revision).
   * resample follows the G2.0 policy for interpretation.mode (height "area" only when geometry.resample.height
   * selects it explicitly). generate (G2.10a) takes its raster only from here; export recomputes the fabrication
   * plan for the current revision and device class (a draft plan never stands in for it).
   */
  E.rasterPlan = function (project, source, quality, deviceClass) {
    if (quality !== "draft" && quality !== "fabrication") throw efail("ENGINE_ARG", "quality must be draft|fabrication (got " + quality + ")");
    if (!source || typeof source !== "object") throw efail("ENGINE_ARG", "source must be {w, h}");
    const w0 = source.w, h0 = source.h;
    if (!isPosInt(w0) || !isPosInt(h0)) throw efail("ENGINE_ARG", "source size must be positive integers (got " + w0 + " × " + h0 + ")");
    const R = global.SBRaster, Sch = global.SBSchema;
    const lim = Sch.limits(deviceClass);
    const [srcW, srcH] = orientedSize(project, w0, h0);
    const sz = Sch.resolveSize(project, srcW, srcH);
    const g = project.geometry, diagnostics = [];
    let W, H, targetPitchUm = null, pitchUm = null, pxBudget = null, capped = "none", shortPx = null;
    if (quality === "draft") {
      const r = R.rasterSize(srcW, srcH, g.draftPx);
      W = r.W; H = r.H;
    } else {
      targetPitchUm = Math.round(g.fabPitchMM * 1000);
      pxBudget = lim.fabPxBudget;
      const ctx = { artWUm: sz.artWUm, artHUm: sz.artHUm, srcW, srcH, targetPitchUm, pxBudget, deviceClass, quality, revision: project.revision };
      const fab = R.fabRaster(ctx);
      W = fab.W; H = fab.H; pitchUm = fab.pitchUm; capped = fab.capped; shortPx = fab.shortPx;
      diagnostics.push(...R.fabDiagnostics(fab, ctx));
    }
    const sc = R.scaleUm(sz.artWUm, sz.artHUm, W, H);
    const resample = R.resamplePolicy(project.interpretation.mode, srcW, srcH, W, H, { heightArea: g.resample.height === "area" });
    return deepFreeze({
      quality,
      geometry: {
        artWMM: sz.artWMM, artHMM: sz.artHMM, pageWMM: sz.pageWMM, pageHMM: sz.pageHMM, srcW, srcH,
        rasterW: W, rasterH: H, sxUm: sc.sxUm, syUm: sc.syUm, mmPerPxMax: sc.mmPerPxMax, resample, grid: "1um",
        targetPitchUm, pitchUm, pxBudget, deviceClass, capped, shortPx,
      },
      diagnostics,
    });
  };

  /** qualityPair(project, {w, h}, deviceClass) → {draft, fabrication}: both plans, for display before generation. */
  E.qualityPair = function (project, source, deviceClass) {
    return Object.freeze({ draft: E.rasterPlan(project, source, "draft", deviceClass), fabrication: E.rasterPlan(project, source, "fabrication", deviceClass) });
  };

  global.SBEngine = E;
})(typeof window !== "undefined" ? window : globalThis);
