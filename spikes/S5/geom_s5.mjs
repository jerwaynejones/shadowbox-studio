// spikes/S5/geom_s5.mjs — spike-local SBGeom subset over Clipper2 (clipper2-ts 2.0.1-18).
// NOT the production adapter (that is S1's js/geom.js). It implements only what S5 needs, with the §3 contracts:
// integer µm, Y-down, outer ring positive shoelace / holes negative, NonZero booleans, start at the lexicographically
// smallest (x, y), collinear vertices removed, parts sorted by (minY, minX).
//
// D3 (rework, see docs/spikes/S5.md F1): every boolean result is normalized by
//   node (insert T-contact points) → RE-PAIR edges at every shared vertex with the material-separating turn (global,
//   across all output rings) → split remaining repeated vertices → drop collinear → nest holes.
// Clipper2's own ring pairing at touching vertices is NOT used: it is arbitrary (mixed per vertex), and splitting a
// ring at a repeated vertex FLIPS the pairing at that vertex, so "split at repeats" alone is order-dependent.
import * as C from "./vendor/clipper2.min.mjs";

const NZ = C.FillRule.NonZero;
export const Clipper = C;

// ---------------------------------------------------------------- conversions
const toPath = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push({ x: flat[i], y: flat[i + 1] }); return p; };
const toFlat = (path) => { const f = []; for (const q of path) f.push(q.x, q.y); return f; };
const polysToPaths = (polys) => { const out = []; for (const p of polys) { if (p.outer.length) out.push(toPath(p.outer)); for (const h of p.holes) out.push(toPath(h)); } return out; };
const pathsOf = (polys) => polysToPaths(polys).filter((p) => p.length >= 3);

export function shoe(r) { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; }

/** Pixel loops (SBTrace output, [[x,y],...]) → unresolved rings (union(…, []) resolves them). Rounds x*sx+ox; REVERSES
 *  the traced ring order so outers are positive and holes negative (NonZero-safe). */
export function fromPixelLoops(loops, sx, sy, ox, oy) {
  const outers = [], holes = [];
  for (const L of loops) {
    const f = [];
    for (let i = L.length - 1; i >= 0; i--) f.push(Math.round(L[i][0] * sx + ox), Math.round(L[i][1] * sy + oy));
    (shoe(f) > 0 ? outers : holes).push(f);
  }
  const res = outers.map((o) => ({ outer: o, holes: [] }));
  if (holes.length) res.push({ outer: [], holes });
  return res;
}

function boolTree(ct, a, b) {
  const t = new C.PolyTree64(); C.booleanOpWithPolyTree(ct, pathsOf(a), pathsOf(b), t, NZ);
  const rings = []; const walk = (n) => { for (let i = 0; i < n.count; i++) { const c = n.child(i); rings.push(toFlat(c.poly)); walk(c); } }; walk(t);
  return normalizeRings(rings);
}
export const union = (a, b) => boolTree(C.ClipType.Union, a, b);
export const difference = (a, b) => boolTree(C.ClipType.Difference, a, b);
export const intersection = (a, b) => boolTree(C.ClipType.Intersection, a, b);
export const unionRaw = (a, b) => C.union(pathsOf(a), pathsOf(b), NZ); // raw Clipper output, for characterization

/** Integer-delta offset only. Clipper2 Paths64 offsets snap every offset vertex with Math.round (ties toward +∞):
 *  |delta| < 0.5 returns the input unchanged, and |delta| = k + 0.5 lands every axis-parallel edge on a rounding tie
 *  (delta = −0.5 gives [], a wrong partial polygon, or a correct 1 µm shrink depending on ring orientation and shape —
 *  see docs/spikes/S5.md F4). Sub-µm insets go through survivesInset(), never through offset(). */
export function offset(polys, delta, join) {
  if (join === "round") throw new Error("GEO_ROUND_JOIN_REFUSED");
  if (!Number.isInteger(delta)) throw new Error("GEO_OFFSET_NONINTEGER");
  const jt = join === "square" ? C.JoinType.Square : C.JoinType.Miter;
  return normalizeRings(C.inflatePaths(pathsOf(polys), delta, jt, C.EndType.Polygon, 2.0).map(toFlat));
}
export const area = (polys) => polys.reduce((s, p) => s + shoe(p.outer) + p.holes.reduce((t, h) => t + shoe(h), 0), 0);
export const isEmpty = (polys) => polys.length === 0 || area(polys) === 0;
export const bbox = (r) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return [x0, y0, x1, y1]; };

