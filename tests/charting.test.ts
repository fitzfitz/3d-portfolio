import { describe, it, expect } from "vitest";
import { loadCharted, chartLine, SURVEY_LINE, isCartographer, type ChartRecord } from "../src/utils/charting";
import { WORLDS, WORLD_IDS } from "../src/data/worlds";
import { ALL_LINE, logbookCount } from "../src/utils/logbook";

const rec = (id: string, at = "2026-10-19") => ({ id, at }) as ChartRecord;

describe("loadCharted: corrupt storage never crashes or grants", () => {
  it("returns [] for anything that is not a list of records", () => {
    expect(loadCharted(undefined)).toEqual([]);
    expect(loadCharted(null)).toEqual([]);
    expect(loadCharted("x")).toEqual([]);
    expect(loadCharted({})).toEqual([]);
    expect(loadCharted([1])).toEqual([]);
  });

  it("keeps valid {id, at} entries only, dropping unknown ids and bad dates", () => {
    expect(loadCharted([
      { id: "w-rock", at: "2026-10-18" },
      { id: "fuxx", at: "2026-10-18" }, // a planet, not a world
      { id: "w-gone", at: "2026-10-18" }, // not on the roster
      { id: "w-blue", at: "yesterday" },
      { id: "w-blue", at: "2026-13-40" }, // the right shape, not a date
      { id: "w-tilted" },
      { at: "2026-10-18" },
      null,
      "w-dwarf",
      { id: "w-dwarf", at: "2026-10-17" },
    ])).toEqual([{ id: "w-rock", at: "2026-10-18" }, { id: "w-dwarf", at: "2026-10-17" }]);
  });

  it("dedupes by id, keeping the earliest date", () => {
    expect(loadCharted([
      { id: "w-rock", at: "2026-10-19" },
      { id: "w-rock", at: "2026-10-17" },
      { id: "w-rock", at: "2026-10-18" },
    ])).toEqual([{ id: "w-rock", at: "2026-10-17" }]);
  });

  it("copies records, so extra stored fields are not carried along", () => {
    expect(loadCharted([{ id: "w-rock", at: "2026-10-19", title: "CARTOGRAPHER" }])).toEqual([{ id: "w-rock", at: "2026-10-19" }]);
  });
});

describe("isCartographer: the title is derived, never stored", () => {
  it("is true only at five distinct valid ids", () => {
    expect(isCartographer([])).toBe(false);
    expect(isCartographer(WORLD_IDS.slice(0, 4).map((id) => rec(id)))).toBe(false);
    expect(isCartographer(WORLD_IDS.map((id) => rec(id)))).toBe(true);
    // Five records, but a repeat: four worlds.
    expect(isCartographer([...WORLD_IDS.slice(0, 4), WORLD_IDS[0]].map((id) => rec(id)))).toBe(false);
    // Five records, but one not a world.
    expect(isCartographer([...WORLD_IDS.slice(0, 4), "fuxx"].map((id) => rec(id)))).toBe(false);
  });
});

describe("radio lines", () => {
  it("names the count, the namesake type and one fact", () => {
    expect(chartLine("w-ringed", 3)).toMatch(/^WORLD CHARTED 3\/5 — SATURN-TYPE: \S/);
    for (const w of WORLDS) expect(chartLine(w.id, 1)).toMatch(new RegExp(`^WORLD CHARTED 1/5 — ${w.namesake.toUpperCase()}-TYPE: [A-Z]`));
  });

  it("the blue giant's line never credits methane ice", () => {
    expect(chartLine("w-blue", 1)).not.toMatch(/METHANE ICE/);
  });

  it("the survey line awards the title", () => {
    expect(SURVEY_LINE).toBe("SYSTEM SURVEY COMPLETE — EVERY WORLD CHARTED. YOU HOLD THE TITLE CARTOGRAPHER.");
  });
});

describe("the logbook stays at 11", () => {
  it("charting never changes logbookCount", () => {
    expect(logbookCount({ visitedDossiers: [], shardsCollected: [], badges: [] }).total).toBe(11);
  });

  it("ALL_LINE claims only the badge plumes (the cartographer plume is the survey's)", () => {
    expect(ALL_LINE).toMatch(/ALL BADGE PLUMES UNLOCKED/);
  });
});
