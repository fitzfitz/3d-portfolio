import { SHIP_MAX_SPEED } from "../constants";
import { DESTINATIONS } from "../data/destinations";
import { JELLY_RADIUS, pushOutOfSolids, type JellyKeepOut } from "./jellyMood";
import { awayFrom, decay, type Vec3 } from "./reactions";
import { SHIP_HALF_LENGTH } from "./worldCollide";

/**
 * The jellyfish as a guide (spec 2026-10-23-jellyfish-guide: "Calling it",
 * "Offering itself", "Leading", "Arriving", "Reduced motion"). A pure state
 * machine, stepped once a frame by jellyFrame.ts (stepJellyFrame, which
 * SpaceJellyfish calls) and allocation-free: inputs come in one object the
 * caller reuses, every output is written into the state.
 *
 *   roaming --J / offer--> coming --~2 s--> leading --ship in radius--> presenting
 *      ^                     |                 ^  ^                      | one turn
 *      |                     |                 |  +- target id changed --+ (onward)
 *      |                     |                 |  |                      v
 *      |                     |                 |  +--- id changed ---- attending
 *      |                     |                 +-- pilot left undone ---+
 *      +---------- J, or target null (nothing left), from any state -----+
 *
 * Owner, 2026-10-23 ("After I reach my stop, what will the jellyfish do?"):
 * after the circle it attends, holding beside the stop while the pilot does
 * the step, then carries on to the next one until J or nothing is left.
 *
 * While roaming the component owns the position (loop + moods) and the guide
 * only passes it through and runs the lost timer. In every other state `pos` is
 * where the creature should be this frame: the component sets its group there
 * and skips the moods (`guiding`: never startled while guiding).
 */

export type GuideName = "roaming" | "coming" | "leading" | "presenting" | "attending";

/**
 * One per step at most, in `GuideState.event`, reset to null every step.
 * SpaceJellyfish turns them into radio lines (guideRadio.ts) and pulse kicks:
 * - `called`: J while roaming with somewhere to go; it starts streaking in.
 * - `offered`: lost for GUIDE_LOST_SECONDS; it starts streaking in on its own.
 * - `met`: it reached the ship (spec: "streaks to the ship, pulses"); leading begins.
 * - `arrived`: the ship entered the target's radius (the HUD's own lock-on
 *   radius; no lock action exists, spec build ruling R9); it presents.
 * - `onward`: the step it presented was done (the target id changed while it
 *   presented or attended); it leads to the next one.
 * - `dismissed`: J while active; it roams again.
 * - `allDone`: no target left (J with nothing to do, or the target went null
 *   while it guided: the last step was done); it roams.
 */
export type GuideEvent = "called" | "offered" | "met" | "arrived" | "onward" | "dismissed" | "allDone";

export interface GuideInput {
  /** The creature's roaming position this frame (loop + mood offset), as the component computes it. */
  jelly: Vec3;
  /** Ship world position and velocity (u/s, warp included). */
  ship: Vec3;
  shipVel: Vec3;
  /**
   * The ship's nose, a unit vector (pitchFlight.ts noseDirection's convention,
   * from flight.heading and flight.pitch). The station leans off it toward the
   * target by at most GUIDE_LEAD_MAX_ANGLE, so the guide stays in view.
   */
  shipNose: Vec3;
  /** Warp held: only the glow streak reads it; speed matching uses `shipVel`. */
  warping: boolean;
  /** World position of the logbook's NEXT place (spec, build ruling R1), or null when all is done. */
  target: Vec3 | null;
  /**
   * The target's identity (waypointTarget.ts WaypointTarget.id), "" with no
   * target. A changed id is a step done (when it has arrived) or a re-pick
   * (while it leads); a position is not, since probes relocate and worlds orbit.
   */
  targetId: string;
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
  /** OUTPUT: state name, for the debug bridge (spec, build ruling R6). */
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
  /** OUTPUT: draw the glow streak (fast travel; never under reduced motion). */
  streak: boolean;
  /**
   * This run began as an offer, whose radio line went out when it started, so
   * meeting the ship says nothing more (guideRadio.ts). Otherwise an offer
   * behaves as a call: it stays until the pilot arrives or presses J.
   */
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
  /** Presenting: the circle's centre (the target as it was on arrival), radius, start bearing, turn so far. */
  center: Vec3;
  radius: number;
  angle: number;
  turned: number;
  /** Presenting: the nearest it may come to the circle's axis (u), min(radius, where it started). */
  floor: number;
  /** The id of the target it leads to, presents or attends (GuideInput.targetId); the radio names it. */
  targetId: string;
  /** Attending: its offset from the target, held as the target moves. */
  hold: Vec3;
}

