// Drives headless Firefox over WebDriver BiDi (no npm; Node's WebSocket) and
// prints the probe's JSON.  Usage: node run_firefox.js
"use strict";
const { spawn } = require("child_process"), path = require("path"), fs = require("fs");
const port = 9800 + Math.floor(Math.random() * 100);
const prof = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "s4bff-"));
fs.writeFileSync(path.join(prof, "user.js"), 'user_pref("security.fileuri.strict_origin_policy", false);\nuser_pref("browser.shell.checkDefaultBrowser", false);\n');
const ff = spawn("firefox", ["--headless", "--no-remote", "--profile", prof, `--remote-debugging-port=${port}`], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let ws;
  for (let i = 0; i < 100; i++) { try { ws = new WebSocket(`ws://127.0.0.1:${port}/session`); await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; }); break; } catch { ws = null; await sleep(300); } }
  if (!ws) throw new Error("no BiDi");
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const cmd = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd("session.new", { capabilities: {} });
  const tree = await cmd("browsingContext.getTree", {});
  const context = tree.result.contexts[0].context;
  await cmd("browsingContext.navigate", { context, url: "file://" + path.join(__dirname, "browser.html"), wait: "complete" });
  for (let i = 0; i < 1200; i++) {
    const r = await cmd("script.evaluate", { expression: "document.getElementById('out').textContent", target: { context }, awaitPromise: false });
    const v = r.result && r.result.result && r.result.result.value;
    if (v && v.startsWith("RESULT ")) { console.log(v.slice(7)); break; }
    await sleep(250);
  }
  await cmd("session.end", {}).catch(() => {});
  ws.close(); ff.kill(); fs.rmSync(prof, { recursive: true, force: true });
})().catch((e) => { console.error(e); ff.kill(); process.exit(1); });
