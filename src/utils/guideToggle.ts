/**
 * The guide toggle (spec 2026-10-23-jellyfish-guide, "Calling it": J and a
 * small touch button; no gamepad button, spec build ruling R2). Both inputs set
 * the flag; SpaceJellyfish takes it once a frame and feeds it to the guide as
 * an edge. Module state, like `flight.input`, so a press costs no render.
 */
const toggle = { pressed: false };

export function requestGuideToggle(): void {
  toggle.pressed = true;
}

/** Whether a press is waiting; clears it. */
export function takeGuideToggle(): boolean {
  const p = toggle.pressed;
  toggle.pressed = false;
  return p;
}
