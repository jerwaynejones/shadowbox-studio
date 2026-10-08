# Large-image benchmark and per-device pixel budgets (G2.2b)

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
These are timed for bonded mode (D1 unsmoothed, **gated**) and connected mode (G1.2 smoothing, reported). The
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

## Re-running

- Gate against the recorded decision: `node test/bench.js large --only srs-desktop,r1,r25`. This measures those
  rows, merges them over the recorded ones, and gates them. It writes nothing unless `--record` is added; with
  `--record`, the rule is re-applied and the rows are stored as `source: "live"`.
- Full re-measure (hours): `node test/bench.js large --record`. Once every row is live at its default count, the
  JSON records `method: "full"`.
- Fast checks in `node test/run_tests.js`: `PO-LASER-4 SBSchema.limits budgets equal docs/perf/large-image.json`,
  `PO-LASER-9 large-image targets recorded for desktop and mobile`, and the reproducibility and provenance checks
  next to them.
