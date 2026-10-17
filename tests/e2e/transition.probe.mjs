import { withPage, settle, toDeepSpace } from "./harness.mjs";

// ---- renderer counter budgets (docs/PERF-BUDGETS.md) ----
// Measured on headless Chrome / SwiftShader (software rendering) -- see that
// file for the full baseline table, the five states these were captured in
// (deep space facing away from the sun, deep space facing it, close
// approach, modal open, 40 anomalies facing away; faceFromSun pins the
// heading, so whether the sun is in frame is set, not left to chance),
// and the derivation rule repeated here in short: calls/triangles are
// baseline + 15%, rounded up to the nearest ten; programs and lights are
// baseline + 1, since neither should grow at all during ordinary play -- the
// +1 is slack for a driver-dependent variant, not headroom for a new
// material. A ceiling going up without a matching, deliberate scene change
// is the regression this file exists to catch.
const DEEP_CALLS_CEILING = 40;
const DEEP_TRIS_CEILING = 250580;
const DEEP_PROGRAMS_CEILING = 79;

const APPROACH_CALLS_CEILING = 110;
const APPROACH_TRIS_CEILING = 420590;
const APPROACH_PROGRAMS_CEILING = 84;
const APPROACH_LIGHTS_CEILING = 5;

const MODAL_CALLS_CEILING = 130;
const MODAL_TRIS_CEILING = 420600;
const MODAL_PROGRAMS_CEILING = 84;
const MODAL_LIGHTS_CEILING = 5;

const ANOMALIES_CALLS_CEILING = 40;
const ANOMALIES_TRIS_CEILING = 250580;
const ANOMALIES_PROGRAMS_CEILING = 79;
const ANOMALIES_LIGHTS_CEILING = 5;

// Deep space again, nose on the sun: the disc, its corona and the six lens
// sprites in frame, counted on purpose (the deep-space and 40-anomalies states
// face away from it). Baseline 108 / 418490 / 54 / 4, identical on 11 runs.
// Programs is the page's cumulative count, read seconds after deep space on
// the same page, so it shares deep space's ceiling rather than a tighter one.
const FACING_SUN_CALLS_CEILING = 130;
const FACING_SUN_TRIS_CEILING = 481270;
const FACING_SUN_PROGRAMS_CEILING = DEEP_PROGRAMS_CEILING;
const FACING_SUN_LIGHTS_CEILING = 5;

/** Canvas renders since page load. Deltas across an action are what matter. */
const canvasRenders = (page) => page.evaluate(() => window.__fitz.canvasRenderCount);

/**
 * Reads the four counters docs/PERF-BUDGETS.md budgets against.
 * calls/triangles come from `perfStats` (sampled by PerfSampler's
 * `scene.onAfterRender` hook), NOT from a bare `gl.info.render.*` read here:
 * EffectComposer's own passes call `renderer.render()` again after the real
 * scene render, and every such call resets `gl.info` at its own start (three
 * autoReset), so an external page.evaluate reading `gl.info.render.*`
 * directly is permanently stuck at 1/1 regardless of scene state -- see
 * PerfSampler.tsx for the full account and the fix. `programs` stays on
 * `gl.info.programs.length` -- a cumulative array length, unaffected by any
 * per-frame reset. `lights` is a direct scene.traverse, NOT
 * `perfStats.lights`: that field is throttled to one traversal every 30
 * frames, which is ~30 seconds of lag at headless SwiftShader's ~1fps.
 */
const readPerfCounters = (page) => page.evaluate(() => {
  let lights = 0;
  window.__fitz.scene.traverse((o) => { if (o.isLight) lights++; });
  return {
    calls: window.__fitz.perfStats.calls,
    triangles: window.__fitz.perfStats.triangles,
    programs: window.__fitz.gl.info.programs.length,
    lights,
  };
});

