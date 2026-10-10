import json,glob,sys
for f in sorted(g for g in glob.glob('results/*/meta.json') if 'upscaled' not in g):
    m=json.load(open(f));p=m['probe'];r=p['regions']
    print(f.split('/')[1].ljust(22), ' '.join(f"{k}={r[k]['mean']:.3f}±{r[k]['std']:.3f}" for k in r), f"| x-d={p['cross_minus_disc']} x-loc={p['cross_minus_local_ring']} eff={p['cross_vs_disc_effect_size']} sep={p['cross_separated']} peaks={p['ring_hist_peaks']} steps={p['radial_profile_steps']}{p['radial_step_radii_px']} rng={p["ring_zone_p5_p95_range"]} | LOCAL x-d={p["local_cross_minus_disc"]} peaks={p["local_ring_hist_peaks"]} steps={p["local_radial_steps"]}{p["local_radial_step_radii_px"]}")
