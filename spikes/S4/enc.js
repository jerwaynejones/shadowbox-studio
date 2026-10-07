// spikes/S4/enc.js — independent PNG encoder for spike fixtures the shared test/fixtures.js pngEncode cannot make:
// Adam7 interlace, sub-byte depths, palette + tRNS, split IDAT, mixed per-row filters, corrupt zlib.
"use strict";
const zlib = require("zlib");
const F = require("../../test/fixtures.js");
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, "latin1");
  Buffer.from(data).copy(b, 8); b.writeUInt32BE(F.crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b;
}
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
function filt(f, cur, prev, bpp) { const o = Buffer.alloc(cur.length);
  for (let i = 0; i < cur.length; i++) { const a = i >= bpp ? cur[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
    o[i] = (cur[i] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 0xff; } return o; }
function pack(vals, depth) { const per = 8 / depth, out = Buffer.alloc(Math.ceil(vals.length / per));
  vals.forEach((v, x) => { out[(x / per) | 0] |= v << (8 - depth * ((x % per) + 1)); }); return out; }
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
/** data: one value per channel per pixel (unpacked), length w*h*ch. filter: number or (y)=>number. */
function encode({ w, h, colorType, bitDepth = 8, data, interlace = 0, filter = 0, plte, trns, idatSplit = 0, extraChunks = [],
  trailing = 0, corruptAdler = false, level = 6 }) {
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType], bpp = Math.max(1, (ch * bitDepth) >> 3);
  const rows = []; let rowNo = 0;
  for (const [xs, ys, xst, yst] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((w - xs) / xst), ph = Math.ceil((h - ys) / yst); if (pw <= 0 || ph <= 0) continue;
    let prev = null;
    for (let y = 0; y < ph; y++) {
      const vals = []; for (let x = 0; x < pw; x++) for (let c = 0; c < ch; c++) vals.push(data[((ys + y * yst) * w + xs + x * xst) * ch + c]);
      const cur = bitDepth === 8 ? Buffer.from(vals) : pack(vals, bitDepth);
      const f = typeof filter === "function" ? filter(rowNo++) : filter;
      rows.push(Buffer.from([f]), filt(f, cur, prev, bpp)); prev = cur;
    }
  }
  let z = zlib.deflateSync(Buffer.concat(rows), { level });
  if (corruptAdler) { z = Buffer.from(z); z[z.length - 1] ^= 0xff; }
  if (trailing) z = Buffer.concat([z, Buffer.alloc(trailing, 7)]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[12] = interlace;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  for (const [t, d] of extraChunks) parts.push(chunk(t, Buffer.from(d)));
  if (plte) parts.push(chunk("PLTE", Buffer.from(plte)));
  if (trns) parts.push(chunk("tRNS", Buffer.from(trns)));
  if (idatSplit) for (let i = 0; i < z.length; i += idatSplit) parts.push(chunk("IDAT", z.subarray(i, i + idatSplit)));
  else parts.push(chunk("IDAT", z));
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}
module.exports = { encode, chunk };
