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
 * generate (G2.10a) is the §11.1 pipeline through validation, with the machine-envelope check; G2.10b completes it with
 * the Z model, trailing-empty accounting, stats, the D4 hashes (layerHash, guideHash, geometryHash) and a deep freeze.
 * legacyDiagnostics/legacySnapshotHash (G2.13c) give the app's legacy draft run the same final-polygon checks and an
 * ack-scoping snapshot hash until the app adopts generate. legacyView (G2.13d) replays the project's reviewed
 * clip repairs on that geometry (review views and diagnostics). fabricationRequest/fabricationFiles (checkpoint
 * v2.0.0-alpha.2) build the export's fabrication GenerateRequest and write its snapshot in the legacy flat layout.
 * ==========================================================================*/
(function (global) {
  "use strict";
  /* global SBRaster, SBTrace, SBUtil */
  const E = {};

  /**
   * legacyRun(rgba, w, h, cfg) -> { sheets: [{mask, bridges, loops, stats, pre?, cleanup?}], totals: {bridged, culled, cutMM} }
   * Sheets 1.. also carry pre (the mask before cleanup) and cleanup {addedPx, removedPx, filledHoles, removedParts}
   * (G2.13b, GEO-08 overlays); sheet 0 is the solid backing and has neither.
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
        pre: mask,   // G2.13b: the mask before cleanup, for the change overlays (GEO-08)
        cleanup: { addedPx: isl.addedPx, removedPx: isl.removedPx, filledHoles: isl.filledHoles, removedParts: isl.removedParts },
      };
    });
    return { sheets, totals };
  };

  // ------------------------------------------------ connected export, canonical path (plan G1.7)

  /** v1.1.0 smoothing intent → G1.2 connected-mode smoothing: "smooth" is bounded to 0.05 mm, "faceted" stays raw. */
  const CONNECTED_SMOOTH_TOL_UM = 50;

  /** The legacy page frame shared by connectedLayers and legacyCleanupReport (so their frames cannot drift). */
  function legacyPage(w, h, cfg) {
    return global.SBMaterial.page({ artWMM: cfg.widthMM, artHMM: (h * cfg.widthMM) / w, frameMM: cfg.marginMM > 0 ? cfg.marginMM : 0 });
  }

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
    const page = legacyPage(w, h, cfg);
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
   * G2.13b (GEO-08): polygons (µm, page frame: art offset by the frame) of the pixels where pred(i) holds,
   * or null when none does. One trace per call; used for the change overlays and bridges.
   */
  E.maskPolygons = function (w, h, sxUm, syUm, fUm, pred) {
    const m = new Uint8Array(w * h);
    let any = 0;
    for (let i = 0; i < m.length; i++) if (pred(i)) { m[i] = 1; any = 1; }
    if (!any) return null;
    const G = global.SBGeom;
    return G.normalize(G.union(G.fromPixelLoops(global.SBTrace.trace(m, w, h), sxUm, syUm, fUm, fUm), []));
  };

  /**
   * legacyCleanupReport(sheets, w, h, cfg) → cleanupReport-shaped [{layer, addedMM2, removedMM2, holesFilled,
   * partsRemoved, added?, removed?, bridges?}] for a legacyRun result, in the connectedLayers page frame (G2.13b).
   * added = final ∧ ¬pre, removed = pre ∧ ¬final, bridges = the islands' bridge pixels; polygons in µm, present
   * only when non-empty. Sheet 0 (the solid backing) reports no change. The app's interim overlay source until
   * it adopts SBEngine.generate (whose draft cleanupReport has the same shape).
   */
  E.legacyCleanupReport = function (sheets, w, h, cfg) {
    const M = global.SBMaterial;
    const page = legacyPage(w, h, cfg);
    const { sxUm, syUm } = M.scale({ w, h, artWMM: page.artWMM, artHMM: page.artHMM });
    const fUm = Math.round(page.frameMM * 1000), pxMM2 = (sxUm * syUm) / 1e6;
    return sheets.map((sh, k) => {
      const c = k > 0 && sh.cleanup ? sh.cleanup : { addedPx: 0, removedPx: 0, filledHoles: 0, removedParts: 0 };
      const e = { layer: k, addedMM2: c.addedPx * pxMM2, removedMM2: c.removedPx * pxMM2, holesFilled: c.filledHoles, partsRemoved: c.removedParts };
      if (k > 0 && sh.pre) {
        const pre = sh.pre, fin = sh.mask;
        if (c.addedPx) e.added = E.maskPolygons(w, h, sxUm, syUm, fUm, (i) => fin[i] && !pre[i]);
        if (c.removedPx) e.removed = E.maskPolygons(w, h, sxUm, syUm, fUm, (i) => pre[i] && !fin[i]);
      }
      const b = sh.bridges;
      if (b) { const poly = E.maskPolygons(w, h, sxUm, syUm, fUm, (i) => b[i]); if (poly) e.bridges = poly; }
      return e;
    });
  };

  /**
   * G2.13d (SUP-04, D-4.6): legacyView(sheets, w, h, cfg, project) → {page, layers, diagnostics, applied}: the app's
   * interim review/export geometry. connectedLayers, then the project's construction.repairs replayed by
   * SBSupport.replayRepairs at draft quality and the project revision (an accepted clip-to-lower is cut; a repair
   * reviewed under other settings or on another pre-repair layer raises REPAIR_STALE and is skipped). diagnostics are
   * the replay's; applied the replayed entry indices. Legacy-path note: the legacy layers already carry their corner
   * holes, so the clip runs after the holes here (generate replays before them); a repair's hashes therefore belong
   * to this path, and they fail closed (REPAIR_STALE) when the app adopts generate. Pure.
   */
  E.legacyView = function (sheets, w, h, cfg, project) {
    const C = E.connectedLayers(sheets, w, h, cfg);
    const repairs = (project && project.construction && project.construction.repairs) || [];
    if (!repairs.length) return { page: C.page, layers: C.layers, diagnostics: [], applied: [] };
    const rp = global.SBSupport.replayRepairs(C.layers, repairs, { project, quality: "draft", revision: project.revision });
    return { page: C.page, layers: rp.layers, diagnostics: rp.diagnostics, applied: rp.applied };
  };

  /**
   * G2.13c (UI-04): legacyDiagnostics(view, w, h, project) → Diagnostic[] for a legacyRun result whose polygons are
   * `view` (connectedLayers, ideally after SBMaterial.assignParts so part diagnostics carry IDs). The app's interim
   * diagnostics source until it adopts SBEngine.generate; the same final-polygon checks generate runs at step 12, at
   * draft quality and the project revision: each layer's geometry diagnostics, SBSupport.validate in the project's
   * construction mode (bonded: containment and the support graph, one layer-level boolean per adjacent pair;
   * connected: CONNECTED_SPLIT), SBSupport.featureChecks at the legacy pitch (mmPerPxMax = the coarser axis of the
   * view's page over w × h, so SAMPLING_LOW reflects the geometry the app exports) and SBSupport.checkEnvelope.
   * Pure; the view is not mutated.
   */
  E.legacyDiagnostics = function (view, w, h, project) {
    const M = global.SBMaterial, S = global.SBSupport, mat = project.material, page = view.page;
    const dOpts = { revision: project.revision, quality: "draft" };
    const out = [];
    for (const d of view.diagnostics || []) out.push(Object.assign({}, d, dOpts));   // G2.13d: legacyView's repair diagnostics
    for (const L of view.layers) for (const d of L.diagnostics || []) out.push(Object.assign({}, d, dOpts));
    out.push(...S.validate(view.layers, project.construction.mode, { minFeatureMM: mat.minFeatureMM, advisoryFeatureMM: mat.advisoryFeatureMM,
      revision: dOpts.revision, quality: dOpts.quality }).diagnostics);
    const { sxUm, syUm } = M.scale({ w, h, artWMM: page.artWMM, artHMM: page.artHMM });
    out.push(...S.featureChecks(view.layers, { minFeatureMM: mat.minFeatureMM, advisoryFeatureMM: mat.advisoryFeatureMM, minPartMM2: mat.minPartMM2,
      mmPerPxMax: Math.max(sxUm, syUm) / 1000, calibrated: mat.calibrated, revision: dOpts.revision, quality: dOpts.quality }));
    out.push(...S.checkEnvelope({ wMM: page.wMM, hMM: page.hMM }, project.machine, mat, dOpts));
    return out;
  };

  /**
   * G2.13c (§9.5, D4): legacySnapshotHash(view, w, h) → the hash that scopes acknowledgements to one legacy result:
   * hashJSON({engine, quality: "draft", raster: [w, h], page, layers: D4 layerHash per layer}). Any geometry or raster
   * change gives a new hash, so an ack (SBDiag.ackKey) never carries over to another snapshot.
   */
  E.legacySnapshotHash = function (view, w, h) {
    const G = global.SBGeom;
    return global.SBHash.hashJSON({ engine: E.VERSION, quality: "draft", raster: [w, h], page: [view.page.wMM, view.page.hMM],
      layers: view.layers.map((L) => G.layerHashes(L).layerHash) });
  };

  /**
   * connectedFiles(sheets, w, h, cfg, colors) → [{name, data}]
   * Legacy file names (the §9.4 layout arrives in G3.9): sheet_NN.svg = SBSvg.layerSVG with the v1.1.0 text
   * label ("{projectName} {k+1}/{n}", legacyTextLabel until G3.2), then proof.svg = SBSvg.assemblySVG in the
   * same page frame. cfg additionally reads projectName. G2.13d: with `project`, the layers are SBEngine.legacyView's
   * (the project's reviewed construction.repairs replayed), so the cut files match the proof the user reviewed.
   */
  E.connectedFiles = function (sheets, w, h, cfg, colors, project) {
    const S = global.SBSvg, C = project ? E.legacyView(sheets, w, h, cfg, project) : E.connectedLayers(sheets, w, h, cfg), n = C.layers.length;
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
  /**
   * Deep Object.freeze (G2.10b). Iterative (deep polygon stacks never recurse), visits each object once, skips typed
   * arrays (Object.freeze throws on a non-empty ArrayBuffer view) and walks arrays by index without copying them.
   */
  const deepFreeze = (root) => {
    const stack = [root];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== "object" || Object.isFrozen(o) || ArrayBuffer.isView(o)) continue;
      Object.freeze(o);
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const v = o[i]; if (v && typeof v === "object") stack.push(v); } }
      else for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
    }
    return root;
  };

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
   * oriented is refused with ORIENT_TWICE. At the identity orientation the input arrays are returned uncopied
   * (alpha.3 E3); callers must not write into the result.
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
    // alpha.3 E3 (NFR-05): identity fast path, no copy. Safe because no later generate stage writes into its input.
    if (a === 1 && b === 0 && c === 0 && d === 0 && e === 1 && f === 0 && W2 === w && t.H === h) return { samples, alpha, w, h, oriented: true };
    const out = new samples.constructor(samples.length), outA = alpha ? new alpha.constructor(n) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = y * w + x, dst = (d * x + e * y + f) * W2 + (a * x + b * y + c);
      if (ch === 1) out[dst] = samples[s]; else for (let k = 0; k < ch; k++) out[dst * ch + k] = samples[s * ch + k];
      if (outA) outA[dst] = alpha[s];
    }
    return { samples: out, alpha: outA, w: W2, h: t.H, oriented: true };
  };

  /**
   * radiusPx(radiusMM, geometry, minPx = 0) → integer (alpha.3 E3b, IMG-04): a physical filter radius on a raster,
   * max(minPx, round(radiusMM·1000 / pMaxUm)) with pMaxUm the coarser axis pitch (max(sxUm, syUm), else mmPerPxMax·1000;
   * the constructPx convention). 0 for radiusMM 0 whatever minPx. Draft and fabrication thus smooth the same mm.
   */
  E.radiusPx = function (radiusMM, geometry, minPx) {
    const rUm = Math.round((radiusMM || 0) * 1000);
    if (!(rUm > 0)) return 0;
    const g = geometry || {};
    const pMaxUm = Number.isFinite(g.sxUm) && Number.isFinite(g.syUm) ? Math.max(g.sxUm, g.syUm) : g.mmPerPxMax * 1000;
    if (!(pMaxUm > 0)) throw efail("ENGINE_ARG", "radiusPx needs the raster pitch (sxUm/syUm or mmPerPxMax)");
    return Math.max(minPx || 0, Math.round(rUm / pMaxUm));
  };
  const HEIGHT_FILTER_MAX_PX = 50;   // SBHeight FILTER_MAX_R

  /**
   * interpretHeight(samples, w, h, interpretation, N, domain, {geometry?, quality?, revision?}) → {added: Uint8Array, diagnostics}
   * The height-mode interpretation stage (G2.10a stage 4; IMG-03, AT-02). samples are the oriented, resampled
   * 8-bit height plane (one channel). With interpretation.heightFilter null the samples are sliced raw: no
   * Kuwahara, no thresholds, no filter. A set heightFilter runs SBHeight.applyFilter (domain-aware) once and
   * emits HEIGHT_FILTERED (info) naming the filter. A median/box radiusMM is converted with radiusPx (at least 1 px,
   * at most 50) on ctx.geometry, the run's raster pitch, required for those ops (E3b); HEIGHT_FILTERED states mm and px.
   * Then SBHeight.addedFromSamples with the polarity. Pure.
   */
  E.interpretHeight = function (samples, w, h, interp, N, domain, ctx) {
    if (!interp || interp.mode !== "height") throw efail("ENGINE_ARG", "interpretHeight needs interpretation.mode height (got " + (interp && interp.mode) + ")");
    ctx = ctx || {};
    const H = global.SBHeight, f = interp.heightFilter == null ? null : interp.heightFilter, diagnostics = [];
    let s = samples;
    if (f) {
      let rPx = null, filter = f;
      if (f.op !== "remap") {
        // E3b: radiusMM converted on this raster (coarser axis pitch), at least 1 px, at most the filter's 50 px.
        if (!ctx.geometry) throw efail("ENGINE_ARG", "interpretHeight needs ctx.geometry (the raster pitch) for a " + f.op + " filter");
        rPx = Math.min(HEIGHT_FILTER_MAX_PX, E.radiusPx(f.radiusMM, ctx.geometry, 1));
        filter = { op: f.op, radius: rPx };
      }
      s = H.applyFilter(samples, w, h, filter, domain || null);
      diagnostics.push(global.SBDiag.make("HEIGHT_FILTERED", {
        quality: ctx.quality, revision: ctx.revision,
        detail: f.op === "remap" ? "remap LUT applied to the height samples" : f.op + " filter, radius " + f.radiusMM + " mm (" + rPx + " px on this raster), applied to the height samples",
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

  // ------------------------------------------------------------ generate (G2.10a, the §11.1 pipeline through validation)
  /**
   * The engine version a request must name (§9.3 handshake): SBSchema.ENGINE.version, looked up at call time.
   * TEST_HOOKS: set only by the Node test runner; never in the browser and never persisted. It admits req.debug.
   */
  Object.defineProperty(E, "VERSION", { enumerable: true, get: () => global.SBSchema.ENGINE.version });
  E.TEST_HOOKS = false;

  /**
   * Construction parameters in px for SBConstruct (G2.6 px contract) from construction.cleanup / bridge at the real
   * raster scales (sxUm, syUm; D-4.2). Radii use the coarser axis pitch pMax (the smaller radius: less is removed);
   * areas use the real pixel area sx·sy. featR = max(1, round(minFeatureUm / (2·pMax))) as in v1.1.0, 0 when the cleanup
   * minimum feature is 0 (no morphology). Bonded culling (cullEnabled) removes specks below bridge.cullBelowMM2 (the
   * explicit cull threshold, SUP-01); connected mode removes specks below cleanup.speckMM2 and culls/bridges islands.
   */
  function constructPx(c, bonded, sxUm, syUm) {
    const pMax = Math.max(sxUm, syUm), pxUm2 = sxUm * syUm;
    const featUm = Math.round(c.cleanup.minFeatureMM * 1000);
    const featR = featUm > 0 ? Math.max(1, Math.round(featUm / (2 * pMax))) : 0;
    const area = (mm2) => (mm2 * 1e6) / pxUm2;
    return {
      featR,
      bridgeR: Math.max(featR, (c.bridge.bridgeMM * 1000) / (2 * pMax)),
      cullPx: area(c.bridge.cullBelowMM2),
      maxBridgePx: Math.round((c.bridge.maxBridgeMM * 1000) / pMax),
      speckPx: area(bonded ? c.bridge.cullBelowMM2 : c.cleanup.speckMM2),
      holePx: area(c.cleanup.holeMM2),
      frameAnchored: !!c.frame.enabled,
      cullEnabled: !!c.bridge.cullEnabled,
    };
  }

  /** The legacy connected corner holes (G1.7) until G3.1 places validated registration holes; [] in bonded mode. */
  function legacyHoles(project, page) {
    const c = project.construction, reg = c.registration;
    if (c.mode !== "connected-sheet" || !reg.enabled) return [];
    const WU = Math.round(page.wMM * 1000), HU = Math.round(page.hMM * 1000), fU = Math.round(page.frameMM * 1000);
    const rU = Math.round(reg.diaMM * 500), inset = Math.round(fU / 2);
    if (fU <= 0 || rU < 1) return [];
    return [[inset, inset], [WU - inset, inset], [inset, HU - inset], [WU - inset, HU - inset]].map(([x, y]) => ({ cxUm: x, cyUm: y, rUm: rU }));
  }

  class Canceled extends Error {}
  const codedError = (e) => ({ code: (e && e.code) || "ENGINE_INTERNAL", message: (e && e.message) || String(e) });

  /**
   * generate(req: GenerateRequest, {isCanceled?, onProgress?, cache?}) → GenerateResponse (§3, §9.3; plan G2.10a).
   *
   * req = {requestId, revision, engineVersion, quality, normalizedSource: {pixels, channels: 1|4, w, h, alpha}, sourceHash,
   *        config: Project, deviceClass?: "desktop"|"mobile" (default "desktop"; rasterPlan and the complexity caps),
   *        debug?: {smoothBonded: true} (test-only; refused unless SBEngine.TEST_HOOKS)}.
   * Synchronous and pure (inputs are not mutated); never throws: a failure is status "error" with error {code, message}.
   * cache (alpha.3 E3, NFR-05): a plain object the caller owns and the only argument generate writes. Slots
   *   k1 = {key, o: {w, h}, samples, alpha, ch} (orient + resample) and k2 = {key, L} (tonal luminance after Kuwahara),
   *   keyed on SBRaster.cacheKey with req.sourceHash, orientation, mode and alpha presence (k2 adds smoothing and the
   *   alpha policy); a hit reports "resample-cached" / "interpret-cached" through onProgress. Without req.sourceHash
   *   the cache is bypassed. cache.quality is the quality it serves (an untagged cache takes the first request's);
   *   a mismatch throws CACHE_QUALITY (the one caller error that throws), so a draft cache never feeds a
   *   fabrication run. Cached arrays are never written by later stages and never appear in the response.
   * Stages (§11.1), cancelable between stages and inside the engine's own per-layer loops:
   *   1  orient (EXIF only when engine-applied, then rotate, mirror)            SBEngine.orient
   *   2  resample to SBEngine.rasterPlan(config, source, quality, deviceClass)   its FAB_* diagnostics; never upsample
   *   3  domain mask A                                                           SBHeight.domainMask (alpha moves with 1–2)
   *   4  interpret: height = interpretHeight (heightFilter only when set); tonal = luminance → Kuwahara → thresholds
   *      (domain-aware) → bands → tonalAdded (EMPTY_BAND info per empty band)
   *   5  cumulativeMasks
   *   6  construct (SBConstruct.bonded | connected; cleanupReport in mm², connected bridges as µm polygons; at draft
   *      quality also the added/removed change polygons for the overlays, G2.13b)
   *  11a complexity: SBConstruct.complexityGate on the final masks (simplify "busy" if set, then the parts cap) BEFORE trace
   *   7  trace → bounded smoothing on pixel loops (connected + cornerStyle smooth only; bonded raw, D1) → fromPixelLoops →
   *      normalize   (SBMaterial.fromMasks)
   *   8  frame union (exact rectangle ring; inside fromMasks, after smoothing)
   *  11b vertex caps: SBConstruct.vertexGate after fromMasks, before validation
   *   9  replay construction.repairs[] (SBSupport.replayRepairs)
   *  10  holes: the legacy connected corners (G1.7) until G3.1
   *  12  SBGeom.validate (per layer, in fromMasks/withMaterial), SBSupport.validate, featureChecks, checkEnvelope
   *  13  assignParts, then Part.supports from the support graph (SBSupport.annotate)
   *  14  guides: G3.1 inserts them (snapshot.guides null until then)
   * A cap over its limit returns status "error", COMPLEXITY_LIMIT and NO layers.
   * Then (G2.10b), all lengths as µm integers (t = round(thicknessMM·1000), g = round(gapMM·1000), g = 0 in bonded mode):
   *   Z         zBottomMM(k) = k·(t + g)/1000, zTopMM = zBottomMM + t (SRS §4.3, UI-03; view.explodeMM never enters)
   *   accounting layers above the highest non-empty layer get status "omitted-trailing" and stay in layers[] with their
   *             index (D-4.7); one TRAILING_OMITTED warning; stats {requested: N, exported: N − |omitted|, omitted[],
   *             stockMM: N·t (nominal stock-only height, MAT-01: no adhesive or finish term), reliefMM: (N − 1)·t,
   *             maxZMM: top of the highest exported layer (N_e·t + (N_e − 1)·g)} (LYR-01)
   *   hashes    geometryHash = hashJSON({key: geometryKey(config), engine: VERSION, quality, raster: [rasterW, rasterH],
   *             layers: SBGeom.layerHashes(L).layerHash per index 0..N−1 (omitted layers included), guides: guideHash})
   *             (§3, D4); also in the response as geometryHash
   *   payload   (alpha.3 E2, UI-05; display data outside the hash input) cleanupReport[k].bridged/.culled (SBConstruct
   *             report; 0 in bonded), snapshot.repairsApplied (indices replayRepairs applied; [] without repairs),
   *             snapshot.page {wMM, hMM, frameMM, artWMM, artHMM}, snapshot.construction {mode, tMM, gMM (0 in bonded)}
   *   freeze    every response is deep-frozen (Object.freeze; typed arrays skipped)
   * Draft/fabrication (LYR-06): the hash carries quality and the raster size, so draft diagnostics and acks never
   * apply to a fabrication snapshot; every export regenerates at fabrication (alpha.2 checkpoint; two-phase in G3.10).
   */
  E.generate = function (req, opts) {
    opts = opts || {};
    const head = { requestId: req && req.requestId !== undefined ? req.requestId : null, revision: req && req.revision !== undefined ? req.revision : null, engineVersion: E.VERSION };
    const isCanceled = typeof opts.isCanceled === "function" ? opts.isCanceled : () => false;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
    const step = (stage, frac) => { if (isCanceled()) throw new Canceled(); onProgress(stage, frac); };
    const fail = (code, message, diagnostics) => deepFreeze(Object.assign({}, head, { status: "error", error: { code, message }, diagnostics: diagnostics || [] }));
    if (!req || typeof req !== "object") return fail("ENGINE_ARG", "request must be a GenerateRequest");
    if (req.engineVersion !== E.VERSION) return fail("ENGINE_MISMATCH", "request names engine " + req.engineVersion + ", this engine is " + E.VERSION);
    if (req.debug !== undefined && req.debug !== null && !E.TEST_HOOKS) return fail("ENGINE_DEBUG_DISABLED", "req.debug is a test-only hook");
    const cache = opts.cache === undefined || opts.cache === null ? null : opts.cache;
    if (cache !== null) {
      if (typeof cache !== "object") throw efail("ENGINE_ARG", "opts.cache must be a plain object the caller owns");
      // alpha.3 E3 (LYR-06): a cache carries its quality; an untagged cache takes the quality of its first request.
      if (cache.quality === undefined) cache.quality = req.quality;
      if (cache.quality !== req.quality) throw efail("CACHE_QUALITY", "a " + cache.quality + " stage cache cannot feed a " + req.quality + " request");
    }
    let res;
    try {
      res = run(req, head, step, fail, cache);
    } catch (e) {
      res = e instanceof Canceled ? Object.assign({}, head, { status: "canceled" }) : Object.assign({}, head, { status: "error", error: codedError(e), diagnostics: [] });
    }
    return deepFreeze(res);
  };

  /**
   * guideHash(guides) (§3, D4): what the guides add beyond the score polylines already inside each layerHash — labels,
   * omissions with reasons and the placement map. null guides (until G3.1) hash as hashJSON(null).
   */
  E.guideHash = function (guides) {
    const H = global.SBHash;
    if (guides === null || guides === undefined) return H.hashJSON(null);
    return H.hashJSON({ labels: guides.labels || [], omitted: guides.omitted || [], map: guides.map === undefined ? null : guides.map });
  };

  function run(req, head, step, fail, cache) {
    const R = global.SBRaster, Hh = global.SBHeight, C = global.SBConstruct, M = global.SBMaterial, S = global.SBSupport, D = global.SBDiag, G = global.SBGeom;
    const p = req.config, quality = req.quality, deviceClass = req.deviceClass === undefined ? "desktop" : req.deviceClass;
    if (quality !== "draft" && quality !== "fabrication") return fail("ENGINE_ARG", "quality must be draft|fabrication (got " + quality + ")");
    if (deviceClass !== "desktop" && deviceClass !== "mobile") return fail("ENGINE_ARG", "deviceClass must be desktop|mobile (got " + deviceClass + ")");
    if (!p || typeof p !== "object") return fail("ENGINE_ARG", "config must be a Project");
    if (!p.source) return fail("NO_SOURCE", "the project has no source (PRJ-01: no auto-demo)");
    const v = global.SBSchema.validate(p);
    if (!v.ok) return fail("PROJECT_INVALID", v.errors.slice(0, 5).map((x) => x.path + " " + x.code).join("; "));
    if (req.revision !== p.revision) return fail("REVISION_MISMATCH", "request revision " + req.revision + " != project revision " + p.revision);
    const ns = req.normalizedSource;
    if (!ns || typeof ns !== "object" || !isPosInt(ns.w) || !isPosInt(ns.h) || (ns.channels !== 1 && ns.channels !== 4) ||
        !ns.pixels || ns.pixels.length !== ns.w * ns.h * ns.channels || (ns.alpha != null && ns.alpha.length !== ns.w * ns.h))
      return fail("ENGINE_ARG", "normalizedSource must be {pixels: w·h·channels bytes, channels: 1|4, w, h, alpha: w·h bytes|null}");
    const debug = req.debug || {}, smoothBonded = !!debug.smoothBonded;
    const revision = p.revision, dOpts = { revision, quality };
    const interp = p.interpretation, con = p.construction, mat = p.material, N = con.sheets, bonded = con.mode === "bonded-relief";
    const diagnostics = [];

    // 1–2. orient and resample (alpha.3 E3: slot K1 of the caller-owned cache; rasterPlan reads only sizes, so it runs
    // first). rasterPlan orients the source size itself, so it gets the unoriented size. Without req.sourceHash the
    // cache is bypassed (never keyed on pixel identity alone).
    const plan = E.rasterPlan(p, { w: ns.w, h: ns.h }, quality, deviceClass), geo = plan.geometry, W = geo.rasterW, H = geo.rasterH;
    const useCache = !!cache && typeof req.sourceHash === "string" && req.sourceHash.length > 0;
    let ch = interp.mode === "height" ? 1 : ns.channels;
    const k1 = useCache ? R.cacheKey({ w: ns.w, h: ns.h, channels: ch, W, H, method: geo.resample, sampleHash: req.sourceHash }) + "|" +
      JSON.stringify(p.source.orientation) + "|" + interp.mode + "|" + (ns.alpha ? "a" : "-") : null;
    let o, samples, alpha;
    if (useCache && cache.k1 && cache.k1.key === k1) {
      ({ o, samples, alpha, ch } = cache.k1);
      step("resample-cached", 0.1);
    } else {
      step("orient", 0);
      let px = ns.pixels;
      ch = ns.channels;
      if (interp.mode === "height" && ch === 4) { const g = new Uint8Array(ns.w * ns.h); for (let i = 0; i < g.length; i++) g[i] = px[i * 4]; px = g; ch = 1; }
      const oo = E.orient({ samples: px, alpha: ns.alpha == null ? null : ns.alpha, w: ns.w, h: ns.h }, p.source.orientation);
      step("resample", 0.05);
      o = { w: oo.w, h: oo.h };
      samples = R.resample(oo.samples, ch, oo.w, oo.h, W, H, geo.resample);   // always a fresh array (never the source)
      alpha = oo.alpha ? R.resample(oo.alpha, 1, oo.w, oo.h, W, H, geo.resample) : null;
      if (useCache) { cache.k1 = { key: k1, o, samples, alpha, ch }; cache.k2 = null; }
    }
    diagnostics.push(...plan.diagnostics);
    if (geo.resample !== "none") diagnostics.push(D.make("RESAMPLED", Object.assign({}, dOpts, {
      detail: o.w + " × " + o.h + " px → " + W + " × " + H + " px (" + geo.resample + ")" })));

    // 3. domain mask A
    step("domain", 0.1);
    const src = p.source.alpha || { mode: "full", t: 0.5 };
    const domain = Hh.domainMask(alpha, src.mode, src.t);

    // 4. interpret
    step("interpret", 0.15);
    let added;
    if (interp.mode === "height") {
      const r = E.interpretHeight(samples, W, H, interp, N, domain, Object.assign({ geometry: geo }, dOpts));
      added = r.added; diagnostics.push(...r.diagnostics);
    } else {
      // alpha.3 E3: slot K2 (tonal luminance after Kuwahara); thresholds and bands only read L.
      // E3b: the radius is physical; rPx (its conversion on this raster) is in the key, so a raster change re-keys K2.
      const rPx = E.radiusPx(interp.smoothing.radiusMM, geo);
      const k2 = useCache ? k1 + "|" + JSON.stringify(interp.smoothing) + "|" + rPx + "|" + JSON.stringify(p.source.alpha) : null;
      let L;
      if (useCache && cache.k2 && cache.k2.key === k2) {
        L = cache.k2.L;
        step("interpret-cached", 0.15);
      } else {
        if (ch === 4) L = R.luminance(samples, W, H); else { L = new Float32Array(W * H); for (let i = 0; i < L.length; i++) L[i] = samples[i]; }
        L = R.kuwahara(L, W, H, rPx, interp.smoothing.passes, domain);
        if (useCache) cache.k2 = { key: k2, L };
      }
      const th = R.thresholds(L, N, interp.thresholdRule, { manual: interp.manual, domain });
      for (const b of th.emptyBands) diagnostics.push(D.make("EMPTY_BAND", Object.assign({}, dOpts, { detail: "band " + b + " of " + N + " has no pixels" })));
      added = Hh.tonalAdded(R.bands(L, th), N, interp.polarity === "dark-front");
    }

    // 5. cumulative masks
    step("masks", 0.2);
    const masks = Hh.cumulativeMasks(added, domain, N, W, H);

    // 6. construct
    step("construct", 0.25);
    const cpx = constructPx(con, bonded, geo.sxUm, geo.syUm);
    const built = bonded ? C.bonded(masks, W, H, cpx) : C.connected(masks, W, H, cpx);
    const pxMM2 = (geo.sxUm * geo.syUm) / 1e6;
    const page = M.page({ artWMM: geo.artWMM, artHMM: geo.artHMM, frame: con.frame });
    const fUm = Math.round(page.frameMM * 1000);
    const cleanupReport = built.report.map((r, k) => {
      step("construct", 0.25 + (0.05 * k) / N);
      const e = { layer: k, addedMM2: r.addedPx * pxMM2, removedMM2: r.removedPx * pxMM2, holesFilled: r.filledHoles, partsRemoved: r.removedParts,
        bridged: r.bridged || 0, culled: r.culled || 0 };   // alpha.3 E2 (UI-05): SBConstruct report counts (bonded: 0)
      const b = built.bridges[k];
      if (b) { const poly = E.maskPolygons(W, H, geo.sxUm, geo.syUm, fUm, (i) => b[i]); if (poly) e.bridges = poly; }
      // G2.13b (GEO-08, UI-05): change overlays at draft quality only, so the fabrication budget is unchanged.
      if (quality === "draft") {
        const pre = masks[k], fin = built.final[k];
        if (r.addedPx) e.added = E.maskPolygons(W, H, geo.sxUm, geo.syUm, fUm, (i) => fin[i] && !pre[i]);
        if (r.removedPx) e.removed = E.maskPolygons(W, H, geo.sxUm, geo.syUm, fUm, (i) => pre[i] && !fin[i]);
      }
      return e;
    });

    // 11a. complexity: parts cap (with explicit busy simplification) before trace
    step("complexity", 0.3);
    const gate = C.complexityGate(built.final, W, H, { deviceClass, simplify: con.cleanup.simplify, minFeatureMM: mat.minFeatureMM, minPartMM2: mat.minPartMM2,
      sxUm: geo.sxUm, syUm: geo.syUm, quality, revision });
    diagnostics.push(...gate.diagnostics);
    if (gate.status !== "ok") return fail("COMPLEXITY_LIMIT", "parts per layer exceed the " + deviceClass + " cap; no layers are returned", diagnostics);

    // 7–8. trace, bounded smoothing on pixel loops (connected only; D1), fromPixelLoops, normalize, frame union
    step("trace", 0.35);
    const fOpts = { revision, quality, frame: fUm > 0 };
    if (con.cleanup.cornerStyle === "smooth" && (!bonded || smoothBonded))
      fOpts.smooth = { mode: "connected", tolUm: Math.round(con.cleanup.toleranceMM * 1000) };
    let layers = M.fromMasks(gate.masks, W, H, page, fOpts);

    // 11b. vertex caps after fromMasks, before validation
    step("complexity", 0.6);
    const vg = C.vertexGate(layers, deviceClass, { quality, revision });
    diagnostics.push(...vg.diagnostics);
    if (vg.status !== "ok") return fail("COMPLEXITY_LIMIT", "vertices exceed the " + deviceClass + " cap; no layers are returned", diagnostics);

    // 9. replay reviewed repairs (after the frame union, before holes and validation)
    step("repairs", 0.62);
    let repairsApplied = [];
    if (con.repairs.length) {
      const rp = S.replayRepairs(layers, con.repairs, { project: p, quality, revision });
      layers = rp.layers; diagnostics.push(...rp.diagnostics); repairsApplied = rp.applied;
    }

    // 10. holes (legacy connected corners until G3.1)
    step("holes", 0.65);
    const holes = legacyHoles(p, page);
    if (holes.length) layers = layers.map((L, k) => {
      step("holes", 0.65 + (0.03 * k) / N);
      return con.registration.layers === "all" || con.registration.layers.includes(k) ? M.subtractHoles(L, holes, { revision, quality }) : L;
    });

    // 12. validation: SBGeom.validate (layer diagnostics), support, features, envelope
    step("validate", 0.7);
    for (const L of layers) diagnostics.push(...L.diagnostics);
    const sv = S.validate(layers, con.mode, { minFeatureMM: mat.minFeatureMM, advisoryFeatureMM: mat.advisoryFeatureMM, revision, quality });
    diagnostics.push(...sv.diagnostics);
    step("features", 0.85);
    diagnostics.push(...S.featureChecks(layers, { minFeatureMM: mat.minFeatureMM, advisoryFeatureMM: mat.advisoryFeatureMM, minPartMM2: mat.minPartMM2,
      mmPerPxMax: geo.mmPerPxMax, calibrated: mat.calibrated, revision, quality }));
    step("envelope", 0.95);
    diagnostics.push(...S.checkEnvelope({ wMM: page.wMM, hMM: page.hMM }, p.machine, mat, dOpts));

    // 13. parts and their supports; 14. guides arrive with G3.1
    step("parts", 0.98);
    layers = S.annotate(M.assignParts(layers), sv.supportGraph);
    const guides = null;

    // G2.10b: Z model (µm integers; bonded g = 0, D1/SRS §4.3) and trailing-empty accounting (D-4.7, LYR-01)
    step("accounting", 0.985);
    const tUm = Math.round(mat.thicknessMM * 1000), gUm = bonded ? 0 : Math.round(con.gapMM * 1000), pitchUm = tUm + gUm;
    let last = -1;
    layers.forEach((L, k) => { if (L.material.length > 0) last = k; });
    const omitted = [];
    layers = layers.map((L, k) => {
      if (k > last) omitted.push(k);
      return Object.assign({}, L, { zBottomMM: (k * pitchUm) / 1000, zTopMM: (k * pitchUm + tUm) / 1000, status: k > last ? "omitted-trailing" : L.status });
    });
    const exported = N - omitted.length;
    if (omitted.length) diagnostics.push(D.make("TRAILING_OMITTED", Object.assign({}, dOpts, {
      detail: "layer" + (omitted.length > 1 ? "s " : " ") + omitted.join(", ") + " empty; " + exported + " of " + N + " sheets exported" })));
    const stats = {
      requested: N, exported, omitted,
      stockMM: (N * tUm) / 1000, reliefMM: ((N - 1) * tUm) / 1000,
      maxZMM: exported > 0 ? ((exported - 1) * pitchUm + tUm) / 1000 : 0,
    };

    // G2.10b: D4 hashes — one layerHash per index 0..N−1 (omitted layers included), then geometryHash (§3)
    const layerHashes = layers.map((L) => { step("hashes", 0.99); return G.layerHashes(L).layerHash; });
    const geometryHash = global.SBHash.hashJSON({ key: global.SBSchema.geometryKey(p), engine: E.VERSION, quality,
      raster: [W, H], layers: layerHashes, guides: E.guideHash(guides) });
    const snapshot = {
      revision, engineVersion: E.VERSION, geometryHash, quality, layers, diagnostics, cleanupReport,
      supportGraph: sv.supportGraph, guides, geometry: geo, stats, repairsApplied,
      // alpha.3 E2 (UI-05): display data outside the hash input, so a stale result is drawn with its own settings
      page: { wMM: page.wMM, hMM: page.hMM, frameMM: page.frameMM, artWMM: geo.artWMM, artHMM: geo.artHMM },
      construction: { mode: con.mode, tMM: mat.thicknessMM, gMM: bonded ? 0 : con.gapMM },
    };
    step("done", 1);
    return Object.assign({}, head, { status: "done", validatedLayers: layers, snapshot, diagnostics, geometryHash });
  }

  // ------------------------------------------------ fabrication export (checkpoint v2.0.0-alpha.2, LYR-06, EXP-07)

  /**
   * sourceRecord(px: {w, h, channels}, route: {format, decode}, base?: SourceRecord) → SourceRecord (alpha.3 E1, PRJ-02).
   * The record for pixels the app has already decoded and oriented (browser or SBEngine.orient at intake): size and
   * channels follow the pixels, orientation is the identity {exif 1, exifAppliedBy "none"} (no second rotation), format
   * and decode follow the route when given. Every other field of `base` (its hashes and the user's alpha policy) is kept.
   * Pure: base is not mutated.
   */
  E.sourceRecord = function (px, route, base) {
    const src = Object.assign(global.SBSchema.sourceTemplate(), base ? JSON.parse(JSON.stringify(base)) : {});
    if (route && route.format) src.format = route.format;
    if (route && route.decode) src.decode = route.decode;
    src.w = px.w; src.h = px.h; src.channels = px.channels;
    src.orientation = { exif: 1, exifAppliedBy: "none", rotate: 0, mirror: false };
    return src;
  };

  /**
   * sampleBytes(px: {pixels, channels, w, h, alpha}) → Uint8Array, the canonical sample stream hashed into
   * source.sampleHash (alpha.3 E1, SUP-04): u32le(w) u32le(h) u32le(channels) u8(alpha ? 1 : 0) pixels [alpha].
   * The alpha plane is covered, so two sources with the same samples but different transparency hash apart.
   */
  E.sampleBytes = function (px) {
    const n = px.pixels.length, a = px.alpha || null, out = new Uint8Array(13 + n + (a ? a.length : 0)), dv = new DataView(out.buffer);
    dv.setUint32(0, px.w, true); dv.setUint32(4, px.h, true); dv.setUint32(8, px.channels, true); out[12] = a ? 1 : 0;
    out.set(px.pixels, 13);
    if (a) out.set(a, 13 + n);
    return out;
  };

  /**
   * request(project, px: {pixels, channels: 1|4, w, h, alpha}, {quality, requestId?, deviceClass?}) → GenerateRequest
   * (alpha.3 E1, LYR-06). The one request builder: the draft and the fabrication request of one project revision have
   * the same config (the project itself, never rewritten) and the same normalizedSource; only quality differs.
   * project.source is used as installed at intake (SBSchema.withSource); when it is set and its w, h or channels differ
   * from the pixels, throws SOURCE_MISMATCH (the pixels and the record they run under always belong together).
   * sourceHash is source.sampleHash (byteHash when no sample hash exists).
   */
  E.request = function (project, px, o) {
    o = o || {};
    const s = project.source;
    if (s && (s.w !== px.w || s.h !== px.h || s.channels !== px.channels))
      throw efail("SOURCE_MISMATCH", "project.source is " + s.w + " × " + s.h + " × " + s.channels + " but the pixels are " + px.w + " × " + px.h + " × " + px.channels);
    return { requestId: o.requestId === undefined ? o.quality : o.requestId, revision: project.revision, engineVersion: E.VERSION, quality: o.quality,
      normalizedSource: { pixels: px.pixels, channels: px.channels, w: px.w, h: px.h, alpha: px.alpha == null ? null : px.alpha },
      sourceHash: s ? (s.sampleHash || s.byteHash) : null, config: project, deviceClass: o.deviceClass === undefined ? "desktop" : o.deviceClass };
  };

  /**
   * fabricationRequest(project, pixels: {pixels, channels: 1|4, w, h, alpha}, {requestId?, deviceClass?, format?, decode?})
   *   → GenerateRequest at quality "fabrication" (G2.10b rule: every export regenerates at fabrication).
   * alpha.3 E1: a wrapper over SBEngine.request. Only a project without a source (the alpha.2 callers and the DEP-04
   * path) gets a record installed here (SBEngine.sourceRecord with format/decode from the options); a project whose
   * source is already installed is passed through unchanged, so this is exactly SBEngine.request(project, px,
   * {quality: "fabrication", …}) and also throws SOURCE_MISMATCH. The app never calls it (it builds every request
   * with SBEngine.request). Pure: project is not mutated.
   */
  E.fabricationRequest = function (project, px, o) {
    o = o || {};
    const config = project.source ? project : Object.assign({}, project, { source: E.sourceRecord(px, o, null) });
    return E.request(config, px, { quality: "fabrication", requestId: o.requestId === undefined ? "export" : o.requestId, deviceClass: o.deviceClass });
  };

  /**
   * fabricationFiles(snapshot, project, colors) → [{name, data}] in the legacy flat layout (the §9.4 layout is G3.9):
   * sheet_NN.svg (NN = index + 1) for every layer that is not omitted-trailing, then proof.svg (SBSvg.assemblySVG of
   * those layers) in the snapshot's page frame. Connected sheets keep the v1.1.0 text label "{title} k/n" (until G3.2);
   * bonded sheets are pure vector. A snapshot that is not at fabrication quality is refused (QUALITY): draft geometry
   * is never exported (LYR-06).
   */
  E.fabricationFiles = function (snapshot, project, colors) {
    if (!snapshot || snapshot.quality !== "fabrication")
      throw new Error("SBEngine.fabricationFiles: QUALITY — only a fabrication snapshot is exported (got " + (snapshot && snapshot.quality) + ")");
    const S = global.SBSvg, mode = project.construction.mode, page = snapshot.page;
    const layers = snapshot.layers.filter((L) => L.status !== "omitted-trailing"), n = snapshot.layers.length;
    const files = layers.map((L) => ({
      name: "sheet_" + String(L.index + 1).padStart(2, "0") + ".svg",
      data: S.layerSVG(L, page, mode === "connected-sheet"
        ? { construction: mode, legacyTextLabel: project.title + " " + (L.index + 1) + "/" + n }
        : { construction: mode }),
    }));
    files.push({ name: "proof.svg", data: S.assemblySVG(layers, page, colors) });
    return files;
  };

  global.SBEngine = E;
})(typeof window !== "undefined" ? window : globalThis);
