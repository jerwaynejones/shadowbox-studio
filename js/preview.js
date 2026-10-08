/* ============================================================================
 * Shadowbox Studio — preview.js
 * ----------------------------------------------------------------------------
 * The review views of the assembled stack, in three modes (G2.12, UI-02/03):
 *
 *   proof    the opaque proof: each layer's material polygons (SBProof.model) drawn in
 *            the shared page frame, back to front, with no image smoothing, no shadows
 *            and no parallax or explode offsets. It matches proof.svg (assemblySVG).
 *   section  a stack section across the page at one y (SBProof.section): every layer's
 *            material spans at its real Z band (thickness t, gap g), with width and height
 *            dimension lines, Z ticks and a page gauge at the right edge that marks the
 *            section line (the gauge spans the canvas height, so a vertical drag maps the
 *            pointer to the page y it points at on the gauge).
 *   tilt     illustrative only: the same layers composited with a parallax offset driven
 *            by pointer position (drag to tilt), a soft drop shadow per layer and the
 *            explode spread. Nothing here is a measurement.
 *
 * G2.13b: setOverlays() takes the SBProof.overlays model. With the Changes overlay on (setShowOverlays), the
 * proof view adds cleanup-added material in green, removed material as a dashed outline, unsupported regions in red
 * with a "!" icon and bridges in amber (connected mode, #in-bridgesvis), plus a per-layer mm² legend. Off by
 * default, so the proof stays the material alone. Overlay bridges also replace the mask bridges in the tilt view.
 *
 * G2.13c: setFocus() takes a diagnostics-panel focus {layer, parts, regions, label}: the proof veils the stack, redraws
 * that layer on top and outlines its parts and regions with a dark-and-light double stroke and a text tag.
 *
 * G2.13d: drawClipCard() draws one layer's card with the area a reviewed clip would remove (the clip dialog).
 *
 * setSnapshot() rasterizes each layer's Path2D (from the µm rings) once per snapshot into
 * an offscreen canvas; frames only composite. The explode slider is display-only: it moves
 * layers in the tilt view and never touches geometry. setSheets() keeps the v1.1.0 raster
 * path for callers that have only masks.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const P = {};
  const RASTER_MAX_PX = 1600;           // long side of each per-layer offscreen canvas
  const BED = "#171D24";                // waste / laser bed
  const AMBER = "#F0A227";
  // G2.13b change overlays (proof view): added material, removed outline, unsupported region (GEO-08, UI-05)
  const OV_ADDED = "rgba(46,204,113,0.55)";
  const OV_REMOVED = "#F4F7FA";
  const OV_UNSUPPORTED = "#E5484D";
  const OV_DASH = [5, 4];
  // G2.13c diagnostics focus (proof view): veil over the stack, double stroke and a text tag
  const FOCUS_VEIL = "rgba(10,16,24,0.62)";
  const FOCUS_DARK = "#0A1018";
  const FOCUS_LIGHT = "#FFFFFF";
  const FOCUS_TAG = "rgba(10,16,24,0.85)";
  const CLIP_FILL = "rgba(229,72,77,0.55)";   // G2.13d: the area a clip would remove (plus a dashed outline)
  const HATCH = "rgba(255,255,255,0.16)";   // waste hatch strokes on the bed colour
  const HATCH_PX = 7;                       // hatch pitch in card pixels
  const CARD_MAX_PX = 480;                  // long side of a layer card canvas

  /**
   * The waste hatch (G2.13a): the bed colour with 45° strokes, so waste reads as waste without relying on
   * colour alone. Material is drawn over it; wherever the layer image is transparent the hatch shows.
   */
  P.drawWasteHatch = function (c, w, h) {
    c.fillStyle = BED;
    c.fillRect(0, 0, w, h);
    c.save();
    c.strokeStyle = HATCH;
    c.lineWidth = 1;
    c.beginPath();
    for (let d = -h; d < w; d += HATCH_PX) { c.moveTo(d, h); c.lineTo(d + h, 0); }
    c.stroke();
    c.restore();
  };

  /**
   * Create a preview controller bound to a canvas element.
   * Call setSnapshot() (or legacy setSheets()) after each pipeline run, then start().
   */
  P.create = function (canvas) {
    const ctx = canvas.getContext("2d");
    const state = {
      mode: "proof",
      layers: [],        // legacy raster: [{canvas, bridgeCanvas}]
      w: 0, h: 0,
      snap: null,        // {page, tMM, gMM, model, images: [{layerIndex, canvas}], bridges: [canvas|null], section, sectionY}
      tiltX: 0.35, tiltY: -0.25,   // resting pose: slightly off-axis
      targetX: 0.35, targetY: -0.25,
      explode: 0,        // 0..1
      showBridges: true,
      overlays: null,      // G2.13b: SBProof.overlays model, plus per-layer page-sized bridge canvases (tilt)
      overlayBridges: [],
      showOverlays: false,
      focus: null,         // G2.13c: {layer, parts, regions, label} highlighted in the proof (diagnostics panel)
      dragging: false,
      running: false,
      dirty: true,
    };

    // ---- pointer interaction: drag to tilt (tilt) or move the section line (section)
    const onDown = (e) => { state.dragging = true; move(e); };
    const onUp = () => { state.dragging = false; };
    const move = (e) => {
      if (!state.dragging) return;
      const r = canvas.getBoundingClientRect();
      const pt = e.touches ? e.touches[0] : e;
      const fx = (pt.clientX - r.left) / r.width, fy = (pt.clientY - r.top) / r.height;
      if (state.mode === "tilt") {
        state.targetX = (fx - 0.5) * 2;
        state.targetY = (fy - 0.5) * 2;
      } else if (state.mode === "section" && state.snap) {
        const hMM = state.snap.page.hMM;
        setSectionY(Math.round(Math.min(1, Math.max(0, fy)) * hMM * 10) / 10);
      } else return;
      if (e.cancelable) e.preventDefault();
    };
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", move);
    global.addEventListener("mouseup", onUp);
    canvas.addEventListener("touchstart", onDown, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", onUp);

    /**
     * Legacy raster path (v1.1.0).
     * @param {Array} sheets   [{mask, bridges}] back → front
     * @param {string[]} colors  hex per sheet
     */
    function setSheets(sheets, colors, w, h) {
      state.w = w; state.h = h;
      state.layers = sheets.map((sheet, s) => ({
        canvas: maskToCanvas(sheet.mask, w, h, colors[s], s === 0),
        bridgeCanvas: sheet.bridges && hasAny(sheet.bridges)
          ? maskToCanvas(sheet.bridges, w, h, AMBER, false)
          : null,
      }));
      state.overlays = null; state.overlayBridges = [];
      state.focus = null;
      state.snap = null;   // the raster replaces any polygon snapshot (interim view while the polygons build)
      state.dirty = true;
    }

    /**
     * The polygon views (G2.12).
     * @param {{page: {wMM, hMM, frameMM?}, layers: MaterialLayer[], tMM: number, gMM: number}} snap
     * @param {string|string[]} colors  one hex (uniform) or a palette indexed by layer.index
     * @param {{bridges?: {masks: Uint8Array[], w, h}}} [opts]  amber bridge highlight (tilt view only), masks over the art area
     */
    function setSnapshot(snap, colors, opts) {
      const o = opts || {};
      const model = global.SBProof.model(snap.layers, colors, {});
      const page = snap.page;
      const k = Math.min(RASTER_MAX_PX / page.wMM, RASTER_MAX_PX / page.hMM) / 1000; // px per µm
      const W = Math.max(1, Math.round(page.wMM * 1000 * k)), H = Math.max(1, Math.round(page.hMM * 1000 * k));
      const images = model.map((e) => ({ layerIndex: e.layerIndex, canvas: pathToCanvas(e, W, H, k) }));
      const fills = {};
      for (const e of model) fills[e.layerIndex] = e.fill;
      let bridges = [];
      const b = o.bridges;
      if (b && Array.isArray(b.masks)) {
        bridges = b.masks.map((m) => (m && hasAny(m) ? maskToCanvas(m, b.w, b.h, AMBER, false) : null));
      }
      const prevY = state.snap && state.snap.page.hMM === page.hMM ? state.snap.sectionY : page.hMM / 2;
      state.snap = { page, tMM: snap.tMM, gMM: snap.gMM, layers: snap.layers, model, fills, images, bridges, sectionY: prevY, section: null };
      state.overlays = null; state.overlayBridges = [];   // G2.13b: overlays belong to one snapshot; setOverlays after this
      state.focus = null;   // G2.13c: a focus belongs to the diagnostics of one snapshot
      setSectionY(prevY);
      state.dirty = true;
    }

    /**
     * G2.13a: draw one layer's card from the per-snapshot offscreen cache (no re-rasterization): the waste as a
     * hatch on the bed colour, then the layer's cached material image, with the proof's draw parameters (no
     * smoothing). The card canvas takes the page aspect, long side opts.maxPx (default 480). A layer with no
     * material is hatch only. Returns false (and draws nothing) when there is no polygon snapshot.
     */
    function drawCard(cardCanvas, layerIndex, opts) {
      const s = state.snap;
      if (!s) return false;
      const maxPx = (opts && opts.maxPx) || CARD_MAX_PX;
      const k = maxPx / Math.max(s.page.wMM, s.page.hMM);
      const w = Math.max(1, Math.round(s.page.wMM * k)), h = Math.max(1, Math.round(s.page.hMM * k));
      cardCanvas.width = w; cardCanvas.height = h;
      const c = cardCanvas.getContext("2d");
      P.drawWasteHatch(c, w, h);
      const im = s.images.find((e) => e.layerIndex === layerIndex);
      if (im) {
        c.imageSmoothingEnabled = global.SBProof.drawParams("proof").smoothing;
        c.drawImage(im.canvas, 0, 0, w, h);
      }
      return true;
    }

    /**
     * G2.13d (SUP-04): the clip dialog's card: the waste hatch, the lower layer (layerIndex − 1) dimmed for context, the
     * layer itself (both from the per-snapshot cache), then the area the clip would remove (µm
     * polygons, page frame) filled in translucent red and outlined dashed in a dark-and-light double stroke, so the
     * removed area does not rely on colour alone. Returns false (and draws nothing) without a polygon snapshot.
     */
    function drawClipCard(cardCanvas, layerIndex, removed, opts) {
      if (!drawCard(cardCanvas, layerIndex, opts)) return false;
      const s = state.snap, c = cardCanvas.getContext("2d");
      const lo = s.images.find((e) => e.layerIndex === layerIndex - 1), up = s.images.find((e) => e.layerIndex === layerIndex);
      if (lo) {   // redraw: hatch, lower layer dimmed, then the layer on top
        P.drawWasteHatch(c, cardCanvas.width, cardCanvas.height);
        c.save();
        c.imageSmoothingEnabled = global.SBProof.drawParams("proof").smoothing;
        c.globalAlpha = 0.4;
        c.drawImage(lo.canvas, 0, 0, cardCanvas.width, cardCanvas.height);
        c.globalAlpha = 1;
        if (up) c.drawImage(up.canvas, 0, 0, cardCanvas.width, cardCanvas.height);
        c.restore();
      }
      const k = cardCanvas.width / (s.page.wMM * 1000);   // card px per µm
      const path = new Path2D();
      for (const p of removed || []) for (const r of [p.outer].concat(p.holes || [])) {
        path.moveTo(r[0] * k, r[1] * k);
        for (let i = 2; i + 1 < r.length; i += 2) path.lineTo(r[i] * k, r[i + 1] * k);
        path.closePath();
      }
      c.save();
      c.fillStyle = CLIP_FILL;
      c.fill(path, "evenodd");
      c.lineWidth = 3; c.strokeStyle = FOCUS_DARK; c.setLineDash([]); c.stroke(path);
      c.lineWidth = 1.5; c.strokeStyle = FOCUS_LIGHT; c.setLineDash(OV_DASH); c.stroke(path);
      c.restore();
      return true;
    }

    /**
     * G2.13b: the change overlays (SBProof.overlays). Bridge polygons are rasterized once here into page-sized
     * canvases for the tilt view; the proof draws the overlay vectors per frame. null clears them.
     */
    function setOverlays(ov) {
      state.overlays = ov || null;
      state.overlayBridges = [];
      const s = state.snap;
      if (ov && s) {
        const page = s.page;
        const k = Math.min(RASTER_MAX_PX / page.wMM, RASTER_MAX_PX / page.hMM) / 1000;
        const W = Math.max(1, Math.round(page.wMM * 1000 * k)), H = Math.max(1, Math.round(page.hMM * 1000 * k));
        for (const e of ov) if (e.bridges && e.bridges.length) {
          const rings = [];
          for (const p of e.bridges) { rings.push(p.outer); for (const h of p.holes || []) rings.push(h); }
          state.overlayBridges[e.layerIndex] = pathToCanvas({ rings, fill: AMBER, stroke: null }, W, H, k);
        }
      }
      state.dirty = true;
    }

    /** Trace PolygonWithHoles[] (µm) onto ctx as one path, mapped by (ox, oy, s px per µm). */
    function polyPath(polys, ox, oy, sc) {
      ctx.beginPath();
      for (const p of polys) for (const r of [p.outer].concat(p.holes || [])) {
        ctx.moveTo(ox + r[0] * sc, oy + r[1] * sc);
        for (let i = 2; i + 1 < r.length; i += 2) ctx.lineTo(ox + r[i] * sc, oy + r[i + 1] * sc);
        ctx.closePath();
      }
    }

    /** Proof-view change overlays over the page drawn at (ox, oy) with dw px for page.wMM. */
    function drawOverlays(ox, oy, dw) {
      const s = state.snap, ov = state.overlays;
      if (!s || !ov || !state.showOverlays) return;
      const sc = dw / (s.page.wMM * 1000);   // px per µm
      ctx.save();
      for (const e of ov) {
        if (e.added) { polyPath(e.added, ox, oy, sc); ctx.fillStyle = OV_ADDED; ctx.fill("evenodd"); }
        if (e.bridges && state.showBridges) { polyPath(e.bridges, ox, oy, sc); ctx.fillStyle = AMBER; ctx.fill("evenodd"); }
        if (e.removed) {
          polyPath(e.removed, ox, oy, sc);
          ctx.setLineDash(OV_DASH); ctx.strokeStyle = OV_REMOVED; ctx.lineWidth = 1.25; ctx.stroke(); ctx.setLineDash([]);
        }
        for (const u of e.unsupported) {
          if (!u.region) continue;
          const [x0, y0, x1, y1] = u.region.map((v) => v * 1000 * sc);
          ctx.strokeStyle = OV_UNSUPPORTED; ctx.lineWidth = 2;
          ctx.strokeRect(ox + x0, oy + y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
          const cx = ox + (x0 + x1) / 2, cy = oy + (y0 + y1) / 2;
          ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 2 * Math.PI); ctx.fillStyle = OV_UNSUPPORTED; ctx.fill();
          ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 12px system-ui, sans-serif"; ctx.fillText("!", cx - 2, cy + 4);
        }
      }
      // Legend: per-layer changed area in mm² and part counts (text, so the overlay never relies on colour alone).
      ctx.font = "11px ui-monospace, monospace";
      let ly = oy + 14;
      for (const e of ov) {
        const t = e.label + (e.unsupported.length ? (e.label ? " / " : "") + e.unsupported.length + " unsupported" : "");
        if (!t) continue;
        const line = "Layer " + (e.layerIndex + 1) + ": " + t;
        ctx.fillStyle = "rgba(10,16,24,0.75)"; ctx.fillRect(ox + 4, ly - 11, ctx.measureText(line).width + 8, 15);
        ctx.fillStyle = "#F4F7FA"; ctx.fillText(line, ox + 8, ly);
        ly += 16;
      }
      ctx.restore();
    }

    /**
     * G2.13c (UI-04): focus one layer (and parts / regions) from the diagnostics panel. f = {layer, parts: string[],
     * regions: [[x0, y0, x1, y1] mm, page frame], label?} or null to clear. The proof then veils the rest of the stack,
     * draws the focused layer again on top, outlines its listed parts and the regions with a dark-and-light double
     * stroke, and names the focus in text. Proof only; a new snapshot clears it. FOCUS on a layer not in the snapshot.
     */
    function setFocus(f) {
      if (f === null || f === undefined) { state.focus = null; state.dirty = true; return; }
      const s = state.snap;
      if (!s) throw new Error("SBPreview.setFocus: FOCUS — no polygon snapshot");
      if (!f || !Number.isInteger(f.layer) || !s.layers.some((L) => L.index === f.layer))
        throw new Error("SBPreview.setFocus: FOCUS — layer " + (f && f.layer) + " is not in the snapshot");
      state.focus = { layer: f.layer, parts: Array.isArray(f.parts) ? f.parts.slice() : [],
        regions: Array.isArray(f.regions) ? f.regions.filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite)) : [],
        label: typeof f.label === "string" && f.label ? f.label : "Layer " + (f.layer + 1) };
      state.dirty = true;
    }

    /** Proof-view focus (G2.13c) over the page drawn at (ox, oy) with dw × dh px. */
    function drawFocus(ox, oy, dw, dh) {
      const s = state.snap, f = state.focus;
      if (!s || !f) return;
      const sc = dw / (s.page.wMM * 1000);   // px per µm
      ctx.save();
      ctx.fillStyle = FOCUS_VEIL; ctx.fillRect(ox, oy, dw, dh);
      const im = s.images.find((e) => e.layerIndex === f.layer);
      if (im) { ctx.imageSmoothingEnabled = global.SBProof.drawParams("proof").smoothing; ctx.drawImage(im.canvas, ox, oy, dw, dh); }
      const L = s.layers.find((x) => x.index === f.layer);
      const want = new Set(f.parts);
      const polys = want.size && L && L.parts ? L.parts.filter((p) => want.has(p.id)).map((p) => p.polygon) : [];
      const twice = (draw) => { ctx.strokeStyle = FOCUS_DARK; ctx.lineWidth = 4; draw(); ctx.strokeStyle = FOCUS_LIGHT; ctx.lineWidth = 2; draw(); };
      if (polys.length) { polyPath(polys, ox, oy, sc); twice(() => ctx.stroke()); }
      for (const r of f.regions) {
        const x0 = ox + r[0] * 1000 * sc - 4, y0 = oy + r[1] * 1000 * sc - 4;
        const w = Math.max(8, (r[2] - r[0]) * 1000 * sc + 8), h = Math.max(8, (r[3] - r[1]) * 1000 * sc + 8);
        twice(() => ctx.strokeRect(x0, y0, w, h));
      }
      ctx.font = "bold 12px system-ui, sans-serif";
      const tw = ctx.measureText(f.label).width;
      ctx.fillStyle = FOCUS_TAG; ctx.fillRect(ox + dw - tw - 14, oy + 4, tw + 10, 18);
      ctx.fillStyle = FOCUS_LIGHT; ctx.fillText(f.label, ox + dw - tw - 9, oy + 17);
      ctx.restore();
    }

    function setSectionY(yMM) {
      const s = state.snap;
      if (!s) return;
      s.sectionY = yMM;
      s.section = global.SBProof.section(s.layers, yMM, { tMM: s.tMM, gMM: s.gMM });
      state.dirty = true;
    }

    /** One layer's even-odd material, rasterized once into a page-sized offscreen canvas. */
    function pathToCanvas(entry, W, H, k) {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const cc = c.getContext("2d");
      cc.setTransform(k, 0, 0, k, 0, 0);
      const path = new Path2D();
      for (const r of entry.rings) {
        path.moveTo(r[0], r[1]);
        for (let i = 2; i + 1 < r.length; i += 2) path.lineTo(r[i], r[i + 1]);
        path.closePath();
      }
      cc.fillStyle = entry.fill;
      cc.fill(path, "evenodd");
      if (entry.stroke) {
        cc.strokeStyle = entry.stroke;
        cc.lineWidth = Math.max(200, 1 / k);   // 0.2 mm, at least one device pixel
        cc.lineJoin = "round";
        cc.stroke(path);
      }
      return c;
    }

    function maskToCanvas(mask, w, h, hex, solid) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const cc = c.getContext("2d");
      const img = cc.createImageData(w, h);
      const [r, g, b] = SBUtil.hexToRgb(hex);
      for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
        const on = solid || mask[i];
        img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b;
        img.data[p + 3] = on ? 255 : 0;
      }
      cc.putImageData(img, 0, 0);
      return c;
    }

    function hasAny(arr) {
      for (let i = 0; i < arr.length; i++) if (arr[i]) return 1;
      return 0;
    }

    function frame() {
      if (!state.running) return;
      // Ease toward target tilt; skip repaint when settled and clean.
      const k = 0.12;
      const moved =
        Math.abs(state.targetX - state.tiltX) > 0.001 ||
        Math.abs(state.targetY - state.tiltY) > 0.001;
      state.tiltX += (state.targetX - state.tiltX) * k;
      state.tiltY += (state.targetY - state.tiltY) * k;
      if ((moved && state.mode === "tilt") || state.dirty) { draw(); state.dirty = false; }
      requestAnimationFrame(frame);
    }

    function draw() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr; canvas.height = ch * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      if (state.snap) {
        if (state.mode === "section") drawSection(cw, ch);
        else drawLayers(cw, ch, state.snap.page.wMM, state.snap.page.hMM,
          state.snap.images.map((im) => ({ canvas: im.canvas, bridge: state.overlayBridges[im.layerIndex] || state.snap.bridges[im.layerIndex] || null,
            pageBridge: !!state.overlayBridges[im.layerIndex] })),
          state.snap.page.frameMM || 0);
      } else if (state.layers.length) {
        drawLayers(cw, ch, state.w, state.h, state.layers.map((l) => ({ canvas: l.canvas, bridge: l.bridgeCanvas })), null);
      }
    }

    /**
     * proof / tilt composite. pageW/pageH are the drawn extent (mm for a snapshot, px for the legacy raster).
     * frameMM (snapshot only) places the bridge masks, which cover the art area inside the frame.
     */
    function drawLayers(cw, ch, pageW, pageH, items, frameMM) {
      const dp = global.SBProof.drawParams(state.mode === "section" ? "proof" : state.mode);
      // Fit the page into the canvas; tilt leaves breathing room for the parallax throw.
      const pad = dp.parallax ? 0.86 : 0.94;
      const scale = Math.min((cw * pad) / pageW, (ch * pad) / pageH);
      const dw = pageW * scale, dh = pageH * scale;
      const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
      const n = items.length;
      const throwPx = dp.parallax ? Math.min(cw, ch) * 0.035 : 0;          // parallax per layer
      const explodePx = dp.parallax ? state.explode * Math.min(cw, ch) * 0.06 : 0; // explode: display-only
      if (!dp.illustrative) { ctx.fillStyle = BED; ctx.fillRect(ox, oy, dw, dh); } // waste shows as the bed

      for (let s = 0; s < n; s++) {
        const depth = s - (n - 1) / 2;
        const dx = -state.tiltX * depth * throwPx;
        const dy = -state.tiltY * depth * throwPx - s * explodePx;
        ctx.save();
        if (dp.shadows) {
          ctx.shadowColor = "rgba(10,16,24,0.45)";
          ctx.shadowBlur = 6 + s * 2;
          ctx.shadowOffsetX = state.tiltX * 4;
          ctx.shadowOffsetY = 5 + state.tiltY * 4;
        } else {
          ctx.shadowColor = "rgba(0,0,0,0)";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }
        ctx.imageSmoothingEnabled = dp.smoothing;
        ctx.drawImage(items[s].canvas, ox + dx, oy + dy, dw, dh);
        ctx.restore();
        // Bridge highlight: illustrative views only, so the proof stays the material alone.
        if (dp.illustrative && state.showBridges && items[s].bridge) {
          const f = frameMM === null || items[s].pageBridge ? 0 : frameMM * scale;   // overlay bridges are page-sized
          ctx.drawImage(items[s].bridge, ox + dx + f, oy + dy + f, dw - 2 * f, dh - 2 * f);
        }
      }
      if (state.mode === "proof") { drawOverlays(ox, oy, dw); drawFocus(ox, oy, dw, dh); }
    }

    /**
     * Dimensioned stack section: x across the page (mm), z up, real t and g (UI-03). Below the bars a width
     * dimension line, left of them a height dimension line with Z ticks; at the right edge a page gauge (top of
     * the canvas = page top, bottom = page bottom) marks where the section line sits on the page.
     * Only the background and the bars use fillRect (one per interval); dimensions are stroked lines.
     */
    function drawSection(cw, ch) {
      const s = state.snap, sec = s.section || [];
      const zMax = sec.length ? sec[sec.length - 1].z1 : s.tMM;
      const padL = 64, padR = 56, padT = 40, padB = 64;
      const scale = Math.min((cw - padL - padR) / s.page.wMM, (ch - padT - padB) / Math.max(zMax, 1e-6));
      const ox = padL, base = padT + zMax * scale, right = ox + s.page.wMM * scale, top = base - zMax * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(ox, top, s.page.wMM * scale, zMax * scale);
      for (const r of sec) {
        ctx.fillStyle = s.fills[r.layerIndex] || "#3a4450";
        const y = base - r.z1 * scale, hgt = Math.max(1, (r.z1 - r.z0) * scale);
        for (const [x0, x1] of r.intervals) ctx.fillRect(ox + x0 * scale, y, Math.max(1, (x1 - x0) * scale), hgt);
      }
      const line = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
      ctx.strokeStyle = "#C9D3DD";
      ctx.lineWidth = 1;
      // Width dimension line: extension lines down from the page edges, the dimension line with end ticks, the value.
      const dy = base + 14;
      line(ox, base + 2, ox, dy + 4); line(right, base + 2, right, dy + 4);
      line(ox, dy, right, dy); line(ox - 3, dy + 3, ox + 3, dy - 3); line(right - 3, dy + 3, right + 3, dy - 3);
      // Height dimension line: left of the Z ticks' labels' column, from z = 0 to the stack top.
      const dx = padL - 10;
      line(dx - 4, base, ox - 2, base); line(dx - 4, top, ox - 2, top);
      line(dx, base, dx, top); line(dx - 3, base + 3, dx + 3, base - 3); line(dx - 3, top + 3, dx + 3, top - 3);
      // Z ticks per layer top.
      for (const r of sec) { const ty = base - r.z1 * scale; line(ox - 6, ty, ox, ty); }
      ctx.fillStyle = "#C9D3DD";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("0", 6, base + 4);
      let lastY = base;   // skip a tick label that would overlap the previous one
      for (const r of sec) {
        const ty = base - r.z1 * scale;
        if (lastY - ty >= 12) { ctx.fillText(SBUtil.fmt(r.z1, 2), 6, ty + 4); lastY = ty; }
      }
      ctx.fillText(`${SBUtil.fmt(s.page.wMM, 1)} mm`, (ox + right) / 2 - 24, dy + 16);
      ctx.fillText(
        `section at y = ${SBUtil.fmt(s.sectionY, 1)} mm · t = ${SBUtil.fmt(s.tMM, 2)} mm · g = ${SBUtil.fmt(s.gMM, 2)} mm · ` +
        `height ${SBUtil.fmt(zMax, 2)} mm`, padL, padT - 16);
      // Page gauge: full canvas height = page height, so the drag mapping (pointer y → page y) is geometric here.
      const gx = cw - 30, gw = 14, gy = 0.5, gh = ch - 1, my = gy + (s.sectionY / s.page.hMM) * gh;
      ctx.strokeRect(gx, gy, gw, gh);
      ctx.strokeStyle = "#F0A227";
      ctx.lineWidth = 2;
      line(gx - 6, my, gx + gw + 6, my);
      ctx.fillStyle = "#C9D3DD";
      ctx.fillText("page", gx - 4, gy + 14);
      ctx.fillText("drag up/down: the amber mark on the page gauge is the section line", padL, dy + 36);
    }

    return {
      setSheets,
      setSnapshot,
      drawCard,
      drawClipCard,
      /** True while the polygon snapshot (not the interim raster) is the source of the views and cards. */
      hasSnapshot() { return !!state.snap; },
      /** "proof" | "section" | "tilt" (SBProof.drawParams validates the name). */
      setMode(mode) { global.SBProof.drawParams(mode); state.mode = mode; state.dirty = true; },
      getMode() { return state.mode; },
      setSectionY,
      start() { if (!state.running) { state.running = true; frame(); } },
      stop() { state.running = false; },
      setExplode(v) { state.explode = v; state.dirty = true; },
      setShowBridges(v) { state.showBridges = v; state.dirty = true; },
      setOverlays,
      /** G2.13b: the Changes overlay on the proof (off by default). */
      setShowOverlays(v) { state.showOverlays = !!v; state.dirty = true; },
      setFocus,
      redraw() { state.dirty = true; },
      /**
       * Snapshot a composite for the export bundle. mode ("proof" | "section" | "tilt") draws that view for the
       * capture and then restores the active one; omitted, the active view is captured.
       */
      snapshot(mode) {
        return new Promise((resolve) => {
          const active = state.mode;
          if (mode !== undefined) { global.SBProof.drawParams(mode); state.mode = mode; }
          draw();
          state.mode = active;
          state.dirty = true;
          canvas.toBlob((b) => resolve(b), "image/png");
        });
      },
    };
  };

  global.SBPreview = P;
})(typeof window !== "undefined" ? window : globalThis);
