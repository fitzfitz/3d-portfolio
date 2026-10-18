import { describe, it, expect } from "vitest";
import {
  DESTINATIONS, RESERVED_ZONE_IDS, JUMP_TARGETS, ZONE_PLANETS, destinationById, escapeR, afterPlanets, jumpKey,
} from "../src/data/destinations";
import { WORLDS, WORLD_IDS, isWorld } from "../src/data/worlds";
import { bodies } from "../src/store/spaceStore";
import { STATION_POS } from "../src/data/careerTrail";
import { SHIPYARD_POS } from "../src/data/shipyard";
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
  const WAYPOINT = DESTINATIONS.filter((d) => d.waypoint).map((d) => d.id);

  it("walks the waypoint rows only: career, then contact", () => {
    expect(WAYPOINT).toEqual(["career", "contact"]);
    expect(afterPlanets([])).toBe("career");
    expect(afterPlanets([{ id: "slingshot" }])).toBe("career");
    expect(afterPlanets([{ id: "career" }])).toBe("contact");
    expect(afterPlanets([{ id: "contact" }])).toBe("career");
    expect(afterPlanets([{ id: "career" }, { id: "contact" }])).toBe("contact");
  });

  it("never points at the shipyard, whatever has been earned", () => {
    const ids = ["career", "contact", "shipyard", "slingshot", "comet", "ring", "ore", "convoy"];
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const badges = ids.filter((_, i) => mask & (1 << i)).map((id) => ({ id }));
      expect(afterPlanets(badges)).not.toBe("shipyard");
    }
  });
});

describe("shipyard row", () => {
  it("sits at the shipyard with the station's dock radii and stays out of the waypoint chain", () => {
    const s = destinationById("shipyard")!;
    expect(s).toMatchObject({
      id: "shipyard", label: "SHIPYARD", jumpLabel: "Shipyard", scanLabel: "DRYDOCK_01",
      color: "#5b8cff", waypoint: false, zoneR: 8.5, lockR: 7.2, retainR: 13, orbitR: 10, jumpR: 6.7,
    });
    expect(s.pos).toBe(SHIPYARD_POS);
    expect(s.jumpR).toBeLessThan(s.lockR);
  });

  it("keeps career and contact on the waypoint chain", () => {
    expect(destinationById("career")!.waypoint).toBe(true);
    expect(destinationById("contact")!.waypoint).toBe(true);
  });
});

describe("jump keys", () => {
  it("are planets 1-3, career 4, shipyard 5, contact 6", () => {
    expect(JUMP_TARGETS.map((t) => t.id)).toEqual([...planets.map((p) => p.name), "career", "shipyard", "contact"]);
    expect(jumpKey("career")).toBe(4);
    expect(jumpKey("shipyard")).toBe(5);
    expect(jumpKey("contact")).toBe(6);
    expect(jumpKey(planets[0].name)).toBe(1);
    expect(jumpKey("dormant_gate")).toBe(0);
  });
});

describe("career station row", () => {
  it("sits at the trail's station with the portal's radii scaled for a ~5-unit model", () => {
    const c = destinationById("career")!;
    expect(c).toMatchObject({
      id: "career", label: "CAREER STATION", jumpLabel: "Career", scanLabel: "STATION_CAREER",
      color: "#ffb547", zoneR: 8.5, lockR: 7.2, retainR: 13, orbitR: 10, jumpR: 6.7,
    });
    expect(c.pos).toBe(STATION_POS);
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

/**
 * The recruiter path (planets, then the career station, then the contact
 * portal) is unchanged by the worlds: no jump key, no waypoint, no zone.
 */
describe("the worlds stay off the recruiter path", () => {
  it("JUMP_TARGETS names no world, and keys 1-6 map exactly as before", () => {
    for (const t of JUMP_TARGETS) expect(isWorld(t.id), t.id).toBe(false);
    expect(JUMP_TARGETS.map((t) => t.id)).toEqual(["ruangrapi", "portfolio", "fuxx", "career", "shipyard", "contact"]);
    for (const id of WORLD_IDS) expect(jumpKey(id)).toBe(0);
  });

  it("nextWaypoint never returns a world, even with the ship at one", () => {
    const names = planets.map((p) => p.name);
    for (const w of WORLDS) {
      const ship = { ...bodies[w.id] };
      for (const visited of [[], names]) {
        for (const fallback of [afterPlanets([]), afterPlanets([{ id: "career" }])]) {
          expect(isWorld(nextWaypoint(ship, names, bodies, visited, fallback))).toBe(false);
        }
      }
    }
  });

  it("the zone/lock loop checks the planets only", () => {
    expect(ZONE_PLANETS.map((p) => p.name)).toEqual(planets.map((p) => p.name));
    for (const p of ZONE_PLANETS) expect(isWorld(p.name), p.name).toBe(false);
  });
});
