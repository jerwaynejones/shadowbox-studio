/* ============================================================================
 * spikes/S2/lib.js — Spike S2 (rework): shared geometry, smoothing, D1 fixpoint
 * variants, inputs and the corrected "actually rounded" metrics.
 *
 * Reads (never modifies) js/util.js, js/trace.js, js/raster.js, js/morph.js and
 * test/fixtures.js. Geometry: clipper2-ts 2.0.1-18 via vendor/clipper2-ts.iife.js.
 * All geometry is on an integer micrometre grid, NonZero fill.
 * ==========================================================================*/
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
for (const f of ["util.js", "trace.js", "raster.js", "morph.js"]) vm.runInThisContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), { filename: f });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "vendor", "clipper2-ts.iife.js"), "utf8"), { filename: "clipper2-ts.iife.js" });
const F = require(path.join(ROOT, "test", "fixtures.js"));
const C = globalThis.Clipper2TS;
const { FillRule, ClipType, JoinType, EndType, PolyTree64 } = C;
const T = globalThis.SBTrace, SBRaster = globalThis.SBRaster, SBMorph = globalThis.SBMorph;

// ------------------------------------------------------------- geometry (µm)
const NZ = FillRule.NonZero;
const P = (rings) => rings.map((r) => r.map((p) => ({ x: p[0], y: p[1] })));
const union = (a) => C.union(a, NZ);
const diff = (a, b) => (a.length === 0 ? [] : b.length === 0 ? a : C.difference(a, b, NZ));
const inter = (a, b) => (a.length === 0 || b.length === 0 ? [] : C.intersect(a, b, NZ));
const area = (a) => Math.abs(C.areaPaths(a));
const isEmpty = (a) => a.length === 0 || area(a) === 0;
const offset = (a, d) => C.inflatePaths(a, d, JoinType.Miter, EndType.Polygon, 2);
const toUm = (loop, s) => loop.map(([x, y]) => [Math.round(x * s), Math.round(y * s)]);

function sliverUm(over) {
  if (isEmpty(over)) return 0;
  let lo = 0, hi = 1;
  while (!isEmpty(offset(over, -hi))) { lo = hi; hi *= 2; if (hi > 1e6) return Infinity; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (isEmpty(offset(over, -m))) hi = m; else lo = m; }
  return 2 * hi;
}
function ringTopology(paths) {
  const tree = new PolyTree64(); C.booleanOpWithPolyTree(ClipType.Union, paths, null, tree, NZ);
  const sig = (node) => { const k = []; for (let i = 0; i < node.count; i++) k.push(sig(node.child(i))); k.sort(); return "(" + k.join("") + ")"; };
  return sig(tree);
}

// ------------------------------------------- densified Hausdorff (GEO-04)
function segGrid(R, cell) {
  const g = new Map(), n = R.length, key = (cx, cy) => cx * 1048576 + cy;
  for (let i = 0; i < n; i++) {
    const a = R[i], b = R[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(L / (cell / 2)));
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps, y = a[1] + ((b[1] - a[1]) * s) / steps, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = key(cx + dx, cy + dy); let l = g.get(k); if (!l) g.set(k, (l = new Set())); l.add(i); }
    }
  }
  return { g, key, cell, R };
}
function distToRing(x, y, G) {
  const { g, key, cell, R } = G, n = R.length, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  let best = Infinity;
  for (let r = 0; r < 4096; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const l = g.get(key(cx + dx, cy + dy)); if (!l) continue;
      for (const i of l) {
        const a = R[i], b = R[(i + 1) % n], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
        const u = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2)) : 0;
        const d = Math.sqrt((x - a[0] - u * vx) ** 2 + (y - a[1] - u * vy) ** 2);
        if (d < best) best = d;
      }
    }
    if (best <= r * cell) break;
  }
  return best;
}
/** Directed densified distance A→B; returns [max, x, y] (location of the max on A). */
function directedArg(A, GB, step) {
  let m = 0, mx = A[0][0], my = A[0][1];
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < k; s++) { const x = a[0] + ((b[0] - a[0]) * s) / k, y = a[1] + ((b[1] - a[1]) * s) / k, d = distToRing(x, y, GB); if (d > m) { m = d; mx = x; my = y; } }
  }
  return [m, mx, my];
}
function maxDeviationArg(A, B, stepUm = 10, cell = 250) {
  const ab = directedArg(A, segGrid(B, cell), stepUm), ba = directedArg(B, segGrid(A, cell), stepUm);
  return ab[0] >= ba[0] ? ab : ba;
}
const maxDeviationUm = (A, B, stepUm = 10, cell = 250) => maxDeviationArg(A, B, stepUm, cell)[0];

