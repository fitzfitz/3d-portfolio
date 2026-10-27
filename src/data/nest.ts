import { NEST_BUOY_R, TOW_PAST_BUOY } from "../utils/combat/constants";
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

const TOW = along(NEST_BUOY_R + TOW_PAST_BUOY);
/** Where a breach tow lands: past the buoy, nose on the Nest's centre. */
export const NEST_TOW_POSE: { x: number; y: number; z: number; yaw: number; pitch: number } = {
  x: TOW[0], y: TOW[1], z: TOW[2],
  yaw: headingToward(TOW[0], TOW[2], NEST_CENTRE[0], NEST_CENTRE[2]),
  pitch: Math.asin((NEST_CENTRE[1] - TOW[1]) / (NEST_BUOY_R + TOW_PAST_BUOY)),
};

export const NEST_SCAN_ID = "the_nest";
export const NEST_LABEL = "THE_NEST";
export const NEST_RED = "#ff3b4a";
