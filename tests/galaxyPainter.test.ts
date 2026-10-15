import { describe, it, expect, vi, afterEach } from "vitest";
import { planGalaxy, type GalaxyKind } from "../src/utils/galaxyPainter";

afterEach(() => vi.restoreAllMocks());

describe("planGalaxy", () => {
  it("is deterministic and never uses Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    expect(planGalaxy(11, "spiral", 255)).toEqual(planGalaxy(11, "spiral", 255));
    expect(spy).not.toHaveBeenCalled();
  });

  it("varies with the seed", () => {
    expect(planGalaxy(11, "spiral", 255).dots[0]).not.toEqual(planGalaxy(12, "spiral", 255).dots[0]);
  });

  it("keeps every dot and dust lane inside the texture's disc", () => {
    for (const kind of ["spiral", "inclined", "elliptical"] as GalaxyKind[]) {
      const g = planGalaxy(5, kind, 200);
      for (const d of [...g.dots, ...g.lanes]) expect(Math.hypot(d.x, d.y) + d.r, kind).toBeLessThanOrEqual(1);
    }
  });

  it("gives spirals 2-4 arms with dust lanes, and ellipticals neither", () => {
    const s = planGalaxy(3, "spiral", 255);
    expect(s.arms).toBeGreaterThanOrEqual(2);
    expect(s.arms).toBeLessThanOrEqual(4);
    expect(s.lanes.length).toBeGreaterThan(0);
    const e = planGalaxy(3, "elliptical", 255);
    expect(e.arms).toBe(0);
    expect(e.lanes).toHaveLength(0);
  });

  it("squashes inclined spirals and leaves face-on spirals round", () => {
    expect(planGalaxy(9, "spiral", 255).squash).toBe(1);
    expect(planGalaxy(9, "inclined", 255).squash).toBeLessThan(0.7);
  });
});
