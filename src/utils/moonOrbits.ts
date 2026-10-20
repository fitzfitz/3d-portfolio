import * as THREE from "three";
import { insetDistance, insetPeriod, SOLAR_MOONS, type MoonId, type SolarMoon } from "../data/solarMoons";
import type { BodyId } from "../data/bodyIds";
import { bodyById, type SolarBody } from "../data/solarSystem";
import { moonSlot, setOccluder } from "../components/canvas/sunShadow";
import { bodyPositionAt } from "./bodyPositions";
import { poleWorld } from "./bodySpin";
import type { Vec3 } from "./reactions";

/**
 * Where the nine moons are (real-solar-system spec §5.3): each flies a circle
 * of its inset distance (data/solarMoons.ts) about its parent, at 2π /
 * insetPeriod on the close-up clock, in its real plane, tidally locked (L11).
 * Moon arrangements are illustrative (§5.4): the phases come from a fixed
 * per-moon seed, not from the orrery date.
 *
 * Planes. A moon with `plane: "equator"` orbits about its parent's IAU pole
 * (poleWorld, fixed in space), the Moon (`plane: "ecliptic"`) about ecliptic
 * north (world +Y). The orbit is that reference plane tilted by
 * `inclinationDeg` about a node line in it: the ascending node of the
 * parent's equator on the ecliptic (ecliptic north × the pole), or for the
 * Moon the vernal equinox (world +X). One node line per system, so the
 * Galileans' longitudes share a zero and the Laplace angle can be set.
 *
 * Triton (L12), the retrograde sense applied once: `inclinationDeg` is the
 * true angle between the orbit's angular momentum and the parent's pole, so
 * Triton's 156.885° already turns its orbit backwards. Every moon moves
 * forwards about its own orbit normal; the `retrograde` flag is a label,
 * not applied again (tests/solarMoonsScene.test.ts holds it equal to
 * inclinationDeg > 90°).
 *
 * The Laplace resonance: Io, Europa and Ganymede start with λ_Io − 3 λ_Europa
 * + 2 λ_Ganymede = 180°, as in reality; their periods (NSSDC, 1 : 2.007 :
 * 4.044) keep it there, drifting under 1° in 14 h of play.
 */

const D2R = Math.PI / 180;
const ECLIPTIC_NORTH = new THREE.Vector3(0, 1, 0);
const VERNAL_EQUINOX = new THREE.Vector3(1, 0, 0);

/** FNV-1a of the id, as a fraction of a turn: a fixed per-moon phase. */
function seededPhase(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h / 2 ** 32) * 2 * Math.PI;
}

interface MoonFrame {
  parent: SolarBody;
  /** The node line, in both the reference plane and the orbit: the moon's position at angle 0. */
  e1: THREE.Vector3;
  /** In the orbit, a quarter turn ahead of e1: e1 × e2 = n. */
  e2: THREE.Vector3;
  /** The orbit normal: the orbital angular momentum's direction. */
  n: THREE.Vector3;
  distance: number;
  omega: number;
  phase: number;
  /** Local axes at angle 0: +X on the parent (−e1), +Y on n, +Z along the motion (e2). */
  lock: THREE.Quaternion;
}

function makeFrame(m: SolarMoon, phase: number): MoonFrame {
  const parent = bodyById(m.parent);
  const ref = m.plane === "ecliptic" ? ECLIPTIC_NORTH.clone() : poleWorld(parent);
  const e1 = new THREE.Vector3().crossVectors(ECLIPTIC_NORTH, ref);
  if (e1.lengthSq() < 1e-12) e1.copy(VERNAL_EQUINOX);
  e1.normalize();
  // The reference normal turned by the inclination about the node line (Rodrigues, e1 ⊥ ref).
  const i = m.inclinationDeg * D2R;
  const n = ref.clone().multiplyScalar(Math.cos(i)).add(new THREE.Vector3().crossVectors(e1, ref).multiplyScalar(Math.sin(i))).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  const basis = new THREE.Matrix4().makeBasis(e1.clone().negate(), n, e2);
  return {
    parent, e1, e2, n, distance: insetDistance(m), omega: (2 * Math.PI) / insetPeriod(m), phase,
    lock: new THREE.Quaternion().setFromRotationMatrix(basis),
  };
}

