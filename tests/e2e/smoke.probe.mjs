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
  });
}
