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
    // Park 28 u behind a project probe, nose on it, so the right column
    // carries its widest line, the touch pickup tip (PROBE IN RANGE // HOLD
    // BEAM TO GRAB), which shows only while the probe is inside the beam's
    // cone and 30 u; planets no longer raise a zone warning. Heading 0 faces
    // +z, and 1 s of thrust (<= SHIP_MAX_SPEED 10.8 u/s) keeps it dead ahead
    // and short of the probe.
    await page.evaluate(() => {
      const p = window.__fitz.probes.ruangrapi;
      window.__fitz.teleport(p.x, p.y, p.z - 28); window.__fitz.setAttitude(0, 0);
    });
    const zone = await pollUntil(() => page.evaluate(() => !!document.querySelector('[data-testid="hud-probe-tip"]')), { timeoutMs: 10_000, intervalMs: 200 });
    checks.check("a probe is in range (its pickup tip shows in the right column)", zone.ok);
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
        // The logbook tracker is the widest left-column row on a phone (the
        // worlds suffix); its own box must clear the right column too.
        const tr = document.querySelector('[data-testid="logbook-tracker"]');
        const t = tr ? box(tr) : null;
        const trackerHit = !t ? null : [...col.querySelectorAll("*")].filter((e) => { const b = box(e); return b.r > b.l && b.b > b.t; })
          .filter((e) => { const b = box(e); return t.l < b.r && b.l < t.r && t.t < b.b && b.t < t.b; })
          .map((e) => e.textContent.slice(0, 40));
        return { text: el.textContent, box: v, right: v.r, width: window.innerWidth, warning: col.textContent.includes("PROBE IN RANGE // HOLD BEAM TO GRAB"), hit, tracker: t, trackerHit };
      });
    } finally {
      await page.keyboard.up("w");
    }
    checks.check("the HUD velocity line fits and does not overlap the right column",
      !!vel && vel.warning && vel.right <= vel.width && vel.hit.length === 0, JSON.stringify(vel));
    checks.check("the logbook tracker fits and does not overlap the right column",
      !!vel && !!vel.tracker && vel.tracker.r <= vel.width && vel.trackerHit.length === 0, JSON.stringify(vel && { tracker: vel.tracker, trackerHit: vel.trackerHit }));
  });
}
