import { withPage, settle, SCENE_READY_TIMEOUT_MS } from "./harness.mjs";
import { installGpuLedger, readGpuLedger } from "./gpuLedger.mjs";

// GPU memory budget (docs/PERF-BUDGETS.md, "GPU memory"). The ledger counts
// what WebGL is asked to allocate, so these numbers are the same on any GPU
// and under load: a probe-friendly stand-in for the real footprint, which
// scripts/perf/memory-footprint.mjs measures on the real GPU.
//
// The viewport is the measurement's laptop (1512×802 at device scale 2), so
// the canvas and every screen-sized target are the size users get there.
// Ceilings: the baseline per category + 5%, rounded up to the next 5 MB. A
// new 4K map (45 MB) or a new full-screen half-float target (22 MB) fails
// one; raising a ceiling is a deliberate edit with its reason in the doc.
const VIEWPORT = { width: 1512, height: 802, deviceScaleFactor: 2 };
export const CEILINGS_MB = {
  // Baseline 2026-10-22 (main at afa2573): 490.9 / 181.2 / 98.2 / 775.2.
  full: { textures: 520, renderTargets: 195, drawingBuffer: 105, total: 815 },
  // Pinned before load: no 4K maps, and the disabled composer never sizes its
  // targets. Baseline 389.5 / 24.7 / 98.2 / 517.3.
  low: { textures: 410, renderTargets: 30, drawingBuffer: 105, total: 545 },
};
/**
 * The tour may add vertex buffers (about 1.1 MB at baseline, jump effects and
 * trails) but no texture or render target: those are all made at load.
 */
const TOUR_GROWTH_MB = 2;

export default async function run() {
  const full = await budget({ label: "memory", tier: "full", lowPerf: false });
  const low = await budget({ label: "memory (low-perf)", tier: "low", lowPerf: true });
  full.results.push(...low.results);
  return full;
}

/** Page-side: pins low-perf ON (manual) as soon as the store exists, before the canvas mounts. */
function lockLowPerf() {
  const lock = setInterval(() => {
    const store = window.__fitz?.store;
    if (store) { store.getState().setLowPerf(true, true); clearInterval(lock); }
  }, 5);
}

function budget({ label, tier, lowPerf }) {
  return withPage({ label, viewport: VIEWPORT, initScript: installGpuLedger }, async (page, checks) => {
    if (lowPerf) {
      // A reload rebuilds the store, so the lock has to be in place before it.
      await page.evaluateOnNewDocument(lockLowPerf);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
    await settle(page, 3000);
    const isLow = await page.evaluate(() => window.__fitz.store.getState().isLowPerf);
    checks.check(`[${tier}] tier is pinned (precondition)`, isLow === lowPerf, `isLowPerf=${isLow}`);

    const atSpawn = await readGpuLedger(page, 8);
    const canvas = atSpawn.canvases.reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a), { w: 0, h: 0 });
    checks.check(`[${tier}] canvas is the laptop's 1.5× buffer, 2268×1203 (precondition)`,
      canvas.w === 2268 && canvas.h === 1203, `canvas=${canvas.w}×${canvas.h}`);

    const ceilings = CEILINGS_MB[tier];
    for (const [key, ceiling] of Object.entries(ceilings)) {
      const mb = atSpawn.mb[key];
      checks.check(`[${tier}] ${key} ≤ ${ceiling} MB`, mb <= ceiling, `${mb} MB`);
    }

    // Every jump target in order (probes, then destinations), Escape after
    // each so a docking modal closes: the tour must allocate nothing new.
    const ids = await page.evaluate(async () => {
      const { JUMP_TARGETS } = await import("/src/data/destinations.ts");
      return JUMP_TARGETS.map((t) => t.id);
    });
    for (const id of ids) {
      await page.evaluate((i) => window.__fitz.store.getState().requestJump(i), id);
      await settle(page, 2500);
      await page.keyboard.press("Escape");
      await settle(page, 500);
    }
    const afterTour = await readGpuLedger(page, 8);
    const growth = Math.round((afterTour.mb.total - atSpawn.mb.total) * 100) / 100;
    checks.check(`[${tier}] the tour allocates ≤ ${TOUR_GROWTH_MB} MB more`, growth <= TOUR_GROWTH_MB,
      `spawn ${atSpawn.mb.total} MB, after ${afterTour.mb.total} MB (${growth >= 0 ? "+" : ""}${growth})`);
    const imageGrowth = (afterTour.bytes.textures + afterTour.bytes.renderTargets) - (atSpawn.bytes.textures + atSpawn.bytes.renderTargets);
    checks.check(`[${tier}] the tour allocates no texture or render target`, imageGrowth === 0,
      `${imageGrowth} bytes`);

    // The breakdown, for the log: what to look at when a ceiling fails.
    console.log(`  [${tier}] ledger ${JSON.stringify(afterTour.mb)}`);
    for (const g of afterTour.groups) {
      console.log(`    ${g.count} × ${g.w}×${g.h} ${g.fmt}${g.samples > 1 ? ` ×${g.samples}` : ""} ${g.rt ? "target" : "texture"}: ${g.mb} MB`);
    }
  });
}
