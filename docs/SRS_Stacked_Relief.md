# Shadowbox Studio: Stacked Relief
## Software Requirements Specification

**Version:** 1.0  
**Date:** October 6, 2026  
**Status:** Proposed implementation baseline  
**Primary application:** Laser-cut, bonded relief artwork made from nominal 1/4-inch plywood  
**Decision:** Fork and extend the shared geometry engine; do not rebuild the application around material transparency.

This specification defines a locally processed, self-hostable extension of Shadowbox Studio. It turns a tonal image or authored grayscale height map into validated material layers, cut paths, placement guides, and assembly instructions. The first release prioritizes physical correctness and repeatability over new rendering effects or AI integrations.

**Document authority.** Sections 4 through 11 define the v1.0 requirements. Section 12 defines verification and release acceptance. Sections 13 and 14 define delivery gates, risks, and change control. A requirement marked MUST is a release obligation. Deferred features are not implied commitments.

---

# Contents

1. Product decision and optimized plan
2. Verified upstream baseline
3. Scope, users, and operating context
4. Domain model and fabrication rules
5. Functional requirements: projects and image interpretation
6. Functional requirements: layers, materials, and geometry
7. Functional requirements: support and assembly assistance
8. Functional requirements: preview and export
9. Data model and interface contracts
10. Nonfunctional requirements
11. Architecture, deployment, and compatibility
12. Verification and acceptance
13. Delivery plan and release gates
14. Risks, assumptions, and change control
15. Source register

# 1. Product decision and optimized plan

## 1.1 Product objective

Enable a maker to load an image, choose bonded plywood construction, set physical dimensions and stock thickness, review a faithful representation of the retained material, and export a reproducible fabrication package. A successful result is not merely a plausible SVG. It is a set of correctly scaled parts with known assembly order, valid support beneath every upper part, and an explicit distinction between cutting and placement marking.

The primary workflow is decorative, flat-sheet, 2.5D relief. It does not create true undercuts or machine a continuous surface. Image brightness is an artistic height signal unless the user explicitly supplies a height map. Monocular camera depth, when imported from another tool, is not automatically calibrated physical height.

## 1.2 Optimized implementation strategy

**Preserve the useful engine.** Retain the existing image preparation, cumulative layer generation, morphology utilities, contour tracing, and local packaging where characterization tests establish correct behavior. Refactor orchestration instead of creating separate image-to-SVG pipelines for acrylic and plywood.

**Separate three independent choices.** Image interpretation determines what values mean. Construction determines whether parts must connect within a sheet or bond to a lower layer. Material properties determine thickness, appearance, and fabrication warnings. A single transparent/opaque switch shall not select all three.

**Make geometry authoritative.** Establish a canonical representation of retained material, including frames and holes. Generate previews, cut paths, support checks, dimensions, and guides from that same validated representation. A preview based on an earlier raster mask is not sufficient evidence that exported cuts are correct.

**Promote fabrication validation ahead of visual polish.** Validate topology, support, frame attachment, dimensional scale, and guide containment before improving 3D appearance. Keep a dimensioned stack section and an opaque assembly proof in v1.0; defer a physically extruded interactive renderer.

**Allow loose parts deliberately.** In bonded relief, disconnected components can be legitimate parts. Keep them when they are supported, identify them, and explain how to place them. Do not reuse automatic bridge-or-delete behavior as the default plywood policy.

**Keep the first release small enough to verify.** Use uniform stock thickness, a rectangular base, nominal uncompensated SVG geometry, an 8-bit height-map path, and local static hosting. Defer shaped bases, no-base structures, mixed thickness, automatic sheet nesting, AI inference, and internal kerf compensation.

## 1.3 First-release outcome

The v1.0 release shall provide two construction modes: **Connected sheets** and **Bonded relief**. Connected sheets retain the established bridge/cull workflow, subject to corrected export validation. Bonded relief permits supported loose parts and assumes no spacer gap. Both modes use the same material geometry and export interfaces.

The primary starting preset is eight total sheets at nominal 6.35 mm thickness, including the backing. Its maximum stock-only stack height is 50.8 mm, or 2 inches. Relief above the base is at most 44.45 mm. These are nominal calculations, not assertions about the measured thickness of purchased plywood or the cured adhesive layer.

## 1.4 Explicit non-goals

The initial release does not infer depth with AI, simulate transmission through colored acrylic, drive a laser, select laser power or speed, certify a material as laser-safe, generate native LightBurn projects, perform CNC toolpath generation, optimize stock nesting, or guarantee structural strength. It does not promise that unpainted plywood reproduces the tonal appearance of a multicolor proof.

# 2. Verified upstream baseline

## 2.1 Baseline identification

The source baseline is `strondcode/shadowbox-studio`, commit `f0552c7a6ac07b857b3b9c027934ebbe8ed14535`. The inspected application declares version 1.1.0. Source references in this specification refer to that revision where applicable. [S0, S1, S3]

The baseline assessment is a source inspection. Upstream test execution, browser behavior, laser-software import, and physical fabrication are separate verification activities required by Gate G0. No source-level observation shall be treated as proof of a completed physical test.

## 2.2 Findings that change the earlier plan

| Finding | Evidence | Consequence for the extension |
|---|---|---|
| The preview already renders retained material with full alpha, while voids have zero alpha. | `preview.js`, mask rasterization. [S4] | There is no optical transparency stage to remove from the core pipeline. |
| Layer generation is cumulative and includes a solid backing. | `raster.js`, `sheetMasks`. [S2] | Reuse the layer concept; make height semantics and indexing explicit. |
| The current linear threshold mode spans histogram percentiles, not a fixed physical-height scale. | `raster.js`, `thresholds`. [S2] | Add a distinct height-map mapping rather than relabeling existing linear banding. |
| Each sheet is cleaned, bridged/culled, and smoothed separately. The orchestration has no final interlayer support pass. | `app.js`, pipeline. [S3] | Check containment after the final geometry, not only after initial masks. |
| The exporter emits an outer rectangle and artwork loops independently. | `svgout.js`, `sheetSVG`. [S5] | Verify actual frame/material union; do not assume a frame in the preview remains attached after cutting. |
| The existing preview uses 2D parallax and shadows, not measured solid extrusion. | `preview.js`, drawing routine. [S4] | Keep it illustrative; add a dimensioned section before true 3D. |
| Existing tests cover algorithms and SVG document checks, but do not establish final physical support or a cut/preview round trip. | Test source. [S7] | Add end-to-end geometry and manufacturing fixtures. |

The frame observation is a code-level correctness risk, not a report of a completed failed cut. Gate G0 shall reproduce it with an edge-touching fixture and inspect the resulting cut topology. The baseline assembly text also explicitly permits flush lamination, reinforcing that bonded relief is an extension of the existing workflow rather than a different optical process. [S3]

## 2.3 Reuse policy

Reuse is conditional on observable behavior, not on module name. Pure utility functions may remain unchanged; orchestration, export topology, project persistence, and validation require stronger contracts. Preserve the upstream license and provenance. A small, locally bundled geometry or image-decoding dependency is preferable to an unverified handwritten substitute when its license, determinism, size, and maintenance are acceptable. [S1, S11]

# 3. Scope, users, and operating context

## 3.1 Users and responsibilities

| Role | Primary responsibility |
|---|---|
| Maker / designer | Select interpretation, construction, dimensions, and acceptable artistic changes; review the proof and part list. |
| Laser operator | Confirm actual stock, calibrate the machine, inspect imported operations and scale, and conduct a test cut. |
| Maintainer | Operate the fork, manage dependencies and migrations, and publish reproducible releases. |
| Fabrication reviewer | Approve representative physical assemblies and document limits of the tested material profile. |

One person may fill several roles. There are no accounts, organizational permissions, billing features, or collaboration services in v1.0.

## 3.2 Supported workflows

**UC-01: Authored height map to bonded plywood relief.** Import an 8-bit grayscale PNG, retain raw sample values, select white-high or black-high, set dimensions and thickness, generate layers, review loose parts and support, export, and assemble from the back forward.

