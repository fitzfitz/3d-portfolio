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
  const secs = await callGuide(page);
  checks.check("J brings the guide within 25 u in 3 s or less", secs !== null && secs <= 3,
    `from ${away.toFixed(0)} u away: ${secs === null ? "never" : secs.toFixed(2) + " s"}`);
  const radio = (await pollUntil(async () => { const t = await chatterText(page); return /GUIDE/.test(t) ? t : null; }, { timeoutMs: 6000, intervalMs: 250 })).value;
  checks.check("the radio says the guide is here", !!radio, radio ?? `radio: ${await chatterText(page)}`);

  const leading = (await pollUntil(async () => ((await guideState(page)) === "leading" ? true : null), { timeoutMs: 8000, intervalMs: 100 })).ok;
  checks.check("it settles into leading", leading, `state=${await guideState(page)}`);

  // Fly the ship toward the target, smoothly every frame (40 u/s), and check
  // the guide stays ahead of it and closes on the target.
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
  checks.check("standing: waiting for a stopped ship, the bell points up (body +y . up > 0.95)", stand.y > 0.95,
    `state=${stand.state} up.y=${stand.y.toFixed(3)} swim=${stand.swim.toFixed(2)}`);

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
