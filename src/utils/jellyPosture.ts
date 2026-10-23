import { PATH_JUMP } from "./jellyMood";

/**
 * Swim posture for the jellyfish (spec 2026-10-23-jellyfish-guide, "Swim
 * posture"): upright while it stands, bell (model +y) along the travel direction
 * while it swims. Pure and allocation-free: the frame loop calls it every frame.
 *
 * Output contract (Task 3 reads this): the orientation goes into the caller's
 * `out` quaternion; the 0..1 swim factor is `state.swim` (the same damped weight
 * the orientation uses, so the shader's tentacle ripple and the lean agree).
 */

export interface Quat { x: number; y: number; z: number; w: number }
interface Vec3 { x: number; y: number; z: number }

export interface PostureState {
  /** Current orientation (unit quaternion), eased toward the target each step. */
  q: Quat;
  /** Last heading while it was moving at all; held when it stops so a restart blends from it. */
  dir: Vec3;
  /** 0..1 swim factor, damped. 0 = upright, 1 = fully bell-first. OUTPUT. */
  swim: number;
  /** Roll about the bell axis (rad), toward the turn. */
  bank: number;
  /** Smoothed velocity from `stepVelocity` (u/s). */
  vel: Vec3;
  /** Last position sample for `stepVelocity`. */
  last: Vec3;
  hasLast: boolean;
}

/**
 * Below POSTURE_V_SLOW it stands; above POSTURE_V_SWIM it swims bell first, with
 * a smoothstep between (u/s). The loop path is 1183.8 u over 400 s = 2.96 u/s on
 * average, which is under the plan's 3 u/s swim threshold, so per the controller
 * ruling vSwim = 0.8 x that = 2.37: roaming has to read as swimming, bell first
 * (the surge strokes lift it well above the mean). Cruise tops out at 10.8 u/s.
 * tests/jellyPosture.test.ts re-measures the path so a re-routed loop can't
 * silently stop swimming.
 */
export const POSTURE_V_SLOW = 0.6;
export const POSTURE_V_SWIM = 2.37;
/** Half-lives (s): fast into a swim or a turn, slow back to upright (spec: ~1 s). */
const HALF_LIFE_TURN = 0.3;
const HALF_LIFE_UPRIGHT = 1;
/** Half-life of the velocity smoothing: wide enough to flatten the ~3.2 s surge strokes. */
const HALF_LIFE_VEL = 0.5;
/** Bank per rad/s of yaw rate, capped so a hard turn leans, never rolls over. */
const BANK_GAIN = 0.35;
const BANK_MAX = 0.4;

export function createPostureState(): PostureState {
  return {
    q: { x: 0, y: 0, z: 0, w: 1 }, dir: { x: 0, y: 1, z: 0 }, swim: 0, bank: 0,
    vel: { x: 0, y: 0, z: 0 }, last: { x: 0, y: 0, z: 0 }, hasLast: false,
  };
}

