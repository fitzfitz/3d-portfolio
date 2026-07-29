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
import { Checks, isFontHost, respondInertFont, settle } from "./harness.mjs";

const CHROME = process.env.CHROME_PATH
  ?? "/Users/fitzgeral/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5201;
const BASE = "/3d-portfolio/";
const OUT_DIR = "dist-pages";
const URL_UNDER_TEST = `http://localhost:${PORT}${BASE}`;

/**
 * Assets that must resolve on a first load of the landing view. Pinned as an
 * explicit list rather than a ">0 assets loaded" count, so a build that
 * silently stops loading nine of eleven models still fails.
 *
 * creature.glb is deliberately absent: SpaceJellyfish is summon-gated (J key)
 * and its GLB is not fetched on the initial view.
 */
const REQUIRED_ASSETS = [
  "models/spaceship.glb",
  "models/asteroids.glb",
  "models/cargo_ship.glb",
  "models/comet_head.glb",
  "models/moon.glb",
  "models/portal_gateway.glb",
  "models/space_crystal.glb",
  "models/earth.webp",
  "models/jupiter.webp",
  "models/mars.webp",
];

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
  await run("npx", ["vite", "build", "--outDir", OUT_DIR], { BASE_PATH: BASE });

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
    args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
  });

  const failed = [];       // requests that 404'd or errored
  const okAssets = [];     // asset URLs that resolved 2xx
  const askedForModels = []; // EVERY /models/ URL requested, resolved or not
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
      else if (/\.(glb|webp|svg|js|css)(\?|$)/.test(url)) okAssets.push(url);
    });

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
      if (/\/models\//.test(url)) askedForModels.push(url);
      return req.continue();
    });

    await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await settle(null, 6000); // let every GLB/texture fetch resolve

    // --- the checks that matter ---

    checks.check("no failed or 404 requests under the subpath", failed.length === 0,
      failed.slice(0, 5).join(" | "));

    const missing = REQUIRED_ASSETS.filter((a) => !okAssets.some((u) => u.endsWith(a)));
    checks.check(`all ${REQUIRED_ASSETS.length} landing-view assets resolved`, missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : `${okAssets.length} asset responses`);

    // Every asset must be REQUESTED from under the base, not the domain root.
    const rootServed = askedForModels.filter((u) => !new URL(u).pathname.startsWith(BASE));
    checks.check("no asset was requested from the domain root", rootServed.length === 0,
      rootServed.slice(0, 3).join(" | "));
    // ...and the check above must have had something to judge, or it passes on
    // an empty list while proving nothing.
    checks.check("model requests were actually observed", askedForModels.length > 0,
      `${askedForModels.length} /models/ requests seen`);

    // Guard against the vacuous pass: a blank page also produces zero failures.
    const canvasPainted = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      return !!c && c.width > 0 && c.height > 0;
    });
    checks.check("canvas is present and sized (not a blank page)", canvasPainted);

    checks.check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

    await page.screenshot({ path: `${OUT_DIR}/basepath-render.png` });
    checks.note("subpath render captured", `${OUT_DIR}/basepath-render.png`);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }

  return checks;
}
