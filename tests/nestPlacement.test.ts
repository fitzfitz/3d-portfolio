import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NEST_CENTRE, NEST_BUOY_POS, NEST_TOW_POSE, NEST_SCAN_ID, NEST_LABEL, NEST_RED } from "../src/data/nest";
import { NEST_LEASH_R, NEST_BUOY_R, NEST_LOAD_R, NEST_ZONE_R, TOW_PAST_BUOY, TOW_SIDE } from "../src/utils/combat/constants";
import {
  buildNestRocks, NEST_ROCK_SEED, NEST_ROCKS, NEST_ROCK_COLLIDERS, NEST_GLOW, NEST_GLOW_R,
} from "../src/data/nestRocks";
import { beltRockGeometry, BELT_ROCK_RADIUS } from "../src/components/canvas/beltRock";
import { noseDirection } from "../src/utils/pitchFlight";
import { SPAWN } from "../src/data/spawn";
import { PROBE_SLOTS } from "../src/data/probes";
import { PORTAL_POS } from "../src/constants";
import { STATION_POS, BUOYS } from "../src/data/careerTrail";
import { SHIPYARD_POS } from "../src/data/shipyard";
import { GATE_POS, GATE_NORMAL } from "../src/data/dormantGate";
import { DEEP_SPACE_POINT } from "./e2e/deepSpacePoint.mjs";
import { BODY_ORBITS, JELLY_POINTS, JELLY_KEEP_RADIUS, deepSpaceGap, DEEP_SPACE_MIN, type Vec3 } from "./helpers/solarClearance";

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b)))));
const DEG = Math.PI / 180;

describe("the Nest's placement", () => {
  it("sits below the plane, 300–500 u from spawn", () => {
    const d = dist(NEST_CENTRE, [SPAWN.x, SPAWN.y, SPAWN.z]);
    expect(NEST_CENTRE[1]).toBeLessThan(0);
    expect(d).toBeGreaterThanOrEqual(300);
    expect(d).toBeLessThanOrEqual(500);
  });

  it("clears every swept orbit by DEEP_SPACE_MIN + the fighting area", () => {
    expect(deepSpaceGap(NEST_CENTRE)).toBeGreaterThanOrEqual(DEEP_SPACE_MIN + NEST_LEASH_R);
  });

  it("is at least 250 u from the deep-space point", () => {
    expect(dist(NEST_CENTRE, DEEP_SPACE_POINT as unknown as Vec3)).toBeGreaterThanOrEqual(250);
  });

  it("never loads on the programs probe's tour: every stop is more than 200 u away", () => {
    const stops: [string, Vec3][] = [
      ["contact portal", [PORTAL_POS[0], PORTAL_POS[1], PORTAL_POS[2]]],
      ["career station", [STATION_POS[0], STATION_POS[1], STATION_POS[2] + 14]],
      ["career trail", [BUOYS[2].pos[0] + 10, BUOYS[2].pos[1], BUOYS[2].pos[2]]],
      ["shipyard", [SHIPYARD_POS[0], SHIPYARD_POS[1], SHIPYARD_POS[2] + 14]],
      ["dormant gate", [GATE_POS[0] + GATE_NORMAL[0] * 40, GATE_POS[1] + GATE_NORMAL[1] * 40, GATE_POS[2] + GATE_NORMAL[2] * 40]],
      ["sun", [0, 0, 40]],
      ["deep space (probe)", [-230, -210, -230]],
      ["deep space point", DEEP_SPACE_POINT as unknown as Vec3],
      ["world edge", [2130, 1775, 2130]],
      ...PROBE_SLOTS.flatMap((p, k) => [p.home, ...p.remote].map((s, i): [string, Vec3] => [`probe slot ${k + 1} spot ${i}`, [s[0], s[1], s[2] + 12]])),
      ...BODY_ORBITS.flatMap((o) => o.pts.map((p, i): [string, Vec3] => [`${o.name} orbit ${i}`, [p[0], p[1], p[2] + 30]])),
    ];
    expect(stops.length).toBeGreaterThan(2000);
    for (const [name, p] of stops) expect(dist(NEST_CENTRE, p), name).toBeGreaterThan(NEST_LOAD_R);
  });

  it("keeps the jellyfish's path out of the fighting area", () => {
    expect(JELLY_POINTS.length).toBe(400);
    for (const p of JELLY_POINTS) expect(dist(NEST_CENTRE, p)).toBeGreaterThan(NEST_LEASH_R + JELLY_KEEP_RADIUS);
  });

  it("puts the buoy 120 u toward the Sun and the tow outside the fighting area, beside the buoy, nose on the Nest", () => {
    expect(Math.abs(dist(NEST_BUOY_POS, NEST_CENTRE) - NEST_BUOY_R)).toBeLessThan(1e-9);
    expect(NEST_BUOY_R).toBe(120);
    const toSun = unit([-NEST_CENTRE[0], -NEST_CENTRE[1], -NEST_CENTRE[2]]);
    expect(dot(unit(sub(NEST_BUOY_POS, NEST_CENTRE)), toSun)).toBeGreaterThan(1 - 1e-9);
    const tow: Vec3 = [NEST_TOW_POSE.x, NEST_TOW_POSE.y, NEST_TOW_POSE.z];
    // TOW_PAST_BUOY past the buoy along the Sun line, TOW_SIDE off it (Ruling N3).
    const along = dot(sub(tow, NEST_CENTRE), toSun);
    expect(along).toBeCloseTo(NEST_BUOY_R + TOW_PAST_BUOY, 9);
    expect(dist(tow, [NEST_CENTRE[0] + toSun[0] * along, NEST_CENTRE[1] + toSun[1] * along, NEST_CENTRE[2] + toSun[2] * along]))
      .toBeCloseTo(TOW_SIDE, 9);
    expect(TOW_SIDE).toBe(16);
    expect(dist(tow, NEST_CENTRE)).toBeGreaterThanOrEqual(120);
    expect(dist(tow, NEST_CENTRE)).toBeGreaterThan(NEST_LEASH_R);
    const n = noseDirection(NEST_TOW_POSE.yaw, NEST_TOW_POSE.pitch);
    expect(dot([n.x, n.y, n.z], unit(sub(NEST_CENTRE, tow)))).toBeGreaterThan(1 - 1e-9);
    // The buoy stands to one side of the view, not in front of the cluster.
    expect(angle(sub(NEST_BUOY_POS, tow), sub(NEST_CENTRE, tow))).toBeGreaterThan(10 * DEG);
  });

  it("names the Nest for the scan, the radar and the HUD", () => {
    expect(NEST_SCAN_ID).toBe("the_nest");
    expect(NEST_LABEL).toBe("THE_NEST");
    expect(NEST_RED).toBe("#ff3b4a");
  });
});

