/* spikes/S4/run_tests.js — the plan's S4 suite (verbatim) + extended spike checks.
 *   node spikes/S4/run_tests.js            (with SBPng loaded)
 *   node spikes/S4/run_tests.js --red      (Step 2: SBPng absent → must fail)
 */
"use strict";
const RED = process.argv.includes("--red");
if (!RED) require("./load.js");
else { globalThis.crypto ??= require("crypto").webcrypto; globalThis.SBPng = undefined; }
let pass = 0, fail = 0; const pending = [];
function check(name, cond) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.error("  ✗ " + name); } }
function checkAsync(name, p) { pending.push(Promise.resolve(p).then((v) => check(name, !!v), (e) => check(name + " (threw " + e.message + ")", false))); }
function safe(name, fn) { try { fn(); } catch (e) { check(name + " (threw " + e.message + ")", false); } }
function suite(name, fn) { console.log("\n" + name); try { fn(); } catch (e) { check("suite body threw: " + e.message, false); } }

// ---------------------------------------------------------------- plan §6 Task S4 Step 1, verbatim
suite("png.js — raw decode and inspection (IMG-01/02/05/07, AT-02/22)", () => {
  const F = require("../../test/fixtures.js");
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

// ---------------------------------------------------------------- extended spike checks
if (!RED) suite("spike S4 — extended (interlace, palette, alpha, zlib edge cases, hashing)", () => {
  const F = require("../../test/fixtures.js"), E = require("./enc.js");
  const rng = F.lcg(7), W = 37, H = 23, N = W * H;
  const gray = Uint8Array.from({ length: N }, () => (rng() * 256) | 0);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const rej = (bytes, code, mode = "height") => SBPng.decode(bytes, { mode }).then(() => false, (e) => e.code === code || console.error("    got", e.code));
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
  checkAsync("1-bit gray rejected in height (PNG_BITDEPTH, proposed code)", rej(E.encode({ w: 9, h: 2, colorType: 0, bitDepth: 1, data: Array(18).fill(1) }), "PNG_BITDEPTH"));
  checkAsync("opt-in lowBitDepth:'scale' maps 2-bit gray 0..3 → 0,85,170,255 exactly",
    SBPng.decode(E.encode({ w: 4, h: 1, colorType: 0, bitDepth: 2, data: [0, 1, 2, 3] }), { mode: "height", lowBitDepth: "scale" })
      .then((r) => r.samples.join() === "0,85,170,255" && r.policy === "raw-gray2-scaled8"));
  checkAsync("16-bit RGBA rejected in tonal decode too", rej(E.encode({ w: 1, h: 1, colorType: 6, bitDepth: 16, data: [0, 0, 0, 0, 0, 0, 0, 0] }), "PNG_16BIT", "tonal"));
  checkAsync("IDAT split into 1-byte chunks decodes exactly", ok(E.encode({ w: W, h: H, colorType: 0, data: gray, idatSplit: 1 }), (r) => same(r.samples, gray)));
  checkAsync("tRNS key on gray → binary alpha", ok(E.encode({ w: 3, h: 1, colorType: 0, data: [5, 6, 5], trns: [0, 5] }), (r) => r.alpha.join() === "0,255,0"));
  checkAsync("corrupt Adler-32 with valid chunk CRC → PNG_INFLATE", rej(E.encode({ w: W, h: H, colorType: 0, data: gray, corruptAdler: true }), "PNG_INFLATE"));
  checkAsync("trailing junk after zlib stream → PNG_INFLATE", rej(E.encode({ w: W, h: H, colorType: 0, data: gray, trailing: 4 }), "PNG_INFLATE"));
  checkAsync("short image data (IHDR claims more rows) → PNG_TRUNCATED", (() => { const p = E.encode({ w: 5, h: 2, colorType: 0, data: Array(10).fill(9) });
    p[20 + 3] = 3; const c = F.crc32(p.subarray(12, 29)); new DataView(p.buffer).setUint32(29, c); return rej(p, "PNG_TRUNCATED"); })());
  checkAsync("FUZZ REGRESSION: IHDR 2^31-1 x 2^31-1 → PNG_TOO_LARGE, no process abort", (() => { const p = E.encode({ w: 1, h: 1, colorType: 0, data: [1] });
    const dv = new DataView(p.buffer); dv.setUint32(16, 0x7fffffff); dv.setUint32(20, 0x7fffffff); dv.setUint32(29, F.crc32(p.subarray(12, 29))); return rej(p, "PNG_TOO_LARGE"); })());
  checkAsync("bad signature → PNG_SIGNATURE", rej(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), "PNG_SIGNATURE"));
  checkAsync("truncated mid-IDAT → PNG_TRUNCATED", rej(E.encode({ w: W, h: H, colorType: 0, data: gray }).subarray(0, 60), "PNG_TRUNCATED"));
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
  checkAsync("FINDING: sampleHash ignores dimensions (5x1 vs 1x5 collide)", Promise.all([[5, 1], [1, 5]].map(([w, h]) =>
    SBPng.decode(E.encode({ w, h, colorType: 0, data: [1, 2, 3, 4, 5] }), { mode: "height" }))).then(([a, b]) => a.sampleHash === b.sampleHash));
  check("SBUtil.crc32 reference vector 0xCBF43926 and == SBZip-style table", SBUtil.crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);
});

Promise.all(pending).then(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0; });
