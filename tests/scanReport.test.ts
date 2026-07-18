import { describe, it, expect } from "vitest";
import { generateScanReport } from "../src/utils/scanReport";

describe("generateScanReport", () => {
  it("is deterministic per id", () => {
    expect(generateScanReport("asteroid_3")).toBe(generateScanReport("asteroid_3"));
  });
  it("differs across ids", () => {
    expect(generateScanReport("asteroid_3")).not.toBe(generateScanReport("asteroid_7"));
  });
  it("returns project-flavored reports for planets", () => {
    expect(generateScanReport("saas")).toContain("SUBSCRIPTIONS");
    expect(generateScanReport("contact")).toContain("COMM");
  });
  it("always uppercases and prefixes SCAN[", () => {
    expect(generateScanReport("asteroid_1")).toMatch(/^SCAN\[/);
  });
});
