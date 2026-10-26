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
  it("reports the contact portal", () => {
    expect(generateScanReport("contact")).toContain("COMM");
  });
  it("no longer reports a project id as a planet: the project jokes went (spec §5.1)", () => {
    for (const id of ["ruangrapi", "portfolio", "fuxx"]) {
      expect(generateScanReport(id)).toMatch(new RegExp(`^SCAN\\[${id.toUpperCase()}\\] // `));
      expect(generateScanReport(id)).not.toMatch(/AU FROM THE SUN|SUPABASE|RUST/);
    }
  });
  it("scans the real comets by name with orbit numbers derived from their elements", async () => {
    const { COMET_ELEMENTS, COMET_SCAN_IDS, COMET_LABELS } = await import("../src/data/smallBodyField");
    expect(COMET_LABELS).toEqual(["2P/ENCKE", "67P/CHURYUMOV–GERASIMENKO"]);
    COMET_SCAN_IDS.forEach((id, i) => {
      const el = COMET_ELEMENTS[i];
      const r = generateScanReport(id);
      expect(r).toMatch(new RegExp(`^SCAN\\[${COMET_LABELS[i]}\\] // `));
      expect(r).toContain(`A ${el.a.toFixed(2)} AU`);
      expect(r).toContain(`E ${el.e.toFixed(2)}`);
      expect(r).toContain(`PERIOD ${(360 / el.nDegPerDay / 365.25).toFixed(1)} YR`);
      expect(r).not.toMatch(/MASS CLASS|UNKNOWN \d+%/);
    });
    expect(generateScanReport("comet_2p")).toContain("PERIOD 3.3 YR");
    expect(generateScanReport("comet_67p")).toContain("PERIOD 6.4 YR");
  });
  it("reports the race start gate: fly in and press R", () => {
    expect(generateScanReport("race_start")).toBe("SCAN[RACE_START] // FLY IN AND PRESS R TO RACE OTHER PILOTS");
  });
  it("always uppercases and prefixes SCAN[", () => {
    expect(generateScanReport("asteroid_1")).toMatch(/^SCAN\[/);
  });
});

it("body scans are titled by the body's real name and report the body", async () => {
  const { SOLAR_BODIES } = await import("../src/data/solarSystem");
  const { bodyReport } = await import("../src/utils/bodyReports");
  for (const b of SOLAR_BODIES) {
    expect(generateScanReport(b.id, 12).startsWith(`SCAN[${b.name}] // `), b.id).toBe(true);
    expect(generateScanReport(b.id, 12)).toBe(bodyReport(b, 12));
    expect(generateScanReport(b.id, 12)).not.toMatch(/MASS CLASS/);
  }
});

it("body scans carry the orbit in real units and end with the orrery date", () => {
  expect(generateScanReport("mars")).toMatch(/ \/\/ ORBIT 1\.52 AU \(1\.38–1\.67\) · e 0\.093 · i 1\.85° · YEAR 1\.88 EARTH-YR \/\//);
  expect(generateScanReport("mars")).toMatch(/ \/\/ ORRERY DATE \d{4}-\d{2}-\d{2} · SPINS AND MOONS ILLUSTRATIVE$/);
});