/**
 * Turns the ship's nose straight away from the sun at the origin (`toward`
 * false) or straight at it (`toward` true), from wherever the ship is now, and
 * waits until the view has settled. Without this the deep-space counts took
 * whatever heading the ship had before the teleport, and about one run in 15
 * the sun sat inside the lens glare's cone, drawing six extra sprites.
 *
 * Convention (src/utils/pitchFlight.ts, noseDirection): yaw 0 / pitch 0 is +Z
 * and nose = (sin yaw * cos pitch, sin pitch, cos yaw * cos pitch), so a unit
 * direction n is yaw = atan2(n.x, n.z), pitch = asin(n.y). Away from the sun,
 * n is the ship's position normalised; toward it, the negation. From
 * toDeepSpace's (-170, -150, -170) that is yaw -135 deg / pitch -31.4 deg
 * away and yaw 45 deg / pitch +31.4 deg toward, both inside PITCH_MAX (83 deg).
 *
 * The chase camera (Spaceship.tsx, applyChaseCam) eases toward a point 4.6u
 * behind the nose and 1.8u up by frameLerp(0.05) a frame, 14% a frame at the
 * 0.05 s dt clamp, so after a turn of up to 180 deg it needs ~30 frames to swing
 * round (and the chase point itself moved ~300u with the teleport). The probe
 * puts the camera on that point directly, as sky.probe.mjs's parkFacingSun does;
 * the next frame's lookAt aims it. The wait then covers SunFlare's fade
 * (Sun.tsx): `vis` decays by 0.001^dt a frame, so from full strength it falls
 * under the 0.01 visibility cut in 14 frames at the dt clamp, or 0.67 s at
 * faster frame rates. At least 20 frames and 1 s covers both.
 */
