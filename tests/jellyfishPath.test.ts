import { describe, it, expect } from "vitest";
import { JELLY_PATH, JELLY_NEAR_T } from "../src/data/jellyfishPath";

describe("jellyfish path", () => {
  it("NEAR_T is a genuine near pass (within 80 units of the play-area center, 3D)", () => {
    const p = JELLY_PATH.getPointAt(JELLY_NEAR_T);
    expect(p.length()).toBeLessThan(80);
  });
  it("NEAR_T is the true closest approach (no sampled point is meaningfully closer)", () => {
    const near = JELLY_PATH.getPointAt(JELLY_NEAR_T).length();
    for (let i = 0; i < 500; i++) {
      expect(JELLY_PATH.getPointAt(i / 500).length()).toBeGreaterThan(near - 2);
    }
  });
  it("most of the loop stays far away (rare-sighting behavior)", () => {
    let far = 0;
    for (let i = 0; i < 100; i++) {
      if (JELLY_PATH.getPointAt(i / 100).length() > 150) far++;
    }
    expect(far).toBeGreaterThan(70);
  });
});
