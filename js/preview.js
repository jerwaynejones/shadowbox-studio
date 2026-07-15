/* ============================================================================
 * Shadowbox Studio — preview.js
 * ----------------------------------------------------------------------------
 * The signature view: a live render of the assembled shadowbox.
 *
 * Each sheet mask is rasterized once into an offscreen canvas tinted with its
 * acrylic color. On every animation frame the sheets are composited back to
 * front with a parallax offset driven by pointer position (drag to tilt) and
 * a soft drop shadow per sheet, so the physical depth of the stack reads on
 * screen. An "explode" slider spreads the sheets apart for inspection, and
 * bridges can be highlighted in amber to audit every structural fix.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const P = {};

  /**
   * Create a preview controller bound to a canvas element.
   * Call setSheets() after each pipeline run, then start().
   */
  P.create = function (canvas) {
    const ctx = canvas.getContext("2d");
    const state = {
      layers: [],        // [{canvas, bridgeCanvas}]
      w: 0, h: 0,
      tiltX: 0.35, tiltY: -0.25,   // resting pose: slightly off-axis
      targetX: 0.35, targetY: -0.25,
      explode: 0,        // 0..1
      showBridges: true,
      dragging: false,
      running: false,
      dirty: true,
    };

    // ---- pointer interaction: drag to tilt --------------------------------
    const onDown = (e) => { state.dragging = true; move(e); };
    const onUp = () => { state.dragging = false; };
    const move = (e) => {
      if (!state.dragging) return;
      const r = canvas.getBoundingClientRect();
      const pt = e.touches ? e.touches[0] : e;
      state.targetX = ((pt.clientX - r.left) / r.width - 0.5) * 2;
      state.targetY = ((pt.clientY - r.top) / r.height - 0.5) * 2;
      if (e.cancelable) e.preventDefault();
    };
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("touchstart", onDown, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", onUp);

    /**
     * @param {Array} sheets   [{mask, bridges}] back → front
     * @param {string[]} colors  hex per sheet
     */
    function setSheets(sheets, colors, w, h) {
      state.w = w; state.h = h;
      state.layers = sheets.map((sheet, s) => ({
        canvas: maskToCanvas(sheet.mask, w, h, colors[s], s === 0),
        bridgeCanvas: sheet.bridges && hasAny(sheet.bridges)
          ? maskToCanvas(sheet.bridges, w, h, "#F0A227", false)
          : null,
      }));
      state.dirty = true;
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
      if (moved || state.dirty) { draw(); state.dirty = false; }
      requestAnimationFrame(frame);
    }

    function draw() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch || !state.layers.length) return;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr; canvas.height = ch * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      // Fit artwork into canvas with breathing room for the parallax throw.
      const pad = 0.86;
      const scale = Math.min((cw * pad) / state.w, (ch * pad) / state.h);
      const dw = state.w * scale, dh = state.h * scale;
      const ox = (cw - dw) / 2, oy = (ch - dh) / 2;

      const n = state.layers.length;
      const throwPx = Math.min(cw, ch) * 0.035; // parallax per sheet
      const explodePx = state.explode * Math.min(cw, ch) * 0.06;

      for (let s = 0; s < n; s++) {
        const depth = s - (n - 1) / 2;
        const dx = -state.tiltX * depth * throwPx;
        const dy = -state.tiltY * depth * throwPx - s * explodePx;
        ctx.save();
        ctx.shadowColor = "rgba(10,16,24,0.45)";
        ctx.shadowBlur = 6 + s * 2;
        ctx.shadowOffsetX = state.tiltX * 4;
        ctx.shadowOffsetY = 5 + state.tiltY * 4;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(state.layers[s].canvas, ox + dx, oy + dy, dw, dh);
        ctx.restore();
        if (state.showBridges && state.layers[s].bridgeCanvas) {
          ctx.drawImage(state.layers[s].bridgeCanvas, ox + dx, oy + dy, dw, dh);
        }
      }
    }

    return {
      setSheets,
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
