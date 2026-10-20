import { withPage, settle, readStore, pollUntil, chatterText, nextFrames, lockFullFidelity, jumpToProbe, holdBeamUntilOpen, grabProbe, probeRelocating } from "./harness.mjs";

/**
 * Project probes (docs/superpowers/specs/2026-10-20-project-probes-design.md):
 * key 1 parks the ship by probe 1 without opening anything, holding F pulls
 * it in and opens its dossier (the scene freezes), closing it sends the
 * probe to its next spot with a burn and a radio line, the spot survives a
 * reload, reduced motion snaps the relocation, and photo mode grabs nothing.
 */
const ID = "ruangrapi";

/** The probe's def and the position of spot `n` (src/utils/probes.ts spotPos). */
const spot = (page, id, n) => page.evaluate(async (i, k) => {
  const { PROBES } = await import("/src/data/probes.ts");
  const { spotPos } = await import("/src/utils/probes.ts");
  return [...spotPos(PROBES.find((p) => p.id === i), k)];
}, id, n);
const probeAt = (page, id) => page.evaluate((i) => { const p = window.__fitz.probes[i]; return [p.x, p.y, p.z]; }, id);
const same = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const fmt = (v) => `(${v.map((n) => n.toFixed(1)).join(", ")})`;

/**
 * The radar's probe diamonds on its latest complete frame. RadarMap draws on
 * its own rAF loop, so its context is wrapped to log each filled four-point
 * diamond path (the probe marker: a PROBE_DIAMOND, 3.5 px, half-diagonal) with its fill
 * colour and centre; a clearRect starts a new frame's log. Read after a few
 * frames, outside the radar's own callback, so the log is one whole frame.
 */