**UC-02: Photograph to tonal layered artwork.** Import a PNG or JPEG, select tonal interpretation, optionally smooth and rebalance bands, choose connected sheets or bonded relief, and review the result as an artistic interpretation rather than recovered scene geometry.

**UC-03: Resume and reproduce a project.** Open a saved project package, verify source hashes and schema compatibility, restore settings, regenerate under the recorded engine version, and compare canonical geometry hashes.

**UC-04: Resolve a fabrication problem.** Select a diagnostic, inspect the affected region, change settings or apply an explicit repair, review the difference, and regenerate. Export remains blocked until all blocking diagnostics are resolved.

## 3.3 Scope by release

| v1.0: required | Later extension, outside v1.0 |
|---|---|
| Tonal images and raw 8-bit height maps | AI depth inference, segmentation, and 16-bit height maps |
| Connected sheets and bonded loose-part relief | Bonded single-piece repair strategy and mixed construction |
| Uniform measured thickness and rectangular backing | Mixed thickness, shaped backing, and no-backing structures |
| Opaque proof, layer inspection, and dimensioned stack section | True extruded 3D, wood grain rendering, and optical acrylic simulation |
| Supported loose parts, inset guides, and vector part IDs | Transfer-jig generation and automatic tab systems |
| Nominal SVG, explicit operations, and external kerf workflow | Internal kerf offsets, native machine formats, and stock nesting |
| Local project packages and static self-hosting | Accounts, cloud storage, remote inference, and team collaboration |

## 3.4 Assumed operating environment

A modern desktop browser is the primary fabrication environment. A smaller mobile envelope supports inspection, editing, and export. The production application is served over HTTPS; localhost is supported for development. Direct `file://` operation is not a v1.0 guarantee for the extended worker-based pipeline, even though the upstream tool supports direct opening. The application requires no server-side image processing, database, model server, or GPU service.

# 4. Domain model and fabrication rules

## 4.1 Terminology

**Material region** means the area physically retained after cutting. **Void** means discarded area or a hole. A **part** is a connected retained region, including any internal voids. A **layer** is a fabrication elevation and may contain multiple parts. A **sheet** in the UI means one material layer, not an optimized stock-board layout. **Base** is layer 0. **Frame** is retained material surrounding the artwork. **Guide** is a score-only placement mark, never a cut boundary.

**Nominal geometry** is the intended part outline before machine-specific kerf compensation. **Support** is geometric contact with the immediately lower assembled material. It is not a prediction of glue strength, material stiffness, or load capacity. **Final geometry** is the canonical, validated material representation after cleanup, frame and hole operations, vectorization, and any approved repair.

## 4.2 Coordinate system and units

All persisted physical values and geometry shall use millimeters. Display units may be millimeters or inches; 1 inch equals 25.4 mm. The assembly origin is the upper-left corner of the finished rectangular footprint. X increases rightward, Y downward, and Z outward toward the viewer. There is no automatic mirroring. Every file shall identify the intended front face and assembly orientation.

Artwork width and height exclude an optional frame. Finished width and height include it. All layers share one assembly coordinate system and one SVG page extent, even when a particular upper layer occupies only a small region. An SVG page rectangle is not itself a cut rectangle.

Raster-to-physical conversion shall account for both axis scales after integer raster resizing; the sampling check uses the larger physical pixel dimension. The canonical geometry grid is 0.001 mm. This is a numerical precision choice, not a claim of machine accuracy. Raster sampling uncertainty, contour approximation error, SVG serialization error, and physical cutting tolerance shall be reported separately.

## 4.3 Height-map interpretation

Let N be the total requested sheet count, including one rectangular base, and t the uniform measured sheet thickness. N is an integer from 1 through 16. Let A be the valid artwork domain and B the base footprint, with A contained in B. The normalized raw height signal h is in [0,1]. White-high uses the sample directly; black-high uses 1 minus that sample.

For N greater than 1, define the number of additional sheets at each valid point as:

```text
addedLayers(x,y) = min(N-1, floor((N-1) * h(x,y) + 0.5))
M[0]             = B
M[k]             = A intersect { addedLayers >= k }, for k = 1 ... N-1
stockHeight(x,y)  = t * (1 + addedLayers(x,y)) within A
```

This is nearest-layer quantization. At an exact midpoint, choose the higher layer. Its normalized boundaries are `(k - 0.5) / (N - 1)` for k from 1 through N-1. N=1 is a special case containing only the base. Fixed raw values shall not be automatically histogram-stretched, gamma-corrected, or clipped in height mode.

For N=5 and t=6.35 mm, normalized heights 0, 0.25, 0.5, 0.75, and 1 produce 1, 2, 3, 4, and 5 total sheets respectively. A region outside A has only the base. Nominal maximum stock height is N times t; maximum relief above the base is (N-1) times t. Actual generated maximum height depends on occupied layers. In bonded mode the intentional gap is zero. Connected-sheet mode may use a display/assembly gap g from 0 to 25 mm, default 3 mm; layer k has bottom Z = k times (t + g) and top Z = bottom Z + t. The assembled envelope of N occupied connected layers is N times t plus (N-1) times g, distinct from stock-only height. The base index is always zero.

## 4.4 Tonal interpretation

Tonal mode may retain balanced, legacy percentile-linear, and explicit manual thresholds. These redistribute image tones for artistic appearance. They shall not be described as equal physical scene-depth intervals. Both light-front and dark-front conventions are supported and shown before generation. The palette is a rendering choice, not an input to geometry.

An imported camera depth map shall be treated as an uncalibrated scalar field. Users must choose polarity and mapping. Conversion from metric depth, inverse depth, or camera distance is outside v1.0; the UI shall not silently infer it.

## 4.5 Construction invariants

In **Bonded relief**, each final upper material region shall be contained in the immediately lower material region after holes and all geometry changes. Equivalently, `Final[k] minus Final[k-1]` shall be empty on the canonical grid. Boundaries may coincide. Every upper part shall have a support relationship to the lower layer, and the resulting directed support graph shall lead to the base.

Full nominal containment is the v1.0 policy. Partial-contact overhangs are not allowed even when a maker might physically glue them. Very small support regions, thin parts, and zero alignment clearance generate additional warnings; geometric containment does not certify strength.

In **Connected sheets**, each nonempty layer shall be one connected retained part, including its frame where configured. Bridges must satisfy the configured geometry checks. Since spaced layers may intentionally overhang one another, bonded support containment is not imposed on this mode. The base remains solid except for explicit registration holes.

## 4.6 Repair rules

Geometry changes must be visible and reversible. The system may suggest clipping unsupported upper material to the finalized lower layer. It shall show removed area and changed part count before application. It shall then regenerate part identities, guides, dimensions, and diagnostics. No downstream step may quietly reintroduce unsupported geometry.

Automatic downward support expansion, hidden pillars, and reconstruction of removed height are deferred. Bonded mode shall not add bridges or delete legitimate disconnected parts merely because they are disconnected. Size-based culling is a separate, explicitly enabled policy.

## 4.7 Empty and identical layers

Identical consecutive masks represent repeated physical thickness and shall not be deduplicated. Trailing empty layers may be omitted from the cut package, but the UI shall preserve requested sheet count, identify omitted layer indices, and show the actual generated maximum height. An empty layer below a nonempty upper layer is a blocking error in bonded mode. Every exported nonempty layer keeps its original elevation index.

# 5. Functional requirements: projects and image interpretation

All requirements in Sections 5 through 8 are MUST requirements for v1.0. Each verification reference points to the acceptance scenarios in Section 12.

## 5.1 Project lifecycle

**PRJ-01 | Project creation.** The system shall create a project with explicit interpretation, construction mode, dimensions, units, sheet count, and material profile. The plywood preset shall choose bonded relief, white-high height interpretation, eight total sheets, zero gap, and nominal 6.35 mm thickness. The UI shall require source selection before generation. **Verify:** AT-01, AT-03.

**PRJ-02 | Independent mode settings.** The system shall persist interpretation, construction, and material appearance as independent fields. Changing only appearance shall not change geometry hashes. Changing a mode shall present the affected settings and preserve the original project until the change is accepted. **Verify:** AT-01, AT-21.

