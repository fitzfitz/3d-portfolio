import { useSpaceStore } from "../store/spaceStore";

/**
 * Whether this device draws the bodies' 4096 maps (the `_4k` variants of
 * Mercury's, Earth's and Mars's NASA/USGS maps, solarSystem.ts `mapHiRes`).
 * Desktop only: a 4096 map costs ~45MB of GPU memory, which is the bigger
 * risk on touch devices. SolarBodies decides once at mount, and the asset
 * pack loader (utils/assetPack.ts) asks the same question to pick the HD or
 * SD texture pack, so the two always agree.
 */
export const prefersHiResMaps = (): boolean =>
  !useSpaceStore.getState().isLowPerf && window.matchMedia?.("(pointer: fine)").matches === true;

/**
 * Maps that ship GPU-compressed as KTX2 (scripts/textures/encode_ktx2.mjs
 * KTX2_MAPS, the same names): every body and moon map but Saturn's ring
 * strip and Earth's clouds. An opaque 4096 map is ~5.6 MB on the GPU
 * instead of ~45.
 */
export const KTX2_VARIANTS: ReadonlySet<string> = new Set([
  "callisto", "ceres", "earth", "earth_4k", "earth_night", "europa", "ganymede", "io",
  "jupiter", "mars", "mars_4k", "mercury", "mercury_4k", "moon", "titan", "triton", "venus",
  "w-blue", "w-ringed", "w-tilted",
]);

/** The file extension a map ships with. */
export const mapExt = (variant: string) => (KTX2_VARIANTS.has(variant) ? "ktx2" : "webp");

let choice: boolean | null = null;

/**
 * prefersHiResMaps()'s first answer, kept for the page's lifetime. The asset
 * pack loader picks its texture tier from it before the canvas mounts, and
 * SolarBodies reads it at mount; a perf decline in between must not make the
 * bodies ask for the tier this page never downloaded.
 */
export const hiResChoice = (): boolean => (choice ??= prefersHiResMaps());
