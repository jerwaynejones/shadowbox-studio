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
 * ==========================================================================*/
(function (global) {
  "use strict";

  const T = {};

  // Direction encoding for chaining: 0=+x, 1=+y, 2=-x, 3=-y
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];

  /**
   * Trace all boundary loops of a 0/1 mask.
   * @returns {Array<Array<[x,y]>>} closed loops in pixel-corner coordinates
   */
  T.trace = function (mask, w, h) {
    // outgoing[cornerIndex] = list of directions with an unused edge leaving
    // that corner. Corner grid is (w+1) x (h+1).
    const CW = w + 1;
    const outgoing = new Map(); // cornerIdx -> Uint8 bitmask of dirs

    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
    const addEdge = (x, y, dir) => {
      const idx = y * CW + x;
      outgoing.set(idx, (outgoing.get(idx) || 0) | (1 << dir));
    };

    // Emit directed edges: material on the LEFT of travel (screen coords, y down).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (!at(x, y - 1)) addEdge(x + 1, y, 2);       // top edge, travel -x
        if (!at(x, y + 1)) addEdge(x, y + 1, 0);       // bottom edge, travel +x
        if (!at(x - 1, y)) addEdge(x, y, 1);           // left edge, travel +y
        if (!at(x + 1, y)) addEdge(x + 1, y + 1, 3);   // right edge, travel -y
      }
    }

    const loops = [];
    // Deterministic iteration: sort corner indices.
    const starts = Array.from(outgoing.keys()).sort((a, b) => a - b);

    for (const start of starts) {
      let bits = outgoing.get(start);
      while (bits) {
        // take lowest set direction as loop start
        const startDir = 31 - Math.clz32(bits & -bits);
        const loop = [];
        let cx = start % CW, cy = (start / CW) | 0, dir = startDir;
        // consume the starting edge
        consumeEdge(outgoing, start, startDir);
        loop.push([cx, cy]);
        cx += DX[dir]; cy += DY[dir];

        // Walk until we return to the start corner via a closed chain.
        let guard = (w + 2) * (h + 2) * 4;
        while (!(cx === start % CW && cy === ((start / CW) | 0)) && guard-- > 0) {
          loop.push([cx, cy]);
          const idx = cy * CW + cx;
          const avail = outgoing.get(idx) || 0;
          // Prefer the left-most turn relative to current direction:
          // left, straight, right (never reverse).
          const prefs = [(dir + 3) & 3, dir, (dir + 1) & 3];
          let next = -1;
          for (const d of prefs) if (avail & (1 << d)) { next = d; break; }
          if (next < 0) break; // broken chain — abandon defensively
          consumeEdge(outgoing, idx, next);
          dir = next;
          cx += DX[dir]; cy += DY[dir];
        }
        if (loop.length >= 4) loops.push(dedupeCollinear(loop));
        bits = outgoing.get(start) || 0;
      }
      outgoing.delete(start);
    }
    return loops;
  };

  function consumeEdge(outgoing, idx, dir) {
    const bits = (outgoing.get(idx) || 0) & ~(1 << dir);
    if (bits) outgoing.set(idx, bits); else outgoing.delete(idx);
  }

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

  global.SBTrace = T;
})(typeof window !== "undefined" ? window : globalThis);
