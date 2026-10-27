import { writeFile } from "node:fs/promises";
import {
  withPage, runParts, settle, nextFrames, pollUntil, readStore, toDeepSpace, chatterText, lockFullFidelity,
  isFontHost, respondInertFont,
} from "./harness.mjs";

// The Nest (spec docs/archive/specs/2026-10-27-combat-design.md), five
// independent pages, one job each (run.mjs PARTS):
//  0. away: nothing of the fight exists or downloads in deep space, the radar
//     shows only the Nest's rim marker, and a click makes a plasma spark as always;
//  1. the fight: near the Nest the on-demand models load and warm; crossing
//     the zone shows ENTERING THE NEST and wave 1's 3 saucers (on screen,
//     screenshot); held fire defeats one; a click there fires a bolt, not a
//     spark; saucer bolts take the hull down; a tardigrade's jet is caught
//     mid-fire (screenshot); a breach tows the ship to the buoy with hull 60;
//     clearing the Nest gives the `nest` badge; the warp hold inside the
//     fighting area; the radar's red Nest marker in range;
//  2. the perf state "In the Nest (wave 3)" (SwiftShader, full fidelity, the
//     debug formation), against docs/PERF-BUDGETS.md's ceilings;
//  3. reduced motion: uMotion 0, and the hull-hit flash a static tint;
//  4. offline (Ruling C22): the on-demand models blocked, the HUD says
//     NEST OFFLINE and no wave ever starts.
// Screenshots go to $SCRATCH (default /tmp) as combat-*.png.

const OUT = process.env.SCRATCH ?? "/tmp";

// "In the Nest (wave 3)": 6 serial runs alone on the machine (SwiftShader,
// 2026-10-27) read the same, 46 / 257,690 / 61; calls and triangles + 15%
// rounded up to ten, programs + 1. See docs/PERF-BUDGETS.md.
const NEST_CALLS_CEILING = 60; // baseline 46
const NEST_TRIS_CEILING = 296350; // baseline 257690
const NEST_PROGRAMS_CEILING = 62; // baseline 61 (the smoke's program included)

const ONDEMAND = /\/models-ondemand\//;
/**
 * initScript: the dev server's module requests fill the default 250-entry
 * resource timeline long before the Nest loads, so the glbs would never be
 * listed. A large buffer keeps the whole page's timeline readable.
 */
const FULL_TIMELINE = "performance.setResourceTimingBufferSize(100000)";
const NEST_RED = [0xff, 0x3b, 0x4a];

const inPage = (page, fn, arg) => page.evaluate(fn, arg);
const nest = (page) => inPage(page, () => {
  const n = window.__fitz.nest.combat.nest;
  const live = (l) => l.filter((m) => m.alive).length;
  return {
    phase: n.phase, wave: n.wave, hp: n.hull.hp, frozen: n.frozen,
    saucers: live(n.saucers), tardigrades: live(n.tardigrades),
    saucerPhases: n.saucers.map((s) => s.phase), tardigradePhases: n.tardigrades.map((t) => t.phase),
    warm: window.__fitz.nest.combat.warm, loadFailed: window.__fitz.nest.combat.loadFailed,
    inArea: window.__fitz.nest.combat.inArea, hits: window.__fitz.nest.combat.hits,
  };
});
const ship = (page) => inPage(page, () => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const teleport = (page, p) => inPage(page, (q) => window.__fitz.teleport(q.x, q.y, q.z), p);
const testIdText = (page, id) => inPage(page, (t) => document.querySelector(`[data-testid="${t}"]`)?.textContent ?? null, id);
const shown = (page, id) => inPage(page, (t) => {
  const el = document.querySelector(`[data-testid="${t}"]`);
  return !!el && getComputedStyle(el).display !== "none" && el.closest("[style*='display: none']") === null;
}, id);

/** The Nest's places, read from the app's own module: the centre, the unit vector toward the Sun, the tow pose. */
const nestData = (page) => inPage(page, async () => {
  const { NEST_CENTRE, NEST_TOW_POSE } = await import("/src/data/nest.ts");
  const [x, y, z] = NEST_CENTRE;
  const l = Math.hypot(x, y, z);
  return { c: { x, y, z }, toSun: { x: -x / l, y: -y / l, z: -z / l }, tow: NEST_TOW_POSE };
});
/** A point `r` u from the centre on the buoy's (the Sun's) side. */
const at = (D, r) => ({ x: D.c.x + D.toSun.x * r, y: D.c.y + D.toSun.y * r, z: D.c.z + D.toSun.z * r });

/** Yaw and pitch that put the nose on `p` (pitchFlight.ts headingToward, noseDirection). */
const aimAt = (page, p, yawOffset = 0) => inPage(page, ({ q, off }) => {
  const f = window.__fitz.flight;
  const dx = q.x - f.x, dy = q.y - f.y, dz = q.z - f.z;
  window.__fitz.setAttitude(Math.atan2(dx, dz) + off, Math.asin(dy / (Math.hypot(dx, dy, dz) || 1)));
}, { q: p, off: yawOffset });

/** Resource URLs fetched so far that match the on-demand folder (the page's whole resource timeline). */
const ondemandFetched = (page) => inPage(page, () =>
  performance.getEntriesByType("resource").map((e) => e.name).filter((u) => u.includes("/models-ondemand/")));

/** Pixels on the radar canvas in the Nest's red (its marker, zone ring and monster blips). */
const radarRed = (page) => inPage(page, (red) => {
  const cv = document.querySelector('[data-testid="radar-canvas"]');
  const ctx = cv?.getContext("2d");
  if (!ctx) return -1;
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 100) continue;
    if (Math.abs(data[i] - red[0]) <= 16 && Math.abs(data[i + 1] - red[1]) <= 24 && Math.abs(data[i + 2] - red[2]) <= 24) n++;
  }
  return n;
}, NEST_RED);

