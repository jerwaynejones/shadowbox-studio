// spikes/S5/s5_inset.mjs — finite-width contact test (D3 / Appendix B.3 / G2.7) against EXACT oracles.
//   node spikes/S5/s5_inset.mjs [--quick]       (writes spikes/S5/results_inset.json)
// survives(I, d) ⇔ r*(I) ≥ d (r* = radius of the largest disk in I; contact width w = 2 r*).
// Exact oracles (BigInt, no floating point in the verdict):
//   parallelogram A,u,v:      r* = min(h_u, h_v)/2  ⇔  r* ≥ d  ⇔  cross(u,v)² ≥ 4 d² max(|u|², |v|²)
//   axis rectangle w×L:       r* = min(w, L)/2
//   L-shape, both arms w:     r* = (2 − √2) w  (disk wedged in the corner, touching the reflex vertex)  ⇔ (2w − d)² ≥ 2w², 2w ≥ d
//   plus-shape, arms w:       r* = w/√2        (disk touching the four reflex vertices)                 ⇔ w² ≥ 2 d²
// Practical non-convex cases (intersections of random star polygons) use a sampled lower bound r_lb ≤ r* instead.
import * as G from "./geom_s5.mjs";
import { F } from "./load_repo.mjs";
const C = G.Clipper;
const QUICK = process.argv.includes("--quick");
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  " + extra : "")); } };
const B = (v) => BigInt(v);
const rat = (d) => [B(Math.round(d * 1024)), 1024n];
const poly = (flat) => { const f = G.shoe(flat) < 0 ? rev(flat) : flat; return [{ outer: f, holes: [] }]; };
const rev = (f) => { const o = []; for (let i = f.length - 2; i >= 0; i -= 2) o.push(f[i], f[i + 1]); return o; };
const R = { env: { node: process.version, quick: QUICK } };

/** The PREVIOUS spike method (for the record): miter inset of −d·scale at ×scale, "survives" if any area remains. */
const oldSurvives = (I, d, s) => { const up = []; for (const p of I) up.push(p.outer.reduce((a, v, i, f) => (i % 2 ? a : a.concat([{ x: f[i] * s, y: f[i + 1] * s }])), []));
  return C.inflatePaths(up, -d * s, C.JoinType.Miter, C.EndType.Polygon, 2).some((p) => Math.abs(C.area(p)) > 0); };

