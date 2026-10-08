/* ============================================================================
 * Shadowbox Studio — svgout.js
 * ----------------------------------------------------------------------------
 * SVG generation with real-world millimetre units, following the color
 * conventions most laser software (LightBurn, RDWorks, xTool CS) expects:
 *
 *     RED  #FF0000, 0.1 mm stroke  →  vector CUT
 *     BLUE #0000FF                 →  vector SCORE / engrave (layer labels)
 *
 * Each sheet exports as its own file so different acrylic colors can be cut
 * separately. The artwork is welded to a frame ring (margin) so everything
 * that touches the image border is genuinely anchored, and optional corner
 * registration holes let the whole stack self-align on dowels or bolts.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const S = {};

  /**
   * Build one sheet's SVG.
   *
   * @param {object} p
   *   loops       {Array<Array<[x,y]>>} contour loops, px coords
   *   pxW, pxH    {number}   working raster size
   *   widthMM     {number}   artwork width in mm (height derived)
   *   marginMM    {number}   frame ring width around the artwork (0 = none)
   *   holes       {boolean}  registration holes in the frame corners
   *   holeDiaMM   {number}   registration hole diameter
   *   label       {string}   short label scored near the bottom-left corner
   *   isBacking   {boolean}  sheet 0: solid panel, no interior cuts
   * @returns {string} SVG document text
   */
  S.sheetSVG = function (p) {
    const mmPerPx = p.widthMM / p.pxW;
    const artH = p.pxH * mmPerPx;
    const m = p.marginMM;
    const W = p.widthMM + 2 * m;
    const H = artH + 2 * m;

    const cut = [];
    // Outer frame boundary (always cut).
    cut.push(rect(0, 0, W, H));

    if (!p.isBacking) {
      // Interior contours, translated into the frame by the margin.
      for (const loop of p.loops) cut.push(path(loop, mmPerPx, m));
      if (m <= 0) {
        // No frame ring: warn via comment; islands were anchored to the
        // largest component instead, so the file is still cuttable.
      }
    }

    if (p.holes && m > 0) {
      const r = p.holeDiaMM / 2;
      const inset = m / 2;
      for (const [cx, cy] of [
        [inset, inset], [W - inset, inset],
        [inset, H - inset], [W - inset, H - inset],
      ]) cut.push(circle(cx, cy, r));
    }

    const score = [];
    if (p.label) {
      score.push(
        `<text x="${f(2)}" y="${f(H - 2)}" font-family="monospace" ` +
        `font-size="4" fill="none" stroke="#0000FF" stroke-width="0.1">${esc(p.label)}</text>`
      );
    }

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!-- Shadowbox Studio export — RED = cut, BLUE = score -->\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" ` +
      `viewBox="0 0 ${f(W)} ${f(H)}">\n` +
      `<g fill="none" stroke="#FF0000" stroke-width="0.1">\n${cut.join("\n")}\n</g>\n` +
      (score.length ? `<g>${score.join("\n")}</g>\n` : "") +
      `</svg>\n`
    );
  };

  /**
   * Color proof: all sheets stacked and filled with their acrylic colors,
   * back to front — a printable preview of the assembled piece.
   */
  S.proofSVG = function (sheets, pxW, pxH, widthMM, colors) {
    const mmPerPx = widthMM / pxW;
    const H = pxH * mmPerPx;
    const groups = sheets.map((sheet, s) => {
      if (s === 0)
        return `<rect x="0" y="0" width="${f(widthMM)}" height="${f(H)}" fill="${colors[0]}"/>`;
      const d = sheet.loops.map((L) => pathD(L, mmPerPx, 0)).join(" ");
      return d
        ? `<path d="${d}" fill="${colors[s]}" fill-rule="evenodd"/>`
        : "";
    });
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!-- Shadowbox Studio color proof (not for cutting) -->\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${f(widthMM)}mm" height="${f(H)}mm" ` +
      `viewBox="0 0 ${f(widthMM)} ${f(H)}">\n${groups.join("\n")}\n</svg>\n`
    );
  };

  // ======================================================== v2 writer (G1.4)

  /**
   * Exact mm text for an integer µm value: (u/1000).toFixed(3) with trailing zeros (and a bare point) dropped.
   * Exact from integers (GEO-09); a non-integer is refused, never rounded.
   */
  S.fmtUm = function (u) {
    if (!Number.isInteger(u)) throw new Error("SBSvg.fmtUm: NONINTEGER — coordinates must be integer µm (got " + u + ")");
    const t = (u / 1000).toFixed(3).replace(/\.?0+$/, "");
    return t === "-0" ? "0" : t;
  };

  /**
   * One layer as a cut file (EXP-01/02/03, D-4.2).
   *
   *   layerSVG(layer: MaterialLayer, page: {wMM, hMM}, {construction, scorePaths, frontNote, legacyTextLabel?}) → string
   *
   * - mm units; viewBox = the shared page frame "0 0 wMM hMM" for every layer (EXP-01); origin top-left, Y down,
   *   no mirroring (D-4.2).
   * - <g id="CUT">: one closed <path d="M… L… Z"> per material ring (outer rings and holes, in normalized material
   *   order). No fill. There is never a page <rect>: the base gets its outline from its material ring.
   * - <g id="SCORE">: open polylines only (opts.scorePaths, else layer.scorePaths).
   * - legacyTextLabel: the v1.1.0 live <text> sheet label inside SCORE, for the connected export between G1.7 and
   *   G3.2 only (deleted in G3.2). Without it the output is pure vector (EXP-03).
   * Pure: the layer is not mutated and nothing here enters a hash.
   */
  S.layerSVG = function (layer, page, opts) {
    const o = opts || {};
    const wUm = pageUm(page && page.wMM, "wMM"), hUm = pageUm(page && page.hMM, "hMM");
    const W = S.fmtUm(wUm), H = S.fmtUm(hUm);

    const cut = [];
    for (const p of (layer && layer.material) || []) for (const r of [p.outer, ...(p.holes || [])]) cut.push(`<path d="${ringD(r, true)}"/>`);

    const score = [];
    for (const s of o.scorePaths || (layer && layer.scorePaths) || []) if (s.length >= 4) score.push(`<path d="${ringD(s, false)}"/>`);
    if (o.legacyTextLabel) {
      // v1.1.0 label, verbatim (sheetSVG): 2 mm in from the left, 2 mm up from the bottom.
      score.push(`<text x="2" y="${S.fmtUm(hUm - 2000)}" font-family="monospace" font-size="4" ` +
        `fill="none" stroke="#0000FF" stroke-width="0.1">${esc(String(o.legacyTextLabel))}</text>`);
    }

    const desc = [
      "Shadowbox Studio cut file" + (layer && Number.isInteger(layer.index) ? "; layer " + layer.index : ""),
      o.construction ? "construction=" + o.construction : null,
      "front face: " + (o.frontNote || "toward the viewer (Z+)"),
      "units mm; origin top-left; X right, Y-down; not mirrored",
      "kerfMode=external (no kerf offset applied)",
      "RED #FF0000 = CUT, BLUE #0000FF = SCORE",
    ].filter(Boolean).join("; ");

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n` +
      `<desc>${esc(desc)}</desc>\n` +
      `<g id="CUT" fill="none" stroke="#FF0000" stroke-width="0.1">\n${cut.length ? cut.join("\n") + "\n" : ""}</g>\n` +
      `<g id="SCORE" fill="none" stroke="#0000FF" stroke-width="0.1">\n${score.length ? score.join("\n") + "\n" : ""}</g>\n` +
      `</svg>\n`
    );
  };

  /**
   * Opaque proof of the assembled stack (GEO-01, MAT-04, UI-02). Not a cut file.
   *
   *   assemblySVG(layers: MaterialLayer[], page: {wMM, hMM}, colors: string | string[], {edgeStroke?}) → string
   *
   * - Same root element and viewBox as layerSVG (the shared page frame), so the proof aligns with every cut file.
   * - Layers are painted back to front by layer.index, one filled <path fill-rule="evenodd"> per non-empty layer
   *   whose subpaths are exactly the layer.material rings (outer rings and holes, normalized order). Empty layers
   *   emit nothing.
   * - colors: one "#rgb"/"#rrggbb" for a uniform appearance, or a palette indexed by layer.index. Anything else
   *   is refused (COLOR) so no attribute text can be injected.
   * - edgeStroke: default true when the appearance is uniform (one color, or every painted layer the same color):
   *   each layer edge gets a thin stroke darker than its fill so the layers stay readable. false/true override.
   * Pure: appearance never touches geometry; layers are not mutated and nothing here enters a hash (MAT-04).
   */
  S.assemblySVG = function (layers, page, colors, opts) {
    const o = opts || {};
    const wUm = pageUm(page && page.wMM, "wMM", "assemblySVG"), hUm = pageUm(page && page.hMM, "hMM", "assemblySVG");
    const W = S.fmtUm(wUm), H = S.fmtUm(hUm);
    const uniform = typeof colors === "string";
    const fillOf = (k) => hexColor(uniform ? colors : (Array.isArray(colors) ? colors[k] : undefined), k);

    const L = (layers || []).filter((l) => l && l.material && l.material.length).slice();
    for (const l of L) if (!Number.isInteger(l.index)) throw new Error("SBSvg.assemblySVG: NONINTEGER — layer.index must be an integer (got " + l.index + ")");
    L.sort((a, b) => a.index - b.index);
    const fills = L.map((l) => fillOf(l.index));
    const same = uniform || fills.every((c) => c === fills[0]);
    const stroke = o.edgeStroke === undefined ? same : !!o.edgeStroke;

    const body = L.map((l, j) => {
      const d = [];
      for (const p of l.material) for (const r of [p.outer, ...(p.holes || [])]) d.push(ringD(r, true));
      const st = stroke ? ` stroke="${darker(fills[j])}" stroke-width="0.2" stroke-linejoin="round"` : "";
      return `<path d="${d.join(" ")}" fill="${fills[j]}" fill-rule="evenodd"${st}/>`;
    });

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!-- proof: not for cutting -->\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n` +
      `<desc>Shadowbox Studio opaque proof; layers back to front; units mm; origin top-left; Y-down; not mirrored</desc>\n` +
      (body.length ? body.join("\n") + "\n" : "") +
      `</svg>\n`
    );
  };

  /** "#rgb" / "#rrggbb" → lowercase "#rrggbb"; anything else is refused (NFR-06: no attribute injection). */
  function hexColor(c, k) {
    if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase();
    if (typeof c === "string" && /^#[0-9a-fA-F]{3}$/.test(c)) return ("#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
    throw new Error("SBSvg.assemblySVG: COLOR — color for layer " + k + " must be #rgb or #rrggbb (got " + JSON.stringify(c) + ")");
  }

  /** Edge stroke: each channel scaled to 60 % (integer math), so it is darker than any non-black fill. */
  function darker(hex) {
    let out = "#";
    for (let i = 1; i < 7; i += 2) out += Math.floor((parseInt(hex.slice(i, i + 2), 16) * 3) / 5).toString(16).padStart(2, "0");
    return out;
  }

  /** Page dimension (mm on the 1 µm grid, as SBMaterial.page produces) → integer µm; anything else is refused. */
  function pageUm(mm, name, fn) {
    const who = "SBSvg." + (fn || "layerSVG");
    if (!(Number.isFinite(mm) && mm > 0)) throw new Error(who + ": NONFINITE — page." + name + " must be finite and > 0 mm");
    const u = Math.round(mm * 1000);
    if (Math.abs(mm * 1000 - u) > 1e-6) throw new Error(who + ": NONFINITE — page." + name + " is not on the 1 µm grid (" + mm + ")");
    return u;
  }

  /** Flat [x0,y0,x1,y1,…] µm → "M x y L x y … [Z]" in exact mm. */
  function ringD(r, closed) {
    let d = "M " + S.fmtUm(r[0]) + " " + S.fmtUm(r[1]);
    for (let i = 2; i + 1 < r.length; i += 2) d += " L " + S.fmtUm(r[i]) + " " + S.fmtUm(r[i + 1]);
    return closed ? d + " Z" : d;
  }

  // ---------------------------------------------------------------- helpers
  const f = (x) => Number(x.toFixed(3)).toString();

  function pathD(loop, k, off) {
    let d = `M ${f(loop[0][0] * k + off)} ${f(loop[0][1] * k + off)}`;
    for (let i = 1; i < loop.length; i++)
      d += ` L ${f(loop[i][0] * k + off)} ${f(loop[i][1] * k + off)}`;
    return d + " Z";
  }
  const path = (loop, k, off) => `<path d="${pathD(loop, k, off)}"/>`;
  const rect = (x, y, w, h) =>
    `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/>`;
  const circle = (cx, cy, r) =>
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>`;
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  global.SBSvg = S;
})(typeof window !== "undefined" ? window : globalThis);
