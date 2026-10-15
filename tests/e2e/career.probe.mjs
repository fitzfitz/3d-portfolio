import { withPage, settle, readStore, pollUntil, chatterText } from "./harness.mjs";

/**
 * Career landmarks (docs/superpowers/specs/2026-10-15-career-landmarks-design.md):
 * key 4 docks at the career station and opens the Career dossier, key 5 still
 * reaches the contact portal, the habitat ring turns, flying to a buoy shows
 * its card, scanning one reports it, and none of it compiles a new shader
 * program. Physics waits use pollUntil: each read pumps frames under headless
 * SwiftShader (see harness.mjs settle()).
 */
const ready = (page) => page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
const card = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="buoy-card"]');
  return el ? { index: Number(el.dataset.index), opacity: el.style.opacity, text: el.textContent ?? "" } : null;
});
const rects = (page) => page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const cardEl = document.querySelector('[data-testid="buoy-card"]');
  const ringEl = cardEl && [...cardEl.parentElement.children].find((c) => c !== cardEl && c.className.includes("bottom-40"));
  return {
    card: r(cardEl),
    ring: r(ringEl),
    ringOpacity: ringEl ? Number(getComputedStyle(ringEl).opacity) : 0,
    radio: r(document.querySelector('[data-testid="radio-chatter"]')?.parentElement),
  };
});
const overlaps = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const dockedAt = (page, zone) => pollUntil(async () => {
  const s = await readStore(page);
  return s.isOrbitLocked && s.activeZone === zone;
}, { timeoutMs: 15_000, intervalMs: 200 });