/**
 * Each Nest-red radar pixel's distance from the canvas centre, in CSS px (the
 * radar is 148 CSS px, its rim marker 65 px out: spec 2026-10-27-nest-playable §1).
 */
const radarRedDistances = (page) => inPage(page, (red) => {
  const cv = document.querySelector('[data-testid="radar-canvas"]');
  const ctx = cv?.getContext("2d");
  if (!ctx) return null;
  const k = cv.width / cv.clientWidth; // device px per CSS px
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  const out = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 100) continue;
    if (Math.abs(data[i] - red[0]) <= 16 && Math.abs(data[i + 1] - red[1]) <= 24 && Math.abs(data[i + 2] - red[2]) <= 24) {
      const p = i / 4, x = (p % cv.width) + 0.5, y = Math.floor(p / cv.width) + 0.5;
      out.push(Math.hypot(x - cv.width / 2, y - cv.height / 2) / k);
    }
  }
  return out;
}, NEST_RED);

/**
 * Where the radar should draw the Nest, by RadarMap's own maths
 * (nestRadarSpot, from the ship's live position and heading), in CSS px from
 * the canvas's top left, and the nearest red-dominant pixel to it (any alpha
 * above 0, so a dot blended over another blip still counts).
 */
const radarNestSpot = (page) => inPage(page, async () => {
  const { nestRadarSpot } = await import("/src/utils/combat/nestHud.ts");
  const { NEST_CENTRE } = await import("/src/data/nest.ts");
  const { RADAR_RANGE } = await import("/src/utils/radarTransform.ts");
  const cv = document.querySelector('[data-testid="radar-canvas"]');
  const ctx = cv?.getContext("2d");
  if (!ctx) return null;
  const f = window.__fitz.flight;
  const c = cv.clientWidth / 2, rimR = c - 6; // RadarMap: c = SIZE / 2, rimR = c - 6
  const spot = nestRadarSpot(NEST_CENTRE[0] - f.x, NEST_CENTRE[1] - f.y, NEST_CENTRE[2] - f.z, f.heading,
    rimR / RADAR_RANGE, rimR, { px: 0, py: 0, onRim: false });
  const ex = c + spot.px, ey = c + spot.py;
  const k = cv.width / cv.clientWidth; // device px per CSS px
  const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
  let nearest = Infinity;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] === 0 || !(r > 150 && r - g > 80 && r - b > 80)) continue;
    const p = i / 4, x = ((p % cv.width) + 0.5) / k, y = (Math.floor(p / cv.width) + 0.5) / k;
    nearest = Math.min(nearest, Math.hypot(x - ex, y - ey));
  }
  return { onRim: spot.onRim, x: +ex.toFixed(1), y: +ey.toFixed(1), nearest: Number.isFinite(nearest) ? +nearest.toFixed(2) : null };
});