describe("the Nest's rock cluster", () => {
  /** The buoy direction from the centre: the cluster's mouth faces it. */
  const L = unit(sub(NEST_BUOY_POS, NEST_CENTRE));

  it("is seeded: the same seed builds the same rocks", () => {
    expect(buildNestRocks(NEST_ROCK_SEED)).toEqual(NEST_ROCKS);
  });

  it("is a shell of 18–24 rocks, 10–14 u out, scale 1.2–2.0, with its mouth toward the buoy", () => {
    expect(NEST_ROCKS.length).toBeGreaterThanOrEqual(18);
    expect(NEST_ROCKS.length).toBeLessThanOrEqual(24);
    for (const r of NEST_ROCKS) {
      const d = Math.hypot(...r.offset);
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(14);
      expect(r.scale).toBeGreaterThanOrEqual(1.2);
      expect(r.scale).toBeLessThanOrEqual(2.0);
      expect(angle(r.offset, L)).toBeGreaterThan(40 * DEG); // the mouth faces the buoy
    }
  });

  it("is solid to the ship, clear of the centre's sleeper, the zone line, the buoy and the tow", () => {
    expect(NEST_ROCK_COLLIDERS).toHaveLength(NEST_ROCKS.length);
    NEST_ROCK_COLLIDERS.forEach((c, i) => {
      expect(c.id).toBe(`nest_rock_${i}`);
      const p: Vec3 = [c.x, c.y, c.z];
      expect(dist(p, [NEST_CENTRE[0] + NEST_ROCKS[i].offset[0], NEST_CENTRE[1] + NEST_ROCKS[i].offset[1],
        NEST_CENTRE[2] + NEST_ROCKS[i].offset[2]])).toBeLessThan(1e-9);
      expect(c.r).toBeCloseTo(2.2 * NEST_ROCKS[i].scale, 12);
      expect(dist(p, NEST_CENTRE) - c.r).toBeGreaterThanOrEqual(4.5); // the sleeping tardigrade's new hit radius (Task 5)
      expect(dist(p, NEST_CENTRE) + c.r).toBeLessThanOrEqual(NEST_ZONE_R - 40);
      expect(dist(p, NEST_BUOY_POS)).toBeGreaterThan(100);
      expect(dist(p, [NEST_TOW_POSE.x, NEST_TOW_POSE.y, NEST_TOW_POSE.z])).toBeGreaterThan(100);
    });
    expect(readFileSync("src/components/canvas/Spaceship.tsx", "utf8")).toMatch(/COLLIDERS = \[[^\]]*NEST_ROCK_COLLIDERS/);
  });

  it("draws the belt's low-poly rock (its geometry and material, so its program), at most 15k triangles in all (Ruling N4)", () => {
    const g = beltRockGeometry();
    const tris = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    expect(tris * NEST_ROCKS.length).toBeLessThanOrEqual(15_000);
    expect(BELT_ROCK_RADIUS).toBe(1.1);
    const belt = readFileSync("src/components/canvas/AsteroidBelt.tsx", "utf8");
    const cluster = readFileSync("src/components/canvas/nest/NestCluster.tsx", "utf8");
    for (const src of [belt, cluster]) expect(src).toMatch(/beltRockGeometry\(\)[\s\S]*beltRockMaterial\(|beltRockMaterial\([\s\S]*beltRockGeometry\(\)/);
    expect(cluster).not.toMatch(/asteroidVariants|\.clone\(\)/);
  });

  it("glows inside: 40 points within NEST_GLOW_R (7 u) of the centre", () => {
    expect(NEST_GLOW_R).toBe(7);
    expect(NEST_GLOW).toHaveLength(40);
    for (const g of NEST_GLOW) expect(Math.hypot(...g)).toBeLessThanOrEqual(NEST_GLOW_R);
  });
});
