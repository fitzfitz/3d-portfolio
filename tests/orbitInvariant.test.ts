import { describe, it, expect } from "vitest";
import {
  LOCK_ENGAGE_FACTOR, LOCK_RETAIN_FACTOR, ORBIT_RADIUS_FACTOR, ZONE_FACTOR,
  PORTAL_LOCK_R, PORTAL_RETAIN_R, PORTAL_ORBIT_R, PORTAL_ZONE_R,
} from "../src/constants";

describe("orbit-lock geometry invariants", () => {
  it("planet orbit ring sits safely inside the retention radius", () => {
    expect(ORBIT_RADIUS_FACTOR).toBeLessThan(LOCK_RETAIN_FACTOR - 0.2);
    expect(LOCK_ENGAGE_FACTOR).toBeLessThan(ORBIT_RADIUS_FACTOR);
    expect(LOCK_RETAIN_FACTOR).toBeLessThanOrEqual(ZONE_FACTOR + 0.2);
  });
  it("portal orbit ring sits safely inside its retention radius", () => {
    expect(PORTAL_ORBIT_R).toBeLessThan(PORTAL_RETAIN_R - 0.2);
    expect(PORTAL_LOCK_R).toBeLessThan(PORTAL_ORBIT_R);
    expect(PORTAL_ZONE_R).toBeLessThan(PORTAL_RETAIN_R); // zone must also be retained while locked (see SpacePlanets)
  });
});
