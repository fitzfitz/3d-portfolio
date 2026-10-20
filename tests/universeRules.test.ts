import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SUN_RADIUS, GM_SUN, PROGRADE } from "../src/constants";
import { keplerGM, keplerOmega, keplerPeriod } from "../src/utils/kepler";
import { COMET_ELEMENTS } from "../src/data/smallBodyField";
import { cometWorldPosition } from "../src/utils/beltRocks";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { bodyPositionAt } from "../src/utils/bodyPositions";
import { orbitShape, JD_J2000 } from "../src/utils/ephemeris";

// docs/UNIVERSE-RULES.md: every orbit around the sun obeys one Kepler law
// (T² = 4π²a³/GM with a single GM_SUN), and everything turns the same way.
// Departures from reality are listed in that doc. Task 6 kept only what still
// holds with the real Solar System; Task 16 rewrites this file to §8's laws.

type V = { x: number; y: number; z: number };
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (v: V) => { const n = Math.hypot(v.x, v.y, v.z); return { x: v.x / n, y: v.y / n, z: v.z / n }; };
const deg = (a: V, b: V) => (Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b))))) * 180) / Math.PI;

/** Direction of r × v: which way a path turns. */
function turnAxis(pos: (t: number) => V, t = 3.7): V {
  const h = 1e-3, p = pos(t), q = pos(t + h);
  return cross(p, { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z });
}

/** Turn axis of a body spinning by rotation.y = rate·t (a surface point at +X). */
function spinAxis(rate: number): V {
  return turnAxis((t) => {
    const o = new THREE.Object3D();
    o.rotation.y = rate * t;
    o.updateMatrixWorld(true);
    return new THREE.Vector3(1, 0, 0).applyMatrix4(o.matrixWorld);
  });
}

const orbitAxis = (b: (typeof SOLAR_BODIES)[number]) => turnAxis((t) => bodyPositionAt(b, t, { x: 0, y: 0, z: 0 }));
/** The reference: Earth's orbit (the ecliptic), whose pole is world +Y. */
const reference = orbitAxis(SOLAR_BODIES.find((b) => b.id === "earth")!);
const ECLIPTIC_NORTH = { x: 0, y: 1, z: 0 };

describe("Kepler helpers", () => {
  it("keplerGM inverts keplerPeriod and keplerOmega", () => {
    const gm = keplerGM(115, 420);
    expect(keplerPeriod(115, gm)).toBeCloseTo(420, 9);
    expect(keplerOmega(115, gm)).toBeCloseTo((Math.PI * 2) / 420, 12);
  });
  it("period grows with a^1.5", () => {
    expect(keplerPeriod(400, 1) / keplerPeriod(100, 1)).toBeCloseTo(8, 9);
  });
});

describe("L7 one sun: every heliocentric orbit obeys Kepler's third law with GM_SUN", () => {
  it("outer bodies are slower: years strictly increase with semi-major axis", () => {
    const byA = [...SOLAR_BODIES].sort((a, b) => orbitShape(a.orbit.el, JD_J2000).a - orbitShape(b.orbit.el, JD_J2000).a);
    for (let i = 1; i < byA.length; i++) expect(byA[i].facts.yearDays, byA[i].id).toBeGreaterThan(byA[i - 1].facts.yearDays);
  });
  it.each(SOLAR_BODIES.map((b) => [b.id, b] as const))("body %s: its NASA year is Kepler's on GM_SUN within 0.5%", (_, b) => {
    const a = orbitShape(b.orbit.el, JD_J2000).a * 115;
    const keplerDays = (keplerPeriod(a, GM_SUN) / 420) * 365.25;
    expect(Math.abs(b.facts.yearDays / keplerDays - 1)).toBeLessThan(0.005);
  });
  // Encke and 67P: Kepler on GM_SUN gives the SBDB mean motion (within 0.5%).
  it.each(COMET_ELEMENTS.map((c, i) => [i === 0 ? "Encke" : "67P", c] as const))("comet %s", (_, c) => {
    const keplerDays = (keplerPeriod(c.a * 115, GM_SUN) / 420) * 365.25;
    expect(Math.abs(360 / c.nDegPerDay / keplerDays - 1)).toBeLessThan(0.005);
  });
});

describe("L9 everything orbits the sun the same way (prograde)", () => {
  it("the reference, Earth's orbit, turns counter-clockwise seen from ecliptic north (world +Y)", () => {
    expect(deg(reference, ECLIPTIC_NORTH)).toBeLessThan(0.1);
  });
  it.each(SOLAR_BODIES.map((b) => [b.id, b] as const))("body %s", (_, b) => {
    expect(dot(orbitAxis(b), reference)).toBeGreaterThan(0);
  });
  it.each(COMET_ELEMENTS.map((c, i) => [i === 0 ? "Encke" : "67P", c] as const))("comet %s turns prograde (angular momentum along +Y)", (_, c) => {
    const pos = (t: number) => cometWorldPosition(c, c.epochJd + t, { x: 0, y: 0, z: 0 });
    expect(dot(turnAxis(pos, 3.7), ECLIPTIC_NORTH)).toBeGreaterThan(0);
  });
  it("PROGRADE rotation.y turns the same way as the bodies' orbits (angular momentum along +Y)", () => {
    expect(dot(spinAxis(PROGRADE), reference)).toBeGreaterThan(0);
    expect(dot(spinAxis(-PROGRADE), reference)).toBeLessThan(0);
    expect(dot(spinAxis(PROGRADE), ECLIPTIC_NORTH)).toBeGreaterThan(0);
  });
  it("L9: only Venus and Uranus are retrograde-tipped (obliquity > 90°, a negative sidereal day), named exceptions", () => {
    expect(SOLAR_BODIES.filter((b) => b.obliquityDeg > 90).map((b) => b.id)).toEqual(["venus", "uranus"]);
    expect(SOLAR_BODIES.filter((b) => b.rotationHours < 0).map((b) => b.id)).toEqual(["venus", "uranus"]);
  });
});

describe("L9–L10 the reference plane: the real orbits lie close to the ecliptic", () => {
  it("every body's orbit axis lies within 11° of ecliptic north (Ceres 10.6°, Mercury 7.0°)", () => {
    for (const b of SOLAR_BODIES) expect(deg(orbitAxis(b), ECLIPTIC_NORTH), b.id).toBeLessThan(11);
  });
  it("no two orbits are more than 90° apart: the fictional L10 pairs are gone", () => {
    for (const a of SOLAR_BODIES) for (const b of SOLAR_BODIES) expect(deg(orbitAxis(a), orbitAxis(b)), `${a.id}|${b.id}`).toBeLessThan(90);
  });
});

describe("L35–L36 bodies sized by one law", () => {
  it("L36: drawn size follows true diameter, so the real order holds", () => {
    const byD = [...SOLAR_BODIES].sort((a, b) => b.diameterKm - a.diameterKm);
    for (let i = 1; i < byD.length; i++) expect(byD[i].size, byD[i].id).toBeLessThan(byD[i - 1].size);
  });
  it("L35: the sun outsizes every body", () => {
    for (const b of SOLAR_BODIES) expect(SUN_RADIUS, b.id).toBeGreaterThan(b.size);
  });
});