/** Spec: "after 45 s with no progress". */
export const GUIDE_LOST_SECONDS = 45;
/** Spec: "at most once every few minutes". Three minutes, counted from the offer. */
export const GUIDE_OFFER_COOLDOWN = 180;
/**
 * Spec: "it streaks to the ship (~2 s)" (spec, build ruling R7; the e2e bound is 25 u in
 * 3 s). Time-bound, not speed-capped: from across the system it is a streak.
 */
export const GUIDE_COME_SECONDS = 2;
/** Spec: "Station: ~20 u ahead of the ship along the route to the target". */
export const GUIDE_LEAD_DIST = 20;
/**
 * The most the station leans off the ship's nose toward the target (radians,
 * 20 degrees). Owner feedback 2026-10-23 (after #54): the guide must never fall
 * behind, so it holds GUIDE_LEAD_DIST in front of the nose, on the route when
 * the route is within this of the nose, else this far round toward it.
 *
 * The largest lean that stays on a landscape screen in every direction. The
 * chase camera (chaseCam.ts) sits d behind the ship and 1.8 u up, looking at
 * 1.5 u past it and 0.2 u up, so its axis dips atan(1.6 / (1.5 + d)) below the
 * nose. Seen from the camera, a station leaned up by a sits atan((20 sin a - 1.8)
 * / (20 cos a + d)) above the nose line. The worst case is a hovering ship (d =
 * 4.6, vertical fov 58, Spaceship.tsx): the axis dips 14.7 degrees. At 20
 * degrees the station is 12.2 above the nose, 26.9 above the axis, inside the 29
 * degree half-fov with 2.1 to spare. At cruise (d = 5.2, fov 64) it is 25.3 of
 * 32, and at warp (6.8 u back, 2.8 up, fov 86) 26.4 of 43. The owner's first
 * figure, 30 degrees, put it 35.2 above the axis at a hover, off the top, and 25
 * still 31.0. Sideways and downward leans sit nearer the axis: ~16-19 degrees
 * aside, inside the ~42 degree horizontal half-fov of a 16:10 screen, and under
 * 6 below. A portrait phone's ~14 degree horizontal half-fov still loses a
 * sideways lean (docs/FOLLOW-UPS.md).
 */
export const GUIDE_LEAD_MAX_ANGLE = (20 * Math.PI) / 180;
const LEAN_COS = Math.cos(GUIDE_LEAD_MAX_ANGLE);
const LEAN_SIN = Math.sin(GUIDE_LEAD_MAX_ANGLE);
/**
 * Closing rate on the station (1/s) on top of the ship's own speed. The
 * station moves at the ship's velocity, so the ship's speed alone holds it
 * exactly, warp included; this term only closes a gap (a turn swinging the
 * station round the ship, a jump, a keep-out detour), halving it every ~0.46 s.
 */
export const GUIDE_CATCHUP_GAIN = 1.5;
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
/**
 * Attending: the pilot has left without doing the step once the ship is this
 * far (u) past the target's arrival radius; it leads back. The gap keeps a
 * pilot drifting at the edge of the radius from flickering it between
 * attending and arriving again, and clears a docked ship's orbit (10 u round
 * the career station, whose radius is 8.5).
 */
