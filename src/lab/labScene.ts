import * as THREE from "three";
import { AU } from "../constants";
import { JPL_PLANETS } from "../data/jplElements";
import { mulberry32 } from "../utils/mulberry32";
import type { SaucerPose } from "../utils/monsters/saucerMaterial";
import type { TardigradePose } from "../utils/monsters/tardigradeMaterial";
import { clamp01, wrap01 } from "../utils/monsters/monsterInstances";

/**
 * The monster lab's scene (dev only; space monsters Task 6): its settings,
 * the layouts and the timed poses. Pure, so the e2e probe and a unit test can
 * reason about it without a renderer.
 */

export const LAB_PRESETS = ["near", "far"] as const;
export const LAB_LAYOUTS = ["fight", "spread", "overlap"] as const;
export const LAB_STATES = ["idle", "look", "fire", "chase", "hit", "defeat", "swim", "charge", "recoil", "curl"] as const;
export const LAB_LODS = ["0", "1", "auto"] as const;

/** Camera: the layout's own, or a close hero shot of one monster (solo, ship hidden, eyes on the camera). */
export const LAB_CAMS = ["default", "hero-saucer", "hero-tardigrade"] as const;
export type LabCam = (typeof LAB_CAMS)[number];

export type LabPreset = (typeof LAB_PRESETS)[number];
export type LabLayout = (typeof LAB_LAYOUTS)[number];
export type LabState = (typeof LAB_STATES)[number];
export type LabLod = (typeof LAB_LODS)[number];

export interface LabSettings {
  preset: LabPreset;
  layout: LabLayout;
  state: LabState;
  lod: LabLod;
  seed: number;
  cam: LabCam;
  reducedMotion: boolean;
  /** Cycle through every state, CYCLE_SECONDS each (the default for a first look). */
  cycle: boolean;
}

/** How long auto-cycle holds each state. */
export const CYCLE_SECONDS = 6;

/**
 * Where the fight sits from the sun (u): near is Earth's distance (1 AU),
 * far is Neptune's (≈ 30 AU), where the inverse-square sunlight is ~900×
 * weaker and the exposure law (sunLight.ts) makes it up.
 */
export const PRESET_DISTANCE: Record<LabPreset, number> = {
  near: JPL_PLANETS.earth.a[0] * AU,
  far: JPL_PLANETS.neptune.a[0] * AU,
};

/** The fight's centre: on +X from the sun, so the sunlight falls along +X. */
export function clusterCentre(preset: LabPreset, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(PRESET_DISTANCE[preset], 0, 0);
}

