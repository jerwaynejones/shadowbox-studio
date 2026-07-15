# tools/make_icons.py
"""
Generate the Shadowbox Studio app-icon set.

The mark is a small stack of offset layered panels — the product in miniature —
on the machine-bed graphite the app uses everywhere. A red laser-cut outline
frames the front panel, echoing the red = cut convention.

Run from the project root:

    python3 tools/make_icons.py

Writes PNGs into ./icons at every size the manifest and iOS reference.
"""

from PIL import Image, ImageDraw

BED = (23, 29, 36)        # --bed  #171d24
FILM = (231, 235, 238)    # --film sheet white-ish
CUT = (217, 58, 43)       # --cut  #d93a2b
SHEETS = [                # back -> front, midnight palette
    (63, 124, 192),
    (29, 63, 126),
    (231, 235, 238),
]


def rounded(size, radius_frac=0.22):
    """Alpha mask for a rounded-square icon."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    r = int(size * radius_frac)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return mask


def draw_icon(size, maskable=False):
    """
    Render one icon at the given pixel size.

    maskable icons keep all art inside the safe zone (central ~80%) so platform
    masks that crop to a circle never clip the mark.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background bed.
    d.rectangle([0, 0, size, size], fill=BED + (255,))

    # Safe-zone inset for maskable variants.
    pad = size * (0.18 if maskable else 0.14)
    area = size - 2 * pad

    # Three stacked panels, each offset up-left to suggest depth.
    panel_w = area * 0.62
    panel_h = area * 0.62
    step = area * 0.11
    # Start position so the whole stack is centered.
    total_off = step * (len(SHEETS) - 1)
    base_x = pad + (area - panel_w - total_off) / 2 + total_off
    base_y = pad + (area - panel_h - total_off) / 2

    corner = max(2, int(size * 0.03))
    for i, color in enumerate(SHEETS):
        off = step * i
        x0 = base_x - off
        y0 = base_y + total_off - off
        x1 = x0 + panel_w
        y1 = y0 + panel_h
        d.rounded_rectangle([x0, y0, x1, y1], radius=corner, fill=color + (255,))
        # Front panel gets the red cut outline.
        if i == len(SHEETS) - 1:
            lw = max(2, int(size * 0.018))
            d.rounded_rectangle(
                [x0, y0, x1, y1], radius=corner, outline=CUT + (255,), width=lw
            )
            # A little aperture in the front panel so the blue shows through,
            # reading as a cut-out window.
            aw = panel_w * 0.34
            ah = panel_h * 0.34
            ax0 = x0 + (panel_w - aw) / 2
            ay0 = y0 + (panel_h - ah) / 2
            d.rounded_rectangle(
                [ax0, ay0, ax0 + aw, ay0 + ah],
                radius=corner,
                fill=SHEETS[1] + (255,),
                outline=CUT + (255,),
                width=lw,
            )

    if not maskable:
        img.putalpha(rounded(size))
    return img


def main():
    import os

    os.makedirs("icons", exist_ok=True)
    specs = [
        ("icons/icon-192.png", 192, False),
        ("icons/icon-512.png", 512, False),
        ("icons/apple-touch-icon.png", 180, False),
        ("icons/icon-maskable-512.png", 512, True),
    ]
    for path, size, maskable in specs:
        draw_icon(size, maskable).save(path)
        print("wrote", path, f"{size}x{size}")


if __name__ == "__main__":
    main()