// ---------------------------------------------- smoothing levels (pinned)
const LEVELS = ["raw", "rdp", "chaikin"];
function rdpOpen(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let idx = -1, dm = 0;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i], A = pts[a], B = pts[b], vx = B[0] - A[0], vy = B[1] - A[1], L2 = vx * vx + vy * vy;
      const u = L2 ? Math.max(0, Math.min(1, ((p[0] - A[0]) * vx + (p[1] - A[1]) * vy) / L2)) : 0;
      const d = Math.hypot(p[0] - A[0] - u * vx, p[1] - A[1] - u * vy); if (d > dm) { dm = d; idx = i; }
    }
    if (dm > eps && idx > 0) { keep[idx] = 1; st.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function rdpPinned(loop, eps, pinned) {
  const pin = loop.map(pinned);
  if (!pin.some(Boolean)) return T.simplify(loop, eps);
  const s = pin.indexOf(true), n = loop.length, rot = loop.slice(s).concat(loop.slice(0, s)), rp = pin.slice(s).concat(pin.slice(0, s));
  const out = []; let a = 0;
  for (let i = 1; i <= n; i++) if (i === n || rp[i]) { const seg = rot.slice(a, i + 1 > n ? n : i + 1); if (i === n) seg.push(rot[0]); out.push(...rdpOpen(seg, eps).slice(0, -1)); a = i; }
  return out.length >= 3 ? out : loop;
}
/** Chaikin, per-vertex corner-cut form; pinned vertices are emitted unchanged. */
function chaikinPinned(loop, iters, pinned) {
  let pts = loop;
  for (let k = 0; k < iters; k++) {
    const out = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[(i + n - 1) % n], v = pts[i], q = pts[(i + 1) % n];
      if (pinned(v)) { out.push(v); continue; }
      out.push([0.75 * v[0] + 0.25 * p[0], 0.75 * v[1] + 0.25 * p[1]], [0.75 * v[0] + 0.25 * q[0], 0.75 * v[1] + 0.25 * q[1]]);
    }
    pts = out;
  }
  return pts;
}
function smoothLevel(loop, level, epsPx, pinned) {
  if (level === 0) return loop;
  const r = rdpPinned(loop, epsPx, pinned);
  return level === 1 ? r : chaikinPinned(r, 2, pinned);
}

// ------------------------------------------------------------ the D1 runner
/**
 * cfg: { pxUm, tolUm, epsPx, pin (art rectangle), sharePin (blanket neighbour-boundary pins),
 *        local (per-vertex pinning instead of whole-loop fallback), containment (bonded fixpoint) }
 */
