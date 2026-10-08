/* ============================================================================
 * Shadowbox Studio — test/run_tests.js
 * ----------------------------------------------------------------------------
 * Algorithm test suite. Runs in Node (the modules attach to globalThis, so
 * the exact same files the browser loads are what gets tested):
 *
 *     node test/run_tests.js
 * ==========================================================================*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

globalThis.crypto ??= require("crypto").webcrypto;

for (const f of require("./modules.js").NODE_MODULES) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), { filename: f });
}

let pass = 0, fail = 0;
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1] : null; })();
let skipping = false, pending = [];
const queue = [];
function section(name) { skipping = !!ONLY && !name.includes(ONLY); if (!skipping) console.log("\n" + name); } // legacy blocks
function check(name, cond) {
  if (skipping) return;
  if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.error("  ✗ " + name); }
}
function checkAsync(name, p) {
  if (skipping) return;
  pending.push(Promise.resolve(p).then((v) => check(name, !!v), (e) => check(name + " (threw " + e.message + ")", false)));
}
function suite(name, fn) { queue.push([name, fn]); }

// helper: build a mask from ASCII art ('#' = material) — lives in fixtures.js
const { art } = require("./fixtures.js");

// ---------------------------------------------------------------- zip/crc
section("zip.js — CRC-32 and archive structure");
{
  const bytes = new TextEncoder().encode("123456789");
  check("CRC-32 reference vector (0xCBF43926)", SBZip.crc32(bytes) === 0xcbf43926);

  const zip = SBZip.build([
    { name: "a.txt", data: "hello" },
    { name: "dir/b.svg", data: "<svg/>" },
  ]);
  check("local header signature PK\\x03\\x04", zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 3 && zip[3] === 4);
  const tail = zip.slice(zip.length - 22);
  check("end-of-central-directory signature", tail[0] === 0x50 && tail[1] === 0x4b && tail[2] === 5 && tail[3] === 6);
  check("entry count recorded", tail[8] === 2 && tail[10] === 2);
}

// -------------------------------------------------------------- morphology
section("morph.js — components, specks, holes");
{
  const { m, w, h } = art([
    "..........",
    ".###...##.",
    ".###...##.",
    "..........",
    "....#.....",
    "..........",
  ]);
  const comp = SBMorph.components(m, w, h, 1);
  check("finds 3 components", comp.count === 3);
  check("areas correct", [...comp.areas].sort((a, b) => a - b).join(",") === "1,4,6");

  const removed = SBMorph.removeSpecks(m, w, h, 2);
  check("speck removal drops the 1-px blob", removed === 1 && SBMorph.components(m, w, h, 1).count === 2);
}
{
  const { m, w, h } = art([
    "#######",
    "#.....#",
    "#..#..#",
    "#.....#",
    "#######",
  ]);
  // the '#' at center is material; the '.' ring is a hole region? Actually the
  // empty ring around center is one hole component (8px? -> 4-connected ring).
  const before = SBMorph.components(m, w, h, 0).count;
  SBMorph.fillHoles(m, w, h, 100);
  const after = SBMorph.components(m, w, h, 0).count;
  check("fillHoles seals enclosed empties", before >= 1 && after === 0);
}

// ----------------------------------------------------------------- islands
section("islands.js — bridge and cull");
{
  // Mainland ring touching the border, island blob in the middle.
  const { m, w, h } = art([
    "################",
    "#..............#",
    "#..............#",
    "#.....####.....#",
    "#.....####.....#",
    "#.....####.....#",
    "#..............#",
    "#..............#",
    "################",
  ]);
  const res = SBIslands.resolve(m, w, h, {
    frameAnchored: true, bridgeRadius: 1, cullBelowPx: 2, maxBridgePx: 0,
  });
  check("island detected and bridged", res.islandCount === 1 && res.bridged === 1);
  check("sheet is now one connected piece", SBMorph.components(m, w, h, 1).count === 1);
  let bridgePx = 0;
  for (let i = 0; i < res.bridges.length; i++) bridgePx += res.bridges[i];
  check("bridge material recorded", bridgePx > 0);
}
{
  // Tiny island below the cull threshold: must be erased, not bridged.
  const { m, w, h } = art([
    "########",
    "#......#",
    "#..#...#",
    "#......#",
    "########",
  ]);
  const res = SBIslands.resolve(m, w, h, {
    frameAnchored: true, bridgeRadius: 1, cullBelowPx: 3, maxBridgePx: 0,
  });
  check("tiny island culled", res.culled === 1 && res.bridged === 0);
  check("culled pixels removed from mask", m[2 * w + 3] === 0);
}
{
  // Frameless mode: largest blob is mainland, second blob bridges to it.
  const { m, w, h } = art([
    "................",
    ".#####..........",
    ".#####......##..",
    ".#####......##..",
    "................",
  ]);
  const res = SBIslands.resolve(m, w, h, {
    frameAnchored: false, bridgeRadius: 1, cullBelowPx: 2, maxBridgePx: 0,
  });
  check("frameless: smaller blob treated as island", res.islandCount === 1 && res.bridged === 1);
  check("frameless: connected after bridging", SBMorph.components(m, w, h, 1).count === 1);
}

// ------------------------------------------------------------------ trace
section("trace.js — contours, simplify, smooth");
{
  const { m, w, h } = art([
    "......",
    ".####.",
    ".####.",
    ".####.",
    "......",
  ]);
  const loops = SBTrace.trace(m, w, h);
  check("solid square → 1 loop", loops.length === 1);
  check("rectilinear dedupe → 4 corners", loops[0].length === 4);
}
{
  const { m, w, h } = art([
    ".......",
    ".#####.",
    ".#...#.",
    ".#.#.#.",
    ".#...#.",
    ".#####.",
    ".......",
  ]);
  const loops = SBTrace.trace(m, w, h);
  check("donut with inner island → 3 loops (outer, hole, island)", loops.length === 3);
  for (const lp of loops) {
    const closedOK = lp.length >= 3;
    if (!closedOK) check("loop well-formed", false);
  }
  check("loops well-formed", true);

  const smooth = SBTrace.chaikin(loops[0], 2);
  check("chaikin quadruples point count", smooth.length === loops[0].length * 4);
}
{
  // RDP: a jittered straight edge collapses to few points.
  const noisy = [];
  for (let x = 0; x <= 40; x++) noisy.push([x, 10 + (x % 2 ? 0.3 : 0)]);
  for (let x = 40; x >= 0; x--) noisy.push([x, 20]);
  const simp = SBTrace.simplify(noisy, 1.0);
  check("RDP collapses jitter", simp.length <= 8 && simp.length >= 3);
}

// ----------------------------------------------------------------- raster
section("raster.js — filter and banding invariants");
{
  const w = 32, h = 32;
  const flat = new Float32Array(w * h).fill(128);
  const out = SBRaster.kuwahara(flat, w, h, 3, 2);
  let same = true;
  for (let i = 0; i < out.length; i++) if (Math.abs(out[i] - 128) > 1e-6) same = false;
  check("kuwahara preserves constant image", same);

  // gradient image → thresholds and nested masks
  const grad = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grad[y * w + x] = (x / (w - 1)) * 255;
  const th = SBRaster.thresholds(grad, 5, "balanced");
  check("N sheets → N-1 ascending thresholds",
    th.length === 4 && th.every((t, i) => i === 0 || t > th[i - 1]));

  const bands = SBRaster.bands(grad, th);
  const masks = SBRaster.sheetMasks(bands, 5, w, h, true);
  let nested = true;
  for (let s = 1; s < masks.length - 1; s++)
    for (let i = 0; i < w * h; i++)
      if (masks[s + 1][i] && !masks[s][i]) nested = false;
  check("sheet masks are nested (sheet k ⊇ sheet k+1)", nested);
  check("backing sheet is solid", masks[0].every((v) => v === 1));
}

// ------------------------------------------------------------------ svg
section("svgout.js — document sanity");
{
  const svg = SBSvg.sheetSVG({
    loops: [[[2, 2], [10, 2], [10, 8], [2, 8]]],
    pxW: 100, pxH: 80, widthMM: 200, marginMM: 10,
    holes: true, holeDiaMM: 4, label: "test 1/3", isBacking: false,
  });
  check("mm dimensions include frame", svg.includes('width="220mm"') && svg.includes('height="180mm"'));
  check("cut group uses laser-red hairline", svg.includes('stroke="#FF0000" stroke-width="0.1"'));
  check("4 registration holes", (svg.match(/<circle/g) || []).length === 4);
  check("score label present", svg.includes("test 1/3"));
}

// ------------------------------------------------- docs contract (T0.1)
section("docs — architecture contract and component inventory (T0.1)");
{
  const read = (p) => {
    try { return fs.readFileSync(path.join(__dirname, "..", p), "utf8"); } catch (e) { return ""; }
  };
  const comp = read("docs/COMPONENTS.md");
  check("NFR-11 COMPONENTS.md inventory table has required columns",
    /\|\s*Name\s*\|\s*Version\s*\|\s*License\s*\|\s*File\s*\|\s*SHA-256\s*\|\s*Obtained from\s*\|\s*Build form \(UMD\/IIFE\/shim\)\s*\|\s*Scope \(runtime\/dev-only\)\s*\|/.test(comp));
  const arch = read("docs/ARCHITECTURE.md");
  const plan = read("docs/plans/opaque-layers-dev-plan.md");
  // Extract a plan block from its start heading up to (not including) the end marker.
  const block = (src, startRe, endRe) => {
    const m = startRe.exec(src);
    if (!m) return "";
    const rest = src.slice(m.index);
    const e = endRe.exec(rest.slice(m[0].length));
    return (e ? rest.slice(0, m[0].length + e.index) : rest).trim();
  };
  const planGlobal = block(plan, /^## Global Constraints\s*$/m, /^## /m);
  const plan3 = block(plan, /^## 3\. Data model and contracts \(schema v1\)\s*$/m, /^## 4\. /m);
  const plan4 = block(plan, /^## 4\. Module map and load order\s*$/m, /^---\s*$|^## /m);
  const tableRows = (b) => b.split("\n").filter((l) => /^\|/.test(l) && !/^\|[\s|:-]+\|$/.test(l));
  check("§9.1 ARCHITECTURE.md carries plan §3 (schema v1 data model) verbatim",
    plan3.length > 0 && plan3.includes("geometryKey(p)") && arch.includes(plan3));
  check("DEP-04 ARCHITECTURE.md carries plan §4 (module map, backward-compatibility matrix) verbatim",
    plan4.length > 0 && plan4.includes("Backward-compatibility matrix") && arch.includes(plan4));
  const missingRows = tableRows(plan3 + "\n" + plan4).filter((r) => !arch.includes(r));
  check("DEP-04 every plan §3–§4 table row (incl. compatibility matrix) is in ARCHITECTURE.md"
    + (missingRows.length ? " — missing: " + missingRows.map((r) => r.slice(0, 40)).join("; ") : ""),
    tableRows(plan4).length > 0 && missingRows.length === 0);
  check("NFR-05 ARCHITECTURE.md carries the plan's Global Constraints and determinism rules verbatim",
    planGlobal.includes("Determinism rules (NFR-05)") && arch.includes(planGlobal));
  const decisions = arch.split(/^## Decisions\s*$/m)[1] || "";
  check("GEO-04/NFR-11/GEO-02/NFR-05 ARCHITECTURE.md Decisions section has D1–D4",
    ["D1", "D2", "D3", "D4"].every((d) => new RegExp("^#+\\s*" + d + "\\b", "m").test(decisions)));
}

// ------------------------------------------------ build hygiene (T0.2)
suite("build — hygiene (four-list rule, inline bundle, versions)", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const tags = [...html.matchAll(/<script src="js\/([\w./-]+\.js)"><\/script>/g)].map((m) => m[1]);
  const shell = [...sw.matchAll(/"\.\/js\/([\w./-]+\.js)"/g)].map((m) => m[1]);
  const { NODE_MODULES } = require("./modules.js");
  const domOnly = new Set(["preview.js", "app.js"]);
  check("build: index.html scripts == sw.js SHELL (same order)", JSON.stringify(tags) === JSON.stringify(shell));
  check("build: Node list == index.html scripts minus DOM modules",
    JSON.stringify(NODE_MODULES) === JSON.stringify(tags.filter((t) => !domOnly.has(t))));
  require("child_process").execFileSync(process.execPath, [path.join(root, "build.js")], { stdio: "ignore" });
  const dist = fs.readFileSync(path.join(root, "dist/shadowbox-studio.html"), "utf8");
  check("build: dist has no external <script src=", !/<script src=/.test(dist));
  // NFR-11: the upstream MIT notice must ship inside the single-file bundle,
  // verbatim, inside an HTML comment that precedes all page content.
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8").trim();
  const firstComment = dist.match(/<!--([\s\S]*?)-->/);
  check("build: dist carries the upstream MIT license notice verbatim in a leading comment",
    firstComment !== null && firstComment[1].includes(license) &&
    dist.indexOf(license) < dist.search(/<html[\s>]/i));
  // NFR-11: every vendored licence (js/vendor/LICENSE-*.txt) ships verbatim in a comment before <html>,
  // because the bundle carries the third-party code as source text (BSL-1.0 for clipper2-ts).
  const vdir = path.join(root, "js/vendor");
  const vlic = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter((f) => /^LICENSE-.*\.txt$/.test(f)).sort() : [];
  const head = dist.slice(0, dist.search(/<html[\s>]/i));
  check("build: dist carries every js/vendor/LICENSE-*.txt verbatim before <html> (" + vlic.join(", ") + ")",
    vlic.length > 0 && vlic.every((f) => { const t = fs.readFileSync(path.join(vdir, f), "utf8").trim(); return head.includes(t); }));
  check("DEP-02 sw.js VERSION == APP_VERSION",
    sw.match(/const VERSION\s*=\s*"([^"]+)"/)[1] === app.match(/const APP_VERSION\s*=\s*"([^"]+)"/)[1]);
  check("dev: service worker skipped on localhost", /localhost|127\.0\.0\.1/.test(app.slice(app.indexOf("function registerServiceWorker"))));
});

// ------------------------------------------------ fixtures (T0.3)
suite("fixtures — determinism", () => {
  const F = require("./fixtures.js");
  const a = F.randomNestedStack(F.lcg(42), 24, 16, 5), b = F.randomNestedStack(F.lcg(42), 24, 16, 5);
  check("fixtures: seeded stack identical across calls", a.every((m, k) => m.every((v, i) => v === b[k][i])));
  check("fixtures: random stack is nested", a.every((m, k) => k === 0 || m.every((v, i) => !v || a[k - 1][i])));
  const png = F.pngEncode({ w: 5, h: 1, colorType: 0, bitDepth: 8, data: Uint8Array.from([0, 64, 128, 191, 255]) });
  check("fixtures: PNG signature", png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47);
  const j = F.jpegHeader({ w: 640, h: 480, exif: 6 });
  check("fixtures: JPEG SOI", j[0] === 0xff && j[1] === 0xd8);
  check("fixtures: all named masks present",
    ["donutIsland","crescent","crescentInterior","borderTouch","lowerHoleUnderPart","emptyIntermediate","orientationF","diagonalTouch","looseBridge"]
      .every((k) => F.MASKS[k] && F.MASKS[k].layers.length >= 2));
  const ci = F.MASKS.crescentInterior;
  check("fixtures: crescentInterior does not touch the border", [0, ci.w - 1].every((x) => [...Array(ci.h).keys()].every((y) => !ci.layers[1][y * ci.w + x])));
});

// ------------------------------------------- baseline characterization (T0.4)
suite("baseline — characterization (KNOWN-DEFECT checks invert when fixed)", () => {
  const F = require("./fixtures.js");
  const base = { pxW: 8, pxH: 5, widthMM: 80, marginMM: 10, holes: false, holeDiaMM: 3, label: "t 1/2" };
  const svgUp = SBSvg.sheetSVG({ ...base, loops: SBTrace.trace(F.MASKS.borderTouch.layers[1], 8, 5), isBacking: false });
  const svgBack = SBSvg.sheetSVG({ ...base, loops: [], isBacking: true });
  check("KNOWN-DEFECT EXP-01: sheetSVG always emits the page <rect>", /<rect /.test(svgUp));
  // KNOWN-DEFECT GEO-02 was fixed in G1.3: the check now lives on SBMaterial.applyFrame (suite "material.js — frame and holes …");
  // the shim version was deleted, not edited, because T0.7 freezes sheetSVG.
  check("KNOWN-DEFECT EXP-02: cut group has no id", !/<g id="CUT"/.test(svgUp));
  check("KNOWN-DEFECT EXP-03: label is live <text>", /<text /.test(svgUp));
  check("G0 backing sheet emits only rect (+label), no paths", !/<path /.test(svgBack) && /<rect /.test(svgBack));
  const proof = SBSvg.proofSVG([{ loops: [] }, { loops: [] }], 8, 5, 80, ["#fff", "#000"]);
  check("KNOWN-DEFECT GEO-01 proof extent: proof viewBox != sheet viewBox when margin>0",
    proof.match(/viewBox="([^"]+)"/)[1] !== svgUp.match(/viewBox="([^"]+)"/)[1]);
  // GEO-07 raster source: islands.resolve adds bridge material where layer k-1 is void.
  const lb = F.MASKS.looseBridge, lower = lb.layers[1], m = lb.layers[2].slice();
  SBIslands.resolve(m, lb.w, lb.h, { frameAnchored: true, bridgeRadius: 0.6, cullBelowPx: 0, maxBridgePx: 10 });
  check("KNOWN-DEFECT GEO-07 (bridge): islands.resolve adds material outside layer k-1", m.some((v, i) => v && !lower[i]));
  check("KNOWN-DEFECT SUP-01: islands.resolve bridges a loose part", m.some((v, i) => v !== lb.layers[2][i]));
  // Characterization (not a defect): the per-layer morphology chain keeps nested masks nested.
  let viol = 0;
  for (let s = 1; s <= 200; s++) { const st = F.randomNestedStack(F.lcg(s), 40, 30, 5);
    for (const r of [1, 3]) { const P = st.map((q, k) => { if (!k) return q; let x = SBMorph.open(q, 40, 30, r);
      x = SBMorph.close(x, 40, 30, Math.max(1, r - 1)); SBMorph.removeSpecks(x, 40, 30, 4); SBMorph.fillHoles(x, 40, 30, 4 * r * r * 2); return x; });
      for (let k = 2; k < P.length; k++) for (let i = 0; i < P[k].length; i++) if (P[k][i] && !P[k - 1][i]) viol++; } }
  check("G0 morphology chain preserves nesting (200 seeds)", viol === 0);
  // Persisted v1.1.0 goldens (written once by test/capture_golden.js; never regenerated by tests).
  const G = require("./golden/sheetmasks.json"), H = (u8) => require("crypto").createHash("sha256").update(Buffer.from(u8)).digest("hex");
  const L = new Float32Array(37 * 11); for (let i = 0; i < L.length; i++) L[i] = (i * 97) % 256;
  check("G0/DEP-04 golden file has 24 configs", G.sheetmasks.length === 24);
  check("DEP-04/AT-21 thresholds + sheetMasks match persisted v1.1.0 golden (24 configs)", G.sheetmasks.every((g) => {
    const th = SBRaster.thresholds(L, g.N, g.mode);
    return JSON.stringify(Array.from(th)) === JSON.stringify(g.thresholds) &&
      SBRaster.sheetMasks(SBRaster.bands(L, th), g.N, 37, 11, g.darkFront).every((m, k) => H(m) === g.masks[k]); }));
});

// ------------------------------------------------ engine seam (T0.5)
suite("engine.js — legacyRun seam (NFR-10, DEP-04)", () => {
  const G = require("./golden/oldrun.json"), H = (u8) => require("crypto").createHash("sha256").update(Buffer.from(u8)).digest("hex");
  const w = 40, h = 30, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = ((i % w) * 6 + Math.floor(i / w) * 3) % 256; rgba.set([v, v, v, 255], i * 4); }
  const r = SBEngine.legacyRun(rgba, w, h, G.cfg);
  check("NFR-10 legacyRun returns nSheets sheets", r.sheets.length === 5);
  check("DEP-04 legacyRun == pre-refactor runPipeline body (masks, loops, bridges)", r.sheets.every((s, k) =>
    H(s.mask) === G.sheets[k].mask && H(Buffer.from(JSON.stringify(s.loops))) === G.sheets[k].loops &&
    (s.bridges ? H(s.bridges) : null) === G.sheets[k].bridges));
});

// ------------------------------------------------ legacy SVG shims frozen (T0.7)
suite("baseline — legacy sheetSVG/proofSVG goldens (T0.7)", () => {
  let G = null; try { G = require("./golden/legacy_svg.json"); } catch (e) { /* missing golden fails below */ }
  const cur = require("./legacy_svg_cases.js").legacySvgCases();
  check("G0 legacy sheetSVG/proofSVG byte-identical to goldens (3 fixtures)", !!G && G.cases.length === 3 &&
    cur.length === 3 && cur.every((c, i) => JSON.stringify(c) === JSON.stringify(G.cases[i])));
});

// ------------------------------------------------ hash (T0.6)
suite("hash.js — SHA-256 (GEO-09, EXP-06, NFR-05)", async () => {
  const enc = (s) => new TextEncoder().encode(s), node = (s) => require("crypto").createHash("sha256").update(s).digest("hex");
  check("hash: NIST empty", SBHash.sha256(enc("")) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  check("hash: NIST abc", SBHash.sha256(enc("abc")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  check("hash: 1e6 x 'a' matches node:crypto", SBHash.sha256(enc("a".repeat(1e6))) === node("a".repeat(1e6)));
  check("hash: 55/56/64-byte padding boundaries", [55, 56, 64].every((n) => SBHash.sha256(enc("x".repeat(n))) === node("x".repeat(n))));
  check("NFR-05 hash.js uses no Math.cbrt/sin/cos", !/Math\.(cbrt|sin|cos|exp|log)/.test(require("fs").readFileSync(require("path").join(__dirname, "../js/hash.js"), "utf8")));
  check("hash: digest == sha256", (await SBHash.digest(enc("abc"))) === SBHash.sha256(enc("abc")));
  check("util: stableStringify sorts keys", SBUtil.stableStringify({ b: 1, a: { d: 2, c: 3 } }) === '{"a":{"c":3,"d":2},"b":1}');
  const throws = (v) => { try { SBUtil.stableStringify(v); return false; } catch (e) { return true; } };
  check("NFR-05 stableStringify rejects non-finite", throws({ x: NaN }));
  check("NFR-05 stableStringify rejects undefined array element", throws([undefined]));
  check("NFR-05 stableStringify rejects typed arrays", throws({ s: new Uint8Array(3) }));
});

// ------------------------------------------------ geometry backend (spike S1, decision D2)
// Plan battery (Task S1 Step 1, check bodies verbatim) — the regression suite for SBGeom (R1).
suite("spike S1 — SBGeom battery (GEO-01/03/09)", () => {
  const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] });
  const G = SBGeom, shoe = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; };
  check("S1 union of two edge-adjacent squares is one polygon", G.union([sq(0,0,10,10)], [sq(10,0,20,10)]).length === 1);
  check("S1 point-touching squares stay two components", G.components(G.union([sq(0,0,10,10)], [sq(10,10,20,20)])).length === 2);
  const donut = G.difference([sq(0,0,30,30)], [sq(10,10,20,20)]);
  check("S1 donut area exact", G.area(donut) === 900 - 100);
  check("S1 donut has one hole", donut.length === 1 && donut[0].holes.length === 1);
  check("S1 difference of identical sets is empty", G.isEmpty(G.difference([sq(0,0,10,10)], [sq(0,0,10,10)])));
  check("S1 coincident partial edge difference is empty", G.isEmpty(G.difference([sq(0,0,10,5)], [sq(0,0,10,10)])));
  check("S1 offset -500µm of 800µm strip is empty", G.isEmpty(G.offset([sq(0,0,800,10000)], -500, "miter")));
  let threw = false; try { G.offset([sq(0,0,10,10)], 1, "round"); } catch (e) { threw = true; }
  check("NFR-05 round join refused", threw);
  check("S1 bowtie rejected", !G.validate([{ outer: [0,0,10,10,10,0,0,10], holes: [] }]).ok);
  check("S1 zero-area ring rejected", !G.validate([{ outer: [0,0,10,0,20,0], holes: [] }]).ok);
  const n = G.normalize(donut);
  check("S1 normalize idempotent", JSON.stringify(G.normalize(n)) === JSON.stringify(n));
  check("S1 outer positive / hole negative area in Y-down", shoe(n[0].outer) > 0 && shoe(n[0].holes[0]) < 0);
  const traced = G.fromPixelLoops(SBTrace.trace(require("./fixtures.js").art(["###", "#.#", "###"]).m, 3, 3), 1000, 1000, 0, 0);
  check("S1 fromPixelLoops reverses trace winding (outer positive)", shoe(G.normalize(traced)[0].outer) > 0);
  const saddle = G.normalize(G.union([sq(0,0,10,10)], [sq(10,10,20,20)]));
  check("GEO-03/D3 saddle → 2 simple rings, validate ok", saddle.length === 2 && G.validate(saddle).ok);
  check("NFR-05 circle has no trig and is symmetric", G.circle(0, 0, 1500).outer.length === 128 && G.area([G.circle(0,0,1500)]) > 0);
  check("S1 results identical across two runs", JSON.stringify(G.union([sq(0,0,7,9)], [sq(3,3,13,13)])) === JSON.stringify(G.union([sq(0,0,7,9)], [sq(3,3,13,13)])));
});

