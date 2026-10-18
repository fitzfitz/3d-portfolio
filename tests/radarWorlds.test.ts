import { describe, it, expect } from "vitest";
import { radarShowsWorld, RADAR_RANGE } from "../src/utils/radarTransform";

describe("radarShowsWorld: discovery, not signposts", () => {
  it("draws an uncharted world only inside the radar's range, with no rim arrow", () => {
    expect(RADAR_RANGE).toBe(220);
    expect(radarShowsWorld(false, 300)).toBe("hidden");
    expect(radarShowsWorld(false, 150)).toBe("blip");
    expect(radarShowsWorld(false, RADAR_RANGE)).toBe("blip");
    expect(radarShowsWorld(false, RADAR_RANGE + 0.01)).toBe("hidden");
  });

  it("draws a charted world like a planet: a blip in range, pinned to the rim beyond", () => {
    expect(radarShowsWorld(true, 300)).toBe("rim");
    expect(radarShowsWorld(true, 150)).toBe("blip");
  });
});
