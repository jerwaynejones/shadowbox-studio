// spikes/S5/s5_characterize.mjs — S5 characterization: trace saddles, Clipper2 union/normalize, frame union,
// finite-width contact thresholds, smoothing at the frame edge, and timing at fabrication size.
//   node spikes/S5/s5_characterize.mjs [--quick]      (writes spikes/S5/results.json)
import fs from "node:fs";
import path from "node:path";
import { F, SBTrace, SBMorph, SBSvg, ROOT } from "./load_repo.mjs";
import * as G from "./geom_s5.mjs";
import { checkPartsAgainstRaster, saddleStats } from "./oracle_raster.mjs";

const QUICK = process.argv.includes("--quick");
const R = { env: { node: process.version, date: new Date().toISOString(), quick: QUICK } };
const art = (rows) => F.art(rows);
const pipe = (m, w, h, s = 1000, o = 0) => G.union(G.fromPixelLoops(SBTrace.trace(m, w, h), s, s, o, o), []);
const comps4 = (m, w, h) => SBMorph.components(m, w, h, 1).count;
function bgEnclosed(m, w, h) { const c = SBMorph.components(m, w, h, 0); let n = 0; for (let i = 0; i < c.count; i++) if (!c.touchesBorder[i]) n++; return n; }
function saddles(m, w, h) { let n = 0; for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
  const a = m[y * w + x], b = m[y * w + x + 1], c = m[(y + 1) * w + x], d = m[(y + 1) * w + x + 1];
  if (a === d && b === c && a !== b) n++; } return n; }
const repeatsIn = (paths) => paths.filter((p) => new Set(p.map((q) => q.x + "," + q.y)).size !== p.length).length;
const comps = (polys) => { try { return G.components(polys).length; } catch { return -1; } }; // -1: a multi-part polygon (GEO_MULTIPART_POLYGON)
const codes = (v) => { const c = {}; for (const e of v.errors) c[e.code] = (c[e.code] || 0) + 1; if (v.touches.length) c["touch(info)"] = v.touches.length; return c; };
const holesOf = (polys) => polys.reduce((s, p) => s + p.holes.length, 0);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const ms = (t0) => Number((performance.now() - t0).toFixed(2));

// ------------------------------------------------------------------ A. saddle catalogue
const CAT = {
  diagonalTouch: { ...F.MASKS.diagonalTouch, m: F.MASKS.diagonalTouch.layers[1] },
  checker4: art(["#.#.", ".#.#", "#.#.", ".#.#"]),
  checker8: art(Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => ((x + y) & 1 ? "." : "#")).join(""))),
  holeHoleSaddle: art(["######", "#.####", "##.###", "######"]),
  holeOuterSaddle: art(["####.", "###.#", "#####"]),
  ringOfFourDiagonal: art([".###.", "#...#", "#...#", ".###."]),
  plusDiagonalChain: art(["#...", ".#..", "..#.", "...#"]),
  donutIsland: { ...F.MASKS.donutIsland, m: F.MASKS.donutIsland.layers[1] },
};
R.catalogue = {};
for (const [k, v] of Object.entries(CAT)) { console.error("[s5] cat", k);
  const { m, w, h } = v, loops = SBTrace.trace(m, w, h);
  const raw = G.unionRaw(G.fromPixelLoops(loops, 1000, 1000, 0, 0), []);
  const polys = G.normalize(G.union(G.fromPixelLoops(loops, 1000, 1000, 0, 0), []));
  const val = G.validate(polys);
  R.catalogue[k] = { w, h, saddles: saddles(m, w, h), traceLoops: loops.length, traceLoopsWithRepeatedCorner: loops.filter((L) => new Set(L.map((p) => p.join())).size !== L.length).length,
    clipperRawPaths: raw.length, clipperRawPathsWithRepeatedVertex: repeatsIn(raw), polygons: polys.length, holes: holesOf(polys),
    components: comps(polys), rasterOracleOk: checkPartsAgainstRaster(polys, m, w, h, 1000, 0).ok, morph4Components: comps4(m, w, h), enclosedBg4: bgEnclosed(m, w, h),
    areaOk: G.area(polys) === m.reduce((a, b) => a + b, 0) * 1e6, validateOk: val.ok, validateCodes: codes(val) };
}

