# Shadowbox Studio — algorithm notes

Written for a reader comfortable with code. Each section names the module
that implements it.

## 1. Cartoonization — Kuwahara filter (`raster.js`)

Posterizing a raw photo produces ragged, noisy bands. We first apply the
classic 4-quadrant **Kuwahara filter**: for each pixel, examine the four
(r+1)×(r+1) windows that have the pixel at a corner, and output the mean of
the window with the **lowest variance**. Smooth regions get averaged; the
window straddling an edge always has high variance and loses, so edges stay
razor sharp. The result looks like flat paint — ideal input for banding.

Naively this is O(pixels·r²). We precompute **summed-area tables** of the
luminance and its square, so any window's mean and variance come from eight
array reads — O(pixels) total regardless of radius, which is why the sliders
stay interactive even on a phone.

## 2. Tone banding and nested sheets (`raster.js`)

N sheets need N−1 thresholds over Rec.709 luminance. *Balanced* mode places
them at histogram percentiles (equal pixel area per band); *linear* mode
spaces them evenly between the 2nd and 98th percentile (robust to outliers).

Sheet masks are **cumulative**: sheet k contains every band at least as dark
as its own (with dark-in-front; inverted otherwise). This guarantees
`sheet k ⊇ sheet k+1` — the stack physically composites into the image, and
each sheet's silhouette is exactly "everything still visible from here up".
Sheet 0 is the solid backing. This nesting invariant is enforced by
construction and verified in the test suite.

## 3. Fabrication morphology (`morph.js`)

Real acrylic can't hold arbitrarily fine features, so each sheet mask gets:

- **Opening** (erode→dilate, radius = minFeature/2 in px) — removes strips
  thinner than the minimum feature width.
- **Closing** — seals pinhole gaps that would become fragile slivers.
- **Speck removal / hole filling** — connected-component labeling (BFS with
  preallocated Int32 queues), dropping material or void components below
  physical area thresholds.

mm→px conversion is `pxPerMM = workingWidthPx / artworkWidthMM`, so every
threshold is a real bench dimension independent of preview resolution.

### 3.1 Bonded mode: exact digital-disc open/close (Appendix G, G1)

Connected mode keeps the v1.1 square chain above (open with the (2r+1)²
window, r = `featR`, then close with r − 1). Bonded mode uses an exact
**digital disc** instead (`SBMorph.discOpenClose`, called by
`SBConstruct.constructLayer`):

- **Radius.** p = the coarser axis pitch, F = minFeature / p in px (rounded to
  1e-9 so binary noise cannot move a tie), m = ⌊(⌊F⌋ + 1)/2⌋ and
  **R² = m²** when F ≥ 3. Erosion keeps a pixel iff every background pixel
  is at squared distance > R²; dilation sets a pixel iff some material pixel
  is at squared distance ≤ R². The closing uses the same R² (v1.1's
  "close = r − 1" compensated the square window and is not carried over).
- **Tie rule.** A strip of w px has centre-line distance ⌊(w + 1)/2⌋ to the
  background, so the disc cannot tell 2m − 1 from 2m px. R² = m² removes
  both: at 1.5 mm and 0.1 mm/px (F = 15, m = 8, R² = 64) strips and necks of
  ≤ 16 px are removed and 17 px survive; waste channels of ≤ 16 px close and
  17 px stay open. The feature checks flag widths at or below the minimum
  feature, so cleanup never keeps a width the checks flag. Unlike the square
  window, a 45° neck or channel is judged by its true perpendicular width.
- **Fallback.** F < 3 (drafts only; at fabrication it is the blocking
  `SAMPLING_LOW` condition) gives R² = 0 and keeps the square `featR` chain.
- **Image border (behaviour change).** Pixels outside the image are neither
  material nor background: erosion never erodes from outside and dilation
  never adds from outside. The square kernels never touched the 1-px border
  ring; the disc erodes a border pixel when interior background lies within
  R² of it, so art touching the image edge is cleaned like interior art (an
  edge strip of ≤ 16 px at the default disappears completely).
