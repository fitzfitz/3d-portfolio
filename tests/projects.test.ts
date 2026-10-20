import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { projects, projectById, SHIP_MAX_SPEED } from "../src/constants";
import { RESERVED_ZONE_IDS, JUMP_TARGETS } from "../src/data/destinations";
import { PROBE_IDS } from "../src/data/probes";
import { BODY_IDS } from "../src/data/bodyIds";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { JD_J2000, orbitShape, visVivaKmS } from "../src/utils/ephemeris";
import { KM_PER_UNIT, SECONDS_PER_GAME_SECOND } from "../src/utils/realUnits";

/**
 * projects.json is content, so TypeScript cannot check it the way it checks a
 * typed const. These tests are that missing check — plus the bijection with the
 * probes, which is what makes "adding a project fails loudly" true rather
 * than aspirational.
 */
describe("projects.json content", () => {
  it("has unique ids", () => {
    const ids = projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never uses a reserved zone id", () => {
    // A project id keys its probe's jump target and radio pool, beside the
    // destinations' ("contact" is the portal's). A project with that id would
    // collide with the portal in both.
    for (const p of projects) {
      expect(RESERVED_ZONE_IDS).not.toContain(p.id);
    }
  });

  it("has non-empty required content on every project", () => {
    for (const p of projects) {
      for (const field of ["id", "title", "role", "duration", "short", "description"] as const) {
        expect(p[field].trim(), `${p.id}.${field}`).not.toBe("");
      }
      expect(p.tech.length, `${p.id}.tech`).toBeGreaterThan(0);
      expect(p.tech.every((t) => t.trim() !== ""), `${p.id}.tech entries`).toBe(true);
    }
  });

  it("has a valid hex colour on every project", () => {
    for (const p of projects) {
      expect(p.color, `${p.id}.color`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("project <-> probe mapping", () => {
  it("gives every project exactly one probe keyed by its id", () => {
    const ids = projects.map((p) => p.id);
    expect(PROBE_IDS, "probe ids vs project ids, in order").toEqual(ids);
  });

  // The real orbits: "orbital speed stays well below ship speed", so a pilot
  // can always catch any body at cruise. The fastest is Mercury at perihelion
  // (59 km/s, ~3.4 u/s on the orrery clock).
  it("keeps every body's orbital speed, even at perihelion, under a third of cruise", () => {
    for (const b of SOLAR_BODIES) {
      const s = orbitShape(b.orbit.el, JD_J2000);
      const uPerS = (visVivaKmS(s.a * (1 - s.e), s.a) * SECONDS_PER_GAME_SECOND) / KM_PER_UNIT;
      expect(uPerS, b.id).toBeLessThan(SHIP_MAX_SPEED / 3);
    }
  });

  it("single-sources each probe's colour from its project", () => {
    for (const id of PROBE_IDS) {
      expect(JUMP_TARGETS.find((t) => t.id === id)!.color, id).toBe(projectById(id)!.color);
    }
  });

  it("resolves a project by id, and nothing for a non-project id", () => {
    expect(projectById("ruangrapi")?.title).toBe("RuangRapi");
    expect(projectById("contact")).toBeUndefined();
    expect(projectById("nope")).toBeUndefined();
  });
});

/**
 * The bodies are the real Solar System's (real-solar-system spec §5.1): the
 * project ids stay probe ids only, and no body wears a project colour.
 */
describe("bodies are not projects", () => {
  it("no body id is a project id", () => {
    for (const p of projects) expect((BODY_IDS as readonly string[]).includes(p.id), p.id).toBe(false);
  });

  it("no body colour equals a project colour", () => {
    const projectColours = new Set(projects.map((p) => p.color.toLowerCase()));
    for (const b of SOLAR_BODIES) expect(projectColours.has(b.color.toLowerCase()), b.id).toBe(false);
  });

  it("SpacePlanets draws no body and no gravity-field circles", () => {
    const src = readFileSync("src/components/canvas/SpacePlanets.tsx", "utf8");
    expect(src).not.toMatch(/<Atmosphere|makeSphereLOD|PlanetRing_/);
    expect(src).not.toMatch(/gravityMats/);
  });
});

describe("refactor is behaviour-preserving", () => {
  // The planets' pinned elements went with the real-system cut-over (Task 6):
  // the bodies are the real Solar System's (tests/solarSystem.test.ts).
  // 2026-10-10: the template's placeholder projects were replaced with the
  // owner's real ones. Colours and order (and so each planet's look and
  // orbit) are unchanged; only ids and content moved.
  it("keeps the three projects, in order, with their content intact", () => {
    expect(projects.map((p) => [p.id, p.title, p.role, p.duration, p.color])).toEqual([
      ["ruangrapi", "RuangRapi", "Personal project", "2026", "#00ff87"],
      ["portfolio", "This Flight-Sim CV", "Personal project", "2026", "#00f0ff"],
      ["fuxx", "fuxx", "Personal project", "2026", "#bd00ff"],
    ]);
    expect(projects[0].tech).toContain("Supabase");
    expect(projects[1].tech).toContain("React Three Fiber");
    expect(projects[2].tech).toEqual(["Rust", "GPUI"]);
  });

  it("links every project to a public source repo", () => {
    for (const p of projects) expect(p.repo).toMatch(/^https:\/\/github\.com\/fitzfitz\//);
  });
});
