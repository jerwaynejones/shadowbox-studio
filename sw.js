/* ============================================================================
 * Shadowbox Studio — sw.js
 * ----------------------------------------------------------------------------
 * Offline-first service worker.
 *
 * The cache name carries the release version. Bumping it (in lockstep with
 * APP_VERSION in js/app.js) is what ships an update: the new worker precaches
 * the fresh shell under a new cache key and deletes the old caches on
 * activate, so returning users move cleanly onto the new build.
 *
 * Updates are user-gated (DEP-02): a new worker installs its cache and waits;
 * it activates only when the page posts {type: "skipWaiting"} on the user's
 * request, then the page reloads onto the new version.
 *
 * Strategy: cache-first for the known app shell. Everything the app needs is
 * local and versioned, so serving from cache is both correct and instant, and
 * the app keeps working with no network at all. Requests we don't recognize
 * fall through to the network.
 * ==========================================================================*/
"use strict";

// Keep this string in sync with APP_VERSION in js/app.js on every release.
const VERSION = "2.0.0-alpha.5";
const CACHE = "shadowbox-studio-v" + VERSION;

// The complete app shell. Relative paths keep the app working from a project
// subpath on GitHub Pages (e.g. /shadowbox-studio/).
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/util.js",
  "./js/hash.js",
  "./js/vendor/clipper2.js",
  "./js/geom.js",
  "./js/diag.js",
  "./js/schema.js",
  "./js/png.js",
  "./js/jpeg.js",
  "./js/height.js",
  "./js/raster.js",
  "./js/morph.js",
  "./js/islands.js",
  "./js/trace.js",
  "./js/construct.js",
  "./js/material.js",
  "./js/support.js",
  "./js/strokefont.js",
  "./js/guides.js",
  "./js/svgout.js",
  "./js/svgread.js",
  "./js/proof.js",
  "./js/zip.js",
  "./js/docs.js",
  "./js/engine.js",
  "./js/pool.js",
  "./js/preview.js",
  "./js/app.js",
  // The engine worker (speed round F10/F11) is not a page script; it is precached with the shell so the page and the
  // worker always come from this one cache version (R7). Its URL carries no ?v= (caches.match is exact).
  "./js/worker.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  // DEP-02 (G4.0 minimal, F-D3): no skipWaiting here. A new version waits until the page asks for it (the "message"
  // handler below), which the page does only on the user's click and never while there is unsaved work or an export
  // or fabrication run in flight, so an update never interrupts a project or mixes engine assets from two releases.
  // The very first install has no previous worker to wait for and activates at once.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll fails the whole install if any file 404s, which is what we want:
      // a partial precache would strand the app offline in a broken state.
      cache.addAll(SHELL)
    )
  );
});

// DEP-02: the page's "Update available — reload" action posts {type: "skipWaiting"} to the waiting worker.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skipWaiting") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("shadowbox-studio-v") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GETs; let everything else hit the network directly.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cache successful same-origin responses so first-seen assets become
          // available offline on subsequent launches.
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline and uncached: for navigations, fall back to the shell so
          // the app still opens.
          if (req.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        });
    })
  );
});
