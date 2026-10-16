import { withPage, settle, readStore, pollUntil } from "./harness.mjs";

const pools = (page) => page.evaluate(async () => (await import("/src/data/chatterLines.ts")).chatterPools);
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
  const P = await pools(page);
  await page.keyboard.press("KeyW"); // first input
  await page.evaluate(() => { window.__fitz.teleport(238, 0, 0); window.__fitz.setAttitude(Math.PI / 2, 0); });
  await settle(page, 7000); // let the radio go quiet (RADIO_BUSY_S = 6)
  const op = await hazeOpacity(page);
  checks.check("haze thickens near the edge", op > 0.5, `opacity=${op}`);

  let flashed = false;
  await page.keyboard.down("KeyW");
  const crossed = await pollUntil(async () => {
    const r = await page.evaluate(() => ({ x: window.__fitz.flight.x, flash: window.__fitz.store.getState().isTeleporting }));
    flashed = flashed || r.flash;
    return r.x < 0;
  }, { timeoutMs: 20_000, intervalMs: 100 });
  await page.keyboard.up("KeyW");
  checks.check("the ship crosses the seam", crossed.ok);
  checks.check("the wrap fires no teleport flash", !flashed);
  const opFar = await hazeOpacity(page);
  checks.check("the far side of the seam is still deep haze", opFar > 0.7, `opacity=${opFar}`);
  const line = (await readStore(page)).broadcast;
  checks.check("a haze line played, silently", !!line && P.haze.includes(line.text) && line.silent === true,
    `broadcast=${JSON.stringify(line)}`);
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
  await page.evaluate(() => window.__fitz.teleport(240, 0, 0));
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
 * by reduced motion. Ruangrapi (16 across, the sun 8) is bigger than the sun,
 * so its umbra never closes: 2.5 sizes out on the far side is full night.
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
