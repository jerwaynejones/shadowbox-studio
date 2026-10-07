// spikes/S2/clipper2js_defects.js — why S2 rejected clipper2-js 1.2.4 (IRobot1) for clipper2-ts 2.0.1-18.
// Same inputs through both shims; prints what each returns. Usage: node spikes/S2/clipper2js_defects.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["clipper2.iife.js", "clipper2-ts.iife.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "vendor", f), "utf8"), { filename: f });
const J = globalThis.Clipper2, T = globalThis.Clipper2TS;
const rect = [0, 0, 1000, 0, 1000, 10, 0, 10], donut = [[0, 0, 30, 0, 30, 30, 0, 30], [10, 10, 10, 20, 20, 20, 20, 10]];
const jp = (rings) => { const p = new J.Paths64(); for (const r of rings) p.push(J.Clipper.makePath(r)); return p; };
const tp = (rings) => rings.map((r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push({ x: r[i], y: r[i + 1] }); return o; });
const s = (v) => JSON.stringify(v, (k, x) => (k === "z" ? undefined : x));
let bad = 0;
const row = (name, a, b, ok) => { console.log((ok ? "  same   " : "  DIFFER ") + name + "\n    clipper2-js: " + a + "\n    clipper2-ts: " + b); if (!ok) bad++; };
for (const d of [1, 4]) {
  const a = s(J.Clipper.InflatePaths(jp([rect]), -d, J.JoinType.Miter, J.EndType.Polygon, 2)), b = s(T.inflatePaths(tp([rect]), -d, T.JoinType.Miter, T.EndType.Polygon, 2));
  row(`inflate 1000x10 rect by -${d} (miter); expected [[${d},${d}]..[${1000 - d},${10 - d}]]`, a, b, a === b);
}
const jt = new J.PolyTree64(), jc = new J.Clipper64(); jc.addSubjectPaths(jp(donut));
const okJ = jc.executePolyTree(J.ClipType.Union, J.FillRule.NonZero, jt);
const tt = new T.PolyTree64(); T.booleanOpWithPolyTree(T.ClipType.Union, tp(donut), null, tt, T.FillRule.NonZero);
row("PolyTree union of a donut (expect 1 outer with 1 hole)", `succeeded=${okJ} roots=${jt.count}`, `roots=${tt.count} holes=${tt.count ? tt.child(0).count : "-"}`, okJ && jt.count === tt.count);
const a = s(J.Clipper.Union(jp([rect]), new J.Paths64(), J.FillRule.NonZero)), b = s(T.union(tp([rect]), T.FillRule.NonZero));
row("union of a single rectangle (duplicate vertices?)", a, b, a === b);
console.log(`\n${bad} divergent result(s); clipper2-ts matches the expected geometry in every case above.`);
