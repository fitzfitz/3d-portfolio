import { describe, it, expect } from "vitest";
import { generateScanReport } from "../src/utils/scanReport";

describe("generateScanReport", () => {
  it("reports a career buoy's posting, oldest first", () => {
    expect(generateScanReport("career_0")).toMatch(/^SCAN\[CAREER_2015\] \/\/ FRONT-END DEVELOPER · SOFTWARESENI · JUN 2015 – JAN 2016 \/\/ /);
    expect(generateScanReport("career_4")).toContain("HUBEXO");
    expect(generateScanReport("career_4")).toContain("NOV 2020 – PRESENT");
  });
  it("reports the career station by its scan label", () => {
    expect(generateScanReport("career")).toMatch(/^SCAN\[STATION_CAREER\] \/\/ .*DOCK/);
  });
  it("reports the shipyard and the dormant gate", () => {
    expect(generateScanReport("shipyard")).toBe("SCAN[DRYDOCK_01] // CRANE RUNNING. ENGINE PLUMES ARE REFITTED HERE. DOCK TO OPEN THE HANGAR");
    expect(generateScanReport("dormant_gate")).toBe("SCAN[UNKNOWN_STRUCTURE] // ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL");
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

it("planet scans end with the orbit in real units", () => {
  expect(generateScanReport("portfolio")).toMatch(/ \/\/ ORBIT 1\.30 AU · YEAR 1\.49 EARTH-YR$/);
  expect(generateScanReport("ruangrapi")).toContain("SUPABASE");
});
