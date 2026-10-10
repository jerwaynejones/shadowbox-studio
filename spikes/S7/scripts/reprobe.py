import sys, os, json, glob
sys.path.insert(0, os.path.dirname(__file__))
from common import *
for f in sorted(g for g in glob.glob(str(RESULTS / '*/meta.json')) if 'upscaled' not in g):
    d = os.path.dirname(f); m = json.load(open(f))
    m['probe'] = run_probe(np.load(os.path.join(d, 'nearness_1024.npy')))
    open(f, 'w').write(json.dumps(m, indent=2))
