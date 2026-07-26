import { describe, it, expect } from "vitest";
import { projects, planets, projectById, PLANET_ORBITS, RESERVED_ZONE_IDS } from "../src/constants";

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

  it("derives one planet per project, in project order", () => {
    expect(planets.map((p) => p.name)).toEqual(projects.map((p) => p.id));
  });

  it("single-sources colour from the project", () => {
    for (const planet of planets) {
      expect(planet.color).toBe(projectById(planet.name)!.color);
    }
  });

  it("resolves a project by zone id, and nothing for a non-project zone", () => {
    expect(projectById("saas")?.title).toBe("Multi-Tenant SaaS Platform");
    expect(projectById("contact")).toBeUndefined();
    expect(projectById("nope")).toBeUndefined();
  });
});

describe("refactor is behaviour-preserving", () => {
  // Pins the world exactly as it was when projects moved into JSON. If a value
  // here changes, the change was intentional and this test should be updated
  // deliberately — it must not be edited to make an accidental drift pass.
  it("keeps the orbital elements the engine was tuned against", () => {
    expect(planets).toEqual([
      {
        name: "saas", color: "#00ff87", size: 4.8,
        orbit: { radius: 115, angularSpeed: (Math.PI * 2) / 420, inclination: 0.3491, node: 0, phase: 0 },
      },
      {
        name: "video", color: "#00f0ff", size: 4.8,
        orbit: { radius: 150, angularSpeed: (Math.PI * 2) / 510, inclination: -0.6981, node: 2.0944, phase: 2.1 },
      },
      {
        name: "agent", color: "#bd00ff", size: 4.8,
        orbit: { radius: 185, angularSpeed: (Math.PI * 2) / 600, inclination: 1.0472, node: 4.1888, phase: 4.2 },
      },
    ]);
  });

  it("keeps the three projects, in order, with their content intact", () => {
    expect(projects.map((p) => [p.id, p.title, p.role, p.duration, p.color])).toEqual([
      ["saas", "Multi-Tenant SaaS Platform", "Lead Architect", "2024 - Present", "#00ff87"],
      ["video", "Viral Video Generator", "Core ML Engineer", "2023 - 2024", "#00f0ff"],
      ["agent", "Custom Multi-Agent Architecture", "R&D AI Engineer", "2024", "#bd00ff"],
    ]);
    expect(projects[0].tech).toEqual(["React", "TypeScript", "Hono", "PostgreSQL", "Stripe", "Docker"]);
    expect(projects[1].description).toContain("Whisper");
    expect(projects[2].tech).toContain("LangChain");
  });
});
