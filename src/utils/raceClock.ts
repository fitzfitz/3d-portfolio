/**
 * The time-trial clock, in seconds. Advanced by RingCourse each frame with the
 * same clamped dt the ship's physics uses, so a tab switch or a slow frame
 * stops the clock exactly as it stops the ship. Read by RaceHUD's rAF loop —
 * never React state, matching flight/waypointState.
 */
export const raceClock = { now: 0 };
