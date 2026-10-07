// spikes/S5/s5_extra_checks.mjs — checks proposed by S5 for G1.1 / G1.3 / G2.7 (to be ported into test/run_tests.js
// once js/geom.js lands). Runs here against the spike adapter.   node spikes/S5/s5_extra_checks.mjs
import { F, SBTrace } from "./load_repo.mjs";
import * as G from "./geom_s5.mjs";
import { checkPartsAgainstRaster, saddleStats } from "./oracle_raster.mjs";
const SBGeom = G.SBGeom;
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } };
const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] });
const pipe = (m, w, h) => SBGeom.union(SBGeom.fromPixelLoops(SBTrace.trace(m, w, h), 1000, 1000, 0, 0), []);

console.log("\nspike S5 — extra: one polygon per part after union (D3: re-pair at shared vertices, then split)");
{
  // Two 4-components touching at THREE saddle points. Clipper2's union returns ONE ring (no holes) that passes through all
  // three points, pairing edges separating at two of them and joining at one. Splitting at repeated vertices flips the
  // pairing at each split point and yields 1 polygon + 2 holes whose interior is in two pieces. Re-pairing every shared
  // vertex with the material-separating (right-most) turn before splitting yields the 2 parts.
  const m = F.art(["##.#.", "#.###", "##.##", "###.."]);
  const raw = SBGeom.unionRaw(SBGeom.fromPixelLoops(SBTrace.trace(m.m, m.w, m.h), 1000, 1000, 0, 0), []);
  check("D3 (characterization) Clipper2 returns one ring with 3 repeated vertices", raw.length === 1 && new Set(raw[0].map((q) => q.x + "," + q.y)).size === raw[0].length - 3);
  const polys = pipe(m.m, m.w, m.h);
  check("D3 cyclic saddle contact: 2 polygons, each interior-connected, components() = 2", polys.length === 2 && polys.every(SBGeom.interiorConnected) && SBGeom.components(polys).length === 2);
  check("D3 cyclic saddle contact: pixel-exact bijection with raster 4-components", checkPartsAgainstRaster(polys, m.m, m.w, m.h, 1000, 0).ok);
  check("D3 cyclic saddle contact: validates", SBGeom.validate(polys).ok);
  G.D3.mode = "split"; const bad = pipe(m.m, m.w, m.h); G.D3.mode = "rechain";
  check("D3 (characterization) split-only normalize gives 1 polygon; validate() flags GEO_MULTIPART", bad.length === 1 && SBGeom.validate(bad).errors.some((e) => e.code === "GEO_MULTIPART"));
  const hh = F.art(["######", "#.####", "##.###", "######"]), p2 = pipe(hh.m, hh.w, hh.h);
  check("D3 hole–hole saddle: 1 part, 2 holes touching at a vertex, validates", p2.length === 1 && p2[0].holes.length === 2 && SBGeom.validate(p2).ok);
  const ho = F.art(["####.", "###.#", "#####"]), p3 = pipe(ho.m, ho.w, ho.h);
  check("D3 hole–outer saddle: 1 part, 1 hole touching the outer, validates", p3.length === 1 && p3[0].holes.length === 1 && SBGeom.validate(p3).ok);
  let ok = true, cyc = 0;
  for (let s = 1; s <= 200 && ok; s++) { const r = F.lcg(s), w = 20, h = 16, mm = new Uint8Array(w * h); for (let i = 0; i < mm.length; i++) mm[i] = r() < 0.55 ? 1 : 0;
    cyc += saddleStats(mm, w, h).multiPartSaddleCycles; ok = checkPartsAgainstRaster(pipe(mm, w, h), mm, w, h, 1000, 0).ok; }
  check(`D3 property (200 noise masks, ${cyc} multi-part saddle cycles): pixel-exact bijection with independent raster 4-components`, ok);
}

