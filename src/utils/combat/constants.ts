/**
 * The Nest's numbers. Spec values (docs/archive/specs/2026-10-27-combat-design.md)
 * first, then the controller's values the spec leaves open. Distances in world
 * units (u), times in seconds, angles in radians.
 */

const DEG = Math.PI / 180;

// ── Places ─────────────────────────────────────────────────────────────────
/** The hostile zone: an inward crossing starts a fight. */
export const NEST_ZONE_R = 70;
/** The fighting area: fire works and monsters stay inside it. */
export const NEST_LEASH_R = 110;
/** The buoy marking the Nest, this far from the centre. */
export const NEST_BUOY_R = 120;
/** The monsters' models load (and their effects mount) within this radius. */
export const NEST_LOAD_R = 200;
/** The edge haze shows only within this band outside the zone edge. */
export const NEST_HAZE_BAND = 30;

// ── Fight timing ───────────────────────────────────────────────────────────
export const CONTACT_DELAY_S = 3;
export const WAVE_GAP_S = 5;
export const NEST_REST_S = 120;
/** Out of the fighting area this long ends the fight. */
export const OUT_LIMIT_S = 20;

export interface WaveSpec { saucers: number; tardigrades: number }
export const WAVES: readonly WaveSpec[] = [
  { saucers: 3, tardigrades: 0 },
  { saucers: 5, tardigrades: 0 },
  { saucers: 3, tardigrades: 1 },
];
export const WAVES_LOW_PERF: readonly WaveSpec[] = [
  { saucers: 2, tardigrades: 0 },
  { saucers: 3, tardigrades: 0 },
  { saucers: 2, tardigrades: 1 },
];

// ── Hull ───────────────────────────────────────────────────────────────────
export const HULL_MAX = 100;
export const HULL_REGEN_PER_S = 6;
/** Regen waits this long after the last hit. */
export const HULL_REGEN_DELAY_S = 4;
export const HULL_AFTER_BREACH = 60;

// ── The ship's plasma gun ──────────────────────────────────────────────────
/** 5 bolts per second. */
export const FIRE_INTERVAL_S = 0.2;
export const BOLT_SPEED = 140;
export const BOLT_RANGE = 160;
export const AIM_ASSIST_RAD = 12 * DEG;

// ── Monsters ───────────────────────────────────────────────────────────────
export const SAUCER_HITS = 3;
export const TARDIGRADE_HITS = 18;

export const SAUCER_ORBIT: readonly [number, number] = [18, 35];
export const SAUCER_SPEED = 14;
export const SAUCER_ATTACK_EVERY: readonly [number, number] = [3, 5];
export const SAUCER_WARN_S = 1.0;
export const SAUCER_BURST = 3;
export const SAUCER_BURST_GAP_S = 0.12;
export const SAUCER_SPREAD_RAD = 2 * DEG;
/** Flinch. */
export const SAUCER_HIT_POSE_S = 0.25;
/** Defeat drift. */
export const SAUCER_DEFEAT_S = 3;

export const ENEMY_BOLT_SPEED = 48;
export const ENEMY_BOLT_DAMAGE = 6;
export const ENEMY_BOLT_RANGE = 120;

export const TARDIGRADE_SPEED = 5;
/** The tardigrade closes to this distance and holds. */
export const TARDIGRADE_STANDOFF = 40;
export const TARDIGRADE_ATTACK_EVERY: readonly [number, number] = [6, 8];
export const TARDIGRADE_CHARGE_S = 1.6;
export const JET_S = 1.2;
export const JET_RANGE = 90;
/** The jet hits when the ship's centre is within this of its axis. */
export const JET_RADIUS = 2.5;
export const JET_DPS = 25;

// ── Controller's values (not in the spec) ──────────────────────────────────
export const SAUCER_HIT_R = 1.8;
export const TARDIGRADE_HIT_R = 3.5;
export const SHIP_HIT_R = 1.4;
export const BOLT_R = 0.3;
export const TARDIGRADE_HIT_POSE_S = 0.25;
export const TARDIGRADE_DEFEAT_S = 4;
/** When a fight ends, monsters shrink away over this long. */
export const LEAVE_S = 2;
/** Defeated monsters drift at this speed (u/s). */
export const DEFEAT_DRIFT = 4;
/** Monsters spawn this far from the centre, on the side away from the ship. */
export const SPAWN_R = 30;
/** Facing slew, rad/s. */
export const SAUCER_TURN_RATE = 3;
export const TARDIGRADE_TURN_RATE = 1.5;
/** Hit feedback (sound, shake, flash, rumble) at most once per this; damage is never throttled. */
export const HIT_FEEDBACK_MIN_S = 0.25;
/** A click aims this far past the ship along the camera ray. */
export const CLICK_AIM_DEPTH = 80;
/** Bolts leave from the ship's nose, this far ahead of its centre. */
export const NOSE_OFFSET = 1.3;
export const MAX_SAUCERS = 5;
export const MAX_TARDIGRADES = 1;
/** Fixed bolt pool size (ship and enemy bolts share it). */
export const BOLT_POOL = 48;
/** The rumour line plays the first time the ship comes within this of the centre. */
export const NEST_RUMOUR_R = 400;
/** A breach tow lands this far past the buoy. */
export const TOW_PAST_BUOY = 8;
/** …and this far to the side of the buoy's line, so the buoy never stands in front of the Nest (Ruling N3). */
export const TOW_SIDE = 16;
