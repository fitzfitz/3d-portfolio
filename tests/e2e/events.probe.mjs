import { withPage, settle, readStore, pollUntil, runParts } from "./harness.mjs";

const trigger = (page, kind) => page.evaluate((k) => window.__fitz.triggerEvent(k), kind);
/**
 * Puts the director's clock `ahead` seconds from its next due start (negative:
 * before it). The first start is FIRST_EVENT_AT (45 s) of the director's own
 * clock; waiting it out in real time cost both pages ~55 s each, while this
 * still runs the real step: the clock advancing, the start firing (or held).
 */
const nearDue = (page, ahead) => page.evaluate((a) => {
  const d = window.__fitz.eventDirector;
  if (!d) throw new Error("__fitz.eventDirector unavailable: WorldEventDirector did not register it");
  d.clock = d.nextAt + a;
  return { clock: d.clock, nextAt: d.nextAt };
}, ahead);
const lines = (page) => page.evaluate(async () => (await import("/src/data/chatterLines.ts")).eventLines);

async function events(page, checks) {
  const L = await lines(page);

  // ---- the director starts one on its own when it falls due ----
  const early = (await readStore(page)).worldEvent;
  checks.check("no event before the director's first is due (precondition)", !early, early ? `kind=${early.kind}` : "none");
  await nearDue(page, -0.5);
  const auto = (await pollUntil(async () => (await readStore(page)).worldEvent, { timeoutMs: 10_000, intervalMs: 200 })).value;
  checks.check("an event starts on its own when the director's first falls due", !!auto, auto ? `kind=${auto.kind}` : "none");

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
  // Park 30 u above Earth first, so Earth is the nearest body and the busy
  // view below is the same every run. From the spawn pad (0.92 AU) Mercury
  // or Venus can be nearest, depending on the date; Mercury's delivery orbit
  // rarely clears the Sun's keep-out, so the convoy then goes to the nearest
  // body that has a route (planNearestConvoy, unit-tested).
  await page.evaluate(() => { const b = window.__fitz.bodies.earth; window.__fitz.teleport(b.x, b.y + 30, b.z); });
  await settle(page, 300);
  await trigger(page, "convoy");
  await settle(page, 300);
  const ev = (await readStore(page)).worldEvent;
  checks.check("the convoy targets a body", ev?.kind === "convoy" && !!ev.convoy?.planet, `body=${ev?.convoy?.planet}`);
  const orbiting = (await pollUntil(async () => {
    const r = await page.evaluate(async (name) => {
      const { bodyById } = await import("/src/data/solarSystem.ts");
      const { convoyRadius } = await import("/src/utils/worldEvents.ts");
      const want = convoyRadius(bodyById(name).size);
      const g = window.__fitz.scene.getObjectByName("ConvoyShip0");
      const b = window.__fitz.bodies[name];
      if (!g || !g.visible) return null;
      return { r: Math.hypot(g.position.x - b.x, g.position.y - b.y, g.position.z - b.z), want };
    }, ev.convoy.planet);
    return r !== null && Math.abs(r.r - r.want) < 3 ? r.r : null;
  }, { timeoutMs: 30_000 })).value;
  checks.check("the convoy settles into orbit at convoyRadius(its planet's size)", !!orbiting,
    orbiting ? `radius=${orbiting.toFixed(1)}` : "never reached orbit");

  // ---- budgets while an event runs (spec: Testing) ----
  // The busiest view an event creates: parked 60u sunward of the convoy's
  // planet, facing it, with the convoy in orbit. Same ceilings and counters as
  // transition.probe.mjs's close-approach view (its constants, mirrored here).
  await page.evaluate((name) => {
    const d = window.__fitz, b = d.bodies[name];
    const r = Math.hypot(b.x, b.y, b.z), k = 1 - 60 / r;
    d.teleport(b.x * k, b.y * k, b.z * k);
    d.setAttitude(Math.atan2(b.x - b.x * k, b.z - b.z * k), 0);
  }, ev.convoy.planet);
  await settle(page, 1500);
  const perf = await page.evaluate(() => ({
    calls: window.__fitz.perfStats.calls,
    programs: window.__fitz.gl.info.programs.length,
    convoyShown: window.__fitz.scene.getObjectByName("ConvoyShip0")?.visible === true,
  }));
  checks.check("draw calls stay within the close-approach ceiling with the convoy in view",
    perf.convoyShown && perf.calls <= 110, `calls=${perf.calls} ceiling=110 convoyShown=${perf.convoyShown}`);
  checks.check("shader programs stay within the close-approach ceiling during an event",
    perf.programs <= 84, `programs=${perf.programs} ceiling=84`);
}

async function quietUnderReducedMotion(page, checks) {
  // Past due: without reduced motion a start fires on the next frame (the
  // first page proves it), so 4 s of none is the setting holding it.
  const due = await nearDue(page, 1);
  const started = (await pollUntil(async () => (await readStore(page)).worldEvent, { timeoutMs: 4000, intervalMs: 200 })).ok;
  checks.check("reduced motion: no world event starts, even past due", !started, `clock=${due.clock.toFixed(1)} nextAt=${due.nextAt}`);
}

/** One page each, independent: run.mjs runs them as separate jobs. */
export const parts = [
  () => withPage({ label: "events" }, events),
  () => withPage({ label: "events (reduced motion)", emulateReducedMotion: true }, quietUnderReducedMotion),
];

export default function run() { return runParts(parts); }
