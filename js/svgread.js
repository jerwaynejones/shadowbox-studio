/* ============================================================================
 * Shadowbox Studio — svgread.js  (SBSvgRead, plan G1.5)
 * ----------------------------------------------------------------------------
 * A deliberately narrow reader for the fabrication SVGs that SBSvg.layerSVG
 * writes, used to prove the export round trip (GEO-09, AT-11) and to audit a
 * cut file for portability (AT-12, AT-13). It is NOT a general SVG renderer:
 * anything it cannot interpret exactly is reported, never guessed.
 *
 *   SBSvgRead.parse(svgText) → {widthMM, heightMM, viewBox: [x, y, w, h],
 *                               cut: number[][], score: number[][], unsupported: string[]}
 *     · cut   — closed rings (flat [x0, y0, x1, y1, …], integer µm), one per
 *               closed subpath inside <g id="CUT">, in document order, winding
 *               as written (the documented convention: outers positive, holes
 *               negative shoelace area in Y-down; SBGeom header). A repeated
 *               closing vertex is dropped.
 *     · score — open polylines (integer µm) inside <g id="SCORE">.
 *     · Path data: only absolute M, L and Z (implicit lineto after M allowed).
 *       Any other command, any element other than svg/g/path/desc/title, any
 *       transform/style/class/clip/mask/filter/href (any attribute outside the
 *       per-element allow list), a path outside CUT/SCORE, an open CUT path,
 *       a closed SCORE path, a degenerate ring, a non-finite coordinate,
 *       non-mm units or a viewBox that is offset or scaled are pushed to
 *       `unsupported` as a human-readable string. A path with an unsupported
 *       command or transform contributes no geometry.
 *     · Coordinates are user units = mm (checked against width/height) and are
 *       quantized to the 1 µm grid (Math.round(mm·1000)); layerSVG writes exact
 *       grid values, so the round trip is exact.
 *     · Throws SVGREAD_NOT_SVG when the document has no <svg> root.
 *   SBSvgRead.toMaterial(rings) → PolygonWithHoles[]
 *       Rebuilds material from parsed cut rings through SBGeom.union (NonZero
 *       on the written winding), then SBGeom.normalize: outers add, holes
 *       subtract, islands in holes add again.
 *
 * Pure: no DOM, no I/O; looks up SBGeom at call time (toMaterial only).
 * ==========================================================================*/
