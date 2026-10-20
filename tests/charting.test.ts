import { describe, it, expect } from "vitest";
import {
  loadCharted, chartLine, SURVEY_LINE, AURUM_LINE, isCartographer, shoutDue, shoutLine, SHOUT_PENDING_MS, SHOUT_HEAR_GAP_MS,
  createShoutGate, type ChartRecord,
} from "../src/utils/charting";
import { useSpaceStore } from "../src/store/spaceStore";
import { BODY_IDS, LEGACY_WORLD_TO_BODY } from "../src/data/bodyIds";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { ALL_LINE, logbookCount, plumeAllowed } from "../src/utils/logbook";
import { hasPlumeColour } from "../src/data/plumeColors";

const rec = (id: string, at = "2026-10-19") => ({ id, at }) as ChartRecord;

describe("loadCharted: the five legacy world ids become their real bodies (§7)", () => {
  it("maps w-rock to mercury, keeping the date", () => {
    expect(loadCharted([{ id: "w-rock", at: "2026-10-19" }])).toEqual([{ id: "mercury", at: "2026-10-19" }]);
  });

  it("maps all five, so no stored progress is lost", () => {
    const legacy = Object.keys(LEGACY_WORLD_TO_BODY).map((id) => ({ id, at: "2026-10-18" }));
    expect(loadCharted(legacy)).toEqual(Object.values(LEGACY_WORLD_TO_BODY).map((id) => ({ id, at: "2026-10-18" })));
  });

  it("merges a legacy record with the same body's new one, keeping the earliest date", () => {
    expect(loadCharted([{ id: "ceres", at: "2026-10-20" }, { id: "w-dwarf", at: "2026-10-17" }]))
      .toEqual([{ id: "ceres", at: "2026-10-17" }]);
  });
});

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
      { id: "mercury", at: "2026-10-18" },
      { id: "fuxx", at: "2026-10-18" }, // a probe id: never a charted body
      { id: "pluto", at: "2026-10-18" }, // not on the roster
      { id: "toString", at: "2026-10-18" }, // not a legacy id either, whatever the prototype holds
      { id: "neptune", at: "yesterday" },
      { id: "neptune", at: "2026-13-40" }, // the right shape, not a date
      { id: "uranus" },
      { at: "2026-10-18" },
      null,
      "ceres",
      { id: "ceres", at: "2026-10-17" },
    ])).toEqual([{ id: "mercury", at: "2026-10-18" }, { id: "ceres", at: "2026-10-17" }]);
  });

  it("dedupes by id, keeping the earliest date", () => {
    expect(loadCharted([
      { id: "mercury", at: "2026-10-19" },
      { id: "mercury", at: "2026-10-17" },
      { id: "mercury", at: "2026-10-18" },
    ])).toEqual([{ id: "mercury", at: "2026-10-17" }]);
  });

  it("copies records, so extra stored fields are not carried along", () => {
    expect(loadCharted([{ id: "mercury", at: "2026-10-19", title: "CARTOGRAPHER" }])).toEqual([{ id: "mercury", at: "2026-10-19" }]);
  });
});

describe("isCartographer: the title is derived, never stored", () => {
  it("is true only at nine distinct valid ids", () => {
    expect(isCartographer([])).toBe(false);
    expect(isCartographer(BODY_IDS.slice(0, 8).map((id) => rec(id)))).toBe(false);
    expect(isCartographer(BODY_IDS.map((id) => rec(id)))).toBe(true);
    // Nine records, but a repeat: eight bodies.
    expect(isCartographer([...BODY_IDS.slice(0, 8), BODY_IDS[0]].map((id) => rec(id)))).toBe(false);
    // Nine records, but one not a body.
    expect(isCartographer([...BODY_IDS.slice(0, 8), "fuxx"].map((id) => rec(id)))).toBe(false);
  });
});