suite("spike S1 — vendor load forms and pin (NFR-11)", () => {
  const vendorFile = require("./modules.js").NODE_MODULES.find((m) => m.startsWith("vendor/"));
  const src = require("fs").readFileSync(require("path").join(__dirname, "../js/vendor", vendorFile.slice(7)), "utf8");
  check("NFR-11 vendor loads as a classic script in a fresh vm context", (() => { const c = require("vm").createContext({}); c.globalThis = c; require("vm").runInContext(src, c); return Object.keys(c).length > 1; })());
  check("NFR-11 vendor has no import/export statements", !/^\s*(import|export)\s/m.test(src));
  // The plan's line-start regex misses minified `export{…}` mid-line (spike S1 Finding 3); this one does not.
  check("NFR-11 vendor has no import/export anywhere (not only at line start)",
    !/\bimport\s*[{*"'(]|import\.meta|\bexport\s*[{*]|\bexport\s+(default|const|let|var|function|class)\b/.test(src));
  check("NFR-11 vendor references no DOM / require / process / Function constructor",
    !/\b(document|window\.|require\(|process\.|new Function)\b/.test(src.replace(/typeof window !== "undefined" \? window : globalThis/, "")));
  check("NFR-11 vendor runs as a strict IIFE and sets exactly global.Clipper2",
    (() => { const c = require("vm").createContext({}); require("vm").runInContext(src, c); return JSON.stringify(Object.keys(c)) === '["Clipper2"]'; })());
  check("NFR-11 vendor loads in a worker-like global (self, importScripts form)",
    (() => { const c = require("vm").createContext({}); c.self = c; new (require("vm").Script)(src).runInContext(c); return typeof c.Clipper2.union === "function"; })());
  check("NFR-05 vendor has no Math.random / Date", !/Math\.random|\bDate\b/.test(src));
  const sha = require("crypto").createHash("sha256").update(fs.readFileSync(path.join(__dirname, "../js/vendor/clipper2.js"))).digest("hex");
  const comp = fs.readFileSync(path.join(__dirname, "../docs/COMPONENTS.md"), "utf8");
  const row = comp.split("\n").find((l) => l.includes("js/vendor/clipper2.js")) || "";
  check("NFR-11 js/vendor/clipper2.js SHA-256 matches the pinned wrap output", sha === "3770b90cddbfca46596ef944117f66c67325870708ffd7eb7aa289080b888994");
  check("NFR-11 COMPONENTS.md row: clipper2-ts 2.0.1-18, BSL-1.0, SHA-256, shim, runtime",
    /clipper2-ts/.test(row) && /2\.0\.1-18/.test(row) && /BSL-1\.0/.test(row) && row.includes(sha) && /shim/.test(row) && /runtime/.test(row));
  const lic = (() => { try { return fs.readFileSync(path.join(__dirname, "../js/vendor/LICENSE-clipper2.txt"), "utf8"); } catch (e) { return ""; } })();
  check("NFR-11 js/vendor/LICENSE-clipper2.txt is the Boost Software License 1.0", /Boost Software License - Version 1\.0/.test(lic));
  check("D2 SBGeom.backend names the pinned library", SBGeom.backend === "clipper2-ts@2.0.1-18");
});

suite("spike S1 — SBGeom extended robustness (beyond the plan battery)", () => {
  const G = SBGeom, F = require("./fixtures.js");
  const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] });
  const safe = (fn) => { try { return fn(); } catch (e) { return false; } };
  const rng = F.lcg(7), ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  // random orthogonal unions of rectangles on a 200 µm lattice
  const randOrtho = () => { let acc = []; for (let k = 0; k < 6; k++) { const x = ri(0, 20) * 200, y = ri(0, 20) * 200; acc = G.union(acc, [sq(x, y, x + ri(1, 8) * 200, y + ri(1, 8) * 200)]); } return acc; };
  let incl = 0, part = 0, valid = 0, idem = 0, threw = 0; const nCase = 150;
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
  check(`GEO-01 inclusion–exclusion exact on ${nCase} random orthogonal pairs (${incl}/${nCase})`, incl === nCase);
  check(`GEO-01 A = (A−B) ⊔ (A∩B) exactly (${part}/${nCase})`, part === nCase);
  check(`GEO-03 every boolean output validates (${valid}/${nCase})`, valid === nCase);
  check(`GEO-03 every boolean output is already normalized (${idem}/${nCase})`, idem === nCase);
  check(`S1 no throws on random orthogonal cases (${threw})`, threw === 0);

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
  check(`GEO-09 randomNestedStack ×${NS}: area = pixels·sx·sy exactly, validate ok, L_k − L_(k−1) = ∅ (${okStack}/${NS})`, okStack === NS);

  const cb = []; for (let y = 0; y < 8; y++) { let row = ""; for (let x = 0; x < 8; x++) row += (x + y) % 2 ? "#" : "."; cb.push(row); }
  const cbp = G.union(G.fromPixelLoops(SBTrace.trace(F.art(cb).m, 8, 8), 1000, 1000, 0, 0), []);
  check("GEO-03/D3 8×8 checkerboard → 32 components, validate ok", safe(() => G.components(cbp).length === 32 && G.validate(cbp).ok));
  const pinch = G.difference([sq(0, 0, 30, 30)], [sq(0, 0, 10, 10), sq(10, 10, 20, 20)]);
  check("GEO-03 pinched hole (vertex-touching) → simple rings, validate ok, area exact", safe(() => G.validate(pinch).ok && G.area(pinch) === 900 - 200));
  check("AT-06 pinched hole is ONE component with one hole", safe(() => G.components(pinch).length === 1 && pinch.length === 1 && pinch[0].holes.length === 1));
  const twoL = G.union(G.fromPixelLoops(SBTrace.trace(F.art(["###.", "#..#", "#..#", ".###"]).m, 4, 4), 1000, 1000, 0, 0), []);
  check("AT-06 two L-shapes touching diagonally at 2 points → 2 components, no holes, validate ok",
    safe(() => G.components(twoL).length === 2 && twoL.every((p) => p.holes.length === 0) && G.validate(twoL).ok));
  const twoLb = G.union([{ outer: [0,0,3000,0,3000,1000,1000,1000,1000,3000,0,3000], holes: [] }], [{ outer: [3000,1000,4000,1000,4000,4000,1000,4000,1000,3000,3000,3000], holes: [] }]);
  check("AT-06/D4 same L-shapes built by polygon union (backend chaining) → identical canonical output", safe(() => G.components(twoLb).length === 2 && JSON.stringify(twoLb) === JSON.stringify(twoL)));

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
  check(`AT-06/D3 components(L_(k−1) − L_k) = 4-connected pixel components (${cOk}/${cN}; seed 23 k=1 needs canonical re-chaining)`, cOk === cN);

  const r = [sq(0, 0, 1000, 600)];
  check("GEO-05 offset +250 miter of 1000×600 = 1500×1100 exactly", safe(() => G.area(G.offset(r, 250, "miter")) === 1500 * 1100));
  check("GEO-05 offset −250 miter of 1000×600 = 500×100 exactly", safe(() => G.area(G.offset(r, -250, "miter")) === 500 * 100));
  check("GEO-05 offset +d then −d restores a rectangle exactly", safe(() => JSON.stringify(G.offset(G.offset(r, 300, "miter"), -300, "miter")) === JSON.stringify(G.normalize(r))));
  const Lsh = G.union([sq(0, 0, 3000, 1000)], [sq(0, 0, 1000, 3000)]);
  check("GEO-05 offset −400 miter of an L-shape: area exact", safe(() => G.area(G.offset(Lsh, -400, "miter")) === 2200 * 200 + 200 * 2200 - 200 * 200));
  check("GEO-05 \"square\" join is Clipper2's chamfer (+200 on 1000²: 1 932 622 µm², not the miter 1 960 000)",
    safe(() => G.area(G.offset([sq(0, 0, 1000, 1000)], 200, "square")) === 1932622));
  let nonInt = false; try { G.offset(r, 0.5, "miter"); } catch (e) { nonInt = true; }
  check("GEO-09 offset refuses a non-integer delta", nonInt);

  const circ = safe(() => G.difference([sq(-5000, -5000, 5000, 5000)], [G.circle(0, 0, 1500)]));
  check("ASM-04 square minus SBGeom.circle (registration hole) → one ring with one hole, area within 0.5 %",
    !!circ && G.validate(circ).ok && circ[0].holes.length === 1 && Math.abs(G.area(circ) - (1e8 - Math.PI * 1500 * 1500)) < 0.005 * Math.PI * 1500 * 1500);
  check("GEO-01 diagonal edge boolean exact (triangle ∪ square, area 1 375 000)",
    safe(() => G.area(G.union([{ outer: [0, 0, 1000, 0, 0, 1000], holes: [] }], [sq(500, 0, 1500, 1000)])) === 500000 + 1000000 - 125000));
  const big = G.union([sq(0, 0, 999999, 999999)], [sq(500000, 500000, 1000000, 1000001)]);
  check("GEO-09 1 m page coordinates: union area exact", safe(() => G.area(big) === 999999 * 999999 + 500000 * 500001 - 499999 * 499999));
  const dn = G.difference([sq(0, 0, 30, 30)], [sq(10, 10, 20, 20)]);
  check("S1 containsPoint: boundary counts as inside, hole interior outside", G.containsPoint(dn, [10, 15]) && !G.containsPoint(dn, [15, 15]));
});

suite("spike S1 — SBGeom.circle symmetry and validity (NFR-05, ASM-04)", () => {
  const G = SBGeom;
  const sym8 = (cx, cy, r) => {
    const c = G.circle(cx, cy, r).outer, set = new Set();
    for (let i = 0; i < c.length; i += 2) set.add((c[i] - cx) + "," + (c[i + 1] - cy));
    for (let i = 0; i < c.length; i += 2) { const x = c[i] - cx, y = c[i + 1] - cy;
      if (!set.has(-x + "," + y) || !set.has(x + "," + -y) || !set.has(y + "," + x)) return false; }
    return true;
  };
  check("NFR-05 circle 8-fold symmetric at r=1500 about the origin", sym8(0, 0, 1500));
  // r·cos = …500000 exactly → a .5 tie; Math.round(cx + t) rounds +x.5 up but −x.5 toward zero.
  check("NFR-05 circle 8-fold symmetric on exact .5 ties (r=500000) and off-origin centres", sym8(0, 0, 500000) && sym8(12345, -678, 500000) && sym8(-7, 3, 2500));
  const radii = []; for (let r = 1; r <= 4000; r += r < 64 ? 1 : 37) radii.push(r);
  const bad = radii.filter((r) => { const c = [G.circle(1000, 2000, r)]; return !G.validate(c).ok || JSON.stringify(G.normalize(c)) !== JSON.stringify(c); });
  check(`GEO-03 circle validates and is already normalized for every radius 1…4000 µm (${radii.length - bad.length}/${radii.length}${bad.length ? "; bad r=" + bad.slice(0, 5).join(",") : ""})`, bad.length === 0);
  check("NFR-05 circle keeps all 64 vertices at a 1.5 mm radius", G.circle(0, 0, 1500).outer.length === 128);
  let threw = false; try { G.circle(0.5, 0, 10); } catch (e) { threw = true; }
  check("GEO-09 circle refuses non-integer centre/radius", threw);
  check("NFR-05 geom.js uses no trig / Math.random / Date", !/Math\.(sin|cos|tan|atan2?|acos|asin|exp|log|cbrt|random)\b|\bDate\b/.test(fs.readFileSync(path.join(__dirname, "../js/geom.js"), "utf8")));
});

suite("spike S1 — SBGeom.validate edge cases (GEO-03)", () => {
  const G = SBGeom;
  check("GEO-03 validate: empty list is ok", G.validate([]).ok);
  check("GEO-03 validate: non-integer coordinate → GEO_OPEN", G.validate([{ outer: [0, 0, 10, 0, 10, 10.5], holes: [] }]).errors.some((e) => e.code === "GEO_OPEN"));
  check("GEO-03 validate: missing outer → GEO_OPEN (no throw)", (() => { try { return G.validate([{ holes: [] }]).errors[0].code === "GEO_OPEN"; } catch (e) { return false; } })());
  check("GEO-03 validate: odd-length ring → GEO_OPEN", G.validate([{ outer: [0, 0, 10, 0, 10, 10, 0], holes: [] }]).errors[0].code === "GEO_OPEN");
  check("GEO-03 validate: repeated consecutive vertex → GEO_DUPLICATE", G.validate([{ outer: [0, 0, 10, 0, 10, 0, 10, 10, 0, 10], holes: [] }]).errors[0].code === "GEO_DUPLICATE");
  check("GEO-03 validate: the same ring twice (either orientation) → GEO_DUPLICATE",
    G.validate([{ outer: [0, 0, 10, 0, 10, 10, 0, 10], holes: [] }, { outer: [0, 0, 0, 10, 10, 10, 10, 0], holes: [] }]).errors.some((e) => e.code === "GEO_DUPLICATE"));
  check("GEO-03 validate: hole crossing its outer → GEO_SELF_INTERSECT",
    G.validate([{ outer: [0, 0, 10, 0, 10, 10, 0, 10], holes: [[5, 5, 5, 15, 15, 15, 15, 5]] }]).errors.some((e) => e.code === "GEO_SELF_INTERSECT"));
  check("GEO-03 validate: spike (edge doubling back) → GEO_SELF_INTERSECT", !G.validate([{ outer: [0, 0, 10, 0, 20, 0, 10, 0, 10, 10], holes: [] }]).ok);
  check("GEO-03 validate: ring revisiting a vertex (unsplit saddle) → GEO_SELF_INTERSECT",
    G.validate([{ outer: [0, 0, 10, 0, 10, 10, 20, 10, 20, 20, 10, 20, 10, 10, 0, 10], holes: [] }]).errors.some((e) => e.code === "GEO_SELF_INTERSECT"));
  // A ring whose first vertex is repeated used to lose a corner in normalization (both copies of a
  // duplicate were dropped together with the stale wrap-around neighbour) — found via SBGeom.circle(…, 1).
  const dupStart = G.normalize([{ outer: [1, 0, 1, 0, 1, 1, 1, 1, 0, 1, -1, 1, -1, 0, -1, -1, 0, -1, 1, -1], holes: [] }]);
  check("GEO-03 normalize: duplicate + collinear vertices at the ring start keep every corner (2×2 square)",
    dupStart.length === 1 && G.area(dupStart) === 4 && JSON.stringify(dupStart[0].outer) === JSON.stringify([-1, -1, 1, -1, 1, 1, -1, 1]));
  check("GEO-03 validate: two simple rings sharing one vertex (split saddle) are ok", G.validate(G.union([{ outer: [0,0,10,0,10,10,0,10], holes: [] }], [{ outer: [10,10,20,10,20,20,10,20], holes: [] }])).ok);
  check("GEO-03 validate: error ring ids name poly and ring index",
    (() => { const e = G.validate([{ outer: [0,0,10,0,10,10,0,10], holes: [] }, { outer: [0,0,10,10,10,0,0,10], holes: [] }]).errors; return e.length === 1 && e[0].ring.poly === 1 && e[0].ring.ring === 0; })());
});

suite("spike S1 — test/bench.js geom smoke (--quick)", () => {
  const out = path.join(require("os").tmpdir(), "sb-bench-geom-" + process.pid + ".json");
  let r = null;
  try {
    require("child_process").execFileSync(process.execPath, [path.join(__dirname, "bench.js"), "geom", "--quick", "--json", out], { stdio: "ignore" });
    r = JSON.parse(fs.readFileSync(out, "utf8"));
  } catch (e) { /* r stays null */ } finally { try { fs.unlinkSync(out); } catch (e) { /* none */ } }
  check("bench geom --quick runs and writes JSON", !!r && r.stage === "geom" && r.backend === SBGeom.backend);
  check("bench geom: B1 input nested and areas exact", !!r && r.sanityB1.contained && r.sanityB1.areasExact);
  check("bench geom: reports B1, B2, B3 and B3b with budgets 2 s / 3 s / 6 s", !!r &&
    ["B1_difference", "B2_offset_inset1500", "B2_offset_grow300", "B3_supportPairs", "B3b_supportPairs_dense"].every((k) => r[k] && r[k].p95Ms >= 0) &&
    r.budgetsMs.B1 === 2000 && r.budgetsMs.B3 === 3000 && r.budgetsMs.B3b === 6000);
  check("bench geom: B1 overrun is tracked (KI-B1, G4.4) as KNOWN-OVER, never in overBudget", !!r && r.tracked && r.tracked.B1 && r.tracked.B1.id === "KI-B1" &&
    /G4\.4/.test(r.tracked.B1.ref) && Array.isArray(r.knownOver) && !r.overBudget.includes("B1"));
  check("bench geom: support pass finds pairs and containment on the dense stack", !!r && r.B3b_supportPairs_dense.pairs > 0 && r.B3b_supportPairs_dense.contained &&
    r.B3b_supportPairs_dense_partsGiven.pairs === r.B3b_supportPairs_dense.pairs);
});

// ------------------------------------------------ canonical bytes and hash scope (spike S6, decision D4)
const S6 = (() => {
  const rect = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
  const rot = (r, k) => r.slice(2 * k).concat(r.slice(0, 2 * k));
  const rev = (r) => { const o = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; };
  const shuffle = (a, seed) => { const rnd = require("./fixtures.js").lcg(seed), b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
  const noise = (w, h, seed, p) => { const rnd = require("./fixtures.js").lcg(seed), m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = rnd() < p ? 1 : 0; return m; };
  const pixelSquares = (m, w, h, s) => { const out = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) out.push({ outer: rect(x * s, y * s, (x + 1) * s, (y + 1) * s), holes: [] }); return out; };
  // A small layer: L-shaped part with a hole, a triangle, a square with a hole; one score path; one registration hole.
  const Lshape = { outer: [0, 0, 6000, 0, 6000, 2000, 2000, 2000, 2000, 8000, 0, 8000], holes: [rev(rect(500, 500, 1500, 1500))] };
  const tri = { outer: [10000, 0, 14000, 0, 12000, 3000], holes: [] };
  const sq = { outer: rect(20000, 5000, 23000, 8000), holes: [[20500, 5500, 20500, 6500, 21500, 6500, 21500, 5500]] };
  const base = { index: 3, material: [Lshape, tri, sq], scorePaths: [[1000, 9000, 4000, 9000, 4000, 12000]], holes: [{ cxUm: 30000, cyUm: 30000, rUm: 1500 }] };
  // Raw Clipper2 (the call underneath SBGeom.union/difference, BEFORE assemble()): rings classified by sign only,
  // all negative rings handed in as holes of the first outer (normalize flattens the rings, so grouping is irrelevant).
  const a2 = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a; };
  const paths = (polys) => polys.flatMap((p) => [a2(p.outer) > 0 ? p.outer : rev(p.outer), ...(p.holes || []).map((h) => (a2(h) < 0 ? h : rev(h)))])
    .map((r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push({ x: r[i], y: r[i + 1] }); return o; });
  const raw = (op, a, b) => {
    const C2 = globalThis.Clipper2, rings = C2[op](paths(a), paths(b || []), C2.FillRule.NonZero).map((p) => p.flatMap((q) => [q.x, q.y]));
    const pos = rings.filter((r) => a2(r) > 0), neg = rings.filter((r) => a2(r) < 0);
    return pos.length ? [{ outer: pos[0], holes: neg }, ...pos.slice(1).map((o) => ({ outer: o, holes: [] }))] : [];
  };
  const mapPolys = (polys, f) => { const m = (r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(...f(r[i], r[i + 1])); return o; };
    return polys.map((p) => ({ outer: m(p.outer), holes: (p.holes || []).map(m) })); };
  /** Brute-force O(V·E): does any vertex lie strictly inside an edge of any ring (a T-contact)? */
  const hasT = (polys) => {
    const rings = polys.flatMap((p) => [p.outer, ...p.holes]), V = [];
    for (const r of rings) for (let i = 0; i < r.length; i += 2) V.push(r[i], r[i + 1]);
    for (const r of rings) for (let i = 0, n = r.length >> 1; i < n; i++) {
      const j = (i + 1) % n, ax = r[2 * i], ay = r[2 * i + 1], bx = r[2 * j], by = r[2 * j + 1];
      for (let v = 0; v < V.length; v += 2) { const x = V[v], y = V[v + 1];
        if ((x === ax && y === ay) || (x === bx && y === by) || (bx - ax) * (y - ay) !== (by - ay) * (x - ax)) continue;
        if (x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true; }
    }
    return false;
  };
  return { rect, rot, rev, shuffle, throws, noise, pixelSquares, raw, mapPolys, hasT, Lshape, tri, sq, base };
})();

suite("spike S6 — plan checks (GEO-09, NFR-05)", () => {
  const G = SBGeom, { rot, rev, shuffle, Lshape, tri, sq, base } = S6, H = (L) => G.layerHash(L), h0 = H(base);
  check("S6/GEO-09 hash invariant to start vertex", H({ ...base, material: base.material.map((p) => ({ outer: rot(p.outer, 2), holes: p.holes.map((h) => rot(h, 2)) })) }) === h0);
  check("S6 hash invariant to input winding", H({ ...base, material: base.material.map((p) => ({ outer: rev(p.outer), holes: p.holes.map(rev) })) }) === h0);
  check("S6 hash invariant to part order", [1, 2, 3, 4, 5].every((s) => H({ ...base, material: shuffle(base.material, s) }) === h0) && H({ ...base, material: base.material.slice().reverse() }) === h0);
  check("S6 1µm move changes hash", H({ ...base, material: [{ outer: [0, 0, 6001, 0, 6001, 2000, 2000, 2000, 2000, 8000, 0, 8000], holes: Lshape.holes }, tri, sq] }) !== h0);
  check("S6 1µm move changes hash (whole part translated by 1 µm in y)", H({ ...base, material: [Lshape, { outer: tri.outer.map((v, i) => (i % 2 ? v + 1 : v)), holes: [] }, sq] }) !== h0);
  check("S6 score path change changes hash", H({ ...base, scorePaths: [[1000, 9000, 4000, 9000, 4000, 12001]] }) !== h0);
  check("S6 score path removal changes hash", H({ ...base, scorePaths: [] }) !== h0);
  check("S6 layerHash = SBHash.sha256(canonicalBytes([layer]))", h0 === SBHash.sha256(G.canonicalBytes([base])));
});

suite("spike S6 — canonicalBytes layout and D4 hash scope (amendments A, B, C)", () => {
  const G = SBGeom, { rect, rot, rev, throws, base } = S6, H = (L) => G.layerHash(L), M = (L) => G.materialHash(L), h0 = H(base), m0 = M(base);
  const words = (u8) => Array.from(new Int32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4));
  const tiny = G.canonicalBytes([{ index: 2, material: [{ outer: rev(rect(0, 0, 10, 10)), holes: [] }], scorePaths: [[5, 5, 1, 1]] }]);
  check("S6 byte layout = [layerCount, index, partCount, ringCount, vertexCount, x,y…, scoreCount, vertexCount, x,y…, holeCount]",
    JSON.stringify(words(tiny)) === JSON.stringify([1, 2, 1, 1, 4, 0, 0, 10, 0, 10, 10, 0, 10, 1, 2, 1, 1, 5, 5, 0]));
  check("S6 little-endian int32 (first word bytes 01 00 00 00)", tiny instanceof Uint8Array && tiny[0] === 1 && tiny[1] === 0 && tiny[2] === 0 && tiny[3] === 0);
  check("D4-A hole section: (cx, cy, r) words after the score section, sorted by (cy, cx, r)",
    JSON.stringify(words(G.canonicalBytes([{ index: 0, material: [], holes: [{ cxUm: 9, cyUm: 5, rUm: 3 }, { cxUm: 1, cyUm: 2, rUm: 4 }] }]))) === JSON.stringify([1, 0, 0, 0, 2, 1, 2, 4, 9, 5, 3]));
  check("D4 empty layer hashes [1, k, 0, 0, 0]", H({ index: 7, material: [] }) === SBHash.sha256(new Uint8Array(new Int32Array([1, 7, 0, 0, 0]).buffer)) &&
    H({ index: 7, material: [] }) === H({ index: 7, material: [], scorePaths: [], holes: [] }));
  check("S6 layer index enters hash", H({ ...base, index: 4 }) !== h0);
  check("S6 duplicate layer index throws (bytes would depend on input order)", throws(() => G.canonicalBytes([base, { ...base, scorePaths: [] }])) &&
    throws(() => G.canonicalBytes([{ index: 1, material: [] }, { index: 1, material: [] }])));
  check("S6 multi-layer stream independent of input layer order", SBHash.sha256(G.canonicalBytes([base, { ...base, index: 0 }])) === SBHash.sha256(G.canonicalBytes([{ ...base, index: 0 }, base])));
  check("S6 score path direction invariant", H({ ...base, scorePaths: [rev(base.scorePaths[0])] }) === h0);
  check("S6 score path pass-through collinear point removed", H({ ...base, scorePaths: [[1000, 9000, 2500, 9000, 4000, 9000, 4000, 12000]] }) === h0);
  check("S6 score path duplicate point removed", H({ ...base, scorePaths: [[1000, 9000, 4000, 9000, 4000, 9000, 4000, 12000]] }) === h0);
  check("S6 score path reversal (U-turn) point kept", H({ ...base, scorePaths: [[1000, 9000, 4000, 9000, 3000, 9000]] }) !== H({ ...base, scorePaths: [[1000, 9000, 3000, 9000]] }));
  check("S6 out-and-back score path (returns to its start, no area) is kept as an open path, not dropped",
    H({ ...base, scorePaths: [[0, 0, 10, 0, 0, 0]] }) !== H({ ...base, scorePaths: [] }) &&
    JSON.stringify(G.canonicalBytes([{ index: 0, material: [], scorePaths: [[0, 0, 10, 0, 20, 0, 0, 0]] }])) === JSON.stringify(G.canonicalBytes([{ index: 0, material: [], scorePaths: [[0, 0, 20, 0, 0, 0]] }])) &&
    words(G.canonicalBytes([{ index: 0, material: [], scorePaths: [[0, 0, 10, 0, 0, 0]] }])).join() === "1,0,0,1,3,0,0,10,0,0,0,0");
  const two = { ...base, scorePaths: [[0, 0, 0, 5], [7, 7, 9, 9]] };
  check("S6 score path order invariant", H(two) === H({ ...two, scorePaths: two.scorePaths.slice().reverse() }));
  check("S6 closed score ring start/direction invariant", H({ ...base, scorePaths: [[100, 100, 900, 100, 900, 900, 100, 900, 100, 100]] }) === H({ ...base, scorePaths: [[900, 900, 900, 100, 100, 100, 100, 900, 900, 900]] }));
  const L0 = (sp) => G.layerHash({ index: 0, material: [], scorePaths: [sp] });
  const ring = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0], tail = [0, 0, 100, 0, 100, 50, 200, 50, 100, 50, 100, 100, 0, 100, 0, 0];
  check("S6 closed score ring with an out-and-back tail hashes differently from the plain ring (spikes kept)", L0(tail) !== L0(ring) &&
    L0(tail) === L0(rev(tail)) && L0(tail) === L0(rot(tail.slice(0, -2), 3).concat(rot(tail.slice(0, -2), 3).slice(0, 2))));
  check("S6 closed score ring: duplicate and pass-through points removed cyclically, incl. across the closing point",
    L0(ring) === L0([50, 0, 100, 0, 100, 100, 0, 100, 0, 0, 0, 0, 50, 0]) && L0(ring) === L0([0, 50, 0, 0, 100, 0, 100, 100, 0, 100, 0, 50]));
  const closedCases = [[0, 0, 10, 0, 10, 10, 10, 0, 20, 0, 0, 0], [0, 0, 10, 10, 10, 0, 0, 10, 0, 0], [0, 0, 10, 0, 0, 0], [5, 5, 0, 0, 10, 0, 0, 0, 5, 5]];
  check("S6 degenerate closed score paths (zero area, bowtie, out-and-back) are start- and direction-invariant", closedCases.every((c) => {
    const cyc = c.slice(0, -2), n = cyc.length >> 1, h = L0(c);
    for (let k = 0; k < n; k++) for (const r of [rot(cyc, k), rev(rot(cyc, k))]) if (L0(r.concat(r.slice(0, 2))) !== h) return false;
    return true;
  }));
  check("D4-A registration hole radius change changes hash", H({ ...base, holes: [{ cxUm: 30000, cyUm: 30000, rUm: 1501 }] }) !== h0 && M({ ...base, holes: [{ cxUm: 30000, cyUm: 30000, rUm: 1501 }] }) !== m0);
  check("D4-A registration hole that misses material still changes hash", H({ ...base, holes: [] }) !== h0);
  check("D4-A registration hole order invariant", H({ ...base, holes: [{ cxUm: 1, cyUm: 2, rUm: 3 }, { cxUm: 4, cyUm: 1, rUm: 3 }] }) === H({ ...base, holes: [{ cxUm: 4, cyUm: 1, rUm: 3 }, { cxUm: 1, cyUm: 2, rUm: 3 }] }));
  check("D4-B materialHash ignores score paths (breaks the guide/hash cycle)", M({ ...base, scorePaths: [] }) === m0 && M({ ...base, scorePaths: [[0, 0, 5, 5]] }) === m0);
  check("D4-B materialHash = sha256(canonicalBytes([{index, material, holes}])) (scoreCount 0)", m0 === SBHash.sha256(G.canonicalBytes([{ index: base.index, material: base.material, holes: base.holes }])));
  check("D4-B materialHash changes on a 1 µm material move", M({ ...base, material: [{ outer: [0, 0, 6001, 0, 6001, 2000, 2000, 2000, 2000, 8000, 0, 8000], holes: base.material[0].holes }, ...base.material.slice(1)] }) !== m0 &&
    M({ ...base, material: [base.material[0], { outer: base.material[1].outer.map((v, i) => (i % 2 ? v + 1 : v)), holes: [] }, base.material[2]] }) !== m0);
  check("D4-B materialHash changes on layer index and on part removal", M({ ...base, index: 4 }) !== m0 && M({ ...base, material: base.material.slice(1) }) !== m0);
  check("D4-B layerHash != materialHash when score paths exist, equal when none", h0 !== m0 && H({ ...base, scorePaths: [] }) === m0);
  const both = G.layerHashes(base);
  check("D4-B layerHashes(layer) returns both hashes from one normalization", both.materialHash === m0 && both.layerHash === h0);
  check("D4-C non-integer coordinate throws", throws(() => G.canonicalBytes([{ index: 0, material: [{ outer: [0, 0, 10.5, 0, 10, 10], holes: [] }] }])));
  check("D4-C coordinate beyond ±2^25 µm throws (never truncates)", throws(() => G.canonicalBytes([{ index: 0, material: [{ outer: [0, 0, 2 ** 26, 0, 10, 10], holes: [] }] }])) &&
    !throws(() => G.canonicalBytes([{ index: 0, material: [{ outer: [0, 0, 2 ** 25, 0, 10, 10], holes: [] }] }])));
  check("D4-C non-integer / out-of-range score path, hole or index throws", throws(() => G.canonicalBytes([{ index: 0, material: [], scorePaths: [[0, 0, 1.5, 0]] }])) &&
    throws(() => G.canonicalBytes([{ index: 0, material: [], holes: [{ cxUm: 0, cyUm: -(2 ** 25) - 1, rUm: 1 }] }])) && throws(() => G.canonicalBytes([{ index: 0.5, material: [] }])));
  check("S6 hole with no containing outer throws (amendment C: never dropped silently)",
    throws(() => G.canonicalBytes([{ index: 0, material: [{ outer: rect(0, 0, 10, 10), holes: [rect(100, 100, 110, 110)] }] }])) &&
    throws(() => G.canonicalBytes([{ index: 0, material: [{ outer: rect(0, 0, 10, 10), holes: [] }, { outer: rect(50, 50, 60, 60), holes: [rect(100, 100, 110, 110)] }] }])) &&
    !throws(() => G.canonicalBytes([{ index: 0, material: [{ outer: rect(0, 0, 10, 10), holes: [rect(2, 2, 8, 8)] }] }])));
  check("S6 registration hole radius <= 0 and negative layer index throw", throws(() => G.canonicalBytes([{ index: 0, material: [], holes: [{ cxUm: 0, cyUm: 0, rUm: -5 }] }])) &&
    throws(() => G.canonicalBytes([{ index: 0, material: [], holes: [{ cxUm: 0, cyUm: 0, rUm: 0 }] }])) && throws(() => G.canonicalBytes([{ index: -1, material: [] }])));
  check("S6 typed-array ring is refused with the real reason (not 'odd coordinate count')", (() => {
    try { G.canonicalBytes([{ index: 0, material: [{ outer: new Int32Array([0, 0, 10, 0, 10, 10]), holes: [] }] }]); return false; } catch (e) { return /plain Array/.test(e.message) && /Int32Array/.test(e.message); } })());
  check("S6 typed-array score path and hole ring refused with the real reason", [
    { index: 0, material: [], scorePaths: [new Float64Array([0, 0, 10, 0])] },
    { index: 0, material: [{ outer: rect(0, 0, 10, 10), holes: [new Int32Array([2, 2, 2, 8, 8, 8, 8, 2])] }] }].every((L) => {
    try { G.canonicalBytes([L]); return false; } catch (e) { return /plain Array/.test(e.message) && /(Float64|Int32)Array/.test(e.message); } }));
  check("S6 guards apply to layerHashes too (orphan hole, negative index, radius <= 0, typed array)",
    throws(() => G.layerHashes({ index: 0, material: [{ outer: rect(0, 0, 10, 10), holes: [rect(100, 100, 110, 110)] }] })) &&
    throws(() => G.layerHashes({ index: -1, material: [] })) && throws(() => G.layerHashes({ index: 0, material: [], holes: [{ cxUm: 0, cyUm: 0, rUm: 0 }] })) &&
    throws(() => G.layerHashes({ index: 0, material: [], scorePaths: [new Int32Array([0, 0, 1, 1])] })));
  // A hole congruent to its outer is not inside it (same area): without the orphan throw the layer would hash as the solid square.
  check("S6 hole identical to its outer throws (would otherwise hash as solid material)",
    throws(() => G.canonicalBytes([{ index: 0, material: [{ outer: rect(0, 0, 10, 10), holes: [rect(0, 0, 10, 10)] }] }])));
  // Interaction with the D3 normalize (node → re-pair → split → nest): holes that touch the outer or each other at a
  // vertex or T-contact are boolean-resolved input; re-pairing may turn them into outer boundary or new parts, but never
  // into orphans, and the bytes equal those of the normalized input.
  {
    const sq = rect(0, 0, 100, 100), cases = [
      [{ outer: sq, holes: [[0, 0, 50, 20, 20, 50]] }], // hole touches the outer at a corner
      [{ outer: sq, holes: [[50, 0, 60, 20, 40, 20]] }], // hole vertex on the outer's edge (T)
      [{ outer: sq, holes: [rect(10, 10, 50, 50), rect(50, 50, 90, 90)] }], // two holes touching at a vertex
      [{ outer: sq, holes: [[0, 50, 25, 60, 50, 50, 25, 40], [50, 50, 75, 60, 100, 50, 75, 40]] }], // T-chain cutting the interior in two
      [{ outer: sq, holes: [[50, 0, 100, 50, 50, 100, 0, 50]] }], // diamond hole with all four corners on the outer
      [{ outer: rect(0, 0, 30, 30), holes: [rect(10, 10, 20, 20)] }, { outer: rect(10, 10, 15, 15), holes: [] }]]; // island touching its hole
    const same = (m) => { const a = G.canonicalBytes([{ index: 0, material: m }]), b = G.canonicalBytes([{ index: 0, material: G.normalize(m) }]);
      return a.length === b.length && a.every((v, i) => v === b[i]); };
    check("D3×D4 holes touching the outer / each other (vertex, T, interior cut) hash without orphan throw, = canonicalBytes(normalize)",
      cases.every((m) => !throws(() => G.canonicalBytes([{ index: 0, material: m }])) && same(m)));
    check("D3×D4 holes whose T-chain cuts the interior come out as two one-part polygons", (() => {
      const n = G.normalize(cases[3]); return n.length === 2 && n.every((p) => p.holes.length === 0 && G.interiorConnected(p)); })());
  }
  check("S6 score path with fewer than two distinct points has no segment: dropped (documented), hashes like no path",
    [[], [5, 5], [5, 5, 5, 5]].every((sp) => G.layerHash({ index: 0, material: [], scorePaths: [sp] }) === G.layerHash({ index: 0, material: [], scorePaths: [] })) &&
    G.layerHash({ index: 0, material: [], scorePaths: [[5, 5, 6, 5]] }) !== G.layerHash({ index: 0, material: [], scorePaths: [] }));
  check("S6 closed score paths: fuzzed cycles on a 3×3 grid (dups, spikes, bowties, out-and-backs) start- and direction-invariant", (() => {
    const rnd = require("./fixtures.js").lcg(606), L0 = (sp) => G.layerHash({ index: 0, material: [], scorePaths: [sp] });
    for (let s = 0; s < 400; s++) {
      const n = 2 + Math.floor(rnd() * 6), c = []; for (let i = 0; i < n; i++) c.push(Math.floor(rnd() * 3), Math.floor(rnd() * 3));
      const h = L0(c.concat(c.slice(0, 2)));
      for (let k = 0; k < n; k++) for (const q of [rot(c, k), rev(rot(c, k))]) if (L0(q.concat(q.slice(0, 2))) !== h) return false;
      if (L0(c) !== L0(rev(c))) return false;
    }
    return true;
  })());
  check("S6 zero-area part dropped", H({ ...base, material: [...base.material, { outer: [0, 50000, 100, 50000, 200, 50000], holes: [] }] }) === h0);
  check("S6 SBHash.sha256(canonicalBytes) == node:crypto", SBHash.sha256(G.canonicalBytes([base])) === require("crypto").createHash("sha256").update(G.canonicalBytes([base])).digest("hex"));
  check("S6 canonicalBytes does not mutate its input", (() => { const s = JSON.stringify(base); G.canonicalBytes([base]); return JSON.stringify(base) === s; })());
});

