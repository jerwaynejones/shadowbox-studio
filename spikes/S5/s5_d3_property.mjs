// spikes/S5/s5_d3_property.mjs — D3 normalize rule (F1) against an INDEPENDENT raster oracle.
//   node spikes/S5/s5_d3_property.mjs [--quick]
// Oracle (oracle_raster.mjs): BFS 4-connected labelling of the mask + exact rasterization of every output polygon at
// pixel centres. Pass = polygons are in BIJECTION with 4-components, pixel-exact (count, membership and holes all
// follow), validate() ok, components() agrees, every polygon interiorConnected().
// Also characterizes Clipper2's own pairing at touching vertices and the plan's split-only rule.
import { F, SBTrace } from "./load_repo.mjs";
import * as G from "./geom_s5.mjs";
import { label, saddleStats, checkPartsAgainstRaster } from "./oracle_raster.mjs";

const QUICK = process.argv.includes("--quick");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  " + extra : "")); } };
const lcg = (s) => F.lcg(s);
const pipe = (m, w, h, s = 1000, o = 0) => G.union(G.fromPixelLoops(SBTrace.trace(m, w, h), s, s, o, o), []);
const rowsOf = (m, w, h) => Array.from({ length: h }, (_, y) => [...m.slice(y * w, y * w + w)].map((q) => (q ? "#" : ".")).join("")).join("/");

// ------------------------------------------------------------------ mask generators
const noise = (r, w, h, p) => { const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = r() < p ? 1 : 0; return m; };
function blockChecker(r, w, h, b, drop, sprinkle) { // b×b checkerboard blocks (every block corner is a saddle), random dropout + noise
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const on = ((Math.floor(x / b) + Math.floor(y / b)) & 1) === 0; m[y * w + x] = on ? 1 : 0; }
  for (let by = 0; by * b < h; by++) for (let bx = 0; bx * b < w; bx++) if (r() < drop) for (let y = by * b; y < Math.min(h, by * b + b); y++) for (let x = bx * b; x < Math.min(w, bx * b + b); x++) m[y * w + x] = 0;
  for (let i = 0; i < m.length; i++) if (r() < sprinkle) m[i] ^= 1;
  return m;
}
function diamondRings(r, w, h, k) { // concentric "diamond" rings of k×k blocks touching only diagonally → saddle cycles around void
  const m = new Uint8Array(w * h), cx = Math.floor(w / (2 * k)), cy = Math.floor(h / (2 * k));
  const radii = []; for (let R = 1 + Math.floor(r() * 2); R < Math.min(cx, cy); R += 2 + Math.floor(r() * 2)) radii.push(R);
  for (let by = 0; by * k < h; by++) for (let bx = 0; bx * k < w; bx++) if (radii.includes(Math.abs(bx - cx) + Math.abs(by - cy)) && r() > 0.05)
    for (let y = by * k; y < Math.min(h, by * k + k); y++) for (let x = bx * k; x < Math.min(w, bx * k + k); x++) m[y * w + x] = 1;
  return m;
}
function chainCycles(r, w, h) { // random closed loops of diagonal steps (each step a saddle), drawn as single pixels, plus solid blobs
  const m = new Uint8Array(w * h);
  for (let t = 0; t < 6; t++) { let x = 2 + Math.floor(r() * (w - 4)), y = 2 + Math.floor(r() * (h - 4)); const n = 4 + Math.floor(r() * 10);
    const path = [[1, 1], [1, -1], [-1, -1], [-1, 1]]; // a diamond loop of n steps per side
    for (const [dx, dy] of path) for (let s = 0; s < n; s++) { x += dx; y += dy; if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1; } }
  for (let i = 0; i < m.length; i++) if (r() < 0.08) m[i] = 1;
  return m;
}

// ------------------------------------------------------------------ Clipper2 pairing characterization
/** For the RAW Clipper2 union, at every vertex with ≥ 2 outgoing edges, does Clipper2 continue each incoming edge with
 *  the material-separating (right-most) outgoing edge? Returns {vertices, separating, joining}. */
