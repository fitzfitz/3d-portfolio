import { withPage, tap, settle, nextFrames, readStore, pollUntil, PLANET_STANDOFF } from "./harness.mjs";
import { KnownDevices } from "puppeteer-core";

const readInput = (page) => page.evaluate(() => ({ ...window.__fitz.flight.input }));

export default async function run() {
  return withPage({ label: "touch", device: KnownDevices["iPhone 13"] }, async (page, checks) => {
    // Assert the controls actually mounted first. They gate on
    // `(pointer: coarse)`; if emulation stops matching that query, every
    // downstream tap would "pass" against a control that isn't there.
    const mounted = await page.$('[data-testid="touch-joystick"]');
    checks.check("TouchControls mounts under touch emulation", !!mounted);
    if (!mounted) return;

    const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
    checks.check("emulated viewport reports pointer: coarse", coarse);

    // The flight buttons are thumbed mid-flight without looking: every pair
    // needs a real gap, or reaching for BOOST lands on BEAM.
    const gaps = await page.evaluate(() => {
      const ids = ["touch-rise", "touch-dive", "touch-beam", "touch-boost", "touch-guide"];
      const r = Object.fromEntries(ids.map((id) => [id, document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect()]));
      const gap = (a, b) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
      const out = [];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = r[ids[i]], b = r[ids[j]];
        if (a && b) out.push({ pair: `${ids[i]}/${ids[j]}`, gap: Math.round(gap(a, b)) });
      }
      return out;
    });
    const tight = gaps.filter((g) => g.gap < 8);
    checks.check("touch flight buttons keep at least 8px between them", gaps.length === 10 && tight.length === 0,
      tight.map((g) => `${g.pair}=${g.gap}px`).join(" ") || `${gaps.length} pairs checked`);

    // Joystick: drag right-and-up from the middle of the left half.
    const vp = page.viewport();
    const cx = Math.round(vp.width * 0.25), cy = Math.round(vp.height * 0.6);
    await page.touchscreen.touchStart(cx, cy);
    await settle(page, 200);
    await page.touchscreen.touchMove(cx + 55, cy - 45);
    await settle(page, 400);
    const dragging = await readInput(page);
    await page.touchscreen.touchEnd();
    await settle(page, 300);
    const released = await readInput(page);

    checks.check("joystick drag sets analog steer", Math.abs(dragging.steer) > 0.1,
      `steer=${dragging.steer.toFixed(3)}`);
    checks.check("joystick drag sets analog thrust", Math.abs(dragging.thrust) > 0.1,
      `thrust=${dragging.thrust.toFixed(3)}`);
    checks.check("releasing the joystick zeroes steer and thrust",
      released.steer === 0 && released.thrust === 0,
      `steer=${released.steer} thrust=${released.thrust}`);

    // RISE / DIVE drive the pitch inputs.
    await tap(page, "touch-rise", 600);
    const afterRise = await readInput(page);
    checks.check("RISE releases the ascend input cleanly", afterRise.ascend === false,
      `ascend=${afterRise.ascend}`);

    // The tap leaves the nose coasting up toward PITCH_MAX (1.45; measured
    // 0.56 -> 1.25 at release), and that coast alone beat the old +0.01 bar
    // with a dead RISE. Level the nose (setAttitude also stops the pitch),
    // check it holds still, then hold RISE with interleaved reads (see the
    // DIVE comment below) and require a real climb: 1.5 s at up to 1.8 rad/s.
    const pitchNow = () => page.evaluate(() => window.__fitz.flight.pitch);
    await page.evaluate(() => window.__fitz.setAttitude(window.__fitz.flight.heading, 0));
    await nextFrames(page, 3); // flight.pitch is published by the frame loop
    const pitchBefore = await pitchNow();
    await settle(page, 300);
    const pitchStill = await pitchNow();
    checks.check("the nose is level and still before the RISE hold (precondition)",
      Math.abs(pitchBefore) < 1e-6 && Math.abs(pitchStill - pitchBefore) < 1e-4, `pitch ${pitchBefore.toFixed(4)} -> ${pitchStill.toFixed(4)}`);
    const el = await page.$('[data-testid="touch-rise"]');
    const box = await el.boundingBox();
    await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
    let held = null;
    let pitchAfter = pitchBefore;
    for (let i = 0; i < 6; i++) {
      await settle(page, 250);
      pitchAfter = await pitchNow();
      if (i === 0) held = await readInput(page); // the flag while still held
    }
    await page.touchscreen.touchEnd();
    checks.check("holding RISE sets ascend", held?.ascend === true);
    checks.check("holding RISE pitches the nose up", pitchAfter - pitchBefore > 0.2,
      `pitch ${pitchBefore.toFixed(3)} -> ${pitchAfter.toFixed(3)}`);

    // Hold DIVE with interleaved reads rather than one long blind settle (as
    // the RISE hold above already does). Verified independently: a single
    // uninterrupted `settle(ms)` call is pure node-side setTimeout with zero
    // CDP traffic, and this headless/SwiftShader Chrome barely services its
    // own requestAnimationFrame loop while idle between protocol commands —
    // so physics (which runs on rAF) advances far slower than wall-clock time
    // during a blind wait. Each interleaved evaluate() is a CDP round-trip
    // that pumps the browser's task queue and reliably ticks frames forward.
    // Under this pattern the pitch step function and DIVE's wiring behave
    // exactly as expected: pitch decreases monotonically once residual RISE
    // momentum unwinds (a few hundred ms of *simulated* time).
    const diveEl = await page.$('[data-testid="touch-dive"]');
    const diveBox = await diveEl.boundingBox();
    await page.touchscreen.touchStart(diveBox.x + diveBox.width / 2, diveBox.y + diveBox.height / 2);
    let pitchDived = pitchAfter;
    let divingInput = null;
    for (let i = 0; i < 9; i++) {
      await settle(page, 300);
      pitchDived = await page.evaluate(() => window.__fitz.flight.pitch);
      if (i === 0) divingInput = await readInput(page); // capture the flag while still held
    }
    await page.touchscreen.touchEnd();
    // Mirrors RISE's "holding RISE sets ascend" check: without this, a
    // regression where DIVE's handler stopped setting `descend` could slip
    // through undetected, because pitch alone can still drift down from
    // RISE's residual velocity unwinding (see the interleaved-read comment
    // above) even if DIVE's own input flag never fires.
    checks.check("holding DIVE sets descend", divingInput?.descend === true,
      `descend=${divingInput?.descend}`);
    checks.check("DIVE pitches the nose back down", pitchDived < pitchAfter,
      `pitch ${pitchAfter.toFixed(3)} -> ${pitchDived.toFixed(3)}`);

    // BOOST.
    const boostEl = await page.$('[data-testid="touch-boost"]');
    const bb = await boostEl.boundingBox();
    await page.touchscreen.touchStart(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await settle(page, 400);
    const boosting = await readInput(page);
    await page.touchscreen.touchEnd();
    checks.check("BOOST sets the boost input", boosting.boost === true);

    const beamEl = await page.$('[data-testid="touch-beam"]');
    const eb = await beamEl.boundingBox();
    await page.touchscreen.touchStart(eb.x + eb.width / 2, eb.y + eb.height / 2);
    await settle(page, 400);
    const beaming = await readInput(page);
    await page.touchscreen.touchEnd();
    await settle(page, 200);
    const beamReleased = await readInput(page);
    checks.check("BEAM sets the beam input while held", beaming.beam === true);
    checks.check("releasing BEAM clears the beam input", beamReleased.beam === false);

    // GUIDE calls the jellyfish guide and sends it back, as J does (a fresh
    // profile has unread dossiers, so it has somewhere to lead).
    // It fires on click (a tap), and aria-pressed follows the guide.
    const guideState = () => page.evaluate(() => window.__fitz.jellyGuide?.state ?? null);
    const pressed = () => page.$eval('[data-testid="touch-guide"]', (b) => b.getAttribute("aria-pressed"));
    await tap(page, "touch-guide", 300);
    const called = (await pollUntil(async () => ((await guideState()) !== "roaming" ? true : null), { timeoutMs: 3000 })).ok;
    checks.check("GUIDE calls the jellyfish guide", called, `state=${await guideState()}`);
    const on = (await pollUntil(async () => ((await pressed()) === "true" ? true : null), { timeoutMs: 2000 })).ok;
    checks.check("GUIDE reads as pressed while the guide is out", on, `aria-pressed=${await pressed()}`);
    await tap(page, "touch-guide", 300);
    const sent = (await pollUntil(async () => ((await guideState()) === "roaming" ? true : null), { timeoutMs: 3000 })).ok;
    checks.check("GUIDE again sends it back to roaming", sent, `state=${await guideState()}`);
    const off = (await pollUntil(async () => ((await pressed()) === "false" ? true : null), { timeoutMs: 2000 })).ok;
    checks.check("GUIDE reads as not pressed once it roams", off, `aria-pressed=${await pressed()}`);

    // SCAN only exists while a scannable is in range — put one there.
    const name = await page.evaluate(async (standoff) => {
      const { bodyById } = await import("/src/data/solarSystem.ts");
      const earth = bodyById("earth");
      const b = window.__fitz.bodies.earth;
      // Must use __fitz.teleport (Task 6b) — assigning flight.{x,y,z} is a no-op.
      // PLANET_STANDOFF x size: clear of the solid surface, inside scan range
      // of it (planets are scan-only).
      window.__fitz.teleport(b.x, b.y, b.z + earth.size * standoff);
      return earth.id;
    }, PLANET_STANDOFF);
    await settle(page, 1500);
    const s = await readStore(page);
    checks.check(`scan target acquired near ${name}`, s.scanTarget !== null,
      `scanTarget=${s.scanTarget}`);
    const scanEl = await page.$('[data-testid="touch-scan"]');
    checks.check("SCAN button appears when a target is in range", !!scanEl);
    if (scanEl) {
      const sb = await scanEl.boundingBox();
      await page.touchscreen.touchStart(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await settle(page, 400);
      const scanning = await readInput(page);
      await page.touchscreen.touchEnd();
      checks.check("SCAN sets the scan input", scanning.scan === true);
    }
  });
}
