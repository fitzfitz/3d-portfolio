import { describe, it, expect } from "vitest";
import { JELLY_PATH, JELLY_NEAR_T } from "../src/data/jellyfishPath";

describe("jellyfish path", () => {
  it("NEAR_T is a genuine near pass (within 80 units of the play-area center)", () => {
    const p = JELLY_PATH.getPointAt(JELLY_NEAR_T);
    expect(Math.hypot(p.x, p.z)).toBeLessThan(80);
  });
  it("most of the loop stays far away (rare-sighting behavior)", () => {
    let far = 0;
    for (let i = 0; i < 100; i++) {
      const p = JELLY_PATH.getPointAt(i / 100);
      if (Math.hypot(p.x, p.z) > 150) far++;
    }
    expect(far).toBeGreaterThan(80);
  });
});
