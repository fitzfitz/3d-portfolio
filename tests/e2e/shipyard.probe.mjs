import { withPage, settle, nextFrames, lockFullFidelity, readStore, pollUntil, chatterText } from "./harness.mjs";

/**
 * Shipyard and dormant gate (docs/superpowers/specs/2026-10-16-shipyard-gate-design.md):
 * key 5 docks at the shipyard and opens the Hangar, an unlocked plume can be
 * picked there (uniform change, no new shader program) while a locked one
 * cannot, Esc closes it, the crane trolley moves; the gate plays its
 * approach line inside the sense radius, scans as an unknown structure, plays
 * its pass line on a flight through the opening, and none of it compiles a
 * new program. Physics waits use pollUntil: each read pumps frames under
 * headless SwiftShader (see harness.mjs settle()).
 */
const ready = (page) => page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
const dockedAt = (page, zone) => pollUntil(async () => {
  const s = await readStore(page);
  return s.isOrbitLocked && s.activeZone === zone;
}, { timeoutMs: 15_000, intervalMs: 200 });
const radioHas = (page, text) => pollUntil(async () => {
  const t = (await chatterText(page)) ?? "";
  const b = (await readStore(page)).broadcast?.text ?? "";
  return t.includes(text) || b.includes(text) ? true : null;
}, { timeoutMs: 15_000, intervalMs: 150 });