function clipperPairing(rawPaths) {
  const outs = new Map(), succ = [];
  for (const p of rawPaths) { const n = p.length; for (let i = 0; i < n; i++) { const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n], k = b.x + "," + b.y;
    if (!outs.has(k)) outs.set(k, []); outs.get(k).push([c.x - b.x, c.y - b.y]); succ.push([k, b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y]); } }
  const half = (ux, uy, vx, vy) => { const c = ux * vy - uy * vx; return c > 0 || (c === 0 && ux * vx + uy * vy < 0) ? 1 : 0; };
  const moreRight = (ux, uy, ax, ay, bx, by) => { const ha = half(ux, uy, ax, ay), hb = half(ux, uy, bx, by); if (ha !== hb) return ha > hb; return bx * ay - by * ax > 0; };
  let vertices = 0, separating = 0, joining = 0; const counted = new Set();
  for (const [k, ux, uy, vx, vy] of succ) { const o = outs.get(k); if (o.length < 2) continue; if (!counted.has(k)) { counted.add(k); vertices++; }
    let best = o[0]; for (const c of o) if (moreRight(ux, uy, c[0], c[1], best[0], best[1])) best = c;
    if (best[0] === vx && best[1] === vy) separating++; else joining++; }
  return { vertices, separating, joining };
}

// ------------------------------------------------------------------ sweeps
const SWEEPS = [
  ["noise 24×24 p=0.5", 24, 24, (r) => noise(r, 24, 24, 0.5), QUICK ? 150 : 1000, 1000, 0],
  ["noise 32×32 p=0.35", 32, 32, (r) => noise(r, 32, 32, 0.35), QUICK ? 60 : 300, 250, 10000],
  ["noise 32×32 p=0.65", 32, 32, (r) => noise(r, 32, 32, 0.65), QUICK ? 60 : 300, 250, 10000],
  ["noise 64×64 p=0.5", 64, 64, (r) => noise(r, 64, 64, 0.5), QUICK ? 20 : 150, 1000, 0],
  ["block checker b=1..3, dropout ≤0.3 (saddle lattices)", 48, 40, (r) => blockChecker(r, 48, 40, 1 + Math.floor(r() * 3), r() * 0.3, r() * 0.04), QUICK ? 60 : 300, 7, 3],
  ["diamond rings of k×k blocks (k=1..3)", 60, 60, (r) => diamondRings(r, 60, 60, 1 + Math.floor(r() * 3)), QUICK ? 40 : 200, 1000, 0],
  ["random diagonal-step loops + specks", 48, 48, (r) => chainCycles(r, 48, 48), QUICK ? 60 : 300, 250, 0],
];
const summary = {};
console.log("\nD3 (F1) — union + normalize vs independent raster oracle");
for (const [name, w, h, gen, n, s, o] of SWEEPS) {
  const agg = { masks: 0, saddles: 0, saddleCycles: 0, multiPartSaddleCycles: 0, parts: 0, rawRingsWithRepeat: 0, rawSingleRingMultiPart: 0,
    clipperShared: 0, clipperSeparating: 0, clipperJoining: 0, rechainOracleFail: 0, validateFail: 0, componentsMismatch: 0, notInteriorConnected: 0,
    splitOracleFail: 0, splitMultipartDetected: 0, splitMultipartUndetectedByOldComponents: 0 };
  G.resetStats();
  for (let seed = 1; seed <= n; seed++) {
    const r = lcg(seed * 7919 + name.length), m = gen(r); agg.masks++;
    const st = saddleStats(m, w, h); agg.saddles += st.saddles; agg.saddleCycles += st.saddleCycles; agg.multiPartSaddleCycles += st.multiPartSaddleCycles; agg.parts += st.parts;
    const P = G.fromPixelLoops(SBTrace.trace(m, w, h), s, s, o, o);
    const raw = G.unionRaw(P, []);
    agg.rawRingsWithRepeat += raw.filter((p) => new Set(p.map((q) => q.x + "," + q.y)).size !== p.length).length;
    const cp = clipperPairing(raw); agg.clipperShared += cp.vertices; agg.clipperSeparating += cp.separating; agg.clipperJoining += cp.joining;
    G.D3.mode = "rechain"; const polys = G.union(P, []);
    const or = checkPartsAgainstRaster(polys, m, w, h, s, o);
    if (!or.ok) { agg.rechainOracleFail++; if (!agg.firstFail) agg.firstFail = { rows: rowsOf(m, w, h), reasons: or.reasons.slice(0, 3) }; }
    if (!G.validate(polys).ok) agg.validateFail++;
    let nc; try { nc = G.components(polys).length; } catch { nc = -1; } if (nc !== or.parts) agg.componentsMismatch++;
    if (polys.some((p) => !G.interiorConnected(p))) agg.notInteriorConnected++;
    G.D3.mode = "split"; const sp = G.union(P, []); G.D3.mode = "rechain";
    const os = checkPartsAgainstRaster(sp, m, w, h, s, o); if (!os.ok) { agg.splitOracleFail++;
      if (sp.some((p) => !G.interiorConnected(p))) agg.splitMultipartDetected++;
      if (sp.length !== or.parts) agg.splitMultipartUndetectedByOldComponents++; }
  }
  agg.d3stats = { ...G.D3.stats };
  summary[name] = agg;
  console.log(`  ${name}: masks ${agg.masks}, saddles ${agg.saddles}, saddle cycles ${agg.saddleCycles} (multi-part ${agg.multiPartSaddleCycles}), parts ${agg.parts}`);
  console.log(`     Clipper2 raw: rings with repeated vertex ${agg.rawRingsWithRepeat}; shared-vertex continuations separating ${agg.clipperSeparating} / joining ${agg.clipperJoining}`);
  console.log(`     split-only: oracle failures ${agg.splitOracleFail} masks (all caught by interiorConnected: ${agg.splitMultipartDetected === agg.splitOracleFail})`);
  check(`${name}: re-chain → bijection with raster 4-components (pixel-exact) in ${agg.masks}/${agg.masks}`, agg.rechainOracleFail === 0, JSON.stringify(agg.firstFail));
  check(`${name}: validate ok, components() == raster count, every polygon interior-connected`, agg.validateFail === 0 && agg.componentsMismatch === 0 && agg.notInteriorConnected === 0,
    JSON.stringify({ v: agg.validateFail, c: agg.componentsMismatch, i: agg.notInteriorConnected }));
  check(`${name}: re-chain invariants (degrees balanced, bijective pairing, split never yields 2 outers or an outer from a hole)`,
    agg.d3stats.degreeMismatch === 0 && agg.d3stats.badClose === 0 && agg.d3stats.splitTwoPositive === 0 && agg.d3stats.splitNegativeGotPositive === 0, JSON.stringify(agg.d3stats));
}
const tot = (k) => Object.values(summary).reduce((a, s) => a + s[k], 0);
check("sweeps exercise saddle cycles (multi-part cycle rank > 0 in total)", tot("multiPartSaddleCycles") > 1000, String(tot("multiPartSaddleCycles")));
check("characterization: split-only rule fails the oracle on some masks (F1 is real)", tot("splitOracleFail") > 0);

