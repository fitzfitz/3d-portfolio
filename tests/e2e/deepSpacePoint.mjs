/**
 * Where harness.mjs toDeepSpace() parks the ship (r ~345). Plain data, so
 * tests/solarClearance.test.ts can hold it 60 u from every swept orbit of the
 * real Solar System (planets, belt, Trojans, comets), inside HAZE_START.
 * Moved from (260, -50, 140) when the real orbits replaced the fictional ones.
 */
export const DEEP_SPACE_POINT = Object.freeze([260, -181, 140]);
