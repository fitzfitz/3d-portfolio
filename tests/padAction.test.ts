import { describe, it, expect, vi } from "vitest";
import { runPadAction } from "../src/hooks/useGamepadInput";

function store(over: Record<string, unknown> = {}) {
  return {
    showClassicCV: false, beaconPickerOpen: false, photoMode: false, isOrbitLocked: false, logbookOpen: false,
    setPhotoMode: vi.fn(), breakOrbit: vi.fn(), setLogbookOpen: vi.fn(), requestJump: vi.fn(),
    ...over,
  };
}

describe("runPadAction", () => {
  it("X toggles the logbook in normal flight", () => {
    const s = store();
    runPadAction({ kind: "logbook" }, s, []);
    expect(s.setLogbookOpen).toHaveBeenCalledWith(true);
  });

  it("does nothing while the beacon picker is open, like the L key", () => {
    const s = store({ beaconPickerOpen: true });
    runPadAction({ kind: "logbook" }, s, ["home"]);
    runPadAction({ kind: "photo" }, s, ["home"]);
    runPadAction({ kind: "jump", index: 0 }, s, ["home"]);
    expect(s.setLogbookOpen).not.toHaveBeenCalled();
    expect(s.setPhotoMode).not.toHaveBeenCalled();
    expect(s.requestJump).not.toHaveBeenCalled();
  });

  it("does nothing while the classic résumé is up", () => {
    const s = store({ showClassicCV: true });
    runPadAction({ kind: "logbook" }, s, []);
    runPadAction({ kind: "photo" }, s, []);
    expect(s.setLogbookOpen).not.toHaveBeenCalled();
    expect(s.setPhotoMode).not.toHaveBeenCalled();
  });

  it("keeps the existing photo-mode and orbit rules", () => {
    const docked = store({ isOrbitLocked: true });
    runPadAction({ kind: "logbook" }, docked, []);
    runPadAction({ kind: "close" }, docked, []);
    expect(docked.setLogbookOpen).not.toHaveBeenCalled();
    expect(docked.breakOrbit).toHaveBeenCalled();
    const photo = store({ photoMode: true });
    runPadAction({ kind: "jump", index: 0 }, photo, ["home"]);
    expect(photo.requestJump).not.toHaveBeenCalled();
  });
});