async function faceFromSun(page, toward) {
  await page.evaluate((toward) => {
    const d = window.__fitz;
    const f = d.flight;
    const r = Math.hypot(f.x, f.y, f.z);
    const s = toward ? -1 : 1;
    const n = { x: (s * f.x) / r, y: (s * f.y) / r, z: (s * f.z) / r };
    d.setAttitude(Math.atan2(n.x, n.z), Math.asin(n.y));
    // applyChaseCam's resting chase point: camDistance 4.6 (speed 0), camHeight 1.8.
    d.camera.position.set(f.x - n.x * 4.6, f.y - n.y * 4.6 + 1.8, f.z - n.z * 4.6);
  }, toward);
  await page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    let n = 0;
    const step = () => {
      n++;
      if (n >= 20 && performance.now() - t0 >= 1000) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
}

/**
 * Where the sun is relative to the live camera, read on one frame: `behind`
 * from camera space (the camera looks down its own -Z), `ndc` from projecting
 * the origin, and `glare` the visibility of Sun.tsx's lens-sprite group, the
 * thing that adds the six draw calls.
 */
const sunInView = (page) => page.evaluate(() => {
  const cam = window.__fitz.camera;
  cam.updateMatrixWorld();
  const local = cam.worldToLocal(cam.position.clone().set(0, 0, 0));
  const ndc = cam.position.clone().set(0, 0, 0).project(cam);
  const glare = window.__fitz.scene.getObjectByName("SunGlare");
  return {
    behind: local.z > 0,
    onScreen: local.z < 0 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
    ndc: `(${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`,
    glare: glare ? glare.visible : null,
  };
});

/**
 * Teleports into a planet's gravity well but short of the orbit lock.
 *
 * Geometry (src/constants.ts): ZONE_FACTOR 1.8 and LOCK_ENGAGE_FACTOR 1.3 of
 * the planet's size, so activeZone sets inside 1.8x and the lock engages inside
 * 1.3x. The ship is placed 1.45x out along the planet's outward radial —
 * inside the well, outside the lock, outside the planet's own surface (see the
 * comment in the body for why radial). Size is read from the live module, so
 * the probe follows the planet table instead of pinning a size. A measured
 * baseline run using (12, 0, 12) sat at 16.97 units and never entered the well
 * at all, so activeZone stayed null and the check silently proved nothing.
 */
async function approachPlanet(page) {
  return page.evaluate(async () => {
    const { planets } = await import("/src/constants.ts");
    const b = window.__fitz.bodies;
    const name = Object.keys(b)[0];
    const p = b[name];
    // On the planet's outward radial (away from the sun at the origin), at
    // 1.45x the planet size: inside the 1.8x zone, outside the 1.3x lock.
    // Orbits are centred on the origin, so planet motion is perpendicular to
    // this line and the gap can only grow while the probe waits — it can
    // never close into a lock, and ~17u of drift (about ten seconds, even at
    // SwiftShader frame rates) passes before it leaves the zone. The old
    // fixed (+5, 0, +5) offset could be closed by orbital motion, locking the
    // dossier: a legitimate canvas re-render that failed the check below.
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    const d = planets.find((pl) => pl.name === name).size * 1.45;
    window.__fitz.teleport(p.x + (p.x / r) * d, p.y + (p.y / r) * d, p.z + (p.z / r) * d);
    return name;
  });
}

export default async function run() {
  return withPage({ label: "transition" }, async (page, checks) => {
    await toDeepSpace(page);
    await settle(page, 1000);
    await faceFromSun(page, false);

    // ---- renderer counter budgets: deep space (docs/PERF-BUDGETS.md) ----
    const lightBudget = await page.evaluate(async () => {
      const { LIGHT_BUDGET } = await import("/src/constants.ts");
      return LIGHT_BUDGET;
    });
    const deep = await readPerfCounters(page);
    const deepSun = await sunInView(page);
    checks.check("deep space faces away from the sun (precondition)",
      deepSun.behind && deepSun.glare === false,
      `behind=${deepSun.behind} glare=${deepSun.glare}`);
    checks.check("deep-space draw calls within budget", deep.calls <= DEEP_CALLS_CEILING,
      `calls=${deep.calls} ceiling=${DEEP_CALLS_CEILING}`);
    checks.check("deep-space triangles within budget", deep.triangles <= DEEP_TRIS_CEILING,
      `triangles=${deep.triangles} ceiling=${DEEP_TRIS_CEILING}`);
    checks.check("deep-space programs within budget", deep.programs <= DEEP_PROGRAMS_CEILING,
      `programs=${deep.programs} ceiling=${DEEP_PROGRAMS_CEILING}`);
    checks.check("deep-space light count within LIGHT_BUDGET", deep.lights <= lightBudget,
      `lights=${deep.lights} LIGHT_BUDGET=${lightBudget}`);

    // ---- renderer counter budgets: deep space facing the sun (docs/PERF-BUDGETS.md) ----
    // Same point, nose on the sun: the view the deep-space state used to land
    // in by chance. The precondition proves the sun and its glare are in frame.
    await faceFromSun(page, true);
    const facing = await readPerfCounters(page);
    const facingSun = await sunInView(page);
    checks.check("facing-sun state has the sun and its glare in view (precondition)",
      facingSun.onScreen && facingSun.glare === true,
      `ndc=${facingSun.ndc} onScreen=${facingSun.onScreen} glare=${facingSun.glare}`);
    checks.check("facing-sun draw calls within budget", facing.calls <= FACING_SUN_CALLS_CEILING,
      `calls=${facing.calls} ceiling=${FACING_SUN_CALLS_CEILING}`);
    checks.check("facing-sun triangles within budget", facing.triangles <= FACING_SUN_TRIS_CEILING,
      `triangles=${facing.triangles} ceiling=${FACING_SUN_TRIS_CEILING}`);
    checks.check("facing-sun programs within budget", facing.programs <= FACING_SUN_PROGRAMS_CEILING,
      `programs=${facing.programs} ceiling=${FACING_SUN_PROGRAMS_CEILING}`);
    checks.check("facing-sun light count within budget", facing.lights <= FACING_SUN_LIGHTS_CEILING,
      `lights=${facing.lights} ceiling=${FACING_SUN_LIGHTS_CEILING}`);

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

    // ---- renderer counter budgets: close approach (docs/PERF-BUDGETS.md) ----
    const approach = await readPerfCounters(page);
    checks.check("close-approach draw calls within budget", approach.calls <= APPROACH_CALLS_CEILING,
      `calls=${approach.calls} ceiling=${APPROACH_CALLS_CEILING}`);
    checks.check("close-approach triangles within budget", approach.triangles <= APPROACH_TRIS_CEILING,
      `triangles=${approach.triangles} ceiling=${APPROACH_TRIS_CEILING}`);
    checks.check("close-approach programs within budget", approach.programs <= APPROACH_PROGRAMS_CEILING,
      `programs=${approach.programs} ceiling=${APPROACH_PROGRAMS_CEILING}`);
    checks.check("close-approach light count within budget", approach.lights <= APPROACH_LIGHTS_CEILING,
      `lights=${approach.lights} ceiling=${APPROACH_LIGHTS_CEILING}`);

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

    // ---- renderer counter budgets: dossier modal open (docs/PERF-BUDGETS.md) ----
    // frameloop is "never" here (the freeze this section exists to test), so
    // perfStats.calls/triangles read whatever PerfSampler last captured just
    // before the freeze took effect -- exactly what's frozen on screen behind
    // the modal, which is the number that matters.
    const modal = await readPerfCounters(page);
    checks.check("modal-open draw calls within budget", modal.calls <= MODAL_CALLS_CEILING,
      `calls=${modal.calls} ceiling=${MODAL_CALLS_CEILING}`);
    checks.check("modal-open triangles within budget", modal.triangles <= MODAL_TRIS_CEILING,
      `triangles=${modal.triangles} ceiling=${MODAL_TRIS_CEILING}`);
    checks.check("modal-open programs within budget", modal.programs <= MODAL_PROGRAMS_CEILING,
      `programs=${modal.programs} ceiling=${MODAL_PROGRAMS_CEILING}`);
    checks.check("modal-open light count within budget", modal.lights <= MODAL_LIGHTS_CEILING,
      `lights=${modal.lights} ceiling=${MODAL_LIGHTS_CEILING}`);

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
    // Faced away from the sun, like the deep-space state: the 40-anomalies
    // counts below are budgeted against a view without it.
    await toDeepSpace(page);
    await settle(page, 1000);
    await faceFromSun(page, false);

    const beforePlasma = await page.evaluate(() => {
      let lights = 0;
      window.__fitz.scene.traverse((o) => { if (o.isLight) lights++; });
      return { lights, programs: window.__fitz.gl.info.programs.length,
        renders: window.__fitz.canvasRenderCount };
    });

    // lightBudget was fetched from src/constants.ts's LIGHT_BUDGET above (the
    // deep-space section) -- reuse the same import here instead of a second
    // hardcoded literal that could silently drift from the constant.
    checks.check("baseline light count is within LIGHT_BUDGET",
      beforePlasma.lights <= lightBudget, `lights=${beforePlasma.lights} LIGHT_BUDGET=${lightBudget}`);

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

    // Liveness precondition: the InstancedMesh mounts with a fixed
    // `count = ANOMALY_MAX` and `frustumCulled={false}` (PlasmaAnomalies.tsx),
    // so draw calls, triangles, lights and programs are ALL identical whether
    // 0 or 40 slots are actually active -- none of the three checks below can
    // tell "spawning is broken" from "spawning never happened" without this.
    // Mirrors the "approach actually entered a gravity well" precondition
    // above.
    const activeAnomalies = await page.evaluate(() =>
      window.__fitz.anomalies?.filter((a) => a.active).length ?? -1);
    // ">= 35", not "=== 40": stepAnomalies absorbs any anomaly within 0.4u of
    // the ship, and the click grid sits on a plane through the ship, so at
    // real frame rates the nearest few can be absorbed before this read. The
    // check's teeth are "spawning works at all", not an exact count.
    checks.check("40 plasma spawns actually populated the anomaly pool (precondition)",
      activeAnomalies >= 35, `active=${activeAnomalies}`);

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

    // ---- renderer counter budgets: 40 anomalies spawned (docs/PERF-BUDGETS.md) ----
    const anomalies = await readPerfCounters(page);
    const anomaliesSun = await sunInView(page);
    checks.check("40-anomalies state faces away from the sun (precondition)",
      anomaliesSun.behind && anomaliesSun.glare === false,
      `behind=${anomaliesSun.behind} glare=${anomaliesSun.glare}`);
    checks.check("40-anomalies draw calls within budget", anomalies.calls <= ANOMALIES_CALLS_CEILING,
      `calls=${anomalies.calls} ceiling=${ANOMALIES_CALLS_CEILING}`);
    checks.check("40-anomalies triangles within budget", anomalies.triangles <= ANOMALIES_TRIS_CEILING,
      `triangles=${anomalies.triangles} ceiling=${ANOMALIES_TRIS_CEILING}`);
    checks.check("40-anomalies programs within budget", anomalies.programs <= ANOMALIES_PROGRAMS_CEILING,
      `programs=${anomalies.programs} ceiling=${ANOMALIES_PROGRAMS_CEILING}`);
    checks.check("40-anomalies light count within budget", anomalies.lights <= ANOMALIES_LIGHTS_CEILING,
      `lights=${anomalies.lights} ceiling=${ANOMALIES_LIGHTS_CEILING}`);

    // ---- regression: a dossier open+close must not break warp (Critical 1) ----
    // R3F's setFrameloop (used by the dossier freeze above) zeroes
    // THREE.Clock.elapsedTime on EVERY frameloop transition -- twice per
    // open+close (once locking, once breaking). Spaceship.tsx used to gate
    // warp on a raw `state.clock.getElapsedTime()` read compared against an
    // absolute deadline (`warpSuppressUntil.current`, set on the ship's last
    // asteroid impact) stored from BEFORE the reset. Post-reset, the live
    // clock restarts near 0 while the stored deadline is still whatever it
    // was against the OLD, pre-reset numbering -- so Shift silently does
    // nothing until the new clock climbs all the way back up to that stale
    // absolute value: a dead window as long as the session had already run.
    // Same shape for the impact debounce (camera shake/impact sound/
    // bumpImpact) and ShootingStars' spawn timer, neither of which can
    // self-heal either. Fixed by routing all three through utils/
    // ambientTime.ts's gameTime(), which carries forward across exactly this
    // discontinuity instead of restarting at zero.
    //
    // This reproduces the real user path end to end: collide with an
    // asteroid (sets warpSuppressUntil/lastImpactAt to absolute, pre-reset
    // clock values), orbit-lock a planet (frameloop "always" -> "never",
    // reset #1), close the dossier via breakOrbit() (frameloop "never" ->
    // "always", reset #2 -- the same store call the harness elsewhere in
    // this file treats as "closing the dossier"), then hold Shift and
    // confirm warp actually engages and fuel actually drains. By this point
    // in the suite the page has been open long enough that the pre-reset
    // clock reading is comfortably non-trivial (the reported repro is ~60s
    // of flight), so this needs no long wait of its own.
    //
    // Driven through REAL keyboard input on purpose: writing
    // store.getState().setWarping(true) directly (as the "warp: isWarping
    // flips on every boost" check above does, deliberately, to isolate the
    // canvas re-render invariant) bypasses Spaceship's own `warpActive`
    // computation entirely -- which is exactly why 172 prior checks on this
    // branch never caught this regression.
    const asteroid = await page.evaluate(async () => {
      const mod = await import("/src/data/asteroids.ts");
      const a = mod.ASTEROID_COLLIDERS?.[0];
      if (!a) return null;
      return { x: a.x, y: a.y, z: a.z, r: a.r };
    });
    checks.check("asteroid table is readable (precondition)", asteroid !== null);

    if (asteroid) {
      const impactBefore = await page.evaluate(() => window.__fitz.store.getState().impactCount);
      // Approach from outside the collider radius and ram forward into it —
      // same technique gameplay.probe.mjs's "ramming an asteroid" check uses.
      // Nose down +Z so W closes on the rock from its -Z side: the ship spawns
      // aimed at a planet, so heading 0 has to be set, not assumed.
      await page.evaluate((p) => {
        window.__fitz.teleport(p.x, p.y, p.z - p.r - 2);
        window.__fitz.setAttitude(0, 0);
      }, asteroid);
      // Interleaved reads rather than one blind hold(): hold() is a Node-side
      // timer with no CDP traffic, and headless SwiftShader barely runs its
      // rAF loop while idle between protocol commands (see the same fix in
      // reducedmotion.probe.mjs), so the ship sometimes never reached the
      // rock. Each evaluate pumps frames forward.
      await page.keyboard.down("KeyW");
      for (let i = 0; i < 10; i++) {
        await settle(page, 250);
        await page.evaluate(() => window.__fitz.flight.z);
      }
      await page.keyboard.up("KeyW");
      const impactAfter = await page.evaluate(() => window.__fitz.store.getState().impactCount);
      checks.check("collided with an asteroid for the regression setup (precondition)",
        impactAfter > impactBefore, `${impactBefore} -> ${impactAfter}`);

      const fuelBefore = await page.evaluate(() => window.__fitz.flight.fuel);
      checks.check("fuel is available for the warp regression test (precondition)",
        fuelBefore > 0, `fuel=${fuelBefore}`);

      // Orbit-lock (frameloop reset #1).
      await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
      await settle(page, 300);
      const lockTarget = await page.evaluate(async () => {
        const { planets } = await import("/src/constants.ts");
        const p = planets[0];
        const b = window.__fitz.bodies[p.name];
        return { x: b.x, y: b.y, z: b.z, size: p.size };
      });
      await page.evaluate((p) => window.__fitz.teleport(p.x, p.y, p.z + p.size * 1.2), lockTarget);
      await settle(page, 2500);
      const lockedForRegression = await page.evaluate(() => window.__fitz.store.getState().isOrbitLocked);
      checks.check("orbit-locked for the clock-reset regression (precondition)",
        lockedForRegression, `locked=${lockedForRegression}`);

      // Close the dossier (frameloop reset #2).
      await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
      await settle(page, 300);

      await page.keyboard.down("ShiftLeft");
      await settle(page, 900);
      const isWarpingDuringHold = await page.evaluate(() => window.__fitz.store.getState().isWarping);
      const fuelDuringHold = await page.evaluate(() => window.__fitz.flight.fuel);
      await page.keyboard.up("ShiftLeft");

      checks.check("warp engages on real Shift input after a post-impact dossier round trip",
        isWarpingDuringHold, `isWarping=${isWarpingDuringHold}`);
      checks.check("fuel actually drains while warping post-round-trip",
        fuelDuringHold < fuelBefore, `${fuelBefore} -> ${fuelDuringHold}`);
    }
  });
}