function runStack(masks, w, h, cfg) {
  const t0 = process.hrtime.bigint();
  const sx = cfg.pxUm, N = masks.length, devCell = Math.max(50, sx);
  const artPin = cfg.pin ? (p) => p[0] === 0 || p[1] === 0 || p[0] === w || p[1] === h : () => false;
  const onBoundary = (m, x, y) => { if (!m) return false; let s = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const px = x + dx, py = y + dy; s += px >= 0 && py >= 0 && px < w && py < h ? m[py * w + px] : 0; }
    return s > 0 && s < 4; };
  const vkey = (x, y) => x * 65536 + y;
  const layers = masks.map((m, k) => {
    const loops = T.trace(m, w, h);
    const rawUm = loops.map((lp) => toUm(lp, sx));
    const L = { loops, rawUm, R: union(P(rawUm)), topo: ringTopology(P(rawUm)), levels: [], ver: loops.map(() => 0), cache: loops.map(() => new Map()), pins: new Set(), vmap: new Map() };
    loops.forEach((lp, i) => lp.forEach(([x, y]) => { const kk = vkey(x, y); const a = L.vmap.get(kk); if (a) a.push(i); else L.vmap.set(kk, [i]); }));
    L.pin = (p) => artPin(p) || (cfg.sharePin && Number.isInteger(p[0]) && Number.isInteger(p[1]) && (onBoundary(masks[k - 1], p[0], p[1]) || onBoundary(masks[k + 1], p[0], p[1]))) ||
      (L.pins.size > 0 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && L.pins.has(vkey(p[0], p[1])));
    return L;
  });
  const ringAt = (L, i, lv = L.levels[i]) => { const ck = lv * 1e7 + L.ver[i]; let r = L.cache[i].get(ck); if (!r) { r = toUm(smoothLevel(L.loops[i], lv, cfg.epsPx, L.pin), sx); L.cache[i].clear(); L.cache[i].set(ck, r); } return r; };
  const counts = { deviation: 0, topology: 0, containment: 0 }; // loop-level demotions or vertex pins
  const pinVertex = (L, kk, reason) => { if (L.pins.has(kk)) return false; L.pins.add(kk); for (const i of L.vmap.get(kk) || []) L.ver[i]++; counts[reason]++; return true; };
  const isFree = (L, x, y) => !artPin([x, y]) && !L.pins.has(vkey(x, y)) && !(cfg.sharePin && L.pin([x, y]));
  let devNs = 0n;
  const dev = (a, b) => { const td = process.hrtime.bigint(); const r = maxDeviationArg(a, b, 10, devCell); devNs += process.hrtime.bigint() - td; return r; };

  // ---- gating (deviation + per-loop topology)
  const gated_ver = layers.map((L) => L.loops.map(() => -1));
  const gateLoop = (L, i) => {
    const rawTopo = ringTopology(P([L.rawUm[i]]));
    if (!cfg.local) {
      let lv = 2;
      for (; lv > 0; lv--) {
        const r = ringAt(L, i, lv), [d] = dev(L.rawUm[i], r);
        if (d <= cfg.tolUm && ringTopology(P([r])) === rawTopo) break;
        counts[d > cfg.tolUm ? "deviation" : "topology"]++;
      }
      L.levels[i] = lv; return;
    }
    // per-vertex: pin the corners that break the tolerance; keep the rest smoothed
    if (L.levels[i] === undefined) L.levels[i] = 2;
    for (let guard = 0; L.levels[i] > 0 && guard < 100000; guard++) {
      const r = ringAt(L, i);
      if (ringTopology(P([r])) !== rawTopo) { L.levels[i] = 0; counts.topology++; break; }
      const G = segGrid(r, devCell); let added = 0;
      for (const [x, y] of L.loops[i]) if (isFree(L, x, y) && distToRing(x * sx, y * sx, G) > cfg.tolUm) added += pinVertex(L, vkey(x, y), "deviation");
      if (added) continue;
      const [d, mx, my] = dev(L.rawUm[i], r);
      if (d <= cfg.tolUm) break;
      let best = null, bd = Infinity; // pin the free raw vertex nearest to the worst point
      for (const [x, y] of L.loops[i]) if (isFree(L, x, y)) { const dd = (x * sx - mx) ** 2 + (y * sx - my) ** 2; if (dd < bd) { bd = dd; best = [x, y]; } }
      if (!best) { L.levels[i] = 0; break; }
      pinVertex(L, vkey(best[0], best[1]), "deviation");
    }
  };
  const gateLayer = (L, k) => {
    let any = false;
    for (let i = 0; i < L.loops.length; i++) if (gated_ver[k][i] !== L.ver[i] && (L.levels[i] === undefined || L.levels[i] > 0)) { gateLoop(L, i); gated_ver[k][i] = L.ver[i]; any = true; }
    let guard = 0;
    while (ringTopology(P(L.loops.map((_, i) => ringAt(L, i)))) !== L.topo && guard++ < 3)
      for (let i = 0; i < L.loops.length; i++) if (L.levels[i] > 0) { counts.topology++; L.levels[i] = cfg.local ? 0 : L.levels[i] - 1; any = true; }
    return any;
  };
  layers.forEach(gateLayer);
  const build = (L) => union(P(L.loops.map((_, i) => ringAt(L, i))));
  for (const L of layers) L.S = build(L);
  const gated = layers.map((L) => L.S);

  // ---- containment fixpoint (bonded)
  const rawOver = layers.map((L, k) => (k === 0 ? [] : diff(L.R, layers[k - 1].R)));
  const induced = (k) => diff(diff(layers[k].S, layers[k - 1].S), rawOver[k]);
  const band = (L, i, d) => C.inflatePaths(P([ringAt(L, i)]), d, JoinType.Miter, EndType.Joined, 2);
  const implicated = (L, over) => { for (const d of [2, 25]) { const out = []; for (let i = 0; i < L.loops.length; i++) if (L.levels[i] > 0 && !isEmpty(inter(band(L, i, d), over))) out.push(i); if (out.length) return out; } return []; };
  // spatial index of raw vertices for the local variant
  const grids = cfg.local ? layers.map((L) => { const g = new Map(); L.loops.forEach((lp, i) => lp.forEach(([x, y]) => { const c = (x >> 3) * 65536 + (y >> 3); let a = g.get(c); if (!a) g.set(c, (a = [])); a.push([x, y, i]); })); return g; }) : null;
  const pinNear = (k, cxUm, cyUm, maxPx = 16) => {
    const L = layers[k], g = grids[k], px = cxUm / sx, py = cyUm / sx; let best = null, bd = Infinity;
    const r0 = Math.ceil(maxPx / 8), gx = Math.floor(px) >> 3, gy = Math.floor(py) >> 3;
    for (let dx = -r0; dx <= r0; dx++) for (let dy = -r0; dy <= r0; dy++) for (const [x, y, i] of g.get((gx + dx) * 65536 + (gy + dy)) || []) {
      if (L.levels[i] === 0 || !isFree(L, x, y)) continue;
      const d = (x - px) ** 2 + (y - py) ** 2; if (d < bd || (d === bd && (x < best[0] || (x === best[0] && y < best[1])))) { bd = d; best = [x, y]; }
    }
    if (!best || bd > maxPx * maxPx) return false;
    return pinVertex(L, vkey(best[0], best[1]), "containment");
  };
  const centroid = (path) => { let x = 0, y = 0; for (const p of path) { x += Number(p.x); y += Number(p.y); } return [x / path.length, y / path.length]; };
  let sweeps = 0, steps = 0, unresolved = 0, regates = 0;
  if (cfg.containment) for (let outer = true; outer;) {
    outer = false;
    for (let changed = true; changed;) {
      changed = false; sweeps++;
      for (let k = 1; k < N; k++) {
        for (;;) {
          const over = induced(k); if (isEmpty(over)) break;
          let touched = new Set();
          if (cfg.local) {
            // material outside raw layer k → layer k's smoothing bulged; inside raw k → layer k-1's smoothing cut it.
            // Degenerate rounding slivers can vanish under the classification ops, so fall back to the raw pieces,
            // and widen the search radius (RDP chords can end far from the sliver).
            const classified = [[diff(over, layers[k].R), k, k - 1], [inter(over, layers[k].R), k - 1, k]];
            if (!classified[0][0].length && !classified[1][0].length) classified.push([over, k, k - 1]);
            for (const maxPx of [16, 64, 256]) {
              for (const [pieces, first, second] of classified) for (const piece of pieces) {
                if (!piece.length) continue;
                const [cx, cy] = centroid(piece);
                if (pinNear(first, cx, cy, maxPx)) touched.add(first); else if (pinNear(second, cx, cy, maxPx)) touched.add(second);
              }
              if (touched.size) break;
            }
          }
          if (!touched.size) { // whole-loop demotion (loop variants, or last resort for local)
            let lk = k, who = implicated(layers[k], over);
            if (!who.length) { lk = k - 1; who = implicated(layers[k - 1], over); }
            if (!who.length) { unresolved++; break; }
            for (const i of who) { counts.containment++; layers[lk].levels[i] = cfg.local ? 0 : layers[lk].levels[i] - 1; }
            touched.add(lk);
          }
          for (const t of touched) layers[t].S = build(layers[t]);
          steps++; changed = true;
        }
      }
      if (sweeps > 100000) throw new Error("fixpoint did not terminate");
    }
    // local variant: containment pins can move RDP chords; re-gate touched loops, then re-check containment
    if (cfg.local) layers.forEach((L, k) => { const before = L.ver.join(","); if (gateLayer(L, k)) { L.S = build(L); regates++; if (L.ver.join(",") !== before || true) outer = true; } });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const nestedOK = layers.every((L, k) => k === 0 || isEmpty(diff(diff(L.S, layers[k - 1].S), rawOver[k])));
  return { cfg, layers, w, h, sx, N, gated, rawOver, ringAt, counts, sweeps, steps, unresolved, regates, ms, devMs: Number(devNs) / 1e6, nestedOK, artPin };
}

