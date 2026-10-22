// Static server whose responses all share ONE bandwidth budget, like a real
// home connection (Chrome's DevTools throttling limits each request on its own,
// which flatters many parallel files). Usage: node shared-link-server.mjs <dir> <port> <bytesPerSec> <latencyMs>
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const [dir, port, rate, latency] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5]];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".ktx2": "image/ktx2", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".woff2": "font/woff2", ".woff": "font/woff" };
const TICK = 10; // ms
const queue = new Set(); // active responses: { buf, sent, res }

// A token bucket on real elapsed time, not a fixed amount per tick: timers
// fire late when the machine is busy (the browser under test shares the CPU),
// and a per-tick budget then slowed the "link" for whichever build kept the
// CPU busier. Each tick hands out rate × elapsed, split evenly among active
// responses, with what a finished response leaves over going to the rest.
// An idle link earns nothing, and a late tick catches up at most 100 ms.
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  let budget = queue.size ? (rate * Math.min(now - last, 100)) / 1000 : 0;
  last = now;
  while (budget >= 1 && queue.size) {
    const share = budget / queue.size;
    for (const job of queue) {
      const end = Math.min(job.sent + Math.max(1, Math.floor(share)), job.buf.length);
      job.res.write(job.buf.subarray(job.sent, end));
      budget -= end - job.sent;
      job.sent = end;
      if (end >= job.buf.length) { job.res.end(); queue.delete(job); }
    }
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
