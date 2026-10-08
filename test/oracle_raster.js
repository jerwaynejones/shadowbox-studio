// test/oracle_raster.js — INDEPENDENT raster oracle for D3 (ported from spikes/S5/oracle_raster.mjs, spike S5 F1).
// Uses no repo module (not SBMorph, not SBTrace, not SBGeom) and no Clipper2: plain BFS labelling of the mask, and
// exact scanline rasterization of output polygons at pixel centres.
"use strict";

/** 4-connected (conn=4) or 8-connected (conn=8) labelling of mask cells equal to `val`. Returns {label Int32Array (-1
 *  elsewhere), count, sizes[]}. Iterative BFS. */
function label(mask, w, h, val = 1, conn = 4) {
  const lab = new Int32Array(w * h).fill(-1), sizes = [], q = new Int32Array(w * h);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]], N = conn === 8 ? N8 : N4;
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if ((mask[s] ? 1 : 0) !== val || lab[s] !== -1) continue;
    let head = 0, tail = 0; q[tail++] = s; lab[s] = count; let n = 0;
    while (head < tail) { const c = q[head++]; n++; const x = c % w, y = (c / w) | 0;
      for (const [dx, dy] of N) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const t = Y * w + X;
        if ((mask[t] ? 1 : 0) === val && lab[t] === -1) { lab[t] = count; q[tail++] = t; } } }
    sizes.push(n); count++;
  }
  return { label: lab, count, sizes };
}

/** Saddle statistics: a saddle is a 2×2 window with exactly the two diagonal cells set. The saddle graph has one node per
 *  4-component and one edge per saddle; its cycle rank E − V + C counts independent saddle cycles (the F1 trigger). */
function saddleStats(mask, w, h) {
  const L = label(mask, w, h, 1, 4); let saddles = 0, cross = 0; const parent = Array.from({ length: L.count }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i]))); let cycles = 0, crossCycles = 0;
  const parent2 = Array.from({ length: L.count }, (_, i) => i), find2 = (i) => (parent2[i] === i ? i : (parent2[i] = find2(parent2[i])));
  const link = (a, b) => { saddles++; const ra = find(a), rb = find(b); if (ra === rb) cycles++; else parent[ra] = rb;
    if (a !== b) { cross++; const sa = find2(a), sb = find2(b); if (sa === sb) crossCycles++; else parent2[sa] = sb; } };
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
    const a = mask[y * w + x] ? 1 : 0, b = mask[y * w + x + 1] ? 1 : 0, c = mask[(y + 1) * w + x] ? 1 : 0, d = mask[(y + 1) * w + x + 1] ? 1 : 0;
    if (a && d && !b && !c) link(L.label[y * w + x], L.label[(y + 1) * w + x + 1]);
    else if (b && c && !a && !d) link(L.label[y * w + x + 1], L.label[(y + 1) * w + x]);
  }
  // cycles: all independent cycles (incl. a part touching itself = outer–hole pinch); crossCycles: cycles through ≥ 2 parts
  return { saddles, crossPartSaddles: cross, saddleCycles: cycles, multiPartSaddleCycles: crossCycles, parts: L.count };
}

/** Pixel cells whose CENTRE lies inside polygon `poly` (outer minus holes, even–odd), for a raster at scale s µm/px and
 *  offset o µm. Exact for integer coordinates: crossing x is compared by cross-multiplication. Returns Int32Array of
 *  cell indices. Throws if a pixel centre lies exactly on an edge (cannot happen for raster-derived geometry). */
function rasterize(poly, w, h, s, o) {
  const rings = [poly.outer, ...poly.holes], rows = Array.from({ length: h }, () => []);
  for (const r of rings) { const n = r.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, x0 = r[2 * i], y0 = r[2 * i + 1], x1 = r[2 * j], y1 = r[2 * j + 1];
      if (y0 === y1) continue; const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
      // rows whose centre yc = (y+0.5)s+o is in [ya, yb)
      const yStart = Math.max(0, Math.ceil((ya - o) / s - 0.5)), yEnd = Math.min(h - 1, Math.ceil((yb - o) / s - 0.5) - 1);
      for (let y = yStart; y <= yEnd; y++) { const yc2 = (2 * y + 1) * s + 2 * o; // doubled
        if (!(2 * ya <= yc2 && yc2 < 2 * yb)) continue;
        rows[y].push([x0, y0, x1, y1]); } } }
  const cells = []; let bx0 = Infinity, bx1 = -Infinity; for (let i = 0; i < poly.outer.length; i += 2) { bx0 = Math.min(bx0, poly.outer[i]); bx1 = Math.max(bx1, poly.outer[i]); }
  const xa = Math.max(0, Math.floor((bx0 - o) / s) - 1), xb = Math.min(w - 1, Math.ceil((bx1 - o) / s) + 1);
  for (let y = 0; y < h; y++) { if (!rows[y].length) continue; const yc2 = (2 * y + 1) * s + 2 * o;
    for (let x = xa; x <= xb; x++) { const xc2 = (2 * x + 1) * s + 2 * o; let inside = false;
      for (const [x0, y0, x1, y1] of rows[y]) { // crossing x vs xc: sign of (xc2 - 2x0)(y1-y0) - (2x1-2x0)... doubled coords
        const X0 = 2 * x0, Y0 = 2 * y0, X1 = 2 * x1, Y1 = 2 * y1, sgn = (xc2 - X0) * (Y1 - Y0) - (X1 - X0) * (yc2 - Y0);
        if (sgn === 0) throw new Error("pixel centre on edge");
        if (Y1 - Y0 > 0 ? sgn < 0 : sgn > 0) inside = !inside; }
      if (inside) cells.push(y * w + x); } }
  return Int32Array.from(cells);
}

/** The D3 oracle. Checks that `polys` (one normalized polygon per part) is in exact bijection with the 4-connected
 *  components of `mask`: every polygon's pixel set is exactly one component, all components are covered once.
 *  Returns {ok, parts, polys, reasons[]}. */
function checkPartsAgainstRaster(polys, mask, w, h, s, o) {
  const L = label(mask, w, h, 1, 4), seen = new Int32Array(L.count).fill(-1), reasons = [];
  polys.forEach((p, pi) => {
    let cells; try { cells = rasterize(p, w, h, s, o); } catch (e) { reasons.push(`poly ${pi}: ${e.message}`); return; }
    if (!cells.length) { reasons.push(`poly ${pi}: covers no pixel centre`); return; }
    const lab = L.label[cells[0]];
    if (lab < 0) { reasons.push(`poly ${pi}: covers a background pixel`); return; }
    for (const c of cells) if (L.label[c] !== lab) { reasons.push(`poly ${pi}: spans ${L.label[c] < 0 ? "background" : "several components"}`); return; }
    if (cells.length !== L.sizes[lab]) { reasons.push(`poly ${pi}: ${cells.length} px but component has ${L.sizes[lab]}`); return; }
    if (seen[lab] !== -1) { reasons.push(`component ${lab}: covered by polys ${seen[lab]} and ${pi}`); return; }
    seen[lab] = pi;
  });
  for (let k = 0; k < L.count; k++) if (seen[k] === -1) reasons.push(`component ${k}: not covered`);
  return { ok: reasons.length === 0 && polys.length === L.count, parts: L.count, polys: polys.length, reasons };
}
module.exports = { label, saddleStats, rasterize, checkPartsAgainstRaster };
