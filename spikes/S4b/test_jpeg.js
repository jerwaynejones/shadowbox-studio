// S4b spike runner:  node spikes/S4b/test_jpeg.js [--bench] [--fuzz N]
// Loads the candidate module exactly as the browser would (classic script ->
// globalThis.SBJpeg) and uses the repo's T0.3 fixture generator read-only.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "jpeg.js"), "utf8"), { filename: "jpeg.js" });
const F = require(path.join(ROOT, "test", "fixtures.js"));
const CORPUS = path.join(__dirname, "corpus");
const CODES = new Set(["JPEG_SIGNATURE", "JPEG_TRUNCATED", "JPEG_BAD_SEGMENT", "JPEG_NO_SOF"]);
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.error("  ✗ " + name + (extra ? "  " + extra : "")); } };
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code || ("UNCODED:" + e.message); } };
const J = SBJpeg;
// test/fixtures.js jpegHeader with the proposed fix (TIFF buffer 26 -> 28 bytes so the IFD entry is complete).
function jpegHeaderFixed({ w, h, exif = 0, truncate = 0, sofLen = 17 }) {
  const seg = (m, body) => { const b = Buffer.alloc(4 + body.length); b[0] = 0xff; b[1] = m; b.writeUInt16BE(body.length + 2, 2); Buffer.from(body).copy(b, 4); return b; };
  const parts = [Buffer.from([0xff, 0xd8])];
  if (exif) { const t = Buffer.alloc(28); t.write("Exif\0\0", 0, "latin1"); t.write("MM", 6, "latin1"); t.writeUInt16BE(42, 8); t.writeUInt32BE(8, 10);
    t.writeUInt16BE(1, 14); t.writeUInt16BE(0x0112, 16); t.writeUInt16BE(3, 18); t.writeUInt32BE(1, 20); t.writeUInt16BE(exif, 24); parts.push(seg(0xe1, t)); }
  const sof = Buffer.alloc(sofLen - 2); sof[0] = 8; sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3); sof[5] = 3;
  parts.push(seg(0xc0, sof), Buffer.from([0xff, 0xd9]));
  const out = Buffer.concat(parts); return new Uint8Array(truncate ? out.subarray(0, out.length - truncate) : out);
}

console.log("\nspike S4b — plan tests (IMG-05/07, AT-22)");
{
  const i = J.inspect(F.jpegHeader({ w: 6000, h: 4000 }));
  check("IMG-07 JPEG SOF dimensions read before decode", i.w === 6000 && i.h === 4000);
  // T0.3 fixture's APP1 is 26 bytes: its single IFD entry is 2 bytes short. Chromium ignores such an
  // Exif, so SBJpeg must too. FIXED_FIXTURE = the one-token fixture fix proposed in docs/spikes/S4b.md.
  check("IMG-05 JPEG EXIF orientation 6 parsed", J.inspect(F.jpegHeader({ w: 640, h: 480, exif: 6 })).exif === 6);
  // The T0.3 fixture now carries amendment 3 (Buffer.alloc(28)); before it, the single IFD entry was 2 bytes short
  // and flagged exifAmbiguous (Chromium ignores such an Exif, Firefox applies it).
  check("IMG-05 T0.3 fixture (amended, alloc 28) -> exif 6, not ambiguous", J.inspect(F.jpegHeader({ w: 640, h: 480, exif: 6 })).exifAmbiguous === false);
  check("IMG-05 proposed fixture (Buffer.alloc(28)) -> exif 6, not ambiguous", (() => { const i = J.inspect(jpegHeaderFixed({ w: 640, h: 480, exif: 6 })); return i.exif === 6 && !i.exifAmbiguous; })());
  const bad = F.jpegHeader({ w: 64, h: 64 }); bad[1] = 0x00;
  check("AT-22 corrupt JPEG (bad SOI) rejected", codeOf(() => J.inspect(bad)) === "JPEG_SIGNATURE");
  check("AT-22 truncated JPEG rejected", codeOf(() => J.inspect(F.jpegHeader({ w: 64, h: 64, truncate: 5 }))) === "JPEG_TRUNCATED");
  check("AT-22 oversized SOF segment length rejected", codeOf(() => J.inspect(F.jpegHeader({ w: 64, h: 64, sofLen: 4000 }))) === "JPEG_BAD_SEGMENT");
}

