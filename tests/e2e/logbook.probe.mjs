import { withPage, settle, readStore, pollUntil, grabProbe } from "./harness.mjs";
import { KnownDevices } from "puppeteer-core";

const tracker = (page) => page.evaluate(() => document.querySelector('[data-testid="logbook-tracker"]')?.textContent ?? "");
const liveText = (page) => page.evaluate(() => document.querySelector("[aria-live]")?.textContent ?? "");
const ready = (page) => page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });

async function desktop(page, checks) {
  await page.evaluate(() => ["fitz-logbook", "fitz-plume", "fitz-dossiers", "fitz-shards", "fitz-charted"].forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await ready(page);
  checks.check("fresh tracker shows 0/11 and the first essential", /LOGBOOK 0\/11.*RUANGRAPI/.test(await tracker(page)), await tracker(page));

  // Key 1 jumps to probe 1 (ruangrapi); holding F grabs it and its dossier opens.
  await page.evaluate(() => document.activeElement?.blur?.());
  const grabbed = await grabProbe(page, "ruangrapi", { jump: () => page.keyboard.press("Digit1") });
  checks.check("key 1 then holding F opens probe 1's dossier", grabbed.ok, grabbed.landed ? "" : "the jump never landed");
  await settle(page, 600);
  const firstFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
  checks.check("focus moves into the dossier dialog", /dossier/i.test(firstFocus ?? ""), `focus=${firstFocus}`);
  await page.keyboard.press("KeyL");
  await settle(page, 300);
  checks.check("L does nothing while a dossier is open", !(await readStore(page)).logbookOpen);
  await page.keyboard.press("Escape");
  await settle(page, 2500);
  checks.check("the dossier essential is ticked and the tracker advances",
    /LOGBOOK 1\/11.*FLIGHT-SIM CV/.test(await tracker(page)), await tracker(page));
  // The closed probe burns away and its PROBE RELOCATING line goes out when
  // the burn ends; let it land first, so it cannot overwrite the badge
  // announcement below. A logbook line yields to a fresh broadcast
  // (BADGE_LINE_HOLD_MS, 4.5 s), so the announcement is polled for, not read
  // once.
  await pollUntil(async () => ((await readStore(page)).broadcast?.text ?? "").startsWith("PROBE RELOCATING"),
    { timeoutMs: 10_000, intervalMs: 200 });

  // Record two badges through the store, as the hooks do.
  await page.evaluate(() => window.__fitz.store.getState().recordBadge("slingshot"));
  await pollUntil(async () => /SLINGSHOT EARNED/.test(await liveText(page)), { timeoutMs: 8000, intervalMs: 200 });
  checks.check("a recorded badge is announced to screen readers", /SLINGSHOT EARNED/.test(await liveText(page)), await liveText(page));
  await page.evaluate(() => window.__fitz.store.getState().recordBadge("comet"));
  await settle(page, 400);
  checks.check("badges raise the count", /LOGBOOK 3\/11/.test(await tracker(page)), await tracker(page));

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

  // The plume picker moved to the shipyard's Hangar (B2): the logbook points there.
  const pointer = await page.evaluate(() => ({
    text: document.querySelector('[data-testid="logbook-plume-pointer"]')?.textContent ?? "",
    swatches: document.querySelectorAll('[data-testid^="plume-"]').length,
  }));
  checks.check("the logbook points to the shipyard for plumes",
    /ENGINE PLUME: CYAN · CHANGE IT AT THE SHIPYARD \[5\]/.test(pointer.text), pointer.text);
  checks.check("the logbook no longer holds the plume picker", pointer.swatches === 0, `swatches=${pointer.swatches}`);
  // The sheet header sits above the HUD readouts (review #3).
  const onTop = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="logbook-panel"]').getBoundingClientRect();
    const hit = document.elementFromPoint(r.right - 24, r.top + 14);
    return !!hit?.closest('[data-testid="logbook-panel"]');
  });
  checks.check("the open panel's header is not covered by the HUD", onTop);
  await page.keyboard.press("KeyL");
  await settle(page, 300);
  checks.check("L still closes the panel", !(await readStore(page)).logbookOpen);
  // A sheet that closes itself when a dossier opens leaves focus in the
  // dossier (review #5): grab probe 2 with the logbook open.
  await page.click('[data-testid="logbook-button"]');
  await settle(page, 300);
  const second = await grabProbe(page, "portfolio", { jump: () => page.keyboard.press("Digit2") });
  await settle(page, 800);
  const dossierFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
  checks.check("grabbing a probe with the sheet open closes the sheet", second.ok && !(await readStore(page)).logbookOpen,
    `opened=${second.ok}`);
  checks.check("grabbing a probe with a sheet open leaves focus in the dossier", /dossier/i.test(dossierFocus ?? ""), `focus=${dossierFocus}`);
  await page.keyboard.press("Escape");
  await settle(page, 2500);

  // A read dossier re-opens from the logbook, and that moves no probe.
  await page.evaluate(() => window.__fitz.store.getState().setLogbookOpen(true));
  await settle(page, 400);
  const reopen = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="logbook-reopen-ruangrapi"]');
    return b ? { tag: b.tagName, name: b.textContent ?? "" } : null;
  });
  checks.check("a read dossier is a re-open button in the logbook",
    reopen?.tag === "BUTTON" && /^Read the RuangRapi dossier, re-open/.test(reopen.name), JSON.stringify(reopen));
  const spotsBefore = (await readStore(page)).probeSpots;
  const posBefore = await page.evaluate(() => ({ ...window.__fitz.probes.ruangrapi }));
  if (reopen) await page.click('[data-testid="logbook-reopen-ruangrapi"]');
  await settle(page, 800);
  let rs = await readStore(page);
  const reopenFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  checks.check("the logbook's re-open button opens that dossier", rs.openDossier === "ruangrapi" && rs.dossierVia === "logbook",
    `openDossier=${rs.openDossier} via=${rs.dossierVia}`);
  checks.check("re-opening closes the sheet and focuses the dossier", !rs.logbookOpen && /dossier/i.test(reopenFocus), `focus=${reopenFocus}`);
  await page.keyboard.press("Escape");
  await settle(page, 2500);
  rs = await readStore(page);
  const posAfter = await page.evaluate(() => ({ ...window.__fitz.probes.ruangrapi }));
  checks.check("closing a dossier opened from the logbook moves no probe",
    rs.openDossier === null && JSON.stringify(rs.probeSpots) === JSON.stringify(spotsBefore)
      && Math.hypot(posAfter.x - posBefore.x, posAfter.y - posBefore.y, posAfter.z - posBefore.z) < 1e-3,
    `spots ${JSON.stringify(spotsBefore)} -> ${JSON.stringify(rs.probeSpots)}`);

  // Persistence, the tamper guard, and no announcements for old progress.
  await page.evaluate(() => localStorage.setItem("fitz-plume", JSON.stringify("ring")));
  await page.reload();
  await ready(page);
  await settle(page, 1000);
  const st = await readStore(page);
  checks.check("progress survives a reload", st.badges.length === 2 && /LOGBOOK 4\/11/.test(await tracker(page)), await tracker(page));
  checks.check("a tampered plume for a locked badge falls back to stock", st.plumeColor === "stock", `plume=${st.plumeColor}`);
  checks.check("a reload announces nothing for old progress", !/LOGBOOK \/\/|TOUR COMPLETE/.test(await liveText(page)), await liveText(page));

  // Charting: fly next to Ceres and hold scan. It orbits, so the ship is
  // kept beside it (outside its surface, inside scan range).
  checks.check("an uncharted visitor's tracker shows WORLDS 0/9", /WORLDS 0\/9/.test(await tracker(page)), await tracker(page));
  const besideDwarf = () => page.evaluate(() => {
    const d = window.__fitz, b = d.bodies.ceres;
    d.teleport(b.x - 12, b.y, b.z);
    d.flight.input.scan = true;
  });
  const charted = await pollUntil(async () => {
    await besideDwarf();
    return (await readStore(page)).charted.length > 0 ? true : null;
  }, { timeoutMs: 30_000, intervalMs: 300 });
  await page.evaluate(() => { window.__fitz.flight.input.scan = false; });
  const scanned = await readStore(page);
  checks.check("scanning a body charts it", charted.ok && scanned.charted[0]?.id === "ceres", JSON.stringify(scanned.charted));
  checks.check("the body's scan report is on the radio", /^SCAN\[CERES\] \/\/ DWARF PLANET/.test(scanned.broadcast?.text ?? ""), scanned.broadcast?.text);
  const line = await pollUntil(async () => ((await readStore(page)).broadcast?.text ?? "").startsWith("WORLD CHARTED") ? true : null,
    { timeoutMs: 15_000, intervalMs: 300 });
  checks.check("the charting line follows the report", line.ok && /^WORLD CHARTED 1\/9 — CERES: /.test((await readStore(page)).broadcast?.text ?? ""),
    (await readStore(page)).broadcast?.text);
  checks.check("the tracker shows WORLDS 1/9", /WORLDS 1\/9/.test(await tracker(page)), await tracker(page));
  await page.reload();
  await ready(page);
  await settle(page, 1000);
  checks.check("charting survives a reload", /WORLDS 1\/9/.test(await tracker(page)), await tracker(page));
  await page.evaluate(() => window.__fitz.store.getState().setLogbookOpen(true));
  await settle(page, 400);
  const card = await page.evaluate(() => ({
    card: document.querySelector('[data-testid="logbook-world-ceres"]')?.textContent ?? "",
    today: (() => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })(),
    orbit: document.querySelector('[data-testid="system-chart-orbit-ceres"]')?.getAttribute("data-charted"),
    other: document.querySelector('[data-testid="system-chart-orbit-mercury"]')?.getAttribute("data-charted"),
  }));
  checks.check("the logbook card says CHARTED with today's date", card.card.includes(`CHARTED ${card.today}`), card.card);
  checks.check("the system chart draws the charted orbit solid, the rest dashed", card.orbit === "true" && card.other === "false", JSON.stringify(card));
  checks.check("a reload announces nothing for old charting", !/WORLD CHARTED/.test(await liveText(page)), await liveText(page));
  await page.evaluate(() => window.__fitz.store.getState().setLogbookOpen(false));
}

