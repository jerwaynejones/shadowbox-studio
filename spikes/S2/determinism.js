/* spikes/S2/determinism.js — determinism evidence for the D1 variants.
 * For 8 stacks (random seeds 1..5, busy-768, two real images) × configs C, E, G (100 µm/px) and H (250 µm/px)
 * × {bonded, connected}: SHA-256 of the final integer-µm geometry, computed
 *   run 1 and run 2 in this process (fresh runStack each time), and
 *   run 3 in a separate Node process (fresh VM, fresh Clipper2 instance).
 * All three must be identical. Usage: node spikes/S2/determinism.js            */
"use strict";
const { execFileSync } = require("child_process");
const S = require("./lib.js");
const CHILD = process.argv.includes("--child");
const stacks = [];
for (let s = 1; s <= 5; s++) stacks.push({ name: "random s=" + s, w: 120, h: 90, layers: S.F.randomNestedStack(S.F.lcg(s), 120, 90, 6) });
stacks.push({ name: "busy-768", w: 768, h: 512, layers: S.busy(S.F.lcg(1), 768, 512, 8, 40) });
stacks.push(S.imageStack(S.IMAGES[0]), S.imageStack(S.IMAGES[2]));
const hashes = {};
for (const st of stacks) for (const id of ["C", "E", "G", "H"]) for (const containment of [true, false]) {
  const key = `${st.name} | ${id} | ${containment ? "bonded" : "connected"}`;
  const runs = CHILD ? 1 : 2;
  hashes[key] = [];
  for (let r = 0; r < runs; r++) hashes[key].push(S.outputHash(S.runStack(st.layers, st.w, st.h, { ...S.CONFIGS[id], containment })));
}
if (CHILD) { process.stdout.write(JSON.stringify(hashes)); process.exit(0); }
const child = JSON.parse(execFileSync(process.execPath, [__filename, "--child"], { maxBuffer: 1 << 26 }).toString());
let ok = 0, bad = 0;
console.log("stack | config | mode".padEnd(46) + "sha256 (first 16)   in-process x2   separate process");
for (const [k, [a, b]] of Object.entries(hashes)) {
  const same2 = a === b, same3 = a === child[k][0];
  if (same2 && same3) ok++; else bad++;
  console.log(k.padEnd(46) + a.slice(0, 16) + "    " + (same2 ? "identical" : "DIFFERENT") + "       " + (same3 ? "identical" : "DIFFERENT"));
}
console.log(`\n${ok} / ${ok + bad} (stack, config, mode) combinations bit-identical across 3 runs (2 in-process + 1 separate process)`);
process.exit(bad ? 1 : 0);
