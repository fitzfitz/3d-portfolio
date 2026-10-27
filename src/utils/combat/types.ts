import type { Saucer } from "./saucerAi";
import type { Tardigrade } from "./tardigradeAi";

/** Shared shapes for the combat rules. Plain objects, so three.js Vector3s fit too. */
export interface V3 { x: number; y: number; z: number }

/** Something the aim assist can lock: a position, a velocity and whether it still counts. */
export interface AimTarget extends V3 { vx: number; vy: number; vz: number; alive: boolean }

/**
 * A click into the fighting area: its aim point (x, y, z; `clickAimPoint`)
 * and the camera ray it came along (origin o*, direction d*, any length),
 * for the click assist.
 */
export interface ClickShot extends V3 { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

/** What a monster sees each step. `shipIn`: the ship is within the leash and not racing. */
export interface FightView { ship: V3; shipVel: V3; centre: V3; shipIn: boolean }

/** World-space attachment points the render knows (they need the rigs and three). */
export interface NestSink {
  muzzle(s: Saucer, out: V3): V3;
  mouth(t: Tardigrade, out: V3): V3;
}
