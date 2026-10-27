import { withPage, settle, pollUntil, nextFrames, lockFullFidelity } from "./harness.mjs";

/**
 * Brightness far from the Sun (spec 2026-10-27-nest-playable §5): the scene
 * must not wash out as the camera's exposure climbs, (d / AU)², away from the
 * Sun. Self-lit things are held at their 1 AU brightness by glowScale and the
 * unlit backdrop's net gain is capped at BACKDROP_NET_MAX (sunLight.ts).
 *
 * Along one fixed heading, at 1, 3.5 and 13 AU, after the exposure settles:
 *  - the whole screen's mean luma may be at most 1.25 × the 1 AU value;
 *  - the sky alone (every scene child hidden, the painted backdrop left) at
 *    most 1.3 ×.
 * Luma is Rec. 709 over every 7th pixel of the drawing buffer, read in a
 * double rAF. scene.backgroundIntensity is never written: applyBackdrop
 * rewrites it every frame. The readings are recorded in docs/PERF-BUDGETS.md.
 */

const STOPS_AU = [1, 3.5, 13];
const HEADING = [-0.62, 0.30, 0.72];
const SETTLE_MS = 6000;
const WHOLE_MAX = 1.25;
const SKY_MAX = 1.3;

/** Mean Rec. 709 luma (0–255) over every 7th pixel of the drawing buffer, read in a double rAF. */
const readLuma = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const ctx = window.__fitz.gl.getContext();
    const W = ctx.drawingBufferWidth, H = ctx.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    let sum = 0, n = 0;
    for (let i = 0; i < W * H; i += 7) {
      const j = i * 4;
      sum += 0.2126 * buf[j] + 0.7152 * buf[j + 1] + 0.0722 * buf[j + 2];
      n++;
    }
    resolve(sum / n);
  }));
}));

/** Places the ship `r` AU out along HEADING, turned a little off it, as the controller's reference reads were. */
async function place(page, r) {
  await page.evaluate(async (r, h) => {
    const { AU } = await import("/src/constants.ts");
    const len = Math.hypot(h[0], h[1], h[2]);
    const u = { x: h[0] / len, y: h[1] / len, z: h[2] / len };
    const d = window.__fitz;
    d.teleport(u.x * r * AU, u.y * r * AU, u.z * r * AU);
    d.setAttitude(Math.atan2(-u.x, -u.z) + 0.5, Math.asin(-u.y) * 0.6);
  }, r, HEADING);
  await settle(page, SETTLE_MS);
  // Settled: the camera's exposure within 1% of its target where the camera is.
  return pollUntil(() => page.evaluate(async () => {
    const { targetExposure } = await import("/src/utils/sunLight.ts");
    const d = window.__fitz;
    const target = targetExposure(d.camera.position.length());
    return Math.abs(d.gl.toneMappingExposure - target) <= 0.01 * target ? { exposure: d.gl.toneMappingExposure } : null;
  }), { timeoutMs: 20_000, intervalMs: 300 });
}

/** The sky alone: every scene child hidden for the read, then each restored to its own visibility. */
async function readSky(page) {
  await page.evaluate(() => {
    const kids = window.__fitz.scene.children;
    window.__lookVis = kids.map((o) => o.visible);
    for (const o of kids) o.visible = false;
  });
  await nextFrames(page, 3);
  const luma = await readLuma(page);
  await page.evaluate(() => {
    const kids = window.__fitz.scene.children;
    kids.forEach((o, i) => { o.visible = window.__lookVis[i] ?? o.visible; });
    delete window.__lookVis;
  });
  return luma;
}

export default function run() {
  return withPage({ label: "look", initScript: lockFullFidelity }, async (page, checks) => {
    const whole = {}, sky = {};
    for (const r of STOPS_AU) {
      const settled = await place(page, r);
      checks.check(`exposure settles at ${r} AU`, settled.ok, settled.ok ? `exposure ${settled.value.exposure.toFixed(2)}` : "never within 1% of its target");
      whole[r] = await readLuma(page);
      sky[r] = await readSky(page);
    }
    const f = (v) => v.toFixed(1);
    checks.check("1 AU reads drew something", whole[1] > 1 && sky[1] > 0.5, `whole ${f(whole[1])}, sky ${f(sky[1])}`);
    for (const r of [3.5, 13]) {
      checks.check(`whole screen at ${r} AU ≤ ${WHOLE_MAX} × 1 AU`, whole[r] <= WHOLE_MAX * whole[1],
        `${f(whole[r])} vs ${f(whole[1])} (${(whole[r] / whole[1]).toFixed(2)}×)`);
      checks.check(`sky alone at ${r} AU ≤ ${SKY_MAX} × 1 AU`, sky[r] <= SKY_MAX * sky[1],
        `${f(sky[r])} vs ${f(sky[1])} (${(sky[r] / sky[1]).toFixed(2)}×)`);
    }
    checks.note("mean luma (1 / 3.5 / 13 AU)",
      `whole ${STOPS_AU.map((r) => f(whole[r])).join(" / ")}; sky ${STOPS_AU.map((r) => f(sky[r])).join(" / ")}`);
    return checks;
  });
}
