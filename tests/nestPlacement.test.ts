import { describe, it, expect } from "vitest";
import { NEST_CENTRE, NEST_BUOY_POS, NEST_TOW_POSE, NEST_SCAN_ID, NEST_LABEL, NEST_RED } from "../src/data/nest";
import { NEST_LEASH_R, NEST_BUOY_R, NEST_LOAD_R, TOW_PAST_BUOY } from "../src/utils/combat/constants";
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

  it("puts the buoy 120 u toward the Sun and the tow outside the fighting area, nose on the Nest", () => {
    expect(Math.abs(dist(NEST_BUOY_POS, NEST_CENTRE) - NEST_BUOY_R)).toBeLessThan(1e-9);
    expect(NEST_BUOY_R).toBe(120);
    const toSun = unit([-NEST_CENTRE[0], -NEST_CENTRE[1], -NEST_CENTRE[2]]);
    expect(dot(unit(sub(NEST_BUOY_POS, NEST_CENTRE)), toSun)).toBeGreaterThan(1 - 1e-9);
    const tow: Vec3 = [NEST_TOW_POSE.x, NEST_TOW_POSE.y, NEST_TOW_POSE.z];
    expect(Math.abs(dist(tow, NEST_CENTRE) - (NEST_BUOY_R + TOW_PAST_BUOY))).toBeLessThan(1e-9);
    expect(dist(tow, NEST_CENTRE)).toBeGreaterThan(NEST_LEASH_R);
    expect(dot(unit(sub(tow, NEST_CENTRE)), toSun)).toBeGreaterThan(1 - 1e-9);
    const n = noseDirection(NEST_TOW_POSE.yaw, NEST_TOW_POSE.pitch);
    expect(dot([n.x, n.y, n.z], unit(sub(NEST_CENTRE, tow)))).toBeGreaterThan(1 - 1e-9);
  });

  it("names the Nest for the scan, the radar and the HUD", () => {
    expect(NEST_SCAN_ID).toBe("the_nest");
    expect(NEST_LABEL).toBe("THE_NEST");
    expect(NEST_RED).toBe("#ff3b4a");
  });
});
