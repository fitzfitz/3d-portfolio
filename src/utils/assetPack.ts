import { hiResChoice } from "./hiResMaps";
import { createPackLoader, type PackLoader, type PackProgress, type PackSet } from "./packLoader";

/**
 * The page's asset packs, the way a Unity or Godot web build loads its data
 * files: a few downloads with a true percentage, kept in Cache Storage so a
 * return visit reads them from disk, then served to the 3D loaders as blob:
 * URLs through assetUrl().
 *
 * The build (vite.config.ts) splits public/models three ways: `common`
 * (everything the scene draws), `hd` (the bodies' 4096 maps) and `sd` (their
 * 2048 originals). A device downloads common plus the one texture tier it
 * draws (utils/hiResMaps.ts), never both. The loading itself is
 * utils/packLoader.ts.
 *
 * Only a production build has packs (VITE_ASSET_PACKS is set by the build
 * plugin). In dev and in the e2e harness there are none and assetUrl() keeps
 * returning the loose /models paths, which a build also still ships as the
 * fallback for anything a pack did not deliver.
 */
export type { PackLoader, PackProgress, PackSet, Tier } from "./packLoader";

// The page's loader, from the pack list the build plugin bakes in (a JSON string).
const RAW = import.meta.env.VITE_ASSET_PACKS as string | undefined;
const loader: PackLoader | null = (() => {
  if (!RAW) return null;
  const packs = JSON.parse(RAW) as PackSet;
  const base = new URL(import.meta.env.BASE_URL, location.href).href;
  return createPackLoader({
    packs,
    base,
    tier: () => (hiResChoice() ? "hd" : "sd"),
    caches: typeof caches === "undefined" ? null : caches,
  });
})();

export const HAS_ASSET_PACK = !!loader;
export const packProgress: PackProgress = loader?.progress ?? { loaded: 0, total: 0, fromCache: false, done: true };
export const packedUrl = (path: string): string | undefined => loader?.packedUrl(path);
export const onPackEntry = (fn: (path: string, url: string) => void): void => loader?.onEntry(fn);
/** The pack load this page started, if any; never starts one (see serviceWorker.ts). */
export const startedPackLoad = (): Promise<void> | null => loader?.started() ?? null;
/** Without packs: one settled promise for every call, since GlobalCanvas's PackGate use()s it. */
const NO_PACKS = Promise.resolve();
/** Resolves once this device's packs settle (at once when the build has none). Never rejects; the same promise every call. */
export const loadAssetPack = (): Promise<void> => loader?.load() ?? NO_PACKS;
