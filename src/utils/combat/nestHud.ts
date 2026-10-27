/**
 * The Nest's HUD rules (spec 2026-10-27-combat "HUD"), pure so they are
 * unit-tested (tests/nestHud.test.ts): the zone-edge haze, the hull-hit
 * flash, the banners, the hull row, the wave line and the radar marker's
 * range and spot. The DOM layers (layout/NestOverlay.tsx, layout/HUDOverlay.tsx,
 * layout/RadarMap.tsx) call these from their rAF loops, so nothing here
 * allocates on a frame: the banner writes into a caller's object and its
 * strings are built once.
 */
import { CONTACT_DELAY_S, HULL_MAX, NEST_HAZE_BAND, NEST_ZONE_R, WAVES } from "./constants";
import { RADAR_RANGE } from "../radarTransform";
import type { NestPhase } from "./nest";

/** The haze's opacity right at the zone edge. */
export const NEST_HAZE_MAX = 0.35;
/** How long a hull-hit flash lasts (s). */
export const FLASH_S = 0.35;
/** The flash's peak, and its steady tint under reduced motion. */
const FLASH_PEAK = 0.55;
const FLASH_STATIC = 0.3;
/** HULL BREACH and NEST CLEARED hold this long (s). */
export const EVENT_BANNER_S = 3;
/** ENTERING THE NEST alone (no countdown under it) holds this long (s). */
export const ENTER_BANNER_S = 2;
/** The hull bar turns red below this percentage. */
export const HULL_LOW_PCT = 30;

export const NEST_ENTER_TITLE = "ENTERING THE NEST";
export const NEST_CLEARED_TITLE = "NEST CLEARED";
export const NEST_BREACH_TITLE = "HULL BREACH";
/** Waiting on the warm-up (the programs are compiling). */
export const CONTACT_WAIT = "CONTACT IN …";
/** The on-demand models failed to load: the Nest stays harmless (Ruling C22). */
export const NEST_OFFLINE_LINE = "NEST OFFLINE · MODELS DIDN'T LOAD";
/** `CONTACT IN n…` for n = 0..CONTACT_DELAY_S, built once (index n). */
const CONTACT_IN: readonly string[] = Array.from({ length: Math.ceil(CONTACT_DELAY_S) + 1 }, (_, n) => `CONTACT IN ${n}…`);

/** Smoothstep on [0, 1]. */
function smooth01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}

/**
 * The red edge haze's opacity at `dist` from the centre: NEST_HAZE_MAX right
 * on the 70 u zone edge, easing to 0 at NEST_HAZE_BAND (30 u) either side, so
 * it is drawn only within 30 u of the edge (the haze's whole presence outside
 * the fighting area).
 */
export function nestHazeOpacity(dist: number): number {
  const x = 1 - Math.abs(dist - NEST_ZONE_R) / NEST_HAZE_BAND;
  return x <= 0 ? 0 : NEST_HAZE_MAX * smooth01(x);
}

/**
 * The hull-hit flash: FLASH_PEAK fading to 0 over FLASH_S after a hit, or a
 * steady tint for FLASH_S under reduced motion (no fade). 0 outside it.
 */
export function flashOpacity(now: number, flashAt: number, reduced: boolean): number {
  const age = now - flashAt;
  if (!(age >= 0 && age < FLASH_S)) return 0;
  return reduced ? FLASH_STATIC : FLASH_PEAK * (1 - age / FLASH_S);
}

/** How long the HIT marker shows after a strike (s). */
export const HIT_MARK_S = 0.25;

/**
 * The HIT marker's opacity: 1 fading to 0 over HIT_MARK_S after a strike, or
 * a static 1 for HIT_MARK_S under reduced motion (no fade). 0 outside it. A
 * hair of slack at the end, so `hitAt + 0.25` reads as over whatever the
 * float rounding of `now − hitAt`.
 */
export function hitMarkOpacity(now: number, hitAt: number, reduced: boolean): number {
  const age = now - hitAt;
  if (!(age >= 0 && age < HIT_MARK_S - 1e-9)) return 0;
  return reduced ? 1 : 1 - age / HIT_MARK_S;
}

export interface NestBannerText { title: string; sub: string }

/** The `combat` stamps a banner reads (store/combatState.ts). Times in performance.now() / 1000. */
export interface NestBannerStamps {
  enteredAt: number; clearedAt: number; breachAt: number;
  /** The on-demand models failed to load (C22). */
  loadFailed?: boolean;
}

const within = (now: number, at: number, s: number) => now - at >= 0 && now - at < s;

