import { describe, it, expect } from "vitest";
import {
  LOGBOOK, entryDone, logbookCount, nextGoal, essentialsDone, allDone, isRecordable,
  badgeLine, convoySighted, plumeAllowed, type LogbookProgress,
} from "../src/utils/logbook";
import projects from "../src/data/projects.json";

const empty: LogbookProgress = { visitedDossiers: [], shardsCollected: [], badges: [] };
const withBadges = (...ids: string[]): LogbookProgress => ({ ...empty, badges: ids.map((id) => ({ id, at: "2026-10-13" })) });
const byId = (id: string) => LOGBOOK.find((e) => e.id === id)!;

describe("LOGBOOK", () => {
  it("has 4 essentials then 6 badges, ids unique", () => {
    expect(LOGBOOK.map((e) => e.section)).toEqual([...Array(4).fill("essential"), ...Array(6).fill("badge")]);
    expect(new Set(LOGBOOK.map((e) => e.id)).size).toBe(LOGBOOK.length);
  });
  it("has a dossier essential for every project, by its id", () => {
    for (const p of projects) expect(byId(p.id)?.section).toBe("essential");
  });
  it("gives every badge a plume and no essential one", () => {
    for (const e of LOGBOOK) expect(e.plume).toBe(e.section === "badge");
  });
});

describe("entryDone", () => {
  it("reads dossiers from visitedDossiers", () => {
    expect(entryDone(byId("fuxx"), empty)).toBe(false);
    expect(entryDone(byId("fuxx"), { ...empty, visitedDossiers: ["fuxx"] })).toBe(true);
  });
  it("needs 3 shards for the shard badge", () => {
    expect(entryDone(byId("shards"), { ...empty, shardsCollected: [0, 4] })).toBe(false);
    expect(entryDone(byId("shards"), { ...empty, shardsCollected: [0, 4, 9] })).toBe(true);
  });
  it("reads every other entry from the recorded badges", () => {
    expect(entryDone(byId("contact"), withBadges("contact"))).toBe(true);
    expect(entryDone(byId("slingshot"), withBadges("comet"))).toBe(false);
  });
});

describe("progress", () => {
  it("counts done entries", () => {
    expect(logbookCount(empty)).toEqual({ done: 0, total: 10 });
    expect(logbookCount({ ...withBadges("slingshot"), visitedDossiers: ["fuxx"] })).toEqual({ done: 2, total: 10 });
  });
  it("points at the first unfinished essential, then badges, then nothing", () => {
    expect(nextGoal(empty)?.id).toBe(LOGBOOK[0].id);
    const essentials: LogbookProgress = { ...withBadges("contact"), visitedDossiers: projects.map((p) => p.id) };
    expect(essentialsDone(essentials)).toBe(true);
    expect(nextGoal(essentials)?.id).toBe("slingshot");
    const everything: LogbookProgress = {
      ...withBadges("contact", "slingshot", "comet", "ring", "ore", "convoy"),
      visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
    };
    expect(allDone(everything)).toBe(true);
    expect(nextGoal(everything)).toBeNull();
  });
});

describe("isRecordable", () => {
  it("accepts recorded entries only", () => {
    for (const id of ["contact", "slingshot", "comet", "ring", "ore", "convoy"]) expect(isRecordable(id)).toBe(true);
    for (const id of ["fuxx", "shards", "nope"]) expect(isRecordable(id)).toBe(false);
  });
});

describe("badgeLine", () => {
  it("names the badge and its plume", () => {
    expect(badgeLine("slingshot", "GOLD")).toBe("LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. PRESS L");
  });
  it("uses the portal line for the contact essential", () => {
    expect(badgeLine("contact", null)).toBe("LOGBOOK // CONTACT PORTAL REACHED");
  });
});

describe("convoySighted", () => {
  const ship = { x: 0, y: 0, z: 0 };
  it("is true inside the radius and false outside", () => {
    expect(convoySighted(ship, [{ x: 500, y: 0, z: 0 }, { x: 119, y: 0, z: 0 }])).toBe(true);
    expect(convoySighted(ship, [{ x: 121, y: 0, z: 0 }])).toBe(false);
  });
  it("works across the wrap seam", () => {
    expect(convoySighted({ x: 240, y: 0, z: 0 }, [{ x: -240, y: 0, z: 0 }])).toBe(true);
  });
});

describe("plumeAllowed", () => {
  const hasColour = (id: string) => id === "stock" || id === "slingshot" || id === "shards";
  it("always allows stock", () => {
    expect(plumeAllowed("stock", empty, hasColour)).toBe(true);
  });
  it("allows a colour only once its badge is done, including derived ones", () => {
    expect(plumeAllowed("slingshot", empty, hasColour)).toBe(false);
    expect(plumeAllowed("slingshot", withBadges("slingshot"), hasColour)).toBe(true);
    expect(plumeAllowed("shards", { ...empty, shardsCollected: [1, 2, 3] }, hasColour)).toBe(true);
  });
  it("rejects unknown ids and essentials", () => {
    expect(plumeAllowed("contact", withBadges("contact"), () => true)).toBe(false);
    expect(plumeAllowed("nope", empty, () => true)).toBe(false);
  });
});
