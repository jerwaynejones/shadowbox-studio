/* ============================================================================
 * Shadowbox Studio — geom.js  (SBGeom, decision D2: Clipper2 via clipper2-ts)
 * ----------------------------------------------------------------------------
 * Engine-agnostic polygon geometry. All coordinates are integer µm; a polygon
 * is {outer: [x0, y0, x1, y1, …], holes: [ring, …]} (PolygonWithHoles, §3).
 *
 * Winding convention (plan §3):
 *   · Y-down integer µm. Outer rings have POSITIVE shoelace area
 *     (sum x_i*y_{i+1} - x_{i+1}*y_i), holes NEGATIVE. SBTrace.trace emits the
 *     opposite, so fromPixelLoops reverses traced rings.
 *   · Each ring starts at its lexicographically smallest (x, y) vertex.
 *   · Collinear (and duplicate / spike) vertices are removed.
 *   · D3 normalize (spike S5, adopted 2026-10-07), applied globally to the ring
 *     set of every boolean / offset result: (1) node — a vertex lying inside
 *     another edge (T-contact) is inserted into that edge; (2) re-pair — Clipper2's
 *     ring pairing is discarded and boundary edges meeting at a shared vertex are
 *     re-chained with the material-separating turn (see rechain: "sharpest left
 *     turn" in the math frame == S5's "right-most turn" in Y-down); (3) split —
 *     a ring still repeating a vertex is split there (pixel saddles; never before
 *     the re-pair); (4) drop collinear, orient, rotate, nest holes in the smallest
 *     containing outer, sort. Postcondition: one polygon per part (interiorConnected;
 *     components() asserts it, validate() reports GEO_MULTIPART).
 *   · Finite-width contact (D3, B.3): insetStatus / survivesInset / classifyContact
 *     certify r* ≥ d with an exact BigInt witness; never through offset().
 *   · Polygons sorted by (minY, minX) of the outer, then by the outer's
 *     coordinate list; holes the same way.
 *   · maxDeviationUm (densified symmetric Hausdorff) and ringTopology (containment
 *     tree signature) are the GEO-04 smoothing measures (plan G1.2).
 *   · canonicalBytes / layerHash / materialHash (decision D4, spike S6) are
 *     built on normalize; integer coordinates within ±2^25 µm only.
 * Only + - * / Math.round/floor/ceil/abs/sqrt/min/max, BigInt (finite-width witness), Math.imul (integer hash in the T-split
 * index) and integer typed-array sorts are used here (NFR-05). No trig.
 * Booleans and offsets delegate to global.Clipper2 (js/vendor/clipper2.js),
 * looked up at call time. Merged from spikes/S1/geom_core.js + geom_clipper.js.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const C = {}; // backend-independent half (rings, normalization, measures, validate)

  // ---------------------------------------------------------------- rings
  /** Twice the signed shoelace area (exact for |coord| < ~6e7). */
  function area2(r) {
    const n = r.length; if (n < 6) return 0;
    const x0 = r[0], y0 = r[1]; let a = 0;
    for (let i = 2; i < n - 2; i += 2) a += (r[i] - x0) * (r[i + 3] - y0) - (r[i + 2] - x0) * (r[i + 1] - y0);
    return a;
  }
  C.area2 = area2;

  function reverseRing(r) {
    const n = r.length, o = new Array(n);
    for (let i = 0; i < n; i += 2) { o[n - 2 - i] = r[i]; o[n - 1 - i] = r[i + 1]; }
    return o;
  }
  C.reverseRing = reverseRing;

  /**
   * Remove duplicate, collinear and spike vertices until stable. Works on a cyclic linked list, so a
   * vertex is always tested against its current live neighbours (removing one copy of a duplicate
   * never drops the corner it duplicates). Survivors keep their original cyclic order, starting from
   * the first surviving input vertex. Returns [] when fewer than 3 vertices survive.
   */
  function cleanRing(r) {
    const n0 = r.length;
    if (n0 % 2) return r; // malformed: left for validate() to report as GEO_OPEN
    if (n0 >= 6) { // fast path: nothing to remove
      let ok = true;
      for (let i = 0; i < n0 && ok; i += 2) {
        const p = (i + n0 - 2) % n0, q = (i + 2) % n0;
        if ((r[i] - r[p]) * (r[q + 1] - r[p + 1]) - (r[q] - r[p]) * (r[i + 1] - r[p + 1]) === 0) ok = false;
      }
      if (ok) return r;
    }
    const n = n0 / 2; if (n < 3) return [];
    const prv = new Int32Array(n), nxt = new Int32Array(n), alive = new Uint8Array(n).fill(1), queued = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) { prv[i] = (i + n - 1) % n; nxt[i] = (i + 1) % n; }
    const stack = []; for (let i = n - 1; i >= 0; i--) stack.push(i);
    let live = n;
    while (stack.length && live >= 3) {
      const i = stack.pop(); queued[i] = 0;
      if (!alive[i]) continue;
      const p = prv[i], q = nxt[i];
      if ((r[2 * i] - r[2 * p]) * (r[2 * q + 1] - r[2 * p + 1]) - (r[2 * q] - r[2 * p]) * (r[2 * i + 1] - r[2 * p + 1]) !== 0) continue;
      alive[i] = 0; live--; nxt[p] = q; prv[q] = p;
      if (!queued[q]) { queued[q] = 1; stack.push(q); }
      if (!queued[p]) { queued[p] = 1; stack.push(p); }
    }
    if (live < 3) return [];
    let s = 0; while (!alive[s]) s++;
    const o = []; let v = s;
    do { o.push(r[2 * v], r[2 * v + 1]); v = nxt[v]; } while (v !== s);
    return o;
  }
  C.cleanRing = cleanRing;

  /** Rotate so the ring starts at its lexicographically smallest (x, y) vertex. */
  function rotateStart(r) {
    let b = 0;
    for (let i = 2; i < r.length; i += 2) if (r[i] < r[b] || (r[i] === r[b] && r[i + 1] < r[b + 1])) b = i;
    return b === 0 ? r : r.slice(b).concat(r.slice(0, b));
  }

  /** Split a ring that revisits a vertex into simple sub-loops (D3). */
  function splitRing(r) {
    const n = r.length / 2; if (n < 3) return [r];
    // vertex key: exact for |x|, |y| < 2^25 µm (33 m)
    const key = (i) => r[2 * i] * 67108864 + r[2 * i + 1];
    const ks = new Float64Array(n); for (let i = 0; i < n; i++) ks[i] = key(i);
    ks.sort(); let dup = false; for (let i = 1; i < n; i++) if (ks[i] === ks[i - 1]) { dup = true; break; }
    if (!dup) return [r];
    const out = [], stack = [], pos = new Map();
    for (let i = 0; i < n; i++) {
      const k = key(i);
      if (pos.has(k)) {
        const j = pos.get(k), loop = stack.splice(j + 1);
        for (const v of loop) pos.delete(r[2 * v] * 67108864 + r[2 * v + 1]);
        loop.unshift(stack[j]);
        const f = []; for (const v of loop) f.push(r[2 * v], r[2 * v + 1]); out.push(f);
      } else { pos.set(k, stack.length); stack.push(i); }
    }
    const f = []; for (const v of stack) f.push(r[2 * v], r[2 * v + 1]); out.push(f);
    return out;
  }

  // ------------------------------------------------- point / ring predicates
  /** -1 outside, 0 on boundary, 1 inside (exact integer arithmetic). */
  function pointInRing(px, py, r) {
    const n = r.length; let wn = 0;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n, ax = r[i], ay = r[i + 1], bx = r[j], by = r[j + 1];
      const cr = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
      if (cr === 0 && px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)) return 0;
      if (ay <= py) { if (by > py && cr > 0) wn++; } else if (by <= py && cr < 0) wn--;
    }
    return wn !== 0 ? 1 : -1;
  }
  C.pointInRing = pointInRing;

  function ringBox(r) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) { const x = r[i], y = r[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }
  C.ringBox = ringBox;

  /** Y-band edge index over a doubled ring, for fast exact point-in-ring queries on big rings. */
  function bandIndex(r) {
    const r2 = r.map((v) => v * 2), n = r2.length / 2, bb = ringBox(r2);
    const nb = Math.max(1, Math.min(4096, n >> 3)), bh = Math.floor((bb[3] - bb[1]) / nb) + 1, bands = [];
    for (let k = 0; k < nb; k++) bands.push([]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, y0 = Math.min(r2[2 * i + 1], r2[2 * j + 1]), y1 = Math.max(r2[2 * i + 1], r2[2 * j + 1]);
      for (let k = Math.floor((y0 - bb[1]) / bh), k1 = Math.floor((y1 - bb[1]) / bh); k <= k1; k++) bands[k].push(2 * i);
    }
    return { r2, bb, bh, bands, n2: r2.length };
  }
  function pointInIndexed(px, py, X) {
    const { r2, bb, bh, bands, n2 } = X;
    if (px < bb[0] || px > bb[2] || py < bb[1] || py > bb[3]) return -1;
    let wn = 0;
    for (const i of bands[Math.floor((py - bb[1]) / bh)]) {
      const j = (i + 2) % n2, ax = r2[i], ay = r2[i + 1], bx = r2[j], by = r2[j + 1];
      const cr = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
      if (cr === 0 && px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)) return 0;
      if (ay <= py) { if (by > py && cr > 0) wn++; } else if (by <= py && cr < 0) wn--;
    }
    return wn !== 0 ? 1 : -1;
  }
  /** Is ring `h` inside the indexed ring X? Probes doubled vertices / edge midpoints until one is off X's boundary. */
  function ringInside(h, X) {
    for (let i = 0; i < h.length; i += 2) {
      const j = (i + 2) % h.length;
      let s = pointInIndexed(h[i] * 2, h[i + 1] * 2, X); if (s !== 0) return s > 0;
      s = pointInIndexed(h[i] + h[j], h[i + 1] + h[j + 1], X); if (s !== 0) return s > 0;
    }
    return false;
  }

  /**
   * T-contacts (D3, D4; spike S6): insert every vertex that lies strictly inside an edge of any ring
   * (its own included) into that edge, so a vertex-on-edge contact becomes a shared vertex that
   * rechain() can separate. Exact integer tests only; returns the input array itself when nothing was
   * inserted. Axis-parallel edges (all of them on pixel-lattice geometry) are matched by binary search
   * among the vertices of the same row (column); any other edge goes through a uniform grid whose only division
   * sizes the cells and never reaches the output.
   */
  const KLIM = 33554432; // 2^25: the axis path stores (integer) coordinates in Int32Array
  function splitTJunctions(rings) {
    let E = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, ints = true;
    for (const r of rings) {
      E += r.length >> 1;
      for (let i = 0; i < r.length; i += 2) {
        const x = r[i], y = r[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if ((x | 0) !== x || (y | 0) !== y) ints = false;
      }
    }
    if (E < 4) return rings;
    const keyed = ints && x0 >= -KLIM && y0 >= -KLIM && x1 <= KLIM && y1 <= KLIM; // else everything takes the grid path
    const AX = new Float64Array(E), AY = new Float64Array(E), BX = new Float64Array(E), BY = new Float64Array(E);
    const general = []; let e = 0;
    for (const r of rings) {
      const n = r.length >> 1;
      for (let i = 0; i < n; i++, e++) {
        const j = (i + 1) % n; AX[e] = r[2 * i]; AY[e] = r[2 * i + 1]; BX[e] = r[2 * j]; BY[e] = r[2 * j + 1];
        if (!keyed || (AX[e] !== BX[e] && AY[e] !== BY[e])) general.push(e);
      }
    }
    let ins = null; // edge → [[x, y, distance key]…]
    const hit = (f, px, py) => {
      if (!ins) ins = new Map();
      const d = (BX[f] - AX[f]) * (px - AX[f]) + (BY[f] - AY[f]) * (py - AY[f]), arr = ins.get(f);
      if (!arr) ins.set(f, [[px, py, d]]); else if (!arr.some((q) => q[0] === px && q[1] === py)) arr.push([px, py, d]);
    };
    if (general.length < E) { // axis-parallel edges: vertices bucketed by row (column), sorted within it
      let cap = 2, bits = 1; while (cap < E * 2) { cap <<= 1; bits++; }
      const mask = cap - 1, shift = 32 - bits, slotKey = new Int32Array(cap), slotRow = new Int32Array(cap), row = new Int32Array(E), vals = new Int32Array(E);
      const index = (P, Q) => { // open-addressing int table P → row id (Fibonacci hash, high bits); counting sort of Q by row
        slotRow.fill(-1); let R = 0;
        for (let v = 0; v < E; v++) {
          const p = P[v]; let h = Math.imul(p, 0x9e3779b1) >>> shift;
          while (slotRow[h] >= 0 && slotKey[h] !== p) h = (h + 1) & mask;
          if (slotRow[h] < 0) { slotKey[h] = p; slotRow[h] = R++; }
          row[v] = slotRow[h];
        }
        const start = new Int32Array(R + 1); for (let v = 0; v < E; v++) start[row[v] + 1]++;
        for (let k = 0; k < R; k++) start[k + 1] += start[k];
        const fill = start.slice(0, R), V = vals.slice();
        for (let v = 0; v < E; v++) V[fill[row[v]]++] = Q[v];
        for (let k = 0; k < R; k++) {
          const a = start[k], b = start[k + 1];
          if (b - a > 96) V.subarray(a, b).sort();
          else for (let i = a + 1; i < b; i++) { const x = V[i]; let j = i - 1; while (j >= a && V[j] > x) { V[j + 1] = V[j]; j--; } V[j + 1] = x; } // short rows: insertion sort
        }
        return { keys: slotKey.slice(), rows: slotRow.slice(), start, V };
      };
      for (let pass = 0; pass < 2; pass++) { // 0: horizontal edges against rows of equal y; 1: vertical against columns of equal x
        let I = null;
        for (let f = 0; f < E; f++) {
          const ax = AX[f], ay = AY[f], bx = BX[f], by = BY[f];
          let p, lo, hi;
          if (pass === 0) { if (ay !== by || ax === bx) continue; p = ay; lo = ax < bx ? ax : bx; hi = ax < bx ? bx : ax; }
          else { if (ax !== bx || ay === by) continue; p = ax; lo = ay < by ? ay : by; hi = ay < by ? by : ay; }
          if (!I) I = pass === 0 ? index(AY, AX) : index(AX, AY);
          let h = Math.imul(p, 0x9e3779b1) >>> shift; while (I.keys[h] !== p || I.rows[h] < 0) h = (h + 1) & mask; // p is a vertex coordinate: always present
          const k = I.rows[h], V = I.V, end = I.start[k + 1]; let a = I.start[k], b = end;
          while (a < b) { const m = (a + b) >> 1; if (V[m] <= lo) a = m + 1; else b = m; }
          for (let t = a; t < end && V[t] < hi; t++) if (t === a || V[t] !== V[t - 1]) { if (pass === 0) hit(f, V[t], p); else hit(f, p, V[t]); }
        }
      }
    }
    if (general.length) { // other edges: GN×GN grid over their bbox, GN = min(1024, isqrt(count))
      const G = general.length;
      let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
      for (const f of general) {
        const ax = AX[f], ay = AY[f], bx = BX[f], by = BY[f];
        if (ax < gx0) gx0 = ax; if (bx < gx0) gx0 = bx; if (ax > gx1) gx1 = ax; if (bx > gx1) gx1 = bx;
        if (ay < gy0) gy0 = ay; if (by < gy0) gy0 = by; if (ay > gy1) gy1 = ay; if (by > gy1) gy1 = by;
      }
      let GN = 1; while (GN < 1024 && (GN + 1) * (GN + 1) <= G) GN++;
      // cell = floor((v − v0)·GN/(span+1)) ∈ [0, GN−1]; monotone, so an edge is listed in every cell its
      // bbox covers and a vertex inside that bbox finds it.
      const icw = GN / (gx1 - gx0 + 1), ich = GN / (gy1 - gy0 + 1);
      const C0 = new Int32Array(G), C1 = new Int32Array(G), R0 = new Int32Array(G), R1 = new Int32Array(G), start = new Int32Array(GN * GN + 1);
      for (let g = 0; g < G; g++) {
        const f = general[g], ax = AX[f], ay = AY[f], bx = BX[f], by = BY[f];
        C0[g] = ((ax < bx ? ax : bx) - gx0) * icw | 0; C1[g] = ((ax < bx ? bx : ax) - gx0) * icw | 0;
        R0[g] = ((ay < by ? ay : by) - gy0) * ich | 0; R1[g] = ((ay < by ? by : ay) - gy0) * ich | 0;
        for (let gy = R0[g]; gy <= R1[g]; gy++) for (let gx = C0[g]; gx <= C1[g]; gx++) start[gy * GN + gx + 1]++;
      }
      for (let c = 0; c < GN * GN; c++) start[c + 1] += start[c];
      const fill = start.slice(0, GN * GN), list = new Int32Array(start[GN * GN]);
      for (let g = 0; g < G; g++) for (let gy = R0[g]; gy <= R1[g]; gy++) for (let gx = C0[g]; gx <= C1[g]; gx++) list[fill[gy * GN + gx]++] = general[g];
      for (let v = 0; v < E; v++) {
        const px = AX[v], py = AY[v];
        if (px < gx0 || px > gx1 || py < gy0 || py > gy1) continue;
        const c = ((py - gy0) * ich | 0) * GN + ((px - gx0) * icw | 0);
        for (let t = start[c], t1 = start[c + 1]; t < t1; t++) {
          const f = list[t], ax = AX[f], ay = AY[f], bx = BX[f], by = BY[f];
          if (px < (ax < bx ? ax : bx) || px > (ax < bx ? bx : ax) || py < (ay < by ? ay : by) || py > (ay < by ? by : ay)) continue;
          if ((px === ax && py === ay) || (px === bx && py === by)) continue;
          if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) !== 0) continue;
          hit(f, px, py);
        }
      }
    }
    if (!ins) return rings;
    let base = 0;
    return rings.map((r) => {
      const n = r.length >> 1, b = base; base += n;
      let any = false; for (let i = 0; i < n && !any; i++) if (ins.has(b + i)) any = true;
      if (!any) return r;
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(r[2 * i], r[2 * i + 1]);
        const q = ins.get(b + i); if (q) { q.sort((u, w) => u[2] - w[2]); for (const p of q) out.push(p[0], p[1]); }
      }
      return out;
    });
  }
  C.splitTJunctions = splitTJunctions;

  // ------------------------------------------------------------- hierarchy
  /**
   * Canonical re-chaining at shared vertices (D3 step 2, "re-pair"). All rings are role-oriented
   * (outer positive shoelace, holes negative). Wherever several boundary edges leave the same vertex,
   * each arriving edge continues on the outgoing edge that bounds the SAME material wedge: the edge
   * met first when sweeping clockwise from the reversed arrival direction, i.e. the sharpest LEFT turn
   * when the integer coordinates are read in the math frame (Y up, material on the left). Read in the
   * Y-down screen frame of §3 and spike S5 the same edge is the RIGHT-MOST turn (material on the right
   * of travel): one rule, two frames. Pinned by suite "spike S5 — D3 turn rule", which compares every
   * successor with S5's exact half-plane comparator. Clipper2's own pairing is never trusted (it mixes
   * separating and joining continuations, S5 F1), so parts that only touch at a point come out as
   * separate rings and the decomposition depends only on the edge set (exact integer comparisons).
   */
  function rechain(rings) {
    let m = 0; for (const r of rings) m += r.length / 2;
    if (!m) return rings;
    // open-addressing vertex table (integer coordinates) → shared-vertex flags without string/double keys
    let cap = 1; while (cap < m * 2) cap <<= 1;
    const mask = cap - 1, slotV = new Int32Array(cap).fill(-1), cnt = new Int32Array(cap), slotOf = new Int32Array(m);
    const X = new Float64Array(m), Y = new Float64Array(m), nextIn = new Int32Array(m);
    let g = 0, anyShared = false;
    for (const r of rings) {
      const n = r.length / 2, base = g;
      for (let i = 0; i < n; i++, g++) {
        const x = r[2 * i], y = r[2 * i + 1]; X[g] = x; Y[g] = y; nextIn[g] = base + ((i + 1) % n);
        let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77)) & mask;
        for (;;) {
          const v = slotV[h];
          if (v < 0) { slotV[h] = g; cnt[h] = 1; break; }
          if (X[v] === x && Y[v] === y) { cnt[h]++; anyShared = true; break; }
          h = (h + 1) & mask;
        }
        slotOf[g] = h;
      }
    }
    if (!anyShared) return rings;
    // edge e = vertex g → nextIn[g]; outgoing lists only at shared vertices (head/link chains)
    const head = new Int32Array(cap).fill(-1), link = new Int32Array(m).fill(-1);
    for (let e = m - 1; e >= 0; e--) { const h = slotOf[e]; if (cnt[h] > 1) { link[e] = head[h]; head[h] = e; } }
    const used = new Uint8Array(m);
    const pick = (ein, s0) => { // sharpest left turn: smallest clockwise angle from u = -d_in
      const en = nextIn[ein], ux = X[ein] - X[en], uy = Y[ein] - Y[en];
      let best = -1, bg = 9, bx = 0, by = 0;
      for (let c = head[slotOf[en]]; c >= 0; c = link[c]) {
        if (used[c] && c !== s0) continue;
        const cn = nextIn[c], wx = X[cn] - X[c], wy = Y[cn] - Y[c], cr = ux * wy - uy * wx;
        const gg = cr < 0 ? 0 : cr > 0 ? 2 : ux * wx + uy * wy < 0 ? 1 : 3;
        if (best < 0 || gg < bg || (gg === bg && (gg === 0 || gg === 2) && bx * wy - by * wx < 0)) { best = c; bg = gg; bx = wx; by = wy; }
      }
      return best;
    };
    const walks = [];
    for (let s0 = 0; s0 < m; s0++) {
      if (used[s0]) continue;
      used[s0] = 1; const w = [X[s0], Y[s0]]; let cur = s0;
      for (let guard = m + 1; guard-- > 0;) {
        const en = nextIn[cur], nx = cnt[slotOf[en]] > 1 ? pick(cur, s0) : en;
        if (nx === s0 || nx < 0) break;
        used[nx] = 1; w.push(X[nx], Y[nx]); cur = nx;
      }
      walks.push(w);
    }
    return walks;
  }
  C.rechain = rechain;

  /**
   * rings: flat integer rings whose role is given by sign (area2 > 0 → outer, < 0 → hole).
   * Returns normalized PolygonWithHoles[]. Orphan holes (no containing outer) are dropped.
   */
  function assemble(rings, stats) {
    const outers = [], holes = [];
    const cleaned = []; for (const r0 of rings) { const c = cleanRing(r0); if (c.length >= 6) cleaned.push(c); }
    for (const r0 of rechain(splitTJunctions(cleaned))) {
      for (const s of splitRing(cleanRing(r0))) {
        const r = cleanRing(s); if (r.length < 6) continue;
        const a = area2(r); if (a === 0) continue;
        (a > 0 ? outers : holes).push({ r, a: Math.abs(a), b: ringBox(r) });
      }
    }
    // Uniform grid over outer bboxes (smallest-area candidates first) → candidate outers per hole.
    const polys = outers.map((o) => ({ o, holes: [] }));
    if (holes.length) {
      let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
      for (const o of outers) { gx0 = Math.min(gx0, o.b[0]); gy0 = Math.min(gy0, o.b[1]); gx1 = Math.max(gx1, o.b[2]); gy1 = Math.max(gy1, o.b[3]); }
      const GN = 64, cw = Math.floor((gx1 - gx0) / GN) + 1, ch = Math.floor((gy1 - gy0) / GN) + 1, grid = new Array(GN * GN);
      const order = polys.slice().sort((p, q) => p.o.a - q.o.a);
      for (const p of order) {
        const b = p.o.b;
        for (let gy = Math.floor((b[1] - gy0) / ch); gy <= Math.floor((b[3] - gy0) / ch); gy++)
          for (let gx = Math.floor((b[0] - gx0) / cw); gx <= Math.floor((b[2] - gx0) / cw); gx++) (grid[gy * GN + gx] || (grid[gy * GN + gx] = [])).push(p);
      }
      for (const h of holes) {
        if (h.b[0] < gx0 || h.b[1] < gy0 || h.b[2] > gx1 || h.b[3] > gy1) { if (stats) stats.orphans++; continue; }
        const cell = grid[Math.floor((h.b[1] - gy0) / ch) * GN + Math.floor((h.b[0] - gx0) / cw)] || [];
        let best = null;
        for (const p of cell) {
          const b = p.o.b;
          if (p.o.a <= h.a || b[0] > h.b[0] || b[1] > h.b[1] || b[2] < h.b[2] || b[3] < h.b[3]) continue;
          if (ringInside(h.r, p.o.X || (p.o.X = bandIndex(p.o.r)))) { best = p; break; }
        }
        if (best) best.holes.push(h.r); // orphan holes (no containing outer) are dropped: they carry no material
        else if (stats) stats.orphans++;
      }
    }
    const keyed = (r) => { const m = minXY(r); return { r: rotateStart(r), y: m[1], x: m[0] }; };
    const out = polys.map((p) => {
      const o = keyed(p.o.r);
      o.holes = p.holes.map(keyed).sort(cmpKeyed).map((h) => h.r);
      return o;
    }).sort(cmpKeyed).map((o) => ({ outer: o.r, holes: o.holes }));
    return out;
  }
  function cmpKeyed(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    const n = Math.min(a.r.length, b.r.length);
    for (let i = 0; i < n; i++) if (a.r[i] !== b.r[i]) return a.r[i] - b.r[i];
    return a.r.length - b.r.length;
  }
  function minXY(r) { let x = Infinity, y = Infinity; for (let i = 0; i < r.length; i += 2) { if (r[i + 1] < y) y = r[i + 1]; if (r[i] < x) x = r[i]; } return [x, y]; }
  C.assemble = assemble;

  /**
   * Exact one-part test (D3, spike S5 F1) for ONE polygon whose rings are simple and meet only at points.
   * Nodes are rings and contact points (T-contacts included, found by the same noding as normalize); a ring
   * passing through a point is an edge. The interior has 1 + (cycle rank) components (Alexander duality),
   * so the polygon is one part iff that bipartite graph is a forest. Integer arithmetic only.
   */
  function interiorConnected(poly) {
    const rings = [poly.outer].concat(poly.holes || []);
    if (rings.length < 2) return true;
    const nr = splitTJunctions(rings), parent = rings.map((_, i) => i), at = new Map();
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let ri = 0; ri < nr.length; ri++) {
      const r = nr[ri];
      for (let i = 0; i < r.length; i += 2) {
        const x = r[i], y = r[i + 1];
        const k = Number.isInteger(x) && Number.isInteger(y) && x > -KLIM && x < KLIM && y > -KLIM && y < KLIM ? x * 67108864 + y : x + "," + y;
        const s = at.get(k);
        if (s === undefined) at.set(k, [ri]); else if (s.indexOf(ri) < 0) s.push(ri);
      }
    }
    for (const s of at.values()) for (let t = 1; t < s.length; t++) {
      const a = find(s[0]), b = find(s[t]);
      if (a === b) return false; // second path between two rings: a cycle of contacts cuts the interior
      parent[b] = a;
    }
    return true;
  }
  C.interiorConnected = interiorConnected;

  /** Rings with roles: outer forced positive, holes forced negative, then assemble. */
  C.normalize = (polys) => normalizeWith(polys, null);
  /** stats (optional) receives {orphans}: holes dropped because no outer contains them. */
  function normalizeWith(polys, stats) {
    const rings = [];
    for (const p of polys) {
      const o = p.outer; rings.push(area2(o) < 0 ? reverseRing(o) : o);
      for (const h of p.holes || []) rings.push(area2(h) > 0 ? reverseRing(h) : h);
    }
    return assemble(rings, stats);
  }

  C.fromPixelLoops = function (loops, sx, sy, ox, oy) {
    const rings = loops.map((L) => {
      const r = new Array(L.length * 2);
      for (let i = 0; i < L.length; i++) { // reversed order: trace winding → §3 winding
        const p = L[L.length - 1 - i];
        r[2 * i] = Math.round(p[0] * sx + ox); r[2 * i + 1] = Math.round(p[1] * sy + oy);
      }
      return r;
    });
    return assemble(rings);
  };

  // ------------------------------------------------------------- measures
  C.area = function (polys) {
    let a = 0;
    for (const p of polys) { a += Math.abs(area2(p.outer)); for (const h of p.holes || []) a -= Math.abs(area2(h)); }
    return a / 2;
  };
  C.isEmpty = (polys) => !polys.length || C.area(polys) === 0;
  C.bbox = (poly) => ringBox(poly.outer);
  C.containsPoint = function (polys, pt) {
    const [x, y] = pt;
    for (const p of polys) {
      const s = pointInRing(x, y, p.outer); if (s < 0) continue; if (s === 0) return true;
      let inHole = false;
      for (const h of p.holes || []) { const t = pointInRing(x, y, h); if (t === 0) return true; if (t > 0) { inHole = true; break; } }
      if (!inHole) return true;
    }
    return false;
  };

  // ------------------------------------------------ smoothing measures (G1.2)
  /**
   * Segment grid for nearest-segment queries on one flat ring. Each segment is sampled every cell/2 and
   * registered in the 3×3 cells around every sample, so every cell the segment passes through lists it.
   */
  function segGrid(R, cell) {
    const g = new Map(), n = R.length, key = (cx, cy) => cx * 4194304 + cy;
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n, ax = R[i], ay = R[i + 1], dx = R[j] - ax, dy = R[j + 1] - ay;
      const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / (cell / 2)));
      for (let s = 0; s <= steps; s++) {
        const cx = Math.floor((ax + (dx * s) / steps) / cell), cy = Math.floor((ay + (dy * s) / steps) / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const k = key(cx + ox, cy + oy); let l = g.get(k);
          if (!l) g.set(k, (l = [])); if (l[l.length - 1] !== i) l.push(i);
        }
        if (cx < gx0) gx0 = cx; if (cx > gx1) gx1 = cx; if (cy < gy0) gy0 = cy; if (cy > gy1) gy1 = cy;
      }
    }
    return { g, key, cell, R, gx0: gx0 - 1, gy0: gy0 - 1, gx1: gx1 + 1, gy1: gy1 + 1 };
  }
  function segDist(x, y, R, i) {
    const n = R.length, j = (i + 2) % n, ax = R[i], ay = R[i + 1], vx = R[j] - ax, vy = R[j + 1] - ay, L2 = vx * vx + vy * vy;
    let u = L2 ? ((x - ax) * vx + (y - ay) * vy) / L2 : 0;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    const ex = x - ax - u * vx, ey = y - ay - u * vy;
    return Math.sqrt(ex * ex + ey * ey);
  }
  /** Distance from (x, y) to the ring indexed by G; rings of cells are searched outward until no closer segment can exist. */
  function distToGrid(x, y, G) {
    const { g, key, cell, R } = G, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const rMax = Math.max(Math.abs(cx - G.gx0), Math.abs(cx - G.gx1), Math.abs(cy - G.gy0), Math.abs(cy - G.gy1)) + 1;
    let best = Infinity;
    for (let r = 0; r <= rMax; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (dx !== -r && dx !== r && dy !== -r && dy !== r) continue;
        const l = g.get(key(cx + dx, cy + dy)); if (!l) continue;
        for (const i of l) { const d = segDist(x, y, R, i); if (d < best) best = d; }
      }
      if (best <= r * cell) break; // unseen cells are more than r·cell away
    }
    return best;
  }
  function directedDev(A, GB, step) {
    let m = 0;
    const n = A.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n, ax = A[i], ay = A[i + 1], dx = A[j] - ax, dy = A[j + 1] - ay;
      const k = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / step));
      for (let s = 0; s < k; s++) { const d = distToGrid(ax + (dx * s) / k, ay + (dy * s) / k, GB); if (d > m) m = d; }
    }
    return m;
  }
  /**
   * GEO-04 measured deviation: symmetric Hausdorff distance between two closed flat rings (µm), with BOTH rings
   * densified every ≤ stepUm (vertices included), point-to-segment distances, Math.sqrt only (NFR-05). Peaks
   * inside segments are therefore measured to within stepUm/2.
   */
  C.maxDeviationUm = function (A, B, stepUm) {
    const step = stepUm === undefined ? 10 : stepUm;
    if (!(step > 0) || !Number.isFinite(step)) throw new Error("SBGeom.maxDeviationUm: stepUm must be finite and > 0");
    if (A.length < 2 || B.length < 2 || A.length % 2 || B.length % 2) throw new Error("SBGeom.maxDeviationUm: rings must be flat [x, y, …] with ≥ 1 vertex");
    const cellOf = (R) => { let L = 0; for (let i = 0; i < R.length; i += 2) { const j = (i + 2) % R.length, dx = R[j] - R[i], dy = R[j + 1] - R[i + 1]; L += Math.sqrt(dx * dx + dy * dy); }
      return Math.max(4 * step, L / (R.length / 2)); };
    const ab = directedDev(A, segGrid(B, cellOf(B)), step), ba = directedDev(B, segGrid(A, cellOf(A)), step);
    return ab > ba ? ab : ba;
  };

  /**
   * Canonical topology signature of a normalized polygon set: the containment tree outer → holes → outers
   * (each outer hangs under the smallest hole of another polygon that contains it), serialized with sorted
   * children. Ring coordinates do not enter; only ring count and nesting do (GEO-04 topology fallback).
   */
  C.ringTopology = function (polys) {
    const holes = [];
    polys.forEach((p, pi) => (p.holes || []).forEach((h) => holes.push({ pi, r: h, box: ringBox(h), a: Math.abs(area2(h)), kids: [] })));
    const roots = [];
    const probe = (outer, h) => { // a vertex strictly inside/outside h decides (rings of a normalized set never cross)
      for (let i = 0; i < outer.length; i += 2) { const s = pointInRing(outer[i], outer[i + 1], h); if (s !== 0) return s > 0; }
      for (let i = 0; i < outer.length; i += 2) { const j = (i + 2) % outer.length, mx = (outer[i] + outer[j]) / 2, my = (outer[i + 1] + outer[j + 1]) / 2;
        const s = pointInRing(mx, my, h); if (s !== 0) return s > 0; }
      return false;
    };
    polys.forEach((p, pi) => {
      const b = ringBox(p.outer); let best = null;
      for (const h of holes) {
        if (h.pi === pi || h.box[0] > b[0] || h.box[1] > b[1] || h.box[2] < b[2] || h.box[3] < b[3]) continue;
        if ((best === null || h.a < best.a) && probe(p.outer, h.r)) best = h;
      }
      (best ? best.kids : roots).push(pi);
    });
    const holesOf = new Map(); for (const h of holes) { let l = holesOf.get(h.pi); if (!l) holesOf.set(h.pi, (l = [])); l.push(h); }
    const sigP = (pi) => "O(" + (holesOf.get(pi) || []).map((h) => "H(" + h.kids.map(sigP).sort().join("") + ")").sort().join("") + ")";
    return roots.map(sigP).sort().join("");
  };

  // ------------------------------------------------------------- circle
  // round(1e6*cos(2πk/64)) for k = 0..16, generated once offline and frozen here (no trig at run time).
  const COS64 = [1000000, 995185, 980785, 956940, 923880, 881921, 831470, 773010, 707107, 634393, 555570, 471397, 382683, 290285, 195090, 98017, 0];
  /**
   * 64-vertex circle (fewer only when rounding makes vertices coincide or fall collinear, r < 232 µm).
   * Each offset r·t/1e6 is rounded half away from zero in exact integer arithmetic, so the polygon is
   * 8-fold symmetric about (cx, cy) even on exact .5 ties (Math.round(cx + t) would round −x.5 toward
   * +∞ and break the mirror symmetry). The ring is cleaned and normalized like any other output.
   */
  C.circle = function (cx, cy, r) {
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(r) || r < 1 || r > 1e9)
      throw new Error("SBGeom.circle: centre and radius must be integer µm, 1 ≤ r ≤ 1e9");
    const off = (t) => { const p = r * t, a = p < 0 ? -p : p, q = Math.floor((2 * a + 1e6) / 2e6); return p < 0 ? -q : q; };
    const o = [];
    for (let k = 0; k < 64; k++) {
      const q = k >> 4, i = k & 15; let c = COS64[i], s = COS64[16 - i];
      for (let t = 0; t < q; t++) { const c2 = -s; s = c; c = c2; } // rotate by 90°
      o.push(cx + off(c), cy + off(s));
    }
    return { outer: rotateStart(cleanRing(o)), holes: [] };
  };

  // ------------------------------------------------------------- validate
  function segRel(ax, ay, bx, by, cx, cy, dx, dy) {
    // 0 none, 1 proper crossing, 2 touch (endpoint on segment), 3 collinear overlap (positive length)
    const d1 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay), d2 = (bx - ax) * (dy - ay) - (dx - ax) * (by - ay);
    const d3 = (dx - cx) * (ay - cy) - (ax - cx) * (dy - cy), d4 = (dx - cx) * (by - cy) - (bx - cx) * (dy - cy);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 1;
    if (d1 === 0 && d2 === 0) {
      const ux = bx - ax, uy = by - ay, L = ux * ux + uy * uy;
      const t0 = (cx - ax) * ux + (cy - ay) * uy, t1 = (dx - ax) * ux + (dy - ay) * uy;
      const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(L, Math.max(t0, t1));
      if (hi > lo) return 3; if (hi === lo) return 2; return 0;
    }
    const on = (px, py, qx, qy, rx, ry) => rx >= Math.min(px, qx) && rx <= Math.max(px, qx) && ry >= Math.min(py, qy) && ry <= Math.max(py, qy);
    if ((d1 === 0 && on(ax, ay, bx, by, cx, cy)) || (d2 === 0 && on(ax, ay, bx, by, dx, dy)) ||
        (d3 === 0 && on(cx, cy, dx, dy, ax, ay)) || (d4 === 0 && on(cx, cy, dx, dy, bx, by))) return 2;
    return 0;
  }
  C.validate = function (polys) {
    const errors = [], segs = [];
    const ringKeys = new Map();
    polys.forEach((p, pi) => {
      [p.outer].concat(p.holes || []).forEach((r, ri) => {
        const id = { poly: pi, ring: ri };
        if (!Array.isArray(r) || r.length % 2 || r.length < 6 || r.some((v) => !Number.isInteger(v))) { errors.push({ code: "GEO_OPEN", ring: id }); return; }
        if (area2(r) === 0) { errors.push({ code: "GEO_ZERO_AREA", ring: id }); return; }
        const k = rotateStart(r).join(","), kr = rotateStart(reverseRing(r)).join(",");
        if (ringKeys.has(k) || ringKeys.has(kr)) errors.push({ code: "GEO_DUPLICATE", ring: id }); else ringKeys.set(k, 1);
        const n = r.length / 2, vset = new Set();
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, x = r[2 * i], y = r[2 * i + 1];
          if (x === r[2 * j] && y === r[2 * j + 1]) { errors.push({ code: "GEO_DUPLICATE", ring: id }); return; }
          const vk = x + "," + y; if (vset.has(vk)) { errors.push({ code: "GEO_SELF_INTERSECT", ring: id }); return; } vset.add(vk);
          segs.push({ ax: x, ay: y, bx: r[2 * j], by: r[2 * j + 1], ring: id, rk: pi + ":" + ri, i, n });
        }
      });
    });
    // sweep over x
    segs.forEach((s) => { s.x0 = Math.min(s.ax, s.bx); s.x1 = Math.max(s.ax, s.bx); s.y0 = Math.min(s.ay, s.by); s.y1 = Math.max(s.ay, s.by); });
    segs.sort((a, b) => a.x0 - b.x0);
    const bad = new Set(); let active = [];
    for (const s of segs) {
      active = active.filter((t) => t.x1 >= s.x0);
      for (const t of active) {
        if (t.y1 < s.y0 || t.y0 > s.y1) continue;
        const rel = segRel(s.ax, s.ay, s.bx, s.by, t.ax, t.ay, t.bx, t.by);
        if (!rel) continue;
        const same = s.rk === t.rk, adj = same && ((s.i + 1) % s.n === t.i || (t.i + 1) % t.n === s.i);
        let err = rel === 1 || rel === 3;
        if (rel === 2 && same && !adj) err = true;          // ring touching itself
        if (rel === 2 && adj) err = false;                  // shared endpoint of neighbours
        if (rel === 3 && adj) err = true;                   // spike / backtrack
        if (err && !bad.has(s.rk)) { bad.add(s.rk); errors.push({ code: "GEO_SELF_INTERSECT", ring: s.ring }); }
      }
      active.push(s);
    }
    // D3 postcondition: one polygon = one part. Only for polygons whose rings are otherwise valid.
    const badPoly = new Set(errors.map((e) => e.ring.poly));
    polys.forEach((p, pi) => {
      if (!badPoly.has(pi) && (p.holes || []).length && !interiorConnected(p)) errors.push({ code: "GEO_MULTIPART", ring: { poly: pi, ring: null } });
    });
    return { ok: errors.length === 0, errors };
  };

  // ================================================ canonical bytes and hash scope (decision D4)
  // Spike S6 (docs/spikes/S6.md §5). Little-endian int32 stream, layers in ascending index order:
  //   [layerCount, (index, partCount, (ringCount, (vertexCount, x, y …)…)…,
  //                 scoreCount, (vertexCount, x, y …)…,
  //                 holeCount, (cx, cy, r)…)…]
  // The trailing hole section is D4 amendment A. Every coordinate must be an integer with
  // |v| ≤ 2^25 µm (amendment C): that keeps every cross product an exact double, and anything else
  // THROWS rather than truncating. canonicalBytes always normalizes (idempotent), so the bytes never
  // depend on the caller having normalized. Input material must be boolean-resolved.
  const LIM = 33554432; // 2^25 µm (33.5 m)
  function checkCoord(v) {
    if (!Number.isInteger(v) || v > LIM || v < -LIM) throw new Error("SBGeom.canonicalBytes: coordinate is not an integer µm within ±2^25: " + v);
  }
  function checkRing(r) {
    if (!Array.isArray(r)) throw new Error("SBGeom.canonicalBytes: ring or path must be a plain Array of integer µm (got " + (r === null ? "null" : ArrayBuffer.isView(r) ? r.constructor.name : typeof r) + ")");
    if (r.length % 2) throw new Error("SBGeom.canonicalBytes: ring has an odd coordinate count");
    for (const v of r) checkCoord(v);
  }
  function cmpSeq(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }

  /**
   * Canonical score polyline: consecutive duplicates removed, pass-through collinear points dropped
   * (reversals and spikes always kept: every vertex that turns back is part of a line that is burned).
   * An open path is oriented so the smaller (x, y) endpoint comes first. A closed path (first point
   * repeated last) is treated as a cycle: duplicates and pass-through points are removed cyclically
   * (never spikes or out-and-back tails, so a ring with a tail hashes differently from the plain ring),
   * then it is written as the lexicographically smallest of its rotations that start at its smallest
   * (x, y) vertex, in the positive direction when it encloses signed area and in either direction
   * when it does not (out-and-back, self-cancelling bowtie). The closing point is repeated. So the
   * result is invariant to start vertex and direction for every closed path, degenerate ones included.
   * Returns null for fewer than 2 distinct points (no segment, nothing burned): the only paths dropped.
   */
  function canonPolyline(src) {
    const pts = [];
    for (let i = 0; i < src.length; i += 2) {
      const n = pts.length; if (n && pts[n - 2] === src[i] && pts[n - 1] === src[i + 1]) continue;
      pts.push(src[i], src[i + 1]);
    }
    const n = pts.length >> 1; if (n < 2) return null;
    if (n > 2 && pts[0] === pts[2 * n - 2] && pts[1] === pts[2 * n - 1]) return canonClosed(pts.slice(0, -2));
    const keep = [pts[0], pts[1]];
    for (let i = 1; i < n - 1; i++) {
      const ax = keep[keep.length - 2], ay = keep[keep.length - 1], bx = pts[2 * i], by = pts[2 * i + 1], cx = pts[2 * i + 2], cy = pts[2 * i + 3];
      if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) === 0 && (bx - ax) * (cx - bx) + (by - ay) * (cy - by) > 0) continue;
      keep.push(bx, by);
    }
    keep.push(pts[2 * n - 2], pts[2 * n - 1]);
    const m = keep.length;
    return keep[m - 2] < keep[0] || (keep[m - 2] === keep[0] && keep[m - 1] < keep[1]) ? reverseRing(keep) : keep;
  }
  /**
   * c: a cycle of ≥ 2 points without its closing point, no two consecutive points equal (cyclically).
   * Drops pass-through collinear vertices only: removing one never changes the direction of the edges
   * around its neighbours, so one pass over the original neighbours is exact.
   */
  function canonClosed(c) {
    const n = c.length >> 1, v = [];
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n;
      const ux = c[2 * i] - c[2 * p], uy = c[2 * i + 1] - c[2 * p + 1], wx = c[2 * q] - c[2 * i], wy = c[2 * q + 1] - c[2 * i + 1];
      if (n > 2 && ux * wy - uy * wx === 0 && ux * wx + uy * wy > 0) continue;
      v.push(c[2 * i], c[2 * i + 1]);
    }
    const a = area2(v), dirs = a > 0 ? [v] : a < 0 ? [reverseRing(v)] : [v, reverseRing(v)];
    let mx = v[0], my = v[1];
    for (let i = 2; i < v.length; i += 2) if (v[i] < mx || (v[i] === mx && v[i + 1] < my)) { mx = v[i]; my = v[i + 1]; }
    let best = null;
    for (const d of dirs) for (let i = 0; i < d.length; i += 2) {
      if (d[i] !== mx || d[i + 1] !== my) continue;
      const r = d.slice(i).concat(d.slice(0, i));
      if (!best || cmpSeq(r, best) < 0) best = r;
    }
    return best.concat([mx, my]);
  }
  C.canonPolyline = canonPolyline;

  /** The three word sections of one layer: {head: index + material, score, holes}. */
  function layerSections(L) {
    checkCoord(L.index);
    if (L.index < 0) throw new Error("SBGeom.canonicalBytes: negative layer index " + L.index);
    const mat = L.material || [];
    for (const p of mat) { checkRing(p.outer); for (const h of p.holes || []) checkRing(h); }
    const st = { orphans: 0 }, head = [L.index], polys = normalizeWith(mat, st);
    // Amendment C: never lose input silently. A hole with no containing outer cannot occur on
    // boolean-resolved input; anywhere else it would vanish from the hash, so it throws.
    if (st.orphans) throw new Error("SBGeom.canonicalBytes: " + st.orphans + " hole(s) of layer " + L.index + " lie in no outer (input is not boolean-resolved)");
    head.push(polys.length);
    for (const p of polys) {
      head.push(1 + p.holes.length);
      for (const r of [p.outer].concat(p.holes)) { head.push(r.length >> 1); for (const v of r) head.push(v); }
    }
    const sc = [];
    for (const s of L.scorePaths || []) { checkRing(s); const c = canonPolyline(s); if (c) sc.push(c); }
    sc.sort(cmpSeq);
    const score = [sc.length];
    for (const s of sc) { score.push(s.length >> 1); for (const v of s) score.push(v); }
    const hs = (L.holes || []).map((h) => { checkCoord(h.cxUm); checkCoord(h.cyUm); checkCoord(h.rUm); if (h.rUm <= 0) throw new Error("SBGeom.canonicalBytes: registration hole radius must be > 0 µm: " + h.rUm); return [h.cyUm, h.cxUm, h.rUm]; }).sort(cmpSeq);
    const holes = [hs.length];
    for (const h of hs) holes.push(h[1], h[0], h[2]);
    return { head, score, holes };
  }
  function toBytes(chunks) {
    let n = 0; for (const c of chunks) n += c.length;
    const buf = new Uint8Array(n * 4), dv = new DataView(buf.buffer); let o = 0;
    for (const c of chunks) for (let i = 0; i < c.length; i++, o += 4) dv.setInt32(o, c[i], true);
    return buf;
  }
  const NO_SCORES = [0];

  /**
   * canonicalBytes(layers: {index, material, holes?: {cxUm, cyUm, rUm}[], scorePaths?}[]) → Uint8Array.
   * Layer indices must be distinct: two layers with the same index would be emitted in input order,
   * so the bytes would depend on it. That throws.
   */
  C.canonicalBytes = function (layers) {
    const ls = layers.slice().sort((a, b) => a.index - b.index), chunks = [[ls.length]];
    for (let i = 1; i < ls.length; i++) if (ls[i].index === ls[i - 1].index) throw new Error("SBGeom.canonicalBytes: duplicate layer index " + ls[i].index);
    for (const L of ls) { const s = layerSections(L); chunks.push(s.head, s.score, s.holes); }
    return toBytes(chunks);
  };
  /**
   * Both D4 layer hashes from one normalization (amendment B):
   *   materialHash = sha256(canonicalBytes([{index, material, holes}]))  (scoreCount 0) — MaterialLayer.canonicalHash,
   *                  guide invalidation, repair before/after hashes, part-ID stability;
   *   layerHash    = sha256(canonicalBytes([layer]))                      — the only one in geometryHash.layers.
   */
  C.layerHashes = function (L) {
    const s = layerSections(L), sha = global.SBHash.sha256;
    return { materialHash: sha(toBytes([[1], s.head, NO_SCORES, s.holes])), layerHash: sha(toBytes([[1], s.head, s.score, s.holes])) };
  };
  C.layerHash = (L) => global.SBHash.sha256(C.canonicalBytes([L]));
  C.materialHash = (L) => global.SBHash.sha256(C.canonicalBytes([{ index: L.index, material: L.material, holes: L.holes }]));
  C.COORD_LIMIT = LIM;

  // ===================================================== Clipper2 backend (decision D2)
  // Booleans and offsets over global.Clipper2 (js/vendor/clipper2.js, clipper2-ts 2.0.1-18), looked
  // up at call time. Paths are Int64 µm; NonZero fill on role-oriented rings (outer +, hole −).
  // Raw Clipper2 chaining at vertex contacts is not canonical, so every result goes through
  // assemble() → rechain() (spike S1 Finding 1): the output depends only on the edge set.
  const L = () => global.Clipper2;
  function toPaths(polys) {
    const out = [];
    for (const p of polys || []) {
      const rings = [[p.outer, 1]].concat((p.holes || []).map((h) => [h, -1]));
      for (const [r, sign] of rings) {
        const a = area2(r); if (a === 0) continue;
        const rr = (a > 0) === (sign > 0) ? r : reverseRing(r);
        const path = new Array(rr.length / 2);
        for (let i = 0; i < rr.length; i += 2) path[i / 2] = { x: rr[i], y: rr[i + 1] };
        out.push(path);
      }
    }
    return out;
  }
  function fromPaths(paths) {
    const rings = new Array(paths.length);
    for (let k = 0; k < paths.length; k++) {
      const p = paths[k], r = new Array(p.length * 2);
      for (let i = 0; i < p.length; i++) { r[2 * i] = p[i].x; r[2 * i + 1] = p[i].y; }
      rings[k] = r;
    }
    return assemble(rings); // Clipper2 emits outers positive / holes negative (same sign convention as §3)
  }
  const NZ = () => L().FillRule.NonZero;

  const G = {};
  G.union = (a, b) => fromPaths(L().union(toPaths(a), toPaths(b || []), NZ()));
  G.difference = (a, b) => fromPaths(L().difference(toPaths(a), toPaths(b || []), NZ()));
  G.intersection = (a, b) => fromPaths(L().intersect(toPaths(a), toPaths(b || []), NZ()));
  /**
   * "miter" (limit 2.0) is exact on the pixel lattice: every 90° corner stays square. "square" is
   * Clipper2's squared (chamfered) corner, not a Chebyshev square. "round" is refused (trig, NFR-05).
   */
  G.offset = function (polys, delta, join) {
    const J = L().JoinType;
    const jt = join === "miter" ? J.Miter : join === "square" ? J.Square : null;
    if (jt === null) throw new Error("SBGeom.offset: join '" + join + "' refused (only miter|square are deterministic)");
    // D3 / S5 F4: Clipper2 Paths64 offsets are meaningless below the 1 µm grid (|delta| < 0.5 is a no-op, −0.5 is
    // orientation- and shape-dependent), so only integer µm deltas are accepted. Sub-µm insets: insetStatus().
    if (!Number.isInteger(delta)) throw new Error("SBGeom.offset: GEO_OFFSET_NONINTEGER — delta must be an integer µm (got " + delta + "); use SBGeom.survivesInset for sub-µm insets");
    if (delta === 0) return C.normalize(polys);
    return fromPaths(L().inflatePaths(toPaths(polys), delta, jt, L().EndType.Polygon, 2.0));
  };
  /** One entry per connected part; point contact counts as separate (D3). Asserts the D3 postcondition. */
  G.components = function (polys) {
    const u = G.union(polys, []);
    for (let i = 0; i < u.length; i++) if (!interiorConnected(u[i])) throw new Error("SBGeom.components: GEO_MULTIPART_POLYGON — normalized polygon " + i + " has a disconnected interior");
    return u.map((p) => [p]);
  };

  // ------------------------------------------- finite-width contact (decision D3, spike S5 F6, Appendix B.3)
  // survives(I, d) ⇔ the closed inward offset I ⊖ B(d) is non-empty ⇔ r*(I) ≥ d, where r* is the radius of the
  // largest disk inside I; the contact WIDTH is w = 2·r*. Verdicts:
  //   "survives"  — certified EXACTLY: a rational witness p = (X/q, Y/q) strictly inside I (even–odd) with
  //                 dist(p, e)² ≥ d² for every edge e, checked in BigInt. Independent of Clipper2, floats and scale.
  //   "fails"     — certified through Clipper2: the BEVEL inset at d − m (m = 2 units at ×scale) is empty. Bevel ⊇ the
  //                 true inset, and a true inset at d would leave a disk of radius m there, which survives the ≤ 0.71-unit
  //                 vertex rounding. (Assumes Clipper2 offsets by winding number; cross-checked in spike S5.)
  //   "undecided" — neither. survivesInset() returns true ONLY for "survives", so undecided counts as NOT surviving
  //                 (warn / block): the boolean never reports a contact wider than it is.
  // Spike S5 also tried a Round-join failure certificate; it is not shipped (trig inside Clipper2, NFR-05), so a few
  // reflex-bound shapes that S5 certified as "fails" are "undecided" here — the boolean is unchanged.
  // Never built on SBGeom.offset (F4). Candidates: Clipper2 miter/bevel insets at ×scale on translated coordinates;
  // then a float pattern search over a fixed 16-direction table (from COS64: no trig), snapped to 1/4096 µm.
  const DIRS16 = [];
  for (let k = 0; k < 16; k++) {
    const i = (k & 3) * 4; let c = COS64[i], s = COS64[16 - i];
    for (let t = 0; t < k >> 2; t++) { const c2 = -s; s = c; c = c2; } // rotate by 90°
    DIRS16.push([c / 1e6, s / 1e6]);
  }
  function dyadic(d) {
    const n = Math.round(d * 1024);
    if (!(n > 0) || n / 1024 !== d) throw new Error("SBGeom.insetStatus: GEO_INSET_NOT_DYADIC — inset must be a positive multiple of 1/1024 µm (got " + d + ")");
    return [BigInt(n), BigInt(1024)];
  }
  /** Exact: is (X/q, Y/q) strictly inside the rings (even–odd) with every edge at distance ≥ d? */
  function verifyWitness(rings, X, Y, q, d) {
    const [dn, dd] = dyadic(d), Q = BigInt(q), PX = BigInt(X), PY = BigInt(Y), lim = dn * Q * (dn * Q), dd2 = dd * dd, Z = BigInt(0);
    let inside = false;
    for (const r of rings) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = BigInt(r[2 * j]) * Q, ay = BigInt(r[2 * j + 1]) * Q, bx = BigInt(r[2 * i]) * Q, by = BigInt(r[2 * i + 1]) * Q;
        const ex = bx - ax, ey = by - ay, wx = PX - ax, wy = PY - ay, L = ex * ex + ey * ey, t = wx * ex + wy * ey;
        if (t <= Z) { if (dd2 * (wx * wx + wy * wy) < lim) return false; }
        else if (t >= L) { const vx = PX - bx, vy = PY - by; if (dd2 * (vx * vx + vy * vy) < lim) return false; }
        else { const cr = ex * wy - ey * wx; if (dd2 * cr * cr < lim * L) return false; }
        if ((ay > PY) !== (by > PY)) { const s = (PX - ax) * (by - ay) - ex * (PY - ay); if (by - ay > Z ? s < Z : s > Z) inside = !inside; }
      }
    }
    return inside;
  }
  function candidatesOf(paths) { // float points: area centroid, vertex mean, vertices and edge midpoints
    const c = [];
    for (const p of paths) {
      const n = p.length; if (n < 3) continue;
      let A = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n], cr = a.x * b.y - b.x * a.y; A += cr; cx += (a.x + b.x) * cr; cy += (a.y + b.y) * cr; sx += a.x; sy += a.y; }
      if (A !== 0) c.push([cx / (3 * A), cy / (3 * A)]);
      c.push([sx / n, sy / n]);
      for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; c.push([a.x, a.y], [(a.x + b.x) / 2, (a.y + b.y) / 2]); }
    }
    return c;
  }
  /** Float depth of (x, y): distance to the boundary if inside (even–odd), else −1. Only steers the search. */
  function depthF(rings, x, y) {
    let inside = false, m = Infinity;
    for (const r of rings) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = r[2 * j], ay = r[2 * j + 1], bx = r[2 * i], by = r[2 * i + 1];
        if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
        const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey; let t = L ? ((x - ax) * ex + (y - ay) * ey) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = ax + t * ex - x, dy = ay + t * ey - y, d2 = dx * dx + dy * dy; if (d2 < m) m = d2;
      }
    }
    return inside ? Math.sqrt(m) : -1;
  }
  function refine(rings, x, y, step) { // pattern search towards the max-inscribed-disk centre (float; verified exactly after)
    let best = depthF(rings, x, y);
    for (let it = 0; it < 4000 && step > 1e-7; it++) {
      let moved = false;
      for (const [dx, dy] of DIRS16) { const v = depthF(rings, x + dx * step, y + dy * step); if (v > best) { best = v; x += dx * step; y += dy * step; moved = true; break; } }
      if (!moved) step /= 2;
    }
    return [x, y, best];
  }
  /**
   * insetStatus(I: PolygonWithHoles[], dUm, {scale}?) → {status: "survives"|"fails"|"undecided", witness?: {X, Y, q}, scale, via}.
   * dUm must be dyadic (a multiple of 1/1024 µm, e.g. 0.25 or minFeatureUm/2 with integer minFeatureUm).
   * Scale defaults to max(16, ⌈16/d⌉).
   */
  G.insetStatus = function (polys, dUm, opts) {
    dyadic(dUm);
    const C2 = L(), JT = C2.JoinType, ET = C2.EndType, rings = [];
    for (const p of polys || []) {
      if (area2(p.outer) !== 0) rings.push(area2(p.outer) < 0 ? reverseRing(p.outer) : p.outer);
      for (const h of p.holes || []) if (area2(h) !== 0) rings.push(area2(h) > 0 ? reverseRing(h) : h);
    }
    if (!rings.length || C.area(polys) <= 0) return { status: "fails", via: "empty" };
    const s = opts && opts.scale !== undefined ? opts.scale : Math.max(16, Math.ceil(16 / dUm)), m = 2;
    let x0 = Infinity, y0 = Infinity;
    for (const r of rings) { const b = ringBox(r); if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; }
    const up = rings.map((r) => { const p = []; for (let i = 0; i < r.length; i += 2) p.push({ x: (r[i] - x0) * s, y: (r[i + 1] - y0) * s }); return p; });
    const D = dUm * s, q = 2 * s, off = (delta, jt) => (delta < 0.5 ? null : C2.inflatePaths(up, -delta, jt, ET.Polygon, 2.0));
    const tried = new Set(), seeds = [];
    const tryPaths = (paths) => {
      if (!paths) return null;
      for (const [cx, cy] of candidatesOf(paths)) {
        const X = Math.round(cx * 2) + q * x0, Y = Math.round(cy * 2) + q * y0, k = X + "," + Y;
        if (tried.has(k)) continue; tried.add(k);
        if (verifyWitness(rings, X, Y, q, dUm)) return { X, Y, q };
        if (seeds.length < 4096) seeds.push([X / q, Y / q]);
      }
      return null;
    };
    // 1. witnesses from Clipper2 insets (miter ⊆ true inset ⊆ bevel)
    for (const [delta, jt] of [[D + m, JT.Miter], [D, JT.Miter], [D + m, JT.Bevel], [D - m, JT.Miter], [D - m, JT.Bevel]]) {
      const w = tryPaths(off(delta, jt)); if (w) return { status: "survives", witness: w, scale: s, via: "inset" };
    }
    // 2. failure certificate: the bevel (outer approximation) inset at d − m is empty ⇒ r* < d
    if (D - m >= 1 && !off(D - m, JT.Bevel).some((p) => C2.area(p) !== 0)) return { status: "fails", scale: s, via: "bevel" };
    // 3. refine the deepest candidates (and the input's own) by pattern search; snap to 1/4096 µm; verify exactly
    for (const c of candidatesOf(up)) seeds.push([c[0] / s + x0, c[1] / s + y0]);
    const ranked = seeds.map(([x, y]) => [x, y, depthF(rings, x, y)]).filter((t) => t[2] > 0).sort((a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1]).slice(0, 4);
    for (const [sx, sy] of ranked) {
      const [rx, ry, dep] = refine(rings, sx, sy, 1 / s); if (dep < dUm * (1 - 1e-9)) continue;
      const Q = 4096, X = Math.round(rx * Q), Y = Math.round(ry * Q);
      if (verifyWitness(rings, X, Y, Q, dUm)) return { status: "survives", witness: { X, Y, q: Q }, scale: s, via: "refine" };
    }
    return { status: "undecided", scale: s };
  };
  /** True only when survival of the inset dUm is certified exactly (undecided counts as NOT surviving). */
  G.survivesInset = (polys, dUm, opts) => G.insetStatus(polys, dUm, opts).status === "survives";
  /**
   * G2.7 classification of a support contact I = intersection(upper part, lower part), Appendix B.3 thresholds:
   * "block" if w < 0.5 µm (does not survive an inset of 0.25 µm; empty, point and line contact included),
   * "warn" (SUPPORT_NARROW) if w < minFeatureUm (does not survive minFeatureUm/2, minFeatureUm first rounded to an
   * integer µm so the half is dyadic), else "ok". `certain` is false when the verdict came from "undecided".
   */
  G.classifyContact = function (I, minFeatureUm) {
    if (!(minFeatureUm >= 0) || !Number.isFinite(minFeatureUm)) throw new Error("SBGeom.classifyContact: minFeatureUm must be a finite number ≥ 0 (got " + minFeatureUm + ")");
    const b = G.insetStatus(I, 0.25);
    if (b.status !== "survives") return { level: "block", certain: b.status === "fails" };
    const mf = Math.round(minFeatureUm);
    if (mf >= 1) { const w = G.insetStatus(I, mf / 2); if (w.status !== "survives") return { level: "warn", certain: w.status === "fails" }; }
    return { level: "ok", certain: true };
  };

  for (const k of ["fromPixelLoops", "normalize", "validate", "area", "isEmpty", "containsPoint", "bbox", "circle",
    "canonicalBytes", "layerHashes", "layerHash", "materialHash", "COORD_LIMIT", "interiorConnected", "rechain", "splitTJunctions",
    "maxDeviationUm", "ringTopology"]) G[k] = C[k];
  G.backend = "clipper2-ts@2.0.1-18";

  global.SBGeom = G;
})(typeof window !== "undefined" ? window : globalThis);
