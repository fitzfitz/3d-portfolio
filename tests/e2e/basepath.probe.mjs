/**
 * Proves the production build works when served from a subpath, the way a
 * GitHub Pages project page serves it (/3d-portfolio/).
 *
 * Why this probe cannot use the shared harness: withPage() spawns the *dev*
 * server and waits on `window.__fitz`, which is dev-only and dead-stripped from
 * production builds. This probe must exercise the real built artifact, so it
 * builds, runs `vite preview`, and drives the page itself.
 *
 * Why it exists at all: a wrong base path is invisible to every other gate. The
 * build succeeds, tsc is happy, all 139 unit tests pass — and the deployed page
 * renders an empty sky because every runtime asset URL 404s. The only way to
 * catch it is to load the built artifact at the subpath and watch the network.
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { Checks, isFontHost, respondInertFont, settle, pollUntil, CANVAS_READY_TIMEOUT_MS, chromeArgs } from "./harness.mjs";

const CHROME = process.env.CHROME_PATH
  ?? "/Users/fitzgeral/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5201;
const BASE = "/3d-portfolio/";
const OUT_DIR = "dist-pages";
const URL_UNDER_TEST = `http://localhost:${PORT}${BASE}`;

/**
 * Assets that must resolve on a first load of the landing view. A production
 * build ships public/models as asset packs (vite.config.ts, utils/assetPack.ts):
 * the common pack plus ONE texture tier, the 4096 maps (hd) on fine-pointer
 * desktops, the 2048 originals (sd) on touch clients. Pinned as an explicit
 * list rather than a ">0 assets loaded" count, so a build that silently stops
 * loading a pack still fails.
 */
