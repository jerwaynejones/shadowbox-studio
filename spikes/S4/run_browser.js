// spikes/S4/run_browser.js — drive Chromium headless over CDP with Node's built-in WebSocket (no npm).
//   node spikes/S4/run_browser.js [--bench]
"use strict";
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), os = require("os");
const bench = process.argv.includes("--bench");
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(process.env.S4_TMP || os.tmpdir(), "s4chrome-"));
const url = "file://" + path.join(__dirname, "browser.html") + (bench ? "?bench" : "");
const chrome = spawn("chromium", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--allow-file-access-from-files",
  "--user-data-dir=" + prof, "--remote-debugging-port=" + port, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.navigate", { url });
  const t0 = Date.now(); let res;
  while (Date.now() - t0 < 600000) {
    const r = await send("Runtime.evaluate", { expression: "window.__S4 ? JSON.stringify(window.__S4) : null", returnByValue: true });
    if (r.result && r.result.result && r.result.result.value) { res = JSON.parse(r.result.result.value); break; }
    await sleep(500);
  }
  ws.close(); chrome.kill(); fs.rmSync(prof, { recursive: true, force: true });
  if (!res) { console.error("timeout"); process.exit(2); }
  const out = path.join(__dirname, "out", bench ? "browser_bench.json" : "browser_tests.json");
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(res.ua, "DecompressionStream:", res.decompressionStream);
  if (res.fatal) { console.error(res.fatal); process.exit(1); }
  console.table(res.tests.map((t) => ({ name: t.name, ok: t.ok, detail: String(t.detail).slice(0, 40) })));
  console.table(res.canvas); console.table(res.corpus);
  if (res.bench) { console.table(res.bench); console.table(res.nativeDecode); console.log("calibration 1e8 loop ms:", res.calibrationMs); }
  const failed = res.tests.filter((t) => !t.ok).length; console.log(`${res.tests.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
