// Builds Exif / structural-edge-case variants of corpus/baseline.jpg.
// Usage: node inject_exif.js <corpusDir>
"use strict";
const fs = require("fs"), path = require("path");
const D = process.argv[2];
const base = fs.readFileSync(path.join(D, "baseline.jpg"));
const seg = (m, body) => { const b = Buffer.alloc(4 + body.length); b[0] = 0xff; b[1] = m; b.writeUInt16BE(body.length + 2, 2); body.copy(b, 4); return b; };
// TIFF with IFD0 = [ImageWidth(0x100), Make(0x10f, ASCII via offset), Orientation(0x112), XResolution...]; orientation is NOT first.
function exifApp1(orient, le) {
  const t = Buffer.alloc(8 + 2 + 12 * 3 + 4 + 8);
  const w16 = (v, o) => (le ? t.writeUInt16LE(v, o) : t.writeUInt16BE(v, o));
  const w32 = (v, o) => (le ? t.writeUInt32LE(v, o) : t.writeUInt32BE(v, o));
  t.write(le ? "II" : "MM", 0, "latin1"); w16(42, 2); w32(8, 4);
  w16(3, 8);
  let e = 10;
  w16(0x0100, e); w16(4, e + 2); w32(1, e + 4); w32(640, e + 8); e += 12;               // ImageWidth LONG
  w16(0x010f, e); w16(2, e + 2); w32(8, e + 4); w32(8 + 2 + 36 + 4, e + 8); e += 12;   // Make ASCII -> offset
  w16(0x0112, e); w16(3, e + 2); w32(1, e + 4); w16(orient, e + 8); e += 12;            // Orientation SHORT
  w32(0, e); t.write("SpikeCam", e + 4, "latin1");
  return seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]));
}
const insertAfterSOI = (...segs) => Buffer.concat([base.subarray(0, 2), ...segs, base.subarray(2)]);
for (let o = 1; o <= 8; o++) for (const le of [true, false])
  fs.writeFileSync(path.join(D, `exif${o}_${le ? "II" : "MM"}.jpg`), insertAfterSOI(exifApp1(o, le)));
// XMP APP1 first, then Exif APP1: orientation must still be found
fs.writeFileSync(path.join(D, "xmp_then_exif6.jpg"),
  insertAfterSOI(seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>", "latin1")), exifApp1(6, true)));
// Large ICC-like APP2 (60 KB) before SOF
fs.writeFileSync(path.join(D, "big_app2.jpg"), insertAfterSOI(seg(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0\x01\x01", "latin1"), Buffer.alloc(60000, 7)]))));
// Fill bytes FF FF FF before a marker (legal)
fs.writeFileSync(path.join(D, "fill_bytes.jpg"), Buffer.concat([base.subarray(0, 2), Buffer.from([0xff, 0xff, 0xff]), base.subarray(2)]));
// 3 garbage bytes between segments (illegal; libjpeg warns "extraneous bytes" and continues)
fs.writeFileSync(path.join(D, "garbage_before_marker.jpg"), Buffer.concat([base.subarray(0, 2), Buffer.from([1, 2, 3]), base.subarray(2)]));
// Trailing payload after EOI (Motion-Photo style: 1 MB appended)
fs.writeFileSync(path.join(D, "trailing_after_eoi.jpg"), Buffer.concat([base, Buffer.alloc(1 << 20, 0x42)]));
// Truncated in scan data (keep 50%) and inside the header (keep 100 bytes)
fs.writeFileSync(path.join(D, "trunc_scan50.jpg"), base.subarray(0, base.length >> 1));
fs.writeFileSync(path.join(D, "trunc_header100.jpg"), base.subarray(0, 100));
// Missing EOI only
fs.writeFileSync(path.join(D, "no_eoi.jpg"), base.subarray(0, base.length - 2));
// Height 0 in SOF (DNL style)
{ const b = Buffer.from(base); const i = b.indexOf(Buffer.from([0xff, 0xc0])); b.writeUInt16BE(0, i + 5); fs.writeFileSync(path.join(D, "sof_h0.jpg"), b); }
// Bad SOI
{ const b = Buffer.from(base); b[1] = 0xd9; fs.writeFileSync(path.join(D, "bad_soi.jpg"), b); }
console.log("inject_exif: wrote variants");
// The T0.3 fixture's APP1 (2 bytes short of a full IFD entry, no next-IFD
// pointer) grafted onto a real image, to see whether browsers honour it.
{
  const F = require(path.join(__dirname, "..", "..", "test", "fixtures.js"));
  const fx = Buffer.from(F.jpegHeader({ w: 8, h: 8, exif: 6 }));
  const app1 = fx.subarray(2, 2 + 4 + fx.readUInt16BE(4) - 2);
  fs.writeFileSync(path.join(D, "fixture_app1_exif6_graft.jpg"), insertAfterSOI(app1));
}
// Same fixture APP1 but padded to a complete 12-byte IFD entry (no next-IFD
// pointer), and padded to a complete entry + next-IFD pointer.
{
  const mk = (pad) => { const t = Buffer.alloc(26 + pad); const fx = Buffer.from(require(path.join(__dirname, "..", "..", "test", "fixtures.js")).jpegHeader({ w: 8, h: 8, exif: 6 }));
    fx.copy(t, 0, 6, 6 + 26); return seg(0xe1, t); };
  fs.writeFileSync(path.join(D, "fixture_app1_pad2_exif6.jpg"), insertAfterSOI(mk(2)));
  fs.writeFileSync(path.join(D, "fixture_app1_pad6_exif6.jpg"), insertAfterSOI(mk(6)));
  // Exif APP1 placed after the JFIF APP0 (common camera/editor layout)
  const app0len = base.readUInt16BE(4);
  fs.writeFileSync(path.join(D, "app0_then_exif6.jpg"), Buffer.concat([base.subarray(0, 4 + app0len), exifApp1(6, false), base.subarray(4 + app0len)]));
}