// --------------------------------------------- corrected metrics (per corner)
/**
 * A raw corner (every traced vertex is a direction change) is ROUNDED when the
 * final ring of its loop does not pass through it (distance > 1 µm). Boundary
 * length is ROUNDED where a densified raw-boundary sample is > 1 µm from the
 * final ring. Both are measured on geometry, so pinned vertices, raw loops and
 * pinned straight runs all count as unrounded. The v1 metric (perimeter of loops
 * whose level is "chaikin") is reported alongside only for comparison.
 */
function metrics(run) {
  const { layers, sx } = run;
  let corners = 0, cornersRounded = 0, cornersFree = 0, cornersFreeRounded = 0, len = 0, lenRounded = 0, perimAll = 0, perimV1 = 0, maxDev = 0, topoOK = true;
  const step = Math.max(10, sx / 10), cell = Math.max(50, sx);
  layers.forEach((L, k) => {
    if (k === 0) return; // backing sheet is the art rectangle (all corners pinned in every variant)
    for (let i = 0; i < L.loops.length; i++) {
      const raw = L.rawUm[i], fin = run.ringAt(L, i), G = segGrid(fin, cell);
      let per = 0;
      for (let j = 0; j < raw.length; j++) {
        const a = raw[j], b = raw[(j + 1) % raw.length];
        const r = distToRing(a[0], a[1], G) > 1; corners++; cornersRounded += r;
        if (!run.artPin(L.loops[i][j])) { cornersFree++; cornersFreeRounded += r; }
        const el = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(el / step)); per += el;
        for (let s = 0; s < n; s++) { len += el / n; if (distToRing(a[0] + ((b[0] - a[0]) * (s + 0.5)) / n, a[1] + ((b[1] - a[1]) * (s + 0.5)) / n, G) > 1) lenRounded += el / n; }
      }
      perimAll += per; if (L.levels[i] === 2) perimV1 += per;
      if (L.levels[i] > 0) { maxDev = Math.max(maxDev, maxDeviationUm(raw, fin, 10, cell)); if (ringTopology(P([fin])) !== ringTopology(P([raw]))) topoOK = false; }
    }
    if (ringTopology(L.S) !== L.topo) topoOK = false;
  });
  const lv = layers.slice(1).flatMap((L) => L.levels);
  return {
    loops: lv.length, chaikin: lv.filter((v) => v === 2).length, rdp: lv.filter((v) => v === 1).length, raw: lv.filter((v) => v === 0).length,
    corners, cornersRounded, cornerShare: corners ? cornersRounded / corners : 0, freeCornerShare: cornersFree ? cornersFreeRounded / cornersFree : 0,
    lengthShare: len ? lenRounded / len : 0, v1PerimShare: perimAll ? perimV1 / perimAll : 0,
    maxDevUm: maxDev, topoOK, nestedOK: run.nestedOK, sweeps: run.sweeps, steps: run.steps, unresolved: run.unresolved, regates: run.regates,
    counts: run.counts, ms: run.ms, devMs: run.devMs,
  };
}
function overhangRows(run, withSliver = true) {
  const rows = [], uncond = run.layers.map((L) => union(P(L.loops.map((_, i) => run.ringAt(L, i, 2)))));
  for (let k = 1; k < run.N; k++) {
    const oU = diff(uncond[k], uncond[k - 1]), oF = diff(run.layers[k].S, run.layers[k - 1].S);
    rows.push({ layer: k, loops: run.layers[k].loops.length, overUncondMM2: area(oU) / 1e6, sliverUncondUm: withSliver ? sliverUm(oU) : null, overFinalMM2: area(oF) / 1e6, rawOverMM2: area(run.rawOver[k]) / 1e6 });
  }
  return rows;
}
const outputHash = (run) => crypto.createHash("sha256").update(JSON.stringify(run.layers.map((L) => L.S.map((p) => p.map((v) => [Number(v.x), Number(v.y)]))))).digest("hex");

