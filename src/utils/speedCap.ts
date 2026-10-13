/**
 * The speed to clamp to before this frame's drag, `drag^(dt*60)`, so the ship
 * ends the frame at `max * drag`: the 60 fps cruise, at any frame rate.
 *
 * Clamping to `max` and then dragging made cruise depend on dt (10.23 u/s at
 * 20 fps against 10.61 at 60). A slow device flew slower, sat in a gravity
 * well longer and bent deeper, so a b=30 skim tuned at 60 fps docked at 20.
 * At dt = 1/60 this is exactly `max`.
 */
export function cruiseCap(max: number, drag: number, dt: number): number {
  return max * Math.pow(drag, 1 - dt * 60);
}
