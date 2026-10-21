import { withPage, settle, toDeepSpace, pollUntil, SCENE_READY_TIMEOUT_MS, jumpToProbe, holdBeamUntilOpen, grabProbe } from "./harness.mjs";

// ---- renderer counter budgets (docs/PERF-BUDGETS.md) ----
// Measured on headless Chrome / SwiftShader (software rendering) -- see that
// file for the full baseline table, the six states these were captured in
// (deep space facing away from the sun, deep space facing it, near the
// ringed giant with its rings in frame, close approach, an open probe
// dossier ("modal open"), 40 anomalies facing away; faceFromSun and nearRingedGiant pin the heading, so
// what is in frame is set, not left to chance), and the derivation rule
// repeated here in short: calls/triangles are baseline + 15%, rounded up to
// the nearest ten; programs and lights are baseline + 1, since neither should
// grow at all during ordinary play -- the +1 is slack for a driver-dependent
// variant, not headroom for a new material. A ceiling going up without a
// matching, deliberate scene change is the regression this file exists to
// catch.
//
// Re-derived 2026-10-20 for the real Solar System (PR 40): each baseline is
// the highest of 6 serial runs of this probe alone (docs/PERF-BUDGETS.md,
// "Real Solar System re-baseline"). The states keep their poses; what is in
// them changed: nine always-visible orbit ribbons, far-body dots, the nine
// moons, Saturn's and Uranus's rings, a smaller Earth for the close approach,
// and the deep-space point moved clear of the real orbits. Programs is the
// exception to the rule above: its ceilings stay at the deliberate 79 (the
// deep-space family) and 84 (the close-approach and modal states), well above
// the 56-57 measured, because a headless run can decline to low-perf before
// warm-up and then compile both variants (see docs/PERF-BUDGETS.md). The real
// program guard is programs.probe.mjs's tour, which must add 0.
const DEEP_CALLS_CEILING = 50; // baseline 42
const DEEP_TRIS_CEILING = 303490; // baseline 263904
const DEEP_PROGRAMS_CEILING = 79; // baseline 56, deliberately high (above)

// Earth now, drawn 8.4 (Ruangrapi was 12): a lighter frame than before.
const APPROACH_CALLS_CEILING = 120; // baseline 100
const APPROACH_TRIS_CEILING = 419950; // baseline 365168
const APPROACH_PROGRAMS_CEILING = 84; // baseline 56, deliberately high (above)
const APPROACH_LIGHTS_CEILING = 5;

// "Modal open" is an open probe dossier (PR 39), entered by a jump to probe 1
// and a beam grab, so the frozen view is probe 1 at the nose, seen from its
// jump point.
const MODAL_CALLS_CEILING = 70; // baseline 56
const MODAL_TRIS_CEILING = 323450; // baseline 281256
const MODAL_PROGRAMS_CEILING = 84; // baseline 56, deliberately high (above)
const MODAL_LIGHTS_CEILING = 5;

const ANOMALIES_CALLS_CEILING = 50; // baseline 42
const ANOMALIES_TRIS_CEILING = 303490; // baseline 263904
const ANOMALIES_PROGRAMS_CEILING = 79; // baseline 57, deliberately high (above)
const ANOMALIES_LIGHTS_CEILING = 5;

// Deep space again, nose on the sun: the disc, its corona and the six lens
// sprites in frame, counted on purpose (the deep-space and 40-anomalies states
// face away from it), with the inner planets, their ribbons and dots.
const FACING_SUN_CALLS_CEILING = 160; // baseline 136
const FACING_SUN_TRIS_CEILING = 430280; // baseline 374148
const FACING_SUN_PROGRAMS_CEILING = DEEP_PROGRAMS_CEILING;
const FACING_SUN_LIGHTS_CEILING = 5;

// Near Saturn, nose on it, rings in frame (nearRingedGiant), Titan's rim too.
const RINGED_CALLS_CEILING = 60; // baseline 49
const RINGED_TRIS_CEILING = 323720; // baseline 281490
const RINGED_PROGRAMS_CEILING = DEEP_PROGRAMS_CEILING;
const RINGED_LIGHTS_CEILING = 5;

/**
 * How long to hold F for a probe's dossier to open. The pull is ~0.5 s of
 * simulated time, but this probe runs on SwiftShader, where frames are slow
 * and each is clamped to 0.05 s (see harness.mjs settle()).
 */
