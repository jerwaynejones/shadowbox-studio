#!/usr/bin/env node
/**
 * Speed round F17 (S3, PO-PERF-3): the in-app draft bench (?bench=draft, js/app.js F16a/F17) per draft size in a real
 * headless browser, Chromium over the DevTools protocol or Firefox over WebDriver BiDi. No npm: Node built-ins,
 * python3 http.server on a free 127.0.0.1 port (killed afterwards).
 *
 * The page is the built bundle (dist/shadowbox-studio.html, Blob-worker rung) copied to a scratch directory with its
 * desktop draft cap (DRAFT_BUDGET.desktopDraftPx) raised to 2000, so the shipped cap never clamps a candidate (as
 * test/bench.js wraps SBSchema.limits); each size is the bench project's geometry.draftPx (&draftPx=N). Per size: both
 * art families, the cold draft after the source install, 3 warm-ups + 15 warm edits (sheets 8 ↔ 7), 7 K2-miss edits
 * (smoothing 1.65 ↔ 1.70 mm), each edit timed to the painted draft, plus the receipt → paint time (renderMs).
 *
 * Usage: node tools/bench_draft_browser.mjs --browser chromium|firefox --sizes 720,1280,1536,1792,2000
 *          [--key chromium-i7] [--machine "…"] [--record] [--bin <browser binary>] [--extra "&runs=2&warm=0&k2=1"]
 * --record merges the rows into docs/perf/draft-budget.json f17.browser[key] (key default <browser>-i7).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, cpus, totalmem } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = arg("--browser", "chromium"), sizes = arg("--sizes", "720,1280,1536,1792,2000").split(",").map(Number);
const key = arg("--key", browser + "-i7"), extra = arg("--extra", ""), TIMEOUT = 30 * 60 * 1000;
if (!["chromium", "firefox"].includes(browser)) throw new Error("--browser must be chromium or firefox");

function waitForLine(stream, re, ms) {
  return new Promise((res, rej) => {
    let buf = "";
    const onData = (d) => { buf += d.toString(); const m = buf.match(re); if (m) { clearTimeout(t); stream.off("data", onData); res(m); } };
    const t = setTimeout(() => { stream.off("data", onData); rej(new Error("timeout waiting for " + re + "; got: " + buf.trim())); }, ms);
    stream.on("data", onData);
  });
}

/** The bundle with the desktop draft cap raised to 2000 (measurement only; never shipped). */
function benchPage(dir) {
  const html = readFileSync(join(ROOT, "dist", "shadowbox-studio.html"), "utf8");
  const re = /const DRAFT_BUDGET = \{ desktopDraftPx: \d+,/;
  if (!re.test(html)) throw new Error("DRAFT_BUDGET not found in dist/shadowbox-studio.html (run node build.js)");
  writeFileSync(join(dir, "bench.html"), html.replace(re, "const DRAFT_BUDGET = { desktopDraftPx: 2000,"));
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const m = { id: ++id, method, params }; if (sessionId) m.sessionId = sessionId;
    pending.set(m.id, { res, rej }); ws.send(JSON.stringify(m));
  });
  return { ws, send };
}

async function chromiumRun(url, procs) {
  const profile = mkdtempSync(join(tmpdir(), "sb-f17-chr-"));
  const chrome = spawn(arg("--bin", "chromium"), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--window-size=1440,900", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  procs.push(chrome);
  try {
    const [, wsUrl] = await waitForLine(chrome.stderr, /DevTools listening on (ws:\/\/\S+)/, 20000);
    const cdp = await connect(wsUrl);
    const version = await cdp.send("Browser.getVersion");
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => cdp.send(m, p, sessionId);
    await S("Runtime.enable");
    await S("Page.enable");
    await S("Page.navigate", { url });
    const ev = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true }); return r.result ? r.result.value : null; };
    const t0 = Date.now();
    for (;;) {
      await sleep(1000);
      const st = await ev("document.documentElement.dataset.bench || ''");
      if (st === "done") break;
      if (st === "error") throw new Error("bench error: " + (await ev("document.getElementById('bench-status').textContent")));
      if (Date.now() - t0 > TIMEOUT) throw new Error("bench timeout");
    }
    const rec = JSON.parse(await ev("document.getElementById('bench-result').textContent"));
    cdp.ws.close();
    return { rec, product: version.product };
  } finally { chrome.kill("SIGKILL"); rmSync(profile, { recursive: true, force: true }); }
}

