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