const GRAB_TIMEOUT_MS = 30_000;

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
 * toDeepSpace's DEEP_SPACE_POINT (260, -50, 140) that is yaw 61.7 deg / pitch
 * -9.6 deg away and yaw -118.3 deg / pitch +9.6 deg toward, both inside
 * PITCH_MAX (83 deg).
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
  await faceFrom(page, [0, 0, 0], toward);
}

/**
 * faceFromSun's turn and wait, about any point: the nose straight away from
 * `target` (`toward` false) or straight at it (`toward` true).
 */
async function faceFrom(page, target, toward) {
  await page.evaluate(([t, toward]) => {
    const d = window.__fitz;
    const f = d.flight;
    const dx = f.x - t[0], dy = f.y - t[1], dz = f.z - t[2];
    const r = Math.hypot(dx, dy, dz);
    const s = toward ? -1 : 1;
    const n = { x: (s * dx) / r, y: (s * dy) / r, z: (s * dz) / r };
    d.setAttitude(Math.atan2(n.x, n.z), Math.asin(n.y));
    // applyChaseCam's resting chase point: camDistance 4.6 (speed 0), camHeight 1.8.
    d.camera.position.set(f.x - n.x * 4.6, f.y - n.y * 4.6 + 1.8, f.z - n.z * 4.6);
  }, [target, toward]);
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
 * Parks the ship near the ringed giant with its rings in frame, nose on the
 * planet, and returns where it parked, for the precondition below.
 *
 * The ship goes RINGED_VIEW_DISTANCE from the planet's centre (outside its
 * 2.3-size ring reach and its 3.5-size well, so nothing pulls it while the
 * probe reads), RINGED_VIEW_ELEVATION_DEG above the ring plane on the side
 * the sun lights, and on the sun's side of the planet: the sun is behind the
 * camera, so the lens glare cannot add its sprites. From 80u the A ring's
 * edge (34u) spans about 24 deg of the 29 deg half-height, so the whole ring
 * system is in frame. The ring's plane comes from its mesh (RingGeometry
 * lies in its local XY, so its world +Z is the ring normal). The world moves
 * along its orbit while the teleport lands, so the nose is aimed at its
 * centre afterwards, from where the ship actually is.
 */
const RINGED_VIEW_DISTANCE = 80;
const RINGED_VIEW_ELEVATION_DEG = 35;
async function nearRingedGiant(page) {
  await page.evaluate(([dist, elevDeg]) => {
    const d = window.__fitz;
    const c = d.bodies.saturn;
    const ring = d.scene.getObjectByName("BodyRing_saturn");
    ring.updateWorldMatrix(true, false);
    const n = ring.getWorldDirection(d.camera.position.clone());
    const r = Math.hypot(c.x, c.y, c.z);
    const sun = { x: -c.x / r, y: -c.y / r, z: -c.z / r };
    let k = n.x * sun.x + n.y * sun.y + n.z * sun.z;
    if (k < 0) { n.multiplyScalar(-1); k = -k; } // the lit face
    // The sunward direction laid into the ring plane.
    const h = d.camera.position.clone().set(sun.x - n.x * k, sun.y - n.y * k, sun.z - n.z * k).normalize();
    const e = (elevDeg * Math.PI) / 180;
    const u = h.multiplyScalar(Math.cos(e)).addScaledVector(n, Math.sin(e));
    d.teleport(c.x + u.x * dist, c.y + u.y * dist, c.z + u.z * dist);
  }, [RINGED_VIEW_DISTANCE, RINGED_VIEW_ELEVATION_DEG]);
  await settle(page, 1500);
  const c = await page.evaluate(() => { const b = window.__fitz.bodies.saturn; return [b.x, b.y, b.z]; });
  await faceFrom(page, c, true);
}

/**
 * Whether the ringed giant's rings are in frame, read from the live camera on
 * one frame: the planet's centre on screen, the camera outside the A ring, the
 * rings opened toward it (|cos| of the view to the ring normal) rather than
 * edge-on, the ring mesh drawn, and the sun behind the camera.
 */