describe("radio lines", () => {
  it("names the count out of nine, the body and one fact", () => {
    expect(chartLine("saturn", 3)).toMatch(/^WORLD CHARTED 3\/9 — SATURN: \S/);
    expect(chartLine("ceres", 1)).toMatch(/^WORLD CHARTED 1\/9 — CERES: /);
    for (const b of SOLAR_BODIES) expect(chartLine(b.id, 1)).toMatch(new RegExp(`^WORLD CHARTED 1/9 — ${b.name}: [A-Z]`));
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

describe("the cartographer plume", () => {
  const none = { badges: [], visitedDossiers: [], shardsCollected: [] };
  const all: ChartRecord[] = BODY_IDS.map((id) => ({ id, at: "2026-10-19" }));
  it("unlocks with all nine bodies charted", () => {
    expect(plumeAllowed("cartographer", none, hasPlumeColour, [])).toBe(false);
    expect(plumeAllowed("cartographer", none, hasPlumeColour, all.slice(0, 8))).toBe(false);
    expect(plumeAllowed("cartographer", none, hasPlumeColour, all)).toBe(true);
  });
});

describe("the cartographer shout-out", () => {
  it("is due for 24 h after the last body, then never", () => {
    expect(shoutDue(null, 1000)).toBe(false);
    expect(shoutDue(1000, 2000)).toBe(true);
    expect(shoutDue(1000, 1000 + SHOUT_PENDING_MS)).toBe(false);
  });
  it("reads as a fixed line, with or without a country", () => {
    expect(shoutLine("ID")).toBe("A PILOT FROM ID HAS CHARTED EVERY WORLD. A NEW CARTOGRAPHER FLIES.");
    expect(shoutLine(null)).toBe("A PILOT HAS CHARTED EVERY WORLD. A NEW CARTOGRAPHER FLIES.");
  });
  it("charting the last body arms it once", () => {
    useSpaceStore.setState({ charted: [], chartShoutAt: null });
    const st = () => useSpaceStore.getState();
    for (const id of BODY_IDS.slice(0, 8)) st().chartWorld(id);
    expect(st().chartShoutAt).toBeNull();
    st().chartWorld(BODY_IDS[8]);
    const armed = st().chartShoutAt;
    expect(typeof armed).toBe("number");
    st().chartWorld(BODY_IDS[8]);
    expect(st().chartShoutAt).toBe(armed);
    st().clearChartShout();
    expect(st().chartShoutAt).toBeNull();
  });
});

describe("hearing shout-outs", () => {
  it("plays at most one per SHOUT_HEAR_GAP_MS, whatever the room remembers", () => {
    // The room's anti-spam lives in memory and a hibernated room forgets it;
    // this gate on the listener holds regardless and stores nothing.
    const play = createShoutGate();
    expect(play(0)).toBe(true);
    expect(play(10_000)).toBe(false);
    expect(play(SHOUT_HEAR_GAP_MS - 1)).toBe(false);
    expect(play(SHOUT_HEAR_GAP_MS)).toBe(true);
    expect(SHOUT_HEAR_GAP_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });
});

describe("the AURUM radio line", () => {
  const st = () => useSpaceStore.getState();
  const all = () => BODY_IDS.map((id) => ({ id, at: "2026-10-19" }));
  it("says where to fit the plume", () => {
    expect(AURUM_LINE).toBe("AURUM PLUME UNLOCKED // FIT IT IN THE SHIPYARD HANGAR");
  });
  it("plays when the last body is charted, and is remembered as told", () => {
    useSpaceStore.setState({ charted: [], chartShoutAt: null, aurumTold: false });
    const lines: string[] = [];
    const real = st().announceLogbook;
    useSpaceStore.setState({ announceLogbook: (l: string) => { lines.push(l); } });
    for (const id of BODY_IDS) st().chartWorld(id);
    expect(lines.slice(-2)).toEqual([SURVEY_LINE, AURUM_LINE]);
    expect(st().aurumTold).toBe(true);
    useSpaceStore.setState({ announceLogbook: real });
  });
  it("tells a pilot who already held the title, once", () => {
    const lines: string[] = [];
    const real = st().announceLogbook;
    useSpaceStore.setState({ charted: all(), aurumTold: false, announceLogbook: (l: string) => { lines.push(l); } });
    st().tellAurumOnce();
    st().tellAurumOnce();
    expect(lines).toEqual([AURUM_LINE]);
    useSpaceStore.setState({ charted: all().slice(0, 8), aurumTold: false });
    st().tellAurumOnce();
    expect(lines).toEqual([AURUM_LINE]);
    useSpaceStore.setState({ announceLogbook: real });
  });
});
