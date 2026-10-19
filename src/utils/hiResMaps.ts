import { useSpaceStore } from "../store/spaceStore";

/**
 * Whether this device draws the planets' 4096 maps (the `_4k` variants).
 * Desktop only: a 4096 map costs ~45MB of GPU memory, which is the bigger
 * risk on touch devices. SpacePlanets decides once at mount, and the asset
 * pack loader (utils/assetPack.ts) asks the same question to pick the HD or
 * SD texture pack, so the two always agree.
 */
export const prefersHiResMaps = (): boolean =>
  !useSpaceStore.getState().isLowPerf && window.matchMedia?.("(pointer: fine)").matches === true;
