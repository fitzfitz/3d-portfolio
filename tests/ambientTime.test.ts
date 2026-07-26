import { describe, it, expect, beforeEach } from "vitest";
import { ambientTime, setAmbientEnabled, resetAmbientTime } from "../src/utils/ambientTime";

beforeEach(() => {
  resetAmbientTime();
  setAmbientEnabled(true);
});

describe("ambientTime", () => {
  it("tracks real elapsed time while enabled", () => {
    expect(ambientTime(0)).toBe(0);
    expect(ambientTime(1)).toBe(1);
    expect(ambientTime(2.5)).toBe(2.5);
  });

  it("holds its value exactly while disabled", () => {
    ambientTime(5);
    setAmbientEnabled(false);
    expect(ambientTime(6)).toBe(5);
    expect(ambientTime(90)).toBe(5);
  });

  it("resumes from the held value instead of jumping to real time", () => {
    ambientTime(5);
    setAmbientEnabled(false);
    ambientTime(100); // 95s frozen
    setAmbientEnabled(true);
    // The next advance adds only the delta since the last call, not the frozen gap.
    expect(ambientTime(101)).toBe(6);
  });

  it("returns the same value for repeated calls within one frame", () => {
    ambientTime(3);
    expect(ambientTime(3)).toBe(3);
    expect(ambientTime(3)).toBe(3);
  });

  it("is order-independent across consumers in a frame", () => {
    ambientTime(1);
    const first = ambientTime(2);
    const second = ambientTime(2);
    const third = ambientTime(2);
    expect([second, third]).toEqual([first, first]);
  });

  it("ignores a clock that moves backwards rather than going negative", () => {
    ambientTime(10);
    expect(ambientTime(4)).toBe(10);
  });
});
