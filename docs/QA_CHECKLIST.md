# Manual QA checklist

Browser checks that the Node suite cannot cover. Run them on `index.html` (served locally) and on
`dist/shadowbox-studio.html` (opened from disk) before each release. Each item names the task
that added it.

## Start-up and source (PRJ-01, G2.11a)

- [ ] The app opens empty: no demo scene loads, the stack preview and the "Layer sheets" grid are
      empty, and the status line reads "Choose a source: load a photo or the Demo scene".
- [ ] **Demo scene** is an explicit source button. Clicking it loads the procedural night scene and
      generates the sheets; nothing else loads it.
- [ ] Before a source is chosen, Export ("Download cut files (.zip)") is disabled and the text
      "Choose a source" shows under it (also announced through `aria-describedby`).
      The Review stage's **Generate** button is disabled with the same "Choose a source" reason
      (G2.11b; same guard, `SBSchema.canGenerate`). Generation also runs on every change once a
      source exists, and `regenerate()` refuses without one.
- [ ] After a photo or the demo is loaded, Export is enabled and the reason text is hidden.
- [ ] Releasing a slider regenerates once (alpha.3 E5: the value follows the drag, the draft runs on
      release); changing the palette only recolours the preview and the chips.

## Stages and ranges (UI-01, PO-LASER-4, LYR-01, G2.11b)

- [ ] The rail shows five stages in order: 1 Source, 2 Interpretation, 3 Construction, 4 Review,
      5 Export.
- [ ] Keyboard only: after the title block, Tab reaches the five stage links first, in order; Enter on
      a link scrolls to that stage and moves focus to it (visible outline), and the next Tab enters
      that stage's first control. Tabbing on walks every stage's controls in stage order.
- [ ] "Fabrication pitch (mm/px)" is a number field showing 0.1; arrows step by 0.01 between 0.05
      and 2. Typing 0.25 updates the read-out to "0.25 mm/px"; typing 0.01 or 9 is clamped to
      0.05 / 2; clearing the field and leaving it restores the last valid pitch. There is no
      "Working resolution" control.
- [ ] The Sheets slider goes from 1 to 16; the preview and the "Layer sheets" grid follow at 1 and 16.
- [ ] After a source is loaded, Generate is enabled and its reason text is hidden; clicking it
      regenerates.

## Control groups, dimension bar and disclaimers (LYR-01/02, MAT-01/02/04, PO-LASER-1/2/3/4/5/8, G2.11c)

- [ ] Construction shows four labelled groups: Size (units, size by Height/Width, finished size, frame
      ring), Material (thickness with the "1/4\" ply often measures 5.5–6 mm" hint, nominal/measured,
      gap), Fabrication (pitch and the cleanup controls) and Machine ("xTool S1 + feeder" preselected,
      None, and the five editable limits). Choosing None disables the limit fields.
- [ ] Switching Units to Inches re-displays every length field and the dimension bar in inches; the
      pitch stays in mm/px.
- [ ] Before a source, the dimension bar reads "5 requested · exported count after generation", an
      estimated max Z / base / relief, "choose a source to plan the fabrication raster", and the
      MAT-01 stock disclaimer. After the Demo scene it shows "5 exported", the real mm/px next to the
      0.1 mm/px target, the raster W × H and Mpx, and the source shortfall in px.
- [ ] A finished size whose page exceeds the machine reads "too large by … mm for xTool S1 + feeder";
      Thresholds opens with the keyboard (Enter on the summary) and lists every boundary as a
      normalized value and in mm.
- [ ] Review shows Appearance (uniform colour / palette proof), the stock colour and the MAT-04
      palette disclaimer; changing them or the Explode slider recolours or moves the preview without
      regenerating.

## Applicability and disabled-with-reason controls (UI-01, §9.5, D1, G2.11d)

- [ ] With Construction = Bonded relief, Bridge width, Max bridge reach, Gap between sheets and Corner
      style are dimmed and disabled, each with a short reason under it; a screen reader announces
      the reason as the control's description. Cull islands stays enabled and "Remove parts under the
      cull size (bonded opt-in)" can be ticked.
- [ ] Switching a framed connected project to Bonded relief sets the Frame ring slider to 0 and keeps
      the finished size.
- [ ] With Connected sheets, Gap and the bridge controls are enabled with no reason shown; the bonded
      cull opt-in is disabled with its reason.
- [ ] Read the image as Height disables Tone split, Manual thresholds and the smoothing sliders with a
      reason; Manual thresholds is otherwise enabled only with the Manual tone split. Laser profile
      None disables the five limits; Registration holes off disables Hole diameter.

## Opaque proof, section and tilt (UI-02/03, MAT-04, AT-11, G2.12)

- [ ] After Demo scene the tabs read Proof, Section, Layers, Tilt (illustrative), and Proof is selected.
- [ ] Proof lines up with `proof.svg` from the export (frame, registration holes and every layer edge
      in the same place); edges are crisp (no blur), with no drop shadows and no offset between layers.
- [ ] Uniform appearance: each layer edge has a thin darker outline in Proof.
- [ ] Section shows one band per layer at the material thickness, separated by the gap in Connected
      mode and touching in Bonded relief; the callout reads the same t and g as the controls; dragging
      up and down moves the line.
- [ ] Tilt shows "Illustrative: not to scale"; Explode spreads the layers and does not change the
      exported files; Explode and Show bridges are only shown on Tilt.