// ----------------------------------------------------------------- configs
const CONFIGS = {
  A: { label: "plan literal: simplify(0.6)+chaikin(2), 250 µm/px, no pinning, whole-loop fallback", pxUm: 250, tolUm: 50, epsPx: 0.6, pin: false },
  B: { label: "D1: rdp(tol/px)+chaikin(2), 250 µm/px, art-boundary pins, whole-loop fallback", pxUm: 250, tolUm: 50, epsPx: 0.2, pin: true },
  C: { label: "D1 @ 100 µm/px, art-boundary pins, whole-loop fallback", pxUm: 100, tolUm: 50, epsPx: 0.5, pin: true },
  D: { label: "D1 loose tol 100 µm @ 250 µm/px, whole-loop fallback", pxUm: 250, tolUm: 100, epsPx: 0.4, pin: true },
  E: { label: "D1 + blanket shared-boundary pinning @ 100 µm/px (v1 recommendation)", pxUm: 100, tolUm: 50, epsPx: 0.5, pin: true, sharePin: true },
  F: { label: "D1 + blanket shared-boundary pinning @ 250 µm/px", pxUm: 250, tolUm: 50, epsPx: 0.2, pin: true, sharePin: true },
  G: { label: "NEW: lazy per-vertex pinning (deviation + containment) @ 100 µm/px", pxUm: 100, tolUm: 50, epsPx: 0.5, pin: true, local: true },
  H: { label: "NEW: lazy per-vertex pinning (deviation + containment) @ 250 µm/px", pxUm: 250, tolUm: 50, epsPx: 0.2, pin: true, local: true },
};

