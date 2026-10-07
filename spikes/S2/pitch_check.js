/* spikes/S2/pitch_check.js — per-vertex variant (G/H rules) at the product-default pitch:
 * widthMM 300 / procRes 720 = 416.7 µm/px, tol 50 µm, and at tol 100 µm for contrast. Usage: node spikes/S2/pitch_check.js */
"use strict";
const S = require("./lib.js");
const st = S.imageStack(S.IMAGES[2]), px = 300000 / st.w;
for (const tol of [50, 100]) for (const containment of [true, false]) {
  const m = S.metrics(S.runStack(st.layers, st.w, st.h, { pxUm: px, tolUm: tol, epsPx: tol / px, pin: true, local: true, containment }));
  console.log(`${st.name} @ ${px.toFixed(1)} µm/px, tol ${tol} µm, ${containment ? "bonded   " : "connected"}: corners rounded ${(m.cornerShare * 100).toFixed(1)}%, length ${(m.lengthShare * 100).toFixed(1)}%, nested ${m.nestedOK}, maxDev ${m.maxDevUm.toFixed(1)} µm, ${m.ms.toFixed(0)} ms`);
}
