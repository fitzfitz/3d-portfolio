// Runs one probe in its own process for run.mjs and writes its results and
// page timings to E2E_RESULT_FILE. One process per probe keeps the harness's
// module state (server handle, timings) per probe, and a crash or a blocking
// call (assets' Blender run) stalls only this probe.
//
// Also runs a probe on its own: `node tests/e2e/run-one.mjs perf`. Then no
// shared server is up, so the probe's withPage starts its own Vite, and this
// file stops it again before exiting (the harness's exit hook backs that up).
import { writeFileSync } from "node:fs";
import { stopServer, timings } from "./harness.mjs";

// `name#k` runs page k of a probe that exports `parts` (run.mjs PARTS); its
// count must match what run.mjs expects, so the two cannot drift silently.
const name = process.argv[2];
const [base, part] = name.split("#");
const out = { probe: name, results: [], timings, crashed: false };
try {
  const mod = await import(`./${base}.probe.mjs`);
  let checks;
  if (part === undefined) checks = await mod.default();
  else {
    const expected = Number(process.env.E2E_PARTS);
    if (!Array.isArray(mod.parts)) throw new Error(`${base}.probe.mjs exports no parts, but run.mjs PARTS splits it`);
    // Run by hand (`node tests/e2e/run-one.mjs events#1`) there is no PARTS to check against.
    if (process.env.E2E_PARTS && mod.parts.length !== expected) throw new Error(`${base}.probe.mjs has ${mod.parts.length} parts, run.mjs PARTS says ${expected}`);
    if (!mod.parts[Number(part)]) throw new Error(`${base}.probe.mjs has no part ${part}`);
    checks = await mod.parts[Number(part)]();
  }
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
} finally {
  await stopServer();
}
const failed = out.results.filter((r) => !r.pass);
if (process.env.E2E_RESULT_FILE) writeFileSync(process.env.E2E_RESULT_FILE, JSON.stringify(out));
else console.log(`\n${name}: ${out.results.length - failed.length}/${out.results.length} checks passed`);
// Puppeteer or a probe's own child can leave handles open; the result is
// written, so end here rather than hang the pool. Under run.mjs the exit code
// is not read (the result file is); alone, it reports the probe.
process.exit(process.env.E2E_RESULT_FILE ? 0 : failed.length ? 1 : 0);