**PRJ-03 | Save and restore.** The system shall save a self-contained project package containing normalized source samples, applicable original source bytes, configuration, schema version, and engine identity. Reopening a supported package shall restore the editing state without requiring the source to be uploaded again. **Verify:** AT-17.

**PRJ-04 | Revision and undo.** Each geometry-affecting action shall create a monotonically increasing revision. Undo and redo shall cover at least the last 20 committed setting or repair actions within the session. A repair's source and resulting revisions shall remain traceable. **Verify:** AT-15, AT-21.

**PRJ-05 | Recovery and storage failures.** The system shall offer local recovery of the latest committed project revision after a successful autosave. Quota denial, private-mode restrictions, or write failure shall produce a persistent unsaved indicator and a manual package-download path without destroying the in-memory project. **Verify:** AT-17, AT-22.

**PRJ-06 | Schema compatibility.** Imports shall validate schema and data limits before replacing the current project. Supported older schemas shall migrate explicitly and preserve a copy of the original settings. Unknown newer major schemas shall be rejected with an actionable message rather than guessed. **Verify:** AT-17, AT-22.

## 5.2 Source handling

**IMG-01 | Supported formats.** Tonal mode shall accept static PNG and JPEG. Height mode shall accept static 8-bit grayscale PNG or 8-bit PNG with equal RGB channels. Unsupported precision, animation, corruption, or format shall be rejected explicitly. No silent 16-bit-to-8-bit conversion is permitted. **Verify:** AT-02, AT-22.

**IMG-02 | Numerical height fidelity.** Height mode shall read raw encoded channel samples, preserving 0 through 255 without display-color transforms or automatic contrast operations. It shall record the decoding policy and source sample hash. Color-managed display may affect the thumbnail but not the interpreted numeric height. **Verify:** AT-02, AT-03.

**IMG-03 | Image preparation.** Tonal mode shall provide smoothing, tone distribution, and polarity controls. Height mode shall default to no smoothing and fixed raw range. Any optional filtering or range remapping in height mode shall require an explicit action and appear in project history and the manifest. **Verify:** AT-02, AT-04.

**IMG-04 | Valid artwork domain.** PNG alpha may define A using a recorded threshold, default 0.5. The system shall offer a full-image domain as an alternative. Values outside A shall not influence height thresholds or geometry. The rectangular base remains present outside A. **Verify:** AT-05.

**IMG-05 | Orientation and aspect ratio.** Import shall normalize supported image orientation exactly once and record the transform. Width and height shall preserve aspect ratio by default. Rotation and mirroring shall be explicit operations reflected identically in preview, guides, and export. **Verify:** AT-05, AT-12.

**IMG-06 | Flat and low-range inputs.** A constant image shall produce a well-defined layer count without division by zero. Duplicate tonal thresholds and empty bands shall be surfaced. The system shall never invent gradients or silently stretch a flat height map. **Verify:** AT-04.

**IMG-07 | Input limits.** The system shall inspect encoded dimensions and package metadata before expensive processing. The desktop envelope is up to 25 MiB and 16 megapixels per source; the mobile envelope is up to 10 MiB and 8 megapixels. Over-limit input shall be rejected or require explicit downsampling, never silent reduction. **Verify:** AT-22, AT-24.

# 6. Functional requirements: layers, materials, and geometry

## 6.1 Layer generation

**LYR-01 | Sheet accounting.** The system shall use a total count of 1 through 16 sheets, including the base. It shall display requested count, nonempty exported count, maximum occupied elevation, base thickness, and relief above the base separately. **Verify:** AT-03, AT-04.

**LYR-02 | Height quantization.** Height mode shall implement the nearest-layer rule and midpoint tie behavior in Section 4.3. Thresholds shall be displayed in normalized values and physical relief increments. **Verify:** AT-03.

**LYR-03 | Tonal bands.** Tonal mode shall support balanced, legacy percentile-linear, and manual ordered thresholds. Invalid manual ordering shall be rejected. Legacy projects shall retain their recorded interpretation rather than being converted to height semantics. **Verify:** AT-04, AT-21.

**LYR-04 | Base and frame.** Bonded relief shall use a rectangular base without an added frame by default. Connected sheets may include a rectangular frame. Frames shall be part of canonical retained material, not a decorative preview or an independent rectangle assumed to be attached. **Verify:** AT-06, AT-07.

**LYR-05 | Repeated and empty layers.** Identical masks shall remain separate physical layers. Trailing empty layers shall follow Section 4.7. The system shall block any bonded stack containing a nonempty layer over an empty immediate predecessor. **Verify:** AT-04, AT-08.

**LYR-06 | Final-resolution generation.** Draft and fabrication quality shall be distinct states. Export shall regenerate at the selected fabrication resolution, normally 1536 pixels on the long side and configurable up to 4096 within resource limits. Final validation shall never reuse only draft-resolution diagnostics. **Verify:** AT-10, AT-15, AT-24.

## 6.2 Materials and physical dimensions

**MAT-01 | Thickness.** The system shall support one positive uniform thickness per project and distinguish nominal from user-measured thickness. The displayed stock-only height shall use the configured value. Adhesive films and surface finishes shall be explicitly excluded from that calculation in v1.0. **Verify:** AT-01, AT-03.

**MAT-02 | Dimension validation.** Artwork dimensions shall be positive and within the application range of 1 to 2000 mm per axis; stock thickness shall be 0.1 to 25 mm. These are application limits, not laser capability claims. Unit changes shall not change physical geometry. **Verify:** AT-01, AT-12.

**MAT-03 | Calibration state.** The initial plywood profile shall be marked uncalibrated. Its starting geometry settings are 3 mm minimum feature width and 25 square mm minimum loose-part area, both editable. The UI shall describe them as provisional design filters, not safe cutting or strength guarantees. **Verify:** AT-10, AT-19.

**MAT-04 | Material appearance.** The system shall provide uniform opaque color and per-layer palette proofs. It shall explain that palette shading is not necessarily the appearance of unpainted stock. Appearance-only parameters shall not affect retained geometry. Physical transmission simulation is unavailable in v1.0. **Verify:** AT-01, AT-11.

**MAT-05 | Kerf responsibility.** v1.0 shall export nominal part geometry with `kerfMode=external`. The manifest and assembly guide shall state that no kerf offset was applied. A recorded calibration value is informational and shall not silently move toolpaths. **Verify:** AT-12, AT-19.

**MAT-06 | Calibration coupon.** The system shall provide an optional, separately labeled coupon with known outer dimensions, representative holes, narrow-web features, and sample score marks. The coupon shall contain no assumed laser settings. Users shall record measured results and the material/machine context manually. **Verify:** AT-19, AT-25.

## 6.3 Canonical geometry and validation

**GEO-01 | Retained-material authority.** The system shall represent each final layer as explicit material polygons with holes. All final previews, cut boundaries, dimensions, support relations, and guides shall derive from this representation. It shall preserve the distinction between retained regions, voids, and optional carrier boundaries. **Verify:** AT-06, AT-07, AT-11.

**GEO-02 | Boolean construction.** Frame union and registration-hole subtraction shall occur before final boundary extraction and support validation. Touching a frame shall count as attachment only when the exported material has a finite-width connection. Point or diagonal contact alone is insufficient. **Verify:** AT-06, AT-09.

**GEO-03 | Valid boundaries.** Every cut part boundary shall be closed, finite, and non-self-intersecting, with explicit outer/hole relationships. Duplicate coincident cut segments, zero-area loops, and overlapping redundant boundaries shall block fabrication export. Open score paths remain valid. **Verify:** AT-07, AT-09, AT-13.

**GEO-04 | Bounded approximation.** Simplification and corner smoothing shall have a user-visible physical tolerance, default 0.05 mm. Their measured maximum boundary deviation from the unsimplified contour shall not exceed that tolerance. Topology changes or excessive deviation shall trigger fallback to a less simplified contour or a blocking diagnostic. **Verify:** AT-09, AT-10.

**GEO-05 | Feature diagnostics.** The system shall detect small parts and narrow-connection risks using documented geometric tests. At minimum, erosion by half the configured feature width shall flag disappearing parts or separated residual regions. Such findings shall be labeled conservative fabrication warnings, not a structural simulation. **Verify:** AT-10.

