// spikes/S4/crosscheck.js — decode every corpus PNG with SBPng and compare to ImageMagick's raw gray output.
"use strict";
require("./load.js");
const fs = require("fs"), path = require("path");
const D = path.join(__dirname, "out", "corpus");
(async () => {
  const rows = [];
  for (const f of fs.readdirSync(D).filter((x) => x.endsWith(".png")).sort()) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(D, f)));
    const ref = fs.existsSync(path.join(D, f.replace(".png", ".gray"))) ? fs.readFileSync(path.join(D, f.replace(".png", ".gray"))) : null;
    const info = SBPng.inspect(bytes);
    const row = { file: f, ct: info.colorType, bd: info.bitDepth, il: info.interlace, chunks: [...new Set(info.chunks)].join(","),
      checkHeight: SBPng.check(info, "height"), checkTonal: SBPng.check(info, "tonal") };
    try {
      const r = await SBPng.decode(bytes, { mode: "height" });
      let diff = 0; if (ref) for (let i = 0; i < ref.length; i++) if (ref[i] !== r.samples[i]) diff++;
      Object.assign(row, { policy: r.policy, alpha: !!r.alpha, matchesMagick: ref ? diff === 0 && ref.length === r.samples.length : "n/a", diffPx: diff, hash: r.sampleHash.slice(0, 12) });
    } catch (e) { row.decodeError = e.code || e.message; }
    rows.push(row);
  }
  console.table(rows);
  fs.writeFileSync(path.join(__dirname, "out", "crosscheck.json"), JSON.stringify(rows, null, 1));
})();
