import { withPage, settle, readStore, pollUntil, installEdgeRecorder, readEdgeRecorder, stopEdgeRecorder, runParts } from "./harness.mjs";

/** src/constants.ts SYSTEM_RADIUS (3,600 since the real Solar System, Task 6). */
const EDGE = 3600;

const hazeOpacity = (page) => page.evaluate(() => Number(document.querySelector('[data-testid="edge-haze"]')?.style.opacity ?? "0"));
/** Faces the ship at a world point (yaw only) and ends the spawn auto-aim. */
const face = (page, x, z) => page.evaluate((tx, tz) => {
  const f = window.__fitz.flight;
  window.__fitz.setAttitude(Math.atan2(tx - f.x, tz - f.z), 0);
}, x, z);
/** Parks the ship 8u from main-belt pebble 0, facing it. */
const pebbleAhead = async (page) => {
  await page.evaluate(() => {
    const w = window.__fitz.mining.rings[0].world;
    window.__fitz.teleport(w[0], w[1], w[2] - 8);
  });
  const target = await page.evaluate(() => { const w = window.__fitz.mining.rings[0].world; return { x: w[0], z: w[2] }; });
  await face(page, target.x, target.z);
};
/** True once the HUD's ORE readout shows: a pebble was pulled in and absorbed. */
const oreShown = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="hud-ore"]');
  return !!el && el.style.display !== "none" && /ORE \d+\/16/.test(el.textContent ?? "");
});

async function edge(page, checks) {
  const radius = () => page.evaluate(() => {
    const f = window.__fitz.flight;
    return Math.hypot(f.x, f.y, f.z);
  });
  await page.keyboard.press("KeyW"); // first input
  // Installed before the teleport: the haze line fires on arrival at depth 0.5.
  await installEdgeRecorder(page, EDGE);
  await page.evaluate((r) => { window.__fitz.teleport(r - 20, 0, 0); window.__fitz.setAttitude(Math.PI / 2, 0); }, EDGE);
  await settle(page, 7000); // let the radio go quiet (RADIO_BUSY_S = 6)
  const op = await hazeOpacity(page);
  checks.check("haze thickens near the edge", op > 0.3, `opacity=${op} at r=${(await radius()).toFixed(1)}`);

  // Holding thrust outward past the edge: the burn out-muscles the pilot
  // (40 u/s^2 against 25.2), so the ship is still brought back. The in-page
  // recorder (harness.mjs) timestamps crossing and return per frame, reads the
  // haze opacity in the frame of maximum radius, and remembers any RETURN BURN
  // broadcast, and sums simulated time (clamped frame dt) from the crossing,
  // so "within 6 simulated seconds" is asserted directly; the 60 s polls are
  // hang guards.
  let flashed = false;
  await page.keyboard.down("KeyW");
  const done = await pollUntil(async () => {
    flashed = flashed || (await readStore(page)).isTeleporting;
    return (await readEdgeRecorder(page)).tBack !== null;
  }, { timeoutMs: 60_000, intervalMs: 100 });
  await page.keyboard.up("KeyW");
  const rec = await readEdgeRecorder(page);
  const backS = rec.tBack !== null && rec.tCross !== null ? (rec.tBack - rec.tCross) / 1000 : Infinity;
  checks.check("holding thrust outward, the ship reaches the edge", rec.tCross !== null, `max r=${rec.maxR.toFixed(1)}`);
  checks.check(`the haze is full at ${EDGE} (HAZE_MAX_OPACITY 0.92)`, rec.maxR > EDGE && rec.opAtMax > 0.9 && rec.opAtMax <= 0.92,
    `opacity=${rec.opAtMax} read in the frame of max r=${rec.maxR.toFixed(1)}`);
  checks.check("holding thrust outward at the edge, the ship is still brought back", done.ok && rec.tBack !== null,
    `max r=${rec.maxR.toFixed(1)}, back after ${backS.toFixed(1)}s wall`);
  checks.check("the return takes at most 6 simulated seconds", rec.tBack !== null && rec.simBack <= 6,
    `${rec.simBack.toFixed(2)}s simulated, ${backS.toFixed(1)}s wall`);
  checks.check("the ship stays well inside the validation bounds", rec.maxR < EDGE + 20, `max r=${rec.maxR.toFixed(1)}`);
  checks.check("the edge fires no teleport flash", !flashed);
  // The haze line (depth 0.3) plays first on the way out, the burn line a moment
  // later; the recorder catches the burn line whatever replaces it afterwards.
  checks.check("the RETURN BURN line was broadcast", rec.burn);
  // The burn line explains an involuntary control change, so it is audible
  // (not silent); the haze line is ambient and may stay silent.
  checks.check("the RETURN BURN line is audible (not silent)", rec.burn && rec.burnSilent === false, `silent=${rec.burnSilent}`);
  checks.check("the haze line played at depth >= 0.3", rec.haze && rec.hazeDepth >= 0.3,
    `haze line=${rec.haze}, depth=${rec.hazeDepth?.toFixed(2)}, silent=${rec.hazeSilent}`);
  await stopEdgeRecorder(page);
}

