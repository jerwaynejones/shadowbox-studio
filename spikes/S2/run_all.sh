#!/usr/bin/env bash
# Spike S2 (rework): full measured run. One Node process per config, in parallel, then merge.
# Usage: bash spikes/S2/run_all.sh        (≈ 20 min wall on 8+ cores; render.js is separate)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p results/raw
node s2_smoothing.js --configs none --checks --json results/raw/checks.json > results/raw/checks.txt
# Config A (plan literal, no pinning) takes ~220 s per mode on busy-768 and would take ~15 min per mode
# on busy-1536; it is already shown unusable, so busy-1536 is skipped for A only.
node s2_smoothing.js --configs A --sets random,busy768,images --json results/raw/cfg_A.json > results/raw/cfg_A.txt &
for c in B C D E F G H; do
  node s2_smoothing.js --configs "$c" --sets random,busy768,busy1536,images --json "results/raw/cfg_$c.json" > "results/raw/cfg_$c.txt" &
done
wait
node determinism.js > results/determinism.txt
node report.js > results/s2_summary.txt
echo "done: results/s2_summary.txt"
