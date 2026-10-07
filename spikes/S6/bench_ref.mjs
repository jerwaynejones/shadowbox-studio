// Spike S6 — hash-stage latency on the SRS §12.3 reference workloads (NFR-03 method: 5 warmups, 30 runs, p50/p95).
// Hash stage = normalize + canonicalBytes + SBHash.sha256 for every layer + the project stream.
// Run: node spikes/S6/bench_ref.mjs
import fs from "node:fs";
import { K, SBTrace, fromPixelLoops, unionRings, sha, lcg } from "./harness.mjs";

const now = () => Number(process.hrtime.bigint()) / 1e6;
function field(w, h, seed, nDiscs, rMin, rMax) {
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

function workload(name, w, h, N, seed, nDiscs, rMin, rMax, eps) {
  const masks = nested(field(w, h, seed, nDiscs, rMin, rMax), N), s = 304800 / Math.max(w, h);
  // RDP-simplify traced loops (as the tonal path does) so the vertex count is in the SRS envelope.
  const layers = masks.map((m, i) => ({ index: i, material: unionRings(fromPixelLoops(SBTrace.trace(m, w, h).map((L) => (eps ? SBTrace.simplify(L, eps) : L)), s, s, 0, 0)) }));
  const normalized = layers.map((L) => ({ index: L.index, material: K.normalize(L.material) }));
  const parts = normalized.map((L) => L.material.length), verts = normalized.reduce((a, L) => a + L.material.reduce((b, p) => b + ((p.outer.length + p.holes.reduce((c, q) => c + q.length, 0)) >> 1), 0), 0);
  const run = (src) => { const t = now(); const hs = src.map((L) => sha(K.canonicalBytes([L]))); const hp = sha(K.canonicalBytes(src)); return [now() - t, hs.join() + hp]; };
  const stats = (src) => { let ref; for (let i = 0; i < 5; i++) ref = run(src)[1]; const ts = []; let stable = true;
    for (let i = 0; i < 30; i++) { const [t, h] = run(src); ts.push(t); if (h !== ref) stable = false; } return { p50: +pct(ts, 50).toFixed(1), p95: +pct(ts, 95).toFixed(1), stable }; };
  const raw = stats(layers), pre = stats(normalized);
  const row = { name, raster: `${w}×${h}`, layers: N, maxPartsPerLayer: Math.max(...parts), totalVertices: verts, bytes: K.canonicalBytes(normalized).length,
    hashStageFromClipperOutput_ms: raw, hashStageFromNormalizedMaterial_ms: pre };
  console.log(JSON.stringify(row));
  return row;
}
const rows = [
  workload("desktop final (SRS §12.3): 1536², 8 layers", 1536, 1536, 8, 21, 60, 60, 420, 0.75),
  workload("desktop draft: 720², 8 layers", 720, 720, 8, 21, 60, 28, 197, 0.75),
  workload("mobile final (SRS §12.3): 768², 6 layers", 768, 768, 6, 33, 30, 40, 220, 0.75),
  workload("desktop final, raw pixel staircase (no RDP), 1536², 8 layers", 1536, 1536, 8, 21, 60, 60, 420, 0),
];
fs.writeFileSync(new URL("./bench_ref_results.json", import.meta.url), JSON.stringify({ node: process.version, cpu: (await import("node:os")).cpus()[0].model, date: new Date().toISOString(), rows }, null, 1));