/** Firefox over WebDriver BiDi (--remote-debugging-port): navigate, poll data-bench, read #bench-result. */
async function firefoxRun(url, procs) {
  const profile = mkdtempSync(join(tmpdir(), "sb-f17-ff-"));
  writeFileSync(join(profile, "user.js"), [["browser.shell.checkDefaultBrowser", false], ["datareporting.policy.dataSubmissionEnabled", false],
    ["toolkit.telemetry.enabled", false], ["browser.aboutwelcome.enabled", false], ["remote.prefs.recommended", true]]
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n") + "\n");
  const ff = spawn(arg("--bin", "firefox"), ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port", "0", "--window-size=1440,900", "about:blank"],
    { stdio: ["ignore", "pipe", "pipe"] });
  procs.push(ff);
  try {
    const [, wsBase] = await waitForLine(ff.stderr, /WebDriver BiDi listening on (ws:\/\/\S+)/, 30000);
    const bidi = await connect(wsBase.replace(/\/$/, "") + "/session");
    const s = await bidi.send("session.new", { capabilities: {} });
    const tree = await bidi.send("browsingContext.getTree", {}), context = tree.contexts[0].context;
    await bidi.send("browsingContext.navigate", { context, url, wait: "complete" });
    const ev = async (expr) => { const r = await bidi.send("script.evaluate", { expression: expr, target: { context }, awaitPromise: false });
      return r.type === "success" && r.result ? r.result.value : null; };
    const t0 = Date.now();
    for (;;) {
      await sleep(1000);
      const st = await ev("document.documentElement.dataset.bench || ''");
      if (st === "done") break;
      if (st === "error") throw new Error("bench error: " + (await ev("document.getElementById('bench-status').textContent")));
      if (Date.now() - t0 > TIMEOUT) throw new Error("bench timeout");
    }
    const rec = JSON.parse(await ev("document.getElementById('bench-result').textContent"));
    bidi.ws.close();
    return { rec, product: "firefox " + s.capabilities.browserVersion };
  } finally { ff.kill("SIGKILL"); await sleep(500); rmSync(profile, { recursive: true, force: true }); }
}

/** One size's row from the in-app record. */
function rowOf(size, rec) {
  const fam = {};
  for (const [f, v] of Object.entries(rec.families)) {
    fam[f] = { raster: v.raster, draftPx: v.draftPx, warmP50Ms: v.p50Ms, warmP95Ms: v.p95Ms, warmMaxMs: v.maxMs, warmRuns: v.n,
      k2MissP50Ms: v.k2Miss.p50Ms, k2MissP95Ms: v.k2Miss.p95Ms, k2MissRuns: v.k2Miss.n, coldMs: v.source.coldMs, coldStatus: v.source.coldStatus,
      renderP50Ms: v.render.p50Ms, renderP95Ms: v.render.p95Ms, status: v.rows.length ? v.rows[v.rows.length - 1].status : null,
      code: v.rows.length ? v.rows[v.rows.length - 1].code : null, maxParts: v.maxParts, maxVertices: v.maxVertices,
      engineP50Ms: (() => { const e = v.rows.filter((r) => !r.warm && r.engineMs !== null).map((r) => r.engineMs).sort((a, b) => a - b); return e.length ? e[Math.ceil(e.length / 2) - 1] : null; })() };
  }
  return { draftPx: size, families: fam, longTaskMaxMs: rec.longTaskMaxMs, longTasksSupported: !!(rec.longTasks && rec.longTasks.supported),
    pool: rec.env.pool, deviceMemory: rec.env.deviceMemory, at: rec.at };
}

const procs = [], work = mkdtempSync(join(tmpdir(), "sb-f17-page-"));
try {
  benchPage(work);
  const server = spawn("python3", ["-u", "-m", "http.server", "0", "--bind", "127.0.0.1", "--directory", work], { stdio: ["ignore", "pipe", "pipe"] });
  procs.push(server);
  const port = +(await waitForLine(server.stdout, /Serving HTTP on \S+ port (\d+)/, 10000))[1];
  const rows = [];
  let product = null, ua = null;
  for (const size of sizes) {
    const url = `http://127.0.0.1:${port}/bench.html?bench=draft&draftPx=${size}${extra}`;
    console.error(`[${key}] ${size}: ${url}`);
    const r = await (browser === "chromium" ? chromiumRun(url, procs) : firefoxRun(url, procs));
    product = r.product; ua = r.rec.env.userAgent;
    const row = rowOf(size, r.rec);
    if (row.pool.mode !== "pool") throw new Error("the bench page ran without the worker pool (" + JSON.stringify(row.pool) + ")");
    rows.push(row);
    for (const [f, v] of Object.entries(row.families))
      console.error(`[${key}] ${size} ${f} ${v.raster} ${v.status}${v.code ? " " + v.code : ""}: warm p50 ${v.warmP50Ms} p95 ${v.warmP95Ms} ms, K2-miss p95 ${v.k2MissP95Ms}, cold ${v.coldMs}, render p95 ${v.renderP95Ms}, parts ≤${v.maxParts}`);
  }
  const out = { key, browser: product, userAgent: ua, machine: arg("--machine", cpus()[0].model + " (" + cpus().length + " threads, " + (totalmem() / 2 ** 30).toFixed(1) + " GiB)"),
    page: "dist/shadowbox-studio.html over http (Blob-worker rung), desktop draft cap raised to 2000 for the measurement; &draftPx=N per size", extra: extra || null, rows };
  console.log(JSON.stringify(out, null, 1));
  if (argv.includes("--record") && !extra) {
    const f = join(ROOT, "docs", "perf", "draft-budget.json"), rec = JSON.parse(readFileSync(f, "utf8"));
    rec.f17 = rec.f17 || {}; rec.f17.browser = rec.f17.browser || {};
    const prev = rec.f17.browser[key] ? rec.f17.browser[key].rows.filter((r) => !sizes.includes(r.draftPx)) : [];
    rec.f17.browser[key] = Object.assign(out, { rows: prev.concat(rows).sort((a, b) => a.draftPx - b.draftPx) });
    writeFileSync(f, JSON.stringify(rec, null, 1) + "\n");
  }
} finally {
  for (const p of procs) { try { p.kill("SIGKILL"); } catch (_) { /* gone */ } }
  rmSync(work, { recursive: true, force: true });
}
