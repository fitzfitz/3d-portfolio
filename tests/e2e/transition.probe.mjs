import { withPage, settle, toDeepSpace } from "./harness.mjs";

/** Canvas renders since page load. Deltas across an action are what matter. */
const canvasRenders = (page) => page.evaluate(() => window.__fitz.canvasRenderCount);

/**
 * Teleports into a planet's gravity well but short of the orbit lock.
 *
 * Geometry (src/constants.ts): PLANET_SIZE 4.8, ZONE_FACTOR 1.8 and
 * LOCK_ENGAGE_FACTOR 1.3, so activeZone sets inside 8.64 units and the lock
 * engages inside 6.24. An offset of (5, 0, 5) is 7.07 units out — inside the
 * well, outside the lock, and outside the planet's own 4.8 surface. A measured
 * baseline run using (12, 0, 12) sat at 16.97 units and never entered the well
 * at all, so activeZone stayed null and the check silently proved nothing.
 */
async function approachPlanet(page) {
  return page.evaluate(() => {
    const b = window.__fitz.bodies;
    const name = Object.keys(b)[0];
    const p = b[name];
    window.__fitz.teleport(p.x + 5, p.y, p.z + 5);
    return name;
  });
}

export default async function run() {
  return withPage({ label: "transition" }, async (page, checks) => {
    await toDeepSpace(page);
    await settle(page, 1000);

    // ---- approach: activeZone flips, canvas must not re-render ----
    const beforeApproach = await canvasRenders(page);
    const planet = await approachPlanet(page);
    await settle(page, 1500);
    const afterApproach = await canvasRenders(page);
    const zone = await page.evaluate(() => window.__fitz.store.getState().activeZone);

    checks.check("approach actually entered a gravity well", zone !== null,
      `planet=${planet} activeZone=${zone}`);
    checks.check("zero canvas re-renders when activeZone flips",
      afterApproach - beforeApproach === 0, `delta=${afterApproach - beforeApproach}`);

    // ---- orbit lock: modal opens, canvas freezes (Task 6) ----
    // Before Task 6, GlobalCanvas didn't subscribe to isOrbitLocked at all, so
    // this transition was free the same way activeZone is above. Task 6
    // deliberately adds a fourth subscription (selectSceneFrozen) so the
    // canvas CAN react to the lock — that IS the feature: it flips
    // `frameloop` to stop rendering behind the dossier. So the invariant
    // changes here, specifically for this transition: opening the modal
    // SHOULD re-render the canvas (to apply the freeze) — exactly once
    // React's own commit is concerned (dev-mode StrictMode double-invoke
    // aside), not once per frame while the modal sits open.
    //
    // Engage a REAL lock (teleport into range, same technique
    // gameplay.probe.mjs uses) rather than calling setOrbitLocked(true)
    // directly: SpacePlanets' own useFrame calls setOrbitLocked(lockActive)
    // unconditionally every frame based on actual proximity
    // (SpacePlanets.tsx ~385), so a manual override made while the ship is
    // far from any planet gets stomped back to false on the very next frame
    // — and whether this harness's evaluate() round-trip is observed before
    // or after that stomp is a pure timing race (measured flaking between
    // "delta=0" and "delta=4" run to run). A real, in-range lock is held by
    // SpacePlanets' own hysteresis (LOCK_RETAIN_FACTOR) instead of fighting
    // it, the same way the actual dossier modal opens during real flight.
    //
    // Break any lock first, before moving: the approach above (7.07 units
    // out) sits only 0.83 units outside LOCK_ENGAGE_FACTOR's 6.24 radius, and
    // the planet keeps orbiting the whole time this probe runs — its own
    // motion can close that gap on its own and engage a REAL lock while this
    // section is still forming its plan. Once that happens the canvas is
    // already frozen, and — same failure mode as gameplay.probe.mjs's scan
    // step — a frozen canvas can't run the frame that would copy
    // toDeepSpace()'s teleport into `flight`, so the "escape" silently never
    // happens and everything downstream reads stale. breakOrbit() is a plain
    // store write, unaffected by frameloop, so it reliably clears this
    // regardless of whether the canvas is currently frozen.
    await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
    await settle(page, 300);
    await toDeepSpace(page);
    const lockPlanet = await page.evaluate(async () => {
      const { planets } = await import("/src/constants.ts");
      const p = planets[0];
      const b = window.__fitz.bodies[p.name];
      return { name: p.name, size: p.size, x: b.x, y: b.y, z: b.z };
    });
    const beforeLock = await canvasRenders(page);
    await page.evaluate((p) => window.__fitz.teleport(p.x, p.y, p.z + p.size * 1.2), lockPlanet);
    await settle(page, 2500);
    const afterEngage = await canvasRenders(page);
    const lockedNow = await page.evaluate(() => window.__fitz.store.getState().isOrbitLocked);
    await settle(page, 1200);
    const afterSettle = await canvasRenders(page);

    checks.check("approaching close enough engages a real orbit lock", lockedNow,
      `locked=${lockedNow}`);
    checks.check("the dossier modal opening re-renders the canvas (to apply the freeze)",
      afterEngage - beforeLock > 0, `delta=${afterEngage - beforeLock}`);
    checks.check("the canvas does not keep re-rendering while the modal stays open",
      afterSettle - afterEngage === 0, `delta=${afterSettle - afterEngage}`);

    // ---- regression: classic-CV round trip while orbit-locked must not
    // leave the canvas painting zero frames forever ----
    // showClassicCV is the only thing that unmounts GlobalCanvas (App.tsx:79),
    // and until setShowClassicCV started calling breakOrbit(), isOrbitLocked
    // survived that unmount untouched: a visitor who opened this exact
    // dossier, then clicked into the classic resume and back, got a
    // freshly-mounted Canvas whose very first render already had
    // sceneFrozen=true -- frameloop="never" from frame one, with no
    // frozen->unfrozen edge for the invalidate() effect (GlobalCanvas.tsx) to
    // ever fire on. R3F provides no initial paint for frameloop="never" (both
    // invalidate() and the internal invalidateInstance no-op while frozen),
    // so that's a genuinely blank canvas, not a stale frame, until the
    // visitor closes the dossier by hand.
    //
    // gl.info.render.frame (a fresh WebGLRenderer's own draw-call counter,
    // re-published by DebugBridge on every GlobalCanvas mount) is the only
    // reliable signal here -- a screenshot can't distinguish "the 3D scene is
    // frozen" from "everything is fine," because the HUD, radar, chatter
    // ticker and perf overlay all animate on their own independent rAF loops
    // regardless of whether the WebGL canvas itself is painting.
    const stillLocked = (await page.evaluate(() => window.__fitz.store.getState().isOrbitLocked));
    checks.check("orbit lock is still held going into the round trip (precondition)", stillLocked,
      `locked=${stillLocked}`);
    // Baseline from the OLD (about-to-be-unmounted) renderer, used below only
    // to detect when window.__fitz.gl has actually swapped to the new one.
    const frameBeforeRoundTrip = await page.evaluate(() => window.__fitz.gl.info.render.frame);

    await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(true));
    await settle(page, 500);
    checks.check("opening classic CV while locked clears the lock",
      (await page.evaluate(() => window.__fitz.store.getState().isOrbitLocked)) === false);

    await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(false));

    // window.__fitz.gl briefly still points at the OLD, already-unmounted
    // renderer right after the round trip — DebugBridge hasn't re-published
    // it yet — and that stale object's frame count is frozen at whatever it
    // last reached. Comparing two samples of that frozen, stale number would
    // either falsely pass (both reads identical) or falsely fail (a
    // coincidental discrepancy), neither of which says anything about
    // whether the NEW canvas is actually painting. A fresh WebGLRenderer's
    // own counter starts back near 0, so poll until a reading drops below
    // the pre-round-trip baseline — that's the reliable signal that
    // window.__fitz.gl has landed on the new instance.
    let frame1 = null;
    for (let i = 0; i < 15 && frame1 === null; i++) {
      await settle(page, 200);
      const f = await page.evaluate(() => window.__fitz.gl?.info.render.frame ?? null);
      if (f !== null && f < frameBeforeRoundTrip) frame1 = f;
    }
    checks.check("a fresh renderer comes online after the round trip (precondition)",
      frame1 !== null, `frame1=${frame1}`);

    if (frame1 !== null) {
      await settle(page, 1000);
      const frame2 = await page.evaluate(() => window.__fitz.gl.info.render.frame);
      checks.check("canvas resumes rendering after a classic-CV round trip while orbit-locked",
        frame2 > frame1, `frame ${frame1} -> ${frame2}`);
    }

    await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
    await settle(page, 800);

    // ---- warp: isWarping flips on every boost ----
    await toDeepSpace(page);
    const beforeWarp = await canvasRenders(page);
    await page.evaluate(() => window.__fitz.store.getState().setWarping(true));
    await settle(page, 800);
    await page.evaluate(() => window.__fitz.store.getState().setWarping(false));
    await settle(page, 800);
    const afterWarp = await canvasRenders(page);

    checks.check("zero canvas re-renders across a warp toggle",
      afterWarp - beforeWarp === 0, `delta=${afterWarp - beforeWarp}`);

    // ---- plasma: spawning must not add lights or recompile shaders ----
    await toDeepSpace(page);
    await settle(page, 1000);

    const beforePlasma = await page.evaluate(() => {
      let lights = 0;
      window.__fitz.scene.traverse((o) => { if (o.isLight) lights++; });
      return { lights, programs: window.__fitz.gl.info.programs.length,
        renders: window.__fitz.canvasRenderCount };
    });

    // 10, measured — see LIGHT_BUDGET in src/constants.ts.
    checks.check("baseline light count is within LIGHT_BUDGET",
      beforePlasma.lights <= 10, `lights=${beforePlasma.lights}`);

    // Spawn 40 anomalies through the same ref path a click uses.
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      for (let i = 0; i < 40; i++) {
        const x = r.left + r.width * (0.3 + 0.4 * (i % 7) / 7);
        const y = r.top + r.height * (0.3 + 0.4 * (i % 5) / 5);
        canvas.dispatchEvent(new PointerEvent("pointerdown",
          { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
      }
    });
    await settle(page, 2000);

    const afterPlasma = await page.evaluate(() => {
      let lights = 0;
      window.__fitz.scene.traverse((o) => { if (o.isLight) lights++; });
      return { lights, programs: window.__fitz.gl.info.programs.length,
        renders: window.__fitz.canvasRenderCount };
    });

    checks.check("40 plasma spawns add zero lights",
      afterPlasma.lights === beforePlasma.lights,
      `${beforePlasma.lights} -> ${afterPlasma.lights}`);
    checks.check("40 plasma spawns compile zero new shader programs",
      afterPlasma.programs === beforePlasma.programs,
      `${beforePlasma.programs} -> ${afterPlasma.programs}`);
    checks.check("40 plasma spawns cause zero canvas re-renders",
      afterPlasma.renders === beforePlasma.renders,
      `delta=${afterPlasma.renders - beforePlasma.renders}`);
  });
}
