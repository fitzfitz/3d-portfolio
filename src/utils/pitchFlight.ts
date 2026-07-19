export const PITCH_RATE = 1.8; // rad/s at full deflection
export const PITCH_MAX = 1.45; // ~83° — keeps the chase cam off the pole

export interface PitchInput { up: boolean; down: boolean }

/**
 * Pure pitch step, mirroring the yaw feel in Spaceship: eased attack toward
 * the full rate, eased release toward zero. NO auto-level, NO ceiling, NO
 * drift home — the nose stays wherever the pilot leaves it (spec §1).
 */
export function pitchStep(
  pitch: number,
  pitchVel: number,
  input: PitchInput,
  dt: number
): { pitch: number; pitchVel: number } {
  const frameLerp = (k: number) => 1 - Math.pow(1 - k, dt * 60);
  const target = input.up ? PITCH_RATE : input.down ? -PITCH_RATE : 0;
  pitchVel += (target - pitchVel) * (target !== 0 ? frameLerp(0.07) : frameLerp(0.12));
  pitch += pitchVel * dt;
  if (pitch > PITCH_MAX) { pitch = PITCH_MAX; pitchVel = Math.min(0, pitchVel); }
  else if (pitch < -PITCH_MAX) { pitch = -PITCH_MAX; pitchVel = Math.max(0, pitchVel); }
  return { pitch, pitchVel };
}

/** Spherical heading: yaw 0 / pitch 0 = +Z (matches the old sin/cos yaw convention). */
export function noseDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}
