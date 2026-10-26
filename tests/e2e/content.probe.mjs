import { withPage, readStore, sceneQuery, pollUntil, isFontHost, respondInertFont, runParts, SCENE_READY_TIMEOUT_MS } from "./harness.mjs";

// Projects and career from beacon-api's GET /content
// (docs/archive/specs/2026-10-23-dynamic-content-design.md). The page is
// pointed at a mock API through the dev-only localStorage override
// (src/utils/apiBase.ts) and reloaded, as bottles.probe.mjs does, so no other
// probe ever sees the API. Three pages:
//   0. no API: today's layout, from the bundled data;
//   1. a live /content with a fourth project and three jobs: loading waits for
//      it, and the changed data shows up (probe, HUD rows, keys, buoys, logbook);
//   2. a /content that hangs: loading times out to the fallback (bundled, then
//      the last good payload) and the game still loads.
const API = "https://content.mock";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

const BUNDLED_HOMES = [[-30, 80, 48], [-111, 60, 100], [-67, 102, -7]];
const SLOT_4_HOME = [-23, 89, 143];

/** The rows as D1 serves them (beacon-api/src/index.ts d1Content). */
const project = (id, sort, title, color, short = "A project.") => ({
  id, sort, title, role: "Personal project", duration: "2026", short, description: `${title}, described.`,
  tech: "[\"Go\",\"SQLite\"]", color, repo: null,
});
const job = (id, company, start, end) => ({
  id, sort: id * 10, role: "Engineer", company, note: null, start, end, employment: "Full-time",
  location: "Jakarta, Indonesia", summary: `Worked at ${company}.`,
});
const DYNAMIC = {
  projects: [
    project("ruangrapi", 10, "RuangRapi Live", "#00ff87"),
    project("portfolio", 20, "This Flight-Sim CV", "#00f0ff"),
    project("fuxx", 30, "fuxx", "#bd00ff"),
    project("atlas", 40, "Atlas Mapper", "#ff8800", "Maps the sky."),
    // Dropped by the client's validation, with a console.warn: a bad colour.
    project("broken", 50, "Broken", "orange"),
  ],
  career: [job(1, "Acme", "Jan 2022", null), job(2, "Globex", "Mar 2019", "Dec 2021"), job(3, "Initech", "Jun 2015", "Feb 2019")],
};

const sceneReady = (page) => page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
const contentSource = (page) => page.evaluate(async () => (await import("/src/data/content.ts")).contentSource());
const probeIds = (page) => page.evaluate(async () => [...(await import("/src/data/probes.ts")).PROBE_IDS]);
const probeAt = (page, id) => page.evaluate((i) => { const p = window.__fitz.probes?.[i]; return p ? [p.x, p.y, p.z] : null; }, id);
const sectorText = (page) => page.evaluate(() => document.body.innerText);
const same = (a, b) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

/**
 * Serves the mock API: /content by `content(req)` (a { status, body } answer,
 * a promise of one, or null to hang), /beacons empty. Fonts as the harness does.
 */
async function mockApi(page, content) {
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const url = req.url();
    if (isFontHost(url)) return respondInertFont(req);
    if (!url.startsWith(API)) return req.continue();
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS });
    if (url.startsWith(`${API}/beacons`)) return req.respond({ status: 200, headers: CORS, contentType: "application/json", body: "{\"beacons\":[]}" });
    const answer = await content(req);
    if (!answer) return; // hang: never answered
    try {
      await req.respond({ status: answer.status, headers: CORS, contentType: "application/json", body: JSON.stringify(answer.body) });
    } catch { /* the page moved on */ }
  });
}

/** Reloads pointed at the mock API; resolves with the reload's start time. */
async function reloadWithApi(page, { cache } = {}) {
  await page.evaluate(([api, kept]) => {
    localStorage.setItem("fitz-beacon-api-dev", api);
    if (kept === null) localStorage.removeItem("fitz-content");
    else if (kept !== undefined) localStorage.setItem("fitz-content", kept);
  }, [API, cache]);
  const t0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  return t0;
}

