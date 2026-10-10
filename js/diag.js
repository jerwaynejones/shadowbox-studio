/* ============================================================================
 * Shadowbox Studio — diag.js
 * ----------------------------------------------------------------------------
 * SBDiag: the single diagnostic-code registry (SRS §9.5, UI-04) and the
 * Diagnostic factory (SRS §9.1, plan §3). Codes are defined here and nowhere
 * else (plan G1.0); acknowledgements and the export gate (G2.2) below.
 *
 *   SBDiag.CODES                 frozen {code: {severity, title, fix, kind}}
 *                                severity "blocking"|"warning"|"info";
 *                                kind "geometry"|"fabrication"|"process".
 *   SBDiag.make(code, fields)    → Diagnostic. Severity always comes from
 *                                CODES and cannot be passed in (§9.5: no
 *                                downgrade). ackState is "unacked" for
 *                                warnings and "n/a" for blocking and info.
 *   SBDiag.aggregate(diags)      merges PART_SMALL, PART_THIN, NECK_NARROW, NECK_KERF
 *                                (Appendix G G2) and FEATURE_MARGINAL per (code, layer[, detail.kind])
 *                                (and GUIDE_OMITTED, alpha.3 E10) into one diagnostic with count, parts[] and a
 *                                region list.
 *   SBDiag.ackKey(diag, geometryHash)  "code|layer|part-or-*|geometryHash"
 *   SBDiag.exportGate(diags, acks, snapshot, expectedQuality="fabrication")
 *                                → {allowed, reason, blocking, unacked};
 *                                reason NO_SNAPSHOT|QUALITY_MISMATCH|
 *                                BLOCKING|UNACKED|null (G2.2, EXP-07, LYR-06)
 *   SBDiag.withAckState(diags, acks, geometryHash) → copies with ackState
 *   SBDiag.STATES / nextState(state, event) / stateBadge(state)
 *                                result states draft|stale|processing|validated|failed
 *                                and their text badges (G2.13b, UI-05)
 *   SBDiag.summarize(diags)      → [{severity, label, icon, count}] per severity (G2.13c, UI-04)
 *   SBDiag.describe(diag)        → one diagnostics-panel item: text with measured vs limit,
 *                                location and the focus target {layer, parts, regions} (G2.13c)
 *   SBDiag.acceptResult(active, msg) → whether a worker-pool result belongs to the active run
 *                                (runId, gen, sampleHash, overlays, deviceClass; speed round F11, AT-15)
 *
 * Besides the plan's list the registry carries every import error code:
 * SBPng.CODES (12), SBJpeg.CODES (4) and the preflight JPEG_UNSUPPORTED
 * (plan Appendix C, S4/S4b), the G2.14 intake codes SOURCE_TOO_LARGE,
 * SOURCE_TOO_MANY_PIXELS, SOURCE_FORMAT and HEIGHT_NEEDS_PNG (IMG-01/07)
 * and the intake warning EXIF_AMBIGUOUS (Appendix C, S4b), plus
 * GEO_MULTIPART, which SBGeom.validate reports under D3. alpha.3 E7 adds
 * SOURCE_COLOR_TONAL (info): a colour source auto-switched to tonal at load. alpha.3 E8 adds
 * FAB_COMPLEXITY_LIKELY (warning): the draft predicts a fabrication complexity-cap overflow. alpha.3 E13 adds
 * LEGACY_PROJECT_BLOCK (info): a v2 settings.json re-imported through the lossy v1.1 mapping. Speed round F1
 * (S4, F-D1) adds DRAFT_COARSER (info): the draft raster alone gives < 3 samples across the minimum feature, but
 * the fabrication plan, at which SAMPLING_LOW is judged, gives ≥ 3. Programmer-error
 * throws (GEO_MULTIPART_POLYGON, GEO_OFFSET_NONINTEGER, GEO_INSET_NOT_DYADIC)
 * are not user diagnostics.
 *
 * G2.0 (PO-LASER-4/5): FAB_PITCH_CAPPED (info) is registered here; make()
 * accepts an optional shortPx [shortW, shortH] that FAB_EXCEEDS_SOURCE
 * carries (SBRaster.fabDiagnostics builds both).
 *
 * G2.7 (PO-LASER-6): FEATURE_MARGINAL (warning) is registered here. make()
 * accepts detail as a string or {kind, text?}; the object form sets
 * d.detail = {kind} (FEATURE_MARGINAL "contact" | "part" | "neck"), enters the
 * id and splits aggregation groups.
 *
 * G2.7b (§12.3): BUSY_SIMPLIFIED (info) is registered here; make() accepts
 * deviceClass ("desktop"|"mobile", COMPLEXITY_LIMIT) and counts
 * ({before, after} part counts per layer, BUSY_SIMPLIFIED). Neither enters the id.
 *
 * G2.10a (PO-LASER-1/2, GEO-10): PAGE_OVERFLOW now comes from the machine
 * profile (SBSupport.checkEnvelope); MACHINE_THICKNESS (blocking) is new.
 *
 * D1: SMOOTH_FALLBACK is only ever raised in connected mode; bonded mode is
 * unsmoothed and never reports it.
 *
 * Looks up SBHash at call time (ids).
 * ==========================================================================*/