console.log("\nD3 (F1) — named cases");
{
  const art = (rows) => F.art(rows);
  const cyc = art(["##.#.", "#.###", "##.##", "###.."]);
  const raw = G.unionRaw(G.fromPixelLoops(SBTrace.trace(cyc.m, cyc.w, cyc.h), 1000, 1000, 0, 0), []);
  const rep = raw.length === 1 ? raw[0].map((q) => q.x + "," + q.y).filter((k, i, a) => a.indexOf(k) !== i) : [];
  check("F1 mechanism: Clipper2 returns ONE ring (no hole) with 3 repeated vertices for ##.#./#.###/##.##/###..", raw.length === 1 && rep.length === 3, JSON.stringify(rep));
  const cp = clipperPairing(raw);
  check("F1 mechanism: Clipper2 pairs 2 of the 3 touch vertices separating and 1 joining (mixed)", cp.vertices === 3 && cp.joining === 2 && cp.separating === 4, JSON.stringify(cp));
  G.D3.mode = "split"; const sp = G.union(G.fromPixelLoops(SBTrace.trace(cyc.m, cyc.w, cyc.h), 1000, 1000, 0, 0), []); G.D3.mode = "rechain";
  check("F1: split-only gives 1 polygon + 2 holes (it FLIPS the pairing at each split vertex) and interiorConnected detects it", sp.length === 1 && sp[0].holes.length === 2 && !G.interiorConnected(sp[0]));
  check("F1: validate() of the split-only result reports GEO_MULTIPART", G.validate(sp).errors.some((e) => e.code === "GEO_MULTIPART"));
  let threw = false; try { G.components(sp); } catch { threw = true; } check("F1: components() refuses a multi-part polygon (GEO_MULTIPART_POLYGON)", threw);
  const ok = pipe(cyc.m, cyc.w, cyc.h); check("F1: re-chain gives 2 polygons, oracle ok", checkPartsAgainstRaster(ok, cyc.m, cyc.w, cyc.h, 1000, 0).ok && ok.length === 2);
  const named = {
    holeHoleSaddle: [["######", "#.####", "##.###", "######"], 1, 2], holeOuterSaddle: [["####.", "###.#", "#####"], 1, 1],
    ringOfFourDiagonal: [[".###.", "#...#", "#...#", ".###."], 4, 0], checker8: [Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => ((x + y) & 1 ? "." : "#")).join("")), 32, 0],
    islandInHoleDiag: [["#####", "#...#", "#.#.#", "#...#", "#####"], 2, 1], islandTouchingHoleCorner: [["#####", "##..#", "#.#.#", "#...#", "#####"], 2, 1],
  };
  for (const [k, [rows, parts, holes]] of Object.entries(named)) { const a = art(rows), p = pipe(a.m, a.w, a.h); const or = checkPartsAgainstRaster(p, a.m, a.w, a.h, 1000, 0);
    check(`${k}: ${parts} part(s), ${holes} hole ring(s), oracle + validate ok`, or.ok && p.length === parts && p.reduce((s, q) => s + q.holes.length, 0) === holes && G.validate(p).ok,
      JSON.stringify({ n: p.length, holes: p.map((q) => q.holes.length), r: or.reasons.slice(0, 2), v: G.validate(p).errors.slice(0, 2) })); }
}

