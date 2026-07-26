import { withPage, hold, settle, readStore, sceneQuery } from "./harness.mjs";

/** Emulates the OS preference, so this exercises the real media-query path. */
export default async function run() {
  return withPage({ label: "reducedmotion", emulateReducedMotion: true }, async (page, checks) => {
    const s = await readStore(page);
    checks.check("store picks up the emulated OS preference", s.reducedMotion === true,
      `reducedMotion=${s.reducedMotion}`);

    const attr = await page.evaluate(() =>
      document.documentElement.getAttribute("data-reduced-motion"));
    checks.check("html carries data-reduced-motion=true", attr === "true", `attr=${attr}`);

    // Decorative components are gone.
    for (const name of ["WarpTunnel"]) {
      const o = await sceneQuery(page, name);
      checks.check(`${name} is unmounted`, !o.found);
    }

    // Ambient motion is frozen. Asserted through an observable effect — the
    // cloud layer's rotation — rather than by calling ambientTime() from the
    // probe. Vite serves the app one module instance, so a probe call would
    // ADVANCE the very clock it is measuring, and with `performance.now()` as
    // its argument it would also corrupt `lastReal` for the real consumers.
    const rot0 = await sceneQuery(page, "CloudLayer");
    await settle(page, 2000);
    const rot1 = await sceneQuery(page, "CloudLayer");
    checks.check("cloud layer rotation is frozen",
      rot0.found && rot1.found && Math.abs(rot1.rotation.y - rot0.rotation.y) < 1e-6,
      `y ${rot0.rotation?.y} -> ${rot1.rotation?.y}`);

    // Orbits are frozen: a body's position must not change.
    const p0 = await page.evaluate(() => ({ ...window.__fitz.bodies.saas }));
    await settle(page, 2000);
    const p1 = await page.evaluate(() => ({ ...window.__fitz.bodies.saas }));
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    checks.check("planet orbit is frozen", moved < 0.01, `moved ${moved.toFixed(4)}`);

    // THE CHECK THAT MATTERS MOST: flight still works.
    const before = await page.evaluate(() => ({ ...window.__fitz.flight }));
    await hold(page, ["KeyW"], 3000);
    const after = await page.evaluate(() => ({ ...window.__fitz.flight }));
    const flew = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    checks.check("flight still works with reduced motion on", flew > 5, `displaced ${flew.toFixed(2)}`);

    // Impacts still register, but the camera must not be shaken.
    const target = await page.evaluate(async () => {
      const { ASTEROID_COLLIDERS } = await import("/src/data/asteroids.ts");
      return ASTEROID_COLLIDERS[0];
    });
    await page.evaluate((t) => window.__fitz.teleport(t.x, t.y, t.z - t.r - 2), target);

    // ADAPTED MECHANISM (see task-8-report.md): the chase camera eases toward
    // the ship's new position over several real seconds after a long-distance
    // teleport (Spaceship.tsx's frameLerp(0.05, dt) chase-cam lerp) — that
    // catch-up is real easing, not shake, but sampling right after teleport
    // measures its tail instead. Observed while building this probe: a fixed
    // 800ms settle left a 2.2661 max consecutive-frame jump (pure catch-up,
    // no ram yet); it fell to 0.1218 at 4s and 0.0141 at 8s. So: poll until
    // the camera stops moving before sampling for shake, rather than assuming
    // a fixed delay converges it. This changes *when* sampling starts, not
    // the 0.1 threshold or the claim being tested.
    const cameraSettleDeadline = Date.now() + 20_000;
    for (;;) {
      const a = await page.evaluate(() => ({ x: window.__fitz.camera.position.x, y: window.__fitz.camera.position.y }));
      await settle(page, 200);
      const b = await page.evaluate(() => ({ x: window.__fitz.camera.position.x, y: window.__fitz.camera.position.y }));
      if (Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) < 0.02) break;
      if (Date.now() > cameraSettleDeadline) break; // proceed anyway; the jump check below will report honestly
    }

    // Sample the camera across consecutive frames DURING the ram: KeyW is held
    // down for the whole sampling window (not just after it), because teleport
    // zeroes velocity and the ship needs the accelerating thrust to actually
    // close the remaining 2 units and trigger the impact WHILE frames are being
    // sampled. Sampling only after a separate hold() would measure an already-
    // idle chase camera and pass without ever observing a real bounce.
    const impactsBefore = (await readStore(page)).impactCount;
    await page.keyboard.down("KeyW");
    const ramSamples = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 60; i++) {
        const c = window.__fitz.camera;
        out.push({ x: c.position.x, y: c.position.y });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return out;
    });
    await settle(page, 1000);
    await page.keyboard.up("KeyW");
    const impactsAfter = (await readStore(page)).impactCount;
    checks.check("ramming still registers an impact", impactsAfter > impactsBefore,
      `${impactsBefore} -> ${impactsAfter}`);

    // Shake is ±0.25 per axis per frame at its peak, so a suppressed shake keeps
    // consecutive-frame deltas far below that. The chase camera itself eases
    // smoothly, so 0.1 separates "eased" from "jittered".
    const maxJump = ramSamples.slice(1).reduce((m, s, i) => {
      const p = ramSamples[i];
      return Math.max(m, Math.abs(s.x - p.x), Math.abs(s.y - p.y));
    }, 0);
    checks.check("camera is not shaken while reduced motion is on", maxJump < 0.1,
      `max consecutive-frame camera jump ${maxJump.toFixed(4)}`);

    // The teleport flash element must never appear on a wrap. ADAPTED
    // MECHANISM: rather than polling and hoping a wrap happens to occur
    // (COSMIC_BOUNDS is 250 and the ship was left sitting next to an
    // asteroid well inside it — a vacuous wait that would pass even if the
    // suppression were broken, since isTeleporting would just never fire),
    // teleport straight past the boundary so Spaceship's per-frame wrap
    // check fires `triggerTeleportFlash()` deterministically on the very
    // next frame. This is verified separately below (the store flag really
    // did fire) so the "never rendered" result is evidence, not a no-op.
    await page.evaluate(() => window.__fitz.teleport(0, 260, 0));
    const flashResult = await page.evaluate(async () => {
      let seen = false;
      let wrapped = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (window.__fitz.store.getState().isTeleporting) {
          wrapped = true;
          // The store flag may fire; the overlay must not render.
          if (document.querySelector(".backdrop-blur-\\[3px\\]")) seen = true;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return { seen, wrapped };
    });
    checks.check("wrap actually fired the store flag (flash check is not vacuous)",
      flashResult.wrapped, `isTeleporting observed=${flashResult.wrapped}`);
    checks.check("no teleport flash overlay rendered", flashResult.seen === false);
  });
}
