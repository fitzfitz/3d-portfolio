import { withPage, sceneQuery } from "./harness.mjs";

export default async function run() {
  return withPage({ label: "smoke" }, async (page, checks) => {
    const bridge = await page.evaluate(() => ({
      hasStore: typeof window.__fitz?.store?.getState === "function",
      hasFlight: typeof window.__fitz?.flight?.x === "number",
      hasScene: !!window.__fitz?.scene,
      renderCount: window.__fitz?.renderCount ?? -1,
    }));
    checks.check("bridge exposes store", bridge.hasStore);
    checks.check("bridge exposes flight telemetry", bridge.hasFlight);
    checks.check("bridge exposes scene", bridge.hasScene);
    checks.check("Profiler counted commits during boot", bridge.renderCount > 0,
      `renderCount=${bridge.renderCount}`);

    for (const name of ["BeltMain", "DataShards", "WarpTunnel", "NebulaCluster"]) {
      const o = await sceneQuery(page, name);
      checks.check(`scene object ${name} exists`, o.found, `matches=${o.matches}`);
    }

    // SPAWN is -50, 62, 69 (src/data/spawn.ts); a probe cannot import TypeScript.
    const camDist = await page.evaluate(() => {
      const c = window.__fitz.camera?.position;
      return c ? Math.hypot(c.x - -50, c.y - 62, c.z - 69) : null;
    });
    checks.check("the camera starts at the ship, not across the system", camDist !== null && camDist < 30,
      `camera distance to SPAWN=${camDist === null ? "n/a" : camDist.toFixed(1)}`);

    await page.evaluate(() => window.__fitz.teleport(-230, -210, -230));
    await new Promise((r) => setTimeout(r, 1200));
    const p = await page.evaluate(() => {
      const f = window.__fitz.flight;
      return { x: f.x, y: f.y, z: f.z };
    });
    const near = Math.hypot(p.x - -230, p.y - -210, p.z - -230) < 25;
    checks.check("teleport moves the ship and it stays there", near,
      `pos=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
  });
}
