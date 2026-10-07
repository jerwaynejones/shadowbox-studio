/* ============================================================================
 * Shadowbox Studio — util.js
 * ----------------------------------------------------------------------------
 * Small shared helpers used across the pipeline. Every module in this project
 * follows the same pattern: a classic script that attaches one namespace to
 * the global object, so the app runs from file:// with zero build tooling
 * (and the same files can be loaded in Node for the test suite).
 * ==========================================================================*/
(function (global) {
  "use strict";

  const U = {};

  /** Clamp x into [lo, hi]. */
  U.clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  /** Linear interpolation between a and b at t in [0,1]. */
  U.lerp = (a, b, t) => a + (b - a) * t;

  /**
   * Debounce: returns a wrapped fn that fires `ms` after the last call.
   * Used so slider drags don't recompute the pipeline on every pixel.
   */
  U.debounce = function (fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  /** Parse "#rrggbb" to [r,g,b] (0..255). */
  U.hexToRgb = function (hex) {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };

  /** [r,g,b] -> "#rrggbb". */
  U.rgbToHex = function (rgb) {
    return (
      "#" +
      rgb
        .map((c) => Math.round(U.clamp(c, 0, 255)).toString(16).padStart(2, "0"))
        .join("")
    );
  };

  /**
   * Sample a gradient defined by an array of hex stops at t in [0,1].
   * Used to derive N acrylic sheet colors from a small palette definition.
   */
  U.samplePalette = function (stops, t) {
    if (stops.length === 1) return stops[0];
    const x = U.clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(Math.floor(x), stops.length - 2);
    const f = x - i;
    const a = U.hexToRgb(stops[i]);
    const b = U.hexToRgb(stops[i + 1]);
    return U.rgbToHex([U.lerp(a[0], b[0], f), U.lerp(a[1], b[1], f), U.lerp(a[2], b[2], f)]);
  };

  /** Format a number with fixed decimals, trimming trailing zeros. */
  U.fmt = function (x, d = 1) {
    return Number(x.toFixed(d)).toString();
  };

  /** Squared distance between two points [x,y]. */
  U.dist2 = (a, b) => {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return dx * dx + dy * dy;
  };

  /** Polyline length of a closed loop of [x,y] points. */
  U.loopLength = function (pts) {
    let L = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      L += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return L;
  };

  /**
   * Canonical JSON for hashing (NFR-05): keys sorted recursively, undefined
   * object keys dropped. Throws on non-finite numbers, undefined/function
   * values (including array elements) and typed arrays (hash those bytes
   * with SBHash.digest instead).
   */
  U.stableStringify = function (v) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("stableStringify: non-finite number"); return JSON.stringify(v); }
    if (v === undefined || typeof v === "function") throw new Error("stableStringify: undefined/function value");
    if (ArrayBuffer.isView(v)) throw new Error("stableStringify: typed array — hash bytes with SBHash.digest");
    if (Array.isArray(v)) return "[" + v.map(U.stableStringify).join(",") + "]";
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + U.stableStringify(v[k])).join(",") + "}";
  };

  // ---- CRC-32 (poly 0xEDB88320), table-driven ------------------------------
  // Moved here from zip.js in S4 so that zip.js and png.js share one table.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  /** Running CRC-32 over bytes[start, end): start with c = 0xffffffff, xor with 0xffffffff to finish. */
  U.crc32Update = function (c, bytes, start = 0, end = bytes.length) {
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return c >>> 0;
  };

  /** CRC-32 (ZIP/PNG) of bytes[start, end) without copying the slice. */
  U.crc32 = function (bytes, start = 0, end = bytes.length) {
    return (U.crc32Update(0xffffffff, bytes, start, end) ^ 0xffffffff) >>> 0;
  };

  global.SBUtil = U;
})(typeof window !== "undefined" ? window : globalThis);
