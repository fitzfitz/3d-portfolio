/**
 * The time-trial clock, in seconds. Advanced by RingCourse each frame through
 * advanceRaceClock (src/utils/race.ts): the ship's clamped dt, paused in photo
 * mode, so the clock stops whenever the ship does. Read by RaceHUD's rAF loop —
 * never React state, matching flight/waypointState.
 */
export const raceClock = { now: 0 };
