// Runs every probe, aggregates results, exits non-zero on any failure.
//
// One Vite server for the suite; each probe runs in its own Node child
// (run-one.mjs). Phase 1 runs the SwiftShader-pinned probes one at a time with
// nothing else on the machine (startup's ceiling and transition's counters
// were measured that way). Phase 2 runs the rest on
// the GPU, E2E_JOBS at a time (default 4), longest first. See
// docs/superpowers/specs/2026-10-19-e2e-speedup-design.md.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, stopServer } from "./harness.mjs";

const ALL = ["startup", "smoke", "audio", "perf", "transition", "sky", "flight", "gameplay", "touch", "gamepad", "race", "beacons", "assets", "contact", "career", "careerphone", "shipyard", "reducedmotion", "fuel", "reactions", "events", "mechanics", "logbook", "livesky", "programs", "probes", "basepath", "memory"];
/** Run first, in this order, alone on the machine. */
const SERIAL = ["startup", "transition"];
/** Measured seconds per job (2026-10-23, PR 48), for longest-first scheduling; unknown jobs go first. */
const COST = { sky: 80, gameplay: 69, "events#0": 65, fuel: 39, "logbook#0": 37, career: 35, "programs#1": 34, "programs#0": 34, "mechanics#1": 29, livesky: 29, assets: 26, "memory#0": 25, shipyard: 20, reducedmotion: 20, flight: 18, gamepad: 18, "memory#1": 16, "mechanics#0": 14, perf: 14, touch: 14, "probes#0": 13, race: 13, basepath: 12, audio: 11, "reactions#0": 11, "events#1": 10, beacons: 10, "mechanics#2": 10, "logbook#2": 9, careerphone: 9, "mechanics#5": 9, "probes#2": 8, "reactions#1": 8, "probes#4": 8, contact: 8, "probes#5": 7, "logbook#1": 7, "probes#3": 6, "mechanics#4": 6, smoke: 5, "mechanics#3": 5, "probes#1": 5 };

/**
 * Probes whose pages are independent and run as one job each ("events#0",
 * "events#1"...), so the longest probe no longer sets the suite's wall time
 * (events alone was 170 s of a 370 s run). Each exports `parts`; run-one.mjs
 * fails a part if the probe's count no longer matches this one.
 */
const PARTS = { mechanics: 6, probes: 6, logbook: 3, programs: 2, reactions: 2, memory: 2, events: 2 };

const PROBES = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const JOBS = Number(process.env.E2E_JOBS ?? 4);
// A typo here once meant NaN workers: every GPU probe skipped, still green.
if (!Number.isInteger(JOBS) || JOBS < 1) throw new Error(`E2E_JOBS must be a positive integer, got "${process.env.E2E_JOBS}"`);
const RUN_ONE = fileURLToPath(new URL("./run-one.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "fitz-e2e-"));

/** Runs one probe in a child; prints its output as one block when it ends. */
function runProbe(name) {
  const file = join(dir, `${name}.json`);
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUN_ONE, name], {
      env: { ...process.env, E2E_SERVER_UP: "1", E2E_RESULT_FILE: file, E2E_PARTS: String(PARTS[name.split("#")[0]] ?? "") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    child.on("close", (code) => {
      const ms = Date.now() - start;
      console.log(`\n=== ${name} (${(ms / 1000).toFixed(1)}s) ===\n${log.trimEnd()}`);
      let out;
      try {
        out = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        const tail = log.trim().split("\n").slice(-3).join(" | ");
        out = { probe: name, crashed: true, timings: [],
          results: [{ name: "probe crashed", pass: false, detail: `child exited ${code} without results: ${tail}` }] };
      }
      resolve({ ...out, ms });
    });
  });
}

/** Runs `names` with at most `jobs` at once, taking them in order. */
async function pool(names, jobs) {
  const queue = [...names];
  const done = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) done.push(await runProbe(queue.shift()));
  }));
  return done;
}

const suiteStart = Date.now();
await startServer();
const serial = SERIAL.filter((n) => PROBES.includes(n));
// A split probe becomes one job per page, each costed as its share.
const jobs = PROBES.filter((n) => !SERIAL.includes(n))
  .flatMap((n) => (PARTS[n] ? Array.from({ length: PARTS[n] }, (_, k) => `${n}#${k}`) : [n]));
const cost = (job) => COST[job] ?? Infinity;
const parallel = jobs.sort((a, b) => cost(b) - cost(a));
const runs = [...await pool(serial, 1)];
const phase1Ms = Date.now() - suiteStart;
runs.push(...await pool(parallel, JOBS));
await stopServer();
rmSync(dir, { recursive: true, force: true });

const all = runs.flatMap((r) => r.results.map((c) => ({ ...c, probe: r.probe })));
// No scheduling slip may pass as green: every requested probe must have run.
for (const name of [...serial, ...jobs].filter((n) => !runs.some((r) => r.probe === n))) {
  all.push({ probe: name, name: "probe never ran", pass: false });
}
const crashed = runs.filter((r) => r.crashed).length;
const timings = runs.flatMap((r) => r.timings);
const suiteMs = Date.now() - suiteStart;
const sum = (k) => timings.reduce((a, t) => a + (t[k] ?? 0), 0);
console.log(`\nTiming: suite ${(suiteMs / 1000).toFixed(0)}s wall (serial phase ${(phase1Ms / 1000).toFixed(0)}s, then ${JOBS} at a time) over ${timings.length} pages; summed per page — ` +
  ["launch", "goto", "store", "canvas", "compile", "warm", "body", "failed", "close"]
    .map((k) => `${k} ${(sum(k) / 1000).toFixed(0)}s`).join(", ") +
  ` (of body: blind settle ${(sum("settleMs") / 1000).toFixed(0)}s)`);
for (const r of [...runs].sort((a, b) => b.ms - a.ms)) {
  const startup = r.timings.map((t) => t.sceneReadyMs).filter((v) => v != null);
  console.log(`  ${r.probe.padEnd(14)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.timings.length} page(s)` +
    `${startup.length ? `  startup ${startup.map((v) => (v / 1000).toFixed(1)).join("/")}s` : ""}`);
}
if (process.env.E2E_TIMING_OUT) {
  writeFileSync(process.env.E2E_TIMING_OUT, JSON.stringify({ suiteMs, phase1Ms, jobs: JOBS,
    probes: runs.map((r) => ({ probe: r.probe, ms: r.ms, pages: r.timings })) }, null, 2));
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
