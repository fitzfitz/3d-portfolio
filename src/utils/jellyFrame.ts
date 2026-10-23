import { createGuideState, stepGuide, GUIDE_STREAK_SPEED, type GuideInput, type GuideState } from "./jellyGuide";
import { createJellyState, pushOutOfSolids, stepJelly, type JellyInput, type JellyKeepOut, type JellyState } from "./jellyMood";
import type { Vec3 } from "./reactions";

/**
 * One frame of the jellyfish's whereabouts (spec 2026-10-23-jellyfish-guide):
 * the loop and its moods while it roams, the guide while it guides, and the
 * swim home in between. Pure and allocation-free; SpaceJellyfish owns the loop
 * curve, the clocks and the drawing, and calls this once a frame.
 *
 *   roaming (loop + moods) --call/offer--> guiding (jellyGuide.ts places it)
 *        ^                                     | hand-back (handBack: the caller
 *        +------ returning (swims home) <------+  re-phases the loop, beginReturn)
 */

export interface JellyFrameInput {
  /** The loop point this frame, with the swim surge and bob. */
  pathPos: Vec3;
  /** The loop point before surge and bob (the moods measure drift from it). */
  basePos: Vec3;
  ship: Vec3;
  /** Ship velocity (u/s, warp included): the guide matches it. */
  shipVel: Vec3;
  /** The ship's speed as the flight model reports it (flight.speed): the moods read this, as they always did. */
  shipSpeed: number;
  /** Warp held: startles a roaming creature, draws the guide's streak. */
  warping: boolean;
  /** The guide's target (waypointTarget.ts makeGuideTarget), or null when all is done. */
  target: Vec3 | null;
  targetRadius: number;
  /** Progress signature (jellyGuide.ts GuideInput.progress). */
  progress: number;
  /** Offer blockers (jellyGuide.ts GuideInput.blocked). */
  blocked: boolean;
  reducedMotion: boolean;
  /** J or the touch GUIDE button since the last frame (an edge). */
  toggle: boolean;
  keepOut: readonly JellyKeepOut[];
}

export interface JellyFrame {
  guide: GuideState;
  mood: JellyState;
  /** Swimming home after a hand-back: `ret` is the offset off the loop, easing from `retFrom` to 0 over `retDur`. */
  returning: boolean;
  ret: Vec3;
  retFrom: Vec3;
  retT: number;
  retDur: number;
  /** OUTPUT: the creature's world position this frame. */
  pos: Vec3;
  /**
   * OUTPUT: the guide handed it back this frame, at `pos`. The caller moves the
   * loop to the phase nearest `pos` and calls beginReturn with that loop point.
   */
  handBack: boolean;
  /** Reused inputs and scratch: the frame allocates nothing. */
  moodIn: JellyInput;
  guideIn: GuideInput;
  roam: Vec3;
}

/** The swim home averages this (u/s): a calm swim near the loop; a long way back stays bounded by RETURN_MAX_S. */
export const RETURN_SPEED = 8;
/** Never quicker than this (s), so even a short way home reads as a swim, not a snap. */
export const RETURN_MIN_S = 2;
/** Never longer than this (s): from across the system it is a streak home, like the streak in. */
export const RETURN_MAX_S = 12;
/** The glow streak is full length at this speed (u/s), a fast warp; it starts at half GUIDE_STREAK_SPEED. */
export const STREAK_FULL_SPEED = 120;
/** Moods ease on a short frame (they always stepped on dt capped at 0.05 s). */
const MOOD_MAX_DT = 0.05;

export function createJellyFrame(): JellyFrame {
  const pathPos = { x: 0, y: 0, z: 0 }, basePos = { x: 0, y: 0, z: 0 }, roam = { x: 0, y: 0, z: 0 };
  return {
    guide: createGuideState(), mood: createJellyState(),
    returning: false, ret: { x: 0, y: 0, z: 0 }, retFrom: { x: 0, y: 0, z: 0 }, retT: 0, retDur: 0,
    pos: { x: 0, y: 0, z: 0 }, handBack: false, roam,
    moodIn: { pathPos, basePos, player: { x: 0, y: 0, z: 0 }, playerSpeed: 0, boosting: false, keepOut: [], dt: 0 },
    guideIn: {
      jelly: roam, ship: { x: 0, y: 0, z: 0 }, shipVel: { x: 0, y: 0, z: 0 }, warping: false, target: null, targetRadius: 0,
      progress: 0, blocked: false, reducedMotion: false, toggle: false, keepOut: [],
    },
  };
}

function copy(o: Vec3, a: Vec3) { o.x = a.x; o.y = a.y; o.z = a.z; }

/** Calm, centred on its path, with no memory of the last path point (a jump is not drift). */
function resetMood(m: JellyState) {
  m.mood = "calm";
  m.offset.x = m.offset.y = m.offset.z = 0;
  m.target.x = m.target.y = m.target.z = 0;
  m.startledFor = 0;
  m.lastPath = null;
}

function endReturn(f: JellyFrame) {
  f.returning = false;
  f.ret.x = f.ret.y = f.ret.z = 0;
}

