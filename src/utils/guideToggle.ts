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

/**
 * Whether the guide is out (not roaming), for the touch button's
 * `aria-pressed`. SpaceJellyfish writes it every frame; subscribers hear only a
 * change, so the button renders on a call or a dismissal, never per frame.
 */
const active = { on: false };
const listeners = new Set<() => void>();

export function setGuideActive(on: boolean): void {
  if (on === active.on) return;
  active.on = on;
  for (const l of listeners) l();
}

export function isGuideActive(): boolean {
  return active.on;
}

/** For useSyncExternalStore: returns the unsubscribe. */
export function subscribeGuideActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
