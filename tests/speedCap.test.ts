import { describe, it, expect } from "vitest";
import { cruiseCap } from "../src/utils/speedCap";

const MAX = 10.8, DRAG = 0.982;

describe("cruiseCap", () => {
  it("is the plain top speed at 60 fps, so the tuned flight is unchanged there", () => {
    expect(cruiseCap(MAX, DRAG, 1 / 60)).toBeCloseTo(MAX, 10);
  });
  it("ends every frame at the 60 fps cruise speed, at any frame rate", () => {
    for (const dt of [1 / 144, 1 / 120, 1 / 30, 1 / 20]) {
      expect(cruiseCap(MAX, DRAG, dt) * Math.pow(DRAG, dt * 60), `dt=${dt}`).toBeCloseTo(MAX * DRAG, 10);
    }
  });
});
