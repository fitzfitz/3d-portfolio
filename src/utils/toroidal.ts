// Shortest distance on a 2D plane that wraps at ±bounds on both axes.
export function toroidalDistance(ax: number, az: number, bx: number, bz: number, bounds: number): number {
  const span = bounds * 2;
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  const wx = dx > bounds ? span - dx : dx;
  const wz = dz > bounds ? span - dz : dz;
  return Math.hypot(wx, wz);
}
