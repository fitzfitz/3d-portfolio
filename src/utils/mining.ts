import type { Vec3 } from "./reactions";

/** Pebbles currently tethered to the beam (completed in Task 17). */
export function tetherCount(): number { return 0; }
/** World position of tether `t`, written into `out`. */
export function tetherPos(_t: number, out: Vec3): Vec3 { return out; }
