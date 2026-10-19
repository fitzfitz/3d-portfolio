import { describe, it, expect } from "vitest";
import { PORTAL_LOCK_R, PORTAL_RETAIN_R, PORTAL_ORBIT_R, PORTAL_ZONE_R } from "../src/constants";
import { DESTINATIONS, escapeR } from "../src/data/destinations";

// Only the destinations dock. Planets lost their lock with the project
// probes (spec §4.4), and their lock-geometry rows went with it.
describe("orbit-lock geometry invariants", () => {
  it("portal orbit ring sits safely inside its retention radius", () => {
    expect(PORTAL_ORBIT_R).toBeLessThan(PORTAL_RETAIN_R - 0.2);
    expect(PORTAL_LOCK_R).toBeLessThan(PORTAL_ORBIT_R);
    expect(PORTAL_ZONE_R).toBeLessThan(PORTAL_RETAIN_R); // zone must also be retained while locked (see SpacePlanets)
  });
});

describe("destination orbit-lock invariants", () => {
  it("every destination's orbit sits inside its retention radius, and a jump lands inside its lock", () => {
    for (const d of DESTINATIONS) {
      expect(d.orbitR, d.id).toBeLessThan(d.retainR - 0.2);
      expect(d.lockR, d.id).toBeLessThan(d.orbitR);
      expect(d.zoneR, d.id).toBeLessThan(d.retainR); // zone must also be retained while locked
      expect(d.jumpR, d.id).toBeLessThan(d.lockR); // a jump docks on arrival
      expect(escapeR(d), d.id).toBeGreaterThan(d.retainR); // a break is not re-retained
    }
  });
});
