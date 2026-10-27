/**
 * The Nest's screen-space HUD state (spec 2026-10-27-nest-playable §3–4):
 * where the lock reticle, the HIT marker and the edge arrows go, in CSS
 * pixels. NestDirector writes it each frame from the camera's matrices
 * (updateNestScreen) and NestOverlay's rAF loop reads it, like
 * waypointState: never React state, so the HUD costs no renders.
 *
 * Pure and allocation-free: projections write into scratch built once, and
 * the arrows into fixed typed arrays (tests/nestScreen.test.ts).
 */
import { BOLT_R, SAUCER_HIT_R, TARDIGRADE_HIT_R } from "./constants";
import { HIT_MARK_S } from "./nestHud";
import type { NestState } from "./nest";

/** At most this many edge arrows. */
export const MAX_EDGE_ARROWS = 8;
/** The arrows sit on a rectangle this far in from the window's edge (px). */
export const EDGE_INSET_PX = 28;

/** A point in normalised device coordinates; `behind` when it is behind the camera. */
export interface Ndc { nx: number; ny: number; behind: boolean }
/** An edge arrow's place (CSS px, y down) and direction (radians, 0 pointing right, π/2 down). */
export interface EdgeSpot { x: number; y: number; angle: number }

export interface NestScreen {
  lock: { on: boolean; x: number; y: number };
  hit: { on: boolean; x: number; y: number };
  /** The time (performance.now() / 1000) of the latest strike seen. */
  hitAt: number;
  /** The `strikeSeq` last seen. */
  seenSeq: number;
  /** The latest strike landed on the locked monster, locked since the frame before: HIT rides the reticle. */
  hitOnLock: boolean;
  /** `n.lock` at the last update (a kill moves the lock on in the strike's own step). */
  prevLock: number;
  arrows: { count: number; x: Float32Array; y: Float32Array; angle: Float32Array };
}

export function createNestScreen(): NestScreen {
  return {
    lock: { on: false, x: 0, y: 0 },
    hit: { on: false, x: 0, y: 0 },
    hitAt: -Infinity,
    seenSeq: 0,
    hitOnLock: false,
    prevLock: -1,
    arrows: {
      count: 0,
      x: new Float32Array(MAX_EDGE_ARROWS), y: new Float32Array(MAX_EDGE_ARROWS),
      angle: new Float32Array(MAX_EDGE_ARROWS),
    },
  };
}

/** The shared screen state: NestDirector writes it, NestOverlay reads it. */
export const nestScreen: NestScreen = createNestScreen();

/**
 * World (x, y, z) through the view and projection matrices (three.js
 * `elements`, column-major) to NDC. Behind the camera (clip w ≤ 1e-9) it is
 * marked `behind`, and nx, ny are −clip / |w| (w floored at 1e-9): mirrored
 * the way a perspective divide mirrors it, so edgeArrow's flip gives the
 * true side, and finite at w = 0.
 */
export function projectNdc(
  view: ArrayLike<number>, proj: ArrayLike<number>, x: number, y: number, z: number, out: Ndc,
): Ndc {
  const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
  const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
  const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
  const vw = view[3] * x + view[7] * y + view[11] * z + view[15];
  const cx = proj[0] * vx + proj[4] * vy + proj[8] * vz + proj[12] * vw;
  const cy = proj[1] * vx + proj[5] * vy + proj[9] * vz + proj[13] * vw;
  const cw = proj[3] * vx + proj[7] * vy + proj[11] * vz + proj[15] * vw;
  if (cw <= 1e-9) {
    const w = Math.max(Math.abs(cw), 1e-9);
    out.nx = -cx / w; out.ny = -cy / w; out.behind = true;
  } else {
    out.nx = cx / cw; out.ny = cy / cw; out.behind = false;
  }
  return out;
}

/**
 * Where an off-screen point's arrow sits: from the screen centre toward the
 * point (flipped when behind the camera, so it points the way to turn),
 * measured in pixels so it points true on a wide window, scaled onto the
 * rectangle EDGE_INSET_PX inside the window, pointing outward. Dead behind
 * (no direction) points down.
 */
export function edgeArrow(nx: number, ny: number, behind: boolean, width: number, height: number, out: EdgeSpot): EdgeSpot {
  if (behind) { nx = -nx; ny = -ny; }
  let dx = nx * width * 0.5, dy = -ny * height * 0.5;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) { dx = 0; dy = 1; }
  const hw = Math.max(0, width * 0.5 - EDGE_INSET_PX), hh = Math.max(0, height * 0.5 - EDGE_INSET_PX);
  const kx = Math.abs(dx) > 1e-12 ? hw / Math.abs(dx) : Infinity;
  const ky = Math.abs(dy) > 1e-12 ? hh / Math.abs(dy) : Infinity;
  const k = Math.min(kx, ky);
  out.x = width * 0.5 + dx * k;
  out.y = height * 0.5 + dy * k;
  out.angle = Math.atan2(dy, dx);
  return out;
}

