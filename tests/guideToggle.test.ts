import { describe, it, expect } from "vitest";
import {
  requestGuideToggle, takeGuideToggle, setGuideActive, isGuideActive, subscribeGuideActive,
} from "../src/utils/guideToggle";

describe("guide toggle (J and the touch GUIDE button)", () => {
  it("is an edge: a press is taken once", () => {
    expect(takeGuideToggle()).toBe(false);
    requestGuideToggle();
    expect(takeGuideToggle()).toBe(true);
    expect(takeGuideToggle()).toBe(false);
  });
});

describe("guide active flag (the touch button's aria-pressed)", () => {
  it("reports whether the guide is out, and tells subscribers only when that changes", () => {
    let calls = 0;
    const off = subscribeGuideActive(() => { calls++; });
    setGuideActive(false);
    expect(isGuideActive()).toBe(false);
    expect(calls).toBe(0);
    setGuideActive(true);
    setGuideActive(true); // written every frame: no render per frame
    expect(isGuideActive()).toBe(true);
    expect(calls).toBe(1);
    setGuideActive(false);
    expect(calls).toBe(2);
    off();
    setGuideActive(true);
    expect(calls).toBe(2);
    setGuideActive(false);
  });
});
