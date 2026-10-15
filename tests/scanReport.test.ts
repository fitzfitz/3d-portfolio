import { describe, it, expect } from "vitest";
import { generateScanReport } from "../src/utils/scanReport";

describe("generateScanReport", () => {
  it("reports the career station by its scan label", () => {
    expect(generateScanReport("career")).toMatch(/^SCAN\[STATION_CAREER\] \/\/ .*DOCK/);
  });
  it("is deterministic per id", () => {
    expect(generateScanReport("asteroid_3")).toBe(generateScanReport("asteroid_3"));
  });
  it("differs across ids", () => {
    expect(generateScanReport("asteroid_3")).not.toBe(generateScanReport("asteroid_7"));
  });
  it("returns project-flavored reports for planets", () => {
    expect(generateScanReport("ruangrapi")).toContain("SUPABASE");
    expect(generateScanReport("fuxx")).toContain("RUST");
    expect(generateScanReport("contact")).toContain("COMM");
  });
  it("always uppercases and prefixes SCAN[", () => {
    expect(generateScanReport("asteroid_1")).toMatch(/^SCAN\[/);
  });
});