console.log("\nD3 — non-raster contacts (T-contacts need noding)");
{
  const A = { outer: [0, 0, 300, 0, 300, 100, 0, 100], holes: [] };
  const B = { outer: [50, 100, 100, 200, 200, 200, 250, 100, 280, 300, 20, 300], holes: [] }; // spikes touch A's bottom edge at x = 50, 250
  const u = G.union([A], [B]);
  check("two parts touching at TWO T-contacts (vertex on edge interior) stay 2 polygons", u.length === 2 && u.every((p) => G.interiorConnected(p)), JSON.stringify(u));
  check("…and validate ok", G.validate(u).ok, JSON.stringify(G.validate(u).errors));
  const sq = { outer: [0, 0, 200, 0, 200, 200, 0, 200], holes: [] }, tri = { outer: [100, 0, 150, 100, 50, 100], holes: [] }; // apex on the top edge
  const d = G.difference([sq], [tri]);
  check("difference(square, triangle touching its edge from inside): 1 part, interior-connected, validates", d.length === 1 && G.interiorConnected(d[0]) && G.validate(d).ok, JSON.stringify(d) + JSON.stringify(G.validate(d).errors));
  const ring = { outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [[100, 100, 100, 200, 200, 200, 200, 100]] };
  const island = { outer: [100, 150, 150, 100, 200, 150, 150, 200], holes: [] }; // diamond touching the hole's 4 edges at their midpoints
  const ui = G.union([ring], [island]);
  check("island diamond touching all 4 hole edges at T-contacts: 2 parts (frame with 4 holes is NOT produced)", ui.length === 2 && ui.every((p) => G.interiorConnected(p)) && G.validate(ui).ok,
    JSON.stringify(ui.map((p) => [p.outer.length / 2, p.holes.length])));
}

{ // interiorConnected must see T-contacts: two triangular holes whose apexes touch the outer's top edge INTERIOR and which
  // share a vertex enclose the triangle (100,0)-(200,0)-(150,100) → the interior is in two pieces.
  const p = { outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [[100, 0, 50, 100, 150, 100], [200, 0, 150, 100, 250, 100]] };
  check("interiorConnected: cycle closed through T-contacts on the outer edge → disconnected (noding required)", !G.interiorConnected(p));
  check("validate: that polygon reports GEO_MULTIPART and no GEO_SELF_INTERSECT", G.validate([p]).errors.map((e) => e.code).join() === "GEO_MULTIPART", JSON.stringify(G.validate([p]).errors));
  const q = { outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [[100, 0, 50, 100, 150, 100], [200, 50, 150, 150, 250, 150]] };
  check("interiorConnected: a single T-contact hole (no cycle) stays connected", G.interiorConnected(q) && G.validate([q]).ok, JSON.stringify(G.validate([q]).errors));
  const x = { outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [[100, 50, 200, 50, 200, 150, 100, 150].reverse().reduce((a, v, i, arr) => (i % 2 ? a : a.concat([arr[i + 1], v])), []), [150, 100, 250, 100, 250, 200, 150, 200].reverse().reduce((a, v, i, arr) => (i % 2 ? a : a.concat([arr[i + 1], v])), [])] };
  check("validate: overlapping holes are GEO_SELF_INTERSECT", G.validate([x]).errors.some((e) => e.code === "GEO_SELF_INTERSECT"));
}

console.log(`\n${pass} passed, ${fail} failed`);
import("node:fs").then((fs) => fs.writeFileSync(new URL("./results_d3.json", import.meta.url), JSON.stringify({ env: { node: process.version, quick: QUICK }, summary }, null, 1)));
process.exitCode = fail ? 1 : 0;
