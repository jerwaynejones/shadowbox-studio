/* spikes/S2/render.js — before/after PNG comparisons → spikes/S2/visual/
 * For each input it picks (deterministically) the densest window of boundary corners and
 * renders the same window five ways, side by side, all at 100 µm/px, tol 50 µm:
 *   raw                 = option (b): bonded mode unsmoothed
 *   C bonded            = D1 as written (whole-loop fallback, art-boundary pins only)
 *   E bonded            = option (a): D1 + blanket shared-boundary pinning (v1 recommendation)
 *   G bonded            = option (c): lazy per-vertex pinning
 *   C connected         = unconstrained smoothing reference (no containment)
 * Each panel shows the stacked sheets (back light → front dark) with the raw boundary as a
 * thin red line, and its whole-stack "corners rounded" score.
 * Usage: node spikes/S2/render.js    (needs ImageMagick `magick` with an SVG delegate)        */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const S = require("./lib.js");
const OUT = path.join(__dirname, "visual"); fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "s2render-"));

const inputs = [
  { file: "art-procession", st: S.imageStack(S.IMAGES[2]), win: [96, 64] },
  { file: "art-village", st: S.imageStack(S.IMAGES[3]), win: [96, 64] },
  { file: "photo-coffee", st: S.imageStack(S.IMAGES[1]), win: [96, 64] },
  { file: "photo-mountains", st: S.imageStack(S.IMAGES[0]), win: [96, 64] },
  { file: "busy-768", st: { name: "busy-768", w: 768, h: 512, layers: S.busy(S.F.lcg(1), 768, 512, 8, 40) }, win: [96, 64] },
  { file: "random-s3", st: { name: "random s=3", w: 120, h: 90, layers: S.F.randomNestedStack(S.F.lcg(3), 120, 90, 6) }, win: [120, 90] },
];
const panels = [
  ["raw — option (b) bonded unsmoothed", null],
  ["C bonded — D1 as written", { ...S.CONFIGS.C, containment: true }],
  ["E bonded — option (a) D1 + shared-boundary pins", { ...S.CONFIGS.E, containment: true }],
  ["G bonded — option (c) per-vertex pinning", { ...S.CONFIGS.G, containment: true }],
  ["C connected — unconstrained reference", { ...S.CONFIGS.C, containment: false }],
];
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const palette = (n) => Array.from({ length: n }, (_, k) => { const t = n > 1 ? k / (n - 1) : 0; return `rgb(${lerp(238, 52, t)},${lerp(230, 40, t)},${lerp(214, 32, t)})`; });
const d = (paths) => paths.map((p) => "M" + p.map((v) => Number(v.x) + " " + Number(v.y)).join("L") + "Z").join("");

for (const { file, st, win } of inputs) {
  const sx = 100, [ww, wh] = win;
  // densest window of raw corners (layers ≥ 1), stride 8 px
  const runs = panels.map(([, cfg]) => (cfg ? S.runStack(st.layers, st.w, st.h, cfg) : null));
  const base = runs[1];
  let best = [0, 0], bc = -1;
  if (ww < st.w || wh < st.h) {
    const pts = base.layers.slice(1).flatMap((L) => L.loops.flat());
    for (let y = 0; y + wh <= st.h; y += 8) for (let x = 0; x + ww <= st.w; x += 8) {
      let c = 0; for (const [px, py] of pts) if (px > x && px < x + ww && py > y && py < y + wh) c++;
      if (c > bc) { bc = c; best = [x, y]; }
    }
  }
  const [x0, y0] = best, pw = 640, ph = Math.round((pw * wh) / ww), cols = palette(st.layers.length);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw * panels.length + 10 * (panels.length - 1)}" height="${ph + 64}" font-family="sans-serif">` +
    `<rect width="100%" height="100%" fill="#fff"/>`;
  panels.forEach(([label, cfg], pi) => {
    const run = runs[pi], ox = pi * (pw + 10);
    const layers = run ? run.layers.map((L) => L.S) : base.layers.map((L) => L.R);
    const score = run ? S.metrics(run).cornerShare : 0;
    svg += `<svg x="${ox}" y="0" width="${pw}" height="${ph}" viewBox="${x0 * sx} ${y0 * sx} ${ww * sx} ${wh * sx}">`;
    layers.forEach((paths, k) => { svg += `<path d="${d(paths)}" fill="${cols[k]}" fill-rule="nonzero" stroke="#222" stroke-width="${sx * 0.12}"/>`; });
    base.layers.slice(1).forEach((L) => { svg += `<path d="${d(L.R)}" fill="none" stroke="#e0201c" stroke-width="${sx * 0.06}" opacity="0.8"/>`; });
    svg += `</svg><rect x="${ox}" y="0" width="${pw}" height="${ph}" fill="none" stroke="#999"/>`;
    svg += `<text x="${ox + 4}" y="${ph + 22}" font-size="17" fill="#111">${label}</text>`;
    svg += `<text x="${ox + 4}" y="${ph + 46}" font-size="15" fill="#444">whole stack: ${(score * 100).toFixed(1)} % of corners rounded${run ? (run.cfg.containment ? (run.nestedOK ? " · nested" : " · NOT nested") : " · containment not enforced") : " · nested"}</text>`;
  });
  svg += `</svg>`;
  const svgPath = path.join(TMP, file + ".svg"), png = path.join(OUT, `${file}_window_x${x0}_y${y0}_${ww}x${wh}px.png`);
  fs.writeFileSync(svgPath, svg);
  execFileSync("magick", ["-background", "white", svgPath, png]);
  console.log(`${st.name}: window (${x0},${y0}) ${ww}x${wh} px, ${bc >= 0 ? bc : "all"} raw corners → ${path.relative(path.join(__dirname, "..", ".."), png)}`);
}
fs.rmSync(TMP, { recursive: true, force: true });
