import { describe, it, expect } from "vitest";
import { dustEmitBack, VISITOR_DUST_AGE } from "../src/utils/cometDust";

describe("dustEmitBack", () => {
  it("is the full age for an orbiting comet", () => {
    expect(dustEmitBack(8, false)).toBe(8);
  });
  it("compresses only the visitor's emission history", () => {
    expect(dustEmitBack(8, true)).toBeCloseTo(8 * VISITOR_DUST_AGE);
  });
});
