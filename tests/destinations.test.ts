import { describe, it, expect } from "vitest";
import {
  DESTINATIONS, RESERVED_ZONE_IDS, JUMP_TARGETS, destinationById, escapeR, afterProbes, jumpKey,
} from "../src/data/destinations";
import { BODY_IDS, isBodyId } from "../src/data/bodyIds";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { bodies } from "../src/store/spaceStore";
import { STATION_POS } from "../src/data/careerTrail";
import { SHIPYARD_POS } from "../src/data/shipyard";
import { nextWaypoint } from "../src/utils/navigation";
import { PORTAL_POS, PORTAL_LOCK_R, projects } from "../src/constants";
import { PROBE_IDS } from "../src/data/probes";
import { probePos } from "../src/store/probeState";

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
    expect(destinationById("earth")).toBeUndefined();
    for (const d of DESTINATIONS) expect(destinationById(d.id)).toBe(d);
  });
});

describe("jump order", () => {
  it("is every probe in project order, then every destination in table order", () => {
    expect(JUMP_TARGETS.map((t) => t.id)).toEqual([...PROBE_IDS, ...DESTINATIONS.map((d) => d.id)]);
    PROBE_IDS.forEach((id, i) => {
      const proj = projects.find((p) => p.id === id)!;
      expect(JUMP_TARGETS[i]).toMatchObject({ id, label: proj.title, color: proj.color });
    });
    for (const d of DESTINATIONS) {
      expect(JUMP_TARGETS.find((t) => t.id === d.id)).toMatchObject({ label: d.jumpLabel, color: d.color });
    }
  });
});

describe("afterProbes", () => {
  const WAYPOINT = DESTINATIONS.filter((d) => d.waypoint).map((d) => d.id);

  it("walks the waypoint rows only: career, then contact", () => {
    expect(WAYPOINT).toEqual(["career", "contact"]);
    expect(afterProbes([])).toBe("career");
    expect(afterProbes([{ id: "slingshot" }])).toBe("career");
    expect(afterProbes([{ id: "career" }])).toBe("contact");
    expect(afterProbes([{ id: "contact" }])).toBe("career");
    expect(afterProbes([{ id: "career" }, { id: "contact" }])).toBe("contact");
  });

  it("never points at the shipyard, whatever has been earned", () => {
    const ids = ["career", "contact", "shipyard", "slingshot", "comet", "ring", "ore", "convoy"];
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const badges = ids.filter((_, i) => mask & (1 << i)).map((id) => ({ id }));
      expect(afterProbes(badges)).not.toBe("shipyard");
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
  it("are probes 1-3, career 4, shipyard 5, contact 6", () => {
    expect(JUMP_TARGETS.map((t) => t.id)).toEqual([...PROBE_IDS, "career", "shipyard", "contact"]);
    expect(jumpKey("career")).toBe(4);
    expect(jumpKey("shipyard")).toBe(5);
    expect(jumpKey("contact")).toBe(6);
    expect(jumpKey(PROBE_IDS[0])).toBe(1);
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

  it("orders the waypoint: unread probes, then the career station, then the contact portal", () => {
    const names = [...PROBE_IDS];
    const bodies = Object.fromEntries(names.map((n, i) => [n, { x: 10 * (i + 1), y: 0, z: 0 }]));
    const ship = { x: 0, y: 0, z: 0 };
    expect(nextWaypoint(ship, names, bodies, [], afterProbes([]))).toBe(names[0]);
    expect(nextWaypoint(ship, names, bodies, names, afterProbes([]))).toBe("career");
    expect(nextWaypoint(ship, names, bodies, names, afterProbes([{ id: "contact" }]))).toBe("career");
    expect(nextWaypoint(ship, names, bodies, names, afterProbes([{ id: "career" }]))).toBe("contact");
    expect(nextWaypoint(ship, names, bodies, names, afterProbes([{ id: "career" }, { id: "contact" }]))).toBe("contact");
  });
});

/**
 * The recruiter path (the probes, then the career station, then the contact
 * portal) is unchanged by the bodies: no jump key, no waypoint, no zone.
 */
describe("the bodies stay off the recruiter path", () => {
  it("JUMP_TARGETS names no body, and keys 1-6 map exactly as before", () => {
    for (const t of JUMP_TARGETS) expect(isBodyId(t.id), t.id).toBe(false);
    expect(JUMP_TARGETS.map((t) => t.id)).toEqual(["ruangrapi", "portfolio", "fuxx", "career", "shipyard", "contact"]);
    for (const id of BODY_IDS) expect(jumpKey(id)).toBe(0);
  });

  it("the waypoint walks the probes only, no body, whatever the ship is next to", () => {
    const names = PROBE_IDS;
    for (const n of names) expect(isBodyId(n), n).toBe(false);
    expect(Object.keys(bodies).filter(isBodyId).length).toBe(SOLAR_BODIES.length);
    for (const b of SOLAR_BODIES) {
      const ship = { ...bodies[b.id] };
      for (const visited of [[], names]) {
        for (const fallback of [afterProbes([]), afterProbes([{ id: "career" }])]) {
          expect(isBodyId(nextWaypoint(ship, names, probePos, visited, fallback))).toBe(false);
        }
      }
    }
  });

  // Was "the zone/lock loop checks the planets only": the planets left it
  // with the project probes (spec §4.4); only destinations dock.
  it("no body is a dock", () => {
    for (const id of BODY_IDS) expect(destinationById(id), id).toBeUndefined();
  });
});
