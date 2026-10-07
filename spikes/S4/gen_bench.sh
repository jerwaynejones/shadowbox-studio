#!/usr/bin/env bash
# spikes/S4/gen_bench.sh — large benchmark PNGs at the IMG-07 envelopes (desktop 16 MP, mobile 8 MP). Output: out/bench/ (not tracked).
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)/out/bench"; rm -rf "$D"; mkdir -p "$D"; cd "$D"
for spec in "16mp 4000x4000" "8mp 2828x2828"; do set -- $spec; n=$1; sz=$2
  magick -size $sz -seed 1 plasma:gray50-gray50 -blur 0x2 -colorspace gray -depth 8 src_$n.miff
  magick src_$n.miff -define png:color-type=0 -define png:bit-depth=8 ${n}_gray8.png
  magick src_$n.miff -define png:color-type=0 -define png:bit-depth=8 -interlace PNG ${n}_gray8_adam7.png
  magick src_$n.miff -define png:color-type=2 -define png:bit-depth=8 ${n}_rgb_eq.png
  magick src_$n.miff -alpha set -define png:color-type=6 -define png:bit-depth=8 ${n}_rgba_eq.png
  magick -size $sz -seed 2 xc: +noise Random -colorspace gray -depth 8 -define png:color-type=0 ${n}_gray8_noise.png
  rm src_$n.miff
done
# worst case for the 25 MiB desktop byte limit: incompressible RGBA-equal noise, ~25 MiB at 2560x2560 (6.5 MP)
magick -size 2560x2560 -seed 3 xc: +noise Random -colorspace gray -alpha set -channel A +noise Random +channel -depth 8 -define png:color-type=6 25mib_rgba_noise.png
ls -la
