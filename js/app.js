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
  const APP_VERSION = "1.1.0";

  // ------------------------------------------------------------------ state
  const PALETTES = {
    "Midnight (Starry Night)": ["#DCEFF7", "#8FC3E4", "#3F7CC0", "#1D3F7E", "#0C1B3D"],
    "Ember": ["#FBE8C8", "#F2B36A", "#D96C2F", "#8C2F1B", "#3B120E"],
    "Forest": ["#EAF2DC", "#A8C97F", "#5E9455", "#2F5D3A", "#122A1C"],
    "Ocean": ["#E4F5F2", "#93D6CC", "#3FA8A0", "#1F6E78", "#0B3142"],
    "Monochrome": ["#F4F4F2", "#C4C6C8", "#8B8F94", "#4A4E55", "#15181D"],
  };

  const state = {
    projectName: "untitled",
    sourceName: null,
    sourceImage: null,   // HTMLImageElement or canvas
    // — cartoonize —
    procRes: 720,        // long-side working resolution, px
    smoothRadius: 4,     // Kuwahara radius, px
    smoothPasses: 2,
    // — layers —
    nSheets: 5,
    thresholdMode: "balanced",
    darkFront: true,
    palette: "Midnight (Starry Night)",
    // — fabrication (all mm) —
    widthMM: 300,
    marginMM: 12,
    minFeatureMM: 1.2,
    bridgeMM: 1.8,
    cullBelowMM2: 9,
    maxBridgeMM: 40,
    holes: true,
    holeDiaMM: 4,
    cornerStyle: "smooth", // smooth | faceted
    detailEps: 0.8,        // RDP epsilon, px
    // — results —
    sheets: [],            // [{mask, bridges, loops, stats}]
    procW: 0, procH: 0,
    report: "",
  };

  let preview = null;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------- pipeline
  const recompute = SBUtil.debounce(runPipeline, 160);

  function runPipeline() {
    if (!state.sourceImage) return;
    const t0 = performance.now();

    // 1. Scale source to working resolution.
    const iw = state.sourceImage.width, ih = state.sourceImage.height;
    const k = state.procRes / Math.max(iw, ih);
    const w = Math.max(32, Math.round(iw * k));
    const h = Math.max(32, Math.round(ih * k));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(state.sourceImage, 0, 0, w, h);
    const rgba = cx.getImageData(0, 0, w, h).data;

    // 2-5. DOM-free engine (T0.5 seam).
    const { sheets, totals } = SBEngine.legacyRun(rgba, w, h, state);
    state.sheets = sheets;
    let totalBridged = totals.bridged, totalCulled = totals.culled, totalCutMM = totals.cutMM;
    state.procW = w; state.procH = h;

    const ms = performance.now() - t0;
    state.report =
      `${w}×${h}px · ${state.nSheets} sheets · ` +
      `${totalBridged} bridged · ${totalCulled} culled · ` +
      `${SBUtil.fmt(totalCutMM / 1000, 2)} m of cuts · ${ms.toFixed(0)} ms`;
    setStatus(state.report);

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
    if (transient && state.report) {
      statusRevertTimer = setTimeout(() => {
        const cur = $("statusline");
        if (cur) cur.textContent = state.report;
      }, 6000);
    }
  }

  // ------------------------------------------------------------- rendering
  function sheetColors() {
    const stops = PALETTES[state.palette];
    const n = state.nSheets;
    // Back sheet = lightest, front = darkest (matches dark-front stacking).
    return Array.from({ length: n }, (_, s) =>
      SBUtil.samplePalette(stops, 1 - (n === 1 ? 0 : s / (n - 1)))
    ).reverse();
  }

  function renderAll() {
    if (!state.sheets.length) return;
    const colors = sheetColors();
    preview.setSheets(state.sheets, colors, state.procW, state.procH);
    renderSheetGrid(colors);
    renderPaletteChips(colors);
  }

  /** The "Layer sheets" tab: one card per sheet with its cut preview + stats. */
  function renderSheetGrid(colors) {
    const grid = $("sheetgrid");
    grid.innerHTML = "";
    state.sheets.forEach((sheet, s) => {
      const card = document.createElement("div");
      card.className = "sheetcard";

      const cvs = document.createElement("canvas");
      const w = state.procW, h = state.procH;
      cvs.width = w; cvs.height = h;
      const c = cvs.getContext("2d");
      // waste = dark bed, material = sheet color, bridges = amber
      c.fillStyle = "#171D24";
      c.fillRect(0, 0, w, h);
      const img = c.getImageData(0, 0, w, h);
      const [r, g, b] = SBUtil.hexToRgb(colors[s]);
      for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        const on = s === 0 || sheet.mask[i];
        if (on) { img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; }
        if (sheet.bridges && sheet.bridges[i]) {
          img.data[p] = 240; img.data[p + 1] = 162; img.data[p + 2] = 39;
        }
      }
      c.putImageData(img, 0, 0);

      const label = document.createElement("div");
      label.className = "sheetlabel";
      const role = s === 0 ? "backing" : s === state.sheets.length - 1 ? "front" : "mid";
      label.innerHTML =
        `<b>SHEET ${s + 1}</b> <span class="muted">${role}</span><br>` +
        (s === 0
          ? `solid panel — frame + holes only`
          : `${sheet.stats.loops} contours · ${SBUtil.fmt(sheet.stats.cutMM / 10, 1)} cm cut` +
            (sheet.stats.bridged ? ` · <span class="amber">${sheet.stats.bridged} bridged</span>` : "") +
            (sheet.stats.culled ? ` · ${sheet.stats.culled} culled` : ""));
      card.append(cvs, label);
      grid.appendChild(card);
    });
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
    const mmPerPx = state.widthMM / state.procW;
    const artH = state.procH * mmPerPx;
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
    state.sheets.forEach((s, i) => {
      const role = i === 0 ? "backing (solid)" : i === state.sheets.length - 1 ? "front" : "mid";
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
    const o = {};
    keep.forEach((k) => (o[k] = state[k]));
    return JSON.stringify(o, null, 2);
  }

  async function exportBundle() {
    if (!state.sheets.length) {
      setStatus("nothing to export yet — load a photo or the demo first", true);
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
      btn.disabled = false;
      btn.dataset.busy = "0";
      btn.textContent = label;
    }
  }

  async function buildAndDeliver() {
    const colors = sheetColors();
    const files = [];
    state.sheets.forEach((sheet, s) => {
      files.push({
        name: `sheet_${String(s + 1).padStart(2, "0")}.svg`,
        data: SBSvg.sheetSVG({
          loops: sheet.loops,
          pxW: state.procW, pxH: state.procH,
          widthMM: state.widthMM, marginMM: state.marginMM,
          holes: state.holes, holeDiaMM: state.holeDiaMM,
          label: `${state.projectName} ${s + 1}/${state.sheets.length}`,
          isBacking: s === 0,
        }),
      });
    });
    files.push({
      name: "proof.svg",
      data: SBSvg.proofSVG(state.sheets, state.procW, state.procH, state.widthMM, colors),
    });
    files.push({ name: "ASSEMBLY.md", data: buildAssemblyMD(colors) });
    files.push({ name: "settings.json", data: settingsJSON() });

    const snap = await preview.snapshot();
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
  function bindRange(id, key, out, fmt = (v) => v) {
    const el = $(id);
    el.value = state[key];
    if (out) $(out).textContent = fmt(state[key]);
    el.addEventListener("input", () => {
      state[key] = parseFloat(el.value);
      if (out) $(out).textContent = fmt(state[key]);
      recompute();
    });
  }

  function bindSelect(id, key) {
    const el = $(id);
    el.value = String(state[key]);
    el.addEventListener("change", () => {
      state[key] = el.type === "checkbox" ? el.checked
        : isNaN(+el.value) ? el.value : +el.value;
      recompute();
    });
  }

  function bindCheck(id, key) {
    const el = $(id);
    el.checked = state[key];
    el.addEventListener("change", () => { state[key] = el.checked; recompute(); });
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
      state.sourceImage = downscaleIfHuge(img);
      state.sourceName = file.name;
      if (state.projectName === "untitled")
        setProjectName(file.name.replace(/\.[^.]+$/, ""));
      runPipeline();
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
    state.projectName = n;
    $("projname").value = n;
  }

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".pane").forEach((p) =>
      p.classList.toggle("active", p.id === "pane-" + name));
    if (name === "stack") preview.redraw();
  }

  function init() {
    preview = SBPreview.create($("stackcanvas"));
    preview.start();

    // header
    $("projname").addEventListener("input", (e) => (state.projectName = e.target.value));
    $("meta-date").textContent = new Date().toISOString().slice(0, 10);

    // photo
    $("filein").addEventListener("change", (e) => {
      if (e.target.files[0]) loadFile(e.target.files[0]);
    });
    $("btn-demo").addEventListener("click", () => {
      state.sourceImage = demoScene();
      state.sourceName = "demo scene";
      if (state.projectName === "untitled") setProjectName("night-over-the-valley");
      runPipeline();
    });
    bindRange("in-res", "procRes", "out-res", (v) => v + " px");
    bindRange("in-smooth", "smoothRadius", "out-smooth", (v) => v + " px");
    bindRange("in-passes", "smoothPasses", "out-passes");

    // layers
    bindRange("in-sheets", "nSheets", "out-sheets");
    bindSelect("in-thmode", "thresholdMode");
    bindCheck("in-darkfront", "darkFront");
    const pal = $("in-palette");
    Object.keys(PALETTES).forEach((k) => {
      const o = document.createElement("option");
      o.value = k; o.textContent = k;
      pal.appendChild(o);
    });
    pal.value = state.palette;
    pal.addEventListener("change", () => { state.palette = pal.value; renderAll(); });

    // fabrication
    bindRange("in-width", "widthMM", "out-width", (v) => v + " mm");
    bindRange("in-margin", "marginMM", "out-margin", (v) => v + " mm");
    bindRange("in-feature", "minFeatureMM", "out-feature", (v) => v + " mm");
    bindRange("in-bridge", "bridgeMM", "out-bridge", (v) => v + " mm");
    bindRange("in-cull", "cullBelowMM2", "out-cull", (v) => v + " mm²");
    bindRange("in-maxbridge", "maxBridgeMM", "out-maxbridge", (v) => v + " mm");
    bindCheck("in-holes", "holes");
    bindRange("in-holedia", "holeDiaMM", "out-holedia", (v) => v + " mm");
    bindSelect("in-corner", "cornerStyle");

    // preview controls
    $("in-explode").addEventListener("input", (e) =>
      preview.setExplode(parseFloat(e.target.value)));
    $("in-bridgesvis").addEventListener("change", (e) =>
      preview.setShowBridges(e.target.checked));

    // tabs
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => switchTab(t.dataset.tab)));

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

    // Start with the demo so the app never opens empty.
    $("btn-demo").click();

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
