// test/pool_corpus.js — speed round F0 (plan Appendix F, NFR-05): the pool-equality golden corpus.
//
// corpus()          → [{id, project, source, quality, overlays, draftCapPx, deviceClass, slow, expect}]
//                     A fixed fixture matrix over the engine's branches. Every fixture pins geometry.draftPx and
//                     draftCapPx explicitly (draftPx ≤ draftCapPx, so the cap never binds and F17's preset or
//                     DRAFT_BUDGET change cannot move the golden). project/source are built lazily (getters, cached).
//                     Fixtures whose source is above 2 Mpx are tagged slow (run_tests.js runs them only with --slow).
//                     expect(response) is a coverage predicate: the fixture still exercises the branch it is named for.
// run(fx)           → GenerateResponse of the serial engine (sync driver) for one fixture.
// digest(response)  → {status, code, geometryHash, layerHashes, diagSha, cleanupSha, supportSha, guidesSha, statsSha, wholeSha}
//                     wholeSha = sha256(stableStringify(response minus requestId/timing)).
// deepEqualStrict(a, b) → boolean. Object.is on leaves, typed arrays by constructor and bytes, exact own-key sets
//                     (undefined-valued keys count), array length and extra own properties. stableStringify drops
//                     undefined keys and ignores key order, so F9/F12/F16 compare live pool and serial responses with this.
//
// Loads nothing itself: the caller has evaluated test/modules.js NODE_MODULES into globalThis (run_tests.js,
// capture_golden.js). The golden lives in test/golden/pool-equality.json (capture_golden.js --pool-equality).
"use strict";
const F = require("./fixtures.js");
const { scene } = require("../tools/alpha3_scene.js");

const DRAFT_CAP = 720;          // = SBSchema.limits(desktop|mobile).draftPxCap at alpha.3; pinned per fixture
const SLOW_PX = 2e6;            // fixtures whose source has more pixels than this are slow

// ---------------------------------------------------------------- sources (cached per key)
const srcCache = new Map();
function cached(key, make) { if (!srcCache.has(key)) srcCache.set(key, Object.freeze(make())); return srcCache.get(key); }
function rgbToRgba(rgb, w, h) { const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { o[4 * i] = rgb[3 * i]; o[4 * i + 1] = rgb[3 * i + 1]; o[4 * i + 2] = rgb[3 * i + 2]; o[4 * i + 3] = 255; } return o; }
const alpha3 = (w, h) => cached("a3:" + w + "x" + h, () => ({ pixels: rgbToRgba(scene(w, h), w, h), channels: 4, w, h, alpha: null }));
const gray = (key, w, h, fn) => cached(key, () => ({ pixels: fn(w, h), channels: 1, w, h, alpha: null }));
const height = (seed, w, h, blobs) => gray("hm:" + seed + ":" + w + "x" + h + ":" + blobs, w, h, () => F.heightMap(seed, w, h, blobs));
const busy = (seed, w, h, cell) => gray("busy:" + seed + ":" + w + "x" + h + ":" + cell, w, h, () => F.busyHeightMap(seed, w, h, cell));
/** A colour source with a transparent surround (alpha plane): exercises the alpha domain (kuwaharaDomainOnce). */
const withAlpha = (w, h) => cached("alpha:" + w + "x" + h, () => {
  const base = alpha3(w, h), a = new Uint8Array(w * h), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = ((x - cx) / (0.42 * w)) ** 2 + ((y - cy) / (0.4 * h)) ** 2; a[y * w + x] = d <= 1 ? 255 : d <= 1.1 ? 128 : 0; }
  return { pixels: base.pixels, channels: 4, w, h, alpha: a };
});
/** Three flat colours: with 6 balanced bands some bands are empty (EMPTY_BAND). */
const fewTones = (w, h) => cached("tones:" + w + "x" + h, () => {
  const o = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < w / 3 ? 30 : x < (2 * w) / 3 ? 128 : 230, i = 4 * (y * w + x); o[i] = v; o[i + 1] = v; o[i + 2] = v; o[i + 3] = 255; }
  return { pixels: o, channels: 4, w, h, alpha: null };
});
/** Low heights only: the upper layers of a white-high stack stay empty (TRAILING_OMITTED). */
const lowHeights = (w, h) => gray("low:" + w + "x" + h, w, h, () => F.heightMap(11, w, h).map((v) => v >> 2));
const tiny = (key, w, h) => cached(key, () => { const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { const v = (i * 67) % 256; o.set([v, 255 - v, (v * 3) & 255, 255], 4 * i); } return { pixels: o, channels: 4, w, h, alpha: null }; });

