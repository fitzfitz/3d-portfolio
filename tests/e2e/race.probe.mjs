import {
  withPage, settle, readStore, pollUntil, chatterText, toDeepSpace, nextFrames, isFontHost, respondInertFont,
  lockFullFidelity, installFakeSky, BASE_URL, SCENE_READY_TIMEOUT_MS,
} from "./harness.mjs";
import { DEEP_SPACE_POINT } from "./deepSpacePoint.mjs";

// The ring race (spec 2026-10-26-ring-race-design), one page against a
// scripted race room: live sky is faked in the page (harness installFakeSky)
// and the probe plays the room, message by message. The best-lap and result
// endpoints are a mock reached through request interception, as in
// bottles.probe.mjs. The two-racer race itself is the room's unit test
// (beacon-api); this drives the client's side of it.
const API = "https://race.mock";
/** The room's clock runs 7 minutes ahead of the page's: every time must still read right. */
const SKEW = 7 * 60_000;
const RACE = "race-e2e-1";
const TOKEN = "0123456789abcdef0123456789abcdef";
const SIG = "abcdef0123456789abcdef0123456789";
const CODE = "ABC234";
const EXPIRED_LINE = "RACE // THAT RACE HAS ENDED · THE START GATE IS STILL OPEN";

const inPage = (page, fn, arg) => page.evaluate(fn, arg);
const sent = (page) => inPage(page, () => window.__fakeSky.sent.filter((m) => m.t !== "me"));
const view = async (page) => (await readStore(page)).raceView;
const pos = (page) => inPage(page, () => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const hudText = (page) => inPage(page, () => document.querySelector('[data-testid="race-hud"]')?.textContent ?? "");
const has = (page, id) => inPage(page, (t) => !!document.querySelector(`[data-testid="${t}"]`), id);
const teleport = (page, p) => inPage(page, (q) => window.__fitz.teleport(q.x, q.y, q.z), p);

/**
 * Serves a race message as the room, stamped with the room's (skewed) clock:
 * every listed path ("now", "startsAt", "stamp.at") is an offset from the
 * room's now. The stamp's `at` is a room time too.
 */
const serve = (page, msg, rel = ["now"]) => inPage(page, ({ m, rel: paths, skew }) => {
  const now = Date.now() + skew;
  const out = JSON.parse(JSON.stringify(m));
  for (const path of paths) {
    const keys = path.split(".");
    let o = out;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)] = now + o[keys.at(-1)];
  }
  window.__fakeSky.serve(out);
  return out;
}, { m: msg, rel, skew: SKEW });

/** Interleaved reads pump frames; returns the highest flight.speed seen while `codes` are held for `ms`. */
async function holdKeys(page, codes, ms) {
  for (const c of codes) await page.keyboard.down(c);
  let max = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await nextFrames(page, 2);
    max = Math.max(max, await inPage(page, () => window.__fitz.flight.speed));
  }
  for (const c of codes) await page.keyboard.up(c);
  return max;
}

/** Each ring's scale, from the one instanced mesh's matrices. */
const ringScales = (page) => inPage(page, () => {
  const m = window.__fitz.scene.getObjectByName("RaceRings");
  if (!m) return null;
  const a = m.instanceMatrix.array;
  return Array.from({ length: m.count }, (_, i) => Math.hypot(a[16 * i], a[16 * i + 1], a[16 * i + 2]));
});

/** The course and grid slot 0, read from the app's own modules. */
const course = (page) => inPage(page, async () => {
  const { RACE_GATES, START_GATE } = await import("/src/data/ringCourse.ts");
  const { gridSlot } = await import("/src/utils/race.ts");
  return { gates: RACE_GATES, slot0: gridSlot(START_GATE, 0) };
});
/** A point `d` u along ring i's normal from its centre (negative: the approach side). */
const along = (g, d) => ({ x: g.c.x + g.n.x * d, y: g.c.y + g.n.y * d, z: g.c.z + g.n.z * d });

