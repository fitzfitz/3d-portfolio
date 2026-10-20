import type { FieldRock } from "../data/smallBodyField";
import { osculatingEcliptic, eclipticToWorld, type Ecl, type OsculatingElements } from "./ephemeris";
import type { Vec3 } from "./reactions";

const scratch: Ecl = { x: 0, y: 0, z: 0 };

/** World position of a Kepler orbit at Julian date `jd`, written into `out` (no allocation). */
export function cometWorldPosition(el: OsculatingElements, jd: number, out: Vec3): Vec3 {
  osculatingEcliptic(el, jd, scratch);
  return eclipticToWorld(scratch, out);
}

/** World position of a belt or Trojan rock at `jd`, written into `out`. */
export function beltRockPosition(rock: FieldRock, jd: number, out: Vec3): Vec3 {
  return cometWorldPosition(rock.el, jd, out);
}