**GEO-06 | Sampling adequacy.** The selected fabrication raster shall provide at least three samples across the minimum configured feature width. The system shall show pixel size in mm and refuse export when this condition cannot be met within limits. Source detail lost before import cannot be recovered and shall not be implied. **Verify:** AT-10, AT-24.

**GEO-07 | Final-stack validation.** Bonded containment, connected-sheet integrity, guide containment, and hole clearances shall be checked on the final canonical polygons after every geometry-changing operation. Raster-only nesting tests shall not satisfy this requirement. **Verify:** AT-08, AT-09, AT-14.

**GEO-08 | Visible cleanup.** Cleanup shall report added material, removed material, holes filled, and parts removed. Changes shall be shown as overlays and retained in the validation report. The system shall not describe morphology as an exact minimum-strength guarantee. **Verify:** AT-10, AT-15.

**GEO-09 | Precision and export round trip.** Geometry shall be normalized on the 0.001 mm grid with a documented winding convention. Re-parsing an exported cut SVG shall recover the intended boundaries to within 0.005 mm and shall preserve topology and part count. **Verify:** AT-11, AT-12, AT-13.

**GEO-10 | Cut envelope.** The finished footprint and optional registration features shall remain within the declared page extent. The system shall compare the footprint with any user-entered laser-bed dimensions and block a bed-constrained export that does not fit. It shall not automatically rescale the artwork to fit. **Verify:** AT-12, AT-22.

# 7. Functional requirements: support and assembly assistance

## 7.1 Loose parts and support

**SUP-01 | Bonded loose parts.** Bonded mode shall retain disconnected regions as separate parts unless the user enables size-based culling. It shall not call the connected-sheet bridge resolver by default. **Verify:** AT-08, AT-21.

**SUP-02 | Full nominal support.** Every upper part shall pass exact containment in the immediately lower finalized material on the canonical grid. The report shall identify unsupported regions and their areas. Unsupported material shall block fabrication export; an acknowledgement alone cannot bypass it. **Verify:** AT-08, AT-09.

**SUP-03 | Support graph.** The system shall record which lower-layer part or parts support each upper part and verify that support reaches the base. A hole in a lower layer shall count as absent material. Part-level contact information shall be available in the assembly manifest. **Verify:** AT-08, AT-14.

**SUP-04 | Explicit clipping repair.** The system shall offer clipping of unsupported material only as a reviewed repair. It shall show removed area, preserve the previous revision, and rerun topology, feature, support, and guide checks after acceptance. **Verify:** AT-09, AT-15.

**SUP-05 | Stable part identities.** Deterministic regeneration of the same project shall produce the same layer/part IDs. IDs shall remain fixed within an export revision. Geometry changes may change IDs, but the UI shall invalidate stale guides and part lists instead of reusing mismatched identifiers. **Verify:** AT-14, AT-16, AT-17.

**SUP-06 | Connected-sheet strategy.** Connected mode shall bridge or explicitly cull disconnected components according to its configured strategy, and then verify one retained part per nonempty layer. Existing bridge-width and maximum-length controls shall remain available with material changes shown in the proof. **Verify:** AT-06, AT-21.

## 7.2 Placement guides and registration

**ASM-01 | Guide choices.** Bonded mode shall offer no scored guide, inset outline, or interior placement mark with optional part ID. Guides shall be generated on the immediately lower material in the shared assembly coordinates. A printable placement map shall always be available. **Verify:** AT-14.

**ASM-02 | Hidden-mark containment.** Every proposed score segment and ID shall lie inside both the upper part's final footprint and the lower supporting material, with a configurable concealment inset, default 0.5 mm. The inset shall also account for the user-calibrated mark footprint and placement allowance. If no valid region remains, the system shall omit the scored mark, report why, and use the printable map. **Verify:** AT-14.

**ASM-03 | Valid interior placement.** The system shall not use an arithmetic centroid without checking containment. Marks for concave, annular, or holed parts shall be placed at a valid interior location. Scored text shall be converted to vector strokes or outlines and checked like any other guide. **Verify:** AT-14, AT-13.

**ASM-04 | Registration holes.** Registration holes shall be off by default in bonded relief. When enabled, each proposed hole and its configured edge clearance shall fit inside retained material on every selected layer. A common hole set that falls in a void shall be rejected; there shall be no silent partial-stack drilling plan. **Verify:** AT-06, AT-14.

**ASM-05 | Assembly instructions.** The package shall identify front face, base-to-front order, part IDs, support relationships, retained versus discarded pieces, omitted empty layers, and which guides belong to which layer. Bonded instructions shall specify zero intentional spacer gap and distinguish nominal stock height from finished measured height. **Verify:** AT-14, AT-16, AT-25.

# 8. Functional requirements: preview and export

## 8.1 Review interface

**UI-01 | Guided workflow.** The interface shall present Source, Interpretation, Construction, Review, and Export stages with persistent physical dimensions and material thickness. Unsupported configurations shall be disabled with explanations rather than silently substituted. **Verify:** AT-01, AT-22.

**UI-02 | Three review views.** The system shall provide a final opaque assembly proof, individual-layer retained/waste inspection, and a dimensioned stack section. The existing tilted preview may remain as an illustrative view, but it shall not be labeled a measured solid model. **Verify:** AT-11, AT-20.

**UI-03 | Physical depth and explosion.** The section view shall use actual configured thickness and, for connected sheets, the configured illustrative spacer gap. Exploded separation shall be a display-only parameter and shall never modify cut geometry or nominal thickness. **Verify:** AT-03, AT-11.

**UI-04 | Diagnostic navigation.** Selecting a diagnostic shall identify the layer and part, highlight the affected region, explain the reason, and provide a relevant corrective action. Color shall not be the sole distinction between errors, warnings, material, and waste. **Verify:** AT-08, AT-20.

**UI-05 | Change review.** The system shall expose before/after geometry overlays for repairs and consequential cleanup, with changed area and part count. It shall visibly distinguish a draft result, stale result, processing result, and validated fabrication revision. **Verify:** AT-10, AT-15.

**UI-06 | Cancel and latest-result behavior.** Users shall be able to cancel generation. Results from obsolete requests shall not overwrite a newer revision. Export shall be disabled while the current fabrication revision is stale or incomplete. **Verify:** AT-15, AT-24.

## 8.2 Fabrication package

**EXP-01 | Per-layer SVG.** The package shall contain one fabrication SVG per nonempty layer, named by stable base-to-front index. Each SVG shall use millimeter dimensions and the shared finished-footprint viewBox. A bonded upper layer shall not receive an automatic cut rectangle around the page. **Verify:** AT-07, AT-12, AT-16.

**EXP-02 | Explicit operations.** Fabrication SVGs shall separate `CUT` and `SCORE` groups, with red and blue strokes as a documented project convention. Cut boundaries shall have no fills. Color shall not be presented as an automatic guarantee of a laser operation, power, speed, or execution order. **Verify:** AT-13, AT-18. [S9]

**EXP-03 | Portable vector output.** Fabrication SVGs shall contain explicit vector geometry with transforms baked into coordinates. They shall not rely on raster images, filters, clipping paths, CSS classes, external resources, or live font text to convey a cut or score operation. Proof files may use fills but shall be clearly separated. **Verify:** AT-13, AT-18. [S8, S10]

**EXP-04 | Complete bundle.** The ZIP shall include cut SVGs, assembly proof, a part-placement map, `ASSEMBLY.md`, `manifest.json`, `validation.json`, `settings.json`, and a self-contained project package. An optional preview image shall be labeled illustrative. Filenames and archive paths shall be sanitized. **Verify:** AT-16, AT-22.

**EXP-05 | Immutable export snapshot.** All exported files shall derive from the same validated project revision and canonical geometry hash. Changing any relevant setting during export shall either cancel the export or leave its frozen snapshot intact and explicitly identified. **Verify:** AT-15, AT-16.

**EXP-06 | Reproducibility and provenance.** The manifest shall record schema, application version, engine version, upstream baseline, source and normalized-sample hashes, units, dimensions, interpretation, thresholds, material settings, resolution, tolerances, layer inventory, operation conventions, and file hashes. **Verify:** AT-16, AT-17.

