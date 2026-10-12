import type { Vec3 } from "./reactions";

/**
 * Circular inclined orbits around the origin (the sun).
 * Convention (matches three.js R_x / R_y and the ring-group nesting in
 * SpacePlanets): flat circle in XZ -> rotation.x = inclination -> rotation.y = node.
 */
export interface OrbitalElements {
  radius: number;
  /** rad/s */
  angularSpeed: number;
  /** rad, rotation about X applied to the flat circle */
  inclination: number;
  /** rad, ascending-node rotation about Y, applied after inclination */
  node: number;
  /** rad, starting angle along the circle */
  phase: number;
}

/** Writes into `out` when given (frame loops), otherwise allocates. */
export function orbitPosition(el: OrbitalElements, t: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const th = el.phase + t * el.angularSpeed;
  const x0 = el.radius * Math.cos(th);
  const z0 = el.radius * Math.sin(th);
  const ci = Math.cos(el.inclination), si = Math.sin(el.inclination);
  const y1 = -z0 * si;
  const z1 = z0 * ci;
  const cn = Math.cos(el.node), sn = Math.sin(el.node);
  out.x = x0 * cn + z1 * sn; out.y = y1; out.z = -x0 * sn + z1 * cn;
  return out;
}
