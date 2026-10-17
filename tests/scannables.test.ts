import { describe, it, expect, beforeEach } from "vitest";
import { setScannable, nearestScannable, clearScannables } from "../src/utils/scannables";

describe("nearestScannable", () => {
  beforeEach(() => clearScannables());

  it("finds the nearest target in plain 3D", () => {
    setScannable("a", 10, 0, 0, "A");
    setScannable("b", 5, 0, 0, "B");
    expect(nearestScannable(0, 0, 0, 22)?.id).toBe("b");
  });
  it("returns null when nothing is in range", () => {
    setScannable("a", 100, 0, 0, "A");
    expect(nearestScannable(0, 0, 0, 22)).toBeNull();
  });
  it("does not see targets across the old seam on any axis", () => {
    setScannable("seam", -249, 0, 0, "SEAM");
    expect(nearestScannable(249, 0, 0, 22)).toBeNull();
    clearScannables();
    setScannable("vseam", 0, -249, 0, "VSEAM");
    expect(nearestScannable(0, 249, 0, 22)).toBeNull();
  });
  it("measures range from a body's surface, not its centre", () => {
    // A radius-16 planet 35 out: 19 from its surface, inside range 22.
    setScannable("planet", 35, 0, 0, "PLANET", 16);
    expect(nearestScannable(0, 0, 0, 22)?.id).toBe("planet");
    expect(nearestScannable(0, 0, 0, 22)?.dist).toBeCloseTo(19);
  });
  it("picks the nearer surface over the nearer centre", () => {
    setScannable("rock", 20, 0, 0, "ROCK");             // surface 20 away
    setScannable("planet", 30, 0, 0, "PLANET", 16);      // surface 14 away
    expect(nearestScannable(0, 0, 0, 22)?.id).toBe("planet");
  });
});

describe("planet scan window", () => {
  beforeEach(() => clearScannables());

  it("leaves room to scan a planet before orbit lock engages", async () => {
    const { planets, LOCK_ENGAGE_FACTOR } = await import("../src/constants");
    const { SCAN_RANGE } = await import("../src/utils/scannables");
    for (const p of planets) {
      setScannable(p.name, 0, 0, 0, p.name, p.size);
      // Just outside the lock radius, with a real margin to fly in.
      const d = p.size * LOCK_ENGAGE_FACTOR + 8;
      expect(nearestScannable(d, 0, 0, SCAN_RANGE)?.id, p.name).toBe(p.name);
      clearScannables();
    }
  });
});
