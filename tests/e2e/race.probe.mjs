import { withPage, settle, readStore, sceneQuery, pollUntil } from "./harness.mjs";

// src/data/ringCourse.ts's RING_GATES, read from the page at the start of
// run() (a literal mirror here went stale when the gates moved clear of the
// real planets' orbits).
let RINGS = [];
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const sub = (a, b) => a.map((c, i) => c - b[i]);
/** Ring facing: bisector of incoming and outgoing legs (same rule as buildGates). */
const normal = (i) => {
  const c = RINGS[i], p = RINGS[(i - 1 + RINGS.length) % RINGS.length], n = RINGS[(i + 1) % RINGS.length];
  const a = norm(sub(c, p)), b = norm(sub(n, c));
  return norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
};
const at = (i, d) => { const n = normal(i); return RINGS[i].map((c, k) => c + n[k] * d); };

const readInput = (page) => page.evaluate(() => window.__fitz.flight.x);
/** Interleaved reads pump rAF under headless SwiftShader (see harness.mjs settle()). */
async function frames(page, n = 4) {
  for (let i = 0; i < n; i++) { await settle(page, 60); await readInput(page); }
}
const teleport = (page, [x, y, z]) => page.evaluate((x, y, z) => window.__fitz.teleport(x, y, z), x, y, z);
/** Two short hops across the ring plane: a 4-unit move, well under MAX_STEP. */
async function hop(page, i) {
  await teleport(page, at(i, -2)); await frames(page);
  await teleport(page, at(i, 2)); await frames(page);
}
const race = async (page) => (await readStore(page)).race;

export default async function run() {
  return withPage({ label: "race" }, async (page, checks) => {
    RINGS = await page.evaluate(async () => (await import("/src/data/ringCourse.ts")).RING_GATES);
    const rings = await sceneQuery(page, "RaceRings");
    checks.check("the course renders as one instanced mesh of all rings",
      rings.found && rings.matches === 1 && rings.count === RINGS.length, JSON.stringify(rings));

    await teleport(page, at(0, -9)); await frames(page, 6);
    let s = await readStore(page);
    checks.check("the start ring is scannable", s.scanTarget === "time_trial", `scanTarget=${s.scanTarget}`);

    // Real flight through the start ring: line up, then thrust with W.
    const n0 = normal(0);
    await teleport(page, at(0, -7));
    await page.evaluate((yaw, p) => window.__fitz.setAttitude(yaw, p), Math.atan2(n0[0], n0[2]), Math.asin(n0[1]));
    await page.keyboard.down("KeyW");
    const started = await pollUntil(async () => (await race(page)).phase === "running",
      { timeoutMs: 12_000, intervalMs: 100 });
    await page.keyboard.up("KeyW");
    s = await readStore(page);
    checks.check("flying through the start ring starts the clock", started.ok, JSON.stringify(s.race));
    checks.check("the start broadcasts the lap brief", /TIME TRIAL \/\/ CLOCK RUNNING/.test(s.broadcast?.text ?? ""),
      s.broadcast?.text ?? "none");
    const hud = await page.$('[data-testid="race-hud"]');
    checks.check("the race HUD appears", !!hud);
    await frames(page, 4);
    const waypoint = await page.evaluate(() => document.body.innerText.includes("RING 1/9"));
    checks.check("the waypoint points at ring 1", waypoint);

    // Photo mode freezes the ship, so it must freeze the lap clock too.
    const raceNow = () => page.evaluate(() => window.__fitz.raceClock.now);
    await page.keyboard.press("KeyP"); await frames(page, 2);
    const p0 = await raceNow(); await frames(page, 12); const p1 = await raceNow();
    await page.keyboard.press("KeyP"); await frames(page, 4);
    const p2 = await raceNow();
    checks.check("photo mode stops the lap clock", p1 === p0, `${p0} -> ${p1}`);
    checks.check("the lap clock runs again after photo mode", p2 > p1 && (await race(page)).phase === "running",
      `${p1} -> ${p2}`);

    // Out of order: ring 3 before ring 1 does not count.
    await hop(page, 3);
    checks.check("a ring flown out of order is ignored", (await race(page)).next === 1);

    for (let i = 1; i < RINGS.length; i++) await hop(page, i);
    let r = await race(page);
    checks.check("all nine rings flown in order leaves the finish next", r.phase === "running" && r.next === 0,
      JSON.stringify(r));

    await hop(page, 0);
    s = await readStore(page);
    checks.check("crossing the start ring again finishes the lap", s.race.phase === "finished",
      JSON.stringify(s.race));
    checks.check("a first finish is recorded as the best", s.raceBest !== null && s.raceBest === s.race.time,
      `best=${s.raceBest} time=${s.race.time}`);
    checks.check("the finish broadcasts NEW BEST", /NEW BEST/.test(s.broadcast?.text ?? ""), s.broadcast?.text ?? "none");
    const ghostStored = await page.evaluate(() => {
      const g = JSON.parse(localStorage.getItem("fitz-race-ghost") ?? "null");
      return g ? g.s.length / 5 : 0;
    });
    checks.check("the best lap is stored as a ghost", ghostStored >= 2, `samples=${ghostStored}`);
    const storedBest = await page.evaluate(() => localStorage.getItem("fitz-race-best"));
    checks.check("the best time persists", Number(storedBest) === s.raceBest, `stored=${storedBest}`);

    // Second lap: the ghost of the first flies alongside.
    await hop(page, 0);
    await frames(page, 3);
    r = await race(page);
    const ghost = await sceneQuery(page, "RaceGhost");
    checks.check("a second lap starts from the finished state", r.phase === "running" && r.next === 1, JSON.stringify(r));
    checks.check("the best lap replays as a ghost", ghost.found && ghost.visible, JSON.stringify(ghost));

    // A jump voids the lap.
    await page.keyboard.press("Digit1");
    await frames(page, 3);
    s = await readStore(page);
    checks.check("jumping to a probe (key 1) aborts the lap", s.race.phase === "idle", JSON.stringify(s.race));
    checks.check("the abort is announced", /ABORTED/.test(s.broadcast?.text ?? ""), s.broadcast?.text ?? "none");
    const ghostAfter = await sceneQuery(page, "RaceGhost");
    checks.check("the ghost leaves with the lap", ghostAfter.visible === false);
  });
}
