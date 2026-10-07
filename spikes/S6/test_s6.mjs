// Spike S6 — checks. Run: node spikes/S6/test_s6.mjs
import { K, C2, SBTrace, fromPixelLoops, unionRings, unionFlat, ringsOf, rect, sha, nodeSha, lcg, noiseMask, blobMask, require } from "./harness.mjs";

let pass = 0, fail = 0; const failed = [];
const check = (name, cond) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; failed.push(name); console.error("  ✗ " + name); } };
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
const H = (layer) => K.layerHash(layer);
const shoe = (r) => K.area2(r);
const rot = (r, k) => r.slice(2 * k).concat(r.slice(0, 2 * k));
const rev = (r) => { const o = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; };
const shuffle = (a, seed) => { const rnd = lcg(seed), b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// A small layer: L-shaped part with a hole, a triangle, a square; one score path; one registration hole.
const Lshape = { outer: [0, 0, 6000, 0, 6000, 2000, 2000, 2000, 2000, 8000, 0, 8000], holes: [[500, 500, 1500, 500, 1500, 1500, 500, 1500].reverse() /* placeholder fixed below */] };
Lshape.holes = [rev([500, 500, 1500, 500, 1500, 1500, 500, 1500])];
const tri = { outer: [10000, 0, 14000, 0, 12000, 3000], holes: [] };
const sq = { outer: rect(20000, 5000, 23000, 8000), holes: [[20500, 5500, 20500, 6500, 21500, 6500, 21500, 5500]] };
const base = { index: 3, material: [Lshape, tri, sq], scorePaths: [[1000, 9000, 4000, 9000, 4000, 12000]], holes: [{ cxUm: 30000, cyUm: 30000, rUm: 1500 }] };
const h0 = H(base);

console.log("\nspike S6 — plan checks (GEO-09, NFR-05)");
check("S6/GEO-09 hash invariant to start vertex", H({ ...base, material: base.material.map((p) => ({ outer: rot(p.outer, 2), holes: p.holes.map((h) => rot(h, 2)) })) }) === h0);
check("S6 hash invariant to input winding", H({ ...base, material: base.material.map((p) => ({ outer: rev(p.outer), holes: p.holes.map(rev) })) }) === h0);
check("S6 hash invariant to part order", [1, 2, 3, 4, 5].every((s) => H({ ...base, material: shuffle(base.material, s) }) === h0) && H({ ...base, material: base.material.slice().reverse() }) === h0);
const moved = { ...base, material: [{ outer: [0, 0, 6001, 0, 6001, 2000, 2000, 2000, 2000, 8000, 0, 8000], holes: Lshape.holes }, tri, sq] };
check("S6 1µm move changes hash", H(moved) !== h0);
check("S6 1µm move changes hash (whole part translated by 1µm in y)", H({ ...base, material: [Lshape, { outer: tri.outer.map((v, i) => (i % 2 ? v + 1 : v)), holes: [] }, sq] }) !== h0);
check("S6 score path change changes hash", H({ ...base, scorePaths: [[1000, 9000, 4000, 9000, 4000, 12001]] }) !== h0);
check("S6 score path removal changes hash", H({ ...base, scorePaths: [] }) !== h0);

console.log("\nspike S6 — normalization contract (§3 winding, D3, D4)");
const n = K.normalize(base.material);
check("S6 normalize idempotent", JSON.stringify(K.normalize(n)) === JSON.stringify(n));
check("S6 outer positive / holes negative shoelace (Y-down)", n.every((p) => shoe(p.outer) > 0 && p.holes.every((h) => shoe(h) < 0)));
check("S6 every ring starts at lexicographically smallest (x,y)", n.every((p) => [p.outer, ...p.holes].every((r) => { for (let i = 2; i < r.length; i += 2) if (r[i] < r[0] || (r[i] === r[0] && r[i + 1] < r[1])) return false; return true; })));
check("S6 parts sorted by (minY, minX)", n.map((p) => p.outer[0]).join() === "0,10000,20000");
check("S6 hole order invariant", H({ ...base, material: [Lshape, tri, { outer: sq.outer, holes: [...sq.holes, rev(rect(22000, 7000, 22500, 7500))] }] }) === H({ ...base, material: [Lshape, tri, { outer: sq.outer, holes: [rev(rect(22000, 7000, 22500, 7500)), ...sq.holes] }] }));
const withJunk = { outer: [0, 0, 3000, 0, 3000, 0, 6000, 0, 6000, 1000, 6000, 2000, 2000, 2000, 2000, 8000, 1000, 8000, 0, 8000, 0, 4000], holes: Lshape.holes };
check("S6 duplicate + collinear vertices removed (hash unchanged)", H({ ...base, material: [withJunk, tri, sq] }) === h0);
const spiky = { outer: [0, 0, 6000, 0, 6000, 2000, 9000, 2000, 6000, 2000, 2000, 2000, 2000, 8000, 0, 8000], holes: Lshape.holes };
check("S6 180° zero-width spike removed (hash unchanged)", H({ ...base, material: [spiky, tri, sq] }) === h0);
check("S6 layer index enters hash", H({ ...base, index: 4 }) !== h0);
check("S6 multi-layer stream independent of input layer order", sha(K.canonicalBytes([base, { ...base, index: 0 }])) === sha(K.canonicalBytes([{ ...base, index: 0 }, base])));
check("S6 score path direction invariant", H({ ...base, scorePaths: [rev(base.scorePaths[0])] }) === h0);
check("S6 score path pass-through collinear point removed", H({ ...base, scorePaths: [[1000, 9000, 2500, 9000, 4000, 9000, 4000, 12000]] }) === h0);
const two = { ...base, scorePaths: [[0, 0, 0, 5], [7, 7, 9, 9]] };
check("S6 score path order invariant", H(two) === H({ ...two, scorePaths: two.scorePaths.slice().reverse() }));
const closedScore = [100, 100, 900, 100, 900, 900, 100, 900, 100, 100];
check("S6 closed score ring start/direction invariant", H({ ...base, scorePaths: [closedScore] }) === H({ ...base, scorePaths: [[900, 900, 900, 100, 100, 100, 100, 900, 900, 900]] }));
check("S6 registration hole radius change changes hash (holes section)", H({ ...base, holes: [{ cxUm: 30000, cyUm: 30000, rUm: 1501 }] }) !== h0);
check("S6 registration hole order invariant", H({ ...base, holes: [{ cxUm: 1, cyUm: 2, rUm: 3 }, { cxUm: 4, cyUm: 1, rUm: 3 }] }) === H({ ...base, holes: [{ cxUm: 4, cyUm: 1, rUm: 3 }, { cxUm: 1, cyUm: 2, rUm: 3 }] }));
check("S6 empty layer is well-defined and differs from non-empty", H({ index: 3, material: [] }) !== h0 && H({ index: 3, material: [] }) === H({ index: 3, material: [], scorePaths: [], holes: [] }));
check("S6 non-integer coordinate throws", throws(() => K.canonicalBytes([{ index: 0, material: [{ outer: [0, 0, 10.5, 0, 10, 10], holes: [] }] }])));
check("S6 out-of-range coordinate throws (never truncates)", throws(() => K.canonicalBytes([{ index: 0, material: [{ outer: [0, 0, 2 ** 26, 0, 10, 10], holes: [] }] }])));
check("S6 zero-area part dropped", H({ ...base, material: [...base.material, { outer: [0, 50000, 100, 50000, 200, 50000], holes: [] }] }) === h0);

// byte layout matches plan structure exactly for a tiny case
const tiny = K.canonicalBytes([{ index: 2, material: [{ outer: rev(rect(0, 0, 10, 10)), holes: [] }], scorePaths: [[5, 5, 1, 1]] }]);
const words = Array.from(new Int32Array(tiny.buffer));
check("S6 byte layout = [layerCount, index, partCount, ringCount, vertexCount, x,y…, scoreCount, vertexCount, x,y…, holeCount]",
  JSON.stringify(words) === JSON.stringify([1, 2, 1, 1, 4, 0, 0, 10, 0, 10, 10, 0, 10, 1, 2, 1, 1, 5, 5, 0]));
check("S6 little-endian int32 (first word bytes 01 00 00 00)", tiny[0] === 1 && tiny[1] === 0 && tiny[3] === 0);
check("S6 SBHash.sha256(canonicalBytes) == node:crypto", sha(K.canonicalBytes([base])) === nodeSha(K.canonicalBytes([base])));

console.log("\nspike S6 — D3 saddle / pinch canonicalization");
const fig8 = { outer: [0, 0, 10, 0, 10, 10, 20, 10, 20, 20, 10, 20, 10, 10, 0, 10], holes: [] };
const twoSq = [{ outer: rect(0, 0, 10, 10), holes: [] }, { outer: rect(10, 10, 20, 20), holes: [] }];
check("D3 figure-8 ring == two vertex-touching squares (same hash)", H({ index: 0, material: [fig8] }) === H({ index: 0, material: twoSq }));
check("D3 figure-8 normalizes to 2 simple rings", K.normalize([fig8]).length === 2);
// outer ring pinched at (10,0) enclosing a triangular hole whose apex touches the boundary
const pinched = { outer: [0, 0, 10, 0, 7, 5, 13, 5, 10, 0, 20, 0, 20, 20, 0, 20], holes: [] };
const withHole = { outer: rect(0, 0, 20, 20), holes: [[10, 0, 7, 5, 13, 5]] };
check("D3 pinched-outer == outer + vertex-touching hole (same hash)", H({ index: 0, material: [pinched] }) === H({ index: 0, material: [withHole] }));
const pn = K.normalize([pinched]);
check("D3 pinched-outer → 1 part with 1 hole", pn.length === 1 && pn[0].holes.length === 1);
// hole ring pinched around an island → hole + separate island part
const pinchedHole = { outer: rect(0, 0, 40, 40), holes: [rev([10, 10, 20, 10, 25, 15, 30, 10, 30, 30, 10, 30]).concat([])] };
check("D3 pinched-hole input does not crash and stays valid", K.normalize([pinchedHole]).length >= 1);

console.log("\nspike S6 — strong invariance through Clipper2 (union → normalize)");
const donutA = [rect(0, 0, 30000, 30000), rev(rect(10000, 10000, 20000, 20000))];
const donutB = [rect(0, 0, 30000, 10000), rect(0, 20000, 30000, 30000), rect(0, 10000, 10000, 20000), rect(20000, 10000, 30000, 20000)];
const donutC = [rect(0, 0, 20000, 10000), rect(15000, 0, 30000, 10000), rect(0, 0, 10000, 30000), rect(20000, 5000, 30000, 30000), rect(5000, 20000, 25000, 30000)];
const hA = H({ index: 1, material: unionRings(donutA) });
check("S6 donut: one ring-with-hole == 4-strip frame (clipper union)", hA === H({ index: 1, material: unionRings(donutB) }));
check("S6 donut: overlapping rectangles == same region", hA === H({ index: 1, material: unionRings(donutC) }));
check("S6 donut: shuffled + reversed clipper input == same", hA === H({ index: 1, material: unionRings(shuffle(donutB.map(rev), 9)) }));

const pixelSquares = (m, w, h, s) => { const out = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) out.push(rect(x * s, y * s, (x + 1) * s, (y + 1) * s)); return out; };
let traceVsPixel = 0, total = 0, saddleCases = 0, clipperRaw = 0;
for (let seed = 1; seed <= 40; seed++) {
  const w = 12, h = 10, m = noiseMask(w, h, seed, 0.5), s = 1000;
  const viaTrace = unionRings(fromPixelLoops(SBTrace.trace(m, w, h), s, s, 0, 0));
  const viaPix = unionRings(pixelSquares(m, w, h, s));
  total++;
  if (H({ index: 0, material: viaTrace }) === H({ index: 0, material: viaPix })) traceVsPixel++;
  if (JSON.stringify(viaTrace) === JSON.stringify(viaPix)) clipperRaw++;
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) { const a = m[y * w + x], b = m[y * w + x + 1], c = m[(y + 1) * w + x], d = m[(y + 1) * w + x + 1]; if (a === d && b === c && a !== b) saddleCases++; }
}
console.log(`    (40 random 12×10 noise masks, ${saddleCases} saddles total; raw Clipper outputs identical in ${clipperRaw}/40, canonical hashes identical in ${traceVsPixel}/40)`);
check("S6 trace-loops union == per-pixel-squares union, canonical hash equal on 40 saddle-heavy masks", traceVsPixel === total);
const allValid = (() => { for (let seed = 1; seed <= 40; seed++) { const m = noiseMask(12, 10, seed, 0.5); const nn = K.normalize(unionRings(pixelSquares(m, 12, 10, 1000)));
  for (const p of nn) for (const r of [p.outer, ...p.holes]) { const seen = new Set(); for (let i = 0; i < r.length; i += 2) { const k = r[i] + "," + r[i + 1]; if (seen.has(k)) return false; seen.add(k); } } } return true; })();
