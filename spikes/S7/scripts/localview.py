import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import matplotlib
out = sys.argv[1]; ims = []
for n in sys.argv[2:]:
    c = np.load(RESULTS / n / "nearness_1024.npy")[100:470, 230:760].astype(np.float64)
    z = c[90:340, 100:430]; c = (c - np.percentile(z, 1)) / (np.percentile(z, 99) - np.percentile(z, 1))
    ims.append((matplotlib.colormaps['turbo'](np.clip(c, 0, 1))[..., :3] * 255).astype(np.uint8))
Image.fromarray(np.concatenate([np.concatenate(ims[i:i+2], 1) if i+1 < len(ims) else np.concatenate([ims[i], ims[i]*0], 1) for i in range(0, len(ims), 2)], 0)).save(out)