function runFamily(name, cases, scales = [4, 16, 64]) {
  const agg = { cases: cases.length, truth: 0, wrongSurvive: 0, wrongFail: 0, undecided: 0, maxUndecidedGapGridUnits: 0, crossScaleContradictions: 0, old: {} };
  for (const s of scales) agg.old["x" + s] = { wrongSurvive: 0, wrongFail: 0 };
  agg.oldCrossScaleDisagree = 0; agg.byScale = Object.fromEntries(scales.map((s) => ["x" + s, { undecided: 0 }]));
  for (const c of cases) {
    if (c.truth) agg.truth++;
    const st = {}; for (const s of scales) st[s] = G.insetStatus(c.I, c.d, { scale: s }).status;
    const def = G.insetStatus(c.I, c.d).status;
    for (const v of [def, ...Object.values(st)]) { if (v === "survives" && !c.truth) agg.wrongSurvive++; if (v === "fails" && c.truth) agg.wrongFail++; }
    if (def === "undecided") { agg.undecided++; const sDef = Math.max(16, Math.ceil(16 / c.d)); agg.maxUndecidedGapGridUnits = Math.max(agg.maxUndecidedGapGridUnits, Math.abs(c.r - c.d) * sDef);
      const k = c.truth ? "undecidedTrulySurvive" : "undecidedTrulyFail"; agg[k] = (agg[k] || 0) + 1;
      const g = c.truth ? "maxGapUmWhenTrulySurvive" : "maxGapUmWhenTrulyFail"; agg[g] = Math.max(agg[g] || 0, Math.abs(c.r - c.d)); }
    for (const s of scales) if (st[s] === "undecided") agg.byScale["x" + s].undecided++;
    const certain = Object.values(st).filter((v) => v !== "undecided"); if (new Set(certain).size > 1) agg.crossScaleContradictions++;
    const olds = scales.map((s) => oldSurvives(c.I, c.d, s));
    scales.forEach((s, i) => { if (olds[i] && !c.truth) agg.old["x" + s].wrongSurvive++; if (!olds[i] && c.truth) agg.old["x" + s].wrongFail++; });
    if (new Set(olds).size > 1) agg.oldCrossScaleDisagree++;
  }
  R[name] = agg;
  console.log(`  ${name}: ${agg.cases} cases (${agg.truth} truly survive); new: wrong-survive ${agg.wrongSurvive}, wrong-fail ${agg.wrongFail}, undecided ${agg.undecided} [r* ≥ d: ${agg.undecidedTrulySurvive || 0}, max r*−d ${(agg.maxGapUmWhenTrulySurvive || 0).toPrecision(3)} µm; r* < d: ${agg.undecidedTrulyFail || 0}, max d−r* ${(agg.maxGapUmWhenTrulyFail || 0).toPrecision(3)} µm; max ${agg.maxUndecidedGapGridUnits.toFixed(2)} grid units], cross-scale contradictions ${agg.crossScaleContradictions}`);
  console.log(`     previous method: ${scales.map((s) => `×${s} wrong-survive ${agg.old["x" + s].wrongSurvive} / wrong-fail ${agg.old["x" + s].wrongFail}`).join("; ")}; ×4/×16/×64 disagree on ${agg.oldCrossScaleDisagree}`);
  check(`${name}: no certified verdict is wrong (survives ⇒ r* ≥ d, fails ⇒ r* < d) at default, ×4, ×16, ×64`, agg.wrongSurvive === 0 && agg.wrongFail === 0, JSON.stringify(agg));
  return agg;
}

