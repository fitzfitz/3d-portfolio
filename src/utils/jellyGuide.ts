import { SHIP_MAX_SPEED } from "../constants";
import { DESTINATIONS } from "../data/destinations";
import { JELLY_RADIUS, pushOutOfSolids, type JellyKeepOut } from "./jellyMood";
import { awayFrom, decay, type Vec3 } from "./reactions";
import { SHIP_HALF_LENGTH } from "./worldCollide";

/**
 * The jellyfish as a guide (spec 2026-10-23-jellyfish-guide: "Calling it",
 * "Offering itself", "Leading", "Arriving", "Reduced motion"). A pure state
 * machine, stepped once a frame by SpaceJellyfish and allocation-free: inputs
 * come in one object the caller reuses, every output is written into the state.
 *
 *   roaming --J / offer--> coming --~2 s--> leading --ship in radius--> presenting
 *      ^                     |                 |                         | one turn
 *      +---- J, target null, or (offer only) the pilot flies away -------+
 *
 * While roaming the component owns the position (loop + moods) and the guide
 * only passes it through and runs the lost timer. In every other state `pos` is
 * where the creature should be this frame: the component sets its group there
 * and skips the moods (`guiding`: never startled while guiding).
 */

export type GuideName = "roaming" | "coming" | "leading" | "presenting";

/**
 * One per step at most, in `GuideState.event`, reset to null every step. For
 * Task 5's radio lines and HUD lock:
 * - `called`: J while roaming with somewhere to go; it starts streaking in.
 * - `offered`: lost for GUIDE_LOST_SECONDS; it starts streaking in on its own.
 * - `met`: it reached the ship (spec: "streaks to the ship, pulses"); leading begins.
 * - `arrived`: the ship entered the target's radius; it presents (HUD target lock).
 * - `dismissed`: J while active; it roams again.
 * - `declined`: the pilot flew away from an offer; it roams again.
 * - `allDone`: no target left (J with nothing to do, the target went null
 *   mid-guide, or the last step was just presented); it roams.
 */
export type GuideEvent = "called" | "offered" | "met" | "arrived" | "dismissed" | "declined" | "allDone";

export interface GuideInput {
  /** The creature's roaming position this frame (loop + mood offset), as the component computes it. */
  jelly: Vec3;
  /** Ship world position and velocity (u/s, warp included). */
  ship: Vec3;
  shipVel: Vec3;
  /** Warp held: only the glow streak reads it; speed matching uses `shipVel`. */
  warping: boolean;
  /** World position of the logbook's NEXT place (controller ruling R1), or null when all is done. */
  target: Vec3 | null;
  /** The target's dock or scan radius: the ship inside it has arrived. */
  targetRadius: number;
  /**
   * Progress signature: any number that changes when progress is made (a newly
   * opened dossier, reached destination, charted world or earned logbook entry;
   * a sum of those counts will do). A number, so building it allocates nothing.
   */
  progress: number;
  /**
   * Any offer blocker: docked or orbit-locked, a dossier open, racing, photo
   * mode, the classic résumé, or another broadcast holding the radio (spec
   * "Offering itself"). Gates the offer only, never a J call.
   */
  blocked: boolean;
  reducedMotion: boolean;
  /** J pressed since the last step (an edge: the caller clears it after the step). */
  toggle: boolean;
  /** The same keep-out list the moods use (planets, moons, stations). */
  keepOut: readonly JellyKeepOut[];
}

