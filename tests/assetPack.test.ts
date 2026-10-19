import { afterEach, describe, expect, it, vi } from "vitest";
import { createPackLoader, type PackSet } from "../src/utils/assetPack";
import { encodePack } from "../src/utils/packFormat";

const BASE = "http://site.test/sub/";
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

/** Three real packs: common (a model then a big texture), hd and sd. */
function build() {
  const common = encodePack([
    { path: "models/a.glb", bytes: bytes(4, 1) },
    { path: "models/b.webp", bytes: bytes(3000, 2) },
  ]);
  const hd = encodePack([{ path: "models/x_4k.webp", bytes: bytes(50, 3) }]);
  const sd = encodePack([{ path: "models/x.webp", bytes: bytes(20, 4) }]);
  const packs: PackSet = {
    common: { file: "world-common.aaaaaaaaaa.pack", size: common.length },
    hd: { file: "world-hd.bbbbbbbbbb.pack", size: hd.length },
    sd: { file: "world-sd.cccccccccc.pack", size: sd.length },
  };
  const body: Record<string, Uint8Array> = {
    [BASE + packs.common.file]: common,
    [BASE + packs.hd.file]: hd,
    [BASE + packs.sd.file]: sd,
  };
  return { packs, body };
}

/** A fetch that streams each body in three chunks; `served` counts chunks handed out per URL. */
function streamingFetch(body: Record<string, Uint8Array | string | number | Error>) {
  const served: Record<string, number> = {};
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const b = body[url];
    if (b instanceof Error) throw b;
    if (typeof b === "number") return new Response("nope", { status: b });
    if (typeof b === "string") return new Response(b, { status: 200, headers: { "content-type": "text/html" } });
    if (!b) return new Response("missing", { status: 404 });
    const third = Math.ceil(b.length / 3);
    let i = 0;
    served[url] = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i >= 3) return c.close();
        c.enqueue(b.slice(i * third, (i + 1) * third));
        served[url] = ++i;
      },
    });
    return new Response(stream, { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, served, calls };
}

