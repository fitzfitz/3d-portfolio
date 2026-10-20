import * as THREE from "three";
import { CLOSE_UP_HOURS_PER_SECOND } from "../data/solarMoons";
import type { SolarBody } from "../data/solarSystem";
import { eclipticToWorld } from "./ephemeris";
import { poleEcliptic } from "./poles";

/**
 * A body's spin (real-solar-system spec §5.4): the IAU north pole, fixed in
 * space (J2000 equatorial -> ecliptic via poles.ts, then the world frame), and
 * a turn about it on the close-up clock (1.2 game hours per second, the
 * moons'), so a day is rotationHours / 1.2 s. A negative rotationHours turns
 * the other way about the same pole (Venus, Uranus).
 */

const Y = new THREE.Vector3(0, 1, 0);
const scratch = { x: 0, y: 0, z: 0 };
const qAlign = new THREE.Quaternion();
const qTurn = new THREE.Quaternion();
const axis = new THREE.Vector3();

/** The pole as a unit vector in the world frame. */
export function poleWorld(b: SolarBody, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  eclipticToWorld(poleEcliptic(b.pole.raDeg, b.pole.decDeg), scratch);
  return out.set(scratch.x, scratch.y, scratch.z).normalize();
}

/** Local +Y onto the pole, then turned about it for `gameSeconds`. Writes and returns `out`; allocation-free. */
export function spinQuaternion(b: SolarBody, gameSeconds: number, out: THREE.Quaternion): THREE.Quaternion {
  poleWorld(b, axis);
  qAlign.setFromUnitVectors(Y, axis);
  const angle = (2 * Math.PI * gameSeconds * CLOSE_UP_HOURS_PER_SECOND) / b.rotationHours;
  qTurn.setFromAxisAngle(axis, angle);
  return out.copy(qTurn).multiply(qAlign);
}

/** Scale of the unit sphere: the polar (local Y) axis shortened by the flattening. */
export function meshScale(b: SolarBody): [number, number, number] {
  return [1, 1 - b.flattening, 1];
}