export interface GuideState {
  /** OUTPUT: state name, for the debug bridge (ruling R6). */
  name: GuideName;
  /** OUTPUT: this step's transition, or null. */
  event: GuideEvent | null;
  /**
   * OUTPUT: where the creature should be this frame. While roaming it is a copy
   * of `input.jelly`, except on the step it returns to roaming, when it still
   * holds the last guided position (so the component can pick the nearest loop
   * phase from where the guide actually left it).
   */
  pos: Vec3;
  /** OUTPUT: this step's displacement over dt (u/s). Spikes on the hand-back step. */
  vel: Vec3;
  /** OUTPUT: name !== "roaming". The component skips mood stepping (no startle) while set. */
  guiding: boolean;
  /** OUTPUT: leading, but holding for a pilot who turned away or fell behind. */
  waiting: boolean;
  /** OUTPUT: draw the glow streak (fast travel; never under reduced motion). */
  streak: boolean;
  /** This run began as an offer, so flying away from it withdraws it. */
  offered: boolean;
  /** Seconds lost (no progress, no blocker) while roaming. */
  lostFor: number;
  /** Seconds until another offer is allowed. */
  cooldown: number;
  /** Last progress signature seen (NaN until the first step). */
  progress: number;
  /** Streak-in clock and start point. */
  comeT: number;
  from: Vec3;
  /** Closest the ship has been to an offer since it began (u). */
  offerNear: number;
  /** Presenting: the circle's centre (the target as it was on arrival), radius, start bearing, turn so far. */
  center: Vec3;
  radius: number;
  angle: number;
  turned: number;
  /** Presenting: the nearest it may come to the circle's axis (u), min(radius, where it started). */
  floor: number;
}

/** Spec: "after 45 s with no progress". */
export const GUIDE_LOST_SECONDS = 45;
/** Spec: "at most once every few minutes". Three minutes, counted from the offer. */
export const GUIDE_OFFER_COOLDOWN = 180;
/**
 * Spec: "it streaks to the ship (~2 s)" (ruling R7; the e2e bound is 25 u in
 * 3 s). Time-bound, not speed-capped: from across the system it is a streak.
 */
export const GUIDE_COME_SECONDS = 2;
/** Spec: "Station: ~20 u ahead of the ship along the route to the target". */
export const GUIDE_LEAD_DIST = 20;
/**
 * Closing rate on the station (1/s) on top of the ship's own speed. The
 * station moves at the ship's velocity, so the ship's speed alone holds it
 * exactly, warp included; this term only closes a gap (after waiting, or a
 * keep-out detour), halving it every ~0.46 s.
 */
export const GUIDE_CATCHUP_GAIN = 1.5;
/** Below this the ship is hovering, neither following nor turning away (u/s). */
export const GUIDE_MOVING_SPEED = 1;
/**
 * Turned away: the ship's heading is more than ~78 degrees off the route
 * (velocity along the route under 0.2 of its speed). Flying across the route
 * is not following. It leads again once the heading is within 60 degrees
 * (0.5): the gap between the two keeps a weaving pilot from flickering it.
 */
export const GUIDE_AWAY_COS = 0.2;
export const GUIDE_RESUME_COS = 0.5;
/**
 * Fallen behind: the ship is this far from the guide (u) and not heading to
 * the target. Station distance plus 25 u of slack, so a keep-out detour round
 * a moon is not the pilot falling behind; a pilot who is following never gets
 * here, since the station rides with the ship.
 */
export const GUIDE_FALL_BEHIND_DIST = GUIDE_LEAD_DIST + 25;
/**
 * Waiting: it swims back toward the ship and holds this far off (u): ~3 body
 * heights, outside the moods' 8 u rest distance, so it beckons without crowding.
 */
export const GUIDE_WAIT_DIST = 12;
/**
 * Waiting swim speed cap (u/s): above the posture's 2.37 u/s swim threshold, so
 * it reads as turning and swimming back bell first; well under the 10.8 cruise,
 * so a pilot who keeps going does leave it (spec: it "slows", it does not chase).
 */
export const GUIDE_WAIT_MAX_SPEED = 6;
/** Waiting swim speed per u of distance beyond the hold (1/s): eases in, no snap. */
const WAIT_GAIN = 0.5;
/** Half-life (s) of the slow-down into waiting: a cruise-speed lead brakes in ~1 s. */
const WAIT_HALF_LIFE = 0.25;
/**
 * Flying away from an offer (spec: "it goes back to roaming"): the ship-guide
 * distance has grown this far (u) past the closest it has been since the
 * offer. Measured from the closest, not absolutely, because an offer starts
 * wherever the loop had it, often hundreds of u off. 3x the station distance:
 * a following pilot never opens it, a cruising pilot who leaves the waiting
 * guide opens it in ~12 s, a warping one in a fraction of a second.
 */
