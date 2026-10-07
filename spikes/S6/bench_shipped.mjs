// Spike S6 follow-up — hash-stage latency of the SHIPPED SBGeom (js/geom.js, T-split included) on the same
// SRS §12.3 reference workloads as bench_ref.mjs (NFR-03 method: 5 warmups, 30 runs, p50/p95).
// Material = SBGeom.union(fromPixelLoops(trace)) (the shipped backend, already assembled).
// Hash stage A = SBHash.sha256(SBGeom.canonicalBytes([L])) per layer + the project stream (same as bench_ref);
// hash stage B = SBGeom.layerHashes(L) per layer (the G2.10b wiring: both D4 hashes, no project stream).
// Needs only the committed repo files. Run: node spikes/S6/bench_shipped.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(here, "../.."), require = createRequire(import.meta.url);
globalThis.crypto ??= require("node:crypto").webcrypto;
for (const f of require(path.join(ROOT, "test/modules.js")).NODE_MODULES) vm.runInThisContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), { filename: f });
const { SBGeom: G, SBHash, SBTrace } = globalThis, sha = (b) => SBHash.sha256(b);

const now = () => Number(process.hrtime.bigint()) / 1e6;
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function field(w, h, seed, nDiscs, rMin, rMax) { // identical to bench_ref.mjs
  const rnd = lcg(seed), f = new Uint8Array(w * h);
  for (let k = 0; k < nDiscs; k++) {
    const cx = Math.floor(rnd() * w), cy = Math.floor(rnd() * h), r = rMin + Math.floor(rnd() * (rMax - rMin));
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++)
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r && f[y * w + x] < 255) f[y * w + x]++;
  }
  return f;
}
function nested(f, N) {
  const hist = new Float64Array(256); for (const v of f) hist[v]++;
  const th = [0]; let acc = 0, k = 1;
  for (let v = 0; v < 256 && k < N; v++) { acc += hist[v]; while (k < N && acc >= (k * f.length) / N) { th.push(v + 1); k++; } }
  while (th.length < N) th.push(256);
  return th.map((t) => f.map((v) => (v >= t ? 1 : 0)));
}
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (run) => { let ref; for (let i = 0; i < 5; i++) ref = run()[1]; const ts = []; let stable = true;
  for (let i = 0; i < 30; i++) { const [t, h] = run(); ts.push(t); if (h !== ref) stable = false; } return { p50: +pct(ts, 50).toFixed(1), p95: +pct(ts, 95).toFixed(1), stable }; };

function workload(name, w, h, N, seed, nDiscs, rMin, rMax, eps) {
  const masks = nested(field(w, h, seed, nDiscs, rMin, rMax), N), s = 304800 / Math.max(w, h);
  const layers = masks.map((m, i) => ({ index: i, material: G.union(G.fromPixelLoops(SBTrace.trace(m, w, h).map((L) => (eps ? SBTrace.simplify(L, eps) : L)), s, s, 0, 0), []) }));
  const parts = layers.map((L) => L.material.length), verts = layers.reduce((a, L) => a + L.material.reduce((b, p) => b + ((p.outer.length + p.holes.reduce((c, q) => c + q.length, 0)) >> 1), 0), 0);
  const A = stats(() => { const t = now(); const hs = layers.map((L) => sha(G.canonicalBytes([L]))); const hp = sha(G.canonicalBytes(layers)); return [now() - t, hs.join() + hp]; });
  const B = stats(() => { const t = now(); const hs = layers.map((L) => { const x = G.layerHashes(L); return x.materialHash + x.layerHash; }); return [now() - t, hs.join()]; });
  const row = { name, raster: `${w}×${h}`, layers: N, maxPartsPerLayer: Math.max(...parts), totalVertices: verts, bytes: G.canonicalBytes(layers).length,
    hashStageCanonicalBytesPlusProject_ms: A, hashStageLayerHashes_ms: B };
  console.log(JSON.stringify(row));
  return row;
}
const rows = [
  workload("desktop final (SRS §12.3): 1536², 8 layers", 1536, 1536, 8, 21, 60, 60, 420, 0.75),
  workload("desktop draft: 720², 8 layers", 720, 720, 8, 21, 60, 28, 197, 0.75),
  workload("mobile final (SRS §12.3): 768², 6 layers", 768, 768, 6, 33, 30, 40, 220, 0.75),
  workload("desktop final, raw pixel staircase (no RDP), 1536², 8 layers", 1536, 1536, 8, 21, 60, 60, 420, 0),
];
fs.writeFileSync(path.join(here, "bench_shipped_results.json"), JSON.stringify({ node: process.version, cpu: os.cpus()[0].model, loadavg: os.loadavg().map((x) => +x.toFixed(2)), date: new Date().toISOString(), engine: G.backend, rows }, null, 1) + "\n");
