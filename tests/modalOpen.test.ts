import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPadAction, padShouldIdle } from "../src/hooks/useGamepadInput";
import { watchDossierRelease } from "../src/hooks/useKeyboardInput";
import { flight, useSpaceStore } from "../src/store/spaceStore";
import { beamState } from "../src/store/beamState";

function store(over: Record<string, unknown> = {}) {
  return {
    showClassicCV: false, beaconPickerOpen: false, photoMode: false, isOrbitLocked: false, openDossier: null,
    logbookOpen: false, setPhotoMode: vi.fn(), breakOrbit: vi.fn(), closeDossier: vi.fn(),
    setLogbookOpen: vi.fn(), requestJump: vi.fn(),
    ...over,
  };
}

describe("pad B with a dossier open", () => {
  it("closes the dossier (not the orbit) when openDossier is set and nothing is locked", () => {
    const s = store({ openDossier: "fuxx" });
    runPadAction({ kind: "close" }, s);
    expect(s.closeDossier).toHaveBeenCalledTimes(1);
    expect(s.breakOrbit).not.toHaveBeenCalled();
  });
  it("still breaks orbit when only locked", () => {
    const s = store({ isOrbitLocked: true });
    runPadAction({ kind: "close" }, s);
    expect(s.breakOrbit).toHaveBeenCalledTimes(1);
    expect(s.closeDossier).not.toHaveBeenCalled();
  });
  it("X does not toggle the logbook under a dossier", () => {
    const s = store({ openDossier: "fuxx" });
    runPadAction({ kind: "logbook" }, s);
    expect(s.setLogbookOpen).not.toHaveBeenCalled();
  });
});

describe("padShouldIdle", () => {
  it("idles the sticks under the classic CV or an open dossier", () => {
    expect(padShouldIdle({ showClassicCV: false, openDossier: null })).toBe(false);
    expect(padShouldIdle({ showClassicCV: true, openDossier: null })).toBe(true);
    expect(padShouldIdle({ showClassicCV: false, openDossier: "fuxx" })).toBe(true);
  });
});

describe("watchDossierRelease", () => {
  beforeEach(() => useSpaceStore.setState({ openDossier: null, dossierVia: null }));
  it("releases held keys, pad axes and the beam when a dossier opens", () => {
    const unsub = watchDossierRelease();
    Object.assign(flight.input, { forward: true, beam: true, scan: true, steer: 1, thrust: 1 });
    beamState.active = true; beamState.reel.active = true;
    useSpaceStore.getState().openProjectDossier("fuxx", "probe");
    expect(flight.input).toMatchObject({ forward: false, beam: false, scan: false, steer: 0, thrust: 0 });
    expect(beamState.active).toBe(false);
    expect(beamState.reel.active).toBe(false);
    unsub();
  });
  it("does nothing on close", () => {
    useSpaceStore.getState().openProjectDossier("fuxx", "logbook");
    const unsub = watchDossierRelease();
    flight.input.forward = true;
    useSpaceStore.getState().closeDossier();
    expect(flight.input.forward).toBe(true);
    flight.input.forward = false;
    unsub();
  });
});
