import { describe, it, expect } from "vitest";
import { nestPaused, rumourDue } from "../src/utils/combat/nestRadio";
import { NEST_BREACH_LINE, NEST_CLEARED_LINE, NEST_RUMOUR_LINE } from "../src/data/chatterLines";
import { NEST_LEASH_R, NEST_RUMOUR_R } from "../src/utils/combat/constants";

describe("the Nest's radio", () => {
  it("the rumour plays once, 110–400 u out, not racing, radio free", () => {
    expect(rumourDue(false, 300, false, false)).toBe(true);
    expect(rumourDue(true, 300, false, false)).toBe(false);
    expect(rumourDue(false, 401, false, false)).toBe(false);
    expect(rumourDue(false, 100, false, false)).toBe(false);
    expect(rumourDue(false, 300, true, false)).toBe(false);
    expect(rumourDue(false, 300, false, true)).toBe(false);
  });

  it("the rumour's band: outside the fighting area (110 u, exclusive) up to 400 u (inclusive)", () => {
    expect(NEST_LEASH_R).toBe(110);
    expect(NEST_RUMOUR_R).toBe(400);
    expect(rumourDue(false, 110, false, false)).toBe(false);
    expect(rumourDue(false, 110.001, false, false)).toBe(true);
    expect(rumourDue(false, 400, false, false)).toBe(true);
    expect(rumourDue(false, 400.001, false, false)).toBe(false);
  });

  it("the radio lines are the spec's", () => {
    expect(NEST_RUMOUR_LINE).toBe("RADIO // SOMETHING IS NESTING BELOW THE PLANE. PILOTS REPORT SAUCERS");
    expect(NEST_BREACH_LINE).toBe("RADIO // HULL BREACH · TOWED TO THE BUOY · THE NEST IS STILL HUNGRY");
    expect(NEST_CLEARED_LINE).toBe("RADIO // NEST CLEARED · THE CRITTERS WILL BE BACK");
  });
});

describe("the Nest's pause (C6)", () => {
  const calm = { photoMode: false, logbookOpen: false, changelogOpen: false, bottlePanelOpen: false };
  it("runs when nothing is open", () => {
    expect(nestPaused(calm)).toBe(false);
  });
  it("pauses in photo mode and under the logbook, the patch notes or the bottle panel", () => {
    expect(nestPaused({ ...calm, photoMode: true })).toBe(true);
    expect(nestPaused({ ...calm, logbookOpen: true })).toBe(true);
    expect(nestPaused({ ...calm, changelogOpen: true })).toBe(true);
    expect(nestPaused({ ...calm, bottlePanelOpen: true })).toBe(true);
  });
});
