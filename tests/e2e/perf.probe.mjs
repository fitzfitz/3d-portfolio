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

    // The zero-commit result only means something if the ship genuinely flew
    // during the hold — otherwise delta=0 could just as well mean "KeyW did
    // nothing" (pointer-lock gate, listener regression, focus loss) as "flew
    // with zero renders." Basis for the threshold: Spaceship.tsx uses
    // ACCEL=25.2 world-units/s^2 up to SHIP_MAX_SPEED=10.8 (src/constants.ts),
    // so from rest it reaches max speed in ~0.43s and covers roughly 50 world
    // units over the remaining ~4.6s of a 5s hold. 5 units is comfortably
    // below that expected distance but many orders of magnitude above any
    // float-precision position noise, so it only trips on a real failure to
    // move.
    const MIN_FLIGHT_DISPLACEMENT = 5;

    let conclusive = false;
    let delta = -1;
    let displacement = -1;
    // Reassigned unconditionally on every attempt below (never merely
    // conditionally overwritten), so after the loop these always describe the
    // LAST attempt tried — never a stale cause from an earlier, different
    // attempt. This is what keeps "store churned" distinguishable from "ship
    // never moved" distinguishable from "steady state genuinely had renders"
    // (that third case is a separate, already-scoped check below).
    let churn = "";
    let motionReason = "";
    for (let attempt = 1; attempt <= 3 && !conclusive; attempt++) {
      const snap = () => page.evaluate((keys) => {
        const s = window.__fitz.store.getState();
        const out = {};
        for (const k of keys) out[k] = JSON.stringify(s[k]);
        const f = window.__fitz.flight;
        return { store: out, renders: window.__fitz.renderCount,
          pos: { x: f.x, y: f.y, z: f.z }, speed: f.speed };
      }, KEYS);

      const a = await snap();
      await hold(page, ["KeyW"], 5000);
      const b = await snap();

      const changed = KEYS.filter((k) => a.store[k] !== b.store[k]);
      delta = b.renders - a.renders;
      displacement = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
      const moved = displacement >= MIN_FLIGHT_DISPLACEMENT;

      // A motionless sample is treated exactly like a churned one: it cannot
      // support a conclusion about renders during real flight, so it retries
      // rather than failing outright on a single sample. If input is truly
      // broken (not just a first-hold timing fluke) it will still be
      // motionless on attempt 3 and correctly fall through to the failure
      // branch below — never a silent pass.
      // Unconditional per-attempt reset: an attempt that didn't churn must
      // clear out any churn key a PRIOR attempt left behind, otherwise the
      // final message could cite attempt 1's churned key alongside attempt
      // 3's motionlessness even though they never co-occurred.
      churn = changed.length ? changed.join(",") : "";
      motionReason = moved ? "" :
        `displacement=${displacement.toFixed(2)} (need >= ${MIN_FLIGHT_DISPLACEMENT}), speed a=${a.speed.toFixed(2)} b=${b.speed.toFixed(2)}`;

      if (changed.length === 0 && moved) conclusive = true;
    }

    if (conclusive) {
      checks.check("ship displaced during the 5s hold (flight input genuinely moved it)",
        displacement >= MIN_FLIGHT_DISPLACEMENT, `Δ=${displacement.toFixed(2)}`);
      checks.check("zero React commits during 5s of steady flight", delta === 0,
        `commits=${delta}`);
    } else {
      const reasons = [
        churn && `store kept changing (${churn})`,
        motionReason && `ship did not move (${motionReason})`,
      ].filter(Boolean).join("; ");
      checks.check("steady-flight commit sample was conclusive", false,
        `${reasons} across 3 attempts — cannot isolate steady state`);
    }
  });
}