const radarDiamonds = (page) => page.evaluate(async () => {
  const cv = document.querySelector('[data-testid="radar-canvas"]');
  if (!cv) return null;
  const ctx = cv.getContext("2d");
  const orig = { begin: ctx.beginPath, move: ctx.moveTo, line: ctx.lineTo, fill: ctx.fill, clear: ctx.clearRect };
  let path = [], frame = [], last = null;
  ctx.clearRect = function (...a) { if (frame.length) last = frame; frame = []; return orig.clear.apply(this, a); };
  ctx.beginPath = function (...a) { path = []; return orig.begin.apply(this, a); };
  ctx.moveTo = function (x, y) { path.push([x, y]); return orig.move.call(this, x, y); };
  ctx.lineTo = function (x, y) { path.push([x, y]); return orig.line.call(this, x, y); };
  ctx.fill = function (...a) {
    const [p0, p1] = path;
    if (path.length === 4 && Math.abs(p1[0] - p0[0] - 3.5) < 1e-6 && Math.abs(p1[1] - p0[1] - 3.5) < 1e-6) {
      frame.push({ color: String(this.fillStyle).toLowerCase(), x: p0[0], y: p0[1] + 3.5 });
    }
    return orig.fill.apply(this, a);
  };
  await new Promise((r) => { let n = 0; const t = () => (++n >= 4 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  // The wrappers are own properties: deleting them restores the prototype's.
  delete ctx.beginPath; delete ctx.moveTo; delete ctx.lineTo; delete ctx.fill; delete ctx.clearRect;
  const size = cv.clientWidth;
  return { size, diamonds: last ?? frame };
});
const projectColors = (page) => page.evaluate(async () => {
  const { PROBE_IDS } = await import("/src/data/probes.ts");
  const { projectById } = await import("/src/constants.ts");
  return PROBE_IDS.map((id) => ({ id, color: projectById(id).color.toLowerCase() }));
});

async function grabAndRelocate(page, checks) {
  // withPage's fresh profile holds no fitz-probes: every probe starts at home.
  // Pinned before the reload in step 4, which would otherwise drop the pin.
  await page.evaluateOnNewDocument(lockFullFidelity);
  const home = await spot(page, ID, 0);
  checks.check("a fresh visitor's probe 1 floats at its home spot (precondition)", same(await probeAt(page, ID), home),
    `${fmt(await probeAt(page, ID))} home ${fmt(home)}`);

  // 1. Key 1 parks the ship by probe 1 and opens nothing.
  await page.evaluate(() => document.activeElement?.blur?.());
  const landed = await jumpToProbe(page, ID, { jump: () => page.keyboard.press("Digit1") });
  const dist = await page.evaluate((i) => {
    const p = window.__fitz.probes[i], f = window.__fitz.flight;
    return Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z);
  }, ID);
  checks.check("key 1 parks the ship within 30 u of probe 1", landed.ok && dist <= 30, `dist=${dist.toFixed(1)}`);
  await settle(page, 600);
  let s = await readStore(page);
  checks.check("the jump opens nothing", s.openDossier === null && !s.isOrbitLocked, `openDossier=${s.openDossier}`);
  checks.check("probe 1 is the probe in range after the jump", s.probeNear === ID, `probeNear=${s.probeNear}`);
  const tip = await page.evaluate(() => document.querySelector('[data-testid="hud-probe-tip"]')?.textContent ?? null);
  checks.check("the HUD tip says to hold F", tip === "PROBE IN RANGE // HOLD F TO GRAB", `tip=${tip}`);
  const colors = await projectColors(page);
  const radar = await radarDiamonds(page);
  const drawn = colors.filter(({ color }) => radar?.diamonds.some((d) => d.color === color));
  checks.check("the radar shows 3 probe blips, one per project colour",
    radar?.diamonds.length === 3 && drawn.length === 3, JSON.stringify(radar));
  const one = radar?.diamonds.find((d) => d.color === colors[0].color);
  const c = (radar?.size ?? 0) / 2;
  // 12 u dead ahead: just above the radar's centre (heading-up, 220 u to the rim).
  checks.check("probe 1's blip sits just ahead of the ship on the radar",
    !!one && Math.abs(one.x - c) < 1.5 && one.y < c && c - one.y < 6, JSON.stringify({ one, centre: c }));

  // 2. Hold F: the probe comes in and its dossier opens over a frozen scene.
  const opened = await holdBeamUntilOpen(page, ID);
  s = await readStore(page);
  checks.check("holding F pulls probe 1 in and opens its dossier",
    opened.ok && s.openDossier === ID && s.dossierVia === "probe", `openDossier=${s.openDossier} via=${s.dossierVia}`);
  await settle(page, 600);
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-labelledby="dossier-title"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== "hidden", title: d.querySelector("#dossier-title")?.textContent ?? "",
      focus: document.activeElement?.getAttribute("aria-label") ?? "" };
  });
  checks.check("the dossier dialog is visible", !!dialog?.visible, JSON.stringify(dialog));
  checks.check("focus moves into the dossier", /dossier/i.test(dialog?.focus ?? ""), dialog?.focus ?? "");
  const f0 = await page.evaluate(() => window.__fitz.gl.info.render.frame);
  const t0 = await page.evaluate(() => window.__fitz.flight.x);
  await settle(page, 1000);
  await nextFrames(page, 10);
  const f1 = await page.evaluate(() => window.__fitz.gl.info.render.frame);
  const frozen = await page.evaluate(async () => {
    const { selectSceneFrozen } = await import("/src/store/spaceStore.ts");
    return selectSceneFrozen(window.__fitz.store.getState());
  });
  checks.check("the canvas is frozen behind the dossier", frozen && f1 === f0, `frozen=${frozen} frame ${f0} -> ${f1}`);
  checks.check("the ship holds still behind the dossier", (await page.evaluate(() => window.__fitz.flight.x)) === t0);

  // 3. Esc: the probe burns away and settles at spot 1 within RELOCATE_S + 1 s;
  // the radio says where it went. F held through the burn grabs nothing: a
  // relocating probe cannot be taken.
  const RELOCATE_S = await page.evaluate(async () => (await import("/src/utils/probes.ts")).RELOCATE_S);
  const next = await spot(page, ID, 1);
  await page.evaluate((i, target) => {
    const rec = { tClose: null, tSettled: null, moving: 0, line: null };
    window.__relocRec = rec;
    const unsub = window.__fitz.store.subscribe((st) => {
      if (rec.tClose === null && st.openDossier === null) rec.tClose = performance.now();
      if (st.broadcast?.text?.startsWith("PROBE RELOCATING")) rec.line = st.broadcast.text;
    });
    const step = () => {
      const p = window.__fitz.probes[i];
      const at = Math.abs(p.x - target[0]) < 1e-3 && Math.abs(p.y - target[1]) < 1e-3 && Math.abs(p.z - target[2]) < 1e-3;
      if (rec.tClose !== null && !at) rec.moving++;
      if (rec.tClose !== null && at) { rec.tSettled = performance.now(); unsub(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, ID, next);
  await page.keyboard.press("Escape");
  await page.keyboard.down("KeyF");
  let reopened = false;
  const settled = await pollUntil(async () => {
    reopened = reopened || (await readStore(page)).openDossier !== null;
    return page.evaluate(() => window.__relocRec.tSettled !== null);
  }, { timeoutMs: (RELOCATE_S + 6) * 1000, intervalMs: 100 });
  await page.keyboard.up("KeyF");
  const rec = await page.evaluate(() => ({ ...window.__relocRec }));
  const took = rec.tSettled !== null && rec.tClose !== null ? (rec.tSettled - rec.tClose) / 1000 : Infinity;
  s = await readStore(page);
  checks.check("Esc closes the dossier and moves probe 1 on to spot 1", s.openDossier === null && s.probeSpots[ID] === 1,
    `probeSpots=${JSON.stringify(s.probeSpots)} stored=${await page.evaluate(() => localStorage.getItem("fitz-probes"))}`);
  checks.check(`probe 1 reaches spot 1 within RELOCATE_S + 1 s (${RELOCATE_S + 1} s)`, settled.ok && took <= RELOCATE_S + 1,
    `took ${took.toFixed(2)} s over ${rec.moving} moving frames, now ${fmt(await probeAt(page, ID))} want ${fmt(next)}`);
  checks.check("the relocation is a visible burn, not a jump cut", rec.moving > 5, `moving frames=${rec.moving}`);
  checks.check("F held through the burn grabs nothing (a relocating probe cannot be taken)", !reopened);
  const line = rec.line ?? "";
  // The radio types 22 ms a character: wait for the line to show.
  const typed = await pollUntil(async () => ((await chatterText(page)) ?? "").includes("PROBE RELOCATING"), { timeoutMs: 3000, intervalMs: 100 });
  const shown = (await chatterText(page)) ?? "";
  checks.check("the radio says PROBE RELOCATING with a bearing and distance",
    /^PROBE RELOCATING \/\/ RUANGRAPI SIGNAL REACQUIRED BEARING \d{3} AT \d+ U$/.test(line) && typed.ok,
    `broadcast="${line}" radio="${shown}"`);
  checks.check("probe 1 is idle at its new spot", !(await probeRelocating(page, ID)));
  const radar2 = await radarDiamonds(page);
  const moved = await page.evaluate(async (i) => {
    const { worldToRadar, radarBlip, RADAR_RANGE } = await import("/src/utils/radarTransform.ts");
    const p = window.__fitz.probes[i], f = window.__fitz.flight;
    const c = 74, rimR = c - 6;
    const { x, up } = worldToRadar(p.x - f.x, p.z - f.z, f.heading);
    const b = radarBlip(x, up, rimR / RADAR_RANGE, rimR, true);
    return { x: c + b.px, y: c + b.py };
  }, ID);
  const blip = radar2?.diamonds.find((d) => d.color === colors[0].color);
  checks.check("the radar follows probe 1 to its new spot", !!blip && Math.hypot(blip.x - moved.x, blip.y - moved.y) < 1.5,
    JSON.stringify({ blip, want: moved }));

  // 4. Reload: the spot and the read dossier persist.
  await page.reload();
  await page.waitForFunction(() => window.__fitz?.store.getState().sceneReady && !!window.__fitz.probes, { timeout: 60_000 });
  await settle(page, 1000);
  const after = await probeAt(page, ID);
  s = await readStore(page);
  checks.check("after a reload probe 1 is still at spot 1", same(after, next) && s.probeSpots[ID] === 1,
    `${fmt(after)} want ${fmt(next)} spots=${JSON.stringify(s.probeSpots)}`);
  checks.check("after a reload the dossier is still read", s.visitedDossiers.includes(ID), JSON.stringify(s.visitedDossiers));
}

/** Reduced motion: no burn; the probe is at its new spot on the first frame drawn after the close. */
async function reducedMotion(page, checks) {
  const got = await grabProbe(page, ID);
  checks.check("reduced motion: grabbing probe 1 opens its dossier", got.ok, got.landed ? "" : "the jump never landed");
  if (!got.ok) return;
  const next = await spot(page, ID, 1);
  // Scene renders after the close, each with the probe's position: the first
  // already has it at spot 1 (ProjectProbes' frame runs before the render).
  await page.evaluate(() => {
    const scene = window.__fitz.scene;
    const prev = scene.onAfterRender;
    const rec = { renders: [], prev };
    window.__rmRec = rec;
    scene.onAfterRender = function (...a) {
      prev.apply(this, a);
      const p = window.__fitz.probes.ruangrapi;
      if (rec.renders.length < 30) rec.renders.push([p.x, p.y, p.z]);
    };
    window.__fitz.store.getState().closeDossier();
  });
  await pollUntil(() => page.evaluate(() => window.__rmRec.renders.length >= 10), { timeoutMs: 10_000, intervalMs: 100 });
  const renders = await page.evaluate(() => {
    const rec = window.__rmRec;
    window.__fitz.scene.onAfterRender = rec.prev;
    return rec.renders;
  });
  checks.check("reduced motion: a close relocates the probe within one frame",
    renders.length > 0 && renders.every((p) => same(p, next)),
    `first render ${renders[0] ? fmt(renders[0]) : "none"}, ${renders.filter((p) => !same(p, next)).length}/${renders.length} renders off the spot, want ${fmt(next)}`);
  const line = (await readStore(page)).broadcast?.text ?? "";
  checks.check("reduced motion: the radio still says PROBE RELOCATING", line.startsWith("PROBE RELOCATING // RUANGRAPI"), line);
}

/** Photo mode: the beam is off, so holding F beside a probe opens nothing. */
async function photoMode(page, checks) {
  const landed = await jumpToProbe(page, ID);
  checks.check("photo mode: parked beside probe 1 (precondition)", landed.ok);
  await settle(page, 500);
  await page.keyboard.press("KeyP");
  await settle(page, 300);
  const before = await probeAt(page, ID);
  await page.keyboard.down("KeyF");
  let beam = false;
  // 3 s: three times what an unblocked grab from 12 u takes.
  for (let i = 0; i < 30; i++) {
    await settle(page, 100);
    beam = beam || await page.evaluate(() => window.__fitz.beam?.active === true);
  }
  await page.keyboard.up("KeyF");
  const s = await readStore(page);
  const after = await probeAt(page, ID);
  checks.check("photo mode: holding F beside a probe opens nothing", s.photoMode && s.openDossier === null,
    `photoMode=${s.photoMode} openDossier=${s.openDossier}`);
  checks.check("photo mode: the probe is not pulled and the beam stays off", same(before, after) && !beam,
    `${fmt(before)} -> ${fmt(after)} beam=${beam}`);
  await page.keyboard.press("KeyP");
}

/**
 * A jump key pressed while a probe dossier is open. Current behaviour
 * (App.tsx's number keys and the pad's d-pad both call requestJump, which
 * Spaceship's frame loop applies): the request is held while the dossier
 * freezes the scene, the dossier stays open, and the jump lands after the
 * dossier closes.
 */
async function jumpUnderDossier(page, checks) {
  const got = await grabProbe(page, ID);
  checks.check("jump under a dossier: probe 1's dossier is open (precondition)", got.ok);
  if (!got.ok) return;
  const before = await page.evaluate(() => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
  await page.keyboard.press("Digit2");
  await settle(page, 1000);
  await nextFrames(page, 3).catch(() => {});
  const s = await readStore(page);
  const after = await page.evaluate(() => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
  const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
  checks.check("jump under a dossier: key 2 keeps the dossier open and holds the jump (the ship has not moved)",
    s.openDossier === ID && s.jumpRequest?.id === "portfolio" && moved < 1e-6,
    `openDossier=${s.openDossier} jump=${s.jumpRequest?.id} moved=${moved.toFixed(3)}`);
  await page.keyboard.press("Escape");
  const landed = await pollUntil(() => page.evaluate(() => {
    const p = window.__fitz.probes.portfolio, f = window.__fitz.flight;
    return Math.abs(Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z) - 12) < 0.75;
  }), { timeoutMs: 10_000, intervalMs: 100 });
  checks.check("jump under a dossier: the held jump lands beside probe 2 once Esc closes the dossier",
    landed.ok && (await readStore(page)).openDossier === null);
}

/**
 * The last unread dossier closed by the classic-CV round trip: no burn plays
 * (the remounted canvas snaps the probe to its spot), so no relocation line
 * goes out; the next-stop hint must still arrive once the cabin is back.
 */
function seedTwoRead() {
  localStorage.setItem("fitz-dossiers", JSON.stringify(["portfolio", "fuxx"]));
}
async function classicRoundTrip(page, checks) {
  const got = await grabProbe(page, ID);
  checks.check("round trip: grabbing the last unread probe opens its dossier", got.ok);
  if (!got.ok) return;
  await page.evaluate(() => {
    window.__rtLog = [];
    window.__fitz.store.subscribe((st) => st.broadcast, (b) => { if (b) window.__rtLog.push(b.text); });
    window.__fitz.store.getState().setShowClassicCV(true);
  });
  await settle(page, 1500);
  const during = await page.evaluate(() => window.__rtLog.slice());
  await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(false));
  const hint = await pollUntil(() => page.evaluate(() => window.__rtLog.find((t) => t.startsWith("ALL 3 DOSSIERS READ // NEXT STOP")) ?? null),
    { timeoutMs: 30_000, intervalMs: 200 });
  checks.check("round trip: no hint behind the classic résumé", !during.some((t) => t.startsWith("ALL 3 DOSSIERS READ")), JSON.stringify(during));
  checks.check("round trip: the next-stop hint arrives once the cabin is back", hint.ok, hint.value ?? JSON.stringify(await page.evaluate(() => window.__rtLog)));
}

export default async function run() {
  const checks = await withPage({ label: "probes" }, grabAndRelocate);
  for (const [label, fn, opts] of [
    ["probes: reduced motion", reducedMotion, { emulateReducedMotion: true }],
    ["probes: photo mode", photoMode, {}],
    ["probes: jump key under an open dossier", jumpUnderDossier, {}],
    ["probes: classic-CV round trip on the last dossier", classicRoundTrip, { initScript: seedTwoRead }],
  ]) {
    const c = await withPage({ label, ...opts }, fn);
    checks.results.push(...c.results);
  }
  return checks;
}
