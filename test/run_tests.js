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
  const domOnly = new Set(["pool.js", "preview.js", "app.js"]);
  // F10 (S1, R7): the coordinator worker (js/worker.js) is not a page script, but it is precached with the shell so
  // page and worker always come from the same cache version.
  check("build: SHELL == index.html scripts + js/worker.js", JSON.stringify(tags.concat(["worker.js"])) === JSON.stringify(shell));
  check("build: pool.js is a DOM module (not in the Node list)",
    tags.includes("pool.js") && tags.indexOf("pool.js") < tags.indexOf("app.js") && !NODE_MODULES.includes("pool.js"));
  {
    const wsrc = fs.readFileSync(path.join(root, "js/worker.js"), "utf8");
    const m = wsrc.match(/WORKER_MODULES\s*=\s*(\[[\s\S]*?\])/);
    let list = null;
    try { list = m && JSON.parse(m[1]); } catch (_) { list = null; }
    check("build: worker WORKER_MODULES == test/modules.js", Array.isArray(list) && JSON.stringify(list) === JSON.stringify(NODE_MODULES));
  }
  {
    // DEP-02 (G4.0 minimal, F-D3): a new worker waits; it activates only on the page's explicit skipWaiting message.
    const install = (sw.match(/addEventListener\("install"[\s\S]*?\n\}\);/) || [""])[0];
    check("DEP-02 sw.js has no unconditional skipWaiting in install", install !== "" && !/skipWaiting\s*\(/.test(install));
    const msg = (sw.match(/addEventListener\("message"[\s\S]*?\n\}\);/) || [""])[0];
    check("DEP-02 sw.js skipWaiting only from a {type: \"skipWaiting\"} message",
      /skipWaiting\s*\(/.test(msg) && /type\s*===\s*"skipWaiting"/.test(msg) && (sw.match(/skipWaiting\s*\(/g) || []).length === 1);
    const upd = app.slice(app.indexOf("function updateReady"), app.indexOf("function registerServiceWorker"));
    check("DEP-02 update prompt is gated on unsaved work, export and fabrication in flight",
      app.includes("function updateReady") && /hasUnsavedWork\(\)/.test(upd) && /btn-export/.test(upd) && /fabInFlight/.test(upd) &&
      /postMessage\(\{\s*type:\s*"skipWaiting"\s*\}\)/.test(app) && /controllerchange/.test(app));
  }
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
  // KNOWN-DEFECT EXP-01 and EXP-02 were fixed in G1.4: the checks now live on SBSvg.layerSVG (suite "svgout.js — layerSVG …");
  // the shim versions were deleted, not edited, because T0.7 freezes sheetSVG.
  // KNOWN-DEFECT GEO-02 was fixed in G1.3: the check now lives on SBMaterial.applyFrame (suite "material.js — frame and holes …");
  // the shim version was deleted, not edited, because T0.7 freezes sheetSVG.
  check("KNOWN-DEFECT EXP-03: label is live <text>", /<text /.test(svgUp));
  check("G0 backing sheet emits only rect (+label), no paths", !/<path /.test(svgBack) && /<rect /.test(svgBack));
  // KNOWN-DEFECT GEO-01 proof extent was fixed in G1.6: the check now lives on SBSvg.assemblySVG (suite "svgout.js — assemblySVG …");
  // the shim version was deleted, not edited, because T0.7 freezes proofSVG.
  // KNOWN-DEFECT GEO-07 (bridge) and KNOWN-DEFECT SUP-01 were fixed in G2.6: the checks now live on SBConstruct.bonded /
  // connected (suite "construct.js — strategies …"); the islands.resolve versions were deleted.
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

// ------------------------------------------------ construction strategies (G2.6)
suite("construct.js — strategies (SUP-01/06, GEO-07, GEO-08)", () => {
  const F = require("./fixtures.js"), lb = F.MASKS.looseBridge;
  const px = { featR: 0, bridgeR: 0.6, cullPx: 0, maxBridgePx: 10, speckPx: 0, holePx: 0, frameAnchored: true, cullEnabled: false };
  const orig = SBIslands.resolve; let called = 0; SBIslands.resolve = (...a) => (called++, orig(...a));
  const b = SBConstruct.bonded(lb.layers, lb.w, lb.h, px);
  check("SUP-01 islands.resolve not called in bonded", called === 0);
  check("SUP-01 bonded keeps disconnected loose part", SBMorph.components(b.final[2], lb.w, lb.h).count === 2);
  check("GEO-07 (bridge) FIXED: bonded adds no material outside layer k-1", b.final[2].every((v, i) => !v || b.final[1][i]));
  const c = SBConstruct.connected(lb.layers, lb.w, lb.h, px);
  SBIslands.resolve = orig;
  check("SUP-01 FIXED: only connected mode bridges", called > 0 && c.report[2].addedPx > 0);
  check("GEO-08 cleanup report sums match mask diff", b.report.every((r, k) => k === 0 ||
    r.addedPx - r.removedPx === b.final[k].reduce((a, v) => a + v, 0) - lb.layers[k].reduce((a, v) => a + v, 0)));
  let nested = true;
  for (let s = 1; s <= 200; s++) { const st = F.randomNestedStack(F.lcg(s), 40, 30, 5);
    for (const featR of [1, 3]) { const r = SBConstruct.bonded(st, 40, 30, { ...px, featR, holePx: 8 * featR * featR });
      for (let k = 2; k < r.final.length; k++) if (r.final[k].some((v, i) => v && !r.final[k - 1][i])) nested = false; } }
  check("D-4.5 property: bonded morphology keeps nesting (200 seeds, featR 1 and 3)", nested);
});

suite("construct.js — G2.6 extended (shape, purity, culling, legacy identity)", () => {
  const F = require("./fixtures.js"), lb = F.MASKS.looseBridge, w = lb.w, h = lb.h;
  const px = { featR: 0, bridgeR: 0.6, cullPx: 0, maxBridgePx: 10, speckPx: 0, holePx: 0, frameAnchored: true, cullEnabled: false };
  const before = lb.layers.map((m) => m.join());
  const b = SBConstruct.bonded(lb.layers, w, h, px), c = SBConstruct.connected(lb.layers, w, h, px);
  check("G2.6 inputs are not mutated", lb.layers.every((m, k) => m.join() === before[k]));
  check("G2.6 one final, bridge slot and report entry per layer", [b, c].every((r) => r.final.length === 3 && r.bridges.length === 3 && r.report.length === 3 &&
    r.final.every((m) => m instanceof Uint8Array && m.length === w * h) && r.report.every((e, k) => e.layer === k)));
  check("GEO-08 report entries carry addedPx, removedPx, filledHoles, removedParts (non-negative integers)", [b, c].every((r) => r.report.every((e) =>
    ["addedPx", "removedPx", "filledHoles", "removedParts"].every((f) => Number.isInteger(e[f]) && e[f] >= 0))));
  check("SUP-01 bonded has no bridge masks", b.bridges.every((x) => x === null));
  check("SUP-06 connected: base has no bridge mask, layers 1.. have one; bridged pixels are reported as added", c.bridges[0] === null &&
    c.bridges.slice(1).every((x) => x instanceof Uint8Array) && c.report.slice(1).every((e, k) => e.addedPx >= c.bridges[k + 1].reduce((a, v) => a + v, 0)));
  check("SUP-06 connected verifies one part per layer (looseBridge, frame anchored)", c.final.slice(1).every((m) => SBMorph.components(m, w, h).count === 1));
  check("GEO-08 connected report sums match mask diff", c.report.every((r, k) =>
    r.addedPx - r.removedPx === c.final[k].reduce((a, v) => a + v, 0) - lb.layers[k].reduce((a, v) => a + v, 0)));
  check("G2.6 base layer passes through unchanged (copy)", [b, c].every((r) => r.final[0] !== lb.layers[0] && r.final[0].join() === before[0] &&
    r.report[0].addedPx === 0 && r.report[0].removedPx === 0));
  check("SUP-01 bonded with featR 0 and no culling is the identity", b.final.every((m, k) => m.join() === before[k]));
  // culling is explicit in bonded: the 2-px loose part survives a 4-px speck limit unless cullEnabled is set
  const bc = SBConstruct.bonded(lb.layers, w, h, { ...px, speckPx: 4 }), be = SBConstruct.bonded(lb.layers, w, h, { ...px, speckPx: 4, cullEnabled: true });
  check("SUP-01 bonded removeSpecks only with cullEnabled", SBMorph.components(bc.final[2], w, h).count === 2 && bc.report[2].removedParts === 0 &&
    SBMorph.components(be.final[2], w, h).count === 1 && be.report[2].removedParts === 1 && be.report[2].removedPx === 2);
  const dn = F.MASKS.donutIsland, bh = SBConstruct.bonded(dn.layers, dn.w, dn.h, { ...px, holePx: 100 });
  check("GEO-08 bonded fillHoles counts filled holes", bh.report[1].filledHoles >= 1 && bh.report[1].addedPx > 0);
  check("D-4.5 bonded hole fill stays inside the lower layer", bh.final[1].every((v, i) => !v || bh.final[0][i]));
  // connected = the v1.1.0 per-sheet chain (open → close → removeSpecks → fillHoles → islands.resolve), byte for byte
  let same = true;
  for (let s = 1; s <= 40 && same; s++) { const st = F.randomNestedStack(F.lcg(s), 40, 30, 5);
    for (const featR of [1, 3]) { const q = { featR, bridgeR: featR + 0.5, cullPx: 6, maxBridgePx: 20, speckPx: 4, holePx: 2 * featR * featR * 4, frameAnchored: s % 2 === 0, cullEnabled: false };
      const r = SBConstruct.connected(st, 40, 30, q);
      st.forEach((mask, k) => { if (!k) return; let m = SBMorph.open(mask, 40, 30, featR); m = SBMorph.close(m, 40, 30, Math.max(1, featR - 1));
        SBMorph.removeSpecks(m, 40, 30, q.speckPx); SBMorph.fillHoles(m, 40, 30, q.holePx);
        const isl = SBIslands.resolve(m, 40, 30, { frameAnchored: q.frameAnchored, bridgeRadius: q.bridgeR, cullBelowPx: q.cullPx, maxBridgePx: q.maxBridgePx });
        if (m.join() !== r.final[k].join() || isl.bridges.join() !== r.bridges[k].join() || r.report[k].bridged !== isl.bridged || r.report[k].culled !== isl.culled) same = false; }); } }
  check("SUP-06/DEP-04 connected == the v1.1.0 chain incl. islands.resolve (40 seeds, featR 1 and 3)", same);
  const bad = (f) => { try { f(); return false; } catch (e) { return e.code === "CONSTRUCT_ARG"; } };
  check("G2.6 bad arguments are CONSTRUCT_ARG", bad(() => SBConstruct.bonded([], w, h, px)) && bad(() => SBConstruct.bonded(lb.layers, w, h, { ...px, featR: -1 })) &&
    bad(() => SBConstruct.connected([new Uint8Array(3)], w, h, px)) && bad(() => SBConstruct.bonded(lb.layers, w, h, null)));
});

// ------------------------------------------------ final validation (G2.7)
suite("support.js — final validation (D-4.5, SUP-02/03, GEO-07, AT-08/09)", () => {
  const F = require("./fixtures.js");
  // st.mmPerPx (default 1) sets the pitch: stripOnBase is drawn at 0.1 mm/px (G2.7 deviation from the plan's mk, which fixed 1 mm/px)
  const mk = (st) => SBMaterial.assignParts(SBMaterial.fromMasks(st.layers, st.w, st.h, { artWMM: st.w * (st.mmPerPx || 1), artHMM: st.h * (st.mmPerPx || 1), frameMM: 0 }, {}));
  const codes = (r) => r.diagnostics.map((d) => d.code);
  const hole = SBSupport.validate(mk(F.MASKS.lowerHoleUnderPart), "bonded-relief", { minFeatureMM: 3 });
  check("AT-08 part over lower hole → BOND_UNSUPPORTED blocking", codes(hole).includes("BOND_UNSUPPORTED"));
  const d0 = hole.diagnostics.find((d) => d.code === "BOND_UNSUPPORTED");
  check("AT-08 measured unsupported area (1 mm² ±1%) with measured/limit fields", Math.abs(d0.areaMM2 - 1) <= 0.01 && d0.measured && d0.limit);
  const empty = SBSupport.validate(mk(F.MASKS.emptyIntermediate), "bonded-relief", { minFeatureMM: 3 });
  check("D-4.7 empty under non-empty blocks", codes(empty).includes("BOND_EMPTY_UNDER"));
  const donut = SBSupport.validate(mk(F.MASKS.donutIsland), "bonded-relief", { minFeatureMM: 0.5 });
  check("AT-08 fully supported loose island accepted without bridge", !codes(donut).includes("BOND_UNSUPPORTED") && donut.supportGraph.reachesBase);
  // GEO-07: masks nested but polygons are not (interior fixture; miter offset is deterministic). G2.7 deviation: the plan grew
  // layer 1 of the 2-layer crescentInterior, which stays inside the full base; the crescent is repeated as layer 2 and layer 2
  // is grown, so it overhangs layer 1 on polygons while the masks stay nested.
  const ci = F.MASKS.crescentInterior;
  const nested = mk({ ...ci, layers: [ci.layers[0], ci.layers[1], ci.layers[1]] }); const grown = JSON.parse(JSON.stringify(nested));
  grown[2].material = SBGeom.offset(grown[2].material, 300, "miter");
  check("GEO-07 interior overhang caught on polygons although masks nested", SBSupport.validate(grown, "bonded-relief", { minFeatureMM: 0.5 }).diagnostics
    .some((d) => d.code === "BOND_UNSUPPORTED" && d.layer === 2 && d.part === null && d.areaMM2 > 0));
  const diag = SBSupport.validate(mk({ ...F.MASKS.diagonalTouch, layers: [F.MASKS.diagonalTouch.layers[0], F.MASKS.diagonalTouch.layers[1]] }), "connected-sheet", {});
  check("GEO-02 diagonal-only contact → CONNECTED_SPLIT in connected mode", codes(diag).includes("CONNECTED_SPLIT"));
  // D3 width thresholds on the contact itself (exactly as pinned in suite "spike S5 — finite-width contact")
  const sq = (x0, y0, x1, y1) => ({ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] }), lo = [sq(0, 0, 10000, 10000)];
  check("D3 1 µm axis overlap is support (w ≥ 0.5 µm) but SUPPORT_NARROW for minFeature 3 mm", SBGeom.classifyContact(SBGeom.intersection([sq(9999, 0, 20000, 10000)], lo), 3000).level === "warn");
  check("D3 3000 µm overlap with minFeature 3 mm → no SUPPORT_NARROW (tie passes)", SBGeom.classifyContact(SBGeom.intersection([sq(7000, 0, 20000, 10000)], lo), 3000).level === "ok");
  // PO-LASER-6 plywood defaults: 1.5 mm minimum, 2.0 mm advisory. F.MASKS.stripOnBase(widthMM): a 2-layer stack at 0.1 mm/px
  // whose upper part rests on the full base along a strip of the given width.
  const strip = (w) => SBSupport.validate(mk(F.MASKS.stripOnBase(w)), "bonded-relief", { minFeatureMM: 1.5, advisoryFeatureMM: 2 });
  check("PO-LASER-6 1.4 mm contact → SUPPORT_NARROW", codes(strip(1.4)).includes("SUPPORT_NARROW"));
  check("PO-LASER-6 1.8 mm contact → FEATURE_MARGINAL, no SUPPORT_NARROW", codes(strip(1.8)).includes("FEATURE_MARGINAL") && !codes(strip(1.8)).includes("SUPPORT_NARROW"));
  check("PO-LASER-6 2.0 mm contact → neither (tie passes)", !codes(strip(2.0)).some((c) => c === "SUPPORT_NARROW" || c === "FEATURE_MARGINAL"));

  const rng = F.lcg(7); let allClean = true;
  for (let t = 0; t < 50; t++) { const st = F.randomNestedStack(rng, 24, 18, 5);
    const fin = SBConstruct.bonded(st, 24, 18, { featR: 1, bridgeR: 0, cullPx: 0, maxBridgePx: 0, speckPx: 0, holePx: 8, frameAnchored: false, cullEnabled: false }).final;
    if (SBSupport.validate(SBMaterial.fromMasks(fin, 24, 18, { artWMM: 24, artHMM: 18, frameMM: 0 }, {}), "bonded-relief", { minFeatureMM: 0.01 })
      .diagnostics.some((d) => d.code === "BOND_UNSUPPORTED")) allClean = false; }
  check("D-4.5 property: bonded(nested stack, featR 1) never reports unsupported (50 seeds)", allClean);
});

suite("support.js — G2.7 extended (graph, advisory tier, reuse, determinism)", () => {
  const F = require("./fixtures.js"), D = SBDiag;
  const mk = (st) => SBMaterial.fromMasks(st.layers, st.w, st.h, { artWMM: st.w * (st.mmPerPx || 1), artHMM: st.h * (st.mmPerPx || 1), frameMM: 0 }, {});
  const codes = (r) => r.diagnostics.map((d) => d.code);
  check("§4 module order: support.js directly after material.js", (() => { const L = require("./modules.js").NODE_MODULES; return L.indexOf("support.js") === L.indexOf("material.js") + 1; })());
  check("PO-LASER-6 FEATURE_MARGINAL registered (warning, fabrication)", D.CODES.FEATURE_MARGINAL && D.CODES.FEATURE_MARGINAL.severity === "warning" && D.CODES.FEATURE_MARGINAL.kind === "fabrication");
  const s18 = SBSupport.validate(mk(F.MASKS.stripOnBase(1.8)), "bonded-relief", { minFeatureMM: 1.5, advisoryFeatureMM: 2 });
  const fm = s18.diagnostics.find((d) => d.code === "FEATURE_MARGINAL");
  check("PO-LASER-6 contact FEATURE_MARGINAL (aggregated per layer and kind) carries detail.kind \"contact\", the upper part, region and the advisory limit",
    !!fm && fm.detail && fm.detail.kind === "contact" && fm.layer === 1 && fm.parts.join() === "L01-P001" && fm.count === 1 && Array.isArray(fm.region) && fm.limit.value === 2 && fm.limit.unit === "mm");
  const s14 = SBSupport.validate(mk(F.MASKS.stripOnBase(1.4)), "bonded-relief", { minFeatureMM: 1.5, advisoryFeatureMM: 2 });
  const sn = s14.diagnostics.find((d) => d.code === "SUPPORT_NARROW");
  check("D3 SUPPORT_NARROW names the part and the lower part, limit = minFeature; no FEATURE_MARGINAL as well",
    sn.part === "L01-P001" && /L00-P001/.test(sn.message) && sn.limit.value === 1.5 && !codes(s14).includes("FEATURE_MARGINAL"));
  check("PO-LASER-6 advisory defaults to minFeature when absent (no advisory tier)",
    !codes(SBSupport.validate(mk(F.MASKS.stripOnBase(1.8)), "bonded-relief", { minFeatureMM: 1.5 })).includes("FEATURE_MARGINAL"));
  check("D3 minFeature rounded to integer µm before halving (1.4996 mm → 1500 µm: 1.5 mm strip passes)",
    !codes(SBSupport.validate(mk(F.MASKS.stripOnBase(1.5)), "bonded-relief", { minFeatureMM: 1.4996 })).includes("SUPPORT_NARROW"));
  check("D-4.5 FEATURE_MARGINAL aggregates per (code, layer, kind)", (() => {
    const mkd = (p, kind) => D.make("FEATURE_MARGINAL", { layer: 1, part: p, detail: { kind } });
    const a = D.aggregate([mkd("L01-P001", "contact"), mkd("L01-P002", "contact"), mkd("L01-P003", "part")]);
    return a.length === 2 && a[0].count === 2 && a[0].detail.kind === "contact" && a[1].detail.kind === "part"; })());
  // support graph (SUP-03)
  const dn = SBSupport.validate(mk(F.MASKS.donutIsland), "bonded-relief", { minFeatureMM: 0.5 });
  const e = dn.supportGraph.edges;
  check("SUP-03 one edge per part above the base; each loose part rests on the base part with its own area",
    e.length === 2 && e.every((x) => x.layer === 1 && x.supports.length === 1 && x.supports[0].layer === 0 && x.supports[0].part === "L00-P001") &&
    e.map((x) => x.supports[0].areaUm2).sort((a, b) => a - b).join() === [1e6, 24e6].join());
  const hole = SBSupport.validate(mk(F.MASKS.lowerHoleUnderPart), "bonded-relief", { minFeatureMM: 0.5 });
  check("SUP-03 a part over a lower hole has no support and the graph does not reach the base",
    !hole.supportGraph.reachesBase && hole.supportGraph.edges.find((x) => x.layer === 2).supports.length === 0);
  const lbv = SBSupport.validate(mk(F.MASKS.looseBridge), "bonded-relief", { minFeatureMM: 0.5 });
  check("LYR-05 identical consecutive layers → IDENTICAL_LAYERS info (layer 2), no other code", codes(lbv).join() === "IDENTICAL_LAYERS" &&
    lbv.diagnostics[0].layer === 2 && lbv.diagnostics[0].severity === "info" && lbv.supportGraph.reachesBase);
  check("LYR-05 identical layers not reported in connected mode", !codes(SBSupport.validate(mk(F.MASKS.looseBridge), "connected-sheet", {})).includes("IDENTICAL_LAYERS"));
  const em = SBSupport.validate(mk(F.MASKS.emptyIntermediate), "bonded-relief", { minFeatureMM: 0.5 });
  check("D-4.7 BOND_EMPTY_UNDER names the empty layer; the graph does not reach the base", em.diagnostics.find((d) => d.code === "BOND_EMPTY_UNDER").layer === 1 && !em.supportGraph.reachesBase);
  const trailing = mk({ ...F.MASKS.emptyIntermediate, layers: [F.MASKS.emptyIntermediate.layers[0], F.MASKS.emptyIntermediate.layers[2], F.MASKS.emptyIntermediate.layers[1]] });
  check("D-4.7 a trailing empty layer is not BOND_EMPTY_UNDER", !codes(SBSupport.validate(trailing, "bonded-relief", { minFeatureMM: 0.5 })).includes("BOND_EMPTY_UNDER"));
  // connected rules
  check("SUP-06 one part per layer passes connected validation", SBSupport.validate(mk(F.MASKS.borderTouch), "connected-sheet", {}).diagnostics.length === 0);
  const split = SBSupport.validate(mk(F.MASKS.diagonalTouch), "connected-sheet", {}).diagnostics.find((d) => d.code === "CONNECTED_SPLIT");
  check("SUP-06 CONNECTED_SPLIT carries layer, measured parts and limit 1", split.layer === 1 && split.measured.value === 2 && split.limit.value === 1);
  // reuse (B3b): precomputed differences and graph-only
  const st = F.randomNestedStack(F.lcg(5), 40, 30, 6), L = mk({ layers: st, w: 40, h: 30 });
  const full = SBSupport.validate(L, "bonded-relief", { minFeatureMM: 2, advisoryFeatureMM: 3 });
  const diffs = L.map((l, k) => (k ? SBGeom.difference(l.material, L[k - 1].material) : null));
  const reused = SBSupport.validate(L, "bonded-relief", { minFeatureMM: 2, advisoryFeatureMM: 3, unsupported: diffs });
  const graph = SBSupport.validate(L, "bonded-relief", { minFeatureMM: 2, advisoryFeatureMM: 3, graphOnly: true });
  check("Appendix C reuse: precomputed differences give the same result", JSON.stringify(reused) === JSON.stringify(full));
  check("Appendix C graphOnly: same support graph, no containment diagnostics", JSON.stringify(graph.supportGraph) === JSON.stringify(full.supportGraph) &&
    !codes(graph).some((c) => c === "BOND_UNSUPPORTED" || c === "BOND_EMPTY_UNDER"));
  // support graph agrees with a per-part-pair oracle (D3 block threshold) on random stacks
  let oracle = true;
  for (let s = 1; s <= 12; s++) {
    const S = mk({ layers: F.randomNestedStack(F.lcg(100 + s), 30, 20, 5), w: 30, h: 20 }), r = SBSupport.validate(S, "bonded-relief", { minFeatureMM: 1 });
    for (const edge of r.supportGraph.edges) {
      const p = S[edge.layer].parts.find((x) => x.id === edge.part);
      const want = S[edge.layer - 1].parts.filter((q) => SBGeom.classifyContact(SBGeom.intersection([p.polygon], [q.polygon]), 1000).level !== "block").map((q) => q.id);
      if (want.join() !== edge.supports.map((x) => x.part).join()) oracle = false;
    }
  }
  check("SUP-03 support graph == per-part-pair classifyContact oracle (12 seeds)", oracle);
  // determinism and purity
  const before = JSON.stringify(L);
  const again = SBSupport.validate(L, "bonded-relief", { minFeatureMM: 2, advisoryFeatureMM: 3 });
  check("NFR-05 validate is deterministic and does not mutate its input", JSON.stringify(again) === JSON.stringify(full) && JSON.stringify(L) === before);
  check("§9.1 diagnostics carry revision and quality from cfg", SBSupport.validate(mk(F.MASKS.emptyIntermediate), "bonded-relief", { minFeatureMM: 1, revision: 4, quality: "fabrication" })
    .diagnostics.every((d) => d.revision === 4 && d.quality === "fabrication"));
  // annotate: Part.supports[] rewritten to IDs (§3)
  const ann = SBSupport.annotate(mk(F.MASKS.donutIsland), dn.supportGraph);
  check("§3 annotate writes supports[] as part IDs", ann[1].parts.every((p) => p.supports.join() === "L00-P001") && ann[0].parts[0].supports.length === 0);
  const bad = (f) => { try { f(); return false; } catch (x) { return x.code === "SUPPORT_ARG"; } };
  check("G2.7 bad arguments are SUPPORT_ARG", bad(() => SBSupport.validate(L, "stacked", { minFeatureMM: 1 })) && bad(() => SBSupport.validate(L, "bonded-relief", {})) &&
    bad(() => SBSupport.validate(L, "bonded-relief", { minFeatureMM: 2, advisoryFeatureMM: 1 })) && bad(() => SBSupport.validate(null, "bonded-relief", { minFeatureMM: 1 })) &&
    bad(() => SBSupport.validate(L, "bonded-relief", { minFeatureMM: 1, unsupported: [] })));
});

// ------------------------------------------------ engine seam (T0.5)
// ------------------------------------------------ feature and sampling checks (G2.8)
suite("support.js — G2.8 feature and sampling checks (GEO-05/06, MAT-03, AT-10, PO-LASER-6)", () => {
  const F = require("./fixtures.js");
  const mk = (st) => SBMaterial.assignParts(SBMaterial.fromMasks(st.layers, st.w, st.h, { artWMM: st.w * (st.mmPerPx || 1), artHMM: st.h * (st.mmPerPx || 1), frameMM: 0 }, {}));
  const base = { minFeatureMM: 3, minPartMM2: 0, mmPerPxMax: 0.1, calibrated: true };
  const fc = (st, cfg) => SBSupport.featureChecks(mk(st), Object.assign({}, base, cfg));
  const codes = (ds) => ds.map((d) => d.code);
  const only = (ds, c) => codes(ds).join() === c;
  const noLayers = [mk(F.MASKS.isolatedStrip(40))[0]];
  check("AT-10 1mm feature @0.4mm/px → SAMPLING_LOW", codes(SBSupport.featureChecks(noLayers, { ...base, minFeatureMM: 1, mmPerPxMax: 0.4 })).includes("SAMPLING_LOW"));
  check("AT-10 1mm feature @0.25mm/px → no SAMPLING_LOW", !codes(SBSupport.featureChecks(noLayers, { ...base, minFeatureMM: 1, mmPerPxMax: 0.25 })).includes("SAMPLING_LOW"));
  const sl = SBSupport.featureChecks(noLayers, { ...base, minFeatureMM: 1, mmPerPxMax: 0.4 }).find((d) => d.code === "SAMPLING_LOW");
  check("GEO-06 SAMPLING_LOW is blocking with measured = samples across the feature and limit = 3", sl.severity === "blocking" &&
    Math.abs(sl.measured.value - 2.5) < 1e-9 && sl.limit.value === 3 && sl.layer === null);
  check("AT-10/GEO-05 neck 2.9 mm with min 3 mm → NECK_NARROW", only(fc(F.MASKS.dumbbell(29)), "NECK_NARROW"));
  check("AT-10/GEO-05 neck 3.1 mm with min 3 mm → none", fc(F.MASKS.dumbbell(31)).length === 0);
  check("D3 featureChecks with minFeatureMM 2.999 (odd µm) uses integer halfUm 1499 and does not throw",
    (() => { try { return only(fc(F.MASKS.dumbbell(29), { minFeatureMM: 2.999 }), "NECK_NARROW") && fc(F.MASKS.dumbbell(30), { minFeatureMM: 2.999 }).length === 0; } catch (e) { return false; } })());
  check("GEO-05 2.9 mm-wide isolated strip → PART_THIN", only(fc(F.MASKS.isolatedStrip(29)), "PART_THIN"));
  check("GEO-05 3.1 mm-wide isolated strip → none", fc(F.MASKS.isolatedStrip(31)).length === 0);
  const small = (n) => codes(fc(F.MASKS.areaPart(n), { minFeatureMM: 0.3, minPartMM2: 25 }));
  check("AT-10 part 24.9 mm² → PART_SMALL; 25.1 mm² → none", small(2490).includes("PART_SMALL") && !small(2510).includes("PART_SMALL"));
  const ply = { minFeatureMM: 1.5, advisoryFeatureMM: 2 };
  check("PO-LASER-6 neck 1.4 mm with min 1.5 mm → NECK_NARROW", only(fc(F.MASKS.dumbbell(14), ply), "NECK_NARROW"));
  const m18 = fc(F.MASKS.dumbbell(18), ply);
  check("PO-LASER-6 neck 1.8 mm with min 1.5 / advisory 2.0 → FEATURE_MARGINAL only", only(m18, "FEATURE_MARGINAL") && m18[0].detail.kind === "neck");
  check("PO-LASER-6 neck 2.1 mm → none", fc(F.MASKS.dumbbell(21), ply).length === 0);
  check("PO-LASER-6 strip 1.8 mm with min 1.5 / advisory 2.0 → FEATURE_MARGINAL kind part", (() => { const r = fc(F.MASKS.isolatedStrip(18), ply);
    return only(r, "FEATURE_MARGINAL") && r[0].detail.kind === "part" && r[0].limit.value === 2 && r[0].layer === 1; })());
  check("PO-LASER-6 no advisoryFeatureMM → no advisory tier", fc(F.MASKS.dumbbell(18), { minFeatureMM: 1.5 }).length === 0);
  const samp = (p, mf = 1.5) => codes(SBSupport.featureChecks(noLayers, { ...base, minFeatureMM: mf, mmPerPxMax: p })).includes("SAMPLING_LOW");
  check("PO-LASER-6/GEO-06 1.5 mm feature at 0.5 mm/px → no SAMPLING_LOW; at 0.6 mm/px → SAMPLING_LOW", !samp(0.5) && samp(0.6));
  check("GEO-06 0.3 mm feature at 0.1 mm/px is exactly 3 samples (no float shortfall) → no SAMPLING_LOW", !samp(0.1, 0.3));
  const NOTE = "Conservative fabrication warning — not a structural simulation";
  const geo05 = [].concat(fc(F.MASKS.dumbbell(29)), fc(F.MASKS.isolatedStrip(29)), fc(F.MASKS.areaPart(2490), { minFeatureMM: 0.3, minPartMM2: 25 }),
    fc(F.MASKS.dumbbell(18), ply), fc(F.MASKS.isolatedStrip(18), ply));
  check("GEO-05 message labelled conservative, not structural", geo05.length === 5 && geo05.every((d) => ["PART_SMALL", "PART_THIN", "NECK_NARROW", "FEATURE_MARGINAL"].includes(d.code) && d.message.includes(NOTE)));
  check("GEO-05 the note survives aggregation (two thin parts on one layer → one diagnostic, count 2)", (() => {
    const st = F.MASKS.isolatedStrip(29), up = st.layers[1].slice(); for (let y = 45; y < 50; y++) for (let x = 10; x < 90; x++) up[y * st.w + x] = 1;
    const r = fc({ ...st, layers: [st.layers[0], up] }); return only(r, "PART_THIN") && r[0].count === 2 && r[0].parts.length === 2 && r[0].message.includes(NOTE); })());
  check("GEO-05 contact FEATURE_MARGINAL (G2.7) does not carry the GEO-05 note", !SBDiag.make("FEATURE_MARGINAL", { detail: { kind: "contact" } }).message.includes(NOTE));
  const unc = SBSupport.featureChecks(noLayers, { ...base, calibrated: false });
  check("MAT-03 uncalibrated warning present", only(unc, "MAT_UNCALIBRATED") && unc[0].severity === "warning");
  check("MAT-03 calibrated → no MAT_UNCALIBRATED", SBSupport.featureChecks(noLayers, base).length === 0);
  // diagnostics carry layer, part, region and limit; the full base is never flagged
  const nk = fc(F.MASKS.dumbbell(29))[0];
  check("GEO-05 NECK_NARROW names layer 1 and its part, region (mm) and limit = minFeature", nk.layer === 1 && nk.parts.join() === "L01-P001" &&
    Array.isArray(nk.region) && nk.limit.value === 3 && nk.limit.unit === "mm");
  // layer-level erosion (one offset per layer and width, Appendix C) == per-part oracle
  let agree = true;
  for (let s = 1; s <= 10; s++) {
    const S = mk({ layers: F.randomNestedStack(F.lcg(200 + s), 40, 30, 5), w: 40, h: 30, mmPerPx: 0.1 });
    const cfg = { minFeatureMM: 0.4, advisoryFeatureMM: 0.7, minPartMM2: 0, mmPerPxMax: 0.1, calibrated: true };
    const got = new Set(); for (const d of SBSupport.featureChecks(S, cfg)) for (const p of d.parts || [d.part]) got.add(d.code + (d.detail ? ":" + d.detail.kind : "") + "|" + p);
    const want = new Set();
    for (const L of S) for (const p of L.parts) {
      const n = (h) => SBGeom.components(SBGeom.offset([p.polygon], -h, "square")).length, a = n(200), b = n(350);   // Appendix G G3: octagon, direct
      if (a === 0) want.add("PART_THIN|" + p.id); else if (a > 1) want.add("NECK_NARROW|" + p.id);
      else if (b === 0) want.add("FEATURE_MARGINAL:part|" + p.id); else if (b > 1) want.add("FEATURE_MARGINAL:neck|" + p.id);
    }
    if ([...got].sort().join() !== [...want].sort().join()) agree = false;
  }
  check("Appendix C layer-level erosion == per-part offset oracle (10 seeds)", agree);
  // Appendix G G3 (G-D3): every feature erosion is octagonal ("square" join) and direct on the part polygon; the
  // octagon does not compose, so orthogonal layers no longer erode the first residual. deltas records "d:join" of the
  // erosions (negative deltas) only, so the neck locator's dilations are ignored; base has no kerf, so no kerf pass runs.
  const deltas = (Ls, cfg) => { const o = SBGeom.offset, seen = []; SBGeom.offset = (p, d, j) => (d < 0 && seen.push(d + ":" + j), o(p, d, j));
    try { SBSupport.featureChecks(Ls, { ...base, ...cfg }); } finally { SBGeom.offset = o; } return seen; };
  check("Appendix G G3 orthogonal layer: both erosions direct (−750 and −1000 µm, square join), no composition",
    deltas([mk(F.MASKS.dumbbell(25))[1]], ply).join() === "-750:square,-1000:square");
  const diamond = { outer: [10000, 2000, 18000, 10000, 10000, 18000, 2000, 10000], holes: [] };
  const neckDiag = SBGeom.union([diamond, { outer: [30000, 2000, 38000, 10000, 30000, 18000, 22000, 10000], holes: [] },
    { outer: [17000, 9100, 23000, 9100, 23000, 10900, 17000, 10900], holes: [] }], []);
  const diagL = [{ index: 0, material: neckDiag, parts: [{ id: "L00-P001", polygon: neckDiag[0], bbox: SBGeom.bbox(neckDiag[0]) }] }];
  check("Appendix C non-orthogonal layer: both erosions direct (−750 and −1000 µm, square join); 1.8 mm diagonal-shouldered neck → FEATURE_MARGINAL neck",
    neckDiag.length === 1 && deltas(diagL, ply).join() === "-750:square,-1000:square" &&
    (() => { const r = SBSupport.featureChecks(diagL, { ...base, ...ply }); return only(r, "FEATURE_MARGINAL") && r[0].detail.kind === "neck"; })());
  // determinism, purity, arguments
  const L = mk(F.MASKS.dumbbell(18)), before = JSON.stringify(L);
  check("NFR-05 featureChecks deterministic and does not mutate its input",
    JSON.stringify(SBSupport.featureChecks(L, { ...base, ...ply })) === JSON.stringify(SBSupport.featureChecks(L, { ...base, ...ply })) && JSON.stringify(L) === before);
  check("§9.1 revision and quality are passed through", (() => { const d = SBSupport.featureChecks(L, { ...base, ...ply, revision: 4, quality: "fabrication" })[0];
    return d.revision === 4 && d.quality === "fabrication"; })());
  const bad = (cfg) => { try { SBSupport.featureChecks(L, cfg); return false; } catch (e) { return e.code === "SUPPORT_ARG"; } };
  check("G2.8 bad arguments are SUPPORT_ARG", bad({ ...base, minFeatureMM: 0 }) && bad({ ...base, mmPerPxMax: -1 }) && bad({ ...base, advisoryFeatureMM: 1 }) &&
    bad({ ...base, minPartMM2: -1 }) && bad({ ...base, calibrated: "no" }) && bad(null) && (() => { try { SBSupport.featureChecks("x", base); return false; } catch (e) { return e.code === "SUPPORT_ARG"; } })());
});
// ------------------------------------------------ reviewed clip repair (G2.9)
suite("support.js — G2.9 reviewed clip repair (SUP-04, D-4.6, PRJ-04, LYR-06, AT-09)", () => {
  // One bonded project at two resolutions. The upper part spans a 2 mm gap in the base, so the clip removes the gap
  // area and splits the part in two. Draft: 10 × 8 px at 1 mm/px (gap x 4..6 mm, upper x 1..9, y 2..6 mm → 8 mm²);
  // fabrication: 20 × 16 px at 0.5 mm/px (upper y 2..6.5 mm → 9 mm²): the removed area depends on the resolution.
  const grid = (w, h, f) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = f(x, y) ? 1 : 0; return m; };
  const build = (s, yTop) => { const w = 10 * s, h = 8 * s;
    const base = grid(w, h, (x) => x < 4 * s || x >= 6 * s), up = grid(w, h, (x, y) => x >= s && x < 9 * s && y >= 2 * s && y <= yTop);
    return SBMaterial.fromMasks([base, up], w, h, { artWMM: 10, artHMM: 8, frameMM: 0 }, {}); };
  const draft = { revision: 3, quality: "draft", layers: build(1, 5) }, fab = { revision: 3, quality: "fabrication", layers: build(2, 12) };
  const proj = () => { const p = SBSchema.defaults("plywood"); p.construction.sheets = 2; p.revision = 3; return p; };
  const P0 = proj(), frozen = JSON.stringify(P0);
  const G = SBGeom, codes = (ds) => ds.map((d) => d.code);
  const cfgV = { minFeatureMM: 0.5 };
  const unsupportedOn = (Ls, k) => SBSupport.validate(Ls, "bonded-relief", cfgV).diagnostics.some((d) => d.code === "BOND_UNSUPPORTED" && d.layer === k);
  check("G2.9 fixture: the project is valid and layer 1 is unsupported before any repair", SBSchema.validate(P0).ok && unsupportedOn(draft.layers, 1));

  const snapD = JSON.stringify(draft);
  const prop = SBSupport.proposeClip(draft, 1);
  check("SUP-04 proposeClip reports removed area and part counts before apply", prop.layer === 1 && prop.removedAreaMM2 === 8 &&
    prop.partCountBefore === 1 && prop.partCountAfter === 2 && prop.quality === "draft" && JSON.stringify(draft) === snapD);
  check("AT-09 removed polygons == difference(Final[k], Final[k-1])",
    JSON.stringify(G.normalize(prop.removed)) === JSON.stringify(G.normalize(G.difference(draft.layers[1].material, draft.layers[0].material))));
  check("SUP-04 proposal beforeHash is the layer's materialHash", prop.beforeHash === draft.layers[1].canonicalHash && prop.afterHash !== prop.beforeHash);

  const P1 = SBSupport.applyClip(P0, prop);
  check("SUP-04 apply → new revision, original project object unchanged", P1 !== P0 && P1.revision === 4 && JSON.stringify(P0) === frozen &&
    P1.construction.repairs.length === 1 && P0.construction.repairs.length === 0 && SBSchema.validate(P1).ok);
  const r0 = P1.construction.repairs[0];
  check("PRJ-04 repair records source and resulting revisions and afterHash", r0.op === "clip-to-lower" && r0.layer === 1 &&
    r0.sourceRevision === 3 && r0.resultRevision === 4 && r0.reviewed.afterHash === prop.afterHash && r0.reviewed.beforeHash === prop.beforeHash &&
    r0.reviewed.quality === "draft" && r0.reviewed.removedAreaMM2 === 8 && r0.reviewed.partCountBefore === 1 && r0.reviewed.partCountAfter === 2);
  check("D4 keyHash = hashJSON(geometryKey) with repairs truncated before the entry", r0.keyHash === SBHash.hashJSON(SBSchema.geometryKey(P0)));

  const rd = SBSupport.replayRepairs(draft.layers, P1.construction.repairs, { project: P1, quality: "draft" });
  check("SUP-04 replay at the reviewed quality applies the clip with the reviewed afterHash and no diagnostics",
    rd.diagnostics.length === 0 && rd.layers[1].canonicalHash === r0.reviewed.afterHash && rd.layers[1].parts.length === 2 && JSON.stringify(draft) === snapD);
  check("SUP-04 after replay, validate() reports no BOND_UNSUPPORTED on k", !unsupportedOn(rd.layers, 1));
  const none = SBSupport.replayRepairs(draft.layers, [], { project: P0, quality: "draft" });
  check("D-4.6 no clip without a repairs[] entry", none.layers[1].canonicalHash === draft.layers[1].canonicalHash && unsupportedOn(none.layers, 1));

  const P2 = JSON.parse(JSON.stringify(P1)); P2.material.minFeatureMM = 1.6;
  const st = SBSupport.replayRepairs(draft.layers, P2.construction.repairs, { project: P2, quality: "draft" });
  const sd = st.diagnostics.find((d) => d.code === "REPAIR_STALE");
  check("SUP-04 settings change → REPAIR_STALE, clip not applied", codes(st.diagnostics).join() === "REPAIR_STALE" && sd.severity === "blocking" &&
    sd.layer === 1 && st.layers[1].canonicalHash === draft.layers[1].canonicalHash && unsupportedOn(st.layers, 1));
  const other = SBSupport.replayRepairs(build(1, 4), P1.construction.repairs, { project: P1, quality: "draft" });
  check("SUP-04 same settings and quality but a different pre-repair layer → REPAIR_STALE, not applied",
    codes(other.diagnostics).join() === "REPAIR_STALE" && unsupportedOn(other.layers, 1));

  const rf = SBSupport.replayRepairs(fab.layers, P1.construction.repairs, { project: P1, quality: "fabrication" });
  const fd = rf.diagnostics.find((d) => d.code === "REPAIR_REVIEW_FAB");
  check("LYR-06 draft-reviewed clip at fab quality → applied + REPAIR_REVIEW_FAB with fab-resolution area",
    codes(rf.diagnostics).join() === "REPAIR_REVIEW_FAB" && fd.severity === "warning" && fd.quality === "fabrication" && fd.layer === 1 &&
    fd.areaMM2 === 9 && fd.measured.value === 9 && /1 → 2/.test(fd.message) && !unsupportedOn(rf.layers, 1));
  check("LYR-06 fab replay equals a fab-resolution proposal", rf.layers[1].canonicalHash === SBSupport.proposeClip(fab, 1).afterHash);

  const Pf = SBSupport.applyClip(P0, SBSupport.proposeClip(fab, 1)), rdf = SBSupport.replayRepairs(draft.layers, Pf.construction.repairs, { project: Pf, quality: "draft" });
  check("LYR-06 fab-reviewed clip in a draft preview → applied, no REPAIR_REVIEW_FAB (draft never exports)",
    rdf.diagnostics.length === 0 && rdf.layers[1].canonicalHash === prop.afterHash && rdf.applied.join() === "0");
  const P3 = SBSupport.removeRepair(P1, 0);
  const rr = SBSupport.replayRepairs(draft.layers, P3.construction.repairs, { project: P3, quality: "draft" });
  check("D-4.6 removeRepair restores the pre-repair layer hash", P3.revision === 5 && P3.construction.repairs.length === 0 && P1.construction.repairs.length === 1 &&
    rr.layers[1].canonicalHash === draft.layers[1].canonicalHash && unsupportedOn(rr.layers, 1));
  const bad = (f) => { try { f(); return false; } catch (e) { return e.code === "SUPPORT_ARG"; } };
  check("G2.9 bad arguments are SUPPORT_ARG", bad(() => SBSupport.proposeClip(draft, 0)) && bad(() => SBSupport.proposeClip(draft, 2)) &&
    bad(() => SBSupport.removeRepair(P1, 1)) && bad(() => SBSupport.applyClip(P0, null)) &&
    bad(() => SBSupport.applyClip(P1, prop)) /* proposal from revision 3, project at 4 */ && bad(() => SBSupport.replayRepairs(draft.layers, [], {})));
});

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
  check("bench geom: reports B1, B2, B3 and B3b with budgets 2 s / 3 s / 3 s (B3b provisional 6 s removed in G2.7)", !!r &&
    ["B1_difference", "B2_offset_inset1500", "B2_offset_grow300", "B3_supportPass", "B3b_supportPass_dense"].every((k) => r[k] && r[k].p95Ms >= 0) &&
    r.budgetsMs.B1 === 2000 && r.budgetsMs.B3 === 3000 && r.budgetsMs.B3b === 3000);
  check("bench geom: B1 overrun is tracked (KI-B1, G4.4) as KNOWN-OVER, never in overBudget", !!r && r.tracked && r.tracked.B1 && r.tracked.B1.id === "KI-B1" &&
    /G4\.4/.test(r.tracked.B1.ref) && Array.isArray(r.knownOver) && !r.overBudget.includes("B1"));
  check("bench geom: G2.7 support pass (SBSupport.validate) finds pairs and containment on the dense stack; reuse == full", !!r && r.B3b_supportPass_dense.pairs > 0 &&
    r.B3b_supportPass_dense.contained && r.B3b_supportPass_dense.reachesBase && r.inputB3b.sameMaterialAsB1 &&
    JSON.stringify([r.B3b_supportPass_dense_full.pairs, r.B3b_supportPass_dense_full.diagnostics]) === JSON.stringify([r.B3b_supportPass_dense.pairs, r.B3b_supportPass_dense.diagnostics]));
});

suite("G2.7 — test/bench.js support smoke (--quick)", () => {
  const out = path.join(require("os").tmpdir(), "sb-bench-support-" + process.pid + ".json");
  let r = null;
  try {
    require("child_process").execFileSync(process.execPath, [path.join(__dirname, "bench.js"), "support", "--quick", "--json", out], { stdio: "ignore" });
    r = JSON.parse(fs.readFileSync(out, "utf8"));
  } catch (e) { /* r stays null */ } finally { try { fs.unlinkSync(out); } catch (e) { /* none */ } }
  check("bench support --quick runs B3 and B3b (budgets 3 s / 3 s)", !!r && r.stage === "support" && r.B3_supportPass.p95Ms >= 0 && r.B3b_supportPass_dense.p95Ms >= 0 &&
    r.budgetsMs.B3 === 3000 && r.budgetsMs.B3b === 3000 && r.B3b_supportPass_dense.pairs > 0 && r.B3_supportPass.reachesBase);
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
      "REPAIR_STALE", "COMPLEXITY_LIMIT", "LEGACY_NEEDS_SOURCE", "GUIDE_UNCONTAINED", "NECK_KERF"],
    warning: ["MAT_UNCALIBRATED", "PART_SMALL", "PART_THIN", "NECK_NARROW", "SUPPORT_NARROW",
      "GUIDE_OMITTED", "CLEANUP_ALTERED", "SMOOTH_FALLBACK", "TRAILING_OMITTED",
      "ALIGN_CLEARANCE_ZERO", "REPAIR_REVIEW_FAB", "FAB_EXCEEDS_SOURCE", "PART_POINT_CONTACT"],
    info: ["KERF_EXTERNAL", "PALETTE_ONLY", "IDENTICAL_LAYERS", "EMPTY_BAND", "DISPLAY_ONLY_IGNORED", "HEIGHT_FILTERED", "RESAMPLED", "DRAFT_COARSER"],
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

suite("diag.js — acknowledgements and the export gate: ackKey, exportGate, withAckState (§9.5, EXP-07, LYR-06; G2.2)", () => {
  const D = globalThis.SBDiag;
  check("G2.2 SBDiag exposes ackKey, exportGate and withAckState",
    typeof D.ackKey === "function" && typeof D.exportGate === "function" && typeof D.withAckState === "function");
  if (typeof D.ackKey !== "function" || typeof D.exportGate !== "function" || typeof D.withAckState !== "function") return;
  const throws = (f) => { try { f(); return false; } catch { return true; } };
  const H_FAB = "f".repeat(64), H_FAB2 = "e".repeat(64), H_DRAFT = "d".repeat(64);
  const fabSnap = { revision: 4, quality: "fabrication", geometryHash: H_FAB };
  const draftSnap = { revision: 4, quality: "draft", geometryHash: H_DRAFT };
  const mk = (code, q, extra) => D.make(code, Object.assign({ revision: 4, quality: q }, extra || {}));
  const warnF = mk("PART_THIN", "fabrication", { layer: 2, part: "L02-P007" });
  const warnD = mk("PART_THIN", "draft", { layer: 2, part: "L02-P007" });
  const blockF = mk("BOND_UNSUPPORTED", "fabrication", { layer: 3, part: "L03-P001" });
  const infoF = mk("KERF_EXTERNAL", "fabrication");

  // ackKey
  check("§9.5 ackKey is code|layer|part|geometryHash", D.ackKey(warnF, H_FAB) === "PART_THIN|2|L02-P007|" + H_FAB);
  check("§9.5 ackKey of a layer-less, part-less diagnostic uses '-' placeholders",
    D.ackKey(mk("MAT_UNCALIBRATED", "fabrication"), H_FAB) === "MAT_UNCALIBRATED|-|-|" + H_FAB);
  check("§9.5 ackKey changes with the geometryHash", D.ackKey(warnF, H_FAB) !== D.ackKey(warnF, H_FAB2));
  check("§9.5 ackKey rejects a missing or empty geometryHash", throws(() => D.ackKey(warnF)) && throws(() => D.ackKey(warnF, "")));

  // gate: clean / info only
  check("EXP-07 no diagnostics → allowed", (() => { const g = D.exportGate([], new Set(), fabSnap); return g.allowed === true && g.reason === null && g.blocking.length === 0 && g.unacked.length === 0; })());
  check("EXP-07 info diagnostics never block and need no ack", D.exportGate([infoF], new Set(), fabSnap).allowed === true);

  // blocking cannot be acknowledged
  const blockAcks = new Set([D.ackKey(blockF, H_FAB)]);
  const gb = D.exportGate([blockF], blockAcks, fabSnap);
  check("§9.5 blocking cannot be acknowledged", gb.allowed === false && gb.reason === "BLOCKING" && gb.blocking.length === 1 && gb.blocking[0] === blockF);
  check("§9.5 withAckState never marks a blocking diagnostic acked", D.withAckState([blockF], blockAcks, H_FAB)[0].ackState === "n/a");

  // unacked warning
  const gu = D.exportGate([warnF, infoF], new Set(), fabSnap);
  check("EXP-07 unacked warning → not allowed", gu.allowed === false && gu.reason === "UNACKED" && gu.unacked.length === 1 && gu.unacked[0] === warnF);
  check("EXP-07 fab warning acked on the fab snapshot → allowed", D.exportGate([warnF, infoF], new Set([D.ackKey(warnF, H_FAB)]), fabSnap).allowed === true);
  check("EXP-07 acks accept any iterable of keys (array)", D.exportGate([warnF], [D.ackKey(warnF, H_FAB)], fabSnap).allowed === true);
  const gbu = D.exportGate([warnF, blockF], new Set(), fabSnap);
  check("EXP-07 blocking takes precedence over unacked and both lists are reported",
    gbu.reason === "BLOCKING" && gbu.blocking.length === 1 && gbu.unacked.length === 1);

  // ack invalidated by a geometryHash change (Review Focus #2: N 8 → 3 → 8)
  const oldAcks = new Set([D.ackKey(warnF, H_FAB)]);
  const fabSnap2 = { revision: 5, quality: "fabrication", geometryHash: H_FAB2 };
  const warnF2 = Object.assign({}, warnF, { revision: 5 });
  check("§9.5 ack invalid after geometryHash change",
    D.exportGate([warnF2], oldAcks, fabSnap2).allowed === false && D.withAckState([warnF2], oldAcks, H_FAB2)[0].ackState === "unacked");

  // draft vs fabrication (LYR-06)
  const draftAcks = new Set([D.ackKey(warnD, H_DRAFT)]);
  const gdf = D.exportGate([warnF], draftAcks, fabSnap);
  check("EXP-07/LYR-06 draft acks do not satisfy fab gate", gdf.allowed === false && gdf.reason === "UNACKED" && gdf.unacked.length === 1);
  const gds = D.exportGate([warnD], draftAcks, draftSnap);
  check("LYR-06 draft snapshot rejected by fabrication gate", gds.allowed === false && gds.reason === "QUALITY_MISMATCH");
  check("LYR-06 draft snapshot rejected even with no diagnostics", D.exportGate([], new Set(), draftSnap).reason === "QUALITY_MISMATCH");
  check("LYR-06 expectedQuality 'draft' accepts a draft snapshot", D.exportGate([warnD], draftAcks, draftSnap, "draft").allowed === true);
  const gmix = D.exportGate([warnD], new Set([D.ackKey(warnD, H_FAB)]), fabSnap);
  check("LYR-06 a draft-quality diagnostic presented to the fab gate is QUALITY_MISMATCH", gmix.allowed === false && gmix.reason === "QUALITY_MISMATCH");
  check("EXP-07 missing snapshot or geometryHash → NO_SNAPSHOT",
    D.exportGate([], new Set(), null).reason === "NO_SNAPSHOT" && D.exportGate([], new Set(), { quality: "fabrication" }).reason === "NO_SNAPSHOT");
  check("EXP-07 exportGate rejects an invalid expectedQuality", throws(() => D.exportGate([], new Set(), fabSnap, "final")));

  // aggregated PART_SMALL: one ack covers it
  const smalls = [];
  for (let i = 0; i < 40; i++) smalls.push(mk("PART_SMALL", "fabrication", { layer: 1, part: "L01-P" + String(i + 1).padStart(3, "0") }));
  const agg = D.aggregate(smalls);
  const aggKey = D.ackKey(agg[0], H_FAB);
  check("§9.5 aggregated diagnostic ackKey uses the aggregate marker", aggKey === "PART_SMALL|1|*|" + H_FAB);
  check("§9.5 one ack covers an aggregated PART_SMALL diagnostic",
    agg.length === 1 && D.exportGate(agg, new Set([aggKey]), fabSnap).allowed === true && D.exportGate(agg, new Set(), fabSnap).unacked.length === 1);

  // withAckState
  const before = JSON.stringify([warnF, blockF, infoF]);
  const ws = D.withAckState([warnF, blockF, infoF], new Set([D.ackKey(warnF, H_FAB)]), H_FAB);
  check("§9.5 withAckState fills acked/unacked for warnings and n/a otherwise",
    ws.map((d) => d.ackState).join(",") === "acked,n/a,n/a" &&
    D.withAckState([warnF], new Set(), H_FAB)[0].ackState === "unacked");
  check("§9.5 withAckState does not mutate its input", JSON.stringify([warnF, blockF, infoF]) === before && ws[0] !== warnF);
  check("§9.5 exportGate ignores a stale ackState already on the diagnostic",
    D.exportGate([Object.assign({}, warnF, { ackState: "acked" })], new Set(), fabSnap).allowed === false);
});

suite("material.js — canonical polygons (GEO-01/03, D-4.2, SUP-05; G1.1)", () => {
  const F = require("./fixtures.js"), O = require("./oracle_raster.js"), G = SBGeom, M = globalThis.SBMaterial;
  check("G1.1 SBMaterial is loaded", !!M && typeof M.fromMasks === "function" && typeof M.assignParts === "function" && typeof M.scale === "function");
  if (!M) return;
  check("§4 module order: material.js after construct.js after trace.js", (() => { const L = require("./modules.js").NODE_MODULES; return L.indexOf("construct.js") === L.indexOf("trace.js") + 1 && L.indexOf("material.js") === L.indexOf("construct.js") + 1; })());
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

// ------------------------------------------------ SVG writer v2 (G1.4)
suite("svgout.js — layerSVG: CUT/SCORE groups, mm units, shared viewBox, no page rect (EXP-01/02/03, AT-12, D-4.2, GEO-09; G1.4)", () => {
  const F = require("./fixtures.js"), M = SBMaterial, S = SBSvg;
  check("G1.4 API present", typeof S.layerSVG === "function" && typeof S.fmtUm === "function");
  if (typeof S.layerSVG !== "function" || typeof S.fmtUm !== "function") return;
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  const ringsOf = (l) => { const o = []; for (const p of l.material) o.push(p.outer, ...p.holes); return o; };
  const groupOf = (svg, id) => { const m = svg.match(new RegExp('<g id="' + id + '"[^>]*>([\\s\\S]*?)</g>')); return m ? m[1] : null; };
  const nums = (d) => d.replace(/[MLZ]/g, " ").trim().split(/\s+/).filter(Boolean);
  // ---- fmtUm: exact decimal mm from integer µm
  check("GEO-09 fmtUm formats integer µm as exact mm (trailing zeros and point dropped)",
    S.fmtUm(0) === "0" && S.fmtUm(100000) === "100" && S.fmtUm(1500) === "1.5" && S.fmtUm(5) === "0.005" && S.fmtUm(10) === "0.01" &&
    S.fmtUm(304800) === "304.8" && S.fmtUm(-2500) === "-2.5" && S.fmtUm(-0) === "0" && S.fmtUm(33554432) === "33554.432");
  check("GEO-09 fmtUm round-trips every integer in a sweep (Math.round(parse·1000) === u)", (() => {
    const r = F.lcg(4711); for (let i = 0; i < 20000; i++) { const u = Math.floor((r() - 0.5) * 2 * 33554432);
      const t = S.fmtUm(u); if (Math.round(Number(t) * 1000) !== u || /\.\d*0$|\.$/.test(t)) return false; } return true; })());
  check("NONFINITE fmtUm refuses non-integer µm", throws(() => S.fmtUm(0.5), /NONINTEGER/) && throws(() => S.fmtUm(NaN), /NONINTEGER/));
  // ---- fixtures: bonded (no frame) and connected (framed) borderTouch on 10 mm/px
  const bt = F.MASKS.borderTouch;
  const pgB = M.page({ artWMM: 80, artHMM: 50, frame: { enabled: false, widthMM: 10 } }), LB = M.fromMasks(bt.layers, 8, 5, pgB, {});
  const pgC = M.page({ artWMM: 80, artHMM: 50, frameMM: 10 }), LC = M.fromMasks(bt.layers, 8, 5, pgC, { frame: true, holes: [{ cxUm: 5000, cyUm: 5000, rUm: 1500 }] });
  const opts = { construction: "bonded", frontNote: "front face = layer N−1 (top)" };
  const svgB = LB.map((l) => S.layerSVG(l, pgB, opts)), svgC = LC.map((l) => S.layerSVG(l, pgC, { ...opts, construction: "connected" }));
  // ---- EXP-01
  check("EXP-01 FIXED: bonded upper layer emits no <rect>", !/<rect/.test(svgB[1]) && svgB.every((s) => !/<rect/.test(s)) && svgC.every((s) => !/<rect/.test(s)));
  const vb = (s) => (s.match(/viewBox="([^"]+)"/) || [])[1];
  check("EXP-01 shared viewBox across layers = the shared page frame (0 0 wMM hMM; assemblySVG joins it in G1.6, GEO-01)",
    svgB.every((s) => vb(s) === "0 0 80 50") && svgC.every((s) => vb(s) === "0 0 100 70"));
  check("EXP-01/D-4.2 root element: mm width/height equal the page, viewBox in mm",
    svgC.every((s) => /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100mm" height="70mm" viewBox="0 0 100 70">/.test(s)));
  check("AT-07 bonded base outline comes from the material ring (a path), not a page rect",
    (() => { const c = groupOf(svgB[0], "CUT"); return !!c && (c.match(/<path /g) || []).length === 1 && /d="M 0 0 L 80 0 L 80 50 L 0 50 Z"/.test(c); })());
  // ---- EXP-02
  check("EXP-02 FIXED: groups id=CUT #FF0000 and id=SCORE #0000FF, no fill on cuts", svgB.concat(svgC).every((s) =>
    /<g id="CUT" fill="none" stroke="#FF0000" stroke-width="0\.1">/.test(s) && /<g id="SCORE" fill="none" stroke="#0000FF" stroke-width="0\.1">/.test(s) &&
    !/fill="(?!none)/.test(groupOf(s, "CUT")) && (s.match(/<g /g) || []).length === 2));
  check("EXP-02 one <path d=\"M… L… Z\"> per material ring, in material order, coordinates exact", LC.concat(LB).every((l, i) => {
    const s = i < LC.length ? svgC[i] : svgB[i - LC.length], ds = [...groupOf(s, "CUT").matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]), rs = ringsOf(l);
    return ds.length === rs.length && ds.every((d, j) => /^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+)+ Z$/.test(d) &&
      JSON.stringify(nums(d).map((t) => Math.round(Number(t) * 1000))) === JSON.stringify(rs[j])); }));
  check("ASM-04 registration hole rings are cut paths (connected base: outer + 1 hole circle)",
    (groupOf(svgC[0], "CUT").match(/<path /g) || []).length === 2);
  // ---- EXP-03 (pure vector) and legacyTextLabel
  const bad = /<(text|image|style|clipPath|filter)|transform=/;
  check("EXP-03 no transform|clipPath|filter|style|image|text (without legacyTextLabel)", svgB.concat(svgC).every((s) => !bad.test(s)));
  const lab = S.layerSVG(LC[1], pgC, { construction: "connected", legacyTextLabel: "t 1/2 <&>" });
  check("DEP-04 legacyTextLabel emits the v1.1.0 <text> label inside SCORE (escaped), nowhere else",
    /<text x="2" y="68" font-family="monospace" font-size="4" fill="none" stroke="#0000FF" stroke-width="0\.1">t 1\/2 &lt;&amp;&gt;<\/text>/.test(groupOf(lab, "SCORE")) &&
    (lab.match(/<text /g) || []).length === 1);
  // ---- SCORE: polylines only (open paths, no Z)
  const sp = [[10000, 10000, 20000, 10000, 20000, 15500], [0, 0, 1, 1]];
  const sv = S.layerSVG(LB[1], pgB, { scorePaths: sp }), sg = groupOf(sv, "SCORE"), sd = [...sg.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]);
  check("EXP-02 SCORE holds polylines only: one open <path d=\"M… L…\"> per score path, no Z, exact coords",
    sd.length === 2 && sd[0] === "M 10 10 L 20 10 L 20 15.5" && sd[1] === "M 0 0 L 0.001 0.001" && !/Z/.test(sg) && !/<(polygon|rect|circle)/.test(sg));
  check("G1.4 scorePaths default to layer.scorePaths", (() => { const s = S.layerSVG({ ...LB[1], scorePaths: [sp[0]] }, pgB, {});
    return [...groupOf(s, "SCORE").matchAll(/<path /g)].length === 1; })());
  // ---- <desc>: front face, orientation, kerfMode
  const desc = (s) => (s.match(/<desc>([\s\S]*?)<\/desc>/) || [])[1] || "";
  check("D-4.2/MAT-05 <desc> states front face, Y-down not mirrored, kerfMode=external", svgB.concat(svgC).every((s) => {
    const d = desc(s); return /front face/i.test(d) && /Y-down/.test(d) && /not mirrored/.test(d) && /kerfMode=external/.test(d); }) &&
    desc(svgB[1]).includes("front face = layer N−1 (top)") && /construction=connected/.test(desc(svgC[1])) && /layer 1\b/.test(desc(svgC[1])));
  check("NFR-06 <desc> escapes a hostile frontNote", (() => { const s = S.layerSVG(LB[1], pgB, { frontNote: "</desc><script>x</script>" });
    return !/<script/.test(s) && desc(s).includes("&lt;/desc&gt;&lt;script&gt;"); })());
  // ---- AT-12
  const sq = M.fromMasks([new Uint8Array(4).fill(1)], 2, 2, M.page({ artWMM: 100, artHMM: 100, frameMM: 0 }), {});
  const sqs = S.layerSVG(sq[0], M.page({ artWMM: 100, artHMM: 100, frameMM: 0 }), {});
  check("AT-12 100mm square → width=\"100mm\" and coords 0..100", /width="100mm" height="100mm" viewBox="0 0 100 100"/.test(sqs) &&
    (() => { const n = nums([...groupOf(sqs, "CUT").matchAll(/d="([^"]+)"/g)].map((m) => m[1]).join(" ")).map(Number); return Math.min(...n) === 0 && Math.max(...n) === 100; })());
  check("AT-12 304.8 mm (12 in) asymmetric page dims are exact", (() => {
    const P = M.page({ artWMM: 304.8, artHMM: 203.2, frameMM: 0 }), L = M.fromMasks([new Uint8Array(6).fill(1)], 3, 2, P, {});
    return /width="304.8mm" height="203.2mm" viewBox="0 0 304.8 203.2"/.test(S.layerSVG(L[0], P, {})); })());
  // ---- determinism and purity
  check("AT-16 layerSVG is deterministic (byte-identical on repeat)", LC.every((l, k) => S.layerSVG(l, pgC, { ...opts, construction: "connected" }) === svgC[k]));
  check("D4 layerSVG does not mutate the layer (material and canonicalHash = materialHash unchanged)", (() => {
    const l = M.fromMasks(bt.layers, 8, 5, pgC, { frame: true })[1], before = JSON.stringify(l);
    S.layerSVG(l, pgC, { scorePaths: sp, legacyTextLabel: "x" }); return JSON.stringify(l) === before && l.canonicalHash === SBGeom.materialHash(l); })());
  check("empty layer → empty CUT group, still a valid document with both groups", (() => {
    const s = S.layerSVG({ index: 3, material: [], scorePaths: [], holes: [] }, pgB, {});
    return groupOf(s, "CUT").trim() === "" && groupOf(s, "SCORE") !== null && /<\/svg>\s*$/.test(s); })());
  // ---- input guards
  check("GEO-09 layerSVG refuses non-integer coordinates (never rounds silently)",
    throws(() => S.layerSVG({ index: 1, material: [{ outer: [0, 0, 10.5, 0, 10, 10], holes: [] }] }, pgB, {}), /NONINTEGER/) &&
    throws(() => S.layerSVG(LB[1], pgB, { scorePaths: [[0, 0, 1.25, 3]] }), /NONINTEGER/));
  check("NONFINITE layerSVG refuses an invalid page", throws(() => S.layerSVG(LB[1], { wMM: 0, hMM: 5 }, {}), /NONFINITE/) &&
    throws(() => S.layerSVG(LB[1], { wMM: 10.0005, hMM: 5 }, {}), /NONFINITE|NONINTEGER/));
  check("G1.4 legacy shims unchanged (sheetSVG/proofSVG still exported)", typeof S.sheetSVG === "function" && typeof S.proofSVG === "function");
});

// ------------------------------------------------ SVG reader and round trip (G1.5)
suite("svgread.js — SBSvgRead parse and round trip (GEO-09, AT-11/12/13, AT-05; G1.5)", () => {
  const F = require("./fixtures.js"), M = SBMaterial, S = SBSvg, G = SBGeom, R = globalThis.SBSvgRead;
  check("G1.5 API present", !!R && typeof R.parse === "function" && typeof R.toMaterial === "function");
  if (!R || typeof R.parse !== "function" || typeof R.toMaterial !== "function") return;
  check("§4 module order: svgread.js directly after svgout.js", (() => { const L = require("./modules.js").NODE_MODULES; return L.indexOf("svgread.js") === L.indexOf("svgout.js") + 1; })());
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  const ringsOf = (polys) => { const o = []; for (const p of polys) o.push(p.outer, ...p.holes); return o; };
  /** GEO-09: same part count, same ringTopology, ring-by-ring maxDeviationUm ≤ tol (rings of normalized sets pair up in order). */
  const within = (A, B, tol) => A.length === B.length && G.ringTopology(A) === G.ringTopology(B) &&
    A.every((p, i) => p.holes.length === B[i].holes.length) && (() => { const a = ringsOf(A), b = ringsOf(B);
      return a.length === b.length && a.every((r, i) => G.maxDeviationUm(r, b[i], 1) <= tol); })();
  const rebuild = (svg) => R.toMaterial(R.parse(svg).cut);

  // ---- every fixture × {bonded raw, connected smoothed + frame + holes} × {10 mm/px, odd pitch}
  const names = Object.keys(F.MASKS);
  const variants = [];
  for (const name of names) {
    const fx = typeof F.MASKS[name] === "function" ? F.MASKS[name](1) : F.MASKS[name];
    for (const [pw, ph] of [[10, 10], [3.217, 4.093]]) {
      const art = { artWMM: Math.round(fx.w * pw * 1000) / 1000, artHMM: Math.round(fx.h * ph * 1000) / 1000 };
      const pgB = M.page({ ...art, frameMM: 0 }), pgC = M.page({ ...art, frameMM: 5 });
      variants.push({ name, pw, mode: "bonded", pg: pgB, layers: M.fromMasks(fx.layers, fx.w, fx.h, pgB, { smooth: { mode: "bonded", tolUm: 50 } }) });
      variants.push({ name, pw, mode: "connected", pg: pgC, layers: M.fromMasks(fx.layers, fx.w, fx.h, pgC,
        { smooth: { mode: "connected", tolUm: 50 }, frame: true, holes: [{ cxUm: 2500, cyUm: 2500, rUm: 1500 }] }) });
    }
  }
  const failsRT = [], failsExact = [], failsClean = [];
  for (const v of variants) for (const l of v.layers) {
    const svg = S.layerSVG(l, v.pg, { construction: v.mode }), p = R.parse(svg), back = R.toMaterial(p.cut), tag = v.name + "/" + v.mode + "/" + v.pw + "/L" + l.index;
    if (!within(back, l.material, 5)) failsRT.push(tag);
    if (JSON.stringify(back) !== JSON.stringify(l.material)) failsExact.push(tag);
    if (p.unsupported.length || p.score.length || p.cut.length !== ringsOf(l.material).length) failsClean.push(tag + ":" + p.unsupported.join("|"));
  }
  check("GEO-09/AT-11 parse(layerSVG(L)) rebuilt via SBGeom.union equals L.material within 5µm (maxDeviationUm) and same ringTopology, every fixture (" +
    variants.length + " stacks)" + (failsRT.length ? " — " + failsRT.slice(0, 4).join(", ") : ""), failsRT.length === 0);
  check("GEO-09 round trip is exact on the 1 µm grid (rebuilt material deep-equals L.material)" + (failsExact.length ? " — " + failsExact.slice(0, 4).join(", ") : ""), failsExact.length === 0);
  check("AT-13 our own cut files parse clean: no unsupported items, one closed ring per material ring, empty SCORE" + (failsClean.length ? " — " + failsClean.slice(0, 3).join(", ") : ""), failsClean.length === 0);
  check("GEO-09 written winding is the documented one (outer rings positive, holes negative)", (() => {
    const l = variants.find((v) => v.name === "donutIsland" && v.mode === "bonded").layers[1], cut = R.parse(S.layerSVG(l, variants[0].pg, {})).cut;
    const a2 = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a; };
    const signs = ringsOf(l.material).map((r) => Math.sign(a2(r)));
    return cut.length === signs.length && cut.every((r, i) => Math.sign(a2(r)) === signs[i]) && signs.includes(-1) && signs.includes(1); })());
  // ---- SCORE polylines
  check("AT-13 SCORE paths parse as open polylines in µm, separate from CUT", (() => {
    const l = variants[0].layers[1], sp = [[10000, 10000, 20000, 10000, 20000, 15500], [0, 0, 1, 1]];
    const p = R.parse(S.layerSVG(l, variants[0].pg, { scorePaths: sp }));
    return JSON.stringify(p.score) === JSON.stringify(sp) && p.cut.length === ringsOf(l.material).length && p.unsupported.length === 0; })());
  // ---- AT-12 dimensions
  check("AT-12 304.8mm asymmetric artwork dims exact (304.8 × 203.2, viewBox and coordinates unscaled)", (() => {
    const fx = F.MASKS.orientationF, pg = M.page({ artWMM: 304.8, artHMM: 203.2, frameMM: 0 }), L = M.fromMasks(fx.layers, fx.w, fx.h, pg, {});
    const p0 = R.parse(S.layerSVG(L[0], pg, {})), p1 = R.parse(S.layerSVG(L[1], pg, {}));
    const xs = p0.cut.flatMap((r) => r.filter((_, i) => i % 2 === 0)), ys = p0.cut.flatMap((r) => r.filter((_, i) => i % 2 === 1));
    return p0.widthMM === 304.8 && p0.heightMM === 203.2 && JSON.stringify(p0.viewBox) === "[0,0,304.8,203.2]" &&
      Math.min(...xs) === 0 && Math.max(...xs) === 304800 && Math.min(...ys) === 0 && Math.max(...ys) === 203200 &&
      JSON.stringify(R.toMaterial(p1.cut)) === JSON.stringify(L[1].material); })());
  check("AT-12 100 mm calibration square parses to exactly 100 × 100 mm", (() => {
    const pg = M.page({ artWMM: 100, artHMM: 100, frameMM: 0 }), L = M.fromMasks([new Uint8Array(4).fill(1)], 2, 2, pg, {}), p = R.parse(S.layerSVG(L[0], pg, {}));
    return p.widthMM === 100 && p.heightMM === 100 && JSON.stringify(p.cut) === JSON.stringify([[0, 0, 100000, 0, 100000, 100000, 0, 100000]]); })());
  // ---- AT-05 orientation
  check("AT-05 orientationF top-left corner preserved (no mirror)", (() => {
    const fx = F.MASKS.orientationF, pg = M.page({ artWMM: 70, artHMM: 70, frameMM: 0 }), L = M.fromMasks(fx.layers, fx.w, fx.h, pg, {});
    const back = rebuild(S.layerSVG(L[1], pg, {})), at = (px, py) => G.containsPoint(back, [px * 10000 + 5000, py * 10000 + 5000]);
    // F: row 0 = "#####..", column 0 rows 0..5 material, (0,6) void
    return at(0, 0) && at(4, 0) && !at(6, 0) && at(0, 5) && !at(0, 6) && !at(6, 6) && at(3, 2) && !at(4, 2) &&
      G.bbox(back[0])[0] === 0 && G.bbox(back[0])[1] === 0; })());
  // ---- AT-13 unsupported constructs
  const doc = (body, attrs) => '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ' + (attrs || 'width="10mm" height="10mm" viewBox="0 0 10 10"') + ">\n" + body + "\n</svg>\n";
  const cutG = (inner, gAttrs) => '<g id="CUT" fill="none" stroke="#FF0000" stroke-width="0.1"' + (gAttrs || "") + ">" + inner + '</g><g id="SCORE" fill="none" stroke="#0000FF" stroke-width="0.1"></g>';
  const ok = R.parse(doc(cutG('<path d="M 0 0 L 1 0 L 1 1 Z"/>')));
  check("AT-13 minimal absolute M/L/Z cut file parses clean", ok.unsupported.length === 0 && JSON.stringify(ok.cut) === "[[0,0,1000,0,1000,1000]]" && ok.widthMM === 10);
  const rel = R.parse(doc(cutG('<path d="m 0 0 l 1 0 l 0 1 z"/><path d="M 2 2 C 3 3 4 4 5 2 Z"/><path d="M 0 0 H 3 V 3 Z"/><path d="M 0 0 Q 1 1 2 0 A 1 1 0 0 1 3 3 Z"/>')));
  check("AT-13 relative/curve commands reported unsupported", rel.cut.length === 0 &&
    ["m", "l", "z", "C", "H", "V", "Q", "A"].every((c) => rel.unsupported.some((u) => u.includes("command " + c))));
  const open = R.parse(doc(cutG('<path d="M 0 0 L 5 0 L 5 5"/><path d="M 1 1 L 2 1 L 2 2 Z"/>')));
  check("AT-13 open path (no Z) flagged", open.unsupported.some((u) => /OPEN/.test(u)) && open.cut.length === 1 && JSON.stringify(open.cut[0]) === "[1000,1000,2000,1000,2000,2000]");
  const deps = R.parse(doc(cutG('<path d="M 0 0 L 1 0 L 1 1 Z" transform="translate(1 1)"/><rect x="0" y="0" width="1" height="1"/>', ' style="stroke:red"') +
    '<image href="x.png"/><text x="1" y="1">A</text><clipPath id="c"><path d="M 0 0 L 1 0 L 1 1 Z"/></clipPath><path d="M 0 0 L 1 0 L 1 1 Z"/>'));
  check("AT-13 <text>, transform, <rect>, <image>, <clipPath>, style and paths outside CUT/SCORE are reported unsupported",
    [/<text>/, /transform/, /<rect>/, /<image>/, /<clipPath>/, /style/, /outside CUT\/SCORE/].every((re) => deps.unsupported.some((u) => re.test(u))) &&
    deps.cut.length === 0);
  check("AT-13 legacyTextLabel output is flagged (<text> defines a score operation)", (() => {
    const v = variants.find((x) => x.mode === "connected"), p = R.parse(S.layerSVG(v.layers[1], v.pg, { legacyTextLabel: "t 1/2" }));
    return p.unsupported.some((u) => /<text>/.test(u)); })());
  check("AT-13 a closed SCORE path is flagged (score paths are open)", R.parse(doc('<g id="CUT"></g><g id="SCORE"><path d="M 0 0 L 1 0 L 1 1 Z"/></g>')).unsupported.some((u) => /SCORE.*closed/i.test(u)));
  check("D-4.2 units other than mm and a scaled or offset viewBox are flagged",
    R.parse(doc(cutG(""), 'width="10in" height="10in" viewBox="0 0 10 10"')).unsupported.some((u) => /units/.test(u)) &&
    R.parse(doc(cutG(""), 'width="10mm" height="10mm" viewBox="0 0 20 20"')).unsupported.some((u) => /viewBox/.test(u)) &&
    R.parse(doc(cutG(""), 'width="10mm" height="10mm" viewBox="1 0 10 10"')).unsupported.some((u) => /viewBox/.test(u)));
  check("AT-13 degenerate ring (< 3 vertices) and non-finite numbers are flagged",
    R.parse(doc(cutG('<path d="M 0 0 L 1 0 Z"/>'))).unsupported.some((u) => /degenerate/i.test(u)) &&
    R.parse(doc(cutG('<path d="M 0 0 L 1e999 0 L 1 1 Z"/>'))).unsupported.some((u) => /finite/i.test(u)));
  check("GEO-09 implicit lineto after M and a repeated closing vertex are accepted", (() => {
    const p = R.parse(doc(cutG('<path d="M 0,0 1,0 1,1 0,0 Z"/>'))); return p.unsupported.length === 0 && JSON.stringify(p.cut) === "[[0,0,1000,0,1000,1000]]"; })());
  check("parse refuses a document with no <svg> root", throws(() => R.parse("<html></html>"), /SVGREAD_NOT_SVG/));
  check("G1.5 parse is pure and deterministic", (() => { const s = S.layerSVG(variants[1].layers[1], variants[1].pg, {}); return JSON.stringify(R.parse(s)) === JSON.stringify(R.parse(s)); })());
});

// ------------------------------------------------ opaque proof (G1.6)
suite("svgout.js — assemblySVG: opaque proof from material in the shared page frame (GEO-01, MAT-04, UI-02; G1.6)", () => {
  const F = require("./fixtures.js"), M = SBMaterial, S = SBSvg, G = SBGeom;
  check("G1.6 API present", typeof S.assemblySVG === "function");
  if (typeof S.assemblySVG !== "function") return;
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  const ringsOf = (l) => { const o = []; for (const p of l.material) o.push(p.outer, ...p.holes); return o; };
  const vb = (s) => (s.match(/viewBox="([^"]+)"/) || [])[1];
  const paths = (s) => [...s.matchAll(/<path ([^>]*)\/>/g)].map((m) => m[1]);
  const attr = (a, k) => (a.match(new RegExp(k + '="([^"]*)"')) || [])[1];
  /** "M x y L … Z M …" → rings of integer µm. */
  const subRings = (d) => d.split(/(?=M )/).map((sp) => sp.replace(/[MLZ]/g, " ").trim().split(/\s+/).map((t) => Math.round(Number(t) * 1000)));
  const bt = F.MASKS.borderTouch, di = F.MASKS.donutIsland;
  const pgC = M.page({ artWMM: 80, artHMM: 50, frameMM: 10 });
  const LC = M.fromMasks(bt.layers, 8, 5, pgC, { frame: true, holes: [{ cxUm: 5000, cyUm: 5000, rUm: 1500 }] });
  const pgB = M.page({ artWMM: 90, artHMM: 90, frame: { enabled: false, widthMM: 10 } }), LB = M.fromMasks(di.layers, 9, 9, pgB, {});
  const pal = ["#ffffff", "#336699", "#000000", "#cc0000"];
  const pC = S.assemblySVG(LC, pgC, pal), pB = S.assemblySVG(LB, pgB, pal);
  // ---- GEO-01: shared page frame and material authority
  check("GEO-01 FIXED: assemblySVG viewBox == layerSVG viewBox (framed borderTouch, margin 10)",
    vb(pC) === "0 0 100 70" && LC.every((l) => vb(S.layerSVG(l, pgC, {})) === vb(pC)) && vb(pB) === vb(S.layerSVG(LB[0], pgB, {})) &&
    /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100mm" height="70mm" viewBox="0 0 100 70">/.test(pC));
  check("GEO-01 proof path rings == material rings (one evenodd path per non-empty layer, back to front, exact µm)", [[LC, pC], [LB, pB]].every(([L, s]) => {
    const ps = paths(s), nonEmpty = L.filter((l) => l.material.length);
    return ps.length === nonEmpty.length && ps.every((a, j) => attr(a, "fill-rule") === "evenodd" &&
      JSON.stringify(subRings(attr(a, "d"))) === JSON.stringify(ringsOf(nonEmpty[j]))); }));
  check("GEO-01 layers painted back to front by index (input order irrelevant)", S.assemblySVG(LC.slice().reverse(), pgC, pal) === pC);
  check("UI-02 proof carries <!-- proof: not for cutting --> and no CUT/SCORE groups, no <rect>", [pC, pB].every((s) =>
    s.includes("<!-- proof: not for cutting -->") && !/id="(CUT|SCORE)"/.test(s) && !/<rect/.test(s)));
  check("EXP-03 proof is pure vector (no text|image|style|clipPath|filter|transform)", [pC, pB].every((s) => !/<(text|image|style|clipPath|filter)|transform=/.test(s)));
  // ---- MAT-04: appearance never touches geometry
  check("MAT-04 palette fills: layer k is filled with colors[layer.index]", (() => {
    const ps = paths(pC), nonEmpty = LC.filter((l) => l.material.length); return ps.every((a, j) => attr(a, "fill") === pal[nonEmpty[j].index]); })());
  check("MAT-04 proof colors do not change any layer canonicalHash (= SBGeom.materialHash) and do not mutate layers", (() => {
    const L = M.fromMasks(bt.layers, 8, 5, pgC, { frame: true }), before = JSON.stringify(L), h0 = L.map((l) => l.canonicalHash);
    S.assemblySVG(L, pgC, pal); S.assemblySVG(L, pgC, "#808080"); S.assemblySVG(L, pgC, ["#123456", "#abcdef"], { edgeStroke: true });
    return JSON.stringify(L) === before && L.every((l, k) => l.canonicalHash === h0[k] && l.canonicalHash === G.materialHash(l)); })());
  check("MAT-04 changing colors changes only fill/stroke attributes", (() => {
    const strip = (s) => s.replace(/ (fill|stroke(-[a-z]+)?)="[^"]*"/g, "");
    return strip(S.assemblySVG(LC, pgC, "#808080")) === strip(pC) && S.assemblySVG(LC, pgC, "#808080") !== pC; })());
  const uni = S.assemblySVG(LC, pgC, "#808080");
  check("MAT-04 uniform proof strokes layer edges (every layer path has a darker stroke than its fill)", (() => {
    const lum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    const ps = paths(uni); return ps.length > 0 && ps.every((a) => attr(a, "fill") === "#808080" && /^#[0-9a-f]{6}$/.test(attr(a, "stroke") || "") &&
      lum(attr(a, "stroke")) < lum("#808080") && Number(attr(a, "stroke-width")) > 0); })());
  check("MAT-04 a palette array of one repeated color counts as uniform (stroked)",
    paths(S.assemblySVG(LC, pgC, ["#808080", "#808080", "#808080"])).every((a) => !!attr(a, "stroke")));
  check("MAT-04 palette proof has no edge stroke by default; {edgeStroke} overrides both ways",
    paths(pC).every((a) => !attr(a, "stroke")) && paths(S.assemblySVG(LC, pgC, pal, { edgeStroke: true })).every((a) => !!attr(a, "stroke")) &&
    paths(S.assemblySVG(LC, pgC, "#808080", { edgeStroke: false })).every((a) => !attr(a, "stroke")));
  // ---- determinism and guards
  check("AT-16 assemblySVG is deterministic (byte-identical on repeat)", S.assemblySVG(LC, pgC, pal) === pC);
  check("empty stack → valid document with no paths", (() => { const s = S.assemblySVG([], pgB, pal); return paths(s).length === 0 && /<\/svg>\s*$/.test(s) && vb(s) === "0 0 90 90"; })());
  check("NFR-06 assemblySVG refuses a non-hex color (no attribute injection)",
    throws(() => S.assemblySVG(LC, pgC, ['#fff" onload="x', "#000"]), /COLOR/) && throws(() => S.assemblySVG(LC, pgC, "red"), /COLOR/) &&
    throws(() => S.assemblySVG(LC, pgC, ["#fff"]), /COLOR/));
  check("GEO-09 assemblySVG refuses non-integer coordinates and an invalid page",
    throws(() => S.assemblySVG([{ index: 0, material: [{ outer: [0, 0, 10.5, 0, 10, 10], holes: [] }] }], pgB, "#808080"), /NONINTEGER/) &&
    throws(() => S.assemblySVG(LB, { wMM: 0, hMM: 5 }, "#808080"), /NONFINITE/));
  check("G1.6 legacy proofSVG shim still exported (frozen by T0.7)", typeof S.proofSVG === "function");
});

// ------------------------------------------------ connected export through the canonical path (G1.7)
suite("engine.js — connected export through the canonical path (DEP-04, GEO-02, AT-06/11/12; G1.7)", () => {
  const E = SBEngine, M = SBMaterial, S = SBSvg, G = SBGeom, R = SBSvgRead;
  check("G1.7 API present", typeof E.connectedLayers === "function" && typeof E.connectedFiles === "function");
  if (typeof E.connectedLayers !== "function" || typeof E.connectedFiles !== "function") return;
  const root = path.join(__dirname, "..");
  const GC = require("./golden/oldrun.json").cfg;
  const w = 40, h = 30, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = ((i % w) * 6 + Math.floor(i / w) * 3) % 256; rgba.set([v, v, v, 255], i * 4); }
  const cfgOf = (o) => Object.assign({}, GC, { projectName: "demo <&>", holes: true, holeDiaMM: 4 }, o || {});
  const ringsOf = (polys) => { const o = []; for (const p of polys) o.push(p.outer, ...p.holes); return o; };
  const groupOf = (svg, id) => { const m = svg.match(new RegExp('<g id="' + id + '"[^>]*>([\\s\\S]*?)</g>')); return m ? m[1] : null; };
  const vb = (s) => (s.match(/viewBox="([^"]+)"/) || [])[1];
  const run = (o) => { const cfg = cfgOf(o), r = E.legacyRun(rgba, w, h, cfg); return { cfg, sheets: r.sheets }; };
  const colors = ["#dceff7", "#8fc3e4", "#3f7cc0", "#1d3f7e", "#0c1b3d"];

  for (const corner of ["faceted", "smooth"]) {
    const { cfg, sheets } = run({ cornerStyle: corner });
    const C = E.connectedLayers(sheets, w, h, cfg), files = E.connectedFiles(sheets, w, h, cfg, colors);
    const byName = new Map(files.map((f) => [f.name, f.data]));
    const P = C.page, WU = Math.round(P.wMM * 1000), HU = Math.round(P.hMM * 1000), fU = Math.round(cfg.marginMM * 1000);
    const tag = " [" + corner + "]";
    check("G1.7 page: art = widthMM × (h·widthMM/w), frame = marginMM, on the 1 µm grid" + tag,
      P.artWMM === 120 && P.artHMM === 90 && P.frameMM === 12 && P.wMM === 144 && P.hMM === 114);
    check("G1.7 one MaterialLayer per legacy sheet, index = sheet number − 1" + tag,
      C.layers.length === sheets.length && C.layers.every((l, k) => l.index === k && l.canonicalHash === G.materialHash(l)));
    // ---- G1 E2E round trip
    const back = C.layers.map((l) => R.toMaterial(R.parse(byName.get("sheet_" + String(l.index + 1).padStart(2, "0") + ".svg")).cut));
    check("G1 E2E connected: legacyRun → fromMasks → layerSVG → parse → union equals material" + tag,
      C.layers.every((l, k) => JSON.stringify(back[k]) === JSON.stringify(l.material) &&
        G.ringTopology(back[k]) === G.ringTopology(l.material)));
    check("G1 E2E cut files carry nothing unsupported but the legacy label, no open cut paths" + tag, C.layers.every((l) => {
      const p = R.parse(byName.get("sheet_" + String(l.index + 1).padStart(2, "0") + ".svg"));
      return p.cut.length === ringsOf(l.material).length && p.unsupported.every((u) => /text/.test(u)); }));
    // ---- GEO-02: the frame is attached material on every layer
    const frame = { outer: [0, 0, WU, 0, WU, HU, 0, HU], holes: [[fU, fU, fU, HU - fU, WU - fU, HU - fU, WU - fU, fU]] };
    const holeCircles = C.layers[0].holes.map((x) => G.circle(x.cxUm, x.cyUm, x.rUm));
    check("GEO-02 connected export: every layer contains the whole frame ring (minus the corner holes)" + tag,
      C.layers.every((l) => G.isEmpty(G.difference(G.difference([frame], holeCircles), l.material))));
    check("GEO-02 connected export: every layer is one part whose outer ring is the page rectangle" + tag,
      C.layers.every((l) => l.material.filter((p) => G.bbox(p).join() === [0, 0, WU, HU].join()).length === 1));
    check("AT-07 connected backing is solid: page rectangle minus the four holes" + tag,
      JSON.stringify(C.layers[0].material) === JSON.stringify(G.normalize(G.difference([{ outer: [0, 0, WU, 0, WU, HU, 0, HU], holes: [] }], holeCircles))));
    // ---- DEP-04 holes
    const inset = Math.round(fU / 2), rU = 2000;
    const expect = [[inset, inset], [WU - inset, inset], [inset, HU - inset], [WU - inset, HU - inset]]
      .map(([x, y]) => ({ cxUm: x, cyUm: y, rUm: rU })).sort((a, b) => (a.cyUm - b.cyUm) || (a.cxUm - b.cxUm));
    check("DEP-04 connected export keeps 4 corner holes at v1.1.0 positions when holes on" + tag,
      C.layers.every((l) => JSON.stringify(l.holes) === JSON.stringify(expect)));
    check("ASM-04 every corner hole is a cut ring equal to SBGeom.circle in every sheet file" + tag, C.layers.every((l) => {
      const cut = R.parse(byName.get("sheet_" + String(l.index + 1).padStart(2, "0") + ".svg")).cut.map((r) => JSON.stringify(r));
      return expect.every((x) => { const c = G.normalize(G.difference([{ outer: [0, 0, WU, 0, WU, HU, 0, HU], holes: [] }], [G.circle(x.cxUm, x.cyUm, x.rUm)]))[0].holes[0];
        return cut.includes(JSON.stringify(c)); }); }));
    // ---- DEP-04 label
    check("DEP-04 connected export keeps the sheet label (v1.1.0 text, inside SCORE)" + tag, C.layers.every((l, k) => {
      const s = byName.get("sheet_" + String(k + 1).padStart(2, "0") + ".svg");
      return new RegExp('<text x="2" y="112" font-family="monospace" font-size="4" fill="none" stroke="#0000FF" stroke-width="0\\.1">demo &lt;&amp;&gt; ' + (k + 1) + "/" + sheets.length + "</text>").test(groupOf(s, "SCORE")) &&
        (s.match(/<text /g) || []).length === 1; }));
    // ---- files
    check("G1.7 legacy filenames: sheet_NN.svg per layer, then proof.svg" + tag,
      JSON.stringify(files.map((f) => f.name)) === JSON.stringify(sheets.map((_, k) => "sheet_" + String(k + 1).padStart(2, "0") + ".svg").concat(["proof.svg"])));
    check("G1.7 sheet files are layerSVG (CUT/SCORE groups, no <rect>, shared viewBox)" + tag, C.layers.every((l, k) => {
      const s = byName.get("sheet_" + String(k + 1).padStart(2, "0") + ".svg");
      return s === S.layerSVG(l, P, { construction: "connected", legacyTextLabel: "demo <&> " + (k + 1) + "/" + sheets.length }) &&
        /<g id="CUT"/.test(s) && /<g id="SCORE"/.test(s) && !/<rect/.test(s) && vb(s) === "0 0 144 114"; }));
    check("GEO-01 proof.svg is assemblySVG in the same page frame as the cuts" + tag,
      byName.get("proof.svg") === S.assemblySVG(C.layers, P, colors) && vb(byName.get("proof.svg")) === "0 0 144 114");
    check("AT-16 connected export is deterministic" + tag,
      JSON.stringify(E.connectedFiles(sheets, w, h, cfg, colors)) === JSON.stringify(files));
  }

  // ---- smoothing: connected mode, bounded, only for cornerStyle "smooth". The masks come from the 3 mm/px run; the
  // export is re-scaled to 100 µm/px (widthMM 4, margin 1) because at 3 mm/px no corner can round within 50 µm (S2 F3).
  const fac = run({ cornerStyle: "faceted" }), fine = { widthMM: 4, marginMM: 1, holeDiaMM: 0.5 };
  fac.cfg = Object.assign({}, fac.cfg, fine);
  const smo = { sheets: fac.sheets, cfg: Object.assign({}, fac.cfg, { cornerStyle: "smooth" }) };
  const Lf = E.connectedLayers(fac.sheets, w, h, fac.cfg).layers, Ls = E.connectedLayers(smo.sheets, w, h, smo.cfg).layers;
  const raw = (s, cfg) => { const P = E.connectedLayers(s, w, h, cfg).page;
    return M.fromMasks(s.map((x, k) => (k ? x.mask : new Uint8Array(w * h).fill(1))), w, h, P, { frame: true }).map((l) => l.material); };
  check("D1 faceted connected export is the raw lattice contour (no smoothing)",
    (() => { const r = raw(fac.sheets, fac.cfg), hc = Lf[0].holes.map((x) => G.circle(x.cxUm, x.cyUm, x.rUm));
      return Lf.every((l, k) => JSON.stringify(l.material) === JSON.stringify(G.normalize(G.difference(r[k], hc)))); })());
  check("GEO-04 smooth connected export is smoothed (differs from faceted) and keeps the layer topology",
    Ls.some((l, k) => JSON.stringify(l.material) !== JSON.stringify(Lf[k].material)) &&
    Ls.every((l, k) => G.ringTopology(l.material) === G.ringTopology(Lf[k].material)));
  check("GEO-04 smooth connected export deviates from the raw contour by ≤ 50 µm (+1 µm rounding) per ring",
    Ls.every((l, k) => { const a = ringsOf(l.material), b = ringsOf(Lf[k].material); return a.length === b.length && a.every((r, i) => G.maxDeviationUm(r, b[i], 1) <= 51); }));

  // ---- holes off, margin 0
  { const { cfg, sheets } = run({ holes: false }), C = E.connectedLayers(sheets, w, h, cfg), fs2 = E.connectedFiles(sheets, w, h, cfg, colors);
    check("DEP-04 holes off → no holes in any layer or file", C.layers.every((l) => l.holes.length === 0) &&
      fs2.slice(0, -1).every((f) => R.parse(f.data).cut.length === C.layers[fs2.indexOf(f)].material.reduce((a, p) => a + 1 + p.holes.length, 0))); }
  { const { cfg, sheets } = run({ marginMM: 0 }), C = E.connectedLayers(sheets, w, h, cfg);
    check("DEP-04 margin 0 → no frame and no holes even with holes on (v1.1.0: holes live in the frame)",
      C.page.frameMM === 0 && C.page.wMM === 120 && C.layers.every((l) => l.holes.length === 0) &&
      JSON.stringify(C.layers[0].material) === JSON.stringify([{ outer: [0, 0, 120000, 0, 120000, 90000, 0, 90000], holes: [] }])); }

  // ---- app wiring and release
  const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8"), html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const bad = app.slice(app.indexOf("async function buildAndDeliver"), app.indexOf("async function deliverFile"));
  check("G1.7 → alpha.2 buildAndDeliver writes the fabrication snapshot (SBEngine.fabricationFiles), not the legacy shims or the draft run",
    /SBEngine\.fabricationFiles\(/.test(bad) && !/SBEngine\.connectedFiles\(/.test(bad) && !/sheetSVG|proofSVG/.test(bad) && !/SBSvg\.(sheetSVG|proofSVG)/.test(app));
  check("G1.7 → G2.12 preview badge retired: the preview is drawn from the canonical polygons (preview.setSnapshot)",
    !(app + html).includes("Draft preview: cut files come from polygons") && /preview\.setSnapshot\(/.test(app));
  check("DEP-02 release 2.0.0-alpha.4 (APP_VERSION; alpha.3 until speed round F18)", /const APP_VERSION\s*=\s*"2\.0\.0-alpha\.4"/.test(app));
  const cl = fs.readFileSync(path.join(root, "docs/CHANGELOG.md"), "utf8"), sec = (cl.split(/^## v2\.0\.0-alpha\.1\b.*$/m)[1] || "").split(/^## /m)[0];
  check("DEP-04 CHANGELOG v2.0.0-alpha.1 lists the intentional connected-mode changes",
    /frame/i.test(sec) && /CUT/.test(sec) && /SCORE/.test(sec) && /proof/i.test(sec) && /0\.05 mm/.test(sec) && /holes/i.test(sec) && /label/i.test(sec));
});

// ------------------------------------------------ height.js (G2.3)
suite("height.js — quantization (D-4.3, AT-03/04)", () => {
  check("AT-03 N=5 h∈{0,.25,.5,.75,1} → added {0..4}", [0, .25, .5, .75, 1].map((h) => SBHeight.addedFromNorm(h, 5)).join() === "0,1,2,3,4");
  check("AT-03 ties .125/.375/.625/.875 go to the higher layer", [.125, .375, .625, .875].map((h) => SBHeight.addedFromNorm(h, 5)).join() === "1,2,3,4");
  check("AT-03 N=1 base only", SBHeight.addedFromNorm(1, 1) === 0);
  check("D-4.3 boundaries exposed", SBHeight.boundaries(5, 6.35).map((b) => b.norm).join() === "0.125,0.375,0.625,0.875");
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  let ok = true; for (let N = 1; N <= 16; N++) { const a = SBHeight.addedFromSamples(s, N, "white-high");
    for (let i = 0; i < 256; i++) if (a[i] !== (N === 1 ? 0 : Math.min(N - 1, Math.floor((N - 1) * (i / 255) + 0.5)))) ok = false; }
  check("D-4.3 integer formula == float definition for all N, all samples", ok);
  check("D-4.3 black-high inverts", SBHeight.addedFromSamples(Uint8Array.of(0), 5, "black-high")[0] === 4);
  const w16 = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(new Uint8Array(12).fill(255), 16, "white-high"), null, 16, 4, 3);
  check("AT-04 white N=16 → 16 identical layers, no NaN", w16.length === 16 && w16.every((m) => m.every((v) => v === 1)));
  const b = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(new Uint8Array(12), 5, "white-high"), null, 5, 4, 3);
  check("AT-04 black → base only", b[0].every((v) => v) && b.slice(1).every((m) => m.every((v) => !v)));
  const mid = SBHeight.addedFromSamples(new Uint8Array(12).fill(128), 5, "white-high");
  check("AT-04 constant midpoint map stays constant", mid.every((v) => v === mid[0]));
  const dom = Uint8Array.from([1, 0, 1, 0]);
  const dm = SBHeight.cumulativeMasks(Uint8Array.from([4, 4, 4, 4]), dom, 5, 4, 1);
  check("IMG-04/AT-05 outside A only base", dm[0].every((v) => v) && dm[4].join() === "1,0,1,0");
});

suite("height.js — G2.3 extended (module order, boundaries in mm, tonal equivalence, nesting)", () => {
  const L = require("./modules.js").NODE_MODULES;
  check("§4 module order: height.js after jpeg.js, before raster.js", L.indexOf("height.js") === L.indexOf("jpeg.js") + 1 && L.indexOf("raster.js") === L.indexOf("height.js") + 1);
  const bd = SBHeight.boundaries(5, 6.35);
  check("LYR-02 boundaries carry k and mm = k·t", bd.map((x) => x.k).join() === "1,2,3,4" && bd.every((x) => Math.abs(x.mm - x.k * 6.35) < 1e-12));
  check("D-4.3 N=1 has no boundaries; N=2 boundary at 0.5", SBHeight.boundaries(1, 3).length === 0 && SBHeight.boundaries(2, 3)[0].norm === 0.5);
  check("D-4.3 N=1 samples → all zero", SBHeight.addedFromSamples(Uint8Array.of(0, 128, 255), 1, "white-high").every((v) => v === 0));
  check("D-4.3 addedFromSamples output length and type", (() => { const a = SBHeight.addedFromSamples(new Uint8Array(7), 4, "white-high"); return a instanceof Uint8Array && a.length === 7; })());
  check("D-4.3 black-high == white-high on 255-s, every N", (() => { const s2 = Uint8Array.from({ length: 256 }, (_, i) => i), r = s2.map((v) => 255 - v);
    for (let N = 1; N <= 16; N++) if (SBHeight.addedFromSamples(s2, N, "black-high").join() !== SBHeight.addedFromSamples(r, N, "white-high").join()) return false; return true; })());
  check("D-4.3 midpoint 127.5 (norm .5) at N=2: 127→0, 128→1", SBHeight.addedFromSamples(Uint8Array.of(127, 128), 2, "white-high").join() === "0,1");
  check("D-4.3 samples agree with addedFromNorm(s/255) for N 1..16", (() => { for (let N = 1; N <= 16; N++) for (let v = 0; v < 256; v++)
    if (SBHeight.addedFromSamples(Uint8Array.of(v), N, "white-high")[0] !== SBHeight.addedFromNorm(v / 255, N)) return false; return true; })());
  // masks are nested (D-4.5 containment by construction) and there are always N of them (D-4.7: no dedup)
  const rnd = (() => { let x = 12345; return () => (x = (x * 1103515245 + 12345) >>> 0) / 4294967296; })();
  const W = 9, Hh = 7, sm = Uint8Array.from({ length: W * Hh }, () => Math.floor(rnd() * 256));
  const ms = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(sm, 6, "white-high"), null, 6, W, Hh);
  check("D-4.5 cumulative masks nest: m[k] ⊆ m[k-1]", ms.length === 6 && ms.every((m, k) => k === 0 || m.every((v, i) => !v || ms[k - 1][i])));
  check("D-4.7 masks are 0/1 Uint8Array of w·h", ms.every((m) => m instanceof Uint8Array && m.length === W * Hh && m.every((v) => v === 0 || v === 1)));
  check("IMG-04 domain null == all-ones domain", (() => { const a = SBHeight.addedFromSamples(sm, 6, "white-high"), one = new Uint8Array(W * Hh).fill(1);
    const x = SBHeight.cumulativeMasks(a, null, 6, W, Hh), y = SBHeight.cumulativeMasks(a, one, 6, W, Hh); return x.every((m, k) => m.join() === y[k].join()); })());
  // tonalAdded + cumulativeMasks reproduces SBRaster.sheetMasks byte for byte (the G2.4 rewiring contract)
  check("D-4.4 tonalAdded+cumulativeMasks == SBRaster.sheetMasks (both fronts, N 1..16)", (() => {
    for (let N = 1; N <= 16; N++) for (const dark of [false, true]) {
      const bm = Uint8Array.from(sm, (v) => Math.floor((v * N) / 256));
      const a = SBHeight.cumulativeMasks(SBHeight.tonalAdded(bm, N, dark), null, N, W, Hh), r = SBRaster.sheetMasks(bm, N, W, Hh, dark);
      if (a.length !== r.length || a.some((m, k) => m.join() !== Array.from(r[k]).join())) return false;
    } return true; })());
});

// ------------------------------------------------ raster.js tonal path (G2.4)
suite("raster.js — G2.4 tonal path: manual thresholds, domain-aware statistics, emptyBands (LYR-03, IMG-04/06, AT-04/05/21)", () => {
  const W = 23, Hh = 17, n = W * Hh;
  const grad = Float32Array.from({ length: n }, (_, i) => ((i % W) * 255) / (W - 1));
  const rnd = (() => { let x = 777; return () => (x = (x * 1103515245 + 12345) >>> 0) / 4294967296; })();
  const noisy = Float32Array.from({ length: n }, () => Math.floor(rnd() * 256));
  const dom = Uint8Array.from({ length: n }, (_, i) => ((i % W) + Math.floor(i / W)) % 3 !== 0 ? 1 : 0);
  const alter = (L) => Float32Array.from(L, (v, i) => (dom[i] ? v : (v * 7 + 91) % 256));
  const code = (f) => { try { f(); return null; } catch (e) { return e.code; } };
  // LYR-03 manual
  const tm = SBRaster.thresholds(grad, 5, "manual", { manual: [0.2, 0.4, 0.6, 0.8] });
  check("LYR-03 manual thresholds honored (normalized × 255)", Array.from(tm).join() === "51,102,153,204");
  check("LYR-03 manual thresholds drive the bands", (() => { const b = SBRaster.bands(Float32Array.of(50, 51, 101, 102, 203, 204, 255), tm); return b.join() === "0,1,1,2,3,4,4"; })());
  check("LYR-03 descending manual thresholds rejected (THRESHOLD_ORDER)", code(() => SBRaster.thresholds(grad, 4, "manual", { manual: [0.5, 0.4, 0.6] })) === "THRESHOLD_ORDER");
  check("LYR-03 manual wrong count / out of range / non-finite rejected (THRESHOLD_ARG)",
    code(() => SBRaster.thresholds(grad, 4, "manual", { manual: [0.1, 0.2] })) === "THRESHOLD_ARG" &&
    code(() => SBRaster.thresholds(grad, 3, "manual", { manual: [-0.1, 0.5] })) === "THRESHOLD_ARG" &&
    code(() => SBRaster.thresholds(grad, 3, "manual", { manual: [0.5, 1.01] })) === "THRESHOLD_ARG" &&
    code(() => SBRaster.thresholds(grad, 3, "manual", { manual: [0.5, NaN] })) === "THRESHOLD_ARG" &&
    code(() => SBRaster.thresholds(grad, 3, "manual")) === "THRESHOLD_ARG");
  check("DEP-04 unrecognised mode keeps the v1.1.0 balanced fallback", Array.from(SBRaster.thresholds(noisy, 4, "median")).join() === Array.from(SBRaster.thresholds(noisy, 4, "balanced")).join());
  // IMG-06 / AT-04 flat and duplicate thresholds
  const flat = new Float32Array(n).fill(128), tf = SBRaster.thresholds(flat, 5, "balanced");
  check("IMG-06 flat 128 image N=5 balanced: thresholds finite and emptyBands.length === 4", tf.length === 4 && tf.every(Number.isFinite) && Array.isArray(tf.emptyBands) && tf.emptyBands.length === 4);
  check("IMG-06 flat 128 image N=5 linear: thresholds finite, emptyBands surfaced", (() => { const t = SBRaster.thresholds(flat, 5, "linear"); return t.every(Number.isFinite) && t.emptyBands.length === 4; })());
  check("AT-04 duplicate tonal thresholds → emptyBands non-empty", SBRaster.thresholds(grad, 5, "manual", { manual: [0.2, 0.5, 0.5, 0.8] }).emptyBands.join() === "2");
  check("IMG-06 gradient balanced has no empty bands", SBRaster.thresholds(grad, 5, "balanced").emptyBands.length === 0);
  check("IMG-06 emptyBands are in-domain counts: band 4 empty when only the domain lacks bright pixels", (() => {
    const L = Float32Array.from(grad, (v, i) => (dom[i] ? Math.min(v, 100) : 255));
    return SBRaster.thresholds(L, 5, "manual", { manual: [0.1, 0.2, 0.3, 0.9], domain: dom }).emptyBands.join() === "4" &&
      SBRaster.thresholds(L, 5, "manual", { manual: [0.1, 0.2, 0.3, 0.9] }).emptyBands.length === 0; })());
  check("IMG-04 empty domain: thresholds finite, every band empty", (() => { const t = SBRaster.thresholds(grad, 4, "balanced", { domain: new Uint8Array(n) });
    return t.every(Number.isFinite) && t.emptyBands.join() === "0,1,2,3"; })());
  // IMG-04 / AT-05 domain-aware statistics
  check("IMG-04 tonal thresholds unchanged when out-of-domain pixels are altered", ["balanced", "linear"].every((m) => {
    const a = SBRaster.thresholds(noisy, 6, m, { domain: dom }), b = SBRaster.thresholds(alter(noisy), 6, m, { domain: dom });
    return Array.from(a).join() === Array.from(b).join() && a.emptyBands.join() === b.emptyBands.join(); }));
  check("IMG-04 domain changes the statistics (out-of-domain pixels excluded)", (() => {
    const L = Float32Array.from(noisy, (v, i) => (dom[i] ? v : 0));
    return Array.from(SBRaster.thresholds(L, 6, "balanced", { domain: dom })).join() !== Array.from(SBRaster.thresholds(L, 6, "balanced")).join(); })());
  check("DEP-04 domain null and all-ones domain give v1.1.0 thresholds", ["balanced", "linear"].every((m) => {
    const a = SBRaster.thresholds(noisy, 6, m), b = SBRaster.thresholds(noisy, 6, m, { domain: null }), c = SBRaster.thresholds(noisy, 6, m, { domain: new Uint8Array(n).fill(1) });
    return Array.from(a).join() === Array.from(b).join() && Array.from(a).join() === Array.from(c).join(); }));
  check("IMG-04 domain length mismatch rejected (THRESHOLD_ARG)", code(() => SBRaster.thresholds(noisy, 3, "balanced", { domain: new Uint8Array(3) })) === "THRESHOLD_ARG");
  // IMG-04 kuwahara
  const ka = SBRaster.kuwahara(noisy, W, Hh, 2, 2, dom), kb = SBRaster.kuwahara(alter(noisy), W, Hh, 2, 2, dom);
  check("IMG-04 kuwahara: in-domain output unchanged when out-of-domain pixels are altered", ka.every((v, i) => !dom[i] || v === kb[i]));
  check("IMG-04 kuwahara: out-of-domain pixels left unchanged", ka.every((v, i) => dom[i] || v === noisy[i]));
  check("IMG-04 kuwahara: all-ones domain == no domain (v1.1.0)", (() => { const a = SBRaster.kuwahara(noisy, W, Hh, 3, 2), b = SBRaster.kuwahara(noisy, W, Hh, 3, 2, new Uint8Array(n).fill(1));
    return a.every((v, i) => v === b[i]); })());
  check("IMG-04 kuwahara: domain output stays in the in-domain value range", (() => {
    let lo = 255, hi = 0; for (let i = 0; i < n; i++) if (dom[i]) { lo = Math.min(lo, noisy[i]); hi = Math.max(hi, noisy[i]); }
    const L = Float32Array.from(noisy, (v, i) => (dom[i] ? v : 1e6)), k = SBRaster.kuwahara(L, W, Hh, 2, 1, dom);
    return k.every((v, i) => !dom[i] || (v >= lo - 1e-3 && v <= hi + 1e-3)); })());
  // sheetMasks rewired through SBHeight
  check("D-4.4 sheetMasks delegates to SBHeight.tonalAdded + cumulativeMasks", /SBHeight\.cumulativeMasks\(\s*SBHeight\.tonalAdded\(/.test(SBRaster.sheetMasks.toString()));
});

suite("raster.js — G2.0 deterministic resampling and the raster contract, fabRaster (IMG-02/03, GEO-06, NFR-05, PO-LASER-4/5)", () => {
  const R = SBRaster, F = require("./fixtures.js");
  const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code || "UNCODED:" + e.message; } };
  check("G2.0 SBRaster exposes resample, rasterSize, fabRaster, resamplePolicy, scaleUm, fabDiagnostics, cacheKey",
    ["resample", "rasterSize", "fabRaster", "resamplePolicy", "scaleUm", "fabDiagnostics", "cacheKey"].every((k) => typeof R[k] === "function"));
  if (typeof R.resample !== "function" || typeof R.fabRaster !== "function") return;

  // ---- resample
  const ramp = new Uint8Array(256 * 3); for (let y = 0; y < 3; y++) for (let x = 0; x < 256; x++) ramp[y * 256 + x] = x;
  const near = R.resample(ramp, 1, 256, 3, 37, 2, "nearest"), inSet = new Set(ramp);
  check("IMG-03 height nearest: output values ⊆ input values", near.length === 74 && [...near].every((v) => inSet.has(v)));
  check("IMG-03 nearest uses sx = floor((2x+1)·w / (2W))", [...near.slice(0, 37)].every((v, x) => v === Math.floor((2 * x + 1) * 256 / 74)));
  { const rnd = F.lcg(2001), img = new Uint8Array(23 * 17 * 4); for (let i = 0; i < img.length; i++) img[i] = Math.floor(rnd() * 256);
    const id = R.resample(img, 4, 23, 17, 23, 17, "none");
    check("IMG-02 none is the identity (a copy, not the same buffer)", id instanceof Uint8Array && id !== img && id.length === img.length && id.every((v, i) => v === img[i]));
    check("IMG-02 nearest and area at the same size are the identity",
      R.resample(img, 4, 23, 17, 23, 17, "nearest").every((v, i) => v === img[i]) && R.resample(img, 4, 23, 17, 23, 17, "area").every((v, i) => v === img[i]));
    check("IMG-02 none with a different size throws RESAMPLE_SIZE", codeOf(() => R.resample(img, 4, 23, 17, 20, 17, "none")) === "RESAMPLE_SIZE"); }
  // exact rational oracle for the area average (BigInt, half-up)
  const areaOracle = (px, c, w, h, W, H) => {
    const out = new Uint8Array(W * H * c), ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) for (let k = 0; k < c; k++) {
      let s = 0n;
      for (let y = 0; y < h; y++) { const wy = ov(Y * h, (Y + 1) * h, y * H, (y + 1) * H); if (!wy) continue;
        for (let x = 0; x < w; x++) { const wx = ov(X * w, (X + 1) * w, x * W, (x + 1) * W); if (wx) s += BigInt(px[(y * w + x) * c + k] * wx * wy); } }
      const D = BigInt(w * h); out[(Y * W + X) * c + k] = Number((2n * s + D) / (2n * D));
    }
    return out;
  };
  { const rnd = F.lcg(2002); let ok = true, rep = true;
    for (let t = 0; t < 40 && ok; t++) {
      const c = [1, 3, 4][t % 3], w = 1 + Math.floor(rnd() * 29), h = 1 + Math.floor(rnd() * 23), W = 1 + Math.floor(rnd() * w), H = 1 + Math.floor(rnd() * h);
      const px = new Uint8Array(w * h * c); for (let i = 0; i < px.length; i++) px[i] = Math.floor(rnd() * 256);
      const a = R.resample(px, c, w, h, W, H, "area"), o = areaOracle(px, c, w, h, W, H);
      ok = a.length === o.length && a.every((v, i) => v === o[i]);
      rep = rep && R.resample(px, c, w, h, W, H, "area").every((v, i) => v === a[i]);
    }
    check("NFR-05 area on gray is integer-exact and repeatable (40 random sizes/channels vs exact BigInt oracle)", ok && rep); }
  { const px = new Uint8Array([0, 1, 0, 1]);
    check("NFR-05 area rounds half up (0,1 → 1; 0,0,0,1 → 0)", R.resample(px.subarray(0, 2), 1, 2, 1, 1, 1, "area")[0] === 1 && R.resample(new Uint8Array([0, 0, 0, 1]), 1, 4, 1, 1, 1, "area")[0] === 0); }
  check("RESAMPLE_UPSAMPLE thrown for W > w", codeOf(() => R.resample(new Uint8Array(4), 1, 2, 2, 3, 2, "nearest")) === "RESAMPLE_UPSAMPLE");
  check("RESAMPLE_UPSAMPLE thrown for H > h (area)", codeOf(() => R.resample(new Uint8Array(4), 1, 2, 2, 2, 3, "area")) === "RESAMPLE_UPSAMPLE");
  check("G2.0 resample rejects unknown methods, bad sizes and short buffers",
    codeOf(() => R.resample(new Uint8Array(4), 1, 2, 2, 1, 1, "bilinear")) === "RESAMPLE_METHOD" &&
    codeOf(() => R.resample(new Uint8Array(4), 1, 2, 2, 0, 1, "area")) === "RESAMPLE_SIZE" &&
    codeOf(() => R.resample(new Uint8Array(4), 1, 2, 2.5, 1, 1, "area")) === "RESAMPLE_SIZE" &&
    codeOf(() => R.resample(new Uint8Array(3), 1, 2, 2, 1, 1, "area")) === "RESAMPLE_SIZE");
  check("G2.0 resample does not mutate its input", (() => { const p = new Uint8Array([9, 8, 7, 6]), q = p.slice(); R.resample(p, 1, 4, 1, 2, 1, "area"); R.resample(p, 1, 4, 1, 3, 1, "nearest"); return p.every((v, i) => v === q[i]); })());

  // ---- rasterSize (draft)
  const rs = R.rasterSize;
  check("LYR-06 rasterSize draft 720 long side, never larger than the source",
    JSON.stringify(rs(4000, 3000, 720)) === JSON.stringify({ W: 720, H: 540, capped: false }) &&
    JSON.stringify(rs(3000, 4000, 720)) === JSON.stringify({ W: 540, H: 720, capped: false }) &&
    JSON.stringify(rs(200, 150, 720)) === JSON.stringify({ W: 200, H: 150, capped: true }) &&
    JSON.stringify(rs(720, 10, 720)) === JSON.stringify({ W: 720, H: 10, capped: false }) &&
    JSON.stringify(rs(10000, 1, 720)) === JSON.stringify({ W: 720, H: 1, capped: false }));
  check("NFR-05 rasterSize rounds the short side half up in integers (1000×333 → 720×240, 999×1 → 720×1)",
    rs(1000, 333, 720).H === 240 && rs(999, 1, 720).H === 1 && rs(1001, 501, 720).H === 360);

  // ---- fabRaster
  const fab = (artWUm, artHUm, srcW, srcH, pxBudget, targetPitchUm = 100) => R.fabRaster({ artWUm, artHUm, srcW, srcH, targetPitchUm, pxBudget });
  const tiny = fab(400000, 300000, 200, 150, 16e6);
  check("GEO-06/PO-LASER-5 never upsamples: 200×150 source, 400×300 mm at 0.1 mm/px → 200×150, capped \"source\", shortPx [3800, 2850]",
    tiny.W === 200 && tiny.H === 150 && tiny.pitchUm === 100 && tiny.capped === "source" && JSON.stringify(tiny.shortPx) === "[3800,2850]");
  { const s = R.scaleUm(400000, 300000, tiny.W, tiny.H);
    check("GEO-06 mmPerPx uses the real raster after capping (2.0 mm/px)", s.sxUm === 2000 && s.syUm === 2000 && s.mmPerPxMax === 2); }
  check("PO-LASER-4 300×225 mm art at 0.1 mm/px, budget 16e6 → 3000×2250, pitch 100 µm, capped \"none\"",
    JSON.stringify(fab(300000, 225000, 6000, 4500, 16e6)) === JSON.stringify({ W: 3000, H: 2250, pitchUm: 100, capped: "none", shortPx: null }));
  { const r = fab(470000, 470000, 8000, 8000, 16e6);
    check("PO-LASER-4 470×470 mm art, budget 16e6 → pitch 118 µm (first integer pitch with W·H ≤ budget), capped \"budget\"",
      r.pitchUm === 118 && r.W === 3984 && r.H === 3984 && r.capped === "budget" && r.shortPx === null && 4018 * 4018 > 16e6); }
  { const r = fab(470000, 470000, 3000, 5000, 16e6);
    check("PO-LASER-4 budget and source caps combine: capped \"budget+source\"",
      r.capped === "budget+source" && r.pitchUm === 118 && r.W === 3000 && r.H === 3984 && JSON.stringify(r.shortPx) === "[984,0]"); }
  { // brute-force minimality of the budget pitch over a sweep
    const rnd = F.lcg(2003); let ok = true;
    const cdiv = (a, b) => Math.ceil(a / b);
    for (let t = 0; t < 200 && ok; t++) {
      const a = 1000 + Math.floor(rnd() * 900000), b = 1000 + Math.floor(rnd() * 900000), B = 1000 + Math.floor(rnd() * 30e6), p0 = 20 + Math.floor(rnd() * 200);
      const r = fab(a, b, 1e6, 1e6, B, p0);
      const fits = (p) => cdiv(a, p) * cdiv(b, p) <= B;
      ok = fits(r.pitchUm) && r.pitchUm >= p0 && (r.pitchUm === p0 || !fits(r.pitchUm - 1)) &&
        r.W === cdiv(a, r.pitchUm) && r.H === cdiv(b, r.pitchUm) && r.capped === (r.pitchUm === p0 ? "none" : "budget");
    }
    check("PO-LASER-4 budget pitch is the smallest integer ≥ target with W·H ≤ budget (200-case sweep vs brute force)", ok); }
  { const ins = [[300000, 225000, 6000, 4500, 16e6], [470000, 470000, 3000, 5000, 16e6], [400000, 300000, 200, 150, 16e6], [123457, 98765, 777, 5000, 2e6, 87]];
    const outs = ins.map((a) => [fab(...a), fab(...a), fab(...a)]);
    const isInt = (r) => [r.W, r.H, r.pitchUm].every(Number.isInteger) && (r.shortPx === null || r.shortPx.every(Number.isInteger));
    check("NFR-05 fabRaster is integer-only and repeatable (same inputs ×3, every output an integer)",
      outs.every((t) => t.every(isInt) && JSON.stringify(t[0]) === JSON.stringify(t[1]) && JSON.stringify(t[1]) === JSON.stringify(t[2]))); }
  check("NFR-05 fabRaster rejects non-integer or non-positive inputs",
    [{ artWUm: 1.5 }, { artHUm: 0 }, { srcW: -1 }, { targetPitchUm: 0.1 }, { pxBudget: 0 }, { pxBudget: NaN }].every((bad) =>
      codeOf(() => R.fabRaster(Object.assign({ artWUm: 1000, artHUm: 1000, srcW: 10, srcH: 10, targetPitchUm: 100, pxBudget: 1e6 }, bad))) === "RASTER_ARG"));
  check("NFR-05 G2.0 raster contract uses no transcendental math (resample, rasterSize, fabRaster)",
    [R.resample, R.rasterSize, R.fabRaster].every((f) => !/Math\.(cbrt|sin|cos|exp|log|pow|hypot|atan|tan)/.test(f.toString())));

  // ---- policy and cache key
  check("IMG-03 policy: height none when the source fits, else nearest; area only as an explicit filter; tonal area",
    R.resamplePolicy("height", 200, 150, 200, 150) === "none" && R.resamplePolicy("height", 400, 300, 200, 150) === "nearest" &&
    R.resamplePolicy("height", 400, 300, 200, 150, { heightArea: true }) === "area" && R.resamplePolicy("tonal", 400, 300, 200, 150) === "area" &&
    R.resamplePolicy("tonal", 200, 150, 200, 150) === "area" && codeOf(() => R.resamplePolicy("bogus", 1, 1, 1, 1)) === "RESAMPLE_METHOD");
  check("Appendix C S4: raster cache key covers (w, h, channels, W, H, method, sampleHash), never sampleHash alone",
    R.cacheKey({ w: 5, h: 1, channels: 1, W: 5, H: 1, method: "none", sampleHash: "ab" }) !== R.cacheKey({ w: 1, h: 5, channels: 1, W: 1, H: 5, method: "none", sampleHash: "ab" }) &&
    R.cacheKey({ w: 4, h: 4, channels: 1, W: 2, H: 2, method: "area", sampleHash: "ab" }) !== R.cacheKey({ w: 4, h: 4, channels: 1, W: 2, H: 2, method: "nearest", sampleHash: "ab" }) &&
    R.cacheKey({ w: 4, h: 4, channels: 1, W: 2, H: 2, method: "area", sampleHash: "ab" }) === R.cacheKey({ w: 4, h: 4, channels: 1, W: 2, H: 2, method: "area", sampleHash: "ab" }) &&
    codeOf(() => R.cacheKey({ w: 4, h: 4, channels: 1, W: 2, H: 2, method: "area" })) === "RASTER_ARG");

  // ---- diagnostics
  const D = SBDiag.CODES;
  check("PO-LASER-4 FAB_PITCH_CAPPED registered (info, process); FAB_EXCEEDS_SOURCE stays a warning",
    D.FAB_PITCH_CAPPED && D.FAB_PITCH_CAPPED.severity === "info" && D.FAB_PITCH_CAPPED.kind === "process" && D.FAB_EXCEEDS_SOURCE.severity === "warning");
  check("GEO-06 FAB_EXCEEDS_SOURCE fix text no longer promises interpolation", !/interpolat/i.test(D.FAB_EXCEEDS_SOURCE.fix) && /cannot be recovered/i.test(D.FAB_EXCEEDS_SOURCE.fix));
  { const ctx = { artWUm: 400000, artHUm: 300000, srcW: 200, srcH: 150, targetPitchUm: 100, pxBudget: 16e6, deviceClass: "desktop", quality: "fabrication", revision: 3 };
    const ds = R.fabDiagnostics(R.fabRaster(ctx), ctx), d = ds[0];
    check("PO-LASER-5 FAB_EXCEEDS_SOURCE: shortfall message, source vs target px, shortPx, fabrication quality",
      ds.length === 1 && d.code === "FAB_EXCEEDS_SOURCE" && d.quality === "fabrication" && d.revision === 3 &&
      JSON.stringify(d.shortPx) === "[3800,2850]" && /3800 × 2850 px short of the 0\.1 mm\/px target/.test(d.message) &&
      /cannot be recovered/.test(d.message) && /200 × 150 px/.test(d.message) && /2 mm\/px/.test(d.message) &&
      d.measured.value === 200 && d.measured.unit === "px" && d.limit.value === 4000 && d.limit.unit === "px" && /most short on the width: 200 of 4000 px/.test(d.message)); }
  { const ctx = { artWUm: 400000, artHUm: 300000, srcW: 3000, srcH: 6000, targetPitchUm: 100, pxBudget: 16e6, deviceClass: "desktop", quality: "fabrication" };
    const ds = R.fabDiagnostics(R.fabRaster(ctx), ctx), d = ds[0];   // 18 Mpx source, 12 Mpx target, short only on the width
    check("PO-LASER-5 FAB_EXCEEDS_SOURCE reports the most-short axis (source vs target px on it), so measured < limit whenever it warns",
      ds.length === 1 && d.code === "FAB_EXCEEDS_SOURCE" && d.measured.value === 3000 && d.limit.value === 4000 && d.measured.value < d.limit.value &&
      JSON.stringify(d.shortPx) === "[1000,0]" && /most short on the width: 3000 of 4000 px/.test(d.message)); }
  { const ctx = { artWUm: 300000, artHUm: 400000, srcW: 2000, srcH: 1000, targetPitchUm: 100, pxBudget: 16e6, deviceClass: "desktop", quality: "fabrication" };
    const d = R.fabDiagnostics(R.fabRaster(ctx), ctx)[0];            // width 3000/2000 = 1.5×, height 4000/1000 = 4× short
    check("PO-LASER-5 FAB_EXCEEDS_SOURCE picks the axis with the larger target/source ratio (height here)",
      d.measured.value === 1000 && d.limit.value === 4000 && /most short on the height: 1000 of 4000 px/.test(d.message) && JSON.stringify(d.shortPx) === "[1000,3000]"); }
  { const ctx = { artWUm: 470000, artHUm: 470000, srcW: 8000, srcH: 8000, targetPitchUm: 100, pxBudget: 16e6, deviceClass: "mobile", quality: "fabrication" };
    const ds = R.fabDiagnostics(R.fabRaster(ctx), ctx), d = ds[0];
    check("PO-LASER-4 FAB_PITCH_CAPPED: actual vs target mm/px from the real raster, names device class and budget",
      ds.length === 1 && d.code === "FAB_PITCH_CAPPED" && d.severity === "info" && d.measured.unit === "mm/px" && d.measured.value === 0.118 &&
      d.limit.value === 0.1 && /mobile/.test(d.message) && /16000000 px/.test(d.message) && /0\.118 mm\/px/.test(d.message)); }
  { const ctx = { artWUm: 470000, artHUm: 470000, srcW: 3000, srcH: 5000, targetPitchUm: 100, pxBudget: 16e6, deviceClass: "desktop", quality: "fabrication" };
    const ds = R.fabDiagnostics(R.fabRaster(ctx), ctx);
    check("PO-LASER-4/5 budget+source raises both diagnostics (capped first, then the shortfall)",
      ds.map((d) => d.code).join() === "FAB_PITCH_CAPPED,FAB_EXCEEDS_SOURCE" && JSON.stringify(ds[1].shortPx) === "[984,0]");
    const [cap, ex] = ds;   // budget pitch 118 µm (3984 × 3984 px); the 3000 px source width then gives 0.157 mm/px
    check("PO-LASER-4 FAB_PITCH_CAPPED attributes only the budget's coarsening (0.118 mm/px), and names the source for the rest (0.157 mm/px)",
      cap.measured.value === 0.118 && cap.limit.value === 0.1 && /0\.118 mm\/px/.test(cap.message) && /budget/.test(cap.message) &&
      /source/.test(cap.message) && /0\.157 mm\/px/.test(cap.message) && !/0\.157 mm\/px instead of/.test(cap.message));
    check("PO-LASER-5 FAB_EXCEEDS_SOURCE in budget+source: width 3000 of 3984 px at the budget-capped pitch, real 0.157 mm/px",
      ex.measured.value === 3000 && ex.limit.value === 3984 && /budget-capped/.test(ex.message) && /0\.157 mm\/px/.test(ex.message)); }
  { const ctx = { artWUm: 470000, artHUm: 470000, srcW: 8000, srcH: 8000, targetPitchUm: 100, pxBudget: 16e6, deviceClass: "mobile", quality: "fabrication" };
    const d = R.fabDiagnostics(R.fabRaster(ctx), ctx)[0];
    check("PO-LASER-4 budget-only cap does not mention the source", !/source/.test(d.message)); }
  { const ctx = { artWUm: 300000, artHUm: 225000, srcW: 6000, srcH: 4500, targetPitchUm: 100, pxBudget: 16e6, deviceClass: "desktop", quality: "fabrication" };
    check("PO-LASER-4 uncapped plan raises no fabrication diagnostics", R.fabDiagnostics(R.fabRaster(ctx), ctx).length === 0); }
  check("§9.1 SBDiag.make validates shortPx ([int ≥ 0, int ≥ 0]) and omits it when absent",
    !("shortPx" in SBDiag.make("FAB_EXCEEDS_SOURCE", {})) && codeOf(() => SBDiag.make("FAB_EXCEEDS_SOURCE", { shortPx: [1.5, 0] })) !== null &&
    codeOf(() => SBDiag.make("FAB_EXCEEDS_SOURCE", { shortPx: [1] })) !== null);
});

suite("schema.js — project v1 (PRJ-01/02, MAT-02/03, §9.1)", () => {
  const p = SBSchema.defaults("plywood");
  check("PRJ-01 plywood preset fields", p.construction.mode === "bonded-relief" && p.interpretation.polarity === "white-high" &&
    p.construction.sheets === 8 && p.construction.gapMM === 0 && p.material.thicknessMM === 6.35 && p.material.calibrated === false);
  check("MAT-03/PO-LASER-6 provisional feature/part", p.material.minFeatureMM === 1.5 && p.material.advisoryFeatureMM === 2 && p.material.minPartMM2 === 25);
  check("PO-LASER-1 default machine xTool S1 + feeder", p.machine.id === "xtool-s1-feeder" && p.machine.maxProcessingHeightMM === 470 &&
    p.machine.maxLengthMM === 3000 && p.machine.maxMaterialWidthMM === 545 && p.machine.maxThicknessMM === 14 && p.machine.kerfMM === 0.15);
  check("PO-LASER-1 machine profile is editable and survives validate", SBSchema.validate({ ...p, machine: { ...p.machine, maxLengthMM: 1000 } }).ok);
  check("PO-LASER-1 unknown machine key rejected", !SBSchema.validate({ ...p, machine: { ...p.machine, power: 40 } }).ok);
  check("PO-LASER-3 default sizes by height", p.geometry.sizeBy === "height" && p.geometry.targetMM === 300);
  const sz = SBSchema.resolveSize({ ...p, construction: { ...p.construction, frame: { enabled: true, widthMM: 10 } } }, 4000, 3000);
  check("PO-LASER-3 height mode: page 300 high, art 280 × 373.333", sz.pageHMM === 300 && sz.artHMM === 280 && sz.artWMM === 373.333 && sz.pageWMM === 393.333);
  check("PO-LASER-4/PO-PREVIEW-1 fab pitch 0.1 mm, draft from docs/perf/draft-budget.json", p.geometry.fabPitchMM === 0.1 && !("fabPx" in p.geometry) &&
    p.geometry.draftPx === JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs/perf/draft-budget.json"), "utf8")).decision.presets.plywood);
  check("PO-LASER-4 measured pixel budgets (G2.2b): desktop 25 Mpx, mobile 1 Mpx", SBSchema.limits("desktop").fabPxBudget === 25e6 && SBSchema.limits("mobile").fabPxBudget === 1e6);
  check("PO-LASER-6 advisory below minFeature rejected", !SBSchema.validate({ ...p, material: { ...p.material, advisoryFeatureMM: 1 } }).ok);
  check("PO-LASER-8 thickness 6.35 nominal, editable", p.material.thicknessMM === 6.35 && p.material.thicknessState === "nominal" &&
    SBSchema.validate({ ...p, material: { ...p.material, thicknessMM: 5.7, thicknessState: "measured" } }).ok);
  check("AT-01 12 in → 304.8 mm exactly (quantized)", SBSchema.toMM(12, "in") === 304.8);
  check("AT-01 304.8 mm → 12 in → 304.8 mm", SBSchema.toMM(SBSchema.fromMM(304.8, "in"), "in") === 304.8);
  const q = JSON.parse(JSON.stringify(p)); q.appearance.color = "#000000"; q.view.explodeMM = 40; q.app.version = "9.9.9"; q.id = "other";
  check("PRJ-02/AT-01 appearance/view/app/id change → same geometryKey hash", SBHash.hashJSON(SBSchema.geometryKey(p)) === SBHash.hashJSON(SBSchema.geometryKey(q)));
  check("MAT-02 width 2001 rejected", !SBSchema.validate({ ...p, geometry: { ...p.geometry, widthMM: 2001 } }).ok);
  check("LYR-03 unordered manual thresholds rejected", !SBSchema.validate({ ...p, interpretation: { ...p.interpretation, mode: "tonal", thresholdRule: "manual", manual: [0.6, 0.3] } }).ok);
  check("AT-22 NaN thickness rejected", !SBSchema.validate({ ...p, material: { ...p.material, thicknessMM: NaN } }).ok);
  check("AT-22 unknown enum rejected", !SBSchema.validate({ ...p, construction: { ...p.construction, mode: "glued" } }).ok);
  check("§9.1/AT-22 unknown key in construction rejected", !SBSchema.validate({ ...p, construction: { ...p.construction, autoPillars: true } }).ok);
  check("§9.1 unknown top-level metadata moved to extras", SBSchema.importLoose({ ...p, colorNotes: "x" }).project.extras.colorNotes === "x");
  check("GEO-10 machine null is allowed (no envelope check)", SBSchema.validate({ ...p, machine: null }).ok);
  check("GEO-10 machine with processing height above material width rejected", !SBSchema.validate({ ...p, machine: { ...p.machine, maxProcessingHeightMM: 600 } }).ok);
  check("PRJ-02 mode change lists affected settings",
    SBSchema.modeChangeDiff(p, { construction: { mode: "connected-sheet" } }).some((d) => d.path === "construction.gapMM"));
});

suite("schema.js — G2.1 extended (strict keys, presets, sizing, units, geometryKey, mode diff)", () => {
  const S = SBSchema, p = S.defaults("plywood"), a = S.defaults("acrylic");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const errs = (o) => S.validate(o).errors;
  const has = (o, path, code) => errs(o).some((e) => e.path === path && e.code === code);
  const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code || "UNCODED:" + e.message; } };
  const withAt = (o, path, v) => { const c = clone(o); const ks = path.split("."); let t = c; for (const k of ks.slice(0, -1)) t = t[k]; t[ks[ks.length - 1]] = v; return c; };

  // ---- presets
  check("PRJ-01 plywood defaults validate", S.validate(p).ok && S.validate(p).errors.length === 0);
  check("PRJ-01 acrylic defaults validate", S.validate(a).ok);
  check("PRJ-01 plywood: height interpretation, no frame, no registration holes, schema v1.0, source required (null)",
    p.interpretation.mode === "height" && p.construction.frame.enabled === false && p.construction.registration.enabled === false &&
    p.schema.major === 1 && p.schema.minor === 0 && p.source === null && p.material.kerfMode === "external");
  check("D1 plywood is unsmoothed (sharp corners), tolerance 0.05 mm", p.construction.cleanup.cornerStyle === "sharp" && p.construction.cleanup.toleranceMM === 0.05);
  check("PRJ-01 acrylic preset is today's connected tonal defaults (5 sheets, dark front, 12 mm frame, holes, gap 3)",
    a.construction.mode === "connected-sheet" && a.interpretation.mode === "tonal" && a.interpretation.polarity === "dark-front" &&
    a.construction.sheets === 5 && a.construction.frame.enabled && a.construction.frame.widthMM === 12 && a.construction.registration.enabled &&
    a.construction.registration.diaMM === 4 && a.construction.gapMM === 3 && a.interpretation.smoothing.radiusMM === 1.65 && a.interpretation.smoothing.passes === 2 &&
    a.geometry.sizeBy === "width" && a.geometry.widthMM === 300 && a.geometry.targetMM === 324);
  check("PO-LASER-1 both presets carry the default machine profile", JSON.stringify(a.machine) === JSON.stringify(S.MACHINES["xtool-s1-feeder"]));
  check("PO-LASER-1 MACHINES is deep-frozen and defaults() returns independent copies",
    Object.isFrozen(S.MACHINES) && Object.isFrozen(S.MACHINES["xtool-s1-feeder"]) &&
    (() => { const x = S.defaults("plywood"); x.machine.kerfMM = 1; x.construction.repairs.push(1); const y = S.defaults("plywood");
      return S.MACHINES["xtool-s1-feeder"].kerfMM === 0.15 && y.machine.kerfMM === 0.15 && y.construction.repairs.length === 0; })());
  check("PO-LASER-1 MACHINES entry has exactly the MachineProfile keys",
    JSON.stringify(Object.keys(S.MACHINES["xtool-s1-feeder"]).sort()) ===
    JSON.stringify(["id", "kerfMM", "maxLengthMM", "maxMaterialWidthMM", "maxProcessingHeightMM", "maxThicknessMM", "name"]));
  check("PRJ-01 unknown preset throws SCHEMA_PRESET", codeOf(() => S.defaults("glass")) === "SCHEMA_PRESET");
  check("PRJ-01 defaults are deterministic and hashable", SBHash.hashJSON(S.defaults("plywood")) === SBHash.hashJSON(S.defaults("plywood")));

  // ---- strict keys and error shape
  check("§9.1 errors carry {path, code}: unknown construction key", has({ ...p, construction: { ...p.construction, autoPillars: true } }, "construction.autoPillars", "UNKNOWN_KEY"));
  check("§9.1 unknown key in each geometry section rejected (source, interpretation, material, geometry)",
    ["interpretation", "material", "geometry"].every((s) => has(withAt(p, s + ".zz", 1), s + ".zz", "UNKNOWN_KEY")) &&
    has({ ...p, source: { ...S.sourceTemplate(), zz: 1 } }, "source.zz", "UNKNOWN_KEY"));
  check("§9.1 unknown nested key rejected (construction.frame, geometry.resample)",
    has(withAt(p, "construction.frame.colour", 1), "construction.frame.colour", "UNKNOWN_KEY") &&
    has(withAt(p, "geometry.resample.cubic", "x"), "geometry.resample.cubic", "UNKNOWN_KEY"));
  check("§9.1 missing key reported", has((() => { const c = clone(p); delete c.material.minPartMM2; return c; })(), "material.minPartMM2", "MISSING_KEY"));
  check("§9.1 unknown top-level key rejected by validate (importLoose moves it)", has({ ...p, colorNotes: "x" }, "colorNotes", "UNKNOWN_KEY"));
  { const r = S.importLoose({ ...p, colorNotes: "x", tags: [1] });
    check("§9.1 importLoose reports moved keys and the result validates", JSON.stringify(r.movedToExtras) === '["colorNotes","tags"]' && S.validate(r.project).ok && !("colorNotes" in r.project)); }
  check("§9.1 importLoose keeps unknown keys inside geometry sections (still rejected)",
    has(S.importLoose(withAt(p, "construction.autoPillars", true)).project, "construction.autoPillars", "UNKNOWN_KEY"));
  check("§9.1 importLoose does not mutate its input", (() => { const o = { ...clone(p), colorNotes: "x" }; S.importLoose(o); return o.colorNotes === "x" && !("colorNotes" in o.extras); })());
  check("§9.1 a source record validates with every D5/S4 decode value",
    ["raw-gray8", "raw-rgb-equal", "canvas-tonal", "raw-gray1-scaled8", "raw-gray2-scaled8", "raw-gray4-scaled8", "raw-palette-gray8"]
      .every((d) => S.validate({ ...p, source: { ...S.sourceTemplate(), decode: d } }).ok) &&
    has({ ...p, source: { ...S.sourceTemplate(), decode: "canvas-height" } }, "source.decode", "ENUM"));
  check("§9.1 source orientation and alpha are strict", has({ ...p, source: { ...S.sourceTemplate(), orientation: { ...S.sourceTemplate().orientation, rotate: 45 } } }, "source.orientation.rotate", "ENUM") &&
    has({ ...p, source: { ...S.sourceTemplate(), alpha: { mode: "threshold", t: 2 } } }, "source.alpha.t", "RANGE"));

  // ---- ranges, enums, finite numbers
  check("LYR-01 sheets 1..16 integer", S.validate(withAt(p, "construction.sheets", 1)).ok && S.validate(withAt(p, "construction.sheets", 16)).ok &&
    has(withAt(p, "construction.sheets", 17), "construction.sheets", "RANGE") && has(withAt(p, "construction.sheets", 0), "construction.sheets", "RANGE") &&
    has(withAt(p, "construction.sheets", 2.5), "construction.sheets", "INTEGER"));
  check("MAT-02 thickness 0.1..25", S.validate(withAt(p, "material.thicknessMM", 0.1)).ok && S.validate(withAt(p, "material.thicknessMM", 25)).ok &&
    has(withAt(p, "material.thicknessMM", 0.09), "material.thicknessMM", "RANGE") && has(withAt(p, "material.thicknessMM", 25.001), "material.thicknessMM", "RANGE"));
  check("D-4.2 gap 0..25", has(withAt(p, "construction.gapMM", -1), "construction.gapMM", "RANGE") && has(withAt(p, "construction.gapMM", 26), "construction.gapMM", "RANGE"));
  check("MAT-02 width/height 1..2000 or null", S.validate(withAt(p, "geometry.widthMM", 2000)).ok && has(withAt(p, "geometry.heightMM", 0.5), "geometry.heightMM", "RANGE"));
  check("PO-LASER-3 targetMM 1..2000 and sizeBy enum", has(withAt(p, "geometry.targetMM", 2001), "geometry.targetMM", "RANGE") &&
    has(withAt(p, "geometry.sizeBy", "diagonal"), "geometry.sizeBy", "ENUM") && S.validate(withAt(p, "geometry.sizeBy", "width")).ok);
  check("PO-LASER-3 targetMM must leave artwork inside the frame", has(withAt(withAt(p, "construction.frame", { enabled: true, widthMM: 150 }), "geometry.targetMM", 300), "geometry.targetMM", "CONSTRAINT"));
  check("PO-LASER-4 fabPitchMM 0.01..2 on the 0.001 mm grid", S.validate(withAt(p, "geometry.fabPitchMM", 0.01)).ok && S.validate(withAt(p, "geometry.fabPitchMM", 2)).ok &&
    has(withAt(p, "geometry.fabPitchMM", 0.005), "geometry.fabPitchMM", "RANGE") && has(withAt(p, "geometry.fabPitchMM", 0.1005), "geometry.fabPitchMM", "GRID"));
  check("GEO-09 lengths off the 0.001 mm grid rejected (lossless units)", has(withAt(p, "material.thicknessMM", 6.3505), "material.thicknessMM", "GRID"));
  check("PO-LASER-4 draftPx 64..2000 integer", has(withAt(p, "geometry.draftPx", 63), "geometry.draftPx", "RANGE") && has(withAt(p, "geometry.draftPx", 720.5), "geometry.draftPx", "INTEGER"));
  check("AT-22 Infinity / string numbers rejected as NONFINITE / TYPE", has(withAt(p, "construction.gapMM", Infinity), "construction.gapMM", "NONFINITE") &&
    has(withAt(p, "material.thicknessMM", "6.35"), "material.thicknessMM", "TYPE"));
  check("LYR-03 manual thresholds strictly ascending inside (0, 1)", S.validate(withAt(p, "interpretation.manual", [0.2, 0.5, 0.9])).ok &&
    has(withAt(p, "interpretation.manual", [0.2, 0.2]), "interpretation.manual", "ORDER") && has(withAt(p, "interpretation.manual", [0, 0.5]), "interpretation.manual.0", "RANGE") &&
    has(withAt(p, "interpretation.manual", [0.5, 1]), "interpretation.manual.1", "RANGE"));
  check("ASM-04 registration.layers 'all' or sorted unique indices below sheets", S.validate(withAt(p, "construction.registration.layers", [0, 2, 5])).ok &&
    has(withAt(p, "construction.registration.layers", [2, 0]), "construction.registration.layers", "ORDER") &&
    has(withAt(p, "construction.registration.layers", [1, 1]), "construction.registration.layers", "ORDER") &&
    has(withAt(p, "construction.registration.layers", [0, 8]), "construction.registration.layers.1", "RANGE") &&
    has(withAt(p, "construction.registration.layers", "some"), "construction.registration.layers", "TYPE"));
  check("IMG-03 heightFilter null or a strict explicit filter", S.validate(withAt(p, "interpretation.heightFilter", { op: "median", radiusMM: 0.1 })).ok &&
    S.validate(withAt(p, "interpretation.heightFilter", { op: "remap", lut: Array.from({ length: 256 }, (_, i) => 255 - i) })).ok &&
    has(withAt(p, "interpretation.heightFilter", { op: "remap", lut: [1, 2] }), "interpretation.heightFilter.lut", "RANGE") &&
    has(withAt(p, "interpretation.heightFilter", { op: "gauss", radiusMM: 0.1 }), "interpretation.heightFilter.op", "ENUM"));
  check("IMG-03/§3 polarity must suit the interpretation mode", has(withAt(p, "interpretation.polarity", "dark-front"), "interpretation.polarity", "CONSTRAINT") &&
    has(withAt(a, "interpretation.polarity", "white-high"), "interpretation.polarity", "CONSTRAINT"));
  check("MAT-05 kerfMode is external only", has(withAt(p, "material.kerfMode", "internal"), "material.kerfMode", "ENUM"));
  check("PRJ-06 schema major other than 1 rejected", has(withAt(p, "schema.major", 2), "schema.major", "SCHEMA_MAJOR"));
  check("§9.1 appearance color must be #RRGGBB", has(withAt(p, "appearance.color", "brown"), "appearance.color", "TYPE"));
  check("SUP-04 a well-formed repair validates; a malformed one is rejected",
    S.validate(withAt(p, "construction.repairs", [{ op: "clip-to-lower", layer: 3, sourceRevision: 4, resultRevision: 5, keyHash: "ab".repeat(32),
      reviewed: { quality: "draft", beforeHash: "cd".repeat(32), afterHash: "ef".repeat(32), removedAreaMM2: 1.5, partCountBefore: 2, partCountAfter: 1 } }])).ok &&
    has(withAt(p, "construction.repairs", [{ op: "bridge", layer: 3 }]), "construction.repairs.0.op", "ENUM"));
  check("NFR-05 validate never throws on garbage input", [null, 1, "x", [], {}, { construction: null }].every((o) => { try { return S.validate(o).ok === false; } catch (e) { return false; } }));

  // ---- machine profile
  check("PO-LASER-1 machine limits finite and positive; thickness 0.1..25; kerf 0..2",
    has(withAt(p, "machine.maxLengthMM", 0), "machine.maxLengthMM", "RANGE") && has(withAt(p, "machine.maxLengthMM", NaN), "machine.maxLengthMM", "NONFINITE") &&
    has(withAt(p, "machine.maxThicknessMM", 30), "machine.maxThicknessMM", "RANGE") && has(withAt(p, "machine.kerfMM", 2.5), "machine.kerfMM", "RANGE") &&
    S.validate(withAt(p, "machine.kerfMM", 0)).ok);
  check("PO-LASER-1 missing machine key rejected", has((() => { const c = clone(p); delete c.machine.kerfMM; return c; })(), "machine.kerfMM", "MISSING_KEY"));
  check("PO-LASER-1 machine processing height > material width → CONSTRAINT", has(withAt(p, "machine.maxProcessingHeightMM", 600), "machine.maxProcessingHeightMM", "CONSTRAINT"));

  // ---- sizing (PO-LASER-3)
  { const r = S.resolveSize(p, 4000, 3000);
    check("PO-LASER-3 height mode, no frame: art = page = 300 high, width 400", r.pageHMM === 300 && r.artHMM === 300 && r.artWMM === 400 && r.pageWMM === 400 && r.artWUm === 400000); }
  { const r = S.resolveSize(withAt(withAt(p, "geometry.sizeBy", "width"), "construction.frame", { enabled: true, widthMM: 12 }), 3000, 4000);
    check("PO-LASER-3 width mode: page 300 wide, art 276 × 368", r.pageWMM === 300 && r.artWMM === 276 && r.artHMM === 368 && r.pageHMM === 392); }
  { const r = S.resolveSize(withAt(p, "geometry.targetMM", 100), 3, 7);
    check("PO-LASER-3 free axis rounded half up on the 1 µm grid (100·3/7 = 42.857142… → 42.857)", r.artWMM === 42.857 && Number.isInteger(r.artWUm)); }
  { const r = S.resolveSize(withAt(p, "geometry.targetMM", 100), 2, 8);       // exact: 25000 µm
    const t = S.resolveSize(withAt(p, "geometry.targetMM", 100), 1, 64);      // 100000 µm · 1/64 = 1562.5 µm → 1563 µm (half up)
    check("PO-LASER-3 free-axis ties go up (1562.5 µm → 1563 µm)", r.artWUm === 25000 && t.artWUm === 1563); }
  { const e = (() => { try { S.resolveSize(p, 8000, 1000); } catch (x) { return x; } return null; })();   // 300 mm high → 2400 mm wide
    check("MAT-02 resolveSize range-checks the derived axis: 2400 mm wide > 2000 mm → SCHEMA_SIZE naming the axis and the range",
      e && e.code === "SCHEMA_SIZE" && e.axis === "width" && e.valueMM === 2400 && e.minMM === 1 && e.maxMM === 2000 && /MAT-02/.test(e.message) && /2400/.test(e.message)); }
  { const e = (() => { try { S.resolveSize(withAt(p, "geometry.sizeBy", "width"), 1000, 4000); } catch (x) { return x; } return null; })();
    check("MAT-02 width mode: derived height 1200 mm passes, 300 wide × 4:1 source → 1200 mm; 600 wide × 4:1 → 2400 mm high rejected",
      e === null && codeOf(() => S.resolveSize(withAt(withAt(p, "geometry.sizeBy", "width"), "geometry.targetMM", 600), 1000, 4000)) === "SCHEMA_SIZE"); }
  { const e = (() => { try { S.resolveSize(withAt(p, "geometry.targetMM", 100), 1, 200); } catch (x) { return x; } return null; })();   // 0.5 mm wide
    check("MAT-02 derived axis below 1 mm → SCHEMA_SIZE (axis width, 0.5 mm)", e && e.code === "SCHEMA_SIZE" && e.axis === "width" && e.valueMM === 0.5); }
  { const fr = withAt(p, "construction.frame", { enabled: true, widthMM: 10 });   // page 300 high → art 280 high, 1960 wide (7:1) passes
    check("MAT-02 the art axes are checked (frame excluded): 1960 mm art passes, 2000.005 mm fails",
      S.resolveSize(fr, 7000, 1000).artWMM === 1960 && codeOf(() => S.resolveSize(withAt(p, "geometry.targetMM", 285.715), 7000, 1000)) === "SCHEMA_SIZE"); }
  { const c = withAt(withAt(withAt(p, "geometry.lockAspect", false), "geometry.widthMM", 250), "geometry.heightMM", 120);
    const r = S.resolveSize(withAt(c, "construction.frame", { enabled: true, widthMM: 5 }), 4000, 3000);
    check("MAT-02 lockAspect false: both art axes as entered, page adds the frame", r.artWMM === 250 && r.artHMM === 120 && r.pageWMM === 260 && r.pageHMM === 130); }
  check("PO-LASER-3 frame disabled ignores widthMM", S.resolveSize(withAt(p, "construction.frame", { enabled: false, widthMM: 20 }), 4000, 3000).artHMM === 300);
  check("PO-LASER-3 resolveSize rejects a bad source size", codeOf(() => S.resolveSize(p, 0, 10)) === "SCHEMA_SIZE" && codeOf(() => S.resolveSize(p, 1.5, 10)) === "SCHEMA_SIZE");
  check("PO-LASER-3 resolveSize rejects a free axis that rounds to zero", codeOf(() => S.resolveSize(withAt(p, "geometry.targetMM", 1), 1, 1e7)) === "SCHEMA_SIZE");

  // ---- limits (PO-LASER-4)
  check("PO-LASER-4 limits frozen, carry the device class, unknown class throws",
    Object.isFrozen(S.limits("desktop")) && S.limits("mobile").deviceClass === "mobile" && codeOf(() => S.limits("tablet")) === "SCHEMA_DEVICE");

  // ---- units (AT-01, GEO-09)
  check("AT-01 toMM / fromMM in mm quantize to 0.001 mm", S.toMM(12.34567, "mm") === 12.346 && S.fromMM(12.3456, "mm") === 12.346);
  check("AT-01 inch round trip lossless on the µm grid (sweep)", (() => { for (let um = 1; um <= 2000000; um += 997) { const mm = um / 1000; if (S.toMM(S.fromMM(mm, "in"), "in") !== mm) return false; } return true; })());
  check("AT-01 1 in = 25.4 mm; 0.5 in = 12.7 mm", S.toMM(1, "in") === 25.4 && S.toMM(0.5, "in") === 12.7 && S.fromMM(25.4, "in") === 1);
  check("AT-01 unknown unit / non-finite value throw", codeOf(() => S.toMM(1, "cm")) === "SCHEMA_UNIT" && codeOf(() => S.fromMM(NaN, "mm")) === "SCHEMA_UNIT");

  // ---- geometryKey (PRJ-02, D4)
  const H = (o) => SBHash.hashJSON(S.geometryKey(o));
  { const q = clone(p); q.title = "t"; q.units = "in"; q.acks = [{ key: "k", revision: 1 }]; q.extras = { a: 1 }; q.revision = 7; q.createdAt = "2026-01-01"; q.modifiedAt = "2026-01-02";
    check("PRJ-02 title/units/acks/extras/revision/timestamps leave geometryKey unchanged", H(q) === H(p)); }
  { const s1 = { ...p, source: S.sourceTemplate() }, s2 = { ...p, source: { ...S.sourceTemplate(), byteHash: "ff".repeat(32) } };
    check("D4 source.byteHash is not in geometryKey; sampleHash is", H(s1) === H(s2) && H(s1) !== H({ ...s1, source: { ...s1.source, sampleHash: "ee".repeat(32) } }) &&
      !("byteHash" in S.geometryKey(s1).source)); }
  check("PO-LASER-1 machine edits change the geometryKey (re-validate, invalidate acks)", H(withAt(p, "machine.maxLengthMM", 1000)) !== H(p) && H({ ...p, machine: null }) !== H(p));
  check("PRJ-02 geometry edits change the key (thickness, pitch, sizeBy)", [["material.thicknessMM", 5.7], ["geometry.fabPitchMM", 0.2], ["geometry.sizeBy", "width"]].every(([k, v]) => H(withAt(p, k, v)) !== H(p)));
  check("PRJ-02 geometryKey excludes appearance, view, acks, extras, title, units, id, app, timestamps, revision",
    ["appearance", "view", "acks", "extras", "title", "units", "id", "app", "createdAt", "modifiedAt", "revision"].every((k) => !(k in S.geometryKey(p))) &&
    ["schema", "engine", "source", "interpretation", "construction", "material", "geometry", "machine"].every((k) => k in S.geometryKey(p)));
  check("PRJ-02 geometryKey does not alias the project", (() => { const k = S.geometryKey(p); k.material.thicknessMM = 1; return p.material.thicknessMM === 6.35; })());

  // ---- mode change review (PRJ-02, G2.11e)
  { const d = S.modeChangeDiff(p, { construction: { mode: "connected-sheet" } }), by = (k) => d.find((x) => x.path === k);
    check("PRJ-02 bonded → connected: gap 0 → 3, bridge controls become applicable, entries have {path, from, to, reason}",
      by("construction.mode").to === "connected-sheet" && by("construction.gapMM").from === 0 && by("construction.gapMM").to === 3 &&
      d.some((x) => x.path.startsWith("construction.bridge.")) && d.every((x) => typeof x.reason === "string" && x.reason.length > 0 && "from" in x && "to" in x)); }
  { const d = S.modeChangeDiff(a, { construction: { mode: "bonded-relief" } }), by = (k) => d.find((x) => x.path === k);
    check("PRJ-02 connected → bonded: gap → 0, registration holes off (ASM-04), smoothing not applied (D1)",
      by("construction.gapMM").to === 0 && by("construction.registration.enabled").to === false && by("construction.cleanup.cornerStyle") !== undefined); }
  { const d = S.modeChangeDiff(p, { interpretation: { mode: "tonal" } }), by = (k) => d.find((x) => x.path === k);
    check("PRJ-02 height → tonal: polarity mapped white-high → light-front; threshold rule and smoothing become applicable; resample area",
      by("interpretation.polarity").to === "light-front" && by("interpretation.thresholdRule") !== undefined && by("interpretation.smoothing") !== undefined &&
      by("geometry.resample") !== undefined); }
  { const d = S.modeChangeDiff(a, { interpretation: { mode: "height" } }), by = (k) => d.find((x) => x.path === k);
    check("PRJ-02 tonal → height: dark-front → black-high; heightFilter applicable", by("interpretation.polarity").to === "black-high" && by("interpretation.heightFilter") !== undefined); }
  check("PRJ-02 a patch that keeps the mode lists nothing", S.modeChangeDiff(p, { construction: { mode: "bonded-relief" } }).length === 0 && S.modeChangeDiff(p, {}).length === 0);
  check("PRJ-02 applying every 'to' of the diff yields a valid project", (() => {
    for (const [src, patch] of [[p, { construction: { mode: "connected-sheet" } }], [a, { construction: { mode: "bonded-relief" } }], [p, { interpretation: { mode: "tonal" } }], [a, { interpretation: { mode: "height" } }]]) {
      const c = clone(src); for (const d of S.modeChangeDiff(src, patch)) { const ks = d.path.split("."); let t = c; for (const k of ks.slice(0, -1)) t = t[k]; t[ks[ks.length - 1]] = clone(d.to); }
      if (!S.validate(c).ok) return false; } return true; })());
  check("PRJ-02 modeChangeDiff rejects an unknown mode", codeOf(() => S.modeChangeDiff(p, { construction: { mode: "glued" } })) === "SCHEMA_MODE");
});

suite("schema.js — G2.4b legacy settings adapter: fromLegacySettings, resolveLegacy (DEP-04, AT-21, PO-LASER-4)", () => {
  const S = SBSchema;
  // The v1.1.0 settings.json keys, read from the settingsJSON() keep list in js/app.js (the exporter itself).
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const keepM = /function settingsJSON\(\)\s*\{\s*const keep = \[([\s\S]*?)\];/.exec(appSrc);
  const KEYS = keepM ? Array.from(keepM[1].matchAll(/"([A-Za-z0-9]+)"/g), (m) => m[1]) : [];
  const V110 = { projectName: "Starry", sourceName: "starry.jpg", procRes: 720, smoothRadius: 4, smoothPasses: 2, nSheets: 5,
    thresholdMode: "balanced", darkFront: true, palette: "Midnight (Starry Night)", widthMM: 300, marginMM: 12, minFeatureMM: 1.2,
    bridgeMM: 1.8, cullBelowMM2: 9, maxBridgeMM: 40, holes: true, holeDiaMM: 4, cornerStyle: "smooth", detailEps: 0.8 };
  const imp = (o) => S.fromLegacySettings(JSON.parse(JSON.stringify(o)));
  const noExtras = (p) => { const q = JSON.parse(JSON.stringify(p)); delete q.extras; return JSON.stringify(q); };
  check("DEP-04 settingsJSON keep list found in js/app.js (19 keys) and matches the fixture", KEYS.length === 19 &&
    KEYS.slice().sort().join() === Object.keys(V110).sort().join());

  // Each key: changing it changes a mapped project field, or it is an extras-only key that resolveLegacy consumes.
  const EXTRAS_ONLY = { sourceName: "other.png", procRes: 1000, detailEps: 1.6 };
  const ALT = { projectName: "Renamed", smoothRadius: 6, smoothPasses: 3, nSheets: 7, thresholdMode: "linear", darkFront: false,
    palette: "Ember", widthMM: 420, marginMM: 0, minFeatureMM: 2, bridgeMM: 2.5, cullBelowMM2: 20, maxBridgeMM: 60, holes: false,
    holeDiaMM: 6, cornerStyle: "faceted" };
  const base = imp(V110).project, baseR = S.resolveLegacy(base, 600, 400);
  check("DEP-04 every settingsJSON key (app.js settingsJSON) is mapped or kept in extras", KEYS.every((k) => {
    const o = Object.assign({}, V110); const p = imp(Object.assign(o, { [k]: k in ALT ? ALT[k] : EXTRAS_ONLY[k] })).project;
    if (JSON.stringify(p.extras.legacy[k]) !== JSON.stringify(o[k])) return false;
    if (k in ALT) return noExtras(p) !== noExtras(base);
    if (k === "sourceName") return p.extras.legacy.sourceName === "other.png";
    return noExtras(S.resolveLegacy(p, 600, 400)) !== noExtras(baseR);   // procRes, detailEps resolved later
  }));
  const { project: P, diagnostics: D } = imp(V110);
  check("DEP-04 mapping: title, tonal + connected-sheet, polarity, thresholdRule, smoothing (r4 at 720 px on 300 mm → 1.65 mm, E3b), sheets",
    P.title === "Starry" && P.interpretation.mode === "tonal" && P.construction.mode === "connected-sheet" &&
    P.interpretation.polarity === "dark-front" && imp(Object.assign({}, V110, { darkFront: false })).project.interpretation.polarity === "light-front" &&
    P.interpretation.thresholdRule === "balanced" && P.interpretation.smoothing.radiusMM === 1.65 && P.interpretation.smoothing.passes === 2 &&
    P.construction.sheets === 5);
  check("DEP-04 mapping: palette appearance, frame from margin, cleanup/bridge, registration, faceted → sharp",
    P.appearance.mode === "palette" && P.appearance.palette === "Midnight (Starry Night)" &&
    P.construction.frame.enabled === true && P.construction.frame.widthMM === 12 &&
    imp(Object.assign({}, V110, { marginMM: 0 })).project.construction.frame.enabled === false &&
    P.construction.cleanup.minFeatureMM === 1.2 && P.construction.bridge.bridgeMM === 1.8 && P.construction.bridge.cullBelowMM2 === 9 &&
    P.construction.bridge.maxBridgeMM === 40 && P.construction.registration.enabled === true && P.construction.registration.diaMM === 4 &&
    P.construction.cleanup.cornerStyle === "smooth" &&
    imp(Object.assign({}, V110, { cornerStyle: "faceted" })).project.construction.cleanup.cornerStyle === "sharp");
  check("DEP-04 mapping: sizeBy width, widthMM = art width, targetMM = page width, default machine profile",
    P.geometry.sizeBy === "width" && P.geometry.widthMM === 300 && P.geometry.targetMM === 324 && P.geometry.lockAspect === true &&
    JSON.stringify(P.machine) === JSON.stringify(S.MACHINES["xtool-s1-feeder"]));
  check("DEP-04 imported project validates", S.validate(P).ok);
  check("DEP-04 legacy JSON preserved in extras", JSON.stringify(P.extras.legacy) === JSON.stringify(V110) &&
    P.extras.legacy.sourceName === "starry.jpg" && P.extras.legacy.procRes === 720 && P.extras.legacy.detailEps === 0.8);
  check("DEP-04 input JSON not mutated", (() => { const o = JSON.parse(JSON.stringify(V110)); S.fromLegacySettings(o); return JSON.stringify(o) === JSON.stringify(V110); })());
  check("DEP-04 missing keys take the v1.1.0 defaults; unknown thresholdMode keeps the v1.1.0 balanced fallback", (() => {
    const p = S.fromLegacySettings({}).project, q = S.fromLegacySettings({ thresholdMode: "median" }).project;
    return S.validate(p).ok && p.title === "untitled" && p.construction.sheets === 5 && p.geometry.widthMM === 300 && p.geometry.targetMM === 324 &&
      q.interpretation.thresholdRule === "balanced" && q.extras.legacy.thresholdMode === "median"; })());
  check("DEP-04 non-object settings rejected (SCHEMA_LEGACY)", [null, 3, "x", []].every((v) => { try { S.fromLegacySettings(v); return false; } catch (e) { return e.code === "SCHEMA_LEGACY"; } }));

  // heightMM null → LEGACY_NEEDS_SOURCE (blocking) until resolveLegacy.
  check("DEP-04 heightMM null → LEGACY_NEEDS_SOURCE until resolveLegacy", P.geometry.heightMM === null &&
    D.length === 1 && D[0].code === "LEGACY_NEEDS_SOURCE" && D[0].severity === "blocking" &&
    S.legacyDiagnostics(P).length === 1 && S.legacyDiagnostics(P)[0].code === "LEGACY_NEEDS_SOURCE" &&
    S.legacyDiagnostics(S.resolveLegacy(P, 600, 400)).length === 0 && S.legacyDiagnostics(S.defaults("acrylic")).length === 0);
  const R = S.resolveLegacy(P, 600, 400);
  check("DEP-04 resolveLegacy: heightMM from the source aspect, validates, input not mutated",
    R.geometry.heightMM === 200 && R.geometry.widthMM === 300 && S.validate(R).ok && P.geometry.heightMM === null && P.geometry.fabPitchMM === 0.1);
  check("DEP-04/PO-LASER-4 legacy procRes 720, 300 × 200 mm → sizeBy width, fabPitchMM 0.417",
    R.geometry.sizeBy === "width" && R.geometry.fabPitchMM === 0.417);
  check("DEP-04 portrait legacy pitch uses the long (height) side: 300 × 600 mm, procRes 720 → 0.833", S.resolveLegacy(P, 400, 800).geometry.fabPitchMM === 0.833 &&
    S.resolveLegacy(P, 400, 800).geometry.heightMM === 600);
  // toleranceMM = max(0.05, detailEps × widthMM / working width px); landscape working width = procRes.
  check("DEP-04 landscape: toleranceMM = detailEps × widthMM / procRes (0.8 × 300 / 720 → 0.333)", R.construction.cleanup.toleranceMM === 0.333);
  check("DEP-04 portrait source: toleranceMM uses real working width", (() => {
    const t = S.resolveLegacy(P, 200, 400).construction.cleanup.toleranceMM;   // working width round(200·720/400) = 360 → 0.667, not 0.333
    return t === 0.667; })());
  check("DEP-04 toleranceMM floor 0.05", S.resolveLegacy(imp(Object.assign({}, V110, { detailEps: 0.01 })).project, 600, 400).construction.cleanup.toleranceMM === 0.05);
  check("DEP-04 resolveLegacy rejects a bad source size (SCHEMA_SIZE)", (() => { try { S.resolveLegacy(P, 0, 400); return false; } catch (e) { return e.code === "SCHEMA_SIZE"; } })());
  check("DEP-04 resolveLegacy needs a legacy project (SCHEMA_LEGACY)", (() => { try { S.resolveLegacy(S.defaults("acrylic"), 600, 400); return false; } catch (e) { return e.code === "SCHEMA_LEGACY"; } })());
  check("DEP-04 resolveLegacy does not rescale an oversized legacy piece (envelope check reports it)", (() => {
    const big = S.resolveLegacy(imp(Object.assign({}, V110, { widthMM: 600 })).project, 600, 400);
    return big.geometry.widthMM === 600 && big.geometry.heightMM === 400 && big.geometry.targetMM === 624; })());

  // AT-21: legacy settings + fixed luminance → masks equal the persisted v1.1.0 golden, via the tonal path with resample "none".
  const G = require("./golden/sheetmasks.json"), H = (u8) => require("crypto").createHash("sha256").update(Buffer.from(u8)).digest("hex");
  const L = new Float32Array(37 * 11); for (let i = 0; i < L.length; i++) L[i] = (i * 97) % 256;
  check("AT-21 legacy settings + fixed luminance input → masks equal the persisted golden (24 configs)", G.sheetmasks.every((g) => {
    const p = S.resolveLegacy(imp(Object.assign({}, V110, { nSheets: g.N, thresholdMode: g.mode, darkFront: g.darkFront })).project, 37, 11);
    const it = p.interpretation, N = p.construction.sheets;
    if (it.mode !== "tonal" || p.construction.mode !== "connected-sheet") return false;
    const Lr = SBRaster.resample(L, 1, 37, 11, 37, 11, "none");
    const th = SBRaster.thresholds(Lr, N, it.thresholdRule);
    return JSON.stringify(Array.from(th)) === JSON.stringify(g.thresholds) &&
      SBRaster.sheetMasks(SBRaster.bands(Lr, th), N, 37, 11, it.polarity === "dark-front").every((m, k) => H(m) === g.masks[k]);
  }));
});

suite("engine.js — G2.1b draft/fabrication raster snapshot: rasterPlan, qualityPair (LYR-06, GEO-06, NFR-04, PO-LASER-4/5)", () => {
  const S = SBSchema, E = SBEngine, p = S.defaults("plywood");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code || "UNCODED:" + e.message; } };
  const deepFrozen = (o) => o === null || typeof o !== "object" || (Object.isFrozen(o) && Object.values(o).every(deepFrozen));
  const codes = (pl) => pl.diagnostics.map((d) => d.code).sort().join(",");
  const withRotate = (proj, rotate, extra) => ({ ...proj, source: { ...S.sourceTemplate(), orientation: { ...S.sourceTemplate().orientation, rotate, ...(extra || {}) } } });
  const GEOMETRY_KEYS = ["artHMM", "artWMM", "capped", "deviceClass", "grid", "mmPerPxMax", "pageHMM", "pageWMM", "pitchUm", "pxBudget",
    "rasterH", "rasterW", "resample", "shortPx", "srcH", "srcW", "sxUm", "syUm", "targetPitchUm"];

  const src = { w: 6000, h: 4000 };
  const d = E.rasterPlan(p, src, "draft", "desktop"), f = E.rasterPlan(p, src, "fabrication", "desktop");
  check("LYR-06 6000×4000 source, sizeBy height 300 mm, no frame → draft 720×480, fabrication 4500×3000 at 100 µm",
    d.geometry.rasterW === 720 && d.geometry.rasterH === 480 && f.geometry.rasterW === 4500 && f.geometry.rasterH === 3000 &&
    f.geometry.pitchUm === 100 && f.geometry.targetPitchUm === 100 && f.geometry.capped === "none" && f.geometry.shortPx === null &&
    f.geometry.artHMM === 300 && f.geometry.artWMM === 450 && f.geometry.pageHMM === 300 && f.geometry.pageWMM === 450 && f.diagnostics.length === 0);
  check("LYR-06 draft and fabrication plans differ in quality and raster; both deep-frozen",
    d.quality === "draft" && f.quality === "fabrication" && d.geometry.rasterW !== f.geometry.rasterW && deepFrozen(d) && deepFrozen(f));
  check("§3 GeometryConfig carries exactly the §3 fields in both qualities",
    [d, f].every((pl) => JSON.stringify(Object.keys(pl.geometry).sort()) === JSON.stringify(GEOMETRY_KEYS)) && f.geometry.grid === "1um");
  check("§3 draft geometry: same physical size, real scales, no pitch or budget",
    d.geometry.artWMM === 450 && d.geometry.artHMM === 300 && d.geometry.sxUm === 625 && d.geometry.syUm === 625 && d.geometry.mmPerPxMax === 0.625 &&
    d.geometry.pitchUm === null && d.geometry.targetPitchUm === null && d.geometry.pxBudget === null && d.geometry.deviceClass === "desktop" &&
    d.geometry.capped === "none" && d.geometry.shortPx === null);
  check("GEO-06 fabrication mm/px from the real raster", f.geometry.sxUm === 100 && f.geometry.syUm === 100 && f.geometry.mmPerPxMax === 0.1 && f.geometry.pxBudget === 25e6);
  check("IMG-03 height mode resample: nearest when downsampled, none when the source fits; tonal → area",
    d.geometry.resample === "nearest" && f.geometry.resample === "nearest" &&
    E.rasterPlan(p, { w: 800, h: 600 }, "fabrication", "desktop").geometry.resample === "none" &&
    E.rasterPlan(S.defaults("acrylic"), src, "fabrication", "desktop").geometry.resample === "area");
  check("IMG-03 height area only as the explicit geometry.resample.height choice",
    E.rasterPlan({ ...p, geometry: { ...p.geometry, resample: { height: "area", tonal: "area" } } }, src, "fabrication", "desktop").geometry.resample === "area");

  const m = E.rasterPlan(p, src, "fabrication", "mobile"), cap = m.diagnostics.find((x) => x.code === "FAB_PITCH_CAPPED");
  check("PO-LASER-4 same project on mobile (budget 1e6, G2.2b) → 1223×816 at 368 µm, FAB_PITCH_CAPPED info with measured 0.368 / limit 0.1 mm/px",
    m.geometry.rasterW === 1223 && m.geometry.rasterH === 816 && m.geometry.pitchUm === 368 && m.geometry.capped === "budget" && m.geometry.pxBudget === 1e6 &&
    m.geometry.deviceClass === "mobile" && codes(m) === "FAB_PITCH_CAPPED" && cap.severity === "info" && cap.quality === "fabrication" &&
    cap.measured.value === 0.368 && cap.measured.unit === "mm/px" && cap.limit.value === 0.1 && /mobile/.test(cap.message));
  check("PO-LASER-4 the mobile draft plan is unchanged (720×480) and has no diagnostics",
    (() => { const md = E.rasterPlan(p, src, "draft", "mobile"); return md.geometry.rasterW === 720 && md.geometry.rasterH === 480 && md.diagnostics.length === 0; })());

  const small = { w: 800, h: 600 }, sf = E.rasterPlan(p, small, "fabrication", "desktop"), sd = E.rasterPlan(p, small, "draft", "desktop");
  const ex = sf.diagnostics.find((x) => x.code === "FAB_EXCEEDS_SOURCE");
  check("PO-LASER-5 800×600 source, 300 mm high → raster 800×600, FAB_EXCEEDS_SOURCE shortPx [3200, 2400]; the draft plan carries no pitch diagnostics",
    sf.geometry.rasterW === 800 && sf.geometry.rasterH === 600 && sf.geometry.capped === "source" && JSON.stringify(sf.geometry.shortPx) === "[3200,2400]" &&
    codes(sf) === "FAB_EXCEEDS_SOURCE" && ex.severity === "warning" && JSON.stringify(ex.shortPx) === "[3200,2400]" && ex.quality === "fabrication" &&
    sd.diagnostics.length === 0 && sd.geometry.rasterW === 720 && sd.geometry.rasterH === 540);
  check("GEO-06 the source-capped plan reports the real 0.5 mm/px", sf.geometry.sxUm === 500 && sf.geometry.syUm === 500 && sf.geometry.mmPerPxMax === 0.5);
  check("PO-LASER-4/5 budget and source caps combine on mobile",
    (() => { const b = E.rasterPlan(p, { w: 1000, h: 800 }, "fabrication", "mobile");   // art 375×300 mm → 336 µm budget pitch → 1117×893 > source
      return b.geometry.capped === "budget+source" && codes(b) === "FAB_EXCEEDS_SOURCE,FAB_PITCH_CAPPED" && b.geometry.rasterW === 1000 && b.geometry.rasterH === 800 &&
        JSON.stringify(b.geometry.shortPx) === "[117,93]"; })());
  check("LYR-06 diagnostics carry the project revision", E.rasterPlan({ ...p, revision: 9 }, small, "fabrication", "desktop").diagnostics.every((x) => x.revision === 9));

  { const r0 = E.rasterPlan(p, { w: 4000, h: 3000 }, "fabrication", "desktop"), r90 = E.rasterPlan(withRotate(p, 90), { w: 4000, h: 3000 }, "fabrication", "desktop");
    const r270 = E.rasterPlan(withRotate(p, 270), { w: 4000, h: 3000 }, "draft", "desktop"), r180 = E.rasterPlan(withRotate(p, 180), { w: 4000, h: 3000 }, "fabrication", "desktop");
    check("IMG-05 rotate 90 swaps the sizing axes",
      r0.geometry.artWMM === 400 && r0.geometry.artHMM === 300 && r90.geometry.srcW === 3000 && r90.geometry.srcH === 4000 &&
      r90.geometry.artHMM === 300 && r90.geometry.artWMM === 225 && r90.geometry.rasterW === 2250 && r90.geometry.rasterH === 3000 &&
      r270.geometry.rasterW === 540 && r270.geometry.rasterH === 720 && r180.geometry.artWMM === 400); }
  check("IMG-05 engine-applied EXIF 6 swaps the axes like rotate 90; browser-applied EXIF is not applied again",
    E.rasterPlan(withRotate(p, 0, { exif: 6, exifAppliedBy: "engine" }), { w: 4000, h: 3000 }, "fabrication", "desktop").geometry.srcW === 3000 &&
    E.rasterPlan(withRotate(p, 0, { exif: 6, exifAppliedBy: "browser" }), { w: 4000, h: 3000 }, "fabrication", "desktop").geometry.srcW === 4000 &&
    E.rasterPlan(withRotate(p, 90, { exif: 6, exifAppliedBy: "engine" }), { w: 4000, h: 3000 }, "fabrication", "desktop").geometry.srcW === 4000);
  check("PO-LASER-3 the frame is part of the page, not the raster",
    (() => { const r = E.rasterPlan({ ...p, construction: { ...p.construction, frame: { enabled: true, widthMM: 10 } } }, { w: 4000, h: 3000 }, "fabrication", "desktop");
      return r.geometry.pageHMM === 300 && r.geometry.artHMM === 280 && r.geometry.artWMM === 373.333 && r.geometry.pageWMM === 393.333 &&
        r.geometry.rasterW === 3734 && r.geometry.rasterH === 2800; })());

  check("NFR-04 rasterPlan needs only {w, h}", (() => {
    let touched = false;
    const probe = { w: 6000, h: 4000 };
    for (const k of ["pixels", "samples", "alpha", "data", "channels"]) Object.defineProperty(probe, k, { get() { touched = true; return new Uint8Array(1); }, enumerable: true });
    const r = E.rasterPlan(p, probe, "fabrication", "desktop");
    return !touched && r.geometry.rasterW === 4500 && E.rasterPlan(p, { w: 6000, h: 4000 }, "draft", "desktop").geometry.rasterW === 720;
  })());
  check("NFR-05 rasterPlan repeatable ×3 and every size field an integer", (() => {
    const hs = [0, 1, 2].map(() => SBHash.hashJSON(E.rasterPlan(p, { w: 5003, h: 3001 }, "fabrication", "mobile")));
    const ints = ["srcW", "srcH", "rasterW", "rasterH", "targetPitchUm", "pitchUm", "pxBudget"];
    return hs[0] === hs[1] && hs[1] === hs[2] &&
      [["fabrication", "desktop"], ["fabrication", "mobile"], ["draft", "desktop"]].every(([q, dc]) => {
        const g = E.rasterPlan(p, { w: 5003, h: 3001 }, q, dc).geometry;
        return ints.every((k) => g[k] === null || Number.isInteger(g[k])) && (g.shortPx === null || g.shortPx.every(Number.isInteger));
      });
  })());
  check("NFR-04/AT-22 bad arguments throw coded errors",
    codeOf(() => E.rasterPlan(p, { w: 0, h: 10 }, "draft", "desktop")) === "ENGINE_ARG" && codeOf(() => E.rasterPlan(p, { w: 10.5, h: 10 }, "draft", "desktop")) === "ENGINE_ARG" &&
    codeOf(() => E.rasterPlan(p, null, "draft", "desktop")) === "ENGINE_ARG" && codeOf(() => E.rasterPlan(p, src, "preview", "desktop")) === "ENGINE_ARG" &&
    codeOf(() => E.rasterPlan(p, src, "fabrication", "tablet")) === "SCHEMA_DEVICE" && codeOf(() => E.rasterPlan(p, src, "draft", "tablet")) === "SCHEMA_DEVICE");
  check("NFR-04 rasterPlan does not mutate the project", (() => { const q = clone(p), before = JSON.stringify(q); E.rasterPlan(q, src, "fabrication", "mobile"); return JSON.stringify(q) === before; })());

  const pair = E.qualityPair(p, src, "mobile");
  check("LYR-06 qualityPair returns both plans for display, equal to the single calls, deep-frozen",
    SBHash.hashJSON(pair.draft) === SBHash.hashJSON(E.rasterPlan(p, src, "draft", "mobile")) &&
    SBHash.hashJSON(pair.fabrication) === SBHash.hashJSON(E.rasterPlan(p, src, "fabrication", "mobile")) &&
    JSON.stringify(Object.keys(pair).sort()) === '["draft","fabrication"]' && deepFrozen(pair));
  check("LYR-06 draft diagnostics never stand in for fabrication: every fabrication diagnostic is quality fabrication",
    pair.fabrication.diagnostics.length > 0 && pair.fabrication.diagnostics.every((x) => x.quality === "fabrication") && pair.draft.diagnostics.length === 0);
});

suite("G2.2b — large-image benchmark and per-device pixel budgets (PO-LASER-4/9, NFR-03/04, AT-24)", () => {
  // Product-owner decision 2026-10-08 (G2.2b stop condition, option (a)): budgets gate on BONDED mode; connected is
  // measured and reported as KI-CONN-PERF; mobile adds sub-2 Mpx candidates and records "draft-only" if none qualifies.
  // Part 2 (2026-10-08): the recorded results (docs/perf/large-image.json, shortened run by product-owner decision:
  // rows preserved from the stopped full run plus r25 and laser470 measured live) set SBSchema.limits.
  const { LARGE_WORKLOADS, LARGE, decideLarge, gateLarge, largeRowFromSummary, largeMethodKind } = require("./bench.js");
  const perf = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "perf", "large-image.json"), "utf8"));
  const dec = perf.decision;
  check("PO-LASER-4 SBSchema.limits budgets equal docs/perf/large-image.json",
    SBSchema.limits("desktop").fabPxBudget === dec.desktop.fabPxBudget &&
    SBSchema.limits("mobile").fabPxBudget === (dec.mobile.fabrication === "draft-only" ? null : dec.mobile.fabPxBudget));
  check("PO-LASER-9 large-image targets recorded for desktop and mobile",
    dec.gatingMode === "bonded" && dec.escalate.length === 0 &&
    Number.isFinite(dec.desktop.targetMs) && Number.isFinite(dec.desktop.p95Ms) && dec.desktop.p95Ms <= dec.desktop.targetMs && dec.desktop.workingSetMiB <= LARGE.desktop.wsMiB &&
    Number.isFinite(dec.mobile.targetMs) && (dec.mobile.fabrication === "draft-only" ||
      (dec.mobile.fabrication === "enabled" && Number.isFinite(dec.mobile.p95Ms) && dec.mobile.p95Ms <= dec.mobile.targetMs && dec.mobile.workingSetMiB <= LARGE.mobile.wsMiB)) &&
    Number.isFinite(dec.srsDesktop.p95Ms) && dec.srsDesktop.p95Ms <= dec.srsDesktop.targetMs);
  { const byId = new Map(perf.rows.map((r) => [r.id, r]));
    check("PO-LASER-9 recorded decision is reproducible from the recorded rows (decideLarge) and passes gateLarge",
      JSON.stringify(decideLarge(byId)) === JSON.stringify(dec) && gateLarge(byId, dec).length === 0);
    check("PO-LASER-9 shortened method recorded honestly: every row has provenance log|live and its run counts, skipped rows listed, load recorded",
      perf.method === "shortened" && largeMethodKind(perf.rows) === "shortened" && perf.rows.every((r) => (r.source === "log" || r.source === "live") && r.warm >= 1 && r.runs >= 5) &&
      perf.rows.filter((r) => r.source === "live").map((r) => r.id).sort().join() === "laser470,r25" &&
      perf.shortened.skipped.join() === "b20,b25,laser470-busy" && perf.shortened.load.length === 2 && perf.shortened.load.every((l) => l.samples > 0)); }
  { const r = largeRowFromSummary("[large] r25 5774×4330 realistic: final (bonded, gated) p95 9749.1 ms, connected 47273.1 ms (reported, KI-CONN-PERF), ws 404.4 MiB, parts ≤120/layer, 420.3 s wall", "live");
    check("PO-LASER-9 large-assemble parses a summary line: p95s, working set, parts, default run counts, missing detail null",
      r.id === "r25" && r.source === "live" && r.stages.final.p95Ms === 9749.1 && r.stages.finalConnected.p95Ms === 47273.1 && r.workingSetMiB === 404.4 &&
      r.shape.maxPartsPerLayer === 120 && r.shape.maxVerticesPerLayer === null && r.stages.final.p50Ms === null && r.warm === 1 && r.runs === 5 &&
      largeRowFromSummary("not a summary line", "log") === null); }
  const W = LARGE_WORKLOADS || [];
  const has = (w, h, fam) => W.some((r) => r.w === w && r.h === h && r.family === fam && r.layers === 8);
  const sizes = [[2309, 1732], [3464, 2598], [4000, 3000], [4618, 3464], [5164, 3873], [5774, 4330]];
  check("PO-LASER-9 bench workload list covers 4–25 Mpx and the 470 mm-high page",
    sizes.every(([w, h]) => has(w, h, "realistic") && has(w, h, "busy")) && has(3525, 4700, "realistic") && has(3525, 4700, "busy") &&
    W.some((r) => r.w === 1536 && r.h === 1536 && r.layers === 8 && r.calibration) && W.some((r) => r.w === 768 && r.h === 768 && r.layers === 6 && r.calibration));
  check("PO-LASER-9 mobile candidates include sub-2 Mpx realistic rows (1, 1.25, 1.5 Mpx) next to 2/4/6/8",
    JSON.stringify(LARGE.mobile.candidates) === "[1,1.25,1.5,2,4,6,8]" &&
    LARGE.mobile.candidates.every((mp) => W.some((r) => r.id === "r" + mp && r.family === "realistic" && r.role === "mobile" && Math.abs(r.mpx - mp) < 0.01 && r.runs === 30)));
  // synthetic rows: bonded fast, connected slow (the G2.2b exploratory shape)
  const row = (id, bonded, connected, ws) => [id, { id, workingSetMiB: ws, stages: { final: { p95Ms: bonded }, finalBonded: { p95Ms: bonded }, finalConnected: { p95Ms: connected } },
    shape: { maxPartsPerLayer: 10, maxVerticesPerLayer: 100, verticesBonded: 800 } }];
  const rows = (mob) => new Map([row("srs-desktop", 3000, 18000, 100), row("r16", 9000, 60000, 400), row("r20", 9500, 70000, 450), row("r25", 12000, 80000, 600),
    row("b16", 9000, 60000, 400), ...mob]);
  { const d = decideLarge(rows([row("r1", 1500, 9000, 60), row("r1.25", 1900, 11000, 70), row("r1.5", 2500, 14000, 80), row("r2", 3000, 18000, 90)]));
    check("NFR-03 G2.2b decision gates on bonded mode: desktop 20 Mpx at 10 s although connected is 70 s; connected reported, not gating (KI-CONN-PERF)",
      d.gatingMode === "bonded" && d.desktop.row === "r20" && d.desktop.targetMs === 10000 && !d.desktop.relaxed && d.desktop.connectedP95Ms === 70000 &&
      d.srsDesktop.p95Ms === 3000 && d.srsDesktop.connectedP95Ms === 18000 && d.knownItems.some((k) => k.id === "KI-CONN-PERF") && d.escalate.length === 0 &&
      gateLarge(rows([]).set("r1.25", rows([row("r1.25", 1900, 11000, 70)]).get("r1.25")), d).length === 0);
    check("NFR-03 G2.2b mobile picks the largest qualifying candidate, sub-2 Mpx included (1.25 Mpx: 1900 × 4 ≤ 8 s)",
      d.mobile.fabrication === "enabled" && d.mobile.row === "r1.25" && d.mobile.fabPxBudget === 1.25e6 && d.mobile.p95Ms === 7600); }
  { const d = decideLarge(rows([row("r1", 2100, 9000, 60), row("r1.5", 2500, 14000, 80), row("r2", 3000, 18000, 90)]));
    const over = gateLarge(rows([row("r1", 2100, 9000, 60)]), d);
    check("NFR-03 G2.2b no mobile candidate qualifies → mobile fabrication recorded as draft-only (diagnostic named), not escalated, gate passes",
      d.mobile.fabrication === "draft-only" && d.mobile.fabPxBudget === null && d.mobile.diagnostic === "FAB_DEVICE_DRAFT_ONLY" && /1 Mpx/.test(d.mobile.reason) &&
      d.escalate.length === 0 && over.length === 0); }
  { const d = decideLarge(rows([row("r1", 1500, 9000, 60)]));
    const slow = rows([]); slow.set("srs-desktop", rows([row("srs-desktop", 11000, 18000, 100)]).get("srs-desktop"));
    check("NFR-03 G2.2b gate still fails on a bonded overrun of the SRS desktop reference", gateLarge(slow, d).some((x) => /SRS desktop/.test(x))); }
  const F = require("./fixtures.js");
  const a = F.heightMap(7, 400, 300), b = F.heightMap(7, 400, 300), c = F.heightMap(8, 400, 300);
  check("PO-LASER-9 realistic height fixture is seeded and deterministic",
    a.length === 120000 && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0 && Buffer.compare(Buffer.from(a), Buffer.from(c)) !== 0);
  const lo = Math.min(...a), hi = Math.max(...a);
  check("PO-LASER-9 realistic height fixture spans the range", lo < 40 && hi > 215);
  const busy = F.busyHeightMap(3, 300, 200, 27);
  check("PO-LASER-9 busy height fixture is seeded 8-bit samples", busy.length === 60000 && busy instanceof Uint8Array &&
    Buffer.compare(Buffer.from(busy), Buffer.from(F.busyHeightMap(3, 300, 200, 27))) === 0);
});

// ------------------------------------------------ G2.5 domain mask and orientation
suite("height.js/engine.js — G2.5 domain mask and orientation (IMG-04/05, AT-05)", () => {
  const H = SBHeight, E = SBEngine, F = require("./fixtures.js"), M = SBMaterial, S = SBSvg, G = SBGeom, R = SBSvgRead;
  check("G2.5 API present", typeof H.domainMask === "function" && typeof E.orient === "function");
  if (typeof H.domainMask !== "function" || typeof E.orient !== "function") return;
  const codeOf = (f) => { try { f(); return null; } catch (x) { return x.code || x.message; } };
  // ---- domainMask
  const al = Uint8Array.of(0, 127, 128, 200, 255);
  check("IMG-04 alpha 0.5 threshold defines A (alpha ≥ round(0.5·255) = 128 is inside)", H.domainMask(al, "threshold", 0.5).join() === "0,0,1,1,1" &&
    H.domainMask(al, "threshold").join() === "0,0,1,1,1");
  check("IMG-04 threshold t is honoured (t = 0.8 → alpha ≥ 204; t = 0 → all inside)", H.domainMask(al, "threshold", 0.8).join() === "0,0,0,0,1" &&
    H.domainMask(al, "threshold", 0).join() === "1,1,1,1,1");
  check("IMG-04 mode full → null (whole image); no alpha channel → null", H.domainMask(al, "full", 0.5) === null && H.domainMask(null, "threshold", 0.5) === null);
  check("IMG-04 domainMask returns a fresh 0/1 Uint8Array and leaves alpha untouched", (() => { const a = Uint8Array.from(al), m = H.domainMask(a, "threshold", 0.5);
    return m instanceof Uint8Array && m !== a && m.length === a.length && a.join() === al.join(); })());
  check("IMG-04 domainMask refuses an unknown mode or t outside [0,1]", codeOf(() => H.domainMask(al, "luma", 0.5)) === "DOMAIN_ARG" &&
    codeOf(() => H.domainMask(al, "threshold", 1.5)) === "DOMAIN_ARG" && codeOf(() => H.domainMask(al, "threshold", NaN)) === "DOMAIN_ARG");
  check("IMG-04 domainMask → cumulativeMasks: outside A only the base", (() => { const d = H.domainMask(Uint8Array.of(255, 0, 128, 127), "threshold", 0.5);
    const ms = H.cumulativeMasks(Uint8Array.of(3, 3, 3, 3), d, 4, 4, 1); return ms[0].join() === "1,1,1,1" && ms[3].join() === "1,0,1,0"; })());

  // ---- orient
  const fx = F.MASKS.orientationF, W = fx.w, Hh = fx.h;
  const fS = Uint8Array.from(fx.layers[1], (v) => v * 255);            // the F as 8-bit samples
  const fA = Uint8Array.from({ length: W * Hh }, (_, i) => (i * 37) & 255);   // an asymmetric alpha plane
  const src = () => ({ samples: Uint8Array.from(fS), alpha: Uint8Array.from(fA), w: W, h: Hh });
  const O = (o) => Object.assign({ exif: 1, exifAppliedBy: "none", rotate: 0, mirror: false }, o);
  const same = (a, b) => a.w === b.w && a.h === b.h && a.samples.join() === b.samples.join() && (a.alpha === null ? b.alpha === null : a.alpha.join() === b.alpha.join());
  const at = (r, x, y) => r.samples[y * r.w + x];
  const raw = (r) => ({ samples: r.samples, alpha: r.alpha, w: r.w, h: r.h });   // drop the oriented mark to compose in tests
  check("IMG-05 identity orientation returns the same pixels", same(E.orient(src(), O({})), src()));
  const r90 = E.orient(src(), O({ rotate: 90 }));
  // rotate 90 clockwise: source (x, y) → (h−1−y, x)
  check("IMG-05 rotate 90 is clockwise: source top-left lands top-right", r90.w === Hh && r90.h === W && at(r90, Hh - 1, 0) === fS[0] &&
    (() => { for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (at(r90, Hh - 1 - y, x) !== fS[y * W + x]) return false; return true; })());
  check("IMG-05 mirror flips left-right", (() => { const m = E.orient(src(), O({ mirror: true }));
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (at(m, W - 1 - x, y) !== fS[y * W + x]) return false; return true; })());
  check("IMG-05 EXIF 6 applied once on the engine path (== rotate 90)", same(E.orient(src(), O({ exif: 6, exifAppliedBy: "engine" })), r90));
  check("IMG-05 browser-applied EXIF is not applied again (exifAppliedBy browser → identity)",
    same(E.orient(src(), O({ exif: 6, exifAppliedBy: "browser" })), src()) && same(E.orient(src(), O({ exif: 8, exifAppliedBy: "none" })), src()));
  // the eight EXIF orientations as the standard composition of mirror and clockwise rotation
  const EXIF_AS = { 1: [0, false], 2: [0, true, "pre"], 3: [180, false], 4: [180, true], 5: [270, true, "pre"], 6: [90, false], 7: [90, true, "pre"], 8: [270, false] };
  check("IMG-05 EXIF 1..8 on the engine path match their standard rotate/mirror meaning", [1, 2, 3, 4, 5, 6, 7, 8].every((e) => {
    const got = E.orient(src(), O({ exif: e, exifAppliedBy: "engine" })), [rot, mir, pre] = EXIF_AS[e];
    // "pre": mirror first, then rotate (EXIF 2/5/7); otherwise rotate, then mirror
    const want = pre ? E.orient(raw(E.orient(src(), O({ mirror: true }))), O({ rotate: rot })) : E.orient(src(), O({ rotate: rot, mirror: mir }));
    return same(got, want); }));
  check("IMG-05 rotate 90 four times is the identity; 90+270 is the identity", (() => { let r = src(); for (let i = 0; i < 4; i++) r = raw(E.orient(r, O({ rotate: 90 })));
    return same(r, src()) && same(E.orient(raw(E.orient(src(), O({ rotate: 90 }))), O({ rotate: 270 })), src()); })());
  check("IMG-05 rotate applied once: a re-orient of an oriented raster is refused (ORIENT_TWICE)", (() => { const o = E.orient(src(), O({ rotate: 90 }));
    return o.oriented === true && codeOf(() => E.orient(o, O({ rotate: 90 }))) === "ORIENT_TWICE" && codeOf(() => E.orient(E.orient(src(), O({})), O({}))) === "ORIENT_TWICE"; })());
  check("IMG-05 orient is pure: the input planes are not mutated", (() => { const s = src(); E.orient(s, O({ rotate: 270, mirror: true, exif: 7, exifAppliedBy: "engine" }));
    return same(s, src()) && s.oriented === undefined; })());
  check("IMG-04/05 alpha follows the samples; null alpha stays null", (() => { const o = E.orient(src(), O({ rotate: 90, mirror: true })), n = E.orient(Object.assign(src(), { alpha: null }), O({ rotate: 90, mirror: true }));
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (o.alpha[x * o.w + y] !== fA[y * W + x]) return false;   // rotate 90 + mirror = transpose
    return n.alpha === null && n.samples.join() === o.samples.join(); })());
  check("IMG-05 multi-channel samples (RGB) keep their channel order per pixel", (() => {
    const rgb = Uint8Array.from({ length: 2 * 3 * 3 }, (_, i) => i), o = E.orient({ samples: rgb, alpha: null, w: 2, h: 3 }, O({ rotate: 90 }));
    // 2×3 → 3×2; source pixel (x, y) → (2−y, x)
    for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) for (let c = 0; c < 3; c++) if (o.samples[((x) * 3 + (2 - y)) * 3 + c] !== rgb[(y * 2 + x) * 3 + c]) return false;
    return o.w === 3 && o.h === 2; })());
  check("IMG-05 orient keeps the sample array type (Float32Array in, Float32Array out)", E.orient({ samples: new Float32Array(6), alpha: null, w: 3, h: 2 }, O({ rotate: 90 })).samples instanceof Float32Array);
  check("IMG-05 orient refuses bad orientation fields and inconsistent planes (ENGINE_ARG)",
    codeOf(() => E.orient(src(), O({ rotate: 45 }))) === "ENGINE_ARG" && codeOf(() => E.orient(src(), O({ exif: 9, exifAppliedBy: "engine" }))) === "ENGINE_ARG" &&
    codeOf(() => E.orient(src(), O({ exifAppliedBy: "canvas" }))) === "ENGINE_ARG" && codeOf(() => E.orient(src(), O({ mirror: 1 }))) === "ENGINE_ARG" &&
    codeOf(() => E.orient({ samples: new Uint8Array(5), alpha: null, w: 2, h: 3 }, O({}))) === "ENGINE_ARG" &&
    codeOf(() => E.orient({ samples: new Uint8Array(6), alpha: new Uint8Array(5), w: 2, h: 3 }, O({}))) === "ENGINE_ARG");
  check("IMG-05 orient dims == rasterPlan oriented size for every exif × applier × rotate × mirror", (() => {
    const p = SBSchema.defaults("plywood");
    for (let e = 1; e <= 8; e++) for (const by of ["browser", "engine", "none"]) for (const rot of [0, 90, 180, 270]) for (const mir of [false, true]) {
      const q = { ...p, source: { ...SBSchema.sourceTemplate(), orientation: { exif: e, exifAppliedBy: by, rotate: rot, mirror: mir } } };
      const g = E.rasterPlan(q, { w: 400, h: 300 }, "draft", "desktop").geometry, o = E.orient({ samples: new Uint8Array(12), alpha: null, w: 4, h: 3 }, q.source.orientation);
      if ((g.srcW > g.srcH) !== (o.w > o.h)) return false; }
    return true; })());

  // ---- AT-05 through the G1.4/G1.5 helpers: rotate 90 + mirror (= transpose) of the F
  const o = E.orient(src(), O({ rotate: 90, mirror: true }));
  const masks = H.cumulativeMasks(H.addedFromSamples(o.samples, 2, "white-high"), H.domainMask(o.alpha, "full"), 2, o.w, o.h);
  const pg = M.page({ artWMM: 70, artHMM: 70, frameMM: 0 }), L = M.fromMasks(masks, o.w, o.h, pg, {});
  const probe = (mat) => (px, py) => G.containsPoint(mat, [px * 10000 + 5000, py * 10000 + 5000]);
  // transposed F: stem along row 0 (x 0..5), top bar down column 0 (y 0..4), middle bar down column 2 (y 0..3)
  const expectF = (inside) => inside(0, 0) && inside(5, 0) && !inside(6, 0) && inside(0, 4) && !inside(0, 5) && inside(2, 3) && !inside(2, 4) && !inside(1, 1) && !inside(6, 6);
  const subRings = (d) => d.split(/(?=M )/).map((sp) => sp.replace(/[MLZ]/g, " ").trim().split(/\s+/).map((t) => Math.round(Number(t) * 1000)));
  const proofD = [...S.assemblySVG(L, pg, ["#ffffff", "#000000"]).matchAll(/<path d="([^"]*)"/g)].map((m) => m[1]);
  check("AT-05 rotate 90 + mirror: orientationF lands as expected in material", expectF(probe(L[1].material)));
  check("AT-05 rotate 90 + mirror: same in the parsed cut SVG (SBSvgRead round trip)", expectF(probe(R.toMaterial(R.parse(S.layerSVG(L[1], pg, {})).cut))));
  check("AT-05 rotate 90 + mirror: same in the opaque proof (assemblySVG layer path)", proofD.length === 2 && expectF(probe(R.toMaterial(subRings(proofD[1])))));
  check("AT-05 alpha domain oriented with the samples: transparent pixels stay base-only after rotate + mirror", (() => {
    const a = new Uint8Array(W * Hh).fill(255); a[0] = 0;                          // source (0,0) transparent
    const oo = E.orient({ samples: Uint8Array.from(fS), alpha: a, w: W, h: Hh }, O({ rotate: 90 }));   // (0,0) → (h−1, 0)
    const ms = H.cumulativeMasks(H.addedFromSamples(oo.samples, 2, "white-high"), H.domainMask(oo.alpha, "threshold", 0.5), 2, oo.w, oo.h);
    return ms[1][Hh - 1] === 0 && ms[1][Hh - 2] === 1 && ms[0].every((v) => v === 1); })());
});

suite("height.js/engine.js — G2.5b explicit height filter/remap (IMG-03, AT-02)", () => {
  const H = SBHeight, E = SBEngine, F = require("./fixtures.js");
  check("G2.5b API present", typeof H.applyFilter === "function" && typeof E.interpretHeight === "function");
  if (typeof H.applyFilter !== "function" || typeof E.interpretHeight !== "function") return;
  const codeOf = (f) => { try { f(); return null; } catch (x) { return x.code || x.message; } };
  const rnd = F.lcg(2505), W = 13, Hh = 9;
  const img = Uint8Array.from({ length: W * Hh }, () => Math.floor(rnd() * 256));
  const dom = Uint8Array.from({ length: W * Hh }, (_, i) => ((i * 7) % 5 === 0 ? 0 : 1));
  // brute-force oracle over the in-bounds, in-domain window
  const oracle = (s, w, h, op, r, d) => {
    const out = Uint8Array.from(s);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d && !d[y * w + x]) continue;
      const v = [];
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++)
        if (!d || d[yy * w + xx]) v.push(s[yy * w + xx]);
      if (op === "median") { v.sort((a, b) => a - b); out[y * w + x] = v[(v.length - 1) >> 1]; }
      else { const n = v.length, sum = v.reduce((a, b) => a + b, 0); out[y * w + x] = Math.floor((2 * sum + n) / (2 * n)); }
    }
    return out;
  };
  // ---- remap
  const lut = Array.from({ length: 256 }, (_, i) => (i * 97 + 13) & 255);
  check("IMG-03 remap LUT applied exactly (out[i] = lut[s[i]])", (() => { const o = H.applyFilter(img, W, Hh, { op: "remap", lut });
    return o instanceof Uint8Array && o.length === img.length && o.every((v, i) => v === lut[img[i]]); })());
  check("IMG-03 identity LUT is the identity; input not mutated", (() => { const s = Uint8Array.from(img), o = H.applyFilter(s, W, Hh, { op: "remap", lut: Array.from({ length: 256 }, (_, i) => i) });
    return o !== s && o.join() === img.join() && s.join() === img.join(); })());
  // ---- median / box against the oracle
  check("IMG-03 median (lower median, in-bounds window) matches the brute-force oracle, r = 1..4",
    [1, 2, 3, 4].every((r) => H.applyFilter(img, W, Hh, { op: "median", radius: r }).join() === oracle(img, W, Hh, "median", r, null).join()));
  check("IMG-03 box (integer mean, half up) matches the brute-force oracle, r = 1..4",
    [1, 2, 3, 4].every((r) => H.applyFilter(img, W, Hh, { op: "box", radius: r }).join() === oracle(img, W, Hh, "box", r, null).join()));
  check("IMG-03 radius larger than the image is clamped to the image (median, box)",
    ["median", "box"].every((op) => H.applyFilter(img, W, Hh, { op, radius: 50 }).join() === oracle(img, W, Hh, op, 50, null).join()));
  check("IMG-03 median of a flat image is the image; box of a flat image is the image",
    ["median", "box"].every((op) => H.applyFilter(new Uint8Array(30).fill(77), 6, 5, { op, radius: 2 }).every((v) => v === 77)));
  check("IMG-03 median removes a single-pixel spike; box spreads it", (() => { const s = new Uint8Array(25); s[12] = 255;
    const m = H.applyFilter(s, 5, 5, { op: "median", radius: 1 }), b = H.applyFilter(s, 5, 5, { op: "box", radius: 1 });
    return m.every((v) => v === 0) && b[12] === 28 && b[0] === 0 && b[6] === 28; })());
  // ---- domain (IMG-04)
  check("IMG-04 with a domain: in-domain output uses only in-domain neighbours (oracle), out-of-domain unchanged",
    ["median", "box"].every((op) => [1, 2].every((r) => H.applyFilter(img, W, Hh, { op, radius: r }, dom).join() === oracle(img, W, Hh, op, r, dom).join())) &&
    H.applyFilter(img, W, Hh, { op: "remap", lut }, dom).every((v, i) => v === (dom[i] ? lut[img[i]] : img[i])));
  check("IMG-04 in-domain output unchanged when out-of-domain pixels are altered", (() => { const alt = Uint8Array.from(img, (v, i) => (dom[i] ? v : 255 - v));
    return ["median", "box"].every((op) => { const a = H.applyFilter(img, W, Hh, { op, radius: 2 }, dom), b = H.applyFilter(alt, W, Hh, { op, radius: 2 }, dom);
      return a.every((v, i) => !dom[i] || v === b[i]); }); })());
  // ---- determinism and arguments
  check("IMG-03 applyFilter is deterministic (two runs byte-identical)", ["median", "box"].every((op) =>
    H.applyFilter(img, W, Hh, { op, radius: 3 }).join() === H.applyFilter(Uint8Array.from(img), W, Hh, { op, radius: 3 }).join()));
  check("IMG-03 applyFilter refuses bad filters and planes (FILTER_ARG)",
    codeOf(() => H.applyFilter(img, W, Hh, null)) === "FILTER_ARG" && codeOf(() => H.applyFilter(img, W, Hh, { op: "gauss", radius: 1 })) === "FILTER_ARG" &&
    codeOf(() => H.applyFilter(img, W, Hh, { op: "median", radius: 0 })) === "FILTER_ARG" && codeOf(() => H.applyFilter(img, W, Hh, { op: "box", radius: 1.5 })) === "FILTER_ARG" &&
    codeOf(() => H.applyFilter(img, W, Hh, { op: "box", radius: 51 })) === "FILTER_ARG" &&
    codeOf(() => H.applyFilter(img, W, Hh, { op: "remap", lut: [1, 2] })) === "FILTER_ARG" &&
    codeOf(() => H.applyFilter(img, W, Hh, { op: "remap", lut: Array(256).fill(256) })) === "FILTER_ARG" &&
    codeOf(() => H.applyFilter(img, W + 1, Hh, { op: "median", radius: 1 })) === "FILTER_ARG" &&
    codeOf(() => H.applyFilter(img, W, Hh, { op: "median", radius: 1 }, new Uint8Array(3))) === "FILTER_ARG");
  // E3b: schema filters carry radiusMM; interpretHeight converts it per raster (≥ 1 px, ≤ 50 px) before applyFilter.
  check("IMG-03 every schema-valid heightFilter is accepted by applyFilter on any schema pitch (via interpretHeight)", (() => { const p = SBSchema.defaults("plywood");
    return [{ op: "median", radiusMM: 0.05 }, { op: "box", radiusMM: 25 }, { op: "remap", lut }].every((f) => {
      const q = { ...p, interpretation: { ...p.interpretation, heightFilter: f } };
      return SBSchema.validate(q).ok && [0.01, 0.1, 2].every((mmPerPxMax) =>
        codeOf(() => E.interpretHeight(img, W, Hh, q.interpretation, p.construction.sheets, null, { geometry: { mmPerPxMax } })) === null); }); })());

  // ---- interpretHeight: the engine's height interpretation stage (G2.10a stage 4)
  const p = SBSchema.defaults("plywood"), N = p.construction.sheets;
  const withF = (f) => ({ ...p.interpretation, heightFilter: f });
  const G1 = { mmPerPxMax: 1 };   // E3b: 1 mm/px, so radiusMM n is n px
  const spy = (run) => {
    const calls = { kuwahara: 0, thresholds: 0, applyFilter: 0 };
    const ok = SBRaster.kuwahara, ot = SBRaster.thresholds, oa = H.applyFilter;
    SBRaster.kuwahara = (...a) => (calls.kuwahara++, ok(...a)); SBRaster.thresholds = (...a) => (calls.thresholds++, ot(...a));
    H.applyFilter = (...a) => (calls.applyFilter++, oa(...a));
    try { return { r: run(), calls }; } finally { SBRaster.kuwahara = ok; SBRaster.thresholds = ot; H.applyFilter = oa; }
  };
  const raw = spy(() => E.interpretHeight(img, W, Hh, p.interpretation, N, null, {}));
  check("IMG-03 height mode does not smooth unless heightFilter is set (spy: no kuwahara, thresholds or applyFilter call when null)",
    raw.calls.kuwahara === 0 && raw.calls.thresholds === 0 && raw.calls.applyFilter === 0);
  check("IMG-03 null heightFilter: added == addedFromSamples(raw samples), no HEIGHT_FILTERED",
    raw.r.added.join() === H.addedFromSamples(img, N, "white-high").join() && !raw.r.diagnostics.some((d) => d.code === "HEIGHT_FILTERED"));
  check("IMG-03 polarity is honoured (black-high)", E.interpretHeight(img, W, Hh, { ...p.interpretation, polarity: "black-high" }, N, null, {}).added.join() ===
    H.addedFromSamples(img, N, "black-high").join());
  const filt = spy(() => E.interpretHeight(img, W, Hh, withF({ op: "median", radiusMM: 2 }), N, dom, { geometry: G1, quality: "fabrication", revision: 3 }));
  check("IMG-03 set heightFilter: applyFilter called once, still no kuwahara or thresholds",
    filt.calls.applyFilter === 1 && filt.calls.kuwahara === 0 && filt.calls.thresholds === 0);
  check("IMG-03 set heightFilter: added == addedFromSamples(applyFilter(samples, domain))",
    filt.r.added.join() === H.addedFromSamples(H.applyFilter(img, W, Hh, { op: "median", radius: 2 }, dom), N, "white-high").join());
  const hf = filt.r.diagnostics.find((d) => d.code === "HEIGHT_FILTERED");
  check("AT-02 HEIGHT_FILTERED (info) carries the filter, quality and revision", !!hf && hf.severity === "info" && hf.quality === "fabrication" && hf.revision === 3 &&
    /median/.test(hf.message) && /radius 2 mm \(2 px/.test(hf.message));
  check("AT-02 smoothing enabled is recorded as an explicit change (geometryKey hash changes, HEIGHT_FILTERED present)", (() => {
    const q = { ...p, interpretation: withF({ op: "box", radiusMM: 1 }) }, Hk = (o) => SBHash.hashJSON(SBSchema.geometryKey(o));
    const d = E.interpretHeight(img, W, Hh, q.interpretation, N, null, { geometry: G1 }).diagnostics;
    return Hk(q) !== Hk(p) && Hk({ ...p, interpretation: withF({ op: "box", radiusMM: 2 }) }) !== Hk(q) && d.some((x) => x.code === "HEIGHT_FILTERED"); })());
  check("IMG-03 interpretHeight refuses tonal interpretation (ENGINE_ARG)", codeOf(() => E.interpretHeight(img, W, Hh, { ...p.interpretation, mode: "tonal" }, N, null, {})) === "ENGINE_ARG");
  check("IMG-03 interpretHeight does not mutate the samples", (() => { const s = Uint8Array.from(img); E.interpretHeight(s, W, Hh, withF({ op: "box", radiusMM: 3 }), N, null, { geometry: G1 }); return s.join() === img.join(); })());
});

// ------------------------------------------------ G2.7b complexity caps and busy-art simplification
suite("construct.js/schema.js — G2.7b complexity caps and busy-art simplification (§12.3, NFR-03/04/05, PO-LASER-9)", () => {
  const F = require("./fixtures.js"), S = SBSchema, C = SBConstruct, D = SBDiag;
  const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code || "UNCODED:" + e.message; } };
  // dot grid: a full base and one layer of isolated single pixels every `step` px (4-connected parts = dots)
  const dots = (w, h, step) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) m[y * w + x] = 1;
    return { w, h, layers: [new Uint8Array(w * h).fill(1), m] }; };
  const mk = (st, mmPerPx = 1) => SBMaterial.fromMasks(st.layers, st.w, st.h, { artWMM: st.w * mmPerPx, artHMM: st.h * mmPerPx, frameMM: 0 }, {});
  const ply = { minFeatureMM: 1.5, minPartMM2: 25, sxUm: 100, syUm: 100 };

  // ---- caps (SBSchema.limits)
  const mob = S.limits("mobile"), desk = S.limits("desktop");
  check("§12.3 mobile caps 100 parts / 20k vertices (SRS §12.3 mobile workload)",
    mob.maxPartsPerLayer === 100 && mob.maxVerticesTotal === 20000 && mob.maxVerticesPerLayer === 20000 && mob.fabPxBudget === 1e6);
  const perf = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "perf", "complexity.json"), "utf8")); } catch (e) { return null; } })();
  check("§12.3/PO-LASER-9 desktop caps equal the measured decision in docs/perf/complexity.json",
    !!perf && desk.maxPartsPerLayer === perf.decision.desktop.maxPartsPerLayer && desk.maxVerticesPerLayer === perf.decision.desktop.maxVerticesPerLayer &&
    desk.maxVerticesTotal === perf.decision.desktop.maxVerticesTotal && desk.fabPxBudget === 25e6);
  check("§12.3 desktop caps admit the realistic art measured at the desktop budget (parts and vertices of the r25 row)",
    !!perf && perf.decision.desktop.realistic.maxPartsPerLayer <= desk.maxPartsPerLayer &&
    perf.decision.desktop.realistic.maxVerticesPerLayer <= desk.maxVerticesPerLayer && perf.decision.desktop.realistic.vertices <= desk.maxVerticesTotal);
  check("§12.3 desktop caps: the capped busy row meets the 10 s bonded target and 512 MiB (live set; the G2.2b peak with garbage is recorded beside it)",
    !!perf && perf.decision.desktop.row.p95Ms <= 10000 && perf.decision.desktop.row.liveSetMiB <= 512 && Number.isFinite(perf.decision.desktop.row.workingSetMiB) &&
    perf.decision.desktop.row.maxPartsPerLayer === desk.maxPartsPerLayer);
  check("§12.3 limits are frozen per device class", Object.isFrozen(desk) && Object.isFrozen(mob));
  check("PO-LASER-9 recorded caps decision is reproducible from the recorded rows (decideCaps) and has no escalation",
    !!perf && JSON.stringify(require("./bench.js").decideCaps(perf.rows, perf.mobileRow)) === JSON.stringify(perf.decision) && perf.decision.escalate.length === 0);
  check("PO-LASER-9 large --caps desktop: busy b4/b9 fail fast with COMPLEXITY_LIMIT at the recorded cap; realistic r25 passes; simplify busy brings b4/b9 under the caps",
    !!perf && (() => { const v = (id, k) => perf.variantRows.find((r) => r.id === id && r.variant === k), C1 = "caps=desktop,bonded-only", C2 = "caps=desktop,simplify=busy,bonded-only";
      return ["b4", "b9"].every((id) => v(id, C1) && v(id, C1).status === "COMPLEXITY_LIMIT" && v(id, C1).shape.rejected.every((x) => x.limit.value === desk.maxPartsPerLayer) &&
          v(id, C2) && v(id, C2).status === "ok" && v(id, C2).shape.maxPartsPerLayer <= desk.maxPartsPerLayer && v(id, C2).shape.verticesBonded <= desk.maxVerticesTotal) &&
        v("r25", C1) && v("r25", C1).status === "ok" && v("r25", C1).shape.verticesBonded <= desk.maxVerticesTotal; })());

  { const { decideCaps, CAPS } = require("./bench.js");
    const row = (id, family, parts, p95, live, vpl, v, status = "ok") => ({ id, family, status, workingSetMiB: live + 100, liveSetMiB: live, stages: { final: { p95Ms: p95 } },
      shape: { maxPartsPerLayer: parts, maxVerticesPerLayer: vpl, verticesBonded: v } });
    const d = decideCaps([row("r25", "realistic", 120, 6000, 200, 49450, 182556), row("c240", "busy", 176, 8000, 250, 110536, 284214),
      row("c208", "busy", 258, 9500, 260, 121258, 336448), row("c192", "busy", 300, 10500, 270, 130000, 360000), row("c176", "busy", 340, 9900, 280, 150630, 403416)]);
    check("PO-LASER-9 decideCaps: largest busy parts/layer with every smaller busy row in budget; vertex caps admit it and the realistic row (rounded up to 1,000)",
      d.desktop.maxPartsPerLayer === 258 && d.desktop.row.id === "c208" && d.desktop.firstOver.id === "c192" && d.desktop.maxVerticesPerLayer === 122000 &&
      d.desktop.maxVerticesTotal === 337000 && d.escalate.length === 0 && CAPS.w * CAPS.h >= 25e6 && CAPS.w * CAPS.h < 25.01e6);
    const e = decideCaps([row("r25", "realistic", 120, 6000, 200, 49450, 182556), row("c240", "busy", 176, 8000, 600, 110536, 284214)]);
    check("PO-LASER-9 decideCaps: no busy row in budget (live set 600 MiB) → parts cap falls back to the realistic art, escalation recorded",
      e.desktop.maxPartsPerLayer === 120 && e.desktop.maxVerticesTotal === 183000 && e.escalate.length === 1); }


  // ---- estimateComplexity
  const est = (st) => C.estimateComplexity(st.layers, st.w, st.h);
  const fixtures = Object.entries(F.MASKS).filter(([, v]) => typeof v !== "function").map(([, v]) => v)
    .concat([F.MASKS.narrowBridge(2), F.MASKS.stripOnBase(1.8), dots(40, 30, 3)]);
  { const rng = F.lcg(5); for (let i = 0; i < 4; i++) fixtures.push({ w: 48, h: 36, layers: F.randomNestedStack(rng, 48, 36, 5) }); }
  { const s = F.busyHeightMap(4, 120, 90, 9); fixtures.push({ w: 120, h: 90, layers: SBHeight.cumulativeMasks(SBHeight.addedFromSamples(s, 6, "white-high"), null, 6, 120, 90) }); }
  check("§12.3 estimateComplexity counts components per layer before trace (equals fromMasks part count on fixtures)",
    fixtures.every((st) => { const e = est(st), L = mk(st); return e.partsPerLayer.length === L.length && e.partsPerLayer.every((n, k) => n === L[k].parts.length) &&
      e.maxPartsPerLayer === Math.max(...e.partsPerLayer); }));
  check("§12.3 estimateComplexity: empty layer 0 parts, nonzero values count as material, input not mutated",
    (() => { const m = new Uint8Array(12); m[0] = 255; m[5] = 7; const copy = m.slice(); const e = C.estimateComplexity([new Uint8Array(12), m], 4, 3);
      return e.partsPerLayer.join() === "0,2" && e.maxPartsPerLayer === 2 && m.join() === copy.join(); })());
  check("§12.3 estimateComplexity: unaligned buffers, 0/255 values and long runs count the same as the 0/1 copy", (() => {
    const rng = F.lcg(77), w = 97, h = 41, L = [];
    for (let k = 0; k < 4; k++) { const buf = new Uint8Array(w * h + 3), m = buf.subarray(k % 4, k % 4 + w * h);
      for (let y = 0; y < h; y++) { let v = 0; for (let x = 0; x < w; x++) { if (rng() < (k === 1 ? 0.02 : 0.2)) v = 1 - v; m[y * w + x] = v ? (k === 2 ? 255 : 1) : 0; } } L.push(m); }
    const e = C.estimateComplexity(L, w, h), ref = L.map((m) => SBMorph.components(Uint8Array.from(m, (v) => (v ? 1 : 0)), w, h).count);
    return e.partsPerLayer.join() === ref.join() && ref.some((n) => n > 5); })());
  check("§12.3 estimateComplexity bad arguments are CONSTRUCT_ARG", codeOf(() => C.estimateComplexity([], 4, 3)) === "CONSTRUCT_ARG" &&
    codeOf(() => C.estimateComplexity([new Uint8Array(5)], 4, 3)) === "CONSTRUCT_ARG");

  // ---- the parts gate (pre-trace)
  const busy = dots(160, 160, 3);   // 54 × 54 = 2916 one-pixel parts on layer 1
  const gate = (st, o) => C.complexityGate(st.layers, st.w, st.h, Object.assign({ deviceClass: "desktop", simplify: "off", quality: "fabrication", revision: 4 }, ply, o));
  const g = gate(busy);
  const cl = g.diagnostics.filter((d) => d.code === "COMPLEXITY_LIMIT");
  check("§12.3 busy fixture over the desktop cap → COMPLEXITY_LIMIT (blocking, measured/limit/layer/device class), no layers",
    2916 > desk.maxPartsPerLayer && g.status === "error" && g.masks === null && cl.length === 1 && cl[0].severity === "blocking" && D.CODES.COMPLEXITY_LIMIT.kind === "process" &&
    cl[0].layer === 1 && cl[0].measured.value === 2916 && cl[0].measured.unit === "parts" && cl[0].limit.value === desk.maxPartsPerLayer && cl[0].limit.unit === "parts" &&
    cl[0].deviceClass === "desktop" && cl[0].quality === "fabrication" && cl[0].revision === 4);
  check("§12.3 COMPLEXITY_LIMIT fix offers \"Simplify busy art\" and the cleanup controls", /Simplify busy art/.test(D.CODES.COMPLEXITY_LIMIT.fix) && /cleanup/i.test(D.CODES.COMPLEXITY_LIMIT.fix));
  check("§12.3 under the cap → status ok, masks passed through unchanged, no diagnostics",
    (() => { const st = dots(40, 30, 6), r = gate(st); return r.status === "ok" && r.masks.length === 2 && r.masks.every((m, k) => m.join() === st.layers[k].join()) &&
      r.diagnostics.length === 0 && r.estimate.maxPartsPerLayer === 35; })());
  check("§12.3 mobile cap is per device class (101 parts blocks on mobile, passes on desktop)",
    (() => { const st = { w: 202, h: 1, layers: [new Uint8Array(202).fill(1), Uint8Array.from({ length: 202 }, (_, i) => (i % 2 === 0 ? 1 : 0))] };
      const m = gate(st, { deviceClass: "mobile" }), d = gate(st);
      return m.status === "error" && m.diagnostics[0].limit.value === 100 && m.diagnostics[0].deviceClass === "mobile" && d.status === "ok"; })());
  check("§12.3 complexityGate bad deviceClass / simplify is CONSTRUCT_ARG",
    codeOf(() => gate(busy, { deviceClass: "tablet" })) === "CONSTRUCT_ARG" && codeOf(() => gate(busy, { simplify: "on" })) === "CONSTRUCT_ARG");

  // ---- the vertex gate (after fromMasks, before validation)
  const fake = (verts) => verts.map((v, k) => ({ index: k, stats: { vertices: v } }));
  { const L = fake([4, desk.maxVerticesPerLayer + 1, 10]), r = C.vertexGate(L, "desktop", { quality: "draft" });
    const d = r.diagnostics.find((x) => x.code === "COMPLEXITY_LIMIT");
    check("§12.3 vertices per layer over the cap → COMPLEXITY_LIMIT (vertices, layer), no layers",
      r.status === "error" && r.layers.length === 0 && !!d && d.layer === 1 && d.measured.unit === "vertices" && d.measured.value === desk.maxVerticesPerLayer + 1 &&
      d.limit.value === desk.maxVerticesPerLayer && d.deviceClass === "desktop" && d.quality === "draft"); }
  { const L = fake([4, 15000, 6000]), r = C.vertexGate(L, "mobile", {});
    const d = r.diagnostics.find((x) => x.code === "COMPLEXITY_LIMIT");
    check("§12.3 total vertices over the cap → COMPLEXITY_LIMIT (layer null, total), no layers",
      r.status === "error" && r.layers.length === 0 && !!d && d.layer === null && d.measured.value === 21004 && d.limit.value === 20000 && r.vertices.total === 21004); }
  // Product-owner decision 2026-10-08: the SRS 20,000-vertex mobile cap is kept, so mobile is limited to simpler art
  // (realistic art at the 1 Mpx mobile budget has ≈ 31,944 vertices). The mobile message says so; desktop's does not.
  { const m = C.vertexGate(fake([4, 15000, 6000]), "mobile", {}).diagnostics[0], dk = C.vertexGate(fake([4, desk.maxVerticesPerLayer + 1, 10]), "desktop", {}).diagnostics[0];
    check("§12.3 mobile COMPLEXITY_LIMIT message says mobile is limited to simpler art and points to desktop",
      /21004 vertices \(limit 20000 on mobile\)/.test(m.message) && /simpler art/i.test(m.message) && /desktop/i.test(m.message) &&
      !/simpler art/i.test(dk.message)); }
  { const L = fake([4, 100, 10]), r = C.vertexGate(L, "mobile", {});
    check("§12.3 vertex gate under the caps → status ok, the same layers", r.status === "ok" && r.layers === L && r.diagnostics.length === 0 && r.vertices.perLayer.join() === "4,100,10"); }

  // ---- simplification (explicit; NFR-04, R5)
  check("NFR-04 simplify \"busy\" is explicit: off by default, in geometryKey, reported with before/after counts", (() => {
    const p = S.defaults("plywood"), a = S.defaults("acrylic"), H = (o) => SBHash.hashJSON(S.geometryKey(o));
    const q = JSON.parse(JSON.stringify(p)); q.construction.cleanup.simplify = "busy";
    const bad = JSON.parse(JSON.stringify(p)); bad.construction.cleanup.simplify = "aggressive";
    const leg = S.fromLegacySettings({}).project;
    const r = gate(busy, { simplify: "busy" }), info = r.diagnostics.filter((d) => d.code === "BUSY_SIMPLIFIED");
    return p.construction.cleanup.simplify === "off" && a.construction.cleanup.simplify === "off" && leg.construction.cleanup.simplify === "off" &&
      S.validate(p).ok && S.validate(q).ok && S.validate(bad).errors.some((e) => e.path === "construction.cleanup.simplify" && e.code === "ENUM") &&
      H(q) !== H(p) && info.length === 1 && info[0].severity === "info" && info[0].quality === "fabrication" &&
      info[0].counts.before.join() === "1,2916" && info[0].counts.after.join() === r.estimate.partsPerLayer.join() &&
      gate(busy).diagnostics.every((d) => d.code !== "BUSY_SIMPLIFIED"); })());
  { const r = gate(busy, { simplify: "busy" });
    check("NFR-04 simplify \"busy\" brings the busy fixture under the desktop cap (merged by closing, status ok)",
      r.status === "ok" && r.estimate.maxPartsPerLayer <= desk.maxPartsPerLayer && r.simplified.closeR === 7); }
  // gap semantics at 0.1 mm/px, 1.5 mm minimum feature: closeR 7 merges gaps ≤ 14 px (< 15 px = 1.5 mm), not 15 px
  const pair = (gap) => { const w = 120, h = 60, m = new Uint8Array(w * h); for (let y = 10; y < 50; y++) for (let x = 10; x < 40; x++) { m[y * w + x] = 1; m[y * w + x + 30 + gap] = 1; }
    return { w, h, layers: [new Uint8Array(w * h).fill(1), m] }; };
  const simp = (st, o) => C.simplifyBusy(st.layers, st.w, st.h, Object.assign({}, ply, o));
  check("NFR-04 simplify merges parts closer than the minimum feature (gap 14 px = 1.4 mm merged; 15 px = 1.5 mm kept apart)",
    simp(pair(14), { minPartMM2: 1 }).after.join() === "1,1" && simp(pair(15), { minPartMM2: 1 }).after.join() === "1,2" && simp(pair(14)).before.join() === "1,2");
  check("NFR-04 simplify drops parts below minPartMM2 (24 mm² dropped, 25 mm² kept at 0.1 mm/px)", (() => {
    const blob = (side, extra) => { const w = 80, h = 80, m = new Uint8Array(w * h); for (let y = 5; y < 5 + side; y++) for (let x = 5; x < 5 + side; x++) m[y * w + x] = 1;
      for (let i = 0; i < extra; i++) m[(5 + side) * w + 5 + i] = 1; return { w, h, layers: [new Uint8Array(w * h).fill(1), m] }; };
    // 48 × 50 = 2400 px = 24 mm²; 50 × 50 = 2500 px = 25 mm² (closing keeps a convex block unchanged)
    const small = { w: 80, h: 80, layers: [new Uint8Array(6400).fill(1), (() => { const m = new Uint8Array(6400); for (let y = 5; y < 55; y++) for (let x = 5; x < 53; x++) m[y * 80 + x] = 1; return m; })()] };
    return simp(small).after.join() === "1,0" && simp(blob(50, 0)).after.join() === "1,1"; })());
  check("LYR-06 draft and fabrication apply the same rule at their own pitch (closeR 7 at 0.1 mm/px, 2 at 0.25 mm/px; minPart in µm²)",
    simp(pair(14)).closeR === 7 && simp(pair(14), { sxUm: 250, syUm: 250 }).closeR === 2 &&
    simp(pair(14), { sxUm: 250, syUm: 250 }).minPartUm2 === 25e6 && simp(pair(14)).minPartUm2 === 25e6);
  check("NFR-04 the separable closing equals SBMorph.close on the padded mask (random masks, r 1–9)", (() => {
    const rng = F.lcg(21);
    for (let t = 0; t < 12; t++) { const w = 20 + Math.floor(rng() * 40), h = 15 + Math.floor(rng() * 30), r = 1 + (t % 9), m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) m[i] = rng() < 0.15 ? 1 : 0;
      const p = r + 1, W = w + 2 * p, H = h + 2 * p, big = new Uint8Array(W * H);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) big[(y + p) * W + p + x] = m[y * w + x];
      const ref = SBMorph.close(big, W, H, r), got = C._paddedClose(m, w, h, r);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ref[(y + p) * W + p + x] !== got[y * w + x]) return false;
      for (let i = 0; i < m.length; i++) if (m[i] && !got[i]) return false; }   // extensive
    return true; })());
  check("D-4.5 simplify keeps the stack nested, leaves layer 0 and the input untouched", (() => {
    const rng = F.lcg(9), st = { w: 64, h: 48, layers: F.randomNestedStack(rng, 64, 48, 6) }, copy = st.layers.map((m) => m.slice());
    const r = C.simplifyBusy(st.layers, 64, 48, { minFeatureMM: 0.5, minPartMM2: 4, sxUm: 100, syUm: 100 });
    let nested = true; for (let k = 1; k < r.masks.length; k++) for (let i = 0; i < r.masks[k].length; i++) if (r.masks[k][i] && !r.masks[k - 1][i]) nested = false;
    return nested && r.masks[0].join() === st.layers[0].join() && r.masks[0] !== st.layers[0] && st.layers.every((m, k) => m.join() === copy[k].join()); })());
  check("NFR-05 simplify \"busy\" is deterministic (hashes ×3)", (() => {
    const s = F.busyHeightMap(6, 200, 150, 11), L = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(s, 8, "white-high"), null, 8, 200, 150);
    const hs = [0, 1, 2].map(() => { const r = C.complexityGate(L, 200, 150, Object.assign({ deviceClass: "desktop", simplify: "busy", quality: "draft" }, ply));
      return SBHash.hashJSON({ m: r.masks.map((m) => SBHash.sha256(m)), d: r.diagnostics, e: r.estimate }); });
    return hs[0] === hs[1] && hs[1] === hs[2]; })());
  check("NFR-04 simplifyBusy bad arguments are CONSTRUCT_ARG",
    codeOf(() => C.simplifyBusy(busy.layers, 160, 160, { ...ply, sxUm: 0 })) === "CONSTRUCT_ARG" && codeOf(() => C.simplifyBusy(busy.layers, 160, 160, { ...ply, minFeatureMM: -1 })) === "CONSTRUCT_ARG");

  // ---- registry
  check("§9.5 BUSY_SIMPLIFIED registered (info, process); make() carries deviceClass and counts and refuses bad ones",
    D.CODES.BUSY_SIMPLIFIED && D.CODES.BUSY_SIMPLIFIED.severity === "info" && D.CODES.BUSY_SIMPLIFIED.kind === "process" &&
    D.make("COMPLEXITY_LIMIT", { deviceClass: "mobile" }).deviceClass === "mobile" && D.make("BUSY_SIMPLIFIED", { counts: { before: [1, 9], after: [1, 2] } }).counts.after.join() === "1,2" &&
    (() => { try { D.make("COMPLEXITY_LIMIT", { deviceClass: "tablet" }); return false; } catch (e) { return true; } })() &&
    (() => { try { D.make("BUSY_SIMPLIFIED", { counts: { before: [1], after: [1, 2] } }); return false; } catch (e) { return true; } })());
});

suite("engine.js — G2.10a SBEngine.generate through validation, with the envelope check (§9.3, §11.1, GEO-02/10, AT-09, IMG-03, §12.3, PO-LASER-2)", async () => {
  const F = require("./fixtures.js"), E = SBEngine, G = SBGeom;
  check("G2.10a API present", typeof E.generate === "function" && typeof E.VERSION === "string" && typeof SBSupport.checkEnvelope === "function");
  if (typeof E.generate !== "function") return;
  E.TEST_HOOKS = true;   // Node runner only (never set in the browser, never persisted)
  const codes = (ds) => (ds || []).map((d) => d.code);
  // a project around a gray height plane (one channel, no alpha): the source record follows the plane
  const proj = (preset, w, h, edit) => { const p = SBSchema.defaults(preset); p.source = SBSchema.sourceTemplate(); p.source.w = w; p.source.h = h;
    if (edit) edit(p); return p; };
  const req = (p, pixels, w, h, o) => Object.assign({ requestId: "r1", revision: p.revision, engineVersion: E.VERSION, quality: "draft",
    normalizedSource: { pixels, channels: 1, w, h, alpha: null }, sourceHash: null, config: p, deviceClass: "desktop" }, o || {});
  const bondedRaw = (p) => { p.construction.cleanup.minFeatureMM = 0; p.construction.cleanup.holeMM2 = 0; };

  // ---- NFR-10: from PNG bytes (SBPng) to a Snapshot, in Node
  await (async () => {
    const w = 120, h = 80, hm = F.heightMap(4, w, h, 30);
    const dec = await SBPng.decode(F.pngEncode({ w, h, colorType: 0, bitDepth: 8, data: hm }), { mode: "height" });
    const p = proj("plywood", dec.w, dec.h, (q) => { q.source.sampleHash = dec.sampleHash; q.source.decode = dec.policy; });
    const r = E.generate(req(p, dec.samples, dec.w, dec.h, { normalizedSource: { pixels: dec.samples, channels: dec.channels, w: dec.w, h: dec.h, alpha: dec.alpha } }));
    const s = r.snapshot;
    check("NFR-10 generate runs in Node from PNG bytes (via SBPng) to Snapshot", r.status === "done" && !!s && s.quality === "draft" && s.layers.length === 8 &&
      r.validatedLayers === s.layers && s.engineVersion === E.VERSION && s.revision === p.revision && s.geometry.rasterW === w && s.geometry.rasterH === h &&
      s.layers.every((L, k) => L.index === k && L.material.every((poly) => poly.outer.every(Number.isInteger))) &&
      s.page.hMM === 300 && Array.isArray(s.diagnostics) && Array.isArray(s.cleanupReport) && s.cleanupReport.length === 8 && !!s.supportGraph);
    check("§3 cleanupReport in mm² per layer (GEO-08)", s.cleanupReport.every((c, k) => c.layer === k && Number.isFinite(c.addedMM2) && Number.isFinite(c.removedMM2) &&
      Number.isInteger(c.holesFilled) && Number.isInteger(c.partsRemoved)));
    check("§9.1 every snapshot diagnostic carries the request revision and quality", s.diagnostics.length > 0 && s.diagnostics.every((d) => d.revision === p.revision && d.quality === "draft"));
    check("SUP-03 parts carry their supports as part IDs (assignParts + annotate)", s.layers[1].parts.length > 0 && s.layers.slice(1).every((L) => L.parts.every((pt) => Array.isArray(pt.supports))) &&
      s.layers[2].parts.some((pt) => pt.supports.length > 0 && pt.supports.every((id) => /^L01-P\d{3}$/.test(id))));
    const twice = E.generate(req(p, dec.samples, dec.w, dec.h));
    check("NFR-05 same request → same layer hashes and diagnostics", JSON.stringify(twice.snapshot.layers.map((L) => L.canonicalHash)) === JSON.stringify(s.layers.map((L) => L.canonicalHash)) &&
      JSON.stringify(codes(twice.snapshot.diagnostics)) === JSON.stringify(codes(s.diagnostics)));
    const fab = E.generate(req(p, dec.samples, dec.w, dec.h, { quality: "fabrication" }));
    check("LYR-06 fabrication quality takes its raster from rasterPlan (FAB_EXCEEDS_SOURCE carried, diagnostics at fabrication)",
      fab.status === "done" && fab.snapshot.quality === "fabrication" && codes(fab.snapshot.diagnostics).includes("FAB_EXCEEDS_SOURCE") &&
      fab.snapshot.diagnostics.every((d) => d.quality === "fabrication"));
  })();

  // ---- §9.3 handshake, cancel, arguments
  const flat = (w, h, v) => new Uint8Array(w * h).fill(v);
  { const p = proj("plywood", 20, 10);
    const r = E.generate(req(p, flat(20, 10, 200), 20, 10, { engineVersion: "0.0.0-other" }));
    check("§9.3 engineVersion mismatch → status error ENGINE_MISMATCH", r.status === "error" && r.error.code === "ENGINE_MISMATCH" && !r.snapshot && !r.validatedLayers &&
      r.requestId === "r1" && r.revision === p.revision);
    let polls = 0; const c = E.generate(req(p, flat(20, 10, 200), 20, 10), { isCanceled: () => ++polls > 2 });
    check("§9.3 isCanceled → status canceled", c.status === "canceled" && !c.snapshot && !c.validatedLayers && polls === 3);
    const prog = []; E.generate(req(p, flat(20, 10, 200), 20, 10), { onProgress: (st, f) => prog.push([st, f]) });
    check("§9.3 onProgress(stage, frac) reports stages with a non-decreasing fraction in [0, 1], ending at 1",
      prog.length >= 5 && prog.every(([st, f], i) => typeof st === "string" && f >= 0 && f <= 1 && (i === 0 || f >= prog[i - 1][1])) && prog[prog.length - 1][1] === 1);
    const noHook = (() => { E.TEST_HOOKS = false; try { return E.generate(req(p, flat(20, 10, 200), 20, 10, { debug: { smoothBonded: true } })); } finally { E.TEST_HOOKS = true; } })();
    check("AT-09 the smoothBonded hook is refused unless SBEngine.TEST_HOOKS is set", noHook.status === "error" && noHook.error.code === "ENGINE_DEBUG_DISABLED");
    const bad = E.generate(req(p, flat(20, 10, 200), 20, 10, { normalizedSource: { pixels: flat(20, 10, 1), channels: 1, w: 21, h: 10, alpha: null } }));
    check("§9.3 malformed request → status error with a code, never a throw", bad.status === "error" && typeof bad.error.code === "string");
    const nos = E.generate(req(Object.assign(proj("plywood", 20, 10), { source: null }), flat(20, 10, 1), 20, 10));
    check("PRJ-01 no source → status error NO_SOURCE", nos.status === "error" && nos.error.code === "NO_SOURCE"); }

  // ---- GEO-02 stage order: frame union after smoothing; frame and base rings stay exact rectangles
  { const w = 90, h = 60, s = F.heightMap(2, w, h, 25);
    const p = proj("acrylic", w, h, (q) => { q.interpretation = { mode: "height", polarity: "white-high", thresholdRule: "balanced", manual: [], smoothing: { radiusMM: 0, passes: 0 }, heightFilter: null };
      // 2 mm frame, art 2 mm high on 60 px (33 µm/px), so some art loops round within the 50 µm tolerance
      q.construction.registration.enabled = false; q.construction.registration.diaMM = 1; q.construction.frame.widthMM = 2; q.geometry.sizeBy = "height"; q.geometry.targetMM = 6; });
    const r = E.generate(req(p, s, w, h)), S = r.snapshot;
    const W = Math.round(S.page.wMM * 1000), H = Math.round(S.page.hMM * 1000), rect = [0, 0, W, 0, W, H, 0, H].join();
    check("GEO-02 stage order: frame and base rings are exact rectangles after smoothing (cornerStyle smooth)", r.status === "done" &&
      p.construction.cleanup.cornerStyle === "smooth" &&
      S.layers[0].material.length === 1 && S.layers[0].material[0].outer.join() === rect && S.layers[0].material[0].holes.length === 0 &&
      S.layers.every((L) => L.material.length === 0 || L.material.some((poly) => poly.outer.join() === rect)) &&
      // smoothing really ran on the art loops (a non-axis-parallel edge in some sheet's art boundary)
      S.layers.slice(1).some((L) => L.material.some((poly) => poly.holes.some((r) => r.some((v, i) => i % 2 === 0 && v !== r[(i + 2) % r.length] && r[i + 1] !== r[(i + 3) % r.length])))));
    check("§12.3 connected mode: one part per non-empty sheet or CONNECTED_SPLIT (frame-anchored islands bridged)",
      S.layers.every((L) => L.material.length <= 1) || codes(S.diagnostics).includes("CONNECTED_SPLIT"));
    const p2 = JSON.parse(JSON.stringify(p)); p2.construction.registration.enabled = true;
    const r2 = E.generate(req(p2, s, w, h));
    check("G1.7 legacy connected corner holes until G3.1: four holes on every layer at frame/2", r2.status === "done" &&
      r2.snapshot.layers.every((L) => L.holes.length === 4 && L.holes[0].cxUm === 1000 && L.holes[0].cyUm === 1000 && L.holes[0].rUm === 500)); }

  // ---- AT-09 / D1: smoothing overhang caught end to end by final validation (test-only hook)
  // The 2-layer crescentInterior cannot overhang under smoothing (its base is the full rectangle and is never smoothed;
  // spike S2 checked "crescentInterior has no overhang"). The fixture is the 3-sheet derivative: sheet 1 = the crescent plus
  // one pixel below its lower arm, sheet 2 = the crescent, set at 25 µm/px in a 40 × 40 px canvas (art 1 × 1 mm). Chaikin on
  // sheet 1 rounds the corner the extra pixel creates, so sheet 2's corner bulges past it although the masks nest.
  const ci = F.MASKS.crescentInterior, CW = 40, CH = 40, ox = 14, oy = 15, hs = new Uint8Array(CW * CH);
  for (let y = 0; y < ci.h; y++) for (let x = 0; x < ci.w; x++) if (ci.layers[1][y * ci.w + x]) hs[(y + oy) * CW + x + ox] = 255;
  hs[(8 + oy) * CW + 4 + ox] = 128;
  const at9 = (edit) => proj("plywood", CW, CH, (q) => { bondedRaw(q); q.construction.sheets = 3; q.construction.cleanup.cornerStyle = "smooth"; q.geometry.targetMM = 1; if (edit) edit(q); });
  { const p = at9();
    const raw = E.generate(req(p, hs, CW, CH)), hooked = E.generate(req(p, hs, CW, CH, { debug: { smoothBonded: true } }));
    const masks = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(hs, 3, "white-high"), null, 3, CW, CH);
    let nested = true; for (let k = 1; k < 3; k++) for (let i = 0; i < masks[k].length; i++) if (masks[k][i] && !masks[k - 1][i]) nested = false;
    const bu = hooked.snapshot.diagnostics.filter((d) => d.code === "BOND_UNSUPPORTED");
    check("AT-09 crescentInterior, bonded, cornerStyle smooth, smoothBonded hook → final validation reports BOND_UNSUPPORTED although masks nested",
      hooked.status === "done" && nested && bu.length === 1 && bu[0].layer === 2 && bu[0].areaMM2 > 0);
    const lattice = SBMaterial.fromMasks(masks, CW, CH, { artWMM: 1, artHMM: 1, frameMM: 0 }, {});
    check("AT-09/D1 same without the hook → bonded layers are raw lattice contours, no BOND_UNSUPPORTED, no SMOOTH_FALLBACK",
      raw.status === "done" && JSON.stringify(raw.snapshot.layers.map((L) => L.material)) === JSON.stringify(lattice.map((L) => L.material)) &&
      !codes(raw.snapshot.diagnostics).some((c) => c === "BOND_UNSUPPORTED" || c === "SMOOTH_FALLBACK"));
    const prop = SBSupport.proposeClip(hooked.snapshot, 2), L2 = hooked.snapshot.layers;
    const P1 = SBSupport.applyClip(p, prop), again = E.generate(req(P1, hs, CW, CH, { debug: { smoothBonded: true } }));
    check("AT-09 proposeClip on the hooked result removes exactly the overhang, then rerun reports none",
      JSON.stringify(G.normalize(prop.removed)) === JSON.stringify(G.normalize(G.difference(L2[2].material, L2[1].material))) &&
      Math.abs(prop.removedAreaMM2 - bu[0].areaMM2) < 1e-12 && again.status === "done" &&
      !codes(again.snapshot.diagnostics).some((c) => c === "BOND_UNSUPPORTED" || c === "REPAIR_STALE") && again.snapshot.layers[2].canonicalHash === prop.afterHash);
    check("D-4.6 no clip without a repairs[] entry: the engine output still reports BOND_UNSUPPORTED", p.construction.repairs.length === 0 && bu.length === 1);
    const P2 = JSON.parse(JSON.stringify(P1)); P2.material.minFeatureMM = 1.6;
    const st = E.generate(req(P2, hs, CW, CH, { debug: { smoothBonded: true } }));
    check("SUP-04 stage 9 replays repairs: a settings change → REPAIR_STALE and the overhang is back", st.status === "done" &&
      codes(st.snapshot.diagnostics).includes("REPAIR_STALE") && codes(st.snapshot.diagnostics).includes("BOND_UNSUPPORTED")); }

  // ---- IMG-03: height mode does not smooth unless heightFilter is set
  { const R = SBRaster, Hh = SBHeight, orig = { k: R.kuwahara, t: R.thresholds, f: Hh.applyFilter }, n = { k: 0, t: 0, f: 0 };
    R.kuwahara = (...a) => (n.k++, orig.k(...a)); R.thresholds = (...a) => (n.t++, orig.t(...a)); Hh.applyFilter = (...a) => (n.f++, orig.f(...a));
    try {
      const w = 60, h = 40, s = F.heightMap(5, w, h, 12), p = proj("plywood", w, h);
      const a = E.generate(req(p, s, w, h)), n0 = Object.assign({}, n);
      const pf = proj("plywood", w, h, (q) => { q.interpretation.heightFilter = { op: "median", radiusMM: 0.5 }; });
      const b = E.generate(req(pf, s, w, h));
      const nb = Object.assign({}, n), pt = proj("acrylic", w, h);
      const c = E.generate(req(pt, s, w, h));
      check("IMG-03 height mode does not smooth unless heightFilter is set (spy on kuwahara, thresholds and applyFilter)",
        a.status === "done" && n0.k === 0 && n0.t === 0 && n0.f === 0 && !codes(a.snapshot.diagnostics).includes("HEIGHT_FILTERED") &&
        b.status === "done" && nb.f === 1 && nb.k === 0 && nb.t === 0 && codes(b.snapshot.diagnostics).includes("HEIGHT_FILTERED"));
      check("IMG-03 tonal mode runs Kuwahara and thresholds (domain-aware) on luminance", c.status === "done" && n.k === 1 && n.t === 1 && n.f === 1);
    } finally { R.kuwahara = orig.k; R.thresholds = orig.t; Hh.applyFilter = orig.f; } }

  // ---- §12.3 complexity caps before trace
  { const w = 360, h = 340, s = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) s[y * w + x] = 255;   // 180 × 170 = 30,600 isolated dots
    const p = proj("plywood", w, h, (q) => { bondedRaw(q); q.construction.sheets = 2; });
    const tr = SBTrace.trace; let traced = 0; SBTrace.trace = (...a) => (traced++, tr(...a));
    let r; try { r = E.generate(req(p, s, w, h)); } finally { SBTrace.trace = tr; }
    const cl = (r.diagnostics || []).filter((d) => d.code === "COMPLEXITY_LIMIT");
    check("§12.3 30k-part noise input → COMPLEXITY_LIMIT, no layers returned", r.status === "error" && r.error.code === "COMPLEXITY_LIMIT" &&
      !r.snapshot && !r.validatedLayers && cl.length === 1 && cl[0].severity === "blocking" && cl[0].layer === 1 && cl[0].measured.value === 30600 &&
      cl[0].limit.value === SBSchema.limits("desktop").maxPartsPerLayer && cl[0].deviceClass === "desktop" && traced === 0);
    // one part with many vertices: 2-px diagonal staircase stripes joined by a spine column and row (passes the 100-part mobile cap)
    const n = 160, zig = new Uint8Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) zig[y * n + x] = x === 0 || y === n - 1 || (x + y) % 4 < 2 ? 255 : 0;
    const pm = proj("plywood", n, n, (q) => { bondedRaw(q); q.construction.sheets = 2; q.geometry.targetMM = 160; });
    const desk = E.generate(req(pm, zig, n, n)), mv = E.generate(req(pm, zig, n, n, { deviceClass: "mobile" }));
    const v1 = desk.status === "done" ? desk.snapshot.layers[1].stats.vertices : -1;
    check("§12.3 vertex caps after fromMasks: one 1-part layer over the mobile vertex cap → COMPLEXITY_LIMIT (vertices), no layers; desktop passes",
      desk.status === "done" && desk.snapshot.layers[1].parts.length === 1 && v1 > SBSchema.limits("mobile").maxVerticesPerLayer &&
      mv.status === "error" && mv.error.code === "COMPLEXITY_LIMIT" && !mv.snapshot && !mv.validatedLayers &&
      mv.diagnostics.some((d) => d.code === "COMPLEXITY_LIMIT" && d.measured.unit === "vertices" && d.deviceClass === "mobile")); }

  // ---- bonded-gated performance: SBMorph dilate/erode are O(w·h) separable passes, exactly equal to the iterated 3×3
  check("NFR-03 SBMorph.dilate/erode (separable, O(w·h)) equal the iterated 3×3 reference, borders included (random masks, r 0–12, sizes 1–40)", (() => {
    if (typeof SBMorph._dilateIter !== "function" || typeof SBMorph._erodeIter !== "function") return false;
    const rng = F.lcg(31);
    for (let t = 0; t < 120; t++) { const w = 1 + Math.floor(rng() * 40), h = 1 + Math.floor(rng() * 40), r = t % 13, dens = 0.2 + 0.6 * rng(), m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) m[i] = rng() < dens ? 1 : 0;
      const a = SBMorph.dilate(m, w, h, r), b = SBMorph._dilateIter(m, w, h, r), c = SBMorph.erode(m, w, h, r), d = SBMorph._erodeIter(m, w, h, r);
      if (a.join() !== b.join() || c.join() !== d.join() || a === m || c === m) return false; }
    return true; })());
  { const n = 1000, st = SBHeight.cumulativeMasks(SBHeight.addedFromSamples(F.heightMap(1, n, n), 8, "white-high"), null, 8, n, n);
    const t0 = Date.now(); SBConstruct.bonded(st, n, n, { featR: 8, bridgeR: 8, cullPx: 0, maxBridgePx: 0, speckPx: 0, holePx: 2500, frameAnchored: false, cullEnabled: false });
    const ms = Date.now() - t0;
    check("NFR-03 bonded construction at fabrication radius (featR 8, 1 Mpx × 8 layers) runs in O(w·h): under 2.5 s (was 5.3 s iterated) — " + ms + " ms", ms < 2500); }

  // ---- PO-LASER-2 / GEO-10: the machine envelope (SBSupport.checkEnvelope and end to end)
  { const env = (wMM, hMM, edit) => { const p = SBSchema.defaults("plywood"); if (edit) edit(p); return SBSupport.checkEnvelope({ wMM, hMM }, p.machine, p.material, { revision: 0, quality: "draft" }); };
    check("PO-LASER-2/GEO-10 page 480 × 300 mm on xTool S1 + feeder → fits (rotated: 300 ≤ 470, 480 ≤ 3000)", env(480, 300).length === 0 && env(300, 480).length === 0);
    const of = env(480, 480);
    check("PO-LASER-2/GEO-10 page 480 × 480 mm → PAGE_OVERFLOW blocking (measured page vs limit)", codes(of).join() === "PAGE_OVERFLOW" && of[0].severity === "blocking" &&
      of[0].measured.value === 480 && of[0].limit.value === 470 && /machine profile/.test(of[0].fix));
    check("PO-LASER-2 the boundary is inclusive and compared in µm (470 × 3000 fits; 470.001 × 470.001 overflows)", env(470, 3000).length === 0 && env(3000, 470).length === 0 &&
      codes(env(470.001, 470.001)).join() === "PAGE_OVERFLOW" && codes(env(3000.001, 10)).join() === "PAGE_OVERFLOW");
    const th = env(100, 100, (p) => { p.material.thicknessMM = 15; });
    check("PO-LASER-2 thickness 15 mm → MACHINE_THICKNESS", codes(th).join() === "MACHINE_THICKNESS" && th[0].severity === "blocking" && SBDiag.CODES.MACHINE_THICKNESS &&
      th[0].measured.value === 15 && th[0].limit.value === 14 && env(100, 100, (p) => { p.material.thicknessMM = 14; }).length === 0);
    check("GEO-10 machine null → no envelope diagnostics", SBSupport.checkEnvelope({ wMM: 5000, hMM: 5000 }, null, { thicknessMM: 25 }, {}).length === 0);
    // end to end: the page is the shared extent of every sheet, frame included; geometry is never rescaled
    const run = (artMM, frameMM) => { const p = proj("plywood", 46, 46, (q) => { q.construction.sheets = 2; q.geometry.targetMM = artMM + 2 * frameMM;
      q.construction.frame = { enabled: frameMM > 0, widthMM: frameMM }; }); return E.generate(req(p, flat(46, 46, 255), 46, 46)); };
    const fit = run(460, 0), over = run(460, 10);
    const ext = (S) => { const b = S.layers[0].material.map((poly) => G.bbox(poly)); return [Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))]; };
    check("PO-LASER-2 frame counts: art 460 × 460 fits, the same art with a 10 mm frame (page 480 × 480) → PAGE_OVERFLOW",
      fit.status === "done" && !codes(fit.snapshot.diagnostics).includes("PAGE_OVERFLOW") &&
      over.status === "done" && codes(over.snapshot.diagnostics).includes("PAGE_OVERFLOW") && over.snapshot.geometry.artWMM === 460);
    check("PO-LASER-2/GEO-10 page 480 × 480 mm → PAGE_OVERFLOW blocking, geometry not rescaled",
      over.snapshot.page.wMM === 480 && over.snapshot.page.hMM === 480 && ext(over.snapshot).join() === "480000,480000");
    const nm = (() => { const p = proj("plywood", 46, 46, (q) => { q.construction.sheets = 2; q.geometry.targetMM = 2000; q.machine = null; q.material.thicknessMM = 20; });
      return E.generate(req(p, flat(46, 46, 255), 46, 46)); })();
    check("GEO-10 machine null → no envelope diagnostics (end to end)", nm.status === "done" && !codes(nm.snapshot.diagnostics).some((c) => c === "PAGE_OVERFLOW" || c === "MACHINE_THICKNESS")); }
});

suite("engine.js — G2.10b Z model, accounting, hashes, freeze and the draft/fab rule (§3, §9.2, LYR-01/05/06, MAT-01, UI-03, D-4.7, NFR-05, PRJ-02, AT-03/04/11)", () => {
  const F = require("./fixtures.js"), E = SBEngine, G = SBGeom;
  E.TEST_HOOKS = true;
  const codes = (ds) => (ds || []).map((d) => d.code);
  const proj = (preset, w, h, edit) => { const p = SBSchema.defaults(preset); p.source = SBSchema.sourceTemplate(); p.source.w = w; p.source.h = h;
    if (edit) edit(p); return p; };
  const req = (p, pixels, w, h, o) => Object.assign({ requestId: "r1", revision: p.revision, engineVersion: E.VERSION, quality: "draft",
    normalizedSource: { pixels, channels: 1, w, h, alpha: null }, sourceHash: null, config: p, deviceClass: "desktop" }, o || {});
  const flat = (w, h, v) => new Uint8Array(w * h).fill(v);
  const clone = (p) => JSON.parse(JSON.stringify(p));
  const um = (mm) => Math.round(mm * 1000);
  // a horizontal 0..255 ramp occupies every one of the 8 plywood sheets
  const w = 64, h = 40, ramp = F.ramp(w, h);
  const p8 = proj("plywood", w, h, (q) => { q.geometry.targetMM = 40; });
  const r8 = E.generate(req(p8, ramp, w, h)), S8 = r8.snapshot;
  check("G2.10b generate done on the ramp fixture", r8.status === "done" && S8.layers.length === 8);
  if (r8.status !== "done") return;

  const KEYS = ["index", "zBottomMM", "zTopMM", "material", "carriers", "parts", "cutPaths", "scorePaths", "diagnostics", "canonicalHash"];
  check("§9.2 each layer has index,zBottomMM,zTopMM,material,carriers,parts,cutPaths,scorePaths,diagnostics,canonicalHash",
    S8.layers.every((L, k) => KEYS.every((key) => Object.prototype.hasOwnProperty.call(L, key) && L[key] !== null && L[key] !== undefined) &&
      L.index === k && Number.isFinite(L.zBottomMM) && Number.isFinite(L.zTopMM) && Array.isArray(L.carriers) && L.carriers.length === 0 &&
      typeof L.canonicalHash === "string" && L.canonicalHash === G.materialHash(L)));
  check("UI-03/D1 bonded: g = 0, zBottom(k) = k·t, zTop = zBottom + t (µm integers)",
    S8.layers.every((L, k) => um(L.zBottomMM) === k * 6350 && um(L.zTopMM) === (k + 1) * 6350 && L.zBottomMM === (k * 6350) / 1000));
  const st = S8.stats;
  check("AT-03 N=8 t=6.35 → stats.stockMM 50.8, reliefMM 44.45", !!st && st.stockMM === 50.8 && st.reliefMM === 44.45 && st.maxZMM === 50.8 &&
    st.requested === 8 && st.exported === 8 && Array.isArray(st.omitted) && st.omitted.length === 0 && !codes(S8.diagnostics).includes("TRAILING_OMITTED"));
  { const q = clone(p8); q.extras = { adhesiveMM: 0.4, finishMM: 0.2 }; q.appearance.color = "#000000"; q.material.thicknessState = "measured";
    const rq = E.generate(req(q, ramp, w, h));
    check("MAT-01 stockMM excludes adhesive/finish (no such input affects it)", rq.status === "done" && rq.snapshot.stats.stockMM === 50.8 &&
      rq.snapshot.stats.reliefMM === 44.45 && rq.snapshot.stats.maxZMM === 50.8); }

  // ---- connected gap (UI-03)
  { const pc = proj("acrylic", w, h, (q) => { q.material.thicknessMM = 6.35; q.construction.gapMM = 3; q.geometry.sizeBy = "width"; q.geometry.targetMM = 80;
      q.construction.registration.enabled = false; });
    const rc = E.generate(req(pc, ramp, w, h)), L = rc.status === "done" ? rc.snapshot.layers : [];
    check("UI-03 connected g=3: zBottom(2) = 2*(6.35+3)", rc.status === "done" && um(L[2].zBottomMM) === 2 * (6350 + 3000) && L[2].zBottomMM === 18.7 &&
      um(L[2].zTopMM) === 2 * 9350 + 6350 && L.every((x, k) => um(x.zBottomMM) === k * 9350));
    check("UI-03 connected: stock excludes the gap; maxZMM is the assembled envelope N·t + (N−1)·g",
      rc.snapshot.stats.stockMM === 31.75 && rc.snapshot.stats.reliefMM === 25.4 && um(rc.snapshot.stats.maxZMM) === 5 * 6350 + 4 * 3000); }

  // ---- trailing empties (D-4.7, AT-04, LYR-05): flat 182/255 → nearest level 5 of 0..7 → sheets 0..5 occupied
  { const pf = proj("plywood", w, h, (q) => { q.geometry.targetMM = 40; });
    const rf = E.generate(req(pf, flat(w, h, 182), w, h)), S = rf.snapshot;
    const tr = rf.status === "done" ? S.diagnostics.filter((d) => d.code === "TRAILING_OMITTED") : [];
    check("D-4.7/AT-04 trailing empty omitted with index preserved; requested 8, exported 6; maxZMM uses exported", rf.status === "done" &&
      S.layers.length === 8 && S.layers.map((L) => L.index).join() === "0,1,2,3,4,5,6,7" &&
      S.layers.map((L) => L.status).join() === "ok,ok,ok,ok,ok,ok,omitted-trailing,omitted-trailing" &&
      S.stats.requested === 8 && S.stats.exported === 6 && S.stats.omitted.join() === "6,7" && S.stats.maxZMM === 38.1 &&
      um(S.layers[7].zBottomMM) === 7 * 6350 &&
      tr.length === 1 && tr[0].severity === "warning" && tr[0].quality === "draft" && tr[0].revision === pf.revision && !codes(S.diagnostics).includes("BOND_EMPTY_UNDER"));
    check("D-4.7 stock and relief stay the nominal N·t and (N−1)·t (SRS §4.3)", S.stats.stockMM === 50.8 && S.stats.reliefMM === 44.45);
    check("LYR-05 identical layers kept", S.layers.slice(1, 6).every((L) => L.status === "ok" && L.material.length > 0 &&
      JSON.stringify(L.material) === JSON.stringify(S.layers[1].material)) && codes(S.diagnostics).includes("IDENTICAL_LAYERS"));
    const hashes = S.layers.map((L) => G.layerHashes(L).layerHash);
    check("D4 geometryHash = hashJSON({key, engine, quality, raster, layers: one layerHash per index incl. omitted, guides})",
      S.geometryHash === SBHash.hashJSON({ key: SBSchema.geometryKey(pf), engine: E.VERSION, quality: "draft",
        raster: [S.geometry.rasterW, S.geometry.rasterH], layers: hashes, guides: E.guideHash(S.guides) }) && rf.geometryHash === S.geometryHash); }

  // ---- hashes (NFR-05, PRJ-02, AT-11, LYR-06)
  { const a = E.generate(req(p8, ramp, w, h)), b = E.generate(req(clone(p8), ramp.slice(), w, h));
    check("NFR-05 same request → same geometryHash ×3", typeof S8.geometryHash === "string" && /^[0-9a-f]{64}$/.test(S8.geometryHash) &&
      a.snapshot.geometryHash === S8.geometryHash && b.snapshot.geometryHash === S8.geometryHash); }
  { const q = clone(p8); q.appearance = { mode: "palette", color: "#123456", palette: "dusk" }; q.title = "Renamed"; q.revision = p8.revision + 1;
    const r = E.generate(req(q, ramp, w, h));
    check("PRJ-02 appearance-only change → same geometryHash", r.status === "done" && r.snapshot.geometryHash === S8.geometryHash);
    const t = clone(p8); t.material.thicknessMM = 6; const rt = E.generate(req(t, ramp, w, h));
    check("§3 a geometry change (thickness, hence Z) changes geometryHash", rt.status === "done" && rt.snapshot.geometryHash !== S8.geometryHash); }
  { const q0 = clone(p8), qm = clone(p8); q0.view.explodeMM = 0; qm.view.explodeMM = 1000;
    const a = E.generate(req(q0, ramp, w, h)), b = E.generate(req(qm, ramp, w, h));
    check("AT-11/UI-03 view.explodeMM 0 vs max → same geometryHash", a.status === "done" && b.status === "done" && a.snapshot.geometryHash === b.snapshot.geometryHash &&
      a.snapshot.geometryHash === S8.geometryHash && a.snapshot.layers.every((L, k) => L.zBottomMM === b.snapshot.layers[k].zBottomMM)); }
  { const fab = E.generate(req(p8, ramp, w, h, { quality: "fabrication" }));
    check("LYR-06 draft and fab geometryHash differ; diagnostics carry their quality", fab.status === "done" && fab.snapshot.geometryHash !== S8.geometryHash &&
      fab.snapshot.diagnostics.length > 0 && fab.snapshot.diagnostics.every((d) => d.quality === "fabrication") &&
      S8.diagnostics.every((d) => d.quality === "draft") && fab.snapshot.layers.every((L) => L.diagnostics.every((d) => d.quality === "fabrication")));
    check("LYR-06 a draft ack never satisfies the fabrication snapshot (ackKey scoped to geometryHash)",
      S8.diagnostics.filter((d) => d.severity === "warning").every((d) => SBDiag.ackKey(d, S8.geometryHash) !== SBDiag.ackKey(d, fab.snapshot.geometryHash))); }

  // ---- freeze (deep)
  const frozenDeep = (o, seen) => { if (!o || typeof o !== "object") return true; if (ArrayBuffer.isView(o)) return true; if (!Object.isFrozen(o)) return false;
    if (seen.has(o)) return true; seen.add(o); return Object.values(o).every((v) => frozenDeep(v, seen)); };
  check("§3 response, snapshot and every layer are deep-frozen", Object.isFrozen(r8) && frozenDeep(r8, new Set()) && Object.isFrozen(S8.layers[3].material[0].outer) &&
    Object.isFrozen(S8.diagnostics[0]) && Object.isFrozen(S8.stats.omitted) && r8.validatedLayers === S8.layers);
  check("§3 frozen output: a write to a layer throws in strict mode", (() => { try { S8.layers[0].zBottomMM = 99; return false; } catch (e) { return e instanceof TypeError; } })());
  check("§3 error responses are frozen too", Object.isFrozen(E.generate(req(p8, ramp, w, h, { engineVersion: "0.0.0-x" }))));
  check("§3 guideHash covers labels, omissions and the map; null guides hash as null (G3.1 fills them)", E.guideHash(null) === SBHash.hashJSON(null) &&
    E.guideHash({ labels: [], omitted: [], map: null }) !== E.guideHash(null));
});

suite("schema.js/app.js — G2.11a controller state adapter: legacyState, applyLegacy, canGenerate; no auto-demo (PRJ-01, PRJ-02)", () => {
  const S = SBSchema;
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const keepM = /function settingsJSON\(\)\s*\{\s*const keep = \[([\s\S]*?)\];/.exec(appSrc);
  const KEYS = keepM ? Array.from(keepM[1].matchAll(/"([A-Za-z0-9]+)"/g), (m) => m[1]) : [];
  // v1.1.0 app.js `state` defaults (the settings keys), as shipped in v1.1.0.
  const V110 = { projectName: "untitled", sourceName: null, procRes: 720, smoothRadius: 4, smoothPasses: 2, nSheets: 5,
    thresholdMode: "balanced", darkFront: true, palette: "Midnight (Starry Night)", widthMM: 300, marginMM: 12, minFeatureMM: 1.2,
    bridgeMM: 1.8, cullBelowMM2: 9, maxBridgeMM: 40, holes: true, holeDiaMM: 4, cornerStyle: "smooth", detailEps: 0.8 };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const codeOf = (f) => { try { f(); return null; } catch (e) { return e.code; } };

  const A = S.defaults("acrylic"), A0 = JSON.stringify(A);
  check("PRJ-01 legacyState(defaults(\"acrylic\")) reproduces v1.1.0 state keys",
    KEYS.length === 19 && same(Object.keys(S.legacyState(A)).sort(), KEYS.slice().sort()) && same(sorted(S.legacyState(A)), sorted(V110)));
  check("PRJ-01 legacyState is pure (input not mutated, fresh object each call)",
    JSON.stringify(A) === A0 && S.legacyState(A) !== S.legacyState(A));

  // Round trip with the G2.4b importer: every mapped v1.1.0 value comes back.
  const ALT = { projectName: "Renamed", sourceName: "x.png", procRes: 720, smoothRadius: 6, smoothPasses: 3, nSheets: 7, thresholdMode: "linear",
    darkFront: false, palette: "Ember", widthMM: 420, marginMM: 0, minFeatureMM: 2, bridgeMM: 2.5, cullBelowMM2: 20, maxBridgeMM: 60,
    holes: false, holeDiaMM: 6, cornerStyle: "faceted", detailEps: 1.6 };
  check("DEP-04 legacyState(fromLegacySettings(x).project) === x (defaults and every key changed)",
    same(sorted(S.legacyState(S.fromLegacySettings(V110).project)), sorted(V110)) &&
    same(sorted(S.legacyState(S.fromLegacySettings(ALT).project)), sorted(ALT)));

  const P = S.defaults("plywood"), LP = S.legacyState(P), LP2 = S.legacyState(P, 600, 400);
  check("PRJ-01 legacyState(plywood): height sizing needs the source for widthMM; white-high → darkFront false; sharp → faceted; no frame, no holes",
    LP.widthMM === null && LP2.widthMM === 450 && LP.darkFront === false && LP.cornerStyle === "faceted" && LP.marginMM === 0 &&
    LP.holes === false && LP.nSheets === 8 && LP.minFeatureMM === 1.5 && LP.smoothRadius === 0);
  check("PRJ-01 legacyState: black-high and dark-front both map to darkFront true", (() => {
    const q = JSON.parse(JSON.stringify(P)); q.interpretation.polarity = "black-high"; return S.legacyState(q).darkFront === true; })());

  // applyLegacy: the controller's one write path from a v1.1.0 control to the project.
  const SET = { projectName: "Renamed", procRes: 1000, smoothRadius: 6, smoothPasses: 3, nSheets: 7, thresholdMode: "linear", darkFront: false,
    palette: "Ember", widthMM: 420, marginMM: 20, minFeatureMM: 2, bridgeMM: 2.5, cullBelowMM2: 20, maxBridgeMM: 60, holes: false,
    holeDiaMM: 6, cornerStyle: "faceted" };
  check("PRJ-01 applyLegacy: every control key reads back through legacyState, the result validates, input not mutated",
    Object.keys(SET).every((k) => { const q = S.applyLegacy(A, k, SET[k]); return S.legacyState(q)[k] === SET[k] && S.validate(q).ok; }) &&
    JSON.stringify(A) === A0);
  check("PRJ-02 applyLegacy bumps revision exactly when the geometry key changes (title and palette do not)",
    Object.keys(SET).every((k) => S.applyLegacy(A, k, SET[k]).revision === (k === "projectName" || k === "palette" ? 0 : 1)) &&
    S.applyLegacy(A, "nSheets", 5).revision === 0);
  check("PRJ-01 applyLegacy widthMM keeps the frame; marginMM keeps the art width (targetMM = art + 2·frame)", (() => {
    const w = S.applyLegacy(A, "widthMM", 420), m = S.applyLegacy(A, "marginMM", 20), z = S.applyLegacy(A, "marginMM", 0);
    return w.geometry.targetMM === 444 && S.legacyState(w).marginMM === 12 && m.geometry.targetMM === 340 && S.legacyState(m).widthMM === 300 &&
      z.construction.frame.enabled === false && z.geometry.targetMM === 300 && S.legacyState(z).widthMM === 300; })());
  check("PRJ-01 applyLegacy keeps the v1.1.0 derivations (speck = cull·0.5, hole fill = minFeature²·2, advisory ≥ minimum)", (() => {
    const c = S.applyLegacy(A, "cullBelowMM2", 20), f = S.applyLegacy(A, "minFeatureMM", 2);
    return c.construction.cleanup.speckMM2 === 10 && c.material.minPartMM2 === 20 && f.construction.cleanup.holeMM2 === 8 &&
      f.material.minFeatureMM === 2 && f.material.advisoryFeatureMM === 2; })());
  check("PRJ-01 applyLegacy darkFront follows the interpretation mode (height → black-high / white-high)",
    S.applyLegacy(P, "darkFront", true).interpretation.polarity === "black-high" && S.applyLegacy(A, "darkFront", false).interpretation.polarity === "light-front");
  check("PRJ-01 applyLegacy rejects keys that are not project state (sourceName, detailEps, unknown) with SCHEMA_LEGACY",
    ["sourceName", "detailEps", "sheets"].every((k) => codeOf(() => S.applyLegacy(A, k, 1)) === "SCHEMA_LEGACY"));

  // canGenerate: the pure guard in front of regenerate().
  const src = { w: 600, h: 400 };
  check("PRJ-01 regenerate is not callable without a source", (() => {
    const g = S.canGenerate(A, null), u = S.canGenerate(A, undefined), ok = S.canGenerate(A, src);
    return g.ok === false && g.reason === "Choose a source" && u.ok === false && ok.ok === true && ok.reason === null; })());
  check("PRJ-01 canGenerate refuses an invalid project with the failing path", (() => {
    const q = JSON.parse(JSON.stringify(A)); q.construction.sheets = 40; const g = S.canGenerate(q, src);
    return g.ok === false && /construction\.sheets/.test(g.reason); })());
  check("PRJ-01 app.js: project replaces state, regenerate() is guarded by SBSchema.canGenerate, no auto-demo click",
    /let project = SBSchema\.defaults\(/.test(appSrc) && !/const state = \{/.test(appSrc) && !/runPipeline/.test(appSrc) &&
    /function regenerate\(\)\s*\{[\s\S]{0,400}SBSchema\.canGenerate\(/.test(appSrc) && !/\$\("btn-demo"\)\.click\(\)/.test(appSrc) &&
    /SBSchema\.legacyState\(/.test(appSrc) && /SBSchema\.applyLegacy\(/.test(appSrc));
});

suite("index.html/app.js/schema.js — G2.11b stages, the fabrication pitch input and slider ranges (UI-01, PO-LASER-4, LYR-01)", () => {
  const S = SBSchema;
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const tagOf = (id) => { const m = new RegExp("<[a-z]+\\b[^>]*\\bid=\"" + id + "\"[^>]*>").exec(html); return m ? m[0] : ""; };
  const attr = (tag, a) => { const m = new RegExp("\\b" + a + "=\"([^\"]*)\"").exec(tag); return m ? m[1] : null; };
  const STAGES = ["Source", "Interpretation", "Construction", "Review", "Export"];
  const IDS = STAGES.map((s) => "stage-" + s.toLowerCase());
  const rail = (/<aside class="rail"[\s\S]*?<\/aside>/.exec(html) || [""])[0];
  const sections = Array.from(rail.matchAll(/<section class="step"[^>]*\bid="([^"]+)"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/g),
    (m) => ({ id: m[1], title: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), tag: m[0] }));

  check("UI-01 rail stages are Source / Interpretation / Construction / Review / Export, in that order",
    sections.length === 5 && sections.every((s, i) => s.id === IDS[i] && s.title.endsWith(STAGES[i]) && s.title.startsWith(String(i + 1))));
  check("UI-01 each stage is a labelled, focusable region (aria-labelledby, tabindex=-1)",
    sections.length === 5 && sections.every((s) => attr(s.tag, "tabindex") === "-1" && attr(s.tag, "aria-labelledby") &&
      new RegExp("<h2[^>]*id=\"" + attr(s.tag, "aria-labelledby") + "\"").test(s.tag)));
  const nav = (/<nav class="stagenav"[\s\S]*?<\/nav>/.exec(rail) || [""])[0];
  const links = Array.from(nav.matchAll(/<a [^>]*href="#([^"]+)"/g), (m) => m[1]);
  check("UI-01 stage navigation reaches every stage by keyboard in order (links before the stages in tab order)",
    JSON.stringify(links) === JSON.stringify(IDS) && rail.indexOf(nav) >= 0 && rail.indexOf(nav) < rail.indexOf("<section"));

  // PO-LASER-4: #in-res becomes the fabrication pitch; the draft resolution (720 px) is not a user control.
  const res = tagOf("in-res");
  check("PO-LASER-4 #in-res is the \"Fabrication pitch (mm/px)\" number input, min 0.05 max 2 step 0.01, default 0.1",
    attr(res, "type") === "number" && attr(res, "min") === "0.05" && attr(res, "max") === "2" && attr(res, "step") === "0.01" &&
    attr(res, "value") === "0.1" && /<label for="in-res">Fabrication pitch \(mm\/px\)/.test(html));
  check("PO-LASER-4 the pitch input bounds equal SBSchema.FAB_PITCH and the presets' default pitch",
    S.FAB_PITCH && S.FAB_PITCH.min === 0.05 && S.FAB_PITCH.max === 2 && S.FAB_PITCH.step === 0.01 && S.FAB_PITCH.defaultMM === 0.1 &&
    S.defaults("plywood").geometry.fabPitchMM === 0.1 && S.defaults("acrylic").geometry.fabPitchMM === 0.1 && Object.isFrozen(S.FAB_PITCH));
  check("PO-LASER-4 the draft resolution is not a user control (no procRes binding; no 360–1280 px range)",
    !/bindRange\("in-res", "procRes"/.test(appSrc) && !/min="360" max="1280"/.test(html) && !/Working resolution/.test(html));

  const A = S.defaults("acrylic"), A0 = JSON.stringify(A);
  check("PO-LASER-4 applyFabPitch sets geometry.fabPitchMM, bumps revision, validates; input not mutated", (() => {
    const q = S.applyFabPitch(A, 0.25);
    return q.geometry.fabPitchMM === 0.25 && q.revision === A.revision + 1 && S.validate(q).ok && JSON.stringify(A) === A0 && q !== A; })());
  check("PO-LASER-4 applyFabPitch: the same pitch keeps the revision", S.applyFabPitch(A, 0.1).revision === A.revision);
  check("PO-LASER-4 applyFabPitch clamps to 0.05–2 mm/px and quantizes to the 0.001 mm grid",
    S.applyFabPitch(A, 0.01).geometry.fabPitchMM === 0.05 && S.applyFabPitch(A, 9).geometry.fabPitchMM === 2 &&
    S.applyFabPitch(A, 0.12345).geometry.fabPitchMM === 0.123 && S.validate(S.applyFabPitch(A, 0.12345)).ok);
  check("PO-LASER-4 applyFabPitch ignores a non-numeric entry (project unchanged, same revision)",
    [NaN, "", null, undefined, Infinity, "abc"].every((v) => { const q = S.applyFabPitch(A, v); return JSON.stringify(q) === A0; }));
  check("PO-LASER-4 app.js binds #in-res to SBSchema.applyFabPitch",
    /\$\("in-res"\)/.test(appSrc) && /SBSchema\.applyFabPitch\(/.test(appSrc));

  // LYR-01: 1–16 sheets.
  const sh = tagOf("in-sheets");
  check("LYR-01 #in-sheets is 1–16 (step 1), the schema's construction.sheets range",
    attr(sh, "min") === "1" && attr(sh, "max") === "16" && attr(sh, "step") === "1" &&
    S.validate(S.applyLegacy(A, "nSheets", 1)).ok && S.validate(S.applyLegacy(A, "nSheets", 16)).ok && !S.validate(S.applyLegacy(A, "nSheets", 17)).ok);
  check("LYR-01 the controller pipeline runs at 1 and 16 sheets", (() => {
    const w = 64, h = 48, rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const v = ((i % w) * 4 + ((i / w) | 0) * 2) & 255; rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = v; rgba[4 * i + 3] = 255; }
    return [1, 16].every((n) => SBEngine.legacyRun(rgba, w, h, S.legacyState(S.applyLegacy(A, "nSheets", n), w, h)).sheets.length === n); })());

  // The staged Generate control, under the same guard as Export (G2.11a note).
  const gen = tagOf("btn-generate");
  check("UI-01 Review has a Generate button, disabled with the \"Choose a source\" reason until a source exists",
    gen !== "" && / disabled\b/.test(gen) && attr(gen, "aria-describedby") === "why-generate" &&
    /<p id="why-generate" class="why"[^>]*>Choose a source<\/p>/.test(html) &&
    html.indexOf('id="btn-generate"') > html.indexOf('id="stage-review"') && html.indexOf('id="btn-generate"') < html.indexOf('id="stage-export"'));
  check("UI-01 app.js: Generate calls regenerate() and its state follows SBSchema.canGenerate",
    /\$\("btn-generate"\)\.addEventListener\("click", regenerate\)/.test(appSrc) &&
    /function updateGate\(gate\)\s*\{[\s\S]{0,800}btn-generate/.test(appSrc));
});

suite("docs.js/schema.js/index.html/app.js — G2.11c control groups, dimension bar and disclaimers (LYR-01/02, MAT-01/02/04, PO-LASER-1/2/3/4/5/8)", () => {
  const S = SBSchema, Dc = SBDocs;
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const tagOf = (id) => { const m = new RegExp("<[a-z]+\\b[^>]*\\bid=\"" + id + "\"[^>]*>").exec(html); return m ? m[0] : ""; };
  const attr = (tag, a) => { const m = new RegExp("\\b" + a + "=\"([^\"]*)\"").exec(tag); return m ? m[1] : null; };
  const P = S.defaults("plywood"), A = S.defaults("acrylic"), P0 = JSON.stringify(P);
  const plan = (p, w, h, dev) => SBEngine.rasterPlan(p, { w, h }, "fabrication", dev || "desktop");

  // ---- disclaimer copy (pure strings)
  check("MAT-01 adhesive/finish exclusion text present",
    Dc.COPY.MAT01 === "Stock height excludes adhesive films and surface finishes." && Object.isFrozen(Dc.COPY));
  check("MAT-04 palette disclaimer text present",
    Dc.COPY.MAT04 === "Palette shading is a proof aid; it is not necessarily the appearance of unpainted stock.");
  check("PO-LASER-8 thickness hint text present", /1\/4" ply often measures 5\.5–6 mm: measure and enter it/.test(Dc.COPY.THICKNESS_HINT));
  check("MAT-01/MAT-04/PO-LASER-8 app.js renders the disclaimers from SBDocs.COPY into the page",
    /SBDocs\.COPY\.MAT01/.test(appSrc) && /SBDocs\.COPY\.MAT04/.test(appSrc) && /SBDocs\.COPY\.THICKNESS_HINT/.test(appSrc) &&
    tagOf("disc-stock") !== "" && tagOf("disc-palette") !== "" && tagOf("hint-thickness") !== "" &&
    attr(tagOf("in-thickness"), "aria-describedby") === "hint-thickness");

  // ---- dimbarModel
  const pl = plan(P, 3000, 3000);   // 300 × 300 mm art at 0.1 mm/px → 3000 × 3000, no cap
  const m0 = Dc.dimbarModel({ project: P, plan: pl, stats: null });
  check("LYR-02 dimbar thresholds in normalized and mm", (() => {
    const B = SBHeight.boundaries(8, 6.35);
    return m0.thresholds.length === 7 && m0.thresholds.every((t, i) => t.k === B[i].k && t.norm === B[i].norm && t.mm === B[i].mm &&
      t.text.includes(B[i].norm.toFixed(3)) && t.text.includes(String(Math.round(B[i].mm * 1000) / 1000) + " mm")); })());
  check("LYR-02 one sheet has no boundaries; the note names the nearest-layer rule",
    Dc.dimbarModel({ project: S.applyLegacy(P, "nSheets", 1), plan: null, stats: null }).thresholds.length === 0 && /nearest-layer/i.test(m0.thresholdsNote));
  const mS = Dc.dimbarModel({ project: P, plan: pl, stats: { requested: 8, exported: 6, omitted: [6, 7], stockMM: 50.8, reliefMM: 44.45, maxZMM: 38.1 } });
  check("LYR-01 dimbar shows requested vs exported",
    mS.layers.requested === 8 && mS.layers.exported === 6 && /8 requested/.test(mS.layers.text) && /6 exported/.test(mS.layers.text) &&
    /omitted 7, 8|omitted 6, 7/.test(mS.layers.text) &&
    m0.layers.requested === 8 && m0.layers.exported === null && /8 requested/.test(m0.layers.text) && /after generation/.test(m0.layers.text));
  check("LYR-01/AT-03 dimbar max Z, base t and relief (relief = maxZ − t); estimated before generation",
    mS.z.maxZMM === 38.1 && mS.z.baseMM === 6.35 && mS.z.reliefMM === 31.75 && mS.z.estimated === false &&
    m0.z.maxZMM === 50.8 && m0.z.reliefMM === 44.45 && m0.z.stockMM === 50.8 && m0.z.estimated === true &&
    /50\.8 mm/.test(m0.z.text) && /44\.45 mm/.test(m0.z.text) && /6\.35 mm/.test(m0.z.text));
  check("UI-03 connected estimate includes the gaps (N·t + (N−1)·g)",
    Dc.dimbarModel({ project: A, plan: null, stats: null }).z.maxZMM === 5 * 3 + 4 * 3);
  check("MAT-01 the dimbar carries the stock disclaimer", m0.disclaimers.includes(Dc.COPY.MAT01));

  check("PO-LASER-4 dimbar shows target and actual mm/px, the raster and Mpx (no cap)",
    m0.pitch.targetMM === 0.1 && m0.pitch.actualMM === 0.1 && m0.pitch.rasterW === 3000 && m0.pitch.rasterH === 3000 &&
    m0.pitch.mpx === 9 && m0.pitch.capped === "none" && /0\.1 mm\/px/.test(m0.pitch.text) && /3000 × 3000 px/.test(m0.pitch.text) && /9(\.0)? Mpx/.test(m0.pitch.text));
  const pb = plan(P, 20000, 20000, "mobile"), mB = Dc.dimbarModel({ project: P, plan: pb, stats: null });
  check("PO-LASER-4 dimbar shows target and actual mm/px and the cap reason", (() => {
    return mB.pitch.capped === "budget" && mB.pitch.targetMM === 0.1 && mB.pitch.actualMM === Math.round(pb.geometry.mmPerPxMax * 1000) / 1000 &&
      mB.pitch.actualMM > 0.1 && mB.pitch.rasterW * mB.pitch.rasterH <= 1000000 && /budget/.test(mB.pitch.reason) && /mobile/.test(mB.pitch.reason) &&
      /1(\.0)? Mpx/.test(mB.pitch.reason) && mB.pitch.text.includes(mB.pitch.reason) && mB.pitch.text.includes("target 0.1 mm/px"); })());
  const ps = plan(P, 1000, 800), mSrc = Dc.dimbarModel({ project: P, plan: ps, stats: null });
  check("PO-LASER-5 dimbar shows the source shortfall in px",
    mSrc.pitch.capped === "source" && JSON.stringify(mSrc.pitch.shortPx) === JSON.stringify(ps.geometry.shortPx) &&
    /source/.test(mSrc.pitch.reason) && mSrc.pitch.reason.includes(ps.geometry.shortPx[0] + " × " + ps.geometry.shortPx[1] + " px short") &&
    mSrc.pitch.rasterW === 1000 && mSrc.pitch.rasterH === 800);
  const pbs = plan(P, 800, 800, "mobile"), mBS = Dc.dimbarModel({ project: P, plan: pbs, stats: null });
  check("PO-LASER-4/5 budget+source names both causes",
    pbs.geometry.capped === "budget+source" && mBS.pitch.capped === "budget+source" && /budget/.test(mBS.pitch.reason) &&
    mBS.pitch.reason.includes("200 × 200 px short") && mBS.pitch.rasterW === 800);
  check("PO-LASER-4 before a source the pitch text asks for one (never blank)",
    /source/i.test(Dc.dimbarModel({ project: P, plan: null, stats: null }).pitch.text) && m0.pitch.text !== "");

  check("PO-LASER-2 dimbar shows page vs machine area", (() => {
    const fit = m0.page, big = Dc.dimbarModel({ project: S.applyControl(P, "target", 480), plan: plan(S.applyControl(P, "target", 480), 3000, 3000), stats: null }).page;
    const none = Dc.dimbarModel({ project: S.applyControl(P, "machine", "none"), plan: pl, stats: null }).page;
    return fit.fits === true && fit.wMM === 300 && fit.hMM === 300 && /fits/.test(fit.text) && fit.text.includes("xTool S1 + feeder") &&
      big.fits === false && big.overMM === 10 && /too large by 10 mm/.test(big.text) && none.fits === null && /no machine/i.test(none.text); })());
  check("PO-LASER-2 the dimbar fit agrees with SBSupport.checkEnvelope (PAGE_OVERFLOW) over a grid of pages", (() => {
    const mach = S.MACHINES["xtool-s1-feeder"];
    for (const w of [100, 469.999, 470, 470.001, 545, 2999, 3000, 3000.5]) for (const h of [50, 470, 471, 3000, 3001]) {
      const env = SBSupport.checkEnvelope({ wMM: w, hMM: h }, mach, null).some((d) => d.code === "PAGE_OVERFLOW");
      const f = Dc.pageFit(w, h, mach);
      if (f.fits === env) return false;
      if (f.fits !== (f.overMM === 0)) return false;
    }
    return true; })());
  check("PO-LASER-1 dimbar flags stock thicker than the machine accepts",
    Dc.dimbarModel({ project: S.applyControl(P, "thickness", 20), plan: pl, stats: null }).stock.ok === false &&
    m0.stock.ok === true && /14 mm/.test(Dc.dimbarModel({ project: S.applyControl(P, "thickness", 20), plan: pl, stats: null }).stock.text));
  check("MAT-02 dimbar lengths follow project.units (inches)", (() => {
    const q = S.applyControl(P, "units", "in"), m = Dc.dimbarModel({ project: q, plan: plan(q, 3000, 3000), stats: null });
    return /2 in/.test(m.z.text) && /1\.75 in/.test(m.z.text) && /0\.25 in/.test(m.z.text) && m.z.maxZMM === 50.8; })());
  check("dimbarModel is pure and frozen", JSON.stringify(P) === P0 && Object.isFrozen(m0) && Object.isFrozen(m0.pitch));

  // ---- SBSchema.applyControl: the one write path for the G2.11c controls
  const geo = (k, v, p) => { const q = S.applyControl(p || P, k, v); return q.revision === (p || P).revision + 1 && S.validate(q).ok; };
  const app_ = (k, v, p) => { const q = S.applyControl(p || P, k, v); return q.revision === (p || P).revision && S.validate(q).ok; };
  check("PRJ-02 applyControl: units, appearance, color and explode never bump the revision",
    app_("units", "in") && app_("appearance", "palette") && app_("color", "#112233") && app_("explode", 20) &&
    S.applyControl(P, "explode", 20).view.explodeMM === 20 && S.applyControl(P, "color", "#112233").appearance.color === "#112233" &&
    S.applyControl(P, "color", "red").appearance.color === P.appearance.color);
  check("PRJ-02 applyControl: geometry controls bump the revision by one",
    geo("thickness", 5.8) && geo("thickstate", "measured") && geo("polarity", "black-high") && geo("sizeby", "width") && geo("target", 400) &&
    geo("machine", "none") && geo("m-height", 400) && geo("m-length", 2000) && geo("m-matwidth", 600) && geo("m-thick", 10) && geo("m-kerf", 0.2) &&
    geo("gap", 4, A) && geo("thmode", "manual") && geo("manual-th", "0.1, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9") &&
    S.applyControl(P, "thickness", 6.35).revision === P.revision && JSON.stringify(P) === P0);
  check("MAT-02 applyControl lengths are entered in project.units (lossless)", (() => {
    const q = S.applyControl(S.applyControl(P, "units", "in"), "thickness", 0.25);
    const t = S.applyControl(S.applyControl(P, "units", "in"), "target", 12);
    return q.material.thicknessMM === 6.35 && t.geometry.targetMM === 304.8 && S.controlValues(q)["in-thickness"] === "0.25" &&
      S.controlValues(P)["in-thickness"] === "6.35"; })());
  check("PO-LASER-3 sizeby switch keeps the finished size when the source is known", (() => {
    const q = S.applyControl(P, "sizeby", "width", { srcW: 600, srcH: 400 });
    return q.geometry.sizeBy === "width" && q.geometry.targetMM === 450 && S.resolveSize(q, 600, 400).pageHMM === 300 &&
      S.applyControl(P, "sizeby", "width").geometry.targetMM === 300; })());
  check("PO-LASER-1 machine select: none → null; reselect restores the profile; edits mark it (edited)", (() => {
    const n = S.applyControl(P, "machine", "none"), e = S.applyControl(P, "m-height", 400), r = S.applyControl(e, "machine", "xtool-s1-feeder");
    return n.machine === null && e.machine.maxProcessingHeightMM === 400 && /\(edited\)$/.test(e.machine.name) && e.machine.id === "xtool-s1-feeder" &&
      JSON.stringify(r.machine) === JSON.stringify(S.MACHINES["xtool-s1-feeder"]) && S.applyControl(n, "m-height", 400).machine === null; })());
  check("applyControl leaves the project unchanged for an invalid or non-numeric entry", (() => {
    const same = (q) => JSON.stringify(q) === P0;
    return same(S.applyControl(P, "m-height", 600)) /* > material width 545 */ && same(S.applyControl(P, "thickness", "abc")) &&
      same(S.applyControl(P, "manual-th", "0.5, 0.2")) && same(S.applyControl(P, "manual-th", "0.2")) && same(S.applyControl(P, "polarity", "dark-front")) &&
      same(S.applyControl(P, "gap", 3)) /* bonded gap is 0 */ && S.applyControl(P, "thickness", 99).material.thicknessMM === 25; })());
  check("D1/UI-01 construction and interpretation selects apply the modeChangeDiff targets (valid project, revision + 1)", (() => {
    const b = S.applyControl(A, "construction", "bonded-relief"), h = S.applyControl(A, "interp", "height"), c = S.applyControl(P, "construction", "connected-sheet");
    return b.construction.mode === "bonded-relief" && b.construction.gapMM === 0 && b.revision === 1 && S.validate(b).ok &&
      h.interpretation.mode === "height" && h.interpretation.polarity === "black-high" && S.validate(h).ok &&
      c.construction.gapMM === 3 && S.validate(c).ok; })());
  check("LYR-02 manual thresholds: thmode manual seeds N−1 even values; a sheet change re-seeds a mismatched list", (() => {
    const m = S.applyControl(P, "thmode", "manual"), s = S.applyLegacy(m, "nSheets", 4);
    return m.interpretation.thresholdRule === "manual" && m.interpretation.manual.length === 7 && s.interpretation.manual.length === 3 &&
      S.validate(s).ok && S.controlValues(m)["in-manual-th"].split(",").length === 7; })());
  check("controlValues covers every G2.11c input id", (() => {
    const v = S.controlValues(P);
    return ["in-interp", "in-polarity", "in-construction", "in-thickness", "in-thickstate", "in-gap", "in-manual-th", "in-units", "in-appearance",
      "in-color", "in-explode", "in-sizeby", "in-target", "in-machine", "in-m-height", "in-m-length", "in-m-matwidth", "in-m-thick", "in-m-kerf"]
      .every((id) => typeof v[id] === "string") && v["in-machine"] === "xtool-s1-feeder" && v["in-sizeby"] === "height" &&
      S.controlValues(S.applyControl(P, "machine", "none"))["in-machine"] === "none"; })());

  // ---- markup and bindings
  const IDS = ["in-interp", "in-polarity", "in-construction", "in-thickness", "in-thickstate", "in-gap", "in-manual-th", "in-units", "in-appearance",
    "in-color", "in-explode", "in-sizeby", "in-target", "in-machine", "in-m-height", "in-m-length", "in-m-matwidth", "in-m-thick", "in-m-kerf"];
  check("UI-01 every G2.11c control exists in index.html with a label", IDS.every((id) => tagOf(id) !== "" && new RegExp("<label[^>]*for=\"" + id + "\"").test(html)));
  check("PO-LASER-3 #in-sizeby offers Height (first, the default) and Width",
    /<select id="in-sizeby">\s*<option value="height"[^>]*>Height<\/option>\s*<option value="width"[^>]*>Width<\/option>/.test(html));
  check("PO-LASER-1 #in-machine preselects \"xTool S1 + feeder\" and offers None",
    /<option value="xtool-s1-feeder" selected>xTool S1 \+ feeder<\/option>/.test(html) && /<option value="none">None<\/option>/.test(html));
  check("UI-01 the Machine group is a fieldset in Construction", (() => {
    const i = html.indexOf('id="in-machine"'), f = html.lastIndexOf("<fieldset", i);
    return f > html.indexOf('id="stage-construction"') && i < html.indexOf('id="stage-review"') && /<legend>Machine<\/legend>/.test(html.slice(f, i)); })());
  check("UI-01 app.js binds every G2.11c control through SBSchema.applyControl",
    /SBSchema\.applyControl\(/.test(appSrc) && IDS.every((id) => appSrc.includes('"' + id.replace(/^in-/, "") + '"') || appSrc.includes('"' + id + '"')));
  check("PRJ-02 app.js: an appearance/view change re-renders the shown result only (showResult(run.shown), alpha.3 E5); a geometry change regenerates",
    /function onControl\([\s\S]{0,900}revision !== [\s\S]{0,200}recompute\(\)[\s\S]{0,200}showResult\(run\.shown\)/.test(appSrc));
  check("PO-LASER-4/NFR-04 the dimbar is drawn from SBDocs.dimbarModel with the fabrication rasterPlan before generation",
    tagOf("dimbar") !== "" && /class="dimbar"/.test(tagOf("dimbar")) && /SBDocs\.dimbarModel\(/.test(appSrc) &&
    /SBEngine\.rasterPlan\([^)]*"fabrication"/.test(appSrc) && /\.dimbar\b/.test(fs.readFileSync(path.join(root, "css", "style.css"), "utf8")));
  check("LYR-02 the thresholds popover is a keyboard-operable <details> in the dimbar",
    /<details[^>]*id="dim-thresholds"/.test(html) && html.indexOf('id="dim-thresholds"') > html.indexOf('id="dimbar"'));
});

suite("schema.js/index.html/app.js — G2.11d applicability and disabled-with-reason controls (UI-01, §9.5, D1)", () => {
  const S = SBSchema;
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
  const tagOf = (id) => { const m = new RegExp("<[a-z]+\\b[^>]*\\bid=\"" + id + "\"[^>]*>").exec(html); return m ? m[0] : ""; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const withAt = (o, p, v) => { const c = clone(o); const ks = p.split("."); let t = c; for (const k of ks.slice(0, -1)) t = t[k]; t[ks[ks.length - 1]] = v; return c; };
  const P = S.defaults("plywood"), A = S.defaults("acrylic"), P0 = JSON.stringify(P);
  const why = (r) => typeof r === "string" && r.length > 0;
  const apP = S.applicability(P), apA = S.applicability(A);

  check("UI-01 bonded disables bridge controls with reason",
    why(apP["in-bridge"]) && why(apP["in-maxbridge"]) && why(apP["in-gap"]) && /bonded/i.test(apP["in-bridge"]) && /gap is 0/i.test(apP["in-gap"]));
  check("UI-01 bonded: #in-cull stays enabled and culling is an explicit opt-in (#in-cullon)", apP["in-cull"] === null && apP["in-cullon"] === null);
  check("UI-01 bonded: #in-margin stays enabled (the bonded preset frame is 0)", apP["in-margin"] === null && P.construction.frame.widthMM === 0);
  check("D1 bonded disables corner smoothing with reason (bonded contours are unsmoothed)", why(apP["in-corner"]) && /D1|unsmoothed/i.test(apP["in-corner"]));
  check("UI-01 connected enables gap", apA["in-gap"] === null && apA["in-bridge"] === null && apA["in-maxbridge"] === null && apA["in-corner"] === null);
  check("UI-01 connected: the cull opt-in is not applicable (connected always culls)", why(apA["in-cullon"]) && apA["in-cull"] === null);
  check("UI-01 height mode disables tone split, manual thresholds and smoothing with reason",
    ["in-thmode", "in-manual-th", "in-smooth", "in-passes"].every((id) => why(apP[id])) &&
    ["in-thmode", "in-smooth", "in-passes"].every((id) => apA[id] === null));
  check("UI-01 tonal: manual thresholds are applicable only with the manual tone split",
    why(apA["in-manual-th"]) && S.applicability(S.applyControl(A, "thmode", "manual"))["in-manual-th"] === null);
  check("PO-LASER-1 machine None disables the limit fields with reason",
    ["in-m-height", "in-m-length", "in-m-matwidth", "in-m-thick", "in-m-kerf"].every((id) => apP[id] === null && why(S.applicability(S.applyControl(P, "machine", "none"))[id])));
  check("ASM-04 hole diameter needs registration holes", why(apP["in-holedia"]) && apA["in-holedia"] === null && apP["in-holes"] === null);
  check("applicability is pure, total over one key set, and every value is a reason string or null", (() => {
    const keys = JSON.stringify(Object.keys(apP).sort());
    return JSON.stringify(P) === P0 && keys === JSON.stringify(Object.keys(apA).sort()) &&
      Object.values(apP).concat(Object.values(apA)).every((v) => v === null || why(v)); })());

  // ---- bonded cull opt-in and the bonded frame default
  check("UI-01 cullon toggles construction.bridge.cullEnabled in bonded (geometry: revision + 1); refused in connected", (() => {
    const on = S.applyControl(P, "cullon", true), off = S.applyControl(on, "cullon", "false");
    return on.construction.bridge.cullEnabled === true && on.revision === P.revision + 1 && off.construction.bridge.cullEnabled === false &&
      JSON.stringify(S.applyControl(A, "cullon", true)) === JSON.stringify(A) && S.controlValues(on)["in-cullon"] === "true"; })());
  check("UI-01 entering bonded mode defaults the frame ring (#in-margin) to 0; the finished size is kept", (() => {
    const d = S.modeChangeDiff(A, { construction: { mode: "bonded-relief" } }).find((x) => x.path === "construction.frame");
    const b = S.applyControl(A, "construction", "bonded-relief");
    return d && d.from.widthMM === 12 && d.to.enabled === false && d.to.widthMM === 0 && why(d.reason) &&
      b.construction.frame.enabled === false && b.geometry.targetMM === A.geometry.targetMM && S.validate(b).ok &&
      S.modeChangeDiff(P, { construction: { mode: "bonded-relief" } }).length === 0; })());

  // ---- §9.5 DISPLAY_ONLY_IGNORED
  const ignored = (obj) => S.importLoose(obj).diagnostics.filter((d) => d.code === "DISPLAY_ONLY_IGNORED");
  check("§9.5 inapplicable imported setting → DISPLAY_ONLY_IGNORED info", (() => {
    const ds = ignored(withAt(P, "construction.bridge.bridgeMM", 3));
    return ds.length === 1 && ds[0].severity === "info" && /construction\.bridge\.bridgeMM/.test(ds[0].message) && /bonded/i.test(ds[0].message); })());
  check("§9.5 the presets import with no ignored settings", ignored(P).length === 0 && ignored(A).length === 0);
  check("§9.5 a connected cull opt-in and height-mode smoothing are reported as ignored", (() => {
    const c = ignored(withAt(A, "construction.bridge.cullEnabled", true)), s = ignored(withAt(P, "interpretation.smoothing", { radiusMM: 1.65, passes: 2 }));
    return c.length === 1 && /cullEnabled/.test(c[0].message) && s.length === 1 && /smoothing/.test(s[0].message); })());
  check("§9.5 an invalid import gets no applicability diagnostics (validate reports it)",
    S.importLoose(withAt(P, "construction.sheets", 99)).diagnostics.length === 0 && Array.isArray(S.importLoose(null).diagnostics));
  check("§9.5 SBSchema.ignoredSettings(p) is the same list importLoose reports",
    JSON.stringify(S.ignoredSettings(withAt(P, "construction.bridge.maxBridgeMM", 80))) === JSON.stringify(S.importLoose(withAt(P, "construction.bridge.maxBridgeMM", 80)).diagnostics));

  // ---- markup and bindings
  check("UI-01 every applicability control exists in index.html with a label",
    Object.keys(apP).every((id) => tagOf(id) !== "" && new RegExp("<label[^>]*for=\"" + id + "\"").test(html)));
  check("UI-01 #in-cullon is a checkbox in the Construction stage",
    /type="checkbox"/.test(tagOf("in-cullon")) && html.indexOf('id="in-cullon"') > html.indexOf('id="stage-construction"') && html.indexOf('id="in-cullon"') < html.indexOf('id="stage-review"'));
  check("UI-01 app.js drives disabled rows from SBSchema.applicability with .why text and aria-describedby",
    /SBSchema\.applicability\(/.test(appSrc) && /classList\.toggle\("disabled"/.test(appSrc) && /aria-describedby/.test(appSrc) && /"why"/.test(appSrc));
  check("UI-01 style.css styles .row.disabled and .why", /\.row\.disabled\b/.test(css) && /\.why\b/.test(css));
});

suite("schema.js/index.html/app.js — G2.11e mode-change review (PRJ-02, AT-21)", () => {
  const S = SBSchema;
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code || "UNCODED:" + e.message; } };
  const P = S.defaults("plywood"), A = S.defaults("acrylic"), P0 = JSON.stringify(P), A0 = JSON.stringify(A);
  const toConn = { construction: { mode: "connected-sheet" } }, toBond = { construction: { mode: "bonded-relief" } };
  const toTonal = { interpretation: { mode: "tonal" } }, toHeight = { interpretation: { mode: "height" } };
  const am = S.applyModeChange;

  check("PRJ-02 cancel leaves project revision unchanged", typeof am === "function" &&
    [[P, toConn], [P, toTonal], [A, toBond], [A, toHeight]].every(([p, patch]) => {
      const r = am(p, patch, false);
      return r.revision === p.revision && JSON.stringify(r) === JSON.stringify(p) && r !== p; }));
  check("PRJ-02 accept applies every modeChangeDiff target (revision + 1, valid project)", typeof am === "function" &&
    [[P, toConn], [P, toTonal], [A, toBond], [A, toHeight]].every(([p, patch]) => {
      const r = am(p, patch, true), get = (o, k) => k.split(".").reduce((t, x) => t[x], o);
      return r.revision === p.revision + 1 && S.validate(r).ok &&
        S.modeChangeDiff(p, patch).every((d) => JSON.stringify(get(r, d.path)) === JSON.stringify(d.to)); }));
  check("PRJ-02 accepting a patch that keeps the mode changes nothing (same revision)", typeof am === "function" &&
    JSON.stringify(am(P, toBond, true)) === P0 && JSON.stringify(am(A, toTonal, true)) === A0 && JSON.stringify(am(P, {}, true)) === P0);
  check("PRJ-02 applyModeChange is pure: the input project is never mutated", typeof am === "function" && (() => {
    am(P, toConn, true); am(A, toHeight, true); am(P, toTonal, false);
    return JSON.stringify(P) === P0 && JSON.stringify(A) === A0; })());
  check("PRJ-02 applyModeChange rejects an unknown mode (SCHEMA_MODE), accepted or not",
    codeOf(() => am(P, { construction: { mode: "glued" } }, true)) === "SCHEMA_MODE" && codeOf(() => am(P, { interpretation: { mode: "x" } }, false)) === "SCHEMA_MODE");
  check("PRJ-02 applyControl interp/construction is applyModeChange(…, true) (one write path)", typeof am === "function" &&
    JSON.stringify(S.applyControl(A, "construction", "bonded-relief")) === JSON.stringify(am(A, toBond, true)) &&
    JSON.stringify(S.applyControl(P, "interp", "tonal")) === JSON.stringify(am(P, toTonal, true)));

  // ---- markup and bindings (QA: keyboard-operable dialog, focus returns to the select)
  check("PRJ-02 index.html has a modal review <dialog> with a change list, Accept and Cancel",
    /<dialog[^>]*id="dlg-mode"[^>]*aria-labelledby="dlg-mode-title"/.test(html) && /id="dlg-mode-title"/.test(html) && /id="dlg-mode-list"/.test(html) &&
    /<form[^>]*method="dialog"/.test(html.slice(html.indexOf('id="dlg-mode"'))) &&
    /<button[^>]*value="accept"[^>]*>/.test(html) && /<button[^>]*value="cancel"[^>]*>/.test(html));
  check("PRJ-02 app.js: #in-interp/#in-construction open the review (showModal) from SBSchema.modeChangeDiff instead of applying at once",
    /SBSchema\.modeChangeDiff\(/.test(appSrc) && /\.showModal\(\)/.test(appSrc) && /SBSchema\.applyModeChange\(/.test(appSrc) &&
    !/onControl\("(interp|construction)"/.test(appSrc) && /const CONTROLS = \[(?![^\]]*"(interp|construction)")[^\]]*\]/.test(appSrc));
  check("PRJ-02 app.js: Cancel/Escape restores the select and focus returns to it",
    /returnValue === "accept"/.test(appSrc) && /addEventListener\("close"/.test(appSrc) && /\.focus\(\)/.test(appSrc));
});

suite("proof.js/preview.js/index.html/app.js — G2.12 opaque proof, stack section and tilt (UI-02/03, MAT-04, GEO-01, AT-11)", () => {
  const F = require("./fixtures.js"), M = SBMaterial, S = SBSvg, G = SBGeom, P = globalThis.SBProof;
  check("G2.12 SBProof API present", !!P && ["model", "section", "drawParams", "modelHash"].every((k) => typeof P[k] === "function"));
  if (!P) return;
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  const ringsOf = (l) => { const o = []; for (const p of l.material) o.push(p.outer, ...p.holes); return o; };
  const di = F.MASKS.donutIsland, bt = F.MASKS.borderTouch;
  const pgB = M.page({ artWMM: 90, artHMM: 90, frame: { enabled: false, widthMM: 10 } }), LB = M.fromMasks(di.layers, 9, 9, pgB, {});
  const pgC = M.page({ artWMM: 80, artHMM: 50, frameMM: 10 });
  const LC = M.fromMasks(bt.layers, 8, 5, pgC, { frame: true, holes: [{ cxUm: 5000, cyUm: 5000, rUm: 1500 }] });
  const pal = ["#ffffff", "#336699", "#000000", "#cc0000"];

  // ---- section (UI-03)
  const sec = P.section(LB, 45, { tMM: 6.35, gMM: 0 });
  check("UI-03 section of donutIsland at the island row has 3 intervals on layer 1 (ring left, island, ring right)",
    sec.length === 2 && sec[1].layerIndex === 1 && JSON.stringify(sec[1].intervals) === "[[10,20],[40,50],[70,80]]" &&
    JSON.stringify(sec[0].intervals) === "[[0,90]]");
  check("UI-03 section off the island row: layer 1 has 2 intervals (ring only); outside the art: none",
    JSON.stringify(P.section(LB, 25, { tMM: 3, gMM: 0 })[1].intervals) === "[[10,20],[70,80]]" &&
    P.section(LB, 5, { tMM: 3, gMM: 0 })[1].intervals.length === 0);
  check("UI-03 bonded z = k*t; connected z = k*(t+g)", (() => {
    const b = P.section(LB, 45, { tMM: 6.35, gMM: 0 }), c = P.section(LC, 35, { tMM: 3, gMM: 2.5 });
    return b.every((r) => r.z0 === r.layerIndex * 6.35 && r.z1 === r.z0 + 6.35) &&
      c.length === LC.length && c.every((r) => r.z0 === r.layerIndex * 5.5 && r.z1 === r.layerIndex * 5.5 + 3); })());
  check("UI-03 section z is exact on the µm grid (no float drift: k=7, t=6.35 → 44.45)",
    P.section([{ index: 7, material: [] }], 1, { tMM: 6.35, gMM: 0 })[0].z0 === 44.45);
  check("UI-03 section is ordered back to front by index and reports empty layers with no intervals",
    JSON.stringify(P.section([LB[1], { index: 2, material: [] }, LB[0]], 45, { tMM: 1, gMM: 0 }).map((r) => [r.layerIndex, r.intervals.length])) === "[[0,1],[1,3],[2,0]]");
  check("UI-03 section scanline on a vertex row uses the half-open rule (no double count)",
    JSON.stringify(P.section(LB, 40, { tMM: 1, gMM: 0 })[1].intervals) === "[[10,20],[40,50],[70,80]]" &&
    JSON.stringify(P.section(LB, 50, { tMM: 1, gMM: 0 })[1].intervals) === "[[10,20],[70,80]]");
  check("UI-03 section refuses a non-finite y, t ≤ 0 or g < 0", throws(() => P.section(LB, NaN, { tMM: 1, gMM: 0 }), /NONFINITE/) &&
    throws(() => P.section(LB, 1, { tMM: 0, gMM: 0 }), /NONFINITE/) && throws(() => P.section(LB, 1, { tMM: 1, gMM: -1 }), /NONFINITE/));

  // ---- drawParams (UI-02)
  check("UI-02 proof drawParams: no smoothing, no shadows, no parallax",
    JSON.stringify(P.drawParams("proof")) === JSON.stringify({ smoothing: false, shadows: false, parallax: false, illustrative: false }));
  check("UI-02 section drawParams are exact too; only tilt is illustrative (smoothing, shadows, parallax)",
    JSON.stringify(P.drawParams("section")) === JSON.stringify({ smoothing: false, shadows: false, parallax: false, illustrative: false }) &&
    JSON.stringify(P.drawParams("tilt")) === JSON.stringify({ smoothing: true, shadows: true, parallax: true, illustrative: true }) &&
    throws(() => P.drawParams("glow"), /MODE/) && Object.isFrozen(P.drawParams("proof")));

  // ---- model (UI-02, MAT-04, GEO-01)
  const mp = P.model(LC, pal, {});
  check("UI-02 retained/waste model per layer equals material polygons (back to front, empty layers skipped)", [LC, LB].every((L) => {
    const m = P.model(L.slice().reverse(), pal, {}), ne = L.filter((l) => l.material.length);
    return m.length === ne.length && m.every((e, j) => e.layerIndex === ne[j].index && JSON.stringify(e.rings) === JSON.stringify(ringsOf(ne[j]))); }) &&
    P.model([{ index: 0, material: [] }], "#808080", {}).length === 0);
  check("MAT-04 palette model: fill = colors[layer.index] (normalized), no stroke by default", mp.every((e) => e.fill === pal[e.layerIndex] && e.stroke === null));
  const mu = P.model(LC, "#808080", {});
  check("MAT-04 uniform proof strokes layer edges (stroke darker than fill, same as assemblySVG)", (() => {
    const svgStroke = (S.assemblySVG(LC, pgC, "#808080").match(/stroke="(#[0-9a-f]{6})"/) || [])[1];
    return mu.length > 0 && mu.every((e) => e.fill === "#808080" && e.stroke === svgStroke && e.stroke === "#4c4c4c"); })());
  check("MAT-04 {edgeStroke} overrides both ways; a repeated palette counts as uniform; #rgb normalized",
    P.model(LC, pal, { edgeStroke: true }).every((e) => !!e.stroke) && P.model(LC, "#808080", { edgeStroke: false }).every((e) => e.stroke === null) &&
    P.model(LC, ["#888", "#888", "#888"], {}).every((e) => e.fill === "#888888" && !!e.stroke));
  check("NFR-06 model refuses a non-hex color", throws(() => P.model(LC, ['#fff" x', "#000"], {}), /COLOR/) && throws(() => P.model(LC, "red", {}), /COLOR/));
  check("G2.12 model refuses a non-integer layer.index (NONINTEGER), as assemblySVG does",
    throws(() => P.model([{ index: 0.5, material: LC[1].material }], "#808080", {}), /SBProof\.model: NONINTEGER/) &&
    throws(() => S.assemblySVG([{ index: 0.5, material: LC[1].material }], pgC, "#808080"), /SBSvg\.assemblySVG: NONINTEGER/));
  check("G2.12 model and assemblySVG share one paint rule (SBSvg.paint); proof.js keeps no copy of hexColor/darker", (() => {
    const src = fs.readFileSync(path.join(__dirname, "..", "js", "proof.js"), "utf8");
    const cases = [[pal, {}], ["#808080", {}], [pal, { edgeStroke: true }], ["#abc", { edgeStroke: false }], [["#888", "#888", "#888"], {}]];
    return typeof S.paint === "function" && !/function hexColor|function darker/.test(src) && /SBSvg\.paint\(/.test(src) &&
      cases.every(([c, o]) => { const p = S.paint(LC, c, o), m = P.model(LC, c, o);
        return JSON.stringify(m.map((e) => [e.layerIndex, e.fill, e.stroke])) === JSON.stringify(p.layers.map((l, j) => [l.index, p.fills[j], p.strokes[j]])); }); })());
  check("AT-11 explode is a view setting: applyControl(explode) keeps the revision and SBSchema.geometryKey", (() => {
    const p0 = SBSchema.defaults("acrylic"), p1 = SBSchema.applyControl(p0, "explode", 40);
    return p1.view.explodeMM === 40 && p1.revision === p0.revision && JSON.stringify(SBSchema.geometryKey(p1)) === JSON.stringify(SBSchema.geometryKey(p0)); })());
  check("MAT-04 proof colors do not change any layer canonicalHash and do not mutate layers", (() => {
    const L = M.fromMasks(bt.layers, 8, 5, pgC, { frame: true }), before = JSON.stringify(L);
    P.model(L, pal, {}); P.model(L, "#123456", { edgeStroke: true }); P.section(L, 30, { tMM: 3, gMM: 1 });
    return JSON.stringify(L) === before && L.every((l) => l.canonicalHash === G.materialHash(l)); })());
  check("MAT-04 modelHash: deterministic, sensitive to color, 64 hex",
    /^[0-9a-f]{64}$/.test(P.modelHash(mp)) && P.modelHash(P.model(LC, pal, {})) === P.modelHash(mp) && P.modelHash(mu) !== P.modelHash(mp));

  // ---- preview.js with a recording 2D context (no DOM)
  const rec = (() => {
    const log = { canvases: 0, fills: 0, draws: [], rects: 0, strokes: 0, strokeRects: 0 };
    const mkCtx = () => { const st = { imageSmoothingEnabled: true, shadowBlur: 0, shadowColor: "rgba(0,0,0,0)", fillStyle: "#000", strokeStyle: "#000", lineWidth: 1 };
      const stack = [];
      return Object.assign(st, {
        setTransform() {}, clearRect() {}, save() { stack.push(Object.assign({}, st)); }, restore() { Object.assign(st, stack.pop() || {}); },
        fillRect() { log.rects++; }, strokeRect() { log.strokeRects++; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { log.strokes++; }, fillText() {}, translate() {}, scale() {},
        fill() { log.fills++; }, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {},
        drawImage(img, x, y, w, h) { log.draws.push({ x, y, w, h, smoothing: st.imageSmoothingEnabled, blur: st.shadowBlur, img }); },
        measureText: (t) => ({ width: t.length * 6 }) }); };
    const mkCanvas = () => { log.canvases++; return { width: 0, height: 0, clientWidth: 400, clientHeight: 300, _ctx: null,
      getContext() { return this._ctx || (this._ctx = mkCtx()); }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
      toBlob(cb) { cb(null); } }; };
    const ctx = vm.createContext({ console, Math, Uint8Array, Uint8ClampedArray, Promise, SBUtil, SBProof: P, devicePixelRatio: 1,
      document: { createElement: () => mkCanvas() }, addEventListener() {}, requestAnimationFrame() {},
      Path2D: function () { this.moveTo = () => {}; this.lineTo = () => {}; this.closePath = () => {}; } });
    ctx.globalThis = ctx; ctx.window = ctx;
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "preview.js"), "utf8"), ctx, { filename: "preview.js" });
    return { log, ctx, mkCanvas };
  })();
  const pv = rec.ctx.SBPreview.create(rec.mkCanvas());
  check("UI-02 preview exposes setSnapshot and setMode", typeof pv.setSnapshot === "function" && typeof pv.setMode === "function");
  if (typeof pv.setSnapshot !== "function") return;
  const snap = { page: pgC, layers: LC, tMM: 3, gMM: 2 };
  const c0 = rec.log.canvases;
  pv.setSnapshot(snap, pal);
  const made = rec.log.canvases - c0, nonEmpty = LC.filter((l) => l.material.length).length;
  check("UI-02 setSnapshot rasterizes each layer's Path2D once into an offscreen canvas", made === nonEmpty && rec.log.fills === nonEmpty);
  const frame = (mode) => { rec.log.draws = []; rec.log.rects = 0; rec.log.strokes = 0; rec.log.strokeRects = 0; pv.snapshot(mode); return rec.log.draws.slice(); };
  pv.setMode("tilt"); pv.setExplode(1); frame(); frame();
  check("UI-02 tilt frames only composite (no re-rasterization)", rec.log.canvases - c0 === made && rec.log.fills === nonEmpty);
  const td = frame();
  check("UI-02 tilt is illustrative: smoothing, shadows and per-layer parallax/explode offsets", td.length === nonEmpty &&
    td.every((d) => d.smoothing === true && d.blur > 0) && new Set(td.map((d) => d.x + "," + d.y)).size === nonEmpty);
  pv.setMode("proof");
  const pd = frame();
  check("UI-02 proof mode: imageSmoothingEnabled = false, no shadows, no parallax or explode offsets (explode display-only)",
    pd.length === nonEmpty && pd.every((d) => d.smoothing === false && d.blur === 0 && d.x === pd[0].x && d.y === pd[0].y && d.w === pd[0].w));
  pv.setMode("section"); const sd = frame();
  const nInt = P.section(LC, pgC.hMM / 2, { tMM: 3, gMM: 2 }).reduce((a, r) => a + r.intervals.length, 0);
  check("UI-03 section mode draws one bar per SBProof.section interval (mid-page by default), no layer images", sd.length === 0 && rec.log.rects === nInt + 1 && nInt > 0);
  check("UI-03 section is dimensioned: width and height dimension lines, Z ticks and a page gauge marking the section line",
    rec.log.strokes >= 10 + P.section(LC, pgC.hMM / 2, { tMM: 3, gMM: 2 }).length + 1 && rec.log.strokeRects === 1);
  const xd = frame("proof");
  check("G2.12 snapshot(\"proof\") captures the proof from any tab and restores the active mode (bundle preview.png)",
    xd.length === nonEmpty && xd.every((d) => d.smoothing === false && d.blur === 0) && pv.getMode() === "section");
  pv.setMode("proof");
  // alpha.3 E5 (SUP-06): bridges reach the views only as overlay polygons (SBProof.overlays from cleanupReport[].bridges)
  const pvb = rec.ctx.SBPreview.create(rec.mkCanvas());
  pvb.setSnapshot(snap, pal);
  pvb.setOverlays(LC.map((l, k) => ({ layerIndex: l.index, added: null, removed: null, unsupported: [], label: "",
    bridges: k === 1 ? [{ outer: [0, 0, 1000, 0, 1000, 1000, 0, 1000], holes: [] }] : null })));
  const bpp = (() => { rec.log.draws = []; pvb.setMode("proof"); pvb.snapshot(); return rec.log.draws.slice(); })();
  const bt_ = (() => { rec.log.draws = []; pvb.setMode("tilt"); pvb.snapshot(); return rec.log.draws.slice(); })();
  check("UI-02 bridge highlight is drawn in Tilt only, never in Proof", bpp.length === nonEmpty && bt_.length === nonEmpty + 1);
  check("alpha.3 E5 the raster interim view is gone (no setSheets)", typeof pvb.setSheets === "undefined");
  check("UI-02 setMode refuses an unknown mode", throws(() => pv.setMode("glow"), /MODE/));

  // ---- markup and wiring
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8"), appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const tabs = [...html.matchAll(/<button class="tab[^"]*" data-tab="([a-z]+)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2].trim()]);
  check("UI-02 tabs Proof, Section, Layers, Tilt (illustrative) in that order",
    JSON.stringify(tabs) === JSON.stringify([["proof", "Proof"], ["section", "Section"], ["sheets", "Layers"], ["tilt", "Tilt (illustrative)"]]));
  check("UI-02 index.html loads js/proof.js before js/preview.js; modules.js lists proof.js",
    html.indexOf('src="js/proof.js"') > 0 && html.indexOf('src="js/proof.js"') < html.indexOf('src="js/preview.js"') &&
    require("./modules.js").NODE_MODULES.includes("proof.js"));
  check("UI-02 app.js: switchTab sets the preview mode; showResult feeds setSnapshot from the canonical polygons of SBEngine.generate (alpha.3 E5)",
    /preview\.setMode\(/.test(appSrc) && /preview\.setSnapshot\(/.test(appSrc) && /SBEngine\.generate\(/.test(appSrc));
  check("KI-CONN-PERF app.js: the draft paints first (rAF + task), drops a superseded run (draftToken) and reports a proof failure (alpha.3 E5)",
    (() => { const rg = appSrc.slice(appSrc.indexOf("function regenerate()"), appSrc.indexOf("function wantOverlays(")),
      sr = appSrc.slice(appSrc.indexOf("function showResult("), appSrc.indexOf("function statusText("));
      return /requestAnimationFrame\(\(\) => setTimeout\(/.test(rg) && /token !== draftToken/.test(rg) && /proof unavailable/.test(sr) && /catch \(err\)/.test(sr) &&
        sr.indexOf("setSnapshot(") < sr.indexOf("renderSheetGrid("); })());
  check("G2.12 app.js: the export bundle image is the proof (preview.snapshot(\"proof\"))", /preview\.snapshot\("proof"\)/.test(appSrc));
  check("UI-02 the draft badge is gone; the tilt view carries an Illustrative note",
    !/Draft preview: cut files come from polygons/.test(html) && /id="tiltnote"[^>]*>[^<]*Illustrative/.test(html));
});

suite("proof.js/preview.js/app.js/style.css — G2.13a retained/waste layer cards (UI-02, MAT-04)", () => {
  const F = require("./fixtures.js"), M = SBMaterial, G = SBGeom, P = globalThis.SBProof;
  check("G2.13a SBProof.cards present", !!P && typeof P.cards === "function");
  if (!P || typeof P.cards !== "function") return;
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  const bt = F.MASKS.borderTouch, di = F.MASKS.donutIsland;
  const pgC = M.page({ artWMM: 80, artHMM: 50, frameMM: 10 });
  const LC = M.fromMasks(bt.layers, 8, 5, pgC, { frame: true, holes: [{ cxUm: 5000, cyUm: 5000, rUm: 1500 }] });
  const pgB = M.page({ artWMM: 90, artHMM: 90, frame: { enabled: false, widthMM: 10 } }), LB = M.fromMasks(di.layers, 9, 9, pgB, {});
  const pal = ["#ffffff", "#336699", "#000000", "#cc0000"];

  // ---- pure card model
  const cards = P.cards(LC.slice().reverse(), pgC);
  const pageMM2 = pgC.wMM * pgC.hMM;
  check("UI-02 cards: one per layer (empty ones too), back to front by index",
    cards.length === LC.length && cards.every((c, j) => c.layerIndex === LC.slice().sort((a, b) => a.index - b.index)[j].index));
  check("UI-02 cards: retained mm² = SBGeom.area(layer.material); retained + waste = page area",
    cards.every((c) => { const l = LC.find((x) => x.index === c.layerIndex);
      return Math.abs(c.retainedMM2 - G.area(l.material) / 1e6) < 1e-9 && Math.abs(c.retainedMM2 + c.wasteMM2 - pageMM2) < 1e-6; }));
  check("UI-02 cards: retainedPct in [0, 100]; an empty layer is all waste",
    cards.every((c) => c.retainedPct >= 0 && c.retainedPct <= 100) &&
    (() => { const e = P.cards([{ index: 0, material: [] }], pgB)[0]; return e.retainedMM2 === 0 && e.wasteMM2 === pgB.wMM * pgB.hMM && e.retainedPct === 0 && e.empty === true; })());
  check("UI-02 cards: roles backing / mid / front (one layer: backing)",
    JSON.stringify(P.cards(LC, pgC).map((c) => c.role)) === JSON.stringify(LC.map((_, k) => (k === 0 ? "backing" : k === LC.length - 1 ? "front" : "mid"))) &&
    P.cards([LB[0]], pgB)[0].role === "backing");
  check("UI-02 donutIsland layer 1 card: retained = ring + island area", (() => {
    const c = P.cards(LB, pgB)[1]; return Math.abs(c.retainedMM2 - G.area(LB[1].material) / 1e6) < 1e-9 && c.retainedMM2 > 0 && c.wasteMM2 > 0; })());
  check("G2.13a cards refuse a bad page or a non-integer index; do not mutate layers", (() => {
    const before = JSON.stringify(LC);
    return throws(() => P.cards(LC, { wMM: 0, hMM: 10 }), /NONFINITE/) && throws(() => P.cards([{ index: 0.5, material: [] }], pgC), /NONINTEGER/) &&
      JSON.stringify(LC) === before; })());

  // ---- preview.js drawCard from the per-snapshot cache (recording 2D context, no DOM)
  const log = { canvases: 0, fills: 0, draws: [], strokes: 0, rects: [] };
  const mkCtx = () => { const st = { imageSmoothingEnabled: true, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1 }; const stack = [];
    return Object.assign(st, { setTransform() {}, clearRect() {}, save() { stack.push(Object.assign({}, st)); }, restore() { Object.assign(st, stack.pop() || {}); },
      fillRect(x, y, w, h) { log.rects.push({ fill: st.fillStyle, w, h }); }, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, rect() {}, clip() {},
      stroke() { log.strokes++; }, fillText() {}, fill() { log.fills++; },
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {},
      drawImage(img, x, y, w, h) { log.draws.push({ img, x, y, w, h, smoothing: st.imageSmoothingEnabled }); } }); };
  const mkCanvas = () => { log.canvases++; return { width: 0, height: 0, clientWidth: 400, clientHeight: 300, _ctx: null,
    getContext() { return this._ctx || (this._ctx = mkCtx()); }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }), toBlob(cb) { cb(null); } }; };
  const ctx = vm.createContext({ console, Math, Uint8Array, Uint8ClampedArray, Promise, SBUtil, SBProof: P, devicePixelRatio: 1,
    document: { createElement: () => mkCanvas() }, addEventListener() {}, requestAnimationFrame() {},
    Path2D: function () { this.moveTo = () => {}; this.lineTo = () => {}; this.closePath = () => {}; } });
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "preview.js"), "utf8"), ctx, { filename: "preview.js" });
  const pv = ctx.SBPreview.create(mkCanvas());
  check("UI-02 preview exposes drawCard and hasSnapshot", typeof pv.drawCard === "function" && typeof pv.hasSnapshot === "function");
  if (typeof pv.drawCard !== "function") return;
  check("UI-02 drawCard without a snapshot draws nothing and returns false", pv.hasSnapshot() === false && pv.drawCard(mkCanvas(), 1) === false);
  pv.setSnapshot({ page: pgC, layers: LC, tMM: 3, gMM: 2 }, pal);
  const nonEmpty = LC.filter((l) => l.material.length);
  const c0 = log.canvases, f0 = log.fills;
  const card = mkCanvas();
  log.draws = []; log.strokes = 0; log.rects = [];
  const ok = pv.drawCard(card, nonEmpty[1].index, { maxPx: 300 });
  check("UI-02 drawCard sizes the card to the page aspect (long side maxPx)",
    ok === true && Math.max(card.width, card.height) === 300 && Math.abs(card.width / card.height - pgC.wMM / pgC.hMM) < 0.02);
  check("UI-02 layer card reuses the per-snapshot offscreen cache (no re-rasterization)",
    log.canvases - c0 === 1 && log.fills === f0 && log.draws.length === 1 && log.draws[0].img.width > 0 && log.draws[0].w === card.width && log.draws[0].h === card.height);
  check("UI-02 layer card: waste hatch (bed fill plus hatch strokes) under the material, no smoothing (matches the proof)",
    log.rects.length >= 1 && log.rects[0].fill.toUpperCase() === "#171D24" && log.strokes >= 1 && log.draws[0].smoothing === false);
  log.draws = []; log.strokes = 0;
  pv.drawCard(card, 99);
  check("UI-02 a layer with no material is drawn as hatch only", log.draws.length === 0 && log.strokes >= 1);
  check("alpha.3 E5 no raster card fallback: the preview has no setSheets", typeof pv.setSheets === "undefined" && pv.hasSnapshot() === true);

  // ---- wiring
  const root = path.join(__dirname, "..");
  const appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8"), css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
  const grid = appSrc.slice(appSrc.indexOf("function renderSheetGrid("), appSrc.indexOf("function renderPaletteChips("));
  check("UI-02 app.js: renderSheetGrid draws polygon cards via preview.drawCard with SBProof.cards stats, hatch-only fallback",
    /preview\.drawCard\(/.test(grid) && /SBProof\.cards\(/.test(grid) && /hatch/i.test(grid) && /retained/.test(grid) && /waste/.test(grid));
  check("UI-02 app.js: showResult re-renders the cards once the snapshot is set (alpha.3 E5)",
    (() => { const sv = appSrc.slice(appSrc.indexOf("function showResult("), appSrc.indexOf("function statusText(")); return sv.indexOf("setSnapshot(") >= 0 && sv.indexOf("setSnapshot(") < sv.indexOf("renderSheetGrid("); })());
  check("UI-02 style.css: .sheetcard legend swatches for retained and waste (hatch, not colour alone)",
    /\.sheetcard[^{]*\.sw-waste\s*\{[^}]*repeating-linear-gradient/.test(css));
});

suite("diag.js/proof.js/engine.js/preview.js/app.js — G2.13b overlays and state badges (GEO-08, UI-05)", async () => {
  const D = SBDiag, P = globalThis.SBProof, E = SBEngine, G = SBGeom, M = SBMaterial, F = require("./fixtures.js");
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  check("G2.13b API present", typeof D.nextState === "function" && typeof D.stateBadge === "function" &&
    typeof P.overlays === "function" && typeof E.legacyCleanupReport === "function");
  if (typeof D.nextState !== "function" || typeof P.overlays !== "function" || typeof E.legacyCleanupReport !== "function") return;

  // ---- nextState (UI-05)
  const N = D.nextState, blk = [D.make("BOND_UNSUPPORTED", { quality: "fabrication", layer: 1 })];
  check("UI-05 nextState transitions draft→processing→validated|failed and any edit → stale", (() => {
    const p = N("draft", { type: "start" });
    return p === "processing" && N(p, { type: "done", quality: "fabrication", diagnostics: [] }) === "validated" &&
      N(p, { type: "fail" }) === "failed" && N(p, { type: "done", quality: "fabrication", diagnostics: blk }) === "failed" &&
      D.STATES.every((s) => N(s, { type: "edit" }) === "stale"); })());
  check("UI-05 a draft-quality result is a draft (never validated); stale → processing on start",
    N("processing", { type: "done", quality: "draft", diagnostics: [] }) === "draft" && N("stale", { type: "start" }) === "processing" &&
    N("validated", { type: "start" }) === "processing");
  check("UI-05 a result arriving when not processing (superseded by an edit) leaves the state unchanged",
    N("stale", { type: "done", quality: "fabrication", diagnostics: [] }) === "stale" && N("stale", { type: "fail" }) === "stale" &&
    N("draft", { type: "done", quality: "fabrication", diagnostics: [] }) === "draft");
  check("UI-05 warnings do not fail a fabrication result; blocking does",
    N("processing", { type: "done", quality: "fabrication", diagnostics: [D.make("PART_SMALL", { quality: "fabrication", layer: 1 })] }) === "validated");
  check("UI-05 nextState refuses an unknown state or event (STATE)",
    throws(() => N("ready", { type: "edit" }), /STATE/) && throws(() => N("draft", { type: "poke" }), /STATE/) && throws(() => N("draft", null), /STATE/));
  check("UI-05 STATES are draft, stale, processing, validated, failed (frozen)",
    JSON.stringify(D.STATES) === JSON.stringify(["draft", "stale", "processing", "validated", "failed"]) && Object.isFrozen(D.STATES));
  check("UI-05/NFR-07 stateBadge: a distinct text label and description per state (not colour alone)", (() => {
    const b = D.STATES.map((s) => D.stateBadge(s));
    return b.every((x, i) => x.state === D.STATES[i] && typeof x.label === "string" && x.label.length > 2 && typeof x.text === "string" && x.text.length > 10) &&
      new Set(b.map((x) => x.label)).size === 5 && throws(() => D.stateBadge("ready"), /STATE/); })());

  // ---- engine: draft cleanupReport carries overlay polygons (GEO-08); fabrication keeps mm² only
  E.TEST_HOOKS = true;
  const w = 120, h = 80, hm = F.heightMap(4, w, h, 30);
  const dec = await SBPng.decode(F.pngEncode({ w, h, colorType: 0, bitDepth: 8, data: hm }), { mode: "height" });
  const p = SBSchema.defaults("plywood"); p.source = SBSchema.sourceTemplate(); p.source.w = w; p.source.h = h;
  p.source.sampleHash = dec.sampleHash; p.source.decode = dec.policy;
  const req = (o) => Object.assign({ requestId: "r1", revision: p.revision, engineVersion: E.VERSION, quality: "draft",
    normalizedSource: { pixels: dec.samples, channels: dec.channels, w: dec.w, h: dec.h, alpha: dec.alpha }, sourceHash: null, config: p, deviceClass: "desktop" }, o || {});
  const s = E.generate(req()).snapshot;
  const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, 0.002 * Math.max(a, b));
  check("GEO-08 draft cleanupReport: added/removed polygons (µm, page frame) whose area equals addedMM2/removedMM2",
    s.cleanupReport.some((c) => c.addedMM2 > 0 || c.removedMM2 > 0) && s.cleanupReport.every((c) =>
      (c.addedMM2 > 0 ? Array.isArray(c.added) && near(G.area(c.added) / 1e6, c.addedMM2) : c.added === undefined) &&
      (c.removedMM2 > 0 ? Array.isArray(c.removed) && near(G.area(c.removed) / 1e6, c.removedMM2) : c.removed === undefined)));
  const fab = E.generate(req({ quality: "fabrication" })).snapshot;
  check("GEO-08 fabrication cleanupReport keeps mm² only (no overlay tracing in the fabrication budget)",
    fab.cleanupReport.every((c) => c.added === undefined && c.removed === undefined && Number.isFinite(c.addedMM2)));
  check("NFR-05/D4 draft overlays are deterministic (rerun: same cleanupReport polygons and geometryHash); draft and fabrication hashes stay quality-scoped",
    (() => { const r2 = E.generate(req()); return r2.geometryHash === s.geometryHash && JSON.stringify(r2.snapshot.cleanupReport) === JSON.stringify(s.cleanupReport) &&
      fab.geometryHash !== s.geometryHash; })());

  // ---- legacy pipeline: cleanupReport-shaped overlays from legacyRun (the app's interim source)
  const GC = require("./golden/oldrun.json").cfg, lw = 40, lh = 30, rgba = new Uint8ClampedArray(lw * lh * 4);
  for (let i = 0; i < lw * lh; i++) { const v = ((i % lw) * 6 + Math.floor(i / lw) * 3) % 256; rgba.set([v, v, v, 255], i * 4); }
  const cfg = Object.assign({}, GC, { holes: false });
  const lr = E.legacyRun(rgba, lw, lh, cfg);
  check("GEO-08 legacyRun keeps each sheet's cleanup counts (addedPx/removedPx) and pre-cleanup mask",
    lr.sheets.slice(1).every((sh) => sh.cleanup && Number.isInteger(sh.cleanup.addedPx) && sh.pre instanceof Uint8Array && sh.pre.length === lw * lh) &&
    lr.sheets.slice(1).every((sh) => { let a = 0, r = 0; for (let i = 0; i < sh.mask.length; i++) { if (sh.mask[i] && !sh.pre[i]) a++; if (!sh.mask[i] && sh.pre[i]) r++; }
      return a === sh.cleanup.addedPx && r === sh.cleanup.removedPx; }));
  const view = E.connectedLayers(lr.sheets, lw, lh, cfg), rep = E.legacyCleanupReport(lr.sheets, lw, lh, cfg);
  const pxMM2 = (M.scale({ w: lw, h: lh, artWMM: view.page.artWMM, artHMM: view.page.artHMM }).sxUm * M.scale({ w: lw, h: lh, artWMM: view.page.artWMM, artHMM: view.page.artHMM }).syUm) / 1e6;
  check("GEO-08 legacyCleanupReport: one entry per sheet in mm²; polygons match the pixel counts",
    rep.length === lr.sheets.length && rep.every((c, k) => c.layer === k && (k === 0 ? c.addedMM2 === 0 && c.removedMM2 === 0 :
      near(c.addedMM2, lr.sheets[k].cleanup.addedPx * pxMM2) && near(c.removedMM2, lr.sheets[k].cleanup.removedPx * pxMM2) &&
      (c.addedMM2 > 0 ? near(G.area(c.added) / 1e6, c.addedMM2) : !c.added) && (c.removedMM2 > 0 ? near(G.area(c.removed) / 1e6, c.removedMM2) : !c.removed))) &&
    rep.some((c) => c.addedMM2 > 0 || c.removedMM2 > 0));
  check("UI-05 legacyCleanupReport bridges are polygons inside the page (µm), one per bridged sheet",
    rep.every((c, k) => { const b = lr.sheets[k].bridges, any = b && b.some((x) => x);
      if (!any) return c.bridges === undefined;
      const WU = Math.round(view.page.wMM * 1000), HU = Math.round(view.page.hMM * 1000);
      return c.bridges.length > 0 && c.bridges.every((q) => q.outer.every((v, i) => v >= 0 && v <= (i % 2 ? HU : WU))); }));

  // ---- SBProof.overlays model
  const cr = [{ layer: 0, addedMM2: 0, removedMM2: 0, holesFilled: 0, partsRemoved: 0 },
    { layer: 1, addedMM2: 2.5, removedMM2: 1.25, holesFilled: 1, partsRemoved: 2, added: [{ outer: [0, 0, 1000, 0, 1000, 1000, 0, 1000], holes: [] }],
      removed: [{ outer: [2000, 0, 3000, 0, 3000, 1000, 2000, 1000], holes: [] }], bridges: [{ outer: [0, 2000, 1000, 2000, 1000, 3000, 0, 3000], holes: [] }] }];
  const ub = D.make("BOND_UNSUPPORTED", { layer: 1, areaMM2: 3.5, region: [1, 2, 3, 4] });
  const oc = P.overlays({ cleanupReport: cr, diagnostics: [ub, D.make("PART_SMALL", { layer: 1 })], mode: "connected-sheet" });
  check("GEO-08 overlays: one entry per layer with added/removed polygons and mm² labels",
    oc.length === 2 && oc[1].layerIndex === 1 && oc[1].added === cr[1].added && oc[1].removed === cr[1].removed &&
    /\+2\.5 mm²/.test(oc[1].label) && /−1\.25 mm²/.test(oc[1].label) && oc[0].label === "" && oc[0].added === null);
  check("UI-05 overlays: part counts (holesFilled, partsRemoved) carried and in the label, zero terms omitted",
    oc[1].holesFilled === 1 && oc[1].partsRemoved === 2 && /1 hole filled/.test(oc[1].label) && /2 parts removed/.test(oc[1].label) &&
    oc[0].holesFilled === 0 && oc[0].partsRemoved === 0 &&
    P.overlays({ cleanupReport: [{ layer: 0, addedMM2: 0, removedMM2: 0, holesFilled: 3, partsRemoved: 0 }], diagnostics: [], mode: "bonded-relief" })[0].label === "3 holes filled");
  check("UI-05 overlays: unsupported regions from BOND_UNSUPPORTED (layer, mm², region), other codes ignored",
    oc[1].unsupported.length === 1 && oc[1].unsupported[0].areaMM2 === 3.5 && JSON.stringify(oc[1].unsupported[0].region) === "[1,2,3,4]" && oc[0].unsupported.length === 0);
  check("UI-05 overlays: bridges in connected mode only",
    oc[1].bridges === cr[1].bridges && P.overlays({ cleanupReport: cr, diagnostics: [], mode: "bonded-relief" })[1].bridges === null);
  check("UI-05 overlays refuse a bad mode (MODE) and do not mutate the report", (() => {
    const before = JSON.stringify(cr); return throws(() => P.overlays({ cleanupReport: cr, diagnostics: [], mode: "glued" }), /MODE/) && JSON.stringify(cr) === before; })());

  // ---- preview.js overlays (recording 2D context, no DOM)
  const log = { fills: [], strokes: [], texts: [], dashes: [], draws: 0 };
  const mkCtx = () => { const st = { imageSmoothingEnabled: true, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1 }; const stack = []; let dash = [];
    return Object.assign(st, { setTransform() {}, clearRect() {}, save() { stack.push(Object.assign({}, st, { _d: dash })); }, restore() { const o = stack.pop() || {}; dash = o._d || []; delete o._d; Object.assign(st, o); },
      fillRect() {}, strokeRect() { log.strokes.push({ style: st.strokeStyle, dash: dash.slice(), rect: true }); }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, rect() {}, arc() {},
      setLineDash(d) { dash = d.slice(); }, getLineDash() { return dash.slice(); },
      stroke() { log.strokes.push({ style: st.strokeStyle, dash: dash.slice() }); }, fillText(t) { log.texts.push(t); }, fill() { log.fills.push(st.fillStyle); },
      createImageData: (w2, h2) => ({ data: new Uint8ClampedArray(w2 * h2 * 4) }), putImageData() {}, measureText: (t) => ({ width: t.length * 6 }),
      drawImage() { log.draws++; } }); };
  const mkCanvas = () => ({ width: 0, height: 0, clientWidth: 400, clientHeight: 300, _ctx: null,
    getContext() { return this._ctx || (this._ctx = mkCtx()); }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }), toBlob(cb) { cb(null); } });
  const ctx = vm.createContext({ console, Math, Uint8Array, Uint8ClampedArray, Promise, SBUtil, SBProof: P, devicePixelRatio: 1,
    document: { createElement: () => mkCanvas() }, addEventListener() {}, requestAnimationFrame() {},
    Path2D: function () { this.moveTo = () => {}; this.lineTo = () => {}; this.closePath = () => {}; } });
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "preview.js"), "utf8"), ctx, { filename: "preview.js" });
  const pv = ctx.SBPreview.create(mkCanvas());
  check("UI-05 preview exposes setOverlays and setShowOverlays", typeof pv.setOverlays === "function" && typeof pv.setShowOverlays === "function");
  if (typeof pv.setOverlays !== "function") return;
  const pg = M.page({ artWMM: 80, artHMM: 50, frameMM: 10 });
  const LC = M.fromMasks(F.MASKS.borderTouch.layers, 8, 5, pg, { frame: true });
  pv.setSnapshot({ page: pg, layers: LC, tMM: 3, gMM: 2 }, "#808080");
  pv.setOverlays(oc);
  const frame = (mode) => { log.fills = []; log.strokes = []; log.texts = []; pv.setMode(mode); pv.snapshot(); return { fills: log.fills.slice(), strokes: log.strokes.slice(), texts: log.texts.slice() }; };
  const off = frame("proof");
  check("UI-02 overlays are off by default: the proof stays the material alone", !off.texts.some((t) => /mm²|!/.test(t)) && off.strokes.every((x) => x.dash.length === 0));
  pv.setShowOverlays(true);
  const on = frame("proof");
  const GREEN = "rgba(46,204,113,0.55)", RED = "#E5484D", AMBERC = "#F0A227";
  check("GEO-08 proof overlay: added in green, removed as a dashed outline, mm² labels",
    on.fills.includes(GREEN) && on.strokes.some((x) => x.dash.length > 0) && on.texts.some((t) => /\+2\.5 mm²/.test(t)));
  check("UI-05 proof overlay legend shows the part counts with the changed area",
    on.texts.some((t) => /^Layer 2: .*\+2\.5 mm².*1 hole filled.*2 parts removed/.test(t)));
  check("UI-05 proof overlay: unsupported in red with a \"!\" icon; bridges in amber (connected)",
    on.strokes.some((x) => x.style === RED) && on.texts.includes("!") && on.fills.includes(AMBERC));
  pv.setOverlays(P.overlays({ cleanupReport: cr, diagnostics: [], mode: "bonded-relief" }));
  check("UI-05 bonded overlay draws no bridges", !frame("proof").fills.includes(AMBERC));
  pv.setShowBridges(false); pv.setOverlays(oc);
  check("UI-05 #in-bridgesvis off hides the amber bridges, keeps the rest", (() => { const f = frame("proof"); return !f.fills.includes(AMBERC) && f.fills.includes(GREEN); })());
  check("UI-03 section view draws no overlay", !frame("section").texts.some((t) => /mm²$|^!$/.test(t)));

  // ---- wiring
  const root = path.join(__dirname, ".."), appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  check("UI-05 index.html: a state badge (role=status) and a Changes overlay toggle; #in-bridgesvis kept",
    /id="state-badge"[^>]*role="status"|role="status"[^>]*id="state-badge"/.test(html) && /id="in-overlays"/.test(html) && /id="in-bridgesvis"/.test(html));
  check("UI-05 index.html: the state badge is in the tab bar, so every tab (Layers included) shows the result state",
    (() => { const m = /<nav class="tabs"[\s\S]*?<\/nav>/.exec(html); return !!m && /id="state-badge"/.test(m[0]) && (html.match(/id="state-badge"/g) || []).length === 1; })());
  check("UI-05 Draft badge does not claim export regenerates at fabrication quality (the app exports the draft sheets)",
    !/regenerat/i.test(D.stateBadge("draft").text) && /not validated/i.test(D.stateBadge("draft").text));
  check("UI-05 app.js: a failed run says the previous result is still shown",
    /previous result is still shown/.test(appSrc));
  check("UI-05 app.js: state via SBDiag.nextState (edit → stale, start → processing, done/fail), badge from SBDiag.stateBadge",
    /SBDiag\.nextState\(/.test(appSrc) && /SBDiag\.stateBadge\(/.test(appSrc) && /type: "edit"/.test(appSrc) && /type: "start"/.test(appSrc) &&
    /type: "done"/.test(appSrc) && /type: "fail"/.test(appSrc));
  check("UI-05 app.js: overlays from the shown snapshot's cleanupReport through SBProof.overlays (alpha.3 E5); bridges no longer from masks",
    /SBProof\.overlays\(\{ cleanupReport: snap\.cleanupReport/.test(appSrc) && /SBProof\.overlays\(/.test(appSrc) && /preview\.setOverlays\(/.test(appSrc) &&
    /in-overlays/.test(appSrc) && !/bridges: \{ masks:/.test(appSrc));
});

suite("diag.js/engine.js/preview.js/app.js/style.css — G2.13c diagnostics panel (UI-04, NFR-07, AT-08/10/20)", () => {
  const D = SBDiag, E = SBEngine, M = SBMaterial, F = require("./fixtures.js");
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  check("G2.13c API present", typeof D.summarize === "function" && typeof D.describe === "function" &&
    typeof E.legacyDiagnostics === "function" && typeof E.legacySnapshotHash === "function");
  if (typeof D.summarize !== "function" || typeof D.describe !== "function") return;

  // ---- summarize (UI-04)
  const thin = D.make("PART_THIN", { layer: 1, part: "L1-P002", region: [1, 2, 3, 4], measured: { value: 0.8, unit: "mm" }, limit: { value: 1.5, unit: "mm" } });
  const unsup = D.make("BOND_UNSUPPORTED", { layer: 2, part: "L2-P001", areaMM2: 3.5, region: [10, 20, 12, 25], measured: { value: 3.5, unit: "mm2" }, limit: { value: 0, unit: "mm2" } });
  const uncal = D.make("MAT_UNCALIBRATED", {}), info = D.make("PALETTE_ONLY", {}), samp = D.make("SAMPLING_LOW", { measured: { value: 2.875, unit: "samples" }, limit: { value: 3, unit: "samples" } });
  const all = [info, thin, uncal, unsup, samp];
  const COLOR_WORDS = /\b(red|amber|yellow|green|orange|blue|grey|gray|purple|pink|black|white)\b/i;
  const sum = D.summarize(all);
  check("UI-04 summarize labels are text, not color names", sum.length === 3 &&
    sum.every((g) => typeof g.label === "string" && g.label.length >= 4 && !COLOR_WORDS.test(g.label) && !/^#|rgb/.test(g.label) &&
      typeof g.icon === "string" && g.icon.length > 0 && !COLOR_WORDS.test(g.icon)) &&
    new Set(sum.map((g) => g.label)).size === 3);
  check("UI-04 summarize: grouped by severity (blocking, warning, info), counts per group, empty groups omitted",
    JSON.stringify(sum.map((g) => [g.severity, g.count])) === JSON.stringify([["blocking", 2], ["warning", 2], ["info", 1]]) &&
    JSON.stringify(D.summarize([info]).map((g) => g.severity)) === '["info"]' && D.summarize([]).length === 0 && D.summarize(null).length === 0);
  check("§9.5 summarize takes severity from the registry, never from a stored field",
    D.summarize([Object.assign({}, thin, { severity: "info" })])[0].severity === "warning");
  check("UI-04 summarize counts an aggregated diagnostic once (its affected parts are in the item text)",
    D.summarize(D.aggregate([thin, D.make("PART_THIN", { layer: 1, part: "L1-P003", measured: { value: 0.6, unit: "mm" }, limit: { value: 1.5, unit: "mm" } })]))[0].count === 1);

  // ---- describe (item text)
  const t = D.describe(thin);
  check("UI-04 item text includes measured vs limit",
    /measured 0\.8 mm/.test(t.measure) && /limit 1\.5 mm/.test(t.measure) && t.text.includes(t.measure) &&
    /3\.5 mm²/.test(D.describe(unsup).measure) && /0 mm²/.test(D.describe(unsup).measure) &&
    /measured 2\.88 samples/.test(D.describe(samp).text) && /limit 3 samples/.test(D.describe(samp).text));
  check("UI-04 describe: severity text and icon, title, fix and location (1-based layer, part)",
    t.severity === "warning" && t.severityLabel === "Warning" && t.icon === sum[1].icon && t.title === D.CODES.PART_THIN.title &&
    t.fix === D.CODES.PART_THIN.fix && t.where === "Layer 2, part L1-P002" && t.text.startsWith("Warning: ") && t.text.includes("Layer 2") &&
    D.describe(unsup).severityLabel === "Blocking" && D.describe(info).severityLabel === "Info");
  check("UI-04 describe: no measurement → empty measure, no location → empty where; not navigable",
    D.describe(uncal).measure === "" && D.describe(uncal).where === "" && D.describe(uncal).navigable === false && t.navigable === true);
  check("UI-04 describe: focus target {layer, parts, regions}; one bbox or a region list normalized to a list of bboxes", (() => {
    const agg = D.aggregate([thin, D.make("PART_THIN", { layer: 1, part: "L1-P003", region: [5, 6, 7, 8], measured: { value: 0.6, unit: "mm" }, limit: { value: 1.5, unit: "mm" } })])[0];
    const f = D.describe(agg).focus;
    return JSON.stringify(t.focus) === JSON.stringify({ layer: 1, parts: ["L1-P002"], regions: [[1, 2, 3, 4]] }) &&
      f.layer === 1 && JSON.stringify(f.parts) === '["L1-P002","L1-P003"]' && JSON.stringify(f.regions) === "[[1,2,3,4],[5,6,7,8]]" &&
      /2 affected/.test(D.describe(agg).text) && /measured 0\.6 mm/.test(D.describe(agg).measure) && D.describe(uncal).focus === null; })());
  check("UI-04 describe refuses a non-diagnostic", throws(() => D.describe(null), /describe/) && throws(() => D.describe({}), /describe/));

  // ---- engine: the app's interim diagnostics for a legacy run (until it adopts SBEngine.generate)
  const pg = M.page({ artWMM: 80, artHMM: 50, frameMM: 10 });
  const view = { page: pg, layers: M.fromMasks(F.MASKS.borderTouch.layers, 8, 5, pg, { frame: true }) };
  const pa = SBSchema.defaults("acrylic"), pp = SBSchema.defaults("plywood");
  const da = E.legacyDiagnostics(view, 8, 5, pa), dp = E.legacyDiagnostics(view, 8, 5, pp);
  check("UI-04 legacyDiagnostics: draft-quality, registry codes, the project revision; MAT_UNCALIBRATED for uncalibrated stock",
    Array.isArray(da) && da.length > 0 && da.every((d) => d.quality === "draft" && D.CODES[d.code] && d.revision === pa.revision) &&
    da.some((d) => d.code === "MAT_UNCALIBRATED"));
  check("UI-04 legacyDiagnostics: SAMPLING_LOW measured vs limit at the legacy pitch (10 mm/px here)",
    (() => { const s = da.find((d) => d.code === "SAMPLING_LOW"); return !!s && s.measured.unit === "samples" && s.limit.value === 3 && s.measured.value < 3; })());
  check("D3/D6 legacyDiagnostics: bonded projects run the bonded support checks (BOND_* only in bonded), connected the split check",
    !da.some((d) => /^BOND_/.test(d.code)) && dp.every((d) => d.code !== "CONNECTED_SPLIT"));
  check("NFR-05 legacyDiagnostics is deterministic and does not mutate the view", (() => {
    const before = JSON.stringify(view.layers.map((L) => L.material)); const again = E.legacyDiagnostics(view, 8, 5, pa);
    return JSON.stringify(again) === JSON.stringify(da) && JSON.stringify(view.layers.map((L) => L.material)) === before; })());
  const h1 = E.legacySnapshotHash(view, 8, 5);
  check("§9.5/D4 legacySnapshotHash: a hex hash over the layer hashes and raster; changes with the geometry or raster size",
    /^[0-9a-f]{64}$/.test(h1) && h1 === E.legacySnapshotHash(view, 8, 5) && h1 !== E.legacySnapshotHash(view, 16, 10) &&
    h1 !== E.legacySnapshotHash({ page: pg, layers: view.layers.slice(0, 1) }, 8, 5));
  check("§9.5 acks are scoped to the snapshot: an ack key for one legacy snapshot never matches another",
    D.ackKey(thin, h1) !== D.ackKey(thin, E.legacySnapshotHash(view, 16, 10)));

  // ---- preview.js focus highlight (recording 2D context, no DOM)
  const log = { strokes: [], texts: [], fills: [], draws: 0 };
  const mkCtx = () => { const st = { imageSmoothingEnabled: true, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1 }; const stack = []; let dash = [];
    return Object.assign(st, { setTransform() {}, clearRect() {}, save() { stack.push(Object.assign({}, st, { _d: dash })); }, restore() { const o = stack.pop() || {}; dash = o._d || []; delete o._d; Object.assign(st, o); },
      fillRect() { log.fills.push(st.fillStyle); }, strokeRect() { log.strokes.push({ style: st.strokeStyle, w: st.lineWidth, rect: true }); }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, rect() {}, arc() {},
      setLineDash(d) { dash = d.slice(); }, getLineDash() { return dash.slice(); },
      stroke() { log.strokes.push({ style: st.strokeStyle, w: st.lineWidth }); }, fillText(x) { log.texts.push(x); }, fill() { log.fills.push(st.fillStyle); },
      createImageData: (w2, h2) => ({ data: new Uint8ClampedArray(w2 * h2 * 4) }), putImageData() {}, measureText: (x) => ({ width: x.length * 6 }),
      drawImage() { log.draws++; } }); };
  const mkCanvas = () => ({ width: 0, height: 0, clientWidth: 400, clientHeight: 300, _ctx: null,
    getContext() { return this._ctx || (this._ctx = mkCtx()); }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }), toBlob(cb) { cb(null); } });
  const ctx = vm.createContext({ console, Math, Uint8Array, Uint8ClampedArray, Promise, SBUtil, SBProof: globalThis.SBProof, devicePixelRatio: 1,
    document: { createElement: () => mkCanvas() }, addEventListener() {}, requestAnimationFrame() {},
    Path2D: function () { this.moveTo = () => {}; this.lineTo = () => {}; this.closePath = () => {}; } });
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "preview.js"), "utf8"), ctx, { filename: "preview.js" });
  const pv = ctx.SBPreview.create(mkCanvas());
  check("UI-04 preview exposes setFocus", typeof pv.setFocus === "function");
  if (typeof pv.setFocus !== "function") return;
  const LA = M.assignParts(view.layers);
  pv.setSnapshot({ page: pg, layers: LA, tMM: 3, gMM: 2 }, "#808080");
  const frame = (mode) => { log.strokes = []; log.texts = []; log.fills = []; log.draws = 0; pv.setMode(mode); pv.snapshot(); return { strokes: log.strokes.slice(), texts: log.texts.slice(), fills: log.fills.slice(), draws: log.draws }; };
  const plain = frame("proof");
  const pid = LA[1].parts[0].id;
  pv.setFocus({ layer: 1, parts: [pid], regions: [[10, 10, 30, 20]], label: "Layer 2" });
  const foc = frame("proof");
  check("UI-04 focus: the region is outlined with a high-contrast double stroke and a text label (not colour only)",
    foc.strokes.filter((s) => s.rect).length >= 2 && foc.texts.some((x) => /Layer 2/.test(x)) && !plain.texts.some((x) => /Layer 2/.test(x)));
  check("UI-04 focus: the other layers are veiled and the focused layer is drawn again on top; its part is outlined",
    foc.draws === plain.draws + 1 && foc.fills.some((f) => /rgba\(/.test(f)) && foc.strokes.filter((s) => !s.rect).length > plain.strokes.filter((s) => !s.rect).length);
  check("UI-04 focus is proof-only (section draws none) and cleared by setFocus(null) and by a new snapshot", (() => {
    const sec = frame("section"); if (sec.texts.some((x) => /^Layer 2$/.test(x))) return false;
    pv.setFocus(null); const a = frame("proof"); pv.setFocus({ layer: 1, parts: [], regions: [[1, 1, 2, 2]], label: "Layer 2" });
    pv.setSnapshot({ page: pg, layers: LA, tMM: 3, gMM: 2 }, "#808080"); const b = frame("proof");
    return !a.texts.some((x) => /Layer 2/.test(x)) && !b.texts.some((x) => /Layer 2/.test(x)); })());
  check("UI-04 setFocus refuses a layer outside the snapshot", throws(() => pv.setFocus({ layer: 99, parts: [], regions: [] }), /FOCUS/));

  // ---- wiring
  const root = path.join(__dirname, ".."), appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8"),
    html = fs.readFileSync(path.join(root, "index.html"), "utf8"), css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
  check("UI-04 index.html: a Diagnostics region in Review with a heading, a status summary and the list",
    /id="diag-panel"[^>]*aria-labelledby="h-diag"/.test(html) && /id="h-diag"/.test(html) && /id="diag-summary"[^>]*role="status"/.test(html) &&
    /id="diag-list"[^>]*class="diag-list"|class="diag-list"[^>]*id="diag-list"/.test(html) &&
    (() => { const m = /<section class="step" id="stage-review"[\s\S]*?<\/section>/.exec(html); return !!m && /id="diag-panel"/.test(m[0]); })());
  check("UI-04 app.js: the panel is built from SBDiag.summarize / SBDiag.describe over the shown result's snapshot.diagnostics (alpha.3 E5)",
    /SBDiag\.summarize\(/.test(appSrc) && /SBDiag\.describe\(/.test(appSrc) && /r\.snapshot\.diagnostics/.test(appSrc) && /r\.snapshot\.geometryHash/.test(appSrc));
  check("NFR-07 app.js: navigable items are <button>s (click and Enter) that switch to the Proof and call preview.setFocus",
    /createElement\("button"\)/.test(appSrc) && /preview\.setFocus\(/.test(appSrc) && /switchTab\("proof"\)/.test(appSrc));
  check("§9.5 app.js: warnings get an \"Acknowledge\" checkbox keyed by SBDiag.ackKey on the current snapshot hash; blocking never",
    /Acknowledge/.test(appSrc) && /SBDiag\.ackKey\(d, r\.snapshot\.geometryHash\)/.test(appSrc) && /severity === "warning"/.test(appSrc));
  check("NFR-07 app.js: icons are aria-hidden and the severity is in text", /aria-hidden/.test(appSrc) && /severityLabel/.test(appSrc));
  check("UI-04 style.css: .diag-list and .badge rules; a visible keyboard focus style", /\.diag-list\b/.test(css) && /\.badge\b/.test(css) && /\.diag-list[^{]*:focus-visible/.test(css));
});

suite("support.js/engine.js/proof.js/preview.js/app.js — G2.13d clip dialog and revert (SUP-04, D-4.6, PRJ-04, AT-09/15)", () => {
  const E = SBEngine, S = SBSupport, G = SBGeom;
  const throws = (f, re) => { try { f(); return false; } catch (x) { return !re || re.test(x.message); } };
  check("G2.13d API present", typeof E.legacyView === "function" && typeof SBProof.clipReview === "function" && typeof SBProof.repairRows === "function");
  if (typeof E.legacyView !== "function" || typeof SBProof.clipReview !== "function" || typeof SBProof.repairRows !== "function") return;

  // A legacy run of three 10 × 8 px sheets at 1 mm/px (no frame, no holes): sheet 0 is the solid backing, sheet 1 has a
  // 2 mm gap (x 4..6), sheet 2 spans it (x 1..9, y 2..5), so layer 2 overhangs the gap by 8 mm² (the G2.9 fixture).
  const grid = (w, h, f) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = f(x, y) ? 1 : 0; return m; };
  const W = 10, H = 8;
  const sheets = [{ mask: grid(W, H, () => 1) }, { mask: grid(W, H, (x) => x < 4 || x >= 6) }, { mask: grid(W, H, (x, y) => x >= 1 && x < 9 && y >= 2 && y < 6) }];
  const cfgL = { widthMM: 10, marginMM: 0, holes: false, holeDiaMM: 0, cornerStyle: "faceted", projectName: "t" };
  const P0 = SBSchema.defaults("plywood"); P0.construction.sheets = 3; P0.revision = 5;
  const frozen = JSON.stringify(P0);
  const base = E.connectedLayers(sheets, W, H, cfgL);
  const v0 = E.legacyView(sheets, W, H, cfgL, P0);
  const unsup = (v, p, k) => E.legacyDiagnostics(v, W, H, p).some((d) => d.code === "BOND_UNSUPPORTED" && d.layer === k);
  check("SUP-04 legacyView without repairs == connectedLayers (same page and layer hashes), no repair diagnostics",
    JSON.stringify(v0.page) === JSON.stringify(base.page) && v0.layers.length === 3 &&
    v0.layers.every((L, k) => L.canonicalHash === base.layers[k].canonicalHash) && v0.diagnostics.length === 0 && v0.applied.length === 0 &&
    unsup(v0, P0, 2));

  const prop = S.proposeClip({ layers: v0.layers, quality: "draft", revision: P0.revision }, 2);
  const P1 = S.applyClip(P0, prop);
  const v1 = E.legacyView(sheets, W, H, cfgL, P1);
  check("AT-09 accepted clip is replayed by legacyView: layer 2 becomes the reviewed afterHash and is no longer unsupported",
    prop.removedAreaMM2 === 8 && P1.revision === 6 && JSON.stringify(P0) === frozen &&
    JSON.stringify(v1.applied) === "[0]" && v1.diagnostics.length === 0 && v1.layers[2].canonicalHash === prop.afterHash &&
    v1.layers[1].canonicalHash === v0.layers[1].canonicalHash && !unsup(v1, P1, 2));

  const P2 = JSON.parse(JSON.stringify(P1)); P2.material.minFeatureMM = 1.6;
  const v2 = E.legacyView(sheets, W, H, cfgL, P2);
  check("SUP-04 settings changed after the review → REPAIR_STALE (blocking) in legacyDiagnostics, clip not applied",
    v2.applied.length === 0 && v2.layers[2].canonicalHash === v0.layers[2].canonicalHash &&
    (() => { const ds = E.legacyDiagnostics(v2, W, H, P2), st = ds.find((d) => d.code === "REPAIR_STALE");
      return !!st && st.layer === 2 && SBDiag.describe(st).severity === "blocking" && ds.some((d) => d.code === "BOND_UNSUPPORTED" && d.layer === 2); })());

  const P3 = S.removeRepair(P1, 0);
  const v3 = E.legacyView(sheets, W, H, cfgL, P3);
  check("D-4.6 Revert (removeRepair) restores the pre-repair layer hash on a new revision",
    P3.revision === 7 && P3.construction.repairs.length === 0 && v3.layers[2].canonicalHash === prop.beforeHash && unsup(v3, P3, 2));

  check("SUP-04 export: connectedFiles with the project cuts the clipped layer (sheet_03 and proof.svg change; others equal)", (() => {
    const a = E.connectedFiles(sheets, W, H, cfgL, ["#111111", "#555555", "#999999"]);
    const b = E.connectedFiles(sheets, W, H, cfgL, ["#111111", "#555555", "#999999"], P1);
    const c = E.connectedFiles(sheets, W, H, cfgL, ["#111111", "#555555", "#999999"], P0);
    const f = (fs2, n) => fs2.find((x) => x.name === n).data;
    return f(a, "sheet_03.svg") !== f(b, "sheet_03.svg") && f(a, "proof.svg") !== f(b, "proof.svg") &&
      f(a, "sheet_02.svg") === f(b, "sheet_02.svg") && JSON.stringify(a) === JSON.stringify(c); })());
  check("NFR-05 legacyView is deterministic and does not mutate the sheets or the project", (() => {
    const s0 = JSON.stringify(P1), m0 = Array.from(sheets[2].mask).join("");
    const again = E.legacyView(sheets, W, H, cfgL, P1);
    return JSON.stringify(again.layers.map((L) => L.canonicalHash)) === JSON.stringify(v1.layers.map((L) => L.canonicalHash)) &&
      JSON.stringify(P1) === s0 && Array.from(sheets[2].mask).join("") === m0; })());

  // ---- the dialog model (pure)
  const rv = SBProof.clipReview(prop);
  check("SUP-04 clipReview: removed mm², part count before → after, 1-based layer names, the removed rings",
    rv.layer === 2 && rv.removedMM2 === 8 && rv.partCountBefore === 1 && rv.partCountAfter === 2 && rv.empty === false &&
    /Layer 3/.test(rv.title) && /Layer 2/.test(rv.title) && /8 mm²/.test(rv.summary) && /1 → 2/.test(rv.summary) &&
    Array.isArray(rv.rings) && rv.rings.length === 1 && rv.rings[0] === prop.removed[0].outer);
  const noop = S.proposeClip({ layers: v1.layers, quality: "draft", revision: P1.revision }, 2);
  check("SUP-04 clipReview: nothing to remove → empty, said in text", SBProof.clipReview(noop).empty === true &&
    /nothing/i.test(SBProof.clipReview(noop).summary) && throws(() => SBProof.clipReview(null), /clipReview/));
  const rows = SBProof.repairRows(P1.construction.repairs, { applied: [0] });
  const rowsStale = SBProof.repairRows(P1.construction.repairs, { applied: [] });
  check("D-4.6 repairRows: one row per construction.repairs entry with its reviewed record and status (applied / stale)",
    rows.length === 1 && rows[0].index === 0 && rows[0].layer === 2 && rows[0].status === "applied" && /Layer 3/.test(rows[0].text) &&
    /8 mm²/.test(rows[0].text) && /draft/.test(rows[0].text) && /revision 5/.test(rows[0].text) && rowsStale[0].status === "stale" &&
    /review/i.test(rowsStale[0].text) && SBProof.repairRows([], { applied: [] }).length === 0);
  check("D-4.6 repairRows: no current result (applied unknown) → status pending, never claimed applied",
    (() => { const r = SBProof.repairRows(P1.construction.repairs, {})[0]; return r.status === "pending" && !/Applied/.test(r.text); })());
  check("D-4.6 repairRows: reverting entry i also reverts every later entry (laterCount)", (() => {
    const two = P1.construction.repairs.concat([Object.assign({}, P1.construction.repairs[0], { layer: 1 })]);
    const r2 = SBProof.repairRows(two, { applied: [0, 1] });
    return r2[0].laterCount === 1 && r2[1].laterCount === 0; })());
  check("SUP-04 repairForDiagnostic: a REPAIR_STALE item finds its skipped entry on that layer; REPAIR_REVIEW_FAB an applied one", (() => {
    const st = SBDiag.make("REPAIR_STALE", { layer: 2 }), rf = SBDiag.make("REPAIR_REVIEW_FAB", { layer: 2 });
    return SBProof.repairForDiagnostic(st, P1.construction.repairs, []) === 0 && SBProof.repairForDiagnostic(st, P1.construction.repairs, [0]) === -1 &&
      SBProof.repairForDiagnostic(rf, P1.construction.repairs, [0]) === 0 && SBProof.repairForDiagnostic(SBDiag.make("MAT_UNCALIBRATED", {}), P1.construction.repairs, []) === -1; })());

  // ---- preview: the removed-area overlay card (recording 2D context, no DOM)
  const log = { strokes: [], fills: [], draws: 0, dashes: [] };
  const mkCtx = () => { const st = { imageSmoothingEnabled: true, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1 }; const stack = []; let dash = [];
    return Object.assign(st, { setTransform() {}, clearRect() {}, save() { stack.push(Object.assign({}, st)); }, restore() { Object.assign(st, stack.pop() || {}); },
      fillRect() { log.fills.push(st.fillStyle); }, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, rect() {}, arc() {},
      setLineDash(d) { dash = d.slice(); }, getLineDash() { return dash.slice(); },
      stroke() { log.strokes.push(st.strokeStyle); log.dashes.push(dash.length); }, fillText() {}, fill() { log.fills.push(st.fillStyle); },
      createImageData: (w2, h2) => ({ data: new Uint8ClampedArray(w2 * h2 * 4) }), putImageData() {}, measureText: (x) => ({ width: x.length * 6 }),
      drawImage() { log.draws++; } }); };
  const mkCanvas = () => ({ width: 0, height: 0, clientWidth: 400, clientHeight: 300, _ctx: null,
    getContext() { return this._ctx || (this._ctx = mkCtx()); }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }), toBlob(cb) { cb(null); } });
  const ctx = vm.createContext({ console, Math, Uint8Array, Uint8ClampedArray, Promise, SBUtil, SBProof: globalThis.SBProof, devicePixelRatio: 1,
    document: { createElement: () => mkCanvas() }, addEventListener() {}, requestAnimationFrame() {},
    Path2D: function () { this.moveTo = () => {}; this.lineTo = () => {}; this.closePath = () => {}; } });
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "preview.js"), "utf8"), ctx, { filename: "preview.js" });
  const pv = ctx.SBPreview.create(mkCanvas());
  check("SUP-04 preview exposes drawClipCard; false without a polygon snapshot", typeof pv.drawClipCard === "function" && pv.drawClipCard(mkCanvas(), 2, prop.removed) === false);
  if (typeof pv.drawClipCard === "function") {
    pv.setSnapshot({ page: v0.page, layers: v0.layers, tMM: 3, gMM: 0 }, "#808080");
    log.strokes = []; log.fills = []; log.draws = 0; log.dashes = [];
    const card = mkCanvas();
    const ok = pv.drawClipCard(card, 2, prop.removed);
    check("SUP-04 drawClipCard: the layer card from the cache plus the removed area filled and outlined dashed (not colour only)",
      ok === true && card.width > 0 && log.draws >= 2 && log.fills.some((f) => /rgba\(/.test(String(f))) && log.dashes.some((n) => n > 0));
  }

  // ---- wiring
  const root = path.join(__dirname, ".."), appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8"),
    html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  check("SUP-04 index.html: a #dlg-clip modal with a canvas, the summary, Accept and Cancel; a Repairs list in Review",
    /<dialog id="dlg-clip"[^>]*aria-labelledby="dlg-clip-title"/.test(html) && /id="dlg-clip-canvas"/.test(html) && /id="dlg-clip-summary"/.test(html) &&
    /value="accept"/.test(/<dialog id="dlg-clip"[\s\S]*?<\/dialog>/.exec(html)[0]) && /value="cancel"/.test(/<dialog id="dlg-clip"[\s\S]*?<\/dialog>/.exec(html)[0]) &&
    (() => { const m = /<section class="step" id="stage-review"[\s\S]*?<\/section>/.exec(html); return !!m && /id="repair-list"/.test(m[0]); })());
  check("SUP-04 app.js: Clip to lower layer opens proposeClip, Accept calls applyClip, Revert calls removeRepair; the shown result replays repairs (snapshot.repairsApplied, alpha.3 E5)",
    /Clip to lower layer/.test(appSrc) && /SBSupport\.proposeClip\(/.test(appSrc) && /SBSupport\.applyClip\(/.test(appSrc) &&
    /SBSupport\.removeRepair\(/.test(appSrc) && /snapshot\.repairsApplied/.test(appSrc) && /preview\.drawClipCard\(/.test(appSrc) && /Revert/.test(appSrc));
  check("SUP-04 app.js: REPAIR_STALE items link back to the clip dialog (alpha.3 E12: REPAIR_REVIEW_FAB is re-reviewed in the Fabrication review); the export passes the project (alpha.2: generate replays construction.repairs at fabrication; alpha.3 E1: through SBEngine.request)",
    /REPAIR_STALE/.test(appSrc) && /REPAIR_REVIEW_FAB/.test(appSrc) && /SBProof\.repairForDiagnostic\(/.test(appSrc) &&
    /SBEngine\.request\(project, run\.src, \{ quality: "fabrication"/.test(appSrc) && /SBEngine\.fabricationFiles\([^)]*project/.test(appSrc));
});

suite("schema.js/diag.js/app.js — G2.14 source intake and explicit preflight (IMG-01/07, GEO-06, NFR-04, PO-LASER-4/5, AT-22/24)", () => {
  const S = SBSchema, F = require("./fixtures.js"), PE = require("./png_enc.js"), { file: jpegFile } = S4B;
  check("G2.14 API present", typeof S.preflight === "function" && typeof S.intake === "function" && typeof S.sniff === "function" && typeof S.applyDownsample === "function");
  if (typeof S.preflight !== "function" || typeof S.intake !== "function" || typeof S.sniff !== "function" || typeof S.applyDownsample !== "function") return;
  // A structurally valid PNG whose IHDR claims w × h with a tiny IDAT: inspect never inflates, so this is header-only.
  const pngHeader = (w, h, { bitDepth = 8, colorType = 0, apng = false, pad = 0, exif = 0 } = {}) => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bitDepth; ihdr[9] = colorType;
    const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), PE.chunk("IHDR", ihdr)];
    if (apng) parts.push(PE.chunk("acTL", Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])));
    if (exif) { const t = Buffer.alloc(22); t.write("MM", 0, "latin1"); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);   // eXIf: a bare TIFF block
      t.writeUInt16BE(1, 8); t.writeUInt16BE(0x0112, 10); t.writeUInt16BE(3, 12); t.writeUInt32BE(1, 14); t.writeUInt16BE(exif, 18); parts.push(PE.chunk("eXIf", t)); }
    parts.push(PE.chunk("IDAT", Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])), PE.chunk("IEND", Buffer.alloc(0)), Buffer.alloc(pad));
    return new Uint8Array(Buffer.concat(parts));
  };
  const tonal = S.defaults("acrylic"), height = S.defaults("plywood");
  const run = (bytes, project, deviceClass = "desktop") => S.intake(bytes, { project, deviceClass });
  const MiB = 1024 * 1024;

  // ---- limits (IMG-07)
  check("IMG-07 limits carry the source envelope: desktop 25 MiB / 25 MP, mobile 10 MiB / 8 MP",
    S.limits("desktop").maxSourceBytes === 25 * MiB && S.limits("desktop").maxSourcePx === 25e6 &&
    S.limits("mobile").maxSourceBytes === 10 * MiB && S.limits("mobile").maxSourcePx === 8e6);
  // Product-owner decision 2026-10-08 (laser target; documented deviation from SRS IMG-07's 16 MP): the desktop source
  // cap equals the measured desktop pixel budget, so a source can feed the full fabrication raster (the engine never upsamples).
  check("IMG-07/PO-LASER-4 desktop source cap equals the measured desktop fabPxBudget (docs/perf/large-image.json); mobile stays 8 MP",
    (() => { const dec = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "perf", "large-image.json"), "utf8")).decision;
      return S.limits("desktop").maxSourcePx === S.limits("desktop").fabPxBudget && S.limits("desktop").maxSourcePx === dec.desktop.fabPxBudget &&
        S.limits("mobile").maxSourcePx === 8e6; })());
  check("G2.14 sniff: PNG, JPEG and anything else", S.sniff(pngHeader(4, 4)) === "png" && S.sniff(F.jpegHeader({ w: 4, h: 4 })) === "jpeg" &&
    S.sniff(new Uint8Array([0x47, 0x49, 0x46, 0x38])) === null && S.sniff(new Uint8Array(0)) === null);
  check("IMG-01 a non-PNG/JPEG file is rejected at intake with SOURCE_FORMAT", (() => { const r = run(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), tonal); return r.ok === false && r.code === "SOURCE_FORMAT"; })());

  // ---- byte and pixel envelope
  { const r = run(pngHeader(1000, 800, { pad: 26 * MiB }), height);
    check("IMG-07 desktop 26MiB rejected", r.ok === false && r.code === "SOURCE_TOO_LARGE" && /26(\.0)? MiB/.test(r.reason) && /25 MiB/.test(r.reason)); }
  { const r = run(pngHeader(5200, 5100), height);
    check("IMG-07 desktop 26.5MP rejected with downsample suggestion", r.ok === false && r.code === "SOURCE_TOO_MANY_PIXELS" &&
      r.info.w === 5200 && r.info.h === 5100 && /26\.5 MP/.test(r.reason) && /25 MP/.test(r.reason) && !!r.suggestDownsamplePx && r.suggestDownsamplePx.w * r.suggestDownsamplePx.h <= 25e6 &&
      r.suggestDownsamplePx.w <= 5200 && r.suggestDownsamplePx.h <= 5100 && Math.abs(r.suggestDownsamplePx.w / r.suggestDownsamplePx.h - 5200 / 5100) < 0.002 &&
      (r.suggestDownsamplePx.w + 1) * (r.suggestDownsamplePx.h + 1) > 25e6); }
  { const r = run(F.jpegHeader({ w: 7000, h: 4000 }), tonal);
    check("IMG-07 JPEG 7000×4000 (28 MP) rejected from SOF before decode", r.ok === false && r.code === "SOURCE_TOO_MANY_PIXELS" && r.format === "jpeg" && r.info.w === 7000 && /28(\.0)? MP/.test(r.reason)); }
  { const r = run(F.jpegHeader({ w: 6000, h: 4000 }), tonal), m = run(F.jpegHeader({ w: 6000, h: 4000 }), tonal, "mobile");
    check("IMG-07 JPEG 6000×4000 (24 MP) accepted on desktop (PO 2026-10-08), still rejected on mobile",
      r.ok === true && m.ok === false && m.code === "SOURCE_TOO_MANY_PIXELS" && /8(\.0)? MP/.test(m.reason)); }
  { const r = run(pngHeader(3000, 3000), height, "mobile"), d = run(pngHeader(3000, 3000), height, "desktop");
    check("IMG-07 mobile 9MP rejected", r.ok === false && r.code === "SOURCE_TOO_MANY_PIXELS" && /8(\.0)? MP/.test(r.reason) && d.ok === true); }
  { const r = run(pngHeader(1000, 800, { pad: 11 * MiB }), height, "mobile");
    check("IMG-07 mobile 11 MiB rejected (10 MiB envelope)", r.ok === false && r.code === "SOURCE_TOO_LARGE"); }
  check("IMG-07 exactly 25 MP on desktop is accepted (limit inclusive); one row more is rejected",
    run(pngHeader(5000, 5000), height).ok === true && run(pngHeader(5000, 5001), height).code === "SOURCE_TOO_MANY_PIXELS");

  // ---- IMG-01 in both modes
  check("IMG-01 tonal APNG and tonal 16-bit PNG rejected at intake",
    run(pngHeader(64, 64, { apng: true, colorType: 2 }), tonal).code === "PNG_APNG" && run(pngHeader(64, 64, { bitDepth: 16, colorType: 2 }), tonal).code === "PNG_16BIT" &&
    run(pngHeader(64, 64, { apng: true }), height).code === "PNG_APNG" && run(pngHeader(64, 64, { bitDepth: 16 }), height).code === "PNG_16BIT");
  check("IMG-01 a JPEG height map is rejected (height mode takes PNG only)", (() => { const r = run(F.jpegHeader({ w: 64, h: 64 }), height); return r.ok === false && r.code === "HEIGHT_NEEDS_PNG"; })());
  check("IMG-01 a corrupt PNG is rejected at intake with its SBPng code", run(pngHeader(64, 64).subarray(0, 40), tonal).code === "PNG_TRUNCATED");
  check("IMG-01 unsupported JPEG variant (12-bit/arithmetic) rejected before decode", (() => {
    const a = run(jpegFile({ sofOpts: { precision: 12 } }), tonal), b = run(jpegFile({ sofOpts: { m: 0xc9 } }), tonal);
    return a.code === "JPEG_UNSUPPORTED" && /12-bit/.test(a.reason) && b.code === "JPEG_UNSUPPORTED" && /arithmetic/.test(b.reason); })());
  check("AT-22 truncated-in-scan JPEG rejected before decode", (() => { const r = run(jpegFile({ eoi: false }), tonal); return r.ok === false && r.code === "JPEG_TRUNCATED"; })());
  check("AT-22 trailing bytes after EOI (Motion Photo) stay accepted", run(jpegFile({ trailing: 64 }), tonal).ok === true);
  check("G2.14 every preflight/intake rejection code is a registered blocking process diagnostic",
    ["SOURCE_TOO_LARGE", "SOURCE_TOO_MANY_PIXELS", "SOURCE_FORMAT", "HEIGHT_NEEDS_PNG"].every((c) => SBDiag.CODES[c] && SBDiag.CODES[c].severity === "blocking" && SBDiag.CODES[c].kind === "process"));

  // ---- the decode route (intake order step 4)
  { const h = run(pngHeader(64, 48), height), t = run(pngHeader(64, 48, { colorType: 2 }), tonal), j = run(F.jpegHeader({ w: 640, h: 480, exif: 6 }), tonal);
    check("G2.14 decode route: height PNG raw (engine EXIF), tonal PNG/JPEG canvas-tonal (browser EXIF)",
      h.ok && h.intake.decode === "raw" && h.intake.exifAppliedBy === "engine" && t.ok && t.intake.decode === "canvas-tonal" && t.intake.exifAppliedBy === "browser" &&
      j.ok && j.intake.decode === "canvas-tonal" && j.intake.exif === 6 && j.intake.exifAppliedBy === "browser"); }

  // ---- raster plan before decode (PO-LASER-4/5, GEO-06)
  { const p = JSON.parse(JSON.stringify(height)); p.geometry.targetMM = 300;
    const r = run(pngHeader(800, 600), p), g = r.rasterPlan && r.rasterPlan.geometry;
    check("GEO-06/PO-LASER-5 target raster above source → FAB_EXCEEDS_SOURCE with px shortfall, mm/px from source",
      r.ok === true && !!g && g.rasterW === 800 && g.rasterH === 600 && g.sxUm === 500 && g.syUm === 500 &&
      g.shortPx[0] === 3200 && g.shortPx[1] === 2400 && r.warnings.some((d) => d.code === "FAB_EXCEEDS_SOURCE" && d.quality === "fabrication")); }
  { const p = JSON.parse(JSON.stringify(height)); p.geometry.targetMM = 470;
    const r = run(pngHeader(2000, 4000), p, "mobile"), g = r.rasterPlan && r.rasterPlan.geometry;
    check("PO-LASER-4 preflight returns the capped pitch for a 470 mm-high page on mobile",
      r.ok === true && !!g && g.deviceClass === "mobile" && g.capped === "budget" && g.pitchUm > 100 && g.targetPitchUm === 100 &&
      g.rasterW * g.rasterH <= 1e6 && r.warnings.some((d) => d.code === "FAB_PITCH_CAPPED")); }
  { const r = run(F.jpegHeader({ w: 640, h: 480, exif: 6 }), tonal), g = r.rasterPlan.geometry;
    check("IMG-05 browser-applied EXIF 6: the plan uses the decoded (rotated) size", g.srcW === 480 && g.srcH === 640); }
  { const r = run(pngHeader(5200, 5100), height);
    check("NFR-04 a rejected over-pixel source still shows its plan before decode", r.code === "SOURCE_TOO_MANY_PIXELS" && !!r.rasterPlan && r.rasterPlan.geometry.srcW === 5200); }
  check("G2.14 preflight never mutates the project", (() => { const p = S.defaults("plywood"), before = JSON.stringify(p); run(pngHeader(800, 600), p); return JSON.stringify(p) === before; })());

  // ---- explicit downsample (no silent downscale)
  // 470 mm high from 3952 px: the downsampled source delivers 0.119 mm/px, coarser than the 0.1 mm target
  { const p = S.defaults("plywood"); p.geometry.targetMM = 470; const q = S.applyDownsample(p, { fromW: 4200, fromH: 4100, toW: 4048, toH: 3952 });
    const hist = q.extras.history;
    check("NFR-04 explicit downsample records a coarser geometry.fabPitchMM and a history entry",
      q.geometry.fabPitchMM > p.geometry.fabPitchMM && Math.round(q.geometry.fabPitchMM * 1000) / 1000 === q.geometry.fabPitchMM &&
      q.revision === p.revision + 1 && Array.isArray(hist) && hist.length === 1 && hist[0].op === "downsample" &&
      hist[0].from.join() === "4200,4100" && hist[0].to.join() === "4048,3952" && hist[0].fabPitchMM.from === 0.1 && q.geometry.fabPitchMM === 0.119 && hist[0].fabPitchMM.to === q.geometry.fabPitchMM &&
      S.validate(q).ok && p.extras.history === undefined); }
  check("NFR-04 downsample never makes the pitch finer than the project's", (() => { const p = S.defaults("plywood"); p.geometry.fabPitchMM = 1.5;
    const q = S.applyDownsample(p, { fromW: 5000, fromH: 4000, toW: 4472, toH: 3577 }); return q.geometry.fabPitchMM === 1.5 && q.extras.history.length === 1; })());

  // ---- the downsample target in the decoded orientation (both routes rotate for EXIF 5..8)
  { const rot = (exif) => { const r = run(pngHeader(6000, 4400, { exif }), height); return r; };
    const r6 = rot(6), r1 = rot(1), t = S.downsampleTarget(r6), u = S.downsampleTarget(r1);
    check("IMG-05 downsampleTarget: height PNG EXIF 6 (raw route) targets the rotated canvas, aspect kept",
      r6.code === "SOURCE_TOO_MANY_PIXELS" && r6.intake.decode === "raw" && r6.intake.exif === 6 &&
      t.w === r6.suggestDownsamplePx.h && t.h === r6.suggestDownsamplePx.w && t.w <= 4400 && t.h <= 6000 &&
      (() => { try { S.applyDownsample(S.defaults("plywood"), { fromW: 4400, fromH: 6000, toW: t.w, toH: t.h }); return true; } catch (e) { return false; } })());
    check("IMG-05 downsampleTarget: EXIF 1 unchanged", u.w === r1.suggestDownsamplePx.w && u.h === r1.suggestDownsamplePx.h);
    const j = run(F.jpegHeader({ w: 6000, h: 4400, exif: 8 }), tonal), tj = j.suggestDownsamplePx && S.downsampleTarget(j);
    check("IMG-05 downsampleTarget: tonal JPEG EXIF 8 (browser route) swapped too", j.code === "SOURCE_TOO_MANY_PIXELS" && tj.w === j.suggestDownsamplePx.h && tj.h === j.suggestDownsamplePx.w); }
  // ---- EXIF_AMBIGUOUS (plan Appendix C, S4b → G2.14): a warning on the browser route, never a rejection
  { const { seg, app1 } = S4B, xmp = seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x/>", "latin1"));
    const amb = run(jpegFile({ pre: [xmp, app1(6)], sofOpts: { w: 640, h: 480 } }), tonal), short = run(jpegFile({ pre: [app1(6, 26)], sofOpts: { w: 640, h: 480 } }), tonal);
    const clear = run(jpegFile({ pre: [app1(6)], sofOpts: { w: 640, h: 480 } }), tonal), big = run(jpegFile({ pre: [xmp, app1(6)], sofOpts: { w: 7000, h: 4000 } }), tonal);
    const ea = (r) => r.warnings.filter((d) => d.code === "EXIF_AMBIGUOUS");
    check("IMG-05 EXIF_AMBIGUOUS is a registered warning (process)", !!SBDiag.CODES.EXIF_AMBIGUOUS && SBDiag.CODES.EXIF_AMBIGUOUS.severity === "warning" &&
      SBDiag.CODES.EXIF_AMBIGUOUS.kind === "process" && /browsers disagree/i.test(SBDiag.CODES.EXIF_AMBIGUOUS.title));
    check("IMG-05 preflight warns EXIF_AMBIGUOUS for XMP-then-Exif and a short IFD entry, still accepts the file",
      amb.ok === true && ea(amb).length === 1 && short.ok === true && ea(short).length === 1 && /EXIF 6/.test(ea(amb)[0].message));
    check("IMG-05 an unambiguous Exif gives no EXIF_AMBIGUOUS", clear.ok === true && ea(clear).length === 0);
    check("IMG-05 an ambiguous over-pixel JPEG is refused with its downsample offer and the EXIF_AMBIGUOUS warning",
      big.code === "SOURCE_TOO_MANY_PIXELS" && !!big.suggestDownsamplePx && ea(big).length === 1); }
  check("G2.14 preflight without inspect output refuses instead of throwing", (() => {
    try { const a = S.preflight({ bytes: pngHeader(64, 64), info: null, deviceClass: "desktop", project: S.defaults("plywood") }),
      b = S.preflight({ bytes: F.jpegHeader({ w: 64, h: 64 }), info: null, deviceClass: "desktop", project: S.defaults("plywood") });
      return a.ok === false && a.code === "PNG_HEADER" && b.ok === false && b.code === "JPEG_BAD_SEGMENT"; } catch (e) { return false; } })());

  // ---- wiring (app.js)
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("NFR-04 no code path lowers resolution without explicit flag (downscaleIfHuge is gone from js/app.js)", !/downscaleIfHuge/.test(appSrc));
  check("G2.14 app.js loadFile: SBSchema.intake before any decode; height PNG through SBPng.decode; explicit downsample button",
    /SBSchema\.intake\(/.test(appSrc) && /SBPng\.decode\(/.test(appSrc) && /SBSchema\.applyDownsample\(/.test(appSrc) && /id="btn-downsample"/.test(html) &&
    appSrc.indexOf("SBSchema.intake(") < appSrc.indexOf("SBPng.decode("));
  { const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
    const ds = fn("downsampleExplicitly"), sc = fn("syncControls"), sp = fn("syncPitch");
    check("NFR-04 app.js: the pitch controls follow the project after a downsample (syncControls refreshes #in-res/#out-res)",
      /\$\("in-res"\)/.test(sp) && /\$\("out-res"\)/.test(sp) && /geometry\.fabPitchMM/.test(sp) && /syncPitch\(\)/.test(sc) &&
      /applyDownsample\(/.test(ds) && /acceptSource\(/.test(ds) && ds.indexOf("applyDownsample(") < ds.indexOf("acceptSource(") &&
      /function acceptSource[\s\S]*?regenerate\(\)/.test(appSrc) && /function regenerate\(\) \{\s*syncControls\(\)/.test(appSrc));
    const dec = fn("decodeSource"), lf = fn("loadFile"), rs = fn("refuseSource");
    check("IMG-05 app.js decodeSource: tonal route through createImageBitmap, never <img> (Appendix C, S4b)",
      /createImageBitmap\(file\)/.test(dec) && !/new Image\(/.test(dec) && !/\.src\s*=/.test(dec) && !/naturalWidth/.test(appSrc));
    check("NFR-05 app.js: the height-map downsample resamples with SBRaster.resample (G2.0 nearest/area policy)",
      /SBRaster\.resample\(/.test(ds) && /resample\.height === "area"/.test(ds) && /"nearest"/.test(ds));
    check("G2.14 app.js: loads and downsamples take a generation token and drop stale results",
      /\+\+sourceGen/.test(lf) && /gen !== sourceGen/.test(lf) && /\+\+sourceGen/.test(ds) && /gen !== sourceGen/.test(ds));
    check("G2.14 app.js: the downsample re-runs intake against the current project (mode may have changed)",
      /SBSchema\.intake\(bytes/.test(ds) && !/function downsampleExplicitly\(file, bytes, pre\)/.test(appSrc));
    check("NFR-04 app.js: a refusal shows the preflight plan (pitch the downsample gives) and EXIF_AMBIGUOUS",
      /rasterPlan/.test(rs) && /planText\(/.test(rs) && /EXIF_AMBIGUOUS/.test(rs) &&
      /SBDocs\.sourceNotes\(pre\.warnings\)/.test(lf));   // alpha.3 E8: loadFile shows every preflight warning (EXIF_AMBIGUOUS included)
    check("G2.14 app.js: #filein value is reset so the same file can be chosen again", /\$\("filein"\)[\s\S]{0,200}e\.target\.value = ""/.test(appSrc));
    check("IMG-05 app.js: downsample target and button label come from SBSchema.downsampleTarget (no intake.w/info.w swap test)",
      /SBSchema\.downsampleTarget\(pre\)/.test(ds) && !/pre\.intake\.w !== pre\.info\.w/.test(appSrc) && (appSrc.match(/SBSchema\.downsampleTarget\(/g) || []).length >= 2); }
});

// ------------------------------------------------ checkpoint v2.0.0-alpha.2 (experimental bonded relief)
suite("engine.js/app.js/CHANGELOG — checkpoint v2.0.0-alpha.2 (LYR-06, EXP-07, AT-03/08)", () => {
  const F = require("./fixtures.js"), E = SBEngine, D = SBDiag;
  check("alpha.2 API present (SBEngine.fabricationRequest, SBEngine.fabricationFiles)",
    typeof E.fabricationRequest === "function" && typeof E.fabricationFiles === "function");
  if (typeof E.fabricationRequest !== "function" || typeof E.fabricationFiles !== "function") return;
  const sev = (d) => D.CODES[d.code].severity;

  // ---- E2E: plywood preset, height ramp at 0.1 mm/px (400 × 100 px, 10 mm high)
  const w = 400, h = 100, p = SBSchema.defaults("plywood"); p.geometry.targetMM = 10;
  const rq = E.fabricationRequest(p, { pixels: F.ramp(w, h), channels: 1, w, h, alpha: null }, { requestId: "e2e", deviceClass: "desktop", format: "png", decode: "raw-gray8" });
  check("LYR-06 fabricationRequest: quality fabrication, engine version, project revision, a source record for the decoded (already oriented) pixels",
    rq.quality === "fabrication" && rq.engineVersion === E.VERSION && rq.revision === p.revision && rq.config.revision === p.revision &&
    rq.config.source && rq.config.source.w === w && rq.config.source.h === h && rq.config.source.channels === 1 && rq.config.source.decode === "raw-gray8" &&
    rq.config.source.orientation.exifAppliedBy === "none" && rq.deviceClass === "desktop" && p.source === null && SBSchema.validate(rq.config).ok);
  const r = E.generate(rq), s = r.snapshot;
  check("E2E height plywood preset → 8 layers validated, 0 blocking on ramp fixture",
    r.status === "done" && s.quality === "fabrication" && s.layers.length === 8 && s.layers.every((L) => L.status !== "omitted-trailing" && L.material.length > 0) &&
    s.stats.exported === 8 && s.diagnostics.filter((d) => sev(d) === "blocking").length === 0);
  const warn = s.diagnostics.filter((d) => sev(d) === "warning");
  const g0 = D.exportGate(s.diagnostics, [], s, "fabrication"), g1 = D.exportGate(s.diagnostics, warn.map((d) => D.ackKey(d, s.geometryHash)), s, "fabrication");
  check("EXP-07 E2E: warnings gate the fabrication export until acknowledged on the fab snapshot, then it is allowed",
    warn.length > 0 && !g0.allowed && g0.reason === "UNACKED" && g1.allowed);
  const files = E.fabricationFiles(s, p, "#c8a26b");
  // alpha.3 E11: bonded bundles add placement_map.svg (not a cut file, A4 width) after proof.svg
  const cutAndProof = files.filter((f) => f.name !== "placement_map.svg");
  check("alpha.2 export keeps the legacy flat layout: sheet_01..08.svg and proof.svg from the fabrication snapshot (alpha.3 E11: plus placement_map.svg for bonded)",
    files.map((f) => f.name).join() === "sheet_01.svg,sheet_02.svg,sheet_03.svg,sheet_04.svg,sheet_05.svg,sheet_06.svg,sheet_07.svg,sheet_08.svg,proof.svg,placement_map.svg" &&
    cutAndProof.every((f) => typeof f.data === "string" && f.data.includes('viewBox="0 0 ' + SBSvg.fmtUm(Math.round(s.page.wMM * 1000)) + " ")));
  check("EXP-01 bonded sheets are pure vector (no legacy text label) and name the construction",
    cutAndProof.slice(0, -1).every((f) => !/<text/.test(f.data) && /construction=bonded-relief/.test(f.data)));
  check("EXP-07 fabricationFiles refuses a draft snapshot (never exports the draft)",
    (() => { const dr = E.generate(Object.assign({}, rq, { quality: "draft" })).snapshot; try { E.fabricationFiles(dr, p, "#c8a26b"); return false; } catch (e) { return /QUALITY/.test(e.message); } })());

  // ---- trailing empties: no file, the index gap is kept (D-4.7)
  { const q = SBSchema.defaults("plywood"); q.geometry.targetMM = 10;
    const half = new Uint8Array(w * h).fill(100);   // 100/255 → the lower layers only
    const t = E.generate(E.fabricationRequest(q, { pixels: half, channels: 1, w, h, alpha: null }, { format: "png", decode: "raw-gray8" })).snapshot;
    const names = E.fabricationFiles(t, q, "#c8a26b").map((f) => f.name);
    check("D-4.7 omitted-trailing layers get no sheet file; the indices of the others are kept",
      t.stats.omitted.length > 0 && names.length === t.stats.exported + 2 && names[0] === "sheet_01.svg" && names[names.length - 2] === "proof.svg" && names[names.length - 1] === "placement_map.svg" &&
      !names.includes("sheet_" + String(t.stats.omitted[0] + 1).padStart(2, "0") + ".svg")); }

  // ---- connected mode keeps the legacy sheet label until G3.2
  { const q = SBSchema.defaults("acrylic"); q.title = "acr"; q.interpretation.mode = "height"; q.interpretation.polarity = "white-high"; q.geometry.widthMM = 40; q.geometry.targetMM = 40;
    const rr = E.generate(E.fabricationRequest(q, { pixels: F.ramp(w, h), channels: 1, w, h, alpha: null }, { format: "png", decode: "raw-gray8" }));
    const fs2 = rr.status === "done" ? E.fabricationFiles(rr.snapshot, q, ["#111111", "#222222", "#333333", "#444444", "#555555"]) : [];
    check("DEP-04 connected fabrication sheets keep the v1.1.0 text label \"{title} k/n\"",
      fs2.length === 6 && /<text[^>]*>acr 1\/5<\/text>/.test(fs2[0].data) && /construction=connected-sheet/.test(fs2[0].data)); }

  // ---- app wiring: every export regenerates at fabrication and is gated (G2.10b rule)
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  const ex = fn("exportBundle"), fr = fn("fabReview");
  check("LYR-06 app.js export regenerates with SBEngine.generate at fabrication quality (alpha.3 E1: SBEngine.request)",
    /SBEngine\.request\(/.test(appSrc) && /SBEngine\.generate\(/.test(appSrc) && /fabReview\(/.test(ex));
  check("EXP-07 app.js export is gated by SBDiag.exportGate(…, \"fabrication\") before any file is built",
    /SBDiag\.exportGate\([^)]*"fabrication"\)/.test(appSrc) && ex.indexOf("exportGate(") >= 0 && ex.indexOf("exportGate(") < ex.indexOf("buildAndDeliver("));
  // alpha.3 E6: the fabrication review goes through the one diagnostics renderer with r = run.fab, so its acks are
  // SBDiag.ackKey(d, r.snapshot.geometryHash) in r.acks = run.fab.acks (no separate fab-only ack code any more)
  check("EXP-07 app.js: the fabrication review lists the fab snapshot's diagnostics with acks keyed on its geometryHash; draft acks are not reused",
    /id="fab-review"/.test(html) && /id="fab-list"/.test(html) && /renderDiagnostics\(run\.fab, \{ scope: "fabrication" \}\)/.test(appSrc) &&
    /SBDiag\.ackKey\(d, r\.snapshot\.geometryHash\)/.test(appSrc) && /r\.acks\.has\(key\)/.test(appSrc) && /run\.fab\.acks/.test(appSrc) &&
    !/run\.fab\.acks\s*=\s*run\.acks/.test(appSrc) && /function fabCurrent\(\)/.test(appSrc) && /project\.revision/.test(fn("fabCurrent")));
  check("EXP-07 app.js: a blocking fabrication diagnostic disables Export with its reason",
    /reason === "BLOCKING"/.test(appSrc) && /btn\.disabled = /.test(fn("updateGate")) && /fabCurrent\(\)/.test(fn("updateGate")));

  // ---- CHANGELOG
  const cl = fs.readFileSync(path.join(__dirname, "..", "docs/CHANGELOG.md"), "utf8"), sec = (cl.split(/^## v2\.0\.0-alpha\.2\b.*$/m)[1] || "").split(/^## /m)[0];
  check("R9 CHANGELOG v2.0.0-alpha.2 has a known-gaps table (guides, .sbrproj, manifest, flat layout, fabrication review)",
    /known gaps/i.test(sec) && /^\|.*\|\s*$/m.test(sec) && /guides/i.test(sec) && /\.sbrproj/.test(sec) && /manifest/i.test(sec) && /flat/i.test(sec) && /fabrication/i.test(sec) && /exportGate/.test(sec));
});

// ------------------------------------------------ alpha.3 E1 (one request builder; the source record is installed at intake)
suite("engine.js/schema.js/app.js — alpha.3 E1 shared request and installed source (LYR-06, SUP-04)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema, SP = SBSupport;
  check("alpha.3 API present (SBEngine.request, SBEngine.sourceRecord, SBSchema.withSource)",
    typeof E.request === "function" && typeof E.sourceRecord === "function" && typeof S.withSource === "function");
  if (typeof E.request !== "function" || typeof E.sourceRecord !== "function" || typeof S.withSource !== "function") return;
  const w = 400, h = 100, px = { pixels: F.ramp(w, h), channels: 1, w, h, alpha: null };
  const p0 = S.defaults("plywood"); p0.geometry.targetMM = 10;
  const p = S.withSource(p0, E.sourceRecord(px, { format: "png", decode: "raw-gray8" }));
  check("PRJ-02 withSource installs the record and bumps the revision", p.source && p.source.w === w && p.revision === p0.revision + 1 && p0.source === null);
  const d = E.request(p, px, { quality: "draft" }), f = E.request(p, px, { quality: "fabrication" });
  check("LYR-06 draft and fabrication requests differ only in quality (config and normalizedSource identical)",
    d.quality === "draft" && f.quality === "fabrication" && JSON.stringify(d.config) === JSON.stringify(f.config) &&
    d.normalizedSource.pixels === f.normalizedSource.pixels && JSON.stringify(d.config) === JSON.stringify(p));
  check("LYR-06 fabricationRequest on an installed source does not rewrite config.source",
    JSON.stringify(E.fabricationRequest(p, px, { format: "png", decode: "raw-gray8" }).config.source) === JSON.stringify(p.source));
  // The app flow that alpha.2 got wrong: review a clip on a draft generate of the installed project, export at fabrication.
  const tall = S.defaults("plywood"); tall.geometry.targetMM = 10;
  const hm = F.heightMap(7, 200, 200), pxh = { pixels: hm, channels: 1, w: 200, h: 200, alpha: null };
  let q = S.withSource(tall, E.sourceRecord(pxh, { format: "png", decode: "raw-gray8" }));
  const dr = E.generate(E.request(q, pxh, { quality: "draft" })).snapshot;
  q = SP.applyClip(q, SP.proposeClip(dr, 1));   // replay raises REPAIR_REVIEW_FAB for any draft review, even an empty clip
  const fr = E.generate(E.request(q, pxh, { quality: "fabrication" })).snapshot;
  check("SUP-04 a draft-reviewed clip replays at fabrication as REPAIR_REVIEW_FAB, never REPAIR_STALE",
    fr.diagnostics.some((x) => x.code === "REPAIR_REVIEW_FAB") && !fr.diagnostics.some((x) => x.code === "REPAIR_STALE"));
  const warn = fr.diagnostics.filter((x) => SBDiag.CODES[x.code].severity === "warning");
  const blocking = fr.diagnostics.filter((x) => SBDiag.CODES[x.code].severity === "blocking");
  check("EXP-07 the clip alone never blocks: no blocking item, and acknowledging the warnings on the fab snapshot allows export",
    blocking.length === 0 && SBDiag.exportGate(fr.diagnostics, warn.map((x) => SBDiag.ackKey(x, fr.geometryHash)), fr, "fabrication").allowed);
  const q2 = S.withSource(q, E.sourceRecord({ w: 200, h: 200, channels: 1 }, { format: "png", decode: "raw-gray8" }, Object.assign({}, q.source, { sampleHash: "f".repeat(64) })));
  check("PRJ-02 re-installing an identical source record changes nothing (same revision)", S.withSource(q, q.source).revision === q.revision);
  check("SUP-04 loading a different source makes an earlier clip stale, not silently applied",
    E.generate(E.request(q2, pxh, { quality: "fabrication" })).snapshot.diagnostics.some((x) => x.code === "REPAIR_STALE"));
  const pol = JSON.parse(JSON.stringify(q)); pol.source.alpha = { mode: "threshold", t: 0.3 };
  const re = S.withSource(pol, E.sourceRecord(pxh, { format: "png", decode: "raw-gray8" }, Object.assign({}, pol.source, { byteHash: pol.source.byteHash, sampleHash: pol.source.sampleHash })));
  check("PRJ-02 reloading the same file keeps the user's source policy (source.alpha) and the revision", re.revision === pol.revision && JSON.stringify(re.source.alpha) === JSON.stringify(pol.source.alpha));
  check("LYR-06 request refuses a source record that does not match the pixels (SOURCE_MISMATCH)",
    (() => { try { E.request(q, { pixels: new Uint8Array(100 * 100), channels: 1, w: 100, h: 100, alpha: null }, { quality: "draft" }); return false; } catch (e) { return /SOURCE_MISMATCH/.test(e.message); } })());
  check("LYR-06 fabricationRequest on an installed source also refuses mismatched pixels (SOURCE_MISMATCH)",
    (() => { try { E.fabricationRequest(q, { pixels: new Uint8Array(100 * 100), channels: 1, w: 100, h: 100, alpha: null }, {}); return false; } catch (e) { return /SOURCE_MISMATCH/.test(e.message); } })());
  const a1 = new Uint8Array(200 * 200).fill(255), a2 = new Uint8Array(200 * 200).fill(255); a2[0] = 0;
  const sb1 = E.sampleBytes(Object.assign({}, pxh, { alpha: a1 })), sb2 = E.sampleBytes(Object.assign({}, pxh, { alpha: a2 }));
  check("SUP-04 sampleBytes covers alpha: same gray samples, different alpha → different streams (so different sampleHash)",
    sb1.length === sb2.length && sb1.some((v, i) => v !== sb2[i]) && E.sampleBytes(pxh).length < sb1.length);
  checkAsync("SUP-04 sampleHash differs for the same samples with different alpha", Promise.all([SBHash.digest(sb1), SBHash.digest(sb2)]).then(([h1, h2]) => h1 !== h2));
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  const acc = fn("acceptSource");
  check("alpha.3 app.js installs the source record on the project at intake (SBSchema.withSource in acceptSource)", /SBSchema\.withSource\(/.test(acc));
  check("alpha.3 acceptSource assigns run.src only after the hashes resolve (no await between run.src = and the project install)",
    acc.indexOf("run.src =") >= 0 && acc.lastIndexOf("await ") < acc.indexOf("run.src =") && acc.indexOf("run.src =") < acc.indexOf("SBSchema.withSource("));
  check("alpha.3 acceptSource installs the project without recompute() (one draft per load)", !/commitProject\(/.test(acc) && (acc.match(/regenerate\(\)/g) || []).length === 1);
  check("LYR-06 app.js never calls fabricationRequest; regenerate and fabReview check the sample hash",
    !/fabricationRequest\(/.test(appSrc) && /sampleHash/.test(fn("regenerate")) && /sampleHash/.test(fn("fabReview")));
});

// ------------------------------------------------ alpha.3 E2 (engine payload the UI needs; no hash change)
suite("engine.js/proof.js — alpha.3 E2 snapshot payload (UI-05, G2.13d)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema, SP = SBSupport;
  const px = { pixels: F.heightMap(7, 200, 200), channels: 1, w: 200, h: 200, alpha: null };
  const p = S.withSource(Object.assign(S.defaults("acrylic"), {}), E.sourceRecord(px, { format: "png", decode: "raw-gray8" }));
  p.interpretation.mode = "height"; p.interpretation.polarity = "white-high"; p.geometry.widthMM = 60; p.geometry.targetMM = 84;
  const r = E.generate(E.request(p, px, { quality: "draft" })), s = r.snapshot;
  check("UI-05 cleanupReport carries bridged and culled per layer", r.status === "done" && s.cleanupReport.every((c) => Number.isFinite(c.bridged) && Number.isFinite(c.culled)));
  if (r.status !== "done") return;
  check("G2.13d snapshot.repairsApplied is [] without repairs", Array.isArray(s.repairsApplied) && s.repairsApplied.length === 0);
  check("§3 snapshot.page carries frameMM and the art size", s.page.frameMM === 12 && s.page.artWMM === s.geometry.artWMM && s.page.artHMM === s.geometry.artHMM &&
    Number.isFinite(s.page.wMM) && Number.isFinite(s.page.hMM));
  check("NFR-05 the payload additions do not change geometryHash (hash recomputed from its inputs)",
    s.geometryHash === SBHash.hashJSON({ key: S.geometryKey(p), engine: E.VERSION, quality: "draft", raster: [s.geometry.rasterW, s.geometry.rasterH],
      layers: s.layers.map((L) => SBGeom.layerHashes(L).layerHash), guides: E.guideHash(s.guides) }));
  const sq = [{ outer: [0, 0, 10000, 0, 10000, 10000, 0, 10000], holes: [] }];
  check("UI-05 snapshot.construction carries mode, thickness and gap (connected)", s.construction.mode === "connected-sheet" &&
    s.construction.tMM === p.material.thicknessMM && s.construction.gMM === p.construction.gapMM && p.construction.gapMM > 0);
  check("UI-05 cards read MaterialLayer.stats.cutMM (no second cut-length routine)", typeof SBProof.cutLengthMM === "undefined" && s.layers.every((L) => Number.isFinite(L.stats.cutMM)));
  const cards = SBProof.cards([{ index: 0, material: sq, status: "ok" }, { index: 1, material: [], status: "omitted-trailing" }], { wMM: 10, hMM: 10 });
  check("LYR-01 cards mark omitted-trailing layers", cards[1].omitted === true && cards[0].omitted === false);
  check("LYR-01 cards on a real snapshot follow layer.status", SBProof.cards(s.layers, s.page).every((c, k) => c.omitted === (s.layers[k].status === "omitted-trailing")));
  // Bonded: gap 0 in the display construction, no bridges reported (SUP-06).
  const pb = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); pb.geometry.targetMM = 60;
  const sb = E.generate(E.request(pb, px, { quality: "draft" })).snapshot;
  check("UI-05 bonded snapshot.construction has gap 0 and its own thickness", sb.construction.mode === "bonded-relief" && sb.construction.gMM === 0 && sb.construction.tMM === pb.material.thicknessMM);
  check("SUP-06 bonded cleanupReport reports bridged 0 on every layer", sb.cleanupReport.every((c) => c.bridged === 0 && Number.isFinite(c.culled)));
  check("UI-05 snapshot.construction carries exactly {mode, tMM, gMM} (display data outside the hash input)",
    JSON.stringify(Object.keys(s.construction).sort()) === JSON.stringify(["gMM", "mode", "tMM"]));
  // Repairs applied: a clip reviewed on the draft replays at fabrication and is reported by index.
  const dr = E.generate(E.request(pb, px, { quality: "draft" })).snapshot;
  const q = SP.applyClip(pb, SP.proposeClip(dr, 1));
  const qs = E.generate(E.request(q, px, { quality: "draft" })).snapshot;
  check("G2.13d snapshot.repairsApplied lists the replayed repairs", Array.isArray(qs.repairsApplied) && qs.repairsApplied.length === q.construction.repairs.length &&
    qs.repairsApplied.every((i) => Number.isInteger(i)));
});

// ------------------------------------------------ alpha.3 E3 (caller-owned stage cache)
suite("engine.js — alpha.3 E3 stage cache (NFR-05)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema;
  const w = 300, h = 200, rgba = new Uint8Array(w * h * 4); const g = F.heightMap(3, w, h);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = g[i]; rgba[4 * i + 1] = (g[i] * 3) & 255; rgba[4 * i + 2] = 255 - g[i]; rgba[4 * i + 3] = 255; }
  const px = { pixels: rgba, channels: 4, w, h, alpha: null };
  const p = S.withSource(S.defaults("plywood"), Object.assign(E.sourceRecord(px, { format: "png", decode: "canvas-tonal" }), { sampleHash: "a".repeat(64) }));
  const q = S.applyModeChange(p, { interpretation: { mode: "tonal" } }, true); q.geometry.targetMM = 40;
  const req = E.request(q, px, { quality: "draft" });
  const plain = E.generate(req), cache = {}, c1 = E.generate(req, { cache }), marks = [];
  const c2 = E.generate(req, { cache, onProgress: (st) => marks.push(st) });
  check("NFR-05 generate with a cold and a warm cache equals generate without (geometryHash)",
    plain.status === "done" && c1.geometryHash === plain.geometryHash && c2.geometryHash === plain.geometryHash);
  check("cache: a warm run reports the cached stages (resample-cached, interpret-cached)", marks.includes("resample-cached") && marks.includes("interpret-cached"));
  const q2 = JSON.parse(JSON.stringify(q)); q2.construction.sheets = 6; q2.revision++;
  const m2 = []; E.generate(E.request(q2, px, { quality: "draft" }), { cache, onProgress: (st) => m2.push(st) });
  check("cache: changing sheets reuses K1 and K2", m2.includes("resample-cached") && m2.includes("interpret-cached"));
  const q3 = JSON.parse(JSON.stringify(q)); q3.interpretation.smoothing = { radiusMM: 0.8, passes: 1 }; q3.revision++;
  const m3 = []; E.generate(E.request(q3, px, { quality: "draft" }), { cache, onProgress: (st) => m3.push(st) });
  check("cache: changing smoothing reuses K1 only", m3.includes("resample-cached") && !m3.includes("interpret-cached"));
  check("NFR-05 a cached run never mutates the cached arrays (third run equal)", E.generate(req, { cache }).geometryHash === plain.geometryHash);
  check("LYR-06 a cache tagged draft is refused by a fabrication request (CACHE_QUALITY)",
    (() => { try { E.generate(E.request(q, px, { quality: "fabrication" }), { cache: { quality: "draft" } }); return false; } catch (e) { return /CACHE_QUALITY/.test(e.message); } })());
  const fq = E.request(q, px, { quality: "fabrication" }), fc = { quality: "fabrication" }, fcold = E.generate(fq, { cache: fc });
  const fq2 = E.request(q2, px, { quality: "fabrication" });
  check("LYR-06 a warm fabrication cache after a sheets edit equals an uncached fabrication run (geometryHash)",
    fcold.status === "done" && E.generate(fq2, { cache: fc }).geometryHash === E.generate(fq2).geometryHash);
  const id = { exif: 1, exifAppliedBy: "none", rotate: 0, mirror: false }, sm = new Uint8Array([1, 2, 3, 4, 5, 6]);
  check("NFR-05 E.orient at identity returns the input samples without copying", E.orient({ samples: sm, alpha: null, w: 3, h: 2 }, id).samples === sm);
});

suite("schema.js/engine.js — alpha.3 E3b physical filter radii and draft fidelity (LYR-06, IMG-04)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema;
  check("E3b API present (SBEngine.radiusPx, smoothing.radiusMM)", typeof E.radiusPx === "function" && "radiusMM" in S.defaults("acrylic").interpretation.smoothing);
  if (typeof E.radiusPx !== "function") return;
  check("IMG-04 radiusPx converts mm by the coarser axis pitch", E.radiusPx(1.65, { mmPerPxMax: 0.4125 }) === 4 && E.radiusPx(1.65, { mmPerPxMax: 0.1 }) === 17 && E.radiusPx(0, { mmPerPxMax: 0.1 }) === 0);
  check("IMG-04 radiusPx uses the coarser of sxUm/syUm and honours a 1 px floor for a positive radius",
    E.radiusPx(1, { sxUm: 100, syUm: 250, mmPerPxMax: 0.25 }) === 4 && E.radiusPx(0.05, { mmPerPxMax: 0.5 }) === 0 && E.radiusPx(0.05, { mmPerPxMax: 0.5 }, 1) === 1 && E.radiusPx(0, { mmPerPxMax: 0.5 }, 1) === 0);
  const A = S.defaults("acrylic"), P = S.defaults("plywood");
  check("PRJ-01 presets: acrylic radiusMM 1.65 p2 (r4 at 720 px on 300 mm), plywood radiusMM 0 (D1)",
    JSON.stringify(A.interpretation.smoothing) === JSON.stringify({ radiusMM: 1.65, passes: 2 }) &&
    JSON.stringify(P.interpretation.smoothing) === JSON.stringify({ radiusMM: 0, passes: 0 }) && S.validate(A).ok && S.validate(P).ok);
  const withAt = (p, path, v) => { const q = JSON.parse(JSON.stringify(p)); const k = path.split("."), last = k.pop(); let o = q; for (const x of k) o = o[x]; o[last] = v; return q; };
  const errs = (p) => S.validate(p).errors.map((e) => e.path + ":" + e.code);
  check("IMG-04 smoothing.radiusMM validates 0–5 in 0.05 mm steps; pixel radius is refused",
    S.validate(withAt(A, "interpretation.smoothing", { radiusMM: 5, passes: 2 })).ok &&
    errs(withAt(A, "interpretation.smoothing", { radiusMM: 5.05, passes: 2 })).includes("interpretation.smoothing.radiusMM:RANGE") &&
    errs(withAt(A, "interpretation.smoothing", { radiusMM: 1.62, passes: 2 })).includes("interpretation.smoothing.radiusMM:GRID") &&
    !S.validate(withAt(A, "interpretation.smoothing", { radius: 4, passes: 2 })).ok);
  check("IMG-03 heightFilter radiusMM validates 0.05–25 mm; pixel radius is refused",
    S.validate(withAt(P, "interpretation.heightFilter", { op: "median", radiusMM: 0.05 })).ok &&
    S.validate(withAt(P, "interpretation.heightFilter", { op: "box", radiusMM: 25 })).ok &&
    errs(withAt(P, "interpretation.heightFilter", { op: "box", radiusMM: 0.04 })).includes("interpretation.heightFilter.radiusMM:RANGE") &&
    !S.validate(withAt(P, "interpretation.heightFilter", { op: "median", radius: 1 })).ok);
  const leg = S.fromLegacySettings({ procRes: 720, smoothRadius: 4, smoothPasses: 2, nSheets: 5, widthMM: 300 }).project;
  check("DEP-04 legacy smoothRadius 4 at 720 px on 300 mm maps to radiusMM 1.65 and back", leg.interpretation.smoothing.radiusMM === 1.65 && S.legacyState(leg).smoothRadius === 4);
  check("DEP-04 legacyState uses the art long side from the source when known (portrait 300 × 600 source: art long side 600 mm)",
    S.legacyState(A, 300, 600).smoothRadius === Math.round(1.65 * 720 / 600) && S.legacyState(A, 600, 300).smoothRadius === 4);
  check("UI-01 applyControl(\"smooth\") takes mm (0.05 grid, clamped 0–5); invalid entry unchanged; revision + 1",
    S.applyControl(A, "smooth", "2.5").interpretation.smoothing.radiusMM === 2.5 && S.applyControl(A, "smooth", 2.5).revision === A.revision + 1 &&
    S.applyControl(A, "smooth", 1.62).interpretation.smoothing.radiusMM === 1.6 && S.applyControl(A, "smooth", 9).interpretation.smoothing.radiusMM === 5 &&
    S.applyControl(A, "smooth", "x").revision === A.revision && S.controlValues(A)["in-smooth"] === "1.65");
  // the height filter converts mm per raster, at least 1 px; HEIGHT_FILTERED states mm and px
  { const w = 40, h = 30, s = F.heightMap(3, w, h, 6), interp = Object.assign({}, P.interpretation, { heightFilter: { op: "median", radiusMM: 0.5 } });
    const r = E.interpretHeight(s, w, h, interp, 4, null, { geometry: { mmPerPxMax: 0.25 } });
    const ref = SBHeight.addedFromSamples(SBHeight.applyFilter(s, w, h, { op: "median", radius: 2 }), 4, "white-high");
    const d = r.diagnostics.find((x) => x.code === "HEIGHT_FILTERED");
    check("IMG-03 heightFilter radiusMM 0.5 at 0.25 mm/px runs a 2 px median; HEIGHT_FILTERED states mm and px",
      r.added.join() === ref.join() && !!d && /0\.5 mm/.test(d.message) && /2 px/.test(d.message));
    const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
    check("IMG-03 a median/box heightFilter without the raster pitch is refused (ENGINE_ARG); remap needs none",
      code(() => E.interpretHeight(s, w, h, interp, 4, null, {})) === "ENGINE_ARG" &&
      code(() => E.interpretHeight(s, w, h, Object.assign({}, interp, { heightFilter: { op: "remap", lut: Array.from({ length: 256 }, (_, i) => i) } }), 4, null, {})) === null); }
  { const fs = require("fs"), path = require("path"), rd = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const app = rd("js/app.js"), html = rd("index.html"), ctl = /const CONTROLS = \[([\s\S]*?)\];/.exec(app);
    check("UI-01 the smoothing control is in mm: #in-smooth is a 0–5 mm range in 0.05 steps written through applyControl(\"smooth\")",
      /<input id="in-smooth" type="range" min="0" max="5" step="0\.05">/.test(html) && /Cartoon smoothing \(mm\)/.test(html) &&
      !!ctl && /"smooth"/.test(ctl[1]) && !/bindRange\("in-smooth"/.test(app) && /\$\("out-smooth"\)\.textContent = .*radiusMM.*" mm"/.test(app)); }
  // fidelity: a smooth colour fixture, tonal bonded, draft at a quarter of the fabrication raster
  const w = 640, h = 480, g = F.heightMap(7, w, h), rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = g[i]; rgba[4 * i + 1] = 255 - g[i]; rgba[4 * i + 2] = (g[i] >> 1) + 64; rgba[4 * i + 3] = 255; }
  const px = { pixels: rgba, channels: 4, w, h, alpha: null };
  let p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "canvas-tonal" }));
  p = S.applyModeChange(p, { interpretation: { mode: "tonal" } }, true); p.interpretation.smoothing = { radiusMM: 1.65, passes: 2 };
  p.geometry.targetMM = 120; p.geometry.draftPx = 160; p.geometry.fabPitchMM = 0.25;
  const d = E.generate(E.request(p, px, { quality: "draft" })).snapshot, f = E.generate(E.request(p, px, { quality: "fabrication" })).snapshot;
  // Recorded tolerance; never loosened without a plan note. Measured 2026-10-08 (E3b): worst area deviation 2.28 % (layer 7),
  // worst part-count ratio 1.75 (8 vs 14, layer 3). With the old pixel radius (r4 on both rasters) the same fixture gives
  // 7.68 % and part ratios up to 11 (3 vs 33), so the part-count check fails on pixel radii.
  // Appendix G G1 (2026-10-09): the fabrication raster (0.25 mm/px, F = 6) now runs the disc R² 9 instead of the square r 3;
  // re-measured worst area deviation 3.03 % (layer 7), worst part-count ratio 1.70 (10 vs 17, layer 5). Thresholds unchanged.
  const pageMM2 = f.page.wMM * f.page.hMM, TOL = 0.08, PARTS = 2;
  const big = f.layers.map((L, k) => k).filter((k) => f.layers[k].stats.areaMM2 > 0.05 * pageMM2);
  check("LYR-06 draft vs fabrication: per-layer area within 8 % on every layer above 5 % of the page", big.length > 0 &&
    big.every((k) => Math.abs(d.layers[k].stats.areaMM2 - f.layers[k].stats.areaMM2) <= TOL * f.layers[k].stats.areaMM2));
  check("LYR-06 draft vs fabrication: part counts within a factor of 2 per layer",
    f.layers.every((L, k) => { const a = d.layers[k].parts.length, b = L.parts.length; return Math.max(a, b) <= PARTS * Math.max(1, Math.min(a, b)); }));
});

suite("schema.js/engine.js — alpha.3 E4 draft budget (PO-PREVIEW-1)", () => {
  const rec = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs/perf/draft-budget.json"), "utf8"));
  const L = SBSchema.limits;
  check("PO-PREVIEW-1 PO-PERF-3 draft budget equals docs/perf/draft-budget.json (desktop cap, mobile cap, both presets' draftPx, fallback 720)",
    rec.task === "F17" && L("desktop").draftPxCap === rec.decision.desktopDraftPx && L("mobile").draftPxCap === rec.decision.mobileDraftPx && rec.decision.mobileDraftPx === 720 &&
    rec.decision.desktopDraftPx === Math.max(rec.decision.presets.plywood, rec.decision.presets.acrylic) &&
    SBSchema.defaults("plywood").geometry.draftPx === rec.decision.presets.plywood && SBSchema.defaults("acrylic").geometry.draftPx === rec.decision.presets.acrylic &&
    L("desktop").draftPxFallback === 720 && L("mobile").draftPxFallback === 720 && rec.decision.fallbackDraftPx === 720);
  check("PO-PERF-3 the decision is a candidate (or 720) within the schema ceiling (draftPx ≤ 2000) and validates in both presets",
    [720, 1280, 1536, 1792, 2000].includes(rec.decision.desktopDraftPx) && SBSchema.validate(SBSchema.defaults("plywood")).ok && SBSchema.validate(SBSchema.defaults("acrylic")).ok &&
    !SBSchema.validate(Object.assign(SBSchema.defaults("plywood"), { geometry: Object.assign(SBSchema.defaults("plywood").geometry, { draftPx: 2001 }) })).ok);
  check("PO-PREVIEW-2 limits().fabMsPerMpx (pool) and fabMsPerMpxFallback (sync driver) equal the recorded fabrication rows (desktop) and × 4 (mobile)",
    Number.isInteger(rec.decision.fabMsPerMpx) && Number.isInteger(rec.decision.fabMsPerMpxFallback) &&
    L("desktop").fabMsPerMpx === rec.decision.fabMsPerMpx && L("mobile").fabMsPerMpx === 4 * rec.decision.fabMsPerMpx &&
    L("desktop").fabMsPerMpxFallback === rec.decision.fabMsPerMpxFallback && L("mobile").fabMsPerMpxFallback === 4 * rec.decision.fabMsPerMpxFallback);
  const p = SBSchema.defaults("plywood"); p.source = SBSchema.sourceTemplate();
  const m = SBEngine.rasterPlan(p, { w: 4096, h: 3084 }, "draft", "mobile").geometry, d = SBEngine.rasterPlan(p, { w: 4096, h: 3084 }, "draft", "desktop").geometry;
  check("PO-PREVIEW-1 rasterPlan applies the mobile draftPxCap without changing the project key",
    Math.max(m.rasterW, m.rasterH) === Math.min(p.geometry.draftPx, 720) && Math.max(d.rasterW, d.rasterH) === Math.min(p.geometry.draftPx, rec.decision.desktopDraftPx));
  check("PO-PREVIEW-1 PO-PERF-3 the rationale names the F.7 rule (warm p95 ≤ 2.5 s Chromium and Firefox on the i7, ≤ 3.0 s M5, both families, E4 warm edit, scene caps), machine and workload",
    /2\.5 s/.test(rec.rule) && /3\.0 s/.test(rec.rule) && /p95/.test(rec.rule) && /Chromium/.test(rec.rule) && /Firefox/.test(rec.rule) && /M5/.test(rec.rule) &&
    /BOTH the realistic and the busy/.test(rec.rule) && /sheets 8 ↔ 7/.test(rec.rule) && /alpha\.3 scene/.test(rec.rule) &&
    /11800H/.test(rec.machine) && /4096/.test(rec.workload) && /busy/.test(rec.workload) && /realistic/.test(rec.workload));
  check("PO-PERF-3 the E4 record (rule 3.0 s, 720) is kept as history under e4",
    rec.e4 && rec.e4.task === "E4" && rec.e4.decision.desktopDraftPx === 720 && /3\.0 s/.test(rec.e4.rule) && Array.isArray(rec.e4.rows));
  // the recorded decision is the rule applied to the recorded rows (bench decideDraft), and a cap above the project value never upsamples
  const B = require("./bench.js");
  check("PO-PREVIEW-1 E4 decideDraft reproduces the E4 decision from the E4 rows (history)",
    typeof B.decideDraft === "function" && JSON.stringify(B.decideDraft(rec.e4.rows, rec.e4.fabRows)) === JSON.stringify(rec.e4.decision));
  check("PO-PERF-3 decideDraftF17 reproduces the recorded decision from the recorded f17 rows (browser rows, alpha.3 scene, Node fabrication rows)",
    typeof B.decideDraftF17 === "function" && rec.rule === B.F17.rule && JSON.stringify(B.decideDraftF17(rec.f17)) === JSON.stringify(rec.decision));
  check("PO-PERF-3 the recorded f17 evidence: Chromium and Firefox on the i7 for every candidate, both families, ≥ 15 warm runs; Node pool 8 sweep with the alpha.3 scene at 720 and every candidate",
    ["chromium-i7", "firefox-i7"].every((k) => rec.f17.browser[k] && B.F17.candidates.every((c) => { const r = rec.f17.browser[k].rows.find((x) => x.draftPx === c);
      return r && r.pool.mode === "pool" && B.F17.families.every((f) => r.families[f] && r.families[f].warmRuns >= 15 && Number.isFinite(r.families[f].k2MissP95Ms) && Number.isFinite(r.families[f].renderP95Ms)); })) &&
    [720].concat(B.F17.candidates).every((c) => rec.f17.node.pool8.sceneRows.some((x) => x.draftPx === c)) && rec.f17.node.pool8.pool === 8);
  {
    // the rule on synthetic records: every browser and family must pass, the scene must not hit a new cap, the largest passing size wins
    const fam = (r, b) => ({ realistic: { warmP95Ms: r }, busy: { warmP95Ms: b } });
    const rows = (t) => t.map(([c, r, b]) => ({ draftPx: c, families: fam(r, b) }));
    const scene = (hits) => [720, 1280, 1536, 1792, 2000].map((c) => ({ draftPx: c, capHits: (hits[c] || []).concat(hits.all || []) }));
    const mk = (chr, ff, hits, m5) => ({ browser: Object.assign({ "chromium-i7": { rows: rows(chr) }, "firefox-i7": { rows: rows(ff) } }, m5 ? { "chromium-m5": { rows: rows(m5) } } : {}),
      node: { pool8: { sceneRows: scene(hits || {}), fabRows: [{ family: "realistic", status: "done", p50Ms: 1000, mpx: 2 }] }, pool0: { fabRows: [{ family: "realistic", status: "done", p50Ms: 3001, mpx: 2 }] } } });
    const all = (r, b) => [1280, 1536, 1792, 2000].map((c, i) => [c, r[i], b[i]]);
    const D = (x) => B.decideDraftF17(x);
    const d1 = D(mk(all([2000, 2400, 2600, 3000], [1000, 1500, 2000, 2400]), all([2100, 2450, 2490, 2800], [1100, 1200, 1300, 1400])));
    check("PO-PERF-3 decideDraftF17: largest size passing in both browsers on both families (a Chromium miss at 1792 decides 1536); fabrication ms/Mpx rounded up to 10",
      d1.desktopDraftPx === 1536 && d1.presets.plywood === 1536 && d1.presets.acrylic === 1536 && d1.mobileDraftPx === 720 && d1.fallbackDraftPx === 720 &&
      d1.fabMsPerMpx === 500 && d1.fabMsPerMpxFallback === 1510 && d1.m5 === "pending" && d1.rejected.some((r) => r.draftPx === 1792 && /chromium-i7 realistic/.test(r.reason)));
    const d2 = D(mk(all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 2600]), all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000])));
    check("PO-PERF-3 decideDraftF17: the busy family gates too (busy 2.6 s at 2000 → 1792)", d2.desktopDraftPx === 1792);
    const d3 = D(mk(all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000]), all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000]), { 1792: ["COMPLEXITY_LIMIT"], 2000: ["COMPLEXITY_LIMIT"] }));
    const d3b = D(mk(all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000]), all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000]), { all: ["FAB_COMPLEXITY_LIKELY"] }));
    check("PO-PERF-3 decideDraftF17: a size whose alpha.3 scene draft hits a cap 720 did not is rejected (F.4 #5); a cap hit already at 720 does not reject",
      d3.desktopDraftPx === 1536 && d3.rejected.some((r) => r.draftPx === 1792 && /COMPLEXITY_LIMIT/.test(r.reason)) && d3b.desktopDraftPx === 2000);
    const d4 = D(mk(all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000]), all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000]), {}, all([2900, 3100, 3200, 3300], [1000, 1000, 1000, 1000])));
    const d5 = D(mk(all([2600, 2700, 2800, 2900], [1000, 1000, 1000, 1000]), all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000])));
    const d6 = D(mk(all([1000, 1000, 1000], [1000, 1000, 1000]), all([1000, 1000, 1000, 1000], [1000, 1000, 1000, 1000])));
    check("PO-PERF-3 decideDraftF17: the M5 (3.0 s) gates once recorded; none passing → 720; a size not measured in a required browser is rejected",
      d4.desktopDraftPx === 1280 && d4.m5 === "measured" && d5.desktopDraftPx === 720 && d5.passing.length === 0 && d6.desktopDraftPx === 1792 &&
      d6.rejected.some((r) => r.draftPx === 2000 && /not measured/.test(r.reason)));
  }
  const q = JSON.parse(JSON.stringify(p)); q.geometry.draftPx = 300;
  const qm = SBEngine.rasterPlan(q, { w: 4096, h: 3084 }, "draft", "mobile").geometry;
  check("PO-PREVIEW-1 a project draftPx below the device cap is kept (min(draftPx, cap)); the cap is not a project field",
    Math.max(qm.rasterW, qm.rasterH) === 300 && !("draftPxCap" in q.geometry));
  // E4: the measured overlay share of construct is >= 0.15 (docs/perf/draft-budget.json), so generate takes opts.overlays:false
  const F = require("./fixtures.js"), w = 200, h = 150, gm = F.heightMap(5, w, h), rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = gm[i]; rgba[4 * i + 1] = (gm[i] * 3) & 255; rgba[4 * i + 2] = 255 - gm[i]; rgba[4 * i + 3] = 255; }
  const px = { pixels: rgba, channels: 4, w, h, alpha: null };
  let r = SBSchema.withSource(SBSchema.defaults("plywood"), SBEngine.sourceRecord(px, { format: "png", decode: "canvas-tonal" }));
  r = SBSchema.applyModeChange(r, { interpretation: { mode: "tonal" } }, true); r.geometry.targetMM = 120;
  const on = SBEngine.generate(SBEngine.request(r, px, { quality: "draft" })), off = SBEngine.generate(SBEngine.request(r, px, { quality: "draft" }), { overlays: false });
  const has = (res) => res.snapshot.cleanupReport.some((e) => "added" in e || "removed" in e);
  check("G2.13b overlays:false omits added/removed, geometryHash unchanged",
    on.status === "done" && off.status === "done" && has(on) && !has(off) && on.geometryHash === off.geometryHash &&
    on.snapshot.cleanupReport.every((e, k) => e.addedMM2 === off.snapshot.cleanupReport[k].addedMM2 && e.removedMM2 === off.snapshot.cleanupReport[k].removedMM2));
  check("G2.13b overlays:false is recorded as worth it (overlay share >= 0.15 on the gating draft rows)",
    rec.e4.rows.some((x) => x.mode === "a" && x.draftPx === rec.e4.decision.presets.plywood && x.overlayShare >= 0.15));
});

suite("schema.js/app.js — speed round F17 draft default offer (PO-PERF-3, Q2: saved projects are not migrated silently)", () => {
  const S = SBSchema, D = S.limits("desktop").draftPxCap;
  check("F17 SBSchema.draftPxOffer / applyDraftOffer exist", typeof S.draftPxOffer === "function" && typeof S.applyDraftOffer === "function");
  if (typeof S.draftPxOffer !== "function") return;
  const old0 = S.defaults("plywood"); old0.geometry.draftPx = 720; old0.revision = 4;
  check("F17 the offer follows the decision: offered on desktop when the cap was raised, never when it stayed 720",
    D > 720 ? !!S.draftPxOffer(old0, "desktop") : S.draftPxOffer(old0, "desktop") === null && JSON.stringify(S.applyDraftOffer(old0, true)) === JSON.stringify(old0));
  // the offer itself, on js/schema.js with a raised desktop decision (the shipped schema when it is raised; else a copy with 1280)
  const Sx = D > 720 ? S : (() => { const ctx = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "schema.js"), "utf8")
    .replace(/const DRAFT_BUDGET = \{ desktopDraftPx: \d+,/, "const DRAFT_BUDGET = { desktopDraftPx: 1280,"), ctx); return ctx.SBSchema; })();
  const Dx = Sx.limits("desktop").draftPxCap, old = Sx.defaults("plywood"); old.geometry.draftPx = 720; old.revision = 4;
  const o = Sx.draftPxOffer(old, "desktop");
  check("F17 a project at the pre-F17 720 px draft is offered the raised default on desktop", Dx > 720 && !!o && o.from === 720 && o.to === Dx);
  check("F17 no offer on mobile (cap 720), for a project at another draftPx, or for a new project", Sx.draftPxOffer(old, "mobile") === null &&
    Sx.draftPxOffer(Object.assign(Sx.defaults("plywood"), { geometry: Object.assign(Sx.defaults("plywood").geometry, { draftPx: 1000 }) }), "desktop") === null &&
    Sx.draftPxOffer(Sx.defaults("plywood"), "desktop") === null && Sx.draftPxOffer(Sx.defaults("acrylic"), "desktop") === null);
  const before = JSON.stringify(old), acc = Sx.applyDraftOffer(old, true), dec = Sx.applyDraftOffer(old, false);
  check("F17 accepting applies the default (revision + 1: draftPx is in the geometryKey), records history and answers the offer; input not mutated",
    acc.geometry.draftPx === Dx && acc.revision === 5 && acc.extras.draftOffer === "applied" && Sx.validate(acc).ok &&
      acc.extras.history.some((h) => h.op === "draft-default" && h.from === 720 && h.to === Dx && h.revision === 5) && JSON.stringify(old) === before);
  check("F17 declining keeps the geometry and the revision and answers the offer, so it is shown once",
    dec.geometry.draftPx === 720 && dec.revision === 4 && dec.extras.draftOffer === "declined" && Sx.draftPxOffer(dec, "desktop") === null &&
      Sx.draftPxOffer(acc, "desktop") === null && Sx.validate(dec).ok && JSON.stringify(Sx.geometryKey(dec)) === JSON.stringify(Sx.geometryKey(old)));
  check("F17 the answer survives a save/load round trip (extras)", Sx.draftPxOffer(JSON.parse(JSON.stringify(dec)), "desktop") === null);
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  check("F17 index.html has the one-time offer (#draft-offer with its text, Use and Keep buttons), hidden by default",
    /<p id="draft-offer"[^>]*role="status"[^>]*hidden>/.test(html) && /id="draft-offer-text"/.test(html) && /id="btn-draft-offer"/.test(html) && /id="btn-draft-keep"/.test(html));
  check("F17 the app shows the offer from SBSchema.draftPxOffer on every regenerate and applies it only on the user's click (applyDraftOffer only in answerDraftOffer)",
    /SBSchema\.draftPxOffer\(project, deviceClass\(\)\)/.test(fn("updateDraftOffer")) && /updateDraftOffer\(\)/.test(fn("regenerate")) &&
    (appSrc.match(/SBSchema\.applyDraftOffer\(/g) || []).length === 1 && /SBSchema\.applyDraftOffer\(project, accept\)/.test(fn("answerDraftOffer")) &&
    /"btn-draft-offer"\)\.addEventListener\("click", \(\) => answerDraftOffer\(true\)\)/.test(appSrc) &&
    /"btn-draft-keep"\)\.addEventListener\("click", \(\) => answerDraftOffer\(false\)\)/.test(appSrc));
  check("F17 the fallback fabrication estimate uses fabMsPerMpxFallback, the pooled one fabMsPerMpx",
    /fallback \? "fabMsPerMpxFallback" : "fabMsPerMpx"/.test(fn("fabBusyText")) && /fabBusyText\(dc, true\)/.test(fn("fabFallback")) && /fabBusyText\(dc\)/.test(fn("fabReview")));
});

suite("app.js — alpha.3 E5 real-engine draft (PO-PREVIEW-1, LYR-06, UI-05)", () => {
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const pvSrc = fs.readFileSync(path.join(__dirname, "..", "js", "preview.js"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  check("PO-PREVIEW-1 app.js calls no SBEngine.legacy* (legacyRun, legacyView, legacyDiagnostics, legacySnapshotHash, legacyCleanupReport)", !/SBEngine\.legacy\w*\(/.test(appSrc));
  check("PO-PREVIEW-1 the draft is SBEngine.request(…, {quality: \"draft\"}) through the pool (regenerate) or SBEngine.generate with the draft cache (regenerateFallback, F15)",
    /pool\.submit\(\s*SBEngine\.request\([^)]*quality:\s*"draft"/.test(fn("regenerate")) &&
    /SBEngine\.generate\(\s*SBEngine\.request\([^)]*quality:\s*"draft"/.test(fn("regenerateFallback")) && /run\.draftCache/.test(fn("regenerateFallback")));
  check("LYR-06 regenerate no longer downsamples on a canvas (no drawImage)", fn("regenerate").length > 0 && !/drawImage\(/.test(fn("regenerate") + fn("regenerateFallback")));
  check("UI-05 the fallback draft paints the Stale state before the blocking run (rAF + task, regenerateFallback, F15)", /requestAnimationFrame\(\(\) => setTimeout\(/.test(fn("regenerateFallback")));
  check("UI-04 the diagnostics panel lists res.diagnostics when generate fails with no layers (COMPLEXITY_LIMIT)",
    /\.status === "error"/.test(appSrc) && /renderDiagnostics\(/.test(fn("regenerate") + fn("showResult")) && /No layers/.test(fn("renderDiagnostics")));
  check("alpha.3 no run.sheets / procW / viewToken left in app.js", !/run\.sheets\b|run\.procW|run\.viewToken/.test(appSrc));
  check("UI-05 showResult reads only the result's snapshot (no project.* reference)", fn("showResult").length > 0 && !/\bproject\./.test(fn("showResult")));
  check("UI-05 showResult feeds the preview from r.snapshot.page/.layers/.construction and overlays in the snapshot's own mode",
    /preview\.setSnapshot\([^;]*\.page[^;]*\.layers[^;]*\.construction\.tMM[^;]*\.construction\.gMM/.test(fn("showResult")) &&
    /SBProof\.overlays\(\{[^}]*cleanupReport[^}]*mode:\s*\w+\.construction\.mode/.test(fn("showResult")));
  check("SUP-06 app.js never passes bridges to preview.setSnapshot; preview.js has no opts.bridges branch",
    !/setSnapshot\([^;]*bridges/.test(appSrc) && !/o\.bridges|opts\.bridges/.test(pvSrc));
  check("SUP-06 no raster bridge path survives: no setSheets / maskToCanvas in js/preview.js or js/app.js",
    !/setSheets|maskToCanvas/.test(pvSrc) && !/setSheets|maskToCanvas|showRaster|rasterCard|buildView/.test(appSrc));
  check("PO-PREVIEW-1 the draft status line says the draft is approximate; a fabrication result names its hash",
    /Draft \(approximate/.test(appSrc) && /geometryHash\.slice\(0, 12\)/.test(fn("statusText")));
  check("UI-02 renderSheetGrid iterates the shown snapshot's layers with SBProof.cards; bonded roles base / top; omitted badge",
    /SBProof\.cards\(\s*\w+\.layers,\s*\w+\.page\)/.test(fn("renderSheetGrid")) && /"base"/.test(fn("renderSheetGrid")) && /"top"/.test(fn("renderSheetGrid")) &&
    /omitted/.test(fn("renderSheetGrid")) && /cleanupReport/.test(fn("renderSheetGrid")) && /stats\.cutMM/.test(fn("renderSheetGrid")));
  check("LYR-01 updateDimbar counts layers from the shown snapshot's stats", /\.snapshot\.stats|snap\.stats/.test(fn("updateDimbar")) && !/run\.sheets/.test(fn("updateDimbar")));
  check("SUP-04 the clip dialog proposes on run.shown.snapshot at its own quality; applied = snapshot.repairsApplied",
    /SBSupport\.proposeClip\(\{[^}]*layers:\s*\w+\.layers[^}]*quality:\s*\w+\.quality/.test(fn("openClipDialog")) && /repairsApplied/.test(appSrc) &&
    /run\.shown\.revision === project\.revision/.test(appSrc) && !/run\.applied\b/.test(appSrc));
  check("UI-05 draft acks are kept only for the same geometryHash (applyDraft, both drivers)", /geometryHash === [^;]*geometryHash[^;]*\.acks/.test(fn("applyDraft")));
  check("UI-01 geometry range inputs commit on change (input only updates the number); debounce 300 ms",
    /SBUtil\.debounce\(regenerate, 300\)/.test(appSrc) && /type === "range"[\s\S]{0,400}"change"/.test(fn("bindControls")));
  check("PO-PREVIEW-1 the overlay polygons are built only while the Changes overlay is on (generate opts.overlays)",
    /overlays:\s*/.test(fn("regenerate")) && /in-overlays/.test(fn("regenerate") + fn("wantOverlays")));
  // bonded never shows bridges, by construction (engine-level)
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema, w = 200, h = 150, rgba = new Uint8Array(w * h * 4), g = F.heightMap(5, w, h);
  for (let i = 0; i < w * h; i++) { rgba[4 * i] = g[i]; rgba[4 * i + 1] = 255 - g[i]; rgba[4 * i + 2] = (g[i] * 7) & 255; rgba[4 * i + 3] = 255; }
  const px = { pixels: rgba, channels: 4, w, h, alpha: null };
  let p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "canvas-tonal" }));
  p = S.applyModeChange(p, { interpretation: { mode: "tonal" } }, true); p.geometry.targetMM = 60;
  const res = E.generate(E.request(p, px, { quality: "draft" }));
  const s = res.snapshot;
  check("PO-PREVIEW-1 bonded colour draft: no cleanupReport bridges and every SBProof.overlays(bonded) entry has bridges null",
    res.status === "done" && s.cleanupReport.every((c) => !c.bridges && !c.bridged) &&
    SBProof.overlays({ cleanupReport: s.cleanupReport, diagnostics: s.diagnostics, mode: "bonded-relief" }).every((o) => o.bridges === null));
  check("UI-05 the bonded draft snapshot carries its own construction (mode, t, g = 0) for showResult",
    s.construction.mode === "bonded-relief" && s.construction.gMM === 0 && s.construction.tMM === p.material.thicknessMM);
  // E5 review fix: the export path passes a layer count to sheetColors(n); with none the palette was [] and
  // SBSvg.assemblySVG threw COLOR on every export. Static: every sheetColors( call passes a count.
  const scCalls = appSrc.match(/sheetColors\(([^)]*)\)/g) || [];
  check("EXP-07 every sheetColors( call in app.js passes a layer count (no empty call)",
    scCalls.length >= 3 && scCalls.every((c) => !/sheetColors\(\s*\)/.test(c)));
  // Behavioural: run buildAndDeliver's own sheetColors(...) argument and the real sheetColors on a fabrication snapshot,
  // then SBEngine.fabricationFiles (proof.svg = SBSvg.assemblySVG) in both appearance modes.
  const palSrc = appSrc.slice(appSrc.indexOf("const PALETTES = {"), appSrc.indexOf("};", appSrc.indexOf("const PALETTES = {")) + 2);
  const bad = fn("buildAndDeliver"), argM = /sheetColors\(([^)]*)\)/.exec(bad);
  const fq = E.generate(E.fabricationRequest(p, px, { requestId: "e5-export", deviceClass: "desktop", format: "png", decode: "canvas-tonal" })), fs5 = fq.snapshot;
  for (const mode of ["uniform", "palette"]) {
    const proj = JSON.parse(JSON.stringify(p));
    proj.appearance.mode = mode;
    let out = null, err = null;
    try {
      const colorsOf = new Function("project", "SBUtil", palSrc + "\n" + fn("sheetColors") + "\n  }\nreturn sheetColors;")(proj, SBUtil);
      const n = new Function("run", "project", "return (" + (argM ? argM[1] : "") + ");")({ fab: { snapshot: fs5 } }, proj);
      const colors = colorsOf(n);
      out = { colors, files: E.fabricationFiles(fs5, proj, colors) };
    } catch (e) { err = e; }
    check("EXP-07 export (" + mode + "): buildAndDeliver's sheetColors(...) gives one #colour per fabrication layer and fabricationFiles builds proof.svg",
      fq.status === "done" && !err && out.colors.length === fs5.layers.length && out.colors.every((c) => /^#[0-9a-fA-F]{3,6}$/.test(c)) &&
      out.files.some((f) => f.name === "proof.svg" && /<path /.test(f.data)));
  }
});

// ------------------------------------------------ alpha.3 E6 (fabrication preview; files only from the shown fabrication result)
suite("index.html/app.js — alpha.3 E6 fabrication preview (PO-PREVIEW-2, LYR-06, UI-06)", () => {
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  check("PO-PREVIEW-2 index.html has #btn-fabpreview", /id="btn-fabpreview"/.test(html));
  check("PO-PREVIEW-2 #btn-fabpreview and #fabpreview-note sit in the Review stage",
    (() => { const m = /<section class="step" id="stage-review"[\s\S]*?<\/section>/.exec(html); return !!m && /id="btn-fabpreview"/.test(m[0]) && /id="fabpreview-note"/.test(m[0]); })());
  check("PO-PREVIEW-2 the button runs fabReview and shows run.fab in every view", /btn-fabpreview/.test(appSrc) && /run\.shown = run\.fab/.test(appSrc));
  check("NFR-02 (deviation, fallback only) the busy text is painted before the blocking fabrication run", /will not respond/.test(fn("fabFallback")) && /requestAnimationFrame\(\(\) => setTimeout\(/.test(fn("fabFallback")));
  check("NFR-02 the busy estimate uses SBSchema.limits(…).fabMsPerMpx (the app cannot read docs/ at runtime)", /fabMsPerMpx/.test(fn("fabBusyText")) && /fabBusyText\(/.test(fn("fabReview")) && /fabBusyText\(/.test(fn("fabFallback")));
  check("LYR-06 exportBundle does not regenerate while fabCurrent()", /fabCurrent\(\)/.test(fn("fabReview")) && fn("exportBundle").indexOf("SBEngine.generate(") < 0);
  check("UI-06 fab preview of revision r is not shown for r+1 (fabCurrent checks the revision; an edit shows the draft)",
    /run\.fab\.revision === project\.revision/.test(fn("fabCurrent")) && /run\.shown = run\.draft/.test(appSrc));
  check("UI-06 an edit (recompute) leaves the fabrication result for the Stale draft at once",
    /showDraft\(\)/.test(fn("recompute")) && /run\.shown = run\.draft/.test(fn("showDraft")));
  check("UI-06 a draft finishing while the current fabrication result is shown does not replace it",
    /run\.shown === run\.fab && fabCurrent\(\)/.test(fn("applyDraft")));
  const bd = fn("buildAndDeliver"), ex = fn("exportBundle");
  check("PO-PREVIEW-2 delivery requires the shown, current fabrication result; otherwise export shows it and stops",
    /run\.shown === run\.fab/.test(ex) && /fabCurrent\(\)/.test(ex) && /showFab\(\)/.test(ex) && ex.indexOf("showFab()") < ex.indexOf("buildAndDeliver("));
  check("PO-PREVIEW-7 buildAndDeliver builds files, settings and preview.png from run.fab.snapshot and never restores the draft",
    /SBEngine\.fabricationFiles\(run\.fab\.snapshot/.test(bd) && /run\.fab\.snapshot/.test(fn("settingsJSON")) && !/run\.shown = (back|run\.draft)/.test(bd) && !/showResult\(back\)/.test(bd));
  check("PO-PREVIEW-7 preview.png is captured with overlays off and focus cleared",
    /setOverlays\(null\)/.test(bd) && /setFocus\(null\)/.test(bd) && bd.indexOf("setOverlays(null)") < bd.indexOf("preview.snapshot("));
  check("LYR-06 fabReview passes no stage cache (E-R7) and checks the sample hash", !/cache:/.test(fn("fabReview") + fn("fabFallback")) && /sampleHash/.test(fn("fabReview")) && /sampleHash/.test(fn("fabFallback")));
  check("UI-04 one renderer: the fabrication review is renderDiagnostics(run.fab, {scope: \"fabrication\"}), its header names the short geometryHash",
    /renderDiagnostics\(run\.fab, \{ scope: "fabrication" \}\)/.test(fn("renderFabReview")) && /geometryHash\.slice\(0, 12\)/.test(fn("renderDiagnostics")) &&
    /Acknowledge for this fabrication result/.test(appSrc));
  check("UI-04 diagnostics items are navigable only on the shown result (fabrication items once run.shown === run.fab)",
    /r === run\.shown/.test(fn("renderDiagnostics")));
  const E = SBEngine, F = require("./fixtures.js"), px = { pixels: F.heightMap(9, 160, 120), channels: 1, w: 160, h: 120, alpha: null };
  const p = SBSchema.withSource(SBSchema.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); p.geometry.targetMM = 12;
  const g1 = E.generate(E.request(p, px, { quality: "fabrication" })), g2 = E.generate(E.request(p, px, { quality: "fabrication" }));
  check("LYR-06 two fabrication requests on unchanged inputs give the same geometryHash (the previewed snapshot is the exported one)",
    g1.status === "done" && typeof g1.snapshot.geometryHash === "string" && g1.snapshot.geometryHash === g2.snapshot.geometryHash);
});

suite("schema.js/app.js — alpha.3 E7 presets and colour sources (PRJ-01, IMG-01, PO-PREVIEW-3)", () => {
  const S = SBSchema, F = require("./fixtures.js");
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  check("PRJ-01 app default preset is plywood", /let project = SBSchema\.defaults\("plywood"\)/.test(appSrc));
  check("PO-PREVIEW-3 #in-preset offers Plywood (bonded) and Acrylic (connected)", /id="in-preset"/.test(html) && /value="plywood"[^>]*>Plywood/.test(html) && /value="acrylic"/.test(html));
  check("PO-PREVIEW-3 #in-preset sits above #in-interp", html.indexOf('id="in-preset"') > 0 && html.indexOf('id="in-preset"') < html.indexOf('id="in-interp"'));
  const ply = S.defaults("plywood"); ply.title = "keep"; ply.source = S.sourceTemplate();
  const acr = S.applyPreset(ply, "acrylic", true);
  check("PRJ-02 applyPreset keeps title and source, takes the rest from the preset, bumps the revision",
    acr.title === "keep" && JSON.stringify(acr.source) === JSON.stringify(ply.source) && acr.construction.mode === "connected-sheet" && acr.revision === ply.revision + 1 &&
    S.presetDiff(ply, "acrylic").some((d) => d.path === "construction.mode"));
  check("PRJ-02 applyPreset keeps units, machine and extras; Cancel (accepted false) and the same preset change nothing",
    (() => { const q = JSON.parse(JSON.stringify(ply)); q.units = "in"; q.extras = { history: [{ op: "x" }] };
      const r = S.applyPreset(q, "acrylic", true);
      return r.units === "in" && JSON.stringify(r.extras) === JSON.stringify(q.extras) && JSON.stringify(r.machine) === JSON.stringify(q.machine) &&
        JSON.stringify(S.applyPreset(q, "acrylic", false)) === JSON.stringify(q) && JSON.stringify(S.applyPreset(q, "plywood", true)) === JSON.stringify(q) &&
        S.presetDiff(q, "plywood").length === 0 && S.validate(r).ok; })());
  check("PRJ-02 presetDiff entries carry {path, from, to, reason}", S.presetDiff(ply, "acrylic").every((d) => typeof d.reason === "string" && d.reason.length > 0 && "from" in d && "to" in d));
  const sw = S.colourSourceSwitch(ply).project;
  check("IMG-01/PO-PREVIEW-3 colour source under plywood → tonal, light-front, smoothing r4 p2, bonded kept, history recorded",
    sw.interpretation.mode === "tonal" && sw.interpretation.polarity === "light-front" && sw.interpretation.smoothing.radiusMM === 1.65 &&
    sw.interpretation.smoothing.passes === 2 &&
    sw.construction.mode === "bonded-relief" && sw.extras.history.some((h) => h.op === "auto-tonal") && S.validate(sw).ok);
  check("PO-PREVIEW-3 colourSourceSwitch returns its patch and is pure", (() => { const before = JSON.stringify(ply), r = S.colourSourceSwitch(ply);
    return JSON.stringify(ply) === before && r.patch && r.patch.interpretation.mode === "tonal"; })());
  const jpg = F.jpegHeader({ w: 64, h: 48 });
  const pre = S.intake(jpg, { project: ply, deviceClass: "desktop" });
  check("IMG-01 plywood + JPEG: preflight still names HEIGHT_NEEDS_PNG (the app switches on it); tonal accepts it",
    pre.code === "HEIGHT_NEEDS_PNG" && S.intake(jpg, { project: sw, deviceClass: "desktop" }).code !== "HEIGHT_NEEDS_PNG");
  const eq = new Uint8Array(32 * 32 * 3); for (let i = 0; i < eq.length; i++) eq[i] = (i / 3) & 255;
  const pngEq = F.pngEncode({ w: 32, h: 32, colorType: 2, bitDepth: 8, data: eq });
  checkAsync("IMG-01 RGB-equal truecolour PNG under plywood stays height (raw decode succeeds)", SBPng.decode(new Uint8Array(pngEq), { mode: "height" }).then((d) => d.channels === 1));
  check("IMG-01 RGB-equal truecolour PNG under plywood passes preflight on the raw route (no switch)",
    (() => { const r = S.intake(new Uint8Array(pngEq), { project: ply, deviceClass: "desktop" }); return r.ok && r.intake.decode === "raw"; })());
  check("SOURCE_COLOR_TONAL is a registered info code", SBDiag.CODES.SOURCE_COLOR_TONAL && SBDiag.CODES.SOURCE_COLOR_TONAL.severity === "info");
  check("PO-PREVIEW-3 loadFile switches to tonal on HEIGHT_NEEDS_PNG, PNG_PALETTE and PNG_UNEQUAL_RGB",
    /HEIGHT_NEEDS_PNG/.test(appSrc) && /PNG_PALETTE/.test(appSrc) && /PNG_UNEQUAL_RGB/.test(appSrc) && /SBSchema\.colourSourceSwitch\(/.test(appSrc));
  check("PO-PREVIEW-3 the switch is only taken in height mode and the notice is SOURCE_COLOR_TONAL in #why-source",
    /interpretation\.mode === "height"/.test(appSrc) && /SOURCE_COLOR_TONAL/.test(appSrc));
  check("PO-PREVIEW-3 #in-preset opens the #dlg-mode review from SBSchema.presetDiff and applies SBSchema.applyPreset",
    /in-preset/.test(appSrc) && /SBSchema\.presetDiff\(/.test(appSrc) && /SBSchema\.applyPreset\(/.test(appSrc));
  const b = S.applyModeChange(S.defaults("acrylic"), { construction: { mode: "bonded-relief" } }, true);
  check("ASM-01 a switch to bonded sets guides.mode from none to inset-outline", b.construction.guides.mode === "inset-outline");
  check("ASM-01/Q4 the plywood preset uses inset-outline guides", S.defaults("plywood").construction.guides.mode === "inset-outline");
  check("PO-PREVIEW-3 no 'Use as height map instead' button (it could never succeed)", !/Use as height map instead/.test(appSrc) && !/Use as height map instead/.test(html));
});

suite("docs.js/proof.js/app.js — alpha.3 E8 source diagnostics up front (PO-PREVIEW-4, GEO-06, NFR-04)", () => {
  const p = SBSchema.defaults("plywood"); p.geometry.targetMM = 470; p.source = SBSchema.sourceTemplate();
  const plan = SBEngine.rasterPlan(p, { w: 4096, h: 3084 }, "fabrication", "desktop");
  const notes = SBDocs.sourceNotes(plan.diagnostics);
  check("PO-LASER-5 4096×3084 at 470 mm shows FAB_EXCEEDS_SOURCE at load with the px shortfall",
    plan.diagnostics.some((d) => d.code === "FAB_EXCEEDS_SOURCE") && notes.some((l) => /px/.test(l) && /source/i.test(l)));
  const shown = { quality: "draft", snapshot: { quality: "draft", diagnostics: [] }, diagnostics: [] };
  const m = SBProof.panelModel(shown, plan.diagnostics);
  check("NFR-04 draft panel model has a non-ackable Fabrication resolution group", m.groups[0].title === "Fabrication resolution" && m.groups[0].ackable === false && m.groups[0].items.length === plan.diagnostics.length);
  check("LYR-06 a fabrication result's panel has no separate plan group (the fab run raises them itself)",
    !SBProof.panelModel({ quality: "fabrication", snapshot: { quality: "fabrication", diagnostics: [] }, diagnostics: [] }, plan.diagnostics).groups.some((g) => g.title === "Fabrication resolution"));
  const lim = SBSchema.limits("desktop"), lay = (v, n) => ({ stats: { vertices: v }, parts: new Array(n) });
  const near = { geometry: { rasterW: 1024, rasterH: 771 }, layers: [lay(40000, 10), lay(30000, 10)] };
  const pr = SBProof.predictFabComplexity(near, { rasterW: 4096, rasterH: 3084 }, lim);
  check("§12.3 a draft at 40k vertices/layer at 1024 px predicts ≈160k at 4096 px and flags the per-layer cap",
    pr.scale === 4 && pr.verticesPerLayerMax === 160000 && pr.over.includes("maxVerticesPerLayer"));
  check("§12.3 a draft well under the caps predicts no overflow", SBProof.predictFabComplexity({ geometry: near.geometry, layers: [lay(5000, 10)] }, { rasterW: 4096, rasterH: 3084 }, lim).over.length === 0);
  const mp = SBProof.panelModel(shown, plan.diagnostics, pr);
  check("NFR-04 the predicted overflow is a non-ackable FAB_COMPLEXITY_LIKELY item in the Fabrication resolution group",
    SBDiag.CODES.FAB_COMPLEXITY_LIKELY && SBDiag.CODES.FAB_COMPLEXITY_LIKELY.severity === "warning" && mp.groups[0].ackable === false && mp.groups[0].items.some((d) => d.code === "FAB_COMPLEXITY_LIKELY"));
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  check("UI-05 the badge is never Ready while the fabrication complexity prediction is over a cap", /predictFabComplexity\(/.test(appSrc) && /\.over\.length/.test(appSrc));
  check("PO-PREVIEW-4 loadFile shows every preflight warning (SBDocs.sourceNotes), not only EXIF_AMBIGUOUS",
    /SBDocs\.sourceNotes\(pre\.warnings\)/.test(appSrc) && !/filter\(\(d\) => d\.code === "EXIF_AMBIGUOUS"\)/.test(appSrc));
  // implementer additions (E8 open details)
  const fl = pr.over.length ? SBProof.panelModel(shown, [], pr).groups[0] : null;
  check("NFR-04 FAB_COMPLEXITY_LIKELY text names the predicted count, the layer and the cap",
    !!fl && fl.items.some((d) => d.code === "FAB_COMPLEXITY_LIKELY" && /160000|160,000/.test(d.message) && /layer 1/i.test(d.message) && new RegExp(String(lim.maxVerticesPerLayer)).test(d.message)));
  check("NFR-04 the Fabrication resolution group notes where it is acknowledged", m.groups[0].note === "Acknowledged in the Fabrication review");
  check("UI-04 a draft with no plan diagnostics and no predicted overflow has no Fabrication resolution group",
    !SBProof.panelModel(shown, [], SBProof.predictFabComplexity({ geometry: near.geometry, layers: [lay(5000, 10)] }, { rasterW: 4096, rasterH: 3084 }, lim)).groups.some((g) => g.title === "Fabrication resolution"));
  check("§12.3 the parts prediction is the draft count (a lower bound) and flags the parts cap",
    (() => { const q = SBProof.predictFabComplexity({ geometry: near.geometry, layers: [lay(10, lim.maxPartsPerLayer + 1)] }, { rasterW: 1024, rasterH: 771 }, lim);
      return q.scale === 1 && q.partsPerLayerMax === lim.maxPartsPerLayer + 1 && q.over.includes("maxPartsPerLayer"); })());
  check("§12.3 the total vertices are predicted and flag the total cap",
    (() => { const ls = []; for (let i = 0; i < 4; i++) ls.push(lay(30000, 1)); const q = SBProof.predictFabComplexity({ geometry: near.geometry, layers: ls }, { rasterW: 4096, rasterH: 3084 }, lim);
      return q.verticesTotal === 480000 && q.over.includes("maxVerticesTotal") && !q.over.includes("maxVerticesPerLayer"); })());
  check("NFR-04 renderDiagnostics lists the draft's Fabrication resolution group from SBProof.panelModel with no acknowledgement",
    /function renderDiagnostics[\s\S]*?SBProof\.panelModel\(r, [\s\S]*?Fabrication resolution[\s\S]*?\n  \}\n/.test(appSrc) && /renderPlanGroup\(/.test(appSrc));
  check("GEO-06 the dimbar and the draft panel share one fabrication plan (fabPlanNow)", (appSrc.match(/fabPlanNow\(\)/g) || []).length >= 2);
  check("PO-PREVIEW-4 sourceNotes keeps the EXIF_AMBIGUOUS warning (the only one loadFile showed before E8)",
    SBDocs.sourceNotes([SBDiag.make("EXIF_AMBIGUOUS", {})])[0] === SBDiag.make("EXIF_AMBIGUOUS", {}).message);
  check("PO-PREVIEW-4 sourceNotes returns one line per warning", SBDocs.sourceNotes(plan.diagnostics).length === plan.diagnostics.length && SBDocs.sourceNotes([]).length === 0);
});

suite("strokefont.js/geom.js — alpha.3 E9 stroke digits, box placement and buffers (ASM-03, EXP-03, AT-14)", () => {
  check("E9 API present", typeof globalThis.SBFont === "object" && typeof SBGeom.interiorPoint === "function" &&
    typeof SBGeom.placeBox === "function" && typeof SBGeom.bufferPolylines === "function");
  if (typeof globalThis.SBFont !== "object" || typeof SBGeom.placeBox !== "function" || typeof SBGeom.bufferPolylines !== "function") return;
  const s = SBFont.strokes("12", 3000);
  check("EXP-03 digits are open integer polylines inside their box (no text)", s.hUm === 3000 && s.wUm === Math.round(10 * 3000 / 6) &&
    s.paths.every((p) => p.length >= 4 && p.every(Number.isInteger) && p.every((v, i) => i % 2 ? v >= 0 && v <= 3000 : v >= 0 && v <= s.wUm)));
  check("FONT_CHAR for a character outside the alpha.3 charset", (() => { try { SBFont.strokes("A", 3000); return false; } catch (e) { return /FONT_CHAR/.test(e.message); } })());
  const sq = (x, y, s2) => [x, y, x + s2, y, x + s2, y + s2, x, y + s2];
  const donut = [{ outer: sq(0, 0, 10000), holes: [[2000, 2000, 2000, 8000, 8000, 8000, 8000, 2000]] }];   // hole: negative shoelace area
  const pt = SBGeom.interiorPoint(donut, 800);
  check("ASM-03 donut point is in the ring, not in the hole, with clearance", pt && !(pt[0] > 2000 && pt[0] < 8000 && pt[1] > 2000 && pt[1] < 8000));
  const crescent = SBGeom.normalize(SBGeom.difference([{ outer: sq(0, 0, 10000), holes: [] }], [{ outer: sq(3000, -1000, 9000), holes: [] }]));
  const pc = SBGeom.interiorPoint(crescent, 1000);
  check("ASM-03 crescent interior point is inside with clearance, not the bbox centre", pc && pc[0] < 3000 - 1000 + 1 && SBGeom.interiorPoint(crescent, 1000).join() === pc.join());
  check("ASM-03 too-thin region gives null", SBGeom.interiorPoint([{ outer: sq(0, 0, 1000), holes: [] }], 600) === null);
  const strip = [{ outer: [0, 0, 3200, 0, 3200, 17800, 0, 17800], holes: [] }];
  const bx = SBGeom.placeBox(strip, 1100, 1600);
  check("ASM-03 placeBox fits a 2.2 × 3.2 mm box in a 3.2 mm strip (an axis-aligned box, not the circumscribed circle)",
    bx && bx[0] - 1100 >= 0 && bx[0] + 1100 <= 3200 && bx[1] - 1600 >= 0 && bx[1] + 1600 <= 17800 && SBGeom.placeBox(strip, 1700, 1700) === null);
  const buf = SBGeom.bufferPolylines([[0, 0, 10000, 0]], 100);
  check("AT-14 bufferPolylines makes a square-capped band around an open path", Math.abs(SBGeom.area(buf) - 10200 * 200) <= 4 &&
    SBGeom.isEmpty(SBGeom.difference(buf, [{ outer: [-100, -100, 10100, -100, 10100, 100, -100, 100], holes: [] }])));
  const order = require("./modules.js").NODE_MODULES;
  check("T0.2 strokefont.js sits directly after support.js", order.indexOf("strokefont.js") === order.indexOf("support.js") + 1);
  // implementer additions (E9 open details)
  const all = SBFont.strokes("0123456789", 6000);
  check("EXP-03 every digit has strokes; advance 6 units, last glyph 4 units wide", all.wUm === 6000 * 58 / 6 && all.paths.length === 13 &&
    SBFont.CHARSET === "0123456789" && Object.isFrozen(SBFont));
  check("EXP-03 the second glyph is advanced by 6 units", (() => { const t = SBFont.strokes("1", 600), u = SBFont.strokes("11", 600); return u.paths[1].join() === t.paths[0].map((v, i) => i % 2 ? v : v + 600).join(); })());
  check("EXP-03 empty string → no paths, zero width", (() => { const e = SBFont.strokes("", 3000); return e.paths.length === 0 && e.wUm === 0 && e.hUm === 3000; })());
  check("EXP-03 non-integer height refused", (() => { try { SBFont.strokes("1", 2500.5); return false; } catch (e) { return true; } })());
  check("ASM-03 placeBox on empty input gives null", SBGeom.placeBox([], 100, 100) === null);
  check("ASM-03 placeBox is deterministic", SBGeom.placeBox(crescent, 900, 700).join() === SBGeom.placeBox(crescent, 900, 700).join());
  check("ASM-03 placeBox box lies inside a non-convex L", (() => {
    const L = [{ outer: [0, 0, 10000, 0, 10000, 2000, 2000, 2000, 2000, 10000, 0, 10000], holes: [] }];
    const c = SBGeom.placeBox(L, 900, 900); if (!c) return false;
    const box = [{ outer: [c[0] - 900, c[1] - 900, c[0] + 900, c[1] - 900, c[0] + 900, c[1] + 900, c[0] - 900, c[1] + 900], holes: [] }];
    return SBGeom.isEmpty(SBGeom.difference(box, L)); })());
  check("AT-14 bufferPolylines joins a closed ring (no square caps): an outer band of a square ring", (() => {
    const b = SBGeom.bufferPolylines([[0, 0, 4000, 0, 4000, 4000, 0, 4000, 0, 0]], 100);
    return b.length === 1 && b[0].holes.length === 1 && Math.abs(SBGeom.area(b) - (4200 * 4200 - 3800 * 3800)) <= 4; })());
  check("AT-14 bufferPolylines refuses a non-integer half width", (() => { try { SBGeom.bufferPolylines([[0, 0, 10, 0]], 0.5); return false; } catch (e) { return true; } })());
  check("AT-14 bufferPolylines unions overlapping paths", (() => {
    const b = SBGeom.bufferPolylines([[0, 0, 1000, 0], [500, 0, 1500, 0]], 50); return b.length === 1 && Math.abs(SBGeom.area(b) - 1600 * 100) <= 4; })());
});

suite("guides.js — alpha.3 E10 concealed guides and sheet labels (ASM-01/02/03, AT-14, GEO-07)", () => {
  check("E10 API present", typeof globalThis.SBGuides === "object" && typeof SBGuides.build === "function" && typeof SBGuides.validate === "function");
  if (typeof globalThis.SBGuides !== "object") return;
  const sq = (x, y, w, h) => [{ outer: [x, y, x + w, y, x + w, y + h, x, y + h], holes: [] }];
  const mk = (index, material) => SBMaterial.assignParts([SBMaterial.withMaterial({ index, material: [], parts: [], diagnostics: [], scorePaths: [] }, SBGeom.normalize(material), { revision: 0, quality: "draft" })])[0];
  // base, a 20×20 mm block, a crescent, a 1.5 mm sliver
  const L0 = mk(0, sq(0, 0, 60000, 40000));
  const L1 = mk(1, sq(5000, 5000, 20000, 20000).concat(sq(40000, 5000, 1500, 20000)));
  const cres = SBGeom.normalize(SBGeom.difference(sq(5000, 5000, 20000, 20000), sq(11000, 4000, 20000, 22000)));
  const L2 = mk(2, cres);
  const cfg = SBSchema.defaults("plywood").construction.guides;
  const ctx = { revision: 0, quality: "draft" };
  const b = SBGuides.build([L0, L1, L2], Object.assign({}, cfg, { mode: "inset-outline" }), ctx);
  check("ASM-01 inset-outline scores guides of layer k+1 on layer k (sheet 1 and 2), none on the top sheet",
    b.scorePaths[0].length > 0 && b.scorePaths[1].length > 0 && b.scorePaths[2].length === 0);
  check("AT-14 the 1.5 mm sliver and nothing else on layer 1 is omitted with GUIDE_OMITTED (warning)",
    b.guides.omitted.filter((o) => o.layer === 1).length === 1 && b.diagnostics.some((d) => d.code === "GUIDE_OMITTED" && d.layer === 1 && d.severity === "warning"));
  // L2 is a 6 mm strip: Rc_1 is 6.0 − 2·1.1 = 3.8 mm wide, the label region 3.8 − 2·0.3 = 3.2 mm; the box for "2" at 3 mm
  // needs 2·(1000 + 100) = 2.2 mm, so it fits (the circumscribed circle would need 3.806 mm and would not)
  check("AT-13 sheet labels are vector strokes with the sheet number, placed on sheets 1 and 2 only",
    b.guides.labels.map((l) => l.text).join() === "1,2" && b.scorePaths[0].length === 1 + SBFont.strokes("1", 3000).paths.length &&
    b.scorePaths[1].length === 1 + SBFont.strokes("2", 3000).paths.length);
  check("ASM-02/GEO-07 validate finds every score inside Rb (no GUIDE_UNCONTAINED)", SBGuides.validate([L0, L1, L2], b, cfg, ctx).length === 0);
  const tamper = JSON.parse(JSON.stringify(b)); tamper.scorePaths[0].push([0, 0, 60000, 0]);
  check("GEO-07 validate catches a score on visible material (GUIDE_UNCONTAINED, blocking)",
    SBGuides.validate([L0, L1, L2], tamper, cfg, ctx).some((d) => d.code === "GUIDE_UNCONTAINED" && d.severity === "blocking"));
  const im = SBGuides.build([L0, L1, L2], Object.assign({}, cfg, { mode: "interior-mark" }), ctx);
  check("ASM-03 interior-mark crosses sit on a checked interior point (crescent included), deterministic",
    im.scorePaths[1].length >= 2 && JSON.stringify(im) === JSON.stringify(SBGuides.build([L0, L1, L2], Object.assign({}, cfg, { mode: "interior-mark" }), ctx)));
  const z = SBGuides.build([L0, L1], Object.assign({}, cfg, { allowanceMM: 0 }), ctx);
  check("ASM-02 allowance 0 raises ALIGN_CLEARANCE_ZERO", z.diagnostics.some((d) => d.code === "ALIGN_CLEARANCE_ZERO"));
  check("UI-04 GUIDE_OMITTED aggregates per layer", SBDiag.aggregate([0, 1, 2].map((i) => SBDiag.make("GUIDE_OMITTED", { revision: 0, quality: "draft", layer: 1, parts: ["L01-P00" + i], detail: { kind: "part", reason: "x" } }))).length === 1);
  check("UI-04 a sheet-label omission is not merged into the part omissions (detail.kind label)",
    SBDiag.aggregate([SBDiag.make("GUIDE_OMITTED", { revision: 0, quality: "draft", layer: 1, parts: ["L01-P001"], detail: { kind: "part", reason: "x" } }),
      SBDiag.make("GUIDE_OMITTED", { revision: 0, quality: "draft", layer: 1, parts: [], detail: { kind: "label", sheet: 2, text: "sheet 2 label did not fit; see the placement map" } })]).length === 2);
  const top = JSON.parse(JSON.stringify(b)); top.scorePaths[2].push([5000, 5000, 6000, 5000]);
  check("GEO-07 a score path on the top sheet (no concealed area) is uncontained", SBGuides.validate([L0, L1, L2], top, cfg, ctx).some((d) => d.code === "GUIDE_UNCONTAINED"));
  // implementer additions (E.4 Review Focus 3 and the E10 open details)
  const ring = [{ outer: [30000, 5000, 50000, 5000, 50000, 25000, 30000, 25000], holes: [[32000, 7000, 32000, 23000, 48000, 23000, 48000, 7000]] }]; // 2 mm donut ring
  const Lx = mk(1, sq(5000, 5000, 20000, 20000).concat(ring, sq(54000, 30000, 1500, 1500), SBGeom.normalize(SBGeom.difference(sq(5000, 28000, 10000, 10000), sq(7000, 27000, 10000, 10000)))));
  const bx = SBGuides.build([L0, Lx], cfg, ctx), omit = bx.guides.omitted.filter((o) => o.layer === 1);
  const agg = SBDiag.aggregate(bx.diagnostics).filter((d) => d.code === "GUIDE_OMITTED" && d.layer === 1 && d.detail && d.detail.kind === "part");
  check("AT-14 crescent/donut/small part: the 2 mm donut, the 1.5 mm square and the 2 mm crescent are omitted, the block is guided",
    omit.length === 3 && bx.scorePaths[0].length === 1 + SBFont.strokes("1", 3000).paths.length && omit.every((o) => /^L01-P\d{3}$/.test(o.part) && o.reason));
  check("AT-14 one aggregated GUIDE_OMITTED warning per layer with a count", agg.length === 1 && agg[0].count === 3 && agg[0].parts.length === 3);
  check("AT-14 no score line on visible material for the omitted parts (validate clean)", SBGuides.validate([L0, Lx], bx, cfg, ctx).length === 0 &&
    bx.scorePaths[0].every((p) => p.every((v, i) => i % 2 ? true : v < 30000)));
  const Lsmall = mk(1, sq(10000, 10000, 3500, 3500));   // Rc = 1.3 mm square: the guide fits, the 2.2 × 3.2 mm label box does not
  const bs = SBGuides.build([L0, Lsmall], cfg, ctx), lo = bs.diagnostics.find((d) => d.code === "GUIDE_OMITTED" && d.detail && d.detail.kind === "label");
  check("ASM-03 a label that does not fit is GUIDE_OMITTED kind label on that sheet, pointing at the placement map; the guide stays",
    bs.guides.labels.length === 0 && bs.scorePaths[0].length === 1 && lo && lo.layer === 0 && Array.isArray(lo.parts) && lo.parts.length === 0 &&
    /placement map/.test(lo.message) && /placement map/.test(SBDiag.describe(lo).text) && bs.guides.omitted.length === 0);
  check("ASM-02 the default allowance raises no ALIGN_CLEARANCE_ZERO; allowance 0 raises exactly one",
    !b.diagnostics.some((d) => d.code === "ALIGN_CLEARANCE_ZERO") && z.diagnostics.filter((d) => d.code === "ALIGN_CLEARANCE_ZERO").length === 1);
  check("NFR-05 inset-outline build is deterministic, integer µm, rings closed",
    JSON.stringify(b) === JSON.stringify(SBGuides.build([L0, L1, L2], Object.assign({}, cfg, { mode: "inset-outline" }), ctx)) &&
    b.scorePaths.every((ps) => ps.every((p) => p.every(Number.isInteger))) && b.scorePaths[0][0][0] === b.scorePaths[0][0][b.scorePaths[0][0].length - 2] &&
    b.scorePaths[0][0][1] === b.scorePaths[0][0][b.scorePaths[0][0].length - 1]);
  check("ASM-01 the guide ring of sheet 1 is the block inset by inset + allowance + footprint/2 (17.8 mm square)",
    SBGeom.area([{ outer: b.scorePaths[0][0].slice(0, -2), holes: [] }]) === 17800 * 17800);
  const lab = b.guides.labels[1];
  check("AT-13 the label record names its sheet layer, height and centre; strokes sit in the concealed strip",
    lab.layer === 1 && lab.heightUm === 3000 && lab.atUm.every(Number.isInteger) && lab.atUm[0] - 1100 >= 6400 && lab.atUm[0] + 1100 <= 9600 &&
    b.guides.mode === "inset-outline" && b.guides.map === null);
  check("ASM-03 interior-mark validates clean and scores no ring", SBGuides.validate([L0, L1, L2], im, cfg, ctx).length === 0 &&
    im.scorePaths[0].filter((p) => p.length === 4).length >= 2 && im.guides.labels.map((l) => l.text).join() === "1,2");
  check("ASM-01 a single sheet gets no guides and no label", (() => { const o = SBGuides.build([L0], cfg, ctx); return o.scorePaths.length === 1 && o.scorePaths[0].length === 0 && o.guides.labels.length === 0 && o.diagnostics.length === 0; })());
  // E-R5: acute corners, a thick donut and a staircase must never raise GUIDE_UNCONTAINED on correct guides
  const tri = [{ outer: [2000, 2000, 30000, 4000, 6000, 30000], holes: [] }];
  const fat = [{ outer: [34000, 2000, 58000, 2000, 58000, 26000, 34000, 26000], holes: [[40000, 8000, 40000, 20000, 52000, 20000, 52000, 8000]] }];
  const stair = [{ outer: [3000, 31000, 9000, 31000, 9000, 33000, 15000, 33000, 15000, 39000, 3000, 39000], holes: [] }];
  const La = mk(1, SBGeom.normalize(tri.concat(fat, stair))), Lb = mk(2, SBGeom.normalize(SBGeom.offset(La.material, -3000, "miter")));
  check("E-R5 acute corners, a thick donut and a staircase validate clean in both modes (no false GUIDE_UNCONTAINED)",
    ["inset-outline", "interior-mark"].every((mode) => { const c2 = Object.assign({}, cfg, { mode }), g = SBGuides.build([L0, La, Lb], c2, ctx);
      return g.scorePaths[0].length > 0 && g.scorePaths[1].length > 0 && SBGuides.validate([L0, La, Lb], g, c2, ctx).length === 0; }));
  const shift = JSON.parse(JSON.stringify(b)); shift.scorePaths[0][0] = shift.scorePaths[0][0].map((v, i) => (i % 2 ? v : v + 20));
  check("GEO-07 a guide ring 20 µm past the concealed edge is caught (the rounding tolerance is far below a real excursion)",
    SBGuides.validate([L0, L1, L2], shift, cfg, ctx).some((d) => d.code === "GUIDE_UNCONTAINED" && d.layer === 0));
  const order = require("./modules.js").NODE_MODULES;
  check("T0.2 guides.js sits directly after strokefont.js", order.indexOf("guides.js") === order.indexOf("strokefont.js") + 1);
});

// ------------------------------------------------ alpha.3 E11 (stage 14 guides in generate, preview cards, controls, placement map)
suite("engine.js/svgout.js/app.js — alpha.3 E11 guides in generate (G3.1 stage 14, ASM-01/05, SUP-04, NFR-05)", () => {
  const F = require("./fixtures.js"), E = SBEngine, S = SBSchema, px = { pixels: F.heightMap(7, 200, 200), channels: 1, w: 200, h: 200, alpha: null };
  let p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); p.geometry.targetMM = 120;
  p.construction.guides.mode = "inset-outline";
  const d = E.generate(E.request(p, px, { quality: "draft" })).snapshot, f = E.generate(E.request(p, px, { quality: "fabrication" })).snapshot;
  check("G3.1 bonded generate fills scorePaths on k for k+1 parts at draft and fabrication", d.layers[0].scorePaths.length > 0 && f.layers[0].scorePaths.length > 0 && !!d.guides && !!f.guides);
  // construction.guides is already in geometryKey (js/schema.js:968-972), so comparing modes would pass without stage 14; check the hash inputs themselves
  check("NFR-05 guides are deterministic; labels/omissions enter guideHash and score paths enter layerHash",
    E.generate(E.request(p, px, { quality: "draft" })).geometryHash === d.geometryHash && E.guideHash(d.guides) !== E.guideHash(null) &&
    SBGeom.layerHashes(d.layers[0]).layerHash !== d.layers[0].canonicalHash);
  check("LYR-06 draft and fabrication agree on guide omissions and labels for a fixture well clear of the thresholds",
    JSON.stringify(d.guides.omitted.map((o) => o.layer)) === JSON.stringify(f.guides.omitted.map((o) => o.layer)) &&
    d.guides.labels.map((l) => l.text).join() === f.guides.labels.map((l) => l.text).join());
  check("GEO-07 no GUIDE_UNCONTAINED on the fixture", !f.diagnostics.some((x) => x.code === "GUIDE_UNCONTAINED") && !d.diagnostics.some((x) => x.code === "GUIDE_UNCONTAINED"));
  const files = E.fabricationFiles(f, p, "#c8a26b");
  check("ASM-01 bonded bundle contains placement_map.svg; sheet SVGs carry the scores in SCORE and no <text>",
    files.some((x) => x.name === "placement_map.svg") && /<g id="SCORE"[^>]*>\s*<path/.test(files[0].data) && files.filter((x) => /^sheet_/.test(x.name)).every((x) => !/<text/.test(x.data)));
  const c = S.defaults("acrylic"); c.interpretation.mode = "height"; c.interpretation.polarity = "white-high";
  const cs = E.generate(E.request(S.withSource(c, E.sourceRecord(px, { format: "png", decode: "raw-gray8" })), px, { quality: "draft" })).snapshot;
  check("DEP-04 connected mode gets no guides (guides null, no scores)", cs.guides === null && cs.layers.every((L) => L.scorePaths.length === 0));
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("ASM-01 guide controls exist and are bonded-only", /id="in-guides"/.test(html) && /id="in-gallow"/.test(html) && /in-guides/.test(appSrc));

  // ---- implementer additions
  const pn = JSON.parse(JSON.stringify(p)); pn.construction.guides.mode = "none";
  const dn = E.generate(E.request(pn, px, { quality: "draft" })).snapshot;
  check("ASM-01 bonded with guides mode none: build not called (guides null, no scores, no guide diagnostics)",
    dn.guides === null && dn.layers.every((L) => L.scorePaths.length === 0) && !dn.diagnostics.some((x) => /^GUIDE_|ALIGN_/.test(x.code)));
  check("ASM-01 the top exported sheet carries no score paths; scores are integer µm", (() => {
    const top = f.layers.reduce((m, L) => (L.status !== "omitted-trailing" && L.index > m ? L.index : m), 0);
    return f.layers[top].scorePaths.length === 0 && f.layers.every((L) => L.scorePaths.every((s) => s.every(Number.isInteger)));
  })());
  check("AT-13 labels name the sheet number on every sheet that has a concealed area", f.guides.labels.every((l) => l.text === String(l.layer + 1)) && f.guides.labels.length > 0);
  const im = JSON.parse(JSON.stringify(p)); im.construction.guides.mode = "interior-mark";
  const fi = E.generate(E.request(im, px, { quality: "fabrication" })).snapshot;
  check("ASM-03 interior-mark in generate validates clean and differs in layerHash from inset-outline",
    fi.guides.mode === "interior-mark" && !fi.diagnostics.some((x) => x.code === "GUIDE_UNCONTAINED") && fi.geometryHash !== f.geometryHash);
  // speed round F9: the pipeline is the runSteps generator; SBGuides.build/validate run as buildPair/validatePair batches + buildFold
  const eng = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8"), gen = eng.slice(eng.indexOf("function* runSteps("));
  const gbuild = gen.indexOf('batch("buildPair"');
  check("SUP-04/SUP-05 guides are built after the repair replay and part assignment, before accounting (rebuilt every generate)",
    eng.indexOf("function* runSteps(") > 0 && gen.indexOf("replayRepairs(") > 0 && gbuild > gen.indexOf("replayRepairs(") && gbuild > gen.indexOf("assignParts(") &&
    gbuild < gen.indexOf("trailing-empty accounting") && /Gd\.buildFold\(/.test(gen) && gen.indexOf('batch("validatePair"') > gbuild);

  // ---- E-R4: the sheet label goes in the largest concealed polygon that fits it (one polygon per placeBox attempt)
  { const sq = (x, y, w, h) => [{ outer: [x, y, x + w, y, x + w, y + h, x, y + h], holes: [] }];
    const mk = (index, material) => SBMaterial.assignParts([SBMaterial.withMaterial({ index, material: [], parts: [], diagnostics: [], scorePaths: [] }, SBGeom.normalize(material), { revision: 0, quality: "draft" })])[0];
    const B0 = mk(0, sq(0, 0, 60000, 40000)), B1 = mk(1, sq(2000, 2000, 8000, 8000).concat(sq(20000, 15000, 30000, 20000)));
    const gb = SBGuides.build([B0, B1], S.defaults("plywood").construction.guides, { revision: 0, quality: "draft" });
    const at = gb.guides.labels[0] && gb.guides.labels[0].atUm;
    check("E-R4 the sheet label is placed in the largest concealed area (not the top-most one) and validates clean",
      !!at && at[0] > 20000 && at[1] > 15000 && SBGuides.validate([B0, B1], gb, S.defaults("plywood").construction.guides, { revision: 0, quality: "draft" }).length === 0); }

  // ---- placement map (not a cut file)
  const map = SBSvg.placementMapSVG(f, { title: "Test & <map>" });
  const steps = f.stats.exported - 1;
  check("ASM-05 placementMapSVG: one panel per glue step with a heading \"Step k: place sheet k+1 on sheet k\"",
    typeof map === "string" && /^<\?xml/.test(map) && (map.match(/Step \d+: place sheet \d+ on sheet \d+/g) || []).length === steps &&
    /Step 1: place sheet 2 on sheet 1/.test(map));
  const ids = f.layers.filter((L) => L.index >= 1 && L.status !== "omitted-trailing").flatMap((L) => L.parts.map((q) => q.id));
  check("ASM-05 placement map labels every part of the placed sheet with its ID as SVG text, title escaped, A4 width",
    ids.length > 0 && ids.every((id) => map.includes(">" + id + "<")) && /Test &amp; &lt;map&gt;/.test(map) && /width="210mm"/.test(map));
  check("ASM-05 placement map: omitted-guide parts are outlined red", (() => {
    const fake = JSON.parse(JSON.stringify(f)); const L1 = fake.layers[1];
    fake.guides = Object.assign({}, fake.guides, { omitted: [{ layer: 1, part: L1.parts[0].id, reason: "x" }] });
    const m2 = SBSvg.placementMapSVG(fake, {});
    return /stroke="#e5484d"/i.test(m2) && !/stroke="#e5484d"/i.test(SBSvg.placementMapSVG(Object.assign({}, fake, { guides: Object.assign({}, fake.guides, { omitted: [] }) }), {}));
  })());
  const conFiles = (() => { const q = S.defaults("acrylic"); q.interpretation.mode = "height"; q.interpretation.polarity = "white-high";
    const r = E.generate(E.request(S.withSource(q, E.sourceRecord(px, { format: "png", decode: "raw-gray8" })), px, { quality: "fabrication" }));
    return E.fabricationFiles(r.snapshot, q, "#c8a26b"); })();
  check("ASM-05 connected bundles get no placement map", !conFiles.some((x) => x.name === "placement_map.svg"));

  // ---- schema controls (bonded only, lengths in mm)
  const b0 = S.defaults("plywood");
  const b1 = S.applyControl(b0, "guides", "interior-mark");
  check("ASM-01 applyControl guides sets construction.guides.mode (revision + 1); an unknown mode is unchanged",
    b1.construction.guides.mode === "interior-mark" && b1.revision === b0.revision + 1 && S.applyControl(b0, "guides", "bogus").revision === b0.revision);
  const b2 = S.applyControl(S.applyControl(S.applyControl(S.applyControl(b0, "gconceal", "0.8"), "gallow", "0"), "gfoot", "0.3"), "glabel", "4");
  check("ASM-02 applyControl gconceal/gallow/gfoot/glabel write the guide distances in mm",
    b2.construction.guides.concealInsetMM === 0.8 && b2.construction.guides.allowanceMM === 0 && b2.construction.guides.markFootprintMM === 0.3 && b2.construction.guides.labelHeightMM === 4);
  const bi = Object.assign(JSON.parse(JSON.stringify(b0)), { units: "in" });
  check("ASM-02 guide distances follow project.units (0.02 in = 0.508 mm)", S.applyControl(bi, "gallow", "0.02").construction.guides.allowanceMM === 0.508);
  const a0 = S.defaults("acrylic");
  check("ASM-01 guide controls are refused in connected mode (unchanged)", S.applyControl(a0, "guides", "inset-outline").revision === a0.revision &&
    S.applyControl(a0, "gallow", "1").revision === a0.revision);
  const cv = S.controlValues(b2);
  check("ASM-01 controlValues shows the guide settings", cv["in-guides"] === "inset-outline" && cv["in-gconceal"] === "0.8" && cv["in-gallow"] === "0" &&
    cv["in-gfoot"] === "0.3" && cv["in-glabel"] === "4");
  const apC = S.applicability(a0), apB = S.applicability(b0), bNone = S.applyControl(b0, "guides", "none"), apN = S.applicability(bNone);
  check("UI-01 guide controls are disabled with a reason in connected mode and enabled in bonded",
    ["in-guides", "in-gconceal", "in-gallow", "in-gfoot", "in-glabel"].every((id) => typeof apC[id] === "string" && apB[id] === null));
  check("UI-01 guide distances are disabled while guides are off; the mode select stays enabled",
    apN["in-guides"] === null && ["in-gconceal", "in-gallow", "in-gfoot", "in-glabel"].every((id) => typeof apN[id] === "string"));

  // ---- preview and app wiring
  const pv = fs.readFileSync(path.join(__dirname, "..", "js", "preview.js"), "utf8");
  const pfn = (name) => { const i = pv.indexOf("function " + name + "("); return i < 0 ? "" : pv.slice(i, pv.indexOf("\n    }\n", i)); };
  check("ASM-01 drawCard draws layer.scorePaths only with opts.scores; the Proof, Section and Tilt never draw them",
    /scorePaths/.test(pfn("drawCard")) && /opts\.scores/.test(pfn("drawCard")) && !/scorePaths/.test(pfn("drawLayers")) && !/scorePaths/.test(pfn("drawSection")) && !/scorePaths/.test(pfn("draw")));
  check("E-R10 the Layers cards carry the draft guide legend and the #in-guidesvis toggle",
    /Guides \(approximate at draft; exact in the fabrication preview\)/.test(appSrc) && /id="in-guidesvis"[^>]*checked/.test(html) && /scores:/.test(appSrc));
  check("ASM-01 every guide control is wired through SBSchema.applyControl", ["guides", "gconceal", "gallow", "gfoot", "glabel"].every((id) => new RegExp('"' + id + '"').test(appSrc)) &&
    ["in-gconceal", "in-gfoot", "in-glabel"].every((id) => new RegExp('id="' + id + '"').test(html)));
  const ug = fs.readFileSync(path.join(__dirname, "..", "docs", "USER_GUIDE.md"), "utf8");
  check("ASM-05 USER_GUIDE explains GUIDE_OMITTED (place that part by the placement map)", /GUIDE_OMITTED/.test(ug) && /place that part by the placement map/.test(ug));
});

// ------------------------------------------------ speed round F0 (plan Appendix F): pool-equality golden corpus, module-state audit
suite("engine — speed round F0 golden corpus (NFR-05)", () => {
  const C = require("./pool_corpus.js"), E = SBEngine, S = SBSchema, SLOW = process.argv.includes("--slow");
  const GOLD = path.join(__dirname, "golden", "pool-equality.json");
  const all = C.corpus(), ids = all.map((fx) => fx.id);
  check("F0 corpus API (corpus, run, digest, deepEqualStrict) and unique fixture ids",
    typeof C.corpus === "function" && typeof C.run === "function" && typeof C.digest === "function" && typeof C.deepEqualStrict === "function" && new Set(ids).size === ids.length);
  check("F0 every fixture pins geometry.draftPx and draftCapPx (integer, draftPx ≤ draftCapPx ≤ today's device cap, so the cap never binds)",
    all.every((fx) => Number.isInteger(fx.draftCapPx) && Number.isInteger(fx.project.geometry.draftPx) && fx.project.geometry.draftPx <= fx.draftCapPx &&
      fx.draftCapPx <= S.limits(fx.deviceClass).draftPxCap));
  check("F0 every fixture project validates and its source matches project.source (w, h, channels, sampleHash)",
    all.every((fx) => S.validate(fx.project).ok && fx.project.source.w === fx.source.w && fx.project.source.h === fx.source.h &&
      fx.project.source.channels === fx.source.channels && fx.project.source.sampleHash === SBHash.sha256(E.sampleBytes(fx.source))));
  const P = (fx) => fx.project, con = (fx) => P(fx).construction;
  const covered = {
    "draft and fabrication": ["draft", "fabrication"].every((q) => all.some((fx) => fx.quality === q)),
    "height and tonal": ["height", "tonal"].every((m) => all.some((fx) => P(fx).interpretation.mode === m)),
    "light-front and dark-front": ["light-front", "dark-front"].every((m) => all.some((fx) => P(fx).interpretation.polarity === m)),
    "bonded and connected (smooth)": all.some((fx) => con(fx).mode === "bonded-relief") && all.some((fx) => con(fx).mode === "connected-sheet" && con(fx).cleanup.cornerStyle === "smooth"),
    "frame on and off, registration holes": all.some((fx) => con(fx).frame.enabled) && all.some((fx) => !con(fx).frame.enabled) && all.some((fx) => con(fx).registration.enabled && con(fx).frame.enabled && con(fx).mode === "connected-sheet"),
    "replayed repair": all.some((fx) => con(fx).repairs.length === 1),
    "guides none / inset-outline / interior-mark": ["none", "inset-outline", "interior-mark"].every((g) => all.some((fx) => con(fx).mode === "bonded-relief" && con(fx).guides.mode === g)),
    "alpha domain": all.some((fx) => fx.source.alpha && P(fx).source.alpha.mode === "threshold" && P(fx).interpretation.mode === "tonal" && P(fx).interpretation.smoothing.radiusMM > 0),
    "N = 2, 3, 8, 12": [2, 3, 8, 12].every((n) => all.some((fx) => con(fx).sheets === n)),
    "simplify busy": all.some((fx) => con(fx).cleanup.simplify === "busy"),
    "mobile deviceClass": all.some((fx) => fx.deviceClass === "mobile"),
    "overlays off": all.some((fx) => fx.quality === "draft" && fx.overlays === false),
    "odd rasters 1 × N and 3 × 2": all.some((fx) => fx.source.w === 1) && all.some((fx) => fx.source.w === 3 && fx.source.h === 2),
    "alpha.3 scene 900 × 675 and 1800 × 1350 (slow)": all.some((fx) => fx.source.w === 900 && fx.source.h === 675) && all.some((fx) => fx.source.w === 1800 && fx.source.h === 1350 && fx.slow),
  };
  const miss = Object.keys(covered).filter((k) => !covered[k]);
  check("F0 the corpus covers the Step 1 matrix" + (miss.length ? " (missing: " + miss.join("; ") + ")" : ""), miss.length === 0);
  check("F0 fixtures above " + C.SLOW_PX / 1e6 + " Mpx (and only those) are tagged slow", all.every((fx) => fx.slow === fx.source.w * fx.source.h > C.SLOW_PX));
  // deepEqualStrict semantics (F9/F12/F16 live comparisons)
  const D = C.deepEqualStrict;
  check("F0 deepEqualStrict: equal values, -0 ≠ 0, NaN = NaN, undefined key ≠ missing key, key order ignored",
    D({ a: [1, { b: "x" }], c: null }, { c: null, a: [1, { b: "x" }] }) && !D({ a: -0 }, { a: 0 }) && D({ a: NaN }, { a: NaN }) && !D({ a: undefined }, {}) && !D({}, { a: undefined }));
  check("F0 deepEqualStrict: typed arrays by constructor and bytes; array length and extra properties count",
    D(new Uint8Array([1, 2]), new Uint8Array([1, 2])) && !D(new Uint8Array([1, 2]), new Int8Array([1, 2])) && !D(new Float32Array([0]), new Float32Array([-0])) &&
    !D([1, 2], [1, 2, undefined]) && !D(Object.assign([1], { x: 1 }), [1]) && !D([1], { 0: 1, length: 1 }));
  check("F0 digest has the documented fields", (() => { const d = C.digest({ status: "error", error: { code: "X", message: "m" }, diagnostics: [] });
    return JSON.stringify(Object.keys(d)) === JSON.stringify(["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"]) && d.code === "X" && d.geometryHash === null; })());
  check("F0 wholeSha ignores requestId and timing only", (() => { const r = { requestId: "a", status: "done", diagnostics: [] };
    const a = C.digest(r).wholeSha; return a === C.digest(Object.assign({}, r, { requestId: "b", timing: { ms: 1 } })).wholeSha && a !== C.digest(Object.assign({}, r, { revision: 1 })).wholeSha; })());
  // the golden
  let gold = null;
  try { gold = JSON.parse(fs.readFileSync(GOLD, "utf8")); } catch (e) { gold = null; }
  check("F0 test/golden/pool-equality.json exists, names this engine version and covers exactly the corpus ids (slow tags equal)",
    !!gold && gold.engineVersion === E.VERSION && JSON.stringify(Object.keys(gold.fixtures).sort()) === JSON.stringify(ids.slice().sort()) &&
    all.every((fx) => gold.fixtures[fx.id].slow === fx.slow));
  if (!gold) return;
  const run = all.filter((fx) => SLOW || !fx.slow), bad = [], noBranch = [], live = new Map(), pcBlocking = [], pcStillBlocked = [];
  // G2 blocked these only on PART_POINT_CONTACT (the other G2 ids block on SAMPLING_LOW, or on NECK_KERF: fine-pitch-fabrication)
  const PC_ONLY = ["a3-900-draft", "a3-900-fabrication", "a3-900-nooverlay-draft", "a3-1800-draft", "a3-1800-fabrication", "alpha-domain-draft", "alpha-domain-fabrication"];
  const fields = ["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"];
  for (const fx of run) {
    const r = C.run(fx), d = C.digest(r), g = gold.fixtures[fx.id];
    if (!g || fields.some((k) => JSON.stringify(d[k]) !== JSON.stringify(g[k]))) bad.push(fx.id + (g ? " [" + fields.filter((k) => JSON.stringify(d[k]) !== JSON.stringify(g[k])).join(",") + "]" : ""));
    if (!fx.expect(r)) noBranch.push(fx.id);
    if (live.size < 3 && !fx.slow && fx.source.w * fx.source.h <= 60000) live.set(fx.id, r);
    const ds = r.diagnostics || [];   // G2 decision 2026-10-10: PART_POINT_CONTACT is a warning
    if (ds.some((x) => x.code === "PART_POINT_CONTACT" && x.severity !== "warning")) pcBlocking.push(fx.id);
    if (PC_ONLY.includes(fx.id) && (!ds.some((x) => x.code === "PART_POINT_CONTACT") || ds.some((x) => x.severity === "blocking"))) pcStillBlocked.push(fx.id);
  }
  check("G2 decision 2026-10-10: no corpus fixture reports PART_POINT_CONTACT as blocking" + (pcBlocking.length ? " — " + pcBlocking.join(", ") : ""), pcBlocking.length === 0);
  check("G2 decision 2026-10-10: the fixtures that blocked only on PART_POINT_CONTACT keep it as a warning and no longer block" +
    (pcStillBlocked.length ? " — " + pcStillBlocked.join(", ") : ""), pcStillBlocked.length === 0 && run.some((fx) => PC_ONLY.includes(fx.id)));
  check("NFR-05 F0 every corpus response digest equals test/golden/pool-equality.json" + (SLOW ? " (incl. slow)" : " (" + run.length + " of " + all.length + "; --slow runs all)") +
    (bad.length ? " — differ: " + bad.join("; ") : ""), bad.length === 0 && run.length > 0);
  check("F0 every fixture still exercises its branch (expect predicate)" + (noBranch.length ? " — not: " + noBranch.join(", ") : ""), noBranch.length === 0);
  // hidden-state audit, dynamic half: after the whole corpus has run (call history), the small fixtures re-run in
  // reverse order and give deepEqualStrict responses (no module-level state that depends on call history)
  const again = [...live.keys()].reverse().filter((id) => !C.deepEqualStrict(live.get(id), C.run(all.find((fx) => fx.id === id))));
  check("NFR-05 F0 audit: re-running fixtures after the corpus (reverse order) gives deepEqualStrict responses" + (again.length ? " — differ: " + again.join(", ") : ""),
    live.size >= 2 && again.length === 0);
});

suite("js/* — speed round F0 module-state audit (NFR-05)", () => {
  const MODS = require("./modules.js").NODE_MODULES, src = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
  const own = MODS.filter((f) => !f.startsWith("vendor/"));
  // static half: no module-level let/var (top level of each module's IIFE is two-space indented; column-0 declarations too)
  const topLet = own.filter((f) => /^(?: {2})?(?:let|var) /m.test(src(f)));
  check("NFR-05 F0 audit: no module-level let/var in the pure modules" + (topLet.length ? " — found in " + topLet.join(", ") : ""), topLet.length === 0);
  // every exported data value is deep-frozen (functions and getters excepted; SBEngine.TEST_HOOKS is a primitive flag)
  const deepFrozen = (v, seen) => {
    if (v === null || (typeof v !== "object" && typeof v !== "function")) return true;
    if (seen.has(v)) return true; seen.add(v);
    if (typeof v === "function") return true;
    if (ArrayBuffer.isView(v) || !Object.isFrozen(v)) return false;
    return Reflect.ownKeys(v).every((k) => { const d = Object.getOwnPropertyDescriptor(v, k); return !("value" in d) || deepFrozen(d.value, seen); });
  };
  const globals = Object.keys(globalThis).filter((k) => /^SB[A-Z]/.test(k));
  const open = [];
  for (const n of globals) for (const k of Reflect.ownKeys(globalThis[n])) {
    const d = Object.getOwnPropertyDescriptor(globalThis[n], k);
    if ("value" in d && typeof d.value !== "function" && !deepFrozen(d.value, new Set())) open.push(n + "." + String(k));
  }
  check("NFR-05 F0 audit: every exported data value of the pure modules is deep-frozen" + (open.length ? " — mutable: " + open.join(", ") : ""), globals.length >= 20 && open.length === 0);
  const cl = src("vendor/clipper2.js");
  const statics = (cl.match(/static [A-Za-z_$]+=/g) || []).map((s) => s.slice(7, -1)).sort();
  check("NFR-05 F0 audit: clipper2 static fields are the five recorded in ARCHITECTURE.md (openPathsEnabled, _intResult reset per call; constants)",
    JSON.stringify(statics) === JSON.stringify(["Tolerance", "_intResult", "arc_const", "maxSafeDelta", "openPathsEnabled"].sort()) &&
    /\.openPathsEnabled=this\.hasOpenPaths/.test(cl) && !/rectClip|RectClip/.test(src("geom.js")));
  const arch = fs.readFileSync(path.join(__dirname, "..", "docs", "ARCHITECTURE.md"), "utf8"), sec = (arch.split(/^## Speed round \(Appendix F\)/m)[1] || "").split(/^## /m)[0];
  const audited = ["geom.js", "vendor/clipper2.js", "trace.js", "morph.js", "support.js", "guides.js", "strokefont.js", "construct.js", "material.js", "islands.js", "raster.js", "height.js", "diag.js", "util.js", "engine.js"];
  check("NFR-05 F0 ARCHITECTURE.md speed-round section records every audited module as pure or per-call reset",
    audited.every((f) => new RegExp("`js/" + f.replace(/[.\/]/g, (c) => "\\" + c) + "`[^\\n]*\\b(pure|per-call reset)\\b").test(sec)) && /_intResult/.test(sec) && /TEST_HOOKS/.test(sec));
});

// ------------------------------------------------ speed round F1 (plan Appendix F, S4/F-D1): SAMPLING_LOW on the fabrication plan
suite("support/engine — speed round F1 sampling on the fabrication plan (GEO-06, PO-PERF-4)", () => {
  const S = SBSchema, E = SBEngine, F = require("./fixtures.js");
  const base = { minFeatureMM: 1.5, mmPerPxMax: 0.55, calibrated: true };
  const codes = (ds) => ds.map((d) => d.code);
  check("F1 featureChecks without samplingMmPerPx is unchanged (0.55 mm/px → SAMPLING_LOW)",
    codes(SBSupport.featureChecks([], base)).includes("SAMPLING_LOW"));
  check("F1 samplingMmPerPx 0.1 judges the fabrication pitch (no SAMPLING_LOW)",
    !codes(SBSupport.featureChecks([], { ...base, samplingMmPerPx: 0.1 })).includes("SAMPLING_LOW"));
  check("F1 samplingMmPerPx 0.6 still blocks (measured = 2.5 fabrication samples, limit 3)", (() => {
    const d = SBSupport.featureChecks([], { ...base, mmPerPxMax: 0.1, samplingMmPerPx: 0.6 }).find((x) => x.code === "SAMPLING_LOW");
    return !!d && d.severity === "blocking" && d.measured.value === 2.5 && d.limit.value === 3; })());
  check("F1 featureChecks rejects a non-finite or non-positive samplingMmPerPx",
    [0, -1, NaN, Infinity, "0.1"].every((v) => { try { SBSupport.featureChecks([], { ...base, samplingMmPerPx: v }); return false; } catch (e) { return true; } }));
  check("F1 DRAFT_COARSER registered as info (no ack), with title and fix",
    !!SBDiag.CODES.DRAFT_COARSER && SBDiag.CODES.DRAFT_COARSER.severity === "info" && !!SBDiag.CODES.DRAFT_COARSER.title && !!SBDiag.CODES.DRAFT_COARSER.fix &&
    SBDiag.make("DRAFT_COARSER", {}).ackState === "n/a");
  check("F1 featureChecks: DRAFT_COARSER at draft when only the draft pitch is short (measured = draft samples, limit 3, fabrication pitch in detail)", (() => {
    const ds = SBSupport.featureChecks([], { ...base, samplingMmPerPx: 0.1, quality: "draft" }), d = ds.find((x) => x.code === "DRAFT_COARSER");
    return !!d && d.severity === "info" && d.ackState === "n/a" && Math.abs(d.measured.value - 1.5 / 0.55) < 1e-8 && d.limit.value === 3 && /draft is coarser than fabrication; detail is checked at the fabrication pitch \(0\.1 mm\/px, 15 samples\)/.test(d.message) && !codes(ds).includes("SAMPLING_LOW"); })());
  check("F1 no DRAFT_COARSER at fabrication quality, when the draft is fine, or when the fabrication plan is short too",
    !codes(SBSupport.featureChecks([], { ...base, samplingMmPerPx: 0.1, quality: "fabrication" })).includes("DRAFT_COARSER") &&
    !codes(SBSupport.featureChecks([], { ...base, mmPerPxMax: 0.4, samplingMmPerPx: 0.1, quality: "draft" })).includes("DRAFT_COARSER") &&
    !codes(SBSupport.featureChecks([], { ...base, samplingMmPerPx: 0.6, quality: "draft" })).includes("DRAFT_COARSER"));
  const w = 1024, h = 771, px = { pixels: F.heightMap(2022, w, h), channels: 1, w, h, alpha: null };
  let p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" }));
  p.geometry.sizeBy = "height"; p.geometry.targetMM = 300;
  const d = E.generate(E.request(p, px, { quality: "draft" }));
  check("PO-PERF-4 default plywood draft: no blocking SAMPLING_LOW, DRAFT_COARSER info present",
    d.status === "done" && !codes(d.diagnostics).includes("SAMPLING_LOW") && d.diagnostics.some((x) => x.code === "DRAFT_COARSER" && x.severity === "info"));
  const q = JSON.parse(JSON.stringify(p)); q.geometry.fabPitchMM = 0.6;
  check("GEO-06 a coarse fabrication pitch still blocks at draft and at fabrication",
    ["draft", "fabrication"].every((qq) => codes(E.generate(E.request(q, px, { quality: qq })).diagnostics).includes("SAMPLING_LOW")));
  // geometryHash/layerHashes unchanged: the F0 golden's re-captured fixtures differ from their previous digests only in
  // diagSha/wholeSha (capture_golden --recapture records the previous digests).
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
  const f1 = (gold.recaptured || []).find((r) => r.task === "F1");
  const keep = ["status", "code", "geometryHash", "layerHashes", "cleanupSha", "supportSha", "guidesSha", "statsSha"];
  // Appendix G G-D6: F1's ids may be re-captured again later; compare F1's previous digest with what F1 produced
  const after = (task, id) => { const recs = gold.recaptured || [], i = recs.findIndex((r) => r.task === task);
    const later = recs.slice(i + 1).find((r) => r.ids.includes(id)); return later ? later.previous[id] : gold.fixtures[id]; };
  const off = f1 ? f1.ids.filter((id) => !f1.previous || !f1.previous[id] || keep.some((k) => JSON.stringify(f1.previous[id][k]) !== JSON.stringify(after("F1", id)[k])) ||
    f1.previous[id].diagSha === after("F1", id).diagSha) : ["(no F1 recapture record)"];
  check("F-D1 F1 re-captured golden ids differ from their previous digests only in diagSha/wholeSha" + (off.length ? " — " + off.join(", ") : ""),
    !!f1 && f1.ids.length > 0 && off.length === 0 && Object.keys(f1.previous).sort().join() === f1.ids.slice().sort().join());
});

// ------------------------------------------------ speed round F3 (plan Appendix F, S5): streaming exact area resample, row bands
suite("raster — speed round F3 streaming resample (NFR-05)", () => {
  const R = SBRaster, { oracleResample } = require("./oracle_kernels.js");
  check("F3 SBRaster.resampleRows exists", typeof R.resampleRows === "function");
  if (typeof R.resampleRows !== "function") return;
  let seed = 0x5eed_f3;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const codeOf = (f) => { try { f(); return null; } catch (e) { return e.code || "?"; } };
  const same = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
  const PRIMES = [2, 3, 5, 7, 11, 13];
  const target = (n, mode) => {
    if (mode === 0) return n;                                            // identity on this axis
    if (mode === 1) { const p = PRIMES[ri(0, PRIMES.length - 1)]; return Math.max(1, Math.floor(n / p)); } // prime ratio
    return ri(1, n);
  };
  let cases = 0, eq = 0, bandsOk = 0, bandCases = 0, nonId = 0;
  for (let t = 0; t < 400; t++) {
    const w = ri(1, 97), h = ri(1, 83), c = ri(1, 4), px = new Uint8Array(w * h * c);
    for (let i = 0; i < px.length; i++) px[i] = t % 5 === 0 ? (rnd() < 0.5 ? 0 : 255) : ri(0, 255);
    const mx = t % 3, my = (t >> 1) % 3, W = target(w, mx), H = target(h, my);
    for (const method of ["area", "nearest", "none"]) {
      if (method === "none" && (W !== w || H !== h)) continue;
      cases++;
      if (W !== w || H !== h) nonId++;
      const got = R.resample(px, c, w, h, W, H, method), want = oracleResample(px, c, w, h, W, H, method);
      if (same(got, want)) eq++;
      const nb = 1 + (t % 9);
      if (nb <= H) {
        bandCases++;
        const parts = [], cuts = [0];
        for (let b = 1; b < nb; b++) cuts.push(Math.floor((b * H) / nb));
        cuts.push(H);
        for (let b = 0; b < nb; b++) parts.push(R.resampleRows(px, c, w, h, W, H, method, cuts[b], cuts[b + 1]));
        const cat = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
        let o = 0; for (const p of parts) { cat.set(p, o); o += p.length; }
        if (same(cat, want) && parts.every((p, b) => p.length === (cuts[b + 1] - cuts[b]) * W * c)) bandsOk++;
      }
    }
  }
  check(`F3 resample == oracleResample byte-for-byte (${eq}/${cases} cases, ${nonId} non-identity; sizes 1–97 × 1–83, c 1–4, prime ratios)`, eq === cases && nonId > 100);
  check(`F3 resampleRows bands (1..9) concatenated == whole (${bandsOk}/${bandCases})`, bandsOk === bandCases && bandCases > 300);
  // full-range resampleRows equals resample; empty band
  const px = Uint8Array.from({ length: 31 * 29 * 3 }, (_, i) => (i * 37) & 255);
  check("F3 resampleRows(…, 0, H) == resample; an empty band is empty",
    same(R.resampleRows(px, 3, 31, 29, 7, 5, "area", 0, 5), R.resample(px, 3, 31, 29, 7, 5, "area")) &&
    R.resampleRows(px, 3, 31, 29, 7, 5, "area", 2, 2).length === 0);
  check("F3 upsampling throws RESAMPLE_UPSAMPLE in both", ["area", "nearest"].every((m) =>
    codeOf(() => R.resample(px, 3, 31, 29, 32, 5, m)) === "RESAMPLE_UPSAMPLE" && codeOf(() => oracleResample(px, 3, 31, 29, 32, 5, m)) === "RESAMPLE_UPSAMPLE" &&
    codeOf(() => R.resampleRows(px, 3, 31, 29, 7, 30, m, 0, 1)) === "RESAMPLE_UPSAMPLE" && codeOf(() => oracleResample(px, 3, 31, 29, 7, 30, m)) === "RESAMPLE_UPSAMPLE"));
  check("F3 error codes unchanged vs the oracle (method, channels, sizes, short buffer, none with a new size)",
    [[px, 3, 31, 29, 7, 5, "cubic"], [px, 5, 31, 29, 7, 5, "area"], [px, 3, 0, 29, 7, 5, "area"], [px.subarray(0, 10), 3, 31, 29, 7, 5, "area"], [px, 3, 31, 29, 7, 5, "none"]]
      .every((a) => codeOf(() => R.resample(...a)) === codeOf(() => oracleResample(...a)) && codeOf(() => oracleResample(...a)) !== null));
  check("F3 resampleRows rejects a bad band (Y0 > Y1, Y1 > H, negative, non-integer) with RESAMPLE_SIZE",
    [[3, 2], [0, 6], [-1, 2], [0.5, 2]].every(([a, b]) => codeOf(() => R.resampleRows(px, 3, 31, 29, 7, 5, "area", a, b)) === "RESAMPLE_SIZE"));
  // the fast rounding Math.floor((2v + D) / 2D) used while 512·D < 2^53 equals exact half-up division (BigInt), at the
  // half-way points and one off them, for D up to the bound
  check("F3 float half-up rounding == exact BigInt half-up near every tie (D up to 2^53/512)", (() => {
    const lim = Math.floor(Number.MAX_SAFE_INTEGER / 512);
    for (let t = 0; t < 4000; t++) {
      const D = t < 2000 ? ri(1, 1 << 30) : lim - ri(0, 1 << 20), D2 = 2 * D, k = ri(0, 255);
      for (const v of [k * D, k * D + Math.floor(D / 2), k * D + Math.ceil(D / 2), k * D + Math.ceil(D / 2) - 1, k * D + D - 1].filter((x) => x <= 255 * D)) {
        const want = Number((2n * BigInt(v) + BigInt(D)) / (2n * BigInt(D)));
        if (Math.floor((2 * v + D) / D2) !== want) return false;
      }
    }
    return true; })());
  check("F3 resample does not alias its input (identity returns a copy)", (() => { const o = R.resample(px, 3, 31, 29, 31, 29, "area"); return o.buffer !== px.buffer && same(o, px); })());
});

// ------------------------------------------------ speed round F4 (plan Appendix F, S5): windowAny, fused erode/dilate, fused morph
suite("morph — speed round F4 windowAny, erode/dilate, fused dilations (NFR-05)", () => {
  const M = SBMorph, { oracleMorph: O } = require("./oracle_kernels.js");
  const same = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
  const OPS = ["dilate", "erode", "open", "close"];
  // exhaustive: every 4 × 4 and 5 × 3 (and 3 × 5) mask, r = 0..4, all four ops; inputs must not be mutated
  for (const [w, h] of [[4, 4], [5, 3], [3, 5]]) {
    let total = 0, eq = 0, intact = true;
    const n = w * h, m = new Uint8Array(n);
    for (let bits = 0; bits < 1 << n; bits++) {
      for (let i = 0; i < n; i++) m[i] = (bits >> i) & 1;
      const before = m.slice();
      for (let r = 0; r <= 4; r++) for (const op of OPS) {
        total++;
        if (same(M[op](m, w, h, r), O[op](m, w, h, r))) eq++;
      }
      if (!same(m, before)) intact = false;
    }
    check(`F4 exhaustive ${w} × ${h}: dilate/erode/open/close == oracle for r 0..4 (${eq}/${total})`, eq === total);
    check(`F4 exhaustive ${w} × ${h}: inputs not mutated`, intact);
    // the fused open(r) → close(r2) = erode_r → dilate_{r+r2} → erode_{r2}, exhaustively, r and r2 in 1..4
    let ft = 0, fe = 0;
    for (let bits = 0; bits < 1 << n; bits++) {
      for (let i = 0; i < n; i++) m[i] = (bits >> i) & 1;
      for (let r = 1; r <= 4; r++) for (let r2 = 1; r2 <= 4; r2++) { ft++; if (same(M.openClose(m, w, h, r, r2), O.close(O.open(m, w, h, r), w, h, r2))) fe++; }
    }
    check(`F4 exhaustive ${w} × ${h}: SBMorph.openClose(r, r2) == oracle close(open(r), r2), r, r2 1..4 (${fe}/${ft})`, typeof M.openClose === "function" && fe === ft);
  }
  let seed = 0x5eed_f4;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const randMask = (w, h, dens, val) => { const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = rnd() < dens ? val : 0; return m; };
  // random: 64 × 48 plus thin and tiny shapes (w < 3, h < 3), r up to beyond the size, values 1 and 255 (nonzero = set)
  let total = 0, eq = 0, aliasFree = true;
  for (let t = 0; t < 600; t++) {
    const kind = t % 4, w = kind === 0 ? 64 : kind === 1 ? ri(1, 2) : ri(1, 70), h = kind === 0 ? 48 : kind === 2 ? ri(1, 2) : ri(1, 60);
    const m0 = randMask(w, h, [0.02, 0.3, 0.5, 0.8, 0.98][t % 5], t % 7 === 0 ? 255 : 1), off = t % 4;
    // off > 0: the mask is an unaligned view (byteOffset 1..3), so the word-skipping row scan takes its byte path
    const m = off ? (() => { const b = new Uint8Array(m0.length + off); b.set(m0, off); return b.subarray(off); })() : m0;
    const rs = [0, 1, 2, 3, ri(4, 12), w, w + ri(0, 5), h + ri(0, 5)];
    for (const r of rs) for (const op of OPS) {
      total++;
      const got = M[op](m, w, h, r);
      if (same(got, O[op](m, w, h, r))) eq++;
      if (got.buffer === m.buffer) aliasFree = false;
    }
  }
  check(`F4 random masks (64 × 48, w < 3, h < 3, r ≥ w, values 1/255, unaligned views) == oracle (${eq}/${total})`, eq === total);
  check("F4 results never alias the input", aliasFree);
  // the construct morph chain (open → close(max(1, r − 1)) → removeSpecks → fillHoles), fused dilations, featR 0..9
  check("F4 SBConstruct._morph test hook exists", typeof SBConstruct._morph === "function");
  if (typeof SBConstruct._morph !== "function") return;
  let mc = 0, meq = 0;
  for (let t = 0; t < 160; t++) {
    const w = t % 8 === 0 ? ri(1, 4) : ri(20, 90), h = t % 8 === 1 ? ri(1, 4) : ri(20, 70), featR = t % 10, cull = t % 3 === 0;
    const m = randMask(w, h, [0.15, 0.4, 0.6, 0.85][t % 4], t % 5 === 0 ? 255 : 1), keep = m.slice();
    const px = { featR, speckPx: ri(0, 30), holePx: ri(0, 60) };
    const a = SBConstruct._morph(m, w, h, px, cull), b = O.morph(M, m, w, h, px, cull);
    mc++;
    if (same(a.m, b.m) && a.specks === b.specks && a.holes === b.holes && same(m, keep)) meq++;
  }
  check(`F4 construct morph (fused erode → dilate(r + r') → erode(r')) == oracle chain, featR 0..9 (${meq}/${mc})`, meq === mc);
});

// ------------------------------------------------ speed round F5 (plan Appendix F, S5): run-based fillHoles / removeSpecks
suite("morph — speed round F5 run-based hole filling and speck removal (NFR-05)", () => {
  const M = SBMorph, C = SBConstruct, { oracleComponents: OC, oracleConstruct: OK, oracleMorph: O } = require("./oracle_kernels.js");
  const same = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
  check("F5 SBMorph.runComponents exists", typeof M.runComponents === "function");
  let seed = 0x5eed_f5;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  // blobby masks (a coarse random field upsampled) give real holes and specks of many sizes, not just salt-and-pepper
  const randMask = (w, h, dens, val, blob) => {
    const m = new Uint8Array(w * h), cs = blob ? ri(2, 6) : 1, cw = Math.ceil(w / cs) + 1, f = new Float64Array(cw * (Math.ceil(h / cs) + 1));
    for (let i = 0; i < f.length; i++) f[i] = rnd();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (blob ? f[((y / cs) | 0) * cw + ((x / cs) | 0)] * 0.8 + rnd() * 0.2 : rnd()) < dens ? val : 0;
    return m;
  };
  const view = (m0, off) => { if (!off) return m0; const b = new Uint8Array(m0.length + off); b.set(m0, off); return b.subarray(off); };
  // 200 seeded masks, 1 × 1 to 120 × 90, densities 0.05–0.95, all-0 and all-1, some with value 255 and unaligned views;
  // removeSpecks and fillHoles at several limits: return counts and the mutated masks byte-equal to the oracle
  let total = 0, eq = 0, rcTotal = 0, rcEq = 0;
  for (let t = 0; t < 200; t++) {
    const w = t < 8 ? [1, 1, 2, 3, 120, 7, 1, 90][t] : ri(1, 120), h = t < 8 ? [1, 5, 1, 3, 90, 1, 9, 2][t] : ri(1, 90);
    const dens = t % 11 === 0 ? 0 : t % 11 === 1 ? 1.01 : 0.05 + 0.9 * rnd();
    const m0 = randMask(w, h, dens, t % 13 === 5 ? 255 : 1, t % 2 === 0);
    for (const lim of [0, 1, 2, 3, 5, ri(6, 40), ri(41, 400), w * h + 1]) for (const op of ["removeSpecks", "fillHoles"]) {
      total++;
      const a = view(m0.slice(), t % 4), b = m0.slice();
      const ra = M[op](a, w, h, lim), rb = OC[op](b, w, h, lim);
      if (ra === rb && same(a, b)) eq++;
    }
    if (typeof M.runComponents === "function") for (const v of [0, 1]) {
      rcTotal++;
      const bin = m0.map((x) => (x ? 1 : 0)), r = M.runComponents(view(bin, t % 3), w, h, v);
      if (r.count === OC.components(bin, w, h, v).count) rcEq++;
    }
  }
  check(`F5 removeSpecks/fillHoles == oracle: counts and masks (200 masks × 8 limits × 2 ops, ${eq}/${total})`, eq === total);
  check(`F5 SBMorph.runComponents(value 0/1).count == oracle components count (${rcEq}/${rcTotal})`, rcTotal === 400 && rcEq === rcTotal);
  // value 1 is "nonzero" (construct's runComponents contract): counts equal the pre-F5 construct runComponents on 0/255 masks
  if (typeof M.runComponents === "function") {
    let n = 0, ok = 0;
    for (let t = 0; t < 60; t++) { const w = ri(1, 80), h = ri(1, 60), m = randMask(w, h, rnd(), t % 2 ? 255 : 1, true); n++; if (M.runComponents(m, w, h, 1).count === OK.runComponents(m, w, h).count) ok++; }
    check(`F5 SBMorph.runComponents(…, 1) counts nonzero components as construct's runComponents did (${ok}/${n})`, ok === n);
  }
  // construct: estimateComplexity, simplifyBusy and complexityGate unchanged (runComponents delegated to SBMorph)
  let ce = 0, cn = 0;
  for (let t = 0; t < 40; t++) {
    const w = ri(8, 110), h = ri(8, 80), N = ri(2, 6), masks = [];
    for (let k = 0; k < N; k++) masks.push(randMask(w, h, 0.2 + 0.6 * rnd(), 1, t % 3 !== 0));
    const est = C.estimateComplexity(masks, w, h), parts = masks.map((m) => OK.runComponents(m, w, h).count);
    cn++; if (JSON.stringify(est) === JSON.stringify({ partsPerLayer: parts, maxPartsPerLayer: Math.max(...parts) })) ce++;
    const opts = { minFeatureMM: [0, 0.3, 1.5][t % 3], minPartMM2: [0, 0.5, 4][t % 3], sxUm: 100 + t, syUm: 120 };
    const sb = C.simplifyBusy(masks, w, h, opts), ob = OK.simplifyBusyBody(C._paddedClose, masks, w, h, sb.closeR, sb.minPartUm2, opts.sxUm * opts.syUm);
    cn++; if (sb.masks.every((m, k) => same(m, ob.masks[k])) && JSON.stringify([sb.before, sb.after]) === JSON.stringify([ob.before, ob.after])) ce++;
  }
  check(`F5 construct estimateComplexity and simplifyBusy == pre-F5 runComponents (${ce}/${cn})`, ce === cn);
  // the whole construct morph chain against the all-oracle chain (F4 oracle open/close, F5 oracle removeSpecks/fillHoles)
  let mc = 0, meq = 0;
  for (let t = 0; t < 120; t++) {
    const w = ri(1, 90), h = ri(1, 70), featR = t % 6, cull = t % 2 === 0;
    const m = randMask(w, h, 0.15 + 0.7 * rnd(), t % 5 === 0 ? 255 : 1, true), keep = m.slice();
    const px = { featR, speckPx: ri(0, 40), holePx: ri(0, 80) };
    const a = C._morph(m, w, h, px, cull), b = O.morph(OC, m, w, h, px, cull);
    mc++; if (same(a.m, b.m) && a.specks === b.specks && a.holes === b.holes && same(m, keep)) meq++;
  }
  check(`F5 construct morph == all-oracle chain (open/close F4, removeSpecks/fillHoles F5) (${meq}/${mc})`, meq === mc);
});

// ------------------------------------------------ speed round F6 (plan Appendix F, S5/S2): Kuwahara fast path and band kernel
suite("raster — speed round F6 Kuwahara fast path and band kernel (NFR-05)", () => {
  const R = SBRaster, { oracleKuwahara: OK } = require("./oracle_kernels.js");
  check("F6 SBRaster.kuwaharaSeeds and SBRaster.kuwaharaRows exist", typeof R.kuwaharaSeeds === "function" && typeof R.kuwaharaRows === "function");
  if (typeof R.kuwaharaSeeds !== "function" || typeof R.kuwaharaRows !== "function") return;
  let seed = 0x5eed_f6;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const same = (a, b) => a && b && a.constructor === b.constructor && a.length === b.length && Buffer.compare(bytes(a), bytes(b)) === 0;
  const codeOf = (f) => { try { f(); return null; } catch (e) { return e.code || "?"; } };
  // the global SAT rows, built with alpha.3's recurrence (sat[i] = sat[i − W] + row), as the reference for the seeds
  const globalSat = (src, w, h, dom) => {
    const W = w + 1, sat = new Float64Array(W * (h + 1)), sat2 = new Float64Array(W * (h + 1)), cnt = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0, row2 = 0, rowN = 0;
      for (let x = 0; x < w; x++) {
        if (!dom || dom[y * w + x]) { const v = src[y * w + x]; row += v; row2 += v * v; rowN++; }
        const i = (y + 1) * W + (x + 1);
        sat[i] = sat[i - W] + row; sat2[i] = sat2[i - W] + row2; cnt[i] = cnt[i - W] + rowN;
      }
    }
    const rowOf = (T, s) => T.slice(s * W, (s + 1) * W);
    return { row: (s) => ({ sat: rowOf(sat, s), sat2: rowOf(sat2, s), cnt: rowOf(cnt, s) }) };
  };
  const RADII = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 25, 50];
  const makeSrc = (w, h, kind) => {
    const a = new Float32Array(w * h);
    if (kind === 0) for (let i = 0; i < a.length; i++) a[i] = ri(0, 255);                      // integer
    else if (kind === 1) for (let i = 0; i < a.length; i++) a[i] = rnd() * 255;                // non-integer
    else if (kind === 2) for (let i = 0; i < a.length; i++) a[i] = 0.2126 * ri(0, 255) + 0.7152 * ri(0, 255) + 0.0722 * ri(0, 255); // luminance-like
    else if (kind === 3) { const c = rnd() * 255; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = x < w / 2 && y < h / 2 ? c : (x + y) % 3 === 0 ? c : Math.floor(c / 2) + 0.5; } // ties
    else for (let i = 0; i < a.length; i++) a[i] = rnd() * 255 * 2 ** -ri(0, 40);            // wide dynamic range: Float64 SAT sums round, so operand order shows
    return a;
  };
  const makeDom = (w, h, kind) => {
    if (kind === 0) return null;
    const d = new Uint8Array(w * h).fill(1);
    if (kind === 1) { for (let i = 0; i < d.length; i++) if (rnd() < 0.25) d[i] = 0; }            // holes
    else if (kind === 2) { const k = ri(1, 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < k || y < k || x >= w - k || y >= h - k) d[y * w + x] = 0; } // edge strips
    else { const cx = ri(0, w - 1), cy = ri(0, h - 1), rr = ri(1, Math.max(1, Math.min(w, h))); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 < rr * rr) d[y * w + x] = 0; } // a big hole
    return d;
  };
  const cutsFor = (h, nb, t) => {
    if (nb === 1) return [0, h];
    const set = new Set();
    if (t % 4 === 0) set.add(h - 1);                                   // a one-row tail band
    if (t % 4 === 1) for (let b = 1; b < nb; b++) set.add(Math.floor((b * h) / nb)); // even bands
    while (set.size < nb - 1) set.add(ri(1, h - 1));                   // random (often thinner than r)
    return [0, ...[...set].sort((a, b) => a - b).slice(0, nb - 1), h];
  };
  let cases = 0, wholeEq = 0, bandCases = 0, bandEq = 0, seedCases = 0, seedEq = 0, thin = 0, nonInt = 0, domCases = 0, bigR = 0, unmut = 0;
  const radiiSeen = new Set(), nbSeen = new Set(), passSeen = new Set();
  for (let t = 0; t < 480; t++) {
    const r = RADII[t % RADII.length], w = ri(1, t % 7 === 0 ? 12 : 64), h = ri(1, t % 5 === 0 ? 10 : 56), passes = 1 + (t % 3);
    const src = makeSrc(w, h, t % 5), dom = makeDom(w, h, (t >> 2) % 4);
    cases++; radiiSeen.add(r); passSeen.add(passes);
    if (t % 5 === 1 || t % 5 === 4) nonInt++;
    if (dom) domCases++;
    if (r >= 16) bigR++;
    const want = OK.kuwahara(src, w, h, r, passes, dom), got = R.kuwahara(src, w, h, r, passes, dom);
    if (same(got, want)) wholeEq++;
    // per pass: band kernel over random band splits == the oracle pass, and the seeds == the global SAT rows
    let cur = src;
    for (let p = 0; p < passes; p++) {
      const once = dom ? OK.kuwaharaDomainOnce(cur, w, h, r, dom) : OK.kuwaharaOnce(cur, w, h, r);
      const nb = Math.min(h, 1 + ((t + p) % 9)), cuts = cutsFor(h, nb, t + p);
      nbSeen.add(nb);
      const bands = []; for (let b = 0; b < cuts.length - 1; b++) bands.push([cuts[b], cuts[b + 1]]);
      const curCopy = cur.slice(), domCopy = dom && dom.slice();
      const seeds = R.kuwaharaSeeds(cur, w, h, bands, r, dom), G = globalSat(cur, w, h, dom);
      const out = new Float32Array(w * h);
      let ok = seeds.length === bands.length;
      bands.forEach(([y0, y1], b) => {
        const sd = seeds[b], s = Math.max(0, y0 - r), e = Math.min(h, y1 + r), g = G.row(s);
        seedCases++;
        if (sd && sd.s === s && same(sd.sat, g.sat) && same(sd.sat2, g.sat2) && (dom ? same(sd.cnt, g.cnt) : sd.cnt === undefined)) seedEq++;
        if (y1 - y0 < r) thin++;
        const part = R.kuwaharaRows(cur.slice(s * w, e * w), w, h, r, sd, y0, y1, dom ? dom.slice(s * w, e * w) : undefined);
        if (!(part instanceof Float32Array) || part.length !== (y1 - y0) * w) ok = false; else out.set(part, y0 * w);
      });
      bandCases++;
      if (ok && same(out, once)) bandEq++;
      if (same(cur, curCopy) && (!dom || same(dom, domCopy))) unmut++;
      cur = once;
    }
  }
  check(`F6 kuwahara == alpha.3 oracle byte-for-byte (${wholeEq}/${cases}; r 1..12,16,17,25,50; passes 1..3; ${nonInt} non-integer, ${domCases} with a domain, ${bigR} with r ≥ 16)`,
    wholeEq === cases && nonInt > 50 && domCases > 200 && bigR > 80 && radiiSeen.size === RADII.length && passSeen.size === 3);
  check(`F6 band kernel: concatenated kuwaharaRows bands == the oracle pass (${bandEq}/${bandCases}; band counts ${[...nbSeen].sort((a, b) => a - b).join(",")}; ${thin} bands thinner than r)`,
    bandEq === bandCases && nbSeen.size === 9 && thin > 200);
  check(`F6 kuwaharaSeeds rows byte-equal the global SAT/SAT2/cnt rows at s = max(0, y0 − r) (${seedEq}/${seedCases})`, seedEq === seedCases && seedCases > 1000);
  check(`F6 kuwaharaSeeds/kuwaharaRows never write their inputs (${unmut}/${bandCases})`, unmut === bandCases);
  // the seed at s = 0 is all zero; seed rows are plain Float64 copies (byteOffset 0, own buffer, transferable)
  { const src = makeSrc(9, 7, 1), sd = R.kuwaharaSeeds(src, 9, 7, [[0, 3], [3, 7]], 2, makeDom(9, 7, 1));
    check("F6 seed for s = 0 is all zero; seeds own their buffers (transferable)", sd[0].s === 0 && [sd[0].sat, sd[0].sat2, sd[0].cnt].every((a) => a instanceof Float64Array && a.length === 10 && a.every((v) => v === 0)) &&
      sd.every((x) => [x.sat, x.sat2, x.cnt].every((a) => a.byteOffset === 0 && a.byteLength === a.buffer.byteLength))); }
  // a single band [0, h) with the zero seed is kuwaharaOnce
  { const w = 23, h = 19, src = makeSrc(w, h, 1), sd = R.kuwaharaSeeds(src, w, h, [[0, h]], 4)[0];
    check("F6 one band [0, h) with seed 0 == kuwaharaOnce", same(R.kuwaharaRows(src, w, h, 4, sd, 0, h), OK.kuwaharaOnce(src, w, h, 4))); }
  // argument checks
  { const w = 8, h = 6, src = makeSrc(w, h, 0), sd = R.kuwaharaSeeds(src, w, h, [[2, 4]], 1)[0];
    check("F6 kuwaharaRows rejects a seed for the wrong row, a short srcRows, a bad band and a missing cnt with RASTER_ARG",
      codeOf(() => R.kuwaharaRows(src.slice(0, 5 * w), w, h, 1, { ...sd, s: 0 }, 2, 4)) === "RASTER_ARG" &&
      codeOf(() => R.kuwaharaRows(src.slice(w, 3 * w), w, h, 1, sd, 2, 4)) === "RASTER_ARG" &&
      codeOf(() => R.kuwaharaRows(src.slice(w, 5 * w), w, h, 1, sd, 4, 2)) === "RASTER_ARG" &&
      codeOf(() => R.kuwaharaRows(src.slice(w, 5 * w), w, h, 1, sd, 2, 7)) === "RASTER_ARG" &&
      codeOf(() => R.kuwaharaRows(src.slice(w, 5 * w), w, h, 1, sd, 2, 4, new Uint8Array(4 * w).fill(1))) === "RASTER_ARG" &&
      codeOf(() => R.kuwaharaRows(src.slice(w, 5 * w), w, h, 1, sd, 2, 4)) === null);
    check("F6 kuwaharaSeeds rejects a bad band and r < 1 with RASTER_ARG",
      codeOf(() => R.kuwaharaSeeds(src, w, h, [[3, 2]], 1)) === "RASTER_ARG" && codeOf(() => R.kuwaharaSeeds(src, w, h, [[0, 7]], 1)) === "RASTER_ARG" &&
      codeOf(() => R.kuwaharaSeeds(src, w, h, [[0, 6]], 0)) === "RASTER_ARG"); }
  // r < 1 / passes < 1 keep returning a copy; a non-integer radius (legacy v1 path) still matches the oracle
  { const w = 11, h = 9, src = makeSrc(w, h, 1);
    check("F6 r < 1 or passes < 1 returns a copy; a non-integer radius matches the oracle bit-for-bit",
      same(R.kuwahara(src, w, h, 0, 2), src) && R.kuwahara(src, w, h, 0, 2) !== src && same(R.kuwahara(src, w, h, 2, 0), src) &&
      [1.5, 2.25].every((rr) => { const a = R.kuwahara(src, w, h, rr, 2), b = OK.kuwahara(src, w, h, rr, 2); return Buffer.compare(bytes(a), bytes(b)) === 0; })); }
});

// ------------------------------------------------ speed round F7 (plan Appendix F, S5): typed corner table in T.trace
suite("trace — speed round F7 typed corner table (NFR-05)", () => {
  const T = SBTrace, { oracleTrace } = require("./oracle_kernels.js");
  let seed = 0x5eed_f7;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // mask families: random densities, checkerboards (every corner a saddle), full, empty, holes touching the border, blobs
  const makeMask = (w, h, kind) => {
    const m = new Uint8Array(w * h);
    if (kind === 0) { const d = 0.05 + 0.9 * rnd(); for (let i = 0; i < m.length; i++) m[i] = rnd() < d ? 1 : 0; }
    else if (kind === 1) { const p = ri(0, 1); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x + y + p) & 1; }
    else if (kind === 2) m.fill(1);
    else if (kind === 3) { /* empty */ }
    else if (kind === 4) { m.fill(1); const k = ri(1, 6); for (let j = 0; j < k; j++) { const x0 = ri(0, w - 1), y0 = ri(0, h - 1), x1 = Math.min(w, x0 + ri(1, 5)), y1 = Math.min(h, y0 + ri(1, 5)); for (let y = (j & 1 ? 0 : y0); y < y1; y++) for (let x = (j & 2 ? 0 : x0); x < x1; x++) m[y * w + x] = 0; } } // holes, often touching the border
    else if (kind === 5) { const k = ri(1, 4); for (let j = 0; j < k; j++) { const cx = ri(0, w - 1), cy = ri(0, h - 1), rr = ri(1, 8); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d2 = (x - cx) ** 2 + (y - cy) ** 2; if (d2 < rr * rr) m[y * w + x] = d2 < (rr / 2) ** 2 ? 0 : 1; } } } // rings (holes inside material)
    else { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = ((x >> 1) + (y >> 1) + (rnd() < 0.1 ? 1 : 0)) & 1; } // 2×2 checker with noise
    return m;
  };
  let cases = 0, eq = 0, unmut = 0, loopsSeen = 0;
  const kinds = new Set();
  // exhaustive: every mask up to 3 × 3 (512 masks), plus every 4 × 2 and 2 × 4
  for (const [w, h] of [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [1, 3], [3, 2], [2, 3], [3, 3], [4, 2], [2, 4]]) {
    for (let b = 0; b < 1 << (w * h); b++) {
      const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = (b >> i) & 1;
      const copy = m.slice(), want = oracleTrace(m, w, h), got = T.trace(m, w, h);
      cases++; if (same(got, want)) eq++; if (Buffer.compare(Buffer.from(m), Buffer.from(copy)) === 0) unmut++; loopsSeen += want.length;
    }
  }
  const exhaustive = cases;
  for (let t = 0; t < 700; t++) {
    const kind = t % 7, w = ri(1, t % 9 === 0 ? 4 : 70), h = ri(1, t % 11 === 0 ? 4 : 60), m = makeMask(w, h, kind), copy = m.slice();
    kinds.add(kind);
    const want = oracleTrace(m, w, h), got = T.trace(m, w, h);
    cases++; if (same(got, want)) eq++; if (Buffer.compare(Buffer.from(m), Buffer.from(copy)) === 0) unmut++; loopsSeen += want.length;
  }
  check(`F7 T.trace loops deep-equal the oracle (${eq}/${cases}: ${exhaustive} exhaustive ≤ 3×3/4×2/2×4, the rest random over ${kinds.size} families; ${loopsSeen} loops)`,
    eq === cases && kinds.size === 7 && loopsSeen > 5000);
  check(`F7 T.trace never writes its mask (${unmut}/${cases})`, unmut === cases);
  check("F7 T.trace edge cases equal the oracle (1 × 1 empty/full, w = 0, h = 0, 1 × N strips, plain arrays)",
    [[[0], 1, 1], [[1], 1, 1], [new Uint8Array(0), 0, 5], [new Uint8Array(0), 4, 0], [Uint8Array.from([1, 0, 1, 1, 0, 1]), 6, 1], [Uint8Array.from([1, 1, 0, 1]), 1, 4], [[1, 0, 0, 1], 2, 2]]
      .every(([m, w, h]) => same(T.trace(m, w, h), oracleTrace(m, w, h))));
  // the typed corner table replaces the Map (plan F7 Step 2): no Map in T.trace's body
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "trace.js"), "utf8");
  const body = src.slice(src.indexOf("T.trace = function"), src.indexOf("function dedupeCollinear"));
  check("F7 T.trace uses a typed corner table (no Map, no sorted key snapshot)", body.length > 0 && !/new Map\(/.test(body) && !/\.sort\(/.test(body) && /new Uint8Array\(/.test(body));
});

// ------------------------------------------------ speed round F8 (plan Appendix F, S5/S3): cheaper draft overlays
suite("engine — speed round F8 cropped change overlays (NFR-05, GEO-08)", () => {
  const E = SBEngine, { oracleMaskPolygons: OM } = require("./oracle_kernels.js");
  check("F8 SBEngine.maskPolygonsCrop and SBEngine.changePolygons exist", typeof E.maskPolygonsCrop === "function" && typeof E.changePolygons === "function");
  if (typeof E.maskPolygonsCrop !== "function" || typeof E.changePolygons !== "function") return;
  let seed = 0x5eed_f8;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // non-integer µm pitches (js/raster.js rasterPlan gives sxUm = artW·1000 / W) and integer frame offsets (Math.round)
  const pitch = () => [rnd() < 0.15 ? ri(50, 900) : 37 + rnd() * 900, rnd() < 0.15 ? ri(50, 900) : 41 + rnd() * 900, rnd() < 0.3 ? 0 : ri(1, 20000)];
  const blob = (m, w, x0, y0, x1, y1, d) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = rnd() < d ? 1 : 0; };
  // 1a: random masks inside random crops; maskPolygonsCrop on the crop deep-equals the uncropped oracle on the full raster
  let crops = 0, cropEq = 0, nonEmpty = 0;
  for (let t = 0; t < 600; t++) {
    const w = ri(1, t % 10 === 0 ? 4 : 90), h = ri(1, t % 13 === 0 ? 4 : 70);
    const x0 = ri(0, w - 1), y0 = ri(0, h - 1), x1 = ri(x0 + 1, w), y1 = ri(y0 + 1, h), cw = x1 - x0, ch = y1 - y0;
    const full = new Uint8Array(w * h), crop = new Uint8Array(cw * ch), d = [0.05, 0.3, 0.6, 0.95, 1][t % 5];
    blob(full, w, x0, y0, x1, y1, d);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = full[(y + y0) * w + x + x0];
    const [sx, sy, f] = pitch(), copy = crop.slice();
    const want = OM(w, h, sx, sy, f, (i) => full[i]), got = E.maskPolygonsCrop(crop, x0, y0, x1, y1, sx, sy, f);
    crops++; if (same(got, want) && Buffer.compare(Buffer.from(crop), Buffer.from(copy)) === 0) cropEq++; if (want) nonEmpty++;
  }
  check(`F8 maskPolygonsCrop on random crops deep-equals the uncropped oracle (non-integer sxUm/syUm; ${cropEq}/${crops}, ${nonEmpty} non-empty; crop unmutated)`,
    cropEq === crops && nonEmpty > 400);
  // changePolygons(a, b) = polygons of a ∧ ¬b (b null: a), bbox found in the diff pass; equals the oracle predicate path
  let pairs = 0, pairEq = 0, pairNull = 0, unmut = 0;
  for (let t = 0; t < 600; t++) {
    const w = ri(1, t % 9 === 0 ? 3 : 80), h = ri(1, t % 11 === 0 ? 3 : 60), a = new Uint8Array(w * h), b = new Uint8Array(w * h);
    const k = t % 6;
    if (k === 0) { blob(a, w, 0, 0, w, h, rnd()); blob(b, w, 0, 0, w, h, rnd()); }
    else if (k === 1) { blob(a, w, 0, 0, w, h, rnd()); b.set(a); }                                   // a ∧ ¬a: empty
    else if (k === 2) { blob(a, w, 0, 0, w, h, 0.7); b.set(a); const x = ri(0, w - 1), y = ri(0, h - 1); b[y * w + x] = 0; } // one pixel, anywhere (corners incl.)
    else if (k === 3) { const x0 = ri(0, w - 1), y0 = ri(0, h - 1); blob(a, w, x0, y0, ri(x0 + 1, w), ri(y0 + 1, h), 0.8); blob(b, w, 0, 0, w, h, 0.2); }
    else if (k === 4) { a.fill(1); }                                                                  // full raster, b empty
    else { blob(a, w, 0, 0, w, h, 0.5); a[0] = 1; a[w * h - 1] = 1; }                                  // touching opposite corners
    const [sx, sy, f] = pitch(), ac = a.slice(), bc = b.slice(), useB = k !== 5;
    const want = OM(w, h, sx, sy, f, useB ? (i) => a[i] && !b[i] : (i) => a[i]), got = E.changePolygons(a, useB ? b : null, w, h, sx, sy, f);
    pairs++; if (same(got, want)) pairEq++; if (want === null && got === null) pairNull++;
    if (Buffer.compare(Buffer.from(a), Buffer.from(ac)) === 0 && Buffer.compare(Buffer.from(b), Buffer.from(bc)) === 0) unmut++;
  }
  check(`F8 changePolygons(a, b) deep-equals the oracle a ∧ ¬b path, null when empty (${pairEq}/${pairs}, ${pairNull} empty)`, pairEq === pairs && pairNull >= 100);
  check(`F8 changePolygons never writes its masks (${unmut}/${pairs})`, unmut === pairs);
  check("F8 edge cases equal the oracle (1 × 1, 0-area raster, plain arrays)",
    same(E.changePolygons([1], null, 1, 1, 12.5, 7.25, 3), OM(1, 1, 12.5, 7.25, 3, () => 1)) && E.changePolygons([0], null, 1, 1, 1, 1, 0) === null &&
    E.changePolygons(new Uint8Array(0), null, 0, 4, 1, 1, 0) === null &&
    same(E.changePolygons([1, 1, 0, 1], [0, 1, 0, 0], 2, 2, 100.5, 99.75, 7), OM(2, 2, 100.5, 99.75, 7, (i) => [1, 1, 0, 1][i] && ![0, 1, 0, 0][i])));
  // Step 1: the draft cleanupReport (added/removed/bridges) of the F0 draft fixtures equals the alpha.3 golden
  const C = require("./pool_corpus.js"), gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
  const drafts = C.corpus().filter((fx) => fx.quality === "draft" && !fx.slow), bad = [];
  let withPolys = 0;
  for (const fx of drafts) {
    const r = C.run(fx), d = C.digest(r);
    if (d.cleanupSha !== gold.fixtures[fx.id].cleanupSha || d.geometryHash !== gold.fixtures[fx.id].geometryHash) bad.push(fx.id);
    if (r.snapshot && r.snapshot.cleanupReport.some((c) => c.added || c.removed || c.bridges)) withPolys++;
  }
  check(`F8 draft cleanupReport (added/removed/bridges) equals the alpha.3 golden on the F0 draft fixtures (${drafts.length - bad.length}/${drafts.length}, ${withPolys} with polygons)` +
    (bad.length ? " — differ: " + bad.join(", ") : ""), bad.length === 0 && withPolys >= 3);
  // run() uses the cropped path for the change overlays and the bridges (the uncropped maskPolygons stays for legacyCleanupReport)
  // speed round F9: run() is the runSteps generator; its overlays batch runs E.overlayLayer (constructLayer emits the crops)
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8"), at = src.indexOf("function* runSteps(req, head, step, fail, cache, overlays, par)");
  const body = at > 0 ? src.slice(at) : "", ol = src.slice(src.indexOf("E.overlayLayer = function"), src.indexOf("E.TASKS = Object.freeze"));
  check("F8 run() builds overlays and bridges with E.changePolygons / the cropped path, not the full-raster E.maskPolygons",
    at > 0 && /batch\("overlays"/.test(body) && /E\.changePolygons\(/.test(ol) && /E\.maskPolygonsCrop\(/.test(ol) && !/E\.maskPolygons\(/.test(body) && !/E\.maskPolygons\(/.test(ol));
});

suite("engine — speed round F9 generator pipeline and sync driver (NFR-05)", async () => {
  const E = SBEngine, C = require("./pool_corpus.js"), D = C.deepEqualStrict;
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
  const fields = ["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"];
  const sameGold = (fx, r) => { const d = C.digest(r), g = gold.fixtures[fx.id]; return !!g && fields.every((k) => JSON.stringify(d[k]) === JSON.stringify(g[k])); };
  const NAMES = ["construct", "overlays", "trace", "convert", "traceConvert", "supportPair", "featureLayer", "buildPair", "validatePair", "layerHash",
    "resampleRows", "kuwaharaRows"];   // F13: the row-band raster kernels
  check("F9 SBEngine.TASKS is a frozen name → kernel table (" + NAMES.join(", ") + ")",
    !!E.TASKS && Object.isFrozen(E.TASKS) && JSON.stringify(Object.keys(E.TASKS).sort()) === JSON.stringify(NAMES.slice().sort()) && NAMES.every((n) => typeof E.TASKS[n] === "function"));
  check("F9 split kernels are exported (constructLayer, traceLayer, convertLayer, supportPair, featureLayer, buildPair, validatePair) and generateAsync, BatchError",
    typeof SBConstruct.constructLayer === "function" && typeof SBMaterial.traceLayer === "function" && typeof SBMaterial.convertLayer === "function" &&
    typeof SBSupport.supportPair === "function" && typeof SBSupport.featureLayer === "function" && typeof SBGuides.buildPair === "function" &&
    typeof SBGuides.validatePair === "function" && typeof E.generateAsync === "function" && typeof E.BatchError === "function");
  if (!E.TASKS || typeof E.generateAsync !== "function" || typeof E.BatchError !== "function") return;
  const hooks0 = E.TEST_HOOKS;
  E.TEST_HOOKS = true;
  try {
    const all = C.corpus().filter((fx) => !fx.slow), byId = new Map(all.map((fx) => [fx.id, fx]));
    const reqOf = (fx) => E.request(fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: fx.draftCapPx });

    // F-D5: explicit draftCapPx request field (default = today's device cap, so nothing changes here)
    const p0 = all[0].project, s0 = all[0].source;
    check("F-D5 SBEngine.request copies draftCapPx (default limits(deviceClass).draftPxCap) and refuses a value outside 64–2000",
      E.request(p0, s0, { quality: "draft" }).draftCapPx === SBSchema.limits("desktop").draftPxCap && E.request(p0, s0, { quality: "draft", draftCapPx: 300 }).draftCapPx === 300 &&
      [63, 2001, 1.5, "720"].every((v) => { try { E.request(p0, s0, { quality: "draft", draftCapPx: v }); return false; } catch (e) { return e.code === "ENGINE_ARG"; } }));
    const big = { w: 4000, h: 3000 };
    check("F-D5 rasterPlan(…, draftCapPx) uses min(geometry.draftPx, draftCapPx); omitted = the device cap",
      Math.max(E.rasterPlan(p0, big, "draft", "desktop", 200).geometry.rasterW, E.rasterPlan(p0, big, "draft", "desktop", 200).geometry.rasterH) === Math.min(200, p0.geometry.draftPx) &&
      JSON.stringify(E.rasterPlan(p0, big, "draft", "desktop")) === JSON.stringify(E.rasterPlan(p0, big, "draft", "desktop", SBSchema.limits("desktop").draftPxCap)));
    const capFx = byId.get("t-light-draft"), capReq = Object.assign(reqOf(capFx), { draftCapPx: 100 }), capRes = E.generate(capReq);
    check("F-D5 generate honours req.draftCapPx (a smaller cap gives a smaller draft raster and another geometryHash)",
      capRes.status === "done" && Math.max(capRes.snapshot.geometry.rasterW, capRes.snapshot.geometry.rasterH) === 100 && capRes.geometryHash !== gold.fixtures[capFx.id].geometryHash);

    // 1. split kernels equal their sync wrappers on the F0 fixtures (engine batches recorded through the test-only kernelHook)
    const WRAP = ["h-bonded-draft", "h-connected-fabrication", "g-interior-draft", "t-connected-frame-draft", "n12-draft", "repair-clip-fabrication", "t-bonded-frame-draft", "trailing-draft"];
    const wrapBad = [];
    const contains = (big, small) => !small.length || JSON.stringify(big).includes(JSON.stringify(small).slice(1, -1));
    for (const id of WRAP) {
      const fx = byId.get(id), rec = {};
      const r = E.generate(reqOf(fx), { overlays: fx.overlays, kernelHook: (kind, i, args, run) => { const out = run(); (rec[kind] = rec[kind] || [])[i] = { args, out }; return out; } });
      const p = fx.project, con = p.construction, bonded = con.mode === "bonded-relief", dOpts = { revision: p.revision, quality: fx.quality };
      const bad = (what) => wrapBad.push(id + ":" + what);
      if (r.status !== "done") { bad("status"); continue; }
      // construct
      const ca = rec.construct[0].args[1], masks = rec.construct.map((x) => x.args[1].mask);
      const cw = (bonded ? SBConstruct.bonded : SBConstruct.connected)(masks, ca.W, ca.H, ca.px);
      if (!rec.construct.every((x, k) => D(x.out.final, cw.final[k]) && D(x.out.report, cw.report[k]) && D(x.out.bridges, cw.bridges[k]))) bad("construct");
      // trace + convert (bonded: one fused item; connected smooth: trace, smoothStack, convert)
      const tm = rec.traceConvert ? rec.traceConvert.map((x) => x.args[0]) : rec.trace.map((x) => x.args[0]);
      const conv = rec.traceConvert ? rec.traceConvert.map((x) => x.out) : rec.convert.map((x) => x.out);
      const fOpts = { revision: p.revision, quality: fx.quality, frame: r.snapshot.page.frameMM > 0 };
      if (con.cleanup.cornerStyle === "smooth" && !bonded) fOpts.smooth = { mode: "connected", tolUm: Math.round(con.cleanup.toleranceMM * 1000) };
      const page = SBMaterial.page({ artWMM: r.snapshot.page.artWMM, artHMM: r.snapshot.page.artHMM, frameMM: r.snapshot.page.frameMM });
      if (!D(SBMaterial.fromMasks(tm, ca.W, ca.H, page, fOpts), SBMaterial.assignParts(conv))) bad("fromMasks");
      if (!!rec.traceConvert !== !fOpts.smooth) bad("fused-iff-unsmoothed");
      // support (bonded pairs)
      if (bonded) {
        const sl = [rec.supportPair[0].args[0]].concat(rec.supportPair.map((x) => x.args[1])), sv = SBSupport.validate(sl, con.mode, rec.supportPair[0].args[3]);
        if (!D(sv.supportGraph, r.snapshot.supportGraph) || !contains(r.diagnostics, sv.diagnostics)) bad("support");
      } else if (rec.supportPair) bad("support-connected");
      // features
      const fl = rec.featureLayer.map((x) => x.args[0]), fc = SBSupport.featureChecks(fl, rec.featureLayer[0].args[2]);
      if (!contains(r.diagnostics, fc) || fc.length === 0) bad("features");
      // guides
      if (rec.buildPair) {
        const gl = [rec.buildPair[0].args[1]].concat(rec.buildPair.map((x) => x.args[2])), gb = SBGuides.build(gl, con.guides, dOpts);
        if (!D(gb.guides, r.snapshot.guides) || !gb.scorePaths.every((sp, k) => D(sp, r.validatedLayers[k].scorePaths)) || !contains(r.diagnostics, gb.diagnostics)) bad("guides.build");
        const vl = rec.validatePair.map((x) => x.args[1]), gv = SBGuides.validate(vl, gb, con.guides, dOpts);
        if (!contains(r.diagnostics, gv)) bad("guides.validate");
      } else if (bonded && con.guides.mode !== "none") bad("guides-missing");
      if (!rec.layerHash.every((x, k) => x.out === r.snapshot.layers.map((L) => SBGeom.layerHashes(L).layerHash)[k])) bad("layerHash");
    }
    check("F9 each split kernel deep-equals its pre-split sync wrapper on F0 fixtures (C.bonded/connected, fromMasks, S.validate, featureChecks, SBGuides.build/validate)" +
      (wrapBad.length ? " — differ: " + wrapBad.join(", ") : ""), wrapBad.length === 0);

    // 2. adversarial in-process exec: items in reverse order, args structuredClone'd with their declared transfers (detached
    // on the generator's side), results cloned; whole-corpus digests equal the golden
    const inlineExec = (order, fault) => ({
      map: async (kind, items, o) => {
        const fn = E.TASKS[kind], out = new Array(items.length), errs = [], idx = items.map((x, i) => i);
        if (order === "reverse") idx.reverse();
        for (const i of idx) {
          const tr = (o && o.transfer && o.transfer[i]) || [];
          for (const v of tr) if (!ArrayBuffer.isView(v) || v.byteOffset !== 0 || v.byteLength !== v.buffer.byteLength) throw new Error("F9 exec: transfer of a non-whole buffer");
          const args = structuredClone(items[i], { transfer: tr.map((v) => v.buffer) });
          await new Promise((res) => setImmediate(res));
          try { if (fault) fault(kind, i, args); out[i] = structuredClone(fn(...args)); } catch (e) { errs.push({ index: i, error: e }); }
        }
        if (errs.length) throw new E.BatchError(errs);
        return out;
      },
    });
    const revBad = [], cmpSync = [];
    let detached = 0;
    for (const fx of all) {
      const req = reqOf(fx);
      const r = await E.generateAsync(req, { overlays: fx.overlays, exec: inlineExec("reverse") });
      if (!sameGold(fx, r)) revBad.push(fx.id);
      if (fx.source.w * fx.source.h <= 60000 && cmpSync.length < 6) cmpSync.push([fx, r]);
    }
    check(`F9 reverse-order exec with transferred (detached) args gives the golden digests on the whole non-slow corpus (${all.length - revBad.length}/${all.length})` +
      (revBad.length ? " — differ: " + revBad.join(", ") : ""), revBad.length === 0);
    check("F9 reverse-order async responses deepEqualStrict the sync responses", cmpSync.length >= 3 && cmpSync.every(([fx, r]) => D(r, C.run(fx))));
    { // the declared transfers really detach the generator's copies
      const fx = byId.get("h-bonded-draft"), seen = [];
      await E.generateAsync(reqOf(fx), { exec: { map: (kind, items, o) => { (o.transfer || []).forEach((t) => t && seen.push(...t)); return inlineExec("reverse").map(kind, items, o); } } });
      detached = seen.filter((v) => v.byteLength === 0).length;
      check(`F9 construct/trace batches declare transferable buffers and the exec detaches them (${detached}/${seen.length})`, seen.length >= 8 && detached === seen.length);
    }

    // 3. error precedence: lowest (phase, item index), codedError verbatim
    const coded = (code) => Object.assign(new Error("injected " + code), { code });
    const efx = byId.get("n12-draft");
    const asyncFault = await E.generateAsync(reqOf(efx), { exec: inlineExec("reverse", (kind, i) => { if (kind === "construct" && (i === 5 || i === 2)) throw coded("F9_FAULT_" + i); }) });
    const syncFault = E.generate(reqOf(efx), { kernelHook: (kind, i, args, run) => { if (kind === "construct" && (i === 5 || i === 2)) throw coded("F9_FAULT_" + i); return run(); } });
    check("F9 faults in items 5 and 2 raise item 2's code in both drivers (reverse completion order included), message verbatim",
      asyncFault.status === "error" && asyncFault.error.code === "F9_FAULT_2" && asyncFault.error.message === "injected F9_FAULT_2" &&
      syncFault.status === "error" && syncFault.error.code === "F9_FAULT_2" && syncFault.error.message === "injected F9_FAULT_2");
    const M = SBMaterial, tl = M.traceLayer, cl = M.convertLayer;
    let ph = null;
    try {
      M.traceLayer = function (mask, k) { if (k === 5) throw coded("F9_TRACE_5"); return tl.apply(this, arguments); };
      M.convertLayer = function (t, k) { if (k === 2) throw coded("F9_CONVERT_2"); return cl.apply(this, arguments); };
      ph = [E.generate(reqOf(efx)), await E.generateAsync(reqOf(efx), { exec: inlineExec("reverse") }), await E.generateAsync(reqOf(efx), { exec: inlineExec("forward") })];
    } finally { M.traceLayer = tl; M.convertLayer = cl; }
    check("F9 a trace fault in layer 5 beats a convert fault in layer 2 (fused bonded item: phase before index), every driver and order",
      ph.every((r) => r.status === "error" && r.error.code === "F9_TRACE_5"));
    const plain = await E.generateAsync(reqOf(efx), { exec: { map: async () => { throw coded("POOL_DOWN"); } } });
    check("F9 an exec rejection that is not a BatchError is raised as is (codedError)", plain.status === "error" && plain.error.code === "POOL_DOWN");
    const short = await E.generateAsync(reqOf(efx), { exec: { map: async () => [] } });
    check("F9 an exec that returns the wrong number of results is an ENGINE_INTERNAL error", short.status === "error" && short.error.code === "ENGINE_INTERNAL");
    check("F9 kernelHook is refused unless SBEngine.TEST_HOOKS is set", (() => { E.TEST_HOOKS = false; try { const r = E.generate(reqOf(efx), { kernelHook: (k, i, a, run) => run() });
      return r.status === "error" && r.error.code === "ENGINE_DEBUG_DISABLED"; } finally { E.TEST_HOOKS = true; } })());

    // 4. sync-driver immutability mode over the whole non-slow corpus: plain inputs deep-frozen, typed-array inputs
    // checksummed before/after every item, and no result aliases an input object or buffer
    const walk = (v, objs, typed, freeze) => {
      if (v === null || typeof v !== "object" || objs.has(v)) return;
      objs.add(v);
      if (ArrayBuffer.isView(v)) { typed.push(v); return; }
      if (v instanceof Map) { for (const [a, b] of v) { walk(a, objs, typed, freeze); walk(b, objs, typed, freeze); } return; }
      for (const k of Reflect.ownKeys(v)) walk(v[k], objs, typed, freeze);
      if (freeze) Object.freeze(v);
    };
    const immBad = [];
    let items = 0;
    for (const fx of all) {
      let why = null;
      const r = E.generate(reqOf(fx), { overlays: fx.overlays, kernelHook: (kind, i, args, run) => {
        const objs = new Set(), typed = [];
        walk(args, objs, typed, true);
        const bufs = new Set(typed.map((t) => t.buffer)), before = typed.map((t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength).slice());
        const out = run();
        items++;
        if (typed.some((t, j) => Buffer.compare(Buffer.from(t.buffer, t.byteOffset, t.byteLength), before[j]) !== 0)) why = why || kind + "#" + i + " wrote a typed-array input";
        const oo = new Set(), ot = [];
        walk(out, oo, ot, false);
        if ([...oo].some((o) => objs.has(o)) || ot.some((t) => bufs.has(t.buffer))) why = why || kind + "#" + i + " returned an alias of an input";
        return out;
      } });
      if (why || !sameGold(fx, r)) immBad.push(fx.id + (why ? " (" + why + ")" : r.status === "error" ? " (" + r.error.code + ": " + r.error.message + ")" : ""));
    }
    check(`F9 sync-driver immutability mode passes on the whole non-slow corpus (${all.length - immBad.length}/${all.length}, ${items} kernel items)` +
      (immBad.length ? " — " + immBad.join("; ") : ""), immBad.length === 0 && items > 500);
  } finally { E.TEST_HOOKS = hooks0; }
  // run() is a generator folded by drivers; kernels come only from the TASKS table
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8");
  check("F9 engine.js: function* runSteps, both drivers resume it, and the old run() body is gone",
    /function\* runSteps\(req, head, step, fail, cache, overlays, par\)/.test(src) && !/function run\(req, head, step, fail, cache, overlays\)/.test(src) &&
    /E\.generate = function/.test(src) && /E\.generateAsync = async function/.test(src));
});

// ------------------------------------------------ speed round F11 (S1): coordinator worker, SBPool, handshake
suite("worker.js/pool.js/diag.js — speed round F11 coordinator, SBPool, handshake, progress, acceptResult (NFR-02, NFR-05, §9.3)", async () => {
  const E = SBEngine, C = require("./pool_corpus.js"), Dq = C.deepEqualStrict, shim = require("./node_worker_shim.js");
  const JS = path.join(__dirname, "..", "js"), text = (n) => fs.readFileSync(path.join(JS, n), "utf8");
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
  const fields = ["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"];
  const sameGold = (fx, r) => { const d = C.digest(r), g = gold.fixtures[fx.id]; return !!g && fields.every((k) => JSON.stringify(d[k]) === JSON.stringify(g[k])); };
  const APPV = (text("app.js").match(/const APP_VERSION = "([^"]+)"/) || [])[1];

  // ---- SBDiag.acceptResult (pure): a result is shown only for the active run, keyed by runId, gen, sampleHash, overlays, deviceClass
  const A = SBDiag.acceptResult;
  check("F11 SBDiag.acceptResult exists", typeof A === "function");
  if (typeof A === "function") {
    const act = { runId: 7, gen: 3, sampleHash: "ab", overlays: true, deviceClass: "desktop" };
    check("F11 acceptResult accepts the active run's result (extra fields ignored)", A(act, Object.assign({ response: {}, requestId: "draft-1" }, act)) === true);
    check("F11 acceptResult drops a different runId, gen, sampleHash, overlays or deviceClass",
      [["runId", 6], ["gen", 2], ["sampleHash", "cd"], ["overlays", false], ["deviceClass", "mobile"]].every(([k, v]) => A(act, Object.assign({}, act, { [k]: v })) === false));
    check("F11 acceptResult drops everything without an active run, a message, or a field (requestId never decides)",
      A(null, act) === false && A(act, null) === false && A(act, Object.assign({}, act, { runId: undefined })) === false &&
      A(Object.assign({}, act, { requestId: "draft-1" }), Object.assign({}, act, { runId: 8, requestId: "draft-1" })) === false);
    check("F11 acceptResult: null sampleHash (inline pixels) matches only null", A(Object.assign({}, act, { sampleHash: null }), Object.assign({}, act, { sampleHash: null })) === true &&
      A(Object.assign({}, act, { sampleHash: null }), act) === false);
  }

  // ---- the shipped files
  const wsrc = text("worker.js"), psrc = text("pool.js");
  check("F11 worker.js: coord and helper roles, the protocol messages and the hello handshake",
    ["hello", "ack", "progress", "result", "canceled", "error", "killHelper", "source", "generate", "cancel", "ports", "item", "itemResult"].every((t) => wsrc.includes('"' + t + '"')) &&
    /modulesHash/.test(wsrc) && /engineVersion/.test(wsrc) && /appVersion/.test(wsrc) && /typeof SB_INLINED/.test(wsrc));
  check("F11 worker.js WORKER_APP_VERSION equals js/app.js APP_VERSION and sw.js VERSION",
    (wsrc.match(/WORKER_APP_VERSION = "([^"]+)"/) || [])[1] === APPV && (text("../sw.js").match(/const VERSION = "([^"]+)"/) || [])[1] === APPV);
  check("F11 workers never set SBEngine.TEST_HOOKS", !/TEST_HOOKS\s*=/.test(wsrc) && !/TEST_HOOKS\s*=/.test(psrc));
  check("F11 SBHash.modulesHash(entries) hashes [name, sha256(text)] pairs (order matters)", typeof SBHash.modulesHash === "function" &&
    SBHash.modulesHash([["a.js", "x"], ["b.js", "y"]]) === SBHash.hashJSON([["a.js", SBHash.sha256(new TextEncoder().encode("x"))], ["b.js", SBHash.sha256(new TextEncoder().encode("y"))]]) &&
    SBHash.modulesHash([["b.js", "y"], ["a.js", "x"]]) !== SBHash.modulesHash([["a.js", "x"], ["b.js", "y"]]));

  // pool.js is a DOM module; it touches no DOM at load, so it runs here as it does on the page
  vm.runInThisContext(psrc, { filename: "pool.js" });
  check("F11 SBPool.create, helperCount, longTasks", typeof SBPool.create === "function" && typeof SBPool.helperCount === "function" && typeof SBPool.longTasks === "function");
  if (typeof SBPool.create !== "function") return;
  check("PO-PERF-1 helperCount = clamp(hardwareConcurrency − 1, 1, cap) (cap 8 desktop, 4 mobile; unknown → 1)",
    SBPool.helperCount(16, "desktop") === 8 && SBPool.helperCount(16, "mobile") === 4 && SBPool.helperCount(4, "desktop") === 3 && SBPool.helperCount(1, "desktop") === 1 &&
    SBPool.helperCount(undefined, "desktop") === 1 && SBPool.helperCount(2, "desktop") === 1);
  const lt = SBPool.longTasks();
  check("F11 long-task recorder: start/stop → {supported, max, count} (no PerformanceObserver longtask in Node → unsupported, zeros)",
    (() => { lt.start(); const r = lt.stop(); return r && typeof r.supported === "boolean" && r.max === 0 && r.count === 0; })());

  const pools = [];
  const mk = (o) => {
    o = o || {};
    const spawned = [];
    const pool = SBPool.create(Object.assign({
      appVersion: APPV, helpers: 2, helloTimeoutMs: 20000,
      loadText: async (n) => text(n),
      spawn: (name) => { const w = shim.spawn(path.join(JS, "worker.js"), { name, patch: o.patchFor ? o.patchFor(name, spawned.filter((x) => x.name === name).length) : null }); spawned.push(w); return w; },
    }, o.opts || {}));
    pool.spawned = spawned;
    pools.push(pool);
    return pool;
  };
  const reqOf = (fx) => E.request(fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: fx.draftCapPx });
  const srcOf = (fx) => Object.assign({ sampleHash: fx.project.source.sampleHash }, fx.source);
  const submitFx = (pool, fx, extra) => {
    pool.setSource(srcOf(fx));
    return pool.submit(reqOf(fx), Object.assign({ sampleHash: fx.project.source.sampleHash, gen: 1, overlays: fx.overlays }, extra || {}));
  };
  const codeOf = async (p) => { try { await p; return null; } catch (e) { return e instanceof Error ? e.code : "not-an-Error"; } };
  try {
    const all = C.corpus().filter((fx) => !fx.slow), byId = new Map(all.map((fx) => [fx.id, fx]));

    // 1. round trip through the coordinator and two helpers equals the serial golden on the whole non-slow corpus
    const pool = mk();
    const up = await pool.ready;
    check("F11 the coordinator says hello with the page's engineVersion, appVersion and modulesHash; the pool is up", up === true && pool.mode === "pool");
    if (!up) return;
    const bad = [], live = [];
    for (const fx of all) {
      const r = await submitFx(pool, fx).done;
      if (r.status !== r.response.status || !sameGold(fx, r.response)) bad.push(fx.id);
      if (live.length < 4 && fx.source.w * fx.source.h <= 60000) live.push([fx, r.response]);
    }
    check(`NFR-05 F11 pooled round trip (coordinator + 2 helpers) equals the golden digests on the whole non-slow corpus (${all.length - bad.length}/${all.length})` +
      (bad.length ? " — differ: " + bad.join(", ") : ""), bad.length === 0);
    check("NFR-05 F11 pooled responses deepEqualStrict the sync responses", live.length >= 3 && live.every(([fx, r]) => Dq(r, C.run(fx))));
    const st1 = await pool.stats();
    check("F11 helpers were admitted and ran items", st1.helpersAdmitted.length === 2 && st1.itemsHelper > 0);
    const fr = live[0][1];
    check("F11 the response is deep-frozen again after receipt", Object.isFrozen(fr) && Object.isFrozen(fr.snapshot) && Object.isFrozen(fr.snapshot.layers) &&
      Object.isFrozen(fr.snapshot.layers[0]) && Object.isFrozen(fr.diagnostics));

    // 2. P = 0: the coordinator runs every item inline
    const p0 = mk({ opts: { helpers: 0 } });
    const sub0 = ["h-bonded-draft", "h-connected-fabrication", "t-connected-frame-draft", "n12-draft", "g-interior-draft", "complexity-error-fabrication", "repair-clip-draft"].map((id) => byId.get(id));
    const bad0 = [];
    if (await p0.ready) for (const fx of sub0) { const r = await submitFx(p0, fx).done; if (!sameGold(fx, r.response)) bad0.push(fx.id); }
    const st0 = await p0.stats();
    check("NFR-05 F11 P = 0 (coordinator inline) equals the golden digests" + (bad0.length ? " — differ: " + bad0.join(", ") : ""), p0.mode === "pool" && bad0.length === 0 && st0.itemsInline > 0 && st0.itemsHelper === 0);

    // 3. ack, progress and result order (NFR-02, §9.3)
    {
      const fx = byId.get("t-light-fabrication"), ev = [];
      let resolved = false;
      const t0 = Date.now();
      const s = submitFx(pool, fx, { onAck: () => ev.push(["ack-main", Date.now() - t0, resolved]), onStart: () => ev.push(["ack", Date.now() - t0, resolved]),
        onProgress: (p) => ev.push(["progress", p, resolved]) });
      const r = await s.done; resolved = true;
      const ms = Date.now() - t0, prog = ev.filter((e) => e[0] === "progress").map((e) => e[1]);
      check("NFR-02 F11 SBPool acknowledges the submit on main within 100 ms, before the coordinator's ack", ev[0] && ev[0][0] === "ack-main" && ev[0][1] <= 100);
      check("NFR-02 F11 the coordinator's ack {runId} precedes any progress", ev.findIndex((e) => e[0] === "ack") === 1 && typeof s.runId === "number");
      check("§9.3 F11 progress messages precede the result, carry {runId, stage, frac, sub} and are monotone",
        r.status === "done" && prog.length >= 1 && ev.every((e) => e[2] === false) && prog.every((p) => p.runId === s.runId && typeof p.stage === "string" && "sub" in p) &&
        prog.every((p, i) => i === 0 || p.frac >= prog[i - 1].frac));
      check("§9.3 F11 progress is throttled to ≤ 10 Hz", prog.length <= Math.ceil(ms / 100) + 1);
    }

    // 4. version handshake, both directions
    const bump = (n, t) => (n === "schema.js" ? t.replace('version: "1.0.0-dev"', 'version: "0.9.9-skew"') : t);
    const skewAll = mk({ patchFor: (name) => (name.startsWith("sb-coord") ? bump : null) });
    const skewUp = await skewAll.ready;
    check("§9.3 F11 a coordinator naming another engineVersion is refused: terminated, one respawn, then the fallback with a reload notice",
      skewUp === false && skewAll.mode === "fallback" && skewAll.spawned.filter((w) => w.name.startsWith("sb-coord")).length === 2 &&
      skewAll.spawned.every((w) => w.terminated) && /reload/i.test(skewAll.notice || ""));
    check("F11 submit on a fallback pool rejects with POOL_UNAVAILABLE (the caller runs the sync driver)",
      (await codeOf(skewAll.submit(reqOf(all[0]), { sampleHash: null, gen: 1 }).done)) === "POOL_UNAVAILABLE");
    const skewOnce = mk({ patchFor: (name, n) => (name.startsWith("sb-coord") && n === 0 ? bump : null) });
    check("F11 a skewed coordinator is respawned once (same URL) and the second, current one is admitted", (await skewOnce.ready) === true &&
      skewOnce.spawned.filter((w) => w.name.startsWith("sb-coord")).length === 2);
    const appSkew = mk({ opts: { appVersion: "0.0.0-other" } });
    check("F11 a coordinator naming another appVersion is refused", (await appSkew.ready) === false && appSkew.mode === "fallback");
    {
      const fx = byId.get("h-bonded-draft"), req = Object.assign({}, reqOf(fx), { engineVersion: "0.9.9-skew" });
      pool.setSource(srcOf(fx));
      const r = await pool.submit(req, { sampleHash: fx.project.source.sampleHash, gen: 1 }).done;
      check("§9.3 F11 a request naming another engineVersion is refused by the coordinator (ENGINE_MISMATCH)", r.status === "error" && r.response.error.code === "ENGINE_MISMATCH");
    }

    // 5. a helper with a different modulesHash is refused; its items run inline (and elsewhere)
    {
      const skewH = (n, t) => (n === "guides.js" ? t + "\n// skewed helper\n" : t);
      const ph = mk({ patchFor: (name) => (name === "sb-helper-1" ? skewH : null) });
      const fx = byId.get("n12-draft");
      const okUp = await ph.ready, r = okUp ? await submitFx(ph, fx).done : null, st = await ph.stats();
      const h1 = ph.spawned.find((w) => w.name === "sb-helper-1");
      check("§9.3 F11 a helper whose modulesHash differs is refused (killHelper → terminated) and the run equals the golden",
        okUp && r && sameGold(fx, r.response) && st.helpersRefused.includes(1) && !st.helpersAdmitted.includes(1) && h1 && h1.terminated);
      const pa = mk({ patchFor: (name) => (name.startsWith("sb-helper") ? skewH : null) });
      const ra = (await pa.ready) ? await submitFx(pa, fx).done : null, sa = await pa.stats();
      check("F11 with every helper refused the items run inline in the coordinator (golden)", ra && sameGold(fx, ra.response) && sa.helpersAdmitted.length === 0 && sa.itemsInline > 0 && sa.itemsHelper === 0);
    }

    // 6. source identity (F.3): SOURCE_MISMATCH, the setSource race, inline pixels
    {
      const fa = byId.get("t-light-draft"), fb = byId.get("h-bonded-draft");
      pool.setSource(srcOf(fa));
      const otherHash = await codeOf(pool.submit(reqOf(fa), { sampleHash: "f".repeat(64), gen: 1 }).done);
      const otherSize = await codeOf(pool.submit(Object.assign({}, reqOf(fa), { normalizedSource: Object.assign({}, reqOf(fa).normalizedSource, { w: fa.source.w + 1 }) }),
        { sampleHash: fa.project.source.sampleHash, gen: 1 }).done);
      check("F11 SOURCE_MISMATCH when a generate names another sampleHash or size than the stored source (an Error with .code)", otherHash === "SOURCE_MISMATCH" && otherSize === "SOURCE_MISMATCH");
      // race: a long run X is in flight, A (naming source a) is queued behind it, then setSource(b) — A never runs on b's pixels
      const big = byId.get("fine-pitch-fabrication");
      pool.setSource(srcOf(big));
      const x = pool.submit(reqOf(big), { sampleHash: big.project.source.sampleHash, gen: 1 });
      pool.setSource(srcOf(fa));
      const a = pool.submit(reqOf(fa), { sampleHash: fa.project.source.sampleHash, gen: 2 });
      pool.setSource(srcOf(fb));
      const xr = await x.done;
      let ar = null, ac = null;
      try { ar = await a.done; } catch (e) { ac = e instanceof Error ? e.code : "not-an-Error"; }
      // F14: the cancel of x is immediate, so A may start before setSource(b) arrives — then it runs on its own source a
      // (equal to a's golden); if it starts after, it is refused. Never on b's pixels.
      check("F11 a setSource racing a queued generate never pairs it with the new pixels (SOURCE_MISMATCH, or a's own source); the superseded run is canceled",
        xr.status === "canceled" && (ac === "SOURCE_MISMATCH" || (ac === null && ar.status === "done" && sameGold(fa, ar.response))));
      const inl = await pool.submit(reqOf(fb), { sampleHash: null, gen: 3, overlays: fb.overlays }).done;
      check("F11 a null sampleHash carries its pixels inline (never matched against the stored source)", sameGold(fb, inl.response));
      check("F11 the result echoes {runId, gen, sampleHash, overlays, deviceClass} and SBDiag.acceptResult accepts it for its own run only",
        inl.gen === 3 && inl.sampleHash === null && inl.overlays === fb.overlays && inl.deviceClass === fb.deviceClass &&
        SBDiag.acceptResult({ runId: inl.runId, gen: 3, sampleHash: null, overlays: fb.overlays, deviceClass: fb.deviceClass }, inl) &&
        !SBDiag.acceptResult({ runId: a.runId, gen: 2, sampleHash: fa.project.source.sampleHash, overlays: fa.overlays, deviceClass: fa.deviceClass }, inl));
    }

    // 7. kernel errors keep .code and message across helper → coordinator → main (lowest item index wins)
    {
      const fault = (n, t) => (n === "construct.js" ? t.replace("C.constructLayer = function (k, a) {",
        'C.constructLayer = function (k, a) { if (k === 2 || k === 5) { const e = new Error("injected F11_FAULT_" + k); e.code = "F11_FAULT_" + k; throw e; }') : t);
      const pf = mk({ patchFor: () => fault, opts: { loadText: async (n) => fault(n, text(n)) } });   // a consistent deploy: the page reads the same texts
      const admitted = async (p, n) => { await p.helpersReady; for (let i = 0; i < 200; i++) { const s = await p.stats(); if (s && s.helpersAdmitted.length >= n) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };
      const fx = byId.get("n12-draft"), r = (await pf.ready) && (await admitted(pf, 2)) ? await submitFx(pf, fx).done : null, st = await pf.stats();
      check("F11 a kernel error crosses helper → coordinator → main with its code and message (items 5 and 2 fail: item 2's)",
        r && r.status === "error" && r.response.error.code === "F11_FAULT_2" && r.response.error.message === "injected F11_FAULT_2" && st.helpersAdmitted.length === 2);
    }

    // 8. the coordinator owns the draft cache: source, K1 and K2 survive a pooled run and the next run hits them
    {
      const fx = byId.get("t-light-draft");
      const r1 = await submitFx(pool, fx).done, st = await pool.stats();
      const seen = [];
      const r2 = await submitFx(pool, fx, { onProgress: (p) => seen.push(p.stage) }).done;
      check("F11 after a pooled run the stored source, cache.k1 and cache.k2 have non-zero byteLength",
        r1.status === "done" && st.sourceBytes > 0 && st.k1Bytes > 0 && st.k2Bytes > 0);
      check("F11 the next run hits the coordinator's cache (resample-cached) and equals the golden", seen[0] === "resample-cached" && sameGold(fx, r2.response));
    }
  } finally {
    for (const p of pools) p.terminate();
  }
});

// ------------------------------------------------ speed round F12 (S1): adversarial executor and pool-size equality
// makeAdvExec(E, seed, stats) → an in-process exec.map for SBEngine.generateAsync that behaves like a hostile pool: every
// item's arguments are structuredClone'd with its declared transfers (so the generator's copies are really detached, as
// in a postMessage), the items complete in a seeded random order with seeded random delays (setImmediate hops and
// setTimeout), results are cloned, and the batch settles only after every item (BatchError). Self-contained: it is
// stringified into the F12 worker threads.
function makeAdvExec(E, seed, stats) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hop = () => new Promise((r) => setImmediate(r));
  const delay = async () => { const x = rnd(); if (x < 0.1) await new Promise((r) => setTimeout(r, Math.floor(rnd() * 3))); else for (let i = Math.floor(x * 4); i > 0; i--) await hop(); };
  return {
    map: async (kind, items, o) => {
      const fn = E.TASKS[kind], n = items.length, out = new Array(n), errs = [];
      if (typeof fn !== "function") throw new Error("F12 exec: no kernel " + kind);
      // F13: every Kuwahara slice is exactly SAT rows [max(0, y0 − r), min(h, y1 + r) + 1): the seed row s plus source
      // (and domain) rows [s, e), from which the kernel rebuilds SAT rows s+1 … e
      if (kind === "kuwaharaRows") items.forEach(([src, w, h, r, seed, y0, y1, dom]) => {
        const s0 = Math.max(0, y0 - r), e = Math.min(h, y1 + r);
        if (!seed || seed.s !== s0 || seed.sat.length !== w + 1 || seed.sat2.length !== w + 1 || src.length !== (e - s0) * w ||
            (dom ? dom.length !== src.length || !seed.cnt || seed.cnt.length !== w + 1 : !!seed.cnt))
          throw new Error("F13 exec: Kuwahara slice of band [" + y0 + ", " + y1 + ") is not SAT rows [" + s0 + ", " + (e + 1) + ")");
        if (stats.kuwahara) { stats.kuwahara.items++; if (y1 - y0 < r) stats.kuwahara.thin++; if (y1 - y0 === 1) stats.kuwahara.oneRow++; if (seed.cnt) stats.kuwahara.cnt++; }
      });
      // post: every item's args cloned now, its declared transfers detached on the generator's side (F.3 ownership)
      const args = items.map((a, i) => {
        const tr = (o && o.transfer && o.transfer[i]) || [];
        for (const v of tr) if (!ArrayBuffer.isView(v) || v.byteOffset !== 0 || v.byteLength !== v.buffer.byteLength) throw new Error("F12 exec: " + kind + "#" + i + " transfers a non-whole buffer");
        const c = structuredClone(a, { transfer: tr.map((v) => v.buffer) });
        if (tr.some((v) => v.byteLength !== 0)) throw new Error("F12 exec: " + kind + "#" + i + " transfer did not detach");
        stats.transferred += tr.length;
        return c;
      });
      // complete in a seeded random permutation, with random delays between completions
      const order = items.map((_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      if (order.some((v, i) => v !== i)) stats.reordered++;
      stats.batches++;
      stats.items += n;
      await Promise.all(order.map(async (i, at) => {
        for (let h = 0; h < at % 3; h++) await hop();   // completions interleave with other items' delays
        await delay();
        try { out[i] = structuredClone(fn(...args[i])); } catch (e) { errs.push({ index: i, error: e }); }
      }));
      if (errs.length) throw new E.BatchError(errs);
      return out;
    },
  };
}
// The F12 corpus thread: loads the modules and the corpus, then for each fixture id it is given runs the sync driver
// once and the adversarial executor for every seed; posts the digests, the strict comparison and the sync response.
const F12_THREAD = `
"use strict";
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs"), path = require("path"), vm = require("vm");
globalThis.crypto ??= require("crypto").webcrypto;
const T = workerData.testDir;
for (const f of require(path.join(T, "modules.js")).NODE_MODULES) vm.runInThisContext(fs.readFileSync(path.join(T, "..", "js", f), "utf8"), { filename: f });
const C = require(path.join(T, "pool_corpus.js")), E = SBEngine, byId = new Map(C.corpus().map((fx) => [fx.id, fx]));
const makeAdvExec = (${makeAdvExec.toString()});
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0; return h; };
parentPort.on("message", async (id) => {
  if (id === null) { process.exit(0); return; }
  const fx = byId.get(id), reqOf = () => E.request(fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: fx.draftCapPx });
  const sync = E.generate(reqOf(), { overlays: fx.overlays }), runs = [];
  if (workerData.bandRows) E.TEST_HOOKS = true;   // F13: the test-only bandRows override forces many raster bands
  for (const seed of workerData.seeds) {
    const stats = { batches: 0, reordered: 0, items: 0, transferred: 0, kuwahara: { items: 0, thin: 0, oneRow: 0, cnt: 0 } };
    // bands of 1..9 rows (thinner than r, one-row tail bands), seeded per run
    const bandRows = workerData.bandRows ? 1 + (((seed * 2654435761) ^ fnv(id)) >>> 0) % 9 : undefined;
    let r, threw = null;
    try { r = await E.generateAsync(reqOf(), { overlays: fx.overlays, bandRows, exec: makeAdvExec(E, (seed * 2654435761) ^ fnv(id), stats) }); } catch (e) { threw = String(e && e.message); }
    runs.push({ seed, digest: r ? C.digest(r) : null, strict: !!r && C.deepEqualStrict(r, sync), threw, stats });
  }
  parentPort.postMessage({ id, runs, sync });
});
`;

suite("engine — speed round F12 pool equality (NFR-05)", async () => {
  const E = SBEngine, C = require("./pool_corpus.js"), Dq = C.deepEqualStrict, shim = require("./node_worker_shim.js"), { Worker } = require("worker_threads");
  const JS = path.join(__dirname, "..", "js"), text = (n) => fs.readFileSync(path.join(JS, n), "utf8");
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
  const fields = ["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"];
  const goldDigest = (fx, d) => { const g = gold.fixtures[fx.id]; return !!g && !!d && fields.every((k) => JSON.stringify(d[k]) === JSON.stringify(g[k])); };
  const sameGold = (fx, r) => goldDigest(fx, C.digest(r));
  const APPV = (text("app.js").match(/const APP_VERSION = "([^"]+)"/) || [])[1];
  const all = C.corpus().filter((fx) => !fx.slow), byId = new Map(all.map((fx) => [fx.id, fx]));
  const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
  const reqOf = (fx) => E.request(fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: fx.draftCapPx });

  // ---- Step 1: the adversarial executor, 20 seeds over the whole non-slow corpus (fixtures spread over worker threads)
  const sync = new Map();
  {
    const nThreads = Math.max(1, Math.min(12, require("os").cpus().length - 1)), todo = all.map((fx) => fx.id), got = [];
    await Promise.all(Array.from({ length: Math.min(nThreads, todo.length) }, () => new Promise((resolve, reject) => {
      const w = new Worker(F12_THREAD, { eval: true, workerData: { testDir: __dirname, seeds: SEEDS, bandRows: true } });
      const next = () => w.postMessage(todo.length ? todo.shift() : null);
      w.on("message", (m) => { got.push(m); next(); });
      w.on("error", reject);
      w.on("exit", () => resolve());
      next();
    })));
    const bad = [], strictBad = [], threw = [], tot = { batches: 0, reordered: 0, items: 0, transferred: 0 }, kw = { items: 0, thin: 0, oneRow: 0, cnt: 0 };
    for (const m of got) {
      const fx = byId.get(m.id);
      sync.set(m.id, m.sync);
      for (const r of m.runs) {
        if (r.threw) threw.push(m.id + "@" + r.seed + ": " + r.threw);
        else if (!goldDigest(fx, r.digest)) bad.push(m.id + "@" + r.seed);
        else if (!r.strict) strictBad.push(m.id + "@" + r.seed);
        for (const k of Object.keys(tot)) tot[k] += r.stats[k];
        for (const k of Object.keys(kw)) kw[k] += r.stats.kuwahara[k];
      }
    }
    const runs = got.length * SEEDS.length;
    check(`NFR-05 F12 adversarial executor (seeded random completion order and delays, transferred args, cloned results): ${SEEDS.length} seeds × the whole non-slow corpus ` +
      `give the golden digests (${runs - bad.length - threw.length}/${all.length * SEEDS.length})` + (bad.length || threw.length ? " — differ: " + bad.concat(threw).slice(0, 12).join("; ") : ""),
      got.length === all.length && bad.length === 0 && threw.length === 0);
    check("NFR-05 F12 every adversarial response deepEqualStrict the sync driver's response" + (strictBad.length ? " — differ: " + strictBad.slice(0, 12).join("; ") : ""),
      got.length === all.length && strictBad.length === 0);
    check(`F12 the executor really reorders and transfers (${tot.reordered}/${tot.batches} multi-item batches permuted, ${tot.items} items, ${tot.transferred} buffers detached)`,
      tot.reordered > tot.batches / 2 && tot.transferred > 1000);
    check(`NFR-05 F13 the bandRows override forced Kuwahara row bands in the adversarial runs and every slice was exactly SAT rows [max(0, y0 − r), min(h, y1 + r) + 1) ` +
      `(${kw.items} band items: ${kw.thin} thinner than r, ${kw.oneRow} one-row bands, ${kw.cnt} with domain cnt rows)`,
      threw.length === 0 && kw.items > 1000 && kw.thin > 0 && kw.oneRow > 0 && kw.cnt > 0);
    check("F12 the sync responses from the corpus threads equal the golden (the thread loads the same modules)", all.every((fx) => sync.has(fx.id) && sameGold(fx, sync.get(fx.id))));
  }
  { // error precedence under random completion order: faults in two random construct items raise the lower index
    const fx = byId.get("n12-draft"), coded = (code) => Object.assign(new Error("injected " + code), { code });
    const wrong = [];
    for (const seed of SEEDS) {
      const a = seed % 12, b = (seed * 7 + 3) % 12, lo = Math.min(a, b === a ? (a + 5) % 12 : b), hi = Math.max(a, b === a ? (a + 5) % 12 : b);
      const ex = makeAdvExec(E, seed, { batches: 0, reordered: 0, items: 0, transferred: 0 }), inner = ex.map;
      ex.map = (kind, items, o) => (kind !== "construct" ? inner(kind, items, o) : inner(kind, items.map((it, i) => (i === lo || i === hi ? [-1 - i].concat(it.slice(1)) : it)), o));
      const ck = SBConstruct.constructLayer;
      let r;
      try {
        SBConstruct.constructLayer = function (k) { if (k < 0) throw coded("F12_FAULT_" + (-1 - k)); return ck.apply(this, arguments); };
        r = await E.generateAsync(reqOf(fx), { exec: ex });
      } finally { SBConstruct.constructLayer = ck; }
      if (!(r.status === "error" && r.error.code === "F12_FAULT_" + lo && r.error.message === "injected F12_FAULT_" + lo)) wrong.push(seed + ": " + lo + "/" + hi + " → " + (r.error ? r.error.code : r.status));
    }
    check("F12 with two faulting construct items the lowest index's error wins under every seed's completion order" + (wrong.length ? " — " + wrong.join("; ") : ""), wrong.length === 0);
  }

  // ---- Step 2: the real pool (worker threads through the shim) for P = 0, 1, 2, 3, 8 helpers
  vm.runInThisContext(text("pool.js"), { filename: "pool.js" });
  const pools = [];
  const mk = (o) => {
    o = o || {};
    const spawned = [];
    const pool = SBPool.create(Object.assign({
      appVersion: APPV, helpers: 2, helloTimeoutMs: 20000,
      loadText: async (n) => (o.patch ? o.patch(n, text(n)) : text(n)),   // a consistent deploy: the page reads the texts the workers run
      spawn: (name) => { const w = shim.spawn(path.join(JS, "worker.js"), { name, patch: o.patch || null }); spawned.push(w); return w; },
    }, o.opts || {}));
    pool.spawned = spawned;
    pools.push(pool);
    return pool;
  };
  const srcOf = (fx) => Object.assign({ sampleHash: fx.project.source.sampleHash }, fx.source);
  const submitFx = (pool, fx) => { pool.setSource(srcOf(fx)); return pool.submit(reqOf(fx), { sampleHash: fx.project.source.sampleHash, gen: 1, overlays: fx.overlays }); };
  const admitted = async (p, n) => { await p.helpersReady; for (let i = 0; i < 300; i++) { const s = await p.stats(); if (s && s.helpersAdmitted.length >= n) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };
  try {
    const SIZES = [0, 1, 2, 3, 8];
    const res = await Promise.all(SIZES.map(async (P) => {
      const pool = mk({ opts: { helpers: P } }), out = { P, up: await pool.ready, bad: [], strictBad: [], stats: null };
      if (!out.up || !(await admitted(pool, P))) { out.up = false; return out; }
      for (const fx of all) {
        let r;
        try { r = await submitFx(pool, fx).done; } catch (e) { out.bad.push(fx.id + " (" + e.code + ")"); continue; }
        if (r.status !== r.response.status || !sameGold(fx, r.response)) out.bad.push(fx.id);
        else if (!sync.has(fx.id) || !Dq(r.response, sync.get(fx.id))) out.strictBad.push(fx.id);
      }
      out.stats = await pool.stats();
      pool.terminate();
      return out;
    }));
    for (const o of res)
      check(`NFR-05 worker pool hashes equal for pool sizes 1, 2, N — P = ${o.P}: the whole non-slow corpus equals the golden digests` +
        (o.bad.length ? " — differ: " + o.bad.join(", ") : ""), o.up && o.bad.length === 0);
    for (const o of res)
      check(`NFR-05 F12 P = ${o.P}: every pooled response deepEqualStrict the sync response` + (o.strictBad.length ? " — differ: " + o.strictBad.join(", ") : ""), o.up && o.strictBad.length === 0);
    check("F12 P = 0 runs every item inline; P ≥ 1 admits all P helpers and runs items on them",
      res.every((o) => o.stats && o.stats.helpersAdmitted.length === o.P && (o.P === 0 ? o.stats.itemsHelper === 0 && o.stats.itemsInline > 0 : o.stats.itemsHelper > 0)));

    // a delayed low-index item with a fast-failing high-index item: the low index's error, through real workers
    {
      const patch = (n, t) => (n === "construct.js" ? t.replace("C.constructLayer = function (k, a) {",
        'C.constructLayer = function (k, a) { if (k === 2) { const t0 = Date.now(); while (Date.now() - t0 < 400) {} const e = new Error("injected F12_SLOW_2"); e.code = "F12_SLOW_2"; throw e; }' +
        ' if (k === 6) { const e = new Error("injected F12_FAST_6"); e.code = "F12_FAST_6"; throw e; }') : t);
      const pf = mk({ patch, opts: { helpers: 3 } }), fx = byId.get("n12-draft");
      const r = (await pf.ready) && (await admitted(pf, 3)) ? await submitFx(pf, fx).done : null, st = await pf.stats();
      check("NFR-05 F12 through real workers a slow failing item 2 beats a fast failing item 6 (lowest index, code and message verbatim)",
        !!r && r.status === "error" && r.response.error.code === "F12_SLOW_2" && r.response.error.message === "injected F12_SLOW_2" && st.helpersAdmitted.length === 3 && st.itemsHelper > 0);
      pf.terminate();
    }
    // a helper killed mid-item: the item re-runs inline in the coordinator, no error is surfaced, the result is the serial one
    {
      const patch = (n, t) => (n === "construct.js" ? t.replace("C.constructLayer = function (k, a) {",
        'C.constructLayer = function (k, a) { if (k === 3 && typeof self !== "undefined" && /^sb-helper/.test(String(self.name)) && typeof process !== "undefined") { const t0 = Date.now(); while (Date.now() - t0 < 20) {} process.exit(7); }') : t);
      const pk = mk({ patch, opts: { helpers: 2 } }), fx = byId.get("n12-draft");
      const r = (await pk.ready) && (await admitted(pk, 2)) ? await submitFx(pk, fx).done : null, st = await pk.stats();
      const helpersSpawned = pk.spawned.filter((w) => /^sb-helper/.test(w.name));
      check("NFR-05 F12 a helper killed mid-item yields the serial result (item re-run inline, no error surfaced)",
        !!r && r.status === "done" && sameGold(fx, r.response) && sync.has(fx.id) && Dq(r.response, sync.get(fx.id)) &&
        helpersSpawned.length > 2 && helpersSpawned.some((w) => w.terminated) && st.itemsInline > 0);
      pk.terminate();
    }
  } finally {
    for (const p of pools) p.terminate();
  }
});

// ------------------------------------------------ speed round F13 (S1, S2): helper pool, scheduling, memory gate, band kernels
suite("engine/worker.js/pool.js — speed round F13 scheduling, memory gate and band kernels (NFR-04, NFR-05)", async () => {
  const E = SBEngine, R = SBRaster, C = require("./pool_corpus.js"), Dq = C.deepEqualStrict, shim = require("./node_worker_shim.js");
  const JS = path.join(__dirname, "..", "js"), text = (n) => fs.readFileSync(path.join(JS, n), "utf8");
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
  const fields = ["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"];
  const sameGold = (fx, r) => { const d = C.digest(r), g = gold.fixtures[fx.id]; return !!g && fields.every((k) => JSON.stringify(d[k]) === JSON.stringify(g[k])); };
  const APPV = (text("app.js").match(/const APP_VERSION = "([^"]+)"/) || [])[1];
  const MiB = 1024 * 1024;
  check("F13 SBEngine exports bandRanges, lptOrder, memoryBudget, memoryLedger, checkTransfers; SBRaster resampleSpan, resampleBand",
    ["bandRanges", "lptOrder", "memoryBudget", "memoryLedger", "checkTransfers"].every((n) => typeof E[n] === "function") &&
    typeof R.resampleSpan === "function" && typeof R.resampleBand === "function");
  if (typeof E.memoryLedger !== "function" || typeof R.resampleBand !== "function") return;

  // ---- pure scheduling pieces
  check("F13 bandRanges: n near-equal bands covering [0, H) (n ≤ H); bandRows cuts fixed bands with a short tail; one band = serial",
    JSON.stringify(E.bandRanges(10, 3)) === "[[0,3],[3,6],[6,10]]" && JSON.stringify(E.bandRanges(2, 8)) === "[[0,1],[1,2]]" &&
    JSON.stringify(E.bandRanges(10, 1, 4)) === "[[0,4],[4,8],[8,10]]" && E.bandRanges(10, 1).length === 1 && E.bandRanges(10).length === 1);
  check("F13 lptOrder: largest cost first, ties and missing costs by index (dispatch order only)",
    JSON.stringify(E.lptOrder([0, 5, 9, 5, 1])) === "[2,1,3,4,0]" && JSON.stringify(E.lptOrder(null, 3)) === "[0,1,2]" && JSON.stringify(E.lptOrder([3, NaN, 3], 3)) === "[0,2,1]");
  check("NFR-04 F13 memory budget: deviceMemory absent = 512 MiB; min(1 GiB, deviceMemory·128 MiB) otherwise (Chromium's 8 → 1 GiB); mobile 192 MiB",
    E.memoryBudget(undefined, "desktop") === 512 * MiB && E.memoryBudget(NaN, "desktop") === 512 * MiB && E.memoryBudget(8, "desktop") === 1024 * MiB &&
    E.memoryBudget(2, "desktop") === 256 * MiB && E.memoryBudget(16, "desktop") === 1024 * MiB && E.memoryBudget(8, "mobile") === 192 * MiB && E.memoryBudget(undefined, "mobile") === 192 * MiB);
  {
    const L = E.memoryLedger(64 * MiB, 10 * MiB), a1 = L.admits(40 * MiB);
    L.take(40 * MiB);
    const a2 = L.admits(40 * MiB), a3 = L.admits(14 * MiB);
    L.give(40 * MiB);
    const big = E.memoryLedger(64 * MiB, 0), b1 = big.admits(100 * MiB);
    big.take(100 * MiB);
    const b2 = big.admits(1), over = E.memoryLedger(64 * MiB, 80 * MiB);
    const z = E.memoryLedger(64 * MiB, 64 * MiB);
    z.take(0);
    check("NFR-04 F13 memoryLedger at 64 MiB: base + in flight + item ≤ budget admits, more waits (serialises); peak tracked; an item counts ≥ 64 KiB",
      a1 && !a2 && a3 && L.used === 10 * MiB && L.peak === 50 * MiB && L.inFlight === 0 && z.used === 64 * MiB + 64 * 1024 && !z.admits(0));
    check("NFR-04 F13 an item larger than the budget is still admitted alone (and nothing next to it); a resident set over budget still runs one item",
      b1 && !b2 && big.inFlight === 1 && over.admits(1) === true);
  }
  {
    const owned = new Uint8Array(16), whole = new Uint8Array(8), sub = new Uint8Array(new ArrayBuffer(16), 4, 4), throwsCode = (f) => { try { f(); return null; } catch (e) { return e.code + ": " + e.message; } };
    const tSub = throwsCode(() => E.checkTransfers("construct", [[whole], [sub]], [owned])), tOwn = throwsCode(() => E.checkTransfers("construct", [[owned]], [owned]));
    check("F.3 F13 checkTransfers: whole unowned buffers pass; a subarray or a source/cache-owned buffer throws ENGINE_INTERNAL",
      throwsCode(() => E.checkTransfers("k", [[whole], null, []], [owned])) === null && /^ENGINE_INTERNAL: .*non-whole/.test(tSub || "") && /construct#1/.test(tSub || "") &&
      /^ENGINE_INTERNAL: .*keeps/.test(tOwn || "") && throwsCode(() => E.checkTransfers("k", [[owned.subarray(0, 8)]], [])) !== null);
  }

  // ---- resample band kernel: bands of only their source rows, concatenated, are byte-equal to the whole resample
  {
    let rs = 99173;
    const rnd = (n) => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return rs % n; };
    let cases = 0, bad = [];
    for (let t = 0; t < 120; t++) {
      const c = [1, 2, 3, 4][rnd(4)], w = 1 + rnd(60), h = 1 + rnd(60), method = ["area", "nearest", "none"][rnd(3)];
      const W = method === "none" ? w : 1 + rnd(w), H = method === "none" ? h : 1 + rnd(h);
      const px = new Uint8Array(w * h * c);
      for (let i = 0; i < px.length; i++) px[i] = rnd(4) === 0 ? 255 : rnd(256);
      const whole = R.resampleRows(px, c, w, h, W, H, method, 0, H), rows = 1 + rnd(5), out = new Uint8Array(W * H * c);
      for (const [Y0, Y1] of E.bandRanges(H, 1, rows)) {
        const sp = R.resampleSpan(w, h, W, H, method, Y0, Y1), src = px.slice(sp[0] * w * c, sp[1] * w * c), before = src.slice();
        out.set(R.resampleBand(src, c, w, h, W, H, method, Y0, Y1, sp[0]), Y0 * W * c);
        if (!src.every((v, i) => v === before[i])) bad.push("mutated " + t);
        cases++;
      }
      if (!whole.every((v, i) => v === out[i])) bad.push(t + " " + method + " " + w + "x" + h + "→" + W + "x" + H + " c" + c);
    }
    let wrongRows = null;
    try { R.resampleBand(new Uint8Array(40), 1, 10, 10, 5, 5, "area", 1, 2, 0); } catch (e) { wrongRows = e.code; }
    check(`S2 F13 resampleBand: 120 random rasters (area, nearest, none; 1–4 channels) in bands of 1–5 rows from only their source rows equal resampleRows (${cases} bands)` +
      (bad.length ? " — " + bad.slice(0, 5).join("; ") : ""), bad.length === 0 && cases > 300);
    check("F13 resampleBand refuses a slice that does not start at the band's first source row", wrongRows === "RESAMPLE_SIZE");
  }

  // ---- whole responses: banded resample + Kuwahara (sync driver with bandRows, and the adversarial executor) equal the serial engine
  const by = new Map(C.corpus().map((fx) => [fx.id, fx]));
  // fabrication fixtures that really downsample at fabrication (the F0 corpus fabricates at source size): RGBA area,
  // RGBA + alpha domain (area, Kuwahara with cnt), height (nearest)
  const fabFx = [["a3-900-fabrication", 0.8], ["alpha-domain-fabrication", 0.6], ["h-bonded-fabrication", 0.8]].map(([id, pitch]) => {
    const fx = by.get(id), p = JSON.parse(JSON.stringify(fx.project));
    p.geometry.fabPitchMM = pitch;
    return Object.assign({}, fx, { id: id + "@" + pitch, project: p });
  });
  const reqOf = (fx) => E.request(fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: fx.draftCapPx });
  const serial = new Map();
  const hooks0 = E.TEST_HOOKS;
  E.TEST_HOOKS = true;
  try {
    const kinds = {}, bad = [];
    for (const fx of fabFx) {
      const g = E.rasterPlan(fx.project, { w: fx.source.w, h: fx.source.h }, "fabrication", "desktop").geometry;
      if (!(g.rasterW < fx.source.w && g.resample !== "none")) bad.push(fx.id + " does not downsample");
      const s = E.generate(reqOf(fx), { overlays: fx.overlays });
      serial.set(fx.id, s);
      for (const br of [1, 4, 13]) {
        const r = E.generate(reqOf(fx), { overlays: fx.overlays, bandRows: br, kernelHook: (k, i, a, run) => { kinds[k] = (kinds[k] || 0) + 1; return run(); } });
        if (s.status !== "done" || !Dq(r, s)) bad.push(fx.id + " bandRows " + br);
      }
    }
    check(`NFR-05 F13 sync driver with bandRows 1/4/13: banded fabrication resample (area RGBA, area + alpha, nearest) and Kuwahara give the serial response ` +
      `(${kinds.resampleRows || 0} resample, ${kinds.kuwaharaRows || 0} Kuwahara band items)` + (bad.length ? " — " + bad.join("; ") : ""),
      bad.length === 0 && kinds.resampleRows > 100 && kinds.kuwaharaRows > 100);
    const refused = E.generate(reqOf(fabFx[0]), { bandRows: 0 }), hooksOff = (() => { E.TEST_HOOKS = false; try { return E.generate(reqOf(fabFx[0]), { bandRows: 4 }); } finally { E.TEST_HOOKS = true; } })();
    check("F13 bandRows is a test-only hook (refused unless SBEngine.TEST_HOOKS, and must be a positive integer)",
      refused.status === "error" && refused.error.code === "ENGINE_DEBUG_DISABLED" && hooksOff.status === "error" && hooksOff.error.code === "ENGINE_DEBUG_DISABLED");
    // the adversarial executor (seeded completion order, transfers detached, cloned results) with many bands
    const advBad = [], st = { batches: 0, reordered: 0, items: 0, transferred: 0, kuwahara: { items: 0, thin: 0, oneRow: 0, cnt: 0 } };
    for (const fx of fabFx) for (const seed of [1, 2, 3]) {
      const r = await E.generateAsync(reqOf(fx), { overlays: fx.overlays, bandRows: 1 + seed * 3, exec: makeAdvExec(E, seed * 7919, st) });
      if (!Dq(r, serial.get(fx.id))) advBad.push(fx.id + "@" + seed);
    }
    check(`NFR-05 F13 the adversarial executor with resample and Kuwahara bands equals the serial response (${st.kuwahara.items} Kuwahara slices checked, ${st.transferred} buffers detached)` +
      (advBad.length ? " — " + advBad.join("; ") : ""), advBad.length === 0 && st.kuwahara.items > 100 && st.kuwahara.cnt > 0 && st.transferred > 100);
    // an exec gets cost/estBytes/resident; LPT order changes dispatch only
    const seen = {};
    const lptExec = { map: async (kind, items, o) => {
      seen[kind] = { cost: o.cost, est: o.estBytes, resident: o.resident, n: items.length };
      const out = new Array(items.length);
      for (const i of E.lptOrder(o.cost, items.length)) out[i] = structuredClone(E.TASKS[kind](...structuredClone(items[i])));
      return out;
    } };
    const lfx = fabFx[1], lr = await E.generateAsync(reqOf(lfx), { overlays: lfx.overlays, exec: lptExec, bands: 3 });
    const cc = seen.construct;
    check("F13 batches carry LPT costs (construct: mask pixel counts, the base layer 0), per-item estBytes and the resident bytes; LPT dispatch gives the golden",
      !!cc && cc.cost.length === cc.n && cc.cost[0] === 0 && cc.cost[1] > 0 && cc.cost.every((v, k) => k < 2 || v <= cc.cost[k - 1]) && cc.est.length === cc.n &&
      cc.est.every((v) => v > 0) && cc.resident > 0 && !!seen.kuwaharaRows && seen.kuwaharaRows.n === 3 && seen.traceConvert && seen.traceConvert.cost.length === seen.traceConvert.n &&
      !!seen.resampleRows && seen.resampleRows.n === 6 && seen.supportPair.resident > 0 &&
      JSON.stringify(E.lptOrder(cc.cost)) !== JSON.stringify(cc.cost.map((_, i) => i)) && Dq(lr, serial.get(lfx.id)));
  } finally { E.TEST_HOOKS = hooks0; }

  // ---- the real pool (worker threads through the shim)
  vm.runInThisContext(text("pool.js"), { filename: "pool.js" });
  check("NFR-04 F13 SBPool.memoryBudget = SBEngine.memoryBudget", typeof SBPool.memoryBudget === "function" && SBPool.memoryBudget(undefined, "desktop") === 512 * MiB &&
    SBPool.memoryBudget(4, "desktop") === 512 * MiB && SBPool.memoryBudget(8, "mobile") === 192 * MiB);
  const pools = [];
  const mk = (o) => {
    o = o || {};
    const pool = SBPool.create(Object.assign({
      appVersion: APPV, helpers: 3, helloTimeoutMs: 20000,
      loadText: async (n) => (o.patch ? o.patch(n, text(n)) : text(n)),
      spawn: (name) => shim.spawn(path.join(JS, "worker.js"), { name, patch: o.patch || null }),
    }, o.opts || {}));
    pools.push(pool);
    return pool;
  };
  const srcOf = (fx) => Object.assign({ sampleHash: fx.project.source.sampleHash }, fx.source);
  const submitFx = (pool, fx, so) => { pool.setSource(srcOf(fx)); return pool.submit(reqOf(fx), Object.assign({ sampleHash: fx.project.source.sampleHash, gen: 1, overlays: fx.overlays }, so || {})); };
  const admitted = async (p, n) => { await p.helpersReady; for (let i = 0; i < 300; i++) { const s = await p.stats(); if (s && s.helpersAdmitted.length >= n) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };
  const runAll = async (pool, list, so) => { const out = []; for (const fx of list) { try { out.push([fx, (await submitFx(pool, fx, so).done).response]); } catch (e) { out.push([fx, { status: "threw", error: { code: e.code } }]); } } return out; };
  try {
    const tonal = ["a3-900-draft", "a3-900-fabrication", "alpha-domain-draft", "n12-draft"].map((id) => by.get(id));
    // bands through the pool: one band per admitted helper (3), Kuwahara and resample band items run on helpers
    {
      const pool = mk();
      const up = (await pool.ready) && (await admitted(pool, 3));
      const res = up ? await runAll(pool, fabFx.concat(tonal)) : [];
      const st = up ? await pool.stats() : null, wrong = res.filter(([fx, r]) => !(serial.has(fx.id) ? Dq(r, serial.get(fx.id)) : sameGold(fx, r))).map(([fx]) => fx.id);
      check("NFR-05 F13 Kuwahara and resample bands through the pool (3 helpers, 3 bands) equal the serial engine" + (wrong.length ? " — differ: " + wrong.join(", ") : ""),
        up && res.length === fabFx.length + tonal.length && wrong.length === 0);
      check(`F13 the band items ran on helpers (${st && JSON.stringify(st.helperKinds)}) with bands = admitted helpers`,
        !!st && st.bands === 3 && st.helperKinds.kuwaharaRows > 0 && st.helperKinds.resampleRows > 0 && st.helperKinds.construct > 0);
      check("F13 LPT: the coordinator dispatched construct largest mask first (the base layer 0, a copy, last)",
        !!st && Array.isArray(st.lastOrder.construct) && st.lastOrder.construct[st.lastOrder.construct.length - 1] === 0 && st.lastOrder.construct[0] !== 0);
      check(`NFR-04 F13 default budget (no deviceMemory in Node: 512 MiB) lets items run side by side (max in flight ${st && st.maxInFlight}, ledger peak ${st && (st.peakLedger / MiB).toFixed(1)} MiB)`,
        !!st && st.budgetBytes === 512 * MiB && st.maxInFlight > 1 && st.peakLedger > 0 && st.peakLedger <= 512 * MiB);
      pool.terminate();
    }
    // memory gate at 64 MiB: with the result on main filling the budget every batch serialises — and the output is unchanged
    {
      const pool = mk({ opts: { memoryBudget: 64 * MiB } });
      const up = (await pool.ready) && (await admitted(pool, 3));
      const res = up ? await runAll(pool, [fabFx[1]].concat(tonal), { mainBytes: 64 * MiB }) : [];
      const st = up ? await pool.stats() : null, wrong = res.filter(([fx, r]) => !(serial.has(fx.id) ? Dq(r, serial.get(fx.id)) : sameGold(fx, r))).map(([fx]) => fx.id);
      check(`NFR-04 F13 memory gate at 64 MiB serialises (max in flight ${st && st.maxInFlight}) and the responses stay identical` + (wrong.length ? " — differ: " + wrong.join(", ") : ""),
        up && !!st && st.budgetBytes === 64 * MiB && st.maxInFlight === 1 && st.itemsHelper > 0 && wrong.length === 0 && res.length === 1 + tonal.length);
      pool.terminate();
    }
    // F.3: transferring a subarray or a cache-owned buffer throws in the coordinator's exec (the engine-side check removed by a patch)
    for (const [label, decl] of [["a subarray of a mask", "masks.map((m) => [m.subarray(1)])"], ["the stored source", "masks.map(() => [ns.pixels])"]]) {
      const patch = new Function("n", "t", "return n === \"engine.js\" ? t.replace(\"E.checkTransfers(bt.kind, bt.transfer, ownedArrays(req, b.cache));\", \"\")" +
        ".replace(\"masks.map((mask, k) => [k, { mask, W, H, px: cpx, bonded, wantChange }]), masks.map((m) => [m]),\", " +
        JSON.stringify("masks.map((mask, k) => [k, { mask, W, H, px: cpx, bonded, wantChange }]), " + decl + ",") + ") : t;");
      const pool = mk({ patch, opts: { helpers: 1 } }), fx = by.get("n12-draft");
      const ok = (await pool.ready) && (await admitted(pool, 1));
      let r = null;
      try { r = ok ? (await submitFx(pool, fx).done).response : null; } catch (e) { r = { status: "threw", error: { code: e.code } }; }
      check("F.3 F13 transferring " + label + " throws in exec (ENGINE_INTERNAL, never silently copied)",
        ok && !!r && r.status === "error" && r.error.code === "ENGINE_INTERNAL" && /transfer/.test(r.error.message));
      pool.terminate();
    }
    const wsrc = text("worker.js");
    check("F13 worker.js: LPT dispatch, the estBytes ledger, transfer checks and result buffers transferred back",
      /E\.lptOrder\(/.test(wsrc) && /E\.memoryLedger\(/.test(wsrc) && /E\.checkTransfers\(/.test(wsrc) && /postMessage\(out, tr\)/.test(wsrc) && /budgetBytes/.test(text("pool.js")));
  } finally {
    for (const p of pools) p.terminate();
  }
});

// ------------------------------------------------ speed round F14 (S1): cancellation (AT-15) and watchdog
suite("engine/worker.js/pool.js — speed round F14 cancellation (AT-15) and watchdog (NFR-02, UI-06, F-D2)", async () => {
  const E = SBEngine, R = SBRaster, Hh = SBHeight, Cn = SBConstruct, C = require("./pool_corpus.js"), Dq = C.deepEqualStrict, shim = require("./node_worker_shim.js");
  const JS = path.join(__dirname, "..", "js"), text = (n) => fs.readFileSync(path.join(JS, n), "utf8");
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
  const fields = ["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"];
  const sameGold = (fx, r) => { const d = C.digest(r), g = gold.fixtures[fx.id]; return !!g && fields.every((k) => JSON.stringify(d[k]) === JSON.stringify(g[k])); };
  const APPV = (text("app.js").match(/const APP_VERSION = "([^"]+)"/) || [])[1];
  const all = C.corpus().filter((fx) => !fx.slow), by = new Map(all.map((fx) => [fx.id, fx]));
  const reqOf = (fx, project) => E.request(project || fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: fx.draftCapPx });
  const bytesEq = (a, b) => !!a && !!b && a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
  const counter = () => { const f = () => { f.n++; }; f.n = 0; return f; };
  const throwsCanceled = (fn) => { try { fn(); return false; } catch (e) { return typeof E.Canceled === "function" && e instanceof E.Canceled; } };
  const cancelAfter = (n) => { let c = 0; return () => { if (++c > n) throw new E.Canceled(); }; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();

  check("F14 SBEngine.Canceled is exported (what a canceled run throws; the coordinator rejects an aborted batch with it)", typeof E.Canceled === "function");
  if (typeof E.Canceled !== "function") return;

  // ---- 1. the long serial coordinator kernels poll the cancel flag every few rows; outputs unchanged
  {
    const w = 97, h = 300, L = new Float32Array(w * h).map((_, i) => (i * 7919) % 256), dom = new Uint8Array(w * h).map((_, i) => (i % 5 === 0 ? 0 : 1));
    const c1 = counter(), c2 = counter();
    const ok1 = bytesEq(R.kuwahara(L, w, h, 3, 2, null), R.kuwahara(L, w, h, 3, 2, null, c1)), ok2 = bytesEq(R.kuwahara(L, w, h, 3, 2, dom), R.kuwahara(L, w, h, 3, 2, dom, c2));
    check(`F14 R.kuwahara(…, poll) polls every few rows (${c1.n}, ${c2.n} polls for 2 passes of ${h} rows) and its output is byte-identical`,
      ok1 && ok2 && c1.n >= 2 * Math.floor(h / 64) && c2.n >= 2 * Math.floor(h / 64));
    check("F14 R.kuwahara: a poll that throws Canceled stops the pass", throwsCanceled(() => R.kuwahara(L, w, h, 3, 2, dom, cancelAfter(2))));
    const bands = E.bandRanges(h, 3, null), c3 = counter(), s0 = R.kuwaharaSeeds(L, w, h, bands, 3, dom), s1 = R.kuwaharaSeeds(L, w, h, bands, 3, dom, c3);
    check(`F14 R.kuwaharaSeeds(…, poll) polls during the rolling SAT scan (${c3.n} polls) and its seed rows are byte-identical`,
      c3.n >= Math.floor(bands[bands.length - 1][0] / 64) && c3.n >= 2 && s0.every((s, b) => s.s === s1[b].s && bytesEq(s.sat, s1[b].sat) && bytesEq(s.sat2, s1[b].sat2) && bytesEq(s.cnt, s1[b].cnt)));
    check("F14 R.kuwaharaSeeds: a poll that throws Canceled stops the scan", throwsCanceled(() => R.kuwaharaSeeds(L, w, h, bands, 3, dom, cancelAfter(1))));
    const N = 6, added = new Uint8Array(w * h).map((_, i) => (i * 31) % (N + 1)), c4 = counter();
    const m0 = Hh.cumulativeMasks(added, dom, N, w, h), m1 = Hh.cumulativeMasks(added, dom, N, w, h, c4);
    check(`F14 SBHeight.cumulativeMasks(…, poll) polls every few rows (${c4.n} polls) and its masks are byte-identical`,
      m0.length === N && m1.length === N && m0.every((m, k) => bytesEq(m, m1[k])) && c4.n >= (N - 1) * Math.floor(h / 64));
    check("F14 SBHeight.cumulativeMasks: a poll that throws Canceled stops it", throwsCanceled(() => Hh.cumulativeMasks(added, dom, N, w, h, cancelAfter(3))));
    const gopts = { deviceClass: "desktop", simplify: "busy", minFeatureMM: 0.5, minPartMM2: 1, sxUm: 100, syUm: 100, quality: "draft", revision: 1 };
    const c5 = counter(), g0 = Cn.complexityGate(m0, w, h, gopts), g1 = Cn.complexityGate(m0, w, h, Object.assign({ poll: c5 }, gopts));
    check(`F14 SBConstruct.complexityGate(opts.poll) polls per layer in the simplification and the estimate (${c5.n} polls); result identical`,
      c5.n >= 2 * N && JSON.stringify(g0.estimate) === JSON.stringify(g1.estimate) && JSON.stringify(g0.simplified) === JSON.stringify(g1.simplified) &&
      g0.masks.every((m, k) => bytesEq(m, g1.masks[k])) && JSON.stringify(g0.diagnostics) === JSON.stringify(g1.diagnostics));
    check("F14 SBConstruct.complexityGate: a poll that throws Canceled stops it", throwsCanceled(() => Cn.complexityGate(m0, w, h, Object.assign({}, gopts, { poll: cancelAfter(2) }))));
  }

  // ---- 2. the engine checks the flag at every step(), inside those kernels, and before every dispatch
  {
    const stageCalls = async (fx) => {
      const per = {};
      let stage = "begin";
      const r = E.generate(reqOf(fx), { isCanceled: () => { per[stage] = (per[stage] || 0) + 1; return false; }, onProgress: (s) => { stage = s; } });
      return { r, per };
    };
    const t = await stageCalls(by.get("n3-draft")), hb = await stageCalls(by.get("h-bonded-draft"));
    check(`F14 the sync driver polls inside interpret (Kuwahara), masks and the complexity gate (calls per stage ${JSON.stringify(t.per)}) and the response equals the golden`,
      sameGold(by.get("n3-draft"), t.r) && sameGold(by.get("h-bonded-draft"), hb.r) && t.per.interpret > 2 && t.per.masks > 2 && t.per.complexity > 2 && hb.per.masks > 2);
    const fx = by.get("h-bonded-draft"), req = reqOf(fx), inl = (kind, items) => items.map((a) => E.TASKS[kind].apply(null, a));
    const kinds = [];
    await E.generateAsync(req, { exec: { map: async (kind, items) => { kinds.push(kind); return inl(kind, items); } } });
    const wrong = [];
    for (let j = 1; j <= kinds.length; j++) {
      let maps = 0;
      const r = await E.generateAsync(req, { exec: { map: async (kind, items) => { maps++; return inl(kind, items); } }, isCanceled: () => maps >= j });
      if (r.status !== "canceled" || maps !== j) wrong.push(j + ": " + r.status + " after " + maps + " dispatches");
    }
    check(`F14 generateAsync checks the cancel flag before every dispatch (${kinds.length} yields; canceled after the j-th batch, never dispatching the next)` +
      (wrong.length ? " — " + wrong.join("; ") : ""), kinds.length >= 6 && wrong.length === 0);
    const rej = await E.generateAsync(req, { exec: { map: async () => { throw new E.Canceled(); } } });
    check("F14 an exec.map that rejects with SBEngine.Canceled (an aborted batch) settles the run as canceled", rej.status === "canceled");
  }

  // ---- 3. the pool: cooperative cancel, stale results, watchdog, respawn, resubmission
  vm.runInThisContext(text("pool.js"), { filename: "pool.js" });
  const wsrc = text("worker.js"), psrc = text("pool.js");
  check("F14 pool.js: a main-thread watchdog (300 ms default) terminates a coordinator that does not answer a cancel; warm spares; health()",
    /watchdogMs/.test(psrc) && /\b300\b/.test(psrc) && /spare/i.test(psrc) && /pool\.health = /.test(psrc));
  check("F14 worker.js: items and itemResults carry the runId; stale helper results are dropped; stuck helpers are reported with killHelper",
    /type: "item", runId/.test(wsrc) && /staleDropped/.test(wsrc) && /reason: "stuck"/.test(wsrc) && /Atomics\.load/.test(wsrc));
  const pools = [];
  const mk = (o) => {
    o = o || {};
    const spawned = [];
    const pool = SBPool.create(Object.assign({
      appVersion: APPV, helpers: 2, helloTimeoutMs: 20000,
      loadText: async (n) => (o.patch ? o.patch(n, text(n)) : text(n)),   // a consistent deploy: the page reads the texts the workers run
      spawn: (name) => {
        const p = o.patchFor ? o.patchFor(name, spawned.filter((x) => x.name === name).length) : o.patch || null;
        const w = shim.spawn(path.join(JS, "worker.js"), { name, patch: p });
        spawned.push(w);
        return w;
      },
    }, o.opts || {}));
    pool.spawned = spawned;
    pools.push(pool);
    return pool;
  };
  const srcOf = (fx) => Object.assign({ sampleHash: fx.project.source.sampleHash }, fx.source);
  const submitFx = (pool, fx, extra, project) => {
    pool.setSource(srcOf(fx));
    return pool.submit(reqOf(fx, project), Object.assign({ sampleHash: fx.project.source.sampleHash, gen: 1, overlays: fx.overlays }, extra || {}));
  };
  const admitted = async (p, n) => { await p.helpersReady; for (let i = 0; i < 300; i++) { const s = await p.stats(); if (s && s.helpersAdmitted.length >= n) return true; await sleep(10); } return false; };
  const until = async (fn, ms) => { const t0 = now(); while (now() - t0 < ms) { if (await fn()) return true; await sleep(5); } return false; };
  const inStage = (pool, runId, stage) => until(async () => { const s = await pool.stats(); return !!s && s.running === runId && s.stage === stage; }, 5000);
  const started = (extra) => { let go; const p = new Promise((r) => { go = r; }); return [p, Object.assign({ onStart: () => go() }, extra || {})]; };
  const activeOf = (h, gen, fx, overlays) => ({ runId: h.runId, gen, sampleHash: fx.project.source.sampleHash, overlays: overlays === undefined ? fx.overlays : overlays, deviceClass: fx.deviceClass });
  // helpers (only) sleep in construct layer 1 when the raster is cond (test-only patch, applied to every spawn and the page texts)
  const slowHelper = (ms, cond) => new Function("n", "t", "return n === \"construct.js\" ? t.replace(\"C.constructLayer = function (k, a) {\", " +
    JSON.stringify("C.constructLayer = function (k, a) { if (k === 1 && (" + cond + ") && typeof self !== \"undefined\" && /^sb-helper/.test(String(self.name))) " +
      "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, " + ms + ");") + ") : t;");
  const sync = new Map();
  const syncOf = (fx, project) => { const k = fx.id + (project ? "*" : ""); if (!sync.has(k)) sync.set(k, E.generate(reqOf(fx, project))); return sync.get(k); };
  try {
    // 3a. cooperative cancel, K1/K2 untouched, stale helper results dropped, supersede, overlay toggle / double submit, cancel during export
    {
      // helperStuckMs is generous here: the abandoned 250 ms item answers ~270 ms after the cancel, which raced the 300 ms
      // default stuck timer under machine load (the helper was then killed as stuck). This block checks the late result
      // is dropped and the helper reused; the stuck path itself (300 ms default) is 3b.
      const pool = mk({ patch: slowHelper(250, "true"), opts: { helperStuckMs: 15000 } }), fx = by.get("n3-draft"), fab = by.get("n3-fabrication");
      const up = (await pool.ready) && (await admitted(pool, 2));
      check("F14 the slow-helper pool is up with 2 helpers", up);
      if (up) {
        const d0 = await submitFx(pool, fx).done, st0 = await pool.stats();
        check("F14 a completed draft commits K1/K2 in the coordinator (stats name both keys)", d0.status === "done" && sameGold(fx, d0.response) && !!st0.k1Key && !!st0.k2Key);
        const pA = JSON.parse(JSON.stringify(fx.project));
        pA.interpretation.smoothing.radiusMM = 2.4;   // a K2 edit: K1 hits, K2 is recomputed in the run's scratch slots
        const a = submitFx(pool, fx, { gen: 2 }, pA);
        const reached = await inStage(pool, a.runId, "construct");
        const t0 = now();
        pool.cancel(a.runId);
        const ra = await a.done, dt = now() - t0, st1 = await pool.stats();
        check(`AT-15 F14 a cooperative cancel answers canceled in ${dt.toFixed(0)} ms (< 300 ms, no watchdog) without waiting for the busy helper`,
          reached && ra.status === "canceled" && ra.response === null && dt < 300 && pool.health().watchdogKills === 0);
        check("AT-15 F14 a canceled run leaves K1/K2 unchanged (its scratch K2 is never committed)", st1.k1Key === st0.k1Key && st1.k2Key === st0.k2Key && st1.k2Bytes === st0.k2Bytes);
        // wait for the event itself (every abandoned item's late result is in), not a fixed sleep
        const settled = await until(async () => { const s = await pool.stats(); return !!s && s.staleDropped >= 1 && s.abandoned === 0; }, 15000);
        const st2 = await pool.stats();
        check(`F14 the abandoned helper item's late result (old runId) is dropped (${st2.staleDropped} dropped) and the helper is free again`,
          settled && st2.staleDropped >= 1 && st2.abandoned === 0 && st2.helpersAdmitted.length === 2 && st2.stuckKilled === 0);
        // supersede: a draft in flight, the next draft submitted — the coordinator waits for canceled, then runs it on the cache
        const a2 = submitFx(pool, fx, { gen: 3 }, pA);
        const reached2 = await inStage(pool, a2.runId, "construct");
        const seen = [], b = submitFx(pool, fx, { gen: 4, onProgress: (p) => seen.push(p.stage) });
        const ra2 = await a2.done, rb = await b.done;
        check("AT-15 F14 a superseded draft returns canceled and the next draft reports resample-cached and equals the sync response",
          reached2 && ra2.status === "canceled" && rb.status === "done" && seen[0] === "resample-cached" && Dq(rb.response, syncOf(fx)));
        check("AT-15 stale response discarded: SBDiag.acceptResult drops the superseded run for the active one",
          SBDiag.acceptResult(activeOf(b, 4, fx), rb) && !SBDiag.acceptResult(activeOf(b, 4, fx), Object.assign({}, ra2, { gen: 4 })));
        // overlay toggle and a same-revision double submit: only the last run is ever shown
        const x = submitFx(pool, fx, { gen: 5, overlays: true }), y = submitFx(pool, fx, { gen: 5, overlays: false }), z = submitFx(pool, fx, { gen: 5, overlays: true });
        const [rx, ry, rz] = [await x.done, await y.done, await z.done], act = activeOf(z, 5, fx, true);
        check("AT-15 F14 overlay toggle and a same-revision double submit never show the older run (both canceled, acceptResult false; the last equals sync)",
          rx.status === "canceled" && ry.status === "canceled" && !SBDiag.acceptResult(act, rx) && !SBDiag.acceptResult(act, ry) &&
          SBDiag.acceptResult(act, rz) && rz.status === "done" && Dq(rz.response, syncOf(fx)));
        // cancel during export: the fabrication run is canceled; source, K1/K2 and the last draft revision are kept
        const st3 = await pool.stats(), f = submitFx(pool, fab, { gen: 6 });
        const reachedF = await inStage(pool, f.runId, "construct");
        pool.cancel(f.runId);
        const rf = await f.done, st4 = await pool.stats();
        const seen2 = [], d1 = await submitFx(pool, fx, { gen: 7, onProgress: (p) => seen2.push(p.stage) }).done;
        check("AT-15 cancel during export keeps last revision and source (fabrication canceled; stored source and K1/K2 unchanged; the draft is served from the cache)",
          reachedF && rf.status === "canceled" && st4.sampleHash === st3.sampleHash && st4.sourceBytes === st3.sourceBytes && st4.k1Key === st3.k1Key && st4.k2Key === st3.k2Key &&
          d1.status === "done" && seen2[0] === "resample-cached" && Dq(d1.response, d0.response));
      }
      pool.terminate();
    }

    // 3b. a stuck helper: reported with killHelper after the stuck timeout, replaced from the warm spare (new hello + modulesHash)
    {
      const fx = by.get("n3-draft"), next = by.get("t-light-draft");
      const W = E.rasterPlan(fx.project, { w: fx.source.w, h: fx.source.h }, fx.quality, fx.deviceClass, fx.draftCapPx).geometry.rasterW;
      const Wn = E.rasterPlan(next.project, { w: next.source.w, h: next.source.h }, next.quality, next.deviceClass, next.draftCapPx).geometry.rasterW;
      const pool = mk({ patch: slowHelper(4000, "a.W === " + W) });
      const up = (await pool.ready) && (await admitted(pool, 2)) && (await until(async () => pool.health().spareHelperReady, 5000));
      const a = submitFx(pool, fx), reached = up && (await inStage(pool, a.runId, "construct"));
      const t0 = now();
      pool.cancel(a.runId);
      const ra = await a.done, dt = now() - t0;
      const replaced = await until(async () => { const s = await pool.stats(); return s.stuckKilled >= 1 && s.helpersAdmitted.length === 2; }, 3000);
      const st = await pool.stats(), hl = pool.health();
      const r2 = await submitFx(pool, next, { gen: 2 }).done;
      check(`F14 a helper stuck in an item is reported with killHelper (stuck) and replaced from the warm spare; cancel answered in ${dt.toFixed(0)} ms`,
        // >= 1: the 4 s helper is always killed; under machine load the other helper's abandoned item can also outlast 300 ms
        // and is then (correctly) killed and replaced as well
        W !== Wn && reached && ra.status === "canceled" && dt < 300 && replaced && st.stuckKilled >= 1 && hl.spareHelperUsed >= 1 && hl.watchdogKills === 0 &&
        pool.spawned.some((w) => /^sb-helper/.test(w.name) && w.terminated));
      check("F14 after the replacement the next draft equals the sync response (the spare said hello with the same modulesHash and is admitted)",
        r2.status === "done" && sameGold(next, r2.response) && Dq(r2.response, syncOf(next)) && st.helpersRefused.length === 0);
      pool.terminate();
    }

    // 3c. a stuck coordinator: the watchdog terminates it 300 ms after the cancel and the pool respawns in < 500 ms (cold)
    {
      const stuck = (n, t) => (n === "worker.js" ? t.replace('post({ type: "ack", runId: m.runId });', 'post({ type: "ack", runId: m.runId }); if (m.gen === "stuck") for (;;) {}') : t);
      const pool = mk({ patch: stuck }), fx = by.get("t-light-draft");
      const up = (await pool.ready) && (await admitted(pool, 2)) && (await until(async () => pool.health().spareCoordReady, 5000));
      const d0 = up ? await submitFx(pool, fx).done : null;
      const helpers0 = pool.spawned.filter((w) => /^sb-helper/.test(w.name) && !w.terminated).length;
      const [go, so] = started({ gen: "stuck" });
      const s = submitFx(pool, fx, so);
      await go;
      const t0 = now();
      pool.cancel(s.runId);
      const rs = await s.done, dt = now() - t0;
      await pool.ready;
      const hl = pool.health(), seen = [];
      const r2 = await submitFx(pool, fx, { gen: 2, onProgress: (p) => seen.push(p.stage) }).done, st = await pool.stats();
      check(`NFR-02 F14 a stuck coordinator is terminated by the watchdog ${dt.toFixed(0)} ms after the cancel (300 ms) and the run settles canceled (≤ 500 ms)`,
        !!d0 && d0.status === "done" && rs.status === "canceled" && rs.watchdog === true && dt >= 295 && dt < 500 && hl.watchdogKills === 1 &&
        pool.spawned.filter((w) => w.name === "sb-coord" && w.terminated).length === 1);
      check(`NFR-02 F14 the coordinator is respawned in ${hl.lastRespawnMs && hl.lastRespawnMs.toFixed(0)} ms (< 500 ms: warm spare, source re-posted, ports re-brokered to the same helpers)`,
        Number.isFinite(hl.lastRespawnMs) && hl.lastRespawnMs < 500 && hl.spareCoordUsed === 1 && st.helpersAdmitted.length === 2 &&
        pool.spawned.filter((w) => /^sb-helper/.test(w.name) && !w.terminated).length === helpers0);
      check("F14 the next draft after a terminate is correct and cold (orient, not resample-cached)", r2.status === "done" && seen[0] === "orient" && Dq(r2.response, syncOf(fx)));
      // superseding a stuck run: the next run is resubmitted to the respawned coordinator and never shown as an error
      const s2 = submitFx(pool, fx, { gen: "stuck" });
      await sleep(30);
      const t1 = now(), nx = submitFx(pool, fx, { gen: 3 });
      const rs2 = await s2.done, rn = await nx.done, dt2 = now() - t1;
      check(`F14 a stuck run superseded by the next draft: canceled by the watchdog, the next draft resubmitted and correct (${dt2.toFixed(0)} ms)`,
        rs2.status === "canceled" && rn.status === "done" && Dq(rn.response, syncOf(fx)) && pool.health().watchdogKills === 2 && pool.health().resubmits >= 1);
      pool.terminate();
    }

    // 3d. the shared cancel flag stops a coordinator inside a long serial kernel (it cannot read messages there)
    {
      const spin = (n, t) => (n === "height.js" ? t.replace("Hh.cumulativeMasks = function (added, domain, N, w, h, poll) {",
        "Hh.cumulativeMasks = function (added, domain, N, w, h, poll) { if (N === 12 && poll && typeof self !== \"undefined\" && self.name === \"sb-coord\" && !globalThis.__spun) { globalThis.__spun = 1; self.postMessage({ type: \"test-spinning\" }); for (;;) poll(); }") : t);
      const pool = mk({ patch: spin, opts: { spares: false } }), fx = by.get("n12-draft");
      const up = (await pool.ready) && (await admitted(pool, 2));
      // cancel only once the coordinator is inside the spin (it says so first; the pool ignores the unknown type). A fixed
      // sleep let a loaded machine cancel before the spin: the run ended cooperatively and the next draft spun forever.
      let spinning;
      const spun = new Promise((r) => { spinning = r; }), coord = up && pool.spawned.find((w) => w.name === "sb-coord");
      if (coord) { const on = coord.onmessage; coord.onmessage = (ev) => { if (ev.data && ev.data.type === "test-spinning") spinning(true); on(ev); }; }
      const s = coord ? submitFx(pool, fx) : null;
      if (s && (await Promise.race([spun, sleep(30000).then(() => false)]))) {
        const t0 = now();
        pool.cancel(s.runId);
        const rs = await s.done, dt = now() - t0, r2 = await submitFx(pool, fx, { gen: 2 }).done;
        check(`F14 a coordinator inside cumulativeMasks sees the shared cancel flag (poll every few rows) and answers canceled in ${dt.toFixed(0)} ms without the watchdog`,
          pool.health().sharedCancel === true && rs.status === "canceled" && !rs.watchdog && dt < 300 && pool.health().watchdogKills === 0 &&
          pool.spawned.filter((w) => w.name === "sb-coord").length === 1 && r2.status === "done" && sameGold(fx, r2.response));
      } else check("F14 the spin pool is up and its coordinator reached the spin", false);
      pool.terminate();
    }

    // 3e. the coordinator killed at each yield index: the run is resubmitted (never an error) and equals the sync response
    {
      const fx = by.get("h-bonded-draft"), req = reqOf(fx), kinds = [];
      await E.generateAsync(req, { exec: { map: async (kind, items) => { kinds.push(kind); return items.map((a) => E.TASKS[kind].apply(null, a)); } } });
      const kill = (i) => "function (n, t) { return n === \"worker.js\" ? t.replace(\"const fn = E.TASKS[kind];\", " +
        JSON.stringify("if ((globalThis.__y = (globalThis.__y || 0) + 1) === " + i + ") process.exit(3); const fn = E.TASKS[kind];") + ") : t; }";
      const bad = [];
      const one = async (i) => {
        const pool = mk({ patchFor: (name, n) => (name === "sb-coord" && n === 0 ? kill(i) : null), opts: { helpers: 1 } });
        try {
          if (!(await pool.ready)) { bad.push(i + ": not up"); return; }
          let r;
          try { r = await submitFx(pool, fx).done; } catch (e) { bad.push(i + ": rejected " + e.code); return; }
          const hl = pool.health();
          if (r.status !== "done" || !sameGold(fx, r.response) || !Dq(r.response, syncOf(fx)) || hl.resubmits !== 1 || hl.crashes !== 1) bad.push(i + ": " + r.status + " " + JSON.stringify(hl));
        } finally { pool.terminate(); }
      };
      for (let i = 1; i <= kinds.length; i += 4) await Promise.all([i, i + 1, i + 2, i + 3].filter((j) => j <= kinds.length).map(one));
      check(`F14 the coordinator killed at each of the ${kinds.length} yield indices: the run is resubmitted (never shown as an error) and equals the sync digest` +
        (bad.length ? " — " + bad.join("; ") : ""), kinds.length >= 6 && bad.length === 0);
    }
  } finally {
    for (const p of pools) p.terminate();
  }
});

// ------------------------------------------------ speed round F15 (app wiring, progress UI, serial fallback)
suite("app.js/index.html/schema.js — speed round F15 app wiring, progress UI and the serial fallback (PO-PERF-1, NFR-02, UI-05, UI-06, AT-15, F-D5)", () => {
  const root = path.join(__dirname, ".."), E = SBEngine, S = SBSchema, F = require("./fixtures.js");
  const appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8"), html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  const span = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? [-1, -1] : [i, appSrc.indexOf("\n  }\n", i)]; };
  const all = (re) => { const out = []; let m; const g = new RegExp(re.source, "g"); while ((m = g.exec(appSrc))) out.push(m.index); return out; };
  const inside = (idx, names) => names.some((n) => { const [a, b] = span(n); return a >= 0 && idx > a && idx < b; });
  const rg = fn("regenerate"), fr = fn("fabReview"), rf = fn("regenerateFallback"), ff = fn("fabFallback");
  const FALLBACK = ["regenerateFallback", "fabFallback"];

  check("PO-PERF-1 regenerate and fabReview submit to the worker pool (pool.submit) and show a result only through SBDiag.acceptResult (AT-15)",
    /\bpool\.submit\(\s*SBEngine\.request\([^)]*quality:\s*"draft"/.test(rg) && /\bpool\.submit\(\s*SBEngine\.request\([^)]*quality:\s*"fabrication"/.test(fr) &&
    /SBDiag\.acceptResult\(/.test(rg) && /SBDiag\.acceptResult\(/.test(fr) && /sampleHash/.test(rg) && /sampleHash/.test(fr));
  check("PO-PERF-1 app.js creates one pool (SBPool.create with appVersion: APP_VERSION and onState) and posts the installed source (pool.setSource)",
    /SBPool\.create\(\{[^}]*appVersion: APP_VERSION[^}]*onState/.test(appSrc) && /pool\.setSource\(run\.src\)/.test(rg) && /pool\.setSource\(run\.src\)/.test(fr) &&
    /startPool\(\)/.test(fn("init")) && fn("init").indexOf("startPool()") < fn("init").lastIndexOf("regenerate()"));
  check("F15 the sync driver is the only fallback driver: the literal SBEngine.generate( appears only in regenerateFallback and fabFallback; no third driver",
    rf.length > 0 && ff.length > 0 && all(/SBEngine\.generate\(/).length === 2 && all(/SBEngine\.generate\(/).every((i) => inside(i, FALLBACK)) &&
    !/SBEngine\.generateAsync\(|runSteps/.test(appSrc));
  check("F15 rAF + setTimeout and the \"will not respond\" text exist only in the fallback branch",
    all(/requestAnimationFrame\(\(\) => setTimeout\(/).length === 2 && all(/requestAnimationFrame\(\(\) => setTimeout\(/).every((i) => inside(i, FALLBACK)) &&
    all(/will not respond/).length > 0 && all(/will not respond/).every((i) => inside(i, ["fabFallback"])) &&
    !/requestAnimationFrame|setTimeout|will not respond/.test(rg + fr));
  check("F-D5 the fallback branch passes draftCapPx: SBSchema.limits(dc).draftPxFallback (the pooled path keeps the request default)",
    /SBEngine\.request\([^;]*draftCapPx: SBSchema\.limits\(dc\)\.draftPxFallback/.test(rf) && /SBEngine\.request\([^;]*draftCapPx: SBSchema\.limits\(dc\)\.draftPxFallback/.test(ff) &&
    !/draftCapPx:/.test(rg + fr));
  check("F15 the pool ladders to the serial fallback: POOL_UNAVAILABLE reruns the draft in regenerateFallback and the fabrication run in fabFallback",
    /POOL_UNAVAILABLE[\s\S]{0,200}regenerateFallback\(/.test(rg) && /POOL_UNAVAILABLE[\s\S]{0,200}fabFallback\(/.test(fr) && /!usePool\(\)/.test(rg) && /!usePool\(\)/.test(fr));
  check("F15 the fallback shows the pool's \"reduced responsiveness\" notice (#pool-notice, onState)",
    /reduced responsiveness/.test(appSrc) && /id="pool-notice"/.test(html) && /pool-notice/.test(fn("poolState")) && /notice/.test(fn("poolState")));
  check("UI-06 an edit cancels an in-flight fabrication run (\"fabrication restarted\"); the run restarts after the draft",
    /cancelFab\("restart"\)/.test(fn("recompute")) && /fabrication restarted/.test(appSrc) && /pool\.cancel\(/.test(fn("cancelFab")) &&
    /fabRestart/.test(fn("applyDraft")) && /previewFabrication\(\)/.test(fn("applyDraft")));
  check("NFR-02 the fabrication Cancel button (#btn-fabcancel in the Review stage) cancels the pooled run",
    (() => { const m = /<section class="step" id="stage-review"[\s\S]*?<\/section>/.exec(html); return !!m && /id="btn-fabcancel"[^>]*hidden/.test(m[0]); })() &&
    /\$\("btn-fabcancel"\)\.addEventListener\("click", \(\) => cancelFab\("user"\)\)/.test(appSrc) && /fabrication run canceled/.test(appSrc));
  check("UI-05 progress bar and stage label from the pool's progress, painted at most once per animation frame",
    /id="run-progress"/.test(html) && /<progress id="run-progress-bar"/.test(html) && /id="run-progress-label"/.test(html) && /\.runprogress\b/.test(css) &&
    /onProgress:[^\n]*showProgress\(/.test(rg) && /onProgress:[^\n]*showProgress\(/.test(fr) &&
    /if \(!progress\.raf\) progress\.raf = requestAnimationFrame\(paintProgress\)/.test(fn("showProgress")) && /run-progress-bar/.test(fn("paintProgress")));
  check("UI-05 one result path: applyDraft (pool and fallback) keeps acks for the same geometryHash and drops a superseded revision",
    /applyDraft\(/.test(rg) && /applyDraft\(/.test(rf) && /geometryHash === [^;]*geometryHash[^;]*\.acks/.test(fn("applyDraft")) &&
    /rev !== project\.revision/.test(fn("applyDraft")));
  check("NFR-02 the busy estimate stays SBSchema.limits(…).fabMsPerMpx in both branches", /fabMsPerMpx/.test(fn("fabBusyText")) && /fabBusyText\(/.test(fr) && /fabBusyText\(/.test(ff));
  check("F15 index.html no longer says the page does not respond (the pool keeps it responsive)", !/does not respond/.test(html));

  const L = (dc) => S.limits(dc);
  check("F-D5 SBSchema.limits(dc).draftPxFallback is 720 on desktop and mobile", L("desktop").draftPxFallback === 720 && L("mobile").draftPxFallback === 720);
  const w = 1600, h = 1200, px = { pixels: F.heightMap(15, w, h), channels: 1, w, h, alpha: null };
  const p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); p.geometry.targetMM = 40; p.geometry.draftPx = 1600;
  const fb = E.request(p, px, { quality: "draft", deviceClass: "desktop", draftCapPx: L("desktop").draftPxFallback });
  const plan = E.rasterPlan(p, { w, h }, "draft", "desktop", fb.draftCapPx).geometry;
  check("F-D5 the fallback request copies draftPxFallback and its draft raster's long side is ≤ 720",
    fb.draftCapPx === 720 && Math.max(plan.rasterW, plan.rasterH) <= 720);
  const q = JSON.parse(JSON.stringify(p)); q.geometry.targetMM = 12;
  const sm = { pixels: F.heightMap(16, 160, 120), channels: 1, w: 160, h: 120, alpha: null };
  const q2 = S.withSource(q, E.sourceRecord(sm, { format: "png", decode: "raw-gray8" }));
  const a = E.generate(E.request(q2, sm, { quality: "fabrication", deviceClass: "desktop", draftCapPx: 64 })),
    b = E.generate(E.request(q2, sm, { quality: "fabrication", deviceClass: "desktop" }));
  check("F-D5 fabrication is unaffected by draftCapPx (fallback and pooled fabrication give the same geometryHash)",
    a.status === "done" && b.status === "done" && a.snapshot.geometryHash === b.snapshot.geometryHash);
});

// ------------------------------------------------ speed round F16 (dist/ Blob worker and fallback ladder)
suite("build.js/pool.js/worker.js — speed round F16 dist/ Blob worker and the fallback ladder (PO-PERF-1, NFR-02, NFR-05, §9.3, F-D5)", async () => {
  const root = path.join(__dirname, ".."), JS = path.join(root, "js"), E = SBEngine, S = SBSchema, F = require("./fixtures.js");
  const C = require("./pool_corpus.js"), Dq = C.deepEqualStrict, shim = require("./node_worker_shim.js");
  const text = (n) => fs.readFileSync(path.join(JS, n), "utf8");
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
  const fields = ["status", "code", "geometryHash", "layerHashes", "diagSha", "cleanupSha", "supportSha", "guidesSha", "statsSha", "wholeSha"];
  const sameGold = (id, r) => { const d = C.digest(r), g = gold.fixtures[id]; return !!g && fields.every((k) => JSON.stringify(d[k]) === JSON.stringify(g[k])); };
  const APPV = (text("app.js").match(/const APP_VERSION = "([^"]+)"/) || [])[1];
  const WMODS = JSON.parse((text("worker.js").match(/const WORKER_MODULES = (\[[^\]]*\]);/) || [, "[]"])[1]);

  // ---- the bundle (build.js ran in the "build" suite; run it again so this suite stands alone)
  require("child_process").execFileSync(process.execPath, [path.join(root, "build.js")], { stdio: "ignore" });
  const dist = fs.readFileSync(path.join(root, "dist", "shadowbox-studio.html"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const pageMods = [...html.matchAll(/<script src="js\/([\w./-]+)"><\/script>/g)].map((m) => m[1]);
  const tags = [...dist.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  /** A minimal document over the bundle (script elements: getAttribute, textContent) for SBPool.inlinedSources. */
  const fakeDoc = (src) => {
    const els = [...src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => {
      const attrs = {}; for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      return { getAttribute: (k) => (k in attrs ? attrs[k] : null), textContent: m[2] };
    });
    return {
      querySelectorAll: (sel) => (sel === "script[data-sbmod]" ? els.filter((e) => e.getAttribute("data-sbmod") !== null) : []),
      querySelector: (sel) => (sel === 'script[type="text/sb-worker"]' ? els.find((e) => e.getAttribute("type") === "text/sb-worker") || null : null),
    };
  };
  check("F16 dist has no <script src= at all", !/<script[^>]*\ssrc=/i.test(dist));
  check("F16 every page module is inlined once, as <script data-sbmod=\"<name>\"> in index.html order, its text verbatim and exactly once",
    pageMods.length > 20 && JSON.stringify(tags.filter((t) => /data-sbmod=/.test(t)).map((t) => t.match(/data-sbmod="([^"]+)"/)[1])) === JSON.stringify(pageMods) &&
    pageMods.every((n) => { const t = text(n), i = dist.indexOf(t); return i >= 0 && dist.indexOf(t, i + 1) < 0 && dist.includes('<script data-sbmod="' + n + '">\n' + t + "\n</script>"); }));
  check("F16 one <script type=\"text/sb-worker\"> block carries js/worker.js verbatim (and worker.js is not a page script)",
    tags.filter((t) => /type="text\/sb-worker"/.test(t)).length === 1 && dist.includes('<script type="text/sb-worker">\n' + text("worker.js") + "\n</script>") &&
    dist.indexOf(text("worker.js")) === dist.lastIndexOf(text("worker.js")) && !pageMods.includes("worker.js"));
  check("F16 build.js refuses a module text that would end or nest its <script> element", /<\\?\/script|<\/script/i.test(fs.readFileSync(path.join(root, "build.js"), "utf8")) &&
    /throw new Error\([^)]*script/i.test(fs.readFileSync(path.join(root, "build.js"), "utf8")));
  const wsrc = text("worker.js");
  check("F16 worker.js: under SB_INLINED the modules are evaluated by importScripts of blob: URLs the worker makes from the inlined texts (no fetch)",
    /typeof SB_INLINED !== "undefined"[\s\S]{0,600}URL\.createObjectURL\(new Blob\([\s\S]{0,300}importScripts/.test(wsrc));

  // F.4 #4: browser-vs-Node hash equality is claimed only for hashes free of implementation-approximated maths. Math.hypot
  // lives in trace.js pointSegDist (rdp → SBTrace.simplify) and util.js loopLength; both are reached only from
  // SBEngine.legacyRun (the v1.1.0 path), which generate's pipeline never calls, so they never feed a generate hash.
  {
    const all = fs.readdirSync(JS).filter((n) => n.endsWith(".js")).map((n) => [n, text(n)]);
    const hyp = all.flatMap(([n, t]) => (t.match(/Math\.hypot\(/g) || []).map(() => n));
    const eng = text("engine.js"), lr0 = eng.indexOf("E.legacyRun = function"), lr1 = eng.indexOf("\n  };\n", lr0);
    const users = (re) => all.filter(([n, t]) => re.test(t.replace(/^\s*(\/\/|\*).*$/gm, ""))).map(([n]) => n);
    check("F.4 #4 F16 Math.hypot appears only in trace.js pointSegDist and util.js loopLength",
      JSON.stringify(hyp.sort()) === '["trace.js","trace.js","trace.js","util.js"]' && /function pointSegDist[\s\S]{0,400}Math\.hypot/.test(text("trace.js")) &&
      /U\.loopLength = function[\s\S]{0,200}Math\.hypot/.test(text("util.js")));
    check("F.4 #4 F16 pointSegDist (via SBTrace.simplify) and loopLength are used only inside SBEngine.legacyRun, which nothing in js/ calls",
      lr0 > 0 && JSON.stringify(users(/SBTrace\.simplify\(|SBUtil\.loopLength\(/)) === '["engine.js"]' &&
      [...eng.matchAll(/SBTrace\.simplify\(|SBUtil\.loopLength\(/g)].every((m) => m.index > lr0 && m.index < lr1) &&
      /pointSegDist\(/.test(text("trace.js").slice(text("trace.js").indexOf("function rdp"))) &&
      all.every(([n, t]) => !/legacyRun\(/.test(t.replace(/^\s*(\/\/|\*).*$/gm, "").replace(/E\.legacyRun = function \(/, ""))));
  }

  vm.runInThisContext(text("pool.js"), { filename: "pool.js" });
  const P = SBPool;
  check("F16 SBPool.ladder, inlinedSources and blobSource exist", typeof P.ladder === "function" && typeof P.inlinedSources === "function" && typeof P.blobSource === "function");
  if (typeof P.ladder !== "function" || typeof P.inlinedSources !== "function" || typeof P.blobSource !== "function") return;
  check("F16 ladder: index.html over http(s) → [url]; the bundle (inlined texts) → [blob] on any scheme; file:// index.html → [] (the serial fallback)",
    JSON.stringify(P.ladder({ protocol: "https:", inlined: false })) === '["url"]' && JSON.stringify(P.ladder({ protocol: "http:", inlined: false })) === '["url"]' &&
    JSON.stringify(P.ladder({ protocol: "file:", inlined: true })) === '["blob"]' && JSON.stringify(P.ladder({ protocol: "https:", inlined: true })) === '["blob"]' &&
    JSON.stringify(P.ladder({ protocol: "file:", inlined: false })) === "[]" && JSON.stringify(P.ladder({})) === "[]");
  const inl = P.inlinedSources(fakeDoc(dist));
  check("F16 inlinedSources reads every module text and the worker text back from the bundle, verbatim",
    !!inl && pageMods.every((n) => inl.modules[n] === text(n)) && inl.worker === text("worker.js") && WMODS.length > 20 && WMODS.every((n) => typeof inl.modules[n] === "string"));
  check("F16 inlinedSources is null for index.html (no inlined texts) and without a document", P.inlinedSources(fakeDoc(html)) === null && P.inlinedSources(undefined) === null);
  if (!inl) return;
  const blobSrc = P.blobSource(inl);
  check("F16 blobSource defines SB_INLINED before worker.js runs, and worker.js runs as its own script (its \"use strict\" kept)",
    typeof blobSrc === "string" && /self\.SB_INLINED = /.test(blobSrc) && /importScripts\(URL\.createObjectURL\(new Blob\(/.test(blobSrc) &&
    blobSrc.indexOf("self.SB_INLINED") < blobSrc.indexOf("importScripts(") && !blobSrc.includes(text("worker.js")));

  const pools = [];
  const reqOf = (fx, cap) => E.request(fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: cap === undefined ? fx.draftCapPx : cap });
  const srcOf = (fx) => Object.assign({ sampleHash: fx.project.source.sampleHash }, fx.source);
  const codeOf = async (p) => { try { await p; return null; } catch (e) { return e instanceof Error ? e.code : "not-an-Error"; } };
  const blobRung = (spawned) => ({ name: "blob", spawn: (name) => { const w = shim.spawnSource(blobSrc, { name }); spawned.push(w); return w; } });
  /** Fake workers for the failure rungs: a constructor throw, an async error / messageerror event, or no hello at all. */
  const fake = (kind, spawned) => ({ name: kind, spawn: (name) => {
    if (kind === "throw") { spawned.push({ name, threw: true }); throw new Error("SecurityError: cannot construct a Worker here"); }
    const w = { name, terminated: false, onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() { w.terminated = true; } };
    if (kind === "error") setTimeout(() => { if (!w.terminated && w.onerror) w.onerror({ message: "failed to load worker script" }); }, 5);
    if (kind === "messageerror") setTimeout(() => { if (!w.terminated && w.onmessageerror) w.onmessageerror({ data: null }); }, 5);
    spawned.push(w);
    return w;
  } });
  const mk = (rungs, o) => {
    const pool = P.create(Object.assign({ appVersion: APPV, helpers: 2, helloTimeoutMs: 20000, rungs, inlined: inl }, o || {}));
    pools.push(pool);
    return pool;
  };
  try {
    const byId = new Map(C.corpus().map((fx) => [fx.id, fx]));
    const five = ["h-bonded-draft", "h-connected-fabrication", "t-connected-frame-draft", "n3-fabrication", "alpha-domain-draft"].map((id) => byId.get(id));

    // 1. the Blob rung: the bundle's worker, built from the inlined texts, passes the handshake and equals the serial engine
    const spawned = [];
    const pool = mk([blobRung(spawned)]);
    const up = await pool.ready;
    check("F16 the Blob worker (SB_INLINED + worker.js) says hello with this page's versions and the inlined texts' modulesHash; rung \"blob\" is up",
      up === true && pool.mode === "pool" && pool.rung === "blob");
    if (up) {
      await pool.helpersReady;
      const bad = [];
      for (const fx of five) {
        pool.setSource(srcOf(fx));
        const r = await pool.submit(reqOf(fx), { sampleHash: fx.project.source.sampleHash, gen: 1, overlays: fx.overlays }).done;
        const sync = E.generate(reqOf(fx), { overlays: fx.overlays });
        if (!(r.status === sync.status && sameGold(fx.id, r.response) && Dq(r.response, sync))) bad.push(fx.id);
      }
      check("NFR-05 F16 the Blob-worker pool (2 helpers) equals the serial golden and the sync response (deepEqualStrict) on 5 fixtures" + (bad.length ? " — " + bad.join(", ") : ""), bad.length === 0);
      check("F16 Blob helpers are spawned from the same rung (the coordinator admits them by modulesHash)",
        spawned.filter((w) => /^sb-helper-\d/.test(w.name)).length >= 2 && (await pool.stats()).helpersAdmitted.length >= 2 && (await pool.stats()).itemsHelper > 0);
    }

    // 2. a failed rung ladders on: constructor throw → next rung at once; async error → one respawn, then the next rung
    {
      const s1 = [], s2 = [];
      const p1 = mk([fake("throw", s1), blobRung(s2)], { helpers: 0 });
      check("F16 a Worker constructor throw moves to the next rung at once (no retry) and the Blob rung comes up", (await p1.ready) === true && p1.rung === "blob" && s1.length === 1);
      const s3 = [], s4 = [];
      const p2 = mk([fake("error", s3), blobRung(s4)], { helpers: 0 });
      check("F16 an async error event before hello: terminated, one respawn on that rung, then the next rung (counts as up only after hello)",
        (await p2.ready) === true && p2.rung === "blob" && s3.length === 2 && s3.every((w) => w.terminated));
    }

    // 3. every failure mode with no rung left → the F15 serial fallback with the "reduced responsiveness" notice
    for (const kind of ["throw", "error", "messageerror", "silent"]) {
      const s = [], states = [];
      const p = mk([fake(kind, s)], { helloTimeoutMs: 150, helpers: 1, onState: (x) => states.push(x) });
      const ok = await p.ready;
      check("F16 forced Worker failure (" + kind + ") → fallback with the \"reduced responsiveness\" notice; submit rejects POOL_UNAVAILABLE",
        ok === false && p.mode === "fallback" && /reduced responsiveness/.test(p.notice || "") && p.rung === null &&
        states.some((x) => x.mode === "fallback" && /reduced responsiveness/.test(x.notice || "")) &&
        (await codeOf(p.submit(reqOf(five[0]), { sampleHash: null, gen: 1 }).done)) === "POOL_UNAVAILABLE");
    }
    {
      const p = mk([], {});
      check("F16 no rung (file:// index.html) → the serial fallback at once", (await p.ready) === false && p.mode === "fallback" && /reduced responsiveness/.test(p.notice || ""));
    }

    // 4. the fallback's sync driver equals the pooled response at the same pinned draftCapPx (F-D5)
    if (up) {
      const fbCap = S.limits("desktop").draftPxFallback, bad = [];
      for (const fx of five) {
        pool.setSource(srcOf(fx));
        const r = await pool.submit(reqOf(fx, fbCap), { sampleHash: fx.project.source.sampleHash, gen: 2, overlays: fx.overlays }).done;
        const serial = E.generate(reqOf(fx, fbCap), { overlays: fx.overlays });
        if (!(r.response && Dq(r.response, serial))) bad.push(fx.id);
      }
      check("F-D5 F16 the serial fallback (SBEngine.generate) and the Blob-worker pool give identical responses at the same pinned draftCapPx (" + fbCap + ")" +
        (bad.length ? " — " + bad.join(", ") : ""), bad.length === 0);

      // at each mode's own cap: the pooled cap vs the fallback's 720 → the expected (serial) draft geometryHash, different when the caps differ
      const w = 1100, h = 820, px = { pixels: F.heightMap(21, w, h), channels: 1, w, h, alpha: null };
      const rec = E.sourceRecord(px, { format: "png", decode: "raw-gray8" });
      rec.sampleHash = SBHash.sha256(E.sampleBytes(px));
      const proj = JSON.parse(JSON.stringify(S.withSource(S.defaults("plywood"), rec)));
      proj.geometry.targetMM = 60; proj.geometry.draftPx = 1100;
      const sh = proj.source.sampleHash, pooledCap = S.limits("desktop").draftPxCap, hiCap = Math.max(pooledCap, 1024);
      pool.setSource(Object.assign({ sampleHash: sh }, px));
      const at = async (cap) => {
        const req = () => E.request(proj, px, { quality: "draft", deviceClass: "desktop", requestId: "f16-" + cap, draftCapPx: cap });
        const r = await pool.submit(req(), { sampleHash: sh, gen: 3 }).done, s = E.generate(req());
        return { pooled: r.response && r.response.snapshot ? r.response.snapshot.geometryHash : null, serial: s.snapshot ? s.snapshot.geometryHash : null };
      };
      const a = await at(fbCap), b = await at(pooledCap), c = await at(hiCap);
      check("F-D5 F16 at each mode's own cap the pooled and serial draft geometryHash are equal (fallback " + fbCap + ", pooled " + pooledCap + ")",
        !!a.pooled && a.pooled === a.serial && !!b.pooled && b.pooled === b.serial);
      check("F-D5 F16 720 vs a raised pooled cap (" + hiCap + ") give different draft geometryHash (the raster is hash input); equal caps give equal hashes",
        !!c.pooled && c.pooled === c.serial && c.pooled !== a.pooled && (pooledCap === fbCap ? b.pooled === a.pooled : b.pooled !== a.pooled));
    }
  } finally {
    for (const p of pools) p.terminate();
  }
});

// ------------------------------------------------ speed round F16a (browser harness and in-app bench modes)
suite("app.js/test/browser.html — speed round F16a browser harness and in-app bench modes (PO-PERF-1/2/3, NFR-02, NFR-05)", async () => {
  const root = path.join(__dirname, ".."), E = SBEngine, S = SBSchema, F = require("./fixtures.js");
  const appSrc = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const BENCH = require("./bench.js");
  const F16_FIVE = ["h-bonded-draft", "h-connected-fabrication", "t-connected-frame-draft", "n3-fabrication", "alpha-domain-draft"];

  // ---- 1. in-app ?bench= modes (js/app.js): inert unless the query names a mode
  check("F16a app.js reads ?bench= once and accepts only fab|draft|cancel (anything else: no bench)",
    /const BENCH = \(\(\) => \{[\s\S]{0,300}new URLSearchParams\(location\.search\)\.get\("bench"\)[\s\S]{0,200}\["fab", "draft", "cancel"\]\.includes\(/.test(appSrc));
  check("F16a init starts the bench only when BENCH is set, after the pool (inert otherwise)",
    /startPool\(\);[\s\S]{0,400}if \(BENCH\) startBench\(BENCH\);/.test(appSrc));
  check("F16a ?bench=fab|draft|cancel each have a driver (benchFab, benchDraft, benchCancel) dispatched by startBench",
    /async function benchFab\(/.test(appSrc) && /async function benchDraft\(/.test(appSrc) && /async function benchCancel\(/.test(appSrc) &&
    /function startBench\(mode\)[\s\S]{0,1500}\{ fab: benchFab, draft: benchDraft, cancel: benchCancel \}\[mode\]/.test(appSrc));
  check("F16a each bench records main-thread long tasks with the F11 recorder (SBPool.longTasks)",
    (appSrc.match(/benchLongTasks\(\)/g) || []).length >= 4 && /function benchLongTasks\(\)[\s\S]{0,300}SBPool\.longTasks\(\)/.test(appSrc));
  check("F16a the record is shown in the page (#bench-result, data-bench state) and offered as a JSON download (Blob, a[download])",
    /bench-result/.test(appSrc) && /dataset\.bench = /.test(appSrc) && /new Blob\(\[JSON\.stringify\(rec, null, 2\)\], \{ type: "application\/json" \}\)/.test(appSrc) &&
    /\.download = "shadowbox-bench-" \+/.test(appSrc));
  check("F16a the bench drives the app's own paths: previewFabrication (fab), the draft result path applyDraft (draft), cancelFab(\"user\") (cancel)",
    /async function benchFab\([\s\S]{0,2500}previewFabrication\(\)/.test(appSrc) && /function applyDraft\(res, c\)[\s\S]{0,2600}if \(benchDraftHook\) benchDraftHook\(res, c\);/.test(appSrc) &&
    /async function benchCancel\([\s\S]{0,3000}cancelFab\("user"\)/.test(appSrc));
  check("F16a the bench code holds no script-element text (build.js inlines app.js and refuses it)", !/<\/?script/i.test(appSrc));

  // the pure helpers block, evaluated on its own
  const b0 = appSrc.indexOf("// ---- F16a bench helpers (pure)"), b1 = appSrc.indexOf("// ---- F16a bench helpers end");
  check("F16a app.js has one self-contained pure bench-helpers block", b0 > 0 && b1 > b0);
  if (!(b0 > 0 && b1 > b0)) return;
  let B = null;
  try { B = new Function(appSrc.slice(b0, b1) + "\nreturn { BENCH_PLAN, benchStats, benchHeightMap, benchBusyHeightMap, benchRgba, benchProject, benchRecord };")(); }
  catch (e) { check("F16a the pure bench helpers evaluate on their own (" + e.message + ")", false); return; }
  const P = B.BENCH_PLAN;
  check("F16a BENCH_PLAN: fab = S2 workload, 1 warm + 5; draft = E4 method (realistic and busy, sheets 8 ↔ 7, ≥ 15 warm after warm-up); cancel = 20 cancels",
    P.fab.warm === 1 && P.fab.runs === 5 && JSON.stringify(P.fab.src) === JSON.stringify(BENCH.USER12.src) && P.fab.fabPitchMM === BENCH.USER12.fabPitchMM && P.fab.guides === BENCH.USER12.guides &&
    JSON.stringify(P.draft.families) === JSON.stringify(BENCH.DRAFT.families) && P.draft.runs >= 15 && P.draft.warm === BENCH.DRAFT.warm &&
    JSON.stringify(P.draft.sheets) === "[8,7]" && JSON.stringify(P.draft.src) === JSON.stringify(BENCH.DRAFT.src) &&
    JSON.stringify(P.draft.seeds) === JSON.stringify(BENCH.DRAFT.seeds) && P.draft.busyCellPx === BENCH.DRAFT.busyCellPx && P.cancel.cancels === 20);
  {
    const t = Array.from({ length: 20 }, (_, i) => 20 - i), s = B.benchStats(t);
    check("F16a benchStats: nearest-rank p50/p95 and max, as test/bench.js stats", s.n === 20 && s.p50Ms === 10 && s.p95Ms === 19 && s.maxMs === 20 &&
      B.benchStats([7]).p95Ms === 7 && B.benchStats([]).n === 0 && B.benchStats([]).p95Ms === null);
  }
  check("F16a the in-app bench art equals the Node fixtures byte for byte (F.heightMap, F.busyHeightMap; RGBA as bench.js draftSource)", (() => {
    const w = 97, h = 61, eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const r = B.benchHeightMap(P.draft.seeds.realistic, w, h), bz = B.benchBusyHeightMap(P.draft.seeds.busy, w, h, P.draft.busyCellPx);
    const rgba = B.benchRgba(r, w, h);
    return eq(r, F.heightMap(P.draft.seeds.realistic, w, h)) && eq(bz, F.busyHeightMap(P.draft.seeds.busy, w, h, P.draft.busyCellPx)) &&
      rgba.channels === 4 && rgba.w === w && rgba.h === h && rgba.alpha === null &&
      eq(rgba.pixels.slice(0, 8), [r[0], (r[0] * 3) & 255, 255 - r[0], 255, r[1], (r[1] * 3) & 255, 255 - r[1], 255]);
  })());
  {
    const w = 120, h = 90, px = B.benchRgba(B.benchHeightMap(5, w, h), w, h);
    const rec = Object.assign(E.sourceRecord(px, { format: "png", decode: "canvas-tonal" }), { sampleHash: SBHash.sha256(E.sampleBytes(px)) });
    const fab = B.benchProject(S, rec, "fab"), dr = B.benchProject(S, rec, "draft"), ref = BENCH.user12Project(px), refDraft = BENCH.user12Project(px, S.defaults("plywood").construction.guides.mode);
    const pick = (p) => JSON.stringify([p.interpretation, p.construction, p.material, p.geometry]);
    const noPitch = (p) => { const q = JSON.parse(JSON.stringify(p)); delete q.geometry.fabPitchMM; return q; };
    check("F16a benchProject(\"fab\") is the S2 workload (test/bench.js user12Project: plywood auto-tonal, 8 sheets, 300 mm, 0.1 mm pitch, inset-outline) and validates",
      S.validate(fab).ok && pick(fab) === pick(ref));
    check("F16a benchProject(\"draft\") is E4 workload (a) (draftProject(\"a\"), the preset's guides, no fabrication pitch change) and validates",
      S.validate(dr).ok && pick(noPitch(dr)) === pick(noPitch(refDraft)) && dr.geometry.fabPitchMM === S.defaults("plywood").geometry.fabPitchMM);
  }
  {
    const rec = B.benchRecord("fab", { runsMs: [5, 4, 3, 2, 1], warmMs: [9], longTaskMaxMs: 42, longTasks: { supported: true, count: 3 } }, { app: "x" });
    const j = JSON.parse(JSON.stringify(rec));
    check("F16a benchRecord: JSON with mode, environment, p50Ms/p95Ms/maxMs of the measured runs (warm-up excluded) and longTaskMaxMs",
      j.bench === "fab" && j.p50Ms === 3 && j.p95Ms === 5 && j.maxMs === 5 && j.n === 5 && j.longTaskMaxMs === 42 && j.env.app === "x" && JSON.stringify(j.warmMs) === "[9]" &&
      typeof j.at === "string");
  }

  // ---- 2. test/browser.html?run: the modules, the 5 F16 fixtures through pool and serial, digests into the DOM
  const htmlPath = path.join(__dirname, "browser.html");
  check("F16a test/browser.html exists", fs.existsSync(htmlPath));
  if (!fs.existsSync(htmlPath)) return;
  const bh = fs.readFileSync(htmlPath, "utf8"), { NODE_MODULES } = require("./modules.js");
  const srcs = [...bh.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  check("F16a browser.html loads the worker module list (test/modules.js) in order, then pool.js, then browser_harness.js",
    JSON.stringify(srcs) === JSON.stringify(NODE_MODULES.map((n) => "../js/" + n).concat(["../js/pool.js", "browser_harness.js"])));
  check("F16a browser.html runs the harness on ?run and prints into #harness-result",
    /new URLSearchParams\(location\.search\)\.has\("run"\)/.test(bh) && /SBHarness\.main\(/.test(bh) && /id="harness-result"/.test(bh));
  let H = null;
  try { H = require("./browser_harness.js"); } catch (e) { check("F16a test/browser_harness.js loads in Node (" + e.message + ")", false); return; }
  check("F16a the harness runs the 5 F16 fixtures", JSON.stringify(H.FIXTURES) === JSON.stringify(F16_FIVE));
  const shim = require("./node_worker_shim.js");
  if (typeof SBPool === "undefined") vm.runInThisContext(fs.readFileSync(path.join(root, "js", "pool.js"), "utf8"), { filename: "pool.js" });
  const fetchText = async (rel) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");
  const inl = await H.readInlined(fetchText);
  check("F16a readInlined: worker.js and every WORKER_MODULES text, read relative to test/ (../js/…)",
    !!inl && inl.worker === fs.readFileSync(path.join(root, "js", "worker.js"), "utf8") && NODE_MODULES.every((n) => inl.modules[n] === fs.readFileSync(path.join(root, "js", n), "utf8")));
  const blobSrc = SBPool.blobSource(inl);
  const rec = await H.run({ fetchText, inlined: inl, helpers: 2, rungs: [{ name: "blob", spawn: (name) => shim.spawnSource(blobSrc, { name }) }] });
  const j = JSON.parse(JSON.stringify(rec));
  check("F16a harness record: rung blob, the 5 fixtures with serial and pooled digests, pool = serial (deepEqualStrict) and = the Node golden",
    j.rung === "blob" && j.fixtures.length === 5 && j.fixtures.every((f, i) => f.id === F16_FIVE[i] && f.poolEqualsSerial === true && f.serialEqualsGolden === true &&
      typeof f.serial.geometryHash === "string" && f.pool.wholeSha === f.serial.wholeSha) && j.pass === true);
  check("F16a harness record: p50Ms/p95Ms of the pooled and serial runs and the long-task maximum",
    ["pool", "serial"].every((k) => typeof j.timing[k].p50Ms === "number" && typeof j.timing[k].p95Ms === "number") && "longTaskMaxMs" in j && typeof j.longTasks.supported === "boolean");
  check("F16a harness cancel round trip: a fabrication run canceled after its ack settles canceled within 500 ms (NFR-02)",
    j.cancel && j.cancel.status === "canceled" && j.cancel.latencyMs < 500);
  check("F16a harness text output lists every fixture with its geometryHash and the verdict", (() => {
    const t = H.format(rec); return F16_FIVE.every((id, i) => t.includes(id) && t.includes(j.fixtures[i].serial.geometryHash)) && /PASS/.test(t); })());
});

// ------------------------------------------------ speed round F18 (final measurement, records and the alpha.4 checkpoint)
suite("checkpoint v2.0.0-alpha.4 — speed round F18 final measurement, records and docs (PO-PERF-1..5, S2, S5, F-D6)", async () => {
  const root = path.join(__dirname, ".."), rd = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const ver = (s, re) => (s.match(re) || [])[1];
  const app = rd("js/app.js"), sw = rd("sw.js"), wk = rd("js/worker.js");
  // ---- release label (F.9 Q10): alpha.4, engine version unchanged (F.3)
  check("F18 release 2.0.0-alpha.4: APP_VERSION, sw.js VERSION and WORKER_APP_VERSION agree (F.9 Q10, DEP-02)",
    ver(app, /const APP_VERSION = "([^"]+)"/) === "2.0.0-alpha.4" && ver(sw, /const VERSION = "([^"]+)"/) === "2.0.0-alpha.4" &&
    ver(wk, /const WORKER_APP_VERSION = "([^"]+)"/) === "2.0.0-alpha.4");
  check("F18 engine version unchanged by the speed round (F.3: no SBSchema.ENGINE.version change)",
    SBSchema.ENGINE.version === "1.0.0-dev" && SBEngine.VERSION === "1.0.0-dev");

  // ---- docs
  const cl = rd("docs/CHANGELOG.md"), sec = (cl.split(/^## v2\.0\.0-alpha\.4\b.*$/m)[1] || "").split(/^## /m)[0];
  check("F18 CHANGELOG v2.0.0-alpha.4 is the top release and summarises PO-PERF-1..5 and the deviations F-D1..F-D6",
    cl.search(/^## v2\.0\.0-alpha\.4\b/m) >= 0 && cl.search(/^## v2\.0\.0-alpha\.4\b/m) < cl.search(/^## v2\.0\.0-alpha\.3\b/m) &&
    [1, 2, 3, 4, 5].every((n) => new RegExp("PO-PERF-" + n + "\\b").test(sec)) && [1, 2, 3, 4, 5, 6].every((n) => new RegExp("F-D" + n + "\\b").test(sec)));
  check("F18 CHANGELOG v2.0.0-alpha.4 names the worker pool, the serial fallback, DRAFT_COARSER and the 720 px draft decision",
    /SBPool/.test(sec) && /coordinator/i.test(sec) && /fallback/i.test(sec) && /DRAFT_COARSER/.test(sec) && /720/.test(sec) && /bit-identical/i.test(sec));
  check("F18 CHANGELOG v2.0.0-alpha.4 has a known-gaps table (S2 browser measurement, M5, NFR-04 working set, KI-B1, KI-CONN-PERF, packaging on main)",
    /known gaps/i.test(sec) && /^\|.*\|\s*$/m.test(sec) && /M5/.test(sec) && /NFR-04/.test(sec) && /KI-B1/.test(sec) && /KI-CONN-PERF/.test(sec) && /packag/i.test(sec));
  check("F18 CHANGELOG has no Unreleased section above v2.0.0-alpha.4",
    !/^## Unreleased\b/m.test(cl.slice(0, Math.max(0, cl.search(/^## v2\.0\.0-alpha\.4\b/m)))));
  const arch = rd("docs/ARCHITECTURE.md"), as = (arch.split(/^## Speed round \(Appendix F\): worker architecture.*$/m)[1] || "").split(/^## /m)[0];
  check("F18 ARCHITECTURE documents the worker architecture (runSteps, sync and async drivers, coordinator, helpers, SBPool, handshake, ladder, ledger, cancel)",
    as.length > 0 && /runSteps/.test(as) && /generateAsync/.test(as) && /SBEngine\.generate/.test(as) && /coordinator/i.test(as) && /helper/i.test(as) &&
    /SBPool/.test(as) && /modulesHash/.test(as) && /Blob/.test(as) && /fallback/i.test(as) && /estBytes/.test(as) && /acceptResult/.test(as) &&
    /draftCapPx/.test(as) && /watchdog/i.test(as) && /WORKER_MODULES/.test(as));
  const qa = rd("docs/QA_CHECKLIST.md"), qs = (qa.split(/^## Worker pool and responsiveness.*$/m)[1] || "").split(/^## /m)[0];
  check("F18 QA_CHECKLIST has the manual speed-round checks (page responsive during fabrication, Cancel, file:// dist, fallback notice)",
    qs.length > 0 && /responsive/i.test(qs) && /Cancel/.test(qs) && /file:\/\//.test(qs) && /dist/.test(qs) && /fallback/i.test(qs) && /^- \[ \]/m.test(qs));

  // ---- bench: user12 with --pool 0,1,8 (S2), the 25 Mpx memory row (F-D6)
  const B = require("./bench.js");
  check("F18 bench poolList parses --pool 0,1,8 and refuses junk, negatives and repeats",
    typeof B.poolList === "function" && JSON.stringify(B.poolList("0,1,8")) === "[0,1,8]" &&
    ["", "x", "1,-1", "1,1", "0,1.5"].every((s) => { try { B.poolList(s); return false; } catch (e) { return true; } }));
  const U = B.USER12, f25 = U && U.extraRows && U.extraRows.fab25;
  const tiny = { pixels: new Uint8Array(64 * 48 * 4).fill(128), channels: 4, w: 64, h: 48, alpha: null };
  const plan25 = f25 ? (() => { const p = B.user12Project(tiny); p.geometry.targetMM = f25.targetMM;
    return SBEngine.rasterPlan(p, { w: f25.w, h: f25.h }, "fabrication", "desktop").geometry; })() : null;
  check("F18 user12 fab25 memory row: an alpha.3 scene whose fabrication raster is within 0.5 % of the 25 Mpx desktop fabPxBudget (F-D6)",
    !!plan25 && f25.w * f25.h <= SBSchema.limits("desktop").maxSourcePx && plan25.rasterW * plan25.rasterH <= SBSchema.limits("desktop").fabPxBudget &&
    plan25.rasterW * plan25.rasterH >= 0.995 * SBSchema.limits("desktop").fabPxBudget && !("fab25" in U.rows));
  check("F18 user12 final defaults: pools 0,1,8, rows draft720/fab3600/fab4096, 1 warm-up + 3 runs",
    !!U && !!U.final && JSON.stringify(U.final.pools) === "[0,1,8]" && JSON.stringify(U.final.rows) === JSON.stringify(["draft720", "fab3600", "fab4096"]) &&
    U.final.warm === 1 && U.final.runs === 3);
  const fin = typeof B.benchUser12Final === "function" ? await B.benchUser12Final({ quick: true, pools: [0, 2], rows: ["draft720", "fab4096"], record: false }) : null;
  const rowOf = (id, P) => fin && fin.rows[id] && fin.rows[id]["pool" + P];
  check("F18 benchUser12Final (quick): a row per pool size with p50/p95, stages, raster and geometryHash, sync driver for 0 and SBPool otherwise",
    !!fin && ["draft720", "fab4096"].every((id) => [0, 2].every((P) => { const r = rowOf(id, P);
      return r && r.status === "done" && r.pool === P && r.runs === 1 && r.p50Ms > 0 && r.p95Ms >= r.p50Ms && typeof r.geometryHash === "string" &&
        /×/.test(r.raster) && r.stagesP50Ms && Object.keys(r.stagesP50Ms).length > 0 && (P ? /SBPool/.test(r.driver) : /sync driver/.test(r.driver)); })));
  check("F18 benchUser12Final: pooled geometryHash equals the sync driver's for every row (S1 bit-identity carried into the measurement)",
    !!fin && fin.equal && fin.equal.draft720 === true && fin.equal.fab4096 === true && rowOf("fab4096", 2).geometryHash === rowOf("fab4096", 0).geometryHash);
  check("F18 benchUser12Final memory: process RSS and arrayBuffers peaks (Node) on every row; the coordinator estBytes ledger peak and budget on pooled rows (F-D6)",
    !!fin && ["draft720", "fab4096"].every((id) => [0, 2].every((P) => { const r = rowOf(id, P), m = r && r.memory;
      return m && m.rssPeakMB > 0 && m.arrayBuffersPeakMB >= 0 && m.samples > 0 && (P ? r.ledger && r.ledger.peakLedgerMB > 0 && r.ledger.budgetMB > 0 && r.ledger.itemsHelper > 0 : r.ledger === null); })));

  // ---- the record
  const sr = JSON.parse(rd("docs/perf/speed-round.json")), F = sr.final;
  check("F18 speed-round.json final: measured rows for pools 0,1,8, or a pending record naming the command and the interim evidence",
    !!F && F.task === "F18" && (F.status === "measured"
      ? ["draft720", "fab3600", "fab4096"].every((id) => F.rows[id] && [0, 1, 8].every((P) => F.rows[id]["pool" + P] && F.rows[id]["pool" + P].p95Ms > 0))
      : F.status === "pending" && /large --only user12 --pool 0,1,8/.test(F.command) && F.interim && F.interim.length >= 2 && typeof F.reason === "string"));
  check("F18 speed-round.json final records the KI-B1 B1 re-run (p95 against the 2 s budget, still tracked) and KI-CONN-PERF as reported-only",
    !!F && F.kiB1 && F.kiB1.p95Ms > 0 && F.kiB1.budgetMs === 2000 && typeof F.kiB1.tracked === "boolean" && F.kiConnPerf && /report/i.test(F.kiConnPerf.status));
});

// ------------------------------------------------ Appendix G G1 (PO-FIX-1): exact Euclidean-disc open/close for bonded construction
suite("morph/construct — Appendix G G1 bonded disc morphology (PO-FIX-1, GEO-05, D-4.5, NFR-05)", () => {
  const F = require("./fixtures.js"), O = require("./oracle_kernels.js").oracleDisc, M = SBMorph, C = SBConstruct;
  const has = typeof M.discErode === "function" && typeof M.discDilate === "function" && typeof M.discOpenClose === "function";
  check("G1 SBMorph.discErode/discDilate/discOpenClose exist", has);
  if (!has) return;
  // exactness against the brute-force definition: random masks, sizes 1–41, R2 in {0, 1, 2, 4, 5, 8, 13, 49, 52, 56}
  { const rng = F.lcg(4711); let bad = 0, n = 0;
    for (let t = 0; t < 160; t++) { const w = 1 + Math.floor(rng() * 41), h = 1 + Math.floor(rng() * 41), R2 = [0, 1, 2, 4, 5, 8, 13, 49, 52, 56][t % 10], dens = 0.2 + 0.6 * rng();
      const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = rng() < dens ? 1 : 0;
      const e = M.discErode(m, w, h, R2), d = M.discDilate(m, w, h, R2); n++;
      if (e.join() !== O.erode(m, w, h, R2).join() || d.join() !== O.dilate(m, w, h, R2).join() || e === m || d === m) bad++; }
    check(`G1 disc erode/dilate equal the brute-force definition (${n - bad}/${n})`, bad === 0); }
  { const w = 7, h = 5, m = new Uint8Array(w * h).fill(1); m[17] = 0;
    check("G1 R2 = 0: erode and dilate are the identity", M.discErode(m, w, h, 0).join() === m.join() && M.discDilate(m, w, h, 0).join() === m.join()); }
  { const w = 300, h = 3, m = new Uint8Array(w * h); m.fill(1, w, w + 1); const R2 = 70000;   // ρ ≈ 264.6: distance plane must be Uint16
    check("G1 R2 > 65025 uses a wide distance plane and equals brute force on a long strip",
      M.discDilate(m, w, h, R2).join() === O.dilate(m, w, h, R2).join()); }
  { const w = 520, h = 4, m = new Uint8Array(w * h), rng = F.lcg(65025); for (let i = 0; i < m.length; i++) m[i] = rng() < 0.97 ? 1 : 0;
    check("G1 the Uint8/Uint16 distance-plane boundary (R2 65024/65025/65026) equals brute force (erode and dilate)",
      [65024, 65025, 65026].every((R2) => M.discErode(m, w, h, R2).join() === O.erode(m, w, h, R2).join() && M.discDilate(m.map((v) => 1 - v), w, h, R2).join() === O.dilate(m.map((v) => 1 - v), w, h, R2).join())); }
  { const w = 270, h = 5, m = new Uint8Array(w * h), rng = F.lcg(15876); for (let i = 0; i < m.length; i++) m[i] = rng() < 0.97 ? 1 : 0;
    check("G1 the word-sweep / scalar kernel boundary (R2 15875 → C 126, R2 15876 → C 127) equals brute force (erode and dilate)",
      [15624, 15875, 15876].every((R2) => M.discErode(m, w, h, R2).join() === O.erode(m, w, h, R2).join() && M.discDilate(m.map((v) => 1 - v), w, h, R2).join() === O.dilate(m.map((v) => 1 - v), w, h, R2).join())); }
  { const rng = F.lcg(64); let bad = 0;
    for (let t = 0; t < 40; t++) { const w = 1 + Math.floor(rng() * 45), h = 1 + Math.floor(rng() * 45), a = [1, 2, 9, 49, 64][t % 5], b = [64, 9, 1, 2, 49][t % 5];
      const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = rng() < 0.55 ? 1 : 0;
      if (M.discOpenClose(m, w, h, a, b).join() !== O.openClose(m, w, h, a, b).join()) bad++; }
    check("G1 discOpenClose (one shared scratch for its four windows) equals the brute-force open/close (40 random masks)", bad === 0); }
  // border (G.4 #1): outside the image is no pixel
  { const w = 40, h = 30, m = new Uint8Array(w * h); m.fill(1, 0, 20 * w);   // material rows 0..19 at the top edge
    const e = M.discErode(m, w, h, 49);
    check("G1 border: material at the image edge is not eroded from outside (row 0 kept, rows ≥ 13 removed)",
      e.subarray(0, w).every((v) => v === 1) && e.subarray(13 * w, 20 * w).every((v) => v === 0)); }
  // thresholds at 1.5 mm, 0.1 mm/px: F = 15, m = 8, R2 = 64 (G-D1 tie rule: widths ≤ 16 px are removed, 17 px survive)
  const PX = { featR: 8, discR2: 64, bridgeR: 9, cullPx: 1000, maxBridgePx: 400, speckPx: 1000, holePx: 450, frameAnchored: false, cullEnabled: false };
  const full = (w, h) => new Uint8Array(w * h).fill(1), comps = (m, w, h) => M.runComponents(m, w, h, 1).count;
  const bonded1 = (m, w, h, px) => C.bonded([full(w, h), m], w, h, px || PX).final[1];
  const axisNeck = (wd) => { const w = 220, h = 100, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x < 80 && y > 20 && y < 80) || (x >= 140 && y > 20 && y < 80) || (y >= 40 && y < 40 + wd) ? 1 : 0;
    return { m, w, h }; };
  for (const [wd, keep] of [[14, false], [15, false], [16, false], [17, true], [19, true]]) { const { m, w, h } = axisNeck(wd), f = bonded1(m, w, h);
    check(`G1 axis neck ${wd / 10} mm (min 1.5, tie: ≤ 1.6 removed) ${keep ? "kept (one part)" : "removed (two parts)"}`, comps(f, w, h) === (keep ? 1 : 2)); }
  const waste = (c) => { const w = 220, h = 60, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = x < 100 || x >= 100 + c ? 1 : 0; return { m, w, h }; };
  for (const [c, filled] of [[14, true], [15, true], [16, true], [17, false]]) { const { m, w, h } = waste(c), f = bonded1(m, w, h);
    check(`G1 axis waste channel ${c / 10} mm ${filled ? "is closed" : "stays open"}`, (comps(f, w, h) === 1) === filled); }
  // tie rule / self-consistency (review 2026-10-09): what construction keeps, the feature checks do not flag as too narrow
  const feat = (m, w, h) => SBSupport.featureChecks(SBMaterial.assignParts(SBMaterial.fromMasks([full(w, h), m], w, h, { artWMM: w * 0.1, artHMM: h * 0.1, frameMM: 0 }, {})),
    { minFeatureMM: 1.5, advisoryFeatureMM: 2, minPartMM2: 0, mmPerPxMax: 0.1, calibrated: true }).map((d) => d.code);
  { const { m, w, h } = axisNeck(17), c = feat(bonded1(m, w, h), w, h);
    check("G1 tie rule: the smallest kept axis neck (1.7 mm) is not NECK_NARROW or PART_THIN", !c.includes("NECK_NARROW") && !c.includes("PART_THIN")); }
  { const w = 200, h = 60, m = new Uint8Array(w * h); for (let y = 20; y < 37; y++) m.fill(1, y * w, y * w + w);   // a 17 px strip across the image
    const f = bonded1(m, w, h), c = feat(f, w, h);
    check("G1 tie rule: the smallest kept whole strip (1.7 mm) survives construction and is not PART_THIN", f.some((v) => v) && !c.includes("PART_THIN") && !c.includes("NECK_NARROW")); }
  { const w = 200, h = 60, m = new Uint8Array(w * h); for (let y = 20; y < 36; y++) m.fill(1, y * w, y * w + w);   // 16 px: removed
    check("G1 tie rule: a 1.6 mm strip is removed entirely", !bonded1(m, w, h).some((v) => v)); }
  // border semantics (review 2026-10-09): art touching the image edge is cleaned like interior art (the square kernels kept the 1-px ring)
  { const w = 100, h = 60, thin = new Uint8Array(w * h), wide = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { thin.fill(1, y * w, y * w + 6); wide.fill(1, y * w, y * w + 17); }
    check("G1 border: a 0.6 mm strip along the image edge is removed completely; a 1.7 mm strip keeps its edge column",
      !bonded1(thin, w, h).some((v) => v) && (() => { const f = bonded1(wide, w, h); for (let y = 0; y < h; y++) if (!f[y * w]) return false; return true; })()); }
  // diagonal neck and waste (neck_test.js): 45° strip of perpendicular width wpx between two 6 mm blocks
  const diag = (wpx, inv) => { const w = 220, h = 220, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const A = x >= 20 && x < 80 && y >= 20 && y < 80, B = x >= 140 && x < 200 && y >= 140 && y < 200,
      S = Math.abs(x - y) / Math.SQRT2 <= wpx / 2 && x >= 50 && x <= 170; m[y * w + x] = A || B || S ? 1 : 0; }
    if (inv) { for (let i = 0; i < m.length; i++) m[i] = m[i] ? 0 : 1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 4 || y < 4 || x >= w - 4 || y >= h - 4) m[y * w + x] = 1; }
    return { m, w, h }; };
  for (const wpx of [19, 22]) {
    { const { m, w, h } = diag(wpx, false), f = bonded1(m, w, h); let cut = 0; for (let t = 60; t <= 160; t++) if (!f[t * w + t]) cut++;
      check(`G1 diagonal material neck ${wpx / 10} mm keeps its centre line (was chopped by the square window)`, cut === 0); }
    { const { m, w, h } = diag(wpx, true), f = bonded1(m, w, h); let fill = 0; for (let t = 60; t <= 160; t++) if (f[t * w + t]) fill++;
      check(`G1 diagonal waste channel ${wpx / 10} mm is not filled`, fill === 0); }
  }
  // the six real 12 × 12 mm crops of height_8layer_v2.png: construct creates no new neck or waste neck < 1.3 mm
  const dir = path.join(__dirname, "neck_fixtures"), files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".png")).sort() : [];
  check("G1 six neck fixtures present (test/neck_fixtures)", files.length === 6);
  for (const f of files) checkAsync(`G1 ${f}: no new material or waste neck < 1.3 mm`, SBPng.decode(new Uint8Array(fs.readFileSync(path.join(dir, f))), { mode: "height" }).then((d) => {
    const w = d.w, h = d.h, k = +f.slice(1, 3) - 1, masks = [];
    for (let j = 0; j < 8; j++) masks.push(d.samples.map((v) => (v >= Math.round((j * 255) / 7) ? 1 : 0)));
    const fin = C.bonded(masks, w, h, Object.assign({}, PX, { cullEnabled: false })).final[k];
    const inv = (m) => m.map((v) => (v ? 0 : 1)), open36 = (m) => O.dilate(O.erode(m, w, h, 36), w, h, 36);
    const thinNew = (src, out) => { const os = open36(src), oo = open36(out), deep = O.erode(src, w, h, 15); let n = 0;   // deep: d² ≥ 16, ≥ 0.4 mm from background
      for (let y = 15; y < h - 15; y++) for (let x = 15; x < w - 15; x++) { const i = y * w + x; if (os[i] && !oo[i] && deep[i]) n++; } return n; };
    return thinNew(masks[k], fin) === 0 && thinNew(inv(masks[k]), inv(fin)) === 0; }));
  // nesting (D-4.5) with the disc (review 2026-10-09: the 40 × 30 stacks at R2 up to 49 erase most content, so they proved little).
  // Small stacks keep the cheap R2 2/8. The strong test uses structured 120 × 90 stacks (F.busyHeightMap thresholded at five levels, so they are nested by
  // construction and keep ~50-58 % of the pixels on layers 1-4 after cleanup; F.randomNestedStack leaves layers 2-4 nearly empty even at 120 × 90),
  // R2 in {4, 9, 64}, with and without cullEnabled (removeSpecks), at constructLayer level. Measured 2026-10-09 with the prototype chain: 0 violations in 60 seeds.
  { let ok = true; for (let s = 1; s <= 200 && ok; s++) { const st = F.randomNestedStack(F.lcg(s), 40, 30, 5);
      for (const discR2 of [2, 8]) { const r = C.bonded(st, 40, 30, { ...PX, featR: 3, discR2, holePx: 30 });
        for (let k = 2; k < r.final.length; k++) if (r.final[k].some((v, i) => v && !r.final[k - 1][i])) ok = false; } }
    check("D-4.5 property: bonded disc morphology keeps nesting (200 seeds, 40 × 30, R2 2/8)", ok); }
  { const bad = { cull: 0, nocull: 0 }, kept = [];
    for (let s = 1; s <= 60; s++) { const hm = F.busyHeightMap(1000 + s, 120, 90, 14), st = [0, 1, 2, 3, 4].map((k) => hm.map((v) => (v >= k * 45 ? 1 : 0)));
      for (const discR2 of [4, 9, 64]) for (const cull of [false, true]) {
        const px = { ...PX, featR: Math.round(Math.sqrt(discR2)), discR2, holePx: 30, speckPx: 150, cullEnabled: cull };
        const fin = st.map((mask, k) => C.constructLayer(k, { mask, W: 120, H: 90, px, bonded: true }).final);   // constructLayer level, as the pool runs it
        kept.push(fin.slice(1).reduce((a, m) => a + m.reduce((x, v) => x + v, 0), 0));
        for (let k = 2; k < fin.length; k++) if (fin[k].some((v, i) => v && !fin[k - 1][i])) bad[cull ? "cull" : "nocull"]++; } }
    check("D-4.5 property: nesting at constructLayer level on 120 × 90 stacks, R2 4/9/64, cullEnabled false", bad.nocull === 0);
    check("D-4.5 property: nesting at constructLayer level on 120 × 90 stacks, R2 4/9/64, cullEnabled true (removeSpecks)", bad.cull === 0);
    check("G1 the nesting stacks keep material (not vacuous: layers 1-4 keep > 30 % of the pixels on average)", kept.reduce((a, b) => a + b, 0) / kept.length > 0.3 * 120 * 90 * 4); }
  // fallback and contract
  { const st = F.randomNestedStack(F.lcg(9), 40, 30, 4), sq = { ...PX, featR: 1, holePx: 8 };
    const a = C.bonded(st, 40, 30, { ...sq, discR2: 0 }).final, b = st.map((m, k) => (k ? C._morph(m, 40, 30, sq, false).m : m));
    check("G1 R2 0 (minFeature < 3 px, draft only) falls back to the square featR chain", a.every((m, k) => m.join() === b[k].join())); }
  check("G1 px without discR2 uses featR²", (() => { const st = F.randomNestedStack(F.lcg(3), 40, 30, 4);
    const a = C.bonded(st, 40, 30, { ...PX, discR2: undefined, featR: 3 }).final, b = C.bonded(st, 40, 30, { ...PX, featR: 3, discR2: 9 }).final;
    return a.every((m, k) => m.join() === b[k].join()); })());
  check("G1 discR2 must be a non-negative integer when given (CONSTRUCT_ARG)", (() => { try { C.bonded([full(4, 4)], 4, 4, { ...PX, discR2: 1.5 }); return false; } catch (e) { return e.code === "CONSTRUCT_ARG"; } })());
  { const p = SBSchema.defaults("plywood"), cp = SBEngine._constructPx || null;
    check("G1 constructPx gives discR2 = 64 at 1.5 mm and 0.1 mm/px (tie rule), 9 at 0.25 mm/px, 0 at 0.55 and 0.75 mm/px (square fallback), monotone in F",
      !!cp && cp(p.construction, true, 100, 100).discR2 === 64 && cp(p.construction, true, 250, 250).discR2 === 9 &&
      cp(p.construction, true, 550, 550).discR2 === 0 && cp(p.construction, true, 750, 750).discR2 === 0 &&
      [10, 14, 16, 20, 25, 30, 40, 50, 60, 75, 100].map((u) => cp(p.construction, true, u, u).discR2).every((v, i, a) => !i || v <= a[i - 1]));   // finer pitch (smaller µm) → larger R2
    check("G1 constructPx R2 sizes the distance plane: 50 mm minimum feature at 0.05 mm/px gives R2 = 250000 (> 65025)", (() => { const q = SBSchema.defaults("plywood").construction; q.cleanup.minFeatureMM = 50;
      return cp(q, true, 50, 50).discR2 === 250000; })()); }
  // connected is untouched: the v1.1.0 chain test and oldrun.json stay as they are (suites "construct.js — G2.6 extended", "golden oldrun")
  { const st = F.randomNestedStack(F.lcg(5), 40, 30, 5), q = { ...PX, featR: 3, discR2: 6, frameAnchored: true, speckPx: 4, holePx: 30 };
    const a = C.connected(st, 40, 30, q).final, b = C.connected(st, 40, 30, { ...q, discR2: 0 }).final;
    check("SUP-06 connected ignores discR2", a.every((m, k) => m.join() === b[k].join())); }
  // G-D6: the G1 recapture names exactly the bonded corpus fixtures; no connected id was re-captured by G1 (connected entries keep their digests)
  { const corpus = require("./pool_corpus.js").corpus(), gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8"));
    const g1 = (gold.recaptured || []).find((r) => r.task === "G1"), bondedIds = corpus.filter((f) => f.project.construction.mode === "bonded-relief").map((f) => f.id).sort();
    const connIds = corpus.filter((f) => f.project.construction.mode !== "bonded-relief").map((f) => f.id);
    check("G-D6 G1 re-captured exactly the bonded fixtures; every connected fixture's digest is unchanged",
      !!g1 && g1.ids.slice().sort().join() === bondedIds.join() && connIds.length > 0 && !connIds.some((id) => g1.ids.includes(id) || (g1.previous && g1.previous[id])) &&
      Object.keys(g1.previous || {}).sort().join() === bondedIds.join()); }
});

// ------------------------------------------------ Appendix G G2 (PO-FIX-2): sub-kerf necks and point contacts are blocking (D3 extension)
suite("support.js — Appendix G G2 kerf necks and point contacts (PO-FIX-2, D3, GEO-02/05)", () => {
  const mk = (layers, w, h) => SBMaterial.assignParts(SBMaterial.fromMasks(layers.length === w * h ? [new Uint8Array(w * h).fill(1), layers] : layers, w, h, { artWMM: w * 0.1, artHMM: h * 0.1, frameMM: 0 }, {}));   // a single mask = the upper layer over a full base
  const codes = (ds) => ds.map((d) => d.code), base = { minFeatureMM: 1.5, advisoryFeatureMM: 2, minPartMM2: 0, mmPerPxMax: 0.1, calibrated: true };
  check("G2 NECK_KERF registered as blocking", SBDiag.CODES.NECK_KERF && SBDiag.CODES.NECK_KERF.severity === "blocking");
  check("G2 decision 2026-10-10: PART_POINT_CONTACT is a warning (pieces separate when cut, both stay supported in bonded mode)",
    SBDiag.CODES.PART_POINT_CONTACT && SBDiag.CODES.PART_POINT_CONTACT.severity === "warning" &&
    /touch at a corner/.test(SBDiag.CODES.PART_POINT_CONTACT.fix) && /separate when cut/.test(SBDiag.CODES.PART_POINT_CONTACT.fix) &&
    /remain supported in bonded mode/.test(SBDiag.CODES.PART_POINT_CONTACT.fix));
  // two 6 mm blocks joined by an axis neck of n px (0.1 mm/px)
  const neck = (n) => { const w = 160, h = 80, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x >= 10 && x < 70 && y >= 10 && y < 70) || (x >= 90 && x < 150 && y >= 10 && y < 70) || (x >= 70 && x < 90 && y >= 40 && y < 40 + n) ? 1 : 0;
    return mk([new Uint8Array(w * h).fill(1), m], w, h); };
  const run = (L, cfg) => SBSupport.featureChecks(L, Object.assign({}, base, cfg));
  check("PO-FIX-2 a 0.1 mm neck with the 0.15 mm kerf → NECK_KERF (blocking), no NECK_NARROW for that part",
    codes(run(neck(1), { kerfMM: 0.15 })).includes("NECK_KERF") && !codes(run(neck(1), { kerfMM: 0.15 })).includes("NECK_NARROW"));
  check("PO-FIX-2 a 0.2 mm neck with the 0.15 mm kerf → NECK_NARROW (warning) only", (() => { const c = codes(run(neck(2), { kerfMM: 0.15 })); return c.includes("NECK_NARROW") && !c.includes("NECK_KERF"); })());
  check("G.4 #3 no machine (kerfMM null): 0.5 µm floor, a 0.1 mm neck is not NECK_KERF", !codes(run(neck(1), { kerfMM: null })).includes("NECK_KERF"));
  check("G.4 #3 kerf 0 behaves as the floor", !codes(run(neck(1), { kerfMM: 0 })).includes("NECK_KERF"));
  const nk = run(neck(1), { kerfMM: 0.15 }).find((d) => d.code === "NECK_KERF");
  check("PO-FIX-2 NECK_KERF carries the limit in mm and the layer", !!nk && nk.layer === 1 && nk.limit.value === 0.15 && nk.limit.unit === "mm");
  check("G-D2 an odd kerf (0.151 mm, scale 2) still flags a 0.1 mm neck and not a 0.2 mm one", codes(run(neck(1), { kerfMM: 0.151 })).includes("NECK_KERF") && !codes(run(neck(2), { kerfMM: 0.151 })).includes("NECK_KERF"));
  { // cost control (review 2026-10-09): no kerf, no pass; a kerf adds exactly one extra offset per layer, at scale 1 for an even T
    const calls = (cfg) => { const o = SBGeom.offset, seen = []; SBGeom.offset = (p, d, j) => (seen.push(d + ":" + j), o(p, d, j));
      try { run(neck(2), cfg); } finally { SBGeom.offset = o; } return seen; };
    check("G-D2 kerfMM null/0: the kerf erosion pass is skipped (no −75 offset)", !calls({ kerfMM: null }).some((c) => /^-75:/.test(c)) && !calls({ kerfMM: 0 }).some((c) => /^-75:/.test(c)));
    check("G-D2 kerfMM 0.15: one square-join offset of −75 µm at scale 1", calls({ kerfMM: 0.15 }).filter((c) => c === "-75:square").length === 1); }
  // point contact: two 3 mm squares touching at one corner (pixel saddle)
  const saddle = (() => { const w = 80, h = 80, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x >= 10 && x < 40 && y >= 10 && y < 40) || (x >= 40 && x < 70 && y >= 40 && y < 70) ? 1 : 0;
    return mk([new Uint8Array(w * h).fill(1), m], w, h); })();
  const pc = run(saddle, { kerfMM: 0.15, pointContacts: true }).filter((d) => d.code === "PART_POINT_CONTACT");
  // end-to-end (review 2026-10-09): the same saddle through bonded construction. The disc closing turns the contact into a thin neck: one part,
  // NECK_NARROW (a warning, above the kerf), no PART_POINT_CONTACT. The guarantee is for waste, not material (G-D2, G.9 #8).
  { const w = 80, h = 80, m = new Uint8Array(w * h), px = { featR: 8, discR2: 64, bridgeR: 9, cullPx: 1000, maxBridgePx: 400, speckPx: 1000, holePx: 450, frameAnchored: false, cullEnabled: false };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x >= 10 && x < 40 && y >= 10 && y < 40) || (x >= 40 && x < 70 && y >= 40 && y < 70) ? 1 : 0;
    const fin = SBConstruct.bonded([new Uint8Array(w * h).fill(1), m], w, h, px).final, L = mk(fin, w, h), c = codes(run(L, { kerfMM: 0.15, pointContacts: true }));
    check("PO-FIX-2/G.9 #8 saddle after bonded construction: one part, NECK_NARROW (warning), no PART_POINT_CONTACT, no NECK_KERF",
      L[1].parts.length === 1 && c.includes("NECK_NARROW") && !c.includes("PART_POINT_CONTACT") && !c.includes("NECK_KERF")); }
  check("PO-FIX-2 two parts touching at a vertex → one PART_POINT_CONTACT naming both parts, region around (4 mm, 4 mm)",
    pc.length === 1 && (pc[0].parts || []).length === 2 && Array.isArray(pc[0].region) && pc[0].region.every((v, i) => Math.abs(v - [3.5, 3.5, 4.5, 4.5][i]) < 1e-9));
  check("PO-FIX-2 pointContacts false (connected): no PART_POINT_CONTACT", !codes(run(saddle, { kerfMM: 0.15 })).includes("PART_POINT_CONTACT"));
  check("D3 4 a part touching its own hole at a point is not a point contact (G.9 #2)", (() => { const w = 60, h = 60, m = new Uint8Array(w * h).fill(0);
    for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) m[y * w + x] = 1; for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) m[y * w + x] = 0;
    for (let y = 30; y < 40; y++) for (let x = 30; x < 40; x++) m[y * w + x] = 0;   // two holes touching at (30, 30)
    return !codes(run(mk([new Uint8Array(w * h).fill(1), m], w, h), { kerfMM: 0.15, pointContacts: true })).includes("PART_POINT_CONTACT"); })());
  check("G2 featureHead refuses a negative or non-finite kerfMM", ["x", -1, NaN].every((k) => { try { run(neck(2), { kerfMM: k }); return false; } catch (e) { return /kerfMM/.test(e.message); } }));
  check("EXP-07 NECK_KERF blocks the export gate", SBDiag.exportGate([nk], new Set(), { quality: "draft", geometryHash: "x" }, "draft").reason === "BLOCKING");   // cfg quality defaults to draft
  { const g = SBDiag.exportGate(pc, new Set(), { quality: "draft", geometryHash: "x" }, "draft");
    check("G2 decision 2026-10-10: PART_POINT_CONTACT does not block the export gate (unacked warning only, ackState unacked)",
      pc.length === 1 && pc[0].severity === "warning" && pc[0].ackState === "unacked" && g.reason === "UNACKED" && g.blocking.length === 0); }
  // engine wiring: bonded plywood request passes the machine kerf and pointContacts
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8");
  check("G2 engine passes kerfMM and pointContacts to both featureChecks calls", /kerfMM:\s*[^,]*machine/.test(src) && (src.match(/pointContacts:/g) || []).length >= 2);
  // G-D6: the G2 recapture changed diagnostics only (chain-aware like F1: compare with what G2 produced); connected ids may appear,
  // with geometryHash and layerHashes unchanged as for every other id
  { const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8")), recs = gold.recaptured || [];
    const g2 = recs.find((r) => r.task === "G2"), i2 = recs.indexOf(g2);
    const after = (id) => { const later = recs.slice(i2 + 1).find((r) => r.ids.includes(id)); return later ? later.previous[id] : gold.fixtures[id]; };
    const keep = ["slow", "status", "code", "geometryHash", "layerHashes", "cleanupSha", "supportSha", "guidesSha", "statsSha"];
    const off = g2 ? g2.ids.filter((id) => !g2.previous || !g2.previous[id] || keep.some((k) => JSON.stringify(g2.previous[id][k]) !== JSON.stringify(after(id)[k])) ||
      g2.previous[id].diagSha === after(id).diagSha) : ["(no G2 recapture record)"];
    check("G-D6 G2 re-captured ids differ from their previous digests only in diagSha/wholeSha" + (off.length ? " — " + off.join(", ") : ""),
      !!g2 && g2.ids.length > 0 && off.length === 0 && Object.keys(g2.previous).sort().join() === g2.ids.slice().sort().join()); }
  // G2 decision 2026-10-10 (PART_POINT_CONTACT a warning): the G2-PPC recapture changed diagnostics only, for exactly the
  // fixtures that report PART_POINT_CONTACT (chain-aware like G2)
  { const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8")), recs = gold.recaptured || [];
    const gp = recs.find((r) => r.task === "G2-PPC"), ip = recs.indexOf(gp), g2 = recs.find((r) => r.task === "G2");
    const after = (id) => { const later = recs.slice(ip + 1).find((r) => r.ids.includes(id)); return later ? later.previous[id] : gold.fixtures[id]; };
    const keep = ["slow", "status", "code", "geometryHash", "layerHashes", "cleanupSha", "supportSha", "guidesSha", "statsSha"];
    const off = gp ? gp.ids.filter((id) => !gp.previous || !gp.previous[id] || keep.some((k) => JSON.stringify(gp.previous[id][k]) !== JSON.stringify(after(id)[k])) ||
      gp.previous[id].diagSha === after(id).diagSha) : ["(no G2-PPC recapture record)"];
    const expected = g2 ? g2.ids.filter((id) => id !== "fine-pitch-fabrication").sort().join() : null;
    check("G-D6 G2-PPC re-captured exactly the G2 point-contact fixtures, diagSha/wholeSha only" + (off.length ? " — " + off.join(", ") : ""),
      !!gp && off.length === 0 && gp.ids.slice().sort().join() === expected && Object.keys(gp.previous).sort().join() === expected); }
});
// ------------------------------------------------ Appendix G G3: octagonal feature erosion and neck regions
suite("support.js — Appendix G G3 octagonal erosion and neck regions (PO-FIX-3, GEO-05, UI-04)", () => {
  const mk = (m, w, h) => SBMaterial.assignParts(SBMaterial.fromMasks([new Uint8Array(w * h).fill(1), m], w, h, { artWMM: w * 0.1, artHMM: h * 0.1, frameMM: 0 }, {}));
  const cfg = { minFeatureMM: 1.5, advisoryFeatureMM: 2, minPartMM2: 0, mmPerPxMax: 0.1, calibrated: true, kerfMM: 0.15 };
  const diag = (wpx) => { const w = 220, h = 220, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const A = x >= 20 && x < 80 && y >= 20 && y < 80, B = x >= 140 && x < 200 && y >= 140 && y < 200,
      S = Math.abs(x - y) / Math.SQRT2 <= wpx / 2 && x >= 50 && x <= 170; m[y * w + x] = A || B || S ? 1 : 0; } return mk(m, w, h); };
  const ds = (L) => SBSupport.featureChecks(L, cfg), has = (L, c) => ds(L).some((d) => d.code === c);
  check("PO-FIX-3 a 1.8 mm 45° neck is not NECK_NARROW at 1.5 mm (square erosion flagged anything < 2.12 mm)", !has(diag(18), "NECK_NARROW"));
  check("PO-FIX-3 a 1.8 mm 45° neck is FEATURE_MARGINAL (neck) at the 2.0 mm advisory", ds(diag(18)).some((d) => d.code === "FEATURE_MARGINAL" && d.detail && d.detail.kind === "neck"));
  const nn = ds(diag(10)).find((d) => d.code === "NECK_NARROW");
  const reg = nn && (Array.isArray(nn.region[0]) ? nn.region : [nn.region]);
  check("PO-FIX-3 a 1.0 mm 45° neck → NECK_NARROW whose region is the neck (inside x, y ∈ [5, 17] mm, < 8 mm wide), not the part bbox (2–20 mm)",
    !!reg && reg.length >= 1 && reg.every((b) => b[0] >= 5 && b[2] <= 17 && b[1] >= 5 && b[3] <= 17 && b[2] - b[0] < 8));
  // two necks in one part → two regions (G.4 #4)
  { const w = 300, h = 100, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x < 80 && y > 20 && y < 80) || (x >= 110 && x < 190 && y > 20 && y < 80) || (x >= 220 && y > 20 && y < 80) || (y >= 45 && y < 55) ? 1 : 0;
    const n = ds(mk(m, w, h)).filter((d) => d.code === "NECK_NARROW"), regs = n.flatMap((d) => (Array.isArray(d.region[0]) ? d.region : [d.region]));
    check("G.4 #4 a part with two 1.0 mm necks gets two neck regions, one per neck", regs.length === 2 && regs[0][2] <= 12 && regs[1][0] >= 18); }
  check("G3 neckRegions returns [] (no throw) when nothing is isolated", Array.isArray(SBSupport.neckRegions({ outer: [0, 0, 1000, 0, 1000, 1000, 0, 1000], holes: [] }, [], 100, 1)));
  // self-consistency with construction (review 2026-10-09, G-D1 tie rule): what the disc cleanup keeps is not flagged as too narrow
  { const C = SBConstruct, PX = { featR: 8, discR2: 64, bridgeR: 9, cullPx: 1000, maxBridgePx: 400, speckPx: 1000, holePx: 450, frameAnchored: false, cullEnabled: false };
    const kept = (wpx) => { const w = 220, h = 220, m = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const A = x >= 20 && x < 80 && y >= 20 && y < 80, B = x >= 140 && x < 200 && y >= 140 && y < 200,
        S = Math.abs(x - y) / Math.SQRT2 <= wpx / 2 && x >= 50 && x <= 170; m[y * w + x] = A || B || S ? 1 : 0; }
      return mk(C.bonded([new Uint8Array(w * h).fill(1), m], w, h, PX).final[1], w, h); };
    for (const wpx of [16, 17, 18, 22]) { const L = kept(wpx), c = ds(L).map((d) => d.code);
      check(`G1/G3 tie rule: a ${wpx / 10} mm 45° neck that construction keeps (one part) is not NECK_NARROW or PART_THIN`, L[1].parts.length === 1 && !c.includes("NECK_NARROW") && !c.includes("PART_THIN")); } }   // measured: 16 px and wider keep one part and pass the octagon
  // cost bound: a part with many lost chips but one real neck calls Clipper O(candidates), not O(lost × pads)
  { const w = 600, h = 200, m = new Uint8Array(w * h);   // two blocks, a 1.0 mm neck, and a staircase edge that makes the octagon opening chip every step
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x < 250 && y > 20 && y < 180 && (x < 200 || ((x + y) >> 2) % 2 === 0)) || (x >= 350 && y > 20 && y < 180) || (y >= 95 && y < 105) ? 1 : 0;
    const G = SBGeom, o = G.intersection; let n = 0; G.intersection = (a, b) => (n++, o(a, b));
    let regs; try { regs = ds(mk(m, w, h)).filter((d) => d.code === "NECK_NARROW"); } finally { G.intersection = o; }
    check("G3 neckRegions finds the neck and bounds its Clipper work (intersection calls ≤ 64 on a chip-heavy part)", regs.length >= 1 && n <= 64); }
  // NECK_KERF is located too (G2 kerf erosion residual, scale 1 for an even kerf, scale 2 for an odd one); it stays blocking
  { const w = 200, h = 100, m = new Uint8Array(w * h);   // two 7 × 6 mm blocks joined by a 0.1 mm (1 px) neck at y = 5 mm
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x >= 10 && x < 80 && y >= 20 && y < 80) || (x >= 120 && x < 190 && y >= 20 && y < 80) || y === 50 ? 1 : 0;
    const L = mk(m, w, h), inNeck = (b) => b[0] >= 7.5 && b[2] <= 12.5 && b[1] >= 4.5 && b[3] <= 5.5;
    const kOf = (c) => SBSupport.featureChecks(L, { ...cfg, ...c }).filter((d) => d.code === "NECK_KERF");
    const k2 = kOf({}), k3 = kOf({ kerfMM: 0.151 });
    check("G3 NECK_KERF (0.15 mm kerf, scale 1) stays blocking and its region is the 0.1 mm neck, not the part bbox (1–19 mm)",
      L[1].parts.length === 1 && k2.length === 1 && k2[0].severity === "blocking" && k2[0].region.length === 1 && inNeck(k2[0].region[0]));
    check("G3 NECK_KERF at an odd kerf (0.151 mm, half-µm scale 2) is located at the same neck", k3.length === 1 && k3[0].region.length === 1 && inNeck(k3[0].region[0]));
    // no neck isolated → one raw diagnostic with the part bbox and "(neck location approximate)"
    const o = SBSupport.neckRegions; let raw; SBSupport.neckRegions = () => [];
    try { raw = SBSupport.featureLayer(L[1], 1, cfg).filter((d) => d.code === "NECK_KERF"); } finally { SBSupport.neckRegions = o; }
    const pb = L[1].parts[0].bbox.map((v) => v / 1000);
    check("G3 when neckRegions isolates nothing: one NECK_KERF with the part bbox and \"(neck location approximate)\"",
      raw.length === 1 && raw[0].part === L[1].parts[0].id && raw[0].region.join() === pb.join() && raw[0].message.includes("(neck location approximate)")); }
  // counts are per neck (review 2026-10-09): one part with two necks → count 2, parts[] lists it twice, index-aligned with
  // region[]; the part area is carried once (by the first raw diagnostic), so areaMM2 stays the affected-part area
  { const w = 300, h = 100, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = (x < 80 && y > 20 && y < 80) || (x >= 110 && x < 190 && y > 20 && y < 80) || (x >= 220 && y > 20 && y < 80) || (y >= 45 && y < 55) ? 1 : 0;
    const L = mk(m, w, h), p = L[1].parts[0], a = SBSupport.featureChecks(L, cfg).filter((d) => d.code === "NECK_NARROW");
    const raw = SBSupport.featureLayer(L[1], 1, cfg).filter((d) => d.code === "NECK_NARROW");
    check("G3 two necks in one part: aggregate count 2, parts [id, id] aligned with 2 regions, areaMM2 = the part area once",
      a.length === 1 && a[0].count === 2 && a[0].parts.join() === [p.id, p.id].join() && a[0].region.length === 2 &&
      Math.abs(a[0].areaMM2 - SBGeom.area([p.polygon]) / 1e6) < 1e-9 && raw.length === 2 && raw[1].areaMM2 === null); }
  // G-D6: the G3 recapture changed diagnostics only (chain-aware like G2); connected ids appear (their feature checks run
  // the octagon too), with geometryHash and layerHashes unchanged as for every other id
  { const gold = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "pool-equality.json"), "utf8")), recs = gold.recaptured || [];
    const g3 = recs.find((r) => r.task === "G3"), i3 = recs.indexOf(g3);
    const after = (id) => { const later = recs.slice(i3 + 1).find((r) => r.ids.includes(id)); return later ? later.previous[id] : gold.fixtures[id]; };
    const keep = ["slow", "status", "code", "geometryHash", "layerHashes", "cleanupSha", "supportSha", "guidesSha", "statsSha"];
    const off = g3 ? g3.ids.filter((id) => !g3.previous || !g3.previous[id] || keep.some((k) => JSON.stringify(g3.previous[id][k]) !== JSON.stringify(after(id)[k])) ||
      g3.previous[id].diagSha === after(id).diagSha) : ["(no G3 recapture record)"];
    check("G-D6 G3 re-captured ids differ from their previous digests only in diagSha/wholeSha" + (off.length ? " — " + off.join(", ") : ""),
      !!g3 && g3.ids.length > 0 && off.length === 0 && Object.keys(g3.previous).sort().join() === g3.ids.slice().sort().join()); }
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

// ------------------------------------------------ alpha.3 E12 (re-review draft repairs in the Fabrication review)
suite("test/bench.js — speed round F2 guide stage and per-stage times (PO-PERF-5)", () => {
  const B = require("./bench.js");
  const sd = typeof B.stageDurations === "function" ? B.stageDurations([["orient", 0], ["resample", 2], ["construct", 5], ["construct", 6], ["complexity", 9], ["trace", 10],
    ["complexity", 14], ["guides", 15], ["accounting", 18.5], ["hashes", 19], ["done", 20]], -1, 21) : null;
  check("S5 stageDurations: stage → next different mark, repeated marks merged, re-entered stages summed, setup before the first mark",
    !!sd && sd.setup === 1 && sd.orient === 2 && sd.resample === 3 && sd.construct === 4 && sd.complexity === 2 && sd.trace === 4 && sd.guides === 3.5 &&
    sd.accounting === 0.5 && sd.hashes === 1 && !("done" in sd));
  const run = (guides) => typeof B.benchDraft === "function" ? B.benchDraft({ quick: true, src: [200, 150], candidates: [200], only: ["a"], families: ["realistic"], guides, warm: 0, runs: 1, fabRuns: 1 }) : null;
  const on = run("inset-outline"), off = run("none");
  const r = on && on.rows[0], fr = on && on.fabRows[0], st = r && r.stages;
  check("S5 bench reports a guides stage column for bonded guide workloads",
    !!st && r.status === "done" && st.guides > 0 && st["guides.build"] > 0 && st["guides.validate"] >= 0 && st.construct > 0 && st.trace > 0 &&
    st["guides.build"] + st["guides.validate"] <= st.guides + 1e-6 && r.guides === "inset-outline");
  check("S5 the fabrication rows carry the same stage table (guides included)", !!fr && fr.status === "done" && fr.stages && fr.stages.guides > 0 && fr.stages.resample >= 0);
  check("S5 --guides none removes the guides column", !!off && off.rows[0].status === "done" && !("guides" in off.rows[0].stages) && off.rows[0].guides === "none");
  const U = B.USER12, up = U && typeof B.user12Project === "function" ? B.user12Project({ pixels: new Uint8Array(64 * 48 * 4).fill(128), channels: 4, w: 64, h: 48, alpha: null }) : null;
  check("S2 user12 workload: 4096 × 3084 alpha.3 scene, draftProject(a) settings, fabPitch 0.1 mm, inset-outline guides, rows draft720/fab3600/fab4096",
    !!U && U.src.join("x") === "4096x3084" && JSON.stringify(Object.keys(U.rows)) === JSON.stringify(["draft720", "fab3600", "fab4096"]) &&
    !!up && up.geometry.fabPitchMM === 0.1 && up.construction.guides.mode === "inset-outline" && up.construction.sheets === 8 && up.interpretation.mode === "tonal" &&
    up.interpretation.polarity === "light-front" && up.geometry.targetMM === 300);
  const sr = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "perf", "speed-round.json"), "utf8")); } catch (e) { return null; } })();
  check("S5 docs/perf/speed-round.json records the alpha.3 baseline (draft720, fab3600, fab4096) with stage tables incl. guides",
    !!sr && !!sr.baseline && ["draft720", "fab3600", "fab4096"].every((k) => sr.baseline[k] && sr.baseline[k].runs >= 3 && sr.baseline[k].p50Ms > 0 &&
      sr.baseline[k].stagesP50Ms && sr.baseline[k].stagesP50Ms.guides > 0));
  check("S5 speed-round.json records the warm-720 guides re-profile (build and validate separately, with and without guides)",
    !!sr && !!sr.warm720 && Array.isArray(sr.warm720.rows) && sr.warm720.rows.some((x) => x.guides === "inset-outline" && x.stagesP50Ms["guides.build"] > 0) &&
    sr.warm720.rows.some((x) => x.guides === "none"));
});

suite("app.js/support.js — alpha.3 E12 repair re-review at fabrication (SUP-04, PO-PREVIEW-6, EXP-07)", () => {
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const fn = (name) => { const i = appSrc.indexOf("function " + name + "("); return i < 0 ? "" : appSrc.slice(i, appSrc.indexOf("\n  }\n", i)); };
  check("PO-PREVIEW-6 REPAIR_REVIEW_FAB items offer Show, Keep and Revert in the Fabrication review",
    /REPAIR_REVIEW_FAB/.test(appSrc) && /Keep this clip at fabrication resolution/.test(appSrc) && /SBSupport\.removeRepair\(/.test(appSrc) && /showFab\(\)/.test(appSrc));
  check("UI-04 Show focuses the diagnostic on the fabrication result", /focusDiagnostic\(/.test(appSrc) && /run\.shown === run\.fab/.test(appSrc));
  const act = fn("fabRepairActions"), item = fn("diagItem"), clip = fn("clipAction");
  check("PO-PREVIEW-6 fabRepairActions: Show (showFab then focusDiagnostic), Revert (revertRepair of the entry the fab run replayed)",
    /showFab\(\)/.test(act) && /focusDiagnostic\(/.test(act) && /revertRepair\(/.test(act) &&
    /SBProof\.repairForDiagnostic\(d, [^)]*run\.fab\.snapshot\.repairsApplied/.test(act) && act.indexOf("showFab()") < act.indexOf("focusDiagnostic("));
  check("PO-PREVIEW-6 diagItem gives a fabrication REPAIR_REVIEW_FAB its actions in every panel (also while the draft is shown) and the Keep label",
    /r === run\.fab && d\.code === "REPAIR_REVIEW_FAB"/.test(item) && /fabRepairActions\(/.test(item) && /Keep this clip at fabrication resolution/.test(item));
  check("SUP-04 REPAIR_STALE keeps its \"Review clip N…\" link; REPAIR_REVIEW_FAB no longer opens the draft clip dialog",
    /d\.code === "REPAIR_STALE"/.test(clip) && /Review clip /.test(clip) && !/REPAIR_REVIEW_FAB/.test(clip));
  check("UI-06 a Revert (a geometry edit) returns the view to the draft", /showDraft\(\)/.test(fn("recompute")) && /recompute\(\)/.test(fn("commitProject")) &&
    /commitProject\(next, "repair"\)/.test(fn("revertRepair")));
  const S = SBSchema, P = SBSupport, p = S.defaults("plywood"); p.source = S.sourceTemplate();
  const q = Object.assign(JSON.parse(JSON.stringify(p)), { revision: 3 }); q.construction.repairs = [{ op: "clip-to-lower", layer: 1, sourceRevision: 2, resultRevision: 3, keyHash: "0".repeat(64),
    reviewed: { quality: "draft", beforeHash: "0".repeat(64), afterHash: "0".repeat(64), removedAreaMM2: 1, partCountBefore: 1, partCountAfter: 1 } }];
  const r = P.removeRepair(q, 0);
  check("SUP-04 Revert in the fabrication review bumps the revision (the fab result becomes stale)", r.revision === 4 && r.construction.repairs.length === 0);
  const dg = SBDiag.make("REPAIR_REVIEW_FAB", { layer: 1, areaMM2: 2.5, measured: { value: 2.5, unit: "mm2" }, detail: "clip-to-lower 1 was reviewed at draft quality; at this resolution it removes 2.5 mm² and parts 3 → 2" });
  check("EXP-07 the REPAIR_REVIEW_FAB item shows its fabrication mm² and part counts", /2\.5 mm²/.test(SBDiag.describe(dg).message) && /parts 3 → 2/.test(SBDiag.describe(dg).message));
  check("PO-PREVIEW-6 the replayed entry is the one Revert removes", SBProof.repairForDiagnostic(dg, q.construction.repairs, [0]) === 0);
});

// ------------------------------------------------ alpha.3 E13 (bonded ASSEMBLY.md and the settings.json project block)
suite("docs.js/app.js — alpha.3 E13 assembly and settings (ASM-05, EXP-06, PO-PREVIEW-7)", () => {
  const E = SBEngine, S = SBSchema, w = 400, h = 100;
  const px = { pixels: new Uint8Array(w * h).fill(100), channels: 1, w, h, alpha: null };
  const p = S.withSource(S.defaults("plywood"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); p.geometry.targetMM = 10; p.title = "t";
  const s = E.generate(E.request(p, px, { quality: "fabrication" })).snapshot, md = SBDocs.assembly(p, s, { colors: "#c8a26b" });
  check("ASM-05 bonded ASSEMBLY names the glue-up order, thickness, guides and the placement map; no bridge or spacer text",
    /glue/i.test(md) && /6\.35/.test(md) && /placement_map\.svg/.test(md) && /concealment/i.test(md) && !/bridge|dowel|spacer/i.test(md));
  check("D-4.7 ASSEMBLY rows are the exported sheets only; omitted layers are listed",
    (md.match(/^\| sheet_\d\d\.svg/gm) || []).length === s.stats.exported &&
    md.includes("Omitted layers (empty at the top of the stack, not exported): " + s.layers.filter((x) => x.status === "omitted-trailing").map((x) => x.index + 1).join(", ") + ".") &&
    s.layers.some((x) => x.status === "omitted-trailing"));
  check("D-4.7 with nothing omitted ASSEMBLY says no layers were omitted",
    /No layers were omitted\./.test(SBDocs.assembly(p, Object.assign({}, s, { layers: s.layers.map((x) => Object.assign({}, x, { status: x.status === "omitted-trailing" ? "ok" : x.status })) }), {})));
  // bonded guide branches: interior-mark wording, guide mode none, the omitted-guides list
  const gen = (mode) => { const q = JSON.parse(JSON.stringify(p)); q.construction.guides.mode = mode; return [q, E.generate(E.request(q, px, { quality: "fabrication" })).snapshot]; };
  const [pm, sm] = gen("interior-mark"), mdm = SBDocs.assembly(pm, sm, {});
  check("ASM-05 interior-mark ASSEMBLY describes the scored cross (position only, rotation from placement_map.svg)",
    /Guide mode: interior-mark\./.test(mdm) && /scored cross/.test(mdm) && /rotation from placement_map\.svg/.test(mdm) && !/scored outlines/.test(mdm) && /onto the scored crosses on the sheet below it/.test(mdm));
  const [pn, sn] = gen("none"), mdn = SBDocs.assembly(pn, sn, {});
  check("ASM-05 guide mode none: guides are off, place parts from placement_map.svg; no guide-mode line",
    /Guides are off for this project/.test(mdn) && !/Guide mode:/.test(mdn) && !/scored cross|scored outlines/.test(mdn) && /Glue each next sheet in file order in the positions shown in placement_map\.svg/.test(mdn) &&
    /carry no scored numbers/.test(mdn) && !/scored number on a sheet|guides were omitted|Omitted guides/.test(mdn));
  const so = Object.assign({}, s, { guides: Object.assign({}, s.guides, { omitted: [{ layer: 3, part: 2, reason: "part too small" }, { layer: 4 }] }) });
  const mdo = SBDocs.assembly(p, so, {});
  check("ASM-05 omitted guides are listed with layer, part and reason",
    mdo.includes("Omitted guides (2), place these parts from placement_map.svg:") && mdo.includes("- layer 3, part 2: part too small") && /^- layer 4$/m.test(mdo) &&
    !/No guides were omitted/.test(mdo) && /No guides were omitted/.test(md) === !(s.guides && s.guides.omitted && s.guides.omitted.length));
  check("PO-LASER-7/MAT-05 ASSEMBLY states the machine and the external kerf in the G3.5 wording", /xTool S1/.test(md) && /0\.15/.test(md) && md.includes("no kerf offset applied (kerfMode=external)"));
  check("NFR-12/EXP-09 no speed/power values; the downstream-edit warning is present",
    !/\b\d+(\.\d+)?\s*(%|mm\/s|mm\/min|k?W)(?!\w)/i.test(md) && /edit/i.test(md) && /laser software/i.test(md));
  check("PO-PREVIEW-2 ASSEMBLY names the short geometryHash of the exported result", md.includes(s.geometryHash.slice(0, 12)));
  check("ASM-05 bonded glue-up: sheet 1 face up, no mirroring; the scored number is the sheet's own; MAT-01/MAT-04 disclaimers",
    /face up/i.test(md) && /mirror/i.test(md) && /own (sheet )?number/i.test(md) && md.includes(SBDocs.COPY.MAT01) && md.includes(SBDocs.COPY.MAT04));
  check("ASM-05 the exported sheet roles are base, layer and top", /\| base \|/.test(md) && /\| top \|/.test(md));
  check("ASM-05 SBDocs.assembly is deterministic (same inputs, same text)", SBDocs.assembly(p, s, { colors: "#c8a26b" }) === md);
  // connected: today's wording, rebuilt from the fabrication snapshot
  const c = S.withSource(S.defaults("acrylic"), E.sourceRecord(px, { format: "png", decode: "raw-gray8" })); c.title = "c";
  const cs = E.generate(E.request(c, px, { quality: "fabrication" })).snapshot, cmd = SBDocs.assembly(c, cs, { colors: cs.layers.map(() => "#000000") });
  check("ASM-05 connected ASSEMBLY keeps the frame, holes, bridges and spacer wording with the snapshot's gap",
    /frame/i.test(cmd) && /registration holes/i.test(cmd) && /bridge/i.test(cmd) && /spacer/i.test(cmd) && cmd.includes(String(cs.construction.gMM)) &&
    (cmd.match(/^\| sheet_\d\d\.svg/gm) || []).length === cs.stats.exported && cmd.includes("no kerf offset applied (kerfMode=external)"));
  const nC = cs.stats.exported, tC = cs.construction.tMM, gC = cs.construction.gMM, fmt = (v) => String(Number(Number(v).toFixed(3)));
  const zC = Math.round((nC * tC + (nC - 1) * gC) * 1000) / 1000;
  const shC = (cmd.match(/^- Stack height: .*$/m) || [""])[0];
  check("LYR-01 connected stack height line adds the gaps (nE·t + (nE−1)·g) and has no relief above the base",
    nC > 1 && gC > 0 && Math.abs(cs.stats.maxZMM - zC) < 1e-9 && shC.startsWith("- Stack height: " + fmt(zC) + " mm for the " + nC + " exported sheets (") &&
    shC.includes(nC + " × " + fmt(tC) + " mm sheets + " + (nC - 1) + " × " + fmt(gC) + " mm gaps") && !/relief above the base/.test(shC));
  const shB = (md.match(/^- Stack height: .*$/m) || [""])[0];
  check("LYR-01 bonded stack height line is nE × t with the relief above the base",
    shB.includes(s.stats.exported + " × " + fmt(s.construction.tMM) + " mm, relief above the base ") && !/gaps/.test(shB));
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  check("PO-PREVIEW-7 buildAndDeliver writes SBDocs.assembly from run.fab.snapshot; buildAssemblyMD is gone",
    /SBDocs\.assembly\(project, run\.fab\.snapshot/.test(appSrc) && !/function buildAssemblyMD\(/.test(appSrc) && !/run\.sheets\b|run\.procW/.test(appSrc));
  check("EXP-06 settings.json keeps the 19 v1.1 keys and adds a project block with mode, thickness, pitch and hash",
    /o\.project = /.test(appSrc) && /run\.fab\.snapshot\.geometryHash/.test(appSrc.slice(appSrc.indexOf("function settingsJSON("), appSrc.indexOf("function settingsJSON(") + 1500)));
  const sj = appSrc.slice(appSrc.indexOf("function settingsJSON("), appSrc.indexOf("function settingsJSON(") + 1500);
  check("EXP-06 the project block names geometryKey, both modes, thickness, pitch, raster and engineVersion",
    ["geometryKey", "constructionMode", "interpretationMode", "thicknessMM", "fabPitchMM", "raster", "engineVersion"].every((k) => sj.includes(k)));
  const back = S.fromLegacySettings(Object.assign({ procRes: 720, nSheets: 5 }, { project: { constructionMode: "bonded-relief" } }));
  check("DEP-04 a settings.json with a project block re-imports as the documented lossy v1.1 mapping and says so",
    back && back.project && S.validate(back.project).ok === true && back.project.construction.mode === "connected-sheet" &&
    back.project.extras.legacy && back.project.extras.legacy.project && back.diagnostics.some((d) => d.code === "LEGACY_PROJECT_BLOCK" && SBDiag.CODES.LEGACY_PROJECT_BLOCK.severity === "info"));
  const lpb = back.diagnostics.find((d) => d.code === "LEGACY_PROJECT_BLOCK"), lpbText = SBDiag.describe(lpb);
  const both = S.fromLegacySettings({ procRes: 720, project: { constructionMode: "bonded-relief", interpretationMode: "tonal" } }).diagnostics.find((d) => d.code === "LEGACY_PROJECT_BLOCK");
  check("DEP-04 LEGACY_PROJECT_BLOCK detail carries only the modes; the title and the .sbrproj sentence are not repeated",
    lpb.message === SBDiag.CODES.LEGACY_PROJECT_BLOCK.title + ": modes: bonded-relief" &&
    both.message === SBDiag.CODES.LEGACY_PROJECT_BLOCK.title + ": modes: bonded-relief, tonal" &&
    ((lpbText.text + " " + lpbText.fix).match(/came from a v2 project/g) || []).length === 1 && ((lpbText.text + " " + lpbText.fix).match(/\.sbrproj/g) || []).length === 1);
  check("DEP-04 a plain v1.1 settings.json raises no LEGACY_PROJECT_BLOCK", !S.fromLegacySettings({ procRes: 720 }).diagnostics.some((d) => d.code === "LEGACY_PROJECT_BLOCK"));
  const ug = fs.readFileSync(path.join(__dirname, "..", "docs", "USER_GUIDE.md"), "utf8");
  check("DEP-04 USER_GUIDE says a v2 settings.json re-imports as v1.1 settings only (LEGACY_PROJECT_BLOCK)", /LEGACY_PROJECT_BLOCK/.test(ug) && /\.sbrproj/.test(ug));
});

// ------------------------------------------------ checkpoint v2.0.0-alpha.3 (real-engine preview, bonded alignment)
suite("CHANGELOG — checkpoint v2.0.0-alpha.3 (R9, PO-PREVIEW-1..7)", () => {
  const cl = fs.readFileSync(path.join(__dirname, "..", "docs/CHANGELOG.md"), "utf8"), sec = (cl.split(/^## v2\.0\.0-alpha\.3\b.*$/m)[1] || "").split(/^## /m)[0];
  check("R9 CHANGELOG v2.0.0-alpha.3 has a known-gaps table (worker, draft budget, part IDs, holes, .sbrproj, manifest, layout, legacy repairs, draftPx in the key, draft approximation, lossy settings re-import)",
    /known gaps/i.test(sec) && /^\|.*\|\s*$/m.test(sec) && /G4\.1/.test(sec) && /draft/i.test(sec) && /part ID/i.test(sec) && /registration holes/i.test(sec) &&
    /\.sbrproj/.test(sec) && /manifest/i.test(sec) && /layout/i.test(sec) && /REPAIR_STALE/.test(sec) && /draftPx/.test(sec) && /approximat/i.test(sec) && /LEGACY_PROJECT_BLOCK/.test(sec));
  check("R9 CHANGELOG v2.0.0-alpha.3 summarises every PO-PREVIEW requirement (1..7)",
    [1, 2, 3, 4, 5, 6, 7].every((n) => new RegExp("PO-PREVIEW-" + n + "\\b").test(sec)));
  check("R9 CHANGELOG has no empty-handed Unreleased section above v2.0.0-alpha.3 (items moved into the release)",
    !/^## Unreleased\b/m.test(cl.slice(0, cl.search(/^## v2\.0\.0-alpha\.3\b/m))));
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  check("DEP-02 sw.js VERSION follows the release (2.0.0-alpha.4 since speed round F18; cache name follows it)", /const VERSION\s*=\s*"2\.0\.0-alpha\.4"/.test(sw));
});
