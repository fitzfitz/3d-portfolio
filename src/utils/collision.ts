const DAMP = 0.45;
const SKIN = 0.05;

/** Sphere collision: push out along the normal, reflect + damp velocity. Null = no hit. */
export function resolveCollision(
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  cx: number, cy: number, cz: number,
  radius: number
): { px: number; py: number; pz: number; vx: number; vy: number; vz: number } | null {
  let nx = px - cx, ny = py - cy, nz = pz - cz;
  const dist = Math.hypot(nx, ny, nz);
  if (dist >= radius) return null;
  if (dist < 1e-6) { nx = 1; ny = 0; nz = 0; } else { nx /= dist; ny /= dist; nz /= dist; }
  const vDotN = vx * nx + vy * ny + vz * nz;
  const rx = (vx - 2 * vDotN * nx) * DAMP;
  const ry = (vy - 2 * vDotN * ny) * DAMP;
  const rz = (vz - 2 * vDotN * nz) * DAMP;
  const out = radius + SKIN;
  return { px: cx + nx * out, py: cy + ny * out, pz: cz + nz * out, vx: rx, vy: ry, vz: rz };
}

/** A mutable point or velocity (THREE.Vector3 fits). */
interface XYZ { x: number; y: number; z: number }
/** Sweeps per call: one clears every sphere the point was inside; more only for a push-out into a further one. */
const CLUSTER_PASSES = 4;
/** Within this of a sphere's surface the ship is touching it, for the slide (u): a few skins, so the next frame's step can't reach it. */
const CONTACT = 0.3;

/**
 * Collision against spheres that overlap (the Nest's rock shell), in place,
 * allocation-free. resolveCollision's first-hit push-out can land inside a
 * neighbour and ping-pong from frame to frame; here each pass takes every
 * sphere the point is inside together: it moves along the sum of their
 * normals to where that ray leaves the last of them (+ SKIN), so it ends
 * outside all of them, and reflects (damped, as resolveCollision) only
 * velocity heading in along that direction. A push into a further sphere is
 * taken by the next pass, up to CLUSTER_PASSES. Then any velocity still
 * heading into a sphere it touches is dropped (a slide), so a crease takes
 * one hit, not a rattle. True if anything was hit: one impact for the caller.
 */
export function resolveCluster(p: XYZ, v: XYZ, spheres: readonly { x: number; y: number; z: number; r: number }[]): boolean {
  let hit = false;
  for (let pass = 0; pass < CLUSTER_PASSES; pass++) {
    // The summed outward normal of every sphere the point is inside.
    let dx = 0, dy = 0, dz = 0, n = 0, fx = 1, fy = 0, fz = 0;
    for (let i = 0; i < spheres.length; i++) {
      const c = spheres[i];
      const ox = p.x - c.x, oy = p.y - c.y, oz = p.z - c.z;
      const l = Math.hypot(ox, oy, oz);
      if (l >= c.r) continue;
      const ux = l < 1e-6 ? 1 : ox / l, uy = l < 1e-6 ? 0 : oy / l, uz = l < 1e-6 ? 0 : oz / l;
      if (n === 0) { fx = ux; fy = uy; fz = uz; }
      dx += ux; dy += uy; dz += uz; n++;
    }
    if (n === 0) break;
    hit = true;
    let dl = Math.hypot(dx, dy, dz);
    // Opposite normals cancel (dead between two centres): leave by the first.
    if (dl < 1e-6) { dx = fx; dy = fy; dz = fz; dl = 1; }
    dx /= dl; dy /= dl; dz /= dl;
    // The ray p + t·d leaves each such sphere (radius + SKIN) once; past the last exit it is outside them all.
    let t = 0;
    for (let i = 0; i < spheres.length; i++) {
      const c = spheres[i];
      const ox = p.x - c.x, oy = p.y - c.y, oz = p.z - c.z;
      if (Math.hypot(ox, oy, oz) >= c.r) continue;
      const b = ox * dx + oy * dy + oz * dz;
      const R = c.r + SKIN;
      const exit = -b + Math.sqrt(b * b - (ox * ox + oy * oy + oz * oz - R * R));
      if (exit > t) t = exit;
    }
    p.x += dx * t; p.y += dy * t; p.z += dz * t;
    const vn = v.x * dx + v.y * dy + v.z * dz;
    if (vn < 0) {
      v.x = (v.x - 2 * vn * dx) * DAMP; v.y = (v.y - 2 * vn * dy) * DAMP; v.z = (v.z - 2 * vn * dz) * DAMP;
    }
  }
  if (!hit) return false;
  // In a crease the bounce off one sphere can head straight into the next,
  // a fresh hit every frame (a ball rattling in a groove). Slide instead:
  // drop the velocity heading into any sphere the ship now touches.
  for (let pass = 0; pass < CLUSTER_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < spheres.length; i++) {
      const c = spheres[i];
      const ox = p.x - c.x, oy = p.y - c.y, oz = p.z - c.z;
      const l = Math.hypot(ox, oy, oz);
      if (l >= c.r + CONTACT || l < 1e-6) continue;
      const vn = (v.x * ox + v.y * oy + v.z * oz) / l;
      if (vn >= 0) continue;
      v.x -= vn * ox / l; v.y -= vn * oy / l; v.z -= vn * oz / l;
      changed = true;
    }
    if (!changed) return true;
  }
  // Still heading into one after the passes (alternate slides between two
  // contacts converge only slowly): wedged in the crease, the ship stops.
  for (let i = 0; i < spheres.length; i++) {
    const c = spheres[i];
    const ox = p.x - c.x, oy = p.y - c.y, oz = p.z - c.z;
    const l = Math.hypot(ox, oy, oz);
    if (l < c.r + CONTACT && v.x * ox + v.y * oy + v.z * oz < 0) { v.x = 0; v.y = 0; v.z = 0; break; }
  }
  return true;
}
