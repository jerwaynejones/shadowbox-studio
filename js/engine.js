/* ============================================================================
 * Shadowbox Studio — js/engine.js
 * ----------------------------------------------------------------------------
 * SBEngine: the DOM-free engine. T0.5 seam: legacyRun is the v1.1.0
 * runPipeline() body after getImageData, moved verbatim (state -> cfg); since G2.6 its per-sheet
 * morphology + islands pass is SBConstruct.connected (byte-identical, pinned by test/golden/oldrun.json).
 * connectedLayers/connectedFiles (G1.7) carry the connected export on the
 * canonical path. rasterPlan/qualityPair (G2.1b) are the one draft/fabrication
 * raster rule (LYR-06, PO-LASER-4/5). orient (G2.5) is the one orientation rule (IMG-05).
 * interpretHeight (G2.5b) is the height-mode interpretation stage: raw unless an explicit heightFilter is set (IMG-03).
 * The full SBEngine.generate lands in G2.10a/b.
 * ==========================================================================*/
(function (global) {
  "use strict";
  /* global SBRaster, SBTrace, SBUtil */
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

    // 5. Per-sheet fabrication pass: morphology + islands via the connected strategy (G2.6), then trace.
    const C = global.SBConstruct.connected(masks, w, h, { featR, bridgeR, cullPx, maxBridgePx, speckPx, holePx, frameAnchored: cfg.marginMM > 0, cullEnabled: false });
    const chaikinIters = cfg.cornerStyle === "smooth" ? 2 : 0;
    const totals = { bridged: 0, culled: 0, cutMM: 0 };
    const sheets = masks.map((mask, s) => {
      if (s === 0) {
        return { mask, bridges: null, loops: [], stats: { cutMM: 0, bridged: 0, culled: 0, loops: 0 } };
      }
      const m = C.final[s], isl = C.report[s];

      let loops = SBTrace.trace(m, w, h)
        .map((lp) => SBTrace.simplify(lp, cfg.detailEps))
        .map((lp) => (chaikinIters ? SBTrace.chaikin(lp, chaikinIters) : lp));
      // drop degenerate micro-loops that survived
      loops = loops.filter((lp) => lp.length >= 3);

      const cutMM = loops.reduce((a, lp) => a + SBUtil.loopLength(lp), 0) / pxPerMM;
      totals.bridged += isl.bridged; totals.culled += isl.culled; totals.cutMM += cutMM;
      return {
        mask: m,
        bridges: C.bridges[s],
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

  // ------------------------------------------------------------ orientation (G2.5, IMG-05)
  /*
   * A pixel-grid transform is an integer affine map (x, y) → (a·x + b·y + c, d·x + e·y + f) from a W × H grid to
   * W' × H'. Primitives (clockwise rotation; mirror = left-right): */
  const PRIM = {
    rot90: (W, H) => ({ m: [0, -1, H - 1, 1, 0, 0], W: H, H: W }),
    rot180: (W, H) => ({ m: [-1, 0, W - 1, 0, -1, H - 1], W, H }),
    rot270: (W, H) => ({ m: [0, 1, 0, -1, 0, W - 1], W: H, H: W }),
    mirror: (W, H) => ({ m: [-1, 0, W - 1, 0, 1, 0], W, H }),
  };
  /** EXIF orientation → primitive sequence (the standard meaning: 2 mirror, 3 rot180, 4 = flip vertical, 5 transpose, 6 rot90 cw, 7 transverse, 8 rot270 cw). */
  const EXIF_SEQ = { 1: [], 2: ["mirror"], 3: ["rot180"], 4: ["rot180", "mirror"], 5: ["mirror", "rot270"], 6: ["rot90"], 7: ["mirror", "rot90"], 8: ["rot270"] };

  function checkOrientation(o) {
    if (!o || typeof o !== "object") throw efail("ENGINE_ARG", "orientation must be {exif, exifAppliedBy, rotate, mirror}");
    if (!Number.isInteger(o.exif) || o.exif < 1 || o.exif > 8) throw efail("ENGINE_ARG", "exif must be 1..8 (got " + o.exif + ")");
    if (!["browser", "engine", "none"].includes(o.exifAppliedBy)) throw efail("ENGINE_ARG", "exifAppliedBy must be browser|engine|none (got " + o.exifAppliedBy + ")");
    if (![0, 90, 180, 270].includes(o.rotate)) throw efail("ENGINE_ARG", "rotate must be 0|90|180|270 (got " + o.rotate + ")");
    if (typeof o.mirror !== "boolean") throw efail("ENGINE_ARG", "mirror must be boolean (got " + o.mirror + ")");
  }

  /**
   * The one orientation rule (IMG-05): EXIF only when exifAppliedBy === "engine" (the raw PNG/engine path; the
   * browser path is already oriented), then the user rotate (clockwise), then mirror (left-right).
   * Returns the composed transform {m, W, H} for a w × h grid.
   */
  function orientTransform(o, w, h) {
    const seq = (o.exifAppliedBy === "engine" ? EXIF_SEQ[o.exif] : []).slice();
    if (o.rotate) seq.push("rot" + o.rotate);
    if (o.mirror) seq.push("mirror");
    let t = { m: [1, 0, 0, 0, 1, 0], W: w, H: h };
    for (const name of seq) {
      const p = PRIM[name](t.W, t.H), [a, b, c, d, e, f] = t.m, [A, B, C, D, Ee, Fx] = p.m;
      t = { m: [A * a + B * d, A * b + B * e, A * c + B * f + C, D * a + Ee * d, D * b + Ee * e, D * c + Ee * f + Fx], W: p.W, H: p.H };
    }
    return t;
  }

  /** Oriented source size (IMG-05), from the same transform orient applies. */
  function orientedSize(project, w, h) {
    const o = project.source && project.source.orientation;
    if (!o) return [w, h];
    const t = orientTransform(o, w, h);
    return [t.W, t.H];
  }

  /**
   * orient({samples, alpha, w, h}, {exif, exifAppliedBy, rotate, mirror}) → {samples, alpha, w, h, oriented: true}
   * Applies orientTransform in one pass, before interpretation (G2.5, IMG-04/05). samples may carry several
   * interleaved channels (length = w·h·c, kept in order per pixel) and keep their array type; alpha (one channel,
   * or null) moves with them so the domain A stays registered. Pure. Runs exactly once: an input already marked
   * oriented is refused with ORIENT_TWICE.
   */
  E.orient = function (raster, orientation) {
    if (!raster || typeof raster !== "object") throw efail("ENGINE_ARG", "raster must be {samples, alpha, w, h}");
    if (raster.oriented === true) throw efail("ORIENT_TWICE", "the raster is already oriented (orient runs exactly once)");
    const { samples, w, h } = raster, alpha = raster.alpha == null ? null : raster.alpha;
    if (!isPosInt(w) || !isPosInt(h)) throw efail("ENGINE_ARG", "size must be positive integers (got " + w + " × " + h + ")");
    const n = w * h;
    if (!samples || typeof samples.length !== "number" || samples.length === 0 || samples.length % n !== 0) throw efail("ENGINE_ARG", "samples length must be a multiple of w·h");
    if (alpha && alpha.length !== n) throw efail("ENGINE_ARG", "alpha length " + alpha.length + " != w·h " + n);
    checkOrientation(orientation);
    const ch = samples.length / n, t = orientTransform(orientation, w, h), [a, b, c, d, e, f] = t.m, W2 = t.W;
    const out = new samples.constructor(samples.length), outA = alpha ? new alpha.constructor(n) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = y * w + x, dst = (d * x + e * y + f) * W2 + (a * x + b * y + c);
      if (ch === 1) out[dst] = samples[s]; else for (let k = 0; k < ch; k++) out[dst * ch + k] = samples[s * ch + k];
      if (outA) outA[dst] = alpha[s];
    }
    return { samples: out, alpha: outA, w: W2, h: t.H, oriented: true };
  };

  /**
   * interpretHeight(samples, w, h, interpretation, N, domain, {quality?, revision?}) → {added: Uint8Array, diagnostics}
   * The height-mode interpretation stage (G2.10a stage 4; IMG-03, AT-02). samples are the oriented, resampled
   * 8-bit height plane (one channel). With interpretation.heightFilter null the samples are sliced raw: no
   * Kuwahara, no thresholds, no filter. A set heightFilter runs SBHeight.applyFilter (domain-aware) once and
   * emits HEIGHT_FILTERED (info) naming the filter. Then SBHeight.addedFromSamples with the polarity. Pure.
   */
  E.interpretHeight = function (samples, w, h, interp, N, domain, ctx) {
    if (!interp || interp.mode !== "height") throw efail("ENGINE_ARG", "interpretHeight needs interpretation.mode height (got " + (interp && interp.mode) + ")");
    ctx = ctx || {};
    const H = global.SBHeight, f = interp.heightFilter == null ? null : interp.heightFilter, diagnostics = [];
    let s = samples;
    if (f) {
      s = H.applyFilter(samples, w, h, f, domain || null);
      diagnostics.push(global.SBDiag.make("HEIGHT_FILTERED", {
        quality: ctx.quality, revision: ctx.revision,
        detail: f.op === "remap" ? "remap LUT applied to the height samples" : f.op + " filter, radius " + f.radius + " px, applied to the height samples",
      }));
    }
    return { added: H.addedFromSamples(s, N, interp.polarity), diagnostics };
  };

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
