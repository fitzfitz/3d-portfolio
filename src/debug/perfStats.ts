/**
 * Rolling frame-time window for the DEV perf overlay. A ring buffer rather
 * than a growing array: this is written every frame, so it must allocate
 * nothing after construction — the same discipline the flight loops follow.
 *
 * 240 samples is roughly four seconds at 60fps: long enough that p99 means
 * something, short enough that a hitch shows up while the visitor still
 * remembers causing it.
 */
const CAPACITY = 240;

export const perfStats = {
  frames: new Float32Array(CAPACITY),
  idx: 0,
  count: 0,
  /** Latest renderer.info values, written by PerfSampler. */
  calls: 0,
  triangles: 0,
  programs: 0,
  lights: 0,
};

/** Scratch array for percentile sorting — pre-allocated and reused so percentile() reads allocate nothing. */
const scratch = new Float32Array(CAPACITY);

export function pushFrame(ms: number): void {
  perfStats.frames[perfStats.idx] = ms;
  perfStats.idx = (perfStats.idx + 1) % CAPACITY;
  if (perfStats.count < CAPACITY) perfStats.count++;
}

export function percentile(p: number): number {
  const n = perfStats.count;
  if (n === 0) return 0;
  // Copy live samples into scratch without creating view objects
  for (let i = 0; i < n; i++) {
    scratch[i] = perfStats.frames[i];
  }
  // Fill tail with Infinity so dead samples sort to the end
  for (let i = n; i < CAPACITY; i++) {
    scratch[i] = Infinity;
  }
  scratch.sort();
  const clamped = Math.max(0, Math.min(100, p));
  const rank = Math.ceil((clamped / 100) * n) - 1;
  return scratch[Math.max(0, rank)];
}

export function resetStats(): void {
  perfStats.frames.fill(0);
  perfStats.idx = 0;
  perfStats.count = 0;
  perfStats.calls = 0;
  perfStats.triangles = 0;
  perfStats.programs = 0;
  perfStats.lights = 0;
}
