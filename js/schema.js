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
 *                                    (docs/perf/complexity.json). G2.14/G4.3
 *                                    add the remaining limits.
 *   construction.cleanup.simplify    "off" | "busy" (G2.7b; default "off", in
 *                                    geometryKey): explicit busy-art
 *                                    simplification, SBConstruct.simplifyBusy.
 *   SBSchema.toMM / fromMM           lossless units, quantized to 0.001 mm.
 *   SBSchema.modeChangeDiff(p, patch) → [{path, from, to, reason}] (G2.11e).
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
 * at call time (legacy diagnostics only); no other SB* global is used.
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
  // IMG-07 still caps sources at 16 MP (desktop) / 8 MP (mobile), and the engine never upsamples.
  // G2.7b complexity caps (SRS §12.3; SRS:L564: fail explicitly, never truncate). Mobile: the SRS §12.3 mobile workload
  // (100 parts/layer, 20,000 vertices total; per layer bounded by the total). Desktop: measured by `node test/bench.js caps`
  // (docs/perf/complexity.json, decision.desktop): the largest caps at which the capped busy workload at the desktop budget
  // meets the 10 s bonded target and 512 MiB, never below the realistic art measured at that budget; the test
  // "§12.3/PO-LASER-9 desktop caps equal the measured decision" keeps them in step.
  const DESKTOP_CAPS = { maxPartsPerLayer: 258, maxVerticesPerLayer: 132000, maxVerticesTotal: 356000 };   // c208 row (+ c200 vertices), 2026-10-08
  const LIMITS = deepFreeze({
    desktop: { deviceClass: "desktop", fabPxBudget: 25000000, maxPartsPerLayer: DESKTOP_CAPS.maxPartsPerLayer,
      maxVerticesPerLayer: DESKTOP_CAPS.maxVerticesPerLayer, maxVerticesTotal: DESKTOP_CAPS.maxVerticesTotal },
    mobile: { deviceClass: "mobile", fabPxBudget: 1000000, maxPartsPerLayer: 100, maxVerticesPerLayer: 20000, maxVerticesTotal: 20000 },
  });
  S.limits = function (deviceClass) {
    if (!Object.prototype.hasOwnProperty.call(LIMITS, deviceClass)) throw fail("SCHEMA_DEVICE", "deviceClass must be desktop|mobile (got " + deviceClass + ")");
    return LIMITS[deviceClass];
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
    if (!isObj(obj)) return { project: obj, movedToExtras: [] };
    const project = {}, movedToExtras = [];
    const extras = isObj(obj.extras) ? clone(obj.extras) : {};
    for (const k of Object.keys(obj)) {
      if (k === "extras") continue;
      if (Object.prototype.hasOwnProperty.call(SPEC, k)) project[k] = clone(obj[k]);
      else { extras[k] = clone(obj[k]); movedToExtras.push(k); }
    }
    project.extras = extras;
    return { project, movedToExtras };
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
      case "nSheets": c.sheets = value; break;
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

  global.SBSchema = S;
})(typeof window !== "undefined" ? window : globalThis);
