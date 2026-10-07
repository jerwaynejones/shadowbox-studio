#!/usr/bin/env node
/**
 * Baseline preview capture (plan T0.7 Step 2).
 *
 * Serves the repository on 127.0.0.1, drives a locally installed headless
 * Chromium over the DevTools protocol (no npm dependencies: Node's built-in
 * WebSocket), loads the app (which opens on the built-in demo scene), and
 * writes into docs/baseline/:
 *   - preview_stack.png   the stack-preview <canvas> pixels (canvas.toBlob, as the app's own snapshot)
 *   - app_screenshot.png  a full-viewport screenshot of the app
 *   - <project>_shadowbox.zip  the ZIP produced by clicking "Download cut files (.zip)"
 *   - browser.json        browser product/version, user agent, viewport, URL, status line
 *
 * Usage: node tools/capture_baseline.mjs [chromium-binary]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "baseline");
const CHROME = process.argv[2] || "chromium";
const PORT = 8000 + Math.floor(Math.random() * 1000);
const W = 1440, H = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForLine(stream, re, ms) {
  return new Promise((res, rej) => {
    let buf = "";
    const t = setTimeout(() => rej(new Error("timeout waiting for " + re)), ms);
    stream.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(re);
      if (m) { clearTimeout(t); res(m); }
    });
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", ROOT],
    { stdio: ["ignore", "pipe", "pipe"] });
  const profile = mkdtempSync(join(tmpdir(), "sb-baseline-"));
  const dl = mkdtempSync(join(tmpdir(), "sb-baseline-dl-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    `--window-size=${W},${H}`, "--force-device-scale-factor=1", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const cleanup = () => {
    try { chrome.kill(); } catch (_) {}
    try { server.kill(); } catch (_) {}
  };
  try {
    const [, wsUrl] = await waitForLine(chrome.stderr, /DevTools listening on (ws:\/\/\S+)/, 20000);
    await sleep(500); // let http.server bind

    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) listeners.forEach((f) => f(msg));
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
      const m = { id: ++id, method, params };
      if (sessionId) m.sessionId = sessionId;
      pending.set(m.id, { res, rej });
      ws.send(JSON.stringify(m));
    });

    const version = await send("Browser.getVersion");
    await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl, eventsEnabled: true });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable");
    await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    const consoleErrors = [];
    listeners.push((m) => {
      if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params.exceptionDetails.text);
    });

    const url = `http://127.0.0.1:${PORT}/index.html`;
    await S("Page.navigate", { url });
    const evalv = async (expr) => (await S("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

    // Wait for the demo pipeline to finish: status line no longer "loading…"/ends with "…".
    let status = "";
    for (let i = 0; i < 240; i++) {
      await sleep(250);
      status = await evalv(`(document.getElementById("statusline")||{}).textContent||""`);
      if (status && !/…$/.test(status.trim())) break;
    }
    await sleep(1500); // let the preview settle a few animation frames

    const swCount = await evalv(`navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r=>r.length) : -1`);

    const canvasB64 = await evalv(`new Promise(r => document.getElementById("stackcanvas").toBlob(b => {
      const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(b); }, "image/png"))`);
    writeFileSync(join(OUT, "preview_stack.png"), Buffer.from(canvasB64, "base64"));

    const shot = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "app_screenshot.png"), Buffer.from(shot.data, "base64"));

    // Export: click the real button and capture the browser download.
    const done = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("download timeout")), 60000);
      listeners.push((m) => {
        if (m.method === "Browser.downloadProgress" && m.params.state === "completed") { clearTimeout(t); res(m.params); }
        if (m.method === "Browser.downloadProgress" && m.params.state === "canceled") { clearTimeout(t); rej(new Error("download canceled")); }
      });
    });
    let suggested = null;
    listeners.push((m) => { if (m.method === "Browser.downloadWillBegin") suggested = m.params.suggestedFilename; });
    await evalv(`document.getElementById("btn-export").click(), true`);
    await done;
    await sleep(300);
    const files = readdirSync(dl);
    const zipName = suggested || files.find((f) => f.endsWith(".zip"));
    const src = files.includes(zipName) ? zipName : files[0];
    const { readFileSync } = await import("node:fs");
    writeFileSync(join(OUT, zipName), readFileSync(join(dl, src)));
    const exportStatus = await evalv(`document.getElementById("statusline").textContent`);

    const info = {
      product: version.product,
      protocolVersion: version.protocolVersion,
      userAgent: version.userAgent,
      jsVersion: version.jsVersion,
      headless: "--headless=new",
      viewport: { width: W, height: H, deviceScaleFactor: 1 },
      url,
      pipelineStatus: status,
      exportStatus,
      zip: zipName,
      serviceWorkerRegistrations: swCount,
      pageExceptions: consoleErrors,
    };
    writeFileSync(join(OUT, "browser.json"), JSON.stringify(info, null, 2) + "\n");
    console.log(JSON.stringify(info, null, 2));
    ws.close();
  } finally {
    cleanup();
    await sleep(300);
    for (const d of [profile, dl]) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
