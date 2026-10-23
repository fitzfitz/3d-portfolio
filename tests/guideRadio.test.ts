import { describe, it, expect } from "vitest";
import { GuideRadio, GUIDE_LINE_WAIT_S, arrivalLine, onwardLine, type GuideLines } from "../src/utils/guideRadio";
import { guideLines } from "../src/data/chatterLines";

const lines: GuideLines = { called: ["c1", "c2"], offering: ["o1"], arrived: ["a1"], allDone: ["d1"] };
const radio = () => new GuideRadio(lines, () => 0);

describe("GuideRadio (the guide's radio lines, spec \"Calling it\")", () => {
  it("says the called line when a called guide reaches the ship (met), not when J is pressed", () => {
    const r = radio();
    expect(r.update("called", false, 0, false)).toBeNull();
    expect(r.update("met", false, 2, false)).toBe("c1");
  });
  it("an offer speaks when it starts, and not again when it meets the ship", () => {
    const r = radio();
    expect(r.update("offered", true, 0, false)).toBe("o1");
    expect(r.update("met", true, 2, false)).toBeNull();
  });
  it("arrival and all-done have their own lines", () => {
    const r = radio();
    expect(r.update("arrived", false, 0, false)).toBe("a1");
    expect(r.update("allDone", false, 9, false)).toBe("d1");
  });
  it("dismissing says nothing", () => {
    const r = radio();
    expect(r.update("dismissed", false, 0, false)).toBeNull();
    expect(r.update("dismissed", true, 1, false)).toBeNull();
  });
  it("never talks over a busy radio: the line waits, then goes out when it frees", () => {
    const r = radio();
    expect(r.update("arrived", false, 10, true)).toBeNull();
    expect(r.update(null, false, 12, true)).toBeNull();
    expect(r.update(null, false, 13, false)).toBe("a1");
    expect(r.update(null, false, 14, false)).toBeNull();
  });
  it("drops a line that waited too long (it would be stale)", () => {
    const r = radio();
    r.update("met", false, 0, true);
    expect(r.update(null, false, GUIDE_LINE_WAIT_S + 0.1, false)).toBeNull();
  });
  it("a dismissal drops a line still waiting for the called guide", () => {
    const r = radio();
    r.update("met", false, 0, true);
    r.update("dismissed", false, 1, true);
    expect(r.update(null, false, 2, false)).toBeNull();
  });
  it("a newer line replaces one still waiting", () => {
    const r = radio();
    r.update("met", false, 0, true);
    r.update("arrived", false, 1, true);
    expect(r.update(null, false, 2, false)).toBe("a1");
  });
  it("arrival names the step's action when the target has one, else the pool's line", () => {
    const r = radio();
    expect(r.update("arrived", false, 0, false, "career")).toBe("YOU'RE HERE, PILOT // DOCK AT THE CAREER STATION");
    expect(r.update("arrived", false, 1, false, "no-such-step")).toBe("a1");
  });
  it("onward names the next step, and waits out a busy radio like every line", () => {
    const r = radio();
    expect(r.update("onward", false, 0, true, "contact")).toBeNull();
    expect(r.update(null, false, 2, false)).toBe("ONWARD, PILOT // NEXT: CONTACT PORTAL");
  });
  it("does not repeat the previous line of a pool when it has another", () => {
    const r = radio();
    expect(r.update("met", false, 0, false)).toBe("c1");
    expect(r.update("met", false, 1, false)).toBe("c2");
  });
});

describe("guideLines (chatterLines.ts)", () => {
  it("has the four pools, each with short, upper-case radio lines", () => {
    for (const k of ["called", "offering", "arrived", "allDone"] as const) {
      expect(guideLines[k].length, k).toBeGreaterThan(0);
      for (const l of guideLines[k]) {
        expect(l, k).toBe(l.toUpperCase());
        expect(l.length, l).toBeLessThanOrEqual(64);
      }
    }
  });
  it("opens the called pool with the spec's line", () => {
    expect(guideLines.called[0]).toBe("YOUR GUIDE IS HERE: FOLLOW THE GLOW");
  });
});

// Owner, 2026-10-23: "After I reach my stop, what will the jellyfish do? Will it
// inform me of what to do?" The arrival line is the step's own instruction.
describe("arrivalLine and onwardLine (the step's own instruction)", () => {
  it("a probe: its logbook hint, the grab and its key", () => {
    expect(arrivalLine("ruangrapi")).toBe("YOU'RE HERE, PILOT // GRAB THE RUANGRAPI PROBE (HOLD F)");
  });
  it("the career station and the contact portal: dock", () => {
    expect(arrivalLine("career")).toBe("YOU'RE HERE, PILOT // DOCK AT THE CAREER STATION");
    expect(arrivalLine("contact")).toBe("YOU'RE HERE, PILOT // DOCK AT THE CONTACT PORTAL");
  });
  it("an uncharted world: the scanner's own hint (ScanRing: HOLD E TO SCAN)", () => {
    expect(arrivalLine("mars")).toBe("YOU'RE HERE, PILOT // HOLD E TO SCAN MARS");
  });
  it("an unknown id: null, so the radio falls back to the arrived pool", () => {
    expect(arrivalLine("")).toBeNull();
    expect(arrivalLine("no-such-step")).toBeNull();
  });
  it("onward names the next step: the entry's short hint, a world to chart, or just the glow", () => {
    expect(onwardLine("career")).toBe("ONWARD, PILOT // NEXT: CAREER DOSSIER");
    expect(onwardLine("fuxx")).toBe("ONWARD, PILOT // NEXT: FUXX PROBE");
    expect(onwardLine("saturn")).toBe("ONWARD, PILOT // NEXT: CHART SATURN");
    expect(onwardLine("no-such-step")).toBe("ONWARD, PILOT // FOLLOW THE GLOW");
  });
  it("every line is upper case and short enough to read on the radio", () => {
    for (const id of ["ruangrapi", "portfolio", "fuxx", "career", "contact", "mercury", "neptune", "ceres"]) {
      for (const l of [arrivalLine(id)!, onwardLine(id)]) {
        expect(l).toBe(l.toUpperCase());
        expect(l.length, l).toBeLessThanOrEqual(64);
      }
    }
  });
});
