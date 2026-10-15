import { describe, it, expect } from "vitest";
import {
  DESTINATIONS, RESERVED_ZONE_IDS, JUMP_TARGETS, destinationById, escapeR, afterPlanets,
} from "../src/data/destinations";
import { STATION_POS } from "../src/data/careerTrail";
import { nextWaypoint } from "../src/utils/navigation";
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
    expect(DESTINATIONS.length).toBeGreaterThan(1);
    expect(afterPlanets([])).toBe(DESTINATIONS[0].id);
    expect(afterPlanets([{ id: "slingshot" }])).toBe(DESTINATIONS[0].id);
    expect(afterPlanets([{ id: DESTINATIONS[0].id }])).toBe(DESTINATIONS[1].id);
    expect(afterPlanets([{ id: DESTINATIONS[1].id }])).toBe(DESTINATIONS[0].id);
    expect(afterPlanets(DESTINATIONS.map((d) => ({ id: d.id })))).toBe(DESTINATIONS[DESTINATIONS.length - 1].id);
  });
});

describe("career station row", () => {
  it("sits at the trail's station with the portal's radii scaled for a ~5-unit model", () => {
    const c = destinationById("career")!;
    expect(c).toMatchObject({
      id: "career", label: "CAREER STATION", jumpLabel: "Career", scanLabel: "STATION_CAREER",
      color: "#ffb547", zoneR: 8.5, lockR: 5.8, retainR: 13, orbitR: 10, jumpR: 5.4,
    });
    expect(c.pos).toBe(STATION_POS);
  });

  it("comes before the contact portal: keys 4 and 5, d-pad left and Menu", () => {
    const ids = JUMP_TARGETS.map((t) => t.id);
    expect(ids.indexOf("career")).toBe(3);
    expect(ids.indexOf("contact")).toBe(4);
  });

  it("orders the waypoint: unread planets, then the career station, then the contact portal", () => {
    const names = planets.map((p) => p.name);
    const bodies = Object.fromEntries(planets.map((p, i) => [p.name, { x: 10 * (i + 1), y: 0, z: 0 }]));
    const ship = { x: 0, y: 0, z: 0 };
    expect(nextWaypoint(ship, names, bodies, [], afterPlanets([]))).toBe(names[0]);
    expect(nextWaypoint(ship, names, bodies, names, afterPlanets([]))).toBe("career");
    expect(nextWaypoint(ship, names, bodies, names, afterPlanets([{ id: "contact" }]))).toBe("career");
    expect(nextWaypoint(ship, names, bodies, names, afterPlanets([{ id: "career" }]))).toBe("contact");
    expect(nextWaypoint(ship, names, bodies, names, afterPlanets([{ id: "career" }, { id: "contact" }]))).toBe("contact");
  });
});