const REQUIRED_ASSETS = [
  /world-common\.[0-9a-f]{10}\.pack$/,
  [/world-hd\.[0-9a-f]{10}\.pack$/, /world-sd\.[0-9a-f]{10}\.pack$/],
];
const PACK_RE = /world-[a-z]+\.[0-9a-f]{10}\.pack$/;
/** How long the probe holds each pack request (see the request handler). */
const PACK_DELAY_MS = 2500;
const has = (urls, a) => [a].flat().some((re) => urls.some((u) => re.test(u)));
const label = (a) => [a].flat().map((re) => re.source).join(" or ");

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${err.slice(-500)}`))));
  });
}

export default async function basepathProbe() {
  const checks = new Checks("basepath");

  // Build into a throwaway outDir so a normal `dist/` (base "/") is not
  // clobbered by a subpath build a developer would then preview by mistake.
  rmSync(OUT_DIR, { recursive: true, force: true });
  // Blank the beacon API: a production build reads .env.production, and a
  // test page must never call the live Worker (its CORS refuses localhost).
  await run("npx", ["vite", "build", "--outDir", OUT_DIR], { BASE_PATH: BASE, VITE_BEACON_API: "", VITE_LIVE_SKY: "" });

  const server = spawn(
    "npx",
    ["vite", "preview", "--port", String(PORT), "--strictPort", "--outDir", OUT_DIR],
    { env: { ...process.env, BASE_PATH: BASE }, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stderr.on("data", (d) => process.stderr.write(`[preview] ${d}`));

  const deadline = Date.now() + 30_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL_UNDER_TEST, { signal: AbortSignal.timeout(1000) });
      if (res.ok) { up = true; break; }
    } catch { /* not up yet */ }
    await settle(null, 300);
  }
  if (!up) {
    server.kill("SIGTERM");
    throw new Error(`vite preview did not come up on ${PORT} within 30s`);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: chromeArgs(),
  });

  const failed = [];       // requests that 404'd or errored
  const okAssets = [];     // asset URLs that resolved 2xx
  const askedForAssets = []; // EVERY pack or /models/ URL requested, resolved or not
  const looseModels = [];   // /models/ requests: the packs should have covered them
  const pageErrors = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (req) => {
      if (isFontHost(req.url())) return;
      failed.push(`${req.url()} — ${req.failure()?.errorText ?? "failed"}`);
    });
    page.on("response", (res) => {
      const url = res.url();
      if (isFontHost(url)) return;
      if (res.status() >= 400) failed.push(`${url} — HTTP ${res.status()}`);
      else if (/\.(pack|glb|webp|svg|js|css)(\?|$)/.test(url)) okAssets.push(url);
    });

    // Track in-flight requests so the probe waits for the page to go quiet,
    // not a fixed 6s that flaked under full-suite load (moon.glb missing once).
    // Keyed by URL, not request: under interception Chrome reports each
    // self-hosted font request twice and finishes only one of the pair, so a
    // per-request count never drains (the fonts themselves load fine).
    const inflight = new Set();
    let lastActivity = Date.now();
    page.on("request", (req) => { inflight.add(req.url()); lastActivity = Date.now(); });
    const done = (req) => { inflight.delete(req.url()); lastActivity = Date.now(); };
    page.on("requestfinished", done);
    page.on("requestfailed", done);

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (isFontHost(url)) return respondInertFont(req);
      // Record the ATTEMPT, not the outcome. Recording only successful
      // responses would make the "served from under the base" check below
      // vacuous: a wrong-base request 404s, so it never appears among
      // successes and the check passes while the bug is present. Verified by
      // temporarily reintroducing a bare literal — that check was the one
      // check of six that still passed.
      if (/\/models\//.test(url)) looseModels.push(url);
      if (/\/models\//.test(url) || PACK_RE.test(url)) askedForAssets.push(url);
      // Hold the packs back so they arrive after the 3D code, as they do on
      // a real connection (~7 MB against ~0.6 MB). On localhost they would
      // land first, and a scene rendering before its packs (loose URLs)
      // would go unnoticed.
      if (PACK_RE.test(url)) return void setTimeout(() => req.continue(), PACK_DELAY_MS);
      return req.continue();
    });

    await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
    // See harness.mjs's CANVAS_READY_TIMEOUT_MS: this probe drives its own
    // puppeteer session (a production build, not withPage's dev server) but
    // pays the same eager Preload compile cost as every other probe.
    await page.waitForSelector("canvas", { timeout: CANVAS_READY_TIMEOUT_MS });
    // Wait for every landing-view asset to resolve, then for the network to go
    // quiet. Idle alone is not enough: the scene loads in Suspense stages, and
    // under load the gap before a later stage (moon.glb, ~1.2s after the
    // previous model) outlasts any idle window, so "idle" fired before the
    // moon was even requested. On timeout the asset check below names what is
    // missing.
    const resolved = () => REQUIRED_ASSETS.every((a) => has(okAssets, a));
    const idle = await pollUntil(async () => resolved() && inflight.size === 0 && Date.now() - lastActivity > 1000,
      { timeoutMs: 45_000, intervalMs: 250 });
    checks.check("every landing-view asset resolved and the network went idle", idle.ok,
      idle.ok ? "" : `in flight: ${[...inflight].join(", ") || "none"}; resolved=${resolved()}`);

    // --- the checks that matter ---

    checks.check("no failed or 404 requests under the subpath", failed.length === 0,
      failed.slice(0, 5).join(" | "));

    // The service worker claims the page within ~100 ms, and puppeteer's page
    // events do not see requests it answers. The page's own resource timing
    // does, so merge it in: without it a scene fetching all 26 loose models
    // passed the "no loose /models/ request" check.
    const inPage = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name));
    for (const u of inPage) {
      if (/\/models\//.test(u) && !looseModels.includes(u)) looseModels.push(u);
      if ((/\/models\//.test(u) || PACK_RE.test(u)) && !askedForAssets.includes(u)) askedForAssets.push(u);
    }

    const missing = REQUIRED_ASSETS.filter((a) => !has(okAssets, a));
    checks.check(`all ${REQUIRED_ASSETS.length} landing-view packs resolved`, missing.length === 0,
      missing.length ? `missing: ${missing.map(label).join(", ")}` : `${okAssets.length} asset responses`);
    const tiers = askedForAssets.filter((u) => /world-(hd|sd)\./.test(u));
    checks.check("exactly one texture tier was downloaded", tiers.length === 1, tiers.join(" | "));
    checks.check("the packs covered the landing view (no loose /models/ request)", looseModels.length === 0,
      looseModels.slice(0, 3).join(" | "));

    // Every asset must be REQUESTED from under the base, not the domain root.
    const rootServed = askedForAssets.filter((u) => !new URL(u).pathname.startsWith(BASE));
    checks.check("no asset was requested from the domain root", rootServed.length === 0,
      rootServed.slice(0, 3).join(" | "));
    // ...and the check above must have had something to judge, or it passes on
    // an empty list while proving nothing.
    checks.check("asset requests were actually observed", askedForAssets.length > 0,
      `${askedForAssets.length} pack or /models/ requests seen`);

    // Guard against the vacuous pass: a blank page also produces zero failures.
    //
    // Must target the WebGL canvas explicitly. There are two canvases and the
    // 2D radar overlay comes FIRST in DOM order, so `querySelector("canvas")`
    // returns the radar (148x148) — verified against the live site. Checking
    // that one would report a healthy 3D view while the scene was empty.
    const webgl = await page.evaluate(() => {
      const c = [...document.querySelectorAll("canvas")].find((el) => !!el.getContext("webgl2"));
      return c ? { w: c.width, h: c.height } : null;
    });
    checks.check("the WebGL canvas is present and full-size (not a blank scene)",
      !!webgl && webgl.w >= 1280 && webgl.h >= 800,
      webgl ? `${webgl.w}x${webgl.h}` : "no webgl2 canvas found");

    checks.check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

    await page.screenshot({ path: `${OUT_DIR}/basepath-render.png` });
    checks.note("subpath render captured", `${OUT_DIR}/basepath-render.png`);

    // --- the asset-pack paths: a return visit, offline, and a broken pack ---

    // "Renders the scene": the spawn banner (gated on sceneReady, i.e. every
    // model and texture in and warmed) plus the full-size WebGL canvas.
    const sceneUp = async (p) => {
      try {
        await p.waitForFunction(() => document.body.innerText.includes("SPACE FLIGHT CV"), { timeout: CANVAS_READY_TIMEOUT_MS });
        return await p.evaluate(() => [...document.querySelectorAll("canvas")].some((el) => !!el.getContext("webgl2") && el.width >= 1280));
      } catch {
        return false;
      }
    };
    // Resource timing, not puppeteer events: the service worker answers most
    // requests by now, and those never reach page events.
    const loaded = (p, re) => p.evaluate((src) => performance.getEntriesByType("resource")
      .map((e) => e.name).filter((n) => new RegExp(src).test(n)).length, re.source);

    await page.reload({ waitUntil: "domcontentloaded" });
    const returnUp = await sceneUp(page);
    const returnPacks = await loaded(page, /\.pack$/);
    checks.check("return visit downloads no pack and renders the scene", returnUp && returnPacks === 0,
      `scene=${returnUp} pack downloads=${returnPacks}`);

    await page.setOfflineMode(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      checks.check("offline reload renders the scene", await sceneUp(page));
    } catch (e) {
      checks.check("offline reload renders the scene", false, String(e).slice(0, 200));
    } finally {
      await page.setOfflineMode(false);
    }

    // Cloudflare's SPA fallback answers a missing or stale pack name with
    // index.html and a 200. A fresh profile (no worker, no cached packs)
    // gets exactly that for the common pack and must fall back to the loose
    // files that every build still ships.
    const fresh = await browser.createBrowserContext();
    try {
      const p2 = await fresh.newPage();
      await p2.setViewport({ width: 1280, height: 800 });
      const errors = [];
      p2.on("pageerror", (e) => errors.push(e.message));
      await p2.setRequestInterception(true);
      p2.on("request", (req) => {
        const url = req.url();
        if (isFontHost(url)) return respondInertFont(req);
        if (/world-common\.[0-9a-f]{10}\.pack$/.test(url)) {
          return req.respond({ status: 200, contentType: "text/html", body: "<!doctype html><title>x</title>" });
        }
        return req.continue();
      });
      await p2.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
      const up = await sceneUp(p2);
      const loose = await loaded(p2, /\/models\//);
      checks.check("a pack answered by the SPA fallback falls back to loose files", up && loose > 0 && errors.length === 0,
        `scene=${up} loose /models/ loads=${loose} errors=${errors.slice(0, 2).join(" | ")}`);
    } finally {
      await fresh.close();
    }
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }

  return checks;
}
