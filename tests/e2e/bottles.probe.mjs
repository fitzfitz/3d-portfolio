import {
  withPage, settle, readStore, sceneQuery, pollUntil, isFontHost, respondInertFont,
  SCENE_READY_TIMEOUT_MS,
} from "./harness.mjs";
import { DEEP_SPACE_POINT } from "./deepSpacePoint.mjs";

// Messages in bottles (spec 2026-10-26-message-bottles-design), flown for
// real against a mock of beacon-api/, served through request interception.
// The page is pointed at it with the dev-only localStorage override in
// src/utils/apiBase.ts, then reloaded: no Vite restart, and no other probe
// ever sees the feature.
const API = "https://beacons.mock";
const DAY = 86_400_000;
const [DX, DY, DZ] = DEEP_SPACE_POINT;

/** Two bottles in deep space (60 u clear of every landmark), 40 u apart. */
const SEED = { id: "seed-1", x: DX, y: DY, z: DZ + 10, text: "Clear skies from Jakarta", country: "ID" };
const MARKUP = { id: "seed-2", x: DX + 40, y: DY, z: DZ, text: "<b>x</b> marks the spot", country: null };
/** This browser's own bottles from before, older than everything served: outside the newest 30. */
const OLD_OWN = [0, 1].map((i) => ({ id: `own-old-${i}`, x: 900 + i * 20, y: 50, z: 900, text: `my old note ${i}`, country: "SG" }));
const CAP = 30;

const readX = (page) => page.evaluate(() => window.__fitz.flight.x);
async function frames(page, n = 4) {
  for (let i = 0; i < n; i++) { await settle(page, 80); await readX(page); }
}
const card = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-testid="bottle-card"]');
  const text = root?.querySelector('[data-testid="bottle-card-text"]');
  return root ? {
    bottle: root.dataset.bottle ?? "",
    text: text?.textContent ?? "",
    elements: text?.children.length ?? -1,
    html: text?.innerHTML ?? "",
    meta: root.querySelector('[data-testid="bottle-card-meta"]')?.textContent ?? "",
    tag: root.querySelector('[data-testid="bottle-card-text"]')?.previousElementSibling?.textContent ?? "",
  } : null;
});
const cardShows = (page, id) => pollUntil(async () => (await card(page))?.bottle === id, { timeoutMs: 6_000, intervalMs: 120 });
const broadcast = async (page) => (await readStore(page)).broadcast?.text ?? "";
const hint = (page) => page.evaluate(() => document.querySelector('[data-testid="bottle-hint"]')?.textContent ?? "");
const panelOpen = async (page) => !!(await page.$('[data-testid="bottle-panel"]'));
/**
 * The draw calls and triangles the bottles cost, on their own: both meshes
 * rendered once into a bare scene with the game's camera, then put back, in
 * one synchronous step (no frame runs in between). The whole scene's count
 * moves with traffic and comets by more than the 2 being measured.
 */
const bottleDraws = (page) => page.evaluate(() => {
  const { gl, scene, camera } = window.__fitz;
  const hits = [];
  scene.traverse((o) => { if (o.name === "Bottles" || o.name === "BottlesGlass") hits.push(o); });
  const parents = hits.map((o) => o.parent);
  const bare = new scene.constructor();
  for (const o of hits) bare.add(o);
  const auto = gl.info.autoReset;
  gl.info.autoReset = false;
  gl.info.reset();
  gl.render(bare, camera);
  const out = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, meshes: hits.length };
  gl.info.autoReset = auto;
  hits.forEach((o, i) => parents[i].add(o));
  return out;
});
async function typeNote(page, text) {
  await page.$eval('[data-testid="bottle-text"]', (el) => { el.focus(); el.select(); });
  await page.keyboard.press("Backspace");
  await page.type('[data-testid="bottle-text"]', text);
}

