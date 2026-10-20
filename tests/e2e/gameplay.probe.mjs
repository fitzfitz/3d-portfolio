import { withPage, hold, settle, readStore, chatterText, pollUntil, toDeepSpace, SCENE_READY_TIMEOUT_MS, PLANET_STANDOFF } from "./harness.mjs";

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
    // SHARDS[0] sits beside the spawn pad (src/data/shards.ts); park one unit away and let proximity fire.
    await page.evaluate(() => localStorage.removeItem("fitz-shards"));
    await page.reload({ waitUntil: "domcontentloaded" });
    // See harness.mjs's SCENE_READY_TIMEOUT_MS: this reload pays the same
    // full eager Preload compile as the initial navigation does.
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: SCENE_READY_TIMEOUT_MS });
    await settle(page, 3500);

    const [sx, sy, sz] = await page.evaluate(async () => (await import("/src/data/shards.ts")).SHARDS[0].pos);
    await warpTo(page, sx, sy, sz + 1);
    await settle(page, 1500);

    // Prove the precondition (actually within DataShards.tsx's dist<3 pickup
    // radius) before trusting the pickup outcome below.
    const distToShard = await page.evaluate(([sx, sy, sz]) => {
      const f = window.__fitz.flight;
      return Math.hypot(f.x - sx, f.y - sy, f.z - sz);
    }, [sx, sy, sz]);
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
    // See harness.mjs's SCENE_READY_TIMEOUT_MS: same eager-compile cost.
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: SCENE_READY_TIMEOUT_MS });
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
    // DataShards.tsx sends the 10th shard's own fact first, then the
    // completion line COMPLETE_DELAY_MS (4.5s) later — sent together, the
    // single typewriter line cancelled the fact before it could be read.
    // So wait out the delay before reading.
    await settle(page, 5500);
    s = await readStore(page);
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
      // noseDirection(yaw=0, pitch=0) = (0, 0, 1) — see src/utils/pitchFlight.ts.
      // The ship spawns aimed at a planet, so pin yaw/pitch to 0 explicitly;
      // holding forward then moves the ship toward +Z. Approach from the -Z
      // side so "forward" actually closes the gap, instead of flying away.
      await warpTo(page, target.x, target.y, target.z - target.r - 2);
      await page.evaluate(() => window.__fitz.setAttitude(0, 0));
      // Hold W until the first impact lands, not for a fixed time: under load
      // headless SwiftShader renders so few frames that a fixed 2.5s hold
      // sometimes stopped short of the rock. Each poll also nudges a frame.
      await page.keyboard.down("KeyW");
      const hit = await pollUntil(
        () => page.evaluate((b) => window.__fitz.store.getState().impactCount > b, before),
        { timeoutMs: 15_000, intervalMs: 100 },
      );
      await page.keyboard.up("KeyW");
      const midResult = await page.evaluate(() => (
        { impactCount: window.__fitz.store.getState().impactCount, t: performance.now() }
      ));
      const mid = midResult.impactCount;
      checks.check("ramming an asteroid registers an impact", hit.ok && mid > before,
        `${before} -> ${mid}${hit.error ? ` (${hit.error.message})` : ""}`);

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

    // ---- a slow approach to a planet doesn't stick, and stops at the surface ----
    // Planets no longer dock (the dossiers moved onto probes): they are solid
    // and scan-only. Nose straight at the planet from 1.6 sizes out, hold W
    // at cruise, and follow the gap every poll (the planet orbits, so the aim
    // is refreshed each time). The surface the ship meets is the planet's
    // size plus the ship's half length (src/utils/worldCollide.ts); the ship
    // must stop there, never get inside it, and never lock or open anything.
    const orbit = await page.evaluate(async () => {
      const { bodyById } = await import("/src/data/solarSystem.ts");
      const { SHIP_HALF_LENGTH } = await import("/src/utils/worldCollide.ts");
      const p = bodyById("earth");
      const b = window.__fitz.bodies[p.id]; // live position — bodies orbit continuously
      return { name: p.id, size: p.size, reach: p.size + SHIP_HALF_LENGTH, bx: b.x, by: b.y, bz: b.z };
    });
    await warpTo(page, orbit.bx, orbit.by, orbit.bz + orbit.size * 1.6);
    await settle(page, 300);
    const gapNow = () => page.evaluate((n) => {
      const d = window.__fitz, f = d.flight, b = d.bodies[n];
      // Keep the nose on the planet's live centre (yaw and pitch).
      const dx = b.x - f.x, dy = b.y - f.y, dz = b.z - f.z;
      d.setAttitude(Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz)));
      const st = d.store.getState();
      return { gap: Math.hypot(dx, dy, dz), locked: st.isOrbitLocked, zone: st.activeZone, dossier: st.openDossier, impacts: st.impactCount };
    }, orbit.name);
    const impactsBefore = (await readStore(page)).impactCount;
    let minGap = Infinity, stuck = false, touched = false;
    await page.keyboard.down("KeyW");
    try {
      for (let i = 0; i < 40; i++) {
        const r = await gapNow();
        minGap = Math.min(minGap, r.gap);
        stuck = stuck || r.locked || r.zone !== null || r.dossier !== null;
        touched = touched || r.impacts > impactsBefore || r.gap < orbit.reach + 0.5;
        await settle(page, 100);
      }
    } finally {
      await page.keyboard.up("KeyW");
    }
    s = await readStore(page);
    checks.check("a slow approach reaches the planet's surface (precondition)", touched,
      `min gap ${minGap.toFixed(2)}, surface at ${orbit.reach.toFixed(2)}`);
    checks.check("the ship stops at the surface: it never gets inside the planet", minGap >= orbit.reach - 0.05,
      `min gap ${minGap.toFixed(2)}, surface at ${orbit.reach.toFixed(2)}`);
    checks.check("a slow approach to a planet doesn't stick (no lock, no zone, no dossier)", !stuck && !s.isOrbitLocked,
      `locked=${s.isOrbitLocked} zone=${s.activeZone} openDossier=${s.openDossier}`);

    // ---- scan loop ----
    // 2.5x size (PLANET_STANDOFF): clear of the solid surface, inside scan range
    // of it (SCAN_RANGE 22 + size = 3.2x at size 12). Planets are scan-only now:
    // scanning is the one thing a planet still answers to.
    await warpTo(page, orbit.bx, orbit.by, orbit.bz + orbit.size * PLANET_STANDOFF);
    await settle(page, 1200);
    s = await readStore(page);
    checks.check("a scannable target is acquired in range", s.scanTarget !== null,
      `scanTarget=${s.scanTarget}`);
    const beforeScan = (await readStore(page)).broadcast?.id ?? 0;
    await hold(page, ["KeyE"], 2600); // scan takes 1.6s
    const afterScan = (await readStore(page)).broadcast;
    checks.check("holding E emits a scan report", (afterScan?.id ?? 0) > beforeScan,
      `broadcast=${afterScan?.text?.slice(0, 60)}`);

    // ---- chatter fires when a probe comes in range ----
    // A project's zone lines now play when its probe comes in range (store
    // `probeNear`, written each frame by ProjectProbes from the real
    // positions, so it is driven by teleporting rather than set by hand).
    // RadioChatter types zone lines straight into the HUD line and never
    // calls `sendBroadcast`, so read the typed line, and require it to be
    // one of this probe's lines (src/data/chatterLines.ts) so an unrelated
    // ambient/impact line typed around the same time can't satisfy the check.
    const zoneProbe = "ruangrapi";
    const zoneLines = await page.evaluate(async (name) => {
      const mod = await import("/src/data/chatterLines.ts");
      return mod.chatterPools.zones[name] ?? [];
    }, zoneProbe);

    // The scan report above is a content broadcast: it holds the radio line for
    // 8 s (src/utils/radioHold.ts) and zone chatter is skipped meanwhile, so
    // let the hold lapse (out of every probe's range) before the probe comes in.
    await toDeepSpace(page);
    await settle(page, 7000);
    const outOfRange = (await readStore(page)).probeNear;
    checks.check("no probe is in range before the approach (precondition)", outOfRange === null, `probeNear=${outOfRange}`);
    const beforeChatter = ((await chatterText(page)) ?? "").replace(/^>\s?/, "");
    // 30 u above probe 1: inside PROBE_IN_RANGE (45 u).
    await page.evaluate((id) => { const p = window.__fitz.probes[id]; window.__fitz.teleport(p.x, p.y + 30, p.z); }, zoneProbe);
    await settle(page, 2500); // enough time for the 22ms/char typewriter to render a zone line
    const nearNow = (await readStore(page)).probeNear;
    const afterChatter = ((await chatterText(page)) ?? "").replace(/^>\s?/, "");
    const matchesZoneLine = zoneLines.some((line) => line.startsWith(afterChatter) || afterChatter.startsWith(line));
    checks.check("a probe coming in range interrupts chatter with a new line from its project's pool",
      nearNow === zoneProbe && afterChatter.length > 0 && afterChatter !== beforeChatter && matchesZoneLine,
      `probeNear=${nearNow} before="${beforeChatter.slice(0, 40)}" after="${afterChatter.slice(0, 60)}"`);

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