(function (global) {
  "use strict";

  const R = {};
  const NUM = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const COORD_LIMIT = 33554432; // ±2^25 µm, SBGeom.COORD_LIMIT (D4-C)

  // Allowed attributes per element. Everything else is reported (EXP-03: transforms, styles, classes,
  // clip paths, masks, filters and external references must not define a fabrication operation).
  const ALLOWED = {
    svg: new Set(["xmlns", "xmlns:xlink", "version", "width", "height", "viewBox"]),
    g: new Set(["id", "fill", "stroke", "stroke-width"]),
    path: new Set(["d", "id", "fill", "stroke", "stroke-width"]),
    desc: new Set(), title: new Set(),
  };
  const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const ATTR = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  function attrsOf(s) {
    const a = new Map();
    for (const m of s.matchAll(ATTR)) a.set(m[1], m[2] !== undefined ? m[2] : m[3]);
    return a;
  }

  /** "12.5mm" → {value: 12.5, unit: "mm"}; null when not a plain number with an optional unit. */
  function length(s) {
    const m = s === undefined ? null : new RegExp("^\\s*(" + NUM + ")\\s*([A-Za-z%]*)\\s*$").exec(s);
    return m ? { value: Number(m[1]), unit: m[2] } : null;
  }

  /**
   * Path data → {subpaths: [{pts: number[] (µm), closed}], bad: string[]}. Only absolute M/L/Z; every
   * unsupported command letter is listed (all of them, not just the first) and the path is then dropped.
   */
  function pathData(d) {
    const bad = [], seen = new Set(), toks = [];
    const re = new RegExp("([A-Za-z])|(" + NUM + ")|([^\\s,])", "g");
    for (const m of d.matchAll(re)) {
      if (m[1] !== undefined) { toks.push({ c: m[1] }); if (!"MLZ".includes(m[1]) && !seen.has(m[1])) { seen.add(m[1]); bad.push("command " + m[1]); } }
      else if (m[2] !== undefined) toks.push({ n: Number(m[2]) });
      else { bad.push("malformed path data near '" + m[3] + "'"); return { subpaths: [], bad }; }
    }
    if (bad.length) return { subpaths: [], bad };
    const subs = []; let cmd = null, cur = null, x = null;
    for (const t of toks) {
      if (t.c !== undefined) {
        if (x !== null) return { subpaths: [], bad: ["malformed path data (odd coordinate count)"] };
        cmd = t.c;
        if (cmd === "M") { if (cur) subs.push(cur); cur = { pts: [], closed: false }; }
        else if (cmd === "Z") { if (!cur || !cur.pts.length) return { subpaths: [], bad: ["malformed path data (Z without M)"] }; cur.closed = true; subs.push(cur); cur = null; cmd = null; }
        else if (!cur) return { subpaths: [], bad: ["malformed path data (L without M)"] };
        continue;
      }
      if (cmd === null) return { subpaths: [], bad: ["malformed path data (coordinate without command)"] };
      if (!Number.isFinite(t.n)) return { subpaths: [], bad: ["non-finite coordinate"] };
      const u = Math.round(t.n * 1000);
      if (Math.abs(u) > COORD_LIMIT) return { subpaths: [], bad: ["coordinate beyond ±2^25 µm"] };
      if (x === null) { x = u; continue; }
      cur.pts.push(x, u); x = null; // after M, further pairs are implicit L (SVG 1.1 §8.3.2)
    }
    if (x !== null) return { subpaths: [], bad: ["malformed path data (odd coordinate count)"] };
    if (cur) subs.push(cur);
    return { subpaths: subs, bad };
  }

  /** Twice the signed shoelace area of a flat ring (Y-down: outers positive, holes negative; SBGeom convention). */
  function area2(r) {
    let a = 0;
    for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
    return a;
  }

  R.parse = function (svgText) {
    if (typeof svgText !== "string") throw new Error("SBSvgRead.parse: SVGREAD_NOT_SVG — input must be SVG text");
    const unsupported = [], cut = [], score = [];
    const flag = (s) => { if (!unsupported.includes(s)) unsupported.push(s); };
    let root = null, widthMM = null, heightMM = null, viewBox = null;
    const stack = []; // open elements: {name, id, transform}
    const groups = { CUT: 0, SCORE: 0 }, pathNo = { CUT: 0, SCORE: 0 };

    for (const m of svgText.matchAll(TOKEN)) {
      const tok = m[0];
      if (m[2] === undefined) { if (/^<!DOCTYPE/i.test(tok)) flag("DOCTYPE declaration"); continue; }
      const closing = m[1] === "/", name = m[2], selfClosing = m[4] === "/";
      if (closing) { // pop to the matching element (tolerant of mismatches, which are reported)
        const i = stack.map((e) => e.name).lastIndexOf(name);
        if (i < 0) flag("unmatched </" + name + ">"); else { if (i !== stack.length - 1) flag("unclosed element inside <" + name + ">"); stack.length = i; }
        continue;
      }
      const a = attrsOf(m[3]);
      if (!root) {
        if (name !== "svg") throw new Error("SBSvgRead.parse: SVGREAD_NOT_SVG — root element is <" + name + ">");
        root = a;
      } else if (name === "svg") flag("nested <svg> element");
      const allowed = ALLOWED[name];
      if (!allowed) flag("<" + name + "> element");
      else for (const k of a.keys()) if (!allowed.has(k)) flag("attribute " + k + " on <" + name + ">");
      const parentGroup = (() => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].group) return stack[i].group; return null; })();
      const inherited = stack.some((e) => e.blocked);
      const el = { name, group: null, blocked: inherited || !allowed || a.has("transform") || (name === "svg" && stack.length > 0) };
      if (name === "g" && (a.get("id") === "CUT" || a.get("id") === "SCORE")) {
        const id = a.get("id");
        if (parentGroup) flag("<g id=\"" + id + "\"> nested inside " + parentGroup); else if (++groups[id] > 1) flag("duplicate <g id=\"" + id + "\">");
        el.group = id;
      }
      const group = el.group || parentGroup;
      if (group === "CUT" && a.has("fill") && a.get("fill") !== "none") flag("fill on CUT (cut boundaries have no fills)");
      if (name === "path") {
        if (!group) flag("path outside CUT/SCORE");
        else if (!el.blocked) {
          const k = ++pathNo[group], where = group + " path " + k;
          const { subpaths, bad } = pathData(a.get("d") || "");
          for (const b of bad) flag(b + " (" + where + ")");
          subpaths.forEach((s, j) => {
            const sub = subpaths.length > 1 ? " subpath " + (j + 1) : "";
            let p = s.pts;
            if (group === "CUT") {
              if (!s.closed) { flag("OPEN_PATH: " + where + sub + " has no Z (cut contours must be closed)"); return; }
              if (p.length >= 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) p = p.slice(0, -2);
              if (p.length < 6) { flag("degenerate CUT ring (" + where + sub + ", < 3 vertices)"); return; }
              cut.push(p);
            } else {
              if (s.closed) { flag("SCORE path closed with Z (" + where + sub + "; score paths are open polylines)"); return; }
              if (p.length < 4) { flag("degenerate SCORE path (" + where + sub + ", < 2 vertices)"); return; }
              score.push(p);
            }
          });
        }
      }
      if (!selfClosing) stack.push(el);
    }
    if (!root) throw new Error("SBSvgRead.parse: SVGREAD_NOT_SVG — no <svg> root element");

    // D-4.2: physical size in mm; user units must be mm (viewBox at the origin, unscaled)
    const W = length(root.get("width")), H = length(root.get("height"));
    if (W && Number.isFinite(W.value) && W.value > 0) widthMM = W.value;
    if (H && Number.isFinite(H.value) && H.value > 0) heightMM = H.value;
    if (!W || !H || W.unit !== "mm" || H.unit !== "mm" || widthMM === null || heightMM === null) flag("units: width and height must be positive lengths in mm");
    const vb = root.has("viewBox") ? root.get("viewBox").trim().split(/[\s,]+/).map(Number) : null;
    if (vb && vb.length === 4 && vb.every(Number.isFinite)) {
      viewBox = vb;
      if (vb[0] !== 0 || vb[1] !== 0) flag("viewBox is offset from the origin");
      if (widthMM !== null && heightMM !== null && (vb[2] !== widthMM || vb[3] !== heightMM)) flag("viewBox is scaled (user units are not mm)");
    } else flag("viewBox missing or malformed");
    for (const id of ["CUT", "SCORE"]) if (!groups[id]) flag("missing <g id=\"" + id + "\">");

    return { widthMM, heightMM, viewBox, cut, score, unsupported };
  };

  /**
   * Parsed cut rings → normalized material. NonZero union on the written winding: outer rings (positive) add,
   * hole rings (negative) subtract, so islands inside holes come back as their own polygons.
   */
  R.toMaterial = function (rings) {
    const G = global.SBGeom;
    const polys = (rings || []).map((r) => (area2(r) > 0 ? { outer: r, holes: [] } : { outer: [], holes: [r] }));
    return G.normalize(G.union(polys, []));
  };

  global.SBSvgRead = R;
})(typeof window !== "undefined" ? window : globalThis);
