// Shared e2e harness: spawns its own Vite server, drives headless Chrome,
// captures page errors as failures, and collects structured check results.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { DEEP_SPACE_POINT } from "./deepSpacePoint.mjs";

const CHROME = process.env.CHROME_PATH
  ?? "/Users/fitzgeral/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5199;

/**
 * Which WebGL backend withPage launches Chrome with. "swiftshader" (the CPU
 * rasterizer) is what every ceiling in docs/PERF-BUDGETS.md was measured on;
 * "gpu" is headless Chrome's default ANGLE/Metal path on this Mac, ~4x faster
 * to scene-ready and ~60 fps instead of ~1, and the default. A probe pins its own;
 * otherwise E2E_BACKEND picks.
 */
export const DEFAULT_BACKEND = process.env.E2E_BACKEND ?? "gpu";
const BACKEND_ARGS = {
  swiftshader: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
  gpu: [],
};
/** Chrome flags for a backend, for the one probe that launches its own browser (basepath). */
export const chromeArgs = (backend = DEFAULT_BACKEND) => BACKEND_ARGS[backend];
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * How long to wait, after ANY navigation or reload, for the canvas to mount
 * and for `window.__fitz.scene` to be published. Both exist because of Task
 * 7's `<Preload all />` move (739a523) into the Suspense boundary —
 * deliberate, and it stays: outside the boundary Preload was compiling a
 * near-empty scene, so materials for the real scene compiled lazily
 * mid-flight instead (measured before the move: +6 shader programs
 * approaching a planet). Inside the boundary, Preload's `gl.compile()` walks
 * the fully-resolved scene graph and eagerly warms every shader at load —
 * trading a longer startup for a hitch-free flight. That is the whole point
 * of the change; do not revert the placement to make these numbers smaller.
 *
 * The cost of that trade: `gl.compile()` runs synchronously on the main
 * thread during commit, before `DebugBridge`'s passive `useEffect` gets a
 * turn to run and publish `window.__fitz.scene`. Under headless SwiftShader
 * (software rasterizer, ~876k triangles in this scene, p50 frame time ~1s)
 * that compile blocks long enough to blow through a 20s wait outright —
 * measured at 28,358ms to `window.__fitz.scene` becoming available, versus
 * 120ms for the canvas selector alone. A real GPU compiles this in a small
 * fraction of that time; these ceilings exist for the software-rendered
 * CI/test path, not because startup is actually this slow for a user.
 *
 * Every wait for `canvas` or `window.__fitz.scene` anywhere in this suite —
 * `withPage`'s own initial navigation, or a probe's own `page.reload()` —
 * pays this same cost and MUST use these constants rather than a bare
 * timeout literal (audio.probe.mjs and gameplay.probe.mjs each reload
 * mid-probe and re-wait; basepath.probe.mjs can't use `withPage` at all and
 * waits on its own puppeteer session — all still pay full eager compile).
 * Do not lower these without re-measuring on headless SwiftShader first:
 * that reintroduces the exact class of intermittent 20s-timeout crashes
 * (reducedmotion, audio, perf, assets, fuel, flight, gameplay, ...) these
 * constants exist to prevent.
 */
export const CANVAS_READY_TIMEOUT_MS = 30_000;
export const SCENE_READY_TIMEOUT_MS = 60_000;

/**
 * Ceiling for how long the wait for `window.__fitz.scene` (the eager Preload
 * compile described above) is allowed to actually take, as opposed to how
 * long it's allowed before the suite gives up entirely
 * (`SCENE_READY_TIMEOUT_MS`). Asserted by startup.probe.mjs on the best of up
 * to three SwiftShader loads; withPage only records each page's figure.
 *
 * Measured baseline: 10.6-11.8s to sceneReady (2026-10-10, after the async
 * ShaderWarmup replaced Preload). The original 28,358ms figure was captured
 * under heavy machine load; see docs/PERF-BUDGETS.md for the re-baselines.
 * `SCENE_READY_TIMEOUT_MS` is set to 60s specifically so a slow-but-not-
 * broken compile never crashes the suite — but that leaves 2.1x of slack in
 * which a change that doubled compile time (56.7s) would still pass
 * silently, with no signal anything regressed. 20s sits ~1.7x above the
 * slowest observed run (so ordinary machine-load noise still passes) but
 * below 2x, so a doubling reliably fails this check red instead of merely
 * being slow. See docs/PERF-BUDGETS.md for the full derivation.
 */
