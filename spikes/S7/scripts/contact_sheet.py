import sys, os, json, glob
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from PIL import ImageDraw, ImageFont
import matplotlib

ORDER = ["moge2", "da3mono", "marigold", "da2small"]
names = [os.path.basename(os.path.dirname(f)) for f in glob.glob(str(RESULTS / "*/meta.json")) if "upscaled" not in f]
names.sort(key=lambda n: (n.endswith("_esrx4"), [i for i, o in enumerate(ORDER) if n.startswith(o)][0], n))
try:
    font = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", 22)
except OSError:
    font = ImageFont.load_default()

def label(im, text, sub=""):
    d = ImageDraw.Draw(im); d.rectangle([0, 0, im.width, 54 if sub else 30], fill=(0, 0, 0))
    d.text((6, 3), text, fill=(255, 255, 255), font=font)
    if sub: d.text((6, 28), sub, fill=(255, 220, 120), font=font)
    return im

def sheet(tiles, cols, path):
    tw, th = tiles[0].size; rows = (len(tiles) + cols - 1) // cols
    S = Image.new("RGB", (cols * tw, rows * th), (40, 40, 40))
    for i, t in enumerate(tiles): S.paste(t, ((i % cols) * tw, (i // cols) * th))
    S.save(path); print(path, S.size)

TW, TH = 512, 386
rgb = Image.open(ORIG).convert("RGB")
g = [label(rgb.resize((TW, TH), Image.LANCZOS), "input 1024x771")]
c = [label(rgb.crop((230, 100, 760, 470)).resize((TW, int(TW * 370 / 530)), Image.LANCZOS), "input (centre crop)")]
for n in names:
    m = json.load(open(RESULTS / n / "meta.json")); p = m["probe"]
    sub = f"{m['seconds']}s {m['peak_vram_mb']:.0f}MB  cross:{'Y' if p['cross_separated'] else 'n'}  rings:{p['ring_levels_incl_weak']}"
    near = np.load(RESULTS / n / "nearness_1024.npy")
    g.append(label(Image.fromarray((near * 255).astype(np.uint8)).convert("RGB").resize((TW, TH), Image.LANCZOS), n, sub))
    cc = near[100:470, 230:760].astype(np.float64); z = cc[90:340, 100:430]
    cc = np.clip((cc - np.percentile(z, 1)) / (np.percentile(z, 99) - np.percentile(z, 1)), 0, 1)
    c.append(label(Image.fromarray((matplotlib.colormaps["turbo"](cc)[..., :3] * 255).astype(np.uint8)).resize((TW, int(TW * 370 / 530)), Image.LANCZOS), n, sub))
sheet(g, 6, RESULTS / "contact_sheet.png")
sheet(c, 6, RESULTS / "contact_sheet_centre_local.png")
