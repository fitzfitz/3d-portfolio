/**
 * Where harness.mjs toDeepSpace() parks the ship (r ~299). Plain data, so
 * tests/worldClearance.test.ts can hold it clear of every swept planet and
 * world orbit by reach + 20, inside HAZE_START. Chosen against the 480-edge
 * orbits: ~107 beyond that bound from the nearest orbit, ~90 from either comet
 * path and the jelly path, ~150 from the nearest landmark or scenery asteroid.
 */
export const DEEP_SPACE_POINT = Object.freeze([260, -50, 140]);
