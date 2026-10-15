import { describe, it, expect } from "vitest";
import {
  DESTINATIONS, RESERVED_ZONE_IDS, JUMP_TARGETS, destinationById, escapeR, afterPlanets,
} from "../src/data/destinations";
import { PORTAL_POS, PORTAL_LOCK_R, projects, planets } from "../src/constants";

describe("destination table", () => {
  it("keeps the contact portal exactly as it was before the table", () => {
    const c = destinationById("contact")!;
    expect(c).toMatchObject({
      id: "contact", label: "CONTACT PORTAL", jumpLabel: "Contact", scanLabel: "PORTAL_SUN",
      color: "#ec4899", zoneR: 2.2, lockR: 1.5, retainR: 3.4, orbitR: 2.6,
    });
    expect(c.pos).toEqual([0, 95, -150]);
    expect(c.pos).toBe(PORTAL_POS);
    // Spaceship's old JUMP_PORTAL_R and break-orbit push, now read from the table.
    expect(c.jumpR).toBe(PORTAL_LOCK_R * 0.8);
    expect(escapeR(c)).toBeCloseTo(2.2 * 1.15 * 1.5, 10);
  });

  it("has unique ids", () => {
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
  });

  it("reserves every destination id so no project can claim one", () => {
    expect([...RESERVED_ZONE_IDS]).toEqual(DESTINATIONS.map((d) => d.id));
    for (const p of projects) expect(RESERVED_ZONE_IDS).not.toContain(p.id);
  });

  it("looks destinations up by id, and nothing else", () => {
    expect(destinationById(null)).toBeUndefined();
    expect(destinationById(undefined)).toBeUndefined();
    expect(destinationById(planets[0].name)).toBeUndefined();
    for (const d of DESTINATIONS) expect(destinationById(d.id)).toBe(d);
  });
});

describe("jump order", () => {
  it("is every planet in orbit order, then every destination in table order", () => {
    expect(JUMP_TARGETS.map((t) => t.id)).toEqual([...planets.map((p) => p.name), ...DESTINATIONS.map((d) => d.id)]);
    for (const d of DESTINATIONS) {
      expect(JUMP_TARGETS.find((t) => t.id === d.id)).toMatchObject({ label: d.jumpLabel, color: d.color });
    }
  });
});

describe("afterPlanets", () => {
  it("points at the first destination whose essential is not done, then at the last one", () => {
    expect(afterPlanets([])).toBe(DESTINATIONS[0].id);
    expect(afterPlanets([{ id: "slingshot" }])).toBe(DESTINATIONS[0].id);
    expect(afterPlanets(DESTINATIONS.map((d) => ({ id: d.id })))).toBe(DESTINATIONS[DESTINATIONS.length - 1].id);
  });
});
