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
 * Variants that ship GPU-compressed as KTX2 (scripts/textures/encode_ktx2.mjs
 * KTX2_MAPS): ~11 MB of GPU memory for a 4096 map instead of ~45. Earth's
 * 4096 map first, the phase 4 pilot of the memory budget.
 */
export const KTX2_VARIANTS: ReadonlySet<string> = new Set(["earth_4k"]);

let choice: boolean | null = null;

/**
 * prefersHiResMaps()'s first answer, kept for the page's lifetime. The asset
 * pack loader picks its texture tier from it before the canvas mounts, and
 * SolarBodies reads it at mount; a perf decline in between must not make the
 * bodies ask for the tier this page never downloaded.
 */
export const hiResChoice = (): boolean => (choice ??= prefersHiResMaps());
