import { withPage, hold, settle, sceneQuery, toDeepSpace } from "./harness.mjs";

// cargo_ship.glb's own root mesh node is named "CargoShip" (its sibling
// "RadarDish" is looked up the same way in CargoTraffic.tsx via
// getObjectByName). CargoTraffic.tsx also names each wrapper group
// "CargoShip${i}" for e2e assertions. A bare prefix match on "CargoShip"
// therefore matches both the wrapper AND the asset-internal node nested
// inside it, double-counting every ship (5 -> 10, 3 -> 6). Anchor to exactly
// one trailing digit so only the wrapper groups count.
const countCargoShips = (page) => page.evaluate(() => {
  let n = 0;
  window.__fitz.scene.traverse((o) => { if (/^CargoShip\d$/.test(o.name)) n++; });
  return n;
});

export default async function run() {
  return withPage({ label: "perf" }, async (page, checks) => {
    // ---- full-detail baseline ----
    const beltFull = await sceneQuery(page, "BeltMain");
    checks.check("belt is 400 instances at full detail", beltFull.count === 400,
      `count=${beltFull.count}`);
    const haloFull = await sceneQuery(page, "BeltHalo");
    checks.check("polar halo present at full detail", haloFull.found);
    const cargoFull = await countCargoShips(page);
    checks.check("5 cargo ships at full detail", cargoFull === 5, `count=${cargoFull}`);
    const coronaFull = await sceneQuery(page, "SunCorona");
    checks.check("sun corona present at full detail", coronaFull.found);
    const tunnelFull = await sceneQuery(page, "WarpTunnel");
    checks.check("warp tunnel mounted at full detail", tunnelFull.found);

    // ---- forced low-perf ----
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(true, true));
    await settle(page, 1500);

    const beltLow = await sceneQuery(page, "BeltMain");
    checks.check("belt halves to 200 in low-perf", beltLow.count === 200, `count=${beltLow.count}`);
    const haloLow = await sceneQuery(page, "BeltHalo");
    checks.check("polar halo dropped in low-perf", !haloLow.found);
    const cargoLow = await countCargoShips(page);
    checks.check("cargo drops to 3 in low-perf", cargoLow === 3, `count=${cargoLow}`);
    const coronaLow = await sceneQuery(page, "SunCorona");
    checks.check("sun corona dropped in low-perf", !coronaLow.found);
    const tunnelLow = await sceneQuery(page, "WarpTunnel");
    checks.check("warp tunnel dropped in low-perf", !tunnelLow.found);

    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(false, true));
    await settle(page, 1500);

    // ---- steady-flight commit count ----
    // Steady state means: deep space, no activeZone, no cometNear, no scan,
    // no altitude warning. If any store key changes during the window the
    // sample is inconclusive rather than failed — retry up to 3 times.
    await toDeepSpace(page);
    const KEYS = ["activeZone", "isNearSpawn", "cometNear", "altitudeWarn", "scanTarget",
      "isOrbitLocked", "isWarping", "isLowPerf", "impactCount", "broadcast"];

    let conclusive = false;
    let delta = -1;
    let churn = "";
    for (let attempt = 1; attempt <= 3 && !conclusive; attempt++) {
      const snap = () => page.evaluate((keys) => {
        const s = window.__fitz.store.getState();
        const out = {};
        for (const k of keys) out[k] = JSON.stringify(s[k]);
        return { store: out, renders: window.__fitz.renderCount };
      }, KEYS);

      const a = await snap();
      await hold(page, ["KeyW"], 5000);
      const b = await snap();

      const changed = KEYS.filter((k) => a.store[k] !== b.store[k]);
      delta = b.renders - a.renders;
      if (changed.length === 0) conclusive = true;
      else churn = changed.join(",");
    }

    if (conclusive) {
      checks.check("zero React commits during 5s of steady flight", delta === 0,
        `commits=${delta}`);
    } else {
      checks.check("steady-flight commit sample was conclusive", false,
        `store kept changing (${churn}) across 3 attempts — cannot isolate steady state`);
    }
  });
}
