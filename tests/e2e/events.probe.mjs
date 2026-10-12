import { withPage, settle, readStore, pollUntil } from "./harness.mjs";

const trigger = (page, kind) => page.evaluate((k) => window.__fitz.triggerEvent(k), kind);
const lines = (page) => page.evaluate(async () => (await import("/src/data/chatterLines.ts")).eventLines);

async function events(page, checks) {
  const L = await lines(page);

  // ---- the director starts one on its own ----
  const auto = (await pollUntil(async () => (await readStore(page)).worldEvent, { timeoutMs: 55_000 })).value;
  checks.check("an event starts on its own within ~50s of the scene being ready", !!auto, auto ? `kind=${auto.kind}` : "none");

  // ---- comet: passes close ----
  await trigger(page, "comet");
  await settle(page, 300);
  const cometLine = (await readStore(page)).broadcast?.text;
  checks.check("the comet event announces itself", L.comet.includes(cometLine), `broadcast=${cometLine}`);
  let closest = Infinity;
  for (let k = 0; k < 60; k++) {
    const d = await page.evaluate(() => {
      const g = window.__fitz.scene.getObjectByName("CometVisitor");
      const f = window.__fitz.flight;
      if (!g || !g.visible) return Infinity;
      const head = g.children[0].position; // the nucleus mesh carries the world position
      return Math.hypot(head.x - f.x, head.y - f.y, head.z - f.z);
    });
    closest = Math.min(closest, d);
    await settle(page, 400);
  }
  checks.check("the visiting comet passes within ~40u of the ship", closest < 40, `closest=${closest.toFixed(1)}`);

  // ---- flare: corona swells and settles ----
  await trigger(page, "flare");
  let peak = 1;
  for (let k = 0; k < 30; k++) {
    const s = await page.evaluate(() => window.__fitz.scene.getObjectByName("SunCorona")?.scale.x ?? 1);
    peak = Math.max(peak, s);
    await settle(page, 200);
  }
  checks.check("a flare swells the sun's corona", peak > 1.3, `peak scale=${peak.toFixed(2)}`);
  await settle(page, 7000);
  const after = await page.evaluate(() => window.__fitz.scene.getObjectByName("SunCorona")?.scale.x ?? 1);
  checks.check("the corona settles back after the flare", Math.abs(after - 1) < 0.02, `scale=${after.toFixed(3)}`);

  // ---- convoy: reaches its orbit around the nearest planet ----
  await trigger(page, "convoy");
  await settle(page, 300);
  const ev = (await readStore(page)).worldEvent;
  checks.check("the convoy targets a planet", ev?.kind === "convoy" && !!ev.convoy?.planet, `planet=${ev?.convoy?.planet}`);
  const orbiting = (await pollUntil(async () => {
    const r = await page.evaluate((name) => {
      const g = window.__fitz.scene.getObjectByName("ConvoyShip0");
      const b = window.__fitz.bodies[name];
      if (!g || !g.visible) return null;
      return Math.hypot(g.position.x - b.x, g.position.y - b.y, g.position.z - b.z);
    }, ev.convoy.planet);
    return r !== null && Math.abs(r - 16 * 2.2) < 3 ? r : null;
  }, { timeoutMs: 30_000 })).value;
  checks.check("the convoy settles into orbit at ~2.2x the planet's size", !!orbiting,
    orbiting ? `radius=${orbiting.toFixed(1)}` : "never reached orbit");
}

async function quietUnderReducedMotion(page, checks) {
  const started = (await pollUntil(async () => (await readStore(page)).worldEvent, { timeoutMs: 55_000 })).ok;
  checks.check("reduced motion: no world event starts", !started);
}

export default async function run() {
  const checks = await withPage({ label: "events" }, events);
  const rm = await withPage({ label: "events (reduced motion)", emulateReducedMotion: true }, quietUnderReducedMotion);
  checks.results.push(...rm.results);
  return checks;
}
