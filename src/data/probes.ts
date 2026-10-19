export type Vec3T = readonly [number, number, number];
/** A project's probe: where it starts (home), and the spots it moves to, in order, each time its dossier closes. */
export interface ProbeDef { id: string; home: Vec3T; remote: readonly Vec3T[] }

/**
 * The three project probes, in projects.json order. Coordinates were picked by
 * search against the same clearance rules tests/planetClearance.test.ts holds
 * (whole orbit tubes of every planet and world, destinations, gate, shards,
 * buoys, ring gates, scenery, belt, halo). Homes: probe 1 sits ~34 u from the
 * spawn (the nearest, on a clear line), 2 and 3 walk out from it at ~68 and
 * ~87 u, all in the upper-left sky above the spawn so the waypoint walks
 * 1 -> 2 -> 3. Each remote pool is every third spot of a 21-point
 * farthest-point spread, sorted by azimuth, so a pool circles the whole system
 * and consecutive spots are far apart.
 */
export const PROBES: readonly ProbeDef[] = [
  {
    id: "ruangrapi",
    home: [-30, 80, 48],
    remote: [
      [-37, 413, -7],
      [-160, -53, -298],
      [60, -202, -236],
      [217, 354, -56],
      [330, 94, 242],
      [40, 1, 406],
      [-242, -251, 228],
    ],
  },
  {
    id: "portfolio",
    home: [-111, 60, 100],
    remote: [
      [-371, 53, -186],
      [-112, 312, -235],
      [10, -342, -15],
      [352, 131, -9],
      [126, -289, 216],
      [-219, 1, 348],
      [-391, -2, 136],
    ],
  },
  {
    id: "fuxx",
    home: [-67, 102, -7],
    remote: [
      [-204, -268, -138],
      [78, 64, -318],
      [287, -119, -88],
      [172, -65, 123],
      [27, 327, 259],
      [-209, 259, 237],
      [-314, 277, 5],
    ],
  },
];
export const PROBE_IDS: readonly string[] = PROBES.map((p) => p.id);
/** Solid and keep-out radius of the model. */
export const PROBE_RADIUS = 1.6;
/** A jump parks the ship this far from a probe: inside BEAM_RANGE. */
export const PROBE_JUMP_STANDOFF = 12;
/** The popup opens when the pulled probe is this close to the nose origin. */
export const PROBE_OPEN_DIST = 4;
export const PROBE_PULL_SPEED = 14;
/** HUD tip and chatter radius. */
export const PROBE_IN_RANGE = 45;