/**
 * The centre banner, in priority order: HULL BREACH (3 s) > NEST CLEARED
 * (3 s) > the countdown (ENTERING THE NEST over `CONTACT IN n…`, n = ceil(3
 * − phaseT) while positive, then `CONTACT IN …` until warm; or the offline
 * line when the models failed to load) > ENTERING THE NEST alone (2 s after
 * a crossing that started no countdown) > null. Written into `out` when given
 * (the overlay's loop), else a new object.
 */
export function nestBanner(
  now: number, c: NestBannerStamps, phase: NestPhase, phaseT: number, _warm: boolean,
  out: NestBannerText = { title: "", sub: "" },
): NestBannerText | null {
  if (within(now, c.breachAt, EVENT_BANNER_S)) { out.title = NEST_BREACH_TITLE; out.sub = ""; return out; }
  if (within(now, c.clearedAt, EVENT_BANNER_S)) { out.title = NEST_CLEARED_TITLE; out.sub = ""; return out; }
  if (phase === "countdown") {
    out.title = NEST_ENTER_TITLE;
    if (c.loadFailed) { out.sub = NEST_OFFLINE_LINE; return out; }
    const n = Math.ceil(CONTACT_DELAY_S - phaseT - 1e-9);
    // Past 3 s the countdown is waiting on the warm-up: `warm` only decides
    // when stepNest starts wave 1 (and leaves the countdown), so the line
    // reads the same either way until then.
    out.sub = n > 0 ? CONTACT_IN[Math.min(n, CONTACT_IN.length - 1)] : CONTACT_WAIT;
    return out;
  }
  if (within(now, c.enteredAt, ENTER_BANNER_S)) { out.title = NEST_ENTER_TITLE; out.sub = ""; return out; }
  return null;
}

/** `HULL: 94%`. */
export function hullLabel(hp: number): string {
  return `HULL: ${Math.round((Math.max(0, hp) / HULL_MAX) * 100)}%`;
}

/** The hull row shows in the fighting area, or anywhere while the hull is below full. */
export function hullShown(inArea: boolean, hp: number): boolean {
  return inArea || hp < HULL_MAX;
}

/** The hull bar's colour: the HUD green, red below HULL_LOW_PCT. */
export function hullBarColor(hp: number): string {
  return (hp / HULL_MAX) * 100 < HULL_LOW_PCT ? "#ef4444" : "#00ff87";
}

/** `WAVE 2/3 · CONTACTS 4`; empty with no fight (wave 0). */
export function waveReadout(wave: number, contacts: number): string {
  return wave > 0 ? `WAVE ${wave}/${WAVES.length} · CONTACTS ${contacts}` : "";
}

/** The Nest is in radar range within RADAR_RANGE of the centre (a 3D distance). */
export function nestRadarShown(dx: number, dy: number, dz: number): boolean {
  return Math.hypot(dx, dy, dz) <= RADAR_RANGE;
}

export interface RadarSpot { px: number; py: number; onRim: boolean }

/**
 * Where the radar draws the Nest (offsets from the radar's centre, px), from
 * the ship-to-centre delta. In range (nestRadarShown, 3D) it is scaled as
 * any blip, unclamped. Beyond, it sits on the rim (rimR − 3, where live
 * pilots' rim markers sit) along its horizontal direction, even when the
 * horizontal distance alone is inside the rim; straight above or below it
 * sits at the centre. Matches worldToRadar's axes (tests/nestHud.test.ts).
 * Written into `out` (the radar's scratch), no allocation.
 */
export function nestRadarSpot(
  dx: number, dy: number, dz: number, heading: number, scale: number, rimR: number, out: RadarSpot,
): RadarSpot {
  // worldToRadar inlined: no object on a frame.
  const cosA = Math.cos(heading), sinA = Math.sin(heading);
  const sx = dz * sinA - dx * cosA, up = dx * sinA + dz * cosA;
  if (nestRadarShown(dx, dy, dz)) {
    out.px = sx * scale;
    out.py = -up * scale;
    out.onRim = false;
    return out;
  }
  const h = Math.hypot(sx, up);
  out.onRim = true;
  if (h < 1e-6) { out.px = 0; out.py = 0; return out; }
  const k = (rimR - 3) / h;
  out.px = sx * k;
  out.py = -up * k;
  return out;
}

/**
 * The on-demand models (or the renderer's chunk) failed to load (NestGate's
 * error boundary): latch it for the HUD and keep the warm gate shut, so no
 * wave ever starts and the Nest stays harmless (Ruling C22).
 */
export function markNestLoadFailed(c: { warm: boolean; loadFailed: boolean }): void {
  c.loadFailed = true;
  c.warm = false;
}
