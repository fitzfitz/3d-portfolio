import { withPage, settle, readStore, pollUntil, installEdgeRecorder, readEdgeRecorder, stopEdgeRecorder } from "./harness.mjs";

/** src/constants.ts SYSTEM_RADIUS (3,600 since the real Solar System, Task 6). */
const EDGE = 3600;

const hazeOpacity = (page) => page.evaluate(() => Number(document.querySelector('[data-testid="edge-haze"]')?.style.opacity ?? "0"));
/** Faces the ship at a world point (yaw only) and ends the spawn auto-aim. */
const face = (page, x, z) => page.evaluate((tx, tz) => {
  const f = window.__fitz.flight;
  window.__fitz.setAttitude(Math.atan2(tx - f.x, tz - f.z), 0);
}, x, z);
/** Parks the ship in deep space and puts crystal slot 0 20u ahead of it. */
const crystalAhead = (page) => page.evaluate(() => {
  window.__fitz.teleport(150, 60, 150);
  window.__fitz.setAttitude(0, 0);
  Object.assign(window.__fitz.crystals[0], { x: 150, y: 60, z: 170, active: true });
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
  await crystalAhead(page);
  await settle(page, 1000);
  const programsBefore = await page.evaluate(() => window.__fitz.gl.info.programs.length);
  await page.keyboard.down("KeyF");
  const got = await pollUntil(() => page.evaluate(() => !window.__fitz.crystals[0].active), { timeoutMs: 10_000, intervalMs: 200 });
  const during = await page.evaluate(() => ({
    programs: window.__fitz.gl.info.programs.length,
    calls: window.__fitz.perfStats.calls,
    cone: window.__fitz.scene.getObjectByName("TractorBeamCone")?.visible === true,
  }));
  await page.keyboard.up("KeyF");
  checks.check("holding F pulls in and collects a crystal 20u ahead", got.ok);
  checks.check("the beam cone shows while F is held", during.cone);
  checks.check("the beam adds no shader program", during.programs === programsBefore,
    `before=${programsBefore} during=${during.programs}`);
  checks.check("draw calls stay within the close-approach ceiling with the beam on", during.calls <= 110, `calls=${during.calls}`);

  // Mining: park 8u from a main-belt pebble, facing it.
  await page.evaluate(() => {
    const w = window.__fitz.mining.rings[0].world;
    window.__fitz.teleport(w[0], w[1], w[2] - 8);
  });
  const target = await page.evaluate(() => { const w = window.__fitz.mining.rings[0].world; return { x: w[0], z: w[2] }; });
  await face(page, target.x, target.z);
  await page.keyboard.down("KeyF");
  const ore = await pollUntil(() => page.evaluate(() => {
    const el = document.querySelector('[data-testid="hud-ore"]');
    return !!el && el.style.display !== "none" && /ORE \d+\/16/.test(el.textContent ?? "");
  }), { timeoutMs: 15_000, intervalMs: 250 });
  await page.keyboard.up("KeyF");
  checks.check("mining a belt pebble shows the ORE readout", ore.ok);

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
  await crystalAhead(page);
  await page.keyboard.down("KeyF");
  const got = await pollUntil(() => page.evaluate(() => !window.__fitz.crystals[0].active), { timeoutMs: 10_000, intervalMs: 200 });
  await page.keyboard.up("KeyF");
  checks.check("reduced motion: the beam still pulls a crystal", got.ok);
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

  // Occluder slots 0-7 are the bodies but the outermost, in BODY_IDS order, at their centres (updateBodies).
  const slots = await page.evaluate(async () => {
    const { SOLAR_BODIES } = await import("/src/data/solarSystem.ts");
    const { bodySlot } = await import("/src/components/canvas/sunShadow.ts");
    const u = window.__fitz.sunShadow;
    return {
      count: u.uOccluderCount.value,
      bodies: SOLAR_BODIES.filter((b) => bodySlot(b.id) >= 0).map((b) => {
        const s = u.uOccluders.value[bodySlot(b.id)], c = window.__fitz.bodies[b.id];
        return { id: b.id, err: Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z), dr: Math.abs(s.w - b.size) };
      }),
    };
  });
  checks.check("the eight GPU occluder slots are in use (every body but the outermost; moons from Task 14)", slots.count === 8, `count=${slots.count}`);
  checks.check("occluder slots track the bodies", slots.bodies.length === 8 && slots.bodies.every((b) => b.err < 0.01 && b.dr < 1e-6),
    slots.bodies.map((b) => `${b.id} ${b.err.toFixed(4)}`).join(", "));

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
  // Beside Earth, only the other bodies can cover the sun. On the pinned date
  // (2026-10-20) Venus is four days from inferior conjunction and covers part
  // of the drawn (enlarged) Sun from Earth's neighbourhood, so the expectation
  // is the CPU sunVisibility against every body but Earth, not a bare 1.
  const besideRead = () => page.evaluate(async () => {
    const { SOLAR_BODIES } = await import("/src/data/solarSystem.ts");
    const { sunVisibility } = await import("/src/utils/sunOcclusion.ts");
    const { SUN_RADIUS } = await import("/src/constants.ts");
    const occ = SOLAR_BODIES.filter((b) => b.id !== "earth").map((b) => ({ ...window.__fitz.bodies[b.id], r: b.size }));
    return { got: window.__fitz.shipShadow.sunVis.value, want: sunVisibility(window.__fitz.flight, occ, SUN_RADIUS) };
  });
  let beside = await besideRead();
  const lit = await pollUntil(async () => { beside = await besideRead(); return Math.abs(beside.got - beside.want) < 0.02; },
    { timeoutMs: 10_000, intervalMs: 250 });
  const litV = beside.got, besideWant = beside.want;
  checks.check("...and is lit beside it, Earth no longer in the way", lit.ok && besideWant > 0.9,
    `sunVis=${litV}, other bodies leave ${besideWant.toFixed(3)}`);

  // The ring-in-umbra pixel check measured Earth's fictional ring, which is
  // gone (Task 6). Saturn's rings take it back once their normal is Saturn's
  // pole (Task 15): under the interim tilt the Sun can sit in their plane, so
  // a sunlit reference read is not reliable yet. tests/ringShadow.test.ts
  // keeps the shading maths covered.
}

export default async function run() {
  const checks = await withPage({ label: "mechanics: edge" }, edge);
  for (const [label, fn, opts] of [
    ["mechanics: gravity (bodies frozen)", gravity, { emulateReducedMotion: true }],
    ["mechanics: beam", beam, {}],
    ["mechanics: photo mode", photoMode, {}],
    ["mechanics: reduced motion", reducedMotion, { emulateReducedMotion: true }],
    ["mechanics: eclipses (bodies frozen)", eclipses, { emulateReducedMotion: true }],
  ]) {
    const c = await withPage({ label, ...opts }, fn);
    checks.results.push(...c.results);
  }
  return checks;
}
