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
 * Strategy: cache-first for the known app shell. Everything the app needs is
 * local and versioned, so serving from cache is both correct and instant, and
 * the app keeps working with no network at all. Requests we don't recognize
 * fall through to the network.
 * ==========================================================================*/
"use strict";

// Keep this string in sync with APP_VERSION in js/app.js on every release.
const VERSION = "2.0.0-alpha.1";
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
  "./js/svgout.js",
  "./js/svgread.js",
  "./js/zip.js",
  "./js/engine.js",
  "./js/preview.js",
  "./js/app.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  // Take over as soon as installed rather than waiting for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll fails the whole install if any file 404s, which is what we want:
      // a partial precache would strand the app offline in a broken state.
      cache.addAll(SHELL)
    )
  );
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
