/* ============================================================================
 * spikes/S4/util_crc32.js — SPIKE SHIM, not shipped.
 * ----------------------------------------------------------------------------
 * Emulates the S4 change "move CRC-32 from zip.js into util.js as
 * SBUtil.crc32" without editing shared sources (other spikes run
 * concurrently). The body is byte-for-byte the algorithm in js/zip.js:20-34
 * (table form, polynomial 0xEDB88320). When S4 lands for real this function
 * moves into js/util.js and zip.js calls SBUtil.crc32 at call time.
 *
 * Also exposes an incremental form (crc32Update) which png.js uses to CRC a
 * chunk's type+data without copying them into one buffer.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const U = global.SBUtil || (global.SBUtil = {});
  const T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  /** Running CRC: pass c = 0xffffffff to start, xor with 0xffffffff to finish. */
  U.crc32Update = function (c, bytes, start = 0, end = bytes.length) {
    for (let i = start; i < end; i++) c = T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return c >>> 0;
  };
  U.crc32 = function (bytes, start = 0, end = bytes.length) {
    return (U.crc32Update(0xffffffff, bytes, start, end) ^ 0xffffffff) >>> 0;
  };
})(typeof window !== "undefined" ? window : globalThis);
