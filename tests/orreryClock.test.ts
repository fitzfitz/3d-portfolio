import { describe, it, expect } from "vitest";
import { jdFromUnixMs } from "../src/utils/ephemeris";
import {
  ORRERY_TEST_JD,
  formatOrreryDate,
  orreryJd,
  parseOrreryParam,
  resolveInitialEpoch,
} from "../src/utils/orreryClock";
import { fitzDebug } from "../src/debug/bridge";

describe("orrery clock", () => {
  it("maps J2000 noon UTC to JD 2451545", () => {
    expect(jdFromUnixMs(Date.UTC(2000, 0, 1, 12))).toBe(2451545);
  });
  it("formats a JD as a UTC date", () => {
    expect(formatOrreryDate(2461333.5)).toBe("2026-10-20");
    expect(ORRERY_TEST_JD).toBe(2461333.5);
  });
  it("runs one Julian year per YEAR_S game seconds", () => {
    expect(orreryJd(420) - orreryJd(0)).toBeCloseTo(365.25, 9);
  });
  it("parses ?orrery=YYYY-MM-DD", () => {
    expect(parseOrreryParam("?orrery=2026-10-20")).toBe(2461333.5);
  });
  it("rejects anything that is not a real calendar date", () => {
    expect(parseOrreryParam("?orrery=9999-99-99")).toBeNull();
    expect(parseOrreryParam("?orrery=2026-02-30")).toBeNull();
    expect(parseOrreryParam("?orrery=abc")).toBeNull();
    expect(parseOrreryParam("")).toBeNull();
  });
  it("resolves the epoch: finite global, then URL, then now", () => {
    const now = Date.UTC(2030, 5, 1);
    expect(resolveInitialEpoch(2460000.5, "?orrery=2026-10-20", now)).toBe(2460000.5);
    expect(resolveInitialEpoch(NaN, "?orrery=2026-10-20", now)).toBe(2461333.5);
    expect(resolveInitialEpoch(Infinity, "", now)).toBe(jdFromUnixMs(now));
    expect(resolveInitialEpoch("2460000.5", "", now)).toBe(jdFromUnixMs(now));
    expect(resolveInitialEpoch(undefined, "?orrery=nope", now)).toBe(jdFromUnixMs(now));
  });
  it("exposes the epoch on the debug bridge", () => {
    const orig = fitzDebug.orrery.epochJd();
    fitzDebug.orrery.setEpochJd(2460000.5);
    expect(fitzDebug.orrery.epochJd()).toBe(2460000.5);
    expect(orreryJd(0)).toBe(2460000.5);
    fitzDebug.orrery.setEpochJd(orig);
  });
});
