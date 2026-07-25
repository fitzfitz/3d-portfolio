import { withPage, hold, settle, sceneQuery } from "./harness.mjs";

const BOUNDS = 250;
const RANGE = 160; // RadarMap RANGE
const SIZE = 148;  // RadarMap SIZE

/**
 * Recomputes what the radar should be drawing, using the same wrap + heading-up
 * transform the component uses, from live flight/bodies telemetry.
 */
const expectedBlips = (page) => page.evaluate((args) => {
  const { bounds, range, size } = args;
  const f = window.__fitz.flight;
  const b = window.__fitz.bodies;
  const wrapDelta = (d, lim) => {
    const span = lim * 2;
    let x = d % span;
    if (x > lim) x -= span;
    if (x < -lim) x += span;
    return x;
  };
  const c = size / 2;
  const rimR = c - 6;
  const scale = rimR / range;
  const cosA = Math.cos(f.heading), sinA = Math.sin(f.heading);
  return Object.entries(b).map(([name, p]) => {
    const dx = wrapDelta(p.x - f.x, bounds);
    const dy = wrapDelta(p.y - f.y, bounds);
    const dz = wrapDelta(p.z - f.z, bounds);
    const rx = dz * sinA - dx * cosA;
    const up = dx * sinA + dz * cosA;
    const dist = Math.hypot(dx, dz);
    return { name, dx, dy, dz, dist, px: c + rx * scale, py: c - up * scale,
             inRange: dist <= range };
  });
}, { bounds: BOUNDS, range: RANGE, size: SIZE });

/** Quantizes a "#rrggbb" colour the same way the histogram sampler below
 * buckets canvas pixels (`channel >> 5`), so expected colours can be
 * compared against sampled buckets directly. */
const hexBucket = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `${r >> 5},${g >> 5},${b >> 5}`;
};

