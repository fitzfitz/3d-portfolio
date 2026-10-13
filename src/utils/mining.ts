import type { Vec3 } from "./reactions";
import { beamState } from "../store/beamState";
import { BEAM_MAX_TARGETS, PEBBLE_RANGE, PEBBLE_PULL_SPEED, inCone, pullStep } from "./tractorBeam";
import { FUEL_MAX, FUEL_PER_CRYSTAL } from "./fuel";

/**
 * Mining belt pebbles with the tractor beam (spec §6.3). Belt rocks are
 * pebbles (0.1-0.5u), so each is worth a sliver of fuel: 16 make one crystal.
 * A grab gate caps acquisition at one pebble per PEBBLE_GRAB_INTERVAL, so an
 * empty tank always takes at least 40s of mining (64 × 0.65s = 41.6s): a
 * deliberate choice between mining and flying to crystals, never a free
 * refill mid-race.
 *
 * AsteroidBelt writes each ring's pebble world positions here every frame and
 * reads back which pebbles are tethered (pulled, not orbiting), absorbed
 * (hidden) or regrowing. Module state, like `flight`: no React.
 */
export const ORE_PER_CRYSTAL = 16;
export const ORE_FUEL = FUEL_PER_CRYSTAL / ORE_PER_CRYSTAL;
export const PEBBLE_REGROW_S = 90;
export const PEBBLE_REGROW_EASE_S = 2;
export const PEBBLE_GRAB_INTERVAL = 0.65;
export const ABSORB_RADIUS = 1.5;
/** A tethered pebble that falls this far behind is let go. */
export const TETHER_DROP_RANGE = 20;

interface Ring { world: Float32Array; absorbedAt: Float64Array }
interface Tether { ring: number; index: number; x: number; y: number; z: number }

const rings: Ring[] = [];
const tethers: Tether[] = Array.from({ length: BEAM_MAX_TARGETS }, () => ({ ring: -1, index: -1, x: 0, y: 0, z: 0 }));
let tetherN = 0;
let lastGrabAt = -Infinity;

export const miningState = { rings, tethers, get tetherCount() { return tetherN; } };

export function registerRing(ring: number, total: number): void {
  if (rings[ring]?.world.length === total * 3) return;
  // NaN until AsteroidBelt writes a real position: inCone rejects NaN, so an
  // undrawn pebble (low-perf count, unmounted halo) can never be mined.
  rings[ring] = { world: new Float32Array(total * 3).fill(NaN), absorbedAt: new Float64Array(total).fill(-Infinity) };
}

export function pebbleWorld(ring: number): Float32Array { return rings[ring].world; }

export function isAbsorbed(ring: number, i: number, now: number): boolean {
  return now - rings[ring].absorbedAt[i] < PEBBLE_REGROW_S;
}

/** 0 while absorbed, easing back to 1 over PEBBLE_REGROW_EASE_S once regrown; 1 if never mined. */
export function regrowScale(ring: number, i: number, now: number): number {
  const since = now - rings[ring].absorbedAt[i] - PEBBLE_REGROW_S;
  if (since < 0) return 0;
  const u = Math.min(1, since / PEBBLE_REGROW_EASE_S);
  return u * u * (3 - 2 * u);
}

export function isTethered(ring: number, i: number): boolean {
  for (let t = 0; t < tetherN; t++) if (tethers[t].ring === ring && tethers[t].index === i) return true;
  return false;
}

export function tetherCount(): number { return tetherN; }

export function tetherPos(t: number, out: Vec3): Vec3 {
  out.x = tethers[t].x; out.y = tethers[t].y; out.z = tethers[t].z;
  return out;
}

function dropTether(t: number): void {
  tetherN--;
  const last = tethers[tetherN], cur = tethers[t];
  cur.ring = last.ring; cur.index = last.index; cur.x = last.x; cur.y = last.y; cur.z = last.z;
}

/** Fuel and ore counter after `absorbed` pebbles, and how many whole crystals' worth just completed. Pure. */
export function addOre(fuel: number, ore: number, absorbed: number): { fuel: number; ore: number; crystals: number } {
  return {
    fuel: Math.min(FUEL_MAX, fuel + absorbed * ORE_FUEL),
    ore: (ore + absorbed) % ORE_PER_CRYSTAL,
    crystals: Math.floor((ore + absorbed) / ORE_PER_CRYSTAL),
  };
}

/**
 * One frame: drops tethers when the beam is off or they fall behind, grabs the
 * nearest in-cone pebble when a slot is free and the grab gate allows, pulls
 * every tether toward the ship and absorbs those that arrive. Returns how many
 * were absorbed this frame. `now` is game time (s).
 */
export function stepMining(now: number, dt: number, ship: Vec3): number {
  if (!beamState.active) { tetherN = 0; return 0; }
  const { ox, oy, oz, dx, dy, dz } = beamState;

  if (tetherN < BEAM_MAX_TARGETS && now - lastGrabAt >= PEBBLE_GRAB_INTERVAL) {
    let bestR = -1, bestI = -1, bestD = Infinity;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      if (!ring) continue;
      const w = ring.world, n = w.length / 3;
      for (let i = 0; i < n; i++) {
        if (now - ring.absorbedAt[i] < PEBBLE_REGROW_S + PEBBLE_REGROW_EASE_S) continue;
        const d = inCone(ox, oy, oz, dx, dy, dz, w[i * 3], w[i * 3 + 1], w[i * 3 + 2], PEBBLE_RANGE);
        if (d >= 0 && d < bestD && !isTethered(r, i)) { bestD = d; bestR = r; bestI = i; }
      }
    }
    if (bestI >= 0) {
      const t = tethers[tetherN++], w = rings[bestR].world;
      t.ring = bestR; t.index = bestI; t.x = w[bestI * 3]; t.y = w[bestI * 3 + 1]; t.z = w[bestI * 3 + 2];
      lastGrabAt = now;
    }
  }

  let absorbed = 0;
  for (let t = tetherN - 1; t >= 0; t--) {
    const left = pullStep(tethers[t], ship, beamState.vel, PEBBLE_PULL_SPEED, dt);
    if (left < ABSORB_RADIUS) {
      rings[tethers[t].ring].absorbedAt[tethers[t].index] = now;
      absorbed++;
      dropTether(t);
    } else if (left > TETHER_DROP_RANGE) {
      dropTether(t);
    }
  }
  return absorbed;
}

export function resetMining(): void {
  rings.length = 0;
  tetherN = 0;
  lastGrabAt = -Infinity;
}