suite("spike S6 — normalization contract and D3 saddles / T-contacts", () => {
  const G = SBGeom, { rect, rev, Lshape, tri, sq, base } = S6, H = (L) => G.layerHash(L), h0 = H(base);
  const n = G.normalize(base.material);
  const starts = (r) => { for (let i = 2; i < r.length; i += 2) if (r[i] < r[0] || (r[i] === r[0] && r[i + 1] < r[1])) return false; return true; };
  check("S6 every ring starts at lexicographically smallest (x, y)", n.every((p) => [p.outer, ...p.holes].every(starts)));
  check("S6 parts sorted by (minY, minX)", n.map((p) => p.outer[0]).join() === "0,10000,20000");
  check("S6 hole order invariant", H({ ...base, material: [Lshape, tri, { outer: sq.outer, holes: [...sq.holes, rev(rect(22000, 7000, 22500, 7500))] }] }) ===
    H({ ...base, material: [Lshape, tri, { outer: sq.outer, holes: [rev(rect(22000, 7000, 22500, 7500)), ...sq.holes] }] }));
  check("S6 duplicate + collinear vertices removed (hash unchanged)",
    H({ ...base, material: [{ outer: [0, 0, 3000, 0, 3000, 0, 6000, 0, 6000, 1000, 6000, 2000, 2000, 2000, 2000, 8000, 1000, 8000, 0, 8000, 0, 4000], holes: Lshape.holes }, tri, sq] }) === h0);
  check("S6 180° zero-width spike removed (hash unchanged)", H({ ...base, material: [{ outer: [0, 0, 6000, 0, 6000, 2000, 9000, 2000, 6000, 2000, 2000, 2000, 2000, 8000, 0, 8000], holes: Lshape.holes }, tri, sq] }) === h0);
  const fig8 = { outer: [0, 0, 10, 0, 10, 10, 20, 10, 20, 20, 10, 20, 10, 10, 0, 10], holes: [] };
  check("D3 figure-8 ring == two vertex-touching squares (same hash)", H({ index: 0, material: [fig8] }) === H({ index: 0, material: [{ outer: rect(0, 0, 10, 10), holes: [] }, { outer: rect(10, 10, 20, 20), holes: [] }] }));
  const pinched = { outer: [0, 0, 10, 0, 7, 5, 13, 5, 10, 0, 20, 0, 20, 20, 0, 20], holes: [] };
  check("D3 pinched outer == outer + vertex-touching hole (same hash)", H({ index: 0, material: [pinched] }) === H({ index: 0, material: [{ outer: rect(0, 0, 20, 20), holes: [[10, 0, 7, 5, 13, 5]] }] }));
  const pn = G.normalize([pinched]);
  check("D3 pinched outer → 1 part with 1 hole", pn.length === 1 && pn[0].holes.length === 1);
  const tris = [[0, 0, 10, 0, 0, 10], [10, 0, 20, 0, 20, 10], [20, 10, 20, 20, 10, 20], [0, 10, 10, 20, 0, 20]].map((o) => ({ outer: o, holes: [] }));
  const diamond = { outer: rect(0, 0, 20, 20), holes: [rev([10, 0, 20, 10, 10, 20, 0, 10])] };
  const dn = G.normalize([diamond]);
  check("D3 T-contact: diamond hole touching the outer at edge midpoints → 4 corner triangles, 0 holes", dn.length === 4 && dn.every((p) => p.holes.length === 0) && G.validate(dn).ok);
  check("D3 T-contact: diamond-hole polygon == 4 separate corner triangles (same hash)", H({ index: 0, material: [diamond] }) === H({ index: 0, material: tris }));
  check("D3 T-contact: Clipper2 difference(square, diamond) == union of the 4 triangles (same hash)",
    H({ index: 0, material: G.difference([{ outer: rect(0, 0, 20, 20), holes: [] }], [{ outer: [10, 0, 20, 10, 10, 20, 0, 10], holes: [] }]) }) === H({ index: 0, material: G.union(tris, []) }));
  // A hole whose two vertices sit inside the outer's top and bottom edges cuts the polygon into two parts that touch
  // only at those two points: without the T-split this stays 1 part with 1 hole.
  const cut = G.normalize([{ outer: rect(0, 0, 20, 10), holes: [rev([10, 0, 15, 5, 10, 10, 5, 5])] }]);
  check("D3 T-contacts cutting a polygon in two (hole vertices inside the outer's edges) → 2 parts, 0 holes == the two parts given separately",
    cut.length === 2 && cut.every((p) => !p.holes.length) && G.validate(cut).ok &&
    JSON.stringify(cut) === JSON.stringify(G.normalize([{ outer: [10, 0, 20, 0, 20, 10, 10, 10, 15, 5], holes: [] }, { outer: [0, 0, 10, 0, 5, 5, 10, 10, 0, 10], holes: [] }])));
  const dia = (o) => ({ outer: [20, 0, 40, 20, 20, 40, 0, 20].map((v) => v + o), holes: [rev(rect(10, 10, 30, 30).map((v) => v + o))] });
  check("D3 T-contact on diagonal edges (grid path): square hole at a diamond's edge midpoints → 4 triangles", (() => { const r = G.normalize([dia(0)]); return r.length === 4 && r.every((p) => !p.holes.length); })());
  check("D3 T-contact beyond ±2^25 µm (no Int32 axis path) still split", (() => { const r = G.normalize([{ outer: rect(0, 0, 20, 20).map((v) => v + 4e7), holes: [rev([10, 0, 20, 10, 10, 20, 0, 10].map((v) => v + 4e7))] }]); return r.length === 4; })() &&
    G.normalize([dia(4e7)]).length === 4);
  check("D3 normalize stays idempotent with T-contacts", (() => { const a = G.normalize([diamond]); return JSON.stringify(G.normalize(a)) === JSON.stringify(a); })());
});

suite("spike S6 — strong invariance through raw Clipper2 (property checks)", () => {
  const G = SBGeom, { rect, rot, rev, shuffle, noise, pixelSquares, raw, mapPolys, hasT } = S6, H = (m) => G.layerHash({ index: 0, material: m });
  const flat = (polys) => JSON.stringify(polys.flatMap((p) => [p.outer, ...p.holes]).map((r) => r.join()).sort());
  // rotate every ring, reverse every other polygon (global winding flip), shuffle parts and holes
  const perturb = (polys, seed) => shuffle(polys, seed).map((p, i) => { const f = (i + seed) % 2 ? rev : (r) => r;
    return { outer: f(rot(p.outer, seed % (p.outer.length >> 1))), holes: shuffle(p.holes, seed + 1).map((h) => f(rot(h, 1))) }; });
  // 1. Pixel masks: raw (un-assembled) Clipper2 output of three different inputs for the same region.
  let agree = 0, runs = 0, repeat = 0, rawDiff = 0;
  for (const [w, h, dens] of [[24, 20, 0.35], [24, 20, 0.5], [24, 20, 0.65], [40, 30, 0.5]]) for (let seed = 100; seed < 115; seed++) {
    const m = noise(w, h, seed * 7 + w, dens), s = 1000;
    const loops = G.fromPixelLoops(SBTrace.trace(m, w, h), s, s, 0, 0), px = pixelSquares(m, w, h, s);
    const routes = [loops, raw("union", loops), raw("union", px), raw("union", shuffle(px, seed).map((p) => ({ outer: rev(p.outer), holes: [] }))), G.union(px, [])];
    const canon = flat(G.normalize(loops));
    if (flat(routes[1]) !== canon && flat(routes[2]) !== canon && flat(routes[1]) !== flat(routes[2])) rawDiff++;
    const hs = routes.map((r, i) => H(perturb(r, seed + i)));
    runs++; if (hs.every((x) => x === hs[0])) agree++;
    for (const r of routes) for (const p of G.normalize(r)) for (const ring of [p.outer, ...p.holes]) {
      const seen = new Set(); for (let i = 0; i < ring.length; i += 2) { const k = ring[i] + "," + ring[i + 1]; if (seen.has(k)) { repeat++; break; } seen.add(k); } }
  }
  check(`S6 property premise: raw Clipper2 union(trace) and union(pixels) differ from each other and from the canonical rings (${rawDiff}/${runs})`, rawDiff === runs);
  check(`S6 property: ${runs} random masks × 5 routes (trace / raw union(trace) / raw union(pixels) / raw union(reversed shuffled pixels) / SBGeom.union) + rotate/reverse/shuffle → identical hash (${agree}/${runs})`, agree === runs);
  check("D3 property: no normalized ring revisits a vertex", repeat === 0);
  // 2. T-contacts: square minus 1–4 random diamonds (often centred so a corner lands inside the square's edge or another
  // diamond's edge). Clipper2's sweep runs along y, so the same difference computed on the plane rotated by 90°/180° or
  // transposed (then mapped back) chains the T-contacts differently; only the T-split makes those routes agree.
  const X = [[(x, y) => [y, -x], (x, y) => [-y, x]], [(x, y) => [-x, -y], (x, y) => [-x, -y]], [(x, y) => [y, x], (x, y) => [y, x]]];
  let tRuns = 0, tAgree = 0, tWithT = 0, tIdem = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const rnd = require("./fixtures.js").lcg(seed), S = 40, sqr = [{ outer: rect(0, 0, S, S), holes: [] }], dias = [];
    for (let i = 0, k = 1 + Math.floor(rnd() * 4); i < k; i++) {
      const r = 2 + 2 * Math.floor(rnd() * 5); let cx = 2 * Math.floor(rnd() * (S / 2 + 1)), cy = 2 * Math.floor(rnd() * (S / 2 + 1));
      const e = Math.floor(rnd() * 6); if (e === 0) cy = r; else if (e === 1) cy = S - r; else if (e === 2) cx = r; else if (e === 3) cx = S - r;
      dias.push({ outer: [cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy], holes: [] });
    }
    const a = raw("difference", sqr, dias); if (hasT(a)) tWithT++;
    const routes = [a, G.difference(sqr, dias.slice().reverse()), ...X.map(([f, g]) => mapPolys(raw("difference", mapPolys(sqr, f), mapPolys(dias, f)), g))];
    const hs = routes.map((r, i) => H(perturb(r, seed + i)));
    tRuns++; if (hs.every((x) => x === hs[0])) tAgree++;
    const n1 = G.normalize(a); if (JSON.stringify(G.normalize(n1)) === JSON.stringify(n1) && G.validate(n1).ok) tIdem++;
  }
  check(`S6 T-contact property premise: raw Clipper2 difference(square, diamonds) emits T-contacts (${tWithT}/${tRuns}, need ≥ 50)`, tWithT >= 50);
  check(`S6 T-contact property: ${tRuns} random difference(square, diamonds) × 5 routes (raw / SBGeom reversed order / raw on the plane rotated 90°, 180°, transposed) → identical hash (${tAgree}/${tRuns})`, tAgree === tRuns);
  check(`D3 T-contact property: normalize idempotent and valid (${tIdem}/${tRuns})`, tIdem === tRuns);
});