console.error("[s5] reached // ------------------------------------------------------------------ B. at", (performance.now()/1000).toFixed(1)+"s");
// ------------------------------------------------------------------ B. property sweep (random masks)
function noise(rng, w, h, p) { const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = rng() < p ? 1 : 0; return m; }
R.sweep = {};
for (const mode of ["split", "rechain"]) { G.D3.mode = mode; G.resetStats();
for (const [name, gen, seeds] of [
  ["noise24_p0.5", (s) => ({ m: noise(F.lcg(s), 24, 24, 0.5), w: 24, h: 24 }), QUICK ? 100 : 1000],
  ["noise64_p0.35", (s) => ({ m: noise(F.lcg(1e4 + s), 64, 64, 0.35), w: 64, h: 64 }), QUICK ? 50 : 300],
  ["noise64_p0.65", (s) => ({ m: noise(F.lcg(2e4 + s), 64, 64, 0.65), w: 64, h: 64 }), QUICK ? 50 : 300],
  ["nested120x90x6_layers", (s) => s, 20],
]) {
  const agg = { masks: 0, saddles: 0, traceLoopsWithRepeatedCorner: 0, rawPathsWithRepeatedVertex: 0, compMismatch: 0, areaMismatch: 0,
    validateFail: 0, codes: {}, holeVsEnclosedBgMismatch: 0, holesTotal: 0, enclosedBgTotal: 0 };
  const masks = [];
  for (let s = 1; s <= seeds; s++) {
    if (name.startsWith("nested")) { const st = F.randomNestedStack(F.lcg(s), 120, 90, 6); st.forEach((m, k) => k > 0 && masks.push({ m, w: 120, h: 90 })); }
    else masks.push(gen(s));
  }
  for (const { m, w, h } of masks) {
    agg.masks++; agg.saddles += saddles(m, w, h);
    const loops = SBTrace.trace(m, w, h);
    agg.traceLoopsWithRepeatedCorner += loops.filter((L) => new Set(L.map((p) => p.join())).size !== L.length).length;
    agg.rawPathsWithRepeatedVertex += repeatsIn(G.unionRaw(G.fromPixelLoops(loops, 1000, 1000, 0, 0), []));
    const polys = G.union(G.fromPixelLoops(loops, 1000, 1000, 0, 0), []);
    if (comps(polys) !== comps4(m, w, h)) agg.compMismatch++;
    if (!checkPartsAgainstRaster(polys, m, w, h, 1000, 0).ok) agg.rasterOracleFail = (agg.rasterOracleFail || 0) + 1;
    agg.multiPartSaddleCycles = (agg.multiPartSaddleCycles || 0) + saddleStats(m, w, h).multiPartSaddleCycles;
    if (G.area(polys) !== m.reduce((a, b) => a + b, 0) * 1e6) agg.areaMismatch++;
    { // per-part check: multiset of polygon areas == multiset of 4-connected component areas (each part is exactly one component)
      const pa = polys.map((p) => G.area([p]) / 1e6).sort((a, b) => a - b), ca = [...SBMorph.components(m, w, h, 1).areas].sort((a, b) => a - b);
      if (pa.join() !== ca.join()) agg.partAreaMismatch = (agg.partAreaMismatch || 0) + 1; else agg.partAreaMatch = (agg.partAreaMatch || 0) + 1; }
    const v = G.validate(polys); if (!v.ok) agg.validateFail++;
    for (const [c, n] of Object.entries(codes(v))) agg.codes[c] = (agg.codes[c] || 0) + n;
    if (!v.ok && !agg.firstFail) agg.firstFail = { w, h, rows: Array.from({ length: h }, (_, y) => [...m.slice(y * w, y * w + w)].map((q) => (q ? "#" : ".")).join("")).join("/"), errors: v.errors.slice(0, 4) };
    const hh = holesOf(polys), eb = bgEnclosed(m, w, h); agg.holesTotal += hh; agg.enclosedBgTotal += eb; if (hh !== eb) agg.holeVsEnclosedBgMismatch++;
  }
  R.sweep[mode + ":" + name] = agg;
}
R.sweep[mode + ":D3stats"] = { ...G.D3.stats };
}
G.D3.mode = "rechain";

console.error("[s5] reached // ------------------------------------------------------------------ C. at", (performance.now()/1000).toFixed(1)+"s");
// ------------------------------------------------------------------ C. frame union (GEO-02 / LYR-04 / AT-12)
const frameRing = (wUm, hUm, fUm) => [{ outer: [0, 0, wUm + 2 * fUm, 0, wUm + 2 * fUm, hUm + 2 * fUm, 0, hUm + 2 * fUm],
  holes: [[fUm, fUm, fUm, fUm + hUm, fUm + wUm, fUm + hUm, fUm + wUm, fUm]] }];
