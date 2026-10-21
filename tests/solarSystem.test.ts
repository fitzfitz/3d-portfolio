import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AU, SUN_RADIUS } from "../src/constants";
import { BODY_IDS, isBodyId, LEGACY_CHART_TOTAL, LEGACY_WORLD_TO_BODY } from "../src/data/bodyIds";
import { BODY_COUNT, BODY_REACH, bodyById, SOLAR_BODIES } from "../src/data/solarSystem";
import { orbitShape } from "../src/utils/ephemeris";
import { ORRERY_TEST_JD } from "../src/utils/orreryClock";
import { poleEcliptic } from "../src/utils/poles";

const deg = (r: number) => (r * 180) / Math.PI;

describe("roster", () => {
  it("is in BODY_IDS order", () => {
    expect(SOLAR_BODIES.map((b) => b.id)).toEqual([...BODY_IDS]);
    expect(BODY_COUNT).toBe(9);
    expect(bodyById("earth").name).toBe("EARTH");
  });
  it("Mercury clears the Sun at perihelion by 5.5 u", () => {
    const m = bodyById("mercury");
    const s = orbitShape(m.orbit.el, ORRERY_TEST_JD);
    expect(s.a * (1 - s.e) * AU - SUN_RADIUS - m.size).toBeGreaterThanOrEqual(5.5);
  });
  it("obliquity from the IAU pole matches NASA within 0.5 deg", () => {
    for (const b of SOLAR_BODIES) {
      const o = orbitShape(b.orbit.el, ORRERY_TEST_JD);
      const n = { x: Math.sin(o.i) * Math.sin(o.node), y: -Math.sin(o.i) * Math.cos(o.node), z: Math.cos(o.i) };
      const p = poleEcliptic(b.pole.raDeg, b.pole.decDeg);
      const ang = deg(Math.acos(Math.max(-1, Math.min(1, p.x * n.x + p.y * n.y + p.z * n.z))));
      const obl = b.rotationHours < 0 ? 180 - ang : ang;
      expect(Math.abs(obl - b.obliquityDeg), b.id).toBeLessThan(0.5);
    }
  });
  it("reach covers rings", () => {
    const r = Object.fromEntries(BODY_REACH.map((x) => [x.key, x]));
    expect(r.saturn.reach).toBeCloseTo(r.saturn.size * 2.27);
    expect(r.uranus.reach).toBeGreaterThan(r.uranus.size);
    expect(r.earth.reach).toBe(r.earth.size);
  });
  it("every body draws a real (or generated) map, none a tint; Venus is on the 0.177 rule", () => {
    for (const b of SOLAR_BODIES) expect(b.map, b.id).not.toBe("");
    const v = bodyById("venus");
    expect(v.map).toBe("venus");
    expect(Math.abs(v.texelMedianLinear / (0.177 * v.geometricAlbedo) - 1)).toBeLessThan(0.03);
  });
});

describe("ids", () => {
  it("isBodyId and legacy map", () => {
    expect(isBodyId("saturn")).toBe(true);
    expect(isBodyId("ruangrapi")).toBe(false);
    expect(Object.keys(LEGACY_WORLD_TO_BODY).sort()).toEqual(["w-blue", "w-dwarf", "w-ringed", "w-rock", "w-tilted"]);
    for (const v of Object.values(LEGACY_WORLD_TO_BODY)) expect(isBodyId(v)).toBe(true);
    expect(LEGACY_CHART_TOTAL).toBe(5);
  });
  it("bodyIds.ts has no imports", () => {
    const src = readFileSync(new URL("../src/data/bodyIds.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\bfrom\s+["']/);
  });
});
