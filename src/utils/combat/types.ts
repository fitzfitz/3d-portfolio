/** Shared shapes for the combat rules. Plain objects, so three.js Vector3s fit too. */
export interface V3 { x: number; y: number; z: number }

/** Something the aim assist can lock: a position, a velocity and whether it still counts. */
export interface AimTarget extends V3 { vx: number; vy: number; vz: number; alive: boolean }
