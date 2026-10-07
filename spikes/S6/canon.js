/* ============================================================================
 * Spike S6 — canonical normalization + canonicalBytes (decision D4)
 * ----------------------------------------------------------------------------
 * Reference implementation intended to be folded into js/geom.js by S1/G1
 * (SBGeom.normalize / SBGeom.canonicalBytes). Spike-only global: SBCanonS6.
 *
 * Conventions (plan §3):
 *   · coordinates are integer µm, Y-down;
 *   · outer rings have POSITIVE shoelace area, holes NEGATIVE;
 *   · each ring starts at its lexicographically smallest (x, y) vertex;
 *   · duplicate and collinear vertices (incl. 180° spikes) are removed;
 *   · rings that touch themselves at a vertex are split into simple rings
 *     (D3); pieces are re-classified outer/hole by containment depth;
 *   · polygons sorted by (bbox minY, bbox minX) then by full canonical
 *     coordinate sequence (total order); holes sorted the same way.
 *
 * Integer-only: + − × and comparisons. No Math.sin/cos/exp/log/pow/cbrt.
 * Coordinates must satisfy |v| ≤ 2^25 µm (33.5 m) so every cross product is
 * an exact double; out-of-range or non-integer input THROWS (never truncates).
 * ==========================================================================*/
(function (global) {
  "use strict";
  const LIM = 33554432; // 2^25
  const KOFF = 33554432, KMUL = 67108865; // vertex key = (x+2^25)*(2^26+1)+(y+2^25) < 2^53

  function checkCoord(v) {
    if (!Number.isInteger(v) || v > LIM || v < -LIM) throw new Error("canon: coordinate not an integer µm within ±2^25: " + v);
  }
  const key = (x, y) => (x + KOFF) * KMUL + (y + KOFF);

  /** Signed doubled shoelace area of a flat ring, exact (BigInt fallback). */
  function area2(r) {
    const n = r.length, x0 = r[0], y0 = r[1];
    let a = 0;
    for (let i = 2; i + 2 < n; i += 2) {
      a += (r[i] - x0) * (r[i + 3] - y0) - (r[i + 2] - x0) * (r[i + 1] - y0);
      if (!Number.isSafeInteger(a)) return area2Big(r);
    }
    return a;
  }
  function area2Big(r) {
    const n = r.length, x0 = BigInt(r[0]), y0 = BigInt(r[1]);
    let a = 0n;
    for (let i = 2; i + 2 < n; i += 2)
      a += (BigInt(r[i]) - x0) * (BigInt(r[i + 3]) - y0) - (BigInt(r[i + 2]) - x0) * (BigInt(r[i + 1]) - y0);
    return a > 0n ? 1 : a < 0n ? -1 : 0; // only the sign is used when this path triggers
  }

  /** Remove duplicate and collinear (incl. spike) vertices of a closed ring. Returns flat array or null. */
  function cleanRing(src) {
    if (src.length % 2) throw new Error("canon: odd coordinate count");
    const n = src.length >> 1;
    const xs = new Float64Array(n), ys = new Float64Array(n);
    for (let i = 0; i < n; i++) { checkCoord(src[2 * i]); checkCoord(src[2 * i + 1]); xs[i] = src[2 * i]; ys[i] = src[2 * i + 1]; }
    if (n < 3) return null;
    const prev = new Int32Array(n), next = new Int32Array(n), alive = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) { prev[i] = (i + n - 1) % n; next[i] = (i + 1) % n; }
    const stack = []; for (let i = n - 1; i >= 0; i--) stack.push(i);
    let count = n, any = 0;
    while (stack.length && count >= 3) {
      const i = stack.pop(); if (!alive[i]) continue;
      const p = prev[i], q = next[i];
      const cr = (xs[i] - xs[p]) * (ys[q] - ys[i]) - (ys[i] - ys[p]) * (xs[q] - xs[i]);
      if (cr === 0) { alive[i] = 0; next[p] = q; prev[q] = p; count--; any = i; stack.push(q, p); }
      else any = i;
    }
    if (count < 3) return null;
    let s = any; while (!alive[s]) s = next[s];
    const out = new Array(count * 2);
    for (let k = 0, i = s; k < count; k++, i = next[i]) { out[2 * k] = xs[i]; out[2 * k + 1] = ys[i]; }
    return area2(out) === 0 ? null : out;
  }

  /** Split a cleaned ring at repeated vertices into simple pieces (each cleaned again). */
  function splitRing(r) {
    const n = r.length >> 1;
    const seen = new Map(); let rep = false;
    for (let i = 0; i < n; i++) { const k = key(r[2 * i], r[2 * i + 1]); if (seen.has(k)) { rep = true; break; } seen.set(k, i); }
    if (!rep) return [r];
    const out = [], path = [], pos = new Map();
    for (let i = 0; i < n; i++) {
      const x = r[2 * i], y = r[2 * i + 1], k = key(x, y);
      if (pos.has(k)) {
        const j = pos.get(k);
        const piece = path.splice(j); // vertices j..end (j is the touch vertex)
        for (const v of piece) pos.delete(key(v[0], v[1]));
        out.push(piece.flat());
        path.push([x, y]); pos.set(k, path.length - 1);
      } else { path.push([x, y]); pos.set(k, path.length - 1); }
    }
    if (path.length) out.push(path.flat());
    const res = [];
    for (const p of out) { const c = p.length >= 6 ? cleanRing(p) : null; if (c) for (const s of splitRing(c)) res.push(s); }
    return res;
  }

  /** Point-in-ring with doubled-integer coords: 1 inside, 0 on boundary, -1 outside. */
  function pir2(px2, py2, r) {
    const n = r.length >> 1; let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = 2 * r[2 * i], yi = 2 * r[2 * i + 1], xj = 2 * r[2 * j], yj = 2 * r[2 * j + 1];
      const cr = (xj - xi) * (py2 - yi) - (yj - yi) * (px2 - xi);
      if (cr === 0 && Math.min(xi, xj) <= px2 && px2 <= Math.max(xi, xj) && Math.min(yi, yj) <= py2 && py2 <= Math.max(yi, yj)) return 0;
      if ((yi > py2) !== (yj > py2)) {
        // x of crossing > px2 ?  compare without division
        const lhs = (px2 - xi) * (yj - yi), rhs = (xj - xi) * (py2 - yi);
        if ((yj - yi) > 0 ? lhs < rhs : lhs > rhs) inside = !inside;
      }
    }
    return inside ? 1 : -1;
  }
  /** Is ring a strictly inside ring b (rings may touch at vertices)? */
  function ringInside(a, b) {
    const n = a.length >> 1;
    for (let i = 0; i < n; i++) { const s = pir2(2 * a[2 * i], 2 * a[2 * i + 1], b); if (s) return s > 0; }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; const s = pir2(a[2 * i] + a[2 * j], a[2 * i + 1] + a[2 * j + 1], b); if (s) return s > 0; }
    return false;
  }
  const bboxOf = (r) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) { const x = r[i], y = r[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };

  /** Orient (sign>0 → positive area) and rotate to start at the lexicographically smallest (x, y). */
  function canonRing(r, wantPositive) {
    const a = area2(r);
    let v = r;
    if ((a > 0) !== wantPositive) { v = new Array(r.length); const n = r.length >> 1; for (let i = 0; i < n; i++) { v[2 * i] = r[2 * (n - 1 - i)]; v[2 * i + 1] = r[2 * (n - 1 - i) + 1]; } }
    const n = v.length >> 1; let m = 0;
    for (let i = 1; i < n; i++) { const x = v[2 * i], y = v[2 * i + 1]; if (x < v[2 * m] || (x === v[2 * m] && y < v[2 * m + 1])) m = i; }
    if (m === 0) return v.slice();
    return v.slice(2 * m).concat(v.slice(0, 2 * m));
  }
  const cmpSeq = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };
  const cmpRing = (a, b) => { const A = bboxOf(a), B = bboxOf(b); return (A[1] - B[1]) || (A[0] - B[0]) || cmpSeq(a, b); };
  const cmpPoly = (p, q) => { let c = cmpRing(p.outer, q.outer); if (c) return c;
    const n = Math.min(p.holes.length, q.holes.length); for (let i = 0; i < n; i++) if ((c = cmpSeq(p.holes[i], q.holes[i]))) return c; return p.holes.length - q.holes.length; };

  /** Re-assemble ring pieces of ONE input polygon into PolygonWithHoles by containment depth. */
  function assemble(pieces) {
    const R = pieces.map((r) => ({ r, bb: bboxOf(r), abs: Math.abs(area2(r)), depth: 0, parent: -1 }));
    for (let i = 0; i < R.length; i++) {
      let best = -1;
      for (let j = 0; j < R.length; j++) {
        if (i === j) continue; const a = R[i].bb, b = R[j].bb;
        if (a[0] < b[0] || a[1] < b[1] || a[2] > b[2] || a[3] > b[3] || R[j].abs <= R[i].abs) continue;
        if (ringInside(R[i].r, R[j].r)) { R[i].depth++; if (best < 0 || R[j].abs < R[best].abs) best = j; }
      }
      R[i].parent = best;
    }
    const polys = new Map();
    R.forEach((e, i) => { if (e.depth % 2 === 0) polys.set(i, { outer: canonRing(e.r, true), holes: [] }); });
    R.forEach((e) => { if (e.depth % 2 === 1 && polys.has(e.parent)) polys.get(e.parent).holes.push(canonRing(e.r, false)); });
    return [...polys.values()];
  }

  /**
   * Insert every vertex that lies strictly inside an edge (of any ring of the same polygon, incl. its own
   * ring) into that edge, so vertex-on-edge ("T") contacts become shared vertices that faceTrace can
   * separate. Uniform-grid bucketing keeps it ~linear. Exact integer tests only.
   */
  function splitTJunctions(rings) {
    let V = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) { V += r.length >> 1; const b = bboxOf(r); if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3]; }
    let G = 1; while (G < 1024 && (G + 1) * (G + 1) <= V) G++; // G×G grid, G = min(1024, isqrt(V))
    const cw = Math.floor((x1 - x0) / G) + 1, ch = Math.floor((y1 - y0) / G) + 1;
    const cx = (x) => Math.floor((x - x0) / cw), cy = (y) => Math.floor((y - y0) / ch); // division only bins; never reaches output
    const cells = new Map();
    rings.forEach((r, ri) => { const n = r.length >> 1;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; const ax = r[2 * i], ay = r[2 * i + 1], bx = r[2 * j], by = r[2 * j + 1];
        for (let gy = cy(Math.min(ay, by)); gy <= cy(Math.max(ay, by)); gy++) for (let gx = cx(Math.min(ax, bx)); gx <= cx(Math.max(ax, bx)); gx++) {
          const k = gy * G + gx; const L = cells.get(k); if (L) L.push(ri, i); else cells.set(k, [ri, i]); } } });
    const ins = rings.map(() => new Map()); let any = false;
    rings.forEach((r) => { const n = r.length >> 1;
      for (let v = 0; v < n; v++) { const px = r[2 * v], py = r[2 * v + 1]; const L = cells.get(cy(py) * G + cx(px)); if (!L) continue;
        for (let t = 0; t < L.length; t += 2) { const er = rings[L[t]], i = L[t + 1], m = er.length >> 1, j = (i + 1) % m;
          const ax = er[2 * i], ay = er[2 * i + 1], bx = er[2 * j], by = er[2 * j + 1];
          if ((px === ax && py === ay) || (px === bx && py === by)) continue;
          if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) !== 0) continue;
          if (px < Math.min(ax, bx) || px > Math.max(ax, bx) || py < Math.min(ay, by) || py > Math.max(ay, by)) continue;
          const M = ins[L[t]]; const arr = M.get(i); const d = (bx - ax) * (px - ax) + (by - ay) * (py - ay);
          if (arr) { if (!arr.some((q) => q[0] === px && q[1] === py)) arr.push([px, py, d]); } else M.set(i, [[px, py, d]]); any = true; } } });
    if (!any) return rings;
    return rings.map((r, ri) => { const M = ins[ri]; if (!M.size) return r; const n = r.length >> 1, out = [];
      for (let i = 0; i < n; i++) { out.push(r[2 * i], r[2 * i + 1]); const a = M.get(i); if (a) { a.sort((p, q) => p[2] - q[2]); for (const q of a) out.push(q[0], q[1]); } }
      return out; });
  }

  /**
   * normalize(polys) → PolygonWithHoles[] in canonical form. Input must already be
   * boolean-resolved (e.g. union(polys, [])): normalize does NOT merge overlapping or
   * edge-sharing parts; it canonicalizes representation only.
   */
  /** Orient a cleaned ring so its signed area has the wanted sign (no rotation). */
  function orient(r, wantPositive) {
    if ((area2(r) > 0) === wantPositive) return r;
    const n = r.length >> 1, v = new Array(r.length);
    for (let i = 0; i < n; i++) { v[2 * i] = r[2 * (n - 1 - i)]; v[2 * i + 1] = r[2 * (n - 1 - i) + 1]; }
    return v;
  }
  // Turn class of d_out relative to d_in: 2 = left (cross>0) or U-turn, 1 = straight, 0 = right.
  const turnClass = (ix, iy, ox, oy) => { const c = ix * oy - iy * ox; return c > 0 ? 2 : c < 0 ? 0 : (ix * ox + iy * oy > 0 ? 1 : 2); };
  /**
   * Face-trace the directed edges of all rings of ONE polygon (material on the cross>0 side of every
   * edge). At a vertex shared by several edges, leave by the left-most turn, i.e. hug the material:
   * vertex-touching lobes, holes that touch the outer, and holes that touch each other all come out as
   * separate simple rings (D3: point contact never connects material). Exact integer comparisons only.
   */
  function faceTrace(rings) {
    const X = [], Y = [], outs = new Map(); // edge e: from (X[e],Y[e]) to next vertex; outs: key → [edge]
    const NX = [], NY = [];
    for (const r of rings) {
      const n = r.length >> 1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, e = X.length;
        X.push(r[2 * i]); Y.push(r[2 * i + 1]); NX.push(r[2 * j]); NY.push(r[2 * j + 1]);
        const k = key(r[2 * i], r[2 * i + 1]); const L = outs.get(k); if (L) L.push(e); else outs.set(k, [e]);
      }
    }
    // The pairing incoming→outgoing is fixed (left-most among ALL outgoing edges at the vertex), so the
    // traversal is a permutation of edges and every ring closes on its start edge.
    const nextOf = new Int32Array(X.length);
    for (let e = 0; e < X.length; e++) {
      const cand = outs.get(key(NX[e], NY[e])), ix = NX[e] - X[e], iy = NY[e] - Y[e];
      let best = -1, bc = -1, bx = 0, by = 0;
      for (const f of cand) {
        const ox = NX[f] - X[f], oy = NY[f] - Y[f], c = turnClass(ix, iy, ox, oy);
        if (best < 0 || c > bc || (c === bc && bx * oy - by * ox > 0)) { best = f; bc = c; bx = ox; by = oy; }
      }
      nextOf[e] = best;
    }
    const used = new Uint8Array(X.length), res = [];
    for (let s = 0; s < X.length; s++) {
      if (used[s]) continue;
      const ring = []; let e = s;
      do {
        if (used[e]) throw new Error("canon: faceTrace pairing is not a permutation (malformed boundary)");
        used[e] = 1; ring.push(X[e], Y[e]); e = nextOf[e];
      } while (e !== s);
      if (ring.length >= 6) res.push(ring);
    }
    return res;
  }

  /**
   * normalize(polys) → PolygonWithHoles[] in canonical form. Input must already be
   * boolean-resolved (e.g. union(polys, [])): normalize does NOT merge overlapping or
   * edge-sharing parts; it canonicalizes representation only.
   */
  function normalize(polys) {
    const out = [];
    for (const p of polys) {
      const o = cleanRing(p.outer); if (!o) continue;
      // NonZero semantics: a ring's role is its orientation RELATIVE to the outer. Flipping every ring of
      // the polygon (global winding reversal) is a no-op; a "hole" wound like the outer is material.
      const flip = area2(o) < 0, rings = [flip ? orient(o, true) : o];
      for (const h of p.holes || []) { const c = cleanRing(h); if (c) rings.push(flip ? orient(c, area2(c) < 0) : c); }
      const tj = splitTJunctions(rings); const tAny = tj !== rings; if (tAny) rings.splice(0, rings.length, ...tj);
      // fast path: no vertex shared by two edges anywhere in this polygon
      const seen = new Set(); let touch = false;
      outer: for (const r of rings) for (let i = 0; i < r.length; i += 2) { const k = key(r[i], r[i + 1]); if (seen.has(k)) { touch = true; break outer; } seen.add(k); }
      if (!touch && !tAny && rings.every((r, i) => i === 0 || area2(r) < 0)) { out.push({ outer: canonRing(rings[0], true), holes: rings.slice(1).map((h) => canonRing(h, false)) }); continue; }
      const pieces = [];
      for (const r of faceTrace(rings)) { const c = cleanRing(r); if (c) for (const q of splitRing(c)) pieces.push(q); }
      const outers = [], holes = [];
      for (const r of pieces) (area2(r) > 0 ? outers : holes).push(r);
      const P = outers.map((r) => ({ r, bb: bboxOf(r), abs: Math.abs(area2(r)), poly: { outer: canonRing(r, true), holes: [] } }));
      for (const h of holes) {
        const hb = bboxOf(h), ha = Math.abs(area2(h)); let best = null;
        for (const q of P) { const b = q.bb; if (hb[0] < b[0] || hb[1] < b[1] || hb[2] > b[2] || hb[3] > b[3] || q.abs <= ha) continue;
          if ((!best || q.abs < best.abs) && ringInside(h, q.r)) best = q; }
        if (!best) throw new Error("canon: hole without containing outer (input not boolean-resolved)");
        best.poly.holes.push(canonRing(h, false));
      }
      for (const q of P) out.push(q.poly);
    }
    for (const p of out) p.holes.sort(cmpRing);
    out.sort(cmpPoly);
    return out;
  }

  /** Canonical score polyline: dedupe, drop pass-through collinear points, fixed direction. */
  function canonPolyline(src) {
    const pts = [];
    for (let i = 0; i < src.length; i += 2) { checkCoord(src[i]); checkCoord(src[i + 1]);
      const n = pts.length; if (n && pts[n - 2] === src[i] && pts[n - 1] === src[i + 1]) continue; pts.push(src[i], src[i + 1]); }
    const n = pts.length >> 1;
    if (n < 2) return null;
    const closed = n > 2 && pts[0] === pts[2 * n - 2] && pts[1] === pts[2 * n - 1];
    if (closed) {
      const c = cleanRing(pts.slice(0, -2)); if (!c) return null;
      const r = canonRing(c, true); return r.concat([r[0], r[1]]);
    }
    const keep = [pts[0], pts[1]];
    for (let i = 1; i < n - 1; i++) {
      const ax = keep[keep.length - 2], ay = keep[keep.length - 1], bx = pts[2 * i], by = pts[2 * i + 1], cx = pts[2 * i + 2], cy = pts[2 * i + 3];
      const cr = (bx - ax) * (cy - by) - (by - ay) * (cx - bx), dot = (bx - ax) * (cx - bx) + (by - ay) * (cy - by);
      if (cr === 0 && dot > 0) continue; keep.push(bx, by);
    }
    keep.push(pts[2 * n - 2], pts[2 * n - 1]);
    const m = keep.length >> 1;
    const rev = keep[2 * m - 2] < keep[0] || (keep[2 * m - 2] === keep[0] && keep[2 * m - 1] < keep[1]);
    if (!rev) return keep;
    const r = new Array(keep.length); for (let i = 0; i < m; i++) { r[2 * i] = keep[2 * (m - 1 - i)]; r[2 * i + 1] = keep[2 * (m - 1 - i) + 1]; }
    return r;
  }

  /**
   * canonicalBytes(layers) → Uint8Array (little-endian int32 stream):
   *   [layerCount, (index, partCount, (ringCount, (vertexCount, x, y …)…)…,
   *                 scoreCount, (vertexCount, x, y …)…,
   *                 holeCount, (cx, cy, r)…)…]          ← holeCount section: D4 amendment
   * Layers are emitted in ascending index order (input order is irrelevant).
   */
  function canonicalBytes(layers, opts) {
    const withHoles = !opts || opts.holes !== false;
    const words = [];
    const ls = layers.slice().sort((a, b) => a.index - b.index);
    words.push(ls.length);
    for (const L of ls) {
      checkCoord(L.index); words.push(L.index);
      const polys = normalize(L.material || []);
      words.push(polys.length);
      for (const p of polys) {
        words.push(1 + p.holes.length);
        for (const r of [p.outer].concat(p.holes)) { words.push(r.length >> 1); for (const v of r) words.push(v); }
      }
      const sc = (L.scorePaths || []).map(canonPolyline).filter(Boolean).sort(cmpSeq);
      words.push(sc.length);
      for (const s of sc) { words.push(s.length >> 1); for (const v of s) words.push(v); }
      if (withHoles) {
        const hs = (L.holes || []).map((h) => { checkCoord(h.cxUm); checkCoord(h.cyUm); checkCoord(h.rUm); return [h.cyUm, h.cxUm, h.rUm]; }).sort(cmpSeq);
        words.push(hs.length);
        for (const h of hs) words.push(h[1], h[0], h[2]);
      }
    }
    const buf = new Uint8Array(words.length * 4), dv = new DataView(buf.buffer);
    for (let i = 0; i < words.length; i++) dv.setInt32(4 * i, words[i], true);
    return buf;
  }

  /** Assemble an unstructured ring soup (e.g. Clipper flat output) into canonical polygons by depth parity. */
  function assembleRings(rings) {
    const pieces = [];
    for (const r of rings) { const c = cleanRing(r); if (c) for (const s of splitRing(c)) pieces.push(s); }
    return normalize(assemble(pieces));
  }

  const layerHash = (L) => global.SBHash.sha256(canonicalBytes([L]));

  global.SBCanonS6 = { normalize, canonicalBytes, layerHash, assembleRings, faceTrace, splitTJunctions, cleanRing, splitRing, canonRing, canonPolyline, area2, LIM };
})(typeof window !== "undefined" ? window : globalThis);