suite("spike S6 — NFR-05 static scan of the hashed path", () => {
  const src = fs.readFileSync(path.join(__dirname, "../js/geom.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check("NFR-05 geom.js uses no Math.cbrt/sin/cos/tan/atan/exp/log/pow/random/hypot", !/Math\.(cbrt|sin|cos|tan|atan2?|exp|log\w*|pow|random|hypot)/.test(src));
});

// ------------------------------------------------------------- png.js (S4)
// ------------------------------------------------ frame contact and saddles (spike S5, decision D3)
suite("spike S5 — trace saddles & frame contact (GEO-02/03, AT-06)", () => {
  const F = require("./fixtures.js");
  const d = F.MASKS.diagonalTouch;
  check("S5 trace of diagonal-only contact yields two outer loops", SBTrace.trace(d.layers[1], d.w, d.h).length === 2);
  const polys = SBGeom.normalize(SBGeom.union(SBGeom.fromPixelLoops(SBTrace.trace(d.layers[1], d.w, d.h), 1000, 1000, 0, 0), []));
  check("AT-06 diagonal-only contact = 2 components", SBGeom.components(polys).length === 2);
  check("GEO-03 diagonal-only contact validates (simple rings)", SBGeom.validate(polys).ok);
});

// Ported from spikes/S5/{s5_extra_checks,s5_d3_property,s5_inset}.mjs (decision D3 as adopted 2026-10-07). The oracle is
// test/oracle_raster.js (independent BFS labelling + exact pixel-centre rasterization; no repo module, no Clipper2).
// Default sizes keep the suite fast; `node test/run_tests.js --only "spike S5" --s5-full` runs the spike's full sweeps.
const S5 = (() => {
  const F = require("./fixtures.js"), O = require("./oracle_raster.js"), FULL = process.argv.includes("--s5-full");
  const a2 = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a; };
  const rev = (f) => { const o = []; for (let i = f.length - 2; i >= 0; i -= 2) o.push(f[i], f[i + 1]); return o; };
  const toP = (r) => { const p = []; for (let i = 0; i < r.length; i += 2) p.push({ x: r[i], y: r[i + 1] }); return p; };
  const C2 = () => globalThis.Clipper2;
  /** Traced loops → §3-oriented rings (reversed trace order), NOT normalized. */
  const tracedRings = (m, w, h, s = 1000, o = 0) => SBTrace.trace(m, w, h).map((L) => { const f = []; for (let i = L.length - 1; i >= 0; i--) f.push(Math.round(L[i][0] * s + o), Math.round(L[i][1] * s + o)); return f; });
  /** Raw Clipper2 union (no SBGeom normalization): its own ring pairing at touch points. */
  const rawUnion = (rings) => C2().union(rings.map(toP), [], C2().FillRule.NonZero).map((p) => p.flatMap((q) => [q.x, q.y]));
  const pipe = (m, w, h, s = 1000, o = 0) => SBGeom.union(SBGeom.fromPixelLoops(SBTrace.trace(m, w, h), s, s, o, o), []);
  // ---- the plan's ORIGINAL rule (split rings at repeated vertices, keep Clipper2's pairing) — characterization only
  const dropCollinear = (f) => { let r = f, ch = true; while (ch && r.length >= 6) { ch = false; const n = r.length / 2, o = [];
    for (let i = 0; i < n; i++) { const p = (i + n - 1) % n, q = (i + 1) % n, ax = r[2 * p], ay = r[2 * p + 1], bx = r[2 * i], by = r[2 * i + 1], cx = r[2 * q], cy = r[2 * q + 1];
      if ((ax === bx && ay === by) || (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) === 0) { ch = true; continue; } o.push(bx, by); } r = o; } return r; };
  const splitAtRepeats = (f) => { const out = [], st = [f]; while (st.length) { const r = st.pop(), n = r.length / 2, seen = new Map(); let sp = false;
    for (let i = 0; i < n; i++) { const k = r[2 * i] + "," + r[2 * i + 1]; if (seen.has(k)) { const j = seen.get(k); st.push(r.slice(2 * j, 2 * i), r.slice(2 * i).concat(r.slice(0, 2 * j))); sp = true; break; } seen.set(k, i); }
    if (!sp) out.push(r); } return out; };
  const pip2 = (r, px, py) => { let inside = false; const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) { const xi = 2 * r[2 * i], yi = 2 * r[2 * i + 1], xj = 2 * r[2 * j], yj = 2 * r[2 * j + 1], cr = (xj - xi) * (py - yi) - (yj - yi) * (px - xi);
      if (cr === 0 && Math.min(xi, xj) <= px && px <= Math.max(xi, xj) && Math.min(yi, yj) <= py && py <= Math.max(yi, yj)) return -1;
      if ((yi > py) !== (yj > py)) { const s = (px - xi) * (yj - yi) - (xj - xi) * (py - yi); if (yj - yi > 0 ? s < 0 : s > 0) inside = !inside; } } return inside ? 1 : 0; };
  const splitOnly = (raw) => {
    const pieces = raw.flatMap(splitAtRepeats).map(dropCollinear).filter((r) => r.length >= 6 && a2(r) !== 0);
    const outers = pieces.filter((r) => a2(r) > 0).sort((p, q) => a2(p) - a2(q)).map((o) => ({ outer: o, holes: [] }));
    for (const h of pieces.filter((r) => a2(r) < 0)) {
      const inO = (o) => { for (let i = 0, n = h.length / 2; i < n; i++) { const j = (i + 1) % n, s = pip2(o, h[2 * i] + h[2 * j], h[2 * i + 1] + h[2 * j + 1]); if (s >= 0) return s === 1; } return false; };
      const host = outers.find((o) => inO(o.outer)); if (host) host.holes.push(h);
    }
    return outers;
  };
  // ---- S5's turn rule (right-most in Y-down: material lies to the right of travel for outer-positive rings), exact
  const half = (ux, uy, vx, vy) => { const c = ux * vy - uy * vx; return c > 0 || (c === 0 && ux * vx + uy * vy < 0) ? 1 : 0; };
  const moreRight = (ux, uy, ax, ay, bx, by) => { const ha = half(ux, uy, ax, ay), hb = half(ux, uy, bx, by); if (ha !== hb) return ha > hb; return bx * ay - by * ax > 0; };
  /** Successor of every directed edge a→b under S5's rule: the right-most outgoing edge at b. */
  const rightMostSuccessor = (rings) => { const outs = new Map();
    for (const r of rings) for (let i = 0, n = r.length / 2; i < n; i++) { const j = (i + 1) % n, k = r[2 * i] + "," + r[2 * i + 1]; if (!outs.has(k)) outs.set(k, []); outs.get(k).push([r[2 * j] - r[2 * i], r[2 * j + 1] - r[2 * i + 1]]); }
    return (ax, ay, bx, by) => { const ux = bx - ax, uy = by - ay, o = outs.get(bx + "," + by); let best = o[0]; for (const c of o) if (moreRight(ux, uy, c[0], c[1], best[0], best[1])) best = c; return [bx + best[0], by + best[1], o.length]; }; };
  /** Clipper2's own continuations at shared vertices: separating (= right-most) vs joining. */
  const clipperPairing = (raw) => { const succ = rightMostSuccessor(raw); let vertices = 0, separating = 0, joining = 0; const counted = new Set();
    for (const r of raw) for (let i = 0, n = r.length / 2; i < n; i++) { const p = (i + n - 1) % n, q = (i + 1) % n, [cx, cy, deg] = succ(r[2 * p], r[2 * p + 1], r[2 * i], r[2 * i + 1]); if (deg < 2) continue;
      const k = r[2 * i] + "," + r[2 * i + 1]; if (!counted.has(k)) { counted.add(k); vertices++; } if (cx === r[2 * q] && cy === r[2 * q + 1]) separating++; else joining++; }
    return { vertices, separating, joining }; };
  // ---- mask generators (spikes/S5/s5_d3_property.mjs)
  const noise = (r, w, h, p) => { const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = r() < p ? 1 : 0; return m; };
  const blockChecker = (r, w, h, b, drop, sprinkle) => { const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = ((Math.floor(x / b) + Math.floor(y / b)) & 1) === 0 ? 1 : 0;
    for (let by = 0; by * b < h; by++) for (let bx = 0; bx * b < w; bx++) if (r() < drop) for (let y = by * b; y < Math.min(h, by * b + b); y++) for (let x = bx * b; x < Math.min(w, bx * b + b); x++) m[y * w + x] = 0;
    for (let i = 0; i < m.length; i++) if (r() < sprinkle) m[i] ^= 1; return m; };
  const diamondRings = (r, w, h, k) => { const m = new Uint8Array(w * h), cx = Math.floor(w / (2 * k)), cy = Math.floor(h / (2 * k)), radii = [];
    for (let R = 1 + Math.floor(r() * 2); R < Math.min(cx, cy); R += 2 + Math.floor(r() * 2)) radii.push(R);
    for (let by = 0; by * k < h; by++) for (let bx = 0; bx * k < w; bx++) if (radii.includes(Math.abs(bx - cx) + Math.abs(by - cy)) && r() > 0.05)
      for (let y = by * k; y < Math.min(h, by * k + k); y++) for (let x = bx * k; x < Math.min(w, bx * k + k); x++) m[y * w + x] = 1; return m; };
  const chainCycles = (r, w, h) => { const m = new Uint8Array(w * h);
    for (let t = 0; t < 6; t++) { let x = 2 + Math.floor(r() * (w - 4)), y = 2 + Math.floor(r() * (h - 4)); const n = 4 + Math.floor(r() * 10);
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) for (let s = 0; s < n; s++) { x += dx; y += dy; if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1; } }
    for (let i = 0; i < m.length; i++) if (r() < 0.08) m[i] = 1; return m; };
  return { F, O, FULL, a2, rev, toP, tracedRings, rawUnion, pipe, splitOnly, rightMostSuccessor, clipperPairing, noise, blockChecker, diamondRings, chainCycles };
})();

suite("spike S5 — D3 normalize: one polygon per part (F1: re-pair, interiorConnected, GEO_MULTIPART)", () => {
  const G = SBGeom, { F, O, tracedRings, rawUnion, pipe, splitOnly, clipperPairing } = S5;
  // Two 4-components touching at THREE saddle points: Clipper2 returns ONE ring through all three, separating at two and
  // joining at one. Splitting at repeats flips the pairing at each split point → 1 polygon + 2 holes, interior in two pieces.
  const cyc = F.art(["##.#.", "#.###", "##.##", "###.."]);
  const raw = rawUnion(tracedRings(cyc.m, cyc.w, cyc.h));
  const rep = raw.length === 1 ? raw[0].filter((v, i) => i % 2 === 0).map((x, i) => x + "," + raw[0][2 * i + 1]).filter((k, i, a) => a.indexOf(k) !== i) : [];
  check("F1 (characterization) Clipper2 union returns ONE ring (no hole) with 3 repeated vertices", raw.length === 1 && rep.length === 3);
  const cp = clipperPairing(raw);
  check("F1 (characterization) Clipper2 pairs mixed at the 3 touch vertices (4 separating, 2 joining continuations)", cp.vertices === 3 && cp.separating === 4 && cp.joining === 2);
  const sp = splitOnly(raw);
  check("F1 (characterization) split-only rule gives 1 polygon + 2 holes and interiorConnected detects it", sp.length === 1 && sp[0].holes.length === 2 && !G.interiorConnected(sp[0]));
  check("D3 validate() reports GEO_MULTIPART for the split-only polygon", G.validate(sp).errors.some((e) => e.code === "GEO_MULTIPART" && e.ring.poly === 0));
  const union0 = G.union; let msg = "";
  try { G.union = (a) => a; G.components(sp); } catch (e) { msg = e.message; } finally { G.union = union0; }
  check("D3 components() asserts interiorConnected (throws GEO_MULTIPART_POLYGON)", /GEO_MULTIPART_POLYGON/.test(msg));
  const polys = pipe(cyc.m, cyc.w, cyc.h);
  check("D3 cyclic saddle contact: 2 polygons, each interior-connected, components() = 2", polys.length === 2 && polys.every(G.interiorConnected) && G.components(polys).length === 2);
  check("D3 cyclic saddle contact: pixel-exact bijection with raster 4-components, validates", O.checkPartsAgainstRaster(polys, cyc.m, cyc.w, cyc.h, 1000, 0).ok && G.validate(polys).ok);
  const named = {
    holeHoleSaddle: [["######", "#.####", "##.###", "######"], 1, 2], holeOuterSaddle: [["####.", "###.#", "#####"], 1, 1],
    ringOfFourDiagonal: [[".###.", "#...#", "#...#", ".###."], 4, 0], checker8: [Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => ((x + y) & 1 ? "." : "#")).join("")), 32, 0],
    islandInHoleDiag: [["#####", "#...#", "#.#.#", "#...#", "#####"], 2, 1], islandTouchingHoleCorner: [["#####", "##..#", "#.#.#", "#...#", "#####"], 2, 1],
  };
  for (const [k, [rows, parts, holes]] of Object.entries(named)) {
    const a = F.art(rows), p = pipe(a.m, a.w, a.h);
    check(`D3 ${k}: ${parts} part(s), ${holes} hole ring(s), raster oracle + validate ok`, O.checkPartsAgainstRaster(p, a.m, a.w, a.h, 1000, 0).ok && p.length === parts &&
      p.reduce((s, q) => s + q.holes.length, 0) === holes && G.validate(p).ok);
  }
  let ok = true, cycles = 0;
  for (let s = 1; s <= 200 && ok; s++) { const r = F.lcg(s), w = 20, h = 16, mm = new Uint8Array(w * h); for (let i = 0; i < mm.length; i++) mm[i] = r() < 0.55 ? 1 : 0;
    cycles += O.saddleStats(mm, w, h).multiPartSaddleCycles; ok = O.checkPartsAgainstRaster(pipe(mm, w, h), mm, w, h, 1000, 0).ok; }
  check(`D3 property (200 noise masks 20×16, ${cycles} multi-part saddle cycles): pixel-exact bijection with raster 4-components`, ok && cycles > 100);
});

suite("spike S5 — D3 turn rule: shipped re-chaining == S5 material-separating turn", () => {
  // js/geom.js re-chains with the "sharpest left turn" read in the math frame (Y up); S5 states the "right-most" turn in
  // the Y-down frame. They are the same rule: for every directed edge of the raw Clipper2 ring set, the shipped successor
  // must equal the right-most outgoing edge at its head (exact half-plane + cross-product comparator, ported from S5).
  const G = SBGeom, { F, tracedRings, rawUnion, rightMostSuccessor, noise, blockChecker } = S5;
  let edges = 0, shared = 0, bad = 0, masks = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = F.lcg(seed * 31 + 7), w = 24, h = 20, m = seed % 3 ? noise(r, w, h, 0.35 + 0.3 * r()) : blockChecker(r, w, h, 1 + (seed % 2), 0.2, 0.03);
    const raw = rawUnion(tracedRings(m, w, h)), succ = rightMostSuccessor(raw); masks++;
    for (const wk of G.rechain(raw)) for (let i = 0, n = wk.length / 2; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n, [cx, cy, deg] = succ(wk[2 * p], wk[2 * p + 1], wk[2 * i], wk[2 * i + 1]); edges++;
      if (deg > 1) shared++; if (cx !== wk[2 * q] || cy !== wk[2 * q + 1]) bad++;
    }
  }
  check(`D3 turn rule: ${masks} raw Clipper2 unions, ${edges} directed edges (${shared} at shared vertices): shipped successor == S5 right-most successor (${bad} differ)`, bad === 0 && shared > 1000);
  // non-lattice: T-contacts and diagonal edges (difference of a square and diamonds), after the T-split
  let tb = 0, ts = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = F.lcg(seed), dias = [];
    for (let i = 0; i < 3; i++) { const rr = 2 + 2 * Math.floor(rnd() * 5), cx = 2 * Math.floor(rnd() * 21), cy = 2 * Math.floor(rnd() * 21); dias.push([cx, cy - rr, cx + rr, cy, cx, cy + rr, cx - rr, cy]); }
    const C2 = globalThis.Clipper2, raw = C2.difference([S5.toP([0, 0, 40, 0, 40, 40, 0, 40])], dias.map(S5.toP), C2.FillRule.NonZero).map((p) => p.flatMap((q) => [q.x, q.y]));
    const noded = G.splitTJunctions(raw), succ = rightMostSuccessor(noded);
    for (const wk of G.rechain(noded)) for (let i = 0, n = wk.length / 2; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n, [cx, cy, deg] = succ(wk[2 * p], wk[2 * p + 1], wk[2 * i], wk[2 * i + 1]);
      if (deg > 1) ts++; if (cx !== wk[2 * q] || cy !== wk[2 * q + 1]) tb++;
    }
  }
  check(`D3 turn rule on T-contacts and diagonal edges (40 square − diamonds, ${ts} shared-vertex continuations): identical (${tb} differ)`, tb === 0 && ts > 20);
});

suite("spike S5 — D3 property sweeps vs independent raster oracle (F1)" + (S5.FULL ? " [full]" : " [reduced; --s5-full for the spike sizes]"), () => {
  const G = SBGeom, { F, O, FULL, tracedRings, rawUnion, pipe, splitOnly, noise, blockChecker, diamondRings, chainCycles } = S5;
  const SWEEPS = [
    ["noise 24×24 p=0.5", 24, 24, (r) => noise(r, 24, 24, 0.5), FULL ? 1000 : 100, 1000, 0],
    ["noise 32×32 p=0.35", 32, 32, (r) => noise(r, 32, 32, 0.35), FULL ? 300 : 25, 250, 10000],
    ["noise 32×32 p=0.65", 32, 32, (r) => noise(r, 32, 32, 0.65), FULL ? 300 : 25, 250, 10000],
    ["noise 64×64 p=0.5", 64, 64, (r) => noise(r, 64, 64, 0.5), FULL ? 150 : 6, 1000, 0],
    ["block checker b=1..3, dropout ≤0.3", 48, 40, (r) => blockChecker(r, 48, 40, 1 + Math.floor(r() * 3), r() * 0.3, r() * 0.04), FULL ? 300 : 25, 7, 3],
    ["diamond rings of k×k blocks", 60, 60, (r) => diamondRings(r, 60, 60, 1 + Math.floor(r() * 3)), FULL ? 200 : 12, 1000, 0],
    ["diagonal-step loops + specks", 48, 48, (r) => chainCycles(r, 48, 48), FULL ? 300 : 25, 250, 0],
  ];
  let multi = 0, splitFail = 0, splitCaught = 0;
  for (const [name, w, h, gen, n, s, o] of SWEEPS) {
    let fail = 0, vfail = 0, cfail = 0, ifail = 0, first = "";
    for (let seed = 1; seed <= n; seed++) {
      const r = F.lcg(seed * 7919 + name.length), m = gen(r);
      const st = O.saddleStats(m, w, h); multi += st.multiPartSaddleCycles;
      const polys = pipe(m, w, h, s, o), or = O.checkPartsAgainstRaster(polys, m, w, h, s, o);
      if (!or.ok) { fail++; first = first || or.reasons.slice(0, 2).join("; "); }
      if (!G.validate(polys).ok) vfail++;
      let nc; try { nc = G.components(polys).length; } catch (e) { nc = -1; } if (nc !== or.parts) cfail++;
      if (!polys.every(G.interiorConnected)) ifail++;
      if (st.multiPartSaddleCycles) { const sp = splitOnly(rawUnion(tracedRings(m, w, h, s, o)));
        if (!O.checkPartsAgainstRaster(sp, m, w, h, s, o).ok) { splitFail++; if (sp.some((p) => !G.interiorConnected(p))) splitCaught++; } }
    }
    check(`D3 ${name} (${n} masks, ${s} µm/px): pixel-exact bijection with raster 4-components${first ? " — " + first : ""}`, fail === 0);
    check(`D3 ${name}: validate ok, components() == raster count, every polygon interiorConnected`, vfail === 0 && cfail === 0 && ifail === 0);
  }
  check(`D3 sweeps exercise multi-part saddle cycles (${multi})`, multi > (FULL ? 1000 : 300));
  check(`F1 (characterization) split-only rule fails the oracle on some masks (${splitFail}); interiorConnected catches every one (${splitCaught})`, splitFail > 0 && splitCaught === splitFail);
});

suite("spike S5 — D3 non-raster contacts and interiorConnected (T-contacts need noding)", () => {
  const G = SBGeom;
  const A = { outer: [0, 0, 300, 0, 300, 100, 0, 100], holes: [] };
  const B = { outer: [50, 100, 100, 200, 200, 200, 250, 100, 280, 300, 20, 300], holes: [] }; // touches A's bottom edge at x = 50, 250
  const u = G.union([A], [B]);
  check("D3 two parts touching at TWO T-contacts stay 2 polygons, interior-connected, validate ok", u.length === 2 && u.every(G.interiorConnected) && G.validate(u).ok);
  const d = G.difference([{ outer: [0, 0, 200, 0, 200, 200, 0, 200], holes: [] }], [{ outer: [100, 0, 150, 100, 50, 100], holes: [] }]);
  check("D3 difference(square, triangle with apex on its edge): 1 part, interior-connected, validates", d.length === 1 && G.interiorConnected(d[0]) && G.validate(d).ok);
  const ui = G.union([{ outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [[100, 100, 100, 200, 200, 200, 200, 100]] }], [{ outer: [100, 150, 150, 100, 200, 150, 150, 200], holes: [] }]);
  check("D3 island diamond touching all 4 hole edges at T-contacts: 2 parts, valid", ui.length === 2 && ui.every(G.interiorConnected) && G.validate(ui).ok);
  // two triangular holes whose apexes touch the outer's top edge interior and which share a vertex enclose a triangle
  const p = { outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [[100, 0, 50, 100, 150, 100], [200, 0, 150, 100, 250, 100]] };
  check("D3 interiorConnected: cycle closed through T-contacts on the outer edge → disconnected (noding required)", !G.interiorConnected(p));
  check("D3 validate: that polygon reports exactly GEO_MULTIPART (no GEO_SELF_INTERSECT)", G.validate([p]).errors.map((e) => e.code).join() === "GEO_MULTIPART");
  const q = { outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [[100, 0, 50, 100, 150, 100], [200, 50, 150, 150, 250, 150]] };
  check("D3 interiorConnected: a single T-contact hole (no cycle) stays connected and valid", G.interiorConnected(q) && G.validate([q]).ok);
  const flip = (r) => S5.rev(r);
  const x = { outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [flip([100, 50, 200, 50, 200, 150, 100, 150]), flip([150, 100, 250, 100, 250, 200, 150, 200])] };
  check("D3 validate: overlapping holes are GEO_SELF_INTERSECT", G.validate([x]).errors.some((e) => e.code === "GEO_SELF_INTERSECT"));
  check("D3 interiorConnected: a polygon without holes is connected", G.interiorConnected({ outer: [0, 0, 10, 0, 10, 10], holes: [] }));
});

suite("spike S5 — frame union (F2: GEO-02 / LYR-04 / AT-12)", () => {
  const G = SBGeom, bt = S5.F.MASKS.borderTouch;
  const frame = { outer: [0, 0, 100000, 0, 100000, 70000, 0, 70000], holes: [[10000, 10000, 10000, 60000, 90000, 60000, 90000, 10000]] };
  const polys = G.union(G.union(G.fromPixelLoops(SBTrace.trace(bt.layers[1], 8, 5), 10000, 10000, 10000, 10000), []), [frame]);
  check("LYR-04 frame ring ∪ edge-touching art is one material polygon", polys.length === 1);
  let seg = false; for (const p of polys) for (const r of [p.outer, ...p.holes]) for (let i = 0, n = r.length / 2; i < n; i++) { const j = (i + 1) % n;
    if (r[2 * i] === 10000 && r[2 * j] === 10000 && Math.min(r[2 * i + 1], r[2 * j + 1]) < 30000 && Math.max(r[2 * i + 1], r[2 * j + 1]) > 10000) seg = true; }
  check("GEO-02 FIXED: no ring edge on x = 10000 µm between y 10000..30000", !seg);
  check("AT-12 frame outer ring is the exact page rectangle", JSON.stringify(polys[0].outer) === "[0,0,100000,0,100000,70000,0,70000]");
});