/** Each live monster's place on screen (NDC), from the live camera; `on` when inside the frame and in front. */
const onScreen = (page) => inPage(page, () => {
  const cam = window.__fitz.camera;
  const v = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
  const n = window.__fitz.nest.combat.nest;
  return [...n.saucers, ...n.tardigrades].filter((m) => m.alive).map((m) => {
    const x = v[0] * m.x + v[4] * m.y + v[8] * m.z + v[12];
    const y = v[1] * m.x + v[5] * m.y + v[9] * m.z + v[13];
    const z = v[2] * m.x + v[6] * m.y + v[10] * m.z + v[14];
    const cx = p[0] * x + p[4] * y + p[8] * z + p[12];
    const cy = p[1] * x + p[5] * y + p[9] * z + p[13];
    const w = p[3] * x + p[7] * y + p[11] * z + p[15];
    const nx = cx / w, ny = cy / w;
    return { nx: +nx.toFixed(2), ny: +ny.toFixed(2), on: z < 0 && Math.abs(nx) < 1 && Math.abs(ny) < 1 };
  });
});

const effects = (page) => inPage(page, () => window.__fitz.nestRender?.effects() ?? null);
const instances = (page) => inPage(page, () => window.__fitz.nestRender?.instances() ?? null);
const programs = (page) => inPage(page, () => window.__fitz.gl.info.programs.length);

async function shot(page, name, checks, what) {
  const path = `${OUT}/combat-${name}.png`;
  try {
    await writeFile(path, Buffer.from(await page.screenshot({ encoding: "base64" }), "base64"));
    checks.note(what, path);
  } catch (e) {
    checks.note(what, `screenshot failed: ${e.message}`);
  }
}

/** Flies to 150 u out on the buoy's side and waits for the on-demand models to load and warm. */
async function approach(page, D, timeoutMs = 30_000) {
  await teleport(page, at(D, 150));
  await nextFrames(page, 3);
  return pollUntil(async () => {
    const urls = await ondemandFetched(page);
    const warm = await inPage(page, () => window.__fitz.nest?.combat.warm === true);
    return warm && urls.some((u) => u.endsWith("saucer.glb")) && urls.some((u) => u.endsWith("tardigrade.glb")) ? urls : null;
  }, { timeoutMs, intervalMs: 250 });
}

/** Crosses the 70 u zone inward (from 150 u out, to 60 u). */
async function enter(page, D) {
  await teleport(page, at(D, 150));
  await nextFrames(page, 3);
  await teleport(page, at(D, 60));
}