(function (global) {
  "use strict";
  const G = "geometry", F = "fabrication", P = "process";
  const B = "blocking", W = "warning", I = "info";

  // [code, severity, kind, title, fix]
  const TABLE = [
    // ---- blocking: geometry / fabrication / process
    ["BOND_UNSUPPORTED", B, G, "Bonded layer is not supported by the layer below",
      "Clip this layer to the layer below (repair) or change the thresholds so every bonded part rests on material."],
    ["BOND_EMPTY_UNDER", B, G, "Bonded layer sits over an empty layer",
      "Reduce the sheet count or adjust the thresholds so the layer below contains material."],
    ["GEO_SELF_INTERSECT", B, G, "Cut outline crosses itself",
      "Increase cleanup (minimum feature or speck size) around the highlighted region and regenerate."],
    ["GEO_ZERO_AREA", B, G, "Cut outline has zero area",
      "Increase speck removal so degenerate slivers are dropped, then regenerate."],
    ["GEO_DUPLICATE", B, G, "Duplicate cut outline or vertex",
      "Regenerate; if it persists, increase cleanup around the highlighted region."],
    ["GEO_OPEN", B, G, "Cut boundary is not closed",
      "Regenerate the layer; an open boundary cannot be cut. Report the project if it persists."],
    ["GEO_MULTIPART", B, G, "One outline describes several disconnected parts",
      "Regenerate; if it persists, increase the minimum feature size near the highlighted contact."],
    ["SAMPLING_LOW", B, G, "Sampling is too coarse for the requested detail",
      "Use a higher-resolution source or fabrication quality, or increase the minimum feature size."],
    ["NONFINITE", B, G, "A dimension or coordinate is not a finite number",
      "Check the artwork size, frame, gap and material thickness for empty or invalid values."],
    ["REG_HOLE_INVALID", B, F, "Registration hole does not fit",
      "Move the hole, reduce its diameter or edge clearance, or disable registration on this layer."],
    ["PAGE_OVERFLOW", B, F, "Page does not fit the machine's processing area",
      "Reduce the target size (artwork or frame), or edit the machine profile; output is never rescaled."],
    ["MACHINE_THICKNESS", B, F, "Material is thicker than the machine accepts",
      "Use thinner stock, correct the measured thickness, or edit the machine profile."],
    ["CONNECTED_SPLIT", B, G, "Connected sheet falls apart into separate pieces",
      "Add bridges, enable the frame, or adjust the thresholds so the sheet stays in one piece."],
    ["STALE", B, P, "Result is out of date",
      "Wait for regeneration to finish, or regenerate before exporting."],
    ["REPAIR_STALE", B, P, "Repair no longer matches the current settings",
      "Review and re-apply the repair, or remove it."],
    ["COMPLEXITY_LIMIT", B, P, "Geometry is too complex to process",
      "Simplify busy art (cleanup), or increase cleanup (speck and minimum feature size), reduce sheets, or use a simpler source; geometry is never truncated."],
    ["LEGACY_NEEDS_SOURCE", B, P, "Legacy project needs its source image",
      "Re-import the original source image to regenerate this project."],
    ["GUIDE_UNCONTAINED", B, F, "Assembly guide is not inside the part it marks",
      "Reduce the guide allowance or label height, or switch the guide mode."],
    ["NECK_KERF", B, F, "Neck is narrower than the laser kerf",
      "The kerf cuts through it and the part falls apart: widen the neck, raise the minimum feature size so cleanup removes it, or clip it."],
    ["PART_POINT_CONTACT", B, F, "Parts touch only at a point",
      "The laser separates parts that touch at a point; widen the contact to at least the minimum feature, or move them apart by more than the kerf."],
    // ---- blocking: import (SBPng.CODES, SBJpeg.CODES, preflight)
    ["PNG_16BIT", B, P, "16-bit PNG is not supported",
      "Re-save the image as an 8-bit PNG."],
    ["PNG_APNG", B, P, "Animated PNG is not supported",
      "Export a single still frame as a PNG."],
    ["PNG_CRC", B, P, "PNG file is corrupted (checksum mismatch)",
      "Re-export or re-download the image."],
    ["PNG_TRUNCATED", B, P, "PNG file is incomplete",
      "Re-export or re-download the complete image."],
    ["PNG_UNEQUAL_RGB", B, P, "Colour PNG cannot be used as a height map",
      "Convert the image to grayscale, or use tonal mode."],
    ["PNG_PALETTE", B, P, "Colour palette PNG cannot be used as a height map",
      "Convert the image to grayscale, or use tonal mode."],
    ["PNG_SIGNATURE", B, P, "File is not a PNG",
      "Choose a PNG or JPEG image."],
    ["PNG_HEADER", B, P, "PNG structure is invalid",
      "Re-export the image from an image editor."],
    ["PNG_INFLATE", B, P, "PNG image data is corrupted",
      "Re-export or re-download the image."],
    ["PNG_BITDEPTH", B, P, "Low bit-depth grayscale PNG is not accepted",
      "Re-save the image as an 8-bit grayscale PNG."],
    ["PNG_TOO_LARGE", B, P, "Image has too many pixels",
      "Downscale the image before importing."],
    ["PNG_NO_INFLATE", B, P, "This browser cannot decompress PNG data",
      "Update the browser or use a current Chrome, Firefox or Safari."],
    ["JPEG_SIGNATURE", B, P, "File is not a JPEG",
      "Choose a PNG or JPEG image."],
    ["JPEG_TRUNCATED", B, P, "JPEG file is incomplete",
      "Re-export or re-download the complete image."],
    ["JPEG_BAD_SEGMENT", B, P, "JPEG structure is invalid",
      "Re-export the image from an image editor."],
    ["JPEG_NO_SOF", B, P, "JPEG has no image frame",
      "Re-export the image from an image editor."],
    ["JPEG_UNSUPPORTED", B, P, "JPEG variant is not supported (12-bit, arithmetic, lossless or hierarchical)",
      "Re-save as a standard 8-bit baseline or progressive JPEG, or as a PNG."],
    // G2.14 (IMG-01/07): SBSchema.preflight / intake rejections, before any decode
    ["SOURCE_TOO_LARGE", B, P, "Image file is larger than this device accepts",
      "Use a smaller file (desktop 25 MiB, mobile 10 MiB), for example by re-saving it with more compression."],
    ["SOURCE_TOO_MANY_PIXELS", B, P, "Image has more pixels than this device accepts",
      "Use the Downsample button to reduce it explicitly (the coarser pitch is recorded), or use a smaller image."],
    ["SOURCE_FORMAT", B, P, "File is not a PNG or JPEG image",
      "Choose a PNG or JPEG image."],
    ["HEIGHT_NEEDS_PNG", B, P, "Height maps must be PNG",
      "Save the height map as an 8-bit grayscale PNG, or switch to tonal mode."],
    // ---- warning
    ["MAT_UNCALIBRATED", W, F, "Material is not calibrated",
      "Cut the calibration coupon and record the measured kerf and minimum feature."],
    ["PART_SMALL", W, F, "Part is smaller than the minimum part area",
      "Increase speck removal or the minimum part area, or accept the small parts."],
    ["PART_THIN", W, F, "Part is thinner than the minimum feature size",
      "Increase the minimum feature size or cleanup, or accept the thin parts."],
    ["NECK_NARROW", W, F, "Narrow neck may break during cutting or handling",
      "Increase the minimum feature size or add bridges, or accept the risk."],
    ["SUPPORT_NARROW", W, F, "Part rests on a narrow support",
      "Increase the minimum feature size or adjust the thresholds, or accept the risk."],
    ["FEATURE_MARGINAL", W, F, "Feature is below the advisory width for this material",
      "Widen the highlighted contact, part or neck, raise the minimum feature size, or accept the risk after a test cut."],
    ["GUIDE_OMITTED", W, F, "Assembly guide could not be placed",
      "Reduce the guide allowance or label height, or place the part by the placement map."],
    ["CLEANUP_ALTERED", W, G, "Cleanup changed the artwork",
      "Review the highlighted changes; lower cleanup settings to keep more detail."],
    ["SMOOTH_FALLBACK", W, G, "Smoothing was reduced to stay within tolerance",
      "Review the highlighted outline; raise the smoothing tolerance or use sharp corners."],
    ["TRAILING_OMITTED", W, P, "Trailing empty layers were omitted",
      "Reduce the sheet count or adjust the thresholds if the layers were expected."],
    ["ALIGN_CLEARANCE_ZERO", W, F, "Alignment has no clearance",
      "Increase the guide allowance or registration clearance."],
    ["REPAIR_REVIEW_FAB", W, P, "Repair must be reviewed at fabrication quality",
      "Review the repair in the fabrication review before exporting."],
    ["EXIF_AMBIGUOUS", W, P, "Browsers disagree on this file's orientation",
      "Check the preview; if it is rotated wrongly, re-save the image with its rotation applied."],
    ["FAB_EXCEEDS_SOURCE", W, P, "Fabrication resolution exceeds the source resolution",
      "Use a higher-resolution source or a smaller artwork; the engine never upsamples, so missing source detail cannot be recovered."],
    // alpha.3 E8 (PO-PREVIEW-4, §12.3): predicted from the draft (SBProof.predictFabComplexity); shown in the draft panel's
    // non-ackable "Fabrication resolution" group only, never in a snapshot (the fabrication run checks the real caps)
    ["FAB_COMPLEXITY_LIKELY", W, P, "Fabrication result likely exceeds the complexity cap",
      "Simplify busy art, use fewer sheets or a smaller artwork; Preview at fabrication resolution to check the exact counts."],
    // ---- info
    ["KERF_EXTERNAL", I, F, "Kerf is compensated in the laser software",
      "Set kerf offset in your laser software; cut files are at nominal size."],
    ["PALETTE_ONLY", I, P, "Colours are for preview only",
      "Palette colours do not change the cut files."],
    ["IDENTICAL_LAYERS", I, F, "Some physical layers are identical",
      "Adjust the thresholds if distinct layers were expected."],
    ["EMPTY_BAND", I, P, "A tonal band contains no pixels",
      "Adjust the thresholds or reduce the sheet count if the band was expected."],
    ["DISPLAY_ONLY_IGNORED", I, P, "Display-only setting does not affect the output",
      "No action needed; this setting only changes the preview."],
    ["FAB_PITCH_CAPPED", I, P, "Fabrication pitch was coarsened to fit the device pixel budget",
      "No action needed; the actual mm/px is shown. Reduce the artwork size or use a device with a larger budget for finer detail."],
    ["HEIGHT_FILTERED", I, P, "Height map was filtered before slicing",
      "The recorded filter is applied deterministically; remove it to slice raw heights."],
    ["RESAMPLED", I, P, "Source was resampled to the working resolution",
      "No action needed; use a matching source size to avoid resampling."],
    // speed round F1 (S4, PO-PERF-4, F-D1): SAMPLING_LOW is judged on the fabrication plan; a draft-only shortfall is info
    ["DRAFT_COARSER", I, P, "Draft sampling is below 3 samples per minimum feature",
      "No action needed; the minimum feature is checked at the fabrication pitch. Preview at fabrication resolution to see the full detail."],
    ["BUSY_SIMPLIFIED", I, P, "Busy art was simplified",
      "Small parts were dropped and close parts merged at the minimum feature size; set Simplify busy art to off to keep every part."],
    // alpha.3 E7 (IMG-01, PO-PREVIEW-3): a colour source that height mode refuses switched the project to tonal at load
    ["SOURCE_COLOR_TONAL", I, P, "Colour image: using Tonal (light/dark \u2192 layers). Height mode needs a grayscale height map.",
      "No action needed; change Read the image as (Interpretation) to choose another reading, or load a grayscale height map for Height."],
    // alpha.3 E13 (DEP-04, EXP-06): a settings.json written by v2 carries a project block that the v1.1 import ignores
    ["LEGACY_PROJECT_BLOCK", I, P, "This settings.json came from a v2 project; only the v1.1 settings were imported",
      "The import builds an acrylic connected-sheet project from the v1.1 keys (a bonded relief re-imports as connected sheets); the v2 project block is kept but not applied. Open the .sbrproj (G3.8) for a full round trip."],
  ];

  const CODES = {};
  for (const [code, severity, kind, title, fix] of TABLE) CODES[code] = Object.freeze({ severity, title, fix, kind });
  Object.freeze(CODES);

  const QUALITIES = ["draft", "fabrication"];
  const AGGREGATED = new Set(["PART_SMALL", "PART_THIN", "NECK_NARROW", "NECK_KERF", "FEATURE_MARGINAL", "GUIDE_OMITTED"]);   // G2: PART_POINT_CONTACT is not aggregated (G-D2)
  // G2.8 (GEO-05): small-part, thin-part and neck warnings (and FEATURE_MARGINAL of kind part|neck) are labelled.
  const GEO05 = new Set(["PART_SMALL", "PART_THIN", "NECK_NARROW", "FEATURE_MARGINAL"]);
  const GEO05_NOTE = "Conservative fabrication warning — not a structural simulation";

  function measure(m, name) {
    if (m === undefined || m === null) return null;
    if (typeof m !== "object" || !Number.isFinite(m.value) || typeof m.unit !== "string")
      throw new Error("SBDiag.make: " + name + " must be {value: finite number, unit: string} or null");
    return { value: m.value, unit: m.unit };
  }
  const orNull = (v) => (v === undefined ? null : v);

  /**
   * Build a §9.1 Diagnostic. Unknown codes and invalid quality throw; any
   * `severity` or `ackState` passed in is ignored.
   */
  function make(code, f) {
    const c = Object.prototype.hasOwnProperty.call(CODES, code) ? CODES[code] : null;
    if (!c) throw new Error("SBDiag.make: unknown diagnostic code " + code);
    f = f || {};
    const quality = f.quality === undefined ? "draft" : f.quality;
    if (!QUALITIES.includes(quality)) throw new Error("SBDiag.make: quality must be draft|fabrication (got " + quality + ")");
    const areaMM2 = orNull(f.areaMM2);
    let detailText = f.detail, detailKind = null;
    if (f.detail !== null && typeof f.detail === "object") { // G2.7: {kind, text?} (FEATURE_MARGINAL detail.kind "contact"|"part"|"neck")
      if (typeof f.detail.kind !== "string" || !f.detail.kind) throw new Error("SBDiag.make: detail must be a string or {kind: string, text?: string}");
      detailKind = f.detail.kind; detailText = f.detail.text;
    }
    if (areaMM2 !== null && !Number.isFinite(areaMM2)) throw new Error("SBDiag.make: areaMM2 must be finite");
    const d = {
      id: "", code, severity: c.severity, revision: orNull(f.revision), quality,
      layer: orNull(f.layer), part: orNull(f.part),
      areaMM2, region: orNull(f.region),
      measured: measure(f.measured, "measured"), limit: measure(f.limit, "limit"),
      message: (detailText ? c.title + ": " + detailText : c.title) + (GEO05.has(code) && (code !== "FEATURE_MARGINAL" || detailKind === "part" || detailKind === "neck") ? " (" + GEO05_NOTE + ")" : ""),
      fix: c.fix,
      ackState: c.severity === W ? "unacked" : "n/a",
    };
    if (detailKind !== null) d.detail = { kind: detailKind };
    if (Array.isArray(f.parts)) d.parts = f.parts.slice();
    if (f.shortPx !== undefined && f.shortPx !== null) { // PO-LASER-5 (FAB_EXCEEDS_SOURCE): [shortW, shortH] px
      if (!Array.isArray(f.shortPx) || f.shortPx.length !== 2 || !f.shortPx.every((v) => Number.isInteger(v) && v >= 0))
        throw new Error("SBDiag.make: shortPx must be [int ≥ 0, int ≥ 0]");
      d.shortPx = f.shortPx.slice();
    }
    if (f.deviceClass !== undefined && f.deviceClass !== null) { // G2.7b COMPLEXITY_LIMIT: the device class whose cap was exceeded
      if (f.deviceClass !== "desktop" && f.deviceClass !== "mobile") throw new Error("SBDiag.make: deviceClass must be desktop|mobile");
      d.deviceClass = f.deviceClass;
    }
    if (f.counts !== undefined && f.counts !== null) { // G2.7b BUSY_SIMPLIFIED: part counts per layer before/after simplification
      const c = f.counts, ok = (a) => Array.isArray(a) && a.every((v) => Number.isInteger(v) && v >= 0);
      if (!c || !ok(c.before) || !ok(c.after) || c.before.length !== c.after.length) throw new Error("SBDiag.make: counts must be {before: int[], after: int[]} of equal length");
      d.counts = { before: c.before.slice(), after: c.after.slice() };
    }
    if (f.count !== undefined) {
      if (!Number.isInteger(f.count) || f.count < 1) throw new Error("SBDiag.make: count must be a positive integer");
      d.count = f.count;
    }
    // Deterministic id from what the diagnostic is about (not revision or quality).
    const idOf = { code, layer: d.layer, part: d.part, parts: d.parts || null, region: d.region };
    if (detailKind !== null) idOf.kind = detailKind; // existing ids unchanged
    d.id = code + "-" + global.SBHash.hashJSON(idOf).slice(0, 12);
    return d;
  }

  /**
   * Merge PART_SMALL / PART_THIN / NECK_NARROW / FEATURE_MARGINAL per (code, layer, detail.kind). The merged
   * diagnostic takes the position of the group's first member; other
   * diagnostics are passed through unchanged. Idempotent; input not mutated.
   */
  function aggregate(diags) {
    const groups = new Map(), out = [];
    for (const d of diags) {
      if (!AGGREGATED.has(d.code)) { out.push(d); continue; }
      const key = d.code + "|" + d.layer + (d.detail ? "|" + d.detail.kind : "");
      let g = groups.get(key);
      if (!g) { g = { slot: out.length, members: [] }; groups.set(key, g); out.push(null); }
      g.members.push(d);
    }
    for (const g of groups.values()) {
      const first = g.members[0];
      const parts = [], regions = [];
      let count = 0, area = null, worst = null, limit = null;
      for (const d of g.members) {
        const isAgg = Array.isArray(d.parts);
        if (isAgg) parts.push(...d.parts); else if (d.part !== null && d.part !== undefined) parts.push(d.part);
        if (isAgg && Array.isArray(d.region)) regions.push(...d.region); else if (d.region !== null && d.region !== undefined) regions.push(d.region);
        count += d.count || 1;
        if (Number.isFinite(d.areaMM2)) area = (area || 0) + d.areaMM2;
        if (d.measured && (worst === null || d.measured.value < worst.value)) worst = d.measured;
        if (!limit && d.limit) limit = d.limit;
      }
      if (g.members.length === 1 && Array.isArray(first.parts)) { out[g.slot] = first; continue; } // already aggregated
      const text = count + " affected", detail = first.detail ? { kind: first.detail.kind, text } : text;
      out[g.slot] = make(first.code, { revision: first.revision, quality: first.quality, layer: first.layer, part: null,
        parts, count, areaMM2: area, region: regions, measured: worst, limit, detail });
    }
    return out;
  }

  // ---- G2.2: acknowledgements and the export gate (§9.5, EXP-07, LYR-06) ----

  const isAggregate = (d) => Array.isArray(d.parts);
  const slot = (v) => (v === null || v === undefined ? "-" : String(v));

  /**
   * Acknowledgement key `code|layer|part-or-aggregate|geometryHash`. An
   * aggregated diagnostic (parts[]) uses "*", so one ack covers it.
   * geometryHash includes quality and raster size (plan §3), so a draft ack
   * never matches a fabrication snapshot, and any geometry change (e.g. N
   * 8 → 3 → 8) invalidates every ack taken before it.
   */
  function ackKey(diag, geometryHash) {
    if (typeof geometryHash !== "string" || geometryHash.length === 0)
      throw new Error("SBDiag.ackKey: geometryHash must be a non-empty string");
    if (!diag || typeof diag.code !== "string") throw new Error("SBDiag.ackKey: diagnostic required");
    return diag.code + "|" + slot(diag.layer) + "|" + (isAggregate(diag) ? "*" : slot(diag.part)) + "|" + geometryHash;
  }

  const toSet = (acks) => (acks instanceof Set ? acks : new Set(acks || []));
  // Severity always from the registry (§9.5: never downgraded by a stored field).
  const severityOf = (d) => (Object.prototype.hasOwnProperty.call(CODES, d.code) ? CODES[d.code].severity : B);

  /**
   * Gate an export on one snapshot. Order of reasons: NO_SNAPSHOT,
   * QUALITY_MISMATCH (snapshot or any diagnostic not at expectedQuality),
   * BLOCKING (never acknowledgeable), UNACKED (a warning whose ackKey for
   * snapshot.geometryHash is not in acks); otherwise allowed, reason null.
   * A stored diag.ackState is ignored: only `acks` counts. Unknown codes are
   * treated as blocking.
   */
  function exportGate(diags, acks, snapshot, expectedQuality) {
    if (expectedQuality === undefined) expectedQuality = "fabrication";
    if (!QUALITIES.includes(expectedQuality)) throw new Error("SBDiag.exportGate: expectedQuality must be draft|fabrication");
    diags = diags || [];
    const set = toSet(acks);
    const hasHash = !!snapshot && typeof snapshot.geometryHash === "string" && snapshot.geometryHash.length > 0;
    const blocking = [], unacked = [];
    for (const d of diags) {
      const sev = severityOf(d);
      if (sev === B) blocking.push(d);
      else if (sev === W && !(hasHash && set.has(ackKey(d, snapshot.geometryHash)))) unacked.push(d);
    }
    let reason = null;
    if (!hasHash) reason = "NO_SNAPSHOT";
    else if (snapshot.quality !== expectedQuality || diags.some((d) => d.quality !== expectedQuality)) reason = "QUALITY_MISMATCH";
    else if (blocking.length) reason = "BLOCKING";
    else if (unacked.length) reason = "UNACKED";
    return { allowed: reason === null, reason, blocking, unacked };
  }

  /** Copies of diags with ackState filled for display and validation.json. */
  function withAckState(diags, acks, geometryHash) {
    const set = toSet(acks);
    return (diags || []).map((d) => {
      const sev = severityOf(d);
      const ackState = sev !== W ? "n/a" : set.has(ackKey(d, geometryHash)) ? "acked" : "unacked";
      return Object.assign({}, d, { ackState });
    });
  }

  // ---- G2.13b: result states and their badges (UI-05) ----

  const STATES = Object.freeze(["draft", "stale", "processing", "validated", "failed"]);
  const BADGES = {
    draft: ["Draft", "Draft-quality result: for review only; not validated at fabrication quality."],
    stale: ["Stale", "Settings changed since this result was produced; it no longer matches the project."],
    processing: ["Processing…", "Generating and validating the current settings."],
    validated: ["Validated", "Fabrication-quality result with no blocking diagnostics for the current settings."],
    failed: ["Failed", "The last run failed or has blocking diagnostics; see the diagnostics for the fix."],
  };
  const stateErr = (who, what) => new Error("SBDiag." + who + ": STATE — " + what);

  /**
   * Result-state machine (UI-05). event.type:
   *   "edit"  → "stale" from any state (an edit during processing supersedes that run);
   *   "start" → "processing";
   *   "done"  {quality, diagnostics} → only from "processing": a draft-quality result is "draft"; a
   *           fabrication result is "validated" when it has no blocking diagnostic, otherwise "failed";
   *   "fail"  → only from "processing": "failed".
   * A "done"/"fail" arriving in any other state (a run superseded by an edit) leaves the state unchanged.
   */
  function nextState(state, event) {
    if (!STATES.includes(state)) throw stateErr("nextState", "unknown state " + JSON.stringify(state));
    const type = event && event.type;
    if (type === "edit") return "stale";
    if (type === "start") return "processing";
    if (type === "done") {
      if (state !== "processing") return state;
      if (!QUALITIES.includes(event.quality)) throw stateErr("nextState", "done needs quality draft|fabrication");
      if (event.quality === "draft") return "draft";
      return (event.diagnostics || []).some((d) => severityOf(d) === B) ? "failed" : "validated";
    }
    if (type === "fail") return state === "processing" ? "failed" : state;
    throw stateErr("nextState", "unknown event " + JSON.stringify(type));
  }

  /** Badge for a state: {state, label, text}; the label is text, never colour alone (NFR-07). */
  function stateBadge(state) {
    if (!STATES.includes(state)) throw stateErr("stateBadge", "unknown state " + JSON.stringify(state));
    return { state, label: BADGES[state][0], text: BADGES[state][1] };
  }

  // ---- G2.13c: the diagnostics panel model (UI-04, NFR-07) ----

  const SEVERITIES = [B, W, I];
  // Text label plus a glyph icon (never a colour name): the label carries the meaning, the icon only reinforces it.
  const SEV = { blocking: ["Blocking", "\u2716"], warning: ["Warning", "\u25B2"], info: ["Info", "\u2139"] };

  /** Group counts for the panel summary: [{severity, label, icon, count}] in blocking, warning, info order; empty groups omitted. */
  function summarize(diags) {
    const n = { blocking: 0, warning: 0, info: 0 };
    for (const d of diags || []) n[severityOf(d)]++;
    return SEVERITIES.filter((s) => n[s] > 0).map((s) => ({ severity: s, label: SEV[s][0], icon: SEV[s][1], count: n[s] }));
  }

  const UNIT = { mm2: "mm\u00B2", um: "\u00B5m" };
  function fmtNum(v) {
    if (v !== 0 && Math.abs(v) < 0.01) return String(Number(v.toPrecision(2)));
    return String(Math.round(v * 100) / 100);
  }
  const fmtMeasure = (m) => fmtNum(m.value) + " " + (UNIT[m.unit] || m.unit);
  const isBox = (r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite);

  /**
   * One panel item: {severity, severityLabel, icon, code, title, message, where, measure, fix, text, focus, navigable}.
   *   measure  "measured 0.8 mm vs limit 1.5 mm" (either half alone when only one is set; "" when neither)
   *   where    "Layer k+1[, part ID | , n parts]" ("" without a layer)
   *   focus    {layer, parts: string[], regions: [[x0, y0, x1, y1] mm]} for a diagnostic with an integer layer, else null;
   *            a single bbox region or an aggregated region list both become a list of bboxes.
   *   text     the whole item as one string (severity in text, location, message, measured vs limit).
   * Severity always from the registry (§9.5).
   */
  function describe(d) {
    if (!d || typeof d !== "object" || typeof d.code !== "string") throw new Error("SBDiag.describe: diagnostic required");
    const severity = severityOf(d), c = CODES[d.code] || { title: d.code, fix: "" };
    const parts = Array.isArray(d.parts) ? d.parts.slice() : d.part !== null && d.part !== undefined ? [d.part] : [];
    const layer = Number.isInteger(d.layer) ? d.layer : null;
    let where = "";
    if (layer !== null) where = "Layer " + (layer + 1) + (Array.isArray(d.parts) ? (parts.length ? ", " + parts.length + " part" + (parts.length === 1 ? "" : "s") : "") :
      parts.length ? ", part " + parts[0] : "");
    const m = [];
    if (d.measured) m.push("measured " + fmtMeasure(d.measured));
    if (d.limit) m.push("limit " + fmtMeasure(d.limit));
    const measure = m.join(" vs ");
    const regions = isBox(d.region) ? [d.region.slice()] : Array.isArray(d.region) ? d.region.filter(isBox).map((r) => r.slice()) : [];
    const focus = layer === null ? null : { layer, parts, regions };
    const message = typeof d.message === "string" && d.message ? d.message : c.title;
    const text = SEV[severity][0] + ": " + (where ? where + " \u2014 " : "") + message + (measure ? " (" + measure + ")" : "");
    return { severity, severityLabel: SEV[severity][0], icon: SEV[severity][1], code: d.code, title: c.title, message, where, measure,
      fix: c.fix, text, focus, navigable: focus !== null };
  }

  /**
   * acceptResult(active, msg) → boolean (speed round F11, G4.1, AT-15): whether a pool result belongs to the run the UI is
   * waiting for. active = {runId, gen, sampleHash, overlays, deviceClass} as recorded at submit; msg is the pool's result
   * (the same fields echoed by the coordinator). Keyed by the unique monotonic runId plus gen, sampleHash, overlays and
   * deviceClass, never by requestId ("draft-"+rev repeats across overlay toggles and same-revision resubmits). A null
   * sampleHash (inline pixels) matches only null. Pure.
   */
  function acceptResult(active, msg) {
    if (!active || typeof active !== "object" || !msg || typeof msg !== "object") return false;
    if (!Number.isSafeInteger(active.runId) || msg.runId !== active.runId) return false;
    return ["gen", "sampleHash", "overlays", "deviceClass"].every((k) => k in msg && Object.is(msg[k], active[k]));
  }

  global.SBDiag = { CODES, make, aggregate, ackKey, exportGate, withAckState, STATES, nextState, stateBadge, summarize, describe, acceptResult };
})(typeof window !== "undefined" ? window : globalThis);
