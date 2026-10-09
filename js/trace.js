/* ============================================================================
 * Shadowbox Studio — trace.js
 * ----------------------------------------------------------------------------
 * Raster → vector. Converts a binary mask into closed contour loops the
 * laser can cut.
 *
 * Method: directed boundary edges + chaining.
 *   · For every filled/empty pixel pair we emit a unit edge on the pixel
 *     grid, oriented so filled material lies on the LEFT of travel. This
 *     guarantees consistent loop orientation (outers one way, holes the
 *     other) and makes chaining unambiguous.
 *   · Edges are chained head-to-tail into closed rectilinear loops. At
 *     checkerboard saddle points two edges leave the same corner; we always
 *     take the left-most turn, which keeps diagonally-touching regions as
 *     separate loops instead of welding them into a figure-eight.
 *   · Loops are then simplified (Ramer–Douglas–Peucker) and optionally
 *     rounded (Chaikin corner cutting) for an organic, paper-cut feel.
 *   · smoothLevel (plan G1.2) is the canonical-path form: levels raw | rdp |
 *     chaikin = Chaikin(2)∘RDP(ε), pinned vertices kept exactly, squared
 *     distances only. simplify/chaikin above stay for the legacy path.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const T = {};

  // Direction encoding for chaining: 0=+x, 1=+y, 2=-x, 3=-y
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];

  /**
   * Trace all boundary loops of a 0/1 mask.
   * Speed round F7: the corner table is a typed array (one bitmask of unused outgoing directions per corner)
   * scanned in ascending corner order. That equals alpha.3's sorted snapshot of the Map's keys, because a
   * corner never gains bits once emission ends (it only loses them), so a corner whose bits are gone by the time
   * the scan reaches it is skipped by both. Oracle: test/oracle_kernels.js oracleTrace (NFR-05).
   * @returns {Array<Array<[x,y]>>} closed loops in pixel-corner coordinates
   */
  T.trace = function (mask, w, h) {
    // out[cornerIndex] = bitmask of directions with an unused edge leaving that corner. Corner grid is (w+1) x (h+1).
    const CW = w + 1;
    const out = new Uint8Array(CW * (h + 1));

    // Emit directed edges: material on the LEFT of travel (screen coords, y down).
    for (let y = 0; y < h; y++) {
      const row = y * w, c0 = y * CW, c1 = c0 + CW; // corner rows y and y + 1
      for (let x = 0; x < w; x++) {
        if (!mask[row + x]) continue;
        if (y === 0 || !mask[row - w + x]) out[c0 + x + 1] |= 4;       // top edge, travel -x (dir 2)
        if (y === h - 1 || !mask[row + w + x]) out[c1 + x] |= 1;       // bottom edge, travel +x (dir 0)
        if (x === 0 || !mask[row + x - 1]) out[c0 + x] |= 2;           // left edge, travel +y (dir 1)
        if (x === w - 1 || !mask[row + x + 1]) out[c1 + x + 1] |= 8;   // right edge, travel -y (dir 3)
      }
    }

    const loops = [];
    const guard0 = (w + 2) * (h + 2) * 4;
    // Deterministic iteration: ascending corner index.
    for (let start = 0, n = out.length; start < n; start++) {
      if (!out[start]) continue;
      const sx = start % CW, sy = (start / CW) | 0;
      let bits;
      while ((bits = out[start])) {
        // take lowest set direction as loop start
        const startDir = 31 - Math.clz32(bits & -bits);
        const loop = [];
        let cx = sx, cy = sy, dir = startDir;
        // consume the starting edge
        out[start] = bits & ~(1 << startDir);
        loop.push([cx, cy]);
        cx += DX[dir]; cy += DY[dir];

        // Walk until we return to the start corner via a closed chain.
        let guard = guard0;
        while (!(cx === sx && cy === sy) && guard-- > 0) {
          loop.push([cx, cy]);
          const idx = cy * CW + cx;
          const avail = out[idx];
          // Prefer the left-most turn relative to current direction: left, straight, right (never reverse).
          const l = (dir + 3) & 3, r = (dir + 1) & 3;
          const next = avail & (1 << l) ? l : avail & (1 << dir) ? dir : avail & (1 << r) ? r : -1;
          if (next < 0) break; // broken chain — abandon defensively
          out[idx] = avail & ~(1 << next);
          dir = next;
          cx += DX[dir]; cy += DY[dir];
        }
        if (loop.length >= 4) loops.push(dedupeCollinear(loop));
      }
    }
    return loops;
  };

  /** Merge runs of collinear rectilinear points to shrink loop size early. */
  function dedupeCollinear(loop) {
    const out = [];
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const p = loop[(i + n - 1) % n], c = loop[i], q = loop[(i + 1) % n];
      const straight =
        (p[0] === c[0] && c[0] === q[0]) || (p[1] === c[1] && c[1] === q[1]);
      if (!straight) out.push(c);
    }
    return out.length >= 3 ? out : loop;
  }

  /**
   * Ramer–Douglas–Peucker simplification of a closed loop.
   * @param {number} eps  max deviation in px
   */
  T.simplify = function (loop, eps) {
    if (eps <= 0 || loop.length < 5) return loop;
    // Split the closed loop at its two most distant points, simplify halves.
    let iA = 0, iB = 0, best = -1;
    for (let i = 0; i < loop.length; i++) {
      const j = (i + (loop.length >> 1)) % loop.length;
      const d = SBUtil.dist2(loop[i], loop[j]);
      if (d > best) { best = d; iA = i; iB = j; }
    }
    if (iA > iB) [iA, iB] = [iB, iA];
    const seg1 = loop.slice(iA, iB + 1);
    const seg2 = loop.slice(iB).concat(loop.slice(0, iA + 1));
    const out = rdp(seg1, eps).slice(0, -1).concat(rdp(seg2, eps).slice(0, -1));
    return out.length >= 3 ? out : loop;
  };

  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    const stack = [[0, pts.length - 1]];
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      const [a, b] = stack.pop();
      let idx = -1, dmax = 0;
      for (let i = a + 1; i < b; i++) {
        const d = pointSegDist(pts[i], pts[a], pts[b]);
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }

  function pointSegDist(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = p[0] - a[0], wy = p[1] - a[1];
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(wx, wy);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p[0] - b[0], p[1] - b[1]);
    const t = c1 / c2;
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  }

  /**
   * Chaikin corner-cutting on a closed loop; each iteration doubles the
   * point count and rounds corners. 1–2 iterations gives the paper-cut look.
   */
  T.chaikin = function (loop, iterations) {
    let pts = loop;
    for (let k = 0; k < iterations; k++) {
      const out = [];
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        out.push(
          [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]],
          [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]
        );
      }
      pts = out;
    }
    return pts;
  };

  // ----------------------------------------------- bounded smoothing (G1.2)
  // Pixel-loop smoothing levels for SBMaterial.smoothStack (connected mode only; D1: bonded is raw).
  // Squared distances only (no Math.hypot), so the kept-vertex decisions are engine-independent (NFR-05).

  function segDist2(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    let u = L2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    const ex = p[0] - a[0] - u * vx, ey = p[1] - a[1] - u * vy;
    return ex * ex + ey * ey;
  }
  /** RDP on an open chain; both endpoints kept. */
  function rdpOpen(pts, eps2) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const stack = [0, n - 1];
    while (stack.length) {
      const b = stack.pop(), a = stack.pop();
      let idx = -1, dmax = 0;
      for (let i = a + 1; i < b; i++) { const d = segDist2(pts[i], pts[a], pts[b]); if (d > dmax) { dmax = d; idx = i; } }
      if (idx > 0 && dmax > eps2) { keep[idx] = 1; stack.push(a, idx, idx, b); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }
  /**
   * RDP(ε) on a closed loop. Pinned vertices are always kept and split the loop into open chains; with no
   * pin the loop is split at vertex 0 and the vertex farthest from it (first maximum). Fewer than 3
   * survivors → the loop is returned unchanged.
   */
  function rdpClosed(loop, eps, pinned) {
    const n = loop.length;
    if (!(eps > 0) || n < 4) return loop.slice();
    const eps2 = eps * eps, anchors = [];
    for (let i = 0; i < n; i++) if (pinned(loop[i])) anchors.push(i);
    if (anchors.length < 2) {
      const a = anchors.length ? anchors[0] : 0; let b = -1, best = -1;
      for (let k = 1; k < n; k++) { const i = (a + k) % n, dx = loop[i][0] - loop[a][0], dy = loop[i][1] - loop[a][1], d = dx * dx + dy * dy; if (d > best) { best = d; b = i; } }
      anchors.length = 0; anchors.push(Math.min(a, b), Math.max(a, b));
    }
    const out = [];
    for (let t = 0; t < anchors.length; t++) {
      const a = anchors[t], b = anchors[(t + 1) % anchors.length], chain = [];
      for (let i = a; ; i = (i + 1) % n) { chain.push(loop[i]); if (i === b && chain.length > 1) break; }
      const s = rdpOpen(chain, eps2); s.pop(); // the end anchor starts the next chain
      for (const p of s) out.push(p);
    }
    return out.length >= 3 ? out : loop.slice();
  }
  /** Chaikin corner cutting, per-vertex form: each free vertex becomes two cut points at ¼ of its edges; pinned vertices are emitted unchanged. */
  function chaikinPinned(loop, iterations, pinned) {
    let pts = loop;
    for (let k = 0; k < iterations; k++) {
      const out = [], n = pts.length;
      for (let i = 0; i < n; i++) {
        const p = pts[(i + n - 1) % n], v = pts[i], q = pts[(i + 1) % n];
        if (pinned(v)) { out.push(v); continue; }
        out.push([0.75 * v[0] + 0.25 * p[0], 0.75 * v[1] + 0.25 * p[1]], [0.75 * v[0] + 0.25 * q[0], 0.75 * v[1] + 0.25 * q[1]]);
      }
      pts = out;
    }
    return pts;
  }
  // Frozen (speed round F0 audit): the exported list is also the validation list of smoothLevel, so no caller can
  // change it between calls (no call-history-dependent module state, NFR-05).
  const LEVELS = Object.freeze(["raw", "rdp", "chaikin"]);
  T.SMOOTH_LEVELS = LEVELS;
  /**
   * One smoothing level of a closed pixel loop (plan G1.2):
   *   "raw"     → the loop unchanged (a copy);
   *   "rdp"     → RDP(ε) alone (ε in px, = tolUm / pitchUm);
   *   "chaikin" → Chaikin(2)∘RDP(ε) — RDP first (spike S1 amendment: Chaikin ×2 quadruples the vertices).
   * pinned(pt) marks vertices that must stay exactly (the art-rectangle boundary), so the frame union stays
   * exact; a cut point that lands on that boundary is pinned on the next Chaikin pass too.
   */
  T.smoothLevel = function (loopPx, level, pinned, epsPx) {
    if (!LEVELS.includes(level)) throw new Error("SBTrace.smoothLevel: level must be raw|rdp|chaikin (got " + level + ")");
    const pin = pinned || (() => false);
    if (level === "raw") return loopPx.slice();
    const r = rdpClosed(loopPx, epsPx, pin);
    return level === "rdp" ? r : chaikinPinned(r, 2, pin);
  };

  global.SBTrace = T;
})(typeof window !== "undefined" ? window : globalThis);
