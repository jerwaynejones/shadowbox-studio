# Large-image benchmark, per-device pixel budgets (G2.2b) and complexity caps (G2.7b)

Plan task G2.2b (PO-LASER-4/9, NFR-03/04, AT-24). Raw results: [`large-image.json`](large-image.json).
Decision recorded as D6 in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) (the laser-detail table) and in
Appendix D of the [development plan](../plans/opaque-layers-dev-plan.md).

## Result

| | Budget | Gated row | Bonded p95 | Target | Working set | Limit |
|---|---|---|---|---|---|---|
| **Desktop** | **25 Mpx** (`SBSchema.limits("desktop").fabPxBudget = 25000000`) | `r25` 5774 × 4330 | 9749.1 ms | 10 s (not relaxed: `r16` 7198.8 ms ≤ 10 s) | 404.4 MiB | 512 MiB |
| **Mobile** | **1 Mpx** (`SBSchema.limits("mobile").fabPxBudget = 1000000`), fabrication **enabled** | `r1` 1155 × 866 | 1820.3 ms × k 4 = 7281.2 ms | 8 s (k = 4 provisional) | 62.6 MiB | 192 MiB |
| SRS desktop reference (§12.3) | — | `srs-desktop` 1536 × 1536 | 2728.4 ms | 10 s (NFR-03) | 107.5 MiB | 512 MiB |

No stop condition fired (16 Mpx is 232.3 MiB ≤ 512 MiB; the desktop target is not relaxed), the gate passes
(`overBudget: []`), and mobile is not draft-only, so `FAB_DEVICE_DRAFT_ONLY` is not needed and is not registered.
Connected mode is reported only (KI-CONN-PERF): 16.5 s on the SRS desktop reference, 47.3 s at `r25`, and
11.5 s × 4 at `r1`, all listed by the bench as `KNOWN-OVER (tracked)`.

## Machine

Linux development machine: Intel i7-11800H (8 cores / 16 threads), 62.5 GiB, Node v26.7.0 (V8 14.6), geometry
backend `clipper2-ts@2.0.1-18`. The benchmark is single-threaded. Budgets measured here are expected to be
conservative for the owner's MacBook Air M5. Safari / JavaScriptCore coverage is G4.8, and the mobile factor k is
measured on the ≥ 4 GB reference device in G4.4.

## Method: a shortened run

**Product-owner decision, 2026-10-08:** the full G2.2b run (5 warm-up + 30 runs at the gated points, 1 + 5
elsewhere) was stopped after about 6.5 h as overly thorough. A shortened run replaces it:

1. **Preserved rows (provenance `log`).** The rows that the stopped run had completed count as measured data.
   They are taken from its `[large]` summary lines
   ([`raw/large-full-partial.log`](raw/large-full-partial.log), 02:06–08:44 on 2026-10-08): `srs-desktop`,
   `srs-mobile`, `r1`, `r1.25`, `r1.5`, `r2`, `r4`, `r6`, `r8`, `r9`, `r12`, `r16`, `r20`, `b4`, `b9`, `b12`,
   `b16`.
2. **Live rows (provenance `live`).** Only the rows still needed for the decision were run:
   `node test/bench.js large --only r25,laser470 --large-runs 5 --no-fail --json …`, 08:46–09:00, 1 warm-up + 5
   runs each ([`raw/large-short.log`](raw/large-short.log), [`raw/large-short.json`](raw/large-short.json)).
   These counts are the defaults for both rows, so `--large-runs 5` changed nothing except the
   `runsOverridden` flag.
3. **Skipped.** The remaining busy rows `b20`, `b25` and `laser470-busy` were not measured. The busy family is
   reported, never gated, and the measured busy rows already show that cost follows part count, not pixels
   (below).