// ---------------------------------------------------------------- projects
const clone = (o) => JSON.parse(JSON.stringify(o));
/** project(preset, source, mode, edit) → a valid project with the source installed (sampleHash = sha256 of sampleBytes). */
function project(preset, px, mode, edit) {
  const S = globalThis.SBSchema, E = globalThis.SBEngine;
  let p = S.defaults(preset);
  const rec = E.sourceRecord(px, { format: "png", decode: px.channels === 4 ? "canvas-tonal" : "raw-gray8" });
  rec.sampleHash = globalThis.SBHash.sha256(E.sampleBytes(px));
  p = S.withSource(p, rec);
  if (p.interpretation.mode !== mode) p = S.applyModeChange(p, { interpretation: { mode } }, true);
  p = clone(p);
  p.geometry.draftPx = 360;   // pinned (≤ DRAFT_CAP); edits may lower it
  if (edit) edit(p);
  const v = S.validate(p);
  if (!v.ok) throw new Error("pool_corpus: invalid project: " + v.errors.slice(0, 3).map((e) => e.path + " " + e.code).join("; "));
  return p;
}

// ---------------------------------------------------------------- fixture matrix
const has = (code) => (r) => (r.diagnostics || []).some((d) => d.code === code);
const done = (r) => r.status === "done";
const both = (...fs) => (r) => fs.every((f) => f(r));

