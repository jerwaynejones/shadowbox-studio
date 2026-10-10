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

**Fabrication pitch (mm/px).** The size of one pixel of the cut raster on the
material (default 0.1 mm/px). The export, and the fabrication preview, run at
this pitch, limited by the device's pixel budget and by the source's own
pixels (the dimension bar shows the real mm/px, the raster size and any
shortfall). The on-screen draft runs at a fixed, measured size (720 px on the
long side) so edits stay interactive; it is labelled **Draft (approximate)**.

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

**Alignment guides (bonded relief).** Bonded sheets are aligned by scored
guides, not holes: on each sheet the laser scores the outline of the next
sheet's parts, inset so the score line is hidden once that next sheet is glued
on. *Inset outline* (the plywood default) gives position and rotation;
*Interior mark* scores a small cross per part (position only); *None* turns
them off. *Conceal inset* (0.5 mm) and *Placement allowance* (0.5 mm) keep the
score line that far inside the covering part; *Score line width* (0.2 mm) is
the burn width; *Sheet number height* (3 mm) sizes the scored sheet number,
placed in a hidden area of every sheet except the top one. The Layers cards
show the guides as blue lines (*Show guides*); on a draft they are approximate,
the fabrication preview shows the exact ones. The Proof never shows them: they
are hidden in the finished piece.

**GUIDE_OMITTED.** A part too small or too thin to hide a score line under it
gets no guide: place that part by the placement map (`placement_map.svg` in
the export, one panel per glue step with every part ID; parts without a
guide are outlined red). The same warning appears when a sheet number does
not fit; the map names that sheet too.

**Preview at fabrication resolution.** The button in the Review stage runs
the exact fabrication generate (the same request and geometry hash as the
export) and shows it in Proof, Section, Layers, Tilt and the diagnostics,
together with the Fabrication review. It can take several seconds on a large
image and the page does not respond meanwhile (a busy note says how long to
expect). Use it to judge fine detail, the exact guides and the fabrication
diagnostics: the draft approximates the cut, the fabrication preview is the
cut. Any geometry edit returns the views to the draft (marked Stale until it
updates). A source smaller than the fabrication raster is reported at load and
in the draft's "Fabrication resolution" group (`FAB_EXCEEDS_SOURCE`, with the
pixel shortfall), and a draft whose layers would exceed the device caps at
fabrication shows `FAB_COMPLEXITY_LIKELY`.

**Clips at fabrication.** A "Clip to lower layer" repair accepted on the draft
is replayed at fabrication and listed in the Fabrication review as
`REPAIR_REVIEW_FAB` with **Show** (the clipped region on the fabrication
result), **Keep** (accept it for this fabrication result) and **Revert**. A
clip whose settings changed afterwards is `REPAIR_STALE` and is reviewed again
from the draft.

## Step 4 — Export

One ZIP: `sheet_NN.svg` per layer (RED = cut, BLUE = score label),
`proof.svg` color preview, `ASSEMBLY.md`, `preview.png`, `settings.json`,
and for bonded relief `placement_map.svg` (the glue-up order with part IDs;
print it, do not cut it).
Import SVGs at 1:1 into LightBurn/RDWorks — they carry mm units.

**Two clicks.** Download delivers only a fabrication result that is on
screen. If the draft is shown, the first click runs (or reuses) the
fabrication generate, shows it and opens the Fabrication review ("Review the
fabrication result, then Download"); acknowledge its warnings and click
Download again. Blocking issues disable Download with the reason.

`ASSEMBLY.md` is written from the exported fabrication result. For bonded
relief it lists only the exported sheets (role base, layer or top) and the
omitted empty layers, the glue-up order (sheet 1 front face up, each next
sheet onto the scored outlines of the one below, front face up, never
mirrored), what the guides and the scored sheet numbers mean, the machine
profile and the kerf note (no kerf offset applied; set the kerf in your laser
software). It gives no speed or power settings. Its short geometry hash
matches the Fabrication review and `settings.json`.

`settings.json` keeps the v1.1 settings and adds a `project` block (modes,
thickness, fabrication pitch, raster, geometry hash, engine version).
Re-importing it is **lossy**: only the v1.1 settings are read, so the import
is always an acrylic connected-sheet project (a bonded relief comes back as
connected sheets) and an info notice `LEGACY_PROJECT_BLOCK` says so. The full
round trip will be the `.sbrproj` project file (G3.8).

**Blocking and non-blocking checks (alpha.5).** A neck narrower than the laser kerf (`NECK_KERF`) blocks the export
at draft and fabrication and has no repair action: widen the art, raise the minimum feature size, or accept that the
export stays blocked. Two bonded parts that touch only at a corner (`PART_POINT_CONTACT`) are a warning: the pieces
separate when cut and both stay supported, so acknowledge it. Necks are outlined in the preview where they are.

**Acknowledge all.** When many warnings share one code, one row shows the count ("n necks (m parts)") with a jump
control for each location, and "Acknowledge all" acknowledges every warning of that code after a confirmation. It never
touches blocking items. Each item is listed once: while the fabrication review is open, the Proof panel shows counts
only.

**Match pitch to source.** When the fabrication pitch asks for more pixels than the photo has, the pitch row offers
"Match pitch to source": it sets the largest pitch whose raster equals the photo (within 15 % of your pitch), so
nothing is resampled.

## Glue-up (bonded relief)

1. Lay sheet 1 (the base) front face up. Its scored outlines show where the
   parts of sheet 2 go; its scored number says it is sheet 1.
2. Glue each next sheet onto the scored outlines of the one below, front face
   up, never mirrored. The outline is inset under the part, so it disappears
   once the part is in place; with *Interior mark* guides, centre the part on
   its cross and set the rotation by eye or by the placement map.
3. Parts listed under `GUIDE_OMITTED` have no guide: place them by
   `placement_map.svg`, which shows every glue step with part IDs.
4. The top sheet carries no number (it has no hidden area); the placement map
   names it.

## Reading the preview

- **Drag** the stack to tilt it; the parallax shows the physical depth.
- **Explode** spreads sheets apart to inspect individual layers.
- **Amber** = bridge material the tool added (connected sheets only; bonded
  relief never has bridges). Every structural fix is visible before you
  commit material to it.
- The status line starts with **Draft (approximate; …)** for the draft, or
  the short geometry hash for a fabrication result, and reports the raster,
  sheets and time (connected sheets: islands bridged/culled and cut length).
- Every view (Proof, Section, Layers, Tilt) comes from the same generate as
  the cut files: the draft at the draft raster, the fabrication preview at the
  fabrication raster.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sheets look noisy, hundreds of islands | Raise cartoon smoothing and/or cull threshold; reduce sheets |
| Important detail disappeared | Lower min feature or cull threshold; check it in Preview at fabrication resolution (the draft is coarser) |
| A bridge crosses an ugly spot | Nudge bridge width / cull threshold — bridges re-route on recompute |
| Thin parts break after cutting | Raise min feature; consider thicker acrylic |
| Holes tight on dowels | Add kerf compensation in your laser software, or bump hole diameter |
| Slow on phone, or the page stops responding | Drafts and the fabrication preview run on the main thread until the worker pool (G4.1); mobile is limited to simpler art |