**EXP-07 | Export gate.** Blocking diagnostics shall disable fabrication export. Warnings shall require explicit review for the current revision and be included in the bundle. A nonfabrication diagnostic project package may still be saved, but it shall contain no falsely labeled ready-to-cut outputs. **Verify:** AT-08, AT-10, AT-15.

**EXP-08 | Delivery and cancellation.** Desktop download and supported mobile share/download paths shall report generated, handed-off, canceled, or failed states accurately. A browser handoff shall not be described as confirmation that the user saved the file. Cancellation shall not erase the project. **Verify:** AT-16, AT-22.

**EXP-09 | Machine setup checklist.** The bundle shall instruct the operator to inspect nominal scale, assign cut/score settings, run a coupon, verify registration fit, set order as needed, and prevent duplicate kerf compensation. It shall warn that downstream geometry edits invalidate the application's original support and preview checks. **Verify:** AT-18, AT-19, AT-25.

# 9. Data model and interface contracts

## 9.1 Persisted project model

The schema shall have an explicit major version and a migration path. Numeric values must be finite and range-checked. Enumerations must be validated. Unknown project metadata may be retained separately, but unknown geometry-affecting fields shall not be silently accepted.

| Entity | Required fields and rules |
|---|---|
| Project | Project ID, schema version, revision, title, created/modified time, application and engine versions, selected modes, source references. |
| Source | Original format and byte hash; normalized raw sample file and hash; width/height; alpha-domain policy; orientation and decoding policy. |
| Interpretation | `tonal` or `height`; polarity; threshold rule; explicit remapping and smoothing; normalized thresholds actually used. |
| Construction | `connected-sheet` or `bonded-relief`; total sheet count; rectangular base; frame configuration; gap; cleanup and repair settings. |
| Material | Name, uniform thickness in mm, nominal/measured state, appearance, feature settings, minimum part area, calibration record, `kerfMode=external`. |
| GeometryConfig | Artwork and finished dimensions, final raster dimensions, sampling size, approximation tolerance, 0.001 mm grid, orientation. |
| LayerResult | Layer index, bottom/top stock Z, status, material polygons and holes, part IDs, cut length, material area, diagnostics, geometry hash. |
| PartResult | Part ID, parent layer, polygon/holes, bounding box, area, lower support IDs, guide references, warnings. |
| Diagnostic | Stable code, severity, revision, layer/part references, affected region, message, measured value, limit, recommended action, acknowledgement state. |
| ExportManifest | Frozen revision, engine identity, settings, complete layer inventory, units and conventions, nominal-kerf status, filenames and hashes. |

Cached generated geometry is disposable and shall not override a source/configuration mismatch. The normalized sample file is the reproducibility input; raw samples avoid depending on browser-specific JPEG decoding when reopening a project. Project and source files shall not be fetched from remote URLs during import.

## 9.2 Canonical geometry contract

```text
MaterialLayer {
  index: integer,
  zBottomMM: number,
  zTopMM: number,
  material: PolygonWithHoles[],
  parts: Part[],
  cutPaths: ClosedPath[],
  scorePaths: OpenOrClosedPath[],
  diagnostics: Diagnostic[],
  canonicalHash: string
}
```

Polygon orientation and ordering shall be normalized before hashing. Part ordering shall be deterministic using layer, bounding-box coordinates, area, and a geometry-hash tie-breaker. Layer index is not stock placement. A later stock-nesting adapter must preserve an explicit invertible assembly-to-stock transform and cannot replace assembly coordinates.

## 9.3 Worker interface

```text
GenerateRequest {
  requestId, revision, engineVersion, quality,
  normalizedSource, sourceHash, config
}

GenerateResponse {
  requestId, revision, status,
  progress?, validatedLayers?, diagnostics?, geometryHash?
}
```

The controller shall accept a result only when request ID and revision match its active request. Requests shall be cancelable. Source buffers may be transferred rather than copied, but the project must retain a recoverable source. Errors shall be structured and shall not leave export enabled for a stale result.

## 9.4 Package structure

```text
project-name_fabrication.zip
  cuts/layer_00_base.svg
  cuts/layer_01.svg
  cuts/layer_02.svg
  ...
  proof/assembly.svg
  proof/placement-map.svg
  ASSEMBLY.md
  manifest.json
  validation.json
  settings.json
  project.sbrproj
  calibration/coupon.svg          [only when requested]
```

The `.sbrproj` file is a ZIP-compatible project container with `project.json`, normalized source samples, and source metadata; original source bytes may be included when available. Import shall defend against path traversal, duplicate entries, excessive decompression, and mismatched declared sizes. A project container shall have at most 1024 entries and an expanded size of at most 256 MiB on desktop or 64 MiB on mobile. The importer shall accept only the declared project structure and shall not recursively unpack arbitrary nested archives. Export timestamps may differ between runs. Canonical geometry, normalized operation payloads, and their hashes must remain identical for the same engine, inputs, and configuration.

## 9.5 Diagnostic policy

| Severity | Examples | Required behavior |
|---|---|---|
| Blocking | Unsupported bonded material; self-intersection; open cut boundary; stale revision; invalid registration hole; insufficient sampling; nonfinite dimensions. | Block fabrication output; retain project and provide targeted correction. |
| Warning | Provisional material calibration; small but supported part; narrow feature risk; absent hidden guide; altered artistic detail; omitted trailing layer. | Show measured details, require revision-specific review, include in export. |
| Information | Nominal kerf workflow; palette-only color; identical physical layers; ignored display-only setting. | Keep visible in relevant context without preventing export. |

Acknowledgements shall be invalidated by a change that affects the diagnostic. Engineering error states shall not be downgraded to warnings simply to permit export.

# 10. Nonfunctional requirements

These requirements are MUST obligations. Performance values are release targets to measure, not claims about the upstream implementation.

**NFR-01 | Local processing and privacy.** Import, processing, preview, persistence, and export shall work without transmitting source images, project content, or geometry. No telemetry, remote fonts, or runtime CDN assets are permitted by default. Network inspection of an offline workflow shall show no required external requests. **Verify:** AT-23.

**NFR-02 | Responsive processing.** Geometry computation shall run off the main UI thread. At least 95% of control interactions shall receive visible acknowledgement within 100 ms during generation, and cancellation shall be acknowledged within 500 ms. Long operations shall expose progress rather than a frozen interface. **Verify:** AT-24.

**NFR-03 | Desktop performance.** On the recorded reference desktop in Section 12.3, the benchmark workload shall complete draft generation within 1.5 seconds, final generation plus validation within 10 seconds, and packaging within 5 seconds at the 95th percentile. Measure 30 runs after five warmups. **Verify:** AT-24.

**NFR-04 | Memory and limits.** The estimated algorithm working set shall not exceed 512 MiB on desktop or 192 MiB in the mobile envelope. The system shall estimate allocations before generation and fail safely or request an explicit lower setting. It shall not silently lower fabrication resolution. **Verify:** AT-22, AT-24.

**NFR-05 | Determinism.** The same normalized source, engine version, and configuration shall yield the same canonical geometry and normalized cut payloads across the supported browser matrix. Timestamps and nongeometric preview pixels are excluded. Randomized processing is prohibited unless a persisted seed is part of the contract. **Verify:** AT-16, AT-17, AT-23.

**NFR-06 | Security.** User strings shall be escaped in HTML, SVG, XML, JSON, and archive filenames as appropriate. Imports shall not execute scripts, resolve remote references, or modify files outside the project container. Resource limits shall apply to malformed and compressed inputs. **Verify:** AT-22.

**NFR-07 | Accessibility.** Essential import, configuration, diagnostic review, and export actions shall be keyboard operable with visible focus, accessible names, and announced status changes. Information shall not rely on color alone. Controls shall target applicable WCAG 2.2 AA criteria; release requires a documented manual and automated audit, not an untested conformance claim. **Verify:** AT-20. [S12]

**NFR-08 | Browser support.** Desktop validation shall cover the current and previous major stable Chrome, Edge, Firefox, and Safari available at release. Mobile smoke tests shall cover current iOS Safari and Android Chrome. Exact browser and OS versions shall be recorded in the release matrix. **Verify:** AT-18, AT-20, AT-23.

