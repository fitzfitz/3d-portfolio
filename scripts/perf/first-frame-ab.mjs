// First-frame A/B between two production builds over a shared-bandwidth link
// (shared-link-server.mjs), the measurement behind the asset packs (spec
// docs/superpowers/specs/2026-10-19-asset-packs-design.md, "Measurement
// conditions"). Chrome's DevTools throttling limits each request on its own,
// which flatters many parallel files, so it is not used.
//
//   node scripts/perf/first-frame-ab.mjs <dirA> <dirB> [runs=5]
//
// Each run: a fresh browser context (no service worker, no Cache Storage),
// HTTP cache disabled, viewport 1512x802, timed from navigation start until
// the spawn banner "SPACE FLIGHT CV" shows (sceneReady: every model and
// texture in and warmed). Runs alternate A, B, A, B. Prints every run and the
// medians at 2 MB/s (40 ms per response) and 6 MB/s (25 ms).
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const [dirA, dirB, runsArg] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error("usage: node scripts/perf/first-frame-ab.mjs <dirA> <dirB> [runs=5]");
  process.exit(2);
}
const RUNS = Number(runsArg ?? 5);
const CHROME = process.env.CHROME_PATH
  ?? "/Users/fitzgeral/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SERVER = join(dirname(fileURLToPath(import.meta.url)), "shared-link-server.mjs");
const SPEEDS = [
  { label: "2 MB/s", rate: 2_000_000, latency: 40 },
  { label: "6 MB/s", rate: 6_000_000, latency: 25 },
];

/** Starts one shared-link server and resolves once it listens. */
function serve(dir, port, rate, latency) {
  const child = spawn(process.execPath, [SERVER, resolve(dir), String(port), String(rate), String(latency)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((ok, fail) => {
    child.stdout.on("data", (d) => { if (String(d).includes("serving")) ok(child); });
    child.on("exit", (code) => fail(new Error(`server for ${dir} exited (${code})`)));
  });
}

async function firstFrame(browser, url) {
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    await page.setViewport({ width: 1512, height: 802 });
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => document.body?.innerText.includes("SPACE FLIGHT CV"), { polling: 50, timeout: 120_000 });
    return (Date.now() - t0) / 1000;
  } finally {
    await ctx.close();
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const servers = [];
try {
  for (const s of SPEEDS) {
    const a = await serve(dirA, 4471, s.rate, s.latency);
    const b = await serve(dirB, 4472, s.rate, s.latency);
    servers.push(a, b);
    const times = { A: [], B: [] };
    for (let i = 0; i < RUNS; i++) {
      times.A.push(await firstFrame(browser, "http://localhost:4471/"));
      times.B.push(await firstFrame(browser, "http://localhost:4472/"));
      console.log(`${s.label} run ${i + 1}: A ${times.A.at(-1).toFixed(2)} s  B ${times.B.at(-1).toFixed(2)} s`);
    }
    const mA = median(times.A);
    const mB = median(times.B);
    console.log(`${s.label} median: A ${mA.toFixed(2)} s  B ${mB.toFixed(2)} s  A-B ${(mA - mB >= 0 ? "+" : "")}${(mA - mB).toFixed(2)} s`);
    for (const c of [a, b]) c.kill("SIGTERM");
    servers.length = 0;
  }
} finally {
  // Stop only the servers this script spawned, by their own handles.
  for (const c of servers) c.kill("SIGTERM");
  await browser.close();
}