console.log("\nfinite-width contact — exact oracles");
const D_LIST = [0.25, 1500, 1.5, 7];
{ // parallelograms near the threshold
  const cases = [];
  for (const d of D_LIST) { const r = F.lcg(Math.round(d * 1000) + 17), N = QUICK ? 150 : 600;
    for (let i = 0; i < N; i++) {
      const len = 200 + r() * 20000, th = r() * Math.PI * 2, a = Math.round(len * Math.cos(th)), b = Math.round(len * Math.sin(th)); if (!a && !b) continue;
      const L = Math.hypot(a, b), h = Math.max(0.05, 2 * d + (r() * 2 - 1) * Math.max(1, 0.002 * d)), t = (r() - 0.5) * L;
      const vx = Math.round((-b / L) * h + (a / L) * t * 0.5), vy = Math.round((a / L) * h + (b / L) * t * 0.5);
      const cr = B(a) * B(vy) - B(b) * B(vx); if (cr === 0n) continue;
      const [dn, dd] = rat(d), uu = B(a * a + b * b), vv = B(vx * vx + vy * vy), mx = uu > vv ? uu : vv;
      const truth = cr * cr * dd * dd >= 4n * dn * dn * mx;
      const rr = Math.abs(Number(cr)) / (2 * Math.sqrt(Number(mx)));
      const x0 = Math.floor(r() * 1e6), y0 = Math.floor(r() * 7e5);
      cases.push({ I: poly([x0, y0, x0 + a, y0 + b, x0 + a + vx, y0 + b + vy, x0 + vx, y0 + vy]), d, truth, r: rr });
    } }
  runFamily("parallelograms (d = 0.25, 1.5, 7, 1500 µm; heights within ±max(1 µm, 0.2%) of 2d)", cases);
}
{ // axis rectangles incl. exact ties
  const cases = [];
  for (const [w, d] of [[1, 0.25], [2, 0.25], [1, 0.5], [2999, 1500], [3000, 1500], [3001, 3001 / 2], [3, 1.5], [14, 7], [13, 7]])
    for (const L of [w, 10000]) { const x0 = 12345, y0 = 678; cases.push({ I: poly([x0, y0, x0 + w, y0, x0 + w, y0 + L, x0, y0 + L]), d, truth: Math.min(w, L) >= 2 * d, r: Math.min(w, L) / 2 }); }
  const a = runFamily("axis rectangles incl. ties (w = 2d exactly)", cases);
  check("axis rectangles: ties w = 2d are certified SURVIVES (not undecided)", a.undecided === 0, JSON.stringify(a));
}
{ // diagonal slivers (the old characterization's case): I = A ∩ B is a parallelogram of normal width k/√2
  const cases = [];
  for (const k of [1, 2, 3]) { const A = [{ outer: [0, 0, 100000, 0, 0, 100000], holes: [] }], Bp = [{ outer: [100000 - k, 0, 100000 - k, 100000, -k, 100000], holes: [] }];
    const I = G.intersection(A, Bp); for (const d of [0.25, 0.5, 1]) cases.push({ I, d, truth: k * k * 1024 * 1024 >= 8 * Math.round(d * 1024) ** 2, r: k / (2 * Math.SQRT2) }); }
  runFamily("diagonal slivers k = 1..3 µm (normal width k/√2)", cases);
}
{ // L-shapes and plus-shapes: r* bound by REFLEX vertices (where a miter inset is conservative)
  const Lc = [], Pc = [];
  for (const d of [7, 100, 1500]) { const wL = (2 + Math.SQRT2) * d / 2, wP = d * Math.SQRT2; // thresholds: (2−√2)w = d ⇒ w = d/(2−√2)
    for (let dw = -3; dw <= 3; dw++) for (const rot of [0, 1, 2, 3]) {
      const w = Math.max(1, Math.round(wL) + dw), A = 4 * w; // L: arms w wide, 4w long
      let f = [0, 0, A, 0, A, w, w, w, w, A, 0, A];
      for (let k = 0; k < rot; k++) { const g = []; for (let i = 0; i < f.length; i += 2) g.push(-f[i + 1], f[i]); f = g; }
      f = f.map((v, i) => v + (i % 2 ? 50000 : 90000));
      const [dn, dd] = rat(d), W = B(w), lhs = 2n * W * dd - dn; Lc.push({ I: poly(f), d, truth: lhs >= 0n && lhs * lhs >= 2n * W * W * dd * dd, r: (2 - Math.SQRT2) * w });
      const p = Math.max(1, Math.round(wP) + dw), h = Math.floor(p / 2), q = p - h, M = 3 * p; // plus: arm width p, extent ±M
      const g = [-h, -M, q, -M, q, -h, M, -h, M, q, q, q, q, M, -h, M, -h, q, -M, q, -M, -h, -h, -h].map((v, i) => v + (i % 2 ? 40000 : 70000));
      Pc.push({ I: poly(g), d, truth: B(p) * B(p) * dd * dd >= 2n * dn * dn, r: p / Math.SQRT2 });
    } }
  // NOTE: L/plus with an arm width w only differ by translation/rotation; duplicates are harmless.
  R.L = runFamily("L-shapes (r* = (2−√2)w, reflex-bound)", Lc); R.plus = runFamily("plus-shapes (r* = w/√2, reflex-bound)", Pc);
}

