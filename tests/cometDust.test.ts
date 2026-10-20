import { describe, it, expect } from "vitest";
import { COMET_ELEMENTS } from "../src/data/smallBodyField";
import { orbitWorldPosition } from "../src/utils/beltRocks";
import { ORRERY_TEST_JD } from "../src/utils/orreryClock";
import { dustEmitBack, VISITOR_DUST_AGE } from "../src/utils/cometDust";

describe("dustEmitBack", () => {
  it("is the full age for an orbiting comet", () => {
    expect(dustEmitBack(8, false)).toBe(8);
  });
  it("compresses only the visitor's emission history", () => {
    expect(dustEmitBack(8, true)).toBeCloseTo(8 * VISITOR_DUST_AGE);
  });
});


describe("the real comets in the scene", () => {
  it.each(COMET_ELEMENTS.map((el, i) => [i, el] as const))("comet %i passes its SBDB perihelion distance and aphelion", (_, el) => {
    const periodDays = 360 / el.nDegPerDay;
    let min = Infinity, max = 0;
    const p = { x: 0, y: 0, z: 0 };
    for (let k = 0; k <= 4000; k++) {
      orbitWorldPosition(el, ORRERY_TEST_JD + (k / 4000) * periodDays, p);
      const r = Math.hypot(p.x, p.y, p.z);
      min = Math.min(min, r); max = Math.max(max, r);
    }
    expect(min / 115).toBeCloseTo(el.a * (1 - el.e), 2);
    expect(max / 115).toBeCloseTo(el.a * (1 + el.e), 2);
  });
});