export default async function run() {
  return withPage({ label: "flight" }, async (page, checks) => {
    // In-range blips must land inside the radar rim.
    const blips = await expectedBlips(page);
    checks.check("bodies telemetry is populated", blips.length >= 3, `${blips.length} bodies`);
    const c = SIZE / 2, rimR = c - 6;
    const outliers = blips.filter((b) => b.inRange &&
      Math.hypot(b.px - c, b.py - c) > rimR + 0.5);
    checks.check("every in-range blip lands inside the rim", outliers.length === 0,
      outliers.map((o) => `${o.name}@${o.px.toFixed(1)},${o.py.toFixed(1)}`).join(" "));

    // Radar canvas actually paints. The brief's original version of this check
    // only asserted >2 colour buckets, which is weak: RadarMap.tsx always
    // draws the range rings, sweep line, ship chevron and pitch ladder
    // regardless of whether any body is in view, and those alone already
    // produce more than 2 buckets (green ring/sweep/ladder + white ship
    // chevron) with zero planet/portal blips rendered. Strengthened below by
    // also checking for the exact quantized colours of bodies that are drawn
    // NOWHERE else on the canvas: video (#00f0ff) and agent (#bd00ff) planets
    // and the contact portal (#ec4899). (saas' #00ff87 is excluded from the
    // strong check because it quantizes to the same bucket as the green
    // rings/sweep/pitch-dot, so its presence alone wouldn't prove a blip was
    // drawn.) RadarMap draws every target every frame — clamped to the rim
    // if out of range, never skipped — so all three colours are expected
    // regardless of the ship's position.
    const colours = await page.evaluate(() => {
      const cv = [...document.querySelectorAll("canvas")]
        .find((c) => c.width <= 320 && c.height <= 320);
      if (!cv) return null;
      const ctx = cv.getContext("2d");
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 40) continue;
        seen.add(`${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`);
      }
      return [...seen];
    });
    checks.check("radar canvas is painting", colours !== null && colours.length > 2,
      `${colours?.length ?? 0} colour buckets`);

    const blipColours = { video: "#00f0ff", agent: "#bd00ff", contact: "#ec4899" };
    const foundBlipColours = colours
      ? Object.entries(blipColours).filter(([, hex]) => colours.includes(hexBucket(hex))).map(([name]) => name)
      : [];
    checks.check("radar canvas paints actual body-blip colours (not just chrome)",
      foundBlipColours.length >= 2,
      `found ${foundBlipColours.join(",") || "none"} of ${Object.keys(blipColours).join(",")}`);

    // Across a wrap seam the transform must stay continuous. The brief's
    // original approach set `window.__fitz.flight.x = BOUNDS - 4` directly
    // and expected the ship to then fly across it. Verified live (see
    // task-6-report.md) that this does NOT work: `flight.{x,y,z}` is a
    // write-only telemetry mirror — Spaceship.tsx's useFrame overwrites it
    // from its own internal `pos` ref every single frame
    // (`flight.x = pos.current.x`, etc.), so an external write is clobbered
    // on the very next frame and the ship's real position never moves. There
    // is no debug-bridge teleport hook, so the only way to actually get the
    // ship near the seam is to fly it there for real. From spawn, heading 0
    // already points the nose down +Z (`noseDirection(0,0) = (0,0,1)`), so
    // holding forward+boost with NO turning drives flight.z toward +BOUNDS
    // and across — measured live at ~37 u/s effective, i.e. ~19s from spawn
    // to the wrap. Poll every 500ms and stop the instant a wrap is detected
    // (z drops by >100 between polls — the only way that happens, since
    // forward flight only ever increases z) rather than holding for a fixed
    // guess, so the check can't pass on a race and can't hang indefinitely.
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    let pre = null, post = null, preZ = null, postZ = null, wrapped = false;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await settle(page, 500);
      const zNow = await page.evaluate(() => window.__fitz.flight.z);
      if (preZ !== null && zNow < preZ - 100) {
        post = await expectedBlips(page);
        postZ = zNow;
        wrapped = true;
        break;
      }
      preZ = zNow;
      pre = await expectedBlips(page);
    }
    await page.keyboard.up("KeyW");
    await page.keyboard.up("ShiftLeft");

    // Confirm the seam crossing actually happened before trusting anything
    // it implies — otherwise a check that never ran the scenario would pass
    // for free (same principle as Task 4's flight-displacement gate).
    checks.check("ship actually crossed the wrap seam (z jumped by > bounds)",
      wrapped && Math.abs(postZ - preZ) > BOUNDS,
      wrapped ? `z ${preZ.toFixed(1)} -> ${postZ.toFixed(1)} (Δ=${(postZ - preZ).toFixed(1)})`
        : `no wrap within 45s (last z=${preZ?.toFixed(1)})`);

    if (wrapped && pre && post) {
      const jumped = pre.filter((p) => {
        const q = post.find((o) => o.name === p.name);
        return q && Math.abs(q.dx - p.dx) > BOUNDS;
      });
      checks.check("radar deltas stay continuous across the wrap seam", jumped.length === 0,
        jumped.map((j) => j.name).join(" ") || "no discontinuity");
    } else {
      checks.check("radar deltas stay continuous across the wrap seam", false,
        "skipped — seam crossing was not confirmed, so continuity cannot be judged");
    }

    // Warp tunnel orientation must track heading and pitch: rotation is
    // set as (PI/2 - pitch, heading, 0) in WarpTunnel.tsx.
    await hold(page, ["Space"], 1200);          // pitch the nose up
    await page.keyboard.down("ShiftLeft");
    await settle(page, 1500);
    const t = await sceneQuery(page, "WarpTunnel");
    const f = await page.evaluate(() => ({
      heading: window.__fitz.flight.heading, pitch: window.__fitz.flight.pitch,
    }));
    await page.keyboard.up("ShiftLeft");

    const expX = Math.PI / 2 - f.pitch;
    checks.check("warp tunnel is visible while boosting", t.visible, `visible=${t.visible}`);
    checks.check("warp tunnel pitch follows the nose", Math.abs(t.rotation.x - expX) < 0.05,
      `x=${t.rotation.x.toFixed(3)} expected=${expX.toFixed(3)} (pitch=${f.pitch.toFixed(3)})`);
    checks.check("warp tunnel yaw follows the heading",
      Math.abs(t.rotation.y - f.heading) < 0.05,
      `y=${t.rotation.y.toFixed(3)} expected=${f.heading.toFixed(3)}`);
  });
}