suite("spike S5 — finite-width contact (F6, Appendix B.3) and sub-µm offset refusal (F4)", () => {
  const G = SBGeom, { F, FULL, a2, rev } = S5, B = (v) => BigInt(v), C2 = globalThis.Clipper2;
  const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] });
  const poly = (flat) => [{ outer: a2(flat) < 0 ? rev(flat) : flat, holes: [] }];
  const lower = [sq(0, 0, 10000, 10000)], I = (upper) => G.intersection([upper], lower);
  // ---- B.3 classification (width w = 2·r*: block if w < 0.5 µm, warn SUPPORT_NARROW if w < minFeatureUm)
  check("B.3 point contact: intersection empty → block", G.isEmpty(I(sq(10000, 10000, 20000, 20000))) && G.classifyContact(I(sq(10000, 10000, 20000, 20000)), 3000).level === "block");
  check("B.3 edge contact: intersection empty → block", G.isEmpty(I(sq(10000, 0, 20000, 10000))) && G.classifyContact(I(sq(10000, 0, 20000, 10000)), 3000).level === "block");
  check("B.3 1 µm axis overlap: width 1 µm ≥ 0.5 → warn, not block", G.classifyContact(I(sq(9999, 0, 20000, 10000)), 3000).level === "warn");
  check("B.3 needle sliver (inradius 2.5e-5 µm) → block", G.classifyContact(poly([0, 0, 20001, 1, 20000, 1]), 3000).level === "block");
  check("B.3 2999 µm overlap → warn (SUPPORT_NARROW)", G.classifyContact(I(sq(7001, 0, 20000, 10000)), 3000).level === "warn");
  check("B.3 3000 µm overlap (width = minFeature) → ok; the tie is certified, not undecided",
    G.classifyContact(I(sq(7000, 0, 20000, 10000)), 3000).level === "ok" && G.insetStatus(I(sq(7000, 0, 20000, 10000)), 1500).status === "survives");
  check("B.3 survivesInset scale-independent where certified (×4, ×16, ×64 agree on the 2999/3000 pair)",
    [4, 16, 64].every((sc) => !G.survivesInset(I(sq(7001, 0, 20000, 10000)), 1500, { scale: sc }) && G.survivesInset(I(sq(7000, 0, 20000, 10000)), 1500, { scale: sc })));
  const sl = (k) => G.intersection([{ outer: [0, 0, 100000, 0, 0, 100000], holes: [] }], [{ outer: [100000 - k, 0, 100000 - k, 100000, -k, 100000], holes: [] }]);
  check("B.3 diagonal sliver, normal width 0.707 µm → warn (not block)", G.classifyContact(sl(1), 3000).level === "warn");
  check("B.3 thin parallelogram (height ≈ 1 µm) → warn; right triangle 10000×1 → warn",
    G.classifyContact(poly([0, 0, 10000, 3, 10000, 4, 0, 1]), 3000).level === "warn" && G.classifyContact(poly([0, 0, 10000, 0, 10000, 1]), 3000).level === "warn");
  check("D3 minFeatureUm is rounded to integer µm before halving (3000.4 → 3000: tie ok; 3000.6 → 3001: warn)",
    G.classifyContact(I(sq(7000, 0, 20000, 10000)), 3000.4).level === "ok" && G.classifyContact(I(sq(7000, 0, 20000, 10000)), 3000.6).level === "warn");
  check("D3 an odd minFeatureUm halves to a dyadic inset (2999 → 1499.5: 2999 overlap ok, 2998 warn)",
    G.classifyContact(I(sq(7001, 0, 20000, 10000)), 2999).level === "ok" && G.classifyContact(I(sq(7002, 0, 20000, 10000)), 2999).level === "warn");
  let nd = ""; try { G.insetStatus(lower, 0.3); } catch (e) { nd = e.message; }
  check("D3 insetStatus refuses a non-dyadic inset (GEO_INSET_NOT_DYADIC)", /GEO_INSET_NOT_DYADIC/.test(nd));
  const w1 = G.insetStatus(I(sq(9999, 0, 20000, 10000)), 0.25), w2 = G.insetStatus(I(sq(9999, 0, 20000, 10000)), 0.25);
  check("NFR-05 insetStatus is deterministic (same witness twice)", w1.status === "survives" && JSON.stringify(w1) === JSON.stringify(w2));
  // ---- F4: Clipper2 Paths64 offsets at sub-µm deltas, and SBGeom.offset refusing them
  const inf = (f, d) => C2.inflatePaths([S5.toP(f)], d, C2.JoinType.Miter, C2.EndType.Polygon, 2).map((p) => p.map((q) => [q.x, q.y]));
  const rect = [0, 0, 4000, 0, 4000, 10000, 0, 10000], Lsh = [0, 0, 3000, 0, 3000, 1000, 1000, 1000, 1000, 3000, 0, 3000];
  const ar = (out) => out.reduce((a, p) => a + C2.area(p.map(([x, y]) => ({ x, y }))), 0);
  check("F4 (characterization) |delta| < 0.5 is a no-op (input returned unchanged)", JSON.stringify(inf(rect, -0.49)) === "[[[0,0],[4000,0],[4000,10000],[0,10000]]]");
  check("F4 (characterization) delta −0.5: positive rect → [], reversed rect shrinks 1 µm on two sides only",
    inf(rect, -0.5).length === 0 && JSON.stringify(inf(rev(rect), -0.5)) === "[[[4000,1],[1,1],[1,10000],[4000,10000]]]");
  check("F4 (characterization) delta −0.5, positive L-shape → a wrong polygon of 2,497,000.5 µm² (true: 5,000,000)", Math.abs(ar(inf(Lsh, -0.5))) === 2497000.5);
  check("F4 (characterization) delta −1.5 shrinks 2 µm on two sides and 1 µm on the other two", JSON.stringify(inf(rect, -1.5)) === "[[[3999,2],[3999,9999],[2,9999],[2,2]]]");
  const refuses = (d) => { try { G.offset(lower, d, "miter"); return false; } catch (e) { return /GEO_OFFSET_NONINTEGER/.test(e.message); } };
  check("F4 SBGeom.offset refuses sub-µm and non-integer deltas (−0.5, 0.4, −1.5, NaN, ∞) with GEO_OFFSET_NONINTEGER", [-0.5, 0.4, -1.5, NaN, Infinity].every(refuses));
  // ---- exact-oracle families (spikes/S5/s5_inset.mjs): no certified verdict may be wrong at default, ×4, ×16, ×64
  function family(name, cases) {
    let wrong = 0, und = 0, undTrue = 0, contra = 0;
    for (const c of cases) {
      const st = [undefined, 4, 16, 64].map((s) => G.insetStatus(c.I, c.d, s ? { scale: s } : undefined).status);
      for (const v of st) if ((v === "survives" && !c.truth) || (v === "fails" && c.truth)) wrong++;
      if (st[0] === "undecided") { und++; if (c.truth) undTrue++; }
      if (new Set(st.filter((v) => v !== "undecided")).size > 1) contra++;
      if (G.survivesInset(c.I, c.d) && !c.truth) wrong++; // the boolean is conservative
    }
    check(`F6 ${name}: ${cases.length} cases, no wrong certified verdict, no cross-scale contradiction (undecided at default: ${und}, of which truly surviving: ${undTrue})`, wrong === 0 && contra === 0);
    return { und, undTrue };
  }
  const rat = (d) => [B(Math.round(d * 1024)), 1024n];
  { const cases = [];
    for (const d of [0.25, 1500, 1.5, 7]) { const r = F.lcg(Math.round(d * 1000) + 17), N = FULL ? 600 : 60;
      for (let i = 0; i < N; i++) {
        const len = 200 + r() * 20000, th = r() * Math.PI * 2, a = Math.round(len * Math.cos(th)), b = Math.round(len * Math.sin(th)); if (!a && !b) continue;
        const L = Math.hypot(a, b), h = Math.max(0.05, 2 * d + (r() * 2 - 1) * Math.max(1, 0.002 * d)), t = (r() - 0.5) * L;
        const vx = Math.round((-b / L) * h + (a / L) * t * 0.5), vy = Math.round((a / L) * h + (b / L) * t * 0.5), cr = B(a) * B(vy) - B(b) * B(vx); if (cr === 0n) continue;
        const [dn, dd] = rat(d), uu = B(a * a + b * b), vv = B(vx * vx + vy * vy), mx = uu > vv ? uu : vv, x0 = Math.floor(r() * 1e6), y0 = Math.floor(r() * 7e5);
        cases.push({ I: poly([x0, y0, x0 + a, y0 + b, x0 + a + vx, y0 + b + vy, x0 + vx, y0 + vy]), d, truth: cr * cr * dd * dd >= 4n * dn * dn * mx });
      } }
    family("parallelograms near 2d (d = 0.25, 1.5, 7, 1500 µm)", cases); }
  { const cases = [];
    for (const [w, d] of [[1, 0.25], [2, 0.25], [1, 0.5], [2999, 1500], [3000, 1500], [3001, 1500.5], [3, 1.5], [14, 7], [13, 7]])
      for (const L of [w, 10000]) cases.push({ I: poly([12345, 678, 12345 + w, 678, 12345 + w, 678 + L, 12345, 678 + L]), d, truth: Math.min(w, L) >= 2 * d });
    const r = family("axis rectangles incl. ties w = 2d", cases);
    check("F6 axis rectangles: ties w = 2d are certified SURVIVES (none undecided)", r.und === 0); }
  { const cases = [];
    for (const k of [1, 2, 3]) { const Ik = G.intersection([{ outer: [0, 0, 100000, 0, 0, 100000], holes: [] }], [{ outer: [100000 - k, 0, 100000 - k, 100000, -k, 100000], holes: [] }]);
      for (const d of [0.25, 0.5, 1]) cases.push({ I: Ik, d, truth: k * k * 1024 * 1024 >= 8 * Math.round(d * 1024) ** 2 }); }
    family("diagonal slivers k = 1..3 µm (normal width k/√2)", cases); }
  { const Lc = [], Pc = [];
    for (const d of FULL ? [7, 100, 1500] : [7, 1500]) { const wL = ((2 + Math.SQRT2) * d) / 2, wP = d * Math.SQRT2;
      for (let dw = -3; dw <= 3; dw++) for (const rot of FULL ? [0, 1, 2, 3] : [0, 1]) {
        const w = Math.max(1, Math.round(wL) + dw), A = 4 * w; let f = [0, 0, A, 0, A, w, w, w, w, A, 0, A];
        for (let k = 0; k < rot; k++) { const g = []; for (let i = 0; i < f.length; i += 2) g.push(-f[i + 1], f[i]); f = g; }
        f = f.map((v, i) => v + (i % 2 ? 50000 : 90000));
        const [dn, dd] = rat(d), W = B(w), lhs = 2n * W * dd - dn; Lc.push({ I: poly(f), d, truth: lhs >= 0n && lhs * lhs >= 2n * W * W * dd * dd });
        const p = Math.max(1, Math.round(wP) + dw), h = Math.floor(p / 2), q = p - h, M = 3 * p;
        Pc.push({ I: poly([-h, -M, q, -M, q, -h, M, -h, M, q, q, q, q, M, -h, M, -h, q, -M, q, -M, -h, -h, -h].map((v, i) => v + (i % 2 ? 40000 : 70000))), d, truth: B(p) * B(p) * dd * dd >= 2n * dn * dn });
      } }
    family("L-shapes (r* = (2−√2)w, bound by the reflex vertex)", Lc); family("plus-shapes (r* = w/√2, bound by four reflex vertices)", Pc); }
  { // intersections of random star polygons: a sampled lower bound r_lb ≤ r* (float) — FAILS must never occur with r_lb ≥ d
    const star = (r, cx, cy, R0, n) => { const f = []; for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n, rr = R0 * (0.55 + 0.45 * r()); f.push(Math.round(cx + rr * Math.cos(t)), Math.round(cy + rr * Math.sin(t))); } return f; };
    const distSeg = (px, py, ax, ay, bx, by) => { const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey; let t = L ? ((px - ax) * ex + (py - ay) * ey) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(ax + t * ex - px, ay + t * ey - py); };
    const inR = (rings, x, y) => { let ins = false; for (const r of rings) for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) { const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
    const depth = (rings, x, y) => { if (!inR(rings, x, y)) return -1; let m = Infinity; for (const r of rings) for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) m = Math.min(m, distSeg(x, y, r[2 * j], r[2 * j + 1], r[2 * i], r[2 * i + 1])); return m; };
    const rlb = (rings) => { let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity; for (const r of rings) for (let i = 0; i < r.length; i += 2) { X0 = Math.min(X0, r[i]); X1 = Math.max(X1, r[i]); Y0 = Math.min(Y0, r[i + 1]); Y1 = Math.max(Y1, r[i + 1]); }
      let best = -1, bx = 0, by = 0; const N = 40; for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) { const x = X0 + ((X1 - X0) * i) / N, y = Y0 + ((Y1 - Y0) * j) / N, v = depth(rings, x, y); if (v > best) { best = v; bx = x; by = y; } }
      let step = Math.max(X1 - X0, Y1 - Y0) / N; while (step > 1e-4) { let moved = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const v = depth(rings, bx + dx * step, by + dy * step); if (v > best) { best = v; bx += dx * step; by += dy * step; moved = true; } } if (!moved) step /= 2; }
      return best; };
    let n = 0, bad = 0, wit = 0, cnt = { survives: 0, fails: 0, undecided: 0 }; const r = F.lcg(4242);
    for (let i = 0, N = FULL ? 250 : 40; i < N; i++) {
      const s1 = star(r, 5000, 5000, 3000 + r() * 2000, 7 + Math.floor(r() * 9)), s2 = star(r, 5000 + (r() - 0.5) * 6000, 5000 + (r() - 0.5) * 6000, 3000 + r() * 2000, 7 + Math.floor(r() * 9));
      const Ii = G.intersection(poly(s1), poly(s2)); if (G.isEmpty(Ii)) continue;
      const rings = Ii.flatMap((p) => [p.outer, ...p.holes]), lb = rlb(rings), d = Math.max(0.25, Math.round(lb * (0.97 + 0.06 * r()) * 4) / 4), res = G.insetStatus(Ii, d); n++; cnt[res.status]++;
      if (res.status === "fails" && lb >= d) bad++;
      if (res.status === "survives") { const { X, Y, q } = res.witness; if (depth(rings, X / q, Y / q) < d * (1 - 1e-12)) wit++; }
    }
    check(`F6 practical star intersections (${n}: ${JSON.stringify(cnt)}): every SURVIVES witness re-checks in floating point; no FAILS where r_lb ≥ d`, n > 20 && bad === 0 && wit === 0);
  }
});

suite("spike S4 — png.js raw decode and inspection, plan checks (IMG-01/02/05/07, AT-02/22)", () => {
  const F = require("./fixtures.js");
  const g = (opts) => F.pngEncode({ w: 5, h: 1, colorType: 0, bitDepth: 8, data: Uint8Array.from([0, 64, 128, 191, 255]), ...opts });
  const rej = (bytes, code, mode = "height") => SBPng.decode(bytes, { mode }).then(() => false, (e) => e.code === code);
  checkAsync("AT-02 raw samples 0,64,128,191,255 exact", SBPng.decode(g({}), { mode: "height" }).then((r) => r.samples.join() === "0,64,128,191,255"));
  checkAsync("AT-02 iCCP/gAMA ignored, samples unchanged",
    SBPng.decode(g({ extraChunks: [["gAMA", [0, 0, 0xb1, 0x8f]], ["sRGB", [0]]] }), { mode: "height" }).then((r) => r.samples.join() === "0,64,128,191,255"));
  checkAsync("IMG-01 16-bit rejected", rej(F.pngEncode({ w: 1, h: 1, colorType: 0, bitDepth: 16, data: Uint8Array.from([1, 2]) }), "PNG_16BIT"));
  checkAsync("IMG-01 APNG rejected", rej(g({ apng: true }), "PNG_APNG"));
  checkAsync("IMG-01 corrupt CRC rejected", rej(g({ corruptCrc: true }), "PNG_CRC"));
  checkAsync("AT-22 truncated PNG rejected", rej(g({ truncate: 10 }), "PNG_TRUNCATED"));
  checkAsync("IMG-01 unequal RGB rejected in height mode",
    rej(F.pngEncode({ w: 1, h: 1, colorType: 2, bitDepth: 8, data: Uint8Array.from([10, 20, 30]) }), "PNG_UNEQUAL_RGB"));
  checkAsync("IMG-01 filter types 1-4 round-trip exactly", Promise.all([1, 2, 3, 4].map((f) => SBPng.decode(g({ filter: f }), { mode: "height" })))
    .then((rs) => rs.every((r) => r.samples.join() === "0,64,128,191,255")));
  check("IMG-07 inspect reads w/h without inflating", SBPng.inspect(g({})).w === 5 && SBPng.inspect(g({})).h === 1);
  check("IMG-01 tonal APNG rejected at inspection", SBPng.check(SBPng.inspect(g({ apng: true })), "tonal") === "PNG_APNG");
  check("IMG-01 tonal 16-bit rejected at inspection",
    SBPng.check(SBPng.inspect(F.pngEncode({ w: 1, h: 1, colorType: 0, bitDepth: 16, data: Uint8Array.from([1, 2]) })), "tonal") === "PNG_16BIT");
  check("IMG-05 eXIf orientation parsed", SBPng.inspect(g({ extraChunks: [["eXIf", [0x4d,0x4d,0,42,0,0,0,8,0,1,1,0x12,0,3,0,0,0,1,0,6,0,0]]] })).exif === 6);
});

suite("spike S4 — png.js extended (interlace, palette, alpha, zlib edge cases, hashing)", () => {
  const F = require("./fixtures.js"), E = require("./png_enc.js");
  const rng = F.lcg(7), W = 37, H = 23, N = W * H;
  const gray = Uint8Array.from({ length: N }, () => (rng() * 256) | 0);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const rej = (bytes, code, mode = "height", opts = {}) => SBPng.decode(bytes, { mode, ...opts }).then(() => false, (e) => e.code === code || console.error("    got", e.code));
  const ok = (bytes, pred, mode = "height") => SBPng.decode(bytes, { mode }).then(pred);
  const rgbEq = (a) => Uint8Array.from({ length: a.length * 3 }, (_, i) => a[(i / 3) | 0]);
  const rgbaEq = (a, al) => Uint8Array.from({ length: a.length * 4 }, (_, i) => (i & 3) === 3 ? al[i >> 2] : a[i >> 2]);
  const alphaV = Uint8Array.from({ length: N }, (_, i) => (i * 7) & 255);

  checkAsync("Adam7 gray 37x23 random samples exact", ok(E.encode({ w: W, h: H, colorType: 0, data: gray, interlace: 1 }), (r) => same(r.samples, gray)));
  checkAsync("Adam7 tiny images 1x1..9x9 exact", Promise.all([1, 2, 3, 5, 7, 8, 9].flatMap((w) => [1, 2, 3, 9].map((h) => {
    const d = Uint8Array.from({ length: w * h }, (_, i) => (i * 37 + w) & 255);
    return SBPng.decode(E.encode({ w, h, colorType: 0, data: d, interlace: 1, filter: (y) => y % 5 }), { mode: "height" }).then((r) => same(r.samples, d));
  }))).then((a) => a.every(Boolean)));
  checkAsync("mixed per-row filters 0-4 exact", ok(E.encode({ w: W, h: H, colorType: 0, data: gray, filter: (y) => y % 5 }), (r) => same(r.samples, gray)));
  checkAsync("Adam7 + mixed filters on RGBA-equal exact (samples and alpha)",
    ok(E.encode({ w: W, h: H, colorType: 6, data: rgbaEq(gray, alphaV), interlace: 1, filter: (y) => (y * 3) % 5 }),
      (r) => same(r.samples, gray) && same(r.alpha, alphaV) && r.policy === "raw-rgb-equal"));
  checkAsync("RGB-equal → raw-rgb-equal, alpha null", ok(E.encode({ w: W, h: H, colorType: 2, data: rgbEq(gray), filter: 4 }), (r) => same(r.samples, gray) && r.alpha === null && r.policy === "raw-rgb-equal"));
  checkAsync("gray+alpha (ct4) split", ok(E.encode({ w: W, h: H, colorType: 4, data: Uint8Array.from({ length: 2 * N }, (_, i) => i & 1 ? alphaV[i >> 1] : gray[i >> 1]) }),
    (r) => same(r.samples, gray) && same(r.alpha, alphaV)));
  checkAsync("one unequal pixel at the LAST position still rejected", (() => { const d = rgbEq(gray); d[d.length - 1] ^= 1; return rej(E.encode({ w: W, h: H, colorType: 2, data: d }), "PNG_UNEQUAL_RGB"); })());
  checkAsync("tonal mode keeps unequal RGB as raw-rgb (3 ch)", (() => { const d = Uint8Array.from({ length: 3 * N }, (_, i) => (i * 11) & 255);
    return ok(E.encode({ w: W, h: H, colorType: 2, data: d }), (r) => r.channels === 3 && r.policy === "raw-rgb" && same(r.samples, d), "tonal"); })());
  const grayPal = Array.from({ length: 256 }, (_, i) => [255 - i, 255 - i, 255 - i]).flat();
  checkAsync("gray palette (ct3, 8-bit) → raw-palette-gray8 via lookup", ok(E.encode({ w: W, h: H, colorType: 3, data: gray, plte: grayPal }),
    (r) => r.policy === "raw-palette-gray8" && r.samples.every((v, i) => v === 255 - gray[i])));
  checkAsync("gray palette 4-bit + tRNS alpha", (() => { const idx = Uint8Array.from({ length: N }, (_, i) => i % 16);
    const pal = Array.from({ length: 16 }, (_, i) => [i * 17, i * 17, i * 17]).flat(), tr = Array.from({ length: 16 }, (_, i) => 255 - i);
    return ok(E.encode({ w: W, h: H, colorType: 3, bitDepth: 4, data: idx, plte: pal, trns: tr }),
      (r) => r.samples.every((v, i) => v === idx[i] * 17) && r.alpha.every((v, i) => v === 255 - idx[i])); })());
  checkAsync("Adam7 + 2-bit gray palette 37x23 exact", (() => { const idx = Uint8Array.from({ length: N }, (_, i) => (i * 5 + (i >> 3)) & 3);
    const pal = [0, 0, 0, 90, 90, 90, 180, 180, 180, 255, 255, 255];
    return ok(E.encode({ w: W, h: H, colorType: 3, bitDepth: 2, data: idx, plte: pal, interlace: 1, filter: (y) => y % 5 }),
      (r) => r.samples.every((v, i) => v === pal[3 * idx[i]])); })());
  checkAsync("colour palette rejected in height (PNG_PALETTE)", rej(E.encode({ w: 2, h: 1, colorType: 3, data: [0, 1], plte: [255, 0, 0, 0, 255, 0] }), "PNG_PALETTE"));
  check("colour palette passes tonal check", SBPng.check(SBPng.inspect(E.encode({ w: 2, h: 1, colorType: 3, data: [0, 1], plte: [255, 0, 0, 0, 255, 0] })), "tonal") === null);
  checkAsync("16-bit RGBA rejected in tonal decode too", rej(E.encode({ w: 1, h: 1, colorType: 6, bitDepth: 16, data: [0, 0, 0, 0, 0, 0, 0, 0] }), "PNG_16BIT", "tonal"));
  checkAsync("IDAT split into 1-byte chunks decodes exactly", ok(E.encode({ w: W, h: H, colorType: 0, data: gray, idatSplit: 1 }), (r) => same(r.samples, gray)));
  checkAsync("tRNS key on gray → binary alpha", ok(E.encode({ w: 3, h: 1, colorType: 0, data: [5, 6, 5], trns: [0, 5] }), (r) => r.alpha.join() === "0,255,0"));
  checkAsync("corrupt Adler-32 with valid chunk CRC → PNG_INFLATE", rej(E.encode({ w: W, h: H, colorType: 0, data: gray, corruptAdler: true }), "PNG_INFLATE"));
  checkAsync("trailing junk after zlib stream → PNG_INFLATE", rej(E.encode({ w: W, h: H, colorType: 0, data: gray, trailing: 4 }), "PNG_INFLATE"));
  checkAsync("short image data (IHDR claims more rows) → PNG_TRUNCATED", (() => { const p = E.encode({ w: 5, h: 2, colorType: 0, data: Array(10).fill(9) });
    p[20 + 3] = 3; const c = F.crc32(p.subarray(12, 29)); new DataView(p.buffer).setUint32(29, c); return rej(p, "PNG_TRUNCATED"); })());
  checkAsync("bad signature → PNG_SIGNATURE", rej(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), "PNG_SIGNATURE"));
  checkAsync("truncated mid-IDAT → PNG_TRUNCATED", rej(E.encode({ w: W, h: H, colorType: 0, data: gray }).subarray(0, 60), "PNG_TRUNCATED"));
  checkAsync("missing IHDR (first chunk IDAT) → PNG_HEADER", (() => { const p = E.encode({ w: 1, h: 1, colorType: 0, data: [1] });
    return rej(Uint8Array.from([...p.subarray(0, 8), ...p.subarray(33)]), "PNG_HEADER"); })());
  check("eXIf little-endian orientation 8 parsed", SBPng.inspect(E.encode({ w: 1, h: 1, colorType: 0, data: [1],
    extraChunks: [["eXIf", [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0]]] })).exif === 8);
  check("eXIf orientation 9 (invalid) → null", SBPng.inspect(E.encode({ w: 1, h: 1, colorType: 0, data: [1],
    extraChunks: [["eXIf", [0x4d,0x4d,0,42,0,0,0,8,0,1,1,0x12,0,3,0,0,0,1,0,9,0,0]]] })).exif === null);
  check("inspect(verifyCrc:false) skips CRC (corrupt IDAT CRC still inspects)",
    SBPng.inspect(F.pngEncode({ w: 5, h: 1, colorType: 0, bitDepth: 8, data: Uint8Array.from([0, 64, 128, 191, 255]), corruptCrc: true }), { verifyCrc: false }).w === 5);
  check("inspect output is JSON-clean (no buffers)", !/"_/.test(JSON.stringify(SBPng.inspect(E.encode({ w: 1, h: 1, colorType: 0, data: [1] })))));
  checkAsync("NFR-05 sampleHash == SBHash.sha256(samples) (async vs sync agree)", ok(E.encode({ w: W, h: H, colorType: 0, data: gray }), (r) => r.sampleHash === SBHash.sha256(r.samples)));
  checkAsync("gray, RGB-equal, RGBA-equal, Adam7 of same image share one sampleHash", Promise.all([
    E.encode({ w: W, h: H, colorType: 0, data: gray }), E.encode({ w: W, h: H, colorType: 2, data: rgbEq(gray) }),
    E.encode({ w: W, h: H, colorType: 6, data: rgbaEq(gray, alphaV), interlace: 1 })].map((b) => SBPng.decode(b, { mode: "height" })))
    .then((rs) => rs.every((r) => r.sampleHash === rs[0].sampleHash)));
  checkAsync("FINDING (documented, §3): sampleHash covers samples only (5x1 vs 1x5 collide; store with w, h)", Promise.all([[5, 1], [1, 5]].map(([w, h]) =>
    SBPng.decode(E.encode({ w, h, colorType: 0, data: [1, 2, 3, 4, 5] }), { mode: "height" }))).then(([a, b]) => a.sampleHash === b.sampleHash));
  check("NFR-05 png.js uses no Math.random / Date / trig", !/Math\.(random|sin|cos|tan|exp|log)\b|\bDate\b/.test(fs.readFileSync(path.join(__dirname, "../js/png.js"), "utf8")));
});