// ── 0. Away from the Nest ──────────────────────────────────────────────────
async function away(page, checks) {
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await toDeepSpace(page);
  await nextFrames(page, 4);

  const fetched = await ondemandFetched(page);
  checks.check("away: no /models-ondemand/ request since the page loaded",
    fetched.length === 0 && !requests.some((u) => ONDEMAND.test(u)), JSON.stringify([...fetched, ...requests.filter((u) => ONDEMAND.test(u))]));
  const state = await nest(page);
  checks.check("away: no live monster", state.saucers === 0 && state.tardigrades === 0
    && [...state.saucerPhases, ...state.tardigradePhases].every((p) => p === "gone"), JSON.stringify(state));
  const mounted = await inPage(page, () => ({ group: !!window.__fitz.scene.getObjectByName("Nest"), render: !!window.__fitz.nestRender }));
  checks.check("away: the Nest's load gate has not mounted anything", !mounted.group && !mounted.render, JSON.stringify(mounted));
  const s = await readStore(page);
  checks.check("away: not in the Nest (store inNest false, wave 0)", s.inNest === false && s.wave === 0 && !state.inArea,
    `inNest=${s.inNest} wave=${s.wave} inArea=${state.inArea}`);
  // Out of range, the Nest is a dimmed dot on the rim (no zone ring, no
  // monster blips). Presence: a red pixel right where nestRadarSpot puts it.
  // Absence: no Nest-red pixel inside the rim band (a ring or a blip would be).
  const rim = await radarNestSpot(page);
  checks.check("away: the radar draws the Nest's rim marker where nestRadarSpot puts it",
    rim !== null && rim.onRim && rim.nearest !== null && rim.nearest <= 4, JSON.stringify(rim));
  const reds = await radarRedDistances(page);
  const nearest = reds?.length ? Math.min(...reds) : null;
  checks.check("away: no Nest zone ring or monster blip on the radar (no Nest red under 55 CSS px from the centre)",
    reds !== null && (nearest === null || nearest >= 55),
    `red pixels=${reds?.length ?? "no canvas"} nearest=${nearest?.toFixed(1) ?? "none"} CSS px from the centre`);

  const before = await inPage(page, () => window.__fitz.anomalies?.filter((a) => a.active).length ?? -1);
  await inPage(page, () => {
    const canvas = document.querySelector("canvas[data-engine]") ?? [...document.querySelectorAll("canvas")].at(-1);
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent("pointerdown",
      { clientX: r.left + r.width * 0.35, clientY: r.top + r.height * 0.4, bubbles: true, pointerId: 1 }));
  });
  const spark = await pollUntil(() => inPage(page, (b) => (window.__fitz.anomalies?.filter((a) => a.active).length ?? -1) > b, before),
    { timeoutMs: 3000, intervalMs: 100 });
  const bolts = await inPage(page, () => window.__fitz.nest.combat.nest.bolts.bolts.filter((b) => b.live).length);
  checks.check("away: a click makes a plasma spark (and fires nothing)", spark.ok && bolts === 0, `before=${before} bolts=${bolts}`);
}

