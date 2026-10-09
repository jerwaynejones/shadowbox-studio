/* ============================================================================
 * Shadowbox Studio — test/node_worker_shim.js
 * ----------------------------------------------------------------------------
 * Speed round F11 (S1): runs js/worker.js under Node's worker_threads with the
 * small slice of the dedicated-worker API it uses, so the coordinator / helper
 * protocol is tested in Node exactly as the browser runs it:
 *
 *   inside the thread   self (= globalThis), self.name, self.postMessage,
 *                       self.onmessage / addEventListener("message"),
 *                       importScripts(...urls) via vm.runInThisContext, and
 *                       fetch(url) → {ok, text()} for relative module URLs
 *                       (the worker hashes the module texts it loads).
 *                       URLs resolve against the worker script's directory.
 *   on the main side    spawn(script, {name, patch}) → a Worker-like object
 *                       {postMessage(msg, transfer), terminate(), onmessage,
 *                       onerror, onmessageerror, terminated, name}; MessagePorts
 *                       are Node's (global MessageChannel), which carry
 *                       onmessage / postMessage like the browser's.
 *
 * spawnSource(source, {name}) (speed round F16) runs a worker built from a
 * source text instead of a file, as the page's Blob worker is (SBPool's "blob"
 * rung: SB_INLINED plus worker.js, evaluated by importScripts of blob: URLs the
 * worker makes itself). Inside the thread, Blob remembers its string parts and
 * URL.createObjectURL returns a blob: URL that importScripts resolves to them,
 * since Node's importScripts stand-in is synchronous and Node's Blob is not.
 *
 * patch(name, text) → text (optional, a self-contained function: it is sent to
 * the thread as source) rewrites a module text as the thread reads it, for both
 * importScripts and fetch, so a test can build a version-skewed or fault-injecting
 * worker. Test-only; never shipped.
 * ==========================================================================*/
"use strict";
const path = require("path");
const { Worker } = require("worker_threads");

const BOOT = `
"use strict";
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs"), path = require("path"), vm = require("vm");
const dir = workerData.dir;
const patch = workerData.patch ? (0, eval)("(" + workerData.patch + ")") : null;
const read = (url) => {
  const f = path.resolve(dir, String(url)), name = path.relative(dir, f).split(path.sep).join("/");
  const t = fs.readFileSync(f, "utf8");
  return patch ? patch(name, t) : t;
};
globalThis.self = globalThis;
self.name = workerData.name;
const blobs = new Map();
{
  const RealBlob = globalThis.Blob;
  globalThis.Blob = class extends RealBlob { constructor(parts, o) { super(parts, o); this.sbText = (parts || []).map(String).join(""); } };
  URL.createObjectURL = (b) => { const u = "blob:sb-shim/" + (blobs.size + 1); blobs.set(u, b.sbText); return u; };
  URL.revokeObjectURL = (u) => { blobs.delete(String(u)); };
}
const load = (u) => (String(u).startsWith("blob:") ? blobs.get(String(u)) : read(u));
self.importScripts = (...urls) => { for (const u of urls) { const t = load(u); if (t === undefined) throw new Error("importScripts: cannot load " + u); vm.runInThisContext(t, { filename: String(u) }); } };
self.fetch = async (url) => { let t; try { t = read(url); } catch (e) { return { ok: false, status: 404, text: async () => "" }; } return { ok: true, status: 200, text: async () => t }; };
self.postMessage = (m, transfer) => parentPort.postMessage(m, transfer);
const listeners = [];
self.addEventListener = (type, f) => { if (type === "message") listeners.push(f); };
parentPort.on("message", (data) => {
  const ev = { data };
  if (typeof self.onmessage === "function") self.onmessage(ev);
  for (const f of listeners) f(ev);
});
if (workerData.source !== null) vm.runInThisContext(workerData.source, { filename: "blob:sb-worker" });
else vm.runInThisContext(read(workerData.script), { filename: workerData.script });
`;

/** spawn(script, {name, patch}) → Worker-like wrapper around a worker_threads Worker running script. */
function spawn(script, o) {
  o = o || {};
  const abs = path.resolve(script);
  return wrap(new Worker(BOOT, { eval: true, workerData: { dir: path.dirname(abs), script: path.basename(abs), source: null, name: o.name || "", patch: o.patch ? String(o.patch) : null } }), o);
}

/** spawnSource(source, {name}) → the same wrapper around a worker running the source text (the page's Blob worker). */
function spawnSource(source, o) {
  o = o || {};
  return wrap(new Worker(BOOT, { eval: true, workerData: { dir: process.cwd(), script: null, source: String(source), name: o.name || "", patch: null } }), o);
}

function wrap(w, o) {
  const self = {
    name: o.name || "",
    terminated: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(m, transfer) { w.postMessage(m, transfer); },
    terminate() { if (!self.terminated) { self.terminated = true; w.terminate(); } },
  };
  w.on("message", (data) => { if (!self.terminated && typeof self.onmessage === "function") self.onmessage({ data }); });
  w.on("messageerror", (e) => { if (!self.terminated && typeof self.onmessageerror === "function") self.onmessageerror({ data: null, error: e }); });
  w.on("error", (e) => { if (!self.terminated && typeof self.onerror === "function") self.onerror({ message: e && e.message, error: e }); });
  w.on("exit", (code) => {
    if (self.terminated) return;
    self.terminated = true;
    if (typeof self.onerror === "function") self.onerror({ message: "worker exited with code " + code, error: null });
  });
  return self;
}

module.exports = { spawn, spawnSource };