suite("spike S4 — amendments (error codes, maxPixels, sub-8-bit gray, CRC in util.js)", () => {
  const F = require("./fixtures.js"), E = require("./png_enc.js");
  const rej = (bytes, code, mode = "height", opts = {}) => SBPng.decode(bytes, { mode, ...opts }).then(() => false, (e) => e.code === code || console.error("    got", e.code));
  // Amendment 1: the full error-code set, exported for the G1.0 diagnostic registry.
  const ALL = ["PNG_16BIT", "PNG_APNG", "PNG_CRC", "PNG_TRUNCATED", "PNG_UNEQUAL_RGB", "PNG_PALETTE", "PNG_SIGNATURE",
    "PNG_HEADER", "PNG_INFLATE", "PNG_BITDEPTH", "PNG_TOO_LARGE", "PNG_NO_INFLATE"];
  check("S4-A1 SBPng.CODES lists the 7 plan codes + 5 spike codes, frozen", Array.isArray(SBPng.CODES) && Object.isFrozen(SBPng.CODES) &&
    SBPng.CODES.length === ALL.length && ALL.every((c) => SBPng.CODES.includes(c)));
  checkAsync("S4-A1 PNG_NO_INFLATE when DecompressionStream is unavailable (R8)", (() => {
    // decode() feature-detects synchronously before its first await, so restore right after the call
    // (other checks in this suite decode concurrently).
    const DS = globalThis.DecompressionStream; globalThis.DecompressionStream = undefined;
    try { return rej(E.encode({ w: 1, h: 1, colorType: 0, data: [1] }), "PNG_NO_INFLATE"); } finally { globalThis.DecompressionStream = DS; }
  })());
  checkAsync("S4-A1/AT-22 mini-fuzz: every rejection of 400 mutated PNGs carries a code in SBPng.CODES", (async () => {
    const r = F.lcg(4242), base = E.encode({ w: 9, h: 7, colorType: 0, data: Array.from({ length: 63 }, (_, i) => i * 4), interlace: 1, filter: (y) => y % 5 });
    for (let it = 0; it < 400; it++) {
      const m = Uint8Array.from(base), k = 1 + ((r() * 4) | 0);
      for (let j = 0; j < k; j++) m[(r() * m.length) | 0] = (r() * 256) | 0;
      const bytes = r() < 0.2 ? m.subarray(0, (r() * m.length) | 0) : m;
      try { await SBPng.decode(bytes, { mode: r() < 0.5 ? "height" : "tonal", verifyCrc: r() < 0.5 }); }
      catch (e) { if (!SBPng.CODES.includes(e.code)) { console.error("    uncoded:", e.message); return false; } }
    }
    return true;
  })());
  // Amendment 2: allocation ceiling independent of the IMG-07 preflight.
  checkAsync("S4-A2 FUZZ REGRESSION: IHDR 2^31-1 x 2^31-1 → PNG_TOO_LARGE, no process abort", (() => { const p = E.encode({ w: 1, h: 1, colorType: 0, data: [1] });
    const dv = new DataView(p.buffer); dv.setUint32(16, 0x7fffffff); dv.setUint32(20, 0x7fffffff); dv.setUint32(29, F.crc32(p.subarray(12, 29))); return rej(p, "PNG_TOO_LARGE"); })());
  check("S4-A2 default maxPixels ceiling is 2^26", SBPng.MAX_PIXELS === 1 << 26);
  checkAsync("S4-A2 opts.maxPixels lowers the ceiling (4x4 with maxPixels 15 → PNG_TOO_LARGE; 16 decodes)", (async () => {
    const p = E.encode({ w: 4, h: 4, colorType: 0, data: Array(16).fill(3) });
    return (await rej(p, "PNG_TOO_LARGE", "height", { maxPixels: 15 })) && (await SBPng.decode(p, { mode: "height", maxPixels: 16 })).samples.length === 16;
  })());
  // Amendment 3 (product-owner decision, ARCHITECTURE.md D5): sub-8-bit gray is accepted in height mode by exact integer scaling.
  check("S4-A3 check(): 1/2/4-bit gray passes height mode by default", [1, 2, 4].every((d) =>
    SBPng.check(SBPng.inspect(E.encode({ w: 8, h: 1, colorType: 0, bitDepth: d, data: Array(8).fill(1) })), "height") === null));
  checkAsync("S4-A3 1-bit gray → raw-gray1-scaled8, samples 0/255", SBPng.decode(E.encode({ w: 9, h: 2, colorType: 0, bitDepth: 1, data: Array.from({ length: 18 }, (_, i) => i & 1) }), { mode: "height" })
    .then((r) => r.policy === "raw-gray1-scaled8" && r.samples.every((v, i) => v === (i & 1) * 255)));
  checkAsync("S4-A3 2-bit gray 0..3 → 0,85,170,255 (raw-gray2-scaled8) by default", SBPng.decode(E.encode({ w: 4, h: 1, colorType: 0, bitDepth: 2, data: [0, 1, 2, 3] }), { mode: "height" })
    .then((r) => r.samples.join() === "0,85,170,255" && r.policy === "raw-gray2-scaled8"));
  checkAsync("S4-A3 Adam7 4-bit gray 37x23 → ×17 exact, raw-gray4-scaled8", (() => { const d = Uint8Array.from({ length: 37 * 23 }, (_, i) => (i * 7 + (i >> 4)) & 15);
    return SBPng.decode(E.encode({ w: 37, h: 23, colorType: 0, bitDepth: 4, data: d, interlace: 1, filter: (y) => y % 5 }), { mode: "height" })
      .then((r) => r.policy === "raw-gray4-scaled8" && r.samples.every((v, i) => v === d[i] * 17)); })());
  checkAsync("S4-A3 4-bit gray tRNS key → alpha follows the raw key", SBPng.decode(E.encode({ w: 3, h: 1, colorType: 0, bitDepth: 4, data: [5, 6, 5], trns: [0, 5] }), { mode: "height" })
    .then((r) => r.samples.join() === "85,102,85" && r.alpha.join() === "0,255,0"));
  checkAsync("S4-A3 lowBitDepth:'reject' restores PNG_BITDEPTH", rej(E.encode({ w: 9, h: 2, colorType: 0, bitDepth: 1, data: Array(18).fill(1) }), "PNG_BITDEPTH", "height", { lowBitDepth: "reject" }));
  checkAsync("S4-A3 sub-8-bit gray also scales in tonal mode", SBPng.decode(E.encode({ w: 4, h: 1, colorType: 0, bitDepth: 2, data: [0, 1, 2, 3] }), { mode: "tonal" })
    .then((r) => r.samples.join() === "0,85,170,255"));
  // CRC-32 moved from zip.js into util.js (plan Task S4 Files).
  const bytes = new TextEncoder().encode("123456789");
  check("S4 SBUtil.crc32 reference vector 0xCBF43926", SBUtil.crc32(bytes) === 0xcbf43926);
  check("S4 SBUtil.crc32(bytes, start, end) == crc32 of the slice", SBUtil.crc32(bytes, 2, 7) === SBUtil.crc32(bytes.subarray(2, 7)));
  check("S4 SBUtil.crc32Update chains to the one-shot value",
    ((SBUtil.crc32Update(SBUtil.crc32Update(0xffffffff, bytes, 0, 4), bytes, 4) ^ 0xffffffff) >>> 0) === 0xcbf43926);
  check("S4 SBZip.crc32 delegates to SBUtil.crc32 (no second table in zip.js)", (() => {
    const r = F.lcg(9), d = Uint8Array.from({ length: 1000 }, () => (r() * 256) | 0);
    return SBZip.crc32(d) === SBUtil.crc32(d) && !/CRC_TABLE|0xedb88320/i.test(fs.readFileSync(path.join(__dirname, "../js/zip.js"), "utf8"));
  })());
});

// ------------------------------------------------------------ jpeg.js (S4b)
// Synthetic JPEG builder for structure-only checks (SBJpeg never decodes, so no real entropy data is needed).
const S4B = (() => {
  const seg = (m, body) => { const b = Buffer.alloc(4 + body.length); b[0] = 0xff; b[1] = m; b.writeUInt16BE(body.length + 2, 2); Buffer.from(body).copy(b, 4); return b; };
  // APP1 Exif whose TIFF buffer is `len` bytes (28 = complete 12-byte IFD entry; 26 = entry 2 bytes short).
  const app1 = (o, len = 28, le = false) => { const t = Buffer.alloc(len); t.write("Exif\0\0", 0, "latin1"); t.write(le ? "II" : "MM", 6, "latin1");
    const w16 = (v, p) => (le ? t.writeUInt16LE(v, p) : t.writeUInt16BE(v, p)), w32 = (v, p) => (le ? t.writeUInt32LE(v, p) : t.writeUInt32BE(v, p));
    w16(42, 8); w32(8, 10); w16(1, 14); w16(0x0112, 16); w16(3, 18); w32(1, 20); w16(o, 24); return seg(0xe1, t); };
  const sof = ({ m = 0xc0, precision = 8, w = 8, h = 8, nc = 3 } = {}) => { const s = Buffer.alloc(6 + 3 * nc); s[0] = precision; s.writeUInt16BE(h, 1); s.writeUInt16BE(w, 3); s[5] = nc;
    for (let i = 0; i < nc; i++) { s[6 + 3 * i] = i + 1; s[7 + 3 * i] = 0x11; } return seg(m, s); };
  // entropy data with stuffed FF00 and an RST marker in it, i.e. the bytes scanEnd must skip over
  const entropy = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78, 0xff, 0x00, 0x9a]);
  const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
  const file = ({ pre = [], sofOpts = {}, scans = 1, eoi = true, trailing = 0 } = {}) => new Uint8Array(Buffer.concat([
    Buffer.from([0xff, 0xd8]), ...pre, sof(sofOpts), seg(0xc4, [0, ...Array(16).fill(0)]),
    ...Array.from({ length: scans }, () => Buffer.concat([sos, entropy])), eoi ? Buffer.from([0xff, 0xd9]) : Buffer.alloc(0), Buffer.alloc(trailing, 0xab)]));
  const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code || "UNCODED:" + e.message; } };
  return { seg, app1, sof, file, codeOf };
})();

suite("spike S4b — jpeg.js plan checks (IMG-05/07, AT-22)", () => {
  const F = require("./fixtures.js"), J = SBJpeg, { codeOf } = S4B;
  const i = J.inspect(F.jpegHeader({ w: 6000, h: 4000 }));
  check("IMG-07 JPEG SOF dimensions read before decode", i.w === 6000 && i.h === 4000 && i.components === 3 && i.progressive === false);
  check("IMG-05 JPEG EXIF orientation 6 parsed", J.inspect(F.jpegHeader({ w: 640, h: 480, exif: 6 })).exif === 6);
  const bad = F.jpegHeader({ w: 64, h: 64 }); bad[1] = 0x00;
  check("AT-22 corrupt JPEG (bad SOI) rejected", codeOf(() => J.inspect(bad)) === "JPEG_SIGNATURE");
  check("AT-22 truncated JPEG rejected", codeOf(() => J.inspect(F.jpegHeader({ w: 64, h: 64, truncate: 5 }))) === "JPEG_TRUNCATED");
  check("AT-22 oversized SOF segment length rejected", codeOf(() => J.inspect(F.jpegHeader({ w: 64, h: 64, sofLen: 4000 }))) === "JPEG_BAD_SEGMENT");
  check("S4b SBJpeg.CODES lists the 4 plan codes, frozen", Array.isArray(J.CODES) && Object.isFrozen(J.CODES) && J.CODES.length === 4 &&
    ["JPEG_SIGNATURE", "JPEG_TRUNCATED", "JPEG_BAD_SEGMENT", "JPEG_NO_SOF"].every((c) => J.CODES.includes(c)));
  check("S4b module order: jpeg.js directly after png.js (§4)", (() => { const L = require("./modules.js").NODE_MODULES; return L.indexOf("jpeg.js") === L.indexOf("png.js") + 1; })());
});

suite("spike S4b — jpeg.js header edge cases and Exif", () => {
  const F = require("./fixtures.js"), J = SBJpeg, { seg, app1, sof, file, codeOf } = S4B;
  const hdr = (pre, o = {}) => new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), ...pre, sof(o), Buffer.from([0xff, 0xd9])]));
  let allO = true;
  for (let o = 1; o <= 8; o++) for (const le of [false, true]) { const r = J.inspect(hdr([app1(o, 28, le)])); if (r.exif !== o || r.exifAmbiguous) allO = false; }
  check("IMG-05 Exif orientations 1–8, II and MM, parsed and unambiguous", allO);
  check("IMG-05 T0.3 fixture Exif (amended to a complete IFD entry) is unambiguous", J.inspect(F.jpegHeader({ w: 8, h: 8, exif: 6 })).exifAmbiguous === false);
  check("IMG-05 IFD entry 2 bytes short → exif 6 but exifAmbiguous (Chromium ignores, Firefox applies)",
    (() => { const r = J.inspect(hdr([app1(6, 26)])); return r.exif === 6 && r.exifAmbiguous === true; })());
  const xmp = seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x/>", "latin1"));
  check("IMG-05 XMP APP1 then Exif APP1 → exif 6, exifAmbiguous (browsers disagree)", (() => { const r = J.inspect(hdr([xmp, app1(6)])); return r.exif === 6 && r.exifAmbiguous; })());
  check("IMG-05 Exif after a JFIF APP0 → exif 6, unambiguous", (() => { const r = J.inspect(hdr([seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")), app1(6)])); return r.exif === 6 && !r.exifAmbiguous; })());
  check("IMG-05 orientation 9 (invalid) → exif null", J.inspect(hdr([app1(9)])).exif === null);
  check("IMG-05 no APP1 → exif null", J.inspect(F.jpegHeader({ w: 8, h: 8 })).exif === null);
  const full = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), app1(6), sof()])), hb = J.inspect(full).headerBytes;
  let worst = "";
  for (let k = 0; k < hb; k++) { const c = codeOf(() => J.inspect(full.subarray(0, k))), want = k < 2 ? "JPEG_SIGNATURE" : "JPEG_TRUNCATED"; if (c !== want) worst = `k=${k} got ${c}`; }
  check(`AT-22 every prefix shorter than headerBytes (${hb}) → SIGNATURE (<2) / TRUNCATED` + (worst ? " — " + worst : ""), hb === full.length && worst === "");
  check("AT-22 SOF lengths 8, 16, 18 (≠ 8 + 3·Nc) → BAD_SEGMENT", [8, 16, 18].every((s) => codeOf(() => J.inspect(F.jpegHeader({ w: 8, h: 8, sofLen: s }))) === "JPEG_BAD_SEGMENT"));
  check("AT-22 Nc = 0 → BAD_SEGMENT", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 8, 0, 8, 0]))) === "JPEG_BAD_SEGMENT");
  check("AT-22 empty input and PNG bytes → SIGNATURE", codeOf(() => J.inspect(new Uint8Array(0))) === "JPEG_SIGNATURE" &&
    codeOf(() => J.inspect(F.pngEncode({ w: 2, h: 2, colorType: 0, bitDepth: 8, data: new Uint8Array(4) }))) === "JPEG_SIGNATURE");
  check("AT-22 SOI then EOI / SOI then SOS → NO_SOF", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))) === "JPEG_NO_SOF" &&
    codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))) === "JPEG_NO_SOF");
  check("AT-22 segment length 0 → BAD_SEGMENT", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))) === "JPEG_BAD_SEGMENT");
  check("AT-22 garbage byte between segments → BAD_SEGMENT", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0x00, ...sof()]))) === "JPEG_BAD_SEGMENT");
  check("AT-22 second SOI / FF00 before SOF → BAD_SEGMENT", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xd8, ...sof()]))) === "JPEG_BAD_SEGMENT" &&
    codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0x00, ...sof()]))) === "JPEG_BAD_SEGMENT");
  check("APP segment running past the data → TRUNCATED", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0x10, 0x00, 1, 2, 3]))) === "JPEG_TRUNCATED");
  check("fill bytes and RSTn/TEM before SOF are skipped", J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xd0, 0xff, 0x01, 0xff, 0xff, ...sof({ w: 3, h: 2 })])).w === 3);
  check("ArrayBuffer input accepted", J.inspect(F.jpegHeader({ w: 5, h: 7 }).slice().buffer).h === 7);
  check("progressive SOF2 → progressive, sof 0xC2", (() => { const r = J.inspect(hdr([], { m: 0xc2 })); return r.progressive && r.sof === 0xc2 && !r.arithmetic; })());
  check("NFR-07 never touches scan data: headerBytes stops at the end of SOF", (() => { const b = file({ pre: [app1(6)] }); return J.inspect(b).headerBytes === 2 + app1(6).length + sof().length; })());
  check("inspect output is JSON-clean (plain numbers/booleans)", (() => { const r = J.inspect(file()); return JSON.stringify(JSON.parse(JSON.stringify(r))) === JSON.stringify(r); })());
  check("NFR-05 jpeg.js uses no Math.random / Date / trig", !/Math\.(random|sin|cos|tan|exp|log)\b|\bDate\b/.test(fs.readFileSync(path.join(__dirname, "../js/jpeg.js"), "utf8")));
});

suite("spike S4b — unsupported(), scanEnd() and mini-fuzz (G2.14 preflight, AT-22)", () => {
  const J = SBJpeg, { file, codeOf } = S4B;
  const un = (o) => J.unsupported(J.inspect(file({ sofOpts: o })));
  check("G2.14 baseline 8-bit Nc 1/3/4 supported", [1, 3, 4].every((nc) => un({ nc }) === null) && un({ m: 0xc2 }) === null && un({ m: 0xc1 }) === null);
  check("G2.14 12-bit precision unsupported", un({ m: 0xc1, precision: 12 }) === "12-bit precision");
  check("G2.14 arithmetic coding (SOF9/SOF10) unsupported", un({ m: 0xc9 }) === "arithmetic coding" && un({ m: 0xca }) === "arithmetic coding");
  check("G2.14 lossless (SOF3) unsupported", un({ m: 0xc3 }) === "lossless");
  check("G2.14 hierarchical (SOF5) unsupported", un({ m: 0xc5 }) === "hierarchical");
  check("G2.14 zero height (DNL) unsupported", un({ h: 0 }) === "zero dimension (DNL)");
  check("G2.14 Nc = 2 unsupported", un({ nc: 2 }) === "2 components");
  const ok = file({ scans: 3 });
  check("AT-22 scanEnd finds EOI through FF00 stuffing and RSTn, counts scans", (() => { const s = J.scanEnd(ok, J.inspect(ok).headerBytes); return s.eoi === ok.length - 2 && s.trailing === 0 && s.scans === 3; })());
  check("AT-22 scanEnd from default offset (2) agrees", J.scanEnd(ok).eoi === ok.length - 2);
  const tr = file({ trailing: 4096 });
  check("AT-22 trailing payload after EOI (Motion Photo) accepted, trailing counted", J.scanEnd(tr, J.inspect(tr).headerBytes).trailing === 4096);
  check("AT-22 missing EOI → eoi null", J.scanEnd(file({ eoi: false }), 2).eoi === null);
  let missed = 0; const hb = J.inspect(ok).headerBytes;
  for (let k = hb; k < ok.length; k++) if (J.scanEnd(ok.subarray(0, k), hb).eoi !== null) missed++;
  check(`AT-22 every cut in [headerBytes, len) → scanEnd eoi null, while inspect still succeeds (${ok.length - hb} cuts)`,
    missed === 0 && J.inspect(ok.subarray(0, hb)).w === 8);
  check("scanEnd on garbage / ArrayBuffer never throws", (() => { try { J.scanEnd(new Uint8Array([1, 2, 3]), 0); J.scanEnd(new Uint8Array(0)); return J.scanEnd(ok.slice().buffer).eoi === ok.length - 2; } catch { return false; } })());
  // mini-fuzz: every rejection carries a code in SBJpeg.CODES; scanEnd never throws.
  const rng = require("./fixtures.js").lcg(0x54b);
  const seeds = [file({ pre: [S4B.app1(6)] }), file({ sofOpts: { m: 0xc2, nc: 1 }, scans: 2 }), file({ sofOpts: { nc: 4 }, trailing: 16 })];
  let uncoded = 0, first = "", threwScan = 0;
  for (const seed of seeds) for (let i = 0; i < 400; i++) {
    const b = seed.slice(0, 1 + Math.floor(rng() * seed.length)), k = 1 + Math.floor(rng() * 4);
    for (let j = 0; j < k; j++) b[Math.floor(rng() * b.length)] = rng() < 0.5 ? Math.floor(rng() * 256) : [0xff, 0x00, 0xd8, 0xd9, 0xda, 0xc0, 0xe1][Math.floor(rng() * 7)];
    const c = codeOf(() => J.inspect(b)); if (c !== null && !J.CODES.includes(c)) { uncoded++; first ||= c; }
    try { J.scanEnd(b, 2); } catch { threwScan++; }
  }
  check("AT-22 mini-fuzz 1200 mutations: every inspect rejection has a code in SBJpeg.CODES" + (first ? " — " + first : ""), uncoded === 0);
  check("AT-22 mini-fuzz 1200 mutations: scanEnd never throws", threwScan === 0);
});

suite("diag.js — SBDiag registry, make() and aggregate() (§9.1, §9.5, UI-04; G1.0)", () => {
  const D = globalThis.SBDiag;
  check("G1.0 SBDiag is loaded", !!D && typeof D.make === "function" && typeof D.aggregate === "function");
  if (!D) return;
  check("§4 module order: diag.js directly after geom.js", (() => { const L = require("./modules.js").NODE_MODULES; return L.indexOf("diag.js") === L.indexOf("geom.js") + 1; })());
  const C = D.CODES;
  const PLAN = {
    blocking: ["BOND_UNSUPPORTED", "BOND_EMPTY_UNDER", "GEO_SELF_INTERSECT", "GEO_ZERO_AREA", "GEO_DUPLICATE", "GEO_OPEN",
      "SAMPLING_LOW", "NONFINITE", "REG_HOLE_INVALID", "PAGE_OVERFLOW", "CONNECTED_SPLIT", "STALE",
      "REPAIR_STALE", "COMPLEXITY_LIMIT", "LEGACY_NEEDS_SOURCE", "GUIDE_UNCONTAINED"],
    warning: ["MAT_UNCALIBRATED", "PART_SMALL", "PART_THIN", "NECK_NARROW", "SUPPORT_NARROW",
      "GUIDE_OMITTED", "CLEANUP_ALTERED", "SMOOTH_FALLBACK", "TRAILING_OMITTED",
      "ALIGN_CLEARANCE_ZERO", "REPAIR_REVIEW_FAB", "FAB_EXCEEDS_SOURCE"],
    info: ["KERF_EXTERNAL", "PALETTE_ONLY", "IDENTICAL_LAYERS", "EMPTY_BAND", "DISPLAY_ONLY_IGNORED", "HEIGHT_FILTERED", "RESAMPLED"],
  };
  for (const sev of Object.keys(PLAN)) {
    const wrong = PLAN[sev].filter((c) => !C[c] || C[c].severity !== sev);
    check("§9.5 every plan " + sev + " code registered with severity " + sev + (wrong.length ? " — " + wrong.join(",") : ""), wrong.length === 0);
  }
  const imports = [...SBPng.CODES, ...SBJpeg.CODES, "JPEG_UNSUPPORTED"];
  const missImp = imports.filter((c) => !C[c] || C[c].severity !== "blocking" || C[c].kind !== "process");
  check("Appendix C S4/S4b: every SBPng.CODES, SBJpeg.CODES and JPEG_UNSUPPORTED registered (blocking, process)" + (missImp.length ? " — " + missImp.join(",") : ""), missImp.length === 0);
  const geoValidate = ["GEO_OPEN", "GEO_ZERO_AREA", "GEO_DUPLICATE", "GEO_SELF_INTERSECT", "GEO_MULTIPART"];
  check("G1.1 every SBGeom.validate code is a registered blocking geometry code (D3 GEO_MULTIPART included)",
    geoValidate.every((c) => C[c] && C[c].severity === "blocking" && C[c].kind === "geometry"));
  const all = Object.keys(C);
  check("UI-04 every code has non-empty title and fix text",
    all.length > 0 && all.every((c) => typeof C[c].title === "string" && C[c].title.trim().length > 0 && typeof C[c].fix === "string" && C[c].fix.trim().length > 0));
  check("§9.5 every code has a valid severity and kind",
    all.every((c) => ["blocking", "warning", "info"].includes(C[c].severity) && ["geometry", "fabrication", "process"].includes(C[c].kind)));
  check("§9.5 CODES and its entries are frozen", Object.isFrozen(C) && all.every((c) => Object.isFrozen(C[c])));
  check("§9.5 information codes include palette-only, identical layers and display-only",
    ["PALETTE_ONLY", "IDENTICAL_LAYERS", "DISPLAY_ONLY_IGNORED"].every((c) => C[c] && C[c].severity === "info"));
  check("D1 SMOOTH_FALLBACK is a warning (connected mode only)", C.SMOOTH_FALLBACK && C.SMOOTH_FALLBACK.severity === "warning");

  const b = D.make("BOND_UNSUPPORTED", { severity: "warning", revision: 3, quality: "fabrication", layer: 2 });
  check("§9.5 make() ignores attempted severity override", b.severity === "blocking" && b.ackState === "n/a");
  const w = D.make("PART_SMALL", { revision: 7, quality: "draft", layer: 1, part: "L01-P003", areaMM2: 4.5,
    region: [0, 0, 10, 10], measured: { value: 4.5, unit: "mm2" }, limit: { value: 25, unit: "mm2" }, detail: "4.5 mm² < 25 mm²" });
  const FIELDS = ["id", "code", "severity", "revision", "quality", "layer", "part", "areaMM2", "region", "measured", "limit", "message", "fix", "ackState"];
  check("§9.1 diagnostic carries revision, quality, measured, limit, ackState",
    w.revision === 7 && w.quality === "draft" && w.measured.value === 4.5 && w.measured.unit === "mm2" && w.limit.value === 25 && w.ackState === "unacked");
  check("§9.1 make() fills every Diagnostic field", FIELDS.every((f) => Object.prototype.hasOwnProperty.call(w, f)) && FIELDS.every((f) => Object.prototype.hasOwnProperty.call(b, f)));
  check("§9.1 message and fix come from the registry (detail appended to message)",
    w.message.startsWith(C.PART_SMALL.title) && w.message.includes("4.5 mm² < 25 mm²") && w.fix === C.PART_SMALL.fix && b.message === C.BOND_UNSUPPORTED.title);
  check("§9.1 unset references are null, not undefined", b.part === null && b.region === null && b.measured === null && b.limit === null && b.areaMM2 === null);
  check("§9.5 info ackState is n/a", D.make("KERF_EXTERNAL", { revision: 1, quality: "draft" }).ackState === "n/a");
  check("§9.1 id is deterministic", D.make("PART_SMALL", { revision: 7, quality: "draft", layer: 1, part: "L01-P003", region: [0, 0, 10, 10] }).id ===
    D.make("PART_SMALL", { revision: 7, quality: "draft", layer: 1, part: "L01-P003", region: [0, 0, 10, 10] }).id);
  check("§9.1 id distinguishes parts", D.make("PART_SMALL", { revision: 1, quality: "draft", layer: 1, part: "L01-P001" }).id !==
    D.make("PART_SMALL", { revision: 1, quality: "draft", layer: 1, part: "L01-P002" }).id);
  const throws = (f) => { try { f(); return false; } catch { return true; } };
  check("§9.5 make() rejects unknown codes", throws(() => D.make("NOT_A_CODE", { revision: 1, quality: "draft" })));
  check("§9.1 make() rejects an invalid quality", throws(() => D.make("STALE", { revision: 1, quality: "final" })));
  check("§9.1 make() rejects a nonfinite measured value", throws(() => D.make("PART_THIN", { revision: 1, quality: "draft", measured: { value: NaN, unit: "mm" } })));

  const many = [];
  for (let i = 0; i < 500; i++) many.push(D.make("PART_SMALL", { revision: 2, quality: "draft", layer: 3, part: "L03-P" + String(i + 1).padStart(3, "0"),
    areaMM2: 1 + (i % 7), region: [i, 0, i + 1, 1], measured: { value: 1 + (i % 7), unit: "mm2" }, limit: { value: 25, unit: "mm2" } }));
  const agg = D.aggregate(many);
  check("§9.5 aggregate: 500 PART_SMALL on one layer → 1 diagnostic, count 500", agg.length === 1 && agg[0].count === 500);
  check("§9.5 aggregate keeps parts[] and the region list", agg[0].parts.length === 500 && agg[0].parts[0] === "L03-P001" && Array.isArray(agg[0].region) && agg[0].region.length === 500 && agg[0].part === null);
  check("§9.5 aggregate reports worst measured value and keeps severity/ackState", agg[0].measured.value === 1 && agg[0].severity === "warning" && agg[0].ackState === "unacked" && agg[0].limit.value === 25);
  const mixed = [D.make("STALE", { revision: 2, quality: "draft" }),
    D.make("PART_THIN", { revision: 2, quality: "draft", layer: 1, part: "L01-P001" }),
    D.make("PART_THIN", { revision: 2, quality: "draft", layer: 2, part: "L02-P001" }),
    D.make("NECK_NARROW", { revision: 2, quality: "draft", layer: 1, part: "L01-P002" }),
    D.make("PART_THIN", { revision: 2, quality: "draft", layer: 1, part: "L01-P004" }),
    D.make("GEO_OPEN", { revision: 2, quality: "draft", layer: 1 }),
    D.make("GEO_OPEN", { revision: 2, quality: "draft", layer: 1 })];
  const am = D.aggregate(mixed);
  check("§9.5 aggregate groups per (code, layer), leaves other codes alone, order by first occurrence",
    JSON.stringify(am.map((d) => d.code + ":" + d.layer + ":" + (d.count || 1))) ===
    JSON.stringify(["STALE:null:1", "PART_THIN:1:2", "PART_THIN:2:1", "NECK_NARROW:1:1", "GEO_OPEN:1:1", "GEO_OPEN:1:1"]));
  check("§9.5 aggregate is idempotent", JSON.stringify(D.aggregate(am)) === JSON.stringify(am));
  check("§9.5 aggregate does not mutate its input", mixed.length === 7 && mixed[1].count === undefined && mixed[1].part === "L01-P001");
});