**NFR-09 | Failure isolation.** Decode errors, worker failure, invalid geometry, quota exhaustion, export failure, and canceled sharing shall preserve the last usable project revision. A failure shall not produce a partial fabrication bundle labeled complete. **Verify:** AT-15, AT-22.

**NFR-10 | Testability.** The interpretation, geometry, construction, validation, and export core shall be callable without the DOM. The release pipeline shall run unit, property, fixture, serialization, migration, and browser integration tests. No unresolved test failures may be waived without a tracked disposition and product-owner approval. Blocking geometry failures remain release blockers. **Verify:** AT-26.

**NFR-11 | Dependency and license hygiene.** Runtime dependencies shall be locally bundled, version-pinned, license-reviewed, and included in a component inventory. Upstream copyright and license notices shall be retained. Dependency changes affecting geometry shall trigger regression and determinism tests. **Verify:** AT-26. [S11]

**NFR-12 | Honest fabrication guidance.** The application shall distinguish geometry validation from material suitability and machine readiness. It shall not prescribe universal laser settings or imply that preview color selects a safe operation. The operator remains responsible for machine-specific material compatibility and the test cut. **Verify:** AT-19, AT-25. [S9]

# 11. Architecture, deployment, and compatibility

## 11.1 Required architecture boundaries

```text
UI and versioned project state
    -> source decoding and interpretation
    -> cumulative layer generation
    -> configurable cleanup and construction strategy
    -> canonical material polygons, frame union, hole subtraction
    -> final topology and support validation
    -> parts and contained assembly guides
    -> validated immutable fabrication snapshot
    -> proof, dimensions, SVG, manifest, and package exporters
```

The diagram defines responsibility boundaries, not a requirement for a new framework. Raster masks may remain the working representation through early cleanup. The critical boundary is the canonical final material model: no exporter or preview is allowed to independently reinterpret what should be kept.

## 11.2 Module evolution

| Existing area | Proposed treatment |
|---|---|
| `raster.js` | Retain tonal behavior; add an explicit raw-height interpretation adapter and tested layer-count rules. |
| `morph.js` | Reuse morphology and component utilities; expose changes and avoid irreversible implicit culling. |
| `islands.js` | Keep behind the connected-sheet strategy; do not invoke by default for bonded relief. |
| `trace.js` | Reuse extraction where valid; add containment hierarchy, physical tolerance, and topology-preserving validation. |
| `svgout.js` | Generate paths from canonical material and operations; remove the assumption that every layer needs a cut rectangle. |
| `preview.js` | Keep an illustrative preview; add authoritative 2D proof and dimensioned section using final geometry. |
| `app.js` | Split versioned project state, worker coordination, validation gating, and export snapshot management. |
| New bounded modules | Project schema/migration, material model, bonded support validation, guide generation, and fixture-based acceptance tooling. |

The existing implementation is small and modular, which supports incremental change. That does not remove the need to characterize current export behavior before reuse. [S1, S6]

## 11.3 Deployment requirements

**DEP-01 | Static hosting.** The production release shall be deployable as static files on an HTTPS host without a database or application server. Development instructions shall include a local static-server path. Installation shall not require a Hugging Face account, GPU, or API key. **Verify:** AT-23.

**DEP-02 | Offline operation.** After an explicit successful application-cache installation, the core workflow shall run offline. Cache status and update availability shall be visible. A service-worker update shall not interrupt an unsaved project or mix engine assets from different releases. **Verify:** AT-23.

**DEP-03 | Reproducible release.** A clean checkout shall have documented dependency installation, test, and build commands that produce the release artifacts. The release shall identify its source commit, engine version, component inventory, and migration support. **Verify:** AT-26.

**DEP-04 | Legacy compatibility.** Supported upstream settings shall import through an explicit legacy adapter and retain tonal and connected-sheet semantics. Correctness repairs may change legacy output; such changes shall be explained in migration/release notes rather than preserving a known invalid cut for byte compatibility. **Verify:** AT-21, AT-26.

**DEP-05 | Update rollback.** The hosting package shall support rollback to the previous release without silently downgrading project schemas. Older engines shall reject incompatible newer project packages and preserve the user's data. **Verify:** AT-17, AT-23.

# 12. Verification and acceptance

## 12.1 Verification method

Each MUST requirement maps to at least one scenario below. Automated geometry tests shall use canonical polygons and exported SVGs, not screenshots alone. Visual review confirms usability and presentation. Physical acceptance confirms that a representative set of parts can actually be cut, located, and assembled under documented conditions.

The golden-fixture library shall include a monotonic ramp, flat black and white images, exact threshold ties, repeated levels, a donut with an inner island, a concave crescent, a border-touching feature, a narrow bridge, a lower-layer hole beneath an upper part, an empty intermediate layer, an asymmetric orientation marker, and deliberately malformed geometry.

## 12.2 Acceptance scenarios

**AT-01 | Project modes and units.** Create the plywood preset and verify its explicit fields. Change only color and confirm an identical geometry hash. Convert a 12-inch width to millimeters and back; the stored width remains 304.8 mm. Enter invalid width or thickness and verify inline rejection without project loss.

**AT-02 | Height sample fidelity.** Import raw grayscale samples 0, 64, 128, 191, and 255 and verify exact stored values before normalization. Add conflicting display-color metadata and confirm height geometry is unchanged. Verify rejection of a 16-bit PNG rather than silent truncation. Enable smoothing and verify that it is recorded as an explicit change.

**AT-03 | Quantization and height.** For N=5, verify that normalized heights 0, 0.25, 0.5, 0.75, and 1 yield 1 through 5 total sheets. Test exact boundaries 0.125, 0.375, 0.625, and 0.875 and confirm higher-level ties. For N=8 and t=6.35 mm, verify maximum stock height 50.8 mm and above-base relief 44.45 mm. N=1 must yield only the base.

**AT-04 | Flat, duplicate, and empty bands.** A black height map yields the base only; a white height map yields N identical full-domain physical layers. A constant midpoint map remains constant. Duplicate tonal thresholds generate visible empty-band diagnostics. Trailing omissions preserve original indices and reduce actual, not requested, maximum height.

**AT-05 | Domain and orientation.** Import a transparent background with one asymmetric opaque feature. Confirm that excluded pixels do not contribute height, while the rectangular base remains. Apply rotation and mirroring separately and verify matching transforms in proof, cut files, and placement map with no implicit second transform.

**AT-06 | Frame integrity and holes.** Generate a connected-sheet fixture whose artwork touches a frame along an edge. Reconstruct retained material from exported boundaries and verify one connected part, no cut across the intended attachment, and valid hole clearance. Repeat with only diagonal contact and confirm it does not count as a valid connection.

**AT-07 | Retained versus discarded material.** Export a bonded layer containing a donut and a separate inner island. Verify outer, hole, and island boundaries, correct part count, and no automatic page-outline cut. Compare the exported retained-material reconstruction with the authoritative proof. A base layer must have exactly its intended outer boundary and explicit holes.

**AT-08 | Bonded support.** Accept a loose part fully supported by the layer below without adding a bridge. Move part of its footprint outside the lower material and confirm a blocking diagnostic with measured unsupported area. Place it over a lower-layer hole and verify failure. Confirm that every accepted support path terminates at the base.

**AT-09 | Postprocessing and repair.** Use a fixture where smoothing or an added bridge creates an overhang. Final validation must catch it even when raw masks were nested. Apply reviewed clipping, verify the difference overlay and revised IDs, and rerun checks. Feed self-intersecting and point-connected fixtures and confirm rejection or topology-preserving fallback.

**AT-10 | Feature and resolution checks.** Use parts and necks immediately below and above the configured minimum width and area. Confirm diagnostics after vectorization, not only on masks. With a 1 mm target feature and pixel size 0.4 mm, export must fail the three-sample rule. At pixel size 0.25 mm it may proceed subject to the other checks. Verify physical approximation error against the selected tolerance.

**AT-11 | Preview/export agreement.** Reparse SVGs, reconstruct retained material, and compare with canonical geometry within 0.005 mm. Validate holes, frames, and support edges. Set explosion to zero and maximum; geometry hashes must not change. The dimensioned section must show configured thickness rather than arbitrary visual spacing.