console.log("\nfinite-width contact — practical non-convex intersections (sampled lower bound r_lb ≤ r*)");
{
  const star = (r, cx, cy, R0, n) => { const f = []; for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n, rr = R0 * (0.55 + 0.45 * r()); f.push(Math.round(cx + rr * Math.cos(t)), Math.round(cy + rr * Math.sin(t))); } return f; };
  const distSeg = (px, py, ax, ay, bx, by) => { const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey; let t = L ? ((px - ax) * ex + (py - ay) * ey) / L : 0; t = Math.max(0, Math.min(1, t)); const dx = ax + t * ex - px, dy = ay + t * ey - py; return Math.sqrt(dx * dx + dy * dy); };
  const inRings = (rings, x, y) => { let ins = false; for (const r of rings) { const n = r.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } } return ins; };
  const depth = (rings, x, y) => { if (!inRings(rings, x, y)) return -1; let m = Infinity; for (const r of rings) { const n = r.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) m = Math.min(m, distSeg(x, y, r[2 * j], r[2 * j + 1], r[2 * i], r[2 * i + 1])); } return m; };
  const rlb = (I) => { const rings = I.flatMap((p) => [p.outer, ...p.holes]); let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity; for (const r of rings) { const b = G.bbox(r); X0 = Math.min(X0, b[0]); Y0 = Math.min(Y0, b[1]); X1 = Math.max(X1, b[2]); Y1 = Math.max(Y1, b[3]); }
    let best = -1, bx = 0, by = 0; const N = 60; for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) { const x = X0 + ((X1 - X0) * i) / N, y = Y0 + ((Y1 - Y0) * j) / N, v = depth(rings, x, y); if (v > best) { best = v; bx = x; by = y; } }
    let step = Math.max(X1 - X0, Y1 - Y0) / N; while (step > 1e-4) { let moved = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const v = depth(rings, bx + dx * step, by + dy * step); if (v > best) { best = v; bx += dx * step; by += dy * step; moved = true; } } if (!moved) step /= 2; }
    return best; };
  const agg = { cases: 0, survives: 0, fails: 0, undecided: 0, failsButRlbAtLeastD: 0, witnessFloatViolations: 0, undecidedMaxRlbMinusD: -Infinity };
  const r = F.lcg(4242), N = QUICK ? 60 : 250;
  for (let i = 0; i < N; i++) {
    const s1 = star(r, 5000, 5000, 3000 + r() * 2000, 7 + Math.floor(r() * 9)), s2 = star(r, 5000 + (r() - 0.5) * 6000, 5000 + (r() - 0.5) * 6000, 3000 + r() * 2000, 7 + Math.floor(r() * 9));
    const I = G.intersection(poly(s1), poly(s2)); if (G.isEmpty(I)) continue;
    const lb = rlb(I); const d = Math.max(0.25, Math.round(lb * (0.97 + 0.06 * r()) * 4) / 4); // dyadic d near r_lb
    const res = G.insetStatus(I, d); agg.cases++; agg[res.status]++;
    if (res.status === "fails" && lb >= d) agg.failsButRlbAtLeastD++;
    if (res.status === "survives") { const { X, Y, q } = res.witness, rings = I.flatMap((p) => [p.outer, ...p.holes]); if (depth(rings, X / q, Y / q) < d * (1 - 1e-12)) agg.witnessFloatViolations++; }
    if (res.status === "undecided") agg.undecidedMaxRlbMinusD = Math.max(agg.undecidedMaxRlbMinusD, lb - d);
  }
  R.practical = agg;
  console.log("  " + JSON.stringify(agg));
  check("practical: every SURVIVES witness re-checks in floating point; no FAILS where r_lb ≥ d", agg.witnessFloatViolations === 0 && agg.failsButRlbAtLeastD === 0, JSON.stringify(agg));
}

console.log("\nG2.7 classification with the B.3 thresholds (block: width < 0.5 µm; warn: width < minFeatureUm)");
{
  const lower = [{ outer: [0, 0, 10000, 0, 10000, 10000, 0, 10000], holes: [] }];
  const I = (x0) => G.intersection([{ outer: [x0, 0, 20000, 0, 20000, 10000, x0, 10000], holes: [] }], lower);
  const cl = (x0) => G.classifyContact(I(x0), 3000).level;
  check("point / edge contact → intersection empty → block", G.isEmpty(G.intersection([{ outer: [10000, 10000, 20000, 10000, 20000, 20000, 10000, 20000], holes: [] }], lower)) && cl(10000) === "block");
  check("1 µm axis overlap (width 1 ≥ 0.5) → warn, not block", cl(9999) === "warn");
  check("2999 µm overlap → warn (SUPPORT_NARROW)", cl(10000 - 2999) === "warn");
  check("3000 µm overlap (= minFeature, a tie) → ok", cl(7000) === "ok");
  const sl = (k) => G.intersection([{ outer: [0, 0, 100000, 0, 0, 100000], holes: [] }], [{ outer: [100000 - k, 0, 100000 - k, 100000, -k, 100000], holes: [] }]);
  check("diagonal sliver, normal width 0.707 µm → warn (not block)", G.classifyContact(sl(1), 3000).level === "warn");
  const thin = poly([0, 0, 10000, 3, 10000, 4, 0, 1]); // parallelogram, r* = 10000/(2·|(10000,3)|) ≈ 0.49999978 → width ≈ 1 µm
  const tri = poly([0, 0, 10000, 0, 10000, 1]); // inradius = area/semiperimeter ≈ 0.49997 → width ≈ 1 µm
  const needle = poly([0, 0, 20001, 1, 20000, 1]); // area 0.5 µm², inradius ≈ 2.5e-5 µm → width ≪ 0.5 µm
  check("needle triangle 20000×1 µm (inradius < 0.25) → block", G.classifyContact(needle, 3000).level === "block", JSON.stringify(G.insetStatus(needle, 0.25)));
  check("thin parallelogram (height ≈ 1 µm) → warn; right triangle 10000×1 → warn", G.classifyContact(thin, 3000).level === "warn" && G.classifyContact(tri, 3000).level === "warn");
}