- **Kernel.** Per window: the vertical distance g to the nearest indicator
  pixel in each column (a down and an up sweep, capped at ⌊√R²⌋ + 1), then
  per row a left and a right "reach" sweep with hw[t] = ⌊√(R² − t²)⌋: a pixel
  is hit iff some q in its row has |x − q| ≤ hw[g[q]]. O(w·h) for any R²,
  integer arithmetic only (NFR-05), in 4-byte words when ⌊√R²⌋ + 1 ≤ 126.
  Four windows (erode, dilate, dilate, erode) with no fusion, since a
  digital disc ⊕ disc is not a disc. Erosion and dilation are increasing,
  so nested layers stay nested (D-4.5).

## 4. Island resolution (`islands.js`) — the core

**Problem.** Any kept region not connected to the rest of the sheet falls
out on the laser bed. Classic examples: a moon in the sky layer, lit
windows, the counter of an "O".

**Anchoring.** With a frame ring (margin > 0), every component touching the
image border is anchored — the exported SVG welds the artwork to a solid
border, so border contact means real support. Frameless, only the largest
component is the anchor.

**Decision per island.**
- Area below the cull threshold → **erase** (visual value doesn't justify a
  bridge).
- Otherwise → **bridge**: a level-order BFS expands from all island pixels
  simultaneously across empty space until it touches an anchored pixel; the
  parent chain is the shortest 4-connected path. We stamp discs of the
  bridge radius along it, recording newly-added pixels in a separate
  *bridges* mask so the UI can display every fix in amber.
- BFS depth beyond the max-bridge budget → cull instead (no bridge trailing
  across the whole scene).

**Daisy-chaining.** Islands are processed largest-first, and each bridged
island is flood-marked as anchored before the next BFS. A cluster of stars
therefore chains star→star→mainland with short local bridges rather than
each star running its own long one.

Complexity: each BFS terminates on first anchor contact; worst case
O(islands·pixels), in practice far less. Generation-stamped visited arrays
avoid reallocation across islands.

## 5. Vectorization (`trace.js`)

**Directed boundary edges.** For every filled/empty pixel pair we emit a
unit edge on the pixel-corner grid, oriented so material lies on the *left*
of travel. All four cases (top/bottom/left/right neighbor) get a consistent
direction, which makes outer contours and holes wind opposite ways and makes
chaining unambiguous.

**Chaining.** Edges are stored per corner as a 4-bit direction mask and
walked head-to-tail. At checkerboard saddle corners two edges leave the same
point; we always take the **left-most turn**, which keeps diagonally-touching
regions as two clean loops instead of a self-intersecting figure-eight.
Collinear runs collapse immediately, so a rectangle is 4 points before any
simplification.

**Simplification & smoothing.** Closed loops are split at their two most
distant points and each half runs **Ramer–Douglas–Peucker** (ε ≈ 0.8 px).
*Smooth* corner style then applies two rounds of **Chaikin corner cutting**
(¼–¾ subdivision), which converges toward a quadratic B-spline — the organic
paper-cut look, and kinder to acrylic than sharp interior corners.

## 6. SVG export (`svgout.js`)

Millimetre units end-to-end (`width="322mm" viewBox="0 0 322 254"`), so
LightBurn/RDWorks import at true scale. Laser color convention: **red
#FF0000 at 0.1 mm = cut**, **blue = score** (the layer label). The frame
rect, artwork contours (translated by the margin), and four corner
registration holes are all in the cut group. The proof SVG stacks all
sheets as filled `evenodd` paths in palette colors — a printable preview.

## 7. ZIP writer (`zip.js`)

A from-scratch ZIP encoder (STORE method): local file headers, central
directory, EOCD record, CRC-32 (table-driven, poly 0xEDB88320), DOS
timestamps, UTF-8 name flag. ~120 lines replaces a CDN dependency and keeps
the whole tool functional offline in a workshop. Verified against the
standard CRC test vector in the suite.

## 8. Stack preview (`preview.js`)

Each sheet rasterizes once into a tinted offscreen canvas. Per frame the
sheets composite back→front with a parallax offset proportional to
(sheetIndex − center)·tilt, plus per-sheet drop shadows; pointer drag eases
the tilt target, an explode slider adds vertical separation, and the bridges
overlay draws on top. Rendering skips entirely when the pose is settled and
nothing is dirty, so idle CPU cost is ~zero.
