import { describe, it, expect } from "vitest";
import { lowPolyRock } from "../src/utils/lowPolyRock";

describe("lowPolyRock", () => {
  const g = lowPolyRock(2, 7);
  const pos = g.getAttribute("position");

  it("is a few dozen triangles, not a hero asteroid", () => {
    expect(pos.count / 3).toBe(80);
  });

  it("is watertight: every copy of a shared vertex moves identically", () => {
    // Bucket vertices by their pre-jitter direction (rounded); all copies in
    // a bucket must end up at the same displaced position.
    const ref = lowPolyRock(2, 7, 0).getAttribute("position");
    const seen = new Map<string, string>();
    for (let i = 0; i < pos.count; i++) {
      const key = [ref.getX(i), ref.getY(i), ref.getZ(i)].map((v) => v.toFixed(4)).join(",");
      const val = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => v.toFixed(5)).join(",");
      if (seen.has(key)) expect(seen.get(key)).toBe(val);
      else seen.set(key, val);
    }
  });

  it("stays roughly the requested size", () => {
    g.computeBoundingSphere();
    expect(g.boundingSphere!.radius).toBeGreaterThan(1.6);
    expect(g.boundingSphere!.radius).toBeLessThanOrEqual(2 * 1.22 + 1e-6); // radius × (1 + roughness)
  });

  it("is deterministic per seed and differs across seeds", () => {
    const a = lowPolyRock(1, 3).getAttribute("position").array;
    const b = lowPolyRock(1, 3).getAttribute("position").array;
    const c = lowPolyRock(1, 4).getAttribute("position").array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});
