// Localhost-only static server (repo root, read-only) + POST /result sink for the S6 cross-engine check.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const out = process.argv[2];
http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/result") { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { fs.appendFileSync(out, b + "\n"); res.end("ok"); }); return; }
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream"); fs.createReadStream(p).pipe(res);
}).listen(18766, "127.0.0.1", () => console.log("listening"));