function withFrame(m, w, h, sUm, fUm, loopsOverride) {
  const loops = loopsOverride || SBTrace.trace(m, w, h);
  return G.union(G.union(G.fromPixelLoops(loops, sUm, sUm, fUm, fUm), []), frameRing(w * sUm, h * sUm, fUm));
}
R.frame = {};
{ // the KNOWN-DEFECT GEO-02 setup: borderTouch, 10 mm/px, frame 10 mm
  const bt = F.MASKS.borderTouch, m = bt.layers[1];
  const polys = withFrame(m, bt.w, bt.h, 10000, 10000);
  let seg = false; for (const p of polys) for (const r of [p.outer, ...p.holes]) { const n = r.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (r[2 * i] === 10000 && r[2 * j] === 10000 && Math.min(r[2 * i + 1], r[2 * j + 1]) < 30000 && Math.max(r[2 * i + 1], r[2 * j + 1]) > 10000) seg = true; } }
  const legacy = SBSvg.sheetSVG({ pxW: 8, pxH: 5, widthMM: 80, marginMM: 10, holes: false, holeDiaMM: 3, label: "t", loops: SBTrace.trace(m, 8, 5), isBacking: false });
  R.frame.borderTouch_10mmpx = { polygons: polys.length, outerVertices: polys[0].outer.length / 2, outerRing: polys[0].outer, holes: holesOf(polys),
    G1_3_check_noEdgeOnFrameLine: !seg, legacyStillHasDefectSegment: legacy.includes("M 10 10 L 10 30"),
    AT12_outerIsPageRect: JSON.stringify(polys[0].outer) === JSON.stringify([0, 0, 100000, 0, 100000, 70000, 0, 70000]) || null, validate: codes(G.validate(polys)) };
  R.frame.AT12_note = "outer ring compared to [0,0,100000,0,100000,70000,0,70000] after normalize (start at min vertex, positive Y-down)";
}
{ // fixtures with frame on, and random sweep: components == 1 + #4-components not touching the art border
  const fx = {}; for (const k of ["donutIsland", "crescent", "crescentInterior", "borderTouch", "lowerHoleUnderPart", "orientationF", "diagonalTouch", "looseBridge"]) {
    const st = F.MASKS[k]; const out = [];
    st.layers.forEach((m, li) => { const c = SBMorph.components(m, st.w, st.h, 1); let inner = 0; for (let i = 0; i < c.count; i++) if (!c.touchesBorder[i]) inner++;
      const polys = withFrame(m, st.w, st.h, 250, 10000); const v = G.validate(polys);
      out.push({ layer: li, polygons: polys.length, expected: 1 + inner, ok: polys.length === 1 + inner && v.ok, codes: codes(v) }); });
    fx[k] = out; }
  R.frame.fixtures = fx;
  for (const mode of ["split", "rechain"]) { G.D3.mode = mode;
  const agg = { masks: 0, mismatch: 0, validateFail: 0, codes: {} };
  for (let s = 1; s <= (QUICK ? 100 : 500); s++) { const w = 32, h = 24, m = noise(F.lcg(5e4 + s), w, h, 0.5);
    const c = SBMorph.components(m, w, h, 1); let inner = 0; for (let i = 0; i < c.count; i++) if (!c.touchesBorder[i]) inner++;
    const polys = withFrame(m, w, h, 250, 10000); agg.masks++; if (polys.length !== 1 + inner) agg.mismatch++;
    const v = G.validate(polys); if (!v.ok) agg.validateFail++; for (const [k, n] of Object.entries(codes(v))) agg.codes[k] = (agg.codes[k] || 0) + n; }
  R.frame["noise32x24_sweep:" + mode] = agg; }
  G.D3.mode = "rechain";
}
{ // smoothing vs frame: Chaikin(2) unpinned vs pinned-on-art-boundary, 0.25 mm/px, frame 10 mm
  const pinnedChaikin = (loop, it, w, h) => { let pts = loop.map((p) => [...p]);
    const pin = (p) => p[0] === 0 || p[1] === 0 || p[0] === w || p[1] === h;
    for (let k = 0; k < it; k++) { const out = [], n = pts.length;
      for (let i = 0; i < n; i++) { const u = pts[(i + n - 1) % n], v = pts[i], q = pts[(i + 1) % n];
        if (pin(v)) { out.push(v); continue; }
        const a = [0.25 * u[0] + 0.75 * v[0], 0.25 * u[1] + 0.75 * v[1]], b = [0.75 * v[0] + 0.25 * q[0], 0.75 * v[1] + 0.25 * q[1]];
        // keep cut points that land on the boundary line exactly (they still lie on it); otherwise as is
        out.push(a, b); }
      pts = out; } return pts; };
  const run = (m, w, h, mode) => {
    const loops = SBTrace.trace(m, w, h).map((L) => mode === "raw" ? L : mode === "chaikin" ? SBTrace.chaikin(L, 2) : pinnedChaikin(L, 2, w, h));
    const polys = withFrame(m, w, h, 250, 10000, loops); const v = G.validate(polys);
    const c = SBMorph.components(m, w, h, 1); let inner = 0; for (let i = 0; i < c.count; i++) if (!c.touchesBorder[i]) inner++;
    // micro-holes created AT THE FRAME: hole rings with a vertex on the art-rectangle boundary (x or y = frame edge)
    const fx0 = 10000, fy0 = 10000, fx1 = 10000 + w * 250, fy1 = 10000 + h * 250, onB = (r) => { for (let i = 0; i < r.length; i += 2) if (r[i] === fx0 || r[i] === fx1 || r[i + 1] === fy0 || r[i + 1] === fy1) return true; return false; };
    const small = []; for (const p of polys) for (const hl of p.holes) { const a = -G.shoe(hl); if (a < 250 * 250 && onB(hl)) small.push(a); }
    const rawHoles = mode === "raw" ? holesOf(polys) : holesOf(withFrame(m, w, h, 250, 10000));
    return { polygons: polys.length, expectedPolygons: 1 + inner, holes: holesOf(polys), extraHolesVsRaw: holesOf(polys) - rawHoles, frameEdgeMicroHoles: small.length, minFrameEdgeMicroHoleUm2: small.length ? Math.min(...small) : null, ok: v.ok, codes: codes(v) };
  };
  const out = {};
  for (const mode of ["raw", "chaikin", "pinnedChaikin"]) {
    const bt = F.MASKS.borderTouch; out[mode] = { borderTouch: run(bt.layers[1], bt.w, bt.h, mode) };
    const agg = { masks: 0, polygonMismatch: 0, masksWithFrameEdgeMicroHoles: 0, frameEdgeMicroHoles: 0, minFrameEdgeMicroHoleUm2: null, validateFail: 0 };
    for (let s = 1; s <= (QUICK ? 50 : 200); s++) { const w = 32, h = 24, m = noise(F.lcg(7e4 + s), w, h, 0.55); const r = run(m, w, h, mode);
      agg.masks++; if (r.polygons !== r.expectedPolygons) agg.polygonMismatch++; if (r.frameEdgeMicroHoles) agg.masksWithFrameEdgeMicroHoles++; agg.frameEdgeMicroHoles += r.frameEdgeMicroHoles; agg.extraHolesVsRaw = (agg.extraHolesVsRaw || 0) + r.extraHolesVsRaw; if (r.extraHolesVsRaw > 0) agg.masksWithExtraHoles = (agg.masksWithExtraHoles || 0) + 1;
      if (r.minFrameEdgeMicroHoleUm2 !== null) agg.minFrameEdgeMicroHoleUm2 = Math.min(agg.minFrameEdgeMicroHoleUm2 ?? Infinity, r.minFrameEdgeMicroHoleUm2); if (!r.ok) agg.validateFail++; }
    out[mode].noise32x24 = agg;
  }
  R.frame.smoothing = out;
}