console.log("\nF4 — Clipper2 Paths64 offset at sub-µm deltas (characterization)");
{
  const P = (f) => { const p = []; for (let i = 0; i < f.length; i += 2) p.push({ x: f[i], y: f[i + 1] }); return p; };
  const inf = (f, d) => C.inflatePaths([P(f)], d, C.JoinType.Miter, C.EndType.Polygon, 2).map((p) => p.map((q) => [q.x, q.y]));
  const rect = [0, 0, 4000, 0, 4000, 10000, 0, 10000], Lsh = [0, 0, 3000, 0, 3000, 1000, 1000, 1000, 1000, 3000, 0, 3000], odd = [3, 7, 1003, 7, 1003, 2007, 3, 2007];
  const probe = {}; for (const [k, f] of Object.entries({ rect, Lsh, odd, tri: [0, 0, 1000, 0, 0, 1000], diamond: [500, 0, 1000, 500, 500, 1000, 0, 500] }))
    for (const o of ["pos", "neg"]) for (const d of [-0.49, -0.5, -0.51, -1.5]) { const ff = o === "pos" ? f : rev(f); const out = inf(ff, d); probe[`${k}/${o}/${d}`] = { rings: out.length, area: out.reduce((a, p) => a + C.area(p.map(([x, y]) => ({ x, y }))), 0) }; }
  R.clipperOffsetProbe = probe;
  check("|delta| < 0.5 is a no-op (input returned unchanged)", JSON.stringify(inf(rect, -0.49)) === JSON.stringify([[[0, 0], [4000, 0], [4000, 10000], [0, 10000]]]));
  check("delta −0.5, positive rect → [] ; reversed rect → shrinks 1 µm on two sides only", inf(rect, -0.5).length === 0 && JSON.stringify(inf(rev(rect), -0.5)) === "[[[4000,1],[1,1],[1,10000],[4000,10000]]]");
  check("delta −0.5, positive L-shape → a WRONG polygon of about half the area (2,497,000.5 of 5,000,000 µm²)", Math.abs(probe["Lsh/pos/-0.5"].area) === 2497000.5);
  check("delta −0.5, triangle → correct ~1 µm shrink; diamond → unchanged (rounds back)", probe["tri/pos/-0.5"].area === 498002 && probe["diamond/pos/-0.5"].area === 500000);
  check("delta −1.5 shrinks 2 µm on two sides and 1 µm on the other two (round-half-up)", JSON.stringify(inf(rect, -1.5)) === "[[[3999,2],[3999,9999],[2,9999],[2,2]]]");
  let t1 = false; try { G.offset([{ outer: rect, holes: [] }], -0.5, "miter"); } catch (e) { t1 = e.message === "GEO_OFFSET_NONINTEGER"; }
  check("adapter offset() refuses non-integer deltas (GEO_OFFSET_NONINTEGER)", t1);
}

console.log(`\n${pass} passed, ${fail} failed`);
import("node:fs").then((fs) => fs.writeFileSync(new URL("./results_inset.json", import.meta.url), JSON.stringify(R, null, 1)));
process.exitCode = fail ? 1 : 0;
