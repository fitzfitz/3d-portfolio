/**
 * Where the low-perf setting is read: spaceStore registers its `isLowPerf`
 * when it is created. Until then it is the store's own starting value,
 * false. Import-free on purpose: main.tsx starts the asset packs (which ask
 * hiResChoice for their tier) before the store exists, since the store's
 * module reads the projects and career, which settle first (spec
 * 2026-10-23-dynamic-content, the owner's loading call; tests/bootOrder.test.ts).
 */
let lowPerf: () => boolean = () => false;
export function setLowPerfSource(read: () => boolean): void {
  lowPerf = read;
}

/**
 * Whether this device draws the bodies' 4096 maps (the `_4k` variants of
 * Mercury's, Earth's and Mars's NASA/USGS maps, solarSystem.ts `mapHiRes`).
 * Desktop only: a 4096 map costs ~45MB of GPU memory, which is the bigger
 * risk on touch devices. SolarBodies decides once at mount, and the asset
 * pack loader (utils/assetPack.ts) asks the same question to pick the HD or
 * SD texture pack, so the two always agree.
 */
export const prefersHiResMaps = (): boolean =>
  !lowPerf() && window.matchMedia?.("(pointer: fine)").matches === true;

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
