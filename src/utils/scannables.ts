export interface Scannable { x: number; y: number; z: number; label: string }
const registry = new Map<string, Scannable>();

export function setScannable(id: string, x: number, y: number, z: number, label: string) {
  const s = registry.get(id);
  if (s) { s.x = x; s.y = y; s.z = z; } else registry.set(id, { x, y, z, label });
}
export function removeScannable(id: string) { registry.delete(id); }
export function nearestScannable(x: number, y: number, z: number, range: number) {
  let best: { id: string; label: string; dist: number } | null = null;
  for (const [id, s] of registry) {
    const d = Math.hypot(s.x - x, s.y - y, s.z - z);
    if (d < range && (!best || d < best.dist)) best = { id, label: s.label, dist: d };
  }
  return best;
}
export function clearScannables() { registry.clear(); } // tests
