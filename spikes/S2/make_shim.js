// spikes/S2/make_shim.js — wraps vendored Clipper2 JS-port ESM bundles as classic-script IIFEs
// (in-repo shim; no npm, no bundler). Tarballs were fetched from registry.npmjs.org and are
// verified here against the registry's published sha512 integrity before extraction.
//   clipper2-ts 2.0.1-18 (countertype, BSL-1.0)  dist/clipper2.min.mjs  -> vendor/clipper2-ts.iife.js  (global Clipper2TS)
//   clipper2-js 1.2.4    (IRobot1,    BSL-1.0)  fesm2020/clipper2-js.mjs -> vendor/clipper2.iife.js (global Clipper2) — rejected, kept for the record
// Usage: node spikes/S2/make_shim.js
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib"), crypto = require("crypto");
const dir = path.join(__dirname, "vendor");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
function untar(tgzName, sha512, member) {
  const tgz = fs.readFileSync(path.join(dir, tgzName));
  if (crypto.createHash("sha512").update(tgz).digest("base64") !== sha512) throw new Error(tgzName + ": integrity mismatch");
  const tar = zlib.gunzipSync(tgz);
  for (let o = 0; o + 512 <= tar.length;) {
    const name = tar.subarray(o, o + 100).toString("latin1").replace(/\0.*$/s, "");
    const size = parseInt(tar.subarray(o + 124, o + 136).toString("latin1").replace(/\0.*$/s, "").trim() || "0", 8);
    if (!name) break;
    if (name === member) return tar.subarray(o + 512, o + 512 + size).toString("utf8");
    o += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(member + " not found");
}
function wrap(src, globalName, header) {
  const m = src.match(/export\s*\{([^}]*)\};?\s*(\/\/# sourceMappingURL=.*)?\s*$/);
  if (!m || /(^|[;}\s])import\s*[{*"'\w]/.test(src.slice(0, 200))) throw new Error("unexpected module shape");
  const pairs = m[1].split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [a, b] = s.split(/\s+as\s+/); return JSON.stringify(b || a) + ": " + a; });
  const body = src.slice(0, m.index);
  return header + "\n(function (global) {\n\"use strict\";\n" + body + "\n;global." + globalName + " = { " + pairs.join(", ") + " };\n})(typeof self !== \"undefined\" ? self : globalThis);\n";
}
for (const [tgz, sha512, member, out, g] of [
  ["clipper2-ts-2.0.1-18.tgz", "WuRO1ZHzyYTVHY78r4wVWVydvQ+1lx9qZ+DeZa/8zhvrxIgCVzElJ6lwSMGtUUKFPefhvfJsHZ5C9RNkgisCOQ==", "package/dist/clipper2.min.mjs", "clipper2-ts.iife.js", "Clipper2TS"],
  ["clipper2-js-1.2.4.tgz", "xD6ETXBuFYRI0IDWfSbkmMYB+M+nPoZQVVLi1GGlVhUVKV8rC//YYP6YHJX0ciyPsWYUCMxcv1QaIGLfnQo18Q==", "package/fesm2020/clipper2-js.mjs", "clipper2.iife.js", "Clipper2"],
]) {
  const src = untar(tgz, sha512, member);
  const code = wrap(src, g, "/* " + tgz.replace(/\.tgz$/, "") + " (BSL-1.0) — " + member + " wrapped as IIFE (global " + g + ") by spikes/S2/make_shim.js */");
  fs.writeFileSync(path.join(dir, out), code);
  console.log(out, code.length, "bytes; sha256", sha256(code), "| source", member, "sha256", sha256(src));
}
