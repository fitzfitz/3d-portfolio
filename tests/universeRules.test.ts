import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { planets, SUN_RADIUS, GM_SUN, gmOf, PROGRADE } from "../src/constants";
import { orbitPosition, type OrbitalElements } from "../src/utils/orbits";
import { keplerGM, keplerOmega, keplerPeriod, keplerPosition } from "../src/utils/kepler";
import { COMETS } from "../src/data/comets";
import { MOONS, moonOrbitSpeed } from "../src/data/moons";
import { WORLDS } from "../src/data/worlds";

// docs/UNIVERSE-RULES.md: every orbit around the sun obeys one Kepler law
// (T² = 4π²a³/GM with a single GM_SUN), everything turns the same way, and
// moons are tidally locked. Departures from reality are listed in that doc.

type V = { x: number; y: number; z: number };
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Direction of r × v: which way a path turns. */
function turnAxis(pos: (t: number) => V, t = 3.7): V {
  const h = 1e-3, p = pos(t), q = pos(t + h);
  return cross(p, { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z });
}

/** World position of a mesh at (d,0,0) inside SpacePlanets' moon rig: tilt group → orbit group (rotation.y). */
function moonRigPosition(distance: number, inclination: number, speed: number, phase: number, t: number): V {
  const tilt = new THREE.Group();
  tilt.rotation.set(inclination, 0, 0);
  const orbit = new THREE.Group();
  orbit.rotation.y = phase + t * speed;
  const mesh = new THREE.Object3D();
  mesh.position.set(distance, 0, 0);
  tilt.add(orbit); orbit.add(mesh);
  tilt.updateMatrixWorld(true);
  return mesh.getWorldPosition(new THREE.Vector3());
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

const reference = turnAxis((t) => orbitPosition(planets[0].orbit, t));

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
  it("Ruangrapi keeps its 420 s year (the anchor)", () => {
    expect((Math.PI * 2) / planets[0].orbit.angularSpeed).toBeCloseTo(420, 6);
  });
  it.each(planets.map((p) => [p.name, p] as const))("planet %s", (_, p) => {
    expect(p.orbit.angularSpeed).toBeCloseTo(keplerOmega(p.orbit.radius, GM_SUN), 12);
  });
  it.each(WORLDS.map((w) => [w.id, w] as const))("world %s", (_, w) => {
    expect(w.orbit.angularSpeed).toBeCloseTo(keplerOmega(w.orbit.radius, GM_SUN), 12);
  });
  it("outer bodies are slower: periods strictly increase with radius", () => {
    const byR = [...planets, ...WORLDS].sort((a, b) => a.orbit.radius - b.orbit.radius);
    for (let i = 1; i < byR.length; i++) expect(byR[i].orbit.angularSpeed).toBeLessThan(byR[i - 1].orbit.angularSpeed);
  });
  it.each(COMETS.map((c, i) => [i + 1, c] as const))("comet %i", (_, c) => {
    expect(c.periodSeconds).toBeCloseTo(keplerPeriod(c.a, GM_SUN), 9);
  });
});

describe("L9 everything orbits the sun the same way (prograde)", () => {
  it.each(planets.map((p) => [p.name, p] as const))("planet %s", (_, p) => {
    expect(dot(turnAxis((t) => orbitPosition(p.orbit, t)), reference)).toBeGreaterThan(0);
  });
  it.each(COMETS.map((c, i) => [i + 1, c] as const))("comet %i", (_, c) => {
    expect(dot(turnAxis((t) => keplerPosition(t, c)), reference)).toBeGreaterThan(0);
  });
  it.each(WORLDS.map((w) => [w.id, w] as const))("world %s", (_, w) => {
    expect(dot(turnAxis((t) => orbitPosition(w.orbit, t)), reference)).toBeGreaterThan(0);
  });
  it.each(WORLDS.map((w) => [w.id, w] as const))("world %s spins with PROGRADE (its axial tilt sets the pole)", (_, w) => {
    expect(Math.sign(w.spin)).toBe(PROGRADE);
  });
  it("L9: only the tilted ice giant is retrograde-tipped (axial tilt > 90°), a named exception", () => {
    expect(WORLDS.filter((w) => w.axialTiltDeg > 90).map((w) => w.id)).toEqual(["w-tilted"]);
  });
  it("PROGRADE rotation.y turns the same way as the planets' orbits", () => {
    expect(dot(spinAxis(PROGRADE), reference)).toBeGreaterThan(0);
    expect(dot(spinAxis(-PROGRADE), reference)).toBeLessThan(0);
  });
});