/** spec: {id, src: () => px, preset, mode, edit?, qualities?, deviceClass?, overlays?, expect?} */
const SPECS = [
  // alpha.3 scene, tonal bonded plywood (inset-outline guides), the user's case at two sizes
  { id: "a3-900", src: () => alpha3(900, 675), preset: "plywood", mode: "tonal", edit: (p) => { p.geometry.draftPx = 720; }, expect: done, w: 900, h: 675 },
  { id: "a3-900-nooverlay", src: () => alpha3(900, 675), preset: "plywood", mode: "tonal", qualities: ["draft"], overlays: false,
    edit: (p) => { p.geometry.draftPx = 720; }, expect: (r) => done(r) && r.snapshot.cleanupReport.every((c) => c.added === undefined && c.removed === undefined), w: 900, h: 675 },
  { id: "a3-1800", src: () => alpha3(1800, 1350), preset: "plywood", mode: "tonal", edit: (p) => { p.geometry.draftPx = 720; }, expect: done, w: 1800, h: 1350 },
  // height mode, bonded (default plywood) and connected (smooth corners → smoothStack barrier, frame + registration holes)
  { id: "h-bonded", src: () => height(7, 240, 180), preset: "plywood", mode: "height", edit: (p) => { p.geometry.targetMM = 120; }, expect: both(done, (r) => r.snapshot.guides !== null) },
  { id: "h-connected", src: () => height(7, 240, 180), preset: "acrylic", mode: "height",
    edit: (p) => { p.geometry.widthMM = 120; p.geometry.targetMM = 120; }, expect: (r) => done(r) && r.snapshot.construction.mode === "connected-sheet" && r.snapshot.page.frameMM > 0 && r.validatedLayers.every((L) => L.holes.length === 4) },
  // tonal light-front and dark-front
  { id: "t-light", src: () => alpha3(360, 270), preset: "plywood", mode: "tonal", edit: (p) => { p.interpretation.polarity = "light-front"; p.geometry.targetMM = 150; }, expect: done },
  { id: "t-dark", src: () => alpha3(360, 270), preset: "plywood", mode: "tonal", edit: (p) => { p.interpretation.polarity = "dark-front"; p.geometry.targetMM = 150; }, expect: done },
  // connected tonal (acrylic preset: frame on, registration holes, smooth corners, Kuwahara r > 0)
  { id: "t-connected-frame", src: () => alpha3(360, 270), preset: "acrylic", mode: "tonal", edit: (p) => { p.geometry.widthMM = 150; p.geometry.targetMM = 150; },
    expect: (r) => done(r) && r.snapshot.page.frameMM > 0 && r.validatedLayers.every((L) => L.holes.length === 4) },
  { id: "t-connected-noframe", src: () => alpha3(360, 270), preset: "acrylic", mode: "tonal",
    edit: (p) => { p.geometry.widthMM = 150; p.geometry.targetMM = 150; p.construction.frame = { enabled: false, widthMM: 0 }; p.construction.cleanup.cornerStyle = "sharp"; },
    expect: (r) => done(r) && r.snapshot.page.frameMM === 0 && r.validatedLayers.every((L) => L.holes.length === 0) },
  { id: "t-bonded-frame", src: () => alpha3(360, 270), preset: "plywood", mode: "tonal",
    edit: (p) => { p.geometry.targetMM = 150; p.construction.frame = { enabled: true, widthMM: 10 }; }, expect: (r) => done(r) && r.snapshot.page.frameMM === 10 },
  // guides none / interior-mark (inset-outline is the plywood default above)
  { id: "g-none", src: () => height(5, 240, 180), preset: "plywood", mode: "height", edit: (p) => { p.geometry.targetMM = 120; p.construction.guides.mode = "none"; },
    expect: (r) => done(r) && r.snapshot.guides === null },
  { id: "g-interior", src: () => height(5, 240, 180), preset: "plywood", mode: "height", edit: (p) => { p.geometry.targetMM = 120; p.construction.guides.mode = "interior-mark"; },
    expect: (r) => done(r) && r.snapshot.guides !== null },
  // alpha domain (threshold) with Kuwahara on the domain
  { id: "alpha-domain", src: () => withAlpha(320, 240), preset: "plywood", mode: "tonal",
    edit: (p) => { p.geometry.targetMM = 120; p.source.alpha = { mode: "threshold", t: 0.5 }; p.interpretation.smoothing = { radiusMM: 1.65, passes: 2 }; }, expect: done },
  // sheet counts
  { id: "n2", src: () => height(9, 200, 150), preset: "plywood", mode: "height", edit: (p) => { p.geometry.targetMM = 100; p.construction.sheets = 2; }, expect: done },
  { id: "n3", src: () => alpha3(300, 225), preset: "acrylic", mode: "tonal", edit: (p) => { p.geometry.widthMM = 120; p.geometry.targetMM = 120; p.construction.sheets = 3; }, expect: done },
  { id: "n12", src: () => alpha3(300, 225), preset: "plywood", mode: "tonal", edit: (p) => { p.geometry.targetMM = 120; p.construction.sheets = 12; }, expect: done },
  // trailing-empty layers and empty bands
  { id: "trailing", src: () => lowHeights(200, 150), preset: "plywood", mode: "height", edit: (p) => { p.geometry.targetMM = 100; p.construction.sheets = 6; }, expect: has("TRAILING_OMITTED") },
  { id: "empty-band", src: () => fewTones(160, 120), preset: "plywood", mode: "tonal", edit: (p) => { p.geometry.targetMM = 80; p.construction.sheets = 6; }, expect: has("EMPTY_BAND") },
  // complexity: over the mobile parts cap (error, no layers) and the same with simplify "busy"
  { id: "complexity-error", src: () => busy(3, 300, 200, 9), preset: "plywood", mode: "height", deviceClass: "mobile", qualities: ["fabrication"],
    edit: (p) => { p.geometry.targetMM = 200; p.material.minFeatureMM = 0.3; p.material.advisoryFeatureMM = 0.3; p.material.minPartMM2 = 0.1; p.construction.cleanup.minFeatureMM = 0; },
    expect: (r) => r.status === "error" && r.error.code === "COMPLEXITY_LIMIT" },
  { id: "simplify-busy", src: () => busy(3, 300, 200, 27), preset: "plywood", mode: "height", edit: (p) => { p.geometry.targetMM = 120; p.construction.cleanup.simplify = "busy"; }, expect: has("BUSY_SIMPLIFIED") },
  // mobile device class
  { id: "mobile", src: () => alpha3(360, 270), preset: "plywood", mode: "tonal", deviceClass: "mobile", edit: (p) => { p.geometry.targetMM = 150; }, expect: done },
  // odd rasters
  { id: "odd-1xN", src: () => tiny("tiny:1x40", 1, 40), preset: "plywood", mode: "tonal", edit: (p) => { p.geometry.targetMM = 40; }, expect: () => true },
  { id: "odd-3x2", src: () => tiny("tiny:3x2", 3, 2), preset: "plywood", mode: "tonal", edit: (p) => { p.geometry.targetMM = 20; }, expect: () => true },
  // non-slow fine-pitch fixture: Kuwahara radiusPx ≥ 16 at fabrication (0.1 mm/px, smoothing 1.65 mm)
  { id: "fine-pitch", src: () => alpha3(400, 300), preset: "plywood", mode: "tonal", qualities: ["fabrication"],
    edit: (p) => { p.geometry.targetMM = 30; p.geometry.fabPitchMM = 0.1; p.interpretation.smoothing = { radiusMM: 1.65, passes: 2 };
      p.material.minFeatureMM = 0.5; p.material.advisoryFeatureMM = 0.5; p.material.minPartMM2 = 0.5; p.construction.cleanup.minFeatureMM = 0.5; p.construction.guides.mode = "none"; },
    expect: (r) => done(r) && globalThis.SBEngine.radiusPx(1.65, r.snapshot.geometry) >= 16 },
];

