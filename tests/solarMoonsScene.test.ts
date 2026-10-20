import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BODY_IDS, type BodyId } from "../src/data/bodyIds";
import { insetDistance, insetPeriod, MOON_IDS, SOLAR_MOONS, type SolarMoon } from "../src/data/solarMoons";
import { bodyById, SOLAR_BODIES } from "../src/data/solarSystem";
import { bodySlot, moonSlot, occluders, OCCLUDER_COUNT } from "../src/components/canvas/sunShadow";
import { moonPositions } from "../src/store/moonState";
import { bodyPositionAt } from "../src/utils/bodyPositions";
import { poleWorld } from "../src/utils/bodySpin";
import { moonOrbitNormal, moonPositionAt, moonQuaternion, updateMoons } from "../src/utils/moonOrbits";

/**
 * The nine moons in the scene (real-solar-system spec §5.3, Task 14): each
 * flies a circle of its inset distance about its parent, in its real plane,
 * at 2π / insetPeriod, tidally locked; Triton backwards.
 */

type V = { x: number; y: number; z: number };
const moon = (id: string): SolarMoon => SOLAR_MOONS.find((m) => m.id === id)!;
const v3 = (p: V) => new THREE.Vector3(p.x, p.y, p.z);
const deg = (r: number) => (r * 180) / Math.PI;
const PARENT: V = { x: 812.5, y: -31.25, z: -406 };
const TIMES = [0, 0.37, 12.5, 333.3, 4096, 86_400, 1e6];

/** The moon's offset from its parent at `t`. */
function offset(m: SolarMoon, t: number): THREE.Vector3 {
  const p = moonPositionAt(m, t, PARENT, { x: 0, y: 0, z: 0 });
  return v3(p).sub(v3(PARENT));
}

/** Orbital angular momentum direction, from two nearby positions (r × v). */
function angularMomentum(m: SolarMoon, t: number): THREE.Vector3 {
  const h = insetPeriod(m) * 1e-4;
  const r = offset(m, t);
  const v = offset(m, t + h).sub(offset(m, t - h));
  return r.cross(v).normalize();
}

describe("moonPositionAt: a circle of insetDistance about the parent", () => {
  it("keeps every moon at its inset distance at any time, and writes `out`", () => {
    for (const m of SOLAR_MOONS) {
      for (const t of TIMES) expect(offset(m, t).length(), `${m.id} t=${t}`).toBeCloseTo(insetDistance(m), 9);
      const out = { x: 0, y: 0, z: 0 };
      expect(moonPositionAt(m, 5, PARENT, out)).toBe(out);
    }
  });

  it("turns at 2π / insetPeriod and closes the circle after one period", () => {
    for (const m of SOLAR_MOONS) {
      const P = insetPeriod(m);
      for (const t of [0, 77.7, 1e4]) {
        const dt = P / 1000;
        expect(offset(m, t).angleTo(offset(m, t + dt)) / dt, m.id).toBeCloseTo((2 * Math.PI) / P, 6);
        expect(offset(m, t).distanceTo(offset(m, t + P)), m.id).toBeLessThan(1e-6 * insetDistance(m));
      }
    }
  });

  it("is a fixed function of time: the phase comes from a seed, not from the call order", () => {
    const a = offset(moon("io"), 42);
    offset(moon("europa"), 1e5);
    expect(offset(moon("io"), 42).distanceTo(a)).toBe(0);
  });
});

