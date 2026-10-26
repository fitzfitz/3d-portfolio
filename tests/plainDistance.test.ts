import { describe, it, expect, beforeEach } from "vitest";
import { setScannable, nearestScannable, clearScannables } from "../src/utils/scannables";
import { convoySighted } from "../src/utils/logbook";
import { stepGravity, wellAccel, type Well } from "../src/utils/gravityWell";

describe("plain distances: no seam at the old ±250 boundary", () => {
  beforeEach(() => clearScannables());

  it("nearestScannable across the old seam reports the full distance", () => {
    setScannable("t", -245, 0, 0, "T", 0);
    const hit = nearestScannable(245, 0, 0, 1000);
    expect(hit?.dist).toBeCloseTo(490);
  });

  it("convoySighted does not see across the old seam", () => {
    expect(convoySighted({ x: 240, y: 0, z: 0 }, [{ x: -240, y: 0, z: 0 }])).toBe(false);
  });

  it("a well on the far side exerts no pull", () => {
    const w: Well = { x: -245, y: 0, z: 0, g: 3000, radius: 40, rMin: 4 };
    const G = { x: 0, y: 0, z: 0 };
    stepGravity(G, { x: 245, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, [w], 1, "free", 0.016);
    expect(Math.hypot(G.x, G.y, G.z)).toBe(0);
    expect(wellAccel(490, w)).toBe(0);
  });
});
