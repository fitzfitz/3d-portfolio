/** The sun sits at the origin (spec §3). */
interface Point { x: number; y: number; z: number }
/** A sphere that can pass between the camera and the sun. */
export interface Occluder extends Point { r: number }

/**
 * Fraction of the sun's disc left uncovered by `bodies`, as seen from `cam`:
 * 1 is a clear sun, 0 fully hidden.
 *
 * Sun.tsx scales the lens glare and flare ghosts by this. Occlusion is decided
 * analytically here rather than by a depth test, which would let the sun's
 * disc show straight through a planet in front of it.
 *
 * Works in angles: each body covers a disc of angular radius asin(r/d). Partial
 * cover is a linear ramp across the sun's width, and a body smaller than the
 * sun can hide at most its own share of the disc's area. Cover from several
 * bodies compounds.
 */
export function sunVisibility(cam: Point, bodies: readonly Occluder[], sunRadius: number): number {
  const sx = -cam.x, sy = -cam.y, sz = -cam.z;
  const sunDist = Math.hypot(sx, sy, sz);
  if (sunDist <= sunRadius) return 1;
  const ux = sx / sunDist, uy = sy / sunDist, uz = sz / sunDist;
  const sunAng = Math.asin(sunRadius / sunDist);

  let visible = 1;
  for (const b of bodies) {
    const bx = b.x - cam.x, by = b.y - cam.y, bz = b.z - cam.z;
    const d = Math.hypot(bx, by, bz);
    if (d >= sunDist || d === 0) continue;
    const cos = (bx * ux + by * uy + bz * uz) / d;
    if (cos <= 0) continue; // behind the camera
    if (d <= b.r) return 0; // camera inside the body
    const bodyAng = Math.asin(b.r / d);
    const sep = Math.acos(Math.min(1, cos));
    let cover = Math.min(1, Math.max(0, (bodyAng + sunAng - sep) / (2 * sunAng)));
    if (bodyAng < sunAng) cover = Math.min(cover, (bodyAng / sunAng) ** 2);
    visible *= 1 - cover;
  }
  return visible;
}
