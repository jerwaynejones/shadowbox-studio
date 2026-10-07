# Spike S4b — JPEG header inspection (`SBJpeg`)

**Status:** PASS, with four recommended plan amendments (§6).
**Date:** 2026-10-07. **Plan:** `docs/plans/opaque-layers-dev-plan.md` Task S4b. It covers IMG-01, IMG-05, IMG-07 and AT-22.
**Scope:** 0.5 day, run in parallel with G1. All artifacts are under `spikes/S4b/`. No shared source was edited, nothing was committed, and `build.js` was not run.
**Third-party code:** none. The parser is in-house. Appendix B is respected: no npm, and the browsers are driven over CDP and WebDriver BiDi using Node's built-in `WebSocket`.

## 1. What was built

| File | Purpose |
|---|---|
| `spikes/S4b/jpeg.js` | Candidate `js/jpeg.js`: a classic script that sets `globalThis.SBJpeg`, in the same pattern as `util.js`/`hash.js`. 182 lines. SHA-256 `277b9d775116941c17be6c456a09866cea97041322e7bd301f9f28ca53830f24`. |
| `spikes/S4b/test_jpeg.js` | Node runner: the plan's 5 tests, edge cases, a real-encoder corpus, a mutation fuzz, a truncation sweep and a benchmark (`node spikes/S4b/test_jpeg.js --bench --fuzz 50000`). |
| `spikes/S4b/make_corpus.sh`, `inject_exif.js` | Regenerate the 43-file corpus with libjpeg-turbo `cjpeg` 3.2.0 and ImageMagick 7.1.2-31, plus byte-level Exif and structural variants. `corpus/` is git-ignored (≈60 MB). |
| `spikes/S4b/browser.html`, `run_browser.js`, `run_firefox.js` | Browser probe. It runs `SBJpeg` on each file, then compares `createImageBitmap` (default, `"none"`, `"from-image"`), `<img>.decode()`, the decoded size and corner pixels. |
| `spikes/S4b/node_run.log`, `corpus_results.json`, `browser_chromium.json`, `browser_firefox.json` | Captured results. |

**Environment:** Node v26.7.0, Chromium 152.0.7977.82 (headless=new), Firefox 155.0.1 (headless), Linux on an i7-11800H.

### Interface as implemented

The frozen plan contract is kept unchanged: `inspect(bytes) → {w, h, components, progressive, exif}`, plus the codes `JPEG_SIGNATURE | JPEG_TRUNCATED | JPEG_BAD_SEGMENT | JPEG_NO_SOF`. It also adds:

- extra `inspect` fields: `exifAmbiguous`, `sof`, `precision`, `arithmetic`, `lossless`, `hierarchical` and `headerBytes`. All are read from bytes the walk already touches;
- `SBJpeg.unsupported(info) → reason|null`, for variants the browsers do not decode consistently;
- `SBJpeg.scanEnd(bytes, from) → {eoi, trailing, scans}`, a structural walk to EOI. It skips segments by length and skips entropy-coded data by `indexOf(0xFF)`, ignoring FF00 and RSTn. It never decodes and never throws.

## 2. Exit criteria (plan Task S4b tests)

| Plan test | Result |
|---|---|
| `IMG-07 JPEG SOF dimensions read before decode` (`jpegHeader({w:6000,h:4000})`) | **PASS**: 6000 × 4000 |
| `IMG-05 JPEG EXIF orientation 6 parsed` | **PASS**: 6. With the current T0.3 fixture it is also flagged `exifAmbiguous` (see §4.3). |
| `AT-22 corrupt JPEG (bad SOI) rejected` | **PASS**: `JPEG_SIGNATURE` |
| `AT-22 truncated JPEG rejected` (`truncate: 5`) | **PASS**: `JPEG_TRUNCATED` |
| `AT-22 oversized SOF segment length rejected` (`sofLen: 4000`) | **PASS**: `JPEG_BAD_SEGMENT` |
| "Never decodes scan data" | **PASS**: `inspect` stops at the SOF segment. `headerBytes` is 37–290 B on the real corpus, and 60 195 B when a 60 KB APP2 precedes SOF. |

**Totals: 82 checks passed, 0 failed** (`node_run.log`). They cover:

- every prefix of a header (→ `SIGNATURE` below 2 bytes, `TRUNCATED` otherwise);
- `sofLen` values 8, 16, 18 and 4000 (→ `BAD_SEGMENT`);
- empty input and PNG bytes (→ `SIGNATURE`);
- SOI followed directly by EOI or SOS (→ `NO_SOF`);
- segment length 0;
- RSTn/TEM before SOF;
- an `ArrayBuffer` input;
- orientations 1–8 in both II and MM byte order;
- an XMP APP1 before the Exif APP1, and Exif after a JFIF APP0;
- fill bytes, garbage bytes, trailing payload after EOI, and missing EOI.