console.log("\nspike S4b — fixture edge cases");
{
  for (let o = 1; o <= 8; o++) check(`fixture exif ${o} parsed`, J.inspect(jpegHeaderFixed({ w: 8, h: 8, exif: o })).exif === o);
  check("fixture without APP1 -> exif null", J.inspect(F.jpegHeader({ w: 8, h: 8 })).exif === null);
  const t2 = F.jpegHeader({ w: 8, h: 8, truncate: 2 });
  check("fixture truncate:2 removes only EOI -> header still inspectable (documented limit)", J.inspect(t2).w === 8);
  const full = jpegHeaderFixed({ w: 8, h: 8, exif: 6 }); const hb = J.inspect(full).headerBytes;
  let allTrunc = true, worst = "";
  for (let k = 0; k < hb; k++) { const c = codeOf(() => J.inspect(full.subarray(0, k))); const want = k < 2 ? "JPEG_SIGNATURE" : "JPEG_TRUNCATED"; if (c !== want) { allTrunc = false; worst = `k=${k} got ${c}`; } }
  check(`every prefix shorter than headerBytes (${hb}) -> SIGNATURE (<2) / TRUNCATED`, allTrunc, worst);
  for (const s of [8, 16, 18, 4000]) check(`sofLen ${s} (!= 17) -> BAD_SEGMENT`, codeOf(() => J.inspect(F.jpegHeader({ w: 8, h: 8, sofLen: s }))) === "JPEG_BAD_SEGMENT");
  check("empty input -> SIGNATURE", codeOf(() => J.inspect(new Uint8Array(0))) === "JPEG_SIGNATURE");
  check("PNG bytes -> SIGNATURE", codeOf(() => J.inspect(F.pngEncode({ w: 2, h: 2, colorType: 0, bitDepth: 8, data: new Uint8Array(4) }))) === "JPEG_SIGNATURE");
  check("SOI then EOI -> NO_SOF", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))) === "JPEG_NO_SOF");
  check("SOI then SOS -> NO_SOF", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))) === "JPEG_NO_SOF");
  check("segment length 0 -> BAD_SEGMENT", codeOf(() => J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))) === "JPEG_BAD_SEGMENT");
  check("RSTn/TEM standalone markers skipped", J.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xd0, 0xff, 0x01, ...F.jpegHeader({ w: 3, h: 2 }).subarray(2)])).w === 3);
  check("ArrayBuffer input accepted", J.inspect(F.jpegHeader({ w: 5, h: 7 }).slice().buffer).h === 7);
}

