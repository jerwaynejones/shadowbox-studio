/* ============================================================================
 * Shadowbox Studio — schema.js
 * ----------------------------------------------------------------------------
 * SBSchema: project schema v1 (plan §3, ARCHITECTURE §3; SRS §9.1), presets,
 * the machine profile and the pure helpers around them (plan G2.1, extended
 * for the laser target of Appendix D / decision D6: PO-LASER-1/3/4/6/7/8).
 *
 *   SBSchema.defaults(preset)        "plywood" | "acrylic" → Project (fresh copy)
 *   SBSchema.validate(p)             → {ok, errors: [{path, code}]}; never throws.
 *                                    Strict key sets in every section; codes:
 *                                    UNKNOWN_KEY, MISSING_KEY, TYPE, NONFINITE,
 *                                    INTEGER, RANGE, ENUM, GRID, ORDER,
 *                                    CONSTRAINT, SCHEMA_MAJOR.
 *   SBSchema.importLoose(obj)        → {project, movedToExtras}: unknown
 *                                    top-level keys go to extras; unknown keys
 *                                    inside sections stay (validate rejects).
 *   SBSchema.geometryKey(p)          → the hashed scope of §3 (machine included).
 *   SBSchema.MACHINES                frozen; "xtool-s1-feeder" (PO-LASER-1).
 *   SBSchema.resolveSize(p, w, h)    → art and page size on the 1 µm grid from
 *                                    the ORIENTED source size (PO-LASER-3);
 *                                    both art axes range-checked (MAT-02).
 *   SBSchema.limits(deviceClass)     → {deviceClass, fabPxBudget,
 *                                    maxPartsPerLayer, maxVerticesPerLayer,
 *                                    maxVerticesTotal}. Budgets measured by
 *                                    G2.2b (docs/perf/large-image.json,
 *                                    decision.*.fabPxBudget): desktop 25 Mpx,
 *                                    mobile 1 Mpx (bonded mode, k = 4
 *                                    provisional). Complexity caps (G2.7b,
 *                                    SRS §12.3): mobile 100 parts/layer and
 *                                    20,000 vertices; desktop measured
 *                                    (docs/perf/complexity.json). G2.14
 *                                    adds the IMG-07 source envelope
 *                                    maxSourceBytes / maxSourcePx (desktop
 *                                    25 MiB / 25 MP = fabPxBudget, mobile
 *                                    10 MiB / 8 MP, inclusive; desktop MP is
 *                                    a PO deviation from SRS IMG-07's 16 MP,
 *                                    2026-10-08); G4.3 adds the rest.
 *   SBSchema.sniff(bytes)            → "png" | "jpeg" | null (G2.14 intake step 1).
 *   SBSchema.preflight({bytes, info, deviceClass, project}) → {ok, code?,
 *                                    reason?, suggestDownsamplePx?: {w, h},
 *                                    rasterPlan, warnings, intake}: IMG-07
 *                                    envelope, IMG-01 checks (both modes),
 *                                    JPEG_UNSUPPORTED / JPEG_TRUNCATED, and the
 *                                    fabrication raster plan, all before decode
 *                                    (G2.14, PO-LASER-4/5, GEO-06, NFR-04).
 *   SBSchema.intake(bytes, {project, deviceClass}) → preflight result plus
 *                                    {format, info}: sniff, inspect + check,
 *                                    preflight (the caller decodes, step 4).
 *   SBSchema.applyDownsample(p, {fromW, fromH, toW, toH}) → new project: the
 *                                    explicit downsample; coarser fabPitchMM
 *                                    (never finer) and extras.history entry.
 *   SBSchema.downsampleTarget(pre)   → {w, h}: suggestDownsamplePx in the
 *                                    decoded orientation (swapped for EXIF
 *                                    5..8 on both decode routes).
 *   construction.cleanup.simplify    "off" | "busy" (G2.7b; default "off", in
 *                                    geometryKey): explicit busy-art
 *                                    simplification, SBConstruct.simplifyBusy.
 *   SBSchema.toMM / fromMM           lossless units, quantized to 0.001 mm.
 *   SBSchema.modeChangeDiff(p, patch) → [{path, from, to, reason}] (G2.11e).
 *   SBSchema.applyModeChange(p, patch, accepted) → project (Cancel: unchanged; Accept: diff targets, revision + 1) (G2.11e).
 *   SBSchema.sourceTemplate()        a valid placeholder `source` record.
 *   SBSchema.legacyState(p, w?, h?)  → the 19 v1.1.0 settings keys (G2.11a
 *                                    controller adapter for legacyRun).
 *   SBSchema.applyLegacy(p, key, v)  → new project with one v1.1.0 control
 *                                    set; revision + 1 iff geometryKey changes.
 *   SBSchema.FAB_PITCH               frozen {min 0.05, max 2, step 0.01, defaultMM 0.1}:
 *                                    the #in-res pitch input (G2.11b, PO-LASER-4).
 *   SBSchema.applyFabPitch(p, v)     → new project with geometry.fabPitchMM
 *                                    clamped and on the 0.001 mm grid; revision
 *                                    + 1 iff it changed; non-numeric → unchanged.
 *   SBSchema.canGenerate(p, source)  → {ok, reason}; "Choose a source" (PRJ-01).
 *   SBSchema.applyControl(p, id, v, ctx?) → new project for one G2.11c control
 *                                    (size, pitch-free geometry, machine, modes,
 *                                    appearance, units, view); lengths in
 *                                    p.units; invalid → unchanged; revision + 1
 *                                    iff geometryKey changes.
 *   SBSchema.controlValues(p)        → {inputId: displayed string} (G2.11c).
 *   SBSchema.polaritiesFor(mode)     → the polarity options of a mode.
 *   SBSchema.applicability(p)        → {"in-…": reason | null} for every
 *                                    mode-dependent control (G2.11d, UI-01):
 *                                    null = applicable, else why it is disabled.
 *   SBSchema.ignoredSettings(p)      → [DISPLAY_ONLY_IGNORED info]: settings
 *                                    whose value is kept but unused by the
 *                                    project's modes (§9.5, G2.11d); importLoose
 *                                    reports them as `diagnostics`.
 *   SBSchema.fromLegacySettings(json) → {project, diagnostics}: v1.1.0
 *                                    settings.json → tonal + connected-sheet
 *                                    (DEP-04, G2.4b); heightMM null raises
 *                                    LEGACY_NEEDS_SOURCE; original JSON kept
 *                                    in extras.legacy.
 *   SBSchema.resolveLegacy(p, w, h)  → project with heightMM, the legacy pitch
 *                                    (longSide/procRes) and toleranceMM.
 *   SBSchema.legacyDiagnostics(p)    → [LEGACY_NEEDS_SOURCE] or [].
 *
 * Notes binding later tasks:
 *  - D1: bonded mode is unsmoothed; the plywood preset's cornerStyle is
 *    "sharp" and toleranceMM (0.05) applies to connected mode only.
 *  - D4 (amendment B): MaterialLayer.canonicalHash is SBGeom.materialHash
 *    (material + holes, no score paths); only SBGeom.layerHash enters
 *    geometryHash.layers. geometryHash = hashJSON({key: geometryKey(p),
 *    engine, quality, raster, layers, guides}).
 *  - D5 / Appendix C (S4): source.decode also admits "raw-gray{1,2,4}-scaled8",
 *    "raw-palette-gray8" and SBPng's tonal "raw-rgb" (channels 3).
 *  - MAT-05 / PO-LASER-7: kerfMode is "external" only; machine.kerfMM is
 *    recorded, never applied.
 *  - Machine fit (PAGE_OVERFLOW, MACHINE_THICKNESS) is an engine diagnostic
 *    (G2.10a), not a schema error: the schema only checks the profile itself.
 *
 * Errors thrown by helpers carry e.code: SCHEMA_PRESET, SCHEMA_SIZE,
 * SCHEMA_DEVICE, SCHEMA_UNIT, SCHEMA_MODE, SCHEMA_LEGACY. SBDiag is looked up
 * at call time (legacy diagnostics, preflight reasons); the G2.14 intake also
 * looks up SBPng, SBJpeg and SBEngine (rasterPlan) at call time.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const S = {};
  const fail = (code, msg) => { const e = new Error(code + ": " + msg); e.code = code; return e; };
  const clone = (v) => (v === null || typeof v !== "object") ? v
    : Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.keys(v).map((k) => [k, clone(v[k])]));
  const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

  S.SCHEMA = deepFreeze({ major: 1, minor: 0 });
  /** Engine identity recorded in new projects; G2.10b owns version bumps (D4 amendment C). */
  S.ENGINE = deepFreeze({ id: "sbr-engine", version: "1.0.0-dev" });

  // ------------------------------------------------------------ machines (PO-LASER-1)
  S.MACHINES = deepFreeze({
    "xtool-s1-feeder": {
      id: "xtool-s1-feeder", name: "xTool S1 + feeder",
      maxProcessingHeightMM: 470, maxLengthMM: 3000, maxMaterialWidthMM: 545,
      maxThicknessMM: 14, kerfMM: 0.15,
    },
  });
  S.DEFAULT_MACHINE = "xtool-s1-feeder";

  // ------------------------------------------------------------ limits (PO-LASER-4)
  // Measured by G2.2b (docs/perf/large-image.json, decision.desktop/mobile.fabPxBudget; the test
  // "PO-LASER-4 SBSchema.limits budgets equal docs/perf/large-image.json" keeps them in step). Desktop: r25 bonded
  // p95 9.75 s ≤ 10 s, 404 MiB ≤ 512 MiB. Mobile: r1 bonded p95 1.82 s × k 4 = 7.3 s ≤ 8 s (k provisional, G4.4).
  // The engine never upsamples, so the IMG-07 source cap bounds the fabrication raster: desktop sources are capped at the
  // desktop budget (25 MP, PO decision 2026-10-08, deviation from SRS IMG-07's 16 MP), mobile sources at 8 MP.
  // G2.7b complexity caps (SRS §12.3; SRS:L564: fail explicitly, never truncate). Mobile: the SRS §12.3 mobile workload
  // (100 parts/layer, 20,000 vertices total; per layer bounded by the total). Desktop: measured by `node test/bench.js caps`
  // (docs/perf/complexity.json, decision.desktop): the largest caps at which the capped busy workload at the desktop budget
  // meets the 10 s bonded target and 512 MiB, never below the realistic art measured at that budget; the test
  // "§12.3/PO-LASER-9 desktop caps equal the measured decision" keeps them in step.
  const DESKTOP_CAPS = { maxPartsPerLayer: 258, maxVerticesPerLayer: 132000, maxVerticesTotal: 356000 };   // c208 row (+ c200 vertices), 2026-10-08
  const LIMITS = {
    desktop: { deviceClass: "desktop", fabPxBudget: 25000000, maxPartsPerLayer: DESKTOP_CAPS.maxPartsPerLayer,
      maxVerticesPerLayer: DESKTOP_CAPS.maxVerticesPerLayer, maxVerticesTotal: DESKTOP_CAPS.maxVerticesTotal },
    mobile: { deviceClass: "mobile", fabPxBudget: 1000000, maxPartsPerLayer: 100, maxVerticesPerLayer: 20000, maxVerticesTotal: 20000 },
  };
  // G2.14 (IMG-07, SRS §12.3): the source envelope. Over-limit input is rejected before decode, or downsampled only
  // through the explicit button (applyDownsample); never silently reduced (NFR-04). Limits are inclusive.
  // Desktop maxSourcePx = the measured desktop fabPxBudget (25 MP): product-owner decision 2026-10-08 for the laser
  // target, a documented deviation from SRS IMG-07 (16 MP; plan Appendix D.6 item 4, ARCHITECTURE D6). The test
  // "IMG-07/PO-LASER-4 desktop source cap equals the measured desktop fabPxBudget" keeps them in step. Mobile keeps 8 MP.
  const SOURCE_LIMITS = { desktop: { maxSourceBytes: 25 * 1024 * 1024, maxSourcePx: LIMITS.desktop.fabPxBudget },
    mobile: { maxSourceBytes: 10 * 1024 * 1024, maxSourcePx: 8000000 } };
  for (const dc of Object.keys(SOURCE_LIMITS)) Object.assign(LIMITS[dc], SOURCE_LIMITS[dc]);
  deepFreeze(LIMITS);
  S.limits = function (deviceClass) {
    if (!Object.prototype.hasOwnProperty.call(LIMITS, deviceClass)) throw fail("SCHEMA_DEVICE", "deviceClass must be desktop|mobile (got " + deviceClass + ")");
    return LIMITS[deviceClass];
  };

  // ------------------------------------------------------------ source intake and preflight (G2.14)
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
  const fmtMiB = (n) => (n / 1048576).toFixed(1) + " MiB";
  const fmtLimMiB = (n) => (n / 1048576) + " MiB";
  const fmtMP = (n) => (n / 1e6).toFixed(1) + " MP";
  const fmtLimMP = (n) => (n / 1e6) + " MP";

  /** sniff(bytes) → "png" | "jpeg" | null, from the signature alone (intake step 1). */
  S.sniff = function (bytes) {
    const b = u8(bytes);
    if (b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v)) return "png";
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    return null;
  };

  /** Largest {w, h} with w·h ≤ maxPx at the source aspect (the explicit downsample offer, IMG-07). */
  function downsampleSize(w, h, maxPx) {
    const k = Math.sqrt(maxPx / (w * h));
    let sw = Math.max(1, Math.floor(w * k)), sh = Math.max(1, Math.floor(h * k));
    while (sw * sh > maxPx) { if (sw / sh > w / h) sw--; else sh--; }
    return { w: sw, h: sh };
  }

  /**
   * downsampleTarget(pre) → {w, h}: the explicit downsample offer (pre.suggestDownsamplePx, in stored orientation) in
   * the orientation of the decoded image. For EXIF 5..8 the decoded image is rotated on both routes (the browser
   * applies EXIF on canvas-tonal, SBEngine.orient on raw), so w and h swap; otherwise they are unchanged.
   */
  S.downsampleTarget = function (pre) {
    const sug = pre && pre.suggestDownsamplePx;
    if (!sug) throw fail("SCHEMA_SIZE", "downsampleTarget needs a preflight result with suggestDownsamplePx");
    const exif = pre.intake && pre.intake.exif;
    return exif >= 5 && exif <= 8 ? { w: sug.h, h: sug.w } : { w: sug.w, h: sug.h };
  };

  /**
   * The decode route of intake step 4 and the orientation it implies. Height PNGs are decoded raw by SBPng (EXIF
   * applied by the engine, SBEngine.orient); tonal PNG/JPEG by the browser, which applies EXIF itself, so the decoded
   * buffer is already rotated for EXIF 5..8 (plan Appendix A #8).
   */
  function intakeRoute(format, mode, info) {
    const raw = format === "png" && mode === "height";
    const exif = info && info.exif >= 1 && info.exif <= 8 ? info.exif : 1;
    const swap = !raw && exif >= 5;
    return { format, decode: raw ? "raw" : "canvas-tonal", exif, exifAppliedBy: raw ? "engine" : "browser",
      w: info ? (swap ? info.h : info.w) : null, h: info ? (swap ? info.w : info.h) : null };
  }

  /**
   * preflight({bytes, info, deviceClass, project}) → {ok, code?, reason?, suggestDownsamplePx?: {w, h}, rasterPlan,
   * warnings: Diagnostic[], intake: {format, decode: "raw"|"canvas-tonal", exif, exifAppliedBy, w, h}}
   * (IMG-01/07, GEO-06, NFR-04, PO-LASER-4/5, AT-22). Runs on SBPng.inspect / SBJpeg.inspect output, before any decode:
   *   1. bytes over limits(deviceClass).maxSourceBytes → SOURCE_TOO_LARGE (no downsample offer);
   *   2. IMG-01: PNG through SBPng.check (both modes); a JPEG in height mode → HEIGHT_NEEDS_PNG; SBJpeg.unsupported →
   *      JPEG_UNSUPPORTED (reason); SBJpeg.scanEnd eoi null → JPEG_TRUNCATED (truncated in scan data);
   *   3. w·h over maxSourcePx → SOURCE_TOO_MANY_PIXELS with suggestDownsamplePx, the largest size inside the envelope.
   * rasterPlan is SBEngine.rasterPlan(project, decoded size, "fabrication", deviceClass) with the source orientation
   * the decode route implies, so pitch, cap and shortfall show before decoding; warnings are its FAB_PITCH_CAPPED /
   * FAB_EXCEEDS_SOURCE, plus EXIF_AMBIGUOUS when info.exifAmbiguous is set on a browser-decoded source (Appendix C).
   * rasterPlan is null when the dimensions are unknown or the size cannot be resolved (planError).
   * Pure: never mutates the project, never lowers anything.
   */
  S.preflight = function (args) {
    const { bytes, info, deviceClass, project } = args || {};
    const b = u8(bytes), lim = S.limits(deviceClass), mode = project.interpretation.mode;
    const format = S.sniff(b);
    const out = { ok: true, rasterPlan: null, warnings: [], intake: format ? intakeRoute(format, mode, info) : null };
    const reject = (code, reason, extra) => Object.assign(out, { ok: false, code, reason }, extra || {});
    if (out.intake && info && info.w > 0 && info.h > 0) {
      try {
        const o = project.source && project.source.orientation;
        const q = clone(project);
        q.source = Object.assign({}, q.source || S.sourceTemplate(), { orientation: { exif: out.intake.exif,
          exifAppliedBy: out.intake.exifAppliedBy, rotate: o ? o.rotate : 0, mirror: o ? o.mirror : false } });
        out.rasterPlan = global.SBEngine.rasterPlan(q, { w: out.intake.w, h: out.intake.h }, "fabrication", deviceClass);
        out.warnings = out.rasterPlan.diagnostics.slice();
      } catch (e) { out.planError = e.message; }
    }
    // Plan Appendix C (S4b → G2.14): browsers disagree on this file's EXIF orientation (an XMP APP1 before the Exif
    // one, or an IFD entry short of its declared size). Warn on every route the browser decodes; never a rejection.
    if (out.intake && out.intake.exifAppliedBy === "browser" && info && info.exifAmbiguous)
      out.warnings.push(global.SBDiag.make("EXIF_AMBIGUOUS", { revision: project.revision,
        detail: "the file says EXIF " + out.intake.exif + "; check the preview" }));
    if (b.length > lim.maxSourceBytes)
      return reject("SOURCE_TOO_LARGE", "File is " + fmtMiB(b.length) + "; the " + deviceClass + " limit is " + fmtLimMiB(lim.maxSourceBytes) + ".");
    if (!format) return reject("SOURCE_FORMAT", "File is not a PNG or JPEG image.");
    if (!info || !(info.w > 0) || !(info.h > 0))   // the public contract: preflight needs inspect output
      return reject(format === "png" ? "PNG_HEADER" : "JPEG_BAD_SEGMENT", "Image header was not inspected (no dimensions).");
    if (format === "png") {
      const c = global.SBPng.check(info, mode);
      if (c) return reject(c, global.SBDiag.CODES[c].title + ".");
    } else {
      if (mode === "height") return reject("HEIGHT_NEEDS_PNG", "Height mode takes an 8-bit grayscale PNG; this file is a JPEG.");
      const why = global.SBJpeg.unsupported(info);
      if (why) return reject("JPEG_UNSUPPORTED", "JPEG variant is not supported: " + why + ".");
      if (global.SBJpeg.scanEnd(b, info.headerBytes).eoi === null) return reject("JPEG_TRUNCATED", "JPEG file is incomplete (its image data ends early).");
    }
    const px = info.w * info.h;
    if (px > lim.maxSourcePx) {
      const sug = downsampleSize(info.w, info.h, lim.maxSourcePx);
      return reject("SOURCE_TOO_MANY_PIXELS", "Image is " + info.w + " × " + info.h + " px (" + fmtMP(px) + "); the " + deviceClass +
        " limit is " + fmtLimMP(lim.maxSourcePx) + ". Downsample explicitly to " + sug.w + " × " + sug.h + " px, or use a smaller image.",
        { suggestDownsamplePx: sug });
    }
    return out;
  };

  /**
   * intake(bytes, {project, deviceClass}) → preflight result plus {format, info}: intake steps 1–3 (sniff; inspect and
   * check; preflight). An oversized file is refused before it is inspected; an inspect fault returns its SBPng/SBJpeg
   * code. Step 4 (decode) belongs to the caller and follows result.intake.decode.
   */
  S.intake = function (bytes, opts) {
    const { project, deviceClass } = opts || {};
    const b = u8(bytes), format = S.sniff(b);
    if (!format || b.length > S.limits(deviceClass).maxSourceBytes)
      return Object.assign(S.preflight({ bytes: b, info: null, deviceClass, project }), { format, info: null });
    let info;
    try { info = format === "png" ? global.SBPng.inspect(b) : global.SBJpeg.inspect(b); }
    catch (e) {
      return { ok: false, code: e.code || (format === "png" ? "PNG_HEADER" : "JPEG_BAD_SEGMENT"), reason: e.message,
        rasterPlan: null, warnings: [], intake: null, format, info: null };
    }
    return Object.assign(S.preflight({ bytes: b, info, deviceClass, project }), { format, info });
  };

  /**
   * applyDownsample(project, {fromW, fromH, toW, toH}) → new project (IMG-07, NFR-04, PO-LASER-4): the explicit
   * downsample button. geometry.fabPitchMM becomes the coarser of the project's pitch and the pitch the downsampled
   * (oriented) source can deliver, ceil(art / px) in whole µm (never finer, never past FAB_PITCH.max), and
   * extras.history gains {op: "downsample", from, to, fabPitchMM: {from, to}, revision}. revision + 1 iff the
   * pitch changed.
   */
  S.applyDownsample = function (project, d) {
    const ok = (v) => Number.isInteger(v) && v > 0;
    if (!d || ![d.fromW, d.fromH, d.toW, d.toH].every(ok) || d.toW > d.fromW || d.toH > d.fromH)
      throw fail("SCHEMA_SIZE", "downsample needs positive integer sizes with to ≤ from");
    const sz = S.resolveSize(project, d.toW, d.toH);
    const srcUm = Math.max(Math.ceil(sz.artWUm / d.toW), Math.ceil(sz.artHUm / d.toH));
    const from = project.geometry.fabPitchMM;
    const to = Math.min(S.FAB_PITCH.max, Math.max(from, srcUm / 1000));
    const q = clone(project);
    q.geometry.fabPitchMM = to;
    if (to !== from) q.revision = project.revision + 1;
    const hist = Array.isArray(q.extras.history) ? q.extras.history : [];
    q.extras = Object.assign({}, q.extras, { history: hist.concat([{ op: "downsample", from: [d.fromW, d.fromH], to: [d.toW, d.toH],
      fabPitchMM: { from, to }, revision: q.revision }]) });
    return q;
  };

  // ------------------------------------------------------------ enums
  const E = {
    units: ["mm", "in"],
    format: ["png", "jpeg"],
    decode: ["raw-gray8", "raw-rgb-equal", "canvas-tonal", "raw-gray1-scaled8", "raw-gray2-scaled8", "raw-gray4-scaled8", "raw-palette-gray8", "raw-rgb"],
    channels: [1, 3, 4],
    exif: [1, 2, 3, 4, 5, 6, 7, 8],
    exifAppliedBy: ["browser", "engine", "none"],
    rotate: [0, 90, 180, 270],
    alphaMode: ["threshold", "full"],
    interp: ["tonal", "height"],
    polarity: ["white-high", "black-high", "light-front", "dark-front"],
    thresholdRule: ["balanced", "linear", "manual"],
    filterOp: ["median", "box", "remap"],
    construction: ["connected-sheet", "bonded-relief"],
    cornerStyle: ["sharp", "smooth"],
    guideMode: ["none", "inset-outline", "interior-mark"],
    thicknessState: ["nominal", "measured"],
    kerfMode: ["external"],
    appearance: ["uniform", "palette"],
    sizeBy: ["height", "width"],
    resampleHeight: ["nearest", "area"],
    resampleTonal: ["area"],
    quality: ["draft", "fabrication"],
    repairOp: ["clip-to-lower"],
    simplify: ["off", "busy"],
  };
  const POLARITY_FOR = { height: ["white-high", "black-high"], tonal: ["light-front", "dark-front"] };
  const POLARITY_MAP = { "white-high": "light-front", "black-high": "dark-front", "light-front": "white-high", "dark-front": "black-high" };

  // ------------------------------------------------------------ presets (PRJ-01)
  function base() {
    return {
      schema: clone(S.SCHEMA), id: null, revision: 0, title: "untitled", units: "mm", createdAt: null, modifiedAt: null,
      app: { version: null }, engine: clone(S.ENGINE),
      source: null,   // PRJ-01: a source is required before generation (no auto-demo)
      interpretation: null, construction: null, material: null,
      appearance: null, view: { explodeMM: 0 }, geometry: null,
      machine: clone(S.MACHINES[S.DEFAULT_MACHINE]),
      acks: [], extras: {},
    };
  }

  const PRESETS = {
    // Bonded plywood relief (PRJ-01, PO-LASER-1/3/4/6/8; D1 unsmoothed).
    plywood() {
      const p = base();
      p.interpretation = { mode: "height", polarity: "white-high", thresholdRule: "balanced", manual: [],
        smoothing: { radius: 0, passes: 0 }, heightFilter: null };
      p.construction = { mode: "bonded-relief", sheets: 8, frame: { enabled: false, widthMM: 0 }, gapMM: 0,
        cleanup: { minFeatureMM: 1.5, speckMM2: 4.5, holeMM2: 4.5, cornerStyle: "sharp", toleranceMM: 0.05, simplify: "off" },
        bridge: { bridgeMM: 1.8, cullBelowMM2: 25, maxBridgeMM: 40, cullEnabled: false },
        registration: { enabled: false, diaMM: 3, edgeClearanceMM: 1, layers: "all" },
        guides: { mode: "interior-mark", concealInsetMM: 0.5, markFootprintMM: 0.2, allowanceMM: 0.5, labelHeightMM: 3 },
        repairs: [] };
      p.material = { name: "1/4\" plywood (basswood or poplar)", thicknessMM: 6.35, thicknessState: "nominal", calibrated: false,
        minFeatureMM: 1.5, advisoryFeatureMM: 2.0, minPartMM2: 25, kerfMode: "external", calibration: null };
      p.appearance = { mode: "uniform", color: "#C8A26B", palette: "dusk" };
      p.geometry = { sizeBy: "height", targetMM: 300, widthMM: null, heightMM: null, lockAspect: true,
        draftPx: 720, fabPitchMM: 0.1, resample: { height: "nearest", tonal: "area" } };
      return p;
    },
    // Acrylic shadowbox: the v1.1.0 connected tonal defaults (app.js state), on the new model.
    acrylic() {
      const p = base();
      p.interpretation = { mode: "tonal", polarity: "dark-front", thresholdRule: "balanced", manual: [],
        smoothing: { radius: 4, passes: 2 }, heightFilter: null };
      p.construction = { mode: "connected-sheet", sheets: 5, frame: { enabled: true, widthMM: 12 }, gapMM: 3,
        cleanup: { minFeatureMM: 1.2, speckMM2: 4.5, holeMM2: 2.88, cornerStyle: "smooth", toleranceMM: 0.05, simplify: "off" },
        bridge: { bridgeMM: 1.8, cullBelowMM2: 9, maxBridgeMM: 40, cullEnabled: false },
        registration: { enabled: true, diaMM: 4, edgeClearanceMM: 1, layers: "all" },
        guides: { mode: "none", concealInsetMM: 0.5, markFootprintMM: 0.2, allowanceMM: 0.5, labelHeightMM: 3 },
        repairs: [] };
      p.material = { name: "Acrylic", thicknessMM: 3, thicknessState: "nominal", calibrated: false,
        minFeatureMM: 1.2, advisoryFeatureMM: 1.2, minPartMM2: 9, kerfMode: "external", calibration: null };
      p.appearance = { mode: "palette", color: "#C8A26B", palette: "Midnight (Starry Night)" };
      p.geometry = { sizeBy: "width", targetMM: 324, widthMM: 300, heightMM: null, lockAspect: true,
        draftPx: 720, fabPitchMM: 0.1, resample: { height: "nearest", tonal: "area" } };
      return p;
    },
  };

  S.defaults = function (preset) {
    if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) throw fail("SCHEMA_PRESET", "preset must be plywood|acrylic (got " + preset + ")");
    return PRESETS[preset]();
  };

  /** A valid placeholder source record (intake fills the real values). */
  S.sourceTemplate = () => ({
    format: "png", byteHash: null, sampleHash: null, w: 1, h: 1, channels: 1, decode: "raw-gray8",
    orientation: { exif: 1, exifAppliedBy: "none", rotate: 0, mirror: false },
    alpha: { mode: "full", t: 0.5 },
  });

  /**
   * withSource(project, record) → project (alpha.3 E1, PRJ-02): a clone with `record` installed as project.source.
   * The revision goes up by one exactly when the geometry key changes, so re-installing an identical record (the same
   * file reloaded: same sampleHash, size and policy) changes nothing and earlier clips stay valid. Pure.
   */
  S.withSource = function (project, record) {
    const q = clone(project);
    q.source = clone(record);
    if (JSON.stringify(S.geometryKey(q)) !== JSON.stringify(S.geometryKey(project))) q.revision = project.revision + 1;
    return q;
  };

  // ------------------------------------------------------------ validation
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const onGrid = (v) => Math.round(v * 1000) / 1000 === v;
  const HEX64 = /^[0-9a-f]{64}$/;

  // Field spec helpers. Each returns a checker (v, path, ctx) → void, pushing errors.
  function num(lo, hi, o) {
    o = o || {};
    return (v, path, err) => {
      if (v === null && o.nullable) return;
      if (typeof v !== "number") return err(path, "TYPE");
      if (!Number.isFinite(v)) return err(path, "NONFINITE");
      if (o.int && !Number.isInteger(v)) return err(path, "INTEGER");
      if (v < lo || v > hi || (o.gt !== undefined && v <= o.gt)) return err(path, "RANGE");
      if (o.grid && !onGrid(v)) return err(path, "GRID");
    };
  }
  const mm = (lo, hi, o) => num(lo, hi, Object.assign({ grid: true }, o));
  const en = (list) => (v, path, err) => { if (!list.includes(v)) err(path, "ENUM"); };
  const bool = (v, path, err) => { if (typeof v !== "boolean") err(path, "TYPE"); };
  const str = (o) => (v, path, err) => { if (v === null && o && o.nullable) return; if (typeof v !== "string") err(path, "TYPE"); };
  const hash = (o) => (v, path, err) => { if (v === null && o && o.nullable) return; if (typeof v !== "string" || !HEX64.test(v)) err(path, "TYPE"); };
  const any = () => {};

  /** Strict object: every key of `spec` required, no other key allowed. */
  function obj(spec, o) {
    o = o || {};
    return (v, path, err) => {
      if (v === null && o.nullable) return;
      if (!isObj(v)) return err(path, "TYPE");
      for (const k of Object.keys(v)) if (!Object.prototype.hasOwnProperty.call(spec, k)) err(join(path, k), "UNKNOWN_KEY");
      for (const k of Object.keys(spec)) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) err(join(path, k), "MISSING_KEY");
        else spec[k](v[k], join(path, k), err);
      }
    };
  }
  const join = (path, k) => (path ? path + "." + k : String(k));
  function arr(item, o) {
    o = o || {};
    return (v, path, err) => {
      if (!Array.isArray(v)) return err(path, "TYPE");
      if (o.len !== undefined && v.length !== o.len) return err(path, "RANGE");
      v.forEach((x, i) => item(x, join(path, i), err));
    };
  }

  const SPEC = {
    schema: obj({ major: (v, path, err) => { if (v !== 1) err(path, "SCHEMA_MAJOR"); }, minor: num(0, 1e6, { int: true }) }),
    id: str({ nullable: true }),
    revision: num(0, Number.MAX_SAFE_INTEGER, { int: true }),
    title: str(),
    units: en(E.units),
    createdAt: str({ nullable: true }),
    modifiedAt: str({ nullable: true }),
    app: obj({ version: str({ nullable: true }) }),
    engine: obj({ id: en([S.ENGINE.id]), version: str() }),
    source: obj({
      format: en(E.format), byteHash: hash({ nullable: true }), sampleHash: hash({ nullable: true }),
      w: num(1, 1e6, { int: true }), h: num(1, 1e6, { int: true }), channels: en(E.channels), decode: en(E.decode),
      orientation: obj({ exif: en(E.exif), exifAppliedBy: en(E.exifAppliedBy), rotate: en(E.rotate), mirror: bool }),
      alpha: obj({ mode: en(E.alphaMode), t: num(0, 1) }),
    }, { nullable: true }),
    interpretation: obj({
      mode: en(E.interp), polarity: en(E.polarity), thresholdRule: en(E.thresholdRule),
      manual: (v, path, err) => {
        if (!Array.isArray(v)) return err(path, "TYPE");
        let bad = false;
        v.forEach((x, i) => { const n = err.count(); num(0, 1, { gt: 0 })(x, join(path, i), err); if (err.count() === n && x >= 1) err(join(path, i), "RANGE"); if (err.count() !== n) bad = true; });
        if (!bad) for (let i = 1; i < v.length; i++) if (!(v[i] > v[i - 1])) { err(path, "ORDER"); break; }
      },
      smoothing: obj({ radius: num(0, 10, { int: true }), passes: num(0, 3, { int: true }) }),
      heightFilter: (v, path, err) => {
        if (v === null) return;
        if (!isObj(v)) return err(path, "TYPE");
        en(E.filterOp)(v.op, join(path, "op"), err);
        const spec = v.op === "remap" ? { op: any, lut: arr(num(0, 255, { int: true }), { len: 256 }) } : { op: any, radius: num(1, 50, { int: true }) };
        obj(spec)(v, path, err);
      },
    }),
    construction: obj({
      mode: en(E.construction), sheets: num(1, 16, { int: true }),
      frame: obj({ enabled: bool, widthMM: mm(0, 500) }),
      gapMM: mm(0, 25),
      cleanup: obj({ minFeatureMM: mm(0, 50), speckMM2: num(0, 1e6), holeMM2: num(0, 1e6), cornerStyle: en(E.cornerStyle), toleranceMM: mm(0.001, 5), simplify: en(E.simplify) }),
      bridge: obj({ bridgeMM: mm(0, 50), cullBelowMM2: num(0, 1e6), maxBridgeMM: mm(0, 2000), cullEnabled: bool }),
      registration: obj({
        enabled: bool, diaMM: mm(0.5, 25), edgeClearanceMM: mm(0, 25),
        layers: (v, path, err) => {
          if (v === "all") return;
          if (!Array.isArray(v)) return err(path, "TYPE");
          let bad = false;
          v.forEach((x, i) => { const n = err.count(); num(0, 15, { int: true })(x, join(path, i), err); if (err.count() !== n) bad = true; });
          if (!bad) for (let i = 1; i < v.length; i++) if (!(v[i] > v[i - 1])) { err(path, "ORDER"); break; }
        },
      }),
      guides: obj({ mode: en(E.guideMode), concealInsetMM: mm(0, 25), markFootprintMM: mm(0, 25), allowanceMM: mm(0, 25), labelHeightMM: mm(0.5, 50) }),
      repairs: arr(obj({
        op: en(E.repairOp), layer: num(1, 15, { int: true }),
        sourceRevision: num(0, Number.MAX_SAFE_INTEGER, { int: true }), resultRevision: num(0, Number.MAX_SAFE_INTEGER, { int: true }),
        keyHash: hash(),
        reviewed: obj({ quality: en(E.quality), beforeHash: hash(), afterHash: hash(), removedAreaMM2: num(0, 4e6),
          partCountBefore: num(0, 1e9, { int: true }), partCountAfter: num(0, 1e9, { int: true }) }),
      })),
    }),
    material: obj({
      name: str(), thicknessMM: mm(0.1, 25), thicknessState: en(E.thicknessState), calibrated: bool,
      minFeatureMM: mm(0.1, 50), advisoryFeatureMM: mm(0.1, 50), minPartMM2: num(0, 1e6), kerfMode: en(E.kerfMode),
      calibration: obj({ date: str(), machine: str(), material: str(), kerfMM: mm(0, 2), minFeatureOkMM: mm(0, 50), scoreOk: bool, notes: str() }, { nullable: true }),
    }),
    appearance: obj({
      mode: en(E.appearance),
      color: (v, path, err) => { if (typeof v !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(v)) err(path, "TYPE"); },
      palette: str(),
    }),
    view: obj({ explodeMM: num(0, 1000) }),
    geometry: obj({
      sizeBy: en(E.sizeBy), targetMM: mm(1, 2000), widthMM: mm(1, 2000, { nullable: true }), heightMM: mm(1, 2000, { nullable: true }),
      lockAspect: bool, draftPx: num(64, 2000, { int: true }), fabPitchMM: mm(0.01, 2),
      resample: obj({ height: en(E.resampleHeight), tonal: en(E.resampleTonal) }),
    }),
    machine: obj({
      id: str(), name: str(),
      maxProcessingHeightMM: mm(0, 1e5, { gt: 0 }), maxLengthMM: mm(0, 1e5, { gt: 0 }), maxMaterialWidthMM: mm(0, 1e5, { gt: 0 }),
      maxThicknessMM: mm(0.1, 25), kerfMM: mm(0, 2),
    }, { nullable: true }),
    acks: arr(obj({ key: str(), revision: num(0, Number.MAX_SAFE_INTEGER, { int: true }) })),
    extras: (v, path, err) => { if (!isObj(v)) err(path, "TYPE"); },
  };
  const TOP = obj(SPEC);

  /** Cross-field rules, run only on sections that passed their own checks. */
  function crossChecks(p, err, okSection) {
    if (okSection("interpretation") && !POLARITY_FOR[p.interpretation.mode].includes(p.interpretation.polarity)) err("interpretation.polarity", "CONSTRAINT");
    if (okSection("construction")) {
      const c = p.construction;
      if (c.mode === "bonded-relief" && c.gapMM !== 0) err("construction.gapMM", "CONSTRAINT");                 // bonded gap is 0
      if (Array.isArray(c.registration.layers) && c.registration.layers.some((k) => k >= c.sheets))
        c.registration.layers.forEach((k, i) => { if (k >= c.sheets) err("construction.registration.layers." + i, "RANGE"); });
      c.repairs.forEach((r, i) => { if (r.layer >= c.sheets) err("construction.repairs." + i + ".layer", "RANGE"); });
    }
    if (okSection("material") && p.material.advisoryFeatureMM < p.material.minFeatureMM) err("material.advisoryFeatureMM", "CONSTRAINT");
    if (okSection("machine") && p.machine && p.machine.maxProcessingHeightMM > p.machine.maxMaterialWidthMM) err("machine.maxProcessingHeightMM", "CONSTRAINT");
    if (okSection("geometry") && okSection("construction")) {
      const f = p.construction.frame.enabled ? p.construction.frame.widthMM : 0;
      if (Math.round(p.geometry.targetMM * 1000) - 2 * Math.round(f * 1000) < 1000) err("geometry.targetMM", "CONSTRAINT");  // art ≥ 1 mm
      if (!p.geometry.lockAspect && (p.geometry.widthMM === null || p.geometry.heightMM === null))
        err(p.geometry.widthMM === null ? "geometry.widthMM" : "geometry.heightMM", "CONSTRAINT");
    }
  }

  S.validate = function (p) {
    const errors = [];
    const err = (path, code) => { errors.push({ path, code }); };
    err.count = () => errors.length;
    try {
      TOP(p, "", err);
      if (isObj(p)) {
        const okSection = (k) => Object.prototype.hasOwnProperty.call(p, k) && !errors.some((e) => e.path === k || e.path.startsWith(k + "."));
        crossChecks(p, err, okSection);
      }
    } catch (e) {
      errors.push({ path: "", code: "TYPE" });   // defensive: validate never throws
    }
    if (!isObj(p) && errors.length === 0) errors.push({ path: "", code: "TYPE" });
    return { ok: errors.length === 0, errors };
  };

  // ------------------------------------------------------------ import
  S.importLoose = function (obj) {
    if (!isObj(obj)) return { project: obj, movedToExtras: [], diagnostics: [] };
    const project = {}, movedToExtras = [];
    const extras = isObj(obj.extras) ? clone(obj.extras) : {};
    for (const k of Object.keys(obj)) {
      if (k === "extras") continue;
      if (Object.prototype.hasOwnProperty.call(SPEC, k)) project[k] = clone(obj[k]);
      else { extras[k] = clone(obj[k]); movedToExtras.push(k); }
    }
    project.extras = extras;
    // §9.5 (G2.11d): a valid import that sets a value its modes do not use is kept and reported (info); an invalid one
    // is left to validate.
    const diagnostics = S.validate(project).ok ? S.ignoredSettings(project) : [];
    return { project, movedToExtras, diagnostics };
  };

  // ------------------------------------------------------------ legacy settings.json v1.1.0 (DEP-04, AT-21; G2.4b)
  // The v1.1.0 app.js state defaults for the settingsJSON() keys: a key missing from an imported file takes its v1.1.0 value.
  const LEGACY_DEFAULTS = deepFreeze({
    projectName: "untitled", sourceName: null, procRes: 720, smoothRadius: 4, smoothPasses: 2, nSheets: 5,
    thresholdMode: "balanced", darkFront: true, palette: "Midnight (Starry Night)", widthMM: 300, marginMM: 12,
    minFeatureMM: 1.2, bridgeMM: 1.8, cullBelowMM2: 9, maxBridgeMM: 40, holes: true, holeDiaMM: 4,
    cornerStyle: "smooth", detailEps: 0.8,
  });
  const grid = (v) => Math.round(v * 1000) / 1000;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const isLegacy = (p) => isObj(p) && isObj(p.extras) && isObj(p.extras.legacy);

  /** [LEGACY_NEEDS_SOURCE] while a legacy import has no source-derived height (heightMM null), else []. */
  S.legacyDiagnostics = function (p) {
    return isLegacy(p) && isObj(p.geometry) && p.geometry.heightMM === null
      ? [global.SBDiag.make("LEGACY_NEEDS_SOURCE", { detail: "settings.json v1.1.0 has no image; dimensions resolve when its source is attached" })]
      : [];
  };

  /**
   * v1.1.0 settings.json → {project, diagnostics}. Tonal + connected-sheet on the acrylic preset; the whole original JSON is
   * kept in extras.legacy; geometry.heightMM stays null (LEGACY_NEEDS_SOURCE) until resolveLegacy. Never rescales: an
   * oversized piece is left to the machine-envelope check. Throws SCHEMA_LEGACY for a non-object.
   */
  S.fromLegacySettings = function (json) {
    if (!isObj(json)) throw fail("SCHEMA_LEGACY", "legacy settings must be a JSON object");
    const L = Object.assign({}, LEGACY_DEFAULTS);
    for (const k of Object.keys(LEGACY_DEFAULTS)) if (json[k] !== undefined) L[k] = json[k];
    const p = PRESETS.acrylic();
    p.title = typeof L.projectName === "string" ? L.projectName : LEGACY_DEFAULTS.projectName;
    const it = p.interpretation;
    it.mode = "tonal";
    it.polarity = L.darkFront ? "dark-front" : "light-front";
    it.thresholdRule = L.thresholdMode === "linear" ? "linear" : "balanced";   // v1.1.0: anything but linear bands as balanced
    it.smoothing = { radius: L.smoothRadius, passes: L.smoothPasses };
    const c = p.construction;
    c.mode = "connected-sheet";
    c.sheets = L.nSheets;
    c.frame = { enabled: L.marginMM > 0, widthMM: L.marginMM };
    // v1.1.0 legacyRun: speck = max(4 px, cull·0.5), hole fill = minFeature²·2 (the acrylic preset's derivation).
    c.cleanup = { minFeatureMM: L.minFeatureMM, speckMM2: r6(L.cullBelowMM2 * 0.5), holeMM2: r6(L.minFeatureMM * L.minFeatureMM * 2),
      cornerStyle: L.cornerStyle === "faceted" ? "sharp" : "smooth", toleranceMM: c.cleanup.toleranceMM, simplify: "off" };
    c.bridge = { bridgeMM: L.bridgeMM, cullBelowMM2: L.cullBelowMM2, maxBridgeMM: L.maxBridgeMM, cullEnabled: false };
    c.registration = Object.assign(c.registration, { enabled: !!L.holes, diaMM: L.holeDiaMM });
    p.material.minFeatureMM = L.minFeatureMM;
    p.material.advisoryFeatureMM = L.minFeatureMM;
    p.material.minPartMM2 = L.cullBelowMM2;
    p.appearance.mode = "palette";
    if (typeof L.palette === "string") p.appearance.palette = L.palette;
    const g = p.geometry;
    g.sizeBy = "width"; g.lockAspect = true;
    g.widthMM = L.widthMM; g.heightMM = null;
    g.targetMM = grid(L.widthMM + (L.marginMM > 0 ? 2 * L.marginMM : 0));   // page width = art + frame on both sides
    p.machine = clone(S.MACHINES[S.DEFAULT_MACHINE]);
    p.extras = { legacy: clone(json) };
    return { project: p, diagnostics: S.legacyDiagnostics(p) };
  };

  /**
   * Attach the (oriented) source size to a legacy import: heightMM from the aspect, fabPitchMM = the v1.1.0 pitch
   * longSideMM / procRes on the 0.001 mm grid, toleranceMM = max(0.05, detailEps × widthMM / working width px), where the
   * working width is v1.1.0's max(32, round(srcW·procRes / max(srcW, srcH))). Returns a new project; input not mutated.
   */
  S.resolveLegacy = function (project, srcW, srcH) {
    if (!isLegacy(project)) throw fail("SCHEMA_LEGACY", "resolveLegacy needs a project from fromLegacySettings (extras.legacy)");
    const p = clone(project);
    const leg = Object.assign({}, LEGACY_DEFAULTS, p.extras.legacy);
    const sz = S.resolveSize(p, srcW, srcH);   // validates the source size (SCHEMA_SIZE) and range-checks both art axes
    const g = p.geometry;
    g.widthMM = sz.artWMM; g.heightMM = sz.artHMM;
    g.fabPitchMM = grid(Math.max(sz.artWMM, sz.artHMM) / leg.procRes);
    const workW = Math.max(32, Math.round(srcW * leg.procRes / Math.max(srcW, srcH)));
    p.construction.cleanup.toleranceMM = grid(Math.max(0.05, leg.detailEps * sz.artWMM / workW));
    return p;
  };

  // ------------------------------------------------------------ controller adapter (G2.11a, PRJ-01)
  // The v1.1.0 `state` view of a project, for the legacy pipeline (SBEngine.legacyRun/connectedFiles) and the v1.1.0
  // controls until the G2.11b–e stages replace them. `project` is the only source of truth; the app never keeps a copy.
  const frameMMOf = (p) => p.construction.frame.enabled ? p.construction.frame.widthMM : 0;
  /**
   * project → the 19 v1.1.0 settings keys (settingsJSON keep list). Pure. widthMM is the art width: targetMM − 2·frame in
   * width sizing, geometry.widthMM with lockAspect off, and in height sizing the width derived from the source size
   * (srcW, srcH) — null without one. procRes is geometry.draftPx; sourceName and detailEps (not project fields) come from
   * extras.legacy when the project was imported from settings.json, else their v1.1.0 defaults.
   */
  S.legacyState = function (project, srcW, srcH) {
    const p = project, it = p.interpretation, c = p.construction, g = p.geometry, f = frameMMOf(p);
    const leg = isLegacy(p) ? p.extras.legacy : {};
    let widthMM = null;
    if (!g.lockAspect) widthMM = g.widthMM;
    else if (g.sizeBy === "width") widthMM = grid(g.targetMM - 2 * f);
    else if (srcW !== undefined && srcH !== undefined) widthMM = S.resolveSize(p, srcW, srcH).artWMM;
    return {
      projectName: p.title,
      sourceName: leg.sourceName !== undefined ? leg.sourceName : LEGACY_DEFAULTS.sourceName,
      procRes: g.draftPx,
      smoothRadius: it.smoothing.radius, smoothPasses: it.smoothing.passes,
      nSheets: c.sheets,
      thresholdMode: it.thresholdRule === "linear" ? "linear" : "balanced",   // manual has no v1.1.0 equivalent
      darkFront: it.polarity === "dark-front" || it.polarity === "black-high",
      palette: p.appearance.palette,
      widthMM, marginMM: f,
      minFeatureMM: c.cleanup.minFeatureMM,
      bridgeMM: c.bridge.bridgeMM, cullBelowMM2: c.bridge.cullBelowMM2, maxBridgeMM: c.bridge.maxBridgeMM,
      holes: c.registration.enabled, holeDiaMM: c.registration.diaMM,
      cornerStyle: c.cleanup.cornerStyle === "sharp" ? "faceted" : "smooth",
      detailEps: typeof leg.detailEps === "number" ? leg.detailEps : LEGACY_DEFAULTS.detailEps,
    };
  };

  /**
   * Set one v1.1.0 control key on a project → a new project (input not mutated). The derivations follow
   * fromLegacySettings (speck = cull·0.5, hole fill = minFeature²·2). widthMM switches to width sizing and keeps the
   * frame; marginMM keeps the art width. revision + 1 exactly when geometryKey changes (PRJ-02: title and palette do not).
   * Throws SCHEMA_LEGACY for a key that is not project state (sourceName, detailEps) or unknown.
   */
  S.applyLegacy = function (project, key, value) {
    const p = clone(project), it = p.interpretation, c = p.construction, g = p.geometry, m = p.material;
    switch (key) {
      case "projectName": p.title = String(value); break;
      case "procRes": g.draftPx = value; break;
      case "smoothRadius": it.smoothing.radius = value; break;
      case "smoothPasses": it.smoothing.passes = value; break;
      case "nSheets": c.sheets = value; if (it.thresholdRule === "manual" && it.manual.length !== Math.max(0, value - 1)) it.manual = evenManual(value); break;
      case "thresholdMode": it.thresholdRule = value === "linear" ? "linear" : "balanced"; break;
      case "darkFront": it.polarity = it.mode === "height" ? (value ? "black-high" : "white-high") : (value ? "dark-front" : "light-front"); break;
      case "palette": p.appearance.palette = String(value); break;
      case "widthMM": {
        g.sizeBy = "width"; g.lockAspect = true; g.widthMM = value; g.heightMM = null;
        g.targetMM = grid(value + 2 * frameMMOf(p));
        break;
      }
      case "marginMM": {
        const art = S.legacyState(project).widthMM;
        c.frame = { enabled: value > 0, widthMM: value };
        if (g.lockAspect && g.sizeBy === "width") g.targetMM = grid(art + 2 * value);
        else if (g.lockAspect) g.targetMM = grid(g.targetMM - 2 * frameMMOf(project) + 2 * value);   // height sizing keeps the art height
        break;
      }
      case "minFeatureMM": {
        const tracked = m.advisoryFeatureMM === m.minFeatureMM;
        c.cleanup.minFeatureMM = value; c.cleanup.holeMM2 = r6(value * value * 2);
        m.minFeatureMM = value; m.advisoryFeatureMM = tracked ? value : Math.max(m.advisoryFeatureMM, value);
        break;
      }
      case "bridgeMM": c.bridge.bridgeMM = value; break;
      case "cullBelowMM2": c.bridge.cullBelowMM2 = value; c.cleanup.speckMM2 = r6(value * 0.5); m.minPartMM2 = value; break;
      case "maxBridgeMM": c.bridge.maxBridgeMM = value; break;
      case "holes": c.registration.enabled = !!value; break;
      case "holeDiaMM": c.registration.diaMM = value; break;
      case "cornerStyle": c.cleanup.cornerStyle = value === "faceted" ? "sharp" : "smooth"; break;
      default: throw fail("SCHEMA_LEGACY", "applyLegacy: " + key + " is not a project control key");
    }
    if (JSON.stringify(S.geometryKey(p)) !== JSON.stringify(S.geometryKey(project))) p.revision = project.revision + 1;
    return p;
  };

  /**
   * The fabrication pitch control (G2.11b, PO-LASER-4): `#in-res` is a number input in mm/px with these bounds; the
   * draft raster (geometry.draftPx, 720 px) is not a user control. The schema itself admits 0.01–2 mm (G2.1).
   */
  S.FAB_PITCH = deepFreeze({ min: 0.05, max: 2, step: 0.01, defaultMM: 0.1 });

  /**
   * Set geometry.fabPitchMM from the pitch input → a new project (input not mutated). The value is clamped to
   * FAB_PITCH.min–max and quantized to the 0.001 mm grid; a non-numeric or non-finite entry leaves the project unchanged.
   * revision + 1 exactly when geometryKey changes (the pitch is geometry).
   */
  S.applyFabPitch = function (project, value) {
    const p = clone(project);
    const v = typeof value === "number" ? value : (typeof value === "string" && value.trim() !== "" ? Number(value) : NaN);
    if (!Number.isFinite(v)) return p;
    p.geometry.fabPitchMM = grid(Math.min(S.FAB_PITCH.max, Math.max(S.FAB_PITCH.min, v)));
    if (JSON.stringify(S.geometryKey(p)) !== JSON.stringify(S.geometryKey(project))) p.revision = project.revision + 1;
    return p;
  };

  /**
   * The pure guard in front of regenerate() (PRJ-01: a source is required; there is no auto-demo). `source` is whatever
   * the controller holds (an image, a canvas or a source record); only its presence is checked here. → {ok, reason}.
   */
  S.canGenerate = function (project, source) {
    if (source === null || source === undefined) return { ok: false, reason: "Choose a source" };
    const v = S.validate(project);
    if (!v.ok) return { ok: false, reason: "Fix the project settings: " + v.errors.map((e) => (e.path || "project") + " (" + e.code + ")").join(", ") };
    return { ok: true, reason: null };
  };

  // ------------------------------------------------------------ control groups (G2.11c)
  /** N − 1 evenly spaced manual thresholds k/N (1e-6 grid), the seed for thresholdRule "manual". */
  function evenManual(N) { return Array.from({ length: Math.max(0, N - 1) }, (_, i) => r6((i + 1) / N)); }
  /** The polarity values that apply to an interpretation mode (tonal: light-front/dark-front; height: white-high/black-high). */
  S.polaritiesFor = (mode) => (POLARITY_FOR[mode] || []).slice();

  /** Set a value at a dotted path (objects only). */
  function setPath(o, path, v) {
    const k = path.split("."), last = k.pop();
    let cur = o;
    for (const x of k) cur = cur[x];
    cur[last] = clone(v);
  }
  const numIn = (v) => typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const MACHINE_FIELDS = { "m-height": ["maxProcessingHeightMM", 0.001, 1e5], "m-length": ["maxLengthMM", 0.001, 1e5],
    "m-matwidth": ["maxMaterialWidthMM", 0.001, 1e5], "m-thick": ["maxThicknessMM", 0.1, 25], "m-kerf": ["kerfMM", 0, 2] };

  /**
   * The one write path for the G2.11c controls → a new project (input never mutated). `id` is the control id without
   * the "in-" prefix; length values are entered in project.units (SBSchema.toMM, 0.001 mm grid) and clamped to the
   * schema ranges. ctx = {srcW, srcH} (optional) lets a sizeBy switch keep the finished page size (PO-LASER-3).
   *   interp, construction   SBSchema.applyModeChange(project, patch, true) (the app puts the G2.11e review dialog in front)
   *   polarity, thmode, cullon (bonded only: construction.bridge.cullEnabled), manual-th ("0.2, 0.5, …": N − 1 increasing values in (0, 1)), thickness, thickstate, gap,
   *   sizeby, target, machine (profile id | "none"), m-height, m-length, m-matwidth, m-thick, m-kerf  — geometry
   *   units, appearance, color (#rrggbb), explode (view.explodeMM)                                     — not geometry
   * A non-numeric entry, an unknown option or a result that fails SBSchema.validate leaves the project unchanged
   * (same revision). revision + 1 exactly when geometryKey changes (PRJ-02).
   */
  S.applyControl = function (project, id, value, ctx) {
    const p = clone(project), it = p.interpretation, c = p.construction, g = p.geometry, m = p.material, unit = p.units;
    const unchanged = () => clone(project);
    const length = (lo, hi) => { const v = numIn(value); return Number.isFinite(v) ? grid(clampTo(S.toMM(v, unit), lo, hi)) : null; };
    switch (id) {
      case "interp": case "construction": {
        const patch = id === "interp" ? { interpretation: { mode: value } } : { construction: { mode: value } };
        if (!(id === "interp" ? E.interp : E.construction).includes(value)) return unchanged();
        return S.applyModeChange(project, patch, true);
      }
      case "polarity": if (!POLARITY_FOR[it.mode].includes(value)) return unchanged(); it.polarity = value; break;
      case "thmode":
        if (!E.thresholdRule.includes(value)) return unchanged();
        it.thresholdRule = value;
        if (value === "manual" && it.manual.length !== Math.max(0, c.sheets - 1)) it.manual = evenManual(c.sheets);
        break;
      case "manual-th": {
        const xs = String(value).split(/[\s,;]+/).filter((x) => x !== "").map(Number);
        if (xs.length !== Math.max(0, c.sheets - 1) || !xs.every((x, i) => Number.isFinite(x) && x > 0 && x < 1 && (i === 0 || x > xs[i - 1]))) return unchanged();
        it.thresholdRule = "manual"; it.manual = xs.map(r6);
        break;
      }
      case "thickness": { const v = length(0.1, 25); if (v === null) return unchanged(); m.thicknessMM = v; break; }
      case "thickstate": if (!E.thicknessState.includes(value)) return unchanged(); m.thicknessState = value; break;
      case "gap": {
        const v = length(0, 25);
        if (v === null || c.mode === "bonded-relief") return unchanged();   // D1: the bonded gap is 0
        c.gapMM = v; break;
      }
      case "cullon": {   // G2.11d: removing small parts is an explicit opt-in in bonded mode only (connected always culls)
        if (c.mode !== "bonded-relief") return unchanged();
        const on = value === true || value === "true" ? true : value === false || value === "false" ? false : null;
        if (on === null) return unchanged();
        c.bridge.cullEnabled = on; break;
      }
      case "sizeby": {
        if (!E.sizeBy.includes(value)) return unchanged();
        if (value !== g.sizeBy && ctx && Number.isInteger(ctx.srcW) && Number.isInteger(ctx.srcH)) {
          try { const sz = S.resolveSize(project, ctx.srcW, ctx.srcH); g.targetMM = value === "height" ? sz.pageHMM : sz.pageWMM; } catch (e) { /* keep the number */ }
        }
        g.sizeBy = value; g.lockAspect = true;
        break;
      }
      case "target": { const v = length(1, 2000); if (v === null) return unchanged(); g.targetMM = v; break; }
      case "machine":
        if (value === "none") p.machine = null;
        else if (Object.prototype.hasOwnProperty.call(S.MACHINES, value)) p.machine = clone(S.MACHINES[value]);
        else return unchanged();
        break;
      case "m-height": case "m-length": case "m-matwidth": case "m-thick": case "m-kerf": {
        if (p.machine === null) return unchanged();
        const [key, lo, hi] = MACHINE_FIELDS[id], v = length(lo, hi);
        if (v === null) return unchanged();
        p.machine[key] = v;
        const base = Object.prototype.hasOwnProperty.call(S.MACHINES, p.machine.id) ? S.MACHINES[p.machine.id] : null;
        if (base) {
          const edited = Object.keys(MACHINE_FIELDS).some((f) => p.machine[MACHINE_FIELDS[f][0]] !== base[MACHINE_FIELDS[f][0]]);
          p.machine.name = edited ? base.name + " (edited)" : base.name;
        }
        break;
      }
      case "units": if (!E.units.includes(value)) return unchanged(); p.units = value; break;
      case "appearance": if (!E.appearance.includes(value)) return unchanged(); p.appearance.mode = value; break;
      case "color": if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)) return unchanged(); p.appearance.color = value.toUpperCase(); break;
      case "explode": { const v = numIn(value); if (!Number.isFinite(v)) return unchanged(); p.view.explodeMM = grid(clampTo(v, 0, 1000)); break; }
      default: throw fail("SCHEMA_CONTROL", "applyControl: unknown control " + id);
    }
    if (!S.validate(p).ok) return unchanged();
    if (JSON.stringify(S.geometryKey(p)) !== JSON.stringify(S.geometryKey(project))) p.revision = project.revision + 1;
    return p;
  };

  /** The displayed value of every G2.11c input (strings; lengths in project.units). Pure. */
  S.controlValues = function (project) {
    const p = project, unit = p.units, mach = p.machine;
    const L = (mm) => String(S.fromMM(mm, unit));
    const machineId = mach === null ? "none" : (Object.prototype.hasOwnProperty.call(S.MACHINES, mach.id) ? mach.id : "none");
    return {
      "in-interp": p.interpretation.mode, "in-polarity": p.interpretation.polarity, "in-construction": p.construction.mode,
      "in-thmode": p.interpretation.thresholdRule, "in-manual-th": p.interpretation.manual.join(", "),
      "in-thickness": L(p.material.thicknessMM), "in-thickstate": p.material.thicknessState, "in-gap": L(p.construction.gapMM),
      "in-cullon": String(p.construction.bridge.cullEnabled), "in-units": unit, "in-appearance": p.appearance.mode, "in-color": p.appearance.color.toLowerCase(), "in-explode": String(p.view.explodeMM),
      "in-sizeby": p.geometry.sizeBy, "in-target": L(p.geometry.targetMM), "in-machine": machineId,
      "in-m-height": mach ? L(mach.maxProcessingHeightMM) : "", "in-m-length": mach ? L(mach.maxLengthMM) : "",
      "in-m-matwidth": mach ? L(mach.maxMaterialWidthMM) : "", "in-m-thick": mach ? L(mach.maxThicknessMM) : "",
      "in-m-kerf": mach ? L(mach.kerfMM) : "",
    };
  };

  // ------------------------------------------------------------ applicability (G2.11d, UI-01, §9.5)
  const BONDED = (p) => p.construction.mode === "bonded-relief";
  const HEIGHT = (p) => p.interpretation.mode === "height";
  const R = {
    bondedBridge: "Not used in bonded mode: bonded never adds bridges.",
    bondedGap: "Bonded layers are glued face to face: the gap is 0.",
    bondedCorner: "Not used in bonded mode: bonded contours are unsmoothed (D1).",
    connectedCull: "Not used in connected mode: loose islands below the cull size are always removed there.",
    heightThreshold: "Not used in height mode: nearest-layer quantization replaces tone thresholds.",
    heightSmoothing: "Not used in height mode (no default filter, IMG-03).",
    tonalFilter: "Not used in tonal mode.",
  };
  /**
   * The mode-dependent rules. `controls` are disabled with `reason` while `off(p)`; `path` (when given) is the setting
   * those controls write, reported by ignoredSettings when it differs from `neutral` (the value of the preset that has
   * the mode which ignores it: plywood for bonded/height, acrylic for connected/tonal).
   */
  const RULES = [
    { controls: ["in-bridge"], off: BONDED, reason: R.bondedBridge, path: "construction.bridge.bridgeMM", neutral: 1.8 },
    { controls: ["in-maxbridge"], off: BONDED, reason: R.bondedBridge, path: "construction.bridge.maxBridgeMM", neutral: 40 },
    { controls: ["in-gap"], off: BONDED, reason: R.bondedGap },   // validate already pins the bonded gap to 0
    { controls: ["in-corner"], off: BONDED, reason: R.bondedCorner, path: "construction.cleanup.cornerStyle", neutral: "sharp" },
    { controls: [], off: BONDED, reason: R.bondedCorner, path: "construction.cleanup.toleranceMM", neutral: 0.05 },
    { controls: ["in-cullon"], off: (p) => !BONDED(p), reason: R.connectedCull, path: "construction.bridge.cullEnabled", neutral: false },
    { controls: ["in-thmode"], off: HEIGHT, reason: R.heightThreshold, path: "interpretation.thresholdRule", neutral: "balanced" },
    { controls: ["in-manual-th"], off: HEIGHT, reason: R.heightThreshold, path: "interpretation.manual", neutral: [] },
    { controls: ["in-smooth", "in-passes"], off: HEIGHT, reason: R.heightSmoothing, path: "interpretation.smoothing", neutral: { radius: 0, passes: 0 } },
    { controls: [], off: (p) => !HEIGHT(p), reason: R.tonalFilter, path: "interpretation.heightFilter", neutral: null },
    { controls: ["in-manual-th"], off: (p) => !HEIGHT(p) && p.interpretation.thresholdRule !== "manual", reason: "Choose the Manual tone split to enter thresholds." },
    { controls: ["in-holedia"], off: (p) => !p.construction.registration.enabled, reason: "Registration holes are off: turn them on to set the diameter." },
    { controls: ["in-m-height", "in-m-length", "in-m-matwidth", "in-m-thick", "in-m-kerf"], off: (p) => p.machine === null,
      reason: "No laser profile: choose one to edit its limits." },
  ];
  // Always-applicable controls listed so the result names every mode-dependent row (null = enabled).
  const ALWAYS = ["in-cull", "in-margin", "in-holes"];
  const getPath = (o, path) => path.split(".").reduce((t, k) => (t === null || t === undefined ? t : t[k]), o);

  /** {"in-…": reason | null}: why each mode-dependent control is disabled, or null when it applies. Pure. */
  S.applicability = function (project) {
    const out = {};
    for (const id of ALWAYS) out[id] = null;
    for (const r of RULES) for (const id of r.controls) if (!(id in out)) out[id] = null;
    for (const r of RULES) if (r.off(project)) for (const id of r.controls) if (out[id] === null) out[id] = r.reason;
    return out;
  };

  /**
   * §9.5: one DISPLAY_ONLY_IGNORED (info) per setting the project's modes do not use whose value differs from the
   * neutral value — it is kept (and shown) but has no effect on the output. Pure; the project must be valid.
   */
  S.ignoredSettings = function (project) {
    const out = [];
    for (const r of RULES) {
      if (!r.path || !r.off(project)) continue;
      const v = getPath(project, r.path);
      if (JSON.stringify(v) === JSON.stringify(r.neutral)) continue;
      out.push(global.SBDiag.make("DISPLAY_ONLY_IGNORED", { revision: project.revision, detail: r.path + " = " + JSON.stringify(v) + " (" + r.reason + ")" }));
    }
    return out;
  };

  // ------------------------------------------------------------ geometry key (PRJ-02, D4)
  const NOT_IN_KEY = ["appearance", "view", "acks", "extras", "title", "units", "id", "app", "createdAt", "modifiedAt", "revision"];
  S.geometryKey = function (p) {
    const k = {};
    for (const key of Object.keys(p)) if (!NOT_IN_KEY.includes(key)) k[key] = clone(p[key]);
    if (isObj(k.source)) delete k.source.byteHash;
    return k;
  };

  // ------------------------------------------------------------ sizing (PO-LASER-3)
  const toUm = (v) => Math.round(v * 1000);
  /** round(a·b / c) half up, exact for non-negative integers with a·b < 2^53. */
  const mulDivRound = (a, b, c) => { const n = 2 * a * b + c, d = 2 * c; return (n - (n % d)) / d; };

  const ART_MIN_UM = 1000, ART_MAX_UM = 2000000;   // MAT-02, per axis
  /**
   * Art and page size (PO-LASER-3). Throws SCHEMA_SIZE for a bad source size, and — with e.axis ("width"|"height"),
   * e.valueMM, e.minMM, e.maxMM — when an artwork axis, entered or derived, is outside MAT-02's 1–2000 mm.
   */
  S.resolveSize = function (p, srcW, srcH) {
    if (!Number.isInteger(srcW) || !Number.isInteger(srcH) || srcW < 1 || srcH < 1) throw fail("SCHEMA_SIZE", "source size must be positive integers (got " + srcW + " × " + srcH + ")");
    const g = p.geometry, fr = p.construction.frame;
    const frameUm = fr.enabled ? toUm(fr.widthMM) : 0;
    let artWUm, artHUm;
    if (!g.lockAspect) {
      if (g.widthMM === null || g.heightMM === null) throw fail("SCHEMA_SIZE", "lockAspect false needs widthMM and heightMM");
      artWUm = toUm(g.widthMM); artHUm = toUm(g.heightMM);
    } else if (g.sizeBy === "height") {
      artHUm = toUm(g.targetMM) - 2 * frameUm;
      artWUm = artHUm > 0 ? mulDivRound(artHUm, srcW, srcH) : 0;
    } else {
      artWUm = toUm(g.targetMM) - 2 * frameUm;
      artHUm = artWUm > 0 ? mulDivRound(artWUm, srcH, srcW) : 0;
    }
    // MAT-02: every artwork axis — entered or derived from the source aspect — must be 1–2000 mm (frame excluded).
    for (const [axis, um] of [["width", artWUm], ["height", artHUm]]) {
      if (um >= ART_MIN_UM && um <= ART_MAX_UM) continue;
      const e = fail("SCHEMA_SIZE", "MAT-02: artwork " + axis + " " + um / 1000 + " mm is outside " + ART_MIN_UM / 1000 + "–" + ART_MAX_UM / 1000 +
        " mm (" + (g.lockAspect ? "derived from " + g.sizeBy + " " + g.targetMM + " mm and the " + srcW + " × " + srcH + " px source" : "as entered") + ")");
      e.axis = axis; e.valueMM = um / 1000; e.minMM = ART_MIN_UM / 1000; e.maxMM = ART_MAX_UM / 1000;
      throw e;
    }
    const pageWUm = artWUm + 2 * frameUm, pageHUm = artHUm + 2 * frameUm;
    return { artWMM: artWUm / 1000, artHMM: artHUm / 1000, pageWMM: pageWUm / 1000, pageHMM: pageHUm / 1000,
      artWUm, artHUm, pageWUm, pageHUm, frameUm };
  };

  // ------------------------------------------------------------ units (AT-01, GEO-09)
  function unitArgs(v, unit) {
    if (typeof v !== "number" || !Number.isFinite(v)) throw fail("SCHEMA_UNIT", "value must be a finite number (got " + v + ")");
    if (unit !== "mm" && unit !== "in") throw fail("SCHEMA_UNIT", "unit must be mm|in (got " + unit + ")");
  }
  /** Value in `unit` → mm on the 0.001 mm grid. */
  S.toMM = function (v, unit) {
    unitArgs(v, unit);
    return unit === "in" ? Math.round(v * 25400) / 1000 : Math.round(v * 1000) / 1000;
  };
  /** mm → value in `unit`: mm to 0.001 mm; inches to 1e-5 in (0.254 µm), so toMM(fromMM(x)) === x on the grid. */
  S.fromMM = function (v, unit) {
    unitArgs(v, unit);
    const um = Math.round(v * 1000);
    return unit === "in" ? Math.round(um * 1000 / 254) / 1e5 : um / 1000;
  };

  // ------------------------------------------------------------ mode change review (PRJ-02, G2.11e)
  S.modeChangeDiff = function (p, patch) {
    const out = [];
    const add = (path, from, to, reason) => out.push({ path, from: clone(from), to: clone(to), reason });
    const cMode = patch && patch.construction && patch.construction.mode;
    const iMode = patch && patch.interpretation && patch.interpretation.mode;
    if (cMode !== undefined && !E.construction.includes(cMode)) throw fail("SCHEMA_MODE", "construction.mode " + cMode);
    if (iMode !== undefined && !E.interp.includes(iMode)) throw fail("SCHEMA_MODE", "interpretation.mode " + iMode);

    if (cMode !== undefined && cMode !== p.construction.mode) {
      const c = p.construction;
      add("construction.mode", c.mode, cMode, "Requested construction mode change.");
      if (cMode === "bonded-relief") {
        add("construction.gapMM", c.gapMM, 0, "Bonded layers are glued face to face: the gap is 0.");
        if (c.frame.enabled || c.frame.widthMM !== 0) add("construction.frame", c.frame, { enabled: false, widthMM: 0 }, "Bonded relief defaults to no frame ring (0); the finished size is kept and a ring can be set again.");
        if (c.registration.enabled) add("construction.registration.enabled", true, false, "Registration holes are off by default in bonded mode (ASM-04); they can be re-enabled.");
        for (const k of ["bridgeMM", "maxBridgeMM"]) add("construction.bridge." + k, c.bridge[k], c.bridge[k], "Not used in bonded mode: bonded never adds bridges.");
        add("construction.bridge.cullEnabled", c.bridge.cullEnabled, c.bridge.cullEnabled, "Used in bonded mode: removing small parts is an explicit opt-in.");
        add("construction.cleanup.cornerStyle", c.cleanup.cornerStyle, c.cleanup.cornerStyle, "Not used in bonded mode: bonded contours are unsmoothed (D1).");
        add("construction.cleanup.toleranceMM", c.cleanup.toleranceMM, c.cleanup.toleranceMM, "Not used in bonded mode: bonded contours are unsmoothed (D1).");
      } else {
        add("construction.gapMM", c.gapMM, c.gapMM === 0 ? 3 : c.gapMM, "Connected sheets are separated by spacers: default gap 3 mm.");
        for (const k of ["bridgeMM", "maxBridgeMM", "cullBelowMM2"]) add("construction.bridge." + k, c.bridge[k], c.bridge[k], "Used in connected mode: loose islands are bridged or culled.");
        add("construction.bridge.cullEnabled", c.bridge.cullEnabled, c.bridge.cullEnabled, "Not used in connected mode (culling always applies there).");
        add("construction.cleanup.cornerStyle", c.cleanup.cornerStyle, c.cleanup.cornerStyle, "Used in connected mode: contours are smoothed within the tolerance.");
      }
    }

    if (iMode !== undefined && iMode !== p.interpretation.mode) {
      const it = p.interpretation;
      add("interpretation.mode", it.mode, iMode, "Requested interpretation mode change.");
      const pol = POLARITY_FOR[iMode].includes(it.polarity) ? it.polarity : POLARITY_MAP[it.polarity];
      add("interpretation.polarity", it.polarity, pol, iMode === "tonal" ? "Tonal mode uses light-front / dark-front polarity." : "Height mode uses white-high / black-high polarity.");
      if (iMode === "tonal") {
        add("interpretation.thresholdRule", it.thresholdRule, it.thresholdRule, "Used in tonal mode: band thresholds (height mode uses nearest-layer quantization).");
        add("interpretation.smoothing", it.smoothing, it.smoothing, "Used in tonal mode only.");
        add("interpretation.heightFilter", it.heightFilter, null, "Not used in tonal mode.");
        add("geometry.resample", p.geometry.resample, p.geometry.resample, "Tonal mode resamples by area average.");
      } else {
        add("interpretation.thresholdRule", it.thresholdRule, it.thresholdRule, "Not used in height mode: nearest-layer quantization replaces thresholds.");
        add("interpretation.smoothing", it.smoothing, it.smoothing, "Not used in height mode (no default filter, IMG-03).");
        add("interpretation.heightFilter", it.heightFilter, it.heightFilter, "Used in height mode: an explicit, recorded filter.");
        add("geometry.resample", p.geometry.resample, p.geometry.resample, "Height mode keeps raw samples (nearest; area only as an explicit filter).");
      }
    }
    return out;
  };

  /**
   * The reviewed mode change (PRJ-02, G2.11e) → a new project (input never mutated). `accepted` false (Cancel) returns
   * an unchanged copy (same revision); true (Accept) applies every SBSchema.modeChangeDiff target value. revision + 1
   * exactly when geometryKey changes, so a patch that keeps the modes changes nothing. An unknown mode throws
   * SCHEMA_MODE either way; a result that fails SBSchema.validate leaves the project unchanged.
   */
  S.applyModeChange = function (project, patch, accepted) {
    const diff = S.modeChangeDiff(project, patch);
    if (!accepted || diff.length === 0) return clone(project);
    const p = clone(project);
    for (const d of diff) setPath(p, d.path, d.to);
    if (!S.validate(p).ok) return clone(project);
    if (JSON.stringify(S.geometryKey(p)) !== JSON.stringify(S.geometryKey(project))) p.revision = project.revision + 1;
    return p;
  };

  global.SBSchema = S;
})(typeof window !== "undefined" ? window : globalThis);
