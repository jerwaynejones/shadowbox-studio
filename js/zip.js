/* ============================================================================
 * Shadowbox Studio — zip.js
 * ----------------------------------------------------------------------------
 * A minimal, dependency-free ZIP writer (STORE method, no compression).
 * SVG exports are small, so compression buys nothing — but bundling every
 * layer + docs into one download matters a lot for workflow. Implementing
 * the format directly keeps the whole app usable offline in the workshop
 * with no CDN and no npm.
 *
 * Format reference: PKWARE APPNOTE — local file headers, central directory,
 * end-of-central-directory record. UTF-8 names (general-purpose bit 11).
 * ==========================================================================*/
(function (global) {
  "use strict";

  const Z = {};

  // ---- CRC-32 (poly 0xEDB88320), table-driven ------------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  Z.crc32 = function (bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++)
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  // ---- DOS date/time encoding ----------------------------------------------
  function dosDateTime(d) {
    const time =
      ((d.getHours() & 31) << 11) |
      ((d.getMinutes() & 63) << 5) |
      ((d.getSeconds() >> 1) & 31);
    const date =
      (((d.getFullYear() - 1980) & 127) << 9) |
      (((d.getMonth() + 1) & 15) << 5) |
      (d.getDate() & 31);
    return { time, date };
  }

  /**
   * Build a ZIP archive.
   * @param {Array<{name: string, data: Uint8Array|string}>} files
   * @returns {Uint8Array} the archive bytes
   */
  Z.build = function (files) {
    const enc = new TextEncoder();
    const now = dosDateTime(new Date());
    const parts = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = enc.encode(file.name);
      const data =
        typeof file.data === "string" ? enc.encode(file.data) : file.data;
      const crc = Z.crc32(data);

      // Local file header (30 bytes) + name + data
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);      // signature
      lh.setUint16(4, 20, true);              // version needed
      lh.setUint16(6, 0x0800, true);          // flags: UTF-8 names
      lh.setUint16(8, 0, true);               // method: store
      lh.setUint16(10, now.time, true);
      lh.setUint16(12, now.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);    // compressed size
      lh.setUint32(22, data.length, true);    // uncompressed size
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);              // extra length
      parts.push(new Uint8Array(lh.buffer), nameBytes, data);

      // Central directory entry (46 bytes) + name
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);              // version made by
      cd.setUint16(6, 20, true);              // version needed
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, now.time, true);
      cd.setUint16(14, now.date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      // 30..37: extra/comment/disk/attrs = 0
      cd.setUint32(42, offset, true);         // local header offset
      central.push(new Uint8Array(cd.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const c of central) cdSize += c.length;

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);     // entries on this disk
    end.setUint16(10, files.length, true);    // entries total
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdStart, true);

    const total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of [...parts, ...central, new Uint8Array(end.buffer)]) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  };

  global.SBZip = Z;
})(typeof window !== "undefined" ? window : globalThis);
