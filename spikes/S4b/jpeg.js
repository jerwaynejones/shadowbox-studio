/* ============================================================================
 * Shadowbox Studio — jpeg.js   (SPIKE S4b candidate for js/jpeg.js)
 * ----------------------------------------------------------------------------
 * JPEG header inspection for the IMG-07 preflight (IMG-01/05/07, AT-22).
 * Walks markers from SOI to the first SOFn and parses the APP1 Exif
 * orientation. It NEVER decodes (or even scans) entropy-coded data; decoding
 * is the browser's job (Appendix A #14, decode: "canvas-tonal").
 *
 *   SBJpeg.inspect(bytes) -> {w, h, components, progressive, exif: 1..8|null,
 *                             exifAmbiguous, sof, precision, arithmetic,
 *                             lossless, hierarchical, headerBytes}
 *   SBJpeg.unsupported(info) -> null | reason   variants browsers disagree on
 *   SBJpeg.scanEnd(bytes, from) -> {eoi, trailing, scans}  structural walk
 *                             to EOI (marker skipping + FF-byte search through
 *                             entropy data; no decoding) — detects truncation
 *                             that Firefox would silently paint over.
 *
 * Throws Error with .code:
 *   JPEG_SIGNATURE    no SOI (FF D8) at offset 0
 *   JPEG_TRUNCATED    the data ends inside a marker, a length field or an
 *                     otherwise self-consistent segment before SOF is complete
 *   JPEG_BAD_SEGMENT  a self-inconsistent segment: length < 2, an SOF length
 *                     that does not match 8 + 3*Nc, Nc = 0, a non-marker byte
 *                     where a marker must be, FF00 / a second SOI before SOF
 *   JPEG_NO_SOF       EOI or SOS reached before any SOFn
 *
 * Fields beyond the plan's frozen five (sof, precision, arithmetic, lossless,
 * hierarchical, headerBytes) are free to compute and let SBSchema.preflight
 * reject JPEG variants that browsers cannot decode (12/16-bit, lossless,
 * hierarchical, height 0 / DNL) BEFORE the decode attempt. See
 * docs/spikes/S4b.md.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const J = {};

  function fail(code, msg) { const e = new Error(code + ": " + msg); e.code = code; throw e; }
  const u16be = (b, p) => (b[p] << 8) | b[p + 1];
  const hex2 = (m) => "FF" + m.toString(16).toUpperCase().padStart(2, "0");

  /** SOFn markers: C0..CF except C4 (DHT), C8 (JPG reserved), CC (DAC). */
  const isSOF = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

  /**
   * Orientation from an APP1 payload [start, end) (start = first byte after
   * the length field). Returns 1..8 or null. Malformed Exif yields null rather
   * than a rejection: it never affects pixel bounds, and browsers ignore it.
   */
  function exifOrientation(b, start, end) {
    if (end - start < 14 || b[start] !== 0x45 || b[start + 1] !== 0x78 || b[start + 2] !== 0x69 ||
        b[start + 3] !== 0x66 || b[start + 4] !== 0 || b[start + 5] !== 0) return null; // "Exif\0\0"
    const t = start + 6;
    let le;
    if (b[t] === 0x49 && b[t + 1] === 0x49) le = true;        // "II"
    else if (b[t] === 0x4d && b[t + 1] === 0x4d) le = false;  // "MM"
    else return null;
    const r16 = (p) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
    const r32 = (p) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 0x1000000
                           : b[p] * 0x1000000 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]));
    if (r16(t + 2) !== 42) return null;
    const ifd = t + r32(t + 4);
    if (ifd < t + 8 || ifd + 2 > end) return null;
    const n = r16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + 12 * i;
      if (e + 8 > end) return null;
      if (r16(e) !== 0x0112) continue;
      const type = r16(e + 2), count = r32(e + 4);
      // Only the bytes actually read are required (SHORT: 2, LONG: 4). An entry
      // cut short of 12 bytes is parsed but flagged: measured, Firefox 155
      // applies it and Chromium 152 ignores it (docs/spikes/S4b.md).
      const need = type === 4 ? 12 : 10;
      if (count !== 1 || e + need > end) return null;
      const v = type === 3 ? r16(e + 8) : type === 4 ? r32(e + 8) : 0;
      return v >= 1 && v <= 8 ? { v, shortEntry: e + 12 > end } : null;
    }
    return null;
  }

  J.inspect = function (bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const n = b.length;
    if (n < 2 || b[0] !== 0xff || b[1] !== 0xd8) fail("JPEG_SIGNATURE", "missing SOI");
    let p = 2, exif = null, exifAmbiguous = false, app1 = 0;
    for (;;) {
      if (p >= n) fail("JPEG_TRUNCATED", "data ends before SOF");
      if (b[p] !== 0xff) fail("JPEG_BAD_SEGMENT", "expected a marker at offset " + p);
      while (p < n && b[p] === 0xff) p++;                       // fill bytes (T.81 B.1.1.2)
      if (p >= n) fail("JPEG_TRUNCATED", "data ends inside a marker");
      const m = b[p++];
      if (m === 0x00 || m === 0xd8) fail("JPEG_BAD_SEGMENT", "unexpected " + hex2(m));
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;     // TEM, RSTn: no length
      if (m === 0xd9 || m === 0xda) fail("JPEG_NO_SOF", (m === 0xd9 ? "EOI" : "SOS") + " before SOF");
      if (p + 2 > n) fail("JPEG_TRUNCATED", "data ends inside a length field");
      const L = u16be(b, p);
      if (L < 2) fail("JPEG_BAD_SEGMENT", hex2(m) + " length " + L);
      if (isSOF(m)) {
        if (L < 8) fail("JPEG_BAD_SEGMENT", "SOF length " + L);
        if (p + 8 > n) fail("JPEG_TRUNCATED", "data ends inside SOF");
        const nc = b[p + 7];
        if (nc === 0 || L !== 8 + 3 * nc) fail("JPEG_BAD_SEGMENT", "SOF length " + L + " != 8 + 3*" + nc);
        if (p + L > n) fail("JPEG_TRUNCATED", "data ends inside SOF");
        const k = m & 0x0f;
        return {
          w: u16be(b, p + 5), h: u16be(b, p + 3), components: nc,
          progressive: k === 2 || k === 6 || k === 10 || k === 14,
          exif, exifAmbiguous,
          sof: m, precision: b[p + 2],
          arithmetic: m >= 0xc9,
          lossless: (k & 3) === 3,
          hierarchical: k === 5 || k === 6 || k === 7 || k === 13 || k === 14 || k === 15,
          headerBytes: p + L,
        };
      }
      if (p + L > n) fail("JPEG_TRUNCATED", hex2(m) + " length " + L + " runs past the end of the data");
      if (m === 0xe1) {
        app1++;
        if (exif === null) {
          const o = exifOrientation(b, p + 2, p + L);
          // Firefox 155 reads orientation only from the FIRST APP1; Chromium 152
          // also finds an Exif APP1 that follows an XMP APP1. Flag both cases.
          if (o) { exif = o.v; exifAmbiguous = o.shortEntry || app1 > 1; }
        }
      }
      p += L;
    }
  };

  /**
   * Variants the browser decode path cannot be trusted with, measured in
   * Chromium 152 / Firefox 155 (docs/spikes/S4b.md). Returns a reason or null.
   */
  J.unsupported = function (info) {
    if (info.w === 0 || info.h === 0) return "zero dimension (DNL)";
    if (info.precision !== 8) return info.precision + "-bit precision";
    if (info.arithmetic) return "arithmetic coding";
    if (info.hierarchical) return "hierarchical";
    if (info.lossless) return "lossless";
    if (info.components !== 1 && info.components !== 3 && info.components !== 4) return info.components + " components";
    return null;
  };

  /**
   * Structural walk from `from` (default 2, or inspect().headerBytes) to EOI.
   * Segments are skipped by length; entropy-coded data is skipped by searching
   * for 0xFF and ignoring stuffed FF00 and RSTn. Returns {eoi: offset|null,
   * trailing: bytes after EOI, scans}. Never throws; a structural problem
   * (bad length, data ending early) yields eoi: null.
   */
  J.scanEnd = function (bytes, from) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const n = b.length;
    let p = from || 2, scans = 0;
    for (;;) {
      if (p >= n || b[p] !== 0xff) return { eoi: null, trailing: 0, scans };
      while (p < n && b[p] === 0xff) p++;
      if (p >= n) return { eoi: null, trailing: 0, scans };
      const m = b[p++];
      if (m === 0xd9) return { eoi: p - 2, trailing: n - p, scans };
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
      if (p + 2 > n) return { eoi: null, trailing: 0, scans };
      const L = u16be(b, p);
      if (L < 2 || p + L > n) return { eoi: null, trailing: 0, scans };
      p += L;
      if (m !== 0xda) continue;
      scans++;
      for (;;) {                                   // entropy-coded segment
        const q = b.indexOf(0xff, p);
        if (q < 0 || q + 1 >= n) return { eoi: null, trailing: 0, scans };
        const c = b[q + 1];
        if (c === 0x00 || (c >= 0xd0 && c <= 0xd7)) { p = q + 2; continue; }
        if (c === 0xff) { p = q + 1; continue; }  // fill byte before a marker
        p = q; break;
      }
    }
  };

  J._exifOrientation = exifOrientation; // exposed for spike tests only

  global.SBJpeg = J;
})(typeof window !== "undefined" ? window : globalThis);
