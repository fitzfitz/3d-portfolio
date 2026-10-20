import { describe, expect, it, vi } from "vitest";
import { hiResChoice } from "../src/utils/hiResMaps";
import { useSpaceStore } from "../src/store/spaceStore";

describe("hiResChoice", () => {
  it("holds its first answer after low-perf switches on", () => {
    // The asset pack loader picks a texture tier from this answer before the
    // canvas mounts; if SolarBodies asked again after a perf decline, it
    // would request the other tier, which this page never downloaded.
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    useSpaceStore.setState({ isLowPerf: false });
    expect(hiResChoice()).toBe(true);
    useSpaceStore.setState({ isLowPerf: true });
    expect(hiResChoice()).toBe(true);
    vi.unstubAllGlobals();
  });
});
