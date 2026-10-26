import { describe, it, expect, vi } from "vitest";
import { runPadAction, LINKED_MESSAGE } from "../src/hooks/useGamepadInput";
import { takeGuideToggle } from "../src/utils/guideToggle";
import { padActions } from "../src/utils/gamepad";

function store(over: Record<string, unknown> = {}) {
  return {
    showClassicCV: false, beaconPickerOpen: false, photoMode: false, isOrbitLocked: false, openDossier: null, logbookOpen: false,
    setPhotoMode: vi.fn(), breakOrbit: vi.fn(), closeDossier: vi.fn(), setLogbookOpen: vi.fn(), requestJump: vi.fn(),
    ...over,
  };
}

describe("runPadAction", () => {
  it("sends d-pad left to the career station, View to the shipyard and Menu to the contact portal", () => {
    const s = store();
    const press = (i: number) => Array.from({ length: 17 }, (_, k) => k === i);
    const none = press(-1);
    for (const b of [14, 8, 9]) for (const a of padActions(none, press(b))) runPadAction(a, s);
    expect(s.requestJump.mock.calls).toEqual([["career"], ["shipyard"], ["contact"]]);
  });

  it("ignores View and Menu in photo mode and under the classic résumé", () => {
    for (const over of [{ photoMode: true }, { showClassicCV: true }]) {
      const s = store(over);
      runPadAction({ kind: "jump", id: "shipyard" }, s);
      runPadAction({ kind: "jump", id: "contact" }, s);
      expect(s.requestJump).not.toHaveBeenCalled();
    }
  });

  it("X toggles the logbook in normal flight", () => {
    const s = store();
    runPadAction({ kind: "logbook" }, s);
    expect(s.setLogbookOpen).toHaveBeenCalledWith(true);
  });

  it("does nothing while the beacon picker is open, like the L key", () => {
    const s = store({ beaconPickerOpen: true });
    runPadAction({ kind: "logbook" }, s);
    runPadAction({ kind: "photo" }, s);
    runPadAction({ kind: "jump", id: "home" }, s);
    expect(s.setLogbookOpen).not.toHaveBeenCalled();
    expect(s.setPhotoMode).not.toHaveBeenCalled();
    expect(s.requestJump).not.toHaveBeenCalled();
  });

  it("does nothing while the classic résumé is up", () => {
    const s = store({ showClassicCV: true });
    runPadAction({ kind: "logbook" }, s);
    runPadAction({ kind: "photo" }, s);
    expect(s.setLogbookOpen).not.toHaveBeenCalled();
    expect(s.setPhotoMode).not.toHaveBeenCalled();
  });

  it("R3 calls the jellyfish guide in normal flight, as J does", () => {
    takeGuideToggle(); // start clean
    runPadAction({ kind: "guide" }, store());
    expect(takeGuideToggle()).toBe(true);
  });

  it("R3 is ignored under a dossier or dock panel, the résumé and the beacon picker, as J is", () => {
    takeGuideToggle();
    for (const over of [{ isOrbitLocked: true }, { openDossier: "ruangrapi" }, { showClassicCV: true }, { beaconPickerOpen: true }]) {
      runPadAction({ kind: "guide" }, store(over));
      expect(takeGuideToggle(), JSON.stringify(over)).toBe(false);
    }
  });

  it("the pad-link line names every button with a job, R3 GUIDE included", () => {
    for (const part of ["L-STICK FLY", "R-STICK PITCH", "RB WARP", "LB BEAM", "A SCAN", "Y PHOTO", "X LOGBOOK", "R3 GUIDE", "D-PAD JUMP", "VIEW SHIPYARD", "MENU CONTACT"]) {
      expect(LINKED_MESSAGE).toContain(part);
    }
  });

  it("keeps the existing photo-mode and orbit rules", () => {
    const docked = store({ isOrbitLocked: true });
    runPadAction({ kind: "logbook" }, docked);
    runPadAction({ kind: "close" }, docked);
    expect(docked.setLogbookOpen).not.toHaveBeenCalled();
    expect(docked.breakOrbit).toHaveBeenCalled();
    const photo = store({ photoMode: true });
    runPadAction({ kind: "jump", id: "home" }, photo);
    expect(photo.requestJump).not.toHaveBeenCalled();
  });
});
