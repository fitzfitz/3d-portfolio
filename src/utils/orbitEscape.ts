export interface Vec3 { x: number; y: number; z: number }

/**
 * Where to put the ship when it breaks orbit: out along the centre->ship line
 * to `radius`, so it leaves the lock radius instead of idling inside it.
 * A ship already beyond `radius` stays put. If the ship sits exactly on the
 * centre there is no direction to push along, so it goes out along +X.
 */
export function escapePosition(ship: Vec3, center: Vec3, radius: number): Vec3 {
  const dx = ship.x - center.x, dy = ship.y - center.y, dz = ship.z - center.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist >= radius) return { x: ship.x, y: ship.y, z: ship.z };
  if (dist < 1e-6) return { x: center.x + radius, y: center.y, z: center.z };
  const k = radius / dist;
  return { x: center.x + dx * k, y: center.y + dy * k, z: center.z + dz * k };
}
