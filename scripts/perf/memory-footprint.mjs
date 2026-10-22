// Real-GPU memory of one or two production builds: what Activity Monitor
// shows per Chrome process, next to the GPU ledger's byte count
// (tests/e2e/gpuLedger.mjs). The measurement behind the memory budget
// (docs/superpowers/specs/2026-10-22-memory-budget-design.md).
//
//   npm run build && cp -R dist /tmp/a    # one build per directory
//   node scripts/perf/memory-footprint.mjs <dirA> [dirB] [--runs 3] [--sizes 1512x802,760x377] [--out dir]
//
// Each run launches its own HEADED Chrome on the real GPU (not SwiftShader:
// its memory lives elsewhere and behaves differently) with a fresh profile,
// samples the idle browser on about:blank, then loads the game at the given
// viewport (device scale 2, a Retina laptop), waits for the spawn banner and
// flies a fixed route: idle, the number-key jumps 1-6 (three probes, career,
// shipyard, contact; Escape after each), the logbook open and shut, idle.
// Every 2 s it reads `footprint` for each of that Chrome's processes. Runs
// alternate A, B, A, B per size; the first run of each also saves screenshots
// after every jump, the same views in A and B (the orrery date is pinned).
//
// Chrome windows open on screen while it runs and may take focus. Each run
// closes only the browser it launched.
import puppeteer from "puppeteer-core";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { installGpuLedger, readGpuLedger } from "../../tests/e2e/gpuLedger.mjs";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv.splice(i, 2)[1] : fallback;
};
const RUNS = Number(opt("runs", 3));
const SIZES = opt("sizes", "1512x802,760x377").split(",").map((s) => s.split("x").map(Number));
const OUT = resolve(opt("out", mkdtempSync(join(tmpdir(), "fitz-memory-"))));
const DIRS = argv.filter((a) => !a.startsWith("--"));
if (!DIRS.length || DIRS.length > 2 || !Number.isInteger(RUNS) || RUNS < 1) {
  console.error("usage: node scripts/perf/memory-footprint.mjs <dirA> [dirB] [--runs 3] [--sizes 1512x802,760x377] [--out dir]");
  process.exit(2);
}
const CHROME = process.env.CHROME_PATH
  ?? "/Users/fitzgeral/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SERVER = join(dirname(fileURLToPath(import.meta.url)), "shared-link-server.mjs");
