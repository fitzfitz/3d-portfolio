/**
 * Two elapsed-time accumulators, both immune to the `THREE.Clock` reset
 * described in `DISCONTINUITY_SECONDS` below, differing only in whether they
 * freeze under reduced motion:
 *
 *   - `ambientTime()` — decorative motion (planet orbits, nebula hue drift,
 *     cloud rotation, sun corona). Freezes while `enabled` is false.
 *   - `gameTime()` — gameplay deadlines that must keep advancing regardless
 *     of reduced motion (warp suppression, impact debounce, meteor spawn
 *     timing). See its own doc comment below for why it cannot share
 *     `ambientTime`'s accumulator.
 *
 * Both are deliberately pure functions of the caller's own elapsed time
 * rather than an accumulator advanced by one privileged component.
 * Controlling `useFrame` order would mean using R3F's `renderPriority`, and
 * any priority > 0 takes over the render loop and obliges manual
 * `gl.render()` calls. Deriving the value from the clock each consumer
 * already has removes the ordering question entirely: no component is
 * special, and none needs to run before another.
 *
 * In production, callers within one frame do NOT see the identical elapsed-
 * time reading: `THREE.Clock.getElapsedTime()` is itself mutating (it calls
 * `getDelta()` internally in three@0.185.1), so each of this module's call
 * sites gets a slightly larger value than the last within the same frame, and
 * each nudges its accumulator forward by that small slice rather than
 * reading one frozen number. This has no visible consequence — the total
 * advance across the frame still equals real elapsed time, exactly as it did
 * before this module existed — but it means the guarantee below is "no drift
 * or double-counting regardless of call order," not "every caller sees one
 * shared value."
 */
let t = 0;
let lastReal: number | null = null;
let enabled = true;

export function setAmbientEnabled(value: boolean): void {
  enabled = value;
}

/**
 * No legitimate single call advances the clock this far: tests/ambientTime.test.ts's
 * largest deliberate single-call delta is 10 (simulating an in-flight clock,
 * not a cold start), and even a badly lagged real frame is sub-second. Set
 * comfortably above that and far below the failure mode below.
 *
 * Task 6's frozen-scene canvas (`frameloop` flips "always" <-> "never" on the
 * dossier modal) is the one caller that can produce a call far outside that
 * range. @react-three/fiber's `setFrameloop` resets `THREE.Clock.elapsedTime`
 * to 0 on every frameloop transition, and on the specific frame where the
 * transition to "never" lands while a render was already in flight, R3F
 * re-seeds that reset clock from the raw rAF timestamp -- which is
 * milliseconds, not seconds -- so `state.clock.getElapsedTime()` reports a
 * value roughly 1000x too large for exactly one frame (thousands of
 * "seconds" for a page that's been open mere seconds). Left unguarded, every
 * consumer keyed off this module (planet orbits, nebula hue drift, cloud
 * rotation, the sun corona shader) jumps decades into its own cycle the
 * instant a modal opens. Treated as a fresh seed rather than real elapsed
 * time, the same way the cold-start branch below handles the very first
 * reading.
 */
const DISCONTINUITY_SECONDS = 30;

export function ambientTime(realElapsed: number): number {
  if (lastReal === null) {
    lastReal = realElapsed;
    return t;
  }
  const delta = realElapsed - lastReal;
  lastReal = realElapsed;
  // A backwards or zero delta advances nothing: repeated calls in one frame
  // must agree, and a reset clock must not rewind ambient time. A delta this
  // large is the clock-discontinuity artifact described above, not real
  // elapsed time -- re-seeding (skipping the add) rather than clamping it to
  // a small step, because a clamped-but-still-added value would still leave
  // a lasting, if smaller, jump instead of none at all.
  if (enabled && delta > 0 && delta < DISCONTINUITY_SECONDS) t += delta;
  return t;
}

/**
 * Monotonic elapsed time for gameplay deadlines that must survive a
 * `THREE.Clock` reset -- a `gameTime()` sibling to `ambientTime()` above,
 * deliberately NOT gated on `enabled`/reduced motion.
 *
 * Task 6's dossier freeze flips Canvas `frameloop` between "always" and
 * "never" on every orbit lock/unlock, and R3F's `setFrameloop` resets
 * `clock.elapsedTime` to 0 on EVERY such transition (see the discontinuity
 * doc above `ambientTime`) -- twice per dossier open+close. Several
 * gameplay systems compare a live clock reading against an absolute
 * deadline stored from an earlier frame:
 *
 *   - Spaceship.tsx's warp gate (`time > warpSuppressUntil.current`) and
 *     impact debounce (`time - lastImpactAt.current > 0.5`)
 *   - ShootingStars.tsx's spawn timer (`t > nextSpawn.current`)
 *
 * All three compare a FUTURE stored value against a clock that can suddenly
 * rewind to ~0. Post-reset, the live reading takes as long to climb back to
 * that stale absolute deadline as the deadline's own original value was --
 * i.e. a dead window as long as the whole session had already run, and none
 * of the three can self-heal (nothing re-derives the stored deadline once
 * it's stale).
 *
 * `ambientTime` cannot be reused here even though it already handles this
 * exact discontinuity: it deliberately FREEZES while `enabled` is false
 * (reduced motion), and every consumer above is gameplay, not decor --
 * warp, damage feedback and spawn timing must keep advancing under reduced
 * motion. Hence a separate accumulator with its own state, sharing only the
 * discontinuity constant and the re-seed-on-jump logic.
 *
 * `PlasmaAnomalies.tsx` and `WarpTunnel.tsx` also read raw elapsed time for
 * decorative rotation/shader phase and are exempted from `ambientTime` for
 * the same "user-initiated, not reduced-motion-gated" reason -- routing them
 * through `gameTime` instead fixes their cosmetic phase-pop on the same
 * reset without introducing a reduced-motion freeze they don't want.
 */
let g = 0;
let lastRealGame: number | null = null;

export function gameTime(realElapsed: number): number {
  if (lastRealGame === null) {
    lastRealGame = realElapsed;
    return g;
  }
  const delta = realElapsed - lastRealGame;
  lastRealGame = realElapsed;
  if (delta > 0 && delta < DISCONTINUITY_SECONDS) g += delta;
  return g;
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

/** Test-only: restore `gameTime`'s module state between cases. See `resetAmbientTime`. */
export function resetGameTime(): void {
  g = 0;
  lastRealGame = 0;
}
