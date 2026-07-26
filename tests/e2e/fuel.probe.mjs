import { withPage, hold, settle, readStore, pollUntil } from "./harness.mjs";

export default async function run() {
  return withPage({ label: "fuel" }, async (page, checks) => {
    const fuel = () => page.evaluate(() => window.__fitz.flight.fuel);
    const position = () => page.evaluate(() => {
      const f = window.__fitz.flight;
      return { x: f.x, y: f.y, z: f.z };
    });
    const activeCrystals = () =>
      page.evaluate(() => (window.__fitz.crystals ?? []).filter((c) => c.active).length);

    checks.check("tank starts full", (await fuel()) === 100, `fuel=${await fuel()}`);

    const n0 = await activeCrystals();
    checks.check("field starts at the cap", n0 === 40, `active=${n0}`);

    // Cruising must not drain. Paired with a displacement assertion: without
    // it, a KeyW keypress that silently failed to register (focus loss,
    // pointer-lock gate, a listener regression) would produce the exact same
    // "fuel unchanged" result as a correctly-implemented non-draining cruise,
    // making the check pass for the wrong reason.
    const beforeCruise = await fuel();
    const cruiseStart = await position();
    await hold(page, ["KeyW"], 1500);
    const cruiseEnd = await position();
    const cruiseDisplacement = Math.hypot(
      cruiseEnd.x - cruiseStart.x, cruiseEnd.y - cruiseStart.y, cruiseEnd.z - cruiseStart.z);
    checks.check("cruising does not drain fuel", (await fuel()) === beforeCruise,
      `${beforeCruise} -> ${await fuel()}`);
    checks.check("the cruise hold actually flew (so the check above isn't vacuous)",
      cruiseDisplacement > 0.5, `displacement=${cruiseDisplacement.toFixed(2)}`);

    // Warping must drain the tank at all, and the Shift+W path must actually
    // route through the drain. The exact 8/sec rate is already pinned
    // deterministically and frame-rate-independently in tests/fuel.test.ts
    // (drainFuel(100,1)===92, drainFuel(100,0.5)===96) — a wall-clock-driven
    // e2e probe cannot add a real rate assertion on top of that without
    // exposing a simulated-time accumulator on the debug bridge purely for
    // this test, which is unnecessary given that unit coverage. So this
    // probe's job here is integration only, not rate measurement: the next
    // reader should NOT "restore" a rate assertion on `burned` — the harness
    // cannot support one.
    //
    // Poll for the outcome (burned reaching ~16, what 2 simulated seconds at
    // the configured 8/sec would produce) rather than holding for a fixed
    // wall-clock duration: this environment's headless-SwiftShader frame rate
    // runs well under real-time — measured directly, ~13 rAF ticks fire over
    // ~2.5s of wall-clock regardless of polling interval (tried 0/20/50/200ms,
    // all identical) — so a fixed-duration hold under-drains reproducibly
    // (measured burned=5.6-6.4 over a nominal 2s hold). pollUntil's own {ok}
    // is asserted explicitly below: a timeout must fail loudly rather than
    // pass silently on whatever partial burn happened to accumulate — the
    // poll's exit condition (burned>=16) is not re-asserted afterward, since
    // that would just restate what the loop already guarantees on a true exit.
    const beforeWarp = await fuel();
    for (const c of ["KeyW", "ShiftLeft"]) await page.keyboard.down(c);
    const drainPoll = await pollUntil(async () => (beforeWarp - (await fuel())) >= 16,
      { timeoutMs: 15_000, intervalMs: 300 });
    const afterWarp = await fuel();
    for (const c of ["KeyW", "ShiftLeft"]) await page.keyboard.up(c);
    const burned = beforeWarp - afterWarp;
    checks.check("warping drains the tank toward empty", drainPoll.ok && burned > 0,
      `ok=${drainPoll.ok} burned=${burned.toFixed(1)}`);
    // Sanity bound only, not a rate assertion: this bounds how far a single
    // 300ms poll interval can overshoot the ~16 target once burned crosses
    // it, nothing more. It is not evidence of the 8/sec rate — that is pinned
    // in tests/fuel.test.ts, referenced above.
    checks.check("drain overshoot past the target stays small", burned < 24,
      `burned=${burned.toFixed(1)}`);

    // Burn it dry, then prove warp is dead and cruise is not.
    await page.evaluate(() => { window.__fitz.flight.fuel = 0; });
    await settle(page, 300);
    const s = await readStore(page);
    checks.check("store registers the empty tank", s.fuelEmpty === true, `fuelEmpty=${s.fuelEmpty}`);

    const hudLabel = await page.evaluate(() =>
      document.querySelector('[data-testid="hud-fuel-label"]')?.textContent);
    checks.check("HUD reads DRY", /DRY/.test(hudLabel ?? ""), `label="${hudLabel}"`);

    await page.evaluate(() => window.__fitz.teleport(-230, -210, -230));
    await settle(page, 1200);
    await hold(page, ["KeyW", "ShiftLeft"], 1500);
    // ONE measurement, two assertions on it. Reading flight.speed twice with no
    // action between would just be the same number twice dressed up as two
    // independent checks.
    const speedOnEmpty = await page.evaluate(() => window.__fitz.flight.speed);
    checks.check("warp is disabled at zero fuel", speedOnEmpty <= 12,
      `speed with Shift held on an empty tank: ${speedOnEmpty.toFixed(2)} (cruise max is 10.8, warp is 39)`);
    checks.check("cruise still works at zero fuel (nobody is stranded)", speedOnEmpty > 1,
      `speed=${speedOnEmpty.toFixed(2)} — the ship is still moving under thrust`);
    // drainFuel clamps at 0 unconditionally, so this cannot catch "drained
    // further" — that property holds no matter whether the gate works. What
    // it actually tests is the clamp/no-underflow property: the store keeps
    // reporting exactly 0, never negative and never spuriously replenished,
    // while warp is (correctly) gated off on an empty tank.
    checks.check("fuel stays clamped at exactly zero (no underflow) while gated off",
      (await fuel()) === 0, `fuel=${await fuel()}`);

    // Refuel by flying onto a crystal.
    const target = await page.evaluate(() => {
      const c = (window.__fitz.crystals ?? []).find((s) => s.active);
      if (c) window.__fitz.teleport(c.x, c.y, c.z + 1);
      return c ? { x: c.x, y: c.y, z: c.z } : null;
    });
    checks.check("found an active crystal to fly to", target !== null, JSON.stringify(target));
    if (target) {
      await settle(page, 1500);
      const refuelled = await fuel();
      // Fuel was exactly 0 beforehand and FUEL_PER_CRYSTAL is 25, so the
      // exact value is available and strictly stronger than a one-sided bound.
      checks.check("touching a crystal refuels", refuelled === 25, `fuel=${refuelled}`);
    }

    // Cap is respected as the field refills.
    await settle(page, 6000);
    const n1 = await activeCrystals();
    checks.check("active count never exceeds the cap", n1 <= 40, `active=${n1}`);

    // No crystal buried in the asteroid bands. 3D distance from the origin,
    // not XZ radius: both belt rings are tilted (AsteroidBelt.tsx tilt=0.436
    // and tilt=1.31), and rotating a ring preserves distance from the origin
    // while destroying XZ radius. An XZ check here would flag legal crystals
    // as buried and miss genuinely buried ones.
    const buried = await page.evaluate(() =>
      (window.__fitz.crystals ?? []).filter((s) => {
        if (!s.active) return false;
        const r = Math.hypot(s.x, s.y, s.z);
        return (r >= 40 && r <= 70) || (r >= 80 && r <= 95);
      }).length);
    checks.check("no crystal spawned inside the belt or halo", buried === 0, `buried=${buried}`);
  });
}
