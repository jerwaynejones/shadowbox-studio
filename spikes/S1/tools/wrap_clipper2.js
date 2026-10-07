// spikes/S1/tools/wrap_clipper2.js — deterministic shim: turns the published ESM bundle
// (clipper2-ts dist/clipper2.min.mjs) into a classic-script IIFE that sets global.Clipper2.
// Usage: node spikes/S1/tools/wrap_clipper2.js <in.min.mjs> <out.js>
// Only the trailing `export{a as B,...};` statement and the sourceMappingURL comment are rewritten;
// the library body is copied byte for byte.
"use strict";
const fs = require("fs"), crypto = require("crypto");
const [inp, out] = process.argv.slice(2);
let src = fs.readFileSync(inp, "utf8");
const sha = crypto.createHash("sha256").update(src).digest("hex");
src = src.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, "");
const m = src.match(/export\{([^}]*)\};?\s*$/);
if (!m) throw new Error("no trailing export{} found");
if (/\bimport\s*[\s{*"'(]|import\.meta|\bexport\s*[{*]|\bexport\s+(default|const|let|var|function|class)\b/.test(src.slice(0, m.index)))
  throw new Error("unexpected import/export inside body");
const props = m[1].split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
  const p = s.split(/\s+as\s+/); return JSON.stringify(p[1] || p[0]) + ":" + p[0];
});
const body = src.slice(0, m.index);
const outSrc =
  "/* clipper2-ts 2.0.1-18 (TypeScript port of Angus Johnson's Clipper2 by Jeremy Tribby), BSL-1.0.\n" +
  " * Source: https://registry.npmjs.org/clipper2-ts/-/clipper2-ts-2.0.1-18.tgz  dist/clipper2.min.mjs\n" +
  " * Input sha256: " + sha + "\n" +
  " * Wrapped as a classic-script IIFE by spikes/S1/tools/wrap_clipper2.js (export list -> global.Clipper2).\n" +
  " * See LICENSE-clipper2.txt. */\n" +
  "(function (global) {\n\"use strict\";\n" + body + "\nglobal.Clipper2 = Object.freeze({" + props.join(",") + "});\n" +
  "})(typeof window !== \"undefined\" ? window : globalThis);\n";
fs.writeFileSync(out, outSrc);
console.log("wrapped", props.length, "exports;", out, Buffer.byteLength(outSrc), "bytes");
