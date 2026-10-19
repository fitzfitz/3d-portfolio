// Static server whose responses all share ONE bandwidth budget, like a real
// home connection (Chrome's DevTools throttling limits each request on its own,
// which flatters many parallel files). Usage: node shared-link-server.mjs <dir> <port> <bytesPerSec> <latencyMs>
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const [dir, port, rate, latency] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5]];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".glb": "model/gltf-binary", ".woff2": "font/woff2", ".woff": "font/woff" };
const TICK = 10; // ms
const queue = new Set(); // active responses: { buf, sent, res }

setInterval(() => {
  if (!queue.size) return;
  const share = Math.max(1, Math.floor((rate * TICK) / 1000 / queue.size));
  for (const job of queue) {
    const end = Math.min(job.sent + share, job.buf.length);
    job.res.write(job.buf.subarray(job.sent, end));
    job.sent = end;
    if (end >= job.buf.length) { job.res.end(); queue.delete(job); }
  }
}, TICK);

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(dir, path);
  try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); } catch { file = join(dir, "index.html"); }
  let buf;
  try { buf = await readFile(file); } catch { res.writeHead(404).end(); return; }
  setTimeout(() => {
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": buf.length, "cache-control": "no-store" });
    queue.add({ buf, sent: 0, res });
  }, latency);
}).listen(port, () => console.log(`serving ${dir} on ${port} at ${rate} B/s shared, ${latency} ms`));
