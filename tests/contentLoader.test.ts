import { describe, it, expect, vi, beforeEach } from "vitest";
import { BUNDLED_CONTENT } from "../src/data/content";
import { loadContent, CONTENT_TIMEOUT_MS, type LoaderDeps, type Loaded } from "../src/utils/contentLoader";
import { withBootStep, overlayWriter, BOOT_STEP_TEXT } from "../src/utils/bootStep";

const API = "https://api.example";
const row = (id: string, title = id) => ({
  id, sort: 10, title, role: "Personal project", duration: "2026", short: "s", description: "d",
  tech: "[\"Go\"]", color: "#123456", repo: null,
});
const job = (company: string) => ({
  id: 1, sort: 10, role: "Engineer", company, note: null, start: "Jan 2020", end: null,
  employment: "Full-time", location: "Jakarta", summary: "Built things.",
});
const payload = (title: string) => ({ projects: [row("atlas", title)], career: [job("Acme")] });

/** A storage stand-in; `blocked` throws on every access, as a private window can. */
function memoryStorage(initial: string | null = null, blocked = false) {
  let v = initial;
  return {
    get value() { return v; },
    get: () => { if (blocked) throw new Error("SecurityError"); return v; },
    set: (s: string) => { if (blocked) throw new Error("SecurityError"); v = s; },
  };
}

