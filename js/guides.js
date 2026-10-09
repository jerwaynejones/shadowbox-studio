/* ============================================================================
 * Shadowbox Studio — js/guides.js
 * ----------------------------------------------------------------------------
 * SBGuides: concealed alignment guides and scored sheet numbers for bonded
 * relief (plan G3.3 subset, alpha.3 E10; ASM-01/02/03, AT-13/14, GEO-07).
 * Guides of layer k+1 are scored on layer k inside the area that layer k+1
 * covers (ASM-02), so every score line is hidden once the stack is glued.
 *
 *   build(layers, cfg, ctx) → {scorePaths, guides, diagnostics}
 *     layers  MaterialLayer[] (index order 0 … N−1, bottom to top)
 *     cfg     construction.guides {mode, concealInsetMM, markFootprintMM, allowanceMM, labelHeightMM}
 *     ctx     {revision, quality} (diagnostic fields)
 *     scorePaths[k]  number[][]: open/closed flat polylines (integer µm) scored on layer k
 *     guides         {mode, labels: [{layer, text, atUm: [x, y], heightUm}], omitted: [{layer, part, reason}], map: null}
 *     diagnostics    GUIDE_OMITTED (one per part, detail.kind "part"; one per sheet label, detail.kind "label"),
 *                    ALIGN_CLEARANCE_ZERO (allowance 0). Not aggregated here (SBDiag.aggregate does that).
 *   validate(layers, built, cfg, ctx) → Diagnostic[]   GUIDE_UNCONTAINED only (blocking; bug guard)
 *
 * Integer µm throughout: c = concealInset, a = allowance, fp = footprint, fh = ⌊fp/2⌋, lh = label height.
 *   Rc_k = offset(upper, −(c + a + fh)) ∩ offset(lower, −fh)   centreline region of the guides (layer level)
 *   Rb_k = offset(upper, −(c + a)) ∩ lower                       where a burn may lie (validate)
 * inset-outline: every ring of Rc_k, closed. interior-mark: a position-only cross per attributed Rc polygon,
 * arm 1500/1000/600/300 µm, centred by SBGeom.placeBox. Sheet label String(k + 1) in Rc_k shrunk by fp + fh
 * (and clear of the crosses), placed by its own box (SBGeom.placeBox). The top sheet gets neither.
 * validate buffers the EMITTED strokes by fh and requires them inside Rb_k recomputed from the layers; a residue
 * narrower than 4 µm (does not survive an inset of 2 µm; the plan said 1 µm, but three integer offsets measured a
 * 2.09 µm rounding residue at an acute corner) does not count.
 * Offsets are "miter" only (Appendix C); no trig (NFR-05). Looks up SBGeom, SBFont and SBDiag at call time.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const ARMS = [1500, 1000, 600, 300];
  // A residue that does not survive an inset of SLIVER_UM (narrower than 4 µm) is integer-µm offset rounding, not a
  // stray score: Rc, the burn band and Rb are three separate integer offsets, each rounding its vertices by up to
  // √2/2 µm, and a 51° corner measured a 2.09 µm-wide residue (E10 test E-R5). A real stray burn is 2·fh wide.
  const SLIVER_UM = 2;
  const um = (mm) => Math.round(mm * 1000);

  function params(cfg) {
    if (!cfg || typeof cfg !== "object") throw new Error("SBGuides: cfg (construction.guides) required");
    const c = um(cfg.concealInsetMM), a = um(cfg.allowanceMM), fp = um(cfg.markFootprintMM), lh = um(cfg.labelHeightMM);
    for (const [k, v] of [["concealInsetMM", c], ["allowanceMM", a], ["markFootprintMM", fp]]) if (!Number.isInteger(v) || v < 0) throw new Error("SBGuides: " + k + " must be ≥ 0");
    if (!Number.isInteger(lh) || lh <= 0) throw new Error("SBGuides: labelHeightMM must be > 0");
    return { mode: cfg.mode, c, a, fp, fh: Math.floor(fp / 2), lh };
  }
  const nonEmpty = (L) => !!(L && L.material && L.material.length && !global.SBGeom.isEmpty(L.material));
  const off = (polys, d) => (polys.length ? global.SBGeom.offset(polys, d, "miter") : []);
  const isect = (a, b) => (a.length && b.length ? global.SBGeom.normalize(global.SBGeom.intersection(a, b)) : []);

  /** Rc_k: the region every guide centreline of layer k+1 on layer k lies in. */
  function regionC(lower, upper, P) {
    return isect(off(upper.material, -(P.c + P.a + P.fh)), off(lower.material, -P.fh));
  }
  /** Rb_k: the region a burn on layer k may occupy (concealed by layer k+1 with the allowance, on lower material). */
  function regionB(lower, upper, P) {
    return isect(off(upper.material, -(P.c + P.a)), lower.material);
  }
  const closedRing = (r) => r.concat([r[0], r[1]]);
  const box = (x, y, h) => ({ outer: [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h], holes: [] });

  /** The part of `upper` that contains the first outer vertex of poly (bbox, then even-odd test), or null. */
  function attribute(poly, parts) {
    const x = poly.outer[0], y = poly.outer[1], G = global.SBGeom;
    for (const p of parts) {
      const b = p.bbox;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (G.containsPoint([p.polygon], [x, y])) return p;
    }
    return null;
  }

  function build(layers, cfg, ctx) {
    const G = global.SBGeom, D = global.SBDiag, F = global.SBFont, P = params(cfg);
    ctx = ctx || {};
    const dOpts = { revision: ctx.revision === undefined ? 0 : ctx.revision, quality: ctx.quality || "draft" };
    const N = layers.length, scorePaths = layers.map(() => []), labels = [], omitted = [], diagnostics = [];
    const interior = P.mode === "interior-mark";
    if (P.a === 0 && N > 1) diagnostics.push(D.make("ALIGN_CLEARANCE_ZERO", Object.assign({ detail: "allowance 0 mm: guide burns reach the edge of the concealed area" }, dOpts)));
    for (let k = 0; k + 1 < N; k++) {
      const lower = layers[k], upper = layers[k + 1];
      if (!nonEmpty(upper) || !nonEmpty(lower)) continue;
      const Rc = regionC(lower, upper, P), parts = upper.parts || [];
      // attribution: each Rc polygon lies inside exactly one part of k+1
      const byPart = new Map();
      for (const poly of Rc) {
        const p = attribute(poly, parts); if (!p) continue;
        if (!byPart.has(p.id)) byPart.set(p.id, []);
        byPart.get(p.id).push(poly);
      }
      const paths = scorePaths[k], keepOut = [];
      const omit = (id, reason) => {
        omitted.push({ layer: k + 1, part: id, reason });
        diagnostics.push(D.make("GUIDE_OMITTED", Object.assign({ layer: k + 1, parts: [id], detail: { kind: "part", text: reason } }, dOpts)));
      };
      if (!interior) {
        for (const p of parts) if (!byPart.has(p.id)) omit(p.id, "no concealed area ≥ footprint");
        for (const poly of Rc) for (const r of [poly.outer].concat(poly.holes || [])) paths.push(closedRing(r));
      } else {
        for (const p of parts) {
          const polys = byPart.get(p.id);
          if (!polys) { omit(p.id, "no concealed area ≥ footprint"); continue; }
          let placed = 0;
          for (const poly of polys) {
            for (const r of ARMS) {
              const q = G.placeBox([poly], r, r);
              if (!q) continue;
              paths.push([q[0] - r, q[1], q[0] + r, q[1]], [q[0], q[1] - r, q[0], q[1] + r]);
              keepOut.push(box(q[0], q[1], r + P.fp));
              placed++;
              break;
            }
          }
          if (!placed) omit(p.id, "no concealed area for the smallest mark");
        }
      }
      // sheet label: the sheet file number, scored in a concealed area clear of the guide burns
      const text = String(k + 1);
      let at = null, s = null;
      if (Rc.length) {
        let region = off(Rc, -(P.fp + P.fh));
        if (region.length && keepOut.length) region = G.normalize(G.difference(region, keepOut));
        if (region.length && !G.isEmpty(region)) {
          s = F.strokes(text, P.lh);
          at = G.placeBox(region, Math.ceil(s.wUm / 2) + P.fh, Math.ceil(s.hUm / 2) + P.fh);
        }
      }
      if (at) {
        const ox = at[0] - Math.ceil(s.wUm / 2), oy = at[1] - Math.ceil(s.hUm / 2);
        for (const sp of s.paths) paths.push(sp.map((v, i) => v + (i % 2 ? oy : ox)));
        labels.push({ layer: k, text, atUm: [at[0], at[1]], heightUm: P.lh });
      } else {
        diagnostics.push(D.make("GUIDE_OMITTED", Object.assign({ layer: k, parts: [],
          detail: { kind: "label", sheet: k + 1, text: "sheet " + (k + 1) + " label did not fit; see the placement map" } }, dOpts)));
      }
    }
    return { scorePaths, guides: { mode: P.mode, labels, omitted, map: null }, diagnostics };
  }

  function validate(layers, built, cfg, ctx) {
    const G = global.SBGeom, D = global.SBDiag, P = params(cfg);
    ctx = ctx || {};
    const dOpts = { revision: ctx.revision === undefined ? 0 : ctx.revision, quality: ctx.quality || "draft" };
    const out = [], half = Math.max(1, P.fh), sp = (built && built.scorePaths) || [];
    for (let k = 0; k < sp.length; k++) {
      const paths = (sp[k] || []).filter((p) => Array.isArray(p) && p.length >= 4);
      if (!paths.length) continue;
      const lower = layers[k], upper = layers[k + 1];
      const Rb = nonEmpty(lower) && nonEmpty(upper) ? regionB(lower, upper, P) : [];
      const burn = G.bufferPolylines(paths, half);
      const rest = Rb.length ? G.normalize(G.difference(burn, Rb)) : burn;
      if (rest.length && !G.isEmpty(rest) && G.survivesInset(rest, SLIVER_UM)) {
        const b = rest.map((p) => G.bbox(p)).reduce((m, r) => [Math.min(m[0], r[0]), Math.min(m[1], r[1]), Math.max(m[2], r[2]), Math.max(m[3], r[3])]);
        out.push(D.make("GUIDE_UNCONTAINED", Object.assign({ layer: k, region: b.map((v) => v / 1000),
          detail: "a score line on sheet " + (k + 1) + " lies outside the area the next sheet conceals" }, dOpts)));
      }
    }
    return out;
  }

  global.SBGuides = Object.freeze({ build, validate });
})(typeof window !== "undefined" ? window : globalThis);