4. **Run counts.** Every row ran at its `LARGE_WORKLOADS` default: 5 + 30 for the calibration rows, `r1`,
   `r1.25`, `r1.5`, `r2`, `r4`, `r6`, `r8` and `r16`; 1 + 5 for the rest. Each row's wall time is consistent
   with its count (about 34 s per pass at 8–9 Mpx for both `r8` at 36 passes and `r9` at 7 passes).
5. **Assembly.** `docs/perf/large-image.json` is built from the summary lines, not from full row objects, with:

   ```
   node test/bench.js large-assemble \
     --logs docs/perf/raw/large-full-partial.log=log,docs/perf/raw/large-short.log=live \
     --env docs/perf/raw/large-short.json \
     --loads docs/perf/raw/load-full-partial.txt=full-partial,docs/perf/raw/load-short.txt=shortened --record
   ```

   The rows then go through the same `decideLarge` / `gateLarge` rule as a live `--record` run. The JSON
   records `method: "shortened"`, a `shortened` block (decision, sources with the row ids for each provenance,
   skipped rows, run counts, load samples), and `source` (`log` | `live`) and `detail: "summary-line"` on every
   row.
6. **Missing detail.** A summary line carries only the bonded and connected p95, working set, maximum parts per
   layer and wall time. Per-stage p50/p95/max, vertex counts (`shape.maxVerticesPerLayer`, `verticesBonded`),
   contact counts and per-row load averages are therefore `null` for all 19 rows, live rows included (the live
   run's `--json` output keeps only the reduced rows).

**Load.** A background 1-minute load of about 3–4 came from desktop processes: DisplayLinkManager at about 50 %
CPU, Firefox, Hyprland, and short-lived `fuser /dev/video*` probes. The single-threaded benchmark adds about 1.
Sampled 1-minute load:

| Run | Samples | 1-min min / median / max | Start → end (1/5/15 min) |
|---|---|---|---|
| Stopped full run, 02:06–08:44 | 200 (every 2 min) | 3.12 / 4.77 / 8.81 | 4.86 5.11 8.73 → 5.45 4.45 4.16 |
| Shortened live run, 08:46–08:58 | 25 (every 30 s) | 3.53 / 5.32 / 6.05 | 5.70 4.87 4.35 → 5.42 5.18 4.70 |

On 16 threads this is moderate contention. All p95 figures include it, and it matters most where the margin is
thin (`r25`, below). The load files in `raw/` keep only the time and load columns of the monitor output.

**Stages timed** (per run, `methodDetail` in the JSON): final + validation = trace + `SBMaterial.fromMasks` at
fabrication quality, then the adjacent-pair `difference` in both directions, then the support pass (one
layer-level `intersection` per adjacent pair, `classifyContact` and then `survivesInset` at the advisory width).
(Since G2.7 the support slot runs `SBSupport.validate` with the upward differences reused; the rows below predate that change and were not re-run, see `SUPPORT.md`.) These are timed for bonded mode (D1 unsmoothed, **gated**) and connected mode (G1.2 smoothing, reported). The
working set is one gc'd instrumented pass: the peak of `arrayBuffers + heapUsed` above the pre-pipeline baseline
(algorithm-owned, SRS §12.3).

## All rows

Bonded p95 is gated; connected p95 is reported only (KI-CONN-PERF). "×ref" is bonded p95 divided by the SRS
desktop reference. 5+30 and 1+5 are warm-up + timed runs.

| Row | Pixels | Family | Runs | Bonded p95 ms | ×ref | Connected p95 ms | Working set MiB | Parts/layer (max) | Wall s | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| srs-desktop | 1536 × 1536 (8 layers) | realistic | 5+30 | 2728.4 | 1.00 | 16525.4 | 107.5 | 103 | 705.3 | log |
| srs-mobile | 768 × 768 (6 layers) | realistic | 5+30 | 1258.8 | 0.46 | 6681.2 | 38.2 | 95 | 297.6 | log |
| r1 | 1155 × 866 | realistic | 5+30 | 1820.3 | 0.67 | 11468.5 | 62.6 | 120 | 494.1 | log |
| r1.25 | 1291 × 968 | realistic | 5+30 | 2492.2 | 0.91 | 12105.1 | 64.6 | 120 | 534.7 | log |
| r1.5 | 1414 × 1061 | realistic | 5+30 | 2191.3 | 0.80 | 13026.1 | 74.9 | 120 | 568.3 | log |
| r2 | 1633 × 1225 | realistic | 5+30 | 2430.4 | 0.89 | 15671.5 | 78.9 | 120 | 675.2 | log |
| r4 | 2309 × 1732 | realistic | 5+30 | 3304.9 | 1.21 | 20014.5 | 144.3 | 120 | 871.5 | log |
| r6 | 2828 × 2121 | realistic | 5+30 | 4252.9 | 1.56 | 23528.8 | 212.5 | 120 | 1045.9 | log |
| r8 | 3266 × 2449 | realistic | 5+30 | 4670.7 | 1.71 | 27404.9 | 164.1 | 120 | 1223.9 | log |
| r9 | 3464 × 2598 | realistic | 1+5 | 4733.4 | 1.73 | 27441.8 | 188.8 | 120 | 240.5 | log |
| r12 | 4000 × 3000 | realistic | 1+5 | 5958.4 | 2.18 | 31197.0 | 216.5 | 120 | 280.6 | log |
| r16 | 4618 × 3464 | realistic | 5+30 | 7198.8 | 2.64 | 35137.7 | 232.3 | 120 | 1567.0 | log |
| r20 | 5164 × 3873 | realistic | 1+5 | 8526.3 | 3.13 | 37674.7 | 304.9 | 120 | 333.0 | log |
| **r25** | 5774 × 4330 | realistic | 1+5 | **9749.1** | 3.57 | 47273.1 | 404.4 | 120 | 420.3 | **live** |
| **laser470** | 3525 × 4700 (352.5 × 470 mm at 0.1 mm/px) | realistic | 1+5 | **6813.0** | 2.50 | 36602.3 | 269.2 | 116 | 318.2 | **live** |
| b4 | 2309 × 1732 | busy | 1+5 | 35393.9 | 12.97 | 98384.4 | 204.9 | 1991 | 945.4 | log |
| b9 | 3464 × 2598 | busy | 1+5 | 87898.5 | 32.22 | 241957.3 | 706.2 | 4603 | 2326.7 | log |
| b12 | 4000 × 3000 | busy | 1+5 | 123829.4 | 45.39 | 332890.1 | 516.7 | 6097 | 3232.1 | log |
| b16 | 4618 × 3464 | busy | 1+5 | 163236.0 | 59.83 | 462258.4 | 446.8 | 8092 | 4421.3 | log |
| b20, b25, laser470-busy | — | busy | — | not measured (shortened run) | | | | | | — |

## Decision rule applied (bonded mode)

- **Desktop.** Target 10 s, because `r16` meets it (7198.8 ms). Candidates 16, 20 and 25 Mpx all have working
  set ≤ 512 MiB and p95 ≤ 10 s: `r20` 8526.3 ms / 304.9 MiB, `r25` 9749.1 ms / 404.4 MiB. **Budget 25 Mpx.**
- **Mobile.** Working set ≤ 192 MiB and desktop p95 × 4 ≤ 8 s: `r1` 7281.2 ms passes; `r1.25` (9968.8 ms),
  `r1.5` (8765.2 ms), `r2` and larger fail. **Budget 1 Mpx, fabrication enabled.** `r1.25` measured slower than
  `r1.5`, which inverts the expected order. Read this as run-to-run noise under load, not a real effect.
- **SRS desktop reference** 2728.4 ms ≤ 10 s.
- **Escalation:** none.

## Caveats

- **Thin desktop margin.** `r25` is only 2.5 % under the 10 s target, measured with 1 + 5 runs at a 1-minute
  load of about 5. G4.4 re-measures the laser-detail rows on the reference machines. If `r25` then misses
  10 s, the rule falls back to 20 Mpx (`r20`, 8.5 s).
- **IMG-07 caps sources** at 16 MP (desktop) and 8 MP (mobile), and the engine never upsamples. Until IMG-07 is
  raised (D6 SRS deviation 4), a 25 Mpx budget only stops the budget from capping the pitch. Example: the
  470 mm page (3525 × 4700, 16.6 Mpx) now plans uncapped at 0.1 mm/px, where the provisional 16 Mpx budget
  coarsened it to 102 µm. A 16 MP source still limits it (`FAB_EXCEEDS_SOURCE`).
  **Resolved 2026-10-08 (product owner, laser target):** the desktop source cap is raised to 25 MP, equal to
  this budget (`SBSchema.limits("desktop").maxSourcePx === fabPxBudget`), so a source of up to 25 MP feeds the
  full fabrication raster; mobile stays 8 MP. A documented deviation from SRS IMG-07 (ARCHITECTURE D6 item 14).
- **Mobile at 1 Mpx is coarse.** A 300 mm-high 4:3 page plans at 0.347 mm/px. The 470 mm page plans at
  0.408 mm/px, which is about 3.7 samples across the 1.5 mm minimum feature: within GEO-06 (≥ 3) and under the
  0.5 mm/px `SAMPLING_LOW` limit, but close to both. Larger pages on mobile will reach `SAMPLING_LOW`. k = 4 is
  provisional; the measured k from G4.4 resets the mobile budget.
- **Busy art: cost follows part count, not pixels.** At the same pixel count, `b4` is 10.7 × `r4` and `b16` is
  22.7 × `r16`. Bonded time grows with parts per layer: about 2k → 8k parts/layer gives 35 → 163 s at 4–16 Mpx,
  while the realistic rows stay at about 120 parts/layer and under 10 s up to 25 Mpx. A pixel budget therefore
  cannot bound busy art. That is the job of the complexity caps and busy-art simplification, which the plan now
  pulls forward into G2 as **G2.7b**, right after the support task G2.7. The G4.1 worker pool is the other
  mitigation (per-layer / per-pair parallelism).
- **Complexity starting point** (for G2.7b): realistic rows at the budgets peak at 120 parts/layer (`r1`, `r25`).
  Busy rows: 1991 (4 Mpx), 4603 (9 Mpx), 6097 (12 Mpx), 8092 (16 Mpx) parts/layer, with working set up to
  706.2 MiB (`b9`, over the 512 MiB desktop limit). The shortened run recorded no vertex counts. G2.7b measures
  them when it sets the caps.

## G2.7b: complexity caps and busy-art simplification (2026-10-08)

Plan task G2.7b (SRS §12.3, NFR-03/04/05, PO-LASER-9). Raw results: [`complexity.json`](complexity.json)
(`rows` and `decision` from `node test/bench.js caps --record`; `variantRows` from
`node test/bench.js large --only b4,b9,r25 --caps desktop [--simplify busy] --bonded-only --record`), logs in
[`raw/caps.log`](raw/caps.log), [`raw/caps-large.log`](raw/caps-large.log) and
[`raw/caps-large-b.log`](raw/caps-large-b.log). Same machine as above, load average 6–9 throughout (other
desktop processes), 1 warm-up + 5 runs per row, bonded mode only (the gated mode; connected is not run).

### Caps

| | Parts per layer | Vertices per layer | Vertices total | Source |
|---|---|---|---|---|
| **Desktop** | **258** | **132,000** | **356,000** | measured (below) |
| **Mobile** | **100** | **20,000** | **20,000** | SRS §12.3 mobile workload (SRS:L562); per layer bounded by the total |

`SBSchema.limits(deviceClass)` carries them; the test `§12.3/PO-LASER-9 desktop caps equal the measured decision in
docs/perf/complexity.json` keeps them in step, and `decideCaps` must reproduce the recorded decision from the
recorded rows.

**Desktop rule.** At the desktop budget (5774 × 4330 = 25 Mpx, 8 layers, 0.1 mm/px) the busy family is generated
with larger noise cells, so it has fewer and larger parts per layer. Each row times the capped workload: the
pre-trace estimate (`SBConstruct.estimateComplexity`), then `SBMaterial.fromMasks` (fabrication, D1 unsmoothed),
the adjacent-pair differences, and `SBSupport.validate`. The parts cap is the largest parts/layer at which every
busy row with as many or fewer parts meets **10 s** bonded p95 and **512 MiB**. The vertex caps admit every row that
passes under that parts cap, plus the realistic art at the budget, rounded up to 1,000. The run's own decision, printed in
`raw/caps.log` and `raw/caps.json`, used the first form of the vertex rule: that row and `r25` only, giving
122,000 / 337,000. The recorded decision was then recomputed from the same rows with `decideCaps` in its final
form, which also admits `c200`, giving 132,000 / 356,000. No re-measurement was needed.

| Row | Cell px | Parts/layer | Vertices (max/layer) | Bonded p95 | Estimate p95 | Support p95 | Live set | G2.2b-method peak |
|---|---|---|---|---|---|---|---|---|
| `r25` (realistic) | — | 120 | 182,556 (49,450) | 5.76 s | 168 ms | 107 ms | 429.1 MiB | 477.8 MiB |
| `c240` | 240 | 176 | 284,214 (110,536) | 8.29 s | 226 ms | 406 ms | 429.1 MiB | 559.6 MiB |
| `c224` | 224 | 192 | 328,872 (111,960) | 8.93 s | 183 ms | 603 ms | 429.1 MiB | 527.5 MiB |
| `c200` | 200 | 250 | 355,322 (131,756) | 9.72 s | 205 ms | 633 ms | 429.1 MiB | 589.0 MiB |
| **`c208`** (cap) | 208 | **258** | 336,448 (121,258) | **9.64 s** | 203 ms | 540 ms | 429.0 MiB | 577.9 MiB |
| `c192` (first over) | 192 | 309 | 364,158 (133,536) | 10.21 s | 206 ms | 953 ms | 429.1 MiB | 714.3 MiB |
| `c176` | 176 | 340 | 403,416 (150,630) | 10.84 s | 248 ms | 891 ms | 429.0 MiB | 487.8 MiB |

The desktop caps sit well above the SRS §12.3 desktop envelope (250 parts/layer, 50,000 vertices) on parts, and far
above it on vertices: bonded contours are unsmoothed pixel staircases (D1), so realistic art at 25 Mpx already has
182,556 vertices.

**Working set: live set, not the G2.2b peak.** The G2.2b method samples `arrayBuffers + heapUsed` after every
stage without collecting garbage. In bonded-only rows that peak swings by up to 250 MiB between neighbouring rows
(`c208` 578 MiB, `c192` 714 MiB, `c176` 488 MiB) and does not follow the part count. G2.7b therefore adds a second
instrumented pass that calls `gc()` before every stage-boundary sample (the **live set**) and applies the 512 MiB
rule to that pass. The live set is about 429 MiB in every row. It is dominated by the pixel buffers the bench holds
at 25 Mpx (8 height masks plus 8 tonal masks that are computed only for timing), not by geometry. It is a lower
bound, because peaks inside a stage are not sampled. Both values are recorded. The realistic `r25` row reads
478–513 MiB by the G2.2b method in bonded-only runs, against 404 MiB in the G2.2b run with connected mode. G4.4
re-measures the desktop working set on the reference machine.

**Mobile: the SRS caps do not admit the realistic art at the mobile budget.** At 1 Mpx (`r1`, 1155 × 866) the
realistic art has 120 parts/layer and 36,582 vertices on the raw masks. After the bonded construction chain
(`SBConstruct.bonded`, 1.5 mm features) it still has 93 parts/layer and 31,944 vertices. The SRS mobile workload
size (768 × 768, 8 layers) has 25,588. That is over the 20,000-vertex cap, so mobile fabrication of such art fails
with `COMPLEXITY_LIMIT`, and busy-art simplification does not lower the vertex count enough to help. The plan
fixes the mobile caps at the SRS values. This is **open for the product owner** (see the D6 item 13 note) and
does not block G2.7b. G2.10a enforces the caps.

### Busy rows with the caps and with simplification (`large --only b4,b9,r25 … --bonded-only`)

| Row | `--caps desktop` | `--caps desktop --simplify busy` |
|---|---|---|
| `b4` (4 Mpx busy, 1,991 parts/layer) | `COMPLEXITY_LIMIT` in 113 ms (layers 3–6 over 258) | ok: 85 parts/layer, 77,320 vertices, **3.70 s** (simplify + estimate 1.01 s) |
| `b9` (9 Mpx busy, 4,603 parts/layer) | `COMPLEXITY_LIMIT` in 321 ms | ok: 211 parts/layer, 172,390 vertices, **8.08 s** (simplify + estimate 2.41 s) |
| `r25` (25 Mpx realistic) | ok: **7.61 s** (estimate 256 ms; support 87 ms) | ok: 64 parts/layer, 161,614 vertices, **14.18 s** (simplify + estimate 5.71 s) |

Without caps, G2.2b measured `b4` at 35.4 s and `b9` at 87.9 s bonded. With the caps, busy art now fails in a
fraction of a second and returns no geometry, or, with **Simplify busy art**, it runs in 3.7 s and 8.1 s.
Simplification changes the art, and the before/after counts in `BUSY_SIMPLIFIED` show by how much. On `b4`, for
example, layers 6–7 become empty (1,074 and 33 parts dropped as smaller than 25 mm² after merging). Simplification
is a full-image closing plus component filtering. At 25 Mpx it costs about 5.5 s, so a
simplified 25 Mpx image misses the 10 s target. Simplification is opt-in and never needed by realistic art, so the
cost is reported here, not gated. The G4.1 worker pool (per layer) is the planned mitigation. The first variant
run used a provisional 309-part cap (the decision before the estimate cost was included). `b4` and `b9` were
re-run at the final 258-part cap ([`raw/caps-large-b.log`](raw/caps-large-b.log)). The other variant rows are
admitted under either cap.

**Support stage on the large workloads (G2.7 `SBSupport.validate`).** p95 is 87–107 ms on realistic `r25`, and
0.4–0.95 s on the busy rows at 176–340 parts/layer. The G2.2b rows were timed with the pre-G2.7 pass and were not
re-run.

## Re-running

- Gate against the recorded decision: `node test/bench.js large --only srs-desktop,r1,r25`. This measures those
  rows, merges them over the recorded ones, and gates them. It writes nothing unless `--record` is added; with
  `--record`, the rule is re-applied and the rows are stored as `source: "live"`.
- Full re-measure (hours): `node test/bench.js large --record`. Once every row is live at its default count, the
  JSON records `method: "full"`.
- Complexity caps (G2.7b, about 15 min): `node test/bench.js caps --record` re-measures the desktop rows and
  rewrites `complexity.json` `rows` and `decision`. Copy the decision into `SBSchema.limits` (the test fails until
  they match). `node test/bench.js large --only b4,b9,r25 --caps desktop [--simplify busy] --bonded-only --record`
  updates `variantRows`; such runs never touch `large-image.json`.
- Fast checks in `node test/run_tests.js`: `PO-LASER-4 SBSchema.limits budgets equal docs/perf/large-image.json`,
  `PO-LASER-9 large-image targets recorded for desktop and mobile`, and the reproducibility and provenance checks
  next to them.