// ---------------------------------------------------------------- normalization helpers
function dropCollinear(f) {
  let r = f, changed = true;
  while (changed && r.length >= 6) {
    changed = false; const n = r.length / 2, o = [];
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n;
      const ax = r[2 * p], ay = r[2 * p + 1], bx = r[2 * i], by = r[2 * i + 1], cx = r[2 * q], cy = r[2 * q + 1];
      if ((ax === bx && ay === by) || (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) === 0) { changed = true; continue; }
      o.push(bx, by);
    }
    r = o;
  }
  return r;
}
/** Split a ring at repeated vertices into sub-rings. NOTE: this swaps the in/out pairing at the split vertex — it is
 *  only correct AFTER rechain() has fixed the pairing (then both wedges at the vertex belong to the same part). */
export function splitAtRepeats(f) {
  const out = [], stack = [f];
  while (stack.length) {
    const r = stack.pop(), n = r.length / 2, seen = new Map(); let split = false;
    for (let i = 0; i < n; i++) {
      const k = r[2 * i] + "," + r[2 * i + 1];
      if (seen.has(k)) { const j = seen.get(k); stack.push(r.slice(2 * j, 2 * i), r.slice(2 * i).concat(r.slice(0, 2 * j))); split = true; break; }
      seen.set(k, i);
    }
    if (!split) out.push(r);
  }
  return out;
}
function rotateToMin(f) {
  let best = 0; const n = f.length / 2;
  for (let i = 1; i < n; i++) if (f[2 * i] < f[2 * best] || (f[2 * i] === f[2 * best] && f[2 * i + 1] < f[2 * best + 1])) best = i;
  return f.slice(2 * best).concat(f.slice(0, 2 * best));
}
// point-in-ring with doubled integer coordinates (exact for |coords| < 2^25); 1 inside, 0 outside, -1 on boundary.
function pip2(r, px, py) {
  let inside = false; const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = 2 * r[2 * i], yi = 2 * r[2 * i + 1], xj = 2 * r[2 * j], yj = 2 * r[2 * j + 1];
    const cr = (xj - xi) * (py - yi) - (yj - yi) * (px - xi);
    if (cr === 0 && Math.min(xi, xj) <= px && px <= Math.max(xi, xj) && Math.min(yi, yj) <= py && py <= Math.max(yi, yj)) return -1;
    if ((yi > py) !== (yj > py)) { // exact: compare px against the crossing without division
      const s = (px - xi) * (yj - yi) - (xj - xi) * (py - yi); if ((yj - yi > 0 ? s < 0 : s > 0)) inside = !inside; }
  }
  return inside ? 1 : 0;
}
function interiorSample(hole, outer) { // classify an edge midpoint of `hole` against `outer` (first decisive one)
  const n = hole.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n;
    const r = pip2(outer, hole[2 * i] + hole[2 * j], hole[2 * i + 1] + hole[2 * j + 1]); if (r >= 0) return r; }
  return 0;
}

/** Noding: insert every ring vertex that lies strictly inside another edge (T-contact) into that edge, so all contacts
 *  between rings are shared vertices. Exact integer collinearity. Axis-parallel edges use sorted indexes. */
export function nodeRings(flats) {
  const pts = new Map(); for (const f of flats) for (let i = 0; i < f.length; i += 2) pts.set(f[i] + "," + f[i + 1], [f[i], f[i + 1]]);
  const P = [...pts.values()];
  const byX = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]), byY = [...P].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const lb = (arr, k0, k1, a, b) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; const q = arr[m]; if (q[k0] < a || (q[k0] === a && q[k1] < b)) lo = m + 1; else hi = m; } return lo; };
  let inserted = 0;
  const out = flats.map((f) => {
    const n = f.length / 2, o = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = f[2 * i], y0 = f[2 * i + 1], x1 = f[2 * j], y1 = f[2 * j + 1];
      o.push(x0, y0);
      let mid = [];
      if (x0 === x1) { const a = Math.min(y0, y1), b = Math.max(y0, y1); for (let k = lb(byX, 0, 1, x0, a + 1); k < byX.length && byX[k][0] === x0 && byX[k][1] < b; k++) mid.push(byX[k]); }
      else if (y0 === y1) { const a = Math.min(x0, x1), b = Math.max(x0, x1); for (let k = lb(byY, 1, 0, y0, a + 1); k < byY.length && byY[k][1] === y0 && byY[k][0] < b; k++) mid.push(byY[k]); }
      else { const a = Math.min(x0, x1), b = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
        for (let k = lb(byX, 0, 1, a + 1, -Infinity); k < byX.length && byX[k][0] < b; k++) { const q = byX[k];
          if (q[1] > ya && q[1] < yb && (x1 - x0) * (q[1] - y0) - (y1 - y0) * (q[0] - x0) === 0) mid.push(q); } }
      if (mid.length) { const dx = x1 - x0, dy = y1 - y0; mid.sort((p, q) => ((p[0] - x0) * dx + (p[1] - y0) * dy) - ((q[0] - x0) * dx + (q[1] - y0) * dy));
        for (const q of mid) o.push(q[0], q[1]); inserted += mid.length; }
    }
    return o;
  });
  return { rings: out, inserted };
}

