/* ============================================================================
 * Shadowbox Studio — build.js
 * ----------------------------------------------------------------------------
 * Inlines the stylesheet and every script into one self-contained HTML file:
 *
 *     node build.js   →   dist/shadowbox-studio.html
 *
 * The result is a single file you can email, airdrop, or drop on a USB stick
 * and open anywhere — identical behavior to the multi-file source.
 * ==========================================================================*/
"use strict";
const fs = require("fs");
const path = require("path");

const root = __dirname;
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// The single-file bundle is meant to be opened from anywhere (email, USB,
// file://) with no sibling files, so strip the PWA plumbing that only works
// when served with its manifest, icons, and service worker present. The app's
// own service-worker registration already self-disables on file:// URLs.
html = html.replace(
  /[ \t]*<!-- Progressive-web-app metadata[\s\S]*?<link rel="icon" type="image\/svg\+xml" href="icons\/icon.svg">\n/,
  ""
);
html = html.replace(/[ \t]*<link rel="manifest"[^>]*>\n/g, "");
html = html.replace(/[ \t]*<link rel="apple-touch-icon"[^>]*>\n/g, "");
html = html.replace(/[ \t]*<link rel="icon"[^>]*>\n/g, "");

// Inline the stylesheet.
html = html.replace(
  /<link rel="stylesheet" href="css\/style.css">/,
  () => "<style>\n" + fs.readFileSync(path.join(root, "css/style.css"), "utf8") + "\n</style>"
);

// Inline each script in order.
html = html.replace(/<script src="js\/([\w./-]+)"><\/script>/g, (_, name) =>
  "<script>\n" + fs.readFileSync(path.join(root, "js", name), "utf8") + "\n</script>"
);

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", "shadowbox-studio.html");
fs.writeFileSync(out, html);
console.log("built", out, (fs.statSync(out).size / 1024).toFixed(1) + " KB");
