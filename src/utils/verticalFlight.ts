export const V_ACCEL = 14; // u/s^2 while a vertical key is held
export const V_MAX = 7;    // u/s vertical speed cap
export const V_CEIL = 55;  // absolute altitude bound
export const V_SOFT = 10;  // width of the slow-down band below the bound

export interface VerticalInput {
  ascend: boolean;
  descend: boolean;
  /** true when no vertical key is held AND the ship is outside any gravity zone */
  autoLevel: boolean;
}

/** Pure vertical-motion step: acceleration, cap, idle decay, auto-level, soft bounds. */
export function verticalStep(
  y: number,
  vy: number,
  input: VerticalInput,
  dt: number
): { y: number; vy: number } {
  if (input.ascend) vy += V_ACCEL * dt;
  else if (input.descend) vy -= V_ACCEL * dt;
  else {
    vy *= Math.pow(0.94, dt * 60);
    // Gentle drift home: ~8s half-life so pilots can cruise at altitude;
    // the caller additionally applies a grace period after vertical input.
    if (input.autoLevel) y *= Math.pow(0.5, dt / 8);
  }
  vy = Math.max(-V_MAX, Math.min(V_MAX, vy));

  // Soft bound: inside the last V_SOFT units, outward speed scales linearly to 0.
  if (vy > 0 && y > V_CEIL - V_SOFT) {
    vy *= Math.max(0, (V_CEIL - y) / V_SOFT);
  } else if (vy < 0 && y < -(V_CEIL - V_SOFT)) {
    vy *= Math.max(0, (V_CEIL + y) / V_SOFT);
  }

  y = Math.max(-V_CEIL, Math.min(V_CEIL, y + vy * dt));
  return { y, vy };
}
