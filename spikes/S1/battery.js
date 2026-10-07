/* spikes/S1/battery.js — runs the plan's S1 battery (verbatim checks) plus extended robustness
 * checks against each SBGeom candidate, each in a fresh vm context.
 *   node spikes/S1/battery.js [clipper|lattice] [--json out.json]
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..", "..");
const F = require(path.join(ROOT, "test", "fixtures.js"));

const CANDIDATES = {
  clipper: { label: "(a) Clipper2 JS port (clipper2-ts 2.0.1-18)", files: ["spikes/S1/vendor/clipper2.js", "spikes/S1/geom_core.js", "spikes/S1/geom_clipper.js"], vendor: "spikes/S1/vendor/clipper2.js" },
  lattice: { label: "(c) in-house exact orthogonal lattice", files: ["spikes/S1/geom_core.js", "spikes/S1/geom_lattice.js"], vendor: null },
};

function load(name) {
  const ctx = vm.createContext({ console });
  ctx.globalThis = ctx;
  for (const f of ["js/trace.js"].concat(CANDIDATES[name].files)) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  return ctx;
}

function run(name) {
  const ctx = load(name), G = ctx.SBGeom, SBTrace = ctx.SBTrace;
  const results = []; let cur = "";
  const suite = (n, fn) => { cur = n; try { fn(); } catch (e) { results.push({ suite: cur, name: "(suite threw) " + e.message, ok: false }); } };
  const check = (n, c) => results.push({ suite: cur, name: n, ok: !!c });
  const safe = (fn) => { try { return fn(); } catch (e) { return false; } };
  const req = (p) => (p === "./fixtures.js" ? F : p === "./modules.js" ? { NODE_MODULES: ["util.js", "hash.js", "vendor/" + path.basename(CANDIDATES[name].vendor || "none.js")] } : require(p));

  // ------------------------------------------------ plan battery (verbatim bodies, wrapped in safe())
  suite("spike S1 — SBGeom battery (GEO-01/03/09)", () => {
    const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] });
    const shoe = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; };
    const require = req;
    check("S1 union of two edge-adjacent squares is one polygon", safe(() => G.union([sq(0,0,10,10)], [sq(10,0,20,10)]).length === 1));
    check("S1 point-touching squares stay two components", safe(() => G.components(G.union([sq(0,0,10,10)], [sq(10,10,20,20)])).length === 2));
    const donut = G.difference([sq(0,0,30,30)], [sq(10,10,20,20)]);
    check("S1 donut area exact", safe(() => G.area(donut) === 900 - 100));
    check("S1 donut has one hole", safe(() => donut.length === 1 && donut[0].holes.length === 1));
    check("S1 difference of identical sets is empty", safe(() => G.isEmpty(G.difference([sq(0,0,10,10)], [sq(0,0,10,10)]))));
    check("S1 coincident partial edge difference is empty", safe(() => G.isEmpty(G.difference([sq(0,0,10,5)], [sq(0,0,10,10)]))));
    check("S1 offset -500µm of 800µm strip is empty", safe(() => G.isEmpty(G.offset([sq(0,0,800,10000)], -500, "miter"))));
    let threw = false; try { G.offset([sq(0,0,10,10)], 1, "round"); } catch (e) { threw = true; }
    check("NFR-05 round join refused", threw);
    check("S1 bowtie rejected", safe(() => !G.validate([{ outer: [0,0,10,10,10,0,0,10], holes: [] }]).ok));
    check("S1 zero-area ring rejected", safe(() => !G.validate([{ outer: [0,0,10,0,20,0], holes: [] }]).ok));
    const n = G.normalize(donut);
    check("S1 normalize idempotent", safe(() => JSON.stringify(G.normalize(n)) === JSON.stringify(n)));
    check("S1 outer positive / hole negative area in Y-down", safe(() => shoe(n[0].outer) > 0 && shoe(n[0].holes[0]) < 0));
    const traced = G.fromPixelLoops(SBTrace.trace(require("./fixtures.js").art(["###", "#.#", "###"]).m, 3, 3), 1000, 1000, 0, 0);
    check("S1 fromPixelLoops reverses trace winding (outer positive)", safe(() => shoe(G.normalize(traced)[0].outer) > 0));
    const saddle = G.normalize(G.union([sq(0,0,10,10)], [sq(10,10,20,20)]));
    check("GEO-03/D3 saddle → 2 simple rings, validate ok", safe(() => saddle.length === 2 && G.validate(saddle).ok));
    check("NFR-05 circle has no trig and is symmetric", safe(() => G.circle(0, 0, 1500).outer.length === 128 && G.area([G.circle(0,0,1500)]) > 0));
    check("S1 results identical across two runs", safe(() => JSON.stringify(G.union([sq(0,0,7,9)], [sq(3,3,13,13)])) === JSON.stringify(G.union([sq(0,0,7,9)], [sq(3,3,13,13)]))));
  });

  suite("spike S1 — vendor load forms", () => {
    const v = CANDIDATES[name].vendor;
    if (!v) { check("NFR-11 (no third-party vendor file: in-house code only)", true); return; }
    const src = fs.readFileSync(path.join(ROOT, v), "utf8");
    check("NFR-11 vendor loads as a classic script in a fresh vm context", (() => { const c = vm.createContext({}); c.globalThis = c; vm.runInContext(src, c); return Object.keys(c).length > 1; })());
    check("NFR-11 vendor has no import/export statements", !/^\s*(import|export)\s/m.test(src));
    check("NFR-11 (extra) vendor has no import/export anywhere (not only at line start)", !/\bimport\s*[{*"'(]|import\.meta|\bexport\s*[{*]|\bexport\s+(default|const|let|var|function|class)\b/.test(src));
    check("NFR-11 (extra) vendor references no DOM / require / process / Function constructor", !/\b(document|window\.|require\(|process\.|new Function)\b/.test(src.replace(/typeof window !== "undefined" \? window : globalThis/, "")));
    check("NFR-11 (extra) vendor runs under strict IIFE and sets exactly global.Clipper2", (() => { const c = vm.createContext({}); vm.runInContext(src, c); return JSON.stringify(Object.keys(c)) === '["Clipper2"]'; })());
    check("NFR-11 (extra) importScripts-style load (vm.Script in a worker-like global with self)", (() => { const c = vm.createContext({}); c.self = c; new vm.Script(src).runInContext(c); return typeof c.Clipper2.union === "function"; })());
  });

  // ------------------------------------------------ extended robustness checks
  suite("spike S1 — extended robustness (beyond the plan battery)", () => {
    const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] });
    const rng = F.lcg(7);
    const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
    // random orthogonal unions of rectangles on a 200 µm lattice
    const randOrtho = () => { let acc = []; for (let k = 0; k < 6; k++) { const x = ri(0, 20) * 200, y = ri(0, 20) * 200; acc = G.union(acc, [sq(x, y, x + ri(1, 8) * 200, y + ri(1, 8) * 200)]); } return acc; };
    let incl = 0, part = 0, valid = 0, idem = 0, nCase = 150, threw = 0;
    for (let t = 0; t < nCase; t++) {
      try {
        const A = randOrtho(), B = randOrtho();
        const U = G.union(A, B), I = G.intersection(A, B), D = G.difference(A, B);
        if (G.area(U) === G.area(A) + G.area(B) - G.area(I)) incl++;
        if (G.area(D) + G.area(I) === G.area(A) && G.isEmpty(G.intersection(D, B))) part++;
        if ([U, I, D].every((p) => G.validate(p).ok)) valid++;
        if ([U, I, D].every((p) => JSON.stringify(G.normalize(p)) === JSON.stringify(p))) idem++;
      } catch (e) { threw++; }
    }
    check(`EXT inclusion–exclusion exact on ${nCase} random orthogonal pairs (${incl}/${nCase})`, incl === nCase);
    check(`EXT A = (A−B) ⊔ (A∩B) exactly (${part}/${nCase})`, part === nCase);
    check(`EXT every boolean output validates (${valid}/${nCase})`, valid === nCase);
    check(`EXT every boolean output is already normalized (${idem}/${nCase})`, idem === nCase);
    check(`EXT no throws on orthogonal random cases (${threw})`, threw === 0);

    // nested random stacks (the product's real input): exact area, containment, validity
    let okStack = 0; const NS = 60;
    for (let s = 1; s <= NS; s++) {
      try {
        const st = F.randomNestedStack(F.lcg(s), 40, 30, 5); let prev = null, ok = true;
        for (let k = 0; k < st.length; k++) {
          const L = G.union(G.fromPixelLoops(SBTrace.trace(st[k], 40, 30), 250, 200, 1000, 3000), []);
          const px = st[k].reduce((a, b) => a + b, 0);
          if (G.area(L) !== px * 250 * 200 || !G.validate(L).ok) ok = false;
          if (prev && !G.isEmpty(G.difference(L, prev))) ok = false;
          prev = L;
        }
        if (ok) okStack++;
      } catch (e) { /* counted as failure */ }
    }
    check(`EXT randomNestedStack ×${NS}: area = pixels·sx·sy exactly, validate ok, L_k − L_(k−1) = ∅ (${okStack}/${NS})`, okStack === NS);

    // checkerboard saddles everywhere
    const cb = []; for (let y = 0; y < 8; y++) { let row = ""; for (let x = 0; x < 8; x++) row += (x + y) % 2 ? "#" : "."; cb.push(row); }
    const cbm = F.art(cb), cbp = G.union(G.fromPixelLoops(SBTrace.trace(cbm.m, 8, 8), 1000, 1000, 0, 0), []);
    check("EXT 8×8 checkerboard → 32 components, validate ok", safe(() => G.components(cbp).length === 32 && G.validate(cbp).ok));

    // hole touching the outer at a single vertex (pinched hole)
    const pinch = G.difference([sq(0, 0, 30, 30)], [sq(0, 0, 10, 10), sq(10, 10, 20, 20)]);
    check("EXT pinched hole (vertex-touching) → simple rings, validate ok, area exact", safe(() => G.validate(pinch).ok && G.area(pinch) === 900 - 200));

    check("EXT pinched hole is ONE component with one hole (material connected the long way round)", safe(() => G.components(pinch).length === 1 && pinch.length === 1 && pinch[0].holes.length === 1));
    const Ls = F.art(["###.", "#..#", "#..#", ".###"]);
    const twoL = G.union(G.fromPixelLoops(SBTrace.trace(Ls.m, 4, 4), 1000, 1000, 0, 0), []);
    check("EXT/AT-06 two L-shapes touching diagonally at 2 points around a void → 2 components, no holes, validate ok", safe(() => G.components(twoL).length === 2 && twoL.every((p) => p.holes.length === 0) && G.validate(twoL).ok));
    const twoLb = G.union([{ outer: [0,0,3000,0,3000,1000,1000,1000,1000,3000,0,3000], holes: [] }], [{ outer: [3000,1000,4000,1000,4000,4000,1000,4000,1000,3000,3000,3000], holes: [] }]);
    check("EXT/AT-06 same two L-shapes built by union of polygons (backend chaining) → 2 components", safe(() => G.components(twoLb).length === 2 && JSON.stringify(twoLb) === JSON.stringify(twoL)));

    // property: components() == 4-connected pixel components of the band mask (diagonal-only contact = separate)
    const comp4 = (m, w, h) => { const lab = new Int32Array(m.length); let n = 0;
      for (let i = 0; i < m.length; i++) if (m[i] && !lab[i]) { n++; const q = [i]; lab[i] = n;
        while (q.length) { const p = q.pop(), x = p % w, y = (p / w) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (m[j] && !lab[j]) { lab[j] = n; q.push(j); } } } }
      return n; };
    let cOk = 0, cN = 0;
    for (let sd = 1; sd <= 60; sd++) {
      const st = F.randomNestedStack(F.lcg(sd), 60, 40, 5);
      const LL = st.map((m) => G.union(G.fromPixelLoops(SBTrace.trace(m, 60, 40), 200, 200, 0, 0), []));
      for (let k = 1; k < 5; k++) { cN++;
        try { const band = st[k - 1].map((v, i) => (v && !st[k][i] ? 1 : 0));
          if (G.components(G.difference(LL[k - 1], LL[k])).length === comp4(band, 60, 40)) cOk++; } catch (e) { /* fail */ } }
    }
    check(`EXT/AT-06 components(L_(k−1) − L_k) = 4-connected pixel components (${cOk}/${cN}; seed 23 k=1 is the case raw Clipper2 chaining got wrong)`, cOk === cN);

    // offsets on orthogonal input
    const r = [sq(0, 0, 1000, 600)];
    check("EXT offset +250 miter of 1000×600 = 1500×1100 exactly", safe(() => G.area(G.offset(r, 250, "miter")) === 1500 * 1100));
    check("EXT offset −250 miter of 1000×600 = 500×100 exactly", safe(() => G.area(G.offset(r, -250, "miter")) === 500 * 100));
    check("EXT offset +d then −d restores a rectangle exactly", safe(() => JSON.stringify(G.offset(G.offset(r, 300, "miter"), -300, "miter")) === JSON.stringify(G.normalize(r))));
    const L = G.union([sq(0, 0, 3000, 1000)], [sq(0, 0, 1000, 3000)]);
    check("EXT offset −400 of L-shape: two arms survive, area exact (2200·200+200·2200−200·200 → 3·…)", safe(() => G.area(G.offset(L, -400, "miter")) === 2200 * 200 + 200 * 2200 - 200 * 200));
    const sqA = safe(() => G.area(G.offset([sq(0, 0, 1000, 1000)], 200, "square")));
    check(`INFO offset +200 "square" of 1000² square: area ${sqA} (miter would be ${1400 * 1400})`, true);

    // non-orthogonal input (circles for registration holes, smoothed contours)
    let circ = null, cErr = null;
    try { circ = G.difference([sq(-5000, -5000, 5000, 5000)], [G.circle(0, 0, 1500)]); } catch (e) { cErr = e.code || e.message; }
    check(`EXT square minus SBGeom.circle (registration hole) supported${cErr ? " — threw " + cErr : ""}`, !!circ && G.validate(circ).ok && circ[0].holes.length === 1 && Math.abs(G.area(circ) - (1e8 - Math.PI * 1500 * 1500)) < 0.005 * Math.PI * 1500 * 1500);
    const tri = { outer: [0, 0, 1000, 0, 0, 1000], holes: [] };
    let triOk = false; try { triOk = G.area(G.union([tri], [sq(500, 0, 1500, 1000)])) === 500000 + 1000000 - 125000; } catch (e) { /* lattice throws */ }
    check("EXT diagonal edge boolean exact (triangle ∪ square, area 1 375 000)", triOk);

    // big coordinates (1 m page) and determinism
    const big = G.union([sq(0, 0, 999999, 999999)], [sq(500000, 500000, 1000000, 1000001)]);
    check("EXT 1 m page coordinates: union area exact", safe(() => G.area(big) === 999999 * 999999 + 500000 * 500001 - 499999 * 499999));
    check("EXT containsPoint: boundary counts as inside, hole interior outside", safe(() => G.containsPoint(G.difference([sq(0,0,30,30)], [sq(10,10,20,20)]), [10, 15]) && !G.containsPoint(G.difference([sq(0,0,30,30)], [sq(10,10,20,20)]), [15, 15])));
    const c = G.circle(0, 0, 1500).outer, set = new Set(); for (let i = 0; i < c.length; i += 2) set.add(c[i] + "," + c[i + 1]);
    let sym = true; for (let i = 0; i < c.length; i += 2) if (!set.has(-c[i] + "," + c[i + 1]) || !set.has(c[i] + "," + -c[i + 1]) || !set.has(c[i + 1] + "," + c[i])) sym = false;
    check("EXT circle is 8-fold symmetric (mirror x, mirror y, swap x/y)", sym);
  });
  return results;
}

