import { withPage, settle, SCENE_READY_TIMEOUT_MS } from "./harness.mjs";
import { installGpuLedger, readGpuLedger } from "./gpuLedger.mjs";

// GPU memory budget (docs/PERF-BUDGETS.md, "GPU memory"). The ledger counts
// what WebGL is asked to allocate, so these numbers are the same on any GPU
// and under load: a probe-friendly stand-in for the real footprint, which
// scripts/perf/memory-footprint.mjs measures on the real GPU.
//
// The viewport is the measurement's laptop (1512×802 at device scale 2), so
// the canvas and every screen-sized target are the size users get there
// (src/utils/pixelBudget.ts).
// Ceilings: the baseline per category + 5%, rounded up to the next 5 MB. A
// new 4K map (45 MB) or a new full-screen half-float target (22 MB) fails
// one; raising a ceiling is a deliberate edit with its reason in the doc.
const VIEWPORT = { width: 1512, height: 802, deviceScaleFactor: 2 };
export const CEILINGS_MB = {
  // Textures / render targets / canvas / total, at this laptop size.
  // main at afa2573: 490.9 / 181.2 / 98.2 / 775.2. PR 47 (no canvas MSAA,
  // SMAA without the depth copy, a 2 MP canvas): 490.9 / 115.3 / 16.0 / 627.1;
  // Earth's 4096 map as KTX2: textures 457.4, total 593.5; every map but the
  // clouds and Saturn's ring as KTX2: textures 252.2, total 388.4.
  full: { textures: 265, renderTargets: 125, drawingBuffer: 20, total: 410 },
  // Pinned before load: no 4K maps, and the disabled composer never sizes its
  // targets. main: 389.5 / 24.7 / 98.2 / 517.3; PR 47: 234.7 / 24.7 / 16.0 / 280.2.
  low: { textures: 250, renderTargets: 30, drawingBuffer: 20, total: 295 },
};
/**
 * JS allocated per frame at idle, sampled by V8's heap profiler including
 * objects already collected (dev build). drei's <Trail> rebuilding its
 * geometry every frame made ~125 KB of it until EngineWake replaced it
 * (2026-10-22: 225 → 99 KB a frame; 118 here, with the ledger's own wrappers).
 * Per frame, so the frame rate barely moves it; the ceiling leaves room for
 * a loaded machine's longer frames and still fails the trails coming back.
 */
const ALLOC_KB_PER_FRAME = 160;
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

/**
 * Scene textures still holding a loaded image (an ImageBitmap or an <img>)
 * after upload: ShaderWarmup releases them all (src/utils/sceneAssets.ts).
 */
const retainedImages = (page) => page.evaluate(() => {
  const seen = new Set();
  let retained = 0;
  window.__fitz.scene.traverse((o) => {
    for (const m of [o.material].flat().filter(Boolean)) {
      for (const v of [...Object.values(m), ...Object.values(m.uniforms ?? {}).map((u) => u?.value)]) {
        if (!v?.isTexture || seen.has(v)) continue;
        seen.add(v);
        if (v.image instanceof ImageBitmap || v.image instanceof HTMLImageElement) retained++;
      }
    }
  });
  return { retained, textures: seen.size };
});

/** Waits for the next canvas's warm-up to finish (sceneReady drops on unmount, rises after). */
const sceneReadyAgain = (page) => page.waitForFunction(
  () => window.__fitz?.store?.getState().sceneReady && window.__fitz.gl && !window.__fitz.gl.getContext().isContextLost(),
  { timeout: SCENE_READY_TIMEOUT_MS },
);

/**
 * After a new canvas, every texture is on the GPU again: the same bytes as at
 * spawn, which a texture without its image (released, not reloaded) would
 * not reach, because three skips the upload and allocates nothing.
 */
async function checkReloaded(page, checks, tier, what, atSpawn) {
  await sceneReadyAgain(page);
  await settle(page, 2000);
  const after = await readGpuLedger(page, 8);
  checks.check(`[${tier}] after ${what}, every texture is back on the GPU`,
    after.bytes.textures === atSpawn.bytes.textures,
    `spawn ${atSpawn.mb.textures} MB, now ${after.mb.textures} MB`);
  const r = await retainedImages(page);
  checks.check(`[${tier}] after ${what}, no texture keeps its image`, r.retained === 0, `${r.retained} of ${r.textures}`);
}

/**
 * Bytes of JS allocated per animation frame over `ms`, from V8's sampling heap
 * profiler with collected objects included: garbage, not what survives.
 */
async function allocationPerFrame(page, ms) {
  const cdp = await page.createCDPSession();
  await cdp.send("HeapProfiler.enable");
  await page.evaluate(() => { window.__allocFrames = 0; const f = () => { window.__allocFrames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const f0 = await page.evaluate(() => window.__allocFrames);
  await settle(page, ms);
  const { profile } = await cdp.send("HeapProfiler.stopSampling");
  const frames = (await page.evaluate(() => window.__allocFrames)) - f0;
  await cdp.detach();
  let bytes = 0;
  const walk = (n) => { bytes += n.selfSize; for (const c of n.children) walk(c); };
  walk(profile.head);
  return { kb: bytes / Math.max(1, frames) / 1000, frames };
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
    const images = await retainedImages(page);
    checks.check(`[${tier}] no texture keeps its image after upload`, images.retained === 0,
      `${images.retained} of ${images.textures}`);
    // The canvas the pixel budget gives this laptop (three floors w × dpr).
    const expected = await page.evaluate(async ([w, h, d]) => {
      const { budgetDpr } = await import("/src/utils/pixelBudget.ts");
      const dpr = budgetDpr(w, h, d);
      return { w: Math.floor(w * dpr), h: Math.floor(h * dpr) };
    }, [VIEWPORT.width, VIEWPORT.height, VIEWPORT.deviceScaleFactor]);
    const canvas = atSpawn.canvases.reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a), { w: 0, h: 0 });
    checks.check(`[${tier}] canvas is the pixel budget's ${expected.w}×${expected.h} (precondition)`,
      canvas.w === expected.w && canvas.h === expected.h, `canvas=${canvas.w}×${canvas.h}`);

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

    if (!lowPerf) {
      const perFrame = await allocationPerFrame(page, 8000);
      checks.check(`[${tier}] idle allocates ≤ ${ALLOC_KB_PER_FRAME} KB of JS a frame`, perFrame.kb <= ALLOC_KB_PER_FRAME,
        `${perFrame.kb.toFixed(1)} KB a frame over ${perFrame.frames} frames`);

      // The classic résumé round trip mounts a new canvas, which must load
      // the released images again rather than find them gone in the cache.
      await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(true));
      await settle(page, 1500);
      await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(false));
      await checkReloaded(page, checks, tier, "the classic résumé round trip", atSpawn);

      // A lost context that comes back gets a new canvas the same way.
      await page.evaluate(() => {
        const ext = window.__fitz.gl.getContext().getExtension("WEBGL_lose_context");
        ext.loseContext();
        setTimeout(() => ext.restoreContext(), 500);
      });
      await settle(page, 1500);
      await checkReloaded(page, checks, tier, "a lost and restored context", atSpawn);
    }

    // The breakdown, for the log: what to look at when a ceiling fails.
    console.log(`  [${tier}] ledger ${JSON.stringify(afterTour.mb)}`);
    for (const g of afterTour.groups) {
      console.log(`    ${g.count} × ${g.w}×${g.h} ${g.fmt}${g.samples > 1 ? ` ×${g.samples}` : ""} ${g.rt ? "target" : "texture"}: ${g.mb} MB`);
    }
  });
}
