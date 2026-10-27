/**
 * The gamepad's rumble, callable from anywhere (Chrome only; elsewhere
 * `vibrationActuator` is absent). useGamepadInput rumbles on the store's
 * impact counter; Nest hull hits call it directly, so they do not bump
 * `impactCount`, which also fires RadioChatter's impact line (Ruling C3).
 */

/**
 * First pad reporting the W3C standard layout. Flight sticks, wheels and some
 * adapters report `mapping: ""` with their own axis order — a throttle axis
 * resting at -1 would read as a permanent climb — so they are ignored.
 */
export function standardPad(): Gamepad | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  for (const p of navigator.getGamepads()) if (p?.connected && p.mapping === "standard") return p;
  return null;
}

/** One short dual rumble on the first standard pad, if it can. */
export function padRumble(): void {
  standardPad()?.vibrationActuator?.playEffect("dual-rumble", {
    duration: 140, strongMagnitude: 0.7, weakMagnitude: 0.4,
  }).catch(() => { /* rumble is a nicety */ });
}