export const GUIDE_ATTEND_LEAVE_MARGIN = 15;
/** Half-life (s) of easing onto the circle, so the arrival point blends in. */
const PRESENT_HALF_LIFE = 0.3;
/**
 * Reduced motion has no streak (spec): a gap larger than this (u), e.g. after
 * a number-key jump, is closed by re-appearing at the station. A turn swings
 * the station at most 2 * 20 * sin(80 degrees) = 39.4 u round the ship, under
 * this, so a turn is swum, not snapped.
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
    guiding: false, streak: false, offered: false,
    lostFor: 0, cooldown: 0, progress: NaN,
    comeT: 0, from: { x: 0, y: 0, z: 0 },
    center: { x: 0, y: 0, z: 0 }, radius: 0, angle: 0, turned: 0, floor: 0,
    targetId: "", hold: { x: 0, y: 0, z: 0 },
  };
}

const prev = { x: 0, y: 0, z: 0 };
const route = { x: 0, y: 0, z: 0 };
/** Unit direction from the ship to its station (far from the target). */
const lead = { x: 0, y: 0, z: 0 };
const station = { x: 0, y: 0, z: 0 };
/** The target as a keep-out of radius GUIDE_PRESENT_MIN_R (moved onto the target each step). */
const targetKeep: JellyKeepOut[] = [{ x: 0, y: 0, z: 0, r: GUIDE_PRESENT_MIN_R, body: GUIDE_PRESENT_MIN_R }];

function copy(o: Vec3, a: Vec3) { o.x = a.x; o.y = a.y; o.z = a.z; }
function dist(a: Vec3, b: Vec3) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

/** Ship distance (u) inside which the station leaves the route for the target's side. */
const NEAR_TARGET = GUIDE_LEAD_DIST + GUIDE_PRESENT_MIN_R;

/**
 * The direction from the ship to its station, into `lead`: the route when it
 * is within GUIDE_LEAD_MAX_ANGLE of the nose (flying at the target: the spec's
 * station exactly), else the nose turned that far toward the route, in their
 * common plane, so the guide stays in front of the pilot and still points the
 * way (owner feedback 2026-10-23, after #54: "I'm able to pass the jellyfish").
 * Flying straight away the plane is undefined; it turns toward the nose's
 * horizontal perpendicular instead (world +x for a vertical nose), so it is
 * stable frame to frame and never NaN.
 */
function setLead(nose: Vec3) {
  const c = nose.x * route.x + nose.y * route.y + nose.z * route.z;
  if (c >= LEAN_COS) { copy(lead, route); return; }
  // The route's part perpendicular to the nose: the way to turn.
  let px = route.x - nose.x * c, py = route.y - nose.y * c, pz = route.z - nose.z * c;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    px = nose.z; py = 0; pz = -nose.x; pl = Math.hypot(px, pz);
    if (pl < 1e-6) { px = 1; pz = 0; pl = 1; }
  }
  const k = LEAN_SIN / pl;
  lead.x = nose.x * LEAN_COS + px * k;
  lead.y = nose.y * LEAN_COS + py * k;
  lead.z = nose.z * LEAN_COS + pz * k;
}

/**
 * The station: GUIDE_LEAD_DIST in front of the ship, toward the target as far
 * as the nose allows (setLead; spec "Leading"). Near the target that point
 * would sit inside it: the career
 * station is reached at 8.5 u, the portal at 2.2, both well inside the 20 u
 * lead. So once the ship is within NEAR_TARGET, the station swings round the
 * target at GUIDE_PRESENT_MIN_R, from the route (where the two rules meet, at
 * exactly NEAR_TARGET: no jump) to beside it, on the route's horizontal
 * perpendicular (by the time the ship is GUIDE_PRESENT_MIN_R out). It holds
 * there, out of the ship's path, and presenting starts from that circle. A
 * pilot not facing the target meets this rule with the station leaned off the
 * route, so it swims the difference (under 40 u: no reduced-motion snap).
 */
