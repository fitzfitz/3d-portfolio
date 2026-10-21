import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { radarBlip, RADAR_RANGE } from "../src/utils/radarTransform";

describe("the radar shows all nine bodies always (R18)", () => {
  const src = (f: string) => readFileSync(join("src", f), "utf8");
  it("RadarMap draws every body rim-clamped: no charted gate, no range gate, no free blips", () => {
    const radar = src("components/layout/RadarMap.tsx");
    expect(radar).not.toMatch(/radarShowsWorld|worldVisibility|free/);
    expect(radar).toMatch(/for \(const sb of SOLAR_BODIES\)/);
    expect(src("utils/radarTransform.ts")).not.toMatch(/radarShowsWorld/);
  });
  it("a body at Neptune's distance sits on the rim, dimmed", () => {
    const rimR = 68, scale = rimR / RADAR_RANGE;
    const b = radarBlip(0, 3300, scale, rimR, true);
    expect(b.onRim).toBe(true);
    expect(Math.hypot(b.px, b.py)).toBeCloseTo(rimR - 3);
  });
});

describe("radarBlip: where a blip lands on the radar", () => {
  const rimR = 68, scale = rimR / RADAR_RANGE;

  it("a planet-like blip is pinned to the rim by its horizontal distance only, and dimmed there", () => {
    // Far away horizontally: on the rim.
    const far = radarBlip(0, 400, scale, rimR, true);
    expect(far.onRim).toBe(true);
    expect(Math.hypot(far.px, far.py)).toBeCloseTo(rimR - 3);
    // Horizontally close (whatever its height, e.g. a charted world 300 above): its true spot.
    const near = radarBlip(30, 40, scale, rimR, true);
    expect(near).toEqual({ px: 30 * scale, py: -40 * scale, onRim: false });
  });

  it("an unclamped blip keeps its true scaled spot", () => {
    // 215 u horizontally, inside RADAR_RANGE but past the planets' clamp line.
    const b = radarBlip(0, 215, scale, rimR, false);
    expect(b).toEqual({ px: 0, py: -215 * scale, onRim: false });
    expect(Math.hypot(b.px, b.py)).toBeLessThanOrEqual(rimR);
  });
});