- [ ] After a slider is released the previous result stays visible, dimmed, with "Updating draft…" and the
      Processing badge; then Proof, Section, Layers and Tilt update together (alpha.3 E5; no raster interim).
- [ ] Section shows a width dimension line under the bands, a height dimension line on the left, and
      an amber mark on the page gauge at the right that follows the drag.
- [ ] Export from the Section tab: `preview.png` in the ZIP is the proof, not the section chart.

## Real-engine draft (PO-PREVIEW-1, LYR-06, UI-05, alpha.3 E5)

- [ ] Bonded preview on a colour 4096 × 3084 PNG shows no amber/dark bridge lines; Layers cards say base/top; a slider
      drag regenerates once on release.
- [ ] The status line starts with "Draft (approximate; …)" and names the draft raster, mm/px, sheets and seconds; in
      Connected sheets it adds the bridged/culled counts and the cut length.
- [ ] Switch Construction to Connected sheets: the Layers cards say backing/mid/front, sheet 1 reads "solid panel —
      frame + holes only", and Tilt shows the amber bridges (Show bridges on).
- [ ] Edit a setting and look at Section before the draft lands: the stale bands keep the old result's thickness
      and gap (they are the shown result's, not the edited project's).
- [ ] Turn on the Changes overlay in Proof: the draft is rebuilt once with the added/removed outlines (same
      acknowledgements); with the overlay off the draft skips them.
- [ ] Raise Sheets until a draft hits COMPLEXITY_LIMIT: the previous picture stays, the status line says the previous
      result is still shown, and Diagnostics reads "No layers: COMPLEXITY_LIMIT…" with the cap items listed.

## Fabrication preview and delivery (PO-PREVIEW-2, LYR-06, UI-06, alpha.3 E6)

Use a 4096 × 3084 colour PNG under Plywood (bonded) unless a step says otherwise.

- [ ] Click **Preview at fabrication resolution**: the busy note names the raster, the pitch and an estimate in
      seconds, and the Processing badge and veil are painted before the page stops responding. Proof, Section,
      Layers, Tilt and the diagnostics panel then switch to the fabrication result; the status line shows the
      short geometry hash, and the Fabrication review header shows the same hash, the raster and the time.
- [ ] Edit any geometry setting: the views return to the draft, marked Stale until it lands, and the button is
      offered again. Click the button and then edit before it finishes: the fabrication result of the old
      revision is never shown over the new one.
- [ ] With a (stale) draft on screen click **Download**: the fabrication result appears, the Fabrication review
      opens with "Review the fabrication result, then Download", and nothing downloads until the second click.
- [ ] Turn the Changes overlay on and focus a diagnostic, then Download: `preview.png` in the ZIP has no overlay
      and no highlight, and both are back on screen afterwards. The ZIP's `settings.json` and `ASSEMBLY.md` carry
      the hash shown in the review.

## Presets and colour sources (PO-PREVIEW-3, alpha.3 E7)

- [ ] The app starts on Plywood (bonded). Loading the colour PNG shows "Colour image: using Tonal" under the
      Source buttons and generates a tonal bonded draft; a gray PNG (or an RGB PNG with equal channels) stays
      Height with no notice.
- [ ] Changing the preset opens the review dialog listing every value it replaces; Cancel changes nothing.

## Source resolution up front (PO-PREVIEW-4, alpha.3 E8)

- [ ] With the finished height set to 470 mm, loading the 4096 × 3084 PNG shows `FAB_EXCEEDS_SOURCE` with the px
      shortfall under the Source buttons, and the draft's diagnostics panel lists it in a "Fabrication resolution"
      group without an Acknowledge checkbox; the Fabrication review offers the checkbox.

## Guides and sheet labels (PO-PREVIEW-5, ASM-01/02/03/05, alpha.3 E11)

- [ ] In Plywood (bonded), the Layers cards show blue inset outlines (Show guides on) with the "approximate at
      draft" legend; Proof, Section and Tilt never show them. In the fabrication preview the cards show the exact
      guides without the legend.
- [ ] Every sheet except the top one has a scored sheet number in a hidden area; Guides = Interior mark shows
      crosses instead of outlines; Guides = None removes them and disables the distance fields.
- [ ] A design with tiny or crescent upper parts lists one aggregated `GUIDE_OMITTED` warning per layer, and those
      parts are outlined red in `placement_map.svg` (ZIP root, one panel per glue step, part IDs as text).
- [ ] Import a `sheet_NN.svg` into LightBurn: guides and the number are on the blue SCORE layer, cuts on the red
      CUT layer, no text objects.
- [ ] Connected sheets: no guides, no `placement_map.svg`, the sheet label is unchanged from alpha.2.

## Clips re-reviewed at fabrication (PO-PREVIEW-6, SUP-04, alpha.3 E12)

- [ ] Accept "Clip to lower layer…" on the draft, then Preview at fabrication resolution: the Fabrication review
      lists `REPAIR_REVIEW_FAB` (a warning, never `REPAIR_STALE`) with Show, Keep and Revert. Show highlights the
      clipped region on the fabrication result; Keep acknowledges it and Download then delivers; Revert removes
      the clip and the views return to the draft.
- [ ] Reload the identical file: the clip stays valid. Change a setting or load a different file: the clip is
      `REPAIR_STALE` and its link opens the draft clip dialog.
