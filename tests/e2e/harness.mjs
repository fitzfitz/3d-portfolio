// Shared e2e harness: spawns its own Vite server, drives headless Chrome,
// captures page errors as failures, and collects structured check results.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";

const CHROME = process.env.CHROME_PATH
  ?? "/Users/fitzgeral/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5199;
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * Console errors that are known-benign and must NOT fail the suite.
 * Every entry needs a comment justifying it — an unexplained ignore here is
 * how a real regression hides.
 */
const IGNORED_ERRORS = [
  // SwiftShader software GL lacks some extensions three.js probes for.
  /THREE\.WebGLRenderer: (EXT|WEBGL)_/,
];

/**
 * Google Fonts is the one non-local request the app legitimately makes on
 * every load: index.html preconnects to fonts.googleapis.com/
 * fonts.gstatic.com and links a stylesheet from the former. If those hosts
 * are unreachable (DNS blip, offline CI runner), Chrome would otherwise emit
 * a `console.error: Failed to load resource: net::ERR_FAILED` that
 * withPage's "no page errors" check promotes into a suite-wide failure — so
 * every probe needs this handled, not just the ones that happen to set up
 * their own request interception.
 */
export const isFontHost = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "fonts.googleapis.com" || hostname === "fonts.gstatic.com";
  } catch {
    return false;
  }
};

/**
 * Fulfils a font-host request with an inert stylesheet rather than
 * `req.abort()`-ing it: an aborted resource load is what produces the
 * "Failed to load resource: net::ERR_FAILED" console.error in the first
 * place (verified in contact.probe.mjs's development — the same message
 * appeared when the relay POST was blocked before proper CORS headers were
 * added). Responding 200 satisfies the `<link rel="stylesheet">` with no
 * real network hit and no console noise.
 */
export const respondInertFont = (req) =>
  req.respond({ status: 200, contentType: "text/css", body: "" });

let server = null;

export async function startServer() {
  if (server) return;
  server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  server.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Vite did not come up on ${PORT} within 30s`);
}

export async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  server = null;
}

/** Collects named pass/fail results for one probe. */
export class Checks {
  constructor(label) { this.label = label; this.results = []; }
  check(name, pass, detail = "") {
    this.results.push({ name, pass: !!pass, detail });
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  /** Records a capture-only observation that a human must judge (see QA checklist). */
  note(name, detail) {
    this.results.push({ name, pass: true, detail: `(capture only) ${detail}`, note: true });
    console.log(`  NOTE  ${name} — ${detail}`);
  }
}

/**
 * Launches Chrome, opens the app, waits for the canvas and first frame, runs
 * `fn(page, checks)`, then always tears down. Page errors and non-ignored
 * console errors are appended as failed checks.
 *
 * Also permanently disables automatic low-perf decline (`lowPerfManual =
 * true`) so the scene graph stays at full fidelity deterministically —
 * headless SwiftShader is slow enough that the app's real
 * `PerformanceMonitor.onDecline` would otherwise fire and unmount perf-gated
 * objects (WarpTunnel, ShootingStars, ...) during every probe. Several
 * probes' full-fidelity baselines depend on this. Probes that want to test
 * perf-degradation behavior can still call `setLowPerf(true, ...)` themselves
 * — only the automatic decline path is blocked.
 *
 * `emulateReducedMotion`, if true, emulates the `prefers-reduced-motion:
 * reduce` OS preference before navigation, so the app's own media-query
 * detection sees it on its very first render.
 */
export async function withPage({ label, device = null, viewport = { width: 1280, height: 800 }, emulateReducedMotion = false }, fn) {
  await startServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
  });
  const checks = new Checks(label);
  const errors = [];
  try {
    const page = await browser.newPage();
    if (device) await page.emulate(device);
    else await page.setViewport(viewport);
    if (emulateReducedMotion) {
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    }
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (IGNORED_ERRORS.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text}`);
    });
    // Arm font interception before navigation: index.html's Google Fonts
    // <link rel="stylesheet"> fires as soon as the browser parses <head>,
    // well before a probe's own `fn` gets a chance to call
    // setRequestInterception itself. Disarmed again below, right before
    // handing off to `fn`, so a probe that wants its own interception (e.g.
    // contact.probe.mjs's fail-closed relay mocking) can install it without
    // fighting a second "request" listener over the same requests.
    await page.setRequestInterception(true);
    const offlineFonts = (req) => {
      if (isFontHost(req.url())) return respondInertFont(req);
      return req.continue();
    };
    page.on("request", offlineFonts);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    // Headless SwiftShader is software-rendered and slow enough that the app's
    // real PerformanceMonitor.onDecline always fires, permanently unmounting
    // perf-gated scene objects (WarpTunnel, ShootingStars, ...) via isLowPerf.
    // Lock it off with manual=true (the app's onDecline checks lowPerfManual
    // before calling setLowPerf) so probes see the full-fidelity scene graph
    // deterministically. Probes that want to test perf-degradation behavior
    // can still call setLowPerf(true) themselves — only the automatic decline
    // path is blocked.
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(false, true));
    await settle(page, 4000); // let GLBs load and the first frames run
    page.off("request", offlineFonts);
    await page.setRequestInterception(false);
    await fn(page, checks);
  } finally {
    await browser.close();
    checks.check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  }
  return checks;
}

/** Holds one or more key codes down for `ms`, then releases them. */
export async function hold(page, codes, ms) {
  for (const c of codes) await page.keyboard.down(c);
  await settle(page, ms);
  for (const c of codes) await page.keyboard.up(c);
}