console.error("[s5] reached // ------------------------------------------------------------------ D. at", (performance.now()/1000).toFixed(1)+"s");
// ------------------------------------------------------------------ D. finite-width contact (D3, Appendix B.3)
// Detailed exact-oracle sweeps live in s5_inset.mjs; this records the B.3 classification of the canonical cases.
{
  const sq = (x0, y0, x1, y1) => [{ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] }];
  const rows = [];
  const lower = sq(0, 0, 10000, 10000);
  const cases = [["point (corner)", sq(10000, 10000, 20000, 20000)], ["edge (line)", sq(10000, 0, 20000, 10000)]];
  for (const wd of [1, 2, 3, 4, 249, 250, 2999, 3000, 3001]) cases.push([`overlap ${wd} µm`, sq(10000 - wd, 0, 20000, 10000)]);
  for (let k = 1; k <= 3; k++) cases.push([`diagonal sliver k=${k} (normal width ${(k / Math.SQRT2).toFixed(3)} µm)`, null, k]);
  cases.push(["needle triangle 20001×1 (inradius ≈ 2.5e-5 µm)", [{ outer: [0, 0, 20001, 1, 20000, 1], holes: [] }]]);
  for (const [label, upper, k] of cases) {
    const I = k ? G.intersection([{ outer: [0, 0, 100000, 0, 0, 100000], holes: [] }], [{ outer: [100000 - k, 0, 100000 - k, 100000, -k, 100000], holes: [] }])
      : label.startsWith("needle") ? upper : G.intersection(upper, lower);
    const row = { case: label, intersectionArea: G.area(I) };
    for (const d of [0.25, 1500]) for (const sc of [4, 16, 64]) row[`inset${d}_x${sc}`] = G.insetStatus(I, d, { scale: sc }).status;
    row.classify_minFeature3000 = G.classifyContact(I, 3000).level;
    rows.push(row);
  }
  R.finiteWidth = rows;
  let threw = false; try { G.offset(lower, -1, "round"); } catch { threw = true; } R.roundJoinRefused = threw;
  let threw2 = false; try { G.offset(lower, -0.5, "miter"); } catch { threw2 = true; } R.nonIntegerOffsetRefused = threw2;
}

