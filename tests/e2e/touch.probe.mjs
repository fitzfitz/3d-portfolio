import { withPage, tap, settle, readStore } from "./harness.mjs";
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

    const pitchBefore = await page.evaluate(() => window.__fitz.flight.pitch);
    const el = await page.$('[data-testid="touch-rise"]');
    const box = await el.boundingBox();
    await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
    await settle(page, 300);
    const held = await readInput(page);
    await settle(page, 1200);
    const pitchAfter = await page.evaluate(() => window.__fitz.flight.pitch);
    await page.touchscreen.touchEnd();
    checks.check("holding RISE sets ascend", held.ascend === true);
    checks.check("holding RISE pitches the nose up", pitchAfter > pitchBefore + 0.01,
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
    for (let i = 0; i < 9; i++) {
      await settle(page, 300);
      pitchDived = await page.evaluate(() => window.__fitz.flight.pitch);
    }
    await page.touchscreen.touchEnd();
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

    // SCAN only exists while a scannable is in range — put one there.
    const name = await page.evaluate(async () => {
      const { planets } = await import("/src/constants.ts");
      const b = window.__fitz.bodies[planets[0].name];
      // Must use __fitz.teleport (Task 6b) — assigning flight.{x,y,z} is a no-op.
      window.__fitz.teleport(b.x, b.y, b.z + 18);
      return planets[0].name;
    });
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
