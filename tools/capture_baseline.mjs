#!/usr/bin/env node
/**
 * Baseline preview capture (plan T0.7 Step 2).
 *
 * Serves the repository on 127.0.0.1, drives a locally installed headless
 * Chromium over the DevTools protocol (no npm dependencies: Node's built-in
 * WebSocket), loads the app (which opens on the built-in demo scene), and
 * writes into the output directory:
 *   - preview_stack.png   the stack-preview <canvas> pixels (canvas.toBlob, as the app's own snapshot)
 *   - app_screenshot.png  a full-viewport screenshot of the app
 *   - <project>_shadowbox.zip  the ZIP produced by clicking "Download cut files (.zip)"
 *   - export/             the ZIP unpacked with `unzip`; export/preview.png is removed
 *                         when it is byte-identical to preview_stack.png (it normally is)
 *   - browser.json        browser product/version, user agent, viewport, URL, status line
 *
 * Usage: node tools/capture_baseline.mjs [--out <dir>] [chromium-binary]
 *
 * WARNING: without --out the output directory is docs/baseline/, i.e. the
 * script OVERWRITES THE COMMITTED BASELINE. The ZIP changes on every run (entry
 * timestamps) and app_screenshot.png changes with the date and the pipeline
 * timing shown in the status bar. For a check-only run pass --out to a scratch
 * directory and compare preview_stack.png and export/ against docs/baseline/.
 *
 * Exits non-zero (after writing nothing it cannot vouch for) if the server or
 * browser does not start, the pipeline does not finish, the status line is not
 * the expected one, any page exception is thrown, or a service worker is
 * registered on the local host.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1440, H = 900;
const EXPECTED_STATUS = "720×544px · 5 sheets · 0 bridged · 5 culled · 7.94 m of cuts";

function parseArgs(argv) {
  let out = join(ROOT, "docs", "baseline");
  let chrome = "chromium";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      if (!argv[i + 1]) throw new Error("--out needs a directory");
      out = resolve(argv[++i]);
    } else if (argv[i].startsWith("--out=")) out = resolve(argv[i].slice(6));
    else chrome = argv[i];
  }
  return { out, chrome };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForLine(stream, re, ms) {
  return new Promise((res, rej) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(re);
      if (m) { clearTimeout(t); stream.off("data", onData); res(m); }
    };
    const t = setTimeout(() => {
      stream.off("data", onData);
      rej(new Error("timeout waiting for " + re + (buf ? "; got:\n" + buf.trim() : "")));
    }, ms);
    stream.on("data", onData);
  });
}

function startServer() {
  // Up to 5 attempts on a random port; readiness is the server's own "Serving HTTP" line.
  return (async () => {
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      const port = 8000 + Math.floor(Math.random() * 1000);
      const server = spawn("python3", ["-u", "-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", ROOT],
        { stdio: ["ignore", "pipe", "pipe"] });
      const exited = new Promise((_, rej) => {
        server.once("error", (e) => rej(new Error(`cannot start python3 http.server: ${e.message}`)));
        server.once("exit", (code) => rej(new Error(`http.server exited (code ${code}) on port ${port}`)));
      });
      try {
        // http.server prints its banner on stdout; errors (e.g. EADDRINUSE) on stderr before exiting.
        await Promise.race([waitForLine(server.stdout, /Serving HTTP on \S+ port (\d+)/, 10000), exited]);
        exited.catch(() => {});
        return { server, port };
      } catch (e) {
        exited.catch(() => {});
        lastErr = e;
        try { server.kill(); } catch (_) {}
      }
    }
    throw lastErr;
  })();
}

async function main() {
  const { out: OUT, chrome: CHROME } = parseArgs(process.argv.slice(2));
  const profile = mkdtempSync(join(tmpdir(), "sb-baseline-"));
  const dl = mkdtempSync(join(tmpdir(), "sb-baseline-dl-"));
  let server = null, chrome = null;

  const cleanup = () => {
    try { chrome && chrome.kill(); } catch (_) {}
    try { server && server.kill(); } catch (_) {}
  };
  try {
    const srv = await startServer();
    server = srv.server;
    const PORT = srv.port;
    chrome = spawn(CHROME, [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      `--window-size=${W},${H}`, "--force-device-scale-factor=1", "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const chromeFailed = new Promise((_, rej) => {
      chrome.once("error", (e) => rej(new Error(`cannot start ${CHROME}: ${e.message}`)));
      chrome.once("exit", (code) => rej(new Error(`${CHROME} exited (code ${code}) before DevTools was ready`)));
    });
    chromeFailed.catch(() => {});
    const [, wsUrl] = await Promise.race([
      waitForLine(chrome.stderr, /DevTools listening on (ws:\/\/\S+)/, 20000), chromeFailed]);

    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
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
    const pageExceptions = [];
    listeners.add((m) => {
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        pageExceptions.push((d.exception && d.exception.description) || d.text);
      }
    });

    const url = `http://127.0.0.1:${PORT}/index.html`;
    await S("Page.navigate", { url });
    const evalv = async (expr) => (await S("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

    // Wait for the demo pipeline to finish: status line no longer "loading…"/ends with "…".
    let status = "", finished = false;
    for (let i = 0; i < 240; i++) {
      await sleep(250);
      status = (await evalv(`(document.getElementById("statusline")||{}).textContent||""`)).trim();
      if (status && !/…$/.test(status)) { finished = true; break; }
    }
    if (!finished) throw new Error(`pipeline did not finish within 60 s; status line: ${JSON.stringify(status)}`);
    await sleep(1500); // let the preview settle a few animation frames

    // Status line minus the trailing " · <n> ms" timing.
    const statusNoTiming = status.replace(/\s*·\s*\d+\s*ms$/, "");
    if (statusNoTiming !== EXPECTED_STATUS) {
      throw new Error(`unexpected status line ${JSON.stringify(status)}; expected ${JSON.stringify(EXPECTED_STATUS)} (+ timing)`);
    }

    const swCount = await evalv(`navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r=>r.length) : -1`);
    if (swCount > 0) throw new Error(`${swCount} service-worker registration(s) on the local host; expected none`);

    const canvasB64 = await evalv(`new Promise(r => document.getElementById("stackcanvas").toBlob(b => {
      const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(b); }, "image/png"))`);
    const previewPng = Buffer.from(canvasB64, "base64");
    const shot = await S("Page.captureScreenshot", { format: "png" });

    // Export: click the real button and capture the browser download.
    let suggested = null;
    let onDownload;
    const done = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("download timeout")), 60000);
      onDownload = (m) => {
        if (m.method === "Browser.downloadWillBegin") suggested = m.params.suggestedFilename;
        if (m.method !== "Browser.downloadProgress") return;
        if (m.params.state === "completed") { clearTimeout(t); res(m.params); }
        if (m.params.state === "canceled") { clearTimeout(t); rej(new Error("download canceled")); }
      };
      listeners.add(onDownload);
    });
    try {
      await evalv(`document.getElementById("btn-export").click(), true`);
      await done;
    } finally {
      listeners.delete(onDownload);
    }
    await sleep(300);
    const files = readdirSync(dl);
    const zipName = suggested || files.find((f) => f.endsWith(".zip"));
    const src = files.includes(zipName) ? zipName : files[0];
    if (!zipName || !src) throw new Error("no ZIP was downloaded");
    const zipData = readFileSync(join(dl, src));
    const exportStatus = await evalv(`document.getElementById("statusline").textContent`);

    if (pageExceptions.length) throw new Error("page exceptions:\n  " + pageExceptions.join("\n  "));

    // All checks passed: only now write into the output directory.
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "preview_stack.png"), previewPng);
    writeFileSync(join(OUT, "app_screenshot.png"), Buffer.from(shot.data, "base64"));
    writeFileSync(join(OUT, zipName), zipData);

    const exportDir = join(OUT, "export");
    rmSync(exportDir, { recursive: true, force: true });
    const unz = spawnSync("unzip", ["-q", "-o", join(OUT, zipName), "-d", exportDir], { stdio: "inherit" });
    if (unz.error || unz.status !== 0) throw new Error("unzip failed" + (unz.error ? ": " + unz.error.message : ` (status ${unz.status})`));
    const exportPreview = join(exportDir, "preview.png");
    let exportPreviewDedup = false;
    if (existsSync(exportPreview) && readFileSync(exportPreview).equals(previewPng)) {
      rmSync(exportPreview); // byte-identical duplicate of preview_stack.png
      exportPreviewDedup = true;
    }

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
      exportPreviewIdenticalToPreviewStack: exportPreviewDedup,
      serviceWorkerRegistrations: swCount,
      pageExceptions,
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

main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