// ── Scratch (built once) ───────────────────────────────────────────────────
const _ndc: Ndc = { nx: 0, ny: 0, behind: false };
const _spot: EdgeSpot = { x: 0, y: 0, angle: 0 };

const onScreen = (p: Ndc) => !p.behind && Math.abs(p.nx) <= 1 && Math.abs(p.ny) <= 1;
const pxX = (nx: number, width: number) => (nx * 0.5 + 0.5) * width;
const pxY = (ny: number, height: number) => (-ny * 0.5 + 0.5) * height;

/**
 * Whether the screen state has anything to do this frame: while `fighting`
 * or in the `gap` (the arrows), or with a lock, an unseen strike or a HIT
 * showing (the last kill's HIT outlives the fight into `rest`). Outside it
 * updateNestScreen projects nothing, and NestDirector skips the camera
 * matrix update: one predicate for both, so they cannot drift.
 */
export function nestScreenActive(n: NestState, out: NestScreen): boolean {
  return n.phase === "fighting" || n.phase === "gap" || n.lock >= 0 || n.strikeSeq !== out.seenSeq || out.hit.on;
}

/** The strike sits on target k's hit sphere (with the bolt's radius and a little slack). */
function strikeOn(n: NestState, k: number, sx: number, sy: number, sz: number): boolean {
  const t = n.targets[k];
  const r = (k < n.saucers.length ? SAUCER_HIT_R : TARDIGRADE_HIT_R) + BOLT_R + 0.5;
  return Math.hypot(sx - t.x, sy - t.y, sz - t.z) <= r;
}

/**
 * One frame of the screen state, written into `out` (returned):
 * - the arrows: only while `fighting` or in the `gap`, one per alive monster
 *   (never a sleeper: `alive` is false) that is behind or past the screen's
 *   edge, at most MAX_EDGE_ARROWS;
 * - the lock: on while `n.lock` names an alive monster that projects on screen;
 * - HIT: a new `strikeSeq` stamps `hitAt = now`; it shows for HIT_MARK_S, at
 *   the lock's pixel when the strike landed on the locked monster (and the
 *   lock did not change on that strike, as a kill moves it on) and the
 *   reticle is on, else at the latest strike's projection when that is on
 *   screen (ruling N7).
 * Inactive (nestScreenActive false) it shows nothing and projects nothing.
 */
export function updateNestScreen(
  n: NestState, view: ArrayLike<number>, proj: ArrayLike<number>, width: number, height: number, now: number,
  out: NestScreen,
): NestScreen {
  const a = out.arrows;
  a.count = 0;
  if (!nestScreenActive(n, out)) {
    out.lock.on = false;
    out.hit.on = false;
    out.prevLock = n.lock;
    return out;
  }
  const fight = n.phase === "fighting" || n.phase === "gap";
  if (fight) {
    const targets = n.targets;
    for (let i = 0; i < targets.length && a.count < MAX_EDGE_ARROWS; i++) {
      const t = targets[i];
      if (!t.alive) continue;
      projectNdc(view, proj, t.x, t.y, t.z, _ndc);
      if (onScreen(_ndc)) continue;
      edgeArrow(_ndc.nx, _ndc.ny, _ndc.behind, width, height, _spot);
      a.x[a.count] = _spot.x; a.y[a.count] = _spot.y; a.angle[a.count] = _spot.angle;
      a.count++;
    }
  }

  const lock = out.lock;
  lock.on = false;
  if (n.lock >= 0 && n.lock < n.targets.length) {
    const t = n.targets[n.lock];
    if (t.alive && onScreen(projectNdc(view, proj, t.x, t.y, t.z, _ndc))) {
      lock.on = true;
      lock.x = pxX(_ndc.nx, width);
      lock.y = pxY(_ndc.ny, height);
    }
  }

  if (n.strikeSeq !== out.seenSeq) {
    out.seenSeq = n.strikeSeq;
    out.hitAt = n.strikeSeq > 0 ? now : -Infinity;
    const s = n.strikes[(n.strikeSeq - 1 + n.strikes.length) % n.strikes.length];
    out.hitOnLock = n.strikeSeq > 0 && n.lock >= 0 && n.lock === out.prevLock && strikeOn(n, n.lock, s.x, s.y, s.z);
  }
  // The lock moved on mid-HIT: the marker stays at the strike, not on the new target.
  if (n.lock !== out.prevLock) out.hitOnLock = false;
  out.prevLock = n.lock;
  const hit = out.hit;
  const age = now - out.hitAt;
  hit.on = false;
  if (age >= 0 && age < HIT_MARK_S - 1e-9) {
    if (out.hitOnLock && lock.on) {
      hit.on = true; hit.x = lock.x; hit.y = lock.y;
    } else {
      const s = n.strikes[(out.seenSeq - 1) % n.strikes.length];
      if (onScreen(projectNdc(view, proj, s.x, s.y, s.z, _ndc))) {
        hit.on = true;
        hit.x = pxX(_ndc.nx, width);
        hit.y = pxY(_ndc.ny, height);
      }
    }
  }
  return out;
}