const pick = <T extends string>(list: readonly T[], v: string | null, fallback: T): T =>
  (list as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

/** The settings from the page's query (every control is settable there); unknown values fall back to the defaults. */
export function parseLabQuery(search: string, prefersReducedMotion = false): LabSettings {
  const q = new URLSearchParams(search);
  const seed = Number(q.get("seed"));
  const rm = q.get("rm");
  const cycle = q.get("cycle");
  return {
    preset: pick(LAB_PRESETS, q.get("preset"), "near"),
    layout: pick(LAB_LAYOUTS, q.get("layout"), "fight"),
    state: pick(LAB_STATES, q.get("state"), "idle"),
    lod: pick(LAB_LODS, q.get("lod"), "auto"),
    seed: Number.isFinite(seed) && q.has("seed") ? Math.floor(seed) : 1,
    cam: pick(LAB_CAMS, q.get("cam"), "default"),
    reducedMotion: rm === null ? prefersReducedMotion : rm === "1" || rm === "true",
    // A first look cycles; naming a state (or cycle=0) holds it.
    cycle: cycle === null ? !q.has("state") : cycle === "1" || cycle === "true",
  };
}

/** The query for `s` (the page keeps its URL in step, so a view can be shared). */
export function labQuery(s: LabSettings): string {
  return new URLSearchParams({
    preset: s.preset, layout: s.layout, state: s.state, lod: s.lod, seed: String(s.seed), cam: s.cam,
    rm: s.reducedMotion ? "1" : "0", cycle: s.cycle ? "1" : "0",
  }).toString();
}

// -------------------------------------------------------------- layouts ---

export type MonsterKind = "saucer" | "tardigrade";

export interface Placement {
  kind: MonsterKind;
  /** Position from the cluster centre (the ship stand-in). */
  position: THREE.Vector3;
  /** Model +Z (the rest gaze, the barrel, the tardigrade's mouth) faces this point. */
  facing: THREE.Vector3;
  /** A roll about the facing axis (rad), for variety. */
  roll: number;
}

export interface LabFraming {
  /** Camera position and orbit target, from the cluster centre. */
  camera: THREE.Vector3;
  target: THREE.Vector3;
  /** Whether the ship stand-in sits at the centre. */
  ship: boolean;
}

/** `spread`: eight monsters 200 u apart, round a ring of this radius (adjacent chord 200 u). */
export const SPREAD_SPACING = 200;
export const SPREAD_RADIUS = SPREAD_SPACING / (2 * Math.sin(Math.PI / 8));

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ORIGIN = v(0, 0, 0);

/**
 * The monsters of a layout:
 *  - fight: six saucers round the ship stand-in at 7.5–9 u and staggered
 *    heights, on a 235° arc that leaves the chase camera's sector behind the
 *    ship clear, two tardigrades farther out ahead, all facing the ship;
 *  - spread: the same eight round a ring SPREAD_SPACING apart, in the plane
 *    square to the sunlight (so each is the same distance from the sun),
 *    facing the centre;
 *  - overlap: two saucers, one behind and above the other, so one dome is
 *    seen through the other (the domes are blended without a sort).
 */
export function layoutPlacements(layout: LabLayout): Placement[] {
  if (layout === "overlap") {
    const toward = v(0.6, 1.2, 8);
    return [
      { kind: "saucer", position: v(0, 0, 0), facing: toward, roll: 0 },
      { kind: "saucer", position: v(0.9, 0.55, -2.4), facing: toward.clone().add(v(0.9, 0.55, -2.4)), roll: 0 },
    ];
  }
  if (layout === "spread") {
    const kinds: MonsterKind[] = ["saucer", "saucer", "tardigrade", "saucer", "saucer", "saucer", "tardigrade", "saucer"];
    return kinds.map((kind, i) => {
      const a = (i / kinds.length) * Math.PI * 2;
      return { kind, position: v(0, SPREAD_RADIUS * Math.sin(a), SPREAD_RADIUS * Math.cos(a)), facing: ORIGIN.clone(), roll: 0 };
    });
  }
  const heights = [1.8, -1.2, 0.6, 2.4, -2.0, 0.2];
  const saucers: Placement[] = heights.map((y, i) => {
    const a = THREE.MathUtils.degToRad(68 + i * 45);
    const r = 7.5 + (i % 2) * 1.5;
    return { kind: "saucer", position: v(r * Math.sin(a), y, r * Math.cos(a)), facing: v(0, y * 0.4, 0), roll: 0 };
  });
  return [
    ...saucers,
    { kind: "tardigrade", position: v(-8.5, -2.5, -9), facing: v(0, -0.5, 0), roll: 0.25 },
    { kind: "tardigrade", position: v(10, 2.5, -7), facing: v(0, 0.5, 0), roll: -0.3 },
  ];
}

/** The monster a hero camera shows (null for the default camera). */
export function heroKind(cam: LabCam): MonsterKind | null {
  return cam === "hero-saucer" ? "saucer" : cam === "hero-tardigrade" ? "tardigrade" : null;
}

/** Where a hero camera stands and looks, in the monster's own frame (+Z is its gaze), and the layout it needs. */
const HERO = {
  saucer: { eye: [1.25, 0.8, 3.3], at: [0, 0.2, 0.2] },
  tardigrade: { eye: [-3.4, 1.3, 6.2], at: [0, -0.3, 0.6] },
} as const;

/**
 * The default camera for a layout, the sun kept out of frame where the layout allows;
 * or, with a hero cam, a close three-quarter view of the first monster of that kind
 * in the fight (the ship stand-in hidden, so its eyes follow the camera).
 */
export function layoutFraming(layout: LabLayout, cam: LabCam = "default"): LabFraming {
  const kind = heroKind(cam);
  if (kind) {
    const p = layoutPlacements("fight").find((q) => q.kind === kind)!;
    const m = placementMatrix(p);
    const h = HERO[kind];
    return { camera: new THREE.Vector3().fromArray(h.eye).applyMatrix4(m), target: new THREE.Vector3().fromArray(h.at).applyMatrix4(m), ship: false };
  }
  if (layout === "overlap") return { camera: v(1.2, 1.6, 7.5), target: v(0.3, 0.2, -1), ship: false };
  // From the sun's side, so the ring is lit; at 1 AU the sun sits inside the ring's span.
  if (layout === "spread") return { camera: v(-700, 160, 140), target: ORIGIN.clone(), ship: true };
  // The player's seat: a chase camera behind and above the ship (the saucers face it),
  // framed a little left of centre so the panel (top left) hides none of the fight.
  return { camera: v(0.4, 4, 11), target: v(-2.2, 0, -3.5), ship: true };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _up = v(0, 1, 0);
const _z = v(0, 0, 1);

/**
 * A placement's model matrix (from the cluster centre): upright, model +Z
 * toward `facing`, then rolled. Matrix4.lookAt points −Z at the target, so
 * it is given the target behind.
 */
export function placementMatrix(p: Placement, out = new THREE.Matrix4()): THREE.Matrix4 {
  const back = p.position.clone().multiplyScalar(2).sub(p.facing);
  _m.lookAt(p.position, back, _up);
  _q.setFromRotationMatrix(_m);
  _q.multiply(_roll.setFromAxisAngle(_z, p.roll));
  return out.compose(p.position, _q, _ONE);
}
const _ONE = v(1, 1, 1);

// ---------------------------------------------------------------- poses ---

/** A short decaying pulse every `period` seconds: up in `rise`, down over `fall`. */
function pulse(t: number, period: number, rise: number, fall: number, offset = 0): number {
  const u = (((t + offset) % period) + period) % period;
  if (u < rise) return u / rise;
  return Math.exp(-(u - rise) / fall);
}

/** Up over `up`, held for `hold`, down over `down`, repeating. */
function swell(t: number, up: number, hold: number, down: number, rest: number): number {
  const period = up + hold + down + rest;
  const u = ((t % period) + period) % period;
  if (u < up) return smooth(u / up);
  if (u < up + hold) return 1;
  if (u < up + hold + down) return 1 - smooth((u - up - hold) / down);
  return 0;
}
const smooth = (x: number) => { const c = clamp01(x); return c * c * (3 - 2 * c); };

/** A blink's closure at `t`: a 0.18 s half-sine every 3–5 s, the period and offset per saucer. */
function blinkAt(t: number, phase: number): number {
  const period = 3 + 2 * phase;
  const u = (((t + phase * 5) % period) + period) % period;
  return u < BLINK_SECONDS ? Math.sin((Math.PI * u) / BLINK_SECONDS) : 0;
}
const BLINK_SECONDS = 0.18;

/** Per-monster randomness from the seed: phases and blink timing. */
export function monsterPhases(seed: number, n: number): number[] {
  const rnd = mulberry32(Math.floor(seed) * 7919 + 17);
  return Array.from({ length: n }, () => rnd());
}

/**
 * A saucer's pose for `state`, `t` seconds after it began. Directions are in
 * the saucer's model space: `toTarget` toward what it looks at (the camera
 * for `look`, the ship otherwise) and `toShip` toward the ship (its aim).
 * Under reduced motion every pose is held at full strength and nothing is
 * timed (R20): no blink, no pulsing fire or hit, the chase held still.
 */
export function saucerLabPose(state: LabState, t: number, phase: number, reduced: boolean,
  toTarget: THREE.Vector3, toShip: THREE.Vector3, out: SaucerPose): SaucerPose {
  out.phase = phase;
  out.look.copy(state === "look" ? toTarget : toShip);
  out.aim.set(0, 0, 1);
  out.chase = -1;
  out.fire = 0;
  out.hit = 0;
  out.defeat = 0;
  // Idle blinks (a state pose, so only while motion is on, R20): 0.18 s every 3–5 s.
  out.blink = reduced ? 0 : blinkAt(t, phase);
  if (state === "fire") {
    out.aim.copy(toShip);
    out.fire = reduced ? 1 : pulse(t, 1.6, 0.08, 0.35, phase * 1.6);
  } else if (state === "chase") {
    out.chase = reduced ? phase : wrap01(t * 0.9 + phase);
  } else if (state === "hit") {
    out.hit = reduced ? 1 : pulse(t, 1.4, 0.05, 0.22, phase * 1.4);
  } else if (state === "defeat") {
    out.defeat = reduced ? 1 : smooth(t / 0.8);
    out.blink = 0;
  }
  return out;
}

/**
 * A tardigrade's pose for `state`, `t` seconds after it began; the saucers'
 * defeat curls it too (a beaten tardigrade balls up). Held at full strength
 * under reduced motion, as the saucer's.
 */
export function tardigradeLabPose(state: LabState, t: number, phase: number, reduced: boolean, out: TardigradePose): TardigradePose {
  out.phase = phase;
  out.swim = state === "swim" ? 1 : 0;
  out.charge = 0;
  out.recoil = 0;
  out.hit = 0;
  out.curl = 0;
  if (state === "charge") out.charge = reduced ? 1 : swell(t, 2.2, 0.9, 0.35, 0.8);
  else if (state === "recoil") out.recoil = reduced ? 1 : pulse(t, 1.6, 0.06, 0.3, phase * 1.6);
  else if (state === "hit") out.hit = reduced ? 1 : pulse(t, 1.4, 0.05, 0.22, phase * 1.4 + 0.7);
  else if (state === "curl" || state === "defeat") out.curl = reduced ? 1 : swell(t, 1.3, 2.4, 1.3, 0.6);
  return out;
}

/** The instance counts and triangles one render submitted, snapshotted together (see snapshotSubmitted). */
export interface SubmittedSnapshot {
  /** Per-mesh `count` at the render (0 for a hidden mesh), in mesh order (preallocated; length is the mesh count). */
  counts: Int32Array;
  /** Visible meshes with a non-zero count: the draw calls the instance counts submit. */
  calls: number;
  /** Sum of count x triangles: the triangles the instance counts submit. */
  triangles: number;
}

export const createSubmittedSnapshot = (meshCount: number): SubmittedSnapshot => ({ counts: new Int32Array(meshCount), calls: 0, triangles: 0 });

/**
 * Writes the meshes' instance counts into `out`, in place; a mesh that is not visible counts as 0 (it is not drawn) (no allocation: it runs in every render).
 * Called from the same onAfterRender that reads the renderer's counters, so drawn and submitted
 * numbers come from one frame (the probe used to read them in separate evaluates, across frames).
 */
export function snapshotSubmitted(meshes: ReadonlyArray<{ mesh: { count: number; visible?: boolean }; triangles: number }>, out: SubmittedSnapshot): SubmittedSnapshot {
  let calls = 0, triangles = 0;
  const n = Math.min(meshes.length, out.counts.length);
  for (let i = 0; i < n; i++) {
    const m = meshes[i].mesh;
    const c = m.visible === false ? 0 : m.count;
    out.counts[i] = c;
    if (c > 0) { calls++; triangles += c * meshes[i].triangles; }
  }
  out.calls = calls;
  out.triangles = triangles;
  return out;
}