export default async function run() {
  // The mock answers a server-side rejection (400) and the second drop (429);
  // Chrome logs each response as a console error of its own.
  return withPage({ label: "bottles", expectedErrors: [/status of 429 \(Too Many Requests\)/, /status of 400 \(Bad Request\)/] }, async (page, checks) => {
    // Unconfigured, the feature does not exist at all.
    checks.check("without an API the scene has no bottles", !(await sceneQuery(page, "Bottles")).found);
    checks.check("without an API there is no bottle button", !(await page.$('[data-testid="bottle-button"]')));
    checks.check("without an API there is no read card", !(await page.$('[data-testid="bottle-card"]')));
    await page.keyboard.press("KeyB"); await frames(page, 2);
    checks.check("without an API, B opens nothing", !(await panelOpen(page)));

    const now = Date.now();
    const sky = [
      { ...SEED, at: now - 3 * DAY },
      // Hostile rows the client must drop rather than render.
      { id: "<img>", x: 0, y: 0, z: 0, text: "hi there", at: now, country: null },
      { id: "far", x: 1e9, y: 0, z: 0, text: "hi there", at: now, country: null },
      { id: "legacy", x: 10, y: 0, z: 0, phrase: 1, at: now, country: null },
      { ...MARKUP, at: now - 2 * 3_600_000 },
      // More than the 30 the client keeps, far from the test spots.
      ...Array.from({ length: CAP + 3 }, (_, i) => ({
        id: `fill-${i}`, x: 600 + i * 15, y: 120, z: -500, text: `filler note ${i}`, at: now - 4 * DAY - i * 60_000, country: "NL",
      })),
    ];
    const posts = [];
    let gets = 0;
    let dropped = false;
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
    const json = (req, status, body) => req.respond({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith(API)) {
        if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
        if (req.method() === "GET") { gets++; return json(req, 200, { beacons: sky }); }
        const body = JSON.parse(req.postData() ?? "{}");
        posts.push(body);
        // The Worker's filter is the authority: a note the client let through can still be refused.
        if (/sunshine/i.test(body.text ?? "")) return json(req, 400, { error: "rejected", reason: "profanity" });
        if (dropped) return json(req, 429, { error: "rate", reason: "wait", retryAfter: 372 });
        dropped = true;
        return json(req, 201, { beacon: { id: "new-1", x: body.x, y: body.y, z: body.z, text: body.text, at: Date.now(), country: "SG" } });
      }
      if (isFontHost(url)) return respondInertFont(req);
      return req.continue();
    });
    await page.evaluate((api, own, at) => {
      localStorage.setItem("fitz-beacon-api-dev", api);
      localStorage.setItem("fitz-own-bottles", JSON.stringify(own.map((b) => ({ ...b, at }))));
      localStorage.setItem("fitz-own-beacons", JSON.stringify(own.map((b) => b.id)));
    }, API, OLD_OWN, now - 9 * DAY);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(false, true));

    // Drawn: the newest 30 served, plus this browser's own outside them, in two instanced calls.
    const shown = CAP + OLD_OWN.length;
    const loaded = await pollUntil(async () => (await sceneQuery(page, "Bottles")).count === shown, { timeoutMs: 10_000, intervalMs: 300 });
    const mesh = await sceneQuery(page, "Bottles");
    checks.check("the newest 30 bottles show, plus the pilot's own older ones (hostile rows dropped)", loaded.ok, `count=${mesh.count} want ${shown}`);
    const shape = await page.evaluate(() => {
      const hits = [];
      window.__fitz.scene.traverse((o) => { if (o.name.startsWith("Bottles")) hits.push(o); });
      const [a, b] = hits;
      return { names: hits.map((o) => o.name).sort(), instanced: hits.every((o) => o.isInstancedMesh),
        counts: hits.map((o) => o.count), shared: !!a && !!b && a.instanceMatrix === b.instanceMatrix,
        glassVertexColors: hits.find((o) => o.name === "BottlesGlass")?.material.vertexColors };
    });
    checks.check("bottles are two instanced meshes (note + glass) sharing one matrix buffer",
      shape.names.join() === "Bottles,BottlesGlass" && shape.instanced && shape.shared && shape.counts.every((c) => c === shown), JSON.stringify(shape));
    checks.check("the glass's glint mask is not drawn as a colour", shape.glassVertexColors === false);
    const ownScannable = await page.evaluate(() => {
      const s = window.__fitz.store.getState();
      return s.beacons.filter((b) => b.id.startsWith("own-old")).length;
    });
    checks.check("both of the pilot's older bottles are in the sky", ownScannable === OLD_OWN.length, `own=${ownScannable}`);
    checks.check("the bottle button reads BOTTLE (B)", /BOTTLE\s*\(B\)/.test(await page.evaluate(() => document.querySelector('[data-testid="bottle-button"]')?.textContent ?? "")));

    // Draw calls: all the bottles together cost exactly 2.
    const draws = await bottleDraws(page);
    checks.check("all the bottles together cost 2 draw calls", draws.meshes === 2 && draws.calls === 2, JSON.stringify(draws));
    checks.note("bottle triangles", `${draws.triangles} for ${shown} bottles`);

    // Fly close: the card unrolls with the note exactly as written, its country and age; fly on and it closes.
    await page.evaluate((b) => window.__fitz.teleport(b.x, b.y, b.z - 4), SEED);
    const near = await cardShows(page, SEED.id);
    let c = await card(page);
    checks.check("flying within 8 u unrolls the bottle's card", near.ok, JSON.stringify(c));
    checks.check("the card shows the note exactly", c?.text === SEED.text, c?.text);
    checks.check("the card shows the country and the age", c?.meta === "FROM ID · LEFT 3 DAYS AGO", c?.meta);
    checks.check("the card names someone else's bottle", c?.tag === "MESSAGE_BOTTLE", c?.tag);
    await page.evaluate((b) => window.__fitz.teleport(b.x, b.y, b.z - 30), SEED);
    const gone = await pollUntil(async () => (await card(page))?.bottle === "", { timeoutMs: 5_000, intervalMs: 120 });
    checks.check("flying away rolls the card up", gone.ok);

    // Text is text: a note with markup shows literally, as characters, never as elements.
    await page.evaluate((b) => window.__fitz.teleport(b.x, b.y, b.z - 4), MARKUP);
    await cardShows(page, MARKUP.id);
    c = await card(page);
    checks.check("a note containing <b>x</b> shows literally", c?.text === MARKUP.text && c.elements === 0 && c.html.includes("&lt;b&gt;"),
      JSON.stringify(c));
    checks.check("no country: the card gives only the age", c?.meta === "LEFT 2 HOURS AGO", c?.meta);

    // Scan (E) from beyond the card's reach: the radio reads it, and the card unrolls for a while.
    await page.evaluate((b) => window.__fitz.teleport(b.x, b.y, b.z - 14), SEED);
    await frames(page, 6);
    let s = await readStore(page);
    checks.check("a bottle is scannable", s.scanTarget === "bottle_seed-1", `scanTarget=${s.scanTarget}`);
    checks.check("no card at 14 u before the scan", (await card(page))?.bottle === "");
    await page.keyboard.down("KeyE");
    const scanned = await pollUntil(async () => /^SCAN\[MESSAGE_BOTTLE\]/.test(await broadcast(page)), { timeoutMs: 8_000, intervalMs: 150 });
    await page.keyboard.up("KeyE");
    checks.check("scanning reads who left it, when, and the note",
      scanned.ok && (await broadcast(page)) === `SCAN[MESSAGE_BOTTLE] // LEFT 3 DAYS AGO BY A PILOT FROM ID // "${SEED.text}"`, await broadcast(page));
    checks.check("a scanned bottle's card unrolls too", (await cardShows(page, SEED.id)).ok);

    // Write a note. B opens the panel, which owns the keyboard while open.
    await page.evaluate(([x, y, z]) => window.__fitz.teleport(x + 20, y, z - 20), DEEP_SPACE_POINT);
    await frames(page, 3);
    const jumpBefore = (await readStore(page)).jumpRequest?.seq ?? 0;
    await page.keyboard.press("KeyB"); await frames(page, 2);
    checks.check("B opens the bottle panel", await panelOpen(page));
    checks.check("the B that opened it is not typed into the box",
      (await page.evaluate(() => document.querySelector('[data-testid="bottle-text"]')?.value)) === "");
    const disclosure = await page.evaluate(() => document.querySelector('[data-testid="bottle-panel"]')?.textContent ?? "");
    checks.check("the panel discloses that country and time are shown", /country/i.test(disclosure), disclosure.slice(0, 120));
    await page.type('[data-testid="bottle-text"]', "wasd 1 2 L N P");
    await frames(page, 2);
    s = await readStore(page);
    checks.check("typing a note flies, jumps and opens nothing",
      !s.logbookOpen && !s.changelogOpen && !s.photoMode && (s.jumpRequest?.seq ?? 0) === jumpBefore
      && !(await page.evaluate(() => window.__fitz.flight.input.forward)));

    // The filter, at once and on the server.
    await typeNote(page, "come see example.com");
    await frames(page, 2);
    checks.check("a link is refused as you type", (await hint(page)) === "Links and contact details can't be posted.", await hint(page));
    checks.check("Send is disabled for it", await page.evaluate(() => document.querySelector('[data-testid="bottle-send"]')?.disabled === true));
    await page.keyboard.press("Enter"); await frames(page, 2);
    checks.check("nothing is sent for it", posts.length === 0, `posts=${posts.length}`);
    await typeNote(page, "Sunshine and stardust");
    await page.keyboard.press("Enter");
    const refused = await pollUntil(async () => (await hint(page)) === "Please keep it friendly.", { timeoutMs: 8_000, intervalMs: 150 });
    checks.check("the Worker's refusal shows its friendly reason", refused.ok, await hint(page));
    checks.check("the text is kept after a refusal",
      (await page.evaluate(() => document.querySelector('[data-testid="bottle-text"]')?.value)) === "Sunshine and stardust");
    // Carry-over: Cancel forgets the failure; reopening shows the kept text without it.
    await page.click('[data-testid="bottle-cancel"]'); await frames(page, 2);
    await page.keyboard.press("KeyB"); await frames(page, 2);
    checks.check("reopened, the panel keeps the text but not the old failure",
      (await hint(page)) === "" && (await page.evaluate(() => document.querySelector('[data-testid="bottle-text"]')?.value)) === "Sunshine and stardust",
      await hint(page));

    const NOTE = "Hello from the bottles probe!";
    const shipX = await readX(page);
    await typeNote(page, NOTE);
    await page.keyboard.press("Enter");
    const away = await pollUntil(async () => /BOTTLE DROPPED/.test(await broadcast(page)), { timeoutMs: 8_000, intervalMs: 150 });
    const post = posts.at(-1);
    checks.check("Send drops the note at the ship", away.ok && post?.text === NOTE && Math.abs(post.x - shipX) < 2
      && Object.keys(post).sort().join() === "text,x,y,z", JSON.stringify(post));
    checks.check("the panel closes after a drop", !(await panelOpen(page)));
    // Dropped where the ship is, so its own card unrolls at once.
    const mine = await cardShows(page, "new-1");
    c = await card(page);
    checks.check("the new bottle appears at once, and reads as yours", mine.ok && c?.tag === "YOUR_BOTTLE" && c.text === NOTE, JSON.stringify(c));
    checks.check("still the newest 30 plus the pilot's own", (await sceneQuery(page, "Bottles")).count === shown,
      `count=${(await sceneQuery(page, "Bottles")).count}`);
    const own = await page.evaluate(() => JSON.parse(localStorage.getItem("fitz-own-bottles") ?? "[]").map((b) => b.id));
    checks.check("the pilot's own bottle is remembered", own[0] === "new-1", JSON.stringify(own));

    // The 10-minute window: a friendly wait, and the text stays.
    await page.keyboard.press("KeyB"); await frames(page, 2);
    await typeNote(page, "One more for the road");
    await page.keyboard.press("Enter");
    const limited = await pollUntil(async () => (await hint(page)) === "One bottle every 10 minutes. Next in 6:12.", { timeoutMs: 8_000, intervalMs: 150 });
    checks.check("a second drop inside the window says when the next can go", limited.ok, await hint(page));
    checks.check("the text is kept after the wait message",
      (await page.evaluate(() => document.querySelector('[data-testid="bottle-text"]')?.value)) === "One more for the road");

    // Carry-over: J does nothing while the panel owns the keys, even off the text box.
    const guideBefore = await page.evaluate(() => window.__fitz.jellyGuide?.state ?? null);
    await page.focus('[data-testid="bottle-cancel"]');
    await page.keyboard.press("KeyJ"); await frames(page, 4);
    checks.check("J does not call the guide while the panel is open",
      (await page.evaluate(() => window.__fitz.jellyGuide?.state ?? null)) === guideBefore, `before=${guideBefore}`);
    await page.keyboard.press("Escape"); await frames(page, 2);
    checks.check("Esc closes the panel", !(await panelOpen(page)));

    // Carry-over: over the logbook, one Esc closes only the bottle panel.
    await page.keyboard.press("KeyL"); await frames(page, 2);
    await page.keyboard.press("KeyB"); await frames(page, 2);
    checks.check("the panel opens over the logbook", (await panelOpen(page)) && (await readStore(page)).logbookOpen);
    await page.keyboard.press("Escape"); await frames(page, 2);
    checks.check("one Esc closes only the bottle panel", !(await panelOpen(page)) && (await readStore(page)).logbookOpen);

    // The spawn pad (src/data/spawn.ts SPAWN = -50, 62, 69) is a keep-out zone, refused before anything is sent.
    const before = posts.length;
    await page.keyboard.press("Escape"); await frames(page, 2);
    await page.evaluate(() => window.__fitz.teleport(-50 + 2, 62, 69 + 2)); await frames(page, 3);
    await page.keyboard.press("KeyB"); await frames(page, 2);
    await page.keyboard.press("Enter");
    const pad = await pollUntil(async () => /spawn pad/i.test(await hint(page)), { timeoutMs: 8_000, intervalMs: 150 });
    checks.check("a drop on the spawn pad is refused without a request", pad.ok && posts.length === before, `posts=${posts.length} hint=${await hint(page)}`);
    await page.keyboard.press("Escape"); await frames(page, 2);

    // Show bottles off (the logbook switch): no bottles, no card, no scan, nothing fetched.
    await page.keyboard.press("KeyL"); await frames(page, 2);
    await page.click('[data-testid="bottles-toggle"]'); await frames(page, 3);
    await page.keyboard.press("Escape"); await frames(page, 2);
    const getsOff = gets;
    checks.check("Show bottles off removes the bottles", !(await sceneQuery(page, "Bottles")).found && !(await sceneQuery(page, "BottlesGlass")).found);
    checks.check("Show bottles off is remembered", (await page.evaluate(() => localStorage.getItem("fitz-bottles"))) === "0");
    await page.evaluate((b) => window.__fitz.teleport(b.x, b.y, b.z - 4), SEED);
    await frames(page, 6);
    c = await card(page);
    s = await readStore(page);
    checks.check("Show bottles off: no card beside a bottle", c?.bottle === "", JSON.stringify(c));
    checks.check("Show bottles off: nothing to scan", s.scanTarget !== "bottle_seed-1", `scanTarget=${s.scanTarget}`);
    await page.keyboard.press("KeyB"); await frames(page, 2);
    checks.check("Show bottles off: writing still works", await panelOpen(page));
    await page.keyboard.press("Escape"); await frames(page, 2);
    checks.check("Show bottles off fetches nothing", gets === getsOff, `gets ${getsOff} -> ${gets}`);

    await page.evaluate(() => {
      for (const k of ["fitz-beacon-api-dev", "fitz-own-bottles", "fitz-own-beacons", "fitz-bottles"]) localStorage.removeItem(k);
    });
  });
}