**AT-12 | Scale and envelope.** Export a 100 mm calibration square and a 304.8 mm-wide asymmetric artwork. Confirm SVG dimensions and coordinates without rescaling. Verify artwork versus framed footprint dimensions. A too-small declared laser bed must block the constrained export. Serialization error must remain within 0.005 mm.

**AT-13 | SVG portability and operations.** Parse every fabrication SVG and verify closed cut contours, separate score paths, expected group names, finite coordinates, and absence of unsupported dependencies. No raster image, live text, clipping mask, duplicate cut segment, or implicit transform may define a fabrication operation. Confirm that a small part ID is exported as vectors.

**AT-14 | Placement and alignment.** Generate guides for a crescent, donut, and very small loose part. Confirm all scored geometry lies within the inset upper footprint and the supporting lower material. Where inset space vanishes, confirm omission and a printable-map fallback. Validate part IDs, support references, registration-hole clearance, and no hidden mirror operation.

**AT-15 | Revision races and gate behavior.** Change settings during generation and export, issue cancellation, and perform undo/redo. Verify that obsolete results cannot replace the active revision. Block fabrication export for unresolved errors and stale results. Warning acknowledgements must invalidate when relevant geometry changes. Save a diagnostic project without mislabeling it ready to cut.

**AT-16 | Package integrity.** Unzip a complete export and check the required file inventory, sanitized paths, layer ordering, common revision, operation conventions, and manifest file hashes. Generate twice and compare canonical geometry and normalized SVG payloads. Simulate a canceled share and verify truthful status with an intact project.

**AT-17 | Persistence and migration.** Save, close, and reopen a project offline with no original image selected. Regenerate identical geometry from stored samples. Test supported legacy migrations, an unknown newer schema, corrupt source hashes, autosave recovery, and rollback to an older engine. Unsupported data must not replace the current project.

**AT-18 | Laser-software interoperability.** On release-recorded LightBurn versions and operating systems, import golden cut files and verify 100 mm dimensions within 0.1 mm as displayed, correct topology, separate operation groups/colors, and all vector labels. Record import settings, including the selected SVG scaling option. Inspect the job preview for duplicate paths. This test does not fire the laser. [S9, S10, S13]

**AT-19 | Calibration workflow.** Confirm that provisional stock settings are labeled uncalibrated, no internal kerf movement occurs, and the coupon is optional and separate. Record nominal versus measured thickness and test results. Verify that no universal speed or power is populated and that downstream compensation responsibilities are stated clearly.

**AT-20 | Usability and accessibility.** Complete import, settings, diagnostic correction, and export using only a keyboard. Verify visible focus, noncolor status cues, meaningful control labels, and announced processing states. Inspect at 200% zoom and with reduced-motion settings. Confirm that the authoritative proof and dimensioned section remain available without the tilted preview.

**AT-21 | Legacy and construction regression.** Import a legacy tonal project, compare expected banding and polarity, and verify bridge/cull behavior in connected mode. Switch to bonded mode with review and confirm supported islands are retained without bridges. Appearance-only changes must not change geometry. Document intentional fixes to legacy export behavior.

**AT-22 | Hostile input and fault injection.** Test oversized image headers, corrupt PNG/JPEG, archive traversal paths, duplicate filenames, expansion bombs, script-like project titles, unknown enums, nonfinite values, worker termination, storage quota errors, and export failure. No case may execute injected content, lose the previous project, or create a falsely complete fabrication package.

**AT-23 | Hosting, offline, and browser matrix.** Deploy the static release from a clean package; exercise the workflow after cache installation with networking disabled. Confirm no remote image processing. Test cache update/rollback with an unsaved project and ensure engine assets remain version-consistent. Compare canonical output across the supported desktop browser matrix.

**AT-24 | Performance and resource envelope.** Run the desktop and mobile workloads in Section 12.3, record all versions and hardware, and verify latency, cancellation, memory estimates, and no silent reduction of final resolution. Over-budget jobs must offer an explicit corrective action. Report percentile measurements and failures rather than averages alone.

**AT-25 | Physical fabrication and assembly.** A fabrication reviewer shall cut a calibration coupon and at least three representative nominal 1/4-inch plywood projects: a simple stepped relief, a loose-part relief with holes, and a frame-connected control. Record actual stock thickness, machine, settings, compensation location, measured dimensions, guide visibility, and assembly outcome. Reject unresolved unsupported parts, unintended frame separation, or exposed placement marks.

**AT-26 | Maintainability and release evidence.** From a clean checkout, install pinned dependencies, run the full suite, and produce the release package. Verify source/license notices, component inventory, documented commands, migration tests, and immutable release identification. Associate test results with the exact release commit and engine version.

## 12.3 Benchmark definitions

**Desktop reference target:** A recorded 64-bit laptop or desktop with at least four physical CPU cores and 8 GB RAM, without GPU compute. Freeze the exact CPU, OS, browser, power mode, and engine build before performance acceptance. The primary workload is a 1536 x 1536 sample field, eight layers, no more than 250 parts per layer, and no more than 50,000 final contour vertices total. The draft workload uses a 720-pixel long side.

**Mobile reference target:** A recorded device with at least 4 GB RAM. The workload is 768 x 768 samples, six layers, at most 100 parts per layer, and at most 20,000 contour vertices total. Final generation plus validation shall complete within 8 seconds at the 95th percentile, with the same UI responsiveness and cancellation targets. Larger workloads are not guaranteed merely because the desktop envelope permits them.

Memory measurements shall identify whether they cover algorithm-owned buffers or total browser process memory. The release target applies to the algorithm working set; the UI shall use a conservative estimate before allocating. Complexity or vertex limits shall fail explicitly rather than producing incomplete geometry.

## 12.4 Requirement traceability

| Requirement group | Acceptance scenarios |
|---|---|
| PRJ-01 through PRJ-06 | AT-01, AT-03, AT-15, AT-17, AT-21, AT-22 |
| IMG-01 through IMG-07 | AT-02, AT-03, AT-04, AT-05, AT-12, AT-22, AT-24 |
| LYR-01 through LYR-06 | AT-03, AT-04, AT-06, AT-07, AT-08, AT-10, AT-15, AT-21, AT-24 |
| MAT-01 through MAT-06 | AT-01, AT-03, AT-10, AT-11, AT-12, AT-19, AT-25 |
| GEO-01 through GEO-10 | AT-06 through AT-15 where cited; AT-22, AT-24 |
| SUP-01 through SUP-06 | AT-06, AT-08, AT-09, AT-14, AT-15, AT-16, AT-17, AT-21 |
| ASM-01 through ASM-05 | AT-06, AT-13, AT-14, AT-16, AT-25 |
| UI-01 through UI-06 | AT-01, AT-03, AT-08, AT-10, AT-11, AT-15, AT-20, AT-22, AT-24 |
| EXP-01 through EXP-09 | AT-07, AT-08, AT-10, AT-12 through AT-19 where cited; AT-22, AT-25 |
| NFR-01 through NFR-12 | AT-15 through AT-20 where cited; AT-22 through AT-26 where cited |
| DEP-01 through DEP-05 | AT-17, AT-21, AT-23, AT-26 |

The per-requirement verification references are authoritative when a group row is broader. A requirement is not complete merely because one scenario in its group passes.

## 12.5 Definition of done

Release acceptance requires every MUST requirement to have passing evidence, every blocking geometry issue to be closed, and each remaining warning to follow the defined review policy. The release record shall contain the golden-fixture results, browser matrix, performance results, security/fault tests, migration results, sample fabrication bundles, and physical review records.

The physical reviewer shall establish a calibrated dimensional tolerance from the actual machine and coupon before judging cut dimensions. The SVG's numerical tolerance shall not be substituted for that physical tolerance. Once agreed, the measured project results shall meet the recorded physical tolerance, assemble in the documented order, and conceal scored placement marks under their intended parts.

# 13. Delivery plan and release gates

## 13.1 Gate-based implementation sequence

