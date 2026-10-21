import { describe, it, expect } from "vitest";
import { fitzDebug } from "../src/debug/bridge";
import { useSpaceStore, flight, bodies } from "../src/store/spaceStore";
import { moonPositions } from "../src/store/moonState";

describe("debug bridge", () => {
  it("exposes the live store and telemetry objects by reference, not copies", () => {
    expect(fitzDebug.store).toBe(useSpaceStore);
    expect(fitzDebug.flight).toBe(flight);
    expect(fitzDebug.bodies).toBe(bodies);
    expect(fitzDebug.moons).toBe(moonPositions);
  });

  it("starts with no scene and a zero commit count", () => {
    expect(fitzDebug.scene).toBe(null);
    expect(fitzDebug.renderCount).toBe(0);
  });
});