describe("orbit planes (spec §5.3)", () => {
  it("puts the Galileans in Jupiter's equator within 0.5°", () => {
    const pole = poleWorld(bodyById("jupiter"));
    for (const id of ["io", "europa", "ganymede", "callisto"]) {
      for (const t of [0, 1234.5]) expect(deg(angularMomentum(moon(id), t).angleTo(pole)), id).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("tilts every equatorial moon by its own inclination to its parent's equator", () => {
    for (const m of SOLAR_MOONS.filter((x) => x.plane === "equator")) {
      const pole = poleWorld(bodyById(m.parent));
      expect(deg(angularMomentum(m, 10).angleTo(pole)), m.id).toBeCloseTo(m.inclinationDeg, 4);
      expect(deg(moonOrbitNormal(m, new THREE.Vector3()).angleTo(pole)), m.id).toBeCloseTo(m.inclinationDeg, 9);
    }
  });

  it("flies the Moon 5.145° to the ecliptic (world +Y is ecliptic north), not to Earth's equator", () => {
    const m = moon("moon");
    expect(m.plane).toBe("ecliptic");
    expect(deg(angularMomentum(m, 3).angleTo(new THREE.Vector3(0, 1, 0)))).toBeCloseTo(5.145, 4);
  });

  it("matches the orbit normal it reports to the motion", () => {
    for (const m of SOLAR_MOONS) {
      expect(angularMomentum(m, 99).angleTo(moonOrbitNormal(m, new THREE.Vector3())), m.id).toBeLessThan(1e-6);
    }
  });
});

describe("Triton: captured, retrograde (L12)", () => {
  // Convention (applied once): inclinationDeg is the true angle between the
  // orbit's angular momentum and the parent's pole, so Triton's 156.885°
  // already makes it retrograde; `retrograde` is a label that must agree.
  it("turns against Neptune's spin: its angular momentum is anti-aligned with Neptune's pole", () => {
    const neptune = bodyById("neptune");
    expect(neptune.rotationHours).toBeGreaterThan(0); // Neptune spins forwards about its pole
    const pole = poleWorld(neptune);
    const L = angularMomentum(moon("triton"), 50);
    expect(L.dot(pole)).toBeLessThan(-0.9);
    expect(deg(L.angleTo(pole))).toBeCloseTo(156.885, 4);
  });

  it("is the only moon whose angular momentum opposes its parent's spin, and the flag agrees", () => {
    for (const m of SOLAR_MOONS) {
      const p = bodyById(m.parent);
      const spin = poleWorld(p).multiplyScalar(Math.sign(p.rotationHours));
      const backwards = angularMomentum(m, 7).dot(spin) < 0;
      expect(backwards, m.id).toBe(m.id === "triton");
      expect(m.retrograde, m.id).toBe(m.inclinationDeg > 90);
    }
  });
});

describe("the Laplace resonance (Io : Europa : Ganymede = 1 : 2 : 4)", () => {
  // λ_Io − 3 λ_Europa + 2 λ_Ganymede librates about 180° in reality; the
  // seeded phases start it there and the periods keep it there.
  const pole = poleWorld(bodyById("jupiter"));
  const e1 = new THREE.Vector3(0, 1, 0).cross(pole).normalize();
  const e2 = pole.clone().cross(e1);
  const lon = (id: string, t: number) => { const r = offset(moon(id), t); return Math.atan2(r.dot(e2), r.dot(e1)); };
  const laplace = (t: number) => {
    const phi = lon("io", t) - 3 * lon("europa", t) + 2 * lon("ganymede", t);
    return Math.abs(deg(Math.atan2(Math.sin(phi), Math.cos(phi))));
  };
  it("holds the Laplace angle at 180° within 1° over a long session", () => {
    for (const t of [0, 3600, 36_000]) expect(180 - laplace(t), `t=${t}`).toBeLessThan(1);
  });
});

describe("tidal lock (L11)", () => {
  it("keeps the same face (local +X) on the parent, and local +Y on the orbit normal", () => {
    const q = new THREE.Quaternion();
    for (const m of SOLAR_MOONS) {
      const n = moonOrbitNormal(m, new THREE.Vector3());
      for (const t of TIMES) {
        moonQuaternion(m, t, q);
        const face = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const toParent = offset(m, t).negate().normalize();
        expect(face.angleTo(toParent), `${m.id} t=${t}`).toBeLessThan(1e-6);
        expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).angleTo(n), `${m.id} t=${t}`).toBeLessThan(1e-6);
      }
    }
  });

  it("leads with local +Z (the 90° W hemisphere of an east-positive map) along the motion", () => {
    const q = new THREE.Quaternion();
    for (const m of SOLAR_MOONS) {
      const h = insetPeriod(m) * 1e-4;
      const v = offset(m, 20 + h).sub(offset(m, 20 - h)).normalize();
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(moonQuaternion(m, 20, q)).angleTo(v), m.id).toBeLessThan(1e-4);
    }
  });
});

describe("updateMoons: positions, occluder slots", () => {
  it("writes each moon about its parent's ephemeris position, into moonPositions-shaped `out`", () => {
    const t = 321.5;
    const out = Object.fromEntries(MOON_IDS.map((id) => [id, { x: 0, y: 0, z: 0 }])) as Record<string, V>;
    const objs = { ...out };
    updateMoons(t, out);
    for (const m of SOLAR_MOONS) {
      expect(out[m.id], m.id).toBe(objs[m.id]); // in place
      const parent = bodyPositionAt(bodyById(m.parent), t, { x: 0, y: 0, z: 0 });
      const want = moonPositionAt(m, t, parent, { x: 0, y: 0, z: 0 });
      expect(out[m.id].x, m.id).toBeCloseTo(want.x, 9);
      expect(out[m.id].y, m.id).toBeCloseTo(want.y, 9);
      expect(out[m.id].z, m.id).toBeCloseTo(want.z, 9);
      const s = occluders[moonSlot(m.id)];
      expect([s.x, s.y, s.z, s.r], m.id).toEqual([out[m.id].x, out[m.id].y, out[m.id].z, m.size]);
    }
  });

  it("seeds moonPositions (the collider's centres) with every moon", () => {
    expect(Object.keys(moonPositions).sort()).toEqual([...MOON_IDS].sort());
  });
});

describe("occluder slots: 15 of 16, every receiver's casters on the GPU", () => {
  it("bodies with a moon or a ring first, then the nine moons", () => {
    expect(OCCLUDER_COUNT).toBe(15);
    const withMoonOrRing = BODY_IDS.filter((id) => SOLAR_MOONS.some((m) => m.parent === id) || bodyById(id).look.rings);
    expect(withMoonOrRing).toEqual(["earth", "mars", "jupiter", "saturn", "uranus", "neptune"]);
    withMoonOrRing.forEach((id, i) => expect(bodySlot(id), id).toBe(i));
    MOON_IDS.forEach((id, i) => expect(moonSlot(id), id).toBe(6 + i));
    for (const id of ["mercury", "venus", "ceres"] as BodyId[]) expect(bodySlot(id), id).toBe(-1);
  });

  it("gives every receiver's shadow casters a GPU slot", () => {
    // A planet with moons receives its moons' shadows; a moon receives its
    // parent's and its siblings'; a ring receives its planet's.
    for (const b of SOLAR_BODIES) {
      const moons = SOLAR_MOONS.filter((m) => m.parent === b.id);
      for (const m of moons) {
        expect(moonSlot(m.id), `${m.id} on ${b.id}`).toBeGreaterThanOrEqual(0);
        expect(bodySlot(b.id), `${b.id} on ${m.id}`).toBeGreaterThanOrEqual(0);
      }
      if (b.look.rings) expect(bodySlot(b.id), `${b.id} on its ring`).toBeGreaterThanOrEqual(0);
    }
    const slots = [...BODY_IDS.map(bodySlot).filter((s) => s >= 0), ...MOON_IDS.map(moonSlot)];
    expect(new Set(slots).size).toBe(15);
    expect(Math.max(...slots)).toBe(OCCLUDER_COUNT - 1);
  });
});
