/* spikes/S1/det_payload.js — engine-independent determinism workload (NFR-05).
 * Classic script; needs SBUtil, SBTrace, SBGeom loaded. S1_DET() returns a JSON string of results
 * that must be byte-identical on every JS engine. */
(function (global) {
  "use strict";
  function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  function nested(rng, w, h, N) { // same construction as test/fixtures.js randomNestedStack
    const out = [new Uint8Array(w * h).fill(1)];
    for (let k = 1; k < N; k++) { const m = new Uint8Array(w * h);
      for (let b = 0; b < 3; b++) { const cx = rng() * w, cy = rng() * h, r = 1 + rng() * Math.min(w, h) / 3;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1; }
      for (let i = 0; i < m.length; i++) m[i] &= out[k - 1][i]; out.push(m); }
    return out;
  }
  global.S1_DET = function () {
    const G = global.SBGeom, T = global.SBTrace, res = [];
    for (let seed = 1; seed <= 12; seed++) {
      const w = 160, h = 120, st = nested(lcg(seed), w, h, 5);
      const L = st.map((m) => G.union(G.fromPixelLoops(T.trace(m, w, h), 250, 200, 1000, 3000), []));
      const Ls = st.map((m) => G.union(G.fromPixelLoops(T.trace(m, w, h).map((l) => T.chaikin(T.simplify(l, 0.5), 2)), 250, 200, 1000, 3000), []));
      for (let k = 1; k < L.length; k++) {
        res.push(G.difference(L[k - 1], L[k]), G.intersection(L[k], L[k - 1]), G.offset(L[k], -1500, "miter"), G.offset(L[k], 300, "miter"), G.offset(L[k], 200, "square"));
        res.push(G.difference(Ls[k - 1], Ls[k]), G.union(Ls[k], L[k - 1]), G.offset(Ls[k], -700, "miter"));
      }
    }
    for (let r = 100; r <= 5000; r += 700) res.push([G.circle(r, -r, r)]);
    return JSON.stringify(res);
  };
})(typeof window !== "undefined" ? window : globalThis);
