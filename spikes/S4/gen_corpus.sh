#!/usr/bin/env bash
# spikes/S4/gen_corpus.sh — build a cross-check corpus with ImageMagick (libpng writer), plus
# raw reference samples (magick ... gray:-) for every file. Output: spikes/S4/out/corpus/ (regenerable, not tracked).
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)/out/corpus"; rm -rf "$D"; mkdir -p "$D"; cd "$D"
SRC=src.miff
magick -size 513x257 -seed 42 plasma:gray50-gray50 -colorspace gray -depth 8 "$SRC"
mk() { local name=$1; shift; magick "$SRC" "$@" "$name.png"; magick "$name.png" -depth 8 gray:"$name.gray"; }
mk g8            -define png:color-type=0 -define png:bit-depth=8
mk g8_adam7      -define png:color-type=0 -define png:bit-depth=8 -interlace PNG
mk g8_gama       -define png:color-type=0 -define png:bit-depth=8 -set gamma 0.45455 -define png:include-chunk=gAMA
mk g8_iccp       -define png:color-type=0 -define png:bit-depth=8 -profile /usr/share/color/icc/colord/sRGB.icc 2>/dev/null || mk g8_iccp -define png:color-type=0
mk rgb_eq        -define png:color-type=2 -define png:bit-depth=8
mk rgb_eq_adam7  -define png:color-type=2 -define png:bit-depth=8 -interlace PNG
mk rgba_eq       -alpha set -channel A -evaluate set 50% +channel -define png:color-type=6 -define png:bit-depth=8
mk ga8           -alpha set -channel A -evaluate set 50% +channel -define png:color-type=4 -define png:bit-depth=8
mk pal_gray      -colors 200 -define png:color-type=3 -define png:bit-depth=8
mk default_write          # whatever IM picks by default for a gray source
magick "$SRC" -posterize 4 -define png:compression-level=9 default_4level.png; magick default_4level.png -depth 8 gray:default_4level.gray
magick "$SRC" -depth 16 -define png:bit-depth=16 g16.png
magick -size 64x64 gradient:red-blue rgb_color.png
magick -delay 10 "$SRC" "$SRC" -define png:format=apng apng:anim.png 2>/dev/null || true
for f in *.png; do printf '%s ' "$f"; magick identify -format '%[png:IHDR.color-type-orig] %[png:IHDR.bit-depth-orig] %[interlace]\n' "$f" 2>/dev/null || echo; done
