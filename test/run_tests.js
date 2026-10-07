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
  check("bench geom: support pass finds pairs and containment on the dense stack", !!r && r.B3b_supportPairs_dense.pairs > 0 && r.B3b_supportPairs_dense.contained &&
    r.B3b_supportPairs_dense_partsGiven.pairs === r.B3b_supportPairs_dense.pairs);
});

// ------------------------------------------------------------- png.js (S4)
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
