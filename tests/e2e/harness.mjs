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
 */
export async function withPage({ label, device = null, viewport = { width: 1280, height: 800 } }, fn) {
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
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (IGNORED_ERRORS.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text}`);
    });
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

export function settle(page, ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function readStore(page) {
  return page.evaluate(() => window.__fitz.store.getState());
}

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
