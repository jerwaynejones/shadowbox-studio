"""Real-ESRGAN x4plus upscale (tiled, fp16). RRDBNet re-implemented here following BasicSR's
rrdbnet_arch.py (Apache-2.0) so we avoid the unmaintained basicsr package."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import torch, torch.nn as nn, torch.nn.functional as F

class RDB(nn.Module):
    def __init__(s, nf=64, gc=32):
        super().__init__()
        s.conv1 = nn.Conv2d(nf, gc, 3, 1, 1); s.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
        s.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1); s.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
        s.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1); s.lrelu = nn.LeakyReLU(0.2, True)
    def forward(s, x):
        x1 = s.lrelu(s.conv1(x)); x2 = s.lrelu(s.conv2(torch.cat((x, x1), 1)))
        x3 = s.lrelu(s.conv3(torch.cat((x, x1, x2), 1))); x4 = s.lrelu(s.conv4(torch.cat((x, x1, x2, x3), 1)))
        return s.conv5(torch.cat((x, x1, x2, x3, x4), 1)) * 0.2 + x
class RRDB(nn.Module):
    def __init__(s, nf, gc=32):
        super().__init__(); s.rdb1 = RDB(nf, gc); s.rdb2 = RDB(nf, gc); s.rdb3 = RDB(nf, gc)
    def forward(s, x): return s.rdb3(s.rdb2(s.rdb1(x))) * 0.2 + x
class RRDBNet(nn.Module):
    def __init__(s, nf=64, nb=23, gc=32):
        super().__init__()
        s.conv_first = nn.Conv2d(3, nf, 3, 1, 1); s.body = nn.Sequential(*[RRDB(nf, gc) for _ in range(nb)])
        s.conv_body = nn.Conv2d(nf, nf, 3, 1, 1); s.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1); s.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1)
        s.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1); s.conv_last = nn.Conv2d(nf, 3, 3, 1, 1); s.lrelu = nn.LeakyReLU(0.2, True)
    def forward(s, x):
        f = s.conv_first(x); f = f + s.conv_body(s.body(f))
        f = s.lrelu(s.conv_up1(F.interpolate(f, scale_factor=2, mode="nearest")))
        f = s.lrelu(s.conv_up2(F.interpolate(f, scale_factor=2, mode="nearest")))
        return s.conv_last(s.lrelu(s.conv_hr(f)))

WPATH = ROOT / "models/esrgan/RealESRGAN_x4plus.pth"
net = RRDBNet(); sd = torch.load(WPATH, map_location="cpu", weights_only=True)
net.load_state_dict(sd.get("params_ema", sd.get("params", sd)), strict=True)
net = net.cuda().half().eval()
img = torch.tensor(load_rgb() / 255.0).permute(2, 0, 1)[None].float()
TILE, PAD, S = 256, 16, 4
out = torch.zeros(1, 3, H * S, W * S)
with torch.inference_mode(), Timer() as t:
    for y in range(0, H, TILE):
        for x in range(0, W, TILE):
            y0, x0 = max(y - PAD, 0), max(x - PAD, 0); y1, x1 = min(y + TILE + PAD, H), min(x + TILE + PAD, W)
            o = net(img[:, :, y0:y1, x0:x1].cuda().half()).float().cpu()
            ty1, tx1 = min(y + TILE, H), min(x + TILE, W)
            out[:, :, y * S:ty1 * S, x * S:tx1 * S] = o[:, :, (y - y0) * S:(y - y0 + ty1 - y) * S, (x - x0) * S:(x - x0 + tx1 - x) * S]
res = (out[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype(np.uint8)
od = RESULTS / "upscaled"; od.mkdir(parents=True, exist_ok=True)
Image.fromarray(res).save(od / "cross_realesrgan_x4.png")
meta = dict(method="Real-ESRGAN x4plus (RRDBNet, tiled 256+16px pad, fp16)", weights_url="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
            weights_sha256=sha256(WPATH), code_licence="BSD-3-Clause (xinntao/Real-ESRGAN); RRDBNet arch after BasicSR (Apache-2.0)",
            out_size=[res.shape[1], res.shape[0]], seconds=t.seconds, peak_vram_mb=t.peak_mb)
(od / "meta.json").write_text(json.dumps(meta, indent=2)); print(meta)