/** Fraction of the gap closed this frame for a given half-life. */
function rate(dt: number, halfLife: number): number {
  return 1 - Math.pow(2, -dt / halfLife);
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * Feed this frame's world position. Velocity is the position delta over dt,
 * eased. A first sample, dt = 0, or a jump longer than the mood module's
 * PATH_JUMP (the J summon, a loop-phase jump, a teleport) is "no sample": the
 * velocity holds and the next frame measures from the new spot, so a jump can't
 * read as a 2000 u/s dash and yank the posture.
 */
export function stepVelocity(s: PostureState, x: number, y: number, z: number, dt: number): void {
  if (dt <= 0) return;
  const dx = x - s.last.x, dy = y - s.last.y, dz = z - s.last.z;
  s.last.x = x; s.last.y = y; s.last.z = z;
  if (!s.hasLast) { s.hasLast = true; return; }
  if (Math.hypot(dx, dy, dz) > PATH_JUMP) return;
  const f = rate(dt, HALF_LIFE_VEL);
  s.vel.x += (dx / dt - s.vel.x) * f;
  s.vel.y += (dy / dt - s.vel.y) * f;
  s.vel.z += (dz / dt - s.vel.z) * f;
}

/**
 * One frame of posture. Target = identity (upright) blended toward the rotation
 * of model +y onto the travel direction by smoothstep(vSlow, vSwim, speed), with
 * a bank about the bell axis; the orientation eases there by a damped slerp
 * (half-life 0.3 s into a swim or turn, 1 s back to upright). The slerp always
 * takes the short arc (the target's sign is matched to the current hemisphere),
 * so a 180 degree reversal turns through at most the damped step per frame
 * instead of flipping. dt = 0 just re-emits the current orientation.
 */
export function stepPosture(s: PostureState, vel: Vec3, dt: number, out: Quat): Quat {
  const q = s.q;
  if (dt > 0) {
    dt = Math.min(dt, 0.1);
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const want = smoothstep(POSTURE_V_SLOW, POSTURE_V_SWIM, speed);
    let bankWant = 0;
    if (want > 0) {
      const inv = 1 / speed;
      const nx = vel.x * inv, ny = vel.y * inv, nz = vel.z * inv;
      // Signed yaw rate about world up: y component of prevDir x newDir.
      const yaw = (s.dir.z * nx - s.dir.x * nz) / dt;
      bankWant = Math.max(-BANK_MAX, Math.min(BANK_MAX, -yaw * BANK_GAIN)) * want;
      s.dir.x = nx; s.dir.y = ny; s.dir.z = nz;
    }
    const k = rate(dt, want < s.swim ? HALF_LIFE_UPRIGHT : HALF_LIFE_TURN);
    s.swim += (want - s.swim) * k;
    s.bank += (bankWant - s.bank) * rate(dt, HALF_LIFE_TURN);

    // Rotation of +y onto dir: axis = y x dir = (dz, 0, -dx), w = 1 + dy (the
    // half-angle form, normalised). dir ~ -y has no unique axis: roll about x.
    const d = s.dir;
    let sx = d.z, sz = -d.x, sw = 1 + d.y;
    const sl = Math.hypot(sx, sz, sw);
    if (sl < 1e-6) { sx = 1; sz = 0; sw = 0; } else { sx /= sl; sz /= sl; sw /= sl; }
    // Blend from identity by `want`; sw >= 0 so this is the short way round.
    let tx = sx * want, tz = sz * want, tw = 1 - want + sw * want;
    const tl = Math.hypot(tx, tz, tw);
    tx /= tl; tz /= tl; tw /= tl;
    // Bank: post-multiply by a roll about the local y (bell) axis; ty was 0.
    const sb = Math.sin(s.bank * 0.5), cb = Math.cos(s.bank * 0.5);
    let ty = tw * sb;
    const bx = tx * cb - tz * sb, bz = tx * sb + tz * cb, bw = tw * cb;
    tx = bx; tz = bz; tw = bw;

    // Damped slerp q -> target, short arc.
    let dot = q.x * tx + q.y * ty + q.z * tz + q.w * tw;
    if (dot < 0) { dot = -dot; tx = -tx; ty = -ty; tz = -tz; tw = -tw; }
    let a: number, b: number;
    if (dot > 0.9995) { a = 1 - k; b = k; }
    else {
      const th = Math.acos(dot), sn = Math.sin(th);
      a = Math.sin((1 - k) * th) / sn; b = Math.sin(k * th) / sn;
    }
    q.x = q.x * a + tx * b; q.y = q.y * a + ty * b; q.z = q.z * a + tz * b; q.w = q.w * a + tw * b;
    const ql = Math.hypot(q.x, q.y, q.z, q.w);
    q.x /= ql; q.y /= ql; q.z /= ql; q.w /= ql;
  }
  out.x = q.x; out.y = q.y; out.z = q.z; out.w = q.w;
  return out;
}
