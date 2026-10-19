import { decodePackIndex, type PackEntry } from "./packFormat";

/**
 * The asset pack loader itself, free of app imports (and so testable on its
 * own); utils/assetPack.ts wires it into the page.
 *
 * Downloads common plus one texture tier, hands out each file the moment its
 * last byte arrives, keeps the packs in Cache Storage, and never fails: a pack
 * that 404s, breaks off, or comes back as the host's index.html (Cloudflare's
 * SPA fallback answers unknown paths with a 200) is warned about once and the
 * page falls back to the loose /models files.
 */
export type Tier = "hd" | "sd";
export interface PackRef { file: string; size: number }
export interface PackSet { common: PackRef; hd: PackRef; sd: PackRef }
export interface PackProgress { loaded: number; total: number; fromCache: boolean; done: boolean }

export interface PackLoader {
  /** Resolves once this device's packs settle, loaded or fallen back. Never rejects; one shared promise. */
  load(): Promise<void>;
  /** The blob: URL for a packed file ("models/x.glb"), or undefined when it is not packed (yet). */
  packedUrl(path: string): string | undefined;
  /** Calls `fn` for every packed file, already delivered ones first. */
  onEntry(fn: (path: string, url: string) => void): void;
  /** Live download state, read by the loading bar's rAF loop. */
  progress: PackProgress;
  /** The tier this page loads, once load() has asked for it. */
  tier(): Tier | null;
  /** The load in progress or done, or null when nothing asked for one (?cv, no WebGL). Never starts one. */
  started(): Promise<void> | null;
}

const CACHE_NAME = "fitz-asset-pack";

export function createPackLoader(opts: {
  packs: PackSet;
  /** Absolute URL the pack files resolve against (the site's base). */
  base: string;
  tier: () => Tier;
  fetch?: typeof fetch;
  caches?: CacheStorage | null;
}): PackLoader {
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const storage = opts.caches ?? null;
  const urlOf = (p: PackRef) => new URL(p.file, opts.base).href;
  const urls = new Map<string, string>();
  const listeners = new Set<(path: string, url: string) => void>();
  const progress: PackProgress = { loaded: 0, total: 0, fromCache: false, done: false };
  let chosen: Tier | null = null;
  let pending: Promise<void> | null = null;
  let warned = false;

  const openCache = async () => {
    try {
      return storage ? await storage.open(CACHE_NAME) : null;
    } catch {
      return null; // insecure origin, private mode: no disk cache, the network still works
    }
  };

  const deliver = (e: PackEntry, bytes: Uint8Array) => {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: e.type }));
    urls.set(e.path, url);
    for (const fn of listeners) fn(e.path, url);
  };

  /** A cached pack, or null when absent, unreadable or damaged (a damaged one is deleted). */
  const fromCache = async (url: string, size: number): Promise<ArrayBuffer | null> => {
    const cache = await openCache();
    try {
      const hit = await cache?.match(url);
      if (!hit) return null;
      const buf = await hit.arrayBuffer();
      if (buf.byteLength !== size) throw new Error("size");
      decodePackIndex(buf);
      return buf;
    } catch {
      await cache?.delete(url).catch(() => {});
      return null;
    }
  };

  const download = async (url: string, size: number) => {
    const res = await doFetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    // The build states the size: Content-Length cannot be trusted for it
    // (absent when chunked, the wire size under Content-Encoding).
    const out = new Uint8Array(size);
    const reader = res.body.getReader();
    let received = 0;
    let index: { entries: PackEntry[]; dataStart: number } | null = null;
    let next = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > size) throw new Error("longer than the build said");
      out.set(value, received);
      received += value.length;
      progress.loaded += value.length;
      if (!index && received >= 8) {
        const n = new DataView(out.buffer).getUint32(4, true);
        if (received >= 8 + n || 8 + n > size) index = decodePackIndex(out.buffer);
      }
      // Hand out every file whose last byte has arrived.
      while (index && next < index.entries.length) {
        const e = index.entries[next];
        const end = index.dataStart + e.offset + e.length;
        if (end > received) break;
        deliver(e, out.subarray(index.dataStart + e.offset, end));
        next++;
      }
    }
    if (received !== size) throw new Error("truncated");
    const cache = await openCache();
    await cache?.put(url, new Response(out.buffer, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  };

  const loadPack = async (p: PackRef) => {
    const url = urlOf(p);
    try {
      const hit = await fromCache(url, p.size);
      if (hit) {
        const { entries, dataStart } = decodePackIndex(hit);
        const all = new Uint8Array(hit);
        for (const e of entries) deliver(e, all.subarray(dataStart + e.offset, dataStart + e.offset + e.length));
        progress.loaded += hit.byteLength;
        progress.fromCache = true;
        return;
      }
      await download(url, p.size);
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn(`asset pack ${p.file} failed (${(err as Error).message}); using the loose files`);
      }
    }
  };

  /** Keeps only this build's packs on disk (both tiers: a device can change tier between visits). */
  const prune = async () => {
    const cache = await openCache();
    if (!cache) return;
    const keep = new Set(Object.values(opts.packs).map(urlOf));
    try {
      for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
    } catch {
      // Nothing to prune.
    }
  };

  return {
    load() {
      if (!pending) {
        chosen = opts.tier();
        const packs = [opts.packs.common, opts.packs[chosen]];
        progress.total = packs.reduce((n, p) => n + p.size, 0);
        pending = Promise.all(packs.map(loadPack)).then(() => {
          progress.done = true;
          void prune();
        });
      }
      return pending;
    },
    packedUrl: (path) => urls.get(path.replace(/^\/+/, "")),
    onEntry(fn) {
      for (const [path, url] of urls) fn(path, url);
      listeners.add(fn);
    },
    progress,
    tier: () => chosen,
    started: () => pending,
  };
}
