import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { projects, planets, projectById, PLANET_ORBITS, PLANET_PROPS, SHIP_MAX_SPEED, SHIP_WARP_SPEED } from "../src/constants";
import { MOONS, moonOrbitSpeed } from "../src/data/moons";
import { RESERVED_ZONE_IDS, JUMP_TARGETS } from "../src/data/destinations";
import { PROBE_IDS } from "../src/data/probes";
import { PLANET_ATMOSPHERES, PORTFOLIO_ATMOSPHERE } from "../src/data/planetAtmospheres";

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

describe("project <-> probe and planet mapping", () => {
  it("gives every project exactly one probe and one planet keyed by its id", () => {
    const ids = projects.map((p) => p.id);
    expect(PROBE_IDS, "probe ids vs project ids, in order").toEqual(ids);
    expect(Object.keys(PLANET_ORBITS).sort(), "planet ids vs project ids").toEqual([...ids].sort());
  });

  it("gives every planet a type, size, mass, label and colour (PLANET_PROPS), and nothing else", () => {
    expect(Object.keys(PLANET_PROPS).sort(), "PLANET_PROPS keys vs PLANET_ORBITS keys").toEqual(Object.keys(PLANET_ORBITS).sort());
    for (const p of planets) {
      expect(p.type, `${p.name}.type`).toBeTruthy();
      expect(p.size, `${p.name}.size`).toBeGreaterThan(0);
      expect(p.mass, `${p.name}.mass`).toBeGreaterThan(0);
      expect(p.label.trim(), `${p.name}.label`).not.toBe("");
      expect(p.color, `${p.name}.color`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("gives every planet an atmosphere (PLANET_ATMOSPHERES), and nothing else", () => {
    // worldCollide's SOLID_BODIES reads each planet's shell from it unguarded.
    expect(Object.keys(PLANET_ATMOSPHERES).sort(), "PLANET_ATMOSPHERES keys vs PLANET_PROPS keys").toEqual(Object.keys(PLANET_PROPS).sort());
    expect(Object.keys(PLANET_ATMOSPHERES).sort(), "PLANET_ATMOSPHERES keys vs PLANET_ORBITS keys").toEqual(Object.keys(PLANET_ORBITS).sort());
  });

  // constants.ts PLANET_ORBITS: "orbital speed stays ≪ ship speed".
  it("keeps every planet's orbital speed well below cruise, and every moon's below warp", () => {
    for (const p of planets) expect(p.orbit.radius * p.orbit.angularSpeed, p.name).toBeLessThan(SHIP_MAX_SPEED / 4);
    // Moons are magnified insets on their own clock (L13) and can outrun
    // cruise; a pilot they push can still always outrun them at warp.
    for (const m of MOONS) {
      const p = planets[m.planet];
      const v = Math.abs(moonOrbitSpeed(m)) * m.distance * p.size + p.orbit.radius * p.orbit.angularSpeed;
      expect(v, m.id).toBeLessThan(SHIP_WARP_SPEED / 2);
    }
  });

  it("derives one planet per project, in project order", () => {
    expect(planets.map((p) => p.name)).toEqual(projects.map((p) => p.id));
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

/** Planets are scan-only bodies now (spec §4.4): they look the same and stop wearing project colours. */
describe("planets are not projects", () => {
  it("planet labels are OCEAN WORLD / BANDED GIANT / RUST WORLD", () => {
    expect(planets.map((p) => [p.name, p.label])).toEqual([
      ["ruangrapi", "OCEAN WORLD"], ["portfolio", "BANDED GIANT"], ["fuxx", "RUST WORLD"],
    ]);
  });

  it("no planet colour equals a project colour", () => {
    const projectColours = new Set(projects.map((p) => p.color.toLowerCase()));
    for (const p of planets) expect(projectColours.has(p.color.toLowerCase()), p.name).toBe(false);
  });

  it("Portfolio atmosphere colour is still #00f0ff", () => {
    expect(PORTFOLIO_ATMOSPHERE).toBe("#00f0ff");
    expect(PLANET_ATMOSPHERES.portfolio.color).toBe("#00f0ff");
    // The other two keep the literals SpacePlanets always drew.
    expect(PLANET_ATMOSPHERES.ruangrapi.color).toBe("#7dffd0");
    expect(PLANET_ATMOSPHERES.fuxx.color).toBe("#c77dff");
  });

  it("SpacePlanets draws each atmosphere from that table and has no gravity-field circles", () => {
    const src = readFileSync("src/components/canvas/SpacePlanets.tsx", "utf8");
    for (const i of [0, 1, 2]) {
      expect(src).toMatch(new RegExp(`<Atmosphere radius=\\{planets\\[${i}\\]\\.size\\} color=\\{PLANET_ATMOSPHERES\\.${planets[i].name}\\.color\\}`));
    }
    expect(src).not.toMatch(/gravityMats/);
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
  // 2026-10-20: colour no longer the project's, deliberately — the projects
  // moved onto probes; a neutral UI colour from each surface map, plus a
  // descriptive label (project probes, spec §4.4).
  it("keeps the orbital elements the engine was tuned against", () => {
    expect(planets).toEqual([
      {
        name: "ruangrapi", label: "OCEAN WORLD", color: "#6dbf98", size: 12, type: "earth", mass: 1, texelMedianLinear: 0.0533,
        orbit: { radius: 115, angularSpeed: expect.closeTo((Math.PI * 2) / 420, 12), inclination: 0.3491, node: 0, phase: 0 },
      },
      {
        name: "portfolio", label: "BANDED GIANT", color: "#69b5bf", size: 16, type: "gas-giant", mass: 3, texelMedianLinear: 0.095,
        orbit: { radius: 150, angularSpeed: expect.closeTo((Math.PI * 2) / 625.6615, 6), inclination: -0.6981, node: 2.0944, phase: 2.1 },
      },
      {
        name: "fuxx", label: "RUST WORLD", color: "#9469bf", size: 8, type: "mars", mass: 0.3, texelMedianLinear: 0.0138,
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
