import { withPage, hold, settle, readStore, pollUntil, nextFrames } from "./harness.mjs";


export default async function run() {
  return withPage({ label: "fuel" }, async (page, checks) => {
    const fuel = () => page.evaluate(() => window.__fitz.flight.fuel);
    const position = () => page.evaluate(() => {
      const f = window.__fitz.flight;
      return { x: f.x, y: f.y, z: f.z };
    });

    // Every teleport in this probe goes through here. An orbit lock freezes the
    // scene loop (selectSceneFrozen -> frameloop "never"), and while frozen
    // fitzDebug.teleport only writes a ref nobody reads, so the ship would stay
    // put and every later check would run against a frozen world. So: break the
    // lock through the store's own breakOrbit action (the Esc path), teleport,
    // pump a few frames, then assert the ship really arrived and is not locked.
    const locked = () => page.evaluate(() => window.__fitz.store.getState().isOrbitLocked);
    const teleportTo = async (x, y, z, label, tolerance = 1) => {
      const distTo = async () => {
        const p = await position();
        return Math.hypot(p.x - x, p.y - y, p.z - z);
      };
      // A capture can land between the lock check and the teleport (the ship
      // is coasting through a planet's zone), so retry: break any lock, teleport,
      // then poll for an unlocked arrival. teleport sets flight.x/y/z at once,
      // so the poll's real job is to catch a lock that engaged around the jump.
      let attempts = 0, broke = false;
      const tries = [];
      for (; attempts < 3; attempts++) {
        if (await locked()) {
          broke = true;
          await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
          await pollUntil(async () => !(await locked()), { timeoutMs: 5000, intervalMs: 100 });
        }
        await page.evaluate(([tx, ty, tz]) => window.__fitz.teleport(tx, ty, tz), [x, y, z]);
        const arrived = await pollUntil(async () => !(await locked()) && (await distTo()) <= tolerance, { timeoutMs: 3000, intervalMs: 100 });
        if (arrived.ok) break;
        tries.push(`#${attempts + 1} missed by ${(await distTo()).toFixed(1)} locked=${await locked()}`);
      }
      await nextFrames(page); // let the radar's rAF loop repaint at the new position
      const dist = await distTo();
      const stillLocked = await locked();
      checks.check(`${label}: teleport landed (within ${tolerance} unit${tolerance === 1 ? "" : "s"}, not orbit-locked)`,
        dist <= tolerance && !stillLocked,
        `dist=${dist.toFixed(2)} locked=${stillLocked} attempts=${Math.min(attempts + 1, 3)}${tries.length ? ` [${tries.join("; ")}]` : ""}${broke ? " (orbit lock broken first)" : ""}`);
    };

    checks.check("tank starts full", (await fuel()) === 100, `fuel=${await fuel()}`);

    // The fly-through fuel crystals are gone (2026-10-26): the drive's own
    // refill and mining keep the tank. Nothing named FuelCrystals is drawn.
    const crystalMesh = await page.evaluate(() => !!window.__fitz.scene.getObjectByName("FuelCrystals"));
    checks.check("no fuel crystals in the scene", !crystalMesh, `found=${crystalMesh}`);

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
    // route through the drain. The exact 1.6/sec rate is already pinned
    // deterministically and frame-rate-independently in tests/fuel.test.ts
    // (drainFuel(100,1)===98.4, drainFuel(100,0.5)===99.2) — a wall-clock-driven
    // e2e probe cannot add a real rate assertion on top of that without
    // exposing a simulated-time accumulator on the debug bridge purely for
    // this test, which is unnecessary given that unit coverage. So this
    // probe's job here is integration only, not rate measurement: the next
    // reader should NOT "restore" a rate assertion on `burned` — the harness
    // cannot support one.
    //
    // Poll for the outcome (burned reaching ~3.2, what 2 simulated seconds at
    // the configured 1.6/sec would produce) rather than holding for a fixed
    // wall-clock duration: this environment's headless-SwiftShader frame rate
    // runs well under real-time — measured directly, ~13 rAF ticks fire over
    // ~2.5s of wall-clock regardless of polling interval (tried 0/20/50/200ms,
    // all identical) — so a fixed-duration hold under-drains reproducibly
    // (measured burned=5.6-6.4 over a nominal 2s hold at the old 8/sec). pollUntil's own {ok}
    // is asserted explicitly below: a timeout must fail loudly rather than
    // pass silently on whatever partial burn happened to accumulate — the
    // poll's exit condition (burned>=3.2) is not re-asserted afterward, since
    // that would just restate what the loop already guarantees on a true exit.
    const beforeWarp = await fuel();
    for (const c of ["KeyW", "ShiftLeft"]) await page.keyboard.down(c);
    const drainPoll = await pollUntil(async () => (beforeWarp - (await fuel())) >= 3.2,
      { timeoutMs: 30_000, intervalMs: 300 });
    const afterWarp = await fuel();
    for (const c of ["KeyW", "ShiftLeft"]) await page.keyboard.up(c);
    const burned = beforeWarp - afterWarp;
    checks.check("warping drains the tank toward empty", drainPoll.ok && burned > 0,
      `ok=${drainPoll.ok} burned=${burned.toFixed(1)}`);
    // Sanity bound only, not a rate assertion: this bounds how far a single
    // 300ms poll interval can overshoot the ~3.2 target once burned crosses
    // it, nothing more. It is not evidence of the 1.6/sec rate — that is pinned
    // in tests/fuel.test.ts, referenced above.
    checks.check("drain overshoot past the target stays small", burned < 4.8,
      `burned=${burned.toFixed(1)}`);

    // Burn it dry, then prove warp is dead and cruise is not. The tank now
    // refills on its own whenever warp is released (stepFuel, 2026-10-17), so
    // the dev hook holds the refill off for this section.
    await page.evaluate(() => { window.__fitz.fuelDebug.holdRegen = true; window.__fitz.flight.fuel = 0; });
    await settle(page, 300);
    const s = await readStore(page);
    checks.check("store registers the empty tank", s.fuelEmpty === true, `fuelEmpty=${s.fuelEmpty}`);
    // The dry line points at the drive's own refill: there are no crystals to
    // collect any more. Read right as the tank empties, before any later line
    // (a shard, a world event) can replace it in store.broadcast.
    const DRY_LINE = "WARP CORE DRY // RELEASE WARP TO RECHARGE — THRUSTERS STILL NOMINAL";
    const dry = await pollUntil(async () => ((await readStore(page)).broadcast?.text === DRY_LINE ? true : null),
      { timeoutMs: 3000, intervalMs: 100 });
    checks.check("the dry-tank line says to release warp to recharge", dry.ok,
      `text="${(await readStore(page)).broadcast?.text}"`);

    const hudLabel = await page.evaluate(() =>
      document.querySelector('[data-testid="hud-fuel-label"]')?.textContent);
    checks.check("HUD reads DRY", /DRY/.test(hudLabel ?? ""), `label="${hudLabel}"`);

    // When planets still docked, the warp drain left the ship coasting through
    // ruangrapi's zone and an orbit capture could land in the same frames as
    // this teleport, leaving the ship short of it (~40-unit offsets; the debug
    // teleport zeroes velocity, so not momentum). Planets no longer lock (their
    // dossiers moved onto probes) and the drain runs clear of every
    // destination, so this lands first time; teleportTo's retry (break any
    // lock, teleport again) stays as the guard, and its attempt log is in the
    // check detail.
    await teleportTo(-230, -210, -230, "dry-tank spot");
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

    // Let go of the hook: the drive refills the tank on its own, empty to full in
    // 20 simulated seconds (FUEL_REGEN_PER_SEC = 5). Headless runs at roughly a
    // third of real time, hence the generous timeout.
    await page.evaluate(() => { window.__fitz.flight.fuel = 0; window.__fitz.fuelDebug.holdRegen = false; });
    const refill = await pollUntil(async () => (await fuel()) >= 99.9, { timeoutMs: 120_000, intervalMs: 1000 });
    checks.check("releasing warp refills the tank on its own", refill.ok, `fuel=${(await fuel()).toFixed(1)}`);

    // A refill from dry clears the DRY state: warp is back on.
    const back = await pollUntil(async () => (await readStore(page)).fuelEmpty === false, { timeoutMs: 5000, intervalMs: 200 });
    const label = await page.evaluate(() => document.querySelector('[data-testid="hud-fuel-label"]')?.textContent);
    checks.check("the refilled tank clears DRY in the store and on the HUD", back.ok && !/DRY/.test(label ?? ""),
      `fuelEmpty ok=${back.ok} label="${label}"`);
  });
}