// ── 1. The fight ───────────────────────────────────────────────────────────
async function fight(page, checks) {
  const D = await nestData(page);

  // Near: the models load (both glbs) and warm.
  const loaded = await approach(page, D);
  checks.check("near (150 u): both on-demand glbs load and the Nest warms", loaded.ok, JSON.stringify(loaded.value ?? await nest(page)));
  await nextFrames(page, 3);
  const red = await radarRed(page);
  checks.check("near: the radar shows the red Nest marker", red >= 6, `red pixels=${red}`);
  const programsBefore = await programs(page);

  // Enter: the banner, then wave 1's 3 saucers.
  await teleport(page, at(D, 60));
  const banner = await pollUntil(async () => ((await testIdText(page, "nest-banner-title")) === "ENTERING THE NEST" && await shown(page, "nest-banner")),
    { timeoutMs: 3000, intervalMs: 50 });
  const sub = await testIdText(page, "nest-banner-sub");
  checks.check("crossing the zone shows ENTERING THE NEST over CONTACT IN", banner.ok && /^CONTACT IN/.test(sub ?? ""), `sub=${sub}`);
  const w1 = await pollUntil(async () => { const s = await readStore(page); return s.wave === 1 && s.contacts === 3; },
    { timeoutMs: 10_000, intervalMs: 100 });
  const s1 = await readStore(page);
  checks.check("wave 1 spawns 3 saucers", w1.ok && (await nest(page)).saucers === 3, `wave=${s1.wave} contacts=${s1.contacts}`);
  // The HUD's rAF loop writes the wave line on its next frame.
  await pollUntil(async () => (await testIdText(page, "hud-nest-wave")) === "WAVE 1/3 · CONTACTS 3", { timeoutMs: 2000, intervalMs: 50 });
  checks.check("in the fighting area: store inNest, the hull row and the wave line show",
    s1.inNest === true && await shown(page, "hud-hull-label") && (await testIdText(page, "hud-nest-wave")) === "WAVE 1/3 · CONTACTS 3",
    `inNest=${s1.inNest} wave line=${await testIdText(page, "hud-nest-wave")}`);

  // The fixed formation, on screen.
  await inPage(page, () => window.__fitz.nest.formation());
  await nextFrames(page, 4);
  const screen = await onScreen(page);
  const drawn = await instances(page);
  checks.check("wave 1's saucers are on screen", screen.length === 3 && screen.every((m) => m.on), JSON.stringify(screen));
  checks.check("the monster meshes draw instances", (drawn ?? []).reduce((a, m) => a + m.count, 0) >= 3, JSON.stringify(drawn));
  await shot(page, "wave1", checks, "wave 1's saucers on screen");

  // Fire: aim at the first saucer and hold F until it is defeated.
  const first = await inPage(page, () => { const s = window.__fitz.nest.combat.nest.saucers.find((m) => m.alive); return { x: s.x, y: s.y, z: s.z }; });
  await aimAt(page, first);
  await nextFrames(page, 3);
  await page.keyboard.down("KeyF");
  const defeated = await pollUntil(async () => (await readStore(page)).contacts === 2, { timeoutMs: 10_000, intervalMs: 100 });
  await page.keyboard.up("KeyF");
  const after = await nest(page);
  checks.check("holding F defeats a saucer (contacts 3 → 2)", defeated.ok && after.saucerPhases.includes("defeated"),
    JSON.stringify(after.saucerPhases));

  // A click inside the fighting area fires a bolt, not a spark.
  await nextFrames(page, 20); // the held-fire bolts run out (160 u at 140 u/s)
  const sparks0 = await inPage(page, () => window.__fitz.anomalies?.filter((a) => a.active).length ?? -1);
  const shots0 = await inPage(page, () => window.__fitz.nest.combat.nest.bolts.bolts.filter((b) => b.live && b.owner === "ship").length);
  await inPage(page, () => {
    const canvas = document.querySelector("canvas[data-engine]") ?? [...document.querySelectorAll("canvas")].at(-1);
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent("pointerdown",
      { clientX: r.left + r.width * 0.3, clientY: r.top + r.height * 0.3, bubbles: true, pointerId: 1 }));
  });
  const bolt = await pollUntil(() => inPage(page, (n0) =>
    window.__fitz.nest.combat.nest.bolts.bolts.filter((b) => b.live && b.owner === "ship").length > n0, shots0),
  { timeoutMs: 2000, intervalMs: 30 });
  const sparks1 = await inPage(page, () => window.__fitz.anomalies?.filter((a) => a.active).length ?? -1);
  checks.check("in the Nest a click fires a bolt, not a spark", bolt.ok && sparks1 <= sparks0, `bolt=${bolt.ok} sparks ${sparks0} → ${sparks1}`);

  // Take hits: the AI resumes; sitting still, the saucers' bolts land.
  await inPage(page, () => window.__fitz.nest.resume());
  const hit = await pollUntil(async () => (await nest(page)).hp < 100, { timeoutMs: 20_000, intervalMs: 100 });
  // The HUD's rAF loop writes the bar on its next frame.
  const bar = (await pollUntil(() => inPage(page, () => {
    const el = document.querySelector('[data-testid="hud-hull-bar"]');
    const b = el ? { display: el.style.display, width: parseFloat(el.style.width) } : null;
    return b && b.display !== "none" && b.width < 100 ? b : null;
  }), { timeoutMs: 2000, intervalMs: 50 })).value;
  checks.check("saucer bolts take the hull down", hit.ok, `hp=${(await nest(page)).hp.toFixed(1)}`);
  checks.check("the hull bar shows and drops below full", !!bar, JSON.stringify(bar));

  // Wave 3: catch the tardigrade's jet mid-fire, the hull kept up so no breach comes first.
  await inPage(page, () => window.__fitz.nest.startWave(3));
  const jet = await pollUntil(async () => {
    const t = await inPage(page, () => {
      window.__fitz.nest.setHull(100);
      const g = window.__fitz.nest.combat.nest.tardigrades[0];
      return { phase: g.phase, alive: g.alive, x: g.x, y: g.y, z: g.z };
    });
    if (t.phase === "jet") return t;
    // Nose a little off the tardigrade, so the jet crosses the frame.
    if (t.alive) await aimAt(page, t, 0.25);
    return null;
  }, { timeoutMs: 20_000, intervalMs: 50 });
  const jetFx = await effects(page);
  const jetDrawn = (jetFx ?? []).find((e) => e.name === "NestJet")?.count ?? 0;
  checks.check("a tardigrade fires its jet in wave 3", jet.ok, JSON.stringify((await nest(page)).tardigradePhases));
  checks.check("the jet draws while it fires", jetDrawn > 0, JSON.stringify(jetFx));
  await shot(page, "jet", checks, "a tardigrade jet mid-fire, from the chase camera (sprites near the camera fade out)");
  // Side-on: the AI frozen mid-jet (the jet holds, its particles still), the
  // ship 30 u off the jet's midpoint, square to its axis, nose on the
  // midpoint; the chase camera gets a second to settle after the teleport.
  // This jet, if it is still firing, or the next one.
  const side = await pollUntil(async () => {
    const placed = await inPage(page, () => {
      window.__fitz.nest.setHull(100);
      const g = window.__fitz.nest.combat.nest.tardigrades[0];
      if (!g.alive || g.phase !== "jet") return false;
      window.__fitz.nest.combat.nest.frozen = true;
      const l = Math.hypot(g.jdx, g.jdy, g.jdz) || 1;
      const d = { x: g.jdx / l, y: g.jdy / l, z: g.jdz / l };
      const mid = { x: g.jx + d.x * 25, y: g.jy + d.y * 25, z: g.jz + d.z * 25 };
      // Square to the axis, level: world up × axis.
      let sx = d.z, sz = -d.x;
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl; sz /= sl;
      const at = { x: mid.x + sx * 30, y: mid.y, z: mid.z + sz * 30 };
      window.__fitz.teleport(at.x, at.y, at.z);
      window.__fitz.setAttitude(Math.atan2(mid.x - at.x, mid.z - at.z), 0);
      return true;
    });
    if (!placed) return false;
    await nextFrames(page, 60);
    return inPage(page, () => window.__fitz.nest.combat.nest.tardigrades[0].phase === "jet"
      && (window.__fitz.nestRender?.effects().find((e) => e.name === "NestJet")?.count ?? 0) > 0);
  }, { timeoutMs: 20_000, intervalMs: 30 });
  checks.check("the jet seen side-on (nose square to its axis) still draws", side.ok);
  await shot(page, "jet-side", checks, "a tardigrade jet mid-fire, side-on (AI frozen for the shot)");
  await inPage(page, () => window.__fitz.nest.resume());
  const programsAfter = await programs(page);
  checks.check("the fight compiles no new program (the warm-up compiled them all)",
    programsAfter === programsBefore, `${programsBefore} → ${programsAfter}`);

  // A breach tows the ship past the buoy, hull 60, the fight over.
  await inPage(page, () => window.__fitz.nest.setHull(1));
  const breach = await pollUntil(async () => (await readStore(page)).hullBreachAt !== null, { timeoutMs: 20_000, intervalMs: 50 });
  const towed = await pollUntil(async () => dist(await ship(page), D.tow) < 1, { timeoutMs: 3000, intervalMs: 50 });
  const pos = await ship(page);
  const sb = await readStore(page);
  const nb = await nest(page);
  checks.check("a hull breach is recorded", breach.ok, `hullBreachAt=${sb.hullBreachAt}`);
  checks.check("the breach tows the ship within 1 u of the tow pose, outside the fighting area",
    towed.ok && dist(pos, D.c) > 110, `off ${dist(pos, D.tow).toFixed(2)} u, ${dist(pos, D.c).toFixed(1)} u from the centre`);
  checks.check("after the breach: hull 60, wave 0", nb.hp === 60 && sb.wave === 0 && nb.wave === 0, `hp=${nb.hp} wave=${sb.wave}/${nb.wave}`);
  const breachBanner = await testIdText(page, "nest-banner-title");
  const breachRadio = await pollUntil(async () => (await chatterText(page))?.includes("HULL BREACH · TOWED TO THE BUOY"), { timeoutMs: 6000, intervalMs: 100 });
  checks.check("HULL BREACH shows, and the radio says the ship was towed", breachBanner === "HULL BREACH" && breachRadio.ok,
    `banner=${breachBanner} radio=${await chatterText(page)}`);

  // Out and back in once HULL BREACH has gone (it outranks NEST CLEARED), then the waves debug-cleared: the badge.
  await pollUntil(async () => (await testIdText(page, "nest-banner-title")) !== "HULL BREACH" || !(await shown(page, "nest-banner")),
    { timeoutMs: 5000, intervalMs: 100 });
  await enter(page, D);
  await nextFrames(page, 3);
  await inPage(page, () => window.__fitz.nest.clearAll());
  const cleared = await pollUntil(async () => {
    const s = await readStore(page);
    return s.badges.some((b) => b.id === "nest") && s.nestClearedAt !== null;
  }, { timeoutMs: 5000, intervalMs: 100 });
  const clearedBanner = (await pollUntil(async () => ((await testIdText(page, "nest-banner-title")) === "NEST CLEARED" ? "NEST CLEARED" : null),
    { timeoutMs: 2000, intervalMs: 50 })).value ?? await testIdText(page, "nest-banner-title");
  checks.check("clearing the Nest earns the nest badge", cleared.ok, JSON.stringify((await readStore(page)).badges.map((b) => b.id)));
  const clearedRadio = await pollUntil(async () => (await chatterText(page))?.includes("NEST CLEARED"), { timeoutMs: 6000, intervalMs: 100 });
  checks.check("NEST CLEARED shows on the HUD and the radio", clearedBanner === "NEST CLEARED" && clearedRadio.ok,
    `banner=${clearedBanner} radio=${await chatterText(page)}`);

  // The warp hold (Ruling C5): inside the fighting area warp stays at normal speed (the Nest rests: no fight).
  const holdMax = async (from, ms) => {
    await teleport(page, from);
    await aimAt(page, D.c);
    await nextFrames(page, 3);
    await page.keyboard.down("KeyW"); await page.keyboard.down("ShiftLeft");
    let max = 0;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await nextFrames(page, 2);
      if (await inPage(page, () => window.__fitz.nest.combat.inArea)) max = Math.max(max, await inPage(page, () => window.__fitz.flight.speed));
    }
    await page.keyboard.up("ShiftLeft"); await page.keyboard.up("KeyW");
    return max;
  };
  const inside = await holdMax(at(D, 100), 2500);
  checks.check("in the fighting area warp is held to normal speed (≤ 39.5 u/s)", inside <= 39.5 && inside > 30, `max=${inside.toFixed(2)}`);
}

