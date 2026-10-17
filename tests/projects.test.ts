import { describe, it, expect } from "vitest";
import { projects, planets, projectById, PLANET_ORBITS, PLANET_PROPS } from "../src/constants";
import { RESERVED_ZONE_IDS } from "../src/data/destinations";

/**
 * projects.json is content, so TypeScript cannot check it the way it checks a
 * typed const. These tests are that missing check — plus the bijection with the
 * orbit table, which is what makes "adding a project fails loudly" true rather
 * than aspirational.
 */
describe("projects.json content", () => {
  it("has unique ids", () => {
    const ids = projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never uses a reserved zone id", () => {
    // `activeZone` is also "contact" for the portal. A project with that id
    // would make flying to the portal open a project dossier.
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

describe("project <-> planet mapping", () => {
  it("gives every project exactly one planet", () => {
    const orphans = projects.filter((p) => !(p.id in PLANET_ORBITS)).map((p) => p.id);
    expect(orphans, "projects with no orbital elements").toEqual([]);
  });

  it("gives every planet exactly one project", () => {
    const known = new Set(projects.map((p) => p.id));
    const orphans = Object.keys(PLANET_ORBITS).filter((id) => !known.has(id));
    expect(orphans, "orbits with no project").toEqual([]);
  });

  it("gives every planet a type, size and mass (PLANET_PROPS), and nothing else", () => {
    expect(Object.keys(PLANET_PROPS).sort(), "PLANET_PROPS keys vs PLANET_ORBITS keys").toEqual(Object.keys(PLANET_ORBITS).sort());
    for (const p of planets) {
      expect(p.type, `${p.name}.type`).toBeTruthy();
      expect(p.size, `${p.name}.size`).toBeGreaterThan(0);
      expect(p.mass, `${p.name}.mass`).toBeGreaterThan(0);
    }
  });

  it("derives one planet per project, in project order", () => {
    expect(planets.map((p) => p.name)).toEqual(projects.map((p) => p.id));
  });

  it("single-sources colour from the project", () => {
    for (const planet of planets) {
      expect(planet.color).toBe(projectById(planet.name)!.color);
    }
  });

  it("resolves a project by zone id, and nothing for a non-project zone", () => {
    expect(projectById("ruangrapi")?.title).toBe("RuangRapi");
    expect(projectById("contact")).toBeUndefined();
    expect(projectById("nope")).toBeUndefined();
  });
});

describe("refactor is behaviour-preserving", () => {
  // Pins the world exactly as it was when projects moved into JSON. If a value
  // here changes, the change was intentional and this test should be updated
  // deliberately — it must not be edited to make an accidental drift pass.
  // 2026-10-12: size 4.8 -> 16, deliberately (the scale pass).
  // 2026-10-17: sizes by type, deliberately — portfolio 16 (gas giant), ruangrapi 12
  // (earth), fuxx 8 (mars) — with masses 3 / 1 / 0.3 (sub-project B, L36).
  // 2026-10-16: periods 510/600 s -> ~625.7/857.0 s, deliberately: Kepler's third
  // law with one sun (docs/UNIVERSE-RULES.md L7). Ruangrapi keeps 420 s.
  it("keeps the orbital elements the engine was tuned against", () => {
    expect(planets).toEqual([
      {
        name: "ruangrapi", color: "#00ff87", size: 12, type: "earth", mass: 1,
        orbit: { radius: 115, angularSpeed: expect.closeTo((Math.PI * 2) / 420, 12), inclination: 0.3491, node: 0, phase: 0 },
      },
      {
        name: "portfolio", color: "#00f0ff", size: 16, type: "gas-giant", mass: 3,
        orbit: { radius: 150, angularSpeed: expect.closeTo((Math.PI * 2) / 625.6615, 6), inclination: -0.6981, node: 2.0944, phase: 2.1 },
      },
      {
        name: "fuxx", color: "#bd00ff", size: 8, type: "mars", mass: 0.3,
        orbit: { radius: 185, angularSpeed: expect.closeTo((Math.PI * 2) / 856.9592, 6), inclination: 1.0472, node: 4.1888, phase: 4.2 },
      },
    ]);
  });

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
