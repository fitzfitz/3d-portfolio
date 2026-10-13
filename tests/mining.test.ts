import { describe, it, expect, beforeEach } from "vitest";
import {
  registerRing, pebbleWorld, stepMining, tetherCount, isAbsorbed, regrowScale, addOre, oreReadout, resetMining,
  ORE_PER_CRYSTAL, ORE_FUEL, PEBBLE_REGROW_S, PEBBLE_GRAB_INTERVAL,
} from "../src/utils/mining";
import { beamState } from "../src/store/beamState";
import { FUEL_MAX, FUEL_PER_CRYSTAL } from "../src/utils/fuel";

/** One ring of `n` pebbles laid out along +z ahead of a ship at the origin looking +z. */
function lineOfPebbles(n: number, start = 4, gap = 0.5) {
  registerRing(0, n);
  const w = pebbleWorld(0);
  for (let i = 0; i < n; i++) { w[i * 3] = 0; w[i * 3 + 1] = 0; w[i * 3 + 2] = start + i * gap; }
  return w;
}
const ship = { x: 0, y: 0, z: 0 };

beforeEach(() => {
  resetMining();
  Object.assign(beamState, { active: true, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, ore: 0 });
  beamState.vel.x = 0; beamState.vel.y = 0; beamState.vel.z = 0;
});

describe("addOre", () => {
  it("adds 1/16 of a crystal per pebble and rolls the counter", () => {
    expect(ORE_FUEL).toBeCloseTo(FUEL_PER_CRYSTAL / 16);
    const r = addOre(50, 15, 2);
    expect(r.fuel).toBeCloseTo(50 + 2 * ORE_FUEL);
    expect(r.ore).toBe(1);
  });
  it("clamps at a full tank", () => {
    expect(addOre(FUEL_MAX - 0.5, 0, 3).fuel).toBe(FUEL_MAX);
  });
  it("reports how many whole crystals' worth this call completed", () => {
    expect(addOre(0, 14, 1).crystals).toBe(0);
    expect(addOre(0, 15, 1).crystals).toBe(1);
    expect(addOre(0, 15, 18).crystals).toBe(2);
  });
});

describe("oreReadout", () => {
  it("shows the completing pebble as 16/16, not 0/16", () => {
    expect(oreReadout(addOre(0, 15, 1).ore)).toBe(`ORE ${ORE_PER_CRYSTAL}/${ORE_PER_CRYSTAL}`);
  });
  it("shows a part-filled counter as is", () => {
    expect(oreReadout(addOre(0, 0, 1).ore)).toBe(`ORE 1/${ORE_PER_CRYSTAL}`);
    expect(oreReadout(15)).toBe(`ORE 15/${ORE_PER_CRYSTAL}`);
  });
});

describe("stepMining", () => {
  it("tethers at most 3 pebbles and pulls them in until absorbed", () => {
    lineOfPebbles(10);
    let absorbed = 0;
    for (let t = 0; t < 20; t += 1 / 60) {
      absorbed += stepMining(t, 1 / 60, ship);
      expect(tetherCount()).toBeLessThanOrEqual(3);
    }
    expect(absorbed).toBe(10);
  });
  it("hides an absorbed pebble, then regrows it after 90s", () => {
    lineOfPebbles(1);
    let t = 0;
    while (!isAbsorbed(0, 0, t) && t < 10) { stepMining(t, 1 / 60, ship); t += 1 / 60; }
    expect(isAbsorbed(0, 0, t)).toBe(true);
    expect(regrowScale(0, 0, t)).toBe(0);
    expect(isAbsorbed(0, 0, t + PEBBLE_REGROW_S + 0.01)).toBe(false);
    expect(regrowScale(0, 0, t + PEBBLE_REGROW_S + 1)).toBeGreaterThan(0);
    expect(regrowScale(0, 0, t + PEBBLE_REGROW_S + 3)).toBe(1);
  });
  it("needs at least 40s of beaming to fill an empty tank, even with endless pebbles beside the nose", () => {
    lineOfPebbles(200, 1.6, 0.01); // every pebble already almost at the nose
    let ore = 0, t = 0;
    const needed = Math.ceil(FUEL_MAX / ORE_FUEL); // 64
    while (ore < needed && t < 120) { ore += stepMining(t, 1 / 60, ship); t += 1 / 60; }
    expect(ore).toBeGreaterThanOrEqual(needed);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(PEBBLE_GRAB_INTERVAL * needed).toBeGreaterThanOrEqual(40);
  });
  it("drops every tether when the beam switches off", () => {
    lineOfPebbles(5, 10);
    stepMining(0, 1 / 60, ship);
    expect(tetherCount()).toBe(1);
    beamState.active = false;
    stepMining(1 / 60, 1 / 60, ship);
    expect(tetherCount()).toBe(0);
  });
  it("never grabs a pebble whose position was never written (undrawn)", () => {
    // Beam 10u behind the origin, looking at it: a phantom pebble left at
    // (0,0,0) would sit dead ahead in range and be tethered.
    registerRing(0, 4);
    beamState.oz = -10;
    const away = stepMining(0, 1 / 60, { x: 0, y: 0, z: -10 });
    expect(away).toBe(0);
    expect(tetherCount()).toBe(0);
  });
  it("ignores pebbles outside the cone", () => {
    registerRing(0, 1);
    const w = pebbleWorld(0);
    w[0] = 10; w[1] = 0; w[2] = 2; // ~79° off the nose
    stepMining(0, 1 / 60, ship);
    expect(tetherCount()).toBe(0);
  });
  it("makes 16 pebbles one crystal", () => {
    expect(ORE_PER_CRYSTAL).toBe(16);
  });
});