Every successful corpus parse was cross-checked against ImageMagick `identify` for width and height.

**Robustness:** the mutation fuzz ran 200 000 cases (4 seed files × 50 000, 1–4 byte mutations each, random prefix). The outcomes were:

| Outcome | Cases |
|---|---|
| returned a result | 170 289 |
| `BAD_SEGMENT` | 14 317 |
| `TRUNCATED` | 10 848 |
| `SIGNATURE` | 3 227 |
| `NO_SOF` | 1 319 |
| uncoded exception | **0** |

`scanEnd` passed 20 000 mutations without ever throwing.

## 3. Measured performance

All Node times below are on Node v26.7.0.

| Operation | Size | Time |
|---|---|---|
| `inspect`: fixture / baseline / 55 MB 24 MP file | any | **0.07–0.13 µs** (constant; independent of file size) |
| `inspect` with Exif IFD parse | 12.5 KB | 0.33 µs |
| `inspect` with a 60 KB APP2 skipped | 72 KB | 0.15 µs |
| `inspect`, pathological case: 1000 × 64 KiB APPn before SOF | 65.5 MB | 24–27 µs |
| `scanEnd` on a 16 MP file | 4.2 MB | 4.3 ms (949 MiB/s) |
| `scanEnd` at the 25 MiB desktop cap | 25 MiB | **31 ms** (804 MiB/s) |
| `scanEnd` on a 55 MB noise file | 55 MB | 65 ms (Node) · 69.5 ms (Chromium) · 36 ms (Firefox) |
| Browser `createImageBitmap` decode, 16 MP | 4.2 MB | 269 ms (Chromium) · 384 ms (Firefox) |
| Browser `createImageBitmap` decode, 24 MP | 55 MB | **1 400 ms** (Chromium) · 1 458 ms (Firefox) |

Rejecting a 24 MP JPEG from its SOF (IMG-07, `G2.14 "JPEG 6000×4000 rejected from SOF before decode"`) therefore saves about 1.4 s and a ≈96 MB RGBA allocation, at a cost of under 1 µs. `scanEnd` costs about 2–5 % of a decode, so it is cheap enough to run on every accepted JPEG.

## 4. Findings (cross-browser, measured)

The full matrix is in `browser_*.json`.

