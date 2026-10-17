import { describe, it, expect } from "vitest";
import { AU } from "../src/constants";
import { WORLD_TYPES } from "../src/data/worldTypes";
import { WORLDS, WORLD_IDS, WORLD_COUNT, isWorld } from "../src/data/worlds";

// SYSTEM_RADIUS once Task 3 lands (480); import it then.
const SYSTEM_RADIUS_FOR_C = 480; // Task 3

describe("the world-type law", () => {
  it("a Venus-type cannot exist past ~1.1 S⊕", () => {
    expect(WORLD_TYPES["venus-type"].canExistAt(1.2 * AU, 0.77).ok).toBe(false);
  });
  it("a Venus-type can exist inside the runaway-greenhouse limit", () => {
    expect(WORLD_TYPES["venus-type"].canExistAt(0.72 * AU, 0.77).ok).toBe(true);
  });
  it("a nitrogen-ice dwarf cannot exist inside the system edge", () => {
    expect(WORLD_TYPES["nitrogen-dwarf"].canExistAt(SYSTEM_RADIUS_FOR_C, 0.6).ok).toBe(false);
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
  it.each(WORLDS.map((w) => [w.id, w] as const))("%s can exist where it orbits", (_, w) => {
    const v = WORLD_TYPES[w.type].canExistAt(w.orbit.radius, w.bondAlbedo);
    expect(v.ok, v.reason).toBe(true);
  });
});

describe("the world roster", () => {
  it("has the five final ids, in WORLD_IDS order", () => {
    expect(WORLD_COUNT).toBe(5);
    expect(WORLDS.map((w) => w.id)).toEqual([...WORLD_IDS]);
    expect(WORLD_IDS).toEqual(["w-rock", "w-ringed", "w-tilted", "w-blue", "w-dwarf"]);
  });
  it("isWorld accepts world ids only", () => {
    for (const id of WORLD_IDS) expect(isWorld(id)).toBe(true);
    expect(isWorld("ruangrapi")).toBe(false);
    expect(isWorld("w-venus")).toBe(false);
  });
  it("carries the roster's sizes, albedos, tilts and types", () => {
    const row = (id: string) => WORLDS.find((w) => w.id === id)!;
    expect(row("w-rock")).toMatchObject({ namesake: "Mercury", type: "airless-rock", size: 5.7, bondAlbedo: 0.068, axialTiltDeg: 0.03 });
    expect(row("w-ringed")).toMatchObject({ namesake: "Saturn", type: "ringed-giant", size: 15, flattening: 0.1, bondAlbedo: 0.342, axialTiltDeg: 26.7 });
    expect(row("w-tilted")).toMatchObject({ namesake: "Uranus", type: "ice-giant", size: 13.5, bondAlbedo: 0.3, axialTiltDeg: 97.8 });
    expect(row("w-blue")).toMatchObject({ namesake: "Neptune", type: "ice-giant", size: 13, bondAlbedo: 0.29, axialTiltDeg: 28.3 });
    expect(row("w-dwarf")).toMatchObject({ namesake: "Ceres", type: "salt-dwarf", size: 3.5, bondAlbedo: 0.034, axialTiltDeg: 4 });
  });
  it("orbits are circular and follow the placement preferences", () => {
    const r = (id: string) => WORLDS.find((w) => w.id === id)!.orbit.radius;
    const radii = WORLDS.map((w) => w.orbit.radius);
    expect(r("w-rock")).toBe(Math.min(...radii));
    const outer = [...WORLDS].sort((a, b) => b.orbit.radius - a.orbit.radius).slice(0, 2).map((w) => w.type);
    expect(outer).toEqual(["ice-giant", "ice-giant"]);
    expect(Math.abs(r("w-dwarf") - 2.77 * AU)).toBeLessThanOrEqual(25);
  });
  it("each world names its texture and gives one locating hint", () => {
    for (const w of WORLDS) {
      expect(w.map).toBe(w.id);
      expect(w.hint.length).toBeGreaterThan(0);
    }
  });
});