// ----------------------------------------------------------------- inputs
const busy = (rng, w, h, N, B) => { const out = [new Uint8Array(w * h).fill(1)];
  for (let k = 1; k < N; k++) { const m = new Uint8Array(w * h);
    for (let b = 0; b < B; b++) { const cx = rng() * w, cy = rng() * h, r = 2 + (rng() * Math.min(w, h)) / 8;
      for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, cy + r + 1); y++) for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, cx + r + 1); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1; }
    for (let i = 0; i < m.length; i++) m[i] &= out[k - 1][i]; out.push(m); }
  return out; };

/** Real images: local files, provenance recorded; SHA-256 is verified before use. */
const IMAGES = [
  { id: "photo-mountains", kind: "photograph (landscape)", file: "/usr/share/doc/ImageMagick-7/www/image/mountains.jpg", pkg: "imagemagick 7.1.2.31-1 (Arch package, docs example image)", sha256: "6835b0d07eaa1694f2b56567385dbb941122c605dc6da8e34f9576c5b62a5062", size: "1500x1000" },
  { id: "photo-coffee", kind: "photograph (macro, foliage)", file: "/usr/share/omarchy/themes/ristretto/backgrounds/2-coffee-beans.jpg", pkg: "omarchy 4.0.4-1 (theme wallpaper)", sha256: "1f691430c72083f547871019c8c3f3632af1962f882ce54a45fcf07eaf2a330a", size: "2912x1632" },
  { id: "art-procession", kind: "painting (Flemish landscape, many figures)", file: "/usr/share/omarchy/themes/gruvbox/backgrounds/4-idyllic-procession.jpg", pkg: "omarchy 4.0.4-1 (theme wallpaper)", sha256: "be0ae73263a5eb69416fb13547826a60806859aa31bb031053afc73de60a55c5", size: "3160x1996" },
  { id: "art-village", kind: "painting (Dutch genre scene)", file: "/usr/share/omarchy/themes/gruvbox/backgrounds/3-village-square.jpg", pkg: "omarchy 4.0.4-1 (theme wallpaper)", sha256: "9ac4d52dbef06876a838e9cf9f97813dd86e99d2b977d9d11c5f389be6451cdc", size: "3160x2360" },
];
/** Product-default front end (app.js state): procRes 720, Kuwahara r4×2, 5 sheets balanced, darkFront,
 *  widthMM 300, minFeatureMM 1.2, cullBelowMM2 9 → per-sheet open/close/removeSpecks/fillHoles.
 *  Islands/bridges are NOT applied (they are connected-mode construction, not smoothing). */
