# Shadowbox Studio — user guide

Every control, what it does physically, and how to troubleshoot a result.

## Step 1 — Photo

**Presets and colour images.** The Preset select sets every setting at once:
**Plywood (bonded relief)**, the default, glues the layers face to face, reads
the image as a height map and aligns the layers with concealed scored guides
(inset outlines); **Acrylic (connected sheets)** stacks tonal sheets on
spacers. Changing the preset lists every value it will replace in a review
dialog first; the title, the loaded image, the units and the machine are kept.
Height mode needs a grayscale height map (an 8-bit gray PNG, or an RGB PNG
whose three channels are equal). When you load a colour image under a height
preset (a JPEG, a colour palette PNG or a colour PNG), the app switches the
reading to **Tonal** (light tones in front, 1.65 mm smoothing, the construction
is kept) and says so under the Source buttons: "Colour image: using Tonal". To
read it differently, change **Read the image as** under Interpretation; a
grayscale height map loads as Height without any switch. Paper/card is not a
preset yet.

**Load photo / Demo scene.** Any image works, but the craft favors photos with
a clear subject and readable tonal separation: silhouettes at dusk, a bird
against sky, a landscape with distinct planes. The demo scene is a procedural
night landscape you can use to explore every control instantly.

**Working resolution (360–1280 px).** The size of the raster the pipeline
runs at. Higher = finer detail and slower recompute. 720 px is a good
default; go higher only for large artwork (400 mm+) with fine detail.

**Cartoon smoothing (0–5 mm) and passes (1–3).** The Kuwahara filter radius.
This flattens texture into paint-like patches while keeping edges — the
"cartoonize" step. Bigger radius / more passes = bolder, simpler shapes and
far fewer islands to fix. If your layer sheets look like noise, raise this
first.
Smoothing is in millimetres; draft and fabrication smooth the same physical
size (the radius is converted to pixels for each raster, so the draft
approximates the cut geometry). The Acrylic default is 1.65 mm (the old radius
4 at the 720 px draft on a 300 mm piece); Plywood height maps are not smoothed.
Smoothing radii in older settings files are converted from pixels at the v1.1
720 px pitch.

## Step 2 — Layers

**Sheets (3–8).** How many acrylic sheets in the stack, including the solid
backing. Five reads beautifully and keeps material cost sane. More sheets =
smoother tonal ramp but more cutting and more bridges.

**Tone split.**
- *Balanced areas* — each sheet gets roughly equal pixel area. Best default;
  every layer carries visual weight.
- *Even brightness steps* — thresholds evenly spaced in brightness. Better
  for images with deliberate high-key/low-key lighting.

**Dark tones in front.** On (default): the darkest band is the frontmost,
smallest sheet — the classic layered-art look where dark outlines sit on top.
Off: light tones come forward instead; try it for snow scenes or high-key
portraits.

**Acrylic palette.** Suggested sheet colors, used in the preview and the
proof SVG. This is a *suggestion* — the SVGs are geometry only, so cut from
whatever acrylic you have. Chips under the selector show the exact per-sheet
colors.

## Step 3 — Fabrication

All values are real millimetres on the laser bed.

**Artwork width (100–600 mm).** Height follows the photo's aspect ratio.
Note this interacts with everything below: the same photo at 150 mm needs
bolder simplification than at 450 mm because features shrink physically.

**Frame ring (0–30 mm).** Welds the artwork into a solid border on every
sheet. Anything touching the image edge is then genuinely anchored. Set to 0
for frameless pieces — the largest region becomes the anchor instead, and
you glue free pieces to the backing by hand.

**Min feature (0.6–3 mm).** The narrowest strip of acrylic allowed to
survive. Features thinner than this are removed before cutting (they'd snap
or burn). 1.2 mm suits 3 mm cast acrylic; go bigger for brittle materials.

**Bridge width (0.8–4 mm).** Width of the connecting corridors added to
islands. Wider is stronger but more visible. 1.8 mm is sturdy and subtle at
typical sizes.

**Cull islands under (mm²).** Islands smaller than this are deleted rather
than bridged. Raise it to declutter starry skies; lower it to keep every
speck (each one costs a bridge or falls out).

**Max bridge reach (mm).** An island farther than this from any anchor gets
culled instead of trailing a long bridge across the artwork.

**Registration holes + diameter.** Four holes in the frame corners, on every
sheet at identical positions. Run dowels or bolts through them and the stack
self-aligns. 4 mm suits common bamboo dowels; measure yours.

**Corner style.** *Smooth* rounds contours (paper-cut look, kind to acrylic).
*Faceted* keeps crisp polygonal corners.

## Step 4 — Export

One ZIP: `sheet_NN.svg` per layer (RED = cut, BLUE = score label),
`proof.svg` color preview, `ASSEMBLY.md`, `preview.png`, `settings.json`.
Import SVGs at 1:1 into LightBurn/RDWorks — they carry mm units.

## Reading the preview

- **Drag** the stack to tilt it; the parallax shows the physical depth.
- **Explode** spreads sheets apart to inspect individual layers.
- **Amber** = bridge material the tool added. Every structural fix is
  visible before you commit acrylic to it.
- The status bar reports islands bridged/culled and total cut length.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sheets look noisy, hundreds of islands | Raise cartoon smoothing and/or cull threshold; reduce sheets |
| Important detail disappeared | Lower min feature or cull threshold; raise working resolution |
| A bridge crosses an ugly spot | Nudge bridge width / cull threshold — bridges re-route on recompute |
| Thin parts break after cutting | Raise min feature; consider thicker acrylic |
| Holes tight on dowels | Add kerf compensation in your laser software, or bump hole diameter |
| Slow on phone | Lower working resolution while composing; raise it for final export |
