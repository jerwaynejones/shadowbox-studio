/* ============================================================================
 * Shadowbox Studio — js/pool.js
 * ----------------------------------------------------------------------------
 * SBPool (main thread): spawns the coordinator worker, brokers helper ports,
 * the mode ladder, the watchdog and submit / cancel / setSource. DOM module
 * (loaded before app.js, not in the Node list). F10 stub: an empty, frozen
 * namespace so the page, the build and the service-worker precache already
 * carry the file; F11 fills it in.
 * ==========================================================================*/
"use strict";

(function (global) {
  const P = Object.freeze({});
  global.SBPool = P;
})(typeof window !== "undefined" ? window : globalThis);
