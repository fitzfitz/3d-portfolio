import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { atmosphereOf, SOLAR_MOONS } from "../src/data/solarMoons";
import { bodyById, SOLAR_BODIES } from "../src/data/solarSystem";
import { bodyCameraRadius, CAMERA_CLEARANCE, SOLID_BODIES } from "../src/utils/worldCollide";

/**
 * Atmosphere rims (real-solar-system spec §5.5, L27): one home for the data,
 * `look.atmosphere` on a body or a moon (Ruling R5), read through atmosphereOf.
 */

const hsl = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
const titan = SOLAR_MOONS.find((m) => m.id === "titan")!;

describe("which bodies wear a rim", () => {
  it("gives Earth, Venus, Mars, Titan, Uranus and Neptune a rim (and keeps the gas giants')", () => {
    for (const id of ["earth", "venus", "mars", "titan", "uranus", "neptune", "jupiter", "saturn"] as const) {
      const a = atmosphereOf(id);
      expect(a, id).toBeDefined();
      expect(a!.thickness, id).toBeGreaterThan(1);
      expect(a!.intensity, id).toBeGreaterThan(0);
    }
  });

  it("gives the airless bodies and moons none", () => {
    for (const id of ["mercury", "ceres", "moon", "phobos", "deimos", "io", "europa", "ganymede", "callisto", "triton"] as const) {
      expect(atmosphereOf(id), id).toBeUndefined();
    }
  });

  it("keeps the data in one home: look.atmosphere on the body or the moon (R5), no separate table", () => {
    expect(atmosphereOf("venus")).toBe(bodyById("venus").look.atmosphere);
    expect(atmosphereOf("titan")).toBe(titan.look?.atmosphere);
    expect(existsSync("src/data/planetAtmospheres.ts")).toBe(false);
  });
});

describe("the rims' colours", () => {
  it("wraps Titan in orange haze", () => {
    const c = hsl(titan.look!.atmosphere!.color);
    expect(c.h * 360).toBeGreaterThan(18);
    expect(c.h * 360).toBeLessThan(45);
    expect(c.s).toBeGreaterThan(0.45);
    // Titan's haze is deep: a thicker shell than Earth's.
    expect(titan.look!.atmosphere!.thickness).toBeGreaterThan(bodyById("earth").look.atmosphere!.thickness);
  });

  it("keeps Venus's rim a pale cream (not a saturated yellow that greens the dim disc), weaker than Earth's", () => {
    const v = bodyById("venus").look.atmosphere!;
    const c = hsl(v.color);
    expect(c.h * 360).toBeGreaterThan(35);
    expect(c.h * 360).toBeLessThan(55);
    expect(c.s).toBeLessThan(0.55);
    expect(c.l).toBeGreaterThan(0.8);
    expect(v.intensity).toBeLessThanOrEqual(0.5);
    // Its terminator band stays cream too: no sunset orange over a sulphuric-acid haze.
    expect(v.dusk).toBeDefined();
    const d = hsl(v.dusk!);
    expect(d.h * 360).toBeGreaterThan(30);
    expect(d.s).toBeLessThan(0.6);
  });

  it("keeps Earth blue with its sunset band, and every rim's dusk unchanged elsewhere", () => {
    expect(bodyById("earth").look.atmosphere!.color).toBe("#6aa8ff");
    expect(bodyById("earth").look.atmosphere!.dusk).toBe("#ff9a5a");
  });
});

describe("drawing the rims", () => {
  it("SolarBodies and SolarMoons both draw an Atmosphere where look.atmosphere is set, lit by the live sunlight", () => {
    const bodies = readFileSync("src/components/canvas/SolarBodies.tsx", "utf8");
    const moons = readFileSync("src/components/canvas/SolarMoons.tsx", "utf8");
    expect(bodies).toMatch(/<Atmosphere[^>]*liveSunlight/);
    expect(moons).toMatch(/look\?\.atmosphere/);
    expect(moons).toMatch(/<Atmosphere[^>]*planetPos=\{moonPositions\[[^\]]+\]\}[^>]*liveSunlight/);
  });

  it("keeps the camera outside Titan's haze shell, as outside a planet's", () => {
    const s = SOLID_BODIES.find((x) => x.id === "titan")!;
    expect(s.cameraR).toBeCloseTo(titan.size * titan.look!.atmosphere!.thickness + CAMERA_CLEARANCE, 12);
    for (const b of SOLAR_BODIES) expect(SOLID_BODIES.find((x) => x.id === b.id)!.cameraR).toBe(bodyCameraRadius(b));
  });
});
