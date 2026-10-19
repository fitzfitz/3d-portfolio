// Runs every probe, aggregates results, exits non-zero on any failure.
import { writeFileSync } from "node:fs";
import { stopServer, timings } from "./harness.mjs";

const PROBES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["smoke", "audio", "perf", "transition", "sky", "flight", "gameplay", "touch", "gamepad", "race", "beacons", "assets", "contact", "career", "careerphone", "shipyard", "reducedmotion", "fuel", "reactions", "events", "mechanics", "logbook", "livesky", "programs", "basepath"];

const all = [];
const probeMs = [];
let crashed = 0;
const suiteStart = Date.now();

for (const name of PROBES) {
  console.log(`\n=== ${name} ===`);
  const probeStart = Date.now();
  const firstPage = timings.length;
  try {
    const mod = await import(`./${name}.probe.mjs`);
    const checks = await mod.default();
    all.push(...checks.results.map((r) => ({ ...r, probe: name })));
  } catch (e) {
    crashed++;
    // puppeteer's generic "Waiting failed" hides the real error in e.cause
    // (a protocol error, a closed target, ...); print the chain so a crash
    // under load can be told from a real failure.
    let msg = e.message;
    for (let c = e.cause, i = 0; c && i < 3; c = c.cause, i++) msg += ` <- ${c.message ?? c}`;
    console.log(`  CRASH ${name}: ${msg}`);
    all.push({ probe: name, name: "probe crashed", pass: false, detail: msg });
  }
  probeMs.push({ probe: name, ms: Date.now() - probeStart, pages: timings.slice(firstPage) });
}

await stopServer();

const suiteMs = Date.now() - suiteStart;
const sum = (k) => timings.reduce((a, t) => a + (t[k] ?? 0), 0);
console.log(`\nTiming: suite ${(suiteMs / 1000).toFixed(0)}s over ${timings.length} pages — ` +
  ["launch", "goto", "store", "canvas", "compile", "warm", "body", "close"]
    .map((k) => `${k} ${(sum(k) / 1000).toFixed(0)}s`).join(", ") +
  ` (of body: blind settle ${(sum("settleMs") / 1000).toFixed(0)}s)`);
for (const p of [...probeMs].sort((a, b) => b.ms - a.ms)) {
  console.log(`  ${p.probe.padEnd(14)} ${(p.ms / 1000).toFixed(1).padStart(6)}s  ${p.pages.length} page(s)`);
}
if (process.env.E2E_TIMING_OUT) {
  writeFileSync(process.env.E2E_TIMING_OUT, JSON.stringify({ suiteMs, probes: probeMs }, null, 2));
}

const failed = all.filter((r) => !r.pass);
const notes = all.filter((r) => r.note);
console.log(`\n${all.length - failed.length}/${all.length} checks passed` +
  `${notes.length ? `, ${notes.length} capture-only` : ""}${crashed ? `, ${crashed} probe crash(es)` : ""}`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ${f.probe}: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
