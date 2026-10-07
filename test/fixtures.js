"use strict";
const zlib = require("zlib");
function art(rows) {
  const h = rows.length, w = rows[0].length, m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = rows[y][x] === "#" ? 1 : 0;
  return { m, w, h };
}
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function ramp(w, h) { const a = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.round((255 * x) / (w - 1)); return a; }
function flat(w, h, v) { return new Uint8Array(w * h).fill(v); }
function stack(...grids) { const g = grids.map(art); return { w: g[0].w, h: g[0].h, layers: g.map((x) => x.m) }; }
const FULL = (w, h) => Array.from({ length: h }, () => "#".repeat(w));
const pad = (rows) => [".".repeat(rows[0].length + 2), ...rows.map((r) => "." + r + "."), ".".repeat(rows[0].length + 2)];
const CRESC = ["..####...", ".##......", "##.......", "##.......", "##.......", ".##......", "..####..."];
const LOOSE = ["##########", "#........#", "#..##....#", "#........#", "##########"];
const MASKS = {
  donutIsland: stack(FULL(9, 9), [".........", ".#######.", ".#.....#.", ".#.....#.", ".#..#..#.", ".#.....#.", ".#.....#.", ".#######.", "........."]),
  crescent: stack(FULL(9, 7), CRESC),
  crescentInterior: stack(FULL(11, 9), pad(CRESC)),
  borderTouch: stack(FULL(8, 5), ["#####...", "#####...", "........", "........", "........"]),
  lowerHoleUnderPart: stack(FULL(7, 7), ["#######", "#######", "##...##", "##...##", "##...##", "#######", "#######"], [".......", ".......", ".......", "...#...", ".......", ".......", "......."]),
  emptyIntermediate: stack(FULL(5, 5), [".....", ".....", ".....", ".....", "....."], [".....", ".###.", ".###.", ".###.", "....."]),
  orientationF: stack(FULL(7, 7), ["#####..", "#......", "####...", "#......", "#......", "#......", "......."]),
  diagonalTouch: stack(FULL(6, 6), ["###...", "###...", "###...", "...###", "...###", "...###"]),
  looseBridge: stack(FULL(10, 5), LOOSE, LOOSE),
};
MASKS.narrowBridge = (px) => { const rows = ["#####" + ".".repeat(5) + "#####"]; for (let i = 0; i < 4; i++) rows.push("#####" + ".".repeat(5) + "#####");
  for (let i = 0; i < px; i++) rows[1 + i] = "#".repeat(15); return stack(FULL(15, 5), rows); };
function randomNestedStack(rng, w, h, N) {
  const out = [new Uint8Array(w * h).fill(1)];
  for (let k = 1; k < N; k++) { const m = new Uint8Array(w * h);
    for (let b = 0; b < 3; b++) { const cx = rng() * w, cy = rng() * h, r = 1 + rng() * Math.min(w, h) / 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1; }
    for (let i = 0; i < m.length; i++) m[i] &= out[k - 1][i]; out.push(m); }
  return out;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data, corrupt) { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, "latin1");
  Buffer.from(data).copy(b, 8); b.writeUInt32BE((crc32(b.subarray(4, 8 + data.length)) ^ (corrupt ? 1 : 0)) >>> 0, 8 + data.length); return b; }
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
function filterRow(f, cur, prev, bpp) { const o = Buffer.alloc(cur.length);
  for (let i = 0; i < cur.length; i++) { const a = i >= bpp ? cur[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
    o[i] = (cur[i] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 0xff; } return o; }
function pngEncode({ w, h, colorType, bitDepth, data, extraChunks = [], corruptCrc = false, apng = false, filter = 0, truncate = 0 }) {
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType], bpp = Math.max(1, ch * (bitDepth / 8)), stride = w * ch * (bitDepth / 8);
  const raw = Buffer.alloc((stride + 1) * h); let prev = null;
  for (let y = 0; y < h; y++) { const cur = Buffer.from(data.buffer, data.byteOffset + y * stride, stride);
    raw[y * (stride + 1)] = filter; filterRow(filter, cur, prev, bpp).copy(raw, y * (stride + 1) + 1); prev = cur; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bitDepth; ihdr[9] = colorType;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (apng) parts.push(chunk("acTL", Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])));
  for (const [t, d] of extraChunks) parts.push(chunk(t, Buffer.from(d)));
  parts.push(chunk("IDAT", zlib.deflateSync(raw), corruptCrc), chunk("IEND", Buffer.alloc(0)));
  const out = Buffer.concat(parts); return new Uint8Array(truncate ? out.subarray(0, out.length - truncate) : out);
}
function jpegHeader({ w, h, exif = 0, truncate = 0, sofLen = 17 }) {
  const seg = (m, body) => { const b = Buffer.alloc(4 + body.length); b[0] = 0xff; b[1] = m; b.writeUInt16BE(body.length + 2, 2); Buffer.from(body).copy(b, 4); return b; };
  const parts = [Buffer.from([0xff, 0xd8])];
  if (exif) { const t = Buffer.alloc(26); t.write("Exif\0\0", 0, "latin1"); t.write("MM", 6, "latin1"); t.writeUInt16BE(42, 8); t.writeUInt32BE(8, 10);
    t.writeUInt16BE(1, 14); t.writeUInt16BE(0x0112, 16); t.writeUInt16BE(3, 18); t.writeUInt32BE(1, 20); t.writeUInt16BE(exif, 24); parts.push(seg(0xe1, t)); }
  const sof = Buffer.alloc(sofLen - 2); sof[0] = 8; sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3); sof[5] = 3;
  parts.push(seg(0xc0, sof), Buffer.from([0xff, 0xd9]));
  const out = Buffer.concat(parts); return new Uint8Array(truncate ? out.subarray(0, out.length - truncate) : out);
}
module.exports = { art, lcg, ramp, flat, MASKS, randomNestedStack, pngEncode, jpegHeader, crc32 };
