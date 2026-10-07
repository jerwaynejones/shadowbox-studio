// spikes/S4/gen_browser_fixtures.js — serialize the plan's S4 fixtures (+ extended + colour-management probes)
// into out/browser_fixtures.js so the identical bytes are decoded in Chromium.
"use strict";
const fs = require("fs"), path = require("path");
const F = require("../../test/fixtures.js"), E = require("./enc.js");
const g = (opts) => F.pngEncode({ w: 5, h: 1, colorType: 0, bitDepth: 8, data: Uint8Array.from([0, 64, 128, 191, 255]), ...opts });
const RAMP = "0,64,128,191,255";
const exif6 = [0x4d,0x4d,0,42,0,0,0,8,0,1,1,0x12,0,3,0,0,0,1,0,6,0,0];
const p16 = F.pngEncode({ w: 1, h: 1, colorType: 0, bitDepth: 16, data: Uint8Array.from([1, 2]) });
const rng = F.lcg(7), W = 37, H = 23, gray = Uint8Array.from({ length: W * H }, () => (rng() * 256) | 0);
const ramp256 = Uint8Array.from({ length: 256 }, (_, i) => i);
const cases = [
  ["AT-02 raw samples 0,64,128,191,255 exact", g({}), { mode: "height", samples: RAMP }],
  ["AT-02 iCCP/gAMA ignored, samples unchanged", g({ extraChunks: [["gAMA", [0, 0, 0xb1, 0x8f]], ["sRGB", [0]]] }), { mode: "height", samples: RAMP }],
  ["IMG-01 16-bit rejected", p16, { mode: "height", code: "PNG_16BIT" }],
  ["IMG-01 APNG rejected", g({ apng: true }), { mode: "height", code: "PNG_APNG" }],
  ["IMG-01 corrupt CRC rejected", g({ corruptCrc: true }), { mode: "height", code: "PNG_CRC" }],
  ["AT-22 truncated PNG rejected", g({ truncate: 10 }), { mode: "height", code: "PNG_TRUNCATED" }],
  ["IMG-01 unequal RGB rejected in height mode", F.pngEncode({ w: 1, h: 1, colorType: 2, bitDepth: 8, data: Uint8Array.from([10, 20, 30]) }), { mode: "height", code: "PNG_UNEQUAL_RGB" }],
  ...[1, 2, 3, 4].map((f) => ["IMG-01 filter type " + f + " round-trips exactly", g({ filter: f }), { mode: "height", samples: RAMP }]),
  ["IMG-07 inspect reads w/h without inflating", g({}), { inspect: { w: 5, h: 1 } }],
  ["IMG-01 tonal APNG rejected at inspection", g({ apng: true }), { checkTonal: "PNG_APNG" }],
  ["IMG-01 tonal 16-bit rejected at inspection", p16, { checkTonal: "PNG_16BIT" }],
  ["IMG-05 eXIf orientation parsed", g({ extraChunks: [["eXIf", exif6]] }), { inspect: { exif: 6 } }],
  // extended
  ["ext Adam7 + mixed filters 37x23", E.encode({ w: W, h: H, colorType: 0, data: gray, interlace: 1, filter: (y) => y % 5 }), { mode: "height", samples: Array.from(gray).join() }],
  ["ext corrupt Adler-32 → PNG_INFLATE", E.encode({ w: W, h: H, colorType: 0, data: gray, corruptAdler: true }), { mode: "height", code: "PNG_INFLATE" }],
  ["ext trailing zlib junk → PNG_INFLATE", E.encode({ w: W, h: H, colorType: 0, data: gray, trailing: 4 }), { mode: "height", code: "PNG_INFLATE" }],
  // colour-management probes (IMG-02): raw decode must return the encoded ramp; the browser canvas path is reported, not asserted
  ["cm ramp gray8 plain", E.encode({ w: 256, h: 1, colorType: 0, data: ramp256 }), { mode: "height", samples: Array.from(ramp256).join(), canvas: true }],
  ["cm ramp gray8 gAMA=1.0", E.encode({ w: 256, h: 1, colorType: 0, data: ramp256, extraChunks: [["gAMA", [0, 1, 0x86, 0xa0]]] }), { mode: "height", samples: Array.from(ramp256).join(), canvas: true }],
  ["cm ramp gray8 gAMA=0.25", E.encode({ w: 256, h: 1, colorType: 0, data: ramp256, extraChunks: [["gAMA", [0, 0, 0x61, 0xa8]]] }), { mode: "height", samples: Array.from(ramp256).join(), canvas: true }],
  ["cm ramp rgb-eq + iCCP from ImageMagick corpus", null, { file: "out/corpus/g8_iccp.png", mode: "height", canvas: true }],
  // browser-decoder tolerance probes (IMG-01 "reject corrupt in both modes": does the tonal canvas path reject these by itself?)
  ["tol IDAT CRC corrupt", E.encode({ w: W, h: H, colorType: 0, data: gray }).map((v, i, a) => i === a.length - 13 ? v ^ 1 : v), { tolerance: true }],
  ["tol ancillary tEXt CRC corrupt", (() => { const b = E.encode({ w: W, h: H, colorType: 0, data: gray, extraChunks: [["tEXt", [65, 0, 66]]] }); b[33 + 8 + 3] ^= 1; /* first CRC byte of the tEXt chunk at offset 33 */ return b; })(), { tolerance: true }],
  ["tol truncated mid-IDAT", E.encode({ w: W, h: H, colorType: 0, data: gray }).subarray(0, 300), { tolerance: true }],
  ["tol missing IEND", E.encode({ w: W, h: H, colorType: 0, data: gray }).slice(0, -12), { tolerance: true }],
  ["tol APNG (fixture: acTL only, no fcTL — invalid APNG)", g({ apng: true }), { tolerance: true }],
  ["tol APNG (valid 2-frame APNG from ImageMagick)", null, { tolerance: true, file: "out/corpus/anim.png" }],
  ["tol 16-bit gray", E.encode({ w: 2, h: 1, colorType: 0, bitDepth: 16, data: [0x12, 0x34, 0xab, 0xcd] }), { tolerance: true }],
];
const out = cases.map(([name, bytes, exp]) => ({ name, b64: bytes ? Buffer.from(bytes).toString("base64") : null, exp }));
fs.writeFileSync(path.join(__dirname, "out", "browser_fixtures.js"), "window.S4_FIXTURES = " + JSON.stringify(out) + ";\n");
console.log("wrote", out.length, "fixtures");