/**
 * Gravity runs under reduced motion: the bodies freeze there (wells still
 * pull, spec §5.2), which makes the geometry deterministic. In headless
 * SwiftShader the ship's simulated time runs ~3x slower than wall time (low
 * fps, 0.05s frame clamp) while bodies orbit on wall time, so a moving
 * body drifts out of a fixed-wall-clock pass. Every wait polls progress.
 *
 * Flown at Earth, with the gas giant's (size 16) distances scaled by
 * size / 16, as tests/gravityWell.test.ts flies its tuning targets.
 */
async function gravity(page, checks) {
  await page.keyboard.press("KeyW");
  const name = "earth";
  const k = await page.evaluate(async (n) => {
    const { bodyById } = await import("/src/data/solarSystem.ts");
    return bodyById(n).size / 16;
  }, name);
  const relX = () => page.evaluate((n) => window.__fitz.flight.x - window.__fitz.bodies[n].x, name);

  // A W-held pass 34u (scaled) above the body's centre, flying +x, until the
  // ship is out the far side of its well.
  await page.evaluate((n, kk) => {
    const b = window.__fitz.bodies[n];
    window.__fitz.teleport(b.x - 90 * kk, b.y + 34 * kk, b.z);
    window.__fitz.setAttitude(Math.PI / 2, 0);
  }, name, k);
  // The skim must not stick: no lock, no zone, no dossier (planets no longer
  // dock; their dossiers moved onto probes).
  let peak = 0, stuck = false;
  await page.keyboard.down("KeyW");
  const through = await pollUntil(async () => {
    const r = await page.evaluate(() => {
      const st = window.__fitz.store.getState();
      return { s: window.__fitz.flight.speed, stuck: st.isOrbitLocked || st.activeZone !== null || st.openDossier !== null };
    });
    peak = Math.max(peak, r.s); stuck = stuck || r.stuck;
    return (await relX()) > 60 * k;
  }, { timeoutMs: 90_000, intervalMs: 150 });
  await page.keyboard.up("KeyW");
  // Past cruise (10.8) by at least 1, the non-reference bodies' target in tests/gravityWell.test.ts.
  checks.check("the 34u (scaled) pass flew through Earth's well", through.ok);
  checks.check("a pass 34u (scaled) off Earth speeds the ship past cruise", peak > 11.8, `peak=${peak.toFixed(1)}`);
  checks.check("that skim does not stick (no lock, no zone, no dossier)", !stuck);

  // Straight in: the planet is solid. The ship flies into the surface (its
  // size plus the ship's half length, src/utils/worldCollide.ts), bounces,
  // and never ends a frame inside it; nothing locks or opens. An in-page
  // recorder reads every frame, so the closest approach is not left to poll
  // timing.
  const reach = await page.evaluate(async (n) => {
    const { bodyById } = await import("/src/data/solarSystem.ts");
    const { SHIP_HALF_LENGTH } = await import("/src/utils/worldCollide.ts");
    return bodyById(n).size + SHIP_HALF_LENGTH;
  }, name);
  await page.evaluate((n) => {
    const b = window.__fitz.bodies[n];
    window.__fitz.teleport(b.x - 60, b.y, b.z);
    window.__fitz.setAttitude(Math.PI / 2, 0);
    const rec = { min: Infinity, stuck: false, stop: false, impacts0: window.__fitz.store.getState().impactCount };
    window.__solidRec = rec;
    const step = () => {
      const f = window.__fitz.flight, c = window.__fitz.bodies[n], st = window.__fitz.store.getState();
      rec.min = Math.min(rec.min, Math.hypot(f.x - c.x, f.y - c.y, f.z - c.z));
      rec.stuck = rec.stuck || st.isOrbitLocked || st.openDossier !== null;
      rec.impacts = st.impactCount - rec.impacts0;
      if (!rec.stop) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, name);
  await page.keyboard.down("KeyW");
  const hit = await pollUntil(() => page.evaluate(() => window.__solidRec.impacts > 0), { timeoutMs: 60_000, intervalMs: 200 });
  // Keep pushing a moment: holding thrust into the surface must not get through it.
  for (let i = 0; i < 10; i++) { await settle(page, 100); await page.evaluate(() => window.__fitz.flight.x); }
  await page.keyboard.up("KeyW");
  const solid = await page.evaluate(() => { window.__solidRec.stop = true; return { ...window.__solidRec }; });
  checks.check("a straight-in approach hits the planet's surface", hit.ok, `impacts=${solid.impacts}`);
  checks.check("the planet is solid: the ship never gets inside it", solid.min >= reach - 0.05,
    `closest ${solid.min.toFixed(2)}, surface at ${reach.toFixed(2)}`);
  checks.check("hitting a planet docks nothing and opens no dossier", !solid.stuck);
  await settle(page, 1500);

  // Idle 30u (scaled) from the body: station-keeping.
  await page.evaluate((n, kk) => { const b = window.__fitz.bodies[n]; window.__fitz.teleport(b.x - 30 * kk, b.y + 5 * kk, b.z); }, name, k);
  const a = await page.evaluate(() => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
  await settle(page, 10_000);
  const b = await page.evaluate(() => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
  const drift = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  checks.check("an idle ship near a planet barely drifts", drift < 3, `drift=${drift.toFixed(2)}`);
}

async function beam(page, checks) {
  await page.keyboard.press("KeyW");
  // Mining: park 8u from a main-belt pebble, facing it. The beam pulls the
  // pebble in and absorbs it as ore (the fuel crystals it used to pull are gone).
  await pebbleAhead(page);
  await settle(page, 1000);
  const programsBefore = await page.evaluate(() => window.__fitz.gl.info.programs.length);
  await page.keyboard.down("KeyF");
  await settle(page, 300);
  const during = await page.evaluate(() => ({
    programs: window.__fitz.gl.info.programs.length,
    calls: window.__fitz.perfStats.calls,
    cone: window.__fitz.scene.getObjectByName("TractorBeamCone")?.visible === true,
  }));
  const ore = await pollUntil(() => oreShown(page), { timeoutMs: 15_000, intervalMs: 250 });
  await page.keyboard.up("KeyF");
  checks.check("mining a belt pebble shows the ORE readout", ore.ok);
  checks.check("the beam cone shows while F is held", during.cone);
  checks.check("the beam adds no shader program", during.programs === programsBefore,
    `before=${programsBefore} during=${during.programs}`);
  checks.check("draw calls stay within the close-approach ceiling with the beam on", during.calls <= 110, `calls=${during.calls}`);

  // Shard reel: shard 1 (src/data/shards.ts; moved clear of the real orbits
  // in Task 5); park 22u short of it, facing it.
  const already = (await readStore(page)).shardsCollected.includes(1);
  await page.evaluate(async () => {
    const { SHARDS } = await import("/src/data/shards.ts");
    const [x, y, z] = SHARDS[1].pos;
    window.__fitz.teleport(x, y, z - 22); window.__fitz.setAttitude(0, 0);
  });
  await page.keyboard.down("KeyF");
  const reeled = await pollUntil(async () => (await readStore(page)).shardsCollected.includes(1), { timeoutMs: 12_000, intervalMs: 200 });
  await page.keyboard.up("KeyF");
  checks.check("the beam reels the ship to a shard and collects it", already || reeled.ok, already ? "already collected" : "");
}

async function photoMode(page, checks) {
  await page.keyboard.press("KeyW");
  await page.keyboard.press("KeyP");
  await settle(page, 500);
  await page.keyboard.down("KeyF");
  await settle(page, 600);
  const active = await page.evaluate(() => window.__fitz.beam.active);
  await page.keyboard.up("KeyF");
  await page.keyboard.press("KeyP");
  checks.check("the beam stays off in photo mode", active === false);
}

async function reducedMotion(page, checks) {
  await page.keyboard.press("KeyW");
  await page.evaluate((r) => window.__fitz.teleport(r - 10, 0, 0), EDGE); // haze depth ~0.84 (u 0.75 of the last 40)
  await settle(page, 600);
  const op = await hazeOpacity(page);
  checks.check("reduced motion: the haze still shows", op > 0.5, `opacity=${op}`);
  await pebbleAhead(page);
  await page.keyboard.down("KeyF");
  const got = await pollUntil(() => oreShown(page), { timeoutMs: 15_000, intervalMs: 250 });
  await page.keyboard.up("KeyF");
  checks.check("reduced motion: the beam still mines a pebble", got.ok);
}

/**
 * Eclipses (docs/UNIVERSE-RULES.md L20, F4), with the bodies frozen by
 * reduced motion. Earth (radius 8.4) is smaller than the sun (24), so its
 * umbra closes, but only ~62 out (8.4 x 115 / (24 - 8.4)); the test point 2.5
 * sizes (21u) out on the far side is deep inside it: full night.
 */
async function eclipses(page, checks) {
  await page.keyboard.press("KeyW");
  const wired = await page.evaluate(() => !!window.__fitz.shipShadow && !!window.__fitz.sunShadow);
  checks.check("the ship's sunVis and the occluder slots are on the debug bridge", wired);
  if (!wired) return;

  // Occluder slots (sunShadow.ts): the bodies with a moon or a ring 0-5 at
  // their centres (updateBodies), the nine moons 6-14 at theirs (updateMoons).
  const slots = await page.evaluate(async () => {
    const { SOLAR_BODIES } = await import("/src/data/solarSystem.ts");
    const { SOLAR_MOONS } = await import("/src/data/solarMoons.ts");
    const { bodySlot, moonSlot } = await import("/src/components/canvas/sunShadow.ts");
    const u = window.__fitz.sunShadow;
    const track = (slot, c, r, id) => {
      const s = u.uOccluders.value[slot];
      return { id, err: Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z), dr: Math.abs(s.w - r) };
    };
    return {
      count: u.uOccluderCount.value,
      bodies: SOLAR_BODIES.filter((b) => bodySlot(b.id) >= 0).map((b) => track(bodySlot(b.id), window.__fitz.bodies[b.id], b.size, b.id)),
      moons: SOLAR_MOONS.map((m) => track(moonSlot(m.id), window.__fitz.moons[m.id], m.size, m.id)),
    };
  });
  checks.check("the fifteen GPU occluder slots are in use (six bodies with a moon or a ring, nine moons)", slots.count === 15, `count=${slots.count}`);
  checks.check("occluder slots track the bodies", slots.bodies.length === 6 && slots.bodies.every((b) => b.err < 0.01 && b.dr < 1e-6),
    slots.bodies.map((b) => `${b.id} ${b.err.toFixed(4)}`).join(", "));
  checks.check("occluder slots track the moons", slots.moons.length === 9 && slots.moons.every((b) => b.err < 0.01 && b.dr < 1e-6),
    slots.moons.map((b) => `${b.id} ${b.err.toFixed(4)}`).join(", "));

  // Each body skips its own sphere by distance, in one program per material
  // kind: its compiled program says so. Reading the program in use (not the
  // material's key function) also proves the patch survived React and is
  // what three actually compiled.
  const programs = await page.evaluate(async () => {
    const { SOLAR_BODIES } = await import("/src/data/solarSystem.ts");
    const gl = window.__fitz.gl, ctx = gl.getContext();
    const SKIP = "if ( length( uOccluders[ k ].xyz - p ) < SUN_SHADOW_SELF_SKIP * uOccluders[ k ].w ) continue;";
    const used = (mat) => {
      const prog = gl.properties.get(mat).currentProgram;
      return prog ? { key: prog.cacheKey, src: ctx.getShaderSource(prog.fragmentShader) ?? "" } : { key: "", src: "" };
    };
    return {
      bodies: SOLAR_BODIES.map((b) => {
        const mesh = window.__fitz.scene.getObjectByName(`Body_${b.id}`);
        const { key, src } = mesh ? used(mesh.material) : { key: "", src: "" };
        // Saturn's program also lets sunlight through its rings (sunShadowRingGate), its own variant.
        return { name: b.id, key: key.includes("|sunShadow:fragment"), self: src.includes(SKIP),
          gate: src.includes("sunShadowCoverage( sunShadowWorld( geometryPosition ) )") || src.includes("sunShadowRingGate( sunShadowWorld( geometryPosition ) )"),
          cityLights: src.includes("uniform vec3 uSunView;") };
      }),
      clouds: (() => {
        const mesh = window.__fitz.scene.getObjectByName("CloudLayer");
        const { key, src } = mesh ? used(mesh.material) : { key: "", src: "" };
        return key.endsWith("|sunShadow:fragment") && src.includes(SKIP);
      })(),
      moons: (() => {
        const out = [];
        window.__fitz.scene.traverse((o) => {
          if (!o.isMesh || !o.name.startsWith("Moon_") || out.some((m) => m.name === o.name)) return;
          const { key, src } = used(o.material);
          const shaped = o.name === "Moon_phobos" || o.name === "Moon_deimos";
          out.push({ name: o.name, ok: shaped
            ? key.endsWith("|sunShadow:object") && src.includes("directLight.color *= uSunVis;")
            : key.endsWith("|sunShadow:fragment") && src.includes(SKIP) });
        });
        return out;
      })(),
      ship: window.__fitz.shipShadow.materials.map((mat) => {
        const { key, src } = used(mat);
        return key.endsWith("|sunShadow:object") && src.includes("directLight.color *= uSunVis;");
      }),
    };
  });
  checks.check("a body does not shadow itself (its own sphere is skipped by distance)",
    programs.bodies.length === 9 && programs.bodies.every((p) => p.key && p.self && p.gate), JSON.stringify(programs.bodies));
  checks.check("Earth keeps its night-side city lights alongside the shadow", programs.bodies.find((b) => b.name === "earth")?.cityLights === true);
  checks.check("Earth's clouds darken in the same shadows (their planet skipped)", programs.clouds === true);
  checks.check("the nine moons draw shadowed: round ones per fragment (own sphere skipped), Phobos and Deimos per object",
    programs.moons.length === 9 && programs.moons.every((m) => m.ok), JSON.stringify(programs.moons));
  checks.check("every ship hull material draws with its shadow program",
    programs.ship.length > 0 && programs.ship.every(Boolean), `materials=${programs.ship.length} ${JSON.stringify(programs.ship)}`);

  // The ship in Earth's umbra, then beside it.
  const place = (side) => page.evaluate(async (s) => {
    const { bodyById } = await import("/src/data/solarSystem.ts");
    const size = bodyById("earth").size;
    const b = window.__fitz.bodies.earth;
    const r = Math.hypot(b.x, b.y, b.z);
    const ux = b.x / r, uy = b.y / r, uz = b.z / r;
    const h = Math.hypot(ux, uz), sx = -uz / h, sz = ux / h;
    window.__fitz.teleport(b.x + ux * size * 2.5 + sx * size * 4 * s, b.y + uy * size * 2.5, b.z + uz * size * 2.5 + sz * size * 4 * s);
  }, side);
  const sunVis = () => page.evaluate(() => window.__fitz.shipShadow.sunVis.value);
  await place(0);
  const dark = await pollUntil(async () => (await sunVis()) < 0.05, { timeoutMs: 10_000, intervalMs: 250 });
  const darkV = await sunVis();
  checks.check("the ship goes dark in Earth's umbra", dark.ok, `sunVis=${darkV}`);
  await place(1);
  // Beside Earth, only the other bodies and the moons can cover the sun. On
  // the pinned date (2026-10-20) Venus is four days from inferior conjunction
  // and covers part of the drawn (enlarged) Sun from Earth's neighbourhood, so
  // the expectation is the CPU sunVisibility against every body but Earth and
  // every moon (the ship reads them all, sunShadow.ts allOccluders), not a bare 1.
  const besideRead = () => page.evaluate(async () => {
    const { SOLAR_BODIES } = await import("/src/data/solarSystem.ts");
    const { SOLAR_MOONS } = await import("/src/data/solarMoons.ts");
    const { sunVisibility } = await import("/src/utils/sunOcclusion.ts");
    const { SUN_RADIUS } = await import("/src/constants.ts");
    const occ = [
      ...SOLAR_BODIES.filter((b) => b.id !== "earth").map((b) => ({ ...window.__fitz.bodies[b.id], r: b.size })),
      ...SOLAR_MOONS.map((m) => ({ ...window.__fitz.moons[m.id], r: m.size })),
    ];
    return { got: window.__fitz.shipShadow.sunVis.value, want: sunVisibility(window.__fitz.flight, occ, SUN_RADIUS) };
  });
  let beside = await besideRead();
  const lit = await pollUntil(async () => { beside = await besideRead(); return Math.abs(beside.got - beside.want) < 0.02; },
    { timeoutMs: 10_000, intervalMs: 250 });
  const litV = beside.got, besideWant = beside.want;
  checks.check("...and is lit beside it, Earth no longer in the way", lit.ok && besideWant > 0.9,
    `sunVis=${litV}, other bodies leave ${besideWant.toFixed(3)}`);

  // Saturn's rings darken where they pass through Saturn's umbra (L20).
  // Measured on the GPU: right after the ring draws, the same 7x7 pixels are
  // read with the ring's shadow on and then forced off (uNightFloor = 1), from
  // above a ring point seen against empty space, with the ship hidden.
  // Comparing one pixel block with itself cancels the ring's banding and the
  // background, which a sunlit-vs-umbra comparison of two places would not.
  // On the pinned date the Sun is a few degrees above the rings, so the umbra
  // lies across them behind the planet.
  const umbra = await ringShade(page, true);
  checks.check("Saturn's ring goes dark in Saturn's umbra",
    umbra.ok && umbra.ratio < 0.5, JSON.stringify(umbra));
  const sunlit = await ringShade(page, false);
  checks.check("...and keeps full brightness in sunlight",
    sunlit.ok && sunlit.ratio > 0.9, JSON.stringify(sunlit));
}

/**
 * Parks the camera 30u above a point of Saturn's ring (the B ring's core) that
 * is in the planet's umbra (`dark`) or in full sun, on the ring's sunward
 * face, then reads the ring's own pixels with its shadow on and forced off.
 * Returns { ok, ratio = on / off, ... }. The PostFX buffer holds light
 * before the exposure, so its readings are scaled by it.
 */
async function ringShade(page, dark) {
  const setup = await page.evaluate(async (wantDark) => {
    const f = window.__fitz;
    const { sunVisibility } = await import("/src/utils/sunOcclusion.ts");
    const { SUN_RADIUS } = await import("/src/constants.ts");
    const { bodySlot } = await import("/src/components/canvas/sunShadow.ts");
    const ring = f.scene.getObjectByName("BodyRing_saturn");
    if (!ring) return { ok: false, why: "no ring" };
    const V3 = f.camera.position.constructor;
    const occ = f.sunShadow.uOccluders.value;
    const s = occ[bodySlot("saturn")];
    const planet = { x: s.x, y: s.y, z: s.z, r: s.w };
    ring.updateWorldMatrix(true, false);
    const { innerRadius: ri, outerRadius: ro } = ring.geometry.parameters;
    // Mid-strip, 1.755 R: the B ring's opaque core (τ 2.5-5), so almost none
    // of the bright sky behind it (Saturn's exposure) shows through.
    const R = ri + 0.5 * (ro - ri);
    const n = new V3(0, 0, 1).transformDirection(ring.matrixWorld);
    const centre = new V3(planet.x, planet.y, planet.z);
    if (n.dot(centre.clone().negate()) < 0) n.negate(); // the sunward face
    const clear = (a, b) => {
      const ab = b.clone().sub(a);
      for (let i = 0; i < f.sunShadow.uOccluderCount.value; i++) {
        const o = occ[i];
        if (o.w <= 0) continue;
        const c = new V3(o.x, o.y, o.z);
        const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / ab.lengthSq()));
        if (a.clone().addScaledVector(ab, t).distanceTo(c) < o.w * 1.1 + 1) return false;
      }
      return true;
    };
    for (let deg = 0; deg < 360; deg += 3) {
      const phi = (deg * Math.PI) / 180;
      const pt = new V3(R * Math.cos(phi), R * Math.sin(phi), 0).applyMatrix4(ring.matrixWorld);
      const vis = sunVisibility(pt, [planet], SUN_RADIUS);
      if (wantDark ? vis > 0 : vis < 1) continue;
      const cam = pt.clone().addScaledVector(n, 30);
      if (!clear(cam, pt) || !clear(pt, pt.clone().addScaledVector(n, -400))) continue;
      // Ship 4.6 ahead of the camera along the view direction (the chase cam
      // sits 4.6 behind and 1.8 above it), nose at the point.
      const nose = pt.clone().sub(cam).normalize();
      const ship = cam.clone().addScaledVector(nose, 4.6);
      ship.y -= 1.8;
      f.teleport(ship.x, ship.y, ship.z);
      f.setAttitude(Math.atan2(nose.x, nose.z), Math.asin(nose.y));
      window.__ringPt = pt;
      window.__ringCam = cam;
      return { ok: true, deg, vis, sunElevDeg: +(Math.asin(Math.abs(n.dot(centre.clone().negate().normalize()))) * 180 / Math.PI).toFixed(2) };
    }
    return { ok: false, why: "no clear ring point" };
  }, dark);
  if (!setup.ok) return setup;
  // The chase camera eases in; wait until it is parked above the point.
  const parked = await pollUntil(() => page.evaluate(() => window.__fitz.camera.position.distanceTo(window.__ringCam) < 1),
    { timeoutMs: 120_000, intervalMs: 500 });
  if (!parked.ok) return { ok: false, why: "camera never parked", ...setup };
  const read = (floor) => page.evaluate((fl) => new Promise((resolve) => {
    const f = window.__fitz;
    const ring = f.scene.getObjectByName("BodyRing_saturn");
    const hull = [];
    f.scene.traverse((o) => { if (o.isMesh && f.shipShadow.materials.includes(o.material) && o.visible) hull.push(o); });
    for (const o of hull) o.visible = false;
    const u = ring.material.uniforms.uNightFloor;
    const keep = u.value;
    if (fl !== null) u.value = fl;
    let draws = 0;
    ring.onAfterRender = (renderer, _scene, camera) => {
      if (++draws < 2) return;
      ring.onAfterRender = () => {};
      u.value = keep;
      for (const o of hull) o.visible = true;
      const ctx = renderer.getContext();
      const rt = renderer.getRenderTarget();
      const W = rt ? rt.width : ctx.drawingBufferWidth, H = rt ? rt.height : ctx.drawingBufferHeight;
      const v = window.__ringPt.clone().project(camera);
      const cx = Math.round(((v.x + 1) / 2) * W), cy = Math.round(((v.y + 1) / 2) * H);
      const S = 7, float = !!rt && rt.texture.type !== 1009;
      const buf = float ? new Float32Array(S * S * 4) : new Uint8Array(S * S * 4);
      ctx.readPixels(cx - 3, cy - 3, S, S, ctx.RGBA, float ? ctx.FLOAT : ctx.UNSIGNED_BYTE, buf);
      let sum = 0;
      for (let i = 0; i < S * S; i++) sum += buf[i * 4] + buf[i * 4 + 1] + buf[i * 4 + 2];
      const scale = float ? renderer.toneMappingExposure : 1 / 255;
      resolve({ lum: (sum / (S * S)) * scale, onScreen: Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && v.z < 1 });
    };
  }), floor);
  const on = await read(null);
  const off = await read(1);
  const ratio = off.lum > 0 ? on.lum / off.lum : NaN;
  return { ok: on.onScreen && off.lum > 0.005, ratio: Number(ratio.toFixed(3)), on: Number(on.lum.toFixed(4)), off: Number(off.lum.toFixed(4)), ...setup };
}

/** One page each, independent: run.mjs runs them as separate jobs. */
export const parts = [
  ["mechanics: edge", edge, {}],
  ["mechanics: gravity (bodies frozen)", gravity, { emulateReducedMotion: true }],
  ["mechanics: beam", beam, {}],
  ["mechanics: photo mode", photoMode, {}],
  ["mechanics: reduced motion", reducedMotion, { emulateReducedMotion: true }],
  ["mechanics: eclipses (bodies frozen)", eclipses, { emulateReducedMotion: true }],
].map(([label, fn, opts]) => () => withPage({ label, ...opts }, fn));

export default function run() { return runParts(parts); }