export function stepJellyFrame(f: JellyFrame, inp: JellyFrameInput, dt: number): JellyFrame {
  f.handBack = false;
  const wasGuiding = f.guide.guiding;
  // Spec "Leading": "While guiding, boosting does not startle it", and the
  // moods are the roaming creature's (plan: "Moods only while roaming"):
  // not while it guides, nor while it swims home after. Reduced motion has
  // none, as before.
  if (!wasGuiding && !f.returning && !inp.reducedMotion && dt > 0) {
    const m = f.moodIn;
    copy(m.pathPos, inp.pathPos); copy(m.player, inp.ship);
    if (m.basePos) copy(m.basePos, inp.basePos);
    m.playerSpeed = inp.shipSpeed;
    m.boosting = inp.warping;
    m.keepOut = inp.keepOut;
    m.dt = Math.min(dt, MOOD_MAX_DT);
    stepJelly(f.mood, m);
  }
  if (f.returning && dt > 0) {
    // Eased out of the guided spot and into the loop, so it leaves from rest
    // and lands on the loop without a jolt (smoothstep, as the streak in).
    f.retT += dt;
    const u = Math.min(1, f.retT / f.retDur), k = 1 - u * u * (3 - 2 * u);
    f.ret.x = f.retFrom.x * k; f.ret.y = f.retFrom.y * k; f.ret.z = f.retFrom.z * k;
    if (u >= 1) endReturn(f);
  }
  const r = f.roam;
  r.x = inp.pathPos.x + f.mood.offset.x + f.ret.x;
  r.y = inp.pathPos.y + f.mood.offset.y + f.ret.y;
  r.z = inp.pathPos.z + f.mood.offset.z + f.ret.z;
  // The swim home runs with the moods off, so their keep-out backstop does
  // not; the eased line home can cut through a planet (after presenting at a
  // world, or a dismissal beside one). The same law holds it on the surface
  // (spec "Leading": "it keeps clear of every solid"). `ret` stays as eased,
  // so the push never accumulates and it lands on the loop exactly.
  if (f.returning) pushOutOfSolids(r, inp.keepOut);

  const g = f.guideIn;
  copy(g.ship, inp.ship); copy(g.shipVel, inp.shipVel);
  g.warping = inp.warping; g.target = inp.target; g.targetRadius = inp.targetRadius;
  g.progress = inp.progress; g.blocked = inp.blocked; g.reducedMotion = inp.reducedMotion;
  g.toggle = inp.toggle; g.keepOut = inp.keepOut;
  stepGuide(f.guide, g, dt);

  const ev = f.guide.event;
  if (ev === "called" || ev === "offered") {
    // It leaves from where it is (the guide copied `roam`); the guide owns it
    // now, so the mood and any swim home start clean.
    resetMood(f.mood);
    endReturn(f);
  }
  if (f.guide.guiding) copy(f.pos, f.guide.pos);
  else if (wasGuiding) { copy(f.pos, f.guide.pos); f.handBack = true; }
  else copy(f.pos, r);
  return f;
}

/**
 * After a hand-back: the caller has moved the loop to the phase nearest `f.pos`
 * and passes that loop point (surge and bob included). The gap is carried by
 * `ret`, outside the mood offset, so neither the mood leash (JELLY_LEASH) nor
 * PATH_JUMP can snap it home; it swims the gap in RETURN_MIN_S..RETURN_MAX_S.
 * Reduced motion has no streak (spec): it re-appears on its loop, as it
 * appeared beside the ship.
 */
export function beginReturn(f: JellyFrame, pathPos: Vec3, reducedMotion: boolean): void {
  resetMood(f.mood);
  const dx = f.pos.x - pathPos.x, dy = f.pos.y - pathPos.y, dz = f.pos.z - pathPos.z;
  const gap = Math.hypot(dx, dy, dz);
  if (reducedMotion || gap < 1e-6) {
    endReturn(f);
    copy(f.pos, pathPos);
    return;
  }
  f.returning = true;
  f.retFrom.x = f.ret.x = dx; f.retFrom.y = f.ret.y = dy; f.retFrom.z = f.ret.z = dz;
  f.retT = 0;
  f.retDur = Math.min(RETURN_MAX_S, Math.max(RETURN_MIN_S, gap / RETURN_SPEED));
}

/**
 * Whether the scanner may take it (UNKNOWN_LIFEFORM): only while it roams.
 * Guiding, its station (20 u), its wait (12 u) and its presenting circle
 * (10-30 u) sit inside SCAN_RANGE (22 u), so it would take the scanner from
 * the very thing it led the pilot to, and reset that world's scan. Not while
 * it swims home either, nor on the hand-back step.
 */
export function jellyScannable(f: JellyFrame): boolean {
  return !f.guide.guiding && !f.returning && !f.handBack;
}

/**
 * The glow streak's length, 0..1 (spec "Bell pulse": "the glow streak lengthens
 * during warp"; "Reduced motion": no streak). Drawn by stretching the
 * creature's own tentacles (SpaceJellyfish `uStreak`), so it costs no draw call,
 * buffer or shader program. `on`: the guide's streak flag, or a fast swim home.
 */
export function streakLength(on: boolean, speed: number, reducedMotion: boolean): number {
  if (!on || reducedMotion) return 0;
  const lo = GUIDE_STREAK_SPEED * 0.5;
  const t = Math.min(1, Math.max(0, (speed - lo) / (STREAK_FULL_SPEED - lo)));
  return t * t * (3 - 2 * t);
}
