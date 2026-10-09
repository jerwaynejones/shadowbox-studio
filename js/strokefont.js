/* ============================================================================
 * Shadowbox Studio — js/strokefont.js
 * ----------------------------------------------------------------------------
 * SBFont: a single-stroke (score-line) font for sheet labels (plan G3.2; alpha.3
 * E9 subset, EXP-03, ASM-03). Labels are scored as open polylines, never SVG text.
 *
 *   strokes(text, heightUm) → {paths: number[][], wUm, hUm}
 *     paths: open polylines, flat [x0, y0, x1, y1, …], integer µm, origin top-left,
 *     Y down. Glyphs live on a 4 × 6 unit grid with a 6-unit advance; every
 *     coordinate is Math.round(v · heightUm / 6) (integer arithmetic, NFR-05).
 *     wUm = the ink width (advance × (n − 1) + 4 units), hUm = heightUm.
 *     alpha.3 charset: "0123456789"; any other character throws FONT_CHAR.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const GLYPHS = {
    "0": [[0,0, 4,0, 4,6, 0,6, 0,0]],
    "1": [[1,1, 2,0, 2,6]],
    "2": [[0,0, 4,0, 4,3, 0,3, 0,6, 4,6]],
    "3": [[0,0, 4,0, 4,6, 0,6], [0,3, 4,3]],
    "4": [[0,0, 0,3, 4,3], [4,0, 4,6]],
    "5": [[4,0, 0,0, 0,3, 4,3, 4,6, 0,6]],
    "6": [[4,0, 0,0, 0,6, 4,6, 4,3, 0,3]],
    "7": [[0,0, 4,0, 4,6]],
    "8": [[0,0, 4,0, 4,6, 0,6, 0,0], [0,3, 4,3]],
    "9": [[4,3, 0,3, 0,0, 4,0, 4,6, 0,6]],
  };
  const CHARSET = "0123456789", ADVANCE = 6, WIDTH = 4, UNITS = 6;

  function strokes(text, heightUm) {
    if (!Number.isInteger(heightUm) || heightUm <= 0) throw new Error("SBFont.strokes: heightUm must be a positive integer µm (got " + heightUm + ")");
    const s = String(text), paths = [];
    for (let k = 0; k < s.length; k++) {
      const g = GLYPHS[s[k]];
      if (!g) throw new Error("SBFont.strokes: FONT_CHAR — character '" + s[k] + "' is outside the charset " + CHARSET);
      const ox = k * ADVANCE;
      for (const p of g) paths.push(p.map((v, i) => Math.round(((i % 2 ? 0 : ox) + v) * heightUm / UNITS)));
    }
    const wUm = s.length ? Math.round((ADVANCE * (s.length - 1) + WIDTH) * heightUm / UNITS) : 0;
    return { paths, wUm, hUm: heightUm };
  }

  global.SBFont = Object.freeze({ strokes, CHARSET });
})(typeof window !== "undefined" ? window : globalThis);
