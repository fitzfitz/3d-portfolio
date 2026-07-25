import { withPage, settle } from "./harness.mjs";

export default async function run() {
  return withPage({ label: "audio" }, async (page, checks) => {
    // Count AudioContext constructions before any app script runs. This catches
    // a second context from any source, which is stronger than trusting
    // SoundManager.init()'s own `if (this.ctx) return` guard.
    // (Re-navigation is required: evaluateOnNewDocument only applies to loads
    // after it is registered.)
    await page.evaluateOnNewDocument(() => {
      window.__ctxCount = 0;
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); window.__ctxCount++; }
      };
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    await settle(page, 3000);

    const before = await page.evaluate(() => window.__ctxCount);
    checks.check("no AudioContext before user gesture", before === 0, `count=${before}`);

    // A real click is user activation, which is what init() waits for.
    await page.mouse.click(640, 400);
    await settle(page, 1200);

    const after = await page.evaluate(() => window.__ctxCount);
    checks.check("exactly one AudioContext after gesture (StrictMode single-init)",
      after === 1, `count=${after}`);

    const state = await page.evaluate(() => {
      const s = window.__fitz.sound;
      const ctx = s.ctx ?? s._ctx ?? null;
      return { state: ctx?.state ?? "none" };
    });
    checks.check("AudioContext is running after gesture", state.state === "running",
      `state=${state.state}`);

    // Mute persistence: toggle via the store, reload, assert it survived.
    await page.evaluate(() => window.__fitz.store.getState().setMuted(true));
    await settle(page, 300);
    const stored = await page.evaluate(() => localStorage.getItem("fitz-sound-muted"));
    checks.check("mute writes localStorage", stored === "1", `value=${stored}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    const persisted = await page.evaluate(() => window.__fitz.store.getState().isMuted);
    checks.check("mute persists across reload", persisted === true, `isMuted=${persisted}`);

    // Leave the profile clean for later probes sharing the browser profile.
    await page.evaluate(() => localStorage.removeItem("fitz-sound-muted"));
  });
}
