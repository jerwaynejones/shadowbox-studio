// spikes/S5/s5_suite.mjs — the plan's "spike S5" suite (Task S5 Step 1), run against the spike-local SBGeom.
// The suite body is verbatim from the plan; only the harness (suite/check, require, SBGeom binding) is local,
// because test/run_tests.js is a shared file and js/geom.js does not exist yet (S1 runs concurrently).
//   node spikes/S5/s5_suite.mjs
import { F, SBTrace } from "./load_repo.mjs";
import { SBGeom } from "./geom_s5.mjs";
import { createRequire } from "node:module";
import path from "node:path";
import { ROOT } from "./load_repo.mjs";
const _req = createRequire(import.meta.url);
const require = (p) => _req(p === "./fixtures.js" ? path.join(ROOT, "test/fixtures.js") : p);

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } };
const suite = (name, fn) => { console.log("\n" + name); fn(); };

// ---- verbatim from docs/plans/opaque-layers-dev-plan.md, Task S5 Step 1 ----
suite("spike S5 — trace saddles & frame contact (GEO-02/03, AT-06)", () => {
  const F = require("./fixtures.js");
  const d = F.MASKS.diagonalTouch;
  check("S5 trace of diagonal-only contact yields two outer loops", SBTrace.trace(d.layers[1], d.w, d.h).length === 2);
  const polys = SBGeom.normalize(SBGeom.union(SBGeom.fromPixelLoops(SBTrace.trace(d.layers[1], d.w, d.h), 1000, 1000, 0, 0), []));
  check("AT-06 diagonal-only contact = 2 components", SBGeom.components(polys).length === 2);
  check("GEO-03 diagonal-only contact validates (simple rings)", SBGeom.validate(polys).ok);
});
// ---- end verbatim ----

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
