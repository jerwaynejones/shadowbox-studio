// Drives headless Chromium over CDP (no npm; Node's built-in WebSocket) and
// prints the probe's JSON.  Usage: node run_browser.js [chromiumBinary]
"use strict";
const { spawn } = require("child_process"), path = require("path"), fs = require("fs");
const bin = process.argv[2] || "chromium";
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "s4b-"));
const url = "file://" + path.join(__dirname, "browser.html");
const ch = spawn(bin, ["--headless=new", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, url], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {} await sleep(200); }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const evalJs = (expr) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } })); });
  for (let i = 0; i < 600; i++) {
    const r = await evalJs("document.getElementById('out') && document.getElementById('out').textContent");
    const v = r.result && r.result.result && r.result.result.value;
    if (v && v.startsWith("RESULT ")) { console.log(v.slice(7)); break; }
    await sleep(250);
  }
  ws.close(); ch.kill(); fs.rmSync(prof, { recursive: true, force: true });
})().catch((e) => { console.error(e); ch.kill(); process.exit(1); });