const ringsInView = (page) => page.evaluate(() => {
  const d = window.__fitz;
  const cam = d.camera;
  cam.updateMatrixWorld();
  const b = d.bodies.saturn;
  const ring = d.scene.getObjectByName("BodyRing_saturn");
  ring.updateWorldMatrix(true, false);
  const n = ring.getWorldDirection(cam.position.clone());
  const c = cam.position.clone().set(b.x, b.y, b.z);
  const ndc = c.clone().project(cam);
  const toCam = cam.position.clone().sub(c);
  const dist = toCam.length();
  const opening = Math.abs(toCam.normalize().dot(n));
  const outer = ring.geometry.parameters.outerRadius;
  const sunLocal = cam.worldToLocal(cam.position.clone().set(0, 0, 0));
  return {
    onScreen: Math.abs(ndc.x) < 0.6 && Math.abs(ndc.y) < 0.6 && ndc.z < 1,
    ndc: `(${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`,
    outside: dist > outer, dist: dist.toFixed(1), outer: outer.toFixed(1),
    opening: opening.toFixed(2), open: opening > 0.3,
    drawn: ring.visible, sunBehind: sunLocal.z > 0,
  };
});

/**
 * Every body draws through a LOD on the shared unit spheres
 * (src/utils/sphereLod.ts), its levels all on that body's one material.
 */
const bodiesUseLods = (page) => page.evaluate(async () => {
  const { BODY_IDS } = await import("/src/data/bodyIds.ts");
  const names = BODY_IDS.map((id) => `Body_${id}`);
  return names.map((name) => {
    const mesh = window.__fitz.scene.getObjectByName(name);
    const lod = mesh?.parent;
    const ok = !!lod?.isLOD && lod.levels.length === 3
      && lod.levels.every((l) => l.object.material === mesh.material)
      && new Set(lod.levels.map((l) => l.object.geometry.parameters.widthSegments)).size === 3;
    return { name, ok };
  });
});

/**
 * Teleports close to Earth: 1.45x its size out along its outward radial.
 *
 * That is inside the 1.8x radius (ZONE_FACTOR, src/constants.ts) where
 * planets used to set activeZone and outside the 1.3x where they used to
 * lock; planets do neither now (their dossiers moved onto probes), so the
 * spot is kept for the close-approach budget's continuity. It is well clear
 * of the solid surface (1x size plus the ship's half length). Size is read
 * from the live module, so the probe follows the planet table instead of
 * pinning a size.
 */
async function approachPlanet(page) {
  return page.evaluate(async () => {
    const { bodyById } = await import("/src/data/solarSystem.ts");
    const name = "earth";
    const p = window.__fitz.bodies[name];
    // On the planet's outward radial (away from the sun at the origin), at
    // 1.45x the planet size. Orbits are centred on the origin, so planet
    // motion is perpendicular to this line and the gap can only grow while
    // the probe waits: the planet never sweeps into the ship.
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    const d = bodyById(name).size * 1.45;
    window.__fitz.teleport(p.x + (p.x / r) * d, p.y + (p.y / r) * d, p.z + (p.z / r) * d);
    return name;
  });
}

