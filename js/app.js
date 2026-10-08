/* ============================================================================
 * Shadowbox Studio — app.js
 * ----------------------------------------------------------------------------
 * Orchestration layer: application state, the processing pipeline, UI wiring,
 * the built-in demo scene, and the export bundle.
 *
 * Pipeline (runs debounced whenever a parameter changes):
 *
 *   photo ▶ scale ▶ luminance ▶ Kuwahara ▶ thresholds ▶ nested sheet masks
 *         ▶ per sheet: open/close ▶ specks/holes ▶ ISLANDS (bridge/cull)
 *         ▶ trace ▶ simplify ▶ smooth ▶ stats
 *
 * Everything physical is specified in millimetres and converted to pixels
 * through pxPerMM = workingWidthPx / artworkWidthMM, so "1.5 mm bridges"
 * means 1.5 mm on the laser bed no matter what the preview resolution is.
 * ==========================================================================*/
(function () {
  "use strict";

  // Single source of truth for the visible version. The service worker keeps
  // its own matching cache-version string (sw.js); bump both together on every
  // release so users can confirm at a glance which build they are running.
  const APP_VERSION = "2.0.0-alpha.1";

  // ------------------------------------------------------------------ state
  const PALETTES = {
    "Midnight (Starry Night)": ["#DCEFF7", "#8FC3E4", "#3F7CC0", "#1D3F7E", "#0C1B3D"],
    "Ember": ["#FBE8C8", "#F2B36A", "#D96C2F", "#8C2F1B", "#3B120E"],
    "Forest": ["#EAF2DC", "#A8C97F", "#5E9455", "#2F5D3A", "#122A1C"],
    "Ocean": ["#E4F5F2", "#93D6CC", "#3FA8A0", "#1F6E78", "#0B3142"],
    "Monochrome": ["#F4F4F2", "#C4C6C8", "#8B8F94", "#4A4E55", "#15181D"],
  };

  // G2.11a (PRJ-01): the project (schema v1) is the single source of truth for every setting. The legacy pipeline
  // reads the v1.1.0 view of it through SBSchema.legacyState, and every control writes through SBSchema.applyLegacy
  // (revision + 1 exactly when the geometry changes). Acrylic keeps today's connected tonal behaviour until the
  // G2.11b–e stages expose the plywood/bonded path.
  let project = SBSchema.defaults("acrylic");

  // Runtime only, never saved: the loaded source and the last pipeline result.
  const run = {
    sourceName: null,
    sourceImage: null,   // HTMLImageElement or canvas; null until the user chooses a source (no auto-demo)
    sourceW: 0, sourceH: 0,   // the source's own pixel size (before downscaleIfHuge), for the fabrication raster plan
    revision: -1,        // project revision of the last pipeline run (the dimbar uses its counts only while current)
    sheets: [],          // [{mask, bridges, loops, stats}]
    procW: 0, procH: 0,
    view: null,          // G2.12: {page, layers} canonical polygons of the last run for the review views
    viewToken: 0,        // bumps on every run or re-render; a deferred view build runs only while still current
    viewError: null,     // message when connectedLayers failed for this run (the views fall back to the raster)
    overlays: null,      // G2.13b: SBProof.overlays model of the last run (cleanup changes, bridges) for the proof
    state: null,         // G2.13b (UI-05): SBDiag.STATES value of the shown result; null before the first run
    report: "",
  };

  /** The v1.1.0 settings view of the project (plus the runtime source name), for legacyRun and the exporters. */
  function cfg() {
    const src = run.sourceImage;
    const c = src ? SBSchema.legacyState(project, src.width, src.height) : SBSchema.legacyState(project);
    c.sourceName = run.sourceName;
    return c;
  }

  /** Set one v1.1.0 control on the project. */
  function setLegacy(key, value) {
    project = SBSchema.applyLegacy(project, key, value);
  }

  let preview = null;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------- pipeline
  const regenerateSoon = SBUtil.debounce(regenerate, 160);
  /** A geometry edit: the shown result is stale at once (UI-05), then the pipeline reruns debounced. */
  function recompute() { setRunState({ type: "edit" }); regenerateSoon(); }

  /**
   * G2.13b (UI-05): advance the result state with SBDiag.nextState and show its text badge. Before the first run
   * there is no result, so only "start" moves the state off null (an edit before any result shows nothing).
   */
  function setRunState(event) {
    if (run.state === null && event.type !== "start") return;
    run.state = SBDiag.nextState(run.state || "draft", event);
    const el = $("state-badge");
    if (!el) return;
    const b = SBDiag.stateBadge(run.state);
    el.textContent = b.label;
    el.title = b.text;
    el.setAttribute("aria-label", "Result: " + b.label + ". " + b.text);
    el.dataset.state = b.state;
    el.hidden = false;
  }

  /**
   * Enable Generate when SBSchema.canGenerate allows it and Export only once sheets exist; say why not otherwise
   * (PRJ-01, UI-01). Generate and Export share the one guard (G2.11a/b).
   */
  function updateGate(gate) {
    const gen = $("btn-generate"), whyGen = $("why-generate");
    if (gen) gen.disabled = !gate.ok;
    if (whyGen) { whyGen.textContent = gate.ok ? "" : gate.reason; whyGen.hidden = gate.ok; }
    const btn = $("btn-export"), why = $("why-export");
    if (!btn || btn.dataset.busy === "1") return;
    const blocked = !gate.ok || !run.sheets.length;
    btn.disabled = blocked;
    if (why) { why.textContent = blocked ? (gate.reason || "Generating…") : ""; why.hidden = !blocked; }
  }

  function regenerate() {
    syncControls();
    updateDimbar();
    const gate = SBSchema.canGenerate(project, run.sourceImage);
    if (!gate.ok) {
      updateGate(gate);
      setStatus(gate.reason === "Choose a source" ? "Choose a source: load a photo or the Demo scene" : gate.reason);
      return;
    }
    const state = cfg();
    const t0 = performance.now();

    // 1. Scale source to working resolution.
    const iw = run.sourceImage.width, ih = run.sourceImage.height;
    const k = state.procRes / Math.max(iw, ih);
    const w = Math.max(32, Math.round(iw * k));
    const h = Math.max(32, Math.round(ih * k));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(run.sourceImage, 0, 0, w, h);
    const rgba = cx.getImageData(0, 0, w, h).data;

    // 2-5. DOM-free engine (T0.5 seam). UI-05: processing → draft (the legacy run is draft quality), or failed.
    setRunState({ type: "start" });
    let out;
    try { out = SBEngine.legacyRun(rgba, w, h, state); }
    catch (err) { setRunState({ type: "fail" }); setStatus(`Generation failed: ${err && err.message || err}`); return; }
    const { sheets, totals } = out;
    setRunState({ type: "done", quality: "draft", diagnostics: [] });
    run.sheets = sheets;
    run.view = null;   // G2.12: canonical polygons for Proof/Section/Tilt, rebuilt lazily per run (renderAll)
    run.overlays = null;   // G2.13b: rebuilt with the view
    run.viewError = null;
    run.viewToken++;   // a view build still pending for the previous run is dropped
    let totalBridged = totals.bridged, totalCulled = totals.culled, totalCutMM = totals.cutMM;
    run.procW = w; run.procH = h; run.revision = project.revision;

    const ms = performance.now() - t0;
    run.report =
      `${w}×${h}px · ${state.nSheets} sheet${state.nSheets === 1 ? "" : "s"} · ` +
      `${totalBridged} bridged · ${totalCulled} culled · ` +
      `${SBUtil.fmt(totalCutMM / 1000, 2)} m of cuts · ${ms.toFixed(0)} ms`;
    setStatus(run.report);
    updateGate(gate);
    updateDimbar();

    renderAll();
  }

  /**
   * Write a line to the status bar. Transient messages (exports, errors) show
   * briefly, then the bar reverts to the standing pipeline report so the user
   * isn't left staring at a stale "saved…" string.
   */
  let statusRevertTimer = null;
  function setStatus(text, transient = false) {
    const el = $("statusline");
    if (el) el.textContent = text;
    clearTimeout(statusRevertTimer);
    if (transient && run.report) {
      statusRevertTimer = setTimeout(() => {
        const cur = $("statusline");
        if (cur) cur.textContent = run.report;
      }, 6000);
    }
  }

  // ------------------------------------------------------------- rendering
  function sheetColors() {
    if (project.appearance.mode === "uniform")   // MAT-04: one opaque stock colour for every layer
      return Array.from({ length: project.construction.sheets }, () => project.appearance.color);
    const stops = PALETTES[project.appearance.palette] || PALETTES["Midnight (Starry Night)"];
    const n = project.construction.sheets;
    // Back sheet = lightest, front = darkest (matches dark-front stacking).
    return Array.from({ length: n }, (_, s) =>
      SBUtil.samplePalette(stops, 1 - (n === 1 ? 0 : s / (n - 1)))
    ).reverse();
  }

  /**
   * G2.12: the review views are drawn from the same canonical polygons as the cut files and proof.svg
   * (SBEngine.connectedLayers), built once per pipeline run; appearance changes only re-tint them.
   *
   * KI-CONN-PERF: connectedLayers runs on the main thread and, with smooth corners (the acrylic default), costs
   * about 1.8 s on a simple 720 px draft and about 11 s on a busy one (sharp corners: 0.2–1 s), on top of
   * legacyRun. So the build is deferred: the Layers grid, the chips, the status line and a raster composite of
   * the new masks (preview.setSheets) are shown and painted first, then the polygons replace the raster. A newer
   * run or re-render supersedes a pending build (run.viewToken). The build itself still blocks until G4.1 moves
   * it to a worker. A failure (geometry, or a colour refused with COLOR) is reported in the status line and the
   * views keep the raster composite; it never stops the grid or the chips from updating.
   */
  function renderAll() {
    if (!run.sheets.length) return;
    const colors = sheetColors();
    const token = ++run.viewToken;
    try { renderSheetGrid(colors); renderPaletteChips(colors); }
    catch (err) { setStatus(`${run.report} · layer cards unavailable: ${err.message || err}`); }
    if (run.view) { showView(colors); return; }
    showRaster(colors);
    if (run.viewError) { setStatus(`${run.report} · proof unavailable: ${run.viewError}`); return; }
    setStatus(`${run.report} · building proof geometry…`);
    // Two hops (a frame, then a task) so the browser paints the status and the raster before the build blocks.
    requestAnimationFrame(() => setTimeout(() => buildView(token), 0));
  }

  function buildView(token) {
    if (token !== run.viewToken || run.view || !run.sheets.length) return;   // superseded, or already built
    const t0 = performance.now();
    try {
      const c = cfg();
      run.view = SBEngine.connectedLayers(run.sheets, run.procW, run.procH, c);
      // G2.13b (GEO-08, UI-05): cleanup changes and bridges as cleanupReport-shaped polygons (the generate shape).
      run.overlays = SBProof.overlays({ cleanupReport: SBEngine.legacyCleanupReport(run.sheets, run.procW, run.procH, c),
        diagnostics: [], mode: project.construction.mode });
    } catch (err) {
      run.viewError = String(err && err.message || err);
      setStatus(`${run.report} · proof unavailable: ${run.viewError}`);
      return;
    }
    run.report += ` · proof ${(performance.now() - t0).toFixed(0)} ms`;
    setStatus(run.report);
    showView(sheetColors());
  }

  /** Feed the polygon views; a refused colour (COLOR) or any other failure falls back to the raster composite. */
  function showView(colors) {
    const bonded = project.construction.mode === "bonded-relief";
    try {
      preview.setSnapshot({ page: run.view.page, layers: run.view.layers, tMM: project.material.thicknessMM, gMM: bonded ? 0 : project.construction.gapMM },
        colors);
      preview.setOverlays(run.overlays);   // bridges (tilt and the proof overlay) come from cleanupReport[].bridges
      setStatus(run.report);
      try { renderSheetGrid(colors); }   // G2.13a: the cards now come from the polygon snapshot
      catch (err) { setStatus(`${run.report} · layer cards unavailable: ${err.message || err}`); }
    } catch (err) {
      setStatus(`${run.report} · proof unavailable: ${err.message || err}`);
      showRaster(colors);
      try { renderSheetGrid(colors); } catch (_) { /* the status line already reports the failure */ }   // raster cards
    }
  }

  /** The v1.1.0 raster composite of the current masks (interim view while the polygons build, and the fallback). */
  function showRaster(colors) {
    try { preview.setSheets(run.sheets, colors, run.procW, run.procH); } catch (_) { /* reported by the caller */ }
  }

  /**
   * The "Layers" tab: one card per sheet showing what is retained (material) and what is waste (G2.13a).
   * Once the polygon snapshot is set, each card is drawn from layer.material through the preview's per-snapshot
   * offscreen cache (preview.drawCard: waste hatch, then the cached layer image, no smoothing), so the cards
   * match the Proof, and the label adds SBProof.cards retained/waste mm². Until then (KI-CONN-PERF interim) or
   * when the proof is unavailable, the card falls back to the raster masks over the same waste hatch.
   */
  function renderSheetGrid(colors) {
    const grid = $("sheetgrid");
    grid.innerHTML = "";
    const poly = preview.hasSnapshot() && run.view ? run.view : null;
    const stats = poly ? SBProof.cards(poly.layers, poly.page) : null;
    run.sheets.forEach((sheet, s) => {
      const card = document.createElement("div");
      card.className = "sheetcard";

      const cvs = document.createElement("canvas");
      const layer = poly ? poly.layers.find((l) => l.index === s) : null;
      if (!poly || !preview.drawCard(cvs, layer ? layer.index : s)) rasterCard(cvs, sheet, colors[s], s === 0);
      const st = stats ? stats.find((c) => c.layerIndex === s) : null;
      cvs.setAttribute("role", "img");
      cvs.setAttribute("aria-label", `Sheet ${s + 1}: ` + (st
        ? `${SBUtil.fmt(st.retainedPct, 0)}% retained material, ${SBUtil.fmt(100 - st.retainedPct, 0)}% waste (hatched)`
        : "material in the sheet colour, waste hatched"));

      const label = document.createElement("div");
      label.className = "sheetlabel";
      const role = s === 0 ? "backing" : s === run.sheets.length - 1 ? "front" : "mid";
      label.innerHTML =
        `<b>SHEET ${s + 1}</b> <span class="muted">${role}</span><br>` +
        `<span class="sw sw-retained" style="background:${colors[s]}"></span>retained ` +
        (st ? `${SBUtil.fmt(st.retainedMM2 / 100, 1)} cm² (${SBUtil.fmt(st.retainedPct, 0)}%)` : "") +
        ` · <span class="sw sw-waste"></span>waste` +
        (st ? ` ${SBUtil.fmt(st.wasteMM2 / 100, 1)} cm²` : "") + `<br>` +
        (s === 0
          ? `solid panel — frame + holes only`
          : `${sheet.stats.loops} contours · ${SBUtil.fmt(sheet.stats.cutMM / 10, 1)} cm cut` +
            (sheet.stats.bridged ? ` · <span class="amber">${sheet.stats.bridged} bridged</span>` : "") +
            (sheet.stats.culled ? ` · ${sheet.stats.culled} culled` : ""));
      card.append(cvs, label);
      grid.appendChild(card);
    });
  }

  /** Interim/fallback card from the raster mask: waste hatch (SBPreview.drawWasteHatch), material in the sheet colour, bridges amber. */
  function rasterCard(cvs, sheet, color, solid) {
    const w = run.procW, h = run.procH;
    cvs.width = w; cvs.height = h;
    const c = cvs.getContext("2d");
    SBPreview.drawWasteHatch(c, w, h);
    const img = c.getImageData(0, 0, w, h);
    const [r, g, b] = SBUtil.hexToRgb(color);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      if (solid || sheet.mask[i]) { img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; }
      if (sheet.bridges && sheet.bridges[i]) { img.data[p] = 240; img.data[p + 1] = 162; img.data[p + 2] = 39; }
    }
    c.putImageData(img, 0, 0);
  }

  function renderPaletteChips(colors) {
    const box = $("chips");
    box.innerHTML = "";
    colors.forEach((c, s) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.style.background = c;
      chip.title = `Sheet ${s + 1}: ${c}`;
      box.appendChild(chip);
    });
  }

  // ------------------------------------------------------------- demo scene
  /**
   * A procedural night scene (a nod to the layered Starry Night that started
   * this project) so the tool is testable before any photo is loaded.
   */
  function demoScene() {
    const w = 900, h = 680;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    // sky gradient
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#0a0f2a"); sky.addColorStop(0.65, "#33406e"); sky.addColorStop(1, "#7986b8");
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    // moon + halo
    g.fillStyle = "#f4f0da";
    g.beginPath(); g.arc(700, 130, 52, 0, 7); g.fill();
    g.fillStyle = "rgba(244,240,218,0.35)";
    g.beginPath(); g.arc(700, 130, 86, 0, 7); g.fill();
    // stars (fixed seed pattern)
    g.fillStyle = "#efe9c8";
    for (let i = 0; i < 40; i++) {
      const x = ((i * 733) % w), y = ((i * 397) % (h * 0.5));
      const r = 3 + ((i * 53) % 9);
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // rolling hills, back to front
    const hills = ["#3d4a70", "#2b3554", "#1b2238"];
    hills.forEach((col, i) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) {
        const y =
          h * (0.55 + i * 0.13) +
          Math.sin(x * 0.008 + i * 2.2) * 38 +
          Math.sin(x * 0.021 + i) * 16;
        g.lineTo(x, y);
      }
      g.lineTo(w, h); g.closePath(); g.fill();
    });
    // cypress tree
    g.fillStyle = "#0d1120";
    g.beginPath();
    g.moveTo(150, h);
    for (let y = h; y > 150; y -= 10) {
      const t = (h - y) / (h - 150);
      const wob = Math.sin(y * 0.06) * 14 * (1 - t);
      g.lineTo(150 + wob - 34 * (1 - t) - 6, y);
    }
    g.lineTo(150, 140);
    for (let y = 160; y < h; y += 10) {
      const t = (h - y) / (h - 150);
      const wob = Math.sin(y * 0.06 + 2) * 14 * (1 - t);
      g.lineTo(150 + wob + 34 * (1 - t) + 6, y);
    }
    g.closePath(); g.fill();
    // village
    g.fillStyle = "#141a2e";
    for (let i = 0; i < 7; i++) {
      const x = 380 + i * 62, hw = 22 + (i % 3) * 6, hh = 30 + (i % 4) * 8;
      g.fillRect(x, h - 110 - hh, hw * 2, hh + 40);
      g.beginPath();
      g.moveTo(x - 6, h - 110 - hh); g.lineTo(x + hw, h - 140 - hh); g.lineTo(x + 2 * hw + 6, h - 110 - hh);
      g.closePath(); g.fill();
    }
    // steeple
    g.fillRect(560, h - 260, 26, 160);
    g.beginPath(); g.moveTo(551, h - 260); g.lineTo(573, h - 330); g.lineTo(595, h - 260); g.closePath(); g.fill();
    return c;
  }

  // ------------------------------------------------------------- exporting
  function buildAssemblyMD(colors) {
    const state = cfg();
    const mmPerPx = state.widthMM / run.procW;
    const artH = run.procH * mmPerPx;
    const lines = [
      `# ${state.projectName} — assembly guide`,
      ``,
      `Generated by Shadowbox Studio on ${new Date().toISOString().slice(0, 10)}.`,
      ``,
      `## The stack`,
      ``,
      `Artwork ${SBUtil.fmt(state.widthMM)} × ${SBUtil.fmt(artH)} mm` +
        (state.marginMM > 0 ? ` inside a ${SBUtil.fmt(state.marginMM)} mm frame ring` : ``) + `.`,
      `Sheets are listed back → front. Cut each from the suggested color (or`,
      `remap freely — the proof SVG shows the intended look).`,
      ``,
      `| # | Role | Suggested color | File |`,
      `|---|------|-----------------|------|`,
    ];
    run.sheets.forEach((s, i) => {
      const role = i === 0 ? "backing (solid)" : i === run.sheets.length - 1 ? "front" : "mid";
      lines.push(`| ${i + 1} | ${role} | \`${colors[i]}\` | \`sheet_${String(i + 1).padStart(2, "0")}.svg\` |`);
    });
    lines.push(
      ``,
      `## Cutting`,
      ``,
      `- RED (0.1 mm) strokes are vector cuts; BLUE text is a score/engrave label.`,
      `- Import at 1:1 — files carry real millimetre units.`,
      `- Cut a small test square first and adjust laser kerf in your software if`,
      `  the registration holes come out tight on your dowels.`,
      ``,
      `## Stacking`,
      ``,
      state.holes
        ? `- Registration holes are ${SBUtil.fmt(state.holeDiaMM)} mm, centered ${SBUtil.fmt(state.marginMM / 2)} mm` +
          ` from the frame edges. Run dowels or M${Math.max(2, Math.round(state.holeDiaMM - 1))} bolts through the`
        : `- Registration holes are off; align sheets flush to the frame edges before the`,
      state.holes ? `  stack to self-align every layer.` : `  glue sets.`,
      `- Space sheets with 2–5 mm spacers (acrylic offcut rings around the dowels`,
      `  work perfectly) for the shadowbox depth effect, or laminate them flush`,
      `  for a solid relief.`,
      ``,
      `## Bridges`,
      ``,
      `Amber regions in the app preview are bridges the tool added so isolated`,
      `pieces (moons, windows, letter counters) stay attached to the sheet.`,
      `They are ${SBUtil.fmt(state.bridgeMM)} mm wide. If one bothers you visually, raise the`,
      `cull threshold or lower the layer count and re-export.`,
      ``
    );
    return lines.join("\n");
  }

  function settingsJSON() {
    const keep = [
      "projectName", "sourceName", "procRes", "smoothRadius", "smoothPasses",
      "nSheets", "thresholdMode", "darkFront", "palette", "widthMM", "marginMM",
      "minFeatureMM", "bridgeMM", "cullBelowMM2", "maxBridgeMM", "holes",
      "holeDiaMM", "cornerStyle", "detailEps",
    ];
    const state = cfg(), o = {};
    keep.forEach((k) => (o[k] = state[k]));
    return JSON.stringify(o, null, 2);
  }

  async function exportBundle() {
    if (!run.sheets.length) {
      setStatus("Choose a source: load a photo or the Demo scene", true);
      return;
    }
    const btn = $("btn-export");
    if (btn.dataset.busy === "1") return; // ignore double taps mid-export
    btn.dataset.busy = "1";
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Preparing…";
    setStatus("building cut files…");
    try {
      await buildAndDeliver();
    } catch (err) {
      setStatus(`export failed: ${err.message || err}`, true);
    } finally {
      btn.dataset.busy = "0";
      btn.textContent = label;
      updateGate(SBSchema.canGenerate(project, run.sourceImage));
    }
  }

  async function buildAndDeliver() {
    const colors = sheetColors();
    // G1.7: cut files and proof come from canonical polygons (SBMaterial → layerSVG/assemblySVG):
    // frame unioned with edge art, v1.1.0 corner holes and text label kept, legacy file names.
    const state = cfg();
    const files = SBEngine.connectedFiles(run.sheets, run.procW, run.procH, state, colors);
    files.push({ name: "ASSEMBLY.md", data: buildAssemblyMD(colors) });
    files.push({ name: "settings.json", data: settingsJSON() });

    const snap = await preview.snapshot("proof");   // the bundle image is always the opaque proof, whatever tab is open
    if (snap) files.push({ name: "preview.png", data: new Uint8Array(await snap.arrayBuffer()) });

    const zipName = `${safeName(state.projectName)}_shadowbox.zip`;
    const zipBytes = SBZip.build(files);
    await deliverFile(zipName, zipBytes, "application/zip");
  }

  /**
   * Get a file out of the app across every platform we support.
   *
   * The historical approach — an <a download> synthetic click — is unreliable
   * inside an installed PWA, and on iOS Safari it fails outright: the download
   * attribute is ignored and, in standalone mode, the click can navigate the
   * whole app to the blob URL and lose the session without ever saving a file.
   *
   * Strategy, best option first:
   *   1. Web Share with files — the only dependable "save a file" path on an
   *      installed iOS/Android PWA. Routes the ZIP to the native share sheet
   *      (Save to Files, AirDrop, Messages, etc.).
   *   2. <a download> — works well on desktop browsers, which don't expose
   *      file sharing.
   *   3. Open the blob in a new tab — last resort so the bytes are never
   *      simply lost; the user can save from there.
   *
   * Returns a short human string describing what happened, for the status bar.
   */
  async function deliverFile(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const file = new File([blob], name, { type: mime });

    // 1. Native share sheet (mobile / installed PWA).
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        setStatus(`shared ${name} — choose “Save to Files” to keep it`, true);
        return;
      } catch (err) {
        // A user cancel is not an error; just stop quietly.
        if (err && err.name === "AbortError") { setStatus("export cancelled", true); return; }
        // Otherwise fall through to the download path.
      }
    }

    // 2. Classic download (desktop).
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus(`saved ${name} to your downloads`, true);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    } catch (_) {
      /* fall through */
    }

    // 3. Last resort: surface the bytes in a new tab so nothing is lost.
    window.open(url, "_blank");
    setStatus(`opened ${name} in a new tab — use your browser to save it`, true);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const safeName = (s) => (s.trim() || "untitled").replace(/[^\w\-]+/g, "_").toLowerCase();

  // ------------------------------------------------------------- UI wiring
  // The v1.1.0 controls bound through setLegacy, re-shown by syncControls when another control changes their value (for
  // example a mode change that defaults the frame ring to 0, G2.11d).
  const LEGACY_BOUND = [];
  function syncLegacy() {
    if (!LEGACY_BOUND.length) return;
    const c = cfg();
    for (const b of LEGACY_BOUND) {
      if (document.activeElement === b.el) continue;
      if (b.el.type === "checkbox") b.el.checked = !!c[b.key];
      else b.el.value = String(c[b.key]);
      if (b.out) $(b.out).textContent = b.fmt(c[b.key]);
    }
  }

  function bindRange(id, key, out, fmt = (v) => v) {
    const el = $(id);
    LEGACY_BOUND.push({ el, key, out, fmt });
    const v0 = cfg()[key];
    el.value = v0;
    if (out) $(out).textContent = fmt(v0);
    el.addEventListener("input", () => {
      setLegacy(key, parseFloat(el.value));
      if (out) $(out).textContent = fmt(cfg()[key]);
      recompute();
    });
  }

  /**
   * The fabrication pitch (PO-LASER-4): a number input in mm/px written through SBSchema.applyFabPitch (clamped to
   * SBSchema.FAB_PITCH, 0.001 mm grid). It is geometry, so a change bumps the revision and regenerates; a blank or
   * invalid entry leaves the project unchanged and the field shows the project value again on change.
   */
  function bindPitch() {
    const el = $("in-res"), out = $("out-res");
    const show = () => { if (out) out.textContent = SBUtil.fmt(project.geometry.fabPitchMM, 3) + " mm/px"; };
    el.value = project.geometry.fabPitchMM;
    show();
    el.addEventListener("input", () => {
      const before = project.revision;
      project = SBSchema.applyFabPitch(project, el.value);
      show();
      if (project.revision !== before) recompute();
    });
    el.addEventListener("change", () => { el.value = project.geometry.fabPitchMM; show(); });
  }

  // ------------------------------------------------------- G2.11c control groups
  // Every G2.11c control writes through SBSchema.applyControl (lengths in project.units; invalid → unchanged). A geometry
  // change (revision + 1) regenerates; an appearance, units or view change calls renderAll() only (PRJ-02).
  // The two mode selects are not in CONTROLS: a mode change is reviewed in #dlg-mode before it applies (G2.11e).
  const CONTROLS = ["polarity", "thmode", "manual-th", "thickness", "thickstate", "gap", "units",
    "sizeby", "target", "machine", "m-height", "m-length", "m-matwidth", "m-thick", "m-kerf", "appearance", "color", "explode"];
  const MODE_CONTROLS = { "interp": "interpretation", "construction": "construction" };
  const EXPLODE_MAX_MM = 60;   // the #in-explode range; the preview takes a 0–1 fraction

  function onControl(id, value) {
    const ctx = run.sourceImage ? { srcW: run.sourceW, srcH: run.sourceH } : undefined;
    commitProject(SBSchema.applyControl(project, id, value, ctx), id);
  }

  /** Install a new project from a control: a geometry change (revision + 1) regenerates, anything else re-renders. */
  function commitProject(next, id) {
    const before = project;
    project = next;
    syncControls();
    if (id === "explode") preview.setExplode(Math.min(1, project.view.explodeMM / EXPLODE_MAX_MM));
    if (project.revision !== before.revision) { updateDimbar(); recompute(); }
    else { updateDimbar(); renderAll(); }
  }

  /** Show the project's values in every G2.11c control (SBSchema.controlValues), with the mode's polarity options. */
  function syncControls() {
    const pol = $("in-polarity"), opts = SBSchema.polaritiesFor(project.interpretation.mode);
    if (pol.dataset.mode !== project.interpretation.mode) {
      pol.innerHTML = "";
      const LABEL = { "light-front": "Light tones in front", "dark-front": "Dark tones in front", "white-high": "White is high", "black-high": "Black is high" };
      for (const v of opts) { const o = document.createElement("option"); o.value = v; o.textContent = LABEL[v] || v; pol.appendChild(o); }
      pol.dataset.mode = project.interpretation.mode;
    }
    const vals = SBSchema.controlValues(project);
    for (const id of CONTROLS.concat(Object.keys(MODE_CONTROLS))) {
      const el = $("in-" + id);
      if (el && document.activeElement !== el) el.value = vals["in-" + id];
    }
    const co = $("in-cullon");
    if (co) co.checked = project.construction.bridge.cullEnabled;
    syncLegacy();
    applyApplicability();
    document.querySelectorAll(".u").forEach((u) => { u.textContent = project.units; });
  }

  /**
   * G2.11d (UI-01): every mode-dependent control follows SBSchema.applicability. A control that does not apply is
   * disabled, its row gets .disabled and a .why reason (created on demand, id "why-in-…") that the control names in
   * aria-describedby; the reason is removed again when the control applies.
   */
  function applyApplicability() {
    const ap = SBSchema.applicability(project);
    for (const id of Object.keys(ap)) {
      const el = $(id);
      if (!el) continue;
      const reason = ap[id], row = el.closest(".row"), whyId = "why-" + id;
      el.disabled = reason !== null;
      if (row) row.classList.toggle("disabled", reason !== null);
      let w = $(whyId);
      if (!w && reason !== null && row) { w = document.createElement("p"); w.id = whyId; w.className = "why"; row.appendChild(w); }
      if (w) { w.textContent = reason || ""; w.hidden = reason === null; }
      const tokens = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter((t) => t && t !== whyId);
      if (reason !== null) tokens.push(whyId);
      if (tokens.length) el.setAttribute("aria-describedby", tokens.join(" ")); else el.removeAttribute("aria-describedby");
    }
  }

  // ------------------------------------------------------- G2.11e mode-change review (PRJ-02, AT-21)
  /** A value in the review list: lengths in mm, objects as "key: value" pairs, null as "none". */
  function fmtValue(path, v) {
    if (v === null || v === undefined) return "none";
    if (typeof v === "object") return Object.keys(v).map((k) => k + ": " + fmtValue(k, v[k])).join(", ");
    return typeof v === "number" && /MM$/.test(path) ? v + " mm" : String(v);
  }

  /**
   * Changing #in-interp or #in-construction does not apply at once: the modal #dlg-mode lists
   * SBSchema.modeChangeDiff(project, patch). Accept applies SBSchema.applyModeChange(…, true) (revision + 1);
   * Cancel or Escape leaves the project untouched and restores the select. Focus returns to the select either way.
   */
  function reviewModeChange(id, value) {
    const sel = $("in-" + id), key = MODE_CONTROLS[id], patch = { [key]: { mode: value } };
    const restore = () => { sel.value = project[key].mode; };
    let diff;
    try { diff = SBSchema.modeChangeDiff(project, patch); } catch (e) { restore(); return; }
    if (diff.length === 0) return;
    const dlg = $("dlg-mode"), list = $("dlg-mode-list");
    list.innerHTML = "";
    for (const d of diff) {
      const li = document.createElement("li"), path = document.createElement("span"), what = document.createElement("span");
      const changes = JSON.stringify(d.from) !== JSON.stringify(d.to);
      path.className = "path"; path.textContent = d.path;
      what.textContent = changes ? ": " + fmtValue(d.path, d.from) + " \u2192 " + fmtValue(d.path, d.to) + ". " + d.reason
        : " (kept: " + fmtValue(d.path, d.from) + "). " + d.reason;
      if (!changes) li.className = "note";
      li.append(path, what);
      list.appendChild(li);
    }
    const finish = (accepted) => {
      if (accepted) commitProject(SBSchema.applyModeChange(project, patch, true), id);
      restore();   // the select shows the project's mode (Cancel: the old one)
      sel.focus();
    };
    if (typeof dlg.showModal !== "function") { finish(window.confirm("Apply the " + key + " mode change?")); return; }
    dlg.returnValue = "";
    dlg.addEventListener("close", () => finish(dlg.returnValue === "accept"), { once: true });
    dlg.showModal();
  }

  function bindControls() {
    for (const id of Object.keys(MODE_CONTROLS)) {
      const el = $("in-" + id);
      el.addEventListener("change", () => { if (el.value !== project[MODE_CONTROLS[id]].mode) reviewModeChange(id, el.value); });
    }
    // G2.11d: the bonded cull opt-in (construction.bridge.cullEnabled) is a checkbox
    $("in-cullon").addEventListener("change", (e) => onControl("cullon", e.target.checked));
    for (const id of CONTROLS) {
      const el = $("in-" + id);
      // text and number entries apply on change (a half-typed value is not a geometry change); selects, colour and the
      // explode slider apply as they move
      const live = el.tagName === "SELECT" || el.type === "range" || el.type === "color";
      el.addEventListener(live ? "input" : "change", () => onControl(id, el.value));
      if (!live) el.addEventListener("blur", syncControls);
    }
    syncControls();
  }

  /** "mobile" on a coarse-pointer small screen, else "desktop" (SBSchema.limits budgets, PO-LASER-4). */
  function deviceClass() {
    try {
      const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      return coarse && Math.min(screen.width, screen.height) < 820 ? "mobile" : "desktop";
    } catch (e) { return "desktop"; }
  }

  /**
   * The persistent dimension bar (G2.11c): SBDocs.dimbarModel over the project, the fabrication raster plan (computed
   * before generation from the source size, so a pitch cap or a source shortfall is never silent: PO-LASER-4/5, NFR-04)
   * and the counts of the current pipeline run.
   */
  function updateDimbar() {
    let plan = null, sizeErr = null;
    if (run.sourceImage) {
      try { plan = SBEngine.rasterPlan(project, { w: run.sourceW, h: run.sourceH }, "fabrication", deviceClass()); }
      catch (e) { sizeErr = e.message; }
    }
    const stats = run.sheets.length && run.revision === project.revision
      ? { requested: project.construction.sheets, exported: run.sheets.length, omitted: [] } : null;   // the legacy path exports every sheet
    const m = SBDocs.dimbarModel({ project, plan, stats });
    $("dim-layers").textContent = "Layers: " + m.layers.text;
    $("dim-z").textContent = m.z.text;
    $("dim-pitch").textContent = "Pitch: " + (sizeErr ? sizeErr : m.pitch.text);
    $("dim-page").textContent = sizeErr ? "" : m.page.text;
    $("dim-page").classList.toggle("warn", m.page.fits === false);
    const st = $("dim-stock");
    st.textContent = m.stock.text; st.hidden = m.stock.ok;
    $("dim-thnote").textContent = m.thresholdsNote;
    const list = $("dim-thlist");
    list.innerHTML = "";
    for (const t of m.thresholds) { const li = document.createElement("li"); li.textContent = t.text; list.appendChild(li); }
    if (!m.thresholds.length) { const li = document.createElement("li"); li.textContent = "One sheet: no boundaries"; list.appendChild(li); }
  }

  function bindSelect(id, key) {
    const el = $(id);
    LEGACY_BOUND.push({ el, key, out: null, fmt: String });
    el.value = String(cfg()[key]);
    el.addEventListener("change", () => {
      setLegacy(key, el.type === "checkbox" ? el.checked
        : isNaN(+el.value) ? el.value : +el.value);
      recompute();
    });
  }

  function bindCheck(id, key) {
    const el = $(id);
    LEGACY_BOUND.push({ el, key, out: null, fmt: String });
    el.checked = cfg()[key];
    el.addEventListener("change", () => { setLegacy(key, el.checked); recompute(); });
  }

  function loadFile(file) {
    if (!file.type || !file.type.startsWith("image/")) {
      setStatus("that file isn’t an image", true);
      return;
    }
    setStatus(`loading ${file.name}…`);
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Phone cameras produce very large images (12MP+). Nothing here needs the
    // full sensor resolution — the pipeline works at procRes — so cap the
    // decoded dimensions to keep memory and decode time sane on mobile.
    if ("decoding" in img) img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) {
        setStatus("couldn’t read that image", true);
        return;
      }
      run.sourceW = img.naturalWidth; run.sourceH = img.naturalHeight;
      run.sourceImage = downscaleIfHuge(img);
      run.sourceName = file.name;
      if (project.title === "untitled")
        setProjectName(file.name.replace(/\.[^.]+$/, ""));
      regenerate();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus(`couldn’t load ${file.name} — try a JPG or PNG`, true);
    };
    img.src = url;
  }

  /**
   * If an image is larger than we could ever need, downscale it once into a
   * canvas so every later processing step is cheap. The pipeline resamples to
   * procRes anyway, so this is lossless for our purposes and prevents the
   * out-of-memory stalls large phone photos can cause on iOS.
   */
  function downscaleIfHuge(img, cap = 2000) {
    const big = Math.max(img.naturalWidth, img.naturalHeight);
    if (big <= cap) return img;
    const k = cap / big;
    const w = Math.round(img.naturalWidth * k);
    const h = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c;
  }

  function setProjectName(n) {
    setLegacy("projectName", n);
    $("projname").value = n;
  }

  // G2.12 (UI-02/03): Proof, Section and Tilt share the stack canvas in different preview modes.
  const VIEW_HINTS = {
    proof: "opaque proof: every layer's material, back to front, as in proof.svg",
    section: "stack section at real thickness and gap; drag up/down to move the line",
    tilt: "illustrative: drag the artwork to tilt; explode is display-only",
  };
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
      t.setAttribute("aria-selected", String(t.dataset.tab === name));
    });
    const view = Object.prototype.hasOwnProperty.call(VIEW_HINTS, name);
    document.querySelectorAll(".pane").forEach((p) =>
      p.classList.toggle("active", p.id === "pane-" + (view ? "stack" : name)));
    if (!view) return;
    preview.setMode(name);
    $("tiltnote").hidden = name !== "tilt";
    $("tool-explode").hidden = name !== "tilt";
    $("tool-overlays").hidden = name !== "proof";
    const connected = project.construction.mode === "connected-sheet";
    $("tool-bridges").hidden = !connected || !(name === "tilt" || (name === "proof" && $("in-overlays").checked));
    $("view-hint").textContent = VIEW_HINTS[name];
    preview.redraw();
  }

  function init() {
    preview = SBPreview.create($("stackcanvas"));
    preview.start();

    // header
    $("projname").addEventListener("input", (e) => setLegacy("projectName", e.target.value));
    $("meta-date").textContent = new Date().toISOString().slice(0, 10);

    // photo
    $("filein").addEventListener("change", (e) => {
      if (e.target.files[0]) loadFile(e.target.files[0]);
    });
    // PRJ-01: the demo is an explicit source button; nothing loads it automatically.
    $("btn-demo").addEventListener("click", () => {
      run.sourceImage = demoScene();
      run.sourceW = run.sourceImage.width; run.sourceH = run.sourceImage.height;
      run.sourceName = "demo scene";
      if (project.title === "untitled") setProjectName("night-over-the-valley");
      regenerate();
    });
    // PO-LASER-4 (G2.11b): #in-res is the fabrication pitch in mm/px. The draft raster (720 px) is not a control.
    bindPitch();
    bindRange("in-smooth", "smoothRadius", "out-smooth", (v) => v + " px");
    bindRange("in-passes", "smoothPasses", "out-passes");

    // layers
    bindRange("in-sheets", "nSheets", "out-sheets");
    const pal = $("in-palette");
    Object.keys(PALETTES).forEach((k) => {
      const o = document.createElement("option");
      o.value = k; o.textContent = k;
      pal.appendChild(o);
    });
    pal.value = project.appearance.palette;
    // Appearance only: no revision change, no regeneration (PRJ-02).
    pal.addEventListener("change", () => { setLegacy("palette", pal.value); renderAll(); });

    // G2.11c: control groups, disclaimers (SBDocs.COPY) and the dimension bar
    $("disc-stock").textContent = SBDocs.COPY.MAT01;
    $("disc-palette").textContent = SBDocs.COPY.MAT04;
    $("hint-thickness").textContent = SBDocs.COPY.THICKNESS_HINT;
    bindControls();

    // fabrication
    bindRange("in-margin", "marginMM", "out-margin", (v) => v + " mm");
    bindRange("in-feature", "minFeatureMM", "out-feature", (v) => v + " mm");
    bindRange("in-bridge", "bridgeMM", "out-bridge", (v) => v + " mm");
    bindRange("in-cull", "cullBelowMM2", "out-cull", (v) => v + " mm²");
    bindRange("in-maxbridge", "maxBridgeMM", "out-maxbridge", (v) => v + " mm");
    bindCheck("in-holes", "holes");
    bindRange("in-holedia", "holeDiaMM", "out-holedia", (v) => v + " mm");
    bindSelect("in-corner", "cornerStyle");

    // preview controls (#in-explode is a G2.11c view control: project.view.explodeMM, renderAll only)
    $("in-bridgesvis").addEventListener("change", (e) =>
      preview.setShowBridges(e.target.checked));
    // G2.13b: the Changes overlay on the proof (view only: no revision change, no regeneration)
    $("in-overlays").addEventListener("change", (e) => {
      preview.setShowOverlays(e.target.checked);
      switchTab(preview.getMode());
    });

    // tabs
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => switchTab(t.dataset.tab)));

    // review: the staged Generate control, under the same guard as Export (canGenerate)
    $("btn-generate").addEventListener("click", regenerate);

    // export
    $("btn-export").addEventListener("click", exportBundle);

    // mobile rail toggle
    $("railtoggle").addEventListener("click", () =>
      document.body.classList.toggle("rail-open"));

    // keyboard reachability: tabs are buttons, ranges are native — done.
    window.addEventListener("resize", () => preview.redraw());

    // Show the running version in the title block so a user can confirm which
    // build they have after an update.
    const verEl = $("meta-version");
    if (verEl) verEl.textContent = "v" + APP_VERSION;

    // PRJ-01: open empty. Export stays disabled with "Choose a source" until a photo or the Demo scene is chosen.
    regenerate();

    registerServiceWorker();
    requestPersistentStorage();
  }

  /**
   * Register the offline service worker. Only meaningful over http(s); when the
   * bundle is opened directly from a file:// path the app still runs fully, it
   * just isn't installable — so we register defensively and ignore failures.
   */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol === "file:") return;
    // Local dev hosts: skip the SW so manual checks never run against a cached
    // older shell.
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* offline support unavailable; app still works online */
      });
    });
  }

  /**
   * Ask the browser to make our IndexedDB/cache storage persistent so the OS is
   * less likely to evict the user's work under storage pressure. Best-effort:
   * the prompt may be silently granted, denied, or unsupported.
   */
  function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