export default async function run() {
  return withPage({ label: "shipyard" }, async (page, checks) => {
    await page.evaluate(() => ["fitz-logbook", "fitz-dossiers"].forEach((k) => localStorage.removeItem(k)));
    // A reload drops the low-perf pin: register it first (B1 lesson).
    await page.evaluateOnNewDocument(lockFullFidelity);
    await page.reload();
    await ready(page);
    await settle(page, 3000);
    const programsBefore = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    const { gate, lines } = await page.evaluate(async () => {
      const m = await import("/src/data/dormantGate.ts");
      return { gate: { pos: [...m.GATE_POS], n: [...m.GATE_NORMAL] }, lines: m.GATE_LINES };
    });
    const along = (d) => gate.pos.map((v, i) => v + gate.n[i] * d);

    // [5] Shipyard: jump, dock, Hangar.
    await page.evaluate(() => window.__fitz.store.getState().recordBadge("slingshot"));
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Digit5");
    checks.check("key 5 jumps to the shipyard and docks", (await dockedAt(page, "shipyard")).ok);
    await settle(page, 800);
    const hangar = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="hangar-panel"]');
      return d ? { text: d.textContent ?? "", focus: document.activeElement?.getAttribute("aria-label") ?? "" } : null;
    });
    checks.check("docking at the shipyard opens the Hangar", !!hangar && hangar.text.includes("SHIPYARD // HANGAR"));
    checks.check("focus moves into the Hangar", /close hangar/i.test(hangar?.focus ?? ""), hangar?.focus ?? "");

    // Plume: gold (earned above) changes uColor and adds no program; ring stays locked.
    const glState = () => page.evaluate(() => ({ programs: window.__fitz.gl.info.programs.length, frame: window.__fitz.gl.info.render.frame }));
    const before = await glState();
    await page.click('[data-testid="plume-slingshot"]');
    await settle(page, 600);
    const after = await page.evaluate(() => {
      let hex = null;
      window.__fitz.scene.traverse((o) => {
        const u = o.material?.uniforms;
        if (!hex && u?.uColor && u?.uPower && o.name !== "TractorBeamCone") hex = u.uColor.value.getHexString();
      });
      return { hex, plume: window.__fitz.store.getState().plumeColor };
    });
    checks.check("picking gold in the Hangar sets the plume colour", after.plume === "slingshot" && after.hex === "ffc23d", JSON.stringify(after));
    checks.check("a locked plume cannot be picked",
      await page.evaluate(() => document.querySelector('[data-testid="plume-ring"]')?.disabled === true));
    // A swatch click must not trap the keyboard: Esc still closes the Hangar.
    await page.keyboard.press("Escape");
    await settle(page, 2500);
    checks.check("Esc closes the Hangar after a plume click", !(await readStore(page)).isOrbitLocked);
    // Docked, the scene is frozen (no frame draws, so nothing could compile):
    // count the programs only once the undocked scene has drawn the gold plume.
    await nextFrames(page, 10);
    const drawn = await glState();
    checks.check("a plume colour adds no shader program (counted after frames drew it)",
      drawn.frame > before.frame && drawn.programs === before.programs,
      `before=${before.programs} after=${drawn.programs}, frames ${before.frame} -> ${drawn.frame}`);

    // The crane trolley slides (reduced motion is off in this probe).
    const trolleyX = () => page.evaluate(() => {
      let x = null;
      window.__fitz.scene.traverse((o) => { if (x === null && o.name === "CraneTrolley") x = o.position.x; });
      return x;
    });
    const x0 = await trolleyX();
    for (let i = 0; i < 8; i++) { await settle(page, 200); await readStore(page); }
    const x1 = await trolleyX();
    checks.check("the crane trolley moves", x0 !== null && x1 !== null && x0 !== x1, `${x0} -> ${x1}`);

    // Gate: the approach line plays inside the sense radius.
    await page.evaluate((p) => window.__fitz.teleport(p[0], p[1], p[2]), along(40));
    checks.check("the gate's approach line plays inside its sense radius", (await radioHas(page, lines.approach)).ok,
      (await chatterText(page)) ?? "");

    // Gate: scan from the axis, 20 out (scan range 22 is measured from the frame's radius).
    await page.evaluate((p) => { window.__fitz.teleport(p[0], p[1], p[2]); window.__fitz.flight.input.scan = true; }, along(20));
    const report = await pollUntil(async () => {
      const t = (await readStore(page)).broadcast?.text ?? "";
      return t.startsWith("SCAN[UNKNOWN_STRUCTURE]") ? t : null;
    }, { timeoutMs: 30_000, intervalMs: 300 });
    await page.evaluate(() => { window.__fitz.flight.input.scan = false; });
    checks.check("scanning the gate reports an unknown, dormant structure",
      report.value === "SCAN[UNKNOWN_STRUCTURE] // ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL", report.value ?? "no report");

    // Gate: a flight through the opening plays the pass line. Two short
    // teleports (8 units, under race.ts MAX_STEP 10) straddle the plane.
    await page.evaluate((p) => window.__fitz.teleport(p[0], p[1], p[2]), along(4));
    await settle(page, 400);
    await readStore(page);
    await page.evaluate((p) => window.__fitz.teleport(p[0], p[1], p[2]), along(-4));
    checks.check("flying through the gate plays the pass line", (await radioHas(page, lines.pass)).ok,
      (await chatterText(page)) ?? "");

    // The gate stays nameless outside the scanner: the radio panel (which may
    // show the scan line) and the scan ring's label are excluded; no other HUD text may name it. The
    // chatter test id sits on the typed line, but its sr-only aria-live
    // sibling mirrors the same text, so the whole radio wrapper is excluded.
    const named = await page.evaluate(() => {
      const radio = document.querySelector('[data-testid="radio-chatter"]')?.parentElement;
      // ScanRing's label echoes the scanned target's label while a scan runs
      // (it keeps the last text at opacity 0); it is the scanner itself.
      const ring = document.querySelector('[class*="bottom-40"][class*="left-1/2"]');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let hit = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ((radio && radio.contains(n)) || (ring && ring.contains(n))) continue;
        if (/UNKNOWN_STRUCTURE|DORMANT/.test(n.textContent ?? "")) { hit = n.textContent; break; }
      }
      return hit;
    });
    checks.check("no HUD text names the gate outside the scan line", named === null, named ?? "");

    // [6] Contact.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Digit6");
    checks.check("key 6 jumps to the contact portal and docks", (await dockedAt(page, "contact")).ok);
    await settle(page, 800);
    checks.check("the contact portal opens the contact form",
      await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Contact"]')));
    await page.keyboard.press("Escape");
    await settle(page, 1500);

    const programsAfter = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    checks.check("the shipyard and the gate compile no new shader program", programsAfter === programsBefore,
      `before=${programsBefore} after=${programsAfter}`);
  });
}