| Gate | Work package | Exit evidence |
|---|---|---|
| G0: Baseline and characterization | Freeze upstream revision; execute existing tests; reproduce frame edge cases; capture current SVG and preview behavior; confirm licenses. | Baseline report, fixture corpus, documented defects, and reuse decisions. |
| G1: Canonical geometry | Introduce material/void polygons; correct frame union; define stable units; validate closed paths and SVG round trips. | AT-06, AT-07, AT-09, AT-11, AT-12, and AT-13 pass on core fixtures. |
| G2: Bonded relief engine | Add raw-height interpretation, sheet accounting, material settings, independent construction strategies, and final support checks. | Height fixtures, loose-part support tests, repair behavior, and legacy regression pass. |
| G3: Assembly and reproducibility | Add contained guides, part IDs, self-contained projects, manifests, immutable export, and diagnostic gates. | AT-14 through AT-17 and hostile project-import tests pass. |
| G4: Operational hardening | Add worker responsiveness, resource limits, accessible review, static hosting, offline updates, and benchmark automation. | Browser, offline, accessibility, fault, and performance evidence recorded. |
| G5: Fabrication release | Import in recorded laser software, calibrate actual stock, cut and assemble representative pieces, close defects. | Fabrication reviewer and product owner approve the release record. |

No calendar estimate is implied by these gates. Their order is deliberate: a convincing preview shall not precede proof that the exported geometry has the right physical meaning.

## 13.2 Suggested change boundaries

Use small, reviewable changes in this sequence: characterization fixtures; canonical geometry/export; construction strategy boundary; height interpretation and thickness; final support validation; parts and guides; project/manifest versioning; worker and deployment hardening; physical-release documentation. Keep unrelated UI redesign and AI dependencies out of those changes.

Do not combine a framework rewrite with the first geometry correction. Do not preserve a known physical defect solely to minimize the fork's diff. Keep upstream-compatible fixes separable from product-specific features so they can be contributed or rebased independently.

## 13.3 Deferred expansion criteria

Internal kerf compensation may be added only after outer contours, holes, offset collapse, duplicate compensation, and post-offset support have dedicated acceptance fixtures. Shaped and absent bases require new domain/support rules. Mixed stock thickness requires a new height quantizer. Automatic nesting requires independent stock coordinates and invertible transforms. AI inference requires explicit model licensing, resource budgets, and a depth-convention adapter. True 3D preview must consume the same validated polygons and thickness values as export.

# 14. Risks, assumptions, and change control

## 14.1 Risk register

| Risk | Consequence | Mitigation / accountable role |
|---|---|---|
| Existing frame semantics differ from actual cuts | A sheet falls apart despite an attractive proof. | G0 reproduction and material-union round trip; geometry maintainer. |
| Per-layer edits destroy nesting | Upper parts lack material underneath. | Final polygon containment and blocking diagnostics; geometry maintainer. |
| Brightness is mistaken for scene depth | Artistically unexpected relief. | Explicit interpretation/polarity and preview; product owner. |
| Geometry filters are mistaken for strength guarantees | Fragile or unsafe fabrication assumptions. | Calibrated profiles and honest warnings; fabrication reviewer. |
| Guide marks remain visible | Finished artwork is marred. | Inset containment, placement-map fallback, and physical review; fabrication reviewer. |
| SVG imports at the wrong scale or operation | Material waste or wrong laser behavior. | Known-dimension fixture and explicit machine setup; laser operator. |
| Browser or source decoding changes output | Reopened projects cannot reproduce parts. | Stored normalized samples and engine/hash identity; maintainer. |
| Large inputs exhaust memory | Frozen application or data loss. | Preflight limits, workers, cancellation, and recovery; maintainer. |
| Local storage is cleared or unavailable | Work is lost between sessions. | Self-contained packages and truthful autosave status; product owner. |
| New dependencies increase maintenance burden | Deployment or licensing problems. | Bounded local dependencies, pinned versions, and inventory; maintainer. |
| Scope expands into AI or rendering before geometry is stable | Delivery delays without better cut reliability. | Gate-based scope and explicit deferred backlog; product owner. |

## 14.2 Implementation assumptions and chosen defaults

The project targets decorative bonded art, not load-bearing structures. Plywood is the primary application, but the engine shall not infer machine compatibility from its name. Uniform measured stock, a rectangular base, and full nominal support are v1.0 constraints. Nominal 6.35 mm is a starting value only. The benchmark and geometric thresholds are proposed product requirements to be validated during implementation.

The product owner may revise provisional feature defaults after coupon testing without changing the core support invariant. A change to image-height mapping, support policy, canonical precision, operation semantics, or persistent schema requires a versioned specification and corresponding migration or compatibility decision.

## 14.3 Approval responsibilities

The product owner approves scope and user-visible behavior. The geometry maintainer approves invariants, numerical handling, and regression results. The test lead approves traceability and release evidence. The fabrication reviewer approves physical assembly under recorded conditions. One individual may occupy multiple roles, but each approval shall be recorded against the release revision.

## 14.4 Change-control rule

Every proposed requirement change shall identify affected IDs, rationale, user impact, schema impact, acceptance changes, and release scope. Safety or correctness blockers cannot be reclassified as optional merely to complete a milestone. New capabilities shall be added through the existing interpretation, construction, or export boundaries rather than a second independent pipeline.

# 15. Source register

Repository sources below are pinned to the inspected baseline. Documentation sources describe external format or tool behavior, not guaranteed behavior of the proposed extension. Access date: October 6, 2026.

**[S0] Upstream baseline commit.** [Shadowbox Studio commit f0552c7a6ac07b857b3b9c027934ebbe8ed14535](https://github.com/strondcode/shadowbox-studio/commit/f0552c7a6ac07b857b3b9c027934ebbe8ed14535).

**[S1] Upstream project overview and deployment.** [README.md at the inspected revision](https://github.com/strondcode/shadowbox-studio/blob/f0552c7a6ac07b857b3b9c027934ebbe8ed14535/README.md).

**[S2] Thresholds and cumulative masks.** [js/raster.js](https://github.com/strondcode/shadowbox-studio/blob/f0552c7a6ac07b857b3b9c027934ebbe8ed14535/js/raster.js).

**[S3] Pipeline, defaults, assembly text, and export orchestration.** [js/app.js](https://github.com/strondcode/shadowbox-studio/blob/f0552c7a6ac07b857b3b9c027934ebbe8ed14535/js/app.js).

**[S4] Alpha rasterization and parallax preview.** [js/preview.js](https://github.com/strondcode/shadowbox-studio/blob/f0552c7a6ac07b857b3b9c027934ebbe8ed14535/js/preview.js).

**[S5] Cut and proof SVG construction.** [js/svgout.js](https://github.com/strondcode/shadowbox-studio/blob/f0552c7a6ac07b857b3b9c027934ebbe8ed14535/js/svgout.js).

**[S6] Documented algorithm organization.** [docs/ALGORITHMS.md](https://github.com/strondcode/shadowbox-studio/blob/f0552c7a6ac07b857b3b9c027934ebbe8ed14535/docs/ALGORITHMS.md).

**[S7] Existing test coverage.** [test/run_tests.js](https://github.com/strondcode/shadowbox-studio/blob/f0552c7a6ac07b857b3b9c027934ebbe8ed14535/test/run_tests.js).

**[S8] SVG path behavior.** [W3C SVG 2: Paths](https://www.w3.org/TR/SVG2/paths.html).

**[S9] Laser operation assignment and color layers.** [LightBurn User Guide: Colors and Layers](https://docs.lightburnsoftware.com/latest/GetStarted/ColorsAndLayers/).

**[S10] Supported import and text portability.** [LightBurn User Guide: File Management](https://docs.lightburnsoftware.com/latest/Reference/FileManagement/).

**[S11] Upstream license.** [LICENSE](https://github.com/strondcode/shadowbox-studio/blob/f0552c7a6ac07b857b3b9c027934ebbe8ed14535/LICENSE).

**[S12] Accessible keyboard focus.** [W3C WAI: Understanding Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible).

**[S13] SVG import scaling settings.** [LightBurn User Guide: Settings and Preferences](https://docs.lightburnsoftware.com/latest/Reference/SettingsPreferences/).
