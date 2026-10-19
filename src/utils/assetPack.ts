import { decodePackIndex, type PackEntry } from "./packFormat";
import { prefersHiResMaps } from "./hiResMaps";

/**
 * Loads the asset packs (utils/packFormat.ts) the way a Unity or Godot web
 * build loads its data files: a few downloads with a true percentage, kept in
 * Cache Storage so a return visit reads them from disk, then served to the 3D
 * loaders as blob: URLs through assetUrl().
 *
 * The build (vite.config.ts) splits public/models three ways: `common`
 * (everything the scene draws), `hd` (the planets' 4096 maps) and `sd` (their
 * 2048 originals). A device downloads common plus the one texture tier it
 * draws (utils/hiResMaps.ts), never both.
 *
 * Each file is handed out as soon as its bytes arrive, not when the whole pack
 * has: listeners (GlobalCanvas) start parsing models while the rest is still
 * downloading, the overlap loose files get for free.
 *
 * Loading never fails: a pack that 404s, breaks off, or comes back as the
 * host's index.html (Cloudflare's SPA fallback answers unknown paths with a
 * 200) is warned about once, and assetUrl() falls back to the loose /models
 * files a build still ships for every file that did not arrive.
 *
 * Only a production build has packs (VITE_ASSET_PACKS is set by the build
 * plugin). In dev and in the e2e harness there are none and assetUrl() keeps
 * returning the loose paths.
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
  };
}

// The page's loader, from the pack list the build plugin bakes in (a JSON string).
const RAW = import.meta.env.VITE_ASSET_PACKS as string | undefined;
const loader = RAW
  ? createPackLoader({
      packs: JSON.parse(RAW) as PackSet,
      base: new URL(import.meta.env.BASE_URL, location.href).href,
      tier: () => (prefersHiResMaps() ? "hd" : "sd"),
      caches: typeof caches === "undefined" ? null : caches,
    })
  : null;

export const HAS_ASSET_PACK = !!loader;
export const packProgress: PackProgress = loader?.progress ?? { loaded: 0, total: 0, fromCache: false, done: true };
export const packedUrl = (path: string): string | undefined => loader?.packedUrl(path);
export const onPackEntry = (fn: (path: string, url: string) => void): void => loader?.onEntry(fn);
/** Resolves once this device's packs settle (at once when the build has none). Never rejects. */
export const loadAssetPack = (): Promise<void> => loader?.load() ?? Promise.resolve();
