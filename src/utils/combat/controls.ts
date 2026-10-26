/**
 * One control, two meanings by place: inside the fighting area left click and
 * the beam key (F, LB, touch) fire the plasma gun; outside, they keep today's
 * plasma sparks and tractor beam. Racing always keeps the peaceful meaning.
 */
import { NEST_LEASH_R } from "./constants";

export function inNestArea(distToCentre: number, racing: boolean): boolean {
  return distToCentre <= NEST_LEASH_R && !racing;
}

export function clickUse(inArea: boolean): "fire" | "spark" {
  return inArea ? "fire" : "spark";
}

export function beamUse(inArea: boolean): "fire" | "beam" {
  return inArea ? "fire" : "beam";
}

export function beamLabel(inArea: boolean): "FIRE" | "BEAM" {
  return inArea ? "FIRE" : "BEAM";
}
