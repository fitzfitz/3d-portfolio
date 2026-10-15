import { withPage, settle, pollUntil } from "./harness.mjs";
import { KnownDevices } from "puppeteer-core";

/**
 * Phone layout for the career buoy card: with a card shown and the touch SCAN
 * button up (a buoy in range), the card must not cover RISE, SCAN or the
 * mobile radar, on a short phone (iPhone SE, 667 tall) and a tall one
 * (iPhone 13). Both rects must exist or the check would pass vacuously.
 */
const ready = (page) => page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
const overlaps = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const measure = (page) => page.evaluate(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  return { card: r('[data-testid="buoy-card"]'), scan: r('[data-testid="touch-scan"]'), rise: r('[data-testid="touch-rise"]'), radar: r('[data-testid="radar"]') };
});

export default async function run() {
  return withPage({ label: "careerphone", device: KnownDevices["iPhone SE"] }, async (page, checks) => {
    await ready(page);
    await settle(page, 2000);
    const b2 = await page.evaluate(async () => (await import("/src/data/careerTrail.ts")).BUOYS[2].pos);
    await page.evaluate((p) => { window.__fitz.teleport(p[0] + 2, p[1], p[2]); window.__fitz.setAttitude(0, 0); }, b2);
    const shown = await pollUntil(async () => {
      const m = await measure(page);
      const op = await page.evaluate(() => document.querySelector('[data-testid="buoy-card"]')?.style.opacity);
      return op === "1" && m.scan ? m : null;
    }, { timeoutMs: 15_000, intervalMs: 200 });
    checks.check("a buoy card and the touch SCAN button are both up at a phone viewport", shown.ok, JSON.stringify(shown.value));
    for (const vp of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
      await page.setViewport({ ...page.viewport(), ...vp });
      await settle(page, 600);
      const m = await measure(page);
      const tag = `${vp.width}x${vp.height}`;
      const all = !!m.card && !!m.scan && !!m.rise && !!m.radar;
      checks.check(`${tag}: card, scan, rise and radar all exist`, all, JSON.stringify(m));
      checks.check(`${tag}: the buoy card clears SCAN, RISE and the radar`,
        all && !overlaps(m.card, m.scan) && !overlaps(m.card, m.rise) && !overlaps(m.card, m.radar), JSON.stringify(m));
      checks.check(`${tag}: the buoy card stays on screen`, all && m.card.l >= 0 && m.card.r <= vp.width && m.card.t >= 0, JSON.stringify(m.card));
    }
  });
}
