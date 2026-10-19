import { withPage, timings, Checks, STARTUP_DURATION_CEILING_MS } from "./harness.mjs";

/**
 * The eager scene-compile startup budget (docs/PERF-BUDGETS.md), asserted on
 * the best of up to LOADS fresh loads on SwiftShader, where it was measured
 * (it stops at the first load inside the ceiling).
 *
 * withPage records every page's startup but no longer asserts it: a busy
 * machine (load 8-11 is normal on the owner's Mac) pushed single loads to
 * 15-37 s and failed random pages. One fast load proves the app can still
 * start inside the ceiling; a real doubling slows all three and still fails.
 * run.mjs runs this first and alone, so its first load also warms Vite's
 * dependency optimizer before probes run in parallel.
 */
const LOADS = 3;

export default async function run() {
  const checks = new Checks("startup");
  const ms = [];
  for (let i = 0; i < LOADS; i++) {
    const c = await withPage({ label: `startup ${i + 1}/${LOADS}`, backend: "swiftshader" }, async () => {});
    checks.results.push(...c.results);
    ms.push(timings.at(-1).sceneReadyMs ?? Infinity);
    if (ms.at(-1) <= STARTUP_DURATION_CEILING_MS) break; // the best can only be lower
  }
  const best = Math.min(...ms);
  checks.check("eager scene-compile startup time within ceiling, best of up to three loads (docs/PERF-BUDGETS.md)",
    best <= STARTUP_DURATION_CEILING_MS,
    `best=${best}ms of ${ms.join("/")}ms ceiling=${STARTUP_DURATION_CEILING_MS}ms`);
  return checks;
}
