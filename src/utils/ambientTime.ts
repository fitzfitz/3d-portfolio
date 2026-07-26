/**
 * Ambient (decorative) elapsed time, which freezes under reduced motion while
 * the real clock keeps running for user-driven flight.
 *
 * Deliberately a pure function of the caller's own elapsed time rather than an
 * accumulator advanced by one privileged component. Controlling `useFrame`
 * order would mean using R3F's `renderPriority`, and any priority > 0 takes
 * over the render loop and obliges manual `gl.render()` calls. Deriving the
 * value from the clock each consumer already has removes the ordering question
 * entirely: no component is special, and none needs to run before another.
 *
 * In production, callers within one frame do NOT see the identical elapsed-
 * time reading: `THREE.Clock.getElapsedTime()` is itself mutating (it calls
 * `getDelta()` internally in three@0.185.1), so each of this module's call
 * sites gets a slightly larger value than the last within the same frame, and
 * each nudges `t` forward by that small slice rather than reading one frozen
 * number. This has no visible consequence — the total advance across the
 * frame still equals real elapsed time, exactly as it did before this module
 * existed — but it means the guarantee below is "no drift or double-counting
 * regardless of call order," not "every caller sees one shared value."
 */
let t = 0;
let lastReal: number | null = null;
let enabled = true;

export function setAmbientEnabled(value: boolean): void {
  enabled = value;
}

export function ambientTime(realElapsed: number): number {
  if (lastReal === null) {
    lastReal = realElapsed;
    return t;
  }
  const delta = realElapsed - lastReal;
  lastReal = realElapsed;
  // A backwards or zero delta advances nothing: repeated calls in one frame
  // must agree, and a reset clock must not rewind ambient time.
  if (enabled && delta > 0) t += delta;
  return t;
}

/**
 * Test-only: restore module state between cases.
 *
 * Resets `lastReal` to 0, not null. Null means "no frame has ever been
 * observed," a state real app code hits exactly once, at module load, before
 * any consumer's clock has produced a reading — that's what the seed branch
 * above guards against. A test that calls `ambientTime(5)` is simulating an
 * in-flight clock already at 5s, not a cold start, so it needs the delta path
 * to fire immediately; leaving `lastReal` null here would route every test's
 * first call through the seed branch instead and silently drop that first
 * reading (verified: this was `null` originally and 4 of 6 cases failed).
 */
export function resetAmbientTime(): void {
  t = 0;
  lastReal = 0;
  enabled = true;
}
