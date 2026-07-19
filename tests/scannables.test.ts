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
  it("sees targets across the wrap seam on any axis", () => {
    // ship at x=249, target at x=-249: 2 apart through the seam
    setScannable("seam", -249, 0, 0, "SEAM");
    expect(nearestScannable(249, 0, 0, 22)?.id).toBe("seam");
    clearScannables();
    // vertical seam
    setScannable("vseam", 0, -249, 0, "VSEAM");
    expect(nearestScannable(0, 249, 0, 22)?.id).toBe("vseam");
  });
});
