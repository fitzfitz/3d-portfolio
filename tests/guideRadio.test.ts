import { describe, it, expect } from "vitest";
import { GuideRadio, GUIDE_LINE_WAIT_S, type GuideLines } from "../src/utils/guideRadio";
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
  it("dismissing or declining says nothing", () => {
    const r = radio();
    expect(r.update("dismissed", false, 0, false)).toBeNull();
    expect(r.update("declined", true, 1, false)).toBeNull();
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
