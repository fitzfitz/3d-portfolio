import { activeContent } from "./content";

export type Vec3T = readonly [number, number, number];
/** A probe slot: where its probe starts (home), and the spots it moves to, in order, each time its dossier closes. */
export interface ProbeSlot { home: Vec3T; remote: readonly Vec3T[] }
/** A project's probe: its project id on a slot. */
export interface ProbeDef extends ProbeSlot { id: string }

/**
 * The vetted probe slots (spec 2026-10-23-dynamic-content, decision 6).
 * Projects take them in their `sort` order, so the first three projects sit
 * where the three probes always did.
 *
 * Slots 1-3 were the three project probes' own coordinates, picked by search
 * against the clearance rules tests/solarClearance.test.ts holds (the real
 * swept orbits with their wells and moon systems, the belt, Trojans and
 * comets) and tests/probes.test.ts (destinations, gate, shards, buoys, ring
 * gates, scenery, belt, halo). Seven remote spots moved inward along their
 * radial line when the real orbits arrived (the plan ledger). Homes: slot 1
 * sits ~34 u from the spawn (the nearest, on a clear line), 2 and 3 walk out
 * from it at ~68 and ~87 u, all in the upper-left sky above the spawn so the
 * waypoint walks 1 -> 2 -> 3. Each remote pool is every third spot of a
 * 21-point farthest-point spread, sorted by azimuth, so a pool circles the
 * whole system and consecutive spots are far apart.
 *
 * Slots 4-6 (2026-10-23, for projects from D1) were picked the same way and
 * held to the same tests: homes 80-83 u from the spawn and above it, each
 * remote pool every third spot of a new 21-point farthest-point spread clear
 * of the first 24 spots, and every spot clear of the whole career trail arc,
 * since the buoys on it move with the career list.
 */
export const PROBE_SLOTS: readonly ProbeSlot[] = [
  {
    home: [-30, 80, 48],
    remote: [
      [-37, 413, -7],
      [-160, -53, -298],
      [60, -202, -236],
      [217, 354, -56],
      [261, 83, 190],
      [24, 31, 321],
      [-242, -251, 228],
    ],
  },
  {
    home: [-111, 60, 100],
    remote: [
      [-292, 24, -134],
      [-112, 312, -235],
      [10, -342, -15],
      [338, 126, -9],
      [126, -289, 216],
      [-177, -12, 273],
      [-322, 9, 114],
    ],
  },
  {
    home: [-67, 102, -7],
    remote: [
      [-204, -268, -138],
      [75, 76, -307],
      [287, -119, -88],
      [169, -67, 121],
      [27, 327, 259],
      [-209, 259, 237],
      [-314, 277, 5],
    ],
  },
  {
    home: [-23, 89, 143],
    remote: [
      [-149, 283, -42],
      [-45, -128, -55],
      [176, 94, -127],
      [225, 308, 170],
      [130, -165, 335],
      [-101, 217, 405],
      [-189, -128, 89],
    ],
  },
  {
    home: [-72, 136, 96],
    remote: [
      [-319, -151, -149],
      [-90, 92, -187],
      [139, -209, -29],
      [94, 401, 109],
      [-9, -105, 166],
      [-70, -308, 150],
      [-359, 193, 169],
    ],
  },
  {
    home: [28, 69, 85],
    remote: [
      [-235, 165, -282],
      [99, 290, -236],
      [79, 235, 23],
      [158, 192, 303],
      [-49, -215, 318],
      [-124, 406, 154],
      [-355, -198, 13],
    ],
  },
];

/** Probes in play at most: one per slot. A project past it shows in the résumé only. */
export const MAX_PROBES = PROBE_SLOTS.length;

/**
 * Gives the first MAX_PROBES project ids (in their order) slots 1, 2, ...;
 * warns about the rest, which get no probe.
 */
export function assignProbes(ids: readonly string[], warn: (msg: string) => void = console.warn): ProbeDef[] {
  if (ids.length > MAX_PROBES) {
    warn(`probes: ${ids.length} projects, ${MAX_PROBES} probe slots; ${ids.slice(MAX_PROBES).join(", ")} get no probe (they still show in the résumé)`);
  }
  return ids.slice(0, MAX_PROBES).map((id, i) => ({ id, ...PROBE_SLOTS[i] }));
}

/** This visit's probes: the settled projects on the slots, in order. */
export const PROBES: readonly ProbeDef[] = assignProbes(activeContent().projects.map((p) => p.id));
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
