// Runs one probe in its own process for run.mjs and writes its results and
// page timings to E2E_RESULT_FILE. One process per probe keeps the harness's
// module state (server handle, timings) per probe, and a crash or a blocking
// call (assets' Blender run) stalls only this probe.
import { writeFileSync } from "node:fs";
import { timings } from "./harness.mjs";

const name = process.argv[2];
const out = { probe: name, results: [], timings, crashed: false };
try {
  const mod = await import(`./${name}.probe.mjs`);
  const checks = await mod.default();
  out.results = checks.results;
} catch (e) {
  out.crashed = true;
  // puppeteer's generic "Waiting failed" hides the real error in e.cause
  // (a protocol error, a closed target, ...); print the chain so a crash
  // under load can be told from a real failure.
  let msg = e.message;
  for (let c = e.cause, i = 0; c && i < 3; c = c.cause, i++) msg += ` <- ${c.message ?? c}`;
  console.log(`  CRASH ${name}: ${msg}`);
  out.results = [{ name: "probe crashed", pass: false, detail: msg }];
}
writeFileSync(process.env.E2E_RESULT_FILE, JSON.stringify(out));
// Puppeteer or a probe's own child can leave handles open; the result is
// written, so end here rather than hang the pool.
process.exit(0);