check("D3 no normalized ring repeats a vertex (all saddles split)", allValid);
const blob = blobMask(64, 48, 7, 40, 2, 9);
const bA = unionRings(fromPixelLoops(SBTrace.trace(blob, 64, 48), 250, 250, 1000, 1000));
const bB = unionRings(pixelSquares(blob, 64, 48, 250).map((r) => r.map((v) => v + 1000)));
check("S6 blob mask (offset 1000µm, 250µm px): trace vs pixel union same hash", H({ index: 5, material: bA }) === H({ index: 5, material: bB }));
check("S6 blob mask: EvenOdd vs NonZero on trace loops same hash (rings are NonZero-safe)", H({ index: 5, material: bA }) === H({ index: 5, material: unionRings(fromPixelLoops(SBTrace.trace(blob, 64, 48), 250, 250, 1000, 1000), C2.FillRule.EvenOdd) }));
check("S6 results identical across two runs", H({ index: 5, material: bA }) === H({ index: 5, material: unionRings(fromPixelLoops(SBTrace.trace(blob, 64, 48), 250, 250, 1000, 1000)) }));

const ftNoRepeat = (() => { const rings = [K.cleanRing(fig8.outer)]; const ft = K.faceTrace(rings); return ft.length === 2; })();
check("D3 faceTrace alone (no splitRing fallback) separates figure-8 lobes", ftNoRepeat);
const ftHole2 = K.faceTrace(K.splitTJunctions([rect(0, 0, 20, 20), rev([10, 0, 20, 10, 10, 20, 0, 10])]));
check("D3 T-junction split + faceTrace: diamond hole touching outer mid-edges → 4 corner triangles, 0 holes", ftHole2.length === 4 && ftHole2.every((r) => K.area2(r) > 0));
check("D3 diamond hole via Clipper Difference (self-touch + T-touch output) == 4 triangles via union", (() => {
  const P = (r) => { const q = new C2.Path64(); for (let i = 0; i < r.length; i += 2) q.push(new C2.Point64(r[i], r[i + 1])); return q; };
  const A = new C2.Paths64(); A.push(P(rect(0, 0, 20, 20))); const B = new C2.Paths64(); B.push(P([10, 0, 20, 10, 10, 20, 0, 10]));
  const d = C2.Clipper.Difference(A, B, C2.FillRule.NonZero).map((pp) => pp.flatMap((q) => [q.x, q.y]));
  return H({ index: 0, material: K.assembleRings(d) }) === H({ index: 0, material: unionRings([[0, 0, 10, 0, 0, 10], [10, 0, 20, 0, 20, 10], [20, 10, 20, 20, 10, 20], [0, 10, 10, 20, 0, 20]]) });
})());
check("D3 hole wound like its outer is material under NonZero (not a hole)", K.normalize([{ outer: rect(0, 0, 30, 30), holes: [rect(10, 10, 20, 20)] }]).every((p) => p.holes.length === 0));
check("D3 diamond-hole polygon == 4 separate corner triangles (same hash)", H({ index: 0, material: [{ outer: rect(0, 0, 20, 20), holes: [rev([10, 0, 20, 10, 10, 20, 0, 10])] }] }) ===
  H({ index: 0, material: [[0, 0, 10, 0, 0, 10], [10, 0, 20, 0, 20, 10], [20, 10, 20, 20, 10, 20], [0, 10, 10, 20, 0, 20]].map((o) => ({ outer: o, holes: [] })) }));