function imageStack(img, longSide = 720) {
  const buf = fs.readFileSync(img.file), h256 = crypto.createHash("sha256").update(buf).digest("hex");
  if (h256 !== img.sha256) throw new Error("sha256 mismatch for " + img.file);
  const pam = execFileSync("magick", [img.file, "-auto-orient", "-resize", `${longSide}x${longSide}`, "-depth", "8", "-colorspace", "sRGB", "-alpha", "on", "pam:-"], { maxBuffer: 1 << 28 });
  let hdrEnd = pam.indexOf("ENDHDR\n") + 7; const hdr = pam.subarray(0, hdrEnd).toString();
  const w = +/WIDTH (\d+)/.exec(hdr)[1], h = +/HEIGHT (\d+)/.exec(hdr)[1], depth = +/DEPTH (\d+)/.exec(hdr)[1];
  const rgba = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) for (let c = 0; c < 4; c++) rgba[i * 4 + c] = depth === 4 ? pam[hdrEnd + i * 4 + c] : c === 3 ? 255 : pam[hdrEnd + i * depth + c];
  let L = SBRaster.luminance(rgba, w, h); L = SBRaster.kuwahara(L, w, h, 4, 2);
  const masks = SBRaster.sheetMasks(SBRaster.bands(L, SBRaster.thresholds(L, 5, "balanced")), 5, w, h, true);
  const pxPerMM = w / 300, featR = Math.max(1, Math.round((1.2 * pxPerMM) / 2)), cullPx = 9 * pxPerMM * pxPerMM;
  let violations = 0;
  const out = masks.map((m, s) => { if (s === 0) return m; let r = SBMorph.open(m, w, h, featR); r = SBMorph.close(r, w, h, Math.max(1, featR - 1)); SBMorph.removeSpecks(r, w, h, Math.max(4, cullPx * 0.5)); SBMorph.fillHoles(r, w, h, Math.max(4, (1.2 * pxPerMM) ** 2 * 2)); return r; });
  for (let k = 2; k < out.length; k++) for (let i = 0; i < out[k].length; i++) if (out[k][i] && !out[k - 1][i]) { violations++; out[k][i] = 0; }
  return { name: img.id + "-" + longSide, w, h, layers: out, nestingViolationsFixed: violations, img };
}
function datasets(which) {
  const out = [];
  if (which.includes("random")) for (let s = 1; s <= 20; s++) out.push({ set: "random", name: "random s=" + s, w: 120, h: 90, layers: F.randomNestedStack(F.lcg(s), 120, 90, 6) });
  if (which.includes("busy768")) out.push({ set: "busy768", name: "busy-768", w: 768, h: 512, layers: busy(F.lcg(1), 768, 512, 8, 40) });
  if (which.includes("busy1536")) out.push({ set: "busy1536", name: "busy-1536", w: 1536, h: 1024, layers: busy(F.lcg(1), 1536, 1024, 8, 40) });
  if (which.includes("images")) for (const img of IMAGES) out.push({ set: "images", ...imageStack(img) });
  return out;
}

module.exports = { C, P, T, F, union, diff, inter, area, isEmpty, sliverUm, ringTopology, segGrid, distToRing, maxDeviationUm, chaikinPinned, rdpPinned,
  runStack, metrics, overhangRows, outputHash, CONFIGS, LEVELS, busy, IMAGES, imageStack, datasets };