export const GUIDE_OFFER_LEAVE_DIST = 60;
/** Spec: "It circles the target once". One unhurried turn. */
export const GUIDE_PRESENT_SECONDS = 8;
/** Margin (u) between the creature's reach and whatever it circles or keeps off. */
const PRESENT_CLEAR = 2;
/**
 * Closest it comes to its target (u), and the presenting circle's smallest
 * radius. A docked ship orbits a destination at its orbitR (10 at the career
 * station and the shipyard, 2.6 at the portal; Spaceship.tsx), so the circle
 * clears the widest orbit by the ship's half length (1.2), the creature's reach
 * (JELLY_RADIUS, 3.4) and PRESENT_CLEAR: 16.7. That also clears every model it
 * is led to: the career station reaches 5.2 u from its centre, the portal's
 * frame 7.0 (portal_gateway.glb 8.28 at scale 0.85), a probe 1.6.
 */
export const GUIDE_PRESENT_MIN_R =
  Math.max(...DESTINATIONS.map((d) => d.orbitR)) + SHIP_HALF_LENGTH + JELLY_RADIUS + PRESENT_CLEAR;
/**
 * Widest presenting circle (u): about a typical scan radius, so the turn stays
 * in view. A target inside a solid (an uncharted world) widens it to clear that body.
 */
export const GUIDE_PRESENT_MAX_R = 30;
/** Half-life (s) of easing onto the circle, so the arrival point blends in. */
const PRESENT_HALF_LIFE = 0.3;
/**
 * Reduced motion has no streak (spec): a gap larger than this (u), e.g. after
 * the pilot left it waiting, is closed by re-appearing at the station.
 */
export const GUIDE_REDUCED_SNAP_DIST = 40;
/** Faster than this (1.5x cruise) is fast travel and draws the glow streak. */
export const GUIDE_STREAK_SPEED = SHIP_MAX_SPEED * 1.5;
/** A frame longer than this (a backgrounded tab) is not 10 s of being lost. */
const MAX_DT = 0.25;

const TURN = Math.PI * 2;

export function createGuideState(): GuideState {
  return {
    name: "roaming", event: null,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    guiding: false, waiting: false, streak: false, offered: false,
    lostFor: 0, cooldown: 0, progress: NaN,
    comeT: 0, from: { x: 0, y: 0, z: 0 }, offerNear: Infinity,
    center: { x: 0, y: 0, z: 0 }, radius: 0, angle: 0, turned: 0, floor: 0,
  };
}

const prev = { x: 0, y: 0, z: 0 };
const route = { x: 0, y: 0, z: 0 };
const station = { x: 0, y: 0, z: 0 };
/** The target as a keep-out of radius GUIDE_PRESENT_MIN_R (moved onto the target each step). */
const targetKeep: JellyKeepOut[] = [{ x: 0, y: 0, z: 0, r: GUIDE_PRESENT_MIN_R, body: GUIDE_PRESENT_MIN_R }];

function copy(o: Vec3, a: Vec3) { o.x = a.x; o.y = a.y; o.z = a.z; }
function dist(a: Vec3, b: Vec3) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

/** Ship distance (u) inside which the station leaves the route for the target's side. */
const NEAR_TARGET = GUIDE_LEAD_DIST + GUIDE_PRESENT_MIN_R;

/**
 * The station: GUIDE_LEAD_DIST ahead of the ship toward the target (spec
 * "Leading"). Near the target that point would sit inside it: the career
 * station is reached at 8.5 u, the portal at 2.2, both well inside the 20 u
 * lead. So once the ship is within NEAR_TARGET, the station swings round the
 * target at GUIDE_PRESENT_MIN_R, from the route (where the two rules meet, at
 * exactly NEAR_TARGET: no jump) to beside it, on the route's horizontal
 * perpendicular (by the time the ship is GUIDE_PRESENT_MIN_R out). It waits
 * there, out of the ship's path, and presenting starts from that circle.
 */
