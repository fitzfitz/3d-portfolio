import { withPage, settle, lockFullFidelity, readStore, pollUntil, chatterText, grabProbe } from "./harness.mjs";

/**
 * Career landmarks (docs/superpowers/specs/2026-10-15-career-landmarks-design.md):
 * once the three probe dossiers are read the radio points at key 4, key 4
 * docks at the career station and opens the Career dossier, key 6 still
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
    // The reload rebuilds the store with lowPerfManual false; pin full fidelity
    // first so a load-induced tier decline cannot recompile every material.
    await page.evaluateOnNewDocument(lockFullFidelity);
    await page.reload();
    await ready(page);
    await settle(page, 3000);
    const programsBefore = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    const lowPerfBefore = await page.evaluate(() => window.__fitz.store.getState().isLowPerf);
    const trail = await page.evaluate(async () => {
      const m = await import("/src/data/careerTrail.ts");
      return m.BUOYS.map((b) => ({ id: b.id, pos: [...b.pos], company: b.entry.company }));
    });

    // Read all three probe dossiers (key 1-3, then hold F): the radio then
    // points at the career station. Ruling R12: after the last close, that
    // probe's PROBE RELOCATING line plays first, and the next-stop hint goes
    // out once the relocation has finished, so the burn's line cannot cut the
    // hint's 8 s hold short. An in-page store subscription logs every
    // broadcast with its time, so the order is read, not raced.
    await page.evaluate(() => {
      window.__careerLog = [];
      window.__fitz.store.subscribe((st) => st.broadcast, (b) => {
        if (b) window.__careerLog.push({ text: b.text, t: performance.now() });
      });
    });
    for (const [key, id] of [["Digit1", "ruangrapi"], ["Digit2", "portfolio"], ["Digit3", "fuxx"]]) {
      await page.evaluate(() => document.activeElement?.blur?.());
      const g = await grabProbe(page, id, { jump: () => page.keyboard.press(key) });
      checks.check(`${key} then holding F opens the ${id} probe's dossier`, g.ok, g.landed ? "" : "the jump never landed");
      await settle(page, 600);
      await page.evaluate(() => { window.__careerClosedAt = performance.now(); });
      await page.keyboard.press("Escape");
      await pollUntil(async () => (await readStore(page)).openDossier === null, { timeoutMs: 8_000, intervalMs: 100 });
    }
    const isHint = (text) => /CAREER STATION/.test(text) && /PRESS 4/.test(text);
    const got = await pollUntil(() => page.evaluate(() => window.__careerLog.some((e) => /CAREER STATION/.test(e.text) && /PRESS 4/.test(e.text))),
      { timeoutMs: 15_000, intervalMs: 100 });
    const log = await page.evaluate(() => ({ entries: window.__careerLog.filter((e) => e.t >= window.__careerClosedAt), closedAt: window.__careerClosedAt }));
    const hintAt = log.entries.findIndex((e) => isHint(e.text));
    const relocAt = log.entries.findIndex((e) => e.text.startsWith("PROBE RELOCATING // FUXX"));
    const hint = hintAt >= 0 ? log.entries[hintAt] : null;
    checks.check("after all three dossiers the radio names the career station and key 4", got.ok && !!hint, hint?.text ?? (await chatterText(page)));
    checks.check("the last probe's PROBE RELOCATING line plays before the next-stop hint",
      relocAt >= 0 && hintAt > relocAt,
      log.entries.map((e) => `${((e.t - log.closedAt) / 1000).toFixed(2)}s ${e.text.slice(0, 40)}`).join(" | "));
    // The hint is content, not flavour: zone entry / ambient chatter and the
    // relocation line must not overwrite it for 8 s (src/utils/radioHold.ts).
    // Check the line itself ~5 s after it went out (the relocation finished
    // then). Under load the polls above can run long; past 7 s the 8 s hold is
    // nearly over and the check would measure the probe's lateness, not the hold.
    const sinceHint = hint ? await page.evaluate((t) => performance.now() - t, hint.t) : Infinity;
    checks.check("precondition: the hint was caught in time to test the hold", sinceHint <= 7000,
      `${sinceHint.toFixed(0)}ms after the hint went out`);
    await settle(page, Math.max(0, 5000 - sinceHint));
    const heldLine = (await chatterText(page)) ?? "";
    const heldFor = hint ? await page.evaluate((t) => performance.now() - t, hint.t) : NaN;
    checks.check("the next-stop hint is still on the radio ~5 s after the relocation completes",
      isHint(heldLine), `${heldFor.toFixed(0)}ms after the hint: ${heldLine}`);

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

    // [6] Contact still works (the shipyard took 5).
    await page.keyboard.press("Digit6");
    checks.check("key 6 jumps to the contact portal and docks", (await dockedAt(page, "contact")).ok);
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
      `before=${programsBefore} after=${programsAfter} isLowPerf before=${lowPerfBefore} after=${await page.evaluate(() => window.__fitz.store.getState().isLowPerf)}`);
  });
}
