import { withPage, sceneQuery } from "./harness.mjs";

/**
 * Runs in the page from document start. Hooks gl.render as soon as the bridge
 * has the renderer and records the camera's distance from SPAWN on each of
 * the first FRAMES renders: window.__camMax = { max, n }.
 */
const CAM_RECORDER = () => {
  const FRAMES = 60;
  const tick = async () => {
    const d = window.__fitz;
    if (!d?.gl || !d?.camera) return requestAnimationFrame(tick);
    const { SPAWN } = await import("/src/data/spawn.ts");
    const orig = d.gl.render.bind(d.gl);
    window.__camMax = { max: 0, n: 0 };
    d.gl.render = (...a) => {
      const m = window.__camMax;
      if (m.n < FRAMES) {
        const c = d.camera.position;
        m.max = Math.max(m.max, Math.hypot(c.x - SPAWN.x, c.y - SPAWN.y, c.z - SPAWN.z));
        m.n++;
      }
      return orig(...a);
    };
  };
  requestAnimationFrame(tick);
};

export default async function run() {
  return withPage({ label: "smoke", initScript: CAM_RECORDER }, async (page, checks) => {
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

    // The camera must start at the ship, not across the system. The canvas'
    // default camera sits near SPAWN already and the load has settled by now,
    // so a settled read cannot fail; instead the init script records the MAX
    // camera distance from SPAWN over the first renders (spawn.ts is imported
    // in the page, as other probes do). Negative control: disabling the
    // first-frame snap in Spaceship.tsx makes this fail.
    const camMax = await page.evaluate(() => window.__camMax ?? null);
    checks.check("the camera starts at the ship, not across the system (max over the first renders)",
      camMax !== null && camMax.n >= 5 && camMax.max < 30,
      camMax ? `max distance to SPAWN=${camMax.max.toFixed(1)} over ${camMax.n} renders` : "no renders recorded");

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