/** Same date as the e2e harness, so the planets stand in the same places every run. */
const ORRERY_JD = 2461333.5;
const SAMPLE_MS = 2000;
const MB = (b) => b / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** A local static server for one build, with no bandwidth limit to speak of. */
function serve(dir, port) {
  const child = spawn(process.execPath, [SERVER, resolve(dir), String(port), "1000000000", "0"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((ok, fail) => {
    child.stdout.on("data", (d) => { if (String(d).includes("serving")) ok(child); });
    child.on("exit", (code) => fail(new Error(`server for ${dir} exited (${code})`)));
  });
}

/** Footprint of every process of this browser, summed by Chrome's process type. */
async function sample(cdp, jsonPath) {
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const types = new Map(processInfo.map((p) => [p.id, p.type]));
  const args = ["--noCategories", "-f", "bytes", "-j", jsonPath];
  for (const p of processInfo) args.push("-p", String(p.id));
  await run("footprint", args, { maxBuffer: 1 << 24 });
  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  const byType = {};
  let total = 0;
  for (const p of json.processes ?? []) {
    // A process that exits between the two calls comes back without a footprint.
    if (!Number.isFinite(p.footprint)) continue;
    const type = String(types.get(p.pid) ?? "other").toLowerCase();
    byType[type] = (byType[type] ?? 0) + p.footprint;
    total += p.footprint;
  }
  return { total, byType };
}

async function measure(label, url, [width, height], runIndex) {
  const profile = mkdtempSync(join(tmpdir(), "fitz-memory-profile-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: profile,
    defaultViewport: { width, height, deviceScaleFactor: 2 },
    args: [
      `--window-size=${width},${height + 100}`,
      // A covered or background window stops drawing, which would measure an idle game.
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const samples = [];
  const fpJson = join(profile, "footprint.json");
  try {
    const cdp = await browser.target().createCDPSession();
    const [page] = await browser.pages();
    let phase = "chrome-idle";
    await sleep(5000);
    for (let i = 0; i < 3; i++) { samples.push({ phase, ...(await sample(cdp, fpJson)) }); await sleep(1000); }

    let stop = false;
    const loop = (async () => {
      while (!stop) {
        const t0 = Date.now();
        try { samples.push({ phase, ...(await sample(cdp, fpJson)) }); } catch (e) { console.warn(`sample failed: ${e.message}`); }
        await sleep(Math.max(0, SAMPLE_MS - (Date.now() - t0)));
      }
    })();

    await page.evaluateOnNewDocument(`window.__FITZ_ORRERY_JD__ = ${ORRERY_JD}`);
    await page.evaluateOnNewDocument(installGpuLedger);
    phase = "load";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
    });
    if (/swiftshader/i.test(renderer)) throw new Error(`Chrome fell back to SwiftShader ("${renderer}"); this measures the real GPU only`);
    await page.waitForFunction(() => document.body?.innerText.includes("SPACE FLIGHT CV"), { polling: 100, timeout: 120_000 });

    phase = "idle";
    await sleep(20_000);
    phase = "route";
    const shots = runIndex === 0 ? join(OUT, "shots", `${label}-${width}x${height}`) : null;
    if (shots) mkdirSync(shots, { recursive: true });
    for (let k = 1; k <= 6; k++) {
      await page.keyboard.press(`Digit${k}`);
      await sleep(6000);
      if (shots) await page.screenshot({ path: join(shots, `jump-${k}.png`) });
      await page.keyboard.press("Escape");
      await sleep(1000);
    }
    await page.keyboard.press("KeyL");
    await sleep(2000);
    await page.keyboard.press("KeyL");
    phase = "steady";
    await sleep(20_000);
    stop = true;
    await loop;

    const ledger = await readGpuLedger(page, 40);
    const { JSHeapUsedSize } = await page.metrics();
    return { label, width, height, renderer, samples, ledger, jsHeap: JSHeapUsedSize };
  } finally {
    await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

/** One run's headline numbers, in MB. */
function summarise(r) {
  const of = (phase) => r.samples.filter((s) => s.phase === phase);
  const idle = of("chrome-idle"), steady = of("steady");
  const pick = (list, key) => median(list.map((s) => (key ? s.byType[key] ?? 0 : s.total)));
  const chromeIdle = pick(idle);
  const steadyTotal = pick(steady);
  return {
    chromeIdle: MB(chromeIdle),
    steadyTotal: MB(steadyTotal),
    peakTotal: MB(Math.max(...r.samples.map((s) => s.total))),
    gameShare: MB(steadyTotal - chromeIdle),
    gpu: MB(pick(steady, "gpu")),
    renderer: MB(pick(steady, "renderer")),
    browser: MB(pick(steady, "browser")),
    jsHeap: MB(r.jsHeap),
    ledger: r.ledger.mb.total,
    canvasPx: Math.max(0, ...r.ledger.canvases.map((c) => c.w * c.h)),
  };
}

const ports = [4481, 4482];
const servers = [];
const results = [];
try {
  for (let i = 0; i < DIRS.length; i++) servers.push(await serve(DIRS[i], ports[i]));
  const labels = DIRS.length === 2 ? ["A", "B"] : ["A"];
  for (const size of SIZES) {
    for (let k = 0; k < RUNS; k++) {
      for (let i = 0; i < labels.length; i++) {
        const r = await measure(labels[i], `http://localhost:${ports[i]}/`, size, k);
        results.push(r);
        const s = summarise(r);
        console.log(`${labels[i]} ${size.join("x")} run ${k + 1}: total ${s.steadyTotal.toFixed(0)} MB (peak ${s.peakTotal.toFixed(0)}), game share ${s.gameShare.toFixed(0)}, GPU ${s.gpu.toFixed(0)}, renderer ${s.renderer.toFixed(0)}, ledger ${s.ledger.toFixed(0)}`);
      }
    }
  }
} finally {
  // Stop only the servers this script spawned, by their own handles.
  for (const c of servers) c.kill("SIGTERM");
}

const table = [];
for (const label of new Set(results.map((r) => r.label))) {
  for (const [w, h] of SIZES) {
    const runs = results.filter((r) => r.label === label && r.width === w && r.height === h).map(summarise);
    const row = { build: label, size: `${w}x${h}` };
    for (const key of Object.keys(runs[0])) row[key] = Math.round(median(runs.map((s) => s[key])));
    table.push(row);
  }
}
console.log(`\nMedians in MB (${RUNS} run${RUNS > 1 ? "s" : ""} each). gameShare = steady total minus the same Chrome idle on about:blank.`);
console.table(table);

// Two sizes give a line through the GPU process: what scales with the canvas's
// pixels (render targets) and what does not (textures, geometry).
for (const label of new Set(table.map((r) => r.build))) {
  const rows = table.filter((r) => r.build === label).sort((a, b) => a.canvasPx - b.canvasPx);
  if (rows.length < 2) continue;
  const [lo, hi] = [rows[0], rows.at(-1)];
  const perMp = (hi.gpu - lo.gpu) / ((hi.canvasPx - lo.canvasPx) / 1e6);
  console.log(`${label}: GPU process ≈ ${Math.round(lo.gpu - perMp * lo.canvasPx / 1e6)} MB fixed + ${Math.round(perMp)} MB per canvas megapixel`);
}

const file = join(OUT, "memory.json");
writeFileSync(file, JSON.stringify({ dirs: DIRS, sizes: SIZES, runs: RUNS, table, results }, null, 2));
console.log(`\nfull samples, ledgers and screenshots: ${OUT}`);
