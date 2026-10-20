import { describe, it, expect, beforeEach } from "vitest";
import { setScannable, nearestScannable, clearScannables } from "../src/utils/scannables";
import { convoySighted } from "../src/utils/logbook";
import { stepGravity, wellAccel, type Well } from "../src/utils/gravityWell";
import { randomCrystalPos, CRYSTAL_FIELD_RADIUS } from "../src/utils/crystalField";

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

  it("crystal spawns fill the CRYSTAL_FIELD_RADIUS ball", () => {
    let s = 12345;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    let beyond = false;
    for (let i = 0; i < 1000; i++) {
      const [x, y, z] = randomCrystalPos(rand, []);
      expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(CRYSTAL_FIELD_RADIUS);
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 250) beyond = true;
    }
    expect(beyond).toBe(true);
  });
});
