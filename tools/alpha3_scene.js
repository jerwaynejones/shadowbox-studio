#!/usr/bin/env node
/**
 * Deterministic large colour test scene for the alpha.3 browser verification (tools/verify_alpha3.mjs).
 *
 * A detailed colour illustration with fine features (thin wires, lit windows, fence pickets, grass blades, stars,
 * river ripples, a tree with thin branches) at 3600 × 2700 px, written as an 8-bit RGB PNG with no colour chunks
 * (so the browser decodes it to exactly these bytes). No randomness beyond a fixed-seed LCG; no npm.
 *
 * Usage: node tools/alpha3_scene.js <out.png> [width] [height]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { encode } = require(path.join(__dirname, "..", "test", "png_enc.js"));

function scene(W, H) {
  const px = new Uint8Array(W * H * 3);
  const S = W / 3600;   // features scale with the width
  let seed = 0x5eed1234;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const set = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
  const rect = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0 | 0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(W, x1); x++) set(x, y, c); };
  const disc = (cx, cy, r, c) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c); };
  const line = (x0, y0, x1, y1, w, c) => {   // thick segment as a capsule
    const minx = Math.floor(Math.min(x0, x1) - w), maxx = Math.ceil(Math.max(x0, x1) + w), miny = Math.floor(Math.min(y0, y1) - w), maxy = Math.ceil(Math.max(y0, y1) + w);
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1, r2 = (w / 2) ** 2;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2)), qx = x0 + t * dx - x, qy = y0 + t * dy - y;
      if (qx * qx + qy * qy <= r2) set(x, y, c);
    }
  };
  const poly = (pts, c) => {   // even-odd scanline fill
    let miny = Infinity, maxy = -Infinity;
    for (const [, y] of pts) { miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    for (let y = Math.max(0, Math.floor(miny)); y <= Math.min(H - 1, Math.ceil(maxy)); y++) {
      const xs = [], yc = y + 0.5;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= yc) !== (by <= yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) set(x, y, c);
    }
  };

  // sky: dusk gradient, orange horizon to deep blue
  const top = [18, 32, 84], mid = [120, 72, 140], hor = [250, 160, 80];
  for (let y = 0; y < H; y++) {
    const t = y / (H * 0.62), c = t < 0.6 ? mix(top, mid, t / 0.6) : mix(mid, hor, Math.min(1, (t - 0.6) / 0.4));
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
  }
  // stars (small, several sizes) in the upper sky
  for (let i = 0; i < 420; i++) disc(rnd() * W, rnd() * H * 0.35, (0.8 + rnd() * 3.2) * S, [255, 250, 225]);
  // sun with a ring and thin rays
  const sx = 2650 * S, sy = 1450 * S;
  for (let a = 0; a < 48; a++) { const th = (a / 48) * Math.PI * 2; line(sx + Math.cos(th) * 260 * S, sy + Math.sin(th) * 260 * S, sx + Math.cos(th) * 420 * S, sy + Math.sin(th) * 420 * S, 5 * S, [255, 214, 120]); }
  disc(sx, sy, 230 * S, [255, 236, 170]);
  disc(sx, sy, 200 * S, [255, 196, 90]);
  // crescent moon (a thin crescent: likely a narrow part)
  disc(520 * S, 380 * S, 110 * S, [245, 240, 215]);
  disc(560 * S, 350 * S, 100 * S, mix(top, mid, 0.2));
  // three mountain ranges, back to front, with snow caps
  const ranges = [[1350, [92, 70, 120], 0.004, 140], [1600, [64, 52, 98], 0.0062, 170], [1850, [40, 40, 70], 0.009, 120]];
  ranges.forEach(([base, col, f, amp], r) => {
    const pts = [[0, H]];
    for (let x = 0; x <= W; x += 6) pts.push([x, base * S - Math.abs(Math.sin(x * f / S + r * 1.7)) * amp * 2 * S - Math.sin(x * f * 3.3 / S + r) * amp * 0.4 * S]);
    pts.push([W, H]);
    poly(pts, col);
    if (r === 0) for (let x = 0; x < W; x += 3) {   // snow caps on the back range
      const y = base * S - Math.abs(Math.sin(x * f / S)) * amp * 2 * S - Math.sin(x * f * 3.3 / S) * amp * 0.4 * S;
      if (y < (base - amp * 1.6) * S) rect(x, y, x + 3, y + 26 * S, [235, 235, 245]);
    }
  });
  // city skyline with lit windows (fine rectangular detail) and antennas (thin lines)
  let bx = 1500 * S;
  while (bx < 3500 * S) {
    const bw = (70 + rnd() * 120) * S, bh = (180 + rnd() * 420) * S, by = 2000 * S - bh;
    rect(bx, by, bx + bw, 2000 * S, [28, 26, 44]);
    for (let wy = by + 14 * S; wy < 1985 * S; wy += 22 * S) for (let wx = bx + 10 * S; wx < bx + bw - 14 * S; wx += 18 * S)
      if (rnd() < 0.55) rect(wx, wy, wx + 8 * S, wy + 11 * S, [255, 210, 110]);
    if (rnd() < 0.4) line(bx + bw / 2, by, bx + bw / 2, by - 90 * S, 3 * S, [28, 26, 44]);
    bx += bw + (6 + rnd() * 20) * S;
  }
  // power line poles and thin sagging wires across the scene
  const poles = [200, 1100, 2000, 2900, 3500].map((x) => x * S);
  for (const x of poles) { line(x, 2250 * S, x, 1700 * S, 14 * S, [50, 34, 30]); line(x - 70 * S, 1740 * S, x + 70 * S, 1740 * S, 10 * S, [50, 34, 30]); }
  for (let i = 0; i + 1 < poles.length; i++) for (const off of [-60, 0, 60]) {
    let px0 = poles[i] + off * S, py0 = 1740 * S;
    for (let s = 1; s <= 40; s++) {
      const t = s / 40, x = poles[i] + off * S + (poles[i + 1] - poles[i]) * t, y = 1740 * S + Math.sin(t * Math.PI) * 120 * S;
      line(px0, py0, x, y, 2.5 * S, [30, 24, 30]); px0 = x; py0 = y;
    }
  }
  // meadow and a river with ripples
  poly([[0, 2050 * S], [W, 1980 * S], [W, H], [0, H]], [70, 120, 60]);
  poly([[900 * S, H], [1500 * S, 2080 * S], [1750 * S, 2080 * S], [1900 * S, H]], [80, 140, 200]);
  for (let i = 0; i < 160; i++) { const y = (2120 + rnd() * 560) * S, cx = 1500 * S + (y - 2080 * S) * -0.6 + rnd() * 380 * S; line(cx, y, cx + (30 + rnd() * 60) * S, y, 3 * S, [200, 230, 250]); }
  // a picket fence (regular fine pickets)
  for (let x = 2000 * S; x < 3550 * S; x += 34 * S) { poly([[x, 2350 * S], [x + 9 * S, 2330 * S], [x + 18 * S, 2350 * S], [x + 18 * S, 2470 * S], [x, 2470 * S]], [240, 236, 220]); }
  rect(2000 * S, 2380 * S, 3550 * S, 2390 * S, [240, 236, 220]);
  rect(2000 * S, 2440 * S, 3550 * S, 2450 * S, [240, 236, 220]);
  // a tree with recursive thin branches and leaf clusters
  const branch = (x, y, len, ang, w, d) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    line(x, y, x2, y2, w, [60, 40, 28]);
    if (d === 0) { disc(x2, y2, 16 * S, [40, 110, 50]); return; }
    branch(x2, y2, len * 0.72, ang - 0.42 - rnd() * 0.15, w * 0.68, d - 1);
    branch(x2, y2, len * 0.72, ang + 0.38 + rnd() * 0.15, w * 0.68, d - 1);
  };
  branch(650 * S, 2500 * S, 330 * S, -Math.PI / 2, 46 * S, 7);
  // grass blades in the foreground
  for (let i = 0; i < 900; i++) { const x = rnd() * W, y = (2550 + rnd() * 150) * S, h = (25 + rnd() * 60) * S; line(x, y, x + (rnd() - 0.5) * 30 * S, y - h, 2.2 * S, [30 + (rnd() * 40 | 0), 90 + (rnd() * 60 | 0), 40]); }
  // flowers: tiny colour dots
  for (let i = 0; i < 300; i++) disc(rnd() * W, (2480 + rnd() * 200) * S, (3 + rnd() * 4) * S, [[230, 60, 80], [250, 220, 70], [180, 90, 220]][i % 3]);
  return px;
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node tools/alpha3_scene.js <out.png> [width] [height]"); process.exit(2); }
  const W = parseInt(process.argv[3] || "3600", 10), H = parseInt(process.argv[4] || "2700", 10);
  const data = scene(W, H);
  fs.writeFileSync(out, encode({ w: W, h: H, colorType: 2, data, filter: 1 }));
  console.log(out + " " + W + "x" + H);
}
module.exports = { scene };
