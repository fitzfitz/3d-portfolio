import type { Ecl } from "./ephemeris";

const D2R = Math.PI / 180;
/** Mean obliquity of the ecliptic at J2000 (deg). */
export const OBLIQUITY_J2000_DEG = 23.43928;

/** An IAU pole (J2000 equatorial RA/Dec, deg) as a unit vector in the J2000 ecliptic frame. */
export function poleEcliptic(raDeg: number, decDeg: number): Ecl {
  const ra = raDeg * D2R, dec = decDeg * D2R, eps = OBLIQUITY_J2000_DEG * D2R;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  return { x, y: y * Math.cos(eps) + z * Math.sin(eps), z: -y * Math.sin(eps) + z * Math.cos(eps) };
}
