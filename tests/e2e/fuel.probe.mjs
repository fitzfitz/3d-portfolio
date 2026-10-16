import { withPage, hold, settle, readStore, pollUntil, chatterText } from "./harness.mjs";

/**
 * Ticks real rAF frames forward via repeated CDP round-trips rather than one
 * blind settle() — see harness.mjs's settle() warning and ogimage.mjs's own
 * `pump`. RadarMap draws from its own rAF loop reading live `flight.x/y/z`
 * directly (no lerp), but that loop still only advances on an actual paint,
 * and headless SwiftShader barely services rAF during an idle setTimeout
 * with zero CDP traffic. Verified empirically: sampling the radar canvas
 * right after `teleport()` + a single settle() intermittently caught a
 * stale pre-teleport frame (a real, but out-of-range, crystal blip still
 * on-screen); pumping a few frames first made the canvas catch up before
 * every sample.
 */
async function pump(page, n) {
  for (let i = 0; i < n; i++) await page.evaluate(() => true);
}

export default async function run() {
  return withPage({ label: "fuel" }, async (page, checks) => {
    const fuel = () => page.evaluate(() => window.__fitz.flight.fuel);
    const position = () => page.evaluate(() => {
      const f = window.__fitz.flight;
      return { x: f.x, y: f.y, z: f.z };
    });
    const activeCrystals = () =>
      page.evaluate(() => (window.__fitz.crystals ?? []).filter((c) => c.active).length);

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
      // then poll for the arrival. flight.x/y/z only republish on a real frame
      // and headless rAF lags under load, so a fixed pump is not enough.
      let attempts = 0, broke = false;
      for (; attempts < 3; attempts++) {
        if (await locked()) {
          broke = true;
          await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
          await pollUntil(async () => !(await locked()), { timeoutMs: 5000, intervalMs: 100 });
        }
        await page.evaluate(([tx, ty, tz]) => window.__fitz.teleport(tx, ty, tz), [x, y, z]);
        const arrived = await pollUntil(async () => (await distTo()) <= tolerance, { timeoutMs: 3000, intervalMs: 100 });
        if (arrived.ok) break;
      }
      await pump(page, 10); // let the radar's rAF loop repaint at the new position
      const dist = await distTo();
      const stillLocked = await locked();
      checks.check(`${label}: teleport landed (within ${tolerance} unit${tolerance === 1 ? "" : "s"}, not orbit-locked)`,
        dist <= tolerance && !stillLocked,
        `dist=${dist.toFixed(2)} locked=${stillLocked} attempts=${Math.min(attempts + 1, 3)}${broke ? " (orbit lock broken first)" : ""}`);
    };

    // An active crystal at least 100 units clear of every planet and destination
    // (offset by dz on z, wrapped). A ship parked beside a planet gets orbit-
    // captured, which freezes the scene: pickups and crystal respawns stop and
    // the checks that follow run against a frozen world.
    const pickCrystal = (dz) => page.evaluate(async (dzv) => {
      const { COSMIC_BOUNDS } = await import("/src/constants.ts");
      const { DESTINATIONS } = await import("/src/data/destinations.ts");
      const wrapCoord = (v) => (((v + COSMIC_BOUNDS) % (2 * COSMIC_BOUNDS) + 2 * COSMIC_BOUNDS) % (2 * COSMIC_BOUNDS)) - COSMIC_BOUNDS;
      const anchors = [...Object.values(window.__fitz.bodies), ...DESTINATIONS.map((d) => ({ x: d.pos[0], y: d.pos[1], z: d.pos[2] }))];
      const clear = (c) => anchors.every((a) => Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) > 100);
      const cr = (window.__fitz.crystals ?? []).find((s) => s.active && clear(s));
      return cr ? { x: cr.x, y: cr.y, z: wrapCoord(cr.z + dzv) } : null;
    }, dz);

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
      { timeoutMs: 30_000, intervalMs: 300 });
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

    // Teleport zeroes the ship's velocity but not the warp coast it was in, so the
    // ship drifts ~40 units (its stopping distance) before it settles. 60 still
    // fails loudly for a frozen scene, where the ship stays ~400 units away.
    await teleportTo(-230, -210, -230, "dry-tank spot", 60);
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
    const target = await pickCrystal(0);
    checks.check("found an active crystal to fly to", target !== null, JSON.stringify(target));
    if (target) {
      await teleportTo(target.x, target.y, target.z + 1, "refuel crystal");
      await settle(page, 1500);
      const refuelled = await fuel();
      // Fuel was exactly 0 beforehand and FUEL_PER_CRYSTAL is 25, so the
      // exact value is available and strictly stronger than a one-sided bound.
      checks.check("touching a crystal refuels", refuelled === 25, `fuel=${refuelled}`);

      // The tank was at exactly 0 before this pickup, so it is a `restored`
      // outcome and must say so — this is the line that closes the loop the
      // DRY broadcast opens. Substring, not full string: typeLine types at
      // ~22ms/char (RadioChatter.tsx:26), so the line arrives progressively
      // and "WARP CORE RECHARGED" (19 chars, ~420ms) lands well before the
      // poll's timeout. Polling rather than a single read also means this
      // does not depend on settle() having waited long enough.
      const saidRecharged = await pollUntil(
        async () => ((await chatterText(page)) ?? "").includes("WARP CORE RECHARGED"),
        { timeoutMs: 5000, intervalMs: 250 });
      checks.check("a refuel from empty confirms itself in the chatter",
        saidRecharged.ok, `chatter="${await chatterText(page)}"`);

      // The DOM poll above proves the line actually reaches the HUD, but the
      // chatter is first read ~1.5s after the pickup (this `settle(page,
      // 1500)`), and any competing `typeLine` in that window (cometNear is a
      // live risk) permanently replaces the DOM text — polling recovers from
      // slowness, not from clobbering. `store.broadcast` is set once, at
      // pickup, and nothing overwrites it afterward, so reading it here is
      // clobber-proof and pins what the DOM poll cannot: the exact percentage
      // and the em dash, which nothing else in this suite asserts.
      const storeAfterPickup = await readStore(page);
      checks.check("store.broadcast pins the exact restored message, percentage and em dash included",
        storeAfterPickup.broadcast?.text === "WARP CORE RECHARGED // 25% — WARP ONLINE",
        `text="${storeAfterPickup.broadcast?.text}"`);
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

    // Crystals appear on the radar only when within range (spec §8; the final
    // review's Finding 1 was that the radar's old gate was horizontal-only, so
    // it drew crystals well outside the 160-unit RANGE). Rather than
    // re-deriving RadarMap's own math, sample the radar canvas directly: the
    // crystal fill is `#ffd24a` (255,210,74), distinct from every other radar
    // colour (rings/sweep/pitch-ladder are green, sun is #ff5500, the portal
    // is #ec4899, planets are #00ff87/#00f0ff/#bd00ff), so counting pixels
    // near that RGB is a direct, implementation-independent proxy for "a
    // crystal blip is drawn". Two assertions that must disagree — no
    // crystal-coloured pixels when out of range, some when in range — is what
    // makes this discriminating; a check that only ever looked at one state
    // would still pass with the range gate deleted.
    const crystalPixelCount = () => page.evaluate(() => {
      const cv = document.querySelector('[data-testid="radar-canvas"]');
      if (!cv) return null;
      const ctx = cv.getContext("2d");
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 40) continue; // ignore near-transparent antialiased fringe
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // Tolerance per channel: blips are drawn with globalAlpha and
        // antialiasing, so exact-triple matching is too strict.
        if (Math.abs(r - 255) <= 20 && Math.abs(g - 210) <= 20 && Math.abs(b - 74) <= 20) n++;
      }
      return n;
    });

    // Find a ship position where, by 3D wrap-aware distance, no active
    // crystal is within RANGE. Searched over the live crystal list (grid +
    // random candidates, keeping the one farthest from its nearest crystal)
    // rather than assumed, since the field is randomly placed every run.
    //
    // The search alone is not always enough: with 40 crystals spread through
    // the whole ±250 volume, some random arrangements genuinely leave no
    // point farther than RANGE from every crystal — measured live, a
    // 5331-candidate grid+random search came back empty on 1 of 6 runs. That
    // is a property of the random field, not a search-quality problem, so no
    // amount of extra sampling fixes it. Rather than accept that flakiness (or
    // punt with a skip), take the best candidate the search finds regardless,
    // then relocate — via the same live-reference debug bridge every other
    // crystal check in this file already mutates through — just the handful
    // of crystals still within RANGE of it, to their antipodal point on the
    // 3-torus (COSMIC_BOUNDS away on every axis by construction, so ~433
    // units, comfortably clear of RANGE=160). In the common case that list is
    // empty and nothing is touched; this only kicks in for the rare dense
    // field. It still exercises RadarMap's real gate/draw against the real
    // crystalSlots array — it just guarantees the input configuration is one
    // where the property under test can actually hold.
    //
    // ---- KEEP THIS BLOCK LAST IN THE PROBE ----
    // It mutates live crystal positions to build its test geometry. A
    // relocated crystal has a ~2% chance of landing inside an asteroid band,
    // which would break the "no crystal spawned inside the belt or halo" check
    // above if that check ever ran after this point. The probe is correct today
    // purely by ordering; nothing enforces it but this comment.
    // The slot the refuel emptied respawns on a 4-sim-second boundary (~16 s of
    // wall-clock headless), landing uniformly at random: if that happens after
    // the far-position search below it can land in radar range. Wait for the
    // field to be full so the search sees every crystal that will exist.
    const fieldFull = await pollUntil(async () => (await activeCrystals()) === 40,
      { timeoutMs: 60_000, intervalMs: 500 });
    checks.check("crystal field refilled to 40 before the far-position search",
      fieldFull.ok, `active=${await activeCrystals()}`);

    const farSetup = await page.evaluate(async () => {
      const { COSMIC_BOUNDS } = await import("/src/constants.ts");
      const RANGE = 160;
      const wrapDelta = (from, to, bounds) => {
        const span = bounds * 2;
        let d = to - from;
        if (d > bounds) d -= span;
        else if (d < -bounds) d += span;
        return d;
      };
      const wrapCoord = (v, bounds) => (((v + bounds) % (2 * bounds) + 2 * bounds) % (2 * bounds)) - bounds;
      const crystals = (window.__fitz.crystals ?? []).filter((c) => c.active);
      const candidates = [];
      // Coarse grid over the full volume...
      const STEPS = 11;
      for (let ix = 0; ix < STEPS; ix++) {
        for (let iy = 0; iy < STEPS; iy++) {
          for (let iz = 0; iz < STEPS; iz++) {
            candidates.push([
              -COSMIC_BOUNDS + (2 * COSMIC_BOUNDS * ix) / (STEPS - 1),
              -COSMIC_BOUNDS + (2 * COSMIC_BOUNDS * iy) / (STEPS - 1),
              -COSMIC_BOUNDS + (2 * COSMIC_BOUNDS * iz) / (STEPS - 1),
            ]);
          }
        }
      }
      // ...plus random samples to cover what the grid's resolution might miss.
      for (let i = 0; i < 4000; i++) {
        candidates.push([
          Math.random() * 2 * COSMIC_BOUNDS - COSMIC_BOUNDS,
          Math.random() * 2 * COSMIC_BOUNDS - COSMIC_BOUNDS,
          Math.random() * 2 * COSMIC_BOUNDS - COSMIC_BOUNDS,
        ]);
      }
      let best = null, bestMinDist = -1;
      for (const [x, y, z] of candidates) {
        let minDist = Infinity;
        for (const cr of crystals) {
          const dx = wrapDelta(x, cr.x, COSMIC_BOUNDS);
          const dy = wrapDelta(y, cr.y, COSMIC_BOUNDS);
          const dz = wrapDelta(z, cr.z, COSMIC_BOUNDS);
          const d = Math.hypot(dx, dy, dz);
          if (d < minDist) minDist = d;
        }
        if (minDist > bestMinDist) { bestMinDist = minDist; best = { x, y, z }; }
      }
      const naturallyClear = bestMinDist > RANGE;
      let relocated = 0;
      if (!naturallyClear) {
        for (const cr of crystals) {
          const dx = wrapDelta(best.x, cr.x, COSMIC_BOUNDS);
          const dy = wrapDelta(best.y, cr.y, COSMIC_BOUNDS);
          const dz = wrapDelta(best.z, cr.z, COSMIC_BOUNDS);
          if (Math.hypot(dx, dy, dz) <= RANGE) {
            cr.x = wrapCoord(best.x + COSMIC_BOUNDS, COSMIC_BOUNDS);
            cr.y = wrapCoord(best.y + COSMIC_BOUNDS, COSMIC_BOUNDS);
            cr.z = wrapCoord(best.z + COSMIC_BOUNDS, COSMIC_BOUNDS);
            relocated++;
          }
        }
      }
      return { ...best, minDist: bestMinDist, naturallyClear, relocated };
    });
    checks.check("found (or built) a ship position with no crystal in radar range",
      farSetup.relocated === 0 ? farSetup.naturallyClear : true,
      farSetup.naturallyClear
        ? `minDist=${farSetup.minDist.toFixed(1)} (natural gap, no relocation needed)`
        : `minDist=${farSetup.minDist.toFixed(1)} — relocated ${farSetup.relocated} straggler crystal(s) to clear it`);

    await teleportTo(farSetup.x, farSetup.y, farSetup.z, "far position");
    const outOfRangePixels = await crystalPixelCount();
    checks.check("radar shows no crystal-coloured pixels when none are in range",
      outOfRangePixels === 0, `pixels=${outOfRangePixels}`);

    // Now the positive side: teleport near (but outside the 3-unit pickup
    // radius, so the crystal stays active and keeps being drawn) a known
    // active crystal.
    const nearCrystal = await pickCrystal(20);
    checks.check("found an active crystal for the in-range radar check",
      nearCrystal !== null, JSON.stringify(nearCrystal));

    if (nearCrystal) {
      await teleportTo(nearCrystal.x, nearCrystal.y, nearCrystal.z, "near crystal");
      const inRangePixels = await crystalPixelCount();
      checks.check("radar shows crystal-coloured pixels when one is in range",
        inRangePixels > 0, `pixels=${inRangePixels}`);
    }
  });
}
