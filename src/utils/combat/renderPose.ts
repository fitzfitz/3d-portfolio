/**
 * The monsters' poses for the renderer (components/canvas/nest/NestMonsters.tsx):
 * the AI's state poses (utils/combat/saucerAi.ts, tardigradeAi.ts) plus what
 * the AI leaves to the render, `phase`, `look` and `blink`, with the aim and
 * the look turned from world space into the monster's model space (the
 * shader's aim clamp reads the model frame). Allocation-free.
 */
import type * as THREE from "three";
import { worldDirToModel } from "./monsterFrame";
import type { Saucer } from "./saucerAi";
import type { Tardigrade } from "./tardigradeAi";
import type { SaucerPose, TardigradePose } from "../monsters/monsterRig";
import type { V3 } from "./types";

const GOLDEN = 0.6180339887498949;
/** A blink's length (s), as the monster lab's. */
const BLINK_SECONDS = 0.18;

/** Slot i's idle phase in [0, 1): steady per slot, far from its neighbours'. */
export function nestPhase(i: number): number {
  const x = i * GOLDEN + 0.29;
  return x - Math.floor(x);
}

/** An idle blink's closure at `t`: a 0.18 s half-sine every 3–5 s, the period and offset by `phase` (the lab's). */
export function idleBlink(t: number, phase: number): number {
  const period = 3 + 2 * phase;
  const u = (((t + phase * 5) % period) + period) % period;
  return u < BLINK_SECONDS ? Math.sin((Math.PI * u) / BLINK_SECONDS) : 0;
}

/**
 * A saucer's pose for this frame. `m` is its instance matrix (monsterMatrix);
 * the eyes look at the ship, the barrel aims along the AI's world aim
 * (s.ax, s.ay, s.az), both in model space. Idle blinks only while motion is
 * on and the saucer is alive (R20); the rest come from the AI.
 */
export function saucerRenderPose(s: Saucer, m: THREE.Matrix4, ship: V3, t: number, phase: number, reduced: boolean,
  out: SaucerPose): SaucerPose {
  out.phase = phase;
  worldDirToModel(m, ship.x - s.x, ship.y - s.y, ship.z - s.z, out.look);
  worldDirToModel(m, s.ax, s.ay, s.az, out.aim);
  out.chase = s.pose.chase;
  out.fire = s.pose.fire;
  out.hit = s.pose.hit;
  out.defeat = s.pose.defeat;
  out.blink = reduced || !s.alive ? 0 : idleBlink(t, phase);
  return out;
}

/** A tardigrade's pose for this frame: the AI's state poses and the slot's phase. */
export function tardigradeRenderPose(t: Tardigrade, phase: number, out: TardigradePose): TardigradePose {
  out.phase = phase;
  out.swim = t.pose.swim;
  out.charge = t.pose.charge;
  out.recoil = t.pose.recoil;
  out.hit = t.pose.hit;
  out.curl = t.pose.curl;
  return out;
}

/** What monstersOnShow reads of a monster. */
interface MonsterShow { phase: string; scale: number }

/** Is any monster on show (not gone, scaled above nothing)? The renderer draws only these. */
export function monstersOnShow(n: { saucers: readonly MonsterShow[]; tardigrades: readonly MonsterShow[] }): boolean {
  for (let i = 0; i < n.saucers.length; i++) if (n.saucers[i].phase !== "gone" && n.saucers[i].scale > 0) return true;
  for (let i = 0; i < n.tardigrades.length; i++) if (n.tardigrades[i].phase !== "gone" && n.tardigrades[i].scale > 0) return true;
  return false;
}

/**
 * Does the renderer run its instance frame (beginMonsterFrame … endMonsterFrame)?
 * While a monster is on show, and on the one frame after the last leaves (it
 * empties the meshes); then it skips, so after a visit the instance buffers are
 * not re-uploaded and the bounds not refitted every frame (Ruling C21).
 */
export function monsterFrameNeeded(shownNow: boolean, shownLast: boolean): boolean {
  return shownNow || shownLast;
}
