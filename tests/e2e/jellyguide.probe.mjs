import { withPage, settle, pollUntil, runParts, chatterText } from "./harness.mjs";
import { DEEP_SPACE_POINT } from "./deepSpacePoint.mjs";

// The jellyfish guide (spec 2026-10-23-jellyfish-guide), flown for real: J calls
// it, it leads toward the HUD's target, it swims bell first and stands upright.
// Reads `fitzDebug.jellyGuide` (src/debug/bridge.ts). Its `vel` magnitude is
// capped (POSTURE_V_MAX), so only its direction is used here. The ship is moved
// by a per-frame teleport: the posture reads speed from frame-to-frame motion,
// and a teleport every 100 ms would read as bursts, not a swim.

const teleport = (page, [x, y, z]) => page.evaluate((x, y, z) => window.__fitz.teleport(x, y, z), x, y, z);
const guideState = (page) => page.evaluate(() => window.__fitz.jellyGuide?.state ?? null);
const gap = (page) => page.evaluate(() => {
  const p = window.__fitz.jellyGuide.pos, f = window.__fitz.flight;
  return Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z);
});

/** The guide's target as the HUD would pick it for the live ship (a fresh game: the nearest unread probe). */
const hudTarget = (page) => page.evaluate(async () => {
  const { makeRecruiterTarget, createWaypointTarget } = await import("/src/utils/waypointTarget.ts");
  const s = window.__fitz.store.getState(), f = window.__fitz.flight;
  const out = createWaypointTarget();
  const ok = makeRecruiterTarget()({ x: f.x, y: f.y, z: f.z }, s.visitedDossiers, s.badges, out);
  return ok ? { id: out.id, x: out.x, y: out.y, z: out.z, radius: out.radius } : null;
});

/** Points the ship's nose at `t` (yaw/pitch as pitchFlight.ts noseDirection), or `turn` radians of yaw off it, level. */
const aim = (page, t, turn = 0) => page.evaluate((t, turn) => {
  const f = window.__fitz.flight;
  const dx = t.x - f.x, dy = t.y - f.y, dz = t.z - f.z;
  const yaw = Math.atan2(dx, dz) + turn;
  window.__fitz.setAttitude(yaw, turn ? 0 : Math.asin(dy / Math.hypot(dx, dy, dz)));
}, t, turn);

/** Presses J and waits (in the page, on rAF) for the creature to come within 25 u; resolves the seconds, or null. */
async function callGuide(page, limitMs = 6000) {
  await page.evaluate((limitMs) => {
    window.__callT = new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const p = window.__fitz.jellyGuide.pos, f = window.__fitz.flight;
        if (Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z) < 25) return resolve((performance.now() - t0) / 1000);
        if (performance.now() - t0 > limitMs) return resolve(null);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, limitMs);
  await page.keyboard.press("KeyJ");
  return page.evaluate(() => window.__callT);
}

