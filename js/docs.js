/* ============================================================================
 * Shadowbox Studio — js/docs.js
 * ----------------------------------------------------------------------------
 * SBDocs: pure user-facing copy and the dimension-bar model. DOM-free.
 * Created early by G2.11c for the disclaimers and the dimbar; G3.5 adds
 * SBDocs.assembly (ASSEMBLY.md) to the same module.
 *
 *   SBDocs.COPY                      frozen strings: MAT01 (stock height excludes adhesive and finishes),
 *                                    MAT04 (palette is a proof aid), THICKNESS_HINT (PO-LASER-8).
 *   SBDocs.pageFit(wMM, hMM, machine) → {fits, overMM}: the shared page against the machine processing area,
 *                                    either orientation, in integer µm; the same rule as SBSupport.checkEnvelope
 *                                    (PO-LASER-2). overMM is the smallest excess over both orientations (0 when it fits).
 *                                    machine null → {fits: null, overMM: null}.
 *   SBDocs.dimbarModel({project, plan, stats}) → deep-frozen model of the persistent dimension bar (G2.11c):
 *     project  the schema v1 project (units, sheets, thickness, gap, machine).
 *     plan     SBEngine.rasterPlan(project, source, "fabrication", deviceClass) or null (no source yet). It is
 *              computed before generation, so the pitch, the raster and the cap reason are never silent (NFR-04).
 *     stats    the snapshot's stats ({requested, exported, omitted[], stockMM, reliefMM, maxZMM}) or null before
 *              generation. A stats record without maxZMM (the legacy connected path) derives it from `exported`.
 *   → {units,
 *      layers:     {requested, exported|null, omitted[], text}                                    (LYR-01)
 *      z:          {maxZMM, baseMM, reliefMM = maxZMM − t, stockMM = N·t, estimated, text}         (LYR-01, AT-03)
 *      pitch:      {targetMM, actualMM, rasterW, rasterH, mpx, capped, deviceClass, budgetPx, shortPx, reason, text}
 *                                                                                                   (PO-LASER-4/5)
 *      page:       {wMM, hMM, machine, fits, overMM, text}                                         (PO-LASER-2)
 *      stock:      {ok, text}  thickness against machine.maxThicknessMM                            (PO-LASER-1)
 *      thresholds: SBHeight.boundaries(N, t) with text "k  norm → mm"; thresholdsNote             (LYR-02)
 *      disclaimers: [COPY.MAT01]}
 *   Lengths are shown in project.units (SBSchema.fromMM); pitch is always mm/px.
 *
 *   SBDocs.sourceNotes(warnings) → string[]: one line per preflight/plan diagnostic (alpha.3 E8, PO-PREVIEW-4), shown
 *              at load: the SBDiag.describe message (title + detail; FAB_EXCEEDS_SOURCE's detail carries the px shortfall,
 *              appended from shortPx if a detail ever lacks it).
 *
 *   SBDocs.assembly(project, fabSnapshot, {colors, sourceName}) → string: ASSEMBLY.md (alpha.3 E13, ASM-05, PO-PREVIEW-7),
 *              built only from the exported fabrication snapshot (page, construction, stats, layers, guides, geometryHash)
 *              and the project's machine, material and guide settings. colors: one colour or an array indexed by layer
 *              index. Bonded: art/page size, thickness and stack height, a table of the exported sheets (file, layer,
 *              parts, role base/layer/top) and the omitted trailing layers, the glue-up order, the guide and sheet-number
 *              explanation, omitted guides and placement_map.svg, the machine and processing area, the external-kerf line
 *              (G3.5 wording "no kerf offset applied (kerfMode=external)" + machine.kerfMM), the EXP-09 downstream-edit
 *              warning, MAT-01/MAT-04, the short geometryHash; no speed or power value (NFR-12), no bridge/dowel/spacer
 *              text. Connected: the v1.1 wording (frame, registration holes, bridges, spacers at the snapshot's gap)
 *              rebuilt from the snapshot. Deterministic: no date. G3.5 adds the part-ID listing and support references.
 *
 * Looks up SBSchema, SBHeight and SBDiag at call time.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const D = {};

  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
    return o;
  }
  function dfail(msg) { const e = new Error("DOCS_ARG: " + msg); e.code = "DOCS_ARG"; return e; }
  const um = (mm) => Math.round(mm * 1000);
  const r3 = (v) => Math.round(v * 1000) / 1000;

  D.COPY = deepFreeze({
    MAT01: "Stock height excludes adhesive films and surface finishes.",
    MAT04: "Palette shading is a proof aid; it is not necessarily the appearance of unpainted stock.",
    THICKNESS_HINT: "1/4\" ply often measures 5.5–6 mm: measure and enter it.",
  });

  /** A length in mm → text in the project's unit (mm to 0.001 mm, inches to 0.0001 in), trailing zeros trimmed. */
  function len(mm, unit) {
    const v = global.SBSchema.fromMM(mm, unit);
    return String(Number(v.toFixed(unit === "in" ? 4 : 3))) + " " + unit;
  }
  const mpxText = (px) => String(Number((px / 1e6).toFixed(1))) + " Mpx";

  D.pageFit = function (wMM, hMM, machine) {
    if (machine === null || machine === undefined) return { fits: null, overMM: null };
    const W = um(wMM), H = um(hMM), P = um(machine.maxProcessingHeightMM), L = um(machine.maxLengthMM);
    const over = (a, b) => Math.max(0, a - L, b - P);   // a along the length, b under the processing height
    const o = Math.min(over(W, H), over(H, W));
    return { fits: o === 0, overMM: o / 1000 };
  };

  D.dimbarModel = function (input) {
    if (!input || typeof input !== "object" || !input.project) throw dfail("dimbarModel needs {project, plan, stats}");
    const p = input.project, plan = input.plan || null, stats = input.stats || null;
    const unit = p.units === "in" ? "in" : "mm";
    const N = p.construction.sheets, bonded = p.construction.mode === "bonded-relief";
    const tUm = um(p.material.thicknessMM), gUm = bonded ? 0 : um(p.construction.gapMM), t = tUm / 1000;

    // layers (LYR-01)
    const exported = stats && Number.isInteger(stats.exported) ? stats.exported : null;
    const omitted = stats && Array.isArray(stats.omitted) ? stats.omitted.slice() : [];
    const layers = {
      requested: N, exported, omitted,
      text: exported === null ? N + " requested · exported count after generation"
        : N + " requested · " + exported + " exported" + (omitted.length ? " (omitted " + omitted.map((k) => k + 1).join(", ") + ")" : ""),
    };

    // Z (LYR-01, AT-03; MAT-01: no adhesive or finish term)
    const nE = exported === null ? N : exported;
    const maxZUm = stats && Number.isFinite(stats.maxZMM) ? um(stats.maxZMM) : (nE > 0 ? nE * tUm + (nE - 1) * gUm : 0);
    const estimated = exported === null && !(stats && Number.isFinite(stats.maxZMM));   // exact once the exported count is known
    const z = {
      maxZMM: maxZUm / 1000, baseMM: t, reliefMM: Math.max(0, maxZUm - tUm) / 1000, stockMM: (N * tUm) / 1000, estimated,
      text: "Max Z " + len(maxZUm / 1000, unit) + (estimated ? " (if every layer is occupied)" : "") + " · base " + len(t, unit) +
        " · relief " + len(Math.max(0, maxZUm - tUm) / 1000, unit) + " · " + p.material.thicknessState + " thickness",
    };

    // pitch (PO-LASER-4/5): before generation, from the fabrication plan
    let pitch;
    if (!plan) {
      pitch = { targetMM: p.geometry.fabPitchMM, actualMM: null, rasterW: null, rasterH: null, mpx: null, capped: null, deviceClass: null,
        budgetPx: null, shortPx: null, reason: null,
        text: "target " + p.geometry.fabPitchMM + " mm/px · choose a source to plan the fabrication raster" };
    } else {
      const g = plan.geometry, targetMM = g.targetPitchUm / 1000, actualMM = r3(g.mmPerPxMax);
      const parts = [];
      if (g.capped === "budget" || g.capped === "budget+source")
        parts.push("capped by the " + g.deviceClass + " pixel budget (" + mpxText(g.pxBudget) + ")");
      if (g.shortPx) parts.push("limited by the source: " + g.shortPx[0] + " × " + g.shortPx[1] + " px short; detail cannot be recovered");
      const reason = parts.length ? parts.join("; ") : "at target";
      pitch = {
        targetMM, actualMM, rasterW: g.rasterW, rasterH: g.rasterH, mpx: Number(((g.rasterW * g.rasterH) / 1e6).toFixed(1)),
        capped: g.capped, deviceClass: g.deviceClass, budgetPx: g.pxBudget, shortPx: g.shortPx ? g.shortPx.slice() : null, reason,
        text: actualMM + " mm/px (target " + targetMM + " mm/px) · " + g.rasterW + " × " + g.rasterH + " px, " +
          mpxText(g.rasterW * g.rasterH) + " · " + reason,
      };
    }

    // page vs machine (PO-LASER-2)
    const m = p.machine;
    let page;
    if (!plan) {
      page = { wMM: null, hMM: null, machine: m ? m.name : null, fits: null, overMM: null,
        text: m ? "page size follows the source · " + m.name : "page size follows the source · no machine profile" };
    } else {
      const wMM = plan.geometry.pageWMM, hMM = plan.geometry.pageHMM, f = D.pageFit(wMM, hMM, m);
      page = { wMM, hMM, machine: m ? m.name : null, fits: f.fits, overMM: f.overMM,
        text: "page " + len(wMM, unit) + " × " + len(hMM, unit) + " · " + (m === null ? "no machine profile (not checked)"
          : (f.fits ? "fits " : "too large by " + len(f.overMM, unit) + " for ") + m.name + " (" + len(m.maxProcessingHeightMM, unit) + " × " +
            len(m.maxLengthMM, unit) + ")") };
    }
    const stockOk = m === null || tUm <= um(m.maxThicknessMM);
    const stock = { ok: stockOk, text: m === null ? "" : (stockOk ? "" : "stock " + len(t, unit) + " is thicker than the " + len(m.maxThicknessMM, unit) + " " + m.name + " accepts") };

    // thresholds (LYR-02): every boundary normalized and in mm
    const thresholds = global.SBHeight.boundaries(N, t).map((b) => ({
      k: b.k, norm: b.norm, mm: b.mm, text: "layer " + b.k + ": " + b.norm.toFixed(3) + " → " + len(r3(b.mm), "mm") + (unit === "in" ? " (" + len(r3(b.mm), "in") + ")" : ""),
    }));
    const thresholdsNote = p.interpretation.mode === "height"
      ? "Nearest-layer rule: each sample goes to the nearest layer level; boundaries lie halfway between levels."
      : "Nearest-layer reference heights; tonal bands follow the tone split (" + p.interpretation.thresholdRule + ").";

    return deepFreeze({ units: unit, layers, z, pitch, page, stock, thresholds, thresholdsNote, disclaimers: [D.COPY.MAT01] });
  };

  /** alpha.3 E8 (PO-PREVIEW-4): the load-time notes for every preflight warning, one line each. */
  D.sourceNotes = function (warnings) {
    if (warnings !== undefined && warnings !== null && !Array.isArray(warnings)) throw dfail("sourceNotes needs an array of diagnostics");
    return (warnings || []).map((d) => {
      let line = global.SBDiag.describe(d).message;
      if (Array.isArray(d.shortPx) && !/px short/.test(line)) line += " (source is " + d.shortPx[0] + " × " + d.shortPx[1] + " px short)";
      return line;
    });
  };

  // ------------------------------------------------------------- ASSEMBLY.md (alpha.3 E13)
  D.COPY_ASSEMBLY = deepFreeze({
    KERF: "no kerf offset applied (kerfMode=external)",
    EDIT: "If you edit these files in your laser software (move, scale, weld, offset or re-join paths), check the result against " +
      "this guide: the geometry was validated as exported, and an edit can break a part, a guide or the stack.",
    SETTINGS: "Cut and score settings are not given here: use your laser software's settings for this material and make a test cut first.",
  });

  const mmText = (v) => String(Number(Number(v).toFixed(3)));
  D.assembly = function (project, snap, opts) {
    if (!project || !project.construction || !snap || !Array.isArray(snap.layers) || !snap.page || !snap.stats)
      throw dfail("assembly needs (project, fabrication snapshot, opts)");
    opts = opts || {};
    const unit = project.units === "in" ? "in" : "mm";
    const L = (v) => len(v, "mm") + (unit === "in" ? " (" + len(v, "in") + ")" : "");
    const colorOf = (i) => (Array.isArray(opts.colors) ? opts.colors[i] : opts.colors) || "";
    const bonded = (snap.construction ? snap.construction.mode : project.construction.mode) === "bonded-relief";
    const pg = snap.page, st = snap.stats, t = snap.construction ? snap.construction.tMM : project.material.thicknessMM;
    const sheets = snap.layers.filter((x) => x.status !== "omitted-trailing");
    const omitted = snap.layers.filter((x) => x.status === "omitted-trailing").map((x) => x.index + 1);
    const file = (x) => "sheet_" + String(x.index + 1).padStart(2, "0") + ".svg";
    const parts = (x) => (Array.isArray(x.parts) ? x.parts.length : 0);
    const title = typeof project.title === "string" && project.title ? project.title : "untitled";
    const m = project.machine, mat = project.material;
    const out = ["# " + title + " — assembly guide", ""];
    out.push("Generated by Shadowbox Studio from the exported fabrication result " + snap.geometryHash.slice(0, 12) +
      " (the same short hash is in the Fabrication review and settings.json)." + (opts.sourceName ? " Source: " + opts.sourceName + "." : ""), "");

    out.push("## The stack", "");
    out.push("- Construction: " + (bonded ? "bonded relief (sheets glued flat, face to face)" : "connected sheets (spaced layers)") + ".");
    out.push("- Artwork " + L(pg.artWMM) + " × " + L(pg.artHMM) + " on a page of " + L(pg.wMM) + " × " + L(pg.hMM) +
      (pg.frameMM > 0 ? ", inside a " + L(pg.frameMM) + " frame ring" : "") + ".");
    out.push("- Material: " + mat.name + ", " + mat.thicknessState + " thickness " + L(t) +
      (mat.thicknessState === "nominal" ? " (measure your stock and enter it if it differs)" : "") + ".");
    const nE = sheets.length;
    const maxZ = Number.isFinite(st.maxZMM) ? st.maxZMM : nE * t;
    // bonded: maxZ = nE·t; connected: maxZ = nE·t + (nE − 1)·g (the gaps are in the stack, there is no "relief above the base")
    const gStack = bonded ? 0 : (snap.construction ? snap.construction.gMM : project.construction.gapMM);
    const how = bonded
      ? nE + " × " + L(t) + ", relief above the base " + L(Math.max(0, maxZ - t))
      : nE + " × " + L(t) + " sheets" + (nE > 1 ? " + " + (nE - 1) + " × " + L(gStack) + " gaps" : "");
    out.push("- Stack height: " + L(maxZ) + " for the " + nE + " exported sheet" + (nE === 1 ? "" : "s") + " (" + how + ")" +
      (nE !== st.requested ? "; if all " + st.requested + " requested layers were cut: stock " + L(st.stockMM) + ", relief " + L(st.reliefMM) : "") + ".");
    out.push("- " + D.COPY.MAT01, "");

    out.push("## Sheets", "");
    if (bonded) {
      out.push("Sheets are listed bottom (base) to top. Only the exported sheets are listed.", "");
      out.push("| File | Layer | Parts | Role | Colour |", "|------|-------|-------|------|--------|");
      sheets.forEach((x, i) => {
        const role = i === 0 ? "base" : i === nE - 1 ? "top" : "layer";
        out.push("| " + file(x) + " | " + (x.index + 1) + " | " + parts(x) + " | " + role + " | `" + colorOf(x.index) + "` |");
      });
    } else {
      out.push("Sheets are listed back to front. Cut each from the suggested colour (or remap freely: proof.svg shows the intended look).", "");
      out.push("| File | Layer | Role | Suggested colour |", "|------|-------|------|------------------|");
      sheets.forEach((x, i) => {
        const role = i === 0 ? "backing (solid)" : i === nE - 1 ? "front" : "mid";
        out.push("| " + file(x) + " | " + (x.index + 1) + " | " + role + " | `" + colorOf(x.index) + "` |");
      });
    }
    out.push("", omitted.length
      ? "Omitted layers (empty at the top of the stack, not exported): " + omitted.join(", ") + "."
      : "No layers were omitted.", "");
    out.push("- " + D.COPY.MAT04, "");

    if (bonded) {
      const gcfg = project.construction.guides || {}, g = snap.guides || { mode: gcfg.mode || "none", labels: [], omitted: [] };
      out.push("## Glue-up order", "");
      out.push("1. Lay " + (nE ? file(sheets[0]) : "sheet 1") + " (the base) on a flat surface, front face up.");
      const onto = g.mode === "inset-outline" ? "onto the scored outlines on the sheet below it"
        : g.mode === "interior-mark" ? "onto the scored crosses on the sheet below it" : "in the positions shown in placement_map.svg";
      out.push("2. Glue each next sheet in file order " + onto + ", front face up. " +
        "Do not mirror or flip any part: every file is drawn as seen from the front.");
      out.push("3. Finish with " + (nE ? file(sheets[nE - 1]) : "the top sheet") + " (the top). Press the stack flat until the glue sets.", "");

      out.push("## Guides and sheet numbers", "");
      if (g.mode === "none") {
        out.push("Guides are off for this project: place the parts of each sheet using placement_map.svg.");
      } else {
        out.push("Guide mode: " + g.mode + ". Concealment inset " + L(gcfg.concealInsetMM) + ", placement allowance " + L(gcfg.allowanceMM) +
          ", score footprint " + L(gcfg.markFootprintMM) + ".");
        out.push(g.mode === "inset-outline"
          ? "The scored outlines on a sheet show where the parts of the next sheet go. They sit inside each part's footprint by the concealment inset, so they are hidden once the next sheet is glued on."
          : "The scored cross on a sheet marks where each part of the next sheet goes (position only: take its rotation from placement_map.svg). It sits inside the part's footprint by the concealment inset, so it is hidden once the next sheet is glued on.");
      }
      if (g.mode === "none") {
        // no guides, no scored sheet numbers (labels are built with the guides, engine stage 14)
        out.push("The sheets carry no scored numbers: keep each cut sheet with its file name. placement_map.svg (not a cut file) shows every sheet's parts in place.");
      } else {
        out.push("The scored number on a sheet is that sheet's own number (sheet_NN). The top sheet has no concealed area and carries no number; placement_map.svg names it.");
        const om = Array.isArray(g.omitted) ? g.omitted : [];
        out.push("", om.length
          ? "Omitted guides (" + om.length + "), place these parts from placement_map.svg:"
          : "No guides were omitted. placement_map.svg (not a cut file) shows every sheet's parts in place.");
        om.forEach((o) => out.push("- layer " + o.layer + (o.part ? ", part " + o.part : "") + (o.reason ? ": " + o.reason : "")));
      }
      out.push("");
    } else {
      const reg = project.construction.registration || {}, holes = snap.layers.some((x) => Array.isArray(x.holes) && x.holes.length > 0);
      const gMM = snap.construction ? snap.construction.gMM : project.construction.gapMM;
      out.push("## Cutting", "");
      out.push("- RED (0.1 mm) strokes are vector cuts; BLUE text is a score/engrave label.");
      out.push("- Import at 1:1: files carry real millimetre units.", "");
      out.push("## Stacking", "");
      out.push(holes
        ? "- Registration holes are " + L(reg.diaMM) + ", centred " + L(pg.frameMM / 2) + " from the frame edges. Run dowels or M" +
          Math.max(2, Math.round(reg.diaMM - 1)) + " bolts through the stack to self-align every layer."
        : "- Registration holes are off; align sheets flush to the frame edges before the glue sets.");
      out.push("- Space the sheets " + mmText(gMM) + " mm apart with spacers (acrylic offcut rings around the dowels work well) for the shadowbox depth shown in the proof.", "");
      out.push("## Bridges", "");
      out.push("Amber regions in the app preview are bridges the tool added so isolated pieces (moons, windows, letter counters) stay attached to the sheet. " +
        "They are " + L(project.construction.bridge.bridgeMM) + " wide. If one bothers you visually, raise the cull threshold or lower the layer count and re-export.", "");
    }

    out.push("## Machine and kerf", "");
    out.push(m ? "- Machine profile: " + m.name + ", processing area " + L(m.maxProcessingHeightMM) + " × " + L(m.maxLengthMM) + "."
      : "- No machine profile: the page size was not checked against a machine.");
    out.push("- Kerf: " + (mat.kerfMode === "external" ? D.COPY_ASSEMBLY.KERF : "kerfMode=" + mat.kerfMode) + "." +
      (m && Number.isFinite(m.kerfMM) ? " The machine profile records a kerf of " + mmText(m.kerfMM) + " mm, for information: set the kerf offset in your laser software." : ""));
    out.push("- " + D.COPY_ASSEMBLY.SETTINGS);
    out.push("- " + D.COPY_ASSEMBLY.EDIT, "");
    return out.join("\n");
  };

  global.SBDocs = D;
})(typeof window !== "undefined" ? window : globalThis);