export const STARTUP_DURATION_CEILING_MS = 20_000;

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

/**
 * Per-page phase timings (wall ms), one record per `withPage` call, read by
 * run.mjs for its timing report. `current` is the page being driven, so
 * `settle()` can charge its blind waits to it.
 */
export const timings = [];
let current = null;

let server = null;

/**
 * run.mjs starts one Vite server for the whole suite and runs each probe in
 * its own child process with E2E_SERVER_UP=1, so children share it instead
 * of each spawning (and later killing) their own on the same port.
 */
const SHARED_SERVER = process.env.E2E_SERVER_UP === "1";

export async function startServer() {
  if (server || SHARED_SERVER) return;
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
 * `expectedErrors` is a probe's own list of console-error patterns it causes
 * on purpose, e.g. the 429 a mocked API returns to test rate limiting: Chrome
 * logs every 4xx response as a console error, and no app code can stop it.
 * Scoped to the one probe so it can never hide the same error elsewhere.
 *
 * `emulateReducedMotion`, if true, emulates the `prefers-reduced-motion:
 * reduce` OS preference before navigation, so the app's own media-query
 * detection sees it on its very first render.
 */
export async function withPage({ label, backend = DEFAULT_BACKEND, device = null, viewport = { width: 1280, height: 800 }, emulateReducedMotion = false, expectedErrors = [], initScript = null }, fn) {
  await startServer();
  if (!BACKEND_ARGS[backend]) throw new Error(`unknown e2e backend "${backend}"`);
  const t = { label, backend, settleMs: 0 };
  let mark = Date.now();
  const lap = (phase) => { const now = Date.now(); t[phase] = now - mark; mark = now; };
  timings.push(t);
  current = t;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: BACKEND_ARGS[backend],
  });
  lap("launch");
  const checks = new Checks(label);
  const errors = [];
  try {
    const page = await browser.newPage();
    if (device) await page.emulate(device);
    else await page.setViewport(viewport);
    if (emulateReducedMotion) {
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    }
    // Pin the orrery date first so a probe initScript can override it.
    await page.evaluateOnNewDocument("window.__FITZ_ORRERY_JD__ = 2461333.5");
    if (initScript) await page.evaluateOnNewDocument(initScript);
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if ([...IGNORED_ERRORS, ...expectedErrors].some((re) => re.test(text))) return;
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
    lap("goto");
    // A GPU run that silently fell back to SwiftShader would pass every check
    // at the wrong speed, so the renderer string is asserted, not assumed.
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
    });
    if (/swiftshader/i.test(renderer) !== (backend === "swiftshader")) {
      throw new Error(`asked for the ${backend} backend but Chrome rendered with "${renderer}"`);
    }
    // Lock low-perf off as early as possible: `window.__fitz` exists from
    // main.tsx's module evaluation, before React renders and so before the
    // (lazily loaded) Canvas and its PerformanceMonitor can mount. Locking it
    // only after scene-ready (below) raced the monitor's decline under
    // SwiftShader: whether low-perf had flipped on and back first decided
    // whether the low tier's tone-mapped shader variants were in the program
    // count, which made the transition probe's program budgets flaky (82 vs
    // 105 on consecutive runs).
    await page.waitForFunction(() => !!window.__fitz?.store, { timeout: CANVAS_READY_TIMEOUT_MS });
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(false, true));
    lap("store");
    // See CANVAS_READY_TIMEOUT_MS / SCENE_READY_TIMEOUT_MS above for why
    // these are this large — eager Preload compile, not a slow app.
    await page.waitForSelector("canvas", { timeout: CANVAS_READY_TIMEOUT_MS });
    lap("canvas");
    const sceneReadyStart = Date.now();
    // "Ready" is the store's sceneReady, set by ShaderWarmup once shaders are
    // linked and textures uploaded — not window.__fitz.scene, which DebugBridge
    // sets at commit, before the (now asynchronous) warm-up even starts.
    // Timing the commit would drop compile from the startup budget entirely.
    await page.waitForFunction(() => !!window.__fitz?.scene && window.__fitz.store.getState().sceneReady,
      { timeout: SCENE_READY_TIMEOUT_MS });
    const sceneReadyMs = Date.now() - sceneReadyStart;
    lap("compile");
    // Recorded, not asserted: a busy machine can slow any one page, and
    // startup.probe.mjs asserts the ceiling on the best of three loads alone.
    t.sceneReadyMs = sceneReadyMs;
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
    lap("warm");
    t.settleMs = 0; // count only the probe body's blind waits below
    await fn(page, checks);
    lap("body");
  } finally {
    // A throw in set-up (renderer guard, a ready timeout) is not body time.
    if (!("body" in t)) lap("warm" in t ? "body" : "failed");
    await browser.close();
    lap("close");
    current = null;
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
/**
 * Waits for `n` real animation frames in the page. Use it where a probe needs
 * the scene or a rAF-driven canvas (the radar) to have redrawn since its last
 * action: CDP round trips are not frames, and since teleport mirrors `flight`
 * at once, polling flight no longer implies a frame has run either.
 */
export function nextFrames(page, n = 3) {
  return page.evaluate((k) => new Promise((resolve) => {
    const tick = () => (--k > 0 ? requestAnimationFrame(tick) : resolve());
    requestAnimationFrame(tick);
  }), n);
}

export function settle(page, ms) {
  if (current) current.settleMs += ms;
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
 * Selected by `data-testid="radio-chatter"`. It used to match the
 * `text-primary/60` className, which silently broke when the line's styling
 * changed — a test id survives restyling.
 */
export const chatterText = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="radio-chatter"]');
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
  const ok = await page.evaluate(([x, y, z]) => {
    if (typeof window.__fitz.teleport !== "function") return false;
    window.__fitz.teleport(x, y, z); // deepSpacePoint.mjs: clear of every orbit, comet and landmark, inside the haze
    return true;
  }, DEEP_SPACE_POINT);
  if (!ok) throw new Error("__fitz.teleport unavailable — Spaceship did not register it");
  await settle(page, 1500);
}