async function guiding(page, checks) {
  await teleport(page, DEEP_SPACE_POINT);
  await settle(page, 2000);
  const target = await hudTarget(page);
  checks.check("a fresh game has a HUD target for the guide to lead to", !!target, target ? target.id : "none");
  const away = await page.evaluate(() => {
    const p = window.__fitz.jellyGuide.pos, f = window.__fitz.flight;
    return Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z);
  });

  checks.check("the guide starts far from the ship (so arriving means J did something)", away > 100, `${away.toFixed(0)} u away`);

  // Record posture every frame from the call on: while it swims, bell leads;
  // the streak-in is the fastest swim there is.
  await page.evaluate(() => {
    const r = window.__post = { streakMax: 0, n: 0, good: 0, cruiseN: 0, cruiseMin: 1, bad: [], on: true };
    const tick = () => {
      if (!r.on) return;
      const g = window.__fitz.jellyGuide;
      r.streakMax = Math.max(r.streakMax, g.streak);
      const m = Math.hypot(g.vel.x, g.vel.y, g.vel.z);
      if (g.swim > 0.9 && m >= 2.37) {
        const d = (g.vel.x * g.up.x + g.vel.y * g.up.y + g.vel.z * g.up.z) / m;
        r.n++; if (d > 0.8) r.good++;
        if (m >= 9) { r.cruiseN++; r.cruiseMin = Math.min(r.cruiseMin, d); }
        else if (d <= 0.8 && r.bad.length < 6) r.bad.push([g.state, +d.toFixed(2), +m.toFixed(1)]);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // Count the guide's chime (soundManager.guideChime) as its radio lines go out.
  await page.evaluate(() => {
    const s = window.__fitz.sound, chime = s.guideChime.bind(s);
    window.__chimes = 0;
    s.guideChime = () => { window.__chimes++; chime(); };
  });
  const secs = await callGuide(page);
  checks.check("J brings the guide within 25 u in 3 s or less", secs !== null && secs <= 3,
    `from ${away.toFixed(0)} u away: ${secs === null ? "never" : secs.toFixed(2) + " s"}`);
  const radio = (await pollUntil(async () => { const t = await chatterText(page); return /GUIDE/.test(t) ? t : null; }, { timeoutMs: 6000, intervalMs: 250 })).value;
  checks.check("the radio says the guide is here", !!radio, radio ?? `radio: ${await chatterText(page)}`);
  const chimes = await page.evaluate(() => window.__chimes);
  checks.check("the guide chimes when it speaks (owner: \"I don't hear any radio sound\")", chimes >= 1, `${chimes} chime(s)`);

  const leading = (await pollUntil(async () => ((await guideState(page)) === "leading" ? true : null), { timeoutMs: 8000, intervalMs: 100 })).ok;
  checks.check("it settles into leading", leading, `state=${await guideState(page)}`);

  // Fly the ship toward the target, smoothly every frame (40 u/s), nose on it,
  // and check the guide stays ahead of it and closes on the target.
  await aim(page, target);
  const lead = await page.evaluate((t) => new Promise((resolve) => {
    const f = window.__fitz.flight, g = window.__fitz.jellyGuide;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const start = { x: f.x, y: f.y, z: f.z };
    const g0 = dist(g.pos, t);
    let last = performance.now(), aheadFrames = 0, frames = 0, tEnd = last + 5000;
    const pos = { ...start };
    const tick = () => {
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1); last = now;
      const dx = t.x - pos.x, dy = t.y - pos.y, dz = t.z - pos.z, d = Math.hypot(dx, dy, dz);
      const step = Math.min(40 * dt, Math.max(0, d - t.radius - 60));
      pos.x += (dx / d) * step; pos.y += (dy / d) * step; pos.z += (dz / d) * step;
      window.__fitz.teleport(pos.x, pos.y, pos.z);
      frames++;
      if (dist(g.pos, t) < dist(pos, t)) aheadFrames++;
      if (now > tEnd) return resolve({ g0, g1: dist(g.pos, t), ship: Math.hypot(pos.x - start.x, pos.y - start.y, pos.z - start.z), aheadFrames, frames, state: g.state });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), target);
  checks.check("it leads: closer to the target than the ship on 90% of frames", lead.aheadFrames / lead.frames > 0.9,
    `${lead.aheadFrames}/${lead.frames} frames, state=${lead.state}`);
  checks.check("it leads: it moves toward the target as the ship follows", lead.g1 < lead.g0 - 20,
    `target distance ${lead.g0.toFixed(0)} -> ${lead.g1.toFixed(0)} u (ship flew ${lead.ship.toFixed(0)} u)`);

  const post = await page.evaluate(() => { window.__post.on = false; return window.__post; });
  checks.check("swimming at speed: bell leads the way (body +y . velocity > 0.8)", post.cruiseN > 20 && post.cruiseMin > 0.8,
    `${post.cruiseN} frames at >= 9 u/s, min ${post.cruiseMin.toFixed(3)}; over all ${post.n} swimming frames ${post.good} are > 0.8 (setting off from rest takes ~0.5 s to turn the body)`);

  checks.check("swimming, setting off and turning: at least 85% of frames bell first", post.n > 50 && post.good / post.n >= 0.85,
    `${post.good}/${post.n} frames`);
  checks.check("the glow streak shows during the streak-in (so reduced motion's 0 means something)", post.streakMax > 0.5,
    `peak streak ${post.streakMax.toFixed(2)}`);

  // Ship at rest: the guide holds its station and stands up (~1 s half-life).
  await settle(page, 4000);
  const stand = await page.evaluate(() => ({ ...window.__fitz.jellyGuide.up, state: window.__fitz.jellyGuide.state, swim: window.__fitz.jellyGuide.swim }));
  checks.check("standing: holding its station by a stopped ship, the bell points up (body +y . up > 0.95)", stand.y > 0.95,
    `state=${stand.state} up.y=${stand.y.toFixed(3)} swim=${stand.swim.toFixed(2)}`);

  // Owner feedback 2026-10-23 (after #54): "I'm able to pass the jellyfish;
  // it's behind". Fly for real (W held) 135 degrees off the target: the guide
  // must stay in front of the nose, ahead = (guide - ship) . nose, as the
  // repro measured it (the old rule fell from -2 to -47 u in 8 s). Read every
  // frame after 1.5 s, once the turn's swing (~32 u) has closed.
  await aim(page, target, (135 * Math.PI) / 180);
  await page.evaluate(() => {
    const r = window.__ahead = { min: Infinity, n: 0, onScreen: 0, speed: 0, on: true, t0: performance.now() };
    const tick = () => {
      if (!r.on) return;
      if (performance.now() - r.t0 > 1500) {
        const f = window.__fitz.flight, p = window.__fitz.jellyGuide.pos, c = window.__fitz.camera;
        const cp = Math.cos(f.pitch);
        const nx = Math.sin(f.heading) * cp, ny = Math.sin(f.pitch), nz = Math.cos(f.heading) * cp;
        r.min = Math.min(r.min, (p.x - f.x) * nx + (p.y - f.y) * ny + (p.z - f.z) * nz);
        r.speed = Math.max(r.speed, f.speed);
        r.n++;
        // On screen: project through the live camera (column-major matrices).
        const v = c.matrixWorldInverse.elements, q = c.projectionMatrix.elements;
        const vx = v[0] * p.x + v[4] * p.y + v[8] * p.z + v[12];
        const vy = v[1] * p.x + v[5] * p.y + v[9] * p.z + v[13];
        const vz = v[2] * p.x + v[6] * p.y + v[10] * p.z + v[14];
        const cx = q[0] * vx + q[4] * vy + q[8] * vz + q[12], cy = q[1] * vx + q[5] * vy + q[9] * vz + q[13];
        const cw = q[3] * vx + q[7] * vy + q[11] * vz + q[15];
        if (cw > 0 && Math.abs(cx / cw) < 1 && Math.abs(cy / cw) < 1) r.onScreen++;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.down("KeyW");
  await settle(page, 4000);
  await page.keyboard.up("KeyW");
  const off = await page.evaluate(() => { window.__ahead.on = false; return { ...window.__ahead, state: window.__fitz.jellyGuide.state }; });
  checks.check("flying 135 degrees off the target, the guide stays ahead of the nose (> 10 u)", off.n > 20 && off.min > 10,
    `min ahead ${off.min.toFixed(1)} u over ${off.n} frames, ship up to ${off.speed.toFixed(1)} u/s, state=${off.state}`);
  checks.check("flying 135 degrees off the target, the guide is on screen", off.n > 20 && off.onScreen === off.n,
    `${off.onScreen}/${off.n} frames`);

  // Park the ship at the target: the guide arrives and presents.
  await teleport(page, [target.x + 20, target.y + 10, target.z]);
  const presenting = (await pollUntil(async () => ((await guideState(page)) === "presenting" ? true : null), { timeoutMs: 10000, intervalMs: 100 })).ok;
  checks.check("at the target it presents", presenting, `state=${await guideState(page)}`);

  await page.keyboard.press("KeyJ");
  const back = (await pollUntil(async () => ((await guideState(page)) === "roaming" ? true : null), { timeoutMs: 3000, intervalMs: 100 })).ok;
  checks.check("J again sends it back to roaming", back, `state=${await guideState(page)}`);
}

async function reducedMotion(page, checks) {
  await teleport(page, DEEP_SPACE_POINT);
  await settle(page, 2000);
  const away = await gap(page);
  checks.check("reduced motion: the guide starts far from the ship", away > 100, `${away.toFixed(0)} u away`);
  const secs = await callGuide(page, 3000);
  const near = await gap(page);
  checks.check("reduced motion: the guide appears beside the ship at once", secs !== null && secs < 1 && near < 30,
    secs === null ? "never" : `${secs.toFixed(2)} s, ${near.toFixed(1)} u`);
  const g = await page.evaluate(() => window.__fitz.jellyGuide);
  checks.check("reduced motion: no glow streak", g.streak === 0, `streak=${g.streak}`);
  await settle(page, 1500);
  const up = (await page.evaluate(() => window.__fitz.jellyGuide)).up;
  checks.check("reduced motion: it stands upright", up.y > 0.95, `up.y=${up.y.toFixed(3)}`);
  await page.keyboard.press("KeyJ");
  const back = (await pollUntil(async () => ((await guideState(page)) === "roaming" ? true : null), { timeoutMs: 3000, intervalMs: 100 })).ok;
  checks.check("reduced motion: J again dismisses it", back, `state=${await guideState(page)}`);
}

/** One page each, independent: run.mjs runs them as separate jobs. */
export const parts = [
  () => withPage({ label: "jellyguide" }, guiding),
  () => withPage({ label: "jellyguide (reduced motion)", emulateReducedMotion: true }, reducedMotion),
];

export default function run() { return runParts(parts); }