function crossBackend() {
  const A = load("clipper").SBGeom, B = load("lattice").SBGeom, T = load("clipper").SBTrace, J = JSON.stringify;
  let n = 0, same = 0;
  for (let s = 1; s <= 40; s++) {
    const st = F.randomNestedStack(F.lcg(s), 60, 40, 5);
    const LA = st.map((m) => A.union(A.fromPixelLoops(T.trace(m, 60, 40), 200, 200, 0, 0), [])), LB = st.map((m) => B.union(B.fromPixelLoops(T.trace(m, 60, 40), 200, 200, 0, 0), []));
    for (let k = 1; k < 5; k++) for (const [a, b] of [[A.difference(LA[k - 1], LA[k]), B.difference(LB[k - 1], LB[k])], [A.intersection(LA[k], LA[k - 1]), B.intersection(LB[k], LB[k - 1])],
      [A.offset(LA[k], -700, "miter"), B.offset(LB[k], -700, "miter")], [A.offset(LA[k], 300, "miter"), B.offset(LB[k], 300, "miter")]]) { n++; if (J(a) === J(b)) same++; }
  }
  return { n, same };
}
const which = process.argv[2] && !process.argv[2].startsWith("--") ? [process.argv[2]] : Object.keys(CANDIDATES);
const all = {};
for (const n of which) {
  const res = run(n), pass = res.filter((r) => r.ok).length;
  all[n] = { label: CANDIDATES[n].label, pass, total: res.length, results: res };
  console.log(`\n=== ${CANDIDATES[n].label}: ${pass}/${res.length}`);
  let s = ""; for (const r of res) { if (r.suite !== s) { s = r.suite; console.log("  " + s); } console.log(`    ${r.ok ? "✓" : "✗"} ${r.name}`); }
}
if (which.length > 1) { const x = crossBackend(); all.crossBackend = x; console.log(`\n=== cross-backend: (a) and (c) byte-identical normalized output on orthogonal input: ${x.same}/${x.n}`); }
const j = process.argv.indexOf("--json"); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(all, null, 1));
