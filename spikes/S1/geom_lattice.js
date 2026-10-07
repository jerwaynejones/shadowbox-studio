/* spikes/S1/geom_lattice.js — candidate (c): exact orthogonal booleans on the shared lattice.
 * Input rings must be axis-parallel (every edge horizontal or vertical); anything else throws
 * GEO_NOT_ORTHOGONAL. Booleans: coordinate-compressed cell grid, NonZero winding per cell,
 * boundary re-traced with the SBTrace left-turn rule (saddles stay separate).
 * Offset: exact Chebyshev (square structuring element) Minkowski dilation / erosion, which equals
 * a miter join on orthogonal input; "miter" and "square" are therefore the same here.
 * Requires global.SBGeomCore at call time. Integer-only arithmetic.
 */
(function (global) {
  "use strict";
  const G = {};
  const K = () => global.SBGeomCore;

  function rolesRings(polys) {
    const C = K(), out = [];
    for (const p of polys || []) {
      const o = p.outer; if (C.area2(o) !== 0) out.push(C.area2(o) > 0 ? o : C.reverseRing(o));
      for (const h of p.holes || []) if (C.area2(h) !== 0) out.push(C.area2(h) < 0 ? h : C.reverseRing(h));
    }
    return out;
  }
  function uniqSorted(arr) { arr.sort((a, b) => a - b); const o = []; for (const v of arr) if (!o.length || o[o.length - 1] !== v) o.push(v); return o; }
  function indexMap(vals) { const m = new Map(); vals.forEach((v, i) => m.set(v, i)); return m; }

  /** NonZero inside-mask of rings on grid (xs, ys). */
  function cellsOf(rings, xs, ys, xi, yi) {
    const nx = xs.length - 1, ny = ys.length - 1, W = nx + 1;
    const diff = new Int32Array(W * Math.max(ny, 0));
    for (const r of rings) {
      const n = r.length;
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n, ax = r[i], ay = r[i + 1], bx = r[j], by = r[j + 1];
        if (ay === by) continue;
        if (ax !== bx) { const e = new Error("GEO_NOT_ORTHOGONAL: lattice backend needs axis-parallel edges"); e.code = "GEO_NOT_ORTHOGONAL"; throw e; }
        const c = xi.get(ax), j0 = yi.get(Math.min(ay, by)), j1 = yi.get(Math.max(ay, by)), d = ay > by ? 1 : -1;
        for (let row = j0; row < j1; row++) diff[row * W + c] += d;
      }
    }
    const m = new Uint8Array(nx * ny);
    for (let row = 0; row < ny; row++) { let w = 0; for (let c = 0; c < nx; c++) { w += diff[row * W + c]; m[row * nx + c] = w !== 0 ? 1 : 0; } }
    return m;
  }
  function coords(ringsList, extraX, extraY) {
    const X = extraX ? extraX.slice() : [], Y = extraY ? extraY.slice() : [];
    for (const rings of ringsList) for (const r of rings) for (let i = 0; i < r.length; i += 2) { X.push(r[i]); Y.push(r[i + 1]); }
    const xs = uniqSorted(X), ys = uniqSorted(Y);
    return { xs, ys, xi: indexMap(xs), yi: indexMap(ys) };
  }

  /** Boundary trace of a cell mask (same edge/turn rules as SBTrace.trace), mapped to xs/ys; returns §3-wound rings. */
  function traceCells(m, nx, ny, xs, ys) {
    const CW = nx + 1, out = new Uint8Array(CW * (ny + 1));
    const at = (x, y) => (x >= 0 && y >= 0 && x < nx && y < ny ? m[y * nx + x] : 0);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (!m[y * nx + x]) continue;
      if (!at(x, y - 1)) out[y * CW + x + 1] |= 4;          // dir 2 (-x)
      if (!at(x, y + 1)) out[(y + 1) * CW + x] |= 1;        // dir 0 (+x)
      if (!at(x - 1, y)) out[y * CW + x] |= 2;              // dir 1 (+y)
      if (!at(x + 1, y)) out[(y + 1) * CW + x + 1] |= 8;    // dir 3 (-y)
    }
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], rings = [];
    for (let s = 0; s < out.length; s++) {
      while (out[s]) {
        const bits = out[s], d0 = 31 - Math.clz32(bits & -bits);
        let cx = s % CW, cy = (s / CW) | 0, dir = d0; const sx = cx, sy = cy;
        out[s] &= ~(1 << d0);
        const pts = [cx, cy]; cx += DX[dir]; cy += DY[dir];
        while (!(cx === sx && cy === sy)) {
          pts.push(cx, cy);
          const idx = cy * CW + cx, av = out[idx];
          let next = -1; for (const d of [(dir + 3) & 3, dir, (dir + 1) & 3]) if (av & (1 << d)) { next = d; break; }
          if (next < 0) throw new Error("lattice trace: broken chain");
          out[idx] &= ~(1 << next); dir = next; cx += DX[dir]; cy += DY[dir];
        }
        // map + reverse (trace winding is opposite to §3), drop collinear points along the way
        const r = [];
        for (let i = pts.length - 2; i >= 0; i -= 2) r.push(xs[pts[i]], ys[pts[i + 1]]);
        rings.push(r);
      }
    }
    return K().assemble(rings);
  }

  function boolOp(a, b, op) {
    const ra = rolesRings(a), rb = rolesRings(b);
    if (!ra.length && !rb.length) return [];
    const { xs, ys, xi, yi } = coords([ra, rb]);
    if (xs.length < 2 || ys.length < 2) return [];
    const ma = cellsOf(ra, xs, ys, xi, yi), mb = cellsOf(rb, xs, ys, xi, yi), r = new Uint8Array(ma.length);
    for (let i = 0; i < r.length; i++) r[i] = op(ma[i], mb[i]);
    return traceCells(r, xs.length - 1, ys.length - 1, xs, ys);
  }
  G.union = (a, b) => boolOp(a, b || [], (p, q) => p | q);
  G.difference = (a, b) => boolOp(a, b || [], (p, q) => p & (q ^ 1));
  G.intersection = (a, b) => boolOp(a, b || [], (p, q) => p & q);

  /** Maximal rectangles of a cell mask: row runs merged vertically. */
  function rectsOf(m, nx, ny, xs, ys, want) {
    const rects = []; let open = new Map();
    for (let y = 0; y <= ny; y++) {
      const cur = new Map();
      if (y < ny) for (let x = 0; x < nx;) {
        if (m[y * nx + x] !== want) { x++; continue; }
        let e = x; while (e < nx && m[y * nx + e] === want) e++;
        cur.set(x * 65536 + e, [x, e]); x = e;
      }
      for (const [k, v] of open) if (!cur.has(k)) rects.push([xs[v[0]], ys[v[2]], xs[v[1]], ys[y]]);
      const nopen = new Map();
      for (const [k, v] of cur) nopen.set(k, open.has(k) ? open.get(k) : [v[0], v[1], y]);
      open = nopen;
    }
    return rects;
  }
  /** Union of rectangles each grown by d (d >= 0): 2-D difference array on a compressed grid. */
  function grownCount(rects, d, extraX, extraY) {
    const X = extraX.slice(), Y = extraY.slice();
    for (const r of rects) { X.push(r[0] - d, r[2] + d); Y.push(r[1] - d, r[3] + d); }
    const xs = uniqSorted(X), ys = uniqSorted(Y), xi = indexMap(xs), yi = indexMap(ys);
    const nx = xs.length - 1, ny = ys.length - 1, W = nx + 1, D = new Int32Array(W * (ny + 1));
    for (const r of rects) {
      const i0 = xi.get(r[0] - d), i1 = xi.get(r[2] + d), j0 = yi.get(r[1] - d), j1 = yi.get(r[3] + d);
      D[j0 * W + i0]++; D[j0 * W + i1]--; D[j1 * W + i0]--; D[j1 * W + i1]++;
    }
    for (let j = 0; j <= ny; j++) for (let i = 1; i <= nx; i++) D[j * W + i] += D[j * W + i - 1];
    for (let j = 1; j <= ny; j++) for (let i = 0; i <= nx; i++) D[j * W + i] += D[(j - 1) * W + i];
    const cnt = new Int32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cnt[j * nx + i] = D[j * W + i];
    return { cnt, xs, ys, nx, ny };
  }
  G.offset = function (polys, delta, join) {
    if (join !== "miter" && join !== "square") throw new Error("SBGeom.offset: join '" + join + "' refused (only miter|square are deterministic)");
    if (!Number.isInteger(delta)) throw new Error("SBGeom.offset: delta must be integer µm");
    const rings = rolesRings(polys);
    if (!rings.length) return [];
    if (delta === 0) return G.union(polys, []);
    if (delta > 0) {
      const { xs, ys, xi, yi } = coords([rings]);
      const m = cellsOf(rings, xs, ys, xi, yi);
      const g = grownCount(rectsOf(m, xs.length - 1, ys.length - 1, xs, ys, 1), delta, [], []);
      const r = new Uint8Array(g.cnt.length); for (let i = 0; i < r.length; i++) r[i] = g.cnt[i] > 0 ? 1 : 0;
      return traceCells(r, g.nx, g.ny, g.xs, g.ys);
    }
    const e = -delta; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    const BX = [x0 - e, x1 + e], BY = [y0 - e, y1 + e];
    const { xs, ys, xi, yi } = coords([rings], BX, BY);
    const m = cellsOf(rings, xs, ys, xi, yi);
    const g = grownCount(rectsOf(m, xs.length - 1, ys.length - 1, xs, ys, 0), e, BX, BY);
    const r = new Uint8Array(g.cnt.length);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const inB = g.xs[i] >= BX[0] && g.xs[i + 1] <= BX[1] && g.ys[j] >= BY[0] && g.ys[j + 1] <= BY[1];
      r[j * g.nx + i] = inB && g.cnt[j * g.nx + i] === 0 ? 1 : 0;
    }
    return traceCells(r, g.nx, g.ny, g.xs, g.ys);
  };
  G.components = (polys) => G.union(polys, []).map((p) => [p]);

  for (const k of ["fromPixelLoops", "normalize", "validate", "area", "isEmpty", "containsPoint", "bbox", "circle"])
    G[k] = (...args) => K()[k](...args);
  G.backend = "lattice (in-house orthogonal)";

  global.SBGeom = G;
})(typeof window !== "undefined" ? window : globalThis);
