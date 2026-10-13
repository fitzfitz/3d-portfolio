import { withPage, settle, readStore, pollUntil } from "./harness.mjs";
import { KnownDevices } from "puppeteer-core";

const tracker = (page) => page.evaluate(() => document.querySelector('[data-testid="logbook-tracker"]')?.textContent ?? "");
const liveText = (page) => page.evaluate(() => document.querySelector("[aria-live]")?.textContent ?? "");
const ready = (page) => page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });

async function desktop(page, checks) {
  await page.evaluate(() => ["fitz-logbook", "fitz-plume", "fitz-dossiers", "fitz-shards"].forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await ready(page);
  checks.check("fresh tracker shows 0/10 and the first essential", /LOGBOOK 0\/10.*RUANGRAPI/.test(await tracker(page)), await tracker(page));

  // Jump to planet 1 (ruangrapi): its dossier opens.
  await page.keyboard.press("Digit1");
  const docked = await pollUntil(async () => (await readStore(page)).isOrbitLocked, { timeoutMs: 15_000, intervalMs: 200 });
  checks.check("jump docks at the first planet", docked.ok);
  await page.keyboard.press("KeyL");
  await settle(page, 300);
  checks.check("L does nothing while a dossier is open", !(await readStore(page)).logbookOpen);
  await page.keyboard.press("Escape");
  await settle(page, 2500);
  checks.check("the dossier essential is ticked and the tracker advances",
    /LOGBOOK 1\/10.*FLIGHT-SIM CV/.test(await tracker(page)), await tracker(page));

  // Record two badges through the store, as the hooks do.
  await page.evaluate(() => window.__fitz.store.getState().recordBadge("slingshot"));
  await settle(page, 400);
  checks.check("a recorded badge is announced to screen readers", /SLINGSHOT EARNED/.test(await liveText(page)), await liveText(page));
  await page.evaluate(() => window.__fitz.store.getState().recordBadge("comet"));
  await settle(page, 400);
  checks.check("badges raise the count", /LOGBOOK 3\/10/.test(await tracker(page)), await tracker(page));

  // Panel: L opens with focus on the heading; Esc closes; the HUD button opens.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("KeyL");
  await settle(page, 300);
  const focus = await page.evaluate(() => document.activeElement?.id);
  checks.check("L opens the panel with focus on its heading", focus === "logbook-title", `focus=${focus}`);
  await page.keyboard.press("Escape");
  await settle(page, 300);
  checks.check("Esc closes the panel", !(await readStore(page)).logbookOpen);
  await page.click('[data-testid="logbook-button"]');
  await settle(page, 300);
  checks.check("the HUD button opens the panel", (await readStore(page)).logbookOpen);

  // Plume: gold changes uColor and adds no shader program; a locked one is disabled.
  const before = await page.evaluate(() => window.__fitz.gl.info.programs.length);
  await page.click('[data-testid="plume-slingshot"]');
  await settle(page, 600);
  const after = await page.evaluate(() => {
    let hex = null;
    window.__fitz.scene.traverse((o) => {
      const u = o.material?.uniforms;
      if (!hex && u?.uColor && u?.uPower && o.name !== "TractorBeamCone") hex = u.uColor.value.getHexString();
    });
    return { hex, programs: window.__fitz.gl.info.programs.length, plume: window.__fitz.store.getState().plumeColor };
  });
  checks.check("picking gold sets the plume colour", after.plume === "slingshot" && after.hex === "ffc23d", JSON.stringify(after));
  checks.check("a plume colour adds no shader program", after.programs === before, `before=${before} after=${after.programs}`);
  checks.check("a locked plume cannot be picked",
    await page.evaluate(() => document.querySelector('[data-testid="plume-ring"]')?.disabled === true));

  // Persistence, the tamper guard, and no announcements for old progress.
  await page.evaluate(() => localStorage.setItem("fitz-plume", JSON.stringify("ring")));
  await page.reload();
  await ready(page);
  await settle(page, 1000);
  const st = await readStore(page);
  checks.check("progress survives a reload", st.badges.length === 2 && /LOGBOOK 3\/10/.test(await tracker(page)), await tracker(page));
  checks.check("a tampered plume for a locked badge falls back to stock", st.plumeColor === "stock", `plume=${st.plumeColor}`);
  checks.check("a reload announces nothing for old progress", !/LOGBOOK \/\/|TOUR COMPLETE/.test(await liveText(page)), await liveText(page));
}

async function phone(page, checks) {
  const rect = (id) => page.evaluate((i) => {
    const e = document.querySelector(`[data-testid="${i}"]`);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  }, id);
  checks.check("phone: the tracker shows", !!(await rect("logbook-tracker")));
  checks.check("phone: the logbook button shows", !!(await rect("logbook-button")));
  await page.evaluate(() => window.__fitz.store.getState().setLogbookOpen(true));
  await settle(page, 400);
  const panel = await rect("logbook-panel");
  const vh = await page.evaluate(() => window.innerHeight);
  checks.check("phone: the panel opens as a bottom sheet", !!panel && panel.b <= vh && panel.t > vh * 0.25, JSON.stringify(panel));
  const covered = [];
  for (const id of ["touch-boost", "touch-beam", "touch-rise", "touch-dive"]) {
    const b = await rect(id);
    if (b && panel && b.l < panel.r && panel.l < b.r && b.t < panel.b && panel.t < b.b) covered.push(id);
  }
  checks.check("phone: the open panel does not cover visible flight buttons", covered.length === 0, covered.join(","));

  // The patch notes sheet: same rules.
  await page.evaluate(() => window.__fitz.store.getState().setChangelogOpen(true));
  await settle(page, 400);
  const notes = await rect("changelog-panel");
  checks.check("phone: the patch notes open as a bottom sheet", !!notes && notes.b <= vh && notes.t > vh * 0.25, JSON.stringify(notes));
  const coveredN = [];
  for (const id of ["touch-boost", "touch-beam", "touch-rise", "touch-dive"]) {
    const b = await rect(id);
    if (b && notes && b.l < notes.r && notes.l < b.r && b.t < notes.b && notes.t < b.b) coveredN.push(id);
  }
  checks.check("phone: the open patch notes do not cover visible flight buttons", coveredN.length === 0, coveredN.join(","));
}

async function changelog(page, checks) {
  const n = await page.evaluate(async () => (await import("/src/data/changelog.ts")).CHANGELOG.length);
  // A returning visitor who last saw an older entry gets the dot.
  await page.evaluate(() => localStorage.setItem("fitz-changelog-seen", JSON.stringify("2026-10-10-first-minute-fixes")));
  await page.reload();
  await page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
  checks.check("a returning visitor sees the new-updates dot", !!(await page.$('[data-testid="changelog-dot"]')));
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("KeyN");
  await settle(page, 400);
  const st = await page.evaluate(() => ({
    focus: document.activeElement?.id,
    entries: document.querySelectorAll('[data-testid="changelog-entry"]').length,
    labels: [...document.querySelectorAll('[data-testid="changelog-panel"] dt')].slice(0, 4).map((d) => d.textContent),
  }));
  checks.check("N opens the patch notes with focus on the heading", st.focus === "changelog-title", `focus=${st.focus}`);
  checks.check("every entry is listed", st.entries === n, `${st.entries}/${n}`);
  checks.check("each entry answers what, why, when and how", JSON.stringify(st.labels) === JSON.stringify(["WHAT", "WHY", "WHEN", "HOW"]), JSON.stringify(st.labels));
  checks.check("opening the notes clears the dot", !(await page.$('[data-testid="changelog-dot"]')));
  await page.keyboard.press("KeyL");
  await settle(page, 300);
  const both = await readStore(page);
  checks.check("opening the logbook closes the patch notes", both.logbookOpen && !both.changelogOpen);
  await page.keyboard.press("Escape");
  // First visit: no dot.
  await page.evaluate(() => localStorage.removeItem("fitz-changelog-seen"));
  await page.reload();
  await page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
  checks.check("a first-time visitor sees no dot", !(await page.$('[data-testid="changelog-dot"]')));
  // Résumé section.
  await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(true));
  await settle(page, 800);
  const resume = await page.evaluate(() => document.querySelectorAll('#changelog [data-testid="resume-changelog-entry"]').length);
  checks.check("the résumé lists every changelog entry", resume === n, `${resume}/${n}`);
}

export default async function run() {
  const checks = await withPage({ label: "logbook" }, desktop);
  const p = await withPage({ label: "logbook (phone)", device: KnownDevices["iPhone 13"] }, phone);
  checks.results.push(...p.results);
  const c = await withPage({ label: "changelog" }, changelog);
  checks.results.push(...c.results);
  return checks;
}