// Exact angular comparator, no trig (NFR-05). half(): 0 for directions in [0°, 180°) measured from +x towards +y.
const halfOf = (x, y) => (y > 0 || (y === 0 && x > 0) ? 0 : 1);
const angLess = (ax, ay, bx, by) => { const ha = halfOf(ax, ay), hb = halfOf(bx, by); if (ha !== hb) return ha < hb; return ax * by - ay * bx > 0; };
const half = (ux, uy, vx, vy) => { const c = ux * vy - uy * vx; return c > 0 || (c === 0 && ux * vx + uy * vy < 0) ? 1 : 0; };
/** Is turn (u→a) more to the right than (u→b)? Right turn = cross(u, v) > 0 in Y-down. Exact. */
const moreRight = (ux, uy, ax, ay, bx, by) => { const ha = half(ux, uy, ax, ay), hb = half(ux, uy, bx, by); if (ha !== hb) return ha > hb; return bx * ay - by * ax > 0; };

export const D3 = { mode: "rechain", stats: { rechainCalls: 0, sharedVertices: 0, degreeMismatch: 0, badClose: 0, splitPositiveRing: 0, splitTwoPositive: 0, splitNegativeGotPositive: 0, nodedPoints: 0 } };
export const resetStats = () => { for (const k of Object.keys(D3.stats)) D3.stats[k] = 0; };

/** Re-pair all directed edges of a ring set. At each vertex with in-degree ≥ 2, an incoming edge continues with the
 *  outgoing edge of the SAME material wedge, i.e. the right-most turn (material is on the right of travel for outer-
 *  positive winding in Y-down). Rings that share no vertex are returned unchanged. */
export function rechain(flats) {
  const out = new Map(); const indeg = new Map();
  for (const f of flats) { const n = f.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; const k = f[2 * i] + "," + f[2 * i + 1], kj = f[2 * j] + "," + f[2 * j + 1];
    if (!out.has(k)) out.set(k, []); out.get(k).push({ x0: f[2 * i], y0: f[2 * i + 1], x1: f[2 * j], y1: f[2 * j + 1], used: false }); indeg.set(kj, (indeg.get(kj) || 0) + 1); } }
  let shared = 0; for (const [k, l] of out) { if (l.length > 1) shared++; if (l.length !== indeg.get(k)) D3.stats.degreeMismatch++; }
  D3.stats.rechainCalls++; D3.stats.sharedVertices += shared;
  if (!shared) return flats;
  const rings = [];
  for (const list of out.values()) for (const e0 of list) {
    if (e0.used) continue; const r = []; let e = e0;
    while (e && !e.used) { e.used = true; r.push(e.x0, e.y0);
      const cand = out.get(e.x1 + "," + e.y1); if (!cand || !cand.length) { e = null; break; }
      const ux = e.x1 - e.x0, uy = e.y1 - e.y0; let best = null;
      for (const c of cand) if (!c.used || c === e0) { if (!best || moreRight(ux, uy, c.x1 - c.x0, c.y1 - c.y0, best.x1 - best.x0, best.y1 - best.y0)) best = c; }
      // the right-most candidate overall must be the free one; if the right-most is already used the pairing is not a bijection
      let rm = cand[0]; for (const c of cand) if (moreRight(ux, uy, c.x1 - c.x0, c.y1 - c.y0, rm.x1 - rm.x0, rm.y1 - rm.y0)) rm = c;
      if (rm !== best) D3.stats.badClose++;
      e = best; }
    if (e !== e0) D3.stats.badClose++;
    rings.push(r);
  }
  return rings;
}

