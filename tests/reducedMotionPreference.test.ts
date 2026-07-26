import { describe, it, expect } from "vitest";
import { resolveReducedMotion } from "../src/utils/reducedMotionPreference";

describe("resolveReducedMotion", () => {
  it("defers to the media query when nothing is stored", () => {
    expect(resolveReducedMotion(null, true)).toBe(true);
    expect(resolveReducedMotion(null, false)).toBe(false);
  });

  it("lets a stored choice override the media query in both directions", () => {
    // Someone who set the OS flag for battery but wants the full show.
    expect(resolveReducedMotion(false, true)).toBe(false);
    // Someone who wants calm without changing system settings.
    expect(resolveReducedMotion(true, false)).toBe(true);
  });

  it("agrees with the query when the stored choice matches it", () => {
    expect(resolveReducedMotion(true, true)).toBe(true);
    expect(resolveReducedMotion(false, false)).toBe(false);
  });
});
