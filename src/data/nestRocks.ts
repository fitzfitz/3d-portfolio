import { mulberry32 } from "../utils/mulberry32";
import { NEST_CENTRE, type Vec3 } from "./nest";

/**
 * The Nest's rock cluster and slime glow (spec 2026-10-27-nest-playable §2):
 * a hollow shell of rocks around NEST_CENTRE (the belt's low-poly rock,
 * Ruling N4), open in a mouth toward the buoy so the glow inside shows from
 * there. Static (no tumble), seeded, so every load builds the same nest.
 * Drawn by NestCluster (the lazily loaded Nest chunk). The colliders are
 * solid to the ship: Spaceship resolves them together (collision.ts
 * resolveCluster, as some overlap), within NEST_ROCK_CHECK_R of the centre.
 * Bolts and monsters ignore them.
 */
export interface NestRock {
  /** From NEST_CENTRE (u). */
  offset: Vec3;
  scale: number;
  /** Which of NestCluster's four per-axis stretch presets shapes this rock. */
  variant: 0 | 1 | 2 | 3;
  /** Euler angles (rad). */
  rotation: Vec3;
}

export const NEST_ROCK_SEED = 0x4e357;
/** Fibonacci-sphere directions before the mouth is cut. */
export const NEST_FIB_N = 26;
/** The shell's radius range (u). */
export const NEST_SHELL_R: readonly [number, number] = [10, 14];
export const NEST_ROCK_SCALE: readonly [number, number] = [1.2, 2.0];
/** No rock within this angle of the buoy direction: the mouth. */
export const NEST_MOUTH_RAD = 40 * Math.PI / 180;
/** Spaceship tests the rocks only within this of the centre (u): every rock lies inside it with room to spare. */
export const NEST_ROCK_CHECK_R = 40;
/** The glow's points sit within this radius of the centre (u). */
export const NEST_GLOW_R = 7;
const NEST_GLOW_N = 40;
/** As the scenery asteroids' colliders (data/asteroids.ts). */
const ROCK_COLLIDER_PER_SCALE = 2.2;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BUOY_LEN = Math.hypot(NEST_CENTRE[0], NEST_CENTRE[1], NEST_CENTRE[2]);
/** The buoy direction from the centre: toward the Sun (data/nest.ts). */
const TO_BUOY: Vec3 = [-NEST_CENTRE[0] / BUOY_LEN, -NEST_CENTRE[1] / BUOY_LEN, -NEST_CENTRE[2] / BUOY_LEN];

const lerp = (r: readonly [number, number], t: number) => r[0] + (r[1] - r[0]) * t;

/** The rock directions: NEST_FIB_N Fibonacci-sphere points, minus those within NEST_MOUTH_RAD of the buoy. */
function rockDirections(): Vec3[] {
  const cosMouth = Math.cos(NEST_MOUTH_RAD);
  const out: Vec3[] = [];
  for (let i = 0; i < NEST_FIB_N; i++) {
    const y = 1 - (2 * (i + 0.5)) / NEST_FIB_N;
    const r = Math.sqrt(1 - y * y);
    const phi = i * GOLDEN_ANGLE;
    const d: Vec3 = [r * Math.cos(phi), y, r * Math.sin(phi)];
    if (d[0] * TO_BUOY[0] + d[1] * TO_BUOY[1] + d[2] * TO_BUOY[2] >= cosMouth) continue;
    out.push(d);
  }
  return out;
}

/** The rocks and the glow from one generator: the rocks first, then the glow. */
function build(seed: number): { rocks: NestRock[]; glow: Vec3[] } {
  const rnd = mulberry32(seed);
  const rocks = rockDirections().map((d): NestRock => {
    const radius = lerp(NEST_SHELL_R, rnd());
    const scale = lerp(NEST_ROCK_SCALE, rnd());
    const variant = Math.floor(rnd() * 4) as NestRock["variant"];
    const rotation: Vec3 = [rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2];
    return { offset: [d[0] * radius, d[1] * radius, d[2] * radius], scale, variant, rotation };
  });
  // Uniform in the ball: a uniform direction, radius ∝ cube root.
  const glow = Array.from({ length: NEST_GLOW_N }, (): Vec3 => {
    const z = 2 * rnd() - 1;
    const phi = 2 * Math.PI * rnd();
    const r = NEST_GLOW_R * Math.cbrt(rnd());
    const s = Math.sqrt(1 - z * z);
    return [r * s * Math.cos(phi), r * s * Math.sin(phi), r * z];
  });
  return { rocks, glow };
}

export function buildNestRocks(seed: number): NestRock[] {
  return build(seed).rocks;
}

const BUILT = build(NEST_ROCK_SEED);
export const NEST_ROCKS: readonly NestRock[] = BUILT.rocks;

/** The rocks as the ship's colliders (world positions), r = 2.2 × scale as the scenery asteroids'. */
export const NEST_ROCK_COLLIDERS: readonly { id: string; x: number; y: number; z: number; r: number }[] = NEST_ROCKS.map((k, i) => ({
  id: `nest_rock_${i}`,
  x: NEST_CENTRE[0] + k.offset[0], y: NEST_CENTRE[1] + k.offset[1], z: NEST_CENTRE[2] + k.offset[2],
  r: ROCK_COLLIDER_PER_SCALE * k.scale,
}));

/** The slime glow's points, from NEST_CENTRE (u). */
export const NEST_GLOW: readonly Vec3[] = BUILT.glow;