describe("L9–L10 the reference plane and the mutual inclinations the doc quotes", () => {
  const unit = (v: V) => { const n = Math.hypot(v.x, v.y, v.z); return { x: v.x / n, y: v.y / n, z: v.z / n }; };
  const axis = (o: OrbitalElements) => unit(turnAxis((t) => orbitPosition(o, t)));
  const deg = (a: V, b: V) => (Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180) / Math.PI;
  const pole = axis({ radius: 1, angularSpeed: 1, inclination: 0, node: 0, phase: 0 });
  const orbits: [string, OrbitalElements][] = [
    ...planets.map((p) => [p.name, p.orbit] as [string, OrbitalElements]),
    ...WORLDS.map((w) => [w.id, w.orbit] as [string, OrbitalElements]),
  ];
  it("every planet's and world's orbit axis lies within 60° of the reference plane's pole", () => {
    for (const [name, o] of orbits) expect(deg(axis(o), pole), name).toBeLessThanOrEqual(60.01) // Fuxx: 1.0472 rad;
    expect(deg(unit(reference), pole)).toBeCloseTo(20, 2);
  });
  it("the pairs more than 90° apart are exactly the four L10 names, the widest 118.2° (Fuxx–dwarf)", () => {
    const pairs: [string, number][] = [];
    for (let i = 0; i < orbits.length; i++) for (let j = i + 1; j < orbits.length; j++) {
      pairs.push([`${orbits[i][0]}|${orbits[j][0]}`, deg(axis(orbits[i][1]), axis(orbits[j][1]))]);
    }
    const over90 = pairs.filter(([, a]) => a > 90).sort((a, b) => b[1] - a[1]);
    expect(over90.map(([k, a]) => [k, Math.round(a * 10) / 10])).toEqual([
      ["fuxx|w-dwarf", 118.2], ["fuxx|w-rock", 98.4], ["w-tilted|w-dwarf", 98.3], ["w-ringed|w-dwarf", 96.0],
    ]);
    const among = (a: string, b: string) => pairs.find(([k]) => k === `${a}|${b}`)![1];
    expect(among("ruangrapi", "fuxx")).toBeCloseTo(71.2, 1);
  });
});

describe("L11–L12 moons: Kepler around their planet, prograde unless captured, tidally locked", () => {
  it.each(MOONS.map((m) => [m.id, m] as const))("moon %s obeys Kepler around its own planet (gmOf)", (_, m) => {
    const p = planets[m.planet];
    expect(Math.abs(moonOrbitSpeed(m))).toBeCloseTo(keplerOmega(m.distance * p.size, gmOf(p)), 12);
  });
  it("Ruangrapi's rock moon keeps its 0.4 rad/s (the anchor)", () => {
    const anchor = MOONS.find((m) => m.id === "ruangrapiRock")!;
    expect(Math.abs(moonOrbitSpeed(anchor))).toBeCloseTo(0.4, 9);
  });
  it.each(MOONS.map((m) => [m.id, m] as const))("moon %s turns with its planet's spin unless captured", (_, m) => {
    const r = m.distance * planets[m.planet].size;
    const axis = turnAxis((t) => moonRigPosition(r, m.inclination, moonOrbitSpeed(m), m.phase, t));
    const withSpin = dot(axis, spinAxis(PROGRADE)) > 0;
    expect(withSpin).toBe(!m.captured);
  });
  it("captured (retrograde) moons are the exception: the two ice moons", () => {
    expect(MOONS.filter((m) => m.captured).map((m) => m.id).sort()).toEqual(["fuxxIce", "portfolioIce"]);
  });
});

describe("L35–L36 planets sized and weighed by type", () => {
  it("L36: planet size follows type — gas giant > earth > mars", () => {
    const by = (t: string) => planets.find((p) => p.type === t)!.size;
    expect(by("gas-giant")).toBe(16); expect(by("earth")).toBe(12); expect(by("mars")).toBe(8);
  });
  it("L36: the size ladder runs gas giant > ringed > ice giants > earth > mars > rock > dwarf", () => {
    const planet = (t: string) => planets.find((p) => p.type === t)!.size;
    const world = (id: string) => WORLDS.find((w) => w.id === id)!.size;
    const ladder = [
      planet("gas-giant"), world("w-ringed"), world("w-tilted"), world("w-blue"),
      planet("earth"), planet("mars"), world("w-rock"), world("w-dwarf"),
    ];
    expect(ladder).toEqual([16, 15, 13.5, 13, 12, 8, 5.7, 3.5]);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]);
  });
  it("L35: the sun outsizes every planet and world", () => {
    for (const p of [...planets, ...WORLDS]) expect(SUN_RADIUS).toBeGreaterThan(p.size);
  });
  it("masses are ordered gas giant > earth > mars", () => {
    const m = (t: string) => planets.find((p) => p.type === t)!.mass;
    expect(m("gas-giant")).toBeGreaterThan(m("earth")); expect(m("earth")).toBeGreaterThan(m("mars"));
  });
});
