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
    // Run after the viewport loop: the 1 s hold below moves the ship off the buoy.
    // Teleport into a planet's gravity zone so the warning shows in the right column.
    // 1.5x the planet's size out: inside the zone (1.8x), outside the lock (1.3x).
    const name = await page.evaluate(async () => (await import("/src/constants.ts")).planets[0].name);
    await page.evaluate(async (n) => {
      const { planets } = await import("/src/constants.ts");
      const d = planets.find((p) => p.name === n).size * 1.5;
      const b = window.__fitz.bodies[n]; window.__fitz.teleport(b.x - d, b.y + 2, b.z); window.__fitz.setAttitude(0, 0);
    }, name);
    const zone = await pollUntil(() => page.evaluate(() => !!window.__fitz.store.getState().activeZone), { timeoutMs: 10_000, intervalMs: 200 });
    checks.check("the ship is inside a planet's gravity zone (warning shown)", zone.ok);
    let vel = null;
    try {
      // Fly for a second so the readout shows a live speed.
      await page.keyboard.down("w");
      await settle(page, 1000);
      vel = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="hud-velocity"]');
        const col = [...document.querySelectorAll("div")].find((d) => d.className.includes("right-4") && d.className.includes("top-16") && d.textContent.includes("TARGET"));
        if (!el || !col) return null;
        const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const v = box(el);
        const hit = [...col.querySelectorAll("*")].filter((e) => { const b = box(e); return b.r > b.l && b.b > b.t; })
          .filter((e) => { const b = box(e); return v.l < b.r && b.l < v.r && v.t < b.b && b.t < v.b; })
          .map((e) => e.textContent.slice(0, 40));
        return { text: el.textContent, box: v, right: v.r, width: window.innerWidth, warning: col.textContent.includes("GRAVITY"), hit };
      });
    } finally {
      await page.keyboard.up("w");
    }
    checks.check("the HUD velocity line fits and does not overlap the right column",
      !!vel && vel.warning && vel.right <= vel.width && vel.hit.length === 0, JSON.stringify(vel));
  });
}