/** Polls (node side) until the app's store exists; the ms after `t0`, and the overlay lines seen meanwhile. */
async function watchBoot(page, t0) {
  const lines = new Set();
  for (;;) {
    const s = await page.evaluate(() => ({ app: !!window.__fitz?.store, step: document.getElementById("boot-step")?.textContent ?? "" }))
      .catch(() => ({ app: false, step: "" }));
    if (s.step) lines.add(s.step);
    if (s.app) return { appMs: Date.now() - t0, lines: [...lines] };
    if (Date.now() - t0 > 30_000) return { appMs: Infinity, lines: [...lines] };
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function checkBundledLayout(page, checks, tag) {
  const ids = await probeIds(page);
  checks.check(`${tag}: the three bundled projects are the probes`, JSON.stringify(ids) === JSON.stringify(["ruangrapi", "portfolio", "fuxx"]), JSON.stringify(ids));
  for (let i = 0; i < 3; i++) {
    const at = await probeAt(page, ids[i]);
    checks.check(`${tag}: probe ${i + 1} at today's home`, same(at, BUNDLED_HOMES[i]), JSON.stringify(at));
  }
  const buoys = await sceneQuery(page, "CareerBuoys");
  checks.check(`${tag}: five career buoys`, buoys.count === 5, JSON.stringify(buoys));
  const s = await readStore(page);
  const text = await sectorText(page);
  checks.check(`${tag}: the career station is key 4`, /\[4\]\s*STATION_CAREER/.test(text), text.match(/\[\d\]\s*STATION_CAREER/)?.[0] ?? "none");
  checks.check(`${tag}: three dossiers to read`, /DOSSIERS:\s*0\/3/.test(text), `visited=${JSON.stringify(s.visitedDossiers)}`);
}

export const parts = [
  // 0. No API configured (dev and e2e default): the bundled data, no request.
  () => withPage({ label: "content-none" }, async (page, checks) => {
    checks.check("without an API the content is the bundled snapshot", (await contentSource(page)) === "bundled");
    await checkBundledLayout(page, checks, "no API");
  }),

  // 1. A live /content: loading waits for it, then the changed data shows.
  () => withPage({ label: "content-live" }, async (page, checks) => {
    const HOLD_MS = 1500;
    let answeredAt = 0;
    await mockApi(page, () => new Promise((r) => setTimeout(() => { answeredAt = Date.now(); r({ status: 200, body: DYNAMIC }); }, HOLD_MS)));
    const t0 = await reloadWithApi(page, { cache: null });
    const boot = await watchBoot(page, t0);
    checks.check("the app loads only after /content answered", answeredAt > 0 && t0 + boot.appMs >= answeredAt,
      `answered +${answeredAt - t0} ms, app +${boot.appMs} ms`);
    checks.check("the overlay shows the step while it waits", boot.lines.includes("SYNCING MISSION DATA..."), JSON.stringify(boot.lines));
    await sceneReady(page);

    checks.check("the content came from the API", (await contentSource(page)) === "api");
    const ids = await probeIds(page);
    checks.check("four probes: the bundled three in sort order, then the new one (the bad row dropped)",
      JSON.stringify(ids) === JSON.stringify(["ruangrapi", "portfolio", "fuxx", "atlas"]), JSON.stringify(ids));
    for (let i = 0; i < 3; i++) {
      const at = await probeAt(page, ids[i]);
      checks.check(`probe ${i + 1} stays at today's home`, same(at, BUNDLED_HOMES[i]), JSON.stringify(at));
    }
    const atlas = await probeAt(page, "atlas");
    checks.check("the new project's probe sits on slot 4", same(atlas, SLOT_4_HOME), JSON.stringify(atlas));
    const text = await sectorText(page);
    checks.check("the HUD lists the new probe", text.includes("PROBE_ATLAS"));
    checks.check("the keys shift: the new probe is 4, the career station 5", /\[4\]\s*PROBE_ATLAS/.test(text) && /\[5\]\s*STATION_CAREER/.test(text),
      `${text.match(/\[\d\]\s*PROBE_ATLAS/)?.[0]} / ${text.match(/\[\d\]\s*STATION_CAREER/)?.[0]}`);
    checks.check("the dossier count follows the probes", /DOSSIERS:\s*0\/4/.test(text));
    checks.check("the changed title shows on the spawn card", text.includes("RuangRapi Live"));
    checks.check("the spawn card counts four probes", text.includes("Four probes carry four projects."));
    const buoys = await sceneQuery(page, "CareerBuoys");
    checks.check("three jobs give three buoys", buoys.count === 3, JSON.stringify(buoys));
    const book = await page.evaluate(async () => (await import("/src/utils/logbook.ts")).LOGBOOK.filter((e) => e.section === "essential").map((e) => e.id));
    checks.check("the logbook has a dossier per probe", JSON.stringify(book) === JSON.stringify(["ruangrapi", "portfolio", "fuxx", "atlas", "career", "contact"]), JSON.stringify(book));
    const tint = await page.evaluate(async () => (await import("/src/constants.ts")).projectById("atlas")?.color);
    checks.check("the new probe is tinted its project colour", tint === "#ff8800", tint);
    const kept = await page.evaluate(() => localStorage.getItem("fitz-content"));
    checks.check("the answer is kept as the last good payload", !!kept && JSON.parse(kept).projects.length === 5);
    // Jumping to the new probe by its key works like any other.
    await page.keyboard.press("Digit4");
    const landed = await pollUntil(() => page.evaluate(() => {
      const p = window.__fitz.probes?.atlas, f = window.__fitz.flight;
      return p && Math.abs(Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z) - 12) < 0.75;
    }), { timeoutMs: 15_000, intervalMs: 100 });
    checks.check("key 4 jumps to the new probe", landed.ok);
  }),

  // 2. A /content that hangs: the timeout falls back, and the game still loads.
  () => withPage({ label: "content-hang" }, async (page, checks) => {
    await mockApi(page, () => null);
    let t0 = await reloadWithApi(page, { cache: null });
    let boot = await watchBoot(page, t0);
    checks.check("a hanging /content holds loading about 4 s, no more", boot.appMs >= 3900 && boot.appMs < 9000, `${boot.appMs} ms`);
    checks.check("the overlay shows the step, then the onboard copy", boot.lines.includes("SYNCING MISSION DATA...") && boot.lines.includes("MISSION DATA: ONBOARD"),
      JSON.stringify(boot.lines));
    await sceneReady(page);
    checks.check("with nothing kept, it falls back to the bundled data", (await contentSource(page)) === "bundled");
    await checkBundledLayout(page, checks, "hanging, nothing kept");

    // A payload kept from an earlier visit is the next fallback.
    t0 = await reloadWithApi(page, { cache: JSON.stringify(DYNAMIC) });
    boot = await watchBoot(page, t0);
    checks.check("the overlay says it used the last known copy", boot.lines.includes("MISSION DATA: LAST KNOWN"), JSON.stringify(boot.lines));
    await sceneReady(page);
    checks.check("with a payload kept, it falls back to that", (await contentSource(page)) === "cache");
    const ids = await probeIds(page);
    checks.check("the kept payload's probes are in play", JSON.stringify(ids) === JSON.stringify(["ruangrapi", "portfolio", "fuxx", "atlas"]), JSON.stringify(ids));
  }),
];

export default () => runParts(parts);
