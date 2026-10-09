# alpha.3 browser verification (2026-10-09)

This run checks the alpha.3 preview fix end to end in headless Chromium 152, which `tools/verify_alpha3.mjs` drives
over CDP. The script uses no npm packages. It serves the repo with `python3 http.server` on a free 127.0.0.1 port
and kills the server when it finishes. It also uses `unzip` and ImageMagick (for the crops only). `report.json`
holds the raw data: every `generate` run, the diagnostics counts and per-check evidence.

**Source.** `tools/alpha3_scene.js` generates a deterministic colour scene at 3600 × 2700 px (`scene_thumb.png`,
sha256 `889a6c87…3396`). The scene has fine detail: wires, lit windows, a picket fence, a crescent moon, branches,
grass and stars.
**Settings.** These were set through the real controls: xTool S1 + feeder, Plywood preset, Bonded relief, size by
height 300 mm, pitch 0.1 mm/px and 8 sheets. On load the app switched to Tonal automatically, as designed. The page
is 400 × 300 mm.

| # | Check | Result |
|---|---|---|
| 1 | No bridges in the bonded previews | **PASS**. The draft (720 × 540) and the fabrication run (3600 × 2700) are both `bonded-relief` with 0 bridged and 0 culled. The status line and cards carry no bridge text, and "Show bridges" is hidden. For contrast, alpha.2 with the same settings: "54 bridged · 56 culled" (`a2_draft_proof.png`, `crop_tree_wires.png`). |
| 2 | Fabrication preview hashes equal the export | **PASS**. The export reused the same snapshot object: one fabrication `generate` in total and 0 during export. The geometryHash `98325803bac9…` is the same in the status line, in `settings.json` (`geometryHash` and `project.geometryHash`) and in `ASSEMBLY.md`. Every `sheet_NN.svg` was re-parsed with SBSvgRead and its `layerHash` rebuilt, and all 8 of 8 equal the previewed layer hashes. |
| 3 | Draft edges visibly better than the alpha.2 720 px draft | **FAIL (as stated).** The alpha.3 draft is also 720 × 540 px at 0.56 mm/px: E4 kept `draftPx` at 720, see `docs/perf/DRAFT.md`. Edges show the same pixel staircase (`crop_*.png`). The draft is more faithful, but its edges are not finer: no bridges, the dark crescent moon and the tree canopy are kept, and the windows are shown. The fabrication preview (0.111 mm/px, 38,584 vs 10,002 vertices) is where edge resolution improves. |
| 4 | Source warnings at load | **PASS**. When the file loads, `#why-source` shows the colour → Tonal notice and `FAB_EXCEEDS_SOURCE`: 3600 × 2700 px is 400 × 300 px short of 4000 × 3000. The draft panel lists the same warning first, under "Fabrication resolution" (`a3_load_source_notes.png`, `a3_draft_diagnostics.png`). |
| 5 | Guides and labels on bonded sheets (Appendix E) | **PASS**. The guides are `inset-outline`. Sheets 1–7 carry SCORE paths (26, 29, 34, 33, 36, 48, 48) and scored numbers "1"–"7" (stroke paths, no `<text>`). The top sheet has none. `placement_map.svg` is present. There is no `GUIDE_UNCONTAINED`, and an independent `SBGuides.validate` on the layers rebuilt from the exported SVGs is clean. There are 38 `GUIDE_OMITTED` warnings (small parts, on the placement map). The cards legend reads "approximate at draft" on the draft and "scored, hidden under the next sheet" on the fabrication result. |
| 6 | A clip accepted on the draft is re-reviewed at fab and does not hard-block | **PASS, on an instrumented fixture.** The 300 mm scene raises no `BOND_UNSUPPORTED`: bonded layers are raw lattice contours of nested masks (D1/D-4.5), so "Clip to lower layer…" is never offered on it. The clip flow was therefore run on the AT-09 crescent fixture with the test hook (`TEST_HOOKS`, `debug.smoothBonded` on both requests). The fixture also needs `minFeatureMM 0`, `holeMM2 0` and smooth corners, which were set through the debugger. After that, every step was the real UI: Clip to lower layer… → Accept clip → Preview at fabrication resolution. The fabrication review then showed `REPAIR_REVIEW_FAB` (warning) with Show, Revert and "Keep this clip at fabrication resolution", and no `REPAIR_STALE`. Export said "Acknowledge 16 warnings", with no blocking items. After Keep and the acknowledgements, Download delivered the ZIP (`c_*.png`). |

**Other observations**
- The draft panel lists 1 **blocking** `SAMPLING_LOW`: a 1.5 mm minimum feature at 0.56 mm/px is 2.7 samples, and 3 are needed. This is draft-only; the fabrication result has none.
- The fabrication preview took 23.4 s on the main thread for 9.7 Mpx; the draft took 2.6 s.
- The run threw no page exceptions.

**Screenshots** (1440 × 900):
- Draft: `a3_draft_{proof,section,layers,tilt}.png`
- Fabrication preview: `a3_fab_{proof,section,layers,tilt}.png`
- Panels: `a3_load_source_notes.png`, `a3_draft_diagnostics.png`, `a3_fab_review.png`
- alpha.2: `a2_draft_{proof,layers}.png`
- Crops (alpha.2 draft | alpha.3 draft | alpha.3 fabrication, device scale 2, Midnight palette): `crop_{moon,city,tree_wires,fence}.png`
- Clip flow: `c_draft_bond_unsupported.png`, `c_clip_dialog.png`, `c_fab_review_repair.png`, `c_fab_show_clip.png`

**Reproduce:** `node tools/verify_alpha3.mjs [--out <dir>]`. The default output directory is this one, and a run overwrites it.