console.log("\nspike S4b — real-encoder corpus (libjpeg-turbo cjpeg 3.2.0 / ImageMagick 7.1.2)");
const expectations = {
  "baseline.jpg": { sof: 0xc0, components: 3, progressive: false },
  "progressive.jpg": { sof: 0xc2, components: 3, progressive: true },
  "gray.jpg": { sof: 0xc0, components: 1 },
  "arithmetic.jpg": { sof: 0xc9, arithmetic: true, $unsup: "arithmetic coding" },
  "arith_progressive.jpg": { sof: 0xca, arithmetic: true, progressive: true, $unsup: "arithmetic coding" },
  "restart.jpg": { sof: 0xc0 },
  "p12.jpg": { sof: 0xc1, precision: 12, $unsup: "12-bit precision" },
  "lossless.jpg": { sof: 0xc3, lossless: true, $unsup: "lossless" },
  "yuv444.jpg": { sof: 0xc0, components: 3 },
  "cmyk.jpg": { components: 4 },
  "big_24mp.jpg": { w: 6000, h: 4000 },
  "mp16.jpg": { w: 4000, h: 4000 },
  "mp16plus.jpg": { w: 4000, h: 4001 },
  "xmp_then_exif6.jpg": { exif: 6, exifAmbiguous: true },             // Chromium: rotated; Firefox: not
  "big_app2.jpg": { exif: null },
  "fixture_app1_exif6_graft.jpg": { exif: 6, exifAmbiguous: true },  // Chromium: not rotated; Firefox: rotated
  "fixture_app1_pad2_exif6.jpg": { exif: 6, exifAmbiguous: false },  // both rotate
  "fixture_app1_pad6_exif6.jpg": { exif: 6, exifAmbiguous: false },
  "app0_then_exif6.jpg": { exif: 6 },
  "fill_bytes.jpg": {},
  "trailing_after_eoi.jpg": { $trailing: 1048576 },
  "no_eoi.jpg": { $eoi: null },
  "trunc_scan50.jpg": { $eoi: null },
  "sof_h0.jpg": { h: 0, $unsup: "zero dimension (DNL)" },
  "garbage_before_marker.jpg": { error: "JPEG_BAD_SEGMENT" },
  "trunc_header100.jpg": { error: "JPEG_TRUNCATED" },
  "bad_soi.jpg": { error: "JPEG_SIGNATURE" },
};
for (let o = 1; o <= 8; o++) for (const bo of ["II", "MM"]) expectations[`exif${o}_${bo}.jpg`] = { exif: o, w: 640, h: 480 };
const corpusRows = [];
for (const [f, exp] of Object.entries(expectations)) {
  const p = path.join(CORPUS, f);
  if (!fs.existsSync(p)) { check(f + " present", false, "run make_corpus.sh"); continue; }
  const bytes = new Uint8Array(fs.readFileSync(p));
  let info = null, code = null;
  try { info = J.inspect(bytes); } catch (e) { code = e.code || "UNCODED"; }
  if (exp.error) { check(`${f} -> ${exp.error}`, code === exp.error, "got " + code); corpusRows.push([f, bytes.length, code]); continue; }
  if (!info) { check(f + " inspected", false, "threw " + code); continue; }
  let ok = true; const diffs = [];
  const se = J.scanEnd(bytes, info.headerBytes), un = J.unsupported(info);
  const derived = { $unsup: un, $eoi: se.eoi === null ? null : "found", $trailing: se.trailing };
  const want = { $unsup: null, $eoi: "found", $trailing: 0, ...exp };
  for (const [k, v] of Object.entries(want)) { const got = k[0] === "$" ? derived[k] : info[k]; if (got !== v) { ok = false; diffs.push(`${k}=${got} want ${v}`); } }
  // independent reference: ImageMagick identify (skip when IM cannot parse, e.g. h=0)
  if (!("h" in exp && exp.h === 0)) {
    try { const [w, h] = execFileSync("identify", ["-format", "%w %h", p + "[0]"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split(" ").map(Number);
      if (w !== info.w || h !== info.h) { ok = false; diffs.push(`identify ${w}x${h} vs ${info.w}x${info.h}`); } } catch { /* identify failed */ }
  }
  check(`${f} ${info.w}x${info.h} c=${info.components} sof=${info.sof.toString(16)} p=${info.precision} prog=${info.progressive} exif=${info.exif}${info.exifAmbiguous ? "(ambiguous)" : ""} hdr=${info.headerBytes}B eoi=${se.eoi} unsup=${un}`, ok, diffs.join("; "));
  corpusRows.push([f, bytes.length, `${info.w}x${info.h} SOF${(info.sof - 0xc0)} P${info.precision} Nc${info.components} exif=${info.exif}${info.exifAmbiguous ? "?" : ""} hdr=${info.headerBytes} eoi=${se.eoi === null ? "MISSING" : "ok"} trailing=${se.trailing} unsupported=${un}`]);
}
fs.writeFileSync(path.join(__dirname, "corpus_results.json"), JSON.stringify(corpusRows, null, 1));

// ---------------------------------------------------------------- fuzz
const fuzzN = (() => { const i = process.argv.indexOf("--fuzz"); return i > 0 ? +process.argv[i + 1] : 20000; })();
console.log(`\nspike S4b — mutation fuzz (${fuzzN} cases x 4 seeds; contract: return or throw a coded error, never hang/uncoded)`);
{
  let s = 0x9e3779b9; const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  const seeds = ["baseline.jpg", "exif6_II.jpg", "cmyk.jpg", "progressive.jpg"].map((f) => new Uint8Array(fs.readFileSync(path.join(CORPUS, f))).subarray(0, 4096));
  const tally = { ok: 0 }; let uncoded = 0, maxUs = 0, firstUncoded = null;
  for (const seed of seeds) for (let i = 0; i < fuzzN; i++) {
    const b = seed.slice(0, 1 + Math.floor(rnd() * seed.length));
    const k = 1 + Math.floor(rnd() * 4);
    for (let j = 0; j < k; j++) { const pos = Math.floor(rnd() * Math.min(b.length, 400)); b[pos] = rnd() < 0.5 ? Math.floor(rnd() * 256) : [0xff, 0x00, 0xd8, 0xd9, 0xda, 0xc0, 0xe1][Math.floor(rnd() * 7)]; }
    const t0 = process.hrtime.bigint();
    try { J.inspect(b); tally.ok++; } catch (e) { if (CODES.has(e.code)) tally[e.code] = (tally[e.code] || 0) + 1; else { uncoded++; firstUncoded ??= e.message; } }
    const us = Number(process.hrtime.bigint() - t0) / 1000; if (us > maxUs) maxUs = us;
  }
  console.log("   outcome tally:", JSON.stringify(tally), "max single-call us:", maxUs.toFixed(1));
  check("fuzz: no uncoded exceptions", uncoded === 0, firstUncoded || "");
}

console.log("\nspike S4b — scan-data truncation sweep (scanEnd)");
for (const f of ["baseline.jpg", "progressive.jpg", "restart.jpg", "cmyk.jpg"]) {
  const b = new Uint8Array(fs.readFileSync(path.join(CORPUS, f))); const hb = J.inspect(b).headerBytes;
  let cuts = 0, missed = 0;
  for (let k = hb; k < b.length; k += 7) { cuts++; if (J.scanEnd(b.subarray(0, k), hb).eoi !== null) missed++; }
  check(`${f}: all ${cuts} cuts in [headerBytes, len) -> eoi null`, missed === 0, `${missed} missed`);
  check(`${f}: complete file -> eoi at len-2`, J.scanEnd(b, hb).eoi === b.length - 2);
}
{
  let s = 12345; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const b0 = new Uint8Array(fs.readFileSync(path.join(CORPUS, "progressive.jpg"))); let threw = 0;
  for (let i = 0; i < 20000; i++) { const b = b0.slice(); for (let j = 0; j < 4; j++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256); try { J.scanEnd(b, 2); } catch { threw++; } }
  check("scanEnd fuzz 20000 mutations of progressive.jpg: never throws", threw === 0);
}

// ---------------------------------------------------------------- bench
if (process.argv.includes("--bench")) {
  console.log("\nspike S4b — benchmark (Node " + process.version + ")");
  const bench = (label, bytes, iters) => {
    for (let i = 0; i < 1000; i++) J.inspect(bytes);
    const t0 = process.hrtime.bigint(); for (let i = 0; i < iters; i++) J.inspect(bytes);
    const ns = Number(process.hrtime.bigint() - t0) / iters;
    console.log(`   ${label.padEnd(44)} ${String(bytes.length).padStart(10)} B  ${(ns / 1000).toFixed(2).padStart(8)} us/inspect`);
    return ns;
  };
  const big = new Uint8Array(fs.readFileSync(path.join(CORPUS, "big_24mp.jpg")));
  bench("fixture jpegHeader 6000x4000", F.jpegHeader({ w: 6000, h: 4000 }), 200000);
  bench("baseline.jpg 640x480", new Uint8Array(fs.readFileSync(path.join(CORPUS, "baseline.jpg"))), 200000);
  bench("exif6_II.jpg", new Uint8Array(fs.readFileSync(path.join(CORPUS, "exif6_II.jpg"))), 200000);
  bench("big_app2.jpg (60 KB APP2 skipped)", new Uint8Array(fs.readFileSync(path.join(CORPUS, "big_app2.jpg"))), 200000);
  bench("big_24mp.jpg 6000x4000 (55 MB)", big, 200000);
  bench("big_24mp.jpg first 64 KiB slice only", big.subarray(0, 65536), 200000);
  // pathological: 1000 max-length (65535) APP15 segments before SOF (~65 MB of header)
  const segs = [Buffer.from([0xff, 0xd8])]; const app = Buffer.alloc(65537); app[0] = 0xff; app[1] = 0xef; app.writeUInt16BE(65535, 2);
  for (let i = 0; i < 1000; i++) segs.push(app); segs.push(Buffer.from(F.jpegHeader({ w: 10, h: 10 }).subarray(2)));
  bench("pathological 1000 x 64 KiB APPn before SOF", new Uint8Array(Buffer.concat(segs)), 20000);
  const benchScan = (label, bytes, iters) => { const hb = J.inspect(bytes).headerBytes; J.scanEnd(bytes, hb);
    const t0 = process.hrtime.bigint(); for (let i = 0; i < iters; i++) J.scanEnd(bytes, hb);
    const ms = Number(process.hrtime.bigint() - t0) / iters / 1e6;
    console.log(`   scanEnd ${label.padEnd(36)} ${String(bytes.length).padStart(10)} B  ${ms.toFixed(2).padStart(8)} ms  (${(bytes.length / 1048576 / (ms / 1000)).toFixed(0)} MiB/s)`); };
  benchScan("baseline.jpg", new Uint8Array(fs.readFileSync(path.join(CORPUS, "baseline.jpg"))), 2000);
  benchScan("progressive.jpg (10 scans)", new Uint8Array(fs.readFileSync(path.join(CORPUS, "progressive.jpg"))), 2000);
  benchScan("mp16.jpg 16 MP", new Uint8Array(fs.readFileSync(path.join(CORPUS, "mp16.jpg"))), 50);
  benchScan("big_24mp.jpg (55 MB noise, q97)", big, 10);
  benchScan("first 25 MiB of big_24mp (cap-size)", big.subarray(0, 25 * 1048576), 10);
  // end-to-end Node-side cost incl. file read of a 55 MB file vs header-only read
  let t0 = process.hrtime.bigint(); for (let i = 0; i < 5; i++) J.inspect(new Uint8Array(fs.readFileSync(path.join(CORPUS, "big_24mp.jpg"))));
  console.log(`   full readFileSync(55 MB)+inspect                         ${(Number(process.hrtime.bigint() - t0) / 5e6).toFixed(2)} ms`);
  t0 = process.hrtime.bigint(); for (let i = 0; i < 5; i++) { const fd = fs.openSync(path.join(CORPUS, "big_24mp.jpg")); const b = Buffer.alloc(65536); fs.readSync(fd, b, 0, 65536, 0); fs.closeSync(fd); J.inspect(b); }
  console.log(`   64 KiB partial read+inspect                              ${(Number(process.hrtime.bigint() - t0) / 5e6).toFixed(3)} ms`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
