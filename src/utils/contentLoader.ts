import { BUNDLED_CONTENT, type Content, type ContentSource } from "../data/content";
import { resolveContent } from "./contentParse";
import { beaconApiUrl } from "./apiBase";

/**
 * Fetches the content (beacon-api GET /content) before the scene is built
 * (spec 2026-10-23-dynamic-content, decision 4). The scene's landmarks are
 * built from it, so it must be settled first and never swapped mid-visit:
 *
 * - no API configured: the bundled data, no request;
 * - a payload cached by an earlier visit: used at once, while a fetch
 *   refreshes the cache for the next visit;
 * - no usable cache: wait for /content up to CONTENT_TIMEOUT_MS, then the
 *   bundled data. A late answer is still cached, for the next visit.
 *
 * An old Worker without /content answers 404, which is a fallback like any
 * other failure: the new site works before the Worker ships.
 */

/** localStorage key of the last good /content response (the raw text; build ruling R2). */
export const CONTENT_CACHE_KEY = "fitz-content";
/** How long a first visit waits for /content before using the bundled data. */
export const CONTENT_TIMEOUT_MS = 1500;

export interface LoaderDeps {
  /** beaconApiUrl(): empty means no API. */
  base: string;
  fetch: typeof fetch;
  storage: { get(): string | null; set(value: string): void };
  delay: (ms: number) => Promise<void>;
  warn: (msg: string) => void;
}

export interface Loaded {
  content: Content;
  source: ContentSource;
  /** Settles when the background fetch has finished (and cached what it got). Never rejects. */
  refresh: Promise<void>;
}

const isShape = (v: unknown): boolean =>
  v !== null && typeof v === "object" && Array.isArray((v as Record<string, unknown>).projects) && Array.isArray((v as Record<string, unknown>).career);

/** GET /content: the parsed body when it is a 200 of the right shape (cached as it came), else null. */
async function fetchContent(d: LoaderDeps): Promise<unknown> {
  try {
    const res = await d.fetch(`${d.base}/content`);
    if (!res.ok) return null;
    const text = await res.text();
    const body: unknown = JSON.parse(text);
    if (!isShape(body)) return null;
    try { d.storage.set(text); } catch { /* storage blocked: no cache, still used now */ }
    return body;
  } catch {
    return null;
  }
}

function readCache(d: LoaderDeps): unknown {
  try {
    const s = d.storage.get();
    return s === null ? null : JSON.parse(s);
  } catch {
    return null;
  }
}

const TIMED_OUT = Symbol("timed out");

export async function loadContent(d: LoaderDeps): Promise<Loaded> {
  const bundled = (refresh: Promise<void>): Loaded => ({ content: BUNDLED_CONTENT, source: "bundled", refresh });
  if (!d.base) return bundled(Promise.resolve());

  const fresh = fetchContent(d);
  const refresh = fresh.then(() => undefined);

  const cached = readCache(d);
  if (cached !== null) {
    const r = resolveContent(cached, BUNDLED_CONTENT, d.warn);
    if (r.usable) return { content: r.content, source: "cache", refresh };
  }

  const first = await Promise.race([fresh, d.delay(CONTENT_TIMEOUT_MS).then(() => TIMED_OUT)]);
  if (first === TIMED_OUT) {
    d.warn(`content: /content took over ${CONTENT_TIMEOUT_MS} ms; using the bundled content (the answer is cached for the next visit)`);
    return bundled(refresh);
  }
  if (first === null) return bundled(refresh);
  const r = resolveContent(first, BUNDLED_CONTENT, d.warn);
  return r.usable ? { content: r.content, source: "api", refresh } : bundled(refresh);
}

/** The browser's wiring: the configured API, window.fetch, guarded localStorage and setTimeout. */
export function browserLoaderDeps(): LoaderDeps {
  return {
    base: beaconApiUrl(),
    fetch: (input, init) => fetch(input, init),
    storage: {
      get: () => localStorage.getItem(CONTENT_CACHE_KEY),
      set: (v) => localStorage.setItem(CONTENT_CACHE_KEY, v),
    },
    delay: (ms) => new Promise((r) => setTimeout(r, ms)),
    warn: (msg) => console.warn(msg),
  };
}