/**
 * Page-side script for page.evaluateOnNewDocument (register it BEFORE any
 * reload/navigation): pins full fidelity (low-perf off, manual) as soon as the
 * store exists, as on a real GPU. A reload rebuilds the store with lowPerfManual
 * false, so without this PerformanceMonitor.onDecline can switch tier mid-run
 * under load and every material recompiles (srgb vs srgb-linear).
 */
export function lockFullFidelity() {
  const lock = setInterval(() => {
    const store = window.__fitz?.store;
    if (store) { store.getState().setLowPerf(false, true); clearInterval(lock); }
  }, 5);
}

/**
 * Installs an in-page recorder for the edge tests so nothing depends on poll
 * timing: every animation frame it tracks the radius, the first crossing past
 * `edge` and the first return inside it (performance.now ms), the maximum
 * radius with the haze overlay opacity read in that same frame, and whether any
 * broadcast ever contained "RETURN BURN" (store subscription, so a later
 * broadcast replacing it cannot hide it). Read it back with readEdgeRecorder.
 */
// Default edge is SYSTEM_RADIUS (src/constants.ts); a .mjs cannot import TS, so the literal.
export function installEdgeRecorder(page, edge = 3600) {
  return page.evaluate((E) => {
    const rec = {
      maxR: 0, opAtMax: 0, tCross: null, tBack: null,
      burn: false, burnSilent: null,
      // Haze line (chatterLines.ts `haze` pool, matched by fragment): the haze
      // opacity / 0.92 is the edge depth, read in the frame it was broadcast.
      haze: false, hazeSilent: null, hazeDepth: null,
      // Warp re-engagements after the edge cut took hold (the I1 latch must keep this 0).
      cutSeen: false, rewarp: 0,
      // Simulated seconds from the crossing to the return: each frame adds its
      // wall dt clamped to 0.05 s, as Spaceship's frame loop does, so the
      // figure means the same on SwiftShader (~1 fps) and on the GPU.
      simBack: 0, tPrev: null,
      stop: false,
    };
    window.__edgeRec = rec;
    const HAZE_RE = /NEBULA DENSITY RISING|HERE BE MORE OF THIS|VISIBILITY ZERO|EDGE HAZE/;
    const opacity = () => Number(document.querySelector('[data-testid="edge-haze"]')?.style.opacity ?? "0");
    window.__edgeRecUnsub = window.__fitz.store.subscribe((s) => {
      const b = s.broadcast;
      if (!b?.text) return;
      if (b.text.includes("RETURN BURN")) { rec.burn = true; rec.burnSilent = b.silent; }
      else if (HAZE_RE.test(b.text) && !rec.haze) { rec.haze = true; rec.hazeSilent = b.silent; rec.hazeDepth = opacity() / 0.92; }
    });
    const step = () => {
      const f = window.__fitz.flight;
      const r = Math.hypot(f.x, f.y, f.z);
      const now = performance.now();
      const dt = rec.tPrev === null ? 0 : Math.min((now - rec.tPrev) / 1000, 0.05);
      rec.tPrev = now;
      if (rec.tCross !== null && rec.tBack === null) rec.simBack += dt;
      if (r > rec.maxR) {
        rec.maxR = r;
        rec.opAtMax = opacity();
      }
      if (r > E && rec.tCross === null) rec.tCross = now;
      if (rec.tCross !== null && rec.tBack === null && r < E) rec.tBack = now;
      if (rec.tCross !== null) {
        const warping = window.__fitz.store.getState().isWarping;
        if (!warping) rec.cutSeen = true;
        else if (rec.cutSeen) rec.rewarp++;
      }
      if (!rec.stop) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, edge);
}

/** Stops the recorder's frame loop and drops its store subscription. */
export function stopEdgeRecorder(page) {
  return page.evaluate(() => {
    if (window.__edgeRec) window.__edgeRec.stop = true;
    window.__edgeRecUnsub?.();
    window.__edgeRecUnsub = null;
  });
}

export const readEdgeRecorder = (page) => page.evaluate(() => ({ ...window.__edgeRec }));

/**
 * Probe standoff from a planet's centre, x its size: well clear of the solid
 * surface (size + the ship's half length), inside scan range of it. Planets no
 * longer lock (project probes); fixed offsets once sat inside the old lock.
 */
export const PLANET_STANDOFF = 2.5;

/**
 * Project probes (src/data/probes.ts). The dossiers live on three probes:
 * a jump (keys 1-3, the d-pad, a HUD row) parks the ship PROBE_JUMP_STANDOFF
 * (12 u) from one, facing it, and opens nothing; holding the beam pulls the
 * probe in and opens its dossier at PROBE_OPEN_DIST.
 */
const PROBE_JUMP_STANDOFF = 12;

/** True while probe `id` plays its relocation burn (src/store/probeState.ts, the app's own module instance). */
export const probeRelocating = (page, id) => page.evaluate(async (i) => {
  const { probeRelocating: r } = await import("/src/store/probeState.ts");
  return r[i] === true;
}, id);

/**
 * Jumps to probe `id` and waits until the ship has landed 12 u from it.
 * `jump` is how the jump is asked for (a key press, a pad button); the
 * default is the store's `requestJump`, as the HUD rows do. A relocating
 * probe is waited out first: it cannot be grabbed and it is moving.
 * Returns pollUntil's `{ ok, value }`, value the landed distance.
 */
export async function jumpToProbe(page, id, { jump = null, timeoutMs = 15_000 } = {}) {
  await pollUntil(async () => !(await probeRelocating(page, id)), { timeoutMs: 15_000, intervalMs: 100 });
  if (jump) await jump();
  else await page.evaluate((i) => window.__fitz.store.getState().requestJump(i), id);
  return pollUntil(() => page.evaluate(([i, standoff]) => {
    const p = window.__fitz.probes?.[i], f = window.__fitz.flight;
    if (!p) return null;
    const d = Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z);
    return Math.abs(d - standoff) < 0.75 ? d : null;
  }, [id, PROBE_JUMP_STANDOFF]), { timeoutMs, intervalMs: 100 });
}

/**
 * Holds F until probe `id`'s dossier opens (`openDossier === id`), then lets
 * go. Each poll is a CDP round trip, which pumps frames (see settle()).
 */
export async function holdBeamUntilOpen(page, id, { timeoutMs = 8000 } = {}) {
  await page.keyboard.down("KeyF");
  try {
    return await pollUntil(() => page.evaluate((i) => window.__fitz.store.getState().openDossier === i, id),
      { timeoutMs, intervalMs: 100 });
  } finally {
    await page.keyboard.up("KeyF");
  }
}

/**
 * The way a visitor opens a project: jump to its probe, then hold F until the
 * dossier opens (timeout 8 s by default). Returns `{ ok, landed, error }`:
 * `landed` false means the jump itself never arrived.
 */
export async function grabProbe(page, id, { jump = null, timeoutMs = 8000 } = {}) {
  const landed = await jumpToProbe(page, id, { jump });
  if (!landed.ok) return { ok: false, landed: false, error: landed.error };
  const opened = await holdBeamUntilOpen(page, id, { timeoutMs });
  return { ok: opened.ok, landed: true, error: opened.error };
}