/** A fetch that answers when `release()` is called, so the race is under the test's control. */
function deferredFetch(answer: () => Response | Promise<Response>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => { calls.push(url); await gate; return answer(); }) as unknown as typeof fetch;
  return { fetchImpl, release, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A timer the test fires by hand. */
function manualDelay() {
  let fire!: () => void;
  const p = new Promise<void>((r) => { fire = r; });
  const asked: number[] = [];
  return { delay: (ms: number) => { asked.push(ms); return p; }, fire, asked };
}

let warn: ReturnType<typeof vi.fn<(msg: string) => void>>;
beforeEach(() => { warn = vi.fn<(msg: string) => void>(); });

const deps = (over: Partial<LoaderDeps>): LoaderDeps => ({
  base: API, fetch: (() => Promise.reject(new Error("no fetch"))) as unknown as typeof fetch,
  storage: memoryStorage(), delay: () => new Promise(() => {}), warn, ...over,
});
/** Runs a load whose fetch answers at once. */
async function answered(answer: () => Response | Promise<Response>, over: Partial<LoaderDeps> = {}) {
  const { fetchImpl, release } = deferredFetch(answer);
  const p = loadContent(deps({ fetch: fetchImpl, ...over }));
  release();
  return p;
}
const CACHED = JSON.stringify(payload("Cached"));

describe("loadContent: the order is fresh, then the last good payload, then bundled", () => {
  it("waits about four seconds at most", async () => {
    expect(CONTENT_TIMEOUT_MS).toBe(4000);
    const timer = manualDelay();
    const p = loadContent(deps({ delay: timer.delay }));
    timer.fire();
    await p;
    expect(timer.asked).toEqual([4000]);
  });

  it("uses the bundled data and sends nothing when no API is configured", async () => {
    const f = vi.fn();
    const r = await loadContent(deps({ base: "", fetch: f as unknown as typeof fetch, storage: memoryStorage(CACHED) }));
    expect(r.content).toBe(BUNDLED_CONTENT);
    expect(r.source).toBe("bundled");
    expect(f).not.toHaveBeenCalled();
  });

  it("always fetches fresh and uses it, even with a payload kept from before, and keeps it", async () => {
    const storage = memoryStorage(CACHED);
    const r = await answered(() => json(payload("Fresh")), { storage });
    expect(r.source).toBe("api");
    expect(r.content.projects.map((x) => x.title)).toEqual(["Fresh"]);
    expect(r.content.career.map((x) => x.company)).toEqual(["Acme"]);
    expect(JSON.parse(storage.value!)).toEqual(payload("Fresh"));
  });

  it("asks GET <api>/content", async () => {
    const { fetchImpl, release, calls } = deferredFetch(() => json(payload("Fresh")));
    const p = loadContent(deps({ fetch: fetchImpl }));
    release();
    await p;
    expect(calls).toEqual([`${API}/content`]);
  });

  describe.each([
    ["the timeout", "timeout"],
    ["a network error", "error"],
    ["an old Worker's 404", "404"],
    ["a 503", "503"],
    ["a body that is not JSON", "html"],
    ["a body of the wrong shape", "shape"],
    ["a body with no valid row", "invalid"],
    ["empty tables", "empty"],
  ] as const)("on %s", (_, kind) => {
    async function run(storage: ReturnType<typeof memoryStorage>): Promise<Loaded> {
      if (kind === "timeout") {
        const timer = manualDelay();
        const p = loadContent(deps({ fetch: (() => new Promise(() => {})) as unknown as typeof fetch, storage, delay: timer.delay }));
        timer.fire();
        return p;
      }
      if (kind === "error") return loadContent(deps({ fetch: (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch, storage }));
      const answer = {
        404: () => json({ error: "not found" }, 404),
        503: () => json({ error: "content unavailable" }, 503),
        html: () => new Response("<html>", { status: 200 }),
        shape: () => json({ beacons: [] }),
        invalid: () => json({ projects: [row("atlas", "")], career: [job("")] }),
        empty: () => json({ projects: [], career: [] }),
      }[kind];
      return answered(answer, { storage });
    }

    it("falls back to the last good payload, and keeps it", async () => {
      const storage = memoryStorage(CACHED);
      const r = await run(storage);
      expect(r.source).toBe("cache");
      expect(r.content.projects.map((x) => x.title)).toEqual(["Cached"]);
      expect(storage.value).toBe(CACHED);
      expect(warn).toHaveBeenCalled();
    });

    it("falls back to the bundled data when nothing good was kept", async () => {
      const storage = memoryStorage();
      const r = await run(storage);
      expect(r.source).toBe("bundled");
      expect(r.content).toBe(BUNDLED_CONTENT);
      expect(storage.value).toBeNull();
    });
  });

  it("keeps a good answer that arrives after the timeout, for the next visit", async () => {
    const storage = memoryStorage();
    const { fetchImpl, release } = deferredFetch(() => json(payload("Late")));
    const timer = manualDelay();
    const p = loadContent(deps({ fetch: fetchImpl, storage, delay: timer.delay }));
    timer.fire();
    const r = await p;
    expect(r.source).toBe("bundled");
    release();
    await r.refresh;
    expect(JSON.parse(storage.value!)).toEqual(payload("Late"));
  });

  it("skips a kept payload that is not JSON or has no valid row", async () => {
    for (const kept of ["{not json", "{\"projects\":[{\"id\":\"x\"}],\"career\":[]}"]) {
      const r = await answered(() => json({}, 500), { storage: memoryStorage(kept) });
      expect(r.source, kept).toBe("bundled");
    }
  });

  it("falls back per list: valid projects with no valid career keep the bundled career", async () => {
    const r = await answered(() => json({ projects: [row("atlas")], career: [] }));
    expect(r.source).toBe("api");
    expect(r.content.projects.map((x) => x.id)).toEqual(["atlas"]);
    expect(r.content.career).toBe(BUNDLED_CONTENT.career);
  });

  it("survives blocked storage on every path", async () => {
    expect((await answered(() => json(payload("Fresh")), { storage: memoryStorage(null, true) })).source).toBe("api");
    expect((await answered(() => json({}, 500), { storage: memoryStorage(null, true) })).source).toBe("bundled");
  });

  it("never rejects, even when fetch throws synchronously or the timer breaks", async () => {
    const throwing = (() => { throw new Error("boom"); }) as unknown as typeof fetch;
    await expect(loadContent(deps({ fetch: throwing }))).resolves.toMatchObject({ source: "bundled" });
    const badDelay = () => Promise.reject(new Error("timer"));
    await expect(loadContent(deps({ delay: badDelay as never, fetch: (() => new Promise(() => {})) as unknown as typeof fetch })))
      .resolves.toMatchObject({ source: "bundled" });
  });
});

describe("the INITIALIZING overlay's step (withBootStep)", () => {
  const loaded = (source: Loaded["source"]): Loaded => ({ content: BUNDLED_CONTENT, source, refresh: Promise.resolve() });

  it.each(["api", "cache", "bundled"] as const)("shows SYNCING, then the %s result", async (source) => {
    const lines: string[] = [];
    const r = await withBootStep(async () => loaded(source), (t) => lines.push(t));
    expect(r.source).toBe(source);
    expect(lines).toEqual([BOOT_STEP_TEXT.pending, BOOT_STEP_TEXT[source]]);
  });

  it("always ends: a load that throws gives the bundled data and the ONBOARD line", async () => {
    const lines: string[] = [];
    const r = await withBootStep(() => Promise.reject(new Error("x")), (t) => lines.push(t));
    expect(r.source).toBe("bundled");
    expect(lines.at(-1)).toBe(BOOT_STEP_TEXT.bundled);
  });

  it("always ends on the real loader's timeout and error paths", async () => {
    for (const fetchImpl of [() => new Promise(() => {}), () => Promise.reject(new Error("offline"))]) {
      const timer = manualDelay();
      const lines: string[] = [];
      const p = withBootStep(() => loadContent(deps({ fetch: fetchImpl as unknown as typeof fetch, delay: timer.delay })), (t) => lines.push(t));
      timer.fire();
      expect((await p).source).toBe("bundled");
      expect(lines).toEqual([BOOT_STEP_TEXT.pending, BOOT_STEP_TEXT.bundled]);
    }
  });

  it("keeps loading when the overlay is gone or the writer throws", async () => {
    const r = await withBootStep(async () => loaded("api"), () => { throw new Error("no overlay"); });
    expect(r.source).toBe("api");
    const doc = { getElementById: () => null } as unknown as Document;
    expect(() => overlayWriter(doc)("x")).not.toThrow();
  });

  it("speaks the HUD's voice: upper case, terse", () => {
    for (const t of Object.values(BOOT_STEP_TEXT)) expect(t).toBe(t.toUpperCase());
  });
});
