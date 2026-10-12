/**
 * Schedules world events (docs/superpowers/specs/2026-10-12-world-events-design.md):
 * the first at 45s of flying time, then one every 60–120s after the previous
 * ends, never the same kind twice running. Pure, with an injected RNG so the
 * sequence is testable. Its clock is flying time: it only advances on
 * unpaused steps, so an event caught by an orbit lock or photo mode resumes
 * where it was.
 */

export type WorldEventKind = "comet" | "flare" | "convoy";
export const WORLD_EVENT_KINDS: readonly WorldEventKind[] = ["comet", "flare", "convoy"];
export const FIRST_EVENT_AT = 45;
export const GAP_MIN = 60;
export const GAP_SPAN = 60;
export const EVENT_DURATION: Record<WorldEventKind, number> = { comet: 25, flare: 12, convoy: 40 };
/** A skipped event (no clear route) retries this soon, as another kind, instead of a full gap. */
export const SKIP_RETRY_S = 5;

export interface ActiveEvent { kind: WorldEventKind; id: number; startedAt: number; endsAt: number }
export interface DirectorState {
  clock: number;
  nextAt: number;
  active: ActiveEvent | null;
  lastKind: WorldEventKind | null;
  nextId: number;
  random: () => number;
}
export interface DirectorInput { dt: number; paused: boolean; raceRunning: boolean; radioBusy: boolean; reducedMotion: boolean }
export interface DirectorStep { started: ActiveEvent | null; ended: ActiveEvent | null }

export function createDirector(random: () => number = Math.random): DirectorState {
  return { clock: 0, nextAt: FIRST_EVENT_AT, active: null, lastKind: null, nextId: 1, random };
}

function pickKind(s: DirectorState): WorldEventKind {
  const options = WORLD_EVENT_KINDS.filter((k) => k !== s.lastKind);
  return options[Math.min(options.length - 1, Math.floor(s.random() * options.length))];
}

function begin(s: DirectorState, kind: WorldEventKind): ActiveEvent {
  const ev = { kind, id: s.nextId++, startedAt: s.clock, endsAt: s.clock + EVENT_DURATION[kind] };
  s.active = ev;
  s.lastKind = kind;
  return ev;
}

/** Ends the active event (if any) and schedules the next start from now. */
export function endEvent(s: DirectorState): ActiveEvent | null {
  const ev = s.active;
  if (!ev) return null;
  s.active = null;
  s.nextAt = s.clock + GAP_MIN + s.random() * GAP_SPAN;
  return ev;
}

/**
 * One frame. Paused: nothing moves. Otherwise the clock advances, an active
 * event ends on time, and a due start fires unless reduced motion is on or a
 * race / busy radio holds it (held, not skipped: it fires once clear).
 */
export function stepDirector(s: DirectorState, inp: DirectorInput): DirectorStep {
  const out: DirectorStep = { started: null, ended: null };
  if (inp.paused) return out;
  s.clock += inp.dt;
  if (s.active) {
    if (s.clock >= s.active.endsAt) out.ended = endEvent(s);
    return out;
  }
  if (inp.reducedMotion || inp.raceRunning || inp.radioBusy) return out;
  if (s.clock >= s.nextAt) out.started = begin(s, pickKind(s));
  return out;
}

/**
 * Abandons the active event without it having played (no clear route for it):
 * the next start comes after SKIP_RETRY_S rather than a full 60–120s gap, and,
 * since `lastKind` is kept, as a different kind. A pilot parked near a planet,
 * where comet lines are often blocked, still gets a heartbeat.
 */
export function skipEvent(s: DirectorState): void {
  s.active = null;
  s.nextAt = s.clock + SKIP_RETRY_S;
}

/**
 * The director's step from the planets' clock: the full ambient-time gap since
 * the last frame, never negative. Event lines and convoy routes are cleared
 * against planet positions on ambient time, so the event must play on that
 * same clock, not a frame-capped dt that drifts on slow frames or a resumed tab.
 */
export function ambientStep(prev: number | null, now: number): number {
  return prev === null ? 0 : Math.max(0, now - prev);
}

/** Dev trigger: ends whatever is running, then starts `kind` now. */
export function forceStart(s: DirectorState, kind: WorldEventKind): DirectorStep {
  const ended = endEvent(s);
  return { started: begin(s, kind), ended };
}
