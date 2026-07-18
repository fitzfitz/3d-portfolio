import { describe, it, expect } from "vitest";
import { ChatterScheduler, type ChatterPools } from "../src/utils/chatterScheduler";

const pools: ChatterPools = {
  deepSpace: ["ds-1", "ds-2", "ds-3"],
  zones: { saas: ["saas-1", "saas-2"], video: ["video-1"] },
  warp: ["warp-1", "warp-2"],
  wrap: ["wrap-1"],
  comet: ["comet-1", "comet-2"],
  altitude: ["alt-1", "alt-2"],
};

describe("ChatterScheduler", () => {
  it("picks from the zone pool when a known zone is given", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("zone", "saas")).toBe("saas-1");
  });
  it("falls back to deepSpace for unknown zones", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("zone", "nope")).toBe("ds-1");
  });
  it("never repeats the immediately-previous line when the pool has 2+ lines", () => {
    const s = new ChatterScheduler(pools, () => 0);
    const first = s.pick("ambient");
    const second = s.pick("ambient");
    expect(second).not.toBe(first);
  });
  it("allows repeats for single-line pools", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("wrap")).toBe("wrap-1");
    expect(s.pick("wrap")).toBe("wrap-1");
  });
  it("nextDelayMs stays within [18000, 35000]", () => {
    const lo = new ChatterScheduler(pools, () => 0);
    const hi = new ChatterScheduler(pools, () => 0.9999999);
    expect(lo.nextDelayMs()).toBe(18000);
    expect(hi.nextDelayMs()).toBeLessThanOrEqual(35000);
  });
  it("picks from the comet pool for comet events", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("comet")).toBe("comet-1");
  });
  it("picks from the altitude pool", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("altitude")).toBe("alt-1");
  });
});
