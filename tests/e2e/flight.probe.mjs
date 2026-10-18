import { withPage, hold, settle, sceneQuery, installEdgeRecorder, readEdgeRecorder, stopEdgeRecorder } from "./harness.mjs";

const SYSTEM_RADIUS = 480; // src/constants.ts
const EDGE_BOUND = 520; // the burn must never let the ship out this far (VALIDATION_RADIUS, what the Worker accepts)
const RANGE = 220; // RadarMap RANGE
const SIZE = 148;  // RadarMap SIZE

/**
 * Recomputes what the radar should be drawing, using the same plain-distance
 * heading-up transform the component uses, from live flight/bodies telemetry.
 */
const expectedBlips = (page) => page.evaluate((args) => {
  const { range, size } = args;
  const f = window.__fitz.flight;
  const b = window.__fitz.bodies;
  const c = size / 2;
  const rimR = c - 6;
  const scale = rimR / range;
  const cosA = Math.cos(f.heading), sinA = Math.sin(f.heading);
  return Object.entries(b).map(([name, p]) => {
    const dx = p.x - f.x;
    const dy = p.y - f.y;
    const dz = p.z - f.z;
    const rx = dz * sinA - dx * cosA;
    const up = dx * sinA + dz * cosA;
    const dist = Math.hypot(dx, dz);
    return { name, dx, dy, dz, dist, px: c + rx * scale, py: c - up * scale,
             inRange: dist <= range };
  });
}, { range: RANGE, size: SIZE });

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
    checks.check("every in-range blip lands inside the rim",
      blips.length > 0 && outliers.length === 0,
      blips.length === 0 ? "no bodies to check (see telemetry check above)"
        : outliers.map((o) => `${o.name}@${o.px.toFixed(1)},${o.py.toFixed(1)}`).join(" "));

    // Radar canvas actually paints. The brief's original version of this check
    // only asserted >2 colour buckets, which is weak: RadarMap.tsx always
    // draws the range rings, sweep line, ship chevron and pitch ladder
    // regardless of whether any body is in view, and those alone already
    // produce more than 2 buckets (green ring/sweep/ladder + white ship
    // chevron) with zero planet/portal blips rendered. Strengthened below by
    // also checking for the exact quantized colours of bodies that are drawn
    // NOWHERE else on the canvas: portfolio (#00f0ff) and fuxx (#bd00ff) planets
    // and the contact portal (#ec4899). (ruangrapi's #00ff87 is excluded from the
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

    const blipColours = { portfolio: "#00f0ff", fuxx: "#bd00ff", contact: "#ec4899" };
    const foundBlipColours = colours
      ? Object.entries(blipColours).filter(([, hex]) => colours.includes(hexBucket(hex))).map(([name]) => name)
      : [];
    checks.check("radar canvas paints actual body-blip colours (not just chrome)",
      foundBlipColours.length >= 2,
      `found ${foundBlipColours.join(",") || "none"} of ${Object.keys(blipColours).join(",")}`);

    // Flying out at warp: the ship is returned. There is no wrap; past
    // SYSTEM_RADIUS the flight computer cuts warp and brakes the ship, so it
    // must never reach the edge bound (EDGE_BOUND) and must come
    // back inside. Start 20u inside the edge facing +X (yaw pi/2 points the
    // nose down +X), hold warp until the edge is crossed, release, then poll
    // generously: headless sim time runs ~3x slower than wall time.
    await page.evaluate(() => {
      window.__fitz.teleport(460, 0, 0);
      window.__fitz.setAttitude(Math.PI / 2, 0);
    });
    // The in-page recorder (harness.mjs) timestamps the crossing and the return
    // per animation frame and remembers any "RETURN BURN" broadcast, so none of
    // this depends on poll timing. No sim clock is exposed, so the spec's
    // "back inside within 6 simulated seconds" is asserted as <= 18 s wall
    // (headless runs ~3x slow); the poll ceilings below are only hang guards.
    await installEdgeRecorder(page, SYSTEM_RADIUS);
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    let rec = await readEdgeRecorder(page);
    const t0 = Date.now();
    while (rec.tCross === null && Date.now() - t0 < 90_000) {
      await settle(page, 200);
      rec = await readEdgeRecorder(page);
    }
    // Keep holding Shift+W outward ~10 s past the crossing: the edge cut is
    // latched, so warp must never re-engage (no bounce, no warp flicker).
    await settle(page, 10_000);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");
    rec = await readEdgeRecorder(page);
    checks.check("flying out at warp crosses the edge", rec.tCross !== null, `max |p|=${rec.maxR.toFixed(1)}`);
    const tWait = Date.now();
    while (rec.tBack === null && Date.now() - tWait < 60_000) {
      await settle(page, 150);
      rec = await readEdgeRecorder(page);
    }
    const backS = rec.tBack !== null && rec.tCross !== null ? (rec.tBack - rec.tCross) / 1000 : Infinity;
    checks.check("the ship never gets near the edge bound", rec.maxR < EDGE_BOUND,
      `max |p|=${rec.maxR.toFixed(1)} < ${EDGE_BOUND}`);
    checks.check("warp never re-engages after the edge cut (held Shift+W, 10 s)", rec.cutSeen && rec.rewarp === 0,
      `cut seen=${rec.cutSeen}, warp frames after the cut=${rec.rewarp}`);
    checks.check("the ship is returned inside the system", rec.tBack !== null,
      rec.tBack !== null ? `back inside ${SYSTEM_RADIUS}` : "never came back inside");
    checks.check("the return takes at most 18 s wall (~6 simulated seconds)", backS <= 18,
      `${backS.toFixed(1)}s wall`);
    checks.check("the return-burn radio line was broadcast", rec.burn);
    await stopEdgeRecorder(page);

    // (No 'radar blips stay inside the rim after the burn' check: it recomputed the
    // same transform it asserted against and could not fail; the pixel check above covers the radar.)

    // Back to open deep space so the warp below is not cut by the edge burn.
    await page.evaluate(() => {
      window.__fitz.teleport(150, 60, 150);
      window.__fitz.setAttitude(0, 0);
    });
    await settle(page, 500);

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