/** A replayed repair: one clip proposed on the draft of `h-bonded`'s project, then replayed at both qualities. */
function clipProject() {
  const E = globalThis.SBEngine, SP = globalThis.SBSupport;
  const base = project("plywood", height(7, 240, 180), "height", (p) => { p.geometry.targetMM = 120; });
  const d = E.generate(E.request(base, height(7, 240, 180), { quality: "draft", deviceClass: "desktop" })).snapshot;
  const k = d.layers.findIndex((L, i) => i >= 1 && L.material.length > 0);
  return SP.applyClip(base, SP.proposeClip(d, k < 1 ? 1 : k));
}

function lazy(o, key, make) { let v, have = false; Object.defineProperty(o, key, { enumerable: true, get: () => { if (!have) { v = make(); have = true; } return v; } }); }

function corpus() {
  const out = [];
  const add = (spec, quality, makeProject) => {
    const fx = { id: spec.id + "-" + quality, quality, overlays: spec.overlays !== false, draftCapPx: DRAFT_CAP, deviceClass: spec.deviceClass || "desktop",
      slow: spec.w * spec.h > SLOW_PX, expect: spec.expect || done };
    lazy(fx, "source", spec.src);
    lazy(fx, "project", makeProject);
    out.push(fx);
  };
  for (const s of SPECS) {
    const spec = Object.assign({ w: 0, h: 0 }, s);
    for (const q of spec.qualities || ["draft", "fabrication"]) add(spec, q, () => project(spec.preset, spec.src(), spec.mode, spec.edit));
  }
  const clip = { id: "repair-clip", src: () => height(7, 240, 180), expect: (r) => done(r) && r.snapshot.repairsApplied.length === 1 };
  let cp = null;
  for (const q of ["draft", "fabrication"]) add(Object.assign({ w: 0, h: 0 }, clip), q, () => cp || (cp = clipProject()));
  return out;
}

/** run(fx) → the serial engine's response for one fixture (sync driver). */
function run(fx) {
  const E = globalThis.SBEngine;
  const req = E.request(fx.project, fx.source, { quality: fx.quality, deviceClass: fx.deviceClass, requestId: fx.id, draftCapPx: fx.draftCapPx });
  return E.generate(req, { overlays: fx.overlays });
}

/** digest(response) → the golden record of one response (see the header). */
function digest(r) {
  const H = globalThis.SBHash, G = globalThis.SBGeom;
  const sha = (v) => H.hashJSON(v === undefined ? null : v);
  const s = r.snapshot || null;
  const rest = Object.assign({}, r); delete rest.requestId; delete rest.timing;
  return {
    status: r.status,
    code: r.error ? r.error.code : null,
    geometryHash: r.geometryHash || null,
    layerHashes: Array.isArray(r.validatedLayers) ? r.validatedLayers.map((L) => G.layerHashes(L).layerHash) : null,
    diagSha: sha(r.diagnostics || []),
    cleanupSha: sha(s ? s.cleanupReport : null),
    supportSha: sha(s ? s.supportGraph : null),
    guidesSha: sha(s ? s.guides : null),
    statsSha: sha(s ? s.stats : null),
    wholeSha: sha(rest),
  };
}

/** deepEqualStrict(a, b) — see the header. */
function deepEqualStrict(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (ArrayBuffer.isView(a)) {
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    if (a instanceof Float32Array || a instanceof Float64Array) for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(a) && a.length !== b.length) return false;
  const ka = Reflect.ownKeys(a), kb = Reflect.ownKeys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqualStrict(a[k], b[k])) return false;
  }
  return true;
}

module.exports = { corpus, run, digest, deepEqualStrict, DRAFT_CAP, SLOW_PX };
