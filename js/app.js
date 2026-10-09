/* ============================================================================
 * Shadowbox Studio — app.js
 * ----------------------------------------------------------------------------
 * Orchestration layer: application state, the processing pipeline, UI wiring,
 * the built-in demo scene, and the export bundle.
 *
 * Pipeline (alpha.3 E5, runs debounced whenever a geometry setting changes):
 *
 *   source (installed once per load: run.src + project.source)
 *     ▶ SBEngine.request(project, run.src, {quality: "draft"}) ▶ SBEngine.generate (draft stage cache)
 *     ▶ run.draft ▶ run.shown ▶ showResult (Proof, Section, Layers, Tilt, overlays, diagnostics, badge)
 *
 * The draft runs the selected interpretation and construction (bonded relief never adds bridges). Export
 * regenerates at fabrication quality through the same request builder. Everything physical is specified in
 * millimetres and converted per raster by the engine, so the draft approximates the cut geometry; the status
 * line says so. The v1.1.0 legacy pipeline (SBEngine.legacy*) is a DEP-04 test oracle only, never called here.
 * ==========================================================================*/
(function () {
  "use strict";

  // Single source of truth for the visible version. The service worker keeps
  // its own matching cache-version string (sw.js); bump both together on every
  // release so users can confirm at a glance which build they are running.
  const APP_VERSION = "2.0.0-alpha.3";

  // ------------------------------------------------------------------ state
  const PALETTES = {
    "Midnight (Starry Night)": ["#DCEFF7", "#8FC3E4", "#3F7CC0", "#1D3F7E", "#0C1B3D"],
    "Ember": ["#FBE8C8", "#F2B36A", "#D96C2F", "#8C2F1B", "#3B120E"],
    "Forest": ["#EAF2DC", "#A8C97F", "#5E9455", "#2F5D3A", "#122A1C"],
    "Ocean": ["#E4F5F2", "#93D6CC", "#3FA8A0", "#1F6E78", "#0B3142"],
    "Monochrome": ["#F4F4F2", "#C4C6C8", "#8B8F94", "#4A4E55", "#15181D"],
  };

  // G2.11a (PRJ-01): the project (schema v1) is the single source of truth for every setting. The v1.1.0 controls and
  // exporters read the v1.1.0 view of it through SBSchema.legacyState, and every such control writes through SBSchema.applyLegacy
  // (revision + 1 exactly when the geometry changes). alpha.3 E7 (PRJ-01, PO-PREVIEW-3): the app starts on the Plywood
  // (bonded) preset; #in-preset switches presets through the #dlg-mode review (SBSchema.presetDiff / applyPreset).
  let project = SBSchema.defaults("plywood");
  let presetName = "plywood";   // the preset #in-preset shows: the last one applied (settings may have been edited since)

  // Runtime only, never saved: the loaded source and the last pipeline result.
  const run = {
    sourceName: null,
    sourceImage: null,   // ImageBitmap or canvas; null until the user chooses a source (no auto-demo)
    sourceW: 0, sourceH: 0,   // the decoded source's own pixel size (never downscaled silently), for the fabrication raster plan
    state: null,         // G2.13b (UI-05): SBDiag.STATES value of the shown result; null before the first run
    focus: null,         // G2.13c: the diagnostics focus shown in the proof ({layer, parts, regions, label}), re-applied per snapshot
    sourceRoute: { format: "png", decode: "canvas-tonal" },   // alpha.2: the source record of the decoded pixels (fabrication request)
    // alpha.3 E1 (LYR-06): the full-size decoded source pixels, read once per load: {pixels, channels: 1|4, w, h, alpha, gen,
    // sampleHash}. project.source is the record of exactly these pixels (installed with them in acceptSource); every
    // engine request is SBEngine.request(project, run.src, …) and runs only while run.src.sampleHash matches it.
    src: null,
    draftCache: { quality: "draft" },   // alpha.3: the caller-owned draft stage cache (E3); reset with every new source
    // alpha.3 E5 (PO-PREVIEW-1): the draft run of SBEngine.generate at quality "draft" in the selected mode, {status,
    // snapshot, diagnostics, error, revision, gen, ms, acks, overlays, lastGood}. Its acks are keyed on its snapshot's geometryHash;
    // a failed draft (no snapshot) keeps the last draft that had one as lastGood, so its acks carry over to the same hash.
    draft: null,
    // alpha.3 E5 (UI-05): the one result every view reads (Proof, Section, Layers, Tilt, overlays, diagnostics, badge,
    // clip dialog), through shown.snapshot only: run.draft or (alpha.3 E6) run.fab. null before the first run.
    shown: null,
    // alpha.2 (LYR-06, EXP-07): the fabrication run, {kind: "fabrication", status, snapshot, diagnostics, error, revision, gen,
    // deviceClass, acks, ms}. Its acks are keyed on the fab snapshot's geometryHash; draft acks (run.draft.acks) never carry over.
    // alpha.3 E6 (PO-PREVIEW-2): made by "Preview at fabrication resolution" or the first Download click and shown in every
    // view (showFab); files are delivered only while it is shown and current; an edit returns the views to the draft.
    fab: null,
    // alpha.3 E8 (PO-PREVIEW-4, NFR-04): the fabrication outlook of the shown draft, {plan, sizeErr, prediction}
    // (fabOutlook); never part of a snapshot, its hash or its acks. null before a source or while a fab result is shown.
    outlook: null,
    report: "",
  };

  /** The v1.1.0 settings view of the project (plus the runtime source name), for the v1.1.0 controls and the exporters. */
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

  // ------------------------------------------------------------- worker pool (speed round F15, PO-PERF-1, NFR-02)
  /**
   * SBPool runs SBEngine.generate off the page: a coordinator worker plus helpers, engine/app version and module-hash
   * handshake, cooperative cancel and a watchdog (F11–F14). The page only submits, shows progress and paints. Without a
   * pool (no Worker, file:// index.html, a refused or version-skewed worker; pool.mode "fallback") the fallback branch
   * (regenerateFallback, fabFallback) runs the sync driver on the page with the pool's "reduced responsiveness" notice.
   */
  let pool = null, poolNotice = null;
  const POOL_FALLBACK_NOTICE = "Background processing is unavailable; the preview runs on the page (reduced responsiveness).";
  function startPool() {
    try {
      if (typeof SBPool === "undefined" || typeof Worker !== "function") throw new Error("no Worker");
      pool = SBPool.create({ deviceClass: deviceClass(), appVersion: APP_VERSION, onState: poolState });
    } catch (_) {
      pool = null;
      poolState({ mode: "fallback", notice: POOL_FALLBACK_NOTICE });
    }
  }
  /** The pool's mode changed: show its fallback notice (#pool-notice and the fabrication note) or clear it. */
  function poolState(st) {
    poolNotice = st && st.mode === "fallback" ? st.notice || POOL_FALLBACK_NOTICE : null;
    const el = $("pool-notice");
    if (el) { el.textContent = poolNotice || ""; el.hidden = !poolNotice; }
    const note = $("fabpreview-note");
    if (note && !fabInFlight) note.textContent = fabNote();
  }
  /** True while runs go to the pool (also while it starts: submits wait in its outbox and fall back with POOL_UNAVAILABLE). */
  function usePool() { return !!pool && (pool.mode === "pool" || pool.mode === "starting"); }

  /**
   * UI-05/NFR-02: the progress bar and stage label of the pooled run ({title, stage, frac} from the pool's progress
   * messages, ≤ 10 Hz), painted at most once per animation frame; null hides it.
   */
  const progress = { want: null, raf: 0 };
  const STAGE_LABELS = { orient: "Preparing the source", domain: "Preparing the source", envelope: "Checking the stock envelope",
    resample: "Resampling", "resample-cached": "Resampling (cached)", interpret: "Interpreting", "interpret-cached": "Interpreting (cached)",
    masks: "Layer masks", construct: "Constructing layers", complexity: "Checking complexity", holes: "Registration holes",
    repairs: "Replaying repairs", parts: "Numbering parts", trace: "Tracing outlines", validate: "Checking support", features: "Checking features",
    guides: "Placement guides", accounting: "Accounting", hashes: "Hashing", done: "Finishing" };
  function showProgress(p) {
    progress.want = p;
    if (!progress.raf) progress.raf = requestAnimationFrame(paintProgress);
  }
  function paintProgress() {
    progress.raf = 0;
    const box = $("run-progress"), bar = $("run-progress-bar"), label = $("run-progress-label"), p = progress.want;
    if (!box) return;
    if (!p) { box.hidden = true; return; }
    const f = Number.isFinite(p.frac) ? Math.max(0, Math.min(1, p.frac)) : null;
    if (bar) { if (f === null) bar.removeAttribute("value"); else bar.value = f; }
    if (label) label.textContent = p.title + ": " + (STAGE_LABELS[p.stage] || p.stage || "starting") + (f === null ? "" : " · " + Math.round(100 * f) + " %");
    box.hidden = false;
  }

  // ------------------------------------------------------------- pipeline
  const regenerateSoon = SBUtil.debounce(regenerate, 300);   // alpha.3 E5: sliders commit on release, so 300 ms
  /**
   * A geometry edit: the shown result is stale at once (UI-05), then the pipeline reruns debounced. alpha.3 E6 (UI-06):
   * a fabrication result on screen belongs to the previous revision, so the view returns to the (Stale) draft at once.
   * Speed round F15: a fabrication run still in flight is canceled; it restarts on the edited revision after its draft.
   */
  function recompute() {
    cancelFab("restart");   // speed round F15 (UI-06): an edit cancels an in-flight fabrication run ("fabrication restarted")
    setRunState({ type: "edit" });
    if (run.shown === run.fab) showDraft();
    regenerateSoon();
  }

  /**
   * alpha.3 E6 (PO-PREVIEW-2): show the fabrication result in every view (Proof, Section, Layers, Tilt, overlays, the
   * diagnostics panel with navigable items, the badge, the clip dialog). A new geometry clears the diagnostics focus.
   */
  function showFab() {
    if (!run.fab) return;
    if (run.shown !== run.fab) run.focus = null;
    run.shown = run.fab;
    const f = run.fab;   // the badge is the fabrication result's own state (validated, or failed with a blocking item)
    showRunState(f.status === "done" && f.snapshot ? SBDiag.nextState("processing", { type: "done", quality: "fabrication", diagnostics: f.snapshot.diagnostics }) : "failed");
    showResult(run.fab);
    renderFabReview();
  }

  /** alpha.3 E6 (UI-06): leave the fabrication result for the draft (an edit or a new source); its next run replaces it. */
  function showDraft() {
    if (!run.draft || run.shown === run.draft) return;
    run.focus = null;
    run.shown = run.draft;
    showResult(run.shown);
    renderFabReview();
  }

  /**
   * G2.13b (UI-05): advance the result state with SBDiag.nextState and show its text badge. Before the first run
   * there is no result, so only "start" moves the state off null (an edit before any result shows nothing).
   */
  function setRunState(event) {
    if (run.state === null && event.type !== "start") return;
    showRunState(SBDiag.nextState(run.state || "draft", event));
  }

  /** Set run.state and its badge directly (a canceled draft restores the state it started from; null hides the badge). */
  function showRunState(state) {
    run.state = state;
    const el = $("state-badge");
    if (!el) return;
    if (state === null) { el.hidden = true; return; }
    const b = SBDiag.stateBadge(run.state);
    // alpha.3 E8 (UI-05): a draft whose fabrication prediction is over a cap says so on the badge; it is never Ready
    const risk = run.state === "draft" && run.outlook && run.outlook.prediction && run.outlook.prediction.over.length > 0;
    const text = b.text + (risk ? " The fabrication result will likely exceed the complexity cap; see Fabrication resolution in the diagnostics." : "");
    el.textContent = b.label + (risk ? " \u00B7 over cap" : "");
    el.title = text;
    el.setAttribute("aria-label", "Result: " + el.textContent + ". " + text);
    el.dataset.state = b.state;
    if (risk) el.dataset.fabRisk = "over"; else delete el.dataset.fabRisk;
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
    // alpha.3 E6: "Preview at fabrication resolution" needs an installed source; it is done while the current fab result is shown
    const fp = $("btn-fabpreview"), fabShown = run.shown === run.fab && fabCurrent();
    if (fp && fp.dataset.busy !== "1") {
      fp.disabled = !gate.ok || !run.src || fabShown;
      fp.textContent = fabShown ? "Showing the fabrication result" : "Preview at fabrication resolution";
    }
    const btn = $("btn-export"), why = $("why-export");
    if (!btn || btn.dataset.busy === "1") return;
    const shown = run.shown && run.shown.snapshot;
    const blocked = !gate.ok || !shown;
    const failedNoun = run.shown === run.fab ? "The fabrication run" : "The draft";
    let disabled = blocked, text = blocked ? (gate.reason || (run.shown && run.shown.status === "error"
      ? failedNoun + " failed (" + (run.shown.error ? run.shown.error.code : run.shown.status) + "); change the settings" : "Generating…")) : "";
    if (!blocked && !fabShown) text = "Download first shows the fabrication result for review; the next click saves exactly what is on screen";
    if (!blocked && fabCurrent()) {
      // alpha.2 (EXP-07): the fabrication review of this revision decides; a blocking item disables Export.
      const g = fabGate(), f = run.fab;
      if (f.status !== "done") { disabled = true; text = "The fabrication run failed (" + (f.error ? f.error.code : f.status) + "); change the settings and export again"; }
      else if (g.reason === "BLOCKING") { disabled = true; text = "Fabrication review: " + g.blocking.length + " blocking issue" + (g.blocking.length === 1 ? "" : "s") + "; export is disabled until they are fixed"; }
      else if (g.reason === "UNACKED") text = "Acknowledge " + g.unacked.length + " warning" + (g.unacked.length === 1 ? "" : "s") + " in the fabrication review, then download";
    }
    btn.disabled = disabled;
    if (why) { why.textContent = text; why.hidden = !text; }
  }

  /**
   * alpha.3 E5 (PO-PREVIEW-1, LYR-06, UI-05): the draft is SBEngine.request at quality "draft" in the selected
   * interpretation and construction, on the installed source record and its own pixels (the same builder as the
   * fabrication run). Speed round F15 (PO-PERF-1, NFR-02): it runs in the worker pool (pool.submit; the coordinator keeps
   * the draft stage cache), with the Stale/Processing state, the "Updating draft…" veil and the progress bar on the
   * still-visible previous result; the page stays responsive. A result is shown only when SBDiag.acceptResult matches the
   * run this call submitted (AT-15) and the revision and source are still current; a newer submit supersedes (cancels)
   * the older run. Without a pool (pool.mode "fallback", or POOL_UNAVAILABLE) the fallback branch runs the sync driver
   * (regenerateFallback). Draft acks survive only when the new snapshot has the same geometryHash (§9.5, applyDraft).
   */
  let draftToken = 0, draftRun = null, draftRerun = false;
  function regenerate() {
    syncControls();
    updateDimbar();
    renderFabReview();   // alpha.2: a fabrication review of an older revision or source is hidden (it is not current)
    const gate = SBSchema.canGenerate(project, run.sourceImage);
    if (!gate.ok) {
      draftToken++;   // a pending draft of the previous settings is dropped
      cancelDraft();
      showProgress(null);
      setVeil(false);
      updateGate(gate);
      setStatus(gate.reason === "Choose a source" ? "Choose a source: load a photo or the Demo scene" : gate.reason);
      return;
    }
    // alpha.3 E1: the pixels and the record they run under always belong together
    if (!run.src || !project.source || run.src.sampleHash !== project.source.sampleHash) return;
    const token = ++draftToken, gen = run.src.gen, rev = project.revision, stateBefore = run.state;
    setRunState({ type: "start" });
    setVeil(true);
    setStatus("Updating draft…");
    if (!usePool()) { regenerateFallback(token, gen, rev, stateBefore, gate); return; }
    // one run at a time in the coordinator (F.3): a fabrication run in flight is canceled and restarted after this draft
    cancelFab("restart");
    const dc = deviceClass(), withOverlays = wantOverlays(), t0 = performance.now(), sampleHash = run.src.sampleHash;
    const ctx = { gen, rev, stateBefore, gate, withOverlays, t0 };
    let sub;
    try {
      pool.setSource(run.src);   // posted once per sampleHash
      // F-D5: the pooled draft keeps the request's default draftCapPx (limits(dc).draftPxCap, the pooled decision)
      sub = pool.submit(SBEngine.request(project, run.src, { quality: "draft", requestId: "draft-" + rev, deviceClass: dc }),
        { sampleHash, gen, overlays: withOverlays, onProgress: (p) => { if (token === draftToken && !fabInFlight) showProgress(Object.assign({ title: "Draft" }, p)); } });
    } catch (err) {   // a caller error (ENGINE_ARG from SBEngine.request)
      applyDraft(errorResponse(err, "ENGINE_ARG"), ctx);
      return;
    }
    const active = draftRun = { runId: sub.runId, gen, sampleHash, overlays: withOverlays, deviceClass: dc };
    sub.done.then((result) => {
      if (draftRun === active) draftRun = null;
      if (token !== draftToken || !SBDiag.acceptResult(active, result)) return;   // AT-15: stale or superseded, never shown
      // superseded by a fabrication submit: the fabrication run owns the veil; this draft reruns after it
      if (result.status === "canceled" && fabInFlight) { draftRerun = true; return; }
      applyDraft(result.status === "canceled" ? { status: "canceled" } : result.response, ctx);
    }, (err) => {
      if (draftRun === active) draftRun = null;
      if (token !== draftToken) return;
      // the pool fell back (no worker, a refused or version-skewed worker): the serial fallback runs this draft
      if (err && err.code === "POOL_UNAVAILABLE") { regenerateFallback(token, gen, rev, stateBefore, gate); return; }
      applyDraft(errorResponse(err, "ENGINE_INTERNAL"), ctx);
    });
  }

  /**
   * Speed round F15 fallback branch (no pool: file:// index.html, a refused or version-skewed worker): the sync driver
   * SBEngine.generate on the page with the caller-owned draft stage cache, at limits(dc).draftPxFallback (F-D5). The
   * Stale/Processing state and the veil are painted first (a frame, then a task), because the run blocks the page. A run
   * superseded meanwhile (new source, new revision, newer call) is dropped.
   */
  function regenerateFallback(token, gen, rev, stateBefore, gate) {
    if (poolNotice) setStatus("Updating draft… (" + poolNotice + ")");
    requestAnimationFrame(() => setTimeout(() => {
      if (token !== draftToken) return;   // a newer call owns the veil and the run
      if (!run.src || gen !== run.src.gen || rev !== project.revision || !project.source || run.src.sampleHash !== project.source.sampleHash) {
        setVeil(false);   // superseded by an edit or a new source; their own regenerate follows
        return;
      }
      const dc = deviceClass(), withOverlays = wantOverlays(), t0 = performance.now();
      let res;
      try {
        res = SBEngine.generate(SBEngine.request(project, run.src, { quality: "draft", requestId: "draft-" + rev, deviceClass: dc,
          draftCapPx: SBSchema.limits(dc).draftPxFallback }), { cache: run.draftCache, overlays: withOverlays });
      } catch (err) {   // a caller error (SOURCE_MISMATCH, CACHE_QUALITY); generate itself never throws
        res = errorResponse(err, "ENGINE_ARG");
      }
      applyDraft(res, { gen, rev, stateBefore, gate, withOverlays, t0 });
    }, 0));
  }

  /** A thrown caller or pool error as an engine response ({status: "error", error: {code, message}, diagnostics: []}). */
  function errorResponse(err, code) {
    return { status: "error", error: { code: (err && err.code) || code, message: (err && err.message) || String(err) }, diagnostics: [] };
  }

  /**
   * Speed round F15: the one draft result path of both drivers. A result of a revision or source that changed meanwhile
   * is dropped (the edit's own regenerate follows); a canceled run keeps the previous result and the state it started
   * from (it did not fail). Draft acks carry over only to the same geometryHash. A fabrication run canceled by an edit
   * ("fabrication restarted") runs again once this draft of the new revision is in.
   */
  function applyDraft(res, c) {
    showProgress(null);
    setVeil(false);
    if (!run.src || c.gen !== run.src.gen || c.rev !== project.revision) return;
    if (res.status === "canceled") { showRunState(c.stateBefore); showResult(run.shown); return; }
    // alpha.3 E6 (UI-06): the current fabrication result of this revision stays on screen when a draft of the same
    // revision finishes after it (an edit's debounced draft overtaken by a "Preview at fabrication resolution" click)
    const keepFab = run.shown === run.fab && fabCurrent();
    // acks carry over from the last draft that had a snapshot (a failed draft in between keeps them, lastGood)
    const prev = run.draft, snap = res.snapshot || null, base = prev && prev.snapshot ? prev : (prev && prev.lastGood) || null;
    const acks = base && snap && base.snapshot.geometryHash === snap.geometryHash ? base.acks : new Set();
    if (!keepFab && (!snap || !prev || !prev.snapshot || prev.snapshot.geometryHash !== snap.geometryHash)) run.focus = null;
    run.draft = { status: res.status, snapshot: snap, diagnostics: (snap ? snap.diagnostics : res.diagnostics) || [], error: res.error || null,
      revision: c.rev, gen: c.gen, ms: performance.now() - c.t0, acks, overlays: c.withOverlays, lastGood: snap ? null : base };
    if (keepFab) { showRunState(c.stateBefore); setStatus(run.report); updateGate(c.gate); }
    else {
      if (res.status === "done") setRunState({ type: "done", quality: "draft", diagnostics: snap.diagnostics });
      else setRunState({ type: "fail" });
      run.shown = run.draft;
      showResult(run.shown);
      updateGate(c.gate);
    }
    if (fabRestart) { fabRestart = false; previewFabrication(); }   // UI-06: "fabrication restarted" on the edited revision
    if (benchDraftHook) benchDraftHook(res, c);   // speed round F16a: ?bench=draft waits for this draft
  }

  /** Cancel the pooled draft in flight, if any (its canceled result is dropped by draftToken). */
  function cancelDraft() {
    if (draftRun && pool) pool.cancel(draftRun.runId);
    draftRun = null;
  }

  /** The draft change-overlay polygons are built only while the Changes overlay (#in-overlays) is on (E4: ≥ 15 % of construct). */
  function wantOverlays() {
    const el = $("in-overlays");
    return !!(el && el.checked);
  }

  /** The "Updating draft…" veil: the previous result stays visible, dimmed, while a draft runs (UI-05). */
  function setVeil(on) {
    const c = $("stackcanvas");
    if (c) { c.style.opacity = on ? "0.55" : ""; c.setAttribute("aria-busy", on ? "true" : "false"); }
    const g = $("sheetgrid");
    if (g) g.style.opacity = on ? "0.55" : "";
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
  /** The appearance colours (a view setting, PRJ-02) for n layers, indexed by layer index (back = 0). */
  function sheetColors(n) {
    if (project.appearance.mode === "uniform")   // MAT-04: one opaque stock colour for every layer
      return Array.from({ length: n }, () => project.appearance.color);
    const stops = PALETTES[project.appearance.palette] || PALETTES["Midnight (Starry Night)"];
    // Back sheet = lightest, front = darkest (matches dark-front stacking).
    return Array.from({ length: n }, (_, s) =>
      SBUtil.samplePalette(stops, 1 - (n === 1 ? 0 : s / (n - 1)))
    ).reverse();
  }

  /**
   * alpha.3 E5 (UI-05, PO-PREVIEW-1): render every view from one result r (run.shown) and only from r.snapshot: the
   * Proof, Section and Tilt (preview.setSnapshot with the snapshot's own page, layers, thickness and gap), the change
   * overlays in the snapshot's own construction mode (bridges only in connected mode, from cleanupReport), the Layers
   * cards, the chips, the diagnostics, the dimbar and the status line. A stale result kept on screen after an edit is
   * therefore drawn with its own settings, never the edited project's. A failed result (no snapshot) leaves the
   * previous picture in place and lists its diagnostics. Appearance changes call this again (no regeneration).
   */
  function showResult(r) {
    if (!r) return;
    const snap = r.snapshot;
    let note = "";
    if (snap) {
      const colors = sheetColors(snap.layers.length);
      try {
        preview.setSnapshot({ page: snap.page, layers: snap.layers, tMM: snap.construction.tMM, gMM: snap.construction.gMM }, colors);
        preview.setOverlays(SBProof.overlays({ cleanupReport: snap.cleanupReport, diagnostics: snap.diagnostics, mode: snap.construction.mode }));
        if (run.focus) { try { preview.setFocus(run.focus); } catch (_) { run.focus = null; } }   // G2.13c: a new snapshot clears the focus
      } catch (err) {
        note += " · proof unavailable: " + (err.message || err);
      }
      try { renderSheetGrid(r, colors); renderPaletteChips(colors); }
      catch (err) { note += " · layer cards unavailable: " + (err.message || err); }
    } else if (!run.focus) {
      try { preview.setFocus(null); } catch (_) { /* nothing shown */ }   // a failed run keeps the picture, not its focus
    }
    run.outlook = r === run.shown ? fabOutlook(r) : run.outlook;
    if (run.state !== null) showRunState(run.state);   // E8: the badge reflects the fabrication prediction
    renderDiagnostics(r);
    updateDimbar();
    run.report = statusText(r) + note;
    setStatus(run.report);
  }

  /** The standing status line of a result: the draft is approximate; a fabrication result names its geometryHash. */
  function statusText(r) {
    if (r.status !== "done" || !r.snapshot) {
      return "Generation failed: " + (r.error ? r.error.code + ", " + r.error.message : r.status) +
        (preview.hasSnapshot() ? " (the previous result is still shown)" : "");
    }
    const s = r.snapshot, g = s.geometry, n = s.stats.exported, sec = (r.ms / 1000).toFixed(1);
    const head = `${g.rasterW} × ${g.rasterH} px · ${g.mmPerPxMax.toFixed(2)} mm/px · ${n} sheet${n === 1 ? "" : "s"} · ${sec} s`;
    if (s.quality === "fabrication") return `Fabrication · ${head} · ${s.geometryHash.slice(0, 12)}`;
    let t = `Draft (approximate; Preview at fabrication resolution for the exact cut) · ${head}`;
    if (s.construction.mode === "connected-sheet") {
      const bridged = s.cleanupReport.reduce((a, c) => a + (c.bridged || 0), 0), culled = s.cleanupReport.reduce((a, c) => a + (c.culled || 0), 0);
      const cutMM = s.layers.reduce((a, L) => a + (L.stats ? L.stats.cutMM : 0), 0);
      t += ` · ${bridged} bridged · ${culled} culled · ${SBUtil.fmt(cutMM / 1000, 2)} m of cuts`;
    }
    return t;
  }

  // ------------------------------------------------------- diagnostics (G2.13c: UI-04, NFR-07, §9.5)

  /**
   * alpha.3 E8 (PO-PREVIEW-4, GEO-06, NFR-04): the fabrication raster plan at the loaded source size (shared with the
   * dimbar) and, for a draft result with a snapshot, SBProof.predictFabComplexity against the device caps.
   * → {plan, sizeErr, prediction} or null (no source, or a fabrication result is shown: that run checks the real caps).
   */
  function fabPlanNow() {
    if (!run.sourceImage) return { plan: null, sizeErr: null };
    try { return { plan: SBEngine.rasterPlan(project, { w: run.sourceW, h: run.sourceH }, "fabrication", deviceClass()), sizeErr: null }; }
    catch (e) { return { plan: null, sizeErr: e.message }; }
  }
  function fabOutlook(r) {
    if (!r || r === run.fab || !run.sourceImage) return null;
    const o = fabPlanNow();
    let prediction = null;
    if (o.plan && r.snapshot && r.snapshot.quality === "draft") {
      try { prediction = SBProof.predictFabComplexity(r.snapshot, o.plan.geometry, SBSchema.limits(deviceClass())); }
      catch (_) { prediction = null; }   // a snapshot without geometry predicts nothing
    }
    return { plan: o.plan, sizeErr: o.sizeErr, prediction };
  }

  /**
   * The diagnostics panel: a summary line (SBDiag.summarize) and the list grouped by severity, each group headed by a
   * badge with a glyph icon (aria-hidden) and the severity in text. Each item (SBDiag.describe) shows where, what, the
   * measured value against the limit and the fix. An item with a layer is a <button> (click, Enter or Space) that
   * switches to the Proof and focuses that layer, its parts and region (preview.setFocus). Warnings carry an
   * "Acknowledge" checkbox keyed by SBDiag.ackKey on the shown result's snapshot.geometryHash (r.acks), so an ack never
   * outlives the snapshot; blocking items have none (§9.5). Draft acks never gate the export: it is gated by the
   * fabrication result's own acks (run.fab.acks), listed here when run.fab is shown and in the fabrication review
   * (renderFabReview, scope "fabrication") through this same renderer (alpha.3 E6).
   * alpha.3 E5 (UI-04): r is the shown result (default run.shown). A failed run (status "error", e.g. COMPLEXITY_LIMIT
   * with no layers) lists r.diagnostics under "No layers: …"; its items are not navigable (the Proof still shows the
   * previous result) and carry no acknowledgement.
   */
  function renderDiagnostics(r, opts) {
    const fabScope = !!(opts && opts.scope === "fabrication");   // alpha.3 E6: the fabrication review (#fab-review)
    r = r || (fabScope ? null : run.shown);
    if (!fabScope) renderRepairs();
    const list = $(fabScope ? "fab-list" : "diag-list"), sum = $(fabScope ? "fab-summary" : "diag-summary");
    if (!list || !sum) return;
    list.textContent = "";
    if (!fabScope) $("diag-clear").hidden = !run.focus;
    if (!r) { sum.textContent = "Generate to check the layers"; return; }
    // alpha.3 E8 (PO-PREVIEW-4, NFR-04): a draft lists the fabrication plan's diagnostics and the predicted complexity
    // overflow first, in a "Fabrication resolution" group that is not acknowledged here (only in the Fabrication review)
    const planGroup = fabScope ? null : SBProof.panelModel(r, run.outlook && run.outlook.plan ? run.outlook.plan.diagnostics : [],
      run.outlook ? run.outlook.prediction : null).groups.find((g) => g.title === "Fabrication resolution") || null;
    if (planGroup) list.appendChild(renderPlanGroup(planGroup));
    const planSum = planGroup ? " Fabrication resolution: " + planGroup.items.length + " item" + (planGroup.items.length === 1 ? "" : "s") + " (listed first; acknowledged in the Fabrication review)." : "";
    const failed = r.status === "error" || !r.snapshot;
    // alpha.3 E6: items navigate (switch to the Proof and focus) only on the result the views show
    const onScreen = !failed && r === run.shown;
    const diags = (failed ? r.diagnostics : r.snapshot.diagnostics) || [], groups = SBDiag.summarize(diags);
    const hash = failed ? null : r.snapshot.geometryHash, what = failed ? "" : " in this " + r.snapshot.quality + " result.";
    const noun = (g) => (g.severity === "warning" ? (g.count === 1 ? "warning" : "warnings") : g.label.toLowerCase());
    const head = fabScope && !failed ? `Fabrication result ${r.snapshot.geometryHash.slice(0, 12)} at ${r.snapshot.geometry.rasterW} × ${r.snapshot.geometry.rasterH} px` +
      ` (${(r.ms / 1000).toFixed(1)} s)` + (onScreen ? "" : ", not on screen: Download shows it first") + ": " : "";
    if (failed) {
      sum.textContent = (fabScope ? "The fabrication run failed: " : "No layers: ") + (r.error ? r.error.code + ", " + r.error.message : "the run did not finish") +
        (groups.length ? " (" + groups.map((g) => g.count + " " + noun(g)).join(", ") + ")." : ".") + planSum;
    } else if (!groups.length) { sum.textContent = head + "No issues found" + what + planSum; return; }
    else {
      const acked = diags.filter((d) => SBDiag.describe(d).severity === "warning" && r.acks.has(SBDiag.ackKey(d, hash))).length;
      sum.textContent = head + groups.map((g) => g.count + " " + noun(g) + (g.severity === "warning" && acked ? " (" + acked + " acknowledged)" : "")).join(", ") + what + planSum;
    }
    for (const g of groups) {
      const li = document.createElement("li");
      li.className = "diag-group";
      const gh = document.createElement("div");
      gh.className = "diag-head";
      gh.appendChild(badge(g.severity, g.icon, g.label));
      gh.appendChild(document.createTextNode(String(g.count)));
      li.appendChild(gh);
      const ul = document.createElement("ul");
      li.appendChild(ul);
      diags.forEach((d) => {
        const it = SBDiag.describe(d);
        if (it.severity !== g.severity) return;
        ul.appendChild(diagItem(d, onScreen ? it : Object.assign({}, it, { navigable: false }), failed ? null : r, onScreen));
      });
      list.appendChild(li);
    }
  }

  /**
   * alpha.3 E8: the draft panel's "Fabrication resolution" group (SBProof.panelModel): a heading with its note, then
   * each item through diagItem with no result (no acknowledgement) and not navigable (it is about the fabrication run).
   */
  function renderPlanGroup(g) {
    const li = document.createElement("li");
    li.className = "diag-group diag-plan";
    const gh = document.createElement("div");
    gh.className = "diag-head";
    gh.appendChild(document.createTextNode(g.title + " (" + g.items.length + ")"));
    li.appendChild(gh);
    if (g.note) { const n = document.createElement("p"); n.className = "diag-fix"; n.textContent = g.note + "."; li.appendChild(n); }
    const ul = document.createElement("ul");
    for (const d of g.items) ul.appendChild(diagItem(d, Object.assign({}, SBDiag.describe(d), { navigable: false }), null, false));
    li.appendChild(ul);
    return li;
  }

  /** alpha.3 E6: after an acknowledgement on r, re-render every panel that lists r (the panel and, for run.fab, the review). */
  function refreshDiagnostics(r) {
    if (r === run.shown) renderDiagnostics(r);
    if (r === run.fab) renderFabReview();
  }

  /** A severity badge: glyph icon (aria-hidden) plus the severity label in text. */
  function badge(severity, icon, label) {
    const b = document.createElement("span");
    b.className = "badge";
    b.dataset.sev = severity;
    const i = document.createElement("span");
    i.setAttribute("aria-hidden", "true");
    i.textContent = icon;
    b.appendChild(i);
    b.appendChild(document.createTextNode(label));
    return b;
  }

  /**
   * One diagnostics item; r is the result whose snapshot it belongs to (null: no acknowledgement, failed run); onScreen:
   * r is the shown result (repair actions are offered only there).
   */
  function diagItem(d, it, r, onScreen) {
    const li = document.createElement("li");
    li.className = "diag-item";
    li.dataset.diagId = d.id || "";
    const go = it.navigable ? document.createElement("button") : document.createElement("div");
    go.className = "diag-go";
    if (it.navigable) {
      go.type = "button";
      go.title = "Show " + it.where + " in the Proof";
      go.addEventListener("click", () => focusDiagnostic(d, it, li));
    }
    go.appendChild(badge(it.severity, it.icon, it.severityLabel));
    const add = (cls, text) => { if (!text) return; const s2 = document.createElement("span"); s2.className = cls; s2.textContent = text; go.appendChild(s2); };
    add("diag-where", it.where);
    add("diag-msg", it.message);
    add("diag-measure", it.measure);
    li.appendChild(go);
    const fix = document.createElement("p");
    fix.className = "diag-fix";
    fix.textContent = "Fix: " + it.fix;
    li.appendChild(fix);
    // alpha.3 E12 (PO-PREVIEW-6): a draft clip replayed on the fabrication result is re-reviewed there (Show, Keep, Revert)
    // in every panel that lists run.fab, also while the draft is on screen; other repair actions only on the shown result
    const fabRepair = !!(r && r.snapshot) && r === run.fab && d.code === "REPAIR_REVIEW_FAB";
    const act = fabRepair ? fabRepairActions(d, it) : onScreen ? clipAction(d) : null;
    if (act) li.appendChild(act);
    if (it.severity === "warning" && r && r.snapshot) {
      const key = SBDiag.ackKey(d, r.snapshot.geometryHash);
      const lab = document.createElement("label");
      lab.className = "diag-ack";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = r.acks.has(key);
      cb.addEventListener("change", () => {
        const home = li.closest(".diag-list");   // the panel the user is working in (#diag-list or #fab-list)
        if (cb.checked) r.acks.add(key); else r.acks.delete(key);
        refreshDiagnostics(r);
        const again = home && home.isConnected ? Array.from(home.querySelectorAll(".diag-ack input")).find((x) => x.dataset.key === key) : null;
        if (again) again.focus();   // keep the keyboard position across the re-render
      });
      cb.dataset.key = key;
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(fabRepair ? "Keep this clip at fabrication resolution"
        : r === run.fab ? "Acknowledge for this fabrication result" : "Acknowledge for this result"));
      li.appendChild(lab);
    }
    if (run.focus && it.focus && run.focus.key === d.id) li.setAttribute("aria-current", "true");
    return li;
  }

  /** Show one diagnostic's layer, parts and region in the Proof (UI-04). */
  function focusDiagnostic(d, it, li) {
    if (!preview.hasSnapshot()) { setStatus(`${run.report} · the proof is not ready; try again once it is built`, true); return; }
    const f = { layer: it.focus.layer, parts: it.focus.parts, regions: it.focus.regions, label: it.where, key: d.id };
    try { preview.setFocus(f); }
    catch (err) { setStatus(`${run.report} · cannot show ${it.where}: ${err.message || err}`, true); return; }
    switchTab("proof");
    document.querySelectorAll(".diag-list .diag-item[aria-current]").forEach((x) => x.removeAttribute("aria-current"));
    li.setAttribute("aria-current", "true");
    run.focus = f;
    $("diag-clear").hidden = false;
    setStatus(`Showing ${it.where}: ${it.title}` + (it.measure ? ` (${it.measure})` : ""), true);
  }

  function clearDiagnosticFocus() {
    run.focus = null;
    try { preview.setFocus(null); } catch (_) { /* nothing shown */ }
    document.querySelectorAll(".diag-list .diag-item[aria-current]").forEach((x) => x.removeAttribute("aria-current"));
    $("diag-clear").hidden = true;
  }

  // ------------------------------------------------------- reviewed clip repair (G2.13d: SUP-04, D-4.6, PRJ-04)

  /** True while the shown result is the current revision's (a proposal must be reviewed on the geometry it changes). */
  const viewCurrent = () => !!run.shown && !!run.shown.snapshot && run.shown.revision === project.revision;
  /** alpha.3 E5: the construction.repairs indices the shown result replayed (snapshot.repairsApplied; [] without one). */
  const shownApplied = () => (run.shown && run.shown.snapshot ? run.shown.snapshot.repairsApplied : []);

  /**
   * The repair action of one diagnostic item: BOND_UNSUPPORTED (bonded, layer ≥ 1) offers "Clip to lower layer…";
   * REPAIR_STALE links back to the clip dialog for the repair entry it refers to. alpha.3 E12: REPAIR_REVIEW_FAB is
   * re-reviewed on the fabrication result instead (fabRepairActions: Show, Keep, Revert).
   */
  function clipAction(d) {
    const repairs = project.construction.repairs;
    let label = null, ri = -1;
    const shownMode = run.shown && run.shown.snapshot ? run.shown.snapshot.construction.mode : null;   // the shown result's own mode
    if (d.code === "BOND_UNSUPPORTED" && Number.isInteger(d.layer) && d.layer >= 1 && shownMode === "bonded-relief") label = "Clip to lower layer…";
    else if (d.code === "REPAIR_STALE") {
      ri = SBProof.repairForDiagnostic(d, repairs, shownApplied());
      if (ri >= 0) label = "Review clip " + (ri + 1) + "…";
    }
    if (!label) return null;
    const box = document.createElement("div");
    box.className = "diag-actions";
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn"; b.textContent = label;
    b.addEventListener("click", () => openClipDialog(d.layer, ri, b));
    box.appendChild(b);
    return box;
  }

  /**
   * alpha.3 E12 (PO-PREVIEW-6, SUP-04, EXP-07; Appendix E Q10): the actions of a REPAIR_REVIEW_FAB item of the current
   * fabrication result (a clip reviewed on the draft and replayed at fabrication; the item's text carries the removed
   * mm² and part counts at fabrication resolution). Show: showFab() (the views switch to the fabrication result), then
   * focusDiagnostic on the clipped layer and region there. Keep is the item's acknowledgement, labelled "Keep this clip
   * at fabrication resolution" in diagItem (scoped to the fabrication geometryHash; the stored draft review is not
   * promoted). Revert: revertRepair of the entry the fabrication run replayed (SBSupport.removeRepair via
   * commitProject), so the fabrication run goes stale and the view returns to the draft.
   */
  function fabRepairActions(d, it) {
    if (!fabCurrent()) return null;
    const ri = SBProof.repairForDiagnostic(d, project.construction.repairs, run.fab.snapshot.repairsApplied);
    const box = document.createElement("div");
    box.className = "diag-actions";
    const sb = document.createElement("button");
    sb.type = "button"; sb.className = "btn"; sb.textContent = "Show";
    sb.setAttribute("aria-label", "Show " + it.where + " on the fabrication result");
    sb.addEventListener("click", () => {
      const home = sb.closest(".diag-list"), homeId = home ? home.id : "fab-list";
      showFab();
      if (!it.focus) return;
      const list = $(homeId) || $("fab-list");
      const li = (list ? Array.from(list.querySelectorAll(".diag-item")).find((x) => x.dataset.diagId === (d.id || "")) : null)
        || document.createElement("li");
      focusDiagnostic(d, it, li);
    });
    box.appendChild(sb);
    if (ri >= 0) {
      const rb = document.createElement("button");
      rb.type = "button"; rb.className = "btn";
      const later = project.construction.repairs.length - 1 - ri;
      rb.textContent = later ? "Revert (and the " + later + " later)" : "Revert";
      rb.setAttribute("aria-label", "Revert clip " + (ri + 1) + (later ? " and the " + later + " later repairs" : ""));
      rb.addEventListener("click", () => revertRepair(ri));
      box.appendChild(rb);
    }
    return box;
  }

  /**
   * The Repairs list: one row per construction.repairs entry (SBProof.repairRows: its reviewed record and whether the
   * shown result replays it), each with Revert (SBSupport.removeRepair: a new revision without this entry and every
   * later one; D-4.6) and, for a stale entry, "Review clip…".
   */
  function renderRepairs() {
    const list = $("repair-list"), sum = $("repair-summary");
    if (!list || !sum) return;
    list.textContent = "";
    const repairs = project.construction.repairs;
    const rows = SBProof.repairRows(repairs, { applied: viewCurrent() ? shownApplied() : undefined });
    sum.textContent = rows.length ? rows.length + (rows.length === 1 ? " reviewed repair" : " reviewed repairs") + " in the project."
      : "No repairs. An unsupported layer offers “Clip to lower layer…”.";
    for (const r of rows) {
      const li = document.createElement("li");
      li.className = "diag-item";
      li.dataset.status = r.status;
      const t = document.createElement("span");
      t.textContent = (r.index + 1) + ". " + r.text;
      li.appendChild(t);
      const box = document.createElement("div");
      box.className = "diag-actions";
      if (r.status === "stale") {
        const rb = document.createElement("button");
        rb.type = "button"; rb.className = "btn"; rb.textContent = "Review clip…";
        rb.addEventListener("click", () => openClipDialog(r.layer, r.index, rb));
        box.appendChild(rb);
      }
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn";
      b.textContent = r.laterCount ? "Revert (and the " + r.laterCount + " later)" : "Revert";
      b.setAttribute("aria-label", "Revert repair " + (r.index + 1) + (r.laterCount ? " and the " + r.laterCount + " later repairs" : ""));
      b.addEventListener("click", () => revertRepair(r.index));
      box.appendChild(b);
      li.appendChild(box);
      list.appendChild(li);
    }
  }

  function revertRepair(i) {
    let next;
    try { next = SBSupport.removeRepair(project, i); }
    catch (err) { setStatus(`cannot revert repair ${i + 1}: ${err.message || err}`, true); return; }
    commitProject(next, "repair");
    setStatus(`Reverted repair ${i + 1}: revision ${next.revision}; regenerating`, true);
  }

  /**
   * The clip dialog (SUP-04): SBSupport.proposeClip on the shown view for layer k, shown as the layer card with the
   * removed area (preview.drawClipCard), the removed mm² and the part count before → after (SBProof.clipReview).
   * Accept calls SBSupport.applyClip (a new revision with a reviewed repairs[] entry; the run then replays it).
   * Opened from a repair entry ri: Revert removes it (removeRepair); Accept replaces a stale entry by this review only
   * when it is the last entry (then the shown view is exactly the geometry without it); otherwise the dialog says to
   * revert first. Nothing is applied without Accept; Cancel or Escape leaves the project as it is.
   */
  function openClipDialog(k, ri, opener) {
    if (!viewCurrent() || !preview.hasSnapshot()) { setStatus(`${run.report} · the result is not ready; review the clip once the proof is built`, true); return; }
    const snap = run.shown.snapshot, applied = snap.repairsApplied;   // alpha.3 E5: reviewed on the shown result, at its own quality
    let proposal, review;
    try {
      proposal = SBSupport.proposeClip({ layers: snap.layers, quality: snap.quality, revision: project.revision }, k);
      review = SBProof.clipReview(proposal);
    } catch (err) { setStatus(`cannot propose a clip on layer ${k + 1}: ${err.message || err}`, true); return; }
    const repairs = project.construction.repairs;
    const fromRepair = ri >= 0 && ri < repairs.length;
    const stale = fromRepair && !applied.includes(ri);
    const replaceable = !fromRepair || (stale && ri === repairs.length - 1);
    const dlg = $("dlg-clip"), note = $("dlg-clip-note"), accept = $("dlg-clip-accept"), revert = $("dlg-clip-revert");
    $("dlg-clip-title").textContent = review.title;
    $("dlg-clip-summary").textContent = review.summary;
    const cvs = $("dlg-clip-canvas");
    preview.drawClipCard(cvs, k, proposal.removed, { maxPx: 480 });
    cvs.setAttribute("aria-label", review.title + ": " + review.summary);
    let why = "";
    if (fromRepair) {
      const row = SBProof.repairRows(repairs, { applied })[ri];
      why = "Repair " + (ri + 1) + ": " + row.text;
      if (stale && !replaceable) why += " Later repairs depend on it: revert it first (the later ones are reverted with it), then review the clip again.";
      else if (!stale) why += " It is applied on this draft; it is re-reviewed (Keep or Revert) in the Fabrication review.";
    }
    if (review.empty && !fromRepair) why = "Nothing to accept.";
    note.textContent = why; note.hidden = !why;
    accept.disabled = review.empty || !replaceable || (fromRepair && !stale);
    accept.textContent = fromRepair && stale ? "Replace with this clip" : "Accept clip";
    revert.hidden = !fromRepair;
    const finish = (value) => {
      try {
        if (value === "accept" && !accept.disabled) {
          let base = project, p = proposal;
          if (fromRepair) { base = SBSupport.removeRepair(project, ri); p = Object.assign({}, proposal, { revision: base.revision }); }
          const next = SBSupport.applyClip(base, p);
          commitProject(next, "repair");
          setStatus(`Clipped Layer ${k + 1} to Layer ${k}: −${SBUtil.fmt(review.removedMM2, 2)} mm², revision ${next.revision}; regenerating`, true);
        } else if (value === "revert" && fromRepair) revertRepair(ri);
      } catch (err) { setStatus(`clip not applied: ${err.message || err}`, true); }
      if (opener && opener.isConnected) opener.focus();
    };
    if (typeof dlg.showModal !== "function") {
      finish(!accept.disabled && window.confirm(review.title + "? " + review.summary) ? "accept" : "cancel");
      return;
    }
    dlg.returnValue = "";
    dlg.addEventListener("close", () => finish(dlg.returnValue), { once: true });
    dlg.showModal();
  }

  /**
   * The "Layers" tab: one card per layer of the shown result's snapshot showing what is retained (material) and what is
   * waste (G2.13a). Each card is drawn from layer.material through the preview's per-snapshot offscreen cache
   * (preview.drawCard: waste hatch, then the cached layer image, no smoothing), so the cards match the Proof; the label
   * adds SBProof.cards retained/waste mm², the ring count and cut length (layer.stats.cutMM) and, in connected mode,
   * the bridged/culled counts of snapshot.cleanupReport. Roles (alpha.3 E5): bonded "base", "layer k+1", "top";
   * connected "backing" (a solid panel: frame + holes only), "mid", "front". A trailing empty layer is badged omitted.
   */
  function renderSheetGrid(r, colors) {
    const grid = $("sheetgrid");
    grid.innerHTML = "";
    const snap = r.snapshot, bonded = snap.construction.mode === "bonded-relief";
    // bonded "top" is the front-most exported layer, not an omitted (empty) trailing one
    const top = snap.layers.reduce((m, l) => (l.status !== "omitted-trailing" && l.index > m ? l.index : m), 0);
    const cards = SBProof.cards(snap.layers, snap.page);
    // alpha.3 E11 (ASM-01, E-R10): bonded cards draw the scored guides and sheet numbers (#in-guidesvis); a draft result
    // says its guides are approximate (they come from the draft outlines; the fabrication preview shows the exact ones)
    const gv = $("in-guidesvis"), showGuides = !!(bonded && snap.guides && (!gv || gv.checked));
    const legend = $("guides-legend"), tg = $("tool-guides");
    if (tg) tg.hidden = !(bonded && snap.guides);
    if (legend) {
      legend.hidden = !(bonded && snap.guides);
      legend.textContent = !(bonded && snap.guides) ? ""
        : snap.quality === "draft" ? "Guides (approximate at draft; exact in the fabrication preview)"
        : "Guides: blue lines are scored, hidden under the next sheet";
    }
    for (const st of cards) {
      const k = st.layerIndex, L = snap.layers.find((l) => l.index === k), rep = snap.cleanupReport[k] || {};
      const card = document.createElement("div");
      card.className = "sheetcard";
      const cvs = document.createElement("canvas");
      if (!preview.drawCard(cvs, k, { scores: showGuides })) { cvs.width = 4; cvs.height = 3; SBPreview.drawWasteHatch(cvs.getContext("2d"), 4, 3); }   // hatch only
      cvs.setAttribute("role", "img");
      cvs.setAttribute("aria-label", `Sheet ${k + 1}: ${SBUtil.fmt(st.retainedPct, 0)}% retained material, ${SBUtil.fmt(100 - st.retainedPct, 0)}% waste (hatched)`);
      const role = bonded ? (k === 0 ? "base" : k === top ? "top" : "layer " + (k + 1)) : st.role;
      const rings = L ? L.material.reduce((a, p) => a + 1 + (p.holes ? p.holes.length : 0), 0) : 0;
      const cutMM = L && L.stats ? L.stats.cutMM : 0;
      const label = document.createElement("div");
      label.className = "sheetlabel";
      label.innerHTML =
        `<b>SHEET ${k + 1}</b> <span class="muted">${role}</span>` + (st.omitted ? ` <span class="amber">omitted (empty)</span>` : "") + `<br>` +
        `<span class="sw sw-retained" style="background:${colors[k]}"></span>retained ` +
        `${SBUtil.fmt(st.retainedMM2 / 100, 1)} cm² (${SBUtil.fmt(st.retainedPct, 0)}%)` +
        ` · <span class="sw sw-waste"></span>waste ${SBUtil.fmt(st.wasteMM2 / 100, 1)} cm²<br>` +
        (!bonded && k === 0
          ? `solid panel — frame + holes only`
          : `${rings} contours · ${SBUtil.fmt(cutMM / 10, 1)} cm cut` +
            (!bonded && rep.bridged ? ` · <span class="amber">${rep.bridged} bridged</span>` : "") +
            (!bonded && rep.culled ? ` · ${rep.culled} culled` : ""));
      card.append(cvs, label);
      grid.appendChild(card);
    }
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
  function settingsJSON() {
    const keep = [
      "projectName", "sourceName", "procRes", "smoothRadius", "smoothPasses",
      "nSheets", "thresholdMode", "darkFront", "palette", "widthMM", "marginMM",
      "minFeatureMM", "bridgeMM", "cullBelowMM2", "maxBridgeMM", "holes",
      "holeDiaMM", "cornerStyle", "detailEps",
    ];
    const state = cfg(), o = {};
    keep.forEach((k) => (o[k] = state[k]));
    // alpha.3 E6 (PO-PREVIEW-2): the short geometryHash of the delivered fabrication result, as in the review header,
    // so the files can be matched to the screen. alpha.3 E13 (EXP-06): a v2 project block from the fabrication snapshot.
    // Re-import is lossy: SBSchema.fromLegacySettings reads only the v1.1 keys and raises LEGACY_PROJECT_BLOCK (info).
    // geometryKey, interpretationMode and fabPitchMM are not in the snapshot and are read from the project; they match it
    // because export is gated on fabCurrent() (the snapshot's geometryHash covers the geometryKey).
    const fsnap = run.fab.snapshot;
    o.geometryHash = fsnap.geometryHash.slice(0, 12);
    o.project = {
      geometryKey: SBSchema.geometryKey(project), constructionMode: fsnap.construction.mode, interpretationMode: project.interpretation.mode,
      thicknessMM: fsnap.construction.tMM, fabPitchMM: project.geometry.fabPitchMM, raster: [fsnap.geometry.rasterW, fsnap.geometry.rasterH],
      geometryHash: run.fab.snapshot.geometryHash, engineVersion: fsnap.engineVersion,
    };
    return JSON.stringify(o, null, 2);
  }

  async function exportBundle() {
    if (!(run.shown && run.shown.snapshot)) {
      setStatus("Choose a source: load a photo or the Demo scene", true);
      return;
    }
    const btn = $("btn-export");
    if (btn.dataset.busy === "1") return; // ignore double taps mid-export
    btn.dataset.busy = "1";
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Preparing…";
    try {
      // alpha.2 (G2.10b rule, LYR-06, EXP-07): every export is the fabrication run of the current revision, reviewed on
      // that snapshot's diagnostics and gated by SBDiag.exportGate on it. Draft diagnostics and acks are never reused.
      // alpha.3 E6 (PO-PREVIEW-2): files are built only from the fabrication result that is on screen at the click.
      // Otherwise the click generates it if needed (fabReview), shows it in every view and stops; the next click
      // delivers what the user saw. After delivery the fabrication result stays shown.
      const ready = run.shown === run.fab && fabCurrent();
      const ok = await fabReview();
      if (!ok) { fabStopped("export again"); return; }
      if (!ready) {
        showFab();
        openFabReview("Review the fabrication result, then Download");
        return;
      }
      const gate = SBDiag.exportGate(run.fab.diagnostics, run.fab.acks, run.fab.snapshot, "fabrication");
      if (!gate.allowed) {
        const fr = $("fab-review");
        if (fr && fr.scrollIntoView) fr.scrollIntoView({ block: "nearest" });
        setStatus(gate.reason === "UNACKED"
          ? `fabrication review: acknowledge ${gate.unacked.length} warning${gate.unacked.length === 1 ? "" : "s"}, then download`
          : `fabrication review: export refused (${run.fab.status !== "done" && run.fab.error ? run.fab.error.code : gate.reason})`, true);
        return;
      }
      setStatus("building cut files…");
      await buildAndDeliver();
      markSaved();   // DEP-02: the delivered package is the user's saved copy of this revision
    } catch (err) {
      setStatus(`export failed: ${err.message || err}`, true);
    } finally {
      btn.dataset.busy = "0";
      btn.textContent = label;
      updateGate(SBSchema.canGenerate(project, run.sourceImage));
    }
  }

  /** alpha.2: true while run.fab is the fabrication run of the shown project revision, source and device class. */
  function fabCurrent() {
    return !!run.fab && run.fab.revision === project.revision && run.fab.gen === sourceGen && run.fab.deviceClass === deviceClass();
  }

  /** The export gate on the current fabrication run (SBDiag.exportGate at "fabrication"; NO_SNAPSHOT after a failed run). */
  function fabGate() {
    return SBDiag.exportGate(run.fab.diagnostics, run.fab.acks, run.fab.snapshot, "fabrication");
  }

  /**
   * alpha.3 E6: the busy text shown while the fabrication run is generated, from the fabrication raster plan of the
   * current revision and the measured SBSchema.limits(dc).fabMsPerMpx (E4; the offline app cannot read docs/ at runtime;
   * F17 re-measures it for the pool and for the fallback). Speed round F15: the pooled run keeps the page responsive; the
   * fallback branch (fabFallback) says that the page is blocked until it finishes.
   */
  const FABPREVIEW_NOTE = "Shows the exact cut geometry and its fabrication review.";
  function fabBusyText(dc) {
    try {
      const g = SBEngine.rasterPlan(project, { w: run.src.w, h: run.src.h }, "fabrication", dc).geometry;
      const est = Math.max(1, Math.round((g.rasterW * g.rasterH / 1e6) * SBSchema.limits(dc).fabMsPerMpx / 1000));
      return `Generating ${g.rasterW} × ${g.rasterH} px at ${g.mmPerPxMax.toFixed(3)} mm/px (about ${est} s)…`;
    } catch (_) {
      return "Generating the fabrication result…";
    }
  }
  /** The note under "Preview at fabrication resolution": the pool's fallback notice is appended while there is no pool. */
  function fabNote() { return FABPREVIEW_NOTE + (poolNotice ? " " + poolNotice : ""); }

  /** The busy state of a fabrication run: button text, note, Processing badge and veil; Cancel only for a pooled run. */
  function fabBusy(on, text, cancelable) {
    const fb = $("btn-fabpreview"), note = $("fabpreview-note"), cancel = $("btn-fabcancel");
    if (on) {
      if (fb) { fb.dataset.busy = "1"; fb.disabled = true; fb.textContent = text; }
      if (note) note.textContent = text;
      if (cancel) { cancel.hidden = !cancelable; cancel.disabled = false; }
      setRunState({ type: "start" });
      setVeil(true);
      setStatus(text);
      return;
    }
    if (!draftRun) { setVeil(false); showProgress(null); }   // a draft submitted meanwhile keeps its veil and progress
    if (fb) { fb.dataset.busy = "0"; fb.textContent = "Preview at fabrication resolution"; }
    if (note) note.textContent = fabNote();
    if (cancel) cancel.hidden = true;
  }

  /**
   * alpha.2 (LYR-06): make run.fab the fabrication run of the current revision. Reused while current (fabCurrent(): so
   * the user can acknowledge warnings and download what is on screen); otherwise SBEngine.request at quality
   * "fabrication" on the installed source record and its own full-size pixels, with no stage cache (E-R7). Speed round
   * F15 (PO-PERF-1, NFR-02): it runs in the worker pool with a progress bar and a Cancel button; the result is taken only
   * when SBDiag.acceptResult matches this submit (AT-15). An edit cancels it (recompute → cancelFab("restart")), the
   * Cancel button too (cancelFab("user")); fabCancelReason says which. Without a pool, fabFallback runs the sync driver.
   * Acks carry over only to the same geometryHash. Resolves true when run.fab is current, false when the project or
   * source changed meanwhile or the run was canceled. The caller shows it (showFab).
   */
  let fabInFlight = null, fabRun = null, fabCancelReason = null, fabRestart = false;   // one fabrication run at a time
  async function fabReview() {
    if (fabCurrent()) { renderFabReview(); return true; }
    if (fabInFlight) return fabInFlight;   // a second click (or Export) joins the run in flight
    fabCancelReason = null;
    fabInFlight = (async () => {
      if (!run.src || !project.source) return false;
      const gen = sourceGen, rev = project.revision, dc = deviceClass();
      if (!usePool()) return fabFallback(gen, rev, dc);
      if (!(run.sourceImage && run.src.sampleHash === project.source.sampleHash)) return false;
      const sampleHash = run.src.sampleHash, t0 = performance.now(), stateBefore = run.state;
      cancelDraft();   // one run at a time: the fabrication run supersedes a draft in flight (it reruns afterwards)
      fabBusy(true, fabBusyText(dc), true);
      let res = null;
      try {
        pool.setSource(run.src);
        // alpha.3 E1 (LYR-06): the same request builder as the draft, on the installed source record and its own pixels
        const sub = pool.submit(SBEngine.request(project, run.src, { quality: "fabrication", requestId: "fab-" + rev, deviceClass: dc }),
          { sampleHash, gen, overlays: true, onProgress: (p) => showProgress(Object.assign({ title: "Fabrication" }, p)) });
        const active = fabRun = { runId: sub.runId, gen, sampleHash, overlays: true, deviceClass: dc };
        const result = await sub.done.catch((err) => err);
        if (result instanceof Error && result.code === "POOL_UNAVAILABLE") { fabRun = null; fabBusy(false); return fabFallback(gen, rev, dc); }
        if (result instanceof Error) res = errorResponse(result, "ENGINE_INTERNAL");
        else if (SBDiag.acceptResult(active, result) && result.status !== "canceled") res = result.response;   // AT-15
      } catch (err) {   // a caller error (ENGINE_ARG from SBEngine.request)
        res = errorResponse(err, "ENGINE_ARG");
      } finally {
        fabRun = null;
        fabBusy(false);
      }
      if (!res || gen !== sourceGen || rev !== project.revision) {   // canceled or superseded (an edit set its own state)
        if (fabCancelReason === "user") showRunState(stateBefore);   // a canceled run did not fail
        if (!draftRun) setStatus(run.report);
        return false;
      }
      return storeFab(res, gen, rev, dc, t0);
    })();
    try { return await fabInFlight; }
    finally {
      fabInFlight = null;
      if (draftRerun) { draftRerun = false; regenerate(); }   // a draft superseded by this run runs now
    }
  }

  /**
   * Speed round F15 fallback branch of fabReview (no pool): the sync driver SBEngine.generate on the page. The busy text
   * (raster, pitch, estimate, and that the page is blocked), the Processing badge and the veil are painted first (a
   * frame, then a task). The request carries draftCapPx: limits(dc).draftPxFallback, as every fallback request (F-D5;
   * fabrication geometry does not depend on it).
   */
  async function fabFallback(gen, rev, dc) {
    const busy = fabBusyText(dc).replace(/…$/, "; the page will not respond until it finishes…");
    fabBusy(true, busy + (poolNotice ? " " + poolNotice : ""), false);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));   // paint the busy state first
    let res = null, t0 = 0;
    try {
      if (gen === sourceGen && rev === project.revision && run.sourceImage && run.src && project.source && run.src.sampleHash === project.source.sampleHash) {
        t0 = performance.now();
        try {
          res = SBEngine.generate(SBEngine.request(project, run.src, { quality: "fabrication", requestId: "fab-" + rev, deviceClass: dc,
            draftCapPx: SBSchema.limits(dc).draftPxFallback }));
        } catch (err) {   // a caller error (SOURCE_MISMATCH); generate itself never throws
          res = errorResponse(err, "ENGINE_ARG");
        }
      }
    } finally {
      fabBusy(false);
    }
    if (!res) { setStatus(run.report); return false; }   // superseded: the edit or new source set the state and reruns the draft
    return storeFab(res, gen, rev, dc, t0);
  }

  /** Store a fabrication response as run.fab (acks carry over only to the same geometryHash) and render its review. */
  function storeFab(res, gen, rev, dc, t0) {
    const snap = res.snapshot || null;
    const acks = run.fab && run.fab.snapshot && snap && run.fab.snapshot.geometryHash === snap.geometryHash ? run.fab.acks : new Set();
    run.fab = { kind: "fabrication", status: res.status, snapshot: snap, diagnostics: (snap ? snap.diagnostics : res.diagnostics) || [], error: res.error || null,
      revision: rev, gen, deviceClass: dc, acks, ms: performance.now() - t0 };
    renderFabReview();
    return true;
  }

  /**
   * Speed round F15 (UI-06, NFR-02): cancel the pooled fabrication run in flight. reason "user" (the Cancel button) or
   * "restart" (an edit or a new draft: "fabrication restarted", it runs again once the draft of the new revision is in).
   * The fallback run cannot be canceled (it blocks the page). Returns whether a run was canceled.
   */
  function cancelFab(reason) {
    if (!fabRun || !pool) return false;
    fabCancelReason = reason;
    pool.cancel(fabRun.runId);
    fabRun = null;
    const cancel = $("btn-fabcancel");
    if (cancel) cancel.disabled = true;
    return true;
  }

  /** The status after fabReview returned false: canceled by the user, restarted by an edit, or superseded. */
  function fabStopped(again) {
    if (fabCancelReason === "user") setStatus("fabrication run canceled", true);
    else if (fabCancelReason === "restart") {
      fabRestart = true;
      setStatus("fabrication restarted: it runs again on the edited settings once the draft is updated", true);
    } else setStatus("the project changed during the fabrication run; " + again, true);
  }

  /** alpha.3 E6 (PO-PREVIEW-2): "Preview at fabrication resolution": run (or reuse) the fabrication result and show it. */
  async function previewFabrication() {
    const fp = $("btn-fabpreview");
    if (fp && fp.dataset.busy === "1") return;
    try {
      if (!(await fabReview())) { fabStopped("preview again"); return; }
      showFab();
    } catch (err) {
      setStatus(`fabrication preview failed: ${err.message || err}`, true);
    } finally {
      updateGate(SBSchema.canGenerate(project, run.sourceImage));
    }
  }

  /** alpha.3 E6: open the fabrication review next to Download with a leading instruction (export shows it and stops). */
  function openFabReview(lead) {
    renderFabReview();
    const fr = $("fab-review"), sum = $("fab-summary");
    if (sum && lead) sum.textContent = lead + ". " + sum.textContent;
    if (fr && !fr.hidden && fr.scrollIntoView) fr.scrollIntoView({ block: "nearest" });
    setStatus(lead, true);
  }

  /**
   * The fabrication review (#fab-review) next to Download: the current fabrication run through the one diagnostics
   * renderer (renderDiagnostics at scope "fabrication": header with the raster, time and short geometryHash, the items
   * grouped by severity, each warning with "Acknowledge for this fabrication result" keyed by SBDiag.ackKey on the fab
   * snapshot's geometryHash). alpha.3 E6: its items are navigable while run.shown === run.fab (the Proof then shows the
   * fabrication geometry). alpha.3 E12 (PO-PREVIEW-6): a REPAIR_REVIEW_FAB item (a draft-reviewed clip replayed here)
   * shows its fabrication mm² and part counts with Show, Keep and Revert (fabRepairActions, diagItem). Hidden while
   * there is no current fabrication run.
   */
  function renderFabReview() {
    const box = $("fab-review"), list = $("fab-list");
    if (!box || !list) return;
    if (!fabCurrent()) { list.textContent = ""; box.hidden = true; updateGate(SBSchema.canGenerate(project, run.sourceImage)); return; }
    box.hidden = false;
    renderDiagnostics(run.fab, { scope: "fabrication" });
    updateGate(SBSchema.canGenerate(project, run.sourceImage));
  }

  async function buildAndDeliver() {
    // the colours are indexed by layer index over every layer of the fabrication snapshot, as in showResult
    const colors = sheetColors(run.fab.snapshot.layers.length);
    // alpha.2: cut files and proof come from the reviewed fabrication snapshot (SBEngine.generate at fabrication
    // quality, gated by exportGate in exportBundle), in the legacy flat layout (sheet_NN.svg, proof.svg) until G3.9.
    // alpha.3 E6 (PO-PREVIEW-2/7): exportBundle calls this only while run.fab is the shown, current result, so the
    // files, settings.json and preview.png are the geometry on screen; the fabrication result stays shown afterwards.
    const state = cfg();
    const files = SBEngine.fabricationFiles(run.fab.snapshot, project, colors);
    files.push({ name: "ASSEMBLY.md", data: SBDocs.assembly(project, run.fab.snapshot, { colors, sourceName: state.sourceName }) });
    files.push({ name: "settings.json", data: settingsJSON() });

    // preview.png: the opaque proof of run.fab (whatever tab is open) without UI state: the Changes overlay (amber
    // bridges, BOND_UNSUPPORTED regions) and the diagnostics focus are cleared for the capture, then restored.
    const fsnap = run.fab.snapshot, fo = run.focus;
    preview.setOverlays(null);
    preview.setFocus(null);
    let snap = null;
    try { snap = await preview.snapshot("proof"); }
    finally {
      preview.setOverlays(SBProof.overlays({ cleanupReport: fsnap.cleanupReport, diagnostics: fsnap.diagnostics, mode: fsnap.construction.mode }));
      if (fo) { try { preview.setFocus(fo); } catch (_) { run.focus = null; } }
    }
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
    // alpha.3 E5 (UI-01): the value follows the drag; the project changes (and the draft reruns) once, on release
    el.addEventListener("input", () => { if (out) $(out).textContent = fmt(parseFloat(el.value)); });
    el.addEventListener("change", () => {
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
    syncPitch();
    el.addEventListener("input", () => {
      const before = project.revision;
      project = SBSchema.applyFabPitch(project, el.value);
      show();
      if (project.revision !== before) recompute();
    });
    el.addEventListener("change", () => { el.value = project.geometry.fabPitchMM; show(); });
  }

  /**
   * Show the project's fabrication pitch in #in-res / #out-res. syncControls() calls it, so a pitch changed outside
   * the input (the explicit downsample records a coarser pitch through SBSchema.applyDownsample) is never left stale;
   * the input keeps the user's typing while it has focus.
   */
  function syncPitch() {
    const el = $("in-res"), out = $("out-res");
    if (el && document.activeElement !== el) el.value = project.geometry.fabPitchMM;
    if (out) out.textContent = SBUtil.fmt(project.geometry.fabPitchMM, 3) + " mm/px";
  }

  // ------------------------------------------------------- G2.11c control groups
  // Every G2.11c control writes through SBSchema.applyControl (lengths in project.units; invalid → unchanged). A geometry
  // change (revision + 1) regenerates; an appearance, units or view change calls showResult(run.shown) only (PRJ-02).
  // The two mode selects are not in CONTROLS: a mode change is reviewed in #dlg-mode before it applies (G2.11e).
  const CONTROLS = ["polarity", "thmode", "manual-th", "smooth", "thickness", "thickstate", "gap", "units",
    "sizeby", "target", "machine", "m-height", "m-length", "m-matwidth", "m-thick", "m-kerf", "appearance", "color", "explode",
    "guides", "gconceal", "gallow", "gfoot", "glabel"];   // alpha.3 E11: the bonded alignment guides (ASM-01/02)
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
    else { updateDimbar(); if (id !== "explode") showResult(run.shown); }   // explode is display-only (preview.setExplode)
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
    syncPitch();
    // E3b: the smoothing radius is physical (mm), so draft and fabrication smooth the same size
    $("out-smooth").textContent = SBUtil.fmt(project.interpretation.smoothing.radiusMM, 2) + " mm";
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
    reviewDiff(diff, "Review mode change", "Apply the " + key + " mode change?", sel, restore,
      () => commitProject(SBSchema.applyModeChange(project, patch, true), id));
  }

  /**
   * alpha.3 E7 (PRJ-02, PO-PREVIEW-3): changing #in-preset is reviewed in the same #dlg-mode dialog, listing
   * SBSchema.presetDiff(project, name). Accept applies SBSchema.applyPreset(…, true) (title, source, units, machine and
   * extras kept); Cancel or Escape restores the select. A preset whose values the project already has applies at once.
   */
  function reviewPreset(name) {
    const sel = $("in-preset"), restore = () => { sel.value = presetName; };
    let diff;
    try { diff = SBSchema.presetDiff(project, name); } catch (e) { restore(); return; }
    if (diff.length === 0) { presetName = name; restore(); return; }
    const label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : name;
    reviewDiff(diff, "Review preset change: " + label, "Apply the " + label + " preset?", sel, restore, () => {
      presetName = name;
      commitProject(SBSchema.applyPreset(project, name, true), "preset");
    });
  }

  /** The #dlg-mode review of a diff [{path, from, to, reason}]: Accept runs onAccept; the select is restored and focused either way. */
  function reviewDiff(diff, title, confirmText, sel, restore, onAccept) {
    const dlg = $("dlg-mode"), list = $("dlg-mode-list");
    $("dlg-mode-title").textContent = title;
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
      if (accepted) onAccept();
      restore();   // the select shows the project's mode or preset (Cancel: the old one)
      sel.focus();
    };
    if (typeof dlg.showModal !== "function") { finish(window.confirm(confirmText)); return; }
    dlg.returnValue = "";
    dlg.addEventListener("close", () => finish(dlg.returnValue === "accept"), { once: true });
    dlg.showModal();
  }

  function bindControls() {
    for (const id of Object.keys(MODE_CONTROLS)) {
      const el = $("in-" + id);
      el.addEventListener("change", () => { if (el.value !== project[MODE_CONTROLS[id]].mode) reviewModeChange(id, el.value); });
    }
    const presetSel = $("in-preset");
    presetSel.value = presetName;
    presetSel.addEventListener("change", () => { if (presetSel.value !== presetName) reviewPreset(presetSel.value); });
    // G2.11d: the bonded cull opt-in (construction.bridge.cullEnabled) is a checkbox
    $("in-cullon").addEventListener("change", (e) => onControl("cullon", e.target.checked));
    for (const id of CONTROLS) {
      const el = $("in-" + id);
      // text and number entries apply on change (a half-typed value is not a geometry change); selects, colour and the
      // explode slider (view only) apply as they move. alpha.3 E5 (UI-01): a geometry slider shows its value while it
      // moves and commits once on release, so a drag regenerates once.
      if (el.type === "range" && id !== "explode") {
        el.addEventListener("input", () => showRangeValue(id, el.value));
        el.addEventListener("change", () => onControl(id, el.value));
        continue;
      }
      const live = el.tagName === "SELECT" || el.type === "range" || el.type === "color";
      el.addEventListener(live ? "input" : "change", () => onControl(id, el.value));
      if (!live) el.addEventListener("blur", syncControls);
    }
    syncControls();
  }

  /** The number next to a geometry slider while it moves (before the change commits). */
  function showRangeValue(id, value) {
    const out = $("out-" + id), v = parseFloat(value);
    if (out && Number.isFinite(v)) out.textContent = id === "smooth" ? SBUtil.fmt(v, 2) + " mm" : String(v);
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
    const { plan, sizeErr } = fabPlanNow();   // alpha.3 E8: the same plan the draft panel's Fabrication resolution group lists
    const snap = run.shown && run.shown.snapshot;
    const stats = snap && run.shown.revision === project.revision ? snap.stats : null;   // alpha.3 E5: the shown snapshot's accounting
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

  /**
   * G2.14 source intake (IMG-01/02/05/07, NFR-04): 1 sniff, 2 inspect + check, 3 SBSchema.preflight (all inside
   * SBSchema.intake, before any decode), 4 decode. Height PNGs go through SBPng.decode (raw samples, EXIF applied by
   * SBEngine.orient); tonal PNG/JPEG are decoded by the browser with createImageBitmap, never <img> (plan Appendix C,
   * S4b: <img> accepts 12-bit and truncated JPEGs that createImageBitmap rejects), which applies EXIF itself. Nothing
   * is ever downscaled silently: an over-limit source is rejected, and only the explicit Downsample button reduces it
   * (recording the coarser fabrication pitch and a history entry through SBSchema.applyDownsample). The fabrication
   * raster and mm/px come from the raster plan, never from an assumed long side; preflight's plan and warnings
   * (FAB_PITCH_CAPPED, FAB_EXCEEDS_SOURCE, EXIF_AMBIGUOUS) are shown before decoding. The decode route is chosen at
   * intake: a PNG loaded in tonal mode keeps its browser decode if the mode is later switched to height (recorded
   * deviation 4); reload the file to take the raw height route. Every load, downsample and
   * demo takes a new sourceGen, so a slower earlier decode never overwrites a newer source.
   */
  let sourceGen = 0;
  async function loadFile(file) {
    const gen = ++sourceGen;
    showSourceProblem(null);
    const dc = deviceClass(), lim = SBSchema.limits(dc);
    if (file.size > lim.maxSourceBytes) {   // refuse before reading the bytes at all (IMG-07)
      showSourceProblem(`${file.name}: file is ${(file.size / 1048576).toFixed(1)} MiB; the ${dc} limit is ${lim.maxSourceBytes / 1048576} MiB.`);
      return;
    }
    setStatus(`checking ${file.name}…`);
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch (e) { if (gen === sourceGen) showSourceProblem(`couldn’t read ${file.name}`); return; }
    if (gen !== sourceGen) return;
    let pre = SBSchema.intake(bytes, { project, deviceClass: dc }), autoTonal = false;
    // alpha.3 E7 (IMG-01, PO-PREVIEW-3): in height mode a colour source that height refuses (a JPEG, a colour palette
    // PNG) switches to tonal (SBSchema.colourSourceSwitch) and is taken on the browser route. RGB-equal truecolour and
    // gray PNGs stay on the raw height route (they are valid height maps; Review Focus 1).
    if (!pre.ok && project.interpretation.mode === "height" && COLOUR_REFUSALS.includes(pre.code)) {
      const tonal = SBSchema.intake(bytes, { project: SBSchema.colourSourceSwitch(project).project, deviceClass: dc });
      if (tonal.ok || tonal.suggestDownsamplePx) { pre = tonal; autoTonal = true; }
      if (!tonal.ok && tonal.suggestDownsamplePx) {   // the explicit downsample re-runs intake against the project: switch it now
        switchToTonal();
        refuseSource(file, bytes, pre, colourNotice());
        return;
      }
    }
    if (!pre.ok) { refuseSource(file, bytes, pre); return; }
    setStatus(`loading ${file.name}…`);
    let src;
    try { src = await decodeSource(file, bytes, pre); }
    catch (e) {
      if (gen !== sourceGen) return;
      // a truecolour PNG whose channels differ is only found while decoding (raw route): switch and decode on the tonal route
      if (e.code === "PNG_UNEQUAL_RGB" && project.interpretation.mode === "height") {
        pre = SBSchema.intake(bytes, { project: SBSchema.colourSourceSwitch(project).project, deviceClass: dc });
        autoTonal = true;
        if (!pre.ok) { refuseSource(file, bytes, pre); return; }
        try { src = await decodeSource(file, bytes, pre); } catch (e2) { if (gen === sourceGen) showSourceProblem(decodeProblem(file, e2)); return; }
      } else { showSourceProblem(decodeProblem(file, e)); return; }
    }
    if (gen !== sourceGen) { if (src.bitmap.close) src.bitmap.close(); return; }
    await acceptSource(file.name, src, pre.intake, gen, bytes, autoTonal);
    if (gen !== sourceGen) return;
    const notes = SBDocs.sourceNotes(pre.warnings);   // alpha.3 E8 (PO-PREVIEW-4): every preflight warning, at load
    if (autoTonal) notes.unshift(colourNotice());
    if (notes.length) showSourceProblem(`${file.name}: ${notes.join("; ")}`);
  }

  // alpha.3 E7: the preflight refusals of a colour source in height mode (PNG_UNEQUAL_RGB is found while decoding)
  const COLOUR_REFUSALS = ["HEIGHT_NEEDS_PNG", "PNG_PALETTE"];
  /** The SOURCE_COLOR_TONAL notice with a pointer to the Interpretation control (no "use as height" button: it could never succeed). */
  function colourNotice() {
    return SBDiag.CODES.SOURCE_COLOR_TONAL.title + " Change it under 2 Interpretation \u2192 Read the image as.";
  }
  /** Apply SBSchema.colourSourceSwitch to the project now (height mode only), through the one commit path. */
  function switchToTonal() {
    if (project.interpretation.mode === "height") commitProject(SBSchema.colourSourceSwitch(project).project, "interp");
  }
  function decodeProblem(file, e) {
    return `couldn’t decode ${file.name}: ${e.code ? (SBDiag.CODES[e.code] ? SBDiag.CODES[e.code].title : e.code) : e.message}`;
  }

  /** The fabrication plan text (pitch, cap, shortfall) for a plan, as the dimbar words it. */
  function planText(plan) {
    return SBDocs.dimbarModel({ project, plan, stats: null }).pitch.text;
  }

  /**
   * Show a preflight refusal with what preflight already knows before decoding: the plan at the file's own size and,
   * for SOURCE_TOO_MANY_PIXELS, the pitch and raster the explicit downsample would give, then offer the button.
   */
  function refuseSource(file, bytes, pre, note) {
    const parts = [`${file.name}: ${pre.reason}`];
    if (note) parts.push(note);
    const sug = pre.suggestDownsamplePx;
    let target = null;
    if (sug) {
      target = SBSchema.downsampleTarget(pre);
      try {
        const q = SBSchema.applyDownsample(project, { fromW: pre.intake.w, fromH: pre.intake.h, toW: target.w, toH: target.h });
        parts.push(`After the downsample: ${planText(SBEngine.rasterPlan(q, target, "fabrication", deviceClass()))}.`);
      } catch (e) { /* the size cannot be resolved: the dimbar says why once a source loads */ }
    } else if (pre.rasterPlan) parts.push(`At this size: ${planText(pre.rasterPlan)}.`);
    // alpha.3 E8 (PO-PREVIEW-4): every preflight warning; with a downsample offer only the orientation warning, since the
    // plan warnings describe a size that will not be used (the "After the downsample" plan replaces them)
    const shownWarnings = sug ? pre.warnings.filter((w) => w.code === "EXIF_AMBIGUOUS") : pre.warnings;
    for (const line of SBDocs.sourceNotes(shownWarnings)) parts.push(line + ".");
    showSourceProblem(parts.join(" "), target ? () => downsampleExplicitly(file, bytes, note) : null,
      target ? `Downsample to ${target.w} × ${target.h} px` : "");
  }

  /** The raw height route: SBPng samples, EXIF applied by SBEngine.orient (exifAppliedBy "engine"). */
  async function decodeRaw(bytes) {
    const d = await SBPng.decode(bytes, { mode: "height" });
    const o = SBEngine.orient({ samples: d.samples, alpha: d.alpha, w: d.w, h: d.h },
      { exif: d.exif || 1, exifAppliedBy: "engine", rotate: 0, mirror: false });
    return { samples: o.samples, alpha: o.alpha, w: o.w, h: o.h, channels: d.channels, policy: d.policy };
  }

  /** Raw samples (1 or 3 channels, optional alpha) into an RGBA canvas (the source bitmap of the raw route). */
  function samplesToCanvas(r) {
    const c = document.createElement("canvas");
    c.width = r.w; c.height = r.h;
    const cx = c.getContext("2d"), im = cx.createImageData(r.w, r.h), px = im.data, ch = r.channels;
    for (let i = 0, n = r.w * r.h; i < n; i++) {
      const v = r.samples[i * ch];
      px[4 * i] = v; px[4 * i + 1] = ch >= 3 ? r.samples[i * ch + 1] : v; px[4 * i + 2] = ch >= 3 ? r.samples[i * ch + 2] : v;
      px[4 * i + 3] = r.alpha ? r.alpha[i] : 255;
    }
    cx.putImageData(im, 0, 0);
    return c;
  }

  /**
   * Intake step 4: the decode route preflight chose. Resolves to {bitmap, raw} at the full source size: bitmap is a
   * canvas or ImageBitmap (its size feeds the raster plan), raw the SBPng samples of the raw height
   * route ({samples, alpha, w, h, channels, policy}) or null for the browser route.
   */
  async function decodeSource(file, bytes, pre) {
    if (pre.intake.decode === "raw") { const raw = await decodeRaw(bytes); return { bitmap: samplesToCanvas(raw), raw }; }
    if (typeof createImageBitmap !== "function") throw new Error("this browser has no createImageBitmap; use a current Chrome, Firefox or Safari");
    let bmp;
    try { bmp = await createImageBitmap(file); }   // the default orientation applies EXIF, as <img> did
    catch (e) { throw new Error("the browser could not decode it"); }
    if (!bmp.width || !bmp.height) { bmp.close(); throw new Error("the image has no pixels"); }
    return { bitmap: bmp, raw: null };
  }

  /**
   * alpha.3 E1: the engine pixels {pixels, channels: 1|4, w, h, alpha} of a decoded source, read once per load. The raw
   * route keeps its 1-channel samples (a 3-channel raw RGB is expanded to RGBA once); the browser route reads the
   * bitmap's RGBA at its own size. alpha is the w·h plane, or null when the source is opaque.
   */
  function sourcePixels(d) {
    const r = d.raw;
    if (r && r.channels === 1) return { pixels: r.samples, channels: 1, w: r.w, h: r.h, alpha: r.alpha || null };
    if (r) {
      const n = r.w * r.h, out = new Uint8Array(4 * n), ch = r.channels;
      for (let i = 0; i < n; i++) {
        out[4 * i] = r.samples[i * ch]; out[4 * i + 1] = r.samples[i * ch + 1]; out[4 * i + 2] = r.samples[i * ch + 2];
        out[4 * i + 3] = r.alpha ? r.alpha[i] : 255;
      }
      return { pixels: out, channels: 4, w: r.w, h: r.h, alpha: r.alpha || null };
    }
    const img = d.bitmap, w = img.width, h = img.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const rgba = new Uint8Array(cx.getImageData(0, 0, w, h).data.buffer);
    let alpha = null;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { alpha = new Uint8Array(w * h); break; }
    if (alpha) for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[4 * i + 3];
    return { pixels: rgba, channels: 4, w, h, alpha };
  }

  /**
   * Use a decoded source ({bitmap, raw}) at its own size (run.sourceW/H feed the fabrication raster plan).
   * alpha.3 E1 (LYR-06, SUP-04): the source record is installed on the project here, once per load, race-free. The
   * pixels are read and both SHA-256 hashes (file bytes, SBEngine.sampleBytes) resolve first; a newer load (gen !==
   * sourceGen) wins and this one is dropped. Then one synchronous block swaps run.src, the bitmap and project.source
   * together and runs exactly one draft (no commitProject, whose recompute would schedule a second). Until that block,
   * the previous source, record and revision are all still in place, so a debounced draft or an export in between
   * runs consistently on the old source. Reloading an identical file installs an identical record (no revision bump).
   */
  async function acceptSource(name, decoded, intake, gen, bytes, autoTonal) {
    const src = decoded.bitmap, raw = decoded.raw;
    const route = { format: intake && intake.format === "jpeg" ? "jpeg" : "png",
      decode: raw ? (raw.policy || "raw-gray8") : "canvas-tonal" };
    const px = sourcePixels(decoded);
    const byteHash = bytes ? await SBHash.digest(bytes) : null;
    const sampleHash = await SBHash.digest(SBEngine.sampleBytes(px));
    if (gen !== sourceGen) { if (src !== run.sourceImage && typeof src.close === "function") src.close(); return; }
    const old = run.sourceImage;
    run.src = Object.assign(px, { gen, sampleHash });
    run.draftCache = { quality: "draft" };   // E3: a draft cache only (fabrication runs are uncached, E-R7)
    run.sourceRoute = route;   // alpha.2: the source record of the decoded pixels
    run.sourceImage = src;
    run.sourceW = src.width; run.sourceH = src.height;
    run.sourceName = name;
    // alpha.3 E7: a colour source loaded in height mode switches the project to tonal in the same block as its record
    if (autoTonal && project.interpretation.mode === "height") project = SBSchema.colourSourceSwitch(project).project;
    project = SBSchema.withSource(project, SBEngine.sourceRecord(px, route, Object.assign({}, project.source, { byteHash, sampleHash })));
    if (old && old !== src && typeof old.close === "function") old.close();   // release a replaced ImageBitmap
    if (project.title === "untitled") setProjectName(name.replace(/\.[^.]+$/, ""));
    if (run.shown === run.fab) showDraft();   // alpha.3 E6: a fabrication result belongs to the previous source
    regenerate();   // syncs the controls and the dimbar to the installed project first
  }

  /**
   * The explicit downsample (IMG-07, NFR-04): re-run intake against the current project (the mode may have changed
   * since the refusal, and with it the decode route), decode at full size, resample once to the size preflight
   * offered and record the coarser fabrication pitch and a history entry on the project. Height maps resample with
   * the deterministic SBRaster.resample (G2.0 policy: nearest, area only when geometry.resample.height says so);
   * tonal sources use the browser's drawImage (recorded deviation 6). When the browser did not rotate an EXIF 5..8
   * (or did rotate an ambiguous) file as parsed, the target follows what the browser decoded (Appendix C).
   */
  async function downsampleExplicitly(file, bytes, note) {
    const gen = ++sourceGen;
    showSourceProblem(null);
    const pre = SBSchema.intake(bytes, { project, deviceClass: deviceClass() });
    if (!pre.ok && !pre.suggestDownsamplePx) { refuseSource(file, bytes, pre, note); return; }
    if (pre.ok) { loadFile(file); return; }   // nothing to reduce any more (limits or mode changed)
    let { w: toW, h: toH } = SBSchema.downsampleTarget(pre);
    setStatus(`downsampling ${file.name} to ${toW} × ${toH} px…`);
    try {
      let c, fromW, fromH;
      if (pre.intake.decode === "raw") {
        const r = await decodeRaw(bytes);
        if (gen !== sourceGen) return;
        fromW = r.w; fromH = r.h;
        const method = project.geometry.resample.height === "area" ? "area" : "nearest";
        const small = { w: toW, h: toH, channels: r.channels, policy: r.policy,
          samples: SBRaster.resample(r.samples, r.channels, r.w, r.h, toW, toH, method),
          alpha: r.alpha ? SBRaster.resample(r.alpha, 1, r.w, r.h, toW, toH, method) : null };
        c = { bitmap: samplesToCanvas(small), raw: small };
      } else {
        const full = (await decodeSource(file, bytes, pre)).bitmap;
        if (gen !== sourceGen) { full.close(); return; }
        fromW = full.width; fromH = full.height;
        if ((fromW >= fromH) !== (toW >= toH) && fromW !== fromH) [toW, toH] = [toH, toW];   // the browser's orientation wins
        c = document.createElement("canvas");
        c.width = toW; c.height = toH;
        const cx = c.getContext("2d");
        cx.imageSmoothingEnabled = true;
        cx.drawImage(full, 0, 0, toW, toH);
        full.close();
        c = { bitmap: c, raw: null };
      }
      project = SBSchema.applyDownsample(project, { fromW, fromH, toW, toH });
      await acceptSource(file.name, c, pre.intake, gen, bytes);
      if (gen !== sourceGen) return;
      setStatus(`downsampled ${file.name} to ${toW} × ${toH} px; fabrication pitch ${project.geometry.fabPitchMM} mm/px`, true);
      if (note) showSourceProblem(`${file.name}: ${note}`);   // alpha.3 E7: the SOURCE_COLOR_TONAL notice stays visible
    } catch (e) {
      if (gen !== sourceGen) return;
      if (e.code === "PNG_UNEQUAL_RGB" && project.interpretation.mode === "height") {   // alpha.3 E7: colour PNG → tonal, then retry
        switchToTonal();
        await downsampleExplicitly(file, bytes, colourNotice());
        return;
      }
      showSourceProblem(`couldn’t downsample ${file.name}: ${e.message}`);
    }
  }

  /** Show (or clear, text null) why a source was refused or needs a look; offer the explicit Downsample button when given. */
  function showSourceProblem(text, onDownsample, label) {
    const why = $("why-source"), btn = $("btn-downsample");
    if (why) { why.textContent = text || ""; why.hidden = !text; }
    if (text) setStatus(text, true);
    if (!btn) return;
    btn.hidden = !onDownsample;
    btn.onclick = onDownsample || null;
    if (onDownsample) btn.textContent = label || "Downsample";
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

  // ------------------------------------------------------------- bench modes (speed round F16a; S1–S3, F.7)
  /**
   * In-app measurement modes, inert unless the page URL carries ?bench=fab|draft|cancel (index.html or the dist/ bundle,
   * any scheme). Each mode drives the app's own paths on a bench project and shows a panel (#bench-panel) with the JSON
   * record (#bench-result; <html data-bench="running|done|error">) and a "Download JSON" button (&download also saves
   * it on completion). Every record carries p50Ms/p95Ms/maxMs (nearest rank, as test/bench.js) and longTaskMaxMs, the
   * longest main-thread task seen by the F11 recorder (SBPool.longTasks: PerformanceObserver("longtask"); Chromium only,
   * longTasks.supported says whether it was observable).
   *   ?bench=fab    S2: fabrication preview of the S2 workload (test/bench.js user12 settings: plywood auto-tonal, 8 sheets,
   *                 300 mm high, 0.1 mm pitch, inset-outline), 1 warm + 5 measured runs through previewFabrication, each
   *                 timed from the click to the painted result (receipt, freeze, setSnapshot and the preview render).
   *   ?bench=draft  S3: the E4 method: both art families (realistic, busy), E4 workload (a); after the cold draft, warm
   *                 edits sheets 8 ↔ 7 (revision changing) through the draft path, 3 warm-up + 15 measured per family,
   *                 each timed from the edit to the painted draft. families.<f>.p95Ms is the E4/S3 rule's number.
   *   ?bench=cancel S1/NFR-02: 20 fabrication runs canceled (Cancel = cancelFab("user")) after 50–1000 ms; latency from
   *                 the cancel to the settled run, plus whether the watchdog fired and the respawn time.
   * Sources: &src=realistic|busy (default: realistic; draft runs both) is the seeded synthetic art of test/fixtures.js
   * heightMap/busyHeightMap as RGBA (bench.js draftSource), at 4096 × 3084 unless &w=&h=; &src=loaded runs on the
   * source the user loaded (e.g. the S2 photo, or `node tools/alpha3_scene.js scene.png 4096 3084`) after "Run".
   * &runs=, &warm=, &cancels= override the counts (a smoke run, not a measurement).
   */
  // ---- F16a bench helpers (pure)
  const BENCH_PLAN = {
    fab: { warm: 1, runs: 5, src: [4096, 3084], fabPitchMM: 0.1, guides: "inset-outline" },
    draft: { warm: 3, runs: 15, families: ["realistic", "busy"], sheets: [8, 7], src: [4096, 3084], seeds: { realistic: 2022, busy: 11 }, busyCellPx: 27 },
    cancel: { cancels: 20, src: [4096, 3084], delaysMs: [50, 150, 300, 600, 1000] },
  };
  /** Nearest-rank p50/p95 and max over t (ms), as test/bench.js stats; nulls for no runs. */
  function benchStats(t) {
    const s = t.slice().sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
    const r = (v) => +v.toFixed(1);
    return s.length ? { n: s.length, p50Ms: r(q(0.5)), p95Ms: r(q(0.95)), maxMs: r(s[s.length - 1]) } : { n: 0, p50Ms: null, p95Ms: null, maxMs: null };
  }
  function benchLcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  /** test/fixtures.js heightMap (the "realistic" family), byte for byte. */
  function benchHeightMap(seed, w, h, blobs = 420) {
    const rng = benchLcg(seed), f = new Float32Array(w * h), S = Math.min(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = 0.18 + 0.32 * (x / w) + 0.22 * (y / h);
    for (let b = 0; b < blobs; b++) {
      const cx = rng() * w, cy = rng() * h, r = S * (0.006 + 0.064 * rng() * rng()), amp = (rng() < 0.6 ? 1 : -1) * (0.12 + 0.38 * rng());
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r)), r2 = r * r;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2; if (d2 >= r2) continue;
        const t = 1 - d2 / r2; f[y * w + x] += amp * t * t;
      }
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) { const v = f[i]; out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }
    return out;
  }
  /** test/fixtures.js busyHeightMap (the "busy" family), byte for byte. */
  function benchBusyHeightMap(seed, w, h, cell = 27) {
    const rng = benchLcg(seed), f = new Float32Array(w * h);
    for (const [sp, amp] of [[cell, 1], [cell / 2.5, 0.45], [cell / 6, 0.2]]) {
      const gw = Math.ceil(w / sp) + 2, gh = Math.ceil(h / sp) + 2, g = new Float32Array(gw * gh);
      for (let i = 0; i < g.length; i++) g[i] = rng();
      for (let y = 0; y < h; y++) {
        const gy = y / sp, iy = Math.floor(gy), ty = gy - iy;
        for (let x = 0; x < w; x++) {
          const gx = x / sp, ix = Math.floor(gx), tx = gx - ix, o = iy * gw + ix;
          f[y * w + x] += amp * ((g[o] * (1 - tx) + g[o + 1] * tx) * (1 - ty) + (g[o + gw] * (1 - tx) + g[o + gw + 1] * tx) * ty);
        }
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
    const out = new Uint8Array(w * h), k = hi > lo ? 255 / (hi - lo) : 0;
    for (let i = 0; i < out.length; i++) out[i] = Math.round((f[i] - lo) * k);
    return out;
  }
  /** Gray samples → the engine's RGBA source, coloured as test/bench.js draftSource. */
  function benchRgba(g, w, h) {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[4 * i] = g[i]; rgba[4 * i + 1] = (g[i] * 3) & 255; rgba[4 * i + 2] = 255 - g[i]; rgba[4 * i + 3] = 255; }
    return { pixels: rgba, channels: 4, w, h, alpha: null };
  }
  /**
   * The bench project on an installed source record (S = SBSchema): E4 workload (a) (test/bench.js draftProject("a"):
   * plywood auto-tonal, light-front, smoothing 1.65 mm × 2, bonded, 8 sheets, 300 mm high) for "draft"; plus the S2
   * fabrication pitch and inset-outline guides (user12Project) for "fab" and "cancel".
   */
  function benchProject(S, record, kind) {
    let p = S.withSource(S.defaults("plywood"), record);
    p = S.applyModeChange(p, { interpretation: { mode: "tonal" } }, true);
    p.interpretation.polarity = "light-front"; p.interpretation.smoothing = { radiusMM: 1.65, passes: 2 };
    p.construction.sheets = BENCH_PLAN.draft.sheets[0]; p.geometry.sizeBy = "height"; p.geometry.targetMM = 300;
    if (kind !== "draft") {
      if (p.construction.mode === "bonded-relief") p.construction.guides.mode = BENCH_PLAN.fab.guides;
      p = S.applyFabPitch(p, BENCH_PLAN.fab.fabPitchMM);
    }
    return p;
  }
  /** The JSON record of one bench: mode, time, environment, the stats of m.runsMs (warm-up excluded), then m's fields. */
  function benchRecord(mode, m, env) {
    return Object.assign({ bench: mode, at: new Date().toISOString(), env }, benchStats(m.runsMs || []), m);
  }
  // ---- F16a bench helpers end

  const BENCH = (() => {
    try {
      const m = new URLSearchParams(location.search).get("bench");
      return ["fab", "draft", "cancel"].includes(m) ? m : null;
    } catch (_) { return null; }
  })();
  /** A bench query option (string), or d when absent. */
  function benchOpt(k, d) {
    try { const v = new URLSearchParams(location.search).get(k); return v === null || v === "" ? d : v; } catch (_) { return d; }
  }
  /** A positive integer bench option clamped to [lo, hi], or d. */
  function benchInt(k, d, lo, hi) { const v = Math.round(Number(benchOpt(k, d))); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  /** Called at the end of applyDraft (the one draft result path of both drivers) while a bench waits for a draft. */
  let benchDraftHook = null;
  const benchSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Resolves once the next frame has been painted (the second animation frame callback runs after it). */
  const benchPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  /** The F11 long-task recorder (zeros, supported false, where SBPool or longtask entries are unavailable). */
  function benchLongTasks() {
    if (typeof SBPool !== "undefined" && typeof SBPool.longTasks === "function") return SBPool.longTasks();
    return { supported: false, start() {}, stop() { return { supported: false, max: 0, count: 0 }; } };
  }
  /** The next applyDraft whose context matches pred → {res, c}. */
  function benchWaitDraft(pred) {
    return new Promise((resolve) => {
      benchDraftHook = (res, c) => { if (!pred(c)) return; benchDraftHook = null; resolve({ res, c }); };
    });
  }
  /** Until no draft or fabrication run is in flight. */
  async function benchIdle() { while (fabInFlight || draftRun) await benchSleep(25); await benchPaint(); }
  function benchEnv() {
    const n = typeof navigator !== "undefined" ? navigator : {};
    return { app: APP_VERSION, engine: SBEngine.VERSION, userAgent: n.userAgent || null, hardwareConcurrency: n.hardwareConcurrency || null,
      deviceMemory: Number.isFinite(n.deviceMemory) ? n.deviceMemory : null, deviceClass: deviceClass(), protocol: location.protocol,
      pool: pool ? { mode: pool.mode, rung: pool.rung || null, helpers: pool.mode === "pool" ? SBPool.helperCount(n.hardwareConcurrency, deviceClass()) : 0 } : { mode: "fallback", helpers: 0 },
      notice: poolNotice, draftCapPx: SBSchema.limits(deviceClass()).draftPxCap };
  }
  const benchMs = (v) => +v.toFixed(1);

  /**
   * Install the bench source (family "realistic"/"busy": the seeded synthetic art; "loaded": the source the user loaded)
   * with the bench project of kind through the app's own install path (acceptSource → one draft), and wait for that
   * cold draft. → {family, w, h, coldMs, coldStatus}.
   */
  async function benchInstall(kind, family) {
    const plan = BENCH_PLAN[kind], S = SBSchema, E = SBEngine;
    if (family === "loaded") {
      if (!run.src || !project.source) throw new Error("load a source first (the S2 photo, or node tools/alpha3_scene.js scene.png 4096 3084), then press Run");
      const next = benchProject(S, project.source, kind);
      next.revision = project.revision + 1;
      project = next;
      const t0 = performance.now(), wait = benchWaitDraft((c) => c.rev === project.revision);
      setRunState({ type: "edit" });
      regenerate();
      const { res } = await wait;
      await benchPaint();
      return { family, w: run.src.w, h: run.src.h, coldMs: benchMs(performance.now() - t0), coldStatus: res.status };
    }
    const w = benchInt("w", plan.src[0], 16, 8192), h = benchInt("h", plan.src[1], 16, 8192), seeds = BENCH_PLAN.draft.seeds;
    setStatus(`bench: building the ${family} art at ${w} × ${h} px…`);
    await benchPaint();
    const g = family === "busy" ? benchBusyHeightMap(seeds.busy, w, h, BENCH_PLAN.draft.busyCellPx) : benchHeightMap(seeds.realistic, w, h);
    const px = benchRgba(g, w, h), route = { format: "png", decode: "canvas-tonal" };
    const sampleHash = await SBHash.digest(E.sampleBytes(px));
    const next = benchProject(S, Object.assign(E.sourceRecord(px, route), { sampleHash }), kind);
    next.revision = project.revision + 1;
    project = next;
    setProjectName("bench-" + kind + "-" + family);
    const gen = ++sourceGen, wait = benchWaitDraft((c) => c.gen === gen), t0 = performance.now();
    await acceptSource("bench " + family + " " + w + "x" + h,
      { bitmap: samplesToCanvas({ w, h, channels: 4, samples: px.pixels, alpha: null }), raw: { w, h, channels: 4, samples: px.pixels, alpha: null, policy: route.decode } },
      null, gen, null);
    const { res } = await wait;
    await benchPaint();
    return { family, w, h, coldMs: benchMs(performance.now() - t0), coldStatus: res.status };
  }

  /** ?bench=fab (S2, F.7): 1 warm + 5 fabrication previews, each from the click to the painted fabrication result. */
  async function benchFab(family) {
    const plan = BENCH_PLAN.fab, warm = benchInt("warm", plan.warm, 0, 100), runs = benchInt("runs", plan.runs, 1, 1000);
    const src = await benchInstall("fab", family), rows = [], all = benchLongTasks();
    all.start();
    for (let i = 0; i < warm + runs; i++) {
      setStatus(`bench fab: run ${i + 1} of ${warm + runs}${i < warm ? " (warm-up)" : ""}…`, true);
      await benchIdle();
      run.fab = null;   // not current: the run is generated again (fabCurrent would reuse it)
      const lt = benchLongTasks();
      lt.start();
      const t0 = performance.now();
      await previewFabrication();
      await benchPaint();
      const ms = performance.now() - t0, l = lt.stop(), f = run.fab;
      rows.push({ warm: i < warm, ms: benchMs(ms), engineMs: f ? benchMs(f.ms) : null, status: f ? f.status : "none",
        raster: f && f.snapshot ? [f.snapshot.geometry.rasterW, f.snapshot.geometry.rasterH] : null, longTaskMaxMs: benchMs(l.max), longTasks: l.count });
    }
    const lts = all.stop(), stats = pool && pool.mode === "pool" ? await pool.stats().catch(() => null) : null;
    return benchRecord("fab", { workload: "S2 (test/bench.js user12 settings)", source: src, warm, runs,
      runsMs: rows.filter((r) => !r.warm).map((r) => r.ms), warmMs: rows.filter((r) => r.warm).map((r) => r.ms), rows,
      longTaskMaxMs: benchMs(lts.max), longTasks: lts, health: pool && pool.health ? pool.health() : null, coordStats: stats }, benchEnv());
  }

  /** ?bench=draft (S3, E4 method): per family, the cold draft then warm edits sheets 8 ↔ 7, edit → painted draft. */
  async function benchDraft(family) {
    const plan = BENCH_PLAN.draft, warm = benchInt("warm", plan.warm, 0, 100), runs = benchInt("runs", plan.runs, 1, 1000);
    const fams = family === "loaded" || benchOpt("src", null) ? [family] : plan.families, all = benchLongTasks(), families = {}, every = [];
    all.start();
    for (const fam of fams) {
      const src = await benchInstall("draft", fam), rows = [];
      for (let i = 0; i < warm + runs; i++) {
        setStatus(`bench draft (${fam}): edit ${i + 1} of ${warm + runs}${i < warm ? " (warm-up)" : ""}…`, true);
        await benchIdle();
        const sheets = plan.sheets[(i + 1) % 2], before = project.revision, lt = benchLongTasks();
        lt.start();
        const t0 = performance.now();
        setLegacy("nSheets", sheets);   // the sheets control's own write (bindRange "nSheets"); a geometry change bumps the revision
        if (project.revision === before) throw new Error("the sheets edit did not change the revision");
        const rev = project.revision, wait = benchWaitDraft((c) => c.rev === rev);
        setRunState({ type: "edit" });
        regenerate();   // the debounced recompute without its 300 ms wait
        const { res } = await wait;
        await benchPaint();
        const ms = performance.now() - t0, l = lt.stop();
        rows.push({ warm: i < warm, sheets, ms: benchMs(ms), engineMs: run.draft ? benchMs(run.draft.ms) : null, status: res.status,
          code: res.error ? res.error.code : null, longTaskMaxMs: benchMs(l.max), longTasks: l.count });
      }
      const measured = rows.filter((r) => !r.warm).map((r) => r.ms);
      every.push(...measured);
      families[fam] = Object.assign(benchStats(measured), { source: src, rows, raster: run.draft && run.draft.snapshot ? [run.draft.snapshot.geometry.rasterW, run.draft.snapshot.geometry.rasterH] : null });
    }
    const lts = all.stop();
    return benchRecord("draft", { workload: "E4 (a) (test/bench.js draftProject(\"a\")), warm edit sheets 8 <-> 7", warm, runs, runsMs: every, families,
      worstFamilyP95Ms: Math.max(...Object.values(families).map((f) => f.p95Ms)), longTaskMaxMs: benchMs(lts.max), longTasks: lts,
      health: pool && pool.health ? pool.health() : null }, benchEnv());
  }

  /** ?bench=cancel (S1, NFR-02): 20 fabrication runs canceled after 50–1000 ms; cancel → settled latency and respawns. */
  async function benchCancel(family) {
    const plan = BENCH_PLAN.cancel, n = benchInt("cancels", plan.cancels, 1, 1000);
    const src = await benchInstall("cancel", family), rows = [], all = benchLongTasks();
    if (!usePool()) {
      return benchRecord("cancel", { source: src, unsupported: "no worker pool (the fallback run blocks the page and cannot be canceled)", runsMs: [],
        longTaskMaxMs: 0, longTasks: { supported: false, max: 0, count: 0 } }, benchEnv());
    }
    all.start();
    for (let i = 0; i < n; i++) {
      setStatus(`bench cancel: ${i + 1} of ${n}…`, true);
      await benchIdle();
      run.fab = null;
      const delay = plan.delaysMs[i % plan.delaysMs.length], lt = benchLongTasks();
      lt.start();
      const p = previewFabrication();
      await benchSleep(delay);
      const h0 = pool.health(), t0 = performance.now(), canceled = cancelFab("user");
      await p;
      const ms = performance.now() - t0, h1 = pool.health(), l = lt.stop();
      rows.push({ delayMs: delay, canceled, ms: benchMs(ms), watchdog: h1.watchdogKills > h0.watchdogKills,
        respawnMs: h1.lastRespawnMs !== h0.lastRespawnMs ? h1.lastRespawnMs : null, longTaskMaxMs: benchMs(l.max) });
    }
    const lts = all.stop(), done = rows.filter((r) => r.canceled);
    return benchRecord("cancel", { source: src, cancels: n, runsMs: done.map((r) => r.ms), finishedBeforeCancel: rows.length - done.length,
      watchdogKills: rows.filter((r) => r.watchdog).length, rows, longTaskMaxMs: benchMs(lts.max), longTasks: lts, health: pool.health() }, benchEnv());
  }

  /** The bench panel (created on demand; bench mode only). */
  function benchPanel(mode) {
    let el = $("bench-panel");
    if (el) return el;
    el = document.createElement("section");
    el.id = "bench-panel";
    el.setAttribute("aria-label", "Bench " + mode);
    el.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:1000;width:min(560px,calc(100vw - 24px));max-height:60vh;overflow:auto;" +
      "background:#fff;color:#111;border:1px solid #888;border-radius:6px;padding:8px 10px;font:12px/1.4 ui-monospace,monospace;box-shadow:0 2px 12px rgba(0,0,0,.25)";
    const head = document.createElement("strong");
    head.textContent = "Bench: " + mode + " ";
    const go = document.createElement("button");
    go.type = "button"; go.id = "bench-run"; go.textContent = "Run";
    const dl = document.createElement("button");
    dl.type = "button"; dl.id = "bench-download"; dl.textContent = "Download JSON"; dl.disabled = true;
    const st = document.createElement("div");
    st.id = "bench-status"; st.setAttribute("role", "status"); st.setAttribute("aria-live", "polite");
    const out = document.createElement("pre");
    out.id = "bench-result"; out.style.cssText = "white-space:pre-wrap;margin:6px 0 0";
    el.append(head, go, document.createTextNode(" "), dl, st, out);
    document.body.appendChild(el);
    return el;
  }
  function benchDownload(rec) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rec, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "shadowbox-bench-" + rec.bench + "-" + rec.at.replace(/[:.]/g, "-") + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Start the ?bench= mode: the panel, then (after the pool settled) the driver; &src=loaded waits for "Run". */
  function startBench(mode) {
    benchPanel(mode);
    const family = benchOpt("src", "realistic"), html = document.documentElement, st = $("bench-status"), out = $("bench-result");
    const go = $("bench-run"), dl = $("bench-download");
    let last = null;
    dl.addEventListener("click", () => { if (last) benchDownload(last); });
    const runIt = async () => {
      if (html.dataset.bench === "running") return;
      go.disabled = true; dl.disabled = true;
      html.dataset.bench = "running";
      st.textContent = "running…";
      try {
        if (!["realistic", "busy", "loaded"].includes(family)) throw new Error("&src must be realistic, busy or loaded");
        if (pool && pool.ready) await pool.ready.catch(() => false);
        if (pool && pool.mode === "pool" && pool.helpersReady) await pool.helpersReady.catch(() => null);
        const rec = last = await ({ fab: benchFab, draft: benchDraft, cancel: benchCancel }[mode])(family);
        out.textContent = JSON.stringify(rec, null, 2);
        st.textContent = `done: p50 ${rec.p50Ms} ms, p95 ${rec.p95Ms} ms (n ${rec.n}), longest main-thread task ${rec.longTaskMaxMs} ms` +
          (rec.longTasks && rec.longTasks.supported ? "" : " (longtask not observable here)");
        html.dataset.bench = "done";
        dl.disabled = false;
        if (benchOpt("download", null) !== null) benchDownload(rec);
      } catch (err) {
        st.textContent = "bench failed: " + (err && err.message ? err.message : String(err));
        html.dataset.bench = "error";
      } finally {
        go.disabled = false;
      }
    };
    go.addEventListener("click", runIt);
    if (family === "loaded") st.textContent = "load a source, then press Run";
    else runIt();
  }

  function init() {
    preview = SBPreview.create($("stackcanvas"));
    preview.start();

    // header
    $("projname").addEventListener("input", (e) => setLegacy("projectName", e.target.value));
    $("meta-date").textContent = new Date().toISOString().slice(0, 10);

    // photo
    $("filein").addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";   // choosing the same file again (after a refusal) must fire change again
      if (f) loadFile(f);
    });
    // PRJ-01: the demo is an explicit source button; nothing loads it automatically.
    $("btn-demo").addEventListener("click", () => {
      const gen = ++sourceGen;   // a load still decoding must not replace the demo
      showSourceProblem(null);
      if (project.title === "untitled") setProjectName("night-over-the-valley");
      acceptSource("demo scene", { bitmap: demoScene(), raw: null }, null, gen, null);
    });
    // PO-LASER-4 (G2.11b): #in-res is the fabrication pitch in mm/px. The draft raster (720 px) is not a control.
    // E3b: #in-smooth (mm) is a G2.11c control (CONTROLS, SBSchema.applyControl "smooth").
    bindPitch();
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
    pal.addEventListener("change", () => { setLegacy("palette", pal.value); showResult(run.shown); });

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

    // preview controls (#in-explode is a G2.11c view control: project.view.explodeMM, showResult only)
    // alpha.3 E11: the guides on the Layers cards (view only: no revision change, no regeneration)
    $("in-guidesvis").addEventListener("change", () => {
      if (run.shown && run.shown.snapshot) renderSheetGrid(run.shown, sheetColors(run.shown.snapshot.layers.length));
    });
    $("in-bridgesvis").addEventListener("change", (e) =>
      preview.setShowBridges(e.target.checked));
    // G2.13b: the Changes overlay on the proof (view only: no revision change, no regeneration)
    $("in-overlays").addEventListener("change", (e) => {
      preview.setShowOverlays(e.target.checked);
      // alpha.3 E5: a draft built without the overlay polygons (overlay off) is rebuilt with them (warm cache, same hash)
      if (e.target.checked && run.shown && run.shown === run.draft && run.draft.snapshot && !run.draft.overlays) regenerate();
      switchTab(preview.getMode());
    });

    // tabs
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => switchTab(t.dataset.tab)));

    // review: the staged Generate control, under the same guard as Export (canGenerate)
    $("btn-generate").addEventListener("click", regenerate);
    // G2.13c: the diagnostics focus is cleared by its button or Escape inside the list
    $("diag-clear").addEventListener("click", clearDiagnosticFocus);
    $("diag-list").addEventListener("keydown", (e) => { if (e.key === "Escape" && run.focus) { clearDiagnosticFocus(); e.preventDefault(); } });

    // export
    $("btn-export").addEventListener("click", exportBundle);
    // alpha.3 E6 (PO-PREVIEW-2): the exact fabrication run, shown in every view (reused while current)
    $("btn-fabpreview").addEventListener("click", previewFabrication);
    // speed round F15 (NFR-02): the pooled fabrication run can be canceled (the fallback run blocks the page)
    $("btn-fabcancel").addEventListener("click", () => cancelFab("user"));
    // an explicit Generate returns the views to the draft (UI-06)
    $("btn-generate").addEventListener("click", showDraft);

    // mobile rail toggle
    $("railtoggle").addEventListener("click", () =>
      document.body.classList.toggle("rail-open"));

    // keyboard reachability: tabs are buttons, ranges are native — done.
    window.addEventListener("resize", () => preview.redraw());

    // Show the running version in the title block so a user can confirm which
    // build they have after an update.
    const verEl = $("meta-version");
    if (verEl) verEl.textContent = "v" + APP_VERSION;

    // speed round F15 (PO-PERF-1): the worker pool, before the first run (a fallback notice shows at once)
    startPool();
    // PRJ-01: open empty. Export stays disabled with "Choose a source" until a photo or the Demo scene is chosen.
    regenerate();
    // speed round F16a: ?bench=fab|draft|cancel (inert without the query)
    if (BENCH) startBench(BENCH);

    registerServiceWorker();
    requestPersistentStorage();
  }

  /**
   * DEP-02 (G4.0 minimal, speed round F10 / F-D3): there is no autosave yet (PRJ-05), so the project counts as unsaved
   * from the first edit or source until a package is downloaded; the mark is the project and source generation at
   * start-up or at the last delivered export.
   */
  let savedMark = null;
  const projectMark = () => JSON.stringify(project) + "#" + sourceGen;
  function markSaved() { savedMark = projectMark(); }
  function hasUnsavedWork() { return savedMark !== null && projectMark() !== savedMark; }

  /**
   * DEP-02: true when a waiting service worker may take over: nothing unsaved, no export being built and no
   * fabrication run in flight (an update never interrupts a project or mixes engine assets from two releases).
   */
  function updateReady() {
    const exp = $("btn-export");
    return !hasUnsavedWork() && !(exp && exp.dataset.busy === "1") && !fabInFlight;
  }

  /**
   * DEP-02: show "Update available — reload" in the status bar while a new version is waiting and updateReady()
   * holds; the click asks the waiting worker to activate ({type: "skipWaiting"}) and the page reloads on the
   * controller change. Re-checked on a slow timer, so the offer appears once the work is saved or the run ends.
   */
  let waitingWorker = null, updateTimer = null, updateRequested = false;
  function offerUpdate() {
    const bar = document.querySelector(".statusbar");
    let btn = $("btn-update");
    const show = !!waitingWorker && updateReady();
    if (show && !btn && bar) {
      btn = document.createElement("button");
      btn.id = "btn-update";
      btn.type = "button";
      btn.className = "btn";
      btn.style.marginLeft = "12px";
      btn.textContent = "Update available — reload";
      btn.addEventListener("click", () => {
        if (!waitingWorker || !updateReady()) { offerUpdate(); return; }
        updateRequested = true;
        waitingWorker.postMessage({ type: "skipWaiting" });
      });
      bar.appendChild(btn);
    }
    if (btn) btn.hidden = !show;
    if (waitingWorker && !updateTimer) updateTimer = setInterval(offerUpdate, 2000);
  }

  /**
   * Register the offline service worker. Only meaningful over http(s); when the
   * bundle is opened directly from a file:// path the app still runs fully, it
   * just isn't installable — so we register defensively and ignore failures.
   * DEP-02: a new version waits (sw.js never calls skipWaiting on install) until the user takes the update offer.
   */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol === "file:") return;
    // Local dev hosts: skip the SW so manual checks never run against a cached
    // older shell.
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return;
    markSaved();
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        const track = (w) => {
          if (!w) return;
          const check = () => {
            // a waiting worker with a controller present is an update (the first install has no controller)
            if (w.state === "installed" && navigator.serviceWorker.controller) { waitingWorker = w; offerUpdate(); }
          };
          w.addEventListener("statechange", check);
          check();
        };
        track(reg.waiting);
        reg.addEventListener("updatefound", () => track(reg.installing));
      }).catch(() => {
        /* offline support unavailable; app still works online */
      });
      // reload onto the new version only when the user asked for it (never on another tab's or the first activation)
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (updateRequested) window.location.reload();
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
