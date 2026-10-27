import { describe, it, expect } from "vitest";
import { buildLogbook, dossierEntry, LOGBOOK } from "../src/utils/logbook";
import { probeIntro, probeDossiersRead } from "../src/utils/probes";
import { PROBE_IDS } from "../src/data/probes";
import { probeZoneLines } from "../src/data/chatterLines";
import { padJumps } from "../src/utils/gamepad";

/**
 * Every count and every line that named the three projects now follows the
 * probes in play (spec 2026-10-23-dynamic-content, decision 6 and build
 * rulings R9-R13). The bundled three keep their exact text (tests/logbook.test.ts).
 */
describe("logbook essentials follow the probes", () => {
  const four = [
    { id: "ruangrapi", title: "RuangRapi" }, { id: "portfolio", title: "This Flight-Sim CV" },
    { id: "fuxx", title: "fuxx" }, { id: "atlas", title: "Atlas Mapper" },
  ];

  it("is one dossier essential per probe, in order, then career and contact, then the seven badges", () => {
    const book = buildLogbook(four);
    expect(book.map((e) => e.id).slice(0, 6)).toEqual(["ruangrapi", "portfolio", "fuxx", "atlas", "career", "contact"]);
    expect(book.filter((e) => e.section === "essential")).toHaveLength(6);
    expect(book.filter((e) => e.section === "badge")).toHaveLength(7);
    expect(buildLogbook(four.slice(0, 1)).filter((e) => e.section === "essential")).toHaveLength(3);
  });

  it("is the bundled logbook for the bundled probes", () => {
    expect(LOGBOOK.filter((e) => e.section === "essential").map((e) => e.id)).toEqual([...PROBE_IDS, "career", "contact"]);
  });

  it("words a new project's entry from its title", () => {
    expect(dossierEntry({ id: "atlas", title: "Atlas Mapper" }, 3)).toEqual({
      id: "atlas", section: "essential", title: "Read the Atlas Mapper dossier",
      hint: "GRAB THE ATLAS MAPPER PROBE (HOLD F)", hintShort: "ATLAS MAPPER PROBE", plume: false,
    });
  });

  it("drops a leading This or The, and shortens the short hint to 18 characters by its last words", () => {
    expect(dossierEntry({ id: "x", title: "The Grand Orrery Engine" }, 0)).toMatchObject({
      title: "Read the Grand Orrery Engine dossier", hint: "GRAB THE GRAND ORRERY ENGINE PROBE (HOLD F)", hintShort: "ENGINE PROBE",
    });
    expect(dossierEntry({ id: "x", title: "This Flight-Sim CV" }, 1).hintShort).toBe("CV PROBE");
  });

  it("falls back to the probe's number when even one word is too long", () => {
    expect(dossierEntry({ id: "x", title: "Supercalifragilistic" }, 4).hintShort).toBe("PROBE 5");
  });

  it("keeps every short hint within 18 characters", () => {
    for (const t of ["A", "Atlas", "Atlas Mapper Pro Max", "Two Words", "Extraordinarily"]) {
      expect(dossierEntry({ id: "x", title: t }, 5).hintShort.length, t).toBeLessThanOrEqual(18);
    }
  });
});

describe("counts follow the probes", () => {
  it("counts only probe dossiers as read", () => {
    expect(probeDossiersRead(["ruangrapi", "gone", "fuxx"], PROBE_IDS)).toBe(2);
    expect(probeDossiersRead([], PROBE_IDS)).toBe(0);
  });

  it("introduces the probes by number on the spawn card", () => {
    expect(probeIntro(3)).toBe("Three probes carry three projects. Grab one with the tractor beam to open it.");
    expect(probeIntro(1)).toBe("One probe carries one project. Grab it with the tractor beam to open it.");
    expect(probeIntro(6)).toBe("Six probes carry six projects. Grab one with the tractor beam to open it.");
  });
});

describe("radio and gamepad follow the probes", () => {
  it("gives a probe with no written pool one line from its row", () => {
    expect(probeZoneLines("atlas", "Maps the sky.")).toEqual(["ATLAS PROBE IN RANGE // MAPS THE SKY"]);
  });

  it("puts the first three probes on the d-pad and leaves a missing one unmapped", () => {
    const ids = (probes: readonly string[]) => padJumps(probes).map(([, id]) => id);
    expect(ids(["a", "b", "c", "d"])).toEqual(["a", "b", "c", "career", "contact", "shipyard"]);
    expect(ids(["a"])).toEqual(["a", "career", "contact", "shipyard"]);
  });
});
