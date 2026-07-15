/* ============================================================================
 * Shadowbox Studio — islands.js
 * ----------------------------------------------------------------------------
 * THE core problem this tool exists to solve.
 *
 * When a sheet is laser-cut, any region of kept material that isn't connected
 * to the rest of the sheet ("an island") physically falls out on the bed.
 * Think of the moon in a night sky layer, or the counter inside a letter "O".
 *
 * For every sheet we:
 *   1. Decide what counts as "anchored":
 *        · frame mode  — components touching the image border are anchored,
 *          because the exported SVG welds the artwork to a solid frame ring
 *        · frameless   — only the single largest component is anchored
 *   2. For each unanchored component ("island"):
 *        · CULL it if its area is below the cull threshold (too small to
 *          matter visually, not worth a bridge), or
 *        · BRIDGE it: run a BFS from the island across empty space to the
 *          nearest anchored pixel, then stamp a corridor of material of the
 *          requested bridge width along that shortest path.
 *   3. Islands are processed nearest-first, and each bridged island becomes
 *      part of the anchored set — so chains of islands (star, star, star)
 *      daisy-chain to the mainland with short local bridges instead of each
 *      one running its own long bridge.
 *
 * Bridges are recorded in a separate mask so the UI can show them in amber
 * and the user can immediately see every structural compromise the tool made.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const I = {};
  const M = global.SBMorph;

  /**
   * Resolve islands in a sheet mask.
   *
   * @param {Uint8Array} mask   0/1 sheet material mask — MUTATED in place
   * @param {number} w, h       mask dimensions
   * @param {object} opt
   *   frameAnchored {boolean}  border-touching components count as anchored
   *   bridgeRadius  {number}   half bridge width, px (corridor thickness)
   *   cullBelowPx   {number}   islands smaller than this (px²) are removed
   *   maxBridgePx   {number}   islands farther than this from any anchor
   *                            are culled instead of bridged (0 = no limit)
   * @returns {{bridges: Uint8Array, bridged: number, culled: number,
   *            islandCount: number}}
   */
  I.resolve = function (mask, w, h, opt) {
    const bridges = new Uint8Array(w * h);
    const comp = M.components(mask, w, h, 1);
    if (comp.count === 0)
      return { bridges, bridged: 0, culled: 0, islandCount: 0 };

    // ---- 1. classify components -------------------------------------------
    const anchoredComp = new Uint8Array(comp.count + 1);
    if (opt.frameAnchored) {
      for (let c = 1; c <= comp.count; c++)
        if (comp.touchesBorder[c - 1]) anchoredComp[c] = 1;
      // Degenerate case: nothing touches the border — anchor the largest.
      if (!anchoredComp.some((v) => v)) anchoredComp[largest(comp)] = 1;
    } else {
      anchoredComp[largest(comp)] = 1;
    }

    const anchored = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++)
      if (mask[i] && anchoredComp[comp.labels[i]]) anchored[i] = 1;

    // ---- 2. collect islands, sort by size (largest first: they become
    //         daisy-chain hubs for their smaller neighbours) ----------------
    const islands = [];
    for (let c = 1; c <= comp.count; c++)
      if (!anchoredComp[c]) islands.push({ id: c, area: comp.areas[c - 1] });
    islands.sort((a, b) => b.area - a.area);

    let bridged = 0, culled = 0;
    const parent = new Int32Array(w * h);
    const visited = new Int32Array(w * h); // generation-stamped, no realloc
    let gen = 0;

    for (const isl of islands) {
      // Small islands: not worth the visual noise of a bridge — cull.
      if (isl.area < opt.cullBelowPx) {
        eraseComponent(mask, comp.labels, isl.id);
        culled++;
        continue;
      }

      // ---- 3. BFS from every island pixel outward to nearest anchor ------
      gen++;
      const queue = new Int32Array(w * h);
      let qh = 0, qt = 0;
      for (let i = 0; i < mask.length; i++) {
        if (comp.labels[i] === isl.id && mask[i]) {
          visited[i] = gen; parent[i] = -1; queue[qt++] = i;
        }
      }
      if (qt === 0) continue; // was erased by an earlier overlap (shouldn't happen)

      let hit = -1, steps = 0;
      const maxSteps = opt.maxBridgePx > 0 ? opt.maxBridgePx : Infinity;
      // Level-order BFS so `steps` == path length in px.
      while (qh < qt && hit < 0 && steps <= maxSteps) {
        const levelEnd = qt;
        while (qh < levelEnd && hit < 0) {
          const i = queue[qh++];
          const x = i % w, y = (i / w) | 0;
          const nbrs = [
            x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1,
            y > 0 ? i - w : -1, y < h - 1 ? i + w : -1,
          ];
          for (const n of nbrs) {
            if (n < 0 || visited[n] === gen) continue;
            visited[n] = gen; parent[n] = i;
            if (anchored[n]) { hit = n; break; }
            queue[qt++] = n;
          }
        }
        steps++;
      }

      if (hit < 0) {
        // No anchor reachable within budget: cull, and report it.
        eraseComponent(mask, comp.labels, isl.id);
        culled++;
        continue;
      }

      // ---- 4. stamp the bridge corridor along the parent chain ------------
      let i = hit;
      while (i >= 0) {
        stampDisc(mask, bridges, w, h, i % w, (i / w) | 0, opt.bridgeRadius);
        i = parent[i];
      }
      bridged++;

      // The island + its bridge are now anchored: future islands may chain.
      markAnchoredFrom(mask, anchored, w, h, hit);
    }

    return { bridges, bridged, culled, islandCount: islands.length };
  };

  /** id of the largest component. */
  function largest(comp) {
    let best = 1, bestA = -1;
    for (let c = 1; c <= comp.count; c++)
      if (comp.areas[c - 1] > bestA) { bestA = comp.areas[c - 1]; best = c; }
    return best;
  }

  /** Zero out every pixel belonging to component id. */
  function eraseComponent(mask, labels, id) {
    for (let i = 0; i < mask.length; i++)
      if (labels[i] === id) mask[i] = 0;
  }

  /** Stamp a filled disc into mask (material) and bridges (bookkeeping). */
  function stampDisc(mask, bridges, w, h, cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = y * w + x;
          if (!mask[i]) bridges[i] = 1; // only new material counts as "bridge"
          mask[i] = 1;
        }
      }
    }
  }

  /** Flood the anchored flag across the (now merged) component containing i0. */
  function markAnchoredFrom(mask, anchored, w, h, i0) {
    const queue = [i0];
    anchored[i0] = 1;
    while (queue.length) {
      const i = queue.pop();
      const x = i % w, y = (i / w) | 0;
      const nbrs = [
        x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1, y < h - 1 ? i + w : -1,
      ];
      for (const n of nbrs)
        if (n >= 0 && mask[n] && !anchored[n]) { anchored[n] = 1; queue.push(n); }
    }
  }

  global.SBIslands = I;
})(typeof window !== "undefined" ? window : globalThis);
