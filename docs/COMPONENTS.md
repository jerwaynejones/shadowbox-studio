# Third-party components (NFR-11)
| Name | Version | License | File | SHA-256 | Obtained from | Build form (UMD/IIFE/shim) | Scope (runtime/dev-only) |
|---|---|---|---|---|---|---|---|
| `clipper2-ts` (TypeScript port of Angus Johnson's Clipper2 by Jeremy Tribby; https://github.com/countertype/clipper2-ts, original https://github.com/AngusJohnson/Clipper2) | 2.0.1-18 (tracks Clipper2 2.0.1) | BSL-1.0 (`js/vendor/LICENSE-clipper2.txt`, SHA-256 `ea056d2c64294936b226f7360c265e77c52adc4ba171ee61029357f101f439cf`) | `js/vendor/clipper2.js` (125,483 B; 34,160 B gzip -9) | `3770b90cddbfca46596ef944117f66c67325870708ffd7eb7aa289080b888994` | npm registry tarball https://registry.npmjs.org/clipper2-ts/-/clipper2-ts-2.0.1-18.tgz (SHA-256 `bc3b35e95af820936678c20bf363b23a76c7cfebc255a8d8a3cc6d408ffef561`; registry sha512 `WuRO1ZHzyYTVHY78r4wVWVydvQ+1lx9qZ+DeZa/8zhvrxIgCVzElJ6lwSMGtUUKFPefhvfJsHZ5C9RNkgisCOQ==`), file `package/dist/clipper2.min.mjs` (SHA-256 `fd23888bc7158e7ba9ce4e5d8b73e31c1bcfcd59c028ffc38b5d36f3f26d676f`, 125,095 B), fetched with curl (no npm) | ESM bundle → classic-script IIFE shim (`spikes/S1/tools/wrap_clipper2.js`: rewrites only the trailing `export{…}` into `global.Clipper2 = Object.freeze({…})` and drops the sourceMappingURL; body byte for byte; reproducible) | runtime (exposes `global.Clipper2`, 108 exports; needs ES2020 `BigInt`; used only through `SBGeom` in `js/geom.js`) |

## Notes

### clipper2-ts 2.0.1-18 (decision D2, spike S1)

- **Rebuild and verify:** `node spikes/S1/tools/wrap_clipper2.js spikes/S1/vendor/clipper2-ts-2.0.1-18.min.mjs js/vendor/clipper2.js && sha256sum js/vendor/clipper2.js` must print `3770b90c…8994` (the full value is pinned in the table and in `test/run_tests.js`, suite "spike S1 — vendor load forms and pin").
- **Licence in the bundle:** `build.js` embeds `js/vendor/LICENSE-clipper2.txt` verbatim in a leading HTML comment of `dist/shadowbox-studio.html`, next to the upstream MIT notice, because the single-file bundle ships the library as source text.
- **Determinism (NFR-05):** the upstream source has no `Math.random` or `Date`. Trig appears only in round-join/round-end setup and `ellipse`, which `SBGeom` never reaches (`"round"` is refused; circles come from the integer table in `SBGeom.circle`).
- **Why not `clipper2-js` 1.2.4:** older (2024-01, Clipper2 1.2.x) and no BigInt-exact predicates. Both are ESM-only BSL-1.0 and would need the same shim. See `docs/spikes/S1.md`.
