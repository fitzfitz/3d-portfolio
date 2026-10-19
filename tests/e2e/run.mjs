// Runs every probe, aggregates results, exits non-zero on any failure.
import { stopServer } from "./harness.mjs";

const PROBES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["smoke", "audio", "perf", "transition", "sky", "flight", "gameplay", "touch", "gamepad", "race", "beacons", "assets", "contact", "career", "careerphone", "shipyard", "reducedmotion", "fuel", "reactions", "events", "mechanics", "logbook", "livesky", "programs", "basepath"];

const all = [];
let crashed = 0;

for (const name of PROBES) {
  console.log(`\n=== ${name} ===`);
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
}

await stopServer();

const failed = all.filter((r) => !r.pass);
const notes = all.filter((r) => r.note);
console.log(`\n${all.length - failed.length}/${all.length} checks passed` +
  `${notes.length ? `, ${notes.length} capture-only` : ""}${crashed ? `, ${crashed} probe crash(es)` : ""}`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ${f.probe}: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