console.log("\nspike S5 — extra: frame union (GEO-02 / LYR-04 / AT-12)");
{
  const bt = F.MASKS.borderTouch;
  const frame = { outer: [0, 0, 100000, 0, 100000, 70000, 0, 70000], holes: [[10000, 10000, 10000, 60000, 90000, 60000, 90000, 10000]] };
  const polys = SBGeom.union(SBGeom.union(SBGeom.fromPixelLoops(SBTrace.trace(bt.layers[1], 8, 5), 10000, 10000, 10000, 10000), []), [frame]);
  check("LYR-04 frame ring ∪ edge-touching art is one material polygon", polys.length === 1);
  let seg = false; for (const p of polys) for (const r of [p.outer, ...p.holes]) for (let i = 0, n = r.length / 2; i < n; i++) { const j = (i + 1) % n;
    if (r[2 * i] === 10000 && r[2 * j] === 10000 && Math.min(r[2 * i + 1], r[2 * j + 1]) < 30000 && Math.max(r[2 * i + 1], r[2 * j + 1]) > 10000) seg = true; }
  check("GEO-02 FIXED: no ring edge on x = 10000 µm between y 10000..30000", !seg);
  check("AT-12 frame outer ring is the exact page rectangle", JSON.stringify(polys[0].outer) === "[0,0,100000,0,100000,70000,0,70000]");
}

console.log("\nspike S5 — extra: finite-width contact (D3 / Appendix B.3): width = 2·r*, block < 0.5 µm, warn < minFeatureUm");
{
  const lower = [sq(0, 0, 10000, 10000)];
  const I = (upper) => SBGeom.intersection([upper], lower);
  check("point contact: intersection empty → block", SBGeom.isEmpty(I(sq(10000, 10000, 20000, 20000))) && SBGeom.classifyContact(I(sq(10000, 10000, 20000, 20000)), 3000).level === "block");
  check("edge contact: intersection empty → block", SBGeom.isEmpty(I(sq(10000, 0, 20000, 10000))));
  check("(characterization) Clipper2 offset(−0.5) of a positive 4000×10000 rect returns [] but the reversed rect shrinks — orientation-dependent",
    G.Clipper.inflatePaths([[{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 10000 }, { x: 0, y: 10000 }]], -0.5, 0, 0, 2).length === 0 &&
    G.Clipper.inflatePaths([[{ x: 0, y: 10000 }, { x: 4000, y: 10000 }, { x: 4000, y: 0 }, { x: 0, y: 0 }]], -0.5, 0, 0, 2).length === 1);
  let threw = false; try { SBGeom.offset(lower, -0.5); } catch { threw = true; } check("SBGeom.offset refuses a sub-µm / non-integer delta", threw);
  check("B.3 1 µm axis overlap: width 1 µm ≥ 0.5 → not blocked (warn: below minFeature)", SBGeom.classifyContact(I(sq(9999, 0, 20000, 10000)), 3000).level === "warn");
  check("B.3 needle sliver (inradius 2.5e-5 µm) → block", SBGeom.classifyContact([{ outer: [0, 0, 20001, 1, 20000, 1], holes: [] }], 3000).level === "block");
  check("B.3 2999 µm overlap → SUPPORT_NARROW (warn)", SBGeom.classifyContact(I(sq(7001, 0, 20000, 10000)), 3000).level === "warn");
  check("B.3 3000 µm overlap (width = minFeature) → ok; the tie is certified, not undecided", SBGeom.classifyContact(I(sq(7000, 0, 20000, 10000)), 3000).level === "ok" && SBGeom.insetStatus(I(sq(7000, 0, 20000, 10000)), 1500).status === "survives");
  check("survivesInset is scale-independent where certified (×4, ×16, ×64 agree on the 2999/3000 pair)", [4, 16, 64].every((sc) => !SBGeom.survivesInset(I(sq(7001, 0, 20000, 10000)), 1500, { scale: sc }) && SBGeom.survivesInset(I(sq(7000, 0, 20000, 10000)), 1500, { scale: sc })));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
