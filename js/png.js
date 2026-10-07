/* ============================================================================
 * Shadowbox Studio — png.js
 * ----------------------------------------------------------------------------
 * Raw, colour-management-free PNG reader (IMG-01/02/05/07). Promoted from
 * spike S4 (docs/spikes/S4.md) with its §6 amendments.
 *
 *   SBPng.inspect(bytes[, {verifyCrc = true}])   headers only, never inflates
 *       → {w, h, bitDepth, colorType, interlace, animated, exif, paletteGray,
 *          hasTRNS, idatBytes, idatCount, chunks}
 *   SBPng.check(info, mode[, {lowBitDepth}])     IMG-01 rules → code | null
 *   await SBPng.decode(bytes, {mode[, verifyCrc][, lowBitDepth][, maxPixels]})
 *       → {w, h, samples, alpha, channels, policy, exif, sampleHash, warnings}
 *
 * policy: "raw-gray8" | "raw-rgb-equal" | "raw-palette-gray8"
 *       | "raw-grayN-scaled8" (N = 1, 2, 4) | "raw-rgb" (tonal only, channels 3).
 * Sub-8-bit gray is accepted in both modes by exact integer scaling
 * 255/(2^N − 1) (×255, ×85, ×17), matching libpng byte for byte. This is the
 * product-owner decision recorded in docs/ARCHITECTURE.md D5;
 * {lowBitDepth: "reject"} restores PNG_BITDEPTH in height mode.
 *
 * sampleHash = await SBHash.digest(samples). It covers the samples only, so it
 * identifies content only together with w and h (5×1 and 1×5 collide).
 *
 * Errors are `Error` with `.code`, one of SBPng.CODES:
 *   PNG_16BIT PNG_APNG PNG_CRC PNG_TRUNCATED PNG_UNEQUAL_RGB PNG_PALETTE
 *   PNG_SIGNATURE, plus (S4) PNG_HEADER (missing/invalid IHDR, chunk order,
 *   filter type, palette index), PNG_INFLATE (zlib stream rejected by the
 *   platform: bad Adler-32, trailing junk), PNG_BITDEPTH (sub-8-bit gray with
 *   lowBitDepth "reject"), PNG_TOO_LARGE (w·h above maxPixels, default
 *   SBPng.MAX_PIXELS = 2^26; checked before any allocation) and
 *   PNG_NO_INFLATE (no DecompressionStream, R8).
 *
 * No colour management: iCCP, gAMA, sRGB, cHRM are ignored by construction.
 * Looks up SBUtil (crc32) and SBHash at call time.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const P = {};
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const OK_DEPTH = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  const MAX_DIM = 0x7fffffff;

  /** Every error code SBPng can throw or return (feeds the G1.0 diagnostic registry). */
  P.CODES = Object.freeze(["PNG_16BIT", "PNG_APNG", "PNG_CRC", "PNG_TRUNCATED", "PNG_UNEQUAL_RGB", "PNG_PALETTE", "PNG_SIGNATURE",
    "PNG_HEADER", "PNG_INFLATE", "PNG_BITDEPTH", "PNG_TOO_LARGE", "PNG_NO_INFLATE"]);
  /** Hard allocation ceiling for decode() in pixels (~67 MP, 4x the IMG-07 desktop envelope). */
  P.MAX_PIXELS = 1 << 26;

  function fail(code, msg) { const e = new Error(code + (msg ? ": " + msg : "")); e.code = code; return e; }
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const typeStr = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  /** EXIF orientation (tag 0x0112) from a TIFF block (eXIf payload). 1..8 or null. */
  P.exifOrientation = function (b, off = 0, end = b.length) {
    if (end - off < 8) return null;
    const le = b[off] === 0x49 && b[off + 1] === 0x49, be = b[off] === 0x4d && b[off + 1] === 0x4d;
    if (!le && !be) return null;
    const r16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    const r32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : u32(b, o));
    if (r16(off + 2) !== 42) return null;
    const ifd = off + r32(off + 4);
    if (ifd + 2 > end) return null;
    const n = r16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + 12 * i;
      if (e + 12 > end) return null;
      if (r16(e) !== 0x0112) continue;
      if (r16(e + 2) !== 3 || r32(e + 4) < 1) return null; // SHORT, count >= 1
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
    return null;
  };

  /**
   * Walk chunks. Never inflates. With verifyCrc (default true) every chunk CRC
   * is checked, which reads every byte once (measured in docs/spikes/S4.md).
   */
  P.inspect = function (bytes, opts = {}) {
    const verifyCrc = opts.verifyCrc !== false;
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const n = b.length;
    if (n < 8) throw fail("PNG_SIGNATURE");
    for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) throw fail("PNG_SIGNATURE");
    const info = { w: 0, h: 0, bitDepth: 0, colorType: 0, interlace: 0, animated: false, exif: null,
      paletteGray: null, hasTRNS: false, idatBytes: 0, idatCount: 0, chunks: [] };
    const idat = [];
    let pos = 8, seenIHDR = false, seenIEND = false, seenIDAT = false, idatEnded = false, plte = null, trns = null;
    const crc32 = verifyCrc ? global.SBUtil.crc32 : null;
    while (pos < n) {
      if (pos + 12 > n) throw fail("PNG_TRUNCATED", "chunk header at " + pos);
      const len = u32(b, pos), type = typeStr(b, pos + 4), d = pos + 8, end = d + len;
      if (len > 0x7fffffff) throw fail("PNG_HEADER", "chunk length " + len);
      if (end + 4 > n) throw fail("PNG_TRUNCATED", type + " needs " + (end + 4 - n) + " more bytes");
      if (verifyCrc && crc32(b, pos + 4, end) !== u32(b, end)) throw fail("PNG_CRC", type + " at " + pos);
      if (!seenIHDR && type !== "IHDR") throw fail("PNG_HEADER", "first chunk is " + type);
      info.chunks.push(type);
      switch (type) {
        case "IHDR": {
          if (seenIHDR || len !== 13) throw fail("PNG_HEADER", "IHDR");
          seenIHDR = true;
          info.w = u32(b, d); info.h = u32(b, d + 4); info.bitDepth = b[d + 8]; info.colorType = b[d + 9]; info.interlace = b[d + 12];
          if (!info.w || !info.h || info.w > MAX_DIM || info.h > MAX_DIM) throw fail("PNG_HEADER", "dimensions");
          if (!OK_DEPTH[info.colorType] || !OK_DEPTH[info.colorType].includes(info.bitDepth)) throw fail("PNG_HEADER", "depth/type");
          if (b[d + 10] !== 0 || b[d + 11] !== 0 || info.interlace > 1) throw fail("PNG_HEADER", "method");
          break;
        }
        case "acTL": info.animated = true; break;
        case "PLTE": {
          if (len % 3 || len === 0) throw fail("PNG_HEADER", "PLTE length");
          plte = b.subarray(d, end);
          let g = true; for (let i = 0; i < len; i += 3) if (plte[i] !== plte[i + 1] || plte[i] !== plte[i + 2]) { g = false; break; }
          if (info.colorType === 3) info.paletteGray = g;
          break;
        }
        case "tRNS": info.hasTRNS = true; trns = b.subarray(d, end); break;
        case "eXIf": { const o = P.exifOrientation(b, d, end); if (o) info.exif = o; break; }
        case "IDAT":
          if (idatEnded) throw fail("PNG_HEADER", "non-consecutive IDAT");
          seenIDAT = true; idat.push([d, end]); info.idatBytes += len; info.idatCount++;
          break;
        case "IEND": seenIEND = true; break;
        default: break; // iCCP, gAMA, sRGB, cHRM, text, fdAT ... deliberately ignored
      }
      if (seenIDAT && type !== "IDAT") idatEnded = true;
      pos = end + 4;
      if (seenIEND) break;
    }
    if (!seenIEND) throw fail("PNG_TRUNCATED", "no IEND");
    if (!info.idatCount) throw fail("PNG_HEADER", "no IDAT");
    if (info.colorType === 3 && !plte) throw fail("PNG_HEADER", "palette image without PLTE");
    // Internal handles for decode(); non-enumerable so inspect output stays JSON-clean.
    Object.defineProperty(info, "_b", { value: b });
    Object.defineProperty(info, "_idat", { value: idat });
    Object.defineProperty(info, "_plte", { value: plte });
    Object.defineProperty(info, "_trns", { value: trns });
    return info;
  };

  /**
   * IMG-01 rules on inspect() output. Both modes reject APNG and 16-bit. Height mode also rejects a
   * colour palette, and sub-8-bit gray only when opts.lowBitDepth === "reject" (default: scale, D5).
   */
  P.check = function (info, mode, opts = {}) {
    if (info.animated) return "PNG_APNG";
    if (info.bitDepth === 16) return "PNG_16BIT";
    if (mode === "height") {
      if (info.colorType === 3) return info.paletteGray ? null : "PNG_PALETTE";
      if (info.bitDepth < 8 && opts.lowBitDepth === "reject") return "PNG_BITDEPTH";
    }
    return null;
  };

  /**
   * Inflate the IDAT stream with the platform DecompressionStream("deflate") (zlib wrapper,
   * Adler-32 verified by the platform). Output is written straight into one preallocated
   * buffer of the size IHDR implies, so peak memory is ~1x the filtered image, not 2x
   * (collect-then-concatenate). Overflow beyond `expect` is counted, not stored.
   */
  async function inflate(chunksOf, b, expect) {
    if (typeof global.DecompressionStream !== "function") throw fail("PNG_NO_INFLATE");
    const ds = new global.DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    const out = new Uint8Array(expect); let total = 0;
    const reading = (async () => {
      const r = ds.readable.getReader();
      for (;;) {
        const { value, done } = await r.read(); if (done) break;
        if (total < expect) out.set(value.length <= expect - total ? value : value.subarray(0, expect - total), total);
        total += value.length;
      }
    })();
    const writing = (async () => { for (const [s, e] of chunksOf) await writer.write(b.subarray(s, e)); await writer.close(); })();
    try { await Promise.all([reading, writing]); }
    catch (e) { const err = fail("PNG_INFLATE", e && e.message); err.partialBytes = total; throw err; }
    return { data: total < expect ? out.subarray(0, total) : out, total };
  }

  /** Bytes of filtered scanline data IHDR implies (all Adam7 passes when interlaced). */
  function expectedBytes(info) {
    const { w, h, bitDepth: bd, colorType: ct, interlace } = info, ch = CH[ct];
    let need = 0;
    for (const [xs, ys, xst, yst] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
      const pw = Math.ceil((w - xs) / xst), ph = Math.ceil((h - ys) / yst);
      if (pw > 0 && ph > 0) need += ph * (1 + Math.ceil((pw * ch * bd) / 8));
    }
    return need;
  }

  // Per-row unfilter kernels. They are separate small functions on purpose: one big
  // function with the row loop outside and the pixel loops inside was repeatedly
  // deoptimized by V8 ("exit from OSR'd inner loop", 49 deopts per 16 MP decode) and
  // ran ~3x slower. Measured in docs/spikes/S4.md §3.
  function rowSub(src, s, dst, o, n, bpp) {
    let i = 0; for (; i < bpp && i < n; i++) dst[o + i] = src[s + i];
    for (; i < n; i++) dst[o + i] = (src[s + i] + dst[o + i - bpp]) & 255;
  }
  function rowUp(src, s, dst, o, p, n) { for (let i = 0; i < n; i++) dst[o + i] = (src[s + i] + dst[p + i]) & 255; }
  function rowAvg(src, s, dst, o, p, n, bpp) {
    let i = 0;
    if (p < 0) { for (; i < bpp && i < n; i++) dst[o + i] = src[s + i]; for (; i < n; i++) dst[o + i] = (src[s + i] + (dst[o + i - bpp] >> 1)) & 255; return; }
    for (; i < bpp && i < n; i++) dst[o + i] = (src[s + i] + (dst[p + i] >> 1)) & 255;
    for (; i < n; i++) dst[o + i] = (src[s + i] + ((dst[o + i - bpp] + dst[p + i]) >> 1)) & 255;
  }
  function rowPaeth(src, s, dst, o, p, n, bpp) {
    if (p < 0) { rowSub(src, s, dst, o, n, bpp); return; } // no previous row: Paeth == Sub
    let i = 0; for (; i < bpp && i < n; i++) dst[o + i] = (src[s + i] + dst[p + i]) & 255; // a = c = 0 → b
    for (; i < n; i++) {
      const a = dst[o + i - bpp], b = dst[p + i], c = dst[p + i - bpp];
      let pa = b - c, pb = a - c, pc = pa + pb;
      if (pa < 0) pa = -pa; if (pb < 0) pb = -pb; if (pc < 0) pc = -pc;
      dst[o + i] = (src[s + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  /** Unfilter one pass (types 0-4) into dst; returns the source offset after the pass. */
  function unfilter(src, off, rowBytes, rows, bpp, dst) {
    let s = off, p = -1;
    for (let y = 0; y < rows; y++) {
      const f = src[s++], o = y * rowBytes;
      if (f === 0 || (f === 2 && p < 0)) dst.set(src.subarray(s, s + rowBytes), o);
      else if (f === 1) rowSub(src, s, dst, o, rowBytes, bpp);
      else if (f === 2) rowUp(src, s, dst, o, p, rowBytes);
      else if (f === 3) rowAvg(src, s, dst, o, p, rowBytes, bpp);
      else if (f === 4) rowPaeth(src, s, dst, o, p, rowBytes, bpp);
      else throw fail("PNG_HEADER", "filter type " + f);
      p = o; s += rowBytes;
    }
    return s;
  }

  /** Unpack a packed row of sub-byte samples to one byte per sample (raw value, unscaled). */
  function unpack(packed, rowBytes, w, rows, depth, out, outW, xs, xstep, ys, ystep) {
    const per = 8 / depth, mask = (1 << depth) - 1;
    for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) {
      const byte = packed[y * rowBytes + ((x / per) | 0)], shift = 8 - depth * ((x % per) + 1);
      out[(ys + y * ystep) * outW + xs + x * xstep] = (byte >> shift) & mask;
    }
  }

  /** Raw decode to a w*h*channels byte raster (palette: indices). */
  function rasterize(info, data) { // data.length >= expectedBytes(info) checked here
    const { w, h, bitDepth: bd, colorType: ct, interlace } = info, ch = CH[ct];
    const bpp = Math.max(1, (ch * bd) >> 3);
    // Non-interlaced: unfilter IN PLACE in the inflated buffer. Row y is written at y*rowBytes
    // while its source starts at y*(rowBytes+1)+1, so every write lands on bytes already read.
    const out = interlace ? new Uint8Array(w * h * ch) : null;
    const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
    let off = 0;
    const need = expectedBytes(info);
    if (data.length < need) throw fail("PNG_TRUNCATED", "inflated " + data.length + " < " + need);
    for (const [xs, ys, xst, yst] of passes) {
      const pw = Math.ceil((w - xs) / xst), ph = Math.ceil((h - ys) / yst);
      if (pw <= 0 || ph <= 0) continue;
      const rowBytes = Math.ceil((pw * ch * bd) / 8);
      if (!interlace) {
        unfilter(data, 0, rowBytes, ph, bpp, data);
        if (bd === 8) return data.subarray(0, w * h * ch);
        const o2 = new Uint8Array(w * h); unpack(data, rowBytes, pw, ph, bd, o2, w, 0, 1, 0, 1); return o2;
      }
      const packed = new Uint8Array(rowBytes * ph);
      off = unfilter(data, off, rowBytes, ph, bpp, packed);
      if (bd < 8) unpack(packed, rowBytes, pw, ph, bd, out, w, xs, xst, ys, yst);
      else for (let y = 0; y < ph; y++) {
        const dRow = (ys + y * yst) * w;
        for (let x = 0; x < pw; x++) {
          const si = y * rowBytes + x * ch, di = (dRow + xs + x * xst) * ch;
          for (let c = 0; c < ch; c++) out[di + c] = packed[si + c];
        }
      }
    }
    return out;
  }

  P.decode = async function (bytes, opts = {}) {
    const mode = opts.mode || "height";
    const info = P.inspect(bytes, opts);
    const code = P.check(info, mode, opts);
    if (code) throw fail(code);
    // Allocation guard. Found by fuzz.js: a garbage IHDR (e.g. 2^31 x 2^31) made `new Uint8Array`
    // abort the whole V8 process ("Check failed: change_in_bytes < kMaxReasonableBytes"), not throw.
    // decode() must never trust IHDR for allocation; IMG-07 preflight is a separate, lower, product limit.
    const maxPixels = opts.maxPixels || P.MAX_PIXELS;
    if (info.w * info.h > maxPixels) throw fail("PNG_TOO_LARGE", info.w + "x" + info.h);
    const expect = expectedBytes(info);
    const { data, total } = await inflate(info._idat, info._b, expect);
    const raster = rasterize(info, data), extra = total - expect;
    const { w, h, colorType: ct } = info, N = w * h, warnings = [];
    if (extra) warnings.push("PNG_EXTRA_IDAT_DATA:" + extra);
    let samples, alpha = null, channels = 1, policy = "raw-gray8";
    const trns = info._trns;
    if (ct === 0) {
      samples = raster;
      if (trns && trns.length >= 2) { const key = (trns[0] << 8) | trns[1]; alpha = new Uint8Array(N); for (let i = 0; i < N; i++) alpha[i] = samples[i] === key ? 0 : 255; }
      if (info.bitDepth < 8) { // D5: exact integer scale 255/(2^d-1) = 255, 85, 17 (alpha above used the raw key)
        const k = 255 / ((1 << info.bitDepth) - 1); for (let i = 0; i < N; i++) samples[i] *= k;
        policy = "raw-gray" + info.bitDepth + "-scaled8";
      }
    } else if (ct === 4) {
      samples = new Uint8Array(N); alpha = new Uint8Array(N);
      for (let i = 0; i < N; i++) { samples[i] = raster[2 * i]; alpha[i] = raster[2 * i + 1]; }
    } else if (ct === 3) {
      const pl = info._plte, nEnt = pl.length / 3;
      samples = new Uint8Array(N);
      let gray = info.paletteGray;
      for (let i = 0; i < N; i++) { const k = raster[i]; if (k >= nEnt) throw fail("PNG_HEADER", "palette index " + k); samples[i] = pl[3 * k]; }
      if (!gray) { // tonal only: expand to RGB
        samples = new Uint8Array(3 * N); channels = 3; policy = "raw-rgb";
        for (let i = 0; i < N; i++) { const k = raster[i]; samples[3 * i] = pl[3 * k]; samples[3 * i + 1] = pl[3 * k + 1]; samples[3 * i + 2] = pl[3 * k + 2]; }
      } else policy = "raw-palette-gray8";
      if (trns) { alpha = new Uint8Array(N); for (let i = 0; i < N; i++) { const k = raster[i]; alpha[i] = k < trns.length ? trns[k] : 255; } }
    } else { // 2 or 6
      const ch = ct === 2 ? 3 : 4;
      let equal = true;
      for (let i = 0, j = 0; i < N; i++, j += ch) if (raster[j] !== raster[j + 1] || raster[j] !== raster[j + 2]) { equal = false; break; }
      if (!equal && mode === "height") throw fail("PNG_UNEQUAL_RGB");
      if (ct === 6 || (trns && trns.length >= 6)) alpha = new Uint8Array(N);
      if (equal) {
        samples = new Uint8Array(N); policy = "raw-rgb-equal";
        for (let i = 0, j = 0; i < N; i++, j += ch) samples[i] = raster[j];
      } else {
        samples = new Uint8Array(3 * N); channels = 3; policy = "raw-rgb";
        for (let i = 0, j = 0; i < N; i++, j += ch) { samples[3 * i] = raster[j]; samples[3 * i + 1] = raster[j + 1]; samples[3 * i + 2] = raster[j + 2]; }
      }
      if (ct === 6) for (let i = 0; i < N; i++) alpha[i] = raster[4 * i + 3];
      else if (alpha) {
        const r = (trns[0] << 8) | trns[1], g = (trns[2] << 8) | trns[3], bl = (trns[4] << 8) | trns[5];
        for (let i = 0; i < N; i++) alpha[i] = raster[3 * i] === r && raster[3 * i + 1] === g && raster[3 * i + 2] === bl ? 0 : 255;
      }
    }
    const sampleHash = await global.SBHash.digest(samples);
    return { w, h, samples, alpha, channels, policy, exif: info.exif, sampleHash, warnings };
  };

  global.SBPng = P;
})(typeof window !== "undefined" ? window : globalThis);
