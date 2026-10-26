import { BUNDLED_CONTENT, type Content, type ContentSource } from "../data/content";
import { resolveContent } from "./contentParse";
import { beaconApiUrl } from "./apiBase";

/**
 * Fetches the content (beacon-api GET /content) while the game loads, before
 * the app's modules are imported (spec 2026-10-23-dynamic-content, the
 * owner's loading call, option C). The scene's landmarks are built from it at
 * module load, so it settles once and never changes during a visit.
 *
 * Every visit fetches fresh, bounded by CONTENT_TIMEOUT_MS, in parallel with
 * the asset packs (main.tsx). The fallback order is:
 *   1. a fresh /content with at least one valid list;
 *   2. the last good payload (localStorage, guarded);
 *   3. the bundled data.
 * A slow, failing or invalid answer never blocks or breaks loading: it falls
 * back. loadContent never rejects. A good answer that arrives after the
 * timeout is still kept as the last good payload, for the next visit.
 *
 * An old Worker without /content answers 404, a fallback like any other
 * failure, so the new site works before the Worker ships.
 */

/** localStorage key of the last good /content response (the raw text; build ruling R2). */
export const CONTENT_CACHE_KEY = "fitz-content";
/** How long loading waits for /content: the asset packs usually take longer anyway. */
export const CONTENT_TIMEOUT_MS = 4000;
/**
 * When a /content that never answers is abandoned. Well past the loading
 * timeout, so a slow but good answer still arrives and is kept for the next
 * visit; bounded, so a hung request never stays open for the whole visit.
 */
export const CONTENT_ABORT_MS = 15_000;

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
  /** Settles when the fetch has finished (and kept a good answer). Never rejects. */
  refresh: Promise<void>;
}

const silent = () => {};
const isShape = (v: unknown): boolean =>
  v !== null && typeof v === "object" && Array.isArray((v as Record<string, unknown>).projects) && Array.isArray((v as Record<string, unknown>).career);

type Fresh = { body: unknown } | { failed: string };

/** GET /content. A 200 of the right shape with a valid row is kept as the last good payload. */
async function fetchContent(d: LoaderDeps): Promise<Fresh> {
  const ctrl = new AbortController();
  void d.delay(CONTENT_ABORT_MS).then(() => ctrl.abort(), () => ctrl.abort());
  try {
    const res = await d.fetch(`${d.base}/content`, { signal: ctrl.signal });
    if (!res.ok) return { failed: `HTTP ${res.status}` };
    const text = await res.text();
    const body: unknown = JSON.parse(text);
    if (!isShape(body)) return { failed: "not a { projects, career } object" };
    if (resolveContent(body, BUNDLED_CONTENT, silent).usable) {
      try { d.storage.set(text); } catch { /* storage blocked: nothing kept, still used now */ }
    }
    return { body };
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }
}

function lastGood(d: LoaderDeps): Content | null {
  try {
    const s = d.storage.get();
    if (s === null) return null;
    const r = resolveContent(JSON.parse(s), BUNDLED_CONTENT, d.warn);
    return r.usable ? r.content : null;
  } catch {
    return null;
  }
}

const TIMED_OUT = Symbol("timed out");

export async function loadContent(d: LoaderDeps): Promise<Loaded> {
  if (!d.base) return { content: BUNDLED_CONTENT, source: "bundled", refresh: Promise.resolve() };
  let refresh: Promise<void> = Promise.resolve();
  try {
    const fresh = fetchContent(d);
    refresh = fresh.then(() => undefined);
    const first = await Promise.race([fresh, d.delay(CONTENT_TIMEOUT_MS).then((): typeof TIMED_OUT => TIMED_OUT)]);
    if (first === TIMED_OUT) {
      d.warn(`content: /content took over ${CONTENT_TIMEOUT_MS} ms; falling back (a good late answer is kept for the next visit)`);
    } else if ("failed" in first) {
      d.warn(`content: /content failed (${first.failed}); falling back`);
    } else {
      const r = resolveContent(first.body, BUNDLED_CONTENT, d.warn);
      if (r.usable) return { content: r.content, source: "api", refresh };
      d.warn("content: /content had no valid rows; falling back");
    }
  } catch {
    /* the race itself broke (a fetch that throws at once, a broken timer): fall back the same way */
    d.warn("content: loading /content broke; falling back");
  }
  // lastGood never throws: the last good payload, else the bundled data.
  const cached = lastGood(d);
  if (cached) return { content: cached, source: "cache", refresh };
  return { content: BUNDLED_CONTENT, source: "bundled", refresh };
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