export default async function run() {
  return withPage({ label: "transition", backend: "swiftshader" }, async (page, checks) => {
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
    // Same point, nose on the sun, so the disc, corona, lens sprites and the
    // inner system are all counted on purpose (the old flake only ever caught
    // the six sprites at its edge). The precondition proves they are in frame.
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

    // ---- renderer counter budgets: near the ringed giant, rings in frame (docs/PERF-BUDGETS.md) ----
    const lods = await bodiesUseLods(page);
    checks.check("every body draws through a 64/24/12 LOD on its one material",
      lods.every((l) => l.ok), lods.filter((l) => !l.ok).map((l) => l.name).join(", ") || "all");
    await nearRingedGiant(page);
    const ringed = await readPerfCounters(page);
    const ringedView = await ringsInView(page);
    checks.check("Saturn state has the planet and its rings in frame, opened, sun behind (precondition)",
      ringedView.onScreen && ringedView.outside && ringedView.open && ringedView.drawn && ringedView.sunBehind,
      JSON.stringify(ringedView));
    checks.check("ringed-giant draw calls within budget", ringed.calls <= RINGED_CALLS_CEILING,
      `calls=${ringed.calls} ceiling=${RINGED_CALLS_CEILING}`);
    checks.check("ringed-giant triangles within budget", ringed.triangles <= RINGED_TRIS_CEILING,
      `triangles=${ringed.triangles} ceiling=${RINGED_TRIS_CEILING}`);
    checks.check("ringed-giant programs within budget", ringed.programs <= RINGED_PROGRAMS_CEILING,
      `programs=${ringed.programs} ceiling=${RINGED_PROGRAMS_CEILING}`);
    checks.check("ringed-giant light count within budget", ringed.lights <= RINGED_LIGHTS_CEILING,
      `lights=${ringed.lights} ceiling=${RINGED_LIGHTS_CEILING}`);
    // Back to the facing-sun pose: the approach teleport keeps the heading, so
    // leaving the nose on the ringed giant would change what the close-approach
    // and modal states have in frame (it halved close approach's draw calls).
    await toDeepSpace(page);
    await settle(page, 1000);
    await faceFromSun(page, true);

    // ---- close approach to a planet: no zone, no lock, no re-render ----
    const beforeApproach = await canvasRenders(page);
    const planet = await approachPlanet(page);
    await settle(page, 1500);
    const afterApproach = await canvasRenders(page);
    // Counted first, straight after the settle, as before planets lost their
    // zone: the chase camera is still easing in, so a slower read in between
    // (the module import below) changes what is in frame.
    const approach = await readPerfCounters(page);
    const close = await page.evaluate(async (name) => {
      const { bodyById } = await import("/src/data/solarSystem.ts");
      const size = bodyById(name).size;
      const b = window.__fitz.bodies[name], f = window.__fitz.flight;
      const st = window.__fitz.store.getState();
      return { k: Math.hypot(f.x - b.x, f.y - b.y, f.z - b.z) / size, zone: st.activeZone, locked: st.isOrbitLocked };
    }, planet);
    // Earth drifts off the parked spot at its orbital speed (1.72 u/s, 0.21 of
    // its drawn 8.4 u size a second; Ruangrapi's 12 drifted 0.14), so from
    // 1.45 sizes the gap passes the old 1.8 zone after ~5 s of game time, which
    // a slow SwiftShader settle can take (1 run in 8 read 1.88). 2.2 sizes is
    // ~9 s of drift: still a close approach, still well inside its well.
    checks.check("the approach parked within 2.2 planet sizes (precondition)",
      close.k > 1 && close.k < 2.2, `planet=${planet} distance=${close.k.toFixed(2)} sizes`);
    checks.check("a close approach to a planet sets no zone and no lock (planets are scan-only)",
      close.zone === null && !close.locked, `activeZone=${close.zone} locked=${close.locked}`);
    checks.check("zero canvas re-renders on a close planet approach",
      afterApproach - beforeApproach === 0, `delta=${afterApproach - beforeApproach}`);

    // ---- renderer counter budgets: close approach (docs/PERF-BUDGETS.md) ----
    checks.check("close-approach draw calls within budget", approach.calls <= APPROACH_CALLS_CEILING,
      `calls=${approach.calls} ceiling=${APPROACH_CALLS_CEILING}`);
    checks.check("close-approach triangles within budget", approach.triangles <= APPROACH_TRIS_CEILING,
      `triangles=${approach.triangles} ceiling=${APPROACH_TRIS_CEILING}`);
    checks.check("close-approach programs within budget", approach.programs <= APPROACH_PROGRAMS_CEILING,
      `programs=${approach.programs} ceiling=${APPROACH_PROGRAMS_CEILING}`);
    checks.check("close-approach light count within budget", approach.lights <= APPROACH_LIGHTS_CEILING,
      `lights=${approach.lights} ceiling=${APPROACH_LIGHTS_CEILING}`);

    // ---- a probe comes in range: probeNear flips, canvas must not re-render ----
    // probeNear is the store field that flips as the ship flies about (it
    // carries the zone chatter now that planets have no zone; destinations'
    // activeZone flips the same way). GlobalCanvas must not subscribe to it.
    // Teleported, not jumped: a jump also fires the teleport flash. After the
    // close-approach budget, so that state is still entered straight from
    // the facing-sun pose (the chase camera is still easing in when it is
    // read, so where the ship came from changes what is in frame).
    const farFromProbes = await page.evaluate(() => window.__fitz.store.getState().probeNear);
    checks.check("no probe is in range at the planet (precondition)", farFromProbes === null, `probeNear=${farFromProbes}`);
    const beforeNear = await canvasRenders(page);
    const nearProbe = await page.evaluate(() => {
      // 30 u from probe 1, on the side away from the spawn pad (inside the
      // 45 u PROBE_IN_RANGE, outside beam reach of anything else).
      const p = window.__fitz.probes.ruangrapi;
      const s = [-50, 62, 69]; // src/data/spawn.ts SPAWN
      const d = Math.hypot(p.x - s[0], p.y - s[1], p.z - s[2]);
      window.__fitz.teleport(p.x + ((p.x - s[0]) / d) * 30, p.y + ((p.y - s[1]) / d) * 30, p.z + ((p.z - s[2]) / d) * 30);
      return "ruangrapi";
    });
    const near = await pollUntil(() => page.evaluate(() => window.__fitz.store.getState().probeNear), { timeoutMs: 5000, intervalMs: 100 });
    await settle(page, 1000);
    const afterNear = await canvasRenders(page);
    checks.check("a probe actually came in range (probeNear flipped)", near.value === nearProbe,
      `probeNear=${near.value}`);
    checks.check("zero canvas re-renders when probeNear flips",
      afterNear - beforeNear === 0, `delta=${afterNear - beforeNear}`);

    // ---- a probe dossier opens: the canvas freezes ----
    // GlobalCanvas subscribes to selectSceneFrozen (an open dossier, or a
    // destination's orbit lock, outside photo mode) so it CAN react: it flips
    // `frameloop` to stop rendering behind the dossier. So opening one SHOULD
    // re-render the canvas (to apply the freeze), and only once as far as
    // React's own commit is concerned (dev-mode StrictMode double-invoke
    // aside), not once per frame while the dossier sits open.
    //
    // Opened the real way: jump to probe 1 (key 1's path, which opens
    // nothing) and hold F until the beam has pulled it in. The baseline is
    // taken after the jump lands, so the delta is the grab and the dossier.
    const landedAtProbe = await jumpToProbe(page, "ruangrapi");
    checks.check("the jump lands beside probe 1 (precondition)", landedAtProbe.ok,
      `dist=${landedAtProbe.value?.toFixed?.(2)}`);
    await settle(page, 500);
    const beforeOpen = await canvasRenders(page);
    const grabbed = await holdBeamUntilOpen(page, "ruangrapi", { timeoutMs: GRAB_TIMEOUT_MS });
    const afterOpen = await canvasRenders(page);
    await settle(page, 1200);
    const afterSettle = await canvasRenders(page);

    checks.check("holding F on probe 1 opens its dossier", grabbed.ok,
      `openDossier=${await page.evaluate(() => window.__fitz.store.getState().openDossier)}`);
    checks.check("the dossier opening re-renders the canvas (to apply the freeze)",
      afterOpen - beforeOpen > 0, `delta=${afterOpen - beforeOpen}`);
    checks.check("the canvas does not keep re-rendering while the dossier stays open",
      afterSettle - afterOpen === 0, `delta=${afterSettle - afterOpen}`);

    // ---- renderer counter budgets: dossier modal open (docs/PERF-BUDGETS.md) ----
    // frameloop is "never" here (the freeze this section exists to test), so
    // perfStats.calls/triangles read whatever PerfSampler last captured just
    // before the freeze took effect -- exactly what's frozen on screen behind
    // the dossier: probe 1 pulled up to the nose, seen from the jump point.
    const modal = await readPerfCounters(page);
    checks.check("modal-open draw calls within budget", modal.calls <= MODAL_CALLS_CEILING,
      `calls=${modal.calls} ceiling=${MODAL_CALLS_CEILING}`);
    checks.check("modal-open triangles within budget", modal.triangles <= MODAL_TRIS_CEILING,
      `triangles=${modal.triangles} ceiling=${MODAL_TRIS_CEILING}`);
    checks.check("modal-open programs within budget", modal.programs <= MODAL_PROGRAMS_CEILING,
      `programs=${modal.programs} ceiling=${MODAL_PROGRAMS_CEILING}`);
    checks.check("modal-open light count within budget", modal.lights <= MODAL_LIGHTS_CEILING,
      `lights=${modal.lights} ceiling=${MODAL_LIGHTS_CEILING}`);

    // ---- regression: classic-CV round trip while a dossier is open must
    // not leave the canvas painting zero frames forever ----
    // showClassicCV is the only thing that unmounts GlobalCanvas (App.tsx),
    // and setShowClassicCV(true) closes the dossier (and breaks any orbit
    // lock) on the way in. Without that, a visitor who opened a dossier,
    // then clicked into the classic resume and back, got a freshly-mounted
    // Canvas whose very first render already had sceneFrozen=true --
    // frameloop="never" from frame one, with no frozen->unfrozen edge for the
    // invalidate() effect (GlobalCanvas.tsx) to ever fire on. R3F provides no
    // initial paint for frameloop="never" (both invalidate() and the internal
    // invalidateInstance no-op while frozen), so that's a genuinely blank
    // canvas, not a stale frame, until the visitor closes the dossier by hand.
    //
    // gl.info.render.frame (a fresh WebGLRenderer's own draw-call counter,
    // re-published by DebugBridge on every GlobalCanvas mount) is the only
    // reliable signal here -- a screenshot can't distinguish "the 3D scene is
    // frozen" from "everything is fine," because the HUD, radar, chatter
    // ticker and perf overlay all animate on their own independent rAF loops
    // regardless of whether the WebGL canvas itself is painting.
    const stillOpen = await page.evaluate(() => window.__fitz.store.getState().openDossier);
    checks.check("the dossier is still open going into the round trip (precondition)", stillOpen === "ruangrapi",
      `openDossier=${stillOpen}`);
    // Baseline from the OLD (about-to-be-unmounted) renderer, used below only
    // to detect when window.__fitz.gl has actually swapped to the new one.
    const frameBeforeRoundTrip = await page.evaluate(() => window.__fitz.gl.info.render.frame);

    await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(true));
    await settle(page, 500);
    checks.check("opening classic CV while a dossier is open closes it",
      (await page.evaluate(() => window.__fitz.store.getState().openDossier)) === null);

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
      // The regression is a canvas that paints zero frames forever, so poll
      // for the next frame up to the scene-ready timeout instead of a fixed
      // 1 s: the fresh renderer recompiles its shaders first, which on a
      // loaded machine under SwiftShader outlasted the window (35 -> 35).
      const t0 = Date.now();
      const next = await pollUntil(async () => {
        const f = await page.evaluate(() => window.__fitz.gl.info.render.frame);
        return f > frame1 ? f : null;
      }, { timeoutMs: SCENE_READY_TIMEOUT_MS, intervalMs: 250 });
      checks.check("canvas resumes rendering after a classic-CV round trip with a dossier open",
        next.ok, `frame ${frame1} -> ${next.value ?? frame1} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

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
    // open+close (once opening, once closing). Spaceship.tsx used to gate
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
    // clock values), grab a probe so its dossier opens (frameloop "always"
    // -> "never", reset #1), close the dossier with closeDossier(), the
    // store call Esc, the X and pad B make (frameloop "never" -> "always",
    // reset #2), then hold Shift and confirm warp actually engages and fuel
    // actually drains. By this point
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

      // Open a probe dossier (frameloop reset #1): probe 2, untouched so far
      // (probe 1 relocated when the round trip above closed its dossier).
      const regressionGrab = await grabProbe(page, "portfolio", { timeoutMs: GRAB_TIMEOUT_MS });
      checks.check("a probe dossier is open for the clock-reset regression (precondition)",
        regressionGrab.ok, `landed=${regressionGrab.landed} openDossier=${await page.evaluate(() => window.__fitz.store.getState().openDossier)}`);

      // Close the dossier (frameloop reset #2).
      await page.evaluate(() => window.__fitz.store.getState().closeDossier());
      await settle(page, 300);
      // Then out to deep space, nose away from the sun, so the warp below
      // runs clear of anything it could hit (an impact suppresses warp, which
      // is not the bug under test). The stale-deadline bug outlives this wait
      // by a whole session's worth of clock, so the wait cannot hide it.
      await toDeepSpace(page);
      await faceFromSun(page, false);

      // Read last: the tank refills whenever warp is off.
      const fuelBefore = await page.evaluate(() => window.__fitz.flight.fuel);
      checks.check("fuel is available for the warp regression test (precondition)",
        fuelBefore > 0, `fuel=${fuelBefore}`);

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