console.error("[s5] reached // ------------------------------------------------------------------ E. at", (performance.now()/1000).toFixed(1)+"s");
// ------------------------------------------------------------------ E. timing at fabrication size
{
  const W = 1536, H = 1024, runs = QUICK ? 2 : 5, stackTimes = [], perStage = { trace: [], fromPixelLoops: [], unionNormalize: [], frameUnion: [], components: [], morph4: [] };
  let totalVerts = 0, compMismatch = 0, layers = 0;
  for (let s = 1; s <= runs; s++) {
    const st = F.randomNestedStack(F.lcg(s), W, H, 8); const t0 = performance.now();
    for (const m of st) { layers++;
      let t = performance.now(); const loops = SBTrace.trace(m, W, H); perStage.trace.push(ms(t));
      t = performance.now(); const pl = G.fromPixelLoops(loops, 250, 250, 10000, 10000); perStage.fromPixelLoops.push(ms(t));
      t = performance.now(); const polys = G.union(pl, []); perStage.unionNormalize.push(ms(t));
      t = performance.now(); G.union(polys, frameRing(W * 250, H * 250, 10000)); perStage.frameUnion.push(ms(t));
      t = performance.now(); const nc = comps(polys); perStage.components.push(ms(t));
      t = performance.now(); const mc = comps4(m, W, H); perStage.morph4.push(ms(t));
      if (nc !== mc) compMismatch++;
      totalVerts += polys.reduce((a, p) => a + p.outer.length / 2 + p.holes.reduce((b, h) => b + h.length / 2, 0), 0);
    }
    stackTimes.push(ms(t0));
  }
  const sum = Object.fromEntries(Object.entries(perStage).map(([k, a]) => [k, { p50: pct(a, 0.5), p95: pct(a, 0.95), max: Math.max(...a) }]));
  R.timing_nested1536x1024x8 = { runs, layers, meanVerticesPerLayer: Math.round(totalVerts / layers), compMismatch, stackMs: { p50: pct(stackTimes, 0.5), p95: pct(stackTimes, 0.95), max: Math.max(...stackTimes) }, perLayerMs: sum };
  // worst case: 1536x1024 uniform noise p=0.5 (≈ max saddle density)
  const m = noise(F.lcg(99), W, H, 0.5); let t = performance.now(); const loops = SBTrace.trace(m, W, H); const tt = ms(t);
  const P = G.fromPixelLoops(loops, 250, 250, 0, 0); t = performance.now(); G.unionRaw(P, []); const tclip = ms(t);
  t = performance.now(); const polys = G.union(P, []); const tu = ms(t);
  t = performance.now(); const nc = comps(polys); const tc = ms(t); const mc = comps4(m, W, H);
  R.timing_noise1536x1024 = { saddles: saddles(m, W, H), traceLoops: loops.length, traceMs: tt, clipperFlatUnionOnlyMs: tclip, unionNormalizeMs: tu, componentsMs: tc, polygons: polys.length, morph4: mc, match: nc === mc };
}

console.error("[s5] reached fs.writeFileSync( at", (performance.now()/1000).toFixed(1)+"s");
fs.writeFileSync(path.join(ROOT, "spikes/S5/results.json"), JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, (k, v) => (k === "outerRing" ? JSON.stringify(v) : v), 1));
