/**
 * Where harness.mjs toDeepSpace() parks the ship (r ~345), as [x, y, z] in
 * scene units. Plain data, so tests/solarClearance.test.ts can hold it 60 u
 * from every swept orbit of the real Solar System (planets, belt, Trojans,
 * comets) and from every fixed landmark's own radius (probe spots, station,
 * trail, shipyard, gate, portal, ring gates, shards), inside HAZE_START.
 * Moved from (260, -50, 140) when the real orbits replaced the fictional ones.
 * @type {readonly [number, number, number]}
 */
export const DEEP_SPACE_POINT = Object.freeze([260, -181, 140]);
