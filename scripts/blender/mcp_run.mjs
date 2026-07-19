#!/usr/bin/env node
// Send Python code to the official Blender MCP bridge (TCP :9876, null-delimited JSON).
// Usage:
//   node scripts/blender/mcp_run.mjs path/to/script.py
//   node scripts/blender/mcp_run.mjs -e "import bpy; result={'n': len(bpy.data.objects)}"
// The code returns data by assigning a dict to `result`.
import net from "node:net";
import { readFileSync } from "node:fs";

const HOST = process.env.BLENDER_MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.BLENDER_MCP_PORT || 9876);
const TIMEOUT_MS = Number(process.env.BLENDER_MCP_TIMEOUT || 1800) * 1000;

const [arg, inline] = process.argv.slice(2);
if (!arg) {
  console.error("usage: mcp_run.mjs <file.py> | -e <code>");
  process.exit(2);
}
const code = arg === "-e" ? inline : readFileSync(arg, "utf8");

const sock = net.createConnection(PORT, HOST);
let buf = Buffer.alloc(0);
const timer = setTimeout(() => {
  console.error(`timeout after ${TIMEOUT_MS / 1000}s`);
  process.exit(1);
}, TIMEOUT_MS);

sock.on("connect", () => {
  sock.write(JSON.stringify({ type: "execute", code, strict_json: false }) + "\0");
});
sock.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  const i = buf.indexOf(0);
  if (i < 0) return;
  clearTimeout(timer);
  const resp = JSON.parse(buf.slice(0, i).toString("utf8"));
  if (resp.stdout) console.log(resp.stdout);
  if (resp.stderr) console.error(resp.stderr);
  if (resp.status === "error") {
    console.error(resp.message);
    process.exit(1);
  }
  console.log(JSON.stringify(resp.result ?? {}, null, 2));
  process.exit(0);
});
sock.on("error", (e) => {
  console.error(`cannot reach Blender bridge on ${HOST}:${PORT} — ${e.message}`);
  console.error("Is Blender running with the MCP server started?");
  process.exit(1);
});
