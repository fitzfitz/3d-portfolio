import { decodePackIndex } from "./packFormat";

/**
 * Loads the asset pack (utils/packFormat.ts) once, the way a Unity or Godot
 * web build loads its data file: one download with a true percentage, kept in
 * Cache Storage so a return visit reads it from disk, then served to the 3D
 * loaders as blob: URLs through assetUrl().
 *
 * Only a production build has a pack (VITE_ASSET_PACK is set by the build
 * plugin in vite.config.ts). In dev and in the e2e harness there is none and
 * assetUrl() keeps returning the loose /models paths.
 */
const PACK_PATH: string | undefined = import.meta.env.VITE_ASSET_PACK;
const CACHE_NAME = "fitz-asset-pack";
export const HAS_ASSET_PACK = !!PACK_PATH;

/** Live download state, read by the loading screen's rAF loop (no React state on the update path). */
export const packProgress = { loaded: 0, total: 0, fromCache: false, done: false };

const urls = new Map<string, string>();
let pending: Promise<void> | null = null;

/** The blob: URL for a packed file ("models/x.glb"), or undefined when it is not packed. */
export function packedUrl(path: string): string | undefined {
  return urls.get(path.replace(/^\/+/, ""));
}

/** Resolves once the pack is loaded (immediately when this build has none). Safe to call repeatedly. */
export function loadAssetPack(): Promise<void> {
  if (!PACK_PATH) return Promise.resolve();
  pending ??= load(`${import.meta.env.BASE_URL}${PACK_PATH}`).catch((err) => {
    // A failed pack leaves assetUrl() on the loose paths, which a packed
    // build does not ship: the canvas then fails into its error boundary.
    pending = null;
    throw err;
  });
  return pending;
}

async function load(url: string): Promise<void> {
  const buf = (await fromCache(url)) ?? (await download(url));
  const { entries, dataStart } = decodePackIndex(buf);
  const whole = new Blob([buf]);
  for (const e of entries) {
    const start = dataStart + e.offset;
    urls.set(e.path, URL.createObjectURL(whole.slice(start, start + e.length, e.type)));
  }
  packProgress.done = true;
}

async function fromCache(url: string): Promise<ArrayBuffer | null> {
  try {
    const hit = await (await caches.open(CACHE_NAME)).match(url);
    if (!hit) return null;
    const buf = await hit.arrayBuffer();
    Object.assign(packProgress, { loaded: buf.byteLength, total: buf.byteLength, fromCache: true });
    return buf;
  } catch {
    return null; // no Cache Storage (insecure origin, private mode): download instead
  }
}

async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`asset pack: HTTP ${res.status}`);
  // The build states the pack's size: Content-Length cannot be trusted for
  // it (absent when chunked, the wire size under Content-Encoding).
  packProgress.total = Number(import.meta.env.VITE_ASSET_PACK_SIZE) || 0;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    packProgress.loaded = loaded;
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  packProgress.total = loaded;
  void store(url, out.buffer);
  return out.buffer;
}

/** Keeps exactly one pack on disk: this build's. Older hashed packs are dropped. */
async function store(url: string, buf: ArrayBuffer): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const href = new URL(url, location.href).href;
    await cache.put(href, new Response(buf, { headers: { "content-type": "application/octet-stream" } }));
    for (const req of await cache.keys()) if (req.url !== href) await cache.delete(req);
  } catch {
    // Quota or no Cache Storage: the next visit downloads again, nothing breaks.
  }
}
