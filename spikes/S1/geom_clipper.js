/* spikes/S1/geom_clipper.js — candidate (a): SBGeom adapter over Clipper2 (clipper2-ts 2.0.1-18).
 * Requires global.Clipper2 (vendor/clipper2.js) and global.SBGeomCore (geom_core.js), both looked
 * up at call time. All coordinates are integer µm; booleans use NonZero on role-oriented rings.
 */
(function (global) {
  "use strict";
  const G = {};
  const K = () => global.SBGeomCore, L = () => global.Clipper2;

  function toPaths(polys) {
    const C = K(), out = [];
    for (const p of polys || []) {
      const rings = [[p.outer, 1]].concat((p.holes || []).map((h) => [h, -1]));
      for (const [r, sign] of rings) {
        const a = C.area2(r); if (a === 0) continue;
        const rr = (a > 0) === (sign > 0) ? r : C.reverseRing(r);
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
    return K().assemble(rings); // Clipper2 outputs outers positive / holes negative (same sign convention as §3)
  }
  const NZ = () => L().FillRule.NonZero;

  G.union = (a, b) => fromPaths(L().union(toPaths(a), toPaths(b || []), NZ()));
  G.difference = (a, b) => fromPaths(L().difference(toPaths(a), toPaths(b || []), NZ()));
  G.intersection = (a, b) => fromPaths(L().intersect(toPaths(a), toPaths(b || []), NZ()));
  G.offset = function (polys, delta, join) {
    const J = L().JoinType;
    const jt = join === "miter" ? J.Miter : join === "square" ? J.Square : null;
    if (jt === null) throw new Error("SBGeom.offset: join '" + join + "' refused (only miter|square are deterministic)");
    if (!Number.isInteger(delta)) throw new Error("SBGeom.offset: delta must be integer µm");
    if (delta === 0) return K().normalize(polys);
    return fromPaths(L().inflatePaths(toPaths(polys), delta, jt, L().EndType.Polygon, 2.0));
  };
  G.components = (polys) => G.union(polys, []).map((p) => [p]);

  for (const k of ["fromPixelLoops", "normalize", "validate", "area", "isEmpty", "containsPoint", "bbox", "circle"])
    G[k] = (...args) => K()[k](...args);
  G.backend = "clipper2-ts@2.0.1-18";

  global.SBGeom = G;
})(typeof window !== "undefined" ? window : globalThis);
