import { withPage, settle, lockFullFidelity, SCENE_READY_TIMEOUT_MS } from "./harness.mjs";

// Shader programs must all exist by the end of warm-up: flying the whole
// system must not compile any more. Before ShaderWarmup compiled for the
// PostFX render target, a tour of the landmarks below climbed 79 → 91
// (srgb-linear variants of anything not on screen at load). After that, the
// sun still compiled one more about one run in four, from a since-removed
// post pass that flipped its material transparent after warm-up.
// The tour stops include the shipyard and the dormant gate, and every world,
// charted once warm-up is over.
//
// Low-perf is locked off before load, as on a real GPU: headless SwiftShader
// otherwise declines to low-perf while assets load, warm-up then rightly
// compiles for the screen, and the harness's later switch back to PostFX
// recompiles on top (docs/PERF-BUDGETS.md).
//
// The same tour then runs again on a page with low-perf pinned ON before load
// (no PostFX: warm-up compiles the on-screen variants), so the worlds' rings
// and atmospheres, exposed in that tier like their planets, are proven to be
// warmed there too.
export default async function run() {
  const full = await tour({ label: "programs", init: lockFullFidelity, tier: "full fidelity" });
  const low = await tour({ label: "programs (low-perf)", init: lockLowPerf, tier: "low-perf" });
  full.results.push(...low.results);
  return full;
}

/** Page-side, for evaluateOnNewDocument: lockFullFidelity's twin, pinning low-perf ON (manual). */
function lockLowPerf() {
  const lock = setInterval(() => {
    const store = window.__fitz?.store;
    if (store) { store.getState().setLowPerf(true, true); clearInterval(lock); }
  }, 5);
}

function tour({ label, init, tier }) {
  return withPage({ label }, async (page, checks) => {
    await page.evaluateOnNewDocument(init);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
    await settle(page, 3000);

    const lowPerf = await page.evaluate(() => window.__fitz.store.getState().isLowPerf);
    checks.check(`the ${tier} tier is pinned for the tour (precondition)`, lowPerf === (tier === "low-perf"),
      `isLowPerf=${lowPerf}`);

    const keys = () => page.evaluate(() => window.__fitz.gl.info.programs.map((p) => p.cacheKey));
    const before = await keys();
    // Chart every world after warm-up, so their orbit lines first show during
    // the tour (charting toggles visibility only: it must compile nothing).
    await page.evaluate(async () => {
      const { WORLD_IDS } = await import("/src/data/worlds.ts");
      for (const id of WORLD_IDS) window.__fitz.store.getState().chartWorld(id);
    });
    const stops = await page.evaluate(async () => {
      const { STATION_POS, BUOYS } = await import("/src/data/careerTrail.ts");
      const { SHIPYARD_POS } = await import("/src/data/shipyard.ts");
      const { GATE_POS, GATE_NORMAL } = await import("/src/data/dormantGate.ts");
      const mid = BUOYS[2].pos;
      return [
        ...Object.entries(window.__fitz.bodies).map(([name, b]) => [name, b.x, b.y, b.z + 30]),
        ["contact portal", 0, 95, -140],
        // 14 out: outside the station's 8.5 zone, so the tour never docks.
        ["career station", STATION_POS[0], STATION_POS[1], STATION_POS[2] + 14],
        ["career trail", mid[0] + 10, mid[1], mid[2]],
        // 14 out: outside the shipyard's 8.5 zone, so the tour never docks.
        ["shipyard", SHIPYARD_POS[0], SHIPYARD_POS[1], SHIPYARD_POS[2] + 14],
        // 40 out along the axis: inside the sense radius, so the seams flicker.
        ["dormant gate", GATE_POS[0] + GATE_NORMAL[0] * 40, GATE_POS[1] + GATE_NORMAL[1] * 40, GATE_POS[2] + GATE_NORMAL[2] * 40],
        ["sun", 0, 0, 40],
        ["deep space", -230, -210, -230],
        ["world edge", 240, 200, 240],
      ];
    });
    const worldIds = await page.evaluate(async () => (await import("/src/data/worlds.ts")).WORLD_IDS);
    checks.check(`${tier}: the tour stops at every world`, worldIds.every((id) => stops.some(([name]) => name === id)),
      `stops=${stops.map(([name]) => name).join(", ")}`);
    // A stop that orbit-locks freezes the render loop (frameloop "never"),
    // so nothing there would be drawn or compiled and the check below would
    // pass without looking: every stop must stay unlocked.
    const lockedAt = [];
    for (const [name, x, y, z] of stops) {
      await page.evaluate((p) => window.__fitz.teleport(p[0], p[1], p[2]), [x, y, z]);
      await settle(page, 1000); // ~60 frames on the GPU (SwiftShader drew 2-3 in the old 2.5 s)
      if (await page.evaluate(() => window.__fitz.store.getState().isOrbitLocked)) {
        lockedAt.push(name);
        await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
      }
    }
    checks.check(`${tier}: no tour stop orbit-locked (a lock freezes rendering, so nothing there would compile)`,
      lockedAt.length === 0, lockedAt.length ? `locked at ${lockedAt.join(", ")}` : "");
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    await settle(page, 2500);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    await settle(page, 1500);

    const added = (await keys()).filter((k) => !before.includes(k));
    checks.check(`${tier}: a tour of every landmark and world, charting every world and a warp compile no new shader program`, added.length === 0,
      `before=${before.length} added=${added.length} ${JSON.stringify(added.map((k) => k.split(",").slice(0, 3).join(",")))}`);
  });
}
