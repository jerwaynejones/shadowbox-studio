/* ============================================================================
 * Shadowbox Studio — js/construct.js
 * ----------------------------------------------------------------------------
 * SBConstruct: the two construction strategies on raster masks (plan G2.6).
 *
 *   connected(masks, w, h, px)  connected-sheet mode: the v1.1.0 per-sheet chain
 *                               open → close → removeSpecks → fillHoles → SBIslands.resolve
 *                               (bridge or cull every loose part; SUP-06, one part per layer).
 *   bonded(masks, w, h, px)     bonded-relief mode: the same open → close → fillHoles chain,
 *                               removeSpecks only when px.cullEnabled (SUP-01: culling is explicit),
 *                               NEVER SBIslands.resolve and no clip. The chain is monotone, so nested
 *                               input stays nested (D-4.5): bonded morphology never creates an overhang.
 *
 * Both return {final: Uint8Array[], bridges: (Uint8Array|null)[], report: [{layer, addedPx, removedPx,
 * filledHoles, removedParts}]} with one entry per layer. Layer 0 (the base) passes through as a copy with an
 * all-zero report. The report counts pixels against the input mask; the engine converts it to mm² with
 * sxUm·syUm (GEO-08). Connected report entries also carry the islands counts {bridged, culled}
 * (removedParts = specks + culled). Inputs are never mutated.
 *
 * px = {featR, bridgeR, cullPx, maxBridgePx, speckPx, holePx, frameAnchored, cullEnabled}:
 *   featR        opening radius (px); the closing radius is max(1, featR − 1) as in v1.1.0, and featR 0
 *                disables both (no morphology);
 *   speckPx      removeSpecks area limit (px²); holePx fillHoles area limit (px²);
 *   bridgeR, cullPx, maxBridgePx, frameAnchored  SBIslands.resolve options (connected only);
 *   cullEnabled  bonded only: run removeSpecks (connected always runs it, as v1.1.0 did).
 * ==========================================================================*/
(function (global) {
  "use strict";
  /* global SBMorph, SBIslands */
  const C = {};

  function cfail(msg) { const e = new Error("CONSTRUCT_ARG: " + msg); e.code = "CONSTRUCT_ARG"; return e; }
  const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

  function checkArgs(masks, w, h, px) {
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw cfail("size must be positive integers (got " + w + " × " + h + ")");
    if (!Array.isArray(masks) || masks.length === 0) throw cfail("masks must be a non-empty array");
    masks.forEach((m, k) => { if (!(m instanceof Uint8Array) || m.length !== w * h) throw cfail("mask " + k + " must be a Uint8Array of length w·h"); });
    if (!px || typeof px !== "object") throw cfail("px must be {featR, bridgeR, cullPx, maxBridgePx, speckPx, holePx, frameAnchored, cullEnabled}");
    if (!Number.isInteger(px.featR) || px.featR < 0) throw cfail("featR must be a non-negative integer (got " + px.featR + ")");
    for (const f of ["bridgeR", "cullPx", "maxBridgePx", "speckPx", "holePx"]) if (!isNum(px[f])) throw cfail(f + " must be a non-negative number (got " + px[f] + ")");
  }

  /** The shared per-layer morphology: open → close (→ removeSpecks when cull) → fillHoles. Returns {m, specks, holes}. */
  function morph(mask, w, h, px, cull) {
    const M = global.SBMorph, r = px.featR;
    let m = r > 0 ? M.open(mask, w, h, r) : mask.slice();
    if (r > 0) m = M.close(m, w, h, Math.max(1, r - 1));
    const specks = cull ? M.removeSpecks(m, w, h, px.speckPx) : 0;
    const holes = M.fillHoles(m, w, h, px.holePx);
    return { m, specks, holes };
  }

  function diff(before, after) {
    let added = 0, removed = 0;
    for (let i = 0; i < before.length; i++) if (after[i] && !before[i]) added++; else if (before[i] && !after[i]) removed++;
    return { addedPx: added, removedPx: removed };
  }

  const baseEntry = () => ({ layer: 0, addedPx: 0, removedPx: 0, filledHoles: 0, removedParts: 0 });

  /** Connected-sheet strategy (SUP-06): the v1.1.0 chain, byte-identical, including SBIslands.resolve. */
  C.connected = function (masks, w, h, px) {
    checkArgs(masks, w, h, px);
    const final = [], bridges = [], report = [];
    masks.forEach((mask, k) => {
      if (k === 0) { final.push(mask.slice()); bridges.push(null); report.push({ ...baseEntry(), bridged: 0, culled: 0 }); return; }
      const { m, specks, holes } = morph(mask, w, h, px, true);
      const isl = global.SBIslands.resolve(m, w, h, {
        frameAnchored: !!px.frameAnchored, bridgeRadius: px.bridgeR, cullBelowPx: px.cullPx, maxBridgePx: px.maxBridgePx,
      });
      final.push(m); bridges.push(isl.bridges);
      report.push({ layer: k, ...diff(mask, m), filledHoles: holes, removedParts: specks + isl.culled, bridged: isl.bridged, culled: isl.culled });
    });
    return { final, bridges, report };
  };

  /** Bonded-relief strategy (SUP-01, D-4.5/4.6): no islands, no bridges, no clip; culling only when cullEnabled. */
  C.bonded = function (masks, w, h, px) {
    checkArgs(masks, w, h, px);
    const final = [], bridges = [], report = [];
    masks.forEach((mask, k) => {
      bridges.push(null);
      if (k === 0) { final.push(mask.slice()); report.push(baseEntry()); return; }
      const { m, specks, holes } = morph(mask, w, h, px, !!px.cullEnabled);
      final.push(m);
      report.push({ layer: k, ...diff(mask, m), filledHoles: holes, removedParts: specks });
    });
    return { final, bridges, report };
  };

  global.SBConstruct = C;
})(typeof window !== "undefined" ? window : globalThis);