// ── 2. The perf state "In the Nest (wave 3)" ───────────────────────────────
async function perf(page, checks) {
  const D = await nestData(page);
  // CENTRE + [0, 0, 40], nose on -Z (yaw π): the formation lines up toward the centre.
  await teleport(page, { x: D.c.x, y: D.c.y, z: D.c.z + 40 });
  await inPage(page, () => window.__fitz.setAttitude(Math.PI, 0));
  const warm = await pollUntil(() => inPage(page, () => window.__fitz.nest?.combat.warm === true), { timeoutMs: 60_000, intervalMs: 250 });
  checks.check("perf: the Nest warms (precondition)", warm.ok);
  await inPage(page, () => window.__fitz.nest.startWave(3));
  await nextFrames(page, 2);
  await inPage(page, () => { window.__fitz.setAttitude(Math.PI, 0); });
  await nextFrames(page, 2);
  await inPage(page, () => window.__fitz.nest.formation());
  await settle(page, 1500);
  await nextFrames(page, 3);
  const state = await nest(page);
  const drawn = await instances(page);
  checks.check("perf: wave 3 in formation (3 saucers + 1 tardigrade, AI frozen) (precondition)",
    state.wave === 3 && state.saucers === 3 && state.tardigrades === 1 && state.frozen, JSON.stringify(state));
  const read = () => inPage(page, () => {
    let lights = 0;
    window.__fitz.scene.traverse((o) => { if (o.isLight) lights++; });
    return { calls: window.__fitz.perfStats.calls, triangles: window.__fitz.perfStats.triangles, programs: window.__fitz.gl.info.programs.length, lights };
  });
  const r = await read();
  const fx = await effects(page);
  const lightBudget = await inPage(page, async () => (await import("/src/constants.ts")).LIGHT_BUDGET);
  checks.check("In the Nest (wave 3) draw calls within budget", r.calls <= NEST_CALLS_CEILING, `calls=${r.calls} ceiling=${NEST_CALLS_CEILING}`);
  checks.check("In the Nest (wave 3) triangles within budget", r.triangles <= NEST_TRIS_CEILING, `triangles=${r.triangles} ceiling=${NEST_TRIS_CEILING}`);
  checks.check("In the Nest (wave 3) programs within budget", r.programs <= NEST_PROGRAMS_CEILING, `programs=${r.programs} ceiling=${NEST_PROGRAMS_CEILING}`);
  checks.check("In the Nest (wave 3) adds no light (LIGHT_BUDGET)", r.lights <= lightBudget, `lights=${r.lights} LIGHT_BUDGET=${lightBudget}`);
  // The Nest's own share: the same frame with its group hidden.
  await inPage(page, () => { window.__fitz.scene.getObjectByName("Nest").visible = false; });
  await nextFrames(page, 3);
  const bare = await read();
  await inPage(page, () => { window.__fitz.scene.getObjectByName("Nest").visible = true; });
  checks.note("perf: In the Nest (wave 3) reading",
    `calls=${r.calls} triangles=${r.triangles} programs=${r.programs} lights=${r.lights}; the Nest's share ${r.calls - bare.calls} calls, ${r.triangles - bare.triangles} triangles; `
    + `instances=${JSON.stringify((drawn ?? []).filter((m) => m.count > 0))} effects=${JSON.stringify(fx)}`);
}

