// Loads the repo's pure classic-script modules (read-only) into this realm, exactly as test/run_tests.js does.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
globalThis.crypto ??= require("crypto").webcrypto;
for (const f of require(path.join(ROOT, "test/modules.js")).NODE_MODULES)
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), { filename: f });
export const F = require(path.join(ROOT, "test/fixtures.js"));
export const SBTrace = globalThis.SBTrace, SBMorph = globalThis.SBMorph, SBSvg = globalThis.SBSvg;
