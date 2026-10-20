import { describe, it, expect } from "vitest";
import { AU } from "../src/constants";
import { WORLD_TYPES, type WorldTypeId } from "../src/data/worldTypes";
import { bodyById } from "../src/data/solarSystem";
import type { BodyId } from "../src/data/bodyIds";
import { orbitShape, JD_J2000 } from "../src/utils/ephemeris";

describe("the world-type law", () => {
  it("a Venus-type cannot exist past ~1.1 S⊕", () => {
    expect(WORLD_TYPES["venus-type"].canExistAt(1.2 * AU, 0.77).ok).toBe(false);
  });
  it("a Venus-type can exist inside the runaway-greenhouse limit", () => {
    expect(WORLD_TYPES["venus-type"].canExistAt(0.72 * AU, 0.77).ok).toBe(true);
  });
  // Was "inside the system edge" (480): the edge is now past Neptune (§6.1),
  // where a Pluto-type can hold its nitrogen ice.
  it("a nitrogen-ice dwarf cannot exist inside Saturn's orbit, and can at Pluto's", () => {
    expect(WORLD_TYPES["nitrogen-dwarf"].canExistAt(9.5 * AU, 0.6).ok).toBe(false);
    expect(WORLD_TYPES["nitrogen-dwarf"].canExistAt(39.5 * AU, 0.6).ok).toBe(true);
  });
  it("water-ice rings and a Ceres-like dwarf need cold orbits", () => {
    expect(WORLD_TYPES["ringed-giant"].canExistAt(AU, 0.342).ok).toBe(false);
    expect(WORLD_TYPES["salt-dwarf"].canExistAt(AU, 0.034).ok).toBe(false);
  });
  it("every verdict gives a reason", () => {
    for (const t of Object.values(WORLD_TYPES)) {
      expect(t.canExistAt(AU, 0.3).reason.length).toBeGreaterThan(0);
      expect(t.canExistAt(10 * AU, 0.3).reason.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The law holds for the real bodies its types are modelled on, all the way
 * round their orbits (perihelion to aphelion), with their real Bond albedos.
 */
const TYPED: readonly [BodyId, WorldTypeId][] = [
  ["mercury", "airless-rock"], ["venus", "venus-type"], ["ceres", "salt-dwarf"],
  ["saturn", "ringed-giant"], ["uranus", "ice-giant"], ["neptune", "ice-giant"],
];
describe("the real bodies obey it", () => {
  it.each(TYPED)("%s can exist as a %s from perihelion to aphelion", (id, type) => {
    const b = bodyById(id);
    const { a, e } = orbitShape(b.orbit.el, JD_J2000);
    for (const r of [a * (1 - e), a, a * (1 + e)]) {
      const v = WORLD_TYPES[type].canExistAt(r * AU, b.bondAlbedo);
      expect(v.ok, `${id} at ${r.toFixed(2)} AU: ${v.reason}`).toBe(true);
    }
  });
});
