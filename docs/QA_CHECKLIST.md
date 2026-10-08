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
      Generation has no separate button yet (it runs on every change once a source exists, and
      `regenerate()` refuses without one); G2.11b adds the staged Generate control under the same
      guard (`SBSchema.canGenerate`).
- [ ] After a photo or the demo is loaded, Export is enabled and the reason text is hidden.
- [ ] Changing a slider regenerates as before (v1.1.0 behaviour); changing the palette only
      recolours the preview and the chips.
