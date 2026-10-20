import type { Vec3 } from "../utils/reactions";

/**
 * Each moon's world centre, by moon id, mutable outside React like `bodies`
 * (kept out of `bodies`, whose keys are the bodies' wells). Empty: the old
 * fictional moons are gone and the nine real ones return in Task 14
 * (data/solarMoons.ts), whose renderer becomes this map's writer. The ship's
 * collider and camera keep-out read it (utils/worldCollide.ts SOLID_BODIES).
 */
export const moonCenters: Record<string, Vec3> = {};
