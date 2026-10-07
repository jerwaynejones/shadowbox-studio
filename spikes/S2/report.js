/* spikes/S2/report.js — merge results/raw/cfg_*.json into results/s2_results.json and print summary tables.
 * Usage: node spikes/S2/report.js > spikes/S2/results/s2_summary.txt                                   */
"use strict";
const fs = require("fs"), path = require("path");
const RAW = path.join(__dirname, "results", "raw");
const merged = { configs: {}, checks: [] };
for (const f of fs.readdirSync(RAW).filter((f) => /^cfg_[A-Z]\.json$/.test(f)).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(RAW, f), "utf8"));
  Object.assign(merged.configs, j.configs); merged.images = j.images; merged.node = j.node;
}
if (fs.existsSync(path.join(RAW, "checks.json"))) merged.checks = JSON.parse(fs.readFileSync(path.join(RAW, "checks.json"), "utf8")).checks;
fs.writeFileSync(path.join(__dirname, "results", "s2_results.json"), JSON.stringify(merged, null, 1));
const p = (v) => (v === undefined ? "—" : (v * 100).toFixed(1) + "%");
const ids = Object.keys(merged.configs).sort();
const SETS = ["random", "busy768", "busy1536", "images"];
console.log("S2 rework — corrected metric. 'corners' = share of raw corners the final geometry actually rounds (pooled);");
console.log("'length' = mean per-stack share of raw boundary length moved > 1 µm; 'v1' = old loop-level metric (flawed).\n");
for (const set of SETS) {
  console.log(`## ${set}`);
  console.log("cfg | bonded corners | bonded length | connected corners | connected length | connected+SP corners | bonded v1 | bonded dev/topo/cont | max sweeps/steps | unresolved | nested | topo | max dev µm | bonded ms (total) | connected ms");
  for (const id of ids) {
    const a = merged.configs[id].agg, b = a[set + "|bonded"], c = a[set + "|connected"], sp = a[set + "|connected+SP"];
    if (!b) continue;
    console.log([id, p(b.cornerShare), p(b.lengthShareMean), p(c.cornerShare), p(c.lengthShareMean), sp ? p(sp.cornerShare) : "—", p(b.v1PerimShare),
      `${b.deviation}/${b.topology}/${b.containment}`, `${b.maxSweeps}/${b.maxSteps}`, b.unresolved, b.allNested, b.allTopoOK && c.allTopoOK, Math.max(b.maxDevUm, c.maxDevUm).toFixed(1),
      b.msTotal.toFixed(0), c.msTotal.toFixed(0)].join(" | "));
  }
  console.log("");
}
console.log("## per real image (bonded corners / connected corners)");
for (const id of ids) {
  const per = merged.configs[id].per.filter((r) => r.set === "images");
  console.log(id + " | " + per.map((r) => `${r.name} ${p(r.modes.bonded.cornerShare)} / ${p(r.modes.connected.cornerShare)} (${r.modes.bonded.ms.toFixed(0)} ms)`).join(" | "));
}
console.log("\n## unconditional-smoothing overhang (bonded runs, all loops at chaikin)");
for (const id of ids) {
  const a = merged.configs[id].agg;
  if (merged.configs[id].cfg.local) { console.log(id + " | n/a — per-vertex variant: its chaikin rings already carry the final pins"); continue; }
  console.log(id + " | " + SETS.map((s) => a[s + "|bonded"] ? `${s}: ${a[s + "|bonded"].stacksWithUncondOverhang}/${a[s + "|bonded"].stacks} stacks, ${a[s + "|bonded"].uncondOverhangMM2.toFixed(4)} mm²` : "").join(" | "));
}
console.log(`\nG1.2 prototype checks: ${merged.checks.filter((c) => c.pass).length} / ${merged.checks.length} pass`);
