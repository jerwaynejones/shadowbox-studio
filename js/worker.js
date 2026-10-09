/* ============================================================================
 * Shadowbox Studio — js/worker.js
 * ----------------------------------------------------------------------------
 * The coordinator / helper Web Worker (speed round, Appendix F). F10 stub: only
 * WORKER_MODULES, the ordered list of pure modules the worker importScripts()
 * (the same list as test/modules.js NODE_MODULES; the build hygiene test
 * parses it). F11 adds the coord/helper roles, the protocol and the handshake.
 *
 * Not a page script (not in index.html); precached in sw.js SHELL so page and
 * worker always come from the same cache version (R7, F-D3).
 * ==========================================================================*/
"use strict";

// prettier-ignore
const WORKER_MODULES = ["util.js","hash.js","vendor/clipper2.js","geom.js","diag.js","schema.js","png.js","jpeg.js","height.js","raster.js","morph.js","islands.js","trace.js","construct.js","material.js","support.js","strokefont.js","guides.js","svgout.js","svgread.js","proof.js","zip.js","docs.js","engine.js"];