export default async function run() {
  return withPage({ label: "race" }, async (page, checks) => {
    // The mock API: no best yet, results taken, and the other calls the
    // configured API brings (bottles, content) answered inertly.
    const posts = [];
    let bestGets = 0;
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
    const json = (req, status, body) => req.respond({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith(API)) {
        const path = new URL(url).pathname;
        if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
        if (path === "/race/best") { bestGets++; return json(req, 200, { course: "loop-2", timeMs: null }); }
        if (path === "/race/result") { posts.push(JSON.parse(req.postData() ?? "{}")); return json(req, 200, { ok: true }); }
        if (path === "/beacons") return json(req, 200, { beacons: [] });
        return json(req, 200, {}); // /content: not the right shape, so the bundled content stays
      }
      if (isFontHost(url)) return respondInertFont(req);
      return req.continue();
    });
    await page.evaluateOnNewDocument(lockFullFidelity);
    await page.evaluateOnNewDocument(installFakeSky);
    // The live-sky notice counts as played: a race join waits for it (raceJoin.ts).
    await page.evaluate((api) => {
      localStorage.setItem("fitz-live-sky-dev", "fake://sky");
      localStorage.setItem("fitz-beacon-api-dev", api);
      localStorage.setItem("fitz-live-seen-2", "1");
      localStorage.removeItem("fitz-live-sky");
      localStorage.removeItem("fitz-race-run");
      localStorage.removeItem("fitz-race-best");
    }, API);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(false, true));
    await settle(page, 1000);

    const { gates, slot0 } = await course(page);
    const N = gates.length;

    // Leaving the pad counts as flying: live sky connects, and the room says hello.
    await toDeepSpace(page);
    const connected = await pollUntil(() => inPage(page, () => window.__fakeSky.open() === 1), { timeoutMs: 10_000, intervalMs: 200 });
    checks.check("live sky connects to the fake room", connected.ok);
    await inPage(page, () => window.__fakeSky.serve({ t: "hello", id: "me1", peers: 0 }));

    // A free pilot's warp in open space, for the racer's cap below.
    const S = { x: DEEP_SPACE_POINT[0], y: DEEP_SPACE_POINT[1], z: DEEP_SPACE_POINT[2] };
    const aim = async () => inPage(page, () => window.__fitz.setAttitude(0, 0));
    await teleport(page, S); await aim(); await nextFrames(page, 3);
    const freeMax = await holdKeys(page, ["KeyW", "ShiftLeft"], 3000);
    checks.check("a free pilot warps past 100 u/s in open space", freeMax > 100, `max=${freeMax.toFixed(1)}`);

    // 1. Away from the gate: 18 u out, inside scan range, outside the join radius.
    await teleport(page, along(gates[0], -18)); await nextFrames(page, 4);
    const scan = await pollUntil(async () => (await readStore(page)).scanTarget === "race_start", { timeoutMs: 4000, intervalMs: 150 });
    checks.check("the start gate is scannable", scan.ok, `scanTarget=${(await readStore(page)).scanTarget}`);
    checks.check("away from the gate there is no JOIN prompt", !(await has(page, "race-join")));
    let scales = await ringScales(page);
    checks.check("idle, only the start gate shows: every other ring is zero-scaled",
      scales?.length === N && scales[0] > 0.9 && scales.slice(1).every((v) => v === 0), JSON.stringify(scales));

    // 2. At the gate: JOIN, the lobby, INVITE FRIENDS.
    await teleport(page, along(gates[0], -9));
    const prompt = await pollUntil(() => has(page, "race-join"), { timeoutMs: 4000, intervalMs: 150 });
    checks.check("at the gate the JOIN prompt shows", prompt.ok);
    await page.keyboard.press("KeyR");
    const joined = await pollUntil(async () => (await sent(page)).some((m) => m.t === "rjoin"), { timeoutMs: 4000, intervalMs: 100 });
    const joins = (await sent(page)).filter((m) => m.t === "rjoin");
    checks.check("R sends a plain join", joined.ok && joins.length === 1 && JSON.stringify(joins[0]) === '{"t":"rjoin"}',
      JSON.stringify(joins));

    await serve(page, { t: "rlobby", race: RACE, kind: "public", code: null, host: false, token: TOKEN,
      pilots: [{ cc: null, you: true }, { cc: "ID", you: false }], startsAt: 15_000, now: 0 }, ["now", "startsAt"]);
    const lobby = await pollUntil(async () => /RACE LOBBY/.test(await hudText(page)), { timeoutMs: 3000, intervalMs: 100 });
    const pilots = await inPage(page, () => document.querySelector('[data-testid="race-pilots"]')?.children.length ?? 0);
    checks.check("the lobby card shows both pilots", lobby.ok && pilots === 2, `pilots=${pilots} hud=${await hudText(page)}`);
    // 15 s on the room's clock, 7 minutes ahead of this page's: still a 15 s countdown here.
    const count = /STARTS IN (\d+):(\d\d)/.exec(await hudText(page));
    const left = count ? Number(count[1]) * 60 + Number(count[2]) : -1;
    checks.check("the lobby counts down to the start on the room's clock", left >= 10 && left <= 15, count?.[0] ?? "no countdown");
    const run0 = await inPage(page, () => JSON.parse(localStorage.getItem("fitz-race-run") ?? "null"));
    checks.check("the lobby's token is kept for the race", run0?.race === RACE && run0?.token === TOKEN, JSON.stringify(run0));

    // Clicked for real: the lobby card must sit above the desktop controls card,
    // which is still up for 6 s after leaving the pad (the gate is ~2 s from it at
    // warp). The HUD is set back to that state, so the check does not hang on timing.
    const top = await inPage(page, () => {
      document.querySelector("[data-quiet]")?.setAttribute("data-quiet", "false");
      const b = document.querySelector('[data-testid="race-invite"]');
      const r = b?.getBoundingClientRect();
      return !!r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b;
    });
    checks.check("INVITE FRIENDS is not covered by another HUD card", top);
    await page.click('[data-testid="race-invite"]');
    const invited = await pollUntil(async () => (await sent(page)).some((m) => m.t === "rinvite"), { timeoutMs: 3000, intervalMs: 100 });
    checks.check("INVITE FRIENDS sends rinvite", invited.ok);

    // Docked at a destination while the lobby waits: the grid must let go of the dock.
    await inPage(page, () => window.__fitz.store.getState().requestJump("career"));
    const docked = await pollUntil(async () => (await readStore(page)).isOrbitLocked, { timeoutMs: 15_000, intervalMs: 200 });
    checks.check("a pilot in the lobby can dock at a destination", docked.ok);

    // 3. The grid: GO a minute away, so the hold is not timing-bound.
    await serve(page, { t: "rgrid", race: RACE, kind: "public", slot: 0, goAt: 60_000, now: 0 }, ["now", "goAt"]);
    const onGrid = await pollUntil(async () => !(await readStore(page)).isOrbitLocked && dist(await pos(page), slot0.p) < 0.5,
      { timeoutMs: 5000, intervalMs: 100 });
    const g0 = await pos(page);
    checks.check("the grid releases the dock and puts the ship on grid slot 0", onGrid.ok,
      `locked=${(await readStore(page)).isOrbitLocked} off by ${dist(g0, slot0.p).toFixed(2)}`);
    checks.check("the grid shows its hold", /ON THE GRID/.test(await hudText(page)), await hudText(page));
    await holdKeys(page, ["KeyW"], 1000);
    const g1 = await pos(page);
    checks.check("on the grid, held thrust does not move the ship", dist(g0, g1) < 0.01, `moved ${dist(g0, g1).toFixed(3)} u`);
    checks.check("the best lap is fetched for the race", bestGets === 1, `gets=${bestGets}`);

    // GO, half a second ago on the room's clock.
    await serve(page, { t: "rgo", stamp: { r: RACE, k: TOKEN, i: 0, at: -500, sig: SIG }, now: 0 }, ["now", "stamp.at"]);
    const running = await pollUntil(async () => (await view(page)).phase === "running", { timeoutMs: 3000, intervalMs: 100 });
    checks.check("GO starts the race", running.ok, JSON.stringify(await view(page)));
    await holdKeys(page, ["KeyW"], 1000);
    const g2 = await pos(page);
    checks.check("after GO, thrust moves the ship", dist(g1, g2) > 1, `moved ${dist(g1, g2).toFixed(2)} u`);
    scales = await ringScales(page);
    checks.check("racing, every ring shows", scales?.every((v) => v > 0.9), JSON.stringify(scales));
    checks.check(`the HUD shows RING 1/${N}`, (await hudText(page)).includes(`RING 1/${N}`), await hudText(page));

    // 4. The warp cap, in the spot where the free pilot passed 100.
    await teleport(page, S); await aim(); await nextFrames(page, 3);
    const raceMax = await holdKeys(page, ["KeyW", "ShiftLeft"], 3000);
    checks.check("racing, warp is held to race speed (≤ 39.5 u/s)", raceMax <= 39.5 && raceMax > 30, `max=${raceMax.toFixed(2)}`);

    // 5. Ring 1, through in steps under 10 u.
    const g = gates[1];
    for (const d of [-12, -6, -2, 2, 6]) { await teleport(page, along(g, d)); await nextFrames(page, 3); }
    await settle(page, 400);
    const claims = (await sent(page)).filter((m) => m.t === "rring");
    checks.check("flying through ring 1 claims it once", claims.length === 1 && claims[0].i === 1, JSON.stringify(claims));
    await serve(page, { t: "rstamp", stamp: { r: RACE, k: TOKEN, i: 1, at: 0, sig: SIG } }, ["stamp.at"]);
    const ring2 = await pollUntil(async () => (await hudText(page)).includes(`RING 2/${N}`), { timeoutMs: 3000, intervalMs: 100 });
    checks.check(`the stamp moves the HUD to RING 2/${N}`, ring2.ok, await hudText(page));
    const run1 = await inPage(page, () => JSON.parse(localStorage.getItem("fitz-race-run") ?? "null"));
    checks.check("the run keeps both stamps", run1?.token === TOKEN && run1.stamps.map((s) => s.i).join() === "0,1",
      JSON.stringify(run1?.stamps.map((s) => s.i)));

    // 8. Jumps are off mid-race.
    const seq0 = (await readStore(page)).jumpRequest?.seq ?? 0;
    const p0 = await pos(page);
    await page.keyboard.press("Digit1");
    await nextFrames(page, 6);
    const seq1 = (await readStore(page)).jumpRequest?.seq ?? 0;
    const p1 = await pos(page);
    checks.check("a number key mid-race does not jump", seq1 === seq0 && dist(p0, p1) < 5,
      `seq ${seq0} -> ${seq1}, moved ${dist(p0, p1).toFixed(2)} u`);

    // 6. The over: the stored run is uploaded once; then the results.
    await serve(page, { t: "rover", race: RACE, uploadBy: 30_000, now: 0 }, ["now", "uploadBy"]);
    await pollUntil(() => posts.length > 0, { timeoutMs: 5000, intervalMs: 100 });
    await settle(page, 600);
    const body = posts[0];
    checks.check("the over uploads the run once, with the stored stamps", posts.length === 1 && body.race === RACE
      && body.token === TOKEN && JSON.stringify(body.stamps) === JSON.stringify(run1?.stamps) && !("ghost" in body),
      `posts=${posts.length} ${JSON.stringify(body)}`);

    await serve(page, { t: "rresults", race: RACE, againBy: 20_000, now: 0, rows: [
      { place: 1, cc: null, timeMs: 52_400, rings: N, you: true },
      { place: 2, cc: "ID", timeMs: null, rings: 3, you: false },
    ] }, ["now", "againBy"]);
    const results = await pollUntil(() => has(page, "race-row-you"), { timeoutMs: 3000, intervalMs: 100 });
    const you = await inPage(page, () => document.querySelector('[data-testid="race-row-you"]')?.textContent ?? "");
    checks.check("the results card shows the pilot first", results.ok && /^P1\s/.test(you), you);
    const s = await readStore(page);
    checks.check("a finish records the Ring runner badge", s.badges.some((b) => b.id === "ring"));
    const best = await inPage(page, () => localStorage.getItem("fitz-race-best"));
    checks.check("the finish time is kept as the best", Number(best) === 52.4 && s.raceBest === 52.4, `stored=${best} store=${s.raceBest}`);
    const runAfter = await inPage(page, () => localStorage.getItem("fitz-race-run"));
    checks.check("the results clear the stored run", runAfter === null, runAfter ?? "");

    // 7. An expired invite link, on a fresh page.
    await page.goto(`${BASE_URL}/?race=${CODE}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
    const start = await pos(page);
    checks.check("a race link starts the ship on grid slot 0", dist(start, slot0.p) < 1, `off by ${dist(start, slot0.p).toFixed(2)}`);
    const linkOpen = await pollUntil(() => inPage(page, () => window.__fakeSky.open() === 1), { timeoutMs: 10_000, intervalMs: 200 });
    checks.check("the link connects live sky", linkOpen.ok);
    await inPage(page, () => window.__fakeSky.serve({ t: "hello", id: "me2", peers: 0 }));
    const linkJoin = await pollUntil(async () => (await sent(page)).some((m) => m.t === "rjoin"), { timeoutMs: 5000, intervalMs: 100 });
    const linkJoins = (await sent(page)).filter((m) => m.t === "rjoin");
    checks.check("the link joins its race by code", linkJoin.ok && linkJoins.length === 1
      && JSON.stringify(linkJoins[0]) === `{"t":"rjoin","code":"${CODE}"}`, JSON.stringify(linkJoins));
    const search = await inPage(page, () => window.location.search);
    checks.check("the code leaves the address bar", !search.includes("race="), search);
    await inPage(page, () => window.__fakeSky.serve({ t: "rerr", reason: "expired" }));
    const line = await pollUntil(async () => (await chatterText(page))?.includes(EXPIRED_LINE)
      || (await readStore(page)).broadcast?.text === EXPIRED_LINE, { timeoutMs: 8000, intervalMs: 150 });
    checks.check("an expired race says so on the radio", line.ok, (await readStore(page)).broadcast?.text ?? "none");
    const settled = await pollUntil(async () => (await view(page)).phase === "idle" && !/JOINING/.test(await hudText(page)),
      { timeoutMs: 3000, intervalMs: 100 });
    checks.check("the view returns to idle, the join settled", settled.ok, `${(await view(page)).phase} hud=${await hudText(page)}`);

    await page.evaluate(() => {
      for (const k of ["fitz-live-sky-dev", "fitz-beacon-api-dev", "fitz-live-seen-2", "fitz-race-run", "fitz-race-best"]) localStorage.removeItem(k);
    });
  });
}
