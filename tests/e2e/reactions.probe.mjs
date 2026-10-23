import { withPage, settle, readStore, pollUntil, runParts } from "./harness.mjs";

// Mirrors src/utils/beltPush.ts (the probe runs in Node, outside Vite);
// tests/beltPush.test.ts guards the source of truth.
const BELT_PUSH_RADIUS = 10;

const teleport = (page, [x, y, z]) => page.evaluate((x, y, z) => window.__fitz.teleport(x, y, z), x, y, z);

/** The cargo ship farthest from every planet, so chasing it can't trip an orbit lock. */
const safestCargo = (page) => page.evaluate(() => {
  const d = window.__fitz;
  let best = 0, bestGap = -1;
  for (let i = 0; i < 5; i++) {
    const g = d.scene.getObjectByName(`CargoShip${i}`);
    if (!g) continue;
    const gap = Math.min(...Object.values(d.bodies).map((b) =>
      Math.hypot(g.position.x - b.x, g.position.y - b.y, g.position.z - b.z)));
    if (gap > bestGap) { bestGap = gap; best = i; }
  }
  return best;
});

/**
 * Sits the ship 8u above cargo ship `i`'s route point for ~2.5s, re-teleporting
 * as it moves on. Tracks the route point (position minus the live swerve
 * offset), not the displaced hull: re-centring on the hull walks the ship onto
 * the route line and flips the sideways direction, so the offset sawtooths.
 */
async function shadowCargo(page, i) {
  for (let k = 0; k < 25; k++) {
    await page.evaluate((i) => {
      const g = window.__fitz.scene.getObjectByName(`CargoShip${i}`);
      const o = window.__fitz.cargoSwerve[i];
      window.__fitz.teleport(g.position.x - o.x, g.position.y - o.y + 8, g.position.z - o.z);
    }, i);
    await settle(page, 100);
  }
}

const swerve = (page, i) => page.evaluate((i) => {
  const o = window.__fitz.cargoSwerve[i];
  return Math.hypot(o.x, o.y, o.z);
}, i);

/** World positions of the main belt's rocks, read from the live instance matrices. */
const beltRocks = (page) => page.evaluate(() => {
  const m = window.__fitz.scene.getObjectByName("BeltMain");
  m.updateMatrixWorld(true);
  const e = m.matrixWorld.elements, a = m.instanceMatrix.array, out = [];
  for (let i = 0; i < m.count; i++) {
    const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
    out.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]);
  }
  return out;
});
const nearestTo = (rocks, p) => rocks.reduce((best, r) => {
  const d = Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
  return d < best.d ? { r, d } : best;
}, { r: null, d: Infinity });
const shipPos = (page) => page.evaluate(() => [window.__fitz.flight.x, window.__fitz.flight.y, window.__fitz.flight.z]);

async function reacting(page, checks) {
  // ---- cargo: swerve + hail ----
  const hailPool = await page.evaluate(async () => (await import("/src/data/chatterLines.ts")).chatterPools.hail);
  const i = await safestCargo(page);
  const before = (await readStore(page)).broadcast?.id ?? 0;
  await shadowCargo(page, i);
  const off = await swerve(page, i);
  checks.check("a cargo ship swerves off its route when the ship comes close", off > 3, `ship=${i} offset=${off.toFixed(2)}`);
  const b = (await readStore(page)).broadcast;
  checks.check("it hails the pilot on the radio", (b?.id ?? 0) > before && hailPool.includes(b?.text),
    `broadcast=${b?.text}`);

  // ---- jellyfish: curious, then startled ----
  await page.keyboard.press("KeyJ");
  await settle(page, 800);
  const jelly = () => page.evaluate(() => {
    const p = window.__fitz.scene.getObjectByName("SpaceJellyfish").position;
    const f = window.__fitz.flight;
    return { mood: window.__fitz.jelly.mood, dist: Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z), p: [p.x, p.y, p.z] };
  });
  const j0 = await jelly();
  await teleport(page, [j0.p[0] + 24, j0.p[1], j0.p[2]]);
  await settle(page, 300);
  const start = (await jelly()).dist;
  // pollUntil resolves to { ok, value }, never the bare value.
  const curious = (await pollUntil(async () => {
    const j = await jelly();
    return j.mood === "curious" && j.dist < start - 8 ? j : null;
  }, { timeoutMs: 8000 })).value;
  checks.check("the jellyfish turns curious and drifts toward a hovering ship", !!curious,
    curious ? `dist ${start.toFixed(1)} -> ${curious.dist.toFixed(1)}` : `start=${start.toFixed(1)}`);

  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  const startled = (await pollUntil(async () => ((await jelly()).mood === "startled" ? true : null), { timeoutMs: 1500 })).ok;
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  checks.check("a boost nearby startles it", !!startled);

  // ---- belt: rocks part around a parked ship ----
  const target = nearestTo(await beltRocks(page), [55, 0, 0]).r;
  await teleport(page, target);
  await settle(page, 1500);
  const ship = await shipPos(page);
  const nearest = nearestTo(await beltRocks(page), ship).d;
  checks.check("belt rocks part around a parked ship", nearest > BELT_PUSH_RADIUS * 0.7,
    `nearest rock ${nearest.toFixed(2)}u (push radius ${BELT_PUSH_RADIUS})`);
}

async function stillUnderReducedMotion(page, checks) {
  const i = await safestCargo(page);
  await shadowCargo(page, i);
  const off = await swerve(page, i);
  checks.check("reduced motion: cargo ships hold their route", off < 0.01, `offset=${off.toFixed(3)}`);

  const target = nearestTo(await beltRocks(page), [55, 0, 0]).r;
  await teleport(page, target);
  await settle(page, 1500);
  const nearest = nearestTo(await beltRocks(page), await shipPos(page)).d;
  checks.check("reduced motion: the belt does not part", nearest < 1, `nearest rock ${nearest.toFixed(2)}u`);
}

/** One page each, independent: run.mjs runs them as separate jobs. */
export const parts = [
  () => withPage({ label: "reactions" }, reacting),
  () => withPage({ label: "reactions (reduced motion)", emulateReducedMotion: true }, stillUnderReducedMotion),
];

export default function run() { return runParts(parts); }