function setStation(inp: GuideInput, target: Vec3) {
  awayFrom(route, inp.ship, target);
  const d = dist(inp.ship, target);
  if (d >= NEAR_TARGET) {
    setLead(inp.shipNose);
    station.x = inp.ship.x + lead.x * GUIDE_LEAD_DIST;
    station.y = inp.ship.y + lead.y * GUIDE_LEAD_DIST;
    station.z = inp.ship.z + lead.z * GUIDE_LEAD_DIST;
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
 * streak in, a catch-up, a swing round a pilot turning near the target).
 */
function keepClear(p: Vec3, target: Vec3, keepOut: readonly JellyKeepOut[]) {
  copy(targetKeep[0], target);
  pushOutOfSolids(p, targetKeep);
  pushOutOfSolids(p, keepOut);
}

function startComing(s: GuideState, inp: GuideInput, offered: boolean) {
  s.name = "coming";
  s.offered = offered;
  s.targetId = inp.targetId;
  s.comeT = 0;
  s.lostFor = 0;
  copy(s.from, inp.jelly);
  copy(s.pos, inp.jelly);
}

function toRoaming(s: GuideState) {
  s.name = "roaming";
  s.offered = false;
  s.lostFor = 0;
}

function stepComing(s: GuideState, inp: GuideInput, target: Vec3, dt: number) {
  s.targetId = inp.targetId;
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
  // A changed id while it leads is a re-pick (a nearer unread probe), not a
  // step done: it follows silently.
  s.targetId = inp.targetId;
  // Arrival is the ship's, not the creature's (spec "Arriving": "the HUD's
  // target locks on", the pilot's arrival). The creature rides ~20 u ahead and
  // would cross the radius long before the pilot it is guiding.
  if (dist(inp.ship, target) <= inp.targetRadius) {
    startPresenting(s, inp, target);
    s.event = "arrived";
    return;
  }
  setStation(inp, target);
  // Owner feedback 2026-10-23 (after #54), overriding the spec's "Waiting":
  // it never falls behind. Wherever the pilot flies it tracks its station in
  // front of the nose: the ship's own speed holds the station exactly (spec:
  // "matching the ship's speed, warp included"); the gain closes any gap (a
  // turn, a jump, a keep-out detour). No overshoot.
  const v = inp.shipVel, sp = Math.hypot(v.x, v.y, v.z);
  const gx = station.x - s.pos.x, gy = station.y - s.pos.y, gz = station.z - s.pos.z;
  const gap = Math.hypot(gx, gy, gz);
  if (inp.reducedMotion && gap > GUIDE_REDUCED_SNAP_DIST) {
    copy(s.pos, station);
  } else {
    const step = (sp + GUIDE_CATCHUP_GAIN * gap) * dt;
    if (step >= gap) copy(s.pos, station);
    else { const k = step / gap; s.pos.x += gx * k; s.pos.y += gy * k; s.pos.z += gz * k; }
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
    // Spec "Arriving" (owner, 2026-10-23): after the one turn it carries on,
    // never home: on to the next step if this one was done while it circled,
    // else it attends here. Nothing left goes to roaming.
    const target = inp.target;
    if (!target) { toRoaming(s); s.event = "allDone"; }
    else if (inp.targetId !== s.targetId) goOnward(s, inp);
    else {
      s.name = "attending";
      s.hold.x = s.pos.x - target.x; s.hold.y = s.pos.y - target.y; s.hold.z = s.pos.z - target.z;
    }
  }
}

/** The step was done: lead on to the next target, saying so (the radio names it by `targetId`). */
function goOnward(s: GuideState, inp: GuideInput) {
  s.name = "leading";
  s.targetId = inp.targetId;
  s.event = "onward";
}

/**
 * Attending: it holds beside the stop, where its circle ended, while the
 * pilot does the step. Still relative to the target (a world orbits, a probe
 * is pulled by the beam), so the posture stands it upright. The step done
 * changes the target's id; the pilot leaving undone sends it back to leading
 * the same target. A docking panel freezes the frame loop, so it simply
 * attends until the panel closes and the id has changed.
 */
function stepAttending(s: GuideState, inp: GuideInput, target: Vec3, dt: number) {
  if (inp.targetId !== s.targetId) { goOnward(s, inp); return; }
  if (dist(inp.ship, target) > inp.targetRadius + GUIDE_ATTEND_LEAVE_MARGIN) {
    s.name = "leading";
    stepLeading(s, inp, target, dt);
    return;
  }
  s.pos.x = target.x + s.hold.x; s.pos.y = target.y + s.hold.y; s.pos.z = target.z + s.hold.z;
  pushOutOfSolids(s.pos, inp.keepOut);
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
    // Spec, build ruling R1: null target means everything is done, so it roams. Presenting
    // keeps its own centre and finishes its turn first.
    if (!target && s.name !== "presenting") { toRoaming(s); s.event = "allDone"; }
    else if (s.name === "coming") stepComing(s, inp, target!, dt);
    else if (s.name === "leading") stepLeading(s, inp, target!, dt);
    else if (s.name === "attending") stepAttending(s, inp, target!, dt);
    else stepPresenting(s, inp, dt);
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
