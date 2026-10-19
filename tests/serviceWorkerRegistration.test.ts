import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "../src/utils/serviceWorker";

/** A page that has already fired `load`, with a service worker container that records registrations. */
function stubPage({ loaded = false } = {}) {
  const register = vi.fn(() => Promise.resolve({}));
  vi.stubGlobal("navigator", { serviceWorker: { register, ready: Promise.resolve({ active: { postMessage: vi.fn() } }) } });
  // Before `load`, the listener fires (here at once); after it, it never does.
  vi.stubGlobal("window", { addEventListener: (_: string, fn: () => void) => { if (!loaded) fn(); } });
  vi.stubGlobal("document", { readyState: loaded ? "complete" : "interactive" });
  vi.stubGlobal("location", { origin: "http://site.test", href: "http://site.test/" });
  vi.stubGlobal("performance", { getEntriesByType: () => [] });
  return register;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.unstubAllGlobals());

describe("registerServiceWorker", () => {
  it("waits for a started pack download before registering", async () => {
    // The worker re-fetches what the page loaded so it can cache it; doing
    // that while the packs stream steals their bandwidth on a slow link.
    const register = stubPage();
    let finish!: () => void;
    const packs = new Promise<void>((r) => { finish = r; });
    registerServiceWorker(() => packs);
    await tick();
    expect(register).not.toHaveBeenCalled();
    finish();
    await tick();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("registers at once when no pack download was started (?cv, no WebGL)", async () => {
    const register = stubPage();
    registerServiceWorker(() => null);
    await tick();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("registers when the page had already loaded", async () => {
    // App calls it from an effect, usually after `load` has fired.
    const register = stubPage({ loaded: true });
    registerServiceWorker(() => null);
    await tick();
    expect(register).toHaveBeenCalledTimes(1);
  });
});
