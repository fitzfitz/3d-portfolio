import { withPage, settle, lockFullFidelity, SCENE_READY_TIMEOUT_MS } from "./harness.mjs";

// Shader programs must all exist by the end of warm-up: flying the whole
// system must not compile any more. Before ShaderWarmup compiled for the
// PostFX render target, a tour of the landmarks below climbed 79 → 91
// (srgb-linear variants of anything not on screen at load). After that, the
// sun still compiled one more about one run in four: GodRaysEffect forced its
// material transparent after warm-up whenever PostFX mounted late (godRays.ts).
// The tour stops include the shipyard and the dormant gate.
//
// Low-perf is locked off before load, as on a real GPU: headless SwiftShader
// otherwise declines to low-perf while assets load, warm-up then rightly
// compiles for the screen, and the harness's later switch back to PostFX
// recompiles on top (docs/PERF-BUDGETS.md).
export default async function run() {
  return withPage({ label: "programs" }, async (page, checks) => {
    await page.evaluateOnNewDocument(lockFullFidelity);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
    await settle(page, 3000);

    const keys = () => page.evaluate(() => window.__fitz.gl.info.programs.map((p) => p.cacheKey));
    const before = await keys();
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
    for (const [, x, y, z] of stops) {
      await page.evaluate((p) => window.__fitz.teleport(p[0], p[1], p[2]), [x, y, z]);
      await settle(page, 2500);
    }
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    await settle(page, 2500);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    await settle(page, 1500);

    const added = (await keys()).filter((k) => !before.includes(k));
    checks.check("a tour of every landmark and a warp compile no new shader program", added.length === 0,
      `before=${before.length} added=${added.length} ${JSON.stringify(added.map((k) => k.split(",").slice(0, 3).join(",")))}`);
  });
}
