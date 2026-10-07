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
  // 10 mm/px, margin 10: art rows 0..1 are y 10..30; the left art edge x=10 is cut although it touches the frame.
  check("KNOWN-DEFECT GEO-02: edge art cut separately from frame (segment x=10, y 10→30)", svgUp.includes("M 10 10 L 10 30"));
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