/** Cache Storage backed by a Map, one cache. */
function fakeCaches(seed: Record<string, Uint8Array> = {}) {
  const store = new Map<string, Uint8Array>(Object.entries(seed));
  const cache = {
    match: async (u: RequestInfo | URL) => {
      const b = store.get(String(u));
      return b ? new Response(b.slice()) : undefined;
    },
    put: async (u: RequestInfo | URL, r: Response) => { store.set(String(u), new Uint8Array(await r.arrayBuffer())); },
    keys: async () => [...store.keys()].map((url) => ({ url }) as Request),
    delete: async (u: RequestInfo | URL) => store.delete(typeof u === "string" ? u : (u as Request).url ?? String(u)),
  };
  return { caches: { open: async () => cache } as unknown as CacheStorage, store };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

describe("asset pack loader", () => {
  it("delivers each file before the stream ends", async () => {
    const { packs, body } = build();
    const f = streamingFetch(body);
    const loader = createPackLoader({ packs, base: BASE, tier: () => "hd", fetch: f.fn, caches: null });
    const chunksWhenModelArrived: number[] = [];
    loader.onEntry((path) => { if (path === "models/a.glb") chunksWhenModelArrived.push(f.served[BASE + packs.common.file]); });
    await loader.load();
    expect(chunksWhenModelArrived).toHaveLength(1);
    expect(chunksWhenModelArrived[0]).toBeLessThan(3);
  });

  it("loads common plus only the chosen tier", async () => {
    const { packs, body } = build();
    const f = streamingFetch(body);
    const loader = createPackLoader({ packs, base: BASE, tier: () => "hd", fetch: f.fn, caches: null });
    await loader.load();
    expect(f.calls.sort()).toEqual([BASE + packs.common.file, BASE + packs.hd.file].sort());
    expect(loader.packedUrl("models/x_4k.webp")).toMatch(/^blob:/);
    expect(loader.packedUrl("/models/a.glb")).toMatch(/^blob:/);
    expect(loader.packedUrl("models/x.webp")).toBeUndefined();
    expect(loader.tier()).toBe("hd");
    expect(loader.progress).toMatchObject({ done: true, loaded: packs.common.size + packs.hd.size, total: packs.common.size + packs.hd.size });
  });

  it("never rejects on a single-page-app fallback", async () => {
    const { packs, body } = build();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = streamingFetch({ ...body, [BASE + packs.common.file]: "<!doctype html><title>x</title>" });
    const loader = createPackLoader({ packs, base: BASE, tier: () => "hd", fetch: f.fn, caches: null });
    await expect(loader.load()).resolves.toBeUndefined();
    expect(loader.packedUrl("models/a.glb")).toBeUndefined();
    expect(loader.packedUrl("models/x_4k.webp")).toMatch(/^blob:/);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["HTTP 404", 404 as const],
    ["a network error", new TypeError("Failed to fetch")],
  ])("never rejects on %s", async (_, failure) => {
    const { packs, body } = build();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = streamingFetch({ ...body, [BASE + packs.common.file]: failure });
    const loader = createPackLoader({ packs, base: BASE, tier: () => "hd", fetch: f.fn, caches: null });
    await expect(loader.load()).resolves.toBeUndefined();
    expect(loader.packedUrl("models/a.glb")).toBeUndefined();
  });

  it("never rejects on a truncated body, and keeps what arrived", async () => {
    const { packs, body } = build();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const common = body[BASE + packs.common.file];
    const f = streamingFetch({ ...body, [BASE + packs.common.file]: common.slice(0, common.length - 10) });
    const loader = createPackLoader({ packs, base: BASE, tier: () => "hd", fetch: f.fn, caches: fakeCaches().caches });
    await expect(loader.load()).resolves.toBeUndefined();
    expect(loader.packedUrl("models/a.glb")).toMatch(/^blob:/);
    expect(loader.packedUrl("models/b.webp")).toBeUndefined();
  });

  it("reads a cached pack without fetching", async () => {
    const { packs, body } = build();
    const { caches } = fakeCaches(body);
    const f = streamingFetch(body);
    const loader = createPackLoader({ packs, base: BASE, tier: () => "sd", fetch: f.fn, caches });
    await loader.load();
    expect(f.calls).toEqual([]);
    expect(loader.progress.fromCache).toBe(true);
    expect(loader.packedUrl("models/x.webp")).toMatch(/^blob:/);
  });

  it("replaces a damaged cached pack", async () => {
    const { packs, body } = build();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const commonUrl = BASE + packs.common.file;
    const { caches, store } = fakeCaches({ [commonUrl]: bytes(64, 9), [BASE + packs.hd.file]: body[BASE + packs.hd.file] });
    const f = streamingFetch(body);
    const loader = createPackLoader({ packs, base: BASE, tier: () => "hd", fetch: f.fn, caches });
    await loader.load();
    await settle();
    expect(f.calls).toEqual([commonUrl]);
    expect(loader.packedUrl("models/a.glb")).toMatch(/^blob:/);
    expect(Array.from(store.get(commonUrl)!)).toEqual(Array.from(body[commonUrl]));
  });

  it("prunes packs this build does not name", async () => {
    const { packs, body } = build();
    const stale = BASE + "world-common.0000000000.pack";
    const { caches, store } = fakeCaches({ [stale]: bytes(8, 0) });
    const loader = createPackLoader({ packs, base: BASE, tier: () => "hd", fetch: streamingFetch(body).fn, caches });
    await loader.load();
    await settle();
    const names = new Set(Object.values(packs).map((p) => BASE + p.file));
    expect(store.has(stale)).toBe(false);
    for (const k of store.keys()) expect(names.has(k)).toBe(true);
  });

  it.each([
    ["no Cache Storage", null],
    ["a Cache Storage that throws", { open: async () => { throw new Error("SecurityError"); } } as unknown as CacheStorage],
  ])("works with %s", async (_, caches) => {
    const { packs, body } = build();
    const loader = createPackLoader({ packs, base: BASE, tier: () => "sd", fetch: streamingFetch(body).fn, caches });
    await loader.load();
    expect(loader.packedUrl("models/b.webp")).toMatch(/^blob:/);
    expect(loader.progress.done).toBe(true);
  });

  it("reads the tier once and shares one load", async () => {
    const { packs, body } = build();
    const tier = vi.fn(() => "hd" as const);
    const loader = createPackLoader({ packs, base: BASE, tier, fetch: streamingFetch(body).fn, caches: null });
    const a = loader.load();
    expect(loader.load()).toBe(a);
    await a;
    expect(tier).toHaveBeenCalledTimes(1);
  });
});