suite("material.js — canonical polygons (GEO-01/03, D-4.2, SUP-05; G1.1)", () => {
  const F = require("./fixtures.js"), O = require("./oracle_raster.js"), G = SBGeom, M = globalThis.SBMaterial;
  check("G1.1 SBMaterial is loaded", !!M && typeof M.fromMasks === "function" && typeof M.assignParts === "function" && typeof M.scale === "function");
  if (!M) return;
  check("§4 module order: material.js after trace.js (construct not yet present)", (() => { const L = require("./modules.js").NODE_MODULES; return L.indexOf("material.js") === L.indexOf("trace.js") + 1; })());
  // ---- plan checks (verbatim)
  const d = F.MASKS.donutIsland;
  const L = SBMaterial.assignParts(SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, {}));
  const parts = L[1].parts;
  check("GEO-01 donut+island → 2 parts", parts.length === 2);
  check("GEO-01 ring part has exactly 1 hole", parts.some((p) => p.polygon.holes.length === 1));
  check("GEO-01 island is its own part, no hole", parts.some((p) => p.polygon.holes.length === 0));
  check("GEO-01 carriers representable and empty in v1.0", Array.isArray(L[1].carriers) && L[1].carriers.length === 0);
  check("GEO-03 no validation diagnostics on clean fixture", L[1].diagnostics.length === 0);
  check("SUP-05 ID format L01-P001", /^L01-P00[12]$/.test(parts[0].id));
  const shuffled = SBMaterial.assignParts(SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, {}).map((l) => ({ ...l, parts: l.parts.slice().reverse() })));
  check("SUP-05 part order stable across runs and shuffled input", JSON.stringify(shuffled[1].parts.map((p) => p.id + p.areaMM2)) === JSON.stringify(parts.map((p) => p.id + p.areaMM2)));
  const s = SBMaterial.scale({ w: 300, h: 197, artWMM: 304.8, artHMM: 200 });
  check("D-4.2 non-square px scales both axes", s.sxUm === 1016 && Math.abs(s.syUm - 200000 / 197) < 1e-9);
  check("GEO-06 sampling uses larger pixel dimension", s.mmPerPxMax === Math.max(304.8 / 300, 200 / 197));
  // ---- MaterialLayer contract (§3, §9.2)
  const KEYS = ["index", "zBottomMM", "zTopMM", "status", "material", "carriers", "parts", "cutPaths", "scorePaths", "holes", "stats", "diagnostics", "canonicalHash"];
  check("§9.2 MaterialLayer carries every §3 field", L.every((l) => KEYS.every((k) => Object.prototype.hasOwnProperty.call(l, k))));
  check("§9.2 layer indices are 0..N-1 in order", L.length === 2 && L[0].index === 0 && L[1].index === 1);
  check("§9.2 non-empty layers have status ok", L[0].status === "ok" && L[1].status === "ok");
  check("GEO-01 material is SBGeom-normalized", JSON.stringify(G.normalize(L[1].material)) === JSON.stringify(L[1].material));
  const comps = G.components(L[1].material).map((c) => JSON.stringify(c[0]));
  check("GEO-01 parts are exactly SBGeom.components(material) (one polygon per part, D3)",
    comps.length === parts.length && parts.every((p) => comps.includes(JSON.stringify(p.polygon))));
  check("§3 Part carries layer, bbox, areaMM2, supports[], guideRefs[], warnings[]",
    parts.every((p) => p.layer === 1 && Array.isArray(p.bbox) && p.bbox.length === 4 && Number.isFinite(p.areaMM2) && Array.isArray(p.supports) && Array.isArray(p.guideRefs) && Array.isArray(p.warnings)));
  // donut: 7×7 outer minus 5×5 hole = 24 px; island 1 px; 1 mm/px → 25 mm²
  check("GEO-01 stats.areaMM2 = area/1e6 (24 + 1 mm²)", L[1].stats.areaMM2 === 25 && parts.map((p) => p.areaMM2).sort((a, b) => a - b).join() === "1,24");
  check("GEO-01 stats.cutMM = ring perimeters (28 + 20 + 4 mm)", L[1].stats.cutMM === 52);
  check("GEO-01 stats.vertices counts every ring vertex (4 + 4 + 4)", L[1].stats.vertices === 12);
  check("GEO-01 cutPaths are the material rings", L[1].cutPaths.length === 3 && L[1].cutPaths.every(Array.isArray));
  check("§3 scorePaths and holes empty until G3", L[1].scorePaths.length === 0 && L[1].holes.length === 0);
  check("D4/amendment B canonicalHash = SBGeom.materialHash(layer)", L.every((l) => l.canonicalHash === G.materialHash(l)) && /^[0-9a-f]{64}$/.test(L[1].canonicalHash));
  check("D4 canonicalHash independent of parts/IDs (shuffled parts, same hash)", shuffled[1].canonicalHash === L[1].canonicalHash);
  // ---- base layer and exact page geometry (D-4.2)
  check("D-4.2 base layer B is the exact 4-vertex art rectangle", JSON.stringify(L[0].material) === JSON.stringify([{ outer: [0, 0, 9000, 0, 9000, 9000, 0, 9000], holes: [] }]));
  const fw = 300, fh = 197, full = new Uint8Array(fw * fh).fill(1);
  const big = SBMaterial.fromMasks([full, full], fw, fh, { artWMM: 304.8, artHMM: 200, frameMM: 0 }, {});
  check("D-4.2 non-square 300×197 px traced full layer spans exactly 304.8 × 200 mm", JSON.stringify(big[1].material[0].outer) === "[0,0,304800,0,304800,200000,0,200000]" && JSON.stringify(big[1].material) === JSON.stringify(big[0].material));
  const fr = SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 2.5 }, {});
  check("D-4.2 art is offset by frameMM on both axes", JSON.stringify(fr[0].material[0].outer) === "[2500,2500,11500,2500,11500,11500,2500,11500]" && G.bbox(fr[1].material[0]).join() === "3500,3500,10500,10500");
  // ---- empty layer
  const e = F.MASKS.emptyIntermediate, Le = SBMaterial.fromMasks(e.layers, e.w, e.h, { artWMM: 5, artHMM: 5, frameMM: 0 }, {});
  check("§3 empty mask → status empty, no material, no parts, zero stats", Le[1].status === "empty" && Le[1].material.length === 0 && Le[1].parts.length === 0 && Le[1].stats.areaMM2 === 0 && Le[1].stats.vertices === 0);
  check("D4 empty layer canonicalHash = sha256 of words [1, k, 0, 0, 0]", Le[1].canonicalHash === SBHash.sha256(new Uint8Array(new Int32Array([1, 1, 0, 0, 0]).buffer)));
  check("§3 layers above an empty layer are still produced (no dedupe, no omission)", Le.length === 3 && Le[2].status === "ok" && Le[2].parts.length === 1);
  // ---- deterministic part IDs (SUP-05, §9.2)
  const st = F.art(["##..#", "##...", ".....", "#..##", "...##"]), St = SBMaterial.fromMasks([new Uint8Array(25).fill(1), st.m], 5, 5, { artWMM: 5, artHMM: 5, frameMM: 0 }, {});
  check("SUP-05 parts sorted by (bbox minY, minX, −area): row 0 left→right, then row 3",
    St[1].parts.map((p) => p.id + "@" + p.bbox[0] / 1000 + "," + p.bbox[1] / 1000).join(" ") === "L01-P001@0,0 L01-P002@4,0 L01-P003@0,3 L01-P004@3,3");
  check("SUP-05 fromMasks already assigns IDs; assignParts is idempotent", JSON.stringify(SBMaterial.assignParts(St)) === JSON.stringify(St) && St[1].parts.every((p) => typeof p.id === "string"));
  // same (minY, minX): larger area first; same area too: total order on coordinates (ringHash tiebreak)
  const tie = SBMaterial.assignParts([{ index: 2, parts: [
    { layer: 2, polygon: { outer: [0, 0, 1000, 0, 1000, 1000, 0, 1000], holes: [] }, bbox: [0, 0, 1000, 1000], areaMM2: 1 },
    { layer: 2, polygon: { outer: [0, 0, 3000, 0, 3000, 1000, 0, 1000], holes: [] }, bbox: [0, 0, 3000, 1000], areaMM2: 3 },
    { layer: 2, polygon: { outer: [0, 0, 2000, 0, 0, 1000], holes: [] }, bbox: [0, 0, 2000, 1000], areaMM2: 1 },
  ] }]);
  check("SUP-05 equal (minY, minX): larger area first, equal area broken by the ring-sequence total order (vertex count, then coordinates), labels L02-",
    tie[0].parts.map((p) => p.id + ":" + p.areaMM2 + ":" + p.bbox[2]).join() === "L02-P001:3:3000,L02-P002:1:2000,L02-P003:1:1000");
  const tie2 = SBMaterial.assignParts([{ index: 2, parts: tie[0].parts.slice().reverse().map((p) => ({ ...p, id: undefined })) }]);
  check("SUP-05 tie order independent of input order", JSON.stringify(tie2[0].parts.map((p) => p.id + p.bbox[2])) === JSON.stringify(tie[0].parts.map((p) => p.id + p.bbox[2])));
  check("SUP-05 assignParts does not mutate its input", tie2[0].parts.length === 3 && (() => { const inp = [{ index: 0, parts: [{ layer: 0, polygon: { outer: [0, 0, 1, 0, 1, 1], holes: [] }, bbox: [0, 0, 1, 1], areaMM2: 0 }] }]; SBMaterial.assignParts(inp); return inp[0].parts[0].id === undefined; })());
  const many = new Uint8Array(80 * 60); for (let y = 0; y < 60; y += 2) for (let x = 0; x < 80; x += 2) many[y * 80 + x] = 1;
  const Lm = SBMaterial.fromMasks([new Uint8Array(4800).fill(1), many], 80, 60, { artWMM: 80, artHMM: 60, frameMM: 0 }, {});
  check("SUP-05 > 999 parts keep unique, ordered IDs (L01-P1200 last)", Lm[1].parts.length === 1200 &&
    new Set(Lm[1].parts.map((p) => p.id)).size === 1200 && Lm[1].parts[1199].id === "L01-P1200");
  // part-ID stability is tied to materialHash (D4 amendment B)
  const r1 = SBMaterial.fromMasks([new Uint8Array(25).fill(1), st.m], 5, 5, { artWMM: 5, artHMM: 5, frameMM: 0 }, {});
  check("D4/SUP-05 same materialHash → same part IDs and polygons (repeat run)", r1[1].canonicalHash === St[1].canonicalHash && JSON.stringify(r1[1].parts) === JSON.stringify(St[1].parts));
  // ---- D3 / spike S5 ported checks for G1.1 (Appendix C)
  const cyc = F.art(["##.#.", "#.###", "##.##", "###.."]);
  const Lc = SBMaterial.fromMasks([new Uint8Array(20).fill(1), cyc.m], 5, 4, { artWMM: 5, artHMM: 4, frameMM: 0 }, {});
  check("D3/AT-06 cyclic saddle contact: 2 parts, distinct IDs, no diagnostics", Lc[1].parts.length === 2 && Lc[1].parts[0].id !== Lc[1].parts[1].id && Lc[1].diagnostics.length === 0);
  check("D3 cyclic saddle: parts in pixel-exact bijection with raster 4-components", O.checkPartsAgainstRaster(Lc[1].parts.map((p) => p.polygon), cyc.m, 5, 4, 1000, 0).ok);
  const dt = F.MASKS.diagonalTouch, Ld = SBMaterial.fromMasks(dt.layers, dt.w, dt.h, { artWMM: 6, artHMM: 6, frameMM: 0 }, {});
  check("AT-06 diagonal-only contact → 2 parts (point contact never joins)", Ld[1].parts.length === 2 && Ld[1].diagnostics.length === 0);
  let okB = true, okV = true, cyc2 = 0, first = "";
  for (let sd = 1; sd <= 200 && okB; sd++) {
    const r = F.lcg(sd * 13 + 5), w = 20, h = 16, mm = new Uint8Array(w * h); for (let i = 0; i < mm.length; i++) mm[i] = r() < 0.55 ? 1 : 0;
    cyc2 += O.saddleStats(mm, w, h).multiPartSaddleCycles;
    const frameUm = 250 * (sd % 3); // 250 µm/px, art offset 0 / 250 / 500 µm
    const Lr = SBMaterial.fromMasks([new Uint8Array(w * h).fill(1), mm], w, h, { artWMM: w * 0.25, artHMM: h * 0.25, frameMM: frameUm / 1000 }, {});
    const or = O.checkPartsAgainstRaster(Lr[1].parts.map((p) => p.polygon), mm, w, h, 250, frameUm);
    if (!or.ok) { okB = false; first = or.reasons.slice(0, 2).join("; "); }
    if (Lr[1].diagnostics.length) okV = false;
  }
  check(`D3 property (200 noise masks, ${cyc2} multi-part saddle cycles): parts in pixel-exact bijection with BFS 4-components${first ? " — " + first : ""}`, okB && cyc2 > 100);
  check("GEO-03 those 200 noise layers raise no validation diagnostics", okV);
  // ---- validation errors become blocking geometry diagnostics (GEO-03)
  const bad = SBMaterial.diagnosticsFor([{ outer: [0, 0, 300, 0, 300, 300, 0, 300], holes: [[100, 0, 50, 100, 150, 100], [200, 0, 150, 100, 250, 100]] }], 3, { revision: 4, quality: "fabrication" });
  check("GEO-03 SBGeom.validate errors → blocking SBDiag diagnostics with layer, revision, quality, region",
    bad.length === 1 && bad[0].code === "GEO_MULTIPART" && bad[0].severity === "blocking" && bad[0].layer === 3 && bad[0].revision === 4 && bad[0].quality === "fabrication" &&
    JSON.stringify(bad[0].region) === "[0,0,0.3,0.3]");
  check("GEO-03 clean material → no diagnostics", SBMaterial.diagnosticsFor(L[1].material, 1, {}).length === 0);
  const dflt = SBMaterial.diagnosticsFor([{ outer: [0, 0, 10, 0, 20, 0], holes: [] }], 0, {});
  check("§9.1 diagnostics default to revision 0 / draft quality", dflt.length > 0 && dflt.every((x) => x.revision === 0 && x.quality === "draft"));
  // ---- D1: bonded is unsmoothed (connected-mode smoothing: suite "smoothing — …", G1.2)
  const ci = F.MASKS.crescentInterior, pg = { artWMM: ci.w * 0.25, artHMM: ci.h * 0.25, frameMM: 0 };
  check("D1 bonded mode is unsmoothed: smooth {mode: bonded} equals raw contours",
    JSON.stringify(SBMaterial.fromMasks(ci.layers, ci.w, ci.h, pg, { smooth: { tolUm: 50, mode: "bonded" } }).map((l) => l.material)) === JSON.stringify(SBMaterial.fromMasks(ci.layers, ci.w, ci.h, pg, {}).map((l) => l.material)));
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  // ---- input guards
  check("NONFINITE non-finite or non-positive art size throws", throws(() => SBMaterial.fromMasks(d.layers, 9, 9, { artWMM: NaN, artHMM: 9, frameMM: 0 }, {}), /NONFINITE/) &&
    throws(() => SBMaterial.scale({ w: 9, h: 9, artWMM: 0, artHMM: 9 }), /NONFINITE/) && throws(() => SBMaterial.fromMasks(d.layers, 9, 9, { artWMM: 9, artHMM: 9, frameMM: -1 }, {}), /NONFINITE/));
  check("D4/amendment C page beyond COORD_LIMIT throws a coded error (never truncates)", throws(() => SBMaterial.fromMasks(d.layers, 9, 9, { artWMM: 40000, artHMM: 9, frameMM: 0 }, {}), /COORD_LIMIT/));
  check("mask size mismatch throws", throws(() => SBMaterial.fromMasks([new Uint8Array(5)], 9, 9, { artWMM: 9, artHMM: 9, frameMM: 0 }, {})));
});

