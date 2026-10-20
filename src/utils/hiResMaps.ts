import { useSpaceStore } from "../store/spaceStore";

/**
 * Whether this device draws the planets' 4096 maps (the `_4k` variants).
 * Desktop only: a 4096 map costs ~45MB of GPU memory, which is the bigger
 * risk on touch devices. SolarBodies decides once at mount, and the asset
 * pack loader (utils/assetPack.ts) asks the same question to pick the HD or
 * SD texture pack, so the two always agree.
 */
export const prefersHiResMaps = (): boolean =>
  !useSpaceStore.getState().isLowPerf && window.matchMedia?.("(pointer: fine)").matches === true;

let choice: boolean | null = null;

/**
 * prefersHiResMaps()'s first answer, kept for the page's lifetime. The asset
 * pack loader picks its texture tier from it before the canvas mounts, and
 * SolarBodies reads it at mount; a perf decline in between must not make the
 * planets ask for the tier this page never downloaded.
 */
export const hiResChoice = (): boolean => (choice ??= prefersHiResMaps());
