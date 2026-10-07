// Spike S6 — benchmark: trace → fromPixelLoops → Clipper2 union → normalize → canonicalBytes → sha256.
// Run: node spikes/S6/bench_s6.mjs [--write-fixture]
import fs from "node:fs";
import { K, SBTrace, fromPixelLoops, unionRings, sha, nodeSha, lcg, noiseMask } from "./harness.mjs";

const now = () => Number(process.hrtime.bigint()) / 1e6;
/** Integer height field: count of covering discs (LCG-placed); layer k = field ≥ k (nested, like height mode). */
function field(w, h, seed, nDiscs, rMin, rMax) {
  const rnd = lcg(seed), f = new Uint8Array(w * h);
  for (let k = 0; k < nDiscs; k++) {
    const cx = Math.floor(rnd() * w), cy = Math.floor(rnd() * h), r = rMin + Math.floor(rnd() * (rMax - rMin));
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++)
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r && f[y * w + x] < 255) f[y * w + x]++;
  }
  return f;
}
function layerFromMask(m, w, h, index, sx, sy) {
  const t0 = now(); const loops = SBTrace.trace(m, w, h); const t1 = now();
  const rings = fromPixelLoops(loops, sx, sy, 0, 0);
  const polys = unionRings(rings); const t2 = now();
  return { L: { index, material: polys }, tTrace: t1 - t0, tUnion: t2 - t1 };
}
function measure(name, w, h, masks, sx, sy) {
  let tTrace = 0, tUnion = 0, tNorm = 0, tBytes = 0, tSha = 0, bytes = 0, verts = 0, parts = 0, rings = 0;
  const layers = [], layerHashes = [];
  masks.forEach((m, i) => { const r = layerFromMask(m, w, h, i, sx, sy); tTrace += r.tTrace; tUnion += r.tUnion; layers.push(r.L); });
  for (const L of layers) {
    let t = now(); const n = K.normalize(L.material); tNorm += now() - t;
    for (const p of n) { parts++; rings += 1 + p.holes.length; verts += (p.outer.length + p.holes.reduce((a, q) => a + q.length, 0)) >> 1; }
    t = now(); const b = K.canonicalBytes([L]); tBytes += now() - t;   // includes a second normalize (as shipped)
    t = now(); layerHashes.push(sha(b)); tSha += now() - t; bytes += b.length;
  }
  // full project stream once
  let t = now(); const all = K.canonicalBytes(layers); const tAllBytes = now() - t;
  t = now(); const hAll = sha(all); const tAllSha = now() - t;
  const ok = hAll === nodeSha(all);
  const again = sha(K.canonicalBytes(layers.slice().reverse())) === hAll;
  const row = { name, raster: `${w}×${h}`, layers: masks.length, parts, rings, verts, bytesMiB: +(all.length / 1048576).toFixed(2),
    traceMs: +tTrace.toFixed(0), unionMs: +tUnion.toFixed(0), normalizeMs: +tNorm.toFixed(0), canonicalBytesMs: +tBytes.toFixed(0), sha256Ms: +tSha.toFixed(0),
    projectBytesMs: +tAllBytes.toFixed(0), projectShaMs: +tAllSha.toFixed(0), shaMatchesNodeCrypto: ok, layerOrderInvariant: again };
  console.log(JSON.stringify(row));
  return { row, layers, layerHashes, hAll };
}

/** N nested layers by height quantiles of f (layer 0 = full base, like M[0] = B). */
function nested(f, N) {
  const hist = new Float64Array(256); for (const v of f) hist[v]++;
  const th = [0]; let acc = 0, k = 1;
  for (let v = 0; v < 256 && k < N; v++) { acc += hist[v]; while (k < N && acc >= (k * f.length) / N) { th.push(v + 1); k++; } }
  while (th.length < N) th.push(256);
  return th.map((t) => f.map((v) => (v >= t ? 1 : 0)));
}
const results = [];
const sx = 304800 / 1536, sy = sx; // 304.8 mm art across 1536 px → 198.4375 µm/px (non-integer → rounding exercised)
// warm-up (JIT)
measure("warmup", 256, 192, [noiseMask(256, 192, 1, 0.5)], 1000, 1000);
{ const w = 720, h = 540, f = field(w, h, 11, 900, 6, 60); results.push(measure("draft 720px, 8 nested layers", w, h, nested(f, 8), 304800 / 720, 304800 / 720)); }
{ const w = 1536, h = 1152, f = field(w, h, 11, 6000, 4, 60); results.push(measure("fab 1536px, 8 nested layers (Plywood default)", w, h, nested(f, 8), sx, sy)); }
{ const w = 1536, h = 1152, f = field(w, h, 12, 9000, 3, 45); results.push(measure("fab 1536px, 16 nested layers", w, h, nested(f, 16), sx, sy)); }
{ const w = 720, h = 540; results.push(measure("worst case: 720px 50% white noise (saddles everywhere), 1 layer", w, h, [noiseMask(w, h, 5, 0.5)], 304800 / 720, 304800 / 720)); }

if (process.argv.includes("--write-fixture")) {
  // Cross-engine fixture: Clipper output (pre-normalize) for the draft project + expected hashes from Node.
  const r = results[0];
  const fx = { note: "S6 cross-engine fixture: Clipper2 union output (NOT normalized) of the draft 8-layer project; expected = Node SBHash", layers: r.layers, expectedLayerHashes: r.layerHashes, expectedProjectHash: r.hAll };
  fs.writeFileSync(new URL("./fixture_draft.json", import.meta.url), JSON.stringify(fx));
  console.log("wrote fixture_draft.json", (JSON.stringify(fx).length / 1048576).toFixed(2), "MiB");
}
fs.writeFileSync(new URL("./bench_results.json", import.meta.url), JSON.stringify({ node: process.version, date: new Date().toISOString(), results: results.map((x) => x.row) }, null, 1));