/** Spatial index of outer rings (uniform grid over bboxes) for hole nesting. */
function nestHoles(outers, holes) {
  if (!holes.length) return;
  if (outers.length === 1) { for (const h of holes) outers[0].holes.push(h); return; }
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (const o of outers) { const b = o.bb; X0 = Math.min(X0, b[0]); Y0 = Math.min(Y0, b[1]); X1 = Math.max(X1, b[2]); Y1 = Math.max(Y1, b[3]); }
  const G = 64, cw = Math.max(1, (X1 - X0 + 1) / G), ch = Math.max(1, (Y1 - Y0 + 1) / G), cells = new Map();
  for (const o of outers) { const b = o.bb; for (let gx = Math.floor((b[0] - X0) / cw); gx <= Math.floor((b[2] - X0) / cw); gx++) for (let gy = Math.floor((b[1] - Y0) / ch); gy <= Math.floor((b[3] - Y0) / ch); gy++) {
    const k = gx * 4096 + gy; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(o); } }
  for (const c of cells.values()) c.sort((p, q) => p.a - q.a); // smallest containing outer wins
  for (const h of holes) {
    const hb = bbox(h), k = Math.floor((hb[0] - X0) / cw) * 4096 + Math.floor((hb[1] - Y0) / ch);
    let host = null;
    for (const o of cells.get(k) || []) { const b = o.bb; if (hb[0] < b[0] || hb[1] < b[1] || hb[2] > b[2] || hb[3] > b[3]) continue; if (interiorSample(h, o.outer) === 1) { host = o; break; } }
    if (host) host.holes.push(h); else outers.push({ outer: h.slice(), holes: [], a: 0, bb: hb, orphan: true });
  }
}

/** Any ring set that is the boundary of a valid 0/1-winding region (a boolean result) → normalized PolygonWithHoles[]. */
export function normalizeRings(input) {
  let flats = input.map(dropCollinear).filter((f) => f.length >= 6 && shoe(f) !== 0);
  const pieces = [];
  if (D3.mode === "rechain") {
    const nd = D3.noding === false ? { rings: flats, inserted: 0 } : nodeRings(flats); D3.stats.nodedPoints += nd.inserted;
    flats = rechain(nd.rings);
    for (const f of flats) { const parts = splitAtRepeats(f); const sgn = shoe(f);
      if (parts.length > 1) { const pos = parts.filter((q) => shoe(q) > 0).length;
        if (sgn > 0) { D3.stats.splitPositiveRing++; if (pos > 1) D3.stats.splitTwoPositive++; } else if (pos > 0) D3.stats.splitNegativeGotPositive++; }
      for (const s of parts) pieces.push(s); }
  } else { // "split": the plan's original rule — split each ring at repeated vertices, keep Clipper2's pairing
    for (const f of flats) for (const s of splitAtRepeats(f)) pieces.push(s);
  }
  const rings = []; for (const s of pieces) { const c = dropCollinear(s); if (c.length >= 6 && shoe(c) !== 0) rings.push(c); }
  const outers = rings.filter((r) => shoe(r) > 0).map((o) => ({ outer: o, holes: [], a: shoe(o), bb: bbox(o) }));
  nestHoles(outers, rings.filter((r) => shoe(r) < 0));
  const res = outers.map(({ outer, holes, orphan }) => ({ outer, holes, ...(orphan ? { orphan: true } : {}) }));
  for (const p of res) { p.outer = rotateToMin(p.outer); p.holes = p.holes.map(rotateToMin); p.holes.sort(cmpMin); }
  res.sort(cmpPoly);
  return res;
}
/** Kept for API compatibility: polys → all rings → normalizeRings. Input must be a non-overlapping polygon set. */
export function fromPaths(paths) { return normalizeRings(paths.map(toFlat)); }
export function normalize(polys) {
  const rings = []; for (const p of polys) { if (p.outer.length) rings.push(p.outer); for (const h of p.holes) rings.push(h); }
  return normalizeRings(rings);
}
const cmpMin = (a, b) => { const A = bbox(a), B = bbox(b); return A[1] - B[1] || A[0] - B[0]; };
const cmpPoly = (p, q) => cmpMin(p.outer, q.outer);

// ---------------------------------------------------------------- queries
/** Exact interior-connectivity test for ONE polygon with simple rings that meet only at points: the interior is
 *  connected iff the bipartite ring–contact-point graph is a forest (Alexander duality: #interior components =
 *  1 + cycle rank). Contacts include T-contacts (found by noding). */
export function interiorConnected(poly) {
  const rings = [poly.outer, ...poly.holes]; if (rings.length === 1) return true;
  const { rings: nr } = nodeRings(rings);
  const at = new Map(); nr.forEach((r, ri) => { for (let i = 0; i < r.length; i += 2) { const k = r[i] + "," + r[i + 1]; if (!at.has(k)) at.set(k, new Set()); at.get(k).add(ri); } });
  const parent = rings.map((_, i) => i); const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const s of at.values()) { if (s.size < 2) continue; const [first, ...rest] = [...s];
    for (const r of rest) { const a = find(first), b = find(r); if (a === b) return false; parent[b] = a; } }
  return true;
}
/** One group per polygon. Normalization guarantees each polygon is ONE part; this asserts it exactly
 *  (interiorConnected) and merges polygons only if they share a positive-length edge (never after a union). */
