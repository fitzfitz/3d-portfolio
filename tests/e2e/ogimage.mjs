// Generates public/og.webp from the running app: park near a planet, enter
// photo mode for a clean frame, capture 1200x630, compress with sharp.
// Not part of the e2e suite (see run.mjs's PROBES list) — run on demand after
// visual changes: `node tests/e2e/ogimage.mjs`.
import { withPage, stopServer } from "./harness.mjs";
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const RAW = `${process.env.SCRATCH ?? "/tmp"}/og-raw.png`;

/**
 * Ticks the chase-cam forward via repeated CDP round-trips instead of one
 * blind wait. harness.mjs documents why: headless SwiftShader barely pumps
 * its own rAF loop during an idle setTimeout with zero CDP traffic, so a
 * multi-second settle() can leave the chase-cam's per-frame lerp toward the
 * ship still mid-flight (confirmed empirically — with blind waits the
 * planet's on-screen position barely moved even when the teleport offset
 * changed by double digits of units, because the camera hadn't actually
 * caught up to the ship yet). Each evaluate() here is a CDP command that
 * reliably ticks a frame, so N round-trips ~= N ticks of real progress.
 */
async function pump(page, n) {
  for (let i = 0; i < n; i++) await page.evaluate(() => true);
}

await withPage({ label: "ogimage", viewport: { width: 1200, height: 630 } },
  async (page, checks) => {
    // Park just past the saas planet along the ship's fixed spawn heading
    // (nose points world +z when angle==0, and no steer input is ever sent,
    // so it stays +z the whole time — see Spaceship.tsx's noseDirection).
    // The offset is deliberately small: dx/dy only nudge the planet off the
    // dead-center axis, dz puts it far enough ahead that the chase-cam's
    // close-in framing (ship in the foreground, planet beside it) reads as
    // one composed shot rather than the ship dwarfing a distant dot. Chosen
    // by iterating with tests/e2e/ogimage.mjs's own output — see
    // task-16-report.md for what earlier offsets got wrong (planet behind
    // the camera, planet off in a corner, etc).
    await page.evaluate(async () => {
      const { planets } = await import("/src/constants.ts");
      const b = window.__fitz.bodies[planets[0].name];
      // Must use __fitz.teleport (Task 6b) — assigning flight.{x,y,z} is a no-op.
      window.__fitz.teleport(b.x, b.y + 2, b.z - 10);
    });
    await pump(page, 30);                     // let the chase-cam actually arrive
    await page.keyboard.press("KeyP");        // photo mode: no HUD, no modals
    await pump(page, 18);                     // let the HUD fade and OrbitControls settle

    // Photo mode's only remaining chrome is a tiny "[P] EXIT" hint (App.tsx) —
    // meaningless on a static share image, so blank it for this capture only.
    // This mutates the live DOM of this throwaway page, not the app source,
    // so real users still see the hint when they press P themselves.
    await page.evaluate(() => {
      // Leaf-only match: textContent includes ancestors too, and this label's
      // wrapping divs go all the way up to the app root — matching those
      // would blank the whole canvas instead of just the hint.
      for (const el of document.querySelectorAll("div")) {
        if (el.children.length === 0 && el.textContent?.includes("PHOTO_MODE")) {
          el.style.display = "none";
        }
      }
    });

    const buf = await page.screenshot({ type: "png" });
    writeFileSync(RAW, buf);
    const out = await sharp(buf).resize(1200, 630, { fit: "cover" })
      .webp({ quality: 82 }).toBuffer();
    writeFileSync("public/og.webp", out);
    checks.check("og.webp is under 200KB", out.length < 200_000,
      `${(out.length / 1024).toFixed(1)}KB`);
    checks.check("og.webp is not a blank frame", out.length > 15_000,
      `${(out.length / 1024).toFixed(1)}KB`);
  });

await stopServer();
process.exit(0);
