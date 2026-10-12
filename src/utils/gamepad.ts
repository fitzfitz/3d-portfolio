import type { FlightInput } from "../store/spaceStore";

/**
 * Gamepad mapping, pure. Indices follow the W3C "standard" layout, which every
 * mainstream controller reports in Chrome, Firefox and Safari:
 *
 *   axes     0 left-stick X · 1 left-stick Y · 2 right-stick X · 3 right-stick Y  (Y is +1 down)
 *   buttons  0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 12–15 d-pad up/down/left/right
 */
export interface PadLike {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

/** The flight channels a pad drives. */
export type PadFlight = Pick<FlightInput, "steer" | "thrust" | "ascend" | "descend" | "boost" | "scan">;

export const PAD_NEUTRAL: Readonly<PadFlight> = {
  steer: 0, thrust: 0, ascend: false, descend: false, boost: false, scan: false,
};

const STICK_DEADZONE = 0.15;
/** Pitch is a digital channel, so the right stick needs a firm push to engage it. */
const PITCH_THRESHOLD = 0.5;

const A = 0, B = 1, Y = 3, RB = 5, LT = 6, RT = 7;
const DPAD_UP = 12, DPAD_DOWN = 13, DPAD_LEFT = 14, DPAD_RIGHT = 15;

/** Zeroes resting drift, then rescales so full deflection still reaches ±1. */
export function deadzone(v: number, dz = STICK_DEADZONE): number {
  const m = Math.abs(v);
  if (m <= dz) return 0;
  return Math.sign(v) * Math.min(1, (m - dz) / (1 - dz));
}

const axis = (p: PadLike, i: number) => p.axes[i] ?? 0;
const value = (p: PadLike, i: number) => p.buttons[i]?.value ?? 0;
const pressed = (p: PadLike, i: number) => p.buttons[i]?.pressed ?? false;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

export function readPadFlight(p: PadLike): PadFlight {
  const pitch = axis(p, 3);
  return {
    steer: deadzone(axis(p, 0)),
    // Stick up throttles like the touch joystick; RT/LT add on top for pilots
    // who prefer triggers. Spaceship brakes below -0.2, so LT alone brakes.
    thrust: clamp1(-deadzone(axis(p, 1)) + value(p, RT) - value(p, LT)),
    ascend: pitch < -PITCH_THRESHOLD,
    descend: pitch > PITCH_THRESHOLD,
    boost: pressed(p, RB),
    scan: pressed(p, A),
  };
}

/**
 * The channels the pad should write this frame. flight.input is shared with
 * the keyboard and touch joystick, so a neutral channel is written only on the
 * transition to neutral: an idle pad must not pin `steer` at 0 under a touch
 * drag. A driven channel is written every frame, because other code zeroes
 * flight.input without telling the pad (orbit lock, photo mode, Cmd release)
 * and a held stick has to win it back.
 */
export function padFlightChanges(prev: Readonly<PadFlight>, next: Readonly<PadFlight>): Partial<PadFlight> {
  const out: Partial<PadFlight> = {};
  for (const k of Object.keys(next) as (keyof PadFlight)[]) {
    if (prev[k] !== next[k] || next[k] !== PAD_NEUTRAL[k]) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

export type PadAction = { kind: "photo" } | { kind: "close" } | { kind: "jump"; index: number };

/** D-pad clockwise from up → jump targets 1–4, matching the number keys. */
const DPAD_JUMPS = [DPAD_UP, DPAD_RIGHT, DPAD_DOWN, DPAD_LEFT];

/** One-shot actions, fired on the press edge only so a held button acts once. */
export function padActions(prev: readonly boolean[], next: readonly boolean[]): PadAction[] {
  const edge = (i: number) => !!next[i] && !prev[i];
  const out: PadAction[] = [];
  if (edge(Y)) out.push({ kind: "photo" });
  if (edge(B)) out.push({ kind: "close" });
  DPAD_JUMPS.forEach((b, index) => { if (edge(b)) out.push({ kind: "jump", index }); });
  return out;
}

export function pressedButtons(p: PadLike): boolean[] {
  return p.buttons.map((b) => b.pressed);
}