// ── 3. Reduced motion ──────────────────────────────────────────────────────
async function reducedMotion(page, checks) {
  const D = await nestData(page);
  checks.check("reduced motion: the store picks up the OS preference", (await readStore(page)).reducedMotion === true);
  const loaded = await approach(page, D);
  checks.check("reduced motion: the Nest loads and warms (precondition)", loaded.ok);
  await teleport(page, at(D, 60));
  const w1 = await pollUntil(async () => (await readStore(page)).wave === 1, { timeoutMs: 10_000, intervalMs: 100 });
  checks.check("reduced motion: wave 1 starts", w1.ok);
  const motion = await inPage(page, () => window.__fitz.nest.motion());
  checks.check("reduced motion: the monsters' uMotion is 0", motion === 0, `motion=${motion}`);
  // Catch a hull-hit flash while it shows (0.35 s).
  const flash = await pollUntil(() => inPage(page, () => {
    const el = document.querySelector('[data-testid="nest-flash"]');
    if (!el || el.style.display === "none" || window.__fitz.nest.combat.hits === 0) return null;
    return { mode: el.dataset.mode, opacity: el.style.opacity };
  }), { timeoutMs: 20_000, intervalMs: 20 });
  checks.check("reduced motion: a hull hit flashes a static tint (data-mode static, opacity 0.3)",
    flash.ok && flash.value.mode === "static" && Number(flash.value.opacity) === 0.3, JSON.stringify(flash.value));
}