function setStation(inp: GuideInput, target: Vec3) {
  awayFrom(route, inp.ship, target);
  const d = dist(inp.ship, target);
  if (d >= NEAR_TARGET) {
    station.x = inp.ship.x + route.x * GUIDE_LEAD_DIST;
    station.y = inp.ship.y + route.y * GUIDE_LEAD_DIST;
    station.z = inp.ship.z + route.z * GUIDE_LEAD_DIST;
    return;
  }
  // The side: the route's horizontal perpendicular; a vertical route has none, so +x.
  let sx = route.z, sz = -route.x;
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-6) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }
  // Bearing from the target: back along the route (toward the ship), turning to
  // the side. The two are perpendicular, so the blend never vanishes.
  const w = Math.min(1, (NEAR_TARGET - d) / GUIDE_LEAD_DIST);
  const bx = -route.x * (1 - w) + sx * w, by = -route.y * (1 - w), bz = -route.z * (1 - w) + sz * w;
  const k = GUIDE_PRESENT_MIN_R / Math.hypot(bx, by, bz);
  station.x = target.x + bx * k;
  station.y = target.y + by * k;
  station.z = target.z + bz * k;
}

/**
 * Keep it GUIDE_PRESENT_MIN_R off its target, then out of every solid (spec
 * "Leading": "it keeps clear of every solid (planets, moons, stations)"). The
 * station never sits closer, but the straight line to it can cut inside (a
 * streak in, a catch-up, a swim back to a pilot waiting near the target).
 */
function keepClear(p: Vec3, target: Vec3, keepOut: readonly JellyKeepOut[]) {
  copy(targetKeep[0], target);
  pushOutOfSolids(p, targetKeep);
  pushOutOfSolids(p, keepOut);
}

function startComing(s: GuideState, inp: GuideInput, offered: boolean) {
  s.name = "coming";
  s.offered = offered;
  s.waiting = false;
  s.comeT = 0;
  s.lostFor = 0;
  s.offerNear = Infinity;
  copy(s.from, inp.jelly);
  copy(s.pos, inp.jelly);
}

function toRoaming(s: GuideState) {
  s.name = "roaming";
  s.offered = false;
  s.waiting = false;
  s.lostFor = 0;
}

function stepComing(s: GuideState, inp: GuideInput, target: Vec3, dt: number) {
  setStation(inp, target);
  s.comeT += dt;
  if (inp.reducedMotion) {
    // Spec "Reduced motion": "it appears beside the ship instead of swimming in".
    copy(s.pos, station);
  } else {
    // Eased in and out along a line to the moving station: the end point is
    // re-read every frame, so it lands on the station at GUIDE_COME_SECONDS
    // however far or fast the ship is.
    const t = Math.min(1, s.comeT / GUIDE_COME_SECONDS), e = t * t * (3 - 2 * t);
    s.pos.x = s.from.x + (station.x - s.from.x) * e;
    s.pos.y = s.from.y + (station.y - s.from.y) * e;
    s.pos.z = s.from.z + (station.z - s.from.z) * e;
  }
  keepClear(s.pos, target, inp.keepOut);
  // Reduced motion appears on the call/offer step and meets on the next, so the
  // two events never share a step.
  if (s.event === null && (s.comeT >= GUIDE_COME_SECONDS || inp.reducedMotion)) {
    s.name = "leading";
    s.event = "met";
  }
}

function startPresenting(s: GuideState, inp: GuideInput, target: Vec3) {
  s.name = "presenting";
  s.waiting = false;
  copy(s.center, target);
  const dx = s.pos.x - target.x, dz = s.pos.z - target.z, h = Math.hypot(dx, dz);
  let r = Math.min(GUIDE_PRESENT_MAX_R, Math.max(GUIDE_PRESENT_MIN_R, h));
  // A circle in the target's horizontal plane at r >= body + |centre offset|
  // clears a body that contains the target (an uncharted world's centre).
  for (const k of inp.keepOut) {
    const dk = dist(target, k);
    if (dk < k.body) r = Math.max(r, k.body + dk + PRESENT_CLEAR);
  }
  s.radius = r;
  s.angle = h > 1e-6 ? Math.atan2(dz, dx) : 0;
  s.turned = 0;
  // Arriving beside a near target (setStation) it is already on the circle, so
  // the floor is the radius; arriving from inside it (above or below the
  // target), it is where it started, so the floor never snaps it outward.
  s.floor = Math.min(r, h);
}

