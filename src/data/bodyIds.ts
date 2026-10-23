/**
 * The nine real bodies' ids. Import-free on purpose: the Worker ships this
 * file, so it must not drag app modules into the bundle.
 */
export const BODY_IDS = ["mercury", "venus", "earth", "mars", "ceres", "jupiter", "saturn", "uranus", "neptune"] as const;
export type BodyId = (typeof BODY_IDS)[number];

export const isBodyId = (id: string): id is BodyId => (BODY_IDS as readonly string[]).includes(id);

/** The nine major moons' ids (data/solarMoons.ts re-exports them). Here so import-free readers (the content validator) can use them. */
export const MOON_IDS = ["moon", "phobos", "deimos", "io", "europa", "ganymede", "callisto", "titan", "triton"] as const;

/** The five fictional worlds' ids (stored progress, beacons) and the real body each became. */
export const LEGACY_WORLD_TO_BODY: Readonly<Record<"w-rock" | "w-ringed" | "w-tilted" | "w-blue" | "w-dwarf", BodyId>> = {
  "w-rock": "mercury",
  "w-ringed": "saturn",
  "w-tilted": "uranus",
  "w-blue": "neptune",
  "w-dwarf": "ceres",
};

/** How many fictional bodies the old chart counted (three planets stay probes; five worlds). */
export const LEGACY_CHART_TOTAL = 5;
