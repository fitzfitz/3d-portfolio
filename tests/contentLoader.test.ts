import { describe, it, expect, vi, beforeEach } from "vitest";
import { BUNDLED_CONTENT } from "../src/data/content";
import { loadContent, CONTENT_TIMEOUT_MS, type LoaderDeps } from "../src/utils/contentLoader";

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

/** A fetch that answers `body` (or fails) when `release()` is called, so the race is under the test's control. */
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
  return { delay: () => p, fire };
}

let warn: ReturnType<typeof vi.fn<(msg: string) => void>>;
beforeEach(() => { warn = vi.fn<(msg: string) => void>(); });

const deps = (over: Partial<LoaderDeps>): LoaderDeps => ({
  base: API, fetch: (() => Promise.reject(new Error("no fetch"))) as unknown as typeof fetch,
  storage: memoryStorage(), delay: () => new Promise(() => {}), warn, ...over,
});

describe("loadContent", () => {
  it("waits about a second and a half at most", () => {
    expect(CONTENT_TIMEOUT_MS).toBe(1500);
  });

  it("uses the bundled data and sends nothing when no API is configured", async () => {
    const f = vi.fn();
    const r = await loadContent(deps({ base: "", fetch: f as unknown as typeof fetch }));
    expect(r.content).toBe(BUNDLED_CONTENT);
    expect(r.source).toBe("bundled");
    expect(f).not.toHaveBeenCalled();
  });

  it("with no cache, uses a response that arrives in time, and caches it", async () => {
    const storage = memoryStorage();
    const { fetchImpl, release, calls } = deferredFetch(() => json(payload("Fresh")));
    const p = loadContent(deps({ fetch: fetchImpl, storage }));
    release();
    const r = await p;
    expect(calls).toEqual([`${API}/content`]);
    expect(r.source).toBe("api");
    expect(r.content.projects.map((x) => x.title)).toEqual(["Fresh"]);
    expect(r.content.career.map((x) => x.company)).toEqual(["Acme"]);
    expect(JSON.parse(storage.value!)).toEqual(payload("Fresh"));
  });

  it("with no cache, falls back on the timeout, and still caches the late response for the next visit", async () => {
    const storage = memoryStorage();
    const { fetchImpl, release } = deferredFetch(() => json(payload("Late")));
    const timer = manualDelay();
    const p = loadContent(deps({ fetch: fetchImpl, storage, delay: timer.delay }));
    timer.fire();
    const r = await p;
    expect(r.source).toBe("bundled");
    expect(r.content).toBe(BUNDLED_CONTENT);
    expect(storage.value).toBeNull();
    release();
    await r.refresh;
    expect(JSON.parse(storage.value!)).toEqual(payload("Late"));
  });

  it("uses a cached payload at once, and refreshes the cache in the background for the next visit", async () => {
    const storage = memoryStorage(JSON.stringify(payload("Cached")));
    const { fetchImpl, release, calls } = deferredFetch(() => json(payload("Newer")));
    const r = await loadContent(deps({ fetch: fetchImpl, storage }));
    expect(r.source).toBe("cache");
    expect(r.content.projects.map((x) => x.title)).toEqual(["Cached"]);
    expect(calls).toHaveLength(1);
    release();
    await r.refresh;
    expect(JSON.parse(storage.value!)).toEqual(payload("Newer"));
    // The visit keeps what it started with.
    expect(r.content.projects.map((x) => x.title)).toEqual(["Cached"]);
  });

  it("ignores a cache with nothing valid in it and waits for the network instead", async () => {
    const storage = memoryStorage("{\"projects\":[{\"id\":\"x\"}],\"career\":[]}");
    const { fetchImpl, release } = deferredFetch(() => json(payload("Fresh")));
    const p = loadContent(deps({ fetch: fetchImpl, storage }));
    release();
    const r = await p;
    expect(r.source).toBe("api");
    expect(r.content.projects[0].title).toBe("Fresh");
  });

  it("ignores a cache that is not JSON", async () => {
    const { fetchImpl, release } = deferredFetch(() => json(payload("Fresh")));
    const p = loadContent(deps({ fetch: fetchImpl, storage: memoryStorage("{not json") }));
    release();
    expect((await p).source).toBe("api");
  });

  it.each([
    ["an old Worker's 404", () => json({ error: "not found" }, 404)],
    ["a 503", () => json({ error: "unavailable" }, 503)],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["a body of the wrong shape", () => json({ beacons: [] })],
  ])("falls back to the bundled data on %s, and caches nothing", async (_, answer) => {
    const storage = memoryStorage();
    const { fetchImpl, release } = deferredFetch(answer);
    const p = loadContent(deps({ fetch: fetchImpl, storage }));
    release();
    const r = await p;
    expect(r.source).toBe("bundled");
    expect(r.content).toBe(BUNDLED_CONTENT);
    expect(storage.value).toBeNull();
  });

  it("falls back to the bundled data when the network fails", async () => {
    const r = await loadContent(deps({ fetch: (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch }));
    expect(r.source).toBe("bundled");
  });

  it("falls back per list: valid projects with no valid career keep the bundled career", async () => {
    const { fetchImpl, release } = deferredFetch(() => json({ projects: [row("atlas")], career: [] }));
    const p = loadContent(deps({ fetch: fetchImpl }));
    release();
    const r = await p;
    expect(r.source).toBe("api");
    expect(r.content.projects.map((x) => x.id)).toEqual(["atlas"]);
    expect(r.content.career).toBe(BUNDLED_CONTENT.career);
  });

  it("treats empty tables as no content: the bundled data", async () => {
    const { fetchImpl, release } = deferredFetch(() => json({ projects: [], career: [] }));
    const p = loadContent(deps({ fetch: fetchImpl }));
    release();
    const r = await p;
    expect(r.source).toBe("bundled");
    expect(r.content.projects).toBe(BUNDLED_CONTENT.projects);
  });

  it("survives blocked storage", async () => {
    const { fetchImpl, release } = deferredFetch(() => json(payload("Fresh")));
    const p = loadContent(deps({ fetch: fetchImpl, storage: memoryStorage(null, true) }));
    release();
    const r = await p;
    expect(r.source).toBe("api");
    await r.refresh;
  });
});