function stepLeading(s: GuideState, inp: GuideInput, target: Vec3, dt: number) {
  // Arrival is the ship's, not the creature's (spec "Arriving": "the HUD's
  // target locks on", the pilot's arrival). The creature rides ~20 u ahead and
  // would cross the radius long before the pilot it is guiding.
  if (dist(inp.ship, target) <= inp.targetRadius) {
    startPresenting(s, inp, target);
    s.event = "arrived";
    return;
  }
  setStation(inp, target);
  const v = inp.shipVel, sp = Math.hypot(v.x, v.y, v.z);
  const along = v.x * route.x + v.y * route.y + v.z * route.z;
  const moving = sp > GUIDE_MOVING_SPEED;
  const toward = moving && along >= GUIDE_RESUME_COS * sp;
  const away = moving && along < GUIDE_AWAY_COS * sp;
  const behind = dist(s.pos, inp.ship) > GUIDE_FALL_BEHIND_DIST;
  // Spec "Waiting": "if the pilot falls behind or turns away, it slows and
  // turns back toward the ship until the pilot follows again". A hovering ship
  // close by is neither: it holds its station, still pointing the way.
  if (s.waiting) { if (toward) s.waiting = false; }
  else if (away || (behind && !toward)) s.waiting = true;

  if (!s.waiting) {
    const gx = station.x - s.pos.x, gy = station.y - s.pos.y, gz = station.z - s.pos.z;
    const gap = Math.hypot(gx, gy, gz);
    if (inp.reducedMotion && gap > GUIDE_REDUCED_SNAP_DIST) {
      copy(s.pos, station);
    } else {
      // The ship's own speed holds the station exactly (spec: "matching the
      // ship's speed, warp included"); the gain closes any gap. No overshoot.
      const step = (sp + GUIDE_CATCHUP_GAIN * gap) * dt;
      if (step >= gap) copy(s.pos, station);
      else { const k = step / gap; s.pos.x += gx * k; s.pos.y += gy * k; s.pos.z += gz * k; }
    }
  } else {
    // Brake from last step's velocity toward a slow swim back to the ship,
    // holding GUIDE_WAIT_DIST off. Easing the velocity (not the position) is
    // what makes it slow first and then turn round. That velocity is last
    // step's displacement over dt, which a reduced-motion re-appearance
    // (> 40 u in a frame: >= 2400 u/s) or a catch-up from far off
    // (sp + 1.5 * gap: ~790 u/s from 500 u) spikes; braking from that coasts
    // ~0.36 v on, hundreds to thousands of u past the ship. So it brakes from
    // no faster than the ship flies, or its own waiting swim.
    const cap = Math.max(sp, GUIDE_WAIT_MAX_SPEED), vl = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
    if (vl > cap) { const c = cap / vl; s.vel.x *= c; s.vel.y *= c; s.vel.z *= c; }
    const tx = inp.ship.x - s.pos.x, ty = inp.ship.y - s.pos.y, tz = inp.ship.z - s.pos.z;
    const d = Math.hypot(tx, ty, tz);
    const want = d > GUIDE_WAIT_DIST ? Math.min(GUIDE_WAIT_MAX_SPEED, WAIT_GAIN * (d - GUIDE_WAIT_DIST)) / d : 0;
    const k = decay(WAIT_HALF_LIFE, dt);
    s.vel.x = tx * want + (s.vel.x - tx * want) * k;
    s.vel.y = ty * want + (s.vel.y - ty * want) * k;
    s.vel.z = tz * want + (s.vel.z - tz * want) * k;
    s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt; s.pos.z += s.vel.z * dt;
  }
  // Spec "Leading": "it keeps clear of every solid ... as the keep-out law does today".
  keepClear(s.pos, target, inp.keepOut);
}

