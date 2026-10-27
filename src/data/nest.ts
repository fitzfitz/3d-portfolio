import { NEST_BUOY_R, TOW_PAST_BUOY, TOW_SIDE } from "../utils/combat/constants";
import { headingToward } from "../utils/pitchFlight";

export type Vec3 = readonly [number, number, number];

/** The Nest's centre: below the plane, clear of every orbit and every tour stop (tests/nestPlacement.test.ts). */
export const NEST_CENTRE: Vec3 = [-250, -390, 60];

const LEN = Math.hypot(NEST_CENTRE[0], NEST_CENTRE[1], NEST_CENTRE[2]);
/** Unit vector from the Nest toward the Sun (the origin). */
const TO_SUN: Vec3 = [-NEST_CENTRE[0] / LEN, -NEST_CENTRE[1] / LEN, -NEST_CENTRE[2] / LEN];
const along = (r: number): Vec3 => [
  NEST_CENTRE[0] + TO_SUN[0] * r, NEST_CENTRE[1] + TO_SUN[1] * r, NEST_CENTRE[2] + TO_SUN[2] * r,
];

/** The buoy, NEST_BUOY_R from the centre on the side facing the Sun. */
export const NEST_BUOY_POS: Vec3 = along(NEST_BUOY_R);

/** Horizontal and square to the Sun line: TO_SUN × up, normalised. */
const SIDE_LEN = Math.hypot(TO_SUN[2], TO_SUN[0]);
const SIDE: Vec3 = [-TO_SUN[2] / SIDE_LEN, 0, TO_SUN[0] / SIDE_LEN];
const PAST = along(NEST_BUOY_R + TOW_PAST_BUOY);
const TOW: Vec3 = [PAST[0] + SIDE[0] * TOW_SIDE, PAST[1] + SIDE[1] * TOW_SIDE, PAST[2] + SIDE[2] * TOW_SIDE];
const TOW_R = Math.hypot(TOW[0] - NEST_CENTRE[0], TOW[1] - NEST_CENTRE[1], TOW[2] - NEST_CENTRE[2]);
/**
 * Where a breach tow (and a jump to the Nest) lands: past the buoy and off to
 * its side (Ruling N3), so the buoy stands beside the view instead of in front
 * of the cluster's mouth; nose on the Nest's centre, outside the fighting area.
 */
export const NEST_TOW_POSE: { x: number; y: number; z: number; yaw: number; pitch: number } = {
  x: TOW[0], y: TOW[1], z: TOW[2],
  yaw: headingToward(TOW[0], TOW[2], NEST_CENTRE[0], NEST_CENTRE[2]),
  pitch: Math.asin((NEST_CENTRE[1] - TOW[1]) / TOW_R),
};

export const NEST_SCAN_ID = "the_nest";
export const NEST_LABEL = "THE_NEST";
export const NEST_RED = "#ff3b4a";

/**
 * The Nest as a jump target (spec 2026-10-27-nest-playable §1): the last
 * JUMP_TARGETS row, landing at NEST_TOW_POSE as a breach tow does. Not a
 * Destination (no dock, zone, lock or waypoint); the id is the reserved
 * scan id, so no project can claim it.
 */
export const NEST_JUMP_ID = NEST_SCAN_ID;
export const NEST_JUMP_LABEL = "The Nest";
