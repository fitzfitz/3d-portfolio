import { describe, it, expect } from "vitest";
import { PROBES } from "../src/data/probes";
import {
  LANDMARKS, JELLY_POINTS, JELLY_KEEP_RADIUS, landmarkMargin, landmarkMarginNamed, worstRule, deepSpaceGap, sweptOrbit, DEEP_SPACE_MIN, clearanceReport, type Vec3,
} from "./helpers/solarClearance";
import { DEEP_SPACE_POINT } from "./e2e/deepSpacePoint.mjs";
import { HAZE_START } from "../src/utils/edgeHaze";
import { eclipticToWorld } from "../src/utils/ephemeris";

describe("sweptOrbit", () => {
  it("starts at perihelion and covers the ellipse (world frame, y up)", () => {
    const pts = sweptOrbit({ a: 2, e: 0.5, i: 0, node: 0, argPeri: 0 }, 4);
    const w = { x: 0, y: 0, z: 0 };
    eclipticToWorld({ x: 1, y: 0, z: 0 }, w);
    expect(pts[0][0]).toBeCloseTo(w.x, 6); // perihelion at a(1-e) = 1 AU on +x
    expect(pts[2][0]).toBeCloseTo(-3 * w.x, 6); // aphelion at a(1+e) = 3 AU on -x
    expect(pts[0][1]).toBeCloseTo(0, 9);
  });
});

describe("fixed landmarks clear the real orbits, belt, Trojans and comets", () => {
  it.each(LANDMARKS.map((l) => [l.name, l] as const))("%s", (name, l) => {
    expect(landmarkMarginNamed(name, l.pos, l.radius), `${name} vs ${worstRule(l.pos, l.radius)}`).toBeGreaterThan(0);
  });

  // ~2.4 s alone, but 5.3 s once under the full suite's parallel load, past
  // vitest's 5 s default: hundreds of path points against every swept orbit.
  it("keeps the jellyfish swim path clear of every real orbit", () => {
    for (const p of JELLY_POINTS) {
      expect(landmarkMargin(p, JELLY_KEEP_RADIUS), `jelly ${p.join(",")} vs ${worstRule(p, JELLY_KEEP_RADIUS)}`).toBeGreaterThan(0);
    }
  }, 20_000);

  it("keeps the deep-space point inside the edge haze", () => {
    expect(Math.hypot(...DEEP_SPACE_POINT)).toBeLessThan(HAZE_START);
  });

  it("keeps every probe spot within r 480", () => {
    for (const p of PROBES) for (const s of [p.home, ...p.remote]) {
      expect(Math.hypot(...s), p.id).toBeLessThanOrEqual(480);
    }
  });

  it("keeps the deep-space point 60 u from any swept orbit", () => {
    expect(deepSpaceGap(DEEP_SPACE_POINT as unknown as Vec3)).toBeGreaterThanOrEqual(DEEP_SPACE_MIN);
  });

  it("reports a margin per landmark", () => {
    const r = clearanceReport();
    expect(r.length).toBe(LANDMARKS.length);
    for (const row of r) expect(row.margin, row.name).toBeGreaterThan(0);
  });
});
