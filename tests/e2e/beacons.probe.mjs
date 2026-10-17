import {
  withPage, settle, readStore, sceneQuery, pollUntil, isFontHost, respondInertFont,
  SCENE_READY_TIMEOUT_MS,
} from "./harness.mjs";

// A mock of beacon-api/, served through request interception. The page is
// pointed at it with the dev-only localStorage override in
// src/utils/beaconApi.ts, then reloaded — no Vite restart, and no other probe
// ever sees the feature.
const API = "https://beacons.mock";
const DAY = 86_400_000;

const readX = (page) => page.evaluate(() => window.__fitz.flight.x);
async function frames(page, n = 4) {
  for (let i = 0; i < n; i++) { await settle(page, 80); await readX(page); }
}

export default async function run() {
  // The mock answers the second drop with 429 to test the rate-limit message;
  // Chrome logs that response as a console error of its own.
  return withPage({ label: "beacons", expectedErrors: [/status of 429 \(Too Many Requests\)/] }, async (page, checks) => {
    // Unconfigured, the feature does not exist at all.
    const absent = await sceneQuery(page, "Beacons");
    checks.check("without an API the scene has no beacons", !absent.found);
    checks.check("without an API there is no beacon button", !(await page.$('[data-testid="beacon-button"]')));
    await page.keyboard.press("KeyB"); await frames(page, 2);
    checks.check("without an API, B opens nothing", !(await page.$('[data-testid="beacon-picker"]')));

    const now = Date.now();
    const sky = [
      { id: "seed-1", x: -120, y: 40, z: 100, phrase: 1, at: now - 3 * DAY, country: "ID" },
      { id: "seed-2", x: 150, y: -60, z: -40, phrase: 0, at: now - 2 * 3_600_000, country: null },
      // Hostile rows the client must drop rather than render.
      { id: "<img>", x: 0, y: 0, z: 0, phrase: 0, at: now, country: null },
      { id: "far", x: 1e9, y: 0, z: 0, phrase: 0, at: now, country: null },
    ];
    const posts = [];
    let rateLimited = false;
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith(API)) {
        if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
        if (req.method() === "GET") {
          return req.respond({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ beacons: sky }) });
        }
        const body = JSON.parse(req.postData() ?? "{}");
        posts.push(body);
        if (rateLimited) return req.respond({ status: 429, headers: cors, contentType: "application/json", body: "{\"error\":\"rate\"}" });
        rateLimited = true;
        const beacon = { id: `new-${posts.length}`, ...body, at: Date.now(), country: "SG" };
        return req.respond({ status: 201, headers: cors, contentType: "application/json", body: JSON.stringify({ beacon }) });
      }
      if (isFontHost(url)) return respondInertFont(req);
      return req.continue();
    });
    await page.evaluate((api) => localStorage.setItem("fitz-beacon-api-dev", api), API);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(false, true));

    const loaded = await pollUntil(async () => (await sceneQuery(page, "Beacons")).count === 2,
      { timeoutMs: 10_000, intervalMs: 300 });
    const mesh = await sceneQuery(page, "Beacons");
    checks.check("the sky's beacons render, hostile rows dropped", loaded.ok, JSON.stringify(mesh));
    checks.check("the beacon button appears", !!(await page.$('[data-testid="beacon-button"]')));

    // Scan a beacon for its message.
    await page.evaluate(() => window.__fitz.teleport(-120, 40, 106));
    await frames(page, 6);
    let s = await readStore(page);
    checks.check("a beacon is scannable", s.scanTarget === "beacon_seed-1", `scanTarget=${s.scanTarget}`);
    await page.keyboard.down("KeyE");
    const scanned = await pollUntil(async () => /^BEACON \/\//.test((await readStore(page)).broadcast?.text ?? ""),
      { timeoutMs: 8_000, intervalMs: 150 });
    await page.keyboard.up("KeyE");
    s = await readStore(page);
    checks.check("scanning reads the phrase, origin and age",
      scanned.ok && s.broadcast.text === 'BEACON // "NICE VIEW" · PILOT FROM ID · 3 DAYS AGO', s.broadcast?.text ?? "none");

    // Drop one: B opens the picker, which owns the keyboard while open.
    const jumpBefore = s.jumpRequest?.seq ?? 0;
    await page.keyboard.press("KeyB"); await frames(page, 2);
    checks.check("B opens the phrase picker", !!(await page.$('[data-testid="beacon-picker"]')));
    await page.keyboard.down("KeyW"); await frames(page, 2);
    const forward = await page.evaluate(() => window.__fitz.flight.input.forward);
    await page.keyboard.up("KeyW");
    checks.check("the picker blocks flight keys", forward === false);
    const shipX = await readX(page);
    await page.keyboard.press("Digit3");
    const dropped = await pollUntil(async () => /BEACON DROPPED/.test((await readStore(page)).broadcast?.text ?? ""),
      { timeoutMs: 8_000, intervalMs: 150 });
    s = await readStore(page);
    checks.check("a number key drops that phrase at the ship", dropped.ok && posts[0]?.phrase === 2
      && Math.abs(posts[0].x - shipX) < 2, JSON.stringify(posts[0]));
    checks.check("the number key did not also jump", (s.jumpRequest?.seq ?? 0) === jumpBefore);
    checks.check("the picker closes after a drop", !(await page.$('[data-testid="beacon-picker"]')));
    await frames(page, 3);
    checks.check("the new beacon appears at once", (await sceneQuery(page, "Beacons")).count === 3);
    const own = await page.evaluate(() => JSON.parse(localStorage.getItem("fitz-own-beacons") ?? "[]"));
    checks.check("the pilot's own beacon is remembered", own.includes("new-1"), JSON.stringify(own));

    await page.keyboard.press("KeyB"); await frames(page, 2);
    await page.keyboard.press("Digit1");
    const limited = await pollUntil(async () => /ONE BEACON PER PILOT/.test((await readStore(page)).broadcast?.text ?? ""),
      { timeoutMs: 8_000, intervalMs: 150 });
    checks.check("a second drop inside the window reports the rate limit", limited.ok);

    // The spawn pad (src/data/spawn.ts SPAWN = -50, 62, 69) is a keep-out zone, refused before anything is sent.
    await page.evaluate(() => window.__fitz.teleport(-50 + 2, 62, 69 + 2)); await frames(page, 3);
    await page.keyboard.press("KeyB"); await frames(page, 2);
    await page.keyboard.press("Digit1");
    const refused = await pollUntil(async () => /TOO CLOSE TO THE SPAWN PAD/.test((await readStore(page)).broadcast?.text ?? ""),
      { timeoutMs: 8_000, intervalMs: 150 });
    checks.check("a drop on the spawn pad is refused without a request", refused.ok && posts.length === 2,
      `posts=${posts.length}`);
    await page.keyboard.press("KeyB"); await frames(page, 2);
    const disclosure = await page.evaluate(() => document.querySelector('[data-testid="beacon-picker"]')?.textContent ?? "");
    checks.check("the picker discloses that country and time are shown", /country/i.test(disclosure), disclosure.slice(0, 120));
    await page.keyboard.press("Escape"); await frames(page, 2);
    checks.check("Esc cancels the picker", !(await page.$('[data-testid="beacon-picker"]')));
    checks.check("cancelling drops nothing", posts.length === 2, `posts=${posts.length}`);

    await page.evaluate(() => localStorage.removeItem("fitz-beacon-api-dev"));
  });
}
