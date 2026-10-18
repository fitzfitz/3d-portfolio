import { withPage, settle, readStore, pollUntil, installEdgeRecorder, readEdgeRecorder, stopEdgeRecorder } from "./harness.mjs";

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
  await installEdgeRecorder(page, 480);
  await page.evaluate(() => { window.__fitz.teleport(460, 0, 0); window.__fitz.setAttitude(Math.PI / 2, 0); });
  await settle(page, 7000); // let the radio go quiet (RADIO_BUSY_S = 6)
  const op = await hazeOpacity(page);
  checks.check("haze thickens near the edge", op > 0.3, `opacity=${op} at r=${(await radius()).toFixed(1)}`);

  // Holding thrust outward past the edge: the burn out-muscles the pilot
  // (40 u/s^2 against 25.2), so the ship is still brought back. The in-page
  // recorder (harness.mjs) timestamps crossing and return per frame, reads the
  // haze opacity in the frame of maximum radius, and remembers any RETURN BURN
  // broadcast. No sim clock is exposed, so "within 6 simulated seconds" is
  // asserted as <= 18 s wall (headless ~3x slow); the 60 s polls are hang guards.
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
  checks.check("the haze is full at 480 (HAZE_MAX_OPACITY 0.92)", rec.maxR > 480 && rec.opAtMax > 0.9 && rec.opAtMax <= 0.92,
    `opacity=${rec.opAtMax} read in the frame of max r=${rec.maxR.toFixed(1)}`);
  checks.check("holding thrust outward at the edge, the ship is still brought back", done.ok && rec.tBack !== null,
    `max r=${rec.maxR.toFixed(1)}, back after ${backS.toFixed(1)}s wall`);
  checks.check("the return takes at most 18 s wall (~6 simulated seconds)", backS <= 18, `${backS.toFixed(1)}s wall`);
  checks.check("the ship stays well inside the validation bounds", rec.maxR < 500, `max r=${rec.maxR.toFixed(1)}`);
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
 * Gravity runs under reduced motion: the planets freeze there (wells still
 * pull, spec §5.2), which makes the geometry deterministic. In headless
 * SwiftShader the ship's simulated time runs ~3x slower than wall time (low
 * fps, 0.05s frame clamp) while planets orbit on wall time, so a moving
 * planet drifts out of a fixed-wall-clock pass. Every wait polls progress.
 */