async function phone(page, checks) {
  const rect = (id) => page.evaluate((i) => {
    const e = document.querySelector(`[data-testid="${i}"]`);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  }, id);
  checks.check("phone: the tracker shows", !!(await rect("logbook-tracker")));
  // The radar must sit below the HUD text column (it used to cover the fuel label).
  // It hides while the spawn banner is up, so leave the pad first.
  await page.evaluate(() => { window.__fitz.teleport(150, 60, 150); window.__fitz.setAttitude(0, 0); });
  await settle(page, 800);
  const radar = await rect("radar");
  const fuel = await rect("hud-fuel-bar");
  checks.check("phone: the radar sits below the HUD text column", !!radar && !!fuel && radar.t >= fuel.b,
    JSON.stringify({ radarTop: radar?.t, fuelBottom: fuel?.b }));
  checks.check("phone: the logbook button shows", !!(await rect("logbook-button")));
  await page.evaluate(() => window.__fitz.store.getState().setLogbookOpen(true));
  await settle(page, 400);
  const panel = await rect("logbook-panel");
  const vh = await page.evaluate(() => window.innerHeight);
  checks.check("phone: the panel opens as a bottom sheet", !!panel && panel.b <= vh && panel.t > vh * 0.25, JSON.stringify(panel));
  const shown = [];
  for (const id of ["touch-boost", "touch-beam", "touch-rise", "touch-dive"]) if (await rect(id)) shown.push(id);
  checks.check("phone: flight buttons step aside while the logbook is open", shown.length === 0, shown.join(","));
  const close = await rect("logbook-close");
  checks.check("phone: the logbook's close button is visible", !!close);
  if (close) await page.touchscreen.tap((close.l + close.r) / 2, (close.t + close.b) / 2);
  await settle(page, 400);
  checks.check("phone: tapping close closes the logbook", !(await readStore(page)).logbookOpen);
  checks.check("phone: flight buttons come back after closing", !!(await rect("touch-boost")));

  // The patch notes sheet: same rules.
  await page.evaluate(() => window.__fitz.store.getState().setChangelogOpen(true));
  await settle(page, 400);
  const notes = await rect("changelog-panel");
  checks.check("phone: the patch notes open as a bottom sheet", !!notes && notes.b <= vh && notes.t > vh * 0.25, JSON.stringify(notes));
  const closeN = await rect("changelog-close");
  checks.check("phone: the patch notes' close button is visible", !!closeN);
  if (closeN) await page.touchscreen.tap((closeN.l + closeN.r) / 2, (closeN.t + closeN.b) / 2);
  await settle(page, 400);
  checks.check("phone: tapping close closes the patch notes", !(await readStore(page)).changelogOpen);
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
  const labels = await page.evaluate(() => [...document.querySelectorAll('#changelog [data-testid="resume-changelog-entry"]:first-child dt')].map((d) => d.textContent));
  checks.check("résumé entries answer what, why, when and how", JSON.stringify(labels) === JSON.stringify(["WHAT", "WHY", "WHEN", "HOW"]), JSON.stringify(labels));
}

export default async function run() {
  const checks = await withPage({ label: "logbook" }, desktop);
  const p = await withPage({ label: "logbook (phone)", device: KnownDevices["iPhone 13"] }, phone);
  checks.results.push(...p.results);
  const c = await withPage({ label: "changelog" }, changelog);
  checks.results.push(...c.results);
  return checks;
}
