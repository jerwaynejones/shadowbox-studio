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

// Preserve the upstream MIT copyright and permission notice in the bundle
// (NFR-11). It goes in a comment right after the doctype, so it leads the file
// without pushing the doctype off the first line.
const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8").trim();
if (license.includes("--")) throw new Error("LICENSE text cannot be embedded in an HTML comment");
html = html.replace(/^(<!DOCTYPE html>\n)/i, (doctype) => doctype + "<!--\n" + license + "\n-->\n");
if (!html.includes(license)) throw new Error("failed to embed LICENSE notice in the bundle");

// Third-party licences (NFR-11): the bundle carries vendored libraries as source text, so each
// js/vendor/LICENSE-<lib>.txt is embedded verbatim in its own comment right after the MIT notice.
const vendorDir = path.join(root, "js", "vendor");
const vendorLicenses = fs.existsSync(vendorDir)
  ? fs.readdirSync(vendorDir).filter((f) => /^LICENSE-.*\.txt$/.test(f)).sort()
  : [];
let thirdParty = "";
for (const f of vendorLicenses) {
  const text = fs.readFileSync(path.join(vendorDir, f), "utf8").trim();
  if (text.includes("--")) throw new Error(f + " cannot be embedded in an HTML comment");
  thirdParty += "<!--\nThird-party component licence (js/vendor/" + f + "):\n\n" + text + "\n-->\n";
}
html = html.replace("\n" + license + "\n-->\n", (m) => m + thirdParty);
for (const f of vendorLicenses)
  if (!html.includes(fs.readFileSync(path.join(vendorDir, f), "utf8").trim())) throw new Error("failed to embed " + f);

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", "shadowbox-studio.html");
fs.writeFileSync(out, html);
console.log("built", out, (fs.statSync(out).size / 1024).toFixed(1) + " KB");