// ── 4. Offline: the models never load (Ruling C22) ─────────────────────────
async function offline(page, checks) {
  const D = await nestData(page);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (ONDEMAND.test(req.url())) return req.abort("failed");
    if (isFontHost(req.url())) return respondInertFont(req);
    return req.continue();
  });
  await enter(page, D);
  const line = await pollUntil(async () => (await testIdText(page, "nest-banner-sub")) === "NEST OFFLINE · MODELS DIDN'T LOAD",
    { timeoutMs: 15_000, intervalMs: 100 });
  checks.check("offline: the HUD says NEST OFFLINE · MODELS DIDN'T LOAD", line.ok,
    `title=${await testIdText(page, "nest-banner-title")} sub=${await testIdText(page, "nest-banner-sub")}`);
  await settle(page, 4000); // past the 3 s countdown
  await nextFrames(page, 3);
  const s = await readStore(page);
  const n = await nest(page);
  checks.check("offline: no wave starts and the Nest stays harmless", s.wave === 0 && n.saucers === 0 && n.tardigrades === 0
    && n.hp === 100 && n.loadFailed && !n.warm, JSON.stringify({ wave: s.wave, ...n }));
}

/** One page each, independent: run.mjs runs them as separate jobs. */
export const parts = [
  () => withPage({ label: "combat (away)", initScript: FULL_TIMELINE }, away),
  () => withPage({ label: "combat (fight)", initScript: FULL_TIMELINE }, fight),
  () => withPage({ label: "combat (perf)", backend: "swiftshader", initScript: lockFullFidelity }, perf),
  () => withPage({ label: "combat (reduced motion)", emulateReducedMotion: true, initScript: FULL_TIMELINE }, reducedMotion),
  // Dev React reports the caught load error (NestGate's error boundary), naming the glb.
  () => withPage({ label: "combat (offline)", expectedErrors: [ONDEMAND] }, offline),
];

export default function run() { return runParts(parts); }
