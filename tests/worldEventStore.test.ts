import { describe, it, expect, beforeEach } from "vitest";
import { useSpaceStore, worldClock, worldEventElapsed } from "../src/store/spaceStore";
import { eventLines } from "../src/data/chatterLines";
import { SOLAR_BODIES } from "../src/data/solarSystem";

beforeEach(() => { useSpaceStore.setState({ worldEvent: null, broadcast: null }); worldClock.now = 0; });

describe("world event store", () => {
  it("startWorldEvent sets the event and broadcasts its line", () => {
    useSpaceStore.getState().startWorldEvent({ kind: "flare", id: 1, startedAt: 10 }, "FLARE LINE");
    expect(useSpaceStore.getState().worldEvent?.kind).toBe("flare");
    expect(useSpaceStore.getState().broadcast?.text).toBe("FLARE LINE");
  });
  it("worldEventElapsed reads the world clock for the matching kind only", () => {
    useSpaceStore.getState().startWorldEvent({ kind: "flare", id: 1, startedAt: 10 }, "x");
    worldClock.now = 14.5;
    expect(worldEventElapsed("flare")).toBe(4.5);
    expect(worldEventElapsed("comet")).toBeNull();
  });
  it("endWorldEvent clears it", () => {
    useSpaceStore.getState().startWorldEvent({ kind: "comet", id: 2, startedAt: 0 }, "x");
    useSpaceStore.getState().endWorldEvent();
    expect(useSpaceStore.getState().worldEvent).toBeNull();
    expect(worldEventElapsed("comet")).toBeNull();
  });
  it("has radio lines for every event and every body's convoy", () => {
    expect(eventLines.comet.length).toBeGreaterThan(0);
    expect(eventLines.flare.length).toBeGreaterThan(0);
    for (const b of SOLAR_BODIES) expect(eventLines.convoy[b.id]?.length, b.id).toBeGreaterThan(0);
  });
});
