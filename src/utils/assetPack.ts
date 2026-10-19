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
 * Only a production build has packs (VITE_ASSET_PACKS is set by the build
 * plugin). In dev and in the e2e harness there are none and assetUrl() keeps
 * returning the loose /models paths, which a build also still ships as the
 * fallback for anything a pack did not cover.
 */
interface PackRef { file: string; size: number }
type Tier = "common" | "hd" | "sd";
const PACKS = import.meta.env.VITE_ASSET_PACKS as Record<Tier, PackRef> | undefined;
const CACHE_NAME = "fitz-asset-pack";

export const HAS_ASSET_PACK = !!PACKS;

/** Live download state, read by the loading screen's rAF loop (no React state on the update path). */
export const packProgress = { loaded: 0, total: 0, fromCache: false, done: false };

const urls = new Map<string, string>();
const listeners = new Set<(path: string, url: string) => void>();
let pending: Promise<void> | null = null;

/** The blob: URL for a packed file ("models/x.glb"), or undefined when it is not packed (yet). */
export function packedUrl(path: string): string | undefined {
  return urls.get(path.replace(/^\/+/, ""));
}

/** Calls `fn` for every packed file, already delivered ones first. */
export function onPackEntry(fn: (path: string, url: string) => void): void {
  for (const [path, url] of urls) fn(path, url);
  listeners.add(fn);
}

/** Resolves once this device's packs are in (immediately when the build has none). Safe to call repeatedly. */
export function loadAssetPack(): Promise<void> {
  if (!PACKS) return Promise.resolve();
  if (!pending) {
    const chosen = [PACKS.common, prefersHiResMaps() ? PACKS.hd : PACKS.sd];
    packProgress.total = chosen.reduce((n, p) => n + p.size, 0);
    const base = import.meta.env.BASE_URL;
    pending = Promise.all(chosen.map((p) => loadPack(new URL(`${base}${p.file}`, location.href).href, p.size)))
      .then(() => {
        packProgress.done = true;
        void prune(Object.values(PACKS).map((p) => new URL(`${base}${p.file}`, location.href).href));
      })
      .catch((err) => {
        // Whatever arrived stays packed; the rest falls back to the loose files.
        pending = null;
        throw err;
      });
  }
  return pending;
}

function deliver(e: PackEntry, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: e.type }));
  urls.set(e.path, url);
  for (const fn of listeners) fn(e.path, url);
}

async function loadPack(url: string, size: number): Promise<void> {
  const hit = await fromCache(url);
  if (hit) {
    const { entries, dataStart } = decodePackIndex(hit);
    const all = new Uint8Array(hit);
    for (const e of entries) deliver(e, all.subarray(dataStart + e.offset, dataStart + e.offset + e.length));
    packProgress.loaded += hit.byteLength;
    packProgress.fromCache = true;
    return;
  }

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`asset pack: HTTP ${res.status}`);
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
    if (received + value.length > size) throw new Error("asset pack: longer than the build said");
    out.set(value, received);
    received += value.length;
    packProgress.loaded += value.length;

    if (!index && received >= 8 && received >= 8 + new DataView(out.buffer).getUint32(4, true)) {
      index = decodePackIndex(out.buffer);
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
  if (received !== size || !index || next !== index.entries.length) throw new Error("asset pack: truncated");
  void store(url, out.buffer);
}

async function fromCache(url: string): Promise<ArrayBuffer | null> {
  try {
    const hit = await (await caches.open(CACHE_NAME)).match(url);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null; // no Cache Storage (insecure origin, private mode): download instead
  }
}

async function store(url: string, buf: ArrayBuffer): Promise<void> {
  try {
    await (await caches.open(CACHE_NAME)).put(url, new Response(buf, { headers: { "content-type": "application/octet-stream" } }));
  } catch {
    // Quota or no Cache Storage: the next visit downloads again, nothing breaks.
  }
}

/** Keeps only this build's packs on disk (both tiers: a device can change tier). */
async function prune(current: string[]): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const req of await cache.keys()) if (!current.includes(req.url)) await cache.delete(req);
  } catch {
    // Nothing to prune without Cache Storage.
  }
}
