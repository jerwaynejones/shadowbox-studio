#!/usr/bin/env bash
# Generates the S4b real-encoder JPEG corpus with libjpeg-turbo (cjpeg) and
# ImageMagick. Output: spikes/S4b/corpus/*.jpg  (regenerable; not committed)
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)/corpus"; mkdir -p "$D"; cd "$D"
magick -size 640x480 gradient:red-blue -swirl 90 src.ppm
magick -size 640x480 gradient:white-black src.pgm
cjpeg -quality 90 src.ppm > baseline.jpg
cjpeg -quality 90 -progressive src.ppm > progressive.jpg
cjpeg -quality 90 -grayscale src.ppm > gray.jpg
cjpeg -quality 90 -arithmetic src.ppm > arithmetic.jpg
cjpeg -quality 90 -arithmetic -progressive src.ppm > arith_progressive.jpg
cjpeg -quality 90 -restart 1 src.ppm > restart.jpg
cjpeg -precision 12 -quality 90 src.ppm > p12.jpg 2>/dev/null || echo "12-bit unsupported by cjpeg"
cjpeg -lossless 1 src.ppm > lossless.jpg 2>/dev/null || echo "lossless unsupported by cjpeg"
cjpeg -quality 90 -sample 1x1 src.ppm > yuv444.jpg
magick src.ppm -colorspace CMYK -quality 90 cmyk.jpg
# EXIF orientation 1..8, II and MM byte orders, + edge cases (ImageMagick
# -orient does not write an Exif APP1 for JPEG->JPEG, so inject it ourselves)
node "$(dirname "$D")/inject_exif.js" "$D"
# Large: 6000x4000 = 24 MP noise, quality 97 (worst-case byte size)
magick -size 6000x4000 xc: +noise Random -quality 97 big_24mp.jpg
# 16 MP exactly (4000x4000 = 16,000,000 px) and 16 MP + 1 row
magick -size 4000x4000 plasma:fractal -quality 90 mp16.jpg
magick -size 4000x4001 xc:gray -quality 90 mp16plus.jpg
rm -f src.ppm src.pgm
ls -l "$D"
