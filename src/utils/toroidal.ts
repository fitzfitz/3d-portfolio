// Shortest distance on a 2D plane that wraps at ±bounds on both axes.
export function toroidalDistance(ax: number, az: number, bx: number, bz: number, bounds: number): number {
  const span = bounds * 2;
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  const wx = dx > bounds ? span - dx : dx;
  const wz = dz > bounds ? span - dz : dz;
  return Math.hypot(wx, wz);
}

/** Signed shortest delta from `from` to `to` on an axis wrapping at ±bounds. */
export function wrapDelta(from: number, to: number, bounds: number): number {
  const span = bounds * 2;
  let d = to - from;
  if (d > bounds) d -= span;
  else if (d < -bounds) d += span;
  return d;
}