| Input | `SBJpeg` | Chromium 152 `createImageBitmap` | Firefox 155 `createImageBitmap` | Note |
|---|---|---|---|---|
| baseline, progressive, gray, restart, 4:4:4, CMYK/Adobe, big APP2, fill bytes | OK | decodes | decodes | |
| Exif 1–8 (II and MM, Exif first or after APP0) | exif = N | applied (5–8 swap w/h) | applied | |
| `imageOrientation: "none"` | — | **ignored** (still rotated) | **ignored** | Confirms Appendix A #19 and the Coverage #8 "Modified" entry |
| arithmetic (SOF9/SOF10) | `unsupported` | decodes | **fails** | Browsers disagree |
| 12-bit (SOF1, P = 12) | `unsupported` | cIB **fails**; `<img>` "decodes" | fails | |
| lossless (SOF3) | `unsupported` | decodes | decodes | Safari not verified |
| height 0 (DNL) | `unsupported` | fails | fails | |
| truncated in scan data / missing EOI | header OK, `scanEnd.eoi = null` | cIB **fails**; `<img>` "decodes" | **decodes silently with white fill** (bottom-right pixel 255,255,255) | AT-22 is browser-dependent |
| 3 garbage bytes between segments | `BAD_SEGMENT` | fails | cIB fails; `<img>` decodes | Strict rejection matches cIB in both browsers |
| 1 MB trailing payload after EOI (Motion-Photo style) | OK, `trailing = 1048576` | decodes | decodes | Must not be rejected |
| XMP APP1 *then* Exif APP1 (orientation 6) | exif 6, **ambiguous** | **rotated** | **not rotated** | Browsers disagree |
| Exif whose single IFD entry is 2 bytes short (the T0.3 fixture's APP1 grafted onto a real image) | exif 6, **ambiguous** | **not rotated** | **rotated** | Browsers disagree |

### 4.1 Header inspection alone does not satisfy AT-22 for real truncated files

Real truncation (an interrupted download or copy) almost always cuts the scan data, after SOF. `inspect` accepts such a file by design. Firefox then decodes it without error and fills the missing area. G2.14 therefore needs the `scanEnd` EOI check to reject truncated JPEGs consistently. It costs 31 ms at the 25 MiB cap. A plain "last two bytes are FF D9" check is not enough, because it would reject files with trailing payload such as Motion Photos.

### 4.2 Decode with `createImageBitmap`, never `<img>`

In Chromium, `<img>.decode()` resolves for 12-bit and truncated files that `createImageBitmap` rejects.

### 4.3 The T0.3 fixture's Exif is malformed, and browsers disagree on it

In `jpegHeader` (`test/fixtures.js:60`), `Buffer.alloc(26)` leaves the single 12-byte IFD entry 2 bytes short. Chromium ignores that Exif and Firefox applies it. `SBJpeg` still returns `exif: 6`, so the plan's test passes unchanged, but it sets `exifAmbiguous: true`.

The one-token fix `Buffer.alloc(28)` makes the entry complete; a next-IFD pointer is not needed, because both browsers rotate without one. No golden depends on the fixture bytes: `run_tests.js:295` only checks SOI. `test_jpeg.js` carries the patched copy as `jpegHeaderFixed` and shows that it yields `exif 6`, not ambiguous.

### 4.4 Error-code boundary differs slightly from the plan wording

The plan's parenthetical maps "a segment length past EOF" to `JPEG_BAD_SEGMENT`. From a short buffer, though, an oversized length and a genuinely truncated file are indistinguishable. The spike therefore uses this rule:

- `JPEG_BAD_SEGMENT` means the segment is internally inconsistent: L < 2, SOF L ≠ 8 + 3·Nc, Nc = 0, a non-FF byte where a marker must be, or FF00 or a second SOI before SOF;
- `JPEG_TRUNCATED` means the data ends inside an otherwise consistent marker, length or segment.

The SOF-length/Nc consistency check runs first, so `sofLen: 4000` is still `BAD_SEGMENT`. All five plan tests pass under this rule.

## 5. Decision

**Recommendation: adopt `spikes/S4b/jpeg.js` as `js/jpeg.js`** (§4 order: after `png`, before `height`). Add its tests as suite `spike S4b` in `test/run_tests.js`: the five plan tests plus the edge, fixture and fuzz checks that do not need the on-disk corpus. Keep the corpus and browser probe as dev-only material for G4.8.

## 6. Recommended plan amendments

1. **G2.14 / `SBSchema.preflight`.** After `SBJpeg.inspect`:
   - reject `SBJpeg.unsupported(info) !== null` with a new code `JPEG_UNSUPPORTED`. This covers 12-bit, arithmetic, lossless, hierarchical, a zero dimension, and component counts other than 1, 3 or 4. Lossless decodes in Chromium and Firefox, so it could be relaxed after a manual Safari check;
   - reject `SBJpeg.scanEnd(bytes, info.headerBytes).eoi === null` with `JPEG_TRUNCATED`.

   Add the AT-22 test `truncated-in-scan JPEG rejected before decode`.
2. **G2.14 decode path.** Use `createImageBitmap(blob)`, not `<img>`. Record `orientation.exif` from `inspect`, and add a warning `EXIF_AMBIGUOUS` when `info.exifAmbiguous` is set ("browsers disagree on this file's orientation — check the preview").
   - When `exif ∈ 5..8` and the decoded bitmap is **not** w/h-swapped relative to SOF, record what the browser actually did rather than the parsed value.
   - Square images and orientations 2–4 cannot be verified this way; they are covered by the ambiguity flag.
3. **T0.3 fixture.** Change `Buffer.alloc(26)` to `Buffer.alloc(28)` in `jpegHeader`, so `IMG-05 JPEG EXIF orientation 6 parsed` exercises an Exif that every browser honours.
4. **S4b interface text.** Document the extra fields and functions in §1, and the `TRUNCATED`/`BAD_SEGMENT` boundary in §4.4. G4.8 should include `xmp_then_exif6`, a truncated-in-scan file and an arithmetic file in its EXIF and decode checks, since these are where browsers diverge.

## 7. Reproduce

```sh
spikes/S4b/make_corpus.sh                                   # ~30 s, writes spikes/S4b/corpus/
node spikes/S4b/test_jpeg.js --bench --fuzz 50000           # 82 checks + benchmark
node spikes/S4b/run_browser.js > spikes/S4b/browser_chromium.json
node spikes/S4b/run_firefox.js > spikes/S4b/browser_firefox.json
```