const phases = new Map<MoonId, number>(SOLAR_MOONS.map((m) => [m.id, seededPhase(m.id)]));
// Ganymede's phase from Io's and Europa's: the Laplace angle starts at 180°.
phases.set("ganymede", (Math.PI - phases.get("io")! + 3 * phases.get("europa")!) / 2);

const FRAMES = new Map<SolarMoon, MoonFrame>(SOLAR_MOONS.map((m) => [m, makeFrame(m, phases.get(m.id)!)]));
const frameOf = (m: SolarMoon): MoonFrame => FRAMES.get(m)!;

/** The angle along the orbit from the node line at `gameSeconds`. */
const angleAt = (f: MoonFrame, gameSeconds: number): number => f.phase + f.omega * gameSeconds;

/**
 * Moon `m`'s world position at `gameSeconds` about a parent at `parentPos`,
 * written into `out` (returned). Allocation-free.
 */
export function moonPositionAt(m: SolarMoon, gameSeconds: number, parentPos: Vec3, out: Vec3): Vec3 {
  const f = frameOf(m);
  const a = angleAt(f, gameSeconds);
  const c = Math.cos(a) * f.distance, s = Math.sin(a) * f.distance;
  out.x = parentPos.x + c * f.e1.x + s * f.e2.x;
  out.y = parentPos.y + c * f.e1.y + s * f.e2.y;
  out.z = parentPos.z + c * f.e1.z + s * f.e2.z;
  return out;
}

/** The orbit's normal (its angular momentum's direction), copied into `out`. */
export function moonOrbitNormal(m: SolarMoon, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(frameOf(m).n);
}

const qTurn = new THREE.Quaternion();

/**
 * Tidally locked (L11): local +X on the parent (an east-positive map's 0°
 * longitude, the real sub-planet point), +Y on the orbit normal, +Z along the
 * motion (90° W, the leading hemisphere). Writes and returns `out`; allocation-free.
 */
export function moonQuaternion(m: SolarMoon, gameSeconds: number, out: THREE.Quaternion): THREE.Quaternion {
  const f = frameOf(m);
  qTurn.setFromAxisAngle(f.n, angleAt(f, gameSeconds));
  return out.copy(qTurn).multiply(f.lock);
}

/** The distinct parents, and each moon's index into them: one ephemeris solve per parent per frame. */
const PARENTS: readonly BodyId[] = [...new Set(SOLAR_MOONS.map((m) => m.parent))];
const PARENT_BODIES: readonly SolarBody[] = PARENTS.map(bodyById);
const PARENT_INDEX = SOLAR_MOONS.map((m) => PARENTS.indexOf(m.parent));
const parentScratch: Vec3[] = PARENTS.map(() => ({ x: 0, y: 0, z: 0 }));
const SLOTS = SOLAR_MOONS.map((m) => moonSlot(m.id));

/**
 * The moons' frame drive: each moon's position into `out[id]` (in place),
 * about its parent's ephemeris position at the same game time as
 * updateBodies (so it needs nothing from `bodies` and no frame order), and its
 * occluder slot at that centre with its size. Allocation-free.
 */
export function updateMoons(gameSeconds: number, out: Record<MoonId, Vec3>): void {
  for (let i = 0; i < PARENTS.length; i++) bodyPositionAt(PARENT_BODIES[i], gameSeconds, parentScratch[i]);
  for (let i = 0; i < SOLAR_MOONS.length; i++) {
    const m = SOLAR_MOONS[i];
    const p = moonPositionAt(m, gameSeconds, parentScratch[PARENT_INDEX[i]], out[m.id]);
    setOccluder(SLOTS[i], p.x, p.y, p.z, m.size);
  }
}
