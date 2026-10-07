// spikes/S4/bench_core.js — engine-neutral benchmark (Node and Chromium). Exposes SBPngBench.run(files, log).
(function (global) {
  "use strict";
  const now = () => (global.performance || require("perf_hooks").performance).now();
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return +s[s.length >> 1].toFixed(2); };
  async function time(fn, reps) { const t = []; let r; for (let i = 0; i < reps; i++) { const t0 = now(); r = await fn(); t.push(now() - t0); } return [med(t), r]; }
  async function inflateOnly(info) {
    const ds = new DecompressionStream("deflate"), w = ds.writable.getWriter();
    const p = new Response(ds.readable).arrayBuffer();
    for (const [s, e] of info._idat) await w.write(info._b.subarray(s, e)); await w.close(); return (await p).byteLength;
  }
  global.SBPngBench = { run: async function (files, opts = {}) {
    const out = [];
    for (const { name, bytes } of files) {
      const [inspCrc, info] = await time(() => SBPng.inspect(bytes), 5);
      const [inspNoCrc] = await time(() => SBPng.inspect(bytes, { verifyCrc: false }), 5);
      const [crcOnly] = await time(() => SBUtil.crc32(bytes), 3);
      const [infl, rawLen] = await time(() => inflateOnly(info), 3);
      let dec = null, r = null, err = null;
      try { [dec, r] = await time(() => SBPng.decode(bytes, { mode: "height" }), opts.reps || 3); } catch (e) { err = e.code || e.message; }
      const [hashMs] = r ? await time(() => SBHash.digest(r.samples), 3) : [null];
      out.push({ name, MiB: +(bytes.length / 1048576).toFixed(2), MP: +((info.w * info.h) / 1e6).toFixed(2), ct: info.colorType, il: info.interlace,
        inspectMs: inspCrc, inspectNoCrcMs: inspNoCrc, crc32WholeFileMs: crcOnly, inflateMs: infl, inflatedMiB: +(rawLen / 1048576).toFixed(1),
        decodeMs: dec, sha256Ms: hashMs, policy: r && r.policy, hash: r && r.sampleHash.slice(0, 16), err });
      if (opts.log) opts.log(out[out.length - 1]);
    }
    return out;
  } };
})(typeof window !== "undefined" ? window : globalThis);