export function components(polys) {
  for (const p of polys) if (!interiorConnected(p)) throw new Error("GEO_MULTIPART_POLYGON");
  const parent = polys.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const edgeKey = (ax, ay, bx, by) => (ax < bx || (ax === bx && ay < by) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`);
  const owner = new Map();
  polys.forEach((p, i) => { for (const r of [p.outer, ...p.holes]) { const n = r.length / 2;
    for (let k = 0; k < n; k++) { const j = (k + 1) % n, key = edgeKey(r[2 * k], r[2 * k + 1], r[2 * j], r[2 * j + 1]);
      if (owner.has(key) && find(owner.get(key)) !== find(i)) parent[find(i)] = find(owner.get(key)); else owner.set(key, i); } } });
  const g = new Map(); polys.forEach((p, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r).push(p); });
  return [...g.values()];
}

// ---------------------------------------------------------------- validation
const orient = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
const onSeg = (px, py, qx, qy, rx, ry) => Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy);
/** Ring-level validation: GEO_OPEN, GEO_ZERO_AREA, GEO_DUPLICATE (repeated vertex), GEO_ORPHAN_HOLE, GEO_SELF_INTERSECT
 *  (proper crossing, collinear overlap, or two rings crossing at a shared point), GEO_SELF_TOUCH (a ring touches its
 *  own non-adjacent edge), GEO_MULTIPART (interior disconnected). Point contact between DIFFERENT rings of one polygon
 *  (vertex–vertex or vertex–edge) that does not cross is reported in `touches` (info). */
export function validate(polys) {
  const errors = [], touches = [];
  polys.forEach((p, pi) => {
    if (p.orphan) errors.push({ code: "GEO_ORPHAN_HOLE", ring: [pi, 0] });
    const rings = [p.outer, ...p.holes];
    let ringErr = false;
    rings.forEach((r, ri) => {
      if (r.length < 6) { ringErr = true; return errors.push({ code: "GEO_OPEN", ring: [pi, ri] }); }
      if (shoe(r) === 0) errors.push({ code: "GEO_ZERO_AREA", ring: [pi, ri] });
      const seen = new Set(); for (let i = 0; i < r.length; i += 2) { const k = r[i] + "," + r[i + 1]; if (seen.has(k)) { ringErr = true; errors.push({ code: "GEO_DUPLICATE", ring: [pi, ri] }); break; } seen.add(k); }
      if (ri === 0 ? shoe(r) < 0 : shoe(r) > 0) errors.push({ code: "GEO_WINDING", ring: [pi, ri] });
    });
    const E = []; rings.forEach((r, ri) => { const n = r.length / 2; for (let k = 0; k < n; k++) { const j = (k + 1) % n; E.push([ri, k, j, n, r[2 * k], r[2 * k + 1], r[2 * j], r[2 * j + 1]]); } });
    const dirs = new Map(); // "x,y|ring" -> [[dx,dy],...] directions of that ring's edges leaving the contact point
    const addDir = (key, dx, dy) => { if (!dirs.has(key)) dirs.set(key, []); const l = dirs.get(key); if (!l.some((d) => d[0] === dx && d[1] === dy)) l.push([dx, dy]); };
    const contacts = new Map(); // "x,y|a|b" -> [x,y,a,b]
    const edgeDirsAt = (e, x, y, ring) => { const key = x + "," + y + "|" + ring;
      if (e[4] === x && e[5] === y) addDir(key, e[6] - x, e[7] - y); else if (e[6] === x && e[7] === y) addDir(key, e[4] - x, e[5] - y);
      else { addDir(key, e[6] - x, e[7] - y); addDir(key, e[4] - x, e[5] - y); } };
    function testPair(e, f) {
      if (e[0] === f[0] && (e[2] === f[1] || f[2] === e[1])) return; // adjacent in the same ring
      const o1 = orient(e[4], e[5], e[6], e[7], f[4], f[5]), o2 = orient(e[4], e[5], e[6], e[7], f[6], f[7]);
      const o3 = orient(f[4], f[5], f[6], f[7], e[4], e[5]), o4 = orient(f[4], f[5], f[6], f[7], e[6], e[7]);
      const hit = (o1 !== o2 && o3 !== o4) || (o1 === 0 && onSeg(e[4], e[5], e[6], e[7], f[4], f[5])) || (o2 === 0 && onSeg(e[4], e[5], e[6], e[7], f[6], f[7]))
        || (o3 === 0 && onSeg(f[4], f[5], f[6], f[7], e[4], e[5])) || (o4 === 0 && onSeg(f[4], f[5], f[6], f[7], e[6], e[7]));
      if (!hit) return;
      if (o1 === 0 && o2 === 0) { // collinear: overlap of positive length is always an error
        const ax = e[6] - e[4], ay = e[7] - e[5], t = (x, y) => (x - e[4]) * ax + (y - e[5]) * ay, L = ax * ax + ay * ay;
        const lo = Math.max(0, Math.min(t(f[4], f[5]), t(f[6], f[7]))), hi = Math.min(L, Math.max(t(f[4], f[5]), t(f[6], f[7])));
        if (hi > lo) return errors.push({ code: "GEO_SELF_INTERSECT", ring: [pi, e[0], f[0]], kind: "overlap" }); }
      // single intersection point: find it among the four endpoints
      let P = null;
      for (const [x, y] of [[f[4], f[5]], [f[6], f[7]]]) if (orient(e[4], e[5], e[6], e[7], x, y) === 0 && onSeg(e[4], e[5], e[6], e[7], x, y)) P = [x, y];
      for (const [x, y] of [[e[4], e[5]], [e[6], e[7]]]) if (!P && orient(f[4], f[5], f[6], f[7], x, y) === 0 && onSeg(f[4], f[5], f[6], f[7], x, y)) P = [x, y];
      if (!P) return errors.push({ code: "GEO_SELF_INTERSECT", ring: [pi, e[0], f[0]], kind: "cross" });
      if (e[0] === f[0]) { const vE = (e[4] === P[0] && e[5] === P[1]) || (e[6] === P[0] && e[7] === P[1]), vF = (f[4] === P[0] && f[5] === P[1]) || (f[6] === P[0] && f[7] === P[1]);
        if (!(vE && vF)) errors.push({ code: "GEO_SELF_TOUCH", ring: [pi, e[0]] }); return; } // vertex repeat is GEO_DUPLICATE
      const a = Math.min(e[0], f[0]), b = Math.max(e[0], f[0]); contacts.set(P[0] + "," + P[1] + "|" + a + "|" + b, [P[0], P[1], a, b]);
      edgeDirsAt(e, P[0], P[1], e[0]); edgeDirsAt(f, P[0], P[1], f[0]);
    }
    if (E.length > 4000) {
      const B = 128, bb = bbox(p.outer), cell = Math.max(1, Math.ceil((bb[3] - bb[1] + 1) / B)), buckets = Array.from({ length: B + 1 }, () => []);
      E.forEach((e, idx) => { const a = Math.floor((Math.min(e[5], e[7]) - bb[1]) / cell), b = Math.floor((Math.max(e[5], e[7]) - bb[1]) / cell); for (let c = Math.max(0, a); c <= Math.min(B, b); c++) buckets[c].push(idx); });
      const tested = new Set();
      for (const bk of buckets) { bk.sort((s, t) => Math.min(E[s][4], E[s][6]) - Math.min(E[t][4], E[t][6]));
        for (let s = 0; s < bk.length; s++) { const xs = Math.max(E[bk[s]][4], E[bk[s]][6]);
          for (let t = s + 1; t < bk.length && Math.min(E[bk[t]][4], E[bk[t]][6]) <= xs; t++) { const key = Math.min(bk[s], bk[t]) * 1e7 + Math.max(bk[s], bk[t]); if (tested.has(key)) continue; tested.add(key); testPair(E[bk[s]], E[bk[t]]); } } }
    } else for (let s = 0; s < E.length; s++) for (let t = s + 1; t < E.length; t++) testPair(E[s], E[t]);
    // contact points between different rings: crossing iff the two rings' edge directions interleave around the point
    for (const [x, y, a, b] of contacts.values()) {
      const da = dirs.get(x + "," + y + "|" + a) || [], db = dirs.get(x + "," + y + "|" + b) || [];
      const all = [...da.map((d) => [...d, 0]), ...db.map((d) => [...d, 1])].sort((p, q) => (angLess(p[0], p[1], q[0], q[1]) ? -1 : angLess(q[0], q[1], p[0], p[1]) ? 1 : 0));
      let bad = false; for (let i = 0; i < all.length; i++) { const p = all[i], q = all[(i + 1) % all.length]; if (p[2] !== q[2] && p[0] * q[1] - p[1] * q[0] === 0 && p[0] * q[0] + p[1] * q[1] > 0) bad = true; }
      let changes = 0; for (let i = 0; i < all.length; i++) if (all[i][2] !== all[(i + 1) % all.length][2]) changes++;
      if (bad || changes > 2) errors.push({ code: "GEO_SELF_INTERSECT", ring: [pi, a, b], kind: "crossing-at-point" });
      else touches.push({ code: "GEO_RING_TOUCH", ring: [pi, a, b], at: [x, y] });
    }
    if (!ringErr && !interiorConnected(p)) errors.push({ code: "GEO_MULTIPART", ring: [pi] });
  });
  return { ok: errors.length === 0, errors, touches };
}

// ---------------------------------------------------------------- finite-width contact (D3 / Appendix B.3)
// survives(I, d)  ⇔  the closed inward offset I ⊖ B(d) is non-empty  ⇔  r*(I) ≥ d, where r* is the radius of the largest
// disk inside I ("contact width" w = 2 r*). Decision:
//   SURVIVES  — certified EXACTLY: a rational witness point p with p ∈ I and dist(p, ∂I)² ≥ d², checked in BigInt.
//   FAILS     — certified by Clipper2: the BEVEL inset at d − m (m = 2 grid units at ×scale) is empty. Bevel ⊇ the true
//               inset, and a true inset at d would contain a disk of radius m in the d − m inset, which survives the
//               ≤ 0.71-unit vertex rounding. (Relies on Clipper2's winding-number offset; cross-checked in s5_inset.)
//   UNDECIDED — neither; only possible for r* within ≈ (m + 1)/scale of d (or at reflex-vertex-bound shapes, see S5.md).
// Callers must treat UNDECIDED as "does not survive" (conservative: warn / block), so the boolean is sound.
const JT = C.JoinType, ET = C.EndType;
const bi = (v) => BigInt(v);
function ratD(d) { const q = 1024; const n = Math.round(d * q); if (n / q !== d || n <= 0) throw new Error("GEO_INSET_NOT_DYADIC"); return [bi(n), bi(q)]; }
/** Exact check of a witness (X/q, Y/q). Returns true iff strictly inside I and every edge is at distance ≥ d. */
export function verifyWitness(rings, X, Y, q, d) {
  const [dn, dd] = ratD(d), Q = bi(q), PX = bi(X), PY = bi(Y), lim = (dn * Q) * (dn * Q); // compare dd²·dist²_q ≥ (dn·q)²
  let inside = false;
  for (const r of rings) { const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = bi(r[2 * j]) * Q, ay = bi(r[2 * j + 1]) * Q, bx = bi(r[2 * i]) * Q, by = bi(r[2 * i + 1]) * Q;
      const ex = bx - ax, ey = by - ay, wx = PX - ax, wy = PY - ay, L = ex * ex + ey * ey, t = wx * ex + wy * ey;
      if (t <= 0n) { if (dd * dd * (wx * wx + wy * wy) < lim) return false; }
      else if (t >= L) { const vx = PX - bx, vy = PY - by; if (dd * dd * (vx * vx + vy * vy) < lim) return false; }
      else { const cr = ex * wy - ey * wx; if (dd * dd * cr * cr < lim * L) return false; }
      if ((ay > PY) !== (by > PY)) { const s = (PX - ax) * (by - ay) - ex * (PY - ay); if (by - ay > 0n ? s < 0n : s > 0n) inside = !inside; }
    } }
  return inside;
}
function candidatesOf(paths) { // float points in the (translated, scaled) frame
  const c = [];
  for (const p of paths) { const n = p.length; if (n < 3) continue; let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n], cr = a.x * b.y - b.x * a.y; A += cr; cx += (a.x + b.x) * cr; cy += (a.y + b.y) * cr; }
    if (A !== 0) c.push([cx / (3 * A), cy / (3 * A)]);
    let sx = 0, sy = 0; for (const q of p) { sx += q.x; sy += q.y; } c.push([sx / n, sy / n]);
    for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; c.push([a.x, a.y], [(a.x + b.x) / 2, (a.y + b.y) / 2]); } }
  return c;
}
/** Float depth of point (x, y): min distance to ∂I if inside (even–odd), else −1. Only steers the witness search. */
function depthF(rings, x, y) {
  let inside = false, m = Infinity;
  for (const r of rings) { const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) { const ax = r[2 * j], ay = r[2 * j + 1], bx = r[2 * i], by = r[2 * i + 1];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey; let t = L ? ((x - ax) * ex + (y - ay) * ey) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ax + t * ex - x, dy = ay + t * ey - y, d2 = dx * dx + dy * dy; if (d2 < m) m = d2; } }
  return inside ? Math.sqrt(m) : -1;
}
const DIRS16 = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)]).map(([c, s]) => [Math.round(c * 1e6) / 1e6, Math.round(s * 1e6) / 1e6]); // fixed table (deterministic)
/** Pattern search (16 directions, halving steps) towards the max-inscribed-disk centre. Float only; verified exactly after. */
function refine(rings, x, y, step) {
  let best = depthF(rings, x, y);
  for (let it = 0; it < 4000 && step > 1e-7; it++) { let moved = false;
    for (const [dx, dy] of DIRS16) { const v = depthF(rings, x + dx * step, y + dy * step); if (v > best) { best = v; x += dx * step; y += dy * step; moved = true; break; } }
    if (!moved) step /= 2; }
  return [x, y, best];
}
export function insetStatus(polys, dUm, opts = {}) {
  const rings = []; for (const p of polys) { if (p.outer.length) rings.push(p.outer); for (const h of p.holes) rings.push(h); }
  if (!rings.length || area(polys) <= 0) return { status: "fails", reason: "empty" };
  const s = opts.scale ?? Math.max(16, Math.ceil(16 / dUm)), m = 2;
  let x0 = Infinity, y0 = Infinity; for (const r of rings) { const b = bbox(r); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); }
  const up = rings.map((r) => { const p = []; for (let i = 0; i < r.length; i += 2) p.push({ x: (r[i] - x0) * s, y: (r[i + 1] - y0) * s }); return p; });
  const D = dUm * s, q = 2 * s;
  const off = (delta, jt) => (delta < 0.5 ? null : C.inflatePaths(up, -delta, jt, ET.Polygon, 2.0));
  const tried = new Set(), seeds = [];
  const tryPaths = (paths) => { if (!paths) return null; for (const [cx, cy] of candidatesOf(paths)) {
    const X = Math.round(cx * 2) + q * x0, Y = Math.round(cy * 2) + q * y0, k = X + "," + Y; if (tried.has(k)) continue; tried.add(k);
    if (verifyWitness(rings, X, Y, q, dUm)) return { X, Y, q };
    if (seeds.length < 4096) seeds.push([X / q, Y / q]); } return null; };
  // 1. candidates from Clipper2 insets (Miter ⊆ true inset ⊆ Bevel), deterministic (no trig)
  for (const [delta, jt] of [[D + m, JT.Miter], [D, JT.Miter], [D + m, JT.Bevel], [D - m, JT.Miter], [D - m, JT.Bevel]]) {
    const w = tryPaths(off(delta, jt)); if (w) return { status: "survives", witness: w, scale: s, via: "inset" };
  }
  // 2. cheap failure certificate: an OUTER approximation (Bevel ⊇ true inset) at d − m is empty ⇒ r* < d
  if (D - m >= 1) { const b = off(D - m, JT.Bevel); if (!b.some((p) => Math.abs(C.area(p)) > 0)) return { status: "fails", scale: s, via: "bevel" }; }
  // 3. refine the deepest candidates (and the input's own centroids) by pattern search; snap to 1/4096 µm; verify exactly
  for (const c of candidatesOf(up)) seeds.push([c[0] / s + x0, c[1] / s + y0]);
  const ranked = seeds.map(([x, y]) => [x, y, depthF(rings, x, y)]).filter((t) => t[2] > 0).sort((a, b) => b[2] - a[2]).slice(0, 4);
  for (const [sx, sy] of ranked) { const [rx, ry, dep] = refine(rings, sx, sy, 1 / s); if (dep < dUm * (1 - 1e-9)) continue;
    const Q = 4096, X = Math.round(rx * Q), Y = Math.round(ry * Q); if (verifyWitness(rings, X, Y, Q, dUm)) return { status: "survives", witness: { X, Y, q: Q }, scale: s, via: "refine" }; }
  // 4. tighter failure certificate: Round join, arc tolerance 0.25 unit — arc vertices on the circle, chords inside it, so the
  // result still ⊇ true inset but is much tighter at reflex vertices. Uses trig internally; it only separates "fails" from
  // "undecided" — the survives boolean never depends on it.
  if (D - m >= 1) { const rr = C.inflatePaths(up, -(D - m), JT.Round, ET.Polygon, 2.0, 0.25);
    if (!rr.some((p) => Math.abs(C.area(p)) > 0)) return { status: "fails", scale: s, via: "round" }; }
  return { status: "undecided", scale: s };
}
/** Boolean used by G2.7: true only when survival is certified exactly (undecided counts as NOT surviving). */
export const survivesInset = (polys, dUm, opts) => insetStatus(polys, dUm, opts).status === "survives";
/** G2.7 classification of a support contact, B.3 thresholds: block if width < 0.5 µm (inset 0.25), warn if width < minFeatureUm. */
export function classifyContact(I, minFeatureUm) {
  const b = insetStatus(I, 0.25); if (b.status !== "survives") return { level: "block", certain: b.status === "fails" };
  const w = insetStatus(I, minFeatureUm / 2); if (w.status !== "survives") return { level: "warn", certain: w.status === "fails" };
  return { level: "ok", certain: true };
}

export const SBGeom = { survivesInset, insetStatus, classifyContact, fromPixelLoops, union, difference, intersection, offset, area, isEmpty, components, interiorConnected, normalize, validate, bbox, unionRaw };
