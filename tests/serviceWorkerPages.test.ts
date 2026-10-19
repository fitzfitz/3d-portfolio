import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const SCOPE = "http://site.test/3d-portfolio/";
type Listener = (event: unknown) => void;

/**
 * Runs public/sw.js against a stub worker scope: a Map-backed Cache Storage
 * and a switchable network, so its real fetch, message and activate handlers
 * can be driven.
 */
function worker() {
  const store = new Map<string, Response>();
  const listeners: Record<string, Listener> = {};
  const net = { online: true, pages: new Map<string, string>(), assets: new Map<string, { body: string; type: string }>() };
  const cache = {
    match: async (r: string | { url: string }) => store.get(typeof r === "string" ? r : r.url)?.clone(),
    put: async (r: string | { url: string }, res: Response) => { store.set(typeof r === "string" ? r : r.url, res); },
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (r: string | { url: string }) => store.delete(typeof r === "string" ? r : r.url),
    // Like Cache.add: fetch, then store under the request URL (any 200).
    add: async (u: string) => { store.set(u, await fetchStub(u)); },
  };
  async function fetchStub(r: string | { url: string }): Promise<Response> {
    const url = typeof r === "string" ? r : r.url;
    if (!net.online) throw new TypeError("Failed to fetch");
    const page = net.pages.get(new URL(url).pathname === new URL(SCOPE).pathname ? "page" : url);
    if (page !== undefined) return new Response(page, { headers: { "content-type": "text/html" } });
    const a = net.assets.get(url);
    if (a) return new Response(a.body, { headers: { "content-type": a.type } });
    // Cloudflare's SPA fallback: unknown paths get index.html with a 200.
    return new Response("<!doctype html>spa", { status: 200, headers: { "content-type": "text/html" } });
  }
  const ctx = createContext({
    self: {
      addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
      location: { origin: "http://site.test" },
      registration: { scope: SCOPE },
      clients: { claim: async () => {} },
      skipWaiting: () => {},
    },
    caches: { open: async () => cache, keys: async () => ["fitz-shell-v1"], delete: async () => true, match: (r: string) => cache.match(r) },
    fetch: fetchStub,
    Response, Headers, URL,
  });
  runInContext(readFileSync("public/sw.js", "utf8"), ctx);

  const navigate = async (url: string) => {
    let responded: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    listeners.fetch({ request: { method: "GET", url, mode: "navigate" }, respondWith: (p: Promise<Response>) => { responded = p; }, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    const res = await responded!;
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 0));
    return res;
  };
  const getAsset = async (url: string) => {
    let responded: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    listeners.fetch({ request: { method: "GET", url, mode: "no-cors" }, respondWith: (p: Promise<Response>) => { responded = p; }, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    const res = await responded!;
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 0));
    return res;
  };
  const handOver = async (urls: string[]) => {
    const pending: Promise<unknown>[] = [];
    listeners.message({ data: { type: "cache-loaded", urls }, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  const activate = async () => {
    const pending: Promise<unknown>[] = [];
    listeners.activate({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  return { store, net, navigate, getAsset, handOver, activate };
}

describe("service worker pages", () => {
  it("keeps one copy of the page, whatever the query, and serves it offline", async () => {
    // Per-query copies outlived the assets they point at: after a deploy an
    // old /?utm=... copy could be served offline with its code pruned.
    const w = worker();
    w.net.pages.set("page", "build-1");
    await w.navigate(SCOPE + "?utm_source=linkedin");
    await w.handOver([SCOPE + "?cv"]);
    const pageKeys = [...w.store.keys()].filter((k) => new URL(k).pathname === "/3d-portfolio/");
    expect(pageKeys).toEqual([SCOPE]);

    w.net.pages.set("page", "build-2");
    await w.navigate(SCOPE + "?fbclid=x");
    w.net.online = false;
    expect(await (await w.navigate(SCOPE)).text()).toBe("build-2");
    expect(await (await w.navigate(SCOPE + "?anything")).text()).toBe("build-2");
  });

  it("drops per-query page copies left by older workers on activate", async () => {
    const w = worker();
    w.store.set(SCOPE + "?utm_source=x", new Response("old"));
    w.store.set(SCOPE, new Response("page"));
    await w.activate();
    expect([...w.store.keys()]).toEqual([SCOPE]);
  });

  it("never caches the host's HTML fallback under an asset name", async () => {
    // Cloudflare answers a missing hashed file with index.html and a 200;
    // cached cache-first, it would stand in for that file until the next build.
    const w = worker();
    const res = await w.getAsset(SCOPE + "assets/index-NEW.js");
    expect(res.headers.get("content-type")).toContain("text/html");
    await w.handOver([SCOPE + "assets/GlobalCanvas-NEW.js"]);
    expect(w.store.has(SCOPE + "assets/index-NEW.js")).toBe(false);
    expect(w.store.has(SCOPE + "assets/GlobalCanvas-NEW.js")).toBe(false);

    w.net.assets.set(SCOPE + "assets/index-NEW.js", { body: "js", type: "text/javascript" });
    await w.getAsset(SCOPE + "assets/index-NEW.js");
    expect(w.store.has(SCOPE + "assets/index-NEW.js")).toBe(true);
  });
});
