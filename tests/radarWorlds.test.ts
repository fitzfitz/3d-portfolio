import { describe, it, expect } from "vitest";
import { radarShowsWorld, radarBlip, RADAR_RANGE } from "../src/utils/radarTransform";

describe("radarShowsWorld: discovery, not signposts", () => {
  it("draws an uncharted world only inside the radar's range, never rim-clamped", () => {
    expect(RADAR_RANGE).toBe(220);
    expect(radarShowsWorld(false, 300)).toBe("hidden");
    expect(radarShowsWorld(false, 150)).toBe("free");
    expect(radarShowsWorld(false, RADAR_RANGE)).toBe("free");
    expect(radarShowsWorld(false, RADAR_RANGE + 0.01)).toBe("hidden");
  });

  it("draws a charted world exactly like a planet, whatever its 3D distance", () => {
    expect(radarShowsWorld(true, 300)).toBe("planet");
    expect(radarShowsWorld(true, 150)).toBe("planet");
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

  it("an uncharted world's blip is never rim-clamped or dimmed: it keeps its true scaled spot", () => {
    // 215 u horizontally, inside RADAR_RANGE but past the planets' clamp line.
    const b = radarBlip(0, 215, scale, rimR, false);
    expect(b).toEqual({ px: 0, py: -215 * scale, onRim: false });
    expect(Math.hypot(b.px, b.py)).toBeLessThanOrEqual(rimR);
  });
});