// randomized stress: 4 boolean routes × perturbations must agree on the canonical hash
{
  let agree = 0, runs = 0, faceTraceRepeat = 0;
  // rotate every ring, reverse ALL rings of every other polygon (global winding flip), shuffle parts and holes
  const perturb = (polys, seed) => shuffle(polys, seed).map((p, i) => { const f = (i + seed) % 2 ? rev : (r) => r;
    return { outer: f(rot(p.outer, seed % (p.outer.length >> 1))), holes: shuffle(p.holes, seed + 1).map((h) => f(rot(h, 1))) }; });
  for (const [w, h, dens] of [[24, 20, 0.35], [24, 20, 0.5], [24, 20, 0.65], [40, 30, 0.5]]) for (let seed = 100; seed < 150; seed++) {
    const m = noiseMask(w, h, seed * 7 + w, dens), s = 1000;
    const loops = fromPixelLoops(SBTrace.trace(m, w, h), s, s, 0, 0), px = pixelSquares(m, w, h, s);
    const routes = [unionRings(loops), unionRings(px), unionFlat(loops), unionFlat(shuffle(px, seed).map(rev))];
    const hs = routes.map((r, i) => H({ index: 0, material: perturb(r, seed + i) }));
    runs++; if (hs.every((x) => x === hs[0])) agree++;
    for (const r of routes) for (const p of K.normalize(r)) for (const ring of [p.outer, ...p.holes]) {
      const seen = new Set(); for (let i = 0; i < ring.length; i += 2) { const k = ring[i] + "," + ring[i + 1]; if (seen.has(k)) { faceTraceRepeat++; break; } seen.add(k); } }
  }
  console.log(`    (stress: ${runs} masks × 4 routes × perturbation; agree ${agree}/${runs}; normalized rings repeating a vertex: ${faceTraceRepeat})`);
  check("S6 stress: 200 random masks, 4 Clipper routes (PolyTree/flat × trace/pixels) + rotate/reverse/shuffle → identical hash", agree === runs);
  check("D3 stress: no normalized ring revisits a vertex (faceTrace + splitRing)", faceTraceRepeat === 0);
}

console.log("\nspike S6 — NFR-05 static scan");
const src = require("node:fs").readFileSync(new URL("./canon.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
check("NFR-05 canon.js uses no Math.cbrt/sin/cos/tan/atan/exp/log/pow/random/sqrt/hypot", !/Math\.(cbrt|sin|cos|tan|atan2?|exp|log\w*|pow|random|sqrt|hypot)/.test(src));
check("NFR-05 canon.js: division only in splitTJunctions grid binning (never reaches output)", src.replace(/"[^"]*"/g, "").split("\n").filter((l) => /[^/*]\/[^/*]/.test(l)).every((l) => /\b(cw|ch)\b/.test(l)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.error("FAILED: " + failed.join(" | ")); process.exitCode = 1; }
