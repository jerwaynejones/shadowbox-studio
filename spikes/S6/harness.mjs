// Spike S6 — shared Node harness: loads repo classic scripts (read-only) + spike canon.js + Clipper2 JS port.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const require = createRequire(import.meta.url);
globalThis.crypto ??= require("node:crypto").webcrypto;
for (const f of ["util.js", "hash.js", "trace.js"]) vm.runInThisContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), { filename: f });
vm.runInThisContext(fs.readFileSync(path.join(here, "canon.js"), "utf8"), { filename: "spikes/S6/canon.js" });

export const C2 = await import(path.join(here, "vendor/clipper2-js-1.2.4.mjs"));
// clipper2-js 1.2.4 port bug: OutRec never initialises .bounds/.path (C# does), so executePolyTree always
// throws inside buildTree→checkBounds and returns false. Spike-local monkey patch (NOT a vendor edit):
{
  const orig = C2.ClipperBase.prototype.checkBounds;
  C2.ClipperBase.prototype.checkBounds = function (outrec) {
    if (outrec.bounds === undefined) { outrec.bounds = new C2.Rect64(0, 0, 0, 0); outrec.path = new C2.Path64(); }
    return orig.call(this, outrec);
  };
}
export const { SBCanonS6: K, SBHash, SBTrace } = globalThis;

/** fromPixelLoops prototype (plan S1 table): round(x*sx+ox), REVERSE traced rings to §3 winding. Returns flat rings. */
export function fromPixelLoops(loops, sx, sy, ox, oy) {
  return loops.map((L) => { const r = []; for (let i = L.length - 1; i >= 0; i--) r.push(Math.round(L[i][0] * sx + ox), Math.round(L[i][1] * sy + oy)); return r; });
}
const toPath = (r) => { const p = new C2.Path64(); for (let i = 0; i < r.length; i += 2) p.push(new C2.Point64(r[i], r[i + 1])); return p; };
const fromPath = (p) => { const r = []; for (const q of p) r.push(q.x, q.y); return r; };
function treeToPolys(node, out) {
  for (const o of node.children) {
    out.push({ outer: fromPath(o.polygon), holes: o.children.map((h) => fromPath(h.polygon)) });
    for (const h of o.children) treeToPolys(h, out);
  }
  return out;
}
/** Clipper2 union of flat rings (NonZero) → PolygonWithHoles[] via PolyTree. */
export function unionRings(rings, fill = C2.FillRule.NonZero) {
  const c = new C2.Clipper64(); const ps = new C2.Paths64(); for (const r of rings) ps.push(toPath(r));
  c.addPaths(ps, C2.PathType.Subject);
  const tree = new C2.PolyTree64();
  if (!c.executePolyTree(C2.ClipType.Union, fill, tree)) throw new Error("clipper union failed");
  return treeToPolys(tree, []);
}
/** Clipper2 flat-path union (no PolyTree); holes assembled by canon normalize depth parity. */
export function unionFlat(rings, fill = C2.FillRule.NonZero) {
  const ps = new C2.Paths64(); for (const r of rings) ps.push(toPath(r));
  const out = C2.Clipper.Union(ps, undefined, fill);
  return [{ outer: [], holes: [] }].slice(1).concat(K.assembleRings(out.map(fromPath)));
}
export const ringsOf = (polys) => polys.flatMap((p) => [p.outer, ...p.holes]);
export const rect = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
export const sha = (bytes) => SBHash.sha256(bytes);
export const nodeSha = (bytes) => require("node:crypto").createHash("sha256").update(bytes).digest("hex");
export function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
/** Smooth-ish random blob mask: sum of LCG-placed discs (integer math), thresholded. */
export function blobMask(w, h, seed, nDiscs, rMin, rMax) {
  const rnd = lcg(seed), m = new Uint8Array(w * h);
  for (let k = 0; k < nDiscs; k++) {
    const cx = Math.floor(rnd() * w), cy = Math.floor(rnd() * h), r = rMin + Math.floor(rnd() * (rMax - rMin)), add = rnd() < 0.7 ? 1 : 0;
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++)
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) m[y * w + x] = add;
  }
  return m;
}
export function noiseMask(w, h, seed, p) { const rnd = lcg(seed), m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = rnd() < p ? 1 : 0; return m; }