function stepPresenting(s: GuideState, inp: GuideInput, dt: number) {
  s.turned += (TURN / GUIDE_PRESENT_SECONDS) * dt;
  const a = s.angle + s.turned;
  const k = decay(PRESENT_HALF_LIFE, dt);
  const wx = s.center.x + s.radius * Math.cos(a), wy = s.center.y, wz = s.center.z + s.radius * Math.sin(a);
  s.pos.x = wx + (s.pos.x - wx) * k;
  s.pos.y = wy + (s.pos.y - wy) * k;
  s.pos.z = wz + (s.pos.z - wz) * k;
  // The eased follow trails the moving circle point on a chord, ~5% inside the
  // circle (a first-order lag at 0.79 rad/s, 0.43 s time constant): held out
  // at the floor, so it never cuts in toward the target or a docked ship's orbit.
  const fx = s.pos.x - s.center.x, fz = s.pos.z - s.center.z, fh = Math.hypot(fx, fz);
  if (fh < s.floor && fh > 1e-9) {
    const f = s.floor / fh;
    s.pos.x = s.center.x + fx * f;
    s.pos.z = s.center.z + fz * f;
  }
  pushOutOfSolids(s.pos, inp.keepOut);
  if (s.turned >= TURN) {
    // Spec "Arriving": "Then it returns to roaming, or leads to the next step if called again".
    toRoaming(s);
    if (!inp.target) s.event = "allDone";
  }
}

/**
 * One frame of the guide. Order: progress and cooldown clocks; J; the lost
 * timer (roaming only); then the active state's motion. dt <= 0 does nothing.
 */
export function stepGuide(s: GuideState, inp: GuideInput, dt: number): GuideState {
  s.event = null;
  if (!(dt > 0)) return s;
  dt = Math.min(dt, MAX_DT);
  const wasGuiding = s.name !== "roaming";
  copy(prev, s.pos);

  if (inp.progress !== s.progress) { s.progress = inp.progress; s.lostFor = 0; }
  s.cooldown = Math.max(0, s.cooldown - dt);

  // Spec "Calling it": J toggles. Blockers gate only the offer (spec lists them
  // under "Offering itself"); a pilot who asks gets it, and the radio line is
  // the component's to hold back if the radio is busy. The cooldown is the
  // offer's, so a call ignores it and does not restart it.
  if (inp.toggle) {
    if (s.name !== "roaming") { toRoaming(s); s.event = "dismissed"; }
    else if (inp.target) { startComing(s, inp, false); s.event = "called"; }
    else s.event = "allDone";
  }

  if (s.name === "roaming") {
    // The lost timer pauses under a blocker rather than resetting: the spec's
    // "45 s with no progress and no blocker" is unblocked time, and the radio
    // (a blocker) is busy often enough that a reset would starve the offer.
    // A real step forward (a dossier opened, a world charted) changes the
    // progress signature, and that is what resets it.
    if (s.event === null && !inp.blocked) {
      s.lostFor += dt;
      if (s.lostFor >= GUIDE_LOST_SECONDS && s.cooldown <= 0 && inp.target) {
        startComing(s, inp, true);
        s.event = "offered";
        s.cooldown = GUIDE_OFFER_COOLDOWN;
      }
    }
  }

  if (s.name !== "roaming") {
    const target = inp.target;
    // Ruling R1: null target means everything is done, so it roams. Presenting
    // keeps its own centre and finishes its turn first.
    if (!target && s.name !== "presenting") { toRoaming(s); s.event = "allDone"; }
    else if (s.name === "coming") stepComing(s, inp, target!, dt);
    else if (s.name === "leading") stepLeading(s, inp, target!, dt);
    else stepPresenting(s, inp, dt);

    if (s.offered && (s.name === "coming" || s.name === "leading") && s.event === null) {
      const d = dist(s.pos, inp.ship);
      s.offerNear = Math.min(s.offerNear, d);
      if (d > s.offerNear + GUIDE_OFFER_LEAVE_DIST) { toRoaming(s); s.event = "declined"; }
    }
  }

  // Roaming passes the component's position through, except on the step it
  // hands back, which keeps the last guided position for the component.
  if (s.name === "roaming" && !wasGuiding) copy(s.pos, inp.jelly);

  s.vel.x = (s.pos.x - prev.x) / dt; s.vel.y = (s.pos.y - prev.y) / dt; s.vel.z = (s.pos.z - prev.z) / dt;
  s.guiding = s.name !== "roaming";
  const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  s.streak = !inp.reducedMotion &&
    (s.name === "coming" || (s.name === "leading" && (inp.warping || speed > GUIDE_STREAK_SPEED)));
  return s;
}
