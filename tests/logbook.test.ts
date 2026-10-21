import { describe, it, expect } from "vitest";
import {
  LOGBOOK, entryDone, logbookCount, nextGoal, essentialsDone, allDone, isRecordable,
  badgeLine, convoySighted, plumeAllowed, milestoneFor, type LogbookProgress,
} from "../src/utils/logbook";
import projects from "../src/data/projects.json";

const empty: LogbookProgress = { visitedDossiers: [], shardsCollected: [], badges: [] };
const withBadges = (...ids: string[]): LogbookProgress => ({ ...empty, badges: ids.map((id) => ({ id, at: "2026-10-13" })) });
const byId = (id: string) => LOGBOOK.find((e) => e.id === id)!;

describe("LOGBOOK", () => {
  it("has 5 essentials then 6 badges, ids unique", () => {
    expect(LOGBOOK.map((e) => e.section)).toEqual([...Array(5).fill("essential"), ...Array(6).fill("badge")]);
    expect(new Set(LOGBOOK.map((e) => e.id)).size).toBe(LOGBOOK.length);
  });
  it("has a dossier essential for every project, by its id", () => {
    for (const p of projects) expect(byId(p.id)?.section).toBe("essential");
  });
  it("gives every badge a plume and no essential one", () => {
    for (const e of LOGBOOK) expect(e.plume).toBe(e.section === "badge");
  });
  it("hints the slingshot in real-system words", () => {
    expect(byId("slingshot").hint).toBe("SKIM A PLANET OR MOON");
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
    expect(logbookCount(empty)).toEqual({ done: 0, total: 11 });
    expect(logbookCount({ ...withBadges("slingshot"), visitedDossiers: ["fuxx"] })).toEqual({ done: 2, total: 11 });
  });
  it("points at the first unfinished essential, then badges, then nothing", () => {
    expect(nextGoal(empty)?.id).toBe(LOGBOOK[0].id);
    const essentials: LogbookProgress = { ...withBadges("career", "contact"), visitedDossiers: projects.map((p) => p.id) };
    expect(essentialsDone(essentials)).toBe(true);
    expect(nextGoal(essentials)?.id).toBe("slingshot");
    const everything: LogbookProgress = {
      ...withBadges("career", "contact", "slingshot", "comet", "ring", "ore", "convoy"),
      visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
    };
    expect(allDone(everything)).toBe(true);
    expect(nextGoal(everything)).toBeNull();
  });
});

describe("isRecordable", () => {
  it("accepts recorded entries only", () => {
    for (const id of ["career", "contact", "slingshot", "comet", "ring", "ore", "convoy"]) expect(isRecordable(id)).toBe(true);
    for (const id of ["fuxx", "shards", "nope"]) expect(isRecordable(id)).toBe(false);
  });
});

describe("badgeLine", () => {
  it("names the badge and its plume", () => {
    expect(badgeLine("slingshot", "GOLD")).toBe("LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. DOCK AT THE SHIPYARD [5]");
  });
  it("keeps PRESS L for a badge with no plume", () => {
    expect(badgeLine("slingshot", null)).toBe("LOGBOOK // SLINGSHOT EARNED. PRESS L");
  });
  it("uses the portal line for the contact essential", () => {
    expect(badgeLine("contact", null)).toBe("LOGBOOK // CONTACT PORTAL REACHED");
  });
  it("uses the dossier line for the career essential", () => {
    expect(badgeLine("career", null)).toBe("LOGBOOK // CAREER DOSSIER READ");
  });
});

describe("convoySighted", () => {
  const ship = { x: 0, y: 0, z: 0 };
  it("is true inside the radius and false outside", () => {
    expect(convoySighted(ship, [{ x: 500, y: 0, z: 0 }, { x: 119, y: 0, z: 0 }])).toBe(true);
    expect(convoySighted(ship, [{ x: 121, y: 0, z: 0 }])).toBe(false);
  });
  it("does not see across the old seam", () => {
    expect(convoySighted({ x: 240, y: 0, z: 0 }, [{ x: -240, y: 0, z: 0 }])).toBe(false);
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

describe("milestoneFor", () => {
  const essentials: LogbookProgress = { ...withBadges("career", "contact"), visitedDossiers: projects.map((p) => p.id) };
  const all: LogbookProgress = {
    ...withBadges("career", "contact", "slingshot", "comet", "ring", "ore", "convoy"),
    visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
  };
  it("fires on the transition into essentials-done and into all-done", () => {
    expect(milestoneFor(withBadges("contact"), essentials)).toBe("essentials");
    expect(milestoneFor({ ...all, badges: all.badges.slice(0, -1) }, all)).toBe("all");
  });
  it("fires no milestone for progress that was already there", () => {
    expect(milestoneFor(essentials, essentials)).toBeNull();
    expect(milestoneFor(all, all)).toBeNull();
    expect(milestoneFor(empty, withBadges("comet"))).toBeNull();
  });
});

describe("returning visitors (progress saved before the career essential existed)", () => {
  const oldEssentials: LogbookProgress = { ...withBadges("contact"), visitedDossiers: projects.map((p) => p.id) };
  const docked = (p: LogbookProgress): LogbookProgress => ({ ...p, badges: [...p.badges, { id: "career", at: "2026-10-15" }] });

  it("are one essential short, and are pointed at the career dossier", () => {
    expect(essentialsDone(oldEssentials)).toBe(false);
    expect(nextGoal(oldEssentials)?.id).toBe("career");
    expect(logbookCount(oldEssentials)).toEqual({ done: 4, total: 11 });
  });

  it("get the tour milestone once, when they dock at the station", () => {
    expect(milestoneFor(oldEssentials, docked(oldEssentials))).toBe("essentials");
    expect(milestoneFor(docked(oldEssentials), docked(oldEssentials))).toBeNull();
  });

  it("who had everything keep their plumes, and complete the logbook again only by docking", () => {
    const old: LogbookProgress = {
      ...withBadges("contact", "slingshot", "comet", "ring", "ore", "convoy"),
      visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
    };
    expect(allDone(old)).toBe(false);
    expect(plumeAllowed("slingshot", old, () => true)).toBe(true);
    expect(milestoneFor(old, docked(old))).toBe("all");
  });
});

describe("probe hints", () => {
  it("point at the probes", () => {
    expect(byId("ruangrapi").hint).toBe("GRAB THE RUANGRAPI PROBE (HOLD F)");
    expect(byId("portfolio").hint).toBe("GRAB THE FLIGHT-SIM CV PROBE (HOLD F)");
    expect(byId("fuxx").hint).toBe("GRAB THE FUXX PROBE (HOLD F)");
    expect(byId("ruangrapi").hintShort).toBe("RUANGRAPI PROBE");
    expect(byId("portfolio").hintShort).toBe("CV PROBE");
    expect(byId("fuxx").hintShort).toBe("FUXX PROBE");
  });
  it("keeps the titles", () => {
    expect(byId("ruangrapi").title).toBe("Read the RuangRapi dossier");
    expect(byId("portfolio").title).toBe("Read the Flight-Sim CV dossier");
    expect(byId("fuxx").title).toBe("Read the fuxx dossier");
  });
});
