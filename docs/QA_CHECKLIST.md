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
- [ ] Changing a slider regenerates as before (v1.1.0 behaviour); changing the palette only
      recolours the preview and the chips.

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
