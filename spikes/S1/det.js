/* spikes/S1/det.js — cross-engine determinism (NFR-05) for candidate (a).
 *   node spikes/S1/det.js           → Node (V8) hash + Deno (V8, separate runtime) + Firefox headless (SpiderMonkey) via WebDriver BiDi
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto"), cp = require("child_process"), os = require("os");
const ROOT = path.join(__dirname, "..", ".."), FILES = ["js/util.js", "js/trace.js", "spikes/S1/vendor/clipper2.js", "spikes/S1/geom_core.js", "spikes/S1/geom_clipper.js", "spikes/S1/det_payload.js"];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const out = {};
// Node
{ const c = vm.createContext({}); c.globalThis = c; for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), c, { filename: f });
  const s = c.S1_DET(); out.node = { engine: "V8 " + process.versions.v8, runtime: "node " + process.version, bytes: s.length, sha256: sha(s) }; }
// Deno
try {
  const code = `const R=${JSON.stringify(ROOT)};for(const f of ${JSON.stringify(FILES)}) (0,eval)(Deno.readTextFileSync(R+"/"+f));
const s=globalThis.S1_DET();const h=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,"0")).join("");
console.log(JSON.stringify({engine:"V8 "+Deno.version.v8,runtime:"deno "+Deno.version.deno,bytes:s.length,sha256:h}));`;
  const tmp = path.join(os.tmpdir(), "s1det_" + process.pid + ".mjs"); fs.writeFileSync(tmp, code);
  out.deno = JSON.parse(cp.execFileSync("deno", ["run", "--allow-read=" + ROOT, tmp], { encoding: "utf8" }).trim().split("\n").pop()); fs.unlinkSync(tmp);
} catch (e) { out.deno = { error: e.message.split("\n")[0] }; }
// Firefox (SpiderMonkey) via WebDriver BiDi
async function firefox() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "s1ff-")), port = 9400 + (process.pid % 300);
  const ff = cp.spawn("firefox", ["--headless", "--no-remote", "--profile", prof, "--remote-debugging-port=" + port], { stdio: "ignore" });
  try {
    let ws = null;
    for (let i = 0; i < 60 && !ws; i++) { await new Promise((r) => setTimeout(r, 500));
      try { ws = await new Promise((res, rej) => { const w = new WebSocket(`ws://127.0.0.1:${port}/session`); w.onopen = () => res(w); w.onerror = rej; }); } catch (e) { ws = null; } }
    if (!ws) throw new Error("no BiDi socket");
    let id = 0; const pend = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const sess = await send("session.new", { capabilities: {} });
    const tree = await send("browsingContext.getTree", {}); const ctx = tree.result.contexts[0].context;
    await send("browsingContext.navigate", { context: ctx, url: "file://" + path.join(__dirname, "det.html"), wait: "complete" });
    const ev = await send("script.evaluate", { expression: "S1_DET()", target: { context: ctx }, awaitPromise: false });
    const ua = await send("script.evaluate", { expression: "navigator.userAgent", target: { context: ctx }, awaitPromise: false });
    if (!ev.result || ev.result.type !== "success") throw new Error(JSON.stringify(ev).slice(0, 300));
    const s = ev.result.result.value;
    await send("session.end", {}); ws.close();
    return { engine: "SpiderMonkey", runtime: ua.result.result.value, bytes: s.length, sha256: sha(s), session: !!sess.result };
  } finally { ff.kill(); setTimeout(() => fs.rmSync(prof, { recursive: true, force: true }), 1000); }
}
firefox().then((r) => { out.firefox = r; }, (e) => { out.firefox = { error: String(e.message || e) }; }).then(() => {
  const hs = Object.values(out).filter((v) => v.sha256).map((v) => v.sha256);
  out.allEqual = hs.length >= 2 && hs.every((h) => h === hs[0]);
  console.log(JSON.stringify(out, null, 1));
  const j = process.argv.indexOf("--json"); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1));
  setTimeout(() => process.exit(0), 1500);
});
