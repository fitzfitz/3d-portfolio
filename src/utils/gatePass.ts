import { crossesGate, type Gate } from "./race";
import { GATE_POS, GATE_NORMAL, GATE_OPENING_R, GATE_SENSE_R, GATE_LINES } from "../data/dormantGate";

interface Point { x: number; y: number; z: number }

/** The gate as a race gate: the same segment test the ring course uses, MAX_STEP guard included. */
const GATE: Gate = {
  c: { x: GATE_POS[0], y: GATE_POS[1], z: GATE_POS[2] },
  n: { x: GATE_NORMAL[0], y: GATE_NORMAL[1], z: GATE_NORMAL[2] },
};

export function gateDistance(p: Point): number {
  return Math.hypot(p.x - GATE_POS[0], p.y - GATE_POS[1], p.z - GATE_POS[2]);
}

/**
 * Whether the move a→b flew through the opening, either way. A jump, a debug
 * teleport or a boundary wrap moves more than race.ts's MAX_STEP and never
 * counts.
 */
export function gatePassed(a: Point, b: Point): boolean {
  return crossesGate(a, b, GATE, GATE_OPENING_R);
}

export interface GateRadio { approached: boolean; passed: boolean }

/** Once per page load: module state, like waypointState. */
export const gateRadio: GateRadio = { approached: false, passed: false };

/**
 * The one-time radio line this frame's move earns, or null, marking it said.
 * A pass implies an approach, so a first visit that is a pass plays only the
 * pass line.
 */
export function gateLine(state: GateRadio, prev: Point, next: Point): string | null {
  if (!state.passed && gatePassed(prev, next)) {
    state.passed = true;
    state.approached = true;
    return GATE_LINES.pass;
  }
  if (!state.approached && gateDistance(next) < GATE_SENSE_R) {
    state.approached = true;
    return GATE_LINES.approach;
  }
  return null;
}

/** Seam emissive intensity: idle pulse peak, and the brightest a close ship drives it. */
export const SEAM_IDLE = 0.6;
export const SEAM_SENSED = 2.4;
const PULSE_PERIOD_S = 6;
const FLICKER_HZ = 12;

/** Cheap deterministic hash in [0, 1). */
const noise = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

/**
 * The glyph seams' emissive intensity (spec §2): a faint pulse far away, and
 * inside GATE_SENSE_R an irregular flicker that brightens toward SEAM_SENSED
 * as the ship closes in. Reduced motion holds a steady SEAM_IDLE. `t` is
 * seconds (ambientTime).
 */
export function seamIntensity(t: number, distance: number, reduced: boolean): number {
  if (reduced) return SEAM_IDLE;
  const pulse = SEAM_IDLE * (0.75 + 0.25 * Math.sin((2 * Math.PI * t) / PULSE_PERIOD_S));
  if (distance >= GATE_SENSE_R) return pulse;
  const k = 1 - distance / GATE_SENSE_R;
  const flicker = 0.6 + 0.4 * noise(Math.floor(t * FLICKER_HZ));
  return Math.min(SEAM_SENSED, pulse + k * (SEAM_SENSED - SEAM_IDLE) * flicker);
}