async function gravity(page, checks) {
  await page.keyboard.press("KeyW");
  const name = "portfolio";
  const relX = () => page.evaluate((n) => window.__fitz.flight.x - window.__fitz.bodies[n].x, name);

  // A W-held pass 34u above the planet's centre, flying +x, until the ship is
  // out the far side of the 56u well.
  await page.evaluate((n) => {
    const b = window.__fitz.bodies[n];
    window.__fitz.teleport(b.x - 90, b.y + 34, b.z);
    window.__fitz.setAttitude(Math.PI / 2, 0);
  }, name);
  let peak = 0, locked = false;
  await page.keyboard.down("KeyW");
  const through = await pollUntil(async () => {
    const r = await page.evaluate(() => ({ s: window.__fitz.flight.speed, l: window.__fitz.store.getState().isOrbitLocked }));
    peak = Math.max(peak, r.s); locked = locked || r.l;
    return (await relX()) > 60;
  }, { timeoutMs: 90_000, intervalMs: 150 });
  await page.keyboard.up("KeyW");
  checks.check("the 34u pass flew through the planet's well", through.ok);
  checks.check("a pass 34u off a planet speeds the ship past cruise", peak > 13, `peak=${peak.toFixed(1)}`);
  checks.check("that pass does not open the dossier", !locked);

  // Straight in: docks.
  await page.evaluate((n) => {
    const b = window.__fitz.bodies[n];
    window.__fitz.teleport(b.x - 60, b.y, b.z);
    window.__fitz.setAttitude(Math.PI / 2, 0);
  }, name);
  await page.keyboard.down("KeyW");
  const docked = await pollUntil(async () => (await readStore(page)).isOrbitLocked, { timeoutMs: 60_000, intervalMs: 200 });
  await page.keyboard.up("KeyW");
  checks.check("a straight-in approach docks and opens the dossier", docked.ok);
  await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
  await settle(page, 2500);

  // Idle 30u from a planet: station-keeping.
  await page.evaluate((n) => { const b = window.__fitz.bodies[n]; window.__fitz.teleport(b.x - 30, b.y + 5, b.z); }, name);
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

  // Shard reel: shard 1 sits at (53, -18, 50); park 22u short of it, facing it.
  const already = (await readStore(page)).shardsCollected.includes(1);
  await page.evaluate(() => { window.__fitz.teleport(53, -18, 28); window.__fitz.setAttitude(0, 0); });
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
  await page.evaluate(() => window.__fitz.teleport(470, 0, 0)); // haze depth ~0.84 (u 0.75 of 440..480)
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
 * Eclipses (docs/UNIVERSE-RULES.md L20, F4), with the planets and moons frozen
 * by reduced motion. Ruangrapi (radius 12) is smaller than the sun (24), so its
 * umbra closes, but only ~115 out (12 x 115 / (24 - 12)); the test point 2.5
 * sizes (30u) out on the far side is deep inside it: full night.
 */
async function eclipses(page, checks) {
  await page.keyboard.press("KeyW");
  const wired = await page.evaluate(() => !!window.__fitz.shipShadow && !!window.__fitz.sunShadow);
  checks.check("the ship's sunVis and the occluder slots are on the debug bridge", wired);
  if (!wired) return;

  // Occluder slots 3-7 are the moons, in MOONS order, at their meshes.
  const moons = await page.evaluate(async () => {
    const { MOONS } = await import("/src/data/moons.ts");
    const { planets } = await import("/src/constants.ts");
    const v = window.__fitz.camera.position.clone();
    const u = window.__fitz.sunShadow;
    return {
      count: u.uOccluderCount.value,
      moons: MOONS.map((m, i) => {
        const mesh = window.__fitz.scene.getObjectByName(`Moon_${m.id}`);
        if (!mesh) return { id: m.id, err: Infinity, dr: Infinity };
        mesh.getWorldPosition(v);
        const s = u.uOccluders.value[3 + i];
        return { id: m.id, err: Math.hypot(s.x - v.x, s.y - v.y, s.z - v.z), dr: Math.abs(s.w - m.size * planets[m.planet].size) };
      }),
    };
  });
  checks.check("all eight occluder slots are in use", moons.count === 8, `count=${moons.count}`);
  checks.check("occluder slots track the moons", moons.moons.every((m) => m.err < 0.01 && m.dr < 1e-6),
    moons.moons.map((m) => `${m.id} ${m.err.toFixed(4)}`).join(", "));

  // Each planet's own slot is skipped: its compiled program says so. Reading
  // the program in use (not the material's key function) also proves the
  // patch survived React and is what three actually compiled.
  const programs = await page.evaluate(async () => {
    const { planets } = await import("/src/constants.ts");
    const { MOONS } = await import("/src/data/moons.ts");
    const gl = window.__fitz.gl, ctx = gl.getContext();
    const used = (mat) => {
      const prog = gl.properties.get(mat).currentProgram;
      return prog ? { key: prog.cacheKey, src: ctx.getShaderSource(prog.fragmentShader) ?? "" } : { key: "", src: "" };
    };
    return {
      planets: planets.map((p, i) => {
        const mesh = window.__fitz.scene.getObjectByName(`Planet_${p.name}`);
        const { key, src } = mesh ? used(mesh.material) : { key: "", src: "" };
        return { name: p.name, key: key.includes(`|sunShadow:fragment:${i}`), self: src.includes(`#define SUN_SHADOW_SELF ${i}\n`),
          gate: src.includes("sunShadowCoverage( sunShadowWorld( geometryPosition ) )"), cityLights: src.includes("uniform vec3 uSunView;") };
      }),
      clouds: (() => {
        const mesh = window.__fitz.scene.getObjectByName("CloudLayer");
        const { key, src } = mesh ? used(mesh.material) : { key: "", src: "" };
        return key.includes("|sunShadow:fragment:0") && src.includes("#define SUN_SHADOW_SELF 0\n");
      })(),
      moons: MOONS.map((m) => {
        const mesh = window.__fitz.scene.getObjectByName(`Moon_${m.id}`);
        const { key, src } = mesh ? used(mesh.material) : { key: "", src: "" };
        return key.includes("|sunShadow:object:-1") && src.includes("directLight.color *= uSunVis;");
      }),
      ship: window.__fitz.shipShadow.materials.map((mat) => {
        const { key, src } = used(mat);
        return key.includes("|sunShadow:object:-1") && src.includes("directLight.color *= uSunVis;");
      }),
    };
  });
  checks.check("a planet does not shadow itself (its own slot is compiled out)",
    programs.planets.every((p) => p.key && p.self && p.gate), JSON.stringify(programs.planets));
  checks.check("Ruangrapi keeps its night-side city lights alongside the shadow", programs.planets[0]?.cityLights === true);
  checks.check("Ruangrapi's clouds darken in the same shadows (its slot skipped)", programs.clouds === true);
  checks.check("every moon draws with its object-mode shadow program", programs.moons.every(Boolean), JSON.stringify(programs.moons));
  checks.check("every ship hull material draws with its shadow program",
    programs.ship.length > 0 && programs.ship.every(Boolean), `materials=${programs.ship.length} ${JSON.stringify(programs.ship)}`);

  // The ship in Ruangrapi's umbra, then beside it.
  const place = (side) => page.evaluate(async (s) => {
    const { planets } = await import("/src/constants.ts");
    const size = planets.find((p) => p.name === "ruangrapi").size;
    const b = window.__fitz.bodies.ruangrapi;
    const r = Math.hypot(b.x, b.y, b.z);
    const ux = b.x / r, uy = b.y / r, uz = b.z / r;
    const h = Math.hypot(ux, uz), sx = -uz / h, sz = ux / h;
    window.__fitz.teleport(b.x + ux * size * 2.5 + sx * size * 4 * s, b.y + uy * size * 2.5, b.z + uz * size * 2.5 + sz * size * 4 * s);
  }, side);
  const sunVis = () => page.evaluate(() => window.__fitz.shipShadow.sunVis.value);
  await place(0);
  const dark = await pollUntil(async () => (await sunVis()) < 0.05, { timeoutMs: 10_000, intervalMs: 250 });
  const darkV = await sunVis();
  checks.check("the ship goes dark in a planet's umbra", dark.ok, `sunVis=${darkV}`);
  await place(1);
  const lit = await pollUntil(async () => (await sunVis()) > 0.95, { timeoutMs: 10_000, intervalMs: 250 });
  const litV = await sunVis();
  checks.check("...and is fully lit beside it", lit.ok, `sunVis=${litV}`);

  // Ruangrapi's ring darkens where it passes through the planet's umbra.
  // Measured on the GPU: right after the ring draws, the same 7x7 pixels are
  // read with the ring's shadow on and then forced off (uNightFloor = 1), from
  // straight above a ring point seen against empty space, with the ship hidden.
  // Comparing one pixel block with itself cancels the ring's banding and the
  // background, which a sunlit-vs-umbra comparison of two places would not.
  const umbra = await ringShade(page, true);
  checks.check("Ruangrapi's ring goes dark in the planet's umbra",
    umbra.ok && umbra.ratio < 0.5, JSON.stringify(umbra));
  const sunlit = await ringShade(page, false);
  checks.check("...and keeps full brightness in sunlight",
    sunlit.ok && sunlit.ratio > 0.9, JSON.stringify(sunlit));
}

/**
 * Parks the camera 30u above a point of Ruangrapi's ring that is in the
 * planet's umbra (`dark`) or in full sun, then reads the ring's own pixels
 * with its shadow on and forced off. Returns { ok, ratio = on / off, ... }.
 */
async function ringShade(page, dark) {
  const setup = await page.evaluate(async (wantDark) => {
    const f = window.__fitz;
    const { sunVisibility } = await import("/src/utils/sunOcclusion.ts");
    const { SUN_RADIUS } = await import("/src/constants.ts");
    const ring = f.scene.getObjectByName("PlanetRing_ruangrapi");
    if (!ring) return { ok: false, why: "no ring" };
    const V3 = f.camera.position.constructor;
    const occ = f.sunShadow.uOccluders.value;
    const planet = { x: occ[0].x, y: occ[0].y, z: occ[0].z, r: occ[0].w };
    ring.updateWorldMatrix(true, false);
    const { innerRadius: ri, outerRadius: ro } = ring.geometry.parameters;
    const R = ri + 0.35 * (ro - ri);
    const n = new V3(0, 0, 1).transformDirection(ring.matrixWorld);
    if (n.y < 0) n.negate();
    const clear = (a, b) => {
      const ab = b.clone().sub(a);
      for (const o of occ) {
        if (o.w <= 0) continue;
        const c = new V3(o.x, o.y, o.z);
        const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / ab.lengthSq()));
        if (a.clone().addScaledVector(ab, t).distanceTo(c) < o.w + 1) return false;
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
      // sits 4.6 behind and 1.8 above it), nose straight down at the point.
      const nose = pt.clone().sub(cam).normalize();
      const ship = cam.clone().addScaledVector(nose, 4.6);
      ship.y -= 1.8;
      f.teleport(ship.x, ship.y, ship.z);
      f.setAttitude(Math.atan2(nose.x, nose.z), Math.asin(nose.y));
      window.__ringPt = pt;
      window.__ringCam = cam;
      return { ok: true, deg, vis };
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
    const ring = f.scene.getObjectByName("PlanetRing_ruangrapi");
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
      resolve({ lum: sum / (S * S) / (float ? 1 : 255), onScreen: Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && v.z < 1 });
    };
  }), floor);
  const on = await read(null);
  const off = await read(1);
  const ratio = off.lum > 0 ? on.lum / off.lum : NaN;
  return { ok: on.onScreen && off.lum > 0.02, ratio: Number(ratio.toFixed(3)), on: Number(on.lum.toFixed(4)), off: Number(off.lum.toFixed(4)), ...setup };
}

export default async function run() {
  const checks = await withPage({ label: "mechanics: edge" }, edge);
  for (const [label, fn, opts] of [
    ["mechanics: gravity (planets frozen)", gravity, { emulateReducedMotion: true }],
    ["mechanics: beam", beam, {}],
    ["mechanics: photo mode", photoMode, {}],
    ["mechanics: reduced motion", reducedMotion, { emulateReducedMotion: true }],
    ["mechanics: eclipses (planets frozen)", eclipses, { emulateReducedMotion: true }],
  ]) {
    const c = await withPage({ label, ...opts }, fn);
    checks.results.push(...c.results);
  }
  return checks;
}
