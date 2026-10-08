/* ============================================================================
 * Shadowbox Studio — preview.js
 * ----------------------------------------------------------------------------
 * The review views of the assembled stack, in three modes (G2.12, UI-02/03):
 *
 *   proof    the opaque proof: each layer's material polygons (SBProof.model) drawn in
 *            the shared page frame, back to front, with no image smoothing, no shadows
 *            and no parallax or explode offsets. It matches proof.svg (assemblySVG).
 *   section  a stack section across the page at one y (SBProof.section): every layer's
 *            material spans at its real Z band (thickness t, gap g), dimensioned.
 *   tilt     illustrative only: the same layers composited with a parallax offset driven
 *            by pointer position (drag to tilt), a soft drop shadow per layer and the
 *            explode spread. Nothing here is a measurement.
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
      setSectionY(prevY);
      state.dirty = true;
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
          state.snap.images.map((im) => ({ canvas: im.canvas, bridge: state.snap.bridges[im.layerIndex] || null })),
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
          const f = frameMM === null ? 0 : frameMM * scale;
          ctx.drawImage(items[s].bridge, ox + dx + f, oy + dy + f, dw - 2 * f, dh - 2 * f);
        }
      }
    }

    /** Dimensioned stack section: x across the page (mm), z up, real t and g (UI-03). */
    function drawSection(cw, ch) {
      const s = state.snap, sec = s.section || [];
      const zMax = sec.length ? sec[sec.length - 1].z1 : s.tMM;
      const padL = 64, padR = 24, padT = 40, padB = 48;
      const scale = Math.min((cw - padL - padR) / s.page.wMM, (ch - padT - padB) / Math.max(zMax, 1e-6));
      const ox = padL, base = padT + zMax * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(ox, padT, s.page.wMM * scale, zMax * scale);
      for (const r of sec) {
        ctx.fillStyle = s.fills[r.layerIndex] || "#3a4450";
        const y = base - r.z1 * scale, hgt = Math.max(1, (r.z1 - r.z0) * scale);
        for (const [x0, x1] of r.intervals) ctx.fillRect(ox + x0 * scale, y, Math.max(1, (x1 - x0) * scale), hgt);
      }
      // Dimensions: Z ticks per layer, and the t / g / total callouts.
      ctx.fillStyle = "#C9D3DD";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("0", 6, base + 4);
      let lastY = base;   // skip a tick label that would overlap the previous one
      for (const r of sec) {
        const ty = base - r.z1 * scale;
        if (lastY - ty >= 12) { ctx.fillText(SBUtil.fmt(r.z1, 2), 6, ty + 4); lastY = ty; }
      }
      ctx.fillText(
        `section at y = ${SBUtil.fmt(s.sectionY, 1)} mm · t = ${SBUtil.fmt(s.tMM, 2)} mm · g = ${SBUtil.fmt(s.gMM, 2)} mm · ` +
        `height ${SBUtil.fmt(zMax, 2)} mm · width ${SBUtil.fmt(s.page.wMM, 1)} mm`, padL, padT - 16);
      ctx.fillText("drag up/down to move the section line", padL, base + 28);
    }

    return {
      setSheets,
      setSnapshot,
      /** "proof" | "section" | "tilt" (SBProof.drawParams validates the name). */
      setMode(mode) { global.SBProof.drawParams(mode); state.mode = mode; state.dirty = true; },
      getMode() { return state.mode; },
      setSectionY,
      start() { if (!state.running) { state.running = true; frame(); } },
      stop() { state.running = false; },
      setExplode(v) { state.explode = v; state.dirty = true; },
      setShowBridges(v) { state.showBridges = v; state.dirty = true; },
      redraw() { state.dirty = true; },
      /** Snapshot the current composite for the export bundle. */
      snapshot() {
        return new Promise((resolve) => {
          draw();
          canvas.toBlob((b) => resolve(b), "image/png");
        });
      },
    };
  };

  global.SBPreview = P;
})(typeof window !== "undefined" ? window : globalThis);
