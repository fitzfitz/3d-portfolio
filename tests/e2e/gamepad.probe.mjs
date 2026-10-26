import { withPage, settle, readStore, pollUntil, jumpToProbe } from "./harness.mjs";

// Headless Chrome has no controller, so this installs a fake standard-layout
// pad behind navigator.getGamepads() and fires the connect event the browser
// would send after a real pad's first button press. The hook reads only
// getGamepads(), never the event payload, so a plain Event is enough.
const installPad = (page) => page.evaluate(() => {
  window.__pad = {
    connected: true, mapping: "standard", index: 0, id: "probe pad",
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true, value: () => (window.__pad.connected ? [window.__pad] : []),
  });
  window.dispatchEvent(new Event("gamepadconnected"));
});
const setAxis = (page, i, v) => page.evaluate((i, v) => { window.__pad.axes[i] = v; }, i, v);
const setButton = (page, i, down) => page.evaluate((i, down) => {
  window.__pad.buttons[i] = { pressed: down, value: down ? 1 : 0 };
}, i, down);
const readInput = (page) => page.evaluate(() => ({ ...window.__fitz.flight.input }));
/** Interleaved reads pump rAF under headless SwiftShader (see harness.mjs settle()). */
async function frames(page, n = 6) {
  for (let i = 0; i < n; i++) { await settle(page, 80); await readInput(page); }
}
async function press(page, i) {
  await setButton(page, i, true); await frames(page, 3);
  await setButton(page, i, false); await frames(page, 3);
}