/** Taps a touch target by data-testid. Requires a touch-emulated page. */
export async function tap(page, testId, ms = 400) {
  const el = await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 5000 });
  const box = await el.boundingBox();
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page, ms);
  await page.touchscreen.touchEnd();
}

// WARNING (found in Task 8, touch.probe.mjs): a single long blind `settle()`
// under-services requestAnimationFrame in headless SwiftShader Chrome — it is
// pure Node-side setTimeout with zero CDP traffic, and this browser barely
// pumps its own rAF loop while idle between protocol commands. Meanwhile
// Spaceship.tsx:159 clamps `dt = Math.min(delta, 0.05)`, so simulated physics
// time falls behind wall-clock. A `settle(page, 1200)` does NOT reliably
// deliver 1200ms of simulated ship motion. If you are measuring
// physics-over-time (position, velocity, pitch, rotation deltas) rather than
// just waiting for something to settle, interleave `page.evaluate()` reads
// instead of one long wait — each round-trip is a CDP command that reliably
// pumps the browser's task queue and ticks frames forward. See
// touch.probe.mjs's DIVE hold for the pattern. (Considered hardening this
// into a `settleFrames()` helper that waits on real rAF ticks — deferred:
// every current physics-over-time window (sky's turn hold, gameplay's ram +
// cooldown grind, perf's 5s steady-flight hold) already has a carefully
// measured, working threshold tied to this exact wall-clock behavior;
// swapping the underlying wait mechanism would risk churning those thresholds
// for a currently-nonexistent problem. touch.probe.mjs's local interleaving
// remains the only place this trap has actually bitten.)
export function settle(page, ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retries `fn` up to `attempts` times, tolerating a transient page.evaluate()
 * failure (e.g. "Attempted to use detached Frame ..." from an HMR reload or
 * navigation racing the read) between tries instead of letting the exception
 * propagate all the way to run.mjs's top-level catch — which replaces every
 * check the probe has already recorded with a single opaque "probe crashed"
 * failure, hiding its siblings. Returns `{ ok, value, error }`; if every
 * attempt fails, `ok` is false so the caller can report a clean failed check
 * rather than pass silently or crash.
 */
export async function retryEval(fn, { attempts = 3, delayMs = 500 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { ok: false, value: null, error: lastError };
}

/**
 * Polls `fn` every `intervalMs` from the harness side until it returns a
 * truthy value or `timeoutMs` elapses, tolerating up to `maxConsecutiveErrors`
 * evaluate failures in a row (see retryEval) before giving up. Prefer this
 * over a single long in-page `await` loop passed to page.evaluate(): a
 * multi-second loop running entirely inside the page can't be interrupted or
 * retried if the frame it's executing in goes away partway through, whereas
 * harness-side polling can just try again against a fresh evaluate call.
 * Returns `{ ok, value, error }`; `ok: false` with no error means `fn` never
 * returned truthy before the deadline — a genuine, reportable failure, not a
 * crash.
 */
export async function pollUntil(fn, { timeoutMs, intervalMs = 500, maxConsecutiveErrors = 5 }) {
  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      consecutiveErrors = 0;
      if (value) return { ok: true, value };
    } catch (e) {
      lastError = e;
      consecutiveErrors++;
      if (consecutiveErrors >= maxConsecutiveErrors) return { ok: false, value: null, error: lastError };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, value: null, error: lastError };
}

export function readStore(page) {
  return page.evaluate(() => window.__fitz.store.getState());
}

/**
 * Reads the RadioChatter HUD line. Most lines (zone/ambient/warp/wrap/comet/
 * altitude/impact) are typed straight into this DOM node by RadioChatter.tsx's
 * `typeLine` and never touch `store.broadcast`; shard pickups
 * (DataShards.tsx), scan reports (Scanner.tsx), the dry-tank warning
 * (HUDOverlay.tsx) and crystal pickups (FuelCrystals.tsx) go through
 * `sendBroadcast`, which RadioChatter subscribes to and also renders here.
 *
 * So this DOM node — not `store.broadcast` — is the only place that sees every
 * line, which is why assertions read it rather than the store.
 *
 * `text-primary/60` is a className unique to this node in the whole component
 * tree (verified via grep), so a substring match is a safe, stable selector.
 */
export const chatterText = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll("div")].find((d) => d.className?.includes?.("text-primary/60"));
  return el ? el.textContent ?? "" : null;
});

/** Returns {found, count, position, rotation, visible} for a named scene object. */
export function sceneQuery(page, name) {
  return page.evaluate((n) => {
    const hits = [];
    window.__fitz.scene.traverse((o) => { if (o.name === n) hits.push(o); });
    if (!hits.length) return { found: false, matches: 0 };
    const o = hits[0];
    return {
      found: true,
      matches: hits.length,
      count: o.count ?? null,
      visible: o.visible,
      position: { x: o.position.x, y: o.position.y, z: o.position.z },
      rotation: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
    };
  }, name);
}

/** Puts the ship in deep space away from every planet, portal, and comet. */
export async function toDeepSpace(page) {
  const ok = await page.evaluate(() => {
    if (typeof window.__fitz.teleport !== "function") return false;
    window.__fitz.teleport(-230, -210, -230);
    return true;
  });
  if (!ok) throw new Error("__fitz.teleport unavailable — Spaceship did not register it");
  await settle(page, 1500);
}