export default async function run() {
  return withPage({ label: "career" }, async (page, checks) => {
    await page.evaluate(() => ["fitz-logbook", "fitz-dossiers"].forEach((k) => localStorage.removeItem(k)));
    await page.reload();
    await ready(page);
    await settle(page, 3000);
    const programsBefore = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    const trail = await page.evaluate(async () => {
      const m = await import("/src/data/careerTrail.ts");
      return m.BUOYS.map((b) => ({ id: b.id, pos: [...b.pos], company: b.entry.company }));
    });

    // Read all three planet dossiers: the radio then points at the career station.
    let announced = null;
    let lastClosedAt = 0;
    const watchAnnouncement = async () => {
      const t = (await chatterText(page)) ?? "";
      const b = (await readStore(page)).broadcast?.text ?? "";
      for (const text of [t, b]) if (/CAREER STATION/.test(text) && /PRESS 4/.test(text)) announced = text;
    };
    for (const key of ["Digit1", "Digit2", "Digit3"]) {
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press(key);
      const d = await pollUntil(async () => (await readStore(page)).isOrbitLocked, { timeoutMs: 15_000, intervalMs: 200 });
      checks.check(`${key} docks at a planet`, d.ok);
      await settle(page, 600);
      await page.keyboard.press("Escape");
      lastClosedAt = Date.now();
      // The announcement fires on leaving the last dossier and zone chatter
      // can overwrite it within seconds, so sample while the dock releases.
      await pollUntil(async () => { await watchAnnouncement(); return announced || !(await readStore(page)).isOrbitLocked ? true : null; },
        { timeoutMs: 8_000, intervalMs: 100 });
    }
    await pollUntil(async () => { await watchAnnouncement(); return announced ? true : null; }, { timeoutMs: 8_000, intervalMs: 100 });
    checks.check("after all three dossiers the radio names the career station and key 4", !!announced, announced ?? (await chatterText(page)));
    // The hint is content, not flavour: zone entry / ambient chatter must not
    // overwrite it for 8 s (src/utils/radioHold.ts). Check the line itself ~5 s
    // after the last dossier closed, not just while the dock releases.
    await settle(page, Math.max(0, 5000 - (Date.now() - lastClosedAt)));
    const heldLine = (await chatterText(page)) ?? "";
    checks.check("the next-stop hint is still on the radio ~5 s after the dossier closes",
      /CAREER STATION/.test(heldLine) && /PRESS 4/.test(heldLine), heldLine);

    // [4] Career: jump, dock, dossier, essential.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Digit4");
    checks.check("key 4 jumps to the career station and docks", (await dockedAt(page, "career")).ok);
    await settle(page, 800);
    const dossier = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-labelledby="career-dossier-title"]');
      return d ? { text: d.textContent ?? "", focus: document.activeElement?.getAttribute("aria-label") ?? "" } : null;
    });
    checks.check("docking at the station opens the Career dialog", !!dossier);
    const missing = trail.filter((b) => !(dossier?.text ?? "").includes(b.company)).map((b) => b.company);
    checks.check("the Career dialog lists every role", missing.length === 0, missing.join(", "));
    checks.check("focus moves into the Career dialog", /career dossier/i.test(dossier?.focus ?? ""), dossier?.focus ?? "");
    const st = await readStore(page);
    checks.check("docking records the career essential", st.badges.some((b) => b.id === "career"), JSON.stringify(st.badges));
    await page.keyboard.press("Escape");
    await settle(page, 2500);
    checks.check("Esc closes the Career dialog", !(await readStore(page)).isOrbitLocked);

    // [5] Contact still works.
    await page.keyboard.press("Digit5");
    checks.check("key 5 jumps to the contact portal and docks", (await dockedAt(page, "contact")).ok);
    await settle(page, 800);
    checks.check("the contact portal still opens the contact form",
      await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Contact"]')));
    await page.keyboard.press("Escape");
    await settle(page, 2500);

    // The habitat ring turns (reduced motion is off in this probe).
    const ring = () => page.evaluate(() => {
      let r = null;
      window.__fitz.scene.traverse((o) => { if (r === null && o.name === "HabitatRing") r = o.rotation.y; });
      return r;
    });
    const r0 = await ring();
    for (let i = 0; i < 8; i++) { await settle(page, 200); await readStore(page); }
    const r1 = await ring();
    checks.check("the habitat ring turns", r0 !== null && r1 !== null && r0 !== r1, `${r0} -> ${r1}`);

    // A buoy's card shows nearby and hides when you leave.
    const b2 = trail[2];
    await page.evaluate((p) => { window.__fitz.teleport(p[0] + 2, p[1], p[2]); window.__fitz.setAttitude(0, 0); }, b2.pos);
    const shown = await pollUntil(async () => {
      const c = await card(page);
      return c && c.index === 2 && c.opacity === "1" ? c : null;
    }, { timeoutMs: 10_000, intervalMs: 200 });
    checks.check("flying to a buoy shows its card", shown.ok && shown.value.text.includes(b2.company), JSON.stringify(shown.value));
    const idle = await rects(page);
    checks.check("the buoy card does not overlap the radio panel", !!idle.card && !!idle.radio && !overlaps(idle.card, idle.radio), JSON.stringify(idle));
    await page.evaluate((p) => window.__fitz.teleport(p[0], p[1] + 30, p[2]), b2.pos);
    const hidden = await pollUntil(async () => {
      const c = await card(page);
      return c && c.index === -1 && c.opacity === "0" ? c : null;
    }, { timeoutMs: 10_000, intervalMs: 200 });
    checks.check("leaving a buoy hides its card", hidden.ok, JSON.stringify(await card(page)));

    // Scanning a buoy reports its posting and holds its card from scan range.
    const b3 = trail[3];
    await page.evaluate((p) => { window.__fitz.teleport(p[0], p[1] + 12, p[2]); window.__fitz.flight.input.scan = true; }, b3.pos);
    const report = await pollUntil(async () => {
      const t = (await readStore(page)).broadcast?.text ?? "";
      return t.startsWith("SCAN[CAREER_") ? t : null;
    }, { timeoutMs: 30_000, intervalMs: 300 });
    const scanning = await rects(page);
    await page.evaluate(() => { window.__fitz.flight.input.scan = false; });
    checks.check("scanning a buoy reports its posting", report.ok && report.value.includes(b3.company.toUpperCase()),
      report.value ?? "no report");
    const held = await pollUntil(async () => ((await card(page))?.index === 3 ? true : null), { timeoutMs: 5_000, intervalMs: 200 });
    checks.check("a scanned buoy's card shows from scan range", held.ok, JSON.stringify(await card(page)));

    checks.check("the buoy card does not overlap the scan ring or the radio panel while scanning",
      scanning.ringOpacity > 0 && !overlaps(scanning.card, scanning.ring) && !overlaps(scanning.card, scanning.radio), JSON.stringify(scanning));

    const programsAfter = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    checks.check("the career landmarks compile no new shader program", programsAfter === programsBefore,
      `before=${programsBefore} after=${programsAfter}`);
  });
}
