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
 *                                    the ORIENTED source size (PO-LASER-3).
 *   SBSchema.limits(deviceClass)     → {deviceClass, fabPxBudget}. PROVISIONAL
 *                                    budgets (desktop 16 Mpx, mobile 4 Mpx)
 *                                    until G2.2b measures them; G2.14/G4.3 add
 *                                    the remaining limits.
 *   SBSchema.toMM / fromMM           lossless units, quantized to 0.001 mm.
 *   SBSchema.modeChangeDiff(p, patch) → [{path, from, to, reason}] (G2.11e).
 *   SBSchema.sourceTemplate()        a valid placeholder `source` record.
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
 * SCHEMA_DEVICE, SCHEMA_UNIT, SCHEMA_MODE. No other SB* global is used.
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
  // PROVISIONAL until G2.2b replaces them with the benchmarked budgets.
  const LIMITS = deepFreeze({
    desktop: { deviceClass: "desktop", fabPxBudget: 16000000 },
    mobile: { deviceClass: "mobile", fabPxBudget: 4000000 },
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
        cleanup: { minFeatureMM: 1.5, speckMM2: 4.5, holeMM2: 4.5, cornerStyle: "sharp", toleranceMM: 0.05 },
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
        cleanup: { minFeatureMM: 1.2, speckMM2: 4.5, holeMM2: 2.88, cornerStyle: "smooth", toleranceMM: 0.05 },
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
      cleanup: obj({ minFeatureMM: mm(0, 50), speckMM2: num(0, 1e6), holeMM2: num(0, 1e6), cornerStyle: en(E.cornerStyle), toleranceMM: mm(0.001, 5) }),
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
    if (!(artWUm >= 1 && artHUm >= 1)) throw fail("SCHEMA_SIZE", "artwork size is not positive (" + artWUm + " × " + artHUm + " µm)");
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
