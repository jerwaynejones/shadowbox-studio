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
 *   · Boundary edges meeting at a shared vertex are re-chained canonically
 *     (sharpest left turn), then rings touching themselves at a vertex (pixel
 *     saddles) are split into separate simple rings (D3); holes are assigned
 *     to the smallest outer that contains them.
 *   · Polygons sorted by (minY, minX) of the outer, then by the outer's
 *     coordinate list; holes the same way.
 * Only + - * / Math.round/floor/abs/sqrt are used here (NFR-05). No trig.
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

  // ------------------------------------------------------------- hierarchy
  /**
   * Canonical re-chaining at shared vertices (D3). All rings are role-oriented (material on the LEFT
   * in the math frame: outer CCW / positive). Wherever several boundary edges leave the same vertex,
   * each arriving edge continues on the outgoing edge with the sharpest LEFT turn (the edge met first
   * when sweeping clockwise from the reversed arrival direction). This hugs material, so parts that
   * only touch at a point come out as separate rings, and the decomposition depends only on the edge
   * set — not on how the backend happened to chain its output (exact integer comparisons only).
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
  function assemble(rings) {
    const outers = [], holes = [];
    const cleaned = []; for (const r0 of rings) { const c = cleanRing(r0); if (c.length >= 6) cleaned.push(c); }
    for (const r0 of rechain(cleaned)) {
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
        if (h.b[0] < gx0 || h.b[1] < gy0 || h.b[2] > gx1 || h.b[3] > gy1) continue;
        const cell = grid[Math.floor((h.b[1] - gy0) / ch) * GN + Math.floor((h.b[0] - gx0) / cw)] || [];
        let best = null;
        for (const p of cell) {
          const b = p.o.b;
          if (p.o.a <= h.a || b[0] > h.b[0] || b[1] > h.b[1] || b[2] < h.b[2] || b[3] < h.b[3]) continue;
          if (ringInside(h.r, p.o.X || (p.o.X = bandIndex(p.o.r)))) { best = p; break; }
        }
        if (best) best.holes.push(h.r); // orphan holes (no containing outer) are dropped: they carry no material
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

  /** Rings with roles: outer forced positive, holes forced negative, then assemble. */
  C.normalize = function (polys) {
    const rings = [];
    for (const p of polys) {
      const o = p.outer; rings.push(area2(o) < 0 ? reverseRing(o) : o);
      for (const h of p.holes || []) rings.push(area2(h) > 0 ? reverseRing(h) : h);
    }
    return assemble(rings);
  };

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
    return { ok: errors.length === 0, errors };
  };

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
    if (!Number.isInteger(delta)) throw new Error("SBGeom.offset: delta must be integer µm");
    if (delta === 0) return C.normalize(polys);
    return fromPaths(L().inflatePaths(toPaths(polys), delta, jt, L().EndType.Polygon, 2.0));
  };
  /** One entry per connected part; point contact counts as separate (D3). */
  G.components = (polys) => G.union(polys, []).map((p) => [p]);
  for (const k of ["fromPixelLoops", "normalize", "validate", "area", "isEmpty", "containsPoint", "bbox", "circle"]) G[k] = C[k];
  G.backend = "clipper2-ts@2.0.1-18";

  global.SBGeom = G;
})(typeof window !== "undefined" ? window : globalThis);
