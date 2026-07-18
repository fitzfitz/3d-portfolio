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