export default async function run() {
  return withPage({ label: "gamepad" }, async (page, checks) => {
    await installPad(page);
    await frames(page);
    let s = await readStore(page);
    checks.check("connecting a pad sets padConnected", s.padConnected === true);
    checks.check("connecting a pad broadcasts the control map, R3 GUIDE included",
      /CONTROLLER LINKED/.test(s.broadcast?.text ?? "") && /R3 GUIDE/.test(s.broadcast?.text ?? ""), s.broadcast?.text ?? "none");

    // An idle pad must not overwrite another input source's channels.
    await page.evaluate(() => { window.__fitz.flight.input.steer = 0.5; });
    await frames(page);
    let input = await readInput(page);
    checks.check("an idle pad leaves touch/keyboard channels alone", input.steer === 0.5,
      `steer=${input.steer}`);
    await page.evaluate(() => { window.__fitz.flight.input.steer = 0; });

    // Left stick right → steer, and the ship actually turns. The hand-set
    // steer above left the ship turning the same way (right: heading falls),
    // so let that turn die out first, or a dead stick passes on the residual.
    const heading = () => page.evaluate(() => window.__fitz.flight.heading);
    const still = await pollUntil(async () => {
      const a = await heading();
      await frames(page, 2);
      return Math.abs((await heading()) - a) < 1e-4;
    }, { timeoutMs: 10_000, intervalMs: 50 });
    checks.check("the ship has stopped turning before the stick test (precondition)", still.ok);
    const headingBefore = await heading();
    await setAxis(page, 0, 1);
    await frames(page, 10);
    input = await readInput(page);
    const headingAfter = await heading();
    checks.check("left stick right sets steer to +1", input.steer === 1, `steer=${input.steer}`);
    // ~0.8 s of full right stick turns ~1 rad; a dead stick turns 0.
    checks.check("left stick turns the ship right", headingBefore - headingAfter > 0.2,
      `heading ${headingBefore.toFixed(3)} -> ${headingAfter.toFixed(3)}`);
    await setAxis(page, 0, 0.05); // resting drift, inside the deadzone
    await frames(page);
    input = await readInput(page);
    checks.check("releasing the stick to resting drift zeroes steer", input.steer === 0,
      `steer=${input.steer}`);

    // Orbit lock, photo mode and Cmd-release zero flight.input behind the pad's
    // back; a stick that is still deflected must win the channel back.
    await setAxis(page, 1, -1); await frames(page);
    await page.evaluate(() => { window.__fitz.flight.input.thrust = 0; });
    await frames(page);
    input = await readInput(page);
    checks.check("a held stick re-asserts thrust after another writer zeroes it", input.thrust === 1,
      `thrust=${input.thrust}`);
    await setAxis(page, 1, 0); await frames(page);

    await setButton(page, 5, true); await frames(page);
    input = await readInput(page);
    checks.check("RB engages warp (boost)", input.boost === true);
    await setButton(page, 5, false); await frames(page);
    input = await readInput(page);
    checks.check("releasing RB releases boost", input.boost === false);

    await setAxis(page, 3, -1); await frames(page);
    input = await readInput(page);
    checks.check("right stick up pitches up (ascend)", input.ascend === true);
    await setAxis(page, 3, 0); await frames(page);

    // R3 (right-stick click) calls the jellyfish guide and sends it back, as J
    // does. A fresh profile has unread dossiers, so it has somewhere to lead.
    const guideState = () => page.evaluate(() => window.__fitz.jellyGuide?.state ?? null);
    await press(page, 11);
    const called = await pollUntil(async () => ((await guideState()) !== "roaming" ? true : null), { timeoutMs: 3000 });
    checks.check("R3 calls the jellyfish guide", called.ok, `state=${await guideState()}`);
    await press(page, 11);
    const sent = await pollUntil(async () => ((await guideState()) === "roaming" ? true : null), { timeoutMs: 3000 });
    checks.check("R3 again sends it back to roaming", sent.ok, `state=${await guideState()}`);

    // D-pad jumps mirror keys 1–4 (up, right, down: the probes; left: the
    // career station); Menu = the contact portal, View = the shipyard.
    // D-pad up parks the ship by probe 1, LB is the beam that grabs it, and
    // B closes its dossier like Esc.
    const landed = await jumpToProbe(page, "ruangrapi", { jump: () => press(page, 12) });
    s = await readStore(page);
    checks.check("d-pad up jumps to probe 1", s.jumpRequest?.id === "ruangrapi" && landed.ok,
      `jump=${s.jumpRequest?.id} landed=${landed.ok}`);
    checks.check("the jump opens nothing", s.openDossier === null);
    const tip = await page.evaluate(() => document.querySelector('[data-testid="hud-probe-tip"]')?.textContent ?? null);
    checks.check("with a pad, the HUD tip says to hold LB", tip === "PROBE IN RANGE // HOLD LB TO GRAB", `tip=${tip}`);
    await setButton(page, 4, true);
    const grabbed = await pollUntil(async () => (await readStore(page)).openDossier === "ruangrapi",
      { timeoutMs: 8_000, intervalMs: 100 });
    await setButton(page, 4, false); await frames(page, 3);
    checks.check("holding LB grabs probe 1 and opens its dossier", grabbed.ok);
    if (grabbed.ok) {
      await press(page, 1);
      s = await readStore(page);
      checks.check("B closes the dossier like Esc", s.openDossier === null);
    }
    await press(page, 14);
    s = await readStore(page);
    checks.check("d-pad left requests the career station", s.jumpRequest?.id === "career",
      `jump=${s.jumpRequest?.id}`);
    // Let that jump dock and close it, so Menu's request is a fresh one.
    const atStation = await pollUntil(async () => (await readStore(page)).isOrbitLocked,
      { timeoutMs: 15_000, intervalMs: 300 });
    if (atStation.ok) await press(page, 1);
    await press(page, 9);
    s = await readStore(page);
    checks.check("Menu requests the contact portal", s.jumpRequest?.id === "contact",
      `jump=${s.jumpRequest?.id}`);
    // Let Menu's jump dock and close it, so View's request is a fresh one.
    const atPortal = await pollUntil(async () => (await readStore(page)).isOrbitLocked,
      { timeoutMs: 15_000, intervalMs: 300 });
    if (atPortal.ok) await press(page, 1);
    await press(page, 8);
    s = await readStore(page);
    checks.check("View requests the shipyard", s.jumpRequest?.id === "shipyard", `jump=${s.jumpRequest?.id}`);

    await press(page, 3);
    s = await readStore(page);
    checks.check("Y toggles photo mode", s.photoMode === true);
    await press(page, 3);

    // Unplugging mid-turn must let go of the stick.
    await setAxis(page, 0, -1); await frames(page);
    await page.evaluate(() => {
      window.__pad.connected = false;
      window.dispatchEvent(new Event("gamepaddisconnected"));
    });
    await frames(page);
    input = await readInput(page);
    s = await readStore(page);
    checks.check("disconnecting mid-turn releases steer", input.steer === 0, `steer=${input.steer}`);
    checks.check("disconnecting clears padConnected", s.padConnected === false);
  });
}
