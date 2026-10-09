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
 * Speed round F9 (S1): the pipeline is the runSteps generator; it yields per-layer / per-pair batches of E.TASKS
 * kernels and folds their results in item order. generate (sync driver) and generateAsync (exec.map driver, the worker
 * pool) resume the same generator, so their folds are identical; the request carries draftCapPx (F-D5).
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
   * Speed round F8 (S5, S3): maskPolygonsCrop(mask, x0, y0, x1, y1, sxUm, syUm, fUm) → the maskPolygons result for a
   * raster whose set pixels all lie in the crop [x0, x1) × [y0, y1); mask is the crop's own (x1 − x0)·(y1 − y0) 0/1
   * mask (row-major, not written). Only the crop is traced. Equal to the uncropped path bit for bit: a crop holding
   * every set pixel has the same boundary edges, the corner scan is row-major in both, so the loops differ only by
   * (x0, y0), which is added to the points in pixel space before scaling, so fromPixelLoops still rounds
   * Math.round(p·sx + ox) on the same p (never fold x0·sx into ox in µm: different rounding). Oracle:
   * test/oracle_kernels.js oracleMaskPolygons (NFR-05).
   */
  E.maskPolygonsCrop = function (mask, x0, y0, x1, y1, sxUm, syUm, fUm) {
    const cw = x1 - x0, ch = y1 - y0;
    const loops = global.SBTrace.trace(mask, cw, ch);
    if (!loops.length) return null;
    if (x0 || y0) for (const L of loops) for (const p of L) { p[0] += x0; p[1] += y0; }
    const G = global.SBGeom;
    return G.normalize(G.union(G.fromPixelLoops(loops, sxUm, syUm, fUm, fUm), []));
  };

  /**
   * Speed round F8: changePolygons(a, b, w, h, sxUm, syUm, fUm) → maskPolygons of the pixels where a[i] ∧ ¬b[i]
   * (b null: where a[i]), or null when there is none. The diff pass finds the bounding box, then only the crop is
   * built and traced (maskPolygonsCrop). Neither mask is written. The draft change overlays (added = final ∧ ¬pre,
   * removed = pre ∧ ¬final) and the connected bridges use it.
   */
  E.changePolygons = function (a, b, w, h, sxUm, syUm, fUm) {
    const c = global.SBConstruct.changeMask(a, b, w, h);   // speed round F9: the crop moved into SBConstruct (constructLayer emits it)
    return c ? E.maskPolygonsCrop(c.mask, c.x0, c.y0, c.x1, c.y1, sxUm, syUm, fUm) : null;
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
   * view's page over w × h, so SAMPLING_LOW reflects the geometry the legacy path exports; unlike generate, which since
   * speed round F1 / F-D1 judges SAMPLING_LOW on the fabrication raster plan, no samplingMmPerPx is passed here, because
   * the legacy sheets are cut at this pitch) and SBSupport.checkEnvelope.
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
   * rasterPlan(project, {w, h}, "draft"|"fabrication", deviceClass, draftCapPx?) → {quality, geometry: GeometryConfig, diagnostics}
   * deep-frozen (LYR-06, GEO-06, NFR-04, PO-LASER-4/5). Reads only source.w and source.h, so it runs before any
   * decode. Sizes come from SBSchema.resolveSize on the oriented source.
   *   draft:        SBRaster.rasterSize at min(geometry.draftPx, limits(deviceClass).draftPxCap) on the long side
   *                 (alpha.3 E4, PO-PREVIEW-1: the measured device cap of docs/perf/draft-budget.json; the cap is not a
   *                 project field, so the project key is the same on every device); no pitch, no budget, no pitch diagnostics.
   *                 Speed round F9 (F-D5): an explicit draftCapPx (positive integer; the request field) replaces the device
   *                 cap, so the runtime (pooled or fallback) reaches rasterPlan only as an argument, never as hidden state.
   *   fabrication:  SBRaster.fabRaster at round(fabPitchMM·1000) µm under limits(deviceClass).fabPxBudget, with
   *                 FAB_PITCH_CAPPED / FAB_EXCEEDS_SOURCE (quality "fabrication", the project revision).
   * resample follows the G2.0 policy for interpretation.mode (height "area" only when geometry.resample.height
   * selects it explicitly). generate (G2.10a) takes its raster only from here; export recomputes the fabrication
   * plan for the current revision and device class (a draft plan never stands in for it).
   */
  E.rasterPlan = function (project, source, quality, deviceClass, draftCapPx) {
    if (quality !== "draft" && quality !== "fabrication") throw efail("ENGINE_ARG", "quality must be draft|fabrication (got " + quality + ")");
    if (!source || typeof source !== "object") throw efail("ENGINE_ARG", "source must be {w, h}");
    const w0 = source.w, h0 = source.h;
    if (!isPosInt(w0) || !isPosInt(h0)) throw efail("ENGINE_ARG", "source size must be positive integers (got " + w0 + " × " + h0 + ")");
    if (draftCapPx !== undefined && draftCapPx !== null && !isPosInt(draftCapPx)) throw efail("ENGINE_ARG", "draftCapPx must be a positive integer (got " + draftCapPx + ")");
    const R = global.SBRaster, Sch = global.SBSchema;
    const lim = Sch.limits(deviceClass);
    const [srcW, srcH] = orientedSize(project, w0, h0);
    const sz = Sch.resolveSize(project, srcW, srcH);
    const g = project.geometry, diagnostics = [];
    let W, H, targetPitchUm = null, pitchUm = null, pxBudget = null, capped = "none", shortPx = null;
    if (quality === "draft") {
      const r = R.rasterSize(srcW, srcH, Math.min(g.draftPx, draftCapPx === undefined || draftCapPx === null ? lim.draftPxCap : draftCapPx));
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
  E.Canceled = Canceled;   // speed round F14: what a canceled run throws (the coordinator rejects an aborted batch with it)
  const codedError = (e) => ({ code: (e && e.code) || "ENGINE_INTERNAL", message: (e && e.message) || String(e) });

  // ------------------------------------------------ speed round F9 (S1): kernels, batches and the drivers
  /**
   * BatchError(errors: [{index, error, phase?}]) — what an exec.map rejects with when items failed (after EVERY item has
   * settled). The driver raises the error of the lowest (phase, item index) as codedError(error) verbatim (F.3); phase
   * orders the serial sub-steps of a fused item (traceConvert: trace 0 before convert 1, as fromMasks traces every layer
   * before it converts any), default 0. Any other rejection is raised as is.
   */
  class BatchError extends Error {
    constructor(errors) { super("SBEngine batch: " + (errors ? errors.length : 0) + " item(s) failed"); this.errors = errors || []; }
  }
  E.BatchError = BatchError;
  /** A kernel error tagged with the phase of a fused item; unwrapped by pickError. */
  class PhaseError {
    constructor(phase, error) { this.phase = phase; this.error = error; }
  }
  E.PhaseError = PhaseError;
  function pickError(errors) {
    let found = false, best, bp = 0, bi = 0;
    for (const x of errors) {
      const ph = x.phase !== undefined ? x.phase : x.error instanceof PhaseError ? x.error.phase : 0;
      if (!found || ph < bp || (ph === bp && x.index < bi)) { found = true; best = x.error; bp = ph; bi = x.index; }
    }
    return best instanceof PhaseError ? best.error : best;
  }
  const phased = (phase, fn) => { try { return fn(); } catch (e) { throw new PhaseError(phase, e); } };

  /**
   * overlayLayer({added, removed, bridges, W, H, sxUm, syUm, fUm}) → {added?, removed?, bridges?}: the change-overlay and
   * bridge polygons of one layer (G2.13b, F8): added/removed are SBConstruct.changeMask crops (null: not wanted),
   * bridges the connected bridge mask (null: none); a key is present only for a non-null input (bridges only when its
   * polygons are non-null). Pure.
   */
  E.overlayLayer = function (a) {
    const out = {};
    if (a.bridges) { const poly = E.changePolygons(a.bridges, null, a.W, a.H, a.sxUm, a.syUm, a.fUm); if (poly) out.bridges = poly; }
    if (a.added) out.added = E.maskPolygonsCrop(a.added.mask, a.added.x0, a.added.y0, a.added.x1, a.added.y1, a.sxUm, a.syUm, a.fUm);
    if (a.removed) out.removed = E.maskPolygonsCrop(a.removed.mask, a.removed.x0, a.removed.y0, a.removed.x1, a.removed.y1, a.sxUm, a.syUm, a.fUm);
    return out;
  };

  /**
   * TASKS (frozen): kernel name → pure function. Every parallel point of runSteps yields {kind, items, transfer} where
   * items[i] is the argument list of TASKS[kind] and transfer[i] the typed arrays of item i that nothing else reads
   * afterwards (whole buffers only). Kernels never write their arguments and never return aliases of them; they are
   * looked up on their modules at call time.
   */
  E.TASKS = Object.freeze({
    construct: (k, a) => global.SBConstruct.constructLayer(k, a),
    overlays: (a) => E.overlayLayer(a),
    trace: (mask, k, w, h) => global.SBMaterial.traceLayer(mask, k, w, h),
    convert: (t, k, ctx) => global.SBMaterial.convertLayer(t, k, ctx),
    traceConvert: (mask, k, w, h, ctx) => {
      const t = phased(0, () => global.SBMaterial.traceLayer(mask, k, w, h));
      return phased(1, () => global.SBMaterial.convertLayer(t, k, ctx));
    },
    supportPair: (lo, up, k, cfg) => global.SBSupport.supportPair(lo, up, k, cfg),
    featureLayer: (L, k, cfg) => global.SBSupport.featureLayer(L, k, cfg),
    buildPair: (k, lower, upper, P, dOpts) => global.SBGuides.buildPair(k, lower, upper, P, dOpts),
    validatePair: (k, lower, upper, paths, P, dOpts) => global.SBGuides.validatePair(k, lower, upper, paths, P, dOpts),
    layerHash: (L) => global.SBGeom.layerHashes(L).layerHash,
    // speed round F13 (S1/S2): row-band raster kernels (source rows / seed rows sliced by the coordinator)
    resampleRows: (srcRows, ch, w, h, W, H, method, Y0, Y1, ys) => global.SBRaster.resampleBand(srcRows, ch, w, h, W, H, method, Y0, Y1, ys),
    kuwaharaRows: (srcRows, w, h, r, seed, y0, y1, domainRows) => global.SBRaster.kuwaharaRows(srcRows, w, h, r, seed, y0, y1, domainRows),
  });

  // ------------------------------------------------ speed round F13 (S1, S2): scheduling, memory gate, row bands
  /**
   * bandRanges(H, bands, bandRows?) → [[y0, y1)…]: the output row bands of the raster kernels. bandRows (a positive
   * integer, test-only override) cuts bands of that many rows (a short tail band last); otherwise min(bands, H) bands
   * of near-equal height (y0 = ⌊i·H/n⌋). One band means the serial whole-image kernel runs unchanged.
   */
  E.bandRanges = function (H, bands, bandRows) {
    if (!isPosInt(H)) return [];
    const out = [];
    if (isPosInt(bandRows)) { for (let y = 0; y < H; y += bandRows) out.push([y, Math.min(H, y + bandRows)]); return out; }
    const n = Math.max(1, Math.min(isPosInt(bands) ? bands : 1, H));
    for (let i = 0; i < n; i++) out.push([Math.floor((i * H) / n), Math.floor(((i + 1) * H) / n)]);
    return out;
  };
  /**
   * lptOrder(cost) → item indices, largest cost first (LPT), ties and missing costs by index. Dispatch order only: the
   * results are still folded in item order, so it never reaches a response.
   */
  E.lptOrder = function (cost, n) {
    const m = Number.isInteger(n) ? n : cost ? cost.length : 0, c = (i) => (cost && Number.isFinite(cost[i]) ? cost[i] : 0);
    return Array.from({ length: m }, (_, i) => i).sort((a, b) => c(b) - c(a) || a - b);
  };
  const MiB = 1024 * 1024, MIN_ITEM_BYTES = 64 * 1024;
  /**
   * memoryBudget(deviceMemory, deviceClass) → bytes (NFR-04, F.3, F-D6): the estBytes admission budget. Desktop:
   * min(1 GiB, deviceMemory · 128 MiB) when deviceMemory is a finite number (Chromium; capped at 8 there), else 512 MiB
   * (Firefox, Safari); mobile: 192 MiB.
   */
  E.memoryBudget = function (deviceMemory, deviceClass) {
    if (deviceClass === "mobile") return 192 * MiB;
    return Number.isFinite(deviceMemory) && deviceMemory > 0 ? Math.min(1024 * MiB, deviceMemory * 128 * MiB) : 512 * MiB;
  };
  /**
   * memoryLedger(budget, base) → the one estBytes ledger of a batch (F.3): base = the coordinator's resident set plus
   * the result held on main; take/give bracket each in-flight item. admits(est) is true when nothing is in flight (at
   * least one item is always admitted, even one larger than the budget: no deadlock) or base + in flight + est ≤ budget.
   * Every item counts at least MIN_ITEM_BYTES (64 KiB): a kernel's working set is never zero.
   */
  E.memoryLedger = function (budget, base) {
    const st = { used: Number.isFinite(base) && base > 0 ? base : 0, n: 0 };
    st.peak = st.used;
    const est = (b) => (Number.isFinite(b) && b > MIN_ITEM_BYTES ? b : MIN_ITEM_BYTES);
    return {
      budget,
      admits: (b) => st.n === 0 || st.used + est(b) <= budget,
      take: (b) => { st.used += est(b); st.n++; if (st.used > st.peak) st.peak = st.used; },
      give: (b) => { st.used -= est(b); st.n--; },
      get used() { return st.used; },
      get peak() { return st.peak; },
      get inFlight() { return st.n; },
    };
  };
  /**
   * checkTransfers(kind, transfer, owned) — F.3 transfer ownership, asserted before every exec.map: every declared
   * transferable must be a whole buffer (byteOffset 0, byteLength = buffer.byteLength; never a subarray) and none may
   * be a buffer in owned (the stored source, cache.k1/k2 arrays). Throws ENGINE_INTERNAL.
   */
  E.checkTransfers = function (kind, transfer, owned) {
    const bad = new Set();
    for (const v of owned || []) if (v && v.buffer) bad.add(v.buffer);
    (transfer || []).forEach((list, i) => {
      for (const v of list || []) {
        if (!ArrayBuffer.isView(v) || v.byteOffset !== 0 || v.byteLength !== v.buffer.byteLength)
          throw efail("ENGINE_INTERNAL", "exec: " + kind + "#" + i + " declares a transfer of a non-whole buffer (a subarray or not a typed array)");
        if (bad.has(v.buffer)) throw efail("ENGINE_INTERNAL", "exec: " + kind + "#" + i + " declares a transfer of a buffer the coordinator keeps (source or stage cache)");
      }
    });
  };
  /** Bytes of the typed arrays in xs (nested arrays and null allowed). */
  function bytesOf(...xs) {
    let n = 0;
    const walk = (x) => { if (!x) return; if (ArrayBuffer.isView(x)) n += x.byteLength; else if (Array.isArray(x)) for (const y of x) walk(y); };
    for (const x of xs) walk(x);
    return n;
  }
  /** The buffers a batch may never transfer: the request's source and the caller-owned stage cache (F.3). */
  function ownedArrays(req, cache) {
    const ns = (req && req.normalizedSource) || {}, out = [ns.pixels, ns.alpha];
    if (cache && cache.k1) out.push(cache.k1.samples, cache.k1.alpha);
    if (cache && cache.k2) out.push(cache.k2.L);
    return out.filter((x) => x && ArrayBuffer.isView(x));
  }

  /** The sync driver's batch: every item inline in index order, all settled, then the lowest (phase, index) error. */
  function runBatch(b, hook) {
    const fn = E.TASKS[b.kind];
    if (typeof fn !== "function") throw efail("ENGINE_INTERNAL", "no kernel " + b.kind);
    const out = new Array(b.items.length), errors = [];
    for (let i = 0; i < b.items.length; i++) {
      const args = b.items[i];
      try { out[i] = hook ? hook(b.kind, i, args, () => fn.apply(null, args)) : fn.apply(null, args); } catch (e) { errors.push({ index: i, error: e }); }
    }
    if (errors.length) throw pickError(errors);
    return out;
  }

  /**
   * generate(req: GenerateRequest, {isCanceled?, onProgress?, cache?, overlays?}) → GenerateResponse (§3, §9.3; plan G2.10a).
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
   * overlays (alpha.3 E4): false skips the draft change-overlay polygons (cleanupReport[k].added/.removed; their mm²
   *   figures stay). They measured >= 15 % of construct on the draft budget rows (docs/perf/draft-budget.json); they are
   *   display data outside the hash input, so geometryHash is unchanged.
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
   *  14  guides: SBGuides.build/validate in bonded mode with guides.mode ≠ "none" (alpha.3 E11); otherwise snapshot.guides null
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
   * Speed round F9: req.draftCapPx (SBEngine.request, F-D5) is the draft raster cap passed to rasterPlan. The stages
   * run in runSteps (below); E.generate is its sync driver and E.generateAsync the async one.
   */
  function begin(req, opts) {
    opts = opts || {};
    const head = { requestId: req && req.requestId !== undefined ? req.requestId : null, revision: req && req.revision !== undefined ? req.revision : null, engineVersion: E.VERSION };
    const isCanceled = typeof opts.isCanceled === "function" ? opts.isCanceled : () => false;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
    const step = (stage, frac) => { if (isCanceled()) throw new Canceled(); onProgress(stage, frac); };
    const fail = (code, message, diagnostics) => deepFreeze(Object.assign({}, head, { status: "error", error: { code, message }, diagnostics: diagnostics || [] }));
    if (!req || typeof req !== "object") return { res: fail("ENGINE_ARG", "request must be a GenerateRequest") };
    if (req.engineVersion !== E.VERSION) return { res: fail("ENGINE_MISMATCH", "request names engine " + req.engineVersion + ", this engine is " + E.VERSION) };
    if (req.debug !== undefined && req.debug !== null && !E.TEST_HOOKS) return { res: fail("ENGINE_DEBUG_DISABLED", "req.debug is a test-only hook") };
    let hook = null;
    if (opts.kernelHook !== undefined && opts.kernelHook !== null) {
      if (!E.TEST_HOOKS || typeof opts.kernelHook !== "function") return { res: fail("ENGINE_DEBUG_DISABLED", "opts.kernelHook is a test-only hook") };
      hook = opts.kernelHook;
    }
    // speed round F13: row bands of the raster kernels (output-neutral). bands is the driver's choice (default 1: the
    // serial whole-image kernels); bandRows is a test-only override (forces many bands, also in the sync driver).
    // F14: poll() is the cancel check of the long serial kernels (masks, Kuwahara / SAT scan, complexity gate): called
    // every few rows, it throws Canceled; outputs never depend on it.
    const par = { bands: isPosInt(opts.bands) ? opts.bands : 1, bandRows: null, poll: () => { if (isCanceled()) throw new Canceled(); } };
    if (opts.bandRows !== undefined && opts.bandRows !== null) {
      if (!E.TEST_HOOKS || !isPosInt(opts.bandRows)) return { res: fail("ENGINE_DEBUG_DISABLED", "opts.bandRows is a test-only hook (a positive integer)") };
      par.bandRows = opts.bandRows;
    }
    const cache = opts.cache === undefined || opts.cache === null ? null : opts.cache;
    if (cache !== null) {
      if (typeof cache !== "object") throw efail("ENGINE_ARG", "opts.cache must be a plain object the caller owns");
      // alpha.3 E3 (LYR-06): a cache carries its quality; an untagged cache takes the quality of its first request.
      if (cache.quality === undefined) cache.quality = req.quality;
      if (cache.quality !== req.quality) throw efail("CACHE_QUALITY", "a " + cache.quality + " stage cache cannot feed a " + req.quality + " request");
    }
    return { head, step, fail, cache, overlays: opts.overlays !== false, hook, par, isCanceled };
  }
  const settled = (head, e) => (e instanceof Canceled ? Object.assign({}, head, { status: "canceled" }) : Object.assign({}, head, { status: "error", error: codedError(e), diagnostics: [] }));

  /**
   * The sync driver (speed round F9): resumes runSteps and runs every yielded batch inline in item order (runBatch).
   * Used by Node tests, the bench and the no-worker fallback. Signature and result unchanged. opts.kernelHook(kind, i,
   * args, run) → result is a test-only wrapper around every kernel call (refused with ENGINE_DEBUG_DISABLED unless
   * SBEngine.TEST_HOOKS): the immutability mode and fault injection of the F9/F12 tests.
   */
  E.generate = function (req, opts) {
    const b = begin(req, opts);
    if (b.res) return b.res;
    let res;
    try {
      const it = runSteps(req, b.head, b.step, b.fail, b.cache, b.overlays, b.par);
      let r = it.next();
      while (!r.done) {
        let out, err, bad = false;
        try { out = runBatch(r.value, b.hook); } catch (e) { bad = true; err = e; }
        r = bad ? it.throw(err) : it.next(out);
      }
      res = r.value;
    } catch (e) {
      res = settled(b.head, e);
    }
    return deepFreeze(res);
  };

  /**
   * generateAsync(req, {exec?, isCanceled?, onProgress?, cache?, overlays?}) → Promise<GenerateResponse> (speed round F9,
   * S1): the async driver. It resumes the same runSteps generator; each batch goes to exec.map(kind, items, {transfer})
   * → Promise<results[]> in item order, whatever order the items completed in, settling ALL items before it resolves or
   * rejects (BatchError). The driver raises the lowest (phase, item index) error; a result list of the wrong length is
   * ENGINE_INTERNAL. Without exec every batch runs inline (as the sync driver). The folds are the generator's, so the
   * response equals E.generate's for every exec that returns the kernels' results.
   * Speed round F13: exec.map's options also carry cost (per-item LPT cost), estBytes (per item) and resident (the
   * coordinator's resident bytes at the yield) for scheduling and the memory gate; every declared transfer is checked
   * first (SBEngine.checkTransfers: whole buffers, never the source or a K1/K2 array). opts.bands (default 1) splits
   * the raster kernels (fabrication resample, Kuwahara per pass) into that many row bands (resampleRows /
   * kuwaharaRows batches); opts.bandRows (test-only, SBEngine.TEST_HOOKS; also accepted by E.generate) forces bands of
   * that many rows. Bands are output-neutral: concatenated bands are byte-equal to the whole-image kernels.
   * Speed round F14: opts.isCanceled is checked at every step(), before every dispatch, and every few rows inside the long
   * serial kernels (cumulativeMasks, the Kuwahara pass / seed scan, complexityGate; their poll argument) — in both drivers;
   * an exec.map that rejects with SBEngine.Canceled (an aborted batch) settles the run as canceled.
   */
  E.generateAsync = async function (req, opts) {
    opts = opts || {};
    const b = begin(req, opts);
    if (b.res) return b.res;
    const exec = opts.exec && typeof opts.exec.map === "function" ? opts.exec : null;
    let res;
    try {
      const it = runSteps(req, b.head, b.step, b.fail, b.cache, b.overlays, b.par);
      let r = it.next();
      while (!r.done) {
        const bt = r.value;
        let out, err, bad = false;
        try {
          if (b.isCanceled()) throw new Canceled();   // F14: the cancel flag is checked before every dispatch
          if (exec) {
            E.checkTransfers(bt.kind, bt.transfer, ownedArrays(req, b.cache));
            out = await exec.map(bt.kind, bt.items, { transfer: bt.transfer, cost: bt.cost, estBytes: bt.estBytes, resident: bt.resident });
          } else out = runBatch(bt, b.hook);
          if (!Array.isArray(out) || out.length !== bt.items.length)
            throw efail("ENGINE_INTERNAL", "exec.map(" + bt.kind + ") returned " + (Array.isArray(out) ? out.length : typeof out) + " results for " + bt.items.length + " items");
        } catch (e) {
          bad = true;
          err = e instanceof BatchError ? pickError(e.errors) : e instanceof PhaseError ? e.error : e;
        }
        r = bad ? it.throw(err) : it.next(out);
      }
      res = r.value;
    } catch (e) {
      res = settled(b.head, e);
    }
    return deepFreeze(res);
  };

  /**
   * guideHash(guides) (§3, D4): what the guides add beyond the score polylines already inside each layerHash — labels,
   * omissions with reasons and the placement map. null guides (connected, or guides.mode "none") hash as hashJSON(null).
   */
  E.guideHash = function (guides) {
    const H = global.SBHash;
    if (guides === null || guides === undefined) return H.hashJSON(null);
    return H.hashJSON({ labels: guides.labels || [], omitted: guides.omitted || [], map: guides.map === undefined ? null : guides.map });
  };

  /**
   * runSteps(req, head, step, fail, cache, overlays) — speed round F9 (S1): the §11.1 pipeline as a generator. At every
   * parallel point it yields a batch {kind, items, transfer} (E.TASKS[kind] applied to each items[i]) and is resumed
   * with the results in item order (or thrown into with the batch's error); the folds stay here, in item order (layer
   * index, then pair index), so scheduling and completion order never reach them. Returns the response (or a fail()).
   * Batches: construct (per layer, incl. the draft change masks) → overlays (per layer with polygons) → traceConvert
   * (bonded; connected smoothing: trace → smoothTraced → convert) → supportPair (bonded, per adjacent pair) →
   * featureLayer (per layer) → buildPair, validatePair (guides) → layerHash (per layer). Serial: everything else.
   * F13: with more than one row band (par.bands / par.bandRows) also resampleRows (fabrication, per band and plane,
   * before the domain) and kuwaharaRows (tonal, per band, once per pass).
   */
  function* runSteps(req, head, step, fail, cache, overlays, par) {
    par = par || { bands: 1, bandRows: null, poll: null };
    const poll = par.poll || null;
    // F13: a batch also carries per-item LPT costs, per-item estBytes and the coordinator's resident bytes at this
    // point (the estBytes ledger, F.3); none of them reaches a fold.
    const batch = (kind, items, transfer, cost, estBytes, resident) => ({ kind, items, transfer: transfer || null, cost: cost || null,
      estBytes: estBytes || null, resident: resident || 0 });
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
    const capPx = req.draftCapPx === undefined || req.draftCapPx === null ? undefined : req.draftCapPx;   // F-D5 (explicit runtime input)
    if (capPx !== undefined && !isPosInt(capPx)) return fail("ENGINE_ARG", "draftCapPx must be a positive integer (got " + capPx + ")");
    const plan = E.rasterPlan(p, { w: ns.w, h: ns.h }, quality, deviceClass, capPx), geo = plan.geometry, W = geo.rasterW, H = geo.rasterH;
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
      // F13: at fabrication the area/nearest resample runs as row bands (one item per band and plane); each band gets a
      // .slice() of only the source rows it reads, so the concatenation is byte-equal to the whole-image resample.
      const rb = quality === "fabrication" && geo.resample !== "none" && !(W === oo.w && H === oo.h) ? E.bandRanges(H, par.bands, par.bandRows) : [];
      if (rb.length > 1) {
        const planes = [[oo.samples, ch]].concat(oo.alpha ? [[oo.alpha, 1]] : []), items = [], tr = [], cost = [], est = [];
        for (const [px, c] of planes) for (const [Y0, Y1] of rb) {
          const sp = R.resampleSpan(oo.w, oo.h, W, H, geo.resample, Y0, Y1), rows = px.slice(sp[0] * oo.w * c, sp[1] * oo.w * c);
          items.push([rows, c, oo.w, oo.h, W, H, geo.resample, Y0, Y1, sp[0]]);
          tr.push([rows]); cost.push(rows.length); est.push(rows.byteLength + (Y1 - Y0) * W * c);
        }
        const res = yield batch("resampleRows", items, tr, cost, est, bytesOf(ns.pixels, ns.alpha, oo.samples !== ns.pixels ? oo.samples : null, oo.alpha !== ns.alpha ? oo.alpha : null));
        const join = (p, c) => { const out = new Uint8Array(W * H * c); for (let b = 0; b < rb.length; b++) out.set(res[p * rb.length + b], rb[b][0] * W * c); return out; };
        samples = join(0, ch);
        alpha = oo.alpha ? join(1, 1) : null;
      } else {
        samples = R.resample(oo.samples, ch, oo.w, oo.h, W, H, geo.resample);   // always a fresh array (never the source)
        alpha = oo.alpha ? R.resample(oo.alpha, 1, oo.w, oo.h, W, H, geo.resample) : null;
      }
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
        const passes = interp.smoothing.passes, kb = rPx >= 1 && passes >= 1 ? E.bandRanges(H, par.bands, par.bandRows) : [];
        if (kb.length > 1) {
          // F13 (F.3): Kuwahara row bands per pass. The coordinator's rolling scan keeps the global SAT row at each band
          // seed s = max(0, y0 − r); the item gets that seed plus .slice() copies of source (and domain) rows [s, e),
          // e = min(H, y1 + r), and rebuilds SAT rows s+1 … e exactly as the whole-image pass (SAT rows [s, e + 1)).
          for (let pass = 0; pass < passes; pass++) {
            const seeds = R.kuwaharaSeeds(L, W, H, kb, rPx, domain, poll), items = [], tr = [], cost = [], est = [];
            kb.forEach(([y0, y1], b) => {
              const sd = seeds[b], s0 = Math.max(0, y0 - rPx), e = Math.min(H, y1 + rPx);
              if (sd.s !== s0 || sd.sat.length !== W + 1) throw efail("ENGINE_INTERNAL", "Kuwahara band " + b + " seed row " + sd.s + " != " + s0);
              const rows = L.slice(s0 * W, e * W), dom = domain ? domain.slice(s0 * W, e * W) : null;
              items.push([rows, W, H, rPx, sd, y0, y1, dom]);
              tr.push([rows, sd.sat, sd.sat2].concat(sd.cnt ? [sd.cnt] : [], dom ? [dom] : []));
              cost.push(y1 - y0);
              est.push(bytesOf(rows, dom, sd.sat, sd.sat2, sd.cnt) + (e - s0 + 1) * (W + 1) * 8 * (domain ? 3 : 2) + (y1 - y0) * W * 4);
            });
            const res = yield batch("kuwaharaRows", items, tr, cost, est, bytesOf(ns.pixels, ns.alpha, samples, alpha, domain, L));
            const out = new Float32Array(W * H);
            kb.forEach(([y0], b) => out.set(res[b], y0 * W));
            L = out;
          }
        } else L = R.kuwahara(L, W, H, rPx, passes, domain, poll);
        if (useCache) cache.k2 = { key: k2, L };
      }
      const th = R.thresholds(L, N, interp.thresholdRule, { manual: interp.manual, domain });
      for (const b of th.emptyBands) diagnostics.push(D.make("EMPTY_BAND", Object.assign({}, dOpts, { detail: "band " + b + " of " + N + " has no pixels" })));
      added = Hh.tonalAdded(R.bands(L, th), N, interp.polarity === "dark-front");
    }

    // 5. cumulative masks
    step("masks", 0.2);
    const masks = Hh.cumulativeMasks(added, domain, N, W, H, poll);
    // F13 LPT cost per layer: its mask's pixel count (one histogram pass over added; layer 0, the base, is a copy)
    const hist = new Float64Array(Math.max(N, 1) + 1);
    for (let i = 0; i < added.length; i++) if (!domain || domain[i]) hist[Math.min(added[i], N)]++;
    const layerPx = new Array(N).fill(0);
    for (let k = N - 1, acc = hist[N]; k >= 1; k--) { acc += hist[k]; layerPx[k] = acc; }
    const kept = () => bytesOf(ns.pixels, ns.alpha, cache && cache.k1 ? [cache.k1.samples, cache.k1.alpha] : null, cache && cache.k2 ? cache.k2.L : null);

    // 6. construct
    step("construct", 0.25);
    const cpx = constructPx(con, bonded, geo.sxUm, geo.syUm);
    // G2.13b (GEO-08, UI-05): change overlays at draft quality only, so the fabrication budget is unchanged; alpha.3 E4:
    // opts.overlays:false skips them (display data only). F9: constructLayer emits the change masks (SBConstruct.changeMask
    // crops), so masks[k] is read by its construct item only (transferable).
    const wantChange = quality === "draft" && overlays;
    const cres = yield batch("construct", masks.map((mask, k) => [k, { mask, W, H, px: cpx, bonded, wantChange }]), masks.map((m) => [m]),
      layerPx, masks.map((m, k) => (k === 0 ? 2 : bonded ? 5 : 7) * m.length), kept() + bytesOf(samples, alpha, domain, added, masks));
    const built = { final: cres.map((r) => r.final), bridges: cres.map((r) => r.bridges), report: cres.map((r) => r.report) };
    const pxMM2 = (geo.sxUm * geo.syUm) / 1e6;
    const page = M.page({ artWMM: geo.artWMM, artHMM: geo.artHMM, frame: con.frame });
    const fUm = Math.round(page.frameMM * 1000);
    for (let k = 0; k < built.report.length; k++) step("construct", 0.25 + (0.05 * k) / N);
    // speed round F8: bridges and change overlays trace only the bounding box of their pixels (one overlays item per layer with any)
    const ovItems = [], ovTransfer = [], ovAt = built.report.map(() => -1);
    built.report.forEach((r, k) => {
      const b = built.bridges[k], ch = wantChange ? cres[k].change : null;
      const added = ch && r.addedPx ? ch.added : null, removed = ch && r.removedPx ? ch.removed : null;
      if (!b && !added && !removed) return;
      ovAt[k] = ovItems.length;
      ovItems.push([{ added, removed, bridges: b, W, H, sxUm: geo.sxUm, syUm: geo.syUm, fUm }]);
      ovTransfer.push([added && added.mask, removed && removed.mask, b].filter(Boolean));
    });
    const ov = ovItems.length ? yield batch("overlays", ovItems, ovTransfer, null, ovTransfer.map((l) => 2 * bytesOf(l)), kept() + bytesOf(built.final)) : [];
    const cleanupReport = built.report.map((r, k) => {
      const e = { layer: k, addedMM2: r.addedPx * pxMM2, removedMM2: r.removedPx * pxMM2, holesFilled: r.filledHoles, partsRemoved: r.removedParts,
        bridged: r.bridged || 0, culled: r.culled || 0 };   // alpha.3 E2 (UI-05): SBConstruct report counts (bonded: 0)
      const o = ovAt[k] >= 0 ? ov[ovAt[k]] : {};
      if (built.bridges[k] && o.bridges) e.bridges = o.bridges;
      if (wantChange) {
        if (r.addedPx) e.added = o.added === undefined ? null : o.added;
        if (r.removedPx) e.removed = o.removed === undefined ? null : o.removed;
      }
      return e;
    });

    // 11a. complexity: parts cap (with explicit busy simplification) before trace
    step("complexity", 0.3);
    const gate = C.complexityGate(built.final, W, H, { deviceClass, simplify: con.cleanup.simplify, minFeatureMM: mat.minFeatureMM, minPartMM2: mat.minPartMM2,
      sxUm: geo.sxUm, syUm: geo.syUm, quality, revision, poll });
    diagnostics.push(...gate.diagnostics);
    if (gate.status !== "ok") return fail("COMPLEXITY_LIMIT", "parts per layer exceed the " + deviceClass + " cap; no layers are returned", diagnostics);

    // 7–8. trace, bounded smoothing on pixel loops (connected only; D1), fromPixelLoops, normalize, frame union
    step("trace", 0.35);
    const fOpts = { revision, quality, frame: fUm > 0 };
    if (con.cleanup.cornerStyle === "smooth" && (!bonded || smoothBonded))
      fOpts.smooth = { mode: "connected", tolUm: Math.round(con.cleanup.toleranceMM * 1000) };
    // F9: SBMaterial.fromMasks as batches: bonded (no smoothing) one fused traceConvert item per layer; connected smoothing
    // traces every layer, runs the smoothStack barrier serially, then converts every layer.
    const lctx = M.layerContext(W, H, page, fOpts), tm = gate.masks;
    let conv;
    const tEst = tm.map((m) => 3 * m.length), tRes = kept() + bytesOf(built.final, tm);
    if (!lctx.smooth) conv = yield batch("traceConvert", tm.map((m, k) => [m, k, W, H, lctx]), tm.map((m) => [m]), layerPx, tEst, tRes);
    else {
      const traced = yield batch("trace", tm.map((m, k) => [m, k, W, H]), tm.map((m) => [m]), layerPx, tEst, tRes);
      conv = yield batch("convert", M.smoothTraced(traced, lctx).map((t, k) => [t, k, lctx]), null, null, null, tRes);
    }
    let layers = M.assignParts(conv);
    const late = kept() + bytesOf(built.final);   // F13: the coordinator's resident typed arrays for the polygon batches

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
    const vcfg = { minFeatureMM: mat.minFeatureMM, advisoryFeatureMM: mat.advisoryFeatureMM, revision, quality };
    let sv;
    if (bonded) {   // F9: one supportPair item per adjacent pair, folded serially (reach, edges, one aggregate)
      S.validateArgs(layers, con.mode, vcfg);
      const pairs = [];
      for (let k = 1; k < layers.length; k++) pairs.push([layers[k - 1], layers[k], k, vcfg]);
      sv = S.supportFold(layers, vcfg, yield batch("supportPair", pairs, null, null, null, late));
    } else sv = S.validate(layers, con.mode, vcfg);
    diagnostics.push(...sv.diagnostics);
    step("features", 0.85);
    // speed round F1 (S4, PO-PERF-4, F-D1): SAMPLING_LOW is judged on the fabrication raster plan at both qualities
    // (rasterPlan reads only sizes; its FAB_* diagnostics are not repeated here). Diagnostics are not hash input.
    const fabGeo = quality === "fabrication" ? geo : E.rasterPlan(p, { w: ns.w, h: ns.h }, "fabrication", deviceClass).geometry;
    const fcfg = { minFeatureMM: mat.minFeatureMM, advisoryFeatureMM: mat.advisoryFeatureMM, minPartMM2: mat.minPartMM2,
      mmPerPxMax: geo.mmPerPxMax, samplingMmPerPx: fabGeo.mmPerPxMax, calibrated: mat.calibrated, revision, quality };
    const fhead = S.featureHead(layers, fcfg);   // F9: featureChecks = head + one featureLayer item per layer + one aggregate
    diagnostics.push(...D.aggregate(fhead.concat(...(yield batch("featureLayer", layers.map((L, k) => [L, k, fcfg]), null, null, null, late)))));
    step("envelope", 0.95);
    diagnostics.push(...S.checkEnvelope({ wMM: page.wMM, hMM: page.hMM }, p.machine, mat, dOpts));

    // 13. parts and their supports
    step("parts", 0.98);
    layers = S.annotate(M.assignParts(layers), sv.supportGraph);
    // 14. guides (G3.1 stage 14, alpha.3 E11; ASM-01/02/03, GEO-07): bonded with guides.mode ≠ "none" only. Built after the
    // repair replay on every generate (draft and fabrication through the same code), so a clip rebuilds the guides
    // (SUP-04/05). Score paths go into each layer (→ layerHash); labels and omissions into guides (→ guideHash).
    let guides = null;
    if (bonded && con.guides && con.guides.mode !== "none") {
      step("guides", 0.982);
      // F9: SBGuides.build/validate as one buildPair item per adjacent pair and one validatePair item per layer (ordered folds)
      const Gd = global.SBGuides, P = Gd.params(con.guides), gp = [];
      for (let k = 0; k + 1 < layers.length; k++) gp.push([k, layers[k], layers[k + 1], P, dOpts]);
      const gb = Gd.buildFold(layers.length, P, dOpts, yield batch("buildPair", gp, null, null, null, late));
      layers = layers.map((L, k) => Object.assign({}, L, { scorePaths: gb.scorePaths[k] }));
      const gv = yield batch("validatePair", layers.map((L, k) => [k, L, layers[k + 1], gb.scorePaths[k], P, dOpts]), null, null, null, late);
      diagnostics.push(...gb.diagnostics, ...[].concat(...gv));
      guides = gb.guides;
    }

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
    for (let k = 0; k < layers.length; k++) step("hashes", 0.99);
    const layerHashes = yield batch("layerHash", layers.map((L) => [L]), null, null, null, late);
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
   * request(project, px: {pixels, channels: 1|4, w, h, alpha}, {quality, requestId?, deviceClass?, draftCapPx?}) → GenerateRequest
   * (alpha.3 E1, LYR-06). The one request builder: the draft and the fabrication request of one project revision have
   * the same config (the project itself, never rewritten) and the same normalizedSource; only quality differs.
   * project.source is used as installed at intake (SBSchema.withSource); when it is set and its w, h or channels differ
   * from the pixels, throws SOURCE_MISMATCH (the pixels and the record they run under always belong together).
   * sourceHash is source.sampleHash (byteHash when no sample hash exists).
   * Speed round F9 (F-D5): draftCapPx (integer 64–2000; default SBSchema.limits(deviceClass).draftPxCap) is copied onto
   * the request and is the draft raster cap generate passes to rasterPlan; the pool sets the pooled cap, the no-worker
   * fallback limits.draftPxFallback. An out-of-range value throws ENGINE_ARG.
   */
  E.request = function (project, px, o) {
    o = o || {};
    const s = project.source;
    if (s && (s.w !== px.w || s.h !== px.h || s.channels !== px.channels))
      throw efail("SOURCE_MISMATCH", "project.source is " + s.w + " × " + s.h + " × " + s.channels + " but the pixels are " + px.w + " × " + px.h + " × " + px.channels);
    const deviceClass = o.deviceClass === undefined ? "desktop" : o.deviceClass;
    let draftCapPx = o.draftCapPx;
    if (draftCapPx === undefined) draftCapPx = deviceClass === "desktop" || deviceClass === "mobile" ? global.SBSchema.limits(deviceClass).draftPxCap : undefined;
    else if (!(Number.isInteger(draftCapPx) && draftCapPx >= 64 && draftCapPx <= 2000)) throw efail("ENGINE_ARG", "draftCapPx must be an integer 64–2000 (got " + draftCapPx + ")");
    return { requestId: o.requestId === undefined ? o.quality : o.requestId, revision: project.revision, engineVersion: E.VERSION, quality: o.quality,
      normalizedSource: { pixels: px.pixels, channels: px.channels, w: px.w, h: px.h, alpha: px.alpha == null ? null : px.alpha },
      sourceHash: s ? (s.sampleHash || s.byteHash) : null, config: project, deviceClass, draftCapPx };
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
   * those layers) in the snapshot's page frame, then (bonded only, alpha.3 E11) placement_map.svg. Connected sheets keep the v1.1.0 text label "{title} k/n" (until G3.2);
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
    // alpha.3 E11 (ASM-05): bonded bundles always carry the placement map (not a cut file), the fallback for omitted guides
    if (mode === "bonded-relief") files.push({ name: "placement_map.svg", data: S.placementMapSVG(snapshot, { title: project.title }) });
    return files;
  };

  global.SBEngine = E;
})(typeof window !== "undefined" ? window : globalThis);
