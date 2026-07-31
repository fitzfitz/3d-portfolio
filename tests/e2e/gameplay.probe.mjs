import { withPage, hold, settle, readStore, chatterText } from "./harness.mjs";

/**
 * Teleports the ship next to a world point and zeroes its velocity.
 * MUST go through `__fitz.teleport` (Task 6b): `flight.{x,y,z}` is written FROM
 * Spaceship's `pos` ref every frame, so assigning to it is a silent no-op.
 */
const warpTo = (page, x, y, z) => page.evaluate((p) => {
  if (typeof window.__fitz.teleport !== "function") {
    throw new Error("__fitz.teleport unavailable — Spaceship did not register it");
  }
  window.__fitz.teleport(p.x, p.y, p.z);
}, { x, y, z });

export default async function run() {
  return withPage({ label: "gameplay" }, async (page, checks) => {
    // ---- shard pickup ----
    // SHARDS[0] sits at [8, 1, 22]; park one unit away and let proximity fire.
    await page.evaluate(() => localStorage.removeItem("fitz-shards"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    await settle(page, 3500);

    await warpTo(page, 8, 1, 23);
    await settle(page, 1500);

    // Prove the precondition (actually within DataShards.tsx's dist<3 pickup
    // radius) before trusting the pickup outcome below.
    const distToShard = await page.evaluate(() => {
      const f = window.__fitz.flight;
      return Math.hypot(f.x - 8, f.y - 1, f.z - 22);
    });
    checks.check("ship is within the shard pickup radius (precondition)", distToShard < 3,
      `dist=${distToShard.toFixed(2)}`);

    let s = await readStore(page);
    checks.check("flying into a shard collects it", s.shardsCollected.length === 1,
      `collected=${JSON.stringify(s.shardsCollected)}`);

    const hud = await page.evaluate(() =>
      [...document.querySelectorAll("div")].map((d) => d.textContent)
        .find((t) => t && /^SHARDS: \d+\/\d+$/.test(t.trim())) ?? null);
    checks.check("HUD shard counter reflects the pickup", hud?.includes("1/10") ?? false, `hud=${hud}`);

    // ---- collect-all fanfare ----
    // Pre-seed 9 shards, then collect the 10th so the completion branch fires
    // (DataShards.tsx:71 checks shardsCollected.length === SHARDS.length).
    await page.evaluate(() => {
      localStorage.setItem("fitz-shards", JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    await settle(page, 3500);

    const last = await page.evaluate(async () => {
      const mod = await import("/src/data/shards.ts");
      return mod.SHARDS[9].pos;
    });

    const beforeFanfareId = (await readStore(page)).broadcast?.id ?? 0;
    await warpTo(page, last[0], last[1] + 1, last[2]);
    await settle(page, 2000);
    s = await readStore(page);
    checks.check("collecting the 10th shard completes the set",
      s.shardsCollected.length === 10, `count=${s.shardsCollected.length}`);
    // DataShards.tsx:68-76 fires TWO sendBroadcast calls back-to-back on the
    // 10th pickup: the shard's own fact line, then the completion line.
    // Asserting merely `!!s.broadcast` would also pass for an unrelated
    // chatter broadcast — require a NEW id whose text is the actual
    // completion line ("ALL SHARDS RECOVERED...", DataShards.tsx:74).
    checks.check("collect-all broadcasts the completion fanfare",
      (s.broadcast?.id ?? 0) > beforeFanfareId && /ALL SHARDS RECOVERED/.test(s.broadcast?.text ?? ""),
      `broadcast=${JSON.stringify(s.broadcast)?.slice(0, 100)}`);

    await page.evaluate(() => localStorage.removeItem("fitz-shards"));

    // ---- asteroid ram + cooldown ----
    // Real exports are `asteroidInstances`/`ASTEROID_COLLIDERS`/`SUN_COLLIDER`
    // (src/data/asteroids.ts) — NOT `ASTEROIDS`. ASTEROID_COLLIDERS already has
    // the {x,y,z,r} shape Spaceship's own COLLIDERS array uses.
    //
    // Null-guard restored: the original brief guarded against ASTEROID_COLLIDERS[0]
    // being missing or malformed. Read the table defensively here so a future
    // shape regression reports a clean failed check instead of throwing an
    // unhandled exception inside page.evaluate (which would read as a crashed
    // probe rather than a specific, diagnosable failure).
    const target = await page.evaluate(async () => {
      const mod = await import("/src/data/asteroids.ts");
      const a = mod.ASTEROID_COLLIDERS?.[0];
      if (!a || typeof a.x !== "number" || typeof a.y !== "number" ||
          typeof a.z !== "number" || typeof a.r !== "number") return null;
      return { x: a.x, y: a.y, z: a.z, r: a.r };
    });
    checks.check("asteroid table is readable", target !== null,
      target ? JSON.stringify(target) : "ASTEROID_COLLIDERS[0] missing or malformed");

    if (target) {
      const before = (await readStore(page)).impactCount;
      // noseDirection(yaw=0, pitch=0) = (0, 0, 1) — see src/utils/pitchFlight.ts
      // and flight.probe.mjs's own comment ("holding forward drives flight.z
      // toward +BOUNDS"). The ship's angle/pitch refs are still at their mount
      // defaults here (no steering input has happened all probe), so holding
      // forward moves the ship toward +Z. Approach from the -Z side so "forward"
      // actually closes the gap, instead of flying away from the target.
      await warpTo(page, target.x, target.y, target.z - target.r - 2);
      await hold(page, ["KeyW"], 2500);
      const midResult = await page.evaluate(() => (
        { impactCount: window.__fitz.store.getState().impactCount, t: performance.now() }
      ));
      const mid = midResult.impactCount;
      checks.check("ramming an asteroid registers an impact", mid > before, `${before} -> ${mid}`);

      // A fixed Node-side sleep is NOT a reliable stand-in for real elapsed page
      // time here: headless SwiftShader is slow enough (see harness.mjs) that
      // measured diagnostics showed a requested 400ms hold taking 700-1350ms of
      // actual browser wall time, plus 400-900ms more just in the idle gap
      // before it (readStore/evaluate round-trips). Bracket the window with
      // performance.now() on the page side and check the observed impact count
      // against the bound the 0.5s cooldown actually implies for that window,
      // instead of asserting against the wrong (Node-side) clock.
      await hold(page, ["KeyW"], 400); // grind inside the intended cooldown window
      const afterResult = await page.evaluate(() => (
        { impactCount: window.__fitz.store.getState().impactCount, t: performance.now() }
      ));
      const after = afterResult.impactCount;
      const windowMs = afterResult.t - midResult.t;
      const maxAllowed = Math.floor(windowMs / 500) + 1;
      checks.check("impacts are rate-limited to one per 0.5s",
        after - mid <= maxAllowed,
        `+${after - mid} impacts over ${windowMs.toFixed(0)}ms real elapsed time (0.5s cooldown allows <=${maxAllowed})`);
    }

    // ---- orbit entry traces a ring around a MOVING body ----
    const orbit = await page.evaluate(async () => {
      const { planets } = await import("/src/constants.ts");
      const p = planets[0];
      const b = window.__fitz.bodies[p.name]; // live position — planets orbit continuously
      return { name: p.name, size: p.size, bx: b.x, by: b.y, bz: b.z };
    });
    await warpTo(page, orbit.bx, orbit.by, orbit.bz + orbit.size * 1.2);
    await settle(page, 2500);
    s = await readStore(page);
    checks.check("approaching a planet engages orbit lock", s.isOrbitLocked,
      `locked=${s.isOrbitLocked} zone=${s.activeZone}`);

    if (s.isOrbitLocked) {
      const samples = await page.evaluate(async (name) => {
        const out = [];
        for (let i = 0; i < 12; i++) {
          const f = window.__fitz.flight, b = window.__fitz.bodies[name];
          out.push(Math.hypot(f.x - b.x, f.y - b.y, f.z - b.z));
          await new Promise((r) => setTimeout(r, 250));
        }
        return out;
      }, orbit.name);
      const min = Math.min(...samples), max = Math.max(...samples);
      checks.check("locked ship holds a ring radius around the moving planet",
        max - min < orbit.size * 0.9,
        `radius ${min.toFixed(2)}..${max.toFixed(2)} over 3s`);
      await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
      await settle(page, 2000);
    }

    // ---- scan loop ----
    await warpTo(page, orbit.bx, orbit.by, orbit.bz + 18);
    await settle(page, 1200);
    s = await readStore(page);
    checks.check("a scannable target is acquired in range", s.scanTarget !== null,
      `scanTarget=${s.scanTarget}`);
    const beforeScan = (await readStore(page)).broadcast?.id ?? 0;
    await hold(page, ["KeyE"], 2600); // scan takes 1.6s
    const afterScan = (await readStore(page)).broadcast;
    checks.check("holding E emits a scan report", (afterScan?.id ?? 0) > beforeScan,
      `broadcast=${afterScan?.text?.slice(0, 60)}`);

    // ---- chatter fires on zone change ----
    // NOTE: the brief's original version of this check compared
    // `store.broadcast` before/after — but RadioChatter's zone-entry
    // subscription (RadioChatter.tsx:47-51) calls `typeLine` directly and
    // never calls `sendBroadcast`, so that comparison would always read
    // "unchanged" regardless of whether chatter actually fired. Read the
    // typed HUD line instead, and require it to actually be one of this
    // zone's lines (src/data/chatterLines.ts) so an unrelated ambient/impact
    // line typed around the same time can't accidentally satisfy the check.
    const zoneLines = await page.evaluate(async (name) => {
      const mod = await import("/src/data/chatterLines.ts");
      return mod.chatterPools.zones[name] ?? [];
    }, orbit.name);

    await page.evaluate(() => window.__fitz.store.getState().setActiveZone(null));
    await settle(page, 300);
    const beforeChatter = ((await chatterText(page)) ?? "").replace(/^>\s?/, "");
    await page.evaluate((n) => window.__fitz.store.getState().setActiveZone(n), orbit.name);
    await settle(page, 2500); // enough time for the 22ms/char typewriter to render a zone line
    const afterChatter = ((await chatterText(page)) ?? "").replace(/^>\s?/, "");
    const matchesZoneLine = zoneLines.some((line) => line.startsWith(afterChatter) || afterChatter.startsWith(line));
    checks.check("entering a zone interrupts chatter with a new zone-specific line",
      afterChatter.length > 0 && afterChatter !== beforeChatter && matchesZoneLine,
      `zone=${orbit.name} before="${beforeChatter.slice(0, 40)}" after="${afterChatter.slice(0, 60)}"`);

    // ---- comet proximity announcement ----
    const cometSeen = await page.evaluate(async () => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (window.__fitz.store.getState().cometNear) return true;
        await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    });
    checks.note("comet proximity announcement",
      cometSeen ? "cometNear fired during a 20s watch" : "no comet passed within 20s — timing judged in QA checklist");
  });
}