suite("smoothing — bounded, connected mode; bonded unsmoothed (GEO-04, D1, AT-09; G1.2)", () => {
  const F = require("./fixtures.js"), G = SBGeom, M = SBMaterial, T = SBTrace;
  check("G1.2 API present", typeof G.maxDeviationUm === "function" && typeof G.ringTopology === "function" && typeof T.smoothLevel === "function" && typeof M.smoothStack === "function");
  if (typeof M.smoothStack !== "function" || typeof T.smoothLevel !== "function" || typeof G.maxDeviationUm !== "function" || typeof G.ringTopology !== "function") return;
  // ---- plan checks (verbatim, except the stair constant: spike S2 F2, see below)
  const stair = [[0,0],[1,0],[1,1],[2,1],[2,2],[3,2],[3,3],[0,3]];
  const toUm = (lp, s) => lp.flatMap(([x, y]) => [Math.round(x * s), Math.round(y * s)]);
  const dev = G.maxDeviationUm(toUm(stair, 1000), toUm(SBTrace.smoothLevel(stair, "chaikin", () => false, 0), 1000));
  // S2 F2: the plan's "176.78" is the UNIT-corner constant; the stair's 3-unit corners give 3 × 176.78 = 530.33 µm.
  check("GEO-04 deviation of chaikin(staircase) at 1 mm/px within 1 µm of 530.33 (3-unit corners; S2 F2)", Math.abs(dev - 530.33) <= 1);
  const unit = [[0,0],[1,0],[1,1],[0,1]];
  const devUnit = G.maxDeviationUm(toUm(unit, 1000), toUm(SBTrace.smoothLevel(unit, "chaikin", () => false, 0), 1000));
  check("GEO-04 deviation of chaikin(unit corner) at 1 mm/px within 1 µm of 176.78 (0.125·√2 px)", Math.abs(devUnit - 176.78) <= 1);
  const r = SBMaterial.smoothStack([[], [stair]], { tolUm: 1, sxUm: 250, syUm: 250, mode: "connected" });
  check("GEO-04 tolerance exceeded (1 µm @ 250 µm/px) → fallback recorded", r.levels[1][0] !== "chaikin" && r.fallbacks.length > 0);
  // densified measurement is never below a brute-force sampled distance
  const rng = F.lcg(3); let okDense = true;
  for (let t = 0; t < 20; t++) { const A = [0,0,1000,0,1000,1000,0,1000], B = A.map((v) => v + Math.round((rng() - 0.5) * 200));
    const brute = (P, Q) => { let m = 0; for (let i = 0; i < P.length; i += 2) { const j = (i + 2) % P.length;
      for (let s = 0; s <= 100; s++) { const x = P[i] + (P[j] - P[i]) * s / 100, y = P[i + 1] + (P[j + 1] - P[i + 1]) * s / 100;
        let best = Infinity; for (let k = 0; k < Q.length; k += 2) { const l = (k + 2) % Q.length, dx = Q[l] - Q[k], dy = Q[l + 1] - Q[k + 1];
          const u = Math.max(0, Math.min(1, ((x - Q[k]) * dx + (y - Q[k + 1]) * dy) / (dx * dx + dy * dy || 1)));
          best = Math.min(best, Math.hypot(x - Q[k] - u * dx, y - Q[k + 1] - u * dy)); } m = Math.max(m, best); } } return m; };
    if (G.maxDeviationUm(A, B) + 1 < Math.max(brute(A, B), brute(B, A))) okDense = false; }
  check("GEO-04 deviation measured at segment interiors (densified ≥ sampled)", okDense);
  const ci = F.MASKS.crescentInterior, page = { artWMM: ci.w * 0.25, artHMM: ci.h * 0.25, frameMM: 0 };
  const Lb = SBMaterial.fromMasks(ci.layers, ci.w, ci.h, page, { smooth: { tolUm: 50, mode: "bonded" } });
  const Lraw = SBMaterial.fromMasks(ci.layers, ci.w, ci.h, page, {});
  check("D1 bonded mode is unsmoothed: material equals the raw lattice contours", JSON.stringify(Lb.map((l) => l.material)) === JSON.stringify(Lraw.map((l) => l.material)));
  check("D1/SUP-02 bonded (unsmoothed) leaves no overhang", G.isEmpty(G.difference(Lb[1].material, Lb[0].material)));
  check("D1 bonded smoothStack reports no SMOOTH_FALLBACK", SBMaterial.smoothStack([[], [stair]], { tolUm: 50, sxUm: 250, syUm: 250, mode: "bonded" }).fallbacks.length === 0);
  const bt = F.MASKS.borderTouch;
  const Lc = SBMaterial.fromMasks(bt.layers, bt.w, bt.h, { artWMM: 8, artHMM: 5, frameMM: 0 }, { smooth: { tolUm: 50, mode: "connected" } });
  check("GEO-02 art-boundary vertices pinned (x=0 edge kept exact)", Lc[1].material[0].outer.some((v, i) => i % 2 === 0 && v === 0));
  check("GEO-04 topology unchanged after smoothing (donut keeps its hole)", (() => { const d = F.MASKS.donutIsland;
    const a = SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, {});
    const b = SBMaterial.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, { smooth: { tolUm: 50, mode: "connected" } });
    return G.ringTopology(a[1].material) === G.ringTopology(b[1].material); })());

  // ---- SBGeom.maxDeviationUm / ringTopology
  const sq = (x0, y0, s) => [x0, y0, x0 + s, y0, x0 + s, y0 + s, x0, y0 + s];
  check("maxDeviationUm(A, A) = 0 and is symmetric", G.maxDeviationUm(sq(0, 0, 1000), sq(0, 0, 1000)) === 0 &&
    G.maxDeviationUm(sq(0, 0, 1000), sq(37, -12, 1000)) === G.maxDeviationUm(sq(37, -12, 1000), sq(0, 0, 1000)));
  check("maxDeviationUm of a square translated by 100 µm = 100", Math.abs(G.maxDeviationUm(sq(0, 0, 1000), sq(100, 0, 1000)) - 100) < 1e-9);
  check("maxDeviationUm is direction-independent of start vertex and winding", G.maxDeviationUm(sq(0, 0, 1000), [1000, 0, 0, 0, 0, 1000, 1000, 1000]) === 0);
  const disk = [{ outer: sq(0, 0, 9000), holes: [] }], donut = [{ outer: sq(0, 0, 9000), holes: [[1000, 1000, 1000, 8000, 8000, 8000, 8000, 1000]] }];
  const isl = (x) => ({ outer: sq(x, 4000, 1000), holes: [] });
  check("ringTopology: disk ≠ donut", G.ringTopology(disk) !== G.ringTopology(donut));
  check("ringTopology: island inside the hole ≠ island outside the donut (same ring counts)",
    G.ringTopology(G.normalize(donut.concat([isl(4000)]))) !== G.ringTopology(G.normalize(donut.concat([isl(10000)]))));
  check("ringTopology is independent of polygon order", G.ringTopology([isl(4000)].concat(donut)) === G.ringTopology(donut.concat([isl(4000)])));
  check("ringTopology: two islands in one hole ≠ one island in each of two parts' holes",
    G.ringTopology(G.normalize([{ outer: sq(0, 0, 9000), holes: [[1000, 1000, 1000, 8000, 8000, 8000, 8000, 1000]] }, isl(2000), isl(5000)])) !==
    G.ringTopology(G.normalize([{ outer: sq(0, 0, 4000), holes: [[1000, 1000, 1000, 3000, 3000, 3000, 3000, 1000]] }, { outer: sq(1500, 1500, 1000), holes: [] },
      { outer: sq(5000, 0, 4000), holes: [[6000, 1000, 6000, 3000, 8000, 3000, 8000, 1000]] }, { outer: sq(6500, 1500, 1000), holes: [] }])));

  // ---- SBTrace.smoothLevel: RDP before Chaikin (S1 amendment), pins
  const never = () => false;
  check("smoothLevel raw is the identity", JSON.stringify(T.smoothLevel(stair, "raw", never, 5)) === JSON.stringify(stair));
  check("smoothLevel rdp(0) is the identity on a lattice loop", JSON.stringify(T.smoothLevel(stair, "rdp", never, 0)) === JSON.stringify(stair));
  const longStair = []; for (let i = 0; i < 20; i++) longStair.push([i, i], [i + 1, i]); longStair.push([20, 20], [0, 20]);
  const rdp1 = T.smoothLevel(longStair, "rdp", never, 1);
  check("smoothLevel rdp(ε = 1 px) collapses a 45° staircase to a few vertices", rdp1.length <= 6 && rdp1.length >= 3);
  check("smoothLevel chaikin = Chaikin(2)∘RDP(ε): 4 × the RDP vertex count (RDP runs first)",
    T.smoothLevel(longStair, "chaikin", never, 1).length === 4 * rdp1.length);
  check("smoothLevel rdp keeps every output vertex a raw vertex", rdp1.every((p) => longStair.some((q) => q[0] === p[0] && q[1] === p[1])));
  const box = [[0, 0], [5, 0], [5, 2], [0, 2]], pinB = (p) => p[0] === 0 || p[1] === 0 || p[0] === 8 || p[1] === 5;
  const sb = T.smoothLevel(box, "chaikin", pinB, 0.5);
  check("smoothLevel keeps pinned vertices exactly and rounds the free corner",
    [[0, 0], [5, 0], [0, 2]].every((v) => sb.some((p) => p[0] === v[0] && p[1] === v[1])) && !sb.some((p) => p[0] === 5 && p[1] === 2));
  check("smoothLevel: points on the art boundary stay on it (no material leaves the x=0 / y=0 edges)",
    sb.filter((p) => p[0] === 0).length >= 2 && sb.filter((p) => p[1] === 0).length >= 2);
  check("smoothLevel rejects an unknown level", (() => { try { T.smoothLevel(box, "bezier", never, 0); return false; } catch (e) { return true; } })());
  check("smoothLevel never uses Math.hypot (NFR-05: engine-independent rounding)", !/Math\.hypot/.test(T.smoothLevel.toString()));

  // ---- smoothStack (D1)
  const small = [[0, 0], [0, 1], [1, 1], [1, 0]], big = [[3, 0], [3, 4], [7, 4], [7, 0]]; // trace winding (outer)
  const ss = M.smoothStack([[], [small, big]], { tolUm: 300, sxUm: 1000, syUm: 1000, mode: "connected" });
  check("D1 connected: tolerance loop runs per loop (unit square kept at chaikin, 4 px square falls back)", ss.levels[1][0] === "chaikin" && ss.levels[1][1] !== "chaikin");
  const fb = ss.fallbacks.find((f) => f.loopIndex === 1);
  check("D1 fallback record {layer, loopIndex, from, to, reason: deviation, devUm > tol}",
    !!fb && fb.layer === 1 && fb.from === "chaikin" && fb.to === ss.levels[1][1] && fb.reason === "deviation" && fb.devUm > 300 && ss.fallbacks.every((f) => f.loopIndex !== 0));
  check("D1 connected: smoothed loop returned for the kept level, raw loop object for raw",
    ss.loopsByLayer[1][0].length === 16 && ss.loopsByLayer[0].length === 0);
  const sbd = M.smoothStack([[], [small, big]], { tolUm: 300, sxUm: 1000, syUm: 1000, mode: "bonded" });
  check("D1 bonded smoothStack is the identity (raw loops, every level raw)",
    JSON.stringify(sbd.loopsByLayer) === JSON.stringify([[], [small, big]]) && sbd.levels[1].every((l) => l === "raw") && sbd.fallbacks.length === 0);
  check("smoothStack refuses an unknown mode or a non-finite tolerance", (() => { let n = 0;
    try { M.smoothStack([[]], { tolUm: 50, sxUm: 1, syUm: 1, mode: "x" }); } catch (e) { n++; }
    try { M.smoothStack([[]], { tolUm: NaN, sxUm: 1, syUm: 1, mode: "connected" }); } catch (e) { n++; } return n === 2; })());

  // ---- fromMasks connected mode: real smoothing, pins, diagnostics
  const Lbig = M.fromMasks(bt.layers, bt.w, bt.h, { artWMM: 8, artHMM: 5, frameMM: 0 }, { smooth: { tolUm: 500, mode: "connected" } });
  const o = Lbig[1].material[0].outer, has = (x, y) => { for (let i = 0; i < o.length; i += 2) if (o[i] === x && o[i + 1] === y) return true; return false; };
  check("GEO-02 connected smoothing at tol 500 µm rounds the free corner and keeps the art-edge corners exact",
    has(0, 0) && has(5000, 0) && has(0, 2000) && !has(5000, 2000) && o.length > 8);
  check("D1 connected: no SMOOTH_FALLBACK when every loop smooths", !Lbig[1].diagnostics.some((x) => x.code === "SMOOTH_FALLBACK"));
  const Lfb = M.fromMasks(bt.layers, bt.w, bt.h, { artWMM: 8, artHMM: 5, frameMM: 0 }, { smooth: { tolUm: 50, mode: "connected" } });
  const sf = Lfb[1].diagnostics.filter((x) => x.code === "SMOOTH_FALLBACK");
  check("D1 connected: SMOOTH_FALLBACK warning per layer with count, measured and limit (mm)",
    sf.length === 1 && sf[0].severity === "warning" && sf[0].layer === 1 && sf[0].count === 1 && sf[0].limit.value === 0.05 && sf[0].limit.unit === "mm" && sf[0].measured.value > 0.05);
  check("D1 the full base layer stays the exact art rectangle under connected smoothing", JSON.stringify(Lbig[0].material) === JSON.stringify([{ outer: [0, 0, 8000, 0, 8000, 5000, 0, 5000], holes: [] }]));
  check("D1 bonded fromMasks never reports SMOOTH_FALLBACK", !M.fromMasks(bt.layers, bt.w, bt.h, { artWMM: 8, artHMM: 5, frameMM: 0 }, { smooth: { tolUm: 50, mode: "bonded" } }).some((l) => l.diagnostics.some((x) => x.code === "SMOOTH_FALLBACK")));
  const d = F.MASKS.donutIsland;
  const Ld = M.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, { smooth: { tolUm: 1000, mode: "connected" } });
  check("GEO-04 donut smoothed at tol 1 mm keeps its hole and island (2 parts, topology unchanged, valid)",
    Ld[1].parts.length === 2 && G.ringTopology(Ld[1].material) === G.ringTopology(M.fromMasks(d.layers, d.w, d.h, { artWMM: 9, artHMM: 9, frameMM: 0 }, {})[1].material) &&
    !Ld[1].diagnostics.some((x) => x.severity === "blocking") && Ld[1].material.some((p) => p.outer.length > 8));
  // property: random masks, every kept smoothing within tolerance, layer topology unchanged, valid, deterministic
  let okDev = true, okTopo = true, okValid = true, okDet = true, smoothed = 0, fell = 0;
  for (let sd = 1; sd <= 25; sd++) {
    const rr = F.lcg(sd * 7 + 1), w = 18, h = 14, mm = new Uint8Array(w * h);
    for (let i = 0; i < mm.length; i++) mm[i] = rr() < 0.5 ? 1 : 0;
    const loops = T.trace(mm, w, h);
    const S = M.smoothStack([[], loops], { tolUm: 120, sxUm: 250, syUm: 250, mode: "connected", w, h });
    S.levels[1].forEach((lv, i) => { if (lv === "raw") return; smoothed++;
      if (G.maxDeviationUm(toUm(loops[i], 250), toUm(S.loopsByLayer[1][i], 250)) > 120) okDev = false; });
    fell += S.fallbacks.length;
    const pgR = { artWMM: w * 0.25, artHMM: h * 0.25, frameMM: 0 }, full = new Uint8Array(w * h).fill(1);
    const A = M.fromMasks([full, mm], w, h, pgR, {}), B = M.fromMasks([full, mm], w, h, pgR, { smooth: { tolUm: 120, mode: "connected" } });
    if (G.ringTopology(A[1].material) !== G.ringTopology(B[1].material)) okTopo = false;
    if (B[1].diagnostics.some((x) => x.severity === "blocking")) okValid = false;
    const B2 = M.fromMasks([full, mm], w, h, pgR, { smooth: { tolUm: 120, mode: "connected" } });
    if (B2[1].canonicalHash !== B[1].canonicalHash) okDet = false;
  }
  check(`GEO-04 25 noise masks @250 µm/px tol 120: every kept smoothing within tolerance (${smoothed} loops smoothed, ${fell} fallbacks)`, okDev && smoothed > 0);
  check("GEO-04 25 noise masks: layer topology unchanged by smoothing", okTopo);
  check("GEO-03 25 noise masks: smoothed layers raise no blocking diagnostics", okValid);
  check("NFR-05 connected smoothing is deterministic (same canonicalHash on repeat)", okDet);
  // topology fallback: a noise layer (seed 10) whose per-loop smoothing at tol 1.5 mm, each within tolerance, re-nests/welds rings
  const tf = F.art(["##.###..", ".##.####", "###.###.", "#..#.##.", "##..##.#", "..#####.", "###.##.."]);
  const TS = M.smoothStack([[], T.trace(tf.m, tf.w, tf.h)], { tolUm: 1500, sxUm: 1000, syUm: 1000, mode: "connected", w: tf.w, h: tf.h });
  const pgT = { artWMM: tf.w, artHMM: tf.h, frameMM: 0 }, fullT = new Uint8Array(tf.w * tf.h).fill(1);
  const TA = M.fromMasks([fullT, tf.m], tf.w, tf.h, pgT, {}), TB = M.fromMasks([fullT, tf.m], tf.w, tf.h, pgT, { smooth: { tolUm: 1500, mode: "connected" } });
  check("GEO-04 layer-topology fallback recorded (reason topology) where per-loop smoothing would change the layer", TS.fallbacks.some((f) => f.reason === "topology" && f.devUm === null));
  check("GEO-04 that layer keeps its part count and topology after the fallback", TB[1].parts.length === TA[1].parts.length && G.ringTopology(TB[1].material) === G.ringTopology(TA[1].material));
  check("GEO-04 the topology fallback is reported as SMOOTH_FALLBACK (topology)", TB[1].diagnostics.some((x) => x.code === "SMOOTH_FALLBACK" && /topology/.test(x.message)));
  // per-loop topology: an RDP chord within tolerance makes a lone ring self-cross (noise seed 15, tol 1 mm)
  const tp = F.art(["#.###..#", "##.####.", "#.....##", "...#.###", ".#.##.#.", "##.####.", "..##.#.."]);
  const TP = M.smoothStack([[], T.trace(tp.m, tp.w, tp.h)], { tolUm: 1000, sxUm: 1000, syUm: 1000, mode: "connected", w: tp.w, h: tp.h });
  check("GEO-04 lone-ring topology fallback recorded (reason topology, deviation within tolerance)", TP.fallbacks.some((f) => f.reason === "topology" && f.devUm !== null && f.devUm <= 1000));
});

suite("material.js — frame and holes as canonical material; the page model (GEO-02, LYR-04, ASM-04, AT-07/12; G1.3)", () => {
  const F = require("./fixtures.js"), G = SBGeom, M = SBMaterial;
  check("G1.3 API present", typeof M.page === "function" && typeof M.applyFrame === "function" && typeof M.subtractHoles === "function");
  if (typeof M.page !== "function" || typeof M.applyFrame !== "function" || typeof M.subtractHoles !== "function") return;
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  const rect = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
  // ---- the page model: finished size = art + 2·frame, shared by every layer and the proof
  const pg = M.page({ artWMM: 80, artHMM: 50, frameMM: 10 });
  check("G1.3 page(): finished size = art + 2·frame", pg.wMM === 100 && pg.hMM === 70 && pg.artWMM === 80 && pg.artHMM === 50 && pg.frameMM === 10);
  check("G1.3 page() accepts the construction.frame shape {enabled, widthMM}",
    JSON.stringify(M.page({ artWMM: 80, artHMM: 50, frame: { enabled: true, widthMM: 10 } })) === JSON.stringify(pg));
  check("G1.3 page() quantizes every dimension to the 1 µm grid", (() => { const q = M.page({ artWMM: 304.80004, artHMM: 200.0004, frameMM: 12.7000004 });
    return q.artWMM === 304.8 && q.artHMM === 200 && q.frameMM === 12.7 && q.wMM === 330.2 && q.hMM === 225.4; })());
  check("NONFINITE page() refuses non-finite/non-positive art and a negative frame",
    throws(() => M.page({ artWMM: NaN, artHMM: 5, frameMM: 0 }), /NONFINITE/) && throws(() => M.page({ artWMM: 5, artHMM: 0, frameMM: 0 }), /NONFINITE/) &&
    throws(() => M.page({ artWMM: 5, artHMM: 5, frameMM: -1 }), /NONFINITE/));
  check("D4/amendment C page() beyond COORD_LIMIT throws a coded error", throws(() => M.page({ artWMM: 30000, artHMM: 5, frameMM: 2000 }), /COORD_LIMIT/));
  // ---- LYR-04 bonded default: no frame
  const nf = M.page({ artWMM: 80, artHMM: 50, frame: { enabled: false, widthMM: 10 } });
  check("LYR-04 bonded default has no frame (frame disabled → frameMM 0, page = art)", nf.frameMM === 0 && nf.wMM === 80 && nf.hMM === 50);
  const bt = F.MASKS.borderTouch, raw0 = M.fromMasks(bt.layers, 8, 5, nf, {});
  check("LYR-04 applyFrame at frameMM 0 leaves material and canonicalHash unchanged",
    raw0.every((l) => { const a = M.applyFrame(l, nf); return JSON.stringify(a.material) === JSON.stringify(l.material) && a.canonicalHash === l.canonicalHash; }));
  check("LYR-04 fromMasks without opts.frame adds no frame material (art only)", G.bbox(M.fromMasks(bt.layers, 8, 5, pg, {})[1].material[0]).join() === "10000,10000,60000,30000");
  // ---- GEO-02 / LYR-04 / AT-12: the frame is unioned material
  const raw = M.fromMasks(bt.layers, 8, 5, pg, {}), Lf = raw.map((l) => M.applyFrame(l, pg));
  check("LYR-04 frame ring ∪ edge-touching art is one material polygon", Lf[1].material.length === 1 && Lf[1].parts.length === 1 && Lf[1].parts[0].id === "L01-P001");
  let seg = false;
  for (const l of Lf) for (const p of l.material) for (const r of [p.outer, ...p.holes]) for (let i = 0, n = r.length / 2; i < n; i++) { const j = (i + 1) % n;
    if (r[2 * i] === 10000 && r[2 * j] === 10000 && Math.min(r[2 * i + 1], r[2 * j + 1]) < 30000 && Math.max(r[2 * i + 1], r[2 * j + 1]) > 10000) seg = true; }
  // Replaces KNOWN-DEFECT GEO-02 (the legacy sheetSVG shim is frozen by T0.7; its check was deleted, not edited).
  check("GEO-02 FIXED: no material ring has consecutive vertices with x = frame edge (10000 µm) and y within art rows 0..1 (10000..30000 µm)", !seg);
  check("AT-12 frame outer ring is an exact rectangle with page dimensions", Lf.every((l) => JSON.stringify(l.material[0].outer) === "[0,0,100000,0,100000,70000,0,70000]"));
  // page 100×70 minus (art 80×50 minus the 50×20 block) = 7000 − 3000 mm²
  check("GEO-02 framed layer: one hole (art window minus the attached block), area 4000 mm², stats recomputed",
    Lf[1].material[0].holes.length === 1 && Lf[1].stats.areaMM2 === 4000 && Lf[1].stats.vertices === 4 + 6 && Lf[1].cutPaths.length === 2 &&
    Lf[1].stats.cutMM === 340 + (2 * 80 + 2 * 50));
  check("D4 framed canonicalHash = SBGeom.materialHash and differs from the unframed layer", Lf.every((l, k) => l.canonicalHash === G.materialHash(l) && l.canonicalHash !== raw[k].canonicalHash));
  check("GEO-03 framed layers raise no validation diagnostics, material normalized", Lf.every((l) => l.diagnostics.length === 0 && JSON.stringify(G.normalize(l.material)) === JSON.stringify(l.material)));
  check("G1.3 applyFrame is idempotent and does not mutate its input",
    JSON.stringify(M.applyFrame(Lf[1], pg).material) === JSON.stringify(Lf[1].material) && JSON.stringify(raw[1].material) === JSON.stringify(M.fromMasks(bt.layers, 8, 5, pg, {})[1].material));
  const e = F.MASKS.emptyIntermediate, pe = M.page({ artWMM: 5, artHMM: 5, frameMM: 1 }), Le = M.fromMasks(e.layers, 5, 5, pe, { frame: true });
  check("LYR-04 frame applies to every layer: an empty art layer becomes the frame ring alone",
    JSON.stringify(Le[1].material) === JSON.stringify(G.normalize([{ outer: rect(0, 0, 7000, 7000), holes: [rect(1000, 1000, 6000, 6000)] }])) && Le[1].status === "ok");
  check("G1.3 applyFrame keeps non-geometry diagnostics (SMOOTH_FALLBACK) and recomputes the geometry ones", (() => {
    const s = M.fromMasks(bt.layers, 8, 5, pg, { smooth: { tolUm: 50, mode: "connected" } })[1];
    const a = M.applyFrame(s, pg); return s.diagnostics.some((x) => x.code === "SMOOTH_FALLBACK") && a.diagnostics.map((x) => x.code).join() === "SMOOTH_FALLBACK"; })());
  check("NONFINITE applyFrame refuses an invalid page", throws(() => M.applyFrame({ ...raw[1], material: [] }, { artWMM: 0, artHMM: 5, frameMM: 1 }), /NONFINITE/));
  // ---- AT-07 / ASM-04: holes are subtracted after the frame union, before validation (GEO-02 order)
  const holes = [{ cxUm: 95000, cyUm: 65000, rUm: 1500 }, { cxUm: 5000, cyUm: 5000, rUm: 1500 }];
  const Lb = M.subtractHoles(Lf[0], holes);
  check("AT-07 base = exactly outer rect (4 vertices, page corners) + explicit holes",
    Lb.material.length === 1 && JSON.stringify(Lb.material[0].outer) === "[0,0,100000,0,100000,70000,0,70000]" && Lb.material[0].holes.length === 2);
  check("ASM-04 subtractHoles leaves hole rings equal to SBGeom.circle",
    JSON.stringify(Lb.material) === JSON.stringify(G.normalize([{ outer: rect(0, 0, 100000, 70000), holes: holes.map((h) => G.circle(h.cxUm, h.cyUm, h.rUm).outer) }])) &&
    Lb.material[0].holes.every((r) => holes.some((h) => { const c = G.circle(h.cxUm, h.cyUm, h.rUm).outer; const pts = (q) => { const o = []; for (let i = 0; i < q.length; i += 2) o.push(q[i] + "," + q[i + 1]); return o.sort().join(" "); };
      return r.length === c.length && pts(r) === pts(c); })));
  check("D4-A subtractHoles records the holes in layer.holes (sorted by cy, cx, r) and they enter canonicalHash",
    JSON.stringify(Lb.holes) === JSON.stringify([holes[1], holes[0]]) && Lb.canonicalHash === G.materialHash(Lb) && Lb.canonicalHash !== Lf[0].canonicalHash);
  check("D4-A a hole that misses material is still recorded and still changes the hash", (() => {
    const off = M.subtractHoles(Lf[1], [{ cxUm: 30000, cyUm: 40000, rUm: 1000 }]);
    return off.holes.length === 1 && JSON.stringify(off.material) === JSON.stringify(Lf[1].material) && off.canonicalHash !== Lf[1].canonicalHash; })());
  check("GEO-03 holes through the frame/art seam stay valid (no diagnostics)", M.subtractHoles(Lf[1], [{ cxUm: 10000, cyUm: 20000, rUm: 1500 }]).diagnostics.length === 0);
  check("ASM-04 subtractHoles with no holes is the identity", (() => { const z = M.subtractHoles(Lf[1], []); return JSON.stringify(z.material) === JSON.stringify(Lf[1].material) && z.canonicalHash === Lf[1].canonicalHash; })());
  check("ASM-04 subtractHoles refuses non-integer or non-positive circles",
    throws(() => M.subtractHoles(Lf[0], [{ cxUm: 0.5, cyUm: 0, rUm: 10 }])) && throws(() => M.subtractHoles(Lf[0], [{ cxUm: 0, cyUm: 0, rUm: 0 }])));
  const viaOpts = M.fromMasks(bt.layers, 8, 5, pg, { frame: true, holes });
  check("GEO-02 order: fromMasks({frame, holes}) = smoothing → frame union → hole subtraction → validation (equals the manual chain)",
    viaOpts.every((l, k) => { const m = M.subtractHoles(M.applyFrame(raw[k], pg), holes); return JSON.stringify(l.material) === JSON.stringify(m.material) && l.canonicalHash === m.canonicalHash; }));
  check("ASM-04 fromMasks holeLayers selects the layers that get the holes", (() => {
    const s = M.fromMasks(bt.layers, 8, 5, pg, { frame: true, holes, holeLayers: [0] });
    return s[0].holes.length === 2 && s[1].holes.length === 0 && JSON.stringify(s[1].material) === JSON.stringify(Lf[1].material); })());
  // ---- S5 F3: connected smoothing pins the art rectangle, so the frame union leaves no sliver holes at the frame edge
  const onArt = (x, y, f, aw, ah) => ((x === f || x === f + aw) && y >= f && y <= f + ah) || ((y === f || y === f + ah) && x >= f && x <= f + aw);
  // S5 F3 (frame-edge micro-holes): a frame-edge hole is a hole ring with a vertex on the art rectangle. Raw (lattice) frame-edge
  // holes are ≥ 1 px². Pinned connected smoothing may round the free corners of a raw 1-px notch (S5 measured ≥ 57,299 µm² at
  // 62,500 µm²/px), but GEO-04 bounds that loss by perimeter × tol; an unpinned sliver (S5: down to 2,480 µm²) is far below it.
  const frameEdgeHoles = (layer, f, aw, ah) => { const o = []; for (const p of layer.material) for (const hr of p.holes) {
    let touches = false; for (let i = 0; i < hr.length; i += 2) if (onArt(hr[i], hr[i + 1], f, aw, ah)) { touches = true; break; }
    if (!touches) continue;
    let a2 = 0, per = 0; for (let i = 0; i < hr.length; i += 2) { const j = (i + 2) % hr.length, dx = hr[j] - hr[i], dy = hr[j + 1] - hr[i + 1];
      a2 += hr[i] * hr[j + 1] - hr[j] * hr[i + 1]; per += Math.sqrt(dx * dx + dy * dy); }
    o.push({ area: Math.abs(a2) / 2, per }); } return o; };
  const btS = M.fromMasks(bt.layers, 8, 5, M.page({ artWMM: 2, artHMM: 1.25, frameMM: 10 }), { frame: true, smooth: { tolUm: 50, mode: "connected" } });
  check("GEO-02 connected smoothing + frame on borderTouch (0.25 mm/px): one hole, as raw", btS[1].material.length === 1 && btS[1].material[0].holes.length === 1);
  let sliver = 0, countMismatch = 0, frameHoles = 0, minArea = Infinity, smoothedAny = false, okV = true, topoDiff = 0, frameFb = 0;
  for (let sd = 1; sd <= 24; sd++) {
    const rr = F.lcg(sd * 11 + 3), w = 32, h = 24, mm = new Uint8Array(w * h); for (let i = 0; i < mm.length; i++) mm[i] = rr() < 0.55 ? 1 : 0;
    const P = M.page({ artWMM: w * 0.25, artHMM: h * 0.25, frameMM: 10 }), full = new Uint8Array(w * h).fill(1);
    const Ls = M.fromMasks([full, mm], w, h, P, { frame: true, smooth: { tolUm: 50, mode: "connected" } });
    const Lr = M.fromMasks([full, mm], w, h, P, { frame: true });
    const hs = frameEdgeHoles(Ls[1], 10000, w * 250, h * 250), hr = frameEdgeHoles(Lr[1], 10000, w * 250, h * 250);
    if (hs.length !== hr.length || hr.some((x) => x.area < 62500)) countMismatch++;
    if (G.ringTopology(Ls[1].material) !== G.ringTopology(Lr[1].material) || Ls[1].parts.length !== Lr[1].parts.length) topoDiff++;
    const S0 = M.smoothStack([[], SBTrace.trace(mm, w, h)], { tolUm: 50, sxUm: 250, syUm: 250, mode: "connected", w, h });
    const S1 = M.smoothStack([[], SBTrace.trace(mm, w, h)], { tolUm: 50, sxUm: 250, syUm: 250, mode: "connected", w, h, frameUm: 10000 });
    if (S1.fallbacks.filter((f) => f.reason === "topology").length > S0.fallbacks.filter((f) => f.reason === "topology").length) frameFb++;
    for (const x of hs) { frameHoles++; if (x.area < minArea) minArea = x.area; if (x.area < 62500 - x.per * 50) sliver++; }
    if (Ls[1].material.some((p) => [p.outer, ...p.holes].some((r) => { for (let i = 0; i < r.length; i += 2) if (r[i] % 250 || r[i + 1] % 250) return true; return false; }))) smoothedAny = true;
    if (Ls.some((l) => l.diagnostics.some((x) => x.severity === "blocking"))) okV = false;
  }
  check(`GEO-02 connected smoothing leaves no frame-edge hole below 1 px² beyond the GEO-04 bound (24 framed noise masks @250 µm/px, tol 50: ${frameHoles} frame-edge holes, min ${Math.round(minArea)} µm²)`,
    sliver === 0 && smoothedAny && frameHoles > 0);
  check("GEO-02 every smoothed frame-edge hole is a smoothed raw notch (same count as the raw framed layer, raw ones ≥ 1 px²)", countMismatch === 0);
  check("GEO-04 framed layer topology and part count unchanged by connected smoothing (topology checked with the frame ring unioned)", topoDiff === 0);
  check(`GEO-04 smoothStack {frameUm}: the frame-aware layer check adds topology fallbacks where art-only smoothing would merge frame-edge holes (${frameFb}/24 masks)`, frameFb > 0);
  check("smoothStack refuses a non-integer or negative frameUm", throws(() => M.smoothStack([[]], { tolUm: 50, sxUm: 1, syUm: 1, mode: "connected", w: 1, h: 1, frameUm: 0.5 })) &&
    throws(() => M.smoothStack([[]], { tolUm: 50, sxUm: 1, syUm: 1, mode: "connected", w: 1, h: 1, frameUm: -1 })));
  check("GEO-03 framed + smoothed noise layers raise no blocking diagnostics", okV);
});

// ------------------------------------------------------------------ report
(async () => {
  for (const [name, fn] of queue) {
    if (ONLY && !name.includes(ONLY)) continue;
    skipping = false; console.log("\n" + name); pending = [];
    try { await fn(); await Promise.all(pending); } catch (e) { check(name + " (suite threw: " + e.message + ")", false); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
